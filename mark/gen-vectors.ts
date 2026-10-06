import { unanchoredPayload, check, toHex } from "./mark";
// Alice and Bob's well-known dev public keys (sr25519 //Alice, //Bob)
const anchored = [
  { name: "dev-alice", account: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d" },
  { name: "dev-bob", account: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48" },
];
const un = [{ name: "alice-unanchored", profile: "chaos-sessions", slug: "alice" }, { name: "bob-unanchored", profile: "chaos-sessions", slug: "bob" }];
const vectors = [
  ...anchored.map((a) => { const p = Buffer.from(a.account.slice(2), "hex"); return { ...a, kind: "anchored", payload: a.account, check: check("anchored", p).toString(16).padStart(4, "0") }; }),
  ...un.map((u) => { const p = unanchoredPayload(u.profile, u.slug); return { ...u, kind: "unanchored", payload: toHex(p), check: check("unanchored", p).toString(16).padStart(4, "0") }; }),
];
await Bun.write(new URL("./vectors.json", import.meta.url).pathname, JSON.stringify({ version: "seed-mark/v1", vectors }, null, 2) + "\n");
console.log(vectors);
