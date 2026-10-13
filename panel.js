import { countCrateDuplicates, countInventoryDuplicates, combineDuplicateSections, extractItems } from './src/itemStats.js';
import { countSupportStats, findMissingDetails, findMissingSummons, groupLayout } from './src/supporters.js';

const ASSET_BASE = 'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img_low/sp/assets';

function thumbnailUrl(assetFolder, id) {
  return `${ASSET_BASE}/${assetFolder}/s/${id}.jpg`;
}

function wikiUrl(itemName) {
  return `https://gbf.wiki/${encodeURIComponent(itemName.replace(/ /g, '_'))}`;
}

const ATTRIBUTES = ['Fire', 'Water', 'Earth', 'Wind', 'Light', 'Dark'];
let selectedAttribute = null;
const ITEM_KEYS = ['crate', 'ownedSummons', 'ownedWeapons'];
let items = { crate: {}, ownedSummons: {}, ownedWeapons: {} };
let friends = {};
let friendList = {};
let watchedSummons = [];
let summonMinLevels = {};
let hiddenFriends = {};
let showAllFriends = false;
let showHiddenFriends = false;

function renderFilterBar(container) {
  container.innerHTML = '';
  const options = [null, ...ATTRIBUTES];
  for (const attr of options) {
    const btn = document.createElement('button');
    btn.textContent = attr ?? 'All';
    btn.className = attr === selectedAttribute ? 'filter-btn active' : 'filter-btn';
    btn.addEventListener('click', () => {
      selectedAttribute = attr;
      render();
    });
    container.appendChild(btn);
  }
}

function renderDuplicatesSection(container, owned, { title, itemKindId, assetFolder }) {
  const crateDupes = countCrateDuplicates(items.crate, itemKindId);
  const inventoryDupes = countInventoryDuplicates(owned);
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

function summonThumb(id, title) {
  const img = document.createElement('img');
  img.className = 'friend-summon';
  img.src = thumbnailUrl('summon', id);
  img.title = title;
  return img;
}

// A summon thumbnail with a caption underneath (a level, or a min-level input).
function summonTile(id, title, caption) {
  const tile = document.createElement('div');
  tile.className = 'summon-tile';
  tile.append(summonThumb(id, title), caption);
  return tile;
}

function levelCaption(level) {
  const caption = document.createElement('div');
  caption.className = 'friend-meta';
  caption.textContent = level ? `Lvl ${level}` : '—';
  return caption;
}

// A friend's supports laid out like the game's element tabs, all tabs visible at once.
function supportGrid(friend, allSummons) {
  const grid = document.createElement('div');
  grid.className = 'support-grid';
  if (!friend.layout || !Object.keys(friend.layout).length) {
    grid.textContent = 'no layout yet — seen before layouts were tracked';
    grid.classList.add('friend-meta');
    return grid;
  }
  for (const { element, slots } of groupLayout(friend.layout)) {
    const column = document.createElement('div');
    column.className = `support-col element-${element.toLowerCase()}`;
    const header = document.createElement('div');
    header.className = 'support-col-header';
    header.textContent = element;
    column.appendChild(header);
    for (const { id, level } of slots) column.appendChild(summonTile(id, allSummons[id] ?? id, levelCaption(level)));
    grid.appendChild(column);
  }
  return grid;
}

// "Hide" tick plus a note on why this friend is fine despite missing summons.
function hideControls(userId) {
  const wrap = document.createElement('span');
  wrap.className = 'hide-controls';
  const tick = document.createElement('input');
  tick.type = 'checkbox';
  tick.checked = userId in hiddenFriends;
  const note = document.createElement('input');
  note.type = 'text';
  note.className = 'hide-note';
  note.placeholder = 'why keep them?';
  note.value = hiddenFriends[userId] ?? '';
  const save = () => {
    const next = { ...hiddenFriends };
    if (tick.checked) next[userId] = note.value;
    else delete next[userId];
    chrome.storage.local.set({ hiddenFriends: next });
  };
  tick.addEventListener('change', save);
  note.addEventListener('change', () => tick.checked && save());
  const label = document.createElement('label');
  label.append(tick, ' hide');
  wrap.append(label, note);
  return wrap;
}

// For a friend just unfriended in game; their hide note and friend list entry go too.
function deleteButton(userId) {
  const button = document.createElement('button');
  button.textContent = 'delete';
  button.addEventListener('click', () => {
    chrome.storage.local.get(['friends', 'hiddenFriends', 'friendList'], data => {
      const nextFriends = { ...data.friends };
      const nextHidden = { ...data.hiddenFriends };
      const nextList = { ...data.friendList };
      delete nextFriends[userId];
      delete nextHidden[userId];
      delete nextList[userId];
      chrome.storage.local.set({ friends: nextFriends, hiddenFriends: nextHidden, friendList: nextList });
    });
  });
  return button;
}

function renderFriendsSection(container) {
  const allSummons = {};
  for (const friend of Object.values(friends)) Object.assign(allSummons, friend.seenSummons);
  // Keep watched summons pickable after "Clear friends", so they can still be un-watched.
  for (const id of watchedSummons) allSummons[id] ??= id;

  container.innerHTML = `<h3>Friends (${Object.keys(friends).length} tracked)</h3>
    <div class="friend-controls">
      <label><input type="checkbox" class="show-all" ${showAllFriends ? 'checked' : ''} /> Show all friends</label>
      <label><input type="checkbox" class="show-hidden" ${showHiddenFriends ? 'checked' : ''} /> Show hidden (${Object.keys(hiddenFriends).length})</label>
      <button class="clear-friends">Clear friends</button>
    </div>
    <div class="missing-details"></div>
    <div class="friend-picker"></div>
    <div class="friend-list"></div>`;
  container.querySelector('.show-all').addEventListener('change', event => {
    showAllFriends = event.target.checked;
    renderFriendsSection(container);
  });
  container.querySelector('.show-hidden').addEventListener('change', event => {
    showHiddenFriends = event.target.checked;
    renderFriendsSection(container);
  });
  container.querySelector('.clear-friends').addEventListener('click', () => chrome.storage.local.remove('friends'));

  // Friends from the friend list pages Gebe has no record of yet; opening their Details fills one in.
  const missingDetails = findMissingDetails(friendList, friends);
  if (missingDetails.length) {
    const block = container.querySelector('.missing-details');
    // Gebe only sees the tab DevTools is open on, so a link opening a new tab wouldn't capture anything.
    const missingCount = missingDetails.reduce((sum, { friends: missing }) => sum + missing.length, 0);
    block.innerHTML = `<h4>Details missing (${missingCount} of ${Object.keys(friendList).length} listed)</h4>
      <div class="friend-meta">Open each one's Details from that friend list page, in this tab.</div>`;
    for (const { page, friends: missing } of missingDetails) {
      const row = document.createElement('div');
      row.className = 'friend-row';
      row.append(`Page ${page}:`);
      for (const { userId, name } of missing) row.append(name ?? userId, deleteButton(userId));
      block.appendChild(row);
    }
  }

  // Watch-list picker: click a summon to toggle whether friends missing it get flagged.
  const picker = container.querySelector('.friend-picker');
  for (const [id, name] of Object.entries(allSummons).sort((a, b) => a[1].localeCompare(b[1]))) {
    const thumb = summonThumb(id, name);
    thumb.addEventListener('click', () => {
      const next = watchedSummons.includes(id) ? watchedSummons.filter(w => w !== id) : [...watchedSummons, id];
      chrome.storage.local.set({ watchedSummons: next });
    });
    if (!watchedSummons.includes(id)) {
      picker.appendChild(thumb);
      continue;
    }
    thumb.classList.add('watched');
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.className = 'min-level';
    minInput.placeholder = 'min Lvl';
    minInput.value = summonMinLevels[id] ?? '';
    minInput.addEventListener('change', () => {
      const next = { ...summonMinLevels };
      if (minInput.value) next[id] = Number(minInput.value);
      else delete next[id];
      chrome.storage.local.set({ summonMinLevels: next });
    });
    const tile = document.createElement('div');
    tile.className = 'summon-tile';
    tile.append(thumb, minInput);
    picker.appendChild(tile);
  }

  let rows = showAllFriends
    ? Object.entries(friends).map(([userId, friend]) => ({ userId, ...friend })).sort((a, b) => b.sightings - a.sightings)
    : findMissingSummons(friends, watchedSummons, summonMinLevels);
  if (!showHiddenFriends) rows = rows.filter(row => !(row.userId in hiddenFriends));
  const list = container.querySelector('.friend-list');
  for (const row of rows) {
    const card = document.createElement('div');
    card.className = 'friend-card';
    const el = document.createElement('div');
    el.className = 'friend-row';
    const link = document.createElement('a');
    link.href = `https://game.granbluefantasy.jp/#profile/${row.userId}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = row.name ?? row.userId;
    const meta = document.createElement('span');
    meta.className = 'friend-meta';
    // A friend only seen through their Details has no sighting yet.
    meta.textContent = row.lastSeen ? `seen ${row.sightings}× · last ${new Date(row.lastSeen).toLocaleString()}` : 'seen only in Details';
    el.append(link, meta, hideControls(row.userId), deleteButton(row.userId));
    if (row.missing?.length) {
      const label = document.createElement('span');
      label.className = 'friend-meta';
      label.textContent = 'missing:';
      el.appendChild(label);
      // Best level seen tells "has it, but too low" apart from "never seen with it" (—).
      for (const id of row.missing) el.appendChild(summonTile(id, allSummons[id] ?? id, levelCaption(row.bestLevels?.[id])));
    }
    card.append(el, supportGrid(row, allSummons));
    list.appendChild(card);
  }
}

// How many friends offer each support right now, from their current layouts.
let statsSort = { key: 'friends', descending: true };
let statsPick = null; // {id, level}: the level clicked to list who offers it

function renderStatsSection(container) {
  const allSummons = {};
  for (const friend of Object.values(friends)) Object.assign(allSummons, friend.seenSummons);
  const nameOf = id => allSummons[id] ?? id;
  const { friendCount, summons } = countSupportStats(friends);
  const sortValue = { friends: row => row.friendCount, name: row => nameOf(row.id) };
  const value = sortValue[statsSort.key];
  summons.sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    const order = typeof x === 'number' ? x - y : x.localeCompare(y);
    return statsSort.descending ? -order : order;
  });

  container.innerHTML = `<h3>Supports across ${friendCount} friends with a layout</h3><table class="stats-table"></table>`;
  const table = container.querySelector('table');
  const header = table.createTHead().insertRow();
  for (const [key, label] of [[null, ''], ['name', 'Summon'], ['friends', 'Friends'], [null, 'Levels (click one to see who)']]) {
    const th = document.createElement('th');
    th.textContent = label + (key === statsSort.key ? (statsSort.descending ? ' ▼' : ' ▲') : '');
    if (key) {
      th.className = 'sortable';
      th.addEventListener('click', () => {
        statsSort = { key, descending: key === statsSort.key ? !statsSort.descending : key === 'friends' };
        renderStatsSection(container);
      });
    }
    header.appendChild(th);
  }

  const body = table.createTBody();
  for (const { id, friendCount: offeredBy, levels } of summons) {
    const tr = body.insertRow();
    tr.insertCell().appendChild(summonThumb(id, nameOf(id)));
    tr.insertCell().textContent = nameOf(id);
    tr.insertCell().textContent = `${offeredBy} (${Math.round((offeredBy / friendCount) * 100)}%)`;
    const levelCell = tr.insertCell();
    for (const [level, userIds] of Object.entries(levels).sort((a, b) => b[0] - a[0])) {
      const picked = statsPick?.id === id && statsPick.level === level;
      const button = document.createElement('button');
      button.className = picked ? 'filter-btn active' : 'filter-btn';
      button.textContent = `Lvl ${level} ×${userIds.length}`;
      button.addEventListener('click', () => {
        statsPick = picked ? null : { id, level };
        renderStatsSection(container);
      });
      levelCell.appendChild(button);
      if (!picked) continue;
      const whoCell = body.insertRow().insertCell();
      whoCell.colSpan = 4;
      whoCell.className = 'stats-who';
      for (const userId of userIds) {
        const link = document.createElement('a');
        link.href = `https://game.granbluefantasy.jp/#profile/${userId}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = friends[userId].name ?? userId;
        whoCell.appendChild(link);
      }
    }
  }
}

function render() {
  renderFilterBar(document.getElementById('attribute-filter'));
  renderDuplicatesSection(document.getElementById('summon-duplicates-section'), items.ownedSummons, {
    title: 'Summons',
    itemKindId: '2',
    assetFolder: 'summon',
  });
  renderDuplicatesSection(document.getElementById('weapon-duplicates-section'), items.ownedWeapons, {
    title: 'Weapons',
    itemKindId: '1',
    assetFolder: 'weapon',
  });
}

function loadAndRender() {
  chrome.storage.local.get([...ITEM_KEYS, 'friends', 'friendList', 'watchedSummons', 'summonMinLevels', 'hiddenFriends'], data => {
    friends = data.friends || {};
    friendList = data.friendList || {};
    hiddenFriends = data.hiddenFriends || {};
    watchedSummons = data.watchedSummons || [];
    summonMinLevels = data.summonMinLevels || {};
    for (const key of ITEM_KEYS) items[key] = data[key] || {};
    render();
    renderFriendsSection(document.getElementById('friends-section'));
    renderStatsSection(document.getElementById('stats-section'));
  });
}

chrome.storage.onChanged.addListener(changes => {
  for (const key of ITEM_KEYS) if (changes[key]) items[key] = changes[key].newValue || {};
  if (ITEM_KEYS.some(key => changes[key])) render();
  if (changes.friends) friends = changes.friends.newValue || {};
  if (changes.friendList) friendList = changes.friendList.newValue || {};
  if (changes.watchedSummons) watchedSummons = changes.watchedSummons.newValue || [];
  if (changes.summonMinLevels) summonMinLevels = changes.summonMinLevels.newValue || {};
  if (changes.hiddenFriends) hiddenFriends = changes.hiddenFriends.newValue || {};
  if (changes.friends || changes.friendList || changes.watchedSummons || changes.summonMinLevels || changes.hiddenFriends) renderFriendsSection(document.getElementById('friends-section'));
  if (changes.friends) renderStatsSection(document.getElementById('stats-section'));
});

for (const tabButton of document.querySelectorAll('#tabs button')) {
  tabButton.addEventListener('click', () => {
    for (const other of document.querySelectorAll('#tabs button')) {
      other.classList.toggle('active', other === tabButton);
      document.getElementById(other.dataset.tab).hidden = other !== tabButton;
    }
  });
}

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
    chrome.storage.local.get(ITEM_KEYS, data => {
      for (const capture of imported) {
        for (const [key, extracted] of Object.entries(extractItems(capture))) data[key] = { ...data[key], ...extracted };
      }
      chrome.storage.local.set(data);
    });
  };
  reader.readAsText(file);
  event.target.value = '';
});

document.getElementById('clear').addEventListener('click', () => {
  chrome.storage.local.remove(['captures', ...ITEM_KEYS]);
});

const captureButton = document.getElementById('capture');
let capturing = false;
function renderCaptureButton() {
  captureButton.textContent = capturing ? 'Stop capturing' : 'Start capturing';
  captureButton.classList.toggle('capturing', capturing);
}
captureButton.addEventListener('click', () => chrome.storage.local.set({ capturing: !capturing }));
chrome.storage.onChanged.addListener(changes => {
  if (!changes.capturing) return;
  capturing = changes.capturing.newValue;
  renderCaptureButton();
});
chrome.storage.local.get('capturing', data => {
  capturing = !!data.capturing;
  renderCaptureButton();
});

loadAndRender();
