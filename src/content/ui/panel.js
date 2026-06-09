/**
 * Netflix Subtitles Translator - UI Panel Module
 * Creates and manages the main translation panel and resizing.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };

  const config = NST.config || {
    SELECTORS: {
      mainWrap: 'translate-ext',
      subtitleWrap: 'subtitle-wrap',
      translationWrap: 'translation-wrap',
      closeRightPanel: 'tr-close-x',
      imgWrap: 'img-tr-wrap',
      imgWrapTitle: 'img-tr-tile',
      descriptionWrap: 'describe-tr-wrap',
      descriptionTitle: 'describe-tr-title',
      mainTranslateId: 'translate-ext-main-tr'
    }
  };

  // Resize state
  let resizeState = {
    dragging: false,
    startX: 0,
    startW: 0,
    overlay: null
  };

  /**
   * Apply a width to the panel
   */
  function applyPanelWidth(px) {
    const S = config.SELECTORS;
    const frame = document.getElementById(S.mainWrap);
    if (!frame) return;
    const min = 200, max = Math.max(min, window.innerWidth - 100);
    if (px < min) px = min;
    if (px > max) px = max;
    frame.style.width = px + 'px';
    frame.style.maxWidth = 'none';
    frame.querySelectorAll(':scope > *').forEach(function(child) {
      if (child.id === 'translate-ext-resize-handle') return;
      child.style.width = px + 'px';
      child.style.minWidth = '0';
      child.style.maxWidth = 'none';
    });
    try {
      const sw = document.querySelector('.sizing-wrapper');
      if (sw && document.body.classList.contains('open-tr-panel')) {
        sw.style.width = 'calc(100vw - ' + px + 'px)';
      }
    } catch(e){}
  }

  /**
   * Create the drag overlay
   */
  function makeOverlay() {
    if (resizeState.overlay) return;
    resizeState.overlay = document.createElement('div');
    resizeState.overlay.id = 'nst-drag-overlay';
    resizeState.overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;cursor:ew-resize;background:transparent;';
    document.body.appendChild(resizeState.overlay);
  }

  /**
   * Remove the drag overlay
   */
  function killOverlay() {
    if (resizeState.overlay && resizeState.overlay.parentNode) {
      resizeState.overlay.parentNode.removeChild(resizeState.overlay);
    }
    resizeState.overlay = null;
  }

  /**
   * Mouse down handler for resize handle
   */
  function onResizeDown(e, frame) {
    if (e.button !== 0) return;
    resizeState.dragging = true;
    resizeState.startX = e.clientX;
    resizeState.startW = frame.getBoundingClientRect().width;
    document.body.style.userSelect = 'none';
    e.target.classList.add('nst-dragging');
    makeOverlay();
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Mouse move handler for resize (attached to window in capture phase)
   */
  function onResizeMove(e, frame) {
    if (!resizeState.dragging) return;
    const dx = e.clientX - resizeState.startX;
    applyPanelWidth(resizeState.startW + dx);
  }

  /**
   * Mouse up handler for resize
   */
  function onResizeUp(frame, handle) {
    if (!resizeState.dragging) return;
    resizeState.dragging = false;
    document.body.style.userSelect = '';
    if (handle) handle.classList.remove('nst-dragging');
    killOverlay();
    const w = Math.round(frame.getBoundingClientRect().width);
    try { chrome.storage.sync.set({ panelWidth: w }); } catch(_){}
  }

  /**
   * Setup resize functionality on the panel
   */
  function setupResize(frame, handle) {
    try {
      chrome.storage.sync.get({ panelWidth: 0 }, function(items) {
        if (items.panelWidth && items.panelWidth > 0) applyPanelWidth(items.panelWidth);
      });
    } catch(e){}

    // Bound event handlers
    const boundDown = function(e) { onResizeDown(e, frame); };
    const boundMove = function(e) { onResizeMove(e, frame); };
    const boundUp = function() { onResizeUp(frame, handle); };

    handle.addEventListener('mousedown', boundDown);
    window.addEventListener('mousemove', boundMove, true);
    window.addEventListener('mouseup', boundUp, true);
    window.addEventListener('blur', boundUp);
    document.addEventListener('mouseleave', boundUp);
  }

  /**
   * Create the main translation panel DOM
   */
  function createTapeWrap() {
    const S = config.SELECTORS;

    // Main frame
    const frameDiv = document.createElement('div');
    frameDiv.id = S.mainWrap;
    document.body.appendChild(frameDiv);

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.id = 'translate-ext-resize-handle';
    resizeHandle.title = 'Drag to resize panel';
    frameDiv.appendChild(resizeHandle);

    // Subtitle wrap
    const subDiv = document.createElement('div');
    subDiv.id = S.subtitleWrap;
    frameDiv.appendChild(subDiv);

    // Translation wrap (word translation panel)
    const wordDiv = document.createElement('div');
    wordDiv.id = S.translationWrap;
    frameDiv.appendChild(wordDiv);

    // Content for translation wrap
    wordDiv.innerHTML =
      '<div id="' + S.closeRightPanel + '"></div>' +
      '<div class="tr-title" id="' + S.descriptionTitle + '"></div>' +
      '<div id="' + S.descriptionWrap + '"></div>' +
      '<div class="tr-title" id="' + S.imgWrapTitle + '"></div>' +
      '<div id="' + S.imgWrap + '"></div>';

    // Center translator div (for overlay translations)
    const centerTranslateDiv = document.createElement('div');
    centerTranslateDiv.id = S.mainTranslateId;
    document.body.appendChild(centerTranslateDiv);

    // Setup resizing
    setupResize(frameDiv, resizeHandle);

    return {
      frame: frameDiv,
      subtitleWrap: subDiv,
      translationWrap: wordDiv,
      resizeHandle: resizeHandle,
      centerTranslate: centerTranslateDiv
    };
  }

  /**
   * Toggle the panel open/closed
   */
  function togglePanel() {
    const bdclist = document.body.classList;
    if (bdclist.contains('open-tr-panel')) {
      bdclist.remove('open-tr-panel');
    } else {
      bdclist.add('open-tr-panel');
      try {
        const sw = document.querySelector('#translate-ext #subtitle-wrap');
        if (sw) {
          requestAnimationFrame(function() { sw.scrollTop = sw.scrollHeight; });
        }
      } catch(e){}
    }
  }

  /**
   * Check if panel is open
   */
  function isPanelOpen() {
    return document.body.classList.contains('open-tr-panel');
  }

  // Export public API
  NST.ui = NST.ui || {};
  NST.ui.panel = {
    createTapeWrap: createTapeWrap,
    applyPanelWidth: applyPanelWidth,
    togglePanel: togglePanel,
    isPanelOpen: isPanelOpen
  };

})(window.NST = window.NST || {});
