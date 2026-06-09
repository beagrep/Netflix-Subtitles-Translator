/**
 * Netflix Subtitles Translator - Translator Module
 * Core translation logic with caching and retry queue.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const config = NST.config || { user: {} };
  const db = NST.db || null;
  const loadJson = NST.utils ? NST.utils.loadJson : function() {};
  const gtansUrl = NST.config ? NST.config.gtansUrl : function() { return ''; };

  // In-memory captures
  let captures = [];

  // Retry queue state
  let retryQueue = [];
  let retryRunning = false;

  /**
   * Get all in-memory captures
   */
  function getCaptures() {
    return captures;
  }

  /**
   * Clear all in-memory captures
   */
  function clearCaptures() {
    captures = [];
  }

  /**
   * Add a capture entry
   */
  function addCapture(capture) {
    captures.push(capture);
    return capture;
  }

  /**
   * Find an existing capture by text and optional timestamp
   */
  function findExistingCapture(text, vt) {
    if (typeof vt !== 'number' || !isFinite(vt)) {
      for (let i = captures.length - 1; i >= 0; i--) {
        if (captures[i].original === text) return captures[i];
      }
      return null;
    }
    for (let i = 0; i < captures.length; i++) {
      const c = captures[i];
      if (c.original !== text) continue;
      if (typeof c.videoTime !== 'number') continue;
      if (Math.abs(c.videoTime - vt) <= 3) return c;
    }
    return null;
  }

  /**
   * Get a translation from cache (DB wrapper)
   */
  function transCacheGet(srcLang, tgtLang, text, callback) {
    if (db) {
      db.getCachedTranslation(srcLang || 'auto', tgtLang || 'en', text, callback);
    } else {
      callback(null);
    }
  }

  /**
   * Store a translation in cache (DB wrapper)
   */
  function transCacheSet(srcLang, tgtLang, text, translation) {
    if (!translation || !db) return;
    db.setCachedTranslation(srcLang || 'auto', tgtLang || 'en', text, translation);
  }

  /**
   * Apply a translation to a capture's UI element
   */
  function applyTranslation(target, gtrans, capture) {
    if (!gtrans || !capture) return;
    capture.translation = gtrans;

    if (NST.ui && NST.ui.subtitles) {
      NST.ui.subtitles.applyTranslation(target, gtrans);
    }
  }

  /**
   * Auto-translate a subtitle, using cache first
   */
  function autoTranslate(sentence, capture, doneCallback) {
    if (!sentence) { if (doneCallback) doneCallback(); return; }

    const src = config.user.srcLang || 'auto';
    const tgt = config.user.lang || 'en';
    const done = function() { if (doneCallback) try { doneCallback(); } catch(e){} };

    // Try cache first
    transCacheGet(src, tgt, sentence, function(cached) {
      if (cached) {
        LOG('auto-translate (cached):', cached);
        applyTranslation(capture.dl, cached, capture);
        capture.status = 'ok';

        // Also record to subtitles table if we have video context
        const videoId = NST.netflix && NST.netflix.player ? NST.netflix.player.getNetflixVideoId() : null;
        if (videoId && db && typeof capture.videoTime === 'number') {
          db.recordSubtitle(videoId, capture.videoTime, capture.original, cached, 'ok');
        }
        return done();
      }

      // Not in cache - fetch from Google
      const videoId = NST.netflix && NST.netflix.player ? NST.netflix.player.getNetflixVideoId() : null;
      if (videoId && db && typeof capture.videoTime === 'number' && !capture.preloaded) {
        db.recordSubtitle(videoId, capture.videoTime, capture.original, null, 'pending');
      }

      loadJson(gtansUrl(sentence), function(data) {
        if (!data) {
          if (videoId && db && typeof capture.videoTime === 'number') {
            db.recordSubtitle(videoId, capture.videoTime, capture.original, null, 'failed');
          }
          return done();
        }

        let gtrans = '';
        try {
          data['sentences'].forEach(function(seg) { gtrans += seg.trans + ' '; });
        } catch(e) {
          if (videoId && db && typeof capture.videoTime === 'number') {
            db.recordSubtitle(videoId, capture.videoTime, capture.original, null, 'failed');
          }
          return done();
        }

        gtrans = gtrans.trim();
        if (!gtrans) {
          if (videoId && db && typeof capture.videoTime === 'number') {
            db.recordSubtitle(videoId, capture.videoTime, capture.original, null, 'failed');
          }
          return done();
        }

        LOG('auto-translate:', gtrans);
        transCacheSet(src, tgt, sentence, gtrans);
        capture.status = 'ok';

        if (videoId && db && typeof capture.videoTime === 'number') {
          db.recordSubtitle(videoId, capture.videoTime, capture.original, gtrans, 'ok');
        }

        applyTranslation(capture.dl, gtrans, capture);
        done();
      });
    });
  }

  /**
   * Load pre-existing subtitles from DB for current video
   */
  function loadVideoSubtitles(videoId, callback) {
    if (!db) { if (callback) callback([]); return; }

    db.loadVideoSubtitles(videoId, function(rows) {
      const loaded = [];
      rows.forEach(function(r) {
        const entry = {
          original: r.original,
          translation: r.translation || '',
          ts: Date.now(),
          videoTime: typeof r.video_time === 'number' ? r.video_time : null,
          dl: null,
          preloaded: true,
          status: r.status
        };
        loaded.push(entry);
      });
      if (callback) callback(loaded);
    });
  }

  /**
   * Queue missing translations for retry
   */
  function retryMissingTranslations() {
    retryQueue = captures.filter(function(c) {
      return !c.translation || c.status === 'pending' || c.status === 'failed';
    });
    if (!retryQueue.length) return;
    LOG('nstDB: scheduling', retryQueue.length, 'translation retries');
    pumpRetry();
  }

  /**
   * Process the retry queue
   */
  function pumpRetry() {
    if (retryRunning) return;
    const next = retryQueue.shift();
    if (!next) return;
    retryRunning = true;
    autoTranslate(next.original, next, function() {
      retryRunning = false;
      setTimeout(pumpRetry, 250);
    });
  }

  // Export public API
  NST.translator = {
    getCaptures: getCaptures,
    clearCaptures: clearCaptures,
    addCapture: addCapture,
    findExistingCapture: findExistingCapture,
    transCacheGet: transCacheGet,
    transCacheSet: transCacheSet,
    applyTranslation: applyTranslation,
    autoTranslate: autoTranslate,
    loadVideoSubtitles: loadVideoSubtitles,
    retryMissingTranslations: retryMissingTranslations
  };

})(window.NST = window.NST || {});
