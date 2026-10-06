// Read a seed mark and look its record up on a seeds chain.
//
//   bun run verify.ts <mark.svg> [ws://127.0.0.1:9984]
//
// Anchored: the decoded 32 bytes are an account; print the chain's Members entry
// for it, or say plainly that there is none. Unanchored: there is nothing on chain
// to check, and the script says so instead of guessing. Exit 0 only for an
// anchored mark whose account is a member.

import { ApiPromise, WsProvider } from "@polkadot/api";
import { encodeAddress } from "@polkadot/util-crypto";
import { decodeSVG } from "./mark";

const [file, ws = "ws://127.0.0.1:9984"] = process.argv.slice(2);
if (!file) throw new Error("usage: bun run verify.ts <mark.svg> [ws://…]");

const { kind, payload, payloadHex } = decodeSVG(await Bun.file(file).text());
if (kind === "unanchored") {
  console.log(`unanchored ${payloadHex}\nThis Seed has no account yet. The mark is a stable placeholder and proves nothing on chain.`);
  process.exit(2);
}

const api = await ApiPromise.create({
  provider: new WsProvider(ws),
  noInitWarn: true,
  signedExtensions: { OnlyMembers: { extrinsic: {}, payload: {} } },
});
const who = encodeAddress(payload, 42);
const rec: any = await api.query.seeds.members(payload);
const head = (await api.rpc.chain.getFinalizedHead()).toHex();
if (rec.isNone) {
  console.log(`anchored ${payloadHex}\naccount ${who}\nNOT a member at finalised block ${head}`);
  await api.disconnect();
  process.exit(1);
}
const m = rec.unwrap();
console.log(
  [
    `anchored ${payloadHex}`,
    `account ${who}`,
    `member #${m.index.toNumber()} of community ${m.community.toString()}, admitted at block ${m.admittedAt.toNumber()}`,
    m.firstMember.isTrue ? "first member (genesis)" : `evidence ${m.evidence.toHex()} · witnesses ${m.witnesses.map((w: any) => w.toString()).join(", ")}`,
    `strikes ${m.strikes.toNumber()} · checked at finalised block ${head}`,
  ].join("\n"),
);
await api.disconnect();
process.exit(0);
