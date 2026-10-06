/**
 * Build the scanner: one self-contained page (scan.html → out/scan.html) with
 * the image reader bundled into a Web Worker and the mark drawing inlined. No
 * network calls, no fonts to fetch; it opens from a file, a gateway or a phone.
 */
import { drawMark } from "./mark";

const built = await Bun.build({ entrypoints: [new URL("./scan-worker.ts", import.meta.url).pathname], target: "browser", format: "iife", minify: true });
if (!built.success) throw new Error(built.logs.join("\n"));
const worker = await built.outputs[0].text();
const safe = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1");
const page = (await Bun.file(new URL("./scan.html", import.meta.url)).text())
  .replace("__WORKER_SRC__", () => safe(JSON.stringify(worker)))
  .replace("__DRAW_MARK__", () => safe(drawMark.toString()));
const out = new URL("./out/scan.html", import.meta.url).pathname;
await Bun.write(out, page);
console.log(`${out}  ${(page.length / 1024).toFixed(0)} KB`);
