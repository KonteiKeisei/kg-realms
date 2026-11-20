# Reference

## Keyboard and mouse

Bindings below are the defaults. Foundry's keybinding settings can change registered shortcuts. Editor keys depend on the current mode shown in the top editing bar.

| Control | Context | Action |
| --- | --- | --- |
| Ctrl+F | Realm, Regional or local map | Search places |
| E | Realm or Regional map, GM | Open/close Map editor |
| Ctrl+Shift+M | Map files | Manage local map artwork |
| Hover | Visible place or GM encounter marker | Open preview after configured delay |
| Double-click | Place or GM encounter marker | Open full card |
| Enter | Road/waterway draft | Finish the line |
| Escape | Editor operation | Cancel/deselect/leave according to current mode |
| Ctrl+Z | Supported editor/route mode | Undo its latest supported edit |
| Alt + mouse wheel | Regional placement rectangle | Resize with aspect ratio preserved |
| Drag inside rectangle | Regional placement | Move coverage |
| Shift-click / Ctrl-click | Split/merge member cards | Select multiple members |
| Right-click point | Settlement road editor | Remove point |
| Right-drag | Settlement road editor | Pan map |

## Permissions

| Function | Player | GM | Primary GM |
| --- | --- | --- | --- |
| Search/read available places | Yes | Yes, including GM view | Yes |
| Change own client display settings | Yes | Yes | Yes |
| View shared travel progress | As configured | Yes | Yes |
| View encounter dots and private encounter cards | Never | Yes | Yes |
| Edit maps and place cards | No | Yes | Yes |
| Activate linked scenes for everyone | No | Yes | Yes |
| Control journey time/movement | No | No, unless acting as Primary GM | Yes |
| Choose owned character's camp task | When enabled | Yes | Yes |
| Arrange watches | When permitted | Subject to shared arrangement | Can take over |
| Answer owned character's roll request | Yes | Can handle party requests | Yes |
| Commit party split/merge | No | No, unless acting as Primary GM | Yes |
| Choose shared party outline colour | No | Yes | Yes |
| Save artwork on own computer | If browser supports it | If browser supports it | If browser supports it |

## Map terms

| Term | Meaning |
| --- | --- |
| Engine | KG Realms module and its tools |
| Companion realm module | Installed package supplying a registered realm and its content |
| Foundry game world | Foundry's world containing actors, scenes and saved settings |
| Realm | Top-level travel map |
| Regional map | Detailed travel map linked beneath a realm |
| Local map | Linked scene for a settlement, site or place within another local map |
| Area | Umbrella category for Domains and Territories |
| Domain / Territory | Individual Area place kinds, with independent borders |
| Coverage rectangle | Regional picture placement and travel coverage on the realm |
| Crossing | Linked road/trail endpoint at Regional coverage |
| Foundry Region | Foundry's own scene feature; separate from Areas and Regional maps |
| Place / POI | Named map record with a marker/card |
| Journey | Planned route and its travel/camp progress |

## Symbols and status


Journey status names are listed in [Player journey](05-journey-player.md). A road printed in artwork, a drawn network road and a glowing journey line have different functions.

## Recommended module

Calendaria (`calendaria`): recommended for travel, watches, camp timekeeping, calendars, climate and seasons.

## Compatible/integrated optionals

| Integration | Module ID | Behaviour documented here |
| --- | --- | --- |
| Rest Recovery | rest-recovery | Camp-completion recovery requests |
| FXMaster | fxmaster | Supported scene effects |
| FXMaster+ | fxmaster-plus | Supported water effect regions |
| Tenacity | tenacity | Requested checks remain visible for spend decisions; DC display is forced on |
| Flash Token Bar 5e | flash-rolls-5e | Encounter Perception roll requests, with chat fallback |
| Video Game Music | vgmusic | Scene and combat music |

Each module needs its own installation/configuration. Supplied local maps, trade profiles and artwork belong to the companion package rather than these integrations.

## Settings and version limits

See [Settings](15-settings.md) for defaults and scope. See [Regional limits](10-regional.md#snow-and-current-limits) for coverage/waterway limitations.

This guide describes 0.93.6. It uses reviewed source behaviour. Screenshots are being collected in reading order. It does not certify every workflow in a live multiplayer Foundry session.

[Contents](README.md).
