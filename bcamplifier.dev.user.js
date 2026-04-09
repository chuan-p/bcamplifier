// ==UserScript==
// @name         BC Amplifier Dev Loader
// @namespace    https://github.com/local/bcamplifier
// @version      0.2.2
// @description  Loads the local BC Amplifier userscript through Tampermonkey @require for development.
// @author       chuanpeng
// @match        https://bandcamp.com/feed*
// @match        https://bandcamp.com/*/feed*
// @connect      127.0.0.1
// @connect      localhost
// @connect      bandcamp.com
// @connect      *.bandcamp.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @require      http://127.0.0.1:8000/bcamplifier.user.js?v=20260408-1148
// ==/UserScript==

(function () {
  "use strict";
  console.debug("[BC Amplifier Dev] Loaded local script via @require.");
})();
