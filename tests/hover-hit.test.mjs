import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmLayer } from "../scripts/realm-layer.mjs";

test("source map hover queries only drawn place symbols", () => {
  const layer = new RealmLayer();
  layer.ready = true;
  layer.camera = { x: 0, y: 0, w: 100, h: 100 };
  layer.el = { clientWidth: 100, clientHeight: 100 };
  layer.options = { sourceMap: {} };
  let requested;
  layer.map = {
    getLayer: () => true,
    queryRenderedFeatures: (_box, { layers }) => {
      requested = layers;
      return [{ properties: { id: "visible" }, geometry: { coordinates: [0, 0] } }];
    },
    project: () => ({ x: 25, y: 25 })
  };
  assert.equal(layer.placeAt({ x: 25, y: 25 }, 3), "visible");
  // Area names (Realms and Geography layers, 0.77) open their place's card as a place's name does.
  assert.deepEqual(requested, ["regional-map-entries","poi-labels-overview", "poi-labels-regional", "poi-labels-local", "area-names", "area-line-names"]);
  assert.equal(requested.includes("settlements"), false);
  assert.equal(requested.includes("sites"), false);
});

test('a linked Regional map wins a hover collision with a place inside it',()=>{
  const layer=new RealmLayer();layer.ready=true;layer.camera={x:0,y:0,w:100,h:100};layer.el={clientWidth:100,clientHeight:100};layer.options={sourceMap:{}};
  const feature=(id,regionalMapEntry=false)=>({properties:{id,regionalMapEntry},geometry:{coordinates:[0,0]}});
  layer.map={getLayer:()=>true,queryRenderedFeatures:(_box,{layers})=>layers.includes('regional-map-entries')?[feature('town'),feature('dale',true)]:[],project:()=>({x:25,y:25})};
  assert.equal(layer.placeAt({x:25,y:25}),'dale');
});
