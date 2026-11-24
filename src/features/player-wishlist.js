import { isArtistMusicPage } from "../bcamplifier.core.js";
import {
    htmlToDocument,
    parseJsonAttribute,
    parseTralbumData,
    requestHtml,
} from "../data/release-data.js";
import { isOwnedDigitalPrice } from "./artist-music-feed.js";
import {
    canRunTrackActionHelper,
    recordTrackActionDiagnostic,
    requestTrackActionViaHelper,
    setTrackActionButtonPending,
} from "./track-actions.js";
import { PLAYER_WISHLIST_STATE_RETRY_MS, STATE } from "../state.js";
import {
    hasExtensionHostPermission,
    isWebExtensionHost,
} from "../utils/host-bridge.js";
import { isFanCollectionPage, resolveFanIdFromPageState } from "../utils/page.js";
import { cleanText } from "../utils/text-format.js";
import { isCustomDomainReleaseUrl, normalizeReleaseUrl } from "../utils/url.js";

const wishlistState = {
    requests: new Map(),
    retryTimers: new Map(),
};

const wishlistContext = {
    getActiveCard: () => null,
    getActiveReleaseData: () => null,
    getActiveFanGrid: () => null,
};

export function registerPlayerWishlistContext(context) {
    Object.assign(wishlistContext, context);
}

function setAttributeIfChanged(node, name, value) {
    if (node.getAttribute(name) !== value) {
        node.setAttribute(name, value);
    }
}

function setBooleanPropertyIfChanged(node, name, value) {
    const next = Boolean(value);
    if (Boolean(node[name]) !== next) {
        node[name] = next;
    }
}

function toggleClassIfChanged(node, className, active) {
    const next = Boolean(active);
    if (node.classList.contains(className) !== next) {
        node.classList.toggle(className, next);
    }
}

export function getPlayerFavoriteState(releaseUrl) {
    if (
        wishlistContext.getActiveReleaseData() &&
        isOwnedDigitalPrice(wishlistContext.getActiveReleaseData().digitalPrice)
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

    const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
    const cachedState = normalizedReleaseUrl
        ? STATE.playerWishlistStateByUrl.get(normalizedReleaseUrl)
        : null;
    const hasCachedState =
        cachedState &&
        typeof cachedState === "object" &&
        cachedState.status === "known";

    // A known remote state outranks the local fallback: a feed sync may
    // unmount the card while its track keeps playing, and the button must
    // keep showing (and toggling) the real wishlist state.
    if (!hasCachedState && !shouldUseRemotePlayerWishlist()) {
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

    const hasPendingAction =
        !!normalizedReleaseUrl &&
        STATE.playerWishlistActionRequests.has(normalizedReleaseUrl);
    // The extension cannot run the wishlist helper on custom domains, so
    // leave the button disabled rather than letting a click time out.
    const helperUnavailable = !canRunTrackActionHelper(normalizedReleaseUrl);
    return {
        hidden: !normalizedReleaseUrl,
        disabled:
            !normalizedReleaseUrl ||
            helperUnavailable ||
            hasPendingAction ||
            !hasCachedState ||
            cachedState.canToggle === false,
        hasState: true,
        active: hasCachedState ? Boolean(cachedState.active) : false,
        pending: hasPendingAction,
        owned: false,
    };
}

export function ensureRemotePlayerWishlistState(releaseUrl) {
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
        wishlistState.requests.get(normalizedReleaseUrl);
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
            wishlistState.requests.delete(normalizedReleaseUrl);
            if (
                normalizeReleaseUrl(STATE.activeReleaseUrl || "") ===
                normalizedReleaseUrl
            ) {
                syncFavoriteButtonState();
            }
        });

    wishlistState.requests.set(normalizedReleaseUrl, request);
    return request;
}

function schedulePlayerWishlistStateRetry(releaseUrl) {
    const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
    if (
        !normalizedReleaseUrl ||
        wishlistState.retryTimers.has(normalizedReleaseUrl)
    ) {
        return;
    }

    const timerId = window.setTimeout(() => {
        wishlistState.retryTimers.delete(normalizedReleaseUrl);
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

    wishlistState.retryTimers.set(normalizedReleaseUrl, timerId);
}

export function clearPlayerWishlistStateRetry(releaseUrl) {
    const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
    const timerId = normalizedReleaseUrl
        ? wishlistState.retryTimers.get(normalizedReleaseUrl)
        : 0;
    if (!timerId) {
        return;
    }

    window.clearTimeout(timerId);
    wishlistState.retryTimers.delete(normalizedReleaseUrl);
}

async function fetchPlayerWishlistState(releaseUrl) {
    try {
        const html = await requestHtml(releaseUrl);
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

export function setFavoriteButtonState(button, active) {
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


function findActiveWishlistControl() {
    const activeCard = wishlistContext.getActiveCard();
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

export function syncFavoriteButtonState() {
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

export function applyPlayerFavoriteState(button, state) {
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

export function toggleActiveWishlist() {
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
    if (isArtistMusicPage()) {
        return true;
    }

    const activeCard = wishlistContext.getActiveCard();
    if (
        activeCard &&
        activeCard.closest &&
        activeCard.closest(".bcampx-label-feed-card")
    ) {
        return true;
    }

    // A feed sync can unmount the card while its track keeps playing (for
    // example after switching to another fan tab). The release still
    // belongs to a fan feed, and the helper is the only way to toggle it,
    // so keep using the remote state for the release URL we are playing.
    const releaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
    const fanGrid = wishlistContext.getActiveFanGrid();
    return Boolean(
        releaseUrl &&
            fanGrid instanceof Element &&
            fanGrid.isConnected,
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

