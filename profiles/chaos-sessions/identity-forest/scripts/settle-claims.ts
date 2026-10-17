/**
 * Seed claims, from the steward's side. The rules and the ledger are in
 * seed-claims.ts beside this file; the sign-in service settles ready
 * claims by itself whenever a member opens Profile. This is for looking and for
 * resolving objections.
 *
 *   bun run scripts/settle-claims.ts                       list every claim and its status
 *   bun run scripts/settle-claims.ts resolve <claimId> <objectionId> upheld|dismissed
 *   bun run scripts/settle-claims.ts settle                write ready claims into the Seeds, rebuild the forest
 *
 * Upheld means the objection is right and the claim fails. Dismissed means the
 * claim goes on; it settles once its window has closed and nothing else is open.
 */
import { join } from "node:path";
import { appendLedger, claimViews, readLedger, settle } from "./seed-claims.ts";

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "list") {
  const views = claimViews();
  if (!views.length) console.log("No claims yet.");
  for (const v of views) {
    const until = new Date(v.claim.opensUntil * 1000).toISOString().slice(0, 10);
    console.log(`${v.claim.id}  ${v.status.padEnd(9)}  ${v.claim.userId} → ${v.claim.slugs.join(", ")}  (${v.claim.account.slice(0, 10)}…, window closes ${until})`);
    for (const o of v.objections) console.log(`    objection ${o.id} by ${o.by}${o.resolved ? ` [${o.resolved}]` : ""}: ${o.reason}`);
  }
} else if (cmd === "resolve") {
  const [claimId, objectionId, outcome] = args;
  const v = claimViews().find((x) => x.claim.id === claimId);
  if (!v || !v.objections.some((o) => o.id === objectionId)) throw new Error("No such claim or objection.");
  if (outcome !== "upheld" && outcome !== "dismissed") throw new Error("Outcome is upheld or dismissed.");
  appendLedger({ event: "resolve", claimId, objectionId, outcome, by: process.env.USER || "steward" });
  console.log(`${objectionId} ${outcome}. Claim is now ${claimViews(readLedger()).find((x) => x.claim.id === claimId)!.status}.`);
} else if (cmd === "settle") {
  const done = settle();
  for (const v of done) console.log(`settled ${v.claim.slugs.join(", ")} → ${v.claim.account}`);
  if (done.length) {
    const proc = Bun.spawn(["bun", "run", "scripts/build.ts"], { cwd: join(import.meta.dir, ".."), stdout: "inherit", stderr: "inherit" });
    process.exit(await proc.exited);
  } else console.log("Nothing ready to settle.");
} else {
  console.error("usage: settle-claims.ts [list | resolve <claimId> <objectionId> upheld|dismissed | settle]");
  process.exit(1);
}
