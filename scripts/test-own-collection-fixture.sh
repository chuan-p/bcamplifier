#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8774}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-own-collection-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start_process "$ROOT_DIR" "$PORT" "$SERVER_LOG" \
    python3 "$ROOT_DIR/scripts/serve-own-collection-fixture.py" "$PORT"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import re
import sys

from chrome_fixture import report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]


def dump(mode):
    returncode, stdout, stderr = run_chrome(
        chrome_bin,
        f"http://bandcamp.com:{port}/fixturefan?mode={mode}",
        profile_dir,
        budget=12000,
        timeout=24,
        resolver="MAP bandcamp.com 127.0.0.1",
    )
    if returncode != 0:
        report_failed_run("own_collection_fixture_test", returncode, stderr)
        sys.exit(1)
    return stdout


def token(dom, name):
    match = re.search(r'data-bcampx-fixture-%s="([^"]*)"' % name, dom)
    return match.group(1) if match else ""


failures = []


def expect(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


# A single-track purchase reported as an album tralbum shares its release URL
# with its album neighbours. On the signed-in fan's own collection each purchase
# must stay its own card so its own download link survives.
own_album = dump("own-album")
expect("own album card count", token(own_album, "card-count"), "2")
expect(
    "own album release urls",
    token(own_album, "release-urls"),
    "https://fixture.bandcamp.com/album/shared|"
    "https://fixture.bandcamp.com/album/shared",
)
expect(
    "own album download urls",
    token(own_album, "downloads"),
    "https://bandcamp.com/download/song-one|"
    "https://bandcamp.com/download/song-two",
)

# Track-typed purchases keep their own track URLs and downloads.
own_track = dump("own-track")
expect("own track card count", token(own_track, "card-count"), "2")
expect(
    "own track titles",
    token(own_track, "titles"),
    "Shared Song One|Shared Song Two",
)
expect(
    "own track download urls",
    token(own_track, "downloads"),
    "https://bandcamp.com/download/song-one|"
    "https://bandcamp.com/download/song-two",
)

# Own-page detection also works when Bandcamp only exposes the signed-in fan
# through identities.fan instead of fan_data.is_own_page.
own_identities = dump("own-identities")
expect("own identities card count", token(own_identities, "card-count"), "2")
expect(
    "own identities download urls",
    token(own_identities, "downloads"),
    "https://bandcamp.com/download/song-one|"
    "https://bandcamp.com/download/song-two",
)

# Another fan's collection keeps the adjacent-single merge behaviour.
other_album = dump("other-album")
expect("other fan card count", token(other_album, "card-count"), "1")
expect(
    "other fan release urls",
    token(other_album, "release-urls"),
    "https://fixture.bandcamp.com/album/shared",
)

# Reconciliation must not collapse same-URL purchases either: the "*-sync"
# modes touch the observed source grid after the initial build, which runs the
# sync path that used to deduplicate these cards by release URL.
own_album_sync = dump("own-album-sync")
expect("own album sync card count", token(own_album_sync, "card-count"), "2")
expect(
    "own album sync download urls",
    token(own_album_sync, "downloads"),
    "https://bandcamp.com/download/song-one|"
    "https://bandcamp.com/download/song-two",
)

own_track_sync = dump("own-track-sync")
expect("own track sync card count", token(own_track_sync, "card-count"), "2")
expect(
    "own track sync download urls",
    token(own_track_sync, "downloads"),
    "https://bandcamp.com/download/song-one|"
    "https://bandcamp.com/download/song-two",
)

other_album_sync = dump("other-album-sync")
expect("other fan sync card count", token(other_album_sync, "card-count"), "1")

if failures:
    print("own_collection_fixture_test=failed")
    for failure in failures:
        print("failed=" + failure)
    sys.exit(1)

print("own_collection_fixture_test=passed")
PY
