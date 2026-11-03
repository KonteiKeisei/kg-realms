# Regional maps

A regional map is a detailed travel map linked beneath a realm and above settlement maps. Its own scale and terrain determine travel inside its coverage, even when the party is viewing the realm overview. A journey can enter, leave and re-enter regions without ending at their borders.

## Create and link a map

1. On the parent realm, use the map editor to draw a closed area for the regional coverage. Give the area a name, such as Icewind Dale.
2. Create a Foundry scene with the detailed picture as its Background Image. Right-click that scene in the directory and choose **Make regional map**.
3. Enter the picture's full width in miles. This is the regional scale, independent of the size of its footprint on the realm artwork. The picture is processed with the existing map tile builder and its original scene is backed up.
4. Choose the parent realm scene and its closed area. **Fit picture to outline** initially aligns the picture's corners with the outline's bounding box.
5. For better alignment, match three landmarks that form a triangle. Each row contains the same landmark's image pixel coordinates on the parent and regional maps. The **Pick** buttons fill them from map clicks. View the relevant scene before picking. Escape cancels a pick. Three-point alignment supports rotation and different horizontal and vertical stretching; it does not reshape the regional picture.
6. Save, then review inherited POI positions and trace the detailed roads. Move inherited POIs to their exact regional positions with the existing map editor. Draw regional roads up to the coverage edge so that they meet the parent roads. Parent roads inside the coverage are superseded.

An already converted map can be linked using **Regional map settings** in its scene context menu. The **Regional maps** control on a realm lists maps that can be linked or adjusted. Use **Realm world settings** to correct a homebrew map's width in miles. Reopen regional settings after changing the coverage outline to adopt its new boundary.

Keep the authoritative party token on the parent realm. The regional map shows a linked mirror while that party is inside its coverage. Engine-created mirrors are removed on exit. Existing placed content is preserved.

## Places

Parent POIs inside the outline appear on the regional map without copying their journals, settlement links or discovery state. Metadata edits on inherited markers go back to the canonical parent place. Regional coordinate adjustments stay on the regional map.

Places created in the region belong to that region. In regional settings, select the places that should also have an approximate marker on the realm. These markers retain the regional place's visibility and metadata. Publishing a marker never reveals a hidden place. Coordinate edits to an approximate realm marker stay local to the realm.

The Travel panel's **Find destination in realm or region** searches linked places, including regional places without a permanent realm marker. Destination routing uses the regional position. The realm's ordinary map search can also find linked regional places.

## Travel and views

The route planner combines roads from the realm and its regions and compares their true travel costs. It can choose roads around a region when those are shorter. Direct travel also uses regional scale while inside coverage. Regional terrain affects ground travel; flying uses regional distances while ignoring ground penalties.

For example, an 80-mile approach, a 150-mile regional crossing and a 60-mile onward journey total 290 miles, even if the realm artwork makes the crossing look only 30 miles long. At 3 mph on open ground, the crossing takes 50 moving hours in either view. Rests, pace, encounters and terrain apply through the existing journey rules. Abandoning camp also measures its escape and return distance using the owning maps, including a flight across a regional border.

The travel log includes entry and exit rows. The HUD shows which scale applies at the current position and provides **Open regional map** and **View realm map** actions. These open the GM's view; they do not activate a scene for all players. The GM can activate either linked scene normally. Both views read and control the same parent-owned journey, including its camps and party selection. Switching between them does not count as time away from travel. Settlement and encounter scenes retain the existing away-pause behaviour.

Regional encounters are projected onto the shared journey using native regional reach distances. Existing realm waterways can cross regional coverage and receive corrected mileage. Regional-only waterway routing and automatic boat suggestions across map boundaries are not part of this first version. Use the realm's water routes for such journeys.

## Saved journeys and limits

- New journeys in a realm with regional maps save their calculated itinerary at departure. Editing map scale, terrain or roads cannot rewrite the timing of that saved itinerary. Explicit route, pace or method edits deliberately rebuild it. Existing walking-speed changes still apply through the existing timing history.
- Journeys already underway before linking a region retain their previous calculation. Finish or clear them before starting a journey that should use the new coverage.
- If required regional data is unavailable, a new plan fails with an explicit error instead of estimating regional travel at realm scale. Previously saved itineraries retain their timing.
- This version supports one regional level beneath a realm. Coverage areas must be separate and must not overlap or touch. The aligned regional picture must cover the whole selected footprint.
- Positioning is a three-point affine alignment. It accommodates a regional map whose scale differs from the realm artwork, but cannot automatically resolve every inconsistency between two cartographers. Review POIs and border road connections after aligning.
- Links are stored in the Foundry world's KG Realms settings. After exporting and importing maps into another game world, configure the links again so they reference that world's scenes.

Automated tests cover scale transitions, through-travel, repeated crossings, route alternatives, terrain, flight, POIs, projected encounters, shared views, token mirrors and saved itineraries. Native Foundry rendering and multiplayer scene transitions still need live validation.
