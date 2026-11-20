# KG Realms user guide: table of contents

Status: outline. Based on KG Realms 0.93.6. The [user guide review draft](guide/README.md) contains the draft pages. Real screenshots are being collected in order.

## Reading order

- GM: sections 1-3, then map controls and the first journey in sections 4-5.
- Custom realm: complete the map-image setup path in section 2. Add the places and any roads needed for the first journey in section 3.
- Companion realm: complete the companion-module setup path in section 2. Use the supplied places and roads where available.
- Player: start at section 4 after the GM has prepared the realm and party. Read the player pages in sections 5-8.
- Regional maps, settlement maps and advanced tools: read when needed. They are not prerequisites for the first realm journey.

## 1. Install KG Realms [GM]

1. Supported Foundry versions and game system
2. Install the engine
3. Enable KG Realms in the game world
4. Companion realm modules and optional integrations
5. Check that the module is enabled

Visuals: module installation dialog; Manage Modules with the engine and a companion realm identified separately.

## 2. Set up a realm map [GM]

### 2A. Use a companion realm module

1. Install and enable the companion module
2. Generate its realm scene
3. Open the scene from the Scenes sidebar
4. Check what the companion supplies: map, places, roads and local maps

### 2B. Use your own map image

1. Create a scene and set its Background Image
2. Open the scene context menu: Make realm world
3. Set the realm name and full image width in miles
4. Build the map tiles
5. Open the realm scene
6. What is copied from the image, and what must be added manually

### 2C. Check the result

1. Confirm the map opens
2. Confirm its scale
3. Locate Realm world settings and the scene backup

Visuals: companion map generator; scene context menu; realm creation dialog with the width field marked; completed companion map and blank custom realm.

## 3. Prepare the realm and party for travel [GM]

1. Create a D&D 5e group actor
2. Add the travelling characters and NPCs
3. Set character ownership for players
4. Set Party token actor in module settings
5. Place the group token on the realm
6. Use a scene-specific party override when needed
7. Custom realm: add the starting place and destination
8. Custom realm: draw and connect a road if the trip needs one
9. Choose the travel rules: 2014 or 2024
10. Check the realm, party and destination before opening Travel

Visuals: group membership; Party token actor setting; scene override; party token; two places joined by a road.

## 4. Read and navigate the map [GM and player pages]

1. Pan and zoom
2. Search for a place
3. Combine Places, Areas and Geography filters
4. Hover previews and full place cards
5. Read known information and trade details
6. GM page: hidden, rumoured and discovered places
7. GM page: View a linked scene versus Enter for everyone
8. Player page: visible places, cards and available controls
9. Move, resize, lock and minimise panels

Visuals: numbered map overview; search results; multiple active filters; separate GM and player cards; View and Enter buttons.

## 5. Run the first journey [separate GM and player pages]

### GM: plan and start

1. Open Travel
2. Check the selected party and starting point
3. Add a destination
4. Check the route, distance and travel time
5. Set method, pace, travel hours and camp hours
6. Choose what players see: Route, Progress or Nothing
7. Start the journey
8. Advance time, pause and resume
9. Arrive and finish

### Player: follow the journey

1. Open Travel
2. Route view
3. Progress-only view
4. Rules-only view when journey details are hidden
5. Read the current position and journey status
6. Respond to a requested roll

Visuals: GM planning panel; numbered route; running journey; all three player visibility modes captured separately.

## 6. Travel options and route changes [GM; player reference]

1. Add, move, reorder and remove stops
2. Roads versus direct travel
3. Walking, mounts, wagons, coaches, flight and custom speed
4. Different travel methods on different legs
5. Rivers, sea routes, ports and vessels
6. Use a water vehicle actor
7. Fares, free passage and paid escort work
8. Terrain, party speed, encumbrance and forced travel
9. Stop at a settlement or continue past it
10. Change or recalculate an active route
11. Clear a route or return the party to the start
12. Travel logs and chat messages

Visuals: expanded route leg; land/water choice; vessel field; fare controls; route-change confirmation.

## 7. Camp, watches and rest [separate GM and player pages]

1. GM: make camp or push on
2. GM: configure Advanced watches and the ration item
3. Player: choose a task for an owned character
4. GM and player: arrange the watch order
5. GM: restrict watch arrangement or take over
6. GM: review the camp plan and begin setup
7. Foraging, concealment, alarms and requested rolls
8. Watch changes, sleep requirements and fatigue
9. GM: camp encounter settings and encounter rolls
10. Player: answer watch and encounter requests
11. Complete rest, pack up and resume travel
12. Rest Recovery integration and world time
13. GM: use the practice night

Visuals: separate GM and player setup panels; task selection; watch timeline; roll request; rest completion.

## 8. Encounters [separate GM and player pages]

1. GM: map encounters versus journey encounters
2. GM: place an encounter and set its reach
3. GM: add description, DC, notes, actors, images and a scene
4. GM: hover a dot or open its full card
5. GM: recognise the orange-yellow GM-only outline
6. Player: encounter prompts and information revealed during play
7. GM: open an encounter scene
8. GM: conclude the encounter and return to the map
9. GM: resume the journey

Visuals: GM encounter dot and preview; full GM-only card; player view of the same location without dots or private cards; encounter scene controls.

## 9. Build and edit the realm [GM]

1. Open Map editor and use the editing bar
2. Add, move and edit places
3. Choose place kinds and map markers
4. Edit cards, artwork, known information and GM notes
5. Set discovery and visibility
6. Insert links to other places
7. Link places to scenes
8. Areas: Domains and Territories
9. Draw, reshape and remove an Area border
10. Draw and connect roads and trails
11. Draw waterways, shorelines and water routes
12. Configure river hazards, winds and currents
13. Search the editor's collapsed place groups
14. Remove, restore or reset places
15. Import and export place edits
16. Use Practice tools

Visuals: editor tabs; active drawing bar; place editor; custom Area border; road junction; waterway tools; collapsed and searched place lists.

## 10. Add a Regional map [GM setup; player travel reference]

1. Realm, Regional map and settlement: which map to use
2. Create the detailed scene and choose Make regional map
3. Set the detailed image's width in miles
4. Choose the parent realm
5. Place, move and resize the coverage rectangle
6. Link an Area card to the scene
7. Coverage rectangle versus an independent Area border
8. Review inherited places and adjust their detailed positions
9. Find the generated trail crossings
10. Move crossings to match the artwork
11. Draw Regional roads between places and crossings
12. Optional three-landmark alignment
13. Find Regional destinations from the realm
14. Travel into, across, out of and back into coverage
15. Read Regional distance and time from either map
16. View, Enter and return through the navigation trail
17. Enable a Regional snow line, if required
18. Existing journeys, later map edits and current coverage limits

Visuals: creation dialog; rectangle placement with Alt + mouse wheel labelled; Area border shown separately; crossing markers before and after adjustment; one journey across both map views; navigation trail.

## 11. Add and use settlement or local maps [GM setup; player view]

1. Use a supplied local map, when available
2. Link your own settlement or site scene
3. Place gate, road and dock entrances
4. Add local places and edit their cards
5. Link buildings and other places to subscenes
6. Draw settlement roads
7. GM: plan a walking or coach trip
8. GM: choose passengers and handle fares
9. GM: edit the route or stop the trip
10. Player: read local cards and follow the trip
11. Enter a linked scene and return through the map hierarchy
12. Seasonal pictures, marker size and icon packs

Visuals: local-map setup; entrances; settlement road editor; trip planner; passenger selection; player map; return navigation.

## 12. Biomes, weather, seasons and effects [GM; client settings]

1. Draw and edit biomes
2. Set terrain and climate information
3. Day, night and the world clock
4. Configure realm snow lines
5. Configure Regional snow separately
6. Seasonal local-map images
7. Calendaria integration
8. FXMaster and FXMaster+ integration
9. Map labels above effects and display cost

Visuals: biome editor; Snow tab on a realm and a Regional map; day/night comparison; relevant integration settings.

## 13. Trade information and prices [separate GM and player pages]

1. Player: open Trade on a place card
2. Read price, listed unit, availability and supplier
3. GM: choose a market profile or add goods
4. GM: edit local prices and availability
5. GM: hide goods from players
6. GM: set the world price multiplier
7. Trade information versus inventory and payment handling

Visuals: player Trade tab; price details; GM trade editor; hidden-good indicator.

## 14. Multiple parties and GM control [GM]

1. Split a party
2. Merge parties
3. Move members between groups
4. Select a party in Travel
5. Separate journeys and encounter pauses
6. Party transfers between realm, Regional and local scenes
7. Primary GM selection and handover
8. Character ownership and player camp actions

Visuals: token party button; split/merge window; party tabs; Primary GM setting.

## 15. Settings, map files and maintenance [GM and player pages]

1. GM world settings versus settings for this client
2. Marker size, label size and hover delay
3. Window theme and panel placement
4. GM: party token and portrait outline colour
5. GM: watch display, DC visibility and carriage sound
6. Manage map files: streaming or files saved on this computer
7. Download, pause, reconnect, verify and repair map files
8. Browser support and map performance settings
9. GM: back up world edits and generated map files
10. GM: regenerate tiles
11. GM: revert a converted scene to its backup
12. GM: export a realm as a companion module
13. GM: update the engine and companion modules

Visuals: settings with world/client scope marked; token outline setting; map-file manager; backup folders; export dialog.

## 16. Troubleshooting [GM and player pages]

1. No realm is available
2. Map conversion will not start or finish
3. Blank, missing or slow map artwork
4. Party token is not detected
5. No route is available
6. Distance or travel time is wrong
7. Player and GM views differ
8. Camp controls or rolls are unavailable
9. Regional crossings or roads do not connect
10. Scene entry or return navigation is missing
11. Map files require reconnection or repair
12. Check the installed version and report a problem

Visuals: exact error or affected control beside the matching fix. Record browser, module version and user role with the example.

## 17. Reference

1. Keyboard and mouse controls
2. Map symbols, lines and status indicators
3. GM/player permission table
4. Settings reference, including default and scope
5. Optional integration reference
6. Terms: engine, companion realm module, realm, Regional map, local map, Area, Domain and Territory
7. Foundry Regions versus KG Realms Areas and Regional maps
8. Version notes and known limits

## Page format

- Audience: GM, player or both.
- Required setup: links to prerequisite pages.
- Open: exact menu, tab or control name.
- Steps: one action per numbered step.
- Screenshot: numbered callouts matching the steps, placed beside the relevant instructions.
- Result: what should appear or change.
- Related pages: next task and relevant troubleshooting.

## Screenshots and mockups

- Use current UI screenshots for control names, positions and behaviour.
- Use separate GM and player captures where controls or information differ.
- Use numbered callouts and short captions.
- Use mockups for map relationships, scale and before/after comparisons. Label them as mockups.
- Use sample content for public images. Keep private maps, campaign text and GM secrets out of player examples.
- Record module version and user role for each capture.
- First capture set: installation, both realm setup paths, party setup, map controls and the first journey.
