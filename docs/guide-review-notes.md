# User guide review notes

Status: local review draft. Do not push or publish until reviewed.

Guide baseline: KG Realms 0.94.0. Includes the map generation checklist, card generation, regeneration without tokens, local background and placed tile rebuilding, and consistent scene/editor shortcuts. Trorune is the default example world. The guide remains local and unreviewed.

## Current review

- 26 text pages cover the 17 outline chapters.
- Installation uses the supplied Foundry setup, module activation and integration review screenshots. Original pixels are preserved.
- Installation uses the latest manifest URL directly. GitHub navigation and release-link copying steps and screenshots have been removed from the page.
- Mockups and stand-in UI captures have been removed from the guide.
- Rejected illustrations are archived locally under .cache/guide-rejected-mockups, outside the documentation.
- Real screenshots will be collected one at a time, in reading order.
- Calendaria is recommended for travel, watches, camp timekeeping, calendars and seasons.
- The other integrations are compatible/integrated optionals.

## Next screenshot

The supplied Module integrations screenshot has been added. All six integrations are enabled in it, so the guide identifies it as a manual review view from 0.93.10.

The supplied Scenes sidebar screenshot showing Generate Trorune has been added. The setup page distinguishes Generate (fresh realm scene) from importing an exported module's prepared scene.

Next: capture Trorune's Scenes compendium with its realm-map entry visible, before importing. Collect one screenshot at a time.

Separate Calendaria activation screenshots are no longer needed.

## Open and rebuild

- [Guide contents](guide/README.md)
- [Local preview](guide/preview/index.html)

```text
python tools/build-guide.py
python tools/check-guide.py
```

The builder renders the Markdown pages and existing screenshots. It does not generate UI mockups. The screenshot manifest is guide/assets/manifest.json.

No guide commit, push or publication has been made. Realm setup and export instructions now describe importing linked Regional maps and restoring their links after scene import.

First-load integration review was published in 0.93.9. The supplied integration screenshot is now included. No generated mockups were added.
