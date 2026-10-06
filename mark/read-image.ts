/**
 * Read a seed mark from a picture: a phone photo, a screenshot, a camera frame.
 *
 * Works on raw RGBA pixels and uses no runtime APIs, so the same code runs in Bun
 * (read-photo.ts) and in a browser (scan.html). Steps:
 *
 *   1. greyscale and shrink, then mark each pixel as ink where it is darker (or,
 *      for a mark shown light on dark, lighter) than its neighbourhood
 *   2. find ring-shaped blobs: candidates for the frame. Fitting an ellipse to one
 *      gives the mark's centre, size and tilt
 *   3. find the stem: it says which way is up
 *   4. refine a full perspective transform so every cell lands where the geometry
 *      in MARK.md says it should, then sample each cell
 *   5. accept only if the 16 check bits match for one kind. Otherwise try the next
 *      candidate, the mirror image, and the other polarity, then give up and say so
 *
 * It never guesses. At most one weak bit is flipped to recover a match, and the
 * result says when that happened.
 */

import { blake2b } from "./blake2b";

export type RGBA = { width: number; height: number; data: ArrayLike<number> };
export type Kind = "anchored" | "unanchored";
export type ImageRead = {
  kind: Kind;
  payload: Uint8Array;
  payloadHex: string;
  centre: [number, number];
  radiusPx: number;
  inverted: boolean;
  mirrored: boolean;
  corrected: number;
  confidence: number;
};

const RING_IN = [16, 23, 30, 37], RING_W = 5, SECTORS = 64;
const CHECK_IN = 45, CHECK_W = 4, CHECK_SECTORS = 16, FRAME_R = 53;
const MAX_SIDE = 1200;
let dbg: ((msg: string) => void) | null = null;

const hex = (b: Uint8Array) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function checkBits(kind: Kind, payload: Uint8Array): number {
  const pre = new TextEncoder().encode(`seed-mark/v1/${kind}`);
  const buf = new Uint8Array(pre.length + 32);
  buf.set(pre);
  buf.set(payload, pre.length);
  const d = blake2b(buf, 32);
  return (d[0] << 8) | d[1];
}

type Gray = { w: number; h: number; g: Float32Array; scale: number };

function toGray(img: RGBA): Gray {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const sum = new Float32Array(w * h), cnt = new Float32Array(w * h);
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    const ty = Math.min(h - 1, Math.floor(y * scale));
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4, t = ty * w + Math.min(w - 1, Math.floor(x * scale));
      const a = d[i + 3] / 255;
      // transparent pixels read as white paper
      sum[t] += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
      cnt[t]++;
    }
  }
  for (let i = 0; i < w * h; i++) sum[i] /= cnt[i] || 1;
  return { w, h, g: sum, scale };
}

function inkMask({ w, h, g }: Gray, light: boolean): Uint8Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(7, Math.round(Math.max(w, h) / 14));
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + x];
      m[y * w + x] = light ? (v > mean + 10 ? 1 : 0) : v < mean - 10 ? 1 : 0;
    }
  }
  return m;
}

type Blob = { pts: number[]; area: number };

function blobs(m: Uint8Array, w: number, h: number): Blob[] {
  const lab = new Int32Array(w * h), q = new Int32Array(w * h);
  const out: { label: number; n: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  let next = 1;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    let head = 0, tail = 0, n = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    lab[s] = next; q[tail++] = s;
    while (head < tail) {
      const p = q[head++], px = p % w, py = (p - px) / w;
      n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const t = ny * w + nx;
        if (m[t] && !lab[t]) { lab[t] = next; q[tail++] = t; }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (n >= 60 && Math.min(bw, bh) >= 24 && Math.max(bw, bh) / Math.min(bw, bh) <= 4) out.push({ label: next, n, x0, x1, y0, y1 });
    next++;
  }
  out.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  return out.slice(0, 14).map((c) => {
    const pts: number[] = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.label) pts.push(x, y);
    return { pts, area: (c.x1 - c.x0) * (c.y1 - c.y0) };
  });
}

/** Solve a small linear system by Gaussian elimination with partial pivoting. */
function solve(M: number[][], y: number[]): number[] | null {
  const n = y.length, A = M.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}

/** Symmetric square root of a 2×2 positive-definite matrix [a b; b c]. */
function sqrtm(a: number, b: number, c: number): number[] | null {
  const det = a * c - b * b;
  if (det <= 0 || a <= 0) return null;
  const s = Math.sqrt(det), t = Math.sqrt(a + c + 2 * s);
  return [(a + s) / t, b / t, b / t, (c + s) / t];
}

type Ring = { cx: number; cy: number; A: number[] };

/**
 * Fit the frame. A circle seen by a camera is an ellipse, so fit a conic
 * x'Qx + Dx + Ey = 1 by least squares, keep the points near it, and fit again.
 * Returns the ellipse centre and the 2×2 map from mark units to pixels, up to a
 * rotation the stem settles later.
 */
function fitRing(pts: number[]): Ring | null {
  let use = pts, fit: (Ring & { inv: number[] }) | null = null;
  for (let pass = 0; pass < 4; pass++) {
    const n = use.length / 2;
    if (n < 40) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < use.length; i += 2) { mx += use[i]; my += use[i + 1]; }
    mx /= n; my /= n;
    const N = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]), Y = [0, 0, 0, 0, 0];
    for (let i = 0; i < use.length; i += 2) {
      const x = use[i] - mx, y = use[i + 1] - my, row = [x * x, x * y, y * y, x, y];
      for (let r = 0; r < 5; r++) { Y[r] += row[r]; for (let c = 0; c < 5; c++) N[r][c] += row[r] * row[c]; }
    }
    const q = solve(N, Y);
    if (!q) return null;
    const [A, B, C, D, E] = q;
    const ctr = solve([[2 * A, B], [B, 2 * C]], [-D, -E]);
    if (!ctr) return null;
    const [ex, ey] = ctr;
    const k = 1 - (A * ex * ex + B * ex * ey + C * ey * ey + D * ex + E * ey);
    if (!(k > 0)) return null;
    // ellipse: d'(Q/k)d = 1; the map from a circle of radius R is (Q/k)^(-1/2) / R
    const qa = A / k, qb = B / 2 / k, qc = C / k, det = qa * qc - qb * qb;
    if (!(det > 0)) return null;
    const S = sqrtm(qc / det, -qb / det, qa / det);
    if (!S) return null;
    const M = S.map((v) => v / FRAME_R);
    const dM = M[0] * M[3] - M[1] * M[2];
    fit = { cx: mx + ex, cy: my + ey, A: M, inv: [M[3] / dM, -M[1] / dM, -M[2] / dM, M[0] / dM] };
    const tol = pass < 2 ? 0.12 : 0.07;
    const keep: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - fit.cx, dy = pts[i + 1] - fit.cy;
      const ux = fit.inv[0] * dx + fit.inv[1] * dy, uy = fit.inv[2] * dx + fit.inv[3] * dy;
      if (Math.abs(Math.hypot(ux, uy) / FRAME_R - 1) < tol) keep.push(pts[i], pts[i + 1]);
    }
    if (keep.length < 0.55 * pts.length) return null;
    use = keep;
  }
  // a ring, not a disc or a blob: inliers must go all the way round
  const seen = new Set<number>();
  for (let i = 0; i < use.length; i += 2) {
    const dx = use[i] - fit!.cx, dy = use[i + 1] - fit!.cy;
    const ux = fit!.inv[0] * dx + fit!.inv[1] * dy, uy = fit!.inv[2] * dx + fit!.inv[3] * dy;
    seen.add(Math.floor(((Math.atan2(uy, ux) + Math.PI) / (2 * Math.PI)) * 36) % 36);
  }
  return seen.size >= 32 ? { cx: fit!.cx, cy: fit!.cy, A: fit!.A } : null;
}

// ---------- the pose: a homography from mark units (centre at 0,0) to pixels ----------
type H = number[]; // 8 entries, h[8] = 1

function proj(h: H, ux: number, uy: number): [number, number] {
  const z = h[6] * ux + h[7] * uy + 1;
  return [(h[0] * ux + h[1] * uy + h[2]) / z, (h[3] * ux + h[4] * uy + h[5]) / z];
}

function sample({ w, h, g }: Gray, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1)) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  return (g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx) * (1 - fy) + (g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx) * fy;
}

const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
};

// sample points per cell, in mark units
const CELLS: [number, number][][] = [];
for (let r = 0; r < 4; r++)
  for (let s = 0; s < SECTORS; s++) {
    const c = (s + 0.5) * (360 / SECTORS), pts: [number, number][] = [];
    for (const dr of [1.5, 2.5, 3.5]) for (const da of [-1.4, 0, 1.4]) pts.push(polar(RING_IN[r] + dr, c + da));
    CELLS.push(pts);
  }
for (let s = 0; s < CHECK_SECTORS; s++) {
  const c = (s + 0.5) * (360 / CHECK_SECTORS), pts: [number, number][] = [];
  for (const dr of [1.2, 2, 2.8]) for (const da of [-5, 0, 5]) pts.push(polar(CHECK_IN + dr, c + da));
  CELLS.push(pts);
}
const FRAME = Array.from({ length: 48 }, (_, i) => polar(FRAME_R, i * 7.5));
const PAPER = [...Array.from({ length: 48 }, (_, i) => polar(12.5, i * 7.5)), ...Array.from({ length: 48 }, (_, i) => polar(50.8, i * 7.5))];
const STEM = [55.5, 56.5, 57.5, 58.5, 59.5].map((r) => polar(r, 0));
const STEM_OFF = [-8, 8].flatMap((d) => [56.5, 58.5].map((r) => polar(r, d)));

const median = (v: number[]) => { const s = v.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

// Ink and paper levels from the picture itself: about half the cells are ink, so
// the dark and light ends of everything inside the frame give both, and a pose
// that is a little off still gets them right. The mask's polarity says which end is ink.
const LEVEL_PTS: [number, number][] = [];
for (let r = 12; r <= 50; r += 1.5) for (let a = 0; a < 360; a += 4) LEVEL_PTS.push(polar(r, a));
function levels(G: Gray, h: H, light: boolean) {
  const v = LEVEL_PTS.map(([x, y]) => sample(G, ...proj(h, x, y))).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length < 100) return { ink: NaN, paper: NaN };
  const lo = v[Math.floor(v.length * 0.1)], hi = v[Math.floor(v.length * 0.9)];
  return light ? { ink: hi, paper: lo } : { ink: lo, paper: hi };
}

function inkness(G: Gray, h: H, pts: [number, number][], L: { ink: number; paper: number }): number {
  let s = 0, n = 0;
  for (const [x, y] of pts) {
    const v = sample(G, ...proj(h, x, y));
    if (Number.isNaN(v)) continue;
    s += (v - L.paper) / (L.ink - L.paper); n++;
  }
  return n ? s / n : 0;
}

function score(G: Gray, h: H, L: { ink: number; paper: number }): number {
  // squared distance from the undecided middle: smooth, so small moves always register
  let s = 0;
  for (const c of CELLS) { const v = Math.max(-0.25, Math.min(1.25, inkness(G, h, c, L))) - 0.5; s += v * v; }
  s += 0.25 * FRAME.length * Math.min(1, inkness(G, h, FRAME, L));
  s += 6 * (Math.min(1, inkness(G, h, STEM, L)) - Math.max(0, inkness(G, h, STEM_OFF, L)));
  return s;
}

/** Box blur, for coarse-to-fine alignment. */
function blur(G: Gray, r: number): Gray {
  if (r < 1) return G;
  const { w, h, g } = G, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += g[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += g[y * w + Math.min(w - 1, x + r + 1)] - g[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return { ...G, g: out };
}

/** Base (mark units → pixels, up to rotation) · Rot(deg) · diag(±1, 1), as the 8-entry H. */
function pose(B: M3, deg: number, mirror: boolean): H {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), m = mirror ? -1 : 1;
  const R: M3 = [c * m, -s, 0, s * m, c, 0, 0, 0, 1];
  const o = mul3(B, R);
  return o.slice(0, 8).map((v) => v / o[8]);
}
const affineBase = (r: Ring): M3 => [r.A[0], r.A[1], r.cx, r.A[2], r.A[3], r.cy, 0, 0, 1];

function findStem(G: Gray, B: M3, mirror: boolean, L: { ink: number; paper: number }) {
  let deg = 0, best = -Infinity;
  for (let d = 0; d < 360; d += 1) {
    const v = inkness(G, pose(B, d, mirror), STEM, L) - Math.max(0, inkness(G, pose(B, d, mirror), STEM_OFF, L));
    if (v > best) { best = v; deg = d; }
  }
  return { deg, v: best };
}

function refine(G: Gray, h0: H, light: boolean): H {
  const k = Math.sqrt(Math.abs(h0[0] * h0[4] - h0[1] * h0[3])); // pixels per mark unit
  let h = h0.slice();
  // coarse to fine: blurred pictures first, so a pose that is a cell off still sees a slope
  for (const [blurUnits, rounds] of [[2.5, 4], [1.2, 4], [0, 5]] as [number, number][]) {
    const B = blur(G, Math.round(blurUnits * k));
    const L = levels(B, h, light);
    if (!(Math.abs(L.ink - L.paper) > 8)) return h;
    const step = [0.03 * k, 0.03 * k, 1.2 * k, 0.03 * k, 0.03 * k, 1.2 * k, 8e-4, 8e-4].map((v) => v * (blurUnits ? 1 : 0.3));
    let best = score(B, h, L);
    for (let round = 0; round < rounds; round++) {
      for (let sweep = 0; sweep < 12; sweep++) {
        let moved = false;
        for (let i = 0; i < 8; i++)
          for (const d of [step[i], -step[i]]) {
            const t = h.slice();
            t[i] += d;
            const v = score(B, t, L);
            if (v > best) { best = v; h = t; moved = true; }
          }
        if (!moved) break;
      }
      for (let i = 0; i < 8; i++) step[i] /= 2;
    }
  }
  return h;
}

type M3 = number[]; // 3×3, row-major

const mul3 = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
};
const T3 = (a: M3): M3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
function inv3(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

/** Conic through points: A x² + B xy + C y² + D x + E y = 1, as a symmetric 3×3. */
function conicOnce(pts: number[]): M3 | null {
  const N = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]), Y = [0, 0, 0, 0, 0];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1], row = [x * x, x * y, y * y, x, y];
    for (let r = 0; r < 5; r++) { Y[r] += row[r]; for (let c = 0; c < 5; c++) N[r][c] += row[r] * row[c]; }
  }
  const q = solve(N, Y);
  if (!q) return null;
  const [A, B, C, D, E] = q;
  return [A, B / 2, D / 2, B / 2, C, E / 2, D / 2, E / 2, -1];
}

/** The same, dropping points far from the curve and fitting again. */
function conic(pts: number[]): M3 | null {
  let use = pts, C: M3 | null = null;
  for (let pass = 0; pass < 3; pass++) {
    C = conicOnce(use);
    if (!C || use.length < 2 * 12) return C;
    const res: number[] = [];
    for (let i = 0; i < use.length; i += 2) {
      const x = use[i], y = use[i + 1];
      res.push(Math.abs(C[0] * x * x + 2 * C[1] * x * y + C[4] * y * y + 2 * C[2] * x + 2 * C[5] * y + C[8]));
    }
    const med = res.slice().sort((a, b) => a - b)[res.length >> 1];
    const keep: number[] = [];
    res.forEach((r, i) => { if (r <= 3 * med + 1e-9) keep.push(use[2 * i], use[2 * i + 1]); });
    if (keep.length === use.length) break;
    use = keep;
  }
  return C;
}

/** The eigenvector of a 3×3 for its eigenvalue that stands apart from the other two. */
function oddEigenvector(m: M3): number[] | null {
  // characteristic polynomial λ³ - tλ² + pλ - d
  const t = m[0] + m[4] + m[8];
  const p = m[0] * m[4] - m[1] * m[3] + m[0] * m[8] - m[2] * m[6] + m[4] * m[8] - m[5] * m[7];
  const d = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const f = (x: number) => ((x - t) * x + p) * x - d;
  // real roots by bracketing on a fine grid around the trace scale
  const span = Math.abs(t) + Math.abs(p) + Math.abs(d) + 1, roots: number[] = [];
  let px = -span, pv = f(px);
  for (let i = 1; i <= 4000; i++) {
    const x = -span + (2 * span * i) / 4000, v = f(x);
    if (pv === 0) roots.push(px);
    else if (pv * v < 0) {
      let lo = px, hi = x;
      for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
      roots.push((lo + hi) / 2);
    }
    px = x; pv = v;
  }
  if (!roots.length) return null;
  // with a double root the bracket sees one crossing; the odd one is farthest from the rest
  const mean = t / 3;
  const lam = roots.length === 1 ? roots[0] : roots.slice().sort((a, b) => Math.abs(b - mean) - Math.abs(a - mean))[0];
  const r0 = [m[0] - lam, m[1], m[2]], r1 = [m[3], m[4] - lam, m[5]], r2 = [m[6], m[7], m[8] - lam];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const cands = [cross(r0, r1), cross(r0, r2), cross(r1, r2)];
  return cands.sort((a, b) => Math.hypot(...b) - Math.hypot(...a))[0];
}

/**
 * Undo perspective exactly. The frame and the core are concentric circles. A
 * camera turns each into an ellipse, and for two such ellipses the odd
 * eigenvector of C1⁻¹C2 is the picture of their shared centre, and the centre's
 * polar is the picture of the horizon. Sending that line back to infinity leaves
 * only an affine squash, which the frame's ellipse undoes. Points on both curves
 * are found by walking outward from the current guess, so this needs the guess
 * only to be close, not right.
 */
function rectify(G: Gray, h: H, light: boolean): M3 | null {
  const L = levels(G, h, light);
  if (!(Math.abs(L.ink - L.paper) > 12)) return null;
  const ink = (u: number, v: number) => {
    const g = sample(G, ...proj(h, u, v));
    return Number.isNaN(g) ? 0 : (g - L.paper) / (L.ink - L.paper);
  };
  const frame: number[] = [], core: number[] = [];
  for (let deg = 0; deg < 360; deg += 2) {
    if (deg < 14 || deg > 346) continue; // the stem
    const [sx, sy] = polar(1, deg);
    let end = 0, start = 0;
    for (let r = 64; r >= 44; r -= 0.2) {
      const v = ink(sx * r, sy * r) > 0.5;
      if (v && !end) end = r;
      if (end && !v) { start = r + 0.2; break; }
    }
    if (end && start && end - start < 4) frame.push(...proj(h, sx * (start + end) / 2, sy * (start + end) / 2));
    // core edge: walking out from the middle, where the first run of ink ends.
    // A solid core starts as ink; a hollow one is a dashed ring, so some rays
    // miss it and run on to ring 0, which ends too far out and is dropped.
    let seen = false;
    for (let r = 2; r <= 15; r += 0.2) {
      const v = ink(sx * r, sy * r) > 0.5;
      if (v) seen = true;
      else if (seen) { if (r >= 6.5 && r <= 13.2) core.push(...proj(h, sx * r, sy * r)); break; }
    }
  }
  dbg?.(`  rectify: ${frame.length / 2} frame pts, ${core.length / 2} core pts`);
  if (frame.length < 2 * 60 || core.length < 2 * 40) return null;
  const [cx, cy] = proj(h, 0, 0), sc = Math.sqrt(Math.abs(h[0] * h[4] - h[1] * h[3])) * FRAME_R;
  return fromCircles(frame, core, cx, cy, sc);
}

/** The rectifying base from points on the pictured frame and core (pixels), worked around (cx, cy) at scale sc. */
export function fromCircles(frame: number[], core: number[], cx: number, cy: number, sc: number): M3 | null {
  const norm = (p: number[]) => p.map((v, i) => (v - (i % 2 ? cy : cx)) / sc);
  const C1 = conic(norm(frame)), C2 = conic(norm(core));
  if (!C1 || !C2) return null;
  const C1i = inv3(C1);
  if (!C1i) return null;
  const c = oddEigenvector(mul3(C1i, C2));
  dbg?.(`  rectify: centre ${JSON.stringify(c)} C1 ${JSON.stringify(C1.map((v) => +v.toPrecision(4)))} C2 ${JSON.stringify(C2.map((v) => +v.toPrecision(4)))}`);
  if (!c || Math.abs(c[2]) < 1e-12) return null;
  const l = [C1[0] * c[0] + C1[1] * c[1] + C1[2] * c[2], C1[3] * c[0] + C1[4] * c[1] + C1[5] * c[2], C1[6] * c[0] + C1[7] * c[1] + C1[8] * c[2]];
  if (Math.abs(l[2]) < 1e-12) return null;
  const P: M3 = [1, 0, 0, 0, 1, 0, l[0] / l[2], l[1] / l[2], 1];
  const Pi = inv3(P)!;
  // the frame after the horizon goes back to infinity: an ellipse
  const E = mul3(mul3(T3(Pi), C1), Pi);
  const Qa = E[0], Qb = E[1], Qc = E[4], bx = E[2], by = E[5], f = E[8];
  const qd = Qa * Qc - Qb * Qb;
  if (!(qd > 0)) return null;
  const x0 = -(Qc * bx - Qb * by) / qd, y0 = -(-Qb * bx + Qa * by) / qd;
  const k = -(f + bx * x0 + by * y0);
  if (!(k / Qa > 0)) return null;
  const qa = Qa / k, qb = Qb / k, qc = Qc / k, det = qa * qc - qb * qb;
  if (!(det > 0)) return null;
  const S = sqrtm(qc / det, -qb / det, qa / det);
  if (!S) return null;
  const Aff: M3 = [S[0] / FRAME_R, S[1] / FRAME_R, x0, S[2] / FRAME_R, S[3] / FRAME_R, y0, 0, 0, 1];
  const Tin: M3 = [sc, 0, cx, 0, sc, cy, 0, 0, 1];
  const B = mul3(Tin, mul3(Pi, Aff));
  return B.map((v) => v / B[8]);
}

function readBits(G: Gray, h: H, L: { ink: number; paper: number }) {
  const v = CELLS.map((c) => inkness(G, h, c, L));
  const payload = new Uint8Array(32);
  let ck = 0;
  for (let r = 0; r < 4; r++)
    for (let s = 0; s < SECTORS; s++) if (v[r * SECTORS + s] > 0.5) payload[r * 8 + (s >> 3)] |= 1 << (7 - (s & 7));
  for (let s = 0; s < CHECK_SECTORS; s++) if (v[4 * SECTORS + s] > 0.5) ck |= 1 << (15 - s);
  return { v, payload, ck };
}

function match(payload: Uint8Array, ck: number): Kind | null {
  for (const k of ["anchored", "unanchored"] as Kind[]) if (checkBits(k, payload) === ck) return k;
  return null;
}

function tryCandidate(G: Gray, ring: Ring, mirror: boolean, light: boolean) {
  let B = affineBase(ring);
  const L = levels(G, pose(B, 0, mirror), light);
  if (!(Math.abs(L.ink - L.paper) > 12)) return null;
  let stem = findStem(G, B, mirror, L);
  dbg?.(`  levels ink ${L.ink.toFixed(0)} paper ${L.paper.toFixed(0)} stem ${stem.deg}° (${stem.v.toFixed(2)}) mirror=${mirror}`);
  if (stem.v < 0.3) return null;
  // two passes: each rectification starts from a better guess than the last
  const hp = pose(B, stem.deg, mirror);
  for (let pass = 0; pass < 2; pass++) {
    const R = rectify(G, pose(B, stem.deg, mirror), light);
    if (!R) break;
    B = R;
    stem = findStem(G, B, mirror, L);
    if (dbg) { const hh = pose(B, stem.deg, mirror); const r = readBits(G, hh, levels(G, hh, light)); dbg(`  stage pass${pass} bits ${hex(r.payload)} stem ${stem.deg} ${stem.v.toFixed(2)}`); }
  }
  const hs = pose(B, stem.deg, mirror);
  const h = refine(G, hs, light);
  if (dbg) for (const [n, hh] of [["ellipse", hp], ["rectify", hs], ["refine", h]] as [string, H][]) {
    const r = readBits(G, hh, levels(G, hh, light));
    dbg(`  stage ${n} bits ${hex(r.payload)} ${r.ck.toString(16)} pose ${JSON.stringify(hh.map((x) => +x.toPrecision(6)))}`);
  }
  const L2 = levels(G, h, light);
  dbg?.(`  pose ${JSON.stringify(h.map((x) => +x.toPrecision(6)))} scale ${G.scale}`);
  const { v, payload, ck } = readBits(G, h, L2);
  const confidence = v.reduce((s, x) => s + Math.min(1, 2 * Math.abs(x - 0.5)), 0) / v.length;
  let kind = match(payload, ck), corrected = 0;
  if (!kind) {
    // one weak bit: flip each of the four least certain data or check cells and recheck
    const weak = v.map((x, i) => [Math.abs(x - 0.5), i]).sort((a, b) => a[0] - b[0]).slice(0, 4);
    for (const [margin, i] of weak) {
      if (margin > 0.15) break;
      const p = payload.slice();
      let c = ck;
      if (i < 4 * SECTORS) p[(i >> 6) * 8 + ((i & 63) >> 3)] ^= 1 << (7 - (i & 7));
      else c ^= 1 << (15 - (i - 4 * SECTORS));
      const k = match(p, c);
      if (k) { kind = k; corrected = 1; payload.set(p); break; }
    }
  }
  dbg?.(`  read: conf ${confidence.toFixed(2)} weakest ${v.map((x) => Math.abs(x - 0.5)).sort((a, b) => a - b).slice(0, 6).map((x) => x.toFixed(2)).join(" ")} → ${kind ?? "no check match"}`);
  if (!kind) return null;
  const [cx, cy] = proj(h, 0, 0);
  return { kind, payload, cx, cy, radius: Math.sqrt(Math.abs(h[0] * h[4] - h[1] * h[3])) * FRAME_R, corrected, confidence };
}

/** Find and read one seed mark in an image, or return null and say nothing more than that. */
export function readImage(img: RGBA, debug?: (msg: string) => void): ImageRead | null {
  const G0 = toGray(img);
  // divide out slow changes in lighting before reading cells; find blobs on the raw picture
  const wide = blur(G0, Math.round(Math.max(G0.w, G0.h) / 8));
  const G: Gray = { ...G0, g: G0.g.map((v, i) => (128 * v) / Math.max(4, wide.g[i])) };
  dbg = debug ?? null;
  for (const light of [false, true]) {
    for (const b of blobs(inkMask(G0, light), G0.w, G0.h)) {
      const ring = fitRing(b.pts);
      dbg?.(`blob ${b.pts.length / 2}px area ${b.area} light=${light} → ${ring ? `ring at ${ring.cx.toFixed(0)},${ring.cy.toFixed(0)} r≈${(Math.sqrt(Math.abs(ring.A[0] * ring.A[3] - ring.A[1] * ring.A[2])) * FRAME_R).toFixed(0)}` : "not a ring"}`);
      if (!ring) continue;
      for (const mirror of [false, true]) {
        const r = tryCandidate(G, ring, mirror, light);
        if (!r) continue;
        return {
          kind: r.kind,
          payload: r.payload,
          payloadHex: hex(r.payload),
          centre: [r.cx / G.scale, r.cy / G.scale],
          radiusPx: r.radius / G.scale,
          inverted: light,
          mirrored: mirror,
          corrected: r.corrected,
          confidence: +r.confidence.toFixed(3),
        };
      }
    }
  }
  return null;
}
