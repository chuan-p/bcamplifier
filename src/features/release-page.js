import {
    getCardPrimaryReleaseUrl,
    getCardReleaseRequestContext,
} from "../utils/card-dom.js";
import { getReleaseData, parseTralbumData, resolveReleaseTitle } from "../data/release-data.js";
import {
    CONFIG,
    OWNED_RELEASE_COLLECTION_SEARCH_KEY,
    OWNED_RELEASE_COLLECTION_SEARCH_TTL_MS,
    STATE,
} from "../state.js";
import { isPlainPrimaryClick, markDebugState, setTextInputValue } from "../utils/dom.js";
import {
    canUseExternalHostMethod,
    isMissingCustomDomainHostPermissionError,
    isWebExtensionHost,
} from "../utils/host-bridge.js";
import { describeHostError } from "../utils/host-errors.js";
import { getCardController, isFanCollectionPage, loadUserSettings } from "../utils/page.js";
import { storageGet, storageSet } from "../utils/storage.js";
import { cleanText, cleanTitle, normalizedText } from "../utils/text-format.js";
import { isBandcampFanProfileUrl, isCustomDomainReleaseUrl, normalizeReleaseUrl } from "../utils/url.js";

const releasePageState = {
    unavailableReleaseGuardBound: false,
    ownedReleaseLinkVerificationBound: false,
};

export function setupReleasePageBuyAutofill() {
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

export function setupOwnedReleaseCollectionHandoff() {
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

export function navigateToOwnedReleaseCollection(title, targetUrl, releaseUrl) {
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

function resolveCurrentReleaseTitleForCollectionSearch() {
    const tralbum = parseTralbumData(document);
    return (
        resolveReleaseTitle(document, tralbum, null) ||
        cleanTitle(document.title)
    );
}

export async function applyPendingOwnedReleaseCollectionSearch() {
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

export function shouldAbandonReleaseEnhancement(error) {
    const message =
        error && error.message ? String(error.message) : "";
    return /Custom-domain Bandcamp release could not be resolved\./i.test(
        message,
    );
}

// A release page that is gone (hidden, removed, or taken down) cannot be
// opened any more. The card is still useful - the collection page ships a
// preview and the mobile API may still answer - but its links must stop
// pretending they lead somewhere.
export function isReleasePageUnavailableError(error) {
    const message = error && error.message ? String(error.message) : "";
    return /HTTP\s*(?:404|410)\b/i.test(message) || /\bnot found\b/i.test(message);
}

// getReleaseData keeps a visible cached snapshot usable when a refresh
// fails, and reports the underlying failure as `fallbackError` instead of
// throwing. A 404 that arrives this way is still proof that the page is
// gone, so every rendering path has to look at it explicitly.
export function isUnavailableReleaseResult(result) {
    return Boolean(
        result &&
            result.fallbackError &&
            isReleasePageUnavailableError(result.fallbackError),
    );
}

export function markReleasePageUnavailable(card, releaseUrl) {
    if (!(card instanceof Element)) {
        return;
    }

    const normalized = normalizeReleaseUrl(releaseUrl || "");
    if (normalized) {
        STATE.unavailableReleaseUrls.add(normalized);
    }
    card.setAttribute("data-bcampx-release-unavailable", "true");
    if (normalized) {
        card.setAttribute(
            "data-bcampx-release-unavailable-url",
            normalized,
        );
    }

    card.querySelectorAll("a[href]").forEach((link) => {
        const href = normalizeReleaseUrl(link.getAttribute("href") || "");
        // Only release-page links are dead. Artist, download, tag and
        // other links inside the card keep working; normalizeReleaseUrl
        // returns "" for all of them.
        if (!href) {
            return;
        }
        if (normalized && href !== normalized) {
            return;
        }
        link.classList.add("bcampx__link--unavailable");
        link.setAttribute("aria-disabled", "true");
        link.setAttribute(
            "title",
            "This release is no longer available.",
        );
    });
    // The fetch path may still be waiting on its API fallback; tell the user
    // right away that the page is gone.
    showReleaseUnavailableNotice(card);
}

// A click can land while the card's release metadata is still being
// checked (the first load, or a background refresh of a cached snapshot).
// Waiting for that check lets a hidden release be detected before
// navigation. Spending a fresh full-page request on every click is not
// acceptable: it turned navigation into a download behind the shared fetch
// queue, and a second click during the wait navigated natively anyway.
// Only cards that were never checked pay for a check on click, and even
// that wait is bounded below.
const CLICK_RELEASE_CHECK_WAIT_MS = 2500;

export function setupOwnedReleaseLinkVerification() {
    if (releasePageState.ownedReleaseLinkVerificationBound) {
        return;
    }

    releasePageState.ownedReleaseLinkVerificationBound = true;
    document.addEventListener(
        "click",
        (event) => {
            if (
                event.defaultPrevented ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            ) {
                return;
            }

            const target = event.target;
            const link =
                target && typeof target.closest === "function"
                    ? target.closest("a[href]")
                    : null;
            if (!link) {
                return;
            }

            const feedCard = link.closest(".bcampx-label-feed-card");
            const nativeItem = feedCard
                ? null
                : link.closest(".collection-item-container");
            const card = feedCard || nativeItem;
            if (!card || !isFanCollectionPage()) {
                return;
            }

            if (
                card.getAttribute("data-bcampx-release-unavailable") ===
                "true"
            ) {
                return;
            }

            const releaseUrl = normalizeReleaseUrl(
                card.getAttribute("data-bcampx-release-url") ||
                    getCardPrimaryReleaseUrl(card) ||
                    "",
            );
            const href = normalizeReleaseUrl(
                link.getAttribute("href") || "",
            );
            if (!releaseUrl || href !== releaseUrl) {
                return;
            }

            if (
                card.getAttribute("data-bcampx-release-navigating") ===
                "true"
            ) {
                // The first click is already waiting on the in-flight
                // check; a second one must not fall through to the browser
                // and reach the page before the check answers.
                event.preventDefault();
                event.stopPropagation();
                if (
                    typeof event.stopImmediatePropagation === "function"
                ) {
                    event.stopImmediatePropagation();
                }
                return;
            }

            const pendingCheck = getPendingReleaseCheck(card);
            if (!pendingCheck) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            }

            card.setAttribute("data-bcampx-release-navigating", "true");
            const targetUrl = link.href;
            const wait = new Promise((resolve) => {
                window.setTimeout(resolve, CLICK_RELEASE_CHECK_WAIT_MS);
            });
            void Promise.race([pendingCheck, wait]).then(() => {
                card.removeAttribute("data-bcampx-release-navigating");
                if (
                    card.getAttribute(
                        "data-bcampx-release-unavailable",
                    ) === "true"
                ) {
                    showReleaseUnavailableNotice(card);
                    return;
                }
                if (targetUrl) {
                    window.location.assign(targetUrl);
                }
            });
        },
        true,
    );
}

// A click has to answer one question: has this release's page been
// checked?
//  - a load or background refresh is running: wait for that check;
//  - the card was already page-checked: navigate, without a new request;
//  - the card was never page-checked (own collection track cards skip the
//    automatic load, and tag-index cards only call the mobile API): ask
//    the page once now, so following the link cannot land on a 404.
// The click handler bounds the wait, so a slow check still lets the user
// through instead of blocking navigation for the full request timeout.
function getPendingReleaseCheck(card) {
    const controller = getCardController(card);
    if (!controller) {
        return null;
    }

    const waitForRefresh = () => {
        const refresh = controller.refreshPromise;
        return refresh ? Promise.resolve(refresh).catch(() => {}) : null;
    };
    const refresh = waitForRefresh();
    if (refresh) {
        return refresh;
    }
    if (controller.loading && controller.loadingPromise) {
        return Promise.resolve(controller.loadingPromise)
            .catch(() => {})
            .then(() => waitForRefresh());
    }
    if (controller.releaseChecked) {
        return null;
    }

    const releaseUrl = normalizeReleaseUrl(
        controller.releaseUrl || getCardPrimaryReleaseUrl(card) || "",
    );
    if (!releaseUrl) {
        return null;
    }

    const context =
        controller.releaseRequestContext ||
        getCardReleaseRequestContext(card, releaseUrl);
    return Promise.resolve(
        getReleaseData({ ...context, forceRefresh: true }),
    )
        .then((result) => {
            // A request already in flight can answer with a cached
            // snapshot while it refreshes; the 404 arrives later.
            if (
                result &&
                result.refreshingTracks &&
                result.refreshPromise
            ) {
                return Promise.resolve(result.refreshPromise).catch(
                    () => result,
                );
            }
            return result;
        })
        .then((result) => {
            if (isUnavailableReleaseResult(result)) {
                markReleasePageUnavailable(card, releaseUrl);
            }
        })
        .catch((error) => {
            if (isReleasePageUnavailableError(error)) {
                markReleasePageUnavailable(card, releaseUrl);
            }
        })
        .finally(() => {
            controller.releaseChecked = true;
        });
}

function showReleaseUnavailableNotice(card) {
    if (!(card instanceof Element)) {
        return;
    }

    const summary = card.querySelector(".bcampx__summary");
    const text = card.querySelector(".bcampx__summary-text");
    if (summary) {
        summary.hidden = false;
    }
    if (text) {
        text.textContent =
            "This release is no longer available on Bandcamp.";
    }
}

export function clearReleasePageUnavailable(card) {
    if (
        !(card instanceof Element) ||
        !card.hasAttribute("data-bcampx-release-unavailable")
    ) {
        return;
    }

    const normalized = normalizeReleaseUrl(
        card.getAttribute("data-bcampx-release-unavailable-url") || "",
    );
    if (normalized) {
        STATE.unavailableReleaseUrls.delete(normalized);
    }
    card.removeAttribute("data-bcampx-release-unavailable");
    card.removeAttribute("data-bcampx-release-unavailable-url");
    card.querySelectorAll(".bcampx__link--unavailable").forEach((link) => {
        link.classList.remove("bcampx__link--unavailable");
        link.removeAttribute("aria-disabled");
        link.removeAttribute("title");
    });
}

// Block the click at the document level so links added later (the error
// panel's "Open release") are covered as well.
export function setupUnavailableReleaseLinkGuard() {
    if (releasePageState.unavailableReleaseGuardBound) {
        return;
    }

    releasePageState.unavailableReleaseGuardBound = true;
    window.addEventListener(
        "click",
        (event) => {
            const target = event.target;
            const link =
                target && typeof target.closest === "function"
                    ? target.closest("a[href]")
                    : null;
            if (!link) {
                return;
            }

            const card = link.closest(
                "[data-bcampx-release-unavailable='true']",
            );
            if (!card) {
                return;
            }

            const blocked = normalizeReleaseUrl(
                card.getAttribute(
                    "data-bcampx-release-unavailable-url",
                ) || "",
            );
            const href = normalizeReleaseUrl(
                link.getAttribute("href") || "",
            );
            // Non-release links (artist page, download, tags) are not
            // dead and must keep working.
            if (!href) {
                return;
            }
            if (blocked && href !== blocked) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            }
        },
        true,
    );
}

export function shouldOfferCustomDomainPermissionButton(error, releaseUrl) {
    return Boolean(
        isMissingCustomDomainHostPermissionError(error) &&
            isWebExtensionHost() &&
            isCustomDomainReleaseUrl(releaseUrl) &&
            canUseExternalHostMethod("requestHostPermission"),
    );
}

export function normalizeDisplayErrorMessage(error) {
    const rawMessage =
        error && error.message ? String(error.message) : "unknown error";
    const hostMessage = describeHostError(rawMessage);
    if (hostMessage) {
        return hostMessage;
    }

    if (isMissingCustomDomainHostPermissionError(error)) {
        return "This release uses a Bandcamp custom domain. Allow access to this domain to load details in the extension.";
    }

    return rawMessage;
}

export function shouldOfferReleasePageRefresh(errorMessage) {
    const message = cleanText(errorMessage).toLowerCase();
    return Boolean(
        message &&
            (/refresh this bandcamp tab/.test(message) ||
                /extension was updated or reloaded/.test(message) ||
                /storage is unavailable/.test(message)),
    );
}
