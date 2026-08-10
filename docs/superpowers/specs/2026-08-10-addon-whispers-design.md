# In-Game Assignment Whispers — Design

**Date:** 2026-08-10
**Status:** Approved pending user review
**Project:** wowstuff (TBC Anniversary raid tools)
**Extends:** [Raid Assignments Tool](2026-08-10-raid-assignments-design.md)

## Purpose

Deliver each player's assignments to them in-game, automatically, instead of the
raid leader pasting `/w` lines one at a time.

The assignments tool already produces per-player whisper text on its Whispers
tab. Sending it is the manual part: WoW's chat box takes one line per paste, so
a 25-man raid is 25 paste-and-enter cycles. This design automates the sending.

## The constraint that shapes everything

A web page cannot send chat messages into WoW. There is no API, no socket, no
extension point — the browser and the game client share nothing. Anything that
actually sends a whisper must run inside WoW as an addon.

So the feature is a round trip: the web tool emits a string, the player pastes
it into the RaidSpecScan addon, and the addon does the sending. This mirrors the
existing `/specscan` flow in the opposite direction, which is already proven to
work through a copy-paste boundary.

## Scope

In scope:

- A new **Addon** output tab on the assignments page emitting a paste string.
- A paste-and-preview window in RaidSpecScan.
- Throttled whisper sending with a changed-only diff against the last send.

Out of scope: sending to Discord from in-game, reading assignments back out of
the game, per-boss variants, whispering people who are not in the raid group.

## Transport format

Version-prefixed, one line per whisper:

```
RSW1
Tanky=Sunder Armor
Dave=Curse of Elements; Soulstone on Healbot
Frostina=Polymorph on {moon}
```

- First line is the format version, matching the `RSS1` convention `/specscan`
  already uses.
- Each subsequent line is `<character name>=<message body>`.
- The name is everything before the **first** `=`; the body is everything after
  it. A character name cannot contain `=`, so the split is unambiguous.
- Newline-separated because that is what pastes cleanly into a multiline
  EditBox — the same mechanism the export window already relies on.
- `{moon}`, `{skull}` and the rest survive as-is; WoW's chat renders them as the
  real raid target icons in a whisper.

A 25-man sheet is roughly 1.5 KB. The paste EditBox sets `SetMaxLetters(0)` and
`SetMaxBytes(0)` so nothing is silently truncated.

### The 255-character rule

WoW rejects chat messages over 255 characters. Rather than teach the addon about
that limit, **the engine guarantees it**: a player with enough duties to exceed
255 characters gets two lines with the same name, and the addon sends two
whispers. This reuses the `packChat` helper that already backs the `/raid` tab.

The addon therefore groups lines by name for the diff, but sends each line as
its own message.

## Web side

A fifth output tab, **Addon**, alongside Discord / Share link / /raid macro /
Whispers. It reuses the existing tab switching and Copy button; only the content
builder is new.

`buildAddonWhispers(roster, sheet)` produces the string above. The per-player
duty aggregation currently living inside `buildWhispers` is factored into a
shared helper so the two outputs cannot drift apart — a bug where the Whispers
tab and the addon disagree about someone's duties would be invisible until it
mattered.

Players with no duties produce no line, per the chosen message style: terse,
duties only, no all-clear message.

## Addon side

### One window, two states

`/specsend` opens a single frame, following the existing export window's
pattern (BackdropTemplate, movable, scroll child):

- **Empty** — a paste box and a Load button.
- **Loaded** — the preview list, each row tagged `NEW`, `CHANGED` or
  `UNCHANGED`, with `[Send N changed]`, `[Send all]` and `[Cancel]`.

Nothing is sent until a Send button is clicked. This is deliberate: 25 whispers
cannot be recalled, and a bad paste should be visible before it reaches the raid.

### Sending

Messages go out via `SendChatMessage(body, "WHISPER", nil, name)`, one per
**1.0 second** on an OnUpdate timer. The spacing is the point — Blizzard's spam
filter drops or throttles bursts, and a fast loop risks a disconnect. A 25-man
takes about 25 seconds, with progress printed to chat.

Two rules keep it from misfiring:

- **Only players currently in the raid group are whispered.** Names are matched
  against the raid roster case-insensitively with the realm suffix ignored, so
  cross-realm players resolve correctly.
- **Anyone in the sheet who is not in the raid is reported as skipped**, not
  whispered. This is the common case after a comp change and should be visible,
  not silent.

### Send history

The changed-only diff requires persistence, so the addon gains
`## SavedVariables: RaidSpecScanDB`, storing the last message body sent to each
player. Account-wide rather than per-character: the raid leader may swap
characters between nights, and the history is about the raid, not the toon.

`/specsend reset` clears the history when a clean full send is wanted.

## Error handling

| Situation | Behaviour |
|---|---|
| Paste is empty or lacks the `RSW1` header | Refuse to load, explain the expected format |
| A line has no `=` | Skip that line, report it in the preview as malformed |
| Not in a raid group at all | Preview still loads; Send is disabled with an explanation |
| Player in sheet but not in raid | Listed as skipped; no whisper attempted |
| Player offline | Cannot be reliably detected; the whisper is attempted and WoW's own error surfaces |
| Send already running | `/specsend` reports it rather than starting a second batch |

## Testing

Engine and web changes get real automated tests in `assignments-engine.test.js`:

- Format: header line, `name=body` shape, players with no duties omitted
- The 255-character split producing repeated name lines
- Delimiter safety: duty text containing `;`, `/`, parentheses, `{mark}` tokens
- Agreement between `buildAddonWhispers` and `buildWhispers` for the same sheet

**The addon half cannot be automatically tested.** It requires being in a raid
group in-game. It will be delivered as explicitly unverified, with a manual test
checklist, exactly as `/specscan` was.

## Risk: is `SendChatMessage` allowed?

The entire design assumes an addon may call `SendChatMessage` for a whisper
without a hardware event. This has always been true in Classic and is how raid
tooling has historically worked, but it is not verified against build 2.5.6 from
outside the game, and if it has been tightened the send fails silently.

**This gets proven first.** Before the preview UI is built, a throwaway slash
command that whispers a single hardcoded target establishes whether the call
works and whether 1-second spacing survives the spam filter. Five minutes of
in-game testing that de-risks the whole feature.

## v2 ideas (explicitly not v1)

- Re-send only to players who changed *since the raid started*, not since the
  last paste
- A `/specsend test` mode that prints the whispers to your own chat frame
  instead of sending them
- Reading acknowledgements back ("got it") and showing who has not responded
