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

chrome.devtools.network.onRequestFinished.addListener(request => {
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
});

chrome.devtools.panels.create('Gebe', '', 'panel.html');
