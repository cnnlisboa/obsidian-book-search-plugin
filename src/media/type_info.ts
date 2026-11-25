import { MediaType } from '@models/media.model';

export interface MediaTypeInfo {
  label: string; // "Book"
  plural: string; // "Books"
  noun: string; // used in commands: "Create {noun} note"
  icon: string; // lucide icon name
  defaultFileNameFormat: string;
  placeholder: string;
  /** Variables suggested in the file name field. */
  variables: string[];
}

export const MEDIA_TYPE_INFO: Record<MediaType, MediaTypeInfo> = {
  book: {
    label: 'Book',
    plural: 'Books',
    noun: 'book',
    icon: 'book',
    defaultFileNameFormat: '{{title}} - {{author}}',
    placeholder: 'Title, author or ISBN — e.g. Dune by Frank Herbert',
    variables: ['title', 'author', 'publishDate', 'publisher'],
  },
  movie: {
    label: 'Movie',
    plural: 'Movies',
    noun: 'movie',
    icon: 'film',
    defaultFileNameFormat: '{{title}} ({{year}})',
    placeholder: 'Title, year or IMDb link — e.g. Heat 1995',
    variables: ['title', 'year', 'director'],
  },
  series: {
    label: 'TV show',
    plural: 'TV shows',
    noun: 'TV show',
    icon: 'tv',
    defaultFileNameFormat: '{{title}} ({{yearRange}})',
    placeholder: 'Title, year or IMDb link — e.g. Better Call Saul',
    variables: ['title', 'year', 'yearRange', 'creator'],
  },
  album: {
    label: 'Album',
    plural: 'Albums',
    noun: 'album',
    icon: 'disc',
    defaultFileNameFormat: '{{title}} ({{artist}})',
    placeholder: 'Album and artist — e.g. Radiohead - OK Computer',
    variables: ['title', 'artist', 'year'],
  },
  track: {
    label: 'Song',
    plural: 'Songs',
    noun: 'song',
    icon: 'music',
    defaultFileNameFormat: '{{title}} ({{artist}})',
    placeholder: 'Song and artist — e.g. Paranoid Android by Radiohead',
    variables: ['title', 'artist', 'album', 'year'],
  },
  artist: {
    label: 'Artist / band',
    plural: 'Artists',
    noun: 'artist',
    icon: 'mic',
    defaultFileNameFormat: '{{title}}',
    placeholder: 'Artist or band — e.g. Radiohead',
    variables: ['title', 'country', 'formed'],
  },
};
