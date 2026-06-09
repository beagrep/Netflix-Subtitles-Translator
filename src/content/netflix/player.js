/**
 * Netflix Subtitles Translator - Netflix Player Module
 * Handles interaction with Netflix's player (seek, video time, etc.)
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };

  // Non-linear mode flag (set when user seeks)
  let nonLinearMode = false;
  let lastSeekAt = 0;

  /**
   * Get the Netflix video ID from the URL
   */
  function getNetflixVideoId() {
    const m = location.pathname.match(/\/watch\/(\d+)/);
    return m ? m[1] : null;
  }

  /**
   * Get canonical watch URL (without tracking params)
   */
  function getCanonicalWatchUrl() {
    const id = getNetflixVideoId();
    return id ? (location.origin + '/watch/' + id) : location.href;
  }

  /**
   * Get the video element
   */
  function getVideoEl() {
    const v = document.querySelector('video');
    return v || null;
  }

  /**
   * Get current video time in seconds
   */
  function getVideoTime() {
    const v = getVideoEl();
    const t = v ? v.currentTime : null;
    LOG('getVideoTime ->', t, 'videoEl=', !!v);
    return t;
  }

  /**
   * Attempt to extract Netflix title from DOM
   */
  function getNetflixTitle() {
    const candidates = [
      '[data-uia="video-title"]',
      '.video-title h4',
      '.video-title',
      '.ellipsize-text',
      '.title-info-title',
      '.title-info h1',
      'h1.title'
    ];
    for (const sel of candidates) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim().replace(/\s+/g, ' ');
      } catch(e){}
    }
    const t = (document.title || '').replace(/\s*[\|\-–]\s*Netflix\s*$/i, '').trim();
    return t || 'Netflix';
  }

  /**
   * Inject the Netflix seek bridge script into page context
   * This allows us to use Netflix's internal player API without triggering anti-cheat
   */
  function injectNetflixSeekBridge() {
    if (document.getElementById('nst-netflix-bridge')) return;
    try {
      const s = document.createElement('script');
      s.id = 'nst-netflix-bridge';
      s.textContent = '(' + function() {
        function findPlayer() {
          try {
            const api = netflix && netflix.appContext && netflix.appContext.state &&
              netflix.appContext.state.playerApp && netflix.appContext.state.playerApp.getAPI();
            if (!api || !api.videoPlayer) return null;
            const ids = api.videoPlayer.getAllPlayerSessionIds();
            for (let i = 0; i < ids.length; i++) {
              if (ids[i] && ids[i].indexOf('watch-') === 0) {
                return api.videoPlayer.getVideoPlayerBySessionId(ids[i]);
              }
            }
            if (ids[0]) return api.videoPlayer.getVideoPlayerBySessionId(ids[0]);
          } catch(e){}
          return null;
        }
        function playPlayer(p) {
          try {
            if (p && typeof p.play === 'function') { p.play(); return 'player.play'; }
            if (p && typeof p.unpause === 'function') { p.unpause(); return 'player.unpause'; }
            if (p && typeof p.resume === 'function') { p.resume(); return 'player.resume'; }
          } catch(e){}
          try {
            const v = document.querySelector('video');
            if (v && typeof v.play === 'function') { v.play(); return 'video.play'; }
          } catch(e){}
          return 'none';
        }
        window.addEventListener('message', function(ev) {
          if (!ev.data || ev.data.__nst !== 'seek') return;
          const sec = ev.data.sec;
          const shouldPlay = !!ev.data.play;
          const p = findPlayer();
          let ok = false, via = 'none', playVia = 'none', err = '';
          try {
            if (p && typeof p.seek === 'function') {
              p.seek(Math.round(sec * 1000));
              ok = true; via = 'player.seek';
              if (shouldPlay) {
                setTimeout(function() {
                  const pv = playPlayer(p);
                  window.postMessage({ __nst: 'seek-play-result', via: pv, sec: sec }, '*');
                }, 150);
              }
            }
          } catch(e) { err = String(e && e.message || e); }
          window.postMessage({ __nst: 'seek-result', ok: ok, via: via, playVia: playVia, err: err, sec: sec, play: shouldPlay }, '*');
        });
      }.toString() + ')();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch(e) { WARN('inject bridge failed:', e && e.message); }
  }

  /**
   * Seek to a specific time in the video (using Netflix's API)
   * Also resumes playback after seeking.
   */
  function seekVideo(sec) {
    if (typeof sec !== 'number' || !isFinite(sec)) return false;
    LOG('seekVideo:', sec, '(via Netflix player API + play)');
    try {
      window.postMessage({ __nst: 'seek', sec: sec, play: true }, '*');
      nonLinearMode = true;
      lastSeekAt = Date.now();
      return true;
    } catch(e) {
      WARN('seekVideo postMessage failed:', e && e.message);
      return false;
    }
  }

  /**
   * Check if we're in non-linear mode (user has seeked recently)
   */
  function isNonLinear() {
    return nonLinearMode;
  }

  /**
   * Set non-linear mode explicitly
   */
  function setNonLinear(value) {
    nonLinearMode = value;
    if (value) lastSeekAt = Date.now();
  }

  /**
   * Attach a watcher that detects when user scrubs the progress bar
   */
  function attachVideoSeekWatcher() {
    let attached = null;
    let lastT = null;
    setInterval(function() {
      const v = document.querySelector('video');
      if (!v) return;
      if (v !== attached) {
        attached = v;
        lastT = v.currentTime;
        v.addEventListener('seeking', function() {
          const now = v.currentTime;
          const prev = lastT;
          if (prev === null || Math.abs(now - prev) > 1.5) {
            nonLinearMode = true;
            lastSeekAt = Date.now();
            LOG('detected non-linear seek: prev=', prev, ' now=', now);
          }
        });
        return;
      }
      if (!v.paused && !v.seeking) {
        if (lastT !== null && v.currentTime > lastT && (v.currentTime - lastT) < 2) {
          if (nonLinearMode && (Date.now() - lastSeekAt) > 1500) {
            LOG('linear playback resumed — clearing non-linear flag');
            nonLinearMode = false;
          }
        }
        lastT = v.currentTime;
      }
    }, 500);
  }

  /**
   * Initialize the player module
   */
  function init() {
    injectNetflixSeekBridge();
    attachVideoSeekWatcher();

    // Listen for seek result messages from the bridge
    window.addEventListener('message', function(ev) {
      if (ev.source !== window || !ev.data) return;
      if (ev.data.__nst === 'seek-result') LOG('seek-result:', ev.data);
      if (ev.data.__nst === 'seek-play-result') LOG('seek-play-result:', ev.data);
    });

    // Expose on window for backwards compatibility
    window.__nstNonLinear = nonLinearMode;
    Object.defineProperty(window, '__nstNonLinear', {
      get: function() { return nonLinearMode; },
      set: function(v) { nonLinearMode = v; if (v) lastSeekAt = Date.now(); }
    });
  }

  // Export public API
  NST.netflix = NST.netflix || {};
  NST.netflix.player = {
    getNetflixVideoId: getNetflixVideoId,
    getCanonicalWatchUrl: getCanonicalWatchUrl,
    getVideoEl: getVideoEl,
    getVideoTime: getVideoTime,
    getNetflixTitle: getNetflixTitle,
    injectNetflixSeekBridge: injectNetflixSeekBridge,
    seekVideo: seekVideo,
    isNonLinear: isNonLinear,
    setNonLinear: setNonLinear
  };

  // Initialize
  init();

})(window.NST = window.NST || {});
