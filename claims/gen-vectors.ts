// Writes vectors.json: ledgers and the states any implementation must fold them to.
// The expected answers are written here by hand, never computed by claims.ts, so the
// vectors check the code rather than echo it.  bun run gen-vectors.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const D = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
let n = 0;
const ev = (day: number, claim: string, act: string, by: string, extra: Record<string, unknown> = {}) =>
  ({ v: 1, id: `e${++n}`, at: D(day), claim, act, by, ...extra });

const seed = (day: number, claim: string, by: string, extra = {}) =>
  ev(day, claim, "assert", by, { kind: "identity", profile: "example", subject: by, relation: "is", target: "seed:alice", ...extra });
const credit = (day: number, claim: string, by: string, subject: string, extra = {}) =>
  ev(day, claim, "assert", by, { kind: "credit", profile: "example", subject, relation: "Camera Operator", target: "film:1", ...extra });

const rules = {
  "example/identity": { window: 7 * 86400, confirm: false, vouches: 0, amend: { window: 7 * 86400, vouches: 1 } },
  "example/credit": { window: 0, confirm: true, vouches: 1, amend: { window: 7 * 86400, vouches: 2 } },
};

const cases: { name: string; now: string; events: any[]; expect: Record<string, { state: string; waiting?: string | null; settledAt?: string; supersededBy?: string }> }[] = [];
const add = (name: string, now: string, events: any[], expect: (typeof cases)[number]["expect"]) => cases.push({ name, now, events, expect });

// Optimistic
add("an identity claim inside its window is open", D(5), [seed(1, "a", "alice")], { a: { state: "open", waiting: "window" } });
add("it settles when the window closes with nothing against it", D(9), [seed(1, "a", "alice")], { a: { state: "settled", waiting: null, settledAt: D(8) } });
add("an objection pauses it", D(9), [seed(1, "a", "alice"), ev(3, "a", "object", "bob", { reason: "that Seed is Carol" })], { a: { state: "disputed", waiting: "objection" } });
{
  const o = ev(3, "a", "object", "bob", { reason: "that Seed is Carol" });
  add("an upheld objection rejects it", D(9), [seed(1, "a", "alice"), o, ev(4, "a", "resolve", "steward", { objection: o.id, outcome: "upheld" })], { a: { state: "rejected", waiting: null } });
}
{
  const o = ev(3, "a", "object", "bob", { reason: "unsure" });
  add("a dismissed objection lets the window run on", D(9), [seed(1, "a", "alice"), o, ev(4, "a", "resolve", "steward", { objection: o.id, outcome: "dismissed" })], { a: { state: "settled", settledAt: D(8) } });
}
add("an objection after the window closed is too late", D(12), [seed(1, "a", "alice"), ev(10, "a", "object", "bob", { reason: "late" })], { a: { state: "settled", settledAt: D(8) } });
add("withdrawing inside the window ends it", D(9), [seed(1, "a", "alice"), ev(2, "a", "withdraw", "alice")], { a: { state: "withdrawn", waiting: null } });
add("withdrawing after it settled changes nothing", D(12), [seed(1, "a", "alice"), ev(10, "a", "withdraw", "alice")], { a: { state: "settled" } });
add("a claimant may lengthen the window, never shorten it", D(9), [seed(1, "a", "alice", { until: D(2) }), seed(1, "b", "bob", { until: D(10) })], { a: { state: "settled", settledAt: D(8) }, b: { state: "open", waiting: "window" } });
add("a withdrawn claim can be said again and starts over", D(9), [seed(1, "a", "alice"), ev(2, "a", "withdraw", "alice"), seed(5, "a", "alice")], { a: { state: "open", waiting: "window" } });

// Witnessed
add("a credit waits for the person named", D(9), [credit(1, "c", "bob", "alice")], { c: { state: "open", waiting: "confirm" } });
add("then for a third person", D(9), [credit(1, "c", "bob", "alice"), ev(2, "c", "confirm", "alice")], { c: { state: "open", waiting: "vouches" } });
add("it settles on the vouch", D(9), [credit(1, "c", "bob", "alice"), ev(2, "c", "confirm", "alice"), ev(3, "c", "vouch", "carol")], { c: { state: "settled", settledAt: D(3) } });
add("a vouch from the asserter or the confirmer does not count", D(9), [credit(1, "c", "bob", "alice"), ev(2, "c", "confirm", "alice"), ev(3, "c", "vouch", "bob"), ev(3, "c", "vouch", "alice")], { c: { state: "open", waiting: "vouches" } });
add("a self-credit is confirmed by someone else", D(9), [credit(1, "c", "alice", "alice"), ev(2, "c", "confirm", "bob"), ev(3, "c", "vouch", "carol")], { c: { state: "settled" } });
add("a blank role has nobody to confirm", D(9), [credit(1, "c", "bob", ""), ev(2, "c", "vouch", "carol")], { c: { state: "settled" } });
add("an objection after a credit settled is too late", D(9), [credit(1, "c", "bob", "alice"), ev(2, "c", "confirm", "alice"), ev(3, "c", "vouch", "carol"), ev(4, "c", "object", "dave", { reason: "no" })], { c: { state: "settled" } });

// Corrections
{
  const base = [credit(1, "c", "bob", "alice"), ev(2, "c", "confirm", "alice"), ev(3, "c", "vouch", "carol")];
  const amend = ev(4, "d", "amend", "dave", { kind: "credit", profile: "example", subject: "erin", relation: "Camera Operator", target: "film:1", supersedes: "c", reason: "the call sheet says Erin" });
  add("a correction waits its window and twice the vouches", D(20), [...base, amend, ev(5, "d", "confirm", "erin"), ev(6, "d", "vouch", "carol")], { c: { state: "settled" }, d: { state: "open", waiting: "vouches" } });
  add("a settled correction supersedes the old claim", D(20), [...base, amend, ev(5, "d", "confirm", "erin"), ev(6, "d", "vouch", "carol"), ev(6, "d", "vouch", "frank")], { c: { state: "superseded", supersededBy: "d" }, d: { state: "settled", settledAt: D(11) } });
  add("a correction inside its window leaves the old claim standing", D(8), [...base, amend, ev(5, "d", "confirm", "erin"), ev(6, "d", "vouch", "carol"), ev(6, "d", "vouch", "frank")], { c: { state: "settled" }, d: { state: "open", waiting: "window" } });
}

// Ledger hygiene
add("events about no claim are ignored", D(9), [ev(1, "zz", "vouch", "bob")], {});
add("file order breaks ties at the same instant", D(9), [credit(1, "c", "bob", "alice"), ev(2, "c", "confirm", "alice"), ev(2, "c", "vouch", "carol")], { c: { state: "settled", settledAt: D(2) } });

writeFileSync(join(import.meta.dir, "vectors.json"), JSON.stringify({ version: 1, rules, cases }, null, 1) + "\n");
console.log(`${cases.length} cases`);
