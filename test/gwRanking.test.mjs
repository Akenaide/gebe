import test from 'node:test';
import assert from 'node:assert';
import { parseGwRanking, appendGwSnapshot, honorsRates, windowLength, mergeGwRankings, parseGwExport } from '../src/gwRanking.js';

// Same markup as a real /teamraid085/ranking/content/user page, trimmed to the parts we read.
function myRanking({ place, defeated, honors }) {
  return `<div class="prt-my-ranking">
					<div class="ico-rank-digits">${place}</div>
		<div class="prt-ranking-detail">
			<div class="prt-ranking-name">
				<div class="txt-name">Player</div>
				<div class="txt-rank">Rank 425</div>
			</div>
			<div class="prt-event-record">
				<div class="txt-record-title">Total</div>
				<div class="prt-point battle">
					<div class="txt-total">Defeated</div>
					<div class="txt-total-record">
													<span>${defeated}</span>
											</div>
				</div>
				<div class="prt-point honors">
					<div class="txt-total">Honors</div>
					<div class="txt-total-record"><span>${honors}</span></div>
				</div>
			</div>
		</div>
	</div>`;
}

// The top 3 show a crown (`ico-rank`) instead of the `#place` digits.
function listedRanking({ place, crown, defeated, honors }) {
  const placeIcon = crown ? `<div class="ico-rank" data-rank="${crown}"></div>` : `<div class="ico-rank-digits">${place}</div>`;
  return `<div class="lis-ranking">
															${placeIcon}
							<div class="prt-ranking-detail">
								<div class="prt-event-record">
									<div class="prt-point battle">
										<div class="txt-total">Defeated</div>
										<div class="txt-total-record"><span>${defeated}</span></div>
									</div>
									<div class="prt-point honors">
										<div class="txt-total">Honors</div>
										<div class="txt-total-record"><span>${honors}</span></div>
									</div>
								</div>
							</div>
						</div>`;
}

function rankingCapture(html) {
  return {
    url: 'https://game.granbluefantasy.jp/teamraid085/ranking/content/user?_=1&t=2&uid=1',
    responseBody: JSON.stringify({ data: encodeURIComponent(html), display_list: {}, option: {} }),
  };
}

test('parseGwRanking reads the player place, defeated and honors', () => {
  /**
   * Given a ranking page whose own entry is #18,728 with 819 defeated and 262,088,226 honors,
   * When parseGwRanking is called on it,
   * Then me holds place 18728, defeated 819 and honors 262088226 as numbers.
   */
  const capture = rankingCapture(myRanking({ place: '#18,728', defeated: '819', honors: '262,088,226' }));
  assert.deepStrictEqual(parseGwRanking(capture)?.me, { place: 18728, defeated: 819, honors: 262088226 });
});

test('parseGwRanking reads the event id from the URL', () => {
  /**
   * Given a ranking capture from /teamraid085/ranking/content/user,
   * When parseGwRanking is called on it,
   * Then eventId is teamraid085.
   */
  const capture = rankingCapture(myRanking({ place: '#18,728', defeated: '819', honors: '262,088,226' }));
  assert.strictEqual(parseGwRanking(capture).eventId, 'teamraid085');
});

test('parseGwRanking returns null for a body that is not JSON', () => {
  /**
   * Given a ranking capture whose body is an HTML error page instead of JSON,
   * When parseGwRanking is called on it,
   * Then it returns null.
   */
  const capture = { ...rankingCapture(''), responseBody: '<html>error</html>' };
  assert.strictEqual(parseGwRanking(capture), null);
});

test('parseGwRanking returns null for a page without the player entry', () => {
  /**
   * Given a ranking capture whose page has cutoffs but no prt-my-ranking entry,
   * When parseGwRanking is called on it,
   * Then it returns null.
   */
  const capture = rankingCapture(listedRanking({ place: '#2,000', defeated: '3,376', honors: '1,229,155,500' }));
  assert.strictEqual(parseGwRanking(capture), null);
});

test('parseGwRanking reads the cutoffs by place, skipping the top 3', () => {
  /**
   * Given a ranking page listing the #1 crown entry, then #2,000 (3,376 defeated, 1,229,155,500 honors) and #100,000 (559 defeated, 55,839,165 honors),
   * When parseGwRanking is called on it,
   * Then cutoffs holds only places 2000 and 100000 with their defeated and honors as numbers.
   */
  const capture = rankingCapture([
    myRanking({ place: '#18,728', defeated: '819', honors: '262,088,226' }),
    listedRanking({ crown: 1, defeated: '10,761', honors: '7,637,877,856' }),
    listedRanking({ place: '#2,000', defeated: '3,376', honors: '1,229,155,500' }),
    listedRanking({ place: '#100,000', defeated: '559', honors: '55,839,165' }),
  ].join('\n'));
  assert.deepStrictEqual(parseGwRanking(capture).cutoffs, {
    2000: { defeated: 3376, honors: 1229155500 },
    100000: { defeated: 559, honors: 55839165 },
  });
});

const ranking = (honors) => ({
  eventId: 'teamraid085',
  me: { place: 18728, defeated: 819, honors },
  cutoffs: { 100000: { defeated: 559, honors: 55839165 } },
});

test('appendGwSnapshot adds a timestamped snapshot under its event', () => {
  /**
   * Given no stored ranking and a parsed teamraid085 ranking taken at 1000,
   * When appendGwSnapshot is called,
   * Then teamraid085 holds one snapshot with at 1000, me and cutoffs.
   */
  const parsed = ranking(262088226);
  assert.deepStrictEqual(appendGwSnapshot(undefined, parsed, 1000), {
    teamraid085: [{ at: 1000, me: parsed.me, cutoffs: parsed.cutoffs }],
  });
});

test('appendGwSnapshot skips a ranking identical to the last snapshot', () => {
  /**
   * Given a stored teamraid085 snapshot taken at 1000,
   * When appendGwSnapshot is called at 2000 with the same me and cutoffs,
   * Then the stored ranking is returned unchanged, keeping only the snapshot at 1000.
   */
  const parsed = ranking(262088226);
  const stored = appendGwSnapshot(undefined, parsed, 1000);
  assert.strictEqual(appendGwSnapshot(stored, parsed, 2000), stored);
});

test('appendGwSnapshot skips an identical ranking stored with its keys reordered', () => {
  /**
   * Given a stored teamraid085 snapshot whose keys are in alphabetical order, as chrome.storage returns them,
   * When appendGwSnapshot is called with a ranking holding the same values,
   * Then the stored ranking is returned unchanged.
   */
  const parsed = ranking(262088226);
  const stored = {
    teamraid085: [{ at: 1000, cutoffs: { 100000: { honors: 55839165, defeated: 559 } }, me: { defeated: 819, honors: 262088226, place: 18728 } }],
  };
  assert.strictEqual(appendGwSnapshot(stored, parsed, 2000), stored);
});

const HOUR = 3600 * 1000;

function snapshot({ at, place, honors, cutoffs }) {
  return { at, me: { place, defeated: 0, honors }, cutoffs };
}

test('honorsRates gives the honors per hour between two snapshots', () => {
  /**
   * Given a snapshot at 0 (me 1,000, #100k 500) and one 2 hours later (me #18,000 at 5,000, #100k 2,500),
   * When honorsRates is called on them,
   * Then it returns one row from 0 to 2h with me at 2,000/h and place 18000, and #100k at 1,000/h.
   */
  const to = 2 * HOUR;
  const snapshots = [
    snapshot({ at: 0, place: 19000, honors: 1000, cutoffs: { 100000: { defeated: 0, honors: 500 } } }),
    snapshot({ at: to, place: 18000, honors: 5000, cutoffs: { 100000: { defeated: 0, honors: 2500 } } }),
  ];
  assert.deepStrictEqual(honorsRates(snapshots), [
    { from: 0, to, place: 18000, placeChange: 1000, me: 2000, cutoffs: { 100000: 1000 } },
  ]);
});

test('honorsRates gives how many places the player climbed in the window', () => {
  /**
   * Given a snapshot at #26,869 and one an hour later at #24,587,
   * When honorsRates is called on them,
   * Then the row's placeChange is 2282 (positive means climbed).
   */
  const snapshots = [
    snapshot({ at: 0, place: 26869, honors: 0, cutoffs: {} }),
    snapshot({ at: HOUR, place: 24587, honors: 0, cutoffs: {} }),
  ];
  assert.strictEqual(honorsRates(snapshots)[0].placeChange, 2282);
});

test('windowLength shows a window under an hour in minutes', () => {
  /**
   * Given a window of 37 minutes,
   * When windowLength is called on it,
   * Then it returns 37m.
   */
  assert.strictEqual(windowLength(37 * 60_000), '37m');
});

test('windowLength shows a window of an hour or more as hours and padded minutes', () => {
  /**
   * Given a window of 1 hour 2 minutes,
   * When windowLength is called on it,
   * Then it returns 1h02.
   */
  assert.strictEqual(windowLength(62 * 60_000), '1h02');
});

test('honorsRates lists the newest window first', () => {
  /**
   * Given three snapshots at 0, 1h and 2h,
   * When honorsRates is called on them,
   * Then the windows come out as 1h–2h then 0–1h.
   */
  const snapshots = [0, HOUR, 2 * HOUR].map(at => snapshot({ at, place: 1, honors: at, cutoffs: {} }));
  assert.deepStrictEqual(honorsRates(snapshots).map(({ from, to }) => [from, to]), [[HOUR, 2 * HOUR], [0, HOUR]]);
});

test('honorsRates leaves out a cutoff missing from the earlier snapshot', () => {
  /**
   * Given a snapshot at 0 with no #200k cutoff and one at 1h that lists #200k,
   * When honorsRates is called on them,
   * Then the row's cutoffs have no 200000 rate.
   */
  const snapshots = [
    snapshot({ at: 0, place: 1, honors: 0, cutoffs: {} }),
    snapshot({ at: HOUR, place: 1, honors: 0, cutoffs: { 200000: { defeated: 0, honors: 100 } } }),
  ];
  assert.deepStrictEqual(honorsRates(snapshots)[0].cutoffs, {});
});

test('mergeGwRankings interleaves both machines snapshots by time', () => {
  /**
   * Given a local teamraid085 with snapshots at 0 and 2h, and an imported one with a snapshot at 1h, all with different honors,
   * When mergeGwRankings is called on them,
   * Then teamraid085 holds the snapshots at 0, 1h and 2h in that order.
   */
  const at = [0, HOUR, 2 * HOUR];
  const [first, second, third] = at.map((time, i) => snapshot({ at: time, place: 1, honors: i, cutoffs: {} }));
  const merged = mergeGwRankings({ teamraid085: [first, third] }, { teamraid085: [second] });
  assert.deepStrictEqual(merged.teamraid085.map(s => s.at), at);
});

test('mergeGwRankings keeps only the earliest sighting of a ranking both machines saw', () => {
  /**
   * Given a local snapshot at 0 and an imported snapshot 10 minutes later with the same place and honors,
   * When mergeGwRankings is called on them,
   * Then teamraid085 holds only the snapshot at 0.
   */
  const seen = { place: 24587, honors: 478266501, cutoffs: {} };
  const merged = mergeGwRankings({ teamraid085: [snapshot({ at: 0, ...seen })] }, { teamraid085: [snapshot({ at: 10 * 60_000, ...seen })] });
  assert.deepStrictEqual(merged.teamraid085.map(s => s.at), [0]);
});

test('parseGwExport rejects a file that is not a ranking export', () => {
  /**
   * Given the text of a captures.json export (an array of raw captures),
   * When parseGwExport is called on it,
   * Then it returns null.
   */
  const capturesFile = JSON.stringify([{ id: '1', url: 'https://game.granbluefantasy.jp/', responseBody: '{}' }]);
  assert.strictEqual(parseGwExport(capturesFile), null);
});

test('parseGwExport rejects a file that is not JSON', () => {
  /**
   * Given the text of a file that is not JSON,
   * When parseGwExport is called on it,
   * Then it returns null.
   */
  assert.strictEqual(parseGwExport('not json'), null);
});

test('parseGwExport accepts a ranking export', () => {
  /**
   * Given the text of a gwRanking export with one teamraid085 snapshot,
   * When parseGwExport is called on it,
   * Then it returns that ranking.
   */
  const exported = appendGwSnapshot(undefined, ranking(262088226), 1000);
  assert.deepStrictEqual(parseGwExport(JSON.stringify(exported)), exported);
});
