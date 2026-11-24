import { cleanText } from "./text-format.js";

const NON_PROFILE_PATH_PATTERN =
    /\/(album|track|tagged|discover|feed|fans|terms_of_use|about|help|search|gift_cards)(\/|$)/i;

export function normalizeReleaseUrl(rawUrl) {
    try {
        const url = new URL(rawUrl, window.location.href);
        if (url.protocol !== "https:") {
            return "";
        }

        if (!/(^|\/)(album|track)\//.test(url.pathname)) {
            return "";
        }

        url.hash = "";
        url.search = "";
        return url.toString().replace(/\/$/, "");
    } catch (_error) {
        return "";
    }
}

export function isBandcampReleaseUrl(rawUrl) {
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

export function isCustomDomainReleaseUrl(rawUrl) {
    const releaseUrl = normalizeReleaseUrl(rawUrl || "");
    return !!(releaseUrl && !isBandcampReleaseUrl(releaseUrl));
}

export function isBandcampFanProfileUrl(rawUrl) {
    try {
        const url = new URL(rawUrl, window.location.href);
        if (url.hostname !== "bandcamp.com") {
            return false;
        }

        const pathname = url.pathname.replace(/\/+$/, "");
        if (!pathname || pathname === "/") {
            return false;
        }

        if (NON_PROFILE_PATH_PATTERN.test(pathname)) {
            return false;
        }

        return pathname.split("/").filter(Boolean).length === 1;
    } catch (_error) {
        return false;
    }
}

export function isBandcampFanCollectionPageUrl(rawUrl) {
    try {
        const url = new URL(rawUrl, window.location.href);
        if (url.hostname !== "bandcamp.com") {
            return false;
        }

        const segments = url.pathname.split("/").filter(Boolean);
        if (segments.length === 1) {
            return isBandcampFanProfileUrl(url.href);
        }

        const fanRoot = `${url.origin}/${encodeURIComponent(segments[0])}`;
        if (!isBandcampFanProfileUrl(fanRoot)) {
            return false;
        }

        const section = segments[1].toLowerCase();
        return (
            (section === "wishlist" ||
                section === "followers" ||
                section === "following") &&
            segments.length === 2
        );
    } catch (_error) {
        return false;
    }
}

export function isLikelyProfileLink(link) {
    return Boolean(link && link.href && isBandcampFanProfileUrl(link.href));
}

export function firstPositiveNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
            return number;
        }
    }

    return 0;
}

export function normalizeReleaseItemType(rawType, releaseUrl = "") {
    const type = cleanText(rawType).toLowerCase();
    if (type === "album" || type === "a") {
        return "album";
    }
    if (type === "track" || type === "t") {
        return "track";
    }

    const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
    if (/\/album\//.test(normalizedReleaseUrl)) {
        return "album";
    }
    if (/\/track\//.test(normalizedReleaseUrl)) {
        return "track";
    }

    return "";
}
