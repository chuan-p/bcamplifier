import {
    findFanCollectionActiveGrid,
    isBandcampFanProfileUrl,
    isCurrentFanCollectionPage,
    normalizeReleaseUrl,
    resolveFanIdFromPageState,
} from "../bcamplifier.core.js";
import {
    createTrackData,
    parseJsonAttribute,
    rememberTracklistCacheEntry,
    requestJson,
} from "./release-data.js";
import { buildFanTagSearchNativeRelease, isCurrentFanProfileOwner, scheduleArtistMusicFeedSync } from "../features/artist-music-feed.js";
import { refreshTagSearchSettingProgress } from "../features/player.js";
import {
    CONFIG,
    STATE,
    TAG_INDEX_COOLDOWN_KEY,
    TAG_INDEX_OWNER_KEY,
    TAG_INDEX_PACING_KEY,
    TAG_INDEX_PREFIX,
    TAG_INDEX_STATUS_PREFIX,
} from "../state.js";
import { createConcurrencyLimiter, createSerialQueue } from "../utils/async.js";
import { markDebugState } from "../utils/dom.js";
import {
    storageDelete,
    storageGet,
    storageGetByPrefix,
    storageSet,
} from "../utils/storage.js";
import { cleanText } from "../utils/text-format.js";

// Bandcamp's own collection search posts to
// /api/fancollection/1/search_items, and that index only covers release
// titles and artist names: a term that appears only in a release's tags
// comes back empty. Tag-aware search therefore keeps its own catalogue:
//
//   * the fan's item list, paginated so items that have not been scrolled
//     into view yet can still be matched (the collection endpoint advances
//     20 items per request, the wishlist endpoint 100);
//   * each release's tags, one small mobile-API request per release
//     (2-17 KB of JSON instead of a full release page).
//
// Both live in storage, so the work is spread across page loads instead of
// blocking the first search, and tags are shared between collections
// because they describe the release rather than the purchase.

// Bump when the stored item list changes shape so an existing index is
// rebuilt instead of being trusted. Tag caches survive this.
const TAG_INDEX_VERSION = 4;
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

function normalizeTagQuery(value) {
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

function buildTagIndexItem(entry) {
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

function getFanTagFanId() {
    const cached = Number(STATE.fanTagFanId);
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
        STATE.fanTagFanId = fanId;
    }
    return fanId || 0;
}

function readFanTagPageSeed(options = {}) {
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

function countFanTagIndexCoverage(index) {
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

async function loadFanTagIndex(fanId, kind) {
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

async function loadFanTagIndexStatus(fanId, kind) {
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
async function saveFanTagIndexItems(fanId, kind, index) {
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

function fanTagIndexHasUncachedItems(index) {
    if (!index || !Array.isArray(index.items)) {
        return true;
    }
    return index.items.some((item) => {
        const key = getTagTralbumKey(item.tralbumType, item.tralbumId);
        return !key || !getCachedReleaseTags(key);
    });
}

function isFanTagIndexKindComplete(kindSeed, status, seedIds) {
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

function mergeFanTagIndexItems(index, items) {
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
    if (!STATE.releaseTagCacheInitPromise) {
        STATE.releaseTagCacheInitPromise = loadReleaseTagCacheInternal()
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
                STATE.releaseTagCacheInitPromise = null;
                throw error;
            });
    }
    return STATE.releaseTagCacheInitPromise;
}

async function loadReleaseTagCacheInternal() {
    const startedAt = window.performance.now();
    let records = null;
    try {
        records = await storageGetByPrefix(TAG_RECORD_PREFIX);
    } catch (_error) {
        records = null;
    }

    const cache = {};
    if (records && typeof records === "object") {
        Object.keys(records).forEach((key) => {
            if (!key.startsWith(TAG_RECORD_PREFIX)) {
                return;
            }
            const entry = records[key];
            if (entry && Array.isArray(entry.tags)) {
                cache[key.slice(TAG_RECORD_PREFIX.length)] = entry;
            }
        });
    }

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
async function refreshReleaseTagCache() {
    await loadReleaseTagCache();
    let records = null;
    try {
        records = await storageGetByPrefix(TAG_RECORD_PREFIX);
    } catch (_error) {
        records = null;
    }
    if (!records || typeof records !== "object") {
        return false;
    }
    Object.keys(records).forEach((key) => {
        if (!key.startsWith(TAG_RECORD_PREFIX)) {
            return;
        }
        const storedEntry = records[key];
        if (!storedEntry || !Array.isArray(storedEntry.tags)) {
            return;
        }
        const cacheKey = key.slice(TAG_RECORD_PREFIX.length);
        const memoryEntry = STATE.releaseTagCache[cacheKey];
        if (
            !memoryEntry ||
            Number(storedEntry.ts) > Number(memoryEntry.ts)
        ) {
            STATE.releaseTagCache[cacheKey] = storedEntry;
        }
    });
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

function cacheReleaseTags(key, tags) {
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

async function flushReleaseTagCache() {
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

function waitTagIndexDelay(delayMs) {
    const delay = Math.max(0, Number(delayMs) || 0);
    return new Promise((resolve) => window.setTimeout(resolve, delay));
}

async function fetchRawFanCollectionItemsPage(fanId, kind, token) {
    const endpoint = kind === "wishlist" ? "wishlist_items" : "collection_items";
    const payload = JSON.stringify({
        fan_id: fanId,
        older_than_token: cleanText(token),
        // The collection endpoint derives last_token from the 20th item of
        // the response even when count is larger, so asking for 100 only
        // downloads 80 duplicate items per page. The wishlist endpoint
        // advances the full count and keeps 100.
        count: kind === "wishlist" ? 100 : 20,
    });
    const response = await requestJson(
        `https://bandcamp.com/api/fancollection/1/${endpoint}`,
        {
            method: "POST",
            credentials: "include",
            data: payload,
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
        },
    );
    if (!response || typeof response !== "object" || response.error) {
        throw new Error("Bandcamp collection item request failed.");
    }

    return {
        items: Array.isArray(response.items) ? response.items : [],
        token: cleanText(response.last_token),
        moreAvailable: response.more_available === true,
    };
}

async function fetchFanCollectionItemsPage(fanId, kind, token) {
    const page = await fetchRawFanCollectionItemsPage(fanId, kind, token);
    const items = [];
    page.items.forEach((entry) => {
        const item = buildTagIndexItem(entry);
        if (item) {
            items.push(item);
        }
    });
    return {
        items,
        token: page.token,
        moreAvailable: page.moreAvailable,
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
    (Array.isArray(data.tags) ? data.tags : []).forEach((tag) => {
        const name = cleanText(tag && tag.name);
        if (!name || /^tags?$/i.test(name) || tags.includes(name)) {
            return;
        }
        tags.push(name);
    });

    // The same response carries the release's tracklist. Hand it to the card
    // renderer so a tag result that was just indexed does not have to ask
    // the API (or the release page) for its tracks again.
    const apiKey = `${type}${item.tralbumId}:${item.bandId}`;
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
            apiKey,
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

// The mobile release API returns the full tracklist with playable stream
// redirects, and it is the same endpoint the tag index already uses. When a
// release page parse yields no tracklist (or fails entirely), this keeps the
// card useful instead of showing an empty Tracklist header.
//
// The map lives for the whole page, so it is capped: a long session can
// otherwise keep every tracklist it ever saw in memory.
export function isTagIndexRateLimitError(error) {
    const message = String((error && error.message) || error || "");
    return /HTTP\s*429|too many requests|rate.?limit/i.test(message);
}

function clampTagIndexGap(gap) {
    const fastest = Number(CONFIG.tagIndexFastestGapMs) || 250;
    const slowest = Number(CONFIG.tagIndexSlowestGapMs) || 1500;
    return Math.min(
        slowest,
        Math.max(fastest, Math.round(Number(gap) || 0)),
    );
}

async function ensureTagIndexPacing() {
    if (Number(STATE.tagIndexGapMs) > 0) {
        return Number(STATE.tagIndexGapMs);
    }

    let stored = null;
    try {
        stored = await storageGet(TAG_INDEX_PACING_KEY, null);
    } catch (_error) {
        stored = null;
    }
    const fallback = Number(CONFIG.tagIndexMinGapMs) || 1000;
    STATE.tagIndexGapMs = clampTagIndexGap(
        Number(stored && stored.gap) || fallback,
    );
    return STATE.tagIndexGapMs;
}

function getTagIndexGapMs() {
    return clampTagIndexGap(
        Number(STATE.tagIndexGapMs) ||
            Number(CONFIG.tagIndexMinGapMs) ||
            450,
    );
}

// A clean run earns a slightly faster cadence; a 429 slows it down. The
// value is persisted so the next visit starts from the learned pace.
async function adjustTagIndexPacing(factor) {
    const gap = clampTagIndexGap(getTagIndexGapMs() * factor);
    if (gap === getTagIndexGapMs()) {
        return gap;
    }
    STATE.tagIndexGapMs = gap;
    try {
        await storageSet(TAG_INDEX_PACING_KEY, {
            gap,
            updatedAt: Date.now(),
        });
    } catch (_error) {
        // A failed write only costs the learning, not the run.
    }
    markDebugState("data-bcampx-tag-index-gap", String(gap));
    return gap;
}

// Every index request goes through this gate: a minimum gap between
// requests keeps bursts under Bandcamp's limit even though two requests may
// be in flight at once.
export async function waitTagIndexTurn() {
    const gap = getTagIndexGapMs();
    if (!gap) {
        return;
    }

    const now = Date.now();
    const nextAt = Math.max(now, Number(STATE.tagIndexNextRequestAt) || 0);
    STATE.tagIndexNextRequestAt = nextAt + gap;
    if (nextAt > now) {
        await waitTagIndexDelay(nextAt - now);
    }
}

async function getTagIndexCooldown() {
    const raw = await storageGet(TAG_INDEX_COOLDOWN_KEY, null);
    if (!raw || typeof raw !== "object") {
        return { until: 0, level: 0, version: 0 };
    }
    return {
        until: Number(raw.until) || 0,
        level: Math.max(0, Math.floor(Number(raw.level) || 0)),
        version: Number(raw.version) || 0,
        source: cleanText(raw.source),
    };
}

// The index is a background job; wait out the backoff on its own instead
// of requiring a page reload when the cooldown expires.
function scheduleTagIndexCooldownRetry(until) {
    const retryAt = Number(until) || 0;
    if (!retryAt || STATE.tagIndexRetryTimer) {
        return;
    }
    const retryIn = Math.max(10000, retryAt - Date.now() + 5000);
    STATE.tagIndexRetryTimer = window.setTimeout(() => {
        STATE.tagIndexRetryTimer = 0;
        void runFanTagIndexBuild({
            background: !isCurrentFanCollectionPage(),
        }).catch(() => {});
    }, Math.min(retryIn, 6 * 60 * 60 * 1000));
}

export async function activateTagIndexCooldown(source = "") {
    // Both grids can hit the limit in the same burst; only the first hit
    // escalates the backoff.
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
    await adjustTagIndexPacing(1.5);
    STATE.tagIndexNextRequestAt = 0;
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
    const failedAt = Number(
        index && index.failures && index.failures[key],
    );
    if (!failedAt) {
        return false;
    }
    return Date.now() - failedAt < (Number(CONFIG.tagIndexFailureBackoffMs) || 0);
}

async function refreshFanTagIndexItems(fanId, kind, index, seed) {
    const resumed = Boolean(cleanText(index.token));
    // An index resumed from an older version has no record of the ids its
    // earlier batches saw, so this run cannot tell "removed" from "seen in
    // a previous batch".
    const resumedWithSeen =
        resumed &&
        Array.isArray(index.refreshSeen) &&
        index.refreshSeen.length > 0;
    // Every id seen by the current full refresh, including the batches
    // resumed on later page loads. Only a set that spans the whole run can
    // decide which indexed items were removed, so it has to outlive the
    // per-visit budget.
    const seenIds = new Set(
        resumed && Array.isArray(index.refreshSeen)
            ? index.refreshSeen
            : [],
    );
    if (seed && seed.items.length) {
        seed.items.forEach((item) => seenIds.add(item.id));
        if (mergeFanTagIndexItems(index, seed.items)) {
            markFanTagIndexDirty(fanId, kind, index, true);
        }
    }
    index.refreshSeen = Array.from(seenIds);

    const expected = Math.max(
        0,
        Number(seed && seed.count) || 0,
        (seed && seed.items && seed.items.length) || 0,
    );
    let token = cleanText(index.token) || cleanText(seed && seed.token);
    // The seed page has no cursor only when it is the entire list; then the
    // refresh already saw everything and may prune removed items.
    let enumeratedToEnd = !cleanText(seed && seed.token);
    let pages = 0;
    let completed = false;
    // Enumeration is the bursty part of the run (the collection endpoint
    // only advances 20 items per request), so it is paced and capped per
    // visit; the resumed run below keeps the progress it made.
    const pageBudget = Math.min(
        Number(CONFIG.tagIndexMaxPages) || 0,
        Number(CONFIG.tagIndexPagesPerRun) || 0,
    );
    while (token && pages < pageBudget) {
        pages += 1;
        // The other list runs in parallel and may have just been rate
        // limited; its cooldown applies to this enumeration too.
        if (isTagIndexCoolingDown()) {
            index.itemsUpdatedAt = 0;
            markFanTagIndexDirty(fanId, kind, index, true);
            await flushTagIndexWrites();
            publishFanTagIndexDebug(fanId);
            return false;
        }
        if (!takeTagIndexPageSlot()) {
            // The shared page budget for this visit is spent; keep the
            // cursor for the next visit instead of promising more work.
            index.itemsUpdatedAt = 0;
            markFanTagIndexDirty(fanId, kind, index, true);
            await flushTagIndexWrites();
            publishFanTagIndexDebug(fanId);
            return false;
        }
        let page = null;
        try {
            await waitTagIndexTurn();
            page = await fetchFanCollectionItemsPage(fanId, kind, token);
        } catch (error) {
            // Keep whatever the seed and previous pages produced; the next
            // page load retries from the token we already hold.
            index.itemsUpdatedAt = 0;
            markFanTagIndexDirty(fanId, kind, index, true);
            await flushTagIndexWrites();
            if (isTagIndexRateLimitError(error)) {
                await activateTagIndexCooldown("items");
            }
            publishFanTagIndexDebug(fanId);
            return false;
        }

        page.items.forEach((item) => seenIds.add(item.id));
        index.refreshSeen = Array.from(seenIds);
        mergeFanTagIndexItems(index, page.items);
        // Persist the pages already merged: a tab closed mid-enumeration
        // used to lose everything since the last completed run.
        markFanTagIndexDirty(fanId, kind, index, true);
        if (!page.moreAvailable) {
            enumeratedToEnd = true;
            completed = true;
            break;
        }

        const nextToken = cleanText(page.token);
        if (!nextToken || nextToken === token) {
            // The cursor did not move. Retrying the same token on every
            // visit would never finish, so treat the reachable range as
            // complete and let the TTL refresh retry the tail later.
            markDebugState(
                "data-bcampx-tag-index-stuck",
                kind,
            );
            // Do not trust a dead cursor: restart from the seed on the
            // next visit instead of treating a partial list as complete.
            completed = false;
            token = "";
            break;
        }
        token = nextToken;
        index.token = token;
        await waitTagIndexDelay(CONFIG.tagIndexPagePauseMs);
    }

    if (!completed && token) {
        // The page budget ran out; the next visit resumes from here.
        index.token = token;
    } else if (
        !completed &&
        expected > 0 &&
        index.items.length >= expected
    ) {
        // A cursor died (or the page shipped none) after every reported
        // item had already been collected: nothing left to page.
        completed = true;
    } else if (!completed) {
        // Incomplete list with no usable cursor: restart from the seed.
        index.token = "";
    }

    if (completed) {
        // Pruning is only safe for a refresh that saw the whole list: one
        // stopped by its page budget has seen just a prefix, and one that
        // resumed without recorded progress cannot account for the batches
        // that ran before it.
        const canPrune =
            enumeratedToEnd &&
            (!resumed || resumedWithSeen) &&
            seenIds.size > 0;
        if (canPrune && index.items.length) {
            index.items = index.items.filter((item) =>
                seenIds.has(item.id),
            );
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

// Authoritative in-memory progress snapshot for the tag index. DOM
// data-bcampx-tag-index-* attributes are strictly one-way debug mirrors.
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

function updateTagIndexStats(patch) {
    if (!patch || typeof patch !== "object") {
        return;
    }
    if ("state" in patch) {
        tagIndexStats.state = String(patch.state || "");
        markDebugState("data-bcampx-tag-index-state", tagIndexStats.state);
    }
    if ("items" in patch) {
        tagIndexStats.items = Number(patch.items) || 0;
        markDebugState("data-bcampx-tag-index-items", String(tagIndexStats.items));
    }
    if ("tagged" in patch) {
        tagIndexStats.tagged = Number(patch.tagged) || 0;
        markDebugState("data-bcampx-tag-index-tagged", String(tagIndexStats.tagged));
    }
    if ("resolved" in patch) {
        tagIndexStats.resolved = Number(patch.resolved) || 0;
        markDebugState("data-bcampx-tag-index-resolved", String(tagIndexStats.resolved));
    }
    if ("failures" in patch) {
        tagIndexStats.failures = Number(patch.failures) || 0;
        markDebugState("data-bcampx-tag-index-failures", String(tagIndexStats.failures));
    }
    if ("itemsComplete" in patch) {
        tagIndexStats.itemsComplete = Boolean(patch.itemsComplete);
        markDebugState(
            "data-bcampx-tag-index-items-complete",
            String(tagIndexStats.itemsComplete),
        );
    }
    if ("pending" in patch) {
        tagIndexStats.pending = String(patch.pending || "");
        markDebugState("data-bcampx-tag-index-pending", tagIndexStats.pending);
    }
    if ("cooldownUntil" in patch) {
        tagIndexStats.cooldownUntil = Number(patch.cooldownUntil) || 0;
        markDebugState(
            "data-bcampx-tag-index-cooldown",
            String(tagIndexStats.cooldownUntil),
        );
    }
    if ("cooldownSource" in patch) {
        tagIndexStats.cooldownSource = String(patch.cooldownSource || "");
        markDebugState(
            "data-bcampx-tag-index-cooldown-source",
            tagIndexStats.cooldownSource,
        );
    }
}

// Publish counts while a run is in flight: the final totals only appear
// when the run finishes, which can be tens of seconds on a large collection.
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
            owner: isCurrentFanProfileOwner(),
            fanId: getFanTagFanId(),
            seed: seed
                ? {
                      collection:
                          (seed.kinds.collection &&
                              seed.kinds.collection.count) ||
                          0,
                      wishlist:
                          (seed.kinds.wishlist &&
                              seed.kinds.wishlist.count) ||
                          0,
                  }
                : null,
        };
    };
}

// Read progress from in-memory state instead of round-tripping through DOM attributes.
export function getTagIndexProgress() {
    return {
        items: tagIndexStats.items,
        tagged: tagIndexStats.tagged,
        resolved: tagIndexStats.resolved,
        state: tagIndexStats.state,
    };
}

function publishTagIndexSummary(extra = {}) {
    const items = tagIndexStats.items;
    const resolved = tagIndexStats.resolved;
    const itemsComplete = tagIndexStats.itemsComplete;
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
    statuses.forEach((status) => {
        items += Number(status && status.itemsCount) || 0;
        tagged += Number(status && status.taggedCount) || 0;
        resolved += Number(status && status.resolvedCount) || 0;
        failures += Object.keys(
            (status && status.failures) || {},
        ).length;
        if (!status || status.itemsComplete !== true) {
            complete = false;
        }
    });
    updateTagIndexStats({
        items,
        tagged,
        resolved,
        failures,
        itemsComplete: complete,
    });
    refreshTagSearchSettingProgress();
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
    ["collection", "wishlist"].forEach((kind) => {
        const key = `${fanId}:${kind}`;
        const index = (STATE.fanTagIndexCache || new Map()).get(key);
        if (index && Array.isArray(index.items)) {
            items += index.items.length;
            failures += Object.keys(index.failures || {}).length;
            index.items.forEach((item) => {
                const tags = getCachedReleaseTags(
                    getTagTralbumKey(item.tralbumType, item.tralbumId),
                );
                if (tags) {
                    resolved += 1;
                }
                if (tags && tags.length) {
                    tagged += 1;
                }
            });
            return;
        }

        // Only one grid may be loaded while the other is still pending;
        // fall back to its stored progress so the totals do not drop.
        const status = (STATE.tagIndexStatusByKind || {})[key];
        items += Number(status && status.itemsCount) || 0;
        tagged += Number(status && status.taggedCount) || 0;
        resolved += Number(status && status.resolvedCount) || 0;
        failures += Object.keys((status && status.failures) || {}).length;
    });
    updateTagIndexStats({ items, tagged, resolved, failures });
    refreshTagSearchSettingProgress();
    publishTagIndexSummary();
}

function notifyFanTagSearchIndexProgress(fanId, kind) {
    const query = cleanText(
        (STATE.tagSearchQueryByKind || {})[kind] || "",
    );
    if (!query || String(STATE.tagSearchFanId) !== String(fanId)) {
        return;
    }

    // The refresh itself is debounced, but a run completes many tags; keep
    // the UI work to roughly one update per second.
    const stampKey = `${fanId}:${kind}`;
    const now = Date.now();
    const last = Number(
        (STATE.tagSearchProgressNotifyAt || {})[stampKey],
    );
    if (last && now - last < 3000) {
        return;
    }
    STATE.tagSearchProgressNotifyAt = STATE.tagSearchProgressNotifyAt || {};
    STATE.tagSearchProgressNotifyAt[stampKey] = now;
    scheduleFanTagSearchRefresh(kind, 400);
}

function getTagIndexRequestLimiter() {
    if (!STATE.tagIndexRequestLimiter) {
        STATE.tagIndexRequestLimiter = createConcurrencyLimiter(
            () => CONFIG.tagIndexFetchConcurrency,
        );
    }
    return STATE.tagIndexRequestLimiter;
}

// One budget shared by collection and wishlist for the whole page, not
// per background batch: a visit never multiplies the request count by the
// number of indexes or batches it maintains.
function hasTagIndexFetchBudget() {
    const budget = Math.max(
        0,
        Math.floor(Number(CONFIG.tagIndexFetchesPerRun) || 0),
    );
    return !budget || STATE.tagIndexFetchesThisRun < budget;
}

function takeTagIndexFetchSlot() {
    if (!hasTagIndexFetchBudget()) {
        return false;
    }
    STATE.tagIndexFetchesThisRun += 1;
    return true;
}

// Pagination is network work too, but keeping it on the tag budget would
// let a long refresh starve the tag fill (or the reverse). Give it a
// smaller shared page budget instead.
function hasTagIndexPageBudget() {
    const budget = Math.max(
        0,
        Math.floor(Number(CONFIG.tagIndexPageFetchesPerRun) || 0),
    );
    return !budget || STATE.tagIndexPageFetchesThisRun < budget;
}

function takeTagIndexPageSlot() {
    if (!hasTagIndexPageBudget()) {
        return false;
    }
    STATE.tagIndexPageFetchesThisRun += 1;
    return true;
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
            Boolean(existing && existing.itemsChanged) ||
            itemsChanged === true,
    });
}

// Event-driven persistence: page walks, a finished tag fill and pagehide
// call this directly. Tag records themselves are written as they arrive.
export async function flushTagIndexWrites() {
    // Coverage counts come from the in-memory tag cache. Load it before
    // taking the queue so a failed read does not discard the entries.
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

    // Tags are already persisted per record; this only prunes expired or
    // over-cap records.
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

// A write that storage refuses is now a false result, not a swallowed
// rejection, so this is the one place the tag index reports it.
function markTagIndexWriteFailure(error) {
    markDebugState(
        "data-bcampx-tag-index-write-error",
        cleanText(error && error.message).slice(0, 120),
    );
}

async function fillFanTagIndexTags(fanId, kind, index) {
    await loadReleaseTagCache();

    // Paging already told us to back off. Starting (or continuing) tag
    // requests would extend the same rate limit and spend the budget the
    // cooldown is meant to protect.
    if (isTagIndexCoolingDown()) {
        return;
    }

    const pending = [];
    const pendingKeys = new Set();
    index.items.forEach((item) => {
        const key = getTagTralbumKey(item.tralbumType, item.tralbumId);
        if (
            !key ||
            pendingKeys.has(key) ||
            getCachedReleaseTags(key) ||
            isTagIndexFailureBackedOff(index, key)
        ) {
            return;
        }
        // Several purchases can share one tralbum (duplicate buys, a
        // package and its album); one request answers all of them.
        pendingKeys.add(key);
        pending.push({ item, key });
    });

    if (!pending.length) {
        // Nothing to fetch: never rewrite an already complete index.
        return;
    }

    const limit = getTagIndexRequestLimiter();
    if (!STATE.tagIndexInFlightKeys) {
        STATE.tagIndexInFlightKeys = new Set();
    }
    const inFlight = STATE.tagIndexInFlightKeys;
    const sliceSize = Math.max(
        12,
        Math.floor(Number(CONFIG.tagIndexFetchConcurrency) || 1) * 8,
    );
    let completed = 0;
    let failures = 0;
    let aborted = false;
    // Shared with the slice tasks: the first 429 must stop the requests
    // that are already waiting on the turnstile, not only the next slice.
    const runState = { aborted: false };

    for (let offset = 0; offset < pending.length; offset += sliceSize) {
        if (
            aborted ||
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
                    aborted ||
                    runState.aborted ||
                    !CONFIG.enableTagSearch ||
                    !hasTagIndexFetchBudget() ||
                    isTagIndexCoolingDown()
                ) {
                    return null;
                }
                await waitTagIndexTurn();
                if (
                    aborted ||
                    runState.aborted ||
                    !takeTagIndexFetchSlot() ||
                    isTagIndexCoolingDown()
                ) {
                    return null;
                }
                if (inFlight.has(entry.key)) {
                    return null;
                }
                inFlight.add(entry.key);
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
                    inFlight.delete(entry.key);
                }
            }),
        );
        let rateLimited = false;

        results.forEach((result) => {
            if (!result) {
                return;
            }
            if (result.rateLimited) {
                rateLimited = true;
                aborted = true;
                runState.aborted = true;
                return;
            }
            if (Array.isArray(result.tags)) {
                cacheReleaseTags(result.entry.key, result.tags);
                delete index.failures[result.entry.key];
                completed += 1;
                return;
            }
            failures += 1;
            index.failures[result.entry.key] = Date.now();
            if (failures >= 8) {
                aborted = true;
                runState.aborted = true;
            }
        });

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

function isTagIndexCoolingDown() {
    if (STATE.tagIndexRateLimited === true) {
        return true;
    }
    return Number(STATE.tagIndexCooldownUntil) > Date.now();
}

// A fresh index is only complete up to the first page. When the page
// reports more items than the index holds (a purchase of a full
// discography, for example), walk forward from the first page's cursor
// until the pages join the catalogue we already have.
async function refreshFanTagIndexRecentItems(fanId, kind, index, seed) {
    const known = new Set(index.items.map((item) => item.id));
    let token = cleanText(seed && seed.token);
    if (!token) {
        return false;
    }

    const pageBudget = Math.min(
        Number(CONFIG.tagIndexMaxPages) || 0,
        Number(CONFIG.tagIndexPagesPerRun) || 0,
    );
    let pages = 0;
    let connected = false;
    let reachedEnd = false;
    let added = 0;

    while (token && pages < pageBudget) {
        pages += 1;
        // Respect a cooldown the parallel list may have just triggered.
        if (isTagIndexCoolingDown()) {
            return false;
        }
        if (!takeTagIndexPageSlot()) {
            return false;
        }
        let page = null;
        try {
            await waitTagIndexTurn();
            page = await fetchFanCollectionItemsPage(fanId, kind, token);
        } catch (error) {
            if (isTagIndexRateLimitError(error)) {
                await activateTagIndexCooldown("items");
            }
            return false;
        }

        // Everything on this page is already known: the walk has joined
        // the existing catalogue, so there is nothing new below it.
        const allKnown =
            page.items.length > 0 &&
            page.items.every((item) => known.has(item.id));
        const previousLength = index.items.length;
        mergeFanTagIndexItems(index, page.items);
        added += index.items.length - previousLength;
        page.items.forEach((item) => known.add(item.id));
        index.itemsUpdatedAt = Date.now();
        markFanTagIndexDirty(fanId, kind, index, true);

        if (allKnown) {
            connected = true;
            break;
        }
        if (!page.moreAvailable) {
            reachedEnd = true;
            break;
        }

        const nextToken = cleanText(page.token);
        if (!nextToken || nextToken === token) {
            break;
        }
        token = nextToken;
        await waitTagIndexDelay(CONFIG.tagIndexPagePauseMs);
    }

    if (!connected && !reachedEnd) {
        // Could not prove coverage: let the next visit continue the full
        // refresh instead of claiming the index is complete.
        return false;
    }

    index.itemsComplete = true;
    index.token = "";
    await flushTagIndexWrites();
    markDebugState("data-bcampx-tag-index-recent-added", String(added));
    return true;
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
        // The current page explicitly reports an empty list. Store the
        // empty catalogue: skipping the kind left the previous one
        // searchable forever because the TTL refresh never touched it.
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
        const refreshed = await refreshFanTagIndexItems(
            seed.fanId,
            kind,
            index,
            kindSeed,
        );
        // A pagination 429 already set the shared cooldown. Do not follow
        // it with the tag requests that the paging failure was telling us
        // to stop sending.
        if (refreshed === false && isTagIndexCoolingDown()) {
            markFanTagIndexDirty(seed.fanId, kind, index, true);
            await flushTagIndexWrites();
            return {
                items: index.items.length,
                tagged: countFanTagIndexTagged(index),
                itemsComplete: index.itemsComplete === true,
            };
        }
    } else if (
        kindSeed.items.length &&
        mergeFanTagIndexItems(index, kindSeed.items)
    ) {
        markFanTagIndexDirty(seed.fanId, kind, index, true);
    }

    // A complete index that nonetheless holds fewer items than the page
    // reports is missing the range between the first page and the old
    // catalogue; merge-and-stop used to leave those items unfindable.
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
        await refreshFanTagIndexRecentItems(
            seed.fanId,
            kind,
            index,
            kindSeed,
        );
    }

    await fillFanTagIndexTags(seed.fanId, kind, index);

    let tagged = 0;
    index.items.forEach((item) => {
        const tags = getCachedReleaseTags(
            getTagTralbumKey(item.tralbumType, item.tralbumId),
        );
        if (tags && tags.length) {
            tagged += 1;
        }
    });

    return {
        items: index.items.length,
        tagged,
        itemsComplete: index.itemsComplete === true,
    };
}

function countFanTagIndexTagged(index) {
    if (!index || !Array.isArray(index.items)) {
        return 0;
    }
    let tagged = 0;
    index.items.forEach((item) => {
        const tags = getCachedReleaseTags(
            getTagTralbumKey(item.tralbumType, item.tralbumId),
        );
        if (tags && tags.length) {
            tagged += 1;
        }
    });
    return tagged;
}

async function runFanTagIndexBuild(options = {}) {
    const background = options.background === true;
    if (STATE.tagIndexRunActive) {
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
        try {
            fanId = Number(await storageGet(TAG_INDEX_OWNER_KEY, 0)) || 0;
        } catch (_error) {
            fanId = 0;
        }
        if (!fanId) {
            return;
        }
        kinds = ["collection", "wishlist"];
    } else {
        if (!isCurrentFanProfileOwner()) {
            setTagIndexState("skipped-owner");
            return;
        }
        seed = readFanTagPageSeed({ includeDom: true });
        if (!seed) {
            setTagIndexState("skipped-page");
            return;
        }
        fanId = seed.fanId;
        // A kind the page explicitly reports as empty must still be
        // visited: it is the only signal that lets a cleared wishlist
        // replace its old index instead of leaving it searchable.
        kinds = ["collection", "wishlist"].filter((kind) => {
            const kindSeed = seed.kinds[kind];
            return Boolean(
                kindSeed && (kindSeed.count > 0 || kindSeed.hasData),
            );
        });
        if (!kinds.length) {
            setTagIndexState("skipped-empty");
            return;
        }
        const seedIds = {};
        kinds.forEach((kind) => {
            seedIds[`${fanId}:${kind}`] = (seed.kinds[kind].items || [])
                .map((item) => String(item.id))
                .join(",");
        });
        STATE.tagIndexSeedIds = seedIds;
    }

    await ensureTagIndexPacing();

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
        kinds.map((kind) =>
            loadFanTagIndexStatus(fanId, kind).catch(() => null),
        ),
    );
    STATE.tagIndexStatusByKind = STATE.tagIndexStatusByKind || {};
    kinds.forEach((kind, position) => {
        STATE.tagIndexStatusByKind[`${fanId}:${kind}`] =
            statuses[position];
    });
    let pendingKinds = kinds.filter((kind, position) => {
        const status = statuses[position];
        if (background) {
            if (!status || status.itemsComplete !== true) {
                return false;
            }
            const items = Number(status.itemsCount) || 0;
            return (
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
        // The status record is written every few seconds while the tag
        // cache is written less often (and a closing page may miss it).
        // Before claiming "up to date", confirm the items really are in
        // the cache, otherwise the index would never fill the gap.
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
                markDebugState(
                    "data-bcampx-tag-index-repair",
                    kind,
                );
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
        try {
            await storageSet(TAG_INDEX_OWNER_KEY, fanId);
        } catch (_error) {
            // Only affects background continuation from other pages.
        }
    }
    STATE.tagIndexRunActive = true;
    STATE.tagIndexBatchesThisPage =
        (Number(STATE.tagIndexBatchesThisPage) || 0) + 1;
    markDebugState(
        "data-bcampx-tag-index-batches",
        String(STATE.tagIndexBatchesThisPage),
    );
    setTagIndexState("running");
    try {
        const results = await Promise.all(
            pendingKinds.map((kind) => {
                const work = background
                    ? loadFanTagIndex(fanId, kind).then((index) =>
                          fillFanTagIndexTags(fanId, kind, index).then(
                              () => ({
                                  items: index.items.length,
                                  tagged: countFanTagIndexTagged(index),
                                  itemsComplete:
                                      index.itemsComplete === true,
                              }),
                          ),
                      )
                    : buildFanTagIndexForKind(seed, kind);
                return work.catch((error) => {
                    markDebugState(
                        "data-bcampx-tag-index-error",
                        cleanText(error && error.message).slice(0, 140),
                    );
                    return {
                        items: 0,
                        tagged: 0,
                        itemsComplete: false,
                    };
                });
            }),
        );
        if (background) {
            publishFanTagIndexDebug(fanId);
        } else {
            let totalItems = results.reduce(
                (sum, result) => sum + (result.items || 0),
                0,
            );
            let totalTagged = results.reduce(
                (sum, result) => sum + (result.tagged || 0),
                0,
            );
            kinds.forEach((kind, position) => {
                if (pendingKinds.includes(kind)) {
                    return;
                }
                const status = statuses[position];
                totalItems += Number(status && status.itemsCount) || 0;
                totalTagged += Number(status && status.taggedCount) || 0;
            });
            const allComplete = kinds.every((kind, position) => {
                const pending = pendingKinds.includes(kind);
                if (pending) {
                    const result = results[pendingKinds.indexOf(kind)];
                    return Boolean(result && result.itemsComplete);
                }
                const status = statuses[position];
                return Boolean(status && status.itemsComplete === true);
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
            if (STATE.tagIndexFetchesThisRun > 0) {
                await adjustTagIndexPacing(0.9);
            }
        }
    } finally {
        try {
            await flushTagIndexWrites();
        } finally {
            STATE.tagIndexRunActive = false;
        }
        if (!STATE.tagIndexRateLimited) {
            scheduleFanTagIndexBatch(fanId, kinds);
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
            STATE.tagIndexBackgroundScheduled ||
            isCurrentFanCollectionPage() ||
            window.top !== window
        ) {
            return;
        }
        STATE.tagIndexBackgroundScheduled = true;
    } else {
        if (STATE.tagIndexRunScheduled) {
            return;
        }
        STATE.tagIndexRunScheduled = true;
        setTagIndexState("scheduled");
    }

    window.setTimeout(() => {
        if (background) {
            STATE.tagIndexBackgroundScheduled = false;
        } else {
            STATE.tagIndexRunTimer = 0;
        }
        void runFanTagIndexBuild({ background })
            .catch(() => {})
            .finally(() => {
                if (!background) {
                    STATE.tagIndexRunScheduled = false;
                }
            });
    }, Math.max(0, Number(delayMs) || 0));
}

export function scheduleFanTagBackgroundFill() {
    scheduleFanTagIndexRun(
        Math.max(
            5000,
            Number(CONFIG.tagIndexBackgroundStartDelayMs) || 15000,
        ),
        { background: true },
    );
}

async function fanTagIndexHasPendingWork(fanId, kinds) {
    const statuses = await Promise.all(
        kinds.map((kind) =>
            loadFanTagIndexStatus(fanId, kind).catch(() => null),
        ),
    );
    return kinds.some((_kind, position) => {
        const status = statuses[position];
        if (!status || status.itemsComplete !== true) {
            return true;
        }
        const itemsCount = Number(status.itemsCount) || 0;
        const resolvedCount = Number(status.resolvedCount) || 0;
        // A complete, empty list (a cleared wishlist) has nothing left to
        // fetch; treating zero items as "pending" scheduled an endless
        // chain of no-op batches after the empty index was stored.
        return itemsCount > 0 && resolvedCount < itemsCount;
    });
}

function scheduleFanTagIndexBatch(fanId, kinds) {
    if (
        !CONFIG.enableTagSearch ||
        STATE.tagIndexBatchTimer ||
        STATE.tagIndexRateLimited ||
        !hasTagIndexFetchBudget() ||
        STATE.tagIndexBatchesThisPage >=
            (Number(CONFIG.tagIndexMaxBatchesPerPage) || 0)
    ) {
        return;
    }

    STATE.tagIndexBatchTimer = window.setTimeout(() => {
        STATE.tagIndexBatchTimer = 0;
        void fanTagIndexHasPendingWork(fanId, kinds)
            .then((pending) => {
                if (!pending || STATE.tagIndexRateLimited) {
                    return;
                }
                markDebugState(
                    "data-bcampx-tag-index-batches",
                    String(STATE.tagIndexBatchesThisPage + 1),
                );
                scheduleFanTagIndexRun(0, {
                    background: !isCurrentFanCollectionPage(),
                });
            })
            .catch(() => {});
    }, Math.max(5000, Number(CONFIG.tagIndexBatchPauseMs) || 30000));
}

function getNormalizedTagList(tags) {
    if (!Array.isArray(tags) || !tags.length) {
        return [];
    }

    if (!STATE.releaseTagNormCache) {
        STATE.releaseTagNormCache = new WeakMap();
    }
    const cached = STATE.releaseTagNormCache.get(tags);
    if (cached && cached.length === tags.length) {
        return cached;
    }

    const normalized = tags.map((tag) => normalizeTagQuery(tag));
    STATE.releaseTagNormCache.set(tags, normalized);
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
    index.items.forEach((item) => {
        const key = getTagTralbumKey(item.tralbumType, item.tralbumId);
        const tags = getCachedReleaseTags(key);
        if (!tags || !tags.length) {
            return;
        }

        // The normalized copy is cached per tag array, so repeat keystrokes
        // reuse it instead of re-normalizing thousands of tags.
        const normalizedTags = getNormalizedTagList(tags);
        const hits = [];
        for (const token of tokens) {
            const tagIndex = normalizedTags.findIndex((tag) =>
                tag.includes(token),
            );
            if (tagIndex < 0) {
                return;
            }
            if (!hits.includes(tags[tagIndex])) {
                hits.push(tags[tagIndex]);
            }
        }

        matches.push({
            item,
            tags: hits,
            exact: normalizedTags.includes(normalized),
        });
    });

    matches.sort(
        (left, right) => Number(right.exact) - Number(left.exact),
    );

    return matches.slice(0, Math.max(1, Number(CONFIG.maxTagSearchMatches) || 1));
}

function getFanSearchGridKind(grid) {
    const gridContainer = grid && grid.closest(".grid");
    const gridId = cleanText(gridContainer && gridContainer.id);
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
    const queries = STATE.tagSearchQueryByKind || {};
    if (
        !cleanText(queries.collection) &&
        !cleanText(queries.wishlist)
    ) {
        // The common case (no tag search) must not run a single DOM query.
        return null;
    }

    const grid = findFanCollectionActiveGrid();
    const kind = getFanSearchGridKind(grid);
    if (!kind) {
        return null;
    }

    const query = cleanText(
        (STATE.tagSearchQueryByKind || {})[kind] || "",
    );
    const matches = (STATE.tagSearchMatchesByKind || {})[kind] || [];
    if (!query || !matches.length) {
        return null;
    }

    // The feed sync and the native block ask for this twice in the same
    // tick; share the resolution and its native-item map.
    const cached = STATE.tagSearchStateCache;
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
    STATE.tagSearchStateCache = state;
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

// Only the grid the search belongs to matters: the same release can be both
// collected and wishlisted, and the two cards differ.
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

// Every tag match for the active query, deduplicated by release URL and
// preferring the native card when the release is already on the page.
// Known releases are skipped before a candidate object is built.
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

    active.matches.forEach((match) => {
        const item = match && match.item;
        if (!item) {
            return;
        }

        const itemUrl = item.url || "";
        const itemKey = `${item.type || "album"}:${item.id || ""}`;
        if (skipUrls && itemUrl && skipUrls.has(itemUrl)) {
            return;
        }
        if (skipItems && skipItems.has(itemKey)) {
            return;
        }
        if (itemUrl && seenUrls.has(itemUrl)) {
            return;
        }

        const nativeItem = nativeItems.get(String(item.id));
        const release = nativeItem
            ? buildFanTagSearchNativeRelease(nativeItem, feedKind)
            : buildFanTagSearchRelease(match, feedKind);
        if (!release) {
            return;
        }

        // Index records already hold a normalized URL; only native-derived
        // releases need re-normalizing.
        const releaseUrl =
            release.tagOrigin === "native"
                ? normalizeReleaseUrl(release.releaseUrl || "")
                : cleanText(release.releaseUrl || "");
        if (
            releaseUrl &&
            ((skipUrls && skipUrls.has(releaseUrl)) ||
                seenUrls.has(releaseUrl))
        ) {
            return;
        }
        if (releaseUrl) {
            seenUrls.add(releaseUrl);
        }
        releases.push(release);
    });

    return releases;
}

function getFanTagSearchVisibleLimit(kind) {
    const initial = Math.max(
        1,
        Number(CONFIG.tagSearchInitialResults) || 80,
    );
    const stored = Number(
        (STATE.tagSearchVisibleLimitByKind || {})[kind],
    );
    return Math.max(initial, stored || initial);
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
    if (!active || !feedContext) {
        return;
    }
    const feedKind = cleanText(feedContext.kind || "");
    if (feedKind !== `fan-${active.kind}`) {
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
        STATE.tagSearchVisibleLimitByKind =
            STATE.tagSearchVisibleLimitByKind || {};
        STATE.tagSearchVisibleLimitByKind[active.kind] =
            visible + (Number(CONFIG.tagSearchInitialResults) || 80);
        refreshFanTagSearchResults();
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
    (Array.isArray(existingReleases) ? existingReleases : []).forEach(
        (release) => {
            if (!release) {
                return;
            }
            const releaseUrl = normalizeReleaseUrl(release.releaseUrl || "");
            if (releaseUrl) {
                knownUrls.add(releaseUrl);
            }
            if (release.itemId && release.itemType) {
                knownItems.add(`${release.itemType}:${release.itemId}`);
            }
        },
    );

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

function findFanSearchInputContainer(input) {
    if (!(input instanceof Element)) {
        return null;
    }
    return input.closest(
        "#collection-search, #wishlist-search, .collection-search, .wishlist-search",
    );
}

function getFanSearchInputKind(input) {
    const container = findFanSearchInputContainer(input);
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
    if (!kind) {
        return;
    }

    scheduleFanTagSearchQuery(kind, input.value || "");
}

function scheduleFanTagSearchQuery(kind, value) {
    if (!kind) {
        return;
    }

    STATE.tagSearchPendingQuery = { kind, value: cleanText(value) };
    if (STATE.tagSearchDebounceTimer) {
        window.clearTimeout(STATE.tagSearchDebounceTimer);
    }
    STATE.tagSearchDebounceTimer = window.setTimeout(() => {
        STATE.tagSearchDebounceTimer = 0;
        const pending = STATE.tagSearchPendingQuery;
        STATE.tagSearchPendingQuery = null;
        if (pending) {
            void applyFanTagSearchQuery(pending.kind, pending.value);
        }
    }, 160);
}

function scheduleFanTagSearchRefresh(kind, delayMs) {
    if (!kind) {
        return;
    }

    if (!STATE.tagSearchRefreshTimers) {
        STATE.tagSearchRefreshTimers = {};
    }
    if (STATE.tagSearchRefreshTimers[kind]) {
        window.clearTimeout(STATE.tagSearchRefreshTimers[kind]);
        STATE.tagSearchRefreshTimers[kind] = 0;
    }

    STATE.tagSearchRefreshTimers[kind] = window.setTimeout(() => {
        STATE.tagSearchRefreshTimers[kind] = 0;
        const query = cleanText(
            (STATE.tagSearchQueryByKind || {})[kind] || "",
        );
        if (!query) {
            return;
        }
        void applyFanTagSearchQuery(kind, query);
    }, Math.max(0, Number(delayMs) || 0));
}

async function applyFanTagSearchQuery(kind, value) {
    if (!kind) {
        return;
    }

    const fanId = getFanTagFanId();
    const query = cleanText(value);

    if (!STATE.tagSearchQueryByKind) {
        STATE.tagSearchQueryByKind = { collection: "", wishlist: "" };
    }
    if (!STATE.tagSearchMatchesByKind) {
        STATE.tagSearchMatchesByKind = { collection: [], wishlist: [] };
    }

    const previousQuery = cleanText(
        (STATE.tagSearchQueryByKind || {})[kind] || "",
    );
    if (!STATE.tagSearchVisibleLimitByKind) {
        STATE.tagSearchVisibleLimitByKind = {};
    }
    if (previousQuery !== query) {
        STATE.tagSearchVisibleLimitByKind[kind] =
            Number(CONFIG.tagSearchInitialResults) || 80;
    }
    STATE.tagSearchQueryByKind[kind] = query;
    STATE.tagSearchFanId = fanId;
    if (!STATE.tagSearchSeqByKind) {
        STATE.tagSearchSeqByKind = { collection: 0, wishlist: 0 };
    }
    STATE.tagSearchSeqByKind[kind] =
        (Number(STATE.tagSearchSeqByKind[kind]) || 0) + 1;
    const requestSeq = STATE.tagSearchSeqByKind[kind];

    let matches = [];
    if (fanId && query) {
        matches = await findFanTagSearchMatches(fanId, kind, query);
    }

    // A slower lookup for an older query must not overwrite a newer one.
    if (
        requestSeq !== STATE.tagSearchSeqByKind[kind] ||
        cleanText(STATE.tagSearchQueryByKind[kind]) !== query
    ) {
        return;
    }

    STATE.tagSearchMatchesByKind[kind] = matches;

    const signature = [
        kind,
        query,
        matches.map((match) => match.item.id).join(","),
    ].join("|");
    const changed =
        (STATE.tagSearchSignatureByKind || {})[kind] !== signature;
    STATE.tagSearchSignatureByKind = STATE.tagSearchSignatureByKind || {};
    STATE.tagSearchSignatureByKind[kind] = signature;

    markDebugState("data-bcampx-tag-search-query", query);
    markDebugState("data-bcampx-tag-search-matches", String(matches.length));

    // Background indexing notifies after every batch; only touch the page
    // when the visible result set actually changed.
    if (changed) {
        refreshFanTagSearchResults();
    }
}

function refreshFanTagSearchResults() {
    scheduleArtistMusicFeedSync();
}

function primeFanTagSearchFromInputs() {
    if (!CONFIG.enableTagSearch) {
        return;
    }
    ["collection", "wishlist"].forEach((kind) => {
        const input = document.querySelector(`#${kind}-search input`);
        if (input instanceof HTMLInputElement && cleanText(input.value)) {
            scheduleFanTagSearchQuery(kind, input.value);
        }
    });
}

export function applyTagSearchSetting() {
    if (!isCurrentFanCollectionPage()) {
        return;
    }

    if (CONFIG.enableTagSearch) {
        setupFanTagSearch();
        // The bridge is bound once; enabling again after a runtime toggle
        // still needs the background build scheduled.
        scheduleFanTagIndexRun(Number(CONFIG.tagIndexStartDelayMs) || 0);
        primeFanTagSearchFromInputs();
        return;
    }

    if (STATE.tagIndexRunTimer) {
        window.clearTimeout(STATE.tagIndexRunTimer);
        STATE.tagIndexRunTimer = 0;
    }
    STATE.tagIndexRunScheduled = false;
    STATE.tagSearchQueryByKind = { collection: "", wishlist: "" };
    STATE.tagSearchMatchesByKind = { collection: [], wishlist: [] };
    STATE.tagSearchSignatureByKind = {};
    setTagIndexState("disabled");
    refreshFanTagSearchResults();
}

function refreshActiveTagSearchesFromStorage() {
    if (
        !CONFIG.enableTagSearch ||
        document.visibilityState === "hidden"
    ) {
        return;
    }
    // Only re-read the tag records when a tag query is actually showing;
    // otherwise returning to the tab would load every record for nothing.
    const hasActiveQuery = ["collection", "wishlist"].some((kind) =>
        cleanText(
            (STATE.tagSearchQueryByKind || {})[kind] || "",
        ),
    );
    if (!hasActiveQuery) {
        return;
    }
    // Re-reading every tag record is expensive. Leaving and returning to
    // the tab does not need a full refresh every few seconds; a new tag
    // query or the run's final flush covers the normal path.
    if (
        Date.now() - (Number(STATE.releaseTagCacheLoadedAt) || 0) <
        120000
    ) {
        return;
    }
    void refreshReleaseTagCache().then((changed) => {
        if (!changed) {
            return;
        }
        ["collection", "wishlist"].forEach((kind) => {
            const query = cleanText(
                (STATE.tagSearchQueryByKind || {})[kind] || "",
            );
            if (query) {
                void applyFanTagSearchQuery(kind, query);
            }
        });
    }, () => {
        // A failed refresh only means the in-memory snapshot stays in use.
    });
}

export function setupFanTagSearch() {
    exposeFanTagIndexDebugHook();
    if (STATE.tagSearchListenersBound) {
        return;
    }
    if (!CONFIG.enableTagSearch) {
        if (isBandcampFanProfileUrl(location.href)) {
            setTagIndexState("disabled");
        }
        return;
    }
    if (!isCurrentFanCollectionPage()) {
        // Breadcrumb for support: a fan profile page that is not showing a
        // collection/wishlist view never schedules the index.
        if (isBandcampFanProfileUrl(location.href)) {
            setTagIndexState(
                isCurrentFanProfileOwner()
                    ? "not-collection-page"
                    : "viewer-not-owner",
            );
        }
        return;
    }

    STATE.tagSearchListenersBound = true;
    markDebugState("data-bcampx-tag-search-setup", "bound");
    // Capture phase: Bandcamp's own jQuery handler also reacts to the same
    // input event, and its tab switch must not hide our state.
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
    // Back/forward navigation can restore the tab and its search term
    // without firing an input event.
    primeFanTagSearchFromInputs();
}
