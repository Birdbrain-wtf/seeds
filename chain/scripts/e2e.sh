#!/usr/bin/env bash
# The whole proof in one go: build the node, build the next runtime (one spec_version
# ahead, for the upgrade check), start three nodes from a fresh genesis, walk every job
# the pallet has, then stop. Takes about 12 minutes once the build is warm.
set -euo pipefail
source "$(dirname "$0")/env.sh"
bash "$SEEDS/scripts/build.sh"

lib=$SEEDS/runtime/src/lib.rs
v=$(grep -oP 'spec_version: \K[0-9]+' "$lib")
cp "$lib" "$lib.bak"; trap 'mv -f "$lib.bak" "$lib"' EXIT
sed -i "s/spec_version: $v,/spec_version: $((v + 1)),/" "$lib"
(cd "$SEEDS_BUILD_ROOT" && cargo build --release -p seeds-runtime)
mkdir -p "$SEEDS_DATA"
NEXT=$SEEDS_DATA/seeds-runtime-next.wasm
cp "$SEEDS_WASM" "$NEXT"
mv -f "$lib.bak" "$lib"; trap - EXIT
echo "next runtime: spec $((v + 1)) at $NEXT"

bash "$SEEDS/scripts/net-down.sh" --wipe >/dev/null
bash "$SEEDS/scripts/net-up.sh"
trap 'bash "$SEEDS/scripts/net-down.sh"' EXIT
sleep 20
cd "$SEEDS_E2E_DIR"
[ -d node_modules ] || bun install
bun run seeds-e2e.ts "$NEXT"
