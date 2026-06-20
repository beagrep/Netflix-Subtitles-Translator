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
   * Parse an org file content and extract subtitle entries
   */
  function parseOrgFile(content) {
    const entries = [];
    const lines = content.split(/\r?\n/);
    let currentEntry = null;
    let inHeader = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip header lines (start with #+)
      if (inHeader && line.match(/^#\+/)) {
        continue;
      }
      inHeader = false;

      // Check for a new heading (* Original subtitle [time])
      const headingMatch = line.match(/^\*\s+(.+?)(?:\s+\[([^\]]+)\])?\s*$/);
      if (headingMatch) {
        // Push previous entry if exists
        if (currentEntry) {
          entries.push(currentEntry);
        }
        // Start new entry
        const original = headingMatch[1].replace(/\\\*/g, '*'); // Unescape any escaped asterisks
        const timeStr = headingMatch[2];
        let videoTime = null;

        // Parse time string if present (MM:SS or HH:MM:SS)
        if (timeStr) {
          const parts = timeStr.split(':').map(Number);
          if (parts.length === 2) {
            videoTime = parts[0] * 60 + parts[1];
          } else if (parts.length === 3) {
            videoTime = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
        }

        currentEntry = {
          original: original,
          videoTime: videoTime,
          translation: ''
        };
        continue;
      }

      // If we have a current entry, accumulate translation text
      if (currentEntry) {
        // Skip empty lines at the start
        if (!line.trim() && !currentEntry.translation) {
          continue;
        }
        // Add to translation with newline (trim trailing newlines later)
        currentEntry.translation += (currentEntry.translation ? '\n' : '') + line;
      }
    }

    // Push the last entry
    if (currentEntry) {
      // Trim trailing whitespace from translation
      currentEntry.translation = currentEntry.translation.trim();
      entries.push(currentEntry);
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

          // Update in-memory capture if present
          if (translator) {
            const capture = translator.findExistingCapture(entry.original, entry.videoTime);
            if (capture) {
              capture.translation = entry.translation;
              capture.status = 'ok';
              if (capture.dl && subtitlesUI) {
                subtitlesUI.applyTranslation(capture.dl, entry.translation);
              }
            }
          }

          updated++;
        });

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
