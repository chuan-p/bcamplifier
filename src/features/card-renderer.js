import { getCardController, normalizeReleaseUrl } from "../bcamplifier.core.js";
import {
    createEmptyReleaseData,
    fetchApiReleaseTracklist,
    getReleaseData,
    normalizeReleaseData,
} from "../data/release-data.js";
import {
    getCachedReleaseTags,
    getTagTralbumKey,
    harvestTagsFromReleaseData,
    isTagIndexRateLimitError,
} from "../data/tag-index.js";
import { getDigitalBuyActionLabel, isOwnFanTrackCard, updateArtistMusicCardBuyAction } from "./artist-music-feed.js";
import { getMergedTrackTitleSet, isFullDiscographyReleaseData } from "./card-merge.js";
import {
    beginPlaybackIntent,
    findPlayableTrackByTitle,
    isPlaybackIntentCurrent,
    playSharedTrack,
    playTrackForCard,
    syncActivePlaybackReleaseData,
} from "./player.js";
import {
    clearReleasePageUnavailable,
    isReleasePageUnavailableError,
    isUnavailableReleaseResult,
    markReleasePageUnavailable,
    normalizeDisplayErrorMessage,
    shouldAbandonReleaseEnhancement,
    shouldOfferCustomDomainPermissionButton,
    shouldOfferReleasePageRefresh,
} from "./release-page.js";
import {
    canUseExternalHostMethod,
    createTrackActionButtons,
    getExternalHostApi,
    openTrackBuyWindow,
    recordTrackActionDiagnostic,
    resolveTrackActionUrl,
    scheduleNextFrame,
} from "./track-actions.js";
import {
    BUY_ACTION_TEXT_RE,
    CARD_SELECTOR,
    COLLECT_ACTION_TEXT_RE,
    COLLECT_CONTROLS_SELECTOR,
    CONFIG,
    CONTENT_COLUMN_SELECTOR,
    FEED_CARD_ROOT_SELECTOR,
    HIDDEN_SUPPORTED_ATTR,
    LOADING_EXTRA_CONTEXT_TEXT,
    RELEASE_LINK_SELECTOR,
    STATE,
    SUPPORTED_SLOT_SELECTOR,
} from "../state.js";
import {
    createClassedElement,
    createDescriptionElement,
    createTrackListElement,
    findCachedElementByText,
    findCachedSelector,
    getNodeMemo,
    markDebugState,
    normalizeDescriptionContent,
} from "../utils/dom.js";
import {
    buildLoadedSummaryText,
    buildSummaryText,
    cleanText,
    compactJoin,
    formatReleaseDate,
    hasExpandableContent,
    hasVisibleEnhancements,
    normalizedText,
} from "../utils/text-format.js";

export function renderArtistMusicCardInitialData(
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

export function mountEnhancementShell(card, shell) {
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

export function findContentColumn(card) {
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

export async function fetchAndRender(
    controller,
    releaseUrl,
    shell,
    meta,
    text,
    toggle,
    options,
) {
    const releaseMeta =
        controller.card && controller.card.__bcampxArtistMusicRelease;
    if (releaseMeta && releaseMeta.pageUnavailable) {
        // The native collection item has no release-page link: the page is
        // gone, so do not spend a request on it.
        controller.releaseChecked = true;
        controller.loading = false;
        controller.loaded = true;
        controller.failed = false;
        markReleasePageUnavailable(
            controller.card,
            releaseUrl,
        );
        if (text) {
            text.textContent =
                "This release is no longer available on Bandcamp.";
        }
        return;
    }
    controller.loading = true;
    applyReleaseShellLoadingState(controller);
    let keepLoadingForRefresh = false;
    const releaseForTracklist = releaseMeta;

    try {
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
                clearReleasePageUnavailable(controller.card);
                syncActivePlaybackReleaseData(releaseUrl, data);
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
                return;
            }
        }

        const result = await getReleaseData(
            controller.releaseRequestContext || releaseUrl,
        );
        // A fresh cache hit never asked the page, so the first click still
        // checks it. A real request, a failed one, or a background refresh
        // already answers "is the page there?".
        controller.releaseChecked = Boolean(
            result &&
                (result.fromCache !== true ||
                    result.stale === true ||
                    Boolean(result.fallbackError) ||
                    Boolean(result.refreshingTracks)),
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
        clearReleasePageUnavailable(controller.card);
        syncActivePlaybackReleaseData(releaseUrl, normalizedData);
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
        if (isUnavailableReleaseResult(result)) {
            markReleasePageUnavailable(controller.card, releaseUrl);
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

        // The page is gone: keep whatever the collection page gave us
        // (preview, download) but stop offering links into a dead page.
        if (isReleasePageUnavailableError(error)) {
            markReleasePageUnavailable(controller.card, releaseUrl);
        }

        const apiTracklist =
            await fetchApiReleaseTracklist(releaseForTracklist);
        if (apiTracklist && apiTracklist.tracks.length) {
            controller.loaded = true;
            controller.failed = false;
            controller.data = normalizeReleaseData({
                ...createEmptyReleaseData(),
                ...apiTracklist,
            });
            syncActivePlaybackReleaseData(
                releaseUrl,
                controller.data,
            );
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

export function applyReleaseShellLoadingState(controller) {
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
            syncActivePlaybackReleaseData(releaseUrl, normalizedData);
            const unavailable = isUnavailableReleaseResult(result);
            if (!shell.isConnected) {
                if (unavailable) {
                    markReleasePageUnavailable(
                        controller.card,
                        releaseUrl,
                    );
                }
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
            if (unavailable) {
                // Paint the summary first: the notice replaces it.
                markReleasePageUnavailable(controller.card, releaseUrl);
            }
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
            if (isReleasePageUnavailableError(error)) {
                markReleasePageUnavailable(controller.card, releaseUrl);
            }
        })
        .finally(() => {
            if (controller.refreshPromise === refreshPromise) {
                controller.refreshPromise = null;
            }
            clearReleaseShellLoadingState(controller);
        });
}

export function toggleDetails(controller, shell, toggle) {
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

export function renderReleaseData(shell, meta, text, toggle, data, releaseUrl) {
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

export async function playOwnFanTrackAfterLoadingStream(
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
    const intent = beginPlaybackIntent();
    try {
        const result = await getReleaseData({ releaseUrl: resolvedTrackUrl });
        if (!isPlaybackIntentCurrent(intent)) {
            return;
        }
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
        if (!isPlaybackIntentCurrent(intent)) {
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
            { intent },
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
    const unavailable = isReleasePageUnavailableError(error);
    const errorMessage = normalizeDisplayErrorMessage(error);
    const message = createClassedElement("p", "bcampx__error");
    message.textContent = unavailable
        ? "This release is no longer available on Bandcamp."
        : `Could not load release details: ${errorMessage}`;

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
    if (!unavailable) {
        meta.append(createOpenReleaseLink(releaseUrl));
    }
    text.textContent = unavailable
        ? "Release unavailable"
        : "Extra context failed to load";
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
