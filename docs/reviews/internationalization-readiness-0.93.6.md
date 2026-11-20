# KG Realms internationalization review

Reviewed 4 November 2026. Baseline: version 0.93.6, commit `b9afbac31b86b149f302ed02d5f133b6893616f3`.

Internationalization is feasible without replacing the UI, rebuilding the maps, or migrating existing journeys. It is a substantial presentation-layer refactor, with several places where English text must first be separated from behaviour. A blanket translation of string literals or exported data would introduce functional regressions.

Budget approximately **100-160 developer hours**, or about **3-5 working weeks for one developer**, for the engine to become translation-ready with a complete English fallback and a tested second-language path. Actual language translation, native-language proofreading, world-module prose, and advanced script support are additional work. These are engineering estimates, not measured implementation times.

Production code was not changed. No release was created for this review.

The companion [audit inventory](<C:/Users/Konte/FoundryVTT Modules/kg-realms/docs/reviews/internationalization-inventory-0.93.6.json>) records every runtime module's scan counts and the results of isolated synthetic-data probes.

**Scope and evidence**

The review covered the public engine's runtime modules, custom UI construction, map styles and glyph assets, manifest, package builder, data readers/writers, message transport, integrations, and tests. All 132 runtime modules were inventoried. Manual tracing focused on the strings and identifiers that cross UI, saved-state, actor-data, rendering, and integration boundaries. Vendored library implementation was not audited line by line. Private world artwork and campaign prose were excluded from translation-volume estimates.

| Measured item | Result |
| --- | ---: |
| Runtime `.mjs` files under `scripts/` | 132 |
| Runtime source lines | 27,585 |
| Source lines containing selected HTML element tags | 743 |
| Notification call sites | 179 |
| `DialogV2.wait`, `prompt` or `confirm` call sites | 55 |
| Existing i18n references | 5 |
| Declared module translation files | 0 |
| Bundled map glyph files | 9 PBF files, three ranges per font stack |
| Baseline full test suite | 708 passed, 0 failed |
| Baseline without the private world module | 573 passed, 0 failed |

The counts are reproducible text scans, not an AST extraction of translation keys. One HTML-bearing line may contain many labels; repeated text may ultimately share a key. An exact message count or translator word count requires catalog extraction. The five existing localization references concern calendar or climate integration, rather than a translated KG Realms interface.

The largest UI extraction surfaces are `ui-camp.mjs` (150 HTML-bearing lines), `ui-hud.mjs` (117), `place-card.mjs` (68), `ui-pins.mjs` (56), `ui-roads.mjs` (43), and `ui-waterways.mjs` (37). Additional text lives in settlement travel, local maps, homebrew creation/export, settings, downloads, biome/climate presets, rule tooltips, notifications, accessibility attributes, and generated messages.

**Findings, ordered by migration risk**

1. **High: vessel display labels currently influence travel behaviour.** [TravelHud.vehicleVessel](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/ui-hud.mjs:552>) extracts the first word of `VESSELS[*].label` and matches it against an actor name. A display-only translation of that label can therefore change vessel inference. In an isolated probe, an English `Rowboat` actor received 1.5 mph; changing only the preset's label to `Barque` made the same actor fall back to 2 mph. A `Barque` actor against the current English presets received 2 mph and `crewed: true`, compared with `crewed: false` for `Rowboat`. This affects both speed and the scheduling assumptions for a crewed vessel. Keep label translation separate from matching aliases, prefer structured actor identifiers or explicit vessel selection, and retain a tested compatibility fallback. The probe changed only an imported object in an isolated Node process, not a source file or live actor.

2. **High: some human-readable English values are saved enums or type recognizers.** [Trade availability](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/trade.mjs:4>) accepts literal English values. Translating a stored `Unavailable` value to `Indisponible` makes `cleanTrade` replace it with `Stocked`. [Area classification](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/map-layers.mjs:17>) also recognizes English class names. A raw natural record with class `Kingdom` becomes a Domain on the Areas layer; replacing the stored class with `Royaume` leaves it natural and puts it on the Places layer unless an explicit kind/layer overrides that inference. Translate labels for these values, never the values themselves. Existing English tokens can remain canonical for backward compatibility; a schema migration is not required simply to display another language.

3. **High for non-Latin worlds: trade-name normalization can select the wrong market.** [tradeName](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/trade.mjs:5>) removes everything outside ASCII letters and digits, then [the market index](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/trade.mjs:37>) keys profiles by that result. Both `Москва` and `東京` normalize to an empty string. In a synthetic two-profile market, the name index contained only one entry and looking up Moscow returned the Tokyo profile. Stable profile/place IDs avoid this fallback. Reject empty normalized lookup keys and make any name fallback Unicode-aware and collision-aware. This is an existing international-content defect, not something caused by adding translation files.

4. **Medium-high: localized actor data is not fully supported by name-based automation.** [Sleep inference](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/camp.mjs:49>) recognizes English species/feature names. `Elf` produces `trance`; `Elfe` produces `full`. `Warforged` produces `none`; `Forgelier` produces `full`. [Favored-terrain inference](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/favored-terrain.mjs:2>) also uses English feature expressions and ASCII-normalized terrain text. An English Favored Terrain: Forest fixture matched `forest`; a translated name/identifier fixture matched nothing. Use reliable system identifiers or structured choices where available, with explicit overrides when they are absent. Existing UUID-based ration selection and ID-based skill/task operations are safer and should be retained. Translating the interface alone will not fix localized character-sheet content.

5. **High for deployment: the module has no translation catalog, and current packaging would omit one.** [module.json](<C:/Users/Konte/FoundryVTT Modules/kg-realms/module.json:23>) declares an empty `languages` array. [The package include list](<C:/Users/Konte/FoundryVTT Modules/kg-realms/tools/package.py:24>) does not include a `lang/` or `languages/` directory. Adding dictionaries to the development checkout without changing packaging would not ship them. Add the chosen directory to both full-package selection and [patch removal bookkeeping](<C:/Users/Konte/FoundryVTT Modules/kg-realms/tools/package.py:82>), and validate every manifest language path against the built ZIP. Keep the previous versioned release packages as usual.

6. **Medium-high: initialization and Foundry version differences need a small adapter.** Many label tables are evaluated at module-import time, including [travel methods](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/travel.mjs:15>), [camp tasks](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/camp-tasks.mjs:14>), categories, fields, and rules. Resolving translations there can run too early or freeze strings before a language change. Keep keys in these definitions and translate at rendering time, or initialize display caches after localization is ready. Foundry documents `i18nInit` after `init` and before `setup`. Its v13 API documents `format(id, data)`; the v14 API documents argument substitution on `localize(id, data)`. Use a capability-tested adapter and exercise both supported generations. The documentation difference is verified; availability of any deprecated alias in an installed v14 build was not tested.

7. **Medium: pluralization, grammar and formatting are assembled around English.** [Camp requests](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/ui-camp.mjs:633>) join skill names with English connectors and lowercase task labels. [Travel summaries](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/ui-hud.mjs:1213>) combine fragments and lowercase labels. Other messages choose `is/are`, append `s`, or concatenate units. Use complete sentence templates with named placeholders, explicit plural forms, and a locale-aware list formatter. Numbers currently mix browser-default formatting, `.toFixed`, and [explicit `en-US` currency formatting](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/trade.mjs:15>). Use the selected application language for display formatting; keep stored numbers and native numeric input values numeric. Language support does not require changing miles to kilometres or changing D&D currency mechanics.

8. **Medium-high for some scripts: DOM translation does not establish map-label font support.** [The map renderer](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/realm-layer.mjs:404>) serves glyphs from the bundled font directory. Each of Noto Sans Regular, Medium and Italic has only `0-255`, `256-511`, and `8192-8447` ranges. Greek, Cyrillic, CJK and Arabic are outside these bundled ranges. MapLibre has local-font behaviour, particularly for ideographs, so missing PBF coverage is not proof that every such label will fail. It does mean support is not guaranteed by this package. Test the bundled MapLibre 6.11.2, actual browser fonts, offline operation, and all used stacks; add the necessary glyph assets or a deliberate tested fallback. Text baked into a background image cannot be translated by the UI catalog.

9. **Medium for long translations, higher for RTL: layout needs language QA.** Text scans of `styles/realms.css` found 119 pixel-width declarations, 56 `nowrap` declarations, 117 physical left/right property matches, and only three logical-property matches. These are inspection leads, not 119 demonstrated defects. [Hover cards](<C:/Users/Konte/FoundryVTT Modules/kg-realms/styles/realms.css:309>), [the travel panel](<C:/Users/Konte/FoundryVTT Modules/kg-realms/styles/realms.css:438>), compact tabs, card footers, map editor rows, and popovers need expanded-text testing. RTL requires a separate pass over CSS placement and JavaScript geometry such as [the editor bounds calculation](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/ui-editbar.mjs:24>), rather than just applying `direction: rtl`. No translated-screen or RTL rendering result is claimed by this static audit.

10. **Medium: generated chat, journals and defaults have a different language lifetime from UI.** [Travel log creation](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/ui-hud.mjs:977>) and [chat messages](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/ui-hud.mjs:1001>) store generated text. Translating before creation gives the document the creating client's language; it will not become a different language for every reader or update when the reader changes language. That is a valid first-release policy if documented. Per-reader translated messages require structured message flags and rendering hooks, while retaining a usable saved fallback. Do not rewrite existing logs, GM notes, custom names, or revealed/secret sections. Biome and calendar defaults copied into settings should likewise retain stable IDs and respect user edits.

11. **Medium: name-based convenience matching must not become an identity system.** [Regional-map name matching](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/regional-place.mjs:4>) strips English prefixes such as Map of the; `Map of the Icewind Dale` matches a synthetic Icewind Dale Area while `Carte du Icewind Dale` does not. Existing explicit `placeId` and scene links are the reliable path. [Backup folder lookup](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/homebrew/homebrew.mjs:350>) and travel-log folder lookup also compare English folder names. Translating those constants can create extra folders or miss earlier folders. Retain stable flags/IDs, adopt the existing folder when appropriate, and localize its label only under an explicit policy. New document names may be authored in the creator's language, but existing documents should not be renamed on a language switch.

12. **Medium: tests and developer previews need localization-aware fixtures.** The behavioural suite is a useful baseline, but there are no dictionary-completeness, placeholder-parity, pseudo-locale, mixed-language, or font-coverage acceptance tests. Some UI tests inspect literal English or source fragments, such as [the filter tooltip assertion](<C:/Users/Konte/FoundryVTT Modules/kg-realms/tests/map-filters.test.mjs:40>) and [the border-tool text](<C:/Users/Konte/FoundryVTT Modules/kg-realms/tests/regional-coverage-ui.test.mjs:23>). Preserve English-fallback assertions where they test behaviour and replace implementation-specific checks where appropriate. Provide an injectable English translator for pure/headless tests rather than making routing/model modules require a live `game.i18n`. Current green tests establish the English baseline, not internationalization safety.

**Architecture that is already suitable**

There is no need to convert the UI to another frontend library. The existing HTML templates can call a small translation helper. The module already separates many stored IDs from labels: travel method keys, paces, camp task keys, visibility values, local-place categories, party/scene IDs, and card references. Keep that separation. [Place links](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/place-links.mjs:1>) use stable IDs and can survive translated display labels without changing their targets.

Map geometry, routes, miles-per-pixel, journey timings, portal transfers, token positions, and terrain grids do not need to change for UI localization. No map-tile rebuild is required. English-looking identifiers such as `foot`, `forest`, `realms`, `hidden`, and legacy `regionalMaps` setting keys are protocol/data tokens, not material for translators.

The public engine also has a useful content boundary: [registered world modules](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/worlds.mjs:1>) own their places and assets. Translating the engine will translate labels around Icewind Dale; it will not automatically translate a world's place names, market descriptions, lore, imported journals, custom encounters, or printed map art. World-content localization should be a separately scoped overlay keyed by stable IDs, if wanted.

Permission enforcement must remain independent of the displayed language. In particular, keep `gmOnly`, user roles, visibility values, actor ownership, event names, form names, `data-act` values, and camp-message keys unchanged. Preserve [private-card checks](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/place-card.mjs:119>) and [camp-message validation](<C:/Users/Konte/FoundryVTT Modules/kg-realms/scripts/camp-messages.mjs:18>) when changing the surrounding text. Translation dictionaries should contain reusable interface messages, never GM-authored encounter contents or other private world data.

**Recommended implementation boundary**

Start with an English `lang/en.json`, module-prefixed semantic keys, and a small late-evaluated `t`/formatted-message helper. Use public Foundry APIs with a v13/v14 compatibility branch. Keep numeric, plural and list formatting behind the same presentation boundary. Reuse formatter instances per language rather than constructing them per frame. Do not use private localization internals.

The first pass should preserve all existing persisted values. A known class can have a localized label while its stored value remains `Kingdom` or `Area`. Custom class text remains user-authored text. Translate an availability option's caption while leaving its value `Unavailable`. Where a label currently drives behaviour, such as vessels, detach the inference before replacing the label.

Use full message templates with named arguments so translators can change word order. Keep markup structure and action attributes in application code where practical, localize accessibility text as well as visible captions, and escape dynamic values for their actual HTML context. Review rich-text tooltip translations separately. Keep an English fallback for partial language packs and treat an unresolved key as a coverage failure during development.

For the initial release, a client reload after changing language is a reasonable explicit requirement. If live switching without reload is required, rerender mounted panels, refresh MapLibre label sources, rebuild display caches, and clear any cached localized strings. Neither choice requires a new multiplayer message transport for ordinary local UI.

**Effort estimate**

The baseline assumes one experienced contributor, familiar with this code, working on the current English engine. It covers all engine interfaces and their generated message templates, an English catalog, a tested non-English path, and backward-compatibility validation. It assumes the first target language uses a left-to-right Latin script and that the initial chat/log policy is creator-language text. It excludes translation of campaign/world content and unrelated feature work.

| Workstream | Developer hours |
| --- | ---: |
| String inventory, glossary, keys and scope decisions | 8-12 |
| Translation helper, English fallback, manifest and packaging | 6-10 |
| Extract settings, editors, travel/camp, settlement UI, cards, help and messages | 50-80 |
| Detach behavioural string coupling and cover integration fallbacks | 12-20 |
| Plural/number/date/list formatting, expansion and initial glyph checks | 10-18 |
| Automated coverage, pseudo-locale, compatibility and live regression checks | 12-20 |
| Total | 98-160 |

Round the budget to **100-160 developer hours**, about **13-20 eight-hour developer days** or **3-5 working weeks** with review and integration overhead. A small foundation plus one pilot screen is approximately **12-20 hours within that total**; it would prove the approach but would not constitute full internationalization.

| Additional scope | Provisional additional effort |
| --- | --- |
| One actual language: translation and native proofreading | Roughly 20-50 translator/reviewer hours; quote again after English word-count extraction |
| One language: developer visual QA and fixes | Roughly 8-16 hours, depending on expansion and script |
| CJK or another additional map-label script | Roughly 8-24 developer hours for fonts/fallbacks and browser/offline checks; rendering limitations may change this |
| RTL interface plus map/canvas acceptance | Roughly 24-48 developer hours; complex-script issues may require a separate renderer investigation |
| Per-reader localized generated chat and journal views | Roughly 20-40 developer hours, depending on historical-message requirements |
| World-module lore, market descriptions, encounters or raster map labels | Separate content/art project; not estimated from public engine source |

These additions can overlap, particularly font work and per-language QA. They should not be blindly summed as independent fixed-price tasks. A target-language list and extracted catalog are needed to tighten the estimate.

**Release plan and acceptance**

1. Freeze the terminology glossary: Areas groups Domains and Territories; Regional maps means detailed maps beneath a realm; Foundry Regions means the core feature. Give these concepts separate keys and translator context.
2. Introduce the English catalog and adapter, update package construction, and convert one representative editor screen and one dynamic camp message. Confirm English output and saved state are unchanged.
3. Convert the remaining UI in feature batches, detaching vessel/name-dependent logic before translating those labels. Keep live state IDs and existing aliases intact.
4. Add a pseudo-locale that expands strings by approximately 30-50 percent, changes word order, and exercises accents. Test plural branches including 0, 1, 2 and larger values without changing mechanics.
5. Validate key/placeholder parity, missing-language fallback, manifest paths and full/patch ZIP contents. Confirm old worlds, custom place types, map links, exports, trade data and ongoing journeys round-trip without translated IDs.
6. Exercise one GM and one player with different languages on supported Foundry generations, including camp requests, rolls, hidden encounters, regional crossings, settlements and scene returns. A translated GM-only badge must never alter the underlying access checks.
7. Check compact screens, long strings, non-Latin names, map glyphs, font fallback and offline downloads in Firefox and a Chromium-based client. Add RTL only when its separate acceptance tests pass.

The acceptable outcome is a presentation change: identical route distances, travel time, vehicle settings, camp/watch outcomes, market selections, permissions and serialized identifiers before and after changing language. If the conversion needs translated protocol values or rewriting existing campaign prose to work, the implementation has crossed the intended boundary.

**Primary references checked**

Foundry supports package language dictionaries declared in the manifest: [official localization guide](https://foundryvtt.com/article/localization/).

The documented localization APIs and initialization sequence were checked against [Foundry v13 Localization](https://foundryvtt.com/api/v13/classes/foundry.helpers.Localization.html), [Foundry v14 Localization](https://foundryvtt.com/api/v14/classes/foundry.helpers.Localization.html), and [v13 i18nInit](https://foundryvtt.com/api/v13/functions/hookEvents.i18nInit.html). Test installed versions rather than inferring support for undocumented compatibility aliases.

Map-label font work should use the documented [MapLibre glyph model](https://maplibre.org/maplibre-style-spec/glyphs/) and [local ideograph settings](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/StyleOptions/), with validation against KG Realms' bundled version rather than assuming every feature in the latest online documentation is present.

**Validation limits**

The code inventory, asset inventory, baseline suites, and synthetic-data probes above were executed against the stated checkout. No localization refactor, world migration, external publication, live language switch, multilingual session, or browser font-rendering acceptance was performed. The report identifies readiness and migration risk; it does not claim that the module is already safe in every language.
