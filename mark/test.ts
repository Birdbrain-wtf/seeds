import { accountBytes, markSVG, decodeSVG, unanchoredPayload, toHex, check, type Kind } from "./mark";
import vectors from "./vectors.json";
import { blake2b } from "./blake2b";
import { ss58 } from "./ss58";
import { checkBits } from "./read-image";

let n = 0, fail = 0;
const ok = (c: boolean, m: string) => { n++; if (!c) { fail++; console.log("FAIL", m); } };

// round-trip: random payloads, both kinds, plus the edge cases (all zero, all ones, wrap-around runs)
const edge = [new Uint8Array(32), new Uint8Array(32).fill(0xff), new Uint8Array(32).fill(0x81), new Uint8Array(32).fill(0x55)];
const pays = [...edge, ...Array.from({ length: 300 }, () => crypto.getRandomValues(new Uint8Array(32)))];
for (const p of pays) for (const kind of ["anchored", "unanchored"] as Kind[]) {
  const d = decodeSVG(markSVG({ kind, payload: p }));
  ok(d.kind === kind && d.payloadHex === toHex(p), `round-trip ${kind} ${toHex(p)}`);
}

// a single flipped cell is caught by the check (or reads as different bytes, never silently as the same)
const p = crypto.getRandomValues(new Uint8Array(32));
const svg = markSVG({ kind: "anchored", payload: p });
const tampered = svg.replace(/<path d="M[^"]*A21 21[^"]*"\/>/, "");
ok(tampered !== svg, "tamper removed a cell");
let caught = false; try { decodeSVG(tampered); } catch { caught = true; }
ok(caught, "flipped bit with stale check is refused");

// frozen vectors: same inputs must give the same bytes and check on every machine
for (const v of vectors.vectors) {
  const payload = v.kind === "anchored" ? Uint8Array.from(Buffer.from(v.account!.slice(2), "hex")) : unanchoredPayload(v.profile!, v.slug!);
  ok(toHex(payload) === v.payload, `vector payload ${v.name}`);
  ok(check(v.kind as Kind, payload) === parseInt(v.check, 16), `vector check ${v.name}`);
}
// SS58 and hex give the same bytes (Alice's well-known dev address)
const alice = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
ok(toHex(accountBytes("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY")) === alice, "SS58 decodes to the account");
let bad = false; try { accountBytes("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQZ"); } catch { bad = true; }
ok(bad, "SS58 with a broken checksum is refused");
// the browser's own blake2b, SS58 and check bits agree with Bun's native ones
for (const len of [0, 1, 63, 64, 127, 128, 129, 300]) {
  const d = crypto.getRandomValues(new Uint8Array(len));
  for (const [alg, out] of [["blake2b256", 32], ["blake2b512", 64]] as const) {
    const h = new Bun.CryptoHasher(alg); h.update(d);
    ok(Buffer.from(h.digest()).equals(Buffer.from(blake2b(d, out))), `blake2b ${alg} on ${len} bytes`);
  }
}
ok(ss58(accountBytes("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY")) === "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", "SS58 encodes back");
for (const p of pays.slice(0, 50)) for (const kind of ["anchored", "unanchored"] as Kind[]) ok(checkBits(kind, p) === check(kind, p), "check bits agree");
console.log(`${n - fail} of ${n} checks pass`);
process.exit(fail ? 1 : 0);
