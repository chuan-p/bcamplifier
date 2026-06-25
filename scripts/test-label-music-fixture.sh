#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8766}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-label-music-fixture-server.log}

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
    "--window-size=1400,1600",
    "--virtual-time-budget=6000",
    "--dump-dom",
    f"http://127.0.0.1:{port}/fixtures/label-music/music/",
]

result = subprocess.run(cmd, capture_output=True, timeout=24)
stdout = result.stdout.decode("utf-8", "ignore")
stderr = result.stderr.decode("utf-8", "ignore")

if result.returncode != 0:
    print("label_music_fixture_test=failed")
    print("chrome_exit_code=" + str(result.returncode))
    if stderr:
        print(stderr)
    sys.exit(1)

checks = {
    'data-bcampx-page-kind="artist-music"': "page was recognized as artist music",
    'data-bcampx-label-feed-state="ready"': "label music feed was built",
    'data-bcampx-label-feed-count="6"': "all release links were collected",
    'data-bcampx-label-feed-source-hidden="true"': "native music grid was hidden",
    "bcampx-label-feed-toggle": "view toggle rendered",
    'data-bcampx-toggle-in-navbar="true"': "toggle was placed in the band navbar",
    'data-bcampx-toggle-inline="true"': "toggle used inline placement",
    'data-bcampx-toggle-navbar-class="true"': "toggle used navbar placement styling",
    'data-bcampx-navbar-host-class="true"': "navbar received alignment host styling",
    'data-bcampx-toggle-icon-count="2"': "toggle rendered list and grid icons",
    'data-bcampx-toggle-left-grid="true"': "grid icon rendered on the left",
    'data-bcampx-toggle-right-list="true"': "list icon rendered on the right",
    'data-bcampx-toggle-feed-state-initial="true"': "toggle started in feed state",
    'data-bcampx-label-selector-display="none"': "label artist selector was hidden in enhanced label view",
    'data-bcampx-toggle-original-grid-hidden="false"': "toggle showed original grid",
    'data-bcampx-toggle-original-feed-hidden="true"': "toggle hid enhanced feed",
    'data-bcampx-toggle-original-featured-hidden="false"': "toggle restored native featured releases",
    'data-bcampx-label-selector-original-display="block"': "label artist selector was visible in original grid view",
    'data-bcampx-toggle-grid-state="true"': "toggle switched to grid state",
    'data-bcampx-toggle-feed-grid-hidden="true"': "toggle restored enhanced feed",
    'data-bcampx-toggle-feed-feed-hidden="false"': "toggle showed enhanced feed again",
    'data-bcampx-toggle-feed-featured-hidden="true"': "enhanced feed hid native featured releases",
    'data-bcampx-toggle-feed-featured-display="none"': "enhanced feed forced native featured releases out of layout",
    'data-bcampx-label-selector-feed-display="none"': "label artist selector was hidden in enhanced feed view",
    'data-bcampx-toggle-feed-state-restored="true"': "toggle switched back to feed state",
    'data-bcampx-label-feed-card-count="6"': "featured releases were deduplicated",
    'data-bcampx-label-feed-list-tag="DIV"': "enhanced list avoided Bandcamp collection loader targeting",
    'data-bcampx-owned-buy-text="you own this"': "owned releases rendered ownership state",
    'data-bcampx-owned-buy-disabled="false"': "owned release buy button stayed clickable",
    'data-bcampx-owned-buy-url="https://bandcamp.com/fixturefan"': "owned release buy button carried collection URL",
    'data-bcampx-no-buy-text="hear more"': "release without purchase UI kept the plain fallback button",
    'data-bcampx-no-buy-has-price="false"': "release without purchase UI did not render a stale price",
    'data-bcampx-supporter-count-before-refresh="appears in 250+ collectionsrefresh"': "automatic supporter counts stopped at the display cap",
    'data-bcampx-supporter-count-before-refresh-exact="false"': "capped supporter counts remained inexact",
    'data-bcampx-supporter-refresh-visible="true"': "capped supporter counts showed the refresh button",
    'data-bcampx-supporter-count-text="appears in 330 collections"': "manual refresh continued from the preserved supporter count",
    'data-bcampx-supporter-count-exact="true"': "manual refresh resolved the exact supporter count",
    'data-bcampx-supporter-request-count="6"': "transient supporter failure retried before manual refresh resumed pagination",
    'data-bcampx-label-player-favorite-hidden="false"': "label music player showed the wishlist button",
    'data-bcampx-label-player-favorite-active-after-click="false"': "label music wishlist waited for completion before becoming active",
    'data-bcampx-label-player-favorite-pending-after-click="true"': "label music wishlist showed pending state after click",
    "bcampx-label-feed-card": "synthetic feed cards rendered",
    'class="bcampx__track-link"': "tracklist rendered playable buttons",
    'bcampx--supported-slot': "synthetic cards used the feed-style supported slot",
    'data-bcampx-enhanced-count="6"': "synthetic cards reused feed enhancement",
    "Track One": "album metadata rendered",
    "Synthetic Track": "track release rendered",
    "Description · 2 tracks": "album summary rendered",
    "buy now ($7)": "digital price rendered in label music buy buttons",
    "pre-order (name your price)": "pre-order albums rendered a compact pre-order button",
    "free download": "free download albums rendered the download button",
    "Owned Release": "owned release rendered",
    "No Buy Release": "release without purchase UI rendered",
}

missing = [label for token, label in checks.items() if token not in stdout]
if missing:
    print("label_music_fixture_test=failed")
    for label in missing:
        print("missing=" + label)
    sys.exit(1)

print("label_music_fixture_test=passed")
PY
