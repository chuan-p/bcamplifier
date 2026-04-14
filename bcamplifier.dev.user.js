// ==UserScript==
// @name         Bandcamplifier Dev Loader
// @namespace    https://github.com/chuan-p/bcamplifier
// @version      0.2.52
// @description  Loads the local Bandcamplifier userscript through Tampermonkey @require for development.
// @author       chuan
// @match        https://bandcamp.com/feed*
// @match        https://bandcamp.com/*/feed*
// @match        https://bandcamp.com/*
// @match        https://*.bandcamp.com/*
// @updateURL    http://127.0.0.1:8000/bcamplifier.dev.user.js
// @downloadURL  http://127.0.0.1:8000/bcamplifier.dev.user.js
// @connect      127.0.0.1
// @connect      localhost
// @connect      bandcamp.com
// @connect      *.bandcamp.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @require      http://127.0.0.1:8000/bcamplifier.user.js?v=0.1.175
// ==/UserScript==

(function () {
  "use strict";
  console.debug("[Bandcamplifier Dev] Loaded local script via @require.");
})();
