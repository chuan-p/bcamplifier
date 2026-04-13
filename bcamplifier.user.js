// ==UserScript==
// @name         Bandcamplifer
// @namespace    https://github.com/local/bcamplifier
// @version      0.1.159
// @description  Improve the Bandcamp feed with release metadata, track playback, wishlist actions, and purchase shortcuts.
// @author       chuan
// @match        https://bandcamp.com/feed*
// @match        https://bandcamp.com/*/feed*
// @match        https://bandcamp.com/*
// @match        https://*.bandcamp.com/*
// @connect      bandcamp.com
// @connect      *.bandcamp.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/573187/Bandcamp%20Feed%20Enhancer.user.js
// @updateURL https://update.greasyfork.org/scripts/573187/Bandcamp%20Feed%20Enhancer.meta.js
// ==/UserScript==

(function () {
    "use strict";

    const CONFIG = {
        autoFetchOnVisible: true,
        expandAfterAutoFetch: true,
        cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
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
        maxConcurrentFetches: 3,
    };

    const CACHE_SCHEMA_VERSION = 10;
    const RELEASE_CACHE_PREFIX = "bcampx:release:";
    const USER_SETTINGS_KEY = "bcampx:userSettings";
    const GLOBAL_PLAYBACK_KEY = "bcampx:globalPlaybackOwner";
    const GLOBAL_PLAYBACK_HEARTBEAT_MS = 1500;
    const GLOBAL_PLAYBACK_STALE_MS = 4500;

    const STATE = {
        initialized: false,
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
        waypointNode: null,
        activeTrack: null,
        activeTrackIndex: -1,
        activeTrackList: [],
        activeReleaseData: null,
        activeReleaseUrl: "",
        activeCardArtUrl: "",
        coverPlaybackStateNode: null,
        playerUi: null,
        playerHost: null,
        playerSettingsOpen: false,
        pendingReleaseRequests: new Map(),
        releaseFetchQueue: [],
        activeReleaseFetchCount: 0,
        pendingTrackActionRequests: new Map(),
        uiSyncFrame: 0,
        pendingUiSyncCardArtUrl: "",
        tabId: `bcampx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        playbackHeartbeatTimer: 0,
        playbackMonitorTimer: 0,
        claimedPlaybackKind: "",
        claimedPlaybackSource: null,
        lastTrackActionDiagnostic: null,
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
    const FAN_ACTIVITY_TEXT_PATTERN =
        /\b(bought|purchased|wishlisted|supported|recommended|following|followed|listening|played|posted|added)\b/i;
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

    const FAVORITE_ICON_MARKUP = [
        '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">',
        '<path class="bcampx-player-favorite-outline" d="M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
        '<path class="bcampx-player-favorite-fill" d="M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z" fill="currentColor"/>',
        "</svg>",
    ].join("");

    const OPEN_ICON_MARKUP = [
        '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">',
        '<path d="M7 13 13 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        '<path d="M8.2 6.8H14v5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
        "</svg>",
    ].join("");

    const SETTINGS_ICON_MARKUP = [
        '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">',
        '<circle cx="10" cy="4.75" r="1.55" fill="currentColor"/>',
        '<circle cx="10" cy="10" r="1.55" fill="currentColor"/>',
        '<circle cx="10" cy="15.25" r="1.55" fill="currentColor"/>',
        "</svg>",
    ].join("");

    init();

    function init() {
        markDebugState("data-bcampx-script-loaded", "true");
        markDebugState(
            "data-bcampx-page-kind",
            isFeedPage() ? "feed" : "other",
        );

        if (tryHandleEmbeddedTrackActionHelper()) {
            markDebugState("data-bcampx-init-state", "helper");
            return;
        }

        setupGlobalPlaybackBridge();

        if (STATE.initialized || !isFeedPage()) {
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
        ensurePlayerShell();
        setupIntersectionObserver();
        scanForCards();
        setupMutationObserver();
    }

    function setupGlobalPlaybackBridge() {
        if (STATE.globalBridgeInitialized) {
            return;
        }

        STATE.globalBridgeInitialized = true;
        document.addEventListener("play", handleDocumentAudioPlay, true);
        document.addEventListener("pause", handleDocumentAudioStop, true);
        document.addEventListener("ended", handleDocumentAudioStop, true);
        if (isFeedPage()) {
            STATE.playbackMonitorTimer = window.setInterval(
                checkForForeignPlayback,
                900,
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
            STATE.pageAudio.addEventListener(
                "play",
                suppressNativePageAudio,
                true,
            );
        }
        STATE.sharedAudio = document.createElement("audio");
        STATE.sharedAudio.preload = "metadata";
        STATE.sharedAudio.controls = true;
        STATE.sharedAudio.addEventListener("pause", syncActiveTrackButton);
        STATE.sharedAudio.addEventListener("play", syncActiveTrackButton);
        STATE.sharedAudio.addEventListener("ended", syncActiveTrackButton);
        STATE.sharedAudio.addEventListener("ended", handleSharedAudioEnded);
        STATE.sharedAudio.addEventListener("timeupdate", syncPlayerShell);
        STATE.sharedAudio.addEventListener("loadedmetadata", syncPlayerShell);
        STATE.sharedAudio.addEventListener("durationchange", syncPlayerShell);
        STATE.sharedAudio.addEventListener("volumechange", syncPlayerShell);
        STATE.sharedAudio.addEventListener("play", () =>
            claimPlaybackOwnership("feed-preview", STATE.sharedAudio),
        );
        STATE.sharedAudio.addEventListener("pause", () =>
            releasePlaybackOwnershipIfCurrent(STATE.sharedAudio),
        );
        STATE.sharedAudio.addEventListener("ended", () =>
            releasePlaybackOwnershipIfCurrent(STATE.sharedAudio),
        );
        STATE.sharedAudio.addEventListener("play", syncMediaSessionState);
        STATE.sharedAudio.addEventListener("pause", syncMediaSessionState);
        STATE.sharedAudio.addEventListener("ended", syncMediaSessionState);
        setupMediaSession();
    }

    function handleDocumentAudioPlay(event) {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement)) {
            return;
        }

        if (audio === STATE.sharedAudio) {
            return;
        }

        if (isFeedPage() && audio === STATE.pageAudio) {
            return;
        }

        claimPlaybackOwnership("bandcamp-native", audio);
    }

    function handleDocumentAudioStop(event) {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement)) {
            return;
        }

        releasePlaybackOwnershipIfCurrent(audio);
    }

    function handleSharedAudioEnded() {
        window.setTimeout(() => {
            void continuePlaybackAfterTrackEnd();
        }, 0);
    }

    function claimPlaybackOwnership(kind, source) {
        STATE.claimedPlaybackKind = kind || "";
        STATE.claimedPlaybackSource = source || null;
        void publishPlaybackHeartbeat();
        startPlaybackHeartbeat();
    }

    function startPlaybackHeartbeat() {
        window.clearInterval(STATE.playbackHeartbeatTimer);
        STATE.playbackHeartbeatTimer = window.setInterval(() => {
            void publishPlaybackHeartbeat();
        }, GLOBAL_PLAYBACK_HEARTBEAT_MS);
    }

    async function publishPlaybackHeartbeat() {
        if (!STATE.claimedPlaybackKind) {
            return;
        }

        await storageSet(GLOBAL_PLAYBACK_KEY, {
            tabId: STATE.tabId,
            kind: STATE.claimedPlaybackKind,
            pageUrl: window.location.href,
            ts: Date.now(),
        });
    }

    async function releasePlaybackOwnershipIfCurrent(source) {
        if (
            source &&
            STATE.claimedPlaybackSource &&
            source !== STATE.claimedPlaybackSource
        ) {
            return;
        }

        const current = await storageGet(GLOBAL_PLAYBACK_KEY, null);
        if (current && current.tabId === STATE.tabId) {
            await storageSet(GLOBAL_PLAYBACK_KEY, {
                tabId: "",
                kind: "",
                pageUrl: "",
                ts: 0,
            });
        }

        STATE.claimedPlaybackKind = "";
        STATE.claimedPlaybackSource = null;
        window.clearInterval(STATE.playbackHeartbeatTimer);
        STATE.playbackHeartbeatTimer = 0;
    }

    async function checkForForeignPlayback() {
        if (!isFeedPage()) {
            return;
        }

        const activeAudios = getLocalActiveAudios();
        if (!activeAudios.length) {
            return;
        }

        const current = await storageGet(GLOBAL_PLAYBACK_KEY, null);
        if (!current || !current.tabId || current.tabId === STATE.tabId) {
            return;
        }

        if (!current.ts || Date.now() - current.ts > GLOBAL_PLAYBACK_STALE_MS) {
            return;
        }

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
        document.addEventListener(
            "click",
            handleNativePlaybackTriggerClick,
            true,
        );
    }

    function setupPlayerMenuDismissal() {
        document.addEventListener("click", handleDocumentPlayerUiClick, true);
        document.addEventListener("keydown", handleDocumentPlayerUiKeydown, true);
    }

    function handleDocumentPlayerUiClick(event) {
        if (!STATE.playerSettingsOpen || !STATE.playerHost) {
            return;
        }

        const path =
            typeof event.composedPath === "function" ? event.composedPath() : [];
        if (path.includes(STATE.playerHost)) {
            return;
        }

        closePlayerSettingsMenu();
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

        const card = findPlaybackCard(trigger);
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

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
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
                await controller.fetchAndRender({ auto: false });
            }
        } catch (_error) {
            return;
        }

        const data = controller.data;
        const track = findFeaturedTrackForCard(card, trigger, data);
        if (!track || !track.streamUrl) {
            return;
        }

        playTrackForCard(card, null, track, data, releaseUrl);
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

        enhanceCard(card, releaseUrl);
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

    function getCardPrimaryReleaseUrl(card) {
        const albumLink = Array.from(
            card.querySelectorAll('a[href*="/album/"]'),
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .find(Boolean);
        if (albumLink) {
            return albumLink;
        }

        return (
            Array.from(card.querySelectorAll(RELEASE_LINK_SELECTOR))
                .map((link) => normalizeReleaseUrl(link.href))
                .find(Boolean) || ""
        );
    }

    function getStoryRoot(node) {
        if (!(node instanceof Element)) {
            return null;
        }

        const story = node.matches("li.story, .story")
            ? node
            : node.closest("li.story, .story");
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
            /^(.+?)\s+(?:bought|wishlisted|supported|recommended|listening|played)\b/i,
        );
        return match && match[1] ? cleanText(match[1]) : "";
    }

    function getItemJsonReleaseUrl(node) {
        if (!(node instanceof Element)) {
            return "";
        }

        const holder = node.matches("[data-item-json]")
            ? node
            : node.querySelector("[data-item-json]");
        if (!(holder instanceof Element)) {
            return "";
        }

        const raw = holder.getAttribute("data-item-json");
        if (!raw) {
            return "";
        }

        try {
            const parsed = JSON.parse(raw);
            return normalizeReleaseUrl(parsed && parsed.item_url ? parsed.item_url : "");
        } catch (_error) {
            return "";
        }
    }

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
            actionTexts.some((text) => text.includes("follow")) &&
            actionTexts.some((text) => text.includes("view collection"))
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

    function tryHandleEmbeddedTrackActionHelper() {
        const helperParams = parseTrackActionHelperParams(window.location.hash);
        if (!helperParams) {
            return false;
        }

        if (helperParams.action === "buy-dialog") {
            scheduleTrackActionHelperInit(runTrackBuyDialogHelper);
            return true;
        }

        if (window.top === window) {
            return false;
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

    function runTrackBuyDialogHelper() {
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

        const openBuyDialog = () => {
            const buyButton = Array.from(
                document.querySelectorAll("button.download-link.buy-link"),
            ).find((node) =>
                /buy digital track/i.test((node.textContent || "").trim()),
            );
            if (!buyButton) {
                return false;
            }

            buyButton.click();
            return true;
        };

        const focusPriceInput = () => {
            const priceInput = document.querySelector("#userPrice");
            if (!priceInput) {
                return false;
            }

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

            openBuyDialog();
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
        const send = (payload) => {
            try {
                window.parent.postMessage(
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
                window.parent.postMessage(
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

        if (action === "wishlist") {
            const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
            const isWishlisted =
                !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
            const crumbKey = isWishlisted
                ? "uncollect_item_cb"
                : "collect_item_cb";
            const crumb =
                typeof crumbs[crumbKey] === "string" ? crumbs[crumbKey] : "";
            if (!crumb) {
                send({ ok: false, error: "Wishlist crumb is missing." });
                return;
            }

            const endpoint = isWishlisted
                ? "/uncollect_item_cb"
                : "/collect_item_cb";
            const payload = new URLSearchParams();
            payload.set(
                "fan_id",
                String(pagedataBlob.identities?.fan?.id || collectInfo.fan_id || ""),
            );
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

    function getHostRequestOptions(baseOptions = {}) {
        return {
            method: baseOptions.method || "GET",
            data: baseOptions.data,
            headers: baseOptions.headers,
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

        finalizePendingTrackActionRequest(data.requestId);
        setTrackActionButtonPending(pending.button, false);
        flashTrackActionButton(
            pending.button,
            data.ok ? data.statusText || "Done" : "Error",
        );
        if (data.ok) {
            pending.resolve(data);
            return;
        }

        recordTrackActionDiagnostic("action-failed", {
            action: pending.action,
            origin: pending.origin,
            error: data.error || "Track action failed.",
        });
        pending.reject(new Error(data.error || "Track action failed."));
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
                        !controller.loading
                    ) {
                        controller.fetchAndRender({ auto: true });
                    }
                });
            },
            { rootMargin: CONFIG.observerRootMargin },
        );
    }

    function setupMutationObserver() {
        if (!("MutationObserver" in window) || !document.body) {
            return;
        }

        STATE.mutationObserver = new MutationObserver((mutations) => {
            let shouldFullScan = false;

            mutations.forEach((mutation) => {
                Array.from(mutation.addedNodes || []).forEach((node) => {
                    if (!(node instanceof Element)) {
                        return;
                    }

                    if (node.matches("li.story, .story")) {
                        scheduleScan(node);
                        return;
                    }

                    const nestedStories = node.querySelectorAll
                        ? node.querySelectorAll("li.story, .story")
                        : [];
                    if (nestedStories.length) {
                        nestedStories.forEach((story) => scheduleScan(story));
                        return;
                    }

                    if (
                        node.querySelector &&
                        node.querySelector(
                            '[data-item-json], a[href*="/album/"], a[href*="/track/"]',
                        )
                    ) {
                        const story = node.closest("li.story, .story");
                        if (story) {
                            scheduleScan(story);
                            return;
                        }
                    }

                    shouldFullScan = true;
                });
            });

            if (shouldFullScan) {
                scheduleScan();
            }
        });

        STATE.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    function scheduleScan(root = null) {
        if (root instanceof Element) {
            const story = root.matches("li.story, .story")
                ? root
                : root.closest("li.story, .story");
            if (story instanceof Element) {
                STATE.pendingScanRoots.add(story);
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

    function scanForCards() {
        incrementDebugCounter("data-bcampx-scan-count");
        const roots = getScanRoots();
        roots.forEach((root) => markMalformedCardsInRoot(root));
        roots.forEach((root) => cleanupSkippedRecommendationCards(root));
        roots.forEach((root) => scanReleaseLinksInRoot(root));

        mergeAdjacentTrackPurchaseCards(roots);
    }

    function cleanupSkippedRecommendationCards(root) {
        getMatchingRootOrDescendants(root, "li.story, .story").forEach((card) => {
            if (!isAlsoBoughtRecommendationCard(card)) {
                return;
            }

            cleanupEnhancedCard(card);
            card.setAttribute(ENHANCED_ATTR, "skipped");
        });
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

    function scanReleaseLinksInRoot(root) {
        getMatchingRootOrDescendants(root, RELEASE_LINK_SELECTOR).forEach(
            (link) => {
                incrementDebugCounter("data-bcampx-release-link-count");
                const releaseUrl = normalizeReleaseUrl(link.href);
                if (!releaseUrl) {
                    return;
                }

                if (!isFanActivityLink(link)) {
                    markDebugState("data-bcampx-last-skip", "not-fan-activity-link");
                    return;
                }
                incrementDebugCounter("data-bcampx-fan-activity-link-count");

                const card = findCardRoot(link);
                if (!card) {
                    markDebugState("data-bcampx-last-skip", "missing-card-root");
                    return;
                }
                incrementDebugCounter("data-bcampx-card-root-count");

                if (card.hasAttribute(ENHANCED_ATTR)) {
                    return;
                }

                if (
                    card.closest("#sidebar") ||
                    isFullDiscographyCard(card) ||
                    isAlsoBoughtRecommendationCard(card) ||
                    isMalformedFeedCard(card)
                ) {
                    markDebugState("data-bcampx-last-skip", "skipped-card");
                    card.setAttribute(ENHANCED_ATTR, "skipped");
                    return;
                }

                enhanceCard(card, releaseUrl);
            },
        );
    }

    function markMalformedCardsInRoot(root) {
        getMatchingRootOrDescendants(root, "li.story, .story").forEach((card) => {
            if (
                card instanceof Element &&
                !card.hasAttribute(ENHANCED_ATTR) &&
                isMalformedFeedCard(card)
            ) {
                card.setAttribute(ENHANCED_ATTR, "skipped");
            }
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

    function mergeAdjacentTrackPurchaseCards(roots = [document]) {
        const cards = roots
            .flatMap((root) => getMatchingRootOrDescendants(root, "li.story, .story"))
            .filter((card, index, allCards) => {
                return (
                    allCards.indexOf(card) === index &&
                    looksLikeFeedCard(card) &&
                    !isMalformedFeedCard(card) &&
                    !card.closest(EXCLUDED_SECTION_SELECTOR)
                );
            });

        cards.forEach((card) => {
            if (card.getAttribute(MERGED_CHILD_ATTR) === "true") {
                return;
            }

            const candidate = getTrackPurchaseMergeCandidate(card);
            if (!candidate) {
                return;
            }

            const previousCandidate = findPreviousAdjacentMergeCandidate(candidate);
            if (previousCandidate && previousCandidate.card !== card) {
                mergeTrackPurchaseCard(
                    previousCandidate.card,
                    card,
                    candidate.trackTitle,
                );
            }
        });
    }

    function getTrackPurchaseMergeKey(candidate) {
        return [
            candidate.parentElement ? "same-parent" : "no-parent",
            candidate.fanKey,
            candidate.activityType,
            candidate.releaseGroupKey,
        ].join("::");
    }

    function findPreviousAdjacentMergeCandidate(candidate) {
        let previous = candidate.card.previousElementSibling;
        while (previous) {
            if (previous.matches && previous.matches("li.story, .story")) {
                break;
            }
            previous = previous.previousElementSibling;
        }

        if (
            !previous ||
            previous.getAttribute(MERGED_CHILD_ATTR) === "true" ||
            !looksLikeFeedCard(previous) ||
            isMalformedFeedCard(previous) ||
            previous.closest(EXCLUDED_SECTION_SELECTOR)
        ) {
            return null;
        }

        const previousCandidate = getTrackPurchaseMergeCandidate(previous);
        if (
            previousCandidate &&
            getTrackPurchaseMergeKey(previousCandidate) ===
                getTrackPurchaseMergeKey(candidate)
        ) {
            return previousCandidate;
        }

        return null;
    }

    function getTrackPurchaseMergeCandidate(card) {
        const activityType = extractActivityType(card);
        if (activityType !== "bought-track") {
            return null;
        }

        const fanKey = extractFanKey(card);
        const releaseGroupKey = getCardReleaseGroupKey(card);
        const trackTitle = extractTrackTitleFromCard(card);

        if (!fanKey || !releaseGroupKey || !trackTitle) {
            return null;
        }

        return {
            card,
            parentElement: card.parentElement,
            fanKey,
            activityType,
            releaseGroupKey,
            trackTitle,
        };
    }

    function extractActivityType(card) {
        const text = normalizedText(card).toLowerCase();
        if (/bought a track\b/.test(text) || /bought track\b/.test(text)) {
            return "bought-track";
        }

        if (/bought an album\b/.test(text) || /bought album\b/.test(text)) {
            return "bought-album";
        }

        if (/wishlisted\b/.test(text)) {
            return "wishlisted";
        }

        return "";
    }

    function extractFanKey(card) {
        const explicitFanLink = card.querySelector(
            ".story-title .fan-name a[href], .story-title a.fan-name[href], .story-title .fan-name[href]",
        );
        if (explicitFanLink && explicitFanLink.href) {
            try {
                const url = new URL(explicitFanLink.href, window.location.href);
                return cleanText(
                    url.pathname.replace(/^\/+|\/+$/g, ""),
                ).toLowerCase();
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
                return cleanText(
                    url.pathname.replace(/^\/+|\/+$/g, ""),
                ).toLowerCase();
            } catch (_error) {
                // Fall through to text extraction.
            }
        }

        const headline = findActivityHeadline(card);
        const actor = extractFeedHeadlineActor(
            headline ? normalizedText(headline) : normalizedText(card),
        );
        return actor ? actor.toLowerCase() : "";
    }

    function extractFanDisplayName(card) {
        const explicitFanName = card.querySelector(
            ".story-title .fan-name, .story-title a.fan-name, .story-title .artist-name",
        );
        if (explicitFanName) {
            const text = normalizedText(explicitFanName);
            if (text) {
                return text;
            }
        }

        const headline = findActivityHeadline(card);
        const actor = extractFeedHeadlineActor(
            headline ? normalizedText(headline) : normalizedText(card),
        );
        return actor || "This fan";
    }

    function getCardReleaseGroupKey(card) {
        const albumLink = Array.from(
            card.querySelectorAll('a[href*="/album/"]'),
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .find(Boolean);
        if (albumLink) {
            return `album:${albumLink}`;
        }

        const releaseLink = Array.from(
            card.querySelectorAll(RELEASE_LINK_SELECTOR),
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .find(Boolean);
        if (!releaseLink) {
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
        return `heuristic:${origin}|${artist}|${artUrl}`;
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
        const contentColumn = findContentColumn(card);
        const trackScope = contentColumn || card;

        const featuredTrackText = extractFeaturedTrackTitle(trackScope);
        if (featuredTrackText) {
            return featuredTrackText;
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
            return normalizedText(explicitTrackLink);
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

        return titleCandidate ? normalizedText(titleCandidate) : "";
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
            if (
                url.hostname !== "bandcamp.com" &&
                !url.hostname.endsWith(".bandcamp.com")
            ) {
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

    function findCardRoot(link) {
        const explicitStory = link.closest("li.story, .story");
        if (explicitStory) {
            return explicitStory;
        }

        let node = link;
        let fallback = null;

        for (
            let depth = 0;
            node && node !== document.body && depth < 10;
            depth += 1
        ) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (!fallback && node.matches("article, li")) {
                    fallback = node;
                }

                if (
                    node.tagName !== "A" &&
                    node.matches(CARD_SELECTOR) &&
                    looksLikeFeedCard(node)
                ) {
                    return node;
                }
            }

            node = node.parentElement;
        }

        return fallback || link.closest("article, li") || link.parentElement;
    }

    function looksLikeFeedCard(node) {
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

    function isFanActivityLink(link) {
        if (!(link instanceof Element)) {
            markDebugState("data-bcampx-last-skip", "link-not-element");
            return false;
        }

        if (link.closest(EXCLUDED_SECTION_SELECTOR)) {
            markDebugState("data-bcampx-last-skip", "link-in-excluded-section");
            return false;
        }

        if (hasSidebarLikeAncestor(link)) {
            markDebugState("data-bcampx-last-skip", "link-in-sidebar");
            return false;
        }

        const story = link.closest("li.story, .story");
        if (story) {
            if (isAlsoBoughtRecommendationCard(story)) {
                markDebugState("data-bcampx-last-skip", "also-bought-story");
                return false;
            }
            const accepted = isLikelyFanActivityCard(story);
            if (!accepted) {
                markDebugState("data-bcampx-last-skip", "story-not-likely-card");
            }
            return accepted;
        }

        const card =
            link.closest(CARD_SELECTOR) || link.closest("article, li, div");
        if (card && !isLikelyFanActivityCard(card)) {
            markDebugState("data-bcampx-last-skip", "card-not-likely");
            return false;
        }

        return true;
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
        const story = node.matches("li.story, .story")
            ? node
            : node.closest("li.story, .story");

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

    function enhanceCard(card, releaseUrl) {
        incrementDebugCounter("data-bcampx-enhance-attempt-count");
        if (
            isFullDiscographyCard(card) ||
            isAlsoBoughtRecommendationCard(card)
        ) {
            markDebugState("data-bcampx-last-skip", "enhance-guard");
            card.setAttribute(ENHANCED_ATTR, "skipped");
            return;
        }

        card.setAttribute(ENHANCED_ATTR, "true");

        const shell = document.createElement("section");
        shell.className = "bcampx";

        const meta = document.createElement("div");
        meta.className = "bcampx__meta";
        meta.hidden = true;

        const summary = document.createElement("div");
        summary.className = "bcampx__summary";

        const text = document.createElement("span");
        text.className = "bcampx__summary-text";
        text.textContent = "Loading extra context...";

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
            expanded: false,
            data: null,
            releaseUrl,
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

        const actionLink = Array.from(card.querySelectorAll("a")).find(
            (link) => {
                return /\b(buy now|wishlist|hear more|buy track|pre-order|stream)\b/i.test(
                    normalizedText(link),
                );
            },
        );

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
            /supported by/i,
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
            const text = normalizedText(current);
            const linkCount = current.querySelectorAll("a").length;
            return (
                linkCount >= 2 &&
                /\b(buy now|wishlist|hear more|buy track|pre-order|stream)\b/i.test(
                    text,
                )
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

        if (!node.__bcampxMemo) {
            node.__bcampxMemo = Object.create(null);
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
        shell.classList.add("bcampx--loading");
        text.textContent = "Loading extra context...";
        toggle.disabled = true;

        try {
            const result = await getReleaseData(releaseUrl);
            controller.loaded = true;
            controller.data = result.data;

            renderReleaseData(
                shell,
                meta,
                text,
                toggle,
                result.data,
                releaseUrl,
            );

            const shouldExpand =
                (!options.auto || CONFIG.expandAfterAutoFetch) &&
                hasExpandableContent(result.data);
            controller.expanded = shouldExpand;
            shell.classList.toggle("bcampx--expanded", shouldExpand);
            updateToggle(toggle, shouldExpand);
            text.textContent = result.fromCache
                ? "Extra context loaded from cache"
                : "Extra context loaded";
        } catch (error) {
            controller.loaded = false;
            controller.data = null;
            renderError(meta, text, releaseUrl, error);
            shell.classList.remove("bcampx--expanded");
            toggle.hidden = true;
        } finally {
            controller.loading = false;
            toggle.disabled = false;
            shell.classList.remove("bcampx--loading");
        }
    }

    function toggleDetails(controller, shell, toggle) {
        controller.expanded = !controller.expanded;
        shell.classList.toggle("bcampx--expanded", controller.expanded);
        updateToggle(toggle, controller.expanded);
    }

    function updateToggle(toggle, expanded) {
        toggle.textContent = expanded ? "Less" : "More";
    }

    async function getReleaseData(releaseUrl) {
        const cacheKey = getReleaseCacheKey(releaseUrl);
        const cached = await storageGet(cacheKey, null);

        if (isFreshReleaseCache(cached)) {
            const normalizedCached = normalizeReleaseData(cached);
            if (!shouldRefreshCachedRelease(cached, normalizedCached)) {
                return { data: normalizedCached, fromCache: true };
            }
        }

        const pending = STATE.pendingReleaseRequests.get(cacheKey);
        if (pending) {
            return pending;
        }

        const request = enqueueReleaseFetch(async () => {
            const html = await requestHtml(releaseUrl);
            const data = normalizeReleaseData(
                parseReleasePage(html, releaseUrl),
            );
            const cacheValue = buildReleaseCacheValue(data);

            await storageSet(cacheKey, cacheValue);
            return { data: cacheValue, fromCache: false };
        });

        STATE.pendingReleaseRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            if (STATE.pendingReleaseRequests.get(cacheKey) === request) {
                STATE.pendingReleaseRequests.delete(cacheKey);
            }
        }
    }

    function enqueueReleaseFetch(task) {
        return new Promise((resolve, reject) => {
            STATE.releaseFetchQueue.push({ task, resolve, reject });
            drainReleaseFetchQueue();
        });
    }

    function drainReleaseFetchQueue() {
        while (
            STATE.activeReleaseFetchCount < CONFIG.maxConcurrentFetches &&
            STATE.releaseFetchQueue.length
        ) {
            const next = STATE.releaseFetchQueue.shift();
            if (!next || typeof next.task !== "function") {
                continue;
            }

            STATE.activeReleaseFetchCount += 1;
            Promise.resolve()
                .then(() => next.task())
                .then(next.resolve, next.reject)
                .finally(() => {
                    STATE.activeReleaseFetchCount = Math.max(
                        0,
                        STATE.activeReleaseFetchCount - 1,
                    );
                    drainReleaseFetchQueue();
                });
        }
    }

    function getReleaseCacheKey(releaseUrl) {
        return `${RELEASE_CACHE_PREFIX}${releaseUrl}`;
    }

    function buildReleaseCacheValue(data) {
        return {
            ...data,
            schemaVersion: CACHE_SCHEMA_VERSION,
            fetchedAt: Date.now(),
        };
    }

    function isFreshReleaseCache(value) {
        return Boolean(
            value &&
            value.fetchedAt &&
            Date.now() - value.fetchedAt < CONFIG.cacheTtlMs,
        );
    }

    function shouldRefreshCachedRelease(rawData, normalizedData) {
        return (
            needsTrackRefresh(normalizedData) ||
            needsSchemaRefresh(rawData, normalizedData)
        );
    }

    function requestHtml(url) {
        if (canUseExternalHostMethod("requestHtml")) {
            return Promise.resolve(
                getExternalHostApi().requestHtml(
                    url,
                    getHostRequestOptions({
                        headers: {
                            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        },
                    }),
                ),
            );
        }

        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error("GM_xmlhttpRequest is not available."));
                return;
            }

            GM_xmlhttpRequest({
                method: "GET",
                url,
                timeout: CONFIG.fetchTimeoutMs,
                headers: {
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText || "");
                        return;
                    }

                    reject(new Error(`HTTP ${response.status}`));
                },
                onerror: () => reject(new Error("Network request failed.")),
                ontimeout: () =>
                    reject(new Error("Network request timed out.")),
            });
        });
    }

    function requestJson(url, options = {}) {
        if (canUseExternalHostMethod("requestJson")) {
            return Promise.resolve(
                getExternalHostApi().requestJson(
                    url,
                    getHostRequestOptions(options),
                ),
            );
        }

        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error("GM_xmlhttpRequest is not available."));
                return;
            }

            GM_xmlhttpRequest({
                method: options.method || "GET",
                url,
                data: options.data,
                timeout: CONFIG.fetchTimeoutMs,
                headers: options.headers || {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(response.responseText || "null"));
                    } catch (_error) {
                        reject(new Error("Invalid JSON response."));
                    }
                },
                onerror: () => reject(new Error("Network request failed.")),
                ontimeout: () =>
                    reject(new Error("Network request timed out.")),
            });
        });
    }

    function htmlToDocument(html) {
        return new DOMParser().parseFromString(html || "", "text/html");
    }

    function parseJsonAttribute(node, attr) {
        if (!node || !attr) {
            return null;
        }

        try {
            return JSON.parse(node.getAttribute(attr) || "null");
        } catch (_error) {
            return null;
        }
    }

    function parseReleasePage(html, releaseUrl) {
        const documentFromHtml = htmlToDocument(html);
        const tralbum = parseTralbumData(documentFromHtml);
        const jsonLd = shouldParseJsonLdFallback(tralbum)
            ? parseJsonLd(documentFromHtml)
            : null;
        const tracks = extractReleaseTracks(documentFromHtml, tralbum, jsonLd);
        const descriptionState = extractReleaseDescriptionState(
            documentFromHtml,
            tralbum,
            tracks,
        );

        return {
            url: releaseUrl,
            title: resolveReleaseTitle(documentFromHtml, tralbum, jsonLd),
            artist: resolveReleaseArtist(documentFromHtml, tralbum, jsonLd),
            releaseDate: resolveReleaseDate(documentFromHtml, tralbum, jsonLd),
            location: resolveReleaseLocation(documentFromHtml),
            artUrl: metaContent(documentFromHtml, 'meta[property="og:image"]'),
            hasBodyDescriptionSource: descriptionState.hasBodyDescriptionSource,
            description: descriptionState.description,
            descriptionHtml: descriptionState.descriptionHtml,
            tags: extractReleaseTags(documentFromHtml),
            tracks,
        };
    }

    function shouldParseJsonLdFallback(tralbum) {
        const hasTitle = Boolean(
            cleanText(
                firstString(
                    tralbum && tralbum.current && tralbum.current.title,
                    tralbum && tralbum.album_title,
                ),
            ),
        );
        const hasArtist = Boolean(cleanText(tralbum && tralbum.artist));
        const hasReleaseDate = Boolean(
            cleanText(
                firstString(
                    tralbum && tralbum.album_release_date,
                    tralbum &&
                        tralbum.current &&
                        tralbum.current.release_date,
                ),
            ),
        );
        const hasTracks = Boolean(
            tralbum &&
                Array.isArray(tralbum.trackinfo) &&
                tralbum.trackinfo.length,
        );

        return !(hasTitle && hasArtist && hasReleaseDate && hasTracks);
    }

    function normalizeReleaseData(data) {
        if (!data || typeof data !== "object") {
            return createEmptyReleaseData();
        }

        const tracks = normalizeTracks(data.tracks);
        const hasBodyDescriptionSource =
            data.hasBodyDescriptionSource !== false;
        const descriptionState = normalizeDescriptionState({
            descriptionText: data.description || "",
            descriptionHtml: data.descriptionHtml || "",
            tracks,
            hasBodyDescriptionSource,
        });

        return {
            ...createEmptyReleaseData(),
            ...data,
            hasBodyDescriptionSource,
            description: descriptionState.description,
            descriptionHtml: descriptionState.descriptionHtml,
            tags: Array.isArray(data.tags)
                ? data.tags.map((tag) => cleanText(tag)).filter(Boolean)
                : [],
            tracks,
        };
    }

    function createEmptyReleaseData() {
        return {
            url: "",
            title: "",
            artist: "",
            releaseDate: "",
            location: "",
            description: "",
            descriptionHtml: "",
            tags: [],
            tracks: [],
        };
    }

    function resolveReleaseTitle(doc, tralbum, jsonLd) {
        return (
            firstString(tralbum && tralbum.current && tralbum.current.title) ||
            firstString(tralbum && tralbum.album_title) ||
            firstString(jsonLd && jsonLd.name) ||
            metaContent(doc, 'meta[property="og:title"]') ||
            textContent(doc, ".trackTitle") ||
            textContent(doc, "h1") ||
            cleanTitle(doc.title)
        );
    }

    function resolveReleaseArtist(doc, tralbum, jsonLd) {
        return (
            firstString(tralbum && tralbum.artist) ||
            extractJsonArtist(jsonLd) ||
            textContent(doc, "#name-section .artist") ||
            textContent(doc, "#band-name-location .title") ||
            metaContent(doc, 'meta[property="og:site_name"]') ||
            ""
        );
    }

    function extractReleaseTracks(doc, tralbum, jsonLd) {
        const tralbumTracks = uniqueTracks(extractTralbumTracks(tralbum));
        if (tralbumTracks.length) {
            return tralbumTracks.slice(0, CONFIG.maxTracks);
        }

        const jsonTracks = extractJsonTracks(jsonLd);
        const domTracks = extractDomTracks(doc);

        return uniqueTracks([...jsonTracks, ...domTracks]).slice(
            0,
            CONFIG.maxTracks,
        );
    }

    function extractReleaseDescriptionState(doc, tralbum, tracks) {
        const tralbumAbout = cleanText(
            firstString(tralbum && tralbum.current && tralbum.current.about),
        );
        const tralbumAboutText = textContent(doc, ".tralbum-about");
        const albumAboutText = textContent(doc, ".album-about");
        const itempropDescriptionText = textContent(
            doc,
            "[itemprop='description']:not(meta)",
        );
        const rawDescriptionHtml = extractDescriptionHtml(doc);
        const descriptionText =
            tralbumAbout ||
            tralbumAboutText ||
            albumAboutText ||
            itempropDescriptionText ||
            "";
        const hasBodyDescriptionSource = Boolean(
            tralbumAbout ||
            tralbumAboutText ||
            albumAboutText ||
            itempropDescriptionText ||
            rawDescriptionHtml,
        );
        const descriptionState = normalizeDescriptionState({
            descriptionText,
            descriptionHtml: rawDescriptionHtml,
            tracks,
            hasBodyDescriptionSource,
        });

        return {
            hasBodyDescriptionSource,
            description: descriptionState.description,
            descriptionHtml: descriptionState.descriptionHtml,
        };
    }

    function extractReleaseTags(doc) {
        return uniqueStrings([
            ...queryTexts(doc, ".tralbum-tags a"),
            ...queryTexts(doc, "a.tag"),
            ...queryTexts(doc, 'a[href*="/tag/"]'),
        ]).filter((tag) => !/^tags?$/i.test(tag));
    }

    function resolveReleaseDate(doc, tralbum, jsonLd) {
        return (
            firstString(tralbum && tralbum.album_release_date) ||
            firstString(
                tralbum && tralbum.current && tralbum.current.release_date,
            ) ||
            firstString(jsonLd && jsonLd.datePublished) ||
            attrContent(doc, "time[datetime]", "datetime") ||
            metaContent(doc, 'meta[itemprop="datePublished"]') ||
            findReleasedDate(doc)
        );
    }

    function resolveReleaseLocation(doc) {
        return (
            textContent(doc, "#band-name-location .location") ||
            textContent(doc, ".location") ||
            ""
        );
    }

    function normalizeDescriptionState({
        descriptionText,
        descriptionHtml,
        tracks,
        hasBodyDescriptionSource,
    }) {
        const cleanDescription = cleanText(descriptionText || "");
        const truncatedDescription = truncate(
            cleanDescription,
            CONFIG.maxDescriptionLength,
        );
        const normalizedHtml =
            sanitizeDescriptionHtml(descriptionHtml || "") ||
            plainTextToDescriptionHtml(
                truncatedDescription,
                CONFIG.maxDescriptionLength,
            );
        const shouldSuppress =
            !hasBodyDescriptionSource ||
            isLikelyTracklistText(cleanDescription, tracks) ||
            isLikelyTracklistHtml(normalizedHtml, tracks);

        return {
            description: shouldSuppress ? "" : truncatedDescription,
            descriptionHtml: shouldSuppress ? "" : normalizedHtml,
        };
    }

    function normalizeTracks(tracks) {
        if (!Array.isArray(tracks)) {
            return [];
        }

        return tracks
            .map((track) => {
                if (!track) {
                    return null;
                }

                if (typeof track === "string") {
                    return createTrackData(track, "", "", "");
                }

                return createTrackData(
                    track.title,
                    track.trackId || track.track_id || "",
                    track.streamUrl || "",
                    track.duration || "",
                    track.titleLink || track.title_link || "",
                );
            })
            .filter(Boolean);
    }

    function needsTrackRefresh(data) {
        if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
            return false;
        }

        return (
            data.tracks.some((track) => track && track.title) &&
            !data.tracks.some((track) => track && track.streamUrl)
        );
    }

    function needsSchemaRefresh(rawData, normalizedData) {
        if (!rawData || rawData.schemaVersion !== CACHE_SCHEMA_VERSION) {
            return true;
        }

        if (
            (normalizedData.description && !normalizedData.descriptionHtml) ||
            (normalizedData.descriptionHtml &&
                !/<(?:p|br|a)\b/i.test(normalizedData.descriptionHtml) &&
                /\n|https?:\/\//i.test(normalizedData.description))
        ) {
            return true;
        }

        if (isLikelyTracklistDescription(normalizedData)) {
            return true;
        }

        return false;
    }

    function parseJsonLd(doc) {
        const documents = readJsonLdDocuments(doc);
        for (const item of documents) {
            const release = findJsonLdReleaseCandidate(item);
            if (release) {
                return release;
            }
        }

        return null;
    }

    function readJsonLdDocuments(doc) {
        return Array.from(
            doc.querySelectorAll('script[type="application/ld+json"]'),
        )
            .map((script) => {
                try {
                    return JSON.parse(script.textContent.trim());
                } catch (_error) {
                    return null;
                }
            })
            .filter(Boolean);
    }

    function findJsonLdReleaseCandidate(documentValue) {
        const candidates = Array.isArray(documentValue)
            ? documentValue
            : [documentValue];

        return (
            candidates.find((item) => {
                const type = Array.isArray(item["@type"])
                    ? item["@type"]
                    : [item["@type"]];
                return type.some((value) =>
                    /MusicAlbum|MusicRecording|Album|Track/i.test(
                        String(value),
                    ),
                );
            }) || null
        );
    }

    function parseTralbumData(doc) {
        const dataAttrResult = parseTralbumDataAttribute(doc);
        if (dataAttrResult) {
            return dataAttrResult;
        }

        return parseLegacyTralbumScriptFallback(doc);
    }

    function parseTralbumDataAttribute(doc) {
        const dataNode = doc.querySelector("[data-tralbum]");
        if (!dataNode) {
            return null;
        }

        try {
            return JSON.parse(dataNode.getAttribute("data-tralbum"));
        } catch (_error) {
            return null;
        }
    }

    function parseLegacyTralbumScriptFallback(doc) {
        const scripts = Array.from(doc.scripts);
        const tralbumScript = scripts.find((script) =>
            /TralbumData|trackinfo/.test(script.textContent),
        );
        if (!tralbumScript) {
            return null;
        }

        const text = tralbumScript.textContent;
        const titleMatch = text.match(/(?:album_title|title):\s*"([^"]+)"/);
        const artistMatch = text.match(/artist:\s*"([^"]+)"/);
        const dateMatch = text.match(/album_release_date:\s*"([^"]+)"/);
        const trackMatches = Array.from(
            text.matchAll(/"title"\s*:\s*"([^"]+)"/g),
        );

        return {
            album_title: titleMatch ? decodeJsString(titleMatch[1]) : "",
            artist: artistMatch ? decodeJsString(artistMatch[1]) : "",
            album_release_date: dateMatch ? decodeJsString(dateMatch[1]) : "",
            trackinfo: trackMatches.map((match) => ({
                title: decodeJsString(match[1]),
            })),
        };
    }

    function extractJsonArtist(jsonLd) {
        return getJsonLdEntityNames(jsonLd && jsonLd.byArtist);
    }

    function extractJsonTracks(jsonLd) {
        return getJsonLdArrayValue(jsonLd && jsonLd.track)
            .map((track) => {
                if (typeof track === "string") {
                    return createTrackData(track, "", "", "");
                }

                return createTrackData(
                    track && track.name,
                    "",
                    "",
                    track && track.duration ? track.duration : "",
                );
            })
            .filter(Boolean);
    }

    function getJsonLdEntityNames(value) {
        if (!value) {
            return "";
        }

        if (typeof value === "string") {
            return cleanText(value);
        }

        return getJsonLdArrayValue(value)
            .map((item) => cleanText(item && item.name))
            .filter(Boolean)
            .join(", ");
    }

    function getJsonLdArrayValue(value) {
        if (!value) {
            return [];
        }

        return Array.isArray(value) ? value : [value];
    }

    function extractDomTracks(doc) {
        const trackTitles = queryTexts(doc, "#track_table .track-title");
        const fallbackTitles = trackTitles.length
            ? trackTitles
            : queryTexts(doc, ".track-title");

        return fallbackTitles.map((title) =>
            createTrackData(title, "", "", ""),
        );
    }

    function extractTralbumTracks(tralbum) {
        if (!tralbum || !Array.isArray(tralbum.trackinfo)) {
            return [];
        }

        return tralbum.trackinfo
            .map((track) =>
                createTrackData(
                    track && track.title,
                    track && (track.track_id || track.id || ""),
                    track && track.file && track.file["mp3-128"]
                        ? track.file["mp3-128"]
                        : "",
                    track && typeof track.duration !== "undefined"
                        ? track.duration
                        : "",
                    track && track.title_link ? track.title_link : "",
                ),
            )
            .filter(Boolean);
    }

    function createTrackData(title, trackId, streamUrl, duration, titleLink) {
        const cleanTitleValue = cleanText(title);
        if (!cleanTitleValue) {
            return null;
        }

        return {
            title: cleanTitleValue,
            trackId: cleanText(trackId),
            streamUrl: cleanText(streamUrl),
            duration: normalizeTrackDuration(duration),
            titleLink: cleanText(titleLink),
        };
    }

    function normalizeTrackDuration(value) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            return formatTrackDuration(value);
        }

        const text = cleanText(value);
        if (!text) {
            return "";
        }

        if (/^\d+:\d{2}(?::\d{2})?$/.test(text)) {
            return text;
        }

        const isoMatch = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
        if (isoMatch) {
            const hours = Number(isoMatch[1] || 0);
            const minutes = Number(isoMatch[2] || 0);
            const seconds = Number(isoMatch[3] || 0);
            return formatTrackDuration(hours * 3600 + minutes * 60 + seconds);
        }

        const numeric = Number(text);
        if (Number.isFinite(numeric) && numeric > 0) {
            return formatTrackDuration(numeric);
        }

        return "";
    }

    function formatTrackDuration(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
            return "";
        }

        const whole = Math.round(totalSeconds);
        const hours = Math.floor(whole / 3600);
        const minutes = Math.floor((whole % 3600) / 60);
        const seconds = whole % 60;
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        }

        return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }

    function uniqueTracks(values) {
        const seenExact = new Set();
        const seenRichTitles = new Set();
        const seenPlainTitles = new Set();
        const result = [];

        values.forEach((track) => {
            if (!track || !track.title) {
                return;
            }

            const exactKey = getTrackUniquenessKey(track);
            const titleKey = `title:${track.title.toLowerCase()}`;
            const hasRichIdentity = !exactKey.startsWith("title:");

            if (hasRichIdentity) {
                if (seenExact.has(exactKey)) {
                    return;
                }
                seenExact.add(exactKey);
                seenRichTitles.add(titleKey);
                result.push(track);
                return;
            }

            if (seenRichTitles.has(titleKey) || seenPlainTitles.has(titleKey)) {
                return;
            }

            seenPlainTitles.add(titleKey);
            result.push(track);
        });

        return result;
    }

    function getTrackUniquenessKey(track) {
        const trackId = cleanText(track && track.trackId);
        if (trackId) {
            return `id:${trackId}`;
        }

        const titleLink = cleanText(track && track.titleLink);
        if (titleLink) {
            return `link:${titleLink.toLowerCase()}`;
        }

        const streamUrl = cleanText(track && track.streamUrl);
        if (streamUrl) {
            return `stream:${streamUrl.toLowerCase()}`;
        }

        return `title:${track.title.toLowerCase()}`;
    }

    function findReleasedDate(doc) {
        const candidates = queryTexts(
            doc,
            ".tralbumData, .tralbum-credits, .credits, #trackInfo",
        );
        for (const candidate of candidates) {
            const match = candidate.match(/released\s+([^\n.]+)/i);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return "";
    }

    function renderReleaseData(shell, meta, text, toggle, data, releaseUrl) {
        if (isFullDiscographyReleaseData(data)) {
            shell.remove();
            return;
        }

        meta.textContent = "";
        meta.hidden = false;

        if (shell.classList.contains("bcampx--supported-slot")) {
            renderSupportedSlot(meta, text, toggle, data, releaseUrl);
            shell.classList.toggle("bcampx--expanded", false);
            return;
        }

        renderStandardReleaseContent(meta, data, releaseUrl);

        if (!hasVisibleEnhancements(data)) {
            applyEmptyReleaseState(shell, meta, text, toggle, releaseUrl);
            return;
        }

        applyStandardReleaseShellState(shell, text, toggle, data);
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
        if (!(data.descriptionHtml || data.description)) {
            return;
        }

        const description = createClassedElement("p", "bcampx__description");
        renderDescriptionContent(description, data);
        meta.append(description);
    }

    function appendReleaseTrackList(meta, data) {
        if (!data.tracks || !data.tracks.length) {
            return;
        }

        const tracks = createClassedElement("ol", "bcampx__tracks");
        data.tracks.forEach((track) => {
            const item = document.createElement("li");
            item.textContent = track.title;
            tracks.append(item);
        });
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
        const purchasedTrackTitles = getMergedTrackTitleSet(
            meta.closest(CARD_SELECTOR),
        );
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
        );
        renderSupportedSlotDescription(panel, data, autoExpandState);
        appendSupportedSlotSubhead(panel, subhead);

        meta.append(panel);
        scheduleSupportedSlotAutoExpand(panel, autoExpandState);

        toggle.hidden = true;
        text.hidden = true;
    }

    function renderSupportedSlotTracks(
        panel,
        data,
        releaseUrl,
        purchasedTrackTitles,
        autoExpandState,
    ) {
        if (!data.tracks || !data.tracks.length) {
            return;
        }

        const tracks = createClassedElement(
            "ol",
            "bcampx__tracks bcampx__tracks--slot",
        );
        const initiallyVisible = Math.min(
            CONFIG.initialVisibleTracks,
            data.tracks.length,
        );

        data.tracks.forEach((track, index) => {
            tracks.append(
                createSupportedSlotTrackItem(
                    track,
                    index,
                    initiallyVisible,
                    data,
                    releaseUrl,
                    purchasedTrackTitles,
                ),
            );
        });

        panel.append(tracks);

        if (data.tracks.length <= initiallyVisible) {
            return;
        }

        tracks.classList.add("bcampx__tracks--collapsed");
        const tracksController = createExpandController({
            className: "bcampx__slot-expand",
            collapsedLabel: `Show all ${data.tracks.length} tracks`,
            expandedLabel: "Show less",
            onToggle: (expanded) => {
                tracks.classList.toggle("bcampx__tracks--collapsed", !expanded);
            },
        });
        panel.append(tracksController.button);
        autoExpandState.steps.push({
            controller: tracksController,
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
        button.disabled = !track.streamUrl;
        button.dataset.trackId = track.trackId || "";
        button.dataset.streamUrl = track.streamUrl || "";
        button.addEventListener("click", () =>
            playSharedTrack(button, track, data, releaseUrl),
        );
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
        if (!(data.descriptionHtml || data.description)) {
            return;
        }

        const descriptionBlock = createClassedElement(
            "div",
            "bcampx__description-block",
        );
        const description = createClassedElement(
            "div",
            "bcampx__description bcampx__description--slot",
        );
        renderDescriptionContent(description, data);
        descriptionBlock.append(description);
        panel.append(descriptionBlock);

        window.requestAnimationFrame(() => {
            if (!description.isConnected) {
                return;
            }

            normalizeDescriptionContent(description);
            description.classList.add("bcampx__description--collapsed");
            if (description.scrollHeight > description.clientHeight + 6) {
                const descriptionController = createExpandController({
                    className:
                        "bcampx__slot-expand bcampx__slot-expand--description",
                    collapsedLabel: "Show more",
                    expandedLabel: "Show less",
                    onToggle: (expanded) => {
                        description.classList.toggle(
                            "bcampx__description--collapsed",
                            !expanded,
                        );
                    },
                });
                descriptionBlock.append(descriptionController.button);
                autoExpandState.steps.push({
                    controller: descriptionController,
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
        window.requestAnimationFrame(() =>
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

    function renderError(meta, text, releaseUrl, error) {
        meta.textContent = "";
        meta.hidden = false;
        const message = createClassedElement("p", "bcampx__error");
        message.textContent = `Could not load release details: ${error && error.message ? error.message : "unknown error"}`;

        meta.append(message, createOpenReleaseLink(releaseUrl));
        text.textContent = "Extra context failed to load";
    }

    function renderEmpty(meta, text, releaseUrl) {
        meta.textContent = "";
        meta.hidden = false;
        const message = createClassedElement("p", "bcampx__empty");
        message.textContent = "No extra metadata found for this release.";

        meta.append(message, createOpenReleaseLink(releaseUrl));
        text.textContent = "No extra context available";
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

    function renderDescriptionContent(container, data) {
        const html = sanitizeDescriptionHtml(
            data && data.descriptionHtml ? data.descriptionHtml : "",
        );
        if (html) {
            container.innerHTML = html;
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
                availableData || (await getReleaseData(releaseUrl)).data;
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
            if (action === "wishlist" || action === "basket") {
                if (action === "wishlist") {
                    await requestTrackActionViaHelper(action, trackUrl, button);
                } else {
                    openTrackBuyWindow(trackUrl);
                    setTrackActionButtonPending(button, false);
                    flashTrackActionButton(button, "Opened");
                }
            } else {
                throw new Error("Track action is disabled.");
            }
        } catch (_error) {
            setTrackActionButtonPending(button, false);
            flashTrackActionButton(button, "Error");
        }
    }

    function requestTrackActionViaHelper(action, trackUrl, button) {
        setupTrackActionMessageBridge();

        return new Promise((resolve, reject) => {
            const origin = getTrackActionOrigin(trackUrl);
            if (!origin) {
                reject(new Error("Invalid track URL."));
                return;
            }

            const requestId = createTrackActionRequestId();
            const iframe = createTrackActionIframe();
            const helperUrl = buildTrackActionHelperUrl(
                trackUrl,
                action,
                requestId,
            );
            const timeoutId = scheduleTrackActionTimeout({
                action,
                trackUrl,
                origin,
                requestId,
                reject,
            });

            attachTrackActionIframeErrorHandler(iframe, {
                action,
                trackUrl,
                origin,
                requestId,
                reject,
            });
            registerPendingTrackActionRequest({
                requestId,
                action,
                button,
                iframe,
                origin,
                timeoutId,
                resolve,
                reject,
            });

            iframe.src = helperUrl;
            document.body.appendChild(iframe);
        });
    }

    function openTrackBuyWindow(trackUrl) {
        const helperUrl = buildTrackActionHelperUrl(trackUrl, "buy-dialog");
        const openedWindow = window.open(
            helperUrl,
            "_blank",
            "noopener,noreferrer",
        );
        if (openedWindow && !openedWindow.closed) {
            return;
        }

        const link = document.createElement("a");
        link.href = helperUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
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

    function scheduleTrackActionTimeout({
        action,
        trackUrl,
        origin,
        requestId,
        reject,
    }) {
        return window.setTimeout(() => {
            const pending = finalizePendingTrackActionRequest(requestId);
            if (!pending) {
                return;
            }
            recordTrackActionDiagnostic("action-timeout", {
                action,
                trackUrl,
                origin,
            });
            reject(new Error(`${action} request timed out.`));
        }, 12000);
    }

    function attachTrackActionIframeErrorHandler(
        iframe,
        { action, trackUrl, origin, requestId, reject },
    ) {
        iframe.addEventListener(
            "error",
            () => {
                const pending = finalizePendingTrackActionRequest(requestId);
                if (!pending) {
                    return;
                }
                recordTrackActionDiagnostic("iframe-load-error", {
                    action,
                    trackUrl,
                    origin,
                });
                reject(new Error(`${action} helper could not load.`));
            },
            { once: true },
        );
    }

    function registerPendingTrackActionRequest(pending) {
        STATE.pendingTrackActionRequests.set(pending.requestId, pending);
    }

    function setTrackActionButtonPending(button, pending) {
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

    async function requestTrackWishlist(context) {
        const crumbKey = context.isWishlisted
            ? "uncollect_item_cb"
            : "collect_item_cb";
        const endpoint = context.isWishlisted
            ? "/uncollect_item_cb"
            : "/collect_item_cb";
        const crumb =
            resolveCrumbValue(context && context.crumbs, crumbKey) ||
            resolveCrumbValue(getCurrentPageCrumbs(), crumbKey);
        if (!crumb) {
            throw new Error("Wishlist crumb is missing.");
        }

        const payload = new URLSearchParams();
        payload.set(
            "fan_id",
            String(context.fanId || context.collectInfo.fan_id || ""),
        );
        payload.set(
            "item_id",
            String(
                context.collectInfo.collect_item_id || context.current.id || "",
            ),
        );
        payload.set(
            "item_type",
            getCollectItemType(
                context.collectInfo.collect_item_type ||
                    context.current.type ||
                    "track",
            ),
        );
        payload.set(
            "band_id",
            String(
                context.collectInfo.collect_band_id ||
                    context.current.band_id ||
                    context.bandData.id ||
                    "",
            ),
        );
        payload.set("crumb", crumb);

        const response = await requestJson(`${context.origin}${endpoint}`, {
            method: "POST",
            data: payload.toString(),
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
        });

        if (!response || response.ok !== true) {
            throw new Error(
                response && response.error_message
                    ? response.error_message
                    : "Wishlist request failed.",
            );
        }
    }

    function getCurrentPageCrumbs() {
        return (
            parseJsonAttribute(
                document.querySelector("#js-crumbs-data"),
                "data-crumbs",
            ) || {}
        );
    }

    function resolveCrumbValue(crumbs, key) {
        if (!crumbs || !key || typeof crumbs !== "object") {
            return "";
        }

        const value = crumbs[key];
        if (typeof value === "string") {
            return cleanText(value);
        }

        if (value && typeof value === "object") {
            return cleanText(value.crumb || value.value || "");
        }

        return "";
    }

    function getCollectItemType(value) {
        const type = cleanText(value).toLowerCase();
        if (type === "track" || type === "t") {
            return "track";
        }
        if (type === "album" || type === "a") {
            return "album";
        }
        if (type === "bundle" || type === "b") {
            return "bundle";
        }
        return type || "track";
    }

    async function requestTrackBasket(context) {
        const payload = new URLSearchParams();
        payload.set("req", "add");
        payload.set(
            "local_id",
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        payload.set(
            "item_type",
            getShortItemType(context.current.type || "track"),
        );
        payload.set("item_id", String(context.current.id || ""));
        payload.set("unit_price", String(context.unitPrice || 0));
        payload.set("quantity", "1");
        payload.set("option_id", "");
        payload.set("discount_id", "");
        payload.set("discount_type", "");
        payload.set("download_type", "");
        payload.set("download_id", "");
        payload.set("purchase_note", "");
        payload.set("notify_me", "false");
        payload.set("notify_me_label", "false");
        payload.set(
            "band_id",
            String(context.bandData.id || context.current.band_id || ""),
        );
        payload.set("releases", "");
        payload.set(
            "ip_country_code",
            cleanText(
                context.pagedataBlob.user_territory ||
                    context.pagedataBlob.identities?.ip_country_code ||
                    context.pagedataBlob.ip_location_country_code ||
                    "",
            ) || "US",
        );
        payload.set(
            "associated_license_id",
            String(context.current.licensed_item_id || ""),
        );
        payload.set("checkout_now", "false");
        payload.set("shipping_exception_mode", "");
        payload.set("is_cardable", "true");
        payload.set("cart_length", String(getCurrentCartLength()));
        payload.set(
            "client_id",
            `bcampx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        );
        payload.set("sync_num", "1");
        if (context.fanId) {
            payload.set("fan_id", String(context.fanId));
        }
        if (context.refToken) {
            payload.set("ref_token", context.refToken);
        }

        const response = await requestJson(`${context.origin}/cart/cb`, {
            method: "POST",
            data: payload.toString(),
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
        });

        if (!response || response.unexpected_error || response.error) {
            throw new Error(
                response && response.error_message
                    ? response.error_message
                    : "Add to basket failed.",
            );
        }
    }

    function getShortItemType(value) {
        const type = cleanText(value).toLowerCase();
        if (type === "track" || type === "t") {
            return "t";
        }
        if (type === "album" || type === "a") {
            return "a";
        }
        if (type === "bundle" || type === "b") {
            return "b";
        }
        return type.slice(0, 1) || "t";
    }

    function getCurrentFanId() {
        const blob =
            parseJsonAttribute(
                document.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        return (
            Number(blob.identities?.fan?.id || blob.fan_info?.fan_id || 0) || 0
        );
    }

    function getCurrentCartLength() {
        const blob =
            parseJsonAttribute(
                document.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        const quantity =
            blob.menubar && typeof blob.menubar.cart_quantity !== "undefined"
                ? Number(blob.menubar.cart_quantity)
                : 0;
        return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    }

    function isFullDiscographyReleaseData(data) {
        const title = cleanText(data && data.title);
        return /\bfull(?:\s+digital)?\s+discography\b/i.test(title);
    }

    function playTrackForCard(card, triggerButton, track, data, releaseUrl) {
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
        setActiveTrackContext(track, data, releaseUrl, card, cardArtUrl);
        syncActiveTrackUi(cardArtUrl);
        audio.play().catch(() => {
            clearActiveTrackButton();
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

        if (
            !STATE.activeTrackCard ||
            !document.contains(STATE.activeTrackCard)
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        scrollCardIntoView(STATE.activeTrackCard, STATE.activeTrack);
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

    function syncCoverPlaybackState() {
        if (STATE.coverPlaybackStateNode) {
            STATE.coverPlaybackStateNode.classList.remove("playing", "paused");
            STATE.coverPlaybackStateNode = null;
        }

        const card =
            STATE.activeTrackCard && document.contains(STATE.activeTrackCard)
                ? STATE.activeTrackCard
                : null;
        if (!card) {
            return;
        }

        const stateNode = findCoverPlaybackStateNodeForCard(card);
        if (!stateNode) {
            return;
        }

        STATE.coverPlaybackStateNode = stateNode;
        const audio = ensureSharedAudio();
        if (!audio) {
            return;
        }

        if (audio.paused) {
            stateNode.classList.add("paused");
        } else {
            stateNode.classList.add("playing");
        }
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

    function setActiveTrackContext(track, data, releaseUrl, card, cardArtUrl) {
        STATE.activeTrack = track || null;
        STATE.activeReleaseData = data || null;
        STATE.activeReleaseUrl = releaseUrl || "";
        STATE.activeTrackCard = card || null;
        STATE.activeCardArtUrl = cardArtUrl || STATE.activeCardArtUrl || "";

        const tracks =
            data && Array.isArray(data.tracks)
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

        STATE.uiSyncFrame = window.requestAnimationFrame(() => {
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
            navigator.mediaSession.playbackState = "none";
            return;
        }

        navigator.mediaSession.playbackState = audio.paused
            ? "paused"
            : "playing";
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
            ".tralbum-art-large",
        ];

        let image = null;
        for (const selector of selectors) {
            image = card.querySelector(selector);
            if (image) {
                break;
            }
        }

        return image ? image.currentSrc || image.src || "" : "";
    }

    function findWaypointScrollTarget(card, track) {
        const trackId = cleanText(track && track.trackId);
        if (trackId) {
            const matches = Array.from(
                document.querySelectorAll(
                    `[data-trackid="${CSS.escape(trackId)}"]`,
                ),
            ).filter((node) => {
                return node instanceof HTMLElement && isNodeVisible(node);
            });

            const preferred = matches
                .map((node) => {
                    return (
                        node.closest(
                            ".story-innards.collection-item-container",
                        ) ||
                        node.closest(".collection-item-container") ||
                        node.closest(".story") ||
                        node
                    );
                })
                .find(Boolean);

            if (preferred) {
                return preferred;
            }
        }

        return card || null;
    }

    function scrollCardIntoView(card, track) {
        if (!card) {
            return;
        }

        const target = findWaypointScrollTarget(card, track);
        if (!target) {
            return;
        }

        if (window.Dom && typeof window.Dom.scrollToElement === "function") {
            window.Dom.scrollToElement(target, -30);
            return;
        }

        const cardRect = target.getBoundingClientRect();
        const targetTop = window.scrollY + cardRect.top - 30;
        window.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth",
        });
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

        const prevButton = document.createElement("button");
        prevButton.type = "button";
        prevButton.className = "bcampx-player-button";
        prevButton.textContent = "Previous";
        prevButton.addEventListener("click", playPreviousTrack);

        const nextButton = document.createElement("button");
        nextButton.type = "button";
        nextButton.className = "bcampx-player-button";
        nextButton.textContent = "Next";
        nextButton.addEventListener("click", playNextTrack);

        const releaseButton = document.createElement("button");
        releaseButton.type = "button";
        releaseButton.className =
            "bcampx-player-button bcampx-player-button--circle";
        releaseButton.innerHTML = OPEN_ICON_MARKUP;
        releaseButton.setAttribute("aria-label", "Open release");
        releaseButton.addEventListener("click", openActiveRelease);

        const favoriteButton = document.createElement("button");
        favoriteButton.type = "button";
        favoriteButton.className =
            "bcampx-player-button bcampx-player-button--circle bcampx-player-favorite";
        favoriteButton.innerHTML = FAVORITE_ICON_MARKUP;
        favoriteButton.setAttribute("aria-label", "Add to wishlist");
        favoriteButton.setAttribute("aria-pressed", "false");
        favoriteButton.addEventListener("click", toggleActiveWishlist);

        const settingsWrap = document.createElement("div");
        settingsWrap.className = "bcampx-player-settings";

        const settingsButton = document.createElement("button");
        settingsButton.type = "button";
        settingsButton.className =
            "bcampx-player-button bcampx-player-button--circle bcampx-player-settings-toggle";
        settingsButton.innerHTML = SETTINGS_ICON_MARKUP;
        settingsButton.setAttribute("aria-label", "Open settings");
        settingsButton.setAttribute("aria-haspopup", "menu");
        settingsButton.setAttribute("aria-expanded", "false");
        settingsButton.addEventListener("click", togglePlayerSettingsMenu);

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

        const continuousModeSetting = createPlayerSettingsToggleRow({
            label: "Continuous mode",
            description: "When one release finishes, keep going to the next playable release in the feed.",
            checked: CONFIG.continuousMode,
            onChange: handleContinuousModeSettingChange,
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
            continuousModeSetting.row,
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
        const now = document.createElement("div");
        now.className = "bcampx-player-now";
        now.textContent = "Now Playing";

        const trackLink = document.createElement("button");
        trackLink.type = "button";
        trackLink.className = "bcampx-player-track";
        trackLink.textContent = "Select a preview track";
        trackLink.addEventListener("click", scrollToActiveTrackCard);

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
        document.body.append(host);

        STATE.playerUi = {
            host,
            shadowRoot,
            shell,
            prevButton,
            nextButton,
            favoriteButton,
            releaseButton,
            settingsButton,
            settingsMenu,
            trackRowActionsSettingInput: trackRowActionsSetting.input,
            continuousModeSettingInput: continuousModeSetting.input,
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

        ui.shell.hidden = !hasTrack;
        if (!hasTrack && STATE.playerSettingsOpen) {
            closePlayerSettingsMenu();
        }
        document.documentElement.classList.toggle(
            "bcampx-player-active",
            hasTrack,
        );
        if (!hasTrack) {
            return;
        }

        const track = STATE.activeTrack;
        const data = STATE.activeReleaseData || {};
        const releaseUrl = STATE.activeReleaseUrl || "#";
        const canGoPrev =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                -1,
            ) >= 0 ||
            (CONFIG.continuousMode && hasNeighborPlayableRelease(-1));
        const canGoNext =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                1,
            ) >= 0 ||
            (CONFIG.continuousMode && hasNeighborPlayableRelease(1));
        ui.prevButton.disabled = !canGoPrev;
        ui.nextButton.disabled = !canGoNext;
        ui.favoriteButton.disabled = !findActiveWishlistControl();
        ui.releaseButton.disabled = !releaseUrl || releaseUrl === "#";
        ui.trackLink.textContent =
            `${data.artist || ""}${data.artist && track.title ? " - " : ""}${track.title || data.title || ""}` ||
            "Select a preview track";
        ui.storeLink.textContent =
            data.title && data.artist
                ? `${data.title} / ${data.artist}`
                : data.title || data.artist || "No track selected";
        ui.storeLink.href = releaseUrl;
        attachSharedAudioToPlayer(ui.nativeAudio, audio);
        syncFavoriteButtonState();
        syncPlayerSettingsMenu();
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
        ui.settingsButton.setAttribute("aria-expanded", open ? "true" : "false");
        ui.settingsButton.setAttribute(
            "aria-label",
            open ? "Close settings" : "Open settings",
        );
        ui.settingsMenu.hidden = !open;
        if (ui.trackRowActionsSettingInput) {
            ui.trackRowActionsSettingInput.checked =
                !!CONFIG.enableTrackRowActions;
        }
        if (ui.continuousModeSettingInput) {
            ui.continuousModeSettingInput.checked = !!CONFIG.continuousMode;
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

    function handleContinuousModeSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.continuousMode = checked;
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
        const neighbor = findNeighborPlayableRelease(offset);
        if (!neighbor) {
            return false;
        }

        try {
            const data = await getAvailableOrFetchReleaseDataForCard(
                neighbor.card,
                neighbor.releaseUrl,
            );
            const track = offset < 0
                ? findLastPlayableTrack(data)
                : findFeaturedTrackForCard(neighbor.card, null, data) ||
                  findFirstPlayableTrack(data);
            if (!track || !track.streamUrl) {
                return false;
            }

            playTrackForCard(
                neighbor.card,
                null,
                track,
                data,
                neighbor.releaseUrl,
            );
            return true;
        } catch (_error) {
            return false;
        }
    }

    function hasNeighborPlayableRelease(offset) {
        return Boolean(findNeighborPlayableRelease(offset));
    }

    function findNeighborPlayableRelease(offset) {
        const currentCard = getStoryRoot(STATE.activeTrackCard) || STATE.activeTrackCard;
        if (!(currentCard instanceof Element) || !offset) {
            return null;
        }

        const cards = Array.from(document.querySelectorAll("li.story, .story"));
        const currentIndex = cards.indexOf(currentCard);
        if (currentIndex < 0) {
            return null;
        }

        const step = offset > 0 ? 1 : -1;
        for (
            let index = currentIndex + step;
            index >= 0 && index < cards.length;
            index += step
        ) {
            const card = cards[index];
            if (!isContinuousPlaybackCandidate(card)) {
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

            return {
                card,
                releaseUrl: normalizedReleaseUrl,
            };
        }

        return null;
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

        return !!getCardPrimaryReleaseUrl(card);
    }

    async function getAvailableOrFetchReleaseDataForCard(card, releaseUrl) {
        const available = getAvailableReleaseDataForCard(card, releaseUrl);
        if (available) {
            return available;
        }

        const result = await getReleaseData(releaseUrl);
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

    function scrollToActiveTrackCard() {
        if (
            !STATE.activeTrackCard ||
            !document.contains(STATE.activeTrackCard)
        ) {
            return;
        }

        scrollCardIntoView(STATE.activeTrackCard, STATE.activeTrack);
    }

    function attachSharedAudioToPlayer(container, audio) {
        if (!container || !audio) {
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
        return `
      .bcampx-player-shell {
        position: fixed;
        left: 50%;
        bottom: 18px;
        width: min(920px, calc(100vw - 36px));
        transform: translateX(-50%);
        pointer-events: auto;
        padding: 14px;
        border: 1px solid rgba(190, 198, 204, 0.68);
        border-radius: 18px;
        background: rgba(247, 247, 247, 0.98);
        box-shadow: 0 18px 40px rgba(36, 28, 20, 0.12);
        color: #2f2f2f;
        overflow: visible;
        isolation: isolate;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }

      .bcampx-player-controls {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
      }

      .bcampx-player-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 80px;
        min-height: 38px;
        padding: 8px 12px;
        border: solid 1px #dedede;
        border-radius: 999px;
        background-color: #fbfcfd;
        background-image: none;
        color: #408294;
        font: 700 13px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
        cursor: pointer;
        white-space: nowrap;
        text-align: center;
        outline: none;
        box-shadow: none;
      }

      .bcampx-player-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .bcampx-player-button--circle {
        width: 38px;
        min-width: 38px;
        min-height: 38px;
        padding: 0;
      }

      .bcampx-player-button--circle svg {
        width: 18px;
        height: 18px;
        display: block;
        flex: 0 0 auto;
      }

      .bcampx-player-settings {
        position: relative;
        margin-left: auto;
        display: flex;
        align-items: center;
        flex: 0 0 auto;
      }

      .bcampx-player-settings-toggle {
        color: #408294;
        border-color: #dedede;
        background-color: #fbfcfd;
      }

      .bcampx-player-settings-toggle svg {
        width: 19px;
        height: 19px;
      }

      .bcampx-player-settings-toggle:hover {
        border-color: #b8c6cf;
        background-color: #f3f7f9;
        color: #408294;
      }

      .bcampx-player-settings-menu {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        z-index: 20;
        min-width: 220px;
        padding: 12px 13px;
        border: 1px solid rgba(190, 198, 204, 0.9);
        border-radius: 12px;
        background: rgba(251, 252, 253, 0.98);
        box-shadow: 0 14px 32px rgba(36, 28, 20, 0.14);
        color: #2f2f2f;
        max-height: min(55vh, 420px);
        overflow: auto;
      }

      .bcampx-player-settings-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 0;
        cursor: pointer;
      }

      .bcampx-player-settings-row + .bcampx-player-settings-row {
        border-top: 1px solid rgba(222, 222, 222, 0.85);
      }

      .bcampx-player-settings-copy {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }

      .bcampx-player-settings-label {
        color: #2f2f2f;
        font: 700 13px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      .bcampx-player-settings-description {
        color: #666;
        font: 500 12px/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      .bcampx-player-settings-checkbox {
        margin: 2px 0 0;
        inline-size: 14px;
        block-size: 14px;
        accent-color: #408294;
        flex: 0 0 auto;
      }

      .bcampx-player-settings-footer {
        margin-top: 8px;
        padding-top: 10px;
        border-top: 1px solid rgba(222, 222, 222, 0.85);
        color: #777;
        font: 500 11px/1.45 "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      .bcampx-player-settings-footer-link {
        color: #408294;
        text-decoration: none;
      }

      .bcampx-player-settings-footer-link:hover {
        text-decoration: underline;
      }

      .bcampx-player-button:hover {
        text-decoration: none;
        background-color: #f3f7f9;
      }

      .bcampx-player-favorite {
        color: #408294;
        position: relative;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, background-image 120ms ease;
      }

      .bcampx-player-favorite-outline,
      .bcampx-player-favorite-fill {
        transition: opacity 120ms ease;
      }

      .bcampx-player-favorite-fill {
        opacity: 0;
      }

      .bcampx-player-favorite.active {
        border: solid 1px #e06d2f;
        background-color: #e06d2f;
        background-image: none;
        color: #fff;
      }

      .bcampx-player-favorite.active:hover,
      .bcampx-player-button--circle:hover {
        border-color: #b8c6cf;
        background-color: #f3f7f9;
        color: #408294;
      }

      .bcampx-player-favorite.active:hover {
        border-color: #d66428;
        background-color: #d66428;
        color: #fff;
      }

      .bcampx-player-favorite.active .bcampx-player-favorite-outline {
        opacity: 0;
      }

      .bcampx-player-favorite.active .bcampx-player-favorite-fill {
        opacity: 1;
      }

      .bcampx-player-meta {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 8px;
      }

      .bcampx-player-now {
        display: inline-block;
        margin-bottom: 5px;
        font-size: 12px;
        line-height: 1;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #777;
      }

      .bcampx-player-track {
        display: block;
        padding: 0;
        border: 0;
        background: transparent;
        color: #2f2f2f;
        font: 700 16px/1.04 "Helvetica Neue", Helvetica, Arial, sans-serif;
        text-align: left;
        cursor: pointer;
      }

      .bcampx-player-track:hover,
      .bcampx-player-store:hover {
        text-decoration: underline;
      }

      .bcampx-player-store {
        color: #6b6b6b;
        text-decoration: none;
        font: 500 13px/1.05 "Helvetica Neue", Helvetica, Arial, sans-serif;
        text-align: right;
        white-space: nowrap;
      }

      .bcampx-player-native {
        margin-top: 2px;
        background: transparent;
      }

      .bcampx-player-audio {
        width: 100%;
        height: 40px;
        border-radius: 10px;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: static !important;
        pointer-events: auto !important;
      }

      @media (max-width: 820px) {
        .bcampx-player-shell {
          left: 50%;
          bottom: 10px;
          width: min(920px, calc(100vw - 20px));
          transform: translateX(-50%);
          padding: 10px 12px;
          border-radius: 16px;
        }

        .bcampx-player-controls {
          gap: 6px;
          margin-bottom: 8px;
        }

        .bcampx-player-button {
          min-height: 34px;
          min-width: 74px;
          padding: 7px 10px;
          font-size: 12px;
        }

        .bcampx-player-button--circle {
          width: 34px;
          min-width: 34px;
          min-height: 34px;
        }

        .bcampx-player-button--circle svg {
          width: 17px;
          height: 17px;
        }

        .bcampx-player-settings-menu {
          min-width: 200px;
          padding: 11px 12px;
        }

        .bcampx-player-settings-toggle svg {
          width: 18px;
          height: 18px;
        }

        .bcampx-player-meta {
          gap: 8px;
          margin-bottom: 7px;
        }

        .bcampx-player-track {
          font-size: 15px;
          line-height: 1.03;
        }

        .bcampx-player-store,
        .bcampx-player-now {
          font-size: 11px;
        }

        .bcampx-player-now {
          margin-bottom: 4px;
        }

        .bcampx-player-audio {
          height: 36px;
        }
      }
    `;
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
        if (!STATE.activeTrackCard) {
            return null;
        }

        const collectRoot =
            STATE.activeTrackCard.querySelector(".collect-item") ||
            STATE.activeTrackCard.querySelector(
                ".tralbum-wrapper-collect-controls",
            ) ||
            STATE.activeTrackCard;

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

        const wishlistControl = findActiveWishlistControl();
        const active = isWishlistActive(wishlistControl);
        ui.favoriteButton.classList.toggle("active", active);
        ui.favoriteButton.setAttribute(
            "aria-pressed",
            active ? "true" : "false",
        );
        ui.favoriteButton.setAttribute(
            "aria-label",
            active ? "Remove from wishlist" : "Add to wishlist",
        );
    }

    function toggleActiveWishlist() {
        const ui = STATE.playerUi;
        const wishlistControl = findActiveWishlistControl();
        if (!wishlistControl) {
            return;
        }

        if (ui && ui.favoriteButton) {
            const nextActive =
                ui.favoriteButton.getAttribute("aria-pressed") !== "true";
            ui.favoriteButton.classList.toggle("active", nextActive);
            ui.favoriteButton.setAttribute(
                "aria-pressed",
                nextActive ? "true" : "false",
            );
            ui.favoriteButton.setAttribute(
                "aria-label",
                nextActive ? "Remove from wishlist" : "Add to wishlist",
            );
        }

        wishlistControl.click();
        window.setTimeout(syncFavoriteButtonState, 60);
        window.setTimeout(syncFavoriteButtonState, 260);
        window.setTimeout(syncFavoriteButtonState, 700);
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
        button.textContent = isPaused ? "Play" : "Pause";
        button.setAttribute("aria-label", isPaused ? "Play" : "Pause");
        button.classList.toggle("bcampx__waypoint-toggle--paused", isPaused);
    }

    function injectStyles() {
        const style = document.createElement("style");
        style.textContent = `
      .bcampx {
        box-sizing: border-box;
        margin: 6px 0 0;
        padding: 0;
        max-width: 360px;
        color: #444;
        font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .bcampx * {
        box-sizing: border-box;
      }

      .bcampx__meta {
        display: block;
        color: #555;
        padding-top: 4px;
      }

      .bcampx__summary {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 4px;
        color: #777;
      }

      .bcampx--supported-slot {
        max-width: none;
        margin: 0;
        padding: 0;
      }

      .bcampx--supported-slot .bcampx__meta {
        padding: 0;
        max-width: none;
        color: #5d5d5d;
        font: 400 12px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      .bcampx__slot-panel {
        padding: 0;
        border-left: 0;
      }

      .bcampx__summary-text {
        min-width: 0;
      }

      .bcampx__merge-note {
        margin: 8px 0 12px;
        color: #8a8a8a;
        font: 400 12px/1.34 "Helvetica Neue", Helvetica, Arial, sans-serif;
        text-align: left;
      }

      .bcampx__merge-fan {
        color: #6d6d6d;
        font-weight: 600;
      }

      .bcampx__merge-copy {
        color: #8a8a8a;
      }

      .bcampx__merge-track-button {
        padding: 0;
        border: 0;
        background: transparent;
        color: #4085b6;
        font: inherit;
        line-height: inherit;
        text-align: left;
        text-decoration: none;
        cursor: pointer;
      }

      .bcampx__merge-track-button:hover {
        text-decoration: underline;
      }

      .bcampx__merge-track-button.bcampx__track-link--active {
        color: #4085b6;
        text-decoration: underline;
      }

      .bcampx__merge-track-button:disabled {
        cursor: progress;
        opacity: 0.75;
      }

      .bcampx__toggle {
        cursor: pointer;
        padding: 0;
        border: 0;
        background: transparent;
        color: #4085b6;
        font: inherit;
        text-decoration: underline;
      }

      .bcampx__toggle:disabled {
        cursor: progress;
        opacity: 0.68;
      }

      .bcampx__facts {
        color: #666;
      }

      .bcampx__slot-header {
        margin: 0 0 7px;
        color: #757575;
        font-size: 10px;
        line-height: 1.2;
        font-weight: 600;
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }

      .bcampx__slot-subhead {
        margin: 8px 0 0;
        color: #949494;
        font-size: 11px;
        font-weight: 400;
      }

      .bcampx__description {
        margin: 6px 0 0;
        color: #333;
        white-space: pre-line;
      }

      .bcampx__tracks {
        display: none;
        margin: 6px 0 0 18px;
        padding: 0;
      }

      .bcampx--expanded .bcampx__tracks {
        display: block;
      }

      .bcampx__tracks li {
        margin: 2px 0;
      }

      .bcampx__tracks--slot {
        display: block;
        margin: 0;
        padding-left: 0;
        list-style: none;
        counter-reset: bcampxTrackNumber;
        color: #4a4a4a;
        font-size: 12px;
        font-weight: 400;
      }

      .bcampx__tracks--slot li {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) auto;
        column-gap: 7px;
        align-items: start;
        margin: 0;
        padding: 2px 0 5px;
        line-height: 1.28;
        border-top: 0;
      }

      .bcampx__tracks--slot li:first-child {
        border-top: 0;
        padding-top: 0;
      }

      .bcampx__tracks--slot.bcampx__tracks--collapsed .bcampx__track-item--extra {
        display: none;
      }

      .bcampx__tracks--slot li::before {
        counter-increment: bcampxTrackNumber;
        content: counter(bcampxTrackNumber) ".";
        color: #aaaaaa;
        font-variant-numeric: tabular-nums;
        align-self: start;
        justify-self: start;
        padding-top: 1px;
      }

      .bcampx__track-item--purchased::before {
        color: #4085b6;
        font-weight: 400;
      }

      .bcampx__track-link {
        cursor: pointer;
        display: block;
        width: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: inherit;
        text-align: left;
        text-decoration: none;
        min-width: 0;
        margin: 0;
      }

      .bcampx__track-link:hover {
        color: #4085b6;
        text-decoration: underline;
      }

      .bcampx__track-link--active {
        color: #4085b6;
        font-weight: 400;
        text-decoration: underline;
      }

      .bcampx__track-item--purchased .bcampx__track-link {
        color: #333;
        font-weight: 400;
      }

      .bcampx__track-duration {
        color: #a0a0a0;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        padding-top: 1px;
        text-align: right;
        opacity: 0.88;
        align-self: start;
      }

      .bcampx__track-end {
        display: flex;
        justify-content: flex-end;
        align-items: flex-start;
        min-width: 42px;
      }

      .bcampx__track-actions {
        display: none;
        align-items: center;
        gap: 6px;
        margin-top: -1px;
      }

      .bcampx__tracks--slot li:hover .bcampx__track-end--has-actions .bcampx__track-duration,
      .bcampx__track-item--show-actions .bcampx__track-duration {
        display: none;
      }

      .bcampx__tracks--slot li:hover .bcampx__track-end--has-actions .bcampx__track-actions,
      .bcampx__track-item--show-actions .bcampx__track-actions {
        display: flex;
      }

      .bcampx__track-action {
        padding: 0;
        border: 0;
        background: transparent;
        color: #6f8eaa;
        font: 400 10px/1.2 "Helvetica Neue", Helvetica, Arial, sans-serif;
        cursor: pointer;
        text-transform: lowercase;
      }

      .bcampx__track-action:hover {
        color: #4085b6;
        text-decoration: underline;
      }

      .bcampx__track-action:disabled {
        cursor: default;
        opacity: 0.7;
      }

      .bcampx__track-action--pending,
      .bcampx__track-action--flash {
        color: #4085b6;
      }

      .bcampx__track-action-frame {
        position: fixed;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
        left: -9999px;
        top: -9999px;
        border: 0;
      }

      .bcampx__track-link:disabled {
        cursor: default;
        opacity: 0.55;
      }


      .bcampx__description--slot {
        margin-top: 10px;
        color: #757575;
        font-size: 12px;
        line-height: 1.4;
        white-space: normal;
      }

      .bcampx__description-block {
        display: block;
        margin-top: 10px;
        padding-top: 0;
        border-top: 0;
      }

      .bcampx__description--slot p {
        margin: 0 0 5px;
      }

      .bcampx__description--slot p:last-child {
        margin-bottom: 0;
      }

      .bcampx__description--slot.bcampx__description--collapsed {
        max-height: calc(1.35em * 4);
        overflow: hidden;
      }

      .bcampx__description--slot a {
        color: #4085b6;
        text-decoration: none;
      }

      .bcampx__description--slot a:hover {
        text-decoration: underline;
      }

      .bcampx__slot-expand {
        display: inline-block;
        margin-top: 3px;
        padding: 0;
        border: 0;
        background: transparent;
        color: #6f8eaa;
        font: 400 11px/1.2 "Helvetica Neue", Helvetica, Arial, sans-serif;
        cursor: pointer;
        text-decoration: none;
      }


      .bcampx__slot-expand:hover {
        color: #4085b6;
        text-decoration: underline;
      }

      #track_play_waypoint {
        display: none !important;
      }

      .bcampx__waypoint-toggle {
        position: absolute;
        right: -18px;
        top: 50%;
        transform: translateY(-50%);
        min-width: 62px;
        padding: 6px 14px;
        border: 1px solid rgba(255, 255, 255, 0.65);
        border-radius: 999px;
        background: rgba(120, 120, 120, 0.92);
        color: #fff;
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
        z-index: 4;
      }

      .bcampx__waypoint-toggle:hover {
        background: rgba(105, 105, 105, 0.98);
      }

      .bcampx__waypoint-toggle--paused {
        background: rgba(132, 132, 132, 0.9);
      }


      .bcampx__link {
        display: inline-block;
        margin-top: 8px;
        color: #4085b6;
        text-decoration: none;
        font-size: 13px;
        font-weight: 600;
      }

      .bcampx__link:hover {
        text-decoration: underline;
      }

      .bcampx__error,
      .bcampx__empty {
        margin: 0 0 6px;
        color: #7a4b00;
      }

      .bcampx--loading {
        opacity: 0.78;
      }
    `;
        document.head.appendChild(style);
    }

    function storageGet(key, fallback) {
        if (canUseExternalHostMethod("storageGet")) {
            return Promise.resolve(
                getExternalHostApi().storageGet(key, fallback),
            );
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
            return Promise.resolve(getExternalHostApi().storageSet(key, value));
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

    function metaContent(doc, selector) {
        return attrContent(doc, selector, "content");
    }

    function extractDescriptionHtml(doc) {
        const descriptionNode = doc.querySelector(
            ".tralbum-about, .album-about",
        );
        if (!descriptionNode) {
            return "";
        }

        return sanitizeDescriptionHtml(descriptionNode.innerHTML || "");
    }

    function sanitizeDescriptionHtml(rawHtml) {
        if (!rawHtml) {
            return "";
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${rawHtml}</div>`,
            "text/html",
        );
        const root = parsed.body.firstElementChild;
        if (!root) {
            return "";
        }

        const allowedTags = new Set(["A", "BR", "P", "EM", "STRONG", "B", "I"]);

        const sanitizeNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return parsed.createTextNode(node.textContent || "");
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                return null;
            }

            const tagName = node.tagName.toUpperCase();
            if (!allowedTags.has(tagName)) {
                const fragment = parsed.createDocumentFragment();
                Array.from(node.childNodes).forEach((child) => {
                    const sanitizedChild = sanitizeNode(child);
                    if (sanitizedChild) {
                        fragment.appendChild(sanitizedChild);
                    }
                });
                return fragment;
            }

            const cleanNode = parsed.createElement(tagName.toLowerCase());
            if (tagName === "A") {
                const href = node.getAttribute("href") || "";
                if (/^https?:\/\//i.test(href)) {
                    cleanNode.setAttribute("href", href);
                    cleanNode.setAttribute("target", "_blank");
                    cleanNode.setAttribute("rel", "noopener noreferrer");
                }
            }

            Array.from(node.childNodes).forEach((child) => {
                const sanitizedChild = sanitizeNode(child);
                if (sanitizedChild) {
                    cleanNode.appendChild(sanitizedChild);
                }
            });

            return cleanNode;
        };

        const fragment = parsed.createDocumentFragment();
        Array.from(root.childNodes).forEach((child) => {
            const sanitizedChild = sanitizeNode(child);
            if (sanitizedChild) {
                fragment.appendChild(sanitizedChild);
            }
        });

        const wrapper = parsed.createElement("div");
        wrapper.appendChild(fragment);
        return wrapper.innerHTML.trim();
    }

    function plainTextToDescriptionHtml(value, maxLength) {
        const raw = String(value || "")
            .replace(/\r\n/g, "\n")
            .trim();
        if (!raw) {
            return "";
        }

        const shortened =
            raw.length > maxLength
                ? `${raw.slice(0, maxLength - 3).trim()}...`
                : raw;
        const escaped = escapeHtml(shortened);
        const linked = escaped.replace(
            /(https?:\/\/[^\s<]+)/gi,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
        );
        return linked
            .split(/\n{2,}/)
            .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
            .join("");
    }

    function descriptionHtmlToText(value) {
        const html = String(value || "").trim();
        if (!html) {
            return "";
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${html}</div>`,
            "text/html",
        );
        return cleanText(parsed.body.textContent || "");
    }

    function isLikelyTracklistHtml(value, tracks) {
        return isLikelyTracklistText(descriptionHtmlToText(value), tracks);
    }

    function isLikelyTracklistDescription(data) {
        if (!data) {
            return false;
        }

        return (
            isLikelyTracklistText(data.description || "", data.tracks) ||
            isLikelyTracklistHtml(data.descriptionHtml || "", data.tracks)
        );
    }

    function isLikelyTracklistText(value, tracks) {
        const text = String(value || "").trim();
        if (!text || !Array.isArray(tracks) || tracks.length < 1) {
            return false;
        }

        const normalized = cleanText(text).toLowerCase();
        const numberedItems = (text.match(/\b\d+\.\s+/g) || []).length;
        const matchingTrackTitles = tracks.filter((track) => {
            const title = cleanText(
                track && track.title ? track.title : "",
            ).toLowerCase();
            return title && normalized.includes(title);
        }).length;

        const hasReleaseSummaryShape =
            /\bby\b.+\breleased\b/i.test(text) ||
            /\breleased\s+\d{1,2}\s+\w+\s+\d{4}\b/i.test(text);
        const isSingleTrackAutoSummary =
            tracks.length === 1 &&
            hasReleaseSummaryShape &&
            matchingTrackTitles >= 1 &&
            numberedItems >= 1;

        if (isSingleTrackAutoSummary) {
            return true;
        }

        if (
            matchingTrackTitles >= Math.min(4, tracks.length) &&
            numberedItems >= 2
        ) {
            return true;
        }

        if (
            hasReleaseSummaryShape &&
            matchingTrackTitles >= Math.min(2, tracks.length) &&
            numberedItems >= 1
        ) {
            return true;
        }

        return false;
    }

    function attrContent(doc, selector, attrName) {
        const node = doc.querySelector(selector);
        return node ? cleanText(node.getAttribute(attrName) || "") : "";
    }

    function textContent(doc, selector) {
        const node = doc.querySelector(selector);
        return node ? normalizedText(node) : "";
    }

    function queryTexts(doc, selector) {
        return Array.from(doc.querySelectorAll(selector))
            .map((node) => normalizedText(node))
            .filter(Boolean);
    }

    function normalizedText(node) {
        return cleanText(node.textContent || "");
    }

    function cleanText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function cleanTitle(value) {
        return cleanText(
            String(value || "").replace(/\s*\|\s*Bandcamp\s*$/i, ""),
        );
    }

    function firstString(value) {
        return typeof value === "string" && value.trim()
            ? cleanText(value)
            : "";
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const result = [];

        values.forEach((value) => {
            const cleaned = cleanText(value);
            const key = cleaned.toLowerCase();
            if (!cleaned || seen.has(key)) {
                return;
            }

            seen.add(key);
            result.push(cleaned);
        });

        return result;
    }

    function truncate(value, maxLength) {
        const text = cleanText(value);
        if (!text || text.length <= maxLength) {
            return text;
        }

        return `${text.slice(0, maxLength - 3).trim()}...`;
    }

    function compactJoin(values, separator) {
        return values.map(cleanText).filter(Boolean).join(separator);
    }

    function formatReleaseDate(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return cleanText(value);
        }

        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function buildSummaryText(data) {
        const parts = [];
        if (data.description) {
            parts.push("Description");
        }
        if (data.tracks && data.tracks.length) {
            parts.push(`${data.tracks.length} tracks`);
        }
        return parts.length ? parts.join(" · ") : "Extra context loaded";
    }

    function hasExpandableContent(data) {
        return Boolean(data.tracks && data.tracks.length);
    }

    function hasVisibleEnhancements(data) {
        return Boolean(
            formatReleaseDate(data.releaseDate) ||
            data.location ||
            data.description ||
            (data.tracks && data.tracks.length),
        );
    }

    function decodeJsString(value) {
        try {
            return JSON.parse(`"${value}"`);
        } catch (_error) {
            return cleanText(value);
        }
    }
})();
