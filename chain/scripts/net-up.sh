#!/usr/bin/env bash
# Three nodes on this box, from the `local` preset: alice + bob are first members and
# validate from genesis; dave runs with his dev keys in the keystore but holds no
# seat until he is admitted, registers keys and the next era turns over.
#   p2p 30433-30435 · rpc 9984-9986 (localhost only) · data $SEEDS_DATA/<node>
set -euo pipefail
source "$(dirname "$0")/env.sh"
mkdir -p "$SEEDS_DATA/logs"
BOOT_KEY=0000000000000000000000000000000000000000000000000000000000000001
BOOT_ID=12D3KooWEyoppNCUx8Yx66oV9fJnriXwCcXwDDUA2kj6vnc6iDEp
start() { # name p2p rpc extra...
  local n=$1 p2p=$2 rpc=$3; shift 3
  if [ -f "$SEEDS_DATA/$n.pid" ] && kill -0 "$(cat "$SEEDS_DATA/$n.pid")" 2>/dev/null; then echo "$n already up"; return; fi
  nohup "$SEEDS_NODE" --chain local --base-path "$SEEDS_DATA/$n" --port "$p2p" --rpc-port "$rpc" \
    --rpc-cors all --validator --name "$n" "$@" >"$SEEDS_DATA/logs/$n.log" 2>&1 &
  echo $! >"$SEEDS_DATA/$n.pid"; echo "$n pid $!"
}
start alice 30433 9984 --alice --node-key $BOOT_KEY
sleep 2
start bob 30434 9985 --bob --unsafe-force-node-key-generation --bootnodes /ip4/127.0.0.1/tcp/30433/p2p/$BOOT_ID
start dave 30435 9986 --dave --unsafe-force-node-key-generation --bootnodes /ip4/127.0.0.1/tcp/30433/p2p/$BOOT_ID --rpc-methods unsafe
