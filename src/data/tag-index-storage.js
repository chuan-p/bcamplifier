import { parseJsonAttribute } from "./release-data.js";
import {
    CONFIG,
    STATE,
    TAG_INDEX_PREFIX,
    TAG_INDEX_STATUS_PREFIX,
} from "../state.js";
import { createSerialQueue } from "../utils/async.js";
import { markDebugState } from "../utils/dom.js";
import { resolveFanIdFromPageState } from "../utils/page.js";
import {
    storageDelete,
    storageGet,
    storageGetByPrefix,
    storageSet,
} from "../utils/storage.js";
import { cleanText } from "../utils/text-format.js";
import { normalizeReleaseUrl } from "../utils/url.js";

const tagStorageState = {
    fanTagFanId: 0,
    releaseTagCacheInitPromise: null,
};

export const TAG_INDEX_VERSION = 4;
// Bump when the request-pacing policy changes: a learned gap and a backoff
// from the old policy are not trustworthy under the new one.

const TAG_RECORD_PREFIX = "bcampx:releaseTag:";

// Writes and the periodic cleanup share one queue: a record written after
// a cleanup snapshot was taken must not be deleted by that older snapshot.
const runTagRecordTask = createSerialQueue();

export function persistTagRecord(key, entry) {
    if (!key || !entry) {
        return;
    }

    const write = () => {
        void runTagRecordTask(async () => {
            const saved = await storageSet(TAG_RECORD_PREFIX + key, entry);
            if (saved === false) {
                markTagIndexWriteFailure(
                    new Error(
                        "the browser refused to store a release tag record (storage full or unavailable)",
                    ),
                );
            }
        });
    };

    if (STATE.releaseTagCacheInitialized) {
        write();
        return;
    }

    // The store layout is decided by the first read. Writing before it
    // finished used to skip that read entirely and leave the existing tags
    // unloaded, so wait for it instead of guessing.
    void loadReleaseTagCache().then(write, () => {});
}

export function normalizeTagQuery(value) {
    let text = cleanText(String(value || "")).toLowerCase();
    try {
        text = text
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "");
    } catch (_error) {
        // Older engines without String#normalize keep the raw text.
    }
    return text.replace(/\s+/g, " ").trim();
}

export function getTagTralbumKey(tralbumType, tralbumId) {
    const type = cleanText(tralbumType || "").toLowerCase();
    const id = Number(tralbumId);
    if (!type || !id) {
        return "";
    }
    return `${type}${id}`;
}

function normalizeTagArtUrl(rawUrl) {
    const value = cleanText(rawUrl || "");
    if (!/^https:\/\//i.test(value)) {
        return "";
    }

    try {
        // The mobile API reports the small (210px) rendition. Native
        // collection cards use the 700px `_16` one, and both are derived
        // from the same art id.
        const url = new URL(value);
        if (/(^|\.)bcbits\.com$/i.test(url.hostname)) {
            url.pathname = url.pathname.replace(
                /_\d+(\.[a-z0-9]+)$/i,
                "_16$1",
            );
            return url.toString();
        }
    } catch (_error) {
        return "";
    }

    return value;
}

export function buildTagIndexItem(entry) {
    if (!entry || typeof entry !== "object") {
        return null;
    }

    const itemId = Number(entry.item_id || entry.itemId || entry.id);
    const tralbumId = Number(
        entry.tralbum_id || entry.tralbumId || entry.album_id || 0,
    );
    const rawType = cleanText(
        entry.tralbum_type || entry.tralbumType || "",
    ).toLowerCase();
    if (entry.hidden) {
        return null;
    }
    const bandId = Number(entry.band_id || entry.bandId);
    const artId = Number(entry.item_art_id || entry.itemArtId) || 0;
    const url = normalizeReleaseUrl(
        entry.item_url || entry.itemUrl || entry.url || "",
    );
    if (!itemId || !tralbumId || !bandId || !url) {
        return null;
    }

    return {
        id: itemId,
        type: cleanText(
            entry.item_type || entry.itemType || entry.type || "",
        ).toLowerCase(),
        tralbumId,
        // A package item is sold as its digital album; the album's tags are
        // the ones a fan means when searching.
        tralbumType: rawType === "t" ? "t" : "a",
        bandId,
        title: cleanText(entry.item_title || entry.itemTitle || entry.title),
        artist: cleanText(entry.band_name || entry.bandName || entry.artist),
        url,
        // The page's item cache only carries the numeric art id, while the
        // collection API carries a full URL. Support both.
        art:
            normalizeTagArtUrl(
                entry.item_art_url || entry.artUrl || entry.art,
            ) ||
            (artId > 0
                ? `https://f4.bcbits.com/img/a${String(artId).padStart(10, "0")}_16.jpg`
                : ""),
    };
}

export function getFanTagFanId() {
    const cached = Number(tagStorageState.fanTagFanId);
    if (cached) {
        return cached;
    }

    const pageData = parseJsonAttribute(
        document.querySelector("#pagedata[data-blob]"),
        "data-blob",
    );
    if (!pageData || typeof pageData !== "object") {
        return 0;
    }

    const fanId =
        Number(
            pageData.fan_data &&
                (pageData.fan_data.fan_id || pageData.fan_data.id),
        ) || resolveFanIdFromPageState(pageData);
    if (fanId) {
        tagStorageState.fanTagFanId = fanId;
    }
    return fanId || 0;
}

export function readFanTagPageSeed(options = {}) {
    const pageData = parseJsonAttribute(
        document.querySelector("#pagedata[data-blob]"),
        "data-blob",
    );
    if (!pageData || typeof pageData !== "object") {
        return null;
    }

    // The page fan is what we index, and on the owner's own page it is the
    // signed-in fan. identity/fan_info cover pages that omit fan_data.
    const fanId = getFanTagFanId();
    if (!fanId) {
        return null;
    }

    const itemCache =
        pageData.item_cache && typeof pageData.item_cache === "object"
            ? pageData.item_cache
            : {};
    const kinds = {};

    ["collection", "wishlist"].forEach((kind) => {
        const data =
            kind === "collection"
                ? pageData.collection_data
                : pageData.wishlist_data;
        const cache = itemCache[kind] || {};
        const sequence = Array.isArray(data && data.sequence)
            ? data.sequence
            : [];
        const items = [];
        const seen = new Set();

        sequence.forEach((key) => {
            const item = buildTagIndexItem(cache[key]);
            if (!item || seen.has(item.id)) {
                return;
            }
            seen.add(item.id);
            items.push(item);
        });

        // An inactive tab has an empty sequence but still ships its first
        // batch in item_cache, and paging starts after that batch.
        Object.keys(cache).forEach((key) => {
            const item = buildTagIndexItem(cache[key]);
            if (!item || seen.has(item.id)) {
                return;
            }
            seen.add(item.id);
            items.push(item);
        });

        if (!items.length && options.includeDom) {
            items.push(...collectFanTagIndexDomItems(kind));
        }

        kinds[kind] = {
            items,
            token: cleanText(data && data.last_token),
            count: Math.max(
                Number(data && data.item_count) || 0,
                items.length,
            ),
            // A missing section is "the page said nothing", which must not
            // be mistaken for "the list is empty".
            hasData: Boolean(data && typeof data === "object"),
        };
    });

    return { fanId, kinds };
}

// The page's own item cache only holds the first batch. Items the fan has
// already scrolled into view are a free fallback when the paginated item
// request is unavailable, and a no-op when it works.
function collectFanTagIndexDomItems(kind) {
    const root = document.querySelector(
        kind === "wishlist"
            ? "#wishlist-items, #wishlist-grid"
            : "#collection-items, #collection-grid",
    );
    if (!root) {
        return [];
    }

    const items = [];
    root.querySelectorAll("li.collection-item-container").forEach((node) => {
        const isTrack =
            cleanText(node.getAttribute("data-itemtype")).toLowerCase() ===
            "track";
        const trackLink = node.querySelector('a[href*="/track/"]');
        const albumLink = node.querySelector('a[href*="/album/"]');
        const releaseLink = isTrack
            ? trackLink || albumLink
            : albumLink || trackLink;
        const artistNode = node.querySelector(
            ".collection-item-artist, .item-artist",
        );
        const titleNode = node.querySelector(
            ".collection-item-title, .item-title",
        );
        const artNode = node.querySelector(
            "img.collection-item-art, img",
        );

        const item = buildTagIndexItem({
            item_id: node.getAttribute("data-itemid"),
            item_type: node.getAttribute("data-itemtype"),
            tralbum_id: node.getAttribute("data-tralbumid"),
            tralbum_type: node.getAttribute("data-tralbumtype"),
            band_id: node.getAttribute("data-bandid"),
            item_url: releaseLink ? releaseLink.href : "",
            item_title:
                node.getAttribute("data-title") ||
                (titleNode && titleNode.textContent),
            band_name: cleanText(
                artistNode && artistNode.textContent,
            ).replace(/^by\s+/i, ""),
            item_art_url: artNode ? artNode.src : "",
        });
        if (item) {
            items.push(item);
        }
    });
    return items;
}

function getTagIndexStorageKey(fanId, kind) {
    return `${TAG_INDEX_PREFIX}${fanId}:${kind}`;
}

function getTagIndexStatusKey(fanId, kind) {
    return `${TAG_INDEX_STATUS_PREFIX}${fanId}:${kind}`;
}

function getFanTagIndexCacheEntry(fanId, kind) {
    const cache = STATE.fanTagIndexCache;
    if (!cache || !fanId || !kind) {
        return null;
    }
    return cache.get(`${fanId}:${kind}`) || null;
}

function createEmptyFanTagIndex() {
    return {
        version: TAG_INDEX_VERSION,
        items: [],
        token: "",
        itemsComplete: false,
        itemsUpdatedAt: 0,
        failures: {},
        // Ids seen by an unfinished full refresh, kept so a refresh that
        // spans several page loads can still detect removed items.
        refreshSeen: [],
    };
}

export function countFanTagIndexCoverage(index) {
    const stats = { itemsCount: 0, resolvedCount: 0, taggedCount: 0 };
    if (!index || !Array.isArray(index.items)) {
        return stats;
    }

    stats.itemsCount = index.items.length;
    index.items.forEach((item) => {
        const tags = getCachedReleaseTags(
            getTagTralbumKey(item.tralbumType, item.tralbumId),
        );
        if (!tags) {
            return;
        }
        stats.resolvedCount += 1;
        if (tags.length) {
            stats.taggedCount += 1;
        }
    });
    return stats;
}

function cacheEmptyFanTagIndex(fanId, kind) {
    const empty = createEmptyFanTagIndex();
    if (fanId && kind) {
        rememberFanTagIndex(fanId, kind, empty);
    }
    return empty;
}

export async function loadFanTagIndex(fanId, kind) {
    if (!fanId || !kind) {
        return cacheEmptyFanTagIndex(fanId, kind);
    }

    const cached = getFanTagIndexCacheEntry(fanId, kind);
    if (cached) {
        return cached;
    }

    // Items and progress live in separate keys: the item list is large and
    // only changes when the collection does, while progress changes during
    // a run.
    const [raw, rawStatus] = await Promise.all([
        storageGet(getTagIndexStorageKey(fanId, kind), null),
        storageGet(getTagIndexStatusKey(fanId, kind), null),
    ]);
    if (!raw || typeof raw !== "object") {
        return cacheEmptyFanTagIndex(fanId, kind);
    }
    if (Number(raw.version) !== TAG_INDEX_VERSION) {
        return cacheEmptyFanTagIndex(fanId, kind);
    }

    const items = [];
    const seen = new Set();
    (Array.isArray(raw.items) ? raw.items : []).forEach((entry) => {
        const item = buildTagIndexItem(entry);
        if (!item || seen.has(item.id)) {
            return;
        }
        seen.add(item.id);
        items.push(item);
    });

    const status =
        rawStatus &&
        typeof rawStatus === "object" &&
        Number(rawStatus.version) === TAG_INDEX_VERSION
            ? rawStatus
            : {};
    const index = {
        items,
        token: cleanText(raw.token),
        itemsComplete: raw.itemsComplete === true,
        itemsUpdatedAt: Number(raw.itemsUpdatedAt) || 0,
        failures:
            status.failures &&
            typeof status.failures === "object" &&
            !Array.isArray(status.failures)
                ? status.failures
                : {},
        refreshSeen: Array.isArray(raw.refreshSeen)
            ? raw.refreshSeen
            : [],
    };

    // Every query compares against the same catalogue, so keep the parsed
    // copy instead of re-reading and re-parsing storage on each keystroke.
    if (!STATE.fanTagIndexCache) {
        STATE.fanTagIndexCache = new Map();
    }
    STATE.fanTagIndexCache.set(`${fanId}:${kind}`, index);
    return index;
}

export async function loadFanTagIndexStatus(fanId, kind) {
    if (!fanId || !kind) {
        return null;
    }
    const raw = await storageGet(getTagIndexStatusKey(fanId, kind), null);
    if (
        !raw ||
        typeof raw !== "object" ||
        Number(raw.version) !== TAG_INDEX_VERSION
    ) {
        return null;
    }
    return raw;
}

function rememberFanTagIndex(fanId, kind, index) {
    if (!STATE.fanTagIndexCache) {
        STATE.fanTagIndexCache = new Map();
    }
    STATE.fanTagIndexCache.set(`${fanId}:${kind}`, index);
}

// Both writers report whether the record actually reached storage: an
// index that cannot be persisted would otherwise resume from the same
// place on every visit and look like a stalled build.
export async function saveFanTagIndexItems(fanId, kind, index) {
    if (!fanId || !kind || !index) {
        return true;
    }
    rememberFanTagIndex(fanId, kind, index);
    return storageSet(getTagIndexStorageKey(fanId, kind), {
        version: TAG_INDEX_VERSION,
        items: index.items,
        token: index.token,
        itemsComplete: index.itemsComplete,
        itemsUpdatedAt: index.itemsUpdatedAt,
        refreshSeen: Array.isArray(index.refreshSeen)
            ? index.refreshSeen
            : [],
    });
}

export async function saveFanTagIndexStatus(fanId, kind, index) {
    if (!fanId || !kind || !index) {
        return true;
    }
    rememberFanTagIndex(fanId, kind, index);
    const validKeys = new Set(
        index.items
            .map((item) =>
                getTagTralbumKey(item.tralbumType, item.tralbumId),
            )
            .filter(Boolean),
    );
    const failures = {};
    Object.keys(index.failures || {}).forEach((key) => {
        if (validKeys.has(key)) {
            failures[key] = index.failures[key];
        }
    });
    index.failures = failures;
    const stats = countFanTagIndexCoverage(index);
    return storageSet(getTagIndexStatusKey(fanId, kind), {
        version: TAG_INDEX_VERSION,
        ...stats,
        itemsComplete: index.itemsComplete,
        itemsUpdatedAt: index.itemsUpdatedAt,
        failures: index.failures,
        seedIds: cleanText(
            (STATE.tagIndexSeedIds || {})[`${fanId}:${kind}`],
        ),
    });
}

export function fanTagIndexHasUncachedItems(index) {
    if (!index || !Array.isArray(index.items)) {
        return true;
    }
    return index.items.some((item) => {
        const key = getTagTralbumKey(item.tralbumType, item.tralbumId);
        return !key || !getCachedReleaseTags(key);
    });
}

export function isFanTagIndexKindComplete(kindSeed, status, seedIds) {
    if (!status || !kindSeed) {
        return false;
    }
    if (!kindSeed.count) {
        // The page says this list is empty. That is only complete once the
        // stored catalogue is empty too; otherwise the old items keep
        // answering searches forever because a zero count used to skip the
        // kind entirely.
        return (
            status.itemsComplete === true &&
            Number(status.itemsCount) === 0
        );
    }
    if (status.itemsComplete !== true) {
        return false;
    }

    const itemsCount = Number(status.itemsCount) || 0;
    const resolvedCount = Number(status.resolvedCount) || 0;
    if (!itemsCount || resolvedCount < itemsCount) {
        return false;
    }
    // New purchases appear on the first page, so a changed seed page means
    // there is something to index; removals are caught by the TTL refresh.
    if (cleanText(status.seedIds) !== cleanText(seedIds)) {
        return false;
    }
    return (
        Date.now() - (Number(status.itemsUpdatedAt) || 0) <=
        (Number(CONFIG.tagIndexItemsTtlMs) || 0)
    );
}

function mergeTagIndexItemFields(existing, incoming) {
    if (!existing || !incoming) {
        return existing;
    }

    // Entries indexed before a parser fix (for example the art-id fallback)
    // must pick up the better values instead of staying blank forever.
    ["url", "title", "artist", "type"].forEach((key) => {
        const value = cleanText(incoming[key]);
        if (value && !cleanText(existing[key])) {
            existing[key] = value;
        }
    });
    if (cleanText(incoming.art) && incoming.art !== existing.art) {
        existing.art = incoming.art;
    }
    ["bandId", "tralbumId"].forEach((key) => {
        if (!existing[key] && incoming[key]) {
            existing[key] = incoming[key];
        }
    });
    if (incoming.tralbumType && incoming.tralbumType !== existing.tralbumType) {
        existing.tralbumType = incoming.tralbumType;
    }
    return existing;
}

export function mergeFanTagIndexItems(index, items) {
    if (!index || !Array.isArray(items) || !items.length) {
        return false;
    }

    const byId = new Map();
    index.items.forEach((item) => {
        byId.set(item.id, item);
    });

    let added = 0;
    items.forEach((item) => {
        if (!item) {
            return;
        }
        const existing = byId.get(item.id);
        if (existing) {
            mergeTagIndexItemFields(existing, item);
            return;
        }
        byId.set(item.id, item);
        index.items.push(item);
        added += 1;
    });

    if (index.items.length > CONFIG.tagIndexMaxItems) {
        index.items = index.items.slice(0, CONFIG.tagIndexMaxItems);
    }

    return added > 0;
}

export function loadReleaseTagCache() {
    if (STATE.releaseTagCacheInitialized) {
        return Promise.resolve(STATE.releaseTagCache);
    }
    if (!tagStorageState.releaseTagCacheInitPromise) {
        tagStorageState.releaseTagCacheInitPromise = loadReleaseTagCacheInternal()
            .then((cache) => {
                // Tags harvested while the store was being read (a card can
                // finish before the delayed index start) are merged after
                // the stored records, so neither side is dropped.
                const pending = STATE.releaseTagPendingWrites;
                const harvested = [];
                if (pending && pending.size) {
                    pending.forEach((entry, key) => {
                        const existing = cache[key];
                        if (
                            !existing ||
                            Number(entry.ts) >= Number(existing.ts)
                        ) {
                            cache[key] = entry;
                        }
                        harvested.push([key, entry]);
                    });
                    pending.clear();
                }
                STATE.releaseTagCache = cache;
                STATE.releaseTagCacheInitialized = true;
                harvested.forEach(([key, entry]) =>
                    persistTagRecord(key, entry),
                );
                return cache;
            })
            .catch((error) => {
                tagStorageState.releaseTagCacheInitPromise = null;
                throw error;
            });
    }
    return tagStorageState.releaseTagCacheInitPromise;
}

async function readAllReleaseTagRecords() {
    let records = null;
    try {
        records = await storageGetByPrefix(TAG_RECORD_PREFIX);
    } catch (_error) {
        records = null;
    }
    const entries = {};
    if (!records || typeof records !== "object") {
        return null;
    }
    for (const [key, entry] of Object.entries(records)) {
        if (
            key.startsWith(TAG_RECORD_PREFIX) &&
            entry &&
            Array.isArray(entry.tags)
        ) {
            entries[key.slice(TAG_RECORD_PREFIX.length)] = entry;
        }
    }
    return entries;
}

async function loadReleaseTagCacheInternal() {
    const startedAt = window.performance.now();
    const cache = (await readAllReleaseTagRecords()) || {};
    STATE.releaseTagCache = cache;
    STATE.releaseTagCacheLoadedAt = Date.now();
    markDebugState(
        "data-bcampx-tag-cache-load-ms",
        String(Math.round(window.performance.now() - startedAt)),
    );
    return STATE.releaseTagCache;
}

// Another tab may have fetched tags since this page loaded; merge them in
// so a search does not keep using a stale snapshot.
export async function refreshReleaseTagCache() {
    await loadReleaseTagCache();
    const records = await readAllReleaseTagRecords();
    if (!records) {
        return false;
    }
    for (const [cacheKey, storedEntry] of Object.entries(records)) {
        const memoryEntry = STATE.releaseTagCache[cacheKey];
        if (!memoryEntry || Number(storedEntry.ts) > Number(memoryEntry.ts)) {
            STATE.releaseTagCache[cacheKey] = storedEntry;
        }
    }
    STATE.releaseTagCacheLoadedAt = Date.now();
    return true;
}

export function getCachedReleaseTags(key) {
    const entry = key
        ? (STATE.releaseTagCache && STATE.releaseTagCache[key]) ||
          (STATE.releaseTagPendingWrites &&
              STATE.releaseTagPendingWrites.get(key)) ||
          null
        : null;
    if (!entry || !Array.isArray(entry.tags)) {
        return null;
    }

    const maxAge = Number(CONFIG.releaseTagTtlMs) || 0;
    const fetchedAt = Number(entry.ts) || 0;
    if (!fetchedAt || (maxAge && Date.now() - fetchedAt > maxAge)) {
        return null;
    }

    // An empty tag list may just be a transient API answer, so refresh it
    // much sooner than a normal entry instead of hiding the release for the
    // full 90-day TTL.
    if (!entry.tags.length) {
        const emptyMaxAge =
            Number(CONFIG.releaseTagEmptyTtlMs) ||
            7 * 24 * 60 * 60 * 1000;
        if (Date.now() - fetchedAt > emptyMaxAge) {
            return null;
        }
    }

    return entry.tags;
}

// The card enhancer already downloads the release page (which lists its
// tags) for description, price and supporter counts. Reuse that instead of
// asking the mobile API for the same release again.
export function harvestTagsFromReleaseData(release, tags) {
    if (!CONFIG.enableTagSearch) {
        return;
    }
    if (!release || !Array.isArray(tags) || !tags.length) {
        return;
    }
    const key = getTagTralbumKey(release.tralbumType, release.tralbumId);
    if (!key) {
        return;
    }
    // An empty cached answer (the API sometimes returns no tags) must not
    // block the richer tags on the release page; only a non-empty entry is
    // authoritative here. Counts are refreshed by cacheReleaseTags below.
    const cached = getCachedReleaseTags(key);
    if (cached && cached.length) {
        return;
    }
    const names = [];
    tags.forEach((tag) => {
        const name = cleanText(tag && tag.name ? tag.name : tag);
        if (name && !/^tags?$/i.test(name) && !names.includes(name)) {
            names.push(name);
        }
    });
    if (names.length) {
        cacheReleaseTags(key, names);
    }
}

export function cacheReleaseTags(key, tags) {
    if (!key || !Array.isArray(tags)) {
        return;
    }

    const entry = {
        tags: tags.slice(0, 24),
        ts: Date.now(),
    };

    if (!STATE.releaseTagCacheInitialized) {
        // The stored cache has not been read yet. Hold the entry instead of
        // creating an empty cache object: creating it made the initializer
        // believe the cache was already loaded and skip the read entirely.
        if (!STATE.releaseTagPendingWrites) {
            STATE.releaseTagPendingWrites = new Map();
        }
        const pendingEntry = STATE.releaseTagPendingWrites.get(key);
        if (
            !pendingEntry ||
            Number(entry.ts) >= Number(pendingEntry.ts)
        ) {
            STATE.releaseTagPendingWrites.set(key, entry);
        }
        void loadReleaseTagCache().catch(() => {});
        return;
    }

    if (!STATE.releaseTagCache) {
        STATE.releaseTagCache = {};
    }
    STATE.releaseTagCache[key] = entry;
    persistTagRecord(key, entry);
}

function pruneReleaseTagCache(cache) {
    const maxAge = Number(CONFIG.releaseTagTtlMs) || 0;
    const maxEntries = Math.max(
        1,
        Math.floor(Number(CONFIG.maxReleaseTagCacheEntries) || 0),
    );
    const now = Date.now();
    const entries = Object.entries(cache || {}).filter(([, entry]) => {
        const fetchedAt = Number(entry && entry.ts) || 0;
        return fetchedAt > 0 && (!maxAge || now - fetchedAt <= maxAge);
    });

    entries.sort(
        (left, right) =>
            Number(right[1].ts) - Number(left[1].ts),
    );

    const next = {};
    entries.slice(0, maxEntries).forEach(([key, entry]) => {
        next[key] = entry;
    });
    return next;
}

export async function flushReleaseTagCache() {
    // Nothing can be pruned before the stored cache was read; pruning an
    // empty or partial in-memory map would delete records it never saw.
    if (!STATE.releaseTagCacheInitialized || !STATE.releaseTagCache) {
        return true;
    }

    const beforeEntries = STATE.releaseTagCache;
    const pruned = pruneReleaseTagCache(beforeEntries);
    // Records are written as their tags are fetched; here only drop the
    // expired/over-cap ones from storage. Another tab may have rewritten
    // one of these keys after this page took its snapshot, so each
    // deletion candidate is compared against the persisted record.
    const candidates = Object.keys(beforeEntries).filter(
        (key) => !Object.prototype.hasOwnProperty.call(pruned, key),
    );
    if (!candidates.length) {
        STATE.releaseTagCache = pruned;
        return true;
    }

    return runTagRecordTask(async () => {
        // Comparing one candidate at a time is fine for the usual handful
        // of expired records. A cache that grew past the cap can make the
        // candidate list huge, so read the whole record set in one go.
        const bulk =
            candidates.length > 64
                ? await storageGetByPrefix(TAG_RECORD_PREFIX).catch(
                      () => null,
                  )
                : null;
        const readRecord = async (key) => {
            if (bulk && typeof bulk === "object") {
                return bulk[TAG_RECORD_PREFIX + key] || null;
            }
            try {
                return await storageGet(TAG_RECORD_PREFIX + key, null);
            } catch (_error) {
                return null;
            }
        };

        const merged = { ...pruned };
        for (const key of candidates) {
            const stored = await readRecord(key);
            if (!stored || !Array.isArray(stored.tags)) {
                continue;
            }
            const storedTs = Number(stored.ts) || 0;
            const snapshotTs =
                Number(beforeEntries[key] && beforeEntries[key].ts) || 0;
            if (storedTs > snapshotTs) {
                // Another page refreshed this release after our snapshot.
                // Its answer is newer: keep it, and let the normal policy
                // decide whether it still fits.
                merged[key] = stored;
            }
        }

        const finalEntries = pruneReleaseTagCache(merged);
        STATE.releaseTagCache = finalEntries;
        const removals = candidates.filter(
            (key) =>
                !Object.prototype.hasOwnProperty.call(finalEntries, key),
        );
        if (removals.length) {
            await Promise.all(
                removals.map((key) =>
                    storageDelete(TAG_RECORD_PREFIX + key),
                ),
            );
        }
        return true;
    });
}


export function markTagIndexWriteFailure(error) {
    markDebugState(
        "data-bcampx-tag-index-write-error",
        cleanText(error && error.message).slice(0, 120),
    );
}

