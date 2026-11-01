import { test } from "node:test";
import assert from "node:assert/strict";
import { onTop } from "../scripts/realm-layer.mjs";

test("names, markers, the journey, encounters and the flash go above the scene's effects; the ground stays under", () => {
  const top = [
    { id: "poi-labels-local", type: "symbol", source: "places" },
    { id: "river-labels", type: "symbol", source: "river-labels" },
    { id: "journey-line", type: "line", source: "journey" },
    { id: "journey-camps", type: "circle", source: "journey-camps" },
    { id: "encounter-marks", type: "circle", source: "encounters" },
    { id: "flash-ring", type: "circle", source: "flash" }
  ];
  const ground = [
    { id: "tapestry", type: "raster", source: "tapestry" },
    { id: "roads", type: "line", source: "routes" },
    { id: "waterways", type: "line", source: "waterways" },
    { id: "biome-zone-fill", type: "fill", source: "biome-zones" },
    { id: "place-glow", type: "circle", source: "places" },
    { id: "background", type: "background" }
  ];
  for (const l of top) assert.equal(onTop(l), true, l.id);
  for (const l of ground) assert.equal(onTop(l), false, l.id);
});
