import {
  DEFAULT_MAX_RETAINED_ENTRIES,
  guardedFetch,
  mediaCategoryKey,
  parseXtreamInput,
  PlaylistEntryLimitError,
  ProviderHttpError,
  xtreamPlayerApiUrl,
  xtreamStreamUrl,
  type M3uEntry,
  type MediaCategoryCount,
  type MediaType,
  type PlaylistInspection,
  type XtreamAccount,
} from '@iptvmaster/core';
import { createHash } from 'node:crypto';

const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_PROVIDER_ITEMS = 500_000;

interface FetchedXtreamPayload {
  payload: unknown;
  totalBytes: number;
  fingerprint: string;
}

export interface XtreamPlaylistInspectionOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRetainedEntries?: number;
  fetchImplementation?: typeof fetch;
  selectiveGroups?: ReadonlySet<string>;
  includeLive?: boolean;
  includeCatalogue?: boolean;
}

interface XtreamCategory {
  id: string;
  name: string;
}

function accountFromPlaylistUrl(playlistUrl: string): XtreamAccount {
  const parsed = parseXtreamInput(playlistUrl);
  if (!parsed.server || !parsed.username || !parsed.password) {
    throw new Error('Saved source does not contain a usable Xtream login');
  }
  return {
    server: parsed.server,
    username: parsed.username,
    password: parsed.password,
  };
}

function stringValue(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length > 0 && result.length <= maximumLength ? result : null;
}

function identifier(value: unknown): string | null {
  const result = stringValue(String(value ?? ''), 32);
  return result && /^\d{1,16}$/.test(result) ? result : null;
}

function extension(value: unknown, fallback: string): string {
  const result = stringValue(value, 16)?.toLowerCase();
  return result && /^[a-z0-9]{1,8}$/.test(result) ? result : fallback;
}

function webUrl(value: unknown): string {
  const result = stringValue(value, 4_000);
  if (!result) return '';
  try {
    const parsed = new URL(result);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? result
      : '';
  } catch {
    return '';
  }
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
): Promise<FetchedXtreamPayload> {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    throw new Error('Xtream metadata response is too large');
  }
  if (!response.body) throw new Error('Xtream metadata response is empty');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const hash = createHash('sha256');
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error('Xtream metadata response is too large');
    }
    hash.update(next.value);
    chunks.push(next.value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      payload: JSON.parse(new TextDecoder().decode(body)),
      totalBytes,
      fingerprint: hash.digest('hex'),
    };
  } catch {
    throw new Error('Xtream metadata response is not valid JSON');
  }
}

async function fetchAction(
  account: XtreamAccount,
  action: string,
  options: Required<
    Pick<
      XtreamPlaylistInspectionOptions,
      'fetchImplementation' | 'maxResponseBytes' | 'timeoutMs'
    >
  >,
): Promise<FetchedXtreamPayload> {
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

/**
 * Panels answer an action the account cannot use with the JSON literal
 * `false` rather than an empty list. That is an absent section, not a broken
 * response, so it must not abort an import whose other sections are fine.
 */
function isAbsentSection(payload: unknown): boolean {
  return payload === false || payload === null || payload === undefined;
}

function parseCategories(payload: unknown, label: string): XtreamCategory[] {
  if (isAbsentSection(payload)) return [];
  if (!Array.isArray(payload)) {
    throw new Error(`Xtream ${label} categories are malformed`);
  }
  return payload.flatMap((candidate): XtreamCategory[] => {
    if (typeof candidate !== 'object' || candidate === null) return [];
    const record = candidate as Record<string, unknown>;
    const id = identifier(record['category_id']);
    const name = stringValue(record['category_name'], 500);
    return id && name ? [{ id, name }] : [];
  });
}

function categoryName(
  categoryId: string,
  categories: ReadonlyMap<string, string>,
): string {
  return categories.get(categoryId) ?? 'Uncategorized';
}

function ensureProviderArray(
  payload: unknown,
  label: string,
): Array<Record<string, unknown>> {
  if (isAbsentSection(payload)) return [];
  if (!Array.isArray(payload)) {
    throw new Error(`Xtream ${label} metadata is malformed`);
  }
  if (payload.length > MAX_PROVIDER_ITEMS) {
    throw new Error(`Xtream ${label} metadata contains too many items`);
  }
  return payload.filter(
    (candidate): candidate is Record<string, unknown> =>
      typeof candidate === 'object' && candidate !== null,
  );
}

/**
 * Imports an Xtream account from its native JSON API. Providers sometimes
 * disable the legacy get.php M3U while leaving player_api.php available, and
 * an M3U also flattens episodes that the native API correctly keeps under a
 * parent series.
 */
export async function inspectRemoteXtreamPlaylist(
  playlistUrl: string,
  options: XtreamPlaylistInspectionOptions = {},
): Promise<PlaylistInspection> {
  const account = accountFromPlaylistUrl(playlistUrl);
  const fetchOptions = {
    fetchImplementation: options.fetchImplementation ?? guardedFetch,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const includeLive = options.includeLive !== false;
  const includeCatalogue = options.includeCatalogue !== false;
  const selectiveGroups = options.selectiveGroups ?? new Set<string>();
  const maxRetainedEntries =
    options.maxRetainedEntries ?? DEFAULT_MAX_RETAINED_ENTRIES;
  const entries: M3uEntry[] = [];
  const categoriesByKey = new Map<string, MediaCategoryCount>();
  const mediaCounts: Record<MediaType, number> = {
    live: 0,
    vod: 0,
    series: 0,
    unknown: 0,
  };
  const fingerprint = createHash('sha256');
  let totalBytes = 0;
  let skippedEntries = 0;
  let lineNumber = 0;

  const fetched = async (action: string): Promise<unknown> => {
    const result = await fetchAction(account, action, fetchOptions);
    totalBytes += result.totalBytes;
    fingerprint.update(action).update('\0').update(result.fingerprint);
    return result.payload;
  };
  const retain = (entry: M3uEntry, selected: boolean): void => {
    if (!selected) {
      skippedEntries += 1;
      return;
    }
    if (entries.length >= maxRetainedEntries) {
      throw new PlaylistEntryLimitError(maxRetainedEntries);
    }
    entries.push(entry);
  };
  const countCategory = (
    mediaType: 'vod' | 'series',
    providerGroup: string,
  ): void => {
    const key = mediaCategoryKey(mediaType, providerGroup);
    const existing = categoriesByKey.get(key);
    if (existing) existing.itemCount += 1;
    else
      categoriesByKey.set(key, {
        mediaType,
        providerGroup,
        itemCount: 1,
      });
  };

  if (includeLive) {
    const categoryPayload = await fetched('get_live_categories');
    const streamPayload = await fetched('get_live_streams');
    const liveCategories = new Map(
      parseCategories(categoryPayload, 'live').map((category) => [
        category.id,
        category.name,
      ]),
    );
    for (const record of ensureProviderArray(streamPayload, 'live')) {
      const streamId = identifier(record['stream_id']);
      const name = stringValue(record['name'], 2_000);
      const categoryId = identifier(record['category_id']) ?? '0';
      if (!streamId || !name) continue;
      const providerGroup = categoryName(categoryId, liveCategories);
      lineNumber += 1;
      mediaCounts.live += 1;
      retain(
        {
          duration: -1,
          attributes: {
            'tvg-name': name,
            'group-title': providerGroup,
            ...(stringValue(record['epg_channel_id'], 1_000)
              ? { 'tvg-id': stringValue(record['epg_channel_id'], 1_000)! }
              : {}),
            ...(webUrl(record['stream_icon'])
              ? { 'tvg-logo': webUrl(record['stream_icon']) }
              : {}),
          },
          name,
          url: xtreamStreamUrl(
            account,
            'live',
            streamId,
            extension(record['container_extension'], 'ts'),
          ),
          mediaType: 'live',
          lineNumber,
        },
        true,
      );
    }
  }

  if (includeCatalogue) {
    const vodCategoryPayload = await fetched('get_vod_categories');
    const vodPayload = await fetched('get_vod_streams');
    const vodCategories = new Map(
      parseCategories(vodCategoryPayload, 'movie').map((category) => [
        category.id,
        category.name,
      ]),
    );
    for (const record of ensureProviderArray(vodPayload, 'movie')) {
      const streamId = identifier(record['stream_id']);
      const name = stringValue(record['name'], 2_000);
      const categoryId = identifier(record['category_id']) ?? '0';
      if (!streamId || !name) continue;
      const providerGroup = categoryName(categoryId, vodCategories);
      const selected = selectiveGroups.has(
        mediaCategoryKey('vod', providerGroup),
      );
      lineNumber += 1;
      mediaCounts.vod += 1;
      countCategory('vod', providerGroup);
      retain(
        {
          duration: -1,
          attributes: {
            'tvg-name': name,
            'group-title': providerGroup,
            ...(webUrl(record['stream_icon'])
              ? { 'tvg-logo': webUrl(record['stream_icon']) }
              : {}),
          },
          name,
          url: xtreamStreamUrl(
            account,
            'movie',
            streamId,
            extension(record['container_extension'], 'mp4'),
          ),
          mediaType: 'vod',
          lineNumber,
        },
        selected,
      );
    }

    const seriesCategoryPayload = await fetched('get_series_categories');
    const seriesPayload = await fetched('get_series');
    const seriesCategories = new Map(
      parseCategories(seriesCategoryPayload, 'series').map((category) => [
        category.id,
        category.name,
      ]),
    );
    for (const record of ensureProviderArray(seriesPayload, 'series')) {
      const seriesId = identifier(record['series_id']);
      const name = stringValue(record['name'], 2_000);
      const categoryId = identifier(record['category_id']) ?? '0';
      if (!seriesId || !name) continue;
      const providerGroup = categoryName(categoryId, seriesCategories);
      const selected = selectiveGroups.has(
        mediaCategoryKey('series', providerGroup),
      );
      lineNumber += 1;
      mediaCounts.series += 1;
      countCategory('series', providerGroup);
      retain(
        {
          duration: -1,
          attributes: {
            'tvg-name': name,
            'group-title': providerGroup,
            ...(webUrl(record['cover'])
              ? { 'tvg-logo': webUrl(record['cover']) }
              : {}),
          },
          name,
          // This row identifies the parent and its category. Episodes remain
          // lazy and get playable provider IDs from get_series_info.
          url: xtreamStreamUrl(account, 'series', seriesId, 'ts'),
          mediaType: 'series',
          lineNumber,
        },
        selected,
      );
    }
  }

  if (includeLive && mediaCounts.live === 0) {
    throw new Error('Xtream account contains no live entries');
  }
  if (!includeLive && includeCatalogue && categoriesByKey.size === 0) {
    throw new Error('Xtream account contains no films or series');
  }
  if (!includeLive && !includeCatalogue) {
    throw new Error('Source import has no enabled media types');
  }

  return {
    fingerprint: fingerprint.digest('hex'),
    totalBytes,
    entries,
    issues: [],
    mediaCounts,
    skippedEntries,
    categories: [...categoriesByKey.values()].sort(
      (left, right) =>
        left.mediaType.localeCompare(right.mediaType) ||
        left.providerGroup.localeCompare(right.providerGroup),
    ),
  };
}
