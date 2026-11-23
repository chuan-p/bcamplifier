import {
    ensureCardController,
    findFanCollectionActiveGrid,
    getCardController,
    getCardPrimaryReleaseUrl,
    getFeedPreviewTrackMap,
    getFeedPreviewTracks,
    getParsedItemJson,
    isArtistMusicPage,
    isBandcampFanCollectionPageUrl,
    isBandcampFanProfileUrl,
    isBcampxInternalMutationNode,
    isCurrentFanCollectionPage,
    isFanCollectionPage,
    isFanWishlistPage,
    normalizeReleaseUrl,
    queueAutoFetch,
    resolveFanIdFromPageState,
    resumeMutationObserver,
    scheduleScan,
    suspendMutationObserver,
    updateAutoFetchDebugState,
} from "../bcamplifier.core.js";
import {
    createTrackData,
    getExactReleaseSupporterCount,
    isBandcampReleaseUrl,
    normalizeReleaseData,
    normalizeSupporterItemType,
    parseJsonAttribute,
    requestJson,
} from "../data/release-data.js";
import { collectFanTagSearchExtraReleases, setupFanTagSearch, updateFanTagSearchMoreControl } from "../data/tag-index.js";
import { syncTrackButtonsForCard } from "./card-merge.js";
import { markReleasePageUnavailable, navigateToOwnedReleaseCollection } from "./release-page.js";
import { openTrackBuyWindow } from "./track-actions.js";
import {
    ARTIST_MUSIC_VIEW_KEY,
    CONFIG,
    OBSERVED_ATTR,
    RELEASE_LINK_SELECTOR,
    STATE,
    SVG_NS,
} from "../state.js";
import { incrementDebugCounter, markDebugState } from "../utils/dom.js";
import { storageGet, storageSet } from "../utils/storage.js";
import {
    cleanText,
    cleanTitle,
    compactJoin,
    formatReleaseDate,
    metaContent,
    normalizedText,
} from "../utils/text-format.js";

export async function buildArtistMusicFeed() {
    if (STATE.artistMusicFeedBuilt || STATE.artistMusicFeedBuilding) {
        return false;
    }

    const feedContext = getReleaseGridFeedContext();
    if (!feedContext) {
        return false;
    }

    const releases = collectReleaseGridFeedCandidates(feedContext);
    if (!releases.length) {
        markDebugState("data-bcampx-label-feed-state", "empty");
        return false;
    }

    const sourceGrid = feedContext.sourceGrid;
    if (!sourceGrid || !sourceGrid.parentNode) {
        markDebugState("data-bcampx-label-feed-state", "missing-source");
        return false;
    }

    STATE.artistMusicFeedBuilding = true;
    let feed = null;

    try {
        feed = document.createElement("section");
        feed.className = "bcampx-label-feed";
        feed.setAttribute("aria-label", feedContext.ariaLabel);
        feed.setAttribute("data-bcampx-feed-kind", feedContext.kind);
        if (
            /^fan-/.test(feedContext.kind) &&
            !isCurrentFanProfileOwner()
        ) {
            feed.classList.add("bcampx-label-feed--other-fan");
        }

        // Bandcamp's fan-page infinite loader appends releases to every
        // nearby <ol>, so this list must not look like a native collection
        // grid.
        const list = document.createElement("div");
        list.className = "bcampx-label-feed__list";
        list.setAttribute("role", "list");
        releases.forEach((release) => {
            list.appendChild(createArtistMusicFeedCard(release));
        });
        feed.appendChild(list);

        const storedView = cleanText(
            await storageGet(ARTIST_MUSIC_VIEW_KEY, "feed"),
        );
        STATE.artistMusicFeedView =
            storedView === "original" ? "original" : "feed";
        STATE.artistMusicFeedNode = feed;
        STATE.artistMusicSourceGridNode = sourceGrid;
        STATE.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();
        if (/^fan-/.test(feedContext.kind)) {
            STATE.artistMusicFanDirtyGrids.delete(sourceGrid);
        }

        if (!mountReleaseGridFeed(feed, feedContext)) {
            STATE.artistMusicFeedNode = null;
            STATE.artistMusicSourceGridNode = null;
            markDebugState(
                "data-bcampx-label-feed-state",
                "missing-source",
            );
            return false;
        }

        document.body.classList.add("bcampx-label-feed-page");
        ensureArtistMusicViewToggle();
        applyArtistMusicFeedView(STATE.artistMusicFeedView);
        STATE.artistMusicFeedBuilt = true;
        setupArtistMusicSourceGridObserver(sourceGrid);
        setupFanCollectionTabObserver();
        setupFanTagSearch();

        markDebugState("data-bcampx-label-feed-state", "ready");
        markDebugState(
            "data-bcampx-label-feed-count",
            String(releases.length),
        );
        markDebugState("data-bcampx-label-feed-kind", feedContext.kind);
        markDebugState("data-bcampx-page-kind", feedContext.kind);
        markDebugState(
            "data-bcampx-label-feed-visible-count",
            String(releases.length),
        );
        if (/^fan-/.test(feedContext.kind)) {
            scheduleFanCollectionFeedContextSync();
        }
        return true;
    } catch (error) {
        if (feed && feed.isConnected) {
            feed.remove();
        }
        STATE.artistMusicFeedNode = null;
        STATE.artistMusicSourceGridNode = null;
        markDebugState("data-bcampx-label-feed-state", "error");
        throw error;
    } finally {
        STATE.artistMusicFeedBuilding = false;
    }
}

export function isCurrentFanProfileOwner() {
    const pageData = parseJsonAttribute(
        document.querySelector("#pagedata[data-blob]"),
        "data-blob",
    );
    const fanData = pageData && pageData.fan_data;
    const currentFan = pageData && pageData.current_fan;

    if (fanData && fanData.is_own_page === true) {
        return true;
    }

    const profileFanId = Number(fanData && (fanData.fan_id || fanData.id));
    // Bandcamp exposes the signed-in fan as current_fan on some pages and
    // as identities.fan / fan_info on others; resolveFanIdFromPageState
    // already knows those fallbacks.
    const currentFanId =
        Number(currentFan && (currentFan.fan_id || currentFan.id)) ||
        resolveFanIdFromPageState(pageData);
    return Boolean(
        profileFanId > 0 &&
            currentFanId > 0 &&
            profileFanId === currentFanId,
    );
}

// The fan profile URL behind the current collection page. Used as the
// ownership target for index-built tag cards: clicking them should search
// the collection for the release instead of opening its release page.
function getOwnFanProfileUrl() {
    if (!isBandcampFanProfileUrl(window.location.href)) {
        return "";
    }

    const path = String(window.location.pathname || "").replace(
        /\/+$/,
        "",
    );
    return path ? `${window.location.origin}${path}` : "";
}

function isOwnFanTrackRelease(release) {
    return Boolean(
        release &&
            release.ownFanCollection === true &&
            release.itemType === "track",
    );
}

export function isOwnFanTrackCard(card) {
    return isOwnFanTrackRelease(
        card && card.__bcampxArtistMusicRelease,
    );
}

export function setupFanCollectionTabObserver() {
    if (
        !("MutationObserver" in window) ||
        !isBandcampFanCollectionPageUrl(window.location.href)
    ) {
        return;
    }

    const observerRoot =
        document.querySelector("#grids") ||
        document.querySelector(".grid-tabs-anchor") ||
        null;
    if (!(observerRoot instanceof Element)) {
        return;
    }
    if (
        STATE.artistMusicFanTabObserver &&
        STATE.artistMusicFanTabObserver.__bcampxRoot === observerRoot &&
        observerRoot.isConnected
    ) {
        return;
    }
    if (STATE.artistMusicFanTabObserver) {
        STATE.artistMusicFanTabObserver.disconnect();
    }

    STATE.artistMusicFanTabObserver = new MutationObserver((mutations) => {
        if (mutations.some(hasFanCollectionContextMutation)) {
            scheduleFanCollectionFeedContextSync();
        }
    });
    STATE.artistMusicFanTabObserver.__bcampxRoot = observerRoot;
    STATE.artistMusicFanTabObserver.observe(observerRoot, {
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
        subtree: true,
    });
    window.removeEventListener(
        "popstate",
        scheduleFanCollectionFeedContextSync,
    );
    window.addEventListener("popstate", scheduleFanCollectionFeedContextSync);
}

export function hasFanCollectionContextMutation(mutation) {
    if (!mutation) {
        return false;
    }

    if (mutation.type === "attributes") {
        const target = mutation.target;
        return Boolean(
            target instanceof Element &&
                target.matches(
                    "#grids > .grid, [data-grid-id][data-tab], .grid-tabs-anchor",
                ),
        );
    }

    if (mutation.type !== "childList") {
        return false;
    }

    const target = mutation.target;
    const changedNodes = [
        ...mutation.addedNodes,
        ...mutation.removedNodes,
    ];
    const isTabGridNode = (node) =>
        node instanceof Element &&
        (node.matches(
            "#grids > .grid, [data-grid-id][data-tab], .grid-tabs-anchor",
        ) ||
            Boolean(
                node.querySelector(
                    "#grids > .grid, [data-grid-id][data-tab], .grid-tabs-anchor",
                ),
            ));
    if (
        target instanceof Element &&
        target.matches(".collection-tabs, .grid-tabs-anchor")
    ) {
        return true;
    }
    if (target instanceof Element && target.matches("#grids")) {
        // The enhanced feed lives next to the tab grids; moving it must not
        // look like a tab change or the sync would re-enter itself.
        return changedNodes.some(isTabGridNode);
    }

    return changedNodes.some(isTabGridNode);
}

export function scheduleFanCollectionFeedContextSync() {
    if (!STATE.initialized || STATE.artistMusicFanTabSyncTimer) {
        return;
    }

    STATE.artistMusicFanTabSyncTimer = 1;
    const run = () => {
        STATE.artistMusicFanTabSyncTimer = 0;
        reconcileFanCollectionFeedContext();
    };
    if (typeof window.queueMicrotask === "function") {
        window.queueMicrotask(run);
    } else {
        Promise.resolve().then(run);
    }
}

function reconcileFanCollectionFeedContext() {
    const context = getReleaseGridFeedContext();
    const feed = STATE.artistMusicFeedNode;
    if (!context) {
        suspendFanCollectionFeedContext();
        return;
    }
    if (!(feed instanceof Element)) {
        // buildArtistMusicFeed records its own error state and rethrows;
        // this detached retry must not surface as an unhandled rejection.
        void buildArtistMusicFeed().catch(() => {});
        return;
    }
    if (
        !/^fan-/.test(context.kind) ||
        !(context.sourceGrid instanceof Element) ||
        STATE.artistMusicFeedBuilding
    ) {
        return;
    }

    const currentKind = cleanText(
        feed.getAttribute("data-bcampx-feed-kind") || "",
    );
    const expectedParent =
        context.sourceGrid.closest(".grid") || context.sourceGrid.parentElement;
    if (
        STATE.artistMusicSourceGridNode === context.sourceGrid &&
        currentKind === context.kind &&
        feed.parentElement === expectedParent &&
        feed.getAttribute("data-bcampx-context-suspended") !== "true"
    ) {
        return;
    }

    const previousSourceGrid = STATE.artistMusicSourceGridNode;
    if (previousSourceGrid instanceof Element) {
        setArtistMusicNativeSectionHidden(
            previousSourceGrid,
            false,
            "offscreen",
        );
        previousSourceGrid.setAttribute(
            "data-bcampx-label-feed-source-hidden",
            "false",
        );
    }

    const list = feed.querySelector(".bcampx-label-feed__list");
    const sourceGridChanged =
        previousSourceGrid !== context.sourceGrid;
    if (sourceGridChanged) {
        stashFanCollectionFeedCards(previousSourceGrid, list);
    }

    STATE.artistMusicSourceGridNode = context.sourceGrid;
    feed.setAttribute("data-bcampx-feed-kind", context.kind);
    feed.setAttribute("aria-label", context.ariaLabel);
    feed.removeAttribute("data-bcampx-context-suspended");
    mountReleaseGridFeed(feed, context);
    const restoredCards =
        sourceGridChanged &&
        restoreFanCollectionFeedCards(context.sourceGrid, list);
    if (sourceGridChanged && !restoredCards) {
        rebuildReleaseGridFeed(context);
    }
    setupArtistMusicSourceGridObserver(context.sourceGrid);
    if (STATE.artistMusicToggleNode) {
        STATE.artistMusicToggleNode.hidden = false;
    }
    applyArtistMusicFeedView(STATE.artistMusicFeedView, {
        skipFeedWork: restoredCards || !sourceGridChanged,
    });

    if (
        (!sourceGridChanged ||
            STATE.artistMusicFanDirtyGrids.has(context.sourceGrid)) &&
        (restoredCards || !sourceGridChanged)
    ) {
        syncArtistMusicFeedFromSourceGrid();
    }

    markDebugState("data-bcampx-label-feed-kind", context.kind);
    markDebugState("data-bcampx-page-kind", context.kind);
}

function stashFanCollectionFeedCards(sourceGrid, list) {
    if (
        !(sourceGrid instanceof Element) ||
        !(list instanceof Element)
    ) {
        return;
    }

    STATE.artistMusicFanCardsByGrid.set(
        sourceGrid,
        Array.from(list.children),
    );
}

function restoreFanCollectionFeedCards(sourceGrid, list) {
    if (
        !(sourceGrid instanceof Element) ||
        !(list instanceof Element)
    ) {
        return false;
    }

    const cards = STATE.artistMusicFanCardsByGrid.get(sourceGrid);
    if (!Array.isArray(cards)) {
        return false;
    }

    list.replaceChildren(...cards);
    cards.forEach((card) => syncTrackButtonsForCard(card));
    return true;
}

export function markFanCollectionGridDirtyFromMutation(mutation) {
    if (!mutation || !isCurrentFanCollectionPage()) {
        return;
    }

    const target =
        mutation.target instanceof Element
            ? mutation.target
            : mutation.target && mutation.target.parentElement;
    const sourceGrid =
        target &&
        (target.matches(".collection-grid")
            ? target
            : target.closest(".collection-grid"));
    if (sourceGrid instanceof Element) {
        STATE.artistMusicFanDirtyGrids.add(sourceGrid);
    }
}

function suspendFanCollectionFeedContext() {
    const feed = STATE.artistMusicFeedNode;
    if (!(feed instanceof Element) || !/^fan-/.test(
        cleanText(feed.getAttribute("data-bcampx-feed-kind") || ""),
    )) {
        return;
    }

    const sourceGrid = STATE.artistMusicSourceGridNode;
    if (sourceGrid instanceof Element) {
        setArtistMusicNativeSectionHidden(sourceGrid, false, "offscreen");
        sourceGrid.setAttribute(
            "data-bcampx-label-feed-source-hidden",
            "false",
        );
    }
    if (STATE.artistMusicSourceGridObserver) {
        STATE.artistMusicSourceGridObserver.disconnect();
    }
    if (STATE.artistMusicFeedSyncTimer) {
        window.clearTimeout(STATE.artistMusicFeedSyncTimer);
        STATE.artistMusicFeedSyncTimer = 0;
    }
    if (STATE.artistMusicVisibleFetchTimer) {
        window.clearTimeout(STATE.artistMusicVisibleFetchTimer);
        STATE.artistMusicVisibleFetchTimer = 0;
    }
    STATE.artistMusicVisibleCardsPending = null;
    STATE.artistMusicVisibleFetchAll = false;

    feed.hidden = true;
    feed.setAttribute("data-bcampx-context-suspended", "true");
    if (STATE.artistMusicToggleNode) {
        STATE.artistMusicToggleNode.hidden = true;
    }
    document.body.classList.remove(
        "bcampx-label-feed-page--enhanced",
        "bcampx-label-feed-page--original",
    );
    markDebugState("data-bcampx-page-kind", "fan-other");
}

function rebuildReleaseGridFeed(context) {
    const feed = STATE.artistMusicFeedNode;
    const list =
        feed && feed.querySelector(".bcampx-label-feed__list");
    if (!list) {
        return;
    }

    const releases = collectReleaseGridFeedCandidates(context);
    const cards = releases.map((release) =>
        createArtistMusicFeedCard(release),
    );
    list.replaceChildren(...cards);
    if (context.sourceGrid instanceof Element) {
        STATE.artistMusicFanDirtyGrids.delete(context.sourceGrid);
    }

    markDebugState(
        "data-bcampx-label-feed-count",
        String(cards.length),
    );
    markDebugState(
        "data-bcampx-label-feed-visible-count",
        String(cards.length),
    );

    cards.forEach((card) => scheduleScan(card));
    if (STATE.artistMusicFeedView === "feed") {
        scheduleArtistMusicFeedVisibleFetch(feed);
    }
}

function mountReleaseGridFeed(feed, feedContext) {
    const sourceGrid = feedContext && feedContext.sourceGrid;
    if (!(feed instanceof Element) || !(sourceGrid instanceof Element)) {
        return false;
    }

    // The source grid can be replaced while an async caller is awaiting, so
    // never assume it is still attached.
    if (!sourceGrid.parentNode) {
        return false;
    }

    if (feedContext && /^fan-/.test(feedContext.kind)) {
        const activeGrid = sourceGrid.closest(".grid");
        if (activeGrid && activeGrid.parentNode) {
            activeGrid.parentNode.insertBefore(feed, activeGrid);
            feed.setAttribute(
                "data-bcampx-mounted-outside-native-content",
                "true",
            );
            return true;
        }
    }

    sourceGrid.parentNode.insertBefore(feed, sourceGrid);
    return true;
}

// True when a grid mutation actually changes page content. Foreign
// extension controls (Batchcamp's checkboxes) and our own nodes do not.
function isPageContentGridMutation(mutation) {
    if (!mutation) {
        return false;
    }

    if (mutation.type === "attributes") {
        return true;
    }

    const removed = Array.from(mutation.removedNodes || []);
    if (removed.some((node) => node instanceof Element)) {
        return true;
    }

    return Array.from(mutation.addedNodes || []).some(
        (node) =>
            node instanceof Element && !isBcampxInternalMutationNode(node),
    );
}

function setupArtistMusicSourceGridObserver(sourceGrid) {
    if (!("MutationObserver" in window) || !(sourceGrid instanceof Element)) {
        return;
    }

    if (STATE.artistMusicSourceGridObserver) {
        STATE.artistMusicSourceGridObserver.disconnect();
    }

    STATE.artistMusicSourceGridObserver = new MutationObserver((mutations) => {
        // Batchcamp inserts one checkbox per item into this grid; treating
        // those as release changes would re-sync the feed on every batch.
        const pageMutations = mutations.filter(isPageContentGridMutation);
        if (!pageMutations.length) {
            return;
        }
        if (!STATE.artistMusicDirtyItems) {
            STATE.artistMusicDirtyItems = new Set();
        }
        pageMutations.forEach((mutation) => {
            markArtistMusicItemMutation(
                mutation,
                STATE.artistMusicDirtyItems,
            );
        });
        STATE.artistMusicFanDirtyGrids.add(sourceGrid);
        scheduleArtistMusicFeedSync();
    });
    STATE.artistMusicSourceGridObserver.observe(sourceGrid, {
        attributes: true,
        attributeFilter: [
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

function addArtistMusicDirtyItem(node, dirty, scanDescendants = true) {
    if (!(node instanceof Element) || !dirty) {
        return;
    }

    const item =
        node.closest("li.collection-item-container") ||
        (node.matches("li.collection-item-container") ? node : null);
    if (item) {
        dirty.add(item);
    }
    if (scanDescendants && node.querySelectorAll) {
        node.querySelectorAll("li.collection-item-container").forEach(
            (nested) => dirty.add(nested),
        );
    }
}

function markArtistMusicItemMutation(mutation, dirty) {
    if (!mutation || !dirty) {
        return;
    }
    // The target may be the grid itself for a childList append; scanning
    // its descendants would mark every existing item dirty and defeat the
    // signature skip. Only added/removed subtrees are scanned.
    addArtistMusicDirtyItem(mutation.target, dirty, false);
    Array.from(mutation.addedNodes || []).forEach((node) => {
        addArtistMusicDirtyItem(node, dirty);
    });
    Array.from(mutation.removedNodes || []).forEach((node) => {
        addArtistMusicDirtyItem(node, dirty);
    });
}

function finishArtistMusicFeedSync(
    feedContext,
    sourceGrid,
    list,
    appendedCards,
    totalCount,
    listChanged,
) {
    updateFanTagSearchMoreControl(list, feedContext);
    markDebugState(
        "data-bcampx-label-feed-count",
        String(totalCount),
    );
    markDebugState(
        "data-bcampx-label-feed-visible-count",
        String(totalCount),
    );
    markDebugState(
        "data-bcampx-label-feed-sync-count",
        String(appendedCards.length),
    );
    appendedCards.forEach((card) => scheduleScan(card));
    rearmArtistMusicFeedCardObservers(STATE.artistMusicFeedNode);
    if (appendedCards.length || listChanged) {
        window.setTimeout(
            () =>
                rearmArtistMusicFeedCardObservers(
                    STATE.artistMusicFeedNode,
                ),
            CONFIG.scanDebounceMs + 20,
        );
    }
    if (STATE.artistMusicFeedView === "feed" && appendedCards.length) {
        scheduleArtistMusicFeedVisibleFetch(
            STATE.artistMusicFeedNode,
            STATE.observer ? appendedCards : null,
        );
    }
    if (STATE.artistMusicLoadMoreScrollPending) {
        if (appendedCards.length) {
            STATE.artistMusicLoadMoreScrollPending = false;
            window.clearTimeout(artistMusicLoadMoreScrollTimer);
            scrollToNewArtistMusicFeedCards(appendedCards);
        }
    }
    if (sourceGrid instanceof Element) {
        STATE.artistMusicFanDirtyGrids.delete(sourceGrid);
    }
}

function tryIncrementalArtistMusicFeedAppend(
    feedContext,
    dirtyItems,
    list,
) {
    if (!dirtyItems || !dirtyItems.size || !(list instanceof Element)) {
        return false;
    }
    const sourceGrid = feedContext && feedContext.sourceGrid;
    const feedKind = cleanText(feedContext && feedContext.kind);
    if (
        feedKind !== "fan-collection" ||
        !isCurrentFanProfileOwner() ||
        !(sourceGrid instanceof Element)
    ) {
        return false;
    }
    if (
        cleanText(
            (STATE.tagSearchQueryByKind || {}).collection || "",
        )
    ) {
        return false;
    }

    const cache = STATE.artistMusicFeedCandidateCache;
    if (
        !cache ||
        cache.grid !== sourceGrid ||
        cache.kind !== feedKind ||
        cache.ownFanCollection !== true ||
        !cache.items.length
    ) {
        return false;
    }

    const items = Array.from(
        sourceGrid.querySelectorAll(
            "li.collection-item-container[data-playerdata], li.collection-item-container",
        ),
    );
    if (items.length <= cache.items.length) {
        return false;
    }
    for (let index = 0; index < cache.items.length; index += 1) {
        if (items[index] !== cache.items[index]) {
            return false;
        }
    }

    const newItems = items.slice(cache.items.length);
    const newItemSet = new Set(newItems);
    for (const dirty of dirtyItems) {
        if (!newItemSet.has(dirty)) {
            return false;
        }
    }

    const cards = Array.from(
        list.querySelectorAll(
            ".bcampx-label-feed-card[data-bcampx-release-url]",
        ),
    );
    if (cards.length !== cache.items.length) {
        return false;
    }
    for (let index = 0; index < cards.length; index += 1) {
        if (cards[index].__bcampxGridItem !== cache.items[index]) {
            return false;
        }
    }

    const candidates = [];
    const seen = new Set();
    const candidatesByKey = new Map();
    newItems.forEach((item) => {
        addFanCollectionReleaseCandidate(
            candidates,
            seen,
            item,
            candidatesByKey,
            feedKind,
            true,
            false,
        );
    });
    if (
        candidates.length !== newItems.length ||
        candidates.some(
            (release) => !release || release.ownFanCollection !== true,
        )
    ) {
        return false;
    }

    const newCards = candidates.map((release) =>
        createArtistMusicFeedCard(release),
    );
    if (newCards.some((card) => !(card instanceof Element))) {
        return false;
    }

    const moreControl = list.querySelector(".bcampx-label-feed__more");
    if (moreControl) {
        moreControl.remove();
    }
    if (newCards.length) {
        list.append(...newCards);
    }
    const total = cards.length + newCards.length;
    incrementDebugCounter(
        "data-bcampx-label-feed-incremental-sync-count",
    );
    finishArtistMusicFeedSync(
        feedContext,
        sourceGrid,
        list,
        newCards,
        total,
        newCards.length > 0,
    );

    cache.items = items;
    return true;
}

export function scheduleArtistMusicFeedSync() {
    if (!STATE.artistMusicFeedBuilt || !STATE.artistMusicFeedNode) {
        return;
    }

    if (STATE.artistMusicFeedSyncTimer) {
        window.clearTimeout(STATE.artistMusicFeedSyncTimer);
    }

    STATE.artistMusicFeedSyncTimer = window.setTimeout(
        () => {
            STATE.artistMusicFeedSyncTimer = 0;
            syncArtistMusicFeedFromSourceGrid();
        },
        50,
    );
}

function syncArtistMusicFeedFromSourceGrid() {
    if (!STATE.artistMusicFeedBuilt || !STATE.artistMusicFeedNode) {
        return;
    }

    const context = getReleaseGridFeedContext();
    const feedKind = cleanText(
        STATE.artistMusicFeedNode.getAttribute(
            "data-bcampx-feed-kind",
        ) || "",
    );
    if (
        /^fan-/.test(feedKind) &&
        (!context ||
            STATE.artistMusicFeedNode.getAttribute(
                "data-bcampx-context-suspended",
            ) === "true")
    ) {
        return;
    }
    if (
        context &&
        context.sourceGrid &&
        STATE.artistMusicSourceGridNode !== context.sourceGrid
    ) {
        scheduleFanCollectionFeedContextSync();
        return;
    }

    const sourceGrid = STATE.artistMusicSourceGridNode;
    const list = STATE.artistMusicFeedNode.querySelector(
        ".bcampx-label-feed__list",
    );
    if (!sourceGrid || !list) {
        return;
    }
    incrementDebugCounter("data-bcampx-label-feed-sync-run-count");

    // This rebuild touches dozens of cards at once; the body observer
    // must not turn every attribute write into a rescan.
    suspendMutationObserver();
    try {

    const feedContext = {
        kind:
            STATE.artistMusicFeedNode.getAttribute(
                "data-bcampx-feed-kind",
            ) || "artist-music",
        sourceGrid,
    };
    // The source-grid observer records which items actually changed. A
    // scroll append then only has to recompute signatures for the new
    // cards; unchanged cards reuse their cached release object. If the
    // sync was requested by a non-grid path, or no item could be
    // identified, fall back to the full signature pass.
    const dirtyItems =
        STATE.artistMusicDirtyItems && STATE.artistMusicDirtyItems.size
            ? STATE.artistMusicDirtyItems
            : null;
    STATE.artistMusicDirtyItems = null;
    if (
        tryIncrementalArtistMusicFeedAppend(
            feedContext,
            dirtyItems,
            list,
        )
    ) {
        return;
    }
    const candidates = collectReleaseGridFeedCandidates(
        feedContext,
        dirtyItems,
    );
    const existingCards = Array.from(
        list.querySelectorAll(
            ".bcampx-label-feed-card[data-bcampx-release-url]",
        ),
    );
    const existingCardsByUrl = new Map();
    const existingCardsByGridItem = new Map();
    const existingCardsByItemId = new Map();
    const pushCard = (map, key, card) => {
        if (!key) {
            return;
        }
        const list = map.get(key);
        if (list) {
            list.push(card);
        } else {
            map.set(key, [card]);
        }
    };
    existingCards.forEach((card) => {
        const gridItem = card.__bcampxGridItem;
        if (gridItem instanceof Element) {
            existingCardsByGridItem.set(gridItem, card);
        }

        const cardRelease = card.__bcampxArtistMusicRelease;
        pushCard(
            existingCardsByItemId,
            cleanText(cardRelease && cardRelease.itemId),
            card,
        );

        pushCard(
            existingCardsByUrl,
            normalizeReleaseUrl(
                card.getAttribute("data-bcampx-release-url") || "",
            ),
            card,
        );
    });

    const nextCards = [];
    const nextUrls = new Set();
    const nextGridItems = new Set();
    // One card can only stand for one purchase record. A card that was
    // already claimed for an earlier record must not be handed to a second
    // one, even when both records share the release's item id.
    const claimedCards = new Set();
    const appendedCards = [];

    const claimCard = (card) => {
        if (!card || claimedCards.has(card)) {
            return null;
        }
        claimedCards.add(card);
        return card;
    };

    // Several cards can share a release URL or item id (a tag card plus the
    // native purchase card). Try each until one is both unclaimed and
    // allowed to serve this record.
    const pickCard = (cards, accept) => {
        for (const card of cards || []) {
            if (claimedCards.has(card)) {
                continue;
            }
            if (accept && !accept(card)) {
                continue;
            }
            claimedCards.add(card);
            return card;
        }
        return null;
    };

    candidates.forEach((release) => {
        if (!release || !release.releaseUrl) {
            return;
        }

        // Your own collection keeps one card per purchased item, even when
        // several purchases share a release URL, so those cards must be
        // deduplicated by source element identity rather than by URL.
        const gridItem = release.gridItem;
        if (release.ownFanCollection === true && gridItem instanceof Element) {
            if (nextGridItems.has(gridItem)) {
                return;
            }

            nextGridItems.add(gridItem);
            // A tag-only card can predate the native result for the same
            // purchase. Reuse it by purchase id so the tracklist it already
            // loaded is not thrown away when Bandcamp's response arrives.
            const releaseUrl = normalizeReleaseUrl(
                release.releaseUrl || "",
            );
            const unbound = (card) =>
                !(card.__bcampxGridItem instanceof Element);
            // A card bound to another native element belongs to that
            // purchase. Only cards that are not yet bound to a native
            // record (tag-index cards) may be reused by item id, and a
            // bound card for this very element is the best match.
            const ownExistingCard =
                claimCard(existingCardsByGridItem.get(gridItem)) ||
                pickCard(
                    existingCardsByItemId.get(
                        cleanText(release.itemId),
                    ),
                    (card) =>
                        unbound(card) ||
                        card.__bcampxGridItem === gridItem,
                ) ||
                // A card created from the tag index was never tied to a
                // native purchase, so reusing it by URL cannot merge two
                // separate purchases of the same release.
                pickCard(
                    existingCardsByUrl.get(releaseUrl),
                    unbound,
                );
            if (ownExistingCard) {
                if (
                    ownExistingCard.__bcampxArtistMusicRelease !== release
                ) {
                    updateArtistMusicFeedCardSource(
                        ownExistingCard,
                        release,
                    );
                }
                nextCards.push(ownExistingCard);
                return;
            }

            const ownNewCard = createArtistMusicFeedCard(release);
            claimCard(ownNewCard);
            nextCards.push(ownNewCard);
            appendedCards.push(ownNewCard);
            return;
        }

        const releaseUrl = normalizeReleaseUrl(release.releaseUrl);
        if (!releaseUrl || nextUrls.has(releaseUrl)) {
            return;
        }

        nextUrls.add(releaseUrl);
        // The wishlist search has the same reconciliation problem: a tag
        // card can be replaced by the native result for the same item when
        // the two pick different release URLs (album vs track).
        const existingCard =
            pickCard(existingCardsByUrl.get(releaseUrl)) ||
            pickCard(
                existingCardsByItemId.get(
                    cleanText(release.itemId),
                ),
            );
        if (existingCard) {
            if (existingCard.__bcampxArtistMusicRelease !== release) {
                updateArtistMusicFeedCardSource(existingCard, release);
            }
            nextCards.push(existingCard);
            return;
        }

        const newCard = createArtistMusicFeedCard(release);
        claimCard(newCard);
        nextCards.push(newCard);
        appendedCards.push(newCard);
    });
    const existingMoreControl = list.querySelector(
        ".bcampx-label-feed__more",
    );
    if (existingMoreControl) {
        existingMoreControl.remove();
    }
    const currentCards = Array.from(list.children);
    // Appending a batch must not reinsert every existing card. Only fall
    // back to replaceChildren when the order or membership actually
    // changed (search/tag reconciliation, removals).
    const appendOnly =
        currentCards.length <= nextCards.length &&
        currentCards.every(
            (card, index) => nextCards[index] === card,
        );
    let listChanged = false;
    if (appendOnly) {
        const appended = nextCards.slice(currentCards.length);
        if (appended.length) {
            list.append(...appended);
            listChanged = true;
        }
    } else {
        const cardOrderChanged =
            currentCards.length !== nextCards.length ||
            nextCards.some(
                (card, index) => currentCards[index] !== card,
            );
        if (cardOrderChanged) {
            list.replaceChildren(...nextCards);
            listChanged = true;
        }
    }
    finishArtistMusicFeedSync(
        feedContext,
        sourceGrid,
        list,
        appendedCards,
        nextCards.length,
        listChanged,
    );

    } finally {
        resumeMutationObserver();
    }
}

function updateArtistMusicFeedCardSource(card, release) {
    if (!(card instanceof Element) || !release) {
        return;
    }

    card.__bcampxArtistMusicRelease = release;
    card.__bcampxGridItem =
        release.gridItem instanceof Element ? release.gridItem : null;
    applyTagSearchCardMarkers(card, release);
    if (release.releaseUrl) {
        card.setAttribute("data-bcampx-release-url", release.releaseUrl);
        card.querySelectorAll("[data-bcampx-release-url]").forEach(
            (node) => {
                node.setAttribute(
                    "data-bcampx-release-url",
                    release.releaseUrl,
                );
            },
        );
    }
    if (release.bandId) {
        card.setAttribute("data-bcampx-band-id", release.bandId);
    } else {
        card.removeAttribute("data-bcampx-band-id");
    }

    if (!release.initialData) {
        return;
    }

    const controller = getCardController(card);
    updateArtistMusicCardBuyAction(
        card,
        controller && controller.data
            ? controller.data
            : release.initialData,
    );
}

let artistMusicLoadMoreScrollTimer = 0;

export function handleArtistMusicNativeLoadMoreClick(event) {
    if (
        STATE.artistMusicFeedView !== "feed" ||
        !STATE.artistMusicFeedBuilt ||
        !STATE.artistMusicSourceGridNode ||
        !event ||
        !(event.target instanceof Element)
    ) {
        return;
    }

    const button = event.target.closest(".expand-container .show-more");
    if (!button || !isArtistMusicNativeLoadMoreButton(button)) {
        return;
    }

    STATE.artistMusicLoadMoreScrollPending = true;
    window.clearTimeout(artistMusicLoadMoreScrollTimer);
    artistMusicLoadMoreScrollTimer = window.setTimeout(() => {
        STATE.artistMusicLoadMoreScrollPending = false;
    }, 5000);
    markDebugState("data-bcampx-label-feed-load-more-clicked", "true");
}

function isArtistMusicNativeLoadMoreButton(button) {
    const sourceGrid = STATE.artistMusicSourceGridNode;
    const nativeGrid =
        sourceGrid &&
        (sourceGrid.closest(".grid") ||
            sourceGrid.closest(".collection-items") ||
            sourceGrid.parentElement);
    return Boolean(nativeGrid && nativeGrid.contains(button));
}

function scrollToNewArtistMusicFeedCards(cards) {
    const firstCard = (cards || []).find(
        (card) => card instanceof Element && card.isConnected,
    );
    if (!firstCard) {
        return;
    }

    window.setTimeout(() => {
        if (!firstCard.isConnected) {
            return;
        }

        scrollElementIntoViewBelowPageChrome(firstCard);
        markDebugState("data-bcampx-label-feed-load-more-scrolled", "true");
    }, 0);
}

function scrollElementIntoViewBelowPageChrome(node) {
    if (!(node instanceof Element)) {
        return;
    }

    const rect = node.getBoundingClientRect();
    const offset = getArtistMusicPageChromeOffset();
    window.scrollTo({
        top: Math.max(0, window.scrollY + rect.top - offset),
        behavior: "auto",
    });
}

let pageChromeOffsetCache = 0;
let pageChromeOffsetCacheAt = 0;
const PAGE_CHROME_OFFSET_CACHE_TTL_MS = 750;

function getArtistMusicPageChromeOffset() {
    const now = Date.now();
    if (
        pageChromeOffsetCache > 0 &&
        now - pageChromeOffsetCacheAt < PAGE_CHROME_OFFSET_CACHE_TTL_MS
    ) {
        return pageChromeOffsetCache;
    }

    const topChromeBottom = Array.from(document.body.children)
        .map((node) => {
            if (!(node instanceof Element)) {
                return 0;
            }

            const style = window.getComputedStyle(node);
            if (
                style.position !== "fixed" &&
                style.position !== "sticky"
            ) {
                return 0;
            }

            const rect = node.getBoundingClientRect();
            if (rect.top > 4 || rect.bottom <= 0 || rect.height > 180) {
                return 0;
            }

            return rect.bottom;
        })
        .reduce((max, value) => Math.max(max, value), 0);

    const offset = Math.max(12, Math.ceil(topChromeBottom + 12));
    pageChromeOffsetCache = offset;
    pageChromeOffsetCacheAt = now;
    return offset;
}

function getReleaseGridFeedContext() {
    if (isArtistMusicPage()) {
        const sourceGrid = findArtistMusicSourceGrid();
        return sourceGrid
            ? {
                  kind: "artist-music",
                  ariaLabel: "Bandcamp release feed",
                  sourceGrid,
              }
            : null;
    }

    if (isFanCollectionPage()) {
        const sourceGrid = findFanCollectionActiveGrid();
        const kind = getFanCollectionFeedKind(sourceGrid);
        return sourceGrid
            ? {
                  kind,
                  ariaLabel: kind === "fan-wishlist"
                      ? "Bandcamp wishlist feed"
                      : "Bandcamp collection feed",
                  sourceGrid,
              }
            : null;
    }

    return null;
}

function getFanCollectionFeedKind(sourceGrid) {
    const grid = sourceGrid && sourceGrid.closest(".grid");
    if (grid && /^(wishlist|wishlist-search)-grid$/.test(grid.id)) {
        return "fan-wishlist";
    }
    if (grid && /^(collection|collection-search)-grid$/.test(grid.id)) {
        return "fan-collection";
    }
    return isFanWishlistPage() ? "fan-wishlist" : "fan-collection";
}

function ensureArtistMusicViewToggle() {
    if (STATE.artistMusicToggleNode || !document.body) {
        return STATE.artistMusicToggleNode;
    }

    const button = document.createElement("div");
    button.className = "bcampx-label-feed-toggle";
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.addEventListener("click", () => {
        void setArtistMusicFeedView(
            STATE.artistMusicFeedView === "feed" ? "original" : "feed",
        );
    });
    button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        button.click();
    });
    button.append(
        createArtistMusicViewToggleIcon("original"),
        createArtistMusicViewToggleIcon("feed"),
    );

    document.body.appendChild(button);
    STATE.artistMusicToggleNode = button;
    positionArtistMusicViewToggle();
    scheduleArtistMusicViewTogglePlacement();
    return button;
}

function createArtistMusicViewToggleIcon(view) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("bcampx-label-feed-toggle__icon");
    svg.classList.add(`bcampx-label-feed-toggle__icon--${view}`);
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    if (view === "feed") {
        [
            ["4", "5", "12"],
            ["4", "10", "12"],
            ["4", "15", "12"],
        ].forEach(([x1, y, x2]) => {
            const line = document.createElementNS(SVG_NS, "path");
            line.setAttribute("d", `M${x1} ${y}h${x2}`);
            line.setAttribute("fill", "none");
            line.setAttribute("stroke", "currentColor");
            line.setAttribute("stroke-width", "1.35");
            line.setAttribute("stroke-linecap", "round");
            svg.appendChild(line);
        });
        return svg;
    }

    [
        ["4", "4"],
        ["11", "4"],
        ["4", "11"],
        ["11", "11"],
    ].forEach(([x, y]) => {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", "5");
        rect.setAttribute("height", "5");
        rect.setAttribute("rx", "0.8");
        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", "currentColor");
        rect.setAttribute("stroke-width", "1.25");
        svg.appendChild(rect);
    });
    return svg;
}

function scheduleArtistMusicViewTogglePlacement() {
    [250, 1000, 2500].forEach((delay) => {
        window.setTimeout(positionArtistMusicViewToggle, delay);
    });
}

function positionArtistMusicViewToggle() {
    const button = STATE.artistMusicToggleNode;
    if (!button || !document.body) {
        return;
    }

    const navbar = document.querySelector("#band-navbar");
    if (navbar) {
        navbar.appendChild(button);
        navbar.classList.add("bcampx-label-feed-navbar-host");
        button.classList.remove("bcampx-label-feed-toggle--floating");
        button.classList.add("bcampx-label-feed-toggle--inline");
        button.classList.add("bcampx-label-feed-toggle--navbar");
        return;
    }

    const target = findArtistMusicViewToggleTarget();
    if (target && target.parentNode) {
        target.parentNode.insertBefore(button, target);
        button.classList.remove("bcampx-label-feed-toggle--floating");
        button.classList.add("bcampx-label-feed-toggle--inline");
        button.classList.remove("bcampx-label-feed-toggle--navbar");
        return;
    }

    if (!document.body.contains(button)) {
        document.body.appendChild(button);
    }
    button.classList.remove("bcampx-label-feed-toggle--inline");
    button.classList.remove("bcampx-label-feed-toggle--navbar");
    button.classList.add("bcampx-label-feed-toggle--floating");
}

function findArtistMusicViewToggleTarget() {
    return (
        document.querySelector(".label-band-selector.fade-in-on-load") ||
        document.querySelector(".label-band-selector") ||
        document.querySelector(".collection-tabs")
    );
}

async function setArtistMusicFeedView(view) {
    const nextView = view === "original" ? "original" : "feed";
    applyArtistMusicFeedView(nextView);
    await storageSet(ARTIST_MUSIC_VIEW_KEY, nextView);
}

function applyArtistMusicFeedView(view, options = {}) {
    const nextView = view === "original" ? "original" : "feed";
    const feed = STATE.artistMusicFeedNode;
    const sourceGrid = STATE.artistMusicSourceGridNode;
    const viewChanged = STATE.artistMusicFeedView !== nextView;

    STATE.artistMusicFeedView = nextView;
    if (nextView !== "feed" && feed) {
        cancelArtistMusicFeedAutoFetches(feed);
    }
    if (feed) {
        feed.hidden = nextView !== "feed";
    }
    if (sourceGrid) {
        setArtistMusicNativeSectionHidden(
            sourceGrid,
            nextView === "feed",
            "offscreen",
        );
        sourceGrid.setAttribute(
            "data-bcampx-label-feed-source-hidden",
            nextView === "feed" ? "true" : "false",
        );
    }
    STATE.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();
    STATE.artistMusicFeaturedNodes.forEach((node) => {
        setArtistMusicNativeSectionHidden(node, nextView === "feed");
        node.setAttribute(
            "data-bcampx-label-feed-featured-hidden",
            nextView === "feed" ? "true" : "false",
        );
    });

    document.body.classList.toggle(
        "bcampx-label-feed-page--original",
        nextView === "original",
    );
    document.body.classList.toggle(
        "bcampx-label-feed-page--enhanced",
        nextView === "feed",
    );

    updateArtistMusicViewToggle();
    markDebugState("data-bcampx-label-feed-view", nextView);

    if (nextView === "feed" && feed) {
        if (!options.skipFeedWork) {
            // A feed that was built while the native grid was visible has
            // no card controllers yet: its synthetic cards were hidden
            // during the initial scan.  Observing only the viewport here
            // leaves every off-screen card as a "supported by" placeholder
            // until it is scrolled into view. Prime every loaded card's
            // shell when returning from the grid, but prefetch only a
            // bounded top-of-list batch. That preserves the blank-free
            // transition without downloading a large collection in full.
            if (viewChanged) {
                primeArtistMusicFeedCards(feed);
            }
            scheduleScan(feed);
            rearmArtistMusicFeedCardObservers(feed);
            window.setTimeout(
                () => rearmArtistMusicFeedCardObservers(feed),
                CONFIG.scanDebounceMs + 20,
            );
            scheduleArtistMusicFeedVisibleFetch(feed);
        }
    }
}

function primeArtistMusicFeedCards(feed) {
    if (!(feed instanceof Element) || feed.hidden || !CONFIG.autoFetchOnVisible) {
        return;
    }

    let queuedCount = 0;
    const maxQueued = Math.max(
        0,
        Number(CONFIG.maxViewSwitchPrefetchCards) || 0,
    );
    Array.from(feed.querySelectorAll(".bcampx-label-feed-card")).forEach(
        (card) => {
            const releaseUrl = cleanText(
                card.getAttribute("data-bcampx-release-url") || "",
            );
            if (!releaseUrl) {
                return;
            }

            const controller = ensureCardController(card, releaseUrl);

            if (isOwnFanTrackCard(card)) {
                // Own collection tracks never prefetch release pages, but
                // they still need a shell/Tracklist built here. Otherwise
                // switching from grid view back to list view leaves only
                // the "supported by" placeholder on single-track cards.
                return;
            }

            if (
                controller &&
                !controller.loaded &&
                !controller.loading &&
                !controller.autoFetchQueued &&
                queuedCount < maxQueued
            ) {
                queueAutoFetch(controller);
                queuedCount += 1;
            }
        },
    );
}

function cancelArtistMusicFeedAutoFetches(feed) {
    if (!(feed instanceof Element) || !STATE.autoFetchQueue.length) {
        return;
    }

    STATE.autoFetchQueue = STATE.autoFetchQueue.filter((entry) => {
        const controller = entry && entry.controller;
        const card = controller && controller.card;
        if (!(card instanceof Element) || !feed.contains(card)) {
            return true;
        }

        controller.autoFetchQueued = false;
        return false;
    });
    updateAutoFetchDebugState();
}

export function rearmArtistMusicFeedCardObservers(feed) {
    if (
        !(feed instanceof Element) ||
        feed.hidden ||
        !STATE.observer
    ) {
        return;
    }

    Array.from(feed.querySelectorAll(".bcampx-label-feed-card")).forEach(
        (card) => {
            if (isOwnFanTrackCard(card)) {
                return;
            }

            const controller = getCardController(card);
            if (
                !controller ||
                controller.loaded ||
                controller.loading ||
                controller.autoFetchQueued
            ) {
                return;
            }

            STATE.observer.unobserve(card);
            STATE.observer.observe(card);
            card.setAttribute(OBSERVED_ATTR, "true");
        },
    );
}

export function scheduleArtistMusicFeedVisibleFetch(feed, cards = null) {
    if (Array.isArray(cards)) {
        if (!STATE.artistMusicVisibleCardsPending) {
            STATE.artistMusicVisibleCardsPending = new Set();
        }
        cards.forEach((card) => {
            if (card instanceof Element) {
                STATE.artistMusicVisibleCardsPending.add(card);
            }
        });
    } else {
        // A full scan is only needed for view switches and the initial
        // build; ordinary scroll appends pass just the new cards.
        STATE.artistMusicVisibleFetchAll = true;
    }

    if (STATE.artistMusicVisibleFetchTimer) {
        return;
    }

    STATE.artistMusicVisibleFetchTimer = window.setTimeout(() => {
        STATE.artistMusicVisibleFetchTimer = 0;
        const all = STATE.artistMusicVisibleFetchAll;
        const pending = STATE.artistMusicVisibleCardsPending;
        STATE.artistMusicVisibleFetchAll = false;
        STATE.artistMusicVisibleCardsPending = null;
        if (all) {
            fetchVisibleArtistMusicFeedCards(feed);
            return;
        }
        if (pending && pending.size) {
            fetchVisibleArtistMusicFeedCards(
                feed,
                Array.from(pending),
            );
        }
    }, CONFIG.scanDebounceMs + 40);
}

function fetchVisibleArtistMusicFeedCards(feed, onlyCards = null) {
    if (!(feed instanceof Element) || feed.hidden) {
        return;
    }

    const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth || 0;
    const preloadMargin = getArtistMusicFeedPreloadMargin();
    const pending = [];
    const cardList = Array.isArray(onlyCards)
        ? onlyCards
        : Array.from(feed.querySelectorAll(".bcampx-label-feed-card"));
    if (!cardList.length) {
        return;
    }

    // Read every rect first, then create/queue in a second pass. Writing
    // loading state between rect reads forced a synchronous layout for
    // every card on a large feed.
    cardList.forEach(
        (card) => {
            if (isOwnFanTrackCard(card)) {
                return;
            }

            const controller = getCardController(card);
            if (
                controller &&
                (controller.loaded ||
                    controller.loading ||
                    controller.autoFetchQueued)
            ) {
                return;
            }

            const releaseUrl = cleanText(
                card.getAttribute("data-bcampx-release-url") || "",
            );
            if (!releaseUrl) {
                return;
            }

            const rect = card.getBoundingClientRect();
            if (
                !isArtistMusicFeedCardVisible(
                    card,
                    viewportWidth,
                    viewportHeight,
                    preloadMargin,
                    rect,
                )
            ) {
                return;
            }
            pending.push({ card, releaseUrl });
        },
    );

    pending.forEach(({ card, releaseUrl }) => {
        const controller = ensureCardController(card, releaseUrl);
        if (
            controller &&
            !controller.loaded &&
            !controller.loading &&
            !controller.autoFetchQueued
        ) {
            queueAutoFetch(controller);
        }
    });
}

function getArtistMusicFeedPreloadMargin() {
    const match = String(CONFIG.observerRootMargin || "").match(/(-?\d+)px/);
    return match ? Math.max(0, Number(match[1])) : 0;
}

function isArtistMusicFeedCardVisible(
    card,
    viewportWidth,
    viewportHeight,
    preloadMargin,
    measuredRect,
) {
    if (!(card instanceof Element)) {
        return false;
    }

    const rect = measuredRect || card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return false;
    }

    return (
        rect.bottom >= -preloadMargin &&
        rect.right >= 0 &&
        rect.top <= viewportHeight + preloadMargin &&
        rect.left <= viewportWidth
    );
}

function setArtistMusicNativeSectionHidden(node, hidden, mode = "display") {
    if (!(node instanceof Element)) {
        return;
    }

    if (mode === "offscreen") {
        node.hidden = false;
        node.classList.toggle(
            "bcampx-label-feed-native-offscreen",
            hidden,
        );
        if (hidden) {
            node.setAttribute("aria-hidden", "true");
            node.style.removeProperty("display");
            return;
        }

        node.classList.remove("bcampx-label-feed-native-offscreen");
        node.removeAttribute("aria-hidden");
        return;
    }

    node.classList.remove("bcampx-label-feed-native-offscreen");
    node.hidden = hidden;
    if (hidden) {
        if (!node.hasAttribute("data-bcampx-original-display")) {
            node.setAttribute(
                "data-bcampx-original-display",
                node.style.display || "",
            );
        }
        node.style.display = "none";
        return;
    }

    const originalDisplay = node.getAttribute(
        "data-bcampx-original-display",
    );
    node.removeAttribute("data-bcampx-original-display");
    if (originalDisplay) {
        node.style.display = originalDisplay;
    } else {
        node.style.removeProperty("display");
    }
}

function updateArtistMusicViewToggle() {
    const toggle = STATE.artistMusicToggleNode;
    if (!toggle) {
        return;
    }

    const showingFeed = STATE.artistMusicFeedView === "feed";
    toggle.classList.toggle(
        "bcampx-label-feed-toggle--feed",
        showingFeed,
    );
    toggle.classList.toggle(
        "bcampx-label-feed-toggle--original",
        !showingFeed,
    );
    toggle.setAttribute(
        "aria-label",
        showingFeed ? "Show original grid" : "Show enhanced feed",
    );
    toggle.setAttribute("aria-pressed", showingFeed ? "true" : "false");
    toggle.title = showingFeed ? "Show original grid" : "Show enhanced feed";
}

export function findArtistMusicSourceGrid() {
    const gridItem = document.querySelector(".music-grid-item");
    return (
        document.querySelector("#music-grid") ||
        document.querySelector(".music-grid") ||
        (gridItem ? gridItem.parentElement : null) ||
        null
    );
}

function findArtistMusicFeaturedNodes() {
    const nodes = new Set();
    document
        .querySelectorAll(".featured-grid.featured-items, .featured-items")
        .forEach((node) => nodes.add(node));
    document.querySelectorAll(".featured-item").forEach((item) => {
        const container =
            item.closest(".featured-grid, .featured-items") || item;
        nodes.add(container);
    });
    return Array.from(nodes).filter(
        (node) =>
            node instanceof Element &&
            !node.closest(".bcampx-label-feed"),
    );
}

function collectReleaseGridFeedCandidates(feedContext, dirtyItems = null) {
    if (feedContext && /^fan-/.test(feedContext.kind)) {
        const candidates = collectFanCollectionReleaseCandidates(
            feedContext,
            dirtyItems,
        );
        // Bandcamp's search index stops at titles and artists, so releases
        // that only match the query through their tags are appended after
        // the native results instead of replacing them.
        collectFanTagSearchExtraReleases(feedContext, candidates).forEach(
            (release) => candidates.push(release),
        );
        return candidates;
    }

    return collectArtistMusicReleaseCandidates();
}

function collectArtistMusicReleaseCandidates() {
    const seen = new Set();
    const candidatesByKey = new Map();
    const candidates = [];
    const featuredItems = Array.from(
        document.querySelectorAll(
            ".featured-items .featured-item, .featured-grid .featured-item, .featured-item",
        ),
    );
    const excluded = [
        "#sidebar",
        "aside",
        '[role="complementary"]',
        ".sidebar",
        ".cart",
        "#cart",
        '[class*="cart"]',
        '[class*="Cart"]',
        ".checkout",
    ].join(",");
    const gridItems = Array.from(
        document.querySelectorAll(
            [
                "#music-grid .music-grid-item",
                ".music-grid .music-grid-item",
                "[data-item-id^='album-']",
                "[data-item-id^='track-']",
            ].join(", "),
        ),
    ).filter((item) => !item.closest(excluded));

    featuredItems.forEach((item) => {
        addArtistMusicReleaseCandidate(
            candidates,
            seen,
            item,
            null,
            "featured",
            candidatesByKey,
        );
    });

    gridItems.forEach((item) => {
        addArtistMusicReleaseCandidate(
            candidates,
            seen,
            item,
            null,
            "grid",
            candidatesByKey,
        );
    });


    return candidates;
}

function collectFanCollectionReleaseCandidates(
    feedContext,
    dirtyItems = null,
) {
    const seen = new Set();
    const candidatesByKey = new Map();
    const candidates = [];
    const sourceGrid = feedContext && feedContext.sourceGrid;
    const feedKind = feedContext && feedContext.kind;
    const ownFanCollection =
        feedKind === "fan-collection" && isCurrentFanProfileOwner();
    const items = Array.from(
        (sourceGrid || document).querySelectorAll(
            "li.collection-item-container[data-playerdata], li.collection-item-container",
        ),
    );

    items.forEach((item) => {
        addFanCollectionReleaseCandidate(
            candidates,
            seen,
            item,
            candidatesByKey,
            feedKind,
            ownFanCollection,
            Boolean(dirtyItems && !dirtyItems.has(item)),
        );
    });

    if (sourceGrid instanceof Element) {
        STATE.artistMusicFeedCandidateCache = {
            grid: sourceGrid,
            kind: feedKind,
            ownFanCollection,
            items,
        };
    }

    return candidates;
}

// Shared by the feed scanner and by tag results: both need the same release
// metadata out of a native collection item.
function hashCacheValue(value) {
    const text = String(value || "");
    let hash = text.length;
    // Sampling keeps this cheap for long data-playerdata strings; the
    // length plus sampled code units is enough to notice a rewrite.
    for (let index = 0; index < text.length; index += 7) {
        hash = (hash * 31 + text.charCodeAt(index)) | 0;
    }
    return hash;
}

function getFanCollectionItemSignature(item, feedKind, ownFanCollection) {
    if (!(item instanceof Element)) {
        return "";
    }

    const parts = [feedKind || "", ownFanCollection ? "1" : "0"];
    [
        "data-itemid",
        "data-tralbumid",
        "data-tralbumtype",
        "data-itemtype",
        "data-title",
        "data-bandid",
        "data-trackid",
    ].forEach((name) => {
        parts.push(item.getAttribute(name) || "");
    });
    const playerData = item.getAttribute("data-playerdata") || "";
    parts.push(String(playerData.length), String(hashCacheValue(playerData)));
    const itemJson = item.getAttribute("data-item-json") || "";
    parts.push(String(itemJson.length), String(hashCacheValue(itemJson)));

    const releaseLink = item.querySelector(
        "a.item-link[href], .collection-title-details a[href], a[href]",
    );
    parts.push(releaseLink ? releaseLink.getAttribute("href") || "" : "");
    const title = item.querySelector(
        ".collection-item-title, .item-title",
    );
    parts.push(title ? normalizedText(title) : "");
    const artist = item.querySelector(".collection-item-artist");
    parts.push(artist ? normalizedText(artist) : "");
    return parts.join("\u0001");
}

function createFanCollectionRelease(
    item,
    feedKind,
    ownFanCollection,
    options = {},
) {
    if (!(item instanceof Element)) {
        return null;
    }

    const cache = STATE.fanCollectionReleaseCache;
    const cached = cache && cache.get(item);
    if (
        options.skipSignature === true &&
        cached &&
        cached.release &&
        cached.feedKind === feedKind &&
        cached.ownFanCollection === ownFanCollection
    ) {
        return cached.release;
    }

    const signature = getFanCollectionItemSignature(
        item,
        feedKind,
        ownFanCollection,
    );
    if (
        cached &&
        cached.signature === signature &&
        cached.feedKind === feedKind &&
        cached.ownFanCollection === ownFanCollection
    ) {
        return cached.release;
    }

    const playerData = buildFanCollectionPlayerData(item, feedKind);
    const itemType = normalizeReleaseItemType(
        item.getAttribute("data-tralbumtype") ||
            item.getAttribute("data-itemtype") ||
            "",
    );
    const fallbackReleaseUrl = getFanCollectionReleaseUrl(
        item,
        playerData,
        itemType,
    );
    const resolvedItemType =
        itemType || normalizeReleaseItemType("", fallbackReleaseUrl);
    const ownTrackItem =
        ownFanCollection &&
        (resolvedItemType === "track" ||
            /\/track\//.test(
                normalizeReleaseUrl(playerData && playerData.url),
            ) ||
            Boolean(item.querySelector('a[href*="/track/"]')));
    const releaseUrl = ownTrackItem
        ? getFanCollectionReleaseUrl(item, playerData, itemType, true)
        : fallbackReleaseUrl;
    if (!releaseUrl) {
        return null;
    }

    const title = getFanCollectionReleaseTitle(
        item,
        playerData,
        itemType,
        releaseUrl,
    );
    const artist = getFanCollectionReleaseArtist(item, playerData);
    const release = {
        releaseUrl,
        title,
        artist,
        artUrl: getArtistMusicReleaseArtUrl(item),
        itemId: getArtistMusicReleaseItemId(item),
        itemType: ownTrackItem ? "track" : resolvedItemType,
        bandId: getArtistMusicReleaseBandId(item),
        tralbumId:
            Number(item.getAttribute("data-tralbumid")) ||
            Number(item.getAttribute("data-itemid")) ||
            0,
        tralbumType: cleanText(
            item.getAttribute("data-tralbumtype") || "",
        ).toLowerCase(),
        feedKind,
        ownFanCollection,
        pageUnavailable: !hasNativeReleasePageLink(item),
        sourceItem: item,
        gridItem: item,
        featuredItem: null,
        playerData,
        initialData: buildFanCollectionInitialReleaseData(
            item,
            playerData,
            releaseUrl,
            title,
            artist,
            feedKind,
        ),
    };
    if (cache) {
        cache.set(item, {
            signature,
            release,
            feedKind,
            ownFanCollection,
        });
    }
    return release;
}

function addFanCollectionReleaseCandidate(
    candidates,
    seen,
    item,
    candidatesByKey,
    feedKind,
    ownFanCollection,
    skipSignature = false,
) {
    const release = createFanCollectionRelease(
        item,
        feedKind,
        ownFanCollection,
        { skipSignature },
    );
    if (!release) {
        return;
    }

    if (release.ownFanCollection) {
        // Every item in your own collection is a separate purchase with
        // its own download and ownership actions. Never fold one item into
        // another here: a single-track purchase can be reported as an
        // album tralbum, so neighbours from the same album share a release
        // URL and merging them would drop their download links.
        // Deduplicate by element identity only.
        if (seen.has(item)) {
            return;
        }
        seen.add(item);
        candidates.push(release);
        return;
    }

    const dedupeKeys = getArtistMusicReleaseDedupeKeys(release);
    const existingKey = dedupeKeys.find((key) => seen.has(key));
    if (existingKey) {
        mergeArtistMusicReleaseCandidate(
            candidatesByKey.get(existingKey),
            item,
            "grid",
        );
        return;
    }

    dedupeKeys.forEach((key) => {
        seen.add(key);
        candidatesByKey.set(key, release);
    });
    candidates.push(release);
}

// Tag matches that already exist as native cards reuse that card's data:
// the cover, preview player data, download link and release URL are the
// same ones Bandcamp rendered, so nothing depends on our compact index
// record being complete.
export function buildFanTagSearchNativeRelease(item, feedKind) {
    const release = createFanCollectionRelease(
        item,
        feedKind,
        feedKind === "fan-collection" && isCurrentFanProfileOwner(),
    );
    if (!release) {
        return null;
    }

    // createFanCollectionRelease is cached per item; do not stamp the
    // shared object with tag-only fields or the native card would inherit
    // them on the next feed sync. Cache the wrapper too so repeated tag
    // syncs do not rebuild/update the same tag card on every pass.
    const tagCache = STATE.fanTagNativeReleaseCache;
    const cached = tagCache && tagCache.get(item);
    if (
        cached &&
        cached.base === release &&
        cached.release.pageUnavailable === release.pageUnavailable
    ) {
        return cached.release;
    }

    const tagRelease = {
        ...release,
        tagSearch: true,
        tagOrigin: "native",
    };
    if (tagCache) {
        tagCache.set(item, { base: release, release: tagRelease });
    }
    return tagRelease;
}

function getFanCollectionReleaseUrl(
    item,
    playerData,
    itemType,
    preferTrackLink = false,
) {
    const albumUrl = cleanText(playerData && playerData.album && playerData.album.url);
    const trackUrl = cleanText(playerData && playerData.url);
    const linkUrl = normalizeReleaseUrl(
        item.querySelector(RELEASE_LINK_SELECTOR)?.href || "",
    );

    if (preferTrackLink) {
        const trackLinkUrl = normalizeReleaseUrl(
            Array.from(item.querySelectorAll('a[href*="/track/"]'))
                .map((link) => normalizeReleaseUrl(link.href))
                .find(Boolean) || "",
        );
        return normalizeReleaseUrl(
            trackUrl || trackLinkUrl || linkUrl || albumUrl,
        );
    }

    return normalizeReleaseUrl(
        itemType === "track"
            ? trackUrl || linkUrl || albumUrl
            : albumUrl || linkUrl || trackUrl,
    );
}

function getFanCollectionReleaseTitle(item, playerData, itemType, releaseUrl) {
    const playerTitle =
        itemType === "album"
            ? playerData && playerData.album && playerData.album.title
            : playerData && playerData.title;
    return (
        cleanText(playerTitle || "") ||
        getArtistMusicReleaseTitle(
            item,
            item.querySelector(RELEASE_LINK_SELECTOR),
            releaseUrl,
        )
    );
}


// Current Bandcamp collection pages keep item metadata and preview streams
// in pagedata blobs (item_cache / tracklists), not in per-item attributes.
// Older markup used data-playerdata; both shapes are supported here.
function getFanPageDataBlob() {
    if (STATE.fanPageDataBlob !== undefined) {
        return STATE.fanPageDataBlob;
    }

    let blob = null;
    try {
        blob = parseJsonAttribute(
            document.querySelector("#pagedata[data-blob]"),
            "data-blob",
        );
    } catch (_error) {
        blob = null;
    }
    STATE.fanPageDataBlob =
        blob && typeof blob === "object" && !Array.isArray(blob)
            ? blob
            : {};
    return STATE.fanPageDataBlob;
}

function getFanCollectionDataSection(name, kind) {
    const blob = getFanPageDataBlob();
    const section = blob && blob[name];
    const scoped = section && section[kind];
    return scoped && typeof scoped === "object" && !Array.isArray(scoped)
        ? scoped
        : {};
}

function getFanCollectionItemCache(kind) {
    return getFanCollectionDataSection("item_cache", kind);
}

function getFanCollectionTracklists(kind) {
    return getFanCollectionDataSection("tracklists", kind);
}

function getFanCollectionDataKind(feedKind) {
    return feedKind === "fan-wishlist" ? "wishlist" : "collection";
}

function getFanCollectionItemKey(item) {
    if (!(item instanceof Element)) {
        return "";
    }

    const rawType = cleanText(
        item.getAttribute("data-tralbumtype") ||
            item.getAttribute("data-itemtype") ||
            "",
    ).toLowerCase();
    const type = rawType === "t" || rawType === "track" ? "t" : "a";
    const id = cleanText(
        item.getAttribute("data-tralbumid") ||
            item.getAttribute("data-itemid") ||
            "",
    );
    return id ? `${type}${id}` : "";
}

export function getFanCollectionCardKind(card) {
    if (!(card instanceof Element)) {
        return "collection";
    }
    return card.closest(
        "#wishlist-grid, #wishlist-items, [id*='wishlist']",
    )
        ? "wishlist"
        : "collection";
}

export function getFanCollectionCachedItem(item, kind) {
    const key = getFanCollectionItemKey(item);
    if (!key) {
        return null;
    }
    return getFanCollectionItemCache(kind)[key] || null;
}

function getFanCollectionFeaturedTrack(item, kind) {
    const key = getFanCollectionItemKey(item);
    if (!key) {
        return null;
    }

    const cacheItem = getFanCollectionItemCache(kind)[key] || null;
    const list = getFanCollectionTracklists(kind)[key];
    const tracks = Array.isArray(list) ? list : [];
    const featuredId =
        cleanText(item.getAttribute("data-trackid")) ||
        cleanText(cacheItem && cacheItem.featured_track);
    if (featuredId) {
        const exact = tracks.find(
            (track) =>
                track && String(track.id) === String(featuredId),
        );
        if (exact) {
            return exact;
        }
    }
    return tracks[0] || null;
}

function buildFanCollectionPlayerData(item, feedKind) {
    const raw = item.getAttribute("data-playerdata") || "";
    const cacheKey = raw
        ? `${feedKind}\u0001${raw.length}:${hashCacheValue(raw)}`
        : `${feedKind}\u0001pagedata`;
    const cache = STATE.fanCollectionPlayerDataCache;
    const cached = cache && cache.get(item);
    if (cached && cached.key === cacheKey) {
        return cached.data;
    }

    let result = {};
    const explicit = parseJsonAttribute(item, "data-playerdata");
    if (
        explicit &&
        typeof explicit === "object" &&
        Object.keys(explicit).length
    ) {
        result = explicit;
    } else {
        const kind = getFanCollectionDataKind(feedKind);
        const cacheItem = getFanCollectionCachedItem(item, kind);
        const featured = getFanCollectionFeaturedTrack(item, kind);
        if (cacheItem || featured) {
            const albumUrl =
                cleanText(cacheItem && cacheItem.item_url) ||
                cleanText(getItemJsonReleaseUrl(item));

            result = {
                id: (featured && featured.id) ||
                    cleanText(item.getAttribute("data-trackid")),
                title:
                    cleanText(featured && featured.title) ||
                    cleanText(
                        cacheItem && cacheItem.featured_track_title,
                    ),
                artist_name: cleanText(cacheItem && cacheItem.band_name),
                duration: featured && featured.duration,
                url: cleanText(cacheItem && cacheItem.item_url),
                album: {
                    id:
                        Number(
                            cacheItem &&
                                (cacheItem.tralbum_id ||
                                    cacheItem.album_id),
                        ) || 0,
                    title: cleanText(cacheItem && cacheItem.item_title),
                    url: albumUrl,
                },
                _featuredStreamUrl: cleanText(
                    featured &&
                        featured.file &&
                        featured.file["mp3-128"],
                ),
                _featuredTrackId: featured && featured.id,
                _featuredTitle: cleanText(featured && featured.title),
                _featuredDuration: featured && featured.duration,
            };
        }
    }

    if (cache) {
        cache.set(item, { key: cacheKey, data: result });
    }
    return result;
}

// Search responses carry tracklists for every hit and each keystroke can
// create a new one. Keep a small session cache instead of growing for the
// lifetime of the page.
function trimFanCollectionSearchCaches() {
    const maxEntries = 60;
    [STATE.fanCollectionSearchResponseCache, STATE.fanCollectionSearchItemCache]
        .forEach((cache) => {
            while (cache && cache.size > maxEntries) {
                const oldest = cache.keys().next().value;
                if (oldest === undefined) {
                    break;
                }
                cache.delete(oldest);
            }
        });
}

// The collection search grid only renders items with a play control; the
// search response still carries the item URL and the full tracklist, so a
// hidden release can be played (and detected) without opening its page.
async function fetchFanCollectionSearchResponse(searchKey) {
    const key = cleanText(searchKey);
    if (!key) {
        return null;
    }

    const blob = getFanPageDataBlob();
    const fanData = blob && blob.fan_data;
    const fanId =
        Number(fanData && (fanData.fan_id || fanData.id)) || 0;
    if (!fanId) {
        return null;
    }

    const cacheKey = `${fanId}|${key}`;
    if (STATE.fanCollectionSearchResponseCache.has(cacheKey)) {
        return STATE.fanCollectionSearchResponseCache.get(cacheKey);
    }

    const response = await requestJson(
        "https://bandcamp.com/api/fancollection/1/search_items",
        {
            method: "POST",
            credentials: "include",
            data: JSON.stringify({
                fan_id: fanId,
                search_key: key,
                search_type: "collection",
            }),
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
        },
    );
    if (!response || typeof response !== "object") {
        return null;
    }

    STATE.fanCollectionSearchResponseCache.set(cacheKey, response);
    trimFanCollectionSearchCaches();
    return response;
}

// Start the lookup as soon as the user types, so the first play click does
// not have to wait for a cold extension fetch.
export function setupFanCollectionSearchPrefetch() {
    if (STATE.fanCollectionSearchPrefetchBound) {
        return;
    }

    STATE.fanCollectionSearchPrefetchBound = true;
    let timer = 0;
    document.addEventListener(
        "input",
        (event) => {
            const input = event.target;
            if (
                !(input instanceof Element) ||
                !input.closest("#collection-search") ||
                !isFanCollectionPage()
            ) {
                return;
            }

            // Tag search being disabled keeps the collection search box
            // free of extension requests; playback still resolves on click.
            if (!CONFIG.enableTagSearch) {
                return;
            }

            const key = cleanText(input.value);
            if (timer) {
                window.clearTimeout(timer);
            }
            if (key.length < 2) {
                return;
            }
            timer = window.setTimeout(() => {
                timer = 0;
                void fetchFanCollectionSearchResponse(key).catch(
                    () => {},
                );
            }, 350);
        },
        true,
    );
}

export async function getFanCollectionSearchItem(itemId) {
    const id = Number(itemId) || 0;
    if (!id) {
        return null;
    }

    const input = document.querySelector("#collection-search input");
    const searchKey = cleanText(input && input.value);
    if (!searchKey) {
        return null;
    }

    const blob = getFanPageDataBlob();
    const fanData = blob && blob.fan_data;
    const fanId =
        Number(fanData && (fanData.fan_id || fanData.id)) || 0;
    if (!fanId) {
        return null;
    }

    const cacheKey = `${fanId}|${searchKey}|${id}`;
    if (STATE.fanCollectionSearchItemCache.has(cacheKey)) {
        return STATE.fanCollectionSearchItemCache.get(cacheKey);
    }

    const response = await fetchFanCollectionSearchResponse(searchKey);
    const tralbums =
        response && Array.isArray(response.tralbums)
            ? response.tralbums
            : [];
    const item =
        tralbums.find(
            (entry) =>
                Number(entry.item_id) === id ||
                Number(entry.tralbum_id) === id,
        ) || null;
    if (!item) {
        return null;
    }

    const tracklistKey = `${item.tralbum_type || "a"}${item.tralbum_id}`;
    const tracklists =
        response && response.tracklists && typeof response.tracklists === "object"
            ? response.tracklists
            : {};
    const result = {
        item,
        tracks: Array.isArray(tracklists[tracklistKey])
            ? tracklists[tracklistKey]
            : [],
    };
    STATE.fanCollectionSearchItemCache.set(cacheKey, result);
    trimFanCollectionSearchCaches();
    return result;
}

function getFanCollectionRedownloadUrl(itemId) {
    const id = Number(itemId) || 0;
    if (!id) {
        return "";
    }

    const blob = getFanPageDataBlob();
    const collection = blob && blob.collection_data;
    const urls = collection && collection.redownload_urls;
    if (!urls || typeof urls !== "object") {
        return "";
    }
    return cleanText(urls[id] || "");
}

// The collection page itself carries only the featured preview stream for
// each item. Used for grid cards that have no data-item-json of their own.
export function buildFanCollectionCardPreview(card) {
    if (!(card instanceof Element)) {
        return null;
    }

    const kind = getFanCollectionCardKind(card);
    const cacheItem = getFanCollectionCachedItem(card, kind);
    const featured = getFanCollectionFeaturedTrack(card, kind);
    if (!featured) {
        return null;
    }

    const streamUrl = cleanText(
        featured.file && featured.file["mp3-128"],
    );
    if (!streamUrl) {
        return null;
    }

    const releaseUrl =
        normalizeReleaseUrl(getCardPrimaryReleaseUrl(card)) ||
        cleanText(cacheItem && cacheItem.item_url);
    const title =
        cleanText(cacheItem && cacheItem.item_title) ||
        cleanText(featured.title);
    const artist =
        cleanText(cacheItem && cacheItem.band_name) ||
        getArtistMusicReleaseArtist(card);
    const track = createTrackData(
        cleanText(featured.title) || title,
        featured.id,
        streamUrl,
        featured.duration,
        cleanText(featured.track_url || ""),
    );
    if (!track) {
        return null;
    }

    return {
        track,
        data: normalizeReleaseData({
            url: releaseUrl,
            title,
            artist,
            artUrl: getArtistMusicReleaseArtUrl(card),
            tracks: [track],
        }),
    };
}

// Bandcamp removes the release-page link from collection items whose
// release is no longer reachable; the play control and download link stay.
// Treat a missing link as "the page is gone" and skip the fetch entirely.
// The native grid may already expose the same release; if its item has no
// release-page link, the tag card must not send the user to a dead page
// either. This avoids a verification request entirely.
function isNativeCollectionItemUnavailable(release) {
    // Native collection releases already carry the link check from
    // createFanCollectionRelease. Only index-only tag cards need the
    // document lookup; asking once per card made the build quadratic in
    // the size of the native grid.
    if (release && release.sourceItem instanceof Element) {
        return false;
    }

    const id =
        Number(
            release && (release.itemId || release.tralbumId),
        ) || 0;
    if (!id) {
        return false;
    }
    const item = document.querySelector(
        `.collection-item-container[data-itemid="${id}"], .collection-item-container[data-tralbumid="${id}"]`,
    );
    return Boolean(item && !hasNativeReleasePageLink(item));
}

function hasNativeReleasePageLink(item) {
    if (!(item instanceof Element)) {
        return true;
    }

    return Array.from(item.querySelectorAll("a[href]")).some((link) => {
        if (
            link.closest(
                ".redownload-item, .collection-item-actions, .wishlist-msg, .collection-item-fav-track",
            )
        ) {
            return false;
        }
        return Boolean(
            normalizeReleaseUrl(link.getAttribute("href") || ""),
        );
    });
}

function getFanCollectionReleaseArtist(item, playerData) {
    return (
        cleanText(playerData && playerData.artist_name) ||
        getArtistMusicReleaseArtist(item)
    );
}

function buildFanCollectionInitialReleaseData(
    item,
    playerData,
    releaseUrl,
    title,
    artist,
    feedKind,
) {
    const itemId = getArtistMusicReleaseItemId(item);
    const track = createFanCollectionPreviewTrack(playerData, {
        title,
        itemId,
        url: releaseUrl,
    });
    const isCollection = feedKind === "fan-collection";
    const ownCollection = isCollection && isCurrentFanProfileOwner();
    const downloadUrl = isCollection
        ? getFanCollectionDownloadUrl(item) ||
          (ownCollection
              ? getFanCollectionRedownloadUrl(itemId)
              : "")
        : "";
    const supporterCountLabel = getFanCollectionSupporterCountLabel(item);
    const hasNativeSupporterCount = Boolean(supporterCountLabel);
    return normalizeReleaseData({
        url: releaseUrl,
        title,
        artist,
        artUrl: getArtistMusicReleaseArtUrl(item),
        digitalPrice:
            getFanCollectionDigitalPrice(playerData) ||
            (ownCollection ? "you own this" : ""),
        digitalDownloadUrl: downloadUrl,
        digitalOwnershipUrl:
            ownCollection && !downloadUrl
                ? getOwnFanProfileUrl()
                : "",
        isPreorder: Boolean(
            playerData &&
                (playerData.is_preorder === true ||
                    (playerData.album &&
                        playerData.album.is_preorder === true)),
        ),
        tracks: track ? [track] : [],
        supporterCount: getFanCollectionSupporterCount(item, playerData),
        supporterCountIsExact: hasNativeSupporterCount,
        supporterMoreAvailable: false,
        supporterCountLabel,
        supporterCountAuthoritative: hasNativeSupporterCount,
        supporterItemId: itemId,
        supporterItemType: normalizeSupporterItemType(
            item.getAttribute("data-tralbumtype") ||
                item.getAttribute("data-itemtype") ||
                "",
        ),
    });
}

function getFanCollectionDownloadUrl(item) {
    const directLink =
        item && item.querySelector(".redownload-item a[href]");
    const menuLink =
        item &&
        Array.from(
            item.querySelectorAll(".contextual-menu-expanded a[href]"),
        ).find((link) => /^download\b/i.test(cleanText(link.textContent || "")));
    const link = directLink || menuLink;
    return cleanText((link && link.href) || "");
}

function createFanCollectionPreviewTrack(playerData, fallback = {}) {
    if (!playerData || typeof playerData !== "object") {
        playerData = {};
    }

    const cleanFallback =
        fallback && typeof fallback === "object" ? fallback : {};
    const featuredStreamUrl = cleanText(playerData._featuredStreamUrl);
    const featuredTitle = cleanText(playerData._featuredTitle);
    const featuredId = cleanText(playerData._featuredTrackId);
    const trackId = cleanText(
        playerData.id ||
            featuredId ||
            cleanFallback.itemId ||
            "",
    );
    const fallbackTitle = cleanText(
        featuredTitle ||
            playerData.title ||
            cleanFallback.title ||
            "",
    );
    const previewTrack = featuredStreamUrl
        ? null
        : findFeedPreviewTrack(trackId, fallbackTitle);
    const previewStreamUrl = cleanText(
        previewTrack &&
            previewTrack.streaming_url &&
            previewTrack.streaming_url["mp3-128"],
    );

    return createTrackData(
        fallbackTitle ||
            (previewTrack && previewTrack.title) ||
            cleanFallback.title ||
            "",
        trackId,
        extractFanCollectionPlayerStreamUrl(playerData) ||
            featuredStreamUrl ||
            previewStreamUrl ||
            "",
        playerData.duration ||
            playerData._featuredDuration ||
            (previewTrack && previewTrack.duration) ||
            "",
        playerData.url ||
            (previewTrack && previewTrack.track_url) ||
            cleanFallback.url ||
            "",
    );
}

function extractFanCollectionPlayerStreamUrl(playerData) {
    if (!playerData || typeof playerData !== "object") {
        return "";
    }

    const candidates = [
        playerData.stream_url,
        playerData.preview_url,
        playerData.streaming_url &&
            typeof playerData.streaming_url === "object"
            ? playerData.streaming_url["mp3-128"]
            : "",
    ];

    const file = playerData.file;
    if (file && typeof file === "object") {
        candidates.push(
            file["mp3-128"],
            file.mp3_128,
            file.mp3,
            file["mp3"],
            file["mp3-v0"],
            file["flac"],
        );
    }

    for (const candidate of candidates) {
        const streamUrl = cleanText(candidate);
        if (streamUrl) {
            return streamUrl;
        }
    }

    return "";
}

function findFeedPreviewTrack(trackId, title) {
    const byId = trackId
        ? getFeedPreviewTrackMap().get(trackId)
        : null;
    if (byId) {
        return byId;
    }

    const normalizedTitle = cleanText(title).toLowerCase();
    if (!normalizedTitle) {
        return null;
    }

    return (
        getFeedPreviewTracks().find((track) => {
            const trackTitle = cleanText(track && track.title).toLowerCase();
            return (
                trackTitle &&
                (trackTitle === normalizedTitle ||
                    trackTitle.includes(normalizedTitle) ||
                    normalizedTitle.includes(trackTitle))
            );
        }) || null
    );
}

function getFanCollectionDigitalPrice(playerData) {
    const itemPrice = formatFanCollectionPrice(
        playerData && playerData.price,
    );
    const albumPrice = formatFanCollectionPrice(
        playerData && playerData.album && playerData.album.price,
    );
    if (playerData && playerData.is_owned) {
        return "you own this";
    }
    if (playerData && playerData.album && playerData.album.is_owned) {
        return "you own this";
    }
    if (playerData && playerData.is_free_download) {
        return "free download";
    }
    if (playerData && playerData.album && playerData.album.is_free_download) {
        return "free download";
    }
    return itemPrice || albumPrice;
}

function formatFanCollectionPrice(price) {
    if (!price || typeof price !== "object" || price.is_money !== true) {
        return "";
    }

    const amount = Number(price.amount);
    const currency = cleanText(price.currency || "");
    if (!Number.isFinite(amount) || amount <= 0) {
        return "";
    }

    return cleanText(`${currency} ${amount}`);
}

function getFanCollectionSupporterCount(item, playerData = null) {
    const rawCount = getFanCollectionRawSupporterCount(item, playerData);
    if (rawCount > 0) {
        return rawCount;
    }

    const text = getFanCollectionSupporterCountLabel(item);
    const match = text.match(
        /(\d(?:[\d.,'’\s\u00a0\u202f]*\d)?)/,
    );
    if (!match) {
        return 0;
    }

    const digits = match[1].replace(/\D/g, "");
    const count = Number(digits);
    if (!digits || !Number.isSafeInteger(count) || count <= 0) {
        return 0;
    }

    return count;
}

function getFanCollectionRawSupporterCount(item, playerData) {
    const album =
        playerData && typeof playerData.album === "object"
            ? playerData.album
            : null;
    const candidates = [
        playerData && playerData.collectors_count,
        playerData && playerData.collector_count,
        playerData && playerData.supporter_count,
        playerData && playerData.collection_count,
        playerData && playerData.num_collectors,
        album && album.collectors_count,
        album && album.collector_count,
        album && album.supporter_count,
        album && album.collection_count,
        album && album.num_collectors,
        item && item.getAttribute("data-collectors-count"),
        item && item.getAttribute("data-supporter-count"),
    ];

    for (const candidate of candidates) {
        if (
            typeof candidate !== "number" &&
            !/^\d+$/.test(cleanText(candidate))
        ) {
            continue;
        }
        const count = Number(candidate);
        if (Number.isSafeInteger(count) && count > 0) {
            return count;
        }
    }

    return 0;
}

function getFanCollectionSupporterCountLabel(item) {
    return cleanText(
        item.querySelector(".collected-by .collected-by-header")
            ?.textContent || "",
    );
}

function addArtistMusicReleaseCandidate(
    candidates,
    seen,
    item,
    link = null,
    sourceKind = "link",
    candidatesByKey = new Map(),
) {
    if (!(item instanceof Element)) {
        return;
    }

    const releaseLink =
        link ||
        item.querySelector(RELEASE_LINK_SELECTOR) ||
        (item.matches(RELEASE_LINK_SELECTOR) ? item : null);
    const releaseUrl = normalizeReleaseUrl(
        releaseLink && releaseLink.href ? releaseLink.href : "",
    );
    if (!releaseUrl) {
        return;
    }

    const itemId = getArtistMusicReleaseItemId(item);
    const itemType = normalizeReleaseItemType("", releaseUrl);
    const title = getArtistMusicReleaseTitle(item, releaseLink, releaseUrl);
    const artist = getArtistMusicReleaseArtist(item);
    const dedupeKeys = getArtistMusicReleaseDedupeKeys({
        releaseUrl,
        itemId,
        itemType,
        title,
        artist,
    });
    const existingKey = dedupeKeys.find((key) => seen.has(key));
    if (existingKey) {
        mergeArtistMusicReleaseCandidate(
            candidatesByKey.get(existingKey),
            item,
            sourceKind,
        );
        return;
    }

    dedupeKeys.forEach((key) => {
        seen.add(key);
    });
    const candidate = {
        releaseUrl,
        title,
        artist,
        artUrl: getArtistMusicReleaseArtUrl(item),
        itemId,
        itemType,
        bandId: getArtistMusicReleaseBandId(item),
        sourceItem: item,
        gridItem: sourceKind === "grid" ? item : null,
        featuredItem: sourceKind === "featured" ? item : null,
    };
    dedupeKeys.forEach((key) => {
        candidatesByKey.set(key, candidate);
    });
    candidates.push(candidate);
}

function mergeArtistMusicReleaseCandidate(candidate, item, sourceKind) {
    if (!candidate || !(item instanceof Element)) {
        return;
    }

    if (sourceKind === "grid") {
        candidate.gridItem = candidate.gridItem || item;
        candidate.itemId =
            candidate.itemId || getArtistMusicReleaseItemId(item);
        candidate.bandId =
            candidate.bandId || getArtistMusicReleaseBandId(item);
        return;
    }

    if (sourceKind === "featured") {
        candidate.featuredItem = candidate.featuredItem || item;
        if (!candidate.artUrl) {
            candidate.artUrl = getArtistMusicReleaseArtUrl(item);
        }
    }
}

function getArtistMusicReleaseDedupeKeys(release) {
    const keys = [`url:${release.releaseUrl}`];
    if (release.itemId && release.itemType) {
        keys.push(`item:${release.itemType}:${release.itemId}`);
    }

    try {
        const url = new URL(release.releaseUrl, window.location.href);
        const path = url.pathname.replace(/\/$/, "").toLowerCase();
        const title = cleanText(release.title).toLowerCase();
        const artist = cleanText(release.artist).toLowerCase();
        if (path && title) {
            keys.push(`path-title:${path}:${title}:${artist}`);
        }
    } catch (_error) {
        // Ignore malformed URLs; normalizeReleaseUrl already rejected most of them.
    }

    return keys;
}

// A card can start life as a tag-only match and later be reconciled with
// the native search result for the same purchase; the marker must follow
// the current source instead of sticking around.
function applyTagSearchCardMarkers(card, release) {
    if (!(card instanceof Element)) {
        return;
    }

    if (release && release.tagSearch) {
        card.classList.add("bcampx-label-feed-card--tag-match");
        card.setAttribute("data-bcampx-tag-source", "tags");
        card.setAttribute(
            "data-bcampx-tag-origin",
            release.tagOrigin === "native" ? "native" : "index",
        );
        return;
    }

    card.classList.remove("bcampx-label-feed-card--tag-match");
    card.removeAttribute("data-bcampx-tag-source");
    card.removeAttribute("data-bcampx-tag-origin");
}

function createArtistMusicFeedCard(release) {
    const card = document.createElement("article");
    card.className = "feed-item story bcampx-label-feed-card";
    if (release.ownFanCollection && release.itemType === "track") {
        card.classList.add("bcampx-label-feed-card--own-track");
    }
    card.__bcampxArtistMusicRelease = release;
    card.__bcampxGridItem =
        release.gridItem instanceof Element ? release.gridItem : null;
    card.setAttribute("data-bcampx-release-url", release.releaseUrl);
    applyTagSearchCardMarkers(card, release);
    if (release.bandId) {
        card.setAttribute("data-bcampx-band-id", release.bandId);
    }

    const itemJson = {
        item_id: release.itemId || undefined,
        item_type: release.itemType || undefined,
        item_url: release.releaseUrl,
        item_title: release.title || undefined,
        featured_track:
            release.playerData && release.playerData.id
                ? release.playerData.id
                : undefined,
        featured_track_title:
            release.playerData && release.playerData.title
                ? release.playerData.title
                : undefined,
        featured_track_duration:
            release.playerData && release.playerData.duration
                ? release.playerData.duration
                : undefined,
        featured_track_url:
            release.playerData && release.playerData.url
                ? release.playerData.url
                : undefined,
    };

    const headline = document.createElement("div");
    headline.className = "story-title bcampx-label-feed-card__story-title";

    const artistLink = document.createElement("a");
    artistLink.className = "fan-name artist-name";
    artistLink.href = getArtistMusicPageUrl();
    artistLink.textContent = getArtistMusicBandName();

    const verb = document.createTextNode(" released ");
    const titleLink = createReleaseLink(release, "item-link");

    headline.append(artistLink, verb, titleLink);

    const innards = document.createElement("div");
    innards.className = "story-innards";

    const body = document.createElement("div");
    body.className = "story-body";
    body.setAttribute("data-item-json", JSON.stringify(itemJson));
    if (release.playerData) {
        body.setAttribute("data-playerdata", JSON.stringify(release.playerData));
    }

    const wrapper = document.createElement("div");
    wrapper.className = "tralbum-wrapper";

    const art = document.createElement("div");
    art.className = "art";
    const artLink = document.createElement("a");
    artLink.href = release.releaseUrl;
    if (release.artUrl) {
        const image = document.createElement("img");
        // A collection/artist feed can hold thousands of cards; eager
        // artwork requests and decodes are the largest avoidable network
        // cost on a long page.
        image.loading = "lazy";
        image.decoding = "async";
        image.setAttribute("fetchpriority", "low");
        image.src = release.artUrl;
        image.alt = release.title ? `${release.title} art` : "";
        artLink.appendChild(image);
    }
    art.appendChild(artLink);

    const content = document.createElement("div");
    content.className = "tralbum-wrapper-col1";
    content.appendChild(createReleaseLink(release, "item-link"));

    const byline = document.createElement("div");
    byline.className = "itemsubtext";
    byline.textContent = `by ${release.artist || getArtistMusicBandName()}`;
    content.appendChild(byline);


    const action = document.createElement("button");
    action.type = "button";
    action.className = "buy-link bcampx-label-feed-card__buy-button";
    action.textContent = "hear more";
    // An index card for a collection item stands for an owned release even
    // before any release data arrives (hidden pages never provide any).
    if (
        release.tagOrigin === "index" &&
        release.feedKind === "fan-collection"
    ) {
        const fanProfileUrl = getOwnFanProfileUrl();
        action.textContent = "you own this";
        action.title = "Find this release in your collection";
        action.classList.add(
            "bcampx-label-feed-card__buy-button--owned",
        );
        action.setAttribute("data-bcampx-digital-price", "you own this");
        if (fanProfileUrl) {
            action.setAttribute(
                "data-bcampx-digital-ownership-url",
                fanProfileUrl,
            );
        }
    }
    action.setAttribute("data-bcampx-release-action", "buy");
    action.setAttribute("data-bcampx-release-url", release.releaseUrl || "");
    action.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const downloadUrl = cleanText(
            action.getAttribute("data-bcampx-digital-download-url") || "",
        );
        if (downloadUrl) {
            window.location.assign(downloadUrl);
            return;
        }
        const actionText = cleanText(action.textContent || "");
        if (/^hear more$/i.test(actionText)) {
            const releaseUrl = action.getAttribute("data-bcampx-release-url") || "";
            if (releaseUrl) {
                window.open(releaseUrl, "_blank", "noopener,noreferrer");
            }
            return;
        }
        const ownershipUrl = cleanText(
            action.getAttribute("data-bcampx-digital-ownership-url") || "",
        );
        if (ownershipUrl) {
            void navigateToOwnedReleaseCollection(
                action.getAttribute("data-bcampx-release-title") ||
                    release.title ||
                    "",
                ownershipUrl,
                release.releaseUrl,
            );
            return;
        }
        openTrackBuyWindow(release.releaseUrl);
    });
    content.appendChild(action);

    const supporterCount = document.createElement("div");
    supporterCount.className = "bcampx-label-feed-card__supporter-count";
    supporterCount.hidden = true;
    const supporterCountText = document.createElement("span");
    supporterCountText.className =
        "bcampx-label-feed-card__supporter-count-text";
    const supporterCountRefresh = document.createElement("button");
    supporterCountRefresh.type = "button";
    supporterCountRefresh.className =
        "bcampx-label-feed-card__supporter-refresh";
    supporterCountRefresh.textContent = "refresh";
    supporterCountRefresh.title = "Refresh exact collection count";
    supporterCountRefresh.hidden = true;
    supporterCountRefresh.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void refreshArtistMusicCardSupporterCount(card);
    });
    supporterCount.append(supporterCountText, supporterCountRefresh);
    content.appendChild(supporterCount);

    const supportedSlot = document.createElement("div");
    supportedSlot.className = "tralbum-wrapper-col2 tralbum-owners";

    const supportedLabel = document.createElement("div");
    supportedLabel.className = "bcampx-label-feed-card__supported-placeholder";
    supportedLabel.textContent = "supported by";
    supportedSlot.appendChild(supportedLabel);


    wrapper.append(art, content, supportedSlot);
    body.appendChild(wrapper);

    innards.appendChild(body);
    card.append(headline, innards);
    if (release.initialData) {
        updateArtistMusicCardBuyAction(card, release.initialData);
    }
    if (
        release.pageUnavailable ||
        isNativeCollectionItemUnavailable(release)
    ) {
        release.pageUnavailable = true;
        markReleasePageUnavailable(card, release.releaseUrl);
    }
    // A rebuilt feed must not resurrect links into a release page we have
    // already seen fail.
    const normalizedReleaseUrl = normalizeReleaseUrl(release.releaseUrl);
    if (
        normalizedReleaseUrl &&
        STATE.unavailableReleaseUrls.has(normalizedReleaseUrl)
    ) {
        markReleasePageUnavailable(card, release.releaseUrl);
    }

    return card;
}

function createReleaseLink(release, className) {
    const link = document.createElement("a");
    link.href = release.releaseUrl;
    if (className) {
        link.className = className;
    }
    link.textContent = release.title || release.releaseUrl;
    return link;
}

const ownedLinkHrefs = new Set();

function hasNativeOwnedLink(releaseUrl) {
    if (!releaseUrl) {
        return false;
    }

    // The mutation observer marks this dirty only when an owned-link node
    // or one of its ancestors changes. Rebuilding the set on every
    // memoVersion (i.e. every scroll batch) scanned the whole document.
    if (STATE.ownedLinkCacheDirty) {
        ownedLinkHrefs.clear();
        STATE.ownedLinkCacheDirty = false;
        document
            .querySelectorAll("a.you-own-this-link[href]")
            .forEach((link) => {
                const raw = link.getAttribute("href") || "";
                if (raw) {
                    ownedLinkHrefs.add(raw);
                    const resolvedRaw = normalizeReleaseUrl(raw);
                    if (resolvedRaw) {
                        ownedLinkHrefs.add(resolvedRaw);
                    }
                }
                const normalized = normalizeReleaseUrl(link.href);
                if (normalized) {
                    ownedLinkHrefs.add(normalized);
                }
            });
    }

    return (
        ownedLinkHrefs.has(releaseUrl) ||
        ownedLinkHrefs.has(normalizeReleaseUrl(releaseUrl))
    );
}

export function updateArtistMusicCardBuyAction(card, data) {
    if (!card || !data) {
        return;
    }

    applyArtistMusicNativeCardData(card, data);
    updateArtistMusicCardSupporterCount(card, data);
    scheduleArtistMusicCardExactSupporterCount(card, data);
    updateArtistMusicCardTags(card, data);

    const action = card.querySelector("[data-bcampx-release-action='buy']");
    if (!action) {
        return;
    }

    const releaseUrl = card.getAttribute(
        "data-bcampx-release-url",
    );
    if (
        releaseUrl &&
        !isOwnedDigitalPrice(data.digitalPrice) &&
        hasNativeOwnedLink(releaseUrl)
    ) {
        data.digitalPrice = "you own this";
    }

    // A tag-search card built from the index stands for a collection item
    // that is not currently in the grid. It is by definition owned, but the
    // index has no price or download URL; without this it fell through to
    // the "hear more" fallback, which opened the (sometimes dead) release
    // page. Mark it owned and point the action at the fan's collection so
    // the existing owned-release search can find it.
    const release = card.__bcampxArtistMusicRelease;
    if (
        release &&
        release.tagOrigin === "index" &&
        release.feedKind === "fan-collection" &&
        !isOwnedDigitalPrice(data.digitalPrice)
    ) {
        data.digitalPrice = "you own this";
        if (!cleanText(data.digitalOwnershipUrl)) {
            const fanProfileUrl = getOwnFanProfileUrl();
            if (fanProfileUrl) {
                data.digitalOwnershipUrl = fanProfileUrl;
            }
        }
    }

    const isOwned = isOwnedDigitalPrice(data.digitalPrice);
    const ownershipUrl = cleanText(data.digitalOwnershipUrl || "");
    const downloadUrl = cleanText(data.digitalDownloadUrl || "");
    action.textContent = downloadUrl
        ? "download"
        : getDigitalBuyActionLabel(data.digitalPrice, data.isPreorder);
    action.disabled = !downloadUrl && isOwned && !ownershipUrl;
    action.classList.toggle("bcampx-label-feed-card__buy-button--owned", isOwned);
    action.title = downloadUrl
        ? "Download this release"
        : isOwned
        ? ownershipUrl
            ? "Find this release in your collection"
            : "This release is already in your collection"
        : "";
    setAttr(action, "data-bcampx-release-title", data.title);
    setAttr(action, "data-bcampx-digital-ownership-url", ownershipUrl);
    setAttr(action, "data-bcampx-digital-download-url", downloadUrl);
    setAttr(action, "data-bcampx-digital-price", data.digitalPrice);
}

function setAttr(element, attribute, value) {
    if (value) {
        element.setAttribute(attribute, value);
    } else {
        element.removeAttribute(attribute);
    }
}

function applyArtistMusicNativeCardData(card, data) {
    const release = card && card.__bcampxArtistMusicRelease;
    const nativeData = release && release.initialData;
    if (!nativeData || !data) {
        return;
    }

    const downloadUrl = cleanText(nativeData.digitalDownloadUrl || "");
    if (downloadUrl) {
        data.digitalDownloadUrl = downloadUrl;
        data.digitalPrice = "you own this";
    }

    if (nativeData.supporterCountAuthoritative === true) {
        data.supporterCount = nativeData.supporterCount;
        data.supporterCountIsExact = true;
        data.supporterMoreAvailable = false;
        data.supporterNextToken = "";
        data.supporterCountLabel = cleanText(
            nativeData.supporterCountLabel || "",
        );
        data.supporterCountAuthoritative = true;
    }
}

function updateArtistMusicCardTags(card, data) {
    let tagsContainer =
        card && card.querySelector(".bcampx-label-feed-card__tags");
    if (!tagsContainer) {
        const wrapper =
            card && card.querySelector(".tralbum-wrapper");
        if (!wrapper) {
            return;
        }
        tagsContainer = document.createElement("div");
        tagsContainer.className = "bcampx-label-feed-card__tags";
        tagsContainer.hidden = true;
        wrapper.appendChild(tagsContainer);
    }

    const tags = (Array.isArray(data && data.tags)
        ? data.tags.map((tag) => cleanText(tag)).filter(Boolean)
        : []).slice(0, 5);
    const dateLocation = compactJoin(
        [formatReleaseDate(data && data.releaseDate), data && data.location],
        " \u00b7 ",
    );
    const signature = `${tags.join("\u001f")}\u001e${dateLocation}`;
    if (
        tagsContainer.getAttribute("data-bcampx-tags-signature") ===
        signature
    ) {
        // A feed sync refreshes every card; rebuilding identical spans
        // churns the DOM and the mutation observer for nothing.
        tagsContainer.hidden = !tags.length && !dateLocation;
        return;
    }
    tagsContainer.setAttribute(
        "data-bcampx-tags-signature",
        signature,
    );
    if (!tags.length && !dateLocation) {
        tagsContainer.hidden = true;
        tagsContainer.replaceChildren();
        return;
    }

    tagsContainer.hidden = false;
    tagsContainer.replaceChildren();

    if (tags.length) {
        const leftSide = document.createElement("span");
        leftSide.className = "bcampx-label-feed-card__tags-text";
        leftSide.appendChild(document.createTextNode("tags: "));
        tags.forEach(function(tag, index) {
            if (index > 0) {
                leftSide.appendChild(document.createTextNode(", "));
            }
            var link = document.createElement("a");
            link.href = "/tag/" + encodeURIComponent(tag);
            link.textContent = tag;
            leftSide.appendChild(link);
        });
        tagsContainer.appendChild(leftSide);
    }

    if (dateLocation) {
        var rightSide = document.createElement("span");
        rightSide.className = "bcampx-label-feed-card__date";
        rightSide.textContent = dateLocation;
        tagsContainer.appendChild(rightSide);
    }
}

function updateArtistMusicCardSupporterCount(card, data) {
    const node =
        card &&
        card.querySelector(".bcampx-label-feed-card__supporter-count");
    if (!node || !data) {
        return;
    }

    if (!CONFIG.showCollectionCounts) {
        hideArtistMusicCardSupporterCount(node);
        return;
    }

    const count = Number(data.supporterCount || 0);
    if (!Number.isFinite(count) || count <= 0) {
        hideArtistMusicCardSupporterCount(node);
        return;
    }

    const countText =
        node.querySelector(".bcampx-label-feed-card__supporter-count-text") ||
        node;
    const refreshButton = node.querySelector(
        ".bcampx-label-feed-card__supporter-refresh",
    );
    const showRefresh =
        data.supporterCountIsExact !== true &&
        data.supporterMoreAvailable === true;
    const refreshPending = card.hasAttribute(
        "data-bcampx-supporter-count-pending",
    );

    node.hidden = false;
    countText.textContent =
        cleanText(data.supporterCountLabel || "") ||
        formatArtistMusicSupporterCount(
            count,
            data.supporterCountIsExact === true,
        );
    if (refreshButton) {
        refreshButton.hidden = !showRefresh;
        refreshButton.textContent = showRefresh
            ? refreshPending
                ? "..."
                : "refresh"
            : "";
        refreshButton.disabled = refreshPending;
    }
    node.setAttribute("data-bcampx-supporter-count", String(Math.floor(count)));
    node.setAttribute(
        "data-bcampx-supporter-count-exact",
        data.supporterCountIsExact === true ? "true" : "false",
    );
}

const SUPPORTER_COUNT_AUTO_RETRY_MS = 30 * 1000;

function scheduleArtistMusicCardExactSupporterCount(card, data) {
    if (
        !CONFIG.showCollectionCounts ||
        !card ||
        !data ||
        data.supporterCountAuthoritative === true ||
        data.supporterCountIsExact === true ||
        !data.supporterMoreAvailable ||
        card.hasAttribute("data-bcampx-supporter-count-pending") ||
        hasRecentSupporterCountAutoAttempt(card)
    ) {
        return;
    }

    card.setAttribute(
        "data-bcampx-supporter-count-auto-attempted",
        String(Date.now()),
    );
    void fetchArtistMusicSupporterCount(
        card,
        data,
        getExactReleaseSupporterCount(data),
    );
}

function hasRecentSupporterCountAutoAttempt(card) {
    const raw = cleanText(
        card.getAttribute("data-bcampx-supporter-count-auto-attempted"),
    );
    if (!raw) {
        return false;
    }

    const attemptAt = Number(raw);
    if (!Number.isFinite(attemptAt) || attemptAt <= 0) {
        return true;
    }

    return Date.now() - attemptAt < SUPPORTER_COUNT_AUTO_RETRY_MS;
}

function refreshArtistMusicCardSupporterCount(card) {
    if (
        !CONFIG.showCollectionCounts ||
        !card ||
        card.hasAttribute("data-bcampx-supporter-count-pending")
    ) {
        return Promise.resolve(null);
    }

    const controller = getCardController(card);
    const data = controller && controller.data;
    if (
        !data ||
        data.supporterCountAuthoritative === true ||
        data.supporterCountIsExact === true ||
        data.supporterMoreAvailable !== true
    ) {
        return Promise.resolve(null);
    }

    return fetchArtistMusicSupporterCount(
        card,
        data,
        getExactReleaseSupporterCount(data, {
            forceRefresh: true,
            ignoreLimit: true,
        }),
    );
}

function fetchArtistMusicSupporterCount(card, data, fetchPromise) {
    card.setAttribute("data-bcampx-supporter-count-pending", "true");
    updateArtistMusicCardSupporterRefreshPending(card, true);
    return fetchPromise
        .then((result) => {
            if (!result || !result.count) {
                return result;
            }

            applyArtistMusicSupporterCountResult(card, data, result);
            if (card.isConnected) {
                updateArtistMusicCardSupporterCount(card, data);
            }
            return result;
        })
        .catch(() => null)
        .finally(() => {
            card.removeAttribute("data-bcampx-supporter-count-pending");
            if (card.isConnected) {
                updateArtistMusicCardSupporterCount(card, data);
            }
        });
}

function applyArtistMusicSupporterCountResult(card, data, result) {
    const supporterData = {
        supporterCount: result.count,
        supporterCountIsExact: result.isExact === true,
        supporterMoreAvailable: result.moreAvailable === true,
        supporterNextToken: cleanText(result.nextToken || ""),
    };
    Object.assign(data, supporterData);

    const controller = getCardController(card);
    if (controller && controller.data) {
        Object.assign(controller.data, supporterData);
    }
}

function updateArtistMusicCardSupporterRefreshPending(card, pending) {
    const button =
        card &&
        card.querySelector(".bcampx-label-feed-card__supporter-refresh");
    if (!button) {
        return;
    }

    button.disabled = !!pending;
    if (button.hidden && !pending) {
        button.textContent = "";
        return;
    }
    button.textContent = pending ? "..." : "refresh";
}

function formatArtistMusicSupporterCount(count, isExact) {
    const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
    const maxExactCount = Math.max(
        0,
        Math.floor(Number(CONFIG.maxSupporterExactCount) || 0),
    );
    const displayCount =
        !isExact && maxExactCount > 0
            ? Math.min(normalizedCount, maxExactCount)
            : normalizedCount;
    const suffix = displayCount === 1 ? "collection" : "collections";
    const marker =
        !isExact && normalizedCount >= displayCount ? "+" : "";
    return `appears in ${displayCount}${marker} ${suffix}`;
}

function hideArtistMusicCardSupporterCount(node) {
    node.hidden = true;
    const countText =
        node.querySelector(".bcampx-label-feed-card__supporter-count-text") ||
        node;
    const refreshButton = node.querySelector(
        ".bcampx-label-feed-card__supporter-refresh",
    );
    countText.textContent = "";
    if (refreshButton) {
        refreshButton.hidden = true;
        refreshButton.disabled = false;
        refreshButton.textContent = "";
    }
    node.removeAttribute("data-bcampx-supporter-count");
    node.removeAttribute("data-bcampx-supporter-count-exact");
}

export function refreshArtistMusicCollectionCounts() {
    if (!STATE.artistMusicFeedNode) {
        return;
    }

    Array.from(
        STATE.artistMusicFeedNode.querySelectorAll(".bcampx-label-feed-card"),
    ).forEach((card) => {
        const controller = getCardController(card);
        const data = controller && controller.data;
        if (!data) {
            const node = card.querySelector(
                ".bcampx-label-feed-card__supporter-count",
            );
            if (node && !CONFIG.showCollectionCounts) {
                hideArtistMusicCardSupporterCount(node);
            }
            return;
        }

        updateArtistMusicCardSupporterCount(card, data);
        scheduleArtistMusicCardExactSupporterCount(card, data);
    });
}


function getCompactDigitalPrice(priceText) {
    const text = cleanText(priceText || "");
    if (!text) {
        return "";
    }

    const symbolicPrice = text.match(/(?:^|\s)([$€£¥]\s*\d+(?:[.,]\d+)?)/);
    if (symbolicPrice) {
        return symbolicPrice[1].replace(/\s+/g, "");
    }

    const codedPrice = text.match(
        /\b(?:USD|AUD|CAD|EUR|GBP|JPY|CNY|RMB|HKD|NZD)\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:USD|AUD|CAD|EUR|GBP|JPY|CNY|RMB|HKD|NZD)\b/i,
    );
    if (codedPrice) {
        return cleanText(codedPrice[0]);
    }

    return text.replace(/\s+or more$/i, "");
}

   export function getDigitalBuyActionLabel(priceText, isPreorder = false) {
   const compactPrice = getCompactDigitalPrice(priceText);
   if (isOwnedDigitalPrice(compactPrice)) {
       return "you own this";
    }
   if (/^free download$/i.test(compactPrice)) {
       return "free download";
    }

    if (isPreorder) {
        return compactPrice ? `pre-order (${compactPrice})` : "pre-order";
    }

    return compactPrice ? `buy now (${compactPrice})` : "hear more";
   }

export function isOwnedDigitalPrice(priceText) {
    return /^you own this$/i.test(cleanText(priceText || ""));
}

function getArtistMusicReleaseTitle(item, link, releaseUrl) {
    const titleNode =
        item.querySelector(".title, .item-title, .collection-item-title") ||
        null;
    const title = titleNode
        ? extractArtistMusicTitleText(titleNode)
        : normalizedText(link || item);
    if (title) {
        return title;
    }

    try {
        return cleanText(
            decodeURIComponent(
                new URL(releaseUrl, window.location.href)
                    .pathname.split("/")
                    .filter(Boolean)
                    .pop() || "",
            ).replace(/[-_]+/g, " "),
        );
    } catch (_error) {
        return "Bandcamp release";
    }
}

function extractArtistMusicTitleText(titleNode) {
    const clone = titleNode.cloneNode(true);
    clone
        .querySelectorAll(
            [
                ".artist-override",
                ".artist",
                ".item-artist",
                ".collection-item-artist",
                ".collection-item-gift-given-title",
            ].join(", "),
        )
        .forEach((node) => node.remove());
    return normalizedText(clone);
}

function getArtistMusicReleaseArtist(item) {
    const artistOverride = item.querySelector(".artist-override");
    const artistNode = item.querySelector(
        ".artist, .item-artist, .collection-item-artist",
    );
    return (
        cleanText(
            (artistOverride ? normalizedText(artistOverride) : "") ||
                (artistNode ? normalizedText(artistNode) : ""),
        ).replace(/^by\s+/i, "") ||
        getArtistMusicBandName()
    );
}

function getArtistMusicReleaseArtUrl(item) {
    const image = item.querySelector("img");
    if (!image) {
        return "";
    }

    return (
        image.getAttribute("data-original") ||
        image.currentSrc ||
        image.getAttribute("src") ||
        ""
    );
}

function getArtistMusicReleaseItemId(item) {
    const direct = firstPositiveNumber(
        item.getAttribute("data-tralbumid"),
        item.getAttribute("data-itemid"),
        item.getAttribute("data-trackid"),
    );
    if (direct) {
        return direct;
    }

    const raw = cleanText(item.getAttribute("data-item-id") || "");
    const match = raw.match(/(?:album|track)-(\d+)/i);
    return match && match[1] ? Number(match[1]) : 0;
}

function getArtistMusicReleaseBandId(item) {
    if (!(item instanceof Element)) {
        return "";
    }

    return cleanText(
        item.getAttribute("data-band-id") ||
            item.getAttribute("data-band") ||
            item.getAttribute("data-bandid") ||
            "",
    );
}

// Bandcamp puts the band identity in one script tag, but both the card
// artist link and the byline asked for it once per card. Parse it once per
// page instead of twice per card.
function getArtistMusicBandCache() {
    if (STATE.artistMusicBandCache) {
        return STATE.artistMusicBandCache;
    }

    const bandData = parseJsonAttribute(
        document.querySelector("script[data-band]"),
        "data-band",
    );
    STATE.artistMusicBandCache = {
        data: bandData,
        name:
            cleanText(bandData && bandData.name) ||
            metaContent(document, 'meta[property="og:site_name"]') ||
            metaContent(document, 'meta[property="og:title"]') ||
            cleanTitle(document.title) ||
            "This artist",
        url:
            cleanText(
                (bandData && (bandData.https_url || bandData.url)) || "",
            ) || window.location.origin,
    };
    return STATE.artistMusicBandCache;
}

function getArtistMusicBandName() {
    return getArtistMusicBandCache().name;
}

function getArtistMusicPageUrl() {
    return getArtistMusicBandCache().url;
}

export function getItemJsonReleaseUrl(node) {
    const parsed = getParsedItemJson(node);
    return normalizeReleaseUrl(parsed && parsed.item_url ? parsed.item_url : "");
}

export function preferBandcampReleaseUrl(urls) {
    return (urls || []).find((url) => isBandcampReleaseUrl(url)) || "";
}

export function extractParsedItemId(parsed) {
    if (!parsed || typeof parsed !== "object") {
        return 0;
    }

    return firstPositiveNumber(
        parsed.item_id,
        parsed.album_id,
        parsed.track_id,
        parsed.tralbum_id,
        parsed.collect_item_id,
    );
}

export function firstPositiveNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
            return number;
        }
    }

    return 0;
}

export function normalizeReleaseItemType(rawType, releaseUrl = "") {
    const type = cleanText(rawType).toLowerCase();
    if (type === "album" || type === "a") {
        return "album";
    }
    if (type === "track" || type === "t") {
        return "track";
    }

    const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
    if (/\/album\//.test(normalizedReleaseUrl)) {
        return "album";
    }
    if (/\/track\//.test(normalizedReleaseUrl)) {
        return "track";
    }

    return "";
}
