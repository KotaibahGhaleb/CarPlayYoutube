// Paired-phone commands can be delivered twice when a listener is registered
// twice. The second copy must not toggle playback again.

export function rememberCommand(
  seen: Set<string>,
  id: string,
  max = 100
): boolean {
  if (!id) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  while (seen.size > max) {
    const first = seen.values().next().value;
    if (first === undefined) break;
    seen.delete(first);
  }
  return true;
}
