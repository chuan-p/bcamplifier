#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8765}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start "$ROOT_DIR" "$PORT" "$SERVER_LOG"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import re
import sys

from chrome_fixture import report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]
returncode, stdout, stderr = run_chrome(
    chrome_bin,
    f"http://127.0.0.1:{port}/fixtures/feed/",
    profile_dir,
    budget=6000,
    timeout=12,
)
if returncode != 0:
    report_failed_run("fixture_test", returncode, stderr)
    sys.exit(1)

checks = {
    'data-bcampx-script-loaded="true"': "core script booted",
    'data-bcampx-page-kind="feed"': "page was recognized as a feed",
    'data-bcampx-init-state="ready"': "feed initializer finished",
    'data-bcampx-enhance-attempt-count="2"': "enhancement pipeline ran twice",
    'data-bcampx-enhanced-count="2"': "cards were enhanced twice",
    'class="bcampx bcampx--expanded"': "enhancement UI rendered",
    'Jan 2, 2024 · Shanghai': "release facts rendered",
    "Track One": "first track rendered",
    "Track Two": "second track rendered",
    "Description · 2 tracks": "summary state updated",
    'data-bcampx-collection-playback="Fixture Artist - Collection Two Featured"': "collection grid continuous playback advanced to the next featured track",
    'data-bcampx-collection-shell-count="0"': "collection grid playback did not mount tracklist UI",
    'data-bcampx-collection-release-request-count="0"': "collection grid preview playback avoided release page requests",
}

missing = [label for token, label in checks.items() if token not in stdout]

if missing:
    print("fixture_test=failed")
    for label in missing:
        print("missing=" + label)
    sys.exit(1)

main_card = re.search(
    r'<article id="fixture-main-card"[\s\S]*?</article>',
    stdout,
)
sidebar_card = re.search(
    r'<article id="fixture-sidebar-card"[\s\S]*?</article>',
    stdout,
)
delayed_card = re.search(
    r'<article id="fixture-delayed-card"[\s\S]*?</article>',
    stdout,
)

if not main_card or 'class="bcampx' not in main_card.group(0):
    print("fixture_test=failed")
    print("missing=main feed card enhancement shell")
    sys.exit(1)

if not delayed_card or 'class="bcampx' not in delayed_card.group(0):
    print("fixture_test=failed")
    print("missing=delayed feed card enhancement shell")
    sys.exit(1)

if not sidebar_card:
    print("fixture_test=failed")
    print("missing=sidebar fixture card")
    sys.exit(1)

if 'class="bcampx' in sidebar_card.group(0):
    print("fixture_test=failed")
    print("missing=sidebar card remained filtered")
    sys.exit(1)

print("fixture_test=passed")
PY
