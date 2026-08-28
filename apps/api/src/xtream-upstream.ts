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

export interface XtreamProviderSeriesCategory {
  categoryId: string;
  categoryName: string;
  parentId: number;
}

export interface XtreamProviderSeriesSummary {
  seriesId: number;
  name: string;
  categoryId: string;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  lastModified: string;
  rating: string;
  rating5Based: number;
  backdropPath: string[];
  youtubeTrailer: string;
  tmdb: string;
  episodeRunTime: string;
}

export interface XtreamProviderSeriesCatalogue {
  categories: XtreamProviderSeriesCategory[];
  series: XtreamProviderSeriesSummary[];
}

export interface XtreamProviderEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  containerExtension: string;
  added: string;
  season: number;
  info: {
    tmdbId: number;
    releaseDate: string;
    plot: string;
    durationSeconds: number;
    duration: string;
    movieImage: string;
    bitrate: number;
    rating: number;
  };
}

export interface XtreamProviderSeriesInfo {
  seasons: Array<Record<string, unknown>>;
  episodes: Record<string, XtreamProviderEpisode[]>;
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
  parameters: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(xtreamPlayerApiUrl(account));
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
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

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value, Number.NaN);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringOrEmpty(value: unknown, maximumLength = 4_000): string {
  return stringValue(value, maximumLength) ?? '';
}

function stringArray(value: unknown, maximumItems = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maximumItems)
    .map((item) => stringValue(item, 4_000))
    .filter((item): item is string => item !== null);
}

function parseSeriesSummary(
  value: unknown,
): XtreamProviderSeriesSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const seriesId = positiveInteger(record['series_id']);
  const name = stringValue(record['name'], 1_000);
  const categoryId = stringValue(String(record['category_id'] ?? ''), 32);
  if (!seriesId || !name || !categoryId) return null;
  return {
    seriesId,
    name,
    categoryId,
    cover: validCover(record['cover']) ?? '',
    plot: stringOrEmpty(record['plot'], 20_000),
    cast: stringOrEmpty(record['cast'], 10_000),
    director: stringOrEmpty(record['director'], 5_000),
    genre: stringOrEmpty(record['genre'], 2_000),
    releaseDate: stringOrEmpty(
      record['releaseDate'] ?? record['release_date'],
      100,
    ),
    lastModified: stringOrEmpty(record['last_modified'], 100),
    rating: stringOrEmpty(record['rating'], 100),
    rating5Based: finiteNumber(record['rating_5based']),
    backdropPath: stringArray(record['backdrop_path']),
    youtubeTrailer: stringOrEmpty(record['youtube_trailer'], 500),
    tmdb: stringOrEmpty(String(record['tmdb'] ?? ''), 100),
    episodeRunTime: stringOrEmpty(record['episode_run_time'], 100),
  };
}

function parseSeason(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const seasonNumber = positiveInteger(record['season_number']);
  if (!seasonNumber) return null;
  return {
    air_date: stringOrEmpty(record['air_date'], 100),
    episode_count: Math.max(0, finiteNumber(record['episode_count'])),
    id: Math.max(0, finiteNumber(record['id'])),
    name: stringOrEmpty(record['name'], 1_000),
    overview: stringOrEmpty(record['overview'], 20_000),
    season_number: seasonNumber,
    cover: validCover(record['cover']) ?? '',
    cover_big: validCover(record['cover_big']) ?? '',
  };
}

function parseEpisode(
  value: unknown,
  seasonFallback: number,
): XtreamProviderEpisode | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = stringValue(String(record['id'] ?? ''), 32);
  const episodeNumber = positiveInteger(record['episode_num']);
  const title = stringValue(record['title'], 2_000);
  const season = positiveInteger(record['season']) ?? seasonFallback;
  if (!id || !/^\d{1,16}$/.test(id) || !episodeNumber || !title) return null;
  const rawInfo =
    typeof record['info'] === 'object' && record['info'] !== null
      ? (record['info'] as Record<string, unknown>)
      : {};
  const extension = stringValue(record['container_extension'], 16);
  return {
    id,
    episodeNumber,
    title,
    containerExtension:
      extension && /^[A-Za-z0-9]{1,8}$/.test(extension)
        ? extension.toLowerCase()
        : 'ts',
    added: stringOrEmpty(record['added'], 100),
    season,
    info: {
      tmdbId: Math.max(0, finiteNumber(rawInfo['tmdb_id'])),
      releaseDate: stringOrEmpty(rawInfo['releasedate'], 100),
      plot: stringOrEmpty(rawInfo['plot'], 20_000),
      durationSeconds: Math.max(0, finiteNumber(rawInfo['duration_secs'])),
      duration: stringOrEmpty(rawInfo['duration'], 100),
      movieImage: validCover(rawInfo['movie_image']) ?? '',
      bitrate: Math.max(0, finiteNumber(rawInfo['bitrate'])),
      rating: finiteNumber(rawInfo['rating']),
    },
  };
}

export async function fetchXtreamSeriesCatalogue(
  playlistUrl: string,
  options: XtreamSeriesArtworkOptions = {},
): Promise<XtreamProviderSeriesCatalogue> {
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

  const categories: XtreamProviderSeriesCategory[] = [];
  for (const candidate of categoryPayload) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    const categoryId = stringValue(String(record['category_id'] ?? ''), 32);
    const categoryName = stringValue(record['category_name'], 500);
    if (!categoryId || !categoryName) continue;
    categories.push({
      categoryId,
      categoryName,
      parentId: Math.max(0, finiteNumber(record['parent_id'])),
    });
  }

  return {
    categories,
    series: seriesPayload
      .map(parseSeriesSummary)
      .filter((item): item is XtreamProviderSeriesSummary => item !== null),
  };
}

export async function fetchXtreamSeriesInfo(
  playlistUrl: string,
  seriesId: number,
  options: XtreamSeriesArtworkOptions = {},
): Promise<XtreamProviderSeriesInfo> {
  if (!Number.isSafeInteger(seriesId) || seriesId <= 0) {
    throw new Error('Xtream series identifier is invalid');
  }
  const account = accountFromPlaylistUrl(playlistUrl);
  const resolvedOptions: Required<XtreamSeriesArtworkOptions> = {
    fetchImplementation: options.fetchImplementation ?? guardedFetch,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const payload = await fetchAction(
    account,
    'get_series_info',
    resolvedOptions,
    {
      series_id: String(seriesId),
    },
  );
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Xtream series detail is malformed');
  }
  const record = payload as Record<string, unknown>;
  const seasons = Array.isArray(record['seasons'])
    ? record['seasons']
        .map(parseSeason)
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
  const episodes: Record<string, XtreamProviderEpisode[]> = {};
  if (typeof record['episodes'] === 'object' && record['episodes'] !== null) {
    let episodeCount = 0;
    for (const [seasonKey, candidates] of Object.entries(
      record['episodes'] as Record<string, unknown>,
    )) {
      if (!Array.isArray(candidates)) continue;
      const season = positiveInteger(seasonKey);
      if (!season) continue;
      const parsed = candidates
        .map((candidate) => parseEpisode(candidate, season))
        .filter((item): item is XtreamProviderEpisode => item !== null);
      episodeCount += parsed.length;
      if (episodeCount > MAX_SERIES_ITEMS) {
        throw new Error('Xtream series detail contains too many episodes');
      }
      episodes[String(season)] = parsed;
    }
  }
  return { seasons, episodes };
}
export async function fetchXtreamSeriesArtwork(
  playlistUrl: string,
  options: XtreamSeriesArtworkOptions = {},
): Promise<XtreamSeriesArtwork[]> {
  const catalogue = await fetchXtreamSeriesCatalogue(playlistUrl, options);
  const categories = new Map(
    catalogue.categories.map((category) => [
      category.categoryId,
      category.categoryName,
    ]),
  );
  return catalogue.series.flatMap((series): XtreamSeriesArtwork[] => {
    const categoryName = categories.get(series.categoryId);
    return series.cover && categoryName
      ? [{ name: series.name, categoryName, cover: series.cover }]
      : [];
  });
}
