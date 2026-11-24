import {
    createTrackData,
    rememberTracklistCacheEntry,
    requestJson,
} from "./release-data.js";
import {
    buildTagIndexItem,
    cacheReleaseTags,
    countFanTagIndexCoverage,
    fanTagIndexHasUncachedItems,
    flushReleaseTagCache,
    getCachedReleaseTags,
    getFanTagFanId,
    getTagTralbumKey,
    harvestTagsFromReleaseData,
    isFanTagIndexKindComplete,
    loadFanTagIndex,
    loadFanTagIndexStatus,
    loadReleaseTagCache,
    markTagIndexWriteFailure,
    mergeFanTagIndexItems,
    normalizeTagQuery,
    persistTagRecord,
    readFanTagPageSeed,
    refreshReleaseTagCache,
    saveFanTagIndexItems,
    saveFanTagIndexStatus,
    TAG_INDEX_VERSION,
} from "./tag-index-storage.js";
import {
    CONFIG,
    STATE,
    TAG_INDEX_COOLDOWN_KEY,
    TAG_INDEX_OWNER_KEY,
} from "../state.js";
import { createConcurrencyLimiter } from "../utils/async.js";
import { markDebugState } from "../utils/dom.js";
import { registerTagIndexPacingHooks, TAG_INDEX_UI_HOOKS } from "../utils/hooks.js";
import {
    findFanCollectionActiveGrid,
    isCurrentFanCollectionPage,
} from "../utils/page.js";
import { storageGet, storageSet } from "../utils/storage.js";
import { cleanText } from "../utils/text-format.js";
import { isBandcampFanProfileUrl, normalizeReleaseUrl } from "../utils/url.js";

export {
    getCachedReleaseTags,
    getTagTralbumKey,
    harvestTagsFromReleaseData,
    loadReleaseTagCache,
    persistTagRecord,
    saveFanTagIndexStatus,
};

// Module-private scheduler and search state (kept out of global STATE).
const runner = {
    active: false,
    scheduled: false,
    backgroundScheduled: false,
    runTimer: 0,
    retryTimer: 0,
    fetchesThisRun: 0,
    pageFetchesThisRun: 0,
    nextRequestAt: 0,
    limiter: null,
    inFlightKeys: new Set(),
    statusByKind: {},
};

const searchState = {
    listenersBound: false,
    debounceTimer: 0,
    pendingQuery: null,
    matchesByKind: { collection: [], wishlist: [] },
    signatureByKind: { collection: "", wishlist: "" },
    seqByKind: { collection: 0, wishlist: 0 },
    visibleLimitByKind: {},
    refreshTimers: {},
    progressNotifyAt: {},
    fanId: 0,
    activeCache: null,
    normCache: new WeakMap(),
};

const tagIndexStats = {
    state: "",
    items: 0,
    tagged: 0,
    resolved: 0,
    failures: 0,
    itemsComplete: false,
    pending: "",
    cooldownUntil: 0,
    cooldownSource: "",
};

const TAG_INDEX_STAT_ATTRS = {
    state: ["data-bcampx-tag-index-state", (v) => String(v || "")],
    items: ["data-bcampx-tag-index-items", (v) => Number(v) || 0],
    tagged: ["data-bcampx-tag-index-tagged", (v) => Number(v) || 0],
    resolved: ["data-bcampx-tag-index-resolved", (v) => Number(v) || 0],
    failures: ["data-bcampx-tag-index-failures", (v) => Number(v) || 0],
    itemsComplete: ["data-bcampx-tag-index-items-complete", (v) => Boolean(v)],
    pending: ["data-bcampx-tag-index-pending", (v) => String(v || "")],
    cooldownUntil: ["data-bcampx-tag-index-cooldown", (v) => Number(v) || 0],
    cooldownSource: ["data-bcampx-tag-index-cooldown-source", (v) => String(v || "")],
};

function waitTagIndexDelay(delayMs) {
    const delay = Math.max(0, Number(delayMs) || 0);
    return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function getTagIndexGapMs() {
    return Math.max(0, Number(CONFIG.tagIndexMinGapMs) || 1000);
}

export function isTagIndexRateLimitError(error) {
    const message = String((error && error.message) || error || "");
    return /HTTP\s*429|too many requests|rate.?limit/i.test(message);
}

// Minimum gap between requests keeps bursts under Bandcamp's rate limit.
export async function waitTagIndexTurn() {
    const gap = getTagIndexGapMs();
    if (!gap) {
        return;
    }

    const now = Date.now();
    const nextAt = Math.max(now, runner.nextRequestAt);
    runner.nextRequestAt = nextAt + gap;
    if (nextAt > now) {
        await waitTagIndexDelay(nextAt - now);
    }
}

function isTagIndexCoolingDown() {
    return (
        STATE.tagIndexRateLimited === true ||
        Number(STATE.tagIndexCooldownUntil) > Date.now()
    );
}

async function getTagIndexCooldown() {
    const raw = await storageGet(TAG_INDEX_COOLDOWN_KEY, null);
    if (!raw || typeof raw !== "object") {
        return { until: 0, level: 0, version: 0, source: "" };
    }
    return {
        until: Number(raw.until) || 0,
        level: Math.max(0, Math.floor(Number(raw.level) || 0)),
        version: Number(raw.version) || 0,
        source: cleanText(raw.source),
    };
}

function scheduleTagIndexCooldownRetry(until) {
    const retryAt = Number(until) || 0;
    if (!retryAt || runner.retryTimer) {
        return;
    }
    const retryIn = Math.max(10000, retryAt - Date.now() + 5000);
    runner.retryTimer = window.setTimeout(() => {
        runner.retryTimer = 0;
        void runFanTagIndexBuild({
            background: !isCurrentFanCollectionPage(),
        }).catch(() => {});
    }, Math.min(retryIn, 6 * 60 * 60 * 1000));
}

export async function activateTagIndexCooldown(source = "") {
    if (STATE.tagIndexRateLimited) {
        return Number(STATE.tagIndexCooldownUntil) || 0;
    }

    const current = await getTagIndexCooldown();
    const level = Math.min(8, current.level + 1);
    const base = Number(CONFIG.tagIndexCooldownBaseMs) || 0;
    const max = Number(CONFIG.tagIndexCooldownMaxMs) || 0;
    const wait = Math.min(max || base, base * Math.pow(2, level - 1));
    const until = Date.now() + wait;
    await storageSet(TAG_INDEX_COOLDOWN_KEY, {
        until,
        level,
        version: TAG_INDEX_VERSION,
        source: cleanText(source),
        updatedAt: Date.now(),
    });
    runner.nextRequestAt = 0;
    STATE.tagIndexRateLimited = true;
    STATE.tagIndexCooldownUntil = until;
    updateTagIndexStats({ cooldownUntil: until, cooldownSource: source });
    setTagIndexState("cooldown");
    scheduleTagIndexCooldownRetry(until);
    return until;
}

async function clearTagIndexCooldown() {
    const current = await getTagIndexCooldown();
    if (!current.level && !current.until) {
        return;
    }
    await storageSet(TAG_INDEX_COOLDOWN_KEY, {
        until: 0,
        level: 0,
        version: TAG_INDEX_VERSION,
        updatedAt: Date.now(),
    });
    updateTagIndexStats({ cooldownUntil: 0, cooldownSource: "" });
    publishTagIndexSummary();
}

function isTagIndexFailureBackedOff(index, key) {
    const failedAt = Number(index && index.failures && index.failures[key]);
    return (
        Boolean(failedAt) &&
        Date.now() - failedAt < (Number(CONFIG.tagIndexFailureBackoffMs) || 0)
    );
}

async function fetchFanCollectionItemsPage(fanId, kind, token) {
    const endpoint = kind === "wishlist" ? "wishlist_items" : "collection_items";
    const response = await requestJson(
        `https://bandcamp.com/api/fancollection/1/${endpoint}`,
        {
            method: "POST",
            credentials: "include",
            data: JSON.stringify({
                fan_id: fanId,
                older_than_token: cleanText(token),
                // Collection derives last_token from item 20 regardless of count.
                count: kind === "wishlist" ? 100 : 20,
            }),
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
        },
    );
    if (!response || typeof response !== "object" || response.error) {
        throw new Error("Bandcamp collection item request failed.");
    }

    const items = [];
    for (const entry of Array.isArray(response.items) ? response.items : []) {
        const item = buildTagIndexItem(entry);
        if (item) {
            items.push(item);
        }
    }
    return {
        items,
        token: cleanText(response.last_token),
        moreAvailable: response.more_available === true,
    };
}

async function fetchReleaseTagsFromBandcamp(item) {
    if (!item || !item.bandId || !item.tralbumId) {
        return null;
    }

    const type = item.tralbumType === "t" ? "t" : "a";
    const url =
        "https://bandcamp.com/api/mobile/24/tralbum_details" +
        `?band_id=${encodeURIComponent(String(item.bandId))}` +
        `&tralbum_id=${encodeURIComponent(String(item.tralbumId))}` +
        `&tralbum_type=${encodeURIComponent(type)}`;
    const data = await requestJson(url, {
        credentials: "include",
        headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
        },
    });
    if (!data || typeof data !== "object" || data.error) {
        return null;
    }

    const tags = [];
    for (const tag of Array.isArray(data.tags) ? data.tags : []) {
        const name = cleanText(tag && tag.name);
        if (name && !/^tags?$/i.test(name) && !tags.includes(name)) {
            tags.push(name);
        }
    }

    // Reuse the mobile API tracklist so newly indexed tag results do not
    // have to re-fetch tracks when rendered.
    const tracks = (Array.isArray(data.tracks) ? data.tracks : [])
        .map((track) =>
            createTrackData(
                track && track.title,
                track && track.track_id,
                track && track.streaming_url && track.streaming_url["mp3-128"],
                track && track.duration,
                track && track.track_url,
            ),
        )
        .filter(Boolean);
    if (tracks.length) {
        rememberTracklistCacheEntry(
            STATE.apiReleaseTrackCache,
            `${type}${item.tralbumId}:${item.bandId}`,
            {
                ts: Date.now(),
                promise: Promise.resolve({
                    tracks,
                    description: cleanText(data.about || ""),
                    title: cleanText(data.title || ""),
                    artist: cleanText(
                        data.tralbum_artist ||
                            (data.band && data.band.name) ||
                            "",
                    ),
                }),
            },
        );
    }

    return tags;
}

function getTagIndexRequestLimiter() {
    if (!runner.limiter) {
        runner.limiter = createConcurrencyLimiter(
            () => CONFIG.tagIndexFetchConcurrency,
        );
    }
    return runner.limiter;
}

function hasTagIndexFetchBudget() {
    const budget = Math.max(
        0,
        Math.floor(Number(CONFIG.tagIndexFetchesPerRun) || 0),
    );
    return !budget || runner.fetchesThisRun < budget;
}

function takeTagIndexFetchSlot() {
    if (!hasTagIndexFetchBudget()) {
        return false;
    }
    runner.fetchesThisRun += 1;
    return true;
}

function hasTagIndexPageBudget() {
    const budget = Math.max(
        0,
        Math.floor(Number(CONFIG.tagIndexPageFetchesPerRun) || 0),
    );
    return !budget || runner.pageFetchesThisRun < budget;
}

function takeTagIndexPageSlot() {
    if (!hasTagIndexPageBudget()) {
        return false;
    }
    runner.pageFetchesThisRun += 1;
    return true;
}

// Unified collection/wishlist page walker used for both full refreshes and
// incremental recent-item catchups.
async function walkFanCollectionPages(fanId, kind, index, seed, mode) {
    const isRecent = mode === "recent";
    const resumed = !isRecent && Boolean(cleanText(index.token));
    const resumedWithSeen =
        resumed &&
        Array.isArray(index.refreshSeen) &&
        index.refreshSeen.length > 0;
    const knownOrSeen = isRecent
        ? new Set(index.items.map((item) => item.id))
        : new Set(
              resumed && Array.isArray(index.refreshSeen)
                  ? index.refreshSeen
                  : [],
          );

    if (!isRecent) {
        if (seed && seed.items.length) {
            seed.items.forEach((item) => knownOrSeen.add(item.id));
            if (mergeFanTagIndexItems(index, seed.items)) {
                markFanTagIndexDirty(fanId, kind, index, true);
            }
        }
        index.refreshSeen = Array.from(knownOrSeen);
    }

    let token = isRecent
        ? cleanText(seed && seed.token)
        : cleanText(index.token) || cleanText(seed && seed.token);
    if (isRecent && !token) {
        return false;
    }

    const expected = Math.max(
        0,
        Number(seed && seed.count) || 0,
        (seed && seed.items && seed.items.length) || 0,
    );
    const pageBudget = Math.min(
        Number(CONFIG.tagIndexMaxPages) || 0,
        Number(CONFIG.tagIndexPagesPerRun) || 0,
    );

    let enumeratedToEnd = !isRecent && !cleanText(seed && seed.token);
    let pages = 0;
    let completed = false;
    let connected = false;
    let added = 0;

    while (token && pages < pageBudget) {
        pages += 1;
        if (isTagIndexCoolingDown() || !takeTagIndexPageSlot()) {
            if (!isRecent) {
                index.itemsUpdatedAt = 0;
                markFanTagIndexDirty(fanId, kind, index, true);
                await flushTagIndexWrites();
                publishFanTagIndexDebug(fanId);
            }
            return false;
        }

        let page = null;
        try {
            await waitTagIndexTurn();
            page = await fetchFanCollectionItemsPage(fanId, kind, token);
        } catch (error) {
            if (!isRecent) {
                index.itemsUpdatedAt = 0;
                markFanTagIndexDirty(fanId, kind, index, true);
                await flushTagIndexWrites();
            }
            if (isTagIndexRateLimitError(error)) {
                await activateTagIndexCooldown("items");
            }
            if (!isRecent) {
                publishFanTagIndexDebug(fanId);
            }
            return false;
        }

        const allKnown =
            isRecent &&
            page.items.length > 0 &&
            page.items.every((item) => knownOrSeen.has(item.id));
        const previousLength = index.items.length;
        mergeFanTagIndexItems(index, page.items);
        added += index.items.length - previousLength;
        page.items.forEach((item) => knownOrSeen.add(item.id));
        if (!isRecent) {
            index.refreshSeen = Array.from(knownOrSeen);
        } else {
            index.itemsUpdatedAt = Date.now();
        }
        markFanTagIndexDirty(fanId, kind, index, true);

        if (allKnown) {
            connected = true;
            break;
        }
        if (!page.moreAvailable) {
            enumeratedToEnd = true;
            completed = true;
            break;
        }

        const nextToken = cleanText(page.token);
        if (!nextToken || nextToken === token) {
            if (!isRecent) {
                markDebugState("data-bcampx-tag-index-stuck", kind);
                completed = false;
                token = "";
            }
            break;
        }
        token = nextToken;
        if (!isRecent) {
            index.token = token;
        }
        await waitTagIndexDelay(CONFIG.tagIndexPagePauseMs);
    }

    if (isRecent) {
        if (!connected && !completed) {
            return false;
        }
        index.itemsComplete = true;
        index.token = "";
        await flushTagIndexWrites();
        markDebugState("data-bcampx-tag-index-recent-added", String(added));
        return true;
    }

    if (!completed && token) {
        index.token = token;
    } else if (!completed && expected > 0 && index.items.length >= expected) {
        completed = true;
    } else if (!completed) {
        index.token = "";
    }

    if (completed) {
        const canPrune =
            enumeratedToEnd &&
            (!resumed || resumedWithSeen) &&
            knownOrSeen.size > 0;
        if (canPrune && index.items.length) {
            index.items = index.items.filter((item) => knownOrSeen.has(item.id));
        }
        index.itemsComplete = true;
        index.token = "";
        index.refreshSeen = [];
    } else {
        index.itemsComplete = false;
    }

    index.itemsUpdatedAt = Date.now();
    markFanTagIndexDirty(fanId, kind, index, true);
    await flushTagIndexWrites();
    updateTagIndexStats({ itemsComplete: index.itemsComplete === true });
    publishFanTagIndexDebug(fanId);
    return true;
}

function updateTagIndexStats(patch) {
    if (!patch || typeof patch !== "object") {
        return;
    }
    for (const [key, value] of Object.entries(patch)) {
        const spec = TAG_INDEX_STAT_ATTRS[key];
        if (!spec) {
            continue;
        }
        const normalized = spec[1](value);
        tagIndexStats[key] = normalized;
        markDebugState(spec[0], String(normalized));
    }
}

function exposeFanTagIndexDebugHook() {
    if (typeof globalThis !== "object") {
        return;
    }

    globalThis.__bcampxTagIndexState = function () {
        const seed = readFanTagPageSeed();
        return {
            state: tagIndexStats.state,
            items: tagIndexStats.items,
            tagged: tagIndexStats.tagged,
            resolved: tagIndexStats.resolved,
            failures: tagIndexStats.failures,
            itemsComplete: tagIndexStats.itemsComplete,
            pending: tagIndexStats.pending,
            cooldownUntil: tagIndexStats.cooldownUntil,
            owner: TAG_INDEX_UI_HOOKS.isProfileOwner(),
            fanId: getFanTagFanId(),
            seed: seed
                ? {
                      collection:
                          (seed.kinds.collection && seed.kinds.collection.count) ||
                          0,
                      wishlist:
                          (seed.kinds.wishlist && seed.kinds.wishlist.count) || 0,
                  }
                : null,
        };
    };
}

export function getTagIndexProgress() {
    return {
        items: tagIndexStats.items,
        tagged: tagIndexStats.tagged,
        resolved: tagIndexStats.resolved,
        state: tagIndexStats.state,
    };
}

function publishTagIndexSummary(extra = {}) {
    const { items, resolved, itemsComplete } = tagIndexStats;
    const tagsComplete = items > 0 && resolved >= items;
    markDebugState(
        "data-bcampx-tag-index",
        JSON.stringify({
            state: extra.state || tagIndexStats.state,
            items,
            tagged: tagIndexStats.tagged,
            resolved,
            failures: tagIndexStats.failures,
            itemsComplete,
            tagsComplete,
            complete: itemsComplete && tagsComplete,
            pending: tagIndexStats.pending,
            cooldownUntil: tagIndexStats.cooldownUntil,
            cooldownSource: tagIndexStats.cooldownSource,
            gapMs: getTagIndexGapMs(),
        }),
    );
}

function setTagIndexState(state) {
    updateTagIndexStats({ state });
    publishTagIndexSummary({ state });
}

function publishStoredTagIndexStats(statuses) {
    let items = 0;
    let tagged = 0;
    let resolved = 0;
    let failures = 0;
    let complete = statuses.length > 0;
    for (const status of statuses) {
        items += Number(status && status.itemsCount) || 0;
        tagged += Number(status && status.taggedCount) || 0;
        resolved += Number(status && status.resolvedCount) || 0;
        failures += Object.keys((status && status.failures) || {}).length;
        if (!status || status.itemsComplete !== true) {
            complete = false;
        }
    }
    updateTagIndexStats({
        items,
        tagged,
        resolved,
        failures,
        itemsComplete: complete,
    });
    TAG_INDEX_UI_HOOKS.refreshProgress();
    publishTagIndexSummary();
    return { items, tagged, complete };
}

function publishFanTagIndexDebug(fanId) {
    if (!fanId) {
        return;
    }

    let items = 0;
    let tagged = 0;
    let resolved = 0;
    let failures = 0;
    for (const kind of ["collection", "wishlist"]) {
        const key = `${fanId}:${kind}`;
        const index = STATE.fanTagIndexCache && STATE.fanTagIndexCache.get(key);
        if (index && Array.isArray(index.items)) {
            const cov = countFanTagIndexCoverage(index);
            items += cov.itemsCount;
            tagged += cov.taggedCount;
            resolved += cov.resolvedCount;
            failures += Object.keys(index.failures || {}).length;
            continue;
        }

        const status = runner.statusByKind[key];
        items += Number(status && status.itemsCount) || 0;
        tagged += Number(status && status.taggedCount) || 0;
        resolved += Number(status && status.resolvedCount) || 0;
        failures += Object.keys((status && status.failures) || {}).length;
    }
    updateTagIndexStats({ items, tagged, resolved, failures });
    TAG_INDEX_UI_HOOKS.refreshProgress();
    publishTagIndexSummary();
}

function notifyFanTagSearchIndexProgress(fanId, kind) {
    const query = cleanText(STATE.tagSearchQueryByKind[kind] || "");
    if (!query || String(searchState.fanId) !== String(fanId)) {
        return;
    }

    const stampKey = `${fanId}:${kind}`;
    const now = Date.now();
    if (
        searchState.progressNotifyAt[stampKey] &&
        now - searchState.progressNotifyAt[stampKey] < 3000
    ) {
        return;
    }
    searchState.progressNotifyAt[stampKey] = now;
    scheduleFanTagSearchRefresh(kind, 400);
}

export function markFanTagIndexDirty(fanId, kind, index, itemsChanged) {
    if (!fanId || !kind || !index) {
        return;
    }

    const key = `${fanId}:${kind}`;
    const existing = STATE.tagIndexDirty.get(key);
    STATE.tagIndexDirty.set(key, {
        fanId,
        kind,
        index,
        itemsChanged:
            Boolean(existing && existing.itemsChanged) || itemsChanged === true,
    });
}

export async function flushTagIndexWrites() {
    try {
        await loadReleaseTagCache();
    } catch (error) {
        markTagIndexWriteFailure(error);
        return;
    }

    const pending = STATE.tagIndexDirty.size
        ? Array.from(STATE.tagIndexDirty.values())
        : [];
    STATE.tagIndexDirty.clear();

    try {
        await flushReleaseTagCache();
    } catch (error) {
        markTagIndexWriteFailure(error);
    }
    if (!pending.length) {
        return;
    }

    for (const entry of pending) {
        try {
            const itemsSaved = entry.itemsChanged
                ? await saveFanTagIndexItems(
                      entry.fanId,
                      entry.kind,
                      entry.index,
                  )
                : true;
            const statusSaved = await saveFanTagIndexStatus(
                entry.fanId,
                entry.kind,
                entry.index,
            );
            if (itemsSaved === false || statusSaved === false) {
                markTagIndexWriteFailure(
                    new Error(
                        "the browser refused the write (storage full or unavailable)",
                    ),
                );
            }
        } catch (error) {
            markTagIndexWriteFailure(error);
        }
    }
}

async function fillFanTagIndexTags(fanId, kind, index) {
    await loadReleaseTagCache();
    if (isTagIndexCoolingDown()) {
        return;
    }

    const pending = [];
    const pendingKeys = new Set();
    for (const item of index.items) {
        const key = getTagTralbumKey(item.tralbumType, item.tralbumId);
        if (
            !key ||
            pendingKeys.has(key) ||
            getCachedReleaseTags(key) ||
            isTagIndexFailureBackedOff(index, key)
        ) {
            continue;
        }
        pendingKeys.add(key);
        pending.push({ item, key });
    }
    if (!pending.length) {
        return;
    }

    const limit = getTagIndexRequestLimiter();
    const sliceSize = Math.max(
        12,
        Math.floor(Number(CONFIG.tagIndexFetchConcurrency) || 1) * 8,
    );
    let completed = 0;
    let failures = 0;
    const runState = { aborted: false };

    for (let offset = 0; offset < pending.length; offset += sliceSize) {
        if (
            runState.aborted ||
            !CONFIG.enableTagSearch ||
            !hasTagIndexFetchBudget() ||
            isTagIndexCoolingDown()
        ) {
            break;
        }

        const slice = pending.slice(offset, offset + sliceSize);
        const results = await Promise.all(
            slice.map(async (entry) => {
                if (
                    runState.aborted ||
                    !CONFIG.enableTagSearch ||
                    !hasTagIndexFetchBudget() ||
                    isTagIndexCoolingDown()
                ) {
                    return null;
                }
                await waitTagIndexTurn();
                if (
                    runState.aborted ||
                    !takeTagIndexFetchSlot() ||
                    isTagIndexCoolingDown() ||
                    runner.inFlightKeys.has(entry.key)
                ) {
                    return null;
                }
                runner.inFlightKeys.add(entry.key);
                try {
                    const tags = await limit(() =>
                        fetchReleaseTagsFromBandcamp(entry.item),
                    );
                    return { entry, tags };
                } catch (error) {
                    const rateLimited = isTagIndexRateLimitError(error);
                    if (rateLimited) {
                        runState.aborted = true;
                    }
                    return { entry, tags: null, rateLimited };
                } finally {
                    runner.inFlightKeys.delete(entry.key);
                }
            }),
        );

        let rateLimited = false;
        for (const result of results) {
            if (!result) {
                continue;
            }
            if (result.rateLimited) {
                rateLimited = true;
                runState.aborted = true;
                continue;
            }
            if (Array.isArray(result.tags)) {
                cacheReleaseTags(result.entry.key, result.tags);
                delete index.failures[result.entry.key];
                completed += 1;
                continue;
            }
            failures += 1;
            index.failures[result.entry.key] = Date.now();
            if (failures >= 8) {
                runState.aborted = true;
            }
        }

        if (completed) {
            markFanTagIndexDirty(fanId, kind, index, false);
            publishFanTagIndexDebug(fanId);
            notifyFanTagSearchIndexProgress(fanId, kind);
        }
        if (rateLimited) {
            await activateTagIndexCooldown("tags");
            break;
        }
    }

    markFanTagIndexDirty(fanId, kind, index, false);
    await flushTagIndexWrites();
}

async function buildFanTagIndexForKind(seed, kind) {
    const kindSeed = seed.kinds[kind];
    if (!kindSeed) {
        return { items: 0, tagged: 0 };
    }

    if (!kindSeed.count) {
        if (!kindSeed.hasData) {
            return { items: 0, tagged: 0 };
        }
        const index = await loadFanTagIndex(seed.fanId, kind);
        const hadItems = index.items.length > 0;
        index.items = [];
        index.token = "";
        index.itemsComplete = true;
        index.itemsUpdatedAt = Date.now();
        index.failures = {};
        index.refreshSeen = [];
        await saveFanTagIndexItems(seed.fanId, kind, index);
        await saveFanTagIndexStatus(seed.fanId, kind, index);
        if (hadItems) {
            markDebugState("data-bcampx-tag-index-emptied", kind);
        }
        return { items: 0, tagged: 0, itemsComplete: true };
    }

    const index = await loadFanTagIndex(seed.fanId, kind);
    const itemsStale =
        !index.itemsComplete ||
        !index.itemsUpdatedAt ||
        Date.now() - index.itemsUpdatedAt >
            (Number(CONFIG.tagIndexItemsTtlMs) || 0);
    if (itemsStale && hasTagIndexPageBudget()) {
        const refreshed = await walkFanCollectionPages(
            seed.fanId,
            kind,
            index,
            kindSeed,
            "full",
        );
        if (refreshed === false && isTagIndexCoolingDown()) {
            markFanTagIndexDirty(seed.fanId, kind, index, true);
            await flushTagIndexWrites();
            const cov = countFanTagIndexCoverage(index);
            return {
                items: cov.itemsCount,
                tagged: cov.taggedCount,
                itemsComplete: index.itemsComplete === true,
            };
        }
    } else if (
        kindSeed.items.length &&
        mergeFanTagIndexItems(index, kindSeed.items)
    ) {
        markFanTagIndexDirty(seed.fanId, kind, index, true);
    }

    const expectedCount = Math.max(
        Number(kindSeed.count) || 0,
        kindSeed.items.length,
    );
    if (
        index.itemsComplete &&
        expectedCount > index.items.length &&
        kindSeed.token &&
        hasTagIndexPageBudget()
    ) {
        await walkFanCollectionPages(seed.fanId, kind, index, kindSeed, "recent");
    }

    await fillFanTagIndexTags(seed.fanId, kind, index);
    const cov = countFanTagIndexCoverage(index);
    return {
        items: cov.itemsCount,
        tagged: cov.taggedCount,
        itemsComplete: index.itemsComplete === true,
    };
}

async function runFanTagIndexBuild(options = {}) {
    const background = options.background === true;
    if (runner.active) {
        return;
    }
    if (!CONFIG.enableTagSearch) {
        setTagIndexState("disabled");
        return;
    }

    let fanId = 0;
    let kinds = [];
    let seed = null;
    if (background) {
        if (window.top !== window || isCurrentFanCollectionPage()) {
            return;
        }
        fanId = Number(await storageGet(TAG_INDEX_OWNER_KEY, 0).catch(() => 0)) || 0;
        if (!fanId) {
            return;
        }
        kinds = ["collection", "wishlist"];
    } else {
        if (!TAG_INDEX_UI_HOOKS.isProfileOwner()) {
            setTagIndexState("skipped-owner");
            return;
        }
        seed = readFanTagPageSeed({ includeDom: true });
        if (!seed) {
            setTagIndexState("skipped-page");
            return;
        }
        fanId = seed.fanId;
        kinds = ["collection", "wishlist"].filter((kind) => {
            const kindSeed = seed.kinds[kind];
            return Boolean(kindSeed && (kindSeed.count > 0 || kindSeed.hasData));
        });
        if (!kinds.length) {
            setTagIndexState("skipped-empty");
            return;
        }
        const seedIds = {};
        for (const kind of kinds) {
            seedIds[`${fanId}:${kind}`] = (seed.kinds[kind].items || [])
                .map((item) => String(item.id))
                .join(",");
        }
        STATE.tagIndexSeedIds = seedIds;
    }

    const cooldown = await getTagIndexCooldown();
    let activeCooldownUntil = Number(cooldown.until) || 0;
    if (cooldown.version !== TAG_INDEX_VERSION) {
        await clearTagIndexCooldown();
        activeCooldownUntil = 0;
        STATE.tagIndexCooldownUntil = 0;
        STATE.tagIndexRateLimited = false;
    } else {
        STATE.tagIndexCooldownUntil = activeCooldownUntil;
    }

    const statuses = await Promise.all(
        kinds.map((kind) => loadFanTagIndexStatus(fanId, kind).catch(() => null)),
    );
    kinds.forEach((kind, position) => {
        runner.statusByKind[`${fanId}:${kind}`] = statuses[position];
    });

    let pendingKinds = kinds.filter((kind, position) => {
        const status = statuses[position];
        if (background) {
            const items = Number(status && status.itemsCount) || 0;
            return (
                Boolean(status && status.itemsComplete === true) &&
                items > 0 &&
                (Number(status.resolvedCount) || 0) < items
            );
        }
        return !isFanTagIndexKindComplete(
            seed.kinds[kind],
            status,
            STATE.tagIndexSeedIds[`${fanId}:${kind}`],
        );
    });

    if (!pendingKinds.length) {
        await loadReleaseTagCache();
        for (const kind of kinds) {
            const status = statuses[kinds.indexOf(kind)];
            if (!status || status.itemsComplete !== true) {
                continue;
            }
            const index = await loadFanTagIndex(fanId, kind);
            if (
                !index ||
                !Array.isArray(index.items) ||
                !index.items.length ||
                fanTagIndexHasUncachedItems(index)
            ) {
                pendingKinds = [kind];
                markDebugState("data-bcampx-tag-index-repair", kind);
                break;
            }
        }
    }

    if (!background) {
        updateTagIndexStats({ pending: pendingKinds.join(",") });
        publishStoredTagIndexStats(statuses);
    }
    if (!pendingKinds.length) {
        setTagIndexState("up-to-date");
        return;
    }
    if (activeCooldownUntil > Date.now()) {
        STATE.tagIndexCooldownUntil = activeCooldownUntil;
        updateTagIndexStats({
            cooldownUntil: activeCooldownUntil,
            cooldownSource: cooldown.source || "",
        });
        setTagIndexState("cooling-down");
        scheduleTagIndexCooldownRetry(activeCooldownUntil);
        return;
    }
    STATE.tagIndexRateLimited = false;

    if (!background) {
        await storageSet(TAG_INDEX_OWNER_KEY, fanId).catch(() => {});
    }

    runner.active = true;
    setTagIndexState("running");
    try {
        const results = await Promise.all(
            pendingKinds.map((kind) => {
                const work = background
                    ? loadFanTagIndex(fanId, kind).then(async (index) => {
                          await fillFanTagIndexTags(fanId, kind, index);
                          const cov = countFanTagIndexCoverage(index);
                          return {
                              items: cov.itemsCount,
                              tagged: cov.taggedCount,
                              itemsComplete: index.itemsComplete === true,
                          };
                      })
                    : buildFanTagIndexForKind(seed, kind);
                return work.catch((error) => {
                    markDebugState(
                        "data-bcampx-tag-index-error",
                        cleanText(error && error.message).slice(0, 140),
                    );
                    return { items: 0, tagged: 0, itemsComplete: false };
                });
            }),
        );

        if (background) {
            publishFanTagIndexDebug(fanId);
        } else {
            let totalItems = 0;
            let totalTagged = 0;
            let allComplete = true;
            kinds.forEach((kind, position) => {
                const pendingIndex = pendingKinds.indexOf(kind);
                if (pendingIndex >= 0) {
                    const result = results[pendingIndex];
                    totalItems += result.items || 0;
                    totalTagged += result.tagged || 0;
                    if (!result.itemsComplete) {
                        allComplete = false;
                    }
                    return;
                }
                const status = statuses[position];
                totalItems += Number(status && status.itemsCount) || 0;
                totalTagged += Number(status && status.taggedCount) || 0;
                if (!status || status.itemsComplete !== true) {
                    allComplete = false;
                }
            });
            updateTagIndexStats({
                items: totalItems,
                tagged: totalTagged,
                itemsComplete: allComplete,
            });
        }

        if (STATE.tagIndexRateLimited) {
            setTagIndexState("cooldown");
        } else {
            publishTagIndexSummary({ state: "filled" });
            setTagIndexState("filled");
            await clearTagIndexCooldown();
        }
    } finally {
        try {
            await flushTagIndexWrites();
        } finally {
            runner.active = false;
        }
    }
}

function scheduleFanTagIndexRun(delayMs, options = {}) {
    const background = options.background === true;
    if (!CONFIG.enableTagSearch || !hasTagIndexFetchBudget()) {
        return;
    }
    if (background) {
        if (
            runner.backgroundScheduled ||
            isCurrentFanCollectionPage() ||
            window.top !== window
        ) {
            return;
        }
        runner.backgroundScheduled = true;
    } else {
        if (runner.scheduled) {
            return;
        }
        runner.scheduled = true;
        setTagIndexState("scheduled");
    }

    const timer = window.setTimeout(() => {
        if (background) {
            runner.backgroundScheduled = false;
        } else {
            runner.runTimer = 0;
        }
        void runFanTagIndexBuild({ background })
            .catch(() => {})
            .finally(() => {
                if (!background) {
                    runner.scheduled = false;
                }
            });
    }, Math.max(0, Number(delayMs) || 0));

    if (!background) {
        runner.runTimer = timer;
    }
}

export function scheduleFanTagBackgroundFill() {
    scheduleFanTagIndexRun(
        Math.max(5000, Number(CONFIG.tagIndexBackgroundStartDelayMs) || 15000),
        { background: true },
    );
}

function getNormalizedTagList(tags) {
    if (!Array.isArray(tags) || !tags.length) {
        return [];
    }
    const cached = searchState.normCache.get(tags);
    if (cached && cached.length === tags.length) {
        return cached;
    }
    const normalized = tags.map((tag) => normalizeTagQuery(tag));
    searchState.normCache.set(tags, normalized);
    return normalized;
}

async function findFanTagSearchMatches(fanId, kind, query) {
    const normalized = normalizeTagQuery(query);
    const tokens = normalized.split(" ").filter(Boolean);
    if (!fanId || !kind || !tokens.length) {
        return [];
    }

    const index = await loadFanTagIndex(fanId, kind);
    await loadReleaseTagCache();

    const matches = [];
    for (const item of index.items) {
        const tags = getCachedReleaseTags(
            getTagTralbumKey(item.tralbumType, item.tralbumId),
        );
        if (!tags || !tags.length) {
            continue;
        }
        const normalizedTags = getNormalizedTagList(tags);
        const hits = [];
        let allMatched = true;
        for (const token of tokens) {
            const tagIndex = normalizedTags.findIndex((tag) =>
                tag.includes(token),
            );
            if (tagIndex < 0) {
                allMatched = false;
                break;
            }
            if (!hits.includes(tags[tagIndex])) {
                hits.push(tags[tagIndex]);
            }
        }
        if (allMatched) {
            matches.push({
                item,
                tags: hits,
                exact: normalizedTags.includes(normalized),
            });
        }
    }

    matches.sort((left, right) => Number(right.exact) - Number(left.exact));
    return matches.slice(
        0,
        Math.max(1, Number(CONFIG.maxTagSearchMatches) || 1),
    );
}

function getFanSearchGridKind(grid) {
    const gridId = cleanText(grid && grid.closest(".grid") && grid.closest(".grid").id);
    if (gridId === "wishlist-search-grid") {
        return "wishlist";
    }
    if (gridId === "collection-search-grid") {
        return "collection";
    }
    return "";
}

function getActiveFanTagSearchState() {
    if (!CONFIG.enableTagSearch) {
        return null;
    }
    if (
        !cleanText(STATE.tagSearchQueryByKind.collection) &&
        !cleanText(STATE.tagSearchQueryByKind.wishlist)
    ) {
        return null;
    }

    const grid = findFanCollectionActiveGrid();
    const kind = getFanSearchGridKind(grid);
    if (!kind) {
        return null;
    }

    const query = cleanText(STATE.tagSearchQueryByKind[kind] || "");
    const matches = searchState.matchesByKind[kind] || [];
    if (!query || !matches.length) {
        return null;
    }

    const cached = searchState.activeCache;
    const now = Date.now();
    if (
        cached &&
        cached.grid === grid &&
        cached.kind === kind &&
        cached.query === query &&
        cached.matches === matches &&
        now - cached.at < 100
    ) {
        return cached;
    }

    const state = {
        kind,
        query,
        matches,
        grid,
        nativeItems: getFanTagSearchNativeItems(kind),
        at: now,
    };
    searchState.activeCache = state;
    return state;
}

function buildFanTagSearchRelease(match, feedKind) {
    const item = match && match.item;
    if (!item || !item.url) {
        return null;
    }
    return {
        releaseUrl: item.url,
        title: item.title,
        artist: item.artist,
        artUrl: item.art,
        itemId: item.id,
        itemType: item.type || "album",
        bandId: item.bandId,
        tralbumId: Number(item.tralbumId) || 0,
        tralbumType: cleanText(item.tralbumType || "").toLowerCase(),
        feedKind,
        ownFanCollection: false,
        sourceItem: null,
        gridItem: null,
        featuredItem: null,
        playerData: null,
        initialData: null,
        tagSearch: true,
        tagOrigin: "index",
    };
}

function getFanTagSearchNativeItems(kind) {
    const root = document.querySelector(
        kind === "wishlist"
            ? "#wishlist-items, #wishlist-grid"
            : "#collection-items, #collection-grid",
    );
    const items = new Map();
    if (!root) {
        return items;
    }
    root.querySelectorAll("li.collection-item-container[data-itemid]").forEach(
        (node) => {
            const id = cleanText(node.getAttribute("data-itemid"));
            if (id && !items.has(id)) {
                items.set(id, node);
            }
        },
    );
    return items;
}

function collectFanTagSearchReleases(active, feedKind, filters = {}) {
    const releases = [];
    const seenUrls = new Set();
    if (!active) {
        return releases;
    }

    const nativeItems =
        active.nativeItems || getFanTagSearchNativeItems(active.kind);
    const skipUrls = filters.skipUrls || null;
    const skipItems = filters.skipItems || null;

    for (const match of active.matches) {
        const item = match && match.item;
        if (!item) {
            continue;
        }
        const itemUrl = item.url || "";
        const itemKey = `${item.type || "album"}:${item.id || ""}`;
        if (
            (skipUrls && itemUrl && skipUrls.has(itemUrl)) ||
            (skipItems && skipItems.has(itemKey)) ||
            (itemUrl && seenUrls.has(itemUrl))
        ) {
            continue;
        }

        const nativeItem = nativeItems.get(String(item.id));
        const release = nativeItem
            ? TAG_INDEX_UI_HOOKS.buildNativeRelease(nativeItem, feedKind)
            : buildFanTagSearchRelease(match, feedKind);
        if (!release) {
            continue;
        }

        const releaseUrl =
            release.tagOrigin === "native"
                ? normalizeReleaseUrl(release.releaseUrl || "")
                : cleanText(release.releaseUrl || "");
        if (
            releaseUrl &&
            ((skipUrls && skipUrls.has(releaseUrl)) || seenUrls.has(releaseUrl))
        ) {
            continue;
        }
        if (releaseUrl) {
            seenUrls.add(releaseUrl);
        }
        releases.push(release);
    }

    return releases;
}

function getFanTagSearchVisibleLimit(kind) {
    const initial = Math.max(1, Number(CONFIG.tagSearchInitialResults) || 80);
    return Math.max(initial, Number(searchState.visibleLimitByKind[kind]) || initial);
}

export function updateFanTagSearchMoreControl(list, feedContext) {
    if (!(list instanceof Element)) {
        return;
    }
    const existing = list.querySelector(".bcampx-label-feed__more");
    if (existing) {
        existing.remove();
    }
    const active = getActiveFanTagSearchState();
    if (!active || !feedContext || cleanText(feedContext.kind) !== `fan-${active.kind}`) {
        return;
    }
    const total = active.matches.length;
    const visible = getFanTagSearchVisibleLimit(active.kind);
    if (total <= visible) {
        return;
    }
    const shown = list.querySelectorAll(
        '.bcampx-label-feed-card[data-bcampx-tag-source="tags"]',
    ).length;
    const wrap = document.createElement("div");
    wrap.className = "bcampx-label-feed__more";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bcampx-label-feed__more-button";
    button.textContent = `Show more tag matches (${shown} of ${total})`;
    button.addEventListener("click", () => {
        searchState.visibleLimitByKind[active.kind] =
            visible + (Number(CONFIG.tagSearchInitialResults) || 80);
        TAG_INDEX_UI_HOOKS.scheduleFeedSync();
    });
    wrap.append(button);
    list.append(wrap);
}

export function collectFanTagSearchExtraReleases(feedContext, existingReleases) {
    const active = getActiveFanTagSearchState();
    if (
        !active ||
        !feedContext ||
        !/^fan-/.test(feedContext.kind) ||
        !(feedContext.sourceGrid instanceof Element) ||
        (active.grid && feedContext.sourceGrid !== active.grid)
    ) {
        return [];
    }

    const knownUrls = new Set();
    const knownItems = new Set();
    for (const release of Array.isArray(existingReleases) ? existingReleases : []) {
        if (!release) {
            continue;
        }
        const releaseUrl = normalizeReleaseUrl(release.releaseUrl || "");
        if (releaseUrl) {
            knownUrls.add(releaseUrl);
        }
        if (release.itemId && release.itemType) {
            knownItems.add(`${release.itemType}:${release.itemId}`);
        }
    }

    const visible = getFanTagSearchVisibleLimit(active.kind);
    const limited =
        visible < active.matches.length
            ? { ...active, matches: active.matches.slice(0, visible) }
            : active;
    return collectFanTagSearchReleases(limited, feedContext.kind, {
        skipUrls: knownUrls,
        skipItems: knownItems,
    });
}

function getFanSearchInputKind(input) {
    const container =
        input instanceof Element
            ? input.closest(
                  "#collection-search, #wishlist-search, .collection-search, .wishlist-search",
              )
            : null;
    if (!container) {
        return "";
    }
    const id = cleanText(container.id);
    if (/wishlist/i.test(id)) {
        return "wishlist";
    }
    if (/collection/i.test(id)) {
        return "collection";
    }
    return "";
}

function handleFanTagSearchInput(event) {
    if (!CONFIG.enableTagSearch) {
        return;
    }
    const input = event && event.target;
    if (!(input instanceof HTMLInputElement)) {
        return;
    }
    const kind = getFanSearchInputKind(input);
    if (kind) {
        scheduleFanTagSearchQuery(kind, input.value || "");
    }
}

function scheduleFanTagSearchQuery(kind, value) {
    if (!kind) {
        return;
    }
    searchState.pendingQuery = { kind, value: cleanText(value) };
    if (searchState.debounceTimer) {
        window.clearTimeout(searchState.debounceTimer);
    }
    searchState.debounceTimer = window.setTimeout(() => {
        searchState.debounceTimer = 0;
        const pending = searchState.pendingQuery;
        searchState.pendingQuery = null;
        if (pending) {
            void applyFanTagSearchQuery(pending.kind, pending.value);
        }
    }, 160);
}

function scheduleFanTagSearchRefresh(kind, delayMs) {
    if (!kind) {
        return;
    }
    if (searchState.refreshTimers[kind]) {
        window.clearTimeout(searchState.refreshTimers[kind]);
    }
    searchState.refreshTimers[kind] = window.setTimeout(() => {
        searchState.refreshTimers[kind] = 0;
        const query = cleanText(STATE.tagSearchQueryByKind[kind] || "");
        if (query) {
            void applyFanTagSearchQuery(kind, query);
        }
    }, Math.max(0, Number(delayMs) || 0));
}

async function applyFanTagSearchQuery(kind, value) {
    if (!kind) {
        return;
    }

    const fanId = getFanTagFanId();
    const query = cleanText(value);
    const previousQuery = cleanText(STATE.tagSearchQueryByKind[kind] || "");
    if (previousQuery !== query) {
        searchState.visibleLimitByKind[kind] =
            Number(CONFIG.tagSearchInitialResults) || 80;
    }
    STATE.tagSearchQueryByKind[kind] = query;
    searchState.fanId = fanId;
    searchState.seqByKind[kind] = (searchState.seqByKind[kind] || 0) + 1;
    const requestSeq = searchState.seqByKind[kind];

    const matches =
        fanId && query ? await findFanTagSearchMatches(fanId, kind, query) : [];

    if (
        requestSeq !== searchState.seqByKind[kind] ||
        cleanText(STATE.tagSearchQueryByKind[kind]) !== query
    ) {
        return;
    }

    searchState.matchesByKind[kind] = matches;
    const signature = [
        kind,
        query,
        matches.map((match) => match.item.id).join(","),
    ].join("|");
    const changed = searchState.signatureByKind[kind] !== signature;
    searchState.signatureByKind[kind] = signature;

    markDebugState("data-bcampx-tag-search-query", query);
    markDebugState("data-bcampx-tag-search-matches", String(matches.length));

    if (changed) {
        TAG_INDEX_UI_HOOKS.scheduleFeedSync();
    }
}

function primeFanTagSearchFromInputs() {
    if (!CONFIG.enableTagSearch) {
        return;
    }
    for (const kind of ["collection", "wishlist"]) {
        const input = document.querySelector(`#${kind}-search input`);
        if (input instanceof HTMLInputElement && cleanText(input.value)) {
            scheduleFanTagSearchQuery(kind, input.value);
        }
    }
}

export function applyTagSearchSetting() {
    if (!isCurrentFanCollectionPage()) {
        return;
    }

    if (CONFIG.enableTagSearch) {
        setupFanTagSearch();
        scheduleFanTagIndexRun(Number(CONFIG.tagIndexStartDelayMs) || 0);
        primeFanTagSearchFromInputs();
        return;
    }

    if (runner.runTimer) {
        window.clearTimeout(runner.runTimer);
        runner.runTimer = 0;
    }
    runner.scheduled = false;
    STATE.tagSearchQueryByKind = { collection: "", wishlist: "" };
    searchState.matchesByKind = { collection: [], wishlist: [] };
    searchState.signatureByKind = { collection: "", wishlist: "" };
    setTagIndexState("disabled");
    TAG_INDEX_UI_HOOKS.scheduleFeedSync();
}

function refreshActiveTagSearchesFromStorage() {
    if (
        !CONFIG.enableTagSearch ||
        document.visibilityState === "hidden" ||
        (!cleanText(STATE.tagSearchQueryByKind.collection) &&
            !cleanText(STATE.tagSearchQueryByKind.wishlist)) ||
        Date.now() - (Number(STATE.releaseTagCacheLoadedAt) || 0) < 120000
    ) {
        return;
    }
    void refreshReleaseTagCache().then((changed) => {
        if (!changed) {
            return;
        }
        for (const kind of ["collection", "wishlist"]) {
            const query = cleanText(STATE.tagSearchQueryByKind[kind] || "");
            if (query) {
                void applyFanTagSearchQuery(kind, query);
            }
        }
    }, () => {});
}

export function setupFanTagSearch() {
    exposeFanTagIndexDebugHook();
    if (searchState.listenersBound) {
        return;
    }
    if (!CONFIG.enableTagSearch) {
        if (isBandcampFanProfileUrl(location.href)) {
            setTagIndexState("disabled");
        }
        return;
    }
    if (!isCurrentFanCollectionPage()) {
        if (isBandcampFanProfileUrl(location.href)) {
            setTagIndexState(
                TAG_INDEX_UI_HOOKS.isProfileOwner()
                    ? "not-collection-page"
                    : "viewer-not-owner",
            );
        }
        return;
    }

    searchState.listenersBound = true;
    markDebugState("data-bcampx-tag-search-setup", "bound");
    document.addEventListener("input", handleFanTagSearchInput, true);
    document.addEventListener("change", handleFanTagSearchInput, true);
    window.addEventListener("popstate", primeFanTagSearchFromInputs);
    window.addEventListener("pagehide", () => {
        void flushTagIndexWrites();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            void flushTagIndexWrites();
            return;
        }
        refreshActiveTagSearchesFromStorage();
    });
    window.addEventListener("focus", () => {
        refreshActiveTagSearchesFromStorage();
    });
    scheduleFanTagIndexRun(Number(CONFIG.tagIndexStartDelayMs) || 0);
    primeFanTagSearchFromInputs();
}

registerTagIndexPacingHooks({
    isRateLimitError: isTagIndexRateLimitError,
    waitTurn: waitTagIndexTurn,
    activateCooldown: activateTagIndexCooldown,
});
