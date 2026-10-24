// Both times are in seconds.
export function relativeTime(time, now) {
  const seconds = Math.max(0, Math.floor(now - time));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
