#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8765}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-fixture-server.log}

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
    "--disable-gpu",
    "--virtual-time-budget=6000",
    "--dump-dom",
    f"http://127.0.0.1:{port}/fixtures/feed/",
]

result = subprocess.run(cmd, capture_output=True, timeout=12)
stdout = result.stdout.decode("utf-8", "ignore")
stderr = result.stderr.decode("utf-8", "ignore")

if result.returncode != 0:
    print("fixture_test=failed")
    print("chrome_exit_code=" + str(result.returncode))
    if stderr:
        print(stderr)
    sys.exit(1)

checks = {
    'data-bcampx-script-loaded="true"': "core script booted",
    'data-bcampx-page-kind="feed"': "page was recognized as a feed",
    'data-bcampx-init-state="ready"': "feed initializer finished",
    'data-bcampx-enhance-attempt-count="1"': "enhancement pipeline ran once",
    'data-bcampx-enhanced-count="1"': "card was enhanced once",
    'class="bcampx bcampx--expanded"': "enhancement UI rendered",
    'Jan 2, 2024 · Shanghai': "release facts rendered",
    "Track One": "first track rendered",
    "Track Two": "second track rendered",
    "Extra context loaded": "summary state updated",
}

missing = [label for token, label in checks.items() if token not in stdout]

if missing:
    print("fixture_test=failed")
    for label in missing:
        print("missing=" + label)
    sys.exit(1)

print("fixture_test=passed")
PY
