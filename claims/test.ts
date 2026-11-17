// Folds every ledger in vectors.json and checks the states.  bun run test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anchorDigest, anchorPayload, canonical, fold, may, openClaims, recordOf, RULES, type Event } from "./claims";

const V = JSON.parse(readFileSync(join(import.meta.dir, "vectors.json"), "utf8"));
let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { cond ? pass++ : (fail++, console.log(`FAIL ${msg}`)); };

for (const t of V.cases) {
  const got = fold(t.events as Event[], V.rules, Date.parse(t.now));
  ok(got.size === Object.keys(t.expect).length, `${t.name}: ${got.size} claims, expected ${Object.keys(t.expect).length}`);
  for (const [id, want] of Object.entries<any>(t.expect)) {
    const c = got.get(id);
    for (const [k, v] of Object.entries(want)) ok(!!c && (c as any)[k] === v, `${t.name}: ${id}.${k} = ${c && (c as any)[k]}, expected ${v}`);
  }
}

// Gates
const ev = (o: Partial<Event>) => ({ v: 1, id: Math.random().toString(36), at: "2026-10-01T12:00:00.000Z", ...o }) as Event;
const rules = { credit: RULES.witnessed };
const c = fold([ev({ claim: "c", act: "assert", by: "bob", kind: "credit", subject: "alice", relation: "Editor", target: "film:1" })], rules).get("c");
ok(!may("confirm", c, "bob", rules).ok, "asserter cannot confirm");
ok(!may("confirm", c, "carol", rules).ok, "only the person named confirms");
ok(may("confirm", c, "alice", rules).ok, "the person named confirms");
ok(!may("object", c, "bob", rules).ok, "asserter withdraws rather than objects");
ok(may("object", c, "carol", rules).ok, "any member may object");
ok(!may("amend", c, "carol", rules).ok, "an open claim is objected to, not amended");
ok(!may("anchor", c, "op", rules).ok, "an open claim never goes on chain");
ok(may("withdraw", c, "alice", rules).ok, "the person named may withdraw");
ok(!may("withdraw", c, "carol", rules).ok, "a bystander may not withdraw");

// What members see
ok(openClaims([c!]).length === 1, "an open claim is on the open list");
const r = recordOf([c!], "alice");
ok(r.aboutMe.length === 1 && r.waitingOnMe.length === 1 && r.made.length === 0, "alice's record shows the claim waiting on her");

// Canonical bytes and the anchor
ok(canonical({ b: 1, a: [2, { d: 3, c: undefined }] }) === '{"a":[2,{"d":3}],"b":1}', "canonical sorts keys and drops undefined");
let threw = false; try { anchorPayload(c!); } catch { threw = true; }
ok(threw, "an open claim has no anchor payload");
const s = fold([
  ev({ claim: "c", act: "assert", by: "bob", kind: "credit", subject: "alice", relation: "Editor", target: "film:1", id: "e1", evidence: [{ what: "call sheet" }], note: "private" }),
  ev({ claim: "c", act: "confirm", by: "alice", id: "e2" }),
  ev({ claim: "c", act: "vouch", by: "carol", id: "e3" }),
], rules).get("c")!;
const payload = anchorPayload(s);
ok(!payload.includes("call sheet") && !payload.includes("private"), "the anchor carries no evidence and no notes");
ok((await anchorDigest(s)).length === 64, "the anchor digest is 32 bytes");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
