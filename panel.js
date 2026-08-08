import { countCrateDuplicates, countInventoryDuplicates } from './src/itemStats.js';
import { mergeEntries } from './src/ringBuffer.js';

const ASSET_BASE = 'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img_low/sp/assets';

function thumbnailUrl(assetFolder, id) {
  return `${ASSET_BASE}/${assetFolder}/s/${id}.jpg`;
}

function renderCrateDuplicateSection(container, title, itemKindId, assetFolder, captures) {
  const dupes = countCrateDuplicates(captures, itemKindId).filter(d => d.count > 1);
  container.innerHTML = `<h3>${title}</h3>`;
  for (const dupe of dupes) {
    const row = document.createElement('div');
    row.className = 'dupe-row';
    row.innerHTML = `<img src="${thumbnailUrl(assetFolder, dupe.regular_id)}" /><span>${dupe.item_name} ×${dupe.count}</span>`;
    container.appendChild(row);
  }
}

function renderInventoryDuplicateSection(container, title, urlPattern, assetFolder, captures) {
  const dupes = countInventoryDuplicates(captures, urlPattern);
  container.innerHTML = `<h3>${title}</h3>`;
  for (const dupe of dupes) {
    const row = document.createElement('div');
    row.className = 'dupe-row';
    const stars = dupe.nonZeroStars.map(s => `★${s.evolution}`).join(' ');
    const parts = [];
    if (dupe.zeroStarCount > 0) parts.push(`×${dupe.zeroStarCount} at 0★`);
    if (stars) parts.push(stars);
    row.innerHTML = `<img src="${thumbnailUrl(assetFolder, dupe.master_id)}" /><span>${parts.join(', ')}</span>`;
    container.appendChild(row);
  }
}

function renderCaptures(captures) {
  const body = document.getElementById('captures-body');
  body.innerHTML = '';
  for (const capture of captures) {
    const row = document.createElement('tr');
    row.className = 'capture-row';
    row.innerHTML = `
      <td>${new Date(capture.capturedAt).toLocaleTimeString()}</td>
      <td>${capture.method}</td>
      <td>${capture.url}</td>
      <td>${capture.status}</td>
    `;
    const detail = document.createElement('tr');
    detail.className = 'capture-detail';
    detail.style.display = 'none';
    const detailCell = document.createElement('td');
    detailCell.colSpan = 4;
    detailCell.innerHTML = `<pre>${JSON.stringify(
      { requestBody: capture.requestBody, responseBody: capture.responseBody },
      null,
      2
    )}</pre>`;
    detail.appendChild(detailCell);
    row.addEventListener('click', () => {
      detail.style.display = detail.style.display === 'none' ? '' : 'none';
    });
    body.appendChild(row);
    body.appendChild(detail);
  }
}

function render(captures) {
  renderCaptures(captures);
  renderCrateDuplicateSection(
    document.getElementById('crate-section'),
    'Unclaimed Summon Duplicates',
    '2',
    'summon',
    captures
  );
  renderInventoryDuplicateSection(
    document.getElementById('inventory-section'),
    'Summon Inventory Duplicates',
    '/summon/list/',
    'summon',
    captures
  );
}

function loadAndRender() {
  chrome.storage.local.get('captures', data => render(data.captures || []));
}

chrome.storage.onChanged.addListener(changes => {
  if (changes.captures) render(changes.captures.newValue || []);
});

document.getElementById('export').addEventListener('click', () => {
  chrome.storage.local.get('captures', data => {
    const blob = new Blob([JSON.stringify(data.captures || [], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'captures.json';
    a.click();
    URL.revokeObjectURL(url);
  });
});

document.getElementById('import').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const imported = JSON.parse(reader.result);
    chrome.storage.local.get('captures', data => {
      const merged = mergeEntries(data.captures || [], imported);
      chrome.storage.local.set({ captures: merged });
    });
  };
  reader.readAsText(file);
  event.target.value = '';
});

document.getElementById('clear').addEventListener('click', () => {
  chrome.storage.local.remove('captures');
});

loadAndRender();
