"use strict";

(() => {
    const runtimeApi = getExtensionApi();
    if (!runtimeApi) {
        return;
    }

    if (globalThis.__BCAMPX_HOST__) {
        return;
    }

    globalThis.__BCAMPX_HOST__ = {
        kind: "webextension",
        requestHtml: (url, options = {}) => requestText(url, options),
        requestJson: (url, options = {}) => requestJson(url, options),
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

    function getSuccessfulFetchResponse(payload) {
        if (!payload || payload.ok !== true || !payload.response) {
            throw new Error(
                payload && payload.error
                    ? payload.error
                    : "Network request failed.",
            );
        }

        const response = payload.response;
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response;
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
                new Error("Extension runtime messaging is unavailable."),
            );
        }

        if (runtimeApi.kind === "browser") {
            return Promise.resolve(runtimeApi.runtime.sendMessage(message));
        }

        return new Promise((resolve, reject) => {
            runtimeApi.runtime.sendMessage(message, (response) => {
                const error =
                    runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
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
                new Error(`storage.local.${methodName} is unavailable.`),
            );
        }

        if (runtimeApi.kind === "browser") {
            return Promise.resolve(storage[methodName](payload));
        }

        return new Promise((resolve, reject) => {
            storage[methodName](payload, (result) => {
                const error =
                    runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }

                resolve(result);
            });
        });
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
