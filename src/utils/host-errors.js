// One mapping from a runtime or storage failure to the guidance the UI
// shows. The bundled core and the extension adapter both use this module, so
// the "extension was updated" advice cannot drift between the two runtimes.
//
// Returns "" when the message is not a known host failure; callers keep
// their own message in that case.

export const HOST_CONTEXT_LOST_MESSAGE =
    "Extension was updated or reloaded. Refresh this Bandcamp tab and try again.";
export const HOST_STORAGE_UNAVAILABLE_MESSAGE =
    "Extension storage is unavailable. Refresh the tab or restart the browser and try again.";
export const HOST_STORAGE_FULL_MESSAGE =
    "Extension storage is full. Clear this site's cached data or restart the browser and try again.";

export function describeHostError(rawMessage) {
    const message = String(rawMessage || "");
    if (!message) {
        return "";
    }

    if (
        /Extension context invalidated/i.test(message) ||
        /Receiving end does not exist/i.test(message) ||
        /Could not establish connection/i.test(message) ||
        /message port closed/i.test(message)
    ) {
        return HOST_CONTEXT_LOST_MESSAGE;
    }

    if (/quota|QUOTA_BYTES|storage is full/i.test(message)) {
        return HOST_STORAGE_FULL_MESSAGE;
    }

    if (/storage\.local\./i.test(message)) {
        return HOST_STORAGE_UNAVAILABLE_MESSAGE;
    }

    return "";
}
