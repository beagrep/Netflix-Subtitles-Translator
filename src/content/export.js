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

  // Placeholder bodies used for source-only / target-only segments.
  const SRC_ONLY_TEXT = '（无目标字幕）';
  const TGT_ONLY_TEXT = '（无源字幕）';

  /**
   * Parse a time string like [M:SS], [MM:SS], [H:MM:SS], [HH:MM:SS] into seconds
   */
  function parseTimeStr(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  }

  /**
   * Strip org tags (" :TAG1::TAG2:") from the end of a heading line and
   * return { text, tags: [] }.
   */
  function stripOrgTags(line) {
    // Org tags are a colon-separated list at the end: whitespace then
    // ":TAG1:TAG2:..:" at end of line.
    const m = line.match(/^(.*?)\s+:([A-Za-z0-9_@#%:-]+):\s*$/);
    if (!m) return { text: line, tags: [] };
    return { text: m[1], tags: m[2].split(':').filter(Boolean) };
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

      if (inHeader && line.match(/^#\+/)) {
        i++;
        continue;
      }
      inHeader = false;

      const headingMatch = line.match(/^\*\s+(.*?)\s*$/);
      if (headingMatch) {
        const originalLines = [];
        let videoTime = null;
        let tags = [];

        let firstLineRaw = headingMatch[1].replace(/\\\*/g, '*');
        // Strip org tags from first line before extracting timestamp
        const firstStripped = stripOrgTags(firstLineRaw);
        tags = firstStripped.tags;
        let firstLine = firstStripped.text;

        const firstLineTimeMatch = firstLine.match(/^(.*?)\s+\[([^\]]+)\]\s*$/);
        if (firstLineTimeMatch) {
          firstLine = firstLineTimeMatch[1];
          videoTime = parseTimeStr(firstLineTimeMatch[2]);
        }
        if (firstLine.trim()) {
          originalLines.push(firstLine);
        }

        i++;

        let translationStarted = false;
        const translationLines = [];

        while (i < lines.length) {
          const nextLine = lines[i];

          if (nextLine.match(/^\*\s+/)) {
            break;
          }

          if (!videoTime && !translationStarted) {
            const timeMatch = nextLine.match(/^(.*?)\s+\[([^\]]+)\]\s*$/);
            if (timeMatch) {
              const textPart = timeMatch[1].replace(/\\\*/g, '*');
              if (textPart.trim()) {
                originalLines.push(textPart);
              }
              videoTime = parseTimeStr(timeMatch[2]);
              i++;
              continue;
            }
          }

          if (!nextLine.trim() && !translationStarted && originalLines.length > 0) {
            translationStarted = true;
            i++;
            continue;
          }

          if (translationStarted || videoTime !== null) {
            translationStarted = true;
            translationLines.push(nextLine);
          } else {
            originalLines.push(nextLine.replace(/\\\*/g, '*'));
          }

          i++;
        }

        const originalText = originalLines.join('\n');
        const translationText = translationLines.join('\n').trim();

        const entry = {
          original: originalText,
          videoTime: videoTime !== null ? videoTime : 0,
          translation: translationText,
          isOfficial: tags.indexOf('OFFICIAL') !== -1,
          srcOnly: tags.indexOf('SRC_ONLY') !== -1,
          tgtOnly: tags.indexOf('TGT_ONLY') !== -1
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

        // Now reload the panel with the imported entries directly so that
        // isOfficial / srcOnly / tgtOnly flags survive the import (the DB
        // schema doesn't persist those flags yet).
        if (translator && subtitlesUI) {
          translator.clearCaptures();
          subtitlesUI.clearAll();
          if (translator.setCurrentVideoId) {
            translator.setCurrentVideoId(videoId);
          }
          entries.forEach(function(entry) {
            const capture = {
              original: entry.original,
              translation: entry.translation || '',
              videoTime: entry.videoTime,
              ts: Date.now(),
              dl: null,
              isOfficial: !!entry.isOfficial,
              srcOnly: !!entry.srcOnly,
              tgtOnly: !!entry.tgtOnly,
              status: 'ok'
            };
            translator.addCapture(capture);
            const dl = subtitlesUI.add(capture.original, capture.videoTime);
            capture.dl = dl;
            let soloSide = null;
            if (capture.srcOnly) soloSide = 'src';
            else if (capture.tgtOnly) soloSide = 'tgt';
            subtitlesUI.applyTranslation(dl, capture.translation, capture.isOfficial);
            subtitlesUI.markSolo(dl, soloSide);
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
   * Helper to build org export from bilingual TTML data (complete video)
   */
  function buildOrgExportFromTTML() {
    if (!config.user.useOfficialSubtitles ||
        !config.user.officialSourceLang ||
        !config.user.officialTargetLang) {
      return null;
    }

    const subtitleApi = NST.netflix && NST.netflix.subtitleApi ? NST.netflix.subtitleApi : null;
    if (!subtitleApi) return null;

    const srcLang = config.user.officialSourceLang;
    const tgtLang = config.user.officialTargetLang;
    const srcCues = subtitleApi.getSubtitles(srcLang);
    const tgtCues = subtitleApi.getSubtitles(tgtLang);

    if (srcCues.length === 0 && tgtCues.length === 0) return null;

    // Use the same pairing logic as main.js
    function pairCues(srcCues, tgtCues, tolerance) {
      tolerance = (typeof tolerance === 'number') ? tolerance : 1.0;
      const segments = [];
      let i = 0, j = 0;
      const tgtMatched = new Set();

      while (i < srcCues.length || j < tgtCues.length) {
        const srcCue = i < srcCues.length ? srcCues[i] : null;
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
            while (j < tgtCues.length && (tgtMatched.has(j) || tgtCues[j] !== tgtCue)) j++;
            tgtMatched.add(j);
            i++; j++;
            continue;
          }
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
          segments.push({ startTime: tgtCue.startTime, endTime: tgtCue.endTime || tgtCue.startTime, src: null, tgt: tgtCue, kind: 'tgtOnly' });
          tgtMatched.add(j);
          j++;
        }
      }
      segments.sort(function(a, b) { return a.startTime - b.startTime; });
      return segments;
    }

    const segments = pairCues(srcCues, tgtCues, 1.0);

    const now = new Date();
    const title = getNetflixTitle();
    const url = getCanonicalWatchUrl();

    const officialCount = segments.filter(function(s) { return s.kind === 'pair'; }).length;
    const srcOnlyCount = segments.filter(function(s) { return s.kind === 'srcOnly'; }).length;
    const tgtOnlyCount = segments.filter(function(s) { return s.kind === 'tgtOnly'; }).length;

    let header = '';
    header += '#+TITLE: ' + title + '\n';
    header += '#+DATE: ' + now.toISOString() + '\n';
    header += '#+URL: ' + url + '\n';
    header += '#+SOURCE_LANG: ' + srcLang + '\n';
    header += '#+TARGET_LANG: ' + tgtLang + '\n';
    header += '#+SUBTITLE_COUNT: ' + segments.length + '\n';
    header += '#+OFFICIAL_SUBTITLES: ' + officialCount;
    if (srcOnlyCount || tgtOnlyCount) {
      header += ' (source-only=' + srcOnlyCount + ', target-only=' + tgtOnlyCount + ')';
    }
    header += '\n\n';

    const body = segments.map(function(seg) {
      let original, translation, videoTime, tags = '';
      if (seg.kind === 'pair') {
        original = seg.src.text;
        translation = seg.tgt.text;
        videoTime = seg.src.startTime;
        tags = ' :OFFICIAL:';
      } else if (seg.kind === 'srcOnly') {
        original = seg.src.text;
        translation = SRC_ONLY_TEXT;
        videoTime = seg.src.startTime;
        tags = ' :OFFICIAL:SRC_ONLY:';
      } else {
        original = seg.tgt.text;
        translation = TGT_ONLY_TEXT;
        videoTime = seg.tgt.startTime;
        tags = ' :OFFICIAL:TGT_ONLY:';
      }
      const vt = (typeof videoTime === 'number' && isFinite(videoTime)) ? ' [' + fmtTime(videoTime) + ']' : '';
      return '* ' + escOrgHeading(original) + vt + tags + '\n\n' + translation + '\n';
    }).join('\n');

    return header + body;
  }

  /**
   * Build the Org-mode export content
   */
  function buildOrgExport() {
    // First try to build from complete TTML data if we have official bilingual subtitles
    const fromTTML = buildOrgExportFromTTML();
    if (fromTTML) {
      return fromTTML;
    }

    // Fall back to captured data
    const now = new Date();
    const title = getNetflixTitle();
    const url = getCanonicalWatchUrl();
    const getCapturesForCurrentVideo = NST.translator ? NST.translator.getCapturesForCurrentVideo : null;
    const captures = getCapturesForCurrentVideo ? getCapturesForCurrentVideo() : getCaptures();

    const officialCount = captures.filter(function(c) { return c.isOfficial; }).length;
    const srcOnlyCount = captures.filter(function(c) { return c.srcOnly; }).length;
    const tgtOnlyCount = captures.filter(function(c) { return c.tgtOnly; }).length;

    const effectiveSrcLang = (config.user.useOfficialSubtitles && config.user.officialSourceLang)
      ? config.user.officialSourceLang : (config.user.srcLang || 'auto');
    const effectiveTgtLang = (config.user.useOfficialSubtitles && config.user.officialTargetLang)
      ? config.user.officialTargetLang : (config.user.lang || 'en');

    let header = '';
    header += '#+TITLE: ' + title + '\n';
    header += '#+DATE: ' + now.toISOString() + '\n';
    header += '#+URL: ' + url + '\n';
    header += '#+SOURCE_LANG: ' + effectiveSrcLang + '\n';
    header += '#+TARGET_LANG: ' + effectiveTgtLang + '\n';
    header += '#+SUBTITLE_COUNT: ' + captures.length + '\n';
    if (officialCount > 0) {
      header += '#+OFFICIAL_SUBTITLES: ' + officialCount;
      if (srcOnlyCount || tgtOnlyCount) {
        header += ' (source-only=' + srcOnlyCount + ', target-only=' + tgtOnlyCount + ')';
      }
      header += '\n';
    }
    header += '\n';

    const body = captures.map(function(c) {
      const vt = (typeof c.videoTime === 'number' && isFinite(c.videoTime)) ? ' [' + fmtTime(c.videoTime) + ']' : '';
      const tagParts = [];
      if (c.isOfficial) tagParts.push('OFFICIAL');
      if (c.srcOnly) tagParts.push('SRC_ONLY');
      if (c.tgtOnly) tagParts.push('TGT_ONLY');
      const tags = tagParts.length ? ' :' + tagParts.join(':') + ':' : '';
      let translation = c.translation || '';
      if (c.srcOnly && !translation) translation = SRC_ONLY_TEXT;
      if (c.tgtOnly && !translation) translation = TGT_ONLY_TEXT;
      return '* ' + escOrgHeading(c.original) + vt + tags + '\n\n' + translation + '\n';
    }).join('\n');

    return header + body;
  }

  /**
   * Build the payload for AI subtitle optimization:
   * { org, srcTTML, tgtTTML, title, url, srcLang, tgtLang }
   */
  function buildAIPayload() {
    const subtitleApi = NST.netflix && NST.netflix.subtitleApi ? NST.netflix.subtitleApi : null;
    const srcLang = (config.user.useOfficialSubtitles && config.user.officialSourceLang)
      ? config.user.officialSourceLang : (config.user.srcLang || 'auto');
    const tgtLang = (config.user.useOfficialSubtitles && config.user.officialTargetLang)
      ? config.user.officialTargetLang : (config.user.lang || 'en');

    return {
      org: buildOrgExport(),
      srcTTML: subtitleApi ? subtitleApi.getRawTTML(srcLang) : null,
      tgtTTML: subtitleApi ? subtitleApi.getRawTTML(tgtLang) : null,
      title: getNetflixTitle(),
      url: getCanonicalWatchUrl(),
      srcLang: srcLang,
      tgtLang: tgtLang
    };
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

  // Expose on window for backwards compatibility / message handlers
  window.__nstBuildAIPayload = buildAIPayload;

  // Export public API
  NST.export = {
    buildOrgExport: buildOrgExport,
    buildAIPayload: buildAIPayload,
    exportOrg: exportOrg,
    parseOrgFile: parseOrgFile,
    importOrg: importOrg,
    SRC_ONLY_TEXT: SRC_ONLY_TEXT,
    TGT_ONLY_TEXT: TGT_ONLY_TEXT
  };

})(window.NST = window.NST || {});
