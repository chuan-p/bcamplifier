#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"
CHROME_BIN=${CHROME_BIN:-/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome}
TEST_URL=${TEST_URL:-https://bandcamp.com}

if [ ! -d "$DIST_DIR/chrome" ] || [ ! -f "$DIST_DIR/chrome/manifest.json" ]; then
    echo "Chrome build output is missing. Run ./scripts/build-extension.sh first." >&2
    exit 1
fi

python3 - "$CHROME_BIN" "$DIST_DIR/chrome" "$TEST_URL" <<'PY'
import subprocess
import sys

chrome_bin, extension_dir, test_url = sys.argv[1:4]
cmd = [
    chrome_bin,
    "--headless=new",
    "--disable-gpu",
    "--virtual-time-budget=4000",
    "--user-data-dir=/tmp/bcampx-smoke-profile",
    f"--load-extension={extension_dir}",
    "--dump-dom",
    test_url,
]

try:
    result = subprocess.run(cmd, capture_output=True, timeout=12)
    stderr = result.stderr.decode("utf-8", "ignore")
    timed_out = False
except subprocess.TimeoutExpired as exc:
    stderr = (exc.stderr or b"").decode("utf-8", "ignore")
    timed_out = True

manifest_error = "manifest" in stderr.lower() and "error" in stderr.lower()

print("chrome_smoke_timeout=" + ("true" if timed_out else "false"))
print("chrome_manifest_error=" + ("true" if manifest_error else "false"))

if manifest_error:
    print(stderr)
    sys.exit(1)
PY
