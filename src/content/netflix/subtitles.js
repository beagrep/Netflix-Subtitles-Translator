/**
 * Netflix Subtitles Translator - Netflix Subtitle Reader Module
 * Handles extraction of subtitles from Netflix's DOM.
 */
(function(NST) {
  'use strict';

  const LOG = NST.utils ? NST.utils.LOG : function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };

  /**
   * Helper to extract text with line breaks by looking at element positions
   */
  function extractTextWithLineBreaks(container) {
    if (!container) return [];

    const lines = [];
    const seen = new Set();

    try {
      // Strategy 0: Look for <br> tags explicitly - this is the most reliable
      try {
        // Clone the container to avoid modifying the real DOM
        const clone = container.cloneNode(true);

        // Find all br tags and replace them with a marker
        const brs = clone.querySelectorAll('br');
        brs.forEach(function(br) {
          br.parentNode.insertBefore(document.createTextNode('\n__BR_MARKER__\n'), br);
          br.parentNode.removeChild(br);
        });

        // Now get the text and split on our marker
        const textWithMarkers = clone.textContent || '';
        if (textWithMarkers) {
          const candidateLines = textWithMarkers.split('__BR_MARKER__')
            .map(function(l) { return l.replace(/\s+/g, ' ').trim(); })
            .filter(function(l) { return l; });

          if (candidateLines.length > 0) {
            candidateLines.forEach(function(l) {
              if (!seen.has(l)) {
                seen.add(l);
                lines.push(l);
              }
            });
            if (lines.length > 1) {
              LOG('extractSubtitle: found lines via <br>:', lines);
              return lines;
            }
            // Reset if only one line
            lines.length = 0;
            seen.clear();
          }
        }
      } catch(e) {
        LOG('br strategy failed:', e);
      }

      // Strategy 1: Look for direct child elements that might be lines
      // Often Netflix has each line in its own div/span at the same level
      try {
        const children = Array.from(container.children);
        if (children.length > 0) {
          // Check each child for text
          children.forEach(function(child) {
            const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) {
              // Check if this child has its own children with text (avoid nesting)
              const childChildren = child.querySelectorAll('*');
              let isSimpleContainer = true;
              childChildren.forEach(function(cc) {
                const ccText = (cc.textContent || '').trim();
                if (ccText === text) {
                  isSimpleContainer = false; // Child contains same text, probably a wrapper
                }
              });
              // Also check if this text is just a subset of an existing line
              let isSubset = false;
              lines.forEach(function(existingLine) {
                if (existingLine.indexOf(text) >= 0 || text.indexOf(existingLine) >= 0) {
                  isSubset = true;
                }
              });
              if (!isSubset && !seen.has(text)) {
                seen.add(text);
                lines.push(text);
              }
            }
          });

          if (lines.length > 1) {
            LOG('extractSubtitle: found lines via direct children:', lines);
            return lines;
          }
          // Reset if only one line or none
          lines.length = 0;
          seen.clear();
        }
      } catch(e) {
        LOG('direct children strategy failed:', e);
      }

      // Strategy 2: Look for elements that are visually distinct lines
      // Netflix often uses multiple elements positioned at different y-coordinates
      try {
        const allTextElements = [];

        // Collect all elements with non-empty text
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
          null,
          false
        );

        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text && node.parentElement) {
              const parent = node.parentElement;
              // Try to get position if possible
              let rect = null;
              try {
                rect = parent.getBoundingClientRect();
              } catch(e) {}
              allTextElements.push({
                text: text,
                parent: parent,
                y: rect ? rect.top : 0,
                height: rect ? rect.height : 0
              });
            }
          }
        }

        // If we found elements with positions, group by y-coordinate (approximate)
        if (allTextElements.length > 0) {
          // Sort by vertical position
          allTextElements.sort(function(a, b) { return a.y - b.y; });

          // Group into lines by approximate y position (within 10px)
          const tolerance = 10;
          let currentLine = [];
          let currentY = null;

          allTextElements.forEach(function(el) {
            if (currentY === null) {
              currentY = el.y;
              currentLine.push(el.text);
            } else if (Math.abs(el.y - currentY) <= tolerance) {
              // Same line - join horizontally
              currentLine.push(el.text);
            } else {
              // New line
              if (currentLine.length > 0) {
                // Deduplicate within the same line first
                const lineText = currentLine.join(' ').replace(/\s+/g, ' ').trim();
                if (lineText && !seen.has(lineText)) {
                  seen.add(lineText);
                  lines.push(lineText);
                }
              }
              currentY = el.y;
              currentLine = [el.text];
            }
          });

          // Add the last line
          if (currentLine.length > 0) {
            const lineText = currentLine.join(' ').replace(/\s+/g, ' ').trim();
            if (lineText && !seen.has(lineText)) {
              seen.add(lineText);
              lines.push(lineText);
            }
          }

          if (lines.length > 1) {
            LOG('extractSubtitle: found lines via position:', lines);
            return lines;
          }
          // Reset if only one line
          lines.length = 0;
          seen.clear();
        }
      } catch(e) {
        LOG('position strategy failed:', e);
      }

      // Strategy 3: Try specific selectors Netflix uses
      try {
        const selectors = [
          '.player-timedtext-text-container',
          '.player-timedtext-text',
          '[data-timedtext-line]',
          'div > div',
          'div > span',
          'span'
        ];

        for (let s = 0; s < selectors.length && lines.length === 0; s++) {
          const selector = selectors[s];
          try {
            const elements = container.querySelectorAll(selector);
            if (elements.length >= 2) { // Only try if multiple elements found
              const tempLines = [];
              const tempSeen = new Set();
              elements.forEach(function(el) {
                const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (text && !tempSeen.has(text)) {
                  // Check if this is just the parent containing the same text
                  let isRedundant = false;
                  tempLines.forEach(function(tl) {
                    if (tl.indexOf(text) >= 0 || text.indexOf(tl) >= 0) {
                      isRedundant = true;
                    }
                  });
                  if (!isRedundant) {
                    tempSeen.add(text);
                    tempLines.push(text);
                  }
                }
              });
              // Only use if we found multiple lines that aren't just subsets
              if (tempLines.length >= 2) {
                tempLines.forEach(function(tl) {
                  lines.push(tl);
                  seen.add(tl);
                });
                LOG('extractSubtitle: found lines via selector', selector, ':', lines);
                return lines;
              }
            }
          } catch(e) {}
        }
      } catch(e) {
        LOG('selector strategy failed:', e);
      }

      // Strategy 4: Fallback - just get all text but try to detect natural breaks
      const fullText = (container.textContent || '').trim();
      if (fullText) {
        // Special case for the user's screenshot pattern: "- [로기]...- [터그]..."
        // Split when we see "- [" or "[-..." that's not at the start
        let processed = fullText;

        // First, normalize known speaker tag patterns
        // Korean pattern: "- [로기] ...- [터그]"
        processed = processed.replace(/(\s-\s\[)/g, '\n- [');
        processed = processed.replace(/([^\n])(-\[)/g, '$1\n$2');

        // Also split before dash-prefixed lines that look like new speakers
        processed = processed.replace(/(\s-)(?=\s?\[)/g, '\n-');

        // Look for patterns like speaker tags [-NAME-] that might indicate line breaks
        // Try to split before speaker tags like [-NAME-] or [NAME]
        processed = processed.replace(/(\[[-가-힣\w]+\])/g, '\n$1');

        // Clean up and split
        const candidateLines = processed.split('\n')
          .map(function(l) { return l.replace(/\s+/g, ' ').trim(); })
          .filter(function(l) { return l; });

        candidateLines.forEach(function(l) {
          if (!seen.has(l)) {
            seen.add(l);
            lines.push(l);
          }
        });

        // If still no lines or only one line, just use the whole thing
        if (lines.length === 0) {
          lines.push(fullText);
        }
      }

    } catch(e) {
      LOG('extractSubtitle error:', e && e.message);
    }

    if (lines.length > 1) {
      LOG('extractSubtitle: final lines:', lines);
    }

    return lines;
  }

  /**
   * Extract subtitle text from the Netflix subtitle DOM element
   */
  function extractSubtitle(container) {
    if (!container) return '';

    const lines = extractTextWithLineBreaks(container);

    let joined = lines.join('\n').trim();

    // Handle the case where Netflix duplicates the subtitle (sometimes seen)
    const halves = joined.length % 2 === 0 ? [joined.slice(0, joined.length/2), joined.slice(joined.length/2)] : null;
    if (halves && halves[0] === halves[1]) joined = halves[0];

    if (lines.length > 1) {
      LOG('extractSubtitle: found', lines.length, 'lines:', lines);
    }

    return joined;
  }

  // Export public API
  NST.netflix = NST.netflix || {};
  NST.netflix.subtitles = {
    extractSubtitle: extractSubtitle
  };

})(window.NST = window.NST || {});
