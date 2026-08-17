
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
    };

    const CACHE_SCHEMA_VERSION = 17;
    const RELEASE_CACHE_PREFIX = "bcampx:release:";
    const RELEASE_SUPPORTER_COUNT_CACHE_PREFIX = "bcampx:releaseSupporters:";
    const USER_SETTINGS_KEY = "bcampx:userSettings";
    const ARTIST_MUSIC_VIEW_KEY = "bcampx:artistMusicView";
    const PLAYBACK_PAUSE_REQUEST_KEY = "bcampx:playbackPauseRequest";
    const OWNED_RELEASE_COLLECTION_SEARCH_KEY =
        "bcampx:ownedReleaseCollectionSearch";
    const PLAYBACK_PAUSE_POLL_MS = 1000;
    const PLAYBACK_PAUSE_STALE_MS = 10000;
    const PLAYER_WISHLIST_STATE_RETRY_MS = 30000;
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
        ".bcampx-label-feed-toggle",
        ".bcampx-label-feed-navbar-host",
        ".bcampx-player-audio",
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
        await buildArtistMusicFeed();
        setupFanCollectionTabObserver();
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
        STATE.playbackPauseMonitorTimer = window.setInterval(
            checkForPlaybackPauseRequest,
            PLAYBACK_PAUSE_POLL_MS,
        );
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
        };
    }

    async function persistUserSettings() {
        await storageSet(USER_SETTINGS_KEY, getSerializableUserSettings());
    }

    function setupSharedAudio() {
        if (STATE.sharedAudio) {
            return;
        }

        STATE.pageAudio =
            document.querySelector("body > audio") ||
            document.querySelector("audio") ||
            null;
        if (STATE.pageAudio) {
            isFeedEnhancerPage() && STATE.pageAudio.addEventListener(
                "play",
                suppressNativePageAudio,
                true,
            );
        }
        STATE.sharedAudio = document.createElement("audio");
        STATE.sharedAudio.preload = "metadata";
        STATE.sharedAudio.controls = true;
        addAudioEventListeners(STATE.sharedAudio, [
            "pause",
            "play",
            "ended",
        ], syncActiveTrackButton);
        STATE.sharedAudio.addEventListener("ended", handleSharedAudioEnded);
        STATE.sharedAudio.addEventListener("play", () =>
            announcePlaybackStart("feed-preview"),
        );
        addAudioEventListeners(STATE.sharedAudio, [
            "play",
            "pause",
            "ended",
        ], syncMediaSessionState);
        setupMediaSession();
    }

    function addAudioEventListeners(audio, eventNames, handler) {
        if (
            !(audio instanceof HTMLAudioElement) ||
            !Array.isArray(eventNames) ||
            typeof handler !== "function"
        ) {
            return;
        }

        eventNames.forEach((eventName) => {
            audio.addEventListener(eventName, handler);
        });
    }

    function handleDocumentAudioPlay(event) {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement)) {
            return;
        }

        if (audio === STATE.sharedAudio) {
            return;
        }

        if (isFeedEnhancerPage() && audio === STATE.pageAudio) {
            return;
        }

        announcePlaybackStart("bandcamp-native");
    }

    function handleSharedAudioEnded() {
        window.setTimeout(() => {
            void continuePlaybackAfterTrackEnd();
        }, 0);
    }

    function announcePlaybackStart(kind) {
        const startedAt = Date.now();
        STATE.lastPlaybackStartedAt = startedAt;
        void storageSet(PLAYBACK_PAUSE_REQUEST_KEY, {
            tabId: STATE.tabId,
            kind: kind || "bandcamp-native",
            pageUrl: window.location.href,
            ts: startedAt,
            nonce: Math.random().toString(36).slice(2, 10),
        });
    }

    function subscribeToPlaybackPauseRequests() {
        const host = getExternalHostApi();
        if (
            host &&
            typeof host.subscribeStorageKey === "function"
        ) {
            STATE.playbackPauseUnsubscribe = host.subscribeStorageKey(
                PLAYBACK_PAUSE_REQUEST_KEY,
                handlePlaybackPauseRequest,
            );
            return;
        }

        try {
            if (typeof GM_addValueChangeListener === "function") {
                const listenerId = GM_addValueChangeListener(
                    PLAYBACK_PAUSE_REQUEST_KEY,
                    (_key, _oldValue, newValue, remote) => {
                        if (remote !== false) {
                            handlePlaybackPauseRequest(newValue);
                        }
                    },
                );
                STATE.playbackPauseUnsubscribe = () => {
                    if (typeof GM_removeValueChangeListener === "function") {
                        GM_removeValueChangeListener(listenerId);
                    }
                };
            }
        } catch (_error) {}
    }

    async function checkForPlaybackPauseRequest() {
        const request = await storageGet(PLAYBACK_PAUSE_REQUEST_KEY, null);
        handlePlaybackPauseRequest(request);
    }

    function handlePlaybackPauseRequest(request) {
        if (!request || typeof request !== "object") {
            return;
        }

        if (!request.tabId || request.tabId === STATE.tabId) {
            return;
        }

        const requestTs = Number(request.ts) || 0;
        if (!requestTs) {
            return;
        }

        if (requestTs <= STATE.lastHandledPlaybackPauseRequestAt) {
            return;
        }

        if (Date.now() - requestTs > PLAYBACK_PAUSE_STALE_MS) {
            return;
        }

        STATE.lastHandledPlaybackPauseRequestAt = requestTs;
        if (
            STATE.lastPlaybackStartedAt &&
            requestTs < STATE.lastPlaybackStartedAt
        ) {
            return;
        }

        pauseLocalPlayback();
    }

    function pauseLocalPlayback() {
        const activeAudios = getLocalActiveAudios();
        activeAudios.forEach((audio) => {
            if (typeof audio.pause === "function") {
                audio.pause();
            }
        });

        clearActiveTrackButton();
        syncPlayerShell();
    }

    function getLocalActiveAudios() {
        const audios = [];

        if (STATE.sharedAudio && !STATE.sharedAudio.paused) {
            audios.push(STATE.sharedAudio);
        }

        document.querySelectorAll("audio").forEach((audio) => {
            if (!(audio instanceof HTMLAudioElement) || audio.paused) {
                return;
            }

            if (!audios.includes(audio)) {
                audios.push(audio);
            }
        });

        return audios;
    }

    function setupNativePlaybackInterception() {
        window.addEventListener(
            "pointerdown",
            handleCollectionGridPointerDown,
            true,
        );
        window.addEventListener(
            "click",
            handleNativePlaybackTriggerClick,
            true,
        );
        markDebugState("data-bcampx-native-playback-listener", "ready");
    }

    function handleCollectionGridPointerDown(event) {
        if (event.button !== 0) {
            return;
        }

        const trigger = findNativePlaybackTrigger(event.target);
        const card = findCollectionGridCard(trigger);
        if (!card || isFullDiscographyCard(card)) {
            return;
        }

        const releaseUrl = getCardPrimaryReleaseUrl(card);
        if (!releaseUrl) {
            return;
        }

        STATE.collectionPointerReleaseUrl = normalizeReleaseUrl(releaseUrl);
        STATE.collectionPointerHandledAt = Date.now();
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }

        markDebugState(
            "data-bcampx-collection-playback-state",
            "pointer-triggered",
        );
        void playCollectionGridTrigger(card, trigger, releaseUrl);
    }

    function setupPlayerMenuDismissal() {
        document.addEventListener("click", handleDocumentPlayerUiClick, true);
        document.addEventListener("keydown", handleDocumentPlayerUiKeydown, true);
    }

    function handleDocumentPlayerUiClick(event) {
        if (!STATE.playerSettingsOpen) {
            return;
        }

        if (!STATE.playerHost || !document.contains(STATE.playerHost)) {
            closePlayerSettingsMenu();
            return;
        }

        const path =
            typeof event.composedPath === "function" ? event.composedPath() : [];
        if (isPlayerSettingsInteraction(path)) {
            return;
        }

        closePlayerSettingsMenu();
    }

    function isPlayerSettingsInteraction(path) {
        const ui = STATE.playerUi;
        if (!ui) {
            return false;
        }

        return Boolean(
            (ui.settingsWrap && path.includes(ui.settingsWrap)) ||
                (ui.settingsButton && path.includes(ui.settingsButton)) ||
                (ui.settingsMenu && path.includes(ui.settingsMenu)),
        );
    }

    function handleDocumentPlayerUiKeydown(event) {
        if (event.key !== "Escape" || !STATE.playerSettingsOpen) {
            return;
        }

        closePlayerSettingsMenu();
    }

    function handleNativePlaybackTriggerClick(event) {
        const trigger = findNativePlaybackTrigger(event.target);
        if (!trigger) {
            return;
        }

        const collectionCard = findCollectionGridCard(trigger);
        const card = collectionCard || findPlaybackCard(trigger);
        if (
            !card ||
            isFullDiscographyCard(card) ||
            isMalformedFeedCard(card) ||
            card.closest("#sidebar")
        ) {
            return;
        }

        const releaseUrl = getCardPrimaryReleaseUrl(card);
        if (!releaseUrl) {
            return;
        }

        if (
            collectionCard &&
            normalizeReleaseUrl(releaseUrl) ===
                STATE.collectionPointerReleaseUrl &&
            Date.now() - STATE.collectionPointerHandledAt < 1000
        ) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            }
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }

        if (collectionCard) {
            markDebugState("data-bcampx-collection-playback-state", "triggered");
            void playCollectionGridTrigger(collectionCard, trigger, releaseUrl);
            return;
        }

        playNativeCardTrigger(card, trigger, releaseUrl);
    }

    function findNativePlaybackTrigger(node) {
        if (!node || typeof node.closest !== "function") {
            return null;
        }

        return node.closest(
            ".track_play_auxiliary, .tralbum-art-container, .track_play_time",
        );
    }

    function findCollectionGridCard(node) {
        if (!node || typeof node.closest !== "function") {
            return null;
        }

        const card = node.closest(".collection-grid .collection-item-container");
        return card instanceof Element ? card : null;
    }

    async function playCollectionGridTrigger(card, trigger, releaseUrl) {
        if (
            isActiveReleaseForCard(releaseUrl) &&
            STATE.activePlaybackScope === "collection-grid" &&
            STATE.activeTrack &&
            STATE.activeTrack.streamUrl
        ) {
            toggleActiveReleasePlayback(card);
            return;
        }

        try {
            const preview = getCollectionGridFeaturedPreview(card);
            if (preview) {
                markDebugState(
                    "data-bcampx-collection-playback-state",
                    "preview-playing",
                );
                playTrackForCard(
                    card,
                    null,
                    preview.track,
                    preview.data,
                    releaseUrl,
                    {
                        playbackScope: "collection-grid",
                        trackList: [preview.track],
                        onPlayError: () =>
                            retryCollectionGridPlaybackWithoutPreview(
                                card,
                                trigger,
                                releaseUrl,
                            ),
                    },
                );
                observeCollectionCoverState();
                return;
            }

            markDebugState("data-bcampx-collection-playback-state", "fetching");
            const audio = ensureSharedAudio();
            if (audio && !audio.paused) {
                audio.pause();
            }
            STATE.activePlaybackScope = "collection-grid";
            setActiveTrackCard(card);
            syncCoverPlaybackState();
            observeCollectionCoverState();
            const data = await getAvailableOrFetchReleaseDataForCard(
                card,
                releaseUrl,
            );
            const track = findFeaturedTrackForCard(card, trigger, data);
            if (!track || !track.streamUrl) {
                markDebugState(
                    "data-bcampx-collection-playback-state",
                    "missing-featured-track",
                );
                return;
            }

            markDebugState("data-bcampx-collection-playback-state", "playing");
            playTrackForCard(card, null, track, data, releaseUrl, {
                playbackScope: "collection-grid",
                trackList: [track],
            });
            observeCollectionCoverState();
        } catch (_error) {
            markDebugState("data-bcampx-collection-playback-state", "error");
        }
    }

    async function retryCollectionGridPlaybackWithoutPreview(
        card,
        trigger,
        releaseUrl,
    ) {
        const memo = getNodeMemo(card);
        if (memo) {
            memo.collectionGridFeaturedPreview = null;
        }

        const data = await getAvailableOrFetchReleaseDataForCard(
            card,
            releaseUrl,
        );
        const track = findFeaturedTrackForCard(card, trigger, data);
        if (!track || !track.streamUrl) {
            return;
        }

        playTrackForCard(card, null, track, data, releaseUrl, {
            playbackScope: "collection-grid",
            trackList: [track],
        });
        observeCollectionCoverState();
    }

    async function playNativeCardTrigger(card, trigger, releaseUrl) {
        const controller = ensureCardController(card, releaseUrl);
        if (!controller) {
            return;
        }

        if (
            isActiveReleaseForCard(releaseUrl) &&
            STATE.activeTrack &&
            STATE.activeTrack.streamUrl
        ) {
            toggleActiveReleasePlayback(card);
            return;
        }

        try {
            if (
                (!controller.data ||
                    !Array.isArray(controller.data.tracks) ||
                    !controller.data.tracks.length) &&
                !controller.loading
            ) {
                if (isOwnFanTrackCard(card)) {
                    // Own collection tracks never auto-fetch. Nothing to play yet.
                    return;
                }
                await controller.fetchAndRender({ auto: false });
            }
        } catch (_error) {
            return;
        }

        const data = controller.data;
        const track = findFeaturedTrackForCard(card, trigger, data);
        if (!track || !track.streamUrl) {
            if (isOwnFanTrackCard(card)) {
                const fallbackTrack =
                    data &&
                    Array.isArray(data.tracks) &&
                    data.tracks[0];
                if (fallbackTrack) {
                    await playOwnFanTrackAfterLoadingStream(
                        trigger,
                        fallbackTrack,
                        data,
                        releaseUrl,
                        card,
                    );
                }
            }
            return;
        }

        playTrackForCard(card, trigger, track, data, releaseUrl);
    }

    function isActiveReleaseForCard(releaseUrl) {
        const normalizedTarget = normalizeReleaseUrl(releaseUrl);
        const normalizedActive = normalizeReleaseUrl(
            STATE.activeReleaseUrl || "",
        );
        return Boolean(
            normalizedTarget &&
            normalizedActive &&
            normalizedTarget === normalizedActive,
        );
    }

    function toggleActiveReleasePlayback(card) {
        const audio = ensureSharedAudio();
        if (!audio || !STATE.activeTrack || !STATE.activeTrack.streamUrl) {
            return;
        }

        const cardArtUrl = getActiveCardArtUrl(card);
        setActiveTrackCard(card);

        if (cardArtUrl) {
            STATE.activeCardArtUrl = cardArtUrl;
        }

        if (!audio.paused) {
            audio.pause();
            scheduleUiSync(cardArtUrl);
            return;
        }

        pauseBandcampPageAudio();
        syncActiveTrackUi(cardArtUrl);
        audio.play().catch(() => {});
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

    function suppressNativePageAudio() {
        if (
            STATE.pageAudio &&
            STATE.pageAudio !== STATE.sharedAudio &&
            typeof STATE.pageAudio.pause === "function"
        ) {
            STATE.pageAudio.pause();
        }
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

            const formatItem = event.target.closest(".buyItem");
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

                if (document.querySelector(".ui-dialog")) {
                    setTimeout(() => waitForDialog(tries + 1), 150);
                }
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
                ".collection-search input",
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

    function tryHandleEmbeddedTrackActionHelper() {
        const helperParams = parseTrackActionHelperParams(window.location.hash);
        if (!helperParams) {
            return false;
        }

        if (helperParams.action === "buy-dialog") {
            scheduleTrackActionHelperInit(runTrackBuyDialogHelper);
            return true;
        }

        if (!helperParams.requestId || !helperParams.parentOrigin) {
            return false;
        }

        scheduleTrackActionHelperInit(() => {
            runTrackActionHelper(helperParams);
        });
        return true;
    }

    function parseTrackActionHelperParams(hashValue) {
        const hash = cleanText(hashValue).replace(/^#/, "");
        if (!hash) {
            return null;
        }

        const params = new URLSearchParams(hash);
        const action = cleanText(params.get("bcampx-helper"));
        if (!action) {
            return null;
        }

        return {
            action,
            requestId: cleanText(params.get("bcampx-request")),
            parentOrigin: cleanText(params.get("bcampx-parent-origin")),
        };
    }

    function scheduleTrackActionHelperInit(callback) {
        window.setTimeout(() => {
            if (typeof callback === "function") {
                callback();
            }
        }, 250);
    }

    function getDocumentInsertionRoot() {
        return (
            document.body ||
            document.documentElement ||
            document.head ||
            null
        );
    }

    function appendToDocument(node) {
        const root = getDocumentInsertionRoot();
        if (!root || !node) {
            return false;
        }

        root.appendChild(node);
        return true;
    }

    function prependToContainer(container, node) {
        if (!container || !node) {
            return false;
        }

        if (typeof container.prepend === "function") {
            container.prepend(node);
            return true;
        }

        container.insertBefore(node, container.firstChild || null);
        return true;
    }

    function scheduleNextFrame(callback) {
        if (typeof callback !== "function") {
            return 0;
        }

        if (typeof window.requestAnimationFrame === "function") {
            return window.requestAnimationFrame(callback);
        }

        return window.setTimeout(callback, 16);
    }

    function clearTrackActionHelperHash() {
        try {
            if (
                window.history &&
                typeof window.history.replaceState === "function"
            ) {
                window.history.replaceState(
                    null,
                    document.title,
                    window.location.pathname + window.location.search,
                );
            }
        } catch (_error) {}
    }

    async function runTrackBuyDialogHelper() {
        clearTrackActionHelperHash();

        // Helper page skips normal init, load settings manually
        await loadUserSettings();

        const getKnownPrice = () => {
            const buyItem = document.querySelector(
                ".buyItem.digital, .you-own-this.digital",
            );
            if (!buyItem) {
                return "";
            }

            const fullText = cleanText(buyItem.textContent || "");
            if (/name your price|free download|you own this/i.test(fullText)) {
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
        };

        const openBuyDialog = () => {
            const buyButton = Array.from(
                document.querySelectorAll("button.download-link.buy-link"),
            ).find((node) =>
                /(?:buy|pre-order)\s+digital\s+(?:album|track)|free download/i.test(
                    (node.textContent || "").trim(),
                ),
            );
            if (!buyButton) {
                return "";
            }

            const buttonText = cleanText(buyButton.textContent || "");
            buyButton.click();
            return buttonText;
        };

        const focusPriceInput = () => {
            const priceInput = document.querySelector("#userPrice");
            if (!priceInput) {
                return false;
            }
            try {
               const knownPrice = CONFIG.autoFillMinimumPrice ? getKnownPrice() : "";
              if (knownPrice) {
                    priceInput.value = knownPrice;
                    priceInput.dispatchEvent(new Event("input", { bubbles: true }));
                    priceInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
            } catch (_error) {}

            try {
                priceInput.focus();
                if (typeof priceInput.select === "function") {
                    priceInput.select();
                }
            } catch (_error) {}

            return true;
        };

        let attempts = 0;
        const maxAttempts = 40;
        const tick = () => {
            attempts += 1;
            if (document.querySelector(".ui-dialog #userPrice")) {
                focusPriceInput();
                return;
            }

            if (document.querySelector(".ui-dialog")) {
                return;
            }

            const openedButtonText = openBuyDialog();
            if (/free download/i.test(openedButtonText)) {
                return;
            }
            if (attempts >= maxAttempts) {
                return;
            }
            window.setTimeout(tick, 250);
        };

        tick();
    }

    function runTrackActionHelper({
        action,
        requestId,
        parentOrigin,
    }) {
        clearTrackActionHelperHash();
        const helperTarget =
            window.parent && window.parent !== window
                ? window.parent
                : window.opener && !window.opener.closed
                  ? window.opener
                  : null;
        const isTopLevelHelper = window.top === window;

        const send = (payload) => {
            if (!helperTarget) {
                return;
            }

            try {
                helperTarget.postMessage(
                    Object.assign(
                        {
                            type: "bcampx-track-action-result",
                            action,
                            requestId,
                        },
                        payload || {},
                    ),
                    parentOrigin || "*",
                );
            } catch (_error) {
                try {
                    helperTarget.postMessage(
                        Object.assign(
                            {
                                type: "bcampx-track-action-result",
                                action,
                                requestId,
                                ok: false,
                                error: "Could not reach parent window.",
                            },
                            payload || {},
                        ),
                        "*",
                    );
                } catch (_nestedError) {}
            }
        };

        const renderHelperStatus = (message, tone = "info") => {
            if (!isTopLevelHelper || !document.body) {
                return;
            }

            const existing = document.querySelector(".bcampx__helper-status");
            if (existing) {
                existing.remove();
            }

            const banner = document.createElement("div");
            banner.className = "bcampx__helper-status";
            banner.setAttribute("data-tone", tone);
            banner.textContent = message;
            banner.style.position = "sticky";
            banner.style.top = "0";
            banner.style.zIndex = "2147483647";
            banner.style.padding = "12px 16px";
            banner.style.font = "600 14px/1.4 system-ui, -apple-system, sans-serif";
            banner.style.color = tone === "error" ? "#7f1d1d" : "#0f5132";
            banner.style.background = tone === "error" ? "#fee2e2" : "#dcfce7";
            banner.style.borderBottom = `1px solid ${tone === "error" ? "#fecaca" : "#86efac"}`;
            prependToContainer(document.body || document.documentElement, banner);
        };

        const finishTopLevelHelper = (message, tone = "info") => {
            if (!isTopLevelHelper) {
                return;
            }

            renderHelperStatus(message, tone);
            if (window.opener && !window.opener.closed && tone !== "error") {
                window.setTimeout(() => {
                    try {
                        window.close();
                    } catch (_error) {}
                }, 900);
            }
        };

        const readJsonAttr = (selector, attr) => {
            const node = document.querySelector(selector);
            if (!node) {
                return null;
            }

            try {
                return JSON.parse(node.getAttribute(attr) || "null");
            } catch (_error) {
                return null;
            }
        };

        const collectInfo =
            readJsonAttr(
                "[data-tralbum-collect-info]",
                "data-tralbum-collect-info",
            ) || {};
        const tralbumData =
            readJsonAttr("[data-tralbum]", "data-tralbum") || {};
        const crumbs = readJsonAttr("#js-crumbs-data", "data-crumbs") || {};
        const pagedataBlob = (() => {
            try {
                return JSON.parse(
                    document.querySelector("#pagedata")?.dataset?.blob || "{}",
                );
            } catch (_error) {
                return {};
            }
        })();

        if (action === "wishlist-state") {
            const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
            const isWishlisted =
                !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
            const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
            const itemId =
                tralbumData.current?.id || collectInfo.collect_item_id || "";
            const bandId =
                tralbumData.current?.band_id ||
                collectInfo.collect_band_id ||
                "";
            send({
                ok: true,
                active: isWishlisted,
                canToggle: Boolean(fanId && itemId && bandId),
            });
            return;
        }

        if (action === "wishlist") {
            const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
            const isWishlisted =
                !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
            const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
            const crumbKey = isWishlisted
                ? "uncollect_item_cb"
                : "collect_item_cb";
            const crumb =
                typeof crumbs[crumbKey] === "string" ? crumbs[crumbKey] : "";
            if (!fanId) {
                send({
                    ok: false,
                    error: "Sign in to Bandcamp before using wishlist actions.",
                });
                return;
            }
            if (!crumb) {
                send({
                    ok: false,
                    error:
                        "This Bandcamp tab looks out of date. Refresh the release page and try again.",
                });
                return;
            }

            const endpoint = isWishlisted
                ? "/uncollect_item_cb"
                : "/collect_item_cb";
            const payload = new URLSearchParams();
            payload.set("fan_id", String(fanId));
            payload.set(
                "item_id",
                String(
                    tralbumData.current?.id || collectInfo.collect_item_id || "",
                ),
            );
            payload.set(
                "item_type",
                String(
                    (
                        tralbumData.current?.type ||
                        collectInfo.collect_item_type ||
                        "track"
                    )
                        .replace(/^t$/i, "track")
                        .replace(/^a$/i, "album")
                        .replace(/^b$/i, "bundle"),
                ),
            );
            payload.set(
                "band_id",
                String(
                    tralbumData.current?.band_id ||
                        collectInfo.collect_band_id ||
                        "",
                ),
            );
            payload.set("crumb", crumb);

            const onSuccess = (body) => {
                if (!body || body.ok !== true) {
                    throw new Error(
                        body && body.error_message
                            ? body.error_message
                            : "Wishlist request failed.",
                    );
                }

                send({
                    ok: true,
                    active: !isWishlisted,
                    statusText: !isWishlisted ? "Saved" : "Removed",
                });
                finishTopLevelHelper(
                    !isWishlisted
                        ? "Saved to your Bandcamp wishlist."
                        : "Removed from your Bandcamp wishlist.",
                );
            };

            fetch(location.origin + endpoint, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: payload.toString(),
            })
                .then(async (response) => {
                    let body = null;
                    try {
                        body = await response.json();
                    } catch (_error) {
                        body = null;
                    }

                    if (!response.ok) {
                        throw new Error(
                            (body && body.error_message) ||
                                "Wishlist request failed.",
                        );
                    }

                    onSuccess(body);
                })
                .catch((error) => {
                    send({
                        ok: false,
                        error:
                            error && error.message
                                ? error.message
                                : "Wishlist request failed.",
                    });
                    finishTopLevelHelper(
                        error && error.message
                            ? error.message
                            : "Wishlist request failed.",
                        "error",
                    );
                });
            return;
        }

        if (action !== "basket") {
            send({ ok: false, error: "Unknown track action." });
            return;
        }

        send({ ok: false, error: "Basket helper is disabled." });
    }

    function getExternalHostApi() {
        const host = globalThis.__BCAMPX_HOST__;
        if (!host || typeof host !== "object") {
            return null;
        }

        return host;
    }

    function canUseExternalHostMethod(methodName) {
        const host = getExternalHostApi();
        return !!(host && typeof host[methodName] === "function");
    }

    function isWebExtensionHost() {
        const host = getExternalHostApi();
        return !!(host && host.kind === "webextension");
    }

    function isCustomDomainReleaseUrl(rawUrl) {
        const releaseUrl = normalizeReleaseUrl(rawUrl || "");
        return !!(releaseUrl && !isBandcampReleaseUrl(releaseUrl));
    }

    function hasExtensionHostPermission(rawUrl) {
        const releaseUrl = normalizeReleaseUrl(rawUrl || "");
        if (!releaseUrl || !isWebExtensionHost()) {
            return false;
        }

        const host = getExternalHostApi();
        return !!(
            host &&
            typeof host.hasHostPermission === "function" &&
            host.hasHostPermission(releaseUrl)
        );
    }

    function getHostRequestOptions(baseOptions = {}) {
        return {
            method: baseOptions.method || "GET",
            data: baseOptions.data,
            headers: baseOptions.headers,
            credentials: baseOptions.credentials,
            timeoutMs: CONFIG.fetchTimeoutMs,
        };
    }

    function setupTrackActionMessageBridge() {
        if (STATE.trackActionBridgeInitialized) {
            return;
        }

        STATE.trackActionBridgeInitialized = true;
        window.addEventListener("message", handleTrackActionMessage);
    }

    function handleTrackActionMessage(event) {
        const data = event && event.data;
        if (!data || !data.type) {
            return;
        }

        if (data.type !== "bcampx-track-action-result") {
            return;
        }

        const pending = STATE.pendingTrackActionRequests.get(data.requestId);
        if (!pending) {
            return;
        }

        if (event.origin && pending.origin && event.origin !== pending.origin) {
            recordTrackActionDiagnostic("message-origin-mismatch", {
                action: pending.action,
                expectedOrigin: pending.origin,
                actualOrigin: event.origin,
            });
            return;
        }

        if (data.ok) {
            completeTrackActionRequest(pending, data.requestId, data);
            return;
        }

        recordTrackActionDiagnostic("action-failed", {
            action: pending.action,
            origin: pending.origin,
            error: data.error || "Track action failed.",
        });
        failTrackActionRequest(
            pending,
            data.requestId,
            new Error(data.error || "Track action failed."),
        );
    }

    function finalizePendingTrackActionRequest(requestId) {
        const pending = STATE.pendingTrackActionRequests.get(requestId);
        if (!pending) {
            return null;
        }

        STATE.pendingTrackActionRequests.delete(requestId);
        window.clearTimeout(pending.timeoutId);
        if (pending.iframe && pending.iframe.parentNode) {
            pending.iframe.remove();
        }
        return pending;
    }

    function recordTrackActionDiagnostic(code, details = {}) {
        STATE.lastTrackActionDiagnostic = {
            code,
            details,
            at: Date.now(),
        };
    }

    function completeTrackActionRequest(pending, requestId, result) {
        finalizePendingTrackActionRequest(requestId);
        if (pending.action === "wishlist-state") {
            pending.resolve(result);
            return;
        }

        if (pending.button && pending.button.classList.contains("bcampx-player-favorite")) {
            const active =
                result && Object.prototype.hasOwnProperty.call(result, "active")
                    ? Boolean(result.active)
                    : Boolean(pending.desiredActive);
            const releaseUrl = normalizeReleaseUrl(pending.trackUrl || "");
            if (releaseUrl) {
                STATE.playerWishlistStateByUrl.set(releaseUrl, {
                    status: "known",
                    active,
                    canToggle: true,
                    checkedAt: Date.now(),
                });
                STATE.playerWishlistActionRequests.delete(releaseUrl);
                clearPlayerWishlistStateRetry(releaseUrl);
            }
            if (
                releaseUrl &&
                releaseUrl === normalizeReleaseUrl(STATE.activeReleaseUrl || "")
            ) {
                setFavoriteButtonState(pending.button, active);
            }
            syncFavoriteButtonState();
        } else {
            setTrackActionButtonPending(pending.button, false);
            flashTrackActionButton(
                pending.button,
                result && result.statusText ? result.statusText : "Done",
            );
        }
        pending.resolve(result);
    }

    function failTrackActionRequest(pending, requestId, error, flashLabel = "Error") {
        finalizePendingTrackActionRequest(requestId);
        if (pending.action !== "wishlist-state") {
            if (
                pending.button &&
                pending.button.classList.contains("bcampx-player-favorite")
            ) {
                STATE.playerWishlistActionRequests.delete(
                    normalizeReleaseUrl(pending.trackUrl || ""),
                );
                syncFavoriteButtonState();
                pending.reject(error);
                return;
            }
            setTrackActionButtonPending(pending.button, false);
            flashTrackActionButton(pending.button, flashLabel);
        }
        pending.reject(error);
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
                        queueAutoFetch(controller);
                    }
                });
            },
            { rootMargin: CONFIG.observerRootMargin },
        );
    }

    function queueAutoFetch(controller) {
        if (
            !controller ||
            controller.loaded ||
            controller.loading ||
            controller.autoFetchQueued ||
            isOwnFanTrackCard(controller.card)
        ) {
            return;
        }

        controller.autoFetchQueued = true;
        applyReleaseShellLoadingState(controller);
        STATE.autoFetchQueue.push({
            controller,
            sequence: ++STATE.autoFetchSequence,
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
            const distance = getAutoFetchViewportDistance(
                entry && entry.controller && entry.controller.card,
            );
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

    function getAutoFetchViewportDistance(card) {
        if (!(card instanceof Element) || !card.isConnected) {
            return Infinity;
        }

        const rect = card.getBoundingClientRect();
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

                    if (hasArtistMusicSourceGridMutationNode(node)) {
                        shouldSyncReleaseGridFeed = true;
                    }

                    if (isBcampxInternalMutationNode(node)) {
                        return;
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
                mutations.some(hasFanCollectionContextMutation) &&
                isBandcampFanCollectionPageUrl(window.location.href)
            ) {
                setupFanCollectionTabObserver();
                scheduleFanCollectionFeedContextSync();
            }

            if (shouldFullScan) {
                scheduleScan();
            }
        });

        STATE.mutationObserver.observe(document.body, {
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
        });
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
        const roots = getScanRoots();
        const scannableCards = [];

        getStoryCardsFromRoots(roots).forEach((card) => {
            const classification = classifyStoryCard(card);
            if (classification === "enhance") {
                scannableCards.push(card);
            }
        });

        enhanceScannableCards(scannableCards);
        mergeAdjacentTrackPurchaseCards();
    }

    function classifyStoryCard(card) {
        if (!(card instanceof Element)) {
            return "ignore";
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
        setCardController(card, null);
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

        invalidateNodeMemoCache();
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

    function mergeAdjacentTrackPurchaseCards() {
        let previousCandidate = null;

        getStoryCardsFromRoots([document]).forEach((card) => {
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

    function getMergedTrackTitles(card) {
        return ensureMergedTrackState(card).titles;
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
            const block = nearestAncestorWithin(releaseLink, card, (node) => {
                const rect = node.getBoundingClientRect();
                return (
                    rect.width > 0 &&
                    rect.width < card.getBoundingClientRect().width * 0.82
                );
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

    function findExplicitSupportedSlot(card) {
        return card.querySelector(SUPPORTED_SLOT_SELECTOR);
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

        try {
            const result = await getReleaseData(
                controller.releaseRequestContext || releaseUrl,
            );
            const normalizedData = getRenderableReleaseData(
                controller,
                result,
            );
            controller.loaded = true;
            controller.data = normalizedData;
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
            if (shouldAbandonReleaseEnhancement(error)) {
                controller.loaded = true;
                controller.data = createEmptyReleaseData();
                renderEmpty(meta, text, releaseUrl, {
                    message: "Extra metadata is unavailable for this release.",
                    summary: "No extra context available",
                });
            } else {
                controller.loaded = false;
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

                const normalizedData = getRenderableReleaseData(
                    controller,
                    result,
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
            .catch(() => {
                if (controller.refreshPromise !== refreshPromise) {
                    return;
                }
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
        buyLink.textContent = actionText;

        buyLink.addEventListener("click", (event) => {
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
        });
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

    function createTrackActionButtons(trackActionUrl) {
        const actions = createClassedElement("div", "bcampx__track-actions");

        actions.append(
            createTrackActionButton(
                "buy",
                "Add this track to basket",
                (event, button) => {
                    event.preventDefault();
                    event.stopPropagation();
                    executeTrackAction("basket", trackActionUrl, button);
                },
            ),
            createTrackActionButton(
                "wish",
                "Add or remove this track from wishlist",
                (event, button) => {
                    event.preventDefault();
                    event.stopPropagation();
                    executeTrackAction("wishlist", trackActionUrl, button);
                },
            ),
        );

        return actions;
    }

    function createTrackActionButton(label, title, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bcampx__track-action";
        button.textContent = label;
        button.title = title;
        button.addEventListener("click", (event) => onClick(event, button));
        return button;
    }

    function refreshRenderedTrackActionButtons() {
        document.querySelectorAll(".bcampx__track-end").forEach((end) => {
            const trackActionUrl =
                end instanceof HTMLElement
                    ? cleanText(end.dataset.trackActionUrl || "")
                    : "";
            const existingActions = end.querySelector(".bcampx__track-actions");

            if (!CONFIG.enableTrackRowActions) {
                if (existingActions) {
                    existingActions.remove();
                }
                end.classList.remove("bcampx__track-end--has-actions");
                return;
            }

            if (!trackActionUrl) {
                end.classList.remove("bcampx__track-end--has-actions");
                return;
            }

            if (existingActions) {
                end.classList.add("bcampx__track-end--has-actions");
                return;
            }

            end.append(createTrackActionButtons(trackActionUrl));
            end.classList.add("bcampx__track-end--has-actions");
        });
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

    function createPlayerButton({
        text = "",
        className = "",
        iconName = "",
        ariaLabel = "",
        ariaPressed = "",
        ariaHaspopup = "",
        onClick = null,
    }) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className || "bcampx-player-button";

        if (iconName) {
            button.appendChild(createPlayerIcon(iconName));
        } else {
            button.textContent = text;
        }

        if (ariaLabel) {
            button.setAttribute("aria-label", ariaLabel);
        }
        if (ariaPressed) {
            button.setAttribute("aria-pressed", ariaPressed);
        }
        if (ariaHaspopup) {
            button.setAttribute("aria-haspopup", ariaHaspopup);
        }
        if (typeof onClick === "function") {
            button.addEventListener("click", onClick);
        }

        return button;
    }

    function playSharedTrack(button, track, data, releaseUrl) {
        playTrackForCard(
            findPlaybackCard(button),
            button,
            track,
            data,
            releaseUrl,
        );
    }

    async function playMergedTrackTitle(card, trackTitle, button) {
        if (!card || !trackTitle || !button) {
            return;
        }

        const releaseUrl = getCardPrimaryReleaseUrl(card);
        if (!releaseUrl) {
            return;
        }

        button.disabled = true;
        try {
            const availableData = getAvailableReleaseDataForCard(
                card,
                releaseUrl,
            );
            const data =
                availableData ||
                (await getReleaseData(
                    getCardReleaseRequestContext(card, releaseUrl),
                )).data;
            const track = findPlayableTrackByTitle(data, trackTitle);
            if (!track || !track.streamUrl) {
                return;
            }

            button.dataset.streamUrl = track.streamUrl || "";
            button.dataset.trackId = track.trackId || "";
            playTrackForCard(card, button, track, data, releaseUrl);
        } finally {
            button.disabled = false;
        }
    }

    function getAvailableReleaseDataForCard(card, releaseUrl) {
        const controller = getCardController(card);
        const controllerData = controller && controller.data;
        if (
            controllerData &&
            Array.isArray(controllerData.tracks) &&
            controllerData.tracks.length
        ) {
            return controllerData;
        }

        const normalizedTarget = normalizeReleaseUrl(releaseUrl);
        const normalizedActive = normalizeReleaseUrl(
            STATE.activeReleaseUrl || "",
        );
        if (
            STATE.activeReleaseData &&
            normalizedTarget &&
            normalizedActive &&
            normalizedTarget === normalizedActive &&
            Array.isArray(STATE.activeReleaseData.tracks) &&
            STATE.activeReleaseData.tracks.length
        ) {
            return STATE.activeReleaseData;
        }

        return null;
    }

    function findPlayableTrackByTitle(data, trackTitle) {
        const normalizedTarget = cleanText(trackTitle).toLowerCase();
        const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
        if (!normalizedTarget || !tracks.length) {
            return null;
        }

        const exactMatch = tracks.find(
            (track) =>
                cleanText(track && track.title).toLowerCase() ===
                    normalizedTarget && track.streamUrl,
        );
        if (exactMatch) {
            return exactMatch;
        }

        const inclusiveMatch = tracks.find((track) => {
            const normalizedTitle = cleanText(
                track && track.title,
            ).toLowerCase();
            return (
                normalizedTitle &&
                (normalizedTitle.includes(normalizedTarget) ||
                    normalizedTarget.includes(normalizedTitle)) &&
                track.streamUrl
            );
        });
        if (inclusiveMatch) {
            return inclusiveMatch;
        }

        return null;
    }

    function resolveTrackActionUrl(track, releaseUrl) {
        const titleLink = cleanText(track && track.titleLink);
        if (titleLink) {
            try {
                return new URL(titleLink, releaseUrl).href;
            } catch (_error) {
                return "";
            }
        }

        return /\/track\//.test(releaseUrl) ? releaseUrl : "";
    }

    async function executeTrackAction(action, trackUrl, button) {
        if (!trackUrl || !button) {
            return;
        }

        setTrackActionButtonPending(button, true);
        try {
            if (action === "wishlist") {
                await requestTrackActionViaHelper(action, trackUrl, button);
                return;
            }

            if (action === "basket") {
                const opened = openTrackBuyWindow(trackUrl);
                setTrackActionButtonPending(button, false);
                flashTrackActionButton(button, opened ? "Opened" : "Blocked");
                return;
            }

            throw new Error("Track action is disabled.");
        } catch (_error) {
            setTrackActionButtonPending(button, false);
            flashTrackActionButton(button, "Error");
        }
    }

    function requestTrackActionViaHelper(action, trackUrl, button, options = {}) {
        setupTrackActionMessageBridge();

        return new Promise((resolve, reject) => {
            const request = createTrackActionRequestContext({
                action,
                trackUrl,
                button,
                desiredActive: options.desiredActive,
                resolve,
                reject,
            });
            if (!request) {
                reject(new Error("Invalid track URL."));
                return;
            }

            request.timeoutId = scheduleTrackActionTimeout(request);
            attachTrackActionIframeErrorHandler(request.iframe, request);
            registerPendingTrackActionRequest(request);
            request.iframe.src = request.helperUrl;
            appendToDocument(request.iframe);
        });
    }

    function openTrackBuyWindow(trackUrl) {
        const helperUrl = buildTrackActionHelperUrl(trackUrl, "buy-dialog");
        const openedWindow = openTrackActionWindow(helperUrl);
        return Boolean(openedWindow && !openedWindow.closed);
    }

    function openTrackActionWindow(helperUrl) {
        const openedWindow = window.open(helperUrl, "_blank");
        if (openedWindow && !openedWindow.closed) {
            try {
                openedWindow.opener = null;
            } catch (_error) {}
        }
        return openedWindow;
    }

    function getTrackActionOrigin(trackUrl) {
        try {
            return new URL(trackUrl).origin;
        } catch (_error) {
            return "";
        }
    }

    function createTrackActionRequestId() {
        return `bcampx-track-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function createTrackActionIframe() {
        const iframe = document.createElement("iframe");
        iframe.className = "bcampx__track-action-frame";
        iframe.setAttribute("aria-hidden", "true");
        return iframe;
    }

    function createTrackActionRequestContext({
        action,
        trackUrl,
        button,
        desiredActive,
        resolve,
        reject,
    }) {
        const origin = getTrackActionOrigin(trackUrl);
        if (!origin) {
            return null;
        }

        const requestId = createTrackActionRequestId();
        const iframe = createTrackActionIframe();
        return {
            requestId,
            action,
            button,
            iframe,
            origin,
            trackUrl,
            desiredActive,
            helperUrl: buildTrackActionHelperUrl(trackUrl, action, requestId),
            timeoutId: 0,
            fallbackAttempted: false,
            resolve,
            reject,
        };
    }

    function buildTrackActionHelperUrl(
        trackUrl,
        action,
        requestId = "",
        parentOrigin = window.location.origin,
    ) {
        try {
            const url = new URL(trackUrl);
            const hash = new URLSearchParams({
                "bcampx-helper": action,
                ...(requestId ? { "bcampx-request": requestId } : {}),
                ...(requestId ? { "bcampx-parent-origin": parentOrigin } : {}),
            }).toString();
            url.hash = hash;
            return url.href;
        } catch (_error) {
            return trackUrl;
        }
    }

    function scheduleTrackActionTimeout(pending, timeoutMs = 12000) {
        return window.setTimeout(() => {
            const activePending = STATE.pendingTrackActionRequests.get(
                pending.requestId,
            );
            if (!activePending) {
                return;
            }

            if (attemptTrackActionWindowFallback(activePending, "timeout")) {
                return;
            }

            recordTrackActionDiagnostic("action-timeout", {
                action: activePending.action,
                trackUrl: activePending.trackUrl,
                origin: activePending.origin,
            });
            failTrackActionRequest(
                activePending,
                activePending.requestId,
                new Error(`${activePending.action} request timed out.`),
            );
        }, timeoutMs);
    }

    function attemptTrackActionWindowFallback(pending, reason) {
        if (
            !pending ||
            pending.action !== "wishlist" ||
            pending.fallbackAttempted
        ) {
            return false;
        }

        const attemptedOpen = openTrackActionHelperWindow(pending.helperUrl);
        if (!attemptedOpen) {
            return false;
        }

        pending.fallbackAttempted = true;
        window.clearTimeout(pending.timeoutId);
        pending.timeoutId = scheduleTrackActionTimeout(pending, 15000);
        if (pending.iframe && pending.iframe.parentNode) {
            pending.iframe.remove();
        }
        recordTrackActionDiagnostic("window-fallback-opened", {
            action: pending.action,
            trackUrl: pending.trackUrl,
            origin: pending.origin,
            reason,
        });
        return true;
    }

    function attachTrackActionIframeErrorHandler(
        iframe,
        pending,
    ) {
        iframe.addEventListener(
            "error",
            () => {
                const activePending = STATE.pendingTrackActionRequests.get(
                    pending.requestId,
                );
                if (!activePending) {
                    return;
                }
                recordTrackActionDiagnostic("iframe-load-error", {
                    action: pending.action,
                    trackUrl: pending.trackUrl,
                    origin: pending.origin,
                });
                if (attemptTrackActionWindowFallback(activePending, "iframe-load-error")) {
                    return;
                }
                failTrackActionRequest(
                    activePending,
                    activePending.requestId,
                    new Error(`${pending.action} helper could not load.`),
                );
            },
            { once: true },
        );
    }

    function openTrackActionHelperWindow(helperUrl) {
        const openedWindow = window.open(helperUrl, "_blank");
        if (openedWindow && !openedWindow.closed) {
            return true;
        }

        const link = document.createElement("a");
        link.href = helperUrl;
        link.target = "_blank";
        link.style.display = "none";
        appendToDocument(link);
        link.click();
        link.remove();
        return true;
    }

    function registerPendingTrackActionRequest(pending) {
        STATE.pendingTrackActionRequests.set(pending.requestId, pending);
    }

    function setTrackActionButtonPending(button, pending) {
        if (!button) {
            return;
        }

        if (button.classList.contains("bcampx-player-favorite")) {
            button.disabled = pending;
            button.classList.toggle("bcampx-player-button--pending", pending);
            return;
        }

        button.disabled = pending;
        button.classList.toggle("bcampx__track-action--pending", pending);
        button.dataset.bcampxOriginalLabel =
            button.dataset.bcampxOriginalLabel || button.textContent;
        if (pending) {
            button.textContent = "...";
            const item = button.closest("li");
            if (item) {
                item.classList.add("bcampx__track-item--show-actions");
            }
            return;
        }

        button.textContent =
            button.dataset.bcampxOriginalLabel || button.textContent;
    }

    function flashTrackActionButton(button, label) {
        if (!button) {
            return;
        }

        const original =
            button.dataset.bcampxOriginalLabel || button.textContent;
        button.textContent = label;
        button.classList.add("bcampx__track-action--flash");
        window.setTimeout(() => {
            button.textContent = original;
            button.classList.remove("bcampx__track-action--flash");
            const item = button.closest("li");
            if (item && !item.matches(":hover")) {
                item.classList.remove("bcampx__track-item--show-actions");
            }
        }, 1400);
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

    function playTrackForCard(
        card,
        triggerButton,
        track,
        data,
        releaseUrl,
        options = {},
    ) {
        if (!track || !track.streamUrl) {
            return;
        }

        const audio = ensureSharedAudio();
        if (!audio) {
            return;
        }

        const sameTrack = audio.currentSrc === track.streamUrl;
        if (sameTrack && !audio.paused) {
            audio.pause();
            clearActiveTrackButton();
            return;
        }

        if (!sameTrack) {
            audio.src = track.streamUrl;
        }

        pauseBandcampPageAudio();
        const cardArtUrl = getCardArtUrl(card);
        if (
            triggerButton &&
            triggerButton.classList &&
            (triggerButton.classList.contains("bcampx__track-link") ||
                triggerButton.classList.contains("bcampx__merge-track-button"))
        ) {
            setActiveTrackButton(triggerButton);
        } else {
            clearActiveTrackButton();
        }
        setActiveTrackContext(
            track,
            data,
            releaseUrl,
            card,
            cardArtUrl,
            options,
        );
        syncActiveTrackUi(cardArtUrl);
        announcePlaybackStart("feed-preview");
        audio.play().catch(() => {
            clearActiveTrackButton();
            if (typeof options.onPlayError === "function") {
                void Promise.resolve(options.onPlayError()).catch(() => {});
            }
        });
    }

    function ensureSharedAudio() {
        if (STATE.sharedAudio) {
            return STATE.sharedAudio;
        }

        setupSharedAudio();
        return STATE.sharedAudio;
    }

    function setActiveTrackButton(button) {
        clearActiveTrackButton();
        STATE.activeTrackButton = button;
        STATE.activeTrackButton.classList.add("bcampx__track-link--active");
    }

    function clearActiveTrackButton() {
        if (STATE.activeTrackButton) {
            STATE.activeTrackButton.classList.remove(
                "bcampx__track-link--active",
            );
            STATE.activeTrackButton = null;
        }
    }

    function syncActiveTrackButton() {
        const audio = ensureSharedAudio();
        if (!audio || audio.paused) {
            clearActiveTrackButton();
        }

        scheduleUiSync();
    }

    function syncWaypointNowPlaying(track, data, cardArtUrl) {
        setupWaypointNavigation();
        const waypoint = document.querySelector("#track_play_waypoint");
        if (!waypoint) {
            return;
        }

        waypoint.classList.add("done", "activated");

        const image = waypoint.querySelector("img");
        const artUrl = cardArtUrl || (data && data.artUrl) || "";
        if (image && artUrl) {
            image.src = artUrl;
        }

        const nowLabel = waypoint.querySelector(".waypoint-header-now");
        if (nowLabel) {
            nowLabel.textContent = "now playing";
        }

        const title = waypoint.querySelector(".waypoint-item-title");
        if (title) {
            title.textContent = track.title || data.title || "";
        }

        const artist = waypoint.querySelector(".waypoint-artist-title");
        if (artist) {
            artist.textContent = data.artist ? `by ${data.artist}` : "";
        }

        updateWaypointPlayPauseButton();
    }

    function setupWaypointNavigation() {
        const waypoint = document.querySelector("#track_play_waypoint");
        if (!waypoint || STATE.waypointNode === waypoint) {
            return;
        }

        ensureWaypointPlayPauseButton(waypoint);
        waypoint.addEventListener("click", handleWaypointClick, true);
        STATE.waypointNode = waypoint;
    }

    function handleWaypointClick(event) {
        if (
            event.target &&
            event.target.closest &&
            event.target.closest(".bcampx__waypoint-toggle")
        ) {
            return;
        }

        const activeCard = getConnectedActiveTrackCard();
        if (!activeCard) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        scrollCardIntoView(activeCard, STATE.activeTrack);
    }

    function setActiveTrackCard(card) {
        if (!card || !document.contains(card)) {
            STATE.activeTrackCard = null;
            scheduleUiSync();
            return;
        }

        STATE.activeTrackCard = card;
        scheduleUiSync();
    }

    function getActiveCardArtUrl(card) {
        return getCardArtUrl(card) || STATE.activeCardArtUrl || "";
    }

    function syncActiveTrackUi(cardArtUrl) {
        scheduleUiSync(cardArtUrl);
    }

    function observeCollectionCoverState() {
        stopObservingCollectionCoverState();

        const card = getConnectedActiveTrackCard();
        const stateNode = findCoverPlaybackStateNodeForCard(card);
        if (
            STATE.activePlaybackScope !== "collection-grid" ||
            !stateNode ||
            typeof MutationObserver !== "function"
        ) {
            return;
        }

        const observer = new MutationObserver(() => {
            const audio = ensureSharedAudio();
            const expectedClass = audio && audio.paused ? "paused" : "playing";
            if (
                STATE.coverPlaybackStateNode === stateNode &&
                !stateNode.classList.contains(expectedClass)
            ) {
                syncCoverPlaybackState();
            }
        });
        observer.observe(stateNode, {
            attributes: true,
            attributeFilter: ["class"],
        });
        STATE.collectionCoverStateObserver = observer;
        STATE.collectionCoverStateObserverTimer = window.setTimeout(
            stopObservingCollectionCoverState,
            2200,
        );
    }

    function stopObservingCollectionCoverState() {
        if (STATE.collectionCoverStateObserver) {
            STATE.collectionCoverStateObserver.disconnect();
            STATE.collectionCoverStateObserver = null;
        }
        window.clearTimeout(STATE.collectionCoverStateObserverTimer);
        STATE.collectionCoverStateObserverTimer = 0;
    }

    function getConnectedActiveTrackCard() {
        return STATE.activeTrackCard && document.contains(STATE.activeTrackCard)
            ? STATE.activeTrackCard
            : null;
    }

    function syncCoverPlaybackState() {
        const card = getConnectedActiveTrackCard();
        if (!card) {
            clearCoverPlaybackStateNode();
            return;
        }

        const stateNode = findCoverPlaybackStateNodeForCard(card);
        if (!stateNode) {
            clearCoverPlaybackStateNode();
            return;
        }

        const audio = ensureSharedAudio();
        if (!audio) {
            clearCoverPlaybackStateNode();
            return;
        }

        if (
            STATE.coverPlaybackStateNode &&
            STATE.coverPlaybackStateNode !== stateNode
        ) {
            STATE.coverPlaybackStateNode.classList.remove("playing", "paused");
        }

        STATE.coverPlaybackStateNode = stateNode;
        const activeClass = audio.paused ? "paused" : "playing";
        toggleClassIfChanged(stateNode, "paused", activeClass === "paused");
        toggleClassIfChanged(stateNode, "playing", activeClass === "playing");
    }

    function clearCoverPlaybackStateNode() {
        if (!STATE.coverPlaybackStateNode) {
            return;
        }

        STATE.coverPlaybackStateNode.classList.remove("playing", "paused");
        STATE.coverPlaybackStateNode = null;
    }

    function findCoverPlaybackStateNodeForCard(card) {
        if (!card || typeof card.closest !== "function") {
            return null;
        }

        return (
            card.querySelector(".collection-item-container") ||
            card.closest(".collection-item-container") ||
            card.querySelector("li.collection-item-container") ||
            card.closest("li.collection-item-container") ||
            card.querySelector(".story-innards") ||
            card.closest(".story-innards") ||
            card.querySelector(".story") ||
            card.closest(".story") ||
            card
        );
    }

    function setActiveTrackContext(
        track,
        data,
        releaseUrl,
        card,
        cardArtUrl,
        options = {},
    ) {
        STATE.activeTrack = track || null;
        STATE.activeReleaseData = data || null;
        STATE.activeReleaseUrl = releaseUrl || "";
        STATE.activeTrackCard = card || null;
        STATE.activeTrackFanGridNode =
            card && typeof card.closest === "function"
                ? card.closest("#grids > .grid")
                : null;
        STATE.activeCardArtUrl = cardArtUrl || STATE.activeCardArtUrl || "";
        STATE.activePlaybackScope = cleanText(options.playbackScope);

        const tracks =
            Array.isArray(options.trackList)
                ? options.trackList.filter((item) => item && item.title)
                : data && Array.isArray(data.tracks)
                  ? data.tracks.filter((item) => item && item.title)
                  : [];
        STATE.activeTrackList = tracks;
        STATE.activeTrackIndex = findTrackIndex(tracks, track);

        syncMediaSessionMetadata();
        scheduleUiSync(cardArtUrl);
    }

    function scheduleUiSync(cardArtUrl) {
        if (typeof cardArtUrl === "string" && cardArtUrl) {
            STATE.pendingUiSyncCardArtUrl = cardArtUrl;
        }

        if (STATE.uiSyncFrame) {
            return;
        }

        STATE.uiSyncFrame = scheduleNextFrame(() => {
            STATE.uiSyncFrame = 0;
            const queuedArtUrl = STATE.pendingUiSyncCardArtUrl || "";
            STATE.pendingUiSyncCardArtUrl = "";
            flushUiSync(queuedArtUrl);
        });
    }

    function flushUiSync(cardArtUrl) {
        syncWaypointNowPlaying(
            STATE.activeTrack,
            STATE.activeReleaseData,
            cardArtUrl,
        );
        syncTrackButtonsForActiveTrack();
        syncCoverPlaybackState();
        updateWaypointPlayPauseButton();
        syncPlayerShell();
    }

    function setupMediaSession() {
        if (!("mediaSession" in navigator)) {
            return;
        }

        const handlers = {
            play: () => {
                const audio = ensureSharedAudio();
                if (audio && audio.paused) {
                    audio.play().catch(() => {});
                }
            },
            pause: () => {
                const audio = ensureSharedAudio();
                if (audio && !audio.paused) {
                    audio.pause();
                }
            },
            previoustrack: playPreviousTrack,
            nexttrack: playNextTrack,
        };

        Object.entries(handlers).forEach(([action, handler]) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (_error) {
                // Some browsers expose mediaSession but not every action handler.
            }
        });
    }

    function syncMediaSessionMetadata() {
        if (!("mediaSession" in navigator)) {
            return;
        }

        if (
            !STATE.activeTrack ||
            !STATE.activeReleaseData ||
            typeof MediaMetadata !== "function"
        ) {
            navigator.mediaSession.metadata = null;
            syncMediaSessionState();
            return;
        }

        const track = STATE.activeTrack;
        const data = STATE.activeReleaseData || {};
        const artworkUrl =
            getActiveCardArtUrl(STATE.activeTrackCard) || data.artUrl || "";
        const artwork = artworkUrl
            ? [96, 128, 192, 256, 384, 512].map((size) => ({
                  src: artworkUrl,
                  sizes: `${size}x${size}`,
              }))
            : [];

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title || data.title || "Bandcamp preview",
                artist: data.artist || "",
                album: data.title || "",
                artwork,
            });
        } catch (_error) {
            navigator.mediaSession.metadata = null;
        }

        syncMediaSessionState();
    }

    function syncMediaSessionState() {
        if (!("mediaSession" in navigator)) {
            return;
        }

        const audio = STATE.sharedAudio;
        if (!audio || !STATE.activeTrack || !STATE.activeReleaseData) {
            try {
                navigator.mediaSession.playbackState = "none";
            } catch (_error) {}
            return;
        }

        try {
            navigator.mediaSession.playbackState = audio.paused
                ? "paused"
                : "playing";
        } catch (_error) {}
    }

    function findTrackIndex(tracks, track) {
        if (!Array.isArray(tracks) || !track) {
            return -1;
        }

        const exactIndex = tracks.findIndex((item) => {
            return (
                item &&
                track &&
                item.title === track.title &&
                item.streamUrl === track.streamUrl
            );
        });
        if (exactIndex >= 0) {
            return exactIndex;
        }

        return tracks.findIndex(
            (item) => item && track && item.title === track.title,
        );
    }

    function findPlaybackCard(node) {
        if (!node || typeof node.closest !== "function") {
            return null;
        }

        return (
            node.closest("li.story.fp") ||
            node.closest(".story") ||
            node.closest("article") ||
            node.closest("li") ||
            null
        );
    }

    function getCardArtUrl(card) {
        if (!card) {
            return "";
        }

        const selectors = [
            ".tralbum-wrapper-col1 .tralbum-art-large",
            ".tralbum-wrapper-col1 .tralbum-art-container img",
            ".tralbum-wrapper-col1 img",
            ".collection-item-art img",
            ".art img",
            ".tralbum-art-large",
        ];

        let image = null;
        for (const selector of selectors) {
            image = card.querySelector(selector);
            if (image) {
                break;
            }
        }

        return image
            ? image.getAttribute("data-original") ||
                  image.currentSrc ||
                  image.src ||
                  ""
            : "";
    }

    function findWaypointScrollTarget(card, track) {
        if (!(card instanceof Element)) {
            return null;
        }

        if (
            STATE.activeTrackButton instanceof Element &&
            card.contains(STATE.activeTrackButton)
        ) {
            return (
                STATE.activeTrackButton.closest(".bcampx__track-item") ||
                STATE.activeTrackButton
            );
        }

        const trackId = cleanText(track && track.trackId);
        const streamUrl = cleanText(track && track.streamUrl);
        const title = cleanText(track && track.title).toLowerCase();
        const buttons = Array.from(
            card.querySelectorAll(
                ".bcampx__track-link, .bcampx__merge-track-button",
            ),
        );
        const preferredButton =
            (trackId &&
                buttons.find(
                    (button) =>
                        cleanText(button.dataset.trackId) === trackId,
                )) ||
            (streamUrl &&
                buttons.find(
                    (button) =>
                        cleanText(button.dataset.streamUrl) === streamUrl,
                )) ||
            (title &&
                buttons.find(
                    (button) =>
                        cleanText(button.textContent).toLowerCase() === title,
                ));
        if (preferredButton) {
            return (
                preferredButton.closest(".bcampx__track-item") ||
                preferredButton
            );
        }

        return card;
    }

    function scrollCardIntoView(card, track) {
        if (!card) {
            return;
        }

        const target = findWaypointScrollTarget(card, track);
        if (!target) {
            return;
        }
        const scrollOffset = getActiveTrackScrollOffset();

        if (window.Dom && typeof window.Dom.scrollToElement === "function") {
            window.Dom.scrollToElement(target, -scrollOffset);
            return;
        }

        const cardRect = target.getBoundingClientRect();
        const targetTop = window.scrollY + cardRect.top - scrollOffset;
        window.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth",
        });
    }

    function getActiveTrackScrollOffset() {
        const baseOffset = 30;
        const sticky = document.querySelector("#grid-tabs-sticky");
        if (!(sticky instanceof Element)) {
            return baseOffset;
        }

        const rect = sticky.getBoundingClientRect();
        const height = Math.max(
            0,
            rect.height,
            Number(sticky.clientHeight) || 0,
        );
        if (!height) {
            return baseOffset;
        }

        const style = window.getComputedStyle(sticky);
        const configuredTop = Number.parseFloat(style.top);
        const topInset =
            Number.isFinite(configuredTop) && configuredTop >= 0
                ? configuredTop
                : 0;
        return Math.max(baseOffset, Math.ceil(topInset + height + 12));
    }

    function ensurePlayerShell() {
        if (
            STATE.playerUi &&
            STATE.playerHost &&
            document.contains(STATE.playerHost)
        ) {
            return STATE.playerUi;
        }

        if (STATE.playerHost && document.contains(STATE.playerHost)) {
            STATE.playerHost.remove();
        }

        STATE.playerSettingsOpen = false;

        const host = document.createElement("div");
        host.id = "bcampx-player-host";
        host.style.all = "initial";
        host.style.position = "fixed";
        host.style.inset = "0";
        host.style.zIndex = "2147483646";
        host.style.pointerEvents = "none";

        const shadowRoot = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = getPlayerShellStyles();
        shadowRoot.append(style);

        const shell = document.createElement("section");
        shell.className = "bcampx-player-shell";
        shell.hidden = true;

        const controls = document.createElement("div");
        controls.className = "bcampx-player-controls";

        const prevButton = createPlayerButton({
            text: "Previous",
            className: "bcampx-player-button",
            onClick: playPreviousTrack,
        });

        const nextButton = createPlayerButton({
            text: "Next",
            className: "bcampx-player-button",
            onClick: playNextTrack,
        });

        const releaseButton = createPlayerButton({
            className: "bcampx-player-button bcampx-player-button--circle",
            iconName: "open",
            ariaLabel: "Open release",
            onClick: openActiveRelease,
        });

        const favoriteButton = createPlayerButton({
            className:
                "bcampx-player-button bcampx-player-button--circle bcampx-player-favorite",
            iconName: "favorite",
            ariaLabel: "Add to wishlist",
            ariaPressed: "false",
            onClick: toggleActiveWishlist,
        });

        const settingsWrap = document.createElement("div");
        settingsWrap.className = "bcampx-player-settings";

        const settingsButton = createPlayerButton({
            className:
                "bcampx-player-button bcampx-player-button--circle bcampx-player-settings-toggle",
            iconName: "settings",
            ariaLabel: "Open settings",
            ariaHaspopup: "menu",
            onClick: togglePlayerSettingsMenu,
        });
        settingsButton.setAttribute("aria-expanded", "false");

        const settingsMenu = document.createElement("div");
        settingsMenu.className = "bcampx-player-settings-menu";
        settingsMenu.hidden = true;
        settingsMenu.setAttribute("role", "menu");

        const trackRowActionsSetting = createPlayerSettingsToggleRow({
            label: "Buy/Wish button for singles",
            description: "Show per-track buy and wishlist actions. Turn off to save a little loading work.",
            checked: CONFIG.enableTrackRowActions,
            onChange: handleTrackRowActionsSettingChange,
        });

        const autoFillPriceSetting = createPlayerSettingsToggleRow({
            label: "Auto-fill minimum price",
            description: "Automatically fill the minimum price into the buy dialog. Turn off to enter a custom price.",
            checked: CONFIG.autoFillMinimumPrice,
            onChange: handleAutoFillMinimumPriceSettingChange,
        });

        const continuousModeSetting = createPlayerSettingsToggleRow({
            label: "Continuous mode",
            description: "When one release finishes, keep going to the next playable release in the feed.",
            checked: CONFIG.continuousMode,
            onChange: handleContinuousModeSettingChange,
        });

        const collectionCountsSetting = createPlayerSettingsToggleRow({
            label: "Collection counts",
            description: "Show how many collections a release appears in. Uses extra Bandcamp requests.",
            checked: CONFIG.showCollectionCounts,
            onChange: handleCollectionCountsSettingChange,
        });

        const settingsFooter = document.createElement("div");
        settingsFooter.className = "bcampx-player-settings-footer";
        settingsFooter.append("Made by ");

        const settingsFooterLink = document.createElement("a");
        settingsFooterLink.className = "bcampx-player-settings-footer-link";
        settingsFooterLink.href = "https://www.instagram.com/chuan_p/";
        settingsFooterLink.target = "_blank";
        settingsFooterLink.rel = "noopener noreferrer";
        settingsFooterLink.textContent = "@chuan_p";

        settingsFooter.append(settingsFooterLink);
        settingsFooter.append(" with Codex. 2026");

        settingsMenu.append(
            trackRowActionsSetting.row,
            autoFillPriceSetting.row,
            continuousModeSetting.row,
            collectionCountsSetting.row,
            settingsFooter,
        );
        settingsWrap.append(settingsButton, settingsMenu);

        controls.append(
            prevButton,
            nextButton,
            favoriteButton,
            releaseButton,
            settingsWrap,
        );

        const meta = document.createElement("div");
        meta.className = "bcampx-player-meta";

        const metaPrimary = document.createElement("div");
        metaPrimary.className = "bcampx-player-primary";
        const now = document.createElement("div");
        now.className = "bcampx-player-now";
        now.textContent = "Now Playing";

        const trackLink = document.createElement("a");
        trackLink.className = "bcampx-player-track";
        trackLink.href = "#";
        trackLink.draggable = false;
        trackLink.setAttribute("aria-label", "Scroll to current track");
        trackLink.textContent = "Select a preview track";
        trackLink.addEventListener("click", handlePlayerTrackLinkClick);
        trackLink.addEventListener("keydown", handlePlayerTrackLinkKeydown);

        metaPrimary.append(now, trackLink);

        const storeLink = document.createElement("a");
        storeLink.className = "bcampx-player-store";
        storeLink.href = "#";
        storeLink.target = "_blank";
        storeLink.rel = "noopener noreferrer";
        storeLink.textContent = "No track selected";

        meta.append(metaPrimary, storeLink);

        const nativeAudio = document.createElement("div");
        nativeAudio.className = "bcampx-player-native";

        shell.append(controls, meta, nativeAudio);
        shadowRoot.append(shell);
        appendToDocument(host);

        STATE.playerUi = {
            host,
            shadowRoot,
            shell,
            prevButton,
            nextButton,
            favoriteButton,
            releaseButton,
            settingsWrap,
            settingsButton,
            settingsMenu,
            trackRowActionsSettingInput: trackRowActionsSetting.input,
            autoFillPriceSettingInput: autoFillPriceSetting.input,
            continuousModeSettingInput: continuousModeSetting.input,
            collectionCountsSettingInput: collectionCountsSetting.input,
            trackLink,
            storeLink,
            nativeAudio,
        };
        STATE.playerHost = host;

        syncPlayerShell();
        return STATE.playerUi;
    }

    function syncPlayerShell() {
        const ui = ensurePlayerShell();
        const audio = ensureSharedAudio();
        const hasTrack = Boolean(STATE.activeTrack && STATE.activeReleaseData);

        setBooleanPropertyIfChanged(ui.shell, "hidden", !hasTrack);
        if (!hasTrack && STATE.playerSettingsOpen) {
            closePlayerSettingsMenu();
        }
        toggleClassIfChanged(
            document.documentElement,
            "bcampx-player-active",
            hasTrack,
        );
        if (!hasTrack) {
            return;
        }

        const track = STATE.activeTrack;
        const data = STATE.activeReleaseData || {};
        const releaseUrl = STATE.activeReleaseUrl || "#";
        const navigationState = getPlayerNavigationState();
        ensureRemotePlayerWishlistState(releaseUrl);
        const favoriteState = getPlayerFavoriteState(releaseUrl);
        setBooleanPropertyIfChanged(
            ui.prevButton,
            "disabled",
            !navigationState.canGoPrev,
        );
        setBooleanPropertyIfChanged(
            ui.nextButton,
            "disabled",
            !navigationState.canGoNext,
        );
        applyPlayerFavoriteState(ui.favoriteButton, favoriteState);
        setBooleanPropertyIfChanged(
            ui.releaseButton,
            "disabled",
            !releaseUrl || releaseUrl === "#",
        );
        setTextContentIfChanged(
            ui.trackLink,
            `${data.artist || ""}${data.artist && track.title ? " - " : ""}${track.title || data.title || ""}` ||
                "Select a preview track",
        );
        setTextContentIfChanged(
            ui.storeLink,
            data.title && data.artist
                ? `${data.title} / ${data.artist}`
                : data.title || data.artist || "No track selected",
        );
        ui.storeLink.href = releaseUrl;
        attachSharedAudioToPlayer(ui.nativeAudio, audio);
    }

    function setTextContentIfChanged(node, text) {
        if (node && node.textContent !== text) {
            node.textContent = text;
        }
    }

    function setAttributeIfChanged(node, name, value) {
        if (node && node.getAttribute(name) !== value) {
            node.setAttribute(name, value);
        }
    }

    function setBooleanPropertyIfChanged(node, name, value) {
        if (node && Boolean(node[name]) !== Boolean(value)) {
            node[name] = Boolean(value);
        }
    }

    function toggleClassIfChanged(node, className, active) {
        if (
            node &&
            node.classList &&
            node.classList.contains(className) !== Boolean(active)
        ) {
            node.classList.toggle(className, Boolean(active));
        }
    }

    function handlePlayerTrackLinkClick(event) {
        event.preventDefault();
        void scrollToActiveTrackCard();
    }

    function handlePlayerTrackLinkKeydown(event) {
        if (event.key !== " " && event.key !== "Spacebar") {
            return;
        }

        event.preventDefault();
        void scrollToActiveTrackCard();
    }

    function getPlayerNavigationState() {
        const hasPreviousTrack =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                -1,
            ) >= 0;
        const hasNextTrack =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                1,
            ) >= 0;
        if (
            !CONFIG.continuousMode ||
            (hasPreviousTrack && hasNextTrack)
        ) {
            return {
                canGoPrev: hasPreviousTrack,
                canGoNext: hasNextTrack,
            };
        }

        const neighborState = getNeighborPlaybackAvailability();
        return {
            canGoPrev: hasPreviousTrack || neighborState.hasPrevious,
            canGoNext: hasNextTrack || neighborState.hasNext,
        };
    }

    function getPlayerFavoriteState(releaseUrl) {
        if (
            STATE.activeReleaseData &&
            isOwnedDigitalPrice(STATE.activeReleaseData.digitalPrice)
        ) {
            return {
                hidden: false,
                disabled: true,
                hasState: true,
                active: true,
                pending: false,
                owned: true,
            };
        }

        if (!shouldUseRemotePlayerWishlist()) {
            const wishlistControl = findActiveWishlistControl();
            return {
                hidden: false,
                disabled: !wishlistControl,
                hasState: true,
                active: isWishlistActive(wishlistControl),
                pending: false,
                owned: false,
            };
        }

        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
        const cachedState = normalizedReleaseUrl
            ? STATE.playerWishlistStateByUrl.get(normalizedReleaseUrl)
            : null;
        const hasCachedState =
            cachedState &&
            typeof cachedState === "object" &&
            cachedState.status === "known";
        const hasPendingAction =
            !!normalizedReleaseUrl &&
            STATE.playerWishlistActionRequests.has(normalizedReleaseUrl);
        return {
            hidden: !normalizedReleaseUrl,
            disabled:
                !normalizedReleaseUrl ||
                hasPendingAction ||
                !hasCachedState ||
                cachedState.canToggle === false,
            hasState: true,
            active: hasCachedState ? Boolean(cachedState.active) : false,
            pending: hasPendingAction,
            owned: false,
        };
    }

    function ensureRemotePlayerWishlistState(releaseUrl) {
        if (!shouldUseRemotePlayerWishlist()) {
            return null;
        }

        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
        if (!normalizedReleaseUrl) {
            return null;
        }

        const cachedState =
            STATE.playerWishlistStateByUrl.get(normalizedReleaseUrl);
        if (cachedState && typeof cachedState === "object") {
            if (cachedState.status === "known") {
                return null;
            }

            if (
                cachedState.status === "error" &&
                Date.now() - Number(cachedState.checkedAt || 0) <
                    PLAYER_WISHLIST_STATE_RETRY_MS
            ) {
                schedulePlayerWishlistStateRetry(normalizedReleaseUrl);
                return null;
            }

            STATE.playerWishlistStateByUrl.delete(normalizedReleaseUrl);
        }

        const existingRequest =
            STATE.playerWishlistStateRequests.get(normalizedReleaseUrl);
        if (existingRequest) {
            return existingRequest;
        }

        const request = fetchPlayerWishlistState(normalizedReleaseUrl)
            .then((result) => {
                const state = {
                    status: "known",
                    active: Boolean(result && result.active),
                    canToggle: Boolean(result && result.canToggle),
                    checkedAt: Date.now(),
                };
                STATE.playerWishlistStateByUrl.set(normalizedReleaseUrl, state);
                clearPlayerWishlistStateRetry(normalizedReleaseUrl);
                return state;
            })
            .catch((error) => {
                STATE.playerWishlistStateByUrl.set(normalizedReleaseUrl, {
                    status: "error",
                    active: false,
                    canToggle: false,
                    checkedAt: Date.now(),
                });
                recordTrackActionDiagnostic("wishlist-state-failed", {
                    releaseUrl: normalizedReleaseUrl,
                    error:
                        error && error.message
                            ? error.message
                            : "Wishlist state request failed.",
                });
                schedulePlayerWishlistStateRetry(normalizedReleaseUrl);
                return null;
            })
            .finally(() => {
                STATE.playerWishlistStateRequests.delete(normalizedReleaseUrl);
                if (
                    normalizeReleaseUrl(STATE.activeReleaseUrl || "") ===
                    normalizedReleaseUrl
                ) {
                    syncFavoriteButtonState();
                }
            });

        STATE.playerWishlistStateRequests.set(normalizedReleaseUrl, request);
        return request;
    }

    function schedulePlayerWishlistStateRetry(releaseUrl) {
        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
        if (
            !normalizedReleaseUrl ||
            STATE.playerWishlistStateRetryTimers.has(normalizedReleaseUrl)
        ) {
            return;
        }

        const timerId = window.setTimeout(() => {
            STATE.playerWishlistStateRetryTimers.delete(normalizedReleaseUrl);
            if (
                normalizeReleaseUrl(STATE.activeReleaseUrl || "") !==
                normalizedReleaseUrl
            ) {
                return;
            }

            const cachedState =
                STATE.playerWishlistStateByUrl.get(normalizedReleaseUrl);
            if (
                cachedState &&
                typeof cachedState === "object" &&
                cachedState.status === "error"
            ) {
                STATE.playerWishlistStateByUrl.delete(normalizedReleaseUrl);
            }

            ensureRemotePlayerWishlistState(normalizedReleaseUrl);
            syncFavoriteButtonState();
        }, PLAYER_WISHLIST_STATE_RETRY_MS);

        STATE.playerWishlistStateRetryTimers.set(normalizedReleaseUrl, timerId);
    }

    function clearPlayerWishlistStateRetry(releaseUrl) {
        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
        const timerId = normalizedReleaseUrl
            ? STATE.playerWishlistStateRetryTimers.get(normalizedReleaseUrl)
            : 0;
        if (!timerId) {
            return;
        }

        window.clearTimeout(timerId);
        STATE.playerWishlistStateRetryTimers.delete(normalizedReleaseUrl);
    }

    async function fetchPlayerWishlistState(releaseUrl) {
        try {
            const html = await requestWishlistStateHtml(releaseUrl);
            return parsePlayerWishlistStateFromHtml(html);
        } catch (_error) {
            return requestTrackActionViaHelper(
                "wishlist-state",
                releaseUrl,
                null,
            );
        }
    }

    function parsePlayerWishlistStateFromHtml(html) {
        const doc = htmlToDocument(html);
        const tralbumData = parseTralbumData(doc) || {};
        const collectInfo =
            parseJsonAttribute(
                doc.querySelector("[data-tralbum-collect-info]"),
                "data-tralbum-collect-info",
            ) || {};
        const pagedataBlob =
            parseJsonAttribute(
                doc.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
        const isWishlisted =
            !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
        const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
        const itemId =
            (tralbumData.current && tralbumData.current.id) ||
            collectInfo.collect_item_id ||
            "";
        const bandId =
            (tralbumData.current && tralbumData.current.band_id) ||
            collectInfo.collect_band_id ||
            "";

        return {
            ok: true,
            active: isWishlisted,
            canToggle: Boolean(fanId && itemId && bandId),
        };
    }

    function setFavoriteButtonState(button, active) {
        if (!button) {
            return;
        }

        toggleClassIfChanged(button, "active", active);
        setAttributeIfChanged(button, "aria-pressed", active ? "true" : "false");
        setAttributeIfChanged(
            button,
            "aria-label",
            active ? "Remove from wishlist" : "Add to wishlist",
        );
    }

    function togglePlayerSettingsMenu(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        STATE.playerSettingsOpen = !STATE.playerSettingsOpen;
        syncPlayerSettingsMenu();
    }

    function closePlayerSettingsMenu() {
        if (!STATE.playerSettingsOpen) {
            return;
        }

        STATE.playerSettingsOpen = false;
        syncPlayerSettingsMenu();
    }

    function syncPlayerSettingsMenu() {
        const ui = STATE.playerUi;
        if (!ui || !ui.settingsButton || !ui.settingsMenu) {
            return;
        }

        const open = !!STATE.playerSettingsOpen;
        setAttributeIfChanged(
            ui.settingsButton,
            "aria-expanded",
            open ? "true" : "false",
        );
        setAttributeIfChanged(
            ui.settingsButton,
            "aria-label",
            open ? "Close settings" : "Open settings",
        );
        setBooleanPropertyIfChanged(ui.settingsMenu, "hidden", !open);
        if (ui.trackRowActionsSettingInput) {
            setBooleanPropertyIfChanged(
                ui.trackRowActionsSettingInput,
                "checked",
                !!CONFIG.enableTrackRowActions,
            );
        }
        if (ui.autoFillPriceSettingInput) {
            setBooleanPropertyIfChanged(
                ui.autoFillPriceSettingInput,
                "checked",
                !!CONFIG.autoFillMinimumPrice,
            );
        }
        if (ui.continuousModeSettingInput) {
            setBooleanPropertyIfChanged(
                ui.continuousModeSettingInput,
                "checked",
                !!CONFIG.continuousMode,
            );
        }
        if (ui.collectionCountsSettingInput) {
            setBooleanPropertyIfChanged(
                ui.collectionCountsSettingInput,
                "checked",
                !!CONFIG.showCollectionCounts,
            );
        }
    }

    function createPlayerSettingsToggleRow({
        label,
        description,
        checked,
        onChange,
    }) {
        const row = document.createElement("label");
        row.className = "bcampx-player-settings-row";

        const copy = document.createElement("span");
        copy.className = "bcampx-player-settings-copy";

        const title = document.createElement("span");
        title.className = "bcampx-player-settings-label";
        title.textContent = label;

        const desc = document.createElement("span");
        desc.className = "bcampx-player-settings-description";
        desc.textContent = description;

        copy.append(title, desc);

        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "bcampx-player-settings-checkbox";
        input.checked = !!checked;
        input.addEventListener("change", onChange);

        row.append(copy, input);
        return { row, input };
    }

    function handleTrackRowActionsSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.enableTrackRowActions = checked;
        refreshRenderedTrackActionButtons();
        syncPlayerSettingsMenu();
        void persistUserSettings();
    }

    function handleAutoFillMinimumPriceSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.autoFillMinimumPrice = checked;
        syncPlayerSettingsMenu();
        void persistUserSettings();
    }

    function handleContinuousModeSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.continuousMode = checked;
        syncPlayerSettingsMenu();
        syncPlayerShell();
        void persistUserSettings();
    }

    function handleCollectionCountsSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.showCollectionCounts = checked;
        refreshArtistMusicCollectionCounts();
        syncPlayerSettingsMenu();
        void persistUserSettings();
    }

    function playPreviousTrack() {
        void playAdjacentTrackOrNeighbor(-1);
    }

    function playNextTrack() {
        void playAdjacentTrackOrNeighbor(1);
    }

    async function playAdjacentTrackOrNeighbor(offset) {
        if (playAdjacentTrack(offset)) {
            return true;
        }

        if (!CONFIG.continuousMode) {
            return false;
        }

        return playNeighborPlayableRelease(offset);
    }

    function playAdjacentTrack(offset) {
        if (
            !Array.isArray(STATE.activeTrackList) ||
            STATE.activeTrackIndex < 0
        ) {
            return false;
        }

        const nextIndex = findAdjacentPlayableTrackIndex(
            STATE.activeTrackList,
            STATE.activeTrackIndex,
            offset,
        );
        if (nextIndex < 0) {
            return false;
        }

        const nextTrack = STATE.activeTrackList[nextIndex];
        if (!nextTrack || !nextTrack.streamUrl) {
            return false;
        }

        const card = STATE.activeTrackCard;
        const cardArtUrl = getActiveCardArtUrl(card);
        STATE.activeTrackIndex = nextIndex;
        STATE.activeTrack = nextTrack;

        const audio = ensureSharedAudio();
        if (!audio) {
            return false;
        }

        audio.src = nextTrack.streamUrl;
        syncActiveTrackUi(cardArtUrl);
        audio.play().catch(() => {});
        syncFavoriteButtonState();
        return true;
    }

    function findAdjacentPlayableTrackIndex(tracks, startIndex, offset) {
        if (!Array.isArray(tracks) || !tracks.length || !offset) {
            return -1;
        }

        const step = offset > 0 ? 1 : -1;
        let index = startIndex + step;
        while (index >= 0 && index < tracks.length) {
            const track = tracks[index];
            if (track && track.streamUrl) {
                return index;
            }
            index += step;
        }

        return -1;
    }

    async function continuePlaybackAfterTrackEnd() {
        const audio = ensureSharedAudio();
        if (!audio || !audio.ended) {
            return false;
        }

        if (playAdjacentTrack(1)) {
            return true;
        }

        if (!CONFIG.continuousMode) {
            return false;
        }

        return playNeighborPlayableRelease(1);
    }

    async function playNeighborPlayableRelease(offset) {
        const neighbors = getNeighborPlayableReleases(offset);
        if (!neighbors.length) {
            return false;
        }

        for (const neighbor of neighbors) {
            try {
                const preview =
                    neighbor.playbackScope === "collection-grid"
                        ? getCollectionGridFeaturedPreview(neighbor.card)
                        : null;
                const data = preview
                    ? preview.data
                    : await getAvailableOrFetchReleaseDataForCard(
                          neighbor.card,
                          neighbor.releaseUrl,
                      );
                const track =
                    preview
                        ? preview.track
                        : neighbor.playbackScope === "collection-grid"
                        ? findFeaturedTrackForCard(neighbor.card, null, data)
                        : offset < 0
                          ? findLastPlayableTrack(data)
                          : findFeaturedTrackForCard(neighbor.card, null, data) ||
                            findFirstPlayableTrack(data);
                if (!track || !track.streamUrl) {
                    continue;
                }

                playTrackForCard(
                    neighbor.card,
                    null,
                    track,
                    data,
                    neighbor.releaseUrl,
                    neighbor.playbackScope === "collection-grid"
                        ? {
                              playbackScope: "collection-grid",
                              trackList: [track],
                          }
                        : {},
                );
                if (neighbor.playbackScope === "collection-grid") {
                    observeCollectionCoverState();
                }
                return true;
            } catch (_error) {
                continue;
            }
        }

        return false;
    }

    function hasNeighborPlayableRelease(offset) {
        return Boolean(findNeighborPlayableRelease(offset));
    }

    function findNeighborPlayableRelease(offset) {
        const neighbors = getNeighborPlayableReleases(offset);
        return neighbors.length ? neighbors[0] : null;
    }

    function getNeighborPlayableReleases(offset) {
        const currentCard = getStoryRoot(STATE.activeTrackCard) || STATE.activeTrackCard;
        if (!(currentCard instanceof Element) || !offset) {
            return [];
        }

        const collectionGridPlayback = findCollectionGridCard(currentCard);
        const cards = collectionGridPlayback
            ? getCollectionGridPlaybackCards(currentCard)
            : getStoryCardsFromRoots([document]);
        const currentIndex = cards.indexOf(currentCard);
        if (currentIndex < 0) {
            return [];
        }

        const neighbors = [];
        const step = offset > 0 ? 1 : -1;
        for (
            let index = currentIndex + step;
            index >= 0 && index < cards.length;
            index += step
        ) {
            const card = cards[index];
            if (
                collectionGridPlayback
                    ? !isCollectionGridPlaybackCandidate(card)
                    : !isContinuousPlaybackCandidate(card)
            ) {
                continue;
            }

            const releaseUrl = getCardPrimaryReleaseUrl(card);
            const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
            if (
                !normalizedReleaseUrl ||
                normalizedReleaseUrl === normalizeReleaseUrl(STATE.activeReleaseUrl || "")
            ) {
                continue;
            }

            neighbors.push({
                card,
                releaseUrl: normalizedReleaseUrl,
                playbackScope: collectionGridPlayback
                    ? "collection-grid"
                    : "",
            });
        }

        return neighbors;
    }

    function getNeighborPlaybackAvailability() {
        const currentCard = getStoryRoot(STATE.activeTrackCard) || STATE.activeTrackCard;
        if (!(currentCard instanceof Element)) {
            return { hasPrevious: false, hasNext: false };
        }

        const collectionGridPlayback = findCollectionGridCard(currentCard);
        const cards = collectionGridPlayback
            ? getCollectionGridPlaybackCards(currentCard)
            : getStoryCardsFromRoots([document]);
        const currentIndex = cards.indexOf(currentCard);
        if (currentIndex < 0) {
            return { hasPrevious: false, hasNext: false };
        }

        return {
            hasPrevious: hasNeighborPlaybackCandidate(
                cards,
                currentIndex,
                -1,
                collectionGridPlayback,
            ),
            hasNext: hasNeighborPlaybackCandidate(
                cards,
                currentIndex,
                1,
                collectionGridPlayback,
            ),
        };
    }

    function hasNeighborPlaybackCandidate(
        cards,
        currentIndex,
        offset,
        collectionGridPlayback,
    ) {
        const step = offset > 0 ? 1 : -1;
        const activeReleaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        for (
            let index = currentIndex + step;
            index >= 0 && index < cards.length;
            index += step
        ) {
            const card = cards[index];
            if (
                collectionGridPlayback
                    ? !isCollectionGridPlaybackCandidate(card)
                    : !isContinuousPlaybackCandidate(card)
            ) {
                continue;
            }

            const releaseUrl = normalizeReleaseUrl(getCardPrimaryReleaseUrl(card));
            if (releaseUrl && releaseUrl !== activeReleaseUrl) {
                return true;
            }
        }

        return false;
    }

    function getCollectionGridPlaybackCards(card) {
        const grid = card && card.closest(".collection-grid");
        if (!grid) {
            return [];
        }

        return Array.from(
            grid.querySelectorAll(".collection-item-container"),
        ).filter((item) => item instanceof Element);
    }

    function isCollectionGridPlaybackCandidate(card) {
        if (!(card instanceof Element) || isFullDiscographyCard(card)) {
            return false;
        }

        const releaseUrl = normalizeReleaseUrl(getCardPrimaryReleaseUrl(card));
        if (!releaseUrl) {
            return false;
        }

        return !(
            isWebExtensionHost() &&
            isCustomDomainReleaseUrl(releaseUrl) &&
            !hasExtensionHostPermission(releaseUrl)
        );
    }

    function isContinuousPlaybackCandidate(card) {
        if (!(card instanceof Element)) {
            return false;
        }

        if (
            card.closest(EXCLUDED_SECTION_SELECTOR) ||
            isFullDiscographyCard(card) ||
            isMalformedFeedCard(card) ||
            isAlsoBoughtRecommendationCard(card) ||
            card.getAttribute(MERGED_CHILD_ATTR) === "true"
        ) {
            return false;
        }

        const releaseUrl = normalizeReleaseUrl(getCardPrimaryReleaseUrl(card));
        if (!releaseUrl) {
            return false;
        }

        if (
            isWebExtensionHost() &&
            isCustomDomainReleaseUrl(releaseUrl) &&
            !hasExtensionHostPermission(releaseUrl)
        ) {
            return false;
        }

        return true;
    }

    async function getAvailableOrFetchReleaseDataForCard(card, releaseUrl) {
        const available = getAvailableReleaseDataForCard(card, releaseUrl);
        if (available) {
            return available;
        }

        const result = await getReleaseData(
            getCardReleaseRequestContext(card, releaseUrl),
        );
        const controller = getCardController(card);
        if (controller) {
            controller.loaded = true;
            controller.data = result.data;
        }
        return result.data;
    }

    function findFirstPlayableTrack(data) {
        const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
        return tracks.find((track) => track && track.streamUrl) || null;
    }

    function findLastPlayableTrack(data) {
        const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
        for (let index = tracks.length - 1; index >= 0; index -= 1) {
            const track = tracks[index];
            if (track && track.streamUrl) {
                return track;
            }
        }
        return null;
    }

    function syncTrackButtonsForActiveTrack() {
        clearActiveTrackButton();
        const streamUrl = STATE.activeTrack && STATE.activeTrack.streamUrl;
        if (!streamUrl) {
            return;
        }

        const selector = ".bcampx__track-link, .bcampx__merge-track-button";
        const roots = [
            STATE.activeTrackCard,
            STATE.activeTrackCard &&
                STATE.activeTrackCard.querySelector(".bcampx"),
            document,
        ].filter(Boolean);

        let activeButton = null;
        for (const root of roots) {
            activeButton = Array.from(root.querySelectorAll(selector)).find(
                (button) => button.dataset.streamUrl === streamUrl,
            );
            if (activeButton) {
                break;
            }
        }

        if (activeButton) {
            setActiveTrackButton(activeButton);
        }
    }

    function openActiveRelease() {
        if (!STATE.activeReleaseUrl) {
            return;
        }

        window.open(STATE.activeReleaseUrl, "_blank", "noopener");
    }

    async function scrollToActiveTrackCard() {
        await activateActiveTrackFanGrid();
        const activeCard =
            getConnectedActiveTrackCard() ||
            findActiveTrackCardByRelease();
        if (!activeCard) {
            return;
        }

        STATE.activeTrackCard = activeCard;
        scrollCardIntoView(activeCard, STATE.activeTrack);
    }

    async function activateActiveTrackFanGrid() {
        const grid = STATE.activeTrackFanGridNode;
        if (
            !(grid instanceof Element) ||
            !grid.isConnected ||
            grid.classList.contains("active")
        ) {
            return;
        }

        const tab = grid.id
            ? document.querySelector(
                  `[data-grid-id="${CSS.escape(grid.id)}"]`,
              )
            : null;
        if (!(tab instanceof HTMLElement)) {
            return;
        }

        tab.click();
        scheduleFanCollectionFeedContextSync();
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 25));
            if (
                grid.classList.contains("active") &&
                findActiveTrackCardByRelease()
            ) {
                return;
            }
        }
    }

    function findActiveTrackCardByRelease() {
        const releaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        if (!releaseUrl) {
            return null;
        }

        const grid = STATE.activeTrackFanGridNode;
        const root =
            grid instanceof Element && grid.isConnected ? grid : document;
        return (
            Array.from(
                root.querySelectorAll(
                    ".bcampx-label-feed-card[data-bcampx-release-url]",
                ),
            ).find(
                (card) =>
                    normalizeReleaseUrl(
                        card.getAttribute("data-bcampx-release-url") || "",
                    ) === releaseUrl,
            ) || null
        );
    }

    function attachSharedAudioToPlayer(container, audio) {
        if (!container || !audio) {
            return;
        }

        if (audio.parentElement === container) {
            return;
        }

        audio.controls = true;
        audio.preload = "metadata";
        audio.classList.add("bcampx-player-audio");
        audio.style.display = "block";
        audio.style.visibility = "visible";
        audio.style.opacity = "1";
        audio.style.width = "100%";
        audio.style.height = "38px";
        audio.style.position = "static";
        audio.style.pointerEvents = "auto";
        if (audio.parentElement !== container) {
            container.textContent = "";
            container.append(audio);
        }
    }

    function getPlayerShellStyles() {
        return PLAYER_SHELL_CSS;
    }

    function pauseBandcampPageAudio() {
        if (
            STATE.pageAudio &&
            STATE.pageAudio !== STATE.sharedAudio &&
            typeof STATE.pageAudio.pause === "function"
        ) {
            STATE.pageAudio.pause();
        }
    }

    function findActiveWishlistControl() {
        const activeCard = getConnectedActiveTrackCard();
        if (!activeCard) {
            return null;
        }

        const collectRoot =
            activeCard.querySelector(".collect-item") ||
            activeCard.querySelector(
                ".tralbum-wrapper-collect-controls",
            ) ||
            activeCard;

        if (!collectRoot) {
            return null;
        }

        return (
            findVisibleNode(collectRoot, ".wishlisted-msg") ||
            findVisibleNode(collectRoot, ".wishlist-msg") ||
            Array.from(collectRoot.querySelectorAll("a, button")).find(
                (node) =>
                    isNodeVisible(node) &&
                    /^\s*in wishlist\s*$/i.test(
                        (node.textContent || "").trim(),
                    ),
            ) ||
            Array.from(collectRoot.querySelectorAll("a, button")).find(
                (node) =>
                    isNodeVisible(node) &&
                    /^\s*wishlist\s*$/i.test((node.textContent || "").trim()),
            ) ||
            Array.from(collectRoot.querySelectorAll("a, button")).find(
                (node) =>
                    isNodeVisible(node) &&
                    /wishlist/i.test((node.textContent || "").trim()),
            )
        );
    }

    function isWishlistActive(control) {
        if (!control) {
            return false;
        }

        const text = (control.textContent || "").trim();
        const ariaPressed = control.getAttribute("aria-pressed");
        return (
            /in wishlist/i.test(text) ||
            ariaPressed === "true" ||
            control.classList.contains("added") ||
            (control.classList.contains("wishlisted-msg") &&
                isNodeVisible(control))
        );
    }

    function findVisibleNode(root, selector) {
        return (
            Array.from(root.querySelectorAll(selector)).find((node) =>
                isNodeVisible(node),
            ) || null
        );
    }

    function isNodeVisible(node) {
        if (!node) {
            return false;
        }

        const style = window.getComputedStyle(node);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity || "1") === 0
        ) {
            return false;
        }

        return Boolean(node.offsetParent || node.getClientRects().length);
    }

    function syncFavoriteButtonState() {
        const ui = STATE.playerUi;
        if (!ui || !ui.favoriteButton) {
            return;
        }

        if (shouldUseRemotePlayerWishlist()) {
            ensureRemotePlayerWishlistState(STATE.activeReleaseUrl || "");
        }

        applyPlayerFavoriteState(
            ui.favoriteButton,
            getPlayerFavoriteState(STATE.activeReleaseUrl || ""),
        );
    }

    function applyPlayerFavoriteState(button, state) {
        if (!button || !state) {
            return;
        }

        toggleClassIfChanged(
            button,
            "bcampx-player-favorite--owned",
            Boolean(state.owned),
        );
        setBooleanPropertyIfChanged(button, "hidden", state.hidden);
        setBooleanPropertyIfChanged(button, "disabled", state.disabled);
        toggleClassIfChanged(
            button,
            "bcampx-player-button--pending",
            Boolean(state.pending),
        );
        if (state.hasState) {
            setFavoriteButtonState(button, state.active);
        }
    }

    function toggleActiveWishlist() {
        const ui = STATE.playerUi;
        if (shouldUseRemotePlayerWishlist()) {
            void toggleActiveRemoteWishlist();
            return;
        }

        const wishlistControl = findActiveWishlistControl();
        if (!wishlistControl) {
            return;
        }

        if (ui && ui.favoriteButton) {
            const nextActive =
                ui.favoriteButton.getAttribute("aria-pressed") !== "true";
            setFavoriteButtonState(ui.favoriteButton, nextActive);
        }

        wishlistControl.click();
        window.setTimeout(syncFavoriteButtonState, 60);
        window.setTimeout(syncFavoriteButtonState, 260);
        window.setTimeout(syncFavoriteButtonState, 700);
    }

    function shouldUseRemotePlayerWishlist() {
        const activeCard = getConnectedActiveTrackCard();
        return Boolean(
            isArtistMusicPage() ||
                (activeCard &&
                    activeCard.closest &&
                    activeCard.closest(".bcampx-label-feed-card")),
        );
    }

    async function toggleActiveRemoteWishlist() {
        const ui = STATE.playerUi;
        const releaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        if (!ui || !ui.favoriteButton || !releaseUrl) {
            return;
        }

        const favoriteState = getPlayerFavoriteState(releaseUrl);
        if (favoriteState.disabled) {
            ensureRemotePlayerWishlistState(releaseUrl);
            return;
        }

        const desiredActive =
            ui.favoriteButton.getAttribute("aria-pressed") !== "true";
        STATE.playerWishlistActionRequests.add(releaseUrl);
        setTrackActionButtonPending(ui.favoriteButton, true);
        try {
            await requestTrackActionViaHelper(
                "wishlist",
                releaseUrl,
                ui.favoriteButton,
                { desiredActive },
            );
        } catch (_error) {
            STATE.playerWishlistActionRequests.delete(releaseUrl);
            setTrackActionButtonPending(ui.favoriteButton, false);
        }
    }

    function ensureWaypointPlayPauseButton(waypoint) {
        if (!waypoint) {
            return null;
        }

        let button = waypoint.querySelector(".bcampx__waypoint-toggle");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "bcampx__waypoint-toggle";
            button.setAttribute("aria-label", "Pause");
            button.addEventListener("click", handleWaypointToggleClick);
            waypoint.append(button);
        }

        updateWaypointPlayPauseButton(button);
        return button;
    }

    function handleWaypointToggleClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const audio = ensureSharedAudio();
        if (!audio) {
            return;
        }

        if (audio.paused) {
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    }

    function updateWaypointPlayPauseButton(existingButton) {
        const waypoint = document.querySelector("#track_play_waypoint");
        if (!waypoint) {
            return;
        }

        const button =
            existingButton ||
            waypoint.querySelector(".bcampx__waypoint-toggle");
        if (!button) {
            return;
        }

        const audio = ensureSharedAudio();
        const isPaused = !audio || audio.paused;
        setTextContentIfChanged(button, isPaused ? "Play" : "Pause");
        setAttributeIfChanged(
            button,
            "aria-label",
            isPaused ? "Play" : "Pause",
        );
        toggleClassIfChanged(button, "bcampx__waypoint-toggle--paused", isPaused);
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

    // __BCAMPX_TEXT_FORMAT_UTILS__
})();
