import { describe, expect, it } from 'vitest';

import { applyOutputGroupPolicies } from './output.js';
import type { M3uEntry, OutputGroupPolicy } from './types.js';

function entry(name: string, group: string): M3uEntry {
  return {
    duration: -1,
    attributes: { 'tvg-name': name, 'group-title': group },
    name,
    url: 'http://provider.test/synthetic/1',
    mediaType: 'live',
    lineNumber: 2,
  };
}

describe('output group policies', () => {
  const policies: OutputGroupPolicy[] = [
    {
      behavior: 'event',
      groupName: 'MTV Urheilu Events FI',
      outputGroupName: "Today's Finnish Sports",
      enabled: true,
      hidePlaceholders: true,
      timePolicy: {
        sourceTimeZone: 'Europe/Stockholm',
        displayTimeZone: 'Europe/Helsinki',
        numericDateOrder: 'month-day',
        referenceDate: '2026-08-04',
      },
    },
  ];

  it('localizes configured event groups while preserving ordinary live TV', () => {
    const result = applyOutputGroupPolicies(
      [
        entry('Yle TV1', 'Finland'),
        entry('17:00 Tennis 8/4', 'MTV Urheilu Events FI'),
      ],
      policies,
    );

    expect(result.entries[0]?.name).toBe('Yle TV1');
    expect(result.entries[1]?.name).toBe('18:00 Tennis 8/4');
    expect(result.entries[1]?.attributes['group-title']).toBe(
      "Today's Finnish Sports",
    );
    expect(result.localizedEvents).toBe(1);
  });

  it('hides event placeholders but not unrelated channels', () => {
    const result = applyOutputGroupPolicies(
      [
        entry('Yle TV1', 'Finland'),
        entry('-= Reload your playlist =-', 'MTV Urheilu Events FI'),
      ],
      policies,
    );

    expect(result.entries.map((value) => value.name)).toEqual(['Yle TV1']);
    expect(result.hiddenEntries).toBe(1);
  });
});
