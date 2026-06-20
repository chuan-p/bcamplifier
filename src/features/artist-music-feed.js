    async function buildArtistMusicFeed() {
        if (STATE.artistMusicFeedBuilt || !isArtistMusicPage()) {
            return false;
        }

        const releases = collectArtistMusicReleaseCandidates();
        if (!releases.length) {
            markDebugState("data-bcampx-label-feed-state", "empty");
            return false;
        }

        const sourceGrid = findArtistMusicSourceGrid();
        if (!sourceGrid || !sourceGrid.parentNode) {
            markDebugState("data-bcampx-label-feed-state", "missing-source");
            return false;
        }

        const feed = document.createElement("section");
        feed.className = "bcampx-label-feed";
        feed.setAttribute("aria-label", "Bandcamp release feed");

        const list = document.createElement("ol");
        list.className = "bcampx-label-feed__list";
        releases.forEach((release) => {
            list.appendChild(createArtistMusicFeedCard(release));
        });
        feed.appendChild(list);

        const storedView = cleanText(
            await storageGet(ARTIST_MUSIC_VIEW_KEY, "feed"),
        );
        STATE.artistMusicFeedView = storedView === "original" ? "original" : "feed";
        STATE.artistMusicFeedNode = feed;
        STATE.artistMusicSourceGridNode = sourceGrid;
        STATE.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();

        sourceGrid.parentNode.insertBefore(feed, sourceGrid);
        document.body.classList.add("bcampx-label-feed-page");
        ensureArtistMusicViewToggle();
        applyArtistMusicFeedView(STATE.artistMusicFeedView);
        STATE.artistMusicFeedBuilt = true;

        markDebugState("data-bcampx-label-feed-state", "ready");
        markDebugState("data-bcampx-label-feed-count", String(releases.length));
        markDebugState(
            "data-bcampx-label-feed-visible-count",
            String(releases.length),
        );
        return true;
    }

    function ensureArtistMusicViewToggle() {
        if (STATE.artistMusicToggleNode || !document.body) {
            return STATE.artistMusicToggleNode;
        }

        const button = document.createElement("div");
        button.className = "bcampx-label-feed-toggle";
        button.setAttribute("role", "button");
        button.setAttribute("tabindex", "0");
        button.addEventListener("click", () => {
            void setArtistMusicFeedView(
                STATE.artistMusicFeedView === "feed" ? "original" : "feed",
            );
        });
        button.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            event.preventDefault();
            button.click();
        });
        button.append(
            createArtistMusicViewToggleIcon("original"),
            createArtistMusicViewToggleIcon("feed"),
        );

        document.body.appendChild(button);
        STATE.artistMusicToggleNode = button;
        positionArtistMusicViewToggle();
        scheduleArtistMusicViewTogglePlacement();
        return button;
    }

    function createArtistMusicViewToggleIcon(view) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.classList.add("bcampx-label-feed-toggle__icon");
        svg.classList.add(`bcampx-label-feed-toggle__icon--${view}`);
        svg.setAttribute("viewBox", "0 0 20 20");
        svg.setAttribute("width", "13");
        svg.setAttribute("height", "13");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");

        if (view === "feed") {
            [
                ["4", "5", "12"],
                ["4", "10", "12"],
                ["4", "15", "12"],
            ].forEach(([x1, y, x2]) => {
                const line = document.createElementNS(SVG_NS, "path");
                line.setAttribute("d", `M${x1} ${y}h${x2}`);
                line.setAttribute("fill", "none");
                line.setAttribute("stroke", "currentColor");
                line.setAttribute("stroke-width", "1.35");
                line.setAttribute("stroke-linecap", "round");
                svg.appendChild(line);
            });
            return svg;
        }

        [
            ["4", "4"],
            ["11", "4"],
            ["4", "11"],
            ["11", "11"],
        ].forEach(([x, y]) => {
            const rect = document.createElementNS(SVG_NS, "rect");
            rect.setAttribute("x", x);
            rect.setAttribute("y", y);
            rect.setAttribute("width", "5");
            rect.setAttribute("height", "5");
            rect.setAttribute("rx", "0.8");
            rect.setAttribute("fill", "none");
            rect.setAttribute("stroke", "currentColor");
            rect.setAttribute("stroke-width", "1.25");
            svg.appendChild(rect);
        });
        return svg;
    }

    function scheduleArtistMusicViewTogglePlacement() {
        [250, 1000, 2500].forEach((delay) => {
            window.setTimeout(positionArtistMusicViewToggle, delay);
        });
    }

    function positionArtistMusicViewToggle() {
        const button = STATE.artistMusicToggleNode;
        if (!button || !document.body) {
            return;
        }

        const navbar = document.querySelector("#band-navbar");
        if (navbar) {
            navbar.appendChild(button);
            navbar.classList.add("bcampx-label-feed-navbar-host");
            button.classList.remove("bcampx-label-feed-toggle--floating");
            button.classList.add("bcampx-label-feed-toggle--inline");
            button.classList.add("bcampx-label-feed-toggle--navbar");
            return;
        }

        const target = findArtistMusicViewToggleTarget();
        if (target && target.parentNode) {
            target.parentNode.insertBefore(button, target);
            button.classList.remove("bcampx-label-feed-toggle--floating");
            button.classList.add("bcampx-label-feed-toggle--inline");
            button.classList.remove("bcampx-label-feed-toggle--navbar");
            return;
        }

        if (!document.body.contains(button)) {
            document.body.appendChild(button);
        }
        button.classList.remove("bcampx-label-feed-toggle--inline");
        button.classList.remove("bcampx-label-feed-toggle--navbar");
        button.classList.add("bcampx-label-feed-toggle--floating");
    }

    function findArtistMusicViewToggleTarget() {
        return (
            document.querySelector(".label-band-selector.fade-in-on-load") ||
            document.querySelector(".label-band-selector")
        );
    }

    async function setArtistMusicFeedView(view) {
        const nextView = view === "original" ? "original" : "feed";
        applyArtistMusicFeedView(nextView);
        await storageSet(ARTIST_MUSIC_VIEW_KEY, nextView);
    }

    function applyArtistMusicFeedView(view) {
        const nextView = view === "original" ? "original" : "feed";
        const feed = STATE.artistMusicFeedNode;
        const sourceGrid = STATE.artistMusicSourceGridNode;

        STATE.artistMusicFeedView = nextView;
        if (feed) {
            feed.hidden = nextView !== "feed";
        }
        if (sourceGrid) {
            setArtistMusicNativeSectionHidden(
                sourceGrid,
                nextView === "feed",
                "offscreen",
            );
            sourceGrid.setAttribute(
                "data-bcampx-label-feed-source-hidden",
                nextView === "feed" ? "true" : "false",
            );
        }
        STATE.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();
        STATE.artistMusicFeaturedNodes.forEach((node) => {
            setArtistMusicNativeSectionHidden(node, nextView === "feed");
            node.setAttribute(
                "data-bcampx-label-feed-featured-hidden",
                nextView === "feed" ? "true" : "false",
            );
        });

        document.body.classList.toggle(
            "bcampx-label-feed-page--original",
            nextView === "original",
        );
        document.body.classList.toggle(
            "bcampx-label-feed-page--enhanced",
            nextView === "feed",
        );

        updateArtistMusicViewToggle();
        markDebugState("data-bcampx-label-feed-view", nextView);

        if (nextView === "feed" && feed) {
            scheduleScan(feed);
            scheduleArtistMusicFeedVisibleFetch(feed);
        }
    }

    function scheduleArtistMusicFeedVisibleFetch(feed) {
        window.setTimeout(() => {
            fetchVisibleArtistMusicFeedCards(feed);
        }, CONFIG.scanDebounceMs + 40);
    }

    function fetchVisibleArtistMusicFeedCards(feed) {
        if (!(feed instanceof Element) || feed.hidden) {
            return;
        }

        const viewportHeight =
            window.innerHeight || document.documentElement.clientHeight || 0;
        const viewportWidth =
            window.innerWidth || document.documentElement.clientWidth || 0;
        const preloadMargin = getArtistMusicFeedPreloadMargin();

        Array.from(feed.querySelectorAll(".bcampx-label-feed-card")).forEach(
            (card) => {
                if (
                    !isArtistMusicFeedCardVisible(
                        card,
                        viewportWidth,
                        viewportHeight,
                        preloadMargin,
                    )
                ) {
                    return;
                }

                const releaseUrl = cleanText(
                    card.getAttribute("data-bcampx-release-url") || "",
                );
                if (!releaseUrl) {
                    return;
                }

                const controller = ensureCardController(card, releaseUrl);
                if (
                    controller &&
                    !controller.loaded &&
                    !controller.loading
                ) {
                    controller.fetchAndRender({ auto: true });
                }
            },
        );
    }

    function getArtistMusicFeedPreloadMargin() {
        const match = String(CONFIG.observerRootMargin || "").match(/(-?\d+)px/);
        return match ? Math.max(0, Number(match[1])) : 0;
    }

    function isArtistMusicFeedCardVisible(
        card,
        viewportWidth,
        viewportHeight,
        preloadMargin,
    ) {
        if (!(card instanceof Element)) {
            return false;
        }

        const rect = card.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        return (
            rect.bottom >= -preloadMargin &&
            rect.right >= 0 &&
            rect.top <= viewportHeight + preloadMargin &&
            rect.left <= viewportWidth
        );
    }

    function setArtistMusicNativeSectionHidden(node, hidden, mode = "display") {
        if (!(node instanceof Element)) {
            return;
        }

        if (mode === "offscreen") {
            node.hidden = false;
            node.classList.toggle(
                "bcampx-label-feed-native-offscreen",
                hidden,
            );
            if (hidden) {
                node.setAttribute("aria-hidden", "true");
                node.style.removeProperty("display");
                return;
            }

            node.classList.remove("bcampx-label-feed-native-offscreen");
            node.removeAttribute("aria-hidden");
            return;
        }

        node.classList.remove("bcampx-label-feed-native-offscreen");
        node.hidden = hidden;
        if (hidden) {
            if (!node.hasAttribute("data-bcampx-original-display")) {
                node.setAttribute(
                    "data-bcampx-original-display",
                    node.style.display || "",
                );
            }
            node.style.display = "none";
            return;
        }

        const originalDisplay = node.getAttribute(
            "data-bcampx-original-display",
        );
        node.removeAttribute("data-bcampx-original-display");
        if (originalDisplay) {
            node.style.display = originalDisplay;
        } else {
            node.style.removeProperty("display");
        }
    }

    function updateArtistMusicViewToggle() {
        const toggle = STATE.artistMusicToggleNode;
        if (!toggle) {
            return;
        }

        const showingFeed = STATE.artistMusicFeedView === "feed";
        toggle.classList.toggle(
            "bcampx-label-feed-toggle--feed",
            showingFeed,
        );
        toggle.classList.toggle(
            "bcampx-label-feed-toggle--original",
            !showingFeed,
        );
        toggle.setAttribute(
            "aria-label",
            showingFeed ? "Show original grid" : "Show enhanced feed",
        );
        toggle.setAttribute("aria-pressed", showingFeed ? "true" : "false");
        toggle.title = showingFeed ? "Show original grid" : "Show enhanced feed";
    }

    function findArtistMusicSourceGrid() {
        const gridItem = document.querySelector(".music-grid-item");
        return (
            document.querySelector("#music-grid") ||
            document.querySelector(".music-grid") ||
            (gridItem ? gridItem.parentElement : null) ||
            null
        );
    }

    function findArtistMusicFeaturedNodes() {
        const nodes = new Set();
        document
            .querySelectorAll(".featured-grid.featured-items, .featured-items")
            .forEach((node) => nodes.add(node));
        document.querySelectorAll(".featured-item").forEach((item) => {
            const container =
                item.closest(".featured-grid, .featured-items") || item;
            nodes.add(container);
        });
        return Array.from(nodes).filter(
            (node) =>
                node instanceof Element &&
                !node.closest(".bcampx-label-feed"),
        );
    }

    function collectArtistMusicReleaseCandidates() {
        const seen = new Set();
        const candidatesByKey = new Map();
        const candidates = [];
        const featuredItems = Array.from(
            document.querySelectorAll(
                ".featured-items .featured-item, .featured-grid .featured-item, .featured-item",
            ),
        );
        const excluded = [
            "#sidebar",
            "aside",
            '[role="complementary"]',
            ".sidebar",
            ".cart",
            "#cart",
            '[class*="cart"]',
            '[class*="Cart"]',
            ".checkout",
        ].join(",");
        const gridItems = Array.from(
            document.querySelectorAll(
                [
                    "#music-grid .music-grid-item",
                    ".music-grid .music-grid-item",
                    "[data-item-id^='album-']",
                    "[data-item-id^='track-']",
                ].join(", "),
            ),
        ).filter((item) => !item.closest(excluded));

        featuredItems.forEach((item) => {
            addArtistMusicReleaseCandidate(
                candidates,
                seen,
                item,
                null,
                "featured",
                candidatesByKey,
            );
        });

        gridItems.forEach((item) => {
            addArtistMusicReleaseCandidate(
                candidates,
                seen,
                item,
                null,
                "grid",
                candidatesByKey,
            );
        });


        return candidates;
    }

    function addArtistMusicReleaseCandidate(
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

    function createArtistMusicFeedCard(release) {
        const card = document.createElement("article");
        card.className = "feed-item story bcampx-label-feed-card";
        card.__bcampxArtistMusicRelease = release;
        card.setAttribute("data-bcampx-release-url", release.releaseUrl);
        if (release.bandId) {
            card.setAttribute("data-bcampx-band-id", release.bandId);
        }

        const itemJson = {
            item_id: release.itemId || undefined,
            item_type: release.itemType || undefined,
            item_url: release.releaseUrl,
            item_title: release.title || undefined,
        };

        const headline = document.createElement("div");
        headline.className = "story-title bcampx-label-feed-card__story-title";

        const artistLink = document.createElement("a");
        artistLink.className = "fan-name artist-name";
        artistLink.href = getArtistMusicPageUrl();
        artistLink.textContent = getArtistMusicBandName();

        const verb = document.createTextNode(" released ");
        const titleLink = createReleaseLink(release, "item-link");

        headline.append(artistLink, verb, titleLink);

        const innards = document.createElement("div");
        innards.className = "story-innards";

        const body = document.createElement("div");
        body.className = "story-body";
        body.setAttribute("data-item-json", JSON.stringify(itemJson));

        const wrapper = document.createElement("div");
        wrapper.className = "tralbum-wrapper";

        const art = document.createElement("div");
        art.className = "art";
        const artLink = document.createElement("a");
        artLink.href = release.releaseUrl;
        if (release.artUrl) {
            const image = document.createElement("img");
            image.src = release.artUrl;
            image.alt = release.title ? `${release.title} art` : "";
            artLink.appendChild(image);
        }
        art.appendChild(artLink);

        const content = document.createElement("div");
        content.className = "tralbum-wrapper-col1";
        content.appendChild(createReleaseLink(release, "item-link"));

        const byline = document.createElement("div");
        byline.className = "itemsubtext";
        byline.textContent = `by ${release.artist || getArtistMusicBandName()}`;
        content.appendChild(byline);

        const action = document.createElement("button");
        action.type = "button";
        action.className = "buy-link bcampx-label-feed-card__buy-button";
        action.textContent = "hear more";
        action.setAttribute("data-bcampx-release-action", "buy");
        action.setAttribute("data-bcampx-release-url", release.releaseUrl || "");
        action.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const actionText = cleanText(action.textContent || "");
            if (/^hear more$/i.test(actionText)) {
                const releaseUrl = action.getAttribute("data-bcampx-release-url") || "";
                if (releaseUrl) {
                    window.open(releaseUrl, "_blank", "noopener,noreferrer");
                }
                return;
            }
            const ownershipUrl = cleanText(
                action.getAttribute("data-bcampx-digital-ownership-url") || "",
            );
            if (ownershipUrl) {
                void navigateToOwnedReleaseCollection(
                    action.getAttribute("data-bcampx-release-title") ||
                        release.title ||
                        "",
                    ownershipUrl,
                    release.releaseUrl,
                );
                return;
            }
            executeTrackAction("basket", release.releaseUrl, action);
        });
        content.appendChild(action);

        const supportedSlot = document.createElement("div");
        supportedSlot.className = "tralbum-wrapper-col2 tralbum-owners";

        const supportedLabel = document.createElement("div");
        supportedLabel.className = "bcampx-label-feed-card__supported-placeholder";
        supportedLabel.textContent = "supported by";
        supportedSlot.appendChild(supportedLabel);

        wrapper.append(art, content, supportedSlot);
        body.appendChild(wrapper);
        innards.appendChild(body);
        card.append(headline, innards);

        return card;
    }

    function createReleaseLink(release, className) {
        const link = document.createElement("a");
        link.href = release.releaseUrl;
        if (className) {
            link.className = className;
        }
        link.textContent = release.title || release.releaseUrl;
        return link;
    }

    function updateArtistMusicCardBuyAction(card, data) {
        if (!card || !data) {
            return;
        }

        const action = card.querySelector("[data-bcampx-release-action='buy']");
        if (!action) {
            return;
        }

        const releaseUrl = card.getAttribute(
            "data-bcampx-release-url",
        );
        if (releaseUrl && !isOwnedDigitalPrice(data.digitalPrice)) {
            const nativeLink = document.querySelector(
                'a.you-own-this-link[href="' +
                    CSS.escape(releaseUrl) +
                    '"]',
            );
            if (nativeLink) {
                data.digitalPrice = "you own this";
            }
        }

        const isOwned = isOwnedDigitalPrice(data.digitalPrice);
        const ownershipUrl = cleanText(data.digitalOwnershipUrl || "");
        action.textContent = getDigitalBuyActionLabel(data.digitalPrice);
        action.disabled = isOwned && !ownershipUrl;
        action.classList.toggle("bcampx-label-feed-card__buy-button--owned", isOwned);
        action.title = isOwned
            ? ownershipUrl
                ? "Find this release in your collection"
                : "This release is already in your collection"
            : "";
        if (data.title) {
            action.setAttribute("data-bcampx-release-title", data.title);
        } else {
            action.removeAttribute("data-bcampx-release-title");
        }
        if (ownershipUrl) {
            action.setAttribute("data-bcampx-digital-ownership-url", ownershipUrl);
        } else {
            action.removeAttribute("data-bcampx-digital-ownership-url");
        }
        if (data.digitalPrice) {
            action.setAttribute("data-bcampx-digital-price", data.digitalPrice);
        } else {
            action.removeAttribute("data-bcampx-digital-price");
        }
    }


    function getCompactDigitalPrice(priceText) {
        const text = cleanText(priceText || "");
        if (!text) {
            return "";
        }

        const symbolicPrice = text.match(/(?:^|\s)([$€£¥]\s*\d+(?:[.,]\d+)?)/);
        if (symbolicPrice) {
            return symbolicPrice[1].replace(/\s+/g, "");
        }

        const codedPrice = text.match(
            /\b(?:USD|AUD|CAD|EUR|GBP|JPY|CNY|RMB|HKD|NZD)\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:USD|AUD|CAD|EUR|GBP|JPY|CNY|RMB|HKD|NZD)\b/i,
        );
        if (codedPrice) {
            return cleanText(codedPrice[0]);
        }

        return text.replace(/\s+or more$/i, "");
    }

   function getDigitalBuyActionLabel(priceText) {
       const compactPrice = getCompactDigitalPrice(priceText);
       if (isOwnedDigitalPrice(compactPrice)) {
           return "you own this";
        }
       if (/^free download$/i.test(compactPrice)) {
           return "free download";
        }

        return compactPrice ? `buy now (${compactPrice})` : "hear more";
   }

    function isOwnedDigitalPrice(priceText) {
        return /^you own this$/i.test(cleanText(priceText || ""));
    }

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
                ".artist-override, .artist, .item-artist, .collection-item-artist",
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
            (artistOverride ? normalizedText(artistOverride) : "") ||
            (artistNode ? normalizedText(artistNode) : "") ||
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
                "",
        );
    }

    function getArtistMusicBandName() {
        const bandData = parseJsonAttribute(
            document.querySelector("script[data-band]"),
            "data-band",
        );
        return (
            cleanText(bandData && bandData.name) ||
            metaContent(document, 'meta[property="og:site_name"]') ||
            metaContent(document, 'meta[property="og:title"]') ||
            cleanTitle(document.title) ||
            "This artist"
        );
    }

    function getArtistMusicPageUrl() {
        const bandData = parseJsonAttribute(
            document.querySelector("script[data-band]"),
            "data-band",
        );
        return (
            cleanText(
                (bandData && (bandData.https_url || bandData.url)) || "",
            ) || window.location.origin
        );
    }

    function getItemJsonReleaseUrl(node) {
        const parsed = getParsedItemJson(node);
        return normalizeReleaseUrl(parsed && parsed.item_url ? parsed.item_url : "");
    }

    function preferBandcampReleaseUrl(urls) {
        return (urls || []).find((url) => isBandcampReleaseUrl(url)) || "";
    }

    function extractParsedItemId(parsed) {
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

    function firstPositiveNumber(...values) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isFinite(number) && number > 0) {
                return number;
            }
        }

        return 0;
    }

    function normalizeReleaseItemType(rawType, releaseUrl = "") {
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
