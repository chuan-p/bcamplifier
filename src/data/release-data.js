    async function getReleaseData(releaseInput) {
        const requestContext = normalizeReleaseRequestContext(releaseInput);
        const cacheKey = getReleaseCacheKey(requestContext.releaseUrl);
        const cached = await storageGet(cacheKey, null);
        const normalizedCached =
            cached && typeof cached === "object"
                ? normalizeReleaseData(cached)
                : null;

        const freshCache = isFreshReleaseCache(cached);
        if (freshCache) {
            const shouldRefresh = shouldRefreshCachedRelease(
                cached,
                normalizedCached,
                requestContext,
                cacheKey,
            );
            if (!shouldRefresh) {
                return { data: normalizedCached, fromCache: true, stale: false };
            }
        }

        const pending = STATE.pendingReleaseRequests.get(cacheKey);
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

                await storageSet(cacheKey, cacheValue);
                if (hasPlayableTracks(cacheValue)) {
                    STATE.pageFreshTrackReleaseKeys.add(cacheKey);
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

        STATE.pendingReleaseRequests.set(cacheKey, request);
        const clearPendingRequest = () => {
            if (STATE.pendingReleaseRequests.get(cacheKey) === request) {
                STATE.pendingReleaseRequests.delete(cacheKey);
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
        return Boolean(
            requestContext &&
                requestContext.allowCachedTrackSnapshot === true &&
                rawData &&
                normalizedData &&
                isFreshReleaseCache(rawData) &&
                hasVisibleEnhancements(normalizedData) &&
                !needsSchemaRefresh(rawData, normalizedData),
        );
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
            };
        }

        return {
            releaseUrl: normalizeReleaseUrl(releaseInput || ""),
            itemId: 0,
            itemType: normalizeReleaseItemType("", releaseInput || ""),
            requirePageFreshTracks: false,
            allowCachedTrackSnapshot: false,
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

    function isBandcampReleaseUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            return Boolean(
                url.protocol === "https:" &&
                    (url.hostname === "bandcamp.com" ||
                        url.hostname.endsWith(".bandcamp.com")) &&
                    /(^|\/)(album|track)\//.test(url.pathname),
            );
        } catch (_error) {
            return false;
        }
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

    function shouldRefreshCachedRelease(
        rawData,
        normalizedData,
        requestContext,
        cacheKey,
    ) {
        return (
            needsTrackRefresh(normalizedData) ||
            needsTrackSnapshotRefresh(
                rawData,
                normalizedData,
                requestContext,
                cacheKey,
            ) ||
            needsSchemaRefresh(rawData, normalizedData) ||
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
            !STATE.pageFreshTrackReleaseKeys.has(cacheKey)
        ) {
            return true;
        }

        const ttlMs = Math.max(0, Number(CONFIG.trackCacheTtlMs) || 0);
        return ttlMs > 0 && Date.now() - Number(rawData.fetchedAt) >= ttlMs;
    }

    function hasPlayableTracks(data) {
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

    function requestHtml(url) {
        if (canUseExternalHostMethod("requestHtml")) {
            return Promise.resolve(
                getExternalHostApi().requestHtml(
                    url,
                    getHostRequestOptions({
                        credentials: "include",
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

    function requestWishlistStateHtml(url) {
        if (canUseExternalHostMethod("requestHtml")) {
            return Promise.resolve(
                getExternalHostApi().requestHtml(
                    url,
                    getHostRequestOptions({
                        credentials: "include",
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
            withCredentials: true,
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
        const supporterState = extractReleaseSupporterState(
            documentFromHtml,
            tralbum,
        );

        return {
            url: releaseUrl,
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

    function createEmptyReleaseData() {
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

    async function getExactReleaseSupporterCount(releaseData, options = {}) {
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

        const pending = STATE.pendingSupporterCountRequests.get(cacheKey);
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
                }
                return result;
            },
            { priority: options.forceRefresh === true },
        );

        STATE.pendingSupporterCountRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            if (STATE.pendingSupporterCountRequests.get(cacheKey) === request) {
                STATE.pendingSupporterCountRequests.delete(cacheKey);
            }
        }
    }

    function enqueueSupporterCountFetch(task, options = {}) {
        return new Promise((resolve, reject) => {
            const entry = { task, resolve, reject };
            if (options.priority === true) {
                STATE.supporterCountFetchQueue.unshift(entry);
            } else {
                STATE.supporterCountFetchQueue.push(entry);
            }
            drainSupporterCountFetchQueue();
        });
    }

    function drainSupporterCountFetchQueue() {
        while (
            STATE.activeSupporterCountFetchCount <
                CONFIG.maxConcurrentSupporterCountFetches &&
            STATE.supporterCountFetchQueue.length
        ) {
            const next = STATE.supporterCountFetchQueue.shift();
            if (!next || typeof next.task !== "function") {
                continue;
            }

            STATE.activeSupporterCountFetchCount += 1;
            Promise.resolve()
                .then(() => next.task())
                .then(next.resolve, next.reject)
                .finally(() => {
                    STATE.activeSupporterCountFetchCount = Math.max(
                        0,
                        STATE.activeSupporterCountFetchCount - 1,
                    );
                    drainSupporterCountFetchQueue();
                });
        }
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
        let count = state.count;
        let token = state.nextToken;
        let moreAvailable = state.moreAvailable;

        if (maxExactCount && count >= maxExactCount) {
            return buildReleaseSupporterCountResult(count, false, {
                moreAvailable,
                nextToken: token,
            });
        }

        while (moreAvailable && token) {
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

            const last = results[results.length - 1];
            token = cleanText(last && last.token);
            if (!results.length) {
                moreAvailable = false;
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

        return buildReleaseSupporterCountResult(count, !moreAvailable, {
            moreAvailable,
            nextToken: token,
        });
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

    function normalizeSupporterItemType(value) {
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
