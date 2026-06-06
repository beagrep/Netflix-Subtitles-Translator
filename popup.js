(function() {
	'use strict';

	function restore_options() {
		chrome.storage.sync.get({
			lang: 'en',
			srcLang: 'auto',
		}, function(items) {
			document.querySelector('#lang').value = items.lang;
			document.querySelector('#srcLang').value = items.srcLang;
		});
	}

	function flashStatus(msg) {
		var status = document.querySelector('#status');
		status.textContent = msg;
		setTimeout(function() { status.textContent = ''; }, 2500);
	}

	document.querySelector('#lang').addEventListener('change', function(e) {
		chrome.storage.sync.set({ lang: e.target.value }, function() {
			flashStatus('Target saved. Reload Netflix to apply.');
		});
	});

	document.querySelector('#srcLang').addEventListener('change', function(e) {
		chrome.storage.sync.set({ srcLang: e.target.value }, function() {
			flashStatus('Source saved. Reload Netflix to apply.');
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
					flashStatus('Open a Netflix tab first.');
					return;
				}
				if (resp && resp.ok) {
					flashStatus('Exported ' + resp.count + ' subtitles.');
				} else {
					flashStatus(resp && resp.error ? resp.error : 'No subtitles captured yet.');
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
})();
