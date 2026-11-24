import {
    ensureCardController,
    isArtistMusicPage,
    isBcampxInternalMutationNode,
    queueAutoFetch,
    resumeMutationObserver,
    scheduleScan,
    suspendMutationObserver,
    updateAutoFetchDebugState,
} from "../bcamplifier.core.js";
import {
    getCardPrimaryReleaseUrl,
} from "../utils/card-dom.js";
import {
    getExactReleaseSupporterCount,
    normalizeSupporterItemType,
} from "../data/release-data.js";
import {
    collectFanTagSearchExtraReleases,
    setupFanTagSearch,
    updateFanTagSearchMoreControl,
} from "../data/tag-index.js";
import { syncTrackButtonsForCard } from "./card-merge.js";
import {
    addArtistMusicReleaseCandidate,
    addFanCollectionReleaseCandidate,
    buildFanCollectionCardPreview,
    buildFanTagSearchNativeRelease,
    collectFanCollectionReleaseCandidates,
    extractParsedItemId,
    getArtistMusicBandName,
    getArtistMusicPageUrl,
    getFanCollectionCachedItem,
    getFanCollectionCardKind,
    getFanCollectionSearchItem,
    getItemJsonReleaseUrl,
    getOwnFanProfileUrl,
    isCurrentFanProfileOwner,
    isNativeCollectionItemUnavailable,
    isOwnFanTrackCard,
    preferBandcampReleaseUrl,
    setupFanCollectionSearchPrefetch,
} from "./fan-collection-data.js";
import { markReleasePageUnavailable, navigateToOwnedReleaseCollection } from "./release-page.js";
import { openTrackBuyWindow } from "./track-actions.js";
import {
    ARTIST_MUSIC_VIEW_KEY,
    CONFIG,
    OBSERVED_ATTR,
    STATE,
    SVG_NS,
} from "../state.js";
import { incrementDebugCounter, markDebugState } from "../utils/dom.js";
import {
    findFanCollectionActiveGrid,
    getCardController,
    isCurrentFanCollectionPage,
    isFanCollectionPage,
    isFanWishlistPage,
} from "../utils/page.js";
import { storageGet, storageSet } from "../utils/storage.js";
import {
    cleanText,
    compactJoin,
    formatReleaseDate,
    normalizedText,
} from "../utils/text-format.js";
import {
    isBandcampFanCollectionPageUrl,
    isBandcampFanProfileUrl,
    normalizeReleaseUrl,
} from "../utils/url.js";

const feedState = {
    artistMusicFeedBuilding: false,
    artistMusicFeedView: "feed",
    artistMusicToggleNode: null,
    artistMusicFeaturedNodes: [],
    artistMusicFeedSyncTimer: 0,
    artistMusicVisibleFetchTimer: 0,
    artistMusicVisibleCardsPending: null,
    artistMusicVisibleFetchAll: false,
    artistMusicSourceGridObserver: null,
    artistMusicDirtyItems: null,
    artistMusicFanTabObserver: null,
    artistMusicFanTabSyncTimer: 0,
    artistMusicFanCardsByGrid: new WeakMap(),
    artistMusicFanDirtyGrids: new WeakSet(),
    artistMusicLoadMoreScrollPending: false,
};

export {
    buildFanCollectionCardPreview,
    buildFanTagSearchNativeRelease,
    extractParsedItemId,
    getFanCollectionCachedItem,
    getFanCollectionCardKind,
    getFanCollectionSearchItem,
    getItemJsonReleaseUrl,
    isCurrentFanProfileOwner,
    isOwnFanTrackCard,
    preferBandcampReleaseUrl,
    setupFanCollectionSearchPrefetch,
};

export async function buildArtistMusicFeed() {
    if (STATE.artistMusicFeedBuilt || feedState.artistMusicFeedBuilding) {
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

    feedState.artistMusicFeedBuilding = true;
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
        feedState.artistMusicFeedView =
            storedView === "original" ? "original" : "feed";
        STATE.artistMusicFeedNode = feed;
        STATE.artistMusicSourceGridNode = sourceGrid;
        feedState.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();
        if (/^fan-/.test(feedContext.kind)) {
            feedState.artistMusicFanDirtyGrids.delete(sourceGrid);
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
        applyArtistMusicFeedView(feedState.artistMusicFeedView);
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
        feedState.artistMusicFeedBuilding = false;
    }
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
        feedState.artistMusicFanTabObserver &&
        feedState.artistMusicFanTabObserver.__bcampxRoot === observerRoot &&
        observerRoot.isConnected
    ) {
        return;
    }
    if (feedState.artistMusicFanTabObserver) {
        feedState.artistMusicFanTabObserver.disconnect();
    }

    feedState.artistMusicFanTabObserver = new MutationObserver((mutations) => {
        if (mutations.some(hasFanCollectionContextMutation)) {
            scheduleFanCollectionFeedContextSync();
        }
    });
    feedState.artistMusicFanTabObserver.__bcampxRoot = observerRoot;
    feedState.artistMusicFanTabObserver.observe(observerRoot, {
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
    if (!STATE.initialized || feedState.artistMusicFanTabSyncTimer) {
        return;
    }

    feedState.artistMusicFanTabSyncTimer = 1;
    const run = () => {
        feedState.artistMusicFanTabSyncTimer = 0;
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
        feedState.artistMusicFeedBuilding
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
    if (feedState.artistMusicToggleNode) {
        feedState.artistMusicToggleNode.hidden = false;
    }
    applyArtistMusicFeedView(feedState.artistMusicFeedView, {
        skipFeedWork: restoredCards || !sourceGridChanged,
    });

    if (
        (!sourceGridChanged ||
            feedState.artistMusicFanDirtyGrids.has(context.sourceGrid)) &&
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

    feedState.artistMusicFanCardsByGrid.set(
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

    const cards = feedState.artistMusicFanCardsByGrid.get(sourceGrid);
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
        feedState.artistMusicFanDirtyGrids.add(sourceGrid);
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
    if (feedState.artistMusicSourceGridObserver) {
        feedState.artistMusicSourceGridObserver.disconnect();
    }
    if (feedState.artistMusicFeedSyncTimer) {
        window.clearTimeout(feedState.artistMusicFeedSyncTimer);
        feedState.artistMusicFeedSyncTimer = 0;
    }
    if (feedState.artistMusicVisibleFetchTimer) {
        window.clearTimeout(feedState.artistMusicVisibleFetchTimer);
        feedState.artistMusicVisibleFetchTimer = 0;
    }
    feedState.artistMusicVisibleCardsPending = null;
    feedState.artistMusicVisibleFetchAll = false;

    feed.hidden = true;
    feed.setAttribute("data-bcampx-context-suspended", "true");
    if (feedState.artistMusicToggleNode) {
        feedState.artistMusicToggleNode.hidden = true;
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
        feedState.artistMusicFanDirtyGrids.delete(context.sourceGrid);
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
    if (feedState.artistMusicFeedView === "feed") {
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

    if (feedState.artistMusicSourceGridObserver) {
        feedState.artistMusicSourceGridObserver.disconnect();
    }

    feedState.artistMusicSourceGridObserver = new MutationObserver((mutations) => {
        // Batchcamp inserts one checkbox per item into this grid; treating
        // those as release changes would re-sync the feed on every batch.
        const pageMutations = mutations.filter(isPageContentGridMutation);
        if (!pageMutations.length) {
            return;
        }
        if (!feedState.artistMusicDirtyItems) {
            feedState.artistMusicDirtyItems = new Set();
        }
        pageMutations.forEach((mutation) => {
            markArtistMusicItemMutation(
                mutation,
                feedState.artistMusicDirtyItems,
            );
        });
        feedState.artistMusicFanDirtyGrids.add(sourceGrid);
        scheduleArtistMusicFeedSync();
    });
    feedState.artistMusicSourceGridObserver.observe(sourceGrid, {
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
    if (feedState.artistMusicFeedView === "feed" && appendedCards.length) {
        scheduleArtistMusicFeedVisibleFetch(
            STATE.artistMusicFeedNode,
            STATE.observer ? appendedCards : null,
        );
    }
    if (feedState.artistMusicLoadMoreScrollPending) {
        if (appendedCards.length) {
            feedState.artistMusicLoadMoreScrollPending = false;
            window.clearTimeout(artistMusicLoadMoreScrollTimer);
            scrollToNewArtistMusicFeedCards(appendedCards);
        }
    }
    if (sourceGrid instanceof Element) {
        feedState.artistMusicFanDirtyGrids.delete(sourceGrid);
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

    if (feedState.artistMusicFeedSyncTimer) {
        window.clearTimeout(feedState.artistMusicFeedSyncTimer);
    }

    feedState.artistMusicFeedSyncTimer = window.setTimeout(
        () => {
            feedState.artistMusicFeedSyncTimer = 0;
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
        feedState.artistMusicDirtyItems && feedState.artistMusicDirtyItems.size
            ? feedState.artistMusicDirtyItems
            : null;
    feedState.artistMusicDirtyItems = null;
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
        feedState.artistMusicFeedView !== "feed" ||
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

    feedState.artistMusicLoadMoreScrollPending = true;
    window.clearTimeout(artistMusicLoadMoreScrollTimer);
    artistMusicLoadMoreScrollTimer = window.setTimeout(() => {
        feedState.artistMusicLoadMoreScrollPending = false;
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
    if (feedState.artistMusicToggleNode || !document.body) {
        return feedState.artistMusicToggleNode;
    }

    const button = document.createElement("div");
    button.className = "bcampx-label-feed-toggle";
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.addEventListener("click", () => {
        void setArtistMusicFeedView(
            feedState.artistMusicFeedView === "feed" ? "original" : "feed",
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
    feedState.artistMusicToggleNode = button;
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
    const button = feedState.artistMusicToggleNode;
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
    const viewChanged = feedState.artistMusicFeedView !== nextView;

    feedState.artistMusicFeedView = nextView;
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
    feedState.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();
    feedState.artistMusicFeaturedNodes.forEach((node) => {
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
        if (!feedState.artistMusicVisibleCardsPending) {
            feedState.artistMusicVisibleCardsPending = new Set();
        }
        cards.forEach((card) => {
            if (card instanceof Element) {
                feedState.artistMusicVisibleCardsPending.add(card);
            }
        });
    } else {
        // A full scan is only needed for view switches and the initial
        // build; ordinary scroll appends pass just the new cards.
        feedState.artistMusicVisibleFetchAll = true;
    }

    if (feedState.artistMusicVisibleFetchTimer) {
        return;
    }

    feedState.artistMusicVisibleFetchTimer = window.setTimeout(() => {
        feedState.artistMusicVisibleFetchTimer = 0;
        const all = feedState.artistMusicVisibleFetchAll;
        const pending = feedState.artistMusicVisibleCardsPending;
        feedState.artistMusicVisibleFetchAll = false;
        feedState.artistMusicVisibleCardsPending = null;
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
    const toggle = feedState.artistMusicToggleNode;
    if (!toggle) {
        return;
    }

    const showingFeed = feedState.artistMusicFeedView === "feed";
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

