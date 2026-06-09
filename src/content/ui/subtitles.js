/**
 * Netflix Subtitles Translator - Subtitles UI Module
 * Manages the subtitle list display and interaction.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const fmtTime = NST.utils ? NST.utils.fmtTime : function() { return ''; };

  const config = NST.config || {
    SELECTORS: {
      mainWrap: 'translate-ext',
      subtitleWrap: 'subtitle-wrap',
      translatedSentence: 'sent-tr-open'
    },
    user: {}
  };

  // Store last inserted DL reference
  let lastInsertedDl = null;

  // Translate panel reference (for word translation)
  let translatePanel = null;

  /**
   * Get the subtitle wrap element
   */
  function getSubtitleWrap() {
    const S = config.SELECTORS;
    return document.querySelector('#' + S.mainWrap + ' #' + S.subtitleWrap);
  }

  /**
   * Scroll the panel appropriately based on current state
   */
  function scroll(insertedDl) {
    const S = config.SELECTORS;
    const elm = getSubtitleWrap();
    if (!elm) return;

    const panelOpen = document.body.classList.contains('open-tr-panel');
    if (!panelOpen) {
      if (elm.offsetHeight + elm.scrollTop + 150 > elm.scrollHeight) {
        elm.scrollBy(0, 300);
      }
      return;
    }

    const isLast = insertedDl && insertedDl === elm.lastElementChild;
    if (insertedDl && (window.__nstNonLinear || !isLast)) {
      try {
        insertedDl.scrollIntoView({ block: 'center' });
      } catch(_) {
        elm.scrollTop = Math.max(0, insertedDl.offsetTop - elm.clientHeight/2);
      }
      return;
    }
    elm.scrollTop = elm.scrollHeight;
  }

  /**
   * Scroll a specific subtitle element into view
   */
  function scrollSubtitleDlIntoView(dl) {
    const S = config.SELECTORS;
    const sw = getSubtitleWrap();
    if (!dl || !sw || !document.body.classList.contains('open-tr-panel')) return;
    try {
      dl.scrollIntoView({ block: 'center' });
    } catch(_) {
      sw.scrollTop = Math.max(0, dl.offsetTop - sw.clientHeight/2);
    }
  }

  /**
   * Set the current subtitle highlight
   */
  function setCurrent(dl) {
    const S = config.SELECTORS;
    const wrap = getSubtitleWrap();
    if (!wrap) return;
    const prev = wrap.querySelectorAll('dl.nst-current');
    prev.forEach(function(p) { if (p !== dl) p.classList.remove('nst-current'); });
    if (dl) dl.classList.add('nst-current');
  }

  /**
   * Set current highlight using capture entry
   */
  function setCurrentFromCapture(capture) {
    const dl = findDlByCapture(capture);
    setCurrent(dl);
    return dl;
  }

  /**
   * Process a subtitle line to wrap words in spans for translation
   */
  function processLineForDisplay(line) {
    return line.replace(/([a-z'\-]+)/gi, '<span>$1</span>');
  }

  /**
   * Add a subtitle to the panel
   */
  function add(subtitle, videoTime) {
    const S = config.SELECTORS;
    const ts = (typeof videoTime === 'number' && isFinite(videoTime)) ? videoTime : null;
    const tsAttr = ts !== null ? ' data-vt="' + ts.toFixed(3) + '"' : '';
    const tsLabel = ts !== null ? '<time class="nst-ts" title="Click (or double-click the line) to jump to ' + fmtTime(ts) + '">' + fmtTime(ts) + '</time> ' : '';

    // Split subtitle by newlines and process each line, then join with <br>
    const lines = subtitle.split(/\r?\n/);
    const processedLines = lines.map(processLineForDisplay);
    const displaySubtitle = processedLines.join('<br>');

    const html = '<dl' + tsAttr + '>' +
      '<dt>' + tsLabel + displaySubtitle + '</dt>' +
      '<dd></dd>' +
      '</dl>';

    const wrap = getSubtitleWrap();
    let insertedDl = null;

    if (ts !== null) {
      const existing = wrap.querySelectorAll('dl[data-vt]');
      let inserted = false;
      for (let i = 0; i < existing.length; i++) {
        const evt = parseFloat(existing[i].getAttribute('data-vt'));
        if (!isNaN(evt) && evt > ts) {
          existing[i].insertAdjacentHTML('beforebegin', html);
          insertedDl = existing[i].previousElementSibling;
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        wrap.insertAdjacentHTML('beforeend', html);
        insertedDl = wrap.lastElementChild;
      }
    } else {
      wrap.insertAdjacentHTML('beforeend', html);
      insertedDl = wrap.lastElementChild;
    }

    lastInsertedDl = insertedDl;
    addClickListner(insertedDl);
    scroll(insertedDl);

    return insertedDl;
  }

  /**
   * Apply a translation to a subtitle element
   */
  function applyTranslation(dl, translation) {
    const S = config.SELECTORS;
    if (!dl) {
      const wrap = getSubtitleWrap();
      dl = wrap.lastElementChild;
    }
    if (dl) {
      dl.classList.add(S.translatedSentence);
      const dd = dl.querySelector('dd');
      if (dd && typeof translation === 'string') {
        // Preserve line breaks in translation
        dd.innerHTML = translation.replace(/\r?\n/g, '<br>');
      }
    }

    const sw = getSubtitleWrap();
    if (!sw || !document.body.classList.contains('open-tr-panel')) return;

    const isLast = dl && dl === sw.lastElementChild;
    if (dl && (window.__nstNonLinear || !isLast)) {
      requestAnimationFrame(function() {
        try { dl.scrollIntoView({ block: 'center' }); } catch(_){}
      });
    } else {
      requestAnimationFrame(function() { sw.scrollTop = sw.scrollHeight; });
    }
  }

  /**
   * Find a DL element by capture entry
   */
  function findDlByCapture(capture) {
    if (capture && capture.dl && document.contains(capture.dl)) return capture.dl;
    if (!capture || typeof capture.videoTime !== 'number') return null;

    const S = config.SELECTORS;
    const dls = document.querySelectorAll('#' + S.mainWrap + ' #' + S.subtitleWrap + ' dl[data-vt]');
    const want = capture.videoTime.toFixed(3);
    for (let i = 0; i < dls.length; i++) {
      if (dls[i].getAttribute('data-vt') === want) return dls[i];
    }
    return null;
  }

  /**
   * Clear all subtitles from the panel
   */
  function clearAll() {
    const wrap = getSubtitleWrap();
    if (wrap) wrap.innerHTML = '';
    lastInsertedDl = null;
  }

  /**
   * Add click listeners to a subtitle DL element
   */
  function addClickListner(targetDl) {
    if (!targetDl || targetDl.__nstWired) return;
    targetDl.__nstWired = true;

    targetDl.addEventListener('click', function(e) {
      if (e.target && (e.target.tagName === 'TIME' || (e.target.classList && e.target.classList.contains('nst-ts')))) {
        const dl = e.target.closest('dl');
        const vt = dl ? parseFloat(dl.getAttribute('data-vt')) : NaN;
        LOG('timestamp click vt=', vt);
        if (!isNaN(vt)) {
          e.preventDefault();
          e.stopPropagation();
          setCurrent(dl);
          scrollSubtitleDlIntoView(dl);
          if (NST.netflix && NST.netflix.player) {
            NST.netflix.player.seekVideo(vt);
          }
        }
        return;
      }
      clickedWordOrSent(e);
    });

    targetDl.addEventListener('dblclick', function(e) {
      const dl = e.target.closest('dl');
      if (!dl) return;
      const vt = parseFloat(dl.getAttribute('data-vt'));
      LOG('dblclick vt=', vt, 'target=', e.target && e.target.tagName);
      if (!isNaN(vt)) {
        e.preventDefault();
        e.stopPropagation();
        setCurrent(dl);
        scrollSubtitleDlIntoView(dl);
        if (NST.netflix && NST.netflix.player) {
          NST.netflix.player.seekVideo(vt);
        }
      }
    });
  }

  /**
   * Handle clicking on a word or sentence
   */
  function clickedWordOrSent(e) {
    if (e.target.nodeName === 'SPAN') {
      if (translatePanel) {
        translatePanel.start(e.target.textContent);
      } else if (NST.ui && NST.ui.translatePanel) {
        NST.ui.translatePanel.start(e.target.textContent);
      }
    } else {
      translateSentence(e.target);
    }
  }

  /**
   * Translate a full sentence
   */
  function translateSentence(el) {
    const S = config.SELECTORS;

    if (el.nodeName !== 'DL') while ((el = el.parentElement) && el.nodeName !== 'DL');
    if (!el) return;
    if (el.classList.contains(S.translatedSentence)) return;

    // Get the original sentence from the dt element
    const dt = el.querySelector('dt');
    if (!dt) return;

    // Extract the text (remove timestamp first if present)
    let sentence = dt.textContent || '';
    // Remove the leading timestamp like "6:08 " if present
    sentence = sentence.replace(/^\d+:\d+\s*/, '').trim();

    if (sentence === '') return;

    el.classList.add(S.translatedSentence);

    // If multi-line, split and translate each line separately
    const lines = sentence.split(/\r?\n/).filter(function(l) { return l.trim(); });

    if (lines.length <= 1 || !NST.utils || !NST.config) {
      // Single line or no utilities - simple path
      if (NST.utils && NST.config) {
        NST.utils.loadJson(NST.config.gtansUrl(sentence), function(data) {
          if (!data) return;
          let gtrans = '';
          data['sentences'].forEach(function(s) { gtrans += s.trans + ' '; });
          const dd = el.querySelector('dd');
          if (dd) dd.innerHTML = gtrans.trim().replace(/\r?\n/g, '<br>');
        });
      }
      return;
    }

    // Multi-line: translate each line
    const translatedLines = [];
    let completed = 0;

    lines.forEach(function(line, index) {
      NST.utils.loadJson(NST.config.gtansUrl(line), function(data) {
        if (!data) {
          translatedLines[index] = line;
        } else {
          let gtrans = '';
          data['sentences'].forEach(function(s) { gtrans += s.trans + ' '; });
          translatedLines[index] = gtrans.trim();
        }
        completed++;
        if (completed === lines.length) {
          const dd = el.querySelector('dd');
          if (dd) dd.innerHTML = translatedLines.join('<br>');
        }
      });
    });
  }

  /**
   * Set the translate panel reference (for word translation)
   */
  function setTranslatePanel(panel) {
    translatePanel = panel;
  }

  // Export public API
  NST.ui = NST.ui || {};
  NST.ui.subtitles = {
    add: add,
    scroll: scroll,
    scrollSubtitleDlIntoView: scrollSubtitleDlIntoView,
    setCurrent: setCurrent,
    setCurrentFromCapture: setCurrentFromCapture,
    applyTranslation: applyTranslation,
    findDlByCapture: findDlByCapture,
    addClickListner: addClickListner,
    clearAll: clearAll,
    setTranslatePanel: setTranslatePanel,
    getSubtitleWrap: getSubtitleWrap
  };

})(window.NST = window.NST || {});
