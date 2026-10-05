// Read an engine's run log and hold it to the conformance vectors.
//
//   bun run conformance/check-log.ts <run.log> [--engine frame]
//
// A vector passes when the log carries "PASS  <its line>". Missing or failing
// vectors are listed and the exit code is 1. Today only the FRAME reference
// engine prints these lines (chain/e2e/seeds-e2e.ts); an engine that checks a
// vector some other way adds its own column to vectors.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const log = process.argv[2];
if (!log) throw new Error("usage: bun run conformance/check-log.ts <run.log>");
const engine = process.argv.includes("--engine") ? process.argv[process.argv.indexOf("--engine") + 1] : "frame";
const { vectors } = JSON.parse(readFileSync(join(import.meta.dir, "vectors.json"), "utf8"));
const lines = readFileSync(log, "utf8").split("\n");

let bad = 0;
for (const v of vectors) {
  const line = v[engine];
  if (!line || line === "n/a" || line === "not yet" || line.startsWith("partial")) {
    console.log(`  --   ${v.id}  ${v.rule}  (${engine}: ${line ?? "no column"})`);
    if (engine === "frame") bad++;
    continue;
  }
  const hit = lines.find((l) => l.replace(/^(PASS|FAIL)\s+/, "").startsWith(line));
  const ok = !!hit && hit.startsWith("PASS");
  if (!ok) bad++;
  console.log(`  ${ok ? "ok " : "BAD"}  ${v.id}  ${v.rule}${hit ? "" : "  (not in log)"}`);
}
const n = vectors.length;
console.log(`\n${n - bad} of ${n} vectors hold for ${engine}`);
process.exit(bad ? 1 : 0);
