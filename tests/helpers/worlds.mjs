// Tests run without Foundry's startup: register Toril as KG Realms: Faerûn (the sibling checkout)
// would on the kgRealmsRegisterWorlds hook.
import { registerWorld } from "../../scripts/worlds.mjs";
import { LOCAL_MAP_ASSETS } from "../../../kg-realms-faerun/scripts/local-map-assets.mjs";
registerWorld({ id: "toril", title: "Toril (Faerûn)", module: "kg-realms-faerun", mapName: "Faerun", localMapAssets: LOCAL_MAP_ASSETS, terrainPack: "terrain-pack.json" });