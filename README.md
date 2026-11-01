# KG Realms

Realm maps for Foundry VTT (v13 and v14, D&D 5e). Turn a world map into a living travel map: places with cards and journals, roads, rivers and sea lanes, regions, biomes, journeys planned and played out day by day, camps and watches, encounters, weather, night and seasons, and settlement maps the party can walk or ride through.

KG Realms is the engine. A world is either one you make from your own map picture, or one that comes in a world module.

## Install

In Foundry's **Add-on Modules**, choose **Install Module** and paste this manifest URL:

```
https://github.com/KonteiKeisei/kg-realms/releases/latest/download/module.json
```

Or download `kg-realms.zip` from the [latest release](https://github.com/KonteiKeisei/kg-realms/releases/latest) and extract it into `Data/modules`.

## Make your own world

1. Make a scene whose background is your world map picture.
2. In the Scenes sidebar, right-click it and choose **Make realm world**.
3. Give the world a name and the map's width in miles (from its left edge to its right). Travel times use it.
4. Wait while KG Realms backs up the scene, cuts the picture into compressed map tiles and saves the world. A map 12,000 px wide takes a few minutes. Foundry stays usable meanwhile.
5. Open the scene. It is now a realm map with nothing on it yet. Add places, roads, rivers, regions and biomes with the editors, and set a party token travelling.

The map's files are saved in Foundry's Data folder (`KG Realms Data/World/<world id>/`), outside every game world, so include that folder in your backups. Places, roads and other edits are saved in the game world itself. Right-click the scene again for:

- **Realm world settings**: its name and width in miles.
- **Revert to backup**: the scene's picture and grid come back. The world and its tiles stay saved, so making it a realm world again is quick.
- **Export as module**: a zip that installs like any world module, to keep or share.

Notes:

- Pictures larger than 16,384 px on a side are shrunk to fit (a browser limit). The picture file itself is never changed.
- Foundry does not accept `.ktx2` uploads, so tiles are saved as `.ktx2.fbx` with their bytes unchanged. Before it starts, KG Realms checks that your server keeps them intact.
- Making tiles needs Foundry opened over https or on localhost.

## World modules

A world module registers its world as KG Realms starts:

```js
Hooks.once("kgRealmsRegisterWorlds", ({ registerWorld }) => registerWorld({
  id: "my-world",            // as stored in scenes
  title: "My World",
  module: "my-world-module", // its data is at modules/<module>/data/worlds/<id>/
  mapName: "My World",
  terrainPack: "terrain-pack.json"
}));
```

**Export as module** writes one of these for you. The world API is also at `game.modules.get("kg-realms").api.registerWorld` and `.worlds()`.

## Settings worth knowing

- **Carriage ride sound**: a looping sound for the settlement carriage ride. None ships with KG Realms; empty keeps the ride silent.
- **Manage map files** (Ctrl+Shift+M): each player can save a world's map tiles to a folder on their computer instead of streaming them.

## Development

- `npm test` runs the tests. Tests that check the engine against Toril's data need the private KG Realms: Faerûn checkout beside this one and are skipped without it.
- `python tools/serve.py 8790` serves the module for the previews in `tools/*.html`, with sibling modules at `/modules/<id>/`.
- `python tools/package.py` builds the release zip in `dist/` (and a patch zip of what changed since the last release).

## Credits and licences

- [MapLibre GL JS](https://maplibre.org/) (BSD 3-Clause), `lib/maplibre`.
- Mapbox vector-tile, pbf and point-geometry (BSD 3-Clause, ISC), `lib/mvt`.
- [Basis Universal](https://github.com/BinomialLLC/basis_universal) encoder by Binomial LLC (Apache 2.0, with BSD and MIT parts), `lib/basis`. See `lib/basis/README.txt`. KG Realms is not affiliated with Binomial LLC.
- Noto Sans glyphs (SIL Open Font License), `data/fonts`.
