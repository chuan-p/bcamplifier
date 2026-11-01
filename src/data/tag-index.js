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

    function isTagRecordStore() {
        return STATE.releaseTagStoreMode === "records";
    }

    function persistTagRecord(key, entry) {
        if (!key || !entry) {
            return;
        }
        if (isTagRecordStore()) {
            void storageSet(TAG_RECORD_PREFIX + key, entry);
            return;
        }
        if (!STATE.releaseTagStoreMode) {
            // The store mode is decided by the first load; write the record
            // afterwards if the host supports per-record storage.
            void loadReleaseTagCache().then(() => {
                if (isTagRecordStore()) {
                    void storageSet(TAG_RECORD_PREFIX + key, entry);
                }
            });
        }
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

    function getTagTralbumKey(tralbumType, tralbumId) {
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
        // only changes when the collection does, while progress changes on every
        // checkpoint.
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
        // Entries written before the split kept progress beside the items.
        const legacy = (name) =>
            status[name] !== undefined ? status[name] : raw[name];

        const index = {
            items,
            token: cleanText(raw.token),
            itemsComplete: raw.itemsComplete === true,
            itemsUpdatedAt: Number(raw.itemsUpdatedAt) || 0,
            failures:
                legacy("failures") &&
                typeof legacy("failures") === "object" &&
                !Array.isArray(legacy("failures"))
                    ? legacy("failures")
                    : {},
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

    async function saveFanTagIndexItems(fanId, kind, index) {
        if (!fanId || !kind || !index) {
            return;
        }
        rememberFanTagIndex(fanId, kind, index);
        await storageSet(getTagIndexStorageKey(fanId, kind), {
            version: TAG_INDEX_VERSION,
            items: index.items,
            token: index.token,
            itemsComplete: index.itemsComplete,
            itemsUpdatedAt: index.itemsUpdatedAt,
        });
    }

    async function saveFanTagIndexStatus(fanId, kind, index) {
        if (!fanId || !kind || !index) {
            return;
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
        await storageSet(getTagIndexStatusKey(fanId, kind), {
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
        if (!status || !kindSeed || !kindSeed.count) {
            return false;
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

    async function migrateTagRecords(entries) {
        for (let index = 0; index < entries.length; index += 100) {
            await Promise.all(
                entries.slice(index, index + 100).map(([key, entry]) => {
                    const current =
                        STATE.releaseTagCache &&
                        STATE.releaseTagCache[key];
                    const value =
                        current &&
                        Number(current.ts) > Number(entry.ts)
                            ? current
                            : entry;
                    return storageSet(TAG_RECORD_PREFIX + key, value);
                }),
            );
            // Let the page breathe between batches; the migration is a
            // one-time upgrade task, not something the first paint needs.
            await new Promise((resolve) => {
                if (typeof window.requestIdleCallback === "function") {
                    window.requestIdleCallback(resolve, { timeout: 300 });
                    return;
                }
                window.setTimeout(resolve, 40);
            });
        }
        await storageDelete(RELEASE_TAGS_KEY);
    }

    async function loadReleaseTagCache() {
        if (STATE.releaseTagCache) {
            return STATE.releaseTagCache;
        }

        const startedAt = window.performance.now();
        let migrated = 0;
        let records = null;
        try {
            records = await storageGetByPrefix(TAG_RECORD_PREFIX);
        } catch (_error) {
            records = null;
        }
        if (records && typeof records === "object") {
            STATE.releaseTagStoreMode = "records";
            const cache = {};
            Object.keys(records).forEach((key) => {
                if (!key.startsWith(TAG_RECORD_PREFIX)) {
                    return;
                }
                const entry = records[key];
                if (entry && Array.isArray(entry.tags)) {
                    cache[key.slice(TAG_RECORD_PREFIX.length)] = entry;
                }
            });

            // One-time migration from the monolithic blob, and a repair path
            // for an interrupted migration: merge entries the records lack.
            let legacy = null;
            try {
                legacy = await storageGet(RELEASE_TAGS_KEY, null);
            } catch (_error) {
                legacy = null;
            }
            if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
                const entries = [];
                Object.keys(legacy).forEach((key) => {
                    const entry = legacy[key];
                    if (!entry || !Array.isArray(entry.tags)) {
                        return;
                    }
                    const existing = cache[key];
                    if (
                        !existing ||
                        Number(entry.ts) > Number(existing.ts)
                    ) {
                        cache[key] = entry;
                        entries.push([key, entry]);
                    }
                });
                migrated = entries.length;
                // Migrate in the background: the in-memory cache is already
                // usable, and awaiting thousands of record writes here made
                // the first collection load after the upgrade stutter.
                if (entries.length) {
                    void migrateTagRecords(entries).catch(() => {});
                }
            }

            STATE.releaseTagCache = cache;
            STATE.releaseTagCacheLoadedAt = Date.now();
            markDebugState(
                "data-bcampx-tag-cache-load-ms",
                String(Math.round(window.performance.now() - startedAt)),
            );
            markDebugState("data-bcampx-tag-migration", String(migrated));
            return STATE.releaseTagCache;
        }

        STATE.releaseTagStoreMode = "blob";
        const raw = await storageGet(RELEASE_TAGS_KEY, null);
        STATE.releaseTagCache =
            raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
        STATE.releaseTagCacheLoadedAt = Date.now();
        return STATE.releaseTagCache;
    }

    // Another tab may have fetched tags since this page loaded; merge them in
    // so a search does not keep using a stale snapshot.
    async function refreshReleaseTagCache() {
        await loadReleaseTagCache();
        if (isTagRecordStore()) {
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
                    Number(storedEntry.ts) >
                        Number(memoryEntry.ts)
                ) {
                    STATE.releaseTagCache[cacheKey] = storedEntry;
                }
            });
            STATE.releaseTagCacheLoadedAt = Date.now();
            return true;
        }

        let raw = null;
        try {
            raw = await storageGet(RELEASE_TAGS_KEY, null);
        } catch (_error) {
            return false;
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return false;
        }
        Object.keys(raw).forEach((key) => {
            const storedEntry = raw[key];
            const memoryEntry = STATE.releaseTagCache[key];
            if (
                !memoryEntry ||
                Number(storedEntry && storedEntry.ts) >
                    Number(memoryEntry && memoryEntry.ts)
            ) {
                STATE.releaseTagCache[key] = storedEntry;
            }
        });
        STATE.releaseTagCacheLoadedAt = Date.now();
        return true;
    }

    function getCachedReleaseTags(key) {
        const entry = key && STATE.releaseTagCache
            ? STATE.releaseTagCache[key]
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
    function harvestTagsFromReleaseData(release, tags) {
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

        if (!STATE.releaseTagCache) {
            STATE.releaseTagCache = {};
        }
        const entry = {
            tags: tags.slice(0, 24),
            ts: Date.now(),
        };
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
        if (!STATE.releaseTagCache) {
            return true;
        }

        const before = Object.keys(STATE.releaseTagCache);
        const pruned = pruneReleaseTagCache(STATE.releaseTagCache);
        STATE.releaseTagCache = pruned;

        if (isTagRecordStore()) {
            // Records are written as their tags are fetched; here only drop
            // the expired/over-cap ones from storage.
            before.forEach((key) => {
                if (!Object.prototype.hasOwnProperty.call(pruned, key)) {
                    void storageDelete(TAG_RECORD_PREFIX + key);
                }
            });
            STATE.releaseTagCacheLoadedAt = Date.now();
            return true;
        }

        // Blob fallback: merge whatever was stored since this page loaded so
        // the last writer cannot drop entries another tab just fetched; the
        // newer ts wins per tralbum.
        let stored = null;
        let readFailed = false;
        try {
            stored = await storageGet(RELEASE_TAGS_KEY, null);
        } catch (_error) {
            readFailed = true;
        }
        if (readFailed) {
            return false;
        }
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
            Object.keys(stored).forEach((key) => {
                const storedEntry = stored[key];
                const memoryEntry = STATE.releaseTagCache[key];
                if (
                    !memoryEntry ||
                    Number(storedEntry && storedEntry.ts) >
                        Number(memoryEntry && memoryEntry.ts)
                ) {
                    STATE.releaseTagCache[key] = storedEntry;
                }
            });
        }

        const merged = pruneReleaseTagCache(STATE.releaseTagCache);
        STATE.releaseTagCache = merged;
        await storageSet(RELEASE_TAGS_KEY, merged);
        STATE.releaseTagCacheLoadedAt = Date.now();
        return true;
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

    // One-shot diagnostic: does the collection endpoint already serialize the
    // release tags? If it does, the per-release fill can be replaced by the
    // enumeration itself. Opt in with localStorage["bcampx-tag-source-check"].
    async function runTagSourceCheck() {
        try {
            if (
                window.localStorage.getItem("bcampx-tag-source-check") !==
                "1"
            ) {
                return;
            }
        } catch (_error) {
            return;
        }
        if (!isCurrentFanProfileOwner()) {
            markDebugState("data-bcampx-tag-source-check", "not-owner");
            return;
        }
        const fanId = getFanTagFanId();
        if (!fanId) {
            markDebugState("data-bcampx-tag-source-check", "no-fan-id");
            return;
        }

        let pageToken = "";
        try {
            const pageData = parseJsonAttribute(
                document.querySelector("#pagedata[data-blob]"),
                "data-blob",
            );
            pageToken = cleanText(
                pageData &&
                    pageData.collection_data &&
                    pageData.collection_data.last_token,
            );
        } catch (_error) {
            pageToken = "";
        }

        const attempts = [];
        let first = null;
        for (const token of [pageToken, ""]) {
            if (
                token === "" &&
                attempts.some((attempt) => attempt.token === "empty")
            ) {
                continue;
            }
            try {
                await waitTagIndexTurn();
                const raw = await requestJson(
                    "https://bandcamp.com/api/fancollection/1/collection_items",
                    {
                        method: "POST",
                        credentials: "include",
                        data: JSON.stringify({
                            fan_id: fanId,
                            older_than_token: token,
                            count: 20,
                        }),
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json, text/javascript, */*; q=0.01",
                        },
                    },
                );
                attempts.push({
                    token: token ? "page" : "empty",
                    keys:
                        raw && typeof raw === "object"
                            ? Object.keys(raw)
                            : null,
                    error: Boolean(raw && raw.error),
                    errorMessage: cleanText(
                        raw && (raw.error_message || raw.message),
                    ),
                    items:
                        raw && Array.isArray(raw.items)
                            ? raw.items.length
                            : 0,
                });
                if (raw && Array.isArray(raw.items) && raw.items.length) {
                    first = raw.items[0];
                    break;
                }
            } catch (error) {
                attempts.push({
                    token: token ? "page" : "empty",
                    error: cleanText(error && error.message).slice(0, 120),
                });
            }
        }

        if (!first) {
            markDebugState(
                "data-bcampx-tag-source-check",
                JSON.stringify({ attempts }).slice(0, 1800),
            );
            return;
        }

        const tralbumId = Number(first.tralbum_id || first.tralbumId || 0);
        const bandId = Number(first.band_id || first.bandId || 0);
        const tralbumType =
            cleanText(first.tralbum_type || first.tralbumType || "a")
                .toLowerCase() === "t"
                ? "t"
                : "a";
        let detailTags = [];
        if (tralbumId && bandId) {
            try {
                await waitTagIndexTurn();
                const detail = await requestJson(
                    "https://bandcamp.com/api/mobile/24/tralbum_details" +
                        `?band_id=${bandId}&tralbum_id=${tralbumId}` +
                        `&tralbum_type=${tralbumType}`,
                    {
                        credentials: "include",
                        headers: {
                            Accept: "application/json, text/javascript, */*; q=0.01",
                        },
                    },
                );
                detailTags = (Array.isArray(detail && detail.tags)
                    ? detail.tags
                    : []
                )
                    .map((tag) => cleanText(tag && tag.name))
                    .filter(Boolean);
            } catch (_error) {
                detailTags = [];
            }
        }

        markDebugState(
            "data-bcampx-tag-source-check",
            JSON.stringify({
                attempts,
                itemKeys: Object.keys(first),
                apiTags: (Array.isArray(first.tags) ? first.tags : [])
                    .map((tag) => cleanText(tag && tag.name ? tag.name : tag))
                    .filter(Boolean),
                detailTags,
            }).slice(0, 1800),
        );
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
        if (tracks.length && STATE.apiReleaseTrackCache) {
            STATE.apiReleaseTrackCache.set(apiKey, {
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
            });
        }

        return tags;
    }

    // The mobile release API returns the full tracklist with playable stream
    // redirects, and it is the same endpoint the tag index already uses. When a
    // release page parse yields no tracklist (or fails entirely), this keeps the
    // card useful instead of showing an empty Tracklist header.
    function getApiReleaseTralbumKey(release) {
        const bandId = Number(release && release.bandId) || 0;
        const tralbumId = Number(release && release.tralbumId) || 0;
        if (!bandId || !tralbumId) {
            return "";
        }
        const type = release.tralbumType === "t" ? "t" : "a";
        return `${type}${tralbumId}:${bandId}`;
    }

    function fetchApiReleaseTracklist(release) {
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
        const promise = waitTagIndexTurn()
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

                const value = {
                    tracks,
                    description: cleanText(data.about || ""),
                    title: cleanText(data.title || ""),
                    artist: cleanText(
                        data.tralbum_artist ||
                            (data.band && data.band.name) ||
                            "",
                    ),
                };
                return value;
            })
            .catch((error) => {
                if (isTagIndexRateLimitError(error)) {
                    void activateTagIndexCooldown("tracklist");
                }
                return null;
            });

        // Cache the promise, not the value: several cards can ask for the same
        // release (feed card + native block) and only one request goes out.
        if (cache) {
            cache.set(key, { ts: Date.now(), promise });
        }
        return promise;
    }

    function isTagIndexRateLimitError(error) {
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
    async function waitTagIndexTurn() {
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

    async function activateTagIndexCooldown(source = "") {
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
        markDebugState("data-bcampx-tag-index-cooldown-source", source);
        STATE.tagIndexNextRequestAt = 0;
        STATE.tagIndexRateLimited = true;
        STATE.tagIndexCooldownUntil = until;
        markDebugState("data-bcampx-tag-index-cooldown", String(until));
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
        markDebugState("data-bcampx-tag-index-cooldown", "0");
        markDebugState("data-bcampx-tag-index-cooldown-source", "");
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
        const seenIds = new Set();
        if (seed && seed.items.length) {
            seed.items.forEach((item) => seenIds.add(item.id));
            if (mergeFanTagIndexItems(index, seed.items)) {
                markFanTagIndexDirty(fanId, kind, index, true);
            }
        }

        const resumed = Boolean(cleanText(index.token));
        const expected = Math.max(
            0,
            Number(seed && seed.count) || 0,
            (seed && seed.items && seed.items.length) || 0,
        );
        let token = cleanText(index.token) || cleanText(seed && seed.token);
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
            let page = null;
            try {
                await waitTagIndexTurn();
                page = await fetchFanCollectionItemsPage(fanId, kind, token);
            } catch (error) {
                // Keep whatever the seed and previous pages produced; the next
                // page load retries from the token we already hold.
                index.itemsUpdatedAt = 0;
                markFanTagIndexDirty(fanId, kind, index, true);
                await flushTagIndexWrites({ forceTags: true });
                if (isTagIndexRateLimitError(error)) {
                    await activateTagIndexCooldown("items");
                }
                publishFanTagIndexDebug(fanId);
                return false;
            }

            page.items.forEach((item) => seenIds.add(item.id));
            mergeFanTagIndexItems(index, page.items);
            // Persist the pages already merged: a tab closed mid-enumeration
            // used to lose everything since the last completed run.
            markFanTagIndexDirty(fanId, kind, index, true);
            if (!page.moreAvailable) {
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
            // A resumed run started in the middle of the collection, so its
            // seen set covers only the tail; pruning against it would delete
            // everything indexed by earlier runs. Only a run that actually saw
            // every reported item can detect removals.
            if (
                !resumed &&
                expected > 0 &&
                seenIds.size >= expected
            ) {
                index.items = index.items.filter((item) =>
                    seenIds.has(item.id),
                );
            }
            index.itemsComplete = true;
            index.token = "";
        } else {
            index.itemsComplete = false;
        }

        index.itemsUpdatedAt = Date.now();
        markFanTagIndexDirty(fanId, kind, index, true);
        await flushTagIndexWrites({ forceTags: true });
        markDebugState(
            "data-bcampx-tag-index-items-complete",
            String(index.itemsComplete === true),
        );
        publishFanTagIndexDebug(fanId);
        return true;
    }

    // Publish counts while a run is in flight: the final totals only appear
    // when the run finishes, which can be tens of seconds on a large collection.
    function exposeFanTagIndexDebugHook() {
        if (typeof globalThis !== "object") {
            return;
        }

        globalThis.__bcampxTagIndexState = function () {
            const root = document.documentElement;
            const read = (name) =>
                (root && root.getAttribute(`data-bcampx-${name}`)) || "";
            const seed = readFanTagPageSeed();
            return {
                state: read("tag-index-state"),
                items: Number(read("tag-index-items")) || 0,
                tagged: Number(read("tag-index-tagged")) || 0,
                resolved: Number(read("tag-index-resolved")) || 0,
                failures: Number(read("tag-index-failures")) || 0,
                itemsComplete: read("tag-index-items-complete") === "true",
                pending: read("tag-index-pending"),
                cooldownUntil: Number(read("tag-index-cooldown")) || 0,
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

    exposeFanTagIndexDebugHook();

    // One attribute that carries the whole picture, readable from the page
    // console even when the script runs in an isolated world.
    function getTagIndexProgress() {
        const root = document.documentElement;
        const number = (name) =>
            Number(root && root.getAttribute(`data-bcampx-${name}`)) || 0;
        return {
            items: number("tag-index-items"),
            tagged: number("tag-index-tagged"),
            resolved: number("tag-index-resolved"),
            state:
                (root && root.getAttribute("data-bcampx-tag-index-state")) ||
                "",
        };
    }

    function publishTagIndexSummary(extra = {}) {
        const root = document.documentElement;
        if (!root) {
            return;
        }
        const read = (name) => root.getAttribute(`data-bcampx-${name}`) || "";
        const items = Number(read("tag-index-items")) || 0;
        const resolved = Number(read("tag-index-resolved")) || 0;
        const itemsComplete =
            read("tag-index-items-complete") === "true";
        const tagsComplete = items > 0 && resolved >= items;
        markDebugState(
            "data-bcampx-tag-index",
            JSON.stringify({
                state: extra.state || read("tag-index-state"),
                items,
                tagged: Number(read("tag-index-tagged")) || 0,
                resolved,
                failures: Number(read("tag-index-failures")) || 0,
                itemsComplete,
                tagsComplete,
                complete: itemsComplete && tagsComplete,
                pending: read("tag-index-pending"),
                cooldownUntil:
                    Number(read("tag-index-cooldown")) || 0,
                cooldownSource: read("tag-index-cooldown-source"),
                gapMs: getTagIndexGapMs(),
                store: STATE.releaseTagStoreMode || "unloaded",
            }),
        );
    }

    function setTagIndexState(state) {
        markDebugState("data-bcampx-tag-index-state", state);
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
        markDebugState("data-bcampx-tag-index-items", String(items));
        markDebugState("data-bcampx-tag-index-tagged", String(tagged));
        markDebugState("data-bcampx-tag-index-resolved", String(resolved));
        refreshTagSearchSettingProgress();
        markDebugState("data-bcampx-tag-index-failures", String(failures));
        markDebugState(
            "data-bcampx-tag-index-items-complete",
            String(complete),
        );
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
        markDebugState("data-bcampx-tag-index-items", String(items));
        markDebugState("data-bcampx-tag-index-tagged", String(tagged));
        markDebugState("data-bcampx-tag-index-resolved", String(resolved));
        markDebugState("data-bcampx-tag-index-failures", String(failures));
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
        if (last && now - last < 900) {
            return;
        }
        STATE.tagSearchProgressNotifyAt = STATE.tagSearchProgressNotifyAt || {};
        STATE.tagSearchProgressNotifyAt[stampKey] = now;
        scheduleFanTagSearchRefresh(kind, 400);
    }

    function createTagIndexRequestLimiter(maxConcurrency) {
        let active = 0;
        const queue = [];

        const drain = () => {
            while (active < maxConcurrency && queue.length) {
                const entry = queue.shift();
                active += 1;
                Promise.resolve()
                    .then(entry.task)
                    .then(entry.resolve, entry.reject)
                    .finally(() => {
                        active -= 1;
                        drain();
                    });
            }
        };

        return (task) =>
            new Promise((resolve, reject) => {
                queue.push({ task, resolve, reject });
                drain();
            });
    }

    function getTagIndexRequestLimiter() {
        if (!STATE.tagIndexRequestLimiter) {
            STATE.tagIndexRequestLimiter = createTagIndexRequestLimiter(
                Math.max(
                    1,
                    Math.floor(Number(CONFIG.tagIndexFetchConcurrency) || 1),
                ),
            );
        }
        return STATE.tagIndexRequestLimiter;
    }

    // One budget shared by collection and wishlist, so a visit never multiplies
    // the request count by the number of indexes it maintains.
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

    function markFanTagIndexDirty(fanId, kind, index, itemsChanged) {
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
        if (STATE.tagIndexWriteTimer) {
            return;
        }
        STATE.tagIndexWriteTimer = window.setTimeout(() => {
            STATE.tagIndexWriteTimer = 0;
            void flushTagIndexWrites();
        }, Math.max(1000, Number(CONFIG.tagIndexCheckpointMs) || 5000));
    }

    // The item list and the tag cache are sizeable blobs. A checkpoint rewrites
    // only the small progress record unless the collection itself changed, and
    // the tag cache is written at most once per interval.
    async function flushTagIndexWrites(options = {}) {
        if (STATE.tagIndexWriteTimer) {
            window.clearTimeout(STATE.tagIndexWriteTimer);
            STATE.tagIndexWriteTimer = 0;
        }

        // Coverage counts come from the in-memory tag cache. Load it before
        // taking the queue so a failed read does not discard the entries.
        try {
            await loadReleaseTagCache();
        } catch (error) {
            markDebugState(
                "data-bcampx-tag-index-write-error",
                cleanText(error && error.message).slice(0, 120),
            );
            return;
        }

        const dirty = STATE.tagIndexDirty.size
            ? Array.from(STATE.tagIndexDirty.values())
            : [];
        STATE.tagIndexDirty.clear();

        // Persist the tags before the status records that count them; if the
        // tag write fails, leave the statuses alone so they cannot get ahead.
        // This also runs when there is no queued status entry, because a
        // pagehide flush may only need to save tags.
        const now = Date.now();
        const last = Number(STATE.releaseTagCacheLastWriteAt) || 0;
        let tagsFlushed = true;
        if (isTagRecordStore()) {
            // Per-record storage already persisted each tag; this only prunes
            // expired records. A prune failure must not hold back the status.
            try {
                await flushReleaseTagCache();
            } catch (_error) {
                // The expired records are removed on the next flush.
            }
        } else if (
            options.forceTags === true ||
            !last ||
            now - last >= (Number(CONFIG.tagCacheCheckpointMs) || 30000)
        ) {
            try {
                if (await flushReleaseTagCache()) {
                    STATE.releaseTagCacheLastWriteAt = now;
                } else {
                    tagsFlushed = false;
                }
            } catch (error) {
                tagsFlushed = false;
                markDebugState(
                    "data-bcampx-tag-index-write-error",
                    cleanText(error && error.message).slice(0, 120),
                );
            }
        }
        if (!dirty.length) {
            return;
        }
        if (!tagsFlushed) {
            dirty.forEach((entry) => {
                markFanTagIndexDirty(
                    entry.fanId,
                    entry.kind,
                    entry.index,
                    entry.itemsChanged,
                );
            });
            return;
        }

        const failedEntries = [];
        for (const entry of dirty) {
            try {
                if (entry.itemsChanged) {
                    await saveFanTagIndexItems(
                        entry.fanId,
                        entry.kind,
                        entry.index,
                    );
                }
                await saveFanTagIndexStatus(
                    entry.fanId,
                    entry.kind,
                    entry.index,
                );
            } catch (error) {
                failedEntries.push(entry);
                markDebugState(
                    "data-bcampx-tag-index-write-error",
                    cleanText(error && error.message).slice(0, 120),
                );
            }
        }

        if (failedEntries.length) {
            // Retry a failed checkpoint, but stop after three in a row so a
            // permanent failure (quota, revoked storage) is not retried forever.
            STATE.tagIndexWriteFailures =
                (Number(STATE.tagIndexWriteFailures) || 0) + 1;
            if (STATE.tagIndexWriteFailures <= 3) {
                failedEntries.forEach((entry) => {
                    markFanTagIndexDirty(
                        entry.fanId,
                        entry.kind,
                        entry.index,
                        entry.itemsChanged,
                    );
                });
            }
        } else {
            STATE.tagIndexWriteFailures = 0;
        }

    }

    async function fillFanTagIndexTags(fanId, kind, index) {
        await loadReleaseTagCache();

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
            if (aborted || !CONFIG.enableTagSearch || !hasTagIndexFetchBudget()) {
                break;
            }

            const slice = pending.slice(offset, offset + sliceSize);
            const results = await Promise.all(
                slice.map(async (entry) => {
                    if (
                        aborted ||
                        runState.aborted ||
                        !CONFIG.enableTagSearch ||
                        !hasTagIndexFetchBudget()
                    ) {
                        return null;
                    }
                    await waitTagIndexTurn();
                    if (aborted || runState.aborted || !takeTagIndexFetchSlot()) {
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
        await flushTagIndexWrites({ forceTags: true });
    }

    async function buildFanTagIndexForKind(seed, kind) {
        const kindSeed = seed.kinds[kind];
        if (!kindSeed || !kindSeed.count) {
            return { items: 0, tagged: 0 };
        }

        const index = await loadFanTagIndex(seed.fanId, kind);
        const itemsStale =
            !index.itemsComplete ||
            !index.itemsUpdatedAt ||
            Date.now() - index.itemsUpdatedAt >
                (Number(CONFIG.tagIndexItemsTtlMs) || 0);
        if (itemsStale) {
            await refreshFanTagIndexItems(
                seed.fanId,
                kind,
                index,
                kindSeed,
            );
        } else if (
            kindSeed.items.length &&
            mergeFanTagIndexItems(index, kindSeed.items)
        ) {
            markFanTagIndexDirty(seed.fanId, kind, index, true);
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
            kinds = ["collection", "wishlist"].filter(
                (kind) => seed.kinds[kind] && seed.kinds[kind].count,
            );
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
            markDebugState(
                "data-bcampx-tag-index-pending",
                pendingKinds.join(","),
            );
            publishStoredTagIndexStats(statuses);
        }
        if (!pendingKinds.length) {
            setTagIndexState("up-to-date");
            return;
        }
        if (activeCooldownUntil > Date.now()) {
            STATE.tagIndexCooldownUntil = activeCooldownUntil;
            markDebugState(
                "data-bcampx-tag-index-cooldown",
                String(activeCooldownUntil),
            );
            markDebugState(
                "data-bcampx-tag-index-cooldown-source",
                cooldown.source || "",
            );
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
        STATE.tagIndexFetchesThisRun = 0;
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
                markDebugState(
                    "data-bcampx-tag-index-items",
                    String(totalItems),
                );
                markDebugState(
                    "data-bcampx-tag-index-tagged",
                    String(totalTagged),
                );
                const allComplete = kinds.every((kind, position) => {
                    const pending = pendingKinds.includes(kind);
                    if (pending) {
                        const result = results[pendingKinds.indexOf(kind)];
                        return Boolean(result && result.itemsComplete);
                    }
                    const status = statuses[position];
                    return Boolean(status && status.itemsComplete === true);
                });
                markDebugState(
                    "data-bcampx-tag-index-items-complete",
                    String(allComplete),
                );
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
                await flushTagIndexWrites({ forceTags: true });
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
        if (!CONFIG.enableTagSearch) {
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

    function scheduleFanTagBackgroundFill() {
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
        return kinds.some((kind, position) => {
            const status = statuses[position];
            if (!status || status.itemsComplete !== true) {
                return true;
            }
            const itemsCount = Number(status.itemsCount) || 0;
            const resolvedCount = Number(status.resolvedCount) || 0;
            return !itemsCount || resolvedCount < itemsCount;
        });
    }

    function scheduleFanTagIndexBatch(fanId, kinds) {
        if (
            !CONFIG.enableTagSearch ||
            STATE.tagIndexBatchTimer ||
            STATE.tagIndexRateLimited ||
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

    function updateFanTagSearchMoreControl(list, feedContext) {
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

    function collectFanTagSearchExtraReleases(feedContext, existingReleases) {
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

    function applyTagSearchSetting() {
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
        if (
            Date.now() - (Number(STATE.releaseTagCacheLoadedAt) || 0) <
            15000
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
        });
    }

    function setupFanTagSearch() {
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
            void flushTagIndexWrites({ forceTags: true });
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                void flushTagIndexWrites({ forceTags: true });
                return;
            }
            refreshActiveTagSearchesFromStorage();
        });
        window.addEventListener("focus", () => {
            refreshActiveTagSearchesFromStorage();
        });
        window.setTimeout(() => {
            void runTagSourceCheck();
        }, 4000);
        scheduleFanTagIndexRun(Number(CONFIG.tagIndexStartDelayMs) || 0);
        // Back/forward navigation can restore the tab and its search term
        // without firing an input event.
        primeFanTagSearchFromInputs();
    }
