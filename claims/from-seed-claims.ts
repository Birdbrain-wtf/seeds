// Reads a Seed-claims ledger (the chaos-sessions profile's `_claims.jsonl`, rows
// claim / objection / resolve / withdraw / settled) as claim events.
//
// Nothing is lost: the passkey assertion travels as `sig`, marked as signed over the
// profile's own canonical claim (seed-claim/v1) rather than over the event, and the
// account, slugs and app go in `ext`. A legacy `settled` row means the server wrote
// the account into the Seed files, which is an `apply`.

import type { Event } from "./claims";

export const SEED_CLAIM_RULE = {
  window: 7 * 86_400, confirm: false, vouches: 0, amend: { window: 7 * 86_400, vouches: 1 },
};

const iso = (unix: number) => new Date(unix * 1000).toISOString();

export function fromSeedClaims(rows: any[]): Event[] {
  const out: Event[] = [];
  rows.forEach((r, i) => {
    const claim = r.claim?.id ?? r.claimId;
    if (!claim || !r.at) return;
    const base = { v: 1 as const, id: r.id ?? `${claim}:${i}`, at: r.at, claim };
    switch (r.event) {
      case "claim": {
        const c = r.claim;
        out.push({
          ...base, act: "assert", by: c.userId,
          kind: "identity", profile: c.profile, subject: c.userId, relation: "is",
          target: `seed:${c.slugs[0]}`, until: iso(c.opensUntil),
          evidence: [{ what: "a passkey on chain as a device of the account claimed", ref: c.account }],
          sig: r.assertion ? { scheme: "webauthn", over: "seed-claim/v1", challenge: r.challenge, rp: r.rp, credential: r.credential, assertion: r.assertion } : undefined,
          ext: { app: c.app, collective: c.collective, slugs: c.slugs, account: c.account, accountHex: c.accountHex, iat: c.iat },
        });
        break;
      }
      case "objection":
        out.push({ ...base, act: "object", by: r.by, reason: r.reason ?? "" });
        break;
      case "resolve":
        out.push({ ...base, act: "resolve", by: r.by ?? "steward", objection: r.objectionId, outcome: r.outcome === "upheld" ? "upheld" : "dismissed" });
        break;
      case "withdraw":
        out.push({ ...base, act: "withdraw", by: r.by });
        break;
      case "settled":
        out.push({ ...base, act: "apply", by: "server", ext: { slugs: r.slugs, account: r.account, folded: r.folded } });
        break;
    }
  });
  return out;
}
