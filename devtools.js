let writeQueue = Promise.resolve();

function appendCapture(capture) {
  writeQueue = writeQueue.then(
    () =>
      new Promise(resolve => {
        chrome.storage.local.get('captures', data => {
          const captures = data.captures || [];
          captures.push(capture);
          chrome.storage.local.set({ captures }, resolve);
        });
      })
  );
}

chrome.devtools.network.onRequestFinished.addListener(request => {
  request.getContent(content => {
    appendCapture({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: request.request.url,
      method: request.request.method,
      status: request.response.status,
      requestBody: request.request.postData?.text ?? null,
      responseBody: content ?? null,
    });
  });
});

chrome.devtools.panels.create('Gebe', '', 'panel.html');
