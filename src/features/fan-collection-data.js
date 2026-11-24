import {
    getCardPrimaryReleaseUrl,
    getFeedPreviewTrackMap,
    getFeedPreviewTracks,
    getParsedItemJson,
} from "../utils/card-dom.js";
import {
    createTrackData,
    normalizeReleaseData,
    normalizeSupporterItemType,
    parseJsonAttribute,
    requestJson,
} from "../data/release-data.js";
import { CONFIG, RELEASE_LINK_SELECTOR, STATE } from "../state.js";
import {
    findFanCollectionActiveGrid,
    isFanCollectionPage,
    isFanWishlistPage,
    resolveFanIdFromPageState,
} from "../utils/page.js";
import {
    cleanText,
    cleanTitle,
    formatReleaseDate,
    metaContent,
    normalizedText,
} from "../utils/text-format.js";
import {
    firstPositiveNumber,
    isBandcampFanProfileUrl,
    isBandcampReleaseUrl,
    normalizeReleaseItemType,
    normalizeReleaseUrl,
} from "../utils/url.js";

const fanDataState = {
    fanCollectionSearchItemCache: new Map(),
    fanCollectionSearchResponseCache: new Map(),
    fanCollectionSearchPrefetchBound: false,
    fanCollectionReleaseCache: new WeakMap(),
    fanCollectionPlayerDataCache: new WeakMap(),
    fanTagNativeReleaseCache: new WeakMap(),
    artistMusicBandCache: null,
    fanPageDataBlob: undefined,
};

export function isCurrentFanProfileOwner() {
    const pageData = parseJsonAttribute(
        document.querySelector("#pagedata[data-blob]"),
        "data-blob",
    );
    const fanData = pageData && pageData.fan_data;
    const currentFan = pageData && pageData.current_fan;

    if (fanData && fanData.is_own_page === true) {
        return true;
    }

    const profileFanId = Number(fanData && (fanData.fan_id || fanData.id));
    // Bandcamp exposes the signed-in fan as current_fan on some pages and
    // as identities.fan / fan_info on others; resolveFanIdFromPageState
    // already knows those fallbacks.
    const currentFanId =
        Number(currentFan && (currentFan.fan_id || currentFan.id)) ||
        resolveFanIdFromPageState(pageData);
    return Boolean(
        profileFanId > 0 &&
            currentFanId > 0 &&
            profileFanId === currentFanId,
    );
}

// The fan profile URL behind the current collection page. Used as the
// ownership target for index-built tag cards: clicking them should search
// the collection for the release instead of opening its release page.
export function getOwnFanProfileUrl() {
    if (!isBandcampFanProfileUrl(window.location.href)) {
        return "";
    }

    const path = String(window.location.pathname || "").replace(
        /\/+$/,
        "",
    );
    return path ? `${window.location.origin}${path}` : "";
}

function isOwnFanTrackRelease(release) {
    return Boolean(
        release &&
            release.ownFanCollection === true &&
            release.itemType === "track",
    );
}

export function isOwnFanTrackCard(card) {
    return isOwnFanTrackRelease(
        card && card.__bcampxArtistMusicRelease,
    );
}


export function collectFanCollectionReleaseCandidates(
    feedContext,
    dirtyItems = null,
) {
    const seen = new Set();
    const candidatesByKey = new Map();
    const candidates = [];
    const sourceGrid = feedContext && feedContext.sourceGrid;
    const feedKind = feedContext && feedContext.kind;
    const ownFanCollection =
        feedKind === "fan-collection" && isCurrentFanProfileOwner();
    const items = Array.from(
        (sourceGrid || document).querySelectorAll(
            "li.collection-item-container[data-playerdata], li.collection-item-container",
        ),
    );

    items.forEach((item) => {
        addFanCollectionReleaseCandidate(
            candidates,
            seen,
            item,
            candidatesByKey,
            feedKind,
            ownFanCollection,
            Boolean(dirtyItems && !dirtyItems.has(item)),
        );
    });

    if (sourceGrid instanceof Element) {
        STATE.artistMusicFeedCandidateCache = {
            grid: sourceGrid,
            kind: feedKind,
            ownFanCollection,
            items,
        };
    }

    return candidates;
}

// Shared by the feed scanner and by tag results: both need the same release
// metadata out of a native collection item.
function hashCacheValue(value) {
    const text = String(value || "");
    let hash = text.length;
    // Sampling keeps this cheap for long data-playerdata strings; the
    // length plus sampled code units is enough to notice a rewrite.
    for (let index = 0; index < text.length; index += 7) {
        hash = (hash * 31 + text.charCodeAt(index)) | 0;
    }
    return hash;
}

function getFanCollectionItemSignature(item, feedKind, ownFanCollection) {
    if (!(item instanceof Element)) {
        return "";
    }

    const parts = [feedKind || "", ownFanCollection ? "1" : "0"];
    [
        "data-itemid",
        "data-tralbumid",
        "data-tralbumtype",
        "data-itemtype",
        "data-title",
        "data-bandid",
        "data-trackid",
    ].forEach((name) => {
        parts.push(item.getAttribute(name) || "");
    });
    const playerData = item.getAttribute("data-playerdata") || "";
    parts.push(String(playerData.length), String(hashCacheValue(playerData)));
    const itemJson = item.getAttribute("data-item-json") || "";
    parts.push(String(itemJson.length), String(hashCacheValue(itemJson)));

    const releaseLink = item.querySelector(
        "a.item-link[href], .collection-title-details a[href], a[href]",
    );
    parts.push(releaseLink ? releaseLink.getAttribute("href") || "" : "");
    const title = item.querySelector(
        ".collection-item-title, .item-title",
    );
    parts.push(title ? normalizedText(title) : "");
    const artist = item.querySelector(".collection-item-artist");
    parts.push(artist ? normalizedText(artist) : "");
    return parts.join("\u0001");
}

function createFanCollectionRelease(
    item,
    feedKind,
    ownFanCollection,
    options = {},
) {
    if (!(item instanceof Element)) {
        return null;
    }

    const cache = fanDataState.fanCollectionReleaseCache;
    const cached = cache && cache.get(item);
    if (
        options.skipSignature === true &&
        cached &&
        cached.release &&
        cached.feedKind === feedKind &&
        cached.ownFanCollection === ownFanCollection
    ) {
        return cached.release;
    }

    const signature = getFanCollectionItemSignature(
        item,
        feedKind,
        ownFanCollection,
    );
    if (
        cached &&
        cached.signature === signature &&
        cached.feedKind === feedKind &&
        cached.ownFanCollection === ownFanCollection
    ) {
        return cached.release;
    }

    const playerData = buildFanCollectionPlayerData(item, feedKind);
    const itemType = normalizeReleaseItemType(
        item.getAttribute("data-tralbumtype") ||
            item.getAttribute("data-itemtype") ||
            "",
    );
    const fallbackReleaseUrl = getFanCollectionReleaseUrl(
        item,
        playerData,
        itemType,
    );
    const resolvedItemType =
        itemType || normalizeReleaseItemType("", fallbackReleaseUrl);
    const ownTrackItem =
        ownFanCollection &&
        (resolvedItemType === "track" ||
            /\/track\//.test(
                normalizeReleaseUrl(playerData && playerData.url),
            ) ||
            Boolean(item.querySelector('a[href*="/track/"]')));
    const releaseUrl = ownTrackItem
        ? getFanCollectionReleaseUrl(item, playerData, itemType, true)
        : fallbackReleaseUrl;
    if (!releaseUrl) {
        return null;
    }

    const title = getFanCollectionReleaseTitle(
        item,
        playerData,
        itemType,
        releaseUrl,
    );
    const artist = getFanCollectionReleaseArtist(item, playerData);
    const release = {
        releaseUrl,
        title,
        artist,
        artUrl: getArtistMusicReleaseArtUrl(item),
        itemId: getArtistMusicReleaseItemId(item),
        itemType: ownTrackItem ? "track" : resolvedItemType,
        bandId: getArtistMusicReleaseBandId(item),
        tralbumId:
            Number(item.getAttribute("data-tralbumid")) ||
            Number(item.getAttribute("data-itemid")) ||
            0,
        tralbumType: cleanText(
            item.getAttribute("data-tralbumtype") || "",
        ).toLowerCase(),
        feedKind,
        ownFanCollection,
        pageUnavailable: !hasNativeReleasePageLink(item),
        sourceItem: item,
        gridItem: item,
        featuredItem: null,
        playerData,
        initialData: buildFanCollectionInitialReleaseData(
            item,
            playerData,
            releaseUrl,
            title,
            artist,
            feedKind,
        ),
    };
    if (cache) {
        cache.set(item, {
            signature,
            release,
            feedKind,
            ownFanCollection,
        });
    }
    return release;
}

export function addFanCollectionReleaseCandidate(
    candidates,
    seen,
    item,
    candidatesByKey,
    feedKind,
    ownFanCollection,
    skipSignature = false,
) {
    const release = createFanCollectionRelease(
        item,
        feedKind,
        ownFanCollection,
        { skipSignature },
    );
    if (!release) {
        return;
    }

    if (release.ownFanCollection) {
        // Every item in your own collection is a separate purchase with
        // its own download and ownership actions. Never fold one item into
        // another here: a single-track purchase can be reported as an
        // album tralbum, so neighbours from the same album share a release
        // URL and merging them would drop their download links.
        // Deduplicate by element identity only.
        if (seen.has(item)) {
            return;
        }
        seen.add(item);
        candidates.push(release);
        return;
    }

    const dedupeKeys = getArtistMusicReleaseDedupeKeys(release);
    const existingKey = dedupeKeys.find((key) => seen.has(key));
    if (existingKey) {
        mergeArtistMusicReleaseCandidate(
            candidatesByKey.get(existingKey),
            item,
            "grid",
        );
        return;
    }

    dedupeKeys.forEach((key) => {
        seen.add(key);
        candidatesByKey.set(key, release);
    });
    candidates.push(release);
}

// Tag matches that already exist as native cards reuse that card's data:
// the cover, preview player data, download link and release URL are the
// same ones Bandcamp rendered, so nothing depends on our compact index
// record being complete.
export function buildFanTagSearchNativeRelease(item, feedKind) {
    const release = createFanCollectionRelease(
        item,
        feedKind,
        feedKind === "fan-collection" && isCurrentFanProfileOwner(),
    );
    if (!release) {
        return null;
    }

    // createFanCollectionRelease is cached per item; do not stamp the
    // shared object with tag-only fields or the native card would inherit
    // them on the next feed sync. Cache the wrapper too so repeated tag
    // syncs do not rebuild/update the same tag card on every pass.
    const tagCache = fanDataState.fanTagNativeReleaseCache;
    const cached = tagCache && tagCache.get(item);
    if (
        cached &&
        cached.base === release &&
        cached.release.pageUnavailable === release.pageUnavailable
    ) {
        return cached.release;
    }

    const tagRelease = {
        ...release,
        tagSearch: true,
        tagOrigin: "native",
    };
    if (tagCache) {
        tagCache.set(item, { base: release, release: tagRelease });
    }
    return tagRelease;
}

function getFanCollectionReleaseUrl(
    item,
    playerData,
    itemType,
    preferTrackLink = false,
) {
    const albumUrl = cleanText(playerData && playerData.album && playerData.album.url);
    const trackUrl = cleanText(playerData && playerData.url);
    const linkUrl = normalizeReleaseUrl(
        item.querySelector(RELEASE_LINK_SELECTOR)?.href || "",
    );

    if (preferTrackLink) {
        const trackLinkUrl = normalizeReleaseUrl(
            Array.from(item.querySelectorAll('a[href*="/track/"]'))
                .map((link) => normalizeReleaseUrl(link.href))
                .find(Boolean) || "",
        );
        return normalizeReleaseUrl(
            trackUrl || trackLinkUrl || linkUrl || albumUrl,
        );
    }

    return normalizeReleaseUrl(
        itemType === "track"
            ? trackUrl || linkUrl || albumUrl
            : albumUrl || linkUrl || trackUrl,
    );
}

function getFanCollectionReleaseTitle(item, playerData, itemType, releaseUrl) {
    const playerTitle =
        itemType === "album"
            ? playerData && playerData.album && playerData.album.title
            : playerData && playerData.title;
    return (
        cleanText(playerTitle || "") ||
        getArtistMusicReleaseTitle(
            item,
            item.querySelector(RELEASE_LINK_SELECTOR),
            releaseUrl,
        )
    );
}


// Current Bandcamp collection pages keep item metadata and preview streams
// in pagedata blobs (item_cache / tracklists), not in per-item attributes.
// Older markup used data-playerdata; both shapes are supported here.
function getFanPageDataBlob() {
    if (fanDataState.fanPageDataBlob !== undefined) {
        return fanDataState.fanPageDataBlob;
    }

    let blob = null;
    try {
        blob = parseJsonAttribute(
            document.querySelector("#pagedata[data-blob]"),
            "data-blob",
        );
    } catch (_error) {
        blob = null;
    }
    fanDataState.fanPageDataBlob =
        blob && typeof blob === "object" && !Array.isArray(blob)
            ? blob
            : {};
    return fanDataState.fanPageDataBlob;
}

function getFanCollectionDataSection(name, kind) {
    const blob = getFanPageDataBlob();
    const section = blob && blob[name];
    const scoped = section && section[kind];
    return scoped && typeof scoped === "object" && !Array.isArray(scoped)
        ? scoped
        : {};
}

function getFanCollectionItemCache(kind) {
    return getFanCollectionDataSection("item_cache", kind);
}

function getFanCollectionTracklists(kind) {
    return getFanCollectionDataSection("tracklists", kind);
}

function getFanCollectionDataKind(feedKind) {
    return feedKind === "fan-wishlist" ? "wishlist" : "collection";
}

function getFanCollectionItemKey(item) {
    if (!(item instanceof Element)) {
        return "";
    }

    const rawType = cleanText(
        item.getAttribute("data-tralbumtype") ||
            item.getAttribute("data-itemtype") ||
            "",
    ).toLowerCase();
    const type = rawType === "t" || rawType === "track" ? "t" : "a";
    const id = cleanText(
        item.getAttribute("data-tralbumid") ||
            item.getAttribute("data-itemid") ||
            "",
    );
    return id ? `${type}${id}` : "";
}

export function getFanCollectionCardKind(card) {
    if (!(card instanceof Element)) {
        return "collection";
    }
    return card.closest(
        "#wishlist-grid, #wishlist-items, [id*='wishlist']",
    )
        ? "wishlist"
        : "collection";
}

export function getFanCollectionCachedItem(item, kind) {
    const key = getFanCollectionItemKey(item);
    if (!key) {
        return null;
    }
    return getFanCollectionItemCache(kind)[key] || null;
}

function getFanCollectionFeaturedTrack(item, kind) {
    const key = getFanCollectionItemKey(item);
    if (!key) {
        return null;
    }

    const cacheItem = getFanCollectionItemCache(kind)[key] || null;
    const list = getFanCollectionTracklists(kind)[key];
    const tracks = Array.isArray(list) ? list : [];
    const featuredId =
        cleanText(item.getAttribute("data-trackid")) ||
        cleanText(cacheItem && cacheItem.featured_track);
    if (featuredId) {
        const exact = tracks.find(
            (track) =>
                track && String(track.id) === String(featuredId),
        );
        if (exact) {
            return exact;
        }
    }
    return tracks[0] || null;
}

function buildFanCollectionPlayerData(item, feedKind) {
    const raw = item.getAttribute("data-playerdata") || "";
    const cacheKey = raw
        ? `${feedKind}\u0001${raw.length}:${hashCacheValue(raw)}`
        : `${feedKind}\u0001pagedata`;
    const cache = fanDataState.fanCollectionPlayerDataCache;
    const cached = cache && cache.get(item);
    if (cached && cached.key === cacheKey) {
        return cached.data;
    }

    let result = {};
    const explicit = parseJsonAttribute(item, "data-playerdata");
    if (
        explicit &&
        typeof explicit === "object" &&
        Object.keys(explicit).length
    ) {
        result = explicit;
    } else {
        const kind = getFanCollectionDataKind(feedKind);
        const cacheItem = getFanCollectionCachedItem(item, kind);
        const featured = getFanCollectionFeaturedTrack(item, kind);
        if (cacheItem || featured) {
            const albumUrl =
                cleanText(cacheItem && cacheItem.item_url) ||
                cleanText(getItemJsonReleaseUrl(item));

            result = {
                id: (featured && featured.id) ||
                    cleanText(item.getAttribute("data-trackid")),
                title:
                    cleanText(featured && featured.title) ||
                    cleanText(
                        cacheItem && cacheItem.featured_track_title,
                    ),
                artist_name: cleanText(cacheItem && cacheItem.band_name),
                duration: featured && featured.duration,
                url: cleanText(cacheItem && cacheItem.item_url),
                album: {
                    id:
                        Number(
                            cacheItem &&
                                (cacheItem.tralbum_id ||
                                    cacheItem.album_id),
                        ) || 0,
                    title: cleanText(cacheItem && cacheItem.item_title),
                    url: albumUrl,
                },
                _featuredStreamUrl: cleanText(
                    featured &&
                        featured.file &&
                        featured.file["mp3-128"],
                ),
                _featuredTrackId: featured && featured.id,
                _featuredTitle: cleanText(featured && featured.title),
                _featuredDuration: featured && featured.duration,
            };
        }
    }

    if (cache) {
        cache.set(item, { key: cacheKey, data: result });
    }
    return result;
}

// Search responses carry tracklists for every hit and each keystroke can
// create a new one. Keep a small session cache instead of growing for the
// lifetime of the page.
function trimFanCollectionSearchCaches() {
    const maxEntries = 60;
    [fanDataState.fanCollectionSearchResponseCache, fanDataState.fanCollectionSearchItemCache]
        .forEach((cache) => {
            while (cache && cache.size > maxEntries) {
                const oldest = cache.keys().next().value;
                if (oldest === undefined) {
                    break;
                }
                cache.delete(oldest);
            }
        });
}

// The collection search grid only renders items with a play control; the
// search response still carries the item URL and the full tracklist, so a
// hidden release can be played (and detected) without opening its page.
async function fetchFanCollectionSearchResponse(searchKey) {
    const key = cleanText(searchKey);
    if (!key) {
        return null;
    }

    const blob = getFanPageDataBlob();
    const fanData = blob && blob.fan_data;
    const fanId =
        Number(fanData && (fanData.fan_id || fanData.id)) || 0;
    if (!fanId) {
        return null;
    }

    const cacheKey = `${fanId}|${key}`;
    if (fanDataState.fanCollectionSearchResponseCache.has(cacheKey)) {
        return fanDataState.fanCollectionSearchResponseCache.get(cacheKey);
    }

    const response = await requestJson(
        "https://bandcamp.com/api/fancollection/1/search_items",
        {
            method: "POST",
            credentials: "include",
            data: JSON.stringify({
                fan_id: fanId,
                search_key: key,
                search_type: "collection",
            }),
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
        },
    );
    if (!response || typeof response !== "object") {
        return null;
    }

    fanDataState.fanCollectionSearchResponseCache.set(cacheKey, response);
    trimFanCollectionSearchCaches();
    return response;
}

// Start the lookup as soon as the user types, so the first play click does
// not have to wait for a cold extension fetch.
export function setupFanCollectionSearchPrefetch() {
    if (fanDataState.fanCollectionSearchPrefetchBound) {
        return;
    }

    fanDataState.fanCollectionSearchPrefetchBound = true;
    let timer = 0;
    document.addEventListener(
        "input",
        (event) => {
            const input = event.target;
            if (
                !(input instanceof Element) ||
                !input.closest("#collection-search") ||
                !isFanCollectionPage()
            ) {
                return;
            }

            // Tag search being disabled keeps the collection search box
            // free of extension requests; playback still resolves on click.
            if (!CONFIG.enableTagSearch) {
                return;
            }

            const key = cleanText(input.value);
            if (timer) {
                window.clearTimeout(timer);
            }
            if (key.length < 2) {
                return;
            }
            timer = window.setTimeout(() => {
                timer = 0;
                void fetchFanCollectionSearchResponse(key).catch(
                    () => {},
                );
            }, 350);
        },
        true,
    );
}

export async function getFanCollectionSearchItem(itemId) {
    const id = Number(itemId) || 0;
    if (!id) {
        return null;
    }

    const input = document.querySelector("#collection-search input");
    const searchKey = cleanText(input && input.value);
    if (!searchKey) {
        return null;
    }

    const blob = getFanPageDataBlob();
    const fanData = blob && blob.fan_data;
    const fanId =
        Number(fanData && (fanData.fan_id || fanData.id)) || 0;
    if (!fanId) {
        return null;
    }

    const cacheKey = `${fanId}|${searchKey}|${id}`;
    if (fanDataState.fanCollectionSearchItemCache.has(cacheKey)) {
        return fanDataState.fanCollectionSearchItemCache.get(cacheKey);
    }

    const response = await fetchFanCollectionSearchResponse(searchKey);
    const tralbums =
        response && Array.isArray(response.tralbums)
            ? response.tralbums
            : [];
    const item =
        tralbums.find(
            (entry) =>
                Number(entry.item_id) === id ||
                Number(entry.tralbum_id) === id,
        ) || null;
    if (!item) {
        return null;
    }

    const tracklistKey = `${item.tralbum_type || "a"}${item.tralbum_id}`;
    const tracklists =
        response && response.tracklists && typeof response.tracklists === "object"
            ? response.tracklists
            : {};
    const result = {
        item,
        tracks: Array.isArray(tracklists[tracklistKey])
            ? tracklists[tracklistKey]
            : [],
    };
    fanDataState.fanCollectionSearchItemCache.set(cacheKey, result);
    trimFanCollectionSearchCaches();
    return result;
}

function getFanCollectionRedownloadUrl(itemId) {
    const id = Number(itemId) || 0;
    if (!id) {
        return "";
    }

    const blob = getFanPageDataBlob();
    const collection = blob && blob.collection_data;
    const urls = collection && collection.redownload_urls;
    if (!urls || typeof urls !== "object") {
        return "";
    }
    return cleanText(urls[id] || "");
}

// The collection page itself carries only the featured preview stream for
// each item. Used for grid cards that have no data-item-json of their own.
export function buildFanCollectionCardPreview(card) {
    if (!(card instanceof Element)) {
        return null;
    }

    const kind = getFanCollectionCardKind(card);
    const cacheItem = getFanCollectionCachedItem(card, kind);
    const featured = getFanCollectionFeaturedTrack(card, kind);
    if (!featured) {
        return null;
    }

    const streamUrl = cleanText(
        featured.file && featured.file["mp3-128"],
    );
    if (!streamUrl) {
        return null;
    }

    const releaseUrl =
        normalizeReleaseUrl(getCardPrimaryReleaseUrl(card)) ||
        cleanText(cacheItem && cacheItem.item_url);
    const title =
        cleanText(cacheItem && cacheItem.item_title) ||
        cleanText(featured.title);
    const artist =
        cleanText(cacheItem && cacheItem.band_name) ||
        getArtistMusicReleaseArtist(card);
    const track = createTrackData(
        cleanText(featured.title) || title,
        featured.id,
        streamUrl,
        featured.duration,
        cleanText(featured.track_url || ""),
    );
    if (!track) {
        return null;
    }

    return {
        track,
        data: normalizeReleaseData({
            url: releaseUrl,
            title,
            artist,
            artUrl: getArtistMusicReleaseArtUrl(card),
            tracks: [track],
        }),
    };
}

// Bandcamp removes the release-page link from collection items whose
// release is no longer reachable; the play control and download link stay.
// Treat a missing link as "the page is gone" and skip the fetch entirely.
// The native grid may already expose the same release; if its item has no
// release-page link, the tag card must not send the user to a dead page
// either. This avoids a verification request entirely.
export function isNativeCollectionItemUnavailable(release) {
    // Native collection releases already carry the link check from
    // createFanCollectionRelease. Only index-only tag cards need the
    // document lookup; asking once per card made the build quadratic in
    // the size of the native grid.
    if (release && release.sourceItem instanceof Element) {
        return false;
    }

    const id =
        Number(
            release && (release.itemId || release.tralbumId),
        ) || 0;
    if (!id) {
        return false;
    }
    const item = document.querySelector(
        `.collection-item-container[data-itemid="${id}"], .collection-item-container[data-tralbumid="${id}"]`,
    );
    return Boolean(item && !hasNativeReleasePageLink(item));
}

function hasNativeReleasePageLink(item) {
    if (!(item instanceof Element)) {
        return true;
    }

    return Array.from(item.querySelectorAll("a[href]")).some((link) => {
        if (
            link.closest(
                ".redownload-item, .collection-item-actions, .wishlist-msg, .collection-item-fav-track",
            )
        ) {
            return false;
        }
        return Boolean(
            normalizeReleaseUrl(link.getAttribute("href") || ""),
        );
    });
}

function getFanCollectionReleaseArtist(item, playerData) {
    return (
        cleanText(playerData && playerData.artist_name) ||
        getArtistMusicReleaseArtist(item)
    );
}

function buildFanCollectionInitialReleaseData(
    item,
    playerData,
    releaseUrl,
    title,
    artist,
    feedKind,
) {
    const itemId = getArtistMusicReleaseItemId(item);
    const track = createFanCollectionPreviewTrack(playerData, {
        title,
        itemId,
        url: releaseUrl,
    });
    const isCollection = feedKind === "fan-collection";
    const ownCollection = isCollection && isCurrentFanProfileOwner();
    const downloadUrl = isCollection
        ? getFanCollectionDownloadUrl(item) ||
          (ownCollection
              ? getFanCollectionRedownloadUrl(itemId)
              : "")
        : "";
    const supporterCountLabel = getFanCollectionSupporterCountLabel(item);
    const hasNativeSupporterCount = Boolean(supporterCountLabel);
    return normalizeReleaseData({
        url: releaseUrl,
        title,
        artist,
        artUrl: getArtistMusicReleaseArtUrl(item),
        digitalPrice:
            getFanCollectionDigitalPrice(playerData) ||
            (ownCollection ? "you own this" : ""),
        digitalDownloadUrl: downloadUrl,
        digitalOwnershipUrl:
            ownCollection && !downloadUrl
                ? getOwnFanProfileUrl()
                : "",
        isPreorder: Boolean(
            playerData &&
                (playerData.is_preorder === true ||
                    (playerData.album &&
                        playerData.album.is_preorder === true)),
        ),
        tracks: track ? [track] : [],
        supporterCount: getFanCollectionSupporterCount(item, playerData),
        supporterCountIsExact: hasNativeSupporterCount,
        supporterMoreAvailable: false,
        supporterCountLabel,
        supporterCountAuthoritative: hasNativeSupporterCount,
        supporterItemId: itemId,
        supporterItemType: normalizeSupporterItemType(
            item.getAttribute("data-tralbumtype") ||
                item.getAttribute("data-itemtype") ||
                "",
        ),
    });
}

function getFanCollectionDownloadUrl(item) {
    const directLink =
        item && item.querySelector(".redownload-item a[href]");
    const menuLink =
        item &&
        Array.from(
            item.querySelectorAll(".contextual-menu-expanded a[href]"),
        ).find((link) => /^download\b/i.test(cleanText(link.textContent || "")));
    const link = directLink || menuLink;
    return cleanText((link && link.href) || "");
}

function createFanCollectionPreviewTrack(playerData, fallback = {}) {
    if (!playerData || typeof playerData !== "object") {
        playerData = {};
    }

    const cleanFallback =
        fallback && typeof fallback === "object" ? fallback : {};
    const featuredStreamUrl = cleanText(playerData._featuredStreamUrl);
    const featuredTitle = cleanText(playerData._featuredTitle);
    const featuredId = cleanText(playerData._featuredTrackId);
    const trackId = cleanText(
        playerData.id ||
            featuredId ||
            cleanFallback.itemId ||
            "",
    );
    const fallbackTitle = cleanText(
        featuredTitle ||
            playerData.title ||
            cleanFallback.title ||
            "",
    );
    const previewTrack = featuredStreamUrl
        ? null
        : findFeedPreviewTrack(trackId, fallbackTitle);
    const previewStreamUrl = cleanText(
        previewTrack &&
            previewTrack.streaming_url &&
            previewTrack.streaming_url["mp3-128"],
    );

    return createTrackData(
        fallbackTitle ||
            (previewTrack && previewTrack.title) ||
            cleanFallback.title ||
            "",
        trackId,
        extractFanCollectionPlayerStreamUrl(playerData) ||
            featuredStreamUrl ||
            previewStreamUrl ||
            "",
        playerData.duration ||
            playerData._featuredDuration ||
            (previewTrack && previewTrack.duration) ||
            "",
        playerData.url ||
            (previewTrack && previewTrack.track_url) ||
            cleanFallback.url ||
            "",
    );
}

function extractFanCollectionPlayerStreamUrl(playerData) {
    if (!playerData || typeof playerData !== "object") {
        return "";
    }

    const candidates = [
        playerData.stream_url,
        playerData.preview_url,
        playerData.streaming_url &&
            typeof playerData.streaming_url === "object"
            ? playerData.streaming_url["mp3-128"]
            : "",
    ];

    const file = playerData.file;
    if (file && typeof file === "object") {
        candidates.push(
            file["mp3-128"],
            file.mp3_128,
            file.mp3,
            file["mp3"],
            file["mp3-v0"],
            file["flac"],
        );
    }

    for (const candidate of candidates) {
        const streamUrl = cleanText(candidate);
        if (streamUrl) {
            return streamUrl;
        }
    }

    return "";
}

function findFeedPreviewTrack(trackId, title) {
    const byId = trackId
        ? getFeedPreviewTrackMap().get(trackId)
        : null;
    if (byId) {
        return byId;
    }

    const normalizedTitle = cleanText(title).toLowerCase();
    if (!normalizedTitle) {
        return null;
    }

    return (
        getFeedPreviewTracks().find((track) => {
            const trackTitle = cleanText(track && track.title).toLowerCase();
            return (
                trackTitle &&
                (trackTitle === normalizedTitle ||
                    trackTitle.includes(normalizedTitle) ||
                    normalizedTitle.includes(trackTitle))
            );
        }) || null
    );
}

function getFanCollectionDigitalPrice(playerData) {
    const itemPrice = formatFanCollectionPrice(
        playerData && playerData.price,
    );
    const albumPrice = formatFanCollectionPrice(
        playerData && playerData.album && playerData.album.price,
    );
    if (playerData && playerData.is_owned) {
        return "you own this";
    }
    if (playerData && playerData.album && playerData.album.is_owned) {
        return "you own this";
    }
    if (playerData && playerData.is_free_download) {
        return "free download";
    }
    if (playerData && playerData.album && playerData.album.is_free_download) {
        return "free download";
    }
    return itemPrice || albumPrice;
}

function formatFanCollectionPrice(price) {
    if (!price || typeof price !== "object" || price.is_money !== true) {
        return "";
    }

    const amount = Number(price.amount);
    const currency = cleanText(price.currency || "");
    if (!Number.isFinite(amount) || amount <= 0) {
        return "";
    }

    return cleanText(`${currency} ${amount}`);
}

function getFanCollectionSupporterCount(item, playerData = null) {
    const rawCount = getFanCollectionRawSupporterCount(item, playerData);
    if (rawCount > 0) {
        return rawCount;
    }

    const text = getFanCollectionSupporterCountLabel(item);
    const match = text.match(
        /(\d(?:[\d.,'’\s\u00a0\u202f]*\d)?)/,
    );
    if (!match) {
        return 0;
    }

    const digits = match[1].replace(/\D/g, "");
    const count = Number(digits);
    if (!digits || !Number.isSafeInteger(count) || count <= 0) {
        return 0;
    }

    return count;
}

function getFanCollectionRawSupporterCount(item, playerData) {
    const album =
        playerData && typeof playerData.album === "object"
            ? playerData.album
            : null;
    const candidates = [
        playerData && playerData.collectors_count,
        playerData && playerData.collector_count,
        playerData && playerData.supporter_count,
        playerData && playerData.collection_count,
        playerData && playerData.num_collectors,
        album && album.collectors_count,
        album && album.collector_count,
        album && album.supporter_count,
        album && album.collection_count,
        album && album.num_collectors,
        item && item.getAttribute("data-collectors-count"),
        item && item.getAttribute("data-supporter-count"),
    ];

    for (const candidate of candidates) {
        if (
            typeof candidate !== "number" &&
            !/^\d+$/.test(cleanText(candidate))
        ) {
            continue;
        }
        const count = Number(candidate);
        if (Number.isSafeInteger(count) && count > 0) {
            return count;
        }
    }

    return 0;
}

function getFanCollectionSupporterCountLabel(item) {
    return cleanText(
        item.querySelector(".collected-by .collected-by-header")
            ?.textContent || "",
    );
}

export function addArtistMusicReleaseCandidate(
    candidates,
    seen,
    item,
    link = null,
    sourceKind = "link",
    candidatesByKey = new Map(),
) {
    if (!(item instanceof Element)) {
        return;
    }

    const releaseLink =
        link ||
        item.querySelector(RELEASE_LINK_SELECTOR) ||
        (item.matches(RELEASE_LINK_SELECTOR) ? item : null);
    const releaseUrl = normalizeReleaseUrl(
        releaseLink && releaseLink.href ? releaseLink.href : "",
    );
    if (!releaseUrl) {
        return;
    }

    const itemId = getArtistMusicReleaseItemId(item);
    const itemType = normalizeReleaseItemType("", releaseUrl);
    const title = getArtistMusicReleaseTitle(item, releaseLink, releaseUrl);
    const artist = getArtistMusicReleaseArtist(item);
    const dedupeKeys = getArtistMusicReleaseDedupeKeys({
        releaseUrl,
        itemId,
        itemType,
        title,
        artist,
    });
    const existingKey = dedupeKeys.find((key) => seen.has(key));
    if (existingKey) {
        mergeArtistMusicReleaseCandidate(
            candidatesByKey.get(existingKey),
            item,
            sourceKind,
        );
        return;
    }

    dedupeKeys.forEach((key) => {
        seen.add(key);
    });
    const candidate = {
        releaseUrl,
        title,
        artist,
        artUrl: getArtistMusicReleaseArtUrl(item),
        itemId,
        itemType,
        bandId: getArtistMusicReleaseBandId(item),
        sourceItem: item,
        gridItem: sourceKind === "grid" ? item : null,
        featuredItem: sourceKind === "featured" ? item : null,
    };
    dedupeKeys.forEach((key) => {
        candidatesByKey.set(key, candidate);
    });
    candidates.push(candidate);
}

function mergeArtistMusicReleaseCandidate(candidate, item, sourceKind) {
    if (!candidate || !(item instanceof Element)) {
        return;
    }

    if (sourceKind === "grid") {
        candidate.gridItem = candidate.gridItem || item;
        candidate.itemId =
            candidate.itemId || getArtistMusicReleaseItemId(item);
        candidate.bandId =
            candidate.bandId || getArtistMusicReleaseBandId(item);
        return;
    }

    if (sourceKind === "featured") {
        candidate.featuredItem = candidate.featuredItem || item;
        if (!candidate.artUrl) {
            candidate.artUrl = getArtistMusicReleaseArtUrl(item);
        }
    }
}

function getArtistMusicReleaseDedupeKeys(release) {
    const keys = [`url:${release.releaseUrl}`];
    if (release.itemId && release.itemType) {
        keys.push(`item:${release.itemType}:${release.itemId}`);
    }

    try {
        const url = new URL(release.releaseUrl, window.location.href);
        const path = url.pathname.replace(/\/$/, "").toLowerCase();
        const title = cleanText(release.title).toLowerCase();
        const artist = cleanText(release.artist).toLowerCase();
        if (path && title) {
            keys.push(`path-title:${path}:${title}:${artist}`);
        }
    } catch (_error) {
        // Ignore malformed URLs; normalizeReleaseUrl already rejected most of them.
    }

    return keys;
}

// A card can start life as a tag-only match and later be reconciled with
// the native search result for the same purchase; the marker must follow
// the current source instead of sticking around.

function getArtistMusicReleaseTitle(item, link, releaseUrl) {
    const titleNode =
        item.querySelector(".title, .item-title, .collection-item-title") ||
        null;
    const title = titleNode
        ? extractArtistMusicTitleText(titleNode)
        : normalizedText(link || item);
    if (title) {
        return title;
    }

    try {
        return cleanText(
            decodeURIComponent(
                new URL(releaseUrl, window.location.href)
                    .pathname.split("/")
                    .filter(Boolean)
                    .pop() || "",
            ).replace(/[-_]+/g, " "),
        );
    } catch (_error) {
        return "Bandcamp release";
    }
}

function extractArtistMusicTitleText(titleNode) {
    const clone = titleNode.cloneNode(true);
    clone
        .querySelectorAll(
            [
                ".artist-override",
                ".artist",
                ".item-artist",
                ".collection-item-artist",
                ".collection-item-gift-given-title",
            ].join(", "),
        )
        .forEach((node) => node.remove());
    return normalizedText(clone);
}

function getArtistMusicReleaseArtist(item) {
    const artistOverride = item.querySelector(".artist-override");
    const artistNode = item.querySelector(
        ".artist, .item-artist, .collection-item-artist",
    );
    return (
        cleanText(
            (artistOverride ? normalizedText(artistOverride) : "") ||
                (artistNode ? normalizedText(artistNode) : ""),
        ).replace(/^by\s+/i, "") ||
        getArtistMusicBandName()
    );
}

function getArtistMusicReleaseArtUrl(item) {
    const image = item.querySelector("img");
    if (!image) {
        return "";
    }

    return (
        image.getAttribute("data-original") ||
        image.currentSrc ||
        image.getAttribute("src") ||
        ""
    );
}

function getArtistMusicReleaseItemId(item) {
    const direct = firstPositiveNumber(
        item.getAttribute("data-tralbumid"),
        item.getAttribute("data-itemid"),
        item.getAttribute("data-trackid"),
    );
    if (direct) {
        return direct;
    }

    const raw = cleanText(item.getAttribute("data-item-id") || "");
    const match = raw.match(/(?:album|track)-(\d+)/i);
    return match && match[1] ? Number(match[1]) : 0;
}

function getArtistMusicReleaseBandId(item) {
    if (!(item instanceof Element)) {
        return "";
    }

    return cleanText(
        item.getAttribute("data-band-id") ||
            item.getAttribute("data-band") ||
            item.getAttribute("data-bandid") ||
            "",
    );
}

// Bandcamp puts the band identity in one script tag, but both the card
// artist link and the byline asked for it once per card. Parse it once per
// page instead of twice per card.
function getArtistMusicBandCache() {
    if (fanDataState.artistMusicBandCache) {
        return fanDataState.artistMusicBandCache;
    }

    const bandData = parseJsonAttribute(
        document.querySelector("script[data-band]"),
        "data-band",
    );
    fanDataState.artistMusicBandCache = {
        data: bandData,
        name:
            cleanText(bandData && bandData.name) ||
            metaContent(document, 'meta[property="og:site_name"]') ||
            metaContent(document, 'meta[property="og:title"]') ||
            cleanTitle(document.title) ||
            "This artist",
        url:
            cleanText(
                (bandData && (bandData.https_url || bandData.url)) || "",
            ) || window.location.origin,
    };
    return fanDataState.artistMusicBandCache;
}

export function getArtistMusicBandName() {
    return getArtistMusicBandCache().name;
}

export function getArtistMusicPageUrl() {
    return getArtistMusicBandCache().url;
}

export function getItemJsonReleaseUrl(node) {
    const parsed = getParsedItemJson(node);
    return normalizeReleaseUrl(parsed && parsed.item_url ? parsed.item_url : "");
}

export function preferBandcampReleaseUrl(urls) {
    return (urls || []).find((url) => isBandcampReleaseUrl(url)) || "";
}

export function extractParsedItemId(parsed) {
    if (!parsed || typeof parsed !== "object") {
        return 0;
    }

    return firstPositiveNumber(
        parsed.item_id,
        parsed.album_id,
        parsed.track_id,
        parsed.tralbum_id,
        parsed.collect_item_id,
    );
}

