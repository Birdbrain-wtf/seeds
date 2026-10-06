/** SS58 address for 32 account bytes (generic prefix 42), in plain TypeScript for the browser. */
import { blake2b } from "./blake2b";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function ss58(account: Uint8Array, prefix = 42): string {
  if (prefix > 63) throw new Error("only single-byte prefixes");
  const body = new Uint8Array(33);
  body[0] = prefix;
  body.set(account, 1);
  const pre = new TextEncoder().encode("SS58PRE");
  const buf = new Uint8Array(pre.length + 33);
  buf.set(pre);
  buf.set(body, pre.length);
  const sum = blake2b(buf, 64);
  const raw = new Uint8Array(35);
  raw.set(body);
  raw[33] = sum[0];
  raw[34] = sum[1];
  let n = 0n;
  for (const b of raw) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of raw) { if (b !== 0) break; out = "1" + out; }
  return out;
}
