#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8775}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-batchcamp-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start_process "$ROOT_DIR" "$PORT" "$SERVER_LOG" \
    python3 "$ROOT_DIR/scripts/serve-batchcamp-fixture.py" "$PORT"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import re
import sys

from chrome_fixture import report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]
base_url = f"http://bandcamp.com:{port}"
resolver = "MAP bandcamp.com 127.0.0.1, MAP fixture.bandcamp.com 127.0.0.1, MAP f4.bcbits.com 127.0.0.1"


def dump(mode, budget=18000, timeout=40):
    returncode, stdout, stderr = run_chrome(
        chrome_bin,
        f"{base_url}/fixturefan?mode={mode}",
        profile_dir,
        budget=budget,
        timeout=timeout,
        resolver=resolver,
    )
    if returncode != 0:
        report_failed_run("batchcamp_fixture_test", returncode, stderr)
        sys.exit(1)
    return stdout


def token(dom, name):
    match = re.search(r'data-batchcamp-fixture-%s="([^"]*)"' % name, dom)
    return match.group(1) if match else ""


failures = []


def expect(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


def expect_list_state(dom, prefix):
    """The list view owns the page: the grid is offscreen and Batchcamp is off."""
    expect(prefix + " view", token(dom, prefix + "view"), "feed")
    expect(prefix + " native position", token(dom, prefix + "position"), "absolute")
    expect(prefix + " visible checkboxes", token(dom, prefix + "onscreen"), "0")
    expect(
        prefix + " select all visible",
        token(dom, prefix + "select-all"),
        "false",
    )


def expect_grid_state(dom, prefix):
    """The grid view hands the page back to Batchcamp, fully usable."""
    expect(prefix + " view", token(dom, prefix + "view"), "original")
    expect(prefix + " native position", token(dom, prefix + "position"), "static")
    expect(prefix + " visible checkboxes", token(dom, prefix + "onscreen"), "4")
    expect(prefix + " select all visible", token(dom, prefix + "select-all"), "true")


# Batchcamp installs before Bcamplifier.
installed = dump("install")
expect_list_state(installed, "feed-")
expect_grid_state(installed, "grid-")
expect("back to list: view", token(installed, "back-view"), "feed")
expect("back to list: select all hidden", token(installed, "back-select-all"), "false")

# Batchcamp installs after Bcamplifier (document_idle): hiding is pure CSS, so
# the controls are covered as soon as they appear, with no detection step.
late = dump("late")
expect("late: feed shown first", token(late, "view-before"), "feed")
expect("late: grid offscreen first", token(late, "position-before"), "absolute")
expect_list_state(late, "feed-")
expect_grid_state(late, "grid-")

# Appending a checkbox is not page content: it must not schedule a feed re-sync.
churn = dump("churn")
expect("churn: feed shown first", token(churn, "view-before"), "feed")
expect_list_state(churn, "feed-")
expect(
    "churn: feed sync count unchanged",
    token(churn, "sync-after"),
    token(churn, "sync-before"),
)

if failures:
    print("batchcamp_fixture_test=failed")
    for failure in failures:
        print("failed=" + failure)
    sys.exit(1)

print("batchcamp_fixture_test=passed")
PY
