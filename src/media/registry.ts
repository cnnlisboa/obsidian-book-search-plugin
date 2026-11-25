import { DeezerApi } from '@apis/deezer_api';
import { MusicBrainzApi } from '@apis/musicbrainz_api';
import { OMDB_SOURCE, OmdbApi } from '@apis/omdb_api';
import { TmdbApi } from '@apis/tmdb_api';
import { Book } from '@models/book.model';
import { Album, Artist, MediaItem, MediaType, Movie, SearchResult, Series, Track } from '@models/media.model';
import { BookSearchPluginSettings } from '@settings/settings';
import { parseQuery, ParsedQuery } from '@src/search/query_parser';
import { isConfident, normalize, rankResults, RankingFields } from '@src/search/ranking';
import { enrichBook, searchBooks } from './book_search';

export class MissingApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

/** Karaoke, tributes and other knock-offs that bury the original recording. */
export const MUSIC_JUNK =
  /\b(karaoke|tribute|originally performed|in the style of|made famous|cover version|lullaby|8[- ]bit|piano version|instrumental version|backing track|workout mix)\b/i;

const yearNumber = (value?: string | number) => {
  const year = parseInt(String(value ?? '').slice(0, 4), 10);
  return Number.isNaN(year) ? undefined : year;
};

const hasCover = (item: MediaItem) => Boolean(item.coverUrl || item.coverLargeUrl);

export interface SearchOptions {
  locale?: string;
}

export interface SearchOutcome {
  parsed: ParsedQuery;
  results: SearchResult[];
}

// ------------------------------------------------------------------ movies & tv

function movieApis(settings: BookSearchPluginSettings) {
  const tmdb = settings.tmdbApiKey ? new TmdbApi(settings.tmdbApiKey, settings.tmdbLanguage || 'en-US') : undefined;
  const omdb = settings.omdbApiKey ? new OmdbApi(settings.omdbApiKey) : undefined;
  if (!tmdb && !omdb) {
    throw new MissingApiKeyError(
      'Movies and TV shows need a free TMDB API key (or an OMDb key). Add one in Settings → Media Search → Movies.',
    );
  }
  return { tmdb, omdb };
}

async function searchScreen(
  settings: BookSearchPluginSettings,
  kind: 'movie' | 'series',
  parsed: ParsedQuery,
): Promise<SearchResult[]> {
  const { tmdb, omdb } = movieApis(settings);
  const results = tmdb
    ? await tmdb.search(kind === 'movie' ? 'movie' : 'tv', parsed)
    : await omdb!.search(kind, parsed);

  return rankResults(
    parsed,
    results,
    ({ item }) => ({
      title: item.title,
      altTitles: item.originalTitle ? [item.originalTitle] : [],
      year: yearNumber(item.year),
      hasCover: hasCover(item),
      hasDescription: Boolean(item.description),
    }),
    // remakes share titles, so the year matters a lot
    { yearWeight: 0.1 },
  );
}

async function enrichScreen(
  settings: BookSearchPluginSettings,
  kind: 'movie' | 'series',
  result: SearchResult,
): Promise<Movie | Series> {
  const { tmdb, omdb } = movieApis(settings);
  const item = result.item as Movie | Series;

  if (result.source === OMDB_SOURCE) {
    if (result.details?.full || !item.imdbId || !omdb) return item;
    const details = await omdb.details(item.imdbId);
    return details ? omdb.toItem(kind, details) : item;
  }

  const detailed =
    kind === 'movie'
      ? await tmdb!.movieDetails(result.sourceId as number, item as Movie)
      : await tmdb!.seriesDetails(result.sourceId as number, item as Series);
  return omdb ? omdb.addRatings(detailed) : detailed;
}

// ------------------------------------------------------------------ music

const deezer = new DeezerApi();
const musicBrainz = new MusicBrainzApi();

function musicFields(item: Album | Track, extraTitles: string[] = []): RankingFields {
  return {
    title: item.title,
    altTitles: extraTitles,
    creators: item.artists?.length ? item.artists : item.artist ? [item.artist] : [],
    year: yearNumber(item.year),
    hasCover: hasCover(item),
    junkText: `${item.title} ${item.artist ?? ''}`,
  };
}

async function searchAlbums(parsed: ParsedQuery) {
  const results = await deezer.searchAlbums(parsed);
  return rankResults(
    parsed,
    results,
    ({ item }) => {
      const album = item as Album;
      const type = album.albumType?.toLowerCase();
      // prefer the actual album over singles/EPs with the same name
      return { ...musicFields(album), bonus: type === 'album' ? 0.03 : type === 'single' ? -0.02 : 0 };
    },
    { yearWeight: 0.04, junkPattern: MUSIC_JUNK },
  );
}

async function searchTracks(parsed: ParsedQuery) {
  const results = await deezer.searchTracks(parsed);
  return rankResults(parsed, results, ({ item }) => musicFields(item as Track), {
    yearWeight: 0.03,
    junkPattern: MUSIC_JUNK,
  });
}

async function searchArtists(parsed: ParsedQuery) {
  const results = await deezer.searchArtists(parsed);
  return rankResults(parsed, results, ({ item }) => ({ title: item.title, hasCover: hasCover(item) }), {
    junkPattern: MUSIC_JUNK,
  });
}

// ------------------------------------------------------------------ public api

export async function searchMedia(
  settings: BookSearchPluginSettings,
  type: MediaType,
  query: string,
  options: SearchOptions = {},
): Promise<SearchOutcome> {
  const parsed = parseQuery(query);
  if (!parsed.text && !parsed.isbn && !parsed.imdbId && !parsed.tmdb && !parsed.deezer) {
    return { parsed, results: [] };
  }

  let results: SearchResult[];
  switch (type) {
    case 'book':
      results = await searchBooks(settings, parsed, options.locale);
      break;
    case 'movie':
    case 'series':
      results = await searchScreen(settings, type, parsed);
      break;
    case 'album':
      results = await searchAlbums(parsed);
      break;
    case 'track':
      results = await searchTracks(parsed);
      break;
    case 'artist':
      results = await searchArtists(parsed);
      break;
  }
  // looked up by an exact id (IMDb / TMDB / Deezer link): that's a sure match
  if (type !== 'book' && (parsed.imdbId || parsed.tmdb || parsed.deezer) && results.length) {
    results[0].score = Math.max(results[0].score ?? 0, 0.97);
  }
  return { parsed, results };
}

/** Loads the full record for a chosen result (credits, genres, tracklist, members…). */
export async function loadDetails(
  settings: BookSearchPluginSettings,
  type: MediaType,
  result: SearchResult,
): Promise<MediaItem> {
  switch (type) {
    case 'book':
      return enrichBook(result as SearchResult<Book>);
    case 'movie':
    case 'series':
      return enrichScreen(settings, type, result);
    case 'album': {
      const album = await deezer.albumDetails(result.sourceId as number, result.item as Album);
      return settings.musicBrainzEnrichment ? musicBrainz.enrichAlbum(album) : album;
    }
    case 'track':
      return deezer.trackDetails(result.sourceId as number, result.item as Track);
    case 'artist': {
      const artist = await deezer.artistDetails(result.sourceId as number, result.item as Artist);
      return settings.musicBrainzEnrichment ? musicBrainz.enrichArtist(artist) : artist;
    }
  }
}

const join = (...parts: (string | number | undefined)[]) =>
  parts
    .map(p => (p === undefined || p === null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' · ');

/** One-line summary shown under the title in result lists. */
export function describeItem(type: MediaType, item: MediaItem): string {
  switch (type) {
    case 'book': {
      const b = item as Book;
      return join(b.author, b.publisher, b.publishDate?.slice(0, 4), b.totalPage ? `${b.totalPage} p` : '');
    }
    case 'movie': {
      const m = item as Movie;
      return join(m.year, m.director, m.originalTitle && m.originalTitle !== m.title ? m.originalTitle : '');
    }
    case 'series': {
      const s = item as Series;
      return join(s.yearRange || s.year, s.creator, s.network);
    }
    case 'album': {
      const a = item as Album;
      const kind = a.albumType && a.albumType !== 'album' ? a.albumType.toUpperCase() : '';
      return join(a.artist, a.year, kind, a.trackCount ? `${a.trackCount} tracks` : '');
    }
    case 'track': {
      const t = item as Track;
      return join(t.artist, t.album, t.duration);
    }
    case 'artist': {
      const a = item as Artist;
      return join(
        a.fans ? `${Number(a.fans).toLocaleString()} fans` : '',
        a.albumCount ? `${a.albumCount} albums` : '',
      );
    }
  }
}

export const IDENTIFIER_KEYS = ['isbn13', 'isbn10', 'imdbId', 'tmdbId', 'deezerId', 'musicbrainzId'];

/** "tmdbId:603" style ids used to spot notes that already exist (matched against frontmatter). */
export function itemIdentifiers(item: MediaItem | Record<string, unknown>): string[] {
  const record = item as unknown as Record<string, unknown>;
  const ids: string[] = [];
  for (const key of IDENTIFIER_KEYS) {
    // frontmatter may use snake_case keys
    const snake = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`).replace(/(\d+)/, '_$1');
    const value = record[key] ?? record[snake] ?? record[key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)];
    if (value !== undefined && value !== null && value !== '') ids.push(`${key}:${String(value).toLowerCase()}`);
  }
  return ids;
}

/** Title + main creator + year: two results with the same key are editions of one thing. */
function identityKey(item: MediaItem): string {
  const r = item as unknown as Record<string, unknown>;
  const creator = String(r.author ?? r.artist ?? r.director ?? r.creator ?? '').split(',')[0];
  const year = String(r.year ?? r.publishDate ?? '').slice(0, 4);
  const title = String(item.title ?? '').replace(/\s*[:([].*$/, '');
  return `${normalize(title)}|${normalize(creator)}|${year}`;
}

export function isConfidentMatch(results: SearchResult[]): boolean {
  return isConfident(results, (a, b) => identityKey(a.item) === identityKey(b.item));
}
