(function() {
	'use strict';

	function restore_options() {
		chrome.storage.sync.get({
			lang: 'en',
			srcLang: 'auto',
			overlayEnabled: true,
			overlayPosition: 30,
			overlaySize: 1.75,
			overlayDuration: 5,
			scrollThreshold: 85,
			useOfficialSubtitles: false,
			officialSourceLang: '',
			officialTargetLang: ''
		}, function(items) {
			document.querySelector('#lang').value = items.lang;
			document.querySelector('#srcLang').value = items.srcLang;
			document.querySelector('#overlayEnabled').checked = items.overlayEnabled;
			document.querySelector('#overlayPosition').value = items.overlayPosition;
			document.querySelector('#overlayPositionValue').textContent = items.overlayPosition;
			document.querySelector('#overlaySize').value = items.overlaySize;
			document.querySelector('#overlaySizeValue').textContent = items.overlaySize;
			document.querySelector('#overlayDuration').value = items.overlayDuration;
			document.querySelector('#overlayDurationValue').textContent = items.overlayDuration;
			document.querySelector('#scrollThreshold').value = items.scrollThreshold;
			document.querySelector('#scrollThresholdValue').textContent = items.scrollThreshold;
			document.querySelector('#useOfficialSubtitles').checked = items.useOfficialSubtitles;

			// Try to get available languages from content script
			requestAvailableLanguages();
		});
	}

	function flashStatus(msg) {
		var status = document.querySelector('#status');
		status.textContent = msg;
		setTimeout(function() { status.textContent = ''; }, 2500);
	}

	function saveAndNotify(key, value, msg) {
		var settings = {};
		settings[key] = value;
		chrome.storage.sync.set(settings, function() {
			flashStatus(msg);
			// Also notify the active tab to update immediately
			chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
				if (tabs[0]) {
					try { chrome.tabs.sendMessage(tabs[0].id, { updateOverlaySettings: true }); } catch(e){}
				}
			});
		});
	}

	// Request available subtitle languages from content script
	function requestAvailableLanguages() {
		chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
			if (!tabs[0]) return;

			// Check if URL looks like Netflix
			if (!tabs[0].url || !tabs[0].url.match(/netflix\.com/)) {
				updateLanguageDropdowns([]);
				return;
			}

			try {
				chrome.tabs.sendMessage(tabs[0].id, { getAvailableLanguages: true }, function(response) {
					if (chrome.runtime.lastError) {
						console.log('Could not get languages:', chrome.runtime.lastError.message);
						return;
					}
					if (response && response.languages) {
						updateLanguageDropdowns(response.languages);
						updateLanguageStatus(response.captured);
					}
				});
			} catch(e) {
				console.log('Error requesting languages:', e);
			}
		});
	}

	// Update the language dropdowns with available Netflix languages
	function updateLanguageDropdowns(languages) {
		var sourceSelect = document.querySelector('#officialSourceLang');
		var targetSelect = document.querySelector('#officialTargetLang');

		// Clear existing options
		sourceSelect.innerHTML = '';
		targetSelect.innerHTML = '';

		if (!languages || languages.length === 0) {
			sourceSelect.innerHTML = '<option value="">未找到字幕语言</option>';
			targetSelect.innerHTML = '<option value="">未找到字幕语言</option>';
			sourceSelect.disabled = true;
			targetSelect.disabled = true;
			return;
		}

		// Add options
		languages.forEach(function(lang) {
			var label = lang.label || lang.language;
			var sourceOption = document.createElement('option');
			sourceOption.value = lang.language;
			sourceOption.textContent = label;
			sourceSelect.appendChild(sourceOption);

			var targetOption = document.createElement('option');
			targetOption.value = lang.language;
			targetOption.textContent = label;
			targetSelect.appendChild(targetOption);
		});

		// Restore saved selections
		chrome.storage.sync.get({
			officialSourceLang: '',
			officialTargetLang: ''
		}, function(items) {
			if (items.officialSourceLang) {
				sourceSelect.value = items.officialSourceLang;
			}
			if (items.officialTargetLang) {
				targetSelect.value = items.officialTargetLang;
			}
		});

		sourceSelect.disabled = false;
		targetSelect.disabled = false;
	}

	// Update the status display for captured languages
	function updateLanguageStatus(captured) {
		var sourceStatus = document.querySelector('#officialSourceStatus');
		var targetStatus = document.querySelector('#officialTargetStatus');

		if (!captured) {
			sourceStatus.textContent = '未获取';
			targetStatus.textContent = '未获取';
			return;
		}

		chrome.storage.sync.get({
			officialSourceLang: '',
			officialTargetLang: ''
		}, function(items) {
			if (items.officialSourceLang && captured[items.officialSourceLang]) {
				sourceStatus.textContent = '已获取 ' + captured[items.officialSourceLang] + ' 条';
				sourceStatus.style.color = '#2a8a2a';
			} else if (items.officialSourceLang) {
				sourceStatus.textContent = '未获取 (请在 Netflix 中选择该字幕)';
				sourceStatus.style.color = '#d33030';
			} else {
				sourceStatus.textContent = '未选择';
			}

			if (items.officialTargetLang && captured[items.officialTargetLang]) {
				targetStatus.textContent = '已获取 ' + captured[items.officialTargetLang] + ' 条';
				targetStatus.style.color = '#2a8a2a';
			} else if (items.officialTargetLang) {
				targetStatus.textContent = '未获取 (请在 Netflix 中选择该字幕)';
				targetStatus.style.color = '#d33030';
			} else {
				targetStatus.textContent = '未选择';
			}
		});
	}

	document.querySelector('#lang').addEventListener('change', function(e) {
		saveAndNotify('lang', e.target.value, 'Target saved.');
	});

	document.querySelector('#srcLang').addEventListener('change', function(e) {
		saveAndNotify('srcLang', e.target.value, 'Source saved.');
	});

	document.querySelector('#overlayEnabled').addEventListener('change', function(e) {
		saveAndNotify('overlayEnabled', e.target.checked, 'Overlay ' + (e.target.checked ? 'enabled' : 'disabled') + '.');
	});

	document.querySelector('#overlayPosition').addEventListener('input', function(e) {
		document.querySelector('#overlayPositionValue').textContent = e.target.value;
	});
	document.querySelector('#overlayPosition').addEventListener('change', function(e) {
		saveAndNotify('overlayPosition', parseInt(e.target.value, 10), 'Position saved.');
	});

	document.querySelector('#overlaySize').addEventListener('input', function(e) {
		document.querySelector('#overlaySizeValue').textContent = e.target.value;
	});
	document.querySelector('#overlaySize').addEventListener('change', function(e) {
		saveAndNotify('overlaySize', parseFloat(e.target.value), 'Size saved.');
	});

	document.querySelector('#overlayDuration').addEventListener('input', function(e) {
		document.querySelector('#overlayDurationValue').textContent = e.target.value;
	});
	document.querySelector('#overlayDuration').addEventListener('change', function(e) {
		saveAndNotify('overlayDuration', parseInt(e.target.value, 10), 'Duration saved.');
	});

	document.querySelector('#scrollThreshold').addEventListener('input', function(e) {
		document.querySelector('#scrollThresholdValue').textContent = e.target.value;
	});
	document.querySelector('#scrollThreshold').addEventListener('change', function(e) {
		saveAndNotify('scrollThreshold', parseInt(e.target.value, 10), 'Scroll threshold saved.');
	});

	// Official subtitle toggle
	document.querySelector('#useOfficialSubtitles').addEventListener('change', function(e) {
		saveAndNotify('useOfficialSubtitles', e.target.checked, '官方字幕 ' + (e.target.checked ? '已启用' : '已禁用'));
	});

	// Official source language selector
	document.querySelector('#officialSourceLang').addEventListener('change', function(e) {
		var lang = e.target.value;
		chrome.storage.sync.set({ officialSourceLang: lang }, function() {
			flashStatus('官方源语言已设置');
			// Notify content script to capture this language
			chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
				if (tabs[0]) {
					try {
						chrome.tabs.sendMessage(tabs[0].id, { captureLanguage: lang }, function(response) {
							// Refresh status after a delay
							setTimeout(requestAvailableLanguages, 1000);
						});
					} catch(e){}
				}
			});
		});
	});

	// Official target language selector
	document.querySelector('#officialTargetLang').addEventListener('change', function(e) {
		var lang = e.target.value;
		chrome.storage.sync.set({ officialTargetLang: lang }, function() {
			flashStatus('官方目标语言已设置');
			// Notify content script to capture this language
			chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
				if (tabs[0]) {
					try {
						chrome.tabs.sendMessage(tabs[0].id, { captureLanguage: lang }, function(response) {
							// Refresh status after a delay
							setTimeout(requestAvailableLanguages, 1000);
						});
					} catch(e){}
				}
			});
		});
	});

	document.querySelector('#toggle').addEventListener('click', function() {
		chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
			if (!tabs[0]) return;
			chrome.tabs.sendMessage(tabs[0].id, { buttonClick: true }, function() {});
		});
	});

	document.querySelector('#export').addEventListener('click', function() {
		chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
			if (!tabs[0]) return;
			chrome.tabs.sendMessage(tabs[0].id, { exportOrg: true }, function(resp) {
				if (chrome.runtime.lastError) {
					flashStatus('Open Netflix first.');
					return;
				}
				if (resp && resp.ok) {
					flashStatus('Exported ' + resp.count + ' subtitles.');
				} else {
					flashStatus(resp && resp.error ? resp.error : 'No subtitles yet.');
				}
			});
		});
	});

	document.querySelector('#import').addEventListener('click', function() {
		document.querySelector('#import-file').click();
	});

	document.querySelector('#import-file').addEventListener('change', function(e) {
		var file = e.target.files[0];
		if (!file) return;

		var reader = new FileReader();
		reader.onload = function(ev) {
			var content = ev.target.result;
			chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
				if (!tabs[0]) return;
				chrome.tabs.sendMessage(tabs[0].id, { importOrg: content }, function(resp) {
					if (chrome.runtime.lastError) {
						flashStatus('Open Netflix first.');
						return;
					}
					if (resp && resp.ok) {
						flashStatus('Imported ' + resp.count + ' subtitles.');
					} else {
						flashStatus(resp && resp.error ? resp.error : 'Import failed.');
					}
				});
			});
		};
		reader.readAsText(file);
		// Reset the file input so the same file can be selected again
		e.target.value = '';
	});

	document.querySelector('#clear-db').addEventListener('click', function() {
		chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
			if (!tabs[0]) return;
			chrome.tabs.sendMessage(tabs[0].id, { clearSubtitleDB: true }, function(resp) {
				if (chrome.runtime.lastError) {
					flashStatus('Open Netflix first.');
					return;
				}
				if (resp && resp.ok) {
					flashStatus('Cleared ' + resp.count + ' from DB.');
				} else {
					flashStatus(resp && resp.error ? resp.error : 'No subtitles to clear.');
				}
			});
		});
	});

	document.querySelector('#open-options').addEventListener('click', function(e) {
		e.preventDefault();
		if (chrome.runtime.openOptionsPage) {
			chrome.runtime.openOptionsPage();
		} else {
			chrome.tabs.create({ url: 'options.html' });
		}
	});

	document.addEventListener('DOMContentLoaded', restore_options);

	// Poll for updated language status every 2 seconds
	setInterval(requestAvailableLanguages, 2000);
})();
