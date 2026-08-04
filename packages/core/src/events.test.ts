import { describe, expect, it } from 'vitest';

import { applyEventGroupPolicy, localizeEventName } from './events.js';
import type { EventGroupPolicy, M3uEntry } from './types.js';

const finnishPolicy = {
  sourceTimeZone: 'Europe/Stockholm',
  displayTimeZone: 'Europe/Helsinki',
  numericDateOrder: 'month-day' as const,
  referenceDate: '2026-08-04',
};

describe('event time localization', () => {
  it('converts a Swedish event time to Finnish time', () => {
    const result = localizeEventName(
      '17:00 Montreal ATP Tennis 8/4',
      finnishPolicy,
    );

    expect(result.status).toBe('localized');
    expect(result.localizedName).toBe('18:00 Montreal ATP Tennis 8/4');
    expect(result.changed).toBe(true);
  });

  it('preserves a dot time separator', () => {
    const result = localizeEventName(
      '17.00 Finnish baseball 8/4',
      finnishPolicy,
    );
    expect(result.localizedName).toBe('18.00 Finnish baseball 8/4');
  });

  it('updates the date when Finnish time crosses midnight', () => {
    const result = localizeEventName('23:30 Late event 8/4', finnishPolicy);

    expect(result.localizedName).toBe('0:30 Late event 8/5');
    expect(result.crossedDateBoundary).toBe(true);
  });

  it('uses timezone data on a winter date rather than a fixed numeric offset', () => {
    const result = localizeEventName('17:00 Winter event 1/15', {
      ...finnishPolicy,
      referenceDate: '2026-01-15',
    });

    expect(result.localizedName).toBe('18:00 Winter event 1/15');
  });

  it('handles a full English date and time within an event label', () => {
    const result = localizeEventName(
      'NEXT | ATP TENNIS | Tue 04 Aug 16:30 | PLAY+ PPV 2',
      finnishPolicy,
    );

    expect(result.localizedName).toContain('Tue 04 Aug 17:30');
  });

  it('leaves non-event text unchanged when no time can be parsed', () => {
    const result = localizeEventName('No event streaming', finnishPolicy);
    expect(result.status).toBe('no-time');
    expect(result.localizedName).toBe('No event streaming');
  });
});

describe('event group policy', () => {
  const entry: M3uEntry = {
    duration: -1,
    attributes: {
      'tvg-name': '17:00 Montreal ATP Tennis 8/4',
      'group-title': 'MTV Urheilu Events FI',
    },
    name: '17:00 Montreal ATP Tennis 8/4',
    url: 'http://provider.test/user/pass/123',
    mediaType: 'live',
    lineNumber: 2,
  };

  const policy: EventGroupPolicy = {
    groupName: 'MTV Urheilu Events FI',
    outputGroupName: "Today's Finnish Sports",
    enabled: true,
    hidePlaceholders: true,
    timePolicy: finnishPolicy,
  };

  it('localizes the event and applies a stable output group rule', () => {
    const result = applyEventGroupPolicy(entry, policy);

    expect(result.hidden).toBe(false);
    expect(result.entry.name).toMatch(/^18:00/);
    expect(result.entry.attributes['tvg-name']).toMatch(/^18:00/);
    expect(result.entry.attributes['group-title']).toBe(
      "Today's Finnish Sports",
    );
  });

  it('hides known provider placeholders', () => {
    const result = applyEventGroupPolicy(
      { ...entry, name: '-= Reload your playlist =-' },
      policy,
    );

    expect(result.hidden).toBe(true);
    expect(result.hideReason).toContain('reload your playlist');
  });
});
