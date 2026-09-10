package main

import (
	"fmt"
	"github.com/wowsims/tbc/sim"
	"github.com/wowsims/tbc/sim/core"
	"github.com/wowsims/tbc/sim/core/proto"
	"google.golang.org/protobuf/encoding/protojson"
	"os"
)

func main() {
	sim.RegisterAll()
	if len(os.Args) != 2 {
		panic("usage: wowsimstats INPUT")
	}
	body, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	request := &proto.RaidSimRequest{}
	if err = (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(body, request); err != nil {
		panic(err)
	}
	result := core.ComputeStats(&proto.ComputeStatsRequest{Raid: request.Raid, Encounter: request.Encounter})
	encoded, err := protojson.Marshal(result)
	if err != nil {
		panic(err)
	}
	fmt.Print(string(encoded))
}
