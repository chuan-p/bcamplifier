import {
    extractFeaturedTrackTitle,
    extractFeedHeadlineActor,
    getCardAlbumReleaseUrl,
    getCardPrimaryReleaseUrl,
    getParsedItemJson,
    getStoryTitleNode,
    isMalformedFeedCard,
    looksLikeFeedCard,
} from "../utils/card-dom.js";
import { getItemJsonReleaseUrl } from "./artist-music-feed.js";
import { findContentColumn, renderReleaseData } from "./card-renderer.js";
import { getCardArtUrl, playMergedTrackTitle } from "./player.js";
import { getCardController } from "../utils/page.js";
import { isLikelyProfileLink, normalizeReleaseUrl } from "../utils/url.js";
import {
    CARD_SELECTOR,
    EXCLUDED_SECTION_SELECTOR,
    FAN_ACTIVITY_TEXT_PATTERN,
    MERGED_CHILD_ATTR,
    MERGED_PARENT_ATTR,
    RELEASE_LINK_SELECTOR,
    STATE,
} from "../state.js";
import { findCachedElementByText, findCachedSelector, getNodeMemo } from "../utils/dom.js";
import { cleanText, normalizedText } from "../utils/text-format.js";

export function isFullDiscographyCard(node) {
    if (!(node instanceof Element)) {
        return false;
    }

    const memo = getNodeMemo(node);
    if (
        memo &&
        Object.prototype.hasOwnProperty.call(memo, "fullDiscography")
    ) {
        return memo.fullDiscography === true;
    }

    const result = computeIsFullDiscographyCard(node);
    if (memo) {
        memo.fullDiscography = result;
    }
    return result;
}

function computeIsFullDiscographyCard(node) {
    const root =
        node.closest(".story-innards") ||
        node.closest("li.story") ||
        node.closest(".story") ||
        node.closest(CARD_SELECTOR) ||
        node;

    if (!(root instanceof Element)) {
        return false;
    }

    if (
        root.querySelector(
            'a.item-link[href*="#buyFullDiscography"], a[href*="#buyFullDiscography"]',
        )
    ) {
        return true;
    }

    const titleNode = root.querySelector(
        ".collection-item-title, .item-title",
    );
    if (
        titleNode &&
        /\bfull(?:\s+digital)?\s+discography\b/i.test(
            normalizedText(titleNode),
        )
    ) {
        return true;
    }

    const storyTitle = root.querySelector(".story-title");
    if (
        storyTitle &&
        /\bfull\s+discography\b/i.test(normalizedText(storyTitle))
    ) {
        return true;
    }

    return Boolean(
        root.querySelector(".bundle-art-container") &&
        root.querySelector(".bundle-releases"),
    );
}

export function mergeAdjacentTrackPurchaseCards(cards) {
    let previousCandidate = null;

    (Array.isArray(cards) ? cards : []).forEach((card) => {
        if (card.getAttribute(MERGED_CHILD_ATTR) === "true") {
            return;
        }

        // The enhanced feed already merges purchases while it builds cards.
        // Running the native merge heuristics (rect, text, link scans) over
        // every generated card on a full document scan is pure overhead.
        if (card.closest(".bcampx-label-feed")) {
            previousCandidate = null;
            return;
        }

        if (
            !looksLikeFeedCard(card) ||
            isMalformedFeedCard(card) ||
            card.closest(EXCLUDED_SECTION_SELECTOR)
        ) {
            previousCandidate = null;
            return;
        }

        const candidate = getTrackPurchaseMergeCandidate(card);
        if (!candidate) {
            previousCandidate = null;
            return;
        }

        if (
            previousCandidate &&
            getTrackPurchaseMergeKey(previousCandidate) ===
                getTrackPurchaseMergeKey(candidate)
        ) {
            mergeTrackPurchaseCard(
                previousCandidate.card,
                card,
                candidate.trackTitle,
                candidate.releaseUrl,
            );
            return;
        }

        previousCandidate = candidate;
    });
}

function getTrackPurchaseMergeKey(candidate) {
    return [
        candidate.fanKey,
        candidate.activityType,
        candidate.releaseGroupKey,
    ].join("::");
}

function getTrackPurchaseMergeCandidate(card) {
    if (!(card instanceof Element)) {
        return null;
    }

    const memo = getNodeMemo(card);
    if (
        memo &&
        Object.prototype.hasOwnProperty.call(memo, "trackPurchaseMergeCandidate")
    ) {
        return memo.trackPurchaseMergeCandidate;
    }

    const activityType = extractActivityType(card);
    if (activityType !== "bought-track") {
        if (memo) {
            memo.trackPurchaseMergeCandidate = null;
        }
        return null;
    }

    const fanKey = extractFanKey(card);
    const releaseGroupKey = getCardReleaseGroupKey(card);
    const trackTitle = extractTrackTitleFromCard(card);

    if (!fanKey || !releaseGroupKey || !trackTitle) {
        if (memo) {
            memo.trackPurchaseMergeCandidate = null;
        }
        return null;
    }

    const candidate = {
        card,
        fanKey,
        activityType,
        releaseGroupKey,
        trackTitle,
        releaseUrl: getCardPrimaryReleaseUrl(card),
    };

    if (memo) {
        memo.trackPurchaseMergeCandidate = candidate;
    }

    return candidate;
}

function extractActivityType(card) {
    const headline = findActivityHeadline(card) || getStoryTitleNode(card) || card;
    const text = normalizedText(headline).toLowerCase();
    if (
        /(?:bought|purchased)\s+a\s+track\b/.test(text) ||
        /(?:bought|purchased)\s+track\b/.test(text)
    ) {
        return "bought-track";
    }

    if (
        /(?:bought|purchased)\s+an\s+album\b/.test(text) ||
        /(?:bought|purchased)\s+album\b/.test(text)
    ) {
        return "bought-album";
    }

    if (/wishlisted\b/.test(text)) {
        return "wishlisted";
    }

    return "";
}

function extractFanKey(card) {
    if (!(card instanceof Element)) {
        return "";
    }

    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "fanKey")) {
        return memo.fanKey || "";
    }

    const explicitFanLink = card.querySelector(
        ".story-title .fan-name a[href], .story-title a.fan-name[href], .story-title .fan-name[href]",
    );
    if (explicitFanLink && explicitFanLink.href) {
        try {
            const url = new URL(explicitFanLink.href, window.location.href);
            const fanKey = cleanText(
                url.pathname.replace(/^\/+|\/+$/g, ""),
            ).toLowerCase();
            if (memo) {
                memo.fanKey = fanKey;
            }
            return fanKey;
        } catch (_error) {
            // Fall through to broader extraction.
        }
    }

    const profileLink = Array.from(card.querySelectorAll("a[href]")).find(
        isLikelyProfileLink,
    );
    if (profileLink && profileLink.href) {
        try {
            const url = new URL(profileLink.href, window.location.href);
            const fanKey = cleanText(
                url.pathname.replace(/^\/+|\/+$/g, ""),
            ).toLowerCase();
            if (memo) {
                memo.fanKey = fanKey;
            }
            return fanKey;
        } catch (_error) {
            // Fall through to text extraction.
        }
    }

    const headline = findActivityHeadline(card);
    const actor = extractFeedHeadlineActor(
        headline ? normalizedText(headline) : normalizedText(card),
    );
    const fanKey = actor ? actor.toLowerCase() : "";
    if (memo) {
        memo.fanKey = fanKey;
    }
    return fanKey;
}

function extractFanDisplayName(card) {
    if (!(card instanceof Element)) {
        return "This fan";
    }

    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "fanDisplayName")) {
        return memo.fanDisplayName || "This fan";
    }

    const explicitFanName = card.querySelector(
        ".story-title .fan-name, .story-title a.fan-name, .story-title .artist-name",
    );
    if (explicitFanName) {
        const text = normalizedText(explicitFanName);
        if (text) {
            if (memo) {
                memo.fanDisplayName = text;
            }
            return text;
        }
    }

    const headline = findActivityHeadline(card);
    const actor = extractFeedHeadlineActor(
        headline ? normalizedText(headline) : normalizedText(card),
    );
    const displayName = actor || "This fan";
    if (memo) {
        memo.fanDisplayName = displayName;
    }
    return displayName;
}

function getItemJsonTrackTitle(node) {
    const parsed = getParsedItemJson(node);
    return cleanText(
        (parsed && parsed.item_title) ||
            (parsed && parsed.track_title) ||
            (parsed && parsed.title) ||
            (parsed && parsed.item_name) ||
            (parsed && parsed.name) ||
            "",
    );
}

function getCardReleaseGroupKey(card) {
    if (!(card instanceof Element)) {
        return "";
    }

    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "cardReleaseGroupKey")) {
        return memo.cardReleaseGroupKey || "";
    }

    const albumLink = getCardAlbumReleaseUrl(card);
    if (albumLink) {
        const releaseGroupKey = `album:${albumLink}`;
        if (memo) {
            memo.cardReleaseGroupKey = releaseGroupKey;
        }
        return releaseGroupKey;
    }

    const itemJsonReleaseUrl = getItemJsonReleaseUrl(card);
    if (itemJsonReleaseUrl && /(^|\/)album\//.test(itemJsonReleaseUrl)) {
        const releaseGroupKey = `album:${itemJsonReleaseUrl}`;
        if (memo) {
            memo.cardReleaseGroupKey = releaseGroupKey;
        }
        return releaseGroupKey;
    }

    const releaseLink = Array.from(
        card.querySelectorAll(RELEASE_LINK_SELECTOR),
    )
        .map((link) => normalizeReleaseUrl(link.href))
        .find(Boolean);
    if (!releaseLink) {
        if (memo) {
            memo.cardReleaseGroupKey = "";
        }
        return "";
    }

    let origin = "";
    try {
        origin = new URL(releaseLink, window.location.href).origin;
    } catch (_error) {
        origin = "";
    }

    const artist = extractArtistNameFromCard(card).toLowerCase();
    const artUrl = normalizeMediaUrl(getCardArtUrl(card));
    // Without an album link there is no shared album identity, only a
    // release link. Two different singles by the same artist share the
    // cover and the artist, but not the release: merging them hides a card
    // whose tracks the primary release page does not contain. Fall back to
    // the release URL itself, so only the very same release merges.
    const releaseReleaseUrl = normalizeReleaseUrl(releaseLink);
    const releaseGroupKey = releaseReleaseUrl
        ? `release:${releaseReleaseUrl}`
        : `heuristic:${origin}|${artist}|${artUrl}`;
    if (memo) {
        memo.cardReleaseGroupKey = releaseGroupKey;
    }
    return releaseGroupKey;
}

function extractArtistNameFromCard(card) {
    const contentColumn = findContentColumn(card);
    const explicitByline =
        (contentColumn || card).querySelector(
            ".itemsubtext, .collection-item-artist, .item-artist, .tralbum-artist",
        ) || null;
    if (explicitByline) {
        const explicitText = cleanText(
            (explicitByline.textContent || "").replace(/^by\s+/i, ""),
        );
        if (explicitText) {
            return explicitText;
        }
    }

    const byline = findCachedElementByText(
        contentColumn || card,
        "artistByline",
        "div, p, li, span, a",
        /^by\s+/i,
    );
    if (byline) {
        return cleanText((byline.textContent || "").replace(/^by\s+/i, ""));
    }

    const text = normalizedText(card);
    const match = text.match(
        /\bby\s+(.+?)(?:\s+featured track:|\s+buy now|\s+wishlist|\s+hear more|\s+tags?:|$)/i,
    );
    return match && match[1] ? cleanText(match[1]) : "";
}

function extractTrackTitleFromCard(card) {
    if (!(card instanceof Element)) {
        return "";
    }

    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "trackTitleFromCard")) {
        return memo.trackTitleFromCard || "";
    }

    const contentColumn = findContentColumn(card);
    const trackScope = contentColumn || card;

    const featuredTrackText = extractFeaturedTrackTitle(trackScope);
    if (featuredTrackText) {
        if (memo) {
            memo.trackTitleFromCard = featuredTrackText;
        }
        return featuredTrackText;
    }

    const itemJsonTrackTitle = getItemJsonTrackTitle(trackScope);
    if (itemJsonTrackTitle) {
        if (memo) {
            memo.trackTitleFromCard = itemJsonTrackTitle;
        }
        return itemJsonTrackTitle;
    }

    const explicitTrackLink = Array.from(
        trackScope.querySelectorAll('a[href*="/track/"]'),
    ).find((link) => {
        const text = normalizedText(link);
        return (
            text &&
            !/\b(buy now|wishlist|hear more|open release|more)\b/i.test(
                text,
            )
        );
    });
    if (explicitTrackLink) {
        const trackTitle = normalizedText(explicitTrackLink);
        if (memo) {
            memo.trackTitleFromCard = trackTitle;
        }
        return trackTitle;
    }

    const explicitTitle = trackScope.querySelector(
        ".collection-item-title, .item-title, h1, h2, h3, h4",
    );
    if (
        explicitTitle &&
        !explicitTitle.closest(".story-title, .bcampx__merge-note")
    ) {
        const explicitText = normalizedText(explicitTitle);
        if (
            explicitText &&
            !/^(featured track:|by\s+|buy now|wishlist|hear more|supported by|tracks?)\b/i.test(
                explicitText,
            )
        ) {
            if (memo) {
                memo.trackTitleFromCard = explicitText;
            }
            return explicitText;
        }
    }

    const titleCandidate = Array.from(
        trackScope.querySelectorAll(
            "h1, h2, h3, h4, strong, a, div, p, span",
        ),
    ).find((node) => {
        const text = normalizedText(node);
        if (!text) {
            return false;
        }

        if (
            /^(featured track:|by\s+|buy now|wishlist|hear more|supported by|tracks?)\b/i.test(
                text,
            )
        ) {
            return false;
        }

        if (node.querySelector && node.querySelector("img")) {
            return false;
        }

        if (
            node.closest &&
            node.closest(".story-title, .bcampx__merge-note")
        ) {
            return false;
        }

        return true;
    });

    const trackTitle = titleCandidate ? normalizedText(titleCandidate) : "";
    if (memo) {
        memo.trackTitleFromCard = trackTitle;
    }
    return trackTitle;
}

function normalizeMediaUrl(value) {
    if (!value) {
        return "";
    }

    try {
        const url = new URL(value, window.location.href);
        url.hash = "";
        url.search = "";
        return url.toString();
    } catch (_error) {
        return cleanText(value);
    }
}

function mergeTrackPurchaseCard(
    primaryCard,
    duplicateCard,
    trackTitle,
    sourceReleaseUrl,
) {
    if (!primaryCard || !duplicateCard || primaryCard === duplicateCard) {
        return;
    }

    const mergeState = ensureMergedTrackState(primaryCard);
    if (!mergeState.primaryTitle) {
        mergeState.primaryTitle = extractTrackTitleFromCard(primaryCard);
    }
    addMergedTrackTitle(primaryCard, trackTitle, sourceReleaseUrl);

    primaryCard.setAttribute(MERGED_PARENT_ATTR, "true");
    duplicateCard.setAttribute(MERGED_CHILD_ATTR, "true");
    duplicateCard.style.display = "none";
    duplicateCard.hidden = true;

    if (STATE.observer) {
        STATE.observer.unobserve(duplicateCard);
    }

    updateMergedTrackPurchaseNotice(primaryCard);
    syncTrackButtonsForCard(primaryCard);
}

export function getMergedTrackTitleSet(card) {
    const mergeState = ensureMergedTrackState(card);
    const titles = mergeState.titles.slice();
    const primaryTitle = cleanText(
        mergeState.primaryTitle || extractTrackTitleFromCard(card),
    );
    if (primaryTitle) {
        titles.unshift(primaryTitle);
    }

    return new Set(
        titles
            .map((title) => cleanText(title).toLowerCase())
            .filter(Boolean),
    );
}

function ensureMergedTrackState(card) {
    if (!card) {
        return { primaryTitle: "", titles: [] };
    }

    if (!card.__bcampxMergeState) {
        card.__bcampxMergeState = {
            primaryTitle: "",
            titles: [],
            sources: [],
        };
    }

    if (!Array.isArray(card.__bcampxMergeState.titles)) {
        card.__bcampxMergeState.titles = [];
    }

    if (!Array.isArray(card.__bcampxMergeState.sources)) {
        card.__bcampxMergeState.sources = [];
    }

    return card.__bcampxMergeState;
}

function addMergedTrackTitle(card, title, sourceReleaseUrl) {
    const normalizedTitle = cleanText(title);
    if (!normalizedTitle) {
        return;
    }

    const mergeState = ensureMergedTrackState(card);
    if (
        !mergeState.titles.some(
            (entry) =>
                entry.toLowerCase() === normalizedTitle.toLowerCase(),
        )
    ) {
        mergeState.titles.push(normalizedTitle);
    }

    // Remember which purchase page this title came from. The primary card
    // URL only resolves the first purchase's tracklist.
    const releaseUrl = normalizeReleaseUrl(sourceReleaseUrl || "");
    if (
        releaseUrl &&
        !mergeState.sources.some(
            (entry) =>
                entry &&
                cleanText(entry.title).toLowerCase() ===
                    normalizedTitle.toLowerCase() &&
                entry.releaseUrl === releaseUrl,
        )
    ) {
        mergeState.sources.push({ title: normalizedTitle, releaseUrl });
    }
}

export function findActivityHeadline(card) {
    const memo = getNodeMemo(card);
    if (memo && Object.prototype.hasOwnProperty.call(memo, "activityHeadlineNode")) {
        return memo.activityHeadlineNode;
    }

    const storyTitle = findCachedSelector(card, "storyTitleNode", ".story-title");
    let result = null;
    if (
        storyTitle &&
        FAN_ACTIVITY_TEXT_PATTERN.test(normalizedText(storyTitle))
    ) {
        result = storyTitle;
    } else {
        result = findCachedElementByText(
        card,
        "activityHeadline",
        "div, p, li, span, strong, h2, h3, h4",
        /\b(bought|wishlisted|supported|recommended|listening|played)\b/i,
    );
    }

    if (memo) {
        memo.activityHeadlineNode = result || null;
    }
    return result || null;
}

function updateMergedTrackPurchaseNotice(card) {
    const mergeState = ensureMergedTrackState(card);
    const primaryTitle = cleanText(
        mergeState.primaryTitle || "",
    ).toLowerCase();
    const mergedTrackTitles = mergeState.titles.filter((title) => {
        const normalizedTitle = cleanText(title).toLowerCase();
        return normalizedTitle && normalizedTitle !== primaryTitle;
    });
    if (!mergedTrackTitles.length) {
        const existing = card.querySelector(".bcampx__merge-note");
        if (existing) {
            existing.remove();
        }
        return;
    }

    const notice = ensureMergedTrackPurchaseNotice(card);
    if (!notice) {
        return;
    }

    const fanName = extractFanDisplayName(card);
    notice.textContent = "";

    const fan = document.createElement("span");
    fan.className = "bcampx__merge-fan";
    fan.textContent = fanName;

    const verb = document.createElement("span");
    verb.className = "bcampx__merge-copy";
    verb.textContent = " also bought ";

    notice.append(fan, verb);

    mergedTrackTitles.forEach((title, index) => {
        if (index > 0) {
            const separator = document.createElement("span");
            separator.className = "bcampx__merge-copy";
            separator.textContent = ", ";
            notice.append(separator);
        }

        const track = document.createElement("button");
        track.type = "button";
        track.className = "bcampx__merge-track-button";
        track.dataset.trackTitle = title;
        track.textContent = `"${title}"`;
        track.addEventListener("click", () => {
            playMergedTrackTitle(card, title, track);
        });
        notice.append(track);
    });
}

function ensureMergedTrackPurchaseNotice(card) {
    const existing = card.querySelector(".bcampx__merge-note");
    if (existing) {
        return existing;
    }

    const notice = document.createElement("div");
    notice.className = "bcampx__merge-note";

    const headline = findActivityHeadline(card);
    if (headline && headline.parentNode) {
        headline.insertAdjacentElement("afterend", notice);
        return notice;
    }

    const contentColumn = findContentColumn(card);
    contentColumn.insertBefore(notice, contentColumn.firstChild || null);
    return notice;
}

export function syncTrackButtonsForCard(card) {
    const controller = getCardController(card);
    if (controller && controller.loaded && controller.data) {
        const shell = card.querySelector(".bcampx");
        const meta = shell ? shell.querySelector(".bcampx__meta") : null;
        const text = shell
            ? shell.querySelector(".bcampx__summary-text")
            : null;
        const toggle = shell
            ? shell.querySelector(".bcampx__toggle")
            : null;
        if (shell && meta && text && toggle) {
            renderReleaseData(
                shell,
                meta,
                text,
                toggle,
                controller.data,
                controller.releaseUrl || "",
            );
        }
    }
}

export function isFullDiscographyReleaseData(data) {
    const title = cleanText(data && data.title);
    return /\bfull(?:\s+digital)?\s+discography\b/i.test(title);
}
