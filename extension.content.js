"use strict";

(() => {
    const runtimeApi = getExtensionApi();
    const grantedHostOrigins = new Set();
    const pendingHostPermissionRequests = new Map();
    const pendingHostPermissionOrigins = new Map();
    const HOST_PERMISSION_REQUEST_TIMEOUT_MS = 120000;

    if (!runtimeApi) {
        return;
    }

    if (globalThis.__BCAMPX_HOST__) {
        return;
    }

    setupRuntimeMessageBridge();
    refreshGrantedHostPermissions();

    globalThis.__BCAMPX_HOST__ = {
        kind: "webextension",
        requestHtml: (url, options = {}) => requestText(url, options),
        requestJson: (url, options = {}) => requestJson(url, options),
        requestHostPermission,
        hasHostPermission,
        storageGet,
        storageSet,
    };
    if (document.documentElement) {
        document.documentElement.setAttribute("data-bcampx-host", "webextension");
    }

    function requestText(url, options = {}) {
        return sendRuntimeMessage({
            type: "bcampx:fetch",
            url,
            method: options.method || "GET",
            headers: options.headers,
            body: options.data,
            credentials: options.credentials,
            timeoutMs: options.timeoutMs,
        }).then((payload) => {
            const response = getSuccessfulFetchResponse(payload);
            return response.responseText || "";
        });
    }

    function requestJson(url, options = {}) {
        return sendRuntimeMessage({
            type: "bcampx:fetch",
            url,
            method: options.method || "GET",
            headers: options.headers,
            body: options.data,
            credentials: options.credentials,
            timeoutMs: options.timeoutMs,
        }).then((payload) => {
            const response = getSuccessfulFetchResponse(payload);

            try {
                return JSON.parse(response.responseText || "null");
            } catch (_error) {
                throw new Error("Invalid JSON response.");
            }
        });
    }

    function requestHostPermission(url) {
        const originPattern = normalizeCustomHostPermissionPattern(url);
        if (!originPattern) {
            return Promise.reject(
                normalizeExtensionError(
                    new Error("Only HTTPS Bandcamp custom domains can be requested."),
                ),
            );
        }

        if (grantedHostOrigins.has(originPattern)) {
            return Promise.resolve({
                granted: true,
                alreadyGranted: true,
                originPattern,
            });
        }

        const existing = pendingHostPermissionOrigins.get(originPattern);
        if (existing && existing.promise) {
            return existing.promise;
        }

        const requestId = createRequestId();
        const pending = createPendingHostPermissionRequest(requestId, originPattern);
        pendingHostPermissionOrigins.set(originPattern, pending);

        sendRuntimeMessage({
            type: "bcampx:start-host-permission-request",
            requestId,
            url,
            originPattern,
        })
            .then((payload) => {
                const result = getSuccessfulPayload(
                    payload,
                    "Could not open the host permission request.",
                    "result",
                );
                if (result && result.granted) {
                    if (result.originPattern) {
                        grantedHostOrigins.add(result.originPattern);
                    }
                    resolvePendingHostPermissionRequest(requestId, {
                        granted: true,
                        alreadyGranted: Boolean(result.alreadyGranted),
                        originPattern: result.originPattern || originPattern,
                    });
                    return;
                }

                if (result && result.opened) {
                    return;
                }

                resolvePendingHostPermissionRequest(requestId, {
                    granted: false,
                    alreadyGranted: false,
                    originPattern,
                });
            })
            .catch((error) => {
                rejectPendingHostPermissionRequest(
                    requestId,
                    normalizeExtensionError(error),
                );
            });

        return pending.promise;
    }

    function hasHostPermission(url) {
        const originPattern = normalizeCustomHostPermissionPattern(url);
        return Boolean(originPattern && grantedHostOrigins.has(originPattern));
    }

    function setupRuntimeMessageBridge() {
        if (
            !runtimeApi.runtime ||
            !runtimeApi.runtime.onMessage ||
            typeof runtimeApi.runtime.onMessage.addListener !== "function"
        ) {
            return;
        }

        runtimeApi.runtime.onMessage.addListener((message) => {
            if (!message || message.type !== "bcampx:host-permission-result") {
                return undefined;
            }

            handleHostPermissionResultMessage(message);
            return undefined;
        });
    }

    function handleHostPermissionResultMessage(message) {
        const requestId = String(message.requestId || "").trim();
        if (!requestId) {
            return;
        }

        const originPattern = normalizeCustomHostPermissionPattern(
            message.originPattern || "",
        );
        if (message.granted && originPattern) {
            grantedHostOrigins.add(originPattern);
        }

        if (!pendingHostPermissionRequests.has(requestId)) {
            return;
        }

        resolvePendingHostPermissionRequest(requestId, {
            granted: Boolean(message.granted),
            alreadyGranted: Boolean(message.alreadyGranted),
            originPattern,
            error: message.error ? String(message.error) : "",
        });
    }

    function createPendingHostPermissionRequest(requestId, originPattern) {
        const pending = {
            requestId,
            originPattern,
            timeoutId: 0,
            resolve: null,
            reject: null,
            promise: null,
        };

        pending.promise = new Promise((resolve, reject) => {
            pending.resolve = resolve;
            pending.reject = reject;
            pending.timeoutId = window.setTimeout(() => {
                rejectPendingHostPermissionRequest(
                    requestId,
                    new Error(
                        "Permission request timed out. Retry and approve access in the tab that opens.",
                    ),
                );
            }, HOST_PERMISSION_REQUEST_TIMEOUT_MS);
        });

        pendingHostPermissionRequests.set(requestId, pending);
        return pending;
    }

    function resolvePendingHostPermissionRequest(requestId, result) {
        const pending = clearPendingHostPermissionRequest(requestId);
        if (!pending) {
            return;
        }

        pending.resolve(result);
    }

    function rejectPendingHostPermissionRequest(requestId, error) {
        const pending = clearPendingHostPermissionRequest(requestId);
        if (!pending) {
            return;
        }

        pending.reject(error);
    }

    function clearPendingHostPermissionRequest(requestId) {
        const pending = pendingHostPermissionRequests.get(requestId);
        if (!pending) {
            return null;
        }

        pendingHostPermissionRequests.delete(requestId);
        if (pending.timeoutId) {
            window.clearTimeout(pending.timeoutId);
        }

        const byOrigin = pendingHostPermissionOrigins.get(pending.originPattern);
        if (byOrigin === pending) {
            pendingHostPermissionOrigins.delete(pending.originPattern);
        }

        return pending;
    }

    function refreshGrantedHostPermissions() {
        sendRuntimeMessage({ type: "bcampx:get-host-permissions" })
            .then((payload) => {
                const origins = getSuccessfulPayload(
                    payload,
                    "Host permission lookup failed.",
                    "origins",
                );
                grantedHostOrigins.clear();
                (origins || []).forEach((originPattern) => {
                    const normalized =
                        normalizeCustomHostPermissionPattern(originPattern);
                    if (normalized) {
                        grantedHostOrigins.add(normalized);
                    }
                });
            })
            .catch(() => {});
    }

    function getSuccessfulFetchResponse(payload) {
        const response = getSuccessfulPayload(
            payload,
            "Network request failed.",
            "response",
        );

        if (!response) {
            throw normalizeExtensionError(new Error("Network request failed."));
        }

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response;
    }

    function getSuccessfulPayload(payload, fallbackMessage, resultKey) {
        if (!payload || payload.ok !== true) {
            throw normalizeExtensionError(
                new Error(
                    payload && payload.error ? payload.error : fallbackMessage,
                ),
            );
        }

        if (!resultKey) {
            return payload;
        }

        return payload[resultKey];
    }

    function storageGet(key, fallback) {
        return callStorageMethod("get", [key]).then((items) => {
            if (!items || !(key in items)) {
                return fallback;
            }

            return items[key];
        });
    }

    function storageSet(key, value) {
        return callStorageMethod("set", { [key]: value }).then(() => {});
    }

    function sendRuntimeMessage(message) {
        if (typeof runtimeApi.runtime.sendMessage !== "function") {
            return Promise.reject(
                normalizeExtensionError(
                    new Error("Extension runtime messaging is unavailable."),
                ),
            );
        }

        if (runtimeApi.kind === "browser") {
            return Promise.resolve(runtimeApi.runtime.sendMessage(message)).catch(
                (error) => {
                    throw normalizeExtensionError(error);
                },
            );
        }

        return new Promise((resolve, reject) => {
            runtimeApi.runtime.sendMessage(message, (response) => {
                const error =
                    runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (error) {
                    reject(normalizeExtensionError(error));
                    return;
                }

                resolve(response);
            });
        });
    }

    function callStorageMethod(methodName, payload) {
        const storage = runtimeApi.storage && runtimeApi.storage.local;
        if (!storage || typeof storage[methodName] !== "function") {
            return Promise.reject(
                normalizeExtensionError(
                    new Error(`storage.local.${methodName} is unavailable.`),
                ),
            );
        }

        if (runtimeApi.kind === "browser") {
            return Promise.resolve(storage[methodName](payload)).catch((error) => {
                throw normalizeExtensionError(error);
            });
        }

        return new Promise((resolve, reject) => {
            storage[methodName](payload, (result) => {
                const error =
                    runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (error) {
                    reject(normalizeExtensionError(error));
                    return;
                }

                resolve(result);
            });
        });
    }

    function createRequestId() {
        return `bcampx-host-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
    }

    function normalizeCustomHostPermissionPattern(rawUrl) {
        if (typeof rawUrl !== "string" || !rawUrl) {
            return "";
        }

        let parsed;
        try {
            parsed = new URL(rawUrl);
        } catch (_error) {
            return "";
        }

        if (parsed.protocol !== "https:") {
            return "";
        }

        if (!parsed.hostname || isBandcampHostname(parsed.hostname)) {
            return "";
        }

        return `${parsed.origin}/*`;
    }

    function isBandcampHostname(rawHostname) {
        const hostname = String(rawHostname || "").trim().toLowerCase();
        return (
            hostname === "bandcamp.com" || hostname.endsWith(".bandcamp.com")
        );
    }

    function normalizeExtensionError(error) {
        const message =
            error && error.message ? String(error.message) : String(error || "");

        if (
            /Extension context invalidated/i.test(message) ||
            /Receiving end does not exist/i.test(message) ||
            /Could not establish connection/i.test(message) ||
            /message port closed/i.test(message)
        ) {
            return new Error(
                "Extension was updated or reloaded. Refresh this Bandcamp tab and try again.",
            );
        }

        if (/storage\.local\./i.test(message)) {
            return new Error(
                "Extension storage is unavailable. Refresh the tab or restart the browser and try again.",
            );
        }

        return error instanceof Error ? error : new Error(message || "Extension error.");
    }

    function getExtensionApi() {
        if (
            globalThis.browser &&
            globalThis.browser.runtime &&
            globalThis.browser.storage
        ) {
            return { kind: "browser", ...globalThis.browser };
        }

        if (
            globalThis.chrome &&
            globalThis.chrome.runtime &&
            globalThis.chrome.storage
        ) {
            return { kind: "chrome", ...globalThis.chrome };
        }

        return null;
    }
})();
