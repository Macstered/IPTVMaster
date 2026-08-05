const DECORATION_RUN = /[^\p{L}\p{N}\s]{2,}/u;
const LEADING_DECORATION =
  /^[^\p{L}\p{N}]*?([^\p{L}\p{N}\s]{2,})\s*(?=[\p{L}\p{N}])/u;
const TRAILING_DECORATION =
  /(?<=[\p{L}\p{N}])\s*([^\p{L}\p{N}\s]{2,})[^\p{L}\p{N}]*$/u;
const EVENT_TIME_PREFIX = /^\s*(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s|$)/u;

/**
 * Detects decorative separator entries that providers insert between real
 * channels, such as `-=Finland=-`, `── SPORTS ──`, or `*** FI ***`. These are
 * kept in playlists as visual dividers but can never carry guide data.
 *
 * A name is a separator when it has no letters or digits at all, or when a run
 * of at least two decoration characters both precedes and follows the label.
 * Single decorations found in real names (`FI: Yle TV1`, `Canal+`, `E!`,
 * `24/7 Movies`) do not qualify.
 */
export function isSeparatorChannelName(name: string): boolean {
  const trimmed = name.normalize('NFKC').trim();
  if (!trimmed) return false;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return DECORATION_RUN.test(trimmed);
  return LEADING_DECORATION.test(trimmed) && TRAILING_DECORATION.test(trimmed);
}

/**
 * Detects channel names that look like transient live-event entries, such as
 * `19:30 HJK Helsinki - Inter Turku 8/5`. Event streams change daily and are
 * not mappable to XMLTV guide channels; their provider group should usually be
 * marked as a live-event group instead.
 */
export function looksLikeEventTitle(name: string): boolean {
  return EVENT_TIME_PREFIX.test(name.normalize('NFKC').trim());
}
