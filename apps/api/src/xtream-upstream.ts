import {
  guardedFetch,
  parseXtreamInput,
  ProviderHttpError,
  xtreamPlayerApiUrl,
  type XtreamAccount,
} from '@iptvmaster/core';

const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SERIES_ITEMS = 100_000;

export interface XtreamSeriesArtwork {
  name: string;
  categoryName: string;
  cover: string;
}

export interface XtreamSeriesArtworkOptions {
  fetchImplementation?: typeof fetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    throw new Error('Xtream metadata response is too large');
  }
  if (!response.body) throw new Error('Xtream metadata response is empty');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error('Xtream metadata response is too large');
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

function accountFromPlaylistUrl(playlistUrl: string): XtreamAccount {
  const parsed = parseXtreamInput(playlistUrl);
  if (!parsed.server || !parsed.username || !parsed.password) {
    throw new Error('Playlist URL does not contain an Xtream login');
  }
  return {
    server: parsed.server,
    username: parsed.username,
    password: parsed.password,
  };
}

function validCover(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_000) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length > 0 && result.length <= maximumLength ? result : null;
}

async function fetchAction(
  account: XtreamAccount,
  action: string,
  options: Required<XtreamSeriesArtworkOptions>,
): Promise<unknown> {
  const url = new URL(xtreamPlayerApiUrl(account));
  url.searchParams.set('action', action);
  const response = await options.fetchImplementation(url, {
    signal: AbortSignal.timeout(options.timeoutMs),
    headers: {
      accept: 'application/json, text/plain;q=0.9',
      'user-agent': 'IPTVMaster/0.2',
    },
  });
  if (!response.ok) throw new ProviderHttpError(response.status);
  return boundedJson(response, options.maxResponseBytes);
}

export async function fetchXtreamSeriesArtwork(
  playlistUrl: string,
  options: XtreamSeriesArtworkOptions = {},
): Promise<XtreamSeriesArtwork[]> {
  const account = accountFromPlaylistUrl(playlistUrl);
  const resolvedOptions: Required<XtreamSeriesArtworkOptions> = {
    fetchImplementation: options.fetchImplementation ?? guardedFetch,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const [categoryPayload, seriesPayload] = await Promise.all([
    fetchAction(account, 'get_series_categories', resolvedOptions),
    fetchAction(account, 'get_series', resolvedOptions),
  ]);
  if (!Array.isArray(categoryPayload) || !Array.isArray(seriesPayload)) {
    throw new Error('Xtream series metadata is malformed');
  }
  if (seriesPayload.length > MAX_SERIES_ITEMS) {
    throw new Error('Xtream series metadata contains too many items');
  }

  const categories = new Map<string, string>();
  for (const candidate of categoryPayload) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    const id = stringValue(String(record['category_id'] ?? ''), 64);
    const name = stringValue(record['category_name'], 500);
    if (id && name) categories.set(id, name);
  }

  const artwork: XtreamSeriesArtwork[] = [];
  for (const candidate of seriesPayload) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    const name = stringValue(record['name'], 1_000);
    const cover = validCover(record['cover']);
    const categoryId = String(record['category_id'] ?? '');
    const categoryName = categories.get(categoryId);
    if (!name || !cover || !categoryName) continue;
    artwork.push({ name, categoryName, cover });
  }
  return artwork;
}
