import { createTrackData, normalizeReleaseData, parseJsonAttribute } from "./data/release-data.js";
import { scheduleFanTagBackgroundFill, setupFanTagSearch } from "./data/tag-index.js";
import {
    buildArtistMusicFeed,
    buildFanCollectionCardPreview,
    extractParsedItemId,
    findArtistMusicSourceGrid,
    getFanCollectionCachedItem,
    getFanCollectionCardKind,
    getItemJsonReleaseUrl,
    handleArtistMusicNativeLoadMoreClick,
    hasFanCollectionContextMutation,
    isOwnFanTrackCard,
    markFanCollectionGridDirtyFromMutation,
    normalizeReleaseItemType,
    preferBandcampReleaseUrl,
    rearmArtistMusicFeedCardObservers,
    scheduleArtistMusicFeedSync,
    scheduleArtistMusicFeedVisibleFetch,
    scheduleFanCollectionFeedContextSync,
    setupFanCollectionSearchPrefetch,
    setupFanCollectionTabObserver,
} from "./features/artist-music-feed.js";
import { findActivityHeadline, isFullDiscographyCard, mergeAdjacentTrackPurchaseCards } from "./features/card-merge.js";
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
    FAN_ACTIVITY_TEXT_PATTERN,
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
    USER_SETTINGS_KEY,
} from "./state.js";
import {
    clearNodeMemoDeep,
    findCachedElementByText,
    getMatchingRootOrDescendants,
    getNodeMemo,
    incrementDebugCounter,
    invalidateNodeMemoCache,
    markDebugState,
} from "./utils/dom.js";
import { storageGet, storageSet } from "./utils/storage.js";
import { cleanText, normalizedText } from "./utils/text-format.js";

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

export async function loadUserSettings() {
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

export async function persistUserSettings() {
    await storageSet(USER_SETTINGS_KEY, getSerializableUserSettings());
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

export function getCardController(card) {
    return card && card.__bcampxController ? card.__bcampxController : null;
}

function setCardController(card, controller) {
    if (card) {
        card.__bcampxController = controller || null;
    }
}

export function getCardAlbumReleaseUrl(card) {
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

export function getCardReleaseRequestContext(card, releaseUrl = "") {
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

export function getCardPrimaryReleaseUrl(card) {
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

    let primaryReleaseUrl = getCardRawReleaseUrl(card);
    if (!primaryReleaseUrl) {
        // Collection items whose native link is gone still have their URL
        // in pagedata's item_cache.
        const cachedItem = getFanCollectionCachedItem(
            card,
            getFanCollectionCardKind(card),
        );
        primaryReleaseUrl = cleanText(cachedItem && cachedItem.item_url);
    }

    if (memo) {
        memo.cardPrimaryReleaseUrl = primaryReleaseUrl;
    }

    return primaryReleaseUrl;
}

export function getStoryRoot(node) {
    if (!(node instanceof Element)) {
        return null;
    }

    const story = node.matches(FEED_CARD_ROOT_SELECTOR)
        ? node
        : node.closest(FEED_CARD_ROOT_SELECTOR);
    return story instanceof Element ? story : null;
}

export function getStoryTitleNode(card) {
    const story = getStoryRoot(card);
    if (!story) {
        return null;
    }

    const title = story.querySelector(".story-title");
    return title instanceof Element ? title : null;
}

export function extractFeedHeadlineActor(headlineText) {
    const match = cleanText(headlineText).match(
        /^(.+?)\s+(?:bought|purchased|wishlisted|supported|recommended|listening|played|posted|released)\b/i,
    );
    return match && match[1] ? cleanText(match[1]) : "";
}

export function getParsedItemJson(node) {
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

export function getCollectionGridFeaturedPreview(card) {
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
        // Current collection pages carry the preview data in pagedata
        // (item_cache / tracklists) instead of per-item JSON attributes.
        const fanPreview = buildFanCollectionCardPreview(card);
        if (fanPreview && memo) {
            memo.collectionGridFeaturedPreview = fanPreview;
        }
        return fanPreview;
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

export function getFeedPreviewTracks() {
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

export function getFeedPreviewTrackMap() {
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

export function isMalformedFeedCard(card) {
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

export function isAlsoBoughtRecommendationCard(card) {
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

export function findFeaturedTrackForCard(card, trigger, data) {
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

export function extractFeaturedTrackTitle(card) {
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

export function isBandcampFanProfileUrl(rawUrl) {
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

export function isFanCollectionPage() {
    if (!isBandcampFanCollectionPageUrl(window.location.href)) {
        return false;
    }

    return Boolean(findFanCollectionActiveGrid());
}

export function isFanWishlistPage() {
    return /\/wishlist\/?$/i.test(window.location.pathname || "");
}

export function isBandcampFanCollectionPageUrl(rawUrl) {
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
export function isCurrentFanCollectionPage() {
    const href = window.location.href || "";
    if (href !== currentFanCollectionPageHref) {
        currentFanCollectionPageHref = href;
        currentFanCollectionPageMemo =
            isBandcampFanCollectionPageUrl(href);
    }

    return currentFanCollectionPageMemo;
}

export function findFanCollectionActiveGrid() {
    const activeGridContainer = document.querySelector(
        "#grids > .grid.active",
    );
    if (activeGridContainer) {
        return findFanCollectionGridIn(activeGridContainer);
    }

    const activeTab = document.querySelector(
        "li.active[data-grid-id][data-tab]",
    );
    const activeGridId = cleanText(
        activeTab && activeTab.getAttribute("data-grid-id"),
    );
    if (activeGridId) {
        const activeTabGrid = document.querySelector(
            `#${CSS.escape(activeGridId)}`,
        );
        if (activeTabGrid) {
            return findFanCollectionGridIn(activeTabGrid);
        }
    }

    const preferredGridId = isFanWishlistPage()
        ? "wishlist-grid"
        : "collection-grid";
    const preferredGrid = document.querySelector(`#${preferredGridId}`);
    if (preferredGrid) {
        const resolved = findFanCollectionGridIn(preferredGrid);
        if (resolved) {
            return resolved;
        }
    }

    const activeGrid = document.querySelector(".grid.active");
    return activeGrid ? findFanCollectionGridIn(activeGrid) : null;
}

// The collection can render as a grid or as a list; both expose
// .collection-item-container items. Fall back to the items' parent when the
// container class has changed.
function findFanCollectionGridIn(container) {
    if (!(container instanceof Element)) {
        return null;
    }

    const named = container.querySelector(
        [
            "#collection-search-items > .collection-grid",
            "#wishlist-search-items > .collection-grid",
            ".collection-grid",
            ".collection-list",
        ].join(", "),
    );
    if (named) {
        return named;
    }

    const item = container.querySelector(".collection-item-container");
    return item && item.parentElement ? item.parentElement : null;
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

export function updateAutoFetchDebugState() {
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

export function suspendMutationObserver() {
    if (STATE.mutationObserver) {
        STATE.mutationObserver.disconnect();
    }
}

export function resumeMutationObserver() {
    if (STATE.mutationObserver && document.body) {
        STATE.mutationObserver.observe(
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

    STATE.mutationObserver = new MutationObserver((mutations) => {
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

export function scheduleScan(root = null) {
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

export function normalizeReleaseUrl(rawUrl) {
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

export function looksLikeFeedCard(node) {
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

export function isLikelyProfileLink(link) {
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

export function resolveFanIdFromPageState(pagedataBlob, collectInfo = {}) {
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

function injectStyles() {
    const style = document.createElement("style");
    style.textContent = ENHANCEMENT_CSS;
    document.head.appendChild(style);
}


