// ==UserScript==
// @name         Bandcamplifier
// @namespace    https://github.com/chuan-p/bcamplifier
// @version      0.2.8
// @description  Improve the Bandcamp feed with release metadata, track playback, wishlist actions, and purchase shortcuts.
// @author       chuan
// @match        https://bandcamp.com/feed*
// @match        https://bandcamp.com/*/feed*
// @match        https://bandcamp.com/*
// @match        https://*.bandcamp.com/*
// @match        https://*/album/*
// @match        https://*/track/*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-idle
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/573187/Bandcamp%20Feed%20Enhancer.user.js
// @updateURL https://update.greasyfork.org/scripts/573187/Bandcamp%20Feed%20Enhancer.meta.js
// ==/UserScript==

(function () {
    "use strict";

    const PLAYER_SHELL_CSS = ".bcampx-player-shell {\n        position: fixed;\n        left: 50%;\n        bottom: 18px;\n        width: min(920px, calc(100vw - 36px));\n        transform: translateX(-50%);\n        pointer-events: auto;\n        padding: 14px;\n        border: 1px solid rgba(190, 198, 204, 0.68);\n        border-radius: 18px;\n        background: rgba(247, 247, 247, 0.98);\n        box-shadow: 0 18px 40px rgba(36, 28, 20, 0.12);\n        color: #2f2f2f;\n        overflow: visible;\n        isolation: isolate;\n        font-family: \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n        backdrop-filter: blur(6px);\n        -webkit-backdrop-filter: blur(6px);\n      }\n\n      .bcampx-player-controls {\n        display: flex;\n        gap: 8px;\n        align-items: center;\n        margin-bottom: 10px;\n      }\n\n      .bcampx-player-button {\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        min-width: 80px;\n        min-height: 38px;\n        padding: 8px 12px;\n        border: solid 1px #dedede;\n        border-radius: 999px;\n        background-color: #fbfcfd;\n        background-image: none;\n        color: #408294;\n        font: 700 13px/1 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n        cursor: pointer;\n        white-space: nowrap;\n        text-align: center;\n        outline: none;\n        box-shadow: none;\n      }\n\n      .bcampx-player-button:disabled {\n        opacity: 0.4;\n        cursor: not-allowed;\n      }\n\n      .bcampx-player-button--circle {\n        width: 38px;\n        min-width: 38px;\n        min-height: 38px;\n        padding: 0;\n      }\n\n      .bcampx-player-button--circle svg {\n        width: 18px;\n        height: 18px;\n        display: block;\n        flex: 0 0 auto;\n      }\n\n      .bcampx-player-settings {\n        position: relative;\n        margin-left: auto;\n        display: flex;\n        align-items: center;\n        flex: 0 0 auto;\n      }\n\n      .bcampx-player-settings-toggle {\n        color: #408294;\n        border-color: #dedede;\n        background-color: #fbfcfd;\n      }\n\n      .bcampx-player-settings-toggle svg {\n        width: 19px;\n        height: 19px;\n      }\n\n      .bcampx-player-settings-toggle:hover {\n        border-color: #b8c6cf;\n        background-color: #f3f7f9;\n        color: #408294;\n      }\n\n      .bcampx-player-settings-menu {\n        position: absolute;\n        bottom: calc(100% + 8px);\n        right: 0;\n        z-index: 20;\n        min-width: 220px;\n        padding: 12px 13px;\n        border: 1px solid rgba(190, 198, 204, 0.9);\n        border-radius: 12px;\n        background: rgba(251, 252, 253, 0.98);\n        box-shadow: 0 14px 32px rgba(36, 28, 20, 0.14);\n        color: #2f2f2f;\n        max-height: min(55vh, 420px);\n        overflow: auto;\n      }\n\n      .bcampx-player-settings-row {\n        display: flex;\n        align-items: flex-start;\n        justify-content: space-between;\n        gap: 10px;\n        padding: 8px 0;\n        cursor: pointer;\n      }\n\n      .bcampx-player-settings-row + .bcampx-player-settings-row {\n        border-top: 1px solid rgba(222, 222, 222, 0.85);\n      }\n\n      .bcampx-player-settings-copy {\n        display: flex;\n        flex-direction: column;\n        gap: 3px;\n        min-width: 0;\n      }\n\n      .bcampx-player-settings-label {\n        color: #2f2f2f;\n        font: 700 13px/1.35 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n      }\n\n      .bcampx-player-settings-description {\n        color: #666;\n        font: 500 12px/1.4 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n      }\n\n      .bcampx-player-settings-checkbox {\n        margin: 2px 0 0;\n        inline-size: 14px;\n        block-size: 14px;\n        accent-color: #408294;\n        flex: 0 0 auto;\n      }\n\n      .bcampx-player-settings-footer {\n        margin-top: 8px;\n        padding-top: 10px;\n        border-top: 1px solid rgba(222, 222, 222, 0.85);\n        color: #777;\n        font: 500 11px/1.45 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n      }\n\n      .bcampx-player-settings-footer-link {\n        color: #408294;\n        text-decoration: none;\n      }\n\n      .bcampx-player-settings-footer-link:hover {\n        text-decoration: underline;\n      }\n\n      .bcampx-player-button:hover {\n        text-decoration: none;\n        background-color: #f3f7f9;\n      }\n\n      .bcampx-player-favorite {\n        color: #408294;\n        position: relative;\n        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, background-image 120ms ease;\n      }\n\n      .bcampx-player-favorite-outline,\n      .bcampx-player-favorite-fill {\n        transition: opacity 120ms ease;\n      }\n\n      .bcampx-player-favorite-fill {\n        opacity: 0;\n      }\n\n    .bcampx-player-favorite.active {\n      border: solid 1px #e06d2f;\n      background-color: #e06d2f;\n      background-image: none;\n      color: #fff;\n    }\n\n      .bcampx-player-favorite.active.bcampx-player-favorite--owned {\n        border: solid 1px #CB2D26;\n        background-color: #CB2D26;\n        background-image: none;\n        color: #fff;\n      }\n\n      .bcampx-player-favorite.active.bcampx-player-favorite--owned:disabled {\n       opacity: 1;\n       cursor: default;\n     }\n\n      .bcampx-player-favorite.active.bcampx-player-favorite--owned:hover {\n        border-color: #CB2D26;\n        background-color: #CB2D26;\n        color: #fff;\n      }\n\n    .bcampx-player-favorite.active:hover,\n     .bcampx-player-button--circle:hover {\n        border-color: #b8c6cf;\n        background-color: #f3f7f9;\n        color: #408294;\n      }\n\n      .bcampx-player-favorite.active:hover {\n        border-color: #d66428;\n        background-color: #d66428;\n        color: #fff;\n      }\n\n      .bcampx-player-favorite.active .bcampx-player-favorite-outline {\n        opacity: 0;\n      }\n\n      .bcampx-player-favorite.active .bcampx-player-favorite-fill {\n        opacity: 1;\n      }\n\n      .bcampx-player-meta {\n        display: flex;\n        justify-content: space-between;\n        align-items: baseline;\n        gap: 12px;\n        margin-bottom: 8px;\n      }\n\n      .bcampx-player-now {\n        display: inline-block;\n        margin-bottom: 5px;\n        font-size: 12px;\n        line-height: 1;\n        letter-spacing: 0.05em;\n        text-transform: uppercase;\n        color: #777;\n      }\n\n      .bcampx-player-track {\n        display: block;\n        padding: 0;\n        border: 0;\n        background: transparent;\n        color: #2f2f2f;\n        font: 700 16px/1.04 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n        text-align: left;\n        cursor: pointer;\n      }\n\n      .bcampx-player-track:hover,\n      .bcampx-player-store:hover {\n        text-decoration: underline;\n      }\n\n      .bcampx-player-store {\n        color: #6b6b6b;\n        text-decoration: none;\n        font: 500 13px/1.05 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n        text-align: right;\n        white-space: nowrap;\n      }\n\n      .bcampx-player-native {\n        margin-top: 2px;\n        background: transparent;\n      }\n\n      .bcampx-player-audio {\n        width: 100%;\n        height: 40px;\n        border-radius: 10px;\n        display: block !important;\n        visibility: visible !important;\n        opacity: 1 !important;\n        position: static !important;\n        pointer-events: auto !important;\n      }\n\n      @media (max-width: 820px) {\n        .bcampx-player-shell {\n          left: 50%;\n          bottom: 10px;\n          width: min(920px, calc(100vw - 20px));\n          transform: translateX(-50%);\n          padding: 10px 12px;\n          border-radius: 16px;\n        }\n\n        .bcampx-player-controls {\n          gap: 6px;\n          margin-bottom: 8px;\n        }\n\n        .bcampx-player-button {\n          min-height: 34px;\n          min-width: 74px;\n          padding: 7px 10px;\n          font-size: 12px;\n        }\n\n        .bcampx-player-button--circle {\n          width: 34px;\n          min-width: 34px;\n          min-height: 34px;\n        }\n\n        .bcampx-player-button--circle svg {\n          width: 17px;\n          height: 17px;\n        }\n\n        .bcampx-player-settings-menu {\n          min-width: 200px;\n          padding: 11px 12px;\n        }\n\n        .bcampx-player-settings-toggle svg {\n          width: 18px;\n          height: 18px;\n        }\n\n        .bcampx-player-meta {\n          gap: 8px;\n          margin-bottom: 7px;\n        }\n\n        .bcampx-player-track {\n          font-size: 15px;\n          line-height: 1.03;\n        }\n\n        .bcampx-player-store,\n        .bcampx-player-now {\n          font-size: 11px;\n        }\n\n        .bcampx-player-now {\n          margin-bottom: 4px;\n        }\n\n        .bcampx-player-audio {\n          height: 36px;\n        }\n      }\n";
    const ENHANCEMENT_CSS = ".bcampx {\n        box-sizing: border-box;\n        margin: 6px 0 0;\n        padding: 0;\n        max-width: 360px;\n        color: #444;\n        font: 12px/1.5 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n      }\n\n      .bcampx * {\n        box-sizing: border-box;\n      }\n\n      .bcampx-label-feed {\n        box-sizing: border-box;\n        width: 100%;\n        max-width: 940px;\n        margin: 0 0 28px;\n        padding: 0;\n      }\n\n      .bcampx-label-feed__list {\n        margin: 0;\n        padding: 0;\n        list-style: none;\n      }\n\n      .bcampx-label-feed-page--enhanced .label-band-selector.fade-in-on-load {\n        display: none !important;\n      }\n\n      .bcampx-label-feed-native-offscreen {\n        position: absolute !important;\n        left: -10000px !important;\n        top: auto !important;\n        width: 1px !important;\n        height: 1px !important;\n        max-width: 1px !important;\n        max-height: 1px !important;\n        overflow: hidden !important;\n        opacity: 0 !important;\n        pointer-events: none !important;\n      }\n\n      .bcampx-label-feed-card {\n        box-sizing: border-box;\n        display: block;\n        width: 100%;\n        min-height: 150px;\n        content-visibility: auto;\n        contain-intrinsic-size: auto 260px;\n        margin: 0 0 16px;\n        padding: 15px 18px;\n        border: 1px solid rgba(0, 0, 0, 0.12);\n        border-radius: 3px;\n        background: rgba(255, 255, 255, 0.92);\n        color: #333;\n        font: 400 13px/1.35 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n      }\n\n      .bcampx-label-feed-card * {\n        box-sizing: border-box;\n      }\n\n      .bcampx-label-feed-card .bcampx-label-feed-card__story-title {\n        display: none !important;\n      }\n\n      .bcampx-label-feed-card .story-title a {\n        color: #4085b6 !important;\n        font: inherit !important;\n        font-weight: 600 !important;\n        text-decoration: none !important;\n      }\n\n      .bcampx-label-feed-card .story-title a:hover {\n        text-decoration: underline !important;\n      }\n\n      .bcampx-label-feed-card .tralbum-wrapper {\n        display: grid;\n        grid-template-columns: 200px minmax(180px, 1fr) minmax(220px, 280px);\n        gap: 18px;\n        align-items: start;\n      }\n\n      .bcampx-label-feed-card .art img {\n        display: block;\n        width: 200px;\n        height: 200px;\n        object-fit: cover;\n      }\n\n      .bcampx-label-feed-card .tralbum-wrapper-col1,\n      .bcampx-label-feed-card .tralbum-wrapper-col2 {\n        min-width: 0;\n      }\n\n      .bcampx-label-feed-card .item-link {\n        color: #222 !important;\n        font: 700 15px/1.25 \"Helvetica Neue\", Helvetica, Arial, sans-serif !important;\n        text-decoration: none !important;\n      }\n\n      .bcampx-label-feed-card .item-link:hover,\n      .bcampx-label-feed-card .buy-link:hover {\n        text-decoration: underline !important;\n      }\n\n      .bcampx-label-feed-card .itemsubtext {\n        margin-top: 4px !important;\n        color: #777 !important;\n        font: 400 12px/1.35 \"Helvetica Neue\", Helvetica, Arial, sans-serif !important;\n      }\n\n      .bcampx-label-feed-card .buy-link {\n        display: inline-block;\n        margin-top: 8px !important;\n        border: 0 !important;\n        background: transparent !important;\n        padding: 0 !important;\n        color: #4085b6 !important;\n        font: 400 12px/1.35 \"Helvetica Neue\", Helvetica, Arial, sans-serif !important;\n        text-decoration: none !important;\n        cursor: pointer !important;\n      }\n\n      .bcampx-label-feed-card .buy-link:disabled,\n      .bcampx-label-feed-card .buy-link:disabled:hover {\n        color: #777 !important;\n        cursor: default !important;\n        text-decoration: none !important;\n      }\n\n      .bcampx-label-feed-card .tralbum-owners {\n        color: #5d5d5d;\n        font: 400 12px/1.35 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n      }\n\n      .bcampx-label-feed-card .bcampx--supported-slot {\n        width: 100%;\n      }\n\n      .bcampx-label-feed-card .bcampx--supported-slot.bcampx--expanded {\n        content-visibility: auto;\n        contain-intrinsic-size: auto 360px;\n      }\n\n      .bcampx-label-feed-toggle {\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        width: auto;\n        height: 22px;\n        min-height: 22px;\n        margin: 0 8px 10px 0;\n        padding: 1px;\n        border: 1px solid rgba(0, 0, 0, 0.13);\n        border-radius: 3px;\n        background: rgba(255, 255, 255, 0.9);\n        box-shadow: none;\n        color: #777;\n        cursor: pointer;\n        vertical-align: middle;\n      }\n\n      .bcampx-label-feed-toggle__icon {\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        width: 22px;\n        height: 18px;\n        border-radius: 2px;\n        color: #777;\n      }\n\n      .bcampx-label-feed-toggle__icon + .bcampx-label-feed-toggle__icon {\n        margin-left: 2px;\n      }\n\n      .bcampx-label-feed-toggle--feed .bcampx-label-feed-toggle__icon--feed,\n      .bcampx-label-feed-toggle--original .bcampx-label-feed-toggle__icon--original {\n        color: #fff;\n        background: rgba(64, 133, 182, 0.86);\n      }\n\n      .bcampx-label-feed-toggle svg {\n        display: block;\n      }\n\n      .bcampx-label-feed-toggle--floating {\n        position: fixed;\n        left: 14px;\n        bottom: 14px;\n        z-index: 2147483645;\n        margin: 0;\n        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.16);\n      }\n\n      .bcampx-label-feed-toggle--inline {\n        position: static;\n      }\n\n      .bcampx-label-feed-toggle--navbar {\n        margin: 0 0 0 auto;\n        align-self: center;\n      }\n\n      #band-navbar.bcampx-label-feed-navbar-host {\n        display: flex;\n        align-items: center;\n        gap: 0;\n      }\n\n      .bcampx-label-feed-toggle:hover {\n        border-color: rgba(64, 133, 182, 0.3);\n        color: #266a99;\n        background: rgba(255, 255, 255, 0.96);\n      }\n\n      .bcampx-label-feed-toggle:hover .bcampx-label-feed-toggle__icon {\n        color: #266a99;\n        background: rgba(64, 133, 182, 0.08);\n      }\n\n      .bcampx-label-feed-toggle--feed:hover .bcampx-label-feed-toggle__icon--feed,\n      .bcampx-label-feed-toggle--original:hover .bcampx-label-feed-toggle__icon--original {\n        color: #fff;\n        background: rgba(64, 133, 182, 0.86);\n      }\n\n      .bcampx-label-feed-toggle:focus-visible {\n        outline: 2px solid #4085b6;\n        outline-offset: 2px;\n      }\n\n      @media (max-width: 560px) {\n        .bcampx-label-feed {\n          max-width: none;\n        }\n\n        .bcampx-label-feed-card {\n          padding: 14px;\n        }\n\n        .bcampx-label-feed-card .tralbum-wrapper {\n          grid-template-columns: 128px minmax(0, 1fr);\n          gap: 12px;\n        }\n\n        .bcampx-label-feed-card .tralbum-wrapper-col2 {\n          grid-column: 1 / -1;\n          padding-top: 4px;\n        }\n\n        .bcampx-label-feed-card .art img {\n          width: 128px;\n          height: 128px;\n        }\n\n        .bcampx-label-feed-toggle {\n          margin-right: 8px;\n        }\n\n        .bcampx-label-feed-toggle--floating {\n          left: 10px;\n          bottom: 10px;\n          margin: 0;\n        }\n      }\n\n      .bcampx__meta {\n        display: block;\n        color: #555;\n        padding-top: 4px;\n      }\n\n      .bcampx__summary {\n        display: flex;\n        align-items: center;\n        gap: 10px;\n        margin-top: 4px;\n        color: #777;\n      }\n\n      .bcampx--supported-slot {\n        max-width: none;\n        margin: 0;\n        padding: 0;\n      }\n\n      .bcampx--supported-slot .bcampx__meta {\n        padding: 0;\n        max-width: none;\n        color: #5d5d5d;\n        font: 400 12px/1.35 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n      }\n\n      .bcampx__slot-panel {\n        padding: 0;\n        border-left: 0;\n      }\n\n      .bcampx__summary-text {\n        min-width: 0;\n      }\n\n      .bcampx__merge-note {\n        margin: 8px 0 12px;\n        color: #8a8a8a;\n        font: 400 12px/1.34 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n        text-align: left;\n      }\n\n      .bcampx__merge-fan {\n        color: #6d6d6d;\n        font-weight: 600;\n      }\n\n      .bcampx__merge-copy {\n        color: #8a8a8a;\n      }\n\n      .bcampx__merge-track-button {\n        padding: 0;\n        border: 0;\n        background: transparent;\n        color: #4085b6;\n        font: inherit;\n        line-height: inherit;\n        text-align: left;\n        text-decoration: none;\n        cursor: pointer;\n      }\n\n      .bcampx__merge-track-button:hover {\n        text-decoration: underline;\n      }\n\n      .bcampx__merge-track-button.bcampx__track-link--active {\n        color: #4085b6;\n        text-decoration: underline;\n      }\n\n      .bcampx__merge-track-button:disabled {\n        cursor: progress;\n        opacity: 0.75;\n      }\n\n      .bcampx__toggle {\n        cursor: pointer;\n        padding: 0;\n        border: 0;\n        background: transparent;\n        color: #4085b6;\n        font: inherit;\n        text-decoration: underline;\n      }\n\n      .bcampx__toggle:disabled {\n        cursor: progress;\n        opacity: 0.68;\n      }\n\n      .bcampx__facts {\n        color: #666;\n      }\n\n      .bcampx__slot-header {\n        margin: 0 0 7px;\n        color: #757575;\n        font-size: 10px;\n        line-height: 1.2;\n        font-weight: 600;\n        letter-spacing: 0.09em;\n        text-transform: uppercase;\n      }\n\n      .bcampx__slot-subhead {\n        margin: 8px 0 0;\n        color: #949494;\n        font-size: 11px;\n        font-weight: 400;\n      }\n\n      .bcampx__description {\n        margin: 6px 0 0;\n        color: #333;\n        white-space: pre-line;\n      }\n\n      .bcampx__tracks {\n        display: none;\n        margin: 6px 0 0 18px;\n        padding: 0;\n      }\n\n      .bcampx--expanded .bcampx__tracks {\n        display: block;\n      }\n\n      .bcampx__tracks li {\n        margin: 2px 0;\n      }\n\n      .bcampx__tracks--slot {\n        display: block;\n        margin: 0;\n        padding-left: 0;\n        list-style: none;\n        counter-reset: bcampxTrackNumber;\n        color: #4a4a4a;\n        font-size: 12px;\n        font-weight: 400;\n      }\n\n      .bcampx__tracks--slot li {\n        display: grid;\n        grid-template-columns: 18px minmax(0, 1fr) auto;\n        column-gap: 7px;\n        align-items: start;\n        margin: 0;\n        padding: 2px 0 5px;\n        line-height: 1.28;\n        border-top: 0;\n      }\n\n      .bcampx__tracks--slot li:first-child {\n        border-top: 0;\n        padding-top: 0;\n      }\n\n      .bcampx__tracks--slot.bcampx__tracks--collapsed .bcampx__track-item--extra {\n        display: none;\n      }\n\n      .bcampx__tracks--slot li::before {\n        counter-increment: bcampxTrackNumber;\n        content: counter(bcampxTrackNumber) \".\";\n        color: #aaaaaa;\n        font-variant-numeric: tabular-nums;\n        align-self: start;\n        justify-self: start;\n        padding-top: 1px;\n      }\n\n      .bcampx__track-item--purchased::before {\n        color: #4085b6;\n        font-weight: 400;\n      }\n\n      .bcampx__track-link {\n        cursor: pointer;\n        display: block;\n        width: 100%;\n        padding: 0;\n        border: 0;\n        background: transparent;\n        color: inherit;\n        font: inherit;\n        line-height: inherit;\n        text-align: left;\n        text-decoration: none;\n        min-width: 0;\n        margin: 0;\n      }\n\n      .bcampx__track-link:hover {\n        color: #4085b6;\n        text-decoration: underline;\n      }\n\n      .bcampx__track-link--active {\n        color: #4085b6;\n        font-weight: 400;\n        text-decoration: underline;\n      }\n\n      .bcampx__track-item--purchased .bcampx__track-link {\n        color: #333;\n        font-weight: 400;\n      }\n\n      .bcampx__track-duration {\n        color: #a0a0a0;\n        font-size: 11px;\n        font-variant-numeric: tabular-nums;\n        white-space: nowrap;\n        padding-top: 1px;\n        text-align: right;\n        opacity: 0.88;\n        align-self: start;\n      }\n\n      .bcampx__track-end {\n        display: flex;\n        justify-content: flex-end;\n        align-items: flex-start;\n        min-width: 42px;\n      }\n\n      .bcampx__track-actions {\n        display: none;\n        align-items: center;\n        gap: 6px;\n        margin-top: -1px;\n      }\n\n      .bcampx__tracks--slot li:hover .bcampx__track-end--has-actions .bcampx__track-duration,\n      .bcampx__track-item--show-actions .bcampx__track-duration {\n        display: none;\n      }\n\n      .bcampx__tracks--slot li:hover .bcampx__track-end--has-actions .bcampx__track-actions,\n      .bcampx__track-item--show-actions .bcampx__track-actions {\n        display: flex;\n      }\n\n      .bcampx__track-action {\n        padding: 0;\n        border: 0;\n        background: transparent;\n        color: #6f8eaa;\n        font: 400 10px/1.2 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n        cursor: pointer;\n        text-transform: lowercase;\n      }\n\n      .bcampx__track-action:hover {\n        color: #4085b6;\n        text-decoration: underline;\n      }\n\n      .bcampx__track-action:disabled {\n        cursor: default;\n        opacity: 0.7;\n      }\n\n      .bcampx__track-action--pending,\n      .bcampx__track-action--flash {\n        color: #4085b6;\n      }\n\n      .bcampx__track-action-frame {\n        position: fixed;\n        width: 1px;\n        height: 1px;\n        opacity: 0;\n        pointer-events: none;\n        left: -9999px;\n        top: -9999px;\n        border: 0;\n      }\n\n      .bcampx__track-link:disabled {\n        cursor: default;\n        opacity: 0.55;\n      }\n\n\n      .bcampx__description--slot {\n        margin-top: 10px;\n        color: #757575;\n        font-size: 12px;\n        line-height: 1.4;\n        white-space: normal;\n      }\n\n      .bcampx__description-block {\n        display: block;\n        margin-top: 10px;\n        padding-top: 0;\n        border-top: 0;\n      }\n\n      .bcampx__description--slot p {\n        margin: 0 0 5px;\n      }\n\n      .bcampx__description--slot p:last-child {\n        margin-bottom: 0;\n      }\n\n      .bcampx__description--slot.bcampx__description--collapsed {\n        max-height: calc(1.35em * 4);\n        overflow: hidden;\n      }\n\n      .bcampx__description--slot a {\n        color: #4085b6;\n        text-decoration: none;\n      }\n\n      .bcampx__description--slot a:hover {\n        text-decoration: underline;\n      }\n\n      .bcampx__slot-expand {\n        display: inline-block;\n        margin-top: 3px;\n        padding: 0;\n        border: 0;\n        background: transparent;\n        color: #6f8eaa;\n        font: 400 11px/1.2 \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n        cursor: pointer;\n        text-decoration: none;\n      }\n\n\n      .bcampx__slot-expand:hover {\n        color: #4085b6;\n        text-decoration: underline;\n      }\n\n      #track_play_waypoint {\n        display: none !important;\n      }\n\n      .bcampx__waypoint-toggle {\n        position: absolute;\n        right: -18px;\n        top: 50%;\n        transform: translateY(-50%);\n        min-width: 62px;\n        padding: 6px 14px;\n        border: 1px solid rgba(255, 255, 255, 0.65);\n        border-radius: 999px;\n        background: rgba(120, 120, 120, 0.92);\n        color: #fff;\n        font: 600 12px/1 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n        cursor: pointer;\n        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);\n        z-index: 4;\n      }\n\n      .bcampx__waypoint-toggle:hover {\n        background: rgba(105, 105, 105, 0.98);\n      }\n\n      .bcampx__waypoint-toggle--paused {\n        background: rgba(132, 132, 132, 0.9);\n      }\n\n\n      .bcampx__link {\n        display: inline-block;\n        margin-top: 8px;\n        color: #4085b6;\n        text-decoration: none;\n        font-size: 13px;\n        font-weight: 600;\n      }\n\n      .bcampx__link:hover {\n        text-decoration: underline;\n      }\n\n      .bcampx__action {\n        display: inline-block;\n        margin: 8px 10px 0 0;\n        padding: 0;\n        border: 0;\n        background: transparent;\n        color: #4085b6;\n        font-size: 13px;\n        font-weight: 600;\n        cursor: pointer;\n      }\n\n      .bcampx__action:hover {\n        text-decoration: underline;\n      }\n\n      .bcampx__action:disabled {\n        cursor: default;\n        opacity: 0.6;\n        text-decoration: none;\n      }\n\n      .bcampx__error,\n      .bcampx__empty {\n        margin: 0 0 6px;\n        color: #66757f;\n      }\n\n      .bcampx--loading {\n        opacity: 0.78;\n      }\n";
    const SCRIPT_VERSION = "0.2.8";

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
        enableTrackRowActions: true,
        continuousMode: false,
        autoFillMinimumPrice: false,
        maxConcurrentFetches: 3,
    };

    const CACHE_SCHEMA_VERSION = 16;
    const RELEASE_CACHE_PREFIX = "bcampx:release:";
    const USER_SETTINGS_KEY = "bcampx:userSettings";
    const ARTIST_MUSIC_VIEW_KEY = "bcampx:artistMusicView";
    const PLAYBACK_PAUSE_REQUEST_KEY = "bcampx:playbackPauseRequest";
    const OWNED_RELEASE_COLLECTION_SEARCH_KEY =
        "bcampx:ownedReleaseCollectionSearch";
    const PLAYBACK_PAUSE_POLL_MS = 1000;
    const PLAYBACK_PAUSE_STALE_MS = 10000;
    const PLAYER_WISHLIST_STATE_RETRY_MS = 30000;
    const OWNED_RELEASE_COLLECTION_SEARCH_TTL_MS = 2 * 60 * 1000;
    const STATE = {
        initialized: false,
        artistMusicFeedBuilt: false,
        artistMusicFeedView: "feed",
        artistMusicFeedNode: null,
        artistMusicSourceGridNode: null,
        artistMusicToggleNode: null,
        artistMusicFeaturedNodes: [],
        globalBridgeInitialized: false,
        trackActionBridgeInitialized: false,
        scanTimer: 0,
        pendingScanRoots: new Set(),
        pendingFullScan: false,
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
        activeCardArtUrl: "",
        activePlaybackScope: "",
        coverPlaybackStateNode: null,
        collectionCoverStateObserver: null,
        collectionCoverStateObserverTimer: 0,
        playerUi: null,
        playerHost: null,
        playerSettingsOpen: false,
        pendingReleaseRequests: new Map(),
        releaseFetchQueue: [],
        activeReleaseFetchCount: 0,
        pendingTrackActionRequests: new Map(),
        playerWishlistStateByUrl: new Map(),
        playerWishlistStateRequests: new Map(),
        playerWishlistActionRequests: new Set(),
        playerWishlistStateRetryTimers: new Map(),
        uiSyncFrame: 0,
        pendingUiSyncCardArtUrl: "",
        tabId: `bcampx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        playbackPauseMonitorTimer: 0,
        playbackPauseUnsubscribe: null,
        lastPlaybackStartedAt: 0,
        lastHandledPlaybackPauseRequestAt: 0,
        lastTrackActionDiagnostic: null,
        collectionPointerReleaseUrl: "",
        collectionPointerHandledAt: 0,
        feedPreviewTracks: null,
        feedPreviewTrackMap: null,
        memoVersion: 1,
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

    const FEED_CARD_ROOT_SELECTOR = [
        "li.story",
        ".story",
        ".feed-item",
        ".feedItem",
        ".feed_item",
        ".feed-story",
        ".feedStory",
        ".activity-item",
        ".fan-feed-item",
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
    const SKIP_REASON_ATTR = "data-bcampx-skip-reason";
    const RETRYABLE_SKIP_ATTR = "data-bcampx-retryable-skip";
    const FAN_ACTIVITY_TEXT_PATTERN =
        /\b(bought|purchased|wishlisted|supported|recommended|following|followed|listening|played|posted|released|added)\b/i;
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

    const SVG_NS = "http://www.w3.org/2000/svg";
        const PLAYER_ICON_DEFINITIONS = {
        favorite: {
            viewBox: "0 0 20 20",
            children: [
                {
                    tagName: "path",
                    attributes: {
                        class: "bcampx-player-favorite-outline",
                        d: "M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "1.7",
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                    },
                },
                {
                    tagName: "path",
                    attributes: {
                        class: "bcampx-player-favorite-fill",
                        d: "M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z",
                        fill: "currentColor",
                    },
                },
            ],
        },
        open: {
            viewBox: "0 0 20 20",
            children: [
                {
                    tagName: "path",
                    attributes: {
                        d: "M7 13 13 7",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "1.8",
                        "stroke-linecap": "round",
                    },
                },
                {
                    tagName: "path",
                    attributes: {
                        d: "M8.2 6.8H14v5.8",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "1.8",
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                    },
                },
            ],
        },
        settings: {
            viewBox: "0 0 20 20",
            children: [
                {
                    tagName: "circle",
                    attributes: {
                        cx: "10",
                        cy: "4.75",
                        r: "1.55",
                        fill: "currentColor",
                    },
                },
                {
                    tagName: "circle",
                    attributes: {
                        cx: "10",
                        cy: "10",
                        r: "1.55",
                        fill: "currentColor",
                    },
                },
                {
                    tagName: "circle",
                    attributes: {
                        cx: "10",
                        cy: "15.25",
                        r: "1.55",
                        fill: "currentColor",
                    },
                },
            ],
        },
    };

    function createSvgNode(tagName, attributes) {
        const node = document.createElementNS(SVG_NS, tagName);
        Object.entries(attributes || {}).forEach(([name, value]) => {
            node.setAttribute(name, value);
        });
        return node;
    }

    function createPlayerIcon(iconName) {
        const definition = PLAYER_ICON_DEFINITIONS[iconName];
        if (!definition) {
            return document.createTextNode("");
        }

        const svg = createSvgNode("svg", {
            viewBox: definition.viewBox,
            "aria-hidden": "true",
            focusable: "false",
        });

        definition.children.forEach((child) => {
            svg.appendChild(createSvgNode(child.tagName, child.attributes));
        });

        return svg;
    }

    init();

    function init() {
        markDebugState("data-bcampx-script-loaded", "true");
        markDebugState("data-bcampx-version", SCRIPT_VERSION);
        markDebugState(
            "data-bcampx-page-kind",
            getEnhancerPageKind(),
        );

        if (tryHandleEmbeddedTrackActionHelper()) {
            markDebugState("data-bcampx-init-state", "helper");
            return;
        }

        if (!isLikelyBandcampDocument()) {
            markDebugState("data-bcampx-init-state", "unsupported-page");
            return;
        }

        setupGlobalPlaybackBridge();
        setupOwnedReleaseCollectionHandoff();
        void applyPendingOwnedReleaseCollectionSearch();

        setupReleasePageBuyAutofill();

        if (STATE.initialized || !isFeedEnhancerPage()) {
            if (STATE.initialized) {
                markDebugState("data-bcampx-init-state", "already-initialized");
            }
            return;
        }

        STATE.initialized = true;
        markDebugState("data-bcampx-init-state", "starting");
        void initializeFeedEnhancer()
            .then(() => markDebugState("data-bcampx-init-state", "ready"))
            .catch((error) => {
                markDebugState("data-bcampx-init-state", "error");
                markDebugState(
                    "data-bcampx-init-error",
                    cleanText(error && error.message ? error.message : "Unknown error.").slice(
                        0,
                        160,
                    ),
                );
            });
    }

    async function initializeFeedEnhancer() {
        await loadUserSettings();
        setupSharedAudio();
        setupWaypointNavigation();
        setupNativePlaybackInterception();
        setupPlayerMenuDismissal();
        injectStyles();
        await buildArtistMusicFeed();
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
        subscribeToPlaybackPauseRequests();
        STATE.playbackPauseMonitorTimer = window.setInterval(
            checkForPlaybackPauseRequest,
            PLAYBACK_PAUSE_POLL_MS,
        );
    }

    async function loadUserSettings() {
        const stored = await storageGet(USER_SETTINGS_KEY, null);
        applyUserSettings(stored);
    }

    function applyUserSettings(value) {
        const settings =
            value && typeof value === "object" ? value : {};
        CONFIG.enableTrackRowActions = coerceBooleanSetting(
            settings.enableTrackRowActions,
            true,
        );
        CONFIG.continuousMode = coerceBooleanSetting(
            settings.continuousMode,
            false,
        );
        CONFIG.autoFillMinimumPrice = coerceBooleanSetting(
            settings.autoFillMinimumPrice,
            false,
        );
    }

    function coerceBooleanSetting(value, fallback) {
        if (typeof value === "boolean") {
            return value;
        }

        if (value === "true") {
            return true;
        }

        if (value === "false") {
            return false;
        }

        return fallback;
    }

    function getSerializableUserSettings() {
        return {
            enableTrackRowActions: !!CONFIG.enableTrackRowActions,
            continuousMode: !!CONFIG.continuousMode,
            autoFillMinimumPrice: !!CONFIG.autoFillMinimumPrice,
        };
    }

    async function persistUserSettings() {
        await storageSet(USER_SETTINGS_KEY, getSerializableUserSettings());
    }

    function setupSharedAudio() {
        if (STATE.sharedAudio) {
            return;
        }

        STATE.pageAudio =
            document.querySelector("body > audio") ||
            document.querySelector("audio") ||
            null;
        if (STATE.pageAudio) {
            isFeedEnhancerPage() && STATE.pageAudio.addEventListener(
                "play",
                suppressNativePageAudio,
                true,
            );
        }
        STATE.sharedAudio = document.createElement("audio");
        STATE.sharedAudio.preload = "metadata";
        STATE.sharedAudio.controls = true;
        addAudioEventListeners(STATE.sharedAudio, [
            "pause",
            "play",
            "ended",
        ], syncActiveTrackButton);
        STATE.sharedAudio.addEventListener("ended", handleSharedAudioEnded);
        addAudioEventListeners(STATE.sharedAudio, [
            "timeupdate",
            "loadedmetadata",
            "durationchange",
            "volumechange",
        ], syncPlayerShell);
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

    function ensureCardController(card, releaseUrl) {
        const existingController = getCardController(card);
        if (existingController) {
            return existingController;
        }

        if (!card || card.hasAttribute(ENHANCED_ATTR)) {
            return getCardController(card);
        }

        enhanceCard(card, releaseUrl, getCardReleaseRequestContext(card, releaseUrl));
        return getCardController(card);
    }

    function getCardController(card) {
        return card && card.__bcampxController ? card.__bcampxController : null;
    }

    function setCardController(card, controller) {
        if (card) {
            card.__bcampxController = controller || null;
        }
    }

    function getCardAlbumReleaseUrl(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardAlbumReleaseUrl")) {
            return memo.cardAlbumReleaseUrl || "";
        }

        const albumLinks = Array.from(
            card.querySelectorAll('a[href*="/album/"]'),
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .filter(Boolean);
        const albumLink = preferBandcampReleaseUrl(albumLinks) || albumLinks[0] || "";

        if (memo) {
            memo.cardAlbumReleaseUrl = albumLink;
        }

        return albumLink;
    }

    function getCardRawReleaseUrl(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardRawReleaseUrl")) {
            return memo.cardRawReleaseUrl || "";
        }

        const releaseLinks = Array.from(card.querySelectorAll(RELEASE_LINK_SELECTOR))
            .map((link) => normalizeReleaseUrl(link.href))
            .filter(Boolean);
        const itemJsonReleaseUrl = getItemJsonReleaseUrl(card);
        const rawReleaseUrl =
            preferBandcampReleaseUrl([
                ...releaseLinks,
                itemJsonReleaseUrl,
            ].filter(Boolean)) ||
            releaseLinks[0] ||
            itemJsonReleaseUrl ||
            "";

        if (memo) {
            memo.cardRawReleaseUrl = rawReleaseUrl;
        }

        return rawReleaseUrl;
    }

    function getCardReleaseRequestContext(card, releaseUrl = "") {
        const normalizedReleaseUrl = normalizeReleaseUrl(
            releaseUrl || getCardPrimaryReleaseUrl(card),
        );
        const parsed = getParsedItemJson(card);
        return {
            releaseUrl: normalizedReleaseUrl,
            itemId: extractParsedItemId(parsed),
            itemType: normalizeReleaseItemType(
                parsed &&
                    (parsed.item_type ||
                        parsed.tralbum_type ||
                        parsed.type ||
                        parsed.collect_item_type),
                normalizedReleaseUrl,
            ),
        };
    }

    function getCardPrimaryReleaseUrl(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardPrimaryReleaseUrl")) {
            return memo.cardPrimaryReleaseUrl || "";
        }

        const albumLink = getCardAlbumReleaseUrl(card);
        if (albumLink) {
            if (memo) {
                memo.cardPrimaryReleaseUrl = albumLink;
            }
            return albumLink;
        }

        const primaryReleaseUrl = getCardRawReleaseUrl(card);

        if (memo) {
            memo.cardPrimaryReleaseUrl = primaryReleaseUrl;
        }

        return primaryReleaseUrl;
    }

    function getStoryRoot(node) {
        if (!(node instanceof Element)) {
            return null;
        }

        const story = node.matches(FEED_CARD_ROOT_SELECTOR)
            ? node
            : node.closest(FEED_CARD_ROOT_SELECTOR);
        return story instanceof Element ? story : null;
    }

    function getStoryTitleNode(card) {
        const story = getStoryRoot(card);
        if (!story) {
            return null;
        }

        const title = story.querySelector(".story-title");
        return title instanceof Element ? title : null;
    }

    function extractFeedHeadlineActor(headlineText) {
        const match = cleanText(headlineText).match(
            /^(.+?)\s+(?:bought|purchased|wishlisted|supported|recommended|listening|played|posted|released)\b/i,
        );
        return match && match[1] ? cleanText(match[1]) : "";
    }

    function getParsedItemJson(node) {
        if (!(node instanceof Element)) {
            return null;
        }

        const holder = node.matches("[data-item-json]")
            ? node
            : node.querySelector("[data-item-json]");
        if (!(holder instanceof Element)) {
            return null;
        }

        const memo = getNodeMemo(holder);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "parsedItemJson")) {
            return memo.parsedItemJson;
        }

        const parsed = parseJsonAttribute(holder, "data-item-json") || null;
        if (memo) {
            memo.parsedItemJson = parsed;
        }

        return parsed;
    }

    function getCollectionGridFeaturedPreview(card) {
        const memo = getNodeMemo(card);
        if (
            memo &&
            Object.prototype.hasOwnProperty.call(
                memo,
                "collectionGridFeaturedPreview",
            )
        ) {
            return memo.collectionGridFeaturedPreview;
        }

        const parsed = getParsedItemJson(card);
        const trackId = cleanText(parsed && parsed.featured_track);
        if (!trackId) {
            return null;
        }

        const preview = getFeedPreviewTrackMap().get(trackId);
        const streamUrl = cleanText(
            preview &&
                preview.streaming_url &&
                preview.streaming_url["mp3-128"],
        );
        if (!preview || !streamUrl) {
            return null;
        }

        const track = createTrackData(
            preview.title || parsed.featured_track_title,
            preview.track_id || trackId,
            streamUrl,
            preview.duration || parsed.featured_track_duration,
            preview.track_url || parsed.featured_track_url || "",
        );
        if (!track) {
            return null;
        }

        const art =
            parsed && parsed.item_art && typeof parsed.item_art === "object"
                ? parsed.item_art
                : {};
        const result = {
            track,
            data: normalizeReleaseData({
                url: getItemJsonReleaseUrl(card),
                title: parsed.album_title || parsed.item_title || "",
                artist: parsed.band_name || preview.band_name || "",
                artUrl:
                    parsed.item_art_url ||
                    art.url ||
                    getCardArtUrl(card),
                tracks: [track],
            }),
        };
        if (memo) {
            memo.collectionGridFeaturedPreview = result;
        }
        return result;
    }

    function getFeedPreviewTracks() {
        if (Array.isArray(STATE.feedPreviewTracks)) {
            return STATE.feedPreviewTracks;
        }

        const blob =
            parseJsonAttribute(
                document.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        STATE.feedPreviewTracks = Array.isArray(blob.track_list)
            ? blob.track_list
            : [];
        return STATE.feedPreviewTracks;
    }

    function getFeedPreviewTrackMap() {
        if (STATE.feedPreviewTrackMap instanceof Map) {
            return STATE.feedPreviewTrackMap;
        }

        STATE.feedPreviewTrackMap = new Map();
        getFeedPreviewTracks().forEach((track) => {
            const trackId = cleanText(track && track.track_id);
            if (trackId) {
                STATE.feedPreviewTrackMap.set(trackId, track);
            }
        });
        return STATE.feedPreviewTrackMap;
    }

        async function buildArtistMusicFeed() {
        if (STATE.artistMusicFeedBuilt || !isArtistMusicPage()) {
            return false;
        }

        const releases = collectArtistMusicReleaseCandidates();
        if (!releases.length) {
            markDebugState("data-bcampx-label-feed-state", "empty");
            return false;
        }

        const sourceGrid = findArtistMusicSourceGrid();
        if (!sourceGrid || !sourceGrid.parentNode) {
            markDebugState("data-bcampx-label-feed-state", "missing-source");
            return false;
        }

        const feed = document.createElement("section");
        feed.className = "bcampx-label-feed";
        feed.setAttribute("aria-label", "Bandcamp release feed");

        const list = document.createElement("ol");
        list.className = "bcampx-label-feed__list";
        releases.forEach((release) => {
            list.appendChild(createArtistMusicFeedCard(release));
        });
        feed.appendChild(list);

        const storedView = cleanText(
            await storageGet(ARTIST_MUSIC_VIEW_KEY, "feed"),
        );
        STATE.artistMusicFeedView = storedView === "original" ? "original" : "feed";
        STATE.artistMusicFeedNode = feed;
        STATE.artistMusicSourceGridNode = sourceGrid;
        STATE.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();

        sourceGrid.parentNode.insertBefore(feed, sourceGrid);
        document.body.classList.add("bcampx-label-feed-page");
        ensureArtistMusicViewToggle();
        applyArtistMusicFeedView(STATE.artistMusicFeedView);
        STATE.artistMusicFeedBuilt = true;

        markDebugState("data-bcampx-label-feed-state", "ready");
        markDebugState("data-bcampx-label-feed-count", String(releases.length));
        markDebugState(
            "data-bcampx-label-feed-visible-count",
            String(releases.length),
        );
        return true;
    }

    function ensureArtistMusicViewToggle() {
        if (STATE.artistMusicToggleNode || !document.body) {
            return STATE.artistMusicToggleNode;
        }

        const button = document.createElement("div");
        button.className = "bcampx-label-feed-toggle";
        button.setAttribute("role", "button");
        button.setAttribute("tabindex", "0");
        button.addEventListener("click", () => {
            void setArtistMusicFeedView(
                STATE.artistMusicFeedView === "feed" ? "original" : "feed",
            );
        });
        button.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            event.preventDefault();
            button.click();
        });
        button.append(
            createArtistMusicViewToggleIcon("original"),
            createArtistMusicViewToggleIcon("feed"),
        );

        document.body.appendChild(button);
        STATE.artistMusicToggleNode = button;
        positionArtistMusicViewToggle();
        scheduleArtistMusicViewTogglePlacement();
        return button;
    }

    function createArtistMusicViewToggleIcon(view) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.classList.add("bcampx-label-feed-toggle__icon");
        svg.classList.add(`bcampx-label-feed-toggle__icon--${view}`);
        svg.setAttribute("viewBox", "0 0 20 20");
        svg.setAttribute("width", "13");
        svg.setAttribute("height", "13");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");

        if (view === "feed") {
            [
                ["4", "5", "12"],
                ["4", "10", "12"],
                ["4", "15", "12"],
            ].forEach(([x1, y, x2]) => {
                const line = document.createElementNS(SVG_NS, "path");
                line.setAttribute("d", `M${x1} ${y}h${x2}`);
                line.setAttribute("fill", "none");
                line.setAttribute("stroke", "currentColor");
                line.setAttribute("stroke-width", "1.35");
                line.setAttribute("stroke-linecap", "round");
                svg.appendChild(line);
            });
            return svg;
        }

        [
            ["4", "4"],
            ["11", "4"],
            ["4", "11"],
            ["11", "11"],
        ].forEach(([x, y]) => {
            const rect = document.createElementNS(SVG_NS, "rect");
            rect.setAttribute("x", x);
            rect.setAttribute("y", y);
            rect.setAttribute("width", "5");
            rect.setAttribute("height", "5");
            rect.setAttribute("rx", "0.8");
            rect.setAttribute("fill", "none");
            rect.setAttribute("stroke", "currentColor");
            rect.setAttribute("stroke-width", "1.25");
            svg.appendChild(rect);
        });
        return svg;
    }

    function scheduleArtistMusicViewTogglePlacement() {
        [250, 1000, 2500].forEach((delay) => {
            window.setTimeout(positionArtistMusicViewToggle, delay);
        });
    }

    function positionArtistMusicViewToggle() {
        const button = STATE.artistMusicToggleNode;
        if (!button || !document.body) {
            return;
        }

        const navbar = document.querySelector("#band-navbar");
        if (navbar) {
            navbar.appendChild(button);
            navbar.classList.add("bcampx-label-feed-navbar-host");
            button.classList.remove("bcampx-label-feed-toggle--floating");
            button.classList.add("bcampx-label-feed-toggle--inline");
            button.classList.add("bcampx-label-feed-toggle--navbar");
            return;
        }

        const target = findArtistMusicViewToggleTarget();
        if (target && target.parentNode) {
            target.parentNode.insertBefore(button, target);
            button.classList.remove("bcampx-label-feed-toggle--floating");
            button.classList.add("bcampx-label-feed-toggle--inline");
            button.classList.remove("bcampx-label-feed-toggle--navbar");
            return;
        }

        if (!document.body.contains(button)) {
            document.body.appendChild(button);
        }
        button.classList.remove("bcampx-label-feed-toggle--inline");
        button.classList.remove("bcampx-label-feed-toggle--navbar");
        button.classList.add("bcampx-label-feed-toggle--floating");
    }

    function findArtistMusicViewToggleTarget() {
        return (
            document.querySelector(".label-band-selector.fade-in-on-load") ||
            document.querySelector(".label-band-selector")
        );
    }

    async function setArtistMusicFeedView(view) {
        const nextView = view === "original" ? "original" : "feed";
        applyArtistMusicFeedView(nextView);
        await storageSet(ARTIST_MUSIC_VIEW_KEY, nextView);
    }

    function applyArtistMusicFeedView(view) {
        const nextView = view === "original" ? "original" : "feed";
        const feed = STATE.artistMusicFeedNode;
        const sourceGrid = STATE.artistMusicSourceGridNode;

        STATE.artistMusicFeedView = nextView;
        if (feed) {
            feed.hidden = nextView !== "feed";
        }
        if (sourceGrid) {
            setArtistMusicNativeSectionHidden(
                sourceGrid,
                nextView === "feed",
                "offscreen",
            );
            sourceGrid.setAttribute(
                "data-bcampx-label-feed-source-hidden",
                nextView === "feed" ? "true" : "false",
            );
        }
        STATE.artistMusicFeaturedNodes = findArtistMusicFeaturedNodes();
        STATE.artistMusicFeaturedNodes.forEach((node) => {
            setArtistMusicNativeSectionHidden(node, nextView === "feed");
            node.setAttribute(
                "data-bcampx-label-feed-featured-hidden",
                nextView === "feed" ? "true" : "false",
            );
        });

        document.body.classList.toggle(
            "bcampx-label-feed-page--original",
            nextView === "original",
        );
        document.body.classList.toggle(
            "bcampx-label-feed-page--enhanced",
            nextView === "feed",
        );

        updateArtistMusicViewToggle();
        markDebugState("data-bcampx-label-feed-view", nextView);

        if (nextView === "feed" && feed) {
            scheduleScan(feed);
        }
    }

    function setArtistMusicNativeSectionHidden(node, hidden, mode = "display") {
        if (!(node instanceof Element)) {
            return;
        }

        if (mode === "offscreen") {
            node.hidden = false;
            node.classList.toggle(
                "bcampx-label-feed-native-offscreen",
                hidden,
            );
            if (hidden) {
                node.setAttribute("aria-hidden", "true");
                node.style.removeProperty("display");
                return;
            }

            node.classList.remove("bcampx-label-feed-native-offscreen");
            node.removeAttribute("aria-hidden");
            return;
        }

        node.classList.remove("bcampx-label-feed-native-offscreen");
        node.hidden = hidden;
        if (hidden) {
            if (!node.hasAttribute("data-bcampx-original-display")) {
                node.setAttribute(
                    "data-bcampx-original-display",
                    node.style.display || "",
                );
            }
            node.style.display = "none";
            return;
        }

        const originalDisplay = node.getAttribute(
            "data-bcampx-original-display",
        );
        node.removeAttribute("data-bcampx-original-display");
        if (originalDisplay) {
            node.style.display = originalDisplay;
        } else {
            node.style.removeProperty("display");
        }
    }

    function updateArtistMusicViewToggle() {
        const toggle = STATE.artistMusicToggleNode;
        if (!toggle) {
            return;
        }

        const showingFeed = STATE.artistMusicFeedView === "feed";
        toggle.classList.toggle(
            "bcampx-label-feed-toggle--feed",
            showingFeed,
        );
        toggle.classList.toggle(
            "bcampx-label-feed-toggle--original",
            !showingFeed,
        );
        toggle.setAttribute(
            "aria-label",
            showingFeed ? "Show original grid" : "Show enhanced feed",
        );
        toggle.setAttribute("aria-pressed", showingFeed ? "true" : "false");
        toggle.title = showingFeed ? "Show original grid" : "Show enhanced feed";
    }

    function findArtistMusicSourceGrid() {
        const gridItem = document.querySelector(".music-grid-item");
        return (
            document.querySelector("#music-grid") ||
            document.querySelector(".music-grid") ||
            (gridItem ? gridItem.parentElement : null) ||
            null
        );
    }

    function findArtistMusicFeaturedNodes() {
        const nodes = new Set();
        document
            .querySelectorAll(".featured-grid.featured-items, .featured-items")
            .forEach((node) => nodes.add(node));
        document.querySelectorAll(".featured-item").forEach((item) => {
            const container =
                item.closest(".featured-grid, .featured-items") || item;
            nodes.add(container);
        });
        return Array.from(nodes).filter(
            (node) =>
                node instanceof Element &&
                !node.closest(".bcampx-label-feed"),
        );
    }

    function collectArtistMusicReleaseCandidates() {
        const seen = new Set();
        const candidatesByKey = new Map();
        const candidates = [];
        const featuredItems = Array.from(
            document.querySelectorAll(
                ".featured-items .featured-item, .featured-grid .featured-item, .featured-item",
            ),
        );
        const excluded = [
            "#sidebar",
            "aside",
            '[role="complementary"]',
            ".sidebar",
            ".cart",
            "#cart",
            '[class*="cart"]',
            '[class*="Cart"]',
            ".checkout",
        ].join(",");
        const gridItems = Array.from(
            document.querySelectorAll(
                [
                    "#music-grid .music-grid-item",
                    ".music-grid .music-grid-item",
                    "[data-item-id^='album-']",
                    "[data-item-id^='track-']",
                ].join(", "),
            ),
        ).filter((item) => !item.closest(excluded));

        featuredItems.forEach((item) => {
            addArtistMusicReleaseCandidate(
                candidates,
                seen,
                item,
                null,
                "featured",
                candidatesByKey,
            );
        });

        gridItems.forEach((item) => {
            addArtistMusicReleaseCandidate(
                candidates,
                seen,
                item,
                null,
                "grid",
                candidatesByKey,
            );
        });


        return candidates;
    }

    function addArtistMusicReleaseCandidate(
        candidates,
        seen,
        item,
        link = null,
        sourceKind = "link",
        candidatesByKey = new Map(),
    ) {
        if (!(item instanceof Element)) {
            return;
        }

        const releaseLink =
            link ||
            item.querySelector(RELEASE_LINK_SELECTOR) ||
            (item.matches(RELEASE_LINK_SELECTOR) ? item : null);
        const releaseUrl = normalizeReleaseUrl(
            releaseLink && releaseLink.href ? releaseLink.href : "",
        );
        if (!releaseUrl) {
            return;
        }

        const itemId = getArtistMusicReleaseItemId(item);
        const itemType = normalizeReleaseItemType("", releaseUrl);
        const title = getArtistMusicReleaseTitle(item, releaseLink, releaseUrl);
        const artist = getArtistMusicReleaseArtist(item);
        const dedupeKeys = getArtistMusicReleaseDedupeKeys({
            releaseUrl,
            itemId,
            itemType,
            title,
            artist,
        });
        const existingKey = dedupeKeys.find((key) => seen.has(key));
        if (existingKey) {
            mergeArtistMusicReleaseCandidate(
                candidatesByKey.get(existingKey),
                item,
                sourceKind,
            );
            return;
        }

        dedupeKeys.forEach((key) => {
            seen.add(key);
        });
        const candidate = {
            releaseUrl,
            title,
            artist,
            artUrl: getArtistMusicReleaseArtUrl(item),
            itemId,
            itemType,
            bandId: getArtistMusicReleaseBandId(item),
            sourceItem: item,
            gridItem: sourceKind === "grid" ? item : null,
            featuredItem: sourceKind === "featured" ? item : null,
        };
        dedupeKeys.forEach((key) => {
            candidatesByKey.set(key, candidate);
        });
        candidates.push(candidate);
    }

    function mergeArtistMusicReleaseCandidate(candidate, item, sourceKind) {
        if (!candidate || !(item instanceof Element)) {
            return;
        }

        if (sourceKind === "grid") {
            candidate.gridItem = candidate.gridItem || item;
            candidate.itemId =
                candidate.itemId || getArtistMusicReleaseItemId(item);
            candidate.bandId =
                candidate.bandId || getArtistMusicReleaseBandId(item);
            return;
        }

        if (sourceKind === "featured") {
            candidate.featuredItem = candidate.featuredItem || item;
            if (!candidate.artUrl) {
                candidate.artUrl = getArtistMusicReleaseArtUrl(item);
            }
        }
    }

    function getArtistMusicReleaseDedupeKeys(release) {
        const keys = [`url:${release.releaseUrl}`];
        if (release.itemId && release.itemType) {
            keys.push(`item:${release.itemType}:${release.itemId}`);
        }

        try {
            const url = new URL(release.releaseUrl, window.location.href);
            const path = url.pathname.replace(/\/$/, "").toLowerCase();
            const title = cleanText(release.title).toLowerCase();
            const artist = cleanText(release.artist).toLowerCase();
            if (path && title) {
                keys.push(`path-title:${path}:${title}:${artist}`);
            }
        } catch (_error) {
            // Ignore malformed URLs; normalizeReleaseUrl already rejected most of them.
        }

        return keys;
    }

    function createArtistMusicFeedCard(release) {
        const card = document.createElement("article");
        card.className = "feed-item story bcampx-label-feed-card";
        card.__bcampxArtistMusicRelease = release;
        card.setAttribute("data-bcampx-release-url", release.releaseUrl);
        if (release.bandId) {
            card.setAttribute("data-bcampx-band-id", release.bandId);
        }

        const itemJson = {
            item_id: release.itemId || undefined,
            item_type: release.itemType || undefined,
            item_url: release.releaseUrl,
            item_title: release.title || undefined,
        };

        const headline = document.createElement("div");
        headline.className = "story-title bcampx-label-feed-card__story-title";

        const artistLink = document.createElement("a");
        artistLink.className = "fan-name artist-name";
        artistLink.href = getArtistMusicPageUrl();
        artistLink.textContent = getArtistMusicBandName();

        const verb = document.createTextNode(" released ");
        const titleLink = createReleaseLink(release, "item-link");

        headline.append(artistLink, verb, titleLink);

        const innards = document.createElement("div");
        innards.className = "story-innards";

        const body = document.createElement("div");
        body.className = "story-body";
        body.setAttribute("data-item-json", JSON.stringify(itemJson));

        const wrapper = document.createElement("div");
        wrapper.className = "tralbum-wrapper";

        const art = document.createElement("div");
        art.className = "art";
        const artLink = document.createElement("a");
        artLink.href = release.releaseUrl;
        if (release.artUrl) {
            const image = document.createElement("img");
            image.src = release.artUrl;
            image.alt = release.title ? `${release.title} art` : "";
            artLink.appendChild(image);
        }
        art.appendChild(artLink);

        const content = document.createElement("div");
        content.className = "tralbum-wrapper-col1";
        content.appendChild(createReleaseLink(release, "item-link"));

        const byline = document.createElement("div");
        byline.className = "itemsubtext";
        byline.textContent = `by ${release.artist || getArtistMusicBandName()}`;
        content.appendChild(byline);

        const action = document.createElement("button");
        action.type = "button";
        action.className = "buy-link bcampx-label-feed-card__buy-button";
        action.textContent = "hear more";
        action.setAttribute("data-bcampx-release-action", "buy");
        action.setAttribute("data-bcampx-release-url", release.releaseUrl || "");
        action.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const actionText = cleanText(action.textContent || "");
            if (/^hear more$/i.test(actionText)) {
                const releaseUrl = action.getAttribute("data-bcampx-release-url") || "";
                if (releaseUrl) {
                    window.open(releaseUrl, "_blank", "noopener,noreferrer");
                }
                return;
            }
            const ownershipUrl = cleanText(
                action.getAttribute("data-bcampx-digital-ownership-url") || "",
            );
            if (ownershipUrl) {
                void navigateToOwnedReleaseCollection(
                    action.getAttribute("data-bcampx-release-title") ||
                        release.title ||
                        "",
                    ownershipUrl,
                    release.releaseUrl,
                );
                return;
            }
            executeTrackAction("basket", release.releaseUrl, action);
        });
        content.appendChild(action);

        const supportedSlot = document.createElement("div");
        supportedSlot.className = "tralbum-wrapper-col2 tralbum-owners";

        const supportedLabel = document.createElement("div");
        supportedLabel.className = "bcampx-label-feed-card__supported-placeholder";
        supportedLabel.textContent = "supported by";
        supportedSlot.appendChild(supportedLabel);

        wrapper.append(art, content, supportedSlot);
        body.appendChild(wrapper);
        innards.appendChild(body);
        card.append(headline, innards);

        return card;
    }

    function createReleaseLink(release, className) {
        const link = document.createElement("a");
        link.href = release.releaseUrl;
        if (className) {
            link.className = className;
        }
        link.textContent = release.title || release.releaseUrl;
        return link;
    }

    function updateArtistMusicCardBuyAction(card, data) {
        if (!card || !data) {
            return;
        }

        const action = card.querySelector("[data-bcampx-release-action='buy']");
        if (!action) {
            return;
        }

        const releaseUrl = card.getAttribute(
            "data-bcampx-release-url",
        );
        if (releaseUrl && !isOwnedDigitalPrice(data.digitalPrice)) {
            const nativeLink = document.querySelector(
                'a.you-own-this-link[href="' +
                    CSS.escape(releaseUrl) +
                    '"]',
            );
            if (nativeLink) {
                data.digitalPrice = "you own this";
            }
        }

        const isOwned = isOwnedDigitalPrice(data.digitalPrice);
        const ownershipUrl = cleanText(data.digitalOwnershipUrl || "");
        action.textContent = getDigitalBuyActionLabel(data.digitalPrice);
        action.disabled = isOwned && !ownershipUrl;
        action.classList.toggle("bcampx-label-feed-card__buy-button--owned", isOwned);
        action.title = isOwned
            ? ownershipUrl
                ? "Find this release in your collection"
                : "This release is already in your collection"
            : "";
        if (data.title) {
            action.setAttribute("data-bcampx-release-title", data.title);
        } else {
            action.removeAttribute("data-bcampx-release-title");
        }
        if (ownershipUrl) {
            action.setAttribute("data-bcampx-digital-ownership-url", ownershipUrl);
        } else {
            action.removeAttribute("data-bcampx-digital-ownership-url");
        }
        if (data.digitalPrice) {
            action.setAttribute("data-bcampx-digital-price", data.digitalPrice);
        } else {
            action.removeAttribute("data-bcampx-digital-price");
        }
    }


    function getCompactDigitalPrice(priceText) {
        const text = cleanText(priceText || "");
        if (!text) {
            return "";
        }

        const symbolicPrice = text.match(/(?:^|\s)([$€£¥]\s*\d+(?:[.,]\d+)?)/);
        if (symbolicPrice) {
            return symbolicPrice[1].replace(/\s+/g, "");
        }

        const codedPrice = text.match(
            /\b(?:USD|AUD|CAD|EUR|GBP|JPY|CNY|RMB|HKD|NZD)\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:USD|AUD|CAD|EUR|GBP|JPY|CNY|RMB|HKD|NZD)\b/i,
        );
        if (codedPrice) {
            return cleanText(codedPrice[0]);
        }

        return text.replace(/\s+or more$/i, "");
    }

   function getDigitalBuyActionLabel(priceText) {
       const compactPrice = getCompactDigitalPrice(priceText);
       if (isOwnedDigitalPrice(compactPrice)) {
           return "you own this";
        }
       if (/^free download$/i.test(compactPrice)) {
           return "free download";
        }

        return compactPrice ? `buy now (${compactPrice})` : "hear more";
   }

    function isOwnedDigitalPrice(priceText) {
        return /^you own this$/i.test(cleanText(priceText || ""));
    }

    function getArtistMusicReleaseTitle(item, link, releaseUrl) {
        const titleNode =
            item.querySelector(".title, .item-title, .collection-item-title") ||
            null;
        const title = titleNode
            ? extractArtistMusicTitleText(titleNode)
            : normalizedText(link || item);
        if (title) {
            return title;
        }

        try {
            return cleanText(
                decodeURIComponent(
                    new URL(releaseUrl, window.location.href)
                        .pathname.split("/")
                        .filter(Boolean)
                        .pop() || "",
                ).replace(/[-_]+/g, " "),
            );
        } catch (_error) {
            return "Bandcamp release";
        }
    }

    function extractArtistMusicTitleText(titleNode) {
        const clone = titleNode.cloneNode(true);
        clone
            .querySelectorAll(
                ".artist-override, .artist, .item-artist, .collection-item-artist",
            )
            .forEach((node) => node.remove());
        return normalizedText(clone);
    }

    function getArtistMusicReleaseArtist(item) {
        const artistOverride = item.querySelector(".artist-override");
        const artistNode = item.querySelector(
            ".artist, .item-artist, .collection-item-artist",
        );
        return (
            (artistOverride ? normalizedText(artistOverride) : "") ||
            (artistNode ? normalizedText(artistNode) : "") ||
            getArtistMusicBandName()
        );
    }

    function getArtistMusicReleaseArtUrl(item) {
        const image = item.querySelector("img");
        if (!image) {
            return "";
        }

        return (
            image.getAttribute("data-original") ||
            image.currentSrc ||
            image.getAttribute("src") ||
            ""
        );
    }

    function getArtistMusicReleaseItemId(item) {
        const raw = cleanText(item.getAttribute("data-item-id") || "");
        const match = raw.match(/(?:album|track)-(\d+)/i);
        return match && match[1] ? Number(match[1]) : 0;
    }

    function getArtistMusicReleaseBandId(item) {
        if (!(item instanceof Element)) {
            return "";
        }

        return cleanText(
            item.getAttribute("data-band-id") ||
                item.getAttribute("data-band") ||
                "",
        );
    }

    function getArtistMusicBandName() {
        const bandData = parseJsonAttribute(
            document.querySelector("script[data-band]"),
            "data-band",
        );
        return (
            cleanText(bandData && bandData.name) ||
            metaContent(document, 'meta[property="og:site_name"]') ||
            metaContent(document, 'meta[property="og:title"]') ||
            cleanTitle(document.title) ||
            "This artist"
        );
    }

    function getArtistMusicPageUrl() {
        const bandData = parseJsonAttribute(
            document.querySelector("script[data-band]"),
            "data-band",
        );
        return (
            cleanText(
                (bandData && (bandData.https_url || bandData.url)) || "",
            ) || window.location.origin
        );
    }

    function getItemJsonReleaseUrl(node) {
        const parsed = getParsedItemJson(node);
        return normalizeReleaseUrl(parsed && parsed.item_url ? parsed.item_url : "");
    }

    function preferBandcampReleaseUrl(urls) {
        return (urls || []).find((url) => isBandcampReleaseUrl(url)) || "";
    }

    function extractParsedItemId(parsed) {
        if (!parsed || typeof parsed !== "object") {
            return 0;
        }

        return firstPositiveNumber(
            parsed.item_id,
            parsed.album_id,
            parsed.track_id,
            parsed.tralbum_id,
            parsed.collect_item_id,
        );
    }

    function firstPositiveNumber(...values) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isFinite(number) && number > 0) {
                return number;
            }
        }

        return 0;
    }

    function normalizeReleaseItemType(rawType, releaseUrl = "") {
        const type = cleanText(rawType).toLowerCase();
        if (type === "album" || type === "a") {
            return "album";
        }
        if (type === "track" || type === "t") {
            return "track";
        }

        const normalizedReleaseUrl = normalizeReleaseUrl(releaseUrl);
        if (/\/album\//.test(normalizedReleaseUrl)) {
            return "album";
        }
        if (/\/track\//.test(normalizedReleaseUrl)) {
            return "track";
        }

        return "";
    }

    function isMalformedFeedCard(card) {
        const story = getStoryRoot(card);
        if (!story || !hasExplicitFeedStoryStructure(story)) {
            return false;
        }

        const directReleaseUrl = getMatchingRootOrDescendants(
            story,
            RELEASE_LINK_SELECTOR,
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .find(Boolean);
        if (directReleaseUrl) {
            return false;
        }

        return Boolean(getItemJsonReleaseUrl(story));
    }

    function isAlsoBoughtRecommendationCard(card) {
        const headline = findActivityHeadline(card) || getStoryTitleNode(card);
        if (!headline) {
            return false;
        }

        if (!/\balso bought\b/i.test(normalizedText(headline))) {
            return false;
        }

        return hasAlsoBoughtRecommendationMarkers(card);
    }

    function hasAlsoBoughtRecommendationMarkers(card) {
        if (!(card instanceof Element)) {
            return false;
        }

        if (
            card.querySelector(
                "a.follow-fan, .follow-fan, a.view-collection, .view-collection",
            )
        ) {
            return true;
        }

        const actionTexts = Array.from(card.querySelectorAll("a, button"))
            .map((node) => normalizedText(node).toLowerCase())
            .filter(Boolean);
        return (
            actionTexts.some((text) => text.includes("follow")) &&
            actionTexts.some((text) => text.includes("view collection"))
        );
    }

    function findFeaturedTrackForCard(card, trigger, data) {
        if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
            return null;
        }

        const triggerWithTrackId =
            trigger && trigger.closest
                ? trigger.closest("[data-trackid]")
                : null;
        const triggerTrackId = cleanText(
            triggerWithTrackId &&
                triggerWithTrackId.getAttribute("data-trackid"),
        );
        if (triggerTrackId) {
            const exactTrack = data.tracks.find(
                (track) =>
                    cleanText(track && track.trackId) === triggerTrackId &&
                    track.streamUrl,
            );
            if (exactTrack) {
                return exactTrack;
            }
        }

        const parsed = getParsedItemJson(card);
        const parsedFeaturedTrackId = cleanText(
            parsed && parsed.featured_track,
        );
        if (parsedFeaturedTrackId) {
            const exactTrack = data.tracks.find(
                (track) =>
                    cleanText(track && track.trackId) ===
                        parsedFeaturedTrackId && track.streamUrl,
            );
            if (exactTrack) {
                return exactTrack;
            }
        }

        const parsedFeaturedTitle = cleanText(
            parsed && parsed.featured_track_title,
        );
        if (parsedFeaturedTitle) {
            const normalizedParsedTitle = parsedFeaturedTitle.toLowerCase();
            const titleMatch = data.tracks.find(
                (track) =>
                    cleanText(track && track.title).toLowerCase() ===
                        normalizedParsedTitle && track.streamUrl,
            );
            if (titleMatch) {
                return titleMatch;
            }
        }

        const featuredTitle = extractFeaturedTrackTitle(card);
        if (featuredTitle) {
            const normalizedFeaturedTitle =
                cleanText(featuredTitle).toLowerCase();
            const titleMatch = data.tracks.find(
                (track) =>
                    cleanText(track && track.title).toLowerCase() ===
                        normalizedFeaturedTitle && track.streamUrl,
            );
            if (titleMatch) {
                return titleMatch;
            }

            const fuzzyTitleMatch = data.tracks.find(
                (track) =>
                    cleanText(track && track.title)
                        .toLowerCase()
                        .includes(normalizedFeaturedTitle) && track.streamUrl,
            );
            if (fuzzyTitleMatch) {
                return fuzzyTitleMatch;
            }
        }

        return data.tracks.find((track) => track && track.streamUrl) || null;
    }

    function extractFeaturedTrackTitle(card) {
        const featuredLine = findCachedElementByText(
            card,
            "featuredTrackLine",
            "div, p, li, section, span",
            /^featured track\s*:/i,
        );
        if (!featuredLine) {
            return "";
        }

        const inlineLink = featuredLine.querySelector('a[href*="/track/"]');
        if (inlineLink) {
            return normalizedText(inlineLink);
        }

        const inlineText = cleanText(
            (featuredLine.textContent || "").replace(
                /^featured track\s*:/i,
                "",
            ),
        );
        if (inlineText) {
            return inlineText;
        }

        let sibling = featuredLine.nextElementSibling;
        while (sibling) {
            const text = normalizedText(sibling);
            if (text && !/^by\s+/i.test(text)) {
                return text;
            }
            sibling = sibling.nextElementSibling;
        }

        const containerText = normalizedText(featuredLine.parentElement);
        const match = containerText.match(/featured track:\s*(.+)$/i);
        return match && match[1] ? cleanText(match[1]) : "";
    }

    function suppressNativePageAudio() {
        if (
            STATE.pageAudio &&
            STATE.pageAudio !== STATE.sharedAudio &&
            typeof STATE.pageAudio.pause === "function"
        ) {
            STATE.pageAudio.pause();
        }
    }

    function isFeedPage() {
        return (
            /(^|\/)feed\/?$/.test(window.location.pathname) ||
            /\/feed\//.test(window.location.pathname)
        );
    }

    function isFeedEnhancerPage() {
        return isFeedPage() || isArtistMusicPage();
    }

    function getEnhancerPageKind() {
        if (isFeedPage()) {
            return "feed";
        }

        if (isArtistMusicPage()) {
            return "artist-music";
        }

        return "other";
    }

    function setupReleasePageBuyAutofill() {
        void loadUserSettings();

        document.addEventListener("click", (event) => {
            if (!CONFIG.autoFillMinimumPrice) {
                return;
            }

            const formatItem = event.target.closest(".buyItem");
            if (!formatItem) {
                return;
            }

            const price = extractFormatPrice(formatItem);
            if (!price) {
                return;
            }

            const waitForDialog = (tries = 0) => {
                if (tries > 40) {
                    return;
                }

                const priceInput = document.querySelector(".ui-dialog #userPrice");
                if (priceInput) {
                    priceInput.value = price;
                    priceInput.dispatchEvent(new Event("input", { bubbles: true }));
                    priceInput.dispatchEvent(new Event("change", { bubbles: true }));
                    return;
                }

                if (document.querySelector(".ui-dialog")) {
                    setTimeout(() => waitForDialog(tries + 1), 150);
                }
            };

            setTimeout(() => waitForDialog(), 300);
        });
    }

    function extractFormatPrice(buyItem) {
        if (!buyItem) {
            return "";
        }

        const text = cleanText(buyItem.textContent || "");
        if (/name your price|free download|you own this/i.test(text)) {
            return "";
        }

        const basePrice = cleanText(
            buyItem.querySelector(".base-text-color")?.textContent || "",
        );
        if (!basePrice) {
            return "";
        }

        const match = basePrice.match(/(\d+(?:\.\d+)?)/);
        return match ? match[1] : "";
    }

    function setupOwnedReleaseCollectionHandoff() {
        if (!isReleasePage()) {
            return;
        }

        document.addEventListener(
            "click",
            handleOwnedReleaseCollectionClick,
            true,
        );
    }

    function isReleasePage() {
        return (
            /\/(?:album|track)\//.test(window.location.pathname || "") ||
            Boolean(document.querySelector("[data-tralbum]"))
        );
    }

    function handleOwnedReleaseCollectionClick(event) {
        const link = findOwnedReleaseCollectionLink(event.target);
        if (!link) {
            return;
        }

        const title = resolveCurrentReleaseTitleForCollectionSearch();
        if (!title) {
            return;
        }

        if (!isPlainPrimaryClick(event)) {
            void queueOwnedReleaseCollectionSearch(
                title,
                link.href,
                normalizeReleaseUrl(window.location.href),
            );
            return;
        }

        event.preventDefault();
        void navigateToOwnedReleaseCollection(
            title,
            link.href,
            normalizeReleaseUrl(window.location.href),
        );
    }

    function queueOwnedReleaseCollectionSearch(title, targetUrl, releaseUrl) {
        const cleanTitleValue = cleanText(title || "");
        const cleanTargetUrl = cleanText(targetUrl || "");
        if (!cleanTitleValue || !isBandcampFanProfileUrl(cleanTargetUrl)) {
            return Promise.resolve();
        }

        markDebugState("data-bcampx-owned-search-captured", cleanTitleValue);
        return storageSet(OWNED_RELEASE_COLLECTION_SEARCH_KEY, {
            title: cleanTitleValue,
            releaseUrl: normalizeReleaseUrl(releaseUrl || window.location.href),
            targetUrl: cleanTargetUrl,
            ts: Date.now(),
        });
    }

    function navigateToOwnedReleaseCollection(title, targetUrl, releaseUrl) {
        const cleanTargetUrl = cleanText(targetUrl || "");
        return queueOwnedReleaseCollectionSearch(
            title,
            cleanTargetUrl,
            releaseUrl,
        ).finally(() => {
            if (cleanTargetUrl) {
                window.location.assign(cleanTargetUrl);
            }
        });
    }

    function findOwnedReleaseCollectionLink(target) {
        if (!(target instanceof Element)) {
            return null;
        }

        const link = target.closest("a[href]");
        if (!link || !isBandcampFanProfileUrl(link.href)) {
            return null;
        }

        if (link.classList.contains("you-own-this-link")) {
            return link;
        }

        const ownedBlock = target.closest(".you-own-this.digital, .you-own-this");
        if (ownedBlock && ownedBlock.contains(link)) {
            return link;
        }

        if (/\byou own this\b/i.test(normalizedText(link))) {
            return link;
        }

        return null;
    }

    function isPlainPrimaryClick(event) {
        return Boolean(
            event &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey,
        );
    }

    function resolveCurrentReleaseTitleForCollectionSearch() {
        const tralbum = parseTralbumData(document);
        return (
            resolveReleaseTitle(document, tralbum, null) ||
            cleanTitle(document.title)
        );
    }

    function isBandcampFanProfileUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.hostname !== "bandcamp.com") {
                return false;
            }

            const pathname = url.pathname.replace(/\/+$/, "");
            if (!pathname || pathname === "/") {
                return false;
            }

            if (
                /\/(album|track|tagged|discover|feed|fans|terms_of_use|about|help|search|gift_cards)(\/|$)/i.test(
                    pathname,
                )
            ) {
                return false;
            }

            return pathname.split("/").filter(Boolean).length === 1;
        } catch (_error) {
            return false;
        }
    }

    async function applyPendingOwnedReleaseCollectionSearch() {
        if (!isBandcampCollectionSearchPageCandidate()) {
            return;
        }

        const payload = await storageGet(
            OWNED_RELEASE_COLLECTION_SEARCH_KEY,
            null,
        );
        if (!isFreshOwnedReleaseCollectionSearchPayload(payload)) {
            if (payload) {
                await clearOwnedReleaseCollectionSearchPayload();
            }
            return;
        }

        markDebugState("data-bcampx-owned-search-pending", payload.title);
        const didFill = await fillCollectionSearchBoxWhenReady(payload.title);
        if (didFill) {
            markDebugState("data-bcampx-owned-search-filled", payload.title);
        } else {
            markDebugState("data-bcampx-owned-search-filled", "false");
        }
        await clearOwnedReleaseCollectionSearchPayload();
    }

    function isBandcampCollectionSearchPageCandidate() {
        return isBandcampFanProfileUrl(window.location.href);
    }

    function isFreshOwnedReleaseCollectionSearchPayload(payload) {
        return Boolean(
            payload &&
                typeof payload === "object" &&
                cleanText(payload.title) &&
                payload.ts &&
                Date.now() - Number(payload.ts) <=
                    OWNED_RELEASE_COLLECTION_SEARCH_TTL_MS,
        );
    }

    function clearOwnedReleaseCollectionSearchPayload() {
        return storageSet(OWNED_RELEASE_COLLECTION_SEARCH_KEY, null);
    }

    function fillCollectionSearchBoxWhenReady(title) {
        const cleanTitleValue = cleanText(title);
        if (!cleanTitleValue) {
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            let done = false;
            let observer = null;
            let timeoutId = 0;

            const finish = (value) => {
                if (done) {
                    return;
                }
                done = true;
                if (observer) {
                    observer.disconnect();
                }
                window.clearTimeout(timeoutId);
                resolve(value);
            };

            const tryFill = () => {
                const input = findCollectionSearchBox();
                if (!input) {
                    return false;
                }

                setTextInputValue(input, cleanTitleValue);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                try {
                    input.dispatchEvent(
                        new KeyboardEvent("keyup", {
                            bubbles: true,
                            key: cleanTitleValue.slice(-1) || " ",
                        }),
                    );
                } catch (_error) {}
                try {
                    input.focus();
                    if (typeof input.select === "function") {
                        input.select();
                    }
                } catch (_error) {}
                return true;
            };

            if (tryFill()) {
                finish(true);
                return;
            }

            observer = new MutationObserver(() => {
                if (tryFill()) {
                    finish(true);
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
            });
            timeoutId = window.setTimeout(() => finish(false), 15000);
        });
    }

    function findCollectionSearchBox() {
        return document.querySelector(
            [
                'input.search-box[placeholder*="search your collection" i]',
                'input[placeholder*="search your collection" i]',
                ".collection-search input",
            ].join(", "),
        );
    }

    function setTextInputValue(input, value) {
        const proto = Object.getPrototypeOf(input);
        const descriptor =
            proto && Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor && typeof descriptor.set === "function") {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }
    }

    function isArtistMusicPage() {
        const path = window.location.pathname || "/";
        if (/\/(album|track|merch|community|fans|feed|artists|video|live)(\/|$)/.test(path)) {
            return false;
        }

        if (
            !(
                path === "/" ||
                /(^|\/)(music|audio)\/?$/.test(path)
            )
        ) {
            return false;
        }

        if (path === "/" && !isRootArtistMusicPath()) {
            return false;
        }

        if (!hasArtistMusicBandEvidence()) {
            return false;
        }

        return hasArtistMusicReleaseGrid();
    }

    function isRootArtistMusicPath() {
        const tralbumPath = getTralbumPathname();
        if (!tralbumPath) {
            return true;
        }

        return tralbumPath === "/" || tralbumPath === "/music";
    }

    function getTralbumPathname() {
        const tralbumData =
            parseJsonAttribute(
                document.querySelector("[data-tralbum]"),
                "data-tralbum",
            ) || {};
        const tralbumUrl = cleanText(tralbumData.url || "");
        if (!tralbumUrl) {
            return "";
        }

        try {
            const path = new URL(tralbumUrl, window.location.href).pathname;
            return path.replace(/\/$/, "") || "/";
        } catch (_error) {
            return "";
        }
    }

    function hasArtistMusicBandEvidence() {
        const bandData =
            parseJsonAttribute(
                document.querySelector("[data-band]"),
                "data-band",
            ) || {};
        const bandUrl = cleanText(
            bandData.https_url || bandData.url || bandData.local_url || "",
        );

        if (
            bandData &&
            typeof bandData === "object" &&
            (bandData.has_public_tralbums ||
                bandData.has_tralbums ||
                bandData.is_label ||
                bandUrl)
        ) {
            return true;
        }

        return getTralbumPathname() === "/music";
    }

    function hasArtistMusicReleaseGrid() {
        const grid = findArtistMusicSourceGrid();
        if (!grid) {
            return false;
        }

        return Boolean(
            grid.querySelector(
                [
                    ".music-grid-item",
                    "[data-item-id^='album-']",
                    "[data-item-id^='track-']",
                    'a[href*="/album/"]',
                    'a[href*="/track/"]',
                ].join(", "),
            ),
        );
    }

    function isLikelyBandcampDocument() {
        const hostname = String(window.location.hostname || "").toLowerCase();
        if (hostname === "bandcamp.com" || hostname.endsWith(".bandcamp.com")) {
            return true;
        }

        return Boolean(
            document.querySelector(
                [
                    "[data-tralbum]",
                    "[data-band]",
                    "#pagedata",
                    "#js-crumbs-data",
                    "meta[property='og:site_name'][content*='Bandcamp']",
                    "meta[property='og:url'][content*='.bandcamp.com/']",
                ].join(", "),
            ),
        );
    }

    function tryHandleEmbeddedTrackActionHelper() {
        const helperParams = parseTrackActionHelperParams(window.location.hash);
        if (!helperParams) {
            return false;
        }

        if (helperParams.action === "buy-dialog") {
            scheduleTrackActionHelperInit(runTrackBuyDialogHelper);
            return true;
        }

        if (!helperParams.requestId || !helperParams.parentOrigin) {
            return false;
        }

        scheduleTrackActionHelperInit(() => {
            runTrackActionHelper(helperParams);
        });
        return true;
    }

    function parseTrackActionHelperParams(hashValue) {
        const hash = cleanText(hashValue).replace(/^#/, "");
        if (!hash) {
            return null;
        }

        const params = new URLSearchParams(hash);
        const action = cleanText(params.get("bcampx-helper"));
        if (!action) {
            return null;
        }

        return {
            action,
            requestId: cleanText(params.get("bcampx-request")),
            parentOrigin: cleanText(params.get("bcampx-parent-origin")),
        };
    }

    function scheduleTrackActionHelperInit(callback) {
        window.setTimeout(() => {
            if (typeof callback === "function") {
                callback();
            }
        }, 250);
    }

    function getDocumentInsertionRoot() {
        return (
            document.body ||
            document.documentElement ||
            document.head ||
            null
        );
    }

    function appendToDocument(node) {
        const root = getDocumentInsertionRoot();
        if (!root || !node) {
            return false;
        }

        root.appendChild(node);
        return true;
    }

    function prependToContainer(container, node) {
        if (!container || !node) {
            return false;
        }

        if (typeof container.prepend === "function") {
            container.prepend(node);
            return true;
        }

        container.insertBefore(node, container.firstChild || null);
        return true;
    }

    function scheduleNextFrame(callback) {
        if (typeof callback !== "function") {
            return 0;
        }

        if (typeof window.requestAnimationFrame === "function") {
            return window.requestAnimationFrame(callback);
        }

        return window.setTimeout(callback, 16);
    }

    function clearTrackActionHelperHash() {
        try {
            if (
                window.history &&
                typeof window.history.replaceState === "function"
            ) {
                window.history.replaceState(
                    null,
                    document.title,
                    window.location.pathname + window.location.search,
                );
            }
        } catch (_error) {}
    }

    async function runTrackBuyDialogHelper() {
        clearTrackActionHelperHash();

        // Helper page skips normal init, load settings manually
        await loadUserSettings();

        const getKnownPrice = () => {
            const buyItem = document.querySelector(
                ".buyItem.digital, .you-own-this.digital",
            );
            if (!buyItem) {
                return "";
            }

            const fullText = cleanText(buyItem.textContent || "");
            if (/name your price|free download|you own this/i.test(fullText)) {
                return "";
            }

            const basePrice = cleanText(
                buyItem.querySelector(".base-text-color")?.textContent || "",
            );
            if (!basePrice) {
                return "";
            }

            const match = basePrice.match(/(\d+(?:\.\d+)?)/);
            return match ? match[1] : "";
        };

        const openBuyDialog = () => {
            const buyButton = Array.from(
                document.querySelectorAll("button.download-link.buy-link"),
            ).find((node) =>
                /(?:buy|pre-order)\s+digital\s+(?:album|track)|free download/i.test(
                    (node.textContent || "").trim(),
                ),
            );
            if (!buyButton) {
                return "";
            }

            const buttonText = cleanText(buyButton.textContent || "");
            buyButton.click();
            return buttonText;
        };

        const focusPriceInput = () => {
            const priceInput = document.querySelector("#userPrice");
            if (!priceInput) {
                return false;
            }
            try {
               const knownPrice = CONFIG.autoFillMinimumPrice ? getKnownPrice() : "";
              if (knownPrice) {
                    priceInput.value = knownPrice;
                    priceInput.dispatchEvent(new Event("input", { bubbles: true }));
                    priceInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
            } catch (_error) {}

            try {
                priceInput.focus();
                if (typeof priceInput.select === "function") {
                    priceInput.select();
                }
            } catch (_error) {}

            return true;
        };

        let attempts = 0;
        const maxAttempts = 40;
        const tick = () => {
            attempts += 1;
            if (document.querySelector(".ui-dialog #userPrice")) {
                focusPriceInput();
                return;
            }

            if (document.querySelector(".ui-dialog")) {
                return;
            }

            const openedButtonText = openBuyDialog();
            if (/free download/i.test(openedButtonText)) {
                return;
            }
            if (attempts >= maxAttempts) {
                return;
            }
            window.setTimeout(tick, 250);
        };

        tick();
    }

    function runTrackActionHelper({
        action,
        requestId,
        parentOrigin,
    }) {
        clearTrackActionHelperHash();
        const helperTarget =
            window.parent && window.parent !== window
                ? window.parent
                : window.opener && !window.opener.closed
                  ? window.opener
                  : null;
        const isTopLevelHelper = window.top === window;

        const send = (payload) => {
            if (!helperTarget) {
                return;
            }

            try {
                helperTarget.postMessage(
                    Object.assign(
                        {
                            type: "bcampx-track-action-result",
                            action,
                            requestId,
                        },
                        payload || {},
                    ),
                    parentOrigin || "*",
                );
            } catch (_error) {
                try {
                    helperTarget.postMessage(
                        Object.assign(
                            {
                                type: "bcampx-track-action-result",
                                action,
                                requestId,
                                ok: false,
                                error: "Could not reach parent window.",
                            },
                            payload || {},
                        ),
                        "*",
                    );
                } catch (_nestedError) {}
            }
        };

        const renderHelperStatus = (message, tone = "info") => {
            if (!isTopLevelHelper || !document.body) {
                return;
            }

            const existing = document.querySelector(".bcampx__helper-status");
            if (existing) {
                existing.remove();
            }

            const banner = document.createElement("div");
            banner.className = "bcampx__helper-status";
            banner.setAttribute("data-tone", tone);
            banner.textContent = message;
            banner.style.position = "sticky";
            banner.style.top = "0";
            banner.style.zIndex = "2147483647";
            banner.style.padding = "12px 16px";
            banner.style.font = "600 14px/1.4 system-ui, -apple-system, sans-serif";
            banner.style.color = tone === "error" ? "#7f1d1d" : "#0f5132";
            banner.style.background = tone === "error" ? "#fee2e2" : "#dcfce7";
            banner.style.borderBottom = `1px solid ${tone === "error" ? "#fecaca" : "#86efac"}`;
            prependToContainer(document.body || document.documentElement, banner);
        };

        const finishTopLevelHelper = (message, tone = "info") => {
            if (!isTopLevelHelper) {
                return;
            }

            renderHelperStatus(message, tone);
            if (window.opener && !window.opener.closed && tone !== "error") {
                window.setTimeout(() => {
                    try {
                        window.close();
                    } catch (_error) {}
                }, 900);
            }
        };

        const readJsonAttr = (selector, attr) => {
            const node = document.querySelector(selector);
            if (!node) {
                return null;
            }

            try {
                return JSON.parse(node.getAttribute(attr) || "null");
            } catch (_error) {
                return null;
            }
        };

        const collectInfo =
            readJsonAttr(
                "[data-tralbum-collect-info]",
                "data-tralbum-collect-info",
            ) || {};
        const tralbumData =
            readJsonAttr("[data-tralbum]", "data-tralbum") || {};
        const crumbs = readJsonAttr("#js-crumbs-data", "data-crumbs") || {};
        const pagedataBlob = (() => {
            try {
                return JSON.parse(
                    document.querySelector("#pagedata")?.dataset?.blob || "{}",
                );
            } catch (_error) {
                return {};
            }
        })();

        if (action === "wishlist-state") {
            const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
            const isWishlisted =
                !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
            const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
            const itemId =
                tralbumData.current?.id || collectInfo.collect_item_id || "";
            const bandId =
                tralbumData.current?.band_id ||
                collectInfo.collect_band_id ||
                "";
            send({
                ok: true,
                active: isWishlisted,
                canToggle: Boolean(fanId && itemId && bandId),
            });
            return;
        }

        if (action === "wishlist") {
            const fanTralbumData = pagedataBlob.fan_tralbum_data || {};
            const isWishlisted =
                !!fanTralbumData.is_wishlisted || !!collectInfo.is_collected;
            const fanId = resolveFanIdFromPageState(pagedataBlob, collectInfo);
            const crumbKey = isWishlisted
                ? "uncollect_item_cb"
                : "collect_item_cb";
            const crumb =
                typeof crumbs[crumbKey] === "string" ? crumbs[crumbKey] : "";
            if (!fanId) {
                send({
                    ok: false,
                    error: "Sign in to Bandcamp before using wishlist actions.",
                });
                return;
            }
            if (!crumb) {
                send({
                    ok: false,
                    error:
                        "This Bandcamp tab looks out of date. Refresh the release page and try again.",
                });
                return;
            }

            const endpoint = isWishlisted
                ? "/uncollect_item_cb"
                : "/collect_item_cb";
            const payload = new URLSearchParams();
            payload.set("fan_id", String(fanId));
            payload.set(
                "item_id",
                String(
                    tralbumData.current?.id || collectInfo.collect_item_id || "",
                ),
            );
            payload.set(
                "item_type",
                String(
                    (
                        tralbumData.current?.type ||
                        collectInfo.collect_item_type ||
                        "track"
                    )
                        .replace(/^t$/i, "track")
                        .replace(/^a$/i, "album")
                        .replace(/^b$/i, "bundle"),
                ),
            );
            payload.set(
                "band_id",
                String(
                    tralbumData.current?.band_id ||
                        collectInfo.collect_band_id ||
                        "",
                ),
            );
            payload.set("crumb", crumb);

            const onSuccess = (body) => {
                if (!body || body.ok !== true) {
                    throw new Error(
                        body && body.error_message
                            ? body.error_message
                            : "Wishlist request failed.",
                    );
                }

                send({
                    ok: true,
                    active: !isWishlisted,
                    statusText: !isWishlisted ? "Saved" : "Removed",
                });
                finishTopLevelHelper(
                    !isWishlisted
                        ? "Saved to your Bandcamp wishlist."
                        : "Removed from your Bandcamp wishlist.",
                );
            };

            fetch(location.origin + endpoint, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: payload.toString(),
            })
                .then(async (response) => {
                    let body = null;
                    try {
                        body = await response.json();
                    } catch (_error) {
                        body = null;
                    }

                    if (!response.ok) {
                        throw new Error(
                            (body && body.error_message) ||
                                "Wishlist request failed.",
                        );
                    }

                    onSuccess(body);
                })
                .catch((error) => {
                    send({
                        ok: false,
                        error:
                            error && error.message
                                ? error.message
                                : "Wishlist request failed.",
                    });
                    finishTopLevelHelper(
                        error && error.message
                            ? error.message
                            : "Wishlist request failed.",
                        "error",
                    );
                });
            return;
        }

        if (action !== "basket") {
            send({ ok: false, error: "Unknown track action." });
            return;
        }

        send({ ok: false, error: "Basket helper is disabled." });
    }

    function getExternalHostApi() {
        const host = globalThis.__BCAMPX_HOST__;
        if (!host || typeof host !== "object") {
            return null;
        }

        return host;
    }

    function canUseExternalHostMethod(methodName) {
        const host = getExternalHostApi();
        return !!(host && typeof host[methodName] === "function");
    }

    function isWebExtensionHost() {
        const host = getExternalHostApi();
        return !!(host && host.kind === "webextension");
    }

    function isCustomDomainReleaseUrl(rawUrl) {
        const releaseUrl = normalizeReleaseUrl(rawUrl || "");
        return !!(releaseUrl && !isBandcampReleaseUrl(releaseUrl));
    }

    function hasExtensionHostPermission(rawUrl) {
        const releaseUrl = normalizeReleaseUrl(rawUrl || "");
        if (!releaseUrl || !isWebExtensionHost()) {
            return false;
        }

        const host = getExternalHostApi();
        return !!(
            host &&
            typeof host.hasHostPermission === "function" &&
            host.hasHostPermission(releaseUrl)
        );
    }

    function getHostRequestOptions(baseOptions = {}) {
        return {
            method: baseOptions.method || "GET",
            data: baseOptions.data,
            headers: baseOptions.headers,
            credentials: baseOptions.credentials,
            timeoutMs: CONFIG.fetchTimeoutMs,
        };
    }

    function setupTrackActionMessageBridge() {
        if (STATE.trackActionBridgeInitialized) {
            return;
        }

        STATE.trackActionBridgeInitialized = true;
        window.addEventListener("message", handleTrackActionMessage);
    }

    function handleTrackActionMessage(event) {
        const data = event && event.data;
        if (!data || !data.type) {
            return;
        }

        if (data.type !== "bcampx-track-action-result") {
            return;
        }

        const pending = STATE.pendingTrackActionRequests.get(data.requestId);
        if (!pending) {
            return;
        }

        if (event.origin && pending.origin && event.origin !== pending.origin) {
            recordTrackActionDiagnostic("message-origin-mismatch", {
                action: pending.action,
                expectedOrigin: pending.origin,
                actualOrigin: event.origin,
            });
            return;
        }

        if (data.ok) {
            completeTrackActionRequest(pending, data.requestId, data);
            return;
        }

        recordTrackActionDiagnostic("action-failed", {
            action: pending.action,
            origin: pending.origin,
            error: data.error || "Track action failed.",
        });
        failTrackActionRequest(
            pending,
            data.requestId,
            new Error(data.error || "Track action failed."),
        );
    }

    function finalizePendingTrackActionRequest(requestId) {
        const pending = STATE.pendingTrackActionRequests.get(requestId);
        if (!pending) {
            return null;
        }

        STATE.pendingTrackActionRequests.delete(requestId);
        window.clearTimeout(pending.timeoutId);
        if (pending.iframe && pending.iframe.parentNode) {
            pending.iframe.remove();
        }
        return pending;
    }

    function recordTrackActionDiagnostic(code, details = {}) {
        STATE.lastTrackActionDiagnostic = {
            code,
            details,
            at: Date.now(),
        };
    }

    function completeTrackActionRequest(pending, requestId, result) {
        finalizePendingTrackActionRequest(requestId);
        if (pending.action === "wishlist-state") {
            pending.resolve(result);
            return;
        }

        if (pending.button && pending.button.classList.contains("bcampx-player-favorite")) {
            const active =
                result && Object.prototype.hasOwnProperty.call(result, "active")
                    ? Boolean(result.active)
                    : Boolean(pending.desiredActive);
            const releaseUrl = normalizeReleaseUrl(pending.trackUrl || "");
            if (releaseUrl) {
                STATE.playerWishlistStateByUrl.set(releaseUrl, {
                    status: "known",
                    active,
                    canToggle: true,
                    checkedAt: Date.now(),
                });
                STATE.playerWishlistActionRequests.delete(releaseUrl);
                clearPlayerWishlistStateRetry(releaseUrl);
            }
            if (
                releaseUrl &&
                releaseUrl === normalizeReleaseUrl(STATE.activeReleaseUrl || "")
            ) {
                setFavoriteButtonState(pending.button, active);
            }
            syncFavoriteButtonState();
        } else {
            setTrackActionButtonPending(pending.button, false);
            flashTrackActionButton(
                pending.button,
                result && result.statusText ? result.statusText : "Done",
            );
        }
        pending.resolve(result);
    }

    function failTrackActionRequest(pending, requestId, error, flashLabel = "Error") {
        finalizePendingTrackActionRequest(requestId);
        if (pending.action !== "wishlist-state") {
            if (
                pending.button &&
                pending.button.classList.contains("bcampx-player-favorite")
            ) {
                STATE.playerWishlistActionRequests.delete(
                    normalizeReleaseUrl(pending.trackUrl || ""),
                );
                syncFavoriteButtonState();
                pending.reject(error);
                return;
            }
            setTrackActionButtonPending(pending.button, false);
            flashTrackActionButton(pending.button, flashLabel);
        }
        pending.reject(error);
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
                    const controller = getCardController(card);
                    if (
                        controller &&
                        !controller.loaded &&
                        !controller.loading
                    ) {
                        controller.fetchAndRender({ auto: true });
                    }
                });
            },
            { rootMargin: CONFIG.observerRootMargin },
        );
    }

    function setupMutationObserver() {
        if (!("MutationObserver" in window) || !document.body) {
            return;
        }

        STATE.mutationObserver = new MutationObserver((mutations) => {
            let shouldFullScan = false;
            let shouldInvalidateMemo = false;

            mutations.forEach((mutation) => {
                if (mutation.type === "attributes") {
                    const target = mutation.target;
                    if (!(target instanceof Element)) {
                        return;
                    }

                    shouldInvalidateMemo = true;
                    if (hasPotentialReleaseSignal(target)) {
                        const story = getStoryRoot(target);
                        if (story) {
                            scheduleScan(story);
                            return;
                        }
                    }

                    shouldFullScan = true;
                    return;
                }

                Array.from(mutation.addedNodes || []).forEach((node) => {
                    if (!(node instanceof Element)) {
                        return;
                    }

                    shouldInvalidateMemo = true;
                    if (node.matches(FEED_CARD_ROOT_SELECTOR)) {
                        scheduleScan(node);
                        return;
                    }

                    const nestedStories = node.querySelectorAll
                        ? node.querySelectorAll(FEED_CARD_ROOT_SELECTOR)
                        : [];
                    if (nestedStories.length) {
                        nestedStories.forEach((story) => scheduleScan(story));
                        return;
                    }

                    if (hasPotentialReleaseSignal(node)) {
                        const story = getStoryRoot(node);
                        if (story) {
                            scheduleScan(story);
                            return;
                        }
                    }

                    shouldFullScan = true;
                });
            });

            if (shouldInvalidateMemo) {
                invalidateNodeMemoCache();
            }

            if (shouldFullScan) {
                scheduleScan();
            }
        });

        STATE.mutationObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ["data-item-json"],
            childList: true,
            subtree: true,
        });
    }

    function scheduleScan(root = null) {
        if (root instanceof Element) {
            const story = getStoryRoot(root);
            if (story instanceof Element) {
                STATE.pendingScanRoots.add(story);
            } else {
                STATE.pendingFullScan = true;
            }
        } else {
            STATE.pendingFullScan = true;
        }

        window.clearTimeout(STATE.scanTimer);
        STATE.scanTimer = window.setTimeout(
            scanForCards,
            CONFIG.scanDebounceMs,
        );
    }

    function scanForCards() {
        incrementDebugCounter("data-bcampx-scan-count");
        const roots = getScanRoots();
        const scannableCards = [];

        getStoryCardsFromRoots(roots).forEach((card) => {
            const classification = classifyStoryCard(card);
            if (classification === "enhance") {
                scannableCards.push(card);
            }
        });

        enhanceScannableCards(scannableCards);
        mergeAdjacentTrackPurchaseCards(scannableCards);
    }

    function classifyStoryCard(card) {
        if (!(card instanceof Element)) {
            return "ignore";
        }

        maybeResetRetryableSkippedCard(card);

        if (isAlsoBoughtRecommendationCard(card)) {
            markStoryCardSkipped(card, {
                cleanup: true,
                reason: "also-bought",
            });
            return "skip";
        }

        if (card.closest(EXCLUDED_SECTION_SELECTOR) || !looksLikeFeedCard(card)) {
            return "ignore";
        }

        if (isMalformedFeedCard(card)) {
            markStoryCardSkipped(card, {
                reason: "malformed",
                retryable: true,
            });
            return "skip";
        }

        if (isFullDiscographyCard(card)) {
            markStoryCardSkipped(card, {
                reason: "full-discography",
            });
            return "skip";
        }

        return "enhance";
    }

    function markStoryCardSkipped(card, options = {}) {
        if (!(card instanceof Element)) {
            return;
        }

        if (options.cleanup) {
            cleanupEnhancedCard(card);
        }

        card.setAttribute(ENHANCED_ATTR, "skipped");
        if (options.reason) {
            card.setAttribute(SKIP_REASON_ATTR, cleanText(options.reason));
        } else {
            card.removeAttribute(SKIP_REASON_ATTR);
        }
        if (options.retryable) {
            card.setAttribute(RETRYABLE_SKIP_ATTR, "true");
        } else {
            card.removeAttribute(RETRYABLE_SKIP_ATTR);
        }
    }

    function maybeResetRetryableSkippedCard(card) {
        if (!isRetryableSkippedCard(card)) {
            return false;
        }

        if (cleanText(card.getAttribute(SKIP_REASON_ATTR)) !== "malformed") {
            return false;
        }

        if (
            isMalformedFeedCard(card) ||
            isFullDiscographyCard(card) ||
            isAlsoBoughtRecommendationCard(card)
        ) {
            return false;
        }

        clearStoryCardSkipState(card);
        clearNodeMemoDeep(card);
        markDebugState("data-bcampx-last-retry", "malformed-card-recovered");
        return true;
    }

    function isRetryableSkippedCard(card) {
        return Boolean(
            card instanceof Element &&
                card.getAttribute(ENHANCED_ATTR) === "skipped" &&
                card.getAttribute(RETRYABLE_SKIP_ATTR) === "true",
        );
    }

    function clearStoryCardSkipState(card) {
        if (!(card instanceof Element)) {
            return;
        }

        if (card.getAttribute(ENHANCED_ATTR) === "skipped") {
            card.removeAttribute(ENHANCED_ATTR);
        }
        card.removeAttribute(SKIP_REASON_ATTR);
        card.removeAttribute(RETRYABLE_SKIP_ATTR);
    }

    function cleanupEnhancedCard(card) {
        if (!(card instanceof Element)) {
            return;
        }

        card.querySelectorAll(".bcampx").forEach((node) => {
            node.remove();
        });

        card
            .querySelectorAll(`[${HIDDEN_SUPPORTED_ATTR}="true"]`)
            .forEach((node) => {
                node.hidden = false;
                node.removeAttribute(HIDDEN_SUPPORTED_ATTR);
            });

        card.classList.remove("bcampx--supported-card");
        setCardController(card, null);
    }

    function clearNodeMemo(node) {
        if (node && node.__bcampxMemo) {
            delete node.__bcampxMemo;
        }
    }

    function clearNodeMemoDeep(root) {
        if (!(root instanceof Element)) {
            return;
        }

        invalidateNodeMemoCache();
    }

    function invalidateNodeMemoCache() {
        STATE.memoVersion += 1;
    }

    function hasPotentialReleaseSignal(node) {
        if (!(node instanceof Element)) {
            return false;
        }

        if (node.matches('[data-item-json], a[href*="/album/"], a[href*="/track/"]')) {
            return true;
        }

        return Boolean(
            node.querySelector &&
                node.querySelector(
                    '[data-item-json], a[href*="/album/"], a[href*="/track/"]',
                ),
        );
    }

    function getScanRoots() {
        const roots = [];

        if (STATE.pendingFullScan || !STATE.pendingScanRoots.size) {
            roots.push(document);
        } else {
            STATE.pendingScanRoots.forEach((root) => {
                if (root instanceof Element && document.contains(root)) {
                    roots.push(root);
                }
            });
        }

        STATE.pendingScanRoots.clear();
        STATE.pendingFullScan = false;
        return roots.length ? roots : [document];
    }

    function getStoryCardsFromRoots(roots) {
        const seen = new Set();
        const cards = [];

        roots
            .flatMap((root) =>
                getMatchingRootOrDescendants(root, FEED_CARD_ROOT_SELECTOR),
            )
            .forEach((candidate) => {
                const card = candidate;
                if (!(card instanceof Element) || seen.has(card)) {
                    return;
                }

                const parentCard = card.parentElement
                    ? card.parentElement.closest(FEED_CARD_ROOT_SELECTOR)
                    : null;
                if (parentCard && seen.has(parentCard)) {
                    return;
                }

                seen.add(card);
                cards.push(card);
            });

        return cards;
    }

    function enhanceScannableCards(cards) {
        cards.forEach((card) => {
            incrementDebugCounter("data-bcampx-card-root-count");

            if (card.hasAttribute(ENHANCED_ATTR)) {
                return;
            }

            const releaseContext = getCardReleaseRequestContext(card);
            const releaseUrl = releaseContext.releaseUrl;
            incrementDebugCounter("data-bcampx-release-link-count");
            if (!releaseUrl) {
                markDebugState("data-bcampx-last-skip", "missing-release-url");
                return;
            }

            incrementDebugCounter("data-bcampx-fan-activity-link-count");
            enhanceCard(card, releaseUrl, releaseContext);
        });
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

        if (
            root.querySelector(
                'a.item-link[href*="#buyFullDiscography"], a[href*="#buyFullDiscography"]',
            )
        ) {
            return true;
        }

        const titleNode = root.querySelector(
            ".collection-item-title, .item-title",
        );
        if (
            titleNode &&
            /\bfull(?:\s+digital)?\s+discography\b/i.test(
                normalizedText(titleNode),
            )
        ) {
            return true;
        }

        const storyTitle = root.querySelector(".story-title");
        if (
            storyTitle &&
            /\bfull\s+discography\b/i.test(normalizedText(storyTitle))
        ) {
            return true;
        }

        return Boolean(
            root.querySelector(".bundle-art-container") &&
            root.querySelector(".bundle-releases"),
        );
    }

    function mergeAdjacentTrackPurchaseCards(cards = []) {
        cards.forEach((card) => {
            if (card.getAttribute(MERGED_CHILD_ATTR) === "true") {
                return;
            }

            const candidate = getTrackPurchaseMergeCandidate(card);
            if (!candidate) {
                return;
            }

            const previousCandidate = findPreviousAdjacentMergeCandidate(candidate);
            if (previousCandidate && previousCandidate.card !== card) {
                mergeTrackPurchaseCard(
                    previousCandidate.card,
                    card,
                    candidate.trackTitle,
                );
            }
        });
    }

    function getTrackPurchaseMergeKey(candidate) {
        return [
            candidate.fanKey,
            candidate.activityType,
            candidate.releaseGroupKey,
        ].join("::");
    }

    function findPreviousAdjacentMergeCandidate(candidate) {
        const cards = getStoryCardsFromRoots([document]);
        const currentIndex = cards.indexOf(candidate.card);
        if (currentIndex <= 0) {
            return null;
        }

        const previous = cards
            .slice(0, currentIndex)
            .reverse()
            .find((card) => card.getAttribute(MERGED_CHILD_ATTR) !== "true");

        if (
            !previous ||
            previous.getAttribute(MERGED_CHILD_ATTR) === "true" ||
            !looksLikeFeedCard(previous) ||
            isMalformedFeedCard(previous) ||
            previous.closest(EXCLUDED_SECTION_SELECTOR)
        ) {
            return null;
        }

        const previousCandidate = getTrackPurchaseMergeCandidate(previous);
        if (
            previousCandidate &&
            getTrackPurchaseMergeKey(previousCandidate) ===
                getTrackPurchaseMergeKey(candidate)
        ) {
            return previousCandidate;
        }

        return null;
    }

    function getTrackPurchaseMergeCandidate(card) {
        if (!(card instanceof Element)) {
            return null;
        }

        const memo = getNodeMemo(card);
        if (
            memo &&
            Object.prototype.hasOwnProperty.call(memo, "trackPurchaseMergeCandidate")
        ) {
            return memo.trackPurchaseMergeCandidate;
        }

        const activityType = extractActivityType(card);
        if (activityType !== "bought-track") {
            if (memo) {
                memo.trackPurchaseMergeCandidate = null;
            }
            return null;
        }

        const fanKey = extractFanKey(card);
        const releaseGroupKey = getCardReleaseGroupKey(card);
        const trackTitle = extractTrackTitleFromCard(card);

        if (!fanKey || !releaseGroupKey || !trackTitle) {
            if (memo) {
                memo.trackPurchaseMergeCandidate = null;
            }
            return null;
        }

        const candidate = {
            card,
            fanKey,
            activityType,
            releaseGroupKey,
            trackTitle,
        };

        if (memo) {
            memo.trackPurchaseMergeCandidate = candidate;
        }

        return candidate;
    }

    function extractActivityType(card) {
        const headline = findActivityHeadline(card) || getStoryTitleNode(card) || card;
        const text = normalizedText(headline).toLowerCase();
        if (
            /(?:bought|purchased)\s+a\s+track\b/.test(text) ||
            /(?:bought|purchased)\s+track\b/.test(text)
        ) {
            return "bought-track";
        }

        if (
            /(?:bought|purchased)\s+an\s+album\b/.test(text) ||
            /(?:bought|purchased)\s+album\b/.test(text)
        ) {
            return "bought-album";
        }

        if (/wishlisted\b/.test(text)) {
            return "wishlisted";
        }

        return "";
    }

    function extractFanKey(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "fanKey")) {
            return memo.fanKey || "";
        }

        const explicitFanLink = card.querySelector(
            ".story-title .fan-name a[href], .story-title a.fan-name[href], .story-title .fan-name[href]",
        );
        if (explicitFanLink && explicitFanLink.href) {
            try {
                const url = new URL(explicitFanLink.href, window.location.href);
                const fanKey = cleanText(
                    url.pathname.replace(/^\/+|\/+$/g, ""),
                ).toLowerCase();
                if (memo) {
                    memo.fanKey = fanKey;
                }
                return fanKey;
            } catch (_error) {
                // Fall through to broader extraction.
            }
        }

        const profileLink = Array.from(card.querySelectorAll("a[href]")).find(
            isLikelyProfileLink,
        );
        if (profileLink && profileLink.href) {
            try {
                const url = new URL(profileLink.href, window.location.href);
                const fanKey = cleanText(
                    url.pathname.replace(/^\/+|\/+$/g, ""),
                ).toLowerCase();
                if (memo) {
                    memo.fanKey = fanKey;
                }
                return fanKey;
            } catch (_error) {
                // Fall through to text extraction.
            }
        }

        const headline = findActivityHeadline(card);
        const actor = extractFeedHeadlineActor(
            headline ? normalizedText(headline) : normalizedText(card),
        );
        const fanKey = actor ? actor.toLowerCase() : "";
        if (memo) {
            memo.fanKey = fanKey;
        }
        return fanKey;
    }

    function extractFanDisplayName(card) {
        if (!(card instanceof Element)) {
            return "This fan";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "fanDisplayName")) {
            return memo.fanDisplayName || "This fan";
        }

        const explicitFanName = card.querySelector(
            ".story-title .fan-name, .story-title a.fan-name, .story-title .artist-name",
        );
        if (explicitFanName) {
            const text = normalizedText(explicitFanName);
            if (text) {
                if (memo) {
                    memo.fanDisplayName = text;
                }
                return text;
            }
        }

        const headline = findActivityHeadline(card);
        const actor = extractFeedHeadlineActor(
            headline ? normalizedText(headline) : normalizedText(card),
        );
        const displayName = actor || "This fan";
        if (memo) {
            memo.fanDisplayName = displayName;
        }
        return displayName;
    }

    function getItemJsonTrackTitle(node) {
        const parsed = getParsedItemJson(node);
        return cleanText(
            (parsed && parsed.item_title) ||
                (parsed && parsed.track_title) ||
                (parsed && parsed.title) ||
                (parsed && parsed.item_name) ||
                (parsed && parsed.name) ||
                "",
        );
    }

    function getCardReleaseGroupKey(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "cardReleaseGroupKey")) {
            return memo.cardReleaseGroupKey || "";
        }

        const albumLink = getCardAlbumReleaseUrl(card);
        if (albumLink) {
            const releaseGroupKey = `album:${albumLink}`;
            if (memo) {
                memo.cardReleaseGroupKey = releaseGroupKey;
            }
            return releaseGroupKey;
        }

        const itemJsonReleaseUrl = getItemJsonReleaseUrl(card);
        if (itemJsonReleaseUrl && /(^|\/)album\//.test(itemJsonReleaseUrl)) {
            const releaseGroupKey = `album:${itemJsonReleaseUrl}`;
            if (memo) {
                memo.cardReleaseGroupKey = releaseGroupKey;
            }
            return releaseGroupKey;
        }

        const releaseLink = Array.from(
            card.querySelectorAll(RELEASE_LINK_SELECTOR),
        )
            .map((link) => normalizeReleaseUrl(link.href))
            .find(Boolean);
        if (!releaseLink) {
            if (memo) {
                memo.cardReleaseGroupKey = "";
            }
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
        const releaseGroupKey = `heuristic:${origin}|${artist}|${artUrl}`;
        if (memo) {
            memo.cardReleaseGroupKey = releaseGroupKey;
        }
        return releaseGroupKey;
    }

    function extractArtistNameFromCard(card) {
        const contentColumn = findContentColumn(card);
        const explicitByline =
            (contentColumn || card).querySelector(
                ".itemsubtext, .collection-item-artist, .item-artist, .tralbum-artist",
            ) || null;
        if (explicitByline) {
            const explicitText = cleanText(
                (explicitByline.textContent || "").replace(/^by\s+/i, ""),
            );
            if (explicitText) {
                return explicitText;
            }
        }

        const byline = findCachedElementByText(
            contentColumn || card,
            "artistByline",
            "div, p, li, span, a",
            /^by\s+/i,
        );
        if (byline) {
            return cleanText((byline.textContent || "").replace(/^by\s+/i, ""));
        }

        const text = normalizedText(card);
        const match = text.match(
            /\bby\s+(.+?)(?:\s+featured track:|\s+buy now|\s+wishlist|\s+hear more|\s+tags?:|$)/i,
        );
        return match && match[1] ? cleanText(match[1]) : "";
    }

    function extractTrackTitleFromCard(card) {
        if (!(card instanceof Element)) {
            return "";
        }

        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "trackTitleFromCard")) {
            return memo.trackTitleFromCard || "";
        }

        const contentColumn = findContentColumn(card);
        const trackScope = contentColumn || card;

        const featuredTrackText = extractFeaturedTrackTitle(trackScope);
        if (featuredTrackText) {
            if (memo) {
                memo.trackTitleFromCard = featuredTrackText;
            }
            return featuredTrackText;
        }

        const itemJsonTrackTitle = getItemJsonTrackTitle(trackScope);
        if (itemJsonTrackTitle) {
            if (memo) {
                memo.trackTitleFromCard = itemJsonTrackTitle;
            }
            return itemJsonTrackTitle;
        }

        const explicitTrackLink = Array.from(
            trackScope.querySelectorAll('a[href*="/track/"]'),
        ).find((link) => {
            const text = normalizedText(link);
            return (
                text &&
                !/\b(buy now|wishlist|hear more|open release|more)\b/i.test(
                    text,
                )
            );
        });
        if (explicitTrackLink) {
            const trackTitle = normalizedText(explicitTrackLink);
            if (memo) {
                memo.trackTitleFromCard = trackTitle;
            }
            return trackTitle;
        }

        const explicitTitle = trackScope.querySelector(
            ".collection-item-title, .item-title, h1, h2, h3, h4",
        );
        if (
            explicitTitle &&
            !explicitTitle.closest(".story-title, .bcampx__merge-note")
        ) {
            const explicitText = normalizedText(explicitTitle);
            if (
                explicitText &&
                !/^(featured track:|by\s+|buy now|wishlist|hear more|supported by|tracks?)\b/i.test(
                    explicitText,
                )
            ) {
                if (memo) {
                    memo.trackTitleFromCard = explicitText;
                }
                return explicitText;
            }
        }

        const titleCandidate = Array.from(
            trackScope.querySelectorAll(
                "h1, h2, h3, h4, strong, a, div, p, span",
            ),
        ).find((node) => {
            const text = normalizedText(node);
            if (!text) {
                return false;
            }

            if (
                /^(featured track:|by\s+|buy now|wishlist|hear more|supported by|tracks?)\b/i.test(
                    text,
                )
            ) {
                return false;
            }

            if (node.querySelector && node.querySelector("img")) {
                return false;
            }

            if (
                node.closest &&
                node.closest(".story-title, .bcampx__merge-note")
            ) {
                return false;
            }

            return true;
        });

        const trackTitle = titleCandidate ? normalizedText(titleCandidate) : "";
        if (memo) {
            memo.trackTitleFromCard = trackTitle;
        }
        return trackTitle;
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

        const mergeState = ensureMergedTrackState(primaryCard);
        if (!mergeState.primaryTitle) {
            mergeState.primaryTitle = extractTrackTitleFromCard(primaryCard);
        }
        addMergedTrackTitle(primaryCard, trackTitle);

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
        return ensureMergedTrackState(card).titles;
    }

    function getMergedTrackTitleSet(card) {
        const mergeState = ensureMergedTrackState(card);
        const titles = mergeState.titles.slice();
        const primaryTitle = cleanText(
            mergeState.primaryTitle || extractTrackTitleFromCard(card),
        );
        if (primaryTitle) {
            titles.unshift(primaryTitle);
        }

        return new Set(
            titles
                .map((title) => cleanText(title).toLowerCase())
                .filter(Boolean),
        );
    }

    function ensureMergedTrackState(card) {
        if (!card) {
            return { primaryTitle: "", titles: [] };
        }

        if (!card.__bcampxMergeState) {
            card.__bcampxMergeState = {
                primaryTitle: "",
                titles: [],
            };
        }

        if (!Array.isArray(card.__bcampxMergeState.titles)) {
            card.__bcampxMergeState.titles = [];
        }

        return card.__bcampxMergeState;
    }

    function addMergedTrackTitle(card, title) {
        const normalizedTitle = cleanText(title);
        if (!normalizedTitle) {
            return;
        }

        const mergeState = ensureMergedTrackState(card);
        if (
            !mergeState.titles.some(
                (entry) =>
                    entry.toLowerCase() === normalizedTitle.toLowerCase(),
            )
        ) {
            mergeState.titles.push(normalizedTitle);
        }
    }

    function findActivityHeadline(card) {
        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "activityHeadlineNode")) {
            return memo.activityHeadlineNode;
        }

        const storyTitle = findCachedSelector(card, "storyTitleNode", ".story-title");
        let result = null;
        if (
            storyTitle &&
            FAN_ACTIVITY_TEXT_PATTERN.test(normalizedText(storyTitle))
        ) {
            result = storyTitle;
        } else {
            result = findCachedElementByText(
            card,
            "activityHeadline",
            "div, p, li, span, strong, h2, h3, h4",
            /\b(bought|wishlisted|supported|recommended|listening|played)\b/i,
        );
        }

        if (memo) {
            memo.activityHeadlineNode = result || null;
        }
        return result || null;
    }

    function updateMergedTrackPurchaseNotice(card) {
        const mergeState = ensureMergedTrackState(card);
        const primaryTitle = cleanText(
            mergeState.primaryTitle || "",
        ).toLowerCase();
        const mergedTrackTitles = mergeState.titles.filter((title) => {
            const normalizedTitle = cleanText(title).toLowerCase();
            return normalizedTitle && normalizedTitle !== primaryTitle;
        });
        if (!mergedTrackTitles.length) {
            const existing = card.querySelector(".bcampx__merge-note");
            if (existing) {
                existing.remove();
            }
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

            const track = document.createElement("button");
            track.type = "button";
            track.className = "bcampx__merge-track-button";
            track.dataset.trackTitle = title;
            track.textContent = `"${title}"`;
            track.addEventListener("click", () => {
                playMergedTrackTitle(card, title, track);
            });
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
        const controller = getCardController(card);
        if (controller && controller.loaded && controller.data) {
            const shell = card.querySelector(".bcampx");
            const meta = shell ? shell.querySelector(".bcampx__meta") : null;
            const text = shell
                ? shell.querySelector(".bcampx__summary-text")
                : null;
            const toggle = shell
                ? shell.querySelector(".bcampx__toggle")
                : null;
            if (shell && meta && text && toggle) {
                renderReleaseData(
                    shell,
                    meta,
                    text,
                    toggle,
                    controller.data,
                    controller.releaseUrl || "",
                );
            }
        }
    }

    function normalizeReleaseUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.protocol !== "https:") {
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

    function looksLikeFeedCard(node) {
        if (!(node instanceof Element)) {
            return false;
        }

        const memo = getNodeMemo(node);
        if (
            memo &&
            Object.prototype.hasOwnProperty.call(memo, "looksLikeFeedCard")
        ) {
            return memo.looksLikeFeedCard;
        }

        const result = computeLooksLikeFeedCard(node);
        if (memo) {
            memo.looksLikeFeedCard = result;
        }
        return result;
    }

    function computeLooksLikeFeedCard(node) {
        if (isAlsoBoughtRecommendationCard(node)) {
            return false;
        }

        if (!isLikelyFanActivityCard(node)) {
            return false;
        }

        if (!hasFanActivitySignals(node)) {
            return false;
        }

        const releaseLinkCount = node.querySelectorAll(
            RELEASE_LINK_SELECTOR,
        ).length;
        if (releaseLinkCount < 1 || releaseLinkCount > 12) {
            return false;
        }

        const rect = node.getBoundingClientRect();
        const hasUsefulSize = rect.width >= 120 && rect.height >= 45;
        const hasCoverOrText =
            Boolean(node.querySelector("img")) ||
            normalizedText(node).length > 20;
        return hasUsefulSize && hasCoverOrText;
    }

    function hasFanActivitySignals(node) {
        if (
            node.querySelector(
                ".story-title .fan-name, .story-title .artist-name",
            )
        ) {
            return true;
        }

        if (
            node.querySelector(".story-title") &&
            FAN_ACTIVITY_TEXT_PATTERN.test(
                normalizedText(node.querySelector(".story-title")),
            )
        ) {
            return true;
        }

        const text = normalizedText(node);
        if (FAN_ACTIVITY_TEXT_PATTERN.test(text)) {
            return true;
        }

        const profileLinks = Array.from(
            node.querySelectorAll("a[href]"),
        ).filter(isLikelyProfileLink);
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

            if (
                /\/(album|track|tagged|discover|feed|fans|terms_of_use|about|help|search|gift_cards)(\/|$)/.test(
                    pathname,
                )
            ) {
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

        if (
            node.closest(EXCLUDED_SECTION_SELECTOR) ||
            hasSidebarLikeAncestor(node)
        ) {
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
        const story = getStoryRoot(node);

        if (!(story instanceof Element)) {
            return false;
        }

        if (
            story.matches("li.story") &&
            story.hasAttribute("data-story-fan-id")
        ) {
            return true;
        }

        if (
            story.querySelector(".story-title") &&
            story.querySelector(".story-innards")
        ) {
            return true;
        }

        if (
            story.querySelector(".story-title") &&
            story.querySelector(".tralbum-wrapper")
        ) {
            return true;
        }

        return false;
    }

    function hasSidebarLikeAncestor(node) {
        let current = node;

        for (
            let depth = 0;
            current && current !== document.body && depth < 8;
            depth += 1
        ) {
            const idAndClass =
                `${current.id || ""} ${typeof current.className === "string" ? current.className : ""}`.toLowerCase();
            if (
                /(sidebar|side-bar|side_module|right[-_ ]?col|right[-_ ]?column|recommend|discover|new[-_ ]?release)/.test(
                    idAndClass,
                )
            ) {
                return true;
            }

            current = current.parentElement;
        }

        return false;
    }

    function enhanceCard(card, releaseUrl, releaseRequestContext = null) {
        incrementDebugCounter("data-bcampx-enhance-attempt-count");
        const fullDiscography = isFullDiscographyCard(card);
        const alsoBought = isAlsoBoughtRecommendationCard(card);
        if (fullDiscography || alsoBought) {
            markDebugState("data-bcampx-last-skip", "enhance-guard");
            markStoryCardSkipped(card, {
                reason: fullDiscography ? "full-discography" : "also-bought",
            });
            return;
        }

        card.setAttribute(ENHANCED_ATTR, "true");
        card.removeAttribute(SKIP_REASON_ATTR);
        card.removeAttribute(RETRYABLE_SKIP_ATTR);

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
            releaseRequestContext:
                releaseRequestContext ||
                getCardReleaseRequestContext(card, releaseUrl),
            fetchAndRender: (options = {}) =>
                fetchAndRender(
                    controller,
                    releaseUrl,
                    shell,
                    meta,
                    text,
                    toggle,
                    options,
                ),
            toggle: () => toggleDetails(controller, shell, toggle),
        };

        setCardController(card, controller);
        incrementDebugCounter("data-bcampx-enhanced-count");

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
        if (
            supportedBySlot &&
            supportedBySlot.container &&
            supportedBySlot.container.parentNode
        ) {
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
        const tagLine = findCachedElementByText(
            card,
            "tagLine",
            "div, p, li, section",
            /^tags\s*:/i,
        );
        if (tagLine) {
            return tagLine;
        }

        const actionLink = Array.from(card.querySelectorAll("a")).find(
            (link) => {
                return /\b(buy now|wishlist|hear more|buy track|pre-order|stream)\b/i.test(
                    normalizedText(link),
                );
            },
        );

        if (actionLink) {
            return findUsefulActionRow(actionLink, card) || actionLink;
        }

        const featuredTrackLine = findCachedElementByText(
            card,
            "featuredTrackAnchor",
            "div, p, li, section",
            /^featured track\s*:/i,
        );
        if (featuredTrackLine) {
            return featuredTrackLine;
        }

        return null;
    }

    function findSupportedBySlot(card) {
        const explicitSlot = findCachedSelector(
            card,
            "supportedSlotExplicit",
            SUPPORTED_SLOT_SELECTOR,
        );
        if (explicitSlot) {
            return {
                container: explicitSlot,
                hiddenNodes: Array.from(explicitSlot.children),
            };
        }

        const label = findCachedElementByText(
            card,
            "supportedByLabel",
            "div, span, p, strong, h2, h3, h4",
            /supported by/i,
        );
        if (!label) {
            return null;
        }

        const cardRect = card.getBoundingClientRect();
        const container =
            nearestAncestorWithin(label, card, (node) =>
                isSupportedSlotCandidate(node, cardRect),
            ) || label.parentElement;
        if (
            !container ||
            container === card ||
            !isSupportedSlotCandidate(container, cardRect)
        ) {
            return null;
        }

        return {
            container,
            hiddenNodes: collectSupportedSlotHiddenNodes(container, label),
        };
    }

    function findContentColumn(card) {
        const memo = getNodeMemo(card);
        if (memo && Object.prototype.hasOwnProperty.call(memo, "contentColumnNode")) {
            return memo.contentColumnNode || card;
        }

        const explicitColumn = findCachedSelector(
            card,
            "contentColumnExplicit",
            CONTENT_COLUMN_SELECTOR,
        );
        if (explicitColumn) {
            if (memo) {
                memo.contentColumnNode = explicitColumn;
            }
            return explicitColumn;
        }

        const releaseLink = card.querySelector(RELEASE_LINK_SELECTOR);
        if (releaseLink) {
            const block = nearestAncestorWithin(releaseLink, card, (node) => {
                const rect = node.getBoundingClientRect();
                return (
                    rect.width > 0 &&
                    rect.width < card.getBoundingClientRect().width * 0.82
                );
            });

            if (block && block !== card) {
                if (memo) {
                    memo.contentColumnNode = block;
                }
                return block;
            }
        }

        if (memo) {
            memo.contentColumnNode = card;
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
        const leftRatio =
            cardRect.width > 0
                ? (rect.left - cardRect.left) / cardRect.width
                : 0;
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
            if (
                childAvatars >= 1 ||
                /^more\.\.\.$/i.test(childText) ||
                /supported by/i.test(childText)
            ) {
                hiddenNodes.push(child);
            }
        });

        return Array.from(new Set(hiddenNodes));
    }

    function findUsefulActionRow(node, stopAt) {
        return nearestAncestorWithin(node, stopAt, (current) => {
            const text = normalizedText(current);
            const linkCount = current.querySelectorAll("a").length;
            return (
                linkCount >= 2 &&
                /\b(buy now|wishlist|hear more|buy track|pre-order|stream)\b/i.test(
                    text,
                )
            );
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
        return Array.from(root.querySelectorAll(selector)).find((node) =>
            pattern.test(normalizedText(node)),
        );
    }

    function getMatchingRootOrDescendants(root, selector) {
        if (!root || typeof selector !== "string") {
            return [];
        }

        const matches = [];
        if (root instanceof Element && root.matches(selector)) {
            matches.push(root);
        }

        if (root.querySelectorAll) {
            matches.push(...Array.from(root.querySelectorAll(selector)));
        }

        return matches;
    }

    function getNodeMemo(node) {
        if (!(node instanceof Element)) {
            return null;
        }

        if (
            !node.__bcampxMemo ||
            node.__bcampxMemo.__version !== STATE.memoVersion
        ) {
            node.__bcampxMemo = Object.create(null);
            node.__bcampxMemo.__version = STATE.memoVersion;
        }

        return node.__bcampxMemo;
    }

    function findCachedElementByText(root, key, selector, pattern) {
        if (!(root instanceof Element) || !key) {
            return null;
        }

        const memo = getNodeMemo(root);
        if (memo && Object.prototype.hasOwnProperty.call(memo, key)) {
            return memo[key];
        }

        const result = findElementByText(root, selector, pattern) || null;
        if (memo) {
            memo[key] = result;
        }
        return result;
    }

    function findCachedSelector(root, key, selector) {
        if (!(root instanceof Element) || !key || !selector) {
            return null;
        }

        const memo = getNodeMemo(root);
        if (memo && Object.prototype.hasOwnProperty.call(memo, key)) {
            return memo[key];
        }

        const result = root.querySelector(selector) || null;
        if (memo) {
            memo[key] = result;
        }
        return result;
    }

    async function fetchAndRender(
        controller,
        releaseUrl,
        shell,
        meta,
        text,
        toggle,
        options,
    ) {
        controller.loading = true;
        shell.classList.add("bcampx--loading");
        text.textContent = "Loading extra context...";
        toggle.disabled = true;

        try {
            const result = await getReleaseData(
                controller.releaseRequestContext || releaseUrl,
            );
            const normalizedData = normalizeReleaseData(result.data);
            controller.loaded = true;
            controller.data = normalizedData;

            renderReleaseData(
                shell,
                meta,
                text,
                toggle,
                normalizedData,
                releaseUrl,
            );

            const shouldExpand =
                (!options.auto || CONFIG.expandAfterAutoFetch) &&
                hasExpandableContent(normalizedData);
            controller.expanded = shouldExpand;
            shell.classList.toggle("bcampx--expanded", shouldExpand);
            updateToggle(toggle, shouldExpand);
            text.textContent = buildLoadedSummaryText(normalizedData, result);
        } catch (error) {
            if (shouldAbandonReleaseEnhancement(error)) {
                controller.loaded = true;
                controller.data = createEmptyReleaseData();
                renderEmpty(meta, text, releaseUrl, {
                    message: "Extra metadata is unavailable for this release.",
                    summary: "No extra context available",
                });
            } else {
                controller.loaded = false;
                controller.data = null;
                renderError(controller, meta, text, releaseUrl, error);
            }
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
        if (!toggle) {
            return;
        }
        toggle.textContent = expanded ? "Less" : "More";
    }

        async function getReleaseData(releaseInput) {
        const requestContext = normalizeReleaseRequestContext(releaseInput);
        const cacheKey = getReleaseCacheKey(requestContext.releaseUrl);
        const cached = await storageGet(cacheKey, null);
        const normalizedCached =
            cached && typeof cached === "object"
                ? normalizeReleaseData(cached)
                : null;

        if (isFreshReleaseCache(cached)) {
            if (!shouldRefreshCachedRelease(cached, normalizedCached)) {
                return { data: normalizedCached, fromCache: true, stale: false };
            }
        }

        const pending = STATE.pendingReleaseRequests.get(cacheKey);
        if (pending) {
            return pending;
        }

        const request = enqueueReleaseFetch(async () => {
            try {
                const resolvedRequest = await resolveReleaseRequestContext(
                    requestContext,
                );
                const html =
                    typeof resolvedRequest.html === "string"
                        ? resolvedRequest.html
                        : await requestHtml(resolvedRequest.fetchUrl);
                const data = normalizeReleaseData(
                    parseReleasePage(html, resolvedRequest.releaseUrl),
                );
                const cacheValue = buildReleaseCacheValue(data);

                await storageSet(cacheKey, cacheValue);
                return { data: cacheValue, fromCache: false, stale: false };
            } catch (error) {
                if (hasVisibleEnhancements(normalizedCached)) {
                    return {
                        data: normalizedCached,
                        fromCache: true,
                        stale: true,
                        fallbackError: error,
                    };
                }
                throw error;
            }
        });

        STATE.pendingReleaseRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            if (STATE.pendingReleaseRequests.get(cacheKey) === request) {
                STATE.pendingReleaseRequests.delete(cacheKey);
            }
        }
    }

    function enqueueReleaseFetch(task) {
        return new Promise((resolve, reject) => {
            STATE.releaseFetchQueue.push({ task, resolve, reject });
            drainReleaseFetchQueue();
        });
    }

    function drainReleaseFetchQueue() {
        while (
            STATE.activeReleaseFetchCount < CONFIG.maxConcurrentFetches &&
            STATE.releaseFetchQueue.length
        ) {
            const next = STATE.releaseFetchQueue.shift();
            if (!next || typeof next.task !== "function") {
                continue;
            }

            STATE.activeReleaseFetchCount += 1;
            Promise.resolve()
                .then(() => next.task())
                .then(next.resolve, next.reject)
                .finally(() => {
                    STATE.activeReleaseFetchCount = Math.max(
                        0,
                        STATE.activeReleaseFetchCount - 1,
                    );
                    drainReleaseFetchQueue();
                });
        }
    }

    function getReleaseCacheKey(releaseUrl) {
        return `${RELEASE_CACHE_PREFIX}${releaseUrl}`;
    }

    function normalizeReleaseRequestContext(releaseInput) {
        if (releaseInput && typeof releaseInput === "object") {
            return {
                releaseUrl: normalizeReleaseUrl(releaseInput.releaseUrl || ""),
                itemId: firstPositiveNumber(releaseInput.itemId),
                itemType: normalizeReleaseItemType(
                    releaseInput.itemType,
                    releaseInput.releaseUrl || "",
                ),
            };
        }

        return {
            releaseUrl: normalizeReleaseUrl(releaseInput || ""),
            itemId: 0,
            itemType: normalizeReleaseItemType("", releaseInput || ""),
        };
    }

    async function resolveReleaseRequestContext(requestContext) {
        const normalizedContext = normalizeReleaseRequestContext(requestContext);
        if (isBandcampReleaseUrl(normalizedContext.releaseUrl)) {
            return {
                releaseUrl: normalizedContext.releaseUrl,
                fetchUrl: normalizedContext.releaseUrl,
            };
        }

        let directFetchError = null;
        try {
            const directFetchResult =
                await tryResolveCustomDomainReleaseRequestContext(
                    normalizedContext,
                );
            if (directFetchResult) {
                return directFetchResult;
            }
        } catch (error) {
            directFetchError = error;
        }

        if (isMissingCustomDomainHostPermissionError(directFetchError)) {
            throw directFetchError;
        }

        if (directFetchError) {
            throw directFetchError;
        }

        throw new Error("Custom-domain Bandcamp release could not be resolved.");
    }

    async function tryResolveCustomDomainReleaseRequestContext(requestContext) {
        const releaseUrl = normalizeReleaseUrl(
            requestContext && requestContext.releaseUrl,
        );
        if (!releaseUrl || isBandcampReleaseUrl(releaseUrl)) {
            return null;
        }

        const html = await requestHtml(releaseUrl);
        return {
            releaseUrl: extractReleaseCanonicalUrl(html, releaseUrl),
            fetchUrl: releaseUrl,
            html,
        };
    }

    function isBandcampReleaseUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, window.location.href);
            return Boolean(
                url.protocol === "https:" &&
                    (url.hostname === "bandcamp.com" ||
                        url.hostname.endsWith(".bandcamp.com")) &&
                    /(^|\/)(album|track)\//.test(url.pathname),
            );
        } catch (_error) {
            return false;
        }
    }

    function extractReleaseCanonicalUrl(html, fallbackUrl = "") {
        const doc = htmlToDocument(html);
        const candidates = [
            attrContent(doc, 'link[rel="canonical"]', "href"),
            metaContent(doc, 'meta[property="og:url"]'),
            metaContent(doc, 'meta[name="twitter:url"]'),
        ];

        for (const candidate of candidates) {
            const normalized = normalizeReleaseUrl(candidate);
            if (normalized) {
                return normalized;
            }
        }

        return normalizeReleaseUrl(fallbackUrl);
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
            Date.now() - value.fetchedAt < CONFIG.cacheTtlMs,
        );
    }

    function shouldRefreshCachedRelease(rawData, normalizedData) {
        return (
            needsTrackRefresh(normalizedData) ||
            needsSchemaRefresh(rawData, normalizedData)
        );
    }

    function requestHtml(url) {
        if (canUseExternalHostMethod("requestHtml")) {
            return Promise.resolve(
                getExternalHostApi().requestHtml(
                    url,
                    getHostRequestOptions({
                        credentials: "include",
                        headers: {
                            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        },
                    }),
                ),
            );
        }

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
                ontimeout: () =>
                    reject(new Error("Network request timed out.")),
            });
        });
    }

    function requestWishlistStateHtml(url) {
        if (canUseExternalHostMethod("requestHtml")) {
            return Promise.resolve(
                getExternalHostApi().requestHtml(
                    url,
                    getHostRequestOptions({
                        credentials: "include",
                        headers: {
                            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        },
                    }),
                ),
            );
        }

    return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== "function") {
            reject(new Error("GM_xmlhttpRequest is not available."));
            return;
        }

        GM_xmlhttpRequest({
            method: "GET",
            url,
            timeout: CONFIG.fetchTimeoutMs,
            withCredentials: true,
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
            ontimeout: () =>
                reject(new Error("Network request timed out.")),
        });
    });
    }

    function requestJson(url, options = {}) {
        if (canUseExternalHostMethod("requestJson")) {
            return Promise.resolve(
                getExternalHostApi().requestJson(
                    url,
                    getHostRequestOptions(options),
                ),
            );
        }

        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error("GM_xmlhttpRequest is not available."));
                return;
            }

            GM_xmlhttpRequest({
                method: options.method || "GET",
                url,
                data: options.data,
                timeout: CONFIG.fetchTimeoutMs,
                headers: options.headers || {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(response.responseText || "null"));
                    } catch (_error) {
                        reject(new Error("Invalid JSON response."));
                    }
                },
                onerror: () => reject(new Error("Network request failed.")),
                ontimeout: () =>
                    reject(new Error("Network request timed out.")),
            });
        });
    }

    function htmlToDocument(html) {
        return new DOMParser().parseFromString(html || "", "text/html");
    }

    function parseJsonAttribute(node, attr) {
        if (!node || !attr) {
            return null;
        }

        try {
            return JSON.parse(node.getAttribute(attr) || "null");
        } catch (_error) {
            return null;
        }
    }

    function parseReleasePage(html, releaseUrl) {
        const documentFromHtml = htmlToDocument(html);
        const tralbum = parseTralbumData(documentFromHtml);
        const jsonLd = shouldParseJsonLdFallback(tralbum)
            ? parseJsonLd(documentFromHtml)
            : null;
        const tracks = extractReleaseTracks(documentFromHtml, tralbum, jsonLd);
        const descriptionState = extractReleaseDescriptionState(
            documentFromHtml,
            tralbum,
            tracks,
        );

        return {
            url: releaseUrl,
            title: resolveReleaseTitle(documentFromHtml, tralbum, jsonLd),
            artist: resolveReleaseArtist(documentFromHtml, tralbum, jsonLd),
            releaseDate: resolveReleaseDate(documentFromHtml, tralbum, jsonLd),
            location: resolveReleaseLocation(documentFromHtml),
            artUrl: metaContent(documentFromHtml, 'meta[property="og:image"]'),
            digitalPrice: extractDigitalPrice(documentFromHtml),
            digitalOwnershipUrl: extractDigitalOwnershipUrl(documentFromHtml),
            hasBodyDescriptionSource: descriptionState.hasBodyDescriptionSource,
            description: descriptionState.description,
            descriptionHtml: descriptionState.descriptionHtml,
            tags: extractReleaseTags(documentFromHtml),
            tracks,
        };
    }

    function shouldParseJsonLdFallback(tralbum) {
        const hasTitle = Boolean(
            cleanText(
                firstString(
                    tralbum && tralbum.current && tralbum.current.title,
                    tralbum && tralbum.album_title,
                ),
            ),
        );
        const hasArtist = Boolean(cleanText(tralbum && tralbum.artist));
        const hasReleaseDate = Boolean(
            cleanText(
                firstString(
                    tralbum && tralbum.album_release_date,
                    tralbum &&
                        tralbum.current &&
                        tralbum.current.release_date,
                ),
            ),
        );
        const hasTracks = Boolean(
            tralbum &&
                Array.isArray(tralbum.trackinfo) &&
                tralbum.trackinfo.length,
        );

        return !(hasTitle && hasArtist && hasReleaseDate && hasTracks);
    }

    function normalizeReleaseData(data) {
        if (!data || typeof data !== "object") {
            return createEmptyReleaseData();
        }

        const tracks = normalizeTracks(data.tracks);
        const hasBodyDescriptionSource =
            data.hasBodyDescriptionSource !== false;
        const descriptionState = normalizeDescriptionState({
            descriptionText: data.description || "",
            descriptionHtml: data.descriptionHtml || "",
            tracks,
            hasBodyDescriptionSource,
        });

        return {
            ...createEmptyReleaseData(),
            ...data,
            hasBodyDescriptionSource,
            description: descriptionState.description,
            descriptionHtml: descriptionState.descriptionHtml,
            digitalPrice: cleanText(data.digitalPrice || ""),
            digitalOwnershipUrl: cleanText(data.digitalOwnershipUrl || ""),
            tags: Array.isArray(data.tags)
                ? data.tags.map((tag) => cleanText(tag)).filter(Boolean)
                : [],
            tracks,
        };
    }

    function createEmptyReleaseData() {
        return {
            url: "",
            title: "",
            artist: "",
            releaseDate: "",
            location: "",
            digitalPrice: "",
            digitalOwnershipUrl: "",
            description: "",
            descriptionHtml: "",
            tags: [],
            tracks: [],
        };
    }

    function resolveReleaseTitle(doc, tralbum, jsonLd) {
        return (
            firstString(tralbum && tralbum.current && tralbum.current.title) ||
            firstString(tralbum && tralbum.album_title) ||
            firstString(jsonLd && jsonLd.name) ||
            metaContent(doc, 'meta[property="og:title"]') ||
            textContent(doc, ".trackTitle") ||
            textContent(doc, "h1") ||
            cleanTitle(doc.title)
        );
    }

    function resolveReleaseArtist(doc, tralbum, jsonLd) {
        return (
            firstString(tralbum && tralbum.artist) ||
            extractJsonArtist(jsonLd) ||
            textContent(doc, "#name-section .artist") ||
            textContent(doc, "#band-name-location .title") ||
            metaContent(doc, 'meta[property="og:site_name"]') ||
            ""
        );
    }

    function extractReleaseTracks(doc, tralbum, jsonLd) {
        const tralbumTracks = uniqueTracks(extractTralbumTracks(tralbum));
        if (tralbumTracks.length) {
            return tralbumTracks.slice(0, CONFIG.maxTracks);
        }

        const jsonTracks = extractJsonTracks(jsonLd);
        const domTracks = extractDomTracks(doc);

        return uniqueTracks([...jsonTracks, ...domTracks]).slice(
            0,
            CONFIG.maxTracks,
        );
    }

    function extractReleaseDescriptionState(doc, tralbum, tracks) {
        const tralbumAbout = cleanText(
            firstString(tralbum && tralbum.current && tralbum.current.about),
        );
        const tralbumAboutText = textContent(doc, ".tralbum-about");
        const albumAboutText = textContent(doc, ".album-about");
        const itempropDescriptionText = textContent(
            doc,
            "[itemprop='description']:not(meta)",
        );
        const rawDescriptionHtml = extractDescriptionHtml(doc);
        const descriptionText =
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
            rawDescriptionHtml,
        );
        const descriptionState = normalizeDescriptionState({
            descriptionText,
            descriptionHtml: rawDescriptionHtml,
            tracks,
            hasBodyDescriptionSource,
        });

        return {
            hasBodyDescriptionSource,
            description: descriptionState.description,
            descriptionHtml: descriptionState.descriptionHtml,
        };
    }

    function extractReleaseTags(doc) {
        return uniqueStrings([
            ...queryTexts(doc, ".tralbum-tags a"),
            ...queryTexts(doc, "a.tag"),
            ...queryTexts(doc, 'a[href*="/tag/"]'),
        ]).filter((tag) => !/^tags?$/i.test(tag));
    }

    function resolveReleaseDate(doc, tralbum, jsonLd) {
        return (
            firstString(tralbum && tralbum.album_release_date) ||
            firstString(
                tralbum && tralbum.current && tralbum.current.release_date,
            ) ||
            firstString(jsonLd && jsonLd.datePublished) ||
            attrContent(doc, "time[datetime]", "datetime") ||
            metaContent(doc, 'meta[itemprop="datePublished"]') ||
            findReleasedDate(doc)
        );
    }

    function resolveReleaseLocation(doc) {
        return (
            textContent(doc, "#band-name-location .location") ||
            textContent(doc, ".location") ||
            ""
        );
    }

    function extractDigitalPrice(doc) {
        return extractDigitalPriceFromBuyItem(doc) || "";
    }

    function extractDigitalOwnershipUrl(doc) {
        const directLink = doc.querySelector("a.you-own-this-link[href]");
        if (directLink && isBandcampFanProfileUrl(directLink.href)) {
            return directLink.href;
        }

        const ownedBlock = doc.querySelector(
            ".you-own-this.digital, .you-own-this",
        );
        if (!ownedBlock) {
            return "";
        }

        const link = Array.from(ownedBlock.querySelectorAll("a[href]")).find(
            (candidate) => isBandcampFanProfileUrl(candidate.href),
        );
        return link ? link.href : "";
    }

    function extractDigitalPriceFromBuyItem(doc) {
        const buyItem = doc.querySelector(
            ".buyItem.digital, .you-own-this.digital, a.you-own-this-link",
        );
        if (!buyItem) {
            return "";
        }

        const explicitLabel = extractExplicitDigitalPriceLabel(
            normalizedText(buyItem),
        );
        if (explicitLabel) {
            return explicitLabel;
        }

        const basePrice = cleanText(
            buyItem.querySelector(".base-text-color")?.textContent || "",
        );
        if (!basePrice) {
            return "";
        }

        const extras = Array.from(buyItem.querySelectorAll(".buyItemExtra"))
            .map((node) => cleanText(node.textContent || ""))
            .filter(Boolean);
        return normalizeDigitalPriceText([basePrice, ...extras].join(" "));
    }

    function extractExplicitDigitalPriceLabel(value) {
        const text = cleanText(value || "");
        if (/you own this/i.test(text)) {
            return "you own this";
        }
        if (/free download/i.test(text)) {
            return "free download";
        }
        if (/name your price/i.test(text)) {
            return "name your price";
        }

        return "";
    }

    function normalizeDigitalPriceText(value) {
        const explicitLabel = extractExplicitDigitalPriceLabel(value);
        if (explicitLabel) {
            return explicitLabel;
        }

        const text = cleanText(value || "")
            .replace(/\b(?:Buy|Pre-order) Digital (?:Album|Track)\b/gi, "")
            .replace(/\bDigital (?:Album|Track)\b/gi, "")
            .replace(/\bStreaming \+ Download\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!text || /^free download$/i.test(text)) {
            return text;
        }

        return text;
    }

    function normalizeDescriptionState({
        descriptionText,
        descriptionHtml,
        tracks,
        hasBodyDescriptionSource,
    }) {
        const cleanDescription = cleanText(descriptionText || "");
        const truncatedDescription = truncate(
            cleanDescription,
            CONFIG.maxDescriptionLength,
        );
        const normalizedHtml =
            sanitizeDescriptionHtml(descriptionHtml || "") ||
            plainTextToDescriptionHtml(
                truncatedDescription,
                CONFIG.maxDescriptionLength,
            );
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

                return createTrackData(
                    track.title,
                    track.trackId || track.track_id || "",
                    track.streamUrl || "",
                    track.duration || "",
                    track.titleLink || track.title_link || "",
                );
            })
            .filter(Boolean);
    }

    function needsTrackRefresh(data) {
        if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
            return false;
        }

        return (
            data.tracks.some((track) => track && track.title) &&
            !data.tracks.some((track) => track && track.streamUrl)
        );
    }

    function needsSchemaRefresh(rawData, normalizedData) {
        if (!rawData || rawData.schemaVersion !== CACHE_SCHEMA_VERSION) {
            return true;
        }

        if (
            (normalizedData.description && !normalizedData.descriptionHtml) ||
            (normalizedData.descriptionHtml &&
                !/<(?:p|br|a)\b/i.test(normalizedData.descriptionHtml) &&
                /\n|https?:\/\//i.test(normalizedData.description))
        ) {
            return true;
        }

        if (isLikelyTracklistDescription(normalizedData)) {
            return true;
        }

        return false;
    }

    function parseJsonLd(doc) {
        const documents = readJsonLdDocuments(doc);
        for (const item of documents) {
            const release = findJsonLdReleaseCandidate(item);
            if (release) {
                return release;
            }
        }

        return null;
    }

    function readJsonLdDocuments(doc) {
        return Array.from(
            doc.querySelectorAll('script[type="application/ld+json"]'),
        )
            .map((script) => {
                try {
                    return JSON.parse(script.textContent.trim());
                } catch (_error) {
                    return null;
                }
            })
            .filter(Boolean);
    }

    function findJsonLdReleaseCandidate(documentValue) {
        const candidates = Array.isArray(documentValue)
            ? documentValue
            : [documentValue];

        return (
            candidates.find((item) => {
                const type = Array.isArray(item["@type"])
                    ? item["@type"]
                    : [item["@type"]];
                return type.some((value) =>
                    /MusicAlbum|MusicRecording|Album|Track/i.test(
                        String(value),
                    ),
                );
            }) || null
        );
    }

    function parseTralbumData(doc) {
        const dataAttrResult = parseTralbumDataAttribute(doc);
        if (dataAttrResult) {
            return dataAttrResult;
        }

        return parseLegacyTralbumScriptFallback(doc);
    }

    function parseTralbumDataAttribute(doc) {
        const dataNode = doc.querySelector("[data-tralbum]");
        if (!dataNode) {
            return null;
        }

        try {
            return JSON.parse(dataNode.getAttribute("data-tralbum"));
        } catch (_error) {
            return null;
        }
    }

    function parseLegacyTralbumScriptFallback(doc) {
        const scripts = Array.from(doc.scripts);
        const tralbumScript = scripts.find((script) =>
            /TralbumData|trackinfo/.test(script.textContent),
        );
        if (!tralbumScript) {
            return null;
        }

        const text = tralbumScript.textContent;
        const titleMatch = text.match(/(?:album_title|title):\s*"([^"]+)"/);
        const artistMatch = text.match(/artist:\s*"([^"]+)"/);
        const dateMatch = text.match(/album_release_date:\s*"([^"]+)"/);
        const trackMatches = Array.from(
            text.matchAll(/"title"\s*:\s*"([^"]+)"/g),
        );

        return {
            album_title: titleMatch ? decodeJsString(titleMatch[1]) : "",
            artist: artistMatch ? decodeJsString(artistMatch[1]) : "",
            album_release_date: dateMatch ? decodeJsString(dateMatch[1]) : "",
            trackinfo: trackMatches.map((match) => ({
                title: decodeJsString(match[1]),
            })),
        };
    }

    function extractJsonArtist(jsonLd) {
        return getJsonLdEntityNames(jsonLd && jsonLd.byArtist);
    }

    function extractJsonTracks(jsonLd) {
        return getJsonLdArrayValue(jsonLd && jsonLd.track)
            .map((track) => {
                if (typeof track === "string") {
                    return createTrackData(track, "", "", "");
                }

                return createTrackData(
                    track && track.name,
                    "",
                    "",
                    track && track.duration ? track.duration : "",
                );
            })
            .filter(Boolean);
    }

    function getJsonLdEntityNames(value) {
        if (!value) {
            return "";
        }

        if (typeof value === "string") {
            return cleanText(value);
        }

        return getJsonLdArrayValue(value)
            .map((item) => cleanText(item && item.name))
            .filter(Boolean)
            .join(", ");
    }

    function getJsonLdArrayValue(value) {
        if (!value) {
            return [];
        }

        return Array.isArray(value) ? value : [value];
    }

    function extractDomTracks(doc) {
        const trackTitles = queryTexts(doc, "#track_table .track-title");
        const fallbackTitles = trackTitles.length
            ? trackTitles
            : queryTexts(doc, ".track-title");

        return fallbackTitles.map((title) =>
            createTrackData(title, "", "", ""),
        );
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
                    track && track.file && track.file["mp3-128"]
                        ? track.file["mp3-128"]
                        : "",
                    track && typeof track.duration !== "undefined"
                        ? track.duration
                        : "",
                    track && track.title_link ? track.title_link : "",
                ),
            )
            .filter(Boolean);
    }

    function createTrackData(title, trackId, streamUrl, duration, titleLink) {
        const cleanTitleValue = cleanText(title);
        if (!cleanTitleValue) {
            return null;
        }

        return {
            title: cleanTitleValue,
            trackId: cleanText(trackId),
            streamUrl: cleanText(streamUrl),
            duration: normalizeTrackDuration(duration),
            titleLink: cleanText(titleLink),
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
        const seenExact = new Set();
        const seenRichTitles = new Set();
        const seenPlainTitles = new Set();
        const result = [];

        values.forEach((track) => {
            if (!track || !track.title) {
                return;
            }

            const exactKey = getTrackUniquenessKey(track);
            const titleKey = `title:${track.title.toLowerCase()}`;
            const hasRichIdentity = !exactKey.startsWith("title:");

            if (hasRichIdentity) {
                if (seenExact.has(exactKey)) {
                    return;
                }
                seenExact.add(exactKey);
                seenRichTitles.add(titleKey);
                result.push(track);
                return;
            }

            if (seenRichTitles.has(titleKey) || seenPlainTitles.has(titleKey)) {
                return;
            }

            seenPlainTitles.add(titleKey);
            result.push(track);
        });

        return result;
    }

    function getTrackUniquenessKey(track) {
        const trackId = cleanText(track && track.trackId);
        if (trackId) {
            return `id:${trackId}`;
        }

        const titleLink = cleanText(track && track.titleLink);
        if (titleLink) {
            return `link:${titleLink.toLowerCase()}`;
        }

        const streamUrl = cleanText(track && track.streamUrl);
        if (streamUrl) {
            return `stream:${streamUrl.toLowerCase()}`;
        }

        return `title:${track.title.toLowerCase()}`;
    }

    function findReleasedDate(doc) {
        const candidates = queryTexts(
            doc,
            ".tralbumData, .tralbum-credits, .credits, #trackInfo",
        );
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
            updateArtistMusicCardBuyAction(
                shell.closest(".bcampx-label-feed-card"),
                data,
            );
            renderSupportedSlot(meta, text, toggle, data, releaseUrl);
            shell.classList.toggle("bcampx--expanded", false);
            updateFeedCardBuyButton(shell, data, releaseUrl);
            return;
        }

        renderStandardReleaseContent(meta, data, releaseUrl);
        updateFeedCardBuyButton(shell, data, releaseUrl);

        if (!hasVisibleEnhancements(data)) {
            applyEmptyReleaseState(shell, meta, text, toggle, releaseUrl);
            return;
        }

        applyStandardReleaseShellState(shell, text, toggle, data);
    }

    function updateFeedCardBuyButton(shell, data, releaseUrl) {
        if (!data || !releaseUrl) {
            return;
        }

        const card = shell.closest(FEED_CARD_ROOT_SELECTOR);
        if (!card) {
            return;
        }

        const buyLinks = Array.from(
            card.querySelectorAll(RELEASE_LINK_SELECTOR),
        );
        const buyLink = buyLinks.find((link) => {
            const text = cleanText(link.textContent || "").toLowerCase();
            return /buy now|pre.order|hear more|free download/i.test(text);
        });
        if (!buyLink) {
            return;
        }

        const nativeText = cleanText(buyLink.textContent || "").toLowerCase();
        if (/^you own this$|^free download$/i.test(nativeText)) {
            return;
        }

        const actionText = getDigitalBuyActionLabel(data.digitalPrice);
        buyLink.textContent = actionText;

        buyLink.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            const text = cleanText(buyLink.textContent || "");
            if (
                /^hear more$/i.test(text) ||
                /you own this/i.test(text) ||
                /free download/i.test(text)
            ) {
                window.open(releaseUrl, "_blank", "noopener,noreferrer");
                return;
            }

            openTrackBuyWindow(releaseUrl);
        });
    }

    function renderStandardReleaseContent(meta, data, releaseUrl) {
        appendReleaseFacts(meta, data);
        appendReleaseDescription(meta, data);
        appendReleaseTrackList(meta, data);
        appendOpenReleaseLink(meta, releaseUrl);
    }

    function appendReleaseFacts(meta, data) {
        const facts = compactJoin(
            [formatReleaseDate(data.releaseDate), data.location],
            " · ",
        );
        if (!facts) {
            return;
        }

        const factsLine = createClassedElement("div", "bcampx__facts");
        factsLine.textContent = facts;
        meta.append(factsLine);
    }

    function appendReleaseDescription(meta, data) {
        const description = createDescriptionElement(
            data,
            "bcampx__description",
            "div",
        );
        if (!description) {
            return;
        }

        meta.append(description);
    }

    function appendReleaseTrackList(meta, data) {
        if (!data.tracks || !data.tracks.length) {
            return;
        }

        const tracks = createTrackListElement(
            data.tracks,
            "bcampx__tracks",
            (track) => {
            const item = document.createElement("li");
            item.textContent = track.title;
                return item;
            },
        );
        meta.append(tracks);
    }

    function appendOpenReleaseLink(meta, releaseUrl) {
        meta.append(createOpenReleaseLink(releaseUrl));
    }

    function applyEmptyReleaseState(shell, meta, text, toggle, releaseUrl) {
        renderEmpty(meta, text, releaseUrl);
        shell.classList.remove("bcampx--expanded");
        toggle.hidden = true;
    }

    function applyStandardReleaseShellState(shell, text, toggle, data) {
        const expandable = hasExpandableContent(data);
        toggle.hidden = !expandable;
        text.textContent = buildSummaryText(data);
        shell.classList.toggle(
            "bcampx--expanded",
            expandable && CONFIG.autoExpandTracks,
        );
        if (expandable) {
            updateToggle(toggle, CONFIG.autoExpandTracks);
        }
    }

    function renderSupportedSlot(meta, text, toggle, data, releaseUrl) {
        const purchasedTrackTitles = getMergedTrackTitleSet(
            meta.closest(CARD_SELECTOR),
        );
        const subhead = compactJoin(
            [formatReleaseDate(data.releaseDate), data.location],
            " · ",
        );
        const panel = createClassedElement("section", "bcampx__slot-panel");
        const autoExpandState = { steps: [] };
        const header = createClassedElement("div", "bcampx__slot-header");
        header.textContent = "Tracklist";
        panel.append(header);

        renderSupportedSlotTracks(
            panel,
            data,
            releaseUrl,
            purchasedTrackTitles,
            autoExpandState,
        );
        renderSupportedSlotDescription(panel, data, autoExpandState);
        appendSupportedSlotSubhead(panel, subhead);

        meta.append(panel);
        scheduleSupportedSlotAutoExpand(panel, autoExpandState);

        toggle.hidden = true;
        text.hidden = true;
    }

    function renderSupportedSlotTracks(
        panel,
        data,
        releaseUrl,
        purchasedTrackTitles,
        autoExpandState,
    ) {
        if (!data.tracks || !data.tracks.length) {
            return;
        }

        const initiallyVisible = Math.min(
            CONFIG.initialVisibleTracks,
            data.tracks.length,
        );
        const tracks = createTrackListElement(
            data.tracks,
            "bcampx__tracks bcampx__tracks--slot",
            (track, index) =>
                createSupportedSlotTrackItem(
                    track,
                    index,
                    initiallyVisible,
                    data,
                    releaseUrl,
                    purchasedTrackTitles,
                ),
        );

        panel.append(tracks);

        if (data.tracks.length <= initiallyVisible) {
            return;
        }

        attachExpandableSection({
            parent: panel,
            target: tracks,
            collapsedClassName: "bcampx__tracks--collapsed",
            controllerClassName: "bcampx__slot-expand",
            collapsedLabel: `Show all ${data.tracks.length} tracks`,
            expandedLabel: "Show less",
            autoExpandState,
            shouldAutoExpand:
                data.tracks.length <= CONFIG.initialVisibleTracks + 3,
        });
    }

    function createSupportedSlotTrackItem(
        track,
        index,
        initiallyVisible,
        data,
        releaseUrl,
        purchasedTrackTitles,
    ) {
        const item = document.createElement("li");
        item.classList.add("bcampx__track-item");
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
        button.addEventListener("click", () =>
            playSharedTrack(button, track, data, releaseUrl),
        );
        item.append(button);
        item.append(createSupportedSlotTrackEnd(track, releaseUrl));
        return item;
    }

    function createSupportedSlotTrackEnd(track, releaseUrl) {
        const end = createClassedElement("div", "bcampx__track-end");
        const trackActionUrl = resolveTrackActionUrl(track, releaseUrl);
        if (trackActionUrl) {
            end.dataset.trackActionUrl = trackActionUrl;
        }

        if (track.duration) {
            const duration = createClassedElement(
                "span",
                "bcampx__track-duration",
            );
            duration.textContent = track.duration;
            end.append(duration);
        }

        if (CONFIG.enableTrackRowActions && trackActionUrl) {
            end.append(createTrackActionButtons(trackActionUrl));
            end.classList.add("bcampx__track-end--has-actions");
        }

        return end;
    }

    function createTrackActionButtons(trackActionUrl) {
        const actions = createClassedElement("div", "bcampx__track-actions");

        actions.append(
            createTrackActionButton(
                "buy",
                "Add this track to basket",
                (event, button) => {
                    event.preventDefault();
                    event.stopPropagation();
                    executeTrackAction("basket", trackActionUrl, button);
                },
            ),
            createTrackActionButton(
                "wish",
                "Add or remove this track from wishlist",
                (event, button) => {
                    event.preventDefault();
                    event.stopPropagation();
                    executeTrackAction("wishlist", trackActionUrl, button);
                },
            ),
        );

        return actions;
    }

    function createTrackActionButton(label, title, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bcampx__track-action";
        button.textContent = label;
        button.title = title;
        button.addEventListener("click", (event) => onClick(event, button));
        return button;
    }

    function refreshRenderedTrackActionButtons() {
        document.querySelectorAll(".bcampx__track-end").forEach((end) => {
            const trackActionUrl =
                end instanceof HTMLElement
                    ? cleanText(end.dataset.trackActionUrl || "")
                    : "";
            const existingActions = end.querySelector(".bcampx__track-actions");

            if (!CONFIG.enableTrackRowActions) {
                if (existingActions) {
                    existingActions.remove();
                }
                end.classList.remove("bcampx__track-end--has-actions");
                return;
            }

            if (!trackActionUrl) {
                end.classList.remove("bcampx__track-end--has-actions");
                return;
            }

            if (existingActions) {
                end.classList.add("bcampx__track-end--has-actions");
                return;
            }

            end.append(createTrackActionButtons(trackActionUrl));
            end.classList.add("bcampx__track-end--has-actions");
        });
    }

    function renderSupportedSlotDescription(panel, data, autoExpandState) {
        const description = createDescriptionElement(
            data,
            "bcampx__description bcampx__description--slot",
        );
        if (!description) {
            return;
        }

        const descriptionBlock = createClassedElement(
            "div",
            "bcampx__description-block",
        );
        descriptionBlock.append(description);
        panel.append(descriptionBlock);

        scheduleNextFrame(() => {
            if (!description.isConnected) {
                return;
            }

            normalizeDescriptionContent(description);
            description.classList.add("bcampx__description--collapsed");
            if (description.scrollHeight > description.clientHeight + 6) {
                attachExpandableSection({
                    parent: descriptionBlock,
                    target: description,
                    collapsedClassName: "bcampx__description--collapsed",
                    controllerClassName:
                        "bcampx__slot-expand bcampx__slot-expand--description",
                    collapsedLabel: "Show more",
                    expandedLabel: "Show less",
                    autoExpandState,
                    shouldAutoExpand:
                        cleanText(description.textContent || "").length <=
                        CONFIG.maxDescriptionLength * 0.5,
                });
                scheduleSupportedSlotAutoExpand(panel, autoExpandState);
                return;
            }

            description.classList.remove("bcampx__description--collapsed");
            scheduleSupportedSlotAutoExpand(panel, autoExpandState);
        });
    }

    function appendSupportedSlotSubhead(panel, subhead) {
        if (!subhead) {
            return;
        }

        const facts = createClassedElement("div", "bcampx__slot-subhead");
        facts.textContent = subhead;
        panel.append(facts);
    }

    function attachExpandableSection({
        parent,
        target,
        collapsedClassName,
        controllerClassName,
        collapsedLabel,
        expandedLabel,
        autoExpandState,
        shouldAutoExpand,
    }) {
        if (!parent || !target || !collapsedClassName) {
            return null;
        }

        target.classList.add(collapsedClassName);
        const controller = createExpandController({
            className: controllerClassName,
            collapsedLabel,
            expandedLabel,
            onToggle: (expanded) => {
                target.classList.toggle(collapsedClassName, !expanded);
            },
        });
        parent.append(controller.button);
        registerAutoExpandStep(autoExpandState, controller, shouldAutoExpand);
        return controller;
    }

    function registerAutoExpandStep(state, controller, shouldAutoExpand) {
        if (
            !state ||
            !Array.isArray(state.steps) ||
            !controller ||
            typeof controller.expand !== "function"
        ) {
            return;
        }

        state.steps.push({
            controller,
            shouldAutoExpand: Boolean(shouldAutoExpand),
        });
    }

    function createExpandController({
        className,
        collapsedLabel,
        expandedLabel,
        onToggle,
    }) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        let autoExpanded = false;

        const syncButton = (expanded) => {
            const autoHidden = expanded && autoExpanded;
            button.hidden = autoHidden;
            button.style.display = autoHidden ? "none" : "";
            button.setAttribute("aria-hidden", autoHidden ? "true" : "false");
            button.textContent = expanded ? expandedLabel : collapsedLabel;
        };

        const setExpanded = (expanded, options = {}) => {
            const auto = Boolean(options.auto);
            if (!expanded) {
                autoExpanded = false;
            } else if (auto) {
                autoExpanded = true;
            } else {
                autoExpanded = false;
            }
            if (typeof onToggle === "function") {
                onToggle(expanded);
            }
            button.setAttribute("aria-expanded", expanded ? "true" : "false");
            syncButton(expanded);
        };

        setExpanded(false);
        button.addEventListener("click", () => {
            const expanded = button.getAttribute("aria-expanded") === "true";
            setExpanded(!expanded, { auto: false });
        });

        return {
            button,
            expand: (options) => setExpanded(true, options),
            collapse: () => setExpanded(false, { auto: false }),
        };
    }

    function scheduleSupportedSlotAutoExpand(panel, state) {
        scheduleNextFrame(() =>
            maybeAutoExpandSupportedSlot(panel, state),
        );
    }

    function maybeAutoExpandSupportedSlot(panel, state) {
        if (
            !panel ||
            !panel.isConnected ||
            !state ||
            !Array.isArray(state.steps)
        ) {
            return;
        }

        while (state.steps.length) {
            const step = state.steps.shift();
            if (
                !step ||
                !step.controller ||
                typeof step.controller.expand !== "function"
            ) {
                continue;
            }
            if (!step.shouldAutoExpand) {
                continue;
            }
            step.controller.expand({ auto: true });
        }
    }

    function renderError(controller, meta, text, releaseUrl, error) {
        meta.textContent = "";
        meta.hidden = false;
        const errorMessage = normalizeDisplayErrorMessage(error);
        const message = createClassedElement("p", "bcampx__error");
        message.textContent = `Could not load release details: ${errorMessage}`;

        meta.append(message);
        if (shouldOfferCustomDomainPermissionButton(error, releaseUrl)) {
            meta.append(
                createGrantCustomDomainAccessButton(controller, releaseUrl),
            );
        }
        if (controller && typeof controller.fetchAndRender === "function") {
            meta.append(createRetryReleaseButton(controller));
        }
        if (shouldOfferReleasePageRefresh(errorMessage)) {
            meta.append(createRefreshReleasePageButton());
        }
        meta.append(createOpenReleaseLink(releaseUrl));
        text.textContent = "Extra context failed to load";
    }

    function shouldAbandonReleaseEnhancement(error) {
        const message =
            error && error.message ? String(error.message) : "";
        return /Custom-domain Bandcamp release could not be resolved\./i.test(
            message,
        );
    }

    function extractMissingCustomDomainHostPermissionPattern(error) {
        const message =
            error && error.message ? String(error.message) : "";
        const match = message.match(
            /Host permission required for (https:\/\/[^\s]+\/\*)/i,
        );
        return match ? match[1] : "";
    }

    function isMissingCustomDomainHostPermissionError(error) {
        return Boolean(extractMissingCustomDomainHostPermissionPattern(error));
    }

    function shouldOfferCustomDomainPermissionButton(error, releaseUrl) {
        return Boolean(
            isMissingCustomDomainHostPermissionError(error) &&
                isWebExtensionHost() &&
                isCustomDomainReleaseUrl(releaseUrl) &&
                canUseExternalHostMethod("requestHostPermission"),
        );
    }

    function normalizeDisplayErrorMessage(error) {
        const rawMessage =
            error && error.message ? String(error.message) : "unknown error";

        if (
            /Extension context invalidated/i.test(rawMessage) ||
            /Receiving end does not exist/i.test(rawMessage) ||
            /Could not establish connection/i.test(rawMessage) ||
            /message port closed/i.test(rawMessage)
        ) {
            return "Extension was updated or reloaded. Refresh this Bandcamp tab and try again.";
        }

        if (/storage\.local\./i.test(rawMessage)) {
            return "Extension storage is unavailable. Refresh the tab or restart the browser and try again.";
        }

        if (isMissingCustomDomainHostPermissionError(error)) {
            return "This release uses a Bandcamp custom domain. Allow access to this domain to load details in the extension.";
        }

        return rawMessage;
    }

    function renderEmpty(meta, text, releaseUrl, options = {}) {
        meta.textContent = "";
        meta.hidden = false;
        const message = createClassedElement("p", "bcampx__empty");
        message.textContent =
            options && options.message
                ? String(options.message)
                : "No extra metadata found for this release.";

        meta.append(message, createOpenReleaseLink(releaseUrl));
        text.textContent =
            options && options.summary
                ? String(options.summary)
                : "No extra context available";
    }

    function createClassedElement(tagName, className) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        return element;
    }

    function createOpenReleaseLink(releaseUrl) {
        const link = createClassedElement("a", "bcampx__link");
        link.href = releaseUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open release";
        return link;
    }

    function createRetryReleaseButton(controller) {
        return createActionButton("Retry", async (button) => {
            if (!controller || controller.loading) {
                return;
            }

            button.disabled = true;
            button.textContent = "Retrying...";
            try {
                await controller.fetchAndRender({ auto: false });
            } finally {
                button.disabled = false;
                button.textContent = "Retry";
            }
        });
    }

    function createGrantCustomDomainAccessButton(controller, releaseUrl) {
        return createActionButton("Allow this domain", async (button) => {
            if (
                !controller ||
                controller.loading ||
                !canUseExternalHostMethod("requestHostPermission")
            ) {
                return;
            }

            button.disabled = true;
            button.textContent = "Opening request...";
            try {
                const result = await getExternalHostApi().requestHostPermission(
                    releaseUrl,
                );
                if (result && result.granted) {
                    button.textContent = "Retrying...";
                    await controller.fetchAndRender({ auto: false });
                    button.disabled = false;
                    button.textContent = "Allow this domain";
                    return;
                }

                button.disabled = false;
                flashActionButtonLabel(button, "Not granted");
            } catch (_error) {
                button.disabled = false;
                flashActionButtonLabel(button, "Try again");
            }
        });
    }

    function createRefreshReleasePageButton() {
        return createActionButton("Refresh page", (button) => {
            button.disabled = true;
            button.textContent = "Refreshing...";
            window.location.reload();
        });
    }

    function flashActionButtonLabel(button, label, durationMs = 1400) {
        if (!button) {
            return;
        }

        const originalLabel =
            button.dataset.bcampxOriginalLabel || button.textContent;
        button.textContent = label;
        window.setTimeout(() => {
            button.textContent = originalLabel;
        }, durationMs);
    }

    function createActionButton(label, onClick) {
        const button = createClassedElement("button", "bcampx__action");
        button.type = "button";
        button.textContent = label;
        button.dataset.bcampxOriginalLabel = label;
        button.addEventListener("click", () => {
            if (typeof onClick === "function") {
                Promise.resolve(onClick(button)).catch((error) => {
                    console.warn("[Bandcamplifier] Action button failed.", error);
                });
            }
        });
        return button;
    }

    function shouldOfferReleasePageRefresh(errorMessage) {
        const message = cleanText(errorMessage).toLowerCase();
        return Boolean(
            message &&
                (/refresh this bandcamp tab/.test(message) ||
                    /extension was updated or reloaded/.test(message) ||
                    /storage is unavailable/.test(message)),
        );
    }

    function createDescriptionElement(data, className, tagName = "div") {
        if (!(data && (data.descriptionHtml || data.description))) {
            return null;
        }

        const description = createClassedElement(tagName, className);
        renderDescriptionContent(description, data);
        return description;
    }

    function createTrackListElement(tracks, className, renderItem) {
        const list = createClassedElement("ol", className);
        (tracks || []).forEach((track, index) => {
            const item =
                typeof renderItem === "function"
                    ? renderItem(track, index)
                    : null;
            if (item instanceof Node) {
                list.append(item);
            }
        });
        return list;
    }

    function renderDescriptionContent(container, data) {
        const html = sanitizeDescriptionHtml(
            data && data.descriptionHtml ? data.descriptionHtml : "",
        );
        if (html) {
            replaceElementChildrenFromHtml(container, html);
            return;
        }

        container.textContent =
            data && data.description ? data.description : "";
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
            if (
                node.nodeType === Node.TEXT_NODE &&
                !cleanText(node.textContent || "")
            ) {
                node.remove();
            }
        });
    }

    function replaceElementChildrenFromHtml(container, html) {
        if (!container) {
            return;
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${html}</div>`,
            "text/html",
        );
        const root = parsed.body.firstElementChild;
        if (!root) {
            replaceElementChildren(container);
            return;
        }

        const nodes = Array.from(root.childNodes).map((node) =>
            document.importNode(node, true),
        );
        replaceElementChildren(container, nodes);
    }

    function replaceElementChildren(container, nodes = []) {
        if (!container) {
            return;
        }

        if (typeof container.replaceChildren === "function") {
            container.replaceChildren(...nodes);
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        nodes.forEach((node) => {
            if (node) {
                container.appendChild(node);
            }
        });
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

    function resolveTrackActionUrl(track, releaseUrl) {
        const titleLink = cleanText(track && track.titleLink);
        if (titleLink) {
            try {
                return new URL(titleLink, releaseUrl).href;
            } catch (_error) {
                return "";
            }
        }

        return /\/track\//.test(releaseUrl) ? releaseUrl : "";
    }

    async function executeTrackAction(action, trackUrl, button) {
        if (!trackUrl || !button) {
            return;
        }

        setTrackActionButtonPending(button, true);
        try {
            if (action === "wishlist") {
                await requestTrackActionViaHelper(action, trackUrl, button);
                return;
            }

            if (action === "basket") {
                const opened = openTrackBuyWindow(trackUrl);
                setTrackActionButtonPending(button, false);
                flashTrackActionButton(button, opened ? "Opened" : "Blocked");
                return;
            }

            throw new Error("Track action is disabled.");
        } catch (_error) {
            setTrackActionButtonPending(button, false);
            flashTrackActionButton(button, "Error");
        }
    }

    function requestTrackActionViaHelper(action, trackUrl, button, options = {}) {
        setupTrackActionMessageBridge();

        return new Promise((resolve, reject) => {
            const request = createTrackActionRequestContext({
                action,
                trackUrl,
                button,
                desiredActive: options.desiredActive,
                resolve,
                reject,
            });
            if (!request) {
                reject(new Error("Invalid track URL."));
                return;
            }

            request.timeoutId = scheduleTrackActionTimeout(request);
            attachTrackActionIframeErrorHandler(request.iframe, request);
            registerPendingTrackActionRequest(request);
            request.iframe.src = request.helperUrl;
            appendToDocument(request.iframe);
        });
    }

    function openTrackBuyWindow(trackUrl) {
        const helperUrl = buildTrackActionHelperUrl(trackUrl, "buy-dialog");
        const openedWindow = openTrackActionWindow(helperUrl);
        return Boolean(openedWindow && !openedWindow.closed);
    }

    function openTrackActionWindow(helperUrl) {
        const openedWindow = window.open(helperUrl, "_blank");
        if (openedWindow && !openedWindow.closed) {
            try {
                openedWindow.opener = null;
            } catch (_error) {}
        }
        return openedWindow;
    }

    function getTrackActionOrigin(trackUrl) {
        try {
            return new URL(trackUrl).origin;
        } catch (_error) {
            return "";
        }
    }

    function createTrackActionRequestId() {
        return `bcampx-track-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function createTrackActionIframe() {
        const iframe = document.createElement("iframe");
        iframe.className = "bcampx__track-action-frame";
        iframe.setAttribute("aria-hidden", "true");
        return iframe;
    }

    function createTrackActionRequestContext({
        action,
        trackUrl,
        button,
        desiredActive,
        resolve,
        reject,
    }) {
        const origin = getTrackActionOrigin(trackUrl);
        if (!origin) {
            return null;
        }

        const requestId = createTrackActionRequestId();
        const iframe = createTrackActionIframe();
        return {
            requestId,
            action,
            button,
            iframe,
            origin,
            trackUrl,
            desiredActive,
            helperUrl: buildTrackActionHelperUrl(trackUrl, action, requestId),
            timeoutId: 0,
            fallbackAttempted: false,
            resolve,
            reject,
        };
    }

    function buildTrackActionHelperUrl(
        trackUrl,
        action,
        requestId = "",
        parentOrigin = window.location.origin,
    ) {
        try {
            const url = new URL(trackUrl);
            const hash = new URLSearchParams({
                "bcampx-helper": action,
                ...(requestId ? { "bcampx-request": requestId } : {}),
                ...(requestId ? { "bcampx-parent-origin": parentOrigin } : {}),
            }).toString();
            url.hash = hash;
            return url.href;
        } catch (_error) {
            return trackUrl;
        }
    }

    function scheduleTrackActionTimeout(pending, timeoutMs = 12000) {
        return window.setTimeout(() => {
            const activePending = STATE.pendingTrackActionRequests.get(
                pending.requestId,
            );
            if (!activePending) {
                return;
            }

            if (attemptTrackActionWindowFallback(activePending, "timeout")) {
                return;
            }

            recordTrackActionDiagnostic("action-timeout", {
                action: activePending.action,
                trackUrl: activePending.trackUrl,
                origin: activePending.origin,
            });
            failTrackActionRequest(
                activePending,
                activePending.requestId,
                new Error(`${activePending.action} request timed out.`),
            );
        }, timeoutMs);
    }

    function attemptTrackActionWindowFallback(pending, reason) {
        if (
            !pending ||
            pending.action !== "wishlist" ||
            pending.fallbackAttempted
        ) {
            return false;
        }

        const attemptedOpen = openTrackActionHelperWindow(pending.helperUrl);
        if (!attemptedOpen) {
            return false;
        }

        pending.fallbackAttempted = true;
        window.clearTimeout(pending.timeoutId);
        pending.timeoutId = scheduleTrackActionTimeout(pending, 15000);
        if (pending.iframe && pending.iframe.parentNode) {
            pending.iframe.remove();
        }
        recordTrackActionDiagnostic("window-fallback-opened", {
            action: pending.action,
            trackUrl: pending.trackUrl,
            origin: pending.origin,
            reason,
        });
        return true;
    }

    function attachTrackActionIframeErrorHandler(
        iframe,
        pending,
    ) {
        iframe.addEventListener(
            "error",
            () => {
                const activePending = STATE.pendingTrackActionRequests.get(
                    pending.requestId,
                );
                if (!activePending) {
                    return;
                }
                recordTrackActionDiagnostic("iframe-load-error", {
                    action: pending.action,
                    trackUrl: pending.trackUrl,
                    origin: pending.origin,
                });
                if (attemptTrackActionWindowFallback(activePending, "iframe-load-error")) {
                    return;
                }
                failTrackActionRequest(
                    activePending,
                    activePending.requestId,
                    new Error(`${pending.action} helper could not load.`),
                );
            },
            { once: true },
        );
    }

    function openTrackActionHelperWindow(helperUrl) {
        const openedWindow = window.open(helperUrl, "_blank");
        if (openedWindow && !openedWindow.closed) {
            return true;
        }

        const link = document.createElement("a");
        link.href = helperUrl;
        link.target = "_blank";
        link.style.display = "none";
        appendToDocument(link);
        link.click();
        link.remove();
        return true;
    }

    function registerPendingTrackActionRequest(pending) {
        STATE.pendingTrackActionRequests.set(pending.requestId, pending);
    }

    function setTrackActionButtonPending(button, pending) {
        if (!button) {
            return;
        }

        if (button.classList.contains("bcampx-player-favorite")) {
            button.disabled = pending;
            button.classList.toggle("bcampx-player-button--pending", pending);
            return;
        }

        button.disabled = pending;
        button.classList.toggle("bcampx__track-action--pending", pending);
        button.dataset.bcampxOriginalLabel =
            button.dataset.bcampxOriginalLabel || button.textContent;
        if (pending) {
            button.textContent = "...";
            const item = button.closest("li");
            if (item) {
                item.classList.add("bcampx__track-item--show-actions");
            }
            return;
        }

        button.textContent =
            button.dataset.bcampxOriginalLabel || button.textContent;
    }

    function flashTrackActionButton(button, label) {
        if (!button) {
            return;
        }

        const original =
            button.dataset.bcampxOriginalLabel || button.textContent;
        button.textContent = label;
        button.classList.add("bcampx__track-action--flash");
        window.setTimeout(() => {
            button.textContent = original;
            button.classList.remove("bcampx__track-action--flash");
            const item = button.closest("li");
            if (item && !item.matches(":hover")) {
                item.classList.remove("bcampx__track-item--show-actions");
            }
        }, 1400);
    }

    function resolveFanIdFromPageState(pagedataBlob, collectInfo = {}) {
        return Number(
            (pagedataBlob &&
                pagedataBlob.identities &&
                pagedataBlob.identities.fan &&
                pagedataBlob.identities.fan.id) ||
                (pagedataBlob &&
                    pagedataBlob.fan_info &&
                    pagedataBlob.fan_info.fan_id) ||
                collectInfo.fan_id ||
                0,
        ) || 0;
    }

    async function requestTrackBasket(context) {
        const payload = new URLSearchParams();
        payload.set("req", "add");
        payload.set(
            "local_id",
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        payload.set(
            "item_type",
            getShortItemType(context.current.type || "track"),
        );
        payload.set("item_id", String(context.current.id || ""));
        payload.set("unit_price", String(context.unitPrice || 0));
        payload.set("quantity", "1");
        payload.set("option_id", "");
        payload.set("discount_id", "");
        payload.set("discount_type", "");
        payload.set("download_type", "");
        payload.set("download_id", "");
        payload.set("purchase_note", "");
        payload.set("notify_me", "false");
        payload.set("notify_me_label", "false");
        payload.set(
            "band_id",
            String(context.bandData.id || context.current.band_id || ""),
        );
        payload.set("releases", "");
        payload.set(
            "ip_country_code",
            cleanText(
                context.pagedataBlob.user_territory ||
                    context.pagedataBlob.identities?.ip_country_code ||
                    context.pagedataBlob.ip_location_country_code ||
                    "",
            ) || "US",
        );
        payload.set(
            "associated_license_id",
            String(context.current.licensed_item_id || ""),
        );
        payload.set("checkout_now", "false");
        payload.set("shipping_exception_mode", "");
        payload.set("is_cardable", "true");
        payload.set("cart_length", String(getCurrentCartLength()));
        payload.set(
            "client_id",
            `bcampx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        );
        payload.set("sync_num", "1");
        if (context.fanId) {
            payload.set("fan_id", String(context.fanId));
        }
        if (context.refToken) {
            payload.set("ref_token", context.refToken);
        }

        const response = await requestJson(`${context.origin}/cart/cb`, {
            method: "POST",
            data: payload.toString(),
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
        });

        if (!response || response.unexpected_error || response.error) {
            throw new Error(
                response && response.error_message
                    ? response.error_message
                    : "Add to basket failed.",
            );
        }
    }

    function getShortItemType(value) {
        const type = cleanText(value).toLowerCase();
        if (type === "track" || type === "t") {
            return "t";
        }
        if (type === "album" || type === "a") {
            return "a";
        }
        if (type === "bundle" || type === "b") {
            return "b";
        }
        return type.slice(0, 1) || "t";
    }

    function getCurrentFanId() {
        const blob =
            parseJsonAttribute(
                document.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        return (
            Number(blob.identities?.fan?.id || blob.fan_info?.fan_id || 0) || 0
        );
    }

    function getCurrentCartLength() {
        const blob =
            parseJsonAttribute(
                document.querySelector("#pagedata"),
                "data-blob",
            ) || {};
        const quantity =
            blob.menubar && typeof blob.menubar.cart_quantity !== "undefined"
                ? Number(blob.menubar.cart_quantity)
                : 0;
        return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    }

    function isFullDiscographyReleaseData(data) {
        const title = cleanText(data && data.title);
        return /\bfull(?:\s+digital)?\s+discography\b/i.test(title);
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
        return STATE.activeTrackCard && document.contains(STATE.activeTrackCard)
            ? STATE.activeTrackCard
            : null;
    }

    function syncCoverPlaybackState() {
        if (STATE.coverPlaybackStateNode) {
            STATE.coverPlaybackStateNode.classList.remove("playing", "paused");
            STATE.coverPlaybackStateNode = null;
        }

        const card = getConnectedActiveTrackCard();
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
        const trackId = cleanText(track && track.trackId);
        if (trackId) {
            const matches = Array.from(
                document.querySelectorAll(
                    `[data-trackid="${CSS.escape(trackId)}"]`,
                ),
            ).filter((node) => {
                return node instanceof HTMLElement && isNodeVisible(node);
            });

            const preferred = matches
                .map((node) => {
                    return (
                        node.closest(
                            ".story-innards.collection-item-container",
                        ) ||
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
            continuousModeSettingInput: continuousModeSetting.input,
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
        if (!hasTrack && STATE.playerSettingsOpen) {
            closePlayerSettingsMenu();
        }
        document.documentElement.classList.toggle(
            "bcampx-player-active",
            hasTrack,
        );
        if (!hasTrack) {
            return;
        }

        const track = STATE.activeTrack;
        const data = STATE.activeReleaseData || {};
        const releaseUrl = STATE.activeReleaseUrl || "#";
        const canGoPrev =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                -1,
            ) >= 0 ||
            (CONFIG.continuousMode && hasNeighborPlayableRelease(-1));
        const canGoNext =
            findAdjacentPlayableTrackIndex(
                STATE.activeTrackList,
                STATE.activeTrackIndex,
                1,
            ) >= 0 ||
            (CONFIG.continuousMode && hasNeighborPlayableRelease(1));
        ensureArtistMusicPlayerWishlistState(releaseUrl);
        const favoriteState = getPlayerFavoriteState(releaseUrl);
        ui.prevButton.disabled = !canGoPrev;
        ui.nextButton.disabled = !canGoNext;
        ui.favoriteButton.hidden = favoriteState.hidden;
        ui.favoriteButton.disabled = favoriteState.disabled;
        ui.favoriteButton.classList.toggle(
            "bcampx-player-button--pending",
            Boolean(favoriteState.pending),
        );
        if (favoriteState.hasState) {
            setFavoriteButtonState(ui.favoriteButton, favoriteState.active);
        }
        ui.releaseButton.disabled = !releaseUrl || releaseUrl === "#";
        ui.trackLink.textContent =
            `${data.artist || ""}${data.artist && track.title ? " - " : ""}${track.title || data.title || ""}` ||
            "Select a preview track";
        ui.storeLink.textContent =
            data.title && data.artist
                ? `${data.title} / ${data.artist}`
                : data.title || data.artist || "No track selected";
        ui.storeLink.href = releaseUrl;
        attachSharedAudioToPlayer(ui.nativeAudio, audio);
        syncFavoriteButtonState();
        syncPlayerSettingsMenu();
    }

    function getPlayerFavoriteState(releaseUrl) {
        if (!isArtistMusicPage()) {
            return {
                hidden: false,
                disabled: !findActiveWishlistControl(),
                hasState: false,
                active: false,
                pending: false,
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
        const hasPendingAction =
            !!normalizedReleaseUrl &&
            STATE.playerWishlistActionRequests.has(normalizedReleaseUrl);
        return {
            hidden: !normalizedReleaseUrl,
            disabled:
                !normalizedReleaseUrl ||
                hasPendingAction ||
                !hasCachedState ||
                cachedState.canToggle === false,
            hasState: true,
            active: hasCachedState ? Boolean(cachedState.active) : false,
            pending: hasPendingAction,
        };
    }

    function ensureArtistMusicPlayerWishlistState(releaseUrl) {
        if (!isArtistMusicPage()) {
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

            ensureArtistMusicPlayerWishlistState(normalizedReleaseUrl);
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
            const html = await requestWishlistStateHtml(releaseUrl);
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

        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.setAttribute(
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
        ui.settingsButton.setAttribute("aria-expanded", open ? "true" : "false");
        ui.settingsButton.setAttribute(
            "aria-label",
            open ? "Close settings" : "Open settings",
        );
        ui.settingsMenu.hidden = !open;
        if (ui.trackRowActionsSettingInput) {
            ui.trackRowActionsSettingInput.checked =
                !!CONFIG.enableTrackRowActions;
        }
        if (ui.autoFillPriceSettingInput) {
            ui.autoFillPriceSettingInput.checked = !!CONFIG.autoFillMinimumPrice;
        }
        if (ui.continuousModeSettingInput) {
            ui.continuousModeSettingInput.checked = !!CONFIG.continuousMode;
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
        return { row, input };
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

    function hasNeighborPlayableRelease(offset) {
        return Boolean(findNeighborPlayableRelease(offset));
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

    function scrollToActiveTrackCard() {
        const activeCard = getConnectedActiveTrackCard();
        if (!activeCard) {
            return;
        }

        scrollCardIntoView(activeCard, STATE.activeTrack);
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
        return PLAYER_SHELL_CSS;
    }

    function pauseBandcampPageAudio() {
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

        ui.favoriteButton.classList.remove(
            "bcampx-player-favorite--owned",
        );

       if (
           STATE.activeReleaseData &&
           isOwnedDigitalPrice(STATE.activeReleaseData.digitalPrice)
       ) {
           ui.favoriteButton.hidden = false;
           ui.favoriteButton.disabled = true;
           ui.favoriteButton.classList.remove("bcampx-player-button--pending");
            ui.favoriteButton.classList.add(
                "bcampx-player-favorite--owned",
            );
           setFavoriteButtonState(ui.favoriteButton, true);
           return;
       }

        if (isArtistMusicPage()) {
            ensureArtistMusicPlayerWishlistState(STATE.activeReleaseUrl || "");
            const state = getPlayerFavoriteState(STATE.activeReleaseUrl || "");
            ui.favoriteButton.hidden = state.hidden;
            ui.favoriteButton.disabled = state.disabled;
            ui.favoriteButton.classList.toggle(
                "bcampx-player-button--pending",
                Boolean(state.pending),
            );
            if (state.hasState) {
                setFavoriteButtonState(ui.favoriteButton, state.active);
            }
            return;
        }

        const wishlistControl = findActiveWishlistControl();
        const active = isWishlistActive(wishlistControl);
        setFavoriteButtonState(ui.favoriteButton, active);
    }

    function toggleActiveWishlist() {
        const ui = STATE.playerUi;
        if (isArtistMusicPage()) {
            void toggleActiveLabelWishlist();
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

    async function toggleActiveLabelWishlist() {
        const ui = STATE.playerUi;
        const releaseUrl = normalizeReleaseUrl(STATE.activeReleaseUrl || "");
        if (!ui || !ui.favoriteButton || !releaseUrl) {
            return;
        }

        const favoriteState = getPlayerFavoriteState(releaseUrl);
        if (favoriteState.disabled) {
            ensureArtistMusicPlayerWishlistState(releaseUrl);
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
        button.textContent = isPaused ? "Play" : "Pause";
        button.setAttribute("aria-label", isPaused ? "Play" : "Pause");
        button.classList.toggle("bcampx__waypoint-toggle--paused", isPaused);
    }

    function injectStyles() {
        const style = document.createElement("style");
        style.textContent = ENHANCEMENT_CSS;
        document.head.appendChild(style);
    }

    function storageGet(key, fallback) {
        if (canUseExternalHostMethod("storageGet")) {
            return Promise.resolve(
                getExternalHostApi().storageGet(key, fallback),
            ).catch(() => fallback);
        }

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
        if (canUseExternalHostMethod("storageSet")) {
            return Promise.resolve(
                getExternalHostApi().storageSet(key, value),
            ).catch(() => {});
        }

        try {
            if (typeof GM_setValue === "function") {
                return Promise.resolve(GM_setValue(key, value));
            }
        } catch (_error) {
            return Promise.resolve();
        }

        return Promise.resolve();
    }

    function markDebugState(name, value) {
        if (!document.documentElement || !name) {
            return;
        }

        document.documentElement.setAttribute(name, cleanText(value));
    }

    function incrementDebugCounter(name) {
        if (!document.documentElement || !name) {
            return;
        }

        const current = Number(
            document.documentElement.getAttribute(name) || "0",
        );
        document.documentElement.setAttribute(
            name,
            String(Number.isFinite(current) ? current + 1 : 1),
        );
    }

        function metaContent(doc, selector) {
        return attrContent(doc, selector, "content");
    }

    function extractDescriptionHtml(doc) {
        const descriptionNode = doc.querySelector(
            ".tralbum-about, .album-about",
        );
        if (!descriptionNode) {
            return "";
        }

        return sanitizeDescriptionHtml(descriptionNode.innerHTML || "");
    }

    function sanitizeDescriptionHtml(rawHtml) {
        if (!rawHtml) {
            return "";
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${rawHtml}</div>`,
            "text/html",
        );
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
        const raw = String(value || "")
            .replace(/\r\n/g, "\n")
            .trim();
        if (!raw) {
            return "";
        }

        const shortened =
            raw.length > maxLength
                ? `${raw.slice(0, maxLength - 3).trim()}...`
                : raw;
        const escaped = escapeHtml(shortened);
        const linked = escaped.replace(
            /(https?:\/\/[^\s<]+)/gi,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
        );
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

        const parsed = new DOMParser().parseFromString(
            `<div>${html}</div>`,
            "text/html",
        );
        return cleanText(parsed.body.textContent || "");
    }

    function isLikelyTracklistHtml(value, tracks) {
        return isLikelyTracklistText(descriptionHtmlToText(value), tracks);
    }

    function isLikelyTracklistDescription(data) {
        if (!data) {
            return false;
        }

        return (
            isLikelyTracklistText(data.description || "", data.tracks) ||
            isLikelyTracklistHtml(data.descriptionHtml || "", data.tracks)
        );
    }

    function isLikelyTracklistText(value, tracks) {
        const text = String(value || "").trim();
        if (!text || !Array.isArray(tracks) || tracks.length < 1) {
            return false;
        }

        const normalized = cleanText(text).toLowerCase();
        const numberedItems = (text.match(/\b\d+\.\s+/g) || []).length;
        const matchingTrackTitles = tracks.filter((track) => {
            const title = cleanText(
                track && track.title ? track.title : "",
            ).toLowerCase();
            return title && normalized.includes(title);
        }).length;

        const hasReleaseSummaryShape =
            /\bby\b.+\breleased\b/i.test(text) ||
            /\breleased\s+\d{1,2}\s+\w+\s+\d{4}\b/i.test(text);
        const isSingleTrackAutoSummary =
            tracks.length === 1 &&
            hasReleaseSummaryShape &&
            matchingTrackTitles >= 1 &&
            numberedItems >= 1;

        if (isSingleTrackAutoSummary) {
            return true;
        }

        if (
            matchingTrackTitles >= Math.min(4, tracks.length) &&
            numberedItems >= 2
        ) {
            return true;
        }

        if (
            hasReleaseSummaryShape &&
            matchingTrackTitles >= Math.min(2, tracks.length) &&
            numberedItems >= 1
        ) {
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
        return cleanText(
            String(value || "").replace(/\s*\|\s*Bandcamp\s*$/i, ""),
        );
    }

    function firstString(value) {
        return typeof value === "string" && value.trim()
            ? cleanText(value)
            : "";
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
        const normalizedData = normalizeReleaseData(data);
        const parts = [];
        if (normalizedData.description) {
            parts.push("Description");
        }
        if (normalizedData.tracks && normalizedData.tracks.length) {
            parts.push(`${normalizedData.tracks.length} tracks`);
        }
        return parts.length ? parts.join(" · ") : "Extra context loaded";
    }

    function buildLoadedSummaryText(data, result) {
        const summary = buildSummaryText(data);
        if (!(result && result.fromCache)) {
            return summary;
        }

        if (result.stale) {
            return summary === "Extra context loaded"
                ? "Extra context loaded from cached fallback"
                : `${summary} · cached fallback`;
        }

        return summary === "Extra context loaded"
            ? "Extra context loaded from cache"
            : `${summary} · cached`;
    }

    function hasExpandableContent(data) {
        return Boolean(data && data.tracks && data.tracks.length);
    }

    function hasVisibleEnhancements(data) {
        if (!data || typeof data !== "object") {
            return false;
        }

        return Boolean(
            formatReleaseDate(data.releaseDate) ||
            data.location ||
            data.description ||
            (data.tracks && data.tracks.length),
        );
    }

    function decodeJsString(value) {
        try {
            return JSON.parse(`"${value}"`);
        } catch (_error) {
            return cleanText(value);
        }
    }
})();
