# Settings

Open Configure Settings > KG Realms. World settings are controlled by the GM. Client settings affect the current client.


## World settings

| Setting | Default in 0.93.6 | Use |
| --- | --- | --- |
| Primary GM | Automatic selection | Journey authority and shared actions |
| Party token actor | None designated | Default travelling group |
| Travel rules | D&D 2014 | Travel calculation rule set |
| Prices | Book price, x1 | Trade prices and default fares |
| Day and night | Follow world clock | Map lighting mode |
| Day starts at | 6 | Start-of-day hour |
| Night starts at | 19 | Start-of-night hour |
| Largest scene side | 80,000 pixels | Maximum generated realm scene dimension |
| Seasonal snow | On | Realm snow and supported seasonal local pictures |
| Water regions (FXMaster+) | On | Supported water effect regions |
| Watches at sea | Off | Party watches aboard crewed ships |
| Show Perception DC | On | Player DC/result visibility for requested checks |
| Carriage ride sound | Empty | Optional looping local carriage sound |

When Tenacity is active, Show Perception DC is forced on so players can assess spends against the DC.

## Client settings

| Setting | Default | Use |
| --- | --- | --- |
| Map marker size | 1 | Scale map markers |
| Map label size | 1 | Scale map names |
| Place card hover delay (ms) | 750 | Delay before the hover preview |
| Names above effects | On | Keep names, markers and the journey above scene effects |
| Sharp map on high-DPI screens | On | Render at full screen resolution |
| Realm terrain texture budget | 128 MiB | Owned map texture payload budget |
| Window theme | Chocolate | KG Realms window colours |

The terrain budget is not a limit on all Foundry memory. Actors, effects, other graphics and decoding also consume memory.

## Party outline colour

1. Open Party token appearance > Configure token outlines.
2. Choose Outline and portrait colour.
3. Click Save appearance.

The outer glow and portrait borders use the same shared colour. The surrounding ring has no background fill. Default colour: `#d9a441`.

## Other configuration windows

- Advanced watches: camp tasks, ration item and encounter table.
- Manage map files: streaming or saved artwork on this computer.
- Realm world settings: name and full-map miles for a converted map.
- Regional map settings: parent link, coverage and alignment.
- Local map settings: local marker scale and icon-pack override.
- Map editor > Snow: the current map's snow configuration.

Panel position, lock and minimised state are saved through the panel controls. Map filters are remembered in the current browser.

See [Map files and maintenance](15-files.md). [Contents](README.md).
