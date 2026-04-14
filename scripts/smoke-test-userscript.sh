#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"
PORT=${PORT:-8768}
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-userscript-fixture-server.log}
CERT_DIR=${CERT_DIR:-/tmp/bcampx-userscript-cert}
TEST_URL=${TEST_URL:-https://bandcamp.com:${PORT}/feed}

if [ ! -f "$DIST_DIR/bcamplifier.user.js" ]; then
    echo "Built userscript is missing. Run ./scripts/build-extension.sh first." >&2
    exit 1
fi

if ! node -e 'require.resolve("playwright")' >/dev/null 2>&1; then
    echo "playwright is required for userscript smoke tests. Install it with: npm install playwright" >&2
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
    userscript \
    "$PORT" \
    "$CERT_DIR/cert.pem" \
    "$CERT_DIR/key.pem" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
    kill "$SERVER_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

sleep 1

node - "$TEST_URL" <<'JS'
const os = require("os");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const [testUrl] = process.argv.slice(2);
const parsed = new URL(testUrl);
const releaseUrl = `https://shop.fixture.example:${parsed.port}/album/synthetic-release`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "bcampx-userscript-smoke-"));

(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      ignoreHTTPSErrors: true,
      args: [
        "--ignore-certificate-errors",
        `--host-resolver-rules=MAP bandcamp.com 127.0.0.1, MAP shop.fixture.example 127.0.0.1, EXCLUDE localhost`,
      ],
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForFunction(
      () =>
        document.documentElement.getAttribute("data-bcampx-script-loaded") === "true" &&
        document.documentElement.getAttribute("data-bcampx-page-kind") === "feed" &&
        document.documentElement.getAttribute("data-bcampx-init-state") === "ready" &&
        document.documentElement.getAttribute("data-bcampx-enhanced-count") === "1",
      { timeout: 15000 },
    );

    const feedContent = await page.content();
    const missing = [];
    if (!feedContent.includes("Jan 2, 2024 · Shanghai")) {
      missing.push("userscript feed facts rendered");
    }
    if (!feedContent.includes("Description · 2 tracks")) {
      missing.push("userscript feed summary rendered");
    }
    if ((await page.locator("#fixture-main-card .bcampx").count()) !== 1) {
      missing.push("userscript main feed card enhanced");
    }
    if ((await page.locator("#fixture-sidebar-card .bcampx").count()) !== 0) {
      missing.push("userscript sidebar card remained filtered");
    }

    const releasePage = await context.newPage();
    await releasePage.goto(releaseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await releasePage.waitForFunction(
      () =>
        document.documentElement.getAttribute("data-bcampx-script-loaded") === "true" &&
        document.documentElement.getAttribute("data-bcampx-page-kind") === "other",
      { timeout: 15000 },
    );

    console.log("userscript_smoke_mode=playwright");
    console.log("userscript_smoke_fixture=" + (missing.length ? "failed" : "passed"));
    if (missing.length) {
      for (const label of missing) {
        console.log("missing=" + label);
      }
      console.log(feedContent);
      process.exitCode = 1;
    }

    await releasePage.close();
  } catch (error) {
    console.log("userscript_smoke_mode=playwright");
    console.log("userscript_smoke_fixture=failed");
    console.log(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
})();
JS
