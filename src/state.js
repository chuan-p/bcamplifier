export const PLAYER_SHELL_CSS =
    typeof __BCAMPX_PLAYER_SHELL_CSS__ !== "undefined"
        ? __BCAMPX_PLAYER_SHELL_CSS__
        : "";
export const ENHANCEMENT_CSS =
    typeof __BCAMPX_ENHANCEMENT_CSS__ !== "undefined"
        ? __BCAMPX_ENHANCEMENT_CSS__
        : "";
export const SCRIPT_VERSION =
    typeof __BCAMPX_SCRIPT_VERSION__ !== "undefined"
        ? __BCAMPX_SCRIPT_VERSION__
        : "";
export const BUILD_ID =
    typeof __BCAMPX_BUILD_ID__ !== "undefined" ? __BCAMPX_BUILD_ID__ : "";

export const CONFIG = {
    autoFetchOnVisible: true,
    expandAfterAutoFetch: true,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    trackCacheTtlMs: 12 * 60 * 60 * 1000,
    fetchTimeoutMs: 15000,
    maxTracks: 40,
    initialVisibleTracks: 6,
    maxDescriptionLength: 420,
    observerRootMargin: "450px 0px",
    scanDebounceMs: 160,
    minFanActivityCardWidth: 420,
    autoExpandTracks: false,
    enableTrackRowActions: true,
    continuousMode: false,
    autoFillMinimumPrice: false,
    showCollectionCounts: false,
    enableTagSearch: false,
    maxConcurrentFetches: 4,
    maxConcurrentAutoFetches: 4,
    maxViewSwitchPrefetchCards: 24,
    maxConcurrentSupporterCountFetches: 2,
    supporterCountPageSize: 80,
    supporterCountPageDelayMs: 120,
    supporterCountRequestRetries: 2,
    supporterCountRetryDelayMs: 400,
    supporterCountCacheTtlMs: 12 * 60 * 60 * 1000,
    maxSupporterExactCount: 250,
    maxSupporterRefreshPages: 200,
    maxReleaseCacheEntries: 250,
    // Tag-aware collection search. Bandcamp's own search only knows titles
    // and artists, so tags are indexed locally in small background runs.
    tagIndexStartDelayMs: 2500,
    // Bandcamp rate-limits bursts, so index requests are paced: two in
    // flight, at least 450 ms apart, and a page-wide budget.
    tagIndexFetchConcurrency: 2,
    tagIndexFetchesPerRun: 80,
    // Collection pagination gets its own, smaller page budget so walking
    // the list cannot consume the tag requests (and vice versa).
    tagIndexPageFetchesPerRun: 20,
    tagIndexBackgroundStartDelayMs: 15000,
    tagIndexMinGapMs: 1000,
    tagIndexCooldownBaseMs: 2 * 60 * 1000,
    tagIndexCooldownMaxMs: 15 * 60 * 1000,
    tagIndexPagePauseMs: 1000,
    tagIndexMaxPages: 400,
    tagIndexPagesPerRun: 20,
    tagIndexMaxItems: 6000,
    tagIndexItemsTtlMs: 3 * 24 * 60 * 60 * 1000,
    tagIndexFailureBackoffMs: 30 * 60 * 1000,
    releaseTagTtlMs: 90 * 24 * 60 * 60 * 1000,
    releaseTagEmptyTtlMs: 7 * 24 * 60 * 60 * 1000,
    releaseFetchCooldownMs: 2 * 60 * 1000,
    apiTrackCacheTtlMs: 30 * 60 * 1000,
    // Tracklists are small but a long browsing session can touch many
    // releases; keep the in-memory map bounded.
    apiTrackCacheMaxEntries: 500,
    maxReleaseTagCacheEntries: 10000,
    maxTagSearchMatches: 400,
    tagSearchInitialResults: 80,
};

// 19: release cache entries carry the viewer identity their account fields
// belong to, so an entry written for another account is refreshed instead
// of being shown as this account's purchase state.
export const CACHE_SCHEMA_VERSION = 19;

export const RELEASE_CACHE_PREFIX = "bcampx:release:";

export const RELEASE_SUPPORTER_COUNT_CACHE_PREFIX = "bcampx:releaseSupporters:";

export const RELEASE_CACHE_INDEX_KEY = "bcampx:releaseCacheIndex";

export const RELEASE_CACHE_INDEX_LOCK_NAME = "bcampx:releaseCacheIndex";

export const RELEASE_CACHE_REPAIR_KEY = "bcampx:releaseCacheRepairedAt";

export const USER_SETTINGS_KEY = "bcampx:userSettings";

export const ARTIST_MUSIC_VIEW_KEY = "bcampx:artistMusicView";

export const PLAYBACK_PAUSE_REQUEST_KEY = "bcampx:playbackPauseRequest";

export const OWNED_RELEASE_COLLECTION_SEARCH_KEY =
    "bcampx:ownedReleaseCollectionSearch";

export const TAG_INDEX_PREFIX = "bcampx:tagIndex:";

export const TAG_INDEX_STATUS_PREFIX = "bcampx:tagIndexStatus:";

export const TAG_INDEX_COOLDOWN_KEY = "bcampx:tagIndexCooldown";

export const TAG_INDEX_OWNER_KEY = "bcampx:tagIndexOwner";

export const PLAYBACK_PAUSE_POLL_MS = 1000;

export const PLAYBACK_PAUSE_STALE_MS = 10000;

export const PLAYER_WISHLIST_STATE_RETRY_MS = 30000;

export const TRACK_ACTION_AUTH_TIMEOUT_MS = 1200;

export const OWNED_RELEASE_COLLECTION_SEARCH_TTL_MS = 2 * 60 * 1000;

export const LOADING_EXTRA_CONTEXT_TEXT = "Loading extra context...";

export const STATE = {
    initialized: false,
    artistMusicFeedBuilt: false,
    artistMusicFeedNode: null,

    artistMusicSourceGridNode: null,
    artistMusicFeedCandidateCache: null,
    tagSearchQueryByKind: { collection: "", wishlist: "" },
    fanTagIndexCache: new Map(),
    tagIndexDirty: new Map(),
    tagIndexSeedIds: {},
    tagIndexRateLimited: false,
    releaseTagCacheLoadedAt: 0,
    releaseFetchCooldownUntil: 0,
    releaseTagCache: null,
    observer: null,
    activeReleaseUrl: "",
    playerUi: null,
    playerHost: null,
    playerSettingsOpen: false,
    unavailableReleaseUrls: new Set(),
    ownedLinkCacheDirty: true,
    apiReleaseTrackCache: new Map(),
    autoFetchQueue: [],
    playerWishlistStateByUrl: new Map(),
    playerWishlistActionRequests: new Set(),
    playbackPauseUnsubscribe: null,
    memoVersion: 1,
    tagIndexCooldownUntil: 0,
    releaseTagCacheInitialized: false,
    releaseTagPendingWrites: new Map(),
};

export const RELEASE_LINK_SELECTOR = [
    'a[href*="/album/"]',
    'a[href*="/track/"]',
].join(",");

export const SUPPORTED_SLOT_SELECTOR = [
    ".story-body .tralbum-wrapper .tralbum-wrapper-col2.tralbum-owners",
    ".tralbum-wrapper .tralbum-wrapper-col2.tralbum-owners",
    ".tralbum-wrapper-col2.tralbum-owners",
].join(",");

export const CONTENT_COLUMN_SELECTOR = [
    ".story-body .tralbum-wrapper .tralbum-wrapper-col1",
    ".tralbum-wrapper .tralbum-wrapper-col1",
    ".tralbum-wrapper-col1",
].join(",");

export const FEED_CARD_ROOT_SELECTOR = [
    "li.story",
    ".story",
    ".feed-item",
    ".feedItem",
    ".feed_item",
    ".feed-story",
    ".feedStory",
    ".activity-item",
    ".fan-feed-item",
].join(",");

export const INTERNAL_MUTATION_SELECTOR = [
    "#bcampx-player-host",
    ".bcampx",
    ".bcampx__helper-status",
    ".bcampx__merge-note",
    ".bcampx-label-feed-toggle",
    ".bcampx-label-feed-navbar-host",
    ".bcampx-player-audio",
    // Batchcamp's own controls: seeing them appear inside the collection
    // grid must not invalidate caches or re-sync the feed.
    ".bc-checkbox",
    ".bc-select-all-wrapper",
    ".bc-download-wrapper",
    ".bc-visually-hidden",
    ".bc-dropdown",
].join(",");

export const CARD_SELECTOR = [
    "article",
    "li",
    ".feed-item",
    ".feedItem",
    ".feed_item",
    ".feed-story",
    ".feedStory",
    ".story",
    ".activity",
    ".activity-item",
    ".collection-item",
    ".fan-feed-item",
    ".item",
].join(",");

export const ENHANCED_ATTR = "data-bcampx-enhanced";

export const OBSERVED_ATTR = "data-bcampx-observed";

export const HIDDEN_SUPPORTED_ATTR = "data-bcampx-supported-hidden";

export const MERGED_PARENT_ATTR = "data-bcampx-merged-parent";

export const MERGED_CHILD_ATTR = "data-bcampx-merged-child";

export const SKIP_REASON_ATTR = "data-bcampx-skip-reason";

export const RETRYABLE_SKIP_ATTR = "data-bcampx-retryable-skip";

export const FAN_ACTIVITY_TEXT_PATTERN =
    /\b(bought|purchased|wishlisted|supported|recommended|following|followed|listening|played|posted|released|added)\b/i;

export const EXCLUDED_SECTION_SELECTOR = [
    "#sidebar",
    "aside",
    '[role="complementary"]',
    ".sidebar",
    ".side-bar",
    ".side_module",
    ".right-column",
    ".right_col",
    ".rightCol",
    ".discover",
    ".recommended",
    ".new-releases",
    ".new_releases",
].join(",");

export const COLLECT_CONTROLS_SELECTOR = ".tralbum-wrapper-collect-controls";

export const BUY_ACTION_TEXT_RE =
    /^(?:buy now|pre.?order|hear more|free download)(?:\s*\([^)]*\))?$/i;

export const COLLECT_ACTION_TEXT_RE =
    /^(?:buy now|wishlist|hear more|buy track|pre.?order|stream|free download)(?:\s*\([^)]*\))?$/i;

export const SVG_NS = "http://www.w3.org/2000/svg";
