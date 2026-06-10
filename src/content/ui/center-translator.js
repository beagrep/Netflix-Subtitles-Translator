/**
 * Netflix Subtitles Translator - Center Translator Module
 * Manages the overlay center translation display.
 */
(function(NST) {
  'use strict';

  const config = NST.config || {
    SELECTORS: {
      mainTranslateId: 'translate-ext-main-tr',
      mainTranslateOpenClass: 'open-bg-tr'
    },
    user: {}
  };

  const loadJson = NST.utils ? NST.utils.loadJson : function() {};
  const gtansUrl = NST.config ? NST.config.gtansUrl : function() { return ''; };

  let tmd = null;
  let currentSentence = null;

  /**
   * Get the center translator element
   */
  function getEl() {
    return document.getElementById(config.SELECTORS.mainTranslateId);
  }

  /**
   * Initialize with a sentence (set up click listeners on subtitle DOM)
   */
  function init(sentence, subtitleContainer) {
    currentSentence = sentence;
    // No longer setting up click listeners since the overlay is passive
    // (pointer-events: none in CSS)
  }

  /**
   * Translate a sentence and show in center overlay
   */
  function translate(sentence) {
    const elm = getEl();
    if (!elm) return;

    clear();

    loadJson(gtansUrl(sentence), function(data) {
      if (!data) return;

      let gtrans = '';
      data['sentences'].forEach(function(s) {
        gtrans += s.trans + ' ';
      });
      gtrans = gtrans.trim();

      if (gtrans !== '') {
        elm.textContent = gtrans;
        show();
      }
    });
  }

  /**
   * Show a translation directly (already translated)
   */
  function showTranslation(translation) {
    const elm = getEl();
    if (!elm || !translation) return;

    // Clear any existing
    clear();

    // Preserve line breaks in the display
    if (translation.indexOf('\n') >= 0) {
      elm.innerHTML = translation.replace(/\r?\n/g, '<br>');
    } else {
      elm.textContent = translation;
    }

    // Show it
    show();
  }

  /**
   * Show the center translator
   */
  function show() {
    const elm = getEl();
    if (!elm) return;

    elm.classList.add(config.SELECTORS.mainTranslateOpenClass);
    clearTimeout(tmd);

    const showsec = (typeof config.user.showsec === 'number') ? config.user.showsec : 5;
    tmd = setTimeout(function() {
      clear();
    }, showsec * 1000);
  }

  /**
   * Clear and hide the center translator
   */
  function clear() {
    const elm = getEl();
    if (!elm) return;

    elm.classList.remove(config.SELECTORS.mainTranslateOpenClass);
    elm.textContent = '';
    elm.innerHTML = '';
  }

  // Export public API
  NST.ui = NST.ui || {};
  NST.ui.centerTranslator = {
    init: init,
    translate: translate,
    showTranslation: showTranslation,
    show: show,
    clear: clear
  };

})(window.NST = window.NST || {});
