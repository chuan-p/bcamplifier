    // Per-track wishlist/buy actions: the hidden helper frame, its authorized
    // postMessage bridge, the buy dialog helper and the request plumbing.
    // Extracted from the core bundle and injected into the same IIFE.

    function tryHandleEmbeddedTrackActionHelper() {
        const helperParams = parseTrackActionHelperParams(window.location.hash);
        if (!helperParams) {
            return false;
        }

        if (helperParams.action === "buy-dialog") {
            scheduleTrackActionHelperInit(runTrackBuyDialogHelper);
            return true;
        }

        if (!helperParams.requestId || !helperParams.parentOrigin) {
            return false;
        }

        scheduleTrackActionHelperInit(() => {
            void runTrackActionHelper(helperParams).catch(() => {});
        });
        return true;
    }

    function parseTrackActionHelperParams(hashValue) {
        const hash = cleanText(hashValue).replace(/^#/, "");
        if (!hash) {
            return null;
        }

        const params = new URLSearchParams(hash);
        const action = cleanText(params.get("bcampx-helper"));
        if (!action) {
            return null;
        }

        return {
            action,
            requestId: cleanText(params.get("bcampx-request")),
            parentOrigin: cleanText(params.get("bcampx-parent-origin")),
        };
    }

    function scheduleTrackActionHelperInit(callback) {
        window.setTimeout(() => {
            if (typeof callback === "function") {
                callback();
            }
        }, 250);
    }

    function getDocumentInsertionRoot() {
        return (
            document.body ||
            document.documentElement ||
            document.head ||
            null
        );
    }

    function appendToDocument(node) {
        const root = getDocumentInsertionRoot();
        if (!root || !node) {
            return false;
        }

        root.appendChild(node);
        return true;
    }

    function prependToContainer(container, node) {
        if (!container || !node) {
            return false;
        }

        if (typeof container.prepend === "function") {
            container.prepend(node);
            return true;
        }

        container.insertBefore(node, container.firstChild || null);
        return true;
    }

    function scheduleNextFrame(callback) {
        if (typeof callback !== "function") {
            return 0;
        }

        // Background tabs pause animation frames, so the pending work also
        // runs from a short timeout. The first path wins.
        let done = false;
        let timeoutId = 0;
        const run = () => {
            if (done) {
                return;
            }
            done = true;
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
            callback();
        };

        if (typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(run);
            timeoutId = window.setTimeout(run, 50);
            return timeoutId;
        }

        return window.setTimeout(run, 16);
    }

    function clearTrackActionHelperHash() {
        try {
            if (
                window.history &&
                typeof window.history.replaceState === "function"
            ) {
                window.history.replaceState(
                    null,
                    document.title,
                    window.location.pathname + window.location.search,
                );
            }
        } catch (_error) {}
    }

    async function runTrackBuyDialogHelper() {
        clearTrackActionHelperHash();

        // Helper page skips normal init, load settings manually
        await loadUserSettings();

        const getKnownPrice = () => {
            const buyItem = document.querySelector(
                ".buyItem.digital, .you-own-this.digital",
            );
            if (!buyItem) {
                return "";
            }

            const fullText = cleanText(buyItem.textContent || "");
            if (/name your price|free download|you own this/i.test(fullText)) {
                return "";
            }

            const basePrice = cleanText(
                buyItem.querySelector(".base-text-color")?.textContent || "",
            );
            if (!basePrice) {
                return "";
            }

            const match = basePrice.match(/(\d+(?:\.\d+)?)/);
            return match ? match[1] : "";
        };

        const openBuyDialog = () => {
            const buyButton = Array.from(
                document.querySelectorAll("button.download-link.buy-link"),
            ).find((node) =>
                /(?:buy|pre-order)\s+digital\s+(?:album|track)|free download/i.test(
                    (node.textContent || "").trim(),
                ),
            );
            if (!buyButton) {
                return "";
            }

            const buttonText = cleanText(buyButton.textContent || "");
            buyButton.click();
            return buttonText;
        };

        const focusPriceInput = () => {
            const priceInput = document.querySelector("#userPrice");
            if (!priceInput) {
                return false;
            }
            try {
               const knownPrice = CONFIG.autoFillMinimumPrice ? getKnownPrice() : "";
              if (knownPrice) {
                    priceInput.value = knownPrice;
                    priceInput.dispatchEvent(new Event("input", { bubbles: true }));
                    priceInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
            } catch (_error) {}

            try {
                priceInput.focus();
                if (typeof priceInput.select === "function") {
                    priceInput.select();
                }
            } catch (_error) {}

            return true;
        };

        let attempts = 0;
        const maxAttempts = 40;
        const tick = () => {
            attempts += 1;
            if (document.querySelector(".ui-dialog #userPrice")) {
                focusPriceInput();
                return;
            }

            if (document.querySelector(".ui-dialog")) {
                return;
            }

            const openedButtonText = openBuyDialog();
            if (/free download/i.test(openedButtonText)) {
                return;
            }
            if (attempts >= maxAttempts) {
                return;
            }
            window.setTimeout(tick, 250);
        };

        tick();
    }

    async function runTrackActionHelper({
        action,
        requestId,
        parentOrigin,
    }) {
        clearTrackActionHelperHash();
        const helperTarget =
            window.parent && window.parent !== window
                ? window.parent
                : window.opener && !window.opener.closed
                  ? window.opener
                  : null;
        const isTopLevelHelper = window.top === window;
        const declaredParentOrigin =
            normalizeTrackActionParentOrigin(parentOrigin);

        const send = (payload) => {
            if (!helperTarget || !declaredParentOrigin) {
                return;
            }

            try {
                helperTarget.postMessage(
                    Object.assign(
                        {
                            type: "bcampx-track-action-result",
                            action,
                            requestId,
                        },
                        payload || {},
                    ),
                    declaredParentOrigin,
                );
            } catch (_error) {}
        };

        const renderHelperStatus = (message, tone = "info") => {
            if (!isTopLevelHelper || !document.body) {
                return;
            }

            const existing = document.querySelector(".bcampx__helper-status");
            if (existing) {
                existing.remove();
            }

            const banner = document.createElement("div");
            banner.className = "bcampx__helper-status";
            banner.setAttribute("data-tone", tone);
            banner.textContent = message;
            banner.style.position = "sticky";
            banner.style.top = "0";
            banner.style.zIndex = "2147483647";
            banner.style.padding = "12px 16px";
            banner.style.font = "600 14px/1.4 system-ui, -apple-system, sans-serif";
            banner.style.color = tone === "error" ? "#7f1d1d" : "#0f5132";
            banner.style.background = tone === "error" ? "#fee2e2" : "#dcfce7";
            banner.style.borderBottom = `1px solid ${tone === "error" ? "#fecaca" : "#86efac"}`;
            prependToContainer(document.body || document.documentElement, banner);
        };

        const finishTopLevelHelper = (message, tone = "info") => {
            if (!isTopLevelHelper) {
                return;
            }

            renderHelperStatus(message, tone);
            if (window.opener && !window.opener.closed && tone !== "error") {
                window.setTimeout(() => {
                    try {
                        window.close();
                    } catch (_error) {}
                }, 900);
            }
        };

        // Account-state actions must be driven by the authenticated Bandcamp
        // page that registered the request. Without this check a crafted
        // release URL carrying helper hash parameters would let any page toggle
        // the visitor's wishlist with their cookies and read the result back.
        if (action === "wishlist" || action === "wishlist-state") {
            const authorized =
                Boolean(helperTarget) &&
                isAllowedTrackActionHelperParentOrigin(declaredParentOrigin) &&
                (await requestTrackActionHelperAuthorization(
                    helperTarget,
                    declaredParentOrigin,
                    requestId,
                ));
            if (!authorized) {
                markDebugState("data-bcampx-helper-auth", "rejected");
                send({
                    ok: false,
                    error: "Track action request could not be verified.",
                });
                finishTopLevelHelper(
                    "This track action could not be verified.",
                    "error",
                );
                return;
            }

            markDebugState("data-bcampx-helper-auth", "authorized");
        }

        const readJsonAttr = (selector, attr) => {
            const node = document.querySelector(selector);
            if (!node) {
                return null;
            }

            try {
                return JSON.parse(node.getAttribute(attr) || "null");
            } catch (_error) {
                return null;
            }
        };

        const collectInfo =
            readJsonAttr(
                "[data-tralbum-collect-info]",
                "data-tralbum-collect-info",
            ) || {};
        const tralbumData =
            readJsonAttr("[data-tralbum]", "data-tralbum") || {};
        const crumbs = readJsonAttr("#js-crumbs-data", "data-crumbs") || {};
        const pagedataBlob = (() => {
            try {
                return JSON.parse(
                    document.querySelector("#pagedata")?.dataset?.blob || "{}",
                );
            } catch (_error) {
                return {};
            }
        })();

        if (action === "wishlist-state") {
            const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
            const isWishlisted =
                !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
            const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
            const itemId =
                tralbumData.current?.id || collectInfo.collect_item_id || "";
            const bandId =
                tralbumData.current?.band_id ||
                collectInfo.collect_band_id ||
                "";
            send({
                ok: true,
                active: isWishlisted,
                canToggle: Boolean(fanId && itemId && bandId),
            });
            return;
        }

        if (action === "wishlist") {
            const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
            const isWishlisted =
                !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
            const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
            const crumbKey = isWishlisted
                ? "uncollect_item_cb"
                : "collect_item_cb";
            const crumb =
                typeof crumbs[crumbKey] === "string" ? crumbs[crumbKey] : "";
            if (!fanId) {
                send({
                    ok: false,
                    error: "Sign in to Bandcamp before using wishlist actions.",
                });
                return;
            }
            if (!crumb) {
                send({
                    ok: false,
                    error:
                        "This Bandcamp tab looks out of date. Refresh the release page and try again.",
                });
                return;
            }

            const endpoint = isWishlisted
                ? "/uncollect_item_cb"
                : "/collect_item_cb";
            const payload = new URLSearchParams();
            payload.set("fan_id", String(fanId));
            payload.set(
                "item_id",
                String(
                    tralbumData.current?.id || collectInfo.collect_item_id || "",
                ),
            );
            payload.set(
                "item_type",
                String(
                    (
                        tralbumData.current?.type ||
                        collectInfo.collect_item_type ||
                        "track"
                    )
                        .replace(/^t$/i, "track")
                        .replace(/^a$/i, "album")
                        .replace(/^b$/i, "bundle"),
                ),
            );
            payload.set(
                "band_id",
                String(
                    tralbumData.current?.band_id ||
                        collectInfo.collect_band_id ||
                        "",
                ),
            );
            payload.set("crumb", crumb);

            const onSuccess = (body) => {
                if (!body || body.ok !== true) {
                    throw new Error(
                        body && body.error_message
                            ? body.error_message
                            : "Wishlist request failed.",
                    );
                }

                send({
                    ok: true,
                    active: !isWishlisted,
                    statusText: !isWishlisted ? "Saved" : "Removed",
                });
                finishTopLevelHelper(
                    !isWishlisted
                        ? "Saved to your Bandcamp wishlist."
                        : "Removed from your Bandcamp wishlist.",
                );
            };

            fetch(location.origin + endpoint, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: payload.toString(),
            })
                .then(async (response) => {
                    let body = null;
                    try {
                        body = await response.json();
                    } catch (_error) {
                        body = null;
                    }

                    if (!response.ok) {
                        throw new Error(
                            (body && body.error_message) ||
                                "Wishlist request failed.",
                        );
                    }

                    onSuccess(body);
                })
                .catch((error) => {
                    send({
                        ok: false,
                        error:
                            error && error.message
                                ? error.message
                                : "Wishlist request failed.",
                    });
                    finishTopLevelHelper(
                        error && error.message
                            ? error.message
                            : "Wishlist request failed.",
                        "error",
                    );
                });
            return;
        }

        if (action !== "basket") {
            send({ ok: false, error: "Unknown track action." });
            return;
        }

        send({ ok: false, error: "Basket helper is disabled." });
    }

    function getExternalHostApi() {
        const host = globalThis.__BCAMPX_HOST__;
        if (!host || typeof host !== "object") {
            return null;
        }

        return host;
    }

    function canUseExternalHostMethod(methodName) {
        const host = getExternalHostApi();
        return !!(host && typeof host[methodName] === "function");
    }

    function isWebExtensionHost() {
        const host = getExternalHostApi();
        return !!(host && host.kind === "webextension");
    }

    function isCustomDomainReleaseUrl(rawUrl) {
        const releaseUrl = normalizeReleaseUrl(rawUrl || "");
        return !!(releaseUrl && !isBandcampReleaseUrl(releaseUrl));
    }

    // Custom-domain pages only received the extension core through a content
    // script registered at runtime, and this build no longer registers one.
    // The hidden helper frame therefore cannot answer there, so wishlist
    // actions stay unavailable in the extension. The userscript still matches
    // every domain through @match and keeps working.
    function canRunTrackActionHelper(rawUrl) {
        const trackUrl = normalizeReleaseUrl(rawUrl || "");
        return Boolean(
            trackUrl &&
                !(isWebExtensionHost() && isCustomDomainReleaseUrl(trackUrl)),
        );
    }

    function hasExtensionHostPermission(rawUrl) {
        const releaseUrl = normalizeReleaseUrl(rawUrl || "");
        if (!releaseUrl || !isWebExtensionHost()) {
            return false;
        }

        const host = getExternalHostApi();
        return !!(
            host &&
            typeof host.hasHostPermission === "function" &&
            host.hasHostPermission(releaseUrl)
        );
    }

    function getHostRequestOptions(baseOptions = {}) {
        return {
            method: baseOptions.method || "GET",
            data: baseOptions.data,
            headers: baseOptions.headers,
            credentials: baseOptions.credentials,
            timeoutMs: CONFIG.fetchTimeoutMs,
        };
    }

    function setupTrackActionMessageBridge() {
        if (STATE.trackActionBridgeInitialized) {
            return;
        }

        STATE.trackActionBridgeInitialized = true;
        window.addEventListener("message", handleTrackActionMessage);
    }

    function handleTrackActionMessage(event) {
        const data = event && event.data;
        if (!data || !data.type) {
            return;
        }

        if (data.type === "bcampx-track-action-challenge") {
            handleTrackActionChallenge(event, data);
            return;
        }

        if (data.type !== "bcampx-track-action-result") {
            return;
        }

        const pending = STATE.pendingTrackActionRequests.get(data.requestId);
        if (!pending) {
            return;
        }

        if (event.origin && pending.origin && event.origin !== pending.origin) {
            recordTrackActionDiagnostic("message-origin-mismatch", {
                action: pending.action,
                expectedOrigin: pending.origin,
                actualOrigin: event.origin,
            });
            return;
        }

        if (data.ok) {
            completeTrackActionRequest(pending, data.requestId, data);
            return;
        }

        recordTrackActionDiagnostic("action-failed", {
            action: pending.action,
            origin: pending.origin,
            error: data.error || "Track action failed.",
        });
        failTrackActionRequest(
            pending,
            data.requestId,
            new Error(data.error || "Track action failed."),
        );
    }

    function handleTrackActionChallenge(event, data) {
        const requestId = cleanText(data && data.requestId);
        const nonce = cleanText(data && data.nonce);
        if (!requestId || !nonce || !event.source) {
            return;
        }

        const pending = STATE.pendingTrackActionRequests.get(requestId);
        if (!pending || !pending.origin || event.origin !== pending.origin) {
            return;
        }

        try {
            event.source.postMessage(
                {
                    type: "bcampx-track-action-ack",
                    requestId,
                    nonce,
                    ok: true,
                },
                event.origin,
            );
        } catch (_error) {}
    }

    function normalizeTrackActionParentOrigin(rawOrigin) {
        const value = cleanText(rawOrigin);
        if (!value) {
            return "";
        }

        try {
            const parsed = new URL(value);
            return parsed.protocol === "https:" ? parsed.origin : "";
        } catch (_error) {
            return "";
        }
    }

    function isAllowedTrackActionHelperParentOrigin(origin) {
        if (!origin) {
            return false;
        }

        if (origin === window.location.origin) {
            return true;
        }

        try {
            const hostname = new URL(origin).hostname.toLowerCase();
            return (
                hostname === "bandcamp.com" ||
                hostname.endsWith(".bandcamp.com")
            );
        } catch (_error) {
            return false;
        }
    }

    function requestTrackActionHelperAuthorization(target, origin, requestId) {
        return new Promise((resolve) => {
            const nonce = createTrackActionRequestId();
            let settled = false;

            const finish = (authorized) => {
                if (settled) {
                    return;
                }

                settled = true;
                window.removeEventListener("message", onMessage);
                window.clearTimeout(timer);
                resolve(authorized);
            };

            const onMessage = (event) => {
                if (
                    settled ||
                    event.source !== target ||
                    event.origin !== origin
                ) {
                    return;
                }

                const data = event.data;
                if (!data || data.type !== "bcampx-track-action-ack") {
                    return;
                }

                if (
                    data.requestId !== requestId ||
                    data.nonce !== nonce ||
                    data.ok !== true
                ) {
                    return;
                }

                finish(true);
            };

            const timer = window.setTimeout(
                () => finish(false),
                TRACK_ACTION_AUTH_TIMEOUT_MS,
            );

            window.addEventListener("message", onMessage);

            try {
                target.postMessage(
                    {
                        type: "bcampx-track-action-challenge",
                        requestId,
                        nonce,
                    },
                    origin,
                );
            } catch (_error) {
                finish(false);
            }
        });
    }

    function finalizePendingTrackActionRequest(requestId) {
        const pending = STATE.pendingTrackActionRequests.get(requestId);
        if (!pending) {
            return null;
        }

        STATE.pendingTrackActionRequests.delete(requestId);
        window.clearTimeout(pending.timeoutId);
        if (pending.iframe && pending.iframe.parentNode) {
            pending.iframe.remove();
        }
        return pending;
    }

    function recordTrackActionDiagnostic(code, details = {}) {
        STATE.lastTrackActionDiagnostic = {
            code,
            details,
            at: Date.now(),
        };
    }

    function completeTrackActionRequest(pending, requestId, result) {
        finalizePendingTrackActionRequest(requestId);
        if (pending.action === "wishlist-state") {
            pending.resolve(result);
            return;
        }

        if (pending.button && pending.button.classList.contains("bcampx-player-favorite")) {
            const active =
                result && Object.prototype.hasOwnProperty.call(result, "active")
                    ? Boolean(result.active)
                    : Boolean(pending.desiredActive);
            const releaseUrl = normalizeReleaseUrl(pending.trackUrl || "");
            if (releaseUrl) {
                STATE.playerWishlistStateByUrl.set(releaseUrl, {
                    status: "known",
                    active,
                    canToggle: true,
                    checkedAt: Date.now(),
                });
                STATE.playerWishlistActionRequests.delete(releaseUrl);
                clearPlayerWishlistStateRetry(releaseUrl);
            }
            if (
                releaseUrl &&
                releaseUrl === normalizeReleaseUrl(STATE.activeReleaseUrl || "")
            ) {
                setFavoriteButtonState(pending.button, active);
            }
            syncFavoriteButtonState();
        } else {
            setTrackActionButtonPending(pending.button, false);
            flashTrackActionButton(
                pending.button,
                result && result.statusText ? result.statusText : "Done",
            );
        }
        pending.resolve(result);
    }

    function failTrackActionRequest(pending, requestId, error, flashLabel = "Error") {
        finalizePendingTrackActionRequest(requestId);
        if (pending.action !== "wishlist-state") {
            if (
                pending.button &&
                pending.button.classList.contains("bcampx-player-favorite")
            ) {
                STATE.playerWishlistActionRequests.delete(
                    normalizeReleaseUrl(pending.trackUrl || ""),
                );
                syncFavoriteButtonState();
                pending.reject(error);
                return;
            }
            setTrackActionButtonPending(pending.button, false);
            flashTrackActionButton(pending.button, flashLabel);
        }
        pending.reject(error);
    }


    function createTrackActionButtons(trackActionUrl) {
        const actions = createClassedElement("div", "bcampx__track-actions");

        actions.append(
            createTrackActionButton(
                "buy",
                "Add this track to basket",
                (event, button) => {
                    event.preventDefault();
                    event.stopPropagation();
                    executeTrackAction("basket", trackActionUrl, button);
                },
            ),
        );

        // Do not offer a wishlist control that could only time out: the
        // extension cannot run the helper frame on custom domains.
        if (canRunTrackActionHelper(trackActionUrl)) {
            actions.append(
                createTrackActionButton(
                    "wish",
                    "Add or remove this track from wishlist",
                    (event, button) => {
                        event.preventDefault();
                        event.stopPropagation();
                        executeTrackAction("wishlist", trackActionUrl, button);
                    },
                ),
            );
        }

        return actions;
    }

    function createTrackActionButton(label, title, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bcampx__track-action";
        button.textContent = label;
        button.title = title;
        button.addEventListener("click", (event) => onClick(event, button));
        return button;
    }

    function refreshRenderedTrackActionButtons() {
        document.querySelectorAll(".bcampx__track-end").forEach((end) => {
            const trackActionUrl =
                end instanceof HTMLElement
                    ? cleanText(end.dataset.trackActionUrl || "")
                    : "";
            const existingActions = end.querySelector(".bcampx__track-actions");

            if (!CONFIG.enableTrackRowActions) {
                if (existingActions) {
                    existingActions.remove();
                }
                end.classList.remove("bcampx__track-end--has-actions");
                return;
            }

            if (!trackActionUrl) {
                end.classList.remove("bcampx__track-end--has-actions");
                return;
            }

            if (existingActions) {
                end.classList.add("bcampx__track-end--has-actions");
                return;
            }

            end.append(createTrackActionButtons(trackActionUrl));
            end.classList.add("bcampx__track-end--has-actions");
        });
    }


    function resolveTrackActionUrl(track, releaseUrl) {
        const titleLink = cleanText(track && track.titleLink);
        if (titleLink) {
            try {
                return new URL(titleLink, releaseUrl).href;
            } catch (_error) {
                return "";
            }
        }

        return /\/track\//.test(releaseUrl) ? releaseUrl : "";
    }

    async function executeTrackAction(action, trackUrl, button) {
        if (!trackUrl || !button) {
            return;
        }

        setTrackActionButtonPending(button, true);
        try {
            if (action === "wishlist") {
                await requestTrackActionViaHelper(action, trackUrl, button);
                return;
            }

            if (action === "basket") {
                const opened = openTrackBuyWindow(trackUrl);
                setTrackActionButtonPending(button, false);
                flashTrackActionButton(button, opened ? "Opened" : "Blocked");
                return;
            }

            throw new Error("Track action is disabled.");
        } catch (_error) {
            setTrackActionButtonPending(button, false);
            flashTrackActionButton(button, "Error");
        }
    }

    function requestTrackActionViaHelper(action, trackUrl, button, options = {}) {
        // Fail fast instead of waiting through the iframe and window timeouts
        // for a helper frame that can never answer on a custom domain.
        if (!canRunTrackActionHelper(trackUrl)) {
            return Promise.reject(
                new Error(
                    "Wishlist actions are unavailable on Bandcamp custom domains.",
                ),
            );
        }

        setupTrackActionMessageBridge();

        return new Promise((resolve, reject) => {
            const request = createTrackActionRequestContext({
                action,
                trackUrl,
                button,
                desiredActive: options.desiredActive,
                resolve,
                reject,
            });
            if (!request) {
                reject(new Error("Invalid track URL."));
                return;
            }

            request.timeoutId = scheduleTrackActionTimeout(request);
            attachTrackActionIframeErrorHandler(request.iframe, request);
            registerPendingTrackActionRequest(request);
            request.iframe.src = request.helperUrl;
            appendToDocument(request.iframe);
        });
    }

    function openTrackBuyWindow(trackUrl) {
        const helperUrl = buildTrackActionHelperUrl(trackUrl, "buy-dialog");
        const openedWindow = openTrackActionWindow(helperUrl);
        return Boolean(openedWindow && !openedWindow.closed);
    }

    function openTrackActionWindow(helperUrl) {
        const openedWindow = window.open(helperUrl, "_blank");
        if (openedWindow && !openedWindow.closed) {
            try {
                openedWindow.opener = null;
            } catch (_error) {}
        }
        return openedWindow;
    }

    function getTrackActionOrigin(trackUrl) {
        try {
            return new URL(trackUrl).origin;
        } catch (_error) {
            return "";
        }
    }

    function createTrackActionRequestId() {
        return `bcampx-track-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function createTrackActionIframe() {
        const iframe = document.createElement("iframe");
        iframe.className = "bcampx__track-action-frame";
        iframe.setAttribute("aria-hidden", "true");
        return iframe;
    }

    function createTrackActionRequestContext({
        action,
        trackUrl,
        button,
        desiredActive,
        resolve,
        reject,
    }) {
        const origin = getTrackActionOrigin(trackUrl);
        if (!origin) {
            return null;
        }

        const requestId = createTrackActionRequestId();
        const iframe = createTrackActionIframe();
        return {
            requestId,
            action,
            button,
            iframe,
            origin,
            trackUrl,
            desiredActive,
            helperUrl: buildTrackActionHelperUrl(trackUrl, action, requestId),
            timeoutId: 0,
            fallbackAttempted: false,
            resolve,
            reject,
        };
    }

    function buildTrackActionHelperUrl(
        trackUrl,
        action,
        requestId = "",
        parentOrigin = window.location.origin,
    ) {
        try {
            const url = new URL(trackUrl);
            const hash = new URLSearchParams({
                "bcampx-helper": action,
                ...(requestId ? { "bcampx-request": requestId } : {}),
                ...(requestId ? { "bcampx-parent-origin": parentOrigin } : {}),
            }).toString();
            url.hash = hash;
            return url.href;
        } catch (_error) {
            return trackUrl;
        }
    }

    function scheduleTrackActionTimeout(pending, timeoutMs = 12000) {
        return window.setTimeout(() => {
            const activePending = STATE.pendingTrackActionRequests.get(
                pending.requestId,
            );
            if (!activePending) {
                return;
            }

            if (attemptTrackActionWindowFallback(activePending, "timeout")) {
                return;
            }

            recordTrackActionDiagnostic("action-timeout", {
                action: activePending.action,
                trackUrl: activePending.trackUrl,
                origin: activePending.origin,
            });
            failTrackActionRequest(
                activePending,
                activePending.requestId,
                new Error(`${activePending.action} request timed out.`),
            );
        }, timeoutMs);
    }

    function attemptTrackActionWindowFallback(pending, reason) {
        if (
            !pending ||
            pending.action !== "wishlist" ||
            pending.fallbackAttempted
        ) {
            return false;
        }

        const attemptedOpen = openTrackActionHelperWindow(pending.helperUrl);
        if (!attemptedOpen) {
            return false;
        }

        pending.fallbackAttempted = true;
        window.clearTimeout(pending.timeoutId);
        pending.timeoutId = scheduleTrackActionTimeout(pending, 15000);
        if (pending.iframe && pending.iframe.parentNode) {
            pending.iframe.remove();
        }
        recordTrackActionDiagnostic("window-fallback-opened", {
            action: pending.action,
            trackUrl: pending.trackUrl,
            origin: pending.origin,
            reason,
        });
        return true;
    }

    function attachTrackActionIframeErrorHandler(
        iframe,
        pending,
    ) {
        iframe.addEventListener(
            "error",
            () => {
                const activePending = STATE.pendingTrackActionRequests.get(
                    pending.requestId,
                );
                if (!activePending) {
                    return;
                }
                recordTrackActionDiagnostic("iframe-load-error", {
                    action: pending.action,
                    trackUrl: pending.trackUrl,
                    origin: pending.origin,
                });
                if (attemptTrackActionWindowFallback(activePending, "iframe-load-error")) {
                    return;
                }
                failTrackActionRequest(
                    activePending,
                    activePending.requestId,
                    new Error(`${pending.action} helper could not load.`),
                );
            },
            { once: true },
        );
    }

    function openTrackActionHelperWindow(helperUrl) {
        const openedWindow = window.open(helperUrl, "_blank");
        if (openedWindow && !openedWindow.closed) {
            return true;
        }

        const link = document.createElement("a");
        link.href = helperUrl;
        link.target = "_blank";
        link.style.display = "none";
        appendToDocument(link);
        link.click();
        link.remove();
        return true;
    }

    function registerPendingTrackActionRequest(pending) {
        STATE.pendingTrackActionRequests.set(pending.requestId, pending);
    }

    function setTrackActionButtonPending(button, pending) {
        if (!button) {
            return;
        }

        if (button.classList.contains("bcampx-player-favorite")) {
            button.disabled = pending;
            button.classList.toggle("bcampx-player-button--pending", pending);
            return;
        }

        button.disabled = pending;
        button.classList.toggle("bcampx__track-action--pending", pending);
        button.dataset.bcampxOriginalLabel =
            button.dataset.bcampxOriginalLabel || button.textContent;
        if (pending) {
            button.textContent = "...";
            const item = button.closest("li");
            if (item) {
                item.classList.add("bcampx__track-item--show-actions");
            }
            return;
        }

        button.textContent =
            button.dataset.bcampxOriginalLabel || button.textContent;
    }

    function flashTrackActionButton(button, label) {
        if (!button) {
            return;
        }

        const original =
            button.dataset.bcampxOriginalLabel || button.textContent;
        button.textContent = label;
        button.classList.add("bcampx__track-action--flash");
        window.setTimeout(() => {
            button.textContent = original;
            button.classList.remove("bcampx__track-action--flash");
            const item = button.closest("li");
            if (item && !item.matches(":hover")) {
                item.classList.remove("bcampx__track-item--show-actions");
            }
        }, 1400);
    }

