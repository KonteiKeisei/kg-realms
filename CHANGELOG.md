# KG Realms changelog

## 0.93.1: transparent party surround and GM outline colour

- Remove the dark donut band and inner band edge around party portraits. Keep a single outer outline with a layered additive glow matching the travel trails.
- Add Party token appearance in module settings. The GM chooses one world-wide colour for the outer outline, its glow and all member portrait borders. Changes redraw on clients without reloading portrait images.
- Preserve portrait positions and the central party artwork. Glow uses simple strokes rather than blur filters or an animation timer.

## 0.93.0: rectangular region placement and road crossings

- Choose the detailed map first, then place its aspect-matched rectangle on the parent realm. Drag to move, Alt + mouse wheel to resize, and Use this rectangle to save. Regional scale remains independent. Four-corner registration is automatic; three-landmark refinement remains available.
- Generate named road/trail crossing markers on both maps from parent routes crossing regional coverage. Regional road drawing snaps to these markers. Crossings refresh from the parent road data when maps load or plans are rebuilt.
- Clip realm journey lines and encounter/camp/party overlays to the regional footprint and picture. Trips outside the region no longer appear on its map. Repeated visits render as separate path segments.
- Regional POI coordinates remain independent of realm marker coordinates. Existing maps can be repositioned without rebuilding their tiles.
- Across-country and flying paths can cross any rectangle edge; road/trail endpoints are provided as explicit construction handles. Regional-only waterway routing remains deferred.

## 0.92.3: allow imperfect regional alignment

- Remove the rejection when a realm coverage outline extends outside the aligned regional picture. Cartographers' outlines do not have to match.
- Keep regional distance throughout the selected coverage. Beyond the detailed picture, retain realm roads and terrain as a fallback, split routing at the picture edge, and identify the fallback in the HUD.
- Keep regional token mirrors within the detailed picture. The authoritative realm token and journey continue through unmatched coverage.
- Include the regional setup controls, dialog labels and expanded instructions from 0.92.2. Existing detailed maps can be linked through Regional map settings without rebuilding their tiles.

## 0.92.2: regional setup controls and instructions

- Add Draw regional coverage directly to Map editor > Places, visible before selecting a place. Choose an existing region or name a new one, place its label, and draw its coverage on the map.
- Regional coverage drawing has an explicit Finish closed coverage action. Enter closes it, three corners are required, and cancelling a redraw preserves the previous outline.
- Make regional map now opens a correctly named regional dialog, labels its name field and build action correctly, and explains that parent linking and inherited POIs follow tile creation.
- Expand the setup guide with exact buttons, map clicks and closing actions, including the manual steps for users still on 0.92.0. Missing-outline errors identify the coverage tool.

## 0.92.0: connected regional maps

- Add a regional travel-map type beneath a realm, with independent scale, coverage and three-landmark alignment. Create it from a scene picture with Make regional map, or link an existing map through Regional map settings.
- Combine realm and regional roads in one journey. Regions own distance and terrain inside their outline, including through-travel, reverse travel, several regions and repeated entry/exit. Route selection compares true travel costs, including roads around coverage.
- Share canonical POI metadata while retaining separate marker positions. Inherit parent POIs, optionally publish approximate regional markers to the realm, and find regional destinations from the Travel panel.
- Share the parent journey, camps and party controls across realm and regional views. Regional group-token mirrors follow the selected party during entry and exit. Linked views do not insert an away pause.
- Use regional encounter reach distances and record border transitions in the travel log. The HUD identifies the current scale and opens either map view.
- Save new itineraries at departure so map edits cannot retime active regional travel. Existing journeys retain their earlier calculation. Missing regional data blocks new plans instead of silently using realm distances.
- First version: one regional level, separate non-touching outlines, affine alignment, and realm-based water routes. Regional-only waterway routing and automatic cross-map boat suggestions are deferred. Setup and validation details are in docs/regional-maps.md.

## 0.91.4: journey, map and panel fixes

- **Fixed:** background journeys use their own world's coordinates and distance scale, including shoreline and lake checks, when the GM views another world.
- **Fixed:** switching worlds pauses an active map download after its current transfers finish. Saved files can be resumed later. Late manifest responses and queued tile requests retain the correct world and file source.
- **Fixed:** overlapping map rebuilds cannot overwrite each other's tile files. Regeneration runs on the primary GM, blocks a second build of the same world, and checks for a newer map before publishing. The Background Image changes from 0.91.3 are retained.
- **Fixed:** player camp requests use Foundry's User document updates to identify their sender. Watch edits validate party members and values, task choices check actor ownership, and requests from an earlier camp are rejected.
- **Fixed:** Progress only no longer names the final destination in the travel panel's title.
- **Changed:** travel updates reuse unchanged controls and update the changed parts of the panel, preserving keyboard focus during clock updates.
- **Fixed:** floating panels stay within the viewport when moved or resized near its bottom edge.

## 0.91.3: Background Image back in the scene config

- **Fixed:** Foundry's Background Image is back in a realm map's scene config, and saves with the scene as usual. The Map picture box that replaced it is gone: it could not be saved.
- **Regenerate map tiles from this picture** sits right under Background Image and uses the picture there, saved or not. Once the tiles are made, the field empties again, and the panel notes which picture they came from.
- If a picture cannot be read, the message now says which path it tried.

## 0.91.2: new art keeps its detail

- **Changed:** Regenerate map tiles keeps all the detail of a bigger picture, as finer levels of tiles shown when you zoom in. The canvas, the map's scale and everything on it stay exactly as they are. Any picture is fitted to the map's shape.

## 0.91.1: only the tiles change

- **Changed:** Regenerate map tiles now replaces only the tiles. Any picture is fitted to the map's existing size and shape, so the canvas, scale and coordinates stay exactly as they are and everything on the map lies over the new art. For a larger map, make a new scene.

## 0.91.0: a better map picture

- **New:** got a better map picture? Open a made realm map's scene config. Map picture and **Regenerate map tiles from this picture** are where Background Image was.
- Places, roads, rivers, shorelines and journeys stay on the same spot of the map. The map doubles in size as needed to hold all of a bigger picture, up to 16,384 px.
- A picture of a different shape asks first, because it would be stretched to fit.
- The current map keeps working while the tiles are made. Stopping or a failure leaves it unchanged. When it finishes, everyone's game reloads.

## 0.90.2: route points in their place

- **Changed:** route points are always in view, above the stop they lead to, each with its name and a remove button. They are no longer folded into one list after the route.
- **Fixed:** "Places on this leg" no longer shows when there are none.
- **Changed:** the ship line no longer repeats the Boat list. It only says you can drop a ship there.

## 0.90.1: stop controls back in view

- **Fixed:** an opened stop in the travel panel hid its own controls. Stay, Show on the map, Bypass, Remove this stop and Places on this leg were stuck behind the rows below, leaving a blank gap.
- **Changed:** the "no boat option" line says which stop it means, for example "The stop before this one, Wilderness, has no port or drawn river".

## 0.90.0: UX overhaul

The travel panel is reorganized around one layout: the plan scrolls in the middle, and what to do now stays pinned at the bottom.

- **What now is always in the same place:** the day, the progress bar, where the party is and the buttons. Any decision (a town, an encounter, the end of the day) appears right above it, with its own buttons.
- **One row per stop:** handle, number, name, how the party gets there, miles, days and arrival day. Click a row to open it: Land or the ways by water, boat or method, fare, stay, Bypass and Remove. Places passed fold away inside it.
- **Setup and the journey:** how the party travels is one line, with the full form behind Setup. The journey's totals are a labelled list, open while planning and folded on the way.
- **A Camp tab:** it appears for setting up camp and the night, then hands back to the route in the morning. While the camp scene runs the night, the panel keeps only a summary.
- **Clearer words:** Pause travel and Paused replace Stop travel and Stopped, Skip to next encounter and Skip to next camp say they move time, Not started replaces Not set off, Camp ends at replaces Ready at, and Undo route change shows only when there is one. The panel now says that the party moves as time moves on.
- **Clearer problems:** when a leg has no way, its row says so, with the fix and a way to change it. Encounters off the route have their own list.
- **New buttons:** Enter (the town you arrived at) and New journey when the party arrives.
- **Fixed:** a player set to see Progress only could read every stop ahead in the panel. They now see only the stops already reached.
- More "?" rule tips: what players see, and noticing an encounter.

Also in this release:

- **Picture icons on the map are smaller:** they now match the circle for the same kind of place.
- **One fold symbol everywhere:** a caret pointing right when shut and down when open, in every collapsible list and section, editor included.

## 0.89.2: blue on the water

- **Changed:** the route line on the map is blue on any leg going by boat, by sea or by river, and stays gold on land. It works in day and night view.

## 0.89.1: closed coasts always work

- **Fixed:** a closed shoreline now always works. With its water side set to Outside the loop, everything outside it is sea and everything inside it is land. Inside and outside now come from the loop's shape, so a wiggly coast can't confuse them.
- **Fixed:** the false "Its water leaks" warning no longer appears on closed loops. Only an open shoreline can leak.
- Loops inside loops work: the smallest loop around a spot decides, so a lake in the land and an island in the lake are both right.

## 0.89.0: the new route panel

- **New route flow:** pick where the journey ends first, by searching or clicking the map. After that, every click on a place adds a stop, or use the Add stop button, which also has a search box.
- **Reorder by dragging:** each stop not yet reached has a handle. Drag it up or down the list, or press the up and down arrows on it. This replaces Earlier and Later. Go on from here and Shift+click are gone.
- **Land, Sea route, River route, River and sea:** each leg between boarding points shows the options that exist, with miles and days on each. River and sea lists its two parts underneath.
- **It says where you board and land:** "The party boards at the port of Arine and lands at the port of Wakeflow, the next stop."
- **Bypass a stop:** when a boat goes to a stop and can go on, Bypass keeps the party aboard to the next stop. The bypassed stop stays in the list with a Stop here button to undo it.
- **Road crossing a river:** when the road crosses a drawn river that reaches the next stop and the boat is sooner, the leg offers the river route from the crossing, or Stay on the road.
- The Rules tab has a new By water section, with a ? on each leg's question.

## 0.88.5: boats on rivers

- **Fixed:** a stop on a drawn river can take a boat. A stop within 3 miles of a river boats can use says "On the river Oban: boat travel available", and its legs offer By boat, to a port or to another stop on a river.
- The leg's list and ship line name both ends: "By boat, the river Oban to port of Karackas".

## 0.88.4: a port is a port

- **Fixed:** a port is a port. Any leg between two ports can go by boat, every time. The "No water joins these ports" message is gone.
- A ship heads out from the port: into the water if the port is on it, down a river if one runs through it, otherwise in a straight line to the nearest water.
- A strait too narrow for the route finder, or a shoreline drawn across a bay, no longer stops a voyage. The ship goes through by the shortest way.
- **Changed:** the panel names the port wherever sea travel comes up: "Port of Arine: sea travel available" on the stop, "By boat, port of Arine to port of Wakeflow" in the leg's list and on the ship line.

## 0.88.3: ports work

- **Fixed:** a settlement marked as a port now works as one. A ship finds the nearest water even if the port was placed well inland (up to 100 miles).
- **Fixed:** a party in town couldn't sail from its port unless within a mile of the marker. A stop now counts as at a port within 5 miles, the same distance that counts as being in that town. A stop named for a port counts wherever it stands, so moving the place later doesn't break it.

## 0.88.2: stops say where they are; the party stays visible

- **Route stops show their domain and territory**, under the stop's name: "In Empiria, Salvae Empire". It comes from drawn borders and Part of links, so a stop outside every drawn border shows nothing.
- **The party token stays visible when zoomed out.** On a realm map it never draws smaller than about 40 pixels on screen. Its picture and portraits grow from its middle, and it can be clicked at that size. Its position and its size in the scene don't change.

## 0.88.1: wagon and coach deals

- **Wagon and coach deals.** In the journey setup, each one can be Party pays, Free ride, or paid: Paid to guard for a wagon, Paid as escort for a coach. Rates are copper per mile per party member. Wagons start as a free ride, and coaches at the book's 3 cp. Pay is shown on each leg and in the journey's totals, the same way fares are.
- Encumbrance and slow walkers don't slow a wagon or coach. The rules now say so.
- Rewrote the wagon, coach and fare rules.
- **Go on from here** only shows while editing the route.
- **Fixed:** journey names used the whole location line ("In Arine, Empiria, Salvae Empire to Karackas"). They now read "Arine to Karackas".

## 0.88.0: wagons and coaches keep to the road

- **Wagons and coaches keep to roads and trails.** They no longer go across country, however much shorter it is. A stop must be beside a road: within 3 miles, or a marker's width on a large map. If it is not, or no road joins two stops, the panel says which and how far, and suggests moving the stop, drawing a road, or choosing another way for that leg.
- **Coaches are faster on roads.** 6 mph at normal pace, because a coach changes horses at stations. The speed can be changed when Coach is chosen. Pace scales it, and on trails a coach keeps the travel pace. This is a house rule, and its "?" says so: the book gives a coach wagon speed.

## 0.87.3: Go on from here fits

- **Fixed:** on a route's last stop, Go on from here broke across three lines and pushed Earlier off the edge. It now stays on one line, and a stop's tools wrap when the panel is narrow.

## 0.87.2: where a place sits, on its card

- **Place cards say where a place sits, in a sentence**, under its name: "A settlement in Empiria, a territory of the Salvae Empire". A natural feature adds what it crosses. A place that is part of nothing says nothing. This replaces the Part of and Crosses rows from 0.87.0. Players never see a hidden domain or territory in it.

## 0.87.1: a nested list

- **The Places list nests domains and territories.** One section, Domains and territories, shows each with what is part of it folded beneath, by its Part of link or by the borders around it. A country holds its states, and they their counties. A search lists matches flat, and selecting one opens the way to it.

## 0.87.0: domains, territories and Part of

- **Domains and territories.** Territory/Domain becomes two kinds. A **Domain** is the top level: a country or empire. A **Territory** is anything below one, at any depth and of any type: a state, a county within it, a region. Existing places split by their type: Empire, Kingdom, Country, Republic and the like are domains; Region, State, County, Province and the like are territories. A kingdom under an empire is a territory: set its Kind so.
- **Part of.** On a selected territory (Places tab), choose the domain or territory it belongs to: Empiria is part of the Salvae Empire. Territories nest as deep as you like. Choices that would go round in a circle are not offered, and a domain has nothing above it.
- **Everything else works it out.** A settlement or site inside a drawn border knows it is part of that territory and everything above it, with no link of its own. A territory with no link knows from a larger border around it.
- **Natural features may cross boundaries.** One with an outline is part of whatever holds all of it, and says what else it crosses. One without an outline goes by its point.
- **Shown** on place cards as Part of and Crosses, on the selected place in the Places tab, and in the location line: "In Empiria, Salvae Empire, in Rawlinswood near Arine". Players never see a hidden domain or territory in any of these.

## 0.86.0: Territory/Domain

- **A new kind of place: Territory/Domain.** Empires, kingdoms, provinces and regions were natural features, which they are not. They now have their own kind, in the Kind list, in Add place, and in their own group in the Places list. A new one starts as a Region, on the Realms layer.
- **Existing places move by themselves:** a natural feature whose type is a realm's (Region, Macroregion, Kingdom, Empire and the like) now reads as a Territory/Domain. It shows on the same layer as before, with no marker, and is still no travel stop or road target.
- **You can say otherwise:** set Kind back to Natural feature (The Steppes, say) and it stays one, on the Geography layer.
- A new natural feature now starts on the Geography layer, not Realms.

## 0.85.0: shared borders

- **Borders are shared, whichever came first.** An outline defined on a shoreline, a biome zone or a place can be used by the other two. They keep a link, not a copy, so reshaping the one moves all that follow it.
  - **Places** (Places tab, Border): follow a shoreline, a biome zone or another place, with those of its name first.
  - **Biome zones** (Biomes tab, on a selected zone, Border): follow a shoreline or a place. Make a place makes a place from the zone.
  - **Shorelines** (Waterways tab, on a selected shoreline, Border): follow a biome zone or a place. New shoreline from makes a new one from either.
- It is always your choice: nothing links by itself. Its own border stays the default, and leaving a shared border keeps a copy to change on its own.
- A shared outline's corners are edited only where it is defined, and the panel says which tab that is. Links that would go round in a circle are not offered.
- If an outline is deleted, or stops closing, what follows it says so. A place keeps its point, a shoreline keeps its last line, and a biome zone turns off until it has a closed outline again.

## 0.84.0: places follow shorelines; lakes take their land's weather

- **One outline, drawn once.** A place can follow a shoreline, so there is no need to draw the same contour again for a place and a biome.
  - **Make a place** on a shoreline's panel makes a place of its name: a Lake if its water is inside, Islands if outside, a Coast if its ends are apart. If a place of that name already exists, you are asked whether to link it instead.
  - **Border** on a selected place (Places tab) offers "Its own border" or any shoreline, with those of its name first. It is your choice and nothing links by itself.
  - Reshape the shoreline and the place's border and any biome zone follow. Its corners are edited on the shoreline. Choosing "Its own border" keeps a copy to change separately. A shoreline that stops closing takes the biome zone with it, and you are told.
- **A lake has the weather of the land around it.** A party on inland water gets the climate of the commonest biome just outside it, not the Open Sea's. Inland water is a closed shoreline with its water inside, or a Lake with a closed border. Biome zones stay land only, so an island can be one and a lake cannot. Open water still gets Open Sea.

## 0.83.4: your places stay

- **Fixed:** a natural place you added or changed vanished on saving if a named river or shore had the same name or nearly so ("Lake Oban" beside a shore called Lake Oban). It was saved but hidden, leaving a gold handle for nothing. A place you added or changed now always shows, and any hidden this way come back. Shipped places a waterway already names are still left out, so they do not show twice.
- **Fixed:** the map editor kept hold of a place that had gone from the map, showing its gold handle with no place behind it.
- The handle's name follows a rename. When a new type moves the selected place to another layer (a new Lake starts as a Region), the map switches to that layer with it.

## 0.83.3: places show at a useful zoom

- **Fixed:** on a made world, places appeared only when zoomed far in, because the zooms were Toril's. They now follow the map's own size: rank 4 places show at about the whole-map view, and every place from half the picture's full size. Faerûn's are unchanged.
- **Fixed:** searching for a place could land where its marker was still hidden. Search now switches to the place's layer and zooms close enough to show it, whatever its rank. A closer view stays as it is. On Faerûn this lands one zoom level closer than before, because its rank 5 places need it.
- The crosshairs on the Places list and on place cards do the same.

## 0.83.2: code review fixes

Fixes from a full code review.

- **Fixed:** a party crossing into a new biome rebuilt the whole realm map for everyone viewing it.
- **Fixed:** a settlement opened before any realm map could read the wrong land under it, and so get the wrong weather and winter picture. Biome zones you drew were not affected.
- **Fixed:** biome climates could be added twice at once, duplicating zones. They now go in one run at a time, after Calendaria has started and any module's calendar is set, so Faerûn's first load no longer adds them to Gregorian first.
- **Fixed:** a biome zone outlived its place. It now goes when the place is deleted or removed from the map, or stops being a land area with a closed border on Geography, and you are told. Restoring a removed place does not bring the zone back: press Make biome zone again.
- **Fixed:** a scene reached only through a link in text exported with player tokens and journey data, without its actors or the id its links need. It now exports like every other scene, with what it links to.
- **Fixed:** wildcard token art (tokens/wolf/*.webp) was reported missing on export. All its files now go into the module and the wildcard still works.
- **Fixed:** rolling weather on entering a zone could clear that zone's forecast.

## 0.83.1: one less waterways button

- Removed the "Back to the module's waterways" button from the Waterways tab. Undo and Export stay.

## 0.83.0: biomes set the weather

- **The party's biome sets its weather.** When a party token enters an arctic biome, the realm scene switches to arctic weather in Calendaria, and Calendaria rolls from what that climate allows: blizzards there, sandstorms in a desert, monsoons in a jungle, and never the wrong one. At sea it uses the Open Sea climate. A settlement takes the climate of its place on the realm map.
- **A climate for every biome, in every world.** Each biome preset has its own Calendaria climate zone, named "Biome: Arctic" and so on: the weather it can have and how often in each season, temperatures for each season, and wind. They are added to the active calendar, in one save, and to each calendar you switch to. Edit them under Calendaria's Zone Climate. One you edit stays edited, and one you delete stays deleted.
- **More biome presets:** Arctic, Jungle, Swamp, Savanna, Steppe, Badlands, Coast and Volcanic join Plains, Forest, Desert, Tundra, Taiga, Hills, Wetlands, Mountains and Glacier, each with its own speeds, DCs and colour, editable as before.
- **Weather** in the Biomes tab chooses which Calendaria climate a biome type uses, or one zone of it. Custom biome types start on Plains'.
- **The GM's own choice stands.** A scene set to "No Zone" in Calendaria, or to a zone KG Realms did not set, is left alone. With Calendaria's auto weather off, the zone still follows the party but nothing is rolled.
- A ranger's favored terrain knows the new biomes: Arctic, Swamp, Coast, and Grassland for Savanna and Steppe.
- Area suggestions use them too: a Jungle suggests Jungle, a Swamp suggests Swamp, a Coast suggests Coast.

## 0.82.0: geography as biomes, and where the party is

- **A geography area can be a biome.** A land area with a closed border (map editor, Places tab) gets a Biome row: choose the type, already suggested from its class (a Forest is forest, a Swamp is wetlands), and press Make biome zone. The zone takes the area's name and follows its border as you reshape it, and goes if the border is opened or removed. Set its speeds and DCs in the Biomes tab.
- **Where the party is reads in full.** "In Thay, in Rawlinswood near Arine", "On Turquoise Bay near Wakeflow", "In Arine, Thay". In for land, on for water. Anything missing is left out with no gap, and a settlement within 60 miles comes before a closer landmark. Only borders you have drawn count. Hidden places never show. A long name wraps to two lines at most, with the whole of it in the tooltip.
- **The in-game date goes with an exported calendar.** It is used only where the clock has not started.
- **A world module can set a starting year:** calendar: { id, name, startYear }. Where the clock has already moved, the date stays. If Calendaria does not land on that year, the GM is told.
- **A campaign already running on another calendar keeps it.** A module's calendar is not forced onto a game world whose clock has moved on a calendar the GM chose. The GM is told. Calendaria's untouched default gives way.
- **Water side set:** a shoreline whose water side is set shows a green Water side set button. Click again to change it.

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
