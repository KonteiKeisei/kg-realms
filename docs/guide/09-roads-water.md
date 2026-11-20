# Roads and waterways

Audience: GM. Required: a realm or Regional map with its scale set.

## Draw a road or trail

1. Open Map editor > Roads.
2. Click New road or New trail.
3. Click the first endpoint.
4. Click each bend.
5. Click the destination endpoint. Points near places or other routes snap to them.
6. Press Enter or click Finish.
7. Select the road to set its name and kind.


A visible line in the background artwork is not part of the route network. Trace it with the road tools.

## Edit and connect

1. Click a road to select it.
2. Adjust its nodes using the active editing controls.
3. Use Join a road to combine adjoining stretches. A large gap requires confirmation before adding a straight connector.
4. Use Simplify to remove unnecessary nodes from the selected road.
5. Use Delete to remove the selected road. The Roads tab's Deleted list can restore it.

Ctrl+Z or Undo applies to the current editor's supported edits. Check the top editing bar before using a map shortcut.

For Regional maps, connect to generated crossing markers. Do not create unrelated duplicate entrances. See [Regional crossings](10-regional.md#connect-roads-and-trails).

## Draw a waterway

1. Open Map editor > Waterways.
2. Choose the kind of waterway from the drawing buttons.
3. Click its points on the map.
4. Finish the line with Enter or Finish.
5. Select it to set its name and options.


## Rivers

Draw in the direction the river flows. Set Current in mph and leave Boats can use it enabled for a navigable river. Use Reverse if the flow direction is wrong.

Downstream travel adds current; upstream travel subtracts it, with a minimum boat speed of 0.5 mph. Connected rivers need connected geometry.

## Shorelines, islands and lakes

A shoreline blocks boats. Its water side identifies which side counts as water.

1. Draw the shoreline along the coast.
2. Choose Click the water side and click the sea/lake side, or use Water side.
3. Turn on Show the map's water.
4. Check that land is not included in the water area.

Open shorelines should reach beyond the map edge or join another shoreline. Close a line into a loop for an island or lake and choose whether its water is inside or outside.

If water runs around an open end and floods inland, extend or join the line, close it into a loop, or clear its water-side setting. This affects ship routing and land-only snow.

## Sea routes and trade winds

Draw a sea route to suggest a shipping path. Draw a trade-wind line in its travel direction, then set its speed factor and seasons. Reverse changes direction. The planner uses the resulting route conditions; artwork alone has no wind/current data.

## Import and export

Roads and Waterways each have their own file controls. Export before importing replacement data or applying whole-map edits. A place export is not a substitute for a road or waterway export.

Next: [Regional maps](10-regional.md) or [Biomes and environment](12-environment.md). [Contents](README.md).
