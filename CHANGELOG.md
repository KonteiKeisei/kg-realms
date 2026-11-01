# KG Realms changelog

## 0.81.0: exported modules carry their calendar

- **Exported modules carry their Calendaria calendar.** The export captures the calendar the game world uses, complete, with its date display formats, whether it is built in, a built-in one you edited, or your own. The export window names it, and so does the report. Pictures it uses, such as custom moon phases, go to assets/calendar. Calendaria's own stay linked.
- **Set when the module is first loaded.** The first GM to load it gets the calendar added if need be and set as active, then Foundry offers to reload. It is set once: change calendar afterwards and your choice stays, unless a new version of the module brings a different calendar.
- A built-in calendar missing from the other game world's copy of Calendaria is added from the captured copy.
- Without Calendaria, the GM is told once, and the calendar is set when Calendaria is enabled. Exported modules list Calendaria as recommended. A calendar that cannot be set says why and tries again next load.
- A world module can also name a built-in calendar in its registration: calendar: { id: "harptos", name: "Harptos" }.
- The in-game date is not part of the export.

## 0.80.0: exported modules ship compendiums

- **Exported modules ship compendiums.** Scenes, actors, journals, items, tables, macros, playlists and card decks each get a compendium, in a folder of the world's name, GM only.
  - **Everything linked comes along:** whatever a place, pin, encounter or scene links to, in any field or in card text, and whatever those link to in turn. Links into your game system's own compendiums stay as they are.
  - **Links follow:** they change to the module's compendiums, including @UUID links in text and links to journal pages. A link to something that no longer exists stays as it was and is listed in the report.
  - **Art follows:** actor, item and journal pictures are copied to assets/actors, assets/items and assets/journals, and relinked.
- **Filled on first load.** A browser cannot write Foundry's compendium databases, so the zip holds their contents as JSON, and the first GM to load the module fills them. Updating a module replaces its compendiums, so they fill again, and edits made inside them are lost: import a document to change it. A compendium that cannot be filled says why and tries again next load.
- **Scenes come from the compendium, not by themselves.** Drag the realm map in and its settlements come with it. Any scene brings its tokens' actors. A scene keeps the id its places and pins know it by.
- **Scenes keep their tokens,** except your players' own and party tokens.
- Modules exported with 0.79.0 need exporting again.

## 0.79.0: the whole world in a module export

- **Export as module now holds the whole world.** The zip works in any game world, with nothing left in this one:
  - **Its data, with every edit applied:** places (with borders, shapes and layers), roads, rivers and shores, biomes, encounters, trade, snow, custom markers and sea lore.
  - **Its scenes:** the realm map, every settlement map, and every scene its places and pins link to, and theirs. Each keeps its pins, lights, walls, regions and settlement roads. Tokens stay out, because their actors stay in this game world.
  - **Its art:** every picture and sound named anywhere in that data (card art, card galleries, pictures in card text, markers, scene maps and tiles) is copied in and its links changed. Card art and markers go to assets/poi-img, scene maps to assets/maps, sound to assets/audio. Two different files of one name are kept apart.
- **A report after every export**, also in the zip as export-report.txt: what went in, and anything that could not be carried (files that could not be read, linked scenes that no longer exist, actors and journals linked on cards).
- **A world module's scenes come in by themselves:** the first GM to load a game world with the module gets them in a Scenes folder of the world's name, keeping their ids so links hold. A scene already there is left as it is, and one you delete stays deleted.
- A large world no longer has to fit in the browser's memory all at once to be zipped. A world over 4 GB says so.
- A world module can ship its own trade prices, under any the GM sets.

## 0.78.0: made worlds move to KG Realms Data

- **Made worlds are saved outside the worlds folder.** Make realm world now saves a map's files in Data/KG Realms Data/World/<world id>/, not in the game world's folder.
- **Worlds already made move by themselves.** The next time a GM loads the game world, each one is copied to the new folder, every file read back and compared, and only then does the world switch to it. If anything fails, it says so, keeps working from its old folder, and tries again next load.
- Foundry cannot delete files, so the old folder (Data/worlds/<game world>/kg-realms/) stays until you delete it. A message names it when the move is done.
- Two game worlds with a map of the same name get a folder each.
- Places, roads, rivers, biomes and snow settings are still saved in the game world's own settings, as before.
- Include Data/KG Realms Data in your backups: Foundry's world backups do not cover it.

## 0.77.3: original picture markers

- **New picture markers.** All 71 picture markers (buildings, ports, danger, treasure, heraldry, shapes and points) are redrawn as original art, made entirely by code (tools/markers/draw-icons.py). Their names and ids are the same, so places keep the marker chosen for them.
- Grey square and grey hexagon, which were damaged in the old set, are now whole.
- Removed the scripts that cut the old markers from an image sheet.

## 0.77.2: marker sizes

- **Fixed:** picture markers (temple, gate, fortress and the rest) drew about twice the size of the round map markers on the realm map. They are now about a fifth larger than the circle, so their detail still reads. The Map marker size setting still scales them all.

## 0.77.1: border fixes

- **Fixed:** on the map editor's Places tab, Close the shape, Open the shape, Remove border, and the Shape and Layer buttons did nothing (the panel stopped with an error before saving). They work again.
- **Fixed:** exported places left out a border's "ends apart", so the export looked closed, and importing it closed the border. Exports now keep it.
- Selecting an area or line in the map editor switches the map to its layer, so its border and name can be seen.
- A selected area or line shows its name at a gold handle (the place's own point). Drag the handle to move the name.
- Closing a border with the name outside it moves the name inside, to the middle of its widest stretch (a bay or crescent's centre can lie outside it).

## 0.77.0: map layers

- **Map layers.** A layers rail on the travel panel's left edge unfolds into three layers, and the realm map shows one at a time. Each viewer chooses their own; Places is the default.
  - **Places:** settlements, keeps, castles, ruins, temples, mines, ports, lighthouses, peaks, volcanoes, caves, passes. Single points a party can travel to.
  - **Realms:** kingdoms, empires and regions: who holds the land. Each shows its border, a light wash of its colour and its name spread wide in capitals.
  - **Geography:** forests, mountain ranges, hills, deserts, marshes, glaciers, seas, bays, gulfs, straits, lakes and rivers: what the land and water are. Land in green, water in blue, names in italic.
  - A place shows only on its own layer. The journey, roads and rivers show on every layer. Road and Trail names are on no layer (roads carry their own names).
- **Shape and Layer** (map editor, Places tab, on the selected place): a place is a Point, an Area or a Line, on Places, Realms or Geography. Its type gives the default (an Island is a point, a Kingdom an area, a River a line); each can be changed for one place.
- **Drawing a border:** Draw border, then click the map to add corners. Click the first corner to close it (an area), or press Enter or double-click to leave its ends apart (a line: a strait, a mountain spine, a border line). Drag a corner to move it, click an edge to add one, right-click a corner (or select it and press Delete) to remove it. Open the shape, Close the shape and Remove border do as they say.
- Faerûn's 102 area records (regions, lakes, seas) show as their rectangles until a border is drawn.
- Hovering an area's name opens its place card, as a place's name does.
- Exported places carry their shape, layer and border.
- tools/preview.html?layer=realms (or geo, places) shows a layer outside Foundry.

## 0.76.0: names above effects

- **Names above effects.** The realm map's names and markers, the journey (its line, camps and stop names), encounter markers and the search flash are drawn above the scene's effects. A region's water filter (FXMaster) or the weather now ripples the sea and the land, never the sea's name or the route across it. The map is drawn as two layers following one camera: the ground under the effects, the rest above.
- New setting, **Names above effects** (on by default, each player's own). Off: the map is drawn as one picture under the effects, as before, which is a little lighter on the computer.
- tools/preview.html?split=1 draws the realm map split this way outside Foundry.

## 0.75.6: each world's map files and lore are its own

- **Each world's map files are its own.** The map files window (Ctrl+Shift+M) names the world on screen, and each world's map is streamed or saved on its own. A player who saved Faerûn's map to a folder saw nothing on a world made from your own map: KG Realms read only from the folder, which held Faerûn's tiles. Now a world not saved in the folder streams from the server, and a world saved there still reads only its saved files (a missing one is a repair, as before). One folder holds every world's saved files. A choice saved before this version stays Faerûn's.
- **The Rules tab's sea lore is the world's.** "Sword Coast winds", the Moonshae current and the storm season showed in every world. The tab now gives the general rule for winds and currents; a world module adds its own lore (KG Realms: Faerûn 1.0.2 brings the Sword Coast's back).

## 0.75.5

- **No way overland? By boat.** When a leg has no way overland (an island, a port cut off by water), the journey goes by boat if water joins its two ends, and the route sheet says so ("No way overland: going by boat"). Before, the journey simply had no route.
- **Leaking shorelines are named.** A shoreline whose water runs round an open end (or through a gap) into the land on its other side is marked in the Waterways list, the tab says how many leak, and the selected one says how to fix it. Leaked water once turned the land round a city into sea, with no word anywhere.
- Roads already ignore what lies under them, so a road over water (a bridge, a causeway) is always passable; since 0.75.4 the short step from a road onto a place on the water is too.

## 0.75.4

- Fix: a journey could not end (or start) at a town on the water's edge, such as a port drawn on the coast. Its point lies in a water cell, and the way overland refused any step that touched water, even the last one onto the town, so no route was found and the route vanished from the travel panel. Water within about 2 miles of either end no longer blocks the way; water further along still does.
- When no route can be found, the travel panel says which leg has no way, what each of its ends stands on (land, or water from the map, a shoreline's water side or a painted biome), and still lists the stops, start included, instead of showing nothing. The console (F12) logs the stops' positions with it ("kg-realms | no route").

## 0.75.3

- A world made from your own map no longer logs "404 (Not Found)" for encounters.json and local/index.json: it gets those files, empty. Worlds made earlier get them the next time the GM loads the game. (The 404s did no harm: KG Realms reads a missing file as none.)

## 0.75.2: setting a route's end

- **Clicking a place's name picks the place.** A click on a place's name or marker while editing a route snaps to it. Before, only a click within a few pixels of its marker did, so clicking a name made a "Wilderness" stop beside it.
- **Clicking the map sets where the journey ends.** The first click sets the end; a later click off the route moves the end there (stops in between stay), and the route takes the best roads to it. Before, every click was added after the last, so the end kept changing to the last thing clicked.
- **Shift+click a place** puts it into the journey as a stop, in the leg where it adds the least way.
- **Go on from here** (on the last stop in the route sheet) keeps the end as a stop and lets the next click set a new end beyond it.
- Click the route to add a point, then drag it to pull the path that way, or onto a place to stop there (as before).
- **A route that cannot be worked out says so** in the travel panel, with the reason, instead of showing an empty route sheet.

## 0.75.1

- Snow tab: the mountains, hills and patchy edge boxes were squeezed to a sliver. Each is now a full box with its unit beside it, high ground has its own box, every "?" sits beside its heading, and the sliders are all one length.

## 0.75.0: snow for each world, shorelines with water, lists of places and roads

- **Snow tab** (map editor): each world's realm map snow, saved for that world. Snow at the north pole only (the default), the south pole only, both, or neither: each pole has its own tickbox. For each pole: how far across the map it reaches at the depth of winter, how far it draws back by midsummer, and how wide its patchy edge is. The month its winter is deepest; with snow at both poles, the south's falls half a year after the north's unless you untick "The south's seasons are reversed". How many miles further mountains and hills hold snow. The map shows the snow as you change it, and "See the snow in" shows any month without changing the date. Snow is drawn only on realm maps.
- Toril keeps its month-by-month snow line until you change it; **Set my own** starts from it.
- A world exported as a module takes its snow settings with it.
- **Shorelines say where the water is**: give a shoreline a water side (pick it from the list, or **Click the water side** and click the map). The water runs out from that side to the next shoreline or the map's edge, so ships sail on it and snow stays off it. A map made from your own picture knows its water only this way. A new shoreline asks for its water side when you finish it.
- **Islands and lakes**: click a shoreline's first point while drawing to close it into a loop, or use **Close into a loop** on one already drawn. A loop's water is inside (a lake) or outside (an island).
- **Places tab**: every place on the map in a list, by kind then class (Settlements, then City, Town...), each section opening and closing, with a box to find a place by name. Click one to select it and centre the map on it.
- **Roads tab**: every road and trail in a list, named ones A to Z and the unnamed ones in their own group, with each one's length and ends. Click one to select it and centre the map on it.
- Made worlds now have a terrain grid (plains, plus your shorelines' water), so snow and ships work on them.
- tools/snow-test.html draws the snow on any realm map picture outside Foundry.

## 0.74.3

- Fix: after 0.74.2 moved a made world, its map went black (only weather showed) until the next full reload, and a cached copy of the world's index could keep it black after one. The map's placement and its tiles' list are now read again when either changes.
- Realm scenes always zoom out until the whole map fits the screen by its longest side (as the Zoom/Pan Options module does for Foundry's own limit). The old limit, a web map at least 2.6 screens wide, is now exact: zooming stops only where the map would start to slide against the scene.

## 0.74.2

- Fix: a realm world made from your own map could not zoom out far enough to see the whole map. Made worlds now sit in a web map four times the picture's size. Worlds made with 0.74.0 or 0.74.1 that have nothing placed on them yet are moved over when the GM next loads the game (their map tiles are kept); you will see "can now zoom out to its whole map".

## 0.74.1

- Fix: Make realm world stopped at "Save the world" with "could not save routes.geojson". Foundry does not accept .geojson uploads, so a made world's roads are saved as routes.json.
- Make realm world: the map width in miles starts from the scene's grid when it is measured in miles (for example 40 miles per 100 px on an 8,192 px picture is 3,277 miles).

## 0.74.0: the first public release

KG Realms is now an engine for realm maps of any world. Worlds come in their own modules, or you make one from your own map picture.

- **Make realm world**: right-click a scene with a map picture in the Scenes sidebar and choose Make realm world. Give the world a name and the map's width in miles. KG Realms backs up the scene to a "KG Realms backups" folder, cuts the picture into compressed map tiles in your browser (KTX2, with a progress window you can stop), saves the world in this game world's data folder, and turns the scene into a realm map. The realm starts empty: nothing is read from the picture. Add places, roads, rivers, regions and biomes with the editors.
- **Afterwards**, the converted scene's right-click menu has **Realm world settings** (name and width in miles), **Revert to backup** (the scene's picture and grid come back; the world and its tiles stay saved, so converting again skips making tiles) and **Export as module** (a zip that installs like any world module).
- **No world installed**: the GM's notice now points to Make realm world.
- **Carriage ride sound**: none ships with KG Realms. Choose your own in the settings (Carriage ride sound); empty keeps the ride silent.
- **World modules** can bring their own default custom markers.
- Tile pictures larger than 16,384 px on a side are shrunk to fit (a browser limit); the picture file is never changed. Foundry does not accept .ktx2 uploads, so tiles are saved as .ktx2.fbx with their bytes unchanged; exported modules use .ktx2.
- Uses Binomial's Basis Universal encoder (Apache 2.0, lib/basis) to make the tiles.
- Fix: the realm terrain loaded only the first world's tiles in a session; a scene from another world now loads its own.

Earlier versions (0.1.0 to 0.73.0) were private development builds.
