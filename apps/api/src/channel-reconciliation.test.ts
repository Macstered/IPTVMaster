import { describe, expect, it } from 'vitest';

import {
  reconcileChannels,
  type ReconciliationChannel,
  type ReconciliationItem,
} from './channel-reconciliation.js';

const previous: ReconciliationChannel = {
  id: 'channel-1',
  providerStreamId: '42',
  tvgId: 'yle1.fi',
  providerName: 'Yle TV1',
  providerGroup: 'Finland',
  matchLocked: false,
};

function item(overrides: Partial<ReconciliationItem> = {}): ReconciliationItem {
  return {
    id: 'item-1',
    providerStreamId: '42',
    tvgId: 'yle1.fi',
    providerName: 'Yle TV1 HD',
    providerGroup: 'Finland',
    providerLogoUrl: null,
    sortOrder: 2,
    ...overrides,
  };
}

describe('permanent channel reconciliation', () => {
  it('prefers a stable provider stream identifier across renamed snapshots', () => {
    const result = reconcileChannels([previous], [item()]);

    expect(result.matches).toEqual([
      expect.objectContaining({ channelId: 'channel-1', confidence: 1 }),
    ]);
    expect(result.newItems).toHaveLength(0);
    expect(result.missingChannelIds).toHaveLength(0);
  });

  it('falls back to tvg-id and then normalized provider name and group', () => {
    const tvgResult = reconcileChannels(
      [previous],
      [item({ providerStreamId: '99' })],
    );
    const nameResult = reconcileChannels(
      [{ ...previous, providerStreamId: null, tvgId: null }],
      [
        item({
          providerStreamId: null,
          tvgId: null,
          providerName: '  YLE  TV1 ',
        }),
      ],
    );

    expect(tvgResult.matches[0]?.confidence).toBe(0.98);
    expect(nameResult.matches[0]?.confidence).toBe(0.85);
  });

  it('does not guess when an identity maps to multiple current entries', () => {
    const result = reconcileChannels(
      [previous],
      [item(), item({ id: 'item-2' })],
    );

    expect(result.matches).toHaveLength(0);
    expect(result.ambiguousChannelIds).toEqual(['channel-1']);
    expect(result.ambiguousItemIds).toEqual(['item-1', 'item-2']);
    expect(result.newItems).toHaveLength(0);
  });

  it('does not use fuzzy name matching for a locked channel', () => {
    const result = reconcileChannels(
      [{ ...previous, providerStreamId: null, tvgId: null, matchLocked: true }],
      [item({ providerStreamId: null, tvgId: null })],
    );

    expect(result.matches).toHaveLength(0);
    expect(result.missingChannelIds).toEqual(['channel-1']);
  });
});
