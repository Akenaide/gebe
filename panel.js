import { countCrateDuplicates, countInventoryDuplicates, combineDuplicateSections } from './src/itemStats.js';
import { mergeEntries } from './src/ringBuffer.js';

const ASSET_BASE = 'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img_low/sp/assets';

function thumbnailUrl(assetFolder, id) {
  return `${ASSET_BASE}/${assetFolder}/s/${id}.jpg`;
}

function wikiUrl(itemName) {
  return `https://gbf.wiki/${encodeURIComponent(itemName.replace(/ /g, '_'))}`;
}

const ATTRIBUTES = ['Fire', 'Water', 'Earth', 'Wind', 'Light', 'Dark'];
let selectedAttribute = null;
let lastCaptures = [];

function renderFilterBar(container) {
  container.innerHTML = '';
  const options = [null, ...ATTRIBUTES];
  for (const attr of options) {
    const btn = document.createElement('button');
    btn.textContent = attr ?? 'All';
    btn.className = attr === selectedAttribute ? 'filter-btn active' : 'filter-btn';
    btn.addEventListener('click', () => {
      selectedAttribute = attr;
      render(lastCaptures);
    });
    container.appendChild(btn);
  }
}

function renderDuplicatesSection(container, captures, { title, itemKindId, urlPattern, assetFolder }) {
  const crateDupes = countCrateDuplicates(captures, itemKindId);
  const inventoryDupes = countInventoryDuplicates(captures, urlPattern);
  let rows = combineDuplicateSections(crateDupes, inventoryDupes);
  if (selectedAttribute) rows = rows.filter(row => row.attribute_name === selectedAttribute);

  container.innerHTML = `<h3>${title}</h3><div class="dupe-grid"></div>`;
  const grid = container.querySelector('.dupe-grid');
  for (const row of rows) {
    const total = row.crateCount + row.zeroStarCount + row.nonZeroStars.length;
    const stars = row.nonZeroStars.map(s => `${s.evolution}★`).join(' ');
    const breakdown = [];
    if (row.crateCount > 0) breakdown.push(`${row.crateCount} unclaimed`);
    if (row.zeroStarCount > 0) breakdown.push(`${row.zeroStarCount} owned 0★`);
    if (stars) breakdown.push(`owned ${stars}`);

    const el = document.createElement('div');
    el.className = 'dupe-card';
    if (total === 3) el.classList.add('level-3');
    if (total >= 4) el.classList.add('level-4plus');
    el.title = row.item_name ?? String(row.id);
    el.innerHTML = `
      <div class="thumb-wrap">
        <img src="${thumbnailUrl(assetFolder, row.id)}" />
      </div>
      <div class="name">${row.item_name ? `<a href="${wikiUrl(row.item_name)}" target="_blank" rel="noopener">${row.item_name}</a>` : row.id}</div>
      <div class="total">×${total}</div>
      <div class="breakdown">${breakdown.join(', ')}</div>
    `;
    grid.appendChild(el);
  }
}

function render(captures) {
  lastCaptures = captures;
  renderFilterBar(document.getElementById('attribute-filter'));
  renderDuplicatesSection(document.getElementById('summon-duplicates-section'), captures, {
    title: 'Summons',
    itemKindId: '2',
    urlPattern: '/summon/list/',
    assetFolder: 'summon',
  });
  renderDuplicatesSection(document.getElementById('weapon-duplicates-section'), captures, {
    title: 'Weapons',
    itemKindId: '1',
    urlPattern: '/weapon/list/',
    assetFolder: 'weapon',
  });
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
