import { shouldCapture } from './src/capture.js';
import { parseSupporters, mergeFriendHistory } from './src/supporters.js';

let writeQueue = Promise.resolve();

// Every storage read-modify-write goes through this one chain, since GBF fires concurrent requests.
function enqueueUpdate(key, update) {
  writeQueue = writeQueue.then(
    () =>
      new Promise(resolve => {
        chrome.storage.local.get(key, data => {
          chrome.storage.local.set({ [key]: update(data[key]) }, resolve);
        });
      })
  );
}

function onRequestFinished(request) {
  if (!shouldCapture(request.request.url)) return;
  request.getContent(content => {
    const capture = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: request.request.url,
      method: request.request.method,
      status: request.response.status,
      requestBody: request.request.postData?.text ?? null,
      responseBody: content ?? null,
    };
    enqueueUpdate('captures', captures => [...(captures || []), capture]);
    if (capture.url.includes('/quest/content/supporter_raid/')) {
      const supporters = parseSupporters(capture);
      if (supporters.length) enqueueUpdate('friends', friends => mergeFriendHistory(friends || {}, supporters, Date.now()));
    }
  });
}

// Recording off by default: capturing every request slows the game down. Removing the listener (not just ignoring) avoids DevTools' per-request overhead.
chrome.storage.local.set({ recording: false });
chrome.storage.onChanged.addListener(changes => {
  if (!changes.recording) return;
  if (changes.recording.newValue) chrome.devtools.network.onRequestFinished.addListener(onRequestFinished);
  else chrome.devtools.network.onRequestFinished.removeListener(onRequestFinished);
});

chrome.devtools.panels.create('Gebe', '', 'panel.html');
