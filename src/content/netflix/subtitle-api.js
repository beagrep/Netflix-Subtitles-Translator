/**
 * Netflix Subtitles Translator - Netflix Subtitle API Module
 * Attempts to access Netflix's internal subtitle API to get official subtitles.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST-SUB-API]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST-SUB-API]'].concat([].slice.call(arguments))); } catch(e){} };

  // Store captured subtitle data
  let capturedSubtitles = [];
  let availableLanguages = [];
  let initialized = false;

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

        // Storage for subtitle data
        let currentSubtitles = {};
        let lastTimedTextEvent = null;

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

        // Function to get text tracks from video element
        function getTextTracksFromVideo() {
          try {
            const video = document.querySelector('video');
            if (video && video.textTracks) {
              return Array.from(video.textTracks).map(function(t) {
                return {
                  id: t.id,
                  kind: t.kind,
                  language: t.language,
                  label: t.label,
                  mode: t.mode
                };
              });
            }
          } catch(e) {}
          return [];
        }

        // Function to listen to cue changes on text tracks
        function listenToTextTracks() {
          try {
            const video = document.querySelector('video');
            if (!video || !video.textTracks) return;

            Array.from(video.textTracks).forEach(function(track) {
              if (track.kind === 'subtitles' || track.kind === 'captions') {
                try {
                  track.mode = 'showing'; // Try to enable the track

                  if (track.cues) {
                    // Listen for cue change events
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

                    // Also get all cues if available
                    const allCues = Array.from(track.cues || []);
                    if (allCues.length > 0) {
                      window.postMessage({
                        __nst: 'all-subtitle-cues',
                        language: track.language,
                        label: track.label,
                        cues: allCues.map(function(cue) {
                          return {
                            startTime: cue.startTime,
                            endTime: cue.endTime,
                            text: cue.text
                          };
                        })
                      }, '*');
                    }
                  }
                } catch(e) {
                  console.log('[NST-SUB-Bridge] Track listen error:', track.language, e.message);
                }
              }
            });
          } catch(e) {
            console.log('[NST-SUB-Bridge] Text track listen error:', e.message);
          }
        }

        // Monkey-patch to intercept subtitle data
        (function() {
          try {
            // Intercept the video element's addTextTrack method
            const video = document.querySelector('video');
            if (video) {
              const originalAddTextTrack = video.addTextTrack;
              video.addTextTrack = function() {
                console.log('[NST-SUB-Bridge] addTextTrack called:', arguments);
                const track = originalAddTextTrack.apply(this, arguments);
                window.postMessage({
                  __nst: 'text-track-added',
                  kind: track.kind,
                  language: track.language,
                  label: track.label
                }, '*');
                return track;
              };
            }
          } catch(e) {
            console.log('[NST-SUB-Bridge] AddTextTrack patch error:', e.message);
          }
        })();

        // Poll for player API and tracks
        function pollPlayer() {
          const p = findPlayerAPI();
          if (p) {
            window.postMessage({
              __nst: 'player-found',
              sessionId: p.sessionId
            }, '*');
          }

          const tracks = getTextTracksFromVideo();
          if (tracks.length > 0) {
            window.postMessage({
              __nst: 'text-tracks-found',
              tracks: tracks
            }, '*');

            // Try to listen to them
            listenToTextTracks();
          }
        }

        // Expose a function to manually trigger exploration
        window.__nstGetSubtitleInfo = function() {
          const info = {
            player: null,
            tracks: getTextTracksFromVideo()
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

          // Also try to listen again
          listenToTextTracks();

          return info;
        };

        // Start polling
        setInterval(pollPlayer, 2000);
        pollPlayer();

        console.log('[NST-SUB-Bridge] Ready. Call __nstGetSubtitleInfo() in console to explore');
      }.toString() + ')();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      LOG('Subtitle bridge injected');
    } catch(e) {
      WARN('Failed to inject subtitle bridge:', e.message);
    }
  }

  /**
   * Process subtitle cues
   */
  function processCues(language, label, cues) {
    LOG('Got', cues.length, 'cues for', language, label);

    cues.forEach(function(cue) {
      // Add to captured subtitles if not already there
      const existing = capturedSubtitles.find(function(s) {
        return s.language === language &&
               Math.abs(s.startTime - cue.startTime) < 0.1 &&
               s.text === cue.text;
      });

      if (!existing) {
        capturedSubtitles.push({
          language: language,
          label: label,
          startTime: cue.startTime,
          endTime: cue.endTime,
          text: cue.text
        });
      }
    });

    // Sort by time
    capturedSubtitles.sort(function(a, b) {
      return a.startTime - b.startTime;
    });
  }

  /**
   * Get all captured subtitles for a specific language
   */
  function getSubtitles(language) {
    if (!language) return capturedSubtitles;
    return capturedSubtitles.filter(function(s) {
      return s.language === language;
    });
  }

  /**
   * Get available languages
   */
  function getAvailableLanguages() {
    return availableLanguages;
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
        LOG('Available subtitle tracks found:', availableLanguages);
      }

      if (ev.data.__nst === 'subtitle-cue') {
        processCues(ev.data.language, ev.data.label, ev.data.cues);
      }

      if (ev.data.__nst === 'all-subtitle-cues') {
        processCues(ev.data.language, ev.data.label, ev.data.cues);
        LOG('Got all cues for', ev.data.language, 'total:', capturedSubtitles.length);
      }

      if (ev.data.__nst === 'subtitle-info') {
        LOG('Subtitle info received:', ev.data.info);
      }

      if (ev.data.__nst === 'player-found') {
        LOG('Netflix player found:', ev.data.sessionId);
      }

      if (ev.data.__nst === 'text-track-added') {
        LOG('New text track added:', ev.data);
      }
    });
  }

  // Export public API
  NST.netflix = NST.netflix || {};
  NST.netflix.subtitleApi = {
    init: init,
    getSubtitles: getSubtitles,
    getAvailableLanguages: getAvailableLanguages,
    getAllCaptured: function() { return capturedSubtitles; },
    triggerExplore: function() {
      window.postMessage({ __nst: 'trigger-explore' }, '*');
    }
  };

  // Initialize
  init();

})(window.NST = window.NST || {});
