# KG Realms release instructions

- Public repo: KonteiKeisei/kg-realms. Never commit world data, map art or anything from KG Realms: Faerûn (private, its own repo).
- Every version: bump `module.json` (version and its `download` URL), add a `CHANGELOG.md` section, run `npm test`, then `python tools/package.py`.
- Keep all earlier versioned zips. Do not overwrite an existing release zip.
- Release assets: the versioned zip, the patch zip, plus `kg-realms.zip` (a copy of the full zip) and `module.json`, which the manifest and download URLs point at.
