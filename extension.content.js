"use strict";

(() => {
    const {
        normalizeCustomHostPermissionPattern,
        getExtensionApi,
        callExtensionApi,
    } = globalThis.__BCAMPX_EXT_SHARED__;
    const runtimeApi = getExtensionApi();
    const grantedHostOrigins = new Set();
    const pendingHostPermissionRequests = new Map();
    const pendingHostPermissionOrigins = new Map();
    const storageKeySubscribers = new Map();
    const HOST_PERMISSION_REQUEST_TIMEOUT_MS = 120000;

    if (!runtimeApi || !runtimeApi.storage) {
        return;
    }

    if (globalThis.__BCAMPX_HOST__) {
        return;
    }

    setupRuntimeMessageBridge();
    setupStorageChangeBridge();
    refreshGrantedHostPermissions();

    globalThis.__BCAMPX_HOST__ = {
        kind: "webextension",
        requestHtml: (url, options = {}) => requestText(url, options),
        requestJson: (url, options = {}) => requestJson(url, options),
        requestHostPermission,
        hasHostPermission,
        storageGet,
        storageSet,
        storageGetByPrefix,
        storageRemove,
        subscribeStorageKey,
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
        return requestText(url, options).then((text) => {
            try {
                return JSON.parse(text || "null");
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
            return null;
        });
    }

    function setupStorageChangeBridge() {
        const storage = runtimeApi.storage;
        if (
            !storage ||
            !storage.onChanged ||
            typeof storage.onChanged.addListener !== "function"
        ) {
            return;
        }

        storage.onChanged.addListener((changes, areaName) => {
            if (areaName && areaName !== "local") {
                return;
            }

            Object.entries(changes || {}).forEach(([key, change]) => {
                const subscribers = storageKeySubscribers.get(key);
                if (!subscribers || !subscribers.size) {
                    return;
                }

                subscribers.forEach((callback) => {
                    try {
                        callback(change ? change.newValue : undefined);
                    } catch (_error) {}
                });
            });
        });
    }

    function subscribeStorageKey(key, callback) {
        const normalizedKey = String(key || "").trim();
        if (!normalizedKey || typeof callback !== "function") {
            return () => {};
        }

        let subscribers = storageKeySubscribers.get(normalizedKey);
        if (!subscribers) {
            subscribers = new Set();
            storageKeySubscribers.set(normalizedKey, subscribers);
        }

        subscribers.add(callback);
        return () => {
            subscribers.delete(callback);
            if (!subscribers.size) {
                storageKeySubscribers.delete(normalizedKey);
            }
        };
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
            if (!items || typeof items !== "object" || !(key in items)) {
                return fallback;
            }

            return items[key];
        });
    }

    function storageSet(key, value) {
        return callStorageMethod("set", { [key]: value }).then(() => {});
    }

    function storageGetByPrefix(prefix) {
        // Filter in the background so the page only receives the matching
        // records; a direct storage.get(null) would clone the whole local
        // storage (including the release cache) into the content script.
        return sendRuntimeMessage({
            type: "bcampx:storage-get-by-prefix",
            prefix,
        })
            .then((payload) => {
                if (!payload || payload.ok !== true) {
                    throw new Error(
                        (payload && payload.error) || "Storage read failed.",
                    );
                }
                return payload.values || {};
            })
            .catch(() =>
                callStorageMethod("get", null).then((items) => {
                    const values = {};
                    Object.keys(items || {}).forEach((key) => {
                        if (key.startsWith(prefix)) {
                            values[key] = items[key];
                        }
                    });
                    return values;
                }),
            );
    }

    function storageRemove(key) {
        return callStorageMethod("remove", key).then(() => {});
    }

    function sendRuntimeMessage(message) {
        return callExtensionApi(
            runtimeApi,
            runtimeApi && runtimeApi.runtime,
            "sendMessage",
            [message],
            {
                unavailableMessage: "Extension runtime messaging is unavailable.",
                transformError: normalizeExtensionError,
            },
        );
    }

    function callStorageMethod(methodName, payload) {
        return callExtensionApi(
            runtimeApi,
            runtimeApi && runtimeApi.storage && runtimeApi.storage.local,
            methodName,
            [payload],
            {
                unavailableMessage: `storage.local.${methodName} is unavailable.`,
                transformError: normalizeExtensionError,
            },
        );
    }

    function createRequestId() {
        return `bcampx-host-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
    }

    // The mapping lives in src/utils/host-errors.js and is generated into
    // extension.host-errors.js, so the advice this adapter shows is the same
    // advice the bundled core shows for the same failure.
    function describeHostError(message) {
        const api = globalThis.__BCAMPX_HOST_ERRORS__;
        return api && typeof api.describeHostError === "function"
            ? api.describeHostError(message)
            : "";
    }

    function normalizeExtensionError(error) {
        const message =
            error && error.message ? String(error.message) : String(error || "");
        const hostMessage = describeHostError(message);
        if (hostMessage) {
            return new Error(hostMessage);
        }

        return error instanceof Error ? error : new Error(message || "Extension error.");
    }
})();
