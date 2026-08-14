#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8769}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-buy-link-fixture-server.log}

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
cmd = [
    chrome_bin,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--virtual-time-budget=6000",
    "--dump-dom",
    f"http://127.0.0.1:{port}/fixtures/feed/buy-link.html",
]

result = subprocess.run(cmd, capture_output=True, timeout=12)
stdout = result.stdout.decode("utf-8", "ignore")
stderr = result.stderr.decode("utf-8", "ignore")

if result.returncode != 0:
    print("buy_link_fixture_test=failed")
    print("chrome_exit_code=" + str(result.returncode))
    if stderr:
        print(stderr)
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
