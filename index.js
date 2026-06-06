
function urlChanged(tab){
	if(tab.url && tab.url.match(/.+:\/\/.+netflix\.com\/watch\//)){
		chrome.browserAction.setIcon({path: 'icon-small.png', tabId: tab.id});
		return true;
	}else{
		chrome.browserAction.setIcon({path: 'icon-small-disabled.png', tabId: tab.id});
		return false;
	}
}

chrome.tabs.onUpdated.addListener(function (tabId, change, tab){
	return urlChanged(tab);
});

chrome.tabs.onActivated.addListener(function(info){
	chrome.tabs.get(info.tabId, function(tab){
		return urlChanged(tab);
	});
});
