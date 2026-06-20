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
			scrollThreshold: 85
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
					try { chrome.tabs.sendMessage(tabs[0].id, { updateOverlaySettings: true }); } catch(e) {}
				}
			});
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
})()
