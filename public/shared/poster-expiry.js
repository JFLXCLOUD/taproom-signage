/** Use one absolute cutoff across phone, server, TV and cached/offline playback. */
export function posterExpired(board, now = Date.now()) {
  return board?.layout === 'poster' && Number.isFinite(board.content?.expiresAt) && board.content.expiresAt <= now;
}

export function normalizePosterExpiry(content, previous = {}) {
  const invalid = () => Object.assign(new Error('Choose a valid removal date.'), { status: 400 });
  const merged = { ...previous, ...content };
  if (!Object.hasOwn(content, 'removeOn')) {
    // Only the server can calculate the cutoff; unrelated edits retain it.
    merged.expiresAt = previous.expiresAt ?? null;
    merged.expiryTimeZone = previous.expiryTimeZone ?? null;
    return merged;
  }
  if (!content.removeOn) return { ...merged, removeOn: null, expiresAt: null, expiryTimeZone: null };
  const value = content.removeOn;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (year < 2000 || year > 9999 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw invalid();
  // Preserve the original timezone/cutoff if only other poster fields changed.
  if (value === previous.removeOn && Number.isFinite(previous.expiresAt)) return { ...merged, expiresAt: previous.expiresAt, expiryTimeZone: previous.expiryTimeZone };
  return { ...merged, expiresAt: date.getTime(), expiryTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function expiryLabel(board) {
  if (!board?.content?.removeOn) return '';
  return posterExpired(board) ? 'Expired · not showing on TVs' : 'Removes on ' + board.content.removeOn;
}
