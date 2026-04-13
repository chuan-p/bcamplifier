#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

python3 - "$ROOT_DIR" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])

expected_host_permissions = [
    "https://bandcamp.com/*",
    "https://*.bandcamp.com/*",
]

expected_matches = [
    "https://bandcamp.com/feed*",
    "https://bandcamp.com/*/feed*",
    "https://bandcamp.com/album/*",
    "https://bandcamp.com/track/*",
    "https://*.bandcamp.com/album/*",
    "https://*.bandcamp.com/track/*",
]

manifests = [
    root / "manifest.chrome.json",
    root / "manifest.firefox.json",
]

for manifest_path in manifests:
    data = json.loads(manifest_path.read_text())
    host_permissions = data.get("host_permissions", [])
    if host_permissions != expected_host_permissions:
        raise SystemExit(
            f"{manifest_path.name}: unexpected host_permissions: {host_permissions!r}"
        )

    content_scripts = data.get("content_scripts", [])
    if len(content_scripts) != 1:
        raise SystemExit(
            f"{manifest_path.name}: expected exactly one content_scripts entry"
        )

    matches = content_scripts[0].get("matches", [])
    if matches != expected_matches:
        raise SystemExit(
            f"{manifest_path.name}: unexpected content script matches: {matches!r}"
        )

    if content_scripts[0].get("all_frames") is not True:
        raise SystemExit(f"{manifest_path.name}: expected all_frames=true")

    print(f"{manifest_path.name}: scope_ok")
PY
