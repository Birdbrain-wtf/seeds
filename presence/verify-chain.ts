#!/usr/bin/env bun
/**
 * verify-chain.ts — check that a published roster's root is the one on chain.
 *
 * Rebuilding a root from a roster proves the roster is internally consistent.
 * It does not prove the root was committed before anything was decided against it.
 * This reads the anchoring extrinsic from Kusama Asset Hub, decodes its
 * System.remark and compares it with the root rebuilt from the roster.
 *
 *   bun run verify-chain.ts rosters/CS33.json
 *
 * Read-only. No keys, nothing signed.
 */

import { ApiPromise, WsProvider } from "@polkadot/api";
import { hexToString } from "@polkadot/util";

const ENDPOINTS = [
  "wss://kusama-asset-hub-rpc.polkadot.io",
  "wss://sys.ibp.network/asset-hub-kusama",
  "wss://rpc-asset-hub-kusama.luckyfriday.io",
];

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: bun run verify-chain.ts rosters/<session>.json");
  const roster = await Bun.file(path).json();
  const a = roster.anchored;
  if (!a?.block || !a?.extrinsic) throw new Error(`${path} carries no anchoring record`);

  // Rebuild the root from the roster with the checker itself, so the two
  // halves of the claim are checked by the same code anyone runs.
  const proc = Bun.spawnSync(["bun", "run", `${import.meta.dir}/attendance-root.ts`, "build", path], { stderr: "pipe" });
  const out = proc.stderr.toString();
  const rebuilt = out.match(/root\s+(0x[0-9a-f]{64})/)?.[1];
  if (proc.exitCode !== 0 || !rebuilt) throw new Error(`rebuild failed:\n${out}`);

  const api = await ApiPromise.create({ provider: new WsProvider(ENDPOINTS), noInitWarn: true });
  try {
    const signed = await api.rpc.chain.getBlock(a.block);
    const header = signed.block.header;
    const ext = signed.block.extrinsics.find((x) => x.hash.toHex() === a.extrinsic);
    if (!ext) throw new Error(`extrinsic ${a.extrinsic} not found in block ${a.block}`);
    const { section, method } = ext.method;
    if (section !== "system" || !method.startsWith("remark")) {
      throw new Error(`extrinsic is ${section}.${method}, not a remark`);
    }
    const remark = hexToString(ext.method.args[0].toHex());
    const expected = `birdbrain/attendance/v2:${roster.session}:${rebuilt}`;

    console.log(`session     ${roster.session}`);
    console.log(`block       #${header.number.toNumber()} ${a.block}`);
    console.log(`signer      ${ext.signer.toString()}`);
    console.log(`on chain    ${remark}`);
    console.log(`rebuilt     ${expected}`);
    const ok = remark === expected;
    console.log(ok ? "MATCH       the published roster is the one committed on chain" : "MISMATCH");
    process.exit(ok ? 0 : 1);
  } finally {
    await api.disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
