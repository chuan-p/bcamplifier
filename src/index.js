// Entry point for the bundled userscript. Keeping bootstrap side effects here
// lets every other module in src/ be imported cleanly by unit tests.

import { init } from "./bcamplifier.core.js";

// Diagnostic only: prove the script body reached execution even when a later
// initializer fails before init() runs.
try {
    if (document.documentElement) {
        document.documentElement.setAttribute("data-bcampx-early", "1");
    }
} catch (_error) {
    // Diagnostics must never break the page.
}

init();
