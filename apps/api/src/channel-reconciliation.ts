export interface ReconciliationChannel {
  id: string;
  providerStreamId: string | null;
  tvgId: string | null;
  providerName: string;
  providerGroup: string;
  matchLocked: boolean;
}

export interface ReconciliationItem {
  id: string;
  providerStreamId: string | null;
  tvgId: string | null;
  providerName: string;
  providerGroup: string;
  providerLogoUrl: string | null;
  sortOrder: number;
}

export interface ReconciliationMatch {
  channelId: string;
  item: ReconciliationItem;
  confidence: number;
}

export interface ChannelReconciliation {
  matches: ReconciliationMatch[];
  ambiguousChannelIds: string[];
  ambiguousItemIds: string[];
  missingChannelIds: string[];
  newItems: ReconciliationItem[];
}

interface Candidate {
  channelId: string;
  item: ReconciliationItem;
  confidence: number;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function addToIndex(
  index: Map<string, ReconciliationItem[]>,
  key: string | null,
  item: ReconciliationItem,
): void {
  if (!key) return;
  const values = index.get(key);
  if (values) values.push(item);
  else index.set(key, [item]);
}

function identityKey(value: string | null): string | null {
  if (!value) return null;
  const result = normalized(value);
  return result.length > 0 ? result : null;
}

function nameGroupKey(name: string, group: string): string | null {
  const normalizedName = normalized(name);
  if (!normalizedName) return null;
  return `${normalized(group)}\u0000${normalizedName}`;
}

function uniqueCandidatesForChannel(
  channel: ReconciliationChannel,
  streamIndex: Map<string, ReconciliationItem[]>,
  tvgIndex: Map<string, ReconciliationItem[]>,
  nameGroupIndex: Map<string, ReconciliationItem[]>,
): Candidate[] {
  const candidates = new Map<string, Candidate>();
  const collect = (
    items: ReconciliationItem[] | undefined,
    confidence: number,
  ) => {
    for (const item of items ?? []) {
      const previous = candidates.get(item.id);
      if (!previous || previous.confidence < confidence) {
        candidates.set(item.id, { channelId: channel.id, item, confidence });
      }
    }
  };

  collect(streamIndex.get(identityKey(channel.providerStreamId) ?? ''), 1);
  collect(tvgIndex.get(identityKey(channel.tvgId) ?? ''), 0.98);
  if (!channel.matchLocked) {
    collect(
      nameGroupIndex.get(
        nameGroupKey(channel.providerName, channel.providerGroup) ?? '',
      ),
      0.85,
    );
  }
  return [...candidates.values()].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.item.id.localeCompare(right.item.id),
  );
}

export function reconcileChannels(
  channels: readonly ReconciliationChannel[],
  items: readonly ReconciliationItem[],
): ChannelReconciliation {
  const streamIndex = new Map<string, ReconciliationItem[]>();
  const tvgIndex = new Map<string, ReconciliationItem[]>();
  const nameGroupIndex = new Map<string, ReconciliationItem[]>();
  for (const item of items) {
    addToIndex(streamIndex, identityKey(item.providerStreamId), item);
    addToIndex(tvgIndex, identityKey(item.tvgId), item);
    addToIndex(
      nameGroupIndex,
      nameGroupKey(item.providerName, item.providerGroup),
      item,
    );
  }

  const proposals = new Map<string, Candidate>();
  const ambiguous = new Set<string>();
  const ambiguousItems = new Set<string>();
  for (const channel of channels) {
    const candidates = uniqueCandidatesForChannel(
      channel,
      streamIndex,
      tvgIndex,
      nameGroupIndex,
    );
    const best = candidates[0];
    if (!best) continue;
    if (candidates[1]?.confidence === best.confidence) {
      ambiguous.add(channel.id);
      for (const candidate of candidates) {
        if (candidate.confidence === best.confidence) {
          ambiguousItems.add(candidate.item.id);
        }
      }
      continue;
    }
    proposals.set(channel.id, best);
  }

  const proposalsByItem = new Map<string, Candidate[]>();
  for (const proposal of proposals.values()) {
    const current = proposalsByItem.get(proposal.item.id);
    if (current) current.push(proposal);
    else proposalsByItem.set(proposal.item.id, [proposal]);
  }

  const matches: ReconciliationMatch[] = [];
  const matchedItems = new Set<string>();
  for (const proposalsForItem of proposalsByItem.values()) {
    if (proposalsForItem.length !== 1) {
      const contestedItem = proposalsForItem[0]?.item;
      if (contestedItem) ambiguousItems.add(contestedItem.id);
      for (const proposal of proposalsForItem)
        ambiguous.add(proposal.channelId);
      continue;
    }
    const proposal = proposalsForItem[0];
    if (!proposal) continue;
    matches.push(proposal);
    matchedItems.add(proposal.item.id);
  }

  const matchedChannels = new Set(matches.map((match) => match.channelId));
  return {
    matches,
    ambiguousChannelIds: [...ambiguous],
    ambiguousItemIds: [...ambiguousItems],
    missingChannelIds: channels
      .map((channel) => channel.id)
      .filter(
        (channelId) =>
          !matchedChannels.has(channelId) && !ambiguous.has(channelId),
      ),
    newItems: items.filter(
      (item) => !matchedItems.has(item.id) && !ambiguousItems.has(item.id),
    ),
  };
}
