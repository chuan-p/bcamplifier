#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8772}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-label-music-grid-to-list-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start "$ROOT_DIR" "$PORT" "$SERVER_LOG"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import sys

from chrome_fixture import report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]
returncode, stdout, stderr = run_chrome(
    chrome_bin,
    f"http://127.0.0.1:{port}/fixtures/label-music/music/?view=original",
    profile_dir,
    budget=6000,
    timeout=24,
    window="1400,480",
)
if returncode != 0:
    report_failed_run("label_music_grid_to_list_fixture_test", returncode, stderr)
    sys.exit(1)

checks = {
    'data-bcampx-grid-to-list-feed-hidden="false"': "list view was shown",
    'data-bcampx-grid-to-list-card-count="6"': "all cards were retained",
    'data-bcampx-grid-to-list-rendered-card-count="6"': "off-screen cards rendered without scrolling",
    'data-bcampx-grid-to-list-visible-placeholder-count="0"': "no supported-by placeholders remained visible",
}
missing = [label for token, label in checks.items() if token not in stdout]
if missing:
    print("label_music_grid_to_list_fixture_test=failed")
    for label in missing:
        print("missing=" + label)
    sys.exit(1)

print("label_music_grid_to_list_fixture_test=passed")
PY
