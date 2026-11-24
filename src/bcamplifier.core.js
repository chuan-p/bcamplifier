import { createTrackData, normalizeReleaseData, parseJsonAttribute } from "./data/release-data.js";
import { scheduleFanTagBackgroundFill, setupFanTagSearch } from "./data/tag-index.js";
import {
    buildArtistMusicFeed,
    buildFanTagSearchNativeRelease,
    findArtistMusicSourceGrid,
    handleArtistMusicNativeLoadMoreClick,
    hasFanCollectionContextMutation,
    isCurrentFanProfileOwner,
    isOwnFanTrackCard,
    markFanCollectionGridDirtyFromMutation,
    rearmArtistMusicFeedCardObservers,
    scheduleArtistMusicFeedSync,
    scheduleArtistMusicFeedVisibleFetch,
    scheduleFanCollectionFeedContextSync,
    setupFanCollectionSearchPrefetch,
    setupFanCollectionTabObserver,
} from "./features/artist-music-feed.js";
import { isFullDiscographyCard, mergeAdjacentTrackPurchaseCards } from "./features/card-merge.js";
import {
    applyReleaseShellLoadingState,
    fetchAndRender,
    mountEnhancementShell,
    renderArtistMusicCardInitialData,
    toggleDetails,
} from "./features/card-renderer.js";
import {
    checkForPlaybackPauseRequest,
    ensurePlayerShell,
    getCardArtUrl,
    handleDocumentAudioPlay,
    refreshTagSearchSettingProgress,
    setupNativePlaybackInterception,
    setupPlayerMenuDismissal,
    setupSharedAudio,
    setupWaypointNavigation,
    subscribeToPlaybackPauseRequests,
} from "./features/player.js";
import {
    applyPendingOwnedReleaseCollectionSearch,
    setupOwnedReleaseCollectionHandoff,
    setupOwnedReleaseLinkVerification,
    setupReleasePageBuyAutofill,
    setupUnavailableReleaseLinkGuard,
} from "./features/release-page.js";
import { tryHandleEmbeddedTrackActionHelper } from "./features/track-actions.js";
import {
    BUILD_ID,
    CONFIG,
    ENHANCED_ATTR,
    ENHANCEMENT_CSS,
    EXCLUDED_SECTION_SELECTOR,
    FEED_CARD_ROOT_SELECTOR,
    HIDDEN_SUPPORTED_ATTR,
    INTERNAL_MUTATION_SELECTOR,
    LOADING_EXTRA_CONTEXT_TEXT,
    OBSERVED_ATTR,
    PLAYBACK_PAUSE_POLL_MS,
    RELEASE_LINK_SELECTOR,
    RETRYABLE_SKIP_ATTR,
    SCRIPT_VERSION,
    SKIP_REASON_ATTR,
    STATE,
} from "./state.js";
import {
    clearNodeMemoDeep,
    getMatchingRootOrDescendants,
    incrementDebugCounter,
    invalidateNodeMemoCache,
    markDebugState,
} from "./utils/dom.js";
import {
    getCardPrimaryReleaseUrl,
    getCardReleaseRequestContext,
    getStoryRoot,
    isAlsoBoughtRecommendationCard,
    isMalformedFeedCard,
    looksLikeFeedCard,
} from "./utils/card-dom.js";
import { registerTagIndexUiHooks } from "./utils/hooks.js";
import {
    getCardController,
    isCurrentFanCollectionPage,
    isFanCollectionPage,
    isFanWishlistPage,
    loadUserSettings,
    setCardController,
} from "./utils/page.js";
import { cleanText, normalizedText } from "./utils/text-format.js";
import {
    isBandcampFanCollectionPageUrl,
    isBandcampFanProfileUrl,
    normalizeReleaseUrl,
} from "./utils/url.js";

const coreState = {
    releaseFetchResumeTimer: 0,
    globalBridgeInitialized: false,
    scanTimer: 0,
    pendingScanRoots: new Set(),
    pendingFullScan: false,
    mutationObserver: null,
    autoFetchDrainScheduled: false,
    activeAutoFetchCount: 0,
    autoFetchSequence: 0,
    peakAutoFetchCount: 0,
    playbackPauseMonitorTimer: 0,
};

export function init() {
    if (
        document.documentElement.getAttribute(
            "data-bcampx-script-loaded",
        ) === "true"
    ) {
        markDebugState("data-bcampx-duplicate", "true");
        try {
            console.warn(
                "[bcamplifier] another copy is already running on this page; disable the duplicate extension or userscript.",
            );
        } catch (_error) {
            // Console access is a diagnostic only.
        }
        return;
    }
    markDebugState("data-bcampx-script-loaded", "true");
    markDebugState("data-bcampx-version", SCRIPT_VERSION);
    markDebugState("data-bcampx-build", BUILD_ID);
    registerTagIndexUiHooks({
        scheduleFeedSync: scheduleArtistMusicFeedSync,
        refreshProgress: refreshTagSearchSettingProgress,
        isProfileOwner: isCurrentFanProfileOwner,
        buildNativeRelease: buildFanTagSearchNativeRelease,
    });
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
    setupUnavailableReleaseLinkGuard();
    setupOwnedReleaseLinkVerification();
    setupFanCollectionSearchPrefetch();
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
    if (coreState.globalBridgeInitialized) {
        return;
    }

    coreState.globalBridgeInitialized = true;
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
        coreState.playbackPauseMonitorTimer = window.setInterval(
            checkForPlaybackPauseRequest,
            PLAYBACK_PAUSE_POLL_MS,
        );
    }
}

export function ensureCardController(card, releaseUrl) {
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

function isFeedPage() {
    return (
        /(^|\/)feed\/?$/.test(window.location.pathname) ||
        /\/feed\//.test(window.location.pathname)
    );
}

export function isFeedEnhancerPage() {
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

export function isArtistMusicPage() {
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

export function queueAutoFetch(controller, observedRect = null) {
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
        sequence: ++coreState.autoFetchSequence,
        distance,
    });
    updateAutoFetchDebugState();
    scheduleAutoFetchQueueDrain();
}

function scheduleAutoFetchQueueDrain() {
    if (coreState.autoFetchDrainScheduled) {
        return;
    }

    coreState.autoFetchDrainScheduled = true;
    const run = () => {
        coreState.autoFetchDrainScheduled = false;
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
        if (!coreState.releaseFetchResumeTimer) {
            coreState.releaseFetchResumeTimer = window.setTimeout(() => {
                coreState.releaseFetchResumeTimer = 0;
                drainAutoFetchQueue();
            }, Math.min(60000, pauseUntil - Date.now()));
        }
        return;
    }

    while (
        coreState.activeAutoFetchCount < CONFIG.maxConcurrentAutoFetches &&
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

        coreState.activeAutoFetchCount += 1;
        coreState.peakAutoFetchCount = Math.max(
            coreState.peakAutoFetchCount,
            coreState.activeAutoFetchCount,
        );
        updateAutoFetchDebugState();
        Promise.resolve(controller.fetchAndRender({ auto: true }))
            .catch(() => {})
            .finally(() => {
                coreState.activeAutoFetchCount = Math.max(
                    0,
                    coreState.activeAutoFetchCount - 1,
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

export function updateAutoFetchDebugState() {
    markDebugState(
        "data-bcampx-auto-fetch-active-count",
        String(coreState.activeAutoFetchCount),
    );
    markDebugState(
        "data-bcampx-auto-fetch-queue-count",
        String(STATE.autoFetchQueue.length),
    );
    markDebugState(
        "data-bcampx-auto-fetch-peak-count",
        String(coreState.peakAutoFetchCount),
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

export function suspendMutationObserver() {
    if (coreState.mutationObserver) {
        coreState.mutationObserver.disconnect();
    }
}

export function resumeMutationObserver() {
    if (coreState.mutationObserver && document.body) {
        coreState.mutationObserver.observe(
            document.body,
            MUTATION_OBSERVER_OPTIONS,
        );
    }
}

function mutationTouchesOwnedLink(mutation) {
    if (!mutation) {
        return false;
    }
    const target = mutation.target;
    if (
        target instanceof Element &&
        (target.matches(".you-own-this-link") ||
            target.closest(".you-own-this-link"))
    ) {
        return true;
    }
    const nodes = [
        ...Array.from(mutation.addedNodes || []),
        ...Array.from(mutation.removedNodes || []),
    ];
    return nodes.some(
        (node) =>
            node instanceof Element &&
            (node.matches(".you-own-this-link") ||
                Boolean(node.querySelector(".you-own-this-link"))),
    );
}

function setupMutationObserver() {
    if (!("MutationObserver" in window) || !document.body) {
        return;
    }

    coreState.mutationObserver = new MutationObserver((mutations) => {
        let shouldFullScan = false;
        let shouldInvalidateMemo = false;
        let shouldSyncReleaseGridFeed = false;

        mutations.forEach((mutation) => {
            markFanCollectionGridDirtyFromMutation(mutation);
            if (mutationTouchesOwnedLink(mutation)) {
                STATE.ownedLinkCacheDirty = true;
            }
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

    coreState.mutationObserver.observe(
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

export function scheduleScan(root = null) {
    if (root instanceof Element) {
        const roots = getScanRootsForElement(root);
        if (roots.length) {
            roots.forEach((scanRoot) => {
                coreState.pendingScanRoots.add(scanRoot);
            });
        } else {
            coreState.pendingFullScan = true;
        }
    } else {
        coreState.pendingFullScan = true;
    }

    window.clearTimeout(coreState.scanTimer);
    coreState.scanTimer = window.setTimeout(
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

export function isBcampxInternalMutationNode(node) {
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

    if (coreState.pendingFullScan || !coreState.pendingScanRoots.size) {
        roots.push(document);
    } else {
        coreState.pendingScanRoots.forEach((root) => {
            if (root instanceof Element && document.contains(root)) {
                roots.push(root);
            }
        });
    }

    coreState.pendingScanRoots.clear();
    coreState.pendingFullScan = false;
    return roots.length ? roots : [document];
}

export function getStoryCardsFromRoots(roots) {
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
        loadingPromise: null,
        autoFetchQueued: false,
        expanded: false,
        data: null,
        refreshPromise: null,
        // Whether a release-page request (or the page-unavailable skip)
        // has run for this card. Own collection track cards render from
        // native data and never request their page automatically, so
        // "loaded" alone cannot answer "was this release checked?".
        releaseChecked: false,
        card,
        shellNode: shell,
        metaNode: meta,
        textNode: text,
        toggleNode: toggle,
        releaseUrl,
        releaseRequestContext:
            releaseRequestContext ||
            getCardReleaseRequestContext(card, releaseUrl),
        fetchAndRender: (options = {}) => {
            // Keep a handle on the in-flight task. Callers that arrive
            // while the first metadata request is running can wait for it
            // instead of seeing "loading" with no data and giving up.
            const task = fetchAndRender(
                controller,
                releaseUrl,
                shell,
                meta,
                text,
                toggle,
                options,
            );
            controller.loadingPromise = task;
            const clear = () => {
                if (controller.loadingPromise === task) {
                    controller.loadingPromise = null;
                }
            };
            task.then(clear, clear);
            return task;
        },
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

function injectStyles() {
    const style = document.createElement("style");
    style.textContent = ENHANCEMENT_CSS;
    document.head.appendChild(style);
}


