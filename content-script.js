(function(){
	const LOG = function(){ try { console.log.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
	const WARN = function(){ try { console.warn.apply(console, ['[NST]'].concat([].slice.call(arguments))); } catch(e){} };
	LOG('content-script loaded; url=', location.href);

	let translated = [];
	let alltries = [];
	let cache = [];
	
	let config = {

		launched: false,
		
		user: {},
	
		mainWrap: "translate-ext",
		subtitleWrap: "subtitle-wrap",

		translatedSentence: "sent-tr-open",   
			
		translationWrap: "translation-wrap",
		openRightPanel:"open-tr-panel",
		closeRightPanel:"tr-close-x", 
		
		imgWrap: "img-tr-wrap",
		imgWrapTitle: "img-tr-tile",
		
		dsecriptionWrap: "describe-tr-wrap",   
		dsecriptionTitle: "describe-tr-title",
		
		mainTranslateId: "translate-ext-main-tr",
		mainTranslateOpenClass: "open-bg-tr",
			   
		gimages: 'https://www.googleapis.com/customsearch/v1?&num=9&cx=017663620470495640824%3A3gyica0r5wy&filter=1&imgType=photo&safe=high&searchType=image&start=1&key=AIzaSyB4irElN8L3wOVcwwa2PnobvM0-FJOc2m8&q=',
		gtansBase: 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1&source=icon',
		ftranBase: 'https://translate.googleapis.com/translate_a/single?client=gtx&hl=en-US&dt=t&dt=bd&dj=1',
	};

	function gtansUrl(text){
		return config.gtansBase + '&sl=' + encodeURIComponent(config.user.srcLang || 'auto')
			+ '&tl=' + encodeURIComponent(config.user.lang || 'en')
			+ '&q=' + encodeURIComponent(text);
	}
	function ftranUrl(text){
		return config.ftranBase + '&sl=' + encodeURIComponent(config.user.srcLang || 'auto')
			+ '&tl=' + encodeURIComponent(config.user.lang || 'en')
			+ '&q=' + encodeURIComponent(text);
	}
	
	function get_options() {
		  chrome.storage.sync.get({
			lang: 'en',
			srcLang: 'auto',
			showsec: 5,
			delay: true,
			images: false,
		  }, function(items) {
				config.user = {
					lang: items.lang,
					srcLang: items.srcLang,
					delay: items.delay,
					showsec: items.showsec,
					images: items.images,
				}
				LOG('options loaded:', config.user);
		  });
	};

	config.user = { lang: 'en', srcLang: 'auto', delay: true, showsec: 5, images: false };
	get_options();
	chrome.storage.onChanged.addListener(function(changes, area){
		if (area !== 'sync') return;
		LOG('options changed:', changes);
		get_options();
	});


	function createTapeWrap(){

	  let frameDiv = document.createElement('div');
	  frameDiv.id = config.mainWrap;
	  document.body.appendChild(frameDiv);

	  let resizeHandle = document.createElement('div');
	  resizeHandle.id = 'translate-ext-resize-handle';
	  resizeHandle.title = 'Drag to resize panel';
	  frameDiv.appendChild(resizeHandle);

	  let subDiv= document.createElement('div');
	  subDiv.id = config.subtitleWrap;
	  document.querySelector('#'+config.mainWrap).appendChild(subDiv);


	  let wordDiv= document.createElement('div');
	  wordDiv.id = config.translationWrap;
	  document.querySelector('#'+config.mainWrap).appendChild(wordDiv);


	  document.querySelector('#'+config.translationWrap).innerHTML =
				  '<div id="'+config.closeRightPanel+'"></div><div class="tr-title"  id="'+config.dsecriptionTitle+'"></div>\n\
				   <div id="'+config.dsecriptionWrap+'">\n\</div>\n\
				   <div class="tr-title" id="'+config.imgWrapTitle+'"></div> \n\
				   <div id="'+config.imgWrap+'"></div>  \n\
	  ';

	  let centerTranslateDiv = document.createElement('div');
	  centerTranslateDiv.id = config.mainTranslateId;
	  document.body.appendChild(centerTranslateDiv);

	  setupResize(frameDiv, resizeHandle);

	}
	createTapeWrap();

	function applyPanelWidth(px) {
		let frame = document.querySelector('#'+config.mainWrap);
		if (!frame) return;
		let min = 200, max = Math.max(min, window.innerWidth - 100);
		if (px < min) px = min;
		if (px > max) px = max;
		frame.style.width = px + 'px';
		frame.style.maxWidth = 'none';
		frame.querySelectorAll(':scope > *').forEach(function(child){
			if (child.id === 'translate-ext-resize-handle') return;
			child.style.width = px + 'px';
			child.style.minWidth = '0';
			child.style.maxWidth = 'none';
		});
		try {
			let sw = document.querySelector('.sizing-wrapper');
			if (sw && document.body.classList.contains('open-tr-panel')) {
				sw.style.width = 'calc(100vw - ' + px + 'px)';
			}
		} catch(e){}
	}

	function setupResize(frame, handle) {
		try {
			chrome.storage.sync.get({ panelWidth: 0 }, function(items){
				if (items.panelWidth && items.panelWidth > 0) applyPanelWidth(items.panelWidth);
			});
		} catch(e){}

		let dragging = false, startX = 0, startW = 0;
		let overlay = null;

		function makeOverlay(){
			if (overlay) return;
			overlay = document.createElement('div');
			overlay.id = 'nst-drag-overlay';
			overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;cursor:ew-resize;background:transparent;';
			document.body.appendChild(overlay);
		}
		function killOverlay(){
			if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
			overlay = null;
		}

		function onDown(e){
			if (e.button !== 0) return;
			dragging = true;
			startX = e.clientX;
			startW = frame.getBoundingClientRect().width;
			document.body.style.userSelect = 'none';
			handle.classList.add('nst-dragging');
			makeOverlay();
			e.preventDefault();
			e.stopPropagation();
		}
		function onMove(e){
			if (!dragging) return;
			let dx = e.clientX - startX;
			applyPanelWidth(startW + dx);
		}
		function onUp(){
			if (!dragging) return;
			dragging = false;
			document.body.style.userSelect = '';
			handle.classList.remove('nst-dragging');
			killOverlay();
			let w = Math.round(frame.getBoundingClientRect().width);
			try { chrome.storage.sync.set({ panelWidth: w }); } catch(_){}
		}

		handle.addEventListener('mousedown', onDown);
		window.addEventListener('mousemove', onMove, true);
		window.addEventListener('mouseup', onUp, true);
		window.addEventListener('blur', onUp);
		document.addEventListener('mouseleave', onUp);
	}


	function loadJson(url, calback){

		if(cache[url]){
			LOG('fetch (cache hit):', url);
			return calback(cache[url]);
		}

		LOG('fetch start:', url);
		fetch(url).then(function(res) {
					if (res.status >= 200 && res.status < 300) {
						return Promise.resolve(res)
					} else {
						return Promise.reject(new Error('HTTP '+res.status+' '+res.statusText))
					}
				}).then(function(res) {
					return res.json()
				}).then(function(data) {
					LOG('fetch ok:', url);
					cache[url] = data;
					return calback(data);
				}).catch(function(err) {
					WARN('fetch FAILED:', url, '->', err && err.message ? err.message : err);
					try { calback(null); } catch(e){}
				});
	}

	const NST_DB_KEY = 'nstSqliteDump:v1';
	const NST_DB_LEGACY_PREFIX = 'nstTr:v1:';
	let nstDB = (function(){
		let SQL = null, db = null, ready = false;
		let openWaiters = [];
		let saveTimer = null;
		let pendingMigration = null;

		function init() {
			if (typeof initSqlJs !== 'function') {
				WARN('sql.js (initSqlJs) not loaded — DB disabled, falling back to RAM only');
				return;
			}
			initSqlJs({
				locateFile: function(f){ return chrome.runtime.getURL('vendor/sqljs/' + f); }
			}).then(function(SQLLib){
				SQL = SQLLib;
				return loadDump();
			}).then(function(dump){
				try {
					db = dump ? new SQL.Database(dump) : new SQL.Database();
				} catch(e) {
					WARN('failed to open dump, starting fresh:', e && e.message);
					db = new SQL.Database();
				}
				createSchema();
				maybeMigrateLegacyCache();
				ready = true;
				LOG('nstDB ready; rows so far:', stats());
				openWaiters.forEach(function(fn){ try { fn(); } catch(e){} });
				openWaiters = [];
			}).catch(function(e){
				WARN('nstDB init failed:', e && e.message);
			});
		}

		function loadDump() {
			return new Promise(function(resolve){
				try {
					chrome.storage.local.get(NST_DB_KEY, function(items){
						let v = items && items[NST_DB_KEY];
						if (v && v.bytes && Array.isArray(v.bytes)) {
							LOG('nstDB loading existing dump, bytes:', v.bytes.length);
							resolve(new Uint8Array(v.bytes));
						} else {
							resolve(null);
						}
					});
				} catch(e) { resolve(null); }
			});
		}

		function createSchema() {
			db.run([
				'CREATE TABLE IF NOT EXISTS videos (',
				'  video_id TEXT PRIMARY KEY,',
				'  url TEXT NOT NULL,',
				'  title TEXT,',
				'  src_lang TEXT NOT NULL,',
				'  tgt_lang TEXT NOT NULL,',
				'  first_seen INTEGER NOT NULL,',
				'  last_seen INTEGER NOT NULL',
				');',
				'CREATE TABLE IF NOT EXISTS subtitles (',
				'  video_id TEXT NOT NULL,',
				'  video_time REAL NOT NULL,',
				'  original TEXT NOT NULL,',
				'  translation TEXT,',
				'  status TEXT NOT NULL,',
				'  attempts INTEGER NOT NULL DEFAULT 0,',
				'  last_attempt INTEGER,',
				'  PRIMARY KEY (video_id, video_time, original)',
				');',
				'CREATE INDEX IF NOT EXISTS idx_subtitles_video ON subtitles(video_id, video_time);',
				'CREATE TABLE IF NOT EXISTS cache_translations (',
				'  src_lang TEXT NOT NULL,',
				'  tgt_lang TEXT NOT NULL,',
				'  original TEXT NOT NULL,',
				'  translation TEXT NOT NULL,',
				'  ts INTEGER NOT NULL,',
				'  PRIMARY KEY (src_lang, tgt_lang, original)',
				');'
			].join('\n'));
		}

		function maybeMigrateLegacyCache() {
			try {
				chrome.storage.local.get(null, function(items){
					if (!items) return;
					let keys = Object.keys(items).filter(function(k){ return k.indexOf(NST_DB_LEGACY_PREFIX) === 0; });
					if (!keys.length) return;
					LOG('nstDB migrating', keys.length, 'legacy cache entries');
					let stmt = db.prepare('INSERT OR IGNORE INTO cache_translations(src_lang,tgt_lang,original,translation,ts) VALUES (?,?,?,?,?)');
					let now = Date.now();
					keys.forEach(function(k){
						let parts = k.substring(NST_DB_LEGACY_PREFIX.length).split(':');
						if (parts.length < 3) return;
						let src = parts[0], tgt = parts[1];
						let text = parts.slice(2).join(':');
						let v = items[k];
						if (!v || typeof v.t !== 'string') return;
						stmt.run([src, tgt, text, v.t, v.ts || now]);
					});
					stmt.free();
					chrome.storage.local.remove(keys, function(){
						LOG('nstDB migration done; legacy keys removed');
						scheduleSave();
					});
				});
			} catch(e) { WARN('migration failed:', e && e.message); }
		}

		function stats() {
			try {
				let r = db.exec('SELECT (SELECT count(*) FROM videos) v, (SELECT count(*) FROM subtitles) s, (SELECT count(*) FROM cache_translations) c');
				if (r && r[0]) return r[0].values[0];
			} catch(e) {}
			return null;
		}

		function scheduleSave() {
			if (!ready) return;
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(function(){
				saveTimer = null;
				try {
					let bytes = db.export();
					let obj = {};
					obj[NST_DB_KEY] = { bytes: Array.from(bytes), savedAt: Date.now() };
					chrome.storage.local.set(obj, function(){
						if (chrome.runtime.lastError) WARN('nstDB save error:', chrome.runtime.lastError.message);
						else LOG('nstDB saved, bytes:', bytes.length);
					});
				} catch(e) { WARN('nstDB export failed:', e && e.message); }
			}, 2000);
		}

		function whenReady(cb) {
			if (ready) return cb();
			openWaiters.push(cb);
		}

		function getCachedTranslation(src, tgt, text, cb) {
			whenReady(function(){
				try {
					let stmt = db.prepare('SELECT translation FROM cache_translations WHERE src_lang=? AND tgt_lang=? AND original=?');
					stmt.bind([src, tgt, text]);
					let result = null;
					if (stmt.step()) result = stmt.getAsObject().translation;
					stmt.free();
					cb(result || null);
				} catch(e) { WARN('getCachedTranslation:', e && e.message); cb(null); }
			});
		}

		function setCachedTranslation(src, tgt, text, translation) {
			whenReady(function(){
				try {
					let stmt = db.prepare('INSERT OR REPLACE INTO cache_translations(src_lang,tgt_lang,original,translation,ts) VALUES (?,?,?,?,?)');
					stmt.run([src, tgt, text, translation, Date.now()]);
					stmt.free();
					scheduleSave();
				} catch(e) { WARN('setCachedTranslation:', e && e.message); }
			});
		}

		function upsertVideo(videoId, url, title, src, tgt) {
			whenReady(function(){
				try {
					let now = Date.now();
					let stmt = db.prepare('INSERT INTO videos(video_id,url,title,src_lang,tgt_lang,first_seen,last_seen) VALUES (?,?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET url=excluded.url, title=COALESCE(NULLIF(excluded.title,""),videos.title), src_lang=excluded.src_lang, tgt_lang=excluded.tgt_lang, last_seen=excluded.last_seen');
					stmt.run([videoId, url, title || '', src, tgt, now, now]);
					stmt.free();
					scheduleSave();
				} catch(e) { WARN('upsertVideo:', e && e.message); }
			});
		}

		function recordSubtitle(videoId, videoTime, original, translation, status) {
			whenReady(function(){
				try {
					let now = Date.now();
					let stmt = db.prepare('INSERT INTO subtitles(video_id,video_time,original,translation,status,attempts,last_attempt) VALUES (?,?,?,?,?,?,?) ON CONFLICT(video_id,video_time,original) DO UPDATE SET translation=COALESCE(excluded.translation, subtitles.translation), status=excluded.status, attempts=subtitles.attempts+1, last_attempt=excluded.last_attempt');
					stmt.run([videoId, videoTime, original, translation || null, status, 1, now]);
					stmt.free();
					scheduleSave();
				} catch(e) { WARN('recordSubtitle:', e && e.message); }
			});
		}

		function loadVideoSubtitles(videoId, cb) {
			whenReady(function(){
				try {
					let stmt = db.prepare('SELECT video_time, original, translation, status FROM subtitles WHERE video_id=? ORDER BY video_time');
					stmt.bind([videoId]);
					let out = [];
					while (stmt.step()) out.push(stmt.getAsObject());
					stmt.free();
					cb(out);
				} catch(e) { WARN('loadVideoSubtitles:', e && e.message); cb([]); }
			});
		}

		init();

		return {
			whenReady: whenReady,
			getCachedTranslation: getCachedTranslation,
			setCachedTranslation: setCachedTranslation,
			upsertVideo: upsertVideo,
			recordSubtitle: recordSubtitle,
			loadVideoSubtitles: loadVideoSubtitles,
			scheduleSave: scheduleSave
		};
	})();

	function transCacheGet(srcLang, tgtLang, text, cb) {
		nstDB.getCachedTranslation(srcLang || 'auto', tgtLang || 'en', text, cb);
	}

	function transCacheSet(srcLang, tgtLang, text, translation) {
		if (!translation) return;
		nstDB.setCachedTranslation(srcLang || 'auto', tgtLang || 'en', text, translation);
	}

	function getNetflixVideoId() {
		let m = location.pathname.match(/\/watch\/(\d+)/);
		return m ? m[1] : null;
	}

	function getCanonicalWatchUrl() {
		let id = getNetflixVideoId();
		return id ? (location.origin + '/watch/' + id) : location.href;
	}





	function fmtTime(sec) {
		if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '';
		sec = Math.floor(sec);
		let h = Math.floor(sec / 3600);
		let m = Math.floor((sec % 3600) / 60);
		let s = sec % 60;
		let pad = function(n){ return n < 10 ? '0'+n : ''+n; };
		return (h > 0 ? h + ':' + pad(m) : m) + ':' + pad(s);
	}

	function getVideoEl() {
		let v = document.querySelector('video');
		return v || null;
	}

	function getVideoTime() {
		let v = getVideoEl();
		let t = v ? v.currentTime : null;
		LOG('getVideoTime ->', t, 'videoEl=', !!v);
		return t;
	}

	function injectNetflixSeekBridge() {
		if (document.getElementById('nst-netflix-bridge')) return;
		try {
			let s = document.createElement('script');
			s.id = 'nst-netflix-bridge';
			s.textContent = '(' + function(){
				function findPlayer(){
					try {
						var api = netflix && netflix.appContext && netflix.appContext.state
							&& netflix.appContext.state.playerApp && netflix.appContext.state.playerApp.getAPI();
						if (!api || !api.videoPlayer) return null;
						var ids = api.videoPlayer.getAllPlayerSessionIds();
						for (var i = 0; i < ids.length; i++) {
							if (ids[i] && ids[i].indexOf('watch-') === 0) {
								return api.videoPlayer.getVideoPlayerBySessionId(ids[i]);
							}
						}
						if (ids[0]) return api.videoPlayer.getVideoPlayerBySessionId(ids[0]);
					} catch(e){}
					return null;
				}
				function playPlayer(p){
					try {
						if (p && typeof p.play === 'function') { p.play(); return 'player.play'; }
						if (p && typeof p.unpause === 'function') { p.unpause(); return 'player.unpause'; }
						if (p && typeof p.resume === 'function') { p.resume(); return 'player.resume'; }
					} catch(e){}
					try {
						var v = document.querySelector('video');
						if (v && typeof v.play === 'function') { v.play(); return 'video.play'; }
					} catch(e){}
					return 'none';
				}
				window.addEventListener('message', function(ev){
					if (!ev.data || ev.data.__nst !== 'seek') return;
					var sec = ev.data.sec;
					var shouldPlay = !!ev.data.play;
					var p = findPlayer();
					var ok = false, via = 'none', playVia = 'none', err = '';
					try {
						if (p && typeof p.seek === 'function') {
							p.seek(Math.round(sec * 1000));
							ok = true; via = 'player.seek';
							if (shouldPlay) {
								setTimeout(function(){
									var pv = playPlayer(p);
									window.postMessage({ __nst: 'seek-play-result', via: pv, sec: sec }, '*');
								}, 150);
							}
						}
					} catch(e){ err = String(e && e.message || e); }
					window.postMessage({ __nst: 'seek-result', ok: ok, via: via, playVia: playVia, err: err, sec: sec, play: shouldPlay }, '*');
				});
			}.toString() + ')();';
			(document.head || document.documentElement).appendChild(s);
			s.remove();
		} catch(e) { WARN('inject bridge failed:', e && e.message); }
	}
	injectNetflixSeekBridge();

	window.addEventListener('message', function(ev){
		if (ev.source !== window || !ev.data) return;
		if (ev.data.__nst === 'seek-result') LOG('seek-result:', ev.data);
		if (ev.data.__nst === 'seek-play-result') LOG('seek-play-result:', ev.data);
	});

	function seekVideo(sec) {
		if (typeof sec !== 'number' || !isFinite(sec)) return false;
		LOG('seekVideo:', sec, '(via Netflix player API + play)');
		try {
			window.postMessage({ __nst: 'seek', sec: sec, play: true }, '*');
			window.__nstNonLinear = true;
			window.__nstLastSeekAt = Date.now();
			return true;
		} catch(e) {
			WARN('seekVideo postMessage failed:', e && e.message);
			return false;
		}
	}

	window.__nstNonLinear = false;
	(function attachVideoSeekWatcher(){
		let attached = null, lastT = null;
		setInterval(function(){
			let v = document.querySelector('video');
			if (!v) return;
			if (v !== attached) {
				attached = v;
				lastT = v.currentTime;
				v.addEventListener('seeking', function(){
					let now = v.currentTime;
					let prev = lastT;
					if (prev === null || Math.abs(now - prev) > 1.5) {
						window.__nstNonLinear = true;
						window.__nstLastSeekAt = Date.now();
						LOG('detected non-linear seek: prev=', prev, ' now=', now);
					}
				});
				return;
			}
			if (!v.paused && !v.seeking) {
				if (lastT !== null && v.currentTime > lastT && (v.currentTime - lastT) < 2) {
					if (window.__nstNonLinear && (Date.now() - (window.__nstLastSeekAt || 0)) > 1500) {
						LOG('linear playback resumed — clearing non-linear flag');
						window.__nstNonLinear = false;
					}
				}
				lastT = v.currentTime;
			}
		}, 500);
	})();

	function getSubtitleWrap() {
		return document.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap);
	}

	function setCurrentSubtitleDl(dl) {
		try {
			let wrap = getSubtitleWrap();
			if (!wrap) return;
			let prev = wrap.querySelectorAll('dl.nst-current');
			prev.forEach(function(p){ if (p !== dl) p.classList.remove('nst-current'); });
			if (dl) dl.classList.add('nst-current');
		} catch(e){}
	}

	function scrollSubtitleDlIntoView(dl) {
		let wrap = getSubtitleWrap();
		if (!wrap || !dl || !document.body.classList.contains('open-tr-panel')) return;
		try { dl.scrollIntoView({ block: 'center' }); } catch(_) {
			wrap.scrollTop = Math.max(0, dl.offsetTop - wrap.clientHeight/2);
		}
	}

	function subtitleSentence(){
		let self;
		return{
			add:function(subtitle, videoTime){
				let ts = (typeof videoTime === 'number' && isFinite(videoTime)) ? videoTime : null;
				let tsAttr = ts !== null ? ' data-vt="'+ts.toFixed(3)+'"' : '';
				let tsLabel = ts !== null ? '<time class="nst-ts" title="Click (or double-click the line) to jump to '+fmtTime(ts)+'">'+fmtTime(ts)+'</time> ' : '';
				let html = "<dl"+tsAttr+">"+"<dt>"+tsLabel+subtitle.replace(/([a-z'\-]+)/gi, '<span>$1</span>')+"</dt><dd></dd></dl>";
				let wrap = document.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap);
				let insertedDl = null;
				if (ts !== null) {
					let existing = wrap.querySelectorAll('dl[data-vt]');
					let inserted = false;
					for (let i = 0; i < existing.length; i++) {
						let evt = parseFloat(existing[i].getAttribute('data-vt'));
						if (!isNaN(evt) && evt > ts) {
							existing[i].insertAdjacentHTML('beforebegin', html);
							insertedDl = existing[i].previousElementSibling;
							inserted = true;
							break;
						}
					}
					if (!inserted) {
						wrap.insertAdjacentHTML('beforeend', html);
						insertedDl = wrap.lastElementChild;
					}
				} else {
					wrap.insertAdjacentHTML('beforeend', html);
					insertedDl = wrap.lastElementChild;
				}

				self = this;
				self.lastInserted = insertedDl;
				self.scroll(insertedDl);
				self.addClickListner(insertedDl);
			},
			scroll:function(insertedDl){
				let elm = document.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap);
				if (!elm) return;
				let panelOpen = document.body.classList.contains('open-tr-panel');
				if (!panelOpen) {
					if (elm.offsetHeight + elm.scrollTop + 150 > elm.scrollHeight) {
						elm.scrollBy(0, 300);
					}
					return;
				}
				let isLast = insertedDl && insertedDl === elm.lastElementChild;
				if (insertedDl && (window.__nstNonLinear || !isLast)) {
					try { insertedDl.scrollIntoView({ block: 'center' }); } catch(_) {
						elm.scrollTop = Math.max(0, insertedDl.offsetTop - elm.clientHeight/2);
					}
					return;
				}
				elm.scrollTop = elm.scrollHeight;
			},
			addClickListner:function(targetDl){
				let last = targetDl;
				if (!last) {
					let nodes = document.querySelectorAll('#'+config.mainWrap+' #'+config.subtitleWrap +" dl");
					last = nodes[nodes.length- 1];
				}
				if (!last || last.__nstWired) return;
				last.__nstWired = true;
				last.addEventListener('click', function(e){
					if (e.target && (e.target.tagName === 'TIME' || (e.target.classList && e.target.classList.contains('nst-ts')))) {
						let dl = e.target.closest('dl');
						let vt = dl ? parseFloat(dl.getAttribute('data-vt')) : NaN;
						LOG('timestamp click vt=', vt);
						if (!isNaN(vt)) {
							e.preventDefault();
							e.stopPropagation();
							setCurrentSubtitleDl(dl);
							scrollSubtitleDlIntoView(dl);
							seekVideo(vt);
						}
						return;
					}
					self.clickedWordORSent(e);
				});
				last.addEventListener('dblclick', function(e){
					let dl = e.target.closest('dl');
					if (!dl) return;
					let vt = parseFloat(dl.getAttribute('data-vt'));
					LOG('dblclick vt=', vt, 'target=', e.target && e.target.tagName);
					if (!isNaN(vt)) {
						e.preventDefault();
						e.stopPropagation();
						setCurrentSubtitleDl(dl);
						scrollSubtitleDlIntoView(dl);
						seekVideo(vt);
					}
				});
			},
			clickedWordORSent:function(event){
						
				if(event.target.nodeName ==='SPAN'){
					return traslatePanel().start(event.target.textContent);
				}else{
					return self.translateSentence(event.target);
				}
				
			},	
			translateSentence: function(el){
			

				
				 let sentence = el.textContent.toLowerCase();
				 
				 if(sentence == '') return false;
				 
				 if(el.nodeName !=='DL') while ((el = el.parentElement) && !el.nodeName ==='DL');
				 
				 if(typeof el == 'undefined'){ return false;}
				 
				 if(el.classList.contains(config.translatedSentence)){ return false;}

				 el.classList.add(config.translatedSentence);
				 
				
				loadJson(gtansUrl(sentence), function(data){
					let gtrans = '';
					data['sentences'].forEach(function(sentence){ 
							gtrans += sentence.trans +' ';
					});
					
					el.querySelector('dd').textContent = gtrans;
				})		 
				 
			}
		}
	}



	function traslatePanel(word){
			let self;
			return{
				start: function(word){
					self = this;
					document.querySelector('#'+config.mainWrap).classList.add(config.openRightPanel);
					
					document.querySelector('#'+config.dsecriptionTitle).innerHTML = "<span>"+word+"</span>";
					
					document.querySelector('#'+config.imgWrap).textContent = '';
					
					if(config.user.images){ loadJson(config.gimages+encodeURI(word), this.addImages); }
					
					loadJson(ftranUrl(word), this.wordTranslate);

					self.close();
					self.voice(word);
				},
				voice:function(word){
		
				
					let msg = new SpeechSynthesisUtterance(word);
					msg.voice = speechSynthesis.getVoices().filter(function(voice) { return voice.name == 'Google US English'; })[0]; // chrome voice bug
					msg.rate=0.5;
					msg.volume=0.7;
					msg.lang = 'en-US';	
					
					document.querySelector('#'+config.dsecriptionTitle+' span').addEventListener('click', function(e) {
						msg.voice = speechSynthesis.getVoices().filter(function(voice) { return voice.name == 'Google US English'; })[0]; // chrome voice bug
						speechSynthesis.speak(msg);
					}, false);
				},
				close: function(){
					document.querySelector('#'+config.closeRightPanel).addEventListener('click', function(e) {
						document.querySelector('#'+config.mainWrap).classList.remove(config.openRightPanel);
					}, false);			
				},
				addImages :function(data){
					data['items'].forEach(function(item){ 				
						document.querySelector('#'+config.imgWrap).insertAdjacentHTML('beforeend', '<img src="'+item.image.thumbnailLink+'">');
					});
				},
				wordTranslate: function(data){

					document.querySelector('#'+config.mainWrap+' #'+config.dsecriptionWrap).innerHTML = '';
					
					if(data['sentences'][0]['trans']){
							document.querySelector('#'+config.dsecriptionTitle).insertAdjacentHTML('beforeend', ' — ' + data['sentences'][0]['trans']);
					}
				
					try{
						data['dict'].forEach(function(block){
								let items = [];
								let limit = 3;
								try{
									block['entry'].forEach(function(ceil){ 
										items[ceil['word']] = ceil['reverse_translation'];
										if(--limit == 0){ throw 'BreakException';}
									});
								} catch (e) {
									if (e !== 'BreakException') throw e;
								}	
						
							self.addToWrap(block['pos'],items);	
						});
					}catch(e){
					}
				},
			
				addToWrap:function(type,items){
								
					let html = '<i>'+type+'</i>';

					for (var key in items) {
						html += '<dl>';
						html += '<dt>'+key+'</dt>';
						html += '<dd>'+items[key].join(", ")+'</dd>';
						html += '</dl>';
					}
						
					document.querySelector('#'+config.mainWrap+' #'+config.dsecriptionWrap)
							.insertAdjacentHTML('beforeend', html);		
						
			
				}
						
			}

	}


	function pause(){
		let self;
		return{
			setEvent:function(){
				self = this;
				try{
					let row = document.querySelector('.PlayerControlsNeo__button-control-row');
					if (!row) { WARN('pause.setEvent: no .PlayerControlsNeo__button-control-row (Netflix DOM changed)'); return; }
					row.addEventListener('click', function(e) {
						if(e.y > 190) {return false;}
						self.toggle();
					}, false);
				}catch(e){ WARN('pause.setEvent error:', e && e.message); }
			},
			start:function(){
				try{
					document.querySelector('.button-nfplayerPlay').click();
				}catch(e){}
					
			},
			stop:function(){
				try{
					document.querySelector('.button-nfplayerPause').click();
				}catch(e){}			
			},	
			toggle:function(){
				try{
					if(document.querySelector('.button-nfplayerPause')){
						document.querySelector('.button-nfplayerPause').click();
					}else{
						document.querySelector('.button-nfplayerPlay').click();
					}
				}catch(e){}	
			},			
		}
	}



	let tmd;
	function centerTranslator(){
		let self,elm;
		return{
			init:function(sentence){
				self = this;
				elm = document.querySelector('#'+config.mainTranslateId);
				try{
						document.querySelectorAll('.player-timedtext-text-container').forEach(function(elem) {
						elem.addEventListener('click', function(){
							self.translate(sentence);
						});
						
					});
				}catch(e){
				
				}
			},
			translate:function(sentence){
				self.clear();
				if(config.user.delay){pause().stop();}
				loadJson(gtansUrl(sentence), function(data){
					data['sentences'].forEach(function(sentence){ 
							elm.textContent += sentence.trans +' ';
					});
					if(elm.textContent !== ''){ self.show();}else{pause().start();}
				})			
			
				
				
			},			
			show: function(){
				elm.classList.add(config.mainTranslateOpenClass);
				clearTimeout(tmd);
				
				tmd = setTimeout(function(){
					self.clear(); 
					if(config.user.delay){pause().start();}
				},config.user.showsec*1000);
			},
			clear: function(){
					elm.classList.remove(config.mainTranslateOpenClass);
					elm.textContent = '';
			},		
		}

	}


	
	let captures = [];

	function getNetflixTitle() {
		const candidates = [
			'[data-uia="video-title"]',
			'.video-title h4',
			'.video-title',
			'.ellipsize-text',
			'.title-info-title',
			'.title-info h1',
			'h1.title'
		];
		for (let sel of candidates) {
			try {
				let el = document.querySelector(sel);
				if (el && el.textContent.trim()) return el.textContent.trim().replace(/\s+/g, ' ');
			} catch(e){}
		}
		let t = (document.title || '').replace(/\s*[\|\-–]\s*Netflix\s*$/i, '').trim();
		return t || 'Netflix';
	}

	function escOrgHeading(s) {
		return s.replace(/^\*/, '\\*');
	}

	function buildOrgExport() {
		let now = new Date();
		let title = getNetflixTitle();
		let url = getCanonicalWatchUrl();
		let header = '';
		header += '#+TITLE: ' + title + '\n';
		header += '#+DATE: ' + now.toISOString() + '\n';
		header += '#+URL: ' + url + '\n';
		header += '#+SOURCE_LANG: ' + (config.user.srcLang || 'auto') + '\n';
		header += '#+TARGET_LANG: ' + (config.user.lang || 'en') + '\n';
		header += '#+SUBTITLE_COUNT: ' + captures.length + '\n\n';

		let body = captures.map(function(c){
			let vt = (typeof c.videoTime === 'number' && isFinite(c.videoTime)) ? ' [' + fmtTime(c.videoTime) + ']' : '';
			return '* ' + escOrgHeading(c.original) + vt + '\n\n' + (c.translation || '') + '\n';
		}).join('\n');

		return header + body;
	}

	function safeFilename(s) {
		return s.replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'netflix-subtitles';
	}

	function exportOrg() {
		if (!captures.length) return { ok: false, error: 'No subtitles captured yet.' };
		let text = buildOrgExport();
		let blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
		let url = URL.createObjectURL(blob);
		let a = document.createElement('a');
		a.href = url;
		a.download = safeFilename(getNetflixTitle()) + '-' + new Date().toISOString().replace(/[:.]/g,'-') + '.org';
		document.body.appendChild(a);
		a.click();
		setTimeout(function(){
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}, 100);
		return { ok: true, count: captures.length };
	}

	window.__nstExportOrg = exportOrg;
	window.__nstCaptures = captures;


	function run(item){

			LOG('run() starting — player + controls detected');
			config.launched = true;
			pause().setEvent();
			get_options();

			let subtitleBefore = '';
			let wait = false;
			let videoId = getNetflixVideoId();
			LOG('Netflix videoId =', videoId);

			if (videoId) {
				nstDB.upsertVideo(videoId, getCanonicalWatchUrl(), getNetflixTitle(), config.user.srcLang || 'auto', config.user.lang || 'en');
				nstDB.loadVideoSubtitles(videoId, function(rows){
					if (!rows || !rows.length) {
						LOG('nstDB: no prior subtitles for video', videoId);
						return;
					}
					LOG('nstDB: preloading', rows.length, 'subtitles for video', videoId);
					rows.forEach(function(r){
						let entry = {
							original: r.original,
							translation: r.translation || '',
							ts: Date.now(),
							videoTime: typeof r.video_time === 'number' ? r.video_time : null,
							dl: null,
							preloaded: true,
							status: r.status
						};
						captures.push(entry);
						subtitleSentence().add(entry.original, entry.videoTime);
						entry.dl = (function(){
							let dls = document.querySelectorAll('#'+config.mainWrap+' #'+config.subtitleWrap+' dl[data-vt]');
							let want = (typeof entry.videoTime === 'number') ? entry.videoTime.toFixed(3) : null;
							if (want) {
								for (let i = dls.length - 1; i >= 0; i--) {
									if (dls[i].getAttribute('data-vt') === want) return dls[i];
								}
							}
							return dls[dls.length - 1] || null;
						})();
						if (entry.translation && entry.dl) {
							entry.dl.classList.add(config.translatedSentence);
							let dd = entry.dl.querySelector('dd');
							if (dd) dd.textContent = entry.translation;
						}
					});
					retryMissingTranslations();
				});
			}

			let retryQueue = [];
			let retryRunning = false;
			function retryMissingTranslations() {
				retryQueue = captures.filter(function(c){
					return !c.translation || c.status === 'pending' || c.status === 'failed';
				});
				if (!retryQueue.length) return;
				LOG('nstDB: scheduling', retryQueue.length, 'translation retries');
				pumpRetry();
			}
			function pumpRetry() {
				if (retryRunning) return;
				let next = retryQueue.shift();
				if (!next) return;
				retryRunning = true;
				autoTranslate(next.original, next, function done(){
					retryRunning = false;
					setTimeout(pumpRetry, 250);
				});
			}

			function extractSubtitle() {
				let parts = [];
				try {
					let containers = item.querySelectorAll('.player-timedtext-text-container');
					if (containers.length) {
						containers.forEach(function(c){
							let t = (c.textContent || '').trim();
							if (t) parts.push(t);
						});
					} else {
						let spans = item.querySelectorAll('span');
						spans.forEach(function(s){
							let t = (s.textContent || '').trim();
							if (t && !parts.includes(t)) parts.push(t);
						});
					}
				} catch(e) {}
				let joined = parts.join(' ').replace(/\s+/g, ' ').trim();
				let halves = joined.length % 2 === 0 ? [joined.slice(0, joined.length/2), joined.slice(joined.length/2)] : null;
				if (halves && halves[0] === halves[1]) joined = halves[0];
				return joined;
			}

			function applyTranslation(target, gtrans, entry) {
				if (!gtrans) return;
				entry.translation = gtrans;
				let dl = target || entry.dl;
				if (!dl) {
					let dls = document.querySelectorAll('#'+config.mainWrap+' #'+config.subtitleWrap+' dl');
					dl = dls[dls.length - 1];
				}
				if (dl) {
					dl.classList.add(config.translatedSentence);
					let dd = dl.querySelector('dd');
					if (dd) dd.textContent = gtrans;
				}
				let sw = document.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap);
				if (!sw || !document.body.classList.contains('open-tr-panel')) return;
				let isLast = dl && dl === sw.lastElementChild;
				if (dl && (window.__nstNonLinear || !isLast)) {
					requestAnimationFrame(function(){ try { dl.scrollIntoView({ block: 'center' }); } catch(_){} });
				} else {
					requestAnimationFrame(function(){ sw.scrollTop = sw.scrollHeight; });
				}
			}

			function autoTranslate(sentence, entry, done) {
				if (!sentence) { if (done) done(); return; }
				let src = config.user.srcLang || 'auto';
				let tgt = config.user.lang || 'en';
				let finish = function(){ if (done) try { done(); } catch(e){} };
				transCacheGet(src, tgt, sentence, function(cached){
					if (cached) {
						LOG('auto-translation (cached):', cached);
						applyTranslation(entry.dl, cached, entry);
						entry.status = 'ok';
						if (videoId && typeof entry.videoTime === 'number') {
							nstDB.recordSubtitle(videoId, entry.videoTime, entry.original, cached, 'ok');
						}
						return finish();
					}
					if (videoId && typeof entry.videoTime === 'number' && !entry.preloaded) {
						nstDB.recordSubtitle(videoId, entry.videoTime, entry.original, null, 'pending');
					}
					loadJson(gtansUrl(sentence), function(data){
						if (!data) {
							if (videoId && typeof entry.videoTime === 'number') {
								nstDB.recordSubtitle(videoId, entry.videoTime, entry.original, null, 'failed');
							}
							return finish();
						}
						let gtrans = '';
						try {
							data['sentences'].forEach(function(seg){ gtrans += seg.trans + ' '; });
						} catch(e){
							if (videoId && typeof entry.videoTime === 'number') {
								nstDB.recordSubtitle(videoId, entry.videoTime, entry.original, null, 'failed');
							}
							return finish();
						}
						gtrans = gtrans.trim();
						if (!gtrans) {
							if (videoId && typeof entry.videoTime === 'number') {
								nstDB.recordSubtitle(videoId, entry.videoTime, entry.original, null, 'failed');
							}
							return finish();
						}
						LOG('auto-translation:', gtrans);
						transCacheSet(src, tgt, sentence, gtrans);
						entry.status = 'ok';
						if (videoId && typeof entry.videoTime === 'number') {
							nstDB.recordSubtitle(videoId, entry.videoTime, entry.original, gtrans, 'ok');
						}
						applyTranslation(entry.dl, gtrans, entry);
						finish();
					});
				});
			}

			function findExistingCapture(text, vt) {
				if (typeof vt !== 'number' || !isFinite(vt)) {
					for (let i = captures.length - 1; i >= 0; i--) {
						if (captures[i].original === text) return captures[i];
					}
					return null;
				}
				for (let i = 0; i < captures.length; i++) {
					let c = captures[i];
					if (c.original !== text) continue;
					if (typeof c.videoTime !== 'number') continue;
					if (Math.abs(c.videoTime - vt) <= 3) return c;
				}
				return null;
			}

			function findDlByCapture(c) {
				if (c && c.dl && document.contains(c.dl)) return c.dl;
				if (!c || typeof c.videoTime !== 'number') return null;
				let dls = document.querySelectorAll('#'+config.mainWrap+' #'+config.subtitleWrap+' dl[data-vt]');
				let want = c.videoTime.toFixed(3);
				for (let i = 0; i < dls.length; i++) {
					if (dls[i].getAttribute('data-vt') === want) return dls[i];
				}
				return null;
			}

			function setCurrent(dl) {
				setCurrentSubtitleDl(dl);
			}

			function readAndHandle() {
				if (wait) return;
				wait = true;
				setTimeout(function(){
					wait = false;
					let subtitle = extractSubtitle();
					if (!subtitle) return;
					if (subtitle === subtitleBefore && !window.__nstNonLinear) return;

					LOG('subtitle:', subtitle);
					let vt = getVideoTime();

					let dup = findExistingCapture(subtitle, vt);
					if (dup) {
						LOG('subtitle is duplicate of capture vt=', dup.videoTime, '— scrolling to existing row');
						let dl = findDlByCapture(dup);
						setCurrent(dl);
						let sw = document.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap);
						if (dl && sw && document.body.classList.contains('open-tr-panel')) {
							try { dl.scrollIntoView({ block: 'center' }); } catch(_) {
								sw.scrollTop = Math.max(0, dl.offsetTop - sw.clientHeight/2);
							}
						}
						subtitleBefore = subtitle;
						return;
					}

					let entry = { original: subtitle, translation: '', ts: Date.now(), videoTime: vt, dl: null };
					captures.push(entry);
					centerTranslator().init(subtitle);
					subtitleSentence().add(subtitle, vt);
					entry.dl = (function(){
						let dls = document.querySelectorAll('#'+config.mainWrap+' #'+config.subtitleWrap+' dl[data-vt]');
						let want = (typeof vt === 'number') ? vt.toFixed(3) : null;
						if (want) {
							for (let i = dls.length - 1; i >= 0; i--) {
								if (dls[i].getAttribute('data-vt') === want) return dls[i];
							}
						}
						return dls[dls.length - 1] || null;
					})();
					setCurrent(entry.dl);
					subtitleBefore = subtitle;
					autoTranslate(subtitle, entry);
				}, 100);
			}

			try {
				let mo = new MutationObserver(function(muts){ readAndHandle(); });
				mo.observe(item, { childList: true, subtree: true, characterData: true });
				LOG('MutationObserver attached to .player-timedtext');
			} catch(e) {
				WARN('MutationObserver failed:', e && e.message);
			}

			setInterval(readAndHandle, 500);
	}


	let pollTick = 0;
	let intv = setInterval(function(){

		let item = document.querySelector('.player-timedtext');
		pollTick++;
		if (pollTick % 5 === 0) {
			LOG('poll: .player-timedtext=', !!item, ' launched=', config.launched);
		}
		if(item){
			if(!config.launched){
				run(item);
			}
		}else{
			config.launched = false;
			let wrap = document.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap);
			if (wrap) wrap.innerHTML = '';
		}

	},1000);


})();






chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
	try { console.log('[NST] message:', request); } catch(e){}
	if(request.buttonClick){
				if(!window.location.href.match(/.+:\/\/.+netflix\.com\/watch\//)){
				return false
			}
			let bdclist = document.querySelector('body').classList;
			if (bdclist.contains('open-tr-panel')) {
				bdclist.remove('open-tr-panel');
			} else {
				bdclist.add('open-tr-panel');
				try {
					let sw = document.querySelector('#translate-ext #subtitle-wrap');
					if (sw) {
						requestAnimationFrame(function(){ sw.scrollTop = sw.scrollHeight; });
					}
				} catch(e){}
			}

	}

	if(request.exportOrg){
		try {
			let result = (typeof window.__nstExportOrg === 'function') ? window.__nstExportOrg() : { ok: false, error: 'Extension not initialized on this page.' };
			sendResponse(result);
		} catch(e) {
			sendResponse({ ok: false, error: 'Export error: ' + (e && e.message) });
		}
		return true;
	}

});