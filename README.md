**Disclaimer, this module was coded entirely with AI**

**The Ideas, UX/UI, functionality decisions, and testing however were all done by human ass hands**

**Sub Disclaimer** - AI wont stop messing with my handwritten text however, no matter how hard i try. BAD MACHINE SPIRITS.

# KG Realms

<img width="1580" height="1136" alt="image" src="https://github.com/user-attachments/assets/c18f6c66-5c9e-49ad-93f5-5ff995b18993" />

Travel maps for Foundry VTT v13 and v14 (D&D 5e). A realm map holds places, roads, rivers, sea lanes, areas and biomes. Parties plan and run journeys on it, with camps, watches, encounters, weather, day and night, seasons, and settlement maps they can walk or ride through.

A world comes from your own map picture or from a world module.

## Install

Foundry **Add-on Modules** > **Install Module**, manifest URL:

```
https://github.com/KonteiKeisei/kg-realms/releases/latest/download/module.json
```

Or extract `kg-realms.zip` from the [latest release](https://github.com/KonteiKeisei/kg-realms/releases/latest) into `Data/modules`.

## Make a world from a map picture

1. Create a scene with the map picture as its background.
2. Scenes sidebar: right-click the scene > **Make realm world**.
3. Enter a name and the map's width in miles, left edge to right edge. Travel times use it.
4. KG Realms backs up the scene, cuts the picture into compressed tiles and saves the world. A 12,000 px map takes a few minutes; Foundry stays usable.
5. Open the scene and add places, roads, rivers, areas and biomes with the editors.

Storage:

- Map tiles: `Data/KG Realms Data/World/<world id>/`, outside any game world. Back this folder up.
- Places, roads and other edits: the game world.

Scene right-click menu:

- **Realm world settings**: name and width in miles.
- **Revert to backup**: restores the scene's picture and grid. The world and tiles stay, so converting again is quick.
- **Export as module**: a zip that installs as a world module.

Limits:

- Pictures over 16,384 px on a side are scaled down to fit (browser limit). The source file is not changed.
- Foundry rejects `.ktx2` uploads, so tiles are saved as `.ktx2.fbx` with unchanged bytes. KG Realms checks first that the server keeps them intact.
- Making tiles requires Foundry over https or on localhost.

## World modules

A world module registers its world at startup:

```js
Hooks.once("kgRealmsRegisterWorlds", ({ registerWorld }) => registerWorld({
  id: "my-world",            // as stored in scenes
  title: "My World",
  module: "my-world-module", // data at modules/<module>/data/worlds/<id>/
  mapName: "My World",
  terrainPack: "terrain-pack.json"
}));
```

**Export as module** generates this. The same API is at `game.modules.get("kg-realms").api.registerWorld` and `.worlds()`.

## Regional maps

A regional map is a detailed map placed under part of a realm as an aspect-matched rectangle. Inside it, regional scale and terrain set travel times, including for journeys that cross its edge. Both views share one journey. Setup: [Regional map setup and travel](docs/regional-maps.md).

Terms: **Areas** are Domains and Territories, each with its own border. **Regional maps** are the detailed maps under a realm. **Regions** are Foundry's own scene feature and are unrelated.

## Notes for GMs

- **Encounter previews**: hover a red encounter dot on a realm or regional map for its description, Perception DC and GM notes; double-click for the full card. GM-only cards have an orange-yellow outline and a GM only badge. Players' maps don't show these dots or cards, whatever the encounter's discovery setting.
- **Party token outlines**: Configure Settings > KG Realms > Party token appearance > Configure token outlines. The colour applies to the outer outline and portrait borders.
- **Carriage ride sound**: optional looping sound for settlement carriage rides. None ships; empty means silent.
- **Manage map files** (Ctrl+Shift+M): each user can store a world's map tiles in a local folder instead of streaming them.

## Credits and licences

- [MapLibre GL JS](https://maplibre.org/) (BSD 3-Clause): `lib/maplibre`.
- Mapbox vector-tile, pbf and point-geometry (BSD 3-Clause, ISC): `lib/mvt`.
- [Basis Universal](https://github.com/BinomialLLC/basis_universal) encoder by Binomial LLC (Apache 2.0, with BSD and MIT parts): `lib/basis`, see `lib/basis/README.txt`. KG Realms is not affiliated with Binomial LLC.
- Noto Sans glyphs (SIL Open Font License): `data/fonts`.
