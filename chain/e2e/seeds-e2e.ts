// End-to-end run of the seeds chain, against the three-node local net from
// scripts/net-up.sh. Walks every job the one pallet has, on a live chain, and
// prints a line per claim it checks. scripts/e2e.sh builds everything and runs it.
//
//   bun run seeds-e2e.ts path/to/next-runtime.wasm
//
// Founders at genesis: Alice + Bob (validating), Charlie (no keys).
// Dave is the newcomer, Eve the outsider, Ferdie the old-chain holder.

import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { cryptoWaitReady, blake2AsHex, decodeAddress } from "@polkadot/util-crypto";
import { stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";

const WASM = process.argv[2];
if (!WASM) throw new Error("usage: bun run seeds-e2e.ts path/to/next-runtime.wasm (scripts/e2e.sh builds one)");
const UNIT = 10n ** 12n;
const EV = blake2AsHex("session attendance root (stand-in)");

await cryptoWaitReady();
const k = new Keyring({ type: "sr25519", ss58Format: 42 });
const [alice, bob, charlie, dave, eve, ferdie] = ["Alice", "Bob", "Charlie", "Dave", "Eve", "Ferdie"].map((n) =>
  k.addFromUri(`//${n}`),
);
const daveEd = new Keyring({ type: "ed25519" }).addFromUri("//Dave");

const api = await ApiPromise.create({
  provider: new WsProvider("ws://127.0.0.1:9984"),
  noInitWarn: true,
  signedExtensions: { OnlyMembers: { extrinsic: {}, payload: {} } },
});

let fails = 0;
function check(ok: boolean, what: string, detail: unknown = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail !== "" ? `  (${detail})` : ""}`);
  if (!ok) fails++;
}
const head = async () => (await api.rpc.chain.getHeader()).number.toNumber();
const fin = async () => (await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead())).number.toNumber();
async function until(n: number) {
  while ((await head()) < n) await Bun.sleep(3000);
}
const bal = async (a: string) => BigInt((await api.query.seeds.balances(a)).toString());
const fmt = (v: bigint) => `${Number(v) / 1e12} units`;

function send(tx: any, signer?: any): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const cb = ({ status, events, dispatchError }: any) => {
      if (dispatchError) {
        const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule) : null;
        return reject(new Error(m ? `${m.section}.${m.name}` : dispatchError.toString()));
      }
      if (status.isInBlock) resolve(events.map(({ event }: any) => `${event.section}.${event.method}`));
    };
    (signer ? tx.signAndSend(signer, cb) : tx.send(cb)).catch(reject);
  });
}

// ---------------------------------------------------------------- the shape
const pallets = api.runtimeMetadata.asLatest.pallets.map((p: any) => p.name.toString());
check(
  JSON.stringify(pallets) === JSON.stringify(["System", "Timestamp", "Aura", "Grandpa", "Seeds"]),
  "runtime is five pallets and nothing else",
  pallets.join(", "),
);
const v0 = (await api.rpc.state.getRuntimeVersion()).specVersion.toNumber();
check((await api.query.seeds.memberCount()).toNumber() === 3, "genesis: three founders");
check((await bal(alice.address)) === 0n, "founders hold nothing: joining mints no units", fmt(await bal(alice.address)));
check(api.tx.seeds.transfer === undefined, "there is no transfer call: units are a record, not a currency");
check((await api.query.seeds.foundingActive()).isTrue, "founding control is on");
check(((await api.query.aura.authorities()) as any).length === 2, "two validators at genesis");

// ----------------------------------------------------------------- the gate
try {
  await send(api.tx.system.remark("hello"), eve);
  check(false, "a non-member cannot write");
} catch (e: any) {
  check(/1010|Invalid/i.test(e.message), "a non-member cannot write, refused before the pool", e.message.slice(0, 60));
}

// ----------------------------------------------------------------- admission
await send(api.tx.seeds.witness(dave.address, 0, EV), alice);
check((await api.query.seeds.members(dave.address)).isNone, "one witness is not enough");
try {
  await send(api.tx.seeds.witness(dave.address, 0, blake2AsHex("another session")), bob);
  check(false, "witnesses must agree on the evidence");
} catch (e: any) {
  check(e.message === "seeds.CandidacyMismatch", "witnesses must agree on the evidence", e.message);
}
const admitted = await send(api.tx.seeds.witness(dave.address, 0, EV), bob);
check(admitted.includes("seeds.Admitted") && !admitted.includes("seeds.Minted"), "second witness admits Dave, and nothing is minted", admitted.filter((e) => e.startsWith("seeds")).join(" "));
check((await bal(dave.address)) === 0n, "Dave arrives with a vote and an empty balance");
const events = await send(api.tx.system.remark("first words"), dave);
check(events.includes("system.ExtrinsicSuccess"), "Dave can now write, feelessly");

// -------------------------------------------------------------------- claim
const genesis = (await api.rpc.chain.getBlockHash(0)).toU8a();
const msg = u8aConcat(stringToU8a("seeds-claim:"), genesis, decodeAddress(dave.address));
const ferdieKey = u8aToHex(ferdie.publicKey);
try {
  const elsewhere = ferdie.sign(u8aConcat(stringToU8a("seeds-claim:"), new Uint8Array(32).fill(0xab), decodeAddress(dave.address)));
  await send(api.tx.seeds.claim(dave.address, ferdieKey, { Sr25519: elsewhere }));
  check(false, "a claim signed for another network is refused");
} catch (e: any) {
  check(/1010|Invalid|BadProof/i.test(e.message), "a claim signed for another network is refused", e.message.slice(0, 60));
}
try {
  const forged = ferdie.sign(u8aConcat(stringToU8a("seeds-claim:"), genesis, decodeAddress(eve.address)));
  await send(api.tx.seeds.claim(dave.address, ferdieKey, { Sr25519: forged }));
  check(false, "a claim signed for someone else is refused");
} catch (e: any) {
  check(/1010|Invalid|BadProof/i.test(e.message), "a claim signed for someone else is refused", e.message.slice(0, 60));
}
const before = await bal(dave.address);
await send(api.tx.seeds.claim(dave.address, ferdieKey, { Sr25519: ferdie.sign(msg) }));
check((await bal(dave.address)) - before === 1000n * UNIT, "Ferdie's old key moves the snapshot to Dave, unsigned by Dave", fmt((await bal(dave.address)) - before));
check((await api.query.seeds.unclaimed()).toString() === "0", "nothing left unclaimed");

// ------------------------------------------------------------ keys, a point
await send(api.tx.seeds.setKeys({ aura: u8aToHex(dave.publicKey), grandpa: u8aToHex(daveEd.publicKey) }), dave);
check(((await api.query.seeds.keyHolders()) as any).length === 3, "Dave queues for a seat");

const digest = blake2AsHex("a point for the graph");
await send(api.tx.seeds.proposePoint(digest, "e2e"), dave);
const point: any = (await api.query.seeds.points(digest)).unwrap();
const matures = point.maturesAt.toNumber();
await send(api.tx.seeds.challenge(digest), bob);
check(point.status.isPending, `a point with no bond, matures at #${matures}; one challenge is below the threshold of three`);

const weak = blake2AsHex("a point the room rejects");
await send(api.tx.seeds.proposePoint(weak, "weak"), alice);
for (const who of [bob, charlie]) await send(api.tx.seeds.challenge(weak), who);
const failed = await send(api.tx.seeds.challenge(weak), dave);
const aliceRec: any = (await api.query.seeds.members(alice.address)).unwrap();
check(failed.includes("seeds.Failed") && aliceRec.strikes.toNumber() === 1, "three challenges fail a point: nothing minted, a strike on the proposer", `strikes ${aliceRec.strikes}`);

// ------------------------------------------------------------------ upgrade
const wasm = new Uint8Array(await Bun.file(WASM).arrayBuffer());
const codeHash = blake2AsHex(wasm);
await send(api.tx.seeds.propose({ Upgrade: { codeHash } }), alice);
const up = (await api.query.seeds.nextMotionId()).toNumber() - 1;
const upEnds = ((await api.query.seeds.motions(up)) as any).unwrap().endsAt.toNumber();
console.log(`      waiting for the upgrade vote to end at #${upEnds}`);
await until(upEnds);
const closed = await send(api.tx.seeds.close(up), charlie);
check(closed.includes("system.UpgradeAuthorized"), "a founder's upgrade with no objection is authorised", closed.filter((e) => /Upgrade|Motion/.test(e)).join(" "));
await send(api.tx.system.applyAuthorizedUpgrade(u8aToHex(wasm)), charlie);
await Bun.sleep(8000);
const v1 = (await api.rpc.state.getRuntimeVersion()).specVersion.toNumber();
check(v1 === v0 + 1, "any member applies the authorised code: forkless upgrade, no sudo", `${v0} -> ${v1}`);

// ------------------------------------------------------- end founding control
await send(api.tx.seeds.propose("EndFounding"), dave);
const ef = (await api.query.seeds.nextMotionId()).toNumber() - 1;
await send(api.tx.seeds.vote(ef, true), alice);
await send(api.tx.seeds.vote(ef, true), bob);
const efEnds = ((await api.query.seeds.motions(ef)) as any).unwrap().endsAt.toNumber();
console.log(`      waiting for the founding vote to end at #${efEnds}`);
await until(efEnds);
const ended = await send(api.tx.seeds.close(ef), dave);
check(ended.includes("seeds.FoundingEnded") && !(await api.query.seeds.foundingActive()).isTrue, "members vote founding control away, 3 of 4");

// ---------------------------------------------------------------- maturity
console.log(`      waiting for the point to mature at #${matures}`);
await until(matures + 1);
const p2: any = (await api.query.seeds.points(digest)).unwrap();
check(p2.status.isMatured, "the point matured", p2.status.toString());
check((await bal(dave.address)) === 1000n * UNIT + 10n * UNIT, "the maturity mint, the only one", fmt(await bal(dave.address)));
const issuance = BigInt((await api.query.seeds.totalIssuance()).toString());
check(issuance === (10n + 1000n) * UNIT, "issuance = one maturity + the snapshot, nothing else", fmt(issuance));

// ---------------------------------------------------------------- the seat
const era = (await api.consts.seeds.eraLength as any).toNumber();
const nextEra = Math.ceil(((await head()) + 1) / era) * era;
console.log(`      waiting for the era to turn at #${nextEra}`);
await until(nextEra + 1);
check(((await api.query.aura.authorities()) as any).length === 3, "at the era, Dave's keys join Aura");
check(((await api.query.seeds.validators()) as any).length === 3, "Seeds records three seats");
await until(nextEra + 20);
const f = await fin();
check(f > nextEra + 5, "GRANDPA finalises past the set change with three voters", `finalised #${f}`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`} at #${await head()}`);
await api.disconnect();
process.exit(fails ? 1 : 0);
