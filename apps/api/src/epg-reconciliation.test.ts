import { describe, expect, it } from 'vitest';

import { reconcileEpgMappings } from './epg-reconciliation.js';

const channels = [
  {
    id: 'channel-1',
    tvgId: 'yle1.fi',
    displayName: 'Yle TV1 HD',
    providerGroup: 'Finland',
  },
  {
    id: 'channel-2',
    tvgId: null,
    displayName: 'MTV3 FHD',
    providerGroup: 'Finland',
  },
];

describe('EPG reconciliation', () => {
  it('prefers an exact guide ID and falls back to a normalized display name', () => {
    const result = reconcileEpgMappings(channels, [
      { id: 'yle1.fi', displayName: 'Yle One' },
      { id: 'mtv3.fi', displayName: 'MTV3' },
    ]);

    expect(result.matches).toEqual([
      expect.objectContaining({
        channelId: 'channel-1',
        confidence: 1,
        manuallyLocked: false,
      }),
      expect.objectContaining({
        channelId: 'channel-2',
        confidence: 0.85,
        manuallyLocked: false,
      }),
    ]);
    expect(result.unresolved).toHaveLength(0);
  });

  it('does not guess between duplicate normalized guide names', () => {
    const result = reconcileEpgMappings(
      [
        {
          id: 'channel-1',
          tvgId: null,
          displayName: 'Sports HD',
          providerGroup: 'Sports',
        },
      ],
      [
        { id: 'sports-one', displayName: 'Sports' },
        { id: 'sports-two', displayName: 'Sports FHD' },
      ],
    );

    expect(result.matches).toHaveLength(0);
    expect(result.unresolved).toEqual([
      {
        channelId: 'channel-1',
        status: 'ambiguous',
        candidateIds: ['sports-one', 'sports-two'],
      },
    ]);
  });

  it('preserves a manual guide ID even while that guide channel is absent', () => {
    const result = reconcileEpgMappings(
      channels,
      [],
      [{ channelId: 'channel-1', epgChannelId: 'yle1.manual' }],
    );

    expect(result.unresolved).toContainEqual({
      channelId: 'channel-1',
      status: 'missing',
      candidateIds: [],
      lockedEpgChannelId: 'yle1.manual',
    });
  });
});
