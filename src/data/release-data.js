import {
    CACHE_SCHEMA_VERSION,
    CONFIG,
    RELEASE_CACHE_PREFIX,
    RELEASE_SUPPORTER_COUNT_CACHE_PREFIX,
    STATE,
} from "../state.js";
import { createConcurrencyLimiter } from "../utils/async.js";
import { incrementDebugCounter, markDebugState } from "../utils/dom.js";
import { TAG_INDEX_PACING_HOOKS } from "../utils/hooks.js";
import {
    canUseExternalHostMethod,
    getExternalHostApi,
    getHostRequestOptions,
    isMissingCustomDomainHostPermissionError,
} from "../utils/host-bridge.js";
import { storageGet, storageSet, trackReleaseCacheEntry } from "../utils/storage.js";
import {
    firstPositiveNumber,
    isBandcampFanProfileUrl,
    isBandcampReleaseUrl,
    normalizeReleaseItemType,
    normalizeReleaseUrl,
} from "../utils/url.js";
import {
    attrContent,
    cleanText,
    cleanTitle,
    decodeJsString,
    extractDescriptionHtml,
    firstString,
    hasVisibleEnhancements,
    isLikelyTracklistDescription,
    isLikelyTracklistHtml,
    isLikelyTracklistText,
    metaContent,
    normalizedText,
    plainTextToDescriptionHtml,
    queryTexts,
    sanitizeDescriptionHtml,
    textContent,
    truncate,
    uniqueStrings,
} from "../utils/text-format.js";

const releaseDataState = {
    pendingReleaseRequests: new Map(),
    releaseViewerKey: undefined,
    pageFreshTrackReleaseKeys: new Set(),
    pendingSupporterCountRequests: new Map(),
};

export async function getReleaseData(releaseInput) {
    const requestContext = normalizeReleaseRequestContext(releaseInput);
    const cacheKey = getReleaseCacheKey(requestContext.releaseUrl);
    const cached = await storageGet(cacheKey, null);
    let normalizedCached =
        cached && typeof cached === "object"
            ? normalizeReleaseData(cached)
            : null;

    // "You own this" and the ownership link are answers about the signed-in
    // account, not about the release. A cache entry written for another
    // account (or for the anonymous side of the same browser) must not be
    // shown as this account's purchase state.
    const viewerKey = getReleaseViewerKey();
    const cachedViewerKey = cleanText(cached && cached.viewerKey);
    // Account fields may be shown only when both sides name the same
    // viewer. A missing viewer on either side is unconfirmed, not a match:
    // an anonymous visit must not inherit ownership from a signed-in visit.
    // A missing viewer also must not force a fetch for an entry that has no
    // account fields at all (see below).
    // A viewer mismatch only matters when the entry actually carries
    // account state. An entry with no ownership/download fields has
    // nothing to recover; refetching it on every logged-in visit would be
    // one page request per card for no benefit.
    const cachedHasAccountFields =
        hasAccountScopedReleaseFields(normalizedCached);
    // An entry with account fields but no viewer key (a response that
    // could not name its viewer) is never safe to attribute to the current
    // account. Treat "missing cached viewer" and "missing
    // current viewer" as mismatches too; otherwise an anonymous visit can
    // display ownership written by a signed-in visit.
    const accountScopeMismatch = Boolean(
        cached &&
            typeof cached === "object" &&
            cachedHasAccountFields &&
            (!cachedViewerKey ||
                !cleanText(viewerKey) ||
                cachedViewerKey !== viewerKey),
    );
    // The entry carries purchase state this page cannot confirm. Serve the
    // stripped copy right away and recover the account fields in the
    // background instead of blocking the card on a request every visit.
    requestContext.viewerRefreshPending = accountScopeMismatch;
    if (accountScopeMismatch && normalizedCached) {
        normalizedCached = stripAccountScopedReleaseFields(normalizedCached);
    }
    // An entry written by an older description format still gets a
    // background refresh, but it must not hide the card while that request
    // runs. The render path already knows how to keep a cached snapshot
    // visible until the refreshed data arrives.
    requestContext.descriptionRefreshPending = Boolean(
        normalizedCached &&
            needsDescriptionFormatRefresh(normalizedCached),
    );
    if (accountScopeMismatch) {
        markDebugState(
            "data-bcampx-release-viewer",
            cleanText(viewerKey) ? "other" : "unknown",
        );
        incrementDebugCounter(
            "data-bcampx-release-viewer-refresh-count",
        );
    }

    const freshCache =
        isFreshReleaseCache(cached) &&
        requestContext.forceRefresh !== true;
    if (freshCache) {
        const shouldRefresh =
            accountScopeMismatch ||
            shouldRefreshCachedRelease(
                cached,
                normalizedCached,
                requestContext,
                cacheKey,
            );
        if (!shouldRefresh) {
            return { data: normalizedCached, fromCache: true, stale: false };
        }
    }

    const pending = releaseDataState.pendingReleaseRequests.get(cacheKey);
    if (pending) {
        if (
            shouldServeCachedReleaseWhileRefreshing(
                requestContext,
                cached,
                normalizedCached,
            )
        ) {
            return buildRefreshingCachedReleaseResult(
                normalizedCached,
                pending,
            );
        }
        return pending;
    }

    const request = enqueueReleaseFetch(async () => {
        try {
            const resolvedRequest = await resolveReleaseRequestContext(
                requestContext,
            );
            const html =
                typeof resolvedRequest.html === "string"
                    ? resolvedRequest.html
                    : await requestHtml(resolvedRequest.fetchUrl);
            const data = normalizeReleaseData(
                parseReleasePage(html, resolvedRequest.releaseUrl),
            );
            const cacheValue = buildReleaseCacheValue(data);

            // A 200 response that parses to nothing (a challenge page, an
            // error page served with 200, a truncated body) must not
            // become the next week's answer for this release. Keep it for
            // this request only and let the next visit try again.
            if (isCacheableReleaseValue(cacheValue)) {
                await storageSet(cacheKey, cacheValue);
                void trackReleaseCacheEntry(cacheKey).catch(() => {});
                if (hasPlayableTracks(cacheValue)) {
                    releaseDataState.pageFreshTrackReleaseKeys.add(cacheKey);
                }
            } else {
                markDebugState(
                    "data-bcampx-release-uncached",
                    normalizeReleaseUrl(resolvedRequest.releaseUrl || ""),
                );
            }
            return { data: cacheValue, fromCache: false, stale: false };
        } catch (error) {
            if (hasVisibleEnhancements(normalizedCached)) {
                return {
                    data: normalizedCached,
                    fromCache: true,
                    stale: true,
                    fallbackError: error,
                };
            }
            throw error;
        }
    });

    releaseDataState.pendingReleaseRequests.set(cacheKey, request);
    const clearPendingRequest = () => {
        if (releaseDataState.pendingReleaseRequests.get(cacheKey) === request) {
            releaseDataState.pendingReleaseRequests.delete(cacheKey);
        }
    };
    request.then(clearPendingRequest, clearPendingRequest);

    if (
        freshCache &&
        shouldServeCachedReleaseWhileRefreshing(
            requestContext,
            cached,
            normalizedCached,
        )
    ) {
        return buildRefreshingCachedReleaseResult(
            normalizedCached,
            request,
        );
    }

    return request;
}

function buildRefreshingCachedReleaseResult(data, refreshPromise) {
    return {
        data,
        fromCache: true,
        stale: false,
        refreshingTracks: true,
        refreshPromise,
    };
}

function shouldServeCachedReleaseWhileRefreshing(
    requestContext,
    rawData,
    normalizedData,
) {
    const serveCached =
        requestContext &&
        (requestContext.allowCachedTrackSnapshot === true ||
            requestContext.viewerRefreshPending === true ||
            requestContext.descriptionRefreshPending === true);
    return Boolean(
        serveCached &&
            rawData &&
            normalizedData &&
            isFreshReleaseCache(rawData) &&
            hasVisibleEnhancements(normalizedData),
    );
}

const releaseFetchLimiter = createConcurrencyLimiter(
    () => CONFIG.maxConcurrentFetches,
);
const supporterCountFetchLimiter = createConcurrencyLimiter(
    () => CONFIG.maxConcurrentSupporterCountFetches,
);

function enqueueReleaseFetch(task) {
    return releaseFetchLimiter(task);
}

function getReleaseCacheKey(releaseUrl) {
    return `${RELEASE_CACHE_PREFIX}${releaseUrl}`;
}

function getReleaseSupporterCountCacheKey(releaseUrl) {
    return `${RELEASE_SUPPORTER_COUNT_CACHE_PREFIX}${releaseUrl}`;
}

function normalizeReleaseRequestContext(releaseInput) {
    if (releaseInput && typeof releaseInput === "object") {
        return {
            releaseUrl: normalizeReleaseUrl(releaseInput.releaseUrl || ""),
            itemId: firstPositiveNumber(releaseInput.itemId),
            itemType: normalizeReleaseItemType(
                releaseInput.itemType,
                releaseInput.releaseUrl || "",
            ),
            requirePageFreshTracks:
                releaseInput.requirePageFreshTracks === true,
            allowCachedTrackSnapshot:
                releaseInput.allowCachedTrackSnapshot === true,
            forceFreshTracks: releaseInput.forceFreshTracks === true,
            forceRefresh: releaseInput.forceRefresh === true,
        };
    }

    return {
        releaseUrl: normalizeReleaseUrl(releaseInput || ""),
        itemId: 0,
        itemType: normalizeReleaseItemType("", releaseInput || ""),
        requirePageFreshTracks: false,
        allowCachedTrackSnapshot: false,
        forceFreshTracks: false,
        forceRefresh: false,
    };
}

async function resolveReleaseRequestContext(requestContext) {
    const normalizedContext = normalizeReleaseRequestContext(requestContext);
    if (isBandcampReleaseUrl(normalizedContext.releaseUrl)) {
        return {
            releaseUrl: normalizedContext.releaseUrl,
            fetchUrl: normalizedContext.releaseUrl,
        };
    }

    let directFetchError = null;
    try {
        const directFetchResult =
            await tryResolveCustomDomainReleaseRequestContext(
                normalizedContext,
            );
        if (directFetchResult) {
            return directFetchResult;
        }
    } catch (error) {
        directFetchError = error;
    }

    if (isMissingCustomDomainHostPermissionError(directFetchError)) {
        throw directFetchError;
    }

    if (directFetchError) {
        throw directFetchError;
    }

    throw new Error("Custom-domain Bandcamp release could not be resolved.");
}

async function tryResolveCustomDomainReleaseRequestContext(requestContext) {
    const releaseUrl = normalizeReleaseUrl(
        requestContext && requestContext.releaseUrl,
    );
    if (!releaseUrl || isBandcampReleaseUrl(releaseUrl)) {
        return null;
    }

    const html = await requestHtml(releaseUrl);
    return {
        releaseUrl: extractReleaseCanonicalUrl(html, releaseUrl),
        fetchUrl: releaseUrl,
        html,
    };
}

function extractReleaseCanonicalUrl(html, fallbackUrl = "") {
    const doc = htmlToDocument(html);
    const candidates = [
        attrContent(doc, 'link[rel="canonical"]', "href"),
        metaContent(doc, 'meta[property="og:url"]'),
        metaContent(doc, 'meta[name="twitter:url"]'),
    ];

    for (const candidate of candidates) {
        const normalized = normalizeReleaseUrl(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return normalizeReleaseUrl(fallbackUrl);
}

function buildReleaseCacheValue(data) {
    const viewerKey =
        cleanText(data && data.viewerKey) || getReleaseViewerKey();
    const value = {
        ...data,
        schemaVersion: CACHE_SCHEMA_VERSION,
        fetchedAt: Date.now(),
        // Which viewer this entry's account fields belong to. Empty means
        // anonymous. A reader with a different identity drops those fields
        // and refetches instead of trusting them.
        viewerKey,
    };

    // If the response could not be tied to a viewer, account-scoped state
    // cannot be attributed to anyone. Persisting it would let the next
    // account read another account's purchase state, so strip those fields
    // before storing the release metadata itself.
    if (!viewerKey && hasAccountScopedReleaseFields(value)) {
        return stripAccountScopedReleaseFields(value);
    }

    return value;
}

export function valueClaimsOwnership(data) {
    return Boolean(
        (data && /^you own this$/i.test(cleanText(data.digitalPrice))) ||
            cleanText(data && data.digitalOwnershipUrl),
    );
}

// The fields that describe the signed-in account's relationship to the
// release rather than the release itself. They are what a different viewer
// must not see, and what a background refresh is worth spending a request
// on when the current page cannot confirm the viewer.
export function hasAccountScopedReleaseFields(data) {
    return Boolean(
        data &&
            (valueClaimsOwnership(data) ||
                cleanText(data.digitalDownloadUrl)),
    );
}

// Anything a real release page yields (even a sparse one) carries at least
// a title, an artist, a track or a tag. Requiring one keeps an empty parse
// from being cached for the full TTL.
export function isCacheableReleaseValue(value) {
    if (!value || typeof value !== "object") {
        return false;
    }

    return Boolean(
        cleanText(value.title) ||
            cleanText(value.artist) ||
            cleanText(value.description) ||
            (Array.isArray(value.tracks) && value.tracks.length) ||
            (Array.isArray(value.tags) && value.tags.length),
    );
}

function getReleaseViewerKey() {
    if (releaseDataState.releaseViewerKey !== undefined) {
        return releaseDataState.releaseViewerKey;
    }

    let viewerKey = "";
    try {
        viewerKey = readViewerKeyFromDocument(document);
    } catch (_error) {
        viewerKey = "";
    }

    // Only remember a miss once the document has been parsed. Caching ""
    // during parsing would make every later cache entry look like it
    // belongs to a different viewer.
    const parsed =
        typeof document === "object" &&
        document &&
        document.readyState &&
        document.readyState !== "loading";
    if (viewerKey || parsed) {
        releaseDataState.releaseViewerKey = viewerKey;
    }
    return viewerKey;
}

function extractReleaseViewerKey(documentFromHtml) {
    if (!documentFromHtml || typeof documentFromHtml.querySelectorAll !== "function") {
        return "";
    }

    return readViewerKeyFromDocument(documentFromHtml);
}

// A page can carry more than one pagedata blob (the profile page ships the
// fan data in one and the identity in another), so look through all of
// them instead of trusting the first element in document order.
function readViewerKeyFromDocument(doc) {
    if (!doc || typeof doc.querySelectorAll !== "function") {
        return "";
    }

    const nodes = Array.from(
        doc.querySelectorAll("#pagedata[data-blob], #pagedata"),
    );
    for (const node of nodes) {
        const pageData = parseJsonAttribute(node, "data-blob");
        if (!pageData || typeof pageData !== "object") {
            continue;
        }
        const fanId =
            pageData.identities &&
            pageData.identities.fan &&
            pageData.identities.fan.id;
        const fallbackFanId =
            (pageData.fan_info && pageData.fan_info.fan_id) ||
            (pageData.current_fan &&
                (pageData.current_fan.fan_id ||
                    pageData.current_fan.id));
        // On the owner's own profile the page fan is the signed-in fan.
        // `fan_data` describes the profile owner, so it is only usable
        // when the page itself says it belongs to the current viewer.
        const ownProfileFanId =
            pageData.fan_data &&
            pageData.fan_data.is_own_page === true
                ? pageData.fan_data.fan_id || pageData.fan_data.id
                : 0;
        const normalized =
            Number(fanId || fallbackFanId || ownProfileFanId) || 0;
        if (normalized) {
            return `fan:${normalized}`;
        }
    }

    return "";
}

export function stripAccountScopedReleaseFields(data) {
    if (!data || typeof data !== "object") {
        return data;
    }

    return {
        ...data,
        digitalPrice: "",
        digitalOwnershipUrl: "",
        digitalDownloadUrl: "",
    };
}

function isFreshReleaseCache(value) {
    return Boolean(
        value &&
        value.fetchedAt &&
        Date.now() - value.fetchedAt < CONFIG.cacheTtlMs,
    );
}

function shouldRefreshCachedRelease(
    rawData,
    normalizedData,
    requestContext,
    cacheKey,
) {
    // A caller that knows the cached stream is dead (a preview URL that
    // failed to play) must never be served that snapshot again, even while
    // it is still within the TTL.
    if (requestContext && requestContext.forceFreshTracks === true) {
        return true;
    }
    if (!isCacheableReleaseValue(normalizedData)) {
        return true;
    }
    return (
        needsTrackRefresh(normalizedData) ||
        needsTrackSnapshotRefresh(
            rawData,
            normalizedData,
            requestContext,
            cacheKey,
        ) ||
        needsDescriptionFormatRefresh(normalizedData) ||
        needsSupporterSnapshotRefresh(rawData, normalizedData)
    );
}

function needsTrackSnapshotRefresh(
    rawData,
    normalizedData,
    requestContext,
    cacheKey,
) {
    if (
        !hasPlayableTracks(normalizedData) ||
        !rawData ||
        !rawData.fetchedAt
    ) {
        return false;
    }

    if (
        requestContext &&
        requestContext.requirePageFreshTracks === true &&
        !releaseDataState.pageFreshTrackReleaseKeys.has(cacheKey)
    ) {
        return true;
    }

    const ttlMs = Math.max(0, Number(CONFIG.trackCacheTtlMs) || 0);
    return ttlMs > 0 && Date.now() - Number(rawData.fetchedAt) >= ttlMs;
}

export function hasPlayableTracks(data) {
    return Boolean(
        data &&
            Array.isArray(data.tracks) &&
            data.tracks.some((track) => track && track.streamUrl),
    );
}

function needsSupporterSnapshotRefresh(rawData, normalizedData) {
    if (
        !CONFIG.showCollectionCounts ||
        !normalizedData ||
        !normalizedData.supporterCount ||
        !rawData ||
        !rawData.fetchedAt
    ) {
        return false;
    }

    const ttlMs = Math.max(
        0,
        Number(CONFIG.supporterCountCacheTtlMs) || 0,
    );
    return ttlMs > 0 && Date.now() - Number(rawData.fetchedAt) >= ttlMs;
}

function requestText(url, options = {}) {
    const externalMethod = options.externalMethod || "requestHtml";
    if (canUseExternalHostMethod(externalMethod)) {
        return Promise.resolve(
            getExternalHostApi()[externalMethod](
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

        const includeCredentials = options.credentials === "include";
        GM_xmlhttpRequest({
            method: options.method || "GET",
            url,
            data: options.data,
            timeout: CONFIG.fetchTimeoutMs,
            // Firefox's Tampermonkey honours `anonymous` where some
            // versions ignore `withCredentials`; set both so the signed-in
            // session is used when requested.
            withCredentials: includeCredentials,
            anonymous: !includeCredentials,
            headers: options.headers,
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

export function requestHtml(url) {
    return requestText(url, {
        externalMethod: "requestHtml",
        credentials: "include",
        headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    });
}

export function requestJson(url, options = {}) {
    if (canUseExternalHostMethod("requestJson")) {
        return Promise.resolve(
            getExternalHostApi().requestJson(
                url,
                getHostRequestOptions(options),
            ),
        );
    }

    return requestText(url, {
        ...options,
        headers: options.headers || {
            Accept: "application/json, text/javascript, */*; q=0.01",
        },
    }).then((responseText) => {
        try {
            return JSON.parse(responseText || "null");
        } catch (_error) {
            throw new Error("Invalid JSON response.");
        }
    });
}

export function htmlToDocument(html) {
    return new DOMParser().parseFromString(html || "", "text/html");
}

export function parseJsonAttribute(node, attr) {
    if (!node || !attr) {
        return null;
    }

    try {
        return JSON.parse(node.getAttribute(attr) || "null");
    } catch (_error) {
        return null;
    }
}

export function parseReleasePage(html, releaseUrl) {
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
    const supporterState = extractReleaseSupporterState(
        documentFromHtml,
        tralbum,
    );

    return {
        url: releaseUrl,
        // Recorded from the response itself: the page was rendered for
        // whichever account made this request, so it is the identity the
        // account fields below belong to.
        viewerKey: extractReleaseViewerKey(documentFromHtml),
        title: resolveReleaseTitle(documentFromHtml, tralbum, jsonLd),
        artist: resolveReleaseArtist(documentFromHtml, tralbum, jsonLd),
        releaseDate: resolveReleaseDate(documentFromHtml, tralbum, jsonLd),
        location: resolveReleaseLocation(documentFromHtml),
        artUrl: metaContent(documentFromHtml, 'meta[property="og:image"]'),
        digitalPrice: extractDigitalPrice(documentFromHtml),
        digitalOwnershipUrl: extractDigitalOwnershipUrl(documentFromHtml),
        isPreorder: extractReleaseIsPreorder(documentFromHtml, tralbum),
        hasBodyDescriptionSource: descriptionState.hasBodyDescriptionSource,
        description: descriptionState.description,
        descriptionHtml: descriptionState.descriptionHtml,
        tags: extractReleaseTags(documentFromHtml),
        tracks,
        supporterCount: supporterState.count,
        supporterCountIsExact: supporterState.isExact,
        supporterMoreAvailable: supporterState.moreAvailable,
        supporterNextToken: supporterState.nextToken,
        supporterItemId: supporterState.itemId,
        supporterItemType: supporterState.itemType,
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

export function normalizeReleaseData(data) {
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
        digitalPrice: cleanText(data.digitalPrice || ""),
        digitalOwnershipUrl: cleanText(data.digitalOwnershipUrl || ""),
        digitalDownloadUrl: cleanText(data.digitalDownloadUrl || ""),
        isPreorder: data.isPreorder === true,
        supporterCount: normalizeNonNegativeInteger(data.supporterCount),
        supporterCountIsExact: data.supporterCountIsExact === true,
        supporterCountLabel: cleanText(data.supporterCountLabel || ""),
        supporterCountAuthoritative:
            data.supporterCountAuthoritative === true,
        supporterMoreAvailable: data.supporterMoreAvailable === true,
        supporterNextToken: cleanText(data.supporterNextToken || ""),
        supporterItemId: normalizeNonNegativeInteger(data.supporterItemId),
        supporterItemType: normalizeSupporterItemType(data.supporterItemType),
        tags: Array.isArray(data.tags)
            ? data.tags.map((tag) => cleanText(tag)).filter(Boolean)
            : [],
        tracks,
    };
}

export function createEmptyReleaseData() {
    return {
        url: "",
        title: "",
        artist: "",
        releaseDate: "",
        location: "",
        digitalPrice: "",
        digitalOwnershipUrl: "",
        digitalDownloadUrl: "",
        isPreorder: false,
        description: "",
        descriptionHtml: "",
        tags: [],
        tracks: [],
        supporterCount: 0,
        supporterCountIsExact: false,
        supporterCountLabel: "",
        supporterCountAuthoritative: false,
        supporterMoreAvailable: false,
        supporterNextToken: "",
        supporterItemId: 0,
        supporterItemType: "",
    };
}

function extractReleaseIsPreorder(doc, tralbum) {
    if (
        tralbum &&
        tralbum.current &&
        tralbum.current.is_preorder === true
    ) {
        return true;
    }

    return Array.from(
        doc.querySelectorAll(
            ".buyItem.digital h4, .buyItem.digital .download-link, .buyItem.digital .buy-link",
        ),
    ).some((node) => /\bpre-order\b/i.test(cleanText(node.textContent || "")));
}

export async function getExactReleaseSupporterCount(releaseData, options = {}) {
    const state = normalizeReleaseSupporterState(releaseData);
    if (!state.url || !state.count) {
        return {
            count: 0,
            isExact: true,
            moreAvailable: false,
            nextToken: "",
        };
    }

    if (state.isExact || !state.moreAvailable) {
        return {
            count: state.count,
            isExact: true,
            moreAvailable: false,
            nextToken: "",
        };
    }

    const cacheKey = getReleaseSupporterCountCacheKey(state.url);
    const cached = await storageGet(cacheKey, null);
    if (!options.forceRefresh && isFreshReleaseSupporterCountCache(cached)) {
        return {
            count: normalizeNonNegativeInteger(cached.count),
            isExact: cached.isExact === true,
            moreAvailable: false,
            nextToken: "",
        };
    }

    const pending = releaseDataState.pendingSupporterCountRequests.get(cacheKey);
    if (pending) {
        return pending;
    }

    const request = enqueueSupporterCountFetch(
        async () => {
            const result = await fetchExactReleaseSupporterCount(
                state,
                options,
            );
            if (result && result.isExact) {
                await storageSet(cacheKey, {
                    count: result.count,
                    isExact: true,
                    fetchedAt: Date.now(),
                    schemaVersion: CACHE_SCHEMA_VERSION,
                });
                void trackReleaseCacheEntry(cacheKey).catch(() => {});
            }
            return result;
        },
        { priority: options.forceRefresh === true },
    );

    releaseDataState.pendingSupporterCountRequests.set(cacheKey, request);
    try {
        return await request;
    } finally {
        if (releaseDataState.pendingSupporterCountRequests.get(cacheKey) === request) {
            releaseDataState.pendingSupporterCountRequests.delete(cacheKey);
        }
    }
}

function enqueueSupporterCountFetch(task, options = {}) {
    return supporterCountFetchLimiter(task, options);
}

async function fetchExactReleaseSupporterCount(state, options = {}) {
    if (!state.itemId || !state.itemType || !state.nextToken) {
        return {
            count: state.count,
            isExact: false,
            moreAvailable: state.moreAvailable === true,
            nextToken: state.nextToken,
        };
    }

    const apiUrl = getReleaseSupporterCountApiUrl(state.url);
    if (!apiUrl) {
        return {
            count: state.count,
            isExact: false,
            moreAvailable: state.moreAvailable === true,
            nextToken: state.nextToken,
        };
    }

    const maxExactCount = options.ignoreLimit
        ? 0
        : normalizeNonNegativeInteger(CONFIG.maxSupporterExactCount);
    // Even an unbounded refresh needs a hard ceiling so a single click
    // cannot issue an unbounded number of requests, and so a server that
    // keeps reporting more_available without advancing its token cannot
    // loop forever.
    const maxPages = Math.max(
        1,
        normalizeNonNegativeInteger(CONFIG.maxSupporterRefreshPages) || 1,
    );
    let count = state.count;
    let token = state.nextToken;
    let moreAvailable = state.moreAvailable;
    let pagesFetched = 0;
    let serverReportsMore = false;

    if (maxExactCount && count >= maxExactCount) {
        return buildReleaseSupporterCountResult(count, false, {
            moreAvailable,
            nextToken: token,
        });
    }

    while (moreAvailable && token) {
        if (pagesFetched >= maxPages) {
            serverReportsMore = true;
            break;
        }

        pagesFetched += 1;
        const response = await requestReleaseSupporterCountPage(apiUrl, {
            tralbum_type: state.itemType,
            tralbum_id: state.itemId,
            token,
            count: CONFIG.supporterCountPageSize,
        });

        const results =
            response && Array.isArray(response.results)
                ? response.results
                : [];
        count += results.length;
        moreAvailable = Boolean(response && response.more_available);
        serverReportsMore = moreAvailable;

        const previousToken = token;
        const last = results[results.length - 1];
        token = cleanText(last && last.token);
        if (!results.length) {
            // An empty page that still claims more results cannot be
            // trusted as an exact total.
            moreAvailable = false;
        } else if (token && token === previousToken) {
            // The API stopped advancing its cursor, so the pages seen so
            // far are not a trustworthy complete total.
            moreAvailable = false;
            serverReportsMore = true;
        }

        if (maxExactCount && count >= maxExactCount) {
            break;
        }

        if (moreAvailable && CONFIG.supporterCountPageDelayMs > 0) {
            await waitForSupporterCountPageDelay(
                CONFIG.supporterCountPageDelayMs,
            );
        }
    }

    return buildReleaseSupporterCountResult(
        count,
        !moreAvailable && !serverReportsMore,
        {
            moreAvailable,
            nextToken: token,
        },
    );
}

async function requestReleaseSupporterCountPage(apiUrl, payload) {
    const retryCount = Math.max(
        0,
        Math.floor(Number(CONFIG.supporterCountRequestRetries) || 0),
    );
    const retryDelayMs = Math.max(
        0,
        Math.floor(Number(CONFIG.supporterCountRetryDelayMs) || 0),
    );
    let lastError = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
            return await requestJson(apiUrl, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "Content-Type": "application/json",
                },
                data: JSON.stringify(payload),
            });
        } catch (error) {
            lastError = error;
            if (attempt >= retryCount) {
                break;
            }
            await waitForSupporterCountPageDelay(
                retryDelayMs * (attempt + 1),
            );
        }
    }

    throw lastError || new Error("Supporter count request failed.");
}

function buildReleaseSupporterCountResult(count, isExact, state = {}) {
    const normalizedCount = normalizeNonNegativeInteger(count);
    const exact = isExact === true;

    return {
        count: normalizedCount,
        isExact: exact,
        moreAvailable: !exact && state.moreAvailable === true,
        nextToken: exact ? "" : cleanText(state.nextToken || ""),
    };
}

function waitForSupporterCountPageDelay(delayMs) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, delayMs));
    });
}

function isFreshReleaseSupporterCountCache(value) {
    return Boolean(
            value &&
            value.schemaVersion === CACHE_SCHEMA_VERSION &&
            value.isExact === true &&
            normalizeNonNegativeInteger(value.count) > 0 &&
            value.fetchedAt &&
            Date.now() - value.fetchedAt <
                CONFIG.supporterCountCacheTtlMs,
    );
}

function getReleaseSupporterCountApiUrl(releaseUrl) {
    try {
        const url = new URL(releaseUrl, window.location.href);
        return `${url.origin}/api/tralbumcollectors/2/thumbs`;
    } catch (_error) {
        return "";
    }
}

function normalizeReleaseSupporterState(data) {
    const normalized = normalizeReleaseData(data);
    return {
        url: normalizeReleaseUrl(normalized.url),
        count: normalizeNonNegativeInteger(normalized.supporterCount),
        isExact: normalized.supporterCountIsExact === true,
        moreAvailable: normalized.supporterMoreAvailable === true,
        nextToken: cleanText(normalized.supporterNextToken || ""),
        itemId: normalizeNonNegativeInteger(normalized.supporterItemId),
        itemType: normalizeSupporterItemType(normalized.supporterItemType),
    };
}

function extractReleaseSupporterState(doc, tralbum) {
    const collectors = parseReleaseCollectorsData(doc);
    const tralbumIdentity = getTralbumSupporterIdentity(tralbum);
    if (!collectors) {
        const domCount = countDomSupporterThumbs(doc);
        return {
            count: domCount,
            isExact: domCount > 0,
            moreAvailable: false,
            nextToken: "",
            itemId: tralbumIdentity.itemId,
            itemType: tralbumIdentity.itemType,
        };
    }

    const thumbs = Array.isArray(collectors.thumbs)
        ? collectors.thumbs
        : [];
    const reviews = Array.isArray(collectors.reviews)
        ? collectors.reviews
        : [];
    const shownReviews = Array.isArray(collectors.shown_reviews)
        ? collectors.shown_reviews
        : [];
    const supporterCount = countUniqueSupporters([
        ...thumbs,
        ...reviews,
        ...shownReviews,
    ]);
    const fallbackCount = supporterCount || countDomSupporterThumbs(doc);
    const moreAvailable = Boolean(collectors.more_thumbs_available);
    const lastThumb = thumbs[thumbs.length - 1] || null;

    return {
        count: fallbackCount,
        isExact: fallbackCount > 0 && !moreAvailable,
        moreAvailable,
        nextToken: cleanText(lastThumb && lastThumb.token),
        itemId: tralbumIdentity.itemId,
        itemType: tralbumIdentity.itemType,
    };
}

function parseReleaseCollectorsData(doc) {
    const node = doc.querySelector(
        "#collectors-data[data-blob], [data-blob*='more_thumbs_available']",
    );
    if (!node) {
        return null;
    }

    const parsed = parseJsonAttribute(node, "data-blob");
    return parsed && typeof parsed === "object" ? parsed : null;
}

function countUniqueSupporters(values) {
    const seen = new Set();
    values.forEach((value) => {
        const key = getSupporterUniqueKey(value);
        if (key) {
            seen.add(key);
        }
    });
    return seen.size;
}

function getSupporterUniqueKey(value) {
    if (!value || typeof value !== "object") {
        return "";
    }

    const fanId = normalizeNonNegativeInteger(value.fan_id || value.fanId);
    if (fanId) {
        return `fan:${fanId}`;
    }

    const username = cleanText(value.username || value.url || "");
    return username ? `user:${username.toLowerCase()}` : "";
}

function countDomSupporterThumbs(doc) {
    const deets = doc.querySelector(".deets.populated");
    if (!deets) {
        return 0;
    }

    const thumbNodes = deets.querySelectorAll(".thumb");
    if (thumbNodes.length) {
        return thumbNodes.length;
    }

    return deets.querySelectorAll("a[href*='bandcamp.com/'] img, img")
        .length;
}

function getTralbumSupporterIdentity(tralbum) {
    const current = tralbum && tralbum.current ? tralbum.current : null;
    const itemId = normalizeNonNegativeInteger(
        current && current.id ? current.id : tralbum && tralbum.id,
    );
    const itemType = normalizeSupporterItemType(
        (current && current.type) ||
            (tralbum && tralbum.item_type) ||
            (tralbum && tralbum.type) ||
            "",
    );

    return {
        itemId,
        itemType,
    };
}

export function normalizeSupporterItemType(value) {
    const type = cleanText(value || "").toLowerCase();
    if (type === "a" || type === "album") {
        return "a";
    }
    if (type === "t" || type === "track") {
        return "t";
    }
    return "";
}

function normalizeNonNegativeInteger(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        return 0;
    }
    return Math.floor(number);
}

export function resolveReleaseTitle(doc, tralbum, jsonLd) {
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

function extractDigitalPrice(doc) {
    return extractDigitalPriceFromBuyItem(doc) || "";
}

function extractDigitalOwnershipUrl(doc) {
    const directLink = doc.querySelector("a.you-own-this-link[href]");
    if (directLink && isBandcampFanProfileUrl(directLink.href)) {
        return directLink.href;
    }

    const ownedBlock = doc.querySelector(
        ".you-own-this.digital, .you-own-this",
    );
    if (!ownedBlock) {
        return "";
    }

    const link = Array.from(ownedBlock.querySelectorAll("a[href]")).find(
        (candidate) => isBandcampFanProfileUrl(candidate.href),
    );
    return link ? link.href : "";
}

function extractDigitalPriceFromBuyItem(doc) {
    const buyItem = doc.querySelector(
        ".buyItem.digital, .you-own-this.digital, a.you-own-this-link",
    );
    if (!buyItem) {
        return "";
    }

    const explicitLabel = extractExplicitDigitalPriceLabel(
        normalizedText(buyItem),
    );
    if (explicitLabel) {
        return explicitLabel;
    }

    const basePrice = cleanText(
        buyItem.querySelector(".base-text-color")?.textContent || "",
    );
    if (!basePrice) {
        return "";
    }

    const extras = Array.from(buyItem.querySelectorAll(".buyItemExtra"))
        .map((node) => cleanText(node.textContent || ""))
        .filter(Boolean);
    return normalizeDigitalPriceText([basePrice, ...extras].join(" "));
}

function extractExplicitDigitalPriceLabel(value) {
    const text = cleanText(value || "");
    if (/you own this/i.test(text)) {
        return "you own this";
    }
    if (/free download/i.test(text)) {
        return "free download";
    }
    if (/name your price/i.test(text)) {
        return "name your price";
    }

    return "";
}

function normalizeDigitalPriceText(value) {
    const explicitLabel = extractExplicitDigitalPriceLabel(value);
    if (explicitLabel) {
        return explicitLabel;
    }

    const text = cleanText(value || "")
        .replace(/\b(?:Buy|Pre-order) Digital (?:Album|Track)\b/gi, "")
        .replace(/\bDigital (?:Album|Track)\b/gi, "")
        .replace(/\bStreaming \+ Download\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!text || /^free download$/i.test(text)) {
        return text;
    }

    return text;
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
        (!cleanDescription && isLikelyTracklistHtml(normalizedHtml, tracks));

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

function needsDescriptionFormatRefresh(normalizedData) {
    if (!normalizedData || typeof normalizedData !== "object") {
        return false;
    }
    if (
        (normalizedData.description && !normalizedData.descriptionHtml) ||
        (normalizedData.descriptionHtml &&
            !/<(?:p|br|a)\b/i.test(normalizedData.descriptionHtml) &&
            /\n|https?:\/\//i.test(normalizedData.description))
    ) {
        return true;
    }

    return isLikelyTracklistDescription(normalizedData);
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

export function parseTralbumData(doc) {
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

export function createTrackData(title, trackId, streamUrl, duration, titleLink) {
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

export function rememberTracklistCacheEntry(cache, key, entry) {
    if (!cache || !key || !entry || typeof cache.set !== "function") {
        return;
    }

    cache.set(key, entry);
    const max = Math.max(
        50,
        Number(CONFIG.apiTrackCacheMaxEntries) || 500,
    );
    if (cache.size <= max) {
        return;
    }

    const ttl = Number(CONFIG.apiTrackCacheTtlMs) || 0;
    const now = Date.now();
    Array.from(cache.entries()).forEach(([cachedKey, value]) => {
        if (cache.size <= max) {
            return;
        }
        if (!value || !value.ts || (ttl && now - Number(value.ts) > ttl)) {
            cache.delete(cachedKey);
        }
    });
    while (cache.size > max) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        cache.delete(oldest);
    }
}

function getApiReleaseTralbumKey(release) {
    const bandId = Number(release && release.bandId) || 0;
    const tralbumId = Number(release && release.tralbumId) || 0;
    if (!bandId || !tralbumId) {
        return "";
    }
    const type = release.tralbumType === "t" ? "t" : "a";
    return `${type}${tralbumId}:${bandId}`;
}

export function fetchApiReleaseTracklist(release) {
    const key = getApiReleaseTralbumKey(release);
    if (!key) {
        return Promise.resolve(null);
    }

    // The tag index already downloaded this release's tracklist. Serve it
    // before honouring a backoff: a cached answer needs no request, and
    // blocking it left tag results without a tracklist while indexing was
    // cooling down.
    const cache = STATE.apiReleaseTrackCache;
    const cached = cache.get(key);
    if (
        cached &&
        Date.now() - cached.ts <
            (Number(CONFIG.apiTrackCacheTtlMs) || 0)
    ) {
        return cached.promise;
    }

    const cooldownUntil = Number(STATE.tagIndexCooldownUntil) || 0;
    if (cooldownUntil > Date.now()) {
        // We are backing off Bandcamp: do not add card-level requests.
        return Promise.resolve(null);
    }
    if (cooldownUntil) {
        STATE.tagIndexCooldownUntil = 0;
        STATE.tagIndexRateLimited = false;
    }

    const bandId = Number(release.bandId);
    const tralbumId = Number(release.tralbumId);
    const type = release.tralbumType === "t" ? "t" : "a";
    const url =
        "https://bandcamp.com/api/mobile/24/tralbum_details" +
        `?band_id=${encodeURIComponent(String(bandId))}` +
        `&tralbum_id=${encodeURIComponent(String(tralbumId))}` +
        `&tralbum_type=${encodeURIComponent(type)}`;

    // The card-level tracklist call shares the index turnstile, so a search
    // while indexing is running cannot double the request rate.
    const promise = TAG_INDEX_PACING_HOOKS.waitTurn()
        .then(() =>
            requestJson(url, {
                credentials: "include",
                headers: {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                },
            }),
        )
        .then((data) => {
            if (!data || typeof data !== "object" || data.error) {
                return null;
            }

            const tracks = (Array.isArray(data.tracks) ? data.tracks : [])
                .map((track) =>
                    createTrackData(
                        track && track.title,
                        track && track.track_id,
                        track &&
                            track.streaming_url &&
                            track.streaming_url["mp3-128"],
                        track && track.duration,
                        track && track.track_url,
                    ),
                )
                .filter(Boolean);
            if (!tracks.length) {
                return null;
            }

            return {
                tracks,
                description: cleanText(data.about || ""),
                title: cleanText(data.title || ""),
                artist: cleanText(
                    data.tralbum_artist ||
                        (data.band && data.band.name) ||
                        "",
                ),
            };
        })
        .catch((error) => {
            if (TAG_INDEX_PACING_HOOKS.isRateLimitError(error)) {
                void TAG_INDEX_PACING_HOOKS.activateCooldown("tracklist");
            }
            return null;
        });

    // Cache the promise, not the value: several cards can ask for the same
    // release (feed card + native block) and only one request goes out.
    if (cache) {
        const record = { ts: Date.now(), promise };
        rememberTracklistCacheEntry(cache, key, record);
        const forgetOnFailure = () => {
            if (cache.get(key) === record) {
                cache.delete(key);
            }
        };
        promise.then((value) => {
            if (!value) {
                forgetOnFailure();
            }
        }, forgetOnFailure);
    }
    return promise;
}
