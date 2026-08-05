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
}

export interface LockedEpgMapping {
  channelId: string;
  epgChannelId: string;
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
  candidateIds: string[];
  lockedEpgChannelId?: string;
}

export interface EpgReconciliation {
  matches: EpgMappingMatch[];
  unresolved: UnresolvedEpgMapping[];
}

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
  value: string,
  channel: EpgGuideChannel,
): void {
  const key = normalized(value);
  if (!key) return;
  const existing = index.get(key);
  if (existing) existing.push(channel);
  else index.set(key, [channel]);
}

export function reconcileEpgMappings(
  channels: readonly EpgPlaylistChannel[],
  guideChannels: readonly EpgGuideChannel[],
  lockedMappings: readonly LockedEpgMapping[] = [],
): EpgReconciliation {
  const idIndex = new Map<string, EpgGuideChannel[]>();
  const nameIndex = new Map<string, EpgGuideChannel[]>();
  for (const guideChannel of guideChannels) {
    addToIndex(idIndex, guideChannel.id, guideChannel);
    addToIndex(nameIndex, guideChannel.displayName, guideChannel);
  }
  const lockedByChannel = new Map(
    lockedMappings.map((mapping) => [mapping.channelId, mapping]),
  );
  const matches: EpgMappingMatch[] = [];
  const unresolved: UnresolvedEpgMapping[] = [];

  for (const channel of channels) {
    const locked = lockedByChannel.get(channel.id);
    if (locked) {
      const candidates = idIndex.get(normalized(locked.epgChannelId)) ?? [];
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
          channelId: channel.id,
          status: candidates.length > 1 ? 'ambiguous' : 'missing',
          candidateIds: candidates.map((candidate) => candidate.id),
          lockedEpgChannelId: locked.epgChannelId,
        });
      }
      continue;
    }

    const idCandidates = channel.tvgId
      ? (idIndex.get(normalized(channel.tvgId)) ?? [])
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
      unresolved.push({
        channelId: channel.id,
        status: 'ambiguous',
        candidateIds: idCandidates.map((candidate) => candidate.id),
      });
      continue;
    }

    const nameCandidates = nameIndex.get(normalized(channel.displayName)) ?? [];
    if (nameCandidates.length === 1 && nameCandidates[0]) {
      matches.push({
        channelId: channel.id,
        epgChannel: nameCandidates[0],
        confidence: 0.85,
        manuallyLocked: false,
      });
      continue;
    }
    unresolved.push({
      channelId: channel.id,
      status: nameCandidates.length > 1 ? 'ambiguous' : 'missing',
      candidateIds: nameCandidates.map((candidate) => candidate.id),
    });
  }

  return { matches, unresolved };
}
