import { describe, expect, it } from 'vitest';
import { mediaCategoryKey } from '@iptvmaster/core';
import { inspectRemoteXtreamPlaylist } from './xtream-import.js';

describe('Xtream retained fingerprint', () => {
  it('ignores unselected and non-retained metadata while detecting selected changes', async () => {
    const inspect = (name: string, selected: boolean, rating: string) =>
      inspectRemoteXtreamPlaylist(
        'https://fixture.test/get.php?username=demo&password=demo',
        {
          includeLive: false,
          selectiveGroups: new Set(
            selected ? [mediaCategoryKey('series', 'Series')] : [],
          ),
          fetchImplementation: async (input) => {
            const action = new URL(String(input)).searchParams.get('action');
            return new Response(
              JSON.stringify(
                action === 'get_series_categories'
                  ? [{ category_id: '5', category_name: 'Series' }]
                  : action === 'get_series'
                    ? [{ series_id: '25', category_id: '5', name, rating }]
                    : [],
              ),
            );
          },
        },
      );
    expect((await inspect('A', false, '1')).fingerprint).toBe(
      (await inspect('B', false, '9')).fingerprint,
    );
    expect((await inspect('A', true, '1')).fingerprint).toBe(
      (await inspect('A', true, '9')).fingerprint,
    );
    expect((await inspect('A', true, '1')).fingerprint).not.toBe(
      (await inspect('B', true, '1')).fingerprint,
    );
    expect((await inspect('A', true, '1')).fingerprint).not.toBe(
      (await inspect('A', false, '1')).fingerprint,
    );
  });
});
