#!/usr/bin/env bun
/**
 * build.ts — fold every collective's comment store into a participation graph.
 *
 * The participation graph is the naive-joining pattern ("participation is
 * membership") made explicit: every comment / reply / endorsement / mention is
 * an EDGE between seeds. Alerts (reply-to-me, mention-of-me) are just a query
 * over this graph — see the `by-seed` inbox rollup below.
 *
 * INPUT  — one JSONL per RFC/collective under the comment roots below. Each line
 *          is a comment record as written by chaos-auth's /rfc/comment/* handlers:
 *            { id, ts, rfc, kind:"comment", userId, displayName, credentialHash,
 *              seed?, custody?, ownerKeyHash?, body, replyTo?, mentions?,
 *              retracted? }
 *
 * OUTPUT — infra/state/participation/
 *            graph.json    — { nodes:[seed], edges:[...], generatedAt }
 *            by-seed.json   — per-seed inbox: what each seed AUTHORED and, more
 *                             importantly, what they RECEIVED (replies, mentions).
 *                             This is the alert source of truth.
 *
 * Deterministic + re-runnable. Read-only over the comment stores; writes only
 * its two output files. Retracted comments are excluded from edges.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.SEEDS_ROOT ?? ".";
// Comment stores. Add a collective by adding its comment dir here.
const COMMENT_ROOTS = [
  process.env.COMMENT_ROOT ?? join(ROOT, "comments"),
];
const OUT_DIR = process.env.PARTICIPATION_OUT ?? join(ROOT, "participation");
mkdirSync(OUT_DIR, { recursive: true });
const SEEDS_DIR = process.env.SEEDS_DIR ?? join(ROOT, "vault/seeds");

type Comment = {
  id?: string;
  ts: string;
  rfc: string;
  kind?: string;
  userId: string;
  displayName?: string;
  credentialHash?: string;
  seed?: string;        // on-chain Kreivo address
  custody?: string;
  ownerKeyHash?: string;
  body: string;
  replyTo?: string;     // parent comment id
  mentions?: string[];  // explicit, if the writer captured them
  retracted?: boolean;
};

type SeedNode = {
  userId: string;
  displayName: string;
  seed: string | null;       // on-chain address if self-custody
  custody: string;           // "self" | "unknown"
  credentialHash: string | null;
  firstSeen: string;
  lastSeen: string;
};

type Edge = {
  type: "authored" | "commented-on" | "replied-to" | "mentioned";
  from: string;              // seed userId (actor)
  to: string;                // target: comment id | rfc slug | seed userId
  toKind: "comment" | "rfc" | "seed";
  commentId: string;         // the utterance that created this edge
  rfc: string;
  ts: string;
};

// ── load every comment across every store ──────────────────────────────────
const all: Comment[] = [];
for (const root of COMMENT_ROOTS) {
  if (!existsSync(root)) continue;
  for (const f of readdirSync(root)) {
    if (!f.endsWith(".jsonl")) continue;
    const lines = readFileSync(join(root, f), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const r = JSON.parse(t) as Comment;
        if (r.kind && r.kind !== "comment") continue; // only comment-kind utterances
        all.push(r);
      } catch { /* skip malformed */ }
    }
  }
}

// Index by comment id (needed to resolve replyTo -> parent author).
const byId = new Map<string, Comment>();
for (const c of all) if (c.id) byId.set(c.id, c);

// ── known-seed alias table (for mention parsing) ───────────────────────────
// Aliases come from (a) userIds/displayNames seen in comments, and (b) the
// seeds/ registry. A mention only resolves to a real edge if it hits this table
// — we never invent a target.
const aliasToUser = new Map<string, string>();
function addAlias(alias: string, userId: string) {
  const a = alias.trim().toLowerCase();
  if (a) aliasToUser.set(a, userId);
}
for (const c of all) {
  addAlias(c.userId, c.userId);
  if (c.displayName) addAlias(c.displayName, c.userId);
}
// Enrich from seeds/*.md frontmatter (slug + aliases), mapped to their slug.
if (existsSync(SEEDS_DIR)) {
  for (const f of readdirSync(SEEDS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const src = readFileSync(join(SEEDS_DIR, f), "utf8");
    const slug = (src.match(/^slug:\s*(.+)$/m)?.[1] || "").trim();
    if (!slug) continue;
    addAlias(slug, slug);
    const aliasBlock = src.match(/aliases:\s*(\[[^\]]*\]|(?:\n\s*-\s*.+)+)/);
    if (aliasBlock) {
      for (const m of aliasBlock[1].matchAll(/[-\[,]\s*"?([A-Za-z0-9_\-]+)"?/g)) {
        addAlias(m[1], slug);
      }
    }
  }
}

// Parse @mentions from a body; return resolved userIds (deduped, excluding self).
function parseMentions(body: string, self: string, explicit?: string[]): string[] {
  const hits = new Set<string>();
  for (const e of explicit || []) {
    const u = aliasToUser.get(e.trim().toLowerCase());
    if (u) hits.add(u);
  }
  for (const m of body.matchAll(/@([A-Za-z0-9_\-]{2,32})/g)) {
    const u = aliasToUser.get(m[1].toLowerCase());
    if (u) hits.add(u);
  }
  hits.delete(self);
  return [...hits];
}

// ── build nodes + edges ────────────────────────────────────────────────────
const nodes = new Map<string, SeedNode>();
function touch(c: Comment) {
  const n = nodes.get(c.userId);
  if (!n) {
    nodes.set(c.userId, {
      userId: c.userId,
      displayName: c.displayName || c.userId,
      seed: c.seed || null,
      custody: c.custody || "unknown",
      credentialHash: c.credentialHash || null,
      firstSeen: c.ts,
      lastSeen: c.ts,
    });
  } else {
    if (c.ts < n.firstSeen) n.firstSeen = c.ts;
    if (c.ts > n.lastSeen) n.lastSeen = c.ts;
    if (c.seed && !n.seed) { n.seed = c.seed; n.custody = c.custody || n.custody; }
    if (c.displayName) n.displayName = c.displayName;
  }
}

const edges: Edge[] = [];
for (const c of all) {
  touch(c); // a retracted comment still proves the seed participated (membership), but writes no content edges
  if (c.retracted) continue;
  const cid = c.id || `${c.rfc}:${c.ts}`;

  edges.push({ type: "authored", from: c.userId, to: cid, toKind: "comment", commentId: cid, rfc: c.rfc, ts: c.ts });
  edges.push({ type: "commented-on", from: c.userId, to: c.rfc, toKind: "rfc", commentId: cid, rfc: c.rfc, ts: c.ts });

  if (c.replyTo) {
    const parent = byId.get(c.replyTo);
    if (parent && parent.userId !== c.userId) {
      edges.push({ type: "replied-to", from: c.userId, to: parent.userId, toKind: "seed", commentId: cid, rfc: c.rfc, ts: c.ts });
    }
  }
  for (const target of parseMentions(c.body, c.userId, c.mentions)) {
    edges.push({ type: "mentioned", from: c.userId, to: target, toKind: "seed", commentId: cid, rfc: c.rfc, ts: c.ts });
  }
}

// ── per-seed inbox rollup (the alert source of truth) ──────────────────────
type Inbox = {
  userId: string;
  displayName: string;
  seed: string | null;
  authored: number;
  commentedOn: string[];             // rfc slugs
  repliesReceived: { from: string; commentId: string; rfc: string; ts: string }[];
  mentionsReceived: { from: string; commentId: string; rfc: string; ts: string }[];
};
const inbox = new Map<string, Inbox>();
function ensureInbox(userId: string): Inbox {
  let i = inbox.get(userId);
  if (!i) {
    const n = nodes.get(userId);
    i = { userId, displayName: n?.displayName || userId, seed: n?.seed || null, authored: 0, commentedOn: [], repliesReceived: [], mentionsReceived: [] };
    inbox.set(userId, i);
  }
  return i;
}
for (const e of edges) {
  if (e.type === "authored") ensureInbox(e.from).authored++;
  if (e.type === "commented-on") { const i = ensureInbox(e.from); if (!i.commentedOn.includes(e.to)) i.commentedOn.push(e.to); }
  if (e.type === "replied-to") ensureInbox(e.to).repliesReceived.push({ from: e.from, commentId: e.commentId, rfc: e.rfc, ts: e.ts });
  if (e.type === "mentioned") ensureInbox(e.to).mentionsReceived.push({ from: e.from, commentId: e.commentId, rfc: e.rfc, ts: e.ts });
}

// ── write outputs ──────────────────────────────────────────────────────────
const generatedAt = new Date().toISOString();
writeFileSync(join(OUT_DIR, "graph.json"), JSON.stringify({
  generatedAt,
  nodes: [...nodes.values()].sort((a, b) => a.userId.localeCompare(b.userId)),
  edges: edges.sort((a, b) => a.ts.localeCompare(b.ts)),
}, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "by-seed.json"), JSON.stringify({
  generatedAt,
  seeds: [...inbox.values()].sort((a, b) => a.userId.localeCompare(b.userId)),
}, null, 2) + "\n");

// ── console summary ────────────────────────────────────────────────────────
const counts = edges.reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
console.log(`participation graph @ ${generatedAt}`);
console.log(`  seeds: ${nodes.size}  edges: ${edges.length}  ${JSON.stringify(counts)}`);
for (const i of inbox.values()) {
  const inbound = i.repliesReceived.length + i.mentionsReceived.length;
  if (inbound) console.log(`  → ${i.userId}: ${i.repliesReceived.length} replies, ${i.mentionsReceived.length} mentions received`);
}
console.log(`  wrote ${join(OUT_DIR, "graph.json")}`);
console.log(`  wrote ${join(OUT_DIR, "by-seed.json")}`);
