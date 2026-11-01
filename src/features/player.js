    // Shared audio, playback routing, the bottom player shell, media session
    // integration and the waypoint controls. Extracted from the core bundle and
    // injected into the same IIFE.

    function setupSharedAudio() {
        if (STATE.sharedAudio) {
            return;
        }

        STATE.pageAudio =
            document.querySelector("body > audio") ||
            document.querySelector("audio") ||
            null;
        STATE.sharedAudio = document.createElement("audio");
        STATE.sharedAudio.preload = "metadata";
        STATE.sharedAudio.controls = true;
        addAudioEventListeners(STATE.sharedAudio, [
            "pause",
            "play",
            "ended",
        ], syncActiveTrackButton);
        STATE.sharedAudio.addEventListener("ended", handleSharedAudioEnded);
        STATE.sharedAudio.addEventListener("play", () =>
            announcePlaybackStart("feed-preview"),
        );
        addAudioEventListeners(STATE.sharedAudio, [
            "play",
            "pause",
            "ended",
        ], syncMediaSessionState);
        setupMediaSession();
    }

    function addAudioEventListeners(audio, eventNames, handler) {
        if (
            !(audio instanceof HTMLAudioElement) ||
            !Array.isArray(eventNames) ||
            typeof handler !== "function"
        ) {
            return;
        }

        eventNames.forEach((eventName) => {
            audio.addEventListener(eventName, handler);
        });
    }

    function handleDocumentAudioPlay(event) {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement)) {
            return;
        }

        if (audio === STATE.sharedAudio) {
            return;
        }

        // A native play was started. The old code paused the page's own audio
        // here, so a preview link could look like it never started. Let the
        // native player win and stop our shared audio instead.
        if (STATE.sharedAudio && !STATE.sharedAudio.paused) {
            STATE.sharedAudio.pause();
            clearActiveTrackButton();
            scheduleUiSync();
        }

        if (isFeedEnhancerPage() && audio === STATE.pageAudio) {
            return;
        }

        announcePlaybackStart("bandcamp-native");
    }

    function handleSharedAudioEnded() {
        window.setTimeout(() => {
            void continuePlaybackAfterTrackEnd();
        }, 0);
    }

    function announcePlaybackStart(kind) {
        const startedAt = Date.now();
        STATE.lastPlaybackStartedAt = startedAt;
        void storageSet(PLAYBACK_PAUSE_REQUEST_KEY, {
            tabId: STATE.tabId,
            kind: kind || "bandcamp-native",
            pageUrl: window.location.href,
            ts: startedAt,
            nonce: Math.random().toString(36).slice(2, 10),
        });
    }

    function subscribeToPlaybackPauseRequests() {
        const host = getExternalHostApi();
        if (
            host &&
            typeof host.subscribeStorageKey === "function"
        ) {
            STATE.playbackPauseUnsubscribe = host.subscribeStorageKey(
                PLAYBACK_PAUSE_REQUEST_KEY,
                handlePlaybackPauseRequest,
            );
            return;
        }

        try {
            if (typeof GM_addValueChangeListener === "function") {
                const listenerId = GM_addValueChangeListener(
                    PLAYBACK_PAUSE_REQUEST_KEY,
                    (_key, _oldValue, newValue, remote) => {
                        if (remote !== false) {
                            handlePlaybackPauseRequest(newValue);
                        }
                    },
                );
                STATE.playbackPauseUnsubscribe = () => {
                    if (typeof GM_removeValueChangeListener === "function") {
                        GM_removeValueChangeListener(listenerId);
                    }
                };
            }
        } catch (_error) {}
    }

    async function checkForPlaybackPauseRequest() {
        const request = await storageGet(PLAYBACK_PAUSE_REQUEST_KEY, null);
        handlePlaybackPauseRequest(request);
    }

    function handlePlaybackPauseRequest(request) {
        if (!request || typeof request !== "object") {
            return;
        }

        if (!request.tabId || request.tabId === STATE.tabId) {
            return;
        }

        const requestTs = Number(request.ts) || 0;
        if (!requestTs) {
            return;
        }

        if (requestTs <= STATE.lastHandledPlaybackPauseRequestAt) {
            return;
        }

        if (Date.now() - requestTs > PLAYBACK_PAUSE_STALE_MS) {
            return;
        }

        STATE.lastHandledPlaybackPauseRequestAt = requestTs;
        if (
            STATE.lastPlaybackStartedAt &&
            requestTs < STATE.lastPlaybackStartedAt
        ) {
            return;
        }

        pauseLocalPlayback();
    }

    function pauseLocalPlayback() {
        const activeAudios = getLocalActiveAudios();
        activeAudios.forEach((audio) => {
            if (typeof audio.pause === "function") {
                audio.pause();
            }
        });

        clearActiveTrackButton();
        syncPlayerShell();
    }

    function getLocalActiveAudios() {
        const audios = [];

        if (STATE.sharedAudio && !STATE.sharedAudio.paused) {
            audios.push(STATE.sharedAudio);
        }

        document.querySelectorAll("audio").forEach((audio) => {
            if (!(audio instanceof HTMLAudioElement) || audio.paused) {
                return;
            }

            if (!audios.includes(audio)) {
                audios.push(audio);
            }
        });

        return audios;
    }

    function setupNativePlaybackInterception() {
        window.addEventListener(
            "pointerdown",
            handleCollectionGridPointerDown,
            true,
        );
        window.addEventListener(
            "click",
            handleNativePlaybackTriggerClick,
            true,
        );
        markDebugState("data-bcampx-native-playback-listener", "ready");
    }

    function handleCollectionGridPointerDown(event) {
        if (event.button !== 0) {
            return;
        }

        const trigger = findNativePlaybackTrigger(event.target);
        const card = findCollectionGridCard(trigger);
        if (!card || isFullDiscographyCard(card)) {
            return;
        }

        const releaseUrl = getCardPrimaryReleaseUrl(card);
        if (!releaseUrl) {
            return;
        }

        STATE.collectionPointerReleaseUrl = normalizeReleaseUrl(releaseUrl);
        STATE.collectionPointerHandledAt = Date.now();
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }

        markDebugState(
            "data-bcampx-collection-playback-state",
            "pointer-triggered",
        );
        void playCollectionGridTrigger(card, trigger, releaseUrl);
    }

    function setupPlayerMenuDismissal() {
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

    function handleNativePlaybackTriggerClick(event) {
        const trigger = findNativePlaybackTrigger(event.target);
        if (!trigger) {
            return;
        }

        const collectionCard = findCollectionGridCard(trigger);
        const card = collectionCard || findPlaybackCard(trigger);
        if (
            !card ||
            isFullDiscographyCard(card) ||
            isMalformedFeedCard(card) ||
            card.closest("#sidebar")
        ) {
            return;
        }

        const releaseUrl = getCardPrimaryReleaseUrl(card);
        if (!releaseUrl) {
            return;
        }

        if (
            collectionCard &&
            normalizeReleaseUrl(releaseUrl) ===
                STATE.collectionPointerReleaseUrl &&
            Date.now() - STATE.collectionPointerHandledAt < 1000
        ) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            }
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }

        if (collectionCard) {
            markDebugState("data-bcampx-collection-playback-state", "triggered");
            void playCollectionGridTrigger(collectionCard, trigger, releaseUrl);
            return;
        }

        playNativeCardTrigger(card, trigger, releaseUrl);
    }

    function findNativePlaybackTrigger(node) {
        if (!node || typeof node.closest !== "function") {
            return null;
        }

        return node.closest(
            ".track_play_auxiliary, .tralbum-art-container, .track_play_time",
        );
    }

    function findCollectionGridCard(node) {
        if (!node || typeof node.closest !== "function") {
            return null;
        }

        const card = node.closest(".collection-grid .collection-item-container");
        return card instanceof Element ? card : null;
    }

    async function playCollectionGridTrigger(card, trigger, releaseUrl) {
        if (
            isActiveReleaseForCard(releaseUrl) &&
            STATE.activePlaybackScope === "collection-grid" &&
            STATE.activeTrack &&
            STATE.activeTrack.streamUrl
        ) {
            toggleActiveReleasePlayback(card);
            return;
        }

        try {
            const preview = getCollectionGridFeaturedPreview(card);
            if (preview) {
                markDebugState(
                    "data-bcampx-collection-playback-state",
                    "preview-playing",
                );
                playTrackForCard(
                    card,
                    null,
                    preview.track,
                    preview.data,
                    releaseUrl,
                    {
                        playbackScope: "collection-grid",
                        trackList: [preview.track],
                        onPlayError: () =>
                            retryCollectionGridPlaybackWithoutPreview(
                                card,
                                trigger,
                                releaseUrl,
                            ),
                    },
                );
                observeCollectionCoverState();
                return;
            }

            markDebugState("data-bcampx-collection-playback-state", "fetching");
            const audio = ensureSharedAudio();
            if (audio && !audio.paused) {
                audio.pause();
            }
            STATE.activePlaybackScope = "collection-grid";
            setActiveTrackCard(card);
            syncCoverPlaybackState();
            observeCollectionCoverState();
            const data = await getAvailableOrFetchReleaseDataForCard(
                card,
                releaseUrl,
            );
            const track = findFeaturedTrackForCard(card, trigger, data);
            if (!track || !track.streamUrl) {
                markDebugState(
                    "data-bcampx-collection-playback-state",
                    "missing-featured-track",
                );
                return;
            }

            markDebugState("data-bcampx-collection-playback-state", "playing");
            playTrackForCard(card, null, track, data, releaseUrl, {
                playbackScope: "collection-grid",
                trackList: [track],
            });
            observeCollectionCoverState();
        } catch (_error) {
            markDebugState("data-bcampx-collection-playback-state", "error");
        }
    }

    async function retryCollectionGridPlaybackWithoutPreview(
        card,
        trigger,
        releaseUrl,
    ) {
        const memo = getNodeMemo(card);
        if (memo) {
            memo.collectionGridFeaturedPreview = null;
        }

        const data = await getAvailableOrFetchReleaseDataForCard(
            card,
            releaseUrl,
        );
        const track = findFeaturedTrackForCard(card, trigger, data);
        if (!track || !track.streamUrl) {
            return;
        }

        playTrackForCard(card, null, track, data, releaseUrl, {
            playbackScope: "collection-grid",
            trackList: [track],
        });
        observeCollectionCoverState();
    }

    async function playNativeCardTrigger(card, trigger, releaseUrl) {
        const controller = ensureCardController(card, releaseUrl);
        if (!controller) {
            return;
        }

        if (
            isActiveReleaseForCard(releaseUrl) &&
            STATE.activeTrack &&
            STATE.activeTrack.streamUrl
        ) {
            toggleActiveReleasePlayback(card);
            return;
        }

        try {
            if (
                (!controller.data ||
                    !Array.isArray(controller.data.tracks) ||
                    !controller.data.tracks.length) &&
                !controller.loading
            ) {
                if (isOwnFanTrackCard(card)) {
                    // Own collection tracks never auto-fetch. Nothing to play yet.
                    return;
                }
                await controller.fetchAndRender({ auto: false });
            }
        } catch (_error) {
            return;
        }

        const data = controller.data;
        const track = findFeaturedTrackForCard(card, trigger, data);
        if (!track || !track.streamUrl) {
            if (isOwnFanTrackCard(card)) {
                const fallbackTrack =
                    data &&
                    Array.isArray(data.tracks) &&
                    data.tracks[0];
                if (fallbackTrack) {
                    await playOwnFanTrackAfterLoadingStream(
                        trigger,
                        fallbackTrack,
                        data,
                        releaseUrl,
                        card,
                    );
                }
            }
            return;
        }

        playTrackForCard(card, trigger, track, data, releaseUrl);
    }

    function isActiveReleaseForCard(releaseUrl) {
        const normalizedTarget = normalizeReleaseUrl(releaseUrl);
        const normalizedActive = normalizeReleaseUrl(
            STATE.activeReleaseUrl || "",
        );
        return Boolean(
            normalizedTarget &&
            normalizedActive &&
            normalizedTarget === normalizedActive,
        );
    }

    function toggleActiveReleasePlayback(card) {
        const audio = ensureSharedAudio();
        if (!audio || !STATE.activeTrack || !STATE.activeTrack.streamUrl) {
            return;
        }

        const cardArtUrl = getActiveCardArtUrl(card);
        setActiveTrackCard(card);

        if (cardArtUrl) {
            STATE.activeCardArtUrl = cardArtUrl;
        }

        if (!audio.paused) {
            audio.pause();
            scheduleUiSync(cardArtUrl);
            return;
        }

        pauseBandcampPageAudio();
        syncActiveTrackUi(cardArtUrl);
        audio.play().catch(() => {});
    }


    function createPlayerButton({
        text = "",
        className = "",
        iconName = "",
        ariaLabel = "",
        ariaPressed = "",
        ariaHaspopup = "",
        onClick = null,
    }) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className || "bcampx-player-button";

        if (iconName) {
            button.appendChild(createPlayerIcon(iconName));
        } else {
            button.textContent = text;
        }

        if (ariaLabel) {
            button.setAttribute("aria-label", ariaLabel);
        }
        if (ariaPressed) {
            button.setAttribute("aria-pressed", ariaPressed);
        }
        if (ariaHaspopup) {
            button.setAttribute("aria-haspopup", ariaHaspopup);
        }
        if (typeof onClick === "function") {
            button.addEventListener("click", onClick);
        }

        return button;
    }

    function playSharedTrack(button, track, data, releaseUrl) {
        playTrackForCard(
            findPlaybackCard(button),
            button,
            track,
            data,
            releaseUrl,
        );
    }

    async function playMergedTrackTitle(card, trackTitle, button) {
        if (!card || !trackTitle || !button) {
            return;
        }

        const releaseUrl = getCardPrimaryReleaseUrl(card);
        if (!releaseUrl) {
            return;
        }

        button.disabled = true;
        try {
            const availableData = getAvailableReleaseDataForCard(
                card,
                releaseUrl,
            );
            const data =
                availableData ||
                (await getReleaseData(
                    getCardReleaseRequestContext(card, releaseUrl),
                )).data;
            const track = findPlayableTrackByTitle(data, trackTitle);
            if (!track || !track.streamUrl) {
                return;
            }

            button.dataset.streamUrl = track.streamUrl || "";
            button.dataset.trackId = track.trackId || "";
            playTrackForCard(card, button, track, data, releaseUrl);
        } finally {
            button.disabled = false;
        }
    }

    function getAvailableReleaseDataForCard(card, releaseUrl) {
        const controller = getCardController(card);
        const controllerData = controller && controller.data;
        if (
            controllerData &&
            Array.isArray(controllerData.tracks) &&
            controllerData.tracks.length
        ) {
            return controllerData;
        }

        const normalizedTarget = normalizeReleaseUrl(releaseUrl);
        const normalizedActive = normalizeReleaseUrl(
            STATE.activeReleaseUrl || "",
        );
        if (
            STATE.activeReleaseData &&
            normalizedTarget &&
            normalizedActive &&
            normalizedTarget === normalizedActive &&
            Array.isArray(STATE.activeReleaseData.tracks) &&
            STATE.activeReleaseData.tracks.length
        ) {
            return STATE.activeReleaseData;
        }

        return null;
    }

    function findPlayableTrackByTitle(data, trackTitle) {
        const normalizedTarget = cleanText(trackTitle).toLowerCase();
        const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
        if (!normalizedTarget || !tracks.length) {
            return null;
        }

        const exactMatch = tracks.find(
            (track) =>
                cleanText(track && track.title).toLowerCase() ===
                    normalizedTarget && track.streamUrl,
        );
        if (exactMatch) {
            return exactMatch;
        }

        const inclusiveMatch = tracks.find((track) => {
            const normalizedTitle = cleanText(
                track && track.title,
            ).toLowerCase();
            return (
                normalizedTitle &&
                (normalizedTitle.includes(normalizedTarget) ||
                    normalizedTarget.includes(normalizedTitle)) &&
                track.streamUrl
            );
        });
        if (inclusiveMatch) {
            return inclusiveMatch;
        }

        return null;
    }


    function playTrackForCard(
        card,
        triggerButton,
        track,
        data,
        releaseUrl,
        options = {},
    ) {
        if (!track || !track.streamUrl) {
            return;
        }

        const audio = ensureSharedAudio();
        if (!audio) {
            return;
        }

        const sameTrack = audio.currentSrc === track.streamUrl;
        if (sameTrack && !audio.paused) {
            audio.pause();
            clearActiveTrackButton();
            return;
        }

        if (!sameTrack) {
            audio.src = track.streamUrl;
        }

        pauseBandcampPageAudio();
        const cardArtUrl = getCardArtUrl(card);
        if (
            triggerButton &&
            triggerButton.classList &&
            (triggerButton.classList.contains("bcampx__track-link") ||
                triggerButton.classList.contains("bcampx__merge-track-button"))
        ) {
            setActiveTrackButton(triggerButton);
        } else {
            clearActiveTrackButton();
        }
        setActiveTrackContext(
            track,
            data,
            releaseUrl,
            card,
            cardArtUrl,
            options,
        );
        syncActiveTrackUi(cardArtUrl);
        announcePlaybackStart("feed-preview");
        audio.play().catch(() => {
            clearActiveTrackButton();
            if (typeof options.onPlayError === "function") {
                void Promise.resolve(options.onPlayError()).catch(() => {});
            }
        });
    }

    function ensureSharedAudio() {
        if (STATE.sharedAudio) {
            return STATE.sharedAudio;
        }

        setupSharedAudio();
        return STATE.sharedAudio;
    }

    function setActiveTrackButton(button) {
        clearActiveTrackButton();
        STATE.activeTrackButton = button;
        STATE.activeTrackButton.classList.add("bcampx__track-link--active");
    }

    function clearActiveTrackButton() {
        if (STATE.activeTrackButton) {
            STATE.activeTrackButton.classList.remove(
                "bcampx__track-link--active",
            );
            STATE.activeTrackButton = null;
        }
    }

    function syncActiveTrackButton() {
        const audio = ensureSharedAudio();
        if (!audio || audio.paused) {
            clearActiveTrackButton();
        }

        scheduleUiSync();
    }

    function syncWaypointNowPlaying(track, data, cardArtUrl) {
        setupWaypointNavigation();
        const waypoint = document.querySelector("#track_play_waypoint");
        if (!waypoint) {
            return;
        }

        waypoint.classList.add("done", "activated");

        const image = waypoint.querySelector("img");
        const artUrl = cardArtUrl || (data && data.artUrl) || "";
        if (image && artUrl) {
            image.src = artUrl;
        }

        const nowLabel = waypoint.querySelector(".waypoint-header-now");
        if (nowLabel) {
            nowLabel.textContent = "now playing";
        }

        const title = waypoint.querySelector(".waypoint-item-title");
        if (title) {
            title.textContent = track.title || data.title || "";
        }

        const artist = waypoint.querySelector(".waypoint-artist-title");
        if (artist) {
            artist.textContent = data.artist ? `by ${data.artist}` : "";
        }

        updateWaypointPlayPauseButton();
    }

    function setupWaypointNavigation() {
        const waypoint = document.querySelector("#track_play_waypoint");
        if (!waypoint || STATE.waypointNode === waypoint) {
            return;
        }

        ensureWaypointPlayPauseButton(waypoint);
        waypoint.addEventListener("click", handleWaypointClick, true);
        STATE.waypointNode = waypoint;
    }

    function handleWaypointClick(event) {
        if (
            event.target &&
            event.target.closest &&
            event.target.closest(".bcampx__waypoint-toggle")
        ) {
            return;
        }

        const activeCard = getConnectedActiveTrackCard();
        if (!activeCard) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        scrollCardIntoView(activeCard, STATE.activeTrack);
    }

    function setActiveTrackCard(card) {
        if (!card || !document.contains(card)) {
            STATE.activeTrackCard = null;
            scheduleUiSync();
            return;
        }

        STATE.activeTrackCard = card;
        scheduleUiSync();
    }

    function getActiveCardArtUrl(card) {
        return getCardArtUrl(card) || STATE.activeCardArtUrl || "";
    }

    function syncActiveTrackUi(cardArtUrl) {
        scheduleUiSync(cardArtUrl);
    }

    function observeCollectionCoverState() {
        stopObservingCollectionCoverState();

        const card = getConnectedActiveTrackCard();
        const stateNode = findCoverPlaybackStateNodeForCard(card);
        if (
            STATE.activePlaybackScope !== "collection-grid" ||
            !stateNode ||
            typeof MutationObserver !== "function"
        ) {
            return;
        }

        const observer = new MutationObserver(() => {
            const audio = ensureSharedAudio();
            const expectedClass = audio && audio.paused ? "paused" : "playing";
            if (
                STATE.coverPlaybackStateNode === stateNode &&
                !stateNode.classList.contains(expectedClass)
            ) {
                syncCoverPlaybackState();
            }
        });
        observer.observe(stateNode, {
            attributes: true,
            attributeFilter: ["class"],
        });
        STATE.collectionCoverStateObserver = observer;
        STATE.collectionCoverStateObserverTimer = window.setTimeout(
            stopObservingCollectionCoverState,
            2200,
        );
    }

    function stopObservingCollectionCoverState() {
        if (STATE.collectionCoverStateObserver) {
            STATE.collectionCoverStateObserver.disconnect();
            STATE.collectionCoverStateObserver = null;
        }
        window.clearTimeout(STATE.collectionCoverStateObserverTimer);
        STATE.collectionCoverStateObserverTimer = 0;
    }

    function getConnectedActiveTrackCard() {
        if (STATE.activeTrackCard && document.contains(STATE.activeTrackCard)) {
            return STATE.activeTrackCard;
        }

        // A feed sync (including the tag-index progress refreshes) may replace
        // the card that was playing; re-resolve it by release URL so the player
        // keeps its favourite state and cover instead of going blank.
        const replacement = findActiveTrackCardByRelease();
        if (replacement) {
            STATE.activeTrackCard = replacement;
            return replacement;
        }

        return null;
    }

    function syncCoverPlaybackState() {
        const card = getConnectedActiveTrackCard();
        if (!card) {
            clearCoverPlaybackStateNode();
            return;
        }

        const stateNode = findCoverPlaybackStateNodeForCard(card);
        if (!stateNode) {
            clearCoverPlaybackStateNode();
            return;
        }

        const audio = ensureSharedAudio();
        if (!audio) {
            clearCoverPlaybackStateNode();
            return;
        }

        if (
            STATE.coverPlaybackStateNode &&
            STATE.coverPlaybackStateNode !== stateNode
        ) {
            STATE.coverPlaybackStateNode.classList.remove("playing", "paused");
        }

        STATE.coverPlaybackStateNode = stateNode;
        const activeClass = audio.paused ? "paused" : "playing";
        toggleClassIfChanged(stateNode, "paused", activeClass === "paused");
        toggleClassIfChanged(stateNode, "playing", activeClass === "playing");
    }

    function clearCoverPlaybackStateNode() {
        if (!STATE.coverPlaybackStateNode) {
            return;
        }

        STATE.coverPlaybackStateNode.classList.remove("playing", "paused");
        STATE.coverPlaybackStateNode = null;
    }

    function findCoverPlaybackStateNodeForCard(card) {
        if (!card || typeof card.closest !== "function") {
            return null;
        }

        return (
            card.querySelector(".collection-item-container") ||
            card.closest(".collection-item-container") ||
            card.querySelector("li.collection-item-container") ||
            card.closest("li.collection-item-container") ||
            card.querySelector(".story-innards") ||
            card.closest(".story-innards") ||
            card.querySelector(".story") ||
            card.closest(".story") ||
            card
        );
    }

    function setActiveTrackContext(
        track,
        data,
        releaseUrl,
        card,
        cardArtUrl,
        options = {},
    ) {
        STATE.activeTrack = track || null;
        STATE.activeReleaseData = data || null;
        STATE.activeReleaseUrl = releaseUrl || "";
        STATE.activeTrackCard = card || null;
        STATE.activeTrackFanGridNode =
            (card && typeof card.closest === "function"
                ? card.closest("#grids > .grid")
                : null) ||
            (STATE.artistMusicSourceGridNode &&
            typeof STATE.artistMusicSourceGridNode.closest === "function"
                ? STATE.artistMusicSourceGridNode.closest(
                      "#grids > .grid",
                  )
                : null) ||
            null;
        STATE.activeCardArtUrl = cardArtUrl || STATE.activeCardArtUrl || "";
        STATE.activePlaybackScope = cleanText(options.playbackScope);

        const tracks =
            Array.isArray(options.trackList)
                ? options.trackList.filter((item) => item && item.title)
                : data && Array.isArray(data.tracks)
                  ? data.tracks.filter((item) => item && item.title)
                  : [];
        STATE.activeTrackList = tracks;
        STATE.activeTrackIndex = findTrackIndex(tracks, track);

        syncMediaSessionMetadata();
        scheduleUiSync(cardArtUrl);
    }

    function scheduleUiSync(cardArtUrl) {
        if (typeof cardArtUrl === "string" && cardArtUrl) {
            STATE.pendingUiSyncCardArtUrl = cardArtUrl;
        }

        if (STATE.uiSyncFrame) {
            return;
        }

        STATE.uiSyncFrame = scheduleNextFrame(() => {
            STATE.uiSyncFrame = 0;
            const queuedArtUrl = STATE.pendingUiSyncCardArtUrl || "";
            STATE.pendingUiSyncCardArtUrl = "";
            flushUiSync(queuedArtUrl);
        });
    }

    function flushUiSync(cardArtUrl) {
        syncWaypointNowPlaying(
            STATE.activeTrack,
            STATE.activeReleaseData,
            cardArtUrl,
        );
        syncTrackButtonsForActiveTrack();
        syncCoverPlaybackState();
        updateWaypointPlayPauseButton();
        syncPlayerShell();
    }

    function setupMediaSession() {
        if (!("mediaSession" in navigator)) {
            return;
        }

        const handlers = {
            play: () => {
                const audio = ensureSharedAudio();
                if (audio && audio.paused) {
                    audio.play().catch(() => {});
                }
            },
            pause: () => {
                const audio = ensureSharedAudio();
                if (audio && !audio.paused) {
                    audio.pause();
                }
            },
            previoustrack: playPreviousTrack,
            nexttrack: playNextTrack,
        };

        Object.entries(handlers).forEach(([action, handler]) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (_error) {
                // Some browsers expose mediaSession but not every action handler.
            }
        });
    }

    function syncMediaSessionMetadata() {
        if (!("mediaSession" in navigator)) {
            return;
        }

        if (
            !STATE.activeTrack ||
            !STATE.activeReleaseData ||
            typeof MediaMetadata !== "function"
        ) {
            navigator.mediaSession.metadata = null;
            syncMediaSessionState();
            return;
        }

        const track = STATE.activeTrack;
        const data = STATE.activeReleaseData || {};
        const artworkUrl =
            getActiveCardArtUrl(STATE.activeTrackCard) || data.artUrl || "";
        const artwork = artworkUrl
            ? [96, 128, 192, 256, 384, 512].map((size) => ({
                  src: artworkUrl,
                  sizes: `${size}x${size}`,
              }))
            : [];

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title || data.title || "Bandcamp preview",
                artist: data.artist || "",
                album: data.title || "",
                artwork,
            });
        } catch (_error) {
            navigator.mediaSession.metadata = null;
        }

        syncMediaSessionState();
    }

    function syncMediaSessionState() {
        if (!("mediaSession" in navigator)) {
            return;
        }

        const audio = STATE.sharedAudio;
        if (!audio || !STATE.activeTrack || !STATE.activeReleaseData) {
            try {
                navigator.mediaSession.playbackState = "none";
            } catch (_error) {}
            return;
        }

        try {
            navigator.mediaSession.playbackState = audio.paused
                ? "paused"
                : "playing";
        } catch (_error) {}
    }

    function findTrackIndex(tracks, track) {
        if (!Array.isArray(tracks) || !track) {
            return -1;
        }

        const exactIndex = tracks.findIndex((item) => {
            return (
                item &&
                track &&
                item.title === track.title &&
                item.streamUrl === track.streamUrl
            );
        });
        if (exactIndex >= 0) {
            return exactIndex;
        }

        return tracks.findIndex(
            (item) => item && track && item.title === track.title,
        );
    }

    function findPlaybackCard(node) {
        if (!node || typeof node.closest !== "function") {
            return null;
        }

        return (
            node.closest("li.story.fp") ||
            node.closest(".story") ||
            node.closest("article") ||
            node.closest("li") ||
            null
        );
    }

    function getCardArtUrl(card) {
        if (!card) {
            return "";
        }

        const selectors = [
            ".tralbum-wrapper-col1 .tralbum-art-large",
            ".tralbum-wrapper-col1 .tralbum-art-container img",
            ".tralbum-wrapper-col1 img",
            ".collection-item-art img",
            ".art img",
            ".tralbum-art-large",
        ];

        let image = null;
        for (const selector of selectors) {
            image = card.querySelector(selector);
            if (image) {
                break;
            }
        }

        return image
            ? image.getAttribute("data-original") ||
                  image.currentSrc ||
                  image.src ||
                  ""
            : "";
    }

    function findWaypointScrollTarget(card, track) {
        if (!(card instanceof Element)) {
            return null;
        }

        if (
            STATE.activeTrackButton instanceof Element &&
            card.contains(STATE.activeTrackButton)
        ) {
            return (
                STATE.activeTrackButton.closest(".bcampx__track-item") ||
                STATE.activeTrackButton
            );
        }

        const trackId = cleanText(track && track.trackId);
        const streamUrl = cleanText(track && track.streamUrl);
        const title = cleanText(track && track.title).toLowerCase();
        const buttons = Array.from(
            card.querySelectorAll(
                ".bcampx__track-link, .bcampx__merge-track-button",
            ),
        );
        const preferredButton =
            (trackId &&
                buttons.find(
                    (button) =>
                        cleanText(button.dataset.trackId) === trackId,
                )) ||
            (streamUrl &&
                buttons.find(
                    (button) =>
                        cleanText(button.dataset.streamUrl) === streamUrl,
                )) ||
            (title &&
                buttons.find(
                    (button) =>
                        cleanText(button.textContent).toLowerCase() === title,
                ));
        if (preferredButton) {
            return (
                preferredButton.closest(".bcampx__track-item") ||
                preferredButton
            );
        }

        return card;
    }

    function scrollCardIntoView(card, track) {
        if (!card) {
            return;
        }

        const target = findWaypointScrollTarget(card, track);
        if (!target) {
            return;
        }
        const scrollOffset = getActiveTrackScrollOffset();

        if (window.Dom && typeof window.Dom.scrollToElement === "function") {
            window.Dom.scrollToElement(target, -scrollOffset);
            return;
        }

        const cardRect = target.getBoundingClientRect();
        const targetTop = window.scrollY + cardRect.top - scrollOffset;
        window.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth",
        });
    }

    function getActiveTrackScrollOffset() {
        const baseOffset = 30;
        const sticky = document.querySelector("#grid-tabs-sticky");
        if (!(sticky instanceof Element)) {
            return baseOffset;
        }

        const rect = sticky.getBoundingClientRect();
        const height = Math.max(
            0,
            rect.height,
            Number(sticky.clientHeight) || 0,
        );
        if (!height) {
            return baseOffset;
        }

        const style = window.getComputedStyle(sticky);
        const configuredTop = Number.parseFloat(style.top);
        const topInset =
            Number.isFinite(configuredTop) && configuredTop >= 0
                ? configuredTop
                : 0;
        return Math.max(baseOffset, Math.ceil(topInset + height + 12));
    }

    function ensurePlayerShell() {
        if (
            STATE.playerUi &&
            STATE.playerHost &&
            document.contains(STATE.playerHost)
        ) {
            return STATE.playerUi;
        }

        if (STATE.playerHost && document.contains(STATE.playerHost)) {
            STATE.playerHost.remove();
        }

        STATE.playerSettingsOpen = false;

        const host = document.createElement("div");
        host.id = "bcampx-player-host";
        host.style.all = "initial";
        host.style.position = "fixed";
        host.style.inset = "0";
        host.style.zIndex = "2147483646";
        host.style.pointerEvents = "none";

        const shadowRoot = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = getPlayerShellStyles();
        shadowRoot.append(style);

        const shell = document.createElement("section");
        shell.className = "bcampx-player-shell";
        shell.hidden = true;

        const controls = document.createElement("div");
        controls.className = "bcampx-player-controls";

        const prevButton = createPlayerButton({
            text: "Previous",
            className: "bcampx-player-button",
            onClick: playPreviousTrack,
        });

        const nextButton = createPlayerButton({
            text: "Next",
            className: "bcampx-player-button",
            onClick: playNextTrack,
        });

        const releaseButton = createPlayerButton({
            className: "bcampx-player-button bcampx-player-button--circle",
            iconName: "open",
            ariaLabel: "Open release",
            onClick: openActiveRelease,
        });

        const favoriteButton = createPlayerButton({
            className:
                "bcampx-player-button bcampx-player-button--circle bcampx-player-favorite",
            iconName: "favorite",
            ariaLabel: "Add to wishlist",
            ariaPressed: "false",
            onClick: toggleActiveWishlist,
        });

        const settingsWrap = document.createElement("div");
        settingsWrap.className = "bcampx-player-settings";

        const settingsButton = createPlayerButton({
            className:
                "bcampx-player-button bcampx-player-button--circle bcampx-player-settings-toggle",
            iconName: "settings",
            ariaLabel: "Open settings",
            ariaHaspopup: "menu",
            onClick: togglePlayerSettingsMenu,
        });
        settingsButton.setAttribute("aria-expanded", "false");

        const settingsMenu = document.createElement("div");
        settingsMenu.className = "bcampx-player-settings-menu";
        settingsMenu.hidden = true;
        settingsMenu.setAttribute("role", "menu");

        const trackRowActionsSetting = createPlayerSettingsToggleRow({
            label: "Buy/Wish button for singles",
            description: "Show per-track buy and wishlist actions. Turn off to save a little loading work.",
            checked: CONFIG.enableTrackRowActions,
            onChange: handleTrackRowActionsSettingChange,
        });

        const autoFillPriceSetting = createPlayerSettingsToggleRow({
            label: "Auto-fill minimum price",
            description: "Automatically fill the minimum price into the buy dialog. Turn off to enter a custom price.",
            checked: CONFIG.autoFillMinimumPrice,
            onChange: handleAutoFillMinimumPriceSettingChange,
        });

        const continuousModeSetting = createPlayerSettingsToggleRow({
            label: "Continuous mode",
            description: "When one release finishes, keep going to the next playable release in the feed.",
            checked: CONFIG.continuousMode,
            onChange: handleContinuousModeSettingChange,
        });

        const collectionCountsSetting = createPlayerSettingsToggleRow({
            label: "Collection counts",
            description: "Show how many collections a release appears in. Uses extra Bandcamp requests.",
            checked: CONFIG.showCollectionCounts,
            onChange: handleCollectionCountsSettingChange,
        });

        const tagSearchSetting = createPlayerSettingsToggleRow({
            label: "Tag search (experimental)",
            description: buildTagSearchSettingDescription(),
            checked: CONFIG.enableTagSearch,
            onChange: handleTagSearchSettingChange,
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
        settingsWrap.append(settingsButton, settingsMenu);

        controls.append(
            prevButton,
            nextButton,
            favoriteButton,
            releaseButton,
            settingsWrap,
        );

        const meta = document.createElement("div");
        meta.className = "bcampx-player-meta";

        const metaPrimary = document.createElement("div");
        metaPrimary.className = "bcampx-player-primary";
        const now = document.createElement("div");
        now.className = "bcampx-player-now";
        now.textContent = "Now Playing";

        const trackLink = document.createElement("a");
        trackLink.className = "bcampx-player-track";
        trackLink.href = "#";
        trackLink.draggable = false;
        trackLink.setAttribute("aria-label", "Scroll to current track");
        trackLink.textContent = "Select a preview track";
        trackLink.addEventListener("click", handlePlayerTrackLinkClick);
        trackLink.addEventListener("keydown", handlePlayerTrackLinkKeydown);

        metaPrimary.append(now, trackLink);

        const storeLink = document.createElement("a");
        storeLink.className = "bcampx-player-store";
        storeLink.href = "#";
        storeLink.target = "_blank";
        storeLink.rel = "noopener noreferrer";
        storeLink.textContent = "No track selected";

        meta.append(metaPrimary, storeLink);

        const nativeAudio = document.createElement("div");
        nativeAudio.className = "bcampx-player-native";

        shell.append(controls, meta, nativeAudio);
        shadowRoot.append(shell);
        appendToDocument(host);

        STATE.playerUi = {
            host,
            shadowRoot,
            shell,
            prevButton,
            nextButton,
            favoriteButton,
            releaseButton,
            settingsWrap,
            settingsButton,
            settingsMenu,
            trackRowActionsSettingInput: trackRowActionsSetting.input,
            autoFillPriceSettingInput: autoFillPriceSetting.input,
            continuousModeSettingInput: continuousModeSetting.input,
            collectionCountsSettingInput: collectionCountsSetting.input,
            tagSearchSettingInput: tagSearchSetting.input,
            tagSearchSettingDescription: tagSearchSetting.description,
            trackLink,
            storeLink,
            nativeAudio,
        };
        STATE.playerHost = host;

        syncPlayerShell();
        return STATE.playerUi;
    }

    function syncPlayerShell() {
        const ui = ensurePlayerShell();
        const audio = ensureSharedAudio();
        const hasTrack = Boolean(STATE.activeTrack && STATE.activeReleaseData);

        setBooleanPropertyIfChanged(ui.shell, "hidden", !hasTrack);
        if (!hasTrack && STATE.playerSettingsOpen) {
            closePlayerSettingsMenu();
        }
        toggleClassIfChanged(
            document.documentElement,
            "bcampx-player-active",
            hasTrack,
        );
        if (!hasTrack) {
            return;
        }

        const track = STATE.activeTrack;
        const data = STATE.activeReleaseData || {};
        const releaseUrl = STATE.activeReleaseUrl || "#";
        const navigationState = getPlayerNavigationState();
        ensureRemotePlayerWishlistState(releaseUrl);
        const favoriteState = getPlayerFavoriteState(releaseUrl);
        setBooleanPropertyIfChanged(
            ui.prevButton,
            "disabled",
            !navigationState.canGoPrev,
        );
        setBooleanPropertyIfChanged(
            ui.nextButton,
            "disabled",
            !navigationState.canGoNext,
        );
        applyPlayerFavoriteState(ui.favoriteButton, favoriteState);
        setBooleanPropertyIfChanged(
            ui.releaseButton,
            "disabled",
            !releaseUrl || releaseUrl === "#",
        );
        setTextContentIfChanged(
            ui.trackLink,
            `${data.artist || ""}${data.artist && track.title ? " - " : ""}${track.title || data.title || ""}` ||
                "Select a preview track",
        );
        setTextContentIfChanged(
            ui.storeLink,
            data.title && data.artist
                ? `${data.title} / ${data.artist}`
                : data.title || data.artist || "No track selected",
        );
        ui.storeLink.href = releaseUrl;
        attachSharedAudioToPlayer(ui.nativeAudio, audio);
    }

    function setTextContentIfChanged(node, text) {
        if (node && node.textContent !== text) {
            node.textContent = text;
        }
    }

    function setAttributeIfChanged(node, name, value) {
        if (node && node.getAttribute(name) !== value) {
            node.setAttribute(name, value);
        }
    }

    function setBooleanPropertyIfChanged(node, name, value) {
        if (node && Boolean(node[name]) !== Boolean(value)) {
            node[name] = Boolean(value);
        }
    }

    function toggleClassIfChanged(node, className, active) {
        if (
            node &&
            node.classList &&
            node.classList.contains(className) !== Boolean(active)
        ) {
            node.classList.toggle(className, Boolean(active));
        }
    }

    function handlePlayerTrackLinkClick(event) {
        event.preventDefault();
        void scrollToActiveTrackCard();
    }

    function handlePlayerTrackLinkKeydown(event) {
        if (event.key !== " " && event.key !== "Spacebar") {
            return;
        }

        event.preventDefault();
        void scrollToActiveTrackCard();
    }

    function getPlayerNavigationState() {
        const hasPreviousTrack =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                -1,
            ) >= 0;
        const hasNextTrack =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                1,
            ) >= 0;
        if (
            !CONFIG.continuousMode ||
            (hasPreviousTrack && hasNextTrack)
        ) {
            return {
                canGoPrev: hasPreviousTrack,
                canGoNext: hasNextTrack,
            };
        }

        const neighborState = getNeighborPlaybackAvailability();
        return {
            canGoPrev: hasPreviousTrack || neighborState.hasPrevious,
            canGoNext: hasNextTrack || neighborState.hasNext,
        };
    }

    function getPlayerFavoriteState(releaseUrl) {
        if (
            STATE.activeReleaseData &&
            isOwnedDigitalPrice(STATE.activeReleaseData.digitalPrice)
        ) {
            return {
                hidden: false,
                disabled: true,
                hasState: true,
                active: true,
                pending: false,
                owned: true,
            };
        }

        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
        const cachedState = normalizedReleaseUrl
            ? STATE.playerWishlistStateByUrl.get(normalizedReleaseUrl)
            : null;
        const hasCachedState =
            cachedState &&
            typeof cachedState === "object" &&
            cachedState.status === "known";

        // A known remote state outranks the local fallback: a feed sync may
        // unmount the card while its track keeps playing, and the button must
        // keep showing (and toggling) the real wishlist state.
        if (!hasCachedState && !shouldUseRemotePlayerWishlist()) {
            const wishlistControl = findActiveWishlistControl();
            return {
                hidden: false,
                disabled: !wishlistControl,
                hasState: true,
                active: isWishlistActive(wishlistControl),
                pending: false,
                owned: false,
            };
        }

        const hasPendingAction =
            !!normalizedReleaseUrl &&
            STATE.playerWishlistActionRequests.has(normalizedReleaseUrl);
        // The extension cannot run the wishlist helper on custom domains, so
        // leave the button disabled rather than letting a click time out.
        const helperUnavailable = !canRunTrackActionHelper(normalizedReleaseUrl);
        return {
            hidden: !normalizedReleaseUrl,
            disabled:
                !normalizedReleaseUrl ||
                helperUnavailable ||
                hasPendingAction ||
                !hasCachedState ||
                cachedState.canToggle === false,
            hasState: true,
            active: hasCachedState ? Boolean(cachedState.active) : false,
            pending: hasPendingAction,
            owned: false,
        };
    }

    function ensureRemotePlayerWishlistState(releaseUrl) {
        if (!shouldUseRemotePlayerWishlist()) {
            return null;
        }

        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
        if (!normalizedReleaseUrl) {
            return null;
        }

        const cachedState =
            STATE.playerWishlistStateByUrl.get(normalizedReleaseUrl);
        if (cachedState && typeof cachedState === "object") {
            if (cachedState.status === "known") {
                return null;
            }

            if (
                cachedState.status === "error" &&
                Date.now() - Number(cachedState.checkedAt || 0) <
                    PLAYER_WISHLIST_STATE_RETRY_MS
            ) {
                schedulePlayerWishlistStateRetry(normalizedReleaseUrl);
                return null;
            }

            STATE.playerWishlistStateByUrl.delete(normalizedReleaseUrl);
        }

        const existingRequest =
            STATE.playerWishlistStateRequests.get(normalizedReleaseUrl);
        if (existingRequest) {
            return existingRequest;
        }

        const request = fetchPlayerWishlistState(normalizedReleaseUrl)
            .then((result) => {
                const state = {
                    status: "known",
                    active: Boolean(result && result.active),
                    canToggle: Boolean(result && result.canToggle),
                    checkedAt: Date.now(),
                };
                STATE.playerWishlistStateByUrl.set(normalizedReleaseUrl, state);
                clearPlayerWishlistStateRetry(normalizedReleaseUrl);
                return state;
            })
            .catch((error) => {
                STATE.playerWishlistStateByUrl.set(normalizedReleaseUrl, {
                    status: "error",
                    active: false,
                    canToggle: false,
                    checkedAt: Date.now(),
                });
                recordTrackActionDiagnostic("wishlist-state-failed", {
                    releaseUrl: normalizedReleaseUrl,
                    error:
                        error && error.message
                            ? error.message
                            : "Wishlist state request failed.",
                });
                schedulePlayerWishlistStateRetry(normalizedReleaseUrl);
                return null;
            })
            .finally(() => {
                STATE.playerWishlistStateRequests.delete(normalizedReleaseUrl);
                if (
                    normalizeReleaseUrl(STATE.activeReleaseUrl || "") ===
                    normalizedReleaseUrl
                ) {
                    syncFavoriteButtonState();
                }
            });

        STATE.playerWishlistStateRequests.set(normalizedReleaseUrl, request);
        return request;
    }

    function schedulePlayerWishlistStateRetry(releaseUrl) {
        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
        if (
            !normalizedReleaseUrl ||
            STATE.playerWishlistStateRetryTimers.has(normalizedReleaseUrl)
        ) {
            return;
        }

        const timerId = window.setTimeout(() => {
            STATE.playerWishlistStateRetryTimers.delete(normalizedReleaseUrl);
            if (
                normalizeReleaseUrl(STATE.activeReleaseUrl || "") !==
                normalizedReleaseUrl
            ) {
                return;
            }

            const cachedState =
                STATE.playerWishlistStateByUrl.get(normalizedReleaseUrl);
            if (
                cachedState &&
                typeof cachedState === "object" &&
                cachedState.status === "error"
            ) {
                STATE.playerWishlistStateByUrl.delete(normalizedReleaseUrl);
            }

            ensureRemotePlayerWishlistState(normalizedReleaseUrl);
            syncFavoriteButtonState();
        }, PLAYER_WISHLIST_STATE_RETRY_MS);

        STATE.playerWishlistStateRetryTimers.set(normalizedReleaseUrl, timerId);
    }

    function clearPlayerWishlistStateRetry(releaseUrl) {
        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl || "");
        const timerId = normalizedReleaseUrl
            ? STATE.playerWishlistStateRetryTimers.get(normalizedReleaseUrl)
            : 0;
        if (!timerId) {
            return;
        }

        window.clearTimeout(timerId);
        STATE.playerWishlistStateRetryTimers.delete(normalizedReleaseUrl);
    }

    async function fetchPlayerWishlistState(releaseUrl) {
        try {
            const html = await requestHtml(releaseUrl);
            return parsePlayerWishlistStateFromHtml(html);
        } catch (_error) {
            return requestTrackActionViaHelper(
                "wishlist-state",
                releaseUrl,
                null,
            );
        }
    }

    function parsePlayerWishlistStateFromHtml(html) {
        const doc = htmlToDocument(html);
        const tralbumData = parseTralbumData(doc) || {};
        const collectInfo =
            parseJsonAttribute(
                doc.querySelector("[data-tralbum-collect-info]"),
                "data-tralbum-collect-info",
            ) || {};
        const pagedataBlob =
            parseJsonAttribute(
                doc.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
        const isWishlisted =
            !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
        const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
        const itemId =
            (tralbumData.current && tralbumData.current.id) ||
            collectInfo.collect_item_id ||
            "";
        const bandId =
            (tralbumData.current && tralbumData.current.band_id) ||
            collectInfo.collect_band_id ||
            "";

        return {
            ok: true,
            active: isWishlisted,
            canToggle: Boolean(fanId && itemId && bandId),
        };
    }

    function setFavoriteButtonState(button, active) {
        if (!button) {
            return;
        }

        toggleClassIfChanged(button, "active", active);
        setAttributeIfChanged(button, "aria-pressed", active ? "true" : "false");
        setAttributeIfChanged(
            button,
            "aria-label",
            active ? "Remove from wishlist" : "Add to wishlist",
        );
    }

    function togglePlayerSettingsMenu(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        STATE.playerSettingsOpen = !STATE.playerSettingsOpen;
        syncPlayerSettingsMenu();
    }

    function closePlayerSettingsMenu() {
        if (!STATE.playerSettingsOpen) {
            return;
        }

        STATE.playerSettingsOpen = false;
        syncPlayerSettingsMenu();
    }

    function syncPlayerSettingsMenu() {
        const ui = STATE.playerUi;
        if (!ui || !ui.settingsButton || !ui.settingsMenu) {
            return;
        }

        const open = !!STATE.playerSettingsOpen;
        setAttributeIfChanged(
            ui.settingsButton,
            "aria-expanded",
            open ? "true" : "false",
        );
        setAttributeIfChanged(
            ui.settingsButton,
            "aria-label",
            open ? "Close settings" : "Open settings",
        );
        setBooleanPropertyIfChanged(ui.settingsMenu, "hidden", !open);
        if (ui.trackRowActionsSettingInput) {
            setBooleanPropertyIfChanged(
                ui.trackRowActionsSettingInput,
                "checked",
                !!CONFIG.enableTrackRowActions,
            );
        }
        if (ui.autoFillPriceSettingInput) {
            setBooleanPropertyIfChanged(
                ui.autoFillPriceSettingInput,
                "checked",
                !!CONFIG.autoFillMinimumPrice,
            );
        }
        if (ui.continuousModeSettingInput) {
            setBooleanPropertyIfChanged(
                ui.continuousModeSettingInput,
                "checked",
                !!CONFIG.continuousMode,
            );
        }
        if (ui.collectionCountsSettingInput) {
            setBooleanPropertyIfChanged(
                ui.collectionCountsSettingInput,
                "checked",
                !!CONFIG.showCollectionCounts,
            );
        }
        refreshTagSearchSettingProgress();
        if (ui.tagSearchSettingInput) {
            setBooleanPropertyIfChanged(
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

    function handleTrackRowActionsSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.enableTrackRowActions = checked;
        refreshRenderedTrackActionButtons();
        syncPlayerSettingsMenu();
        void persistUserSettings();
    }

    function handleAutoFillMinimumPriceSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.autoFillMinimumPrice = checked;
        syncPlayerSettingsMenu();
        void persistUserSettings();
    }

    function handleContinuousModeSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.continuousMode = checked;
        syncPlayerSettingsMenu();
        syncPlayerShell();
        void persistUserSettings();
    }

    function handleCollectionCountsSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.showCollectionCounts = checked;
        refreshArtistMusicCollectionCounts();
        syncPlayerSettingsMenu();
        void persistUserSettings();
    }

    function buildTagSearchSettingDescription() {
        const base =
            "Also search your collection and wishlist by cached tags.";
        const progress =
            typeof getTagIndexProgress === "function"
                ? getTagIndexProgress()
                : null;
        const items = Number(progress && progress.items) || 0;
        if (!items) {
            return base;
        }
        const tagged = Number(progress && progress.tagged) || 0;
        return `${base} (${tagged}/${items})`;
    }

    function refreshTagSearchSettingProgress() {
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

    function handleTagSearchSettingChange(event) {
        const checked = !!(event && event.target && event.target.checked);
        CONFIG.enableTagSearch = checked;
        syncPlayerSettingsMenu();
        void persistUserSettings();
        applyTagSearchSetting();
    }

    function playPreviousTrack() {
        void playAdjacentTrackOrNeighbor(-1);
    }

    function playNextTrack() {
        void playAdjacentTrackOrNeighbor(1);
    }


    async function playAdjacentTrackOrNeighbor(offset) {
        if (playAdjacentTrack(offset)) {
            return true;
        }

        if (!CONFIG.continuousMode) {
            return false;
        }

        return playNeighborPlayableRelease(offset);
    }

    function playAdjacentTrack(offset) {
        if (
            !Array.isArray(STATE.activeTrackList) ||
            STATE.activeTrackIndex < 0
        ) {
            return false;
        }

        const nextIndex = findAdjacentPlayableTrackIndex(
            STATE.activeTrackList,
            STATE.activeTrackIndex,
            offset,
        );
        if (nextIndex < 0) {
            return false;
        }

        const nextTrack = STATE.activeTrackList[nextIndex];
        if (!nextTrack || !nextTrack.streamUrl) {
            return false;
        }

        const card = STATE.activeTrackCard;
        const cardArtUrl = getActiveCardArtUrl(card);
        STATE.activeTrackIndex = nextIndex;
        STATE.activeTrack = nextTrack;

        const audio = ensureSharedAudio();
        if (!audio) {
            return false;
        }

        audio.src = nextTrack.streamUrl;
        syncActiveTrackUi(cardArtUrl);
        audio.play().catch(() => {});
        syncFavoriteButtonState();
        return true;
    }

    function findAdjacentPlayableTrackIndex(tracks, startIndex, offset) {
        if (!Array.isArray(tracks) || !tracks.length || !offset) {
            return -1;
        }

        const step = offset > 0 ? 1 : -1;
        let index = startIndex + step;
        while (index >= 0 && index < tracks.length) {
            const track = tracks[index];
            if (track && track.streamUrl) {
                return index;
            }
            index += step;
        }

        return -1;
    }

    async function continuePlaybackAfterTrackEnd() {
        const audio = ensureSharedAudio();
        if (!audio || !audio.ended) {
            return false;
        }

        if (playAdjacentTrack(1)) {
            return true;
        }

        if (!CONFIG.continuousMode) {
            return false;
        }

        return playNeighborPlayableRelease(1);
    }

    async function playNeighborPlayableRelease(offset) {
        const neighbors = getNeighborPlayableReleases(offset);
        if (!neighbors.length) {
            return false;
        }

        for (const neighbor of neighbors) {
            try {
                const preview =
                    neighbor.playbackScope === "collection-grid"
                        ? getCollectionGridFeaturedPreview(neighbor.card)
                        : null;
                const data = preview
                    ? preview.data
                    : await getAvailableOrFetchReleaseDataForCard(
                          neighbor.card,
                          neighbor.releaseUrl,
                      );
                const track =
                    preview
                        ? preview.track
                        : neighbor.playbackScope === "collection-grid"
                        ? findFeaturedTrackForCard(neighbor.card, null, data)
                        : offset < 0
                          ? findLastPlayableTrack(data)
                          : findFeaturedTrackForCard(neighbor.card, null, data) ||
                            findFirstPlayableTrack(data);
                if (!track || !track.streamUrl) {
                    continue;
                }

                playTrackForCard(
                    neighbor.card,
                    null,
                    track,
                    data,
                    neighbor.releaseUrl,
                    neighbor.playbackScope === "collection-grid"
                        ? {
                              playbackScope: "collection-grid",
                              trackList: [track],
                          }
                        : {},
                );
                if (neighbor.playbackScope === "collection-grid") {
                    observeCollectionCoverState();
                }
                return true;
            } catch (_error) {
                continue;
            }
        }

        return false;
    }

    function findNeighborPlayableRelease(offset) {
        const neighbors = getNeighborPlayableReleases(offset);
        return neighbors.length ? neighbors[0] : null;
    }

    function getNeighborPlayableReleases(offset) {
        const currentCard = getStoryRoot(STATE.activeTrackCard) || STATE.activeTrackCard;
        if (!(currentCard instanceof Element) || !offset) {
            return [];
        }

        const collectionGridPlayback = findCollectionGridCard(currentCard);
        const cards = collectionGridPlayback
            ? getCollectionGridPlaybackCards(currentCard)
            : getStoryCardsFromRoots([document]);
        const currentIndex = cards.indexOf(currentCard);
        if (currentIndex < 0) {
            return [];
        }

        const neighbors = [];
        const step = offset > 0 ? 1 : -1;
        for (
            let index = currentIndex + step;
            index >= 0 && index < cards.length;
            index += step
        ) {
            const card = cards[index];
            if (
                collectionGridPlayback
                    ? !isCollectionGridPlaybackCandidate(card)
                    : !isContinuousPlaybackCandidate(card)
            ) {
                continue;
            }

            const releaseUrl = getCardPrimaryReleaseUrl(card);
            const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
            if (
                !normalizedReleaseUrl ||
                normalizedReleaseUrl === normalizeReleaseUrl(STATE.activeReleaseUrl || "")
            ) {
                continue;
            }

            neighbors.push({
                card,
                releaseUrl: normalizedReleaseUrl,
                playbackScope: collectionGridPlayback
                    ? "collection-grid"
                    : "",
            });
        }

        return neighbors;
    }

    function getNeighborPlaybackAvailability() {
        const currentCard = getStoryRoot(STATE.activeTrackCard) || STATE.activeTrackCard;
        if (!(currentCard instanceof Element)) {
            return { hasPrevious: false, hasNext: false };
        }

        const collectionGridPlayback = findCollectionGridCard(currentCard);
        const cards = collectionGridPlayback
            ? getCollectionGridPlaybackCards(currentCard)
            : getStoryCardsFromRoots([document]);
        const currentIndex = cards.indexOf(currentCard);
        if (currentIndex < 0) {
            return { hasPrevious: false, hasNext: false };
        }

        return {
            hasPrevious: hasNeighborPlaybackCandidate(
                cards,
                currentIndex,
                -1,
                collectionGridPlayback,
            ),
            hasNext: hasNeighborPlaybackCandidate(
                cards,
                currentIndex,
                1,
                collectionGridPlayback,
            ),
        };
    }

    function hasNeighborPlaybackCandidate(
        cards,
        currentIndex,
        offset,
        collectionGridPlayback,
    ) {
        const step = offset > 0 ? 1 : -1;
        const activeReleaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        for (
            let index = currentIndex + step;
            index >= 0 && index < cards.length;
            index += step
        ) {
            const card = cards[index];
            if (
                collectionGridPlayback
                    ? !isCollectionGridPlaybackCandidate(card)
                    : !isContinuousPlaybackCandidate(card)
            ) {
                continue;
            }

            const releaseUrl = normalizeReleaseUrl(getCardPrimaryReleaseUrl(card));
            if (releaseUrl && releaseUrl !== activeReleaseUrl) {
                return true;
            }
        }

        return false;
    }

    function getCollectionGridPlaybackCards(card) {
        const grid = card && card.closest(".collection-grid");
        if (!grid) {
            return [];
        }

        return Array.from(
            grid.querySelectorAll(".collection-item-container"),
        ).filter((item) => item instanceof Element);
    }

    function isCollectionGridPlaybackCandidate(card) {
        if (!(card instanceof Element) || isFullDiscographyCard(card)) {
            return false;
        }

        const releaseUrl = normalizeReleaseUrl(getCardPrimaryReleaseUrl(card));
        if (!releaseUrl) {
            return false;
        }

        return !(
            isWebExtensionHost() &&
            isCustomDomainReleaseUrl(releaseUrl) &&
            !hasExtensionHostPermission(releaseUrl)
        );
    }

    function isContinuousPlaybackCandidate(card) {
        if (!(card instanceof Element)) {
            return false;
        }

        if (
            card.closest(EXCLUDED_SECTION_SELECTOR) ||
            isFullDiscographyCard(card) ||
            isMalformedFeedCard(card) ||
            isAlsoBoughtRecommendationCard(card) ||
            card.getAttribute(MERGED_CHILD_ATTR) === "true"
        ) {
            return false;
        }

        const releaseUrl = normalizeReleaseUrl(getCardPrimaryReleaseUrl(card));
        if (!releaseUrl) {
            return false;
        }

        if (
            isWebExtensionHost() &&
            isCustomDomainReleaseUrl(releaseUrl) &&
            !hasExtensionHostPermission(releaseUrl)
        ) {
            return false;
        }

        return true;
    }

    async function getAvailableOrFetchReleaseDataForCard(card, releaseUrl) {
        const available = getAvailableReleaseDataForCard(card, releaseUrl);
        if (available) {
            return available;
        }

        const result = await getReleaseData(
            getCardReleaseRequestContext(card, releaseUrl),
        );
        const controller = getCardController(card);
        if (controller) {
            controller.loaded = true;
            controller.data = result.data;
        }
        return result.data;
    }

    function findFirstPlayableTrack(data) {
        const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
        return tracks.find((track) => track && track.streamUrl) || null;
    }

    function findLastPlayableTrack(data) {
        const tracks = data && Array.isArray(data.tracks) ? data.tracks : [];
        for (let index = tracks.length - 1; index >= 0; index -= 1) {
            const track = tracks[index];
            if (track && track.streamUrl) {
                return track;
            }
        }
        return null;
    }

    function syncTrackButtonsForActiveTrack() {
        clearActiveTrackButton();
        const streamUrl = STATE.activeTrack && STATE.activeTrack.streamUrl;
        if (!streamUrl) {
            return;
        }

        const selector = ".bcampx__track-link, .bcampx__merge-track-button";
        const roots = [
            STATE.activeTrackCard,
            STATE.activeTrackCard &&
                STATE.activeTrackCard.querySelector(".bcampx"),
            document,
        ].filter(Boolean);

        let activeButton = null;
        for (const root of roots) {
            activeButton = Array.from(root.querySelectorAll(selector)).find(
                (button) => button.dataset.streamUrl === streamUrl,
            );
            if (activeButton) {
                break;
            }
        }

        if (activeButton) {
            setActiveTrackButton(activeButton);
        }
    }

    function openActiveRelease() {
        if (!STATE.activeReleaseUrl) {
            return;
        }

        window.open(STATE.activeReleaseUrl, "_blank", "noopener");
    }

    async function scrollToActiveTrackCard() {
        await activateActiveTrackFanGrid();
        const activeCard =
            getConnectedActiveTrackCard() ||
            findActiveTrackCardByRelease();
        if (!activeCard) {
            return;
        }

        STATE.activeTrackCard = activeCard;
        scrollCardIntoView(activeCard, STATE.activeTrack);
    }

    async function activateActiveTrackFanGrid() {
        const grid = STATE.activeTrackFanGridNode;
        if (
            !(grid instanceof Element) ||
            !grid.isConnected ||
            grid.classList.contains("active")
        ) {
            return;
        }

        const tab = grid.id
            ? document.querySelector(
                  `[data-grid-id="${CSS.escape(grid.id)}"]`,
              )
            : null;
        if (!(tab instanceof HTMLElement)) {
            return;
        }

        tab.click();
        scheduleFanCollectionFeedContextSync();
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 25));
            if (
                grid.classList.contains("active") &&
                findActiveTrackCardByRelease()
            ) {
                return;
            }
        }
    }

    function findActiveTrackCardByRelease() {
        const releaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        if (!releaseUrl) {
            return null;
        }

        const grid = STATE.activeTrackFanGridNode;
        const root =
            grid instanceof Element && grid.isConnected ? grid : document;
        return (
            Array.from(
                root.querySelectorAll(
                    ".bcampx-label-feed-card[data-bcampx-release-url]",
                ),
            ).find(
                (card) =>
                    normalizeReleaseUrl(
                        card.getAttribute("data-bcampx-release-url") || "",
                    ) === releaseUrl,
            ) || null
        );
    }

    function attachSharedAudioToPlayer(container, audio) {
        if (!container || !audio) {
            return;
        }

        if (audio.parentElement === container) {
            return;
        }

        audio.controls = true;
        audio.preload = "metadata";
        audio.classList.add("bcampx-player-audio");
        audio.style.display = "block";
        audio.style.visibility = "visible";
        audio.style.opacity = "1";
        audio.style.width = "100%";
        audio.style.height = "38px";
        audio.style.position = "static";
        audio.style.pointerEvents = "auto";
        if (audio.parentElement !== container) {
            container.textContent = "";
            container.append(audio);
        }
    }

    function getPlayerShellStyles() {
        return PLAYER_SHELL_CSS;
    }

    function pauseBandcampPageAudio() {
        if (!STATE.pageAudio) {
            STATE.pageAudio =
                document.querySelector("body > audio") ||
                document.querySelector("audio") ||
                null;
        }
        if (
            STATE.pageAudio &&
            STATE.pageAudio !== STATE.sharedAudio &&
            typeof STATE.pageAudio.pause === "function"
        ) {
            STATE.pageAudio.pause();
        }
    }

    function findActiveWishlistControl() {
        const activeCard = getConnectedActiveTrackCard();
        if (!activeCard) {
            return null;
        }

        const collectRoot =
            activeCard.querySelector(".collect-item") ||
            activeCard.querySelector(
                ".tralbum-wrapper-collect-controls",
            ) ||
            activeCard;

        if (!collectRoot) {
            return null;
        }

        return (
            findVisibleNode(collectRoot, ".wishlisted-msg") ||
            findVisibleNode(collectRoot, ".wishlist-msg") ||
            Array.from(collectRoot.querySelectorAll("a, button")).find(
                (node) =>
                    isNodeVisible(node) &&
                    /^\s*in wishlist\s*$/i.test(
                        (node.textContent || "").trim(),
                    ),
            ) ||
            Array.from(collectRoot.querySelectorAll("a, button")).find(
                (node) =>
                    isNodeVisible(node) &&
                    /^\s*wishlist\s*$/i.test((node.textContent || "").trim()),
            ) ||
            Array.from(collectRoot.querySelectorAll("a, button")).find(
                (node) =>
                    isNodeVisible(node) &&
                    /wishlist/i.test((node.textContent || "").trim()),
            )
        );
    }

    function isWishlistActive(control) {
        if (!control) {
            return false;
        }

        const text = (control.textContent || "").trim();
        const ariaPressed = control.getAttribute("aria-pressed");
        return (
            /in wishlist/i.test(text) ||
            ariaPressed === "true" ||
            control.classList.contains("added") ||
            (control.classList.contains("wishlisted-msg") &&
                isNodeVisible(control))
        );
    }

    function findVisibleNode(root, selector) {
        return (
            Array.from(root.querySelectorAll(selector)).find((node) =>
                isNodeVisible(node),
            ) || null
        );
    }

    function isNodeVisible(node) {
        if (!node) {
            return false;
        }

        const style = window.getComputedStyle(node);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity || "1") === 0
        ) {
            return false;
        }

        return Boolean(node.offsetParent || node.getClientRects().length);
    }

    function syncFavoriteButtonState() {
        const ui = STATE.playerUi;
        if (!ui || !ui.favoriteButton) {
            return;
        }

        if (shouldUseRemotePlayerWishlist()) {
            ensureRemotePlayerWishlistState(STATE.activeReleaseUrl || "");
        }

        applyPlayerFavoriteState(
            ui.favoriteButton,
            getPlayerFavoriteState(STATE.activeReleaseUrl || ""),
        );
    }

    function applyPlayerFavoriteState(button, state) {
        if (!button || !state) {
            return;
        }

        toggleClassIfChanged(
            button,
            "bcampx-player-favorite--owned",
            Boolean(state.owned),
        );
        setBooleanPropertyIfChanged(button, "hidden", state.hidden);
        setBooleanPropertyIfChanged(button, "disabled", state.disabled);
        toggleClassIfChanged(
            button,
            "bcampx-player-button--pending",
            Boolean(state.pending),
        );
        if (state.hasState) {
            setFavoriteButtonState(button, state.active);
        }
    }

    function toggleActiveWishlist() {
        const ui = STATE.playerUi;
        if (shouldUseRemotePlayerWishlist()) {
            void toggleActiveRemoteWishlist();
            return;
        }

        const wishlistControl = findActiveWishlistControl();
        if (!wishlistControl) {
            return;
        }

        if (ui && ui.favoriteButton) {
            const nextActive =
                ui.favoriteButton.getAttribute("aria-pressed") !== "true";
            setFavoriteButtonState(ui.favoriteButton, nextActive);
        }

        wishlistControl.click();
        window.setTimeout(syncFavoriteButtonState, 60);
        window.setTimeout(syncFavoriteButtonState, 260);
        window.setTimeout(syncFavoriteButtonState, 700);
    }

    function shouldUseRemotePlayerWishlist() {
        if (isArtistMusicPage()) {
            return true;
        }

        const activeCard = getConnectedActiveTrackCard();
        if (
            activeCard &&
            activeCard.closest &&
            activeCard.closest(".bcampx-label-feed-card")
        ) {
            return true;
        }

        // A feed sync can unmount the card while its track keeps playing (for
        // example after switching to another fan tab). The release still
        // belongs to a fan feed, and the helper is the only way to toggle it,
        // so keep using the remote state for the release URL we are playing.
        const releaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        const fanGrid = STATE.activeTrackFanGridNode;
        return Boolean(
            releaseUrl &&
                fanGrid instanceof Element &&
                fanGrid.isConnected,
        );
    }

    async function toggleActiveRemoteWishlist() {
        const ui = STATE.playerUi;
        const releaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        if (!ui || !ui.favoriteButton || !releaseUrl) {
            return;
        }

        const favoriteState = getPlayerFavoriteState(releaseUrl);
        if (favoriteState.disabled) {
            ensureRemotePlayerWishlistState(releaseUrl);
            return;
        }

        const desiredActive =
            ui.favoriteButton.getAttribute("aria-pressed") !== "true";
        STATE.playerWishlistActionRequests.add(releaseUrl);
        setTrackActionButtonPending(ui.favoriteButton, true);
        try {
            await requestTrackActionViaHelper(
                "wishlist",
                releaseUrl,
                ui.favoriteButton,
                { desiredActive },
            );
        } catch (_error) {
            STATE.playerWishlistActionRequests.delete(releaseUrl);
            setTrackActionButtonPending(ui.favoriteButton, false);
        }
    }

    function ensureWaypointPlayPauseButton(waypoint) {
        if (!waypoint) {
            return null;
        }

        let button = waypoint.querySelector(".bcampx__waypoint-toggle");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "bcampx__waypoint-toggle";
            button.setAttribute("aria-label", "Pause");
            button.addEventListener("click", handleWaypointToggleClick);
            waypoint.append(button);
        }

        updateWaypointPlayPauseButton(button);
        return button;
    }

    function handleWaypointToggleClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const audio = ensureSharedAudio();
        if (!audio) {
            return;
        }

        if (audio.paused) {
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    }

    function updateWaypointPlayPauseButton(existingButton) {
        const waypoint = document.querySelector("#track_play_waypoint");
        if (!waypoint) {
            return;
        }

        const button =
            existingButton ||
            waypoint.querySelector(".bcampx__waypoint-toggle");
        if (!button) {
            return;
        }

        const audio = ensureSharedAudio();
        const isPaused = !audio || audio.paused;
        setTextContentIfChanged(button, isPaused ? "Play" : "Pause");
        setAttributeIfChanged(
            button,
            "aria-label",
            isPaused ? "Play" : "Pause",
        );
        toggleClassIfChanged(button, "bcampx__waypoint-toggle--paused", isPaused);
    }

