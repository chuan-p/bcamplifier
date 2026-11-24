// Lightweight callback registries so data modules do not import UI/feature
// modules or form circular dependencies with each other.

export const TAG_INDEX_UI_HOOKS = {
    scheduleFeedSync: () => {},
    refreshProgress: () => {},
    isProfileOwner: () => false,
    buildNativeRelease: () => null,
};

export function registerTagIndexUiHooks(hooks) {
    Object.assign(TAG_INDEX_UI_HOOKS, hooks);
}

export const TAG_INDEX_PACING_HOOKS = {
    isRateLimitError: (error) => {
        const message = String((error && error.message) || error || "");
        return /HTTP\s*429|too many requests|rate.?limit/i.test(message);
    },
    waitTurn: async () => {},
    activateCooldown: async () => 0,
};

export function registerTagIndexPacingHooks(hooks) {
    Object.assign(TAG_INDEX_PACING_HOOKS, hooks);
}
