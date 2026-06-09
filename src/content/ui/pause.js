/**
 * Netflix Subtitles Translator - Pause/Play Module
 * Handles interaction with Netflix's play/pause controls.
 */
(function(NST) {
  'use strict';

  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };

  /**
   * Set up click listener on player controls row
   */
  function setEvent(toggleCallback) {
    try {
      const row = document.querySelector('.PlayerControlsNeo__button-control-row');
      if (!row) {
        WARN('pause.setEvent: no .PlayerControlsNeo__button-control-row (Netflix DOM changed)');
        return;
      }
      row.addEventListener('click', function(e) {
        if (e.y > 190) { return false; }
        if (toggleCallback) toggleCallback();
      }, false);
    } catch(e) { WARN('pause.setEvent error:', e && e.message); }
  }

  /**
   * Click the play button
   */
  function start() {
    try {
      const btn = document.querySelector('.button-nfplayerPlay');
      if (btn) btn.click();
    } catch(e){}
  }

  /**
   * Click the pause button
   */
  function stop() {
    try {
      const btn = document.querySelector('.button-nfplayerPause');
      if (btn) btn.click();
    } catch(e){}
  }

  /**
   * Toggle play/pause
   */
  function toggle() {
    try {
      const pauseBtn = document.querySelector('.button-nfplayerPause');
      if (pauseBtn) {
        pauseBtn.click();
      } else {
        const playBtn = document.querySelector('.button-nfplayerPlay');
        if (playBtn) playBtn.click();
      }
    } catch(e){}
  }

  // Export public API
  NST.ui = NST.ui || {};
  NST.ui.pause = {
    setEvent: setEvent,
    start: start,
    stop: stop,
    toggle: toggle
  };

})(window.NST = window.NST || {});
