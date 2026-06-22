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

	// ---- AI optimize button -------------------------------------------------
	var AI_SERVER_BASE = 'http://127.0.0.1:31314';
	var aiPollHandle = null;

	function setAIStatus(msg, isError) {
		var el = document.querySelector('#ai-status');
		if (!el) return;
		el.textContent = msg || '';
		el.classList.toggle('error', !!isError);
	}

	function downloadText(filename, text) {
		var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		setTimeout(function() {
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}, 100);
	}

	function aiFetchJSON(url, opts) {
		return fetch(url, opts).then(function(r) {
			return r.text().then(function(txt) {
				var data;
				try { data = JSON.parse(txt); } catch(e) { data = { ok: false, error: 'Non-JSON response: ' + txt.slice(0, 200) }; }
				if (!r.ok && !data.error) data.error = 'HTTP ' + r.status;
				return data;
			});
		});
	}

	async function runAIOptimize() {
		var btn = document.querySelector('#ai-optimize');
		if (btn.disabled) return;
		setAIStatus('正在检查本地服务…', false);

		var activeTab;
		var tabs = await new Promise(function(res) { chrome.tabs.query({ active: true, currentWindow: true }, res); });
		activeTab = tabs[0];
		if (!activeTab || !activeTab.url || !activeTab.url.match(/netflix\.com\/watch\//)) {
			setAIStatus('请先打开 Netflix 播放页。', true);
			return;
		}

		// Check health endpoint first
		try {
			var health = await aiFetchJSON(AI_SERVER_BASE + '/api/health');
			if (!health || !health.ok) throw new Error('health check failed');
		} catch(e) {
			setAIStatus('本地服务未启动，请先运行：python3 server/nst_server.py', true);
			return;
		}

		// Ask content script for payload
		var payloadResp = await new Promise(function(res) {
			chrome.tabs.sendMessage(activeTab.id, { getAIPayload: true }, function(r) {
				if (chrome.runtime.lastError) res(null); else res(r);
			});
		});
		if (!payloadResp || !payloadResp.ok || !payloadResp.payload) {
			setAIStatus(payloadResp && payloadResp.error ? payloadResp.error : '无法获取字幕数据。', true);
			return;
		}
		var pl = payloadResp.payload;
		if (!pl.org || pl.org.length < 50) {
			setAIStatus('字幕内容太少，先导出/抓取字幕后再试。', true);
			return;
		}

		setAIStatus('正在上传到本地服务…', false);
		btn.disabled = true;

		// Build multipart form
		var form = new FormData();
		form.append('org', pl.org);
		if (pl.title) form.append('title', pl.title);
		if (pl.url) form.append('url', pl.url);
		if (pl.srcLang) form.append('src_lang', pl.srcLang);
		if (pl.tgtLang) form.append('tgt_lang', pl.tgtLang);
		if (pl.srcTTML) {
			form.append('src_ttml', new Blob([pl.srcTTML], { type: 'text/xml' }), 'source.ttml');
		}
		if (pl.tgtTTML) {
			form.append('tgt_ttml', new Blob([pl.tgtTTML], { type: 'text/xml' }), 'target.ttml');
		}

		var submit;
		try {
			submit = await aiFetchJSON(AI_SERVER_BASE + '/api/optimize', { method: 'POST', body: form });
		} catch(e) {
			setAIStatus('上传失败：' + e.message, true);
			btn.disabled = false;
			return;
		}
		if (!submit || !submit.job_id) {
			setAIStatus((submit && submit.error) ? submit.error : '提交任务失败。', true);
			btn.disabled = false;
			return;
		}
		var jobId = submit.job_id;
		setAIStatus('Claude 正在优化字幕，请稍候…（可能需要数分钟）', false);

		// Poll status
		var pollInterval = 3000;
		var pollStart = Date.now();
		function poll() {
			aiFetchJSON(AI_SERVER_BASE + '/api/status/' + encodeURIComponent(jobId)).then(function(status) {
				if (!status) {
					setAIStatus('获取状态失败，请重试。', true);
					btn.disabled = false;
					return;
				}
				if (status.status === 'running' || status.status === 'queued') {
					var elapsed = Math.round((Date.now() - pollStart) / 1000);
					setAIStatus('优化中… ' + elapsed + 's（claude 工作中）', false);
					aiPollHandle = setTimeout(poll, pollInterval);
					return;
				}
				if (status.status === 'error') {
					setAIStatus('优化失败：' + (status.error || 'unknown'), true);
					btn.disabled = false;
					return;
				}
				if (status.status === 'done' && status.result) {
					setAIStatus('优化完成，正在导入并下载…', false);
					var revised = status.result;
					// Download as .org file
					var safeTitle = (pl.title || 'subtitles').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
					var fname = 'Revised-' + safeTitle + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.org';
					downloadText(fname, revised);
					// Import back into panel/DB
					chrome.tabs.sendMessage(activeTab.id, { importAIResult: revised }, function(resp) {
						if (chrome.runtime.lastError) {
							setAIStatus('已下载但自动导入失败：' + chrome.runtime.lastError.message, true);
						} else if (resp && resp.ok) {
							setAIStatus('完成！已导入 ' + resp.count + ' 条修订字幕。', false);
						} else {
							setAIStatus('已下载，自动导入错误：' + ((resp && resp.error) || 'unknown'), true);
						}
						btn.disabled = false;
					});
					return;
				}
				// Unexpected status
				setAIStatus('未知状态：' + status.status, true);
				btn.disabled = false;
			}).catch(function(e) {
				setAIStatus('状态查询失败：' + e.message, true);
				btn.disabled = false;
			});
		}
		poll();
	}

	document.querySelector('#ai-optimize').addEventListener('click', function() {
		runAIOptimize();
	});

	document.addEventListener('DOMContentLoaded', restore_options);

	// Poll for updated language status every 2 seconds
	setInterval(requestAvailableLanguages, 2000);
})();
