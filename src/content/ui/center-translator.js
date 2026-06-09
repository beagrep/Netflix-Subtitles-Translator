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
  const pause = NST.ui ? NST.ui.pause : null;

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
    const elm = getEl();
    if (!elm) return;

    try {
      const containers = subtitleContainer.querySelectorAll('.player-timedtext-text-container');
      containers.forEach(function(elem) {
        elem.addEventListener('click', function() {
          translate(currentSentence);
        });
      });
    } catch(e){}
  }

  /**
   * Translate a sentence and show in center overlay
   */
  function translate(sentence) {
    const elm = getEl();
    if (!elm) return;

    clear();
    if (config.user.delay && pause) pause.stop();

    loadJson(gtansUrl(sentence), function(data) {
      if (!data) {
        if (config.user.delay && pause) pause.start();
        return;
      }

      data['sentences'].forEach(function(s) {
        elm.textContent += s.trans + ' ';
      });

      if (elm.textContent !== '') {
        show();
      } else if (config.user.delay && pause) {
        pause.start();
      }
    });
  }

  /**
   * Show the center translator
   */
  function show() {
    const elm = getEl();
    if (!elm) return;

    elm.classList.add(config.SELECTORS.mainTranslateOpenClass);
    clearTimeout(tmd);

    tmd = setTimeout(function() {
      clear();
      if (config.user.delay && pause) pause.start();
    }, config.user.showsec * 1000);
  }

  /**
   * Clear and hide the center translator
   */
  function clear() {
    const elm = getEl();
    if (!elm) return;

    elm.classList.remove(config.SELECTORS.mainTranslateOpenClass);
    elm.textContent = '';
  }

  // Export public API
  NST.ui = NST.ui || {};
  NST.ui.centerTranslator = {
    init: init,
    translate: translate,
    show: show,
    clear: clear
  };

})(window.NST = window.NST || {});
