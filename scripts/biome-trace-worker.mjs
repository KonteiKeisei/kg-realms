import { traceBiome } from "./biome-trace.mjs";
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: traceBiome(data.grid, data.at, data.code) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
