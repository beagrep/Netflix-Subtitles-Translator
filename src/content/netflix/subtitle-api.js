/**
 * Netflix Subtitles Translator - Netflix Subtitle API Module
 * Accesses Netflix's internal subtitle API to get official subtitles.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST-SUB-API]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST-SUB-API]'].concat([].slice.call(arguments))); } catch(e){} };

  // Store captured subtitle data
  let capturedSubtitles = {}; // { 'en': [...], 'zh': [...] }
  let availableLanguages = [];
  let initialized = false;
  let currentCapturingLanguage = null;

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

        // Storage for subtitle cues
        let collectedCues = {};

        // Function to find the Netflix player API
        function findPlayerAPI() {
          try {
            const nf = window.netflix;
            if (!nf || !nf.appContext || !nf.appContext.state || !nf.appContext.state.playerApp) {
              return null;
            }
            const api = nf.appContext.state.playerApp.getAPI();
            if (!api || !api.videoPlayer) return null;

            const sessionIds = api.videoPlayer.getAllPlayerSessionIds();
            for (let i = 0; i < sessionIds.length; i++) {
              if (sessionIds[i] && sessionIds[i].indexOf('watch-') === 0) {
                return {
                  api: api,
                  player: api.videoPlayer.getVideoPlayerBySessionId(sessionIds[i]),
                  sessionId: sessionIds[i]
                };
              }
            }
            if (sessionIds[0]) {
              return {
                api: api,
                player: api.videoPlayer.getVideoPlayerBySessionId(sessionIds[0]),
                sessionId: sessionIds[0]
              };
            }
          } catch(e) {
            console.log('[NST-SUB-Bridge] Player API not found:', e.message);
          }
          return null;
        }

        // Collect all cues from a track
        function collectCuesFromTrack(track, language) {
          if (!track.cues) return [];

          const cues = Array.from(track.cues).map(function(cue) {
            return {
              startTime: cue.startTime,
              endTime: cue.endTime,
              text: cue.text
            };
          });

          // Sort by start time
          cues.sort(function(a, b) {
            return a.startTime - b.startTime;
          });

          console.log('[NST-SUB-Bridge] Collected', cues.length, 'cues for', language);

          return cues;
        }

        // Try to listen to all text tracks and collect cues
        function setupTrackListeners() {
          try {
            const video = document.querySelector('video');
            if (!video || !video.textTracks) return;

            Array.from(video.textTracks).forEach(function(track) {
              if (track.kind === 'subtitles' || track.kind === 'captions') {
                try {
                  // Try to enable the track temporarily to get cues
                  const originalMode = track.mode;

                  if (track.cues && track.cues.length === 0) {
                    track.mode = 'hidden'; // Show but not visible
                  }

                  // Listen for cue changes
                  track.addEventListener('cuechange', function() {
                    const activeCues = Array.from(track.activeCues || []);
                    if (activeCues.length > 0) {
                      window.postMessage({
                        __nst: 'subtitle-cue',
                        language: track.language,
                        label: track.label,
                        cues: activeCues.map(function(cue) {
                          return {
                            startTime: cue.startTime,
                            endTime: cue.endTime,
                            text: cue.text
                          };
                        })
                      }, '*');
                    }
                  });

                  // If we have cues, send them all
                  if (track.cues && track.cues.length > 0) {
                    const allCues = collectCuesFromTrack(track, track.language);
                    collectedCues[track.language] = allCues;

                    window.postMessage({
                      __nst: 'all-subtitle-cues',
                      language: track.language,
                      label: track.label,
                      cues: allCues
                    }, '*');
                  }

                  // Restore original mode
                  track.mode = originalMode;
                } catch(e) {
                  console.log('[NST-SUB-Bridge] Track listen error:', track.language, e.message);
                }
              }
            });
          } catch(e) {
            console.log('[NST-SUB-Bridge] Text track listen error:', e.message);
          }
        }

        // Get all available text tracks
        function getAvailableTracks() {
          try {
            const video = document.querySelector('video');
            if (!video || !video.textTracks) return [];

            return Array.from(video.textTracks).map(function(t) {
              return {
                id: t.id,
                kind: t.kind,
                language: t.language,
                label: t.label,
                mode: t.mode,
                cueCount: (t.cues ? t.cues.length : 0)
              };
            });
          } catch(e) {
            console.log('[NST-SUB-Bridge] Get tracks error:', e.message);
            return [];
          }
        }

        // Expose functions to capture all subtitles for a specific language
        window.__nstCaptureSubtitles = function(language) {
          console.log('[NST-SUB-Bridge] Capturing subtitles for', language);

          try {
            const video = document.querySelector('video');
            if (!video || !video.textTracks) {
              return { error: 'No video/textTracks found' };
            }

            // Find the requested track
            const track = Array.from(video.textTracks).find(function(t) {
              return t.language === language || t.label === language;
            });

            if (!track) {
              return { error: 'Track not found for: ' + language };
            }

            // Try to enable the track to get all cues
            const originalMode = track.mode;
            track.mode = 'hidden';

            // Wait a bit and collect cues
            setTimeout(function() {
              const cues = collectCuesFromTrack(track, language);
              collectedCues[language] = cues;

              window.postMessage({
                __nst: 'all-subtitle-cues',
                language: language,
                label: track.label,
                cues: cues
              }, '*');

              console.log('[NST-SUB-Bridge] Captured', cues.length, 'cues for', language);

              // Restore mode
              track.mode = originalMode;
            }, 500);

            return { success: true, language: language };
          } catch(e) {
            return { error: e.message };
          }
        };

        // Expose a function to manually trigger exploration
        window.__nstGetSubtitleInfo = function() {
          const info = {
            player: null,
            tracks: getAvailableTracks(),
            collectedCues: collectedCues
          };

          const p = findPlayerAPI();
          if (p) {
            info.player = {
              sessionId: p.sessionId
            };

            // Try to get subtitle tracks from player
            try {
              if (p.player.getTextTracks) {
                info.playerTracks = Array.from(p.player.getTextTracks()).map(function(t) {
                  return {
                    id: t.id,
                    language: t.language,
                    kind: t.kind,
                    label: t.label
                  };
                });
              }
            } catch(e) {
              info.playerTracksError = e.message;
            }
          }

          window.postMessage({
            __nst: 'subtitle-info',
            info: info
          }, '*');

          console.log('[NST-SUB-Bridge] Info:', info);

          // Also try to collect cues
          setupTrackListeners();

          return info;
        };

        // Poll for tracks and cues
        function poll() {
          const tracks = getAvailableTracks();
          if (tracks.length > 0) {
            window.postMessage({
              __nst: 'text-tracks-found',
              tracks: tracks
            }, '*');
          }

          setupTrackListeners();
        }

        setInterval(poll, 3000);
        poll();

        console.log('[NST-SUB-Bridge] Ready. Call __nstGetSubtitleInfo() or __nstCaptureSubtitles("en") in console');
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

    // Add new cues
    let addedCount = 0;
    cues.forEach(function(cue) {
      const key = cue.startTime.toFixed(2);
      if (!existingTimes.has(key)) {
        existingList.push({
          language: language,
          label: label,
          startTime: cue.startTime,
          endTime: cue.endTime,
          text: cleanSubtitleText(cue.text)
        });
        addedCount++;
      } else {
        // Update existing cue if needed
        const existing = existingList.find(function(c) {
          return Math.abs(c.startTime - cue.startTime) < 0.1;
        });
        if (existing && (!existing.text || existing.text.length < cue.text.length)) {
          existing.text = cleanSubtitleText(cue.text);
        }
      }
    });

    // Sort by time
    existingList.sort(function(a, b) {
      return a.startTime - b.startTime;
    });

    if (addedCount > 0) {
      LOG('Added', addedCount, 'new cues for', language, 'total:', existingList.length);
    }
  }

  /**
   * Clean subtitle text - remove HTML tags, etc.
   */
  function cleanSubtitleText(text) {
    if (!text) return '';
    // Remove HTML tags
    text = text.replace(/<[^>]*>/g, '');
    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    // Trim whitespace
    text = text.trim();
    // Normalize line breaks
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\r/g, '\n');
    return text;
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
    currentCapturingLanguage = language;
    // This will be handled by the injected script
    window.postMessage({ __nst: 'do-capture', language: language }, '*');
  }

  /**
   * Get bilingual subtitle pairs
   */
  function getBilingualSubtitles(lang1, lang2) {
    const list1 = capturedSubtitles[lang1] || [];
    const list2 = capturedSubtitles[lang2] || [];

    const pairs = [];

    // Match by time
    list1.forEach(function(cue1) {
      const matchingCue = list2.find(function(cue2) {
        // Times overlap or are very close
        return Math.abs(cue1.startTime - cue2.startTime) < 1.0 ||
               (cue1.startTime <= cue2.endTime && cue2.startTime <= cue1.endTime);
      });

      if (matchingCue) {
        pairs.push({
          startTime: cue1.startTime,
          endTime: cue1.endTime,
          lang1: cue1.text,
          lang2: matchingCue.text
        });
      } else {
        pairs.push({
          startTime: cue1.startTime,
          endTime: cue1.endTime,
          lang1: cue1.text,
          lang2: null
        });
      }
    });

    return pairs;
  }

  /**
   * Initialize the subtitle API module
   */
  function init() {
    if (initialized) return;
    initialized = true;

    LOG('Subtitle API module initialized');

    // Inject the bridge
    injectSubtitleBridge();

    // Listen for messages from the bridge
    window.addEventListener('message', function(ev) {
      if (ev.source !== window || !ev.data) return;

      if (ev.data.__nst === 'text-tracks-found') {
        availableLanguages = ev.data.tracks;
        LOG('Available subtitle tracks found:', availableLanguages.map(function(t) {
          return t.language + ': ' + t.label;
        }));
      }

      if (ev.data.__nst === 'subtitle-cue') {
        processCues(ev.data.language, ev.data.label, ev.data.cues);
      }

      if (ev.data.__nst === 'all-subtitle-cues') {
        processCues(ev.data.language, ev.data.label, ev.data.cues);
        LOG('Got all cues for', ev.data.language, 'total:', (capturedSubtitles[ev.data.language] || []).length);
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
    getAllCaptured: function() { return capturedSubtitles; },
    captureLanguage: captureLanguage,
    getBilingualSubtitles: getBilingualSubtitles,

    // Helper to trigger explore
    triggerExplore: function() {
      window.postMessage({ __nst: 'trigger-explore' }, '*');
    }
  };

  // Initialize
  init();

})(window.NST = window.NST || {});
