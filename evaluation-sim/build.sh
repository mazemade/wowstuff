#!/usr/bin/env bash
set -euo pipefail

commit="72e0c8a8feaf62da67add31090666773d6040f69"
root="$(cd "$(dirname "$0")" && pwd)"
vendor="$root/vendor"
source_dir="$(mktemp -d "${TMPDIR:-/tmp}/wowsims-tbc.XXXXXX")"
tool_dir="$source_dir/.build-tools"
trap 'rm -rf "$source_dir"' EXIT

git clone --filter=blob:none https://github.com/wowsims/tbc-new.git "$source_dir"
git -C "$source_dir" checkout --detach "$commit"
mkdir -p "$source_dir/cmd/wowsimstats" "$vendor"
cp "$root/wowsimstats.go" "$source_dir/cmd/wowsimstats/main.go"

mkdir -p "$tool_dir"
GOBIN="$tool_dir" go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.10
(cd "$source_dir" && PATH="$tool_dir:$PATH" make sim/core/proto/api.pb.go)
(cd "$source_dir" && go build -trimpath --tags=with_db -ldflags "-s -w -X main.Version=$commit" -o "$vendor/wowsimcli" ./cmd/wowsimcli)
(cd "$source_dir" && go build -trimpath --tags=with_db -ldflags "-s -w" -o "$vendor/wowsimstats" ./cmd/wowsimstats)
"$vendor/wowsimcli" version
