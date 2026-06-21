/**
 * Netflix Subtitles Translator - TTML-driven overlay for target-only subtitles.
 *
 * When official bilingual subtitles are enabled, this module polls the video's
 * currentTime a few times per second and uses the captured TTML cues to show
 * target (translation) subtitles in the center overlay even when Netflix does
 * not render a source caption in the native .player-timedtext container.
 *
 * The typical case this covers is on-screen text (letters, signs, documents)
 * in K-dramas: Netflix does not emit a Korean caption for what is visible
 * on screen, but it does emit a Chinese/English translation caption.  Without
 * this module those target-only captions are invisible to our DOM-polling
 * path.
 *
 * This is intentionally an additive module.  It does NOT replace the existing
 * DOM/MutationObserver subtitle pipeline — that pipeline remains responsible
 * for highlighting panel rows, dual-cue translations (where both src and tgt
 * exist), Google Translate fallback, and word lookup.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST-TTML-OVL]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST-TTML-OVL]'].concat([].slice.call(arguments))); } catch(e){} };

  const config = NST.config || { user: {} };
  const player = NST.netflix ? NST.netflix.player : null;
  const subtitleApi = NST.netflix ? NST.netflix.subtitleApi : null;
  const centerTranslator = NST.ui ? NST.ui.centerTranslator : null;

  let tickHandle = null;
  let lastShownText = null;      // text we put in overlay ourselves
  let weAreShowing = false;      // overlay currently owned by us
  let lastOverlayText = '';

  // How often we sample currentTime.  250ms is responsive enough and cheap.
  const TICK_MS = 250;

  function isEnabled() {
    return !!(config.user && config.user.useOfficialSubtitles &&
              config.user.officialSourceLang && config.user.officialTargetLang);
  }

  /**
   * Returns true if Netflix currently has a visible native subtitle in
   * .player-timedtext.  We use this to decide whether to "take over" the
   * overlay for target-only content or leave it alone (the normal
   * readAndHandle path shows paired translations whenever DOM changes).
   */
  function isNativeSubtitleVisible() {
    const container = document.querySelector('.player-timedtext');
    if (!container) return false;
    // Netflix renders the text inside .player-timedtext-text-container children.
    const textContainers = container.querySelectorAll('.player-timedtext-text-container');
    for (let i = 0; i < textContainers.length; i++) {
      const el = textContainers[i];
      const style = el.ownerDocument.defaultView ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
      // Treat as invisible if display:none or opacity:0 or empty text.
      if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0)) continue;
      const text = (el.textContent || '').trim();
      if (text.length > 0) return true;
    }
    return false;
  }

  function activeCueAt(lang, t) {
    if (!subtitleApi) return null;
    const cues = subtitleApi.getSubtitles(lang);
    if (!cues) return null;
    // Find a cue whose [start, end] interval contains t.
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (t >= c.startTime && t <= (c.endTime || c.startTime + 3)) {
        return c;
      }
    }
    return null;
  }

  /**
   * Check whether a given source cue and target cue overlap (or start close)
   * — i.e. whether this target cue already has a matching source cue.
   */
  function hasMatchingSrc(tgtCue, srcCues) {
    if (!tgtCue || !srcCues) return false;
    for (let i = 0; i < srcCues.length; i++) {
      const s = srcCues[i];
      if (Math.abs(s.startTime - tgtCue.startTime) < 1.0) return true;
      if (s.startTime <= (tgtCue.endTime || tgtCue.startTime + 3) &&
          tgtCue.startTime <= (s.endTime || s.startTime + 3)) return true;
    }
    return false;
  }

  function overlayIsVisible() {
    var el = document.getElementById('translate-ext-main-tr');
    return !!(el && el.classList.contains('open-bg-tr') && el.textContent && el.textContent.trim().length > 0);
  }

  function clearOverlayIfOurs() {
    if (weAreShowing && centerTranslator && centerTranslator.clear) {
      centerTranslator.clear();
    }
    weAreShowing = false;
    lastShownText = null;
  }

  function showTargetOnly(text) {
    if (!centerTranslator) return;
    // If something else (center-translator auto-hide, another path) cleared
    // the element while we thought we were showing, force a re-render.
    if (lastShownText === text && weAreShowing && overlayIsVisible()) return;
    lastShownText = text;
    weAreShowing = true;
    // Add a small [译] prefix so users can tell this caption came from our
    // TTML overlay rather than Netflix or the DOM pipeline.
    const marked = '<span class="nst-overlay-prefix">[译]</span>' +
      text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
    // showTranslation accepts plain text but also HTML for our marker, so we
    // use the raw innerHTML path via a temporary element.  Simpler: call
    // showTranslation with the plain text then patch the prefix in.  But
    // centerTranslator exposes both textContent and innerHTML paths already,
    // so just send the marked HTML through showTranslationHtml if available,
    // else fall back to showTranslation with the text-only prefix.
    if (centerTranslator.showTranslationHtml) {
      centerTranslator.showTranslationHtml(marked);
    } else {
      centerTranslator.showTranslation('[译] ' + text);
    }
  }

  function tick() {
    if (!isEnabled()) {
      clearOverlayIfOurs();
      return;
    }
    if (!player || typeof player.getVideoTime !== 'function') return;

    const t = player.getVideoTime();
    if (typeof t !== 'number' || !isFinite(t)) return;

    const srcLang = config.user.officialSourceLang;
    const tgtLang = config.user.officialTargetLang;

    const srcCue = activeCueAt(srcLang, t);
    const tgtCue = activeCueAt(tgtLang, t);

    // If a native Netflix source caption is currently on screen OR we have
    // an active source cue from TTML, the normal DOM/MutationObserver path
    // will pair translation through translator.autoTranslate().  Let that
    // path drive the overlay — don't compete with it.
    if (srcCue || isNativeSubtitleVisible()) {
      clearOverlayIfOurs();
      return;
    }

    // No source cue active.  If we have a target cue active, show it as
    // target-only (covers on-screen-text translations).
    if (tgtCue && tgtCue.text && tgtCue.text.trim()) {
      // Defensive double-check: does this tgt cue actually lack a src match?
      const srcCues = subtitleApi.getSubtitles(srcLang);
      if (!hasMatchingSrc(tgtCue, srcCues)) {
        showTargetOnly(tgtCue.text);
        return;
      }
    }

    // No relevant cue.
    clearOverlayIfOurs();
  }

  function start() {
    if (tickHandle) return;
    LOG('TTML overlay started (target-only mode)');
    tickHandle = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    clearOverlayIfOurs();
  }

  // Expose public API
  NST.ui = NST.ui || {};
  NST.ui.ttmlOverlay = {
    start: start,
    stop: stop,
    _tick: tick,            // exposed for tests
    isNativeSubtitleVisible: isNativeSubtitleVisible
  };
})(window.NST = window.NST || {});
