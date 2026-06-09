/**
 * Netflix Subtitles Translator - Utilities Module
 * Common helper functions used across modules.
 */
(function(NST) {
  'use strict';

  const LOG = function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = function() { try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };

  // In-memory cache for fetch requests
  const fetchCache = {};

  /**
   * Fetch JSON from URL with in-memory caching
   */
  function loadJson(url, callback) {
    if (fetchCache[url]) {
      LOG('fetch (cache hit):', url);
      return callback(fetchCache[url]);
    }

    LOG('fetch start:', url);
    fetch(url)
      .then(function(res) {
        if (res.status >= 200 && res.status < 300) {
          return Promise.resolve(res);
        } else {
          return Promise.reject(new Error('HTTP ' + res.status + ' ' + res.statusText));
        }
      })
      .then(function(res) {
        return res.json();
      })
      .then(function(data) {
        LOG('fetch ok:', url);
        fetchCache[url] = data;
        return callback(data);
      })
      .catch(function(err) {
        WARN('fetch FAILED:', url, '->', err && err.message ? err.message : err);
        try { callback(null); } catch(e){}
      });
  }

  /**
   * Format seconds as human-readable timestamp (M:SS or H:MM:SS)
   */
  function fmtTime(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    return (h > 0 ? h + ':' + pad(m) : m) + ':' + pad(s);
  }

  /**
   * Escape a string for use as an Org-mode heading (escape leading *)
   */
  function escOrgHeading(s) {
    return s.replace(/^\*/, '\\*');
  }

  /**
   * Sanitize a string for use as a filename
   */
  function safeFilename(s) {
    return s.replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'netflix-subtitles';
  }

  // Export public API
  NST.utils = {
    LOG: LOG,
    WARN: WARN,
    loadJson: loadJson,
    fmtTime: fmtTime,
    escOrgHeading: escOrgHeading,
    safeFilename: safeFilename
  };

})(window.NST = window.NST || {});
