import type { M3uEntry, MediaType } from '@iptvmaster/core';

import type {
  XtreamProviderSeriesCatalogue,
  XtreamProviderSeriesInfo,
  XtreamProviderSeriesSummary,
  XtreamSeriesArtwork,
} from './xtream-upstream.js';

export const XTREAM_OUTPUT_USERNAME = 'iptvmaster';
export const XTREAM_STREAM_NAMESPACE_SIZE = 100_000_000;

export interface XtreamOutputEntry {
  entry: M3uEntry;
  sourceId: string;
  sourceIndex: number;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface XtreamFlatStream {
  num: number;
  name: string;
  stream_type: 'live' | 'movie';
  stream_id: number;
  stream_icon: string;
  added: string;
  is_adult: number;
  category_id: string;
  category_ids: string[];
  custom_sid: string | null;
  direct_source: string;
  container_extension?: string;
  rating?: string;
  rating_5based?: number;
  tmdb?: number;
  trailer?: string;
  epg_channel_id?: string;
  tv_archive?: number;
  tv_archive_duration?: string;
}

export interface XtreamSeriesSummary {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  release_date: string;
  last_modified: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  tmdb: string;
  episode_run_time: string;
  category_id: string;
  category_ids: string[];
}

export interface XtreamEpisode {
  id: string;
  episode_num: number;
  title: string;
  container_extension: string;
  info: {
    tmdb_id: number;
    releasedate: string;
    plot: string;
    duration_secs: number;
    duration: string;
    movie_image: string;
    video: Record<string, never>;
    audio: Record<string, never>;
    bitrate: number;
    rating: number;
    season: number;
  };
  custom_sid: string;
  added: string;
  season: number;
  direct_source: string;
}

export interface XtreamSeriesDetail {
  seasons: Array<Record<string, unknown>>;
  info: Omit<XtreamSeriesSummary, 'num' | 'series_id'>;
  episodes: Record<string, XtreamEpisode[]>;
}

export interface XtreamUpstreamSeriesRoute {
  sourceId: string;
  sourceIndex: number;
  upstreamSeriesId: number;
  summary: XtreamSeriesSummary;
}

export interface XtreamSeriesCatalogue {
  categories: XtreamCategory[];
  series: XtreamSeriesSummary[];
  detailsById: Map<number, XtreamSeriesDetail>;
  upstreamById: Map<number, XtreamUpstreamSeriesRoute>;
}

function stableNumericId(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) & 0x7fff_ffff || 1;
}

function assignStableIds(keys: readonly string[]): Map<string, number> {
  const ids = new Map<string, number>();
  const used = new Set<number>();
  for (const key of [...new Set(keys)].sort()) {
    let id = stableNumericId(key);
    while (used.has(id)) id = id === 0x7fff_ffff ? 1 : id + 1;
    used.add(id);
    ids.set(key, id);
  }
  return ids;
}

function categoryKey(item: XtreamOutputEntry, mediaType: MediaType): string {
  return `${item.sourceId}\0${mediaType}\0${item.entry.attributes['group-title'] ?? ''}`;
}

function categoryContext(
  entries: readonly XtreamOutputEntry[],
  mediaType: MediaType,
): { categories: XtreamCategory[]; ids: Map<string, number> } {
  const namesByKey = new Map<string, string>();
  for (const item of entries) {
    if (item.entry.mediaType !== mediaType) continue;
    const key = categoryKey(item, mediaType);
    if (!namesByKey.has(key)) {
      namesByKey.set(key, item.entry.attributes['group-title'] ?? '');
    }
  }
  const ids = assignStableIds([...namesByKey.keys()]);
  return {
    categories: [...namesByKey].map(([key, name]) => ({
      category_id: String(ids.get(key)),
      category_name: name,
      parent_id: 0,
    })),
    ids,
  };
}

export function providerStreamIdFromUrl(value: string): string | null {
  try {
    const segment = new URL(value).pathname.split('/').filter(Boolean).at(-1);
    if (!segment) return null;
    const dot = segment.lastIndexOf('.');
    return (dot > 0 ? segment.slice(0, dot) : segment).slice(0, 255);
  } catch {
    return null;
  }
}

export function containerExtension(value: string): string {
  try {
    const segment = new URL(value).pathname.split('/').filter(Boolean).at(-1);
    const extension = segment?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
    return extension?.toLowerCase() ?? 'ts';
  } catch {
    return 'ts';
  }
}

export function xtreamProviderStreamId(
  sourceId: string,
  sourceIndex: number,
  providerId: string,
): number {
  const numericProviderId = /^\d{1,8}$/.test(providerId)
    ? Number(providerId)
    : stableNumericId(sourceId + '\0' + providerId) %
        XTREAM_STREAM_NAMESPACE_SIZE || 1;
  return sourceIndex * XTREAM_STREAM_NAMESPACE_SIZE + numericProviderId;
}

export function xtreamStreamId(item: XtreamOutputEntry): number {
  const providerId = providerStreamIdFromUrl(item.entry.url) ?? item.entry.url;
  return xtreamProviderStreamId(item.sourceId, item.sourceIndex, providerId);
}
export function decodeXtreamStreamId(
  value: string,
  sourceCount: number,
): { sourceIndex: number; providerStreamId: string } | null {
  if (!/^\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  const sourceIndex = Math.floor(parsed / XTREAM_STREAM_NAMESPACE_SIZE);
  if (sourceIndex >= sourceCount) return null;
  return {
    sourceIndex,
    providerStreamId: String(parsed % XTREAM_STREAM_NAMESPACE_SIZE),
  };
}

export function buildXtreamFlatCatalogue(
  entries: readonly XtreamOutputEntry[],
  mediaType: 'live' | 'vod',
): { categories: XtreamCategory[]; streams: XtreamFlatStream[] } {
  const { categories, ids } = categoryContext(entries, mediaType);
  const selected: Array<{
    item: XtreamOutputEntry;
    categoryIds: string[];
  }> = [];
  const moviesByUrl = new Map<string, (typeof selected)[number]>();
  for (const item of entries) {
    if (item.entry.mediaType !== mediaType) continue;
    const categoryId = String(ids.get(categoryKey(item, mediaType)));
    const existing =
      mediaType === 'vod' ? moviesByUrl.get(item.entry.url) : null;
    if (existing) {
      if (!existing.categoryIds.includes(categoryId)) {
        existing.categoryIds.push(categoryId);
      }
      continue;
    }
    const record = { item, categoryIds: [categoryId] };
    selected.push(record);
    if (mediaType === 'vod') moviesByUrl.set(item.entry.url, record);
  }
  const streams = selected.map(
    ({ item, categoryIds }, index): XtreamFlatStream => {
      const categoryId = categoryIds[0] ?? '';
      const base = {
        num: index + 1,
        name: item.entry.name,
        stream_type:
          mediaType === 'live' ? ('live' as const) : ('movie' as const),
        stream_id: xtreamStreamId(item),
        stream_icon: item.entry.attributes['tvg-logo'] ?? '',
        added: '0',
        is_adult: 0,
        category_id: categoryId,
        category_ids: categoryIds,
        custom_sid: null,
        direct_source: '',
      };
      return mediaType === 'live'
        ? {
            ...base,
            epg_channel_id: item.entry.attributes['tvg-id'] ?? '',
            tv_archive: 0,
            tv_archive_duration: '0',
          }
        : {
            ...base,
            container_extension: containerExtension(item.entry.url),
            rating: '',
            rating_5based: 0,
            tmdb: 0,
            trailer: '',
          };
    },
  );
  return { categories, streams };
}

interface ParsedEpisode {
  seriesName: string;
  season: number;
  episodeNumber: number;
  episodeTitle: string;
}

const EPISODE_PATTERNS = [
  /^(.*?)(?:\s+-\s+|\s+)?S(\d{1,3})\s*E(\d{1,4})(?:\s+-\s+(.+))?$/i,
  /^(.*?)(?:\s+-\s+|\s+)?(\d{1,3})x(\d{1,4})(?:\s+-\s+(.+))?$/i,
];

export function parseSeriesEpisode(name: string): ParsedEpisode | null {
  for (const pattern of EPISODE_PATTERNS) {
    const match = name.match(pattern);
    if (!match) continue;
    const seriesName = match[1]?.trim();
    const season = Number(match[2]);
    const episodeNumber = Number(match[3]);
    if (
      !seriesName ||
      !Number.isInteger(season) ||
      !Number.isInteger(episodeNumber)
    ) {
      continue;
    }
    return {
      seriesName,
      season,
      episodeNumber,
      episodeTitle: match[4]?.trim() || name,
    };
  }
  return null;
}

interface SeriesGroup {
  key: string;
  name: string;
  sourceId: string;
  categoryName: string;
  categoryId: string;
  items: Array<{ item: XtreamOutputEntry; parsed: ParsedEpisode | null }>;
}

interface SeriesArtworkIndex {
  exact: Map<string, Set<string>>;
  normalized: Map<string, Set<string>>;
  byCategory: Map<string, Array<{ name: string; cover: string }>>;
}

function exactSeriesText(value: string): string {
  return value.trim().toLocaleLowerCase('en');
}

function normalizedSeriesText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function addArtwork(
  index: Map<string, Set<string>>,
  key: string,
  cover: string,
): void {
  const covers = index.get(key) ?? new Set<string>();
  covers.add(cover);
  index.set(key, covers);
}

function uniqueArtwork(
  index: Map<string, Set<string>>,
  key: string,
): string | null {
  const covers = index.get(key);
  return covers?.size === 1 ? ([...covers][0] ?? null) : null;
}

function buildSeriesArtworkIndex(
  artwork: readonly XtreamSeriesArtwork[],
): SeriesArtworkIndex {
  const index: SeriesArtworkIndex = {
    exact: new Map(),
    normalized: new Map(),
    byCategory: new Map(),
  };
  for (const item of artwork) {
    addArtwork(index.exact, exactSeriesText(item.name), item.cover);
    addArtwork(index.normalized, normalizedSeriesText(item.name), item.cover);
    const category = normalizedSeriesText(item.categoryName);
    const candidates = index.byCategory.get(category) ?? [];
    candidates.push({
      name: normalizedSeriesText(item.name),
      cover: item.cover,
    });
    index.byCategory.set(category, candidates);
  }
  return index;
}

function seriesArtworkCover(
  index: SeriesArtworkIndex,
  seriesName: string,
  categoryName: string,
): string | null {
  const exact = uniqueArtwork(index.exact, exactSeriesText(seriesName));
  if (exact) return exact;

  const normalizedName = normalizedSeriesText(seriesName);
  const normalized = uniqueArtwork(index.normalized, normalizedName);
  if (normalized) return normalized;
  if (normalizedName.length < 8) return null;

  const covers = new Set<string>();
  for (const candidate of index.byCategory.get(
    normalizedSeriesText(categoryName),
  ) ?? []) {
    const shorter = Math.min(normalizedName.length, candidate.name.length);
    const longer = Math.max(normalizedName.length, candidate.name.length);
    if (
      shorter >= 8 &&
      shorter / longer >= 0.68 &&
      (normalizedName.includes(candidate.name) ||
        candidate.name.includes(normalizedName))
    ) {
      covers.add(candidate.cover);
      if (covers.size > 1) return null;
    }
  }
  return covers.size === 1 ? ([...covers][0] ?? null) : null;
}

export function buildXtreamSeriesCatalogue(
  entries: readonly XtreamOutputEntry[],
  artworkBySource: ReadonlyMap<
    string,
    readonly XtreamSeriesArtwork[]
  > = new Map(),
): XtreamSeriesCatalogue {
  const { categories, ids: categoryIds } = categoryContext(entries, 'series');
  const artworkIndexes = new Map(
    [...artworkBySource].map(([sourceId, artwork]) => [
      sourceId,
      buildSeriesArtworkIndex(artwork),
    ]),
  );
  const groups = new Map<string, SeriesGroup>();
  for (const item of entries) {
    if (item.entry.mediaType !== 'series') continue;
    const parsed = parseSeriesEpisode(item.entry.name);
    const name = parsed?.seriesName ?? item.entry.name.trim();
    const group = item.entry.attributes['group-title'] ?? '';
    const key = `${item.sourceId}\0${group}\0${name.toLocaleLowerCase('en')}`;
    let record = groups.get(key);
    if (!record) {
      record = {
        key,
        name,
        sourceId: item.sourceId,
        categoryName: group,
        categoryId: String(categoryIds.get(categoryKey(item, 'series'))),
        items: [],
      };
      groups.set(key, record);
    }
    record.items.push({ item, parsed });
  }

  const seriesIds = assignStableIds([...groups.keys()]);
  const detailsById = new Map<number, XtreamSeriesDetail>();
  const series = [...groups.values()].map(
    (group, index): XtreamSeriesSummary => {
      const seriesId = seriesIds.get(group.key) ?? 1;
      const first = group.items[0]?.item.entry;
      const artworkIndex = artworkIndexes.get(group.sourceId);
      const providerCover = artworkIndex
        ? seriesArtworkCover(artworkIndex, group.name, group.categoryName)
        : null;
      const cover =
        providerCover ??
        (artworkBySource.has(group.sourceId)
          ? ''
          : (first?.attributes['tvg-logo'] ?? ''));
      const common = {
        name: group.name,
        cover,
        plot: '',
        cast: '',
        director: '',
        genre: '',
        releaseDate: '',
        release_date: '',
        last_modified: '0',
        rating: '',
        rating_5based: 0,
        backdrop_path: cover ? [cover] : [],
        youtube_trailer: '',
        tmdb: '',
        episode_run_time: '',
        category_id: group.categoryId,
        category_ids: [group.categoryId],
      };
      const episodes: Record<string, XtreamEpisode[]> = {};
      group.items.forEach(({ item, parsed }, itemIndex) => {
        const season = parsed?.season ?? 1;
        const seasonKey = String(season);
        const episode: XtreamEpisode = {
          id: String(xtreamStreamId(item)),
          episode_num: parsed?.episodeNumber ?? itemIndex + 1,
          title: parsed?.episodeTitle ?? item.entry.name,
          container_extension: containerExtension(item.entry.url),
          info: {
            tmdb_id: 0,
            releasedate: '',
            plot: '',
            duration_secs: 0,
            duration: '',
            movie_image: item.entry.attributes['tvg-logo'] ?? cover,
            video: {},
            audio: {},
            bitrate: 0,
            rating: 0,
            season,
          },
          custom_sid: '',
          added: '0',
          season,
          direct_source: '',
        };
        (episodes[seasonKey] ??= []).push(episode);
      });
      for (const values of Object.values(episodes)) {
        values.sort((left, right) => left.episode_num - right.episode_num);
      }
      detailsById.set(seriesId, { seasons: [], info: common, episodes });
      return { num: index + 1, series_id: seriesId, ...common };
    },
  );
  return { categories, series, detailsById, upstreamById: new Map() };
}

function allocatedTextId(
  key: string,
  reserved: Set<string>,
  used: Set<string>,
): string {
  let candidate = String(stableNumericId(key));
  while (reserved.has(candidate) || used.has(candidate)) {
    const numeric = Number(candidate);
    candidate = String(numeric >= 0x7fff_ffff ? 1 : numeric + 1);
  }
  used.add(candidate);
  return candidate;
}

function allocatedNumericId(
  key: string,
  reserved: Set<number>,
  used: Set<number>,
): number {
  let candidate = stableNumericId(key);
  while (reserved.has(candidate) || used.has(candidate)) {
    candidate = candidate >= 0x7fff_ffff ? 1 : candidate + 1;
  }
  used.add(candidate);
  return candidate;
}

function providerSeriesSummary(
  series: XtreamProviderSeriesSummary,
  seriesId: number,
  categoryId: string,
): XtreamSeriesSummary {
  return {
    num: 0,
    name: series.name,
    series_id: seriesId,
    cover: series.cover,
    plot: series.plot,
    cast: series.cast,
    director: series.director,
    genre: series.genre,
    releaseDate: series.releaseDate,
    release_date: series.releaseDate,
    last_modified: series.lastModified,
    rating: series.rating,
    rating_5based: series.rating5Based,
    backdrop_path: series.backdropPath,
    youtube_trailer: series.youtubeTrailer,
    tmdb: series.tmdb,
    episode_run_time: series.episodeRunTime,
    category_id: categoryId,
    category_ids: [categoryId],
  };
}

/**
 * Uses provider Xtream parents when that API is available for a source. M3U
 * episode-title synthesis remains only for sources whose Xtream metadata call
 * failed or was unavailable.
 */
export function buildHybridXtreamSeriesCatalogue(
  entries: readonly XtreamOutputEntry[],
  upstreamBySource: ReadonlyMap<string, XtreamProviderSeriesCatalogue>,
  artworkBySource: ReadonlyMap<
    string,
    readonly XtreamSeriesArtwork[]
  > = new Map(),
): XtreamSeriesCatalogue {
  const allowedCategories = new Map<string, Set<string>>();
  const sourceIndexes = new Map<string, number>();
  for (const item of entries) {
    sourceIndexes.set(item.sourceId, item.sourceIndex);
    if (item.entry.mediaType !== 'series') continue;
    const names = allowedCategories.get(item.sourceId) ?? new Set<string>();
    names.add(normalizedSeriesText(item.entry.attributes['group-title'] ?? ''));
    allowedCategories.set(item.sourceId, names);
  }

  const categoryCandidates: Array<{
    key: string;
    sourceId: string;
    preferredId: string;
    categoryName: string;
    parentId: number;
  }> = [];
  for (const [sourceId, catalogue] of upstreamBySource) {
    const allowed = allowedCategories.get(sourceId);
    if (!allowed || allowed.size === 0) continue;
    for (const category of catalogue.categories) {
      if (!allowed.has(normalizedSeriesText(category.categoryName))) continue;
      categoryCandidates.push({
        key: sourceId + '\0' + category.categoryId,
        sourceId,
        preferredId: category.categoryId,
        categoryName: category.categoryName,
        parentId: category.parentId,
      });
    }
  }

  const reservedCategoryIds = new Set(
    categoryCandidates.map((candidate) => candidate.preferredId),
  );
  const usedCategoryIds = new Set<string>();
  const categoryIds = new Map<string, string>();
  for (const candidate of categoryCandidates) {
    const id = !usedCategoryIds.has(candidate.preferredId)
      ? candidate.preferredId
      : allocatedTextId(
          'xtream-category\0' + candidate.key,
          reservedCategoryIds,
          usedCategoryIds,
        );
    usedCategoryIds.add(id);
    categoryIds.set(candidate.key, id);
  }
  const providerCategories = categoryCandidates.map(
    (candidate): XtreamCategory => ({
      category_id: categoryIds.get(candidate.key) ?? candidate.preferredId,
      category_name: candidate.categoryName,
      parent_id:
        candidate.parentId === 0
          ? 0
          : Number(
              categoryIds.get(
                candidate.sourceId + '\0' + String(candidate.parentId),
              ) ?? candidate.parentId,
            ),
    }),
  );

  const seriesCandidates: Array<{
    key: string;
    sourceId: string;
    sourceIndex: number;
    preferredId: number;
    series: XtreamProviderSeriesSummary;
    categoryId: string;
  }> = [];
  for (const [sourceId, catalogue] of upstreamBySource) {
    const sourceIndex = sourceIndexes.get(sourceId);
    if (sourceIndex === undefined) continue;
    for (const series of catalogue.series) {
      const categoryId = categoryIds.get(sourceId + '\0' + series.categoryId);
      if (!categoryId) continue;
      seriesCandidates.push({
        key: sourceId + '\0' + String(series.seriesId),
        sourceId,
        sourceIndex,
        preferredId: series.seriesId,
        series,
        categoryId,
      });
    }
  }
  const reservedSeriesIds = new Set(
    seriesCandidates.map((candidate) => candidate.preferredId),
  );
  const usedSeriesIds = new Set<number>();
  const providerSeries: XtreamSeriesSummary[] = [];
  const providerRoutes = new Map<
    number,
    Omit<XtreamUpstreamSeriesRoute, 'summary'>
  >();
  for (const candidate of seriesCandidates) {
    const id = !usedSeriesIds.has(candidate.preferredId)
      ? candidate.preferredId
      : allocatedNumericId(
          'xtream-series\0' + candidate.key,
          reservedSeriesIds,
          usedSeriesIds,
        );
    usedSeriesIds.add(id);
    providerSeries.push(
      providerSeriesSummary(candidate.series, id, candidate.categoryId),
    );
    providerRoutes.set(id, {
      sourceId: candidate.sourceId,
      sourceIndex: candidate.sourceIndex,
      upstreamSeriesId: candidate.preferredId,
    });
  }

  const fallbackEntries = entries.filter(
    (item) => !upstreamBySource.has(item.sourceId),
  );
  const fallback = buildXtreamSeriesCatalogue(fallbackEntries, artworkBySource);
  const fallbackCategoryIds = new Map<string, string>();
  for (const category of fallback.categories) {
    const id = !usedCategoryIds.has(category.category_id)
      ? category.category_id
      : allocatedTextId(
          'fallback-category\0' +
            category.category_id +
            '\0' +
            category.category_name,
          reservedCategoryIds,
          usedCategoryIds,
        );
    usedCategoryIds.add(id);
    fallbackCategoryIds.set(category.category_id, id);
  }
  const fallbackCategories = fallback.categories.map((category) => ({
    ...category,
    category_id:
      fallbackCategoryIds.get(category.category_id) ?? category.category_id,
  }));

  const detailsById = new Map<number, XtreamSeriesDetail>();
  const fallbackSeries = fallback.series.map((summary) => {
    const id = !usedSeriesIds.has(summary.series_id)
      ? summary.series_id
      : allocatedNumericId(
          'fallback-series\0' + String(summary.series_id) + '\0' + summary.name,
          reservedSeriesIds,
          usedSeriesIds,
        );
    usedSeriesIds.add(id);
    const detail = fallback.detailsById.get(summary.series_id);
    if (detail) detailsById.set(id, detail);
    const categoryId =
      fallbackCategoryIds.get(summary.category_id) ?? summary.category_id;
    return {
      ...summary,
      series_id: id,
      category_id: categoryId,
      category_ids: summary.category_ids.map(
        (candidate) => fallbackCategoryIds.get(candidate) ?? candidate,
      ),
    };
  });

  const series = [...providerSeries, ...fallbackSeries].map(
    (summary, index) => ({ ...summary, num: index + 1 }),
  );
  const summariesById = new Map(
    series.map((summary) => [summary.series_id, summary]),
  );
  const upstreamRoutes = new Map<number, XtreamUpstreamSeriesRoute>();
  for (const [id, route] of providerRoutes) {
    const summary = summariesById.get(id);
    if (summary) upstreamRoutes.set(id, { ...route, summary });
  }
  return {
    categories: [...providerCategories, ...fallbackCategories],
    series,
    detailsById,
    upstreamById: upstreamRoutes,
  };
}

export function buildXtreamSeriesDetailFromUpstream(
  route: XtreamUpstreamSeriesRoute,
  provider: XtreamProviderSeriesInfo,
): XtreamSeriesDetail {
  const info: XtreamSeriesDetail['info'] = {
    name: route.summary.name,
    cover: route.summary.cover,
    plot: route.summary.plot,
    cast: route.summary.cast,
    director: route.summary.director,
    genre: route.summary.genre,
    releaseDate: route.summary.releaseDate,
    release_date: route.summary.release_date,
    last_modified: route.summary.last_modified,
    rating: route.summary.rating,
    rating_5based: route.summary.rating_5based,
    backdrop_path: route.summary.backdrop_path,
    youtube_trailer: route.summary.youtube_trailer,
    tmdb: route.summary.tmdb,
    episode_run_time: route.summary.episode_run_time,
    category_id: route.summary.category_id,
    category_ids: route.summary.category_ids,
  };
  const episodes: Record<string, XtreamEpisode[]> = {};
  for (const [seasonKey, values] of Object.entries(provider.episodes)) {
    episodes[seasonKey] = values
      .map((episode): XtreamEpisode => ({
        id: String(
          xtreamProviderStreamId(route.sourceId, route.sourceIndex, episode.id),
        ),
        episode_num: episode.episodeNumber,
        title: episode.title,
        container_extension: episode.containerExtension,
        info: {
          tmdb_id: episode.info.tmdbId,
          releasedate: episode.info.releaseDate,
          plot: episode.info.plot,
          duration_secs: episode.info.durationSeconds,
          duration: episode.info.duration,
          movie_image: episode.info.movieImage || route.summary.cover,
          video: {},
          audio: {},
          bitrate: episode.info.bitrate,
          rating: episode.info.rating,
          season: episode.season,
        },
        custom_sid: '',
        added: episode.added,
        season: episode.season,
        direct_source: '',
      }))
      .sort((left, right) => left.episode_num - right.episode_num);
  }
  return { seasons: provider.seasons, info, episodes };
}
export function buildXtreamVodInfo(stream: XtreamFlatStream) {
  return {
    info: {
      tmdb_id: '',
      name: stream.name,
      o_name: stream.name,
      cover_big: stream.stream_icon,
      movie_image: stream.stream_icon,
      releasedate: '',
      youtube_trailer: '',
      director: '',
      actors: '',
      cast: '',
      description: '',
      plot: '',
      age: '',
      country: '',
      genre: '',
      backdrop_path: stream.stream_icon ? [stream.stream_icon] : [],
      duration_secs: 0,
      duration: '',
      bitrate: 0,
      rating: stream.rating ?? '',
      status: '',
      runtime: '',
    },
    movie_data: {
      stream_id: stream.stream_id,
      name: stream.name,
      added: stream.added,
      category_id: stream.category_id,
      category_ids: stream.category_ids,
      container_extension: stream.container_extension ?? 'ts',
      custom_sid: stream.custom_sid,
      direct_source: stream.direct_source,
    },
  };
}
