/**
 * Netflix Subtitles Translator - Netflix API Research Module
 * Experimental module to explore Netflix's internal APIs and subtitle data.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST-API]'].concat([].slice.call(arguments))); } catch(e){} };
  const WARN = NST.utils ? NST.utils.WARN : function() { try { console.warn.apply(console, ['[NST-API]'].concat([].slice.call(arguments))); } catch(e){} };

  /**
   * Explore the Netflix global object and log interesting things
   */
  function exploreNetflixGlobal() {
    LOG('=== Exploring Netflix global object ===');

    // Check if netflix object exists
    if (typeof window.netflix === 'undefined') {
      LOG('window.netflix not found (not in page context)');
      return null;
    }

    const nf = window.netflix;
    LOG('window.netflix found:', Object.keys(nf));

    // Look for appContext
    if (nf.appContext) {
      LOG('appContext found');
      try {
        LOG('appContext state:', nf.appContext.state ? Object.keys(nf.appContext.state) : 'no state');
      } catch(e) { LOG('appContext access:', e.message); }
    }

    return nf;
  }

  /**
   * Inject a script into the page context to access Netflix's internals
   */
  function injectExplorerScript() {
    if (document.getElementById('nst-api-explorer')) {
      LOG('Explorer script already injected');
      return;
    }

    LOG('Injecting API explorer script into page context...');

    try {
      const s = document.createElement('script');
      s.id = 'nst-api-explorer';
      s.textContent = '(' + function() {
        console.log('[NST-API-Explorer] Injected into page context');

        // Expose a helper on window for debugging
        window.__nstExplore = function() {
          const results = {};

          console.log('[NST-API-Explorer] Starting exploration...');

          // 1. Look for netflix object
          if (window.netflix) {
            results.netflix = {};

            try {
              const nf = window.netflix;
              results.netflix.keys = Object.keys(nf);

              // Look for appContext
              if (nf.appContext) {
                results.netflix.appContext = {};

                try {
                  const state = nf.appContext.state;
                  if (state) {
                    results.netflix.appContext.stateKeys = Object.keys(state);

                    // Look for playerApp
                    if (state.playerApp) {
                      results.netflix.appContext.playerApp = true;

                      try {
                        const api = state.playerApp.getAPI();
                        if (api) {
                          results.netflix.appContext.apiKeys = Object.keys(api);

                          // Look for videoPlayer
                          if (api.videoPlayer) {
                            results.netflix.appContext.hasVideoPlayer = true;

                            try {
                              const sessionIds = api.videoPlayer.getAllPlayerSessionIds();
                              results.netflix.appContext.sessionIds = sessionIds;

                              if (sessionIds && sessionIds.length > 0) {
                                const player = api.videoPlayer.getVideoPlayerBySessionId(sessionIds[0]);
                                if (player) {
                                  results.netflix.appContext.playerKeys = Object.keys(player).filter(function(k) {
                                    return typeof player[k] !== 'function';
                                  });

                                  // Look for subtitle or timing related methods
                                  const methods = Object.keys(player).filter(function(k) {
                                    return typeof player[k] === 'function';
                                  });
                                  results.netflix.appContext.playerMethods = methods;

                                  // Try to get current video ID / metadata
                                  try {
                                    if (player.getCurrentVideoId) {
                                      results.netflix.appContext.currentVideoId = player.getCurrentVideoId();
                                    }
                                  } catch(e) {}

                                  // Try to find subtitle tracks
                                  try {
                                    if (player.getTextTracks) {
                                      const tracks = player.getTextTracks();
                                      results.netflix.appContext.textTracks = tracks ? {
                                        count: tracks.length,
                                        tracks: Array.from(tracks).map(function(t) {
                                          return {
                                            id: t.id,
                                            language: t.language,
                                            kind: t.kind,
                                            label: t.label,
                                            mode: t.mode
                                          };
                                        })
                                      } : null;
                                    }
                                  } catch(e) {
                                    results.netflix.appContext.textTracksError = e.message;
                                  }
                                }
                              }
                            } catch(e) {
                              results.netflix.appContext.playerError = e.message;
                            }
                          }
                        }
                      } catch(e) {
                        results.netflix.appContext.apiError = e.message;
                      }
                    }
                  }
                } catch(e) {
                  results.netflix.appContext.error = e.message;
                }
              }
            } catch(e) {
              results.netflix.error = e.message;
            }
          }

          // 2. Look for any video / subtitle related data on window
          try {
            const windowKeys = Object.keys(window).filter(function(k) {
              return k.toLowerCase().indexOf('subtitle') >= 0 ||
                     k.toLowerCase().indexOf('caption') >= 0 ||
                     k.toLowerCase().indexOf('texttrack') >= 0 ||
                     k.toLowerCase().indexOf('timedtext') >= 0;
            });
            if (windowKeys.length > 0) {
              results.subtitleRelatedGlobals = windowKeys;
            }
          } catch(e) {}

          // 3. Look for the Netflix player react root or data containers
          try {
            const reactContainers = [];
            document.querySelectorAll('[data-reactroot], [data-reactid]').forEach(function(el) {
              reactContainers.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.replace(/\s+/g, '.') : ''));
            });
            if (reactContainers.length > 0) {
              results.reactContainers = reactContainers.slice(0, 20);
            }
          } catch(e) {}

          // 4. Look for JSON script tags that might contain metadata
          try {
            const jsonScripts = [];
            document.querySelectorAll('script[type="application/json"]').forEach(function(el, i) {
              try {
                const content = el.textContent.trim();
                if (content.length > 0) {
                  const key = 'json-script-' + i;
                  try {
                    const parsed = JSON.parse(content);
                    jsonScripts.push({
                      key: key,
                      topLevelKeys: Object.keys(parsed).slice(0, 20)
                    });
                  } catch(e) {
                    jsonScripts.push({
                      key: key,
                      preview: content.substring(0, 200)
                    });
                  }
                }
              } catch(e) {}
            });
            if (jsonScripts.length > 0) {
              results.jsonScripts = jsonScripts;
            }
          } catch(e) {}

          // 5. Check video element and its tracks
          try {
            const video = document.querySelector('video');
            if (video) {
              results.videoElement = {};
              if (video.textTracks) {
                results.videoElement.textTracks = Array.from(video.textTracks).map(function(t) {
                  return {
                    id: t.id,
                    kind: t.kind,
                    language: t.language,
                    label: t.label,
                    mode: t.mode
                  };
                });
              }
            }
          } catch(e) {
            results.videoError = e.message;
          }

          // Post results back to content script
          window.postMessage({
            __nst: 'api-explorer-results',
            results: results
          }, '*');

          console.log('[NST-API-Explorer] Results:', results);

          return results;
        };

        // Also try to intercept network requests by monkey-patching fetch and XHR
        (function() {
          const originalFetch = window.fetch;
          window.fetch = function() {
            const url = arguments[0];
            if (url && typeof url === 'string' && url.indexOf('nflxvideo') >= 0 || url.indexOf('timedtext') >= 0 || url.indexOf('/?o=') >= 0) {
              console.log('[NST-API-Explorer] Fetch intercepted:', url);
              window.postMessage({
                __nst: 'netflix-fetch',
                url: url
              }, '*');
            }
            return originalFetch.apply(this, arguments);
          };

          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            if (url && (url.indexOf('nflxvideo') >= 0 || url.indexOf('timedtext') >= 0 || url.indexOf('/?o=') >= 0)) {
              console.log('[NST-API-Explorer] XHR intercepted:', method, url);
              window.postMessage({
                __nst: 'netflix-xhr',
                method: method,
                url: url
              }, '*');

              // Try to capture the response
              const xhr = this;
              xhr.addEventListener('load', function() {
                try {
                  window.postMessage({
                    __nst: 'netflix-xhr-response',
                    url: url,
                    status: xhr.status,
                    contentType: xhr.getResponseHeader('Content-Type'),
                    responseLength: xhr.response ? xhr.response.length : 0
                  }, '*');
                } catch(e) {}
              });
            }
            return originalOpen.apply(this, arguments);
          };
        })();

        console.log('[NST-API-Explorer] Call __nstExplore() in console to explore');
      }.toString() + ')();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      LOG('Explorer script injected');
    } catch(e) {
      WARN('Failed to inject explorer script:', e.message);
    }
  }

  /**
   * Initialize the API research module
   */
  function init() {
    LOG('API Research module initialized');

    // Inject the explorer script
    injectExplorerScript();

    // Listen for messages from the injected script
    window.addEventListener('message', function(ev) {
      if (ev.source !== window || !ev.data) return;

      if (ev.data.__nst === 'api-explorer-results') {
        LOG('API explorer results:', ev.data.results);
      }

      if (ev.data.__nst === 'netflix-fetch') {
        LOG('Netflix fetch detected:', ev.data.url);
      }

      if (ev.data.__nst === 'netflix-xhr') {
        LOG('Netflix XHR detected:', ev.data.method, ev.data.url);
      }

      if (ev.data.__nst === 'netflix-xhr-response') {
        LOG('Netflix XHR response:', ev.data.url, ev.data.status, ev.data.contentType);
      }
    });
  }

  // Export public API
  NST.netflix = NST.netflix || {};
  NST.netflix.apiResearch = {
    init: init,
    explore: function() {
      // This only works if injected into page context
      LOG('Explore called from content script - call __nstExplore() in page console instead');
      window.postMessage({ __nst: 'do-explore' }, '*');
    }
  };

  // Initialize
  init();

})(window.NST = window.NST || {});
