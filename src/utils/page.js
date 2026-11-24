import { CONFIG, USER_SETTINGS_KEY } from "../state.js";
import { storageGet, storageSet } from "./storage.js";
import { cleanText } from "./text-format.js";
import { isBandcampFanCollectionPageUrl } from "./url.js";

export async function loadUserSettings() {
    const stored = await storageGet(USER_SETTINGS_KEY, null);
    applyUserSettings(stored);
}

function applyUserSettings(value) {
    const settings = value && typeof value === "object" ? value : {};
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

export function getCardController(card) {
    return card && card.__bcampxController ? card.__bcampxController : null;
}

export function setCardController(card, controller) {
    if (card) {
        card.__bcampxController = controller || null;
    }
}

export function isFanWishlistPage() {
    return /\/wishlist\/?$/i.test(window.location.pathname || "");
}

let currentFanCollectionPageHref = "";
let currentFanCollectionPageMemo = false;

export function isCurrentFanCollectionPage() {
    const href = window.location.href || "";
    if (href !== currentFanCollectionPageHref) {
        currentFanCollectionPageHref = href;
        currentFanCollectionPageMemo = isBandcampFanCollectionPageUrl(href);
    }

    return currentFanCollectionPageMemo;
}

export function findFanCollectionActiveGrid() {
    const activeGridContainer = document.querySelector("#grids > .grid.active");
    if (activeGridContainer) {
        return findFanCollectionGridIn(activeGridContainer);
    }

    const activeTab = document.querySelector("li.active[data-grid-id][data-tab]");
    const activeGridId = cleanText(
        activeTab && activeTab.getAttribute("data-grid-id"),
    );
    if (activeGridId) {
        const activeTabGrid = document.querySelector(`#${CSS.escape(activeGridId)}`);
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

export function isFanCollectionPage() {
    if (!isBandcampFanCollectionPageUrl(window.location.href)) {
        return false;
    }

    return Boolean(findFanCollectionActiveGrid());
}

export function resolveFanIdFromPageState(pagedataBlob, collectInfo = {}) {
    return (
        Number(
            (pagedataBlob &&
                pagedataBlob.identities &&
                pagedataBlob.identities.fan &&
                pagedataBlob.identities.fan.id) ||
                (pagedataBlob &&
                    pagedataBlob.fan_info &&
                    pagedataBlob.fan_info.fan_id) ||
                collectInfo.fan_id ||
                0,
        ) || 0
    );
}
