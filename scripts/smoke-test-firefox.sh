#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"
FIREFOX_BIN=$("$ROOT_DIR/scripts/find-firefox.sh")
PORT=${PORT:-8767}
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-firefox-fixture-server.log}
CERT_DIR=${CERT_DIR:-/tmp/bcampx-firefox-cert}
TEST_URL=${TEST_URL:-https://bandcamp.com:${PORT}/feed}

if [ ! -f "$DIST_DIR/bcamplifier-firefox.xpi" ]; then
    echo "Firefox package is missing. Run ./scripts/build-extension.sh first." >&2
    exit 1
fi

if ! python3 - <<'PY' >/dev/null 2>&1
import importlib.util
raise SystemExit(0 if importlib.util.find_spec("selenium") else 1)
PY
then
    echo "selenium is required for Firefox smoke tests. Install it with: python3 -m pip install --user selenium" >&2
    exit 1
fi

rm -rf "$CERT_DIR"
mkdir -p "$CERT_DIR"

openssl req \
    -x509 \
    -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 1 \
    -nodes \
    -subj "/CN=bandcamp.com" >/dev/null 2>&1

python3 "$ROOT_DIR/scripts/serve-smoke-fixture.py" \
    "$ROOT_DIR" \
    extension \
    "$PORT" \
    "$CERT_DIR/cert.pem" \
    "$CERT_DIR/key.pem" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
    kill "$SERVER_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

sleep 1

python3 - "$ROOT_DIR" "$DIST_DIR/bcamplifier-firefox.xpi" "$TEST_URL" "$FIREFOX_BIN" <<'PY'
import sys
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait

root_dir, addon_path, test_url, firefox_bin = sys.argv[1:5]
release_url = (
    f"https://fixture.bandcamp.com:{urlparse(test_url).port}/album/synthetic-release"
)

options = Options()
options.binary_location = firefox_bin
options.add_argument("-headless")
options.accept_insecure_certs = True
options.set_preference(
    "network.dns.forceResolve",
    "bandcamp.com|127.0.0.1,fixture.bandcamp.com|127.0.0.1,shop.fixture.example|127.0.0.1",
)
options.set_preference(
    "network.dns.localDomains",
    "bandcamp.com,fixture.bandcamp.com,shop.fixture.example",
)
options.set_preference("network.proxy.type", 0)
options.set_preference("security.enterprise_roots.enabled", True)
options.set_preference("xpinstall.signatures.required", False)
options.set_preference("extensions.autoDisableScopes", 0)
options.set_preference("extensions.enabledScopes", 15)
options.set_preference("extensions.startupScanScopes", 0)

driver = None

try:
    driver = webdriver.Firefox(options=options)
    driver.install_addon(addon_path, temporary=True)
    driver.get(test_url)

    WebDriverWait(driver, 20).until(
        lambda d: d.execute_script(
            """
            return (
              document.documentElement.getAttribute("data-bcampx-host") === "webextension" &&
              document.documentElement.getAttribute("data-bcampx-init-state") === "ready" &&
              document.documentElement.getAttribute("data-bcampx-enhanced-count") === "2" &&
              document.querySelectorAll("#fixture-main-card .bcampx").length === 1 &&
              document.querySelectorAll("#fixture-delayed-card .bcampx").length === 1 &&
              document.querySelectorAll("#fixture-sidebar-card .bcampx").length === 0 &&
              (document.querySelector("#fixture-main-card .bcampx__facts")?.textContent || "").includes("2024") &&
              (document.querySelector("#fixture-main-card .bcampx__facts")?.textContent || "").includes("Shanghai") &&
              (document.querySelector("#fixture-delayed-card .bcampx__empty")?.textContent || "").includes("custom domain")
            );
            """
        )
    )

    card_state = driver.execute_script(
        """
        return {
          main: document.querySelectorAll("#fixture-main-card .bcampx").length,
          delayed: document.querySelectorAll("#fixture-delayed-card .bcampx").length,
          sidebar: document.querySelectorAll("#fixture-sidebar-card .bcampx").length,
          mainFacts:
            document.querySelector("#fixture-main-card .bcampx__facts")?.textContent || "",
          mainTrackTitles: Array.from(
            document.querySelectorAll("#fixture-main-card .bcampx__tracks li")
          ).map((node) => node.textContent || ""),
          delayedMessage:
            document.querySelector("#fixture-delayed-card .bcampx__empty")?.textContent || "",
        };
        """
    )
    if card_state["main"] != 1 or card_state["delayed"] != 1 or card_state["sidebar"] != 0:
        raise RuntimeError("Firefox smoke fixture did not render the expected enhancement shells.")
    if "2024" not in card_state["mainFacts"] or "Shanghai" not in card_state["mainFacts"]:
        raise RuntimeError("Firefox smoke fixture did not render release facts on the main card.")
    if "Track One" not in card_state["mainTrackTitles"]:
        raise RuntimeError("Firefox smoke fixture did not render the main-card tracklist.")
    if "custom domain" not in card_state["delayedMessage"].lower():
        raise RuntimeError("Firefox smoke fixture did not show the custom-domain limitation message.")

    driver.get(release_url)
    WebDriverWait(driver, 20).until(
        lambda d: d.execute_script(
            """
            return (
              document.documentElement.getAttribute("data-bcampx-host") === "webextension" &&
              document.documentElement.getAttribute("data-bcampx-script-loaded") === "true" &&
              document.documentElement.getAttribute("data-bcampx-page-kind") === "other"
            );
            """
        )
    )

    print("firefox_smoke_mode=selenium")
    print("firefox_smoke_fixture=passed")
except Exception as error:
    print("firefox_smoke_mode=selenium")
    print("firefox_smoke_fixture=failed")
    print(error)
    if driver is not None:
        try:
            print(driver.page_source)
        except Exception:
            pass
    raise SystemExit(1)
finally:
    if driver is not None:
        driver.quit()
PY
