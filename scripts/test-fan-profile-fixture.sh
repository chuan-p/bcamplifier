#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8767}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-fan-profile-fixture-server.log}

cd "$ROOT_DIR"

python3 "$ROOT_DIR/scripts/serve-fan-profile-fixture.py" "$PORT" >"$SERVER_LOG" 2>&1 &
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
    "--host-resolver-rules=MAP bandcamp.com 127.0.0.1",
    "--window-size=1400,1600",
    "--virtual-time-budget=10000",
    "--dump-dom",
    f"http://bandcamp.com:{port}/fixturefan",
]

result = subprocess.run(cmd, capture_output=True, timeout=24)
stdout = result.stdout.decode("utf-8", "ignore")
stderr = result.stderr.decode("utf-8", "ignore")

if result.returncode != 0:
    print("fan_profile_fixture_test=failed")
    print("chrome_exit_code=" + str(result.returncode))
    if stderr:
        print(stderr)
    sys.exit(1)

checks = {
    'data-bcampx-followers-toggle-absent="true"': "followers started without the enhanced toggle",
    'data-bcampx-collection-card-count="2"': "collection built after the initially empty inactive grid became active",
    'data-bcampx-collection-toggle-visible="true"': "collection activation revealed the toggle",
    'data-bcampx-search-first="https://fixture.bandcamp.com/album/release-1"': "search initially mirrored its source grid",
    'data-bcampx-search-reconciled="https://fixture.bandcamp.com/album/release-3"': "search replacement removed stale enhanced cards",
    'data-bcampx-wishlist-count="appears in 1 234 collections"': "wishlist reused the native collection count",
    'data-bcampx-wishlist-count-exact="true"': "wishlist native count remained authoritative",
    'data-bcampx-localized-dot-count="1234"': "dot-separated localized collection counts parsed correctly",
    'data-bcampx-localized-space-count="1234"': "space-separated localized collection counts parsed correctly",
    'data-bcampx-supporter-request-count="0"': "native counts avoided supporter pagination requests",
    'data-bcampx-cached-tracklist-early-count="2"': "cached fan tracklists rendered before the release refresh completed",
    'data-bcampx-cached-native-stream="https://example.com/4.mp3"': "cached tracklists reused the page-fresh native preview",
    'data-bcampx-cached-stale-stream-cleared="true"': "cached tracklists did not expose stale non-native preview URLs",
    'data-bcampx-wishlist-refreshed-stream="https://example.com/4.mp3"': "stale playable track caches refreshed before replacing native preview data",
    'data-bcampx-wishlist-second-refreshed-stream="https://example.com/404.mp3"': "background refresh restored the remaining playable track URLs",
    'data-bcampx-wishlist-player-enabled="true"': "wishlist enhanced cards enabled the player wishlist button",
    'data-bcampx-wishlist-player-active="true"': "wishlist player state reflected the existing wishlist entry",
    'data-bcampx-player-returned-grid="wishlist-grid"': "player track title restored the source wishlist tab",
    'data-bcampx-player-scroll-release="https://fixture.bandcamp.com/album/release-4"': "player track title scrolled within the active release card",
    'data-bcampx-player-scroll-track="4"': "player track title targeted the exact track row",
    'data-bcampx-player-scroll-offset="-76"': "player track scrolling accounted for the sticky fan tabs",
    'data-bcampx-wishlist-player-pending="true"': "wishlist player click used the remote helper action",
    'data-bcampx-wishlist-last-card-preview="true"': "wishlist cards rendered their native preview before background fetching",
    'data-bcampx-wishlist-last-card-loaded="true"': "wishlist cards below the first viewport loaded without view all",
    'data-bcampx-tab-card-reused="true"': "fan tab switching reused previously enhanced card nodes",
    'data-bcampx-tab-enhance-delta="0"': "fan tab switching did not rebuild enhanced cards",
    'data-bcampx-tab-sync-delta="0"': "clean fan grids skipped source reconciliation during tab switching",
    'data-bcampx-tab-scan-delta="0"': "fan tab switching did not schedule full feed scans",
}

missing = [label for token, label in checks.items() if token not in stdout]
if missing:
    print("fan_profile_fixture_test=failed")
    for label in missing:
        print("missing=" + label)
    sys.exit(1)

print("fan_profile_fixture_test=passed")

deep_cmd = [
    chrome_bin,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--host-resolver-rules=MAP bandcamp.com 127.0.0.1",
    "--window-size=1400,1600",
    "--virtual-time-budget=2500",
    "--dump-dom",
    f"http://bandcamp.com:{port}/fixturefan/following/extra",
]
deep_result = subprocess.run(deep_cmd, capture_output=True, timeout=18)
deep_stdout = deep_result.stdout.decode("utf-8", "ignore")
if (
    deep_result.returncode != 0
    or '<section class="bcampx-label-feed"' in deep_stdout
):
    print("fan_profile_deep_following_scope_test=failed")
    sys.exit(1)

print("fan_profile_deep_following_scope_test=passed")
PY
