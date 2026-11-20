# Regional maps

Audience: GM. Required: [a working parent realm](02-realm.md). Regional maps are optional.

A Regional map is a detailed map beneath a realm and above local/settlement scenes. It controls distance and terrain inside its coverage. The displayed size of its rectangle on the realm does not set its miles.

## Create the map

1. Create a scene with the detailed picture as Background Image.
2. Right-click that scene in the Scenes sidebar.
3. Choose Make regional map.
4. Enter the detailed picture's full width in miles.
5. Click Build regional map.
6. Choose Parent realm.
7. Click Place rectangle on realm.


## Place and align

1. Move the rectangle over the represented area on the parent realm.
2. Resize it until it covers the intended part of the realm artwork.
3. Choose Area if a Domain or Territory card should open the scene.
4. Click Use this rectangle.

Cancel or Escape leaves the existing link unchanged. The four corners align automatically. Resizing coverage does not change the Regional map's width in miles.

Use the scene's Regional map settings to reposition an existing map. It does not need its tiles rebuilt for this.

## Coverage versus Area border

- Coverage rectangle: picture placement, coordinate mapping and Regional travel scale.
- Area border: a Domain or Territory's custom shape.


Draw the Area separately in Map editor > Places > Draw area border. Changing that border does not move scene coverage.

## Review places

1. Open the detailed scene.
2. Review inherited parent places inside coverage.
3. Move their Regional markers onto the matching artwork locations.

Those local coordinate changes do not move the realm markers. Place identity and shared card/scene metadata remain linked.

## Connect roads and trails

1. Open the Regional scene's Map editor > Roads.
2. Find the generated crossings, such as Trail crossing 1 and Trail crossing 2.
3. Drag a crossing on the Regional map if it needs to match the artwork more closely.
4. Draw Regional roads from those markers to places and other crossings.
5. Snap road endpoints to the crossing markers.


Moving a Regional crossing leaves the realm-side crossing fixed. Reopen or refresh the map after editing parent roads to refresh the crossings.

## Advanced alignment

Use Advanced three-landmark alignment only when the default placement needs refinement.

1. Open Regional map settings.
2. Select Advanced three-landmark alignment.
3. Choose three landmarks that are not on one straight line.
4. Use Pick to record each landmark on the parent and detailed pictures.
5. Save regional map.

This adjusts coordinate alignment inside the saved coverage. Return to Place rectangle on realm to move or resize coverage.

## Travel through a Regional map

One journey can enter, leave and re-enter coverage. Regional miles apply even while viewing the realm. Across-country and flying travel can cross anywhere on the coverage edge; road travel uses connected crossings.


Example: 80 miles approaching, 150 miles inside and 60 miles onward total 290 miles. The overview artwork does not reduce the detailed 150-mile section.

The Regional view displays only the journey portions inside its coverage and picture. A journey that never enters it should contribute no route, party mirror or encounter overlay there.

## Destinations and navigation

- Find destination in realm or regional map in Travel searches linked destinations.
- The realm search also finds linked Regional places.
- Advanced settings can publish approximate realm markers for Regional-only places.
- The linked Area card offers Enter for everyone and View for the GM.
- The navigation back arrow views the parent. An ancestor breadcrumb activates that map for everyone.

The Travel HUD's map-view controls change the GM's view. They do not activate a scene for everyone.

## Snow and current limits

- Regional snow lines are off by default. Enable one in Map editor > Snow on that Regional scene. It uses its own settings.
- One Regional level is supported, with separate non-touching coverage areas.
- Existing realm water routes receive corrected mileage. Regional-only waterway routing and automatic cross-map boat suggestions are not implemented.
- New journeys save their itinerary at departure. Journeys begun before linking keep their earlier calculation; finish or clear them before starting one that must use the new coverage.
- Links are world settings. Reconfigure them when moving maps into a different game world.

Next: [Local maps](11-local-gm.md). [Contents](README.md).
