#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8773}
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-fan-profile-fixture-server.log}
. "$ROOT_DIR/scripts/lib/fixture.sh"
fixture_start_process "$ROOT_DIR" "$PORT" "$SERVER_LOG" \
    python3 "$ROOT_DIR/scripts/serve-fan-profile-fixture.py" "$PORT"

sleep 1

fixture_python - "$CHROME_BIN" "$PORT" "$fixture_profile" <<'PY'
import sys

from chrome_fixture import check_tokens, report_failed_run, run_chrome

chrome_bin, port, profile_dir = sys.argv[1:4]
base_url = f"http://bandcamp.com:{port}"


def dump(path, budget, timeout):
    return run_chrome(
        chrome_bin,
        base_url + path,
        profile_dir,
        budget=budget,
        timeout=timeout,
        resolver=(
            "MAP bandcamp.com 127.0.0.1, "
            "MAP f4.bcbits.com 127.0.0.1, "
            "MAP example.com 127.0.0.1"
        ),
    )


returncode, stdout, stderr = dump("/fixturefan", 28000, 40)
if returncode != 0:
    report_failed_run("fan_profile_fixture_test", returncode, stderr)
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
    'data-bcampx-wishlist-loading-summary="Loading extra context..."': "wishlist cards showed loading while release context refreshed",
    'data-bcampx-wishlist-loading-state="true"': "wishlist cards carried the loading state while release context refreshed",
    'data-bcampx-wishlist-slot-loading="Loading extra context..."': "wishlist tracklist slot showed the loading message while release context refreshed",
    'data-bcampx-wishlist-slot-loading-visible="true"': "wishlist tracklist slot loading message was not hidden",
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
    'data-bcampx-auto-fetch-limit="4"': "automatic release fetches used the configured concurrency limit",
    'data-bcampx-auto-fetch-peak-count="4"': "automatic release fetches filled but did not exceed the concurrency limit",
    'data-bcampx-auto-fetch-active-count="0"': "automatic release fetches settled after the fixture run",
    'data-bcampx-auto-fetch-queue-count="0"': "automatic release fetch queue drained after the fixture run",
    'data-bcampx-tag-search-matched-before-clear="1"': "tag-only search matched the locally indexed tag",
    'data-bcampx-tag-search-card-count="1"': "tag-only search appended one enhanced card",
    'data-bcampx-tag-search-card-url="https://fixture.bandcamp.com/album/release-9"': "tag match rendered the tagged release",
    'data-bcampx-tag-search-card-order="https://fixture.bandcamp.com/album/release-3,https://fixture.bandcamp.com/album/release-9"': "tag match was appended after the native search results",
    'data-bcampx-tag-cards-with-tracks="1"': "the tag result kept its tracklist",
    'data-bcampx-tag-cards-total="1"': "exactly one tag result was in the list",
    'data-bcampx-tag-search-setup="bound"': "tag search bridge bound on the fan collection page",
    'data-bcampx-tag-index-pending="collection,wishlist"': "a fresh index scheduled both grids",
    'data-bcampx-tag-index-state="filled"': "tag index finished its background run",
    'data-bcampx-tag-index-items="20"': "tag index covered both collection and wishlist",
    'data-bcampx-tag-index-tagged="10"': "tag index fetched every release's tags",
    'data-bcampx-tag-card-survived="true"': "a tag card kept its tracklist when the native result arrived",
    'data-bcampx-tag-card-copies="1"': "the arriving native result did not duplicate the tag card",
    'data-bcampx-tag-search-view="original"': "view toggle switched to the native grid",
    'data-bcampx-tag-search-section-count="0"': "the native grid has no tag block",
    'data-bcampx-tag-search-cleared-matches="0"': "clearing the search box dropped the tag matches",
    'data-bcampx-tag-search-cleared-feed-count="0"': "clearing the search box removed tag-only cards from the feed",
    'data-bcampx-tag-search-cleared-section="false"': "clearing the search box removed the native tag block",
    'data-bcampx-tag-search-no-match-card="https://fixture.bandcamp.com/album/release-10"': "a tag-only query still rendered its match",
    'data-bcampx-tag-search-no-match-hidden="false"': "the native view left Bandcamp's no-match notice alone",
    'data-bcampx-feed-outside-grid="true"': "the enhanced feed stayed outside Bandcamp's managed grid",
    'data-bcampx-feed-centered="true"': "the enhanced feed was centered like the grid",
    'data-bcampx-fixture-tag-setting-label="Tag search (experimental)"': "the tag setting is marked experimental",
    'data-bcampx-fixture-tag-setting-progress="true"': "the tag setting showed cache progress",
    'data-bcampx-tag-search-no-match-leak="false"': "the no-match notice never leaked into a release card",
    'data-bcampx-tag-native-origins="native,native"': "tag matches reused native cards for on-page releases",
    'data-bcampx-tag-native-art="true"': "native-backed tag cards kept their cover art",
    'data-bcampx-tag-native-playerdata="true"': "native-backed tag cards kept their preview data",
    'data-bcampx-tag-index-origin="index"': "off-page tag matches rendered from the index",
    'data-bcampx-tag-index-art="https://f4.bcbits.com/img/a0000054321_16.jpg"': "index-only tag cards derived their cover art from the art id",
    'data-bcampx-tracklist-source="mobile-api"': "a release page without tracks fell back to the mobile API tracklist",
    'data-bcampx-api-tracklist-label="API Track 30"': "the mobile API tracklist rendered its track rows",
    'data-bcampx-api-tracklist-stream="https://example.com/api-30.mp3"': "the mobile API tracklist carried playable streams",
    'data-bcampx-api-tracklist-after="present"': "the mobile API tracklist survived later feed syncs",
}

if not check_tokens(stdout, checks, "fan_profile_fixture_test"):
    sys.exit(1)

deep_returncode, deep_stdout, _ = dump("/fixturefan/following/extra", 2500, 18)
deep_ok = (
    deep_returncode == 0
    and 'data-bcampx-script-loaded="true"' in deep_stdout
    and '<section class="bcampx-label-feed"' not in deep_stdout
)
print(
    "fan_profile_deep_following_scope_test="
    + ("passed" if deep_ok else "failed")
)
if not deep_ok:
    sys.exit(1)

up_to_date_returncode, up_to_date_stdout, up_to_date_stderr = dump(
    "/fixturefan-uptodate", 9000, 20
)
if up_to_date_returncode != 0:
    report_failed_run(
        "fan_profile_up_to_date_test",
        up_to_date_returncode,
        up_to_date_stderr,
    )
    sys.exit(1)

up_to_date_checks = {
    'data-bcampx-tag-index-state="up-to-date"': "a complete, fresh index skipped the background run",
    'data-bcampx-tag-index-pending=""': "no grid needed index work",
    'data-bcampx-tag-index-items="10"': "the skipped run reported the stored index sizes",
    'data-bcampx-fixture-tag-requests="0"': "an up-to-date index issued no tag requests",
    'data-bcampx-fixture-hook-state="up-to-date"': (
        "the debug hook reported the settled state"
    ),
    'data-bcampx-fixture-hook-items="10"': (
        "the debug hook reported the stored item count"
    ),
    'data-bcampx-fixture-hook-complete="true"': (
        "the debug hook reported a complete item list"
    ),
    'data-bcampx-fixture-summary-state="up-to-date"': (
        "the JSON summary attribute reported the settled state"
    ),
    'data-bcampx-fixture-summary-items="10"': (
        "the JSON summary attribute reported the stored item count"
    ),
    'data-bcampx-fixture-summary-store="records"': (
        "the tag cache migrated to per-record storage"
    ),
}

if not check_tokens(
    up_to_date_stdout,
    up_to_date_checks,
    "fan_profile_up_to_date_test",
):
    sys.exit(1)

rate_limit_returncode, rate_limit_stdout, rate_limit_stderr = dump(
    "/fixturefan-ratelimit", 9000, 20
)
if rate_limit_returncode != 0:
    report_failed_run(
        "fan_profile_rate_limit_test",
        rate_limit_returncode,
        rate_limit_stderr,
    )
    sys.exit(1)

rate_limit_checks = {
    'data-bcampx-tag-index-state="cooldown"': "a 429 stopped the index run",
    'data-bcampx-fixture-request-burst="true"': "a 429 stopped further index requests",
    'data-bcampx-fixture-cooldown-active="true"': "the cooldown was persisted",
    'data-bcampx-fixture-cooldown-level="1"': "the cooldown started at the first backoff step",
}

if not check_tokens(
    rate_limit_stdout,
    rate_limit_checks,
    "fan_profile_rate_limit_test",
):
    sys.exit(1)

disabled_returncode, disabled_stdout, disabled_stderr = dump(
    "/fixturefan-disabled", 12000, 25
)
if disabled_returncode != 0:
    report_failed_run(
        "fan_profile_tag_search_disabled_test",
        disabled_returncode,
        disabled_stderr,
    )
    sys.exit(1)

disabled_checks = {
    'data-bcampx-fixture-index-state="disabled"': (
        "tag search is disabled by default"
    ),
    'data-bcampx-fixture-setup="false"': (
        "the tag search bridge was not bound"
    ),
    'data-bcampx-fixture-tag-requests="0"': (
        "a disabled tag search issued no requests"
    ),
    'data-bcampx-fixture-matches="none"': (
        "typing a tag query produced no tag matches"
    ),
}

if not check_tokens(
    disabled_stdout,
    disabled_checks,
    "fan_profile_tag_search_disabled_test",
):
    sys.exit(1)

resume_returncode, resume_stdout, resume_stderr = dump(
    "/fixturefan-resume", 16000, 30
)
if resume_returncode != 0:
    report_failed_run(
        "fan_profile_resume_test",
        resume_returncode,
        resume_stderr,
    )
    sys.exit(1)

resume_checks = {
    'data-bcampx-fixture-items="42"': "resumed run kept the earlier items",
    'data-bcampx-fixture-has-old="true"': (
        "item from the first run survived the resumed run"
    ),
    'data-bcampx-fixture-has-new="true"': "resumed page was merged",
    'data-bcampx-fixture-has-seed="true"': "newest page items were merged",
    'data-bcampx-fixture-resumed="true"': (
        "enumeration resumed from the stored token"
    ),
    'data-bcampx-fixture-complete="true"': "item list finished enumerating",
    'data-bcampx-tag-index-items="42"': "app reported the full item count",
    'data-bcampx-tag-index-items-complete="true"': (
        "app reported the item list as complete"
    ),
}

if not check_tokens(
    resume_stdout,
    resume_checks,
    "fan_profile_resume_test",
):
    sys.exit(1)
PY
