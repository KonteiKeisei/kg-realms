import { test } from "node:test";
import assert from "node:assert/strict";
import { framedRadius } from "../scripts/party-ui.mjs";

const image = (pixel) => { const s = 128, d = new Uint8ClampedArray(s * s * 4); for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) d.set(pixel(Math.hypot(x - 64, y - 64), x, y), (y * s + x) * 4); return d; };

test("a painted cream ring round a face is found, and its inside kept", () => {
  const framed = image((r, x, y) => r > 44 ? [226, 214, 186, 255] : [((x * 37) ^ (y * 11)) & 255, (x * 5) & 255, (y * 9) & 255, 255]);
  const inner = framedRadius(framed, 128);
  assert.ok(inner >= 40 && inner <= 46, `inner ${inner}`);
});

test("a plain portrait is left whole", () => {
  const plain = image((r, x, y) => [((x * 37) ^ (y * 11)) & 255, (x * 5) & 255, (y * 9) & 255, 255]);
  assert.equal(framedRadius(plain, 128), 0);
  const faded = image((r) => r > 60 ? [0, 0, 0, 0] : [120, 90, 60, 255]); // transparent corners, no ring
  assert.equal(framedRadius(faded, 128), 0);
});
