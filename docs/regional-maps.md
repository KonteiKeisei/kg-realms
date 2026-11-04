# Regional maps

A regional map is a detailed travel map beneath a realm and above settlements. It owns travel distance and terrain within its coverage. Its size on the realm artwork is independent of its scale in miles.

## Create or reposition a regional map

1. Put the detailed picture in a Foundry scene as its Background Image. Right-click that scene and choose **Make regional map**. Enter the picture's full width in miles, then click **Build regional map**.
2. Choose the parent realm and click **Place rectangle on realm**. For an already built map, right-click its scene and choose **Regional map settings**. Its tiles do not need rebuilding.
3. On the parent realm, **drag inside the rectangle** to move it. Hold **Alt and scroll the mouse wheel** to resize it. The rectangle keeps the picture's aspect ratio; resizing never changes regional miles.
4. Click **Use this rectangle** to save. **Cancel** or **Escape** leaves the existing link unchanged. Four-corner alignment is automatic.
5. Open the detailed scene, then **Map editor > Roads**. Every parent road or trail crossing the rectangle has a named crossing marker on both maps, such as **Trail crossing 1** and **Trail crossing 2**. Draw regional roads from these markers to POIs and other crossings. The road editor snaps to them.
6. Review inherited POIs and move their regional markers onto the correct locations. Moving them does not move their realm markers. Journals, settlement links and discovery metadata remain shared.

No territory outline is required first. Older polygon links remain supported; Regional map settings can replace them with a rectangular placement. Regional scenes open on the Places layer so the crossing markers are visible. Reopen or refresh a map after editing parent roads to refresh its crossing markers.

## Refine placement

Choose **Advanced three-landmark alignment** in Regional map settings if the corner registration needs refinement. Match three non-collinear landmarks using each map's image pixel coordinates. **Pick** fills a coordinate pair from a click on the relevant map. Existing rectangular coverage is available for refinement without drawing a separate territory.

Exact outline-to-picture containment is not required. For older polygon coverage extending beyond the picture, regional scale still applies, with realm roads and terrain filling unmatched areas.

## Travel across boundaries

One itinerary can enter, leave and re-enter regions. The planner compares true distances, including roads around regional coverage. Roads and trails connect through the generated crossing points.

Across-country travel can cross anywhere on the coverage edge. Its crossing is calculated from the route, without requiring a road entrance. Flying can also cross anywhere, uses regional miles, and ignores ground penalties. Existing realm water routes receive corrected regional mileage; regional-only waterway routing and automatic cross-map boat suggestions remain deferred.

An 80-mile approach, a 150-mile regional crossing and a 60-mile onward journey total 290 miles, even if the overview artwork suggests only 30 miles for the crossing. At 3 mph on open ground, that crossing takes 50 moving hours in either view. Camps, encounters, rests and camp escapes use the journey's travel rules.

The regional map displays only the journey portions and markers within its coverage and picture. A realm trip that never visits it contributes no route or encounter overlay. Separate visits remain separate lines. The authoritative journey stays on the parent realm. Regional group-token mirrors exist only while the party is inside the detailed coverage. Existing placed scene content is preserved.

Regional maps also show the top navigation trail, for example Faerun > Icewind Dale. The back arrow views the parent without moving players; clicking an ancestor breadcrumb activates it for everyone. These controls follow the existing GM-only map navigation policy.

The HUD opens either map view without activating a scene for everyone. Either linked scene can be activated normally without inserting an away pause. Settlements and encounter scenes retain the existing away-pause behaviour.

## POIs and destinations

Parent POIs within coverage are inherited without rebuilding journals or settlement maps. Coordinates are separate on each map; metadata remains linked to the canonical place. Regional roads and precise POI positions determine regional travel distances while realm markers retain their approximate positions.

**Find destination in realm or region** in the Travel panel finds linked regional POIs, including those without permanent realm markers. The realm's ordinary search also finds them. Advanced regional settings can publish approximate realm markers for regional-only places, preserving their discovery state.

## Saved journeys and validation

New journeys in linked realms save their itinerary at departure. Later map edits do not retime that saved route. Explicit route, method or pace edits replan it. Journeys already underway before regions were linked retain their old calculation; finish or clear them before starting a new journey that should use regional coverage.

This version supports one regional level with separate non-touching coverage areas. Links are stored in Foundry world settings; reconfigure them after exporting maps to a different game world.

Automated tests cover placement gestures, aspect preservation, crossing markers, route clipping, repeated entry, POI identity, mileage, terrain, flight, encounters, camp escapes and saved plans. Native Foundry rendering and multiplayer transitions still need live validation.
