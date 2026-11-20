# Troubleshooting

Audience: GM and player. GM-only fixes are marked.

## No realm is available

GM:

1. Check Manage Modules: KG Realms must be enabled.
2. If using a companion, enable it too and reload.
3. Generate its scene through the Scenes sidebar.
4. If using your own image, convert its scene with Make realm world.

Installing only the engine does not supply a complete realm. See [Realm setup](02-realm.md).

## Map conversion does not start or finish

GM:

1. Check that the scene has a still Background Image.
2. Open Foundry over HTTPS or localhost.
3. Check write access to the Foundry Data directory.
4. Read the build error before retrying.
5. Confirm that the server preserves generated tile bytes, including the `.ktx2.fbx` filenames used for uploads.

Large pictures take time. The build reduces sides over 16,384 pixels; increasing input dimensions beyond that limit does not remove the browser limit.

## Blank or missing artwork

1. Reload the scene after checking the module/companion is enabled.
2. Open Manage map files and check its error/status.
3. If using saved files, reconnect the correct folder or choose Use streaming instead.
4. GM: verify the companion's artwork files or the generated custom-realm folder exist on the server.

## Slow rendering

1. Try turning off Sharp map on high-DPI screens.
2. Try turning off Names above effects.
3. GM: disable Water regions (FXMaster+) if those effects are the cause.
4. Check Realm terrain texture budget. It covers map textures, not all Foundry memory.
5. Compare the same scene without additional effects before changing other map settings.

## Party is not detected

GM:

1. Confirm the placed token's actor is a D&D 5e group.
2. Check its members.
3. Check Party token actor in module settings.
4. Check the scene's KG Realms party token override.
5. Confirm the designated group actually has a token on this scene.

See [Party setup](03-party.md).

## No route or no Start travel button

GM:

1. Add a destination and finish route editing.
2. Read the failed leg's message.
3. Check the method. Wagons/coaches need connected roads or trails.
4. Check that drawn road endpoints connect. Background artwork is not route data.
5. For a water leg, check ports, navigable rivers, shorelines and water-side settings.
6. For a Regional leg, connect Regional roads to generated crossings.

Start travel appears once every leg has a valid way. See [Roads](09-roads-water.md) and [Regional maps](10-regional.md).

## Distance or travel time is wrong

GM:

1. Check full image width in miles for a converted realm or Regional map.
2. Check that the party token is at the intended start.
3. Check method, pace, daily travel/rest hours and leg overrides.
4. Check slow members, encumbrance and terrain.
5. For boats, check preset/actor speed, crewed hours and river current.
6. Check whether the journey saved an older itinerary before map edits.

For settlement trips, check the local scene's grid distance and units. For Regional trips, the detailed scale applies inside coverage even on the realm view.

## Player and GM views differ

GM:

1. Check Players see in the journey's Setup.
2. Check the place's discovery/visibility and secret text.
3. Check each client's filters.
4. Check character ownership for player task/roll controls.

Encounter dots and GM encounter previews/cards are intentionally absent for players. Player examples in this guide do not include them.

## Camp controls or rolls are unavailable

1. Player: confirm you own the named character and that it is a member of the travelling group.
2. GM: check enabled tasks under Advanced watches.
3. GM: check whether watch arrangement is locked.
4. Check the current camp phase and any unanswered request.
5. GM: conclude an active encounter before continuing the night.
6. GM: confirm the connected Primary GM owns progression.

If recovery requests are missing, check Rest Recovery is enabled and camp has reached its completion step. Do not advance the whole camp duration again to compensate.

## Regional crossing is missing or misplaced

GM:

1. Confirm the parent road actually crosses the saved coverage edge.
2. Reopen or refresh after parent road edits.
3. Enable Places on the Regional map.
4. Open Map editor > Roads.
5. Move the detailed crossing marker to match the artwork and attach the road to that marker.

Do not move the realm crossing to compensate for local artwork. See [Connect roads and trails](10-regional.md#connect-roads-and-trails).

## Scene entry or return is missing

GM:

1. Check the place's scene link.
2. For a Regional map, explicitly choose Area in placement/settings if automatic name matching did not link it.
3. For a local map, check its parent place and entrance records.
4. Check land versus dock arrival requirements.
5. Use the GM view: players do not receive the GM's scene activation controls.

## Report a problem

Include:

- KG Realms version and companion module version.
- Foundry generation/build, D&D 5e version and browser.
- GM or player, and whether the GM is Primary GM.
- Realm, Regional, settlement or encounter scene.
- Exact steps and error text.
- Expected result and actual result.
- A screenshot of the affected control, without private campaign content.

Use the repository's [issue tracker](https://github.com/KonteiKeisei/kg-realms/issues).

[Contents](README.md).
