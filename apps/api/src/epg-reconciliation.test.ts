import { describe, expect, it } from 'vitest';

import {
  reconcileEpgMappings,
  type EpgGuideChannel,
} from './epg-reconciliation.js';

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

function ownGuideChannel(id: string, displayName: string): EpgGuideChannel {
  return {
    id,
    displayName,
    epgSourceId: 'guide-own',
    epgSourceName: 'Provider guide',
    ownGuide: true,
  };
}

function customGuideChannel(id: string, displayName: string): EpgGuideChannel {
  return {
    id,
    displayName,
    epgSourceId: 'guide-custom',
    epgSourceName: 'Custom guide',
    ownGuide: false,
  };
}

describe('EPG reconciliation', () => {
  it('prefers an exact guide ID and falls back to a normalized display name', () => {
    const result = reconcileEpgMappings(channels, [
      ownGuideChannel('yle1.fi', 'Yle One'),
      ownGuideChannel('mtv3.fi', 'MTV3'),
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
        ownGuideChannel('sports-one', 'Sports'),
        ownGuideChannel('sports-two', 'Sports FHD'),
      ],
    );

    expect(result.matches).toHaveLength(0);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        channelId: 'channel-1',
        status: 'ambiguous',
        candidateIds: ['sports-one', 'sports-two'],
      }),
    ]);
  });

  it('does not auto-match against other guides in the pool', () => {
    const result = reconcileEpgMappings(
      [
        {
          id: 'channel-1',
          tvgId: 'bbc1.uk',
          displayName: 'BBC One',
          providerGroup: 'UK',
        },
      ],
      [customGuideChannel('bbc1.uk', 'BBC One')],
    );

    expect(result.matches).toHaveLength(0);
    expect(result.unresolved).toEqual([
      expect.objectContaining({ channelId: 'channel-1', status: 'missing' }),
    ]);
  });

  it('resolves manual locks inside their recorded guide', () => {
    const result = reconcileEpgMappings(
      channels,
      [
        ownGuideChannel('yle1.fi', 'Yle One'),
        customGuideChannel('yle1.fi', 'Yle TV1 International'),
      ],
      [
        {
          channelId: 'channel-1',
          epgChannelId: 'yle1.fi',
          epgSourceId: 'guide-custom',
        },
      ],
    );

    const locked = result.matches.find(
      (match) => match.channelId === 'channel-1',
    );
    expect(locked).toEqual(
      expect.objectContaining({
        manuallyLocked: true,
        epgChannel: expect.objectContaining({ epgSourceId: 'guide-custom' }),
      }),
    );
  });

  it('preserves a manual guide ID even while that guide channel is absent', () => {
    const result = reconcileEpgMappings(
      channels,
      [],
      [
        {
          channelId: 'channel-1',
          epgChannelId: 'yle1.manual',
          epgSourceId: 'guide-own',
        },
      ],
    );

    expect(result.unresolved).toContainEqual({
      channelId: 'channel-1',
      status: 'missing',
      candidates: [],
      candidateIds: [],
      lockedEpgChannelId: 'yle1.manual',
      lockedEpgSourceId: 'guide-own',
    });
  });
});
