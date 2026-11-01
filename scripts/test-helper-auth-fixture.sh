#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8775}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-helper-auth-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start "$ROOT_DIR" "$PORT" "$SERVER_LOG"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import re
import sys

from chrome_fixture import report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]
base = f"http://127.0.0.1:{port}/fixtures/security/helper-auth.html"


def dump(url):
    returncode, stdout, stderr = run_chrome(
        chrome_bin,
        url,
        profile_dir,
        budget=8000,
        timeout=20,
    )
    if returncode != 0:
        report_failed_run("helper_auth_fixture_test", returncode, stderr)
        sys.exit(1)
    return stdout


def token(dom, name):
    match = re.search(r'data-bcampx-fixture-%s="([^"]*)"' % name, dom)
    return match.group(1) if match else ""


failures = []


def expect(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


def expect_rejected(label, dom):
    if 'data-bcampx-script-loaded="true"' not in dom:
        failures.append(f"{label}: the shared core never booted")
    expect(f"{label} helper auth", token(dom, "helper-auth"), "rejected")
    expect(f"{label} wishlist POST count", token(dom, "post-count"), "0")


# The simplest attack: get the victim to open a crafted release link with no
# opener at all.
expect_rejected(
    "link attack",
    dump(
        base
        + "#bcampx-helper=wishlist&bcampx-request=fixture-1"
        + "&bcampx-parent-origin=https://attacker.example"
    ),
)

# The same attack but declaring an allow-listed Bandcamp parent origin while no
# such parent exists.
expect_rejected(
    "spoofed bandcamp parent",
    dump(
        base
        + "#bcampx-helper=wishlist&bcampx-request=fixture-2"
        + "&bcampx-parent-origin=https://bandcamp.com"
    ),
)

# Control: without helper parameters the helper must not run at all.
control = dump(base)
if 'data-bcampx-script-loaded="true"' not in control:
    failures.append("control: the shared core never booted")
expect("control helper auth", token(control, "helper-auth"), "")
expect("control wishlist POST count", token(control, "post-count"), "0")

if failures:
    print("helper_auth_fixture_test=failed")
    for failure in failures:
        print("failed=" + failure)
    sys.exit(1)

print("helper_auth_fixture_test=passed")
PY
