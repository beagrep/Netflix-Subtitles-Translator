/**
 * Netflix Subtitles Translator - Configuration Module
 * Handles user options and global configuration.
 */
(function(NST) {
	'use strict';

	const LOG = function() { try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e) {} };
	const WARN = function() { try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e) {} };

	// Selector constants
	const SELECTORS = {
		mainWrap: 'translate-ext',
		subtitleWrap: 'subtitle-wrap',
		translatedSentence: 'sent-tr-open',
		translationWrap: 'translation-wrap',
		openRightPanel: 'open-tr-panel',
		closeRightPanel: 'tr-close-x',
		imgWrap: 'img-tr-wrap',
		imgWrapTitle: 'img-tr-tile',
		descriptionWrap: 'describe-tr-wrap',
		descriptionTitle: 'describe-tr-title',
		mainTranslateId: 'translate-ext-main-tr',
		mainTranslateOpenClass: 'open-bg-tr'
	};

	// API endpoint bases
	const API_BASES = {
		gimages: 'https://www.googleapis.com/customsearch/v1?&num=9&cx=017663620470495640824%3A3gyica0r5wy&filter=1&imgType=photo&safe=high&searchType=image&start=1&key=AIzaSyB4irElN8L3wOVcwwa2Pnobm-FJOc2m8&q=',
		gtansBase: 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1&source=icon',
		ftranBase: 'https://translate.googleapis.com/translate_a/single?client=gtx&hl=en-US&dt=t&dt=bd&dj=1'
	};

	// Global state (same structure as original content-script.js)
	const config = {
		launched: false,
		user: {
			lang: 'en',
			srcLang: 'auto',
			delay: true,
			showsec: 5,
			images: false,
			overlayEnabled: true,
			overlayPosition: 30,
			overlaySize: 1.75,
			overlayDuration: 5
		},
		SELECTORS: SELECTORS,
		API_BASES: API_BASES
	};

	/**
	 * Normalize text for translation - replace newlines with spaces
	 */
	function normalizeForTranslate(text) {
		return (text || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
	}

	/**
	 * Build Google Translate URL for full sentence translation
	 */
	function gtansUrl(text) {
		return API_BASES.gtansBase +
			'&sl=' + encodeURIComponent(config.user.srcLang || 'auto') +
			'&tl=' + encodeURIComponent(config.user.lang || 'en') +
			'&q=' + encodeURIComponent(normalizeForTranslate(text));
	}

	/**
	 * Build Google Translate URL for detailed word translation (with dictionary)
	 */
	function ftranUrl(text) {
		return API_BASES.ftranBase +
			'&sl=' + encodeURIComponent(config.user.srcLang || 'auto') +
			'&tl=' + encodeURIComponent(config.user.lang || 'en') +
			'&q=' + encodeURIComponent(normalizeForTranslate(text));
	}

	/**
	 * Load user options from chrome.storage.sync
	 */
	function getOptions(callback) {
		chrome.storage.sync.get({
			lang: 'en',
			srcLang: 'auto',
			showsec: 5,
			delay: true,
			images: false,
			overlayEnabled: true,
			overlayPosition: 30,
			overlaySize: 1.75,
			overlayDuration: 5
		}, function(items) {
			config.user.lang = items.lang;
			config.user.srcLang = items.srcLang;
			config.user.delay = items.delay;
			config.user.showsec = items.showsec;
			config.user.images = items.images;
			config.user.overlayEnabled = items.overlayEnabled;
			config.user.overlayPosition = items.overlayPosition;
			config.user.overlaySize = items.overlaySize;
			config.user.overlayDuration = items.overlayDuration;
			LOG('options loaded:', config.user);
			if (callback) callback(config.user);
		});
	}

	/**
	 * Listen for storage changes and reload options
	 */
	function setupStorageListener() {
		chrome.storage.onChanged.addListener(function(changes, area) {
			if (area !== 'sync') return;
			LOG('options changed:', changes);
			getOptions();
		});
	}

	/**
	 * Initialize config module
	 */
	function init() {
		getOptions();
		setupStorageListener();
	}

	// Export public API - the entire config object for compatibility
	NST.config = NST.config || {};
	for (let key in config) {
		NST.config[key] = config[key];
	}
	NST.config.gtansUrl = gtansUrl;
	NST.config.ftranUrl = ftranUrl;
	NST.config.getOptions = getOptions;

	// Initialize immediately
	init();

})(window.NST = window.NST || {})