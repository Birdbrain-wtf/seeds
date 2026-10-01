# Shared paths for the seeds chain. Source, don't run. Any of these can be set
# beforehand to override them.
SEEDS=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export SEEDS
export SEEDS_BUILD_ROOT=$SEEDS
export SEEDS_E2E_DIR=$SEEDS/e2e
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$SEEDS/target}
export SEEDS_NODE=$CARGO_TARGET_DIR/release/seeds-node
export SEEDS_WASM=$CARGO_TARGET_DIR/release/wbuild/seeds-runtime/seeds_runtime.compact.compressed.wasm
export SEEDS_DATA=${SEEDS_DATA:-$SEEDS/.data}
export PATH=$HOME/.cargo/bin:$PATH
