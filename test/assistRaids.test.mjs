import test from 'node:test';
import assert from 'node:assert';
import { parseAssistRaids, sortByTargetHp, assistListKey, freshAssistLists } from '../src/assistRaids.js';

// Same shape as a real /rest/quest/assist/search/assist_list/ entry, trimmed to the fields we read.
function assistRaid({ raidId, host, hp, members, timeLeft }) {
  return {
    chapter_name: 'Prosperity Verboten: Belmervolk',
    raid: { multi_raid_id: raidId, quest_id: '305771' },
    boss_hp_width: hp,
    remaining_time: timeLeft,
    member_count: members,
    assist_user_limit: 6,
    called_user_name: host,
  };
}

function assistCapture(raids) {
  return {
    url: 'https://game.granbluefantasy.jp/rest/quest/assist/search/assist_list/1/305771?_=1',
    responseBody: JSON.stringify({ assist_raids_data: raids }),
  };
}

test('parseAssistRaids returns one row per backup request', () => {
  /**
   * Given an assist_list capture holding one backup request from 癒月, boss at 37% with 5 of 6 members and 26:46 left,
   * When parseAssistRaids is called on it,
   * Then it returns one row with raidId, questId, name, host, hp, members, limit and timeLeft.
   */
  const raidId = '47030363725';
  const host = '癒月';
  const capture = assistCapture([assistRaid({ raidId, host, hp: 37, members: 5, timeLeft: '00:26:46' })]);
  assert.deepStrictEqual(parseAssistRaids(capture), [
    { raidId, questId: '305771', name: 'Prosperity Verboten: Belmervolk', host, hp: 37, members: 5, limit: 6, timeLeft: '00:26:46' },
  ]);
});

test('parseAssistRaids returns nothing for a body that is not JSON', () => {
  /**
   * Given an assist_list capture whose body is an HTML error page,
   * When parseAssistRaids is called on it,
   * Then it returns an empty list instead of throwing.
   */
  const capture = { url: assistCapture([]).url, responseBody: '<html>maintenance</html>' };
  assert.deepStrictEqual(parseAssistRaids(capture), []);
});

test('sortByTargetHp puts the raids closest to the target HP first', () => {
  /**
   * Given backup requests with the boss at 63%, 15%, 37% and 18%,
   * When sortByTargetHp is called with a target of 30%,
   * Then it returns them ordered 37%, 18%, 15%, 63% (7, 12, 15 and 33 points away).
   */
  const raids = [63, 15, 37, 18].map(hp => ({ hp }));
  assert.deepStrictEqual(sortByTargetHp(raids, 30).map(raid => raid.hp), [37, 18, 15, 63]);
});

test('assistListKey tells apart the backup lists the game polls in turn', () => {
  /**
   * Given two real assist_list URLs polled in turn from one backup screen (2/305671 and 4/305681),
   * When assistListKey is called on each,
   * Then it returns "2/305671" and "4/305681".
   */
  assert.deepStrictEqual(
    [
      'https://game.granbluefantasy.jp/rest/quest/assist/search/assist_list/2/305671?_=1792262549060&t=1792263266391&uid=26271737',
      'https://game.granbluefantasy.jp/rest/quest/assist/search/assist_list/4/305681?_=1792262549061&t=1792263268207&uid=26271737',
    ].map(assistListKey),
    ['2/305671', '4/305681'],
  );
});

test('parseAssistRaids returns nothing for a JSON body without a backup list', () => {
  /**
   * Given an assist_list capture whose body is a JSON error object with no assist_raids_data,
   * When parseAssistRaids is called on it,
   * Then it returns an empty list instead of throwing.
   */
  const capture = { url: assistCapture([]).url, responseBody: '{"error":1}' };
  assert.deepStrictEqual(parseAssistRaids(capture), []);
});

test('freshAssistLists keeps only the backup lists received recently', () => {
  /**
   * Given a list received 1 minute ago and another received 10 minutes ago,
   * When freshAssistLists is called with a maximum age of 5 minutes,
   * Then only the 1-minute-old list is kept.
   */
  const now = 1792264670519;
  const minute = 60_000;
  const recent = { raids: [], receivedAt: now - minute };
  const lists = { '1/305771': recent, '2/305671': { raids: [], receivedAt: now - 10 * minute } };
  assert.deepStrictEqual(freshAssistLists(lists, now, 5 * minute), { '1/305771': recent });
});
