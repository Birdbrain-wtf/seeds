#!/usr/bin/env bash
# Build the seeds node + runtime.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$SEEDS_BUILD_ROOT"
cargo build --release -p seeds-node "$@"
ls -la "$SEEDS_NODE" "$SEEDS_WASM"
