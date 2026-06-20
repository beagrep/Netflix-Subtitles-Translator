/**
 * Netflix Subtitles Translator - Export Module
 * Handles exporting subtitles to Org-mode format.
 */
(function(NST) {
  'use strict';

  const escOrgHeading = NST.utils ? NST.utils.escOrgHeading : function(s) { return s; };
  const safeFilename = NST.utils ? NST.utils.safeFilename : function() { return 'subtitles'; };
  const fmtTime = NST.utils ? NST.utils.fmtTime : function() { return ''; };
  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };

  const getNetflixTitle = NST.netflix && NST.netflix.player ? NST.netflix.player.getNetflixTitle : function() { return 'Netflix'; };
  const getCanonicalWatchUrl = NST.netflix && NST.netflix.player ? NST.netflix.player.getCanonicalWatchUrl : function() { return location.href; };

  const config = NST.config || { user: {} };
  const getCaptures = NST.translator ? NST.translator.getCaptures : function() { return []; };

  /**
   * Parse a time string like [M:SS], [MM:SS], [H:MM:SS], [HH:MM:SS] into seconds
   */
  function parseTimeStr(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(':').map(Number);
    // Check if all parts are valid numbers
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  }

  /**
   * Parse an org file content and extract subtitle entries
   */
  function parseOrgFile(content) {
    const entries = [];
    const lines = content.split(/\r?\n/);
    let inHeader = true;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip header lines (start with #+)
      if (inHeader && line.match(/^#\+/)) {
        i++;
        continue;
      }
      inHeader = false;

      // Check for a new heading (* Original subtitle)
      const headingMatch = line.match(/^\*\s+(.*?)\s*$/);
      if (headingMatch) {
        // Start collecting original subtitle lines
        const originalLines = [];
        let videoTime = null;

        // Add the first line (without the *)
        let firstLine = headingMatch[1].replace(/\\\*/g, '*');

        // Check if first line has a timestamp
        const firstLineTimeMatch = firstLine.match(/^(.*?)\s+\[([^\]]+)\]\s*$/);
        if (firstLineTimeMatch) {
          firstLine = firstLineTimeMatch[1];
          videoTime = parseTimeStr(firstLineTimeMatch[2]);
        }
        if (firstLine.trim()) {
          originalLines.push(firstLine);
        }

        i++; // Move past the heading line

        // Continue reading lines until we hit the next heading or find translation
        let translationStarted = false;
        const translationLines = [];

        while (i < lines.length) {
          const nextLine = lines[i];

          // Check if this is a new heading — stop if yes
          if (nextLine.match(/^\*\s+/)) {
            break;
          }

          // Check if we haven't found timestamp yet and this line has one
          if (!videoTime && !translationStarted) {
            const timeMatch = nextLine.match(/^(.*?)\s+\[([^\]]+)\]\s*$/);
            if (timeMatch) {
              // Found a timestamp on this line
              const textPart = timeMatch[1].replace(/\\\*/g, '*');
              if (textPart.trim()) {
                originalLines.push(textPart);
              }
              videoTime = parseTimeStr(timeMatch[2]);
              i++;
              continue;
            }
          }

          // If it's an empty line and we haven't started translation yet,
          // this might be the separator between original and translation
          if (!nextLine.trim() && !translationStarted && originalLines.length > 0) {
            translationStarted = true;
            i++;
            continue;
          }

          // If translation has started, or we already have a timestamp and
          // this isn't a heading, add to translation (or original if no
          // separator found yet but we have a timestamp)
          if (translationStarted || videoTime !== null) {
            translationStarted = true;
            translationLines.push(nextLine);
          } else {
            // No timestamp yet, still collecting original lines
            originalLines.push(nextLine.replace(/\\\*/g, '*'));
          }

          i++;
        }

        // Create the entry
        const entry = {
          original: originalLines.join('\n'),
          videoTime: videoTime !== null ? videoTime : 0, // Fallback to 0 if no timestamp found
          translation: translationLines.join('\n').trim()
        };
        entries.push(entry);
        continue;
      }

      i++;
    }

    return entries;
  }

  /**
   * Import subtitles from org file content and update DB
   */
  function importOrg(content, videoId, callback) {
    const db = NST.db || null;
    const translator = NST.translator || null;
    const subtitlesUI = NST.ui ? NST.ui.subtitles : null;
    const player = NST.netflix && NST.netflix.player ? NST.netflix.player : null;

    if (!db || !videoId) {
      if (callback) callback({ ok: false, error: 'DB not available or no video ID' });
      return;
    }

    db.whenReady(function() {
      try {
        const entries = parseOrgFile(content);
        LOG('Import: parsed', entries.length, 'entries from org file');

        if (!entries.length) {
          if (callback) callback({ ok: false, error: 'No subtitle entries found in file' });
          return;
        }

        // Update each entry in the DB and cache
        let updated = 0;
        entries.forEach(function(entry) {
          if (!entry.original) return;

          // First, try to find existing entries by exact match (time + original)
          // But if we don't find an exact match, still update just in case
          const vt = entry.videoTime !== null && isFinite(entry.videoTime) ? entry.videoTime : 0;

          // Update the subtitles table for the current video
          if (db.updateSubtitleTranslation) {
            db.updateSubtitleTranslation(videoId, vt, entry.original, entry.translation);
          } else {
            db.recordSubtitle(videoId, vt, entry.original, entry.translation, 'ok');
          }

          // Also update the translation cache
          const src = config.user.srcLang || 'auto';
          const tgt = config.user.lang || 'en';
          db.setCachedTranslation(src, tgt, entry.original, entry.translation);

          updated++;
        });

        // Now, reload all subtitles from DB for this video
        if (translator && subtitlesUI) {
          // Clear current captures and UI
          translator.clearCaptures();
          subtitlesUI.clearAll();
          // Make sure currentVideoId is set correctly
          if (translator.setCurrentVideoId) {
            translator.setCurrentVideoId(videoId);
          }
          // Load from DB
          translator.loadVideoSubtitles(videoId, function(loadedEntries) {
            if (loadedEntries && loadedEntries.length) {
              LOG('Import: reloading', loadedEntries.length, 'entries from DB');
              loadedEntries.forEach(function(capture) {
                translator.addCapture(capture);
                // Add to UI
                const dl = subtitlesUI.add(capture.original, capture.videoTime);
                capture.dl = dl;
                // Apply translation if available
                if (capture.translation) {
                  subtitlesUI.applyTranslation(dl, capture.translation);
                }
              });
            }
          });
        }

        // Force a DB save
        db.scheduleSave();

        LOG('Import: updated', updated, 'entries');
        if (callback) callback({ ok: true, count: updated, entries: entries });
      } catch(e) {
        WARN('Import failed:', e);
        if (callback) callback({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  /**
   * Build the Org-mode export content
   */
  function buildOrgExport() {
    const now = new Date();
    const title = getNetflixTitle();
    const url = getCanonicalWatchUrl();
    const getCapturesForCurrentVideo = NST.translator ? NST.translator.getCapturesForCurrentVideo : null;
    const captures = getCapturesForCurrentVideo ? getCapturesForCurrentVideo() : getCaptures();

    let header = '';
    header += '#+TITLE: ' + title + '\n';
    header += '#+DATE: ' + now.toISOString() + '\n';
    header += '#+URL: ' + url + '\n';
    header += '#+SOURCE_LANG: ' + (config.user.srcLang || 'auto') + '\n';
    header += '#+TARGET_LANG: ' + (config.user.lang || 'en') + '\n';
    header += '#+SUBTITLE_COUNT: ' + captures.length + '\n\n';

    const body = captures.map(function(c) {
      const vt = (typeof c.videoTime === 'number' && isFinite(c.videoTime)) ? ' [' + fmtTime(c.videoTime) + ']' : '';
      return '* ' + escOrgHeading(c.original) + vt + '\n\n' + (c.translation || '') + '\n';
    }).join('\n');

    return header + body;
  }

  /**
   * Export subtitles and trigger download
   */
  function exportOrg() {
    // Save database first to ensure everything is persisted
    if (NST.db && NST.db.saveNow) {
      try { NST.db.saveNow(); } catch(e) {}
    }

    const getCapturesForCurrentVideo = NST.translator ? NST.translator.getCapturesForCurrentVideo : null;
    const captures = getCapturesForCurrentVideo ? getCapturesForCurrentVideo() : getCaptures();
    if (!captures.length) return { ok: false, error: 'No subtitles captured yet.' };

    const text = buildOrgExport();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFilename(getNetflixTitle()) + '-' + new Date().toISOString().replace(/[:.]/g,'-') + '.org';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    return { ok: true, count: captures.length };
  }

  // Expose on window for backwards compatibility
  window.__nstExportOrg = exportOrg;
  window.__nstImportOrg = importOrg;

  // Export public API
  NST.export = {
    buildOrgExport: buildOrgExport,
    exportOrg: exportOrg,
    parseOrgFile: parseOrgFile,
    importOrg: importOrg
  };

})(window.NST = window.NST || {});
