#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8776}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-init-isolation-fixture-server.log}
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
    f"http://127.0.0.1:{port}/fixtures/init-isolation/music/",
    profile_dir,
    budget=9000,
    timeout=24,
)
if returncode != 0:
    report_failed_run("init_isolation_fixture_test", returncode, stderr)
    sys.exit(1)


def token(dom, name):
    match = re.search(r'data-bcampx-fixture-%s="([^"]*)"' % name, dom)
    return match.group(1) if match else ""


failures = []


def expect(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


# The fixture must prove the failure actually happened before asserting that
# the initializer survived it.
expect("build failure injected", token(stdout, "build-failure"), "true")
expect("feed build recorded an error", token(stdout, "feed-state"), "error")
if "synthetic feed mount failure" not in token(stdout, "init-error"):
    failures.append(
        "contained build error: expected the caught error message, got "
        + repr(token(stdout, "init-error"))
    )

# The rest of the initializer must still run: the page reaches "ready", the
# player shell is mounted, and no feed section was left in the DOM.
expect("initializer finished", token(stdout, "init-state"), "ready")
expect("player shell initialized", token(stdout, "player-shell"), "true")
expect("feed section not mounted", token(stdout, "feed-mounted"), "false")
expect("no unhandled rejections", token(stdout, "unhandled"), "0")

if failures:
    print("init_isolation_fixture_test=failed")
    for failure in failures:
        print("failed=" + failure)
    sys.exit(1)

print("init_isolation_fixture_test=passed")
PY
