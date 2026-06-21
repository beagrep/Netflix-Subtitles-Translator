/**
 * Netflix Subtitles Translator - Main Content Script
 * Ties all modules together and runs the main loop.
 */
(function(NST) {
  'use strict';

  // Aliases for modules
  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const config = NST.config || { state: {} };
  const db = NST.db || null;
  const panel = NST.ui ? NST.ui.panel : null;
  const subtitlesUI = NST.ui ? NST.ui.subtitles : null;
  const pause = NST.ui ? NST.ui.pause : null;
  const centerTranslator = NST.ui ? NST.ui.centerTranslator : null;
  const ttmlOverlay = NST.ui ? NST.ui.ttmlOverlay : null;
  const translatePanel = NST.ui ? NST.ui.translatePanel : null;
  const player = NST.netflix ? NST.netflix.player : null;
  const subtitleReader = NST.netflix ? NST.netflix.subtitles : null;
  const subtitleApi = NST.netflix ? NST.netflix.subtitleApi : null;
  const translator = NST.translator || null;
  const exportModule = NST.export || null;

  // State
  let launched = false;
  let subtitleBefore = '';
  let wait = false;
  let videoId = null;

  /**
   * Expose clear subtitle DB function to window
   */
  function setupClearSubtitleDB() {
    window.__nstClearSubtitleDB = function(callback) {
      try {
        if (!window.location.href.match(/.+:\/\/.+netflix\.com\/watch\//)) {
          callback({ ok: false, error: 'Open a Netflix watch page first.' });
          return;
        }
        const videoId = player ? player.getNetflixVideoId() : null;
        if (!videoId) {
          callback({ ok: false, error: 'Could not get Netflix video ID.' });
          return;
        }

        // Count how many we're about to delete
        const captures = translator ? translator.getCaptures() : [];
        const countBefore = captures.length;

        // Clear in-memory captures
        if (translator) translator.clearCaptures();

        // Clear the panel
        if (subtitlesUI) subtitlesUI.clearAll();

        // Clear from DB
        if (db) {
          db.clearVideoSubtitles(videoId, function(result) {
            result.count = countBefore;
            callback(result);
          });
        } else {
          callback({ ok: true, count: countBefore });
        }
      } catch(e) {
        callback({ ok: false, error: 'Clear error: ' + (e && e.message) });
      }
    };
  }

  /**
   * Load any official Netflix subtitles we have captured into our DB
   */
  function loadOfficialSubtitles() {
    if (!subtitleApi || !translator || !db || !videoId) return;

    // If bilingual mode is enabled with both languages configured, load bilingual pairs
    if (config.user.useOfficialSubtitles && config.user.officialSourceLang && config.user.officialTargetLang) {
      loadBilingualSubtitles();
      return;
    }

    // Single language mode (translation target)
    const targetLang = config.user.lang || 'en';

    const officialCaptures = subtitleApi.getSubtitles(targetLang);
    LOG('Found', officialCaptures.length, 'official captions in', targetLang);

    // For each official caption, see if we need to add it or update existing
    officialCaptures.forEach(function(cue) {
      // Try to find an existing capture by similar time
      const existing = findExistingCaptureByTime(cue.startTime);
      if (existing) {
        // Update if we don't have a translation yet
        if (!existing.translation || !existing.translation.trim() || existing.status !== 'ok') {
          existing.translation = cue.text;
          existing.status = 'ok';
          existing.isOfficial = true;

          // Update the UI
          if (existing.dl) {
            subtitlesUI.applyTranslation(existing.dl, cue.text);
          }

          // Update DB
          db.recordSubtitle(videoId, cue.startTime, existing.original, cue.text, 'ok');
        }
      }
    });
  }

  /**
   * Pair source and target cues by time using a two-pointer greedy merge.
   * Returns ordered segments: [{ startTime, endTime, src, tgt, kind }]
   * where kind is 'pair' | 'srcOnly' | 'tgtOnly' and src/tgt may be null.
   */
  function pairCues(srcCues, tgtCues, tolerance) {
    tolerance = (typeof tolerance === 'number') ? tolerance : 1.0;
    const segments = [];
    let i = 0, j = 0;
    const tgtMatched = new Set();

    while (i < srcCues.length || j < tgtCues.length) {
      const srcCue = i < srcCues.length ? srcCues[i] : null;
      // Find next unmatched target cue
      let tgtCue = null;
      for (let k = j; k < tgtCues.length; k++) {
        if (!tgtMatched.has(k)) { tgtCue = tgtCues[k]; break; }
      }

      if (srcCue && tgtCue) {
        const startsClose = Math.abs(srcCue.startTime - tgtCue.startTime) < tolerance;
        const overlaps = srcCue.startTime <= tgtCue.endTime && tgtCue.startTime <= srcCue.endTime;
        if (startsClose || overlaps) {
          segments.push({
            startTime: Math.min(srcCue.startTime, tgtCue.startTime),
            endTime: Math.max(srcCue.endTime || srcCue.startTime, tgtCue.endTime || tgtCue.startTime),
            src: srcCue, tgt: tgtCue, kind: 'pair'
          });
          // find the actual index of tgtCue starting at j
          while (j < tgtCues.length && (tgtMatched.has(j) || tgtCues[j] !== tgtCue)) j++;
          tgtMatched.add(j);
          i++; j++;
          continue;
        }
        // No match: emit the earlier one
        if (srcCue.startTime <= tgtCue.startTime) {
          segments.push({ startTime: srcCue.startTime, endTime: srcCue.endTime || srcCue.startTime, src: srcCue, tgt: null, kind: 'srcOnly' });
          i++;
        } else {
          segments.push({ startTime: tgtCue.startTime, endTime: tgtCue.endTime || tgtCue.startTime, src: null, tgt: tgtCue, kind: 'tgtOnly' });
          tgtMatched.add(j);
          j++;
        }
      } else if (srcCue) {
        segments.push({ startTime: srcCue.startTime, endTime: srcCue.endTime || srcCue.startTime, src: srcCue, tgt: null, kind: 'srcOnly' });
        i++;
      } else {
        // remaining unmatched targets
        segments.push({ startTime: tgtCue.startTime, endTime: tgtCue.endTime || tgtCue.startTime, src: null, tgt: tgtCue, kind: 'tgtOnly' });
        tgtMatched.add(j);
        j++;
      }
    }
    segments.sort(function(a, b) { return a.startTime - b.startTime; });
    return segments;
  }

  /**
   * Find an existing capture by timestamp (matches either source or target-only time)
   */
  function findExistingCaptureByTime(time) {
    if (!translator) return null;

    const allCaptures = translator.getCaptures();
    for (let i = 0; i < allCaptures.length; i++) {
      const c = allCaptures[i];
      if (typeof c.videoTime === 'number' && Math.abs(c.videoTime - time) < 1.0) {
        return c;
      }
    }
    return null;
  }

  const SRC_ONLY_TEXT = '（无目标字幕）';
  const TGT_ONLY_TEXT = '（无源字幕）';

  /**
   * Load bilingual subtitles (source + target) into the panel.
   * Uses a two-way merge so source-only AND target-only segments are both kept.
   */
  function loadBilingualSubtitles() {
    if (!subtitleApi || !translator || !db || !videoId) return;
    if (!config.user.useOfficialSubtitles) return;

    const srcLang = config.user.officialSourceLang;
    const tgtLang = config.user.officialTargetLang;

    if (!srcLang || !tgtLang) {
      LOG('Bilingual subtitles: source or target language not configured');
      return;
    }

    const srcCues = subtitleApi.getSubtitles(srcLang);
    const tgtCues = subtitleApi.getSubtitles(tgtLang);

    LOG('Bilingual subtitles: source=' + srcCues.length + ' target=' + tgtCues.length);

    if (srcCues.length === 0 && tgtCues.length === 0) {
      LOG('No subtitles captured yet - switch subtitle languages in Netflix menu first');
      return;
    }

    let addedCount = 0;
    const segments = pairCues(srcCues, tgtCues, 1.0);

    segments.forEach(function(seg) {
      let original, translation, videoTime, soloSide = null;

      if (seg.kind === 'pair') {
        original = seg.src.text;
        translation = seg.tgt.text;
        videoTime = seg.src.startTime;
      } else if (seg.kind === 'srcOnly') {
        original = seg.src.text;
        translation = SRC_ONLY_TEXT;
        videoTime = seg.src.startTime;
        soloSide = 'src';
      } else {
        // tgtOnly: heading is the target text; body notes missing source
        original = seg.tgt.text;
        translation = TGT_ONLY_TEXT;
        videoTime = seg.tgt.startTime;
        soloSide = 'tgt';
      }

      const existing = findExistingCaptureByTime(videoTime);
      if (existing) {
        let needUpdate = false;
        let headingChanged = false;
        let isPaired = false;
        if (seg.kind === 'pair') {
          isPaired = true;
          if (existing.tgtOnly && !existing.srcOnly) {
            existing.original = seg.src.text;
            existing.translation = seg.tgt.text;
            headingChanged = true;
            needUpdate = true;
          } else if (!existing.translation || existing.translation === SRC_ONLY_TEXT || existing.translation === TGT_ONLY_TEXT || existing.status !== 'ok') {
            existing.translation = translation;
            needUpdate = true;
          }
          existing.status = 'ok';
          existing.isOfficial = true;
          existing.srcOnly = false;
          existing.tgtOnly = false;
          soloSide = null;
        } else if (seg.kind === 'srcOnly' && (!existing.translation || existing.translation === '' || existing.translation === TGT_ONLY_TEXT)) {
          existing.translation = SRC_ONLY_TEXT;
          existing.status = 'ok';
          existing.isOfficial = true;
          existing.srcOnly = true;
          existing.tgtOnly = false;
          needUpdate = true;
        } else if (seg.kind === 'tgtOnly' && (!existing.original || existing.original === '')) {
          existing.original = original;
          existing.translation = TGT_ONLY_TEXT;
          existing.status = 'ok';
          existing.isOfficial = true;
          existing.tgtOnly = true;
          existing.srcOnly = false;
          needUpdate = true;
        }
        // Always make sure isOfficial / solo badges reflect the current segment
        // state, even if the translation text itself did not change (covers the
        // DB-reload case where entries don't carry flags from storage).
        if (existing.dl && existing.isOfficial && existing.translation) {
          var dlClasses = existing.dl.classList;
          var alreadyApplied = dlClasses.contains('nst-official') && dlClasses.contains('sent-tr-open');
          // Only re-render DD content if heading changed, translation changed,
          // or the official badge hasn't been applied yet.
          var dd = existing.dl.querySelector('dd');
          var textNeedsApply = needUpdate || headingChanged || !alreadyApplied ||
            !dd || dd.getAttribute('data-nst-applied') !== existing.translation;
          if (headingChanged) {
            subtitlesUI.replaceHeading(existing.dl, existing.original);
          }
          if (textNeedsApply) {
            subtitlesUI.applyTranslation(existing.dl, existing.translation, true);
            if (dd) dd.setAttribute('data-nst-applied', existing.translation);
          }
          subtitlesUI.markSolo(existing.dl, soloSide);
        } else if (needUpdate && existing.dl) {
          if (headingChanged) {
            subtitlesUI.replaceHeading(existing.dl, existing.original);
          }
          subtitlesUI.applyTranslation(existing.dl, existing.translation, true);
          var dd2 = existing.dl.querySelector('dd');
          if (dd2) dd2.setAttribute('data-nst-applied', existing.translation);
          subtitlesUI.markSolo(existing.dl, soloSide);
        }
        if (needUpdate) {
          db.recordSubtitle(videoId, videoTime, existing.original, existing.translation, 'ok');
        }
        return;
      }

      const entry = {
        original: original,
        translation: translation,
        ts: Date.now(),
        videoTime: videoTime,
        dl: null,
        isOfficial: true,
        status: 'ok',
        srcOnly: seg.kind === 'srcOnly',
        tgtOnly: seg.kind === 'tgtOnly'
      };

      translator.addCapture(entry);

      if (subtitlesUI) {
        entry.dl = subtitlesUI.add(entry.original, entry.videoTime);
        subtitlesUI.setCurrent(entry.dl);
        subtitlesUI.applyTranslation(entry.dl, entry.translation, true);
        subtitlesUI.markSolo(entry.dl, soloSide);
      }

      if (db) {
        db.recordSubtitle(videoId, videoTime, entry.original, entry.translation, 'ok');
      }

      addedCount++;
    });

    LOG('Added', addedCount, 'bilingual segments to panel (paired + source-only + target-only)');
  }

  /**
   * Read subtitle and handle it
   */
  function readAndHandle(subtitleContainer) {
    if (wait) return;
    wait = true;

    setTimeout(function() {
      wait = false;

      const subtitle = subtitleReader ? subtitleReader.extractSubtitle(subtitleContainer) : '';

      // Empty subtitle - just leave the current highlight
      if (!subtitle) return;

      // Same subtitle as before and not in non-linear mode - skip
      if (subtitle === subtitleBefore && !window.__nstNonLinear) return;

      LOG('subtitle:', subtitle);
      const vt = player ? player.getVideoTime() : null;

      // Check if we already have this subtitle
      const dup = translator ? translator.findExistingCapture(subtitle, vt) : null;
      if (dup) {
        LOG('subtitle is duplicate of capture vt=', dup.videoTime, '— moving highlight to existing row');
        const dl = subtitlesUI ? subtitlesUI.findDlByCapture(dup) : null;
        if (subtitlesUI) subtitlesUI.setCurrent(dl);
        if (dl) {
          // Use the smarter scroll that doesn't move if already visible
          subtitlesUI.scroll(dl, false);
        }
        // If we already have a translation, show it in the center overlay
        if (dup.translation && centerTranslator && centerTranslator.showTranslation) {
          centerTranslator.showTranslation(dup.translation);
        }
        subtitleBefore = subtitle;

        // Make sure this subtitle is saved to database (in case it was missing)
        if (db && videoId && typeof vt === 'number') {
          const status = dup.translation && dup.translation.trim() ? 'ok' : 'pending';
          db.recordSubtitle(videoId, vt, subtitle, dup.translation || null, status);
        }
        return;
      }

      // Create new entry
      const entry = {
        original: subtitle,
        translation: '',
        ts: Date.now(),
        videoTime: vt,
        dl: null
      };

      if (translator) translator.addCapture(entry);
      if (centerTranslator) centerTranslator.init(subtitle, subtitleContainer);

      // Add to UI
      if (subtitlesUI) {
        entry.dl = subtitlesUI.add(subtitle, vt);
        subtitlesUI.setCurrent(entry.dl);
      }

      subtitleBefore = subtitle;

      // Immediately save subtitle to database (even before translation!)
      if (db && videoId && typeof vt === 'number') {
        // Save with pending status, or ok if we already have a translation
        const status = entry.translation && entry.translation.trim() ? 'ok' : 'pending';
        db.recordSubtitle(videoId, vt, subtitle, entry.translation || null, status);
      }

      // Auto-translate
      if (translator) {
        translator.autoTranslate(subtitle, entry);
      }
    }, 100);
  }

  /**
   * Main run function - called when we detect the subtitle container
   */
  function run(subtitleContainer) {
    LOG('run() starting — player + controls detected');
    launched = true;

    if (config && config.getOptions) config.getOptions();
    if (pause) pause.setEvent();

    // Link subtitles UI with translate panel for word clicks
    if (subtitlesUI && translatePanel) {
      subtitlesUI.setTranslatePanel(translatePanel);
    }

    videoId = player ? player.getNetflixVideoId() : null;
    LOG('Netflix videoId =', videoId);

    // Set current video ID - clears old captures if switching
    if (translator && translator.setCurrentVideoId) {
      translator.setCurrentVideoId(videoId);
    }

    // Upsert video in DB
    if (videoId && db && player) {
      db.upsertVideo(
        videoId,
        player.getCanonicalWatchUrl(),
        player.getNetflixTitle(),
        config.user.srcLang || 'auto',
        config.user.lang || 'en'
      );
    }

    // Load pre-existing subtitles
    if (videoId && translator) {
      translator.loadVideoSubtitles(videoId, function(entries) {
        if (!entries || !entries.length) {
          LOG('nstDB: no prior subtitles for video', videoId);
        } else {
          LOG('nstDB: preloading', entries.length, 'subtitles for video', videoId);

          entries.forEach(function(entry) {
            // The entries are already created by translator.loadVideoSubtitles
            // Just add them to captures and UI
            translator.addCapture(entry);

            // Add to UI
            if (subtitlesUI) {
              // Use the returned dl element directly instead of searching for it
              entry.dl = subtitlesUI.add(entry.original, entry.videoTime);
              // Apply translation if we have it
              if (entry.translation && entry.dl) {
                subtitlesUI.applyTranslation(entry.dl, entry.translation);
              }
            }
          });

          // Retry missing translations
          if (translator) {
            translator.retryMissingTranslations();
          }
        }

        // Also try to load any official Netflix subtitles we have captured
        loadOfficialSubtitles();
      });
    }

    // Try to capture official subtitles after a short delay
    setTimeout(function() {
      triggerOfficialSubtitleCapture();
    }, 3000);

    // Set up mutation observer on subtitle container
    try {
      const mo = new MutationObserver(function() { readAndHandle(subtitleContainer); });
      mo.observe(subtitleContainer, { childList: true, subtree: true, characterData: true });
      LOG('MutationObserver attached to .player-timedtext');
    } catch(e) {
      const WARN = NST.utils ? NST.utils.WARN : function() {};
      WARN('MutationObserver failed:', e && e.message);
    }

    // Also poll periodically as a fallback
    setInterval(function() { readAndHandle(subtitleContainer); }, 500);
  }

  /**
   * Poll for the Netflix subtitle container
   */
  function pollForSubtitles() {
    let pollTick = 0;
    const intv = setInterval(function() {
      const item = document.querySelector('.player-timedtext');
      pollTick++;

      if (pollTick % 5 === 0) {
        LOG('poll: .player-timedtext=', !!item, ' launched=', launched);
      }

      if (item) {
        if (!launched) {
          run(item);
        }
      } else {
        launched = false;
        if (subtitlesUI) subtitlesUI.clearAll();
      }
    }, 1000);
  }

  /**
   * Initialize everything
   */
  function init() {
    // Create the UI panel first
    if (panel) {
      panel.createTapeWrap();
      panel.restorePanelOpen();
      panel.setupKeyboardShortcut();
      panel.setupFullscreenSync();
    }

    // Set up clear DB function
    setupClearSubtitleDB();

    // Expose captures on window for backwards compatibility
    if (translator) {
      window.__nstCaptures = translator.getCaptures();
    }

    // Save database before page unload
    window.addEventListener('beforeunload', function() {
      if (db && db.saveNow) {
        // Try to save synchronously if possible
        try {
          db.saveNow();
        } catch(e) {}
      }
    });

    // Listen for subtitle data from the subtitle API
    window.addEventListener('message', function(ev) {
      if (ev.source !== window || !ev.data) return;

      if (ev.data.__nst === 'all-subtitle-cues' || ev.data.__nst === 'subtitle-cue') {
        LOG('Got subtitle cue data for', ev.data.language);
      }
    });

    // Listen for official subtitle updates
    window.addEventListener('nst-official-subtitles-updated', function(ev) {
      if (config.user.useOfficialSubtitles) {
        LOG('Official subtitles updated for', ev.detail.language, '- reloading bilingual pairs');
        loadBilingualSubtitles();
      }
    });

    // Start polling
    pollForSubtitles();

    // Start TTML-driven overlay so target-only captions (on-screen text,
    // signs, letters) appear even when Netflix renders no native source cue.
    if (ttmlOverlay && ttmlOverlay.start) {
      ttmlOverlay.start();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for debugging
  NST.main = {
    run: run,
    readAndHandle: readAndHandle,
    isLaunched: function() { return launched; }
  };

  /**
   * Message listener for communication with popup/background
   */
  chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
      try { console.log('[NST] message:', request); } catch(e){}

      if (request.buttonClick) {
        if (NST.ui && NST.ui.panel) NST.ui.panel.togglePanel();
      }

      if (request.exportOrg) {
        try {
          let result = (typeof window.__nstExportOrg === 'function') ? window.__nstExportOrg() : { ok: false, error: 'Extension not initialized on this page.' };
          sendResponse(result);
        } catch(e) {
          sendResponse({ ok: false, error: 'Export error: ' + (e && e.message) });
        }
        return true;
      }

      if (request.importOrg) {
        try {
          if (typeof window.__nstImportOrg === 'function') {
            // Try to get videoId from player module, or directly from URL as fallback
            let videoId = null;
            if (player && player.getNetflixVideoId) {
              videoId = player.getNetflixVideoId();
            }
            // Fallback: get from URL directly if player module isn't available
            if (!videoId) {
              const match = window.location.pathname.match(/\/watch\/(\d+)/);
              videoId = match ? match[1] : null;
            }
            if (!videoId) {
              sendResponse({ ok: false, error: 'Open a Netflix video first.' });
              return true;
            }
            window.__nstImportOrg(request.importOrg, videoId, sendResponse);
            return true; // Keep message channel open for async response
          } else {
            sendResponse({ ok: false, error: 'Extension not initialized on this page.' });
          }
        } catch(e) {
          sendResponse({ ok: false, error: 'Import error: ' + (e && e.message) });
        }
        return true;
      }

      if (request.clearSubtitleDB) {
        try {
          if (typeof window.__nstClearSubtitleDB === 'function') {
            window.__nstClearSubtitleDB(sendResponse);
            return true; // Keep message channel open for async response
          } else {
            sendResponse({ ok: false, error: 'Extension not initialized on this page.' });
          }
        } catch(e) {
          sendResponse({ ok: false, error: 'Clear error: ' + (e && e.message) });
        }
        return true;
      }

      if (request.updateOverlaySettings) {
        // Reload options and apply to overlay
        if (config && config.getOptions) {
          config.getOptions(function() {
            if (centerTranslator && centerTranslator.applySettings) {
              centerTranslator.applySettings();
            }
            // If official subtitles settings changed, re-trigger capture
            if (config.user.useOfficialSubtitles) {
              triggerOfficialSubtitleCapture();
            }
          });
        }
      }

      if (request.getAvailableLanguages) {
        // Return available and captured languages
        const languages = subtitleApi ? subtitleApi.getAvailableLanguages() : [];
        const captured = subtitleApi ? subtitleApi.getCapturedCounts() : {};
        sendResponse({ languages: languages, captured: captured });
        return true;
      }

      if (request.captureLanguage) {
        // Trigger capture for a specific language
        if (subtitleApi) {
          subtitleApi.captureLanguage(request.captureLanguage);
          // After a delay, check if we should load bilingual subtitles
          if (config.user.useOfficialSubtitles) {
            setTimeout(loadBilingualSubtitles, 2000);
          }
        }
        sendResponse({ ok: true });
        return true;
      }

      if (request.getAIPayload) {
        // Build and return the AI optimization payload (org text + raw TTML + meta)
        try {
          const payload = (exportModule && exportModule.buildAIPayload)
            ? exportModule.buildAIPayload()
            : (typeof window.__nstBuildAIPayload === 'function' ? window.__nstBuildAIPayload() : null);
          if (!payload) {
            sendResponse({ ok: false, error: 'Export module not ready.' });
          } else {
            sendResponse({ ok: true, payload: payload });
          }
        } catch(e) {
          sendResponse({ ok: false, error: 'AI payload error: ' + (e && e.message) });
        }
        return true;
      }

      if (request.importAIResult) {
        // Import AI-optimized org text back into the panel/DB (same flow as file import)
        try {
          let vid = videoId;
          if (!vid && player && player.getNetflixVideoId) {
            vid = player.getNetflixVideoId();
          }
          if (!vid) {
            const match = window.location.pathname.match(/\/watch\/(\d+)/);
            vid = match ? match[1] : null;
          }
          if (!vid) {
            sendResponse({ ok: false, error: 'Open a Netflix video first.' });
            return true;
          }
          if (typeof window.__nstImportOrg === 'function') {
            window.__nstImportOrg(request.importAIResult, vid, sendResponse);
          } else {
            sendResponse({ ok: false, error: 'Extension not initialized on this page.' });
          }
        } catch(e) {
          sendResponse({ ok: false, error: 'AI import error: ' + (e && e.message) });
        }
        return true;
      }
    }
  );

})(window.NST = window.NST || {});
