import { createHash } from 'node:crypto';
import type { M3uEntry } from './types.js';

/** Hash exactly what is retained, in provider order, not discarded catalogue data.
 * Physical line offsets and attribute key order are formatting, not identity.
 * URLs remain significant, but only the digest is stored or exposed.
 */
export function retainedPlaylistFingerprint(
  entries: readonly M3uEntry[],
): string {
  const hash = createHash('sha256').update('iptvmaster-retained-playlist-v1\n');
  for (const entry of entries) {
    hash
      .update(
        JSON.stringify([
          entry.mediaType,
          entry.name,
          entry.url,
          entry.duration,
          Object.entries(entry.attributes).sort(([a], [b]) =>
            a.localeCompare(b, 'en'),
          ),
        ]),
      )
      .update('\n');
  }
  return hash.digest('hex');
}
