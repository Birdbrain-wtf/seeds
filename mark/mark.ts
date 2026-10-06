/**
 * The seed mark: a fixed, decodable picture of one Seed's 32-byte identity.
 *
 * The organism in the Identity Forest is a portrait and changes as the person
 * contributes. The mark does not change. It carries 256 bits plus a 16-bit check,
 * so a reader can recover the exact bytes from the picture and look them up.
 *
 *   anchored    payload = the member's account (32-byte public key). The chain's
 *               Members map is keyed by it, so anyone can check the record.
 *   unanchored  payload = blake2b-256("seed-mark/v1/unanchored:" + profile + ":" + slug).
 *               A stable placeholder for a Seed with no account yet. It proves
 *               nothing and is drawn hollow so it never passes for an anchored one.
 *
 * The kind is not drawn as a style hint only: it is folded into the check, so a
 * decoder recovers it from the bits. Geometry and bit order are in MARK.md.
 * Zero dependencies beyond Bun.
 */

export type Kind = "anchored" | "unanchored";

export const RINGS = 4;
export const SECTORS = 64;
export const CHECK_SECTORS = 16;
const C = 60;
const RING_IN = [16, 23, 30, 37];
const RING_W = 5;
const CHECK_IN = 45;
const CHECK_W = 4;
const GAP_DEG = 0.7;

export function blake2b256(data: string | Uint8Array): Uint8Array {
  const h = new Bun.CryptoHasher("blake2b256");
  h.update(data);
  return new Uint8Array(h.digest());
}

export const toHex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");
export function fromHex(s: string): Uint8Array {
  const h = s.replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error("payload must be 32 bytes of hex");
  return new Uint8Array(Buffer.from(h, "hex"));
}

/** An account from either 0x-hex or SS58 (checksum verified), as the 32 bytes the mark carries. */
export function accountBytes(address: string): Uint8Array {
  if (/^0x[0-9a-f]{64}$/i.test(address)) return fromHex(address);
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of address) {
    const v = A.indexOf(ch);
    if (v < 0) throw new Error(`not SS58: ${address}`);
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of address) { if (ch !== "1") break; bytes.unshift(0); }
  const raw = Uint8Array.from(bytes);
  const pre = raw[0] & 0x40 ? 2 : 1;
  if (raw.length !== pre + 32 + 2) throw new Error(`not a 32-byte SS58 account: ${address}`);
  const h = new Bun.CryptoHasher("blake2b512");
  h.update(new TextEncoder().encode("SS58PRE"));
  h.update(raw.subarray(0, pre + 32));
  const sum = new Uint8Array(h.digest());
  if (sum[0] !== raw[pre + 32] || sum[1] !== raw[pre + 33]) throw new Error(`SS58 checksum fails: ${address}`);
  return raw.slice(pre, pre + 32);
}

export function unanchoredPayload(profile: string, slug: string): Uint8Array {
  return blake2b256(`seed-mark/v1/unanchored:${profile}:${slug}`);
}

/** 16 check bits: the first two bytes of blake2b-256("seed-mark/v1/" + kind ‖ payload). */
export function check(kind: Kind, payload: Uint8Array): number {
  const pre = new TextEncoder().encode(`seed-mark/v1/${kind}`);
  const buf = new Uint8Array(pre.length + 32);
  buf.set(pre);
  buf.set(payload, pre.length);
  const d = blake2b256(buf);
  return (d[0] << 8) | d[1];
}

export interface MarkOptions {
  kind: Kind;
  payload: Uint8Array;
  /** Accent for an anchored core. Defaults to a hue from the payload's last byte. */
  hue?: number;
  /** Line colour. Defaults to near-black (anchored) or grey (unanchored), for white paper. */
  ink?: string;
  size?: number;
  label?: string;
}

export function markSVG({ kind, payload, hue, ink, size = 120, label }: MarkOptions): string {
  if (payload.length !== 32) throw new Error("payload must be 32 bytes");
  return drawMark({
    kind,
    payload: Array.from(payload),
    check: check(kind, payload),
    hue: hue ?? Math.round((payload[31] / 256) * 360),
    ink,
    size,
    label: label ?? `${kind} seed ${toHex(payload)}`,
  });
}

/**
 * The drawing on its own: no hashing, no imports, nothing from outside its body,
 * so a page can ship it as source (drawMark.toString()) and draw marks from bytes
 * the build already checked. The geometry literal must match the constants above;
 * test.ts decodes what this draws, so a drift fails the round-trip.
 */
export function drawMark(o: { kind: string; payload: number[]; check: number; hue: number; ink?: string; size?: number; label: string }): string {
  const C = 60, RING_IN = [16, 23, 30, 37], RING_W = 5, SECTORS = 64, CHECK_IN = 45, CHECK_W = 4, CHECK_SECTORS = 16, FRAME_R = 53, GAP = 0.7;
  const anchored = o.kind === "anchored";
  const ink = o.ink || (anchored ? "#141414" : "#9a9a9a");
  const size = o.size || 120;
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
  const pt = (r: number, deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (rIn: number, rOut: number, d0: number, d1: number) => {
    const large = d1 - d0 > 180 ? 1 : 0;
    const [ax, ay] = pt(rOut, d0), [bx, by] = pt(rOut, d1), [cx, cy] = pt(rIn, d1), [dx, dy] = pt(rIn, d0);
    return `M${f(ax)} ${f(ay)}A${rOut} ${rOut} 0 ${large} 1 ${f(bx)} ${f(by)}L${f(cx)} ${f(cy)}A${rIn} ${rIn} 0 ${large} 0 ${f(dx)} ${f(dy)}Z`;
  };
  // runs of set cells, merged so the mark reads as strokes, not pixels
  const runs = (n: number, on: (s: number) => boolean) => {
    const out: number[][] = [];
    for (let s = 0; s < n; ) {
      if (!on(s)) { s++; continue; }
      let e = s;
      while (e + 1 < n && on(e + 1)) e++;
      out.push([s, e]);
      s = e + 1;
    }
    return out;
  };
  const cells: string[] = [];
  const step = 360 / SECTORS;
  for (let r = 0; r < 4; r++)
    for (const [s, e] of runs(SECTORS, (s) => ((o.payload[r * 8 + (s >> 3)] >> (7 - (s & 7))) & 1) === 1))
      cells.push(arc(RING_IN[r], RING_IN[r] + RING_W, s * step + GAP / 2, (e + 1) * step - GAP / 2));
  const cstep = 360 / CHECK_SECTORS;
  for (const [s, e] of runs(CHECK_SECTORS, (s) => ((o.check >> (15 - s)) & 1) === 1))
    cells.push(arc(CHECK_IN, CHECK_IN + CHECK_W, s * cstep + GAP, (e + 1) * cstep - GAP));
  const paths = cells.map((d) => `<path d="${d}"/>`).join("");
  // unanchored is drawn in grey with a hollow core, but its cells and frame stay
  // solid so a camera can still read it and say plainly that it proves nothing
  const body = `<g fill="${ink}">${paths}</g>`;
  const core = anchored
    ? `<circle cx="${C}" cy="${C}" r="9.4" fill="hsl(${o.hue} 70% 50%)" stroke="${ink}" stroke-width="1.2"/>`
    : `<circle cx="${C}" cy="${C}" r="9.4" fill="none" stroke="${ink}" stroke-width="1.2" stroke-dasharray="2.4 1.8"/>`;
  const frame = `<circle cx="${C}" cy="${C}" r="${FRAME_R}" fill="none" stroke="${ink}" stroke-width="1.4"/>`;
  const stem = `<path d="M${C} ${C - FRAME_R}L${C} ${C - FRAME_R - 5}" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/><circle cx="${C}" cy="${C - FRAME_R - 6}" r="1.6" fill="${ink}"/>`;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 120 122" width="${size}" height="${Math.round((size * 122) / 120)}" data-seed-mark="v1" role="img" aria-label="${esc(o.label)}"><title>${esc(o.label)}</title>${frame}${stem}${body}${core}</svg>`;
}

/**
 * Read a mark back from its SVG geometry: every drawn arc's outer start and end
 * points give its ring and the sectors it covers. Data attributes are ignored, so
 * this is the same reading a scanner would do on a straight-on picture.
 */
export function decodeSVG(svg: string): { kind: Kind; payload: Uint8Array; payloadHex: string } {
  const payload = new Uint8Array(32);
  let ck = 0;
  const re = /<path d="M([\d.-]+) ([\d.-]+)A([\d.]+) [\d.]+ 0 [01] 1 ([\d.-]+) ([\d.-]+)L/g;
  const ang = (x: number, y: number) => ((Math.atan2(y - C, x - C) * 180) / Math.PI + 90 + 360) % 360;
  for (const m of svg.matchAll(re)) {
    const [x0, y0, rOut, x1, y1] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
    const a0 = ang(x0, y0), a1 = ang(x1, y1) || 360;
    if (rOut === CHECK_IN + CHECK_W) {
      const st = 360 / CHECK_SECTORS;
      for (let s = Math.round((a0 - GAP_DEG) / st); s < Math.round((a1 + GAP_DEG) / st); s++) ck |= 1 << (15 - s);
      continue;
    }
    const r = RING_IN.findIndex((ri) => ri + RING_W === rOut);
    if (r < 0) continue;
    const st = 360 / SECTORS;
    for (let s = Math.round((a0 - GAP_DEG / 2) / st); s < Math.round((a1 + GAP_DEG / 2) / st); s++) {
      payload[r * 8 + (s >> 3)] |= 1 << (7 - (s & 7));
    }
  }
  const kind = (["anchored", "unanchored"] as Kind[]).find((k) => check(k, payload) === ck);
  if (!kind) throw new Error("check bits do not match: misread or not a seed mark");
  return { kind, payload, payloadHex: toHex(payload) };
}

if (import.meta.main) {
  const [cmd, ...a] = Bun.argv.slice(2);
  if (cmd === "draw" && a[0] === "anchored" && a[1]) {
    console.log(markSVG({ kind: "anchored", payload: fromHex(a[1]) }));
  } else if (cmd === "draw" && a[0] === "unanchored" && a[1] && a[2]) {
    console.log(markSVG({ kind: "unanchored", payload: unanchoredPayload(a[1], a[2]) }));
  } else if (cmd === "read" && a[0]) {
    const { kind, payloadHex } = decodeSVG(await Bun.file(a[0]).text());
    console.log(JSON.stringify({ kind, payload: payloadHex }));
  } else {
    console.log(`usage:
  bun run mark.ts draw anchored <0x 32-byte account hex>
  bun run mark.ts draw unanchored <profile> <slug>
  bun run mark.ts read <mark.svg>        → {"kind","payload"}
  then: bun run verify.ts <mark.svg> [ws://…]   (checks the chain)`);
  }
}
