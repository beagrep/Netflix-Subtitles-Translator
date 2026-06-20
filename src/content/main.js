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
  const translatePanel = NST.ui ? NST.ui.translatePanel : null;
  const player = NST.netflix ? NST.netflix.player : null;
  const subtitleReader = NST.netflix ? NST.netflix.subtitles : null;
  const translator = NST.translator || null;
  const exportModule = NST.export || null;

  // State
  let launched = false;
  let subtitleBefore = '';
  let wait = false;

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

    const videoId = player ? player.getNetflixVideoId() : null;
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
          return;
        }
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
      });
    }

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

    // Start polling
    pollForSubtitles();
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
          });
        }
      }
    }
  );

})(window.NST = window.NST || {});
