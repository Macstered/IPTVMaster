import { describe, expect, it } from 'vitest';

import { applyOutputGroupPolicies } from './output.js';
import type { M3uEntry, MediaType, OutputGroupPolicy } from './types.js';

function entry(
  name: string,
  group: string,
  mediaType: MediaType = 'live',
): M3uEntry {
  return {
    duration: -1,
    attributes: { 'tvg-name': name, 'group-title': group },
    name,
    url: 'http://provider.test/synthetic/1',
    mediaType,
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

  it('does not apply live group policies to a catalogue category collision', () => {
    const movie = entry(
      '-= Reload your playlist =-',
      'MTV Urheilu Events FI',
      'vod',
    );
    const result = applyOutputGroupPolicies([movie], policies);

    expect(result.entries).toEqual([movie]);
    expect(result.hiddenEntries).toBe(0);
    expect(result.localizedEvents).toBe(0);
  });

  it('sorts each event group by its localized start while preserving other slots', () => {
    const result = applyOutputGroupPolicies(
      [
        entry('20:00 Late match 8/4', 'MTV Urheilu Events FI'),
        entry('Yle TV1', 'Finland'),
        entry('17:00 Early match 8/4', 'MTV Urheilu Events FI'),
        entry('Schedule pending', 'MTV Urheilu Events FI'),
      ],
      policies,
    );

    expect(result.entries.map((value) => value.name)).toEqual([
      '18:00 Early match 8/4',
      'Yle TV1',
      '21:00 Late match 8/4',
      'Schedule pending',
    ]);
  });

  it('interleaves event groups that share one output group by start time', () => {
    const secondGroup: OutputGroupPolicy = {
      ...(policies[0] as OutputGroupPolicy),
      groupName: 'Elite Sports Events FI',
    };

    const result = applyOutputGroupPolicies(
      [
        entry('20:00 Late match 8/4', 'MTV Urheilu Events FI'),
        entry('16:00 Afternoon match 8/4', 'MTV Urheilu Events FI'),
        entry('18:00 Evening match 8/4', 'Elite Sports Events FI'),
        entry('14:00 Lunch match 8/4', 'Elite Sports Events FI'),
      ],
      [...policies, secondGroup],
    );

    // Both groups publish as "Today's Finnish Sports", so the result is one
    // schedule rather than one group's block followed by the other's.
    expect(result.entries.map((value) => value.name)).toEqual([
      '15:00 Lunch match 8/4',
      '17:00 Afternoon match 8/4',
      '19:00 Evening match 8/4',
      '21:00 Late match 8/4',
    ]);
    expect(
      new Set(result.entries.map((value) => value.attributes['group-title'])),
    ).toEqual(new Set(["Today's Finnish Sports"]));
  });

  it('keeps event groups separate when they publish under different names', () => {
    const secondGroup: OutputGroupPolicy = {
      ...(policies[0] as OutputGroupPolicy),
      groupName: 'Elite Sports Events FI',
      outputGroupName: 'Elite Sports',
    };

    const result = applyOutputGroupPolicies(
      [
        entry('20:00 Late match 8/4', 'MTV Urheilu Events FI'),
        entry('16:00 Afternoon match 8/4', 'MTV Urheilu Events FI'),
        entry('18:00 Evening match 8/4', 'Elite Sports Events FI'),
        entry('14:00 Lunch match 8/4', 'Elite Sports Events FI'),
      ],
      [...policies, secondGroup],
    );

    expect(result.entries.map((value) => value.name)).toEqual([
      '17:00 Afternoon match 8/4',
      '21:00 Late match 8/4',
      '15:00 Lunch match 8/4',
      '19:00 Evening match 8/4',
    ]);
  });
});
