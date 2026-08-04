import { describe, expect, it } from 'vitest';

import { parseXmltv, parseXmltvTimestamp, serializeXmltv } from './xmltv.js';

async function* chunks(value: string): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  yield bytes.slice(0, 47);
  yield bytes.slice(47);
}

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="yle1"><display-name>Yle TV1</display-name><icon src="http://images.test/yle.png"/></channel>
  <channel id="yle1"><display-name>Duplicate</display-name></channel>
  <programme start="20260804170000 +0200" stop="20260804180000 +0200" channel="yle1">
    <title>Tennis &amp; news</title><desc>First round</desc><category>Sports</category>
  </programme>
  <programme start="invalid" channel="yle1"><title>Broken</title></programme>
</tv>`;

describe('XMLTV', () => {
  it('parses channels, programmes, entities, offsets, and duplicate IDs', async () => {
    const result = await parseXmltv(chunks(fixture));
    expect(result.channels).toEqual([
      {
        id: 'yle1',
        displayName: 'Yle TV1',
        iconUrl: 'http://images.test/yle.png',
      },
    ]);
    expect(result.programmes).toEqual([
      expect.objectContaining({
        channelId: 'yle1',
        title: 'Tennis & news',
        start: '2026-08-04T15:00:00.000Z',
        stop: '2026-08-04T16:00:00.000Z',
      }),
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'duplicate-channel',
      'invalid-timestamp',
    ]);
  });

  it('assumes UTC but reports a missing timestamp timezone', () => {
    expect(parseXmltvTimestamp('20260804170000')).toEqual({
      iso: '2026-08-04T17:00:00.000Z',
      missingTimezone: true,
    });
  });

  it('bounds retained parse issues for malformed large guides', async () => {
    const result = await parseXmltv(chunks(fixture), { maxIssues: 1 });
    expect(result.issues).toHaveLength(1);
    expect(result.issuesTruncated).toBe(true);
  });

  it('serializes safe, UTC-normalized XMLTV that reparses', async () => {
    const parsed = await parseXmltv(chunks(fixture));
    const output = serializeXmltv(parsed.channels, parsed.programmes);
    expect(output).toContain('Tennis &amp; news');
    expect(output).toContain('start="20260804150000 +0000"');
    const reparsed = await parseXmltv(chunks(output));
    expect(reparsed.channels).toHaveLength(1);
    expect(reparsed.programmes).toHaveLength(1);
  });
});
