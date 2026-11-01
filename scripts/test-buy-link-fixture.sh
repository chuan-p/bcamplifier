#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8769}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-buy-link-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start "$ROOT_DIR" "$PORT" "$SERVER_LOG"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import sys

from chrome_fixture import report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]
returncode, stdout, stderr = run_chrome(
    chrome_bin,
    f"http://127.0.0.1:{port}/fixtures/feed/buy-link.html",
    profile_dir,
    budget=6000,
    timeout=12,
)
if returncode != 0:
    report_failed_run("buy_link_fixture_test", returncode, stderr)
    sys.exit(1)

checks = {
    'data-bcampx-script-loaded="true"': "core script booted",
    'data-bcampx-enhanced-count="1"': "card was enhanced",
    'data-bcampx-title-text="FREE DOWNLOAD The Riverbed EP"': "title link text was preserved",
    'data-bcampx-buy-text="free download"': "collect-controls buy link was updated",
}

missing = [label for token, label in checks.items() if token not in stdout]

if missing:
    print("buy_link_fixture_test=failed")
    for label in missing:
        print("missing=" + label)
    sys.exit(1)

print("buy_link_fixture_test=passed")
PY
