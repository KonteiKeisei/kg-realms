// Runs the tests: node tools/test.mjs (or npm test). Some tests check the engine against Toril's data,
// read from a KG Realms: Faerûn checkout beside this one (private). Without it they are skipped.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEEDS_FAERUN = new Set([
  "biome-defaults", "entrance-setup", "label-hits", "local-icon-packs", "local-image-migration", "local-map-effects",
  "local-map-lods", "local-map-renderer", "local-maps", "local-season-navigation", "map-assets", "preset-refresh",
  "routes", "terrain-pack", "trade", "travel", "trip"
].map((n) => `${n}.test.mjs`));
// KG_REALMS_NO_FAERUN=1 runs as a checkout without it would.
const faerun = !process.env.KG_REALMS_NO_FAERUN && fs.existsSync(path.join(root, "..", "kg-realms-faerun", "module.json")) && fs.existsSync(path.join(root, "data", "worlds", "toril", "index.json"));
const all = fs.readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".test.mjs")).sort();
const run = all.filter((f) => faerun || !NEEDS_FAERUN.has(f));
if (!faerun) console.log(`KG Realms: Faerûn is not beside this checkout: ${all.length - run.length} test files that use Toril's data are skipped.`);
const result = spawnSync(process.execPath, ["--test", ...run.map((f) => path.join("tests", f))], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
