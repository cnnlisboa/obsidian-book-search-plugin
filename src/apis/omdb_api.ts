import { apiGet } from '@apis/base_api';
import { Movie, SearchResult, Series } from '@models/media.model';
import { ParsedQuery } from '@src/search/query_parser';
import { cleanText, unique } from './tmdb_api';

const BASE_URL = 'https://www.omdbapi.com/';
export const OMDB_SOURCE = 'OMDb';

interface OmdbSearchItem {
  Title: string;
  Year: string;
  imdbID: string;
  Type: string;
  Poster: string;
}

interface OmdbSearchResponse {
  Search?: OmdbSearchItem[];
  Response: 'True' | 'False';
  Error?: string;
}

export interface OmdbDetails {
  Title: string;
  Year: string;
  Rated?: string;
  Released?: string;
  Runtime?: string;
  Genre?: string;
  Director?: string;
  Writer?: string;
  Actors?: string;
  Plot?: string;
  Language?: string;
  Country?: string;
  Awards?: string;
  Poster?: string;
  Ratings?: { Source: string; Value: string }[];
  Metascore?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbID: string;
  Type: string;
  totalSeasons?: string;
  Response: 'True' | 'False';
  Error?: string;
}

const NA = (value?: string) => (!value || value === 'N/A' ? '' : value);
const list = (value?: string) =>
  unique(
    NA(value)
      .split(',')
      .map(v => v.replace(/\s*\(.*?\)\s*/g, '').trim()),
  );

/** OMDb (IMDb data). Used on its own when there's no TMDB key, or to add IMDb/RT ratings and awards. */
export class OmdbApi {
  constructor(private readonly apiKey: string) {}

  private get<T>(params: Record<string, string | number>) {
    return apiGet<T>(BASE_URL, { apikey: this.apiKey, ...params });
  }

  async search(kind: 'movie' | 'series', parsed: ParsedQuery): Promise<SearchResult<Movie | Series>[]> {
    if (parsed.imdbId) {
      const details = await this.details(parsed.imdbId);
      return details
        ? [
            {
              item: this.toItem(kind, details),
              source: OMDB_SOURCE,
              sourceId: details.imdbID,
              position: 0,
              details: { full: true },
            },
          ]
        : [];
    }

    const query = (parsed.title && parsed.creator ? parsed.title : parsed.text) || parsed.textWithYear;
    const params: Record<string, string | number> = { s: query, type: kind };
    if (parsed.year) params.y = parsed.year;
    let response = await this.get<OmdbSearchResponse>(params);
    if (!response?.Search?.length && parsed.year) {
      delete params.y;
      response = await this.get<OmdbSearchResponse>(params);
    }
    if (response?.Response === 'False' && response.Error && !/not found/i.test(response.Error)) {
      throw new Error(`OMDb: ${response.Error}`);
    }

    return (response?.Search ?? []).map((hit, position) => {
      const poster = NA(hit.Poster);
      const year = hit.Year?.slice(0, 4) ?? '';
      const item: Movie | Series = {
        title: hit.Title,
        year,
        coverUrl: poster,
        coverLargeUrl: poster,
        imdbId: hit.imdbID,
        imdbUrl: `https://www.imdb.com/title/${hit.imdbID}/`,
        link: `https://www.imdb.com/title/${hit.imdbID}/`,
      };
      return { item, source: OMDB_SOURCE, sourceId: hit.imdbID, position };
    });
  }

  async details(imdbId: string): Promise<OmdbDetails | undefined> {
    const d = await this.get<OmdbDetails>({ i: imdbId, plot: 'short' });
    return d?.Response === 'True' ? d : undefined;
  }

  toItem(kind: 'movie' | 'series', d: OmdbDetails): Movie | Series {
    const poster = NA(d.Poster);
    const genres = list(d.Genre);
    const cast = list(d.Actors);
    const countries = list(d.Country);
    const languages = list(d.Language);
    const runtime = parseInt(NA(d.Runtime), 10);
    const [startYear, endYearRaw] = NA(d.Year).split(/[–-]/);
    const common = {
      title: d.Title,
      year: startYear?.trim() ?? '',
      description: cleanText(NA(d.Plot)),
      coverUrl: poster,
      coverLargeUrl: poster,
      genre: genres.join(', '),
      genres,
      cast,
      actors: cast.join(', '),
      language: languages[0] ?? '',
      country: countries[0] ?? '',
      countries,
      awards: NA(d.Awards),
      imdbRating: NA(d.imdbRating),
      rating: NA(d.imdbRating),
      imdbId: d.imdbID,
      imdbUrl: `https://www.imdb.com/title/${d.imdbID}/`,
      link: `https://www.imdb.com/title/${d.imdbID}/`,
    };

    if (kind === 'movie') {
      const directors = list(d.Director);
      const writers = list(d.Writer);
      return {
        ...common,
        releaseDate: NA(d.Released),
        director: directors.join(', '),
        directors,
        writer: writers.join(', '),
        writers,
        languages,
        runtime: Number.isNaN(runtime) ? '' : runtime,
        metascore: NA(d.Metascore),
        rottenTomatoes: d.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value ?? '',
      } as Movie;
    }

    const creators = list(d.Writer);
    const endYear = endYearRaw?.trim() ?? '';
    const ongoing = NA(d.Year).endsWith('–');
    return {
      ...common,
      creator: creators.join(', '),
      creators,
      seasons: NA(d.totalSeasons),
      endYear,
      yearRange: ongoing ? `${common.year}–` : endYear ? `${common.year}–${endYear}` : common.year,
      firstAirDate: NA(d.Released),
    } as Series;
  }

  /** Adds IMDb-only data (IMDb rating, Rotten Tomatoes, Metascore, awards) to a TMDB item. */
  async addRatings<T extends Movie | Series>(item: T): Promise<T> {
    if (!item.imdbId) return item;
    try {
      const d = await this.details(item.imdbId);
      if (!d) return item;
      const extra: Partial<Movie> = {
        imdbRating: NA(d.imdbRating),
        awards: NA(d.Awards),
      };
      if ('directors' in item || d.Type === 'movie') {
        extra.metascore = NA(d.Metascore);
        extra.rottenTomatoes = d.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value ?? '';
      }
      return { ...item, ...extra };
    } catch (error) {
      console.warn('[Media Search] OMDb ratings lookup failed', error);
      return item;
    }
  }
}
