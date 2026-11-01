/** River names use saved waterway geometry without adding a visible path. */
export function riverLabelFeatures(waterways) {
  return { type: "FeatureCollection", features: Object.entries(waterways ?? {}).filter(([, w]) => w.kind === "river" && String(w.name ?? "").trim() && w.pts?.length > 1 && w.pts.every(p => p?.length === 2 && p.every(Number.isFinite))).map(([id, w]) => ({
    type: "Feature", properties: { id, name: w.name.trim() }, geometry: { type: "LineString", coordinates: w.pts }
  })) };
}
export function riverLabelLayer() {
  return { id: "river-labels", type: "symbol", source: "river-labels", minzoom: 5.5,
    layout: { "symbol-placement": "line", "symbol-spacing": 420, "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 5.5, 10, 8, 11.5, 11, 13], "text-offset": [0, .8], "text-padding": 8, "text-max-angle": 75, "text-keep-upright": true },
    paint: { "text-color": "#cce6f2", "text-halo-color": "#11202b", "text-halo-width": 1.3, "text-halo-blur": .3,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.2, .9] } };
}
