#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8770}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-description-url-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start "$ROOT_DIR" "$PORT" "$SERVER_LOG"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import sys

from chrome_fixture import report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]
returncode, stdout, stderr = run_chrome(
    chrome_bin,
    f"http://127.0.0.1:{port}/fixtures/feed/description-url.html",
    profile_dir,
    budget=6000,
    timeout=15,
)
if returncode != 0:
    report_failed_run("description_url_fixture_test", returncode, stderr)
    sys.exit(1)

checks = {
    'data-bcampx-script-loaded="true"': "core script booted",
    'data-bcampx-enhanced-count="1"': "card was enhanced",
    'data-bcampx-description-count="1"': "release description was rendered",
    'data-bcampx-description-text="music video: www.youtube.com/watch?v=BwjMHwDNRjo&amp;list=RDBwjMHwDNRjo&amp;start_radio=1"': "description link text was preserved",
    'data-bcampx-description-overflow="0"': "description did not overflow its own box",
    'data-bcampx-layout-fits="true"': "long description url did not widen the feed column",
}

missing = [label for token, label in checks.items() if token not in stdout]

if missing:
    print("description_url_fixture_test=failed")
    for label in missing:
        print("missing=" + label)
    sys.exit(1)

print("description_url_fixture_test=passed")
PY
