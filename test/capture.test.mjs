import test from 'node:test';
import assert from 'node:assert';
import { shouldCapture } from '../src/capture.js';

test('shouldCapture keeps game API requests', () => {
  /**
   * Given a request to the game host game.granbluefantasy.jp,
   * When shouldCapture is called,
   * Then it returns true.
   */
  assert.strictEqual(shouldCapture('https://game.granbluefantasy.jp/quest/content/supporter_raid/47007998137/2/0?_=1'), true);
});

test('shouldCapture drops asset, font and analytics requests', () => {
  /**
   * Given requests to the CDN, a font host and an analytics host (84%+ of real captured bytes),
   * When shouldCapture is called,
   * Then it returns false for each.
   */
  for (const url of [
    'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img_low/sp/assets/summon/s/2040056000.jpg',
    'https://fonts.fontplus.dev/v1/css/FDvFvGCJ',
    'https://event-api.analytics.mbga.jp/log',
  ]) {
    assert.strictEqual(shouldCapture(url), false, url);
  }
});
