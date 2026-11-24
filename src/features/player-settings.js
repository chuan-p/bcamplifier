import { applyTagSearchSetting, getTagIndexProgress } from "../data/tag-index.js";
import { refreshArtistMusicCollectionCounts } from "./artist-music-feed.js";
import { refreshRenderedTrackActionButtons } from "./track-actions.js";
import { CONFIG, STATE } from "../state.js";
import { persistUserSettings } from "../utils/page.js";

function setAttrIfChanged(node, name, value) {
    if (node.getAttribute(name) !== value) {
        node.setAttribute(name, value);
    }
}

function setBoolPropIfChanged(node, name, value) {
    const next = Boolean(value);
    if (Boolean(node[name]) !== next) {
        node[name] = next;
    }
}

export function setupPlayerMenuDismissal() {
    document.addEventListener("click", handleDocumentPlayerUiClick, true);
    document.addEventListener("keydown", handleDocumentPlayerUiKeydown, true);
}

function handleDocumentPlayerUiClick(event) {
    if (!STATE.playerSettingsOpen) {
        return;
    }

    if (!STATE.playerHost || !document.contains(STATE.playerHost)) {
        closePlayerSettingsMenu();
        return;
    }

    const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
    if (isPlayerSettingsInteraction(path)) {
        return;
    }

    closePlayerSettingsMenu();
}

function isPlayerSettingsInteraction(path) {
    const ui = STATE.playerUi;
    if (!ui) {
        return false;
    }

    return Boolean(
        (ui.settingsWrap && path.includes(ui.settingsWrap)) ||
            (ui.settingsButton && path.includes(ui.settingsButton)) ||
            (ui.settingsMenu && path.includes(ui.settingsMenu)),
    );
}

function handleDocumentPlayerUiKeydown(event) {
    if (event.key !== "Escape" || !STATE.playerSettingsOpen) {
        return;
    }

    closePlayerSettingsMenu();
}

export function togglePlayerSettingsMenu(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    STATE.playerSettingsOpen = !STATE.playerSettingsOpen;
    syncPlayerSettingsMenu();
}

export function closePlayerSettingsMenu() {
    if (!STATE.playerSettingsOpen) {
        return;
    }

    STATE.playerSettingsOpen = false;
    syncPlayerSettingsMenu();
}

export function syncPlayerSettingsMenu() {
    const ui = STATE.playerUi;
    if (!ui || !ui.settingsButton || !ui.settingsMenu) {
        return;
    }

    const open = !!STATE.playerSettingsOpen;
    setAttrIfChanged(ui.settingsButton, "aria-expanded", open ? "true" : "false");
    setAttrIfChanged(
        ui.settingsButton,
        "aria-label",
        open ? "Close settings" : "Open settings",
    );
    setBoolPropIfChanged(ui.settingsMenu, "hidden", !open);
    if (ui.trackRowActionsSettingInput) {
        setBoolPropIfChanged(
            ui.trackRowActionsSettingInput,
            "checked",
            !!CONFIG.enableTrackRowActions,
        );
    }
    if (ui.autoFillPriceSettingInput) {
        setBoolPropIfChanged(
            ui.autoFillPriceSettingInput,
            "checked",
            !!CONFIG.autoFillMinimumPrice,
        );
    }
    if (ui.continuousModeSettingInput) {
        setBoolPropIfChanged(
            ui.continuousModeSettingInput,
            "checked",
            !!CONFIG.continuousMode,
        );
    }
    if (ui.collectionCountsSettingInput) {
        setBoolPropIfChanged(
            ui.collectionCountsSettingInput,
            "checked",
            !!CONFIG.showCollectionCounts,
        );
    }
    refreshTagSearchSettingProgress();
    if (ui.tagSearchSettingInput) {
        setBoolPropIfChanged(
            ui.tagSearchSettingInput,
            "checked",
            !!CONFIG.enableTagSearch,
        );
    }
}

function createPlayerSettingsToggleRow({
    label,
    description,
    checked,
    onChange,
}) {
    const row = document.createElement("label");
    row.className = "bcampx-player-settings-row";

    const copy = document.createElement("span");
    copy.className = "bcampx-player-settings-copy";

    const title = document.createElement("span");
    title.className = "bcampx-player-settings-label";
    title.textContent = label;

    const desc = document.createElement("span");
    desc.className = "bcampx-player-settings-description";
    desc.textContent = description;

    copy.append(title, desc);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "bcampx-player-settings-checkbox";
    input.checked = !!checked;
    input.addEventListener("change", onChange);

    row.append(copy, input);
    return { row, input, description: desc };
}

function createBooleanSettingHandler(configKey, onAfterChange = null) {
    return (event) => {
        CONFIG[configKey] = !!(event && event.target && event.target.checked);
        syncPlayerSettingsMenu();
        if (typeof onAfterChange === "function") {
            onAfterChange();
        }
        void persistUserSettings();
    };
}

function buildTagSearchSettingDescription() {
    const base = "Also search your collection and wishlist by cached tags.";
    const progress =
        typeof getTagIndexProgress === "function" ? getTagIndexProgress() : null;
    const items = Number(progress && progress.items) || 0;
    if (!items) {
        return base;
    }
    const tagged = Number(progress && progress.tagged) || 0;
    return `${base} (${tagged}/${items})`;
}

export function refreshTagSearchSettingProgress() {
    const ui = STATE.playerUi;
    const node = ui && ui.tagSearchSettingDescription;
    if (!node) {
        return;
    }
    const next = buildTagSearchSettingDescription();
    if (node.textContent !== next) {
        node.textContent = next;
    }
}

export function createPlayerSettingsMenu(onContinuousModeChange) {
    const settingsMenu = document.createElement("div");
    settingsMenu.className = "bcampx-player-settings-menu";
    settingsMenu.hidden = true;
    settingsMenu.setAttribute("role", "menu");

    const trackRowActionsSetting = createPlayerSettingsToggleRow({
        label: "Buy/Wish button for singles",
        description:
            "Show per-track buy and wishlist actions. Turn off to save a little loading work.",
        checked: CONFIG.enableTrackRowActions,
        onChange: createBooleanSettingHandler(
            "enableTrackRowActions",
            refreshRenderedTrackActionButtons,
        ),
    });

    const autoFillPriceSetting = createPlayerSettingsToggleRow({
        label: "Auto-fill minimum price",
        description:
            "Automatically fill the minimum price into the buy dialog. Turn off to enter a custom price.",
        checked: CONFIG.autoFillMinimumPrice,
        onChange: createBooleanSettingHandler("autoFillMinimumPrice"),
    });

    const continuousModeSetting = createPlayerSettingsToggleRow({
        label: "Continuous mode",
        description:
            "When one release finishes, keep going to the next playable release in the feed.",
        checked: CONFIG.continuousMode,
        onChange: createBooleanSettingHandler(
            "continuousMode",
            onContinuousModeChange,
        ),
    });

    const collectionCountsSetting = createPlayerSettingsToggleRow({
        label: "Collection counts",
        description:
            "Show how many collections a release appears in. Uses extra Bandcamp requests.",
        checked: CONFIG.showCollectionCounts,
        onChange: createBooleanSettingHandler(
            "showCollectionCounts",
            refreshArtistMusicCollectionCounts,
        ),
    });

    const tagSearchSetting = createPlayerSettingsToggleRow({
        label: "Tag search (experimental)",
        description: buildTagSearchSettingDescription(),
        checked: CONFIG.enableTagSearch,
        onChange: createBooleanSettingHandler("enableTagSearch", applyTagSearchSetting),
    });

    const settingsFooter = document.createElement("div");
    settingsFooter.className = "bcampx-player-settings-footer";
    settingsFooter.append("Made by ");

    const settingsFooterLink = document.createElement("a");
    settingsFooterLink.className = "bcampx-player-settings-footer-link";
    settingsFooterLink.href = "https://www.instagram.com/chuan_p/";
    settingsFooterLink.target = "_blank";
    settingsFooterLink.rel = "noopener noreferrer";
    settingsFooterLink.textContent = "@chuan_p";

    settingsFooter.append(settingsFooterLink);
    settingsFooter.append(" with Codex. 2026");

    settingsMenu.append(
        trackRowActionsSetting.row,
        autoFillPriceSetting.row,
        continuousModeSetting.row,
        collectionCountsSetting.row,
        tagSearchSetting.row,
        settingsFooter,
    );

    return {
        settingsMenu,
        trackRowActionsSetting,
        autoFillPriceSetting,
        continuousModeSetting,
        collectionCountsSetting,
        tagSearchSetting,
    };
}
