"""Build a zip for sideloading into Foundry.

    python tools/package.py            dist/kg-realms v0.1.0.zip (from module.json's version)

The zip is named after the version in module.json, so every build is kept; an existing zip for
the same version is never overwritten. Bump the version for a new build.

It holds the Foundry runtime files plus the optional server-side image migration tool: the
manifest, scripts, styles, MapLibre and the vector-tile libraries, the fonts, the README and
CHANGELOG, the marker art and the ambient media, all inside a top-level kg-realms/ folder.
Extract it into Data/modules. Worlds ship in their own modules (KG Realms: Faerûn); in a dev
checkout data/worlds and the world assets are links to them and are never packaged here.
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / "module.json").read_text(encoding="utf-8"))
module_id = manifest["id"]
version = manifest["version"]

INCLUDE = [
    "module.json",
    "README.md",
    "CHANGELOG.md",
    "docs/rest-recovery-clock.md",
    "docs/regional-maps.md",
    "scripts/**/*.mjs",
    "styles/*.css",
    "lib/**/*",
    "data/fonts/**/*",
    "data/markers/*",
    # The carriage ride's pictures and the watch banner video. Its sound is the GM's own (a setting).
    "assets/media/*.jpg",
    "assets/media/*.webm",
    "lib/basis/*",
]
# Already compressed: stored as they are (faster, and the zip would not shrink them).
STORED = {".pmtiles", ".pbf", ".webm", ".mp4", ".ktx2"}

files = sorted({p for pattern in INCLUDE for p in ROOT.glob(pattern) if p.is_file()})
for entry in manifest.get("esmodules", []) + manifest.get("styles", []):
    assert (ROOT / entry) in files, f"manifest file missing: {entry}"

out = ROOT / "dist" / f"{module_id} v{version}.zip"
out.parent.mkdir(exist_ok=True)
if out.exists():
    sys.exit(f"{out.name} already exists. Bump the version in module.json.")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for path in files:
        method = zipfile.ZIP_STORED if path.suffix in STORED else zipfile.ZIP_DEFLATED
        z.write(path, f"{module_id}/{path.relative_to(ROOT).as_posix()}", compress_type=method)

print(f"{out}  (version {version})")
big = [p for p in files if p.stat().st_size > 1e6]
for path in big:
    print(f"  {module_id}/{path.relative_to(ROOT).as_posix()}  {path.stat().st_size / 1e6:.0f} MB")
print(f"{len(files)} files, {out.stat().st_size / 1e6:.0f} MB")

# The patch: only the packaged files changed since the previous release, in dist/patch, under the
# same kg-realms/ folder (extract it over an installed copy). The base is the last v* tag, which at
# packaging time is the previous release; --since vX.Y.Z picks another. Files the release removes
# cannot be removed by a zip: patch-manifest.json lists them to delete by hand.
import subprocess


def git(*args):
    return subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True).stdout


since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else git("describe", "--tags", "--abbrev=0", "--match", "v*").strip()
if since == f"v{version}":
    sys.exit(f"The patch base {since} is this version. Pass --since with the previous release tag.")
changed_names = set(git("diff", "--name-only", since).splitlines()) | set(git("ls-files", "--others", "--exclude-standard").splitlines())
packaged = {p.relative_to(ROOT).as_posix(): p for p in files}
# Files git does not track (assets/ is ignored): any packaged file written after the base release.
base_time = int(git("log", "-1", "--format=%ct", since).strip())
changed_names |= {n for n, p in packaged.items() if p.stat().st_mtime > base_time}
changed = sorted(n for n in changed_names if n in packaged)
shipped = ("scripts/", "styles/", "lib/", "data/", "assets/", "docs/rest-recovery-clock.md", "docs/regional-maps.md", "module.json", "README.md", "CHANGELOG.md", "tools/migrate-poi-images.mjs")
removed = {n for n in git("diff", "--name-only", "--diff-filter=D", since).splitlines() if n.startswith(shipped) and n not in packaged}
# Files the previous release's zip shipped that this one no longer does (dropped from packaging).
previous = ROOT / "dist" / f"{module_id} {since}.zip"
if previous.exists():
    with zipfile.ZipFile(previous) as old:
        removed |= {n.split("/", 1)[1] for n in old.namelist() if "/" in n and not n.endswith("/") and n.split("/", 1)[1] not in packaged}
removed = sorted(removed)
patch = ROOT / "dist" / "patch" / f"{module_id} v{version} patch.zip"
patch.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(patch, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name in changed:
        method = zipfile.ZIP_STORED if packaged[name].suffix in STORED else zipfile.ZIP_DEFLATED
        z.write(packaged[name], f"{module_id}/{name}", compress_type=method)
    z.writestr(f"{module_id}/patch-manifest.json", json.dumps({"module": module_id, "from": since, "to": f"v{version}", "changed": changed, "removed": removed}, indent=1))
print(f"{patch}  ({len(changed)} changed files since {since}, {patch.stat().st_size / 1e6:.2f} MB)")
for name in removed[:10]:
    print(f"  removed since {since} (delete by hand): {module_id}/{name}")
if len(removed) > 10:
    print(f"  ... and {len(removed) - 10} more removed files (all listed in patch-manifest.json)")
