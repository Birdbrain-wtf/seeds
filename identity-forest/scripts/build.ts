#!/usr/bin/env bun
/**
 * build.ts — the Identity Forest: a deterministic, zero-trust render of Birdbrain's
 * Seeds as a web of relationships.
 *
 * DESIGN: a bioluminescent night forest. Each Seed (a person's witnessed
 * contribution profile) grows as a luminous seedling on dark ground: leaves =
 * topics they've contributed to (leaf length = how much), the bright core =
 * presence, gold motes = open action items, solidity = confidence. Seedlings
 * are bound by CO-ATTENDANCE — two people who sat in the same Chaos Session
 * share a glowing thread, weighted by how many sessions they shared. The
 * threads ARE the web of relationships the Seeds thesis is about.
 *
 * TRUST POSTURE: zero-trust. Pure, deterministic function of PUBLIC Seed data in
 * vault/seeds/*.md. No keys, no network, no model, no randomness (all "jitter"
 * is seeded from the slug so a given corpus always renders identically). See
 * core/state/decisions/0016-seeds-trust-model-and-open-source.md.
 *
 * INPUT  — vault/seeds/*.md (frontmatter: slug, display_name, confidence,
 *          action_item_count, sessions_attended[], sessions_mentioned_in[];
 *          body: "## Topic profile" lines `- \`topic\` (N sessions)`).
 * OUTPUT — identity-forest/out/
 *            forest.json          — nodes (+ derived genome) and co-attendance edges
 *            organisms/<slug>.svg — one luminous seedling per Seed (transparent bg)
 *            forest.svg           — the full night-forest poster (self-contained)
 *            index.html           — the living page (see page.ts)
 *
 * Deterministic + re-runnable. Read-only over the vault; writes only under out/.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pageHTML, type PNode, type PEdge } from "./page";

const ROOT = process.env.SEEDS_ROOT ?? ".";
const SEEDS_DIR = process.env.SEEDS_DIR ?? join(ROOT, "vault/seeds");
const OUT = join(import.meta.dir, "..", "out");

// ---------- deterministic helpers (no Math.random) ----------
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
// seeded [0,1) generator from a string
function rng(seedStr: string) {
  let s = fnv1a(seedStr) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 0xffffffff;
  };
}
const CONF_SOLIDITY: Record<string, number> = { high: 1, medium: 0.66, low: 0.38 };

// ---------- parse a Seed ----------
type Topic = { topic: string; sessions: number };
type Seed = {
  slug: string;
  name: string;
  confidence: string;
  actionItems: number;
  attended: string[];
  mentioned: string[];
  topics: Topic[];
};

function parseSeed(file: string): Seed | null {
  const raw = readFileSync(join(SEEDS_DIR, file), "utf8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  const scalar = (k: string) => {
    const m = fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
  };
  const list = (k: string): string[] => {
    // capture the block after `k:` up to the next top-level key.
    // NB [ \t]* not \s* on the key line — \s* would swallow the newline and grab
    // the first list item (or the next key) as an inline value.
    const re = new RegExp(`^${k}:[ \\t]*(.*)\\n((?:[ \\t]*-[ \\t]*.*\\n?)*)`, "m");
    const m = fm.match(re);
    if (!m) return [];
    const inline = m[1].trim();
    if (inline && inline !== "[]" && inline !== "null") return [inline];
    return (m[2] || "")
      .split("\n")
      .map((l) => l.replace(/^[ \t]*-[ \t]*/, "").trim())
      .filter(Boolean);
  };

  const slug = scalar("slug") || file.replace(/\.md$/, "");
  const topics: Topic[] = [];
  const tp = body.match(/##\s*Topic profile\s*\n([\s\S]*?)(?:\n##\s|\n---|\s*$)/);
  if (tp) {
    for (const line of tp[1].split("\n")) {
      const m = line.match(/-\s*`([^`]+)`\s*\((\d+)\s*sessions?\)/);
      if (m) topics.push({ topic: m[1], sessions: parseInt(m[2], 10) });
    }
  }

  return {
    slug,
    name: scalar("display_name") || slug,
    confidence: scalar("confidence") || "low",
    actionItems: parseInt(scalar("action_item_count") || "0", 10) || 0,
    attended: list("sessions_attended"),
    mentioned: list("sessions_mentioned_in"),
    topics,
  };
}

// ---------- shared luminous geometry ----------
// These formulas are mirrored in page.ts's client draw code — keep in sync.
function hueForTopic(t: string): number { return fnv1a("topic:" + t) % 360; }

function mixHue(h1: number, h2: number): number {
  const d = ((h2 - h1 + 540) % 360) - 180;
  return (h1 + d / 2 + 360) % 360;
}

// leaf fan: centre leaf points up, then alternate right/left, per-slug wobble
function leafAngleDeg(i: number, T: number, rot: number): number {
  const k = Math.ceil(i / 2);
  const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1;
  const spread = Math.min(32, 150 / Math.max(1, T));
  const wob = ((rot * 57.2958) % 14) - 7;
  return -90 + side * k * spread + wob;
}
function leafLen(sessions: number, maxT: number, att: number): number {
  return 18 + (sessions / maxT) * (34 + Math.sqrt(att) * 9);
}
// each plant is dominantly ONE colour (its aura); topics drift the hue only subtly
function leafHue(aura: number, topicHue: number): number {
  const d = ((topicHue - aura + 540) % 360) - 180;
  const drift = Math.max(-14, Math.min(14, d * 0.22));
  return (aura + drift + 360) % 360;
}
// deterministic per-leaf character: length variance + sideways curl
function leafVar(hue: number, i: number): number { return (((hue * 7) + (i * 13)) % 20) / 20; }
const MAX_LEAVES = 6;

type Sprout = {
  rot: number; att: number; ai: number; sol: number; aura: number;
  topics: { topic: string; sessions: number; hue: number }[];
};

// one luminous seedling, base at (0,0), leaves rising into -y.
// haloId must reference a radialGradient defined by the caller.
function seedlingParts(o: Sprout, haloId: string): { parts: string; height: number } {
  const P: string[] = [];
  const ts = [...o.topics].sort((a, b) => b.sessions - a.sessions).slice(0, MAX_LEAVES);
  const T = ts.length;
  const maxT = Math.max(1, ...ts.map((t) => t.sessions));
  const L0 = T ? leafLen(ts[0].sessions, maxT, o.att) : 22;

  if (o.att === 0 && T === 0) {
    // faint in the record — a dotted promise of a plant, never faked
    P.push(
      `<circle r="14" fill="none" stroke="#d8d2c2" stroke-width="1" stroke-dasharray="2 5" opacity="0.35"/>`,
      `<circle r="2" fill="#d8d2c2" opacity="0.5"/>`
    );
    return { parts: P.join(""), height: 20 };
  }

  // presence halo — the pool of light this person casts
  const haloR = (30 + Math.sqrt(o.att) * 11) * (T ? 1 : 0.62);
  P.push(`<circle cx="0" cy="${(-L0 * 0.35).toFixed(1)}" r="${haloR.toFixed(1)}" fill="url(#${haloId})"/>`);

  // roots — dim gold tendrils reaching into the soil
  for (let r = 0; r < 3; r++) {
    const a = (90 + (r - 1) * 34 + (((o.rot * 57.2958) % 10) - 5)) * (Math.PI / 180);
    const len = 8 + Math.sqrt(o.att) * 3;
    const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
    const mx = Math.cos(a + 0.35) * len * 0.55, my = Math.sin(a + 0.35) * len * 0.55;
    P.push(
      `<path d="M0 1 Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="#c9a86a" stroke-width="0.8" stroke-linecap="round" opacity="0.30"/>`
    );
  }

  // leaves — one per topic: a thin stem rising from the base with a luminous
  // teardrop blade at its end (stem is what makes it read as a plant)
  ts.forEach((t, i) => {
    const ang = leafAngleDeg(i, T, o.rot);
    const fr = leafVar(t.hue, i);
    const L = leafLen(t.sessions, maxT, o.att) * (0.78 + 0.44 * fr);
    const bend = L * 0.24 * (i % 2 ? -1 : 1) * (0.4 + fr);
    const lh = leafHue(o.aura, t.hue);
    const fillOp = (0.5 + 0.35 * o.sol).toFixed(2);
    const rimOp = (0.6 + 0.3 * o.sol).toFixed(2);
    const bx = bend * 0.45, by = -L * 0.42;           // blade base (top of stem)
    const tx = bend, ty = -L;                          // blade tip
    const Wd = L * 0.58 * 0.42;                        // blade half-belly
    const lc1 = `${(bx - Wd * 0.62).toFixed(1)} ${(-L * 0.58).toFixed(1)}`;
    const lc2 = `${(bx + bend * 0.25 - Wd * 0.35).toFixed(1)} ${(-L * 0.86).toFixed(1)}`;
    const rc2 = `${(bx + bend * 0.25 + Wd * 0.35).toFixed(1)} ${(-L * 0.86).toFixed(1)}`;
    const rc1 = `${(bx + Wd * 0.62).toFixed(1)} ${(-L * 0.58).toFixed(1)}`;
    P.push(
      `<g transform="rotate(${(ang + 90).toFixed(1)})">` +
        `<path d="M0 0 Q${(bend * 0.2).toFixed(1)} ${(-L * 0.24).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}" fill="none" stroke="hsl(${lh} 70% 60%)" stroke-width="1.1" stroke-linecap="round" opacity="${(0.5 + 0.35 * o.sol).toFixed(2)}"/>` +
        `<path d="M${bx.toFixed(1)} ${by.toFixed(1)} C${lc1}, ${lc2}, ${tx.toFixed(1)} ${ty.toFixed(1)} C${rc2}, ${rc1}, ${bx.toFixed(1)} ${by.toFixed(1)} Z" fill="hsl(${lh} 80% 58%)" fill-opacity="${fillOp}" stroke="hsl(${lh} 95% 72%)" stroke-width="0.9" stroke-opacity="${rimOp}"/>` +
        `<path d="M${bx.toFixed(1)} ${by.toFixed(1)} Q${(bx + bend * 0.3).toFixed(1)} ${(-L * 0.7).toFixed(1)} ${(tx * 0.96).toFixed(1)} ${(ty * 0.97).toFixed(1)}" fill="none" stroke="hsl(${lh} 45% 88%)" stroke-width="0.7" opacity="0.5"/>` +
      `</g>`
    );
  });

  // open intentions — gold motes drifting near the plant
  for (let i = 0; i < o.ai; i++) {
    const a = o.rot * 1.7 + (i / Math.max(1, o.ai)) * Math.PI * 2;
    const rr = 10 + Math.sqrt(o.att) * 4;
    P.push(
      `<circle cx="${(Math.cos(a) * rr).toFixed(1)}" cy="${(Math.sin(a) * rr * 0.7 - L0 * 0.4).toFixed(1)}" r="1.8" fill="#ffd777" opacity="0.9"/>`
    );
  }

  // the core — presence made light
  const cr = 2.6 + Math.sqrt(o.att) * 1.1;
  P.push(
    `<circle r="${(cr * 2.1).toFixed(1)}" fill="hsl(${o.aura} 90% 62%)" opacity="${(0.5 * o.sol + 0.15).toFixed(2)}" filter="url(#bloom)"/>`,
    `<circle r="${cr.toFixed(1)}" fill="#fff6e4" opacity="${(0.55 + 0.45 * o.sol).toFixed(2)}"/>`
  );

  return { parts: P.join(""), height: L0 };
}

function haloGradient(id: string, hue: number): string {
  return `<radialGradient id="${id}"><stop offset="0%" stop-color="hsl(${hue} 92% 70%)" stop-opacity="0.5"/><stop offset="40%" stop-color="hsl(${hue} 85% 55%)" stop-opacity="0.15"/><stop offset="100%" stop-color="hsl(${hue} 85% 55%)" stop-opacity="0"/></radialGradient>`;
}
const BLOOM_FILTER = `<filter id="bloom" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="4"/></filter>`;

function sproutOf(seed: Seed): Sprout {
  const topics = seed.topics.map((t) => ({ topic: t.topic, sessions: t.sessions, hue: hueForTopic(t.topic) }));
  const main = [...topics].sort((a, b) => b.sessions - a.sessions)[0];
  return {
    rot: rng(seed.slug)() * Math.PI * 2,
    att: seed.attended.length,
    ai: seed.actionItems,
    sol: CONF_SOLIDITY[seed.confidence] ?? 0.4,
    aura: main ? main.hue : 45,
    topics,
  };
}

// standalone per-person organism (transparent bg — composes on any dark ground)
function organismSVG(seed: Seed, size = 220): string {
  const o = sproutOf(seed);
  const { parts } = seedlingParts(o, "halo");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs>${BLOOM_FILTER}${haloGradient("halo", o.aura)}</defs><g transform="translate(${size / 2} ${size * 0.68})">${parts}</g></svg>`;
}

// ---------- topical depth (the third dimension) ----------
// Deterministic spectral-ish embedding of the person↔topic structure: people
// who carry similar threads of thought get similar depth. Power iteration on
// the (implicit) cosine-similarity matrix from a slug-seeded start vector —
// fully deterministic, no randomness. Rank-spread to [-1,1] for legibility;
// seeds with no recorded topics sink to the back (deep = far away in the record).
function topicalDepth(seeds: Seed[]): number[] {
  const n = seeds.length;
  const vecs = seeds.map((s) => {
    const m = new Map<string, number>();
    for (const t of s.topics) m.set(t.topic, t.sessions);
    const norm = Math.sqrt([...m.values()].reduce((a, v) => a + v * v, 0)) || 1;
    for (const [k, v] of m) m.set(k, v / norm);
    return m;
  });
  const sim = (a: number, b: number) => {
    let d = 0;
    for (const [k, v] of vecs[a]) { const w = vecs[b].get(k); if (w) d += v * w; }
    return d;
  };
  let x = seeds.map((s) => ((fnv1a("depth:" + s.slug) % 1000) / 1000) - 0.5);
  for (let it = 0; it < 80; it++) {
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) y[i] += sim(i, j) * x[j];
    const mean = y.reduce((a, v) => a + v, 0) / n;
    let norm = 0;
    for (let i = 0; i < n; i++) { y[i] -= mean; norm += y[i] * y[i]; }
    norm = Math.sqrt(norm) || 1;
    x = y.map((v) => v / norm);
  }
  const withTopics = seeds.map((_, i) => i).filter((i) => seeds[i].topics.length > 0)
    .sort((a, b) => x[a] - x[b] || seeds[a].slug.localeCompare(seeds[b].slug));
  const out = new Array(n).fill(1); // faint in the record → deepest
  withTopics.forEach((i, k) => { out[i] = withTopics.length > 1 ? (k / (withTopics.length - 1)) * 2 - 1 : 0; });
  return out;
}

// ---------- the fourth dimension: session order ----------
// All session ids across the corpus (CSnn), numerically ordered — time's arrow.
function sessionTimeline(seeds: Seed[]): string[] {
  const ids = new Set<string>();
  for (const s of seeds) for (const id of s.attended) ids.add(id);
  const num = (id: string) => { const m = id.match(/(\d+)/); return m ? parseInt(m[1], 10) : Infinity; };
  return [...ids].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}

// ---------- co-attendance edges ----------
function coAttendance(seeds: Seed[]) {
  const edges: { a: number; b: number; shared: number }[] = [];
  for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      const A = new Set(seeds[i].attended);
      let shared = 0;
      for (const s of seeds[j].attended) if (A.has(s)) shared++;
      if (shared > 0) edges.push({ a: i, b: j, shared });
    }
  }
  return edges;
}

// ---------- layout (shared by static poster + interactive page) ----------
const W = 1600, H = 1040;
function layout(seeds: Seed[]): Record<number, { x: number; y: number }> {
  // spiral sits right-of-centre so the poster panel breathes on the left
  const cx = W * 0.5875, cy = H / 2;
  // sunflower spiral: most-present seeds toward the centre
  const order = seeds.map((_, i) => i).sort((p, q) => seeds[q].attended.length - seeds[p].attended.length);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const spacing = 70;
  const pos: Record<number, { x: number; y: number }> = {};
  order.forEach((idx, k) => {
    const r = spacing * Math.sqrt(k + 0.5);
    const th = k * GOLDEN;
    pos[idx] = { x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) };
  });
  return pos;
}

// deterministic edge curvature: how a thread bows between two people
function curveOff(a: number, b: number): number {
  return ((a * 7919 + b * 104729) % 1000) / 1000 - 0.5;
}
function edgePath(p: { x: number; y: number }, q: { x: number; y: number }, a: number, b: number) {
  const dx = q.x - p.x, dy = q.y - p.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / dist, ny = dx / dist;
  const off = curveOff(a, b) * 0.56 * dist;
  const cx = (p.x + q.x) / 2 + nx * off, cy = (p.y + q.y) / 2 + ny * off;
  return { cx, cy, d: `M${p.x.toFixed(1)} ${p.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}` };
}
function quadPoint(p: { x: number; y: number }, c: { x: number; y: number }, q: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * p.x + 2 * u * t * c.x + t * t * q.x, y: u * u * p.y + 2 * u * t * c.y + t * t * q.y };
}

// ---------- the night-forest poster ----------
function forestSVG(
  seeds: Seed[],
  sprouts: Sprout[],
  edges: { a: number; b: number; shared: number }[],
  pos: Record<number, { x: number; y: number }>
) {
  const maxShared = Math.max(1, ...edges.map((e) => e.shared));
  const defs: string[] = [BLOOM_FILTER, `<filter id="soften" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="26"/></filter>`];
  defs.push(
    `<radialGradient id="bg" cx="60%" cy="45%" r="78%"><stop offset="0%" stop-color="#0c1206"/><stop offset="55%" stop-color="#070a04"/><stop offset="100%" stop-color="#030402"/></radialGradient>`
  );
  sprouts.forEach((o, i) => defs.push(haloGradient(`h${i}`, o.aura)));

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  // dark foliage breathing at the edges
  const foliage = [
    [60, 990, 300, 120], [1520, 80, 260, 110], [1560, 980, 300, 130], [120, 60, 240, 100],
  ];
  for (const [fx, fy, frx, fry] of foliage) {
    parts.push(`<ellipse cx="${fx}" cy="${fy}" rx="${frx}" ry="${fry}" fill="#0b1405" opacity="0.55" filter="url(#soften)"/>`);
  }

  // threads first — the web of relationships, glowing
  for (const e of edges) {
    const p = pos[e.a], q = pos[e.b];
    const t = Math.sqrt(e.shared / maxShared);
    const op = 0.16 + 0.6 * t;
    const w = 0.7 + 2.6 * t;
    const hue = mixHue(sprouts[e.a].aura, sprouts[e.b].aura);
    const { d, cx, cy } = edgePath(p, q, e.a, e.b);
    parts.push(
      `<path d="${d}" fill="none" stroke="hsl(${hue} 80% 62%)" stroke-width="${(w * 3.2).toFixed(2)}" opacity="${(op * 0.38).toFixed(3)}" stroke-linecap="round"/>`,
      `<path d="${d}" fill="none" stroke="hsl(${hue} 85% 68%)" stroke-width="${w.toFixed(2)}" opacity="${op.toFixed(3)}" stroke-linecap="round"/>`
    );
    const cnt = Math.min(e.shared, 4);
    for (let j = 0; j < cnt; j++) {
      const pt = quadPoint(p, { x: cx, y: cy }, q, (j + 1) / (cnt + 1));
      const ph = j % 2 === 0 ? sprouts[e.a].aura : sprouts[e.b].aura;
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="1.7" fill="hsl(${ph} 90% 75%)" opacity="0.85"/>`);
    }
  }

  // seedlings, painter-ordered so lower plants overlap upper ones naturally;
  // labels go on their own top layer so no plant ever drowns a name
  const drawOrder = seeds.map((_, i) => i).sort((a, b) => pos[a].y - pos[b].y);
  const labels: string[] = [];
  for (const idx of drawOrder) {
    const s = seeds[idx], o = sprouts[idx], p = pos[idx];
    const { parts: body, height } = seedlingParts(o, `h${idx}`);
    const labelOp = o.att === 0 && o.topics.length === 0 ? 0.45 : 0.92;
    parts.push(`<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${body}</g>`);
    labels.push(
      `<text x="${p.x.toFixed(1)}" y="${(p.y - height - 16).toFixed(0)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10.5" font-weight="600" letter-spacing="0.9" fill="#e9e4d6" opacity="${labelOp}" stroke="#030402" stroke-width="3" paint-order="stroke">${escapeXml(s.name.toUpperCase())}</text>`
    );
  }
  parts.push(`<g>${labels.join("")}</g>`);

  // ---------- poster panel ----------
  const serif = `font-family="Newsreader, Georgia, serif"`;
  const mono = `font-family="JetBrains Mono, monospace"`;
  const sans = `font-family="Inter, sans-serif"`;
  parts.push(
    `<text x="64" y="96" ${mono} font-size="12" letter-spacing="3.5" fill="#e0b356" opacity="0.85">BIRDBRAIN · SEEDS</text>`,
    `<text x="62" y="168" ${serif} font-size="58" letter-spacing="3" fill="#f0ead9">IDENTITY</text>`,
    `<text x="62" y="232" ${serif} font-size="58" letter-spacing="3" fill="#f0ead9">FOREST</text>`,
    // sprout glyph
    `<g transform="translate(70 262)" stroke="#e0b356" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.9"><path d="M8 14 C8 9 4 8 1 5 C6 6 8 8 8 11"/><path d="M8 14 C8 8 12 6 16 3 C11 5 8 7 8 11"/><path d="M8 14 L8 16"/></g>`
  );
  const copy = (y: number, lines: string[][]) =>
    lines.map((segs, i) =>
      `<text x="64" y="${y + i * 30}" ${serif} font-size="21" fill="#cfc8b6">` +
        segs.map(([txt, col]) => (col ? `<tspan fill="${col}">${txt}</tspan>` : `<tspan>${txt}</tspan>`)).join("") +
      `</text>`
    ).join("");
  parts.push(
    copy(330, [
      [["Every seed is a person,"]],
      [["grown from what they"]],
      [["actually "], ["did", "#e0b356"], [" in the room."]],
    ]),
    copy(452, [[["The lines are"]], [["shared sessions.", "#b9a0f2"]]]),
    copy(546, [
      [["The lines are the"]],
      [["point — we are a"]],
      [["web of relationships.", "#e0b356"]],
    ])
  );
  // legend card
  const LX = 48, LY = 742, LW = 296, LH = 224;
  parts.push(
    `<rect x="${LX}" y="${LY}" width="${LW}" height="${LH}" rx="14" fill="rgba(8,10,5,0.55)" stroke="rgba(236,230,216,0.16)"/>`,
    `<g transform="translate(${LX + 22} ${LY + 30})" stroke="#8fce5a" stroke-width="1.4" fill="none" stroke-linecap="round"><path d="M5 10 C5 6 2 5 0 3 C4 4 5 6 5 8"/><path d="M5 10 C5 5 8 4 11 1 C7 3 5 5 5 8"/><path d="M5 10 L5 12"/></g>`,
    `<text x="${LX + 48}" y="${LY + 42}" ${sans} font-size="13.5" fill="#d9d3c2">Seed = a person</text>`,
    `<circle cx="${LX + 24}" cy="${LY + 76}" r="2.6" fill="#e0b356"/><path d="M${LX + 28} ${LY + 76} q10 -6 20 0" stroke="#e0b356" stroke-width="1.2" fill="none" opacity="0.8"/>`,
    `<text x="${LX + 48}" y="${LY + 81}" ${sans} font-size="13.5" fill="#d9d3c2">What grows = what they did</text>`,
    `<path d="M${LX + 16} ${LY + 115} q14 -8 30 0" stroke="#b9a0f2" stroke-width="1.4" fill="none"/><circle cx="${LX + 31}" cy="${LY + 111}" r="1.6" fill="#e6dcff"/>`,
    `<text x="${LX + 48}" y="${LY + 120}" ${sans} font-size="13.5" fill="#d9d3c2">Lines = shared sessions</text>`,
    `<path d="M${LX + 16} ${LY + 150} q14 -8 30 0 M${LX + 16} ${LY + 155} q14 -6 30 1 M${LX + 16} ${LY + 159} q14 8 30 2" stroke="#cbb8f7" stroke-width="1.1" fill="none" opacity="0.85"/>`,
    `<text x="${LX + 48}" y="${LY + 158}" ${sans} font-size="13.5" fill="#d9d3c2">More lines = more connection</text>`,
    `<line x1="${LX + 20}" y1="${LY + 180}" x2="${LX + LW - 20}" y2="${LY + 180}" stroke="rgba(236,230,216,0.12)"/>`,
    `<text x="${LX + 22}" y="${LY + 205}" ${serif} font-size="16" fill="#e0b356">We grow together.</text>`,
    `<g transform="translate(${LX + 156} ${LY + 193})" stroke="#8fce5a" stroke-width="1.3" fill="none" stroke-linecap="round" opacity="0.9"><path d="M5 10 C5 6 2 5 0 3 C4 4 5 6 5 8"/><path d="M5 10 C5 5 8 4 11 1 C7 3 5 5 5 8"/></g>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

// ---------- main ----------
const files = readdirSync(SEEDS_DIR).filter((f) => f.endsWith(".md"));
const seeds = files.map(parseSeed).filter((s): s is Seed => !!s);
const edges = coAttendance(seeds);
const sprouts = seeds.map(sproutOf);
const depth = topicalDepth(seeds);
const SESSIONS = sessionTimeline(seeds);
const sessIdx = new Map(SESSIONS.map((id, i) => [id, i]));

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "organisms"), { recursive: true });

for (const s of seeds) writeFileSync(join(OUT, "organisms", `${s.slug}.svg`), organismSVG(s));
const pos = layout(seeds);
const forest = forestSVG(seeds, sprouts, edges, pos);
writeFileSync(join(OUT, "forest.svg"), forest);

writeFileSync(
  join(OUT, "forest.json"),
  JSON.stringify(
    {
      generatedAt: null, // stamped by caller if needed; kept null for deterministic output
      trust: "zero-trust — deterministic render over public Seed data",
      counts: { seeds: seeds.length, edges: edges.length, sessions: SESSIONS.length },
      sessions: SESSIONS,
      nodes: seeds.map((s, i) => ({
        slug: s.slug, name: s.name, confidence: s.confidence,
        attended: s.attended.length, mentioned: s.mentioned.length,
        actionItems: s.actionItems, topics: s.topics,
        depth: +depth[i].toFixed(4),
        sessions: s.attended,
      })),
      edges: edges.map((e) => ({ a: seeds[e.a].slug, b: seeds[e.b].slug, shared: e.shared })),
    },
    null, 2
  )
);

// ---------- the living page (interactive; same data, client-drawn) ----------
const pageNodes: PNode[] = seeds.map((s, i) => ({
  slug: s.slug,
  name: s.name,
  x: +pos[i].x.toFixed(1),
  y: +pos[i].y.toFixed(1),
  rot: +sprouts[i].rot.toFixed(4),
  att: s.attended.length,
  men: s.mentioned.length,
  ai: s.actionItems,
  conf: s.confidence,
  sol: sprouts[i].sol,
  aura: sprouts[i].aura,
  topics: sprouts[i].topics,
  z: +depth[i].toFixed(4),
  sess: s.attended.map((id) => sessIdx.get(id)!).filter((v) => v !== undefined).sort((a, b) => a - b),
}));
const pageEdges: PEdge[] = edges.map((e) => [e.a, e.b, e.shared]);

// true sentences from the record, deterministic order (the ticker's script)
function sentences(): string[] {
  const out: string[] = [];
  const totalSharedTies = edges.reduce((n, e) => n + e.shared, 0);
  out.push(`${edges.length} threads bind ${seeds.length} people.`);
  const topEdges = [...edges].sort((a, b) => b.shared - a.shared).slice(0, 6);
  for (const e of topEdges)
    out.push(`${seeds[e.a].name} and ${seeds[e.b].name} have sat in the same room ${e.shared} times.`);
  const carriers: Record<string, number> = {};
  for (const s of seeds) for (const t of s.topics) carriers[t.topic] = (carriers[t.topic] || 0) + 1;
  const topTopics = Object.entries(carriers).sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [t, n] of topTopics) out.push(`${n} people carry the thread of “${t}”.`);
  const present = [...seeds].sort((a, b) => b.attended.length - a.attended.length).slice(0, 3);
  for (const s of present) out.push(`${s.name} has been present ${s.attended.length} times.`);
  const holders = [...seeds].filter((s) => s.actionItems > 0).sort((a, b) => b.actionItems - a.actionItems).slice(0, 2);
  for (const s of holders) out.push(`${s.name} is holding ${s.actionItems} open intention${s.actionItems === 1 ? "" : "s"}.`);
  const faint = seeds.filter((s) => s.attended.length === 0).length;
  if (faint > 0) out.push(`${faint} people are in the room but faint in the record — honest gaps, never faked.`);
  out.push(`${totalSharedTies} shared sessions, witnessed — nothing here is inferred.`);
  return out;
}

writeFileSync(join(OUT, "index.html"), pageHTML(pageNodes, pageEdges, sentences(), SESSIONS));

// static PNG (for OG cards / previews) — regenerate if rsvg-convert is present
try {
  const r = Bun.spawnSync(["rsvg-convert", join(OUT, "forest.svg"), "-o", join(OUT, "forest.png")]);
  if (r.exitCode !== 0) console.warn("  (forest.png skipped — rsvg-convert failed)");
} catch {
  console.warn("  (forest.png skipped — rsvg-convert not available)");
}

console.log(`Identity Forest built → ${OUT}`);
console.log(`  seeds: ${seeds.length}  edges: ${edges.length}  shared-ties: ${edges.reduce((n, e) => n + e.shared, 0)}`);
console.log(`  files: forest.svg, index.html, forest.json, organisms/*.svg (${seeds.length})`);
