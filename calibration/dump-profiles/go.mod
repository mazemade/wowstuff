module wowstuff/calibration/dumpprofiles

go 1.25.0

require (
	github.com/wowsims/tbc v0.0.0
	google.golang.org/protobuf v1.36.10
)

require golang.org/x/exp v0.0.0-20250408133849-7e4ce0ab07d0 // indirect

replace github.com/wowsims/tbc => ../vendor/tbc-new
