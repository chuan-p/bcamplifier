// ==UserScript==
// @name         BC Amplifier
// @namespace    https://github.com/local/bcamplifier
// @version      0.1.88
// @description  Enrich Bandcamp feed cards with release metadata, tags, descriptions, and track previews.
// @author       chuanpeng
// @match        https://bandcamp.com/feed*
// @match        https://bandcamp.com/*/feed*
// @match        https://bandcamp.com/*
// @match        https://*.bandcamp.com/*
// @updateURL    http://127.0.0.1:8000/bcamplifier.user.js
// @downloadURL  http://127.0.0.1:8000/bcamplifier.user.js
// @connect      bandcamp.com
// @connect      *.bandcamp.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    autoFetchOnVisible: true,
    expandAfterAutoFetch: true,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    fetchTimeoutMs: 15000,
    maxTracks: 40,
    initialVisibleTracks: 6,
    maxDescriptionLength: 420,
    observerRootMargin: "450px 0px",
    scanDebounceMs: 160,
    minFanActivityCardWidth: 420,
    autoExpandTracks: false,
  };

  const CACHE_SCHEMA_VERSION = 7;
  const RELEASE_CACHE_PREFIX = "bcampx:release:";
  const GLOBAL_PLAYBACK_KEY = "bcampx:globalPlaybackOwner";
  const GLOBAL_PLAYBACK_HEARTBEAT_MS = 1500;
  const GLOBAL_PLAYBACK_STALE_MS = 4500;

  const STATE = {
    initialized: false,
    globalBridgeInitialized: false,
    scanTimer: 0,
    observer: null,
    mutationObserver: null,
    sharedAudio: null,
    pageAudio: null,
    activeTrackButton: null,
    activeTrackCard: null,
    waypointNode: null,
    activeTrack: null,
    activeTrackIndex: -1,
    activeTrackList: [],
    activeReleaseData: null,
    activeReleaseUrl: "",
    coverPlaybackStateNode: null,
    playerUi: null,
    playerHost: null,
    tabId: `bcampx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    playbackHeartbeatTimer: 0,
    playbackMonitorTimer: 0,
    claimedPlaybackKind: "",
    claimedPlaybackSource: null,
  };

  const RELEASE_LINK_SELECTOR = [
    'a[href*="/album/"]',
    'a[href*="/track/"]',
  ].join(",");

  const SUPPORTED_SLOT_SELECTOR = [
    ".story-body .tralbum-wrapper .tralbum-wrapper-col2.tralbum-owners",
    ".tralbum-wrapper .tralbum-wrapper-col2.tralbum-owners",
    ".tralbum-wrapper-col2.tralbum-owners",
  ].join(",");

  const CONTENT_COLUMN_SELECTOR = [
    ".story-body .tralbum-wrapper .tralbum-wrapper-col1",
    ".tralbum-wrapper .tralbum-wrapper-col1",
    ".tralbum-wrapper-col1",
  ].join(",");

  const CARD_SELECTOR = [
    "article",
    "li",
    ".feed-item",
    ".feedItem",
    ".feed_item",
    ".feed-story",
    ".feedStory",
    ".story",
    ".activity",
    ".activity-item",
    ".collection-item",
    ".fan-feed-item",
    ".item",
  ].join(",");

  const ENHANCED_ATTR = "data-bcampx-enhanced";
  const OBSERVED_ATTR = "data-bcampx-observed";
  const HIDDEN_SUPPORTED_ATTR = "data-bcampx-supported-hidden";
  const MERGED_PARENT_ATTR = "data-bcampx-merged-parent";
  const MERGED_CHILD_ATTR = "data-bcampx-merged-child";
  const FAN_ACTIVITY_TEXT_PATTERN = /\b(bought|purchased|wishlisted|supported|recommended|following|followed|listening|played|posted|added)\b/i;
  const EXCLUDED_SECTION_SELECTOR = [
    "#sidebar",
    "aside",
    '[role="complementary"]',
    ".sidebar",
    ".side-bar",
    ".side_module",
    ".right-column",
    ".right_col",
    ".rightCol",
    ".discover",
    ".recommended",
    ".new-releases",
    ".new_releases",
  ].join(",");

  const FAVORITE_ICON_MARKUP = [
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">',
    '<path class="bcampx-player-favorite-outline" d="M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path class="bcampx-player-favorite-fill" d="M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z" fill="currentColor"/>',
    "</svg>",
  ].join("");

  const OPEN_ICON_MARKUP = [
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">',
    '<path d="M7 13 13 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    '<path d="M8.2 6.8H14v5.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    "</svg>",
  ].join("");

  init();

  function init() {
    setupGlobalPlaybackBridge();

    if (STATE.initialized || !isFeedPage()) {
      return;
    }

    STATE.initialized = true;
    setupSharedAudio();
    setupWaypointNavigation();
    setupNativePlaybackInterception();
    injectStyles();
    ensurePlayerShell();
    setupIntersectionObserver();
    scanForCards();
    setupMutationObserver();
  }

  function setupGlobalPlaybackBridge() {
    if (STATE.globalBridgeInitialized) {
      return;
    }

    STATE.globalBridgeInitialized = true;
    document.addEventListener("play", handleDocumentAudioPlay, true);
    document.addEventListener("pause", handleDocumentAudioStop, true);
    document.addEventListener("ended", handleDocumentAudioStop, true);
    STATE.playbackMonitorTimer = window.setInterval(checkForForeignPlayback, 900);
  }

  function setupSharedAudio() {
    if (STATE.sharedAudio) {
      return;
    }

    STATE.pageAudio = document.querySelector("body > audio") || document.querySelector("audio") || null;
    if (STATE.pageAudio) {
      STATE.pageAudio.addEventListener("play", suppressNativePageAudio, true);
    }
    STATE.sharedAudio = document.createElement("audio");
    STATE.sharedAudio.preload = "metadata";
    STATE.sharedAudio.controls = true;
    STATE.sharedAudio.addEventListener("pause", syncActiveTrackButton);
    STATE.sharedAudio.addEventListener("play", syncActiveTrackButton);
    STATE.sharedAudio.addEventListener("ended", syncActiveTrackButton);
    STATE.sharedAudio.addEventListener("timeupdate", syncPlayerShell);
    STATE.sharedAudio.addEventListener("loadedmetadata", syncPlayerShell);
    STATE.sharedAudio.addEventListener("durationchange", syncPlayerShell);
    STATE.sharedAudio.addEventListener("volumechange", syncPlayerShell);
    STATE.sharedAudio.addEventListener("play", () => claimPlaybackOwnership("feed-preview", STATE.sharedAudio));
    STATE.sharedAudio.addEventListener("pause", () => releasePlaybackOwnershipIfCurrent(STATE.sharedAudio));
    STATE.sharedAudio.addEventListener("ended", () => releasePlaybackOwnershipIfCurrent(STATE.sharedAudio));
  }

  function handleDocumentAudioPlay(event) {
    const audio = event.target;
    if (!(audio instanceof HTMLAudioElement)) {
      return;
    }

    if (audio === STATE.sharedAudio) {
      return;
    }

    if (isFeedPage() && audio === STATE.pageAudio) {
      return;
    }

    claimPlaybackOwnership("bandcamp-native", audio);
  }

  function handleDocumentAudioStop(event) {
    const audio = event.target;
    if (!(audio instanceof HTMLAudioElement)) {
      return;
    }

    releasePlaybackOwnershipIfCurrent(audio);
  }

  function claimPlaybackOwnership(kind, source) {
    STATE.claimedPlaybackKind = kind || "";
    STATE.claimedPlaybackSource = source || null;
    void publishPlaybackHeartbeat();
    startPlaybackHeartbeat();
  }

  function startPlaybackHeartbeat() {
    window.clearInterval(STATE.playbackHeartbeatTimer);
    STATE.playbackHeartbeatTimer = window.setInterval(() => {
      void publishPlaybackHeartbeat();
    }, GLOBAL_PLAYBACK_HEARTBEAT_MS);
  }

  async function publishPlaybackHeartbeat() {
    if (!STATE.claimedPlaybackKind) {
      return;
    }

    await storageSet(GLOBAL_PLAYBACK_KEY, {
      tabId: STATE.tabId,
      kind: STATE.claimedPlaybackKind,
      pageUrl: window.location.href,
      ts: Date.now(),
    });
  }

  async function releasePlaybackOwnershipIfCurrent(source) {
    if (source && STATE.claimedPlaybackSource && source !== STATE.claimedPlaybackSource) {
      return;
    }

    const current = await storageGet(GLOBAL_PLAYBACK_KEY, null);
    if (current && current.tabId === STATE.tabId) {
      await storageSet(GLOBAL_PLAYBACK_KEY, {
        tabId: "",
        kind: "",
        pageUrl: "",
        ts: 0,
      });
    }

    STATE.claimedPlaybackKind = "";
    STATE.claimedPlaybackSource = null;
    window.clearInterval(STATE.playbackHeartbeatTimer);
    STATE.playbackHeartbeatTimer = 0;
  }

  async function checkForForeignPlayback() {
    const activeAudios = getLocalActiveAudios();
    if (!activeAudios.length) {
      return;
    }

    const current = await storageGet(GLOBAL_PLAYBACK_KEY, null);
    if (!current || !current.tabId || current.tabId === STATE.tabId) {
      return;
    }

    if (!current.ts || Date.now() - current.ts > GLOBAL_PLAYBACK_STALE_MS) {
      return;
    }

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
    document.addEventListener("click", handleNativePlaybackTriggerClick, true);
  }

  function handleNativePlaybackTriggerClick(event) {
    const trigger = findNativePlaybackTrigger(event.target);
    if (!trigger) {
      return;
    }

    const card = findPlaybackCard(trigger);
    if (!card || isFullDiscographyCard(card) || card.closest("#sidebar")) {
      return;
    }

    const releaseUrl = getCardPrimaryReleaseUrl(card);
    if (!releaseUrl) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    playNativeCardTrigger(card, trigger, releaseUrl);
  }

  function findNativePlaybackTrigger(node) {
    if (!node || typeof node.closest !== "function") {
      return null;
    }

    return node.closest(".track_play_auxiliary, .tralbum-art-container, .track_play_time");
  }

  async function playNativeCardTrigger(card, trigger, releaseUrl) {
    const controller = ensureCardController(card, releaseUrl);
    if (!controller) {
      return;
    }

    if (isActiveReleaseForCard(releaseUrl) && STATE.activeTrack && STATE.activeTrack.streamUrl) {
      toggleActiveReleasePlayback(card);
      return;
    }

    try {
      if ((!controller.data || !Array.isArray(controller.data.tracks) || !controller.data.tracks.length) && !controller.loading) {
        await controller.fetchAndRender({ auto: false });
      }
    } catch (_error) {
      return;
    }

    const data = controller.data;
    const track = findFeaturedTrackForCard(card, trigger, data);
    if (!track || !track.streamUrl) {
      return;
    }

    playTrackForCard(card, null, track, data, releaseUrl);
  }

  function isActiveReleaseForCard(releaseUrl) {
    const normalizedTarget = normalizeReleaseUrl(releaseUrl);
    const normalizedActive = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
    return Boolean(normalizedTarget && normalizedActive && normalizedTarget === normalizedActive);
  }

  function toggleActiveReleasePlayback(card) {
    const audio = ensureSharedAudio();
    if (!audio || !STATE.activeTrack || !STATE.activeTrack.streamUrl) {
      return;
    }

    const cardArtUrl = getActiveCardArtUrl(card);
    setActiveTrackCard(card);

    if (STATE.activeReleaseData && cardArtUrl) {
      STATE.activeReleaseData.__bcampxCardArtUrl = cardArtUrl;
    }

    if (!audio.paused) {
      audio.pause();
      syncCoverPlaybackState();
      syncPlayerShell();
      return;
    }

    pauseBandcampPageAudio();
    syncActiveTrackUi(cardArtUrl);
    audio.play().catch(() => {});
  }

  function ensureCardController(card, releaseUrl) {
    if (card && card.__bcampxController) {
      return card.__bcampxController;
    }

    if (!card || card.hasAttribute(ENHANCED_ATTR)) {
      return card ? card.__bcampxController || null : null;
    }

    enhanceCard(card, releaseUrl);
    return card.__bcampxController || null;
  }

  function getCardPrimaryReleaseUrl(card) {
    const albumLink = Array.from(card.querySelectorAll('a[href*="/album/"]'))
      .map((link) => normalizeReleaseUrl(link.href))
      .find(Boolean);
    if (albumLink) {
      return albumLink;
    }

    return Array.from(card.querySelectorAll(RELEASE_LINK_SELECTOR))
      .map((link) => normalizeReleaseUrl(link.href))
      .find(Boolean) || "";
  }

  function findFeaturedTrackForCard(card, trigger, data) {
    if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
      return null;
    }

    const triggerWithTrackId = trigger && trigger.closest ? trigger.closest("[data-trackid]") : null;
    const triggerTrackId = cleanText(triggerWithTrackId && triggerWithTrackId.getAttribute("data-trackid"));
    if (triggerTrackId) {
      const exactTrack = data.tracks.find((track) => cleanText(track && track.trackId) === triggerTrackId && track.streamUrl);
      if (exactTrack) {
        return exactTrack;
      }
    }

    const featuredTitle = extractFeaturedTrackTitle(card);
    if (featuredTitle) {
      const normalizedFeaturedTitle = cleanText(featuredTitle).toLowerCase();
      const titleMatch = data.tracks.find((track) => cleanText(track && track.title).toLowerCase() === normalizedFeaturedTitle && track.streamUrl);
      if (titleMatch) {
        return titleMatch;
      }

      const fuzzyTitleMatch = data.tracks.find((track) => cleanText(track && track.title).toLowerCase().includes(normalizedFeaturedTitle) && track.streamUrl);
      if (fuzzyTitleMatch) {
        return fuzzyTitleMatch;
      }
    }

    return data.tracks.find((track) => track && track.streamUrl) || null;
  }

  function extractFeaturedTrackTitle(card) {
    const featuredLine = findElementByText(card, "div, p, li, section, span", /^featured track\s*:/i);
    if (!featuredLine) {
      return "";
    }

    const inlineLink = featuredLine.querySelector('a[href*="/track/"]');
    if (inlineLink) {
      return normalizedText(inlineLink);
    }

    return cleanText((featuredLine.textContent || "").replace(/^featured track\s*:/i, ""));
  }

  function suppressNativePageAudio() {
    if (STATE.pageAudio && STATE.pageAudio !== STATE.sharedAudio && typeof STATE.pageAudio.pause === "function") {
      STATE.pageAudio.pause();
    }
  }

  function isFeedPage() {
    return /(^|\/)feed\/?$/.test(window.location.pathname) || /\/feed\//.test(window.location.pathname);
  }

  function setupIntersectionObserver() {
    if (!("IntersectionObserver" in window) || !CONFIG.autoFetchOnVisible) {
      return;
    }

    STATE.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const card = entry.target;
          STATE.observer.unobserve(card);
          const controller = card.__bcampxController;
          if (controller && !controller.loaded && !controller.loading) {
            controller.fetchAndRender({ auto: true });
          }
        });
      },
      { rootMargin: CONFIG.observerRootMargin }
    );
  }

  function setupMutationObserver() {
    if (!("MutationObserver" in window) || !document.body) {
      return;
    }

    STATE.mutationObserver = new MutationObserver((mutations) => {
      const hasAddedNodes = mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length);
      if (hasAddedNodes) {
        scheduleScan();
      }
    });

    STATE.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function scheduleScan() {
    window.clearTimeout(STATE.scanTimer);
    STATE.scanTimer = window.setTimeout(scanForCards, CONFIG.scanDebounceMs);
  }

  function scanForCards() {
    document.querySelectorAll(RELEASE_LINK_SELECTOR).forEach((link) => {
      const releaseUrl = normalizeReleaseUrl(link.href);
      if (!releaseUrl || !isFanActivityLink(link)) {
        return;
      }

      const card = findCardRoot(link);
      if (!card || card.hasAttribute(ENHANCED_ATTR)) {
        return;
      }

      if (card.closest("#sidebar")) {
        return;
      }

      if (isFullDiscographyCard(card)) {
        return;
      }

      enhanceCard(card, releaseUrl);
    });

    mergeAdjacentTrackPurchaseCards();
  }

  function isFullDiscographyCard(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    const root =
      node.closest(".story-innards") ||
      node.closest("li.story") ||
      node.closest(".story") ||
      node.closest(CARD_SELECTOR) ||
      node;

    if (!(root instanceof Element)) {
      return false;
    }

    if (root.querySelector('a.item-link[href*="#buyFullDiscography"], a[href*="#buyFullDiscography"]')) {
      return true;
    }

    const titleNode = root.querySelector(".collection-item-title, .item-title");
    if (titleNode && /\bfull(?:\s+digital)?\s+discography\b/i.test(normalizedText(titleNode))) {
      return true;
    }

    const storyTitle = root.querySelector(".story-title");
    if (storyTitle && /\bfull\s+discography\b/i.test(normalizedText(storyTitle))) {
      return true;
    }

    return Boolean(root.querySelector(".bundle-art-container") && root.querySelector(".bundle-releases"));
  }

  function mergeAdjacentTrackPurchaseCards() {
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR)).filter((card) => {
      return looksLikeFeedCard(card) && !card.closest(EXCLUDED_SECTION_SELECTOR);
    });

    let previousCandidate = null;
    cards.forEach((card) => {
      if (card.getAttribute(MERGED_CHILD_ATTR) === "true") {
        return;
      }

      const candidate = getTrackPurchaseMergeCandidate(card);
      if (!candidate) {
        previousCandidate = null;
        return;
      }

      if (
        previousCandidate &&
        previousCandidate.parentElement === card.parentElement &&
        previousCandidate.fanKey === candidate.fanKey &&
        previousCandidate.activityType === candidate.activityType &&
        previousCandidate.releaseGroupKey === candidate.releaseGroupKey
      ) {
        mergeTrackPurchaseCard(previousCandidate.card, card, candidate.trackTitle);
        return;
      }

      previousCandidate = candidate;
    });
  }

  function getTrackPurchaseMergeCandidate(card) {
    const activityType = extractActivityType(card);
    if (activityType !== "bought-track") {
      return null;
    }

    const fanKey = extractFanKey(card);
    const releaseGroupKey = getCardReleaseGroupKey(card);
    const trackTitle = extractTrackTitleFromCard(card);

    if (!fanKey || !releaseGroupKey || !trackTitle) {
      return null;
    }

    return {
      card,
      parentElement: card.parentElement,
      fanKey,
      activityType,
      releaseGroupKey,
      trackTitle,
    };
  }

  function extractActivityType(card) {
    const text = normalizedText(card).toLowerCase();
    if (/bought a track\b/.test(text) || /bought track\b/.test(text)) {
      return "bought-track";
    }

    if (/bought an album\b/.test(text) || /bought album\b/.test(text)) {
      return "bought-album";
    }

    if (/wishlisted\b/.test(text)) {
      return "wishlisted";
    }

    return "";
  }

  function extractFanKey(card) {
    const profileLink = Array.from(card.querySelectorAll("a[href]")).find(isLikelyProfileLink);
    if (profileLink && profileLink.href) {
      try {
        const url = new URL(profileLink.href, window.location.href);
        return cleanText(url.pathname.replace(/^\/+|\/+$/g, "")).toLowerCase();
      } catch (_error) {
        // Fall through to text extraction.
      }
    }

    const headline = findActivityHeadline(card);
    const headlineText = headline ? normalizedText(headline) : normalizedText(card);
    const match = headlineText.match(/^(.+?)\s+(?:bought|wishlisted|supported|recommended|listening|played)\b/i);
    return match && match[1] ? cleanText(match[1]).toLowerCase() : "";
  }

  function extractFanDisplayName(card) {
    const headline = findActivityHeadline(card);
    const headlineText = headline ? normalizedText(headline) : normalizedText(card);
    const match = headlineText.match(/^(.+?)\s+(?:bought|wishlisted|supported|recommended|listening|played)\b/i);
    return match && match[1] ? cleanText(match[1]) : "This fan";
  }

  function getCardReleaseGroupKey(card) {
    const albumLink = Array.from(card.querySelectorAll('a[href*="/album/"]'))
      .map((link) => normalizeReleaseUrl(link.href))
      .find(Boolean);
    if (albumLink) {
      return `album:${albumLink}`;
    }

    const releaseLink = Array.from(card.querySelectorAll(RELEASE_LINK_SELECTOR))
      .map((link) => normalizeReleaseUrl(link.href))
      .find(Boolean);
    if (!releaseLink) {
      return "";
    }

    let origin = "";
    try {
      origin = new URL(releaseLink, window.location.href).origin;
    } catch (_error) {
      origin = "";
    }

    const artist = extractArtistNameFromCard(card).toLowerCase();
    const artUrl = normalizeMediaUrl(getCardArtUrl(card));
    return `heuristic:${origin}|${artist}|${artUrl}`;
  }

  function extractArtistNameFromCard(card) {
    const byline = findElementByText(card, "div, p, li, span, a", /^by\s+/i);
    if (byline) {
      return cleanText((byline.textContent || "").replace(/^by\s+/i, ""));
    }

    const text = normalizedText(card);
    const match = text.match(/\bby\s+(.+?)(?:\s+featured track:|\s+buy now|\s+wishlist|\s+hear more|\s+tags?:|$)/i);
    return match && match[1] ? cleanText(match[1]) : "";
  }

  function extractTrackTitleFromCard(card) {
    const explicitTrackLink = Array.from(card.querySelectorAll('a[href*="/track/"]')).find((link) => {
      const text = normalizedText(link);
      return text && !/\b(buy now|wishlist|hear more|open release|more)\b/i.test(text);
    });
    if (explicitTrackLink) {
      return normalizedText(explicitTrackLink);
    }

    const titleCandidate = Array.from(card.querySelectorAll("h1, h2, h3, h4, strong, a, div, p, span")).find((node) => {
      const text = normalizedText(node);
      if (!text) {
        return false;
      }

      if (/^(featured track:|by\s+|buy now|wishlist|hear more|supported by|tracks?)\b/i.test(text)) {
        return false;
      }

      if (node.querySelector && node.querySelector("img")) {
        return false;
      }

      return true;
    });

    return titleCandidate ? normalizedText(titleCandidate) : "";
  }

  function normalizeMediaUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value, window.location.href);
      url.hash = "";
      url.search = "";
      return url.toString();
    } catch (_error) {
      return cleanText(value);
    }
  }

  function mergeTrackPurchaseCard(primaryCard, duplicateCard, trackTitle) {
    if (!primaryCard || !duplicateCard || primaryCard === duplicateCard) {
      return;
    }

    const mergedTrackTitles = getMergedTrackTitles(primaryCard);
    if (trackTitle && !mergedTrackTitles.some((title) => title.toLowerCase() === trackTitle.toLowerCase())) {
      mergedTrackTitles.push(trackTitle);
    }

    if (!primaryCard.__bcampxPrimaryTrackTitle) {
      primaryCard.__bcampxPrimaryTrackTitle = extractTrackTitleFromCard(primaryCard);
      if (primaryCard.__bcampxPrimaryTrackTitle && !mergedTrackTitles.some((title) => title.toLowerCase() === primaryCard.__bcampxPrimaryTrackTitle.toLowerCase())) {
        mergedTrackTitles.unshift(primaryCard.__bcampxPrimaryTrackTitle);
      }
    }

    primaryCard.__bcampxMergedTrackTitles = mergedTrackTitles;
    primaryCard.setAttribute(MERGED_PARENT_ATTR, "true");
    duplicateCard.setAttribute(MERGED_CHILD_ATTR, "true");
    duplicateCard.style.display = "none";
    duplicateCard.hidden = true;

    if (STATE.observer) {
      STATE.observer.unobserve(duplicateCard);
    }

    updateMergedTrackPurchaseNotice(primaryCard);
    syncTrackButtonsForCard(primaryCard);
  }

  function getMergedTrackTitles(card) {
    if (!card) {
      return [];
    }

    if (!Array.isArray(card.__bcampxMergedTrackTitles)) {
      card.__bcampxMergedTrackTitles = [];
    }

    return card.__bcampxMergedTrackTitles;
  }

  function getMergedTrackTitleSet(card) {
    return new Set(getMergedTrackTitles(card).map((title) => cleanText(title).toLowerCase()).filter(Boolean));
  }

  function findActivityHeadline(card) {
    return findElementByText(card, "div, p, li, span, strong, h2, h3, h4", /\b(bought|wishlisted|supported|recommended|listening|played)\b/i);
  }

  function updateMergedTrackPurchaseNotice(card) {
    const mergedTrackTitles = getMergedTrackTitles(card);
    if (!mergedTrackTitles.length) {
      return;
    }

    const notice = ensureMergedTrackPurchaseNotice(card);
    if (!notice) {
      return;
    }

    const fanName = extractFanDisplayName(card);
    notice.textContent = "";

    const fan = document.createElement("span");
    fan.className = "bcampx__merge-fan";
    fan.textContent = fanName;

    const verb = document.createElement("span");
    verb.className = "bcampx__merge-copy";
    verb.textContent = " also bought ";

    notice.append(fan, verb);

    mergedTrackTitles.forEach((title, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "bcampx__merge-copy";
        separator.textContent = ", ";
        notice.append(separator);
      }

      const track = document.createElement("span");
      track.className = "bcampx__merge-track";
      track.textContent = `"${title}"`;
      notice.append(track);
    });
  }

  function ensureMergedTrackPurchaseNotice(card) {
    const existing = card.querySelector(".bcampx__merge-note");
    if (existing) {
      return existing;
    }

    const notice = document.createElement("div");
    notice.className = "bcampx__merge-note";

    const headline = findActivityHeadline(card);
    if (headline && headline.parentNode) {
      headline.insertAdjacentElement("afterend", notice);
      return notice;
    }

    const contentColumn = findContentColumn(card);
    contentColumn.insertBefore(notice, contentColumn.firstChild || null);
    return notice;
  }

  function syncTrackButtonsForCard(card) {
    const controller = card && card.__bcampxController;
    if (controller && controller.loaded && controller.data) {
      const shell = card.querySelector(".bcampx");
      const meta = shell ? shell.querySelector(".bcampx__meta") : null;
      const text = shell ? shell.querySelector(".bcampx__summary-text") : null;
      const toggle = shell ? shell.querySelector(".bcampx__toggle") : null;
      if (shell && meta && text && toggle) {
        renderReleaseData(shell, meta, text, toggle, controller.data, controller.releaseUrl || "");
      }
    }
  }

  function normalizeReleaseUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.hostname !== "bandcamp.com" && !url.hostname.endsWith(".bandcamp.com")) {
        return "";
      }

      if (!/(^|\/)(album|track)\//.test(url.pathname)) {
        return "";
      }

      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/$/, "");
    } catch (_error) {
      return "";
    }
  }

  function findCardRoot(link) {
    const explicitStory = link.closest("li.story, .story");
    if (explicitStory) {
      return explicitStory;
    }

    let node = link;
    let fallback = null;

    for (let depth = 0; node && node !== document.body && depth < 10; depth += 1) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (!fallback && node.matches("article, li")) {
          fallback = node;
        }

        if (node.tagName !== "A" && node.matches(CARD_SELECTOR) && looksLikeFeedCard(node)) {
          return node;
        }
      }

      node = node.parentElement;
    }

    return fallback || link.closest("article, li") || link.parentElement;
  }

  function looksLikeFeedCard(node) {
    if (!isLikelyFanActivityCard(node)) {
      return false;
    }

    if (!hasFanActivitySignals(node)) {
      return false;
    }

    const releaseLinkCount = node.querySelectorAll(RELEASE_LINK_SELECTOR).length;
    if (releaseLinkCount < 1 || releaseLinkCount > 12) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const hasUsefulSize = rect.width >= 120 && rect.height >= 45;
    const hasCoverOrText = Boolean(node.querySelector("img")) || normalizedText(node).length > 20;
    return hasUsefulSize && hasCoverOrText;
  }

  function isFanActivityLink(link) {
    if (!(link instanceof Element)) {
      return false;
    }

    if (link.closest(EXCLUDED_SECTION_SELECTOR)) {
      return false;
    }

    if (hasSidebarLikeAncestor(link)) {
      return false;
    }

    const story = link.closest("li.story, .story");
    if (story) {
      return isLikelyFanActivityCard(story);
    }

    const card = link.closest(CARD_SELECTOR) || link.closest("article, li, div");
    if (card && !isLikelyFanActivityCard(card)) {
      return false;
    }

    return true;
  }

  function hasFanActivitySignals(node) {
    if (node.querySelector(".story-title .fan-name, .story-title .artist-name")) {
      return true;
    }

    if (node.querySelector(".story-title") && FAN_ACTIVITY_TEXT_PATTERN.test(normalizedText(node.querySelector(".story-title")))) {
      return true;
    }

    const text = normalizedText(node);
    if (FAN_ACTIVITY_TEXT_PATTERN.test(text)) {
      return true;
    }

    const profileLinks = Array.from(node.querySelectorAll("a[href]")).filter(isLikelyProfileLink);
    return profileLinks.length > 0;
  }

  function isLikelyProfileLink(link) {
    try {
      const url = new URL(link.href, window.location.href);
      if (url.hostname !== "bandcamp.com") {
        return false;
      }

      const pathname = url.pathname.replace(/\/+$/, "");
      if (!pathname || pathname === "/") {
        return false;
      }

      if (/\/(album|track|tagged|discover|feed|fans|terms_of_use|about|help|search|gift_cards)(\/|$)/.test(pathname)) {
        return false;
      }

      const segments = pathname.split("/").filter(Boolean);
      return segments.length === 1;
    } catch (_error) {
      return false;
    }
  }

  function isLikelyFanActivityCard(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (node.closest(EXCLUDED_SECTION_SELECTOR) || hasSidebarLikeAncestor(node)) {
      return false;
    }

    if (hasExplicitFeedStoryStructure(node)) {
      return true;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.width < CONFIG.minFanActivityCardWidth) {
      return false;
    }

    return true;
  }

  function hasExplicitFeedStoryStructure(node) {
    const story =
      node.matches("li.story, .story") ? node : node.closest("li.story, .story");

    if (!(story instanceof Element)) {
      return false;
    }

    if (story.matches("li.story") && story.hasAttribute("data-story-fan-id")) {
      return true;
    }

    if (story.querySelector(".story-title") && story.querySelector(".story-innards")) {
      return true;
    }

    if (story.querySelector(".story-title") && story.querySelector(".tralbum-wrapper")) {
      return true;
    }

    return false;
  }

  function hasSidebarLikeAncestor(node) {
    let current = node;

    for (let depth = 0; current && current !== document.body && depth < 8; depth += 1) {
      const idAndClass = `${current.id || ""} ${typeof current.className === "string" ? current.className : ""}`.toLowerCase();
      if (/(sidebar|side-bar|side_module|right[-_ ]?col|right[-_ ]?column|recommend|discover|new[-_ ]?release)/.test(idAndClass)) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function enhanceCard(card, releaseUrl) {
    if (isFullDiscographyCard(card)) {
      card.setAttribute(ENHANCED_ATTR, "skipped");
      return;
    }

    card.setAttribute(ENHANCED_ATTR, "true");

    const shell = document.createElement("section");
    shell.className = "bcampx";

    const meta = document.createElement("div");
    meta.className = "bcampx__meta";
    meta.hidden = true;

    const summary = document.createElement("div");
    summary.className = "bcampx__summary";

    const text = document.createElement("span");
    text.className = "bcampx__summary-text";
    text.textContent = "Loading extra context...";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bcampx__toggle";
    toggle.textContent = "More";
    toggle.hidden = true;

    summary.append(text, toggle);
    shell.append(meta, summary);
    mountEnhancementShell(card, shell);

    const controller = {
      loaded: false,
      loading: false,
      expanded: false,
      data: null,
      releaseUrl,
      fetchAndRender: (options = {}) => fetchAndRender(controller, releaseUrl, shell, meta, text, toggle, options),
      toggle: () => toggleDetails(controller, shell, toggle),
    };

    card.__bcampxController = controller;

    toggle.addEventListener("click", () => {
      if (controller.loading) {
        return;
      }

      controller.toggle();
    });

    if (STATE.observer && !card.hasAttribute(OBSERVED_ATTR)) {
      card.setAttribute(OBSERVED_ATTR, "true");
      STATE.observer.observe(card);
    }
  }

  function mountEnhancementShell(card, shell) {
    const supportedBySlot = findSupportedBySlot(card);
    if (supportedBySlot && supportedBySlot.container && supportedBySlot.container.parentNode) {
      card.classList.add("bcampx--supported-card");
      supportedBySlot.hiddenNodes.forEach((node) => {
        node.setAttribute(HIDDEN_SUPPORTED_ATTR, "true");
        node.hidden = true;
      });
      shell.classList.add("bcampx--supported-slot");
      supportedBySlot.container.appendChild(shell);
      return;
    }

    const anchor = findEnhancementAnchor(card);
    if (anchor && anchor.parentNode) {
      anchor.insertAdjacentElement("afterend", shell);
      return;
    }

    const contentColumn = findContentColumn(card);
    contentColumn.appendChild(shell);
  }

  function findEnhancementAnchor(card) {
    const tagLine = findElementByText(card, "div, p, li, section", /^tags\s*:/i);
    if (tagLine) {
      return tagLine;
    }

    const actionLink = Array.from(card.querySelectorAll("a")).find((link) => {
      return /\b(buy now|wishlist|hear more|buy track|pre-order|stream)\b/i.test(normalizedText(link));
    });

    if (actionLink) {
      return findUsefulActionRow(actionLink, card) || actionLink;
    }

    const featuredTrackLine = findElementByText(card, "div, p, li, section", /^featured track\s*:/i);
    if (featuredTrackLine) {
      return featuredTrackLine;
    }

    return null;
  }

  function findSupportedBySlot(card) {
    const explicitSlot = findExplicitSupportedSlot(card);
    if (explicitSlot) {
      return {
        container: explicitSlot,
        hiddenNodes: Array.from(explicitSlot.children),
      };
    }

    const label = findElementByText(card, "div, span, p, strong, h2, h3, h4", /supported by/i);
    if (!label) {
      return null;
    }

    const cardRect = card.getBoundingClientRect();
    const container =
      nearestAncestorWithin(label, card, (node) => isSupportedSlotCandidate(node, cardRect)) ||
      label.parentElement;
    if (!container || container === card || !isSupportedSlotCandidate(container, cardRect)) {
      return null;
    }

    return {
      container,
      hiddenNodes: collectSupportedSlotHiddenNodes(container, label),
    };
  }

  function findContentColumn(card) {
    const explicitColumn = card.querySelector(CONTENT_COLUMN_SELECTOR);
    if (explicitColumn) {
      return explicitColumn;
    }

    const releaseLink = card.querySelector(RELEASE_LINK_SELECTOR);
    if (releaseLink) {
      const block = nearestAncestorWithin(releaseLink, card, (node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.width < card.getBoundingClientRect().width * 0.82;
      });

      if (block && block !== card) {
        return block;
      }
    }

    return card;
  }

  function findExplicitSupportedSlot(card) {
    return card.querySelector(SUPPORTED_SLOT_SELECTOR);
  }

  function isSupportedSlotCandidate(node, cardRect) {
    if (!(node instanceof Element)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const widthRatio = cardRect.width > 0 ? rect.width / cardRect.width : 1;
    const leftRatio = cardRect.width > 0 ? (rect.left - cardRect.left) / cardRect.width : 0;
    const avatarCount = node.querySelectorAll("img").length;
    return widthRatio < 0.48 && leftRatio > 0.42 && avatarCount >= 2;
  }

  function collectSupportedSlotHiddenNodes(container, label) {
    const hiddenNodes = [label];

    Array.from(container.children).forEach((child) => {
      if (child === label) {
        return;
      }

      const childText = normalizedText(child);
      const childAvatars = child.querySelectorAll("img").length;
      if (childAvatars >= 1 || /^more\.\.\.$/i.test(childText) || /supported by/i.test(childText)) {
        hiddenNodes.push(child);
      }
    });

    return Array.from(new Set(hiddenNodes));
  }

  function findUsefulActionRow(node, stopAt) {
    return nearestAncestorWithin(node, stopAt, (current) => {
      const text = normalizedText(current);
      const linkCount = current.querySelectorAll("a").length;
      return linkCount >= 2 && /\b(buy now|wishlist|hear more|buy track|pre-order|stream)\b/i.test(text);
    });
  }

  function nearestAncestorWithin(node, stopAt, predicate) {
    let current = node;
    while (current && current !== stopAt) {
      if (current.nodeType === Node.ELEMENT_NODE && predicate(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function findElementByText(root, selector, pattern) {
    return Array.from(root.querySelectorAll(selector)).find((node) => pattern.test(normalizedText(node)));
  }

  async function fetchAndRender(controller, releaseUrl, shell, meta, text, toggle, options) {
    controller.loading = true;
    shell.classList.add("bcampx--loading");
    text.textContent = "Loading extra context...";
    toggle.disabled = true;

    try {
      const result = await getReleaseData(releaseUrl);
      controller.loaded = true;
      controller.data = result.data;

      renderReleaseData(shell, meta, text, toggle, result.data, releaseUrl);

      const shouldExpand = (!options.auto || CONFIG.expandAfterAutoFetch) && hasExpandableContent(result.data);
      controller.expanded = shouldExpand;
      shell.classList.toggle("bcampx--expanded", shouldExpand);
      updateToggle(toggle, shouldExpand);
      text.textContent = result.fromCache ? "Extra context loaded from cache" : "Extra context loaded";
    } catch (error) {
      controller.loaded = false;
      controller.data = null;
      renderError(meta, text, releaseUrl, error);
      shell.classList.remove("bcampx--expanded");
      toggle.hidden = true;
    } finally {
      controller.loading = false;
      toggle.disabled = false;
      shell.classList.remove("bcampx--loading");
    }
  }

  function toggleDetails(controller, shell, toggle) {
    controller.expanded = !controller.expanded;
    shell.classList.toggle("bcampx--expanded", controller.expanded);
    updateToggle(toggle, controller.expanded);
  }

  function updateToggle(toggle, expanded) {
    toggle.textContent = expanded ? "Less" : "More";
  }

  async function getReleaseData(releaseUrl) {
    const cacheKey = getReleaseCacheKey(releaseUrl);
    const cached = await storageGet(cacheKey, null);

    if (isFreshReleaseCache(cached)) {
      const normalizedCached = normalizeReleaseData(cached);
      if (!shouldRefreshCachedRelease(cached, normalizedCached)) {
        return { data: normalizedCached, fromCache: true };
      }
    }

    const html = await requestHtml(releaseUrl);
    const data = normalizeReleaseData(parseReleasePage(html, releaseUrl));
    const cacheValue = buildReleaseCacheValue(data);

    await storageSet(cacheKey, cacheValue);
    return { data: cacheValue, fromCache: false };
  }

  function getReleaseCacheKey(releaseUrl) {
    return `${RELEASE_CACHE_PREFIX}${releaseUrl}`;
  }

  function buildReleaseCacheValue(data) {
    return {
      ...data,
      schemaVersion: CACHE_SCHEMA_VERSION,
      fetchedAt: Date.now(),
    };
  }

  function isFreshReleaseCache(value) {
    return Boolean(
      value &&
      value.fetchedAt &&
      Date.now() - value.fetchedAt < CONFIG.cacheTtlMs
    );
  }

  function shouldRefreshCachedRelease(rawData, normalizedData) {
    return needsTrackRefresh(normalizedData) || needsSchemaRefresh(rawData, normalizedData);
  }

  function requestHtml(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest is not available."));
        return;
      }

      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: CONFIG.fetchTimeoutMs,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText || "");
            return;
          }

          reject(new Error(`HTTP ${response.status}`));
        },
        onerror: () => reject(new Error("Network request failed.")),
        ontimeout: () => reject(new Error("Network request timed out.")),
      });
    });
  }

  function parseReleasePage(html, releaseUrl) {
    const documentFromHtml = new DOMParser().parseFromString(html, "text/html");
    const jsonLd = parseJsonLd(documentFromHtml);
    const tralbum = parseTralbumData(documentFromHtml);

    const title =
      firstString(tralbum && tralbum.current && tralbum.current.title) ||
      firstString(tralbum && tralbum.album_title) ||
      firstString(jsonLd && jsonLd.name) ||
      metaContent(documentFromHtml, 'meta[property="og:title"]') ||
      textContent(documentFromHtml, ".trackTitle") ||
      textContent(documentFromHtml, "h1") ||
      cleanTitle(documentFromHtml.title);

    const artist =
      firstString(tralbum && tralbum.artist) ||
      extractJsonArtist(jsonLd) ||
      textContent(documentFromHtml, "#name-section .artist") ||
      textContent(documentFromHtml, "#band-name-location .title") ||
      metaContent(documentFromHtml, 'meta[property="og:site_name"]') ||
      "";

    const tracks = uniqueTracks([
      ...extractTralbumTracks(tralbum),
      ...extractJsonTracks(jsonLd),
      ...queryTexts(documentFromHtml, "#track_table .track-title").map((title) => createTrackData(title, "", "", "")),
      ...queryTexts(documentFromHtml, ".track-title").map((title) => createTrackData(title, "", "", "")),
    ]).slice(0, CONFIG.maxTracks);

    const tralbumAbout = cleanText(firstString(tralbum && tralbum.current && tralbum.current.about));
    const tralbumAboutText = textContent(documentFromHtml, ".tralbum-about");
    const albumAboutText = textContent(documentFromHtml, ".album-about");
    const itempropDescriptionText = textContent(documentFromHtml, "[itemprop='description']:not(meta)");
    const rawDescriptionHtml = extractDescriptionHtml(documentFromHtml);
    const descriptionSource =
      tralbumAbout ||
      tralbumAboutText ||
      albumAboutText ||
      itempropDescriptionText ||
      "";
    const hasBodyDescriptionSource = Boolean(
      tralbumAbout ||
      tralbumAboutText ||
      albumAboutText ||
      itempropDescriptionText ||
      rawDescriptionHtml
    );
    const descriptionState = normalizeDescriptionState({
      descriptionText: descriptionSource,
      descriptionHtml: rawDescriptionHtml,
      tracks,
      hasBodyDescriptionSource,
    });

    const tags = uniqueStrings([
      ...queryTexts(documentFromHtml, ".tralbum-tags a"),
      ...queryTexts(documentFromHtml, "a.tag"),
      ...queryTexts(documentFromHtml, 'a[href*="/tag/"]'),
    ]).filter((tag) => !/^tags?$/i.test(tag));

    const releaseDate =
      firstString(tralbum && tralbum.album_release_date) ||
      firstString(tralbum && tralbum.current && tralbum.current.release_date) ||
      firstString(jsonLd && jsonLd.datePublished) ||
      attrContent(documentFromHtml, "time[datetime]", "datetime") ||
      metaContent(documentFromHtml, 'meta[itemprop="datePublished"]') ||
      findReleasedDate(documentFromHtml);

    const location =
      textContent(documentFromHtml, "#band-name-location .location") ||
      textContent(documentFromHtml, ".location") ||
      "";

    return {
      url: releaseUrl,
      title,
      artist,
      releaseDate,
      location,
      artUrl: metaContent(documentFromHtml, 'meta[property="og:image"]'),
      hasBodyDescriptionSource,
      description: descriptionState.description,
      descriptionHtml: descriptionState.descriptionHtml,
      tags,
      tracks,
    };
  }

  function normalizeReleaseData(data) {
    if (!data || typeof data !== "object") {
      return {
        url: "",
        title: "",
        artist: "",
        releaseDate: "",
        location: "",
        description: "",
        descriptionHtml: "",
        tags: [],
        tracks: [],
      };
    }

    const tracks = normalizeTracks(data.tracks);
    const hasBodyDescriptionSource = data.hasBodyDescriptionSource !== false;
    const descriptionState = normalizeDescriptionState({
      descriptionText: data.description || "",
      descriptionHtml: data.descriptionHtml || "",
      tracks,
      hasBodyDescriptionSource,
    });

    return {
      ...data,
      hasBodyDescriptionSource,
      description: descriptionState.description,
      descriptionHtml: descriptionState.descriptionHtml,
      tags: Array.isArray(data.tags) ? data.tags.map((tag) => cleanText(tag)).filter(Boolean) : [],
      tracks,
    };
  }

  function normalizeDescriptionState({ descriptionText, descriptionHtml, tracks, hasBodyDescriptionSource }) {
    const cleanDescription = cleanText(descriptionText || "");
    const truncatedDescription = truncate(cleanDescription, CONFIG.maxDescriptionLength);
    const normalizedHtml =
      sanitizeDescriptionHtml(descriptionHtml || "") ||
      plainTextToDescriptionHtml(truncatedDescription, CONFIG.maxDescriptionLength);
    const shouldSuppress =
      !hasBodyDescriptionSource ||
      isLikelyTracklistText(cleanDescription, tracks) ||
      isLikelyTracklistHtml(normalizedHtml, tracks);

    return {
      description: shouldSuppress ? "" : truncatedDescription,
      descriptionHtml: shouldSuppress ? "" : normalizedHtml,
    };
  }

  function normalizeTracks(tracks) {
    if (!Array.isArray(tracks)) {
      return [];
    }

    return tracks
      .map((track) => {
        if (!track) {
          return null;
        }

        if (typeof track === "string") {
          return createTrackData(track, "", "", "");
        }

        return createTrackData(track.title, track.trackId || track.track_id || "", track.streamUrl || "", track.duration || "");
      })
      .filter(Boolean);
  }

  function needsTrackRefresh(data) {
    if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
      return false;
    }

    return data.tracks.some((track) => track && track.title) && !data.tracks.some((track) => track && track.streamUrl);
  }

  function needsSchemaRefresh(rawData, normalizedData) {
    if (!rawData || rawData.schemaVersion !== CACHE_SCHEMA_VERSION) {
      return true;
    }

    if ((normalizedData.description && !normalizedData.descriptionHtml) || (normalizedData.descriptionHtml && !/<(?:p|br|a)\b/i.test(normalizedData.descriptionHtml) && /\n|https?:\/\//i.test(normalizedData.description))) {
      return true;
    }

    if (isLikelyTracklistDescription(normalizedData)) {
      return true;
    }

    return false;
  }

  function parseJsonLd(doc) {
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));

    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent.trim());
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        const release = candidates.find((item) => {
          const type = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
          return type.some((value) => /MusicAlbum|MusicRecording|Album|Track/i.test(String(value)));
        });

        if (release) {
          return release;
        }
      } catch (_error) {
        // Ignore malformed structured data and continue with DOM parsing.
      }
    }

    return null;
  }

  function parseTralbumData(doc) {
    const dataNode = doc.querySelector("[data-tralbum]");
    if (dataNode) {
      try {
        return JSON.parse(dataNode.getAttribute("data-tralbum"));
      } catch (_error) {
        // Fall through to the script regex parser below.
      }
    }

    const scripts = Array.from(doc.scripts);
    const tralbumScript = scripts.find((script) => /TralbumData|trackinfo/.test(script.textContent));
    if (!tralbumScript) {
      return null;
    }

    const text = tralbumScript.textContent;
    const titleMatch = text.match(/(?:album_title|title):\s*"([^"]+)"/);
    const artistMatch = text.match(/artist:\s*"([^"]+)"/);
    const dateMatch = text.match(/album_release_date:\s*"([^"]+)"/);
    const trackMatches = Array.from(text.matchAll(/"title"\s*:\s*"([^"]+)"/g));

    return {
      album_title: titleMatch ? decodeJsString(titleMatch[1]) : "",
      artist: artistMatch ? decodeJsString(artistMatch[1]) : "",
      album_release_date: dateMatch ? decodeJsString(dateMatch[1]) : "",
      trackinfo: trackMatches.map((match) => ({ title: decodeJsString(match[1]) })),
    };
  }

  function extractJsonArtist(jsonLd) {
    if (!jsonLd || !jsonLd.byArtist) {
      return "";
    }

    if (typeof jsonLd.byArtist === "string") {
      return jsonLd.byArtist;
    }

    if (Array.isArray(jsonLd.byArtist)) {
      return jsonLd.byArtist.map((artist) => artist && artist.name).filter(Boolean).join(", ");
    }

    return jsonLd.byArtist.name || "";
  }

  function extractJsonTracks(jsonLd) {
    if (!jsonLd || !jsonLd.track) {
      return [];
    }

    const tracks = Array.isArray(jsonLd.track) ? jsonLd.track : [jsonLd.track];
    return tracks
      .map((track) => {
        if (typeof track === "string") {
          return createTrackData(track, "", "", "");
        }

        return createTrackData(track && track.name, "", "", track && track.duration ? track.duration : "");
      })
      .filter(Boolean);
  }

  function extractTralbumTracks(tralbum) {
    if (!tralbum || !Array.isArray(tralbum.trackinfo)) {
      return [];
    }

    return tralbum.trackinfo
      .map((track) =>
        createTrackData(
          track && track.title,
          track && (track.track_id || track.id || ""),
          track && track.file && track.file["mp3-128"] ? track.file["mp3-128"] : "",
          track && typeof track.duration !== "undefined" ? track.duration : ""
        )
      )
      .filter(Boolean);
  }

  function createTrackData(title, trackId, streamUrl, duration) {
    const cleanTitleValue = cleanText(title);
    if (!cleanTitleValue) {
      return null;
    }

    return {
      title: cleanTitleValue,
      trackId: cleanText(trackId),
      streamUrl: cleanText(streamUrl),
      duration: normalizeTrackDuration(duration),
    };
  }

  function normalizeTrackDuration(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return formatTrackDuration(value);
    }

    const text = cleanText(value);
    if (!text) {
      return "";
    }

    if (/^\d+:\d{2}(?::\d{2})?$/.test(text)) {
      return text;
    }

    const isoMatch = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (isoMatch) {
      const hours = Number(isoMatch[1] || 0);
      const minutes = Number(isoMatch[2] || 0);
      const seconds = Number(isoMatch[3] || 0);
      return formatTrackDuration(hours * 3600 + minutes * 60 + seconds);
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
      return formatTrackDuration(numeric);
    }

    return "";
  }

  function formatTrackDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return "";
    }

    const whole = Math.round(totalSeconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = whole % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function uniqueTracks(values) {
    const seen = new Set();
    const result = [];

    values.forEach((track) => {
      if (!track || !track.title) {
        return;
      }

      const key = track.title.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      result.push(track);
    });

    return result;
  }

  function findReleasedDate(doc) {
    const candidates = queryTexts(doc, ".tralbumData, .tralbum-credits, .credits, #trackInfo");
    for (const candidate of candidates) {
      const match = candidate.match(/released\s+([^\n.]+)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return "";
  }

  function renderReleaseData(shell, meta, text, toggle, data, releaseUrl) {
    if (isFullDiscographyReleaseData(data)) {
      shell.remove();
      return;
    }

    meta.textContent = "";
    meta.hidden = false;

    if (shell.classList.contains("bcampx--supported-slot")) {
      renderSupportedSlot(meta, text, toggle, data, releaseUrl);
      shell.classList.toggle("bcampx--expanded", false);
      return;
    }

    const facts = compactJoin([formatReleaseDate(data.releaseDate), data.location], " · ");
    if (facts) {
      const factsLine = document.createElement("div");
      factsLine.className = "bcampx__facts";
      factsLine.textContent = facts;
      meta.append(factsLine);
    }

    if (data.descriptionHtml || data.description) {
      const description = document.createElement("p");
      description.className = "bcampx__description";
      renderDescriptionContent(description, data);
      meta.append(description);
    }

    if (data.tracks && data.tracks.length) {
      const tracks = document.createElement("ol");
      tracks.className = "bcampx__tracks";
      data.tracks.forEach((track) => {
        const item = document.createElement("li");
        item.textContent = track.title;
        tracks.append(item);
      });
      meta.append(tracks);
    }

    const openLink = document.createElement("a");
    openLink.className = "bcampx__link";
    openLink.href = releaseUrl;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.textContent = "Open release";
    meta.append(openLink);

    if (!hasVisibleEnhancements(data)) {
      renderEmpty(meta, text, releaseUrl);
      shell.classList.remove("bcampx--expanded");
      toggle.hidden = true;
      return;
    }

    const expandable = hasExpandableContent(data);
    toggle.hidden = !expandable;
    text.textContent = buildSummaryText(data);
    shell.classList.toggle("bcampx--expanded", expandable && CONFIG.autoExpandTracks);
    if (expandable) {
      updateToggle(toggle, CONFIG.autoExpandTracks);
    }
  }

  function renderSupportedSlot(meta, text, toggle, data, releaseUrl) {
    const purchasedTrackTitles = getMergedTrackTitleSet(meta.closest(CARD_SELECTOR));
    const subhead = compactJoin([formatReleaseDate(data.releaseDate), data.location], " · ");
    const panel = document.createElement("section");
    panel.className = "bcampx__slot-panel";
    const autoExpandState = { steps: [] };
    const header = document.createElement("div");
    header.className = "bcampx__slot-header";
    header.textContent = "Tracklist";
    panel.append(header);

    if (data.tracks && data.tracks.length) {
      const tracks = document.createElement("ol");
      tracks.className = "bcampx__tracks bcampx__tracks--slot";
      const initiallyVisible = Math.min(CONFIG.initialVisibleTracks, data.tracks.length);

      data.tracks.forEach((track, index) => {
        const item = document.createElement("li");
        if (index >= initiallyVisible) {
          item.classList.add("bcampx__track-item--extra");
        }
        if (purchasedTrackTitles.has(cleanText(track.title).toLowerCase())) {
          item.classList.add("bcampx__track-item--purchased");
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bcampx__track-link";
        button.textContent = track.title;
        button.disabled = !track.streamUrl;
        button.dataset.trackId = track.trackId || "";
        button.dataset.streamUrl = track.streamUrl || "";
        button.addEventListener("click", () => playSharedTrack(button, track, data, releaseUrl));
        item.append(button);

        if (track.duration) {
          const duration = document.createElement("span");
          duration.className = "bcampx__track-duration";
          duration.textContent = track.duration;
          item.append(duration);
        }

        tracks.append(item);
      });
      panel.append(tracks);

      if (data.tracks.length > initiallyVisible) {
        tracks.classList.add("bcampx__tracks--collapsed");
        const tracksController = createExpandController({
          className: "bcampx__slot-expand",
          collapsedLabel: `Show all ${data.tracks.length} tracks`,
          expandedLabel: "Show less",
          onToggle: (expanded) => {
            tracks.classList.toggle("bcampx__tracks--collapsed", !expanded);
          },
        });
        const expandButton = tracksController.button;
        panel.append(expandButton);
        autoExpandState.steps.push(tracksController);
      }
    }

    if (data.descriptionHtml || data.description) {
      const descriptionBlock = document.createElement("div");
      descriptionBlock.className = "bcampx__description-block";
      const description = document.createElement("div");
      description.className = "bcampx__description bcampx__description--slot";
      renderDescriptionContent(description, data);
      descriptionBlock.append(description);
      panel.append(descriptionBlock);

      window.requestAnimationFrame(() => {
        if (!description.isConnected) {
          return;
        }

        normalizeDescriptionContent(description);
        description.classList.add("bcampx__description--collapsed");
        if (description.scrollHeight > description.clientHeight + 6) {
          const descriptionController = createExpandController({
            className: "bcampx__slot-expand bcampx__slot-expand--description",
            collapsedLabel: "Show more",
            expandedLabel: "Show less",
            onToggle: (expanded) => {
              description.classList.toggle("bcampx__description--collapsed", !expanded);
            },
          });
          descriptionBlock.append(descriptionController.button);
          autoExpandState.steps.push(descriptionController);
          scheduleSupportedSlotAutoExpand(panel, autoExpandState);
          return;
        }

        description.classList.remove("bcampx__description--collapsed");
        scheduleSupportedSlotAutoExpand(panel, autoExpandState);
      });
    }

    if (subhead) {
      const facts = document.createElement("div");
      facts.className = "bcampx__slot-subhead";
      facts.textContent = subhead;
      panel.append(facts);
    }

    meta.append(panel);
    scheduleSupportedSlotAutoExpand(panel, autoExpandState);

    toggle.hidden = true;
    text.hidden = true;
  }

  function createExpandController({ className, collapsedLabel, expandedLabel, onToggle }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;

    const setExpanded = (expanded) => {
      if (typeof onToggle === "function") {
        onToggle(expanded);
      }
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.textContent = expanded ? expandedLabel : collapsedLabel;
    };

    setExpanded(false);
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      setExpanded(!expanded);
    });

    return {
      button,
      expand: () => setExpanded(true),
      collapse: () => setExpanded(false),
    };
  }

  function scheduleSupportedSlotAutoExpand(panel, state) {
    window.requestAnimationFrame(() => maybeAutoExpandSupportedSlot(panel, state));
  }

  function maybeAutoExpandSupportedSlot(panel, state) {
    if (!panel || !panel.isConnected || !state || !Array.isArray(state.steps)) {
      return;
    }

    while (state.steps.length) {
      const step = state.steps.shift();
      if (!step || typeof step.expand !== "function" || typeof step.collapse !== "function") {
        continue;
      }
      tryExpandWithoutGrowingPage(step.expand, step.collapse);
    }
  }

  function tryExpandWithoutGrowingPage(expand, collapse) {
    if (typeof expand !== "function" || typeof collapse !== "function") {
      return false;
    }

    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    const beforeHeight = scrollingElement ? scrollingElement.scrollHeight : 0;
    const beforeTop = scrollingElement ? scrollingElement.scrollTop : 0;

    expand();

    const afterHeight = scrollingElement ? scrollingElement.scrollHeight : 0;
    if (afterHeight <= beforeHeight + 1) {
      return true;
    }

    collapse();
    if (scrollingElement) {
      scrollingElement.scrollTop = beforeTop;
    }
    return false;
  }

  function renderError(meta, text, releaseUrl, error) {
    meta.textContent = "";
    meta.hidden = false;
    const message = document.createElement("p");
    message.className = "bcampx__error";
    message.textContent = `Could not load release details: ${error && error.message ? error.message : "unknown error"}`;

    const link = document.createElement("a");
    link.href = releaseUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open release";

    meta.append(message, link);
    text.textContent = "Extra context failed to load";
  }

  function renderEmpty(meta, text, releaseUrl) {
    meta.textContent = "";
    meta.hidden = false;
    const message = document.createElement("p");
    message.className = "bcampx__empty";
    message.textContent = "No extra metadata found for this release.";

    const link = document.createElement("a");
    link.href = releaseUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open release";

    meta.append(message, link);
    text.textContent = "No extra context available";
  }

  function renderDescriptionContent(container, data) {
    const html = sanitizeDescriptionHtml(data && data.descriptionHtml ? data.descriptionHtml : "");
    if (html) {
      container.innerHTML = html;
      return;
    }

    container.textContent = data && data.description ? data.description : "";
  }

  function normalizeDescriptionContent(container) {
    if (!container) {
      return;
    }

    Array.from(container.querySelectorAll("p")).forEach((paragraph) => {
      if (!cleanText(paragraph.textContent || "")) {
        paragraph.remove();
      }
    });

    Array.from(container.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && !cleanText(node.textContent || "")) {
        node.remove();
      }
    });
  }

  function playSharedTrack(button, track, data, releaseUrl) {
    playTrackForCard(findPlaybackCard(button), button, track, data, releaseUrl);
  }

  function isFullDiscographyReleaseData(data) {
    const title = cleanText(data && data.title);
    return /\bfull(?:\s+digital)?\s+discography\b/i.test(title);
  }

  function playTrackForCard(card, triggerButton, track, data, releaseUrl) {
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
    if (triggerButton && triggerButton.classList && triggerButton.classList.contains("bcampx__track-link")) {
      setActiveTrackButton(triggerButton);
    } else {
      clearActiveTrackButton();
    }
    setActiveTrackContext(track, data, releaseUrl, card, cardArtUrl);
    syncActiveTrackUi(cardArtUrl);
    audio.play().catch(() => {
      clearActiveTrackButton();
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
      STATE.activeTrackButton.classList.remove("bcampx__track-link--active");
      STATE.activeTrackButton = null;
    }
  }

  function syncActiveTrackButton() {
    const audio = ensureSharedAudio();
    if (!audio || audio.paused) {
      clearActiveTrackButton();
    }

    syncCoverPlaybackState();
    updateWaypointPlayPauseButton();
    syncPlayerShell();
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
    if (event.target && event.target.closest && event.target.closest(".bcampx__waypoint-toggle")) {
      return;
    }

    if (!STATE.activeTrackCard || !document.contains(STATE.activeTrackCard)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    scrollCardIntoView(STATE.activeTrackCard, STATE.activeTrack);
  }

  function setActiveTrackCard(card) {
    if (!card || !document.contains(card)) {
      STATE.activeTrackCard = null;
      syncCoverPlaybackState();
      return;
    }

    STATE.activeTrackCard = card;
    syncCoverPlaybackState();
  }

  function getActiveCardArtUrl(card) {
    return getCardArtUrl(card) || (STATE.activeReleaseData && STATE.activeReleaseData.__bcampxCardArtUrl) || "";
  }

  function syncActiveTrackUi(cardArtUrl) {
    syncWaypointNowPlaying(STATE.activeTrack, STATE.activeReleaseData, cardArtUrl);
    syncTrackButtonsForActiveTrack();
    syncCoverPlaybackState();
    syncPlayerShell();
  }

  function syncCoverPlaybackState() {
    if (STATE.coverPlaybackStateNode) {
      STATE.coverPlaybackStateNode.classList.remove("playing", "paused");
      STATE.coverPlaybackStateNode = null;
    }

    const card = STATE.activeTrackCard && document.contains(STATE.activeTrackCard) ? STATE.activeTrackCard : null;
    if (!card) {
      return;
    }

    const stateNode = findCoverPlaybackStateNodeForCard(card);
    if (!stateNode) {
      return;
    }

    STATE.coverPlaybackStateNode = stateNode;
    const audio = ensureSharedAudio();
    if (!audio) {
      return;
    }

    if (audio.paused) {
      stateNode.classList.add("paused");
    } else {
      stateNode.classList.add("playing");
    }
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

  function setActiveTrackContext(track, data, releaseUrl, card, cardArtUrl) {
    STATE.activeTrack = track || null;
    STATE.activeReleaseData = data || null;
    STATE.activeReleaseUrl = releaseUrl || "";
    STATE.activeTrackCard = card || null;

    const tracks = data && Array.isArray(data.tracks) ? data.tracks.filter((item) => item && item.title) : [];
    STATE.activeTrackList = tracks;
    STATE.activeTrackIndex = findTrackIndex(tracks, track);

    if (STATE.activeReleaseData) {
      STATE.activeReleaseData.__bcampxCardArtUrl = cardArtUrl || STATE.activeReleaseData.__bcampxCardArtUrl || "";
    }

    syncPlayerShell();
  }

  function findTrackIndex(tracks, track) {
    if (!Array.isArray(tracks) || !track) {
      return -1;
    }

    const exactIndex = tracks.findIndex((item) => {
      return item && track && item.title === track.title && item.streamUrl === track.streamUrl;
    });
    if (exactIndex >= 0) {
      return exactIndex;
    }

    return tracks.findIndex((item) => item && track && item.title === track.title);
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
      ".tralbum-art-large",
    ];

    let image = null;
    for (const selector of selectors) {
      image = card.querySelector(selector);
      if (image) {
        break;
      }
    }

    return image ? image.currentSrc || image.src || "" : "";
  }

  function findWaypointScrollTarget(card, track) {
    const trackId = cleanText(track && track.trackId);
    if (trackId) {
      const matches = Array.from(document.querySelectorAll(`[data-trackid="${CSS.escape(trackId)}"]`)).filter((node) => {
        return node instanceof HTMLElement && isNodeVisible(node);
      });

      const preferred = matches
        .map((node) => {
          return (
            node.closest(".story-innards.collection-item-container") ||
            node.closest(".collection-item-container") ||
            node.closest(".story") ||
            node
          );
        })
        .find(Boolean);

      if (preferred) {
        return preferred;
      }
    }

    return card || null;
  }

  function scrollCardIntoView(card, track) {
    if (!card) {
      return;
    }

    const target = findWaypointScrollTarget(card, track);
    if (!target) {
      return;
    }

    if (window.Dom && typeof window.Dom.scrollToElement === "function") {
      window.Dom.scrollToElement(target, -30);
      return;
    }

    const cardRect = target.getBoundingClientRect();
    const targetTop = window.scrollY + cardRect.top - 30;
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }

  function ensurePlayerShell() {
    if (STATE.playerUi && STATE.playerHost && document.contains(STATE.playerHost)) {
      return STATE.playerUi;
    }

    if (STATE.playerHost && document.contains(STATE.playerHost)) {
      STATE.playerHost.remove();
    }

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

    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.className = "bcampx-player-button";
    prevButton.textContent = "Previous";
    prevButton.addEventListener("click", playPreviousTrack);

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "bcampx-player-button";
    nextButton.textContent = "Next";
    nextButton.addEventListener("click", playNextTrack);

    const releaseButton = document.createElement("button");
    releaseButton.type = "button";
    releaseButton.className = "bcampx-player-button bcampx-player-button--circle";
    releaseButton.innerHTML = OPEN_ICON_MARKUP;
    releaseButton.setAttribute("aria-label", "Open release");
    releaseButton.addEventListener("click", openActiveRelease);

    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "bcampx-player-button bcampx-player-button--circle bcampx-player-favorite";
    favoriteButton.innerHTML = FAVORITE_ICON_MARKUP;
    favoriteButton.setAttribute("aria-label", "Add to wishlist");
    favoriteButton.setAttribute("aria-pressed", "false");
    favoriteButton.addEventListener("click", toggleActiveWishlist);

    controls.append(prevButton, nextButton, favoriteButton, releaseButton);

    const meta = document.createElement("div");
    meta.className = "bcampx-player-meta";

    const metaPrimary = document.createElement("div");
    const now = document.createElement("div");
    now.className = "bcampx-player-now";
    now.textContent = "Now Playing";

    const trackLink = document.createElement("button");
    trackLink.type = "button";
    trackLink.className = "bcampx-player-track";
    trackLink.textContent = "Select a preview track";
    trackLink.addEventListener("click", scrollToActiveTrackCard);

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
    document.body.append(host);

    STATE.playerUi = {
      host,
      shadowRoot,
      shell,
      prevButton,
      nextButton,
      favoriteButton,
      releaseButton,
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

    ui.shell.hidden = !hasTrack;
    document.documentElement.classList.toggle("bcampx-player-active", hasTrack);
    if (!hasTrack) {
      return;
    }

    const track = STATE.activeTrack;
    const data = STATE.activeReleaseData || {};
    const releaseUrl = STATE.activeReleaseUrl || "#";
    const canGoPrev = findAdjacentPlayableTrackIndex(STATE.activeTrackList, STATE.activeTrackIndex, -1) >= 0;
    const canGoNext = findAdjacentPlayableTrackIndex(STATE.activeTrackList, STATE.activeTrackIndex, 1) >= 0;
    ui.prevButton.disabled = !canGoPrev;
    ui.nextButton.disabled = !canGoNext;
    ui.favoriteButton.disabled = !findActiveWishlistControl();
    ui.releaseButton.disabled = !releaseUrl || releaseUrl === "#";
    ui.trackLink.textContent = `${data.artist || ""}${data.artist && track.title ? " - " : ""}${track.title || data.title || ""}` || "Select a preview track";
    ui.storeLink.textContent = data.title && data.artist ? `${data.title} / ${data.artist}` : data.title || data.artist || "No track selected";
    ui.storeLink.href = releaseUrl;
    attachSharedAudioToPlayer(ui.nativeAudio, audio);
    syncFavoriteButtonState();
  }

  function playPreviousTrack() {
    playAdjacentTrack(-1);
  }

  function playNextTrack() {
    playAdjacentTrack(1);
  }

  function playAdjacentTrack(offset) {
    if (!Array.isArray(STATE.activeTrackList) || STATE.activeTrackIndex < 0) {
      return;
    }

    const nextIndex = findAdjacentPlayableTrackIndex(STATE.activeTrackList, STATE.activeTrackIndex, offset);
    if (nextIndex < 0) {
      return;
    }

    const nextTrack = STATE.activeTrackList[nextIndex];
    if (!nextTrack || !nextTrack.streamUrl) {
      return;
    }

    const card = STATE.activeTrackCard;
    const cardArtUrl = getActiveCardArtUrl(card);
    STATE.activeTrackIndex = nextIndex;
    STATE.activeTrack = nextTrack;

    const audio = ensureSharedAudio();
    if (!audio) {
      return;
    }

    audio.src = nextTrack.streamUrl;
    syncActiveTrackUi(cardArtUrl);
    audio.play().catch(() => {});
    syncFavoriteButtonState();
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

  function syncTrackButtonsForActiveTrack() {
    clearActiveTrackButton();
    const streamUrl = STATE.activeTrack && STATE.activeTrack.streamUrl;
    if (!streamUrl) {
      return;
    }

    const activeButton = Array.from(document.querySelectorAll(".bcampx__track-link")).find((button) => {
      return button.dataset.streamUrl === streamUrl;
    });

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

  function scrollToActiveTrackCard() {
    if (!STATE.activeTrackCard || !document.contains(STATE.activeTrackCard)) {
      return;
    }

    scrollCardIntoView(STATE.activeTrackCard, STATE.activeTrack);
  }

  function attachSharedAudioToPlayer(container, audio) {
    if (!container || !audio) {
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
    return `
      .bcampx-player-shell {
        position: fixed;
        left: 50%;
        bottom: 18px;
        width: min(920px, calc(100vw - 36px));
        transform: translateX(-50%);
        pointer-events: auto;
        padding: 14px;
        border: 1px solid rgba(190, 198, 204, 0.68);
        border-radius: 18px;
        background: rgba(247, 247, 247, 0.98);
        box-shadow: 0 18px 40px rgba(36, 28, 20, 0.12);
        color: #2f2f2f;
        overflow: hidden;
        isolation: isolate;
        contain: paint;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }

      .bcampx-player-controls {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
      }

      .bcampx-player-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 80px;
        min-height: 38px;
        padding: 8px 12px;
        border: solid 1px #dedede;
        border-radius: 999px;
        background-color: #fbfcfd;
        background-image: none;
        color: #408294;
        font: 700 13px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
        cursor: pointer;
        white-space: nowrap;
        text-align: center;
        outline: none;
        box-shadow: none;
      }

      .bcampx-player-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .bcampx-player-button--circle {
        width: 38px;
        min-width: 38px;
        min-height: 38px;
        padding: 0;
      }

      .bcampx-player-button--circle svg {
        width: 18px;
        height: 18px;
        display: block;
        flex: 0 0 auto;
      }

      .bcampx-player-button:hover {
        text-decoration: none;
        background-color: #f3f7f9;
      }

      .bcampx-player-favorite {
        color: #408294;
        position: relative;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, background-image 120ms ease;
      }

      .bcampx-player-favorite-outline,
      .bcampx-player-favorite-fill {
        transition: opacity 120ms ease;
      }

      .bcampx-player-favorite-fill {
        opacity: 0;
      }

      .bcampx-player-favorite.active {
        border: solid 1px #e06d2f;
        background-color: #e06d2f;
        background-image: none;
        color: #fff;
      }

      .bcampx-player-favorite.active:hover,
      .bcampx-player-button--circle:hover {
        border-color: #b8c6cf;
        background-color: #f3f7f9;
        color: #408294;
      }

      .bcampx-player-favorite.active:hover {
        border-color: #d66428;
        background-color: #d66428;
        color: #fff;
      }

      .bcampx-player-favorite.active .bcampx-player-favorite-outline {
        opacity: 0;
      }

      .bcampx-player-favorite.active .bcampx-player-favorite-fill {
        opacity: 1;
      }

      .bcampx-player-meta {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-bottom: 8px;
      }

      .bcampx-player-now {
        display: inline-block;
        margin-bottom: 5px;
        font-size: 12px;
        line-height: 1;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #777;
      }

      .bcampx-player-track {
        display: block;
        padding: 0;
        border: 0;
        background: transparent;
        color: #2f2f2f;
        font: 700 16px/1.04 "Helvetica Neue", Helvetica, Arial, sans-serif;
        text-align: left;
        cursor: pointer;
      }

      .bcampx-player-track:hover,
      .bcampx-player-store:hover {
        text-decoration: underline;
      }

      .bcampx-player-store {
        color: #6b6b6b;
        text-decoration: none;
        font: 500 13px/1.05 "Helvetica Neue", Helvetica, Arial, sans-serif;
        text-align: right;
        white-space: nowrap;
      }

      .bcampx-player-native {
        margin-top: 2px;
        background: transparent;
      }

      .bcampx-player-audio {
        width: 100%;
        height: 40px;
        border-radius: 10px;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: static !important;
        pointer-events: auto !important;
      }

      @media (max-width: 820px) {
        .bcampx-player-shell {
          left: 50%;
          bottom: 10px;
          width: min(920px, calc(100vw - 20px));
          transform: translateX(-50%);
          padding: 10px 12px;
          border-radius: 16px;
        }

        .bcampx-player-controls {
          gap: 6px;
          margin-bottom: 8px;
        }

        .bcampx-player-button {
          min-height: 34px;
          min-width: 74px;
          padding: 7px 10px;
          font-size: 12px;
        }

        .bcampx-player-button--circle {
          width: 34px;
          min-width: 34px;
          min-height: 34px;
        }

        .bcampx-player-button--circle svg {
          width: 17px;
          height: 17px;
        }

        .bcampx-player-meta {
          gap: 8px;
          margin-bottom: 7px;
        }

        .bcampx-player-track {
          font-size: 15px;
          line-height: 1.03;
        }

        .bcampx-player-store,
        .bcampx-player-now {
          font-size: 11px;
        }

        .bcampx-player-now {
          margin-bottom: 4px;
        }

        .bcampx-player-audio {
          height: 36px;
        }
      }
    `;
  }

  function pauseBandcampPageAudio() {
    if (STATE.pageAudio && STATE.pageAudio !== STATE.sharedAudio && typeof STATE.pageAudio.pause === "function") {
      STATE.pageAudio.pause();
    }
  }

  function findActiveWishlistControl() {
    if (!STATE.activeTrackCard) {
      return null;
    }

    const collectRoot =
      STATE.activeTrackCard.querySelector(".collect-item") ||
      STATE.activeTrackCard.querySelector(".tralbum-wrapper-collect-controls") ||
      STATE.activeTrackCard;

    if (!collectRoot) {
      return null;
    }

    return (
      findVisibleNode(collectRoot, ".wishlisted-msg") ||
      findVisibleNode(collectRoot, ".wishlist-msg") ||
      Array.from(collectRoot.querySelectorAll("a, button")).find((node) => isNodeVisible(node) && /^\s*in wishlist\s*$/i.test((node.textContent || "").trim())) ||
      Array.from(collectRoot.querySelectorAll("a, button")).find((node) => isNodeVisible(node) && /^\s*wishlist\s*$/i.test((node.textContent || "").trim())) ||
      Array.from(collectRoot.querySelectorAll("a, button")).find((node) => isNodeVisible(node) && /wishlist/i.test((node.textContent || "").trim()))
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
      (control.classList.contains("wishlisted-msg") && isNodeVisible(control))
    );
  }

  function findVisibleNode(root, selector) {
    return Array.from(root.querySelectorAll(selector)).find((node) => isNodeVisible(node)) || null;
  }

  function isNodeVisible(node) {
    if (!node) {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
      return false;
    }

    return Boolean(node.offsetParent || node.getClientRects().length);
  }

  function syncFavoriteButtonState() {
    const ui = STATE.playerUi;
    if (!ui || !ui.favoriteButton) {
      return;
    }

    const wishlistControl = findActiveWishlistControl();
    const active = isWishlistActive(wishlistControl);
    ui.favoriteButton.classList.toggle("active", active);
    ui.favoriteButton.setAttribute("aria-pressed", active ? "true" : "false");
    ui.favoriteButton.setAttribute("aria-label", active ? "Remove from wishlist" : "Add to wishlist");
  }

  function toggleActiveWishlist() {
    const ui = STATE.playerUi;
    const wishlistControl = findActiveWishlistControl();
    if (!wishlistControl) {
      return;
    }

    if (ui && ui.favoriteButton) {
      const nextActive = ui.favoriteButton.getAttribute("aria-pressed") !== "true";
      ui.favoriteButton.classList.toggle("active", nextActive);
      ui.favoriteButton.setAttribute("aria-pressed", nextActive ? "true" : "false");
      ui.favoriteButton.setAttribute("aria-label", nextActive ? "Remove from wishlist" : "Add to wishlist");
    }

    wishlistControl.click();
    window.setTimeout(syncFavoriteButtonState, 60);
    window.setTimeout(syncFavoriteButtonState, 260);
    window.setTimeout(syncFavoriteButtonState, 700);
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

    const button = existingButton || waypoint.querySelector(".bcampx__waypoint-toggle");
    if (!button) {
      return;
    }

    const audio = ensureSharedAudio();
    const isPaused = !audio || audio.paused;
    button.textContent = isPaused ? "Play" : "Pause";
    button.setAttribute("aria-label", isPaused ? "Play" : "Pause");
    button.classList.toggle("bcampx__waypoint-toggle--paused", isPaused);
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .bcampx {
        box-sizing: border-box;
        margin: 6px 0 0;
        padding: 0;
        max-width: 360px;
        color: #444;
        font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .bcampx * {
        box-sizing: border-box;
      }

      .bcampx__meta {
        display: block;
        color: #555;
        padding-top: 4px;
      }

      .bcampx__summary {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 4px;
        color: #777;
      }

      .bcampx--supported-slot {
        max-width: none;
        margin: 0;
        padding: 0;
      }

      .bcampx--supported-slot .bcampx__meta {
        padding: 0;
        max-width: none;
        color: #5d5d5d;
        font: 400 12px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      .bcampx__slot-panel {
        padding: 0;
        border-left: 0;
      }

      .bcampx__summary-text {
        min-width: 0;
      }

      .bcampx__merge-note {
        margin: 1px 0 7px;
        color: #8a8a8a;
        font: 400 12px/1.34 "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      .bcampx__merge-fan {
        color: #6d6d6d;
        font-weight: 600;
      }

      .bcampx__merge-copy {
        color: #8a8a8a;
      }

      .bcampx__merge-track {
        color: #4085b6;
        text-decoration: none;
      }

      .bcampx__toggle {
        cursor: pointer;
        padding: 0;
        border: 0;
        background: transparent;
        color: #4085b6;
        font: inherit;
        text-decoration: underline;
      }

      .bcampx__toggle:disabled {
        cursor: progress;
        opacity: 0.68;
      }

      .bcampx__facts {
        color: #666;
      }

      .bcampx__slot-header {
        margin: 0 0 7px;
        color: #757575;
        font-size: 10px;
        line-height: 1.2;
        font-weight: 600;
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }

      .bcampx__slot-subhead {
        margin: 8px 0 0;
        color: #949494;
        font-size: 11px;
        font-weight: 400;
      }

      .bcampx__description {
        margin: 6px 0 0;
        color: #333;
        white-space: pre-line;
      }

      .bcampx__tracks {
        display: none;
        margin: 6px 0 0 18px;
        padding: 0;
      }

      .bcampx--expanded .bcampx__tracks {
        display: block;
      }

      .bcampx__tracks li {
        margin: 2px 0;
      }

      .bcampx__tracks--slot {
        display: block;
        margin: 0;
        padding-left: 0;
        list-style: none;
        counter-reset: bcampxTrackNumber;
        color: #4a4a4a;
        font-size: 12px;
        font-weight: 400;
      }

      .bcampx__tracks--slot li {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) 42px;
        column-gap: 7px;
        align-items: start;
        margin: 0;
        padding: 2px 0 5px;
        line-height: 1.28;
        border-top: 0;
      }

      .bcampx__tracks--slot li:first-child {
        border-top: 0;
        padding-top: 0;
      }

      .bcampx__tracks--slot.bcampx__tracks--collapsed .bcampx__track-item--extra {
        display: none;
      }

      .bcampx__tracks--slot li::before {
        counter-increment: bcampxTrackNumber;
        content: counter(bcampxTrackNumber) ".";
        color: #aaaaaa;
        font-variant-numeric: tabular-nums;
        align-self: start;
        justify-self: start;
        padding-top: 1px;
      }

      .bcampx__track-item--purchased::before {
        color: #4085b6;
        font-weight: 700;
      }

      .bcampx__track-link {
        cursor: pointer;
        display: block;
        width: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: inherit;
        text-align: left;
        text-decoration: none;
        min-width: 0;
        margin: 0;
      }

      .bcampx__track-link:hover {
        color: #4085b6;
        text-decoration: underline;
      }

      .bcampx__track-link--active {
        color: #4085b6;
        font-weight: 400;
        text-decoration: underline;
      }

      .bcampx__track-item--purchased .bcampx__track-link {
        color: #333;
        font-weight: 600;
      }

      .bcampx__track-duration {
        color: #a0a0a0;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        padding-top: 1px;
        text-align: right;
        opacity: 0.88;
        align-self: start;
      }

      .bcampx__track-link:disabled {
        cursor: default;
        opacity: 0.55;
      }


      .bcampx__description--slot {
        margin-top: 10px;
        color: #757575;
        font-size: 12px;
        line-height: 1.4;
        white-space: normal;
      }

      .bcampx__description-block {
        display: block;
        margin-top: 10px;
        padding-top: 0;
        border-top: 0;
      }

      .bcampx__description--slot p {
        margin: 0 0 5px;
      }

      .bcampx__description--slot p:last-child {
        margin-bottom: 0;
      }

      .bcampx__description--slot.bcampx__description--collapsed {
        max-height: calc(1.35em * 4);
        overflow: hidden;
      }

      .bcampx__description--slot a {
        color: #4085b6;
        text-decoration: none;
      }

      .bcampx__description--slot a:hover {
        text-decoration: underline;
      }

      .bcampx__slot-expand {
        display: inline-block;
        margin-top: 3px;
        padding: 0;
        border: 0;
        background: transparent;
        color: #6f8eaa;
        font: 400 11px/1.2 "Helvetica Neue", Helvetica, Arial, sans-serif;
        cursor: pointer;
        text-decoration: none;
      }


      .bcampx__slot-expand:hover {
        color: #4085b6;
        text-decoration: underline;
      }

      #track_play_waypoint {
        display: none !important;
      }

      .bcampx__waypoint-toggle {
        position: absolute;
        right: -18px;
        top: 50%;
        transform: translateY(-50%);
        min-width: 62px;
        padding: 6px 14px;
        border: 1px solid rgba(255, 255, 255, 0.65);
        border-radius: 999px;
        background: rgba(120, 120, 120, 0.92);
        color: #fff;
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
        z-index: 4;
      }

      .bcampx__waypoint-toggle:hover {
        background: rgba(105, 105, 105, 0.98);
      }

      .bcampx__waypoint-toggle--paused {
        background: rgba(132, 132, 132, 0.9);
      }


      .bcampx__link {
        display: inline-block;
        margin-top: 8px;
        color: #4085b6;
        text-decoration: none;
        font-size: 13px;
        font-weight: 600;
      }

      .bcampx__link:hover {
        text-decoration: underline;
      }

      .bcampx__error,
      .bcampx__empty {
        margin: 0 0 6px;
        color: #7a4b00;
      }

      .bcampx--loading {
        opacity: 0.78;
      }
    `;
    document.head.appendChild(style);
  }

  function storageGet(key, fallback) {
    try {
      if (typeof GM_getValue === "function") {
        return Promise.resolve(GM_getValue(key, fallback));
      }
    } catch (_error) {
      return Promise.resolve(fallback);
    }

    return Promise.resolve(fallback);
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        return Promise.resolve(GM_setValue(key, value));
      }
    } catch (_error) {
      return Promise.resolve();
    }

    return Promise.resolve();
  }

  function metaContent(doc, selector) {
    return attrContent(doc, selector, "content");
  }

  function extractDescriptionHtml(doc) {
    const descriptionNode = doc.querySelector(".tralbum-about, .album-about");
    if (!descriptionNode) {
      return "";
    }

    return sanitizeDescriptionHtml(descriptionNode.innerHTML || "");
  }

  function sanitizeDescriptionHtml(rawHtml) {
    if (!rawHtml) {
      return "";
    }

    const parsed = new DOMParser().parseFromString(`<div>${rawHtml}</div>`, "text/html");
    const root = parsed.body.firstElementChild;
    if (!root) {
      return "";
    }

    const allowedTags = new Set(["A", "BR", "P", "EM", "STRONG", "B", "I"]);

    const sanitizeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return parsed.createTextNode(node.textContent || "");
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }

      const tagName = node.tagName.toUpperCase();
      if (!allowedTags.has(tagName)) {
        const fragment = parsed.createDocumentFragment();
        Array.from(node.childNodes).forEach((child) => {
          const sanitizedChild = sanitizeNode(child);
          if (sanitizedChild) {
            fragment.appendChild(sanitizedChild);
          }
        });
        return fragment;
      }

      const cleanNode = parsed.createElement(tagName.toLowerCase());
      if (tagName === "A") {
        const href = node.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) {
          cleanNode.setAttribute("href", href);
          cleanNode.setAttribute("target", "_blank");
          cleanNode.setAttribute("rel", "noopener noreferrer");
        }
      }

      Array.from(node.childNodes).forEach((child) => {
        const sanitizedChild = sanitizeNode(child);
        if (sanitizedChild) {
          cleanNode.appendChild(sanitizedChild);
        }
      });

      return cleanNode;
    };

    const fragment = parsed.createDocumentFragment();
    Array.from(root.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(child);
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild);
      }
    });

    const wrapper = parsed.createElement("div");
    wrapper.appendChild(fragment);
    return wrapper.innerHTML.trim();
  }

  function plainTextToDescriptionHtml(value, maxLength) {
    const raw = String(value || "").replace(/\r\n/g, "\n").trim();
    if (!raw) {
      return "";
    }

    const shortened = raw.length > maxLength ? `${raw.slice(0, maxLength - 3).trim()}...` : raw;
    const escaped = escapeHtml(shortened);
    const linked = escaped.replace(/(https?:\/\/[^\s<]+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return linked
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function descriptionHtmlToText(value) {
    const html = String(value || "").trim();
    if (!html) {
      return "";
    }

    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    return cleanText(parsed.body.textContent || "");
  }

  function isLikelyTracklistHtml(value, tracks) {
    return isLikelyTracklistText(descriptionHtmlToText(value), tracks);
  }

  function isLikelyTracklistDescription(data) {
    if (!data) {
      return false;
    }

    return isLikelyTracklistText(data.description || "", data.tracks) || isLikelyTracklistHtml(data.descriptionHtml || "", data.tracks);
  }

  function isLikelyTracklistText(value, tracks) {
    const text = String(value || "").trim();
    if (!text || !Array.isArray(tracks) || tracks.length < 1) {
      return false;
    }

    const normalized = cleanText(text).toLowerCase();
    const numberedItems = (text.match(/\b\d+\.\s+/g) || []).length;
    const matchingTrackTitles = tracks.filter((track) => {
      const title = cleanText(track && track.title ? track.title : "").toLowerCase();
      return title && normalized.includes(title);
    }).length;

    const hasReleaseSummaryShape = /\bby\b.+\breleased\b/i.test(text) || /\breleased\s+\d{1,2}\s+\w+\s+\d{4}\b/i.test(text);
    const isSingleTrackAutoSummary =
      tracks.length === 1 &&
      hasReleaseSummaryShape &&
      matchingTrackTitles >= 1 &&
      numberedItems >= 1;

    if (isSingleTrackAutoSummary) {
      return true;
    }

    if (matchingTrackTitles >= Math.min(4, tracks.length) && numberedItems >= 2) {
      return true;
    }

    if (hasReleaseSummaryShape && matchingTrackTitles >= Math.min(2, tracks.length) && numberedItems >= 1) {
      return true;
    }

    return false;
  }

  function attrContent(doc, selector, attrName) {
    const node = doc.querySelector(selector);
    return node ? cleanText(node.getAttribute(attrName) || "") : "";
  }

  function textContent(doc, selector) {
    const node = doc.querySelector(selector);
    return node ? normalizedText(node) : "";
  }

  function queryTexts(doc, selector) {
    return Array.from(doc.querySelectorAll(selector))
      .map((node) => normalizedText(node))
      .filter(Boolean);
  }

  function normalizedText(node) {
    return cleanText(node.textContent || "");
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cleanTitle(value) {
    return cleanText(String(value || "").replace(/\s*\|\s*Bandcamp\s*$/i, ""));
  }

  function firstString(value) {
    return typeof value === "string" && value.trim() ? cleanText(value) : "";
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];

    values.forEach((value) => {
      const cleaned = cleanText(value);
      const key = cleaned.toLowerCase();
      if (!cleaned || seen.has(key)) {
        return;
      }

      seen.add(key);
      result.push(cleaned);
    });

    return result;
  }

  function truncate(value, maxLength) {
    const text = cleanText(value);
    if (!text || text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength - 3).trim()}...`;
  }

  function compactJoin(values, separator) {
    return values.map(cleanText).filter(Boolean).join(separator);
  }

  function formatReleaseDate(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return cleanText(value);
    }

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function buildSummaryText(data) {
    const parts = [];
    if (data.description) {
      parts.push("Description");
    }
    if (data.tracks && data.tracks.length) {
      parts.push(`${data.tracks.length} tracks`);
    }
    return parts.length ? parts.join(" · ") : "Extra context loaded";
  }

  function hasExpandableContent(data) {
    return Boolean(data.tracks && data.tracks.length);
  }

  function hasVisibleEnhancements(data) {
    return Boolean(formatReleaseDate(data.releaseDate) || data.location || data.description || (data.tracks && data.tracks.length));
  }

  function decodeJsString(value) {
    try {
      return JSON.parse(`"${value}"`);
    } catch (_error) {
      return cleanText(value);
    }
  }
})();
