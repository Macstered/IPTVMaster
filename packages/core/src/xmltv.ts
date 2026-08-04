import { DateTime, FixedOffsetZone } from 'luxon';
import { SaxesParser, type SaxesTagPlain } from 'saxes';

export interface XmltvChannel {
  id: string;
  displayName: string;
  iconUrl?: string;
}

export interface XmltvProgramme {
  channelId: string;
  start: string;
  stop?: string;
  title: string;
  description?: string;
  category?: string;
}

export interface XmltvIssue {
  code:
    | 'duplicate-channel'
    | 'invalid-channel'
    | 'invalid-programme'
    | 'invalid-timestamp'
    | 'missing-timezone'
    | 'unknown-channel';
  message: string;
}

export interface XmltvParseResult {
  channels: XmltvChannel[];
  programmes: XmltvProgramme[];
  issues: XmltvIssue[];
  issuesTruncated: boolean;
}

export interface XmltvParseOptions {
  maxChannels?: number;
  maxProgrammes?: number;
  maxIssues?: number;
}

interface PendingChannel {
  id: string;
  displayNames: string[];
  iconUrl?: string;
}

interface PendingProgramme {
  channelId: string;
  startRaw: string;
  stopRaw?: string;
  title?: string;
  description?: string;
  category?: string;
}

const XMLTV_TIMESTAMP =
  /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})?(?:\s*(?<offset>Z|[+-]\d{4}))?/;

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function parseXmltvTimestamp(raw: string): {
  iso?: string;
  missingTimezone: boolean;
} {
  const match = XMLTV_TIMESTAMP.exec(raw.trim());
  if (!match?.groups) return { missingTimezone: false };
  const offset = match.groups['offset'];
  let offsetMinutes = 0;
  if (offset && offset !== 'Z') {
    const sign = offset.startsWith('-') ? -1 : 1;
    offsetMinutes =
      sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)));
  }
  const value = DateTime.fromObject(
    {
      year: Number(match.groups['year']),
      month: Number(match.groups['month']),
      day: Number(match.groups['day']),
      hour: Number(match.groups['hour']),
      minute: Number(match.groups['minute']),
      second: Number(match.groups['second'] ?? 0),
    },
    { zone: FixedOffsetZone.instance(offsetMinutes) },
  );
  return {
    ...(value.isValid ? { iso: value.toUTC().toISO() ?? undefined } : {}),
    missingTimezone: offset === undefined,
  };
}

export async function parseXmltv(
  input: AsyncIterable<string | Uint8Array>,
  options: XmltvParseOptions = {},
): Promise<XmltvParseResult> {
  const maxChannels = options.maxChannels ?? 100_000;
  const maxProgrammes = options.maxProgrammes ?? 750_000;
  const maxIssues = options.maxIssues ?? 10_000;
  const channels: XmltvChannel[] = [];
  const programmes: XmltvProgramme[] = [];
  const issues: XmltvIssue[] = [];
  let issuesTruncated = false;
  const reportIssue = (issue: XmltvIssue) => {
    if (issues.length < maxIssues) issues.push(issue);
    else issuesTruncated = true;
  };
  const channelIds = new Set<string>();
  let pendingChannel: PendingChannel | undefined;
  let pendingProgramme: PendingProgramme | undefined;
  let capture: 'display-name' | 'title' | 'desc' | 'category' | undefined;
  let capturedText = '';

  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    if (tag.name === 'channel') {
      pendingChannel = {
        id: normalizedText(tag.attributes['id'] ?? ''),
        displayNames: [],
      };
    } else if (tag.name === 'programme') {
      pendingProgramme = {
        channelId: normalizedText(tag.attributes['channel'] ?? ''),
        startRaw: normalizedText(tag.attributes['start'] ?? ''),
        ...(tag.attributes['stop']
          ? { stopRaw: normalizedText(tag.attributes['stop']) }
          : {}),
      };
    } else if (tag.name === 'icon' && pendingChannel) {
      const source = normalizedText(tag.attributes['src'] ?? '');
      if (source) pendingChannel.iconUrl = source;
    } else if (
      ['display-name', 'title', 'desc', 'category'].includes(tag.name)
    ) {
      capture = tag.name as typeof capture;
      capturedText = '';
    }
  });
  const appendText = (value: string) => {
    if (capture) capturedText += value;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', (tag: SaxesTagPlain) => {
    if (capture && tag.name === capture) {
      const value = normalizedText(capturedText);
      if (value) {
        if (capture === 'display-name' && pendingChannel) {
          pendingChannel.displayNames.push(value);
        } else if (pendingProgramme) {
          if (capture === 'title' && pendingProgramme.title === undefined)
            pendingProgramme.title = value;
          if (capture === 'desc' && pendingProgramme.description === undefined)
            pendingProgramme.description = value;
          if (capture === 'category' && pendingProgramme.category === undefined)
            pendingProgramme.category = value;
        }
      }
      capture = undefined;
      capturedText = '';
    }

    if (tag.name === 'channel' && pendingChannel) {
      if (!pendingChannel.id || pendingChannel.displayNames.length === 0) {
        reportIssue({
          code: 'invalid-channel',
          message: 'Skipped an XMLTV channel without an ID or display name',
        });
      } else if (channelIds.has(pendingChannel.id)) {
        reportIssue({
          code: 'duplicate-channel',
          message: `Skipped duplicate XMLTV channel ID ${pendingChannel.id}`,
        });
      } else {
        channelIds.add(pendingChannel.id);
        channels.push({
          id: pendingChannel.id,
          displayName: pendingChannel.displayNames[0] ?? pendingChannel.id,
          ...(pendingChannel.iconUrl
            ? { iconUrl: pendingChannel.iconUrl }
            : {}),
        });
        if (channels.length > maxChannels)
          throw new Error(`XMLTV exceeds the ${maxChannels}-channel limit`);
      }
      pendingChannel = undefined;
    }

    if (tag.name === 'programme' && pendingProgramme) {
      const start = parseXmltvTimestamp(pendingProgramme.startRaw);
      const stop = pendingProgramme.stopRaw
        ? parseXmltvTimestamp(pendingProgramme.stopRaw)
        : undefined;
      if (
        !pendingProgramme.channelId ||
        !pendingProgramme.title ||
        !start.iso
      ) {
        reportIssue({
          code: !start.iso ? 'invalid-timestamp' : 'invalid-programme',
          message: 'Skipped an XMLTV programme with invalid required fields',
        });
      } else {
        if (start.missingTimezone || stop?.missingTimezone) {
          reportIssue({
            code: 'missing-timezone',
            message: `Programme ${pendingProgramme.title} has no timezone; UTC was assumed`,
          });
        }
        programmes.push({
          channelId: pendingProgramme.channelId,
          start: start.iso,
          ...(stop?.iso ? { stop: stop.iso } : {}),
          title: pendingProgramme.title,
          ...(pendingProgramme.description
            ? { description: pendingProgramme.description }
            : {}),
          ...(pendingProgramme.category
            ? { category: pendingProgramme.category }
            : {}),
        });
        if (programmes.length > maxProgrammes) {
          throw new Error(`XMLTV exceeds the ${maxProgrammes}-programme limit`);
        }
      }
      pendingProgramme = undefined;
    }
  });
  parser.on('error', (error: Error) => {
    throw error;
  });

  const decoder = new TextDecoder();
  for await (const chunk of input) {
    parser.write(
      typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true }),
    );
  }
  const trailing = decoder.decode();
  if (trailing) parser.write(trailing);
  parser.close();

  for (let index = programmes.length - 1; index >= 0; index -= 1) {
    const programme = programmes[index];
    if (programme && !channelIds.has(programme.channelId)) {
      reportIssue({
        code: 'unknown-channel',
        message: `Skipped programme for unknown channel ${programme.channelId}`,
      });
      programmes.splice(index, 1);
    }
  }
  return { channels, programmes, issues, issuesTruncated };
}

function xmltvDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).toFormat('yyyyLLddHHmmss ZZZ');
}

export function serializeXmltv(
  channels: readonly XmltvChannel[],
  programmes: readonly XmltvProgramme[],
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tv generator-info-name="IPTVMaster">',
  ];
  for (const channel of channels) {
    lines.push(`  <channel id="${xmlEscape(channel.id)}">`);
    lines.push(
      `    <display-name>${xmlEscape(channel.displayName)}</display-name>`,
    );
    if (channel.iconUrl)
      lines.push(`    <icon src="${xmlEscape(channel.iconUrl)}"/>`);
    lines.push('  </channel>');
  }
  for (const programme of programmes) {
    const stop = programme.stop ? ` stop="${xmltvDate(programme.stop)}"` : '';
    lines.push(
      `  <programme start="${xmltvDate(programme.start)}"${stop} channel="${xmlEscape(programme.channelId)}">`,
    );
    lines.push(`    <title>${xmlEscape(programme.title)}</title>`);
    if (programme.description)
      lines.push(`    <desc>${xmlEscape(programme.description)}</desc>`);
    if (programme.category)
      lines.push(`    <category>${xmlEscape(programme.category)}</category>`);
    lines.push('  </programme>');
  }
  lines.push('</tv>');
  return `${lines.join('\n')}\n`;
}
