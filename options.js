// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restore_options() {
  chrome.storage.sync.get({
    lang: 'ru',
	srcLang: 'auto',
	showsec: 5,
	delay: true,
	images: false,
  }, function(items) {
		document.querySelector('select[name="lang"]').value = items.lang;
		document.querySelector('select[name="srcLang"]').value = items.srcLang;
		document.querySelector('input[name="images"]').checked = items.images;

		document.querySelector('input[name="delay"]').checked = items.delay;
		document.querySelector('select[name="showsec"]').value = items.showsec;
  });
}


function save_options() {
	 let lang = document.querySelector('select[name="lang"]').value;
	 let srcLang = document.querySelector('select[name="srcLang"]').value;
	 let images = document.querySelector('input[name="images"]').checked;
	 let showsec = document.querySelector('select[name="showsec"]').value;
	 let delay = document.querySelector('input[name="delay"]').checked;

	 chrome.storage.sync.set({
		lang: lang,
		srcLang: srcLang,
		delay: delay,
		images: images,
		showsec: showsec,
	 });
}


document.querySelector('select[name="lang"]').addEventListener('change',save_options);
document.querySelector('select[name="srcLang"]').addEventListener('change',save_options);
document.querySelector('input[name="delay"]').addEventListener('change',save_options);
document.querySelector('input[name="images"]').addEventListener('change',save_options);
document.querySelector('select[name="showsec"]').addEventListener('change',save_options);


document.addEventListener('DOMContentLoaded', restore_options);
