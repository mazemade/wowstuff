// Emits one player profile per DPS/tank spec, as protojson, for the calibration pipeline.
//
// Why not the hosted UI's share links (the plan's first choice): a link is
// base64(zlib(protobuf)), so decoding one correctly depends on the hosted site and this
// pinned checkout agreeing about every proto field number. The repo carries the SAME BiS
// gear sets, talents, consumables, spec options and APLs that the hosted UI loads and that
// its own test suite sims against — at the commit we pinned — so building the profiles here
// removes the proto-vintage risk and the manual capture step at once. Ruled by Max
// 2026-08-13; this is the plan's documented "hand-assemble from ui/*/presets.ts +
// gear_sets/*.gear.json" fallback, done against the Go helpers instead of by transcription.
//
// Consumables, talents, professions and distance come from calibration/presets.json, which
// extract-presets.mjs reads out of ui/<spec>/presets.ts. Gear and APLs are read straight
// from the checkout's JSON. Only the Spec-options oneof is written out here, because it is
// a Go type that cannot be expressed as data.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/wowsims/tbc/sim/common" // item effects
	"github.com/wowsims/tbc/sim/core"
	"github.com/wowsims/tbc/sim/core/proto"
	"google.golang.org/protobuf/encoding/protojson"
)

const repo = "../vendor/tbc-new"

type preset struct {
	Dir                string          `json:"dir"`
	Consumables        json.RawMessage `json:"consumables"`
	Talents            string          `json:"talents"`
	Race               string          `json:"race"`
	Profession1        string          `json:"profession1"`
	Profession2        string          `json:"profession2"`
	DistanceFromTarget float64         `json:"distanceFromTarget"`
}

type spec struct {
	gearDir  string // relative to the checkout root
	gearFile string
	aplDir   string
	aplFile  string
	setSpec  func(*proto.Player) // the Player.Spec oneof wrapper is unexported
	isTank   bool
	turret   bool // hunters only: disable the melee-weave APL variable
}

// Phase-2 (SSC/TK) gear for every spec that has it, matching spec §7's "P2/SSC gear".
var specs = map[string]spec{
	"HUNTER:Beast Mastery": {"ui/hunter/dps/gear_sets/phase_2/bm", "2h_6p", "ui/hunter/dps/apls", "default", hunterSpec, false, true},
	"HUNTER:Survival":      {"ui/hunter/dps/gear_sets/phase_2/sv", "2h_6p", "ui/hunter/dps/apls", "default", hunterSpec, false, true},
	"WARRIOR:Fury":         {"ui/warrior/dps/gear_sets", "p2_fury", "ui/warrior/dps/apls", "fury", dpsWarriorSpec, false, false},
	"WARRIOR:Arms":         {"ui/warrior/dps/gear_sets", "p2_arms", "ui/warrior/dps/apls", "arms", dpsWarriorSpec, false, false},
	"WARRIOR:Protection":   {"ui/warrior/protection/gear_sets", "p2_bis", "ui/warrior/protection/apls", "default", protWarriorSpec, true, false},
	"PALADIN:Retribution":  {"ui/paladin/retribution/gear_sets", "p2", "ui/paladin/retribution/apls", "default", retPaladinSpec, false, false},
	"PALADIN:Protection":   {"ui/paladin/protection/gear_sets", "p2", "ui/paladin/protection/apls", "default", protPaladinSpec, true, false},
	"ROGUE:Combat":         {"ui/rogue/dps/gear_sets", "p2", "ui/rogue/dps/apls", "swords", rogueSpec, false, false},
	"PRIEST:Shadow":        {"ui/priest/dps/gear_sets", "p2", "ui/priest/dps/apls", "default", priestSpec, false, false},
	"SHAMAN:Elemental":     {"ui/shaman/elemental/gear_sets", "p2", "ui/shaman/elemental/apls", "default", eleShamanSpec, false, false},
	"SHAMAN:Enhancement":   {"ui/shaman/enhancement/gear_sets", "p2", "ui/shaman/enhancement/apls", "default", enhShamanSpec, false, false},
	"MAGE:Arcane":          {"ui/mage/dps/gear_sets", "p2Arcane", "ui/mage/dps/apls", "arcane", mageSpec, false, false},
	"WARLOCK:Destruction":  {"ui/warlock/dps/gear_sets", "t5", "ui/warlock/dps/apls", "destruction", warlockSpec, false, false},
	"WARLOCK:Affliction":   {"ui/warlock/dps/gear_sets", "t5", "ui/warlock/dps/apls", "affliction", warlockAfflictionSpec, false, false},
	"WARLOCK:Demonology":   {"ui/warlock/dps/gear_sets", "t5", "ui/warlock/dps/apls", "demonology", warlockDemonologySpec, false, false},
	"DRUID:Balance":        {"ui/druid/balance/gear_sets", "p2_a", "ui/druid/balance/apls", "default", balanceSpec, false, false},
	"DRUID:Feral":          {"ui/druid/feralcat/gear_sets", "p2_6p", "ui/druid/feralcat/apls", "default", feralCatSpec, false, false},
	"DRUID:Guardian":       {"ui/druid/feralbear/gear_sets", "p2_balanced", "ui/druid/feralbear/apls", "default", feralBearSpec, true, false},
}

var classOf = map[string]proto.Class{
	"WARRIOR": proto.Class_ClassWarrior, "PALADIN": proto.Class_ClassPaladin,
	"HUNTER": proto.Class_ClassHunter, "ROGUE": proto.Class_ClassRogue,
	"PRIEST": proto.Class_ClassPriest, "SHAMAN": proto.Class_ClassShaman,
	"MAGE": proto.Class_ClassMage, "WARLOCK": proto.Class_ClassWarlock,
	"DRUID": proto.Class_ClassDruid,
}

func main() {
	raw, err := os.ReadFile("../presets.json")
	must(err)
	var presets map[string]preset
	must(json.Unmarshal(raw, &presets))

	outDir := "../out/profiles"
	must(os.MkdirAll(outDir, 0o755))
	m := protojson.MarshalOptions{Multiline: true, Indent: " "}

	keys := make([]string, 0, len(specs))
	for k := range specs {
		keys = append(keys, k)
	}
	sortStrings(keys)

	for _, key := range keys {
		s := specs[key]
		p, ok := presets[key]
		if !ok {
			panic("no preset for " + key)
		}
		pl := buildPlayer(key, s, p)
		data, err := m.Marshal(pl)
		must(err)
		// The tank flag travels alongside the player: the request builder needs it to fill
		// RaidSimRequest.raid.tanks, without which a tank's TPS/DTPS never gets measured.
		wrapper := map[string]any{"player": json.RawMessage(data), "isTank": s.isTank}
		out, err := json.MarshalIndent(wrapper, "", " ")
		must(err)
		name := filepath.Join(outDir, sanitize(key)+".json")
		must(os.WriteFile(name, out, 0o644))
		fmt.Println("wrote", name)
	}
}

func buildPlayer(key string, s spec, p preset) *proto.Player {
	gear := core.GetGearSet(filepath.Join(repo, s.gearDir), s.gearFile)
	apl := core.GetAplRotation(filepath.Join(repo, s.aplDir), s.aplFile)
	if s.turret {
		// Max's ruling 2026-08-13: hunters are simmed as TURRETS, not melee weavers. The
		// shipped APL weaves, which makes a hunter auto-attack in melee and so genuinely
		// proc Windfury (+3-4%) — real, but only if your hunters actually weave. Same
		// override the repo's own hunter_test.go uses for its "Turret" variant.
		if len(apl.Rotation.ValueVariables) > 2 && apl.Rotation.ValueVariables[2].Name == "Melee weave" {
			apl.Rotation.ValueVariables[2].Value = &proto.APLValue{
				Value: &proto.APLValue_Const{Const: &proto.APLValueConst{Val: "false"}},
			}
		} else {
			panic("hunter APL variable 2 is not 'Melee weave' — the checkout moved")
		}
	}

	var consumes proto.ConsumesSpec
	must(protojson.Unmarshal(p.Consumables, &consumes))

	pl := &proto.Player{
		Name:               key,
		Race:               proto.Race(proto.Race_value[p.Race]),
		Class:              classOf[key[:index(key, ':')]],
		Equipment:          gear.GearSet,
		TalentsString:      p.Talents,
		Consumables:        &consumes,
		Rotation:           apl.Rotation,
		Profession1:        proto.Profession(proto.Profession_value[p.Profession1]),
		Profession2:        proto.Profession(proto.Profession_value[p.Profession2]),
		DistanceFromTarget: p.DistanceFromTarget,
	}
	s.setSpec(pl)
	return pl
}

// --- Spec-options oneofs. Copied from each spec's *_test.go at the pinned SHA; they live in
// _test.go files, which a normal program cannot import. README records the SHA.

func hunterSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_Hunter{Hunter: &proto.Hunter{Options: &proto.Hunter_Options{
		ClassOptions: &proto.HunterOptions{
			Ammo: proto.HunterOptions_AdamantiteStinger, PetType: proto.HunterOptions_Ravager,
			PetUptime: 100.0, QuiverBonus: proto.HunterOptions_Speed15,
		},
	}}}
}

func dpsWarriorSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_DpsWarrior{DpsWarrior: &proto.DpsWarrior{Options: &proto.DpsWarrior_Options{
		ClassOptions: &proto.WarriorOptions{
			DefaultShout: proto.WarriorShout_WarriorShoutBattle,
			DefaultStance: proto.WarriorStance_WarriorStanceBerserker,
		},
	}}}
}

func protWarriorSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_ProtectionWarrior{ProtectionWarrior: &proto.ProtectionWarrior{
		Options: &proto.ProtectionWarrior_Options{
			ClassOptions: &proto.WarriorOptions{
				DefaultShout: proto.WarriorShout_WarriorShoutCommanding,
				DefaultStance: proto.WarriorStance_WarriorStanceDefensive,
			},
		},
	}}
}

func retPaladinSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_RetributionPaladin{RetributionPaladin: &proto.RetributionPaladin{
		Options: &proto.RetributionPaladin_Options{ClassOptions: &proto.PaladinOptions{}},
	}}
}

func protPaladinSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_ProtectionPaladin{ProtectionPaladin: &proto.ProtectionPaladin{
		Options: &proto.ProtectionPaladin_Options{ClassOptions: &proto.PaladinOptions{}},
	}}
}

func rogueSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_Rogue{Rogue: &proto.Rogue{
		Options: &proto.Rogue_Options{ClassOptions: &proto.RogueOptions{}},
	}}
}

func priestSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_Priest{Priest: &proto.Priest{
		Options: &proto.Priest_Options{ClassOptions: &proto.PriestOptions{}},
	}}
}

func eleShamanSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_ElementalShaman{ElementalShaman: &proto.ElementalShaman{
		Options: &proto.ElementalShaman_Options{ClassOptions: &proto.ShamanOptions{
			ShieldProcrate: 0.0,
		}},
	}}
}

func enhShamanSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_EnhancementShaman{EnhancementShaman: &proto.EnhancementShaman{
		// Windfury Weapon imbue: the enh shaman's own imbue, which is exactly why the
		// Windfury TOTEM is worth nothing to it in the engine's table.
		Options: &proto.EnhancementShaman_Options{ClassOptions: &proto.ShamanOptions{
			ImbueMh: proto.ShamanImbue_WindfuryWeapon, ImbueMhSwap: proto.ShamanImbue_WindfuryWeapon,
			ShieldProcrate: 0.0,
		}},
	}}
}

func mageSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_Mage{Mage: &proto.Mage{Options: &proto.Mage_Options{
		ClassOptions: &proto.MageOptions{DefaultMageArmor: proto.MageArmor_MageArmorMageArmor},
	}}}
}

func warlockSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_Warlock{Warlock: &proto.Warlock{Options: &proto.Warlock_Options{
		ClassOptions: &proto.WarlockOptions{Armor: proto.WarlockOptions_FelArmor, Summon: proto.WarlockOptions_Imp},
	}}}
}

func warlockAfflictionSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_Warlock{Warlock: &proto.Warlock{Options: &proto.Warlock_Options{
		ClassOptions: &proto.WarlockOptions{Armor: proto.WarlockOptions_FelArmor, Summon: proto.WarlockOptions_Felhunter},
	}}}
}

func warlockDemonologySpec(pl *proto.Player) {
	pl.Spec = &proto.Player_Warlock{Warlock: &proto.Warlock{Options: &proto.Warlock_Options{
		ClassOptions: &proto.WarlockOptions{Armor: proto.WarlockOptions_FelArmor, Summon: proto.WarlockOptions_Felguard},
	}}}
}

func balanceSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_BalanceDruid{BalanceDruid: &proto.BalanceDruid{
		Options: &proto.BalanceDruid_Options{ClassOptions: &proto.DruidOptions{}},
	}}
}

func feralCatSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_FeralCatDruid{FeralCatDruid: &proto.FeralCatDruid{
		Options: &proto.FeralCatDruid_Options{ClassOptions: &proto.DruidOptions{}},
	}}
}

func feralBearSpec(pl *proto.Player) {
	pl.Spec = &proto.Player_FeralBearDruid{FeralBearDruid: &proto.FeralBearDruid{
		Options: &proto.FeralBearDruid_Options{ClassOptions: &proto.DruidOptions{}},
	}}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func index(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func sanitize(k string) string {
	b := []byte(k)
	for i := range b {
		if b[i] == ':' || b[i] == ' ' {
			b[i] = '_'
		}
	}
	return string(b)
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
