
(function () {
    "use strict";

    const PLAYER_SHELL_CSS = "";
    const ENHANCEMENT_CSS = "";
    const SCRIPT_VERSION = "";

    const CONFIG = {
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
        // flight, at least 450 ms apart, and a modest per-visit budget.
        tagIndexFetchConcurrency: 2,
        tagIndexFetchesPerRun: 400,
        tagIndexBatchPauseMs: 30000,
        tagIndexBackgroundStartDelayMs: 15000,
        tagIndexMaxBatchesPerPage: 8,
        tagIndexMinGapMs: 1000,
        tagIndexFastestGapMs: 600,
        tagIndexSlowestGapMs: 2000,
        tagIndexCooldownBaseMs: 2 * 60 * 1000,
        tagIndexCooldownMaxMs: 15 * 60 * 1000,
        tagIndexCheckpointMs: 5000,
        // The tag cache is a large blob; write it at most this often unless the
        // run ends or the page goes away.
        tagCacheCheckpointMs: 30000,
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
        maxReleaseTagCacheEntries: 10000,
        maxTagSearchMatches: 400,
        tagSearchInitialResults: 80,
    };

    const CACHE_SCHEMA_VERSION = 18;
    const RELEASE_CACHE_PREFIX = "bcampx:release:";
    const RELEASE_SUPPORTER_COUNT_CACHE_PREFIX = "bcampx:releaseSupporters:";
    const RELEASE_CACHE_INDEX_KEY = "bcampx:releaseCacheIndex";
    const USER_SETTINGS_KEY = "bcampx:userSettings";
    const ARTIST_MUSIC_VIEW_KEY = "bcampx:artistMusicView";
    const PLAYBACK_PAUSE_REQUEST_KEY = "bcampx:playbackPauseRequest";
    const OWNED_RELEASE_COLLECTION_SEARCH_KEY =
        "bcampx:ownedReleaseCollectionSearch";
    const RELEASE_TAGS_KEY = "bcampx:releaseTags";
    const TAG_INDEX_PREFIX = "bcampx:tagIndex:";
    const TAG_INDEX_STATUS_PREFIX = "bcampx:tagIndexStatus:";
    const TAG_INDEX_COOLDOWN_KEY = "bcampx:tagIndexCooldown";
    const TAG_INDEX_PACING_KEY = "bcampx:tagIndexPacing";
    const TAG_INDEX_OWNER_KEY = "bcampx:tagIndexOwner";
    const PLAYBACK_PAUSE_POLL_MS = 1000;
    const PLAYBACK_PAUSE_STALE_MS = 10000;
    const PLAYER_WISHLIST_STATE_RETRY_MS = 30000;
    const TRACK_ACTION_AUTH_TIMEOUT_MS = 1200;
    const OWNED_RELEASE_COLLECTION_SEARCH_TTL_MS = 2 * 60 * 1000;
    const LOADING_EXTRA_CONTEXT_TEXT = "Loading extra context...";
    const STATE = {
        initialized: false,
        artistMusicFeedBuilt: false,
        artistMusicFeedBuilding: false,
        artistMusicFeedView: "feed",
        artistMusicFeedNode: null,

        artistMusicSourceGridNode: null,
        artistMusicToggleNode: null,
        artistMusicFeaturedNodes: [],
        artistMusicFeedSyncTimer: 0,
        artistMusicVisibleFetchTimer: 0,
        artistMusicSourceGridObserver: null,
        artistMusicFanTabObserver: null,
        artistMusicFanTabSyncTimer: 0,
        artistMusicFanCardsByGrid: new WeakMap(),
        artistMusicFanDirtyGrids: new WeakSet(),
        artistMusicLoadMoreScrollPending: false,
        tagSearchListenersBound: false,
        tagSearchDebounceTimer: 0,
        tagSearchPendingQuery: null,
        tagSearchQueryByKind: { collection: "", wishlist: "" },
        tagSearchMatchesByKind: { collection: [], wishlist: [] },
        tagSearchSignatureByKind: { collection: "", wishlist: "" },
        fanTagIndexCache: new Map(),
        tagSearchFanId: 0,
        tagSearchSeqByKind: { collection: 0, wishlist: 0 },
        tagIndexRetryTimer: 0,
        tagSearchRefreshTimers: {},
        tagIndexRunActive: false,
        tagIndexRunScheduled: false,
        tagIndexRunTimer: 0,
        tagIndexFetchesThisRun: 0,
        tagIndexRequestLimiter: null,
        tagIndexDirty: new Map(),
        tagIndexWriteTimer: 0,
        tagIndexSeedIds: {},
        tagIndexNextRequestAt: 0,
        tagIndexRateLimited: false,
        releaseTagCacheLastWriteAt: 0,
        releaseTagCacheLoadedAt: 0,
        releaseTagStoreMode: "",
        fanTagFanId: 0,
        tagSearchProgressNotifyAt: {},
        tagSearchStateCache: null,
        tagSearchVisibleLimitByKind: {},
        tagIndexStatusByKind: {},
        tagIndexBatchesThisPage: 0,
        tagIndexBatchTimer: 0,
        tagIndexBackgroundScheduled: false,
        releaseFetchCooldownUntil: 0,
        releaseFetchResumeTimer: 0,
        renderedReleaseDataByUrl: new Map(),
        releaseTagNormCache: new WeakMap(),
        releaseTagCache: null,
        globalBridgeInitialized: false,
        trackActionBridgeInitialized: false,
        scanTimer: 0,
        pendingScanRoots: new Set(),
        pendingFullScan: false,
        observer: null,
        mutationObserver: null,
        sharedAudio: null,
        pageAudio: null,
        activeTrackButton: null,
        activeTrackCard: null,
        activeTrackFanGridNode: null,
        waypointNode: null,
        activeTrack: null,
        activeTrackIndex: -1,
        activeTrackList: [],
        activeReleaseData: null,
        activeReleaseUrl: "",
        activeCardArtUrl: "",
        activePlaybackScope: "",
        coverPlaybackStateNode: null,
        collectionCoverStateObserver: null,
        collectionCoverStateObserverTimer: 0,
        playerUi: null,
        playerHost: null,
        playerSettingsOpen: false,
        pendingReleaseRequests: new Map(),
        apiReleaseTrackCache: new Map(),
        pageFreshTrackReleaseKeys: new Set(),
        releaseFetchQueue: [],
        activeReleaseFetchCount: 0,
        autoFetchQueue: [],
        autoFetchDrainScheduled: false,
        activeAutoFetchCount: 0,
        autoFetchSequence: 0,
        peakAutoFetchCount: 0,
        pendingSupporterCountRequests: new Map(),
        supporterCountFetchQueue: [],
        activeSupporterCountFetchCount: 0,
        pendingTrackActionRequests: new Map(),
        playerWishlistStateByUrl: new Map(),
        playerWishlistStateRequests: new Map(),
        playerWishlistActionRequests: new Set(),
        playerWishlistStateRetryTimers: new Map(),
        uiSyncFrame: 0,
        pendingUiSyncCardArtUrl: "",
        tabId: `bcampx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        playbackPauseMonitorTimer: 0,
        playbackPauseUnsubscribe: null,
        lastPlaybackStartedAt: 0,
        lastHandledPlaybackPauseRequestAt: 0,
        lastTrackActionDiagnostic: null,
        collectionPointerReleaseUrl: "",
        collectionPointerHandledAt: 0,
        feedPreviewTracks: null,
        feedPreviewTrackMap: null,
        memoVersion: 1,
    };

    const RELEASE_LINK_SELECTOR = [
        'a[href*="/album/"]',
        'a[href*="/track/"]',
    ].join(",");

    const SUPPORTED_SLOT_SELECTOR = [
        ".story-body .tralbum-wrapper .tralbum-wrapper-col2.tralbum-owners",
        ".tralbum-wrapper .tralbum-wrapper-col2.tralbum-owners",
        ".tralbum-wrapper-col2.tralbum-owners",
    ].join(",");

    const CONTENT_COLUMN_SELECTOR = [
        ".story-body .tralbum-wrapper .tralbum-wrapper-col1",
        ".tralbum-wrapper .tralbum-wrapper-col1",
        ".tralbum-wrapper-col1",
    ].join(",");

    const FEED_CARD_ROOT_SELECTOR = [
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

    const INTERNAL_MUTATION_SELECTOR = [
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

    const CARD_SELECTOR = [
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

    const ENHANCED_ATTR = "data-bcampx-enhanced";
    const OBSERVED_ATTR = "data-bcampx-observed";
    const HIDDEN_SUPPORTED_ATTR = "data-bcampx-supported-hidden";
    const MERGED_PARENT_ATTR = "data-bcampx-merged-parent";
    const MERGED_CHILD_ATTR = "data-bcampx-merged-child";
    const SKIP_REASON_ATTR = "data-bcampx-skip-reason";
    const RETRYABLE_SKIP_ATTR = "data-bcampx-retryable-skip";
    const FAN_ACTIVITY_TEXT_PATTERN =
        /\b(bought|purchased|wishlisted|supported|recommended|following|followed|listening|played|posted|released|added)\b/i;
    const EXCLUDED_SECTION_SELECTOR = [
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

    const COLLECT_CONTROLS_SELECTOR = ".tralbum-wrapper-collect-controls";
    const BUY_ACTION_TEXT_RE =
        /^(?:buy now|pre.?order|hear more|free download)(?:\s*\([^)]*\))?$/i;
    const COLLECT_ACTION_TEXT_RE =
        /^(?:buy now|wishlist|hear more|buy track|pre.?order|stream|free download)(?:\s*\([^)]*\))?$/i;

    const SVG_NS = "http://www.w3.org/2000/svg";
    // __BCAMPX_PLAYER_ICONS__

    init();

    function init() {
        markDebugState("data-bcampx-script-loaded", "true");
        markDebugState("data-bcampx-version", SCRIPT_VERSION);
        markDebugState(
            "data-bcampx-page-kind",
            getEnhancerPageKind(),
        );

        if (tryHandleEmbeddedTrackActionHelper()) {
            markDebugState("data-bcampx-init-state", "helper");
            return;
        }

        if (!isLikelyBandcampDocument()) {
            markDebugState("data-bcampx-init-state", "unsupported-page");
            return;
        }

        setupGlobalPlaybackBridge();
        setupOwnedReleaseCollectionHandoff();
        void applyPendingOwnedReleaseCollectionSearch();

        setupReleasePageBuyAutofill();

        if (STATE.initialized || !isFeedEnhancerPage()) {
            if (STATE.initialized) {
                markDebugState("data-bcampx-init-state", "already-initialized");
            }
            return;
        }

        STATE.initialized = true;
        markDebugState("data-bcampx-init-state", "starting");
        void initializeFeedEnhancer()
            .then(() => markDebugState("data-bcampx-init-state", "ready"))
            .catch((error) => {
                markDebugState("data-bcampx-init-state", "error");
                markDebugState(
                    "data-bcampx-init-error",
                    cleanText(error && error.message ? error.message : "Unknown error.").slice(
                        0,
                        160,
                    ),
                );
            });
    }

    async function initializeFeedEnhancer() {
        await loadUserSettings();
        setupSharedAudio();
        setupWaypointNavigation();
        setupNativePlaybackInterception();
        setupPlayerMenuDismissal();
        injectStyles();
        try {
            await buildArtistMusicFeed();
        } catch (error) {
            // A feed build failure is contained here. The player shell, card
            // enhancement, and mutation observer must still initialize for the
            // rest of the page load; buildArtistMusicFeed already records
            // data-bcampx-label-feed-state="error" before rethrowing.
            markDebugState(
                "data-bcampx-label-feed-init-error",
                cleanText(
                    error && error.message ? error.message : "Unknown error.",
                ).slice(0, 160),
            );
        }
        setupFanCollectionTabObserver();
        scheduleFanTagBackgroundFill();
        // Binding the search bridge does not depend on the feed rendering; a
        // search grid without results still accepts a tag query.
        setupFanTagSearch();
        ensurePlayerShell();
        setupIntersectionObserver();
        scanForCards();
        rearmArtistMusicFeedCardObservers(STATE.artistMusicFeedNode);
        scheduleArtistMusicFeedVisibleFetch(STATE.artistMusicFeedNode);
        setupMutationObserver();
    }

    function setupGlobalPlaybackBridge() {
        if (STATE.globalBridgeInitialized) {
            return;
        }

        STATE.globalBridgeInitialized = true;
        document.addEventListener("play", handleDocumentAudioPlay, true);
        document.addEventListener(
            "click",
            handleArtistMusicNativeLoadMoreClick,
            true,
        );
        subscribeToPlaybackPauseRequests();
        // Only fall back to polling when no push subscription exists, and only
        // in the top frame: otherwise every EmbeddedPlayer iframe performs a
        // storage read every second for no benefit.
        if (!STATE.playbackPauseUnsubscribe && window.top === window) {
            STATE.playbackPauseMonitorTimer = window.setInterval(
                checkForPlaybackPauseRequest,
                PLAYBACK_PAUSE_POLL_MS,
            );
        }
    }

    async function loadUserSettings() {
        const stored = await storageGet(USER_SETTINGS_KEY, null);
        applyUserSettings(stored);
    }

    function applyUserSettings(value) {
        const settings =
            value && typeof value === "object" ? value : {};
        CONFIG.enableTrackRowActions = coerceBooleanSetting(
            settings.enableTrackRowActions,
            true,
        );
        CONFIG.continuousMode = coerceBooleanSetting(
            settings.continuousMode,
            false,
        );
        CONFIG.autoFillMinimumPrice = coerceBooleanSetting(
            settings.autoFillMinimumPrice,
            false,
        );
        CONFIG.showCollectionCounts = coerceBooleanSetting(
            settings.showCollectionCounts,
            false,
        );
        CONFIG.enableTagSearch = coerceBooleanSetting(
            settings.enableTagSearch,
            false,
        );
    }

    function coerceBooleanSetting(value, fallback) {
        if (typeof value === "boolean") {
            return value;
        }

        if (value === "true") {
            return true;
        }

        if (value === "false") {
            return false;
        }

        return fallback;
    }

    function getSerializableUserSettings() {
        return {
            enableTrackRowActions: !!CONFIG.enableTrackRowActions,
            continuousMode: !!CONFIG.continuousMode,
            autoFillMinimumPrice: !!CONFIG.autoFillMinimumPrice,
            showCollectionCounts: !!CONFIG.showCollectionCounts,
            enableTagSearch: !!CONFIG.enableTagSearch,
        };
    }

    async function persistUserSettings() {
        await storageSet(USER_SETTINGS_KEY, getSerializableUserSettings());
    }

    function ensureCardController(card, releaseUrl) {
        const existingController = getCardController(card);
        if (existingController) {
            return existingController;
        }

        if (!card || card.hasAttribute(ENHANCED_ATTR)) {
            return getCardController(card);
        }

        enhanceCard(card, releaseUrl, getCardReleaseRequestContext(card, releaseUrl));
        return getCardController(card);
    }

    function getCardController(card) {
        return card && card.__bcampxController ? card.__bcampxController : null;
    }

    function setCardController(card, controller) {
        if (card) {
            card.__bcampxController = controller || null;
        }
    }

    function getCardAlbumReleaseUrl(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardAlbumReleaseUrl")) {
            return memo.cardAlbumReleaseUrl || "";
        }

        const albumLinks = Array.from(
            card.querySelectorAll('a[href*="/album/"]'),
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .filter(Boolean);
        const albumLink = preferBandcampReleaseUrl(albumLinks) || albumLinks[0] || "";

        if (memo) {
            memo.cardAlbumReleaseUrl = albumLink;
        }

        return albumLink;
    }

    function getCardRawReleaseUrl(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardRawReleaseUrl")) {
            return memo.cardRawReleaseUrl || "";
        }

        const releaseLinks = Array.from(card.querySelectorAll(RELEASE_LINK_SELECTOR))
            .map((link) => normalizeReleaseUrl(link.href))
            .filter(Boolean);
        const itemJsonReleaseUrl = getItemJsonReleaseUrl(card);
        const rawReleaseUrl =
            preferBandcampReleaseUrl([
                ...releaseLinks,
                itemJsonReleaseUrl,
            ].filter(Boolean)) ||
            releaseLinks[0] ||
            itemJsonReleaseUrl ||
            "";

        if (memo) {
            memo.cardRawReleaseUrl = rawReleaseUrl;
        }

        return rawReleaseUrl;
    }

    function getCardReleaseRequestContext(card, releaseUrl = "") {
        const normalizedReleaseUrl = normalizeReleaseUrl(
            releaseUrl || getCardPrimaryReleaseUrl(card),
        );
        const parsed = getParsedItemJson(card);
        return {
            releaseUrl: normalizedReleaseUrl,
            itemId: extractParsedItemId(parsed),
            itemType: normalizeReleaseItemType(
                parsed &&
                    (parsed.item_type ||
                        parsed.tralbum_type ||
                        parsed.type ||
                        parsed.collect_item_type),
                normalizedReleaseUrl,
            ),
            requirePageFreshTracks:
                isBandcampFanCollectionPageUrl(window.location.href) &&
                Boolean(
                    card &&
                        card.classList &&
                        card.classList.contains("bcampx-label-feed-card"),
                ),
            allowCachedTrackSnapshot:
                isBandcampFanCollectionPageUrl(window.location.href) &&
                Boolean(
                    card &&
                        card.classList &&
                        card.classList.contains("bcampx-label-feed-card"),
                ),
        };
    }

    function getCardPrimaryReleaseUrl(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardPrimaryReleaseUrl")) {
            return memo.cardPrimaryReleaseUrl || "";
        }

        const albumLink = getCardAlbumReleaseUrl(card);
        if (albumLink) {
            if (memo) {
                memo.cardPrimaryReleaseUrl = albumLink;
            }
            return albumLink;
        }

        const primaryReleaseUrl = getCardRawReleaseUrl(card);

        if (memo) {
            memo.cardPrimaryReleaseUrl = primaryReleaseUrl;
        }

        return primaryReleaseUrl;
    }

    function getStoryRoot(node) {
        if (!(node instanceof Element)) {
            return null;
        }

        const story = node.matches(FEED_CARD_ROOT_SELECTOR)
            ? node
            : node.closest(FEED_CARD_ROOT_SELECTOR);
        return story instanceof Element ? story : null;
    }

    function getStoryTitleNode(card) {
        const story = getStoryRoot(card);
        if (!story) {
            return null;
        }

        const title = story.querySelector(".story-title");
        return title instanceof Element ? title : null;
    }

    function extractFeedHeadlineActor(headlineText) {
        const match = cleanText(headlineText).match(
            /^(.+?)\s+(?:bought|purchased|wishlisted|supported|recommended|listening|played|posted|released)\b/i,
        );
        return match && match[1] ? cleanText(match[1]) : "";
    }

    function getParsedItemJson(node) {
        if (!(node instanceof Element)) {
            return null;
        }

        const holder = node.matches("[data-item-json]")
            ? node
            : node.querySelector("[data-item-json]");
        if (!(holder instanceof Element)) {
            return null;
        }

        const memo = getNodeMemo(holder);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "parsedItemJson")) {
            return memo.parsedItemJson;
        }

        const parsed = parseJsonAttribute(holder, "data-item-json") || null;
        if (memo) {
            memo.parsedItemJson = parsed;
        }

        return parsed;
    }

    function getCollectionGridFeaturedPreview(card) {
        const memo = getNodeMemo(card);
        if (
            memo &&
            Object.prototype.hasOwnProperty.call(
                memo,
                "collectionGridFeaturedPreview",
            )
        ) {
            return memo.collectionGridFeaturedPreview;
        }

        const parsed = getParsedItemJson(card);
        const trackId = cleanText(parsed && parsed.featured_track);
        if (!trackId) {
            return null;
        }

        const preview = getFeedPreviewTrackMap().get(trackId);
        const streamUrl = cleanText(
            preview &&
                preview.streaming_url &&
                preview.streaming_url["mp3-128"],
        );
        if (!preview || !streamUrl) {
            return null;
        }

        const track = createTrackData(
            preview.title || parsed.featured_track_title,
            preview.track_id || trackId,
            streamUrl,
            preview.duration || parsed.featured_track_duration,
            preview.track_url || parsed.featured_track_url || "",
        );
        if (!track) {
            return null;
        }

        const art =
            parsed && parsed.item_art && typeof parsed.item_art === "object"
                ? parsed.item_art
                : {};
        const result = {
            track,
            data: normalizeReleaseData({
                url: getItemJsonReleaseUrl(card),
                title: parsed.album_title || parsed.item_title || "",
                artist: parsed.band_name || preview.band_name || "",
                artUrl:
                    parsed.item_art_url ||
                    art.url ||
                    getCardArtUrl(card),
                tracks: [track],
            }),
        };
        if (memo) {
            memo.collectionGridFeaturedPreview = result;
        }
        return result;
    }

    function getFeedPreviewTracks() {
        if (Array.isArray(STATE.feedPreviewTracks)) {
            return STATE.feedPreviewTracks;
        }

        const blob =
            parseJsonAttribute(
                document.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        STATE.feedPreviewTracks = Array.isArray(blob.track_list)
            ? blob.track_list
            : [];
        return STATE.feedPreviewTracks;
    }

    function getFeedPreviewTrackMap() {
        if (STATE.feedPreviewTrackMap instanceof Map) {
            return STATE.feedPreviewTrackMap;
        }

        STATE.feedPreviewTrackMap = new Map();
        getFeedPreviewTracks().forEach((track) => {
            const trackId = cleanText(track && track.track_id);
            if (trackId) {
                STATE.feedPreviewTrackMap.set(trackId, track);
            }
        });
        return STATE.feedPreviewTrackMap;
    }

    // __BCAMPX_ARTIST_MUSIC_FEED__

    function isMalformedFeedCard(card) {
        const story = getStoryRoot(card);
        if (!story || !hasExplicitFeedStoryStructure(story)) {
            return false;
        }

        const directReleaseUrl = getMatchingRootOrDescendants(
            story,
            RELEASE_LINK_SELECTOR,
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .find(Boolean);
        if (directReleaseUrl) {
            return false;
        }

        return Boolean(getItemJsonReleaseUrl(story));
    }

    function isAlsoBoughtRecommendationCard(card) {
        const headline = findActivityHeadline(card) || getStoryTitleNode(card);
        if (!headline) {
            return false;
        }

        if (!/\balso bought\b/i.test(normalizedText(headline))) {
            return false;
        }

        return hasAlsoBoughtRecommendationMarkers(card);
    }

    function hasAlsoBoughtRecommendationMarkers(card) {
        if (!(card instanceof Element)) {
            return false;
        }

        if (
            card.querySelector(
                "a.follow-fan, .follow-fan, a.view-collection, .view-collection",
            )
        ) {
            return true;
        }

        const actionTexts = Array.from(card.querySelectorAll("a, button"))
            .map((node) => normalizedText(node).toLowerCase())
            .filter(Boolean);
        return (
            actionTexts.some((text) => /\bfollow\b/.test(text)) &&
            actionTexts.some((text) => /\bview collection\b/.test(text))
        );
    }

    function findFeaturedTrackForCard(card, trigger, data) {
        if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
            return null;
        }

        const triggerWithTrackId =
            trigger && trigger.closest
                ? trigger.closest("[data-trackid]")
                : null;
        const triggerTrackId = cleanText(
            triggerWithTrackId &&
                triggerWithTrackId.getAttribute("data-trackid"),
        );
        if (triggerTrackId) {
            const exactTrack = data.tracks.find(
                (track) =>
                    cleanText(track && track.trackId) === triggerTrackId &&
                    track.streamUrl,
            );
            if (exactTrack) {
                return exactTrack;
            }
        }

        const parsed = getParsedItemJson(card);
        const parsedFeaturedTrackId = cleanText(
            parsed && parsed.featured_track,
        );
        if (parsedFeaturedTrackId) {
            const exactTrack = data.tracks.find(
                (track) =>
                    cleanText(track && track.trackId) ===
                        parsedFeaturedTrackId && track.streamUrl,
            );
            if (exactTrack) {
                return exactTrack;
            }
        }

        const parsedFeaturedTitle = cleanText(
            parsed && parsed.featured_track_title,
        );
        if (parsedFeaturedTitle) {
            const normalizedParsedTitle = parsedFeaturedTitle.toLowerCase();
            const titleMatch = data.tracks.find(
                (track) =>
                    cleanText(track && track.title).toLowerCase() ===
                        normalizedParsedTitle && track.streamUrl,
            );
            if (titleMatch) {
                return titleMatch;
            }
        }

        const featuredTitle = extractFeaturedTrackTitle(card);
        if (featuredTitle) {
            const normalizedFeaturedTitle =
                cleanText(featuredTitle).toLowerCase();
            const titleMatch = data.tracks.find(
                (track) =>
                    cleanText(track && track.title).toLowerCase() ===
                        normalizedFeaturedTitle && track.streamUrl,
            );
            if (titleMatch) {
                return titleMatch;
            }

            const fuzzyTitleMatch = data.tracks.find(
                (track) =>
                    cleanText(track && track.title)
                        .toLowerCase()
                        .includes(normalizedFeaturedTitle) && track.streamUrl,
            );
            if (fuzzyTitleMatch) {
                return fuzzyTitleMatch;
            }
        }

        return data.tracks.find((track) => track && track.streamUrl) || null;
    }

    function extractFeaturedTrackTitle(card) {
        const featuredLine = findCachedElementByText(
            card,
            "featuredTrackLine",
            "div, p, li, section, span",
            /^featured track\s*:/i,
        );
        if (!featuredLine) {
            return "";
        }

        const inlineLink = featuredLine.querySelector('a[href*="/track/"]');
        if (inlineLink) {
            return normalizedText(inlineLink);
        }

        const inlineText = cleanText(
            (featuredLine.textContent || "").replace(
                /^featured track\s*:/i,
                "",
            ),
        );
        if (inlineText) {
            return inlineText;
        }

        let sibling = featuredLine.nextElementSibling;
        while (sibling) {
            const text = normalizedText(sibling);
            if (text && !/^by\s+/i.test(text)) {
                return text;
            }
            sibling = sibling.nextElementSibling;
        }

        const containerText = normalizedText(featuredLine.parentElement);
        const match = containerText.match(/featured track:\s*(.+)$/i);
        return match && match[1] ? cleanText(match[1]) : "";
    }

    function isFeedPage() {
        return (
            /(^|\/)feed\/?$/.test(window.location.pathname) ||
            /\/feed\//.test(window.location.pathname)
        );
    }

    function isFeedEnhancerPage() {
        return (
            isFeedPage() ||
            isArtistMusicPage() ||
            isBandcampFanCollectionPageUrl(window.location.href)
        );
    }

    function getEnhancerPageKind() {
        if (isFeedPage()) {
            return "feed";
        }

        if (isArtistMusicPage()) {
            return "artist-music";
        }

        if (isFanCollectionPage()) {
            return isFanWishlistPage() ? "fan-wishlist" : "fan-collection";
        }

        if (isBandcampFanCollectionPageUrl(window.location.href)) {
            return "fan-other";
        }

        return "other";
    }

    function setupReleasePageBuyAutofill() {
        void loadUserSettings();

        document.addEventListener("click", (event) => {
            if (!CONFIG.autoFillMinimumPrice) {
                return;
            }

            const formatItem =
                event.target && typeof event.target.closest === "function"
                    ? event.target.closest(".buyItem")
                    : null;
            if (!formatItem) {
                return;
            }

            const price = extractFormatPrice(formatItem);
            if (!price) {
                return;
            }

            const waitForDialog = (tries = 0) => {
                if (tries > 40) {
                    return;
                }

                const priceInput = document.querySelector(".ui-dialog #userPrice");
                if (priceInput) {
                    priceInput.value = price;
                    priceInput.dispatchEvent(new Event("input", { bubbles: true }));
                    priceInput.dispatchEvent(new Event("change", { bubbles: true }));
                    return;
                }

                // The dialog may not exist yet on a slow first paint, so keep
                // polling until the attempt budget runs out rather than giving
                // up after a single probe.
                setTimeout(() => waitForDialog(tries + 1), 150);
            };

            setTimeout(() => waitForDialog(), 300);
        });
    }

    function extractFormatPrice(buyItem) {
        if (!buyItem) {
            return "";
        }

        const text = cleanText(buyItem.textContent || "");
        if (/name your price|free download|you own this/i.test(text)) {
            return "";
        }

        const basePrice = cleanText(
            buyItem.querySelector(".base-text-color")?.textContent || "",
        );
        if (!basePrice) {
            return "";
        }

        const match = basePrice.match(/(\d+(?:\.\d+)?)/);
        return match ? match[1] : "";
    }

    function setupOwnedReleaseCollectionHandoff() {
        if (!isReleasePage()) {
            return;
        }

        document.addEventListener(
            "click",
            handleOwnedReleaseCollectionClick,
            true,
        );
    }

    function isReleasePage() {
        return (
            /\/(?:album|track)\//.test(window.location.pathname || "") ||
            Boolean(document.querySelector("[data-tralbum]"))
        );
    }

    function handleOwnedReleaseCollectionClick(event) {
        const link = findOwnedReleaseCollectionLink(event.target);
        if (!link) {
            return;
        }

        const title = resolveCurrentReleaseTitleForCollectionSearch();
        if (!title) {
            return;
        }

        if (!isPlainPrimaryClick(event)) {
            void queueOwnedReleaseCollectionSearch(
                title,
                link.href,
                normalizeReleaseUrl(window.location.href),
            );
            return;
        }

        event.preventDefault();
        void navigateToOwnedReleaseCollection(
            title,
            link.href,
            normalizeReleaseUrl(window.location.href),
        );
    }

    function queueOwnedReleaseCollectionSearch(title, targetUrl, releaseUrl) {
        const cleanTitleValue = cleanText(title || "");
        const cleanTargetUrl = cleanText(targetUrl || "");
        if (!cleanTitleValue || !isBandcampFanProfileUrl(cleanTargetUrl)) {
            return Promise.resolve();
        }

        markDebugState("data-bcampx-owned-search-captured", cleanTitleValue);
        return storageSet(OWNED_RELEASE_COLLECTION_SEARCH_KEY, {
            title: cleanTitleValue,
            releaseUrl: normalizeReleaseUrl(releaseUrl || window.location.href),
            targetUrl: cleanTargetUrl,
            ts: Date.now(),
        });
    }

    function navigateToOwnedReleaseCollection(title, targetUrl, releaseUrl) {
        const cleanTargetUrl = cleanText(targetUrl || "");
        return queueOwnedReleaseCollectionSearch(
            title,
            cleanTargetUrl,
            releaseUrl,
        ).finally(() => {
            if (cleanTargetUrl) {
                window.location.assign(cleanTargetUrl);
            }
        });
    }

    function findOwnedReleaseCollectionLink(target) {
        if (!(target instanceof Element)) {
            return null;
        }

        const link = target.closest("a[href]");
        if (!link || !isBandcampFanProfileUrl(link.href)) {
            return null;
        }

        if (link.classList.contains("you-own-this-link")) {
            return link;
        }

        const ownedBlock = target.closest(".you-own-this.digital, .you-own-this");
        if (ownedBlock && ownedBlock.contains(link)) {
            return link;
        }

        if (/\byou own this\b/i.test(normalizedText(link))) {
            return link;
        }

        return null;
    }

    function isPlainPrimaryClick(event) {
        return Boolean(
            event &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey,
        );
    }

    function resolveCurrentReleaseTitleForCollectionSearch() {
        const tralbum = parseTralbumData(document);
        return (
            resolveReleaseTitle(document, tralbum, null) ||
            cleanTitle(document.title)
        );
    }

    function isBandcampFanProfileUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.hostname !== "bandcamp.com") {
                return false;
            }

            const pathname = url.pathname.replace(/\/+$/, "");
            if (!pathname || pathname === "/") {
                return false;
            }

            if (
                /\/(album|track|tagged|discover|feed|fans|terms_of_use|about|help|search|gift_cards)(\/|$)/i.test(
                    pathname,
                )
            ) {
                return false;
            }

            return pathname.split("/").filter(Boolean).length === 1;
        } catch (_error) {
            return false;
        }
    }

    async function applyPendingOwnedReleaseCollectionSearch() {
        if (!isBandcampCollectionSearchPageCandidate()) {
            return;
        }

        const payload = await storageGet(
            OWNED_RELEASE_COLLECTION_SEARCH_KEY,
            null,
        );
        if (!isFreshOwnedReleaseCollectionSearchPayload(payload)) {
            if (payload) {
                await clearOwnedReleaseCollectionSearchPayload();
            }
            return;
        }

        markDebugState("data-bcampx-owned-search-pending", payload.title);
        const didFill = await fillCollectionSearchBoxWhenReady(payload.title);
        if (didFill) {
            markDebugState("data-bcampx-owned-search-filled", payload.title);
        } else {
            markDebugState("data-bcampx-owned-search-filled", "false");
        }
        await clearOwnedReleaseCollectionSearchPayload();
    }

    function isBandcampCollectionSearchPageCandidate() {
        return isBandcampFanProfileUrl(window.location.href);
    }

    function isFanCollectionPage() {
        if (!isBandcampFanCollectionPageUrl(window.location.href)) {
            return false;
        }

        return Boolean(findFanCollectionActiveGrid());
    }

    function isFanWishlistPage() {
        return /\/wishlist\/?$/i.test(window.location.pathname || "");
    }

    function isBandcampFanCollectionPageUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.hostname !== "bandcamp.com") {
                return false;
            }

            const segments = url.pathname.split("/").filter(Boolean);
            if (segments.length === 1) {
                return isBandcampFanProfileUrl(url.href);
            }

            const fanRoot = `${url.origin}/${encodeURIComponent(segments[0])}`;
            if (!isBandcampFanProfileUrl(fanRoot)) {
                return false;
            }

            const section = segments[1].toLowerCase();
            return (
                (section === "wishlist" ||
                    section === "followers" ||
                    section === "following") &&
                segments.length === 2
            );
        } catch (_error) {
            return false;
        }
    }

    let currentFanCollectionPageHref = "";
    let currentFanCollectionPageMemo = false;

    // isBandcampFanCollectionPageUrl allocates a URL plus path segment arrays
    // per call, and it is consulted once per mutation record. The answer only
    // changes on navigation, so memoize it against the current href.
    function isCurrentFanCollectionPage() {
        const href = window.location.href || "";
        if (href !== currentFanCollectionPageHref) {
            currentFanCollectionPageHref = href;
            currentFanCollectionPageMemo =
                isBandcampFanCollectionPageUrl(href);
        }

        return currentFanCollectionPageMemo;
    }

    function findFanCollectionActiveGrid() {
        const activeGridContainer = document.querySelector(
            "#grids > .grid.active",
        );
        if (activeGridContainer) {
            const activeGrid =
                activeGridContainer.querySelector(
                    [
                        "#collection-search-items > .collection-grid",
                        "#wishlist-search-items > .collection-grid",
                        ".collection-grid",
                    ].join(", "),
                );
            if (activeGrid) {
                return activeGrid;
            }
            return null;
        }

        const activeTab = document.querySelector(
            "li.active[data-grid-id][data-tab]",
        );
        const activeGridId = cleanText(
            activeTab && activeTab.getAttribute("data-grid-id"),
        );
        if (activeGridId) {
            const activeGrid = document.querySelector(
                `#${CSS.escape(activeGridId)} .collection-grid`,
            );
            if (activeGrid) {
                return activeGrid;
            }
        }

        const preferredGridId = isFanWishlistPage()
            ? "wishlist-grid"
            : "collection-grid";
        const preferredGrid = document.querySelector(
            `#${preferredGridId} .collection-grid`,
        );
        if (preferredGrid) {
            return preferredGrid;
        }

        return document.querySelector(".grid.active .collection-grid");
    }

    function isFreshOwnedReleaseCollectionSearchPayload(payload) {
        return Boolean(
            payload &&
                typeof payload === "object" &&
                cleanText(payload.title) &&
                payload.ts &&
                Date.now() - Number(payload.ts) <=
                    OWNED_RELEASE_COLLECTION_SEARCH_TTL_MS,
        );
    }

    function clearOwnedReleaseCollectionSearchPayload() {
        return storageSet(OWNED_RELEASE_COLLECTION_SEARCH_KEY, null);
    }

    function fillCollectionSearchBoxWhenReady(title) {
        const cleanTitleValue = cleanText(title);
        if (!cleanTitleValue) {
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            let done = false;
            let observer = null;
            let timeoutId = 0;

            const finish = (value) => {
                if (done) {
                    return;
                }
                done = true;
                if (observer) {
                    observer.disconnect();
                }
                window.clearTimeout(timeoutId);
                resolve(value);
            };

            const tryFill = () => {
                const input = findCollectionSearchBox();
                if (!input) {
                    return false;
                }

                setTextInputValue(input, cleanTitleValue);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                try {
                    input.dispatchEvent(
                        new KeyboardEvent("keyup", {
                            bubbles: true,
                            key: cleanTitleValue.slice(-1) || " ",
                        }),
                    );
                } catch (_error) {}
                try {
                    input.focus();
                    if (typeof input.select === "function") {
                        input.select();
                    }
                } catch (_error) {}
                return true;
            };

            if (tryFill()) {
                finish(true);
                return;
            }

            observer = new MutationObserver(() => {
                if (tryFill()) {
                    finish(true);
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
            });
            timeoutId = window.setTimeout(() => finish(false), 15000);
        });
    }

    function findCollectionSearchBox() {
        return document.querySelector(
            [
                'input.search-box[placeholder*="search your collection" i]',
                'input[placeholder*="search your collection" i]',
                "#collection-search input",
                "#wishlist-search input",
                ".collection-search input",
                ".wishlist-search input",
            ].join(", "),
        );
    }

    function setTextInputValue(input, value) {
        const proto = Object.getPrototypeOf(input);
        const descriptor =
            proto && Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor && typeof descriptor.set === "function") {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }
    }

    function isArtistMusicPage() {
        const path = window.location.pathname || "/";
        if (/\/(album|track|merch|community|fans|feed|artists|video|live)(\/|$)/.test(path)) {
            return false;
        }

        if (
            !(
                path === "/" ||
                /(^|\/)(music|audio)\/?$/.test(path)
            )
        ) {
            return false;
        }

        if (path === "/" && !isRootArtistMusicPath()) {
            return false;
        }

        if (!hasArtistMusicBandEvidence()) {
            return false;
        }

        return hasArtistMusicReleaseGrid();
    }

    function isRootArtistMusicPath() {
        const tralbumPath = getTralbumPathname();
        if (!tralbumPath) {
            return true;
        }

        return tralbumPath === "/" || tralbumPath === "/music";
    }

    function getTralbumPathname() {
        const tralbumData =
            parseJsonAttribute(
                document.querySelector("[data-tralbum]"),
                "data-tralbum",
            ) || {};
        const tralbumUrl = cleanText(tralbumData.url || "");
        if (!tralbumUrl) {
            return "";
        }

        try {
            const path = new URL(tralbumUrl, window.location.href).pathname;
            return path.replace(/\/$/, "") || "/";
        } catch (_error) {
            return "";
        }
    }

    function hasArtistMusicBandEvidence() {
        const bandData =
            parseJsonAttribute(
                document.querySelector("[data-band]"),
                "data-band",
            ) || {};
        const bandUrl = cleanText(
            bandData.https_url || bandData.url || bandData.local_url || "",
        );

        if (
            bandData &&
            typeof bandData === "object" &&
            (bandData.has_public_tralbums ||
                bandData.has_tralbums ||
                bandData.is_label ||
                bandUrl)
        ) {
            return true;
        }

        return getTralbumPathname() === "/music";
    }

    function hasArtistMusicReleaseGrid() {
        const grid = findArtistMusicSourceGrid();
        if (!grid) {
            return false;
        }

        return Boolean(
            grid.querySelector(
                [
                    ".music-grid-item",
                    "[data-item-id^='album-']",
                    "[data-item-id^='track-']",
                    'a[href*="/album/"]',
                    'a[href*="/track/"]',
                ].join(", "),
            ),
        );
    }

    function isLikelyBandcampDocument() {
        const hostname = String(window.location.hostname || "").toLowerCase();
        if (hostname === "bandcamp.com" || hostname.endsWith(".bandcamp.com")) {
            return true;
        }

        return Boolean(
            document.querySelector(
                [
                    "[data-tralbum]",
                    "[data-band]",
                    "#pagedata",
                    "#js-crumbs-data",
                    "meta[property='og:site_name'][content*='Bandcamp']",
                    "meta[property='og:url'][content*='.bandcamp.com/']",
                ].join(", "),
            ),
        );
    }

    function setupIntersectionObserver() {
        if (!("IntersectionObserver" in window) || !CONFIG.autoFetchOnVisible) {
            return;
        }

        STATE.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) {
                        return;
                    }

                    const card = entry.target;
                    STATE.observer.unobserve(card);
                    const controller = getCardController(card);
                    if (
                        controller &&
                        !controller.loaded &&
                        !controller.loading &&
                        !controller.autoFetchQueued
                    ) {
                        queueAutoFetch(controller, entry.boundingClientRect);
                    }
                });
            },
            { rootMargin: CONFIG.observerRootMargin },
        );
    }

    function queueAutoFetch(controller, observedRect = null) {
        if (
            !controller ||
            controller.loaded ||
            controller.loading ||
            controller.autoFetchQueued ||
            isOwnFanTrackCard(controller.card)
        ) {
            return;
        }

        // Measure before writing the loading state so the read never forces a
        // layout flush for the write that follows it.
        const distance = getAutoFetchQueueDistance(
            controller.card,
            observedRect,
        );

        controller.autoFetchQueued = true;
        applyReleaseShellLoadingState(controller);
        STATE.autoFetchQueue.push({
            controller,
            sequence: ++STATE.autoFetchSequence,
            distance,
        });
        updateAutoFetchDebugState();
        scheduleAutoFetchQueueDrain();
    }

    function scheduleAutoFetchQueueDrain() {
        if (STATE.autoFetchDrainScheduled) {
            return;
        }

        STATE.autoFetchDrainScheduled = true;
        const run = () => {
            STATE.autoFetchDrainScheduled = false;
            drainAutoFetchQueue();
        };
        if (typeof window.queueMicrotask === "function") {
            window.queueMicrotask(run);
        } else {
            Promise.resolve().then(run);
        }
    }

    function drainAutoFetchQueue() {
        const pauseUntil = Number(STATE.releaseFetchCooldownUntil) || 0;
        if (pauseUntil > Date.now()) {
            if (!STATE.releaseFetchResumeTimer) {
                STATE.releaseFetchResumeTimer = window.setTimeout(() => {
                    STATE.releaseFetchResumeTimer = 0;
                    drainAutoFetchQueue();
                }, Math.min(60000, pauseUntil - Date.now()));
            }
            return;
        }

        while (
            STATE.activeAutoFetchCount < CONFIG.maxConcurrentAutoFetches &&
            STATE.autoFetchQueue.length
        ) {
            const next = takeNearestAutoFetch();
            const controller = next && next.controller;
            if (!controller) {
                continue;
            }

            controller.autoFetchQueued = false;
            updateAutoFetchDebugState();
            if (
                controller.loaded ||
                controller.loading ||
                !(controller.card instanceof Element) ||
                !controller.card.isConnected
            ) {
                continue;
            }

            STATE.activeAutoFetchCount += 1;
            STATE.peakAutoFetchCount = Math.max(
                STATE.peakAutoFetchCount,
                STATE.activeAutoFetchCount,
            );
            updateAutoFetchDebugState();
            Promise.resolve(controller.fetchAndRender({ auto: true }))
                .catch(() => {})
                .finally(() => {
                    STATE.activeAutoFetchCount = Math.max(
                        0,
                        STATE.activeAutoFetchCount - 1,
                    );
                    updateAutoFetchDebugState();
                    drainAutoFetchQueue();
                });
        }
    }

    function takeNearestAutoFetch() {
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        let nearestSequence = Infinity;

        STATE.autoFetchQueue.forEach((entry, index) => {
            const distance =
                entry && Number.isFinite(entry.distance)
                    ? entry.distance
                    : Infinity;
            const sequence = Number(entry && entry.sequence) || 0;
            if (
                distance < nearestDistance ||
                (distance === nearestDistance && sequence < nearestSequence)
            ) {
                nearestIndex = index;
                nearestDistance = distance;
                nearestSequence = sequence;
            }
        });

        return STATE.autoFetchQueue.splice(nearestIndex, 1)[0] || null;
    }

    // The viewport distance is captured once, when a card is queued, and reused
    // for every dequeue. Measuring it inside takeNearestAutoFetch instead meant
    // one forced layout read per queued card per drain step, i.e. O(queue^2)
    // reads per drain on a feed with many cards in view.
    function getAutoFetchQueueDistance(card, observedRect = null) {
        if (!(card instanceof Element) || !card.isConnected) {
            return Infinity;
        }

        const rect =
            observedRect && typeof observedRect.top === "number"
                ? observedRect
                : card.getBoundingClientRect();
        const viewportHeight =
            window.innerHeight || document.documentElement.clientHeight || 0;
        return Math.abs(rect.top + rect.height / 2 - viewportHeight / 2);
    }

    function updateAutoFetchDebugState() {
        markDebugState(
            "data-bcampx-auto-fetch-active-count",
            String(STATE.activeAutoFetchCount),
        );
        markDebugState(
            "data-bcampx-auto-fetch-queue-count",
            String(STATE.autoFetchQueue.length),
        );
        markDebugState(
            "data-bcampx-auto-fetch-peak-count",
            String(STATE.peakAutoFetchCount),
        );
        markDebugState(
            "data-bcampx-auto-fetch-limit",
            String(CONFIG.maxConcurrentAutoFetches),
        );
    }

    const MUTATION_OBSERVER_OPTIONS = {
        attributes: true,
        attributeFilter: [
            "data-item-json",
            "data-playerdata",
            "data-itemid",
            "data-tralbumid",
            "data-tralbumtype",
            "data-title",
            "href",
        ],
        childList: true,
        subtree: true,
    };

    function suspendMutationObserver() {
        if (STATE.mutationObserver) {
            STATE.mutationObserver.disconnect();
        }
    }

    function resumeMutationObserver() {
        if (STATE.mutationObserver && document.body) {
            STATE.mutationObserver.observe(
                document.body,
                MUTATION_OBSERVER_OPTIONS,
            );
        }
    }

    function setupMutationObserver() {
        if (!("MutationObserver" in window) || !document.body) {
            return;
        }

        STATE.mutationObserver = new MutationObserver((mutations) => {
            let shouldFullScan = false;
            let shouldInvalidateMemo = false;
            let shouldSyncReleaseGridFeed = false;

            mutations.forEach((mutation) => {
                markFanCollectionGridDirtyFromMutation(mutation);
                if (mutation.type === "attributes") {
                    const target = mutation.target;
                    if (!(target instanceof Element)) {
                        return;
                    }

                    shouldInvalidateMemo = true;
                    if (hasArtistMusicSourceGridMutationNode(target)) {
                        shouldSyncReleaseGridFeed = true;
                    }
                    if (hasPotentialReleaseSignal(target)) {
                        const story = getStoryRoot(target);
                        if (story) {
                            scheduleScan(story);
                            return;
                        }
                    }

                    shouldFullScan = true;
                    return;
                }

                Array.from(mutation.addedNodes || []).forEach((node) => {
                    if (!(node instanceof Element)) {
                        return;
                    }

                    // Check ownership before the grid-dirty test: a foreign
                    // control injected into the grid (Batchcamp's checkboxes)
                    // must not schedule a feed re-sync on every injection.
                    if (isBcampxInternalMutationNode(node)) {
                        return;
                    }

                    if (hasArtistMusicSourceGridMutationNode(node)) {
                        shouldSyncReleaseGridFeed = true;
                    }

                    shouldInvalidateMemo = true;
                    if (node.matches(FEED_CARD_ROOT_SELECTOR)) {
                        scheduleScan(node);
                        return;
                    }

                    const nestedStories = node.querySelectorAll
                        ? node.querySelectorAll(FEED_CARD_ROOT_SELECTOR)
                        : [];
                    if (nestedStories.length) {
                        nestedStories.forEach((story) => scheduleScan(story));
                        return;
                    }

                    if (hasPotentialReleaseSignal(node)) {
                        const story = getStoryRoot(node);
                        if (story) {
                            scheduleScan(story);
                            return;
                        }
                    }

                    shouldFullScan = true;
                });
            });

            if (shouldInvalidateMemo) {
                invalidateNodeMemoCache();
            }

            if (shouldSyncReleaseGridFeed) {
                scheduleArtistMusicFeedSync();
            }

            if (
                isCurrentFanCollectionPage() &&
                mutations.some(hasFanCollectionContextMutation)
            ) {
                setupFanCollectionTabObserver();
                scheduleFanCollectionFeedContextSync();
            }

            if (shouldFullScan) {
                scheduleScan();
            }
        });

        STATE.mutationObserver.observe(
            document.body,
            MUTATION_OBSERVER_OPTIONS,
        );
    }

    function hasArtistMusicSourceGridMutationNode(node) {
        if (!(node instanceof Element) || !STATE.artistMusicFeedBuilt) {
            return false;
        }

        const sourceGrid = STATE.artistMusicSourceGridNode;
        if (
            sourceGrid &&
            (sourceGrid === node ||
                sourceGrid.contains(node) ||
                (node.contains && node.contains(sourceGrid)))
        ) {
            return true;
        }

        return false;
    }

    function scheduleScan(root = null) {
        if (root instanceof Element) {
            const roots = getScanRootsForElement(root);
            if (roots.length) {
                roots.forEach((scanRoot) => {
                    STATE.pendingScanRoots.add(scanRoot);
                });
            } else {
                STATE.pendingFullScan = true;
            }
        } else {
            STATE.pendingFullScan = true;
        }

        window.clearTimeout(STATE.scanTimer);
        STATE.scanTimer = window.setTimeout(
            scanForCards,
            CONFIG.scanDebounceMs,
        );
    }

    function getScanRootsForElement(root) {
        if (!(root instanceof Element)) {
            return [];
        }

        const story = getStoryRoot(root);
        if (story instanceof Element) {
            return [story];
        }

        if (!root.querySelectorAll) {
            return [];
        }

        return Array.from(root.querySelectorAll(FEED_CARD_ROOT_SELECTOR));
    }

    function isBcampxInternalMutationNode(node) {
        if (!(node instanceof Element)) {
            return false;
        }

        if (
            node.matches(".bcampx-label-feed") ||
            node.closest(".bcampx-label-feed")
        ) {
            return true;
        }

        if (
            node.matches(FEED_CARD_ROOT_SELECTOR) ||
            node.querySelector(FEED_CARD_ROOT_SELECTOR)
        ) {
            return false;
        }

        return Boolean(
            node.matches(INTERNAL_MUTATION_SELECTOR) ||
                node.closest(INTERNAL_MUTATION_SELECTOR),
        );
    }

    function scanForCards() {
        incrementDebugCounter("data-bcampx-scan-count");
        const cards = getStoryCardsFromRoots(getScanRoots());
        const scannableCards = [];

        cards.forEach((card) => {
            const classification = classifyStoryCard(card);
            if (classification === "enhance") {
                scannableCards.push(card);
            }
        });

        enhanceScannableCards(scannableCards);
        mergeAdjacentTrackPurchaseCards(cards);
    }

    function classifyStoryCard(card) {
        if (!(card instanceof Element)) {
            return "ignore";
        }

        // Already enhanced cards do not need the eligibility heuristics again;
        // a full scan otherwise re-runs them for every card in the feed.
        if (card.getAttribute(ENHANCED_ATTR) === "true") {
            return "skip";
        }

        maybeResetRetryableSkippedCard(card);

        if (isAlsoBoughtRecommendationCard(card)) {
            markStoryCardSkipped(card, {
                cleanup: true,
                reason: "also-bought",
            });
            return "skip";
        }

        if (card.closest(EXCLUDED_SECTION_SELECTOR) || !looksLikeFeedCard(card)) {
            return "ignore";
        }

        if (isMalformedFeedCard(card)) {
            markStoryCardSkipped(card, {
                reason: "malformed",
                retryable: true,
            });
            return "skip";
        }

        if (isFullDiscographyCard(card)) {
            markStoryCardSkipped(card, {
                reason: "full-discography",
            });
            return "skip";
        }

        return "enhance";
    }

    function markStoryCardSkipped(card, options = {}) {
        if (!(card instanceof Element)) {
            return;
        }

        if (options.cleanup) {
            cleanupEnhancedCard(card);
        }

        card.setAttribute(ENHANCED_ATTR, "skipped");
        if (options.reason) {
            card.setAttribute(SKIP_REASON_ATTR, cleanText(options.reason));
        } else {
            card.removeAttribute(SKIP_REASON_ATTR);
        }
        if (options.retryable) {
            card.setAttribute(RETRYABLE_SKIP_ATTR, "true");
        } else {
            card.removeAttribute(RETRYABLE_SKIP_ATTR);
        }
    }

    function maybeResetRetryableSkippedCard(card) {
        if (!isRetryableSkippedCard(card)) {
            return false;
        }

        if (cleanText(card.getAttribute(SKIP_REASON_ATTR)) !== "malformed") {
            return false;
        }

        if (
            isMalformedFeedCard(card) ||
            isFullDiscographyCard(card) ||
            isAlsoBoughtRecommendationCard(card)
        ) {
            return false;
        }

        clearStoryCardSkipState(card);
        clearNodeMemoDeep(card);
        markDebugState("data-bcampx-last-retry", "malformed-card-recovered");
        return true;
    }

    function isRetryableSkippedCard(card) {
        return Boolean(
            card instanceof Element &&
                card.getAttribute(ENHANCED_ATTR) === "skipped" &&
                card.getAttribute(RETRYABLE_SKIP_ATTR) === "true",
        );
    }

    function clearStoryCardSkipState(card) {
        if (!(card instanceof Element)) {
            return;
        }

        if (card.getAttribute(ENHANCED_ATTR) === "skipped") {
            card.removeAttribute(ENHANCED_ATTR);
        }
        card.removeAttribute(SKIP_REASON_ATTR);
        card.removeAttribute(RETRYABLE_SKIP_ATTR);
    }

    function cleanupEnhancedCard(card) {
        if (!(card instanceof Element)) {
            return;
        }

        card.querySelectorAll(".bcampx").forEach((node) => {
            node.remove();
        });

        card
            .querySelectorAll(`[${HIDDEN_SUPPORTED_ATTR}="true"]`)
            .forEach((node) => {
                node.hidden = false;
                node.removeAttribute(HIDDEN_SUPPORTED_ATTR);
            });

        card.classList.remove("bcampx--supported-card");
        restoreCardBuyLink(card);
        setCardController(card, null);
    }

    function restoreCardBuyLink(card) {
        if (!(card instanceof Element)) {
            return;
        }

        card.querySelectorAll("a").forEach((link) => {
            if (typeof link.__bcampxBuyClickHandler === "function") {
                link.removeEventListener("click", link.__bcampxBuyClickHandler);
                delete link.__bcampxBuyClickHandler;
            }

            if (typeof link.__bcampxBuyOriginalText === "string") {
                link.textContent = link.__bcampxBuyOriginalText;
                delete link.__bcampxBuyOriginalText;
            }
        });
    }

    function clearNodeMemo(node) {
        if (node && node.__bcampxMemo) {
            delete node.__bcampxMemo;
        }
    }

    function clearNodeMemoDeep(root) {
        if (!(root instanceof Element)) {
            return;
        }

        clearNodeMemo(root);
        if (typeof root.querySelectorAll !== "function") {
            return;
        }

        root.querySelectorAll("*").forEach((node) => {
            clearNodeMemo(node);
        });
    }

    function invalidateNodeMemoCache() {
        STATE.memoVersion += 1;
    }

    function hasPotentialReleaseSignal(node) {
        if (!(node instanceof Element)) {
            return false;
        }

        if (node.matches('[data-item-json], a[href*="/album/"], a[href*="/track/"]')) {
            return true;
        }

        return Boolean(
            node.querySelector &&
                node.querySelector(
                    '[data-item-json], a[href*="/album/"], a[href*="/track/"]',
                ),
        );
    }

    function getScanRoots() {
        const roots = [];

        if (STATE.pendingFullScan || !STATE.pendingScanRoots.size) {
            roots.push(document);
        } else {
            STATE.pendingScanRoots.forEach((root) => {
                if (root instanceof Element && document.contains(root)) {
                    roots.push(root);
                }
            });
        }

        STATE.pendingScanRoots.clear();
        STATE.pendingFullScan = false;
        return roots.length ? roots : [document];
    }

    function getStoryCardsFromRoots(roots) {
        const seen = new Set();
        const cards = [];

        roots
            .flatMap((root) =>
                getMatchingRootOrDescendants(root, FEED_CARD_ROOT_SELECTOR),
            )
            .forEach((candidate) => {
                const card = candidate;
                if (!(card instanceof Element) || seen.has(card)) {
                    return;
                }

                const parentCard = card.parentElement
                    ? card.parentElement.closest(FEED_CARD_ROOT_SELECTOR)
                    : null;
                if (parentCard && seen.has(parentCard)) {
                    return;
                }

                seen.add(card);
                cards.push(card);
            });

        return cards;
    }

    function enhanceScannableCards(cards) {
        cards.forEach((card) => {
            incrementDebugCounter("data-bcampx-card-root-count");

            if (card.hasAttribute(ENHANCED_ATTR)) {
                return;
            }

            const releaseContext = getCardReleaseRequestContext(card);
            const releaseUrl = releaseContext.releaseUrl;
            incrementDebugCounter("data-bcampx-release-link-count");
            if (!releaseUrl) {
                markDebugState("data-bcampx-last-skip", "missing-release-url");
                return;
            }

            incrementDebugCounter("data-bcampx-fan-activity-link-count");
            enhanceCard(card, releaseUrl, releaseContext);
        });
    }

    function isFullDiscographyCard(node) {
        if (!(node instanceof Element)) {
            return false;
        }

        const root =
            node.closest(".story-innards") ||
            node.closest("li.story") ||
            node.closest(".story") ||
            node.closest(CARD_SELECTOR) ||
            node;

        if (!(root instanceof Element)) {
            return false;
        }

        if (
            root.querySelector(
                'a.item-link[href*="#buyFullDiscography"], a[href*="#buyFullDiscography"]',
            )
        ) {
            return true;
        }

        const titleNode = root.querySelector(
            ".collection-item-title, .item-title",
        );
        if (
            titleNode &&
            /\bfull(?:\s+digital)?\s+discography\b/i.test(
                normalizedText(titleNode),
            )
        ) {
            return true;
        }

        const storyTitle = root.querySelector(".story-title");
        if (
            storyTitle &&
            /\bfull\s+discography\b/i.test(normalizedText(storyTitle))
        ) {
            return true;
        }

        return Boolean(
            root.querySelector(".bundle-art-container") &&
            root.querySelector(".bundle-releases"),
        );
    }

    function mergeAdjacentTrackPurchaseCards(cards) {
        let previousCandidate = null;

        (Array.isArray(cards) ? cards : []).forEach((card) => {
            if (card.getAttribute(MERGED_CHILD_ATTR) === "true") {
                return;
            }

            if (
                !looksLikeFeedCard(card) ||
                isMalformedFeedCard(card) ||
                card.closest(EXCLUDED_SECTION_SELECTOR)
            ) {
                previousCandidate = null;
                return;
            }

            const candidate = getTrackPurchaseMergeCandidate(card);
            if (!candidate) {
                previousCandidate = null;
                return;
            }

            if (
                previousCandidate &&
                getTrackPurchaseMergeKey(previousCandidate) ===
                    getTrackPurchaseMergeKey(candidate)
            ) {
                mergeTrackPurchaseCard(
                    previousCandidate.card,
                    card,
                    candidate.trackTitle,
                );
                return;
            }

            previousCandidate = candidate;
        });
    }

    function getTrackPurchaseMergeKey(candidate) {
        return [
            candidate.fanKey,
            candidate.activityType,
            candidate.releaseGroupKey,
        ].join("::");
    }

    function getTrackPurchaseMergeCandidate(card) {
        if (!(card instanceof Element)) {
            return null;
        }

        const memo = getNodeMemo(card);
        if (
            memo &&
            Object.prototype.hasOwnProperty.call(memo, "trackPurchaseMergeCandidate")
        ) {
            return memo.trackPurchaseMergeCandidate;
        }

        const activityType = extractActivityType(card);
        if (activityType !== "bought-track") {
            if (memo) {
                memo.trackPurchaseMergeCandidate = null;
            }
            return null;
        }

        const fanKey = extractFanKey(card);
        const releaseGroupKey = getCardReleaseGroupKey(card);
        const trackTitle = extractTrackTitleFromCard(card);

        if (!fanKey || !releaseGroupKey || !trackTitle) {
            if (memo) {
                memo.trackPurchaseMergeCandidate = null;
            }
            return null;
        }

        const candidate = {
            card,
            fanKey,
            activityType,
            releaseGroupKey,
            trackTitle,
        };

        if (memo) {
            memo.trackPurchaseMergeCandidate = candidate;
        }

        return candidate;
    }

    function extractActivityType(card) {
        const headline = findActivityHeadline(card) || getStoryTitleNode(card) || card;
        const text = normalizedText(headline).toLowerCase();
        if (
            /(?:bought|purchased)\s+a\s+track\b/.test(text) ||
            /(?:bought|purchased)\s+track\b/.test(text)
        ) {
            return "bought-track";
        }

        if (
            /(?:bought|purchased)\s+an\s+album\b/.test(text) ||
            /(?:bought|purchased)\s+album\b/.test(text)
        ) {
            return "bought-album";
        }

        if (/wishlisted\b/.test(text)) {
            return "wishlisted";
        }

        return "";
    }

    function extractFanKey(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "fanKey")) {
            return memo.fanKey || "";
        }

        const explicitFanLink = card.querySelector(
            ".story-title .fan-name a[href], .story-title a.fan-name[href], .story-title .fan-name[href]",
        );
        if (explicitFanLink && explicitFanLink.href) {
            try {
                const url = new URL(explicitFanLink.href, window.location.href);
                const fanKey = cleanText(
                    url.pathname.replace(/^\/+|\/+$/g, ""),
                ).toLowerCase();
                if (memo) {
                    memo.fanKey = fanKey;
                }
                return fanKey;
            } catch (_error) {
                // Fall through to broader extraction.
            }
        }

        const profileLink = Array.from(card.querySelectorAll("a[href]")).find(
            isLikelyProfileLink,
        );
        if (profileLink && profileLink.href) {
            try {
                const url = new URL(profileLink.href, window.location.href);
                const fanKey = cleanText(
                    url.pathname.replace(/^\/+|\/+$/g, ""),
                ).toLowerCase();
                if (memo) {
                    memo.fanKey = fanKey;
                }
                return fanKey;
            } catch (_error) {
                // Fall through to text extraction.
            }
        }

        const headline = findActivityHeadline(card);
        const actor = extractFeedHeadlineActor(
            headline ? normalizedText(headline) : normalizedText(card),
        );
        const fanKey = actor ? actor.toLowerCase() : "";
        if (memo) {
            memo.fanKey = fanKey;
        }
        return fanKey;
    }

    function extractFanDisplayName(card) {
        if (!(card instanceof Element)) {
            return "This fan";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "fanDisplayName")) {
            return memo.fanDisplayName || "This fan";
        }

        const explicitFanName = card.querySelector(
            ".story-title .fan-name, .story-title a.fan-name, .story-title .artist-name",
        );
        if (explicitFanName) {
            const text = normalizedText(explicitFanName);
            if (text) {
                if (memo) {
                    memo.fanDisplayName = text;
                }
                return text;
            }
        }

        const headline = findActivityHeadline(card);
        const actor = extractFeedHeadlineActor(
            headline ? normalizedText(headline) : normalizedText(card),
        );
        const displayName = actor || "This fan";
        if (memo) {
            memo.fanDisplayName = displayName;
        }
        return displayName;
    }

    function getItemJsonTrackTitle(node) {
        const parsed = getParsedItemJson(node);
        return cleanText(
            (parsed && parsed.item_title) ||
                (parsed && parsed.track_title) ||
                (parsed && parsed.title) ||
                (parsed && parsed.item_name) ||
                (parsed && parsed.name) ||
                "",
        );
    }

    function getCardReleaseGroupKey(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardReleaseGroupKey")) {
            return memo.cardReleaseGroupKey || "";
        }

        const albumLink = getCardAlbumReleaseUrl(card);
        if (albumLink) {
            const releaseGroupKey = `album:${albumLink}`;
            if (memo) {
                memo.cardReleaseGroupKey = releaseGroupKey;
            }
            return releaseGroupKey;
        }

        const itemJsonReleaseUrl = getItemJsonReleaseUrl(card);
        if (itemJsonReleaseUrl && /(^|\/)album\//.test(itemJsonReleaseUrl)) {
            const releaseGroupKey = `album:${itemJsonReleaseUrl}`;
            if (memo) {
                memo.cardReleaseGroupKey = releaseGroupKey;
            }
            return releaseGroupKey;
        }

        const releaseLink = Array.from(
            card.querySelectorAll(RELEASE_LINK_SELECTOR),
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .find(Boolean);
        if (!releaseLink) {
            if (memo) {
                memo.cardReleaseGroupKey = "";
            }
            return "";
        }

        let origin = "";
        try {
            origin = new URL(releaseLink, window.location.href).origin;
        } catch (_error) {
            origin = "";
        }

        const artist = extractArtistNameFromCard(card).toLowerCase();
        const artUrl = normalizeMediaUrl(getCardArtUrl(card));
        const releaseGroupKey = `heuristic:${origin}|${artist}|${artUrl}`;
        if (memo) {
            memo.cardReleaseGroupKey = releaseGroupKey;
        }
        return releaseGroupKey;
    }

    function extractArtistNameFromCard(card) {
        const contentColumn = findContentColumn(card);
        const explicitByline =
            (contentColumn || card).querySelector(
                ".itemsubtext, .collection-item-artist, .item-artist, .tralbum-artist",
            ) || null;
        if (explicitByline) {
            const explicitText = cleanText(
                (explicitByline.textContent || "").replace(/^by\s+/i, ""),
            );
            if (explicitText) {
                return explicitText;
            }
        }

        const byline = findCachedElementByText(
            contentColumn || card,
            "artistByline",
            "div, p, li, span, a",
            /^by\s+/i,
        );
        if (byline) {
            return cleanText((byline.textContent || "").replace(/^by\s+/i, ""));
        }

        const text = normalizedText(card);
        const match = text.match(
            /\bby\s+(.+?)(?:\s+featured track:|\s+buy now|\s+wishlist|\s+hear more|\s+tags?:|$)/i,
        );
        return match && match[1] ? cleanText(match[1]) : "";
    }

    function extractTrackTitleFromCard(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "trackTitleFromCard")) {
            return memo.trackTitleFromCard || "";
        }

        const contentColumn = findContentColumn(card);
        const trackScope = contentColumn || card;

        const featuredTrackText = extractFeaturedTrackTitle(trackScope);
        if (featuredTrackText) {
            if (memo) {
                memo.trackTitleFromCard = featuredTrackText;
            }
            return featuredTrackText;
        }

        const itemJsonTrackTitle = getItemJsonTrackTitle(trackScope);
        if (itemJsonTrackTitle) {
            if (memo) {
                memo.trackTitleFromCard = itemJsonTrackTitle;
            }
            return itemJsonTrackTitle;
        }

        const explicitTrackLink = Array.from(
            trackScope.querySelectorAll('a[href*="/track/"]'),
        ).find((link) => {
            const text = normalizedText(link);
            return (
                text &&
                !/\b(buy now|wishlist|hear more|open release|more)\b/i.test(
                    text,
                )
            );
        });
        if (explicitTrackLink) {
            const trackTitle = normalizedText(explicitTrackLink);
            if (memo) {
                memo.trackTitleFromCard = trackTitle;
            }
            return trackTitle;
        }

        const explicitTitle = trackScope.querySelector(
            ".collection-item-title, .item-title, h1, h2, h3, h4",
        );
        if (
            explicitTitle &&
            !explicitTitle.closest(".story-title, .bcampx__merge-note")
        ) {
            const explicitText = normalizedText(explicitTitle);
            if (
                explicitText &&
                !/^(featured track:|by\s+|buy now|wishlist|hear more|supported by|tracks?)\b/i.test(
                    explicitText,
                )
            ) {
                if (memo) {
                    memo.trackTitleFromCard = explicitText;
                }
                return explicitText;
            }
        }

        const titleCandidate = Array.from(
            trackScope.querySelectorAll(
                "h1, h2, h3, h4, strong, a, div, p, span",
            ),
        ).find((node) => {
            const text = normalizedText(node);
            if (!text) {
                return false;
            }

            if (
                /^(featured track:|by\s+|buy now|wishlist|hear more|supported by|tracks?)\b/i.test(
                    text,
                )
            ) {
                return false;
            }

            if (node.querySelector && node.querySelector("img")) {
                return false;
            }

            if (
                node.closest &&
                node.closest(".story-title, .bcampx__merge-note")
            ) {
                return false;
            }

            return true;
        });

        const trackTitle = titleCandidate ? normalizedText(titleCandidate) : "";
        if (memo) {
            memo.trackTitleFromCard = trackTitle;
        }
        return trackTitle;
    }

    function normalizeMediaUrl(value) {
        if (!value) {
            return "";
        }

        try {
            const url = new URL(value, window.location.href);
            url.hash = "";
            url.search = "";
            return url.toString();
        } catch (_error) {
            return cleanText(value);
        }
    }

    function mergeTrackPurchaseCard(primaryCard, duplicateCard, trackTitle) {
        if (!primaryCard || !duplicateCard || primaryCard === duplicateCard) {
            return;
        }

        const mergeState = ensureMergedTrackState(primaryCard);
        if (!mergeState.primaryTitle) {
            mergeState.primaryTitle = extractTrackTitleFromCard(primaryCard);
        }
        addMergedTrackTitle(primaryCard, trackTitle);

        primaryCard.setAttribute(MERGED_PARENT_ATTR, "true");
        duplicateCard.setAttribute(MERGED_CHILD_ATTR, "true");
        duplicateCard.style.display = "none";
        duplicateCard.hidden = true;

        if (STATE.observer) {
            STATE.observer.unobserve(duplicateCard);
        }

        updateMergedTrackPurchaseNotice(primaryCard);
        syncTrackButtonsForCard(primaryCard);
    }

    function getMergedTrackTitleSet(card) {
        const mergeState = ensureMergedTrackState(card);
        const titles = mergeState.titles.slice();
        const primaryTitle = cleanText(
            mergeState.primaryTitle || extractTrackTitleFromCard(card),
        );
        if (primaryTitle) {
            titles.unshift(primaryTitle);
        }

        return new Set(
            titles
                .map((title) => cleanText(title).toLowerCase())
                .filter(Boolean),
        );
    }

    function ensureMergedTrackState(card) {
        if (!card) {
            return { primaryTitle: "", titles: [] };
        }

        if (!card.__bcampxMergeState) {
            card.__bcampxMergeState = {
                primaryTitle: "",
                titles: [],
            };
        }

        if (!Array.isArray(card.__bcampxMergeState.titles)) {
            card.__bcampxMergeState.titles = [];
        }

        return card.__bcampxMergeState;
    }

    function addMergedTrackTitle(card, title) {
        const normalizedTitle = cleanText(title);
        if (!normalizedTitle) {
            return;
        }

        const mergeState = ensureMergedTrackState(card);
        if (
            !mergeState.titles.some(
                (entry) =>
                    entry.toLowerCase() === normalizedTitle.toLowerCase(),
            )
        ) {
            mergeState.titles.push(normalizedTitle);
        }
    }

    function findActivityHeadline(card) {
        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "activityHeadlineNode")) {
            return memo.activityHeadlineNode;
        }

        const storyTitle = findCachedSelector(card, "storyTitleNode", ".story-title");
        let result = null;
        if (
            storyTitle &&
            FAN_ACTIVITY_TEXT_PATTERN.test(normalizedText(storyTitle))
        ) {
            result = storyTitle;
        } else {
            result = findCachedElementByText(
            card,
            "activityHeadline",
            "div, p, li, span, strong, h2, h3, h4",
            /\b(bought|wishlisted|supported|recommended|listening|played)\b/i,
        );
        }

        if (memo) {
            memo.activityHeadlineNode = result || null;
        }
        return result || null;
    }

    function updateMergedTrackPurchaseNotice(card) {
        const mergeState = ensureMergedTrackState(card);
        const primaryTitle = cleanText(
            mergeState.primaryTitle || "",
        ).toLowerCase();
        const mergedTrackTitles = mergeState.titles.filter((title) => {
            const normalizedTitle = cleanText(title).toLowerCase();
            return normalizedTitle && normalizedTitle !== primaryTitle;
        });
        if (!mergedTrackTitles.length) {
            const existing = card.querySelector(".bcampx__merge-note");
            if (existing) {
                existing.remove();
            }
            return;
        }

        const notice = ensureMergedTrackPurchaseNotice(card);
        if (!notice) {
            return;
        }

        const fanName = extractFanDisplayName(card);
        notice.textContent = "";

        const fan = document.createElement("span");
        fan.className = "bcampx__merge-fan";
        fan.textContent = fanName;

        const verb = document.createElement("span");
        verb.className = "bcampx__merge-copy";
        verb.textContent = " also bought ";

        notice.append(fan, verb);

        mergedTrackTitles.forEach((title, index) => {
            if (index > 0) {
                const separator = document.createElement("span");
                separator.className = "bcampx__merge-copy";
                separator.textContent = ", ";
                notice.append(separator);
            }

            const track = document.createElement("button");
            track.type = "button";
            track.className = "bcampx__merge-track-button";
            track.dataset.trackTitle = title;
            track.textContent = `"${title}"`;
            track.addEventListener("click", () => {
                playMergedTrackTitle(card, title, track);
            });
            notice.append(track);
        });
    }

    function ensureMergedTrackPurchaseNotice(card) {
        const existing = card.querySelector(".bcampx__merge-note");
        if (existing) {
            return existing;
        }

        const notice = document.createElement("div");
        notice.className = "bcampx__merge-note";

        const headline = findActivityHeadline(card);
        if (headline && headline.parentNode) {
            headline.insertAdjacentElement("afterend", notice);
            return notice;
        }

        const contentColumn = findContentColumn(card);
        contentColumn.insertBefore(notice, contentColumn.firstChild || null);
        return notice;
    }

    function syncTrackButtonsForCard(card) {
        const controller = getCardController(card);
        if (controller && controller.loaded && controller.data) {
            const shell = card.querySelector(".bcampx");
            const meta = shell ? shell.querySelector(".bcampx__meta") : null;
            const text = shell
                ? shell.querySelector(".bcampx__summary-text")
                : null;
            const toggle = shell
                ? shell.querySelector(".bcampx__toggle")
                : null;
            if (shell && meta && text && toggle) {
                renderReleaseData(
                    shell,
                    meta,
                    text,
                    toggle,
                    controller.data,
                    controller.releaseUrl || "",
                );
            }
        }
    }

    function normalizeReleaseUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.protocol !== "https:") {
                return "";
            }

            if (!/(^|\/)(album|track)\//.test(url.pathname)) {
                return "";
            }

            url.hash = "";
            url.search = "";
            return url.toString().replace(/\/$/, "");
        } catch (_error) {
            return "";
        }
    }

    function looksLikeFeedCard(node) {
        if (!(node instanceof Element)) {
            return false;
        }

        const memo = getNodeMemo(node);
        if (
            memo &&
            Object.prototype.hasOwnProperty.call(memo, "looksLikeFeedCard")
        ) {
            return memo.looksLikeFeedCard;
        }

        const result = computeLooksLikeFeedCard(node);
        if (memo) {
            memo.looksLikeFeedCard = result;
        }
        return result;
    }

    function computeLooksLikeFeedCard(node) {
        if (isAlsoBoughtRecommendationCard(node)) {
            return false;
        }

        if (!isLikelyFanActivityCard(node)) {
            return false;
        }

        if (!hasFanActivitySignals(node)) {
            return false;
        }

        const releaseLinkCount = node.querySelectorAll(
            RELEASE_LINK_SELECTOR,
        ).length;
        if (releaseLinkCount < 1 || releaseLinkCount > 12) {
            return false;
        }

        const rect = node.getBoundingClientRect();
        const hasUsefulSize = rect.width >= 120 && rect.height >= 45;
        const hasCoverOrText =
            Boolean(node.querySelector("img")) ||
            normalizedText(node).length > 20;
        return hasUsefulSize && hasCoverOrText;
    }

    function hasFanActivitySignals(node) {
        if (
            node.querySelector(
                ".story-title .fan-name, .story-title .artist-name",
            )
        ) {
            return true;
        }

        if (
            node.querySelector(".story-title") &&
            FAN_ACTIVITY_TEXT_PATTERN.test(
                normalizedText(node.querySelector(".story-title")),
            )
        ) {
            return true;
        }

        const text = normalizedText(node);
        if (FAN_ACTIVITY_TEXT_PATTERN.test(text)) {
            return true;
        }

        const profileLinks = Array.from(
            node.querySelectorAll("a[href]"),
        ).filter(isLikelyProfileLink);
        return profileLinks.length > 0;
    }

    function isLikelyProfileLink(link) {
        try {
            const url = new URL(link.href, window.location.href);
            if (url.hostname !== "bandcamp.com") {
                return false;
            }

            const pathname = url.pathname.replace(/\/+$/, "");
            if (!pathname || pathname === "/") {
                return false;
            }

            if (
                /\/(album|track|tagged|discover|feed|fans|terms_of_use|about|help|search|gift_cards)(\/|$)/.test(
                    pathname,
                )
            ) {
                return false;
            }

            const segments = pathname.split("/").filter(Boolean);
            return segments.length === 1;
        } catch (_error) {
            return false;
        }
    }

    function isLikelyFanActivityCard(node) {
        if (!(node instanceof Element)) {
            return false;
        }

        if (
            node.closest(EXCLUDED_SECTION_SELECTOR) ||
            hasSidebarLikeAncestor(node)
        ) {
            return false;
        }

        if (hasExplicitFeedStoryStructure(node)) {
            return true;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.width < CONFIG.minFanActivityCardWidth) {
            return false;
        }

        return true;
    }

    function hasExplicitFeedStoryStructure(node) {
        const story = getStoryRoot(node);

        if (!(story instanceof Element)) {
            return false;
        }

        if (
            story.matches("li.story") &&
            story.hasAttribute("data-story-fan-id")
        ) {
            return true;
        }

        if (
            story.querySelector(".story-title") &&
            story.querySelector(".story-innards")
        ) {
            return true;
        }

        if (
            story.querySelector(".story-title") &&
            story.querySelector(".tralbum-wrapper")
        ) {
            return true;
        }

        return false;
    }

    function hasSidebarLikeAncestor(node) {
        let current = node;

        for (
            let depth = 0;
            current && current !== document.body && depth < 8;
            depth += 1
        ) {
            const idAndClass =
                `${current.id || ""} ${typeof current.className === "string" ? current.className : ""}`.toLowerCase();
            if (
                /(sidebar|side-bar|side_module|right[-_ ]?col|right[-_ ]?column|recommend|discover|new[-_ ]?release)/.test(
                    idAndClass,
                )
            ) {
                return true;
            }

            current = current.parentElement;
        }

        return false;
    }

    function enhanceCard(card, releaseUrl, releaseRequestContext = null) {
        incrementDebugCounter("data-bcampx-enhance-attempt-count");
        const fullDiscography = isFullDiscographyCard(card);
        const alsoBought = isAlsoBoughtRecommendationCard(card);
        if (fullDiscography || alsoBought) {
            markDebugState("data-bcampx-last-skip", "enhance-guard");
            markStoryCardSkipped(card, {
                reason: fullDiscography ? "full-discography" : "also-bought",
            });
            return;
        }

        card.setAttribute(ENHANCED_ATTR, "true");
        card.removeAttribute(SKIP_REASON_ATTR);
        card.removeAttribute(RETRYABLE_SKIP_ATTR);

        const shell = document.createElement("section");
        shell.className = "bcampx";

        const meta = document.createElement("div");
        meta.className = "bcampx__meta";
        meta.hidden = true;

        const summary = document.createElement("div");
        summary.className = "bcampx__summary";

        const text = document.createElement("span");
        text.className = "bcampx__summary-text";
        text.textContent = LOADING_EXTRA_CONTEXT_TEXT;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "bcampx__toggle";
        toggle.textContent = "More";
        toggle.hidden = true;

        summary.append(text, toggle);
        shell.append(meta, summary);
        mountEnhancementShell(card, shell);

        const controller = {
            loaded: false,
            loading: false,
            autoFetchQueued: false,
            expanded: false,
            data: null,
            refreshPromise: null,
            card,
            shellNode: shell,
            metaNode: meta,
            textNode: text,
            toggleNode: toggle,
            releaseUrl,
            releaseRequestContext:
                releaseRequestContext ||
                getCardReleaseRequestContext(card, releaseUrl),
            fetchAndRender: (options = {}) =>
                fetchAndRender(
                    controller,
                    releaseUrl,
                    shell,
                    meta,
                    text,
                    toggle,
                    options,
                ),
            toggle: () => toggleDetails(controller, shell, toggle),
        };

        setCardController(card, controller);
        renderArtistMusicCardInitialData(
            card,
            controller,
            shell,
            meta,
            text,
            toggle,
            releaseUrl,
        );
        incrementDebugCounter("data-bcampx-enhanced-count");

        toggle.addEventListener("click", () => {
            if (controller.loading) {
                return;
            }

            controller.toggle();
        });

        if (STATE.observer && !card.hasAttribute(OBSERVED_ATTR)) {
            card.setAttribute(OBSERVED_ATTR, "true");
            STATE.observer.observe(card);
        }
    }

    function renderArtistMusicCardInitialData(
        card,
        controller,
        shell,
        meta,
        text,
        toggle,
        releaseUrl,
    ) {
        const release = card && card.__bcampxArtistMusicRelease;
        const initialData = release && release.initialData;
        if (!initialData || !controller) {
            return;
        }

        const normalizedData = normalizeReleaseData(initialData);
        const showInitialLoading = shouldShowInitialExtraContextLoading(card);
        if (showInitialLoading) {
            applyReleaseShellLoadingState(controller);
        }

        controller.data = normalizedData;
        renderReleaseData(
            shell,
            meta,
            text,
            toggle,
            normalizedData,
            releaseUrl,
        );
        text.textContent = buildLoadedSummaryText(normalizedData, {
            fromCache: true,
            stale: false,
        });
        if (showInitialLoading) {
            text.textContent = LOADING_EXTRA_CONTEXT_TEXT;
        }

        // Own collection tracks use native item data only. Mark them as
        // loaded so the auto-fetch path never crawls release pages for them.
        if (isOwnFanTrackCard(card)) {
            controller.loaded = true;
        }
    }

    function shouldShowInitialExtraContextLoading(card) {
        if (isOwnFanTrackCard(card)) {
            return false;
        }

        const release = card && card.__bcampxArtistMusicRelease;
        return Boolean(
            release &&
                /^(fan-collection|fan-wishlist)$/.test(
                    cleanText(release.feedKind || ""),
                ),
        );
    }

    function mountEnhancementShell(card, shell) {
        const supportedBySlot = findSupportedBySlot(card);
        if (
            supportedBySlot &&
            supportedBySlot.container &&
            supportedBySlot.container.parentNode
        ) {
            card.classList.add("bcampx--supported-card");
            supportedBySlot.hiddenNodes.forEach((node) => {
                node.setAttribute(HIDDEN_SUPPORTED_ATTR, "true");
                node.hidden = true;
            });
            shell.classList.add("bcampx--supported-slot");
            supportedBySlot.container.appendChild(shell);
            return;
        }

        const anchor = findEnhancementAnchor(card);
        if (anchor && anchor.parentNode) {
            anchor.insertAdjacentElement("afterend", shell);
            return;
        }

        const contentColumn = findContentColumn(card);
        contentColumn.appendChild(shell);
    }

    function findEnhancementAnchor(card) {
        const tagLine = findCachedElementByText(
            card,
            "tagLine",
            "div, p, li, section",
            /^tags\s*:/i,
        );
        if (tagLine) {
            return tagLine;
        }

        const actionLink = findCardActionLink(card, COLLECT_ACTION_TEXT_RE);

        if (actionLink) {
            return findUsefulActionRow(actionLink, card) || actionLink;
        }

        const featuredTrackLine = findCachedElementByText(
            card,
            "featuredTrackAnchor",
            "div, p, li, section",
            /^featured track\s*:/i,
        );
        if (featuredTrackLine) {
            return featuredTrackLine;
        }

        return null;
    }

    function findSupportedBySlot(card) {
        const explicitSlot = findCachedSelector(
            card,
            "supportedSlotExplicit",
            SUPPORTED_SLOT_SELECTOR,
        );
        if (explicitSlot) {
            return {
                container: explicitSlot,
                hiddenNodes: Array.from(explicitSlot.children),
            };
        }

        const label = findCachedElementByText(
            card,
            "supportedByLabel",
            "div, span, p, strong, h2, h3, h4",
            /\bsupported by\b/i,
        );
        if (!label) {
            return null;
        }

        const cardRect = card.getBoundingClientRect();
        const container =
            nearestAncestorWithin(label, card, (node) =>
                isSupportedSlotCandidate(node, cardRect),
            ) || label.parentElement;
        if (
            !container ||
            container === card ||
            !isSupportedSlotCandidate(container, cardRect)
        ) {
            return null;
        }

        return {
            container,
            hiddenNodes: collectSupportedSlotHiddenNodes(container, label),
        };
    }

    function findContentColumn(card) {
        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "contentColumnNode")) {
            return memo.contentColumnNode || card;
        }

        const explicitColumn = findCachedSelector(
            card,
            "contentColumnExplicit",
            CONTENT_COLUMN_SELECTOR,
        );
        if (explicitColumn) {
            if (memo) {
                memo.contentColumnNode = explicitColumn;
            }
            return explicitColumn;
        }

        const releaseLink = card.querySelector(RELEASE_LINK_SELECTOR);
        if (releaseLink) {
            // Read the card box once: the predicate runs for every ancestor
            // and would otherwise force the same layout on each step.
            const cardWidth = card.getBoundingClientRect().width;
            const block = nearestAncestorWithin(releaseLink, card, (node) => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.width < cardWidth * 0.82;
            });

            if (block && block !== card) {
                if (memo) {
                    memo.contentColumnNode = block;
                }
                return block;
            }
        }

        if (memo) {
            memo.contentColumnNode = card;
        }
        return card;
    }

    function isSupportedSlotCandidate(node, cardRect) {
        if (!(node instanceof Element)) {
            return false;
        }

        const rect = node.getBoundingClientRect();
        const widthRatio = cardRect.width > 0 ? rect.width / cardRect.width : 1;
        const leftRatio =
            cardRect.width > 0
                ? (rect.left - cardRect.left) / cardRect.width
                : 0;
        const avatarCount = node.querySelectorAll("img").length;
        return widthRatio < 0.48 && leftRatio > 0.42 && avatarCount >= 2;
    }

    function collectSupportedSlotHiddenNodes(container, label) {
        const hiddenNodes = [label];

        Array.from(container.children).forEach((child) => {
            if (child === label) {
                return;
            }

            const childText = normalizedText(child);
            const childAvatars = child.querySelectorAll("img").length;
            if (
                childAvatars >= 1 ||
                /^more\.\.\.$/i.test(childText) ||
                /supported by/i.test(childText)
            ) {
                hiddenNodes.push(child);
            }
        });

        return Array.from(new Set(hiddenNodes));
    }

    function findUsefulActionRow(node, stopAt) {
        return nearestAncestorWithin(node, stopAt, (current) => {
            const linkCount = current.querySelectorAll("a").length;
            return (
                linkCount >= 2 &&
                Boolean(findCardActionLink(current, COLLECT_ACTION_TEXT_RE))
            );
        });
    }

    function nearestAncestorWithin(node, stopAt, predicate) {
        let current = node;
        while (current && current !== stopAt) {
            if (current.nodeType === Node.ELEMENT_NODE && predicate(current)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function findCardActionLink(root, pattern, selector = "a[href], button") {
        if (!(root instanceof Element)) {
            return null;
        }

        const scope = root.querySelector(COLLECT_CONTROLS_SELECTOR) || root;
        return (
            Array.from(scope.querySelectorAll(selector)).find((node) =>
                pattern.test(cleanText(node.textContent || "")),
            ) || null
        );
    }

    function findElementByText(root, selector, pattern) {
        return Array.from(root.querySelectorAll(selector)).find((node) =>
            pattern.test(normalizedText(node)),
        );
    }

    function getMatchingRootOrDescendants(root, selector) {
        if (!root || typeof selector !== "string") {
            return [];
        }

        const matches = [];
        if (root instanceof Element && root.matches(selector)) {
            matches.push(root);
        }

        if (root.querySelectorAll) {
            matches.push(...Array.from(root.querySelectorAll(selector)));
        }

        return matches;
    }

    function getNodeMemo(node) {
        if (!(node instanceof Element)) {
            return null;
        }

        if (
            !node.__bcampxMemo ||
            node.__bcampxMemo.__version !== STATE.memoVersion
        ) {
            node.__bcampxMemo = Object.create(null);
            node.__bcampxMemo.__version = STATE.memoVersion;
        }

        return node.__bcampxMemo;
    }

    function findCachedElementByText(root, key, selector, pattern) {
        if (!(root instanceof Element) || !key) {
            return null;
        }

        const memo = getNodeMemo(root);
        if (memo && Object.prototype.hasOwnProperty.call(memo, key)) {
            return memo[key];
        }

        const result = findElementByText(root, selector, pattern) || null;
        if (memo) {
            memo[key] = result;
        }
        return result;
    }

    function findCachedSelector(root, key, selector) {
        if (!(root instanceof Element) || !key || !selector) {
            return null;
        }

        const memo = getNodeMemo(root);
        if (memo && Object.prototype.hasOwnProperty.call(memo, key)) {
            return memo[key];
        }

        const result = root.querySelector(selector) || null;
        if (memo) {
            memo[key] = result;
        }
        return result;
    }

    // A card can already show a native preview (own-collection cards ship one)
    // and the fresh release data can come back empty (a track page without a
    // parsable tracklist, a package without digital tracks, ...). Rendering that
    // empty result would erase a tracklist the user can already see.
    // A rendered tracklist is user-visible content. If a later parse comes back
    // with a description but no track rows, keep the rows we already have.
    function preferPreviousTracks(freshData, previousData) {
        if (
            !previousData ||
            !Array.isArray(previousData.tracks) ||
            !previousData.tracks.length
        ) {
            return freshData;
        }
        if (Array.isArray(freshData.tracks) && freshData.tracks.length) {
            return freshData;
        }

        markDebugState(
            "data-bcampx-release-refresh-fallback",
            "kept-tracks",
        );
        return { ...freshData, tracks: previousData.tracks };
    }

    function preferRenderableReleaseData(freshData, previousData) {
        if (!previousData || !hasVisibleEnhancements(previousData)) {
            return freshData;
        }
        if (hasVisibleEnhancements(freshData)) {
            return freshData;
        }

        return previousData;
    }

    function rememberRenderedReleaseData(releaseUrl, data) {
        const key = normalizeReleaseUrl(releaseUrl || "");
        if (!key || !data || !Array.isArray(data.tracks) || !data.tracks.length) {
            return;
        }

        const cache = STATE.renderedReleaseDataByUrl;
        if (!cache) {
            return;
        }
        cache.delete(key);
        cache.set(key, data);
        const max = 200;
        while (cache.size > max) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            cache.delete(oldest);
        }
    }

    function releaseControllerNeedsTracks(controller) {
        return Boolean(
            controller &&
                (!controller.data ||
                    !Array.isArray(controller.data.tracks) ||
                    !controller.data.tracks.length),
        );
    }

    // A backoff can block the mobile-API tracklist while a card is on screen,
    // leaving tag results without rows until a reload. Refill those cards once
    // the backoff ends, using only the (usually cached) API response.
    function scheduleTracklistRetryAfterCooldown() {
        if (STATE.tracklistRetryTimer) {
            return;
        }
        const until = Number(STATE.tagIndexCooldownUntil) || 0;
        if (until <= Date.now()) {
            return;
        }
        STATE.tracklistRetryTimer = window.setTimeout(
            () => {
                STATE.tracklistRetryTimer = 0;
                void fillMissingTracklistsFromApi();
            },
            Math.min(6 * 60 * 60 * 1000, until - Date.now() + 2000),
        );
    }

    async function fillMissingTracklistsFromApi() {
        const cards = Array.from(
            document.querySelectorAll(".bcampx-label-feed-card"),
        );
        for (const card of cards) {
            const controller = getCardController(card);
            if (
                !controller ||
                (!controller.loaded && !controller.failed) ||
                !card.isConnected ||
                !releaseControllerNeedsTracks(controller)
            ) {
                continue;
            }

            const release = card.__bcampxArtistMusicRelease;
            const apiData = await fetchApiReleaseTracklist(release);
            if (!apiData || !apiData.tracks.length) {
                continue;
            }

            const merged = normalizeReleaseData({
                ...(controller.data || createEmptyReleaseData()),
                tracks: apiData.tracks,
                description:
                    (controller.data && controller.data.description) ||
                    apiData.description,
            });
            controller.data = preferPreviousTracks(merged, controller.data);
            controller.loaded = true;
            controller.failed = false;
            if (
                controller.shellNode &&
                controller.metaNode &&
                controller.textNode &&
                controller.toggleNode
            ) {
                renderReleaseData(
                    controller.shellNode,
                    controller.metaNode,
                    controller.textNode,
                    controller.toggleNode,
                    controller.data,
                    controller.releaseUrl || "",
                );
            }
        }

        scheduleTracklistRetryAfterCooldown();
    }

    async function fetchAndRender(
        controller,
        releaseUrl,
        shell,
        meta,
        text,
        toggle,
        options,
    ) {
        controller.loading = true;
        applyReleaseShellLoadingState(controller);
        let keepLoadingForRefresh = false;

        // A feed sync can replace the card that already showed a tracklist.
        // Paint the known data immediately so the replacement starts with the
        // rows instead of an empty slot while the request is in flight.
        const knownData =
            STATE.renderedReleaseDataByUrl &&
            STATE.renderedReleaseDataByUrl.get(
                normalizeReleaseUrl(releaseUrl || ""),
            );
        const hasKnownTracks =
            controller.data &&
            Array.isArray(controller.data.tracks) &&
            controller.data.tracks.length > 0;
        if (knownData && !hasKnownTracks) {
            controller.data = knownData;
            renderReleaseData(
                shell,
                meta,
                text,
                toggle,
                knownData,
                releaseUrl,
            );
        }

        // Tag cards carry their release identity. Only start the small
        // mobile-API tracklist request up front once this session has seen a
        // page parse come back without a tracklist; otherwise the page result
        // is used and the API request is skipped entirely.
        const releaseForTracklist =
            controller.card && controller.card.__bcampxArtistMusicRelease;
        // Tag results are built from the local index, and the tag request
        // already carried their tracklist. Render those cards from that answer
        // instead of downloading the full release page for every result: a
        // broad query can produce dozens of them.
        if (
            releaseForTracklist &&
            releaseForTracklist.tagOrigin === "index"
        ) {
            const apiTracklist = await fetchApiReleaseTracklist(
                releaseForTracklist,
            );
            if (
                apiTracklist &&
                Array.isArray(apiTracklist.tracks) &&
                apiTracklist.tracks.length
            ) {
                const tagKey = getTagTralbumKey(
                    releaseForTracklist.tralbumType,
                    releaseForTracklist.tralbumId,
                );
                const cachedTags =
                    getCachedReleaseTags(tagKey) || [];
                let data = normalizeReleaseData({
                    url: releaseUrl,
                    title: releaseForTracklist.title,
                    artist: releaseForTracklist.artist,
                    artUrl: releaseForTracklist.artUrl,
                    tracks: apiTracklist.tracks,
                    description: apiTracklist.description || "",
                    tags: cachedTags,
                    hasBodyDescriptionSource: Boolean(
                        apiTracklist.description,
                    ),
                });
                data = preferPreviousTracks(
                    preferRenderableReleaseData(data, controller.data),
                    controller.data,
                );
                controller.loaded = true;
                controller.failed = false;
                controller.data = data;
                rememberRenderedReleaseData(releaseUrl, data);
                renderReleaseData(
                    shell,
                    meta,
                    text,
                    toggle,
                    data,
                    releaseUrl,
                );
                const shouldExpand =
                    (!options.auto || CONFIG.expandAfterAutoFetch) &&
                    hasExpandableContent(data);
                controller.expanded = shouldExpand;
                shell.classList.toggle(
                    "bcampx--expanded",
                    shouldExpand,
                );
                updateToggle(toggle, shouldExpand);
                text.textContent = buildLoadedSummaryText(data, {
                    fromCache: true,
                });
                markDebugState(
                    "data-bcampx-tracklist-source",
                    "mobile-api",
                );
                clearReleaseShellLoadingState(controller);
                return;
            }
        }

        try {
            const result = await getReleaseData(
                controller.releaseRequestContext || releaseUrl,
            );
            let normalizedData = preferPreviousTracks(
                preferRenderableReleaseData(
                    getRenderableReleaseData(controller, result),
                    controller.data,
                ),
                controller.data,
            );
            if (!normalizedData.tracks.length) {
                const apiTracklist =
                    await fetchApiReleaseTracklist(releaseForTracklist);
                if (apiTracklist && apiTracklist.tracks.length) {
                    normalizedData = {
                        ...normalizedData,
                        tracks: apiTracklist.tracks,
                        description:
                            normalizedData.description ||
                            apiTracklist.description,
                    };
                    markDebugState(
                        "data-bcampx-tracklist-source",
                        "mobile-api",
                    );
                }
            }
            controller.loaded = true;
            controller.failed = false;
            controller.data = normalizedData;
            try {
                harvestTagsFromReleaseData(
                    controller.card &&
                        controller.card.__bcampxArtistMusicRelease,
                    normalizedData.tags,
                );
            } catch (_error) {
                // Tag harvesting is a side benefit; never let it turn a
                // successful release render into an error panel.
            }
            rememberRenderedReleaseData(releaseUrl, normalizedData);
            if (
                releaseControllerNeedsTracks(controller) &&
                Number(STATE.tagIndexCooldownUntil) > Date.now()
            ) {
                scheduleTracklistRetryAfterCooldown();
            }
            keepLoadingForRefresh = Boolean(result.refreshPromise);

            renderReleaseData(
                shell,
                meta,
                text,
                toggle,
                normalizedData,
                releaseUrl,
            );

            const shouldExpand =
                (!options.auto || CONFIG.expandAfterAutoFetch) &&
                hasExpandableContent(normalizedData);
            controller.expanded = shouldExpand;
            shell.classList.toggle("bcampx--expanded", shouldExpand);
            updateToggle(toggle, shouldExpand);
            text.textContent = result.refreshingTracks
                ? LOADING_EXTRA_CONTEXT_TEXT
                : buildLoadedSummaryText(normalizedData, result);
            if (result.refreshPromise) {
                attachReleaseRefreshPromise(
                    controller,
                    result.refreshPromise,
                    releaseUrl,
                    shell,
                    meta,
                    text,
                    toggle,
                );
            }
        } catch (error) {
            if (isTagIndexRateLimitError(error)) {
                // Pause card page fetches for a short while, but leave the tag
                // index alone: its own requests are paced and it may still make
                // progress. Conflating the two let a single page fetch block an
                // empty index for minutes.
                STATE.releaseFetchCooldownUntil =
                    Date.now() +
                    (Number(CONFIG.releaseFetchCooldownMs) || 120000);
                markDebugState(
                    "data-bcampx-release-cooldown",
                    String(STATE.releaseFetchCooldownUntil),
                );
            }
            markDebugState(
                "data-bcampx-last-release-error",
                cleanText(
                    normalizeDisplayErrorMessage(error) ||
                        "Release fetch failed.",
                ).slice(0, 140),
            );

            const apiTracklist =
                await fetchApiReleaseTracklist(releaseForTracklist);
            if (apiTracklist && apiTracklist.tracks.length) {
                controller.loaded = true;
                controller.failed = false;
                controller.data = normalizeReleaseData({
                    ...createEmptyReleaseData(),
                    ...apiTracklist,
                });
                rememberRenderedReleaseData(releaseUrl, controller.data);
                renderReleaseData(
                    shell,
                    meta,
                    text,
                    toggle,
                    controller.data,
                    releaseUrl,
                );
                text.textContent = buildLoadedSummaryText(controller.data, {
                    fromCache: false,
                    stale: false,
                });
                return;
            }

            // The card may already show a native preview (own-collection cards
            // ship their tracklist with the page). A failed refresh must not
            // replace that with an error panel.
            if (controller.data && hasVisibleEnhancements(controller.data)) {
                controller.loaded = true;
                controller.failed = false;
                text.textContent = "Extra context kept from the page";
                shell.classList.toggle(
                    "bcampx--expanded",
                    hasExpandableContent(controller.data),
                );
                updateToggle(
                    toggle,
                    shell.classList.contains("bcampx--expanded"),
                );
                return;
            }

            if (shouldAbandonReleaseEnhancement(error)) {
                controller.loaded = true;
                controller.failed = false;
                controller.data = createEmptyReleaseData();
                renderEmpty(meta, text, releaseUrl, {
                    message: "Extra metadata is unavailable for this release.",
                    summary: "No extra context available",
                });
            } else {
                controller.loaded = false;
                controller.failed = true;
                controller.data = null;
                renderError(controller, meta, text, releaseUrl, error);
            }
            shell.classList.remove("bcampx--expanded");
            toggle.hidden = true;
        } finally {
            controller.loading = false;
            if (!keepLoadingForRefresh) {
                clearReleaseShellLoadingState(controller);
            }
        }
    }

    function applyReleaseShellLoadingState(controller) {
        if (!controller) {
            return;
        }

        const shell = controller.shellNode;
        const text = controller.textNode;
        const toggle = controller.toggleNode;

        if (shell) {
            shell.classList.add("bcampx--loading");
            shell.setAttribute("data-bcampx-loading-extra-context", "true");
        }
        if (text) {
            text.textContent = LOADING_EXTRA_CONTEXT_TEXT;
        }
        if (toggle) {
            toggle.disabled = true;
        }
    }

    function clearReleaseShellLoadingState(controller) {
        if (!controller) {
            return;
        }

        const shell = controller.shellNode;
        const toggle = controller.toggleNode;

        if (shell) {
            shell.classList.remove("bcampx--loading");
            shell.removeAttribute("data-bcampx-loading-extra-context");
            shell
                .querySelectorAll(".bcampx__slot-loading")
                .forEach((node) => node.remove());
        }
        if (toggle) {
            toggle.disabled = false;
        }
    }

    function getRenderableReleaseData(controller, result) {
        const data = (result && result.data) || createEmptyReleaseData();
        if (!(result && result.refreshingTracks)) {
            return data;
        }

        const release =
            controller &&
            controller.card &&
            controller.card.__bcampxArtistMusicRelease;
        const nativeData = normalizeReleaseData(
            release && release.initialData,
        );
        const nativeTracks = Array.isArray(nativeData.tracks)
            ? nativeData.tracks
            : [];
        const tracks = data.tracks.map((track) => {
            const nativeTrack = nativeTracks.find(
                (candidate) =>
                    (track.trackId &&
                        candidate.trackId &&
                        track.trackId === candidate.trackId) ||
                    cleanText(track.title).toLowerCase() ===
                        cleanText(candidate.title).toLowerCase(),
            );
            return {
                ...track,
                streamUrl:
                    (nativeTrack && nativeTrack.streamUrl) || "",
            };
        });
        return { ...data, tracks };
    }

    function attachReleaseRefreshPromise(
        controller,
        refreshPromise,
        releaseUrl,
        shell,
        meta,
        text,
        toggle,
    ) {
        controller.refreshPromise = refreshPromise;
        void refreshPromise
            .then((result) => {
                if (controller.refreshPromise !== refreshPromise) {
                    return;
                }

                const normalizedData = preferPreviousTracks(
                    preferRenderableReleaseData(
                        getRenderableReleaseData(controller, result),
                        controller.data,
                    ),
                    controller.data,
                );
                controller.data = normalizedData;
                if (!shell.isConnected) {
                    return;
                }
                renderReleaseData(
                    shell,
                    meta,
                    text,
                    toggle,
                    normalizedData,
                    releaseUrl,
                );
                shell.classList.toggle(
                    "bcampx--expanded",
                    controller.expanded,
                );
                updateToggle(toggle, controller.expanded);
                text.textContent = buildLoadedSummaryText(
                    normalizedData,
                    result,
                );
            })
            .catch((error) => {
                if (controller.refreshPromise !== refreshPromise) {
                    return;
                }
                // Stale preview URLs stay cleared on purpose (see the
                // cached-stale-stream fixture); surface the failure instead of
                // restoring URLs that are likely to 410.
                recordTrackActionDiagnostic("release-refresh-failed", {
                    releaseUrl,
                    error:
                        error && error.message
                            ? error.message
                            : "Release refresh failed.",
                });
                const fallbackData = controller.data || createEmptyReleaseData();
                text.textContent = buildLoadedSummaryText(fallbackData, {
                    fromCache: true,
                    stale: true,
                });
            })
            .finally(() => {
                if (controller.refreshPromise === refreshPromise) {
                    controller.refreshPromise = null;
                }
                clearReleaseShellLoadingState(controller);
            });
    }

    function toggleDetails(controller, shell, toggle) {
        controller.expanded = !controller.expanded;
        shell.classList.toggle("bcampx--expanded", controller.expanded);
        updateToggle(toggle, controller.expanded);
    }

    function updateToggle(toggle, expanded) {
        if (!toggle) {
            return;
        }
        toggle.textContent = expanded ? "Less" : "More";
    }

    // __BCAMPX_RELEASE_DATA__

    function renderReleaseData(shell, meta, text, toggle, data, releaseUrl) {
        if (isFullDiscographyReleaseData(data)) {
            shell.remove();
            return;
        }

        meta.textContent = "";
        meta.hidden = false;

        if (shell.classList.contains("bcampx--supported-slot")) {
            updateArtistMusicCardBuyAction(
                shell.closest(".bcampx-label-feed-card"),
                data,
            );
            renderSupportedSlot(meta, text, toggle, data, releaseUrl);
            shell.classList.toggle("bcampx--expanded", false);
            updateFeedCardBuyButton(shell, data, releaseUrl);
            return;
        }

        renderStandardReleaseContent(meta, data, releaseUrl);
        updateFeedCardBuyButton(shell, data, releaseUrl);

        if (!hasVisibleEnhancements(data)) {
            applyEmptyReleaseState(shell, meta, text, toggle, releaseUrl);
            return;
        }

        applyStandardReleaseShellState(shell, text, toggle, data);
    }

    function updateFeedCardBuyButton(shell, data, releaseUrl) {
        if (!data || !releaseUrl) {
            return;
        }

        const card = shell.closest(FEED_CARD_ROOT_SELECTOR);
        if (!card) {
            return;
        }

        const buyLink = findCardActionLink(
            card,
            BUY_ACTION_TEXT_RE,
            RELEASE_LINK_SELECTOR,
        );
        if (!buyLink) {
            return;
        }

        const nativeText = cleanText(buyLink.textContent || "").toLowerCase();
        if (/^you own this$|^free download$/i.test(nativeText)) {
            return;
        }

        const actionText = getDigitalBuyActionLabel(
            data.digitalPrice,
            data.isPreorder,
        );
        if (typeof buyLink.__bcampxBuyOriginalText !== "string") {
            buyLink.__bcampxBuyOriginalText = cleanText(
                buyLink.textContent || "",
            );
        }
        buyLink.textContent = actionText;

        // This runs on every re-render of a persistent native link, so replace
        // the previous handler instead of stacking a new one each time.
        if (typeof buyLink.__bcampxBuyClickHandler === "function") {
            buyLink.removeEventListener("click", buyLink.__bcampxBuyClickHandler);
        }

        const handleBuyClick = (event) => {
            event.preventDefault();
            event.stopPropagation();

            const text = cleanText(buyLink.textContent || "");
            if (
                /^hear more$/i.test(text) ||
                /you own this/i.test(text) ||
                /free download/i.test(text)
            ) {
                window.open(releaseUrl, "_blank", "noopener,noreferrer");
                return;
            }

            openTrackBuyWindow(releaseUrl);
        };

        buyLink.__bcampxBuyClickHandler = handleBuyClick;
        buyLink.addEventListener("click", handleBuyClick);
    }

    function renderStandardReleaseContent(meta, data, releaseUrl) {
        appendReleaseFacts(meta, data);
        appendReleaseDescription(meta, data);
        appendReleaseTrackList(meta, data);
        appendOpenReleaseLink(meta, releaseUrl);
    }

    function appendReleaseFacts(meta, data) {
        const facts = compactJoin(
            [formatReleaseDate(data.releaseDate), data.location],
            " · ",
        );
        if (!facts) {
            return;
        }

        const factsLine = createClassedElement("div", "bcampx__facts");
        factsLine.textContent = facts;
        meta.append(factsLine);
    }

    function appendReleaseDescription(meta, data) {
        const description = createDescriptionElement(
            data,
            "bcampx__description",
            "div",
        );
        if (!description) {
            return;
        }

        meta.append(description);
    }

    function appendReleaseTrackList(meta, data) {
        if (!data.tracks || !data.tracks.length) {
            return;
        }

        const tracks = createTrackListElement(
            data.tracks,
            "bcampx__tracks",
            (track) => {
                const item = document.createElement("li");
                item.textContent = track.title;
                return item;
            },
        );
        meta.append(tracks);
    }

    function appendOpenReleaseLink(meta, releaseUrl) {
        meta.append(createOpenReleaseLink(releaseUrl));
    }

    function applyEmptyReleaseState(shell, meta, text, toggle, releaseUrl) {
        renderEmpty(meta, text, releaseUrl);
        shell.classList.remove("bcampx--expanded");
        toggle.hidden = true;
    }

    function applyStandardReleaseShellState(shell, text, toggle, data) {
        const expandable = hasExpandableContent(data);
        toggle.hidden = !expandable;
        text.textContent = buildSummaryText(data);
        shell.classList.toggle(
            "bcampx--expanded",
            expandable && CONFIG.autoExpandTracks,
        );
        if (expandable) {
            updateToggle(toggle, CONFIG.autoExpandTracks);
        }
    }

    function renderSupportedSlot(meta, text, toggle, data, releaseUrl) {
        const shell = meta.closest(".bcampx");
        const card = meta.closest(CARD_SELECTOR);
        const purchasedTrackTitles = getMergedTrackTitleSet(card);
        const subhead = compactJoin(
            [formatReleaseDate(data.releaseDate), data.location],
            " · ",
        );
        const panel = createClassedElement("section", "bcampx__slot-panel");
        const autoExpandState = { steps: [] };
        const header = createClassedElement("div", "bcampx__slot-header");
        header.textContent = "Tracklist";
        panel.append(header);

        renderSupportedSlotTracks(
            panel,
            data,
            releaseUrl,
            purchasedTrackTitles,
            autoExpandState,
            card,
        );
        appendSupportedSlotLoading(panel, shell);
        renderSupportedSlotDescription(panel, data, autoExpandState);
        if (!shell.closest(".bcampx-label-feed-card")) {
            appendSupportedSlotSubhead(panel, subhead);
        }
        meta.append(panel);
        scheduleSupportedSlotAutoExpand(panel, autoExpandState);

        toggle.hidden = true;
        text.hidden = true;
    }

    function appendSupportedSlotLoading(panel, shell) {
        if (
            !panel ||
            !shell ||
            shell.getAttribute("data-bcampx-loading-extra-context") !== "true"
        ) {
            return;
        }

        const loading = createClassedElement("div", "bcampx__slot-loading");
        loading.textContent = LOADING_EXTRA_CONTEXT_TEXT;
        panel.append(loading);
    }

    function renderSupportedSlotTracks(
        panel,
        data,
        releaseUrl,
        purchasedTrackTitles,
        autoExpandState,
        card = null,
    ) {
        if (!data.tracks || !data.tracks.length) {
            return;
        }

        const initiallyVisible = Math.min(
            CONFIG.initialVisibleTracks,
            data.tracks.length,
        );
        const tracks = createTrackListElement(
            data.tracks,
            "bcampx__tracks bcampx__tracks--slot",
            (track, index) =>
                createSupportedSlotTrackItem(
                    track,
                    index,
                    initiallyVisible,
                    data,
                    releaseUrl,
                    purchasedTrackTitles,
                    card,
                ),
        );

        panel.append(tracks);

        if (data.tracks.length <= initiallyVisible) {
            return;
        }

        attachExpandableSection({
            parent: panel,
            target: tracks,
            collapsedClassName: "bcampx__tracks--collapsed",
            controllerClassName: "bcampx__slot-expand",
            collapsedLabel: `Show all ${data.tracks.length} tracks`,
            expandedLabel: "Show less",
            autoExpandState,
            shouldAutoExpand:
                data.tracks.length <= CONFIG.initialVisibleTracks + 3,
        });
    }

    function createSupportedSlotTrackItem(
        track,
        index,
        initiallyVisible,
        data,
        releaseUrl,
        purchasedTrackTitles,
        card = null,
    ) {
        const item = document.createElement("li");
        item.classList.add("bcampx__track-item");
        if (index >= initiallyVisible) {
            item.classList.add("bcampx__track-item--extra");
        }
        if (purchasedTrackTitles.has(cleanText(track.title).toLowerCase())) {
            item.classList.add("bcampx__track-item--purchased");
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "bcampx__track-link";
        button.textContent = track.title;
        const ownFanTrackCard = isOwnFanTrackCard(card);
        button.disabled = !track.streamUrl && !ownFanTrackCard;
        button.dataset.trackId = track.trackId || "";
        button.dataset.streamUrl = track.streamUrl || "";
        if (!track.streamUrl && ownFanTrackCard) {
            button.classList.add("bcampx__track-link--needs-load");
        }
        button.addEventListener("click", () => {
            if (track.streamUrl) {
                playSharedTrack(button, track, data, releaseUrl);
                return;
            }

            if (ownFanTrackCard) {
                void playOwnFanTrackAfterLoadingStream(
                    button,
                    track,
                    data,
                    releaseUrl,
                    card,
                );
            }
        });
        item.append(button);
        item.append(createSupportedSlotTrackEnd(track, releaseUrl));
        return item;
    }

    function createSupportedSlotTrackEnd(track, releaseUrl) {
        const end = createClassedElement("div", "bcampx__track-end");
        const trackActionUrl = resolveTrackActionUrl(track, releaseUrl);
        if (trackActionUrl) {
            end.dataset.trackActionUrl = trackActionUrl;
        }

        if (track.duration) {
            const duration = createClassedElement(
                "span",
                "bcampx__track-duration",
            );
            duration.textContent = track.duration;
            end.append(duration);
        }

        if (CONFIG.enableTrackRowActions && trackActionUrl) {
            end.append(createTrackActionButtons(trackActionUrl));
            end.classList.add("bcampx__track-end--has-actions");
        }

        return end;
    }

    function getOwnFanTrackPageUrl(release, track, releaseUrl) {
        const playerTrackUrl = normalizeReleaseUrl(
            release && release.playerData && release.playerData.url,
        );
        if (playerTrackUrl && /\/track\//.test(playerTrackUrl)) {
            return playerTrackUrl;
        }

        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
        if (/\/track\//.test(normalizedReleaseUrl)) {
            return normalizedReleaseUrl;
        }

        const sourceItem = release && release.sourceItem;
        const sourceTrackLink =
            sourceItem &&
            sourceItem.querySelector &&
            sourceItem.querySelector('a[href*="/track/"]');
        const sourceTrackUrl = normalizeReleaseUrl(
            sourceTrackLink && sourceTrackLink.href,
        );
        if (sourceTrackUrl) {
            return sourceTrackUrl;
        }

        const titleLink = normalizeReleaseUrl(track && track.titleLink);
        if (titleLink && /\/track\//.test(titleLink)) {
            return titleLink;
        }

        return "";
    }

    async function playOwnFanTrackAfterLoadingStream(
        button,
        track,
        data,
        releaseUrl,
        card,
    ) {
        if (!button || !card || !track) {
            return;
        }

        const release = card && card.__bcampxArtistMusicRelease;
        const resolvedTrackUrl =
            getOwnFanTrackPageUrl(release, track, releaseUrl) ||
            normalizeReleaseUrl(releaseUrl);
        if (!resolvedTrackUrl) {
            return;
        }

        button.disabled = true;
        button.classList.add("bcampx__track-link--loading");
        try {
            const result = await getReleaseData({ releaseUrl: resolvedTrackUrl });
            const loadedData = result && result.data;
            const loadedTrack =
                findPlayableTrackByTitle(loadedData, track.title) ||
                (loadedData &&
                    Array.isArray(loadedData.tracks) &&
                    loadedData.tracks.find((entry) => entry && entry.streamUrl)) ||
                null;
            if (!loadedTrack || !loadedTrack.streamUrl) {
                button.disabled = false;
                button.classList.remove("bcampx__track-link--loading");
                return;
            }

            // Update the button and track object so the next click plays
            // directly from the already-loaded stream.
            track.streamUrl = loadedTrack.streamUrl || "";
            track.trackId = loadedTrack.trackId || track.trackId || "";
            if (loadedTrack.titleLink) {
                track.titleLink = loadedTrack.titleLink;
            }
            button.dataset.streamUrl = track.streamUrl;
            button.dataset.trackId = track.trackId || "";
            button.disabled = false;
            button.classList.remove("bcampx__track-link--needs-load");
            button.classList.remove("bcampx__track-link--loading");

            playTrackForCard(
                card,
                button,
                track,
                data,
                resolvedTrackUrl,
            );
        } catch (_error) {
            button.disabled = false;
            button.classList.remove("bcampx__track-link--loading");
        }
    }

    function renderSupportedSlotDescription(panel, data, autoExpandState) {
        const description = createDescriptionElement(
            data,
            "bcampx__description bcampx__description--slot",
        );
        if (!description) {
            return;
        }

        const descriptionBlock = createClassedElement(
            "div",
            "bcampx__description-block",
        );
        descriptionBlock.append(description);
        panel.append(descriptionBlock);

        scheduleNextFrame(() => {
            if (!description.isConnected) {
                return;
            }

            normalizeDescriptionContent(description);
            description.classList.add("bcampx__description--collapsed");
            if (description.scrollHeight > description.clientHeight + 6) {
                attachExpandableSection({
                    parent: descriptionBlock,
                    target: description,
                    collapsedClassName: "bcampx__description--collapsed",
                    controllerClassName:
                        "bcampx__slot-expand bcampx__slot-expand--description",
                    collapsedLabel: "Show more",
                    expandedLabel: "Show less",
                    autoExpandState,
                    shouldAutoExpand:
                        cleanText(description.textContent || "").length <=
                        CONFIG.maxDescriptionLength * 0.5,
                });
                scheduleSupportedSlotAutoExpand(panel, autoExpandState);
                return;
            }

            description.classList.remove("bcampx__description--collapsed");
            scheduleSupportedSlotAutoExpand(panel, autoExpandState);
        });
    }

    function appendSupportedSlotSubhead(panel, subhead) {
        if (!subhead) {
            return;
        }

        const facts = createClassedElement("div", "bcampx__slot-subhead");
        facts.textContent = subhead;
        panel.append(facts);
    }

    function attachExpandableSection({
        parent,
        target,
        collapsedClassName,
        controllerClassName,
        collapsedLabel,
        expandedLabel,
        autoExpandState,
        shouldAutoExpand,
    }) {
        if (!parent || !target || !collapsedClassName) {
            return null;
        }

        target.classList.add(collapsedClassName);
        const controller = createExpandController({
            className: controllerClassName,
            collapsedLabel,
            expandedLabel,
            onToggle: (expanded) => {
                target.classList.toggle(collapsedClassName, !expanded);
            },
        });
        parent.append(controller.button);
        registerAutoExpandStep(autoExpandState, controller, shouldAutoExpand);
        return controller;
    }

    function registerAutoExpandStep(state, controller, shouldAutoExpand) {
        if (
            !state ||
            !Array.isArray(state.steps) ||
            !controller ||
            typeof controller.expand !== "function"
        ) {
            return;
        }

        state.steps.push({
            controller,
            shouldAutoExpand: Boolean(shouldAutoExpand),
        });
    }

    function createExpandController({
        className,
        collapsedLabel,
        expandedLabel,
        onToggle,
    }) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        let autoExpanded = false;

        const syncButton = (expanded) => {
            const autoHidden = expanded && autoExpanded;
            button.hidden = autoHidden;
            button.style.display = autoHidden ? "none" : "";
            button.setAttribute("aria-hidden", autoHidden ? "true" : "false");
            button.textContent = expanded ? expandedLabel : collapsedLabel;
        };

        const setExpanded = (expanded, options = {}) => {
            const auto = Boolean(options.auto);
            if (!expanded) {
                autoExpanded = false;
            } else if (auto) {
                autoExpanded = true;
            } else {
                autoExpanded = false;
            }
            if (typeof onToggle === "function") {
                onToggle(expanded);
            }
            button.setAttribute("aria-expanded", expanded ? "true" : "false");
            syncButton(expanded);
        };

        setExpanded(false);
        button.addEventListener("click", () => {
            const expanded = button.getAttribute("aria-expanded") === "true";
            setExpanded(!expanded, { auto: false });
        });

        return {
            button,
            expand: (options) => setExpanded(true, options),
            collapse: () => setExpanded(false, { auto: false }),
        };
    }

    function scheduleSupportedSlotAutoExpand(panel, state) {
        scheduleNextFrame(() =>
            maybeAutoExpandSupportedSlot(panel, state),
        );
    }

    function maybeAutoExpandSupportedSlot(panel, state) {
        if (
            !panel ||
            !panel.isConnected ||
            !state ||
            !Array.isArray(state.steps)
        ) {
            return;
        }

        while (state.steps.length) {
            const step = state.steps.shift();
            if (
                !step ||
                !step.controller ||
                typeof step.controller.expand !== "function"
            ) {
                continue;
            }
            if (!step.shouldAutoExpand) {
                continue;
            }
            step.controller.expand({ auto: true });
        }
    }

    function renderError(controller, meta, text, releaseUrl, error) {
        meta.textContent = "";
        meta.hidden = false;
        const errorMessage = normalizeDisplayErrorMessage(error);
        const message = createClassedElement("p", "bcampx__error");
        message.textContent = `Could not load release details: ${errorMessage}`;

        meta.append(message);
        if (shouldOfferCustomDomainPermissionButton(error, releaseUrl)) {
            meta.append(
                createGrantCustomDomainAccessButton(controller, releaseUrl),
            );
        }
        if (controller && typeof controller.fetchAndRender === "function") {
            meta.append(createRetryReleaseButton(controller));
        }
        if (shouldOfferReleasePageRefresh(errorMessage)) {
            meta.append(createRefreshReleasePageButton());
        }
        meta.append(createOpenReleaseLink(releaseUrl));
        text.textContent = "Extra context failed to load";
    }

    function shouldAbandonReleaseEnhancement(error) {
        const message =
            error && error.message ? String(error.message) : "";
        return /Custom-domain Bandcamp release could not be resolved\./i.test(
            message,
        );
    }

    function extractMissingCustomDomainHostPermissionPattern(error) {
        const message =
            error && error.message ? String(error.message) : "";
        const match = message.match(
            /Host permission required for (https:\/\/[^\s]+\/\*)/i,
        );
        return match ? match[1] : "";
    }

    function isMissingCustomDomainHostPermissionError(error) {
        return Boolean(extractMissingCustomDomainHostPermissionPattern(error));
    }

    function shouldOfferCustomDomainPermissionButton(error, releaseUrl) {
        return Boolean(
            isMissingCustomDomainHostPermissionError(error) &&
                isWebExtensionHost() &&
                isCustomDomainReleaseUrl(releaseUrl) &&
                canUseExternalHostMethod("requestHostPermission"),
        );
    }

    function normalizeDisplayErrorMessage(error) {
        const rawMessage =
            error && error.message ? String(error.message) : "unknown error";

        if (
            /Extension context invalidated/i.test(rawMessage) ||
            /Receiving end does not exist/i.test(rawMessage) ||
            /Could not establish connection/i.test(rawMessage) ||
            /message port closed/i.test(rawMessage)
        ) {
            return "Extension was updated or reloaded. Refresh this Bandcamp tab and try again.";
        }

        if (/storage\.local\./i.test(rawMessage)) {
            return "Extension storage is unavailable. Refresh the tab or restart the browser and try again.";
        }

        if (isMissingCustomDomainHostPermissionError(error)) {
            return "This release uses a Bandcamp custom domain. Allow access to this domain to load details in the extension.";
        }

        return rawMessage;
    }

    function renderEmpty(meta, text, releaseUrl, options = {}) {
        meta.textContent = "";
        meta.hidden = false;
        const message = createClassedElement("p", "bcampx__empty");
        message.textContent =
            options && options.message
                ? String(options.message)
                : "No extra metadata found for this release.";

        meta.append(message, createOpenReleaseLink(releaseUrl));
        text.textContent =
            options && options.summary
                ? String(options.summary)
                : "No extra context available";
    }

    function createClassedElement(tagName, className) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        return element;
    }

    function createOpenReleaseLink(releaseUrl) {
        const link = createClassedElement("a", "bcampx__link");
        link.href = releaseUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open release";
        return link;
    }

    function createRetryReleaseButton(controller) {
        return createActionButton("Retry", async (button) => {
            if (!controller || controller.loading) {
                return;
            }

            button.disabled = true;
            button.textContent = "Retrying...";
            try {
                await controller.fetchAndRender({ auto: false });
            } finally {
                button.disabled = false;
                button.textContent = "Retry";
            }
        });
    }

    function createGrantCustomDomainAccessButton(controller, releaseUrl) {
        return createActionButton("Allow this domain", async (button) => {
            if (
                !controller ||
                controller.loading ||
                !canUseExternalHostMethod("requestHostPermission")
            ) {
                return;
            }

            button.disabled = true;
            button.textContent = "Opening request...";
            try {
                const result = await getExternalHostApi().requestHostPermission(
                    releaseUrl,
                );
                if (result && result.granted) {
                    button.textContent = "Retrying...";
                    await controller.fetchAndRender({ auto: false });
                    button.disabled = false;
                    button.textContent = "Allow this domain";
                    return;
                }

                button.disabled = false;
                flashActionButtonLabel(button, "Not granted");
            } catch (_error) {
                button.disabled = false;
                flashActionButtonLabel(button, "Try again");
            }
        });
    }

    function createRefreshReleasePageButton() {
        return createActionButton("Refresh page", (button) => {
            button.disabled = true;
            button.textContent = "Refreshing...";
            window.location.reload();
        });
    }

    function flashActionButtonLabel(button, label, durationMs = 1400) {
        if (!button) {
            return;
        }

        const originalLabel =
            button.dataset.bcampxOriginalLabel || button.textContent;
        button.textContent = label;
        window.setTimeout(() => {
            button.textContent = originalLabel;
        }, durationMs);
    }

    function createActionButton(label, onClick) {
        const button = createClassedElement("button", "bcampx__action");
        button.type = "button";
        button.textContent = label;
        button.dataset.bcampxOriginalLabel = label;
        button.addEventListener("click", () => {
            if (typeof onClick === "function") {
                Promise.resolve(onClick(button)).catch((error) => {
                    console.warn("[Bandcamplifier] Action button failed.", error);
                });
            }
        });
        return button;
    }

    function shouldOfferReleasePageRefresh(errorMessage) {
        const message = cleanText(errorMessage).toLowerCase();
        return Boolean(
            message &&
                (/refresh this bandcamp tab/.test(message) ||
                    /extension was updated or reloaded/.test(message) ||
                    /storage is unavailable/.test(message)),
        );
    }

    function createDescriptionElement(data, className, tagName = "div") {
        if (!(data && (data.descriptionHtml || data.description))) {
            return null;
        }

        const description = createClassedElement(tagName, className);
        renderDescriptionContent(description, data);
        return description;
    }

    function createTrackListElement(tracks, className, renderItem) {
        const list = createClassedElement("ol", className);
        (tracks || []).forEach((track, index) => {
            const item =
                typeof renderItem === "function"
                    ? renderItem(track, index)
                    : null;
            if (item instanceof Node) {
                list.append(item);
            }
        });
        return list;
    }

    function renderDescriptionContent(container, data) {
        const html = sanitizeDescriptionHtml(
            data && data.descriptionHtml ? data.descriptionHtml : "",
        );
        if (html) {
            replaceElementChildrenFromHtml(container, html);
            return;
        }

        container.textContent =
            data && data.description ? data.description : "";
    }

    function normalizeDescriptionContent(container) {
        if (!container) {
            return;
        }

        Array.from(container.querySelectorAll("p")).forEach((paragraph) => {
            if (!cleanText(paragraph.textContent || "")) {
                paragraph.remove();
            }
        });

        Array.from(container.childNodes).forEach((node) => {
            if (
                node.nodeType === Node.TEXT_NODE &&
                !cleanText(node.textContent || "")
            ) {
                node.remove();
            }
        });
    }

    function replaceElementChildrenFromHtml(container, html) {
        if (!container) {
            return;
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${html}</div>`,
            "text/html",
        );
        const root = parsed.body.firstElementChild;
        if (!root) {
            replaceElementChildren(container);
            return;
        }

        const nodes = Array.from(root.childNodes).map((node) =>
            document.importNode(node, true),
        );
        replaceElementChildren(container, nodes);
    }

    function replaceElementChildren(container, nodes = []) {
        if (!container) {
            return;
        }

        if (typeof container.replaceChildren === "function") {
            container.replaceChildren(...nodes);
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        nodes.forEach((node) => {
            if (node) {
                container.appendChild(node);
            }
        });
    }

    function resolveFanIdFromPageState(pagedataBlob, collectInfo = {}) {
        return Number(
            (pagedataBlob &&
                pagedataBlob.identities &&
                pagedataBlob.identities.fan &&
                pagedataBlob.identities.fan.id) ||
                (pagedataBlob &&
                    pagedataBlob.fan_info &&
                    pagedataBlob.fan_info.fan_id) ||
                collectInfo.fan_id ||
                0,
        ) || 0;
    }

    function isFullDiscographyReleaseData(data) {
        const title = cleanText(data && data.title);
        return /\bfull(?:\s+digital)?\s+discography\b/i.test(title);
    }

    function injectStyles() {
        const style = document.createElement("style");
        style.textContent = ENHANCEMENT_CSS;
        document.head.appendChild(style);
    }

    function storageGet(key, fallback) {
        if (canUseExternalHostMethod("storageGet")) {
            return Promise.resolve(
                getExternalHostApi().storageGet(key, fallback),
            ).catch(() => fallback);
        }

        try {
            if (typeof GM_getValue === "function") {
                return Promise.resolve(GM_getValue(key, fallback));
            }
        } catch (_error) {
            return Promise.resolve(fallback);
        }

        return Promise.resolve(fallback);
    }

    function storageGetByPrefix(prefix) {
        if (!prefix) {
            return Promise.resolve(null);
        }

        if (canUseExternalHostMethod("storageGetByPrefix")) {
            return Promise.resolve(
                getExternalHostApi().storageGetByPrefix(prefix),
            ).catch(() => null);
        }

        try {
            if (
                typeof GM_listValues === "function" &&
                typeof GM_getValue === "function"
            ) {
                const values = {};
                (GM_listValues() || []).forEach((key) => {
                    if (typeof key === "string" && key.startsWith(prefix)) {
                        values[key] = GM_getValue(key);
                    }
                });
                return Promise.resolve(values);
            }
        } catch (_error) {
            return Promise.resolve(null);
        }

        return Promise.resolve(null);
    }

    function storageSet(key, value) {
        if (canUseExternalHostMethod("storageSet")) {
            return Promise.resolve(
                getExternalHostApi().storageSet(key, value),
            ).catch(() => {});
        }

        try {
            if (typeof GM_setValue === "function") {
                return Promise.resolve(GM_setValue(key, value));
            }
        } catch (_error) {
            return Promise.resolve();
        }

        return Promise.resolve();
    }

    function storageDelete(key) {
        if (!key) {
            return Promise.resolve();
        }

        if (canUseExternalHostMethod("storageRemove")) {
            return Promise.resolve(
                getExternalHostApi().storageRemove(key),
            ).catch(() => {});
        }

        try {
            if (typeof GM_deleteValue === "function") {
                return Promise.resolve(GM_deleteValue(key));
            }
        } catch (_error) {
            return Promise.resolve();
        }

        return Promise.resolve();
    }

    // Per-release cache entries are only pruned when a new one is written:
    // expired entries first, then the oldest ones beyond the configured cap.
    // Without this the cache grows until the storage quota is exhausted.
    async function trackReleaseCacheEntry(cacheKey) {
        if (!cacheKey) {
            return;
        }

        const rawIndex = await storageGet(RELEASE_CACHE_INDEX_KEY, null);
        const index =
            rawIndex && typeof rawIndex === "object" ? { ...rawIndex } : {};
        index[cacheKey] = Date.now();

        const maxEntries = Math.max(
            0,
            Math.floor(Number(CONFIG.maxReleaseCacheEntries) || 0),
        );
        const maxAgeMs = Math.max(
            Number(CONFIG.cacheTtlMs) || 0,
            Number(CONFIG.supporterCountCacheTtlMs) || 0,
        );
        const now = Date.now();

        let entries = Object.entries(index).filter(([, fetchedAt]) => {
            const timestamp = Number(fetchedAt) || 0;
            return timestamp > 0 && (!maxAgeMs || now - timestamp <= maxAgeMs);
        });
        entries.sort((left, right) => Number(left[1]) - Number(right[1]));
        if (maxEntries && entries.length > maxEntries) {
            entries = entries.slice(entries.length - maxEntries);
        }

        const nextIndex = {};
        entries.forEach(([key, fetchedAt]) => {
            nextIndex[key] = fetchedAt;
        });

        const removedKeys = Object.keys(index).filter(
            (key) => !(key in nextIndex),
        );
        if (removedKeys.length) {
            await Promise.all(removedKeys.map((key) => storageDelete(key)));
        }

        await storageSet(RELEASE_CACHE_INDEX_KEY, nextIndex);
    }

    function markDebugState(name, value) {
        if (!document.documentElement || !name) {
            return;
        }

        document.documentElement.setAttribute(name, cleanText(value));
    }

    function incrementDebugCounter(name) {
        if (!document.documentElement || !name) {
            return;
        }

        const current = Number(
            document.documentElement.getAttribute(name) || "0",
        );
        document.documentElement.setAttribute(
            name,
            String(Number.isFinite(current) ? current + 1 : 1),
        );
    }

    // __BCAMPX_PLAYER__

    // __BCAMPX_TRACK_ACTIONS__

    // __BCAMPX_TAG_INDEX__

    // __BCAMPX_TEXT_FORMAT_UTILS__
})();
