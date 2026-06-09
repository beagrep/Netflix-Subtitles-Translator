/**
 * Netflix Subtitles Translator - Netflix Subtitle Reader Module
 * Handles extraction of subtitles from Netflix's DOM.
 */
(function(NST) {
  'use strict';

  // No need for LOG here, keep it simple

  /**
   * Extract subtitle text from the Netflix subtitle DOM element
   */
  function extractSubtitle(container) {
    if (!container) return '';

    const parts = [];
    try {
      const textContainers = container.querySelectorAll('.player-timedtext-text-container');
      if (textContainers.length) {
        textContainers.forEach(function(c) {
          const t = (c.textContent || '').trim();
          if (t) parts.push(t);
        });
      } else {
        const spans = container.querySelectorAll('span');
        spans.forEach(function(s) {
          const t = (s.textContent || '').trim();
          if (t && !parts.includes(t)) parts.push(t);
        });
      }
    } catch(e) {}

    let joined = parts.join(' ').replace(/\s+/g, ' ').trim();

    // Handle the case where Netflix duplicates the subtitle (sometimes seen)
    const halves = joined.length % 2 === 0 ? [joined.slice(0, joined.length/2), joined.slice(joined.length/2)] : null;
    if (halves && halves[0] === halves[1]) joined = halves[0];

    return joined;
  }

  // Export public API
  NST.netflix = NST.netflix || {};
  NST.netflix.subtitles = {
    extractSubtitle: extractSubtitle
  };

})(window.NST = window.NST || {});
