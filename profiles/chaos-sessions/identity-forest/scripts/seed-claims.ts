// Claiming a Seed: tying the Seed the vault already keeps about someone to an account
// that person holds, so their mark can change once from hollow to solid.
//
// A Seed (vault/seeds/<slug>.md) is the collective's witness record of a person, written
// from what happened in calls. Nobody signed it, so its `address` is null and its mark
// is the grey, hollow placeholder. A claim is how the person says "that Seed is me":
//
//   1. the app suggests the Seeds whose names match the member's handle and name
//   2. the member picks theirs and approves with ONE passkey tap. The tap signs the
//      claim itself (the challenge is its hash), and it has to be made with a passkey
//      that is on chain as a device of the account being claimed. So the tap proves
//      both "I am this member" and "I hold this account's key".
//   3. the claim stays open for CHALLENGE_DAYS. Any signed-in member can object.
//      An objection pauses it until a steward resolves it (settle-claims.ts resolve).
//   4. once the window closes with nothing open against it, settle() writes the
//      account into the Seed file and the forest is rebuilt. The mark is now fixed.
//
// Only an account whose key the member holds can be anchored. That is a Kreivo Pass
// account with one of the member's passkeys on chain as its device (the sign-in service's
// self-custody index). The server's own //<collective>//<handle> account is
// never anchored: if the member later moved to a key of their own, the mark would
// have to change twice, and the rule is that it changes once.
//
// Ledger: vault/seeds/_claims.jsonl, append-only. Rows: claim, objection,
// withdraw, resolve, settled. Anyone holding the credential's public key can re-check
// a claim's assertion without trusting this server.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { accountBytes, markSVG, unanchoredPayload } from "../../../../mark/mark.ts";

export const SEEDS_DIR = process.env.SEEDS_DIR || join(process.env.SEEDS_ROOT ?? ".", "vault/seeds");
export const CLAIMS_FILE = process.env.SEED_CLAIMS_FILE || join(SEEDS_DIR, "_claims.jsonl");
export const PROFILE = "chaos-sessions";
export const CHALLENGE_DAYS = 7;
export const FOREST_URL = "https://birdbrain.wtf/seeds/forest";

// ── Seeds ─────────────────────────────────────────────────────────────────

export interface SeedRecord {
  slug: string;
  name: string;
  aliases: string[];
  address: string;
  sameAs: string;
  sessions: number;
}

function frontmatter(raw: string): string | null {
  return raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? null;
}
function scalar(fm: string, k: string): string {
  const m = fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
}
function list(fm: string, k: string): string[] {
  const m = fm.match(new RegExp(`^${k}:[ \\t]*(.*)\\n((?:[ \\t]*-[ \\t]*.*\\n?)*)`, "m"));
  if (!m) return [];
  const inline = m[1].trim();
  if (inline === "[]" || inline === "null") return [];
  if (inline) return [inline];
  return (m[2] || "").split("\n").map((l) => l.replace(/^[ \t]*-[ \t]*/, "").trim()).filter(Boolean);
}

export function readSeeds(dir = SEEDS_DIR): SeedRecord[] {
  if (!existsSync(dir)) return [];
  const out: SeedRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const fm = frontmatter(readFileSync(join(dir, f), "utf8"));
    if (!fm || scalar(fm, "type") !== "seed") continue;
    const address = scalar(fm, "address");
    out.push({
      slug: scalar(fm, "slug") || f.replace(/\.md$/, ""),
      name: scalar(fm, "display_name") || f.replace(/\.md$/, ""),
      aliases: list(fm, "aliases"),
      address: address === "null" ? "" : address,
      sameAs: scalar(fm, "same_as"),
      sessions: list(fm, "sessions_attended").length,
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

const tokens = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length > 1);

/**
 * Seeds whose names share a word with the member's handle or display name. A
 * suggestion only: the member says which are theirs, and others can object.
 * Placeholder Seeds ("unknown", "anon") never match.
 */
export function suggest(seeds: SeedRecord[], userId: string, displayName: string): SeedRecord[] {
  const mine = new Set([...tokens(userId), ...tokens(displayName)]);
  const whole = userId.toLowerCase();
  const scored = seeds
    .filter((s) => !/^(unknown|anon)/.test(s.slug) && !s.sameAs)
    .map((s) => {
      const theirs = new Set([...tokens(s.slug), ...tokens(s.name), ...s.aliases.flatMap(tokens)]);
      let score = 0;
      for (const t of mine) if (theirs.has(t)) score += t.length > 2 ? 2 : 1;
      if (s.slug === whole) score += 5;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.sessions - a.s.sessions || a.s.slug.localeCompare(b.s.slug));
  return scored.slice(0, 8).map((x) => x.s);
}

// ── Marks ─────────────────────────────────────────────────────────────────

export function anchoredMark(address: string, label: string, size = 120): string {
  return markSVG({ kind: "anchored", payload: accountBytes(address), size, label });
}
export function hollowMark(slug: string, label: string, size = 120): string {
  return markSVG({ kind: "unanchored", payload: unanchoredPayload(PROFILE, slug), size, label });
}

// ── The claim and its ledger ──────────────────────────────────────────────

export interface Claim {
  v: 1;
  kind: "seed-claim";
  id: string;
  userId: string;
  app: string;
  collective: string;
  profile: string;
  /** The Seeds this member says are them. The first is the one the others fold into. */
  slugs: string[];
  /** SS58, as the chain's device index has it. */
  account: string;
  accountHex: string;
  iat: number;
  /** End of the challenge window, unix seconds. */
  opensUntil: number;
}

export const canonicalClaim = (c: Claim) =>
  JSON.stringify({
    v: c.v, kind: c.kind, id: c.id, userId: c.userId, app: c.app, collective: c.collective, profile: c.profile,
    slugs: c.slugs, account: c.account, accountHex: c.accountHex, iat: c.iat, opensUntil: c.opensUntil,
  });

export type Status = "open" | "disputed" | "ready" | "settled" | "rejected" | "withdrawn";

export interface ClaimView {
  claim: Claim;
  status: Status;
  objections: { id: string; by: string; reason: string; at: string; resolved?: "upheld" | "dismissed" }[];
  settledAt?: string;
}

export function readLedger(file = CLAIMS_FILE): any[] {
  if (!existsSync(file)) return [];
  const rows: any[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}

export function appendLedger(row: Record<string, unknown>, file = CLAIMS_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
}

export function claimViews(rows = readLedger(), now = Math.floor(Date.now() / 1000)): ClaimView[] {
  const views = new Map<string, ClaimView & { withdrawn?: boolean }>();
  for (const r of rows) {
    if (r.event === "claim" && r.claim?.id) views.set(r.claim.id, { claim: r.claim, status: "open", objections: [] });
    const v = views.get(r.claimId);
    if (!v) continue;
    if (r.event === "objection") v.objections.push({ id: r.id, by: r.by, reason: r.reason, at: r.at });
    if (r.event === "resolve") {
      const o = v.objections.find((x) => x.id === r.objectionId);
      if (o) o.resolved = r.outcome;
    }
    if (r.event === "withdraw") v.withdrawn = true;
    if (r.event === "settled") v.settledAt = r.at;
  }
  for (const v of views.values()) {
    if (v.settledAt) v.status = "settled";
    else if (v.objections.some((o) => o.resolved === "upheld")) v.status = "rejected";
    else if (v.withdrawn) v.status = "withdrawn";
    else if (v.objections.some((o) => !o.resolved)) v.status = "disputed";
    else v.status = now >= v.claim.opensUntil ? "ready" : "open";
    delete v.withdrawn;
  }
  return [...views.values()];
}

/** A claim that still holds a Seed: nobody else may claim it meanwhile. */
export const holds = (s: Status) => s === "open" || s === "disputed" || s === "ready" || s === "settled";

// ── Settling ──────────────────────────────────────────────────────────────

function setFrontmatter(raw: string, values: Record<string, string>): string {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return raw;
  let fm = m[1];
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}: ${v}`;
    const re = new RegExp(`^${k}:[ \\t]*.*$`, "m");
    fm = re.test(fm) ? fm.replace(re, line) : `${fm}\n${line}`;
  }
  return `---\n${fm}\n---` + raw.slice(m[0].length);
}

/**
 * Write every claim whose window has closed cleanly into its Seed files, once.
 * Returns the claims settled this call. The caller rebuilds the forest.
 */
export function settle(opts: { dir?: string; file?: string; now?: number } = {}): ClaimView[] {
  const dir = opts.dir ?? SEEDS_DIR;
  const file = opts.file ?? join(dir, "_claims.jsonl");
  const done: ClaimView[] = [];
  for (const v of claimViews(readLedger(file), opts.now)) {
    if (v.status !== "ready") continue;
    const [primary, ...rest] = v.claim.slugs;
    for (const slug of v.claim.slugs) {
      const path = join(dir, `${slug}.md`);
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const fm = frontmatter(raw);
      const have = fm ? scalar(fm, "address") : "";
      // A Seed that already carries a different account is never overwritten.
      if (have && have !== "null" && have !== v.claim.account) continue;
      const next = setFrontmatter(raw, {
        address: v.claim.account,
        status: "claimed",
        claim_id: v.claim.id,
        ...(slug === primary ? {} : { same_as: primary }),
      });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, next);
      renameSync(tmp, path);
    }
    appendLedger({ event: "settled", claimId: v.claim.id, slugs: v.claim.slugs, account: v.claim.account, folded: rest }, file);
    done.push(v);
  }
  return done;
}
