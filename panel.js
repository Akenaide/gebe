import { countCrateDuplicates, countInventoryDuplicates, combineDuplicateSections } from './src/itemStats.js';
import { bestLevels, countSupportStats, findMissingDetails, findMissingSummons, groupLayout, offersAll } from './src/supporters.js';
import { freshAssistLists, sortByTargetHp } from './src/assistRaids.js';
import { createWriteQueue } from './src/writeQueue.js';
import { ELEMENTS } from './src/elements.js';

const { enqueueUpdate, enqueueRemove } = createWriteQueue(chrome.storage.local);

const ASSET_BASE = 'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img_low/sp/assets';

function thumbnailUrl(assetFolder, id) {
  return `${ASSET_BASE}/${assetFolder}/s/${id}.jpg`;
}

function wikiUrl(itemName) {
  return `https://gbf.wiki/${encodeURIComponent(itemName.replace(/ /g, '_'))}`;
}

let selectedAttribute = null;
const ITEM_KEYS = ['crate', 'ownedSummons', 'ownedWeapons'];
let items = { crate: {}, ownedSummons: {}, ownedWeapons: {} };
let friends = {};
let friendList = {};
let nonFriends = {};
let watchedSummons = [];
let summonMinLevels = {};
let hiddenFriends = {};
let assistRaids = {};
let currentRaid = null;
let raidTargetHp = {};
// Lists from quests left behind stop polling; past this age they're hidden.
const ASSIST_MAX_AGE = 5 * 60_000;
let showAllFriends = false;
let showHiddenFriends = false;
// Summons a non-friend must all offer, at these min levels, to be listed; kept until DevTools closes.
let nonFriendFilter = [];
let nonFriendMinLevels = {};

function renderFilterBar(container) {
  container.innerHTML = '';
  const options = [null, ...Object.values(ELEMENTS)];
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
  const crateDuplicates = countCrateDuplicates(items.crate, itemKindId);
  const inventoryDuplicates = countInventoryDuplicates(owned);
  let rows = combineDuplicateSections(crateDuplicates, inventoryDuplicates);
  if (selectedAttribute) rows = rows.filter(row => row.attribute_name === selectedAttribute);

  container.innerHTML = `<h3>${title}</h3><div class="duplicate-grid"></div>`;
  const grid = container.querySelector('.duplicate-grid');
  for (const row of rows) {
    const total = row.crateCount + row.zeroStarCount + row.nonZeroStars.length;
    const stars = row.nonZeroStars.map(s => `${s.evolution}★`).join(' ');
    const breakdown = [];
    if (row.crateCount > 0) breakdown.push(`${row.crateCount} unclaimed`);
    if (row.zeroStarCount > 0) breakdown.push(`${row.zeroStarCount} owned 0★`);
    if (stars) breakdown.push(`owned ${stars}`);

    const el = document.createElement('div');
    el.className = 'duplicate-card';
    if (total === 3) el.classList.add('level-3');
    if (total >= 4) el.classList.add('level-4plus');
    el.title = row.item_name ?? String(row.id);
    // Built as text, never HTML, like every other section.
    const thumbWrap = el.appendChild(document.createElement('div'));
    thumbWrap.className = 'thumb-wrap';
    thumbWrap.appendChild(document.createElement('img')).src = thumbnailUrl(assetFolder, row.id);
    const name = el.appendChild(document.createElement('div'));
    name.className = 'name';
    if (row.item_name) {
      const link = name.appendChild(document.createElement('a'));
      link.href = wikiUrl(row.item_name);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = row.item_name;
    } else {
      name.textContent = row.id;
    }
    for (const [className, text] of [['total', `×${total}`], ['breakdown', breakdown.join(', ')]]) {
      const div = el.appendChild(document.createElement('div'));
      div.className = className;
      div.textContent = text;
    }
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

// A summon thumbnail with a caption underneath (a level, or a num-input input).
function summonTile(id, title, caption) {
  const tile = document.createElement('div');
  tile.className = 'summon-tile';
  tile.append(summonThumb(id, title), caption);
  return tile;
}

function levelCaption(level) {
  const caption = document.createElement('div');
  caption.className = 'meta';
  caption.textContent = level ? `Lvl ${level}` : '—';
  return caption;
}

// A friend's supports laid out like the game's element tabs, all tabs visible at once.
function supportGrid(friend, allSummons) {
  const grid = document.createElement('div');
  grid.className = 'support-grid';
  if (!friend.layout || !Object.keys(friend.layout).length) {
    grid.textContent = 'no layout yet — seen before layouts were tracked';
    grid.classList.add('meta');
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

// Details has no name, so a friend first seen there takes it from the friend list pages.
function friendName(userId) {
  return friends[userId]?.name ?? friendList[userId]?.name ?? userId;
}

function profileLink(userId, name = friendName(userId)) {
  const link = document.createElement('a');
  link.href = `https://game.granbluefantasy.jp/#profile/${userId}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = name;
  return link;
}

// Summon names from friends' layouts; a layout saved before names were stored falls back to the id.
function summonNames(store = friends) {
  const names = {};
  for (const friend of Object.values(store)) for (const { id, name } of Object.values(friend.layout ?? {})) names[id] = name ?? names[id] ?? id;
  return names;
}

function tableHeader(table, labels) {
  const header = table.createTHead().insertRow();
  return labels.map(label => {
    const th = header.appendChild(document.createElement('th'));
    th.textContent = label;
    return th;
  });
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
  const save = () =>
    enqueueUpdate('hiddenFriends', hidden => {
      const next = { ...hidden };
      if (tick.checked) next[userId] = note.value;
      else delete next[userId];
      return next;
    });
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
    for (const key of ['friends', 'hiddenFriends', 'friendList']) {
      enqueueUpdate(key, stored => {
        const next = { ...stored };
        delete next[userId];
        return next;
      });
    }
  });
  return button;
}

// Click a summon to pick it; a picked one gets a min Lvl input under it.
function fillSummonPicker(picker, allSummons, picked, minLevels, { toggle, setMinLevel }) {
  for (const [id, name] of Object.entries(allSummons).sort((a, b) => a[1].localeCompare(b[1]))) {
    const thumb = summonThumb(id, name);
    thumb.addEventListener('click', () => toggle(id));
    if (!picked.includes(id)) {
      picker.appendChild(thumb);
      continue;
    }
    thumb.classList.add('watched');
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.className = 'num-input';
    minInput.placeholder = 'min Lvl';
    minInput.value = minLevels[id] ?? '';
    minInput.addEventListener('change', () => setMinLevel(id, minInput.value));
    const tile = document.createElement('div');
    tile.className = 'summon-tile';
    tile.append(thumb, minInput);
    picker.appendChild(tile);
  }
}

function renderFriendsSection(container) {
  const allSummons = summonNames();
  // Keep watched summons pickable after "Clear friends", so they can still be un-watched.
  for (const id of watchedSummons) allSummons[id] ??= id;

  container.innerHTML = `<h3>Friends (${Object.keys(friends).length} tracked)</h3>
    <div class="section-controls">
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
  container.querySelector('.clear-friends').addEventListener('click', () => enqueueRemove('friends'));

  // Friends from the friend list pages Gebe has no record of yet; opening their Details fills one in.
  const missingDetails = findMissingDetails(friendList, friends);
  if (missingDetails.length) {
    const block = container.querySelector('.missing-details');
    // Gebe only sees the tab DevTools is open on, so a link opening a new tab wouldn't capture anything.
    const missingCount = missingDetails.reduce((sum, { friends: missing }) => sum + missing.length, 0);
    block.innerHTML = `<h4>Details missing (${missingCount} of ${Object.keys(friendList).length} listed)</h4>
      <div class="meta">Open each one's Details from that friend list page, in this tab.</div>`;
    for (const { page, friends: missing } of missingDetails) {
      const row = document.createElement('div');
      row.className = 'friend-row';
      row.append(`Page ${page}:`);
      for (const { userId, name } of missing) row.append(name ?? userId, deleteButton(userId));
      block.appendChild(row);
    }
  }

  // Watch-list picker: click a summon to toggle whether friends missing it get flagged.
  fillSummonPicker(container.querySelector('.friend-picker'), allSummons, watchedSummons, summonMinLevels, {
    toggle: id => enqueueUpdate('watchedSummons', (watched = []) => (watched.includes(id) ? watched.filter(w => w !== id) : [...watched, id])),
    setMinLevel: (id, value) =>
      enqueueUpdate('summonMinLevels', minLevels => {
        const next = { ...minLevels };
        if (value) next[id] = Number(value);
        else delete next[id];
        return next;
      }),
  });

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
    const meta = document.createElement('span');
    meta.className = 'meta';
    // A friend only seen through their Details has no sighting yet.
    meta.textContent = row.lastSeen ? `seen ${row.sightings}× · last ${new Date(row.lastSeen).toLocaleString()}` : 'seen only in Details';
    el.append(profileLink(row.userId), meta, hideControls(row.userId), deleteButton(row.userId));
    if (row.missing?.length) {
      const label = document.createElement('span');
      label.className = 'meta';
      label.textContent = 'missing:';
      el.appendChild(label);
      // Its level in the current layout tells "has it, but too low" apart from "doesn't offer it" (—).
      const levels = bestLevels(row.layout);
      for (const id of row.missing) el.appendChild(summonTile(id, allSummons[id] ?? id, levelCaption(levels[id])));
    }
    card.append(el, supportGrid(row, allSummons));
    list.appendChild(card);
  }
}

// Non-friends seen on supporter pages, to friend later for their supports; one friended since drops out.
function renderNonFriendsSection(container) {
  const allSummons = summonNames(nonFriends);
  const rows = Object.entries(nonFriends)
    .filter(([userId, nonFriend]) => !(userId in friends) && offersAll(nonFriend.layout, nonFriendFilter, nonFriendMinLevels))
    .map(([userId, nonFriend]) => ({ userId, ...nonFriend }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
  container.innerHTML = `<h3>Non-friends (${rows.length} seen)</h3>
    <div class="section-controls"><button class="clear-non-friends">Clear non-friends</button></div>
    <div class="meta">Click summons to list only non-friends offering all of them.</div>
    <div class="friend-picker"></div>`;
  container.querySelector('.clear-non-friends').addEventListener('click', () => enqueueRemove('nonFriends'));
  fillSummonPicker(container.querySelector('.friend-picker'), allSummons, nonFriendFilter, nonFriendMinLevels, {
    toggle: id => {
      nonFriendFilter = nonFriendFilter.includes(id) ? nonFriendFilter.filter(picked => picked !== id) : [...nonFriendFilter, id];
      renderNonFriendsSection(container);
    },
    setMinLevel: (id, value) => {
      nonFriendMinLevels = { ...nonFriendMinLevels, [id]: value ? Number(value) : undefined };
      renderNonFriendsSection(container);
    },
  });
  for (const row of rows) {
    const card = container.appendChild(document.createElement('div'));
    card.className = 'friend-card';
    const el = document.createElement('div');
    el.className = 'friend-row';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `seen ${row.sightings}× · last ${new Date(row.lastSeen).toLocaleString()}`;
    el.append(profileLink(row.userId, row.name), meta);
    card.append(el, supportGrid(row, allSummons));
  }
}

// How many friends offer each support right now, from their current layouts.
let statsSort = { key: 'friends', descending: true };
let statsPick = null; // {id, level}: the level clicked to list who offers it

function renderStatsSection(container) {
  const allSummons = summonNames();
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
  const columns = [[null, ''], ['name', 'Summon'], ['friends', 'Friends'], [null, 'Levels (click one to see who)']];
  const headers = tableHeader(table, columns.map(([key, label]) => label + (key === statsSort.key ? (statsSort.descending ? ' ▼' : ' ▲') : '')));
  for (const [index, [key]] of columns.entries()) {
    if (!key) continue;
    headers[index].className = 'sortable';
    headers[index].addEventListener('click', () => {
      statsSort = { key, descending: key === statsSort.key ? !statsSort.descending : key === 'friends' };
      renderStatsSection(container);
    });
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
      for (const userId of userIds) whoCell.appendChild(profileLink(userId));
    }
  }
}

// The game's log types: 1 normal attack, 2 charge attack, 12/13 boss overdrive/break.
const LOG_TYPE_CLASSES = { 1: 'log-attack', 2: 'log-charge', 12: 'log-boss', 13: 'log-boss' };

// Times are in seconds; a battle log line only has its minute.
function minuteTime(time) {
  return `~${new Date(time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// The log as last drawn: honors change every second, but the log only when the battle log is opened.
let renderedLog = null;

function renderCurrentRaid(container) {
  if (!currentRaid) {
    container.innerHTML = '<h3>Current raid</h3><div class="meta">Enter a raid with DevTools open, then open the game\'s battle log.</div>';
    return;
  }
  const hpPercent = ((100 * currentRaid.hp) / currentRaid.hpmax).toFixed(1);
  if (!container.querySelector('.raid-log')) {
    container.innerHTML = `<h3></h3>
      <div class="meta"></div>
      <table class="stats-table"></table>
      <div class="raid-log"></div>`;
    renderedLog = null;
  }
  // Names and log lines come from other players, so everything goes in as text, never HTML.
  container.querySelector('h3').textContent = `${currentRaid.boss}: ${currentRaid.hp.toLocaleString()} HP (${hpPercent}%)`;
  container.querySelector('.meta').textContent = `Battle ID ${currentRaid.battleId} · entered ${new Date(currentRaid.enteredAt * 1000).toLocaleTimeString()}`;
  const nameOf = userId => currentRaid.members[userId] ?? userId;
  // Golden-angle hues keep players who joined one after another far apart on the color wheel.
  const players = currentRaid.players ?? [];
  const colorOf = userId => (players.includes(userId) ? `hsl(${(players.indexOf(userId) * 137.5) % 360} 75% 38%)` : '');
  const table = container.querySelector('table');
  table.replaceChildren();
  tableHeader(table, ['#', 'Player', 'Honors', 'Last action']);
  const body = table.createTBody();
  const honors = currentRaid.honors ?? {};
  // Ranked like the game's MVP list; players with no honors yet go last.
  const ranked = [...new Set([...players, ...Object.keys(honors)])].toSorted((a, b) => (honors[b] ?? -1) - (honors[a] ?? -1));
  for (const [index, userId] of ranked.entries()) {
    const row = body.insertRow();
    const lastAction = currentRaid.lastActionAt?.[userId];
    for (const value of [index + 1, nameOf(userId), honors[userId]?.toLocaleString() ?? '', lastAction ? new Date(lastAction * 1000).toLocaleTimeString() : '']) row.insertCell().textContent = value;
    row.style.color = colorOf(userId);
  }
  const logKey = JSON.stringify(currentRaid.log);
  if (logKey === renderedLog) return;
  renderedLog = logKey;
  const log = container.querySelector('.raid-log');
  // Rebuilding keeps the log where the player scrolled it.
  const logScroll = log.scrollTop;
  log.replaceChildren();
  for (const line of currentRaid.log.toReversed()) {
    const row = document.createElement('div');
    row.className = LOG_TYPE_CLASSES[line.type] ?? '';
    // Boss events carry the user id of whoever triggered them, so they don't take a player's color.
    if (row.className !== 'log-boss') row.style.color = colorOf(line.userId);
    const time = document.createElement('span');
    time.className = 'meta';
    // Lines from before 1.7 came from the socket, with the exact second.
    time.textContent = line.approximate ? `${minuteTime(line.time)} ` : `${new Date(line.time * 1000).toLocaleTimeString()} `;
    row.appendChild(time);
    // Grouped numbers (damage, honors) are put in bold; split on them so the rest stays plain text.
    for (const [index, part] of line.text.split(/(\d{1,3}(?:,\d{3})+)/).entries()) {
      if (index % 2) row.appendChild(document.createElement('b')).textContent = part;
      else row.append(part);
    }
    log.appendChild(row);
  }
  log.scrollTop = logScroll;
}

function renderAssistSection(container) {
  const lists = freshAssistLists(assistRaids, Date.now(), ASSIST_MAX_AGE);
  for (const block of container.querySelectorAll('[data-key]')) if (!(block.dataset.key in lists)) block.remove();
  for (const [key, list] of Object.entries(lists).sort()) {
    const questId = key.split('/')[1];
    // Each list keeps its block across polls, so its target input doesn't lose focus while typing.
    let block = container.querySelector(`[data-key="${key}"]`);
    if (!block) {
      block = document.createElement('div');
      block.dataset.key = key;
      block.innerHTML = `<h4></h4>
        <label>Target HP% <input type="number" class="num-input" min="0" max="100" /></label>
        <div class="assist-list"></div>`;
      const input = block.querySelector('input');
      input.addEventListener('change', () =>
        enqueueUpdate('raidTargetHp', targets => {
          const next = { ...targets };
          if (input.value) next[questId] = Number(input.value);
          else delete next[questId];
          return next;
        })
      );
      container.appendChild(block);
    }
    const input = block.querySelector('input');
    if (document.activeElement !== input) input.value = raidTargetHp[questId] ?? '';
    renderAssistList(block, list, raidTargetHp[questId]);
  }
}

function renderAssistList(block, list, target) {
  const raids = target == null ? list.raids : sortByTargetHp(list.raids, target);
  // An empty list has no raid name, so the heading keeps the last one seen.
  if (raids.length) block.querySelector('h4').textContent = raids[0].name;
  else if (!block.querySelector('h4').textContent) block.querySelector('h4').textContent = `Quest ${block.dataset.key.split('/')[1]}`;
  const container = block.querySelector('.assist-list');
  // Gebe only sees a list while the game's backup screen is open and polling it.
  container.innerHTML = `<div class="meta">Received ${new Date(list.receivedAt).toLocaleTimeString()}</div><table class="stats-table"></table>`;
  const table = container.querySelector('table');
  table.replaceChildren();
  tableHeader(table, ['HP%', 'Host', 'Members', 'Time left']);
  const body = table.createTBody();
  for (const [index, raid] of raids.entries()) {
    const row = body.insertRow();
    // Host names are typed by other players, so they go in as text, never HTML.
    for (const value of [`${raid.hp}%`, raid.host, `${raid.members}/${raid.limit}`, raid.timeLeft]) {
      row.insertCell().textContent = value;
    }
    if (target != null && index === 0) row.classList.add('closest-raid');
  }
}

document.getElementById('clear-raids').addEventListener('click', () => enqueueRemove('assistRaids'));
// No poll arrives once the backup screen is left, so re-check ages on a timer.
setInterval(() => renderAssistSection(document.getElementById('assist-section')), 30_000);

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
  chrome.storage.local.get([...ITEM_KEYS, 'friends', 'friendList', 'nonFriends', 'watchedSummons', 'summonMinLevels', 'hiddenFriends', 'assistRaids', 'raidTargetHp', 'currentRaid'], data => {
    friends = data.friends || {};
    friendList = data.friendList || {};
    nonFriends = data.nonFriends || {};
    hiddenFriends = data.hiddenFriends || {};
    watchedSummons = data.watchedSummons || [];
    summonMinLevels = data.summonMinLevels || {};
    assistRaids = data.assistRaids || {};
    raidTargetHp = data.raidTargetHp || {};
    currentRaid = data.currentRaid || null;
    for (const key of ITEM_KEYS) items[key] = data[key] || {};
    render();
    renderFriendsSection(document.getElementById('friends-section'));
    renderNonFriendsSection(document.getElementById('non-friends-section'));
    renderStatsSection(document.getElementById('stats-section'));
    renderAssistSection(document.getElementById('assist-section'));
    renderCurrentRaid(document.getElementById('current-raid-section'));
  });
}

chrome.storage.onChanged.addListener(changes => {
  for (const key of ITEM_KEYS) if (changes[key]) items[key] = changes[key].newValue || {};
  if (ITEM_KEYS.some(key => changes[key])) render();
  if (changes.friends) friends = changes.friends.newValue || {};
  if (changes.friendList) friendList = changes.friendList.newValue || {};
  if (changes.nonFriends) nonFriends = changes.nonFriends.newValue || {};
  if (changes.nonFriends || changes.friends) renderNonFriendsSection(document.getElementById('non-friends-section'));
  if (changes.watchedSummons) watchedSummons = changes.watchedSummons.newValue || [];
  if (changes.summonMinLevels) summonMinLevels = changes.summonMinLevels.newValue || {};
  if (changes.hiddenFriends) hiddenFriends = changes.hiddenFriends.newValue || {};
  if (changes.friends || changes.friendList || changes.watchedSummons || changes.summonMinLevels || changes.hiddenFriends) renderFriendsSection(document.getElementById('friends-section'));
  if (changes.friends) renderStatsSection(document.getElementById('stats-section'));
  if (changes.assistRaids) assistRaids = changes.assistRaids.newValue || {};
  if (changes.raidTargetHp) raidTargetHp = changes.raidTargetHp.newValue || {};
  if (changes.currentRaid) {
    currentRaid = changes.currentRaid.newValue || null;
    renderCurrentRaid(document.getElementById('current-raid-section'));
  }
  if (changes.assistRaids || changes.raidTargetHp) renderAssistSection(document.getElementById('assist-section'));
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

document.getElementById('clear').addEventListener('click', () => {
  enqueueRemove(['captures', ...ITEM_KEYS]);
});

const captureButton = document.getElementById('capture');
let capturing = false;
function renderCaptureButton() {
  captureButton.textContent = capturing ? 'Stop capturing' : 'Start capturing';
  captureButton.classList.toggle('capturing', capturing);
}
captureButton.addEventListener('click', () => {
  if (capturing) chrome.storage.local.set({ capturing: false });
  // Turn capturing on only once the old captures are gone, so the first new one isn't wiped.
  else enqueueRemove('captures').then(() => chrome.storage.local.set({ capturing: true }));
});
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
