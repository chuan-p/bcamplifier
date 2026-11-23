"use strict";

// Shared pure helpers used by extension.background.js, extension.content.js,
// and extension.host-permission.js. They are loaded in each context via
// importScripts (service worker), the content_scripts "js" array, or a plain
// <script> tag, and exposed on globalThis so every file shares one copy.
(function () {
    function isBandcampHostname(rawHostname) {
        const hostname = String(rawHostname || "").trim().toLowerCase();
        return (
            hostname === "bandcamp.com" ||
            hostname.endsWith(".bandcamp.com")
        );
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

        return parsed.origin + "/*";
    }

    // The `browser` namespace is not a plain object in every browser. Firefox
    // exposes it as an exotic object whose APIs are not own enumerable
    // properties, so `{ ...browser }` can copy none of them. Read every
    // namespace this extension uses explicitly instead of copying it, and keep
    // the list complete: a facade that silently drops `tabs` makes the custom
    // domain permission button fail without any visible effect.
    function getExtensionApi() {
        if (globalThis.browser && globalThis.browser.runtime) {
            return createExtensionApiFacade("browser", globalThis.browser);
        }

        if (globalThis.chrome && globalThis.chrome.runtime) {
            return createExtensionApiFacade("chrome", globalThis.chrome);
        }

        return null;
    }

    function createExtensionApiFacade(kind, namespace) {
        return {
            kind,
            runtime: namespace.runtime,
            storage: namespace.storage,
            permissions: namespace.permissions,
            tabs: namespace.tabs,
        };
    }

    // Unified Promise wrapper for WebExtension APIs across Firefox (`browser.*`,
    // Promise-returning) and Chrome (`chrome.*`, callback + runtime.lastError).
    function callExtensionApi(runtimeApi, target, methodName, args = [], options = {}) {
        const transformError =
            typeof options.transformError === "function"
                ? options.transformError
                : (error) => error;
        const fallbackMessage = options.fallbackMessage || `${methodName} failed.`;
        const ignoreErrors = options.ignoreErrors === true;

        if (!target || typeof target[methodName] !== "function") {
            if (ignoreErrors) {
                return Promise.resolve();
            }
            return Promise.reject(
                transformError(
                    new Error(options.unavailableMessage || `${methodName} is unavailable.`),
                ),
            );
        }

        if (runtimeApi && runtimeApi.kind === "browser") {
            return Promise.resolve()
                .then(() => target[methodName](...args))
                .catch((error) => {
                    if (ignoreErrors) {
                        return undefined;
                    }
                    throw transformError(error);
                });
        }

        return new Promise((resolve, reject) => {
            target[methodName](...args, (result) => {
                const lastError =
                    runtimeApi && runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (lastError) {
                    if (ignoreErrors) {
                        resolve(undefined);
                        return;
                    }
                    reject(
                        transformError(
                            new Error(lastError.message || fallbackMessage),
                        ),
                    );
                    return;
                }
                resolve(result);
            });
        });
    }

    globalThis.__BCAMPX_EXT_SHARED__ = {
        isBandcampHostname,
        normalizeCustomHostPermissionPattern,
        getExtensionApi,
        callExtensionApi,
    };
})();
