/**
 * Netflix Subtitles Translator - Netflix Subtitle API Module
 * Accesses Netflix's internal subtitle API to get official subtitles.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST-SUB-API]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST-SUB-API]'].concat([].slice.call(arguments))); } catch(e){} };

  // Store captured subtitle data
  let capturedSubtitles = {}; // { 'ja': [{startTime, endTime, text, lang}], ... }
  let availableLanguages = []; // [{language, label}]
  let initialized = false;

  /**
   * Parse TTML/DFXP XML subtitle text into cues
   */
  function parseTTML(xmlText, language) {
    const cues = [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      if (!doc) return cues;

      // TTML uses <p> elements with begin/end attributes
      const paragraphs = doc.querySelectorAll('p');
      paragraphs.forEach(function(p) {
        const begin = parseTTMLTime(p.getAttribute('begin'));
        const end = parseTTMLTime(p.getAttribute('end'));

        if (begin === null) return;

        // Extract text content (handle child elements like <br>, <span>)
        let text = extractTextFromTTML(p);
        text = cleanSubtitleText(text);

        if (text) {
          cues.push({
            startTime: begin,
            endTime: end || (begin + 3),
            text: text
          });
        }
      });

      // Sort by start time
      cues.sort(function(a, b) { return a.startTime - b.startTime; });
      LOG('Parsed', cues.length, 'cues from TTML for', language);
    } catch(e) {
      WARN('TTML parse error for', language, ':', e.message);
    }
    return cues;
  }

  /**
   * Parse TTML time format (e.g., "00:01:23.456" or "123.456t") to seconds
   */
  function parseTTMLTime(timeStr) {
    if (!timeStr) return null;
    try {
      // Handle HH:MM:SS.mmm format
      const match = timeStr.match(/^(\d+):(\d{2}):(\d{2})[\.,:](\d+)/);
      if (match) {
        return parseInt(match[1], 10) * 3600 +
               parseInt(match[2], 10) * 60 +
               parseInt(match[3], 10) +
               parseInt(match[4].padEnd(3, '0').slice(0, 3), 10) / 1000;
      }
      // Handle MM:SS.mmm format
      const match2 = timeStr.match(/^(\d+):(\d{2})[\.,:](\d+)/);
      if (match2) {
        return parseInt(match2[1], 10) * 60 +
               parseInt(match2[2], 10) +
               parseInt(match2[3].padEnd(3, '0').slice(0, 3), 10) / 1000;
      }
      // Handle plain seconds
      const match3 = timeStr.match(/^([\d.]+)/);
      if (match3) {
        return parseFloat(match3[1]);
      }
    } catch(e) {}
    return null;
  }

  /**
   * Extract plain text from a TTML element, preserving <br> as newlines
   */
  function extractTextFromTTML(el) {
    let text = '';
    el.childNodes.forEach(function(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'br') {
          text += '\n';
        } else {
          text += extractTextFromTTML(node);
        }
      }
    });
    return text;
  }

  /**
   * Clean subtitle text - remove HTML tags, decode entities
   */
  function cleanSubtitleText(text) {
    if (!text) return '';
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Trim each line
    text = text.split('\n').map(function(l) { return l.trim(); }).join('\n');
    text = text.trim();
    return text;
  }

  /**
   * Inject the subtitle capture script into page context
   */
  function injectSubtitleBridge() {
    if (document.getElementById('nst-subtitle-bridge')) {
      LOG('Subtitle bridge already injected');
      return;
    }

    LOG('Injecting subtitle bridge script...');

    try {
      const s = document.createElement('script');
      s.id = 'nst-subtitle-bridge';
      s.textContent = '(' + function() {
        console.log('[NST-SUB-Bridge] Injected into page context');

        let collectedCues = {};  // {langKey: [cues]}
        let trackInfoByUrl = {}; // Map URL -> {language, label}

        // Find player API to get track list
        function findPlayerAPI() {
          try {
            const nf = window.netflix;
            if (!nf || !nf.appContext || !nf.appContext.state || !nf.appContext.state.playerApp) return null;
            const api = nf.appContext.state.playerApp.getAPI();
            if (!api || !api.videoPlayer) return null;
            const sessionIds = api.videoPlayer.getAllPlayerSessionIds();
            for (let i = 0; i < sessionIds.length; i++) {
              if (sessionIds[i] && sessionIds[i].indexOf('watch-') === 0) {
                return { api: api, player: api.videoPlayer.getVideoPlayerBySessionId(sessionIds[i]), sessionId: sessionIds[i] };
              }
            }
            if (sessionIds[0]) return { api: api, player: api.videoPlayer.getVideoPlayerBySessionId(sessionIds[0]), sessionId: sessionIds[0] };
          } catch(e) {
            console.log('[NST-SUB-Bridge] Player API not found:', e.message);
          }
          return null;
        }

        // Get subtitle tracks from player API
        function getTracksFromPlayer() {
          const tracks = [];
          try {
            const p = findPlayerAPI();
            if (p && p.player && p.player.getTextTracks) {
              Array.from(p.player.getTextTracks()).forEach(function(t) {
                tracks.push({
                  id: t.id,
                  language: t.language,
                  kind: t.kind,
                  label: t.label || t.language,
                  isNone: t.isNone || false
                });
              });
            }
          } catch(e) {}
          return tracks;
        }

        // Get text tracks from video element
        function getTracksFromVideo() {
          const tracks = [];
          try {
            const video = document.querySelector('video');
            if (video && video.textTracks) {
              Array.from(video.textTracks).forEach(function(t) {
                if (t.kind === 'subtitles' || t.kind === 'captions') {
                  tracks.push({
                    id: t.id,
                    language: t.language,
                    kind: t.kind,
                    label: t.label || t.language,
                    mode: t.mode,
                    cueCount: t.cues ? t.cues.length : 0
                  });
                }
              });
            }
          } catch(e) {}
          return tracks;
        }

        // Intercept XHR to capture subtitle XML responses
        function setupXHRInterceptor() {
          const OrigOpen = XMLHttpRequest.prototype.open;
          const OrigSend = XMLHttpRequest.prototype.send;

          XMLHttpRequest.prototype.open = function(method, url) {
            this.__nstUrl = url;
            return OrigOpen.apply(this, arguments);
          };

          XMLHttpRequest.prototype.send = function() {
            const xhr = this;
            const url = xhr.__nstUrl;

            if (url && typeof url === 'string' &&
                (url.indexOf('nflxvideo.net') >= 0 && url.indexOf('/?o=') >= 0)) {
              // This looks like a subtitle request - wait for response
              xhr.addEventListener('load', function() {
                try {
                  const ct = xhr.getResponseHeader('Content-Type') || '';
                  if (ct.indexOf('xml') >= 0 || xhr.responseText && xhr.responseText.indexOf('<?xml') === 0) {
                    // This is a subtitle TTML file - we need to figure out the language
                    // Send the raw XML back to content script to parse
                    // We'll try to match this URL against known track download URLs
                    window.postMessage({
                      __nst: 'subtitle-xml-response',
                      url: url,
                      xml: xhr.responseText
                    }, '*');
                  }
                } catch(e) {}
              });
            }
            return OrigSend.apply(this, arguments);
          };

          console.log('[NST-SUB-Bridge] XHR interceptor installed');
        }

        // Track cuechange listeners that have been set up
        let tracksListening = new Set();

        // Set up listeners on text tracks
        function setupTrackListeners() {
          try {
            const video = document.querySelector('video');
            if (!video || !video.textTracks) return;

            Array.from(video.textTracks).forEach(function(track) {
              if ((track.kind === 'subtitles' || track.kind === 'captions') && track.language) {
                const key = track.language + '|' + (track.label || '');
                if (!tracksListening.has(key)) {
                  tracksListening.add(key);

                  // Listen for cue changes (real-time subtitle updates)
                  track.addEventListener('cuechange', function() {
                    const activeCues = Array.from(track.activeCues || []);
                    if (activeCues.length > 0) {
                      window.postMessage({
                        __nst: 'subtitle-cue',
                        language: track.language,
                        label: track.label || track.language,
                        cues: activeCues.map(function(c) {
                          return { startTime: c.startTime, endTime: c.endTime, text: c.text };
                        })
                      }, '*');
                    }

                    // Also collect all cues from this track
                    if (track.cues && track.cues.length > 0) {
                      const cues = Array.from(track.cues).map(function(c) {
                        return { startTime: c.startTime, endTime: c.endTime, text: c.text };
                      }).sort(function(a, b) { return a.startTime - b.startTime; });

                      if (cues.length > 0) {
                        collectedCues[track.language] = cues;
                        window.postMessage({
                          __nst: 'all-subtitle-cues',
                          language: track.language,
                          label: track.label || track.language,
                          cues: cues,
                          source: 'texttrack'
                        }, '*');
                      }
                    }
                  });
                }
              }
            });
          } catch(e) {}
        }

        // Collect all cues from currently visible/active tracks
        function collectFromTextTracks() {
          setupTrackListeners();
          try {
            const video = document.querySelector('video');
            if (!video || !video.textTracks) return;

            Array.from(video.textTracks).forEach(function(track) {
              if ((track.kind === 'subtitles' || track.kind === 'captions') && track.language) {
                // Try enabling temporarily if no cues
                if (track.mode === 'disabled') {
                  // Don't force-enable; Netflix controls that
                }
                if (track.cues && track.cues.length > 0) {
                  const cues = Array.from(track.cues).map(function(c) {
                    return { startTime: c.startTime, endTime: c.endTime, text: c.text };
                  }).sort(function(a, b) { return a.startTime - b.startTime; });

                  if (cues.length > 0) {
                    collectedCues[track.language] = cues;
                    window.postMessage({
                      __nst: 'all-subtitle-cues',
                      language: track.language,
                      label: track.label || track.language,
                      cues: cues,
                      source: 'texttrack'
                    }, '*');
                  }
                }
              }
            });
          } catch(e) {}
        }

        // Listen for messages from content script
        window.addEventListener('message', function(ev) {
          if (ev.source !== window || !ev.data) return;

          if (ev.data.__nst === 'do-capture' && ev.data.language) {
            console.log('[NST-SUB-Bridge] Capture request for', ev.data.language);
            collectFromTextTracks();
          }
          if (ev.data.__nst === 'trigger-capture' && ev.data.language) {
            console.log('[NST-SUB-Bridge] Trigger-capture for', ev.data.language);
            collectFromTextTracks();
          }
        });

        // Send track info periodically
        function sendTrackInfo() {
          const playerTracks = getTracksFromPlayer();
          const videoTracks = getTracksFromVideo();

          // Merge tracks (prefer player tracks, add any from video)
          const seen = new Set();
          const allTracks = [];
          playerTracks.forEach(function(t) {
            if (t.language && !t.isNone) {
              seen.add(t.language);
              allTracks.push(t);
            }
          });
          videoTracks.forEach(function(t) {
            if (t.language && !seen.has(t.language)) {
              seen.add(t.language);
              allTracks.push(t);
            }
          });

          window.postMessage({
            __nst: 'text-tracks-found',
            tracks: allTracks
          }, '*');

          // Also send any collected text tracks
          collectFromTextTracks();
        }

        // Initialize
        setupXHRInterceptor();
        setInterval(sendTrackInfo, 2000);
        setTimeout(sendTrackInfo, 500);
        setTimeout(sendTrackInfo, 2000);

        console.log('[NST-SUB-Bridge] Ready');
      }.toString() + ')();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      LOG('Subtitle bridge injected');
    } catch(e) {
      WARN('Failed to inject subtitle bridge:', e.message);
    }
  }

  /**
   * Process subtitle cues and store them
   */
  function processCues(language, label, cues) {
    if (!language || !cues || cues.length === 0) return;

    if (!capturedSubtitles[language]) {
      capturedSubtitles[language] = [];
    }

    const existingList = capturedSubtitles[language];
    const existingTimes = new Set(existingList.map(function(c) {
      return c.startTime.toFixed(2);
    }));

    let addedCount = 0;
    cues.forEach(function(cue) {
      if (typeof cue.startTime !== 'number') return;
      const key = cue.startTime.toFixed(2);
      if (!existingTimes.has(key)) {
        existingList.push({
          language: language,
          label: label || language,
          startTime: cue.startTime,
          endTime: cue.endTime || (cue.startTime + 3),
          text: cleanSubtitleText(cue.text)
        });
        addedCount++;
      } else {
        const existing = existingList.find(function(c) {
          return Math.abs(c.startTime - cue.startTime) < 0.1;
        });
        if (existing && cue.text && (!existing.text || existing.text.length < cue.text.length)) {
          existing.text = cleanSubtitleText(cue.text);
        }
      }
    });

    existingList.sort(function(a, b) { return a.startTime - b.startTime; });

    if (addedCount > 0) {
      LOG('Added', addedCount, 'new cues for', language, 'total:', existingList.length);
      window.dispatchEvent(new CustomEvent('nst-official-subtitles-updated', {
        detail: { language: language, count: existingList.length }
      }));
    }
  }

  /**
   * Get all captured subtitles for a specific language
   */
  function getSubtitles(language) {
    if (!language) {
      const all = [];
      Object.keys(capturedSubtitles).forEach(function(lang) {
        all.push.apply(all, capturedSubtitles[lang]);
      });
      return all;
    }
    return capturedSubtitles[language] || [];
  }

  /**
   * Get count of captured subtitles per language
   */
  function getCapturedCounts() {
    const counts = {};
    Object.keys(capturedSubtitles).forEach(function(lang) {
      counts[lang] = capturedSubtitles[lang].length;
    });
    return counts;
  }

  /**
   * Get subtitle for a specific language and time
   */
  function getSubtitleAtTime(language, time) {
    const list = capturedSubtitles[language];
    if (!list) return null;

    for (let i = 0; i < list.length; i++) {
      const cue = list[i];
      if (time >= cue.startTime && time <= cue.endTime) {
        return cue;
      }
    }
    // Fallback: find nearest within 2 seconds
    for (let i = 0; i < list.length; i++) {
      const cue = list[i];
      if (Math.abs(cue.startTime - time) < 2.0) {
        return cue;
      }
    }
    return null;
  }

  /**
   * Get available languages
   */
  function getAvailableLanguages() {
    return availableLanguages;
  }

  /**
   * Capture subtitles for a specific language
   */
  function captureLanguage(language) {
    LOG('Triggering capture for language:', language);
    window.postMessage({ __nst: 'do-capture', language: language }, '*');
  }

  /**
   * Initialize the subtitle API module
   */
  function init() {
    if (initialized) return;
    initialized = true;

    LOG('Subtitle API module initialized');

    injectSubtitleBridge();

    window.addEventListener('message', function(ev) {
      if (ev.source !== window || !ev.data) return;

      if (ev.data.__nst === 'text-tracks-found') {
        // Merge new tracks without overwriting labels for existing ones we've seen before
        const newTracks = ev.data.tracks || [];
        const seen = {};
        availableLanguages.forEach(function(t) { seen[t.language] = t; });
        newTracks.forEach(function(t) {
          if (t.language && !seen[t.language]) {
            seen[t.language] = t;
          }
        });
        availableLanguages = Object.keys(seen).map(function(k) { return seen[k]; });
      }

      if (ev.data.__nst === 'subtitle-cue') {
        processCues(ev.data.language, ev.data.label, ev.data.cues);
      }

      if (ev.data.__nst === 'all-subtitle-cues') {
        processCues(ev.data.language, ev.data.label, ev.data.cues);
        LOG('Got all cues for', ev.data.language, 'total:', (capturedSubtitles[ev.data.language] || []).length);
      }

      if (ev.data.__nst === 'subtitle-xml-response') {
        // We got raw XML - but we need to know which language this is for.
        // For now, we also get cues via textTracks when Netflix activates a track,
        // but this XHR interception can help if cues aren't exposed via textTracks.
        // Try parsing it anyway - we'll attribute it when we can match the URL pattern
        // The cues will be attributed when the corresponding track is activated
        LOG('Got subtitle XML response from', ev.data.url && ev.data.url.substring(0, 100));
      }

      if (ev.data.__nst === 'subtitle-info') {
        LOG('Subtitle info received:', ev.data.info);
      }
    });
  }

  // Export public API
  NST.netflix = NST.netflix || {};
  NST.netflix.subtitleApi = {
    init: init,
    getSubtitles: getSubtitles,
    getSubtitleAtTime: getSubtitleAtTime,
    getAvailableLanguages: getAvailableLanguages,
    getCapturedCounts: getCapturedCounts,
    getAllCaptured: function() { return capturedSubtitles; },
    captureLanguage: captureLanguage
  };

  // Initialize
  init();

})(window.NST = window.NST || {});
