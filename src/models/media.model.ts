import { Book } from './book.model';

export type MediaType = 'book' | 'movie' | 'series' | 'album' | 'track' | 'artist';

export const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'series', 'album', 'track', 'artist'];

/**
 * Fields shared by every media note. `title` drives the default file name,
 * cover fields drive cover image saving, `link` is the canonical web page.
 */
export interface BaseMedia {
  title: string;
  coverUrl?: string;
  coverSmallUrl?: string;
  coverMediumUrl?: string;
  coverLargeUrl?: string;
  localCoverImage?: string;
  link?: string;
  description?: string;
}

export interface Movie extends BaseMedia {
  originalTitle?: string;
  year?: string;
  releaseDate?: string;
  director?: string;
  directors?: string[];
  writer?: string;
  writers?: string[];
  cast?: string[];
  actors?: string;
  genre?: string;
  genres?: string[];
  runtime?: number | string; // minutes
  tagline?: string;
  language?: string;
  languages?: string[];
  country?: string;
  countries?: string[];
  rating?: number | string; // TMDB / IMDb rating out of 10
  imdbRating?: string;
  rottenTomatoes?: string;
  metascore?: string;
  awards?: string;
  collection?: string;
  backdropUrl?: string;
  tmdbId?: number | string;
  imdbId?: string;
  imdbUrl?: string;
}

export interface Series extends BaseMedia {
  originalTitle?: string;
  year?: string;
  endYear?: string;
  yearRange?: string; // "2015–2022" or "2024–"
  firstAirDate?: string;
  lastAirDate?: string;
  creator?: string;
  creators?: string[];
  cast?: string[];
  actors?: string;
  genre?: string;
  genres?: string[];
  seasons?: number | string;
  episodes?: number | string;
  episodeRuntime?: number | string;
  network?: string;
  networks?: string[];
  airingStatus?: string;
  tagline?: string;
  language?: string;
  country?: string;
  countries?: string[];
  rating?: number | string;
  imdbRating?: string;
  awards?: string;
  backdropUrl?: string;
  tmdbId?: number | string;
  imdbId?: string;
  imdbUrl?: string;
}

export interface Album extends BaseMedia {
  artist?: string;
  artists?: string[];
  year?: string;
  releaseDate?: string;
  genre?: string;
  genres?: string[];
  label?: string;
  albumType?: string; // album, ep, single, compilation
  trackCount?: number | string;
  duration?: string; // "53:21"
  durationSeconds?: number;
  tracks?: string[];
  tracklist?: string; // markdown numbered list
  upc?: string;
  explicit?: boolean;
  deezerId?: number | string;
  musicbrainzId?: string;
}

export interface Track extends BaseMedia {
  artist?: string;
  artists?: string[];
  album?: string;
  year?: string;
  releaseDate?: string;
  genre?: string;
  genres?: string[];
  duration?: string; // "6:27"
  durationSeconds?: number;
  trackNumber?: number | string;
  discNumber?: number | string;
  bpm?: number | string;
  isrc?: string;
  explicit?: boolean;
  previewUrl?: string;
  deezerId?: number | string;
}

export interface Artist extends BaseMedia {
  name?: string;
  artistType?: string; // Group, Person, ...
  genre?: string;
  genres?: string[];
  country?: string;
  area?: string;
  beginArea?: string;
  formed?: string; // begin date
  disbanded?: string; // end date
  active?: string; // "1991–present"
  members?: string[];
  formerMembers?: string[];
  albumCount?: number | string;
  fans?: number | string;
  deezerId?: number | string;
  musicbrainzId?: string;
}

export interface MediaTypeMap {
  book: Book;
  movie: Movie;
  series: Series;
  album: Album;
  track: Track;
  artist: Artist;
}

export type MediaItem = Book | Movie | Series | Album | Track | Artist;

/**
 * A search hit. The note data lives in `item`; everything else is search
 * bookkeeping that must never leak into the note.
 */
export interface SearchResult<T extends MediaItem = MediaItem> {
  item: T;
  source: string; // provider label, e.g. "Hardcover"
  sourceId?: string | number;
  popularity?: number; // raw provider popularity (ratings count, fans, vote count...)
  position?: number; // index in the provider's own ranking
  score?: number; // computed by the ranker, 0..1
  sources?: string[]; // after merging duplicates across providers
  details?: Record<string, unknown>; // provider-specific data needed to load details later
}
