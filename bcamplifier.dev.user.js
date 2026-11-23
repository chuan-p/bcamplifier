// ==UserScript==
// @name         Bandcamplifier Dev Loader
// @namespace    https://github.com/chuan-p/bcamplifier
// @version      3.3.3
// @description  Loads the local Bandcamplifier userscript through Tampermonkey @require for development.
// @author       chuan
// @match        https://bandcamp.com/*
// @match        https://*.bandcamp.com/*
// @match        https://*/album/*
// @match        https://*/track/*
// @updateURL    http://127.0.0.1:8000/bcamplifier.dev.user.js
// @downloadURL  http://127.0.0.1:8000/bcamplifier.dev.user.js
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-idle
// @require      http://127.0.0.1:8000/bcamplifier.user.js?v=3.3.3
// ==/UserScript==

(function () {
  "use strict";
  console.debug("[Bandcamplifier Dev] Loaded local script via @require.");
})();
