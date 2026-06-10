/**
 * Netflix Subtitles Translator - Center Translator Module
 * Manages the overlay center translation display.
 */
(function(NST) {
	'use strict';

	const config = NST.config || {
		SELECTORS: {
			mainTranslateId: 'translate-ext-main-tr',
			mainTranslateOpenClass: 'open-bg-tr'
		},
		user: {}
	};

	const loadJson = NST.utils ? NST.utils.loadJson : function() {};
	const gtansUrl = NST.config ? NST.config.gtansUrl : function() { return ''; };

	let currentSentence = null;
	let hideTimeout = null;

	/**
	 * Get the center translator element
	 */
	function getEl() {
		return document.getElementById(config.SELECTORS.mainTranslateId);
	}

	/**
	 * Apply the current settings to the overlay element
	 */
	function applySettings() {
		const el = getEl();
		if (!el) return;
		// Apply position and size via CSS variables
		if (typeof config.user.overlayPosition === 'number') {
			el.style.setProperty('--nst-overlay-position', config.user.overlayPosition + '%');
		}
		if (typeof config.user.overlaySize === 'number') {
			el.style.setProperty('--nst-overlay-size', config.user.overlaySize + 'vw');
		}
	}

	/**
	 * Initialize with a sentence (set up click listeners on subtitle DOM)
	 */
	function init(sentence, subtitleContainer) {
		currentSentence = sentence;
		applySettings();
	}

	/**
	 * Translate a sentence and show in center overlay
	 */
	function translate(sentence) {
		const el = getEl();
		if (!el) return;

		clear();

		loadJson(gtansUrl(sentence), function(data) {
			if (!data) return;

			let gtrans = '';
			data['sentences'].forEach(function(s) {
				gtrans += s.trans + ' ';
			});
			gtrans = gtrans.trim();

			if (gtrans !== '') {
				el.textContent = gtrans;
				show();
			}
		});
	}

	/**
	 * Show a translation directly (already translated)
	 */
	function showTranslation(translation) {
		const el = getEl();
		if (!el || !translation) return;

		// Check if overlay is enabled
		if (!config.user.overlayEnabled) {
			clear();
			return;
		}

		// Clear any existing first
		clear();

		// Apply current settings
		applySettings();

		// Preserve line breaks in the display
		if (translation.indexOf('\n') >= 0) {
			el.innerHTML = translation.replace(/\r?\n/g, '<br>');
		} else {
			el.textContent = translation;
		}

		// Show it
		show();
	}

	/**
	 * Show the center translator
	 */
	function show() {
		const el = getEl();
		if (!el) return;
		// Don't show if disabled
		if (!config.user.overlayEnabled) return;

		// Clear any existing timeout
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}

		el.classList.add(config.SELECTORS.mainTranslateOpenClass);

		// Set timeout to hide if duration > 0
		const duration = typeof config.user.overlayDuration === 'number' ? config.user.overlayDuration : 5;
		if (duration > 0) {
			hideTimeout = setTimeout(function() {
				clear();
				hideTimeout = null;
			}, duration * 1000);
		}
	}

	/**
	 * Clear and hide the center translator
	 */
	function clear() {
		const el = getEl();
		if (!el) return;

		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}

		el.classList.remove(config.SELECTORS.mainTranslateOpenClass);
		el.textContent = '';
		el.innerHTML = '';
	}

	// Export public API
	NST.ui = NST.ui || {};
	NST.ui.centerTranslator = {
		init: init,
		translate: translate,
		showTranslation: showTranslation,
		show: show,
		clear: clear,
		applySettings: applySettings
	};

})(window.NST = window.NST || {})