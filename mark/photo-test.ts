/**
 * Hold the image reader to pictures that look like the real world: marks pasted on
 * a busy background, then rotated, tilted, blurred, noised, unevenly lit, shrunk,
 * shown light on dark, mirrored and JPEG-compressed with ImageMagick. Every read
 * must give back the exact bytes and kind, and a picture with no mark in it must
 * read as nothing.
 *
 *   bun run photo-test.ts [cases-per-scene=6] [background.png]
 */
import { markSVG, unanchoredPayload, toHex, type Kind } from "./mark";
import { readImage } from "./read-image";
import { loadImage } from "./read-photo";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const N = Number(Bun.argv[2] ?? 6);
const BG = Bun.argv[3];
const dir = mkdtempSync(join(tmpdir(), "seed-mark-"));
const im = Bun.which("magick") ? "magick" : "convert";
const run = (args: string[]) => { const r = Bun.spawnSync([im, ...args]); if (r.exitCode) throw new Error(r.stderr.toString()); };

type Scene = { name: string; size: number; dark?: boolean; after: string[]; mirror?: boolean };
const W = 1000, H = 760;
const persp = (k: number) => ["-virtual-pixel", "edge", "-distort", "Perspective",
  `0,0 ${W * k},${H * k * 0.5}  ${W},0 ${W * (1 - k * 0.3)},${H * k * 0.2}  0,${H} ${W * k * 0.6},${H * (1 - k)}  ${W},${H} ${W},${H}`];
const scenes: Scene[] = [
  { name: "straight", size: 360, after: [] },
  { name: "rotated 37°", size: 360, after: ["-background", "#888", "-rotate", "37"] },
  { name: "tilted", size: 420, after: persp(0.12) },
  { name: "tilted hard", size: 460, after: persp(0.22) },
  { name: "blur+noise+jpeg", size: 380, after: ["-blur", "0x1.6", "-attenuate", "0.6", "+noise", "Gaussian", "-quality", "55"] },
  { name: "uneven light", size: 380, after: ["(", "-size", `${H}x${W}`, "gradient:#ffffff-#5a5a5a", "-rotate", "90", ")", "-compose", "multiply", "-composite"] },
  { name: "small (150px)", size: 150, after: ["-blur", "0x0.6"] },
  { name: "light on dark screen", size: 360, dark: true, after: ["-blur", "0x1"] },
  { name: "mirrored (selfie camera)", size: 360, after: ["-flop"] },
  { name: "tilted + blurred + small", size: 230, after: [...persp(0.15), "-blur", "0x1.2", "-attenuate", "0.4", "+noise", "Gaussian"] },
  { name: "dark screen, tilted", size: 360, dark: true, after: [...persp(0.15), "-blur", "0x0.8"] },
];

let pass = 0, total = 0, corrected = 0, ms = 0;
for (const sc of scenes) {
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const kind: Kind = i % 3 === 2 ? "unanchored" : "anchored";
    const payload = kind === "anchored" ? crypto.getRandomValues(new Uint8Array(32)) : unanchoredPayload("chaos-sessions", `case-${i}`);
    const svg = markSVG({ kind, payload, size: sc.size, ink: sc.dark ? (kind === "anchored" ? "#ece6d8" : "rgba(236,230,216,.5)") : undefined });
    const sv = join(dir, "m.svg"), mp = join(dir, "m.png"), out = join(dir, `${sc.name.replace(/\W+/g, "-")}-${i}.jpg`);
    writeFileSync(sv, svg);
    // a mark is printed or shown on its own paper with a quiet margin, like any code
    const paper = sc.dark ? "#1b1916" : "#fbfaf7";
    Bun.spawnSync(["rsvg-convert", "-b", paper, sv, "-o", mp]);
    run([mp, "-bordercolor", paper, "-border", `${Math.round(sc.size * 0.12)}`, mp]);
    const bg = BG ? [BG, "-resize", `${W}x${H}^`, "-gravity", "center", "-extent", `${W}x${H}`, "-gravity", "northwest", ...(sc.dark ? [] : ["-fill", "white", "-colorize", "70%"])]
      : ["-size", `${W}x${H}`, sc.dark ? "xc:#141210" : "plasma:#f4f1ea-#d9d2c4", "-blur", "0x2"];
    if (sc.dark && BG) bg.push("-fill", "#141210", "-colorize", "80%");
    const x = 120 + ((i * 97) % Math.max(1, W - sc.size - 240)), y = 90 + ((i * 53) % Math.max(1, H - sc.size - 180));
    run([...bg, mp, "-geometry", `+${x}+${y}`, "-compose", "over", "-composite", ...sc.after, ...(sc.mirror ? ["-flop"] : []), "-quality", "80", out]);
    const t0 = performance.now();
    const r = readImage(loadImage(out));
    ms += performance.now() - t0;
    if (r?.corrected) corrected++;
    const good = !!r && r.kind === kind && r.payloadHex === toHex(payload);
    if (good) ok++; else console.log(`  miss: ${sc.name} #${i} (${kind}) → ${r ? `${r.kind} ${r.payloadHex.slice(0, 12)}…` : "nothing"}  ${out}`);
  }
  console.log(`${ok === N ? "PASS" : "FAIL"}  ${sc.name}: ${ok}/${N}`);
  pass += ok; total += N;
}

// no mark at all: must read as nothing, never as somebody
let fp = 0;
for (let i = 0; i < N; i++) {
  const out = join(dir, `empty-${i}.jpg`);
  run([...(BG ? [BG, "-resize", `${W}x${H}^`, "-extent", `${W}x${H}`] : ["-size", `${W}x${H}`, "plasma:"]), "-draw", `circle ${300 + i * 40},380 ${480 + i * 40},380`, "-quality", "80", out]);
  if (readImage(loadImage(out))) fp++;
}
console.log(`${fp ? "FAIL" : "PASS"}  no mark in the picture reads as nothing: ${N - fp}/${N}`);
pass += N - fp; total += N;
console.log(`${pass} of ${total} pictures read correctly, ${corrected} needing one weak bit flipped, ${Math.round(ms / (total - N))} ms a read  (${dir})`);
process.exit(pass === total ? 0 : 1);
