/**
 * Netflix Subtitles Translator - Export Module
 * Handles exporting subtitles to Org-mode format.
 */
(function(NST) {
  'use strict';

  const escOrgHeading = NST.utils ? NST.utils.escOrgHeading : function(s) { return s; };
  const safeFilename = NST.utils ? NST.utils.safeFilename : function() { return 'subtitles'; };
  const fmtTime = NST.utils ? NST.utils.fmtTime : function() { return ''; };

  const getNetflixTitle = NST.netflix && NST.netflix.player ? NST.netflix.player.getNetflixTitle : function() { return 'Netflix'; };
  const getCanonicalWatchUrl = NST.netflix && NST.netflix.player ? NST.netflix.player.getCanonicalWatchUrl : function() { return location.href; };

  const config = NST.config || { user: {} };
  const getCaptures = NST.translator ? NST.translator.getCaptures : function() { return []; };

  /**
   * Build the Org-mode export content
   */
  function buildOrgExport() {
    const now = new Date();
    const title = getNetflixTitle();
    const url = getCanonicalWatchUrl();
    const captures = getCaptures();

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
    const captures = getCaptures();
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

  // Export public API
  NST.export = {
    buildOrgExport: buildOrgExport,
    exportOrg: exportOrg
  };

  // Expose on window for backwards compatibility
  window.__nstExportOrg = exportOrg;

})(window.NST = window.NST || {});
