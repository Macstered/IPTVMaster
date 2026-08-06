export interface EpgPlaylistChannel {
  id: string;
  tvgId: string | null;
  displayName: string;
  providerGroup: string;
  logoUrl?: string | null;
}

export interface EpgGuideChannel {
  id: string;
  displayName: string;
  epgSourceId: string;
  epgSourceName: string;
  ownGuide: boolean;
}

export interface LockedEpgMapping {
  channelId: string;
  epgChannelId: string;
  epgSourceId: string;
}

export interface EpgMappingMatch {
  channelId: string;
  epgChannel: EpgGuideChannel;
  confidence: number;
  manuallyLocked: boolean;
}

export interface UnresolvedEpgMapping {
  channelId: string;
  status: 'missing' | 'ambiguous';
  candidates: EpgGuideChannel[];
  candidateIds: string[];
  lockedEpgChannelId?: string;
  lockedEpgSourceId?: string;
}

export interface EpgReconciliation {
  matches: EpgMappingMatch[];
  unresolved: UnresolvedEpgMapping[];
}

const GUIDE_KEY_SEPARATOR = ' ';

function normalized(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+(?:hd|fhd|uhd|4k)$/u, '')
    .trim();
}

function addToIndex(
  index: Map<string, EpgGuideChannel[]>,
  key: string,
  channel: EpgGuideChannel,
): void {
  if (!key) return;
  const existing = index.get(key);
  if (existing) existing.push(channel);
  else index.set(key, [channel]);
}

function unresolvedFrom(
  channelId: string,
  candidates: EpgGuideChannel[],
): UnresolvedEpgMapping {
  return {
    channelId,
    status: candidates.length > 1 ? 'ambiguous' : 'missing',
    candidates,
    candidateIds: candidates.map((candidate) => candidate.id),
  };
}

/**
 * Matches playlist channels against the shared guide pool. Manual locks
 * resolve inside their recorded guide; automatic matching stays inside the
 * provider's own guide so a shared pool cannot turn today's unique matches
 * ambiguous. Cross-guide coverage is reached through manual mapping.
 */
export function reconcileEpgMappings(
  channels: readonly EpgPlaylistChannel[],
  guideChannels: readonly EpgGuideChannel[],
  lockedMappings: readonly LockedEpgMapping[] = [],
): EpgReconciliation {
  const exactIndex = new Map<string, EpgGuideChannel[]>();
  const ownIdIndex = new Map<string, EpgGuideChannel[]>();
  const ownNameIndex = new Map<string, EpgGuideChannel[]>();
  for (const guideChannel of guideChannels) {
    addToIndex(
      exactIndex,
      guideChannel.epgSourceId +
        GUIDE_KEY_SEPARATOR +
        normalized(guideChannel.id),
      guideChannel,
    );
    if (guideChannel.ownGuide) {
      addToIndex(ownIdIndex, normalized(guideChannel.id), guideChannel);
      addToIndex(
        ownNameIndex,
        normalized(guideChannel.displayName),
        guideChannel,
      );
    }
  }
  const lockedByChannel = new Map(
    lockedMappings.map((mapping) => [mapping.channelId, mapping]),
  );
  const matches: EpgMappingMatch[] = [];
  const unresolved: UnresolvedEpgMapping[] = [];

  for (const channel of channels) {
    const locked = lockedByChannel.get(channel.id);
    if (locked) {
      const candidates =
        exactIndex.get(
          locked.epgSourceId +
            GUIDE_KEY_SEPARATOR +
            normalized(locked.epgChannelId),
        ) ?? [];
      const selected = candidates[0];
      if (selected && candidates.length === 1) {
        matches.push({
          channelId: channel.id,
          epgChannel: selected,
          confidence: 1,
          manuallyLocked: true,
        });
      } else {
        unresolved.push({
          ...unresolvedFrom(channel.id, candidates),
          lockedEpgChannelId: locked.epgChannelId,
          lockedEpgSourceId: locked.epgSourceId,
        });
      }
      continue;
    }

    const idCandidates = channel.tvgId
      ? (ownIdIndex.get(normalized(channel.tvgId)) ?? [])
      : [];
    if (idCandidates.length === 1 && idCandidates[0]) {
      matches.push({
        channelId: channel.id,
        epgChannel: idCandidates[0],
        confidence: 1,
        manuallyLocked: false,
      });
      continue;
    }
    if (idCandidates.length > 1) {
      unresolved.push(unresolvedFrom(channel.id, idCandidates));
      continue;
    }

    const nameCandidates =
      ownNameIndex.get(normalized(channel.displayName)) ?? [];
    if (nameCandidates.length === 1 && nameCandidates[0]) {
      matches.push({
        channelId: channel.id,
        epgChannel: nameCandidates[0],
        confidence: 0.85,
        manuallyLocked: false,
      });
      continue;
    }
    unresolved.push(unresolvedFrom(channel.id, nameCandidates));
  }

  return { matches, unresolved };
}
