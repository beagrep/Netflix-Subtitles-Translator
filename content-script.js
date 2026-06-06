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
	  
	}
	createTapeWrap();


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
				});
	}





	function subtitleSentence(){
		let self;
		return{
			add:function(subtitle){
				document
				.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap)
				.insertAdjacentHTML('beforeend', "<dl><dt>"+subtitle.replace(/([a-z'\-]+)/gi, '<span>$1</span>')+"</dt><dd></dd></dl>");

				self = this;
				self.scroll();
				self.addClickListner();
			},
			scroll:function(){
				let elm = document.querySelector('#'+config.mainWrap+' #'+config.subtitleWrap);
				if(elm.offsetHeight + elm.scrollTop + 150 > elm.scrollHeight){
					elm.scrollBy(0, 300);
				}

			},
			addClickListner:function(){
				let nodes = document.querySelectorAll('#'+config.mainWrap+' #'+config.subtitleWrap +" dl");
				nodes[nodes.length- 1].addEventListener('click', self.clickedWordORSent);
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
		let url = location.href;
		let header = '';
		header += '#+TITLE: ' + title + '\n';
		header += '#+DATE: ' + now.toISOString() + '\n';
		header += '#+URL: ' + url + '\n';
		header += '#+SOURCE_LANG: ' + (config.user.srcLang || 'auto') + '\n';
		header += '#+TARGET_LANG: ' + (config.user.lang || 'en') + '\n';
		header += '#+SUBTITLE_COUNT: ' + captures.length + '\n\n';

		let body = captures.map(function(c){
			return '* ' + escOrgHeading(c.original) + '\n\n' + (c.translation || '') + '\n';
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

			function autoTranslate(sentence, entry) {
				if (!sentence) return;
				loadJson(gtansUrl(sentence), function(data){
					let gtrans = '';
					try {
						data['sentences'].forEach(function(seg){ gtrans += seg.trans + ' '; });
					} catch(e){ return; }
					gtrans = gtrans.trim();
					if (!gtrans) return;
					LOG('auto-translation:', gtrans);
					entry.translation = gtrans;
					let dls = document.querySelectorAll('#'+config.mainWrap+' #'+config.subtitleWrap+' dl');
					let last = dls[dls.length - 1];
					if (last) {
						last.classList.add(config.translatedSentence);
						let dd = last.querySelector('dd');
						if (dd) dd.textContent = gtrans;
					}
				});
			}

			function readAndHandle() {
				if (wait) return;
				wait = true;
				setTimeout(function(){
					wait = false;
					let subtitle = extractSubtitle();
					if (!subtitle || subtitle === subtitleBefore) return;

					LOG('subtitle:', subtitle);
					let entry = { original: subtitle, translation: '', ts: Date.now() };
					captures.push(entry);
					centerTranslator().init(subtitle);
					subtitleSentence().add(subtitle);
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
			(bdclist.contains('open-tr-panel')) ? bdclist.remove('open-tr-panel') : bdclist.add('open-tr-panel');

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