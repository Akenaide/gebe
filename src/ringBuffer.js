export function mergeEntries(existing, imported) {
  const existingIds = new Set(existing.map(e => e.id));
  return [...existing, ...imported.filter(e => !existingIds.has(e.id))];
}
