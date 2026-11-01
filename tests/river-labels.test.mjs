import { test } from "node:test";
import assert from "node:assert/strict";
import { riverLabelFeatures, riverLabelLayer } from "../scripts/river-labels.mjs";
import { RealmLayer } from "../scripts/realm-layer.mjs";
test("normal map names include only named, valid rivers and use their existing path", () => {
  const r = { kind: "river", name: "River Never", pts: [[0,0],[1,1]] };
  const f = riverLabelFeatures({ r, blank: { ...r, name: "" }, wind: { ...r, kind: "wind" }, invalid: { ...r, pts: [[NaN,1],[2,2]] } });
  assert.equal(f.features.length, 1); assert.deepEqual(f.features[0].geometry.coordinates, r.pts);
  const layer = riverLabelLayer(); assert.equal(layer.type, "symbol"); assert.equal(layer.layout["symbol-placement"], "line"); assert.ok(layer.minzoom >= 5); assert.ok(!("line-color" in layer.paint));
});
test("river labels survive editor close without leaving editor paths visible", () => {
  const sources = new Map([["waterways", { setData(d) { this.data = d; } }]]), layers = new Map(), visibility = {};
  const map = { style: { _loaded: true }, getSource: id => sources.get(id), addSource: id => sources.set(id, { setData(d) { this.data = d; } }), getLayer: id => layers.get(id), addLayer: layer => layers.set(layer.id, layer), setLayoutProperty: (id, key, value) => visibility[id] = value };
  const layer = new RealmLayer(); layer.map = map; layer.ready = true; const r = { kind: "river", name: "River Never", pts: [[0,0],[1,1]] };
  layer.setRiverNames({ r }); assert.equal(visibility["river-labels"], "visible"); assert.equal(layers.size, 1);
  layer.setWaterways([{ id: "r", ...r }]); assert.equal(visibility["river-labels"], "none");
  layer.setWaterways(null); assert.equal(visibility["river-labels"], "visible"); assert.equal(sources.get("waterways").data.features.length, 0); assert.equal(sources.get("river-labels").data.features.length, 1);
  layer.setRiverNames({ r: { ...r, name: "Renamed river" } }); assert.equal(sources.get("river-labels").data.features[0].properties.name, "Renamed river");
});
