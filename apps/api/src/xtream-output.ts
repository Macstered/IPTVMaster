import type { M3uEntry, MediaType } from '@iptvmaster/core';

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
  seasons: never[];
  info: Omit<XtreamSeriesSummary, 'num' | 'series_id'>;
  episodes: Record<string, XtreamEpisode[]>;
}

export interface XtreamSeriesCatalogue {
  categories: XtreamCategory[];
  series: XtreamSeriesSummary[];
  detailsById: Map<number, XtreamSeriesDetail>;
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

export function xtreamStreamId(item: XtreamOutputEntry): number {
  const providerId = providerStreamIdFromUrl(item.entry.url);
  const numericProviderId =
    providerId && /^\d{1,8}$/.test(providerId)
      ? Number(providerId)
      : stableNumericId(`${item.sourceId}\0${providerId ?? item.entry.url}`) %
        XTREAM_STREAM_NAMESPACE_SIZE;
  return item.sourceIndex * XTREAM_STREAM_NAMESPACE_SIZE + numericProviderId;
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
  const selected = entries.filter((item) => item.entry.mediaType === mediaType);
  const streams = selected.map((item, index): XtreamFlatStream => {
    const categoryId = String(ids.get(categoryKey(item, mediaType)));
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
      category_ids: [categoryId],
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
  });
  return { categories, streams };
}

interface ParsedEpisode {
  seriesName: string;
  season: number;
  episodeNumber: number;
  episodeTitle: string;
}

const EPISODE_PATTERNS = [
  /^(.*?)(?:\s+-\s+|\s+)?S(\d{1,3})E(\d{1,4})(?:\s+-\s+(.+))?$/i,
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
  categoryId: string;
  items: Array<{ item: XtreamOutputEntry; parsed: ParsedEpisode | null }>;
}

export function buildXtreamSeriesCatalogue(
  entries: readonly XtreamOutputEntry[],
): XtreamSeriesCatalogue {
  const { categories, ids: categoryIds } = categoryContext(entries, 'series');
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
      const cover = first?.attributes['tvg-logo'] ?? '';
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
  return { categories, series, detailsById };
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
