# Evaluation simulation runtime

`evaluation-sim.js` uses a pinned WoWSims TBC build. Deployment must provide Go and Git at build time and run:

```sh
./evaluation-sim/build.sh
```

This requires Git, Go, `make`, `protoc`, and the modern `google.golang.org/protobuf` `protoc-gen-go` plugin. It regenerates the Go protobufs and creates ignored platform-specific binaries in `evaluation-sim/vendor/` with the embedded simulator database. At runtime, `WCL_SIM_BIN` and `WCL_SIM_STATS_BIN` may point to separately managed binaries. The service rejects a simulator whose `version` output does not match the pinned commit. `WCL_SIM_ITERATIONS` controls the bounded iteration count (default 10,000; maximum 10,000). Simulation jobs are serialized in-process and each subprocess has a 45-second timeout.

The Fury template is a protobuf envelope only. `evaluation-models.js`, `apls/`, `gears/`, and `talents/` are generated from the pinned source and select a matching native TBC class/spec model. The original Fury calibration remains separately validated. Every other result is conditional until final stats, race, detailed talents, and controlled encounter inputs agree. Healers and tanks without an incoming-damage model return `not-applicable`; the runtime never fabricates HPS, mitigation, or TPS advice.
