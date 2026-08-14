    function metaContent(doc, selector) {
        return attrContent(doc, selector, "content");
    }

    function extractDescriptionHtml(doc) {
        const descriptionNode = doc.querySelector(
            ".tralbum-about, .album-about",
        );
        if (!descriptionNode) {
            return "";
        }

        return sanitizeDescriptionHtml(descriptionNode.innerHTML || "");
    }

    function sanitizeDescriptionHtml(rawHtml) {
        if (!rawHtml) {
            return "";
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${rawHtml}</div>`,
            "text/html",
        );
        const root = parsed.body.firstElementChild;
        if (!root) {
            return "";
        }

        const allowedTags = new Set(["A", "BR", "P", "EM", "STRONG", "B", "I"]);

        const sanitizeNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return parsed.createTextNode(node.textContent || "");
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                return null;
            }

            const tagName = node.tagName.toUpperCase();
            if (!allowedTags.has(tagName)) {
                const fragment = parsed.createDocumentFragment();
                Array.from(node.childNodes).forEach((child) => {
                    const sanitizedChild = sanitizeNode(child);
                    if (sanitizedChild) {
                        fragment.appendChild(sanitizedChild);
                    }
                });
                return fragment;
            }

            const cleanNode = parsed.createElement(tagName.toLowerCase());
            if (tagName === "A") {
                const href = node.getAttribute("href") || "";
                if (/^https?:\/\//i.test(href)) {
                    cleanNode.setAttribute("href", href);
                    cleanNode.setAttribute("target", "_blank");
                    cleanNode.setAttribute("rel", "noopener noreferrer");
                }
            }

            Array.from(node.childNodes).forEach((child) => {
                const sanitizedChild = sanitizeNode(child);
                if (sanitizedChild) {
                    cleanNode.appendChild(sanitizedChild);
                }
            });

            return cleanNode;
        };

        const fragment = parsed.createDocumentFragment();
        Array.from(root.childNodes).forEach((child) => {
            const sanitizedChild = sanitizeNode(child);
            if (sanitizedChild) {
                fragment.appendChild(sanitizedChild);
            }
        });

        const wrapper = parsed.createElement("div");
        wrapper.appendChild(fragment);
        return wrapper.innerHTML.trim();
    }

    function plainTextToDescriptionHtml(value, maxLength) {
        const raw = String(value || "")
            .replace(/\r\n/g, "\n")
            .trim();
        if (!raw) {
            return "";
        }

        const shortened =
            raw.length > maxLength
                ? `${raw.slice(0, maxLength - 3).trim()}...`
                : raw;
        const escaped = escapeHtml(shortened);
        const linked = escaped.replace(
            /(https?:\/\/[^\s<]+)/gi,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
        );
        return linked
            .split(/\n{2,}/)
            .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
            .join("");
    }

    function descriptionHtmlToText(value) {
        const html = String(value || "").trim();
        if (!html) {
            return "";
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${html}</div>`,
            "text/html",
        );
        return cleanText(parsed.body.textContent || "");
    }

    function isLikelyTracklistHtml(value, tracks) {
        return isLikelyTracklistText(descriptionHtmlToText(value), tracks);
    }

    function isLikelyTracklistDescription(data) {
        if (!data) {
            return false;
        }

        return (
            isLikelyTracklistText(data.description || "", data.tracks) ||
            isLikelyTracklistHtml(data.descriptionHtml || "", data.tracks)
        );
    }

    function isLikelyTracklistText(value, tracks) {
        const text = String(value || "").trim();
        if (!text || !Array.isArray(tracks) || tracks.length < 1) {
            return false;
        }

        const normalized = cleanText(text).toLowerCase();
        const numberedItems = (text.match(/\b\d+\.\s+/g) || []).length;
        const matchingTrackTitles = tracks.filter((track) => {
            const title = cleanText(
                track && track.title ? track.title : "",
            ).toLowerCase();
            return title && normalized.includes(title);
        }).length;

        const hasReleaseSummaryShape =
            /\bby\b.+\breleased\b/i.test(text) ||
            /\breleased\s+\d{1,2}\s+\w+\s+\d{4}\b/i.test(text);
        const isSingleTrackAutoSummary =
            tracks.length === 1 &&
            hasReleaseSummaryShape &&
            matchingTrackTitles >= 1 &&
            numberedItems >= 1;

        if (isSingleTrackAutoSummary) {
            return true;
        }

        if (
            matchingTrackTitles >= Math.min(4, tracks.length) &&
            numberedItems >= 2
        ) {
            return true;
        }

        if (
            hasReleaseSummaryShape &&
            matchingTrackTitles >= Math.min(2, tracks.length) &&
            numberedItems >= 1
        ) {
            return true;
        }

        return false;
    }

    function attrContent(doc, selector, attrName) {
        const node = doc.querySelector(selector);
        return node ? cleanText(node.getAttribute(attrName) || "") : "";
    }

    function textContent(doc, selector) {
        const node = doc.querySelector(selector);
        return node ? normalizedText(node) : "";
    }

    function queryTexts(doc, selector) {
        return Array.from(doc.querySelectorAll(selector))
            .map((node) => normalizedText(node))
            .filter(Boolean);
    }

    function normalizedText(node) {
        return cleanText(node.textContent || "");
    }

    function cleanText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function cleanTitle(value) {
        return cleanText(
            String(value || "").replace(/\s*\|\s*Bandcamp\s*$/i, ""),
        );
    }

    function firstString(value) {
        return typeof value === "string" && value.trim()
            ? cleanText(value)
            : "";
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const result = [];

        values.forEach((value) => {
            const cleaned = cleanText(value);
            const key = cleaned.toLowerCase();
            if (!cleaned || seen.has(key)) {
                return;
            }

            seen.add(key);
            result.push(cleaned);
        });

        return result;
    }

    function truncate(value, maxLength) {
        const text = cleanText(value);
        if (!text || text.length <= maxLength) {
            return text;
        }

        return `${text.slice(0, maxLength - 3).trim()}...`;
    }

    function compactJoin(values, separator) {
        return values.map(cleanText).filter(Boolean).join(separator);
    }

    function formatReleaseDate(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return cleanText(value);
        }

        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function buildSummaryText(data) {
        const parts = [];
        if (data && data.description) {
            parts.push("Description");
        }
        if (data && Array.isArray(data.tracks) && data.tracks.length) {
            parts.push(`${data.tracks.length} tracks`);
        }
        if (data && Array.isArray(data.tags) && data.tags.length) {
            parts.push(`${data.tags.length} tags`);
        }
        return parts.length ? parts.join(" · ") : "Extra context loaded";
    }

    function buildLoadedSummaryText(data, result) {
        const summary = buildSummaryText(data);
        if (!(result && result.fromCache)) {
            return summary;
        }

        if (result.stale) {
            return summary === "Extra context loaded"
                ? "Extra context loaded from cached fallback"
                : `${summary} · cached fallback`;
        }

        return summary === "Extra context loaded"
            ? "Extra context loaded from cache"
            : `${summary} · cached`;
    }

    function hasExpandableContent(data) {
        return Boolean(data && data.tracks && data.tracks.length);
    }

    function hasVisibleEnhancements(data) {
        if (!data || typeof data !== "object") {
            return false;
        }

        return Boolean(
            formatReleaseDate(data.releaseDate) ||
            data.location ||
            data.description ||
            (data.tags && data.tags.length) ||
            (data.tracks && data.tracks.length),
        );
    }

    function decodeJsString(value) {
        try {
            return JSON.parse(`"${value}"`);
        } catch (_error) {
            return cleanText(value);
        }
    }
