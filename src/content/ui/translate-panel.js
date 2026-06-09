/**
 * Netflix Subtitles Translator - Translate Panel Module
 * Manages the word translation panel with dictionary and images.
 */
(function(NST) {
  'use strict';

  const config = NST.config || {
    SELECTORS: {
      mainWrap: 'translate-ext',
      closeRightPanel: 'tr-close-x',
      imgWrap: 'img-tr-wrap',
      imgWrapTitle: 'img-tr-tile',
      descriptionWrap: 'describe-tr-wrap',
      descriptionTitle: 'describe-tr-title'
    },
    API_BASES: {
      gimages: ''
    },
    user: {}
  };

  const loadJson = NST.utils ? NST.utils.loadJson : function() {};
  const gtansUrl = NST.config ? NST.config.gtansUrl : function() { return ''; };
  const ftranUrl = NST.config ? NST.config.ftranUrl : function() { return ''; };

  // Reference to self
  let self = null;

  /**
   * Get UI elements
   */
  function getEls() {
    const S = config.SELECTORS;
    return {
      mainWrap: document.getElementById(S.mainWrap),
      descriptionTitle: document.getElementById(S.descriptionTitle),
      imgWrap: document.getElementById(S.imgWrap),
      descriptionWrap: document.getElementById(S.descriptionWrap),
      closeButton: document.getElementById(S.closeRightPanel)
    };
  }

  /**
   * Show the translation panel for a word
   */
  function start(word) {
    const els = getEls();
    if (!els.mainWrap) return;

    self = this;
    els.mainWrap.classList.add('open-tr-panel');
    els.descriptionTitle.innerHTML = '<span>' + word + '</span>';
    els.imgWrap.textContent = '';

    if (config.user.images) {
      loadJson(config.API_BASES.gimages + encodeURI(word), addImages);
    }

    loadJson(ftranUrl(word), wordTranslate);

    close();
    voice(word);
  }

  /**
   * Set up text-to-speech for a word
   */
  function voice(word) {
    const els = getEls();
    const msg = new SpeechSynthesisUtterance(word);
    msg.voice = speechSynthesis.getVoices().filter(function(voice) {
      return voice.name === 'Google US English';
    })[0];
    msg.rate = 0.5;
    msg.volume = 0.7;
    msg.lang = 'en-US';

    const titleSpan = els.descriptionTitle.querySelector('span');
    if (titleSpan) {
      titleSpan.addEventListener('click', function() {
        msg.voice = speechSynthesis.getVoices().filter(function(voice) {
          return voice.name === 'Google US English';
        })[0];
        speechSynthesis.speak(msg);
      }, false);
    }
  }

  /**
   * Set up the close button
   */
  function close() {
    const els = getEls();
    if (els.closeButton) {
      els.closeButton.addEventListener('click', function() {
        els.mainWrap.classList.remove('open-tr-panel');
      }, false);
    }
  }

  /**
   * Add images from Google image search
   */
  function addImages(data) {
    const els = getEls();
    if (!data || !data['items']) return;
    data['items'].forEach(function(item) {
      els.imgWrap.insertAdjacentHTML('beforeend', '<img src="' + item.image.thumbnailLink + '">');
    });
  }

  /**
   * Handle word translation response
   */
  function wordTranslate(data) {
    const els = getEls();
    if (!data) return;

    els.descriptionWrap.innerHTML = '';

    if (data['sentences'] && data['sentences'][0] && data['sentences'][0]['trans']) {
      els.descriptionTitle.insertAdjacentHTML('beforeend', ' — ' + data['sentences'][0]['trans']);
    }

    try {
      data['dict'].forEach(function(block) {
        const items = {};
        let limit = 3;
        try {
          block['entry'].forEach(function(ceil) {
            items[ceil['word']] = ceil['reverse_translation'];
            if (--limit === 0) throw 'BreakException';
          });
        } catch(e) {
          if (e !== 'BreakException') throw e;
        }
        addToWrap(block['pos'], items);
      });
    } catch(e){}
  }

  /**
   * Add dictionary entries to the panel
   */
  function addToWrap(type, items) {
    const els = getEls();
    let html = '<i>' + type + '</i>';

    for (const key in items) {
      html += '<dl>';
      html += '<dt>' + key + '</dt>';
      html += '<dd>' + items[key].join(', ') + '</dd>';
      html += '</dl>';
    }

    els.descriptionWrap.insertAdjacentHTML('beforeend', html);
  }

  // Export public API
  NST.ui = NST.ui || {};
  NST.ui.translatePanel = {
    start: start,
    voice: voice,
    close: close,
    addImages: addImages,
    wordTranslate: wordTranslate,
    addToWrap: addToWrap
  };

})(window.NST = window.NST || {});
