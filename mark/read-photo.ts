/**
 * Read a seed mark from a photo or screenshot on disk.
 *
 *   bun run read-photo.ts <photo.jpg|png|…>   → {"kind","payload",…} or exit 1
 *
 * Decodes the file with ImageMagick (`magick` or `convert`), then hands the
 * pixels to read-image.ts, the same reader the browser scanner uses.
 */
import { readImage, type RGBA } from "./read-image";

export function loadImage(path: string): RGBA {
  const im = Bun.which("magick") ? ["magick"] : ["convert"];
  const size = Bun.spawnSync([...(im[0] === "magick" ? ["magick", "identify"] : ["identify"]), "-format", "%w %h", `${path}[0]`]);
  const [width, height] = new TextDecoder().decode(size.stdout).trim().split(" ").map(Number);
  if (!width || !height) throw new Error(`cannot open ${path}`);
  const px = Bun.spawnSync([...im, `${path}[0]`, "-auto-orient", "-depth", "8", "rgba:-"], { maxBuffer: width * height * 4 + 1024 });
  // -auto-orient may swap the sides of a phone photo
  const n = px.stdout.length / 4;
  const [w, h] = n === width * height && width !== height ? (Bun.spawnSync([...(im[0] === "magick" ? ["magick", "identify"] : ["identify"]), "-format", "%[orientation]", `${path}[0]`]).stdout.toString().match(/Right|Left/) ? [height, width] : [width, height]) : [width, height];
  return { width: w, height: h, data: new Uint8Array(px.stdout.buffer, px.stdout.byteOffset, px.stdout.length) };
}

if (import.meta.main) {
  const file = Bun.argv[2];
  if (!file) { console.log("usage: bun run read-photo.ts <photo>"); process.exit(2); }
  const t = performance.now();
  const r = readImage(loadImage(file));
  if (!r) { console.log(JSON.stringify({ found: false, ms: Math.round(performance.now() - t) })); process.exit(1); }
  console.log(JSON.stringify({ found: true, kind: r.kind, payload: r.payloadHex, inverted: r.inverted, mirrored: r.mirrored, corrected: r.corrected, confidence: r.confidence, centre: r.centre.map(Math.round), radiusPx: Math.round(r.radiusPx), ms: Math.round(performance.now() - t) }));
}
