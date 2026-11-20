# Travel methods and route changes

Audience: Primary GM. Required: [a planned journey](05-journey-gm.md).

## Stops and path points

1. Click Add stop.
2. Choose a place in the search field or click a place while route editing is active.
3. Use the stop row's drag handle to change its order.
4. Click Edit route to adjust the path on the map.
5. Click the route to add a shaping point, then drag it.
6. Right-click a stop to remove it while editing.
7. Click Finish route or press Escape to leave route editing.

New stops are inserted where they add the least distance. Review their order after adding them.


## Methods and pace

Set the default method in Setup. Expand a stop's leg to choose a different method for that part of the journey.

- On foot uses party movement and accounts for the slowest member and encumbrance.
- Mounted travel, wagons and coaches use their method rules. Wagons and coaches are restricted to roads and trails.
- Flying uses its configured speed and ignores ground penalties.
- Custom speed uses the speed you enter.

The Rules tab explains the selected 2014 or 2024 calculations. Changing the method, pace or route can replan travel. Review the resulting distance and time.

## Boats and ships

1. Supply usable water information: drawn rivers or water/shoreline data and suitable ports.
2. Plan between stops with a water route.
3. Expand the leg and select its available land, river or sea option.
4. Choose a Boat preset, or drop a water vehicle actor into the ship field.
5. Check speed, operating hours and fares.

A crewed ship can sail day and night. The party can rest aboard. Rowed and other uncrewed presets have their own travel hours. River current changes upstream and downstream speed.

No boat option can mean a stop lacks a port or drawn river, or the water network does not connect. A blue river printed in the artwork is not a navigable route by itself.

## Fares and paid work

Setup contains default fares and ride terms. A leg's fare field overrides that leg's default. Reset restores its default fare.

Wagon and coach terms include Party pays, Free ride and paid guarding/escort work. Check whether the summary says Fares or Pay. Realm travel summaries are not the settlement coach payment workflow.

## Recalculate, clear or return

| Action under More | Effect |
| --- | --- |
| Recalculate the route | Replans through retained stops; drops shaping points and Direct choices; keeps stops, stays and encounters |
| Back to the start | Ends the active trip and returns the party to its start without rewinding time |
| Clear the route | Removes the route, its journey encounters and progress after confirmation |

Undo route change, when available, undoes route edits. It is not a general reversal of actor resources or world time.

## Regional maps and saved plans

Regional coverage uses the Regional map's scale even when the realm artwork looks shorter. New linked journeys save their itinerary at departure. Later map edits do not automatically retime that saved itinerary; explicit route/method/pace changes replan it.

See [Regional maps](10-regional.md).

## Logs

The module writes journey events to chat and a journey journal under Travel Logs. Existing logs are records of the journey; clearing a route does not rewind the game clock.

Next: [Camp: GM](07-camp-gm.md). [Contents](README.md).
