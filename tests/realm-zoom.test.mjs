import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFrame, worldFloor } from "../scripts/geo.mjs";
import { homebrewSheet } from "../scripts/homebrew/plan.mjs";

// Trorune: a 16,384 x 12,288 picture on an 8,192 x 6,144 scene with no padding, on a 2,000 x 1,100 screen.
const scene = { x: 0, y: 0, width: 8192, height: 6144 }, screen = [2000, 1100];
const fit = Math.min(screen[0] / scene.width, screen[1] / scene.height) * 0.95;

test("a made world zooms out until its whole map fits the screen", () => {
  const frame = makeFrame(homebrewSheet(16384, 12288, 3277).bounds, scene);
  assert.ok(worldFloor(frame, scene, ...screen) <= fit, `${worldFloor(frame, scene, ...screen)} <= ${fit}`);
});

test("zooming stops where the map's world would no longer cover the screen", () => {
  const frame = makeFrame(homebrewSheet(16384, 12288, 3277).bounds, scene), floor = worldFloor(frame, scene, ...screen);
  // At the floor, with the camera at the canvas's left edge, the world still reaches past the screen's left edge.
  const halfScreen = screen[0] / 2 / floor;
  assert.ok(frame.ox <= 0 - halfScreen && frame.ox + frame.kx >= scene.width + halfScreen);
  // A world only twice the picture (0.74.0 and 0.74.1) stops well before the map fits.
  const small = { ...homebrewSheet(16384, 12288, 3277) };
  const s = 32768, x = 8192, y = 10240, lon = (v) => (v / s) * 360 - 180, lat = (v) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / s))) * 180) / Math.PI;
  small.bounds = { west: lon(x), east: lon(x + 16384), north: lat(y), south: lat(y + 12288) };
  assert.ok(worldFloor(makeFrame(small.bounds, scene), scene, ...screen) > fit);
});
