import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { parseM3u } from './m3u.js';
import { ProviderHttpError } from './provider-error.js';
import type { M3uEntry, M3uParseIssue, MediaType } from './types.js';

export interface PlaylistInspection {
  fingerprint: string;
  totalBytes: number;
  entries: M3uEntry[];
  issues: M3uParseIssue[];
  mediaCounts: Record<MediaType, number>;
  skippedEntries: number;
}

export interface PlaylistInspectionOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxLiveEntries?: number;
  fetchImplementation?: typeof fetch;
}

const REJECTED_CONTENT_TYPES = ['text/html', 'application/json'];

async function* limitedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  state: { bytes: number; prefix: string },
  hash: ReturnType<typeof createHash>,
): AsyncGenerator<Uint8Array> {
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    state.bytes += chunk.byteLength;
    if (state.bytes > maxBytes) {
      throw new Error(`Playlist download exceeds the ${maxBytes}-byte limit`);
    }
    hash.update(chunk);
    if (state.prefix.length < 512) {
      state.prefix += decoder
        .decode(chunk, { stream: true })
        .slice(0, 512 - state.prefix.length);
    }
    yield chunk;
  }
}

export async function inspectRemotePlaylist(
  playlistUrl: string,
  options: PlaylistInspectionOptions = {},
): Promise<PlaylistInspection> {
  const url = new URL(playlistUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Playlist URL must use HTTP or HTTPS');
  }

  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
  const maxLiveEntries = options.maxLiveEntries ?? 100_000;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const response = await fetchImplementation(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept:
        'audio/x-mpegurl, application/x-mpegURL, text/plain;q=0.9, */*;q=0.1',
      'user-agent': 'IPTVMaster/0.1',
    },
  });

  if (!response.ok) {
    throw new ProviderHttpError(response.status);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (REJECTED_CONTENT_TYPES.some((value) => contentType.includes(value))) {
    throw new Error(`Provider returned an unexpected ${contentType} response`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(
      `Playlist content length exceeds the ${maxBytes}-byte limit`,
    );
  }
  if (!response.body)
    throw new Error('Provider returned an empty response body');

  const hash = createHash('sha256');
  const state = { bytes: 0, prefix: '' };
  const result = await parseM3u(
    Readable.from(limitedBody(response.body, maxBytes, state, hash)),
    {
      includeMediaTypes: ['live'],
      maxRetainedEntries: maxLiveEntries,
    },
  );

  const prefix = state.prefix.replace(/^\uFEFF/, '').trimStart();
  if (!prefix.startsWith('#EXTM3U') && !prefix.startsWith('#EXTINF')) {
    throw new Error('Provider response is not an M3U playlist');
  }
  if (result.entries.length === 0) {
    throw new Error('Playlist contains no live entries');
  }

  return {
    fingerprint: hash.digest('hex'),
    totalBytes: state.bytes,
    entries: result.entries,
    issues: result.issues,
    mediaCounts: result.mediaCounts,
    skippedEntries: result.skippedEntries,
  };
}
