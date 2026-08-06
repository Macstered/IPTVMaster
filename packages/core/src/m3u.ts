import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

import type {
  M3uEntry,
  M3uParseIssue,
  M3uParseOptions,
  M3uParseResult,
  MediaType,
} from './types.js';

// Anchored to a preceding delimiter so a long run of attribute-name
// characters without a following `="` fails in constant time per position
// instead of backtracking across the whole line (quadratic on hostile feeds).
const ATTRIBUTE_PATTERN = /(?:^|\s)([A-Za-z0-9_-]+)="([^"]*)"/g;
const MAX_LINE_LENGTH = 16 * 1024;
const VOD_EXTENSIONS = new Set([
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.wmv',
]);

function pathExtension(path: string): string {
  const finalSegment = path.split('/').at(-1) ?? '';
  const dot = finalSegment.lastIndexOf('.');
  return dot >= 0 ? finalSegment.slice(dot).toLowerCase() : '';
}

export function classifyMediaUrl(value: string): MediaType {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const segments = path.split('/').filter(Boolean);

    if (segments.includes('series')) return 'series';
    if (segments.includes('movie')) return 'vod';
    if (segments.includes('live')) return 'live';

    const extension = pathExtension(path);
    if (VOD_EXTENSIONS.has(extension)) return 'vod';
    if (extension === '.m3u8' || extension === '.ts' || extension === '') {
      return 'live';
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

export function parseExtinf(line: string, lineNumber: number): M3uEntry | null {
  const durationMatch = /^#EXTINF:([^\s,]+)/.exec(line);
  if (!durationMatch) return null;

  const durationText = durationMatch[1];
  const parsedDuration =
    durationText === undefined ? Number.NaN : Number(durationText);
  const duration = Number.isFinite(parsedDuration) ? parsedDuration : null;
  const attributes: Record<string, string> = {};
  let lastAttributeEnd = durationMatch[0].length;

  ATTRIBUTE_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(ATTRIBUTE_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) attributes[key] = value;
    lastAttributeEnd = (match.index ?? lastAttributeEnd) + match[0].length;
  }

  // Provider logo URLs occasionally contain commas. The channel-name delimiter
  // is therefore the first comma after the final quoted attribute, not the first
  // comma in the line.
  const separatorIndex = line.indexOf(',', lastAttributeEnd);
  if (separatorIndex < 0) return null;

  return {
    duration,
    attributes,
    name: line.slice(separatorIndex + 1).trim(),
    url: '',
    mediaType: 'unknown',
    lineNumber,
  };
}

export async function parseM3u(
  input: NodeJS.ReadableStream,
  options: M3uParseOptions = {},
): Promise<M3uParseResult> {
  const entries: M3uEntry[] = [];
  const issues: M3uParseIssue[] = [];
  const mediaCounts: Record<MediaType, number> = {
    live: 0,
    vod: 0,
    series: 0,
    unknown: 0,
  };
  const includedMediaTypes = options.includeMediaTypes
    ? new Set(options.includeMediaTypes)
    : null;
  const maxRetainedEntries =
    options.maxRetainedEntries ?? Number.POSITIVE_INFINITY;
  let skippedEntries = 0;
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let pending: M3uEntry | null = null;

  for await (const rawLine of lines) {
    lineNumber += 1;
    if (rawLine.length > MAX_LINE_LENGTH) {
      issues.push({
        lineNumber,
        code: 'invalid-extinf',
        message: `Line ${lineNumber} exceeds ${MAX_LINE_LENGTH} characters and was skipped`,
      });
      continue;
    }
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      if (pending !== null) {
        issues.push({
          lineNumber: pending.lineNumber,
          code: 'missing-url',
          message: `Entry on line ${pending.lineNumber} has no stream URL`,
        });
      }

      pending = parseExtinf(line, lineNumber);
      if (pending === null) {
        issues.push({
          lineNumber,
          code: 'invalid-extinf',
          message: `Could not parse EXTINF metadata on line ${lineNumber}`,
        });
      }
      continue;
    }

    if (line.startsWith('#')) continue;

    if (pending === null) {
      issues.push({
        lineNumber,
        code: 'orphan-url',
        message: `Stream URL on line ${lineNumber} has no EXTINF metadata`,
      });
      continue;
    }

    pending.url = line;
    pending.mediaType = classifyMediaUrl(line);
    mediaCounts[pending.mediaType] += 1;
    if (
      includedMediaTypes === null ||
      includedMediaTypes.has(pending.mediaType)
    ) {
      if (entries.length >= maxRetainedEntries) {
        throw new Error(
          `Playlist exceeds the ${maxRetainedEntries} retained-entry limit`,
        );
      }
      entries.push(pending);
    } else {
      skippedEntries += 1;
    }
    pending = null;
  }

  if (pending !== null) {
    issues.push({
      lineNumber: pending.lineNumber,
      code: 'missing-url',
      message: `Entry on line ${pending.lineNumber} has no stream URL`,
    });
  }

  return { entries, issues, mediaCounts, skippedEntries };
}

export function parseM3uText(
  text: string,
  options: M3uParseOptions = {},
): Promise<M3uParseResult> {
  return parseM3u(Readable.from([text]), options);
}

export function redactStreamUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/[redacted]`;
  } catch {
    return '[invalid or redacted URL]';
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll('"', "'").replaceAll('\r', ' ').replaceAll('\n', ' ');
}

export function serializeM3u(entries: readonly M3uEntry[]): string {
  const output = ['#EXTM3U'];

  for (const entry of entries) {
    const attributes = Object.entries(entry.attributes)
      .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
      .join(' ');
    const duration = entry.duration ?? -1;
    const metadata = attributes.length > 0 ? ` ${attributes}` : '';
    output.push(`#EXTINF:${duration}${metadata},${entry.name}`);
    output.push(entry.url);
  }

  return `${output.join('\n')}\n`;
}
