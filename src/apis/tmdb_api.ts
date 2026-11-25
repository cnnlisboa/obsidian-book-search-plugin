import { apiGet } from '@apis/base_api';
import { Movie, SearchResult, Series } from '@models/media.model';
import { ParsedQuery } from '@src/search/query_parser';

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
export const TMDB_SOURCE = 'TMDB';

interface TmdbSearchItem {
  id: number;
  title?: string; // movie
  name?: string; // tv
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  original_language?: string;
}

interface TmdbSearchResponse {
  results: TmdbSearchItem[];
  total_results: number;
}

interface TmdbFindResponse {
  movie_results: TmdbSearchItem[];
  tv_results: TmdbSearchItem[];
}

interface TmdbNamed {
  name: string;
}

interface TmdbCredits {
  cast?: { name: string; order?: number }[];
  crew?: { name: string; job?: string; department?: string }[];
}

interface TmdbMovieDetails extends TmdbSearchItem {
  genres?: TmdbNamed[];
  runtime?: number;
  tagline?: string;
  imdb_id?: string;
  production_countries?: TmdbNamed[];
  spoken_languages?: { english_name?: string; name?: string }[];
  belongs_to_collection?: TmdbNamed | null;
  credits?: TmdbCredits;
}

interface TmdbTvDetails extends TmdbSearchItem {
  genres?: TmdbNamed[];
  created_by?: TmdbNamed[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  episode_run_time?: number[];
  networks?: TmdbNamed[];
  origin_country?: string[];
  production_countries?: TmdbNamed[];
  status?: string;
  in_production?: boolean;
  last_air_date?: string;
  tagline?: string;
  spoken_languages?: { english_name?: string; name?: string }[];
  credits?: TmdbCredits;
  aggregate_credits?: { cast?: { name: string; order?: number }[] };
  external_ids?: { imdb_id?: string };
}

const MAX_CAST = 5;

function image(path: string | null | undefined, size: string) {
  return path ? `${IMAGE_BASE}/${size}${path}` : '';
}

function yearOf(date?: string) {
  return date ? date.slice(0, 4) : '';
}

export function cleanText(text?: string) {
  return (text ?? '')
    .replace(/\s*\r?\n+\s*/g, ' ')
    .replace(/"/g, "'")
    .trim();
}

/** The Movie Database. Accepts either a v3 API key or a v4 read access token. */
export class TmdbApi {
  constructor(
    private readonly apiKey: string,
    private readonly language = 'en-US',
  ) {}

  private get isBearerToken() {
    return this.apiKey.startsWith('eyJ');
  }

  private get<T>(path: string, params: Record<string, string | number> = {}) {
    const query: Record<string, string | number> = { language: this.language, ...params };
    if (!this.isBearerToken) query.api_key = this.apiKey;
    const headers = this.isBearerToken ? { Authorization: `Bearer ${this.apiKey}` } : undefined;
    return apiGet<T>(`${BASE_URL}${path}`, query, headers);
  }

  async search(kind: 'movie' | 'tv', parsed: ParsedQuery): Promise<SearchResult<Movie | Series>[]> {
    if (parsed.imdbId) {
      const found = await this.get<TmdbFindResponse>(`/find/${parsed.imdbId}`, { external_source: 'imdb_id' });
      const hits = kind === 'movie' ? found.movie_results : found.tv_results;
      if (hits?.length) return hits.map((hit, i) => this.toResult(kind, hit, i));
    }
    if (parsed.tmdb && parsed.tmdb.kind === kind) {
      const hit = await this.get<TmdbSearchItem>(`/${kind}/${parsed.tmdb.id}`);
      return [this.toResult(kind, hit, 0)];
    }

    // "Heat - Michael Mann": search for the title part first, then the whole text
    const queries = new Set<string>();
    if (parsed.title && parsed.creator) queries.add(parsed.title);
    if (parsed.text) queries.add(parsed.text);
    if (!queries.size && parsed.textWithYear) queries.add(parsed.textWithYear);

    const yearParam = kind === 'movie' ? 'primary_release_year' : 'first_air_date_year';
    const seen = new Set<number>();
    const results: SearchResult<Movie | Series>[] = [];

    for (const query of queries) {
      const params: Record<string, string | number> = { query, include_adult: 'false' };
      if (parsed.year) params[yearParam] = parsed.year;
      let response = await this.get<TmdbSearchResponse>(`/search/${kind}`, params);
      // wrong year (common: release vs festival date)? retry without it and let the ranker weigh the year
      if (!response?.results?.length && parsed.year) {
        delete params[yearParam];
        response = await this.get<TmdbSearchResponse>(`/search/${kind}`, params);
      }
      (response?.results ?? []).forEach((hit, i) => {
        if (seen.has(hit.id)) return;
        seen.add(hit.id);
        results.push(this.toResult(kind, hit, i));
      });
    }
    return results;
  }

  private toResult(kind: 'movie' | 'tv', hit: TmdbSearchItem, position: number): SearchResult<Movie | Series> {
    const date = kind === 'movie' ? hit.release_date : hit.first_air_date;
    const title = (kind === 'movie' ? hit.title : hit.name) ?? '';
    const originalTitle = (kind === 'movie' ? hit.original_title : hit.original_name) ?? '';
    const base = {
      title,
      originalTitle: originalTitle !== title ? originalTitle : '',
      year: yearOf(date),
      description: cleanText(hit.overview),
      coverUrl: image(hit.poster_path, 'w342'),
      coverSmallUrl: image(hit.poster_path, 'w92'),
      coverMediumUrl: image(hit.poster_path, 'w342'),
      coverLargeUrl: image(hit.poster_path, 'w780'),
      backdropUrl: image(hit.backdrop_path, 'w1280'),
      rating: hit.vote_average ? Math.round(hit.vote_average * 10) / 10 : '',
      tmdbId: hit.id,
      link: `https://www.themoviedb.org/${kind}/${hit.id}`,
    };
    const item: Movie | Series =
      kind === 'movie' ? { ...base, releaseDate: date ?? '' } : { ...base, firstAirDate: date ?? '' };
    return {
      item,
      source: TMDB_SOURCE,
      sourceId: hit.id,
      position,
      popularity: hit.vote_count ?? 0,
    };
  }

  async movieDetails(id: number | string, base: Movie): Promise<Movie> {
    const d = await this.get<TmdbMovieDetails>(`/movie/${id}`, { append_to_response: 'credits' });
    const crew = d.credits?.crew ?? [];
    const directors = unique(crew.filter(c => c.job === 'Director').map(c => c.name));
    const writers = unique(
      crew
        .filter(c => c.department === 'Writing' && /screenplay|writer|novel|story/i.test(c.job ?? ''))
        .map(c => c.name),
    );
    const cast = (d.credits?.cast ?? [])
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .slice(0, MAX_CAST)
      .map(c => c.name);
    const genres = (d.genres ?? []).map(g => g.name);
    const countries = (d.production_countries ?? []).map(c => c.name);
    const languages = (d.spoken_languages ?? []).map(l => l.english_name || l.name || '').filter(Boolean);

    return {
      ...base,
      tagline: cleanText(d.tagline),
      description: cleanText(d.overview) || base.description,
      releaseDate: d.release_date ?? base.releaseDate,
      director: directors.join(', '),
      directors,
      writer: writers.join(', '),
      writers,
      cast,
      actors: cast.join(', '),
      genre: genres.join(', '),
      genres,
      runtime: d.runtime || '',
      language: languages[0] ?? '',
      languages,
      country: countries[0] ?? '',
      countries,
      collection: d.belongs_to_collection?.name ?? '',
      imdbId: d.imdb_id ?? '',
      imdbUrl: d.imdb_id ? `https://www.imdb.com/title/${d.imdb_id}/` : '',
    };
  }

  async seriesDetails(id: number | string, base: Series): Promise<Series> {
    const d = await this.get<TmdbTvDetails>(`/tv/${id}`, { append_to_response: 'aggregate_credits,external_ids' });
    const creators = (d.created_by ?? []).map(c => c.name);
    const cast = (d.aggregate_credits?.cast ?? d.credits?.cast ?? [])
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .slice(0, MAX_CAST)
      .map(c => c.name);
    const genres = (d.genres ?? []).flatMap(g => g.name.split(' & ')).map(g => g.trim());
    const networks = (d.networks ?? []).map(n => n.name);
    const countries = (d.production_countries ?? []).map(c => c.name);
    const year = yearOf(d.first_air_date) || base.year || '';
    const ended = d.status === 'Ended' || d.status === 'Canceled';
    const endYear = ended ? yearOf(d.last_air_date) : '';
    const imdbId = d.external_ids?.imdb_id ?? '';

    return {
      ...base,
      tagline: cleanText(d.tagline),
      description: cleanText(d.overview) || base.description,
      year,
      endYear,
      yearRange: !year ? '' : ended ? (endYear && endYear !== year ? `${year}–${endYear}` : year) : `${year}–`,
      firstAirDate: d.first_air_date ?? '',
      lastAirDate: d.last_air_date ?? '',
      creator: creators.join(', '),
      creators,
      cast,
      actors: cast.join(', '),
      genre: unique(genres).join(', '),
      genres: unique(genres),
      seasons: d.number_of_seasons ?? '',
      episodes: d.number_of_episodes ?? '',
      episodeRuntime: d.episode_run_time?.[0] ?? '',
      network: networks.join(', '),
      networks,
      airingStatus: d.status ?? '',
      language: (d.spoken_languages ?? []).map(l => l.english_name || l.name)[0] ?? '',
      country: countries[0] ?? '',
      countries,
      imdbId,
      imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : '',
    };
  }
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}
