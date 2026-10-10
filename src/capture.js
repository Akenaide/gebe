// Only the game API is read by the panel; CDN assets, fonts and analytics were ~88% of stored bytes.
export function shouldCapture(url) {
  return new URL(url).host === 'game.granbluefantasy.jp';
}
