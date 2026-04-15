"use strict";

(() => {
    const runtimeApi = getExtensionApi();
    const params = new URLSearchParams(window.location.search);
    const requestId = String(params.get("requestId") || "").trim();
    const originPattern = normalizeCustomHostPermissionPattern(
        String(params.get("origin") || ""),
    );
    const allowButton = document.querySelector("#allow-button");
    const cancelButton = document.querySelector("#cancel-button");
    const statusNode = document.querySelector("#status");
    const domainLabel = document.querySelector("#domain-label");

    if (domainLabel) {
        domainLabel.textContent = originPattern || "Invalid custom domain request";
    }

    if (!runtimeApi || !requestId || !originPattern) {
        setStatus("This permission request is invalid. You can close this tab.");
        setButtonsDisabled(true);
        return;
    }

    checkExistingPermission();
    allowButton.addEventListener("click", () => {
        void requestPermission();
    });
    cancelButton.addEventListener("click", () => {
        void finish(false, "Permission was not granted.");
    });

    async function checkExistingPermission() {
        try {
            const granted = await callPermissionsMethod("contains", {
                origins: [originPattern],
            });
            if (granted) {
                allowButton.textContent = "Continue";
                setStatus("Access for this domain is already granted.");
            }
        } catch (_error) {
            // Keep the page usable even if the browser does not expose a readable
            // permission state before the user clicks.
        }
    }

    async function requestPermission() {
        setButtonsDisabled(true);
        setStatus("Requesting access…");

        try {
            const alreadyGranted = await callPermissionsMethod("contains", {
                origins: [originPattern],
            });
            const granted = alreadyGranted
                ? true
                : await callPermissionsMethod("request", {
                      origins: [originPattern],
                  });

            await finish(granted, granted ? "" : "Permission was not granted.", {
                alreadyGranted,
            });
        } catch (error) {
            await finish(
                false,
                error && error.message
                    ? error.message
                    : "Permission request failed.",
            );
        }
    }

    async function finish(granted, errorMessage, options = {}) {
        const statusMessage = granted
            ? "Access granted. Returning to Bandcamp…"
            : errorMessage || "Permission was not granted.";
        setStatus(statusMessage);

        try {
            await sendRuntimeMessage({
                type: "bcampx:host-permission-result",
                requestId,
                originPattern,
                granted: Boolean(granted),
                alreadyGranted: Boolean(options.alreadyGranted),
                error: granted ? "" : errorMessage || "Permission was not granted.",
            });
        } catch (_error) {
            // Even if the relay fails, still attempt to close the tab to avoid
            // leaving the user stranded on an internal page.
        }

        await closeCurrentTab();
    }

    function setStatus(message) {
        if (statusNode) {
            statusNode.textContent = message;
        }
    }

    function setButtonsDisabled(disabled) {
        if (allowButton) {
            allowButton.disabled = disabled;
        }
        if (cancelButton) {
            cancelButton.disabled = disabled;
        }
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
        return hostname === "bandcamp.com" || hostname.endsWith(".bandcamp.com");
    }

    function callPermissionsMethod(methodName, payload) {
        const permissions = runtimeApi && runtimeApi.permissions;
        if (!permissions || typeof permissions[methodName] !== "function") {
            return Promise.reject(
                new Error(`permissions.${methodName} is unavailable.`),
            );
        }

        if (runtimeApi.kind === "browser") {
            try {
                return payload === undefined
                    ? Promise.resolve(permissions[methodName]())
                    : Promise.resolve(permissions[methodName](payload));
            } catch (error) {
                return Promise.reject(error);
            }
        }

        return new Promise((resolve, reject) => {
            const callback = (result) => {
                const error = runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (error) {
                    reject(new Error(error.message || `${methodName} failed.`));
                    return;
                }

                resolve(result);
            };

            if (payload === undefined) {
                permissions[methodName](callback);
                return;
            }

            permissions[methodName](payload, callback);
        });
    }

    function sendRuntimeMessage(message) {
        if (!runtimeApi.runtime || typeof runtimeApi.runtime.sendMessage !== "function") {
            return Promise.reject(
                new Error("Extension runtime messaging is unavailable."),
            );
        }

        if (runtimeApi.kind === "browser") {
            return Promise.resolve(runtimeApi.runtime.sendMessage(message));
        }

        return new Promise((resolve, reject) => {
            runtimeApi.runtime.sendMessage(message, (response) => {
                const error = runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (error) {
                    reject(new Error(error.message || "Could not send the message."));
                    return;
                }

                resolve(response);
            });
        });
    }

    function closeCurrentTab() {
        const tabs = runtimeApi && runtimeApi.tabs;
        if (!tabs || typeof tabs.getCurrent !== "function" || typeof tabs.remove !== "function") {
            window.close();
            return Promise.resolve();
        }

        if (runtimeApi.kind === "browser") {
            return Promise.resolve(tabs.getCurrent())
                .then((tab) => {
                    if (tab && Number.isInteger(tab.id)) {
                        return tabs.remove(tab.id);
                    }
                    window.close();
                    return undefined;
                })
                .catch(() => {
                    window.close();
                });
        }

        return new Promise((resolve) => {
            tabs.getCurrent((tab) => {
                const getCurrentError =
                    runtimeApi.runtime && runtimeApi.runtime.lastError;
                if (
                    getCurrentError ||
                    !tab ||
                    !Number.isInteger(tab.id)
                ) {
                    window.close();
                    resolve();
                    return;
                }

                tabs.remove(tab.id, () => {
                    void (runtimeApi.runtime && runtimeApi.runtime.lastError);
                    resolve();
                });
            });
        });
    }

    function getExtensionApi() {
        if (globalThis.browser && globalThis.browser.runtime) {
            return { kind: "browser", ...globalThis.browser };
        }

        if (globalThis.chrome && globalThis.chrome.runtime) {
            return { kind: "chrome", ...globalThis.chrome };
        }

        return null;
    }
})();
