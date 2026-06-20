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
  let currentVideoId = null;

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
   * Get captures only for the current video
   */
  function getCapturesForCurrentVideo() {
    if (!currentVideoId) return captures;

    // Ensure all captures have videoId set first
    captures.forEach(function(c) {
      if (!c.videoId) {
        c.videoId = currentVideoId;
      }
    });

    return captures.filter(function(c) {
      return c.videoId === currentVideoId;
    });
  }

  /**
   * Set current video ID and clear captures if switching videos
   */
  function setCurrentVideoId(videoId) {
    if (currentVideoId !== videoId) {
      LOG('Switching video from', currentVideoId, 'to', videoId, '- clearing captures');
      currentVideoId = videoId;
      clearCaptures();
    }
  }

  /**
   * Get current video ID
   */
  function getCurrentVideoId() {
    return currentVideoId;
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
    // Always set the videoId if we have one
    if (currentVideoId) {
      capture.videoId = currentVideoId;
    }
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

    // Also show in the center translator overlay if this is the current subtitle
    // (don't show for preloaded subtitles)
    if (!capture.preloaded && target && target.classList && target.classList.contains('nst-current')) {
      if (NST.ui && NST.ui.centerTranslator && NST.ui.centerTranslator.showTranslation) {
        NST.ui.centerTranslator.showTranslation(gtrans);
      }
    }
  }

  /**
   * Auto-translate a subtitle, using cache first
   * Handles multi-line subtitles by translating each line separately
   */
  function autoTranslate(sentence, capture, doneCallback) {
    if (!sentence) { if (doneCallback) doneCallback(); return; }

    // If we already have a translation (revised one from imported file), don't re-translate
    if (capture && capture.translation && capture.translation.trim() && capture.status === 'ok') {
      LOG('Already have a translation for this subtitle, skipping auto-translate');
      if (doneCallback) doneCallback();
      return;
    }

    const src = config.user.srcLang || 'auto';
    const tgt = config.user.lang || 'en';
    const done = function() { if (doneCallback) try { doneCallback(); } catch(e){} };

    // Split into lines
    const lines = sentence.split(/\r?\n/).filter(function(l) { return l.trim(); });

    // If only one line, use the simple path
    if (lines.length <= 1) {
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
      return;
    }

    // Multi-line: translate each line separately
    LOG('auto-translate: handling', lines.length, 'lines separately');

    // Check cache for the whole thing first
    transCacheGet(src, tgt, sentence, function(cached) {
      if (cached) {
        LOG('auto-translate (cached):', cached);
        applyTranslation(capture.dl, cached, capture);
        capture.status = 'ok';
        const videoId = NST.netflix && NST.netflix.player ? NST.netflix.player.getNetflixVideoId() : null;
        if (videoId && db && typeof capture.videoTime === 'number') {
          db.recordSubtitle(videoId, capture.videoTime, capture.original, cached, 'ok');
        }
        return done();
      }

      // Not in cache - translate line by line
      const videoId = NST.netflix && NST.netflix.player ? NST.netflix.player.getNetflixVideoId() : null;
      if (videoId && db && typeof capture.videoTime === 'number' && !capture.preloaded) {
        db.recordSubtitle(videoId, capture.videoTime, capture.original, null, 'pending');
      }

      const translatedLines = [];
      let completed = 0;
      let hasError = false;

      // Translate each line
      lines.forEach(function(line, index) {
        // Check cache for individual line first
        transCacheGet(src, tgt, line, function(cachedLine) {
          if (cachedLine) {
            translatedLines[index] = cachedLine;
            checkDone();
          } else {
            // Fetch from Google for this line
            loadJson(gtansUrl(line), function(data) {
              if (!data) {
                hasError = true;
                translatedLines[index] = line; // Fallback to original
              } else {
                let lineTrans = '';
                try {
                  data['sentences'].forEach(function(seg) { lineTrans += seg.trans + ' '; });
                  lineTrans = lineTrans.trim();
                } catch(e) {
                  lineTrans = line;
                }
                translatedLines[index] = lineTrans;
                // Cache the individual line
                if (lineTrans) {
                  transCacheSet(src, tgt, line, lineTrans);
                }
              }
              checkDone();
            });
          }
        });
      });

      function checkDone() {
        completed++;
        if (completed < lines.length) return;

        // Join the translated lines with newlines
        const finalTrans = translatedLines.join('\n');

        if (!finalTrans || hasError) {
          if (videoId && db && typeof capture.videoTime === 'number') {
            db.recordSubtitle(videoId, capture.videoTime, capture.original, finalTrans || null, hasError ? 'failed' : 'ok');
          }
          return done();
        }

        LOG('auto-translate (multi-line):', finalTrans);
        // Cache the whole thing too
        transCacheSet(src, tgt, sentence, finalTrans);
        capture.status = 'ok';

        if (videoId && db && typeof capture.videoTime === 'number') {
          db.recordSubtitle(videoId, capture.videoTime, capture.original, finalTrans, 'ok');
        }

        applyTranslation(capture.dl, finalTrans, capture);
        done();
      }
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
        // Ensure video_time is a number (sql.js might return as string)
        let videoTime = null;
        if (r.video_time !== null && r.video_time !== undefined) {
          const vtNum = Number(r.video_time);
          if (!isNaN(vtNum)) {
            videoTime = vtNum;
          }
        }
        const entry = {
          original: r.original,
          translation: r.translation || '',
          ts: Date.now(),
          videoTime: videoTime,
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
    getCapturesForCurrentVideo: getCapturesForCurrentVideo,
    clearCaptures: clearCaptures,
    setCurrentVideoId: setCurrentVideoId,
    getCurrentVideoId: getCurrentVideoId,
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
