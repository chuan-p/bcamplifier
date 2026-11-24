import { createTrackData, normalizeReleaseData, parseJsonAttribute } from "../data/release-data.js";
import {
    buildFanCollectionCardPreview,
    extractParsedItemId,
    getFanCollectionCachedItem,
    getFanCollectionCardKind,
    getItemJsonReleaseUrl,
    isOwnFanTrackCard,
    preferBandcampReleaseUrl,
} from "../features/fan-collection-data.js";
import { findActivityHeadline } from "../features/card-merge.js";
import { getCardArtUrl } from "../features/player.js";
import {
    CONFIG,
    EXCLUDED_SECTION_SELECTOR,
    FAN_ACTIVITY_TEXT_PATTERN,
    FEED_CARD_ROOT_SELECTOR,
    RELEASE_LINK_SELECTOR,
    STATE,
} from "../state.js";
import {
    findCachedElementByText,
    getMatchingRootOrDescendants,
    getNodeMemo,
} from "./dom.js";
import { getCardController, isFanCollectionPage } from "./page.js";
import { cleanText, normalizedText } from "./text-format.js";
import {
    isBandcampFanCollectionPageUrl,
    isLikelyProfileLink,
    normalizeReleaseItemType,
    normalizeReleaseUrl,
} from "./url.js";

const previewCache = {
    tracks: null,
    trackMap: null,
};

export function getCardAlbumReleaseUrl(card) {
    if (!(card instanceof Element)) {
        return "";
    }

    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "cardAlbumReleaseUrl")) {
        return memo.cardAlbumReleaseUrl || "";
    }

    const albumLinks = Array.from(
        card.querySelectorAll('a[href*="/album/"]'),
    )
        .map((link) => normalizeReleaseUrl(link.href))
        .filter(Boolean);
    const albumLink = preferBandcampReleaseUrl(albumLinks) || albumLinks[0] || "";

    if (memo) {
        memo.cardAlbumReleaseUrl = albumLink;
    }

    return albumLink;
}

function getCardRawReleaseUrl(card) {
    if (!(card instanceof Element)) {
        return "";
    }

    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "cardRawReleaseUrl")) {
        return memo.cardRawReleaseUrl || "";
    }

    const releaseLinks = Array.from(card.querySelectorAll(RELEASE_LINK_SELECTOR))
        .map((link) => normalizeReleaseUrl(link.href))
        .filter(Boolean);
    const itemJsonReleaseUrl = getItemJsonReleaseUrl(card);
    const rawReleaseUrl =
        preferBandcampReleaseUrl([
            ...releaseLinks,
            itemJsonReleaseUrl,
        ].filter(Boolean)) ||
        releaseLinks[0] ||
        itemJsonReleaseUrl ||
        "";

    if (memo) {
        memo.cardRawReleaseUrl = rawReleaseUrl;
    }

    return rawReleaseUrl;
}

export function getCardReleaseRequestContext(card, releaseUrl = "") {
    const normalizedReleaseUrl = normalizeReleaseUrl(
        releaseUrl || getCardPrimaryReleaseUrl(card),
    );
    const parsed = getParsedItemJson(card);
    return {
        releaseUrl: normalizedReleaseUrl,
        itemId: extractParsedItemId(parsed),
        itemType: normalizeReleaseItemType(
            parsed &&
                (parsed.item_type ||
                    parsed.tralbum_type ||
                    parsed.type ||
                    parsed.collect_item_type),
            normalizedReleaseUrl,
        ),
        requirePageFreshTracks:
            isBandcampFanCollectionPageUrl(window.location.href) &&
            Boolean(
                card &&
                    card.classList &&
                    card.classList.contains("bcampx-label-feed-card"),
            ),
        allowCachedTrackSnapshot:
            isBandcampFanCollectionPageUrl(window.location.href) &&
            Boolean(
                card &&
                    card.classList &&
                    card.classList.contains("bcampx-label-feed-card"),
            ),
    };
}

export function getCardPrimaryReleaseUrl(card) {
    if (!(card instanceof Element)) {
        return "";
    }

    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "cardPrimaryReleaseUrl")) {
        return memo.cardPrimaryReleaseUrl || "";
    }

    const albumLink = getCardAlbumReleaseUrl(card);
    if (albumLink) {
        if (memo) {
            memo.cardPrimaryReleaseUrl = albumLink;
        }
        return albumLink;
    }

    let primaryReleaseUrl = getCardRawReleaseUrl(card);
    if (!primaryReleaseUrl) {
        // Collection items whose native link is gone still have their URL
        // in pagedata's item_cache.
        const cachedItem = getFanCollectionCachedItem(
            card,
            getFanCollectionCardKind(card),
        );
        primaryReleaseUrl = cleanText(cachedItem && cachedItem.item_url);
    }

    if (memo) {
        memo.cardPrimaryReleaseUrl = primaryReleaseUrl;
    }

    return primaryReleaseUrl;
}

export function getStoryRoot(node) {
    if (!(node instanceof Element)) {
        return null;
    }

    const story = node.matches(FEED_CARD_ROOT_SELECTOR)
        ? node
        : node.closest(FEED_CARD_ROOT_SELECTOR);
    return story instanceof Element ? story : null;
}

export function getStoryTitleNode(card) {
    const story = getStoryRoot(card);
    if (!story) {
        return null;
    }

    const title = story.querySelector(".story-title");
    return title instanceof Element ? title : null;
}

export function extractFeedHeadlineActor(headlineText) {
    const match = cleanText(headlineText).match(
        /^(.+?)\s+(?:bought|purchased|wishlisted|supported|recommended|listening|played|posted|released)\b/i,
    );
    return match && match[1] ? cleanText(match[1]) : "";
}

export function getParsedItemJson(node) {
    if (!(node instanceof Element)) {
        return null;
    }

    const holder = node.matches("[data-item-json]")
        ? node
        : node.querySelector("[data-item-json]");
    if (!(holder instanceof Element)) {
        return null;
    }

    const memo = getNodeMemo(holder);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "parsedItemJson")) {
        return memo.parsedItemJson;
    }

    const parsed = parseJsonAttribute(holder, "data-item-json") || null;
    if (memo) {
        memo.parsedItemJson = parsed;
    }

    return parsed;
}

export function getCollectionGridFeaturedPreview(card) {
    const memo = getNodeMemo(card);
    if (
        memo &&
        Object.prototype.hasOwnProperty.call(
            memo,
            "collectionGridFeaturedPreview",
        )
    ) {
        return memo.collectionGridFeaturedPreview;
    }

    const parsed = getParsedItemJson(card);
    const trackId = cleanText(parsed && parsed.featured_track);
    if (!trackId) {
        // Current collection pages carry the preview data in pagedata
        // (item_cache / tracklists) instead of per-item JSON attributes.
        const fanPreview = buildFanCollectionCardPreview(card);
        if (fanPreview && memo) {
            memo.collectionGridFeaturedPreview = fanPreview;
        }
        return fanPreview;
    }

    const preview = getFeedPreviewTrackMap().get(trackId);
    const streamUrl = cleanText(
        preview &&
            preview.streaming_url &&
            preview.streaming_url["mp3-128"],
    );
    if (!preview || !streamUrl) {
        return null;
    }

    const track = createTrackData(
        preview.title || parsed.featured_track_title,
        preview.track_id || trackId,
        streamUrl,
        preview.duration || parsed.featured_track_duration,
        preview.track_url || parsed.featured_track_url || "",
    );
    if (!track) {
        return null;
    }

    const art =
        parsed && parsed.item_art && typeof parsed.item_art === "object"
            ? parsed.item_art
            : {};
    const result = {
        track,
        data: normalizeReleaseData({
            url: getItemJsonReleaseUrl(card),
            title: parsed.album_title || parsed.item_title || "",
            artist: parsed.band_name || preview.band_name || "",
            artUrl:
                parsed.item_art_url ||
                art.url ||
                getCardArtUrl(card),
            tracks: [track],
        }),
    };
    if (memo) {
        memo.collectionGridFeaturedPreview = result;
    }
    return result;
}

export function getFeedPreviewTracks() {
    if (Array.isArray(previewCache.tracks)) {
        return previewCache.tracks;
    }

    const blob =
        parseJsonAttribute(
            document.querySelector("#pagedata"),
            "data-blob",
        ) || {};
    previewCache.tracks = Array.isArray(blob.track_list)
        ? blob.track_list
        : [];
    return previewCache.tracks;
}

export function getFeedPreviewTrackMap() {
    if (previewCache.trackMap instanceof Map) {
        return previewCache.trackMap;
    }

    previewCache.trackMap = new Map();
    getFeedPreviewTracks().forEach((track) => {
        const trackId = cleanText(track && track.track_id);
        if (trackId) {
            previewCache.trackMap.set(trackId, track);
        }
    });
    return previewCache.trackMap;
}

export function isMalformedFeedCard(card) {
    const story = getStoryRoot(card);
    if (!story || !hasExplicitFeedStoryStructure(story)) {
        return false;
    }

    const directReleaseUrl = getMatchingRootOrDescendants(
        story,
        RELEASE_LINK_SELECTOR,
    )
        .map((link) => normalizeReleaseUrl(link.href))
        .find(Boolean);
    if (directReleaseUrl) {
        return false;
    }

    return Boolean(getItemJsonReleaseUrl(story));
}

export function isAlsoBoughtRecommendationCard(card) {
    const headline = findActivityHeadline(card) || getStoryTitleNode(card);
    if (!headline) {
        return false;
    }

    if (!/\balso bought\b/i.test(normalizedText(headline))) {
        return false;
    }

    return hasAlsoBoughtRecommendationMarkers(card);
}

function hasAlsoBoughtRecommendationMarkers(card) {
    if (!(card instanceof Element)) {
        return false;
    }

    if (
        card.querySelector(
            "a.follow-fan, .follow-fan, a.view-collection, .view-collection",
        )
    ) {
        return true;
    }

    const actionTexts = Array.from(card.querySelectorAll("a, button"))
        .map((node) => normalizedText(node).toLowerCase())
        .filter(Boolean);
    return (
        actionTexts.some((text) => /\bfollow\b/.test(text)) &&
        actionTexts.some((text) => /\bview collection\b/.test(text))
    );
}

export function findFeaturedTrackForCard(card, trigger, data) {
    if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
        return null;
    }

    const triggerWithTrackId =
        trigger && trigger.closest
            ? trigger.closest("[data-trackid]")
            : null;
    const triggerTrackId = cleanText(
        triggerWithTrackId &&
            triggerWithTrackId.getAttribute("data-trackid"),
    );
    if (triggerTrackId) {
        const exactTrack = data.tracks.find(
            (track) =>
                cleanText(track && track.trackId) === triggerTrackId &&
                track.streamUrl,
        );
        if (exactTrack) {
            return exactTrack;
        }
    }

    const parsed = getParsedItemJson(card);
    const parsedFeaturedTrackId = cleanText(
        parsed && parsed.featured_track,
    );
    if (parsedFeaturedTrackId) {
        const exactTrack = data.tracks.find(
            (track) =>
                cleanText(track && track.trackId) ===
                    parsedFeaturedTrackId && track.streamUrl,
        );
        if (exactTrack) {
            return exactTrack;
        }
    }

    const parsedFeaturedTitle = cleanText(
        parsed && parsed.featured_track_title,
    );
    if (parsedFeaturedTitle) {
        const normalizedParsedTitle = parsedFeaturedTitle.toLowerCase();
        const titleMatch = data.tracks.find(
            (track) =>
                cleanText(track && track.title).toLowerCase() ===
                    normalizedParsedTitle && track.streamUrl,
        );
        if (titleMatch) {
            return titleMatch;
        }
    }

    const featuredTitle = extractFeaturedTrackTitle(card);
    if (featuredTitle) {
        const normalizedFeaturedTitle =
            cleanText(featuredTitle).toLowerCase();
        const titleMatch = data.tracks.find(
            (track) =>
                cleanText(track && track.title).toLowerCase() ===
                    normalizedFeaturedTitle && track.streamUrl,
        );
        if (titleMatch) {
            return titleMatch;
        }

        const fuzzyTitleMatch = data.tracks.find(
            (track) =>
                cleanText(track && track.title)
                    .toLowerCase()
                    .includes(normalizedFeaturedTitle) && track.streamUrl,
        );
        if (fuzzyTitleMatch) {
            return fuzzyTitleMatch;
        }
    }

    return data.tracks.find((track) => track && track.streamUrl) || null;
}

export function extractFeaturedTrackTitle(card) {
    const featuredLine = findCachedElementByText(
        card,
        "featuredTrackLine",
        "div, p, li, section, span",
        /^featured track\s*:/i,
    );
    if (!featuredLine) {
        return "";
    }

    const inlineLink = featuredLine.querySelector('a[href*="/track/"]');
    if (inlineLink) {
        return normalizedText(inlineLink);
    }

    const inlineText = cleanText(
        (featuredLine.textContent || "").replace(
            /^featured track\s*:/i,
            "",
        ),
    );
    if (inlineText) {
        return inlineText;
    }

    let sibling = featuredLine.nextElementSibling;
    while (sibling) {
        const text = normalizedText(sibling);
        if (text && !/^by\s+/i.test(text)) {
            return text;
        }
        sibling = sibling.nextElementSibling;
    }

    const containerText = normalizedText(featuredLine.parentElement);
    const match = containerText.match(/featured track:\s*(.+)$/i);
    return match && match[1] ? cleanText(match[1]) : "";
}


export function looksLikeFeedCard(node) {
    if (!(node instanceof Element)) {
        return false;
    }

    const memo = getNodeMemo(node);
    if (
        memo &&
        Object.prototype.hasOwnProperty.call(memo, "looksLikeFeedCard")
    ) {
        return memo.looksLikeFeedCard;
    }

    const result = computeLooksLikeFeedCard(node);
    if (memo) {
        memo.looksLikeFeedCard = result;
    }
    return result;
}

function computeLooksLikeFeedCard(node) {
    if (isAlsoBoughtRecommendationCard(node)) {
        return false;
    }

    if (!isLikelyFanActivityCard(node)) {
        return false;
    }

    if (!hasFanActivitySignals(node)) {
        return false;
    }

    const releaseLinkCount = node.querySelectorAll(
        RELEASE_LINK_SELECTOR,
    ).length;
    if (releaseLinkCount < 1 || releaseLinkCount > 12) {
        return false;
    }

    const rect = node.getBoundingClientRect();
    const hasUsefulSize = rect.width >= 120 && rect.height >= 45;
    const hasCoverOrText =
        Boolean(node.querySelector("img")) ||
        normalizedText(node).length > 20;
    return hasUsefulSize && hasCoverOrText;
}

function hasFanActivitySignals(node) {
    if (
        node.querySelector(
            ".story-title .fan-name, .story-title .artist-name",
        )
    ) {
        return true;
    }

    if (
        node.querySelector(".story-title") &&
        FAN_ACTIVITY_TEXT_PATTERN.test(
            normalizedText(node.querySelector(".story-title")),
        )
    ) {
        return true;
    }

    const text = normalizedText(node);
    if (FAN_ACTIVITY_TEXT_PATTERN.test(text)) {
        return true;
    }

    const profileLinks = Array.from(
        node.querySelectorAll("a[href]"),
    ).filter(isLikelyProfileLink);
    return profileLinks.length > 0;
}

function isLikelyFanActivityCard(node) {
    if (!(node instanceof Element)) {
        return false;
    }

    if (
        node.closest(EXCLUDED_SECTION_SELECTOR) ||
        hasSidebarLikeAncestor(node)
    ) {
        return false;
    }

    if (hasExplicitFeedStoryStructure(node)) {
        return true;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.width < CONFIG.minFanActivityCardWidth) {
        return false;
    }

    return true;
}

function hasExplicitFeedStoryStructure(node) {
    const story = getStoryRoot(node);

    if (!(story instanceof Element)) {
        return false;
    }

    if (
        story.matches("li.story") &&
        story.hasAttribute("data-story-fan-id")
    ) {
        return true;
    }

    if (
        story.querySelector(".story-title") &&
        story.querySelector(".story-innards")
    ) {
        return true;
    }

    if (
        story.querySelector(".story-title") &&
        story.querySelector(".tralbum-wrapper")
    ) {
        return true;
    }

    return false;
}

function hasSidebarLikeAncestor(node) {
    let current = node;

    for (
        let depth = 0;
        current && current !== document.body && depth < 8;
        depth += 1
    ) {
        const idAndClass =
            `${current.id || ""} ${typeof current.className === "string" ? current.className : ""}`.toLowerCase();
        if (
            /(sidebar|side-bar|side_module|right[-_ ]?col|right[-_ ]?column|recommend|discover|new[-_ ]?release)/.test(
                idAndClass,
            )
        ) {
            return true;
        }

        current = current.parentElement;
    }

    return false;
}

