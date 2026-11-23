"use strict";

(() => {
    const {
        normalizeCustomHostPermissionPattern,
        getExtensionApi,
        callExtensionApi,
    } = globalThis.__BCAMPX_EXT_SHARED__;
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
    let existingGranted = false;

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
                existingGranted = true;
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
            const granted = await callPermissionsMethod("request", {
                origins: [originPattern],
            });

            await finish(granted, granted ? "" : "Permission was not granted.", {
                alreadyGranted: existingGranted,
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

    function callPermissionsMethod(methodName, payload) {
        return callExtensionApi(
            runtimeApi,
            runtimeApi && runtimeApi.permissions,
            methodName,
            payload === undefined ? [] : [payload],
            { unavailableMessage: `permissions.${methodName} is unavailable.` },
        );
    }

    function sendRuntimeMessage(message) {
        return callExtensionApi(
            runtimeApi,
            runtimeApi && runtimeApi.runtime,
            "sendMessage",
            [message],
            {
                unavailableMessage: "Extension runtime messaging is unavailable.",
                fallbackMessage: "Could not send the message.",
            },
        );
    }

    async function closeCurrentTab() {
        const tabs = runtimeApi && runtimeApi.tabs;
        if (!tabs || typeof tabs.getCurrent !== "function" || typeof tabs.remove !== "function") {
            window.close();
            return;
        }

        try {
            const tab = await callExtensionApi(runtimeApi, tabs, "getCurrent");
            if (tab && Number.isInteger(tab.id)) {
                await callExtensionApi(runtimeApi, tabs, "remove", [tab.id], {
                    ignoreErrors: true,
                });
                return;
            }
        } catch (_error) {}

        window.close();
    }
})();
