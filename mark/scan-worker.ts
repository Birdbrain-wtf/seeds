// Runs the reader off the page's main thread: pixels in, a read (or null) out.
import { readImage, checkBits } from "./read-image";
import { ss58 } from "./ss58";

self.onmessage = (e: MessageEvent<{ id: number; width: number; height: number; data: Uint8ClampedArray }>) => {
  const { id, width, height, data } = e.data;
  const r = readImage({ width, height, data });
  (self as any).postMessage({ id, read: r && { ...r, payload: Array.from(r.payload), address: r.kind === "anchored" ? ss58(r.payload) : null, check: checkBits(r.kind, r.payload) } });
};
