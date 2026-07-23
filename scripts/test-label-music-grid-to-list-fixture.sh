#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8768}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-label-music-grid-to-list-fixture-server.log}

cd "$ROOT_DIR"

python3 -m http.server "$PORT" --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
    kill "$SERVER_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

sleep 1

python3 - "$CHROME_BIN" "$PORT" <<'PY'
import subprocess
import sys

chrome_bin, port = sys.argv[1:3]
result = subprocess.run(
    [
        chrome_bin,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--window-size=1400,480",
        "--virtual-time-budget=6000",
        "--dump-dom",
        f"http://127.0.0.1:{port}/fixtures/label-music/music/?view=original",
    ],
    capture_output=True,
    timeout=24,
)
stdout = result.stdout.decode("utf-8", "ignore")
stderr = result.stderr.decode("utf-8", "ignore")

if result.returncode != 0:
    print("label_music_grid_to_list_fixture_test=failed")
    print("chrome_exit_code=" + str(result.returncode))
    if stderr:
        print(stderr)
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
