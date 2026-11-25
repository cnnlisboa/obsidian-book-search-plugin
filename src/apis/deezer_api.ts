import { apiGet } from '@apis/base_api';
import { Album, Artist, SearchResult, Track } from '@models/media.model';
import { ParsedQuery } from '@src/search/query_parser';
import { unique } from './tmdb_api';

const BASE_URL = 'https://api.deezer.com';
export const DEEZER_SOURCE = 'Deezer';
const LIMIT = 25;

interface DeezerArtistRef {
  id: number;
  name: string;
  picture_xl?: string;
  picture_big?: string;
  picture_medium?: string;
  picture_small?: string;
}

interface DeezerAlbumRef {
  id: number;
  title: string;
  cover_xl?: string;
  cover_big?: string;
  cover_medium?: string;
  cover_small?: string;
  release_date?: string;
}

interface DeezerAlbum extends DeezerAlbumRef {
  link: string;
  nb_tracks?: number;
  record_type?: string;
  explicit_lyrics?: boolean;
  artist: DeezerArtistRef;
  // details only
  upc?: string;
  label?: string;
  duration?: number;
  fans?: number;
  genres?: { data: { name: string }[] };
  contributors?: DeezerArtistRef[];
  tracks?: { data: { title: string; duration: number }[] };
}

interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  link: string;
  duration: number;
  rank?: number;
  explicit_lyrics?: boolean;
  preview?: string;
  artist: DeezerArtistRef;
  album: DeezerAlbumRef;
  // details only
  isrc?: string;
  track_position?: number;
  disk_number?: number;
  release_date?: string;
  bpm?: number;
  contributors?: DeezerArtistRef[];
}

interface DeezerArtist extends DeezerArtistRef {
  link: string;
  nb_album?: number;
  nb_fan?: number;
}

interface DeezerList<T> {
  data?: T[];
  error?: { message: string };
}

export function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const quote = (text: string) => `"${text.replace(/"/g, '')}"`;

/** Deezer: free, no key, good covers and popularity data. */
export class DeezerApi {
  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    // without this Deezer localises genre names by IP ("Alternativo")
    const response = await apiGet<T & { error?: { message?: string } }>(`${BASE_URL}${path}`, params, {
      'Accept-Language': 'en',
    });
    if (response?.error) throw new Error(`Deezer: ${response.error.message ?? 'request failed'}`);
    return response;
  }

  /** Runs the free-text search plus a field search ("artist:… album:…") when we know both parts. */
  private async searchBoth<T extends { id: number }>(
    kind: 'album' | 'track' | 'artist',
    parsed: ParsedQuery,
  ): Promise<{ hit: T; position: number }[]> {
    const field = kind === 'track' ? 'track' : kind === 'album' ? 'album' : '';
    const queries: string[] = [parsed.terms || parsed.text];
    if (field && parsed.title && parsed.creator) {
      // "Artist - Album" is the usual convention, "Album by Artist" is explicit
      const [artist, title] = parsed.ambiguousOrder ? [parsed.title, parsed.creator] : [parsed.creator, parsed.title];
      queries.unshift(`artist:${quote(artist)} ${field}:${quote(title)}`);
      if (parsed.ambiguousOrder) queries.push(`artist:${quote(title)} ${field}:${quote(artist)}`);
    }

    const seen = new Set<number>();
    const results: { hit: T; position: number }[] = [];
    for (const q of queries.filter(Boolean)) {
      const response = await this.get<DeezerList<T>>(`/search/${kind}`, { q, limit: LIMIT });
      (response.data ?? []).forEach((hit, position) => {
        if (seen.has(hit.id)) return;
        seen.add(hit.id);
        results.push({ hit, position });
      });
    }
    return results;
  }

  async searchAlbums(parsed: ParsedQuery): Promise<SearchResult<Album>[]> {
    if (parsed.deezer?.kind === 'album') {
      const album = await this.get<DeezerAlbum>(`/album/${parsed.deezer.id}`);
      return [{ item: this.toAlbum(album), source: DEEZER_SOURCE, sourceId: album.id, position: 0 }];
    }
    const hits = await this.searchBoth<DeezerAlbum>('album', parsed);
    return hits.map(({ hit, position }) => ({
      item: this.toAlbum(hit),
      source: DEEZER_SOURCE,
      sourceId: hit.id,
      position,
    }));
  }

  async searchTracks(parsed: ParsedQuery): Promise<SearchResult<Track>[]> {
    if (parsed.deezer?.kind === 'track') {
      const track = await this.get<DeezerTrack>(`/track/${parsed.deezer.id}`);
      return [{ item: this.toTrack(track), source: DEEZER_SOURCE, sourceId: track.id, position: 0 }];
    }
    const hits = await this.searchBoth<DeezerTrack>('track', parsed);
    return hits.map(({ hit, position }) => ({
      item: this.toTrack(hit),
      source: DEEZER_SOURCE,
      sourceId: hit.id,
      position,
      popularity: hit.rank ?? 0,
    }));
  }

  async searchArtists(parsed: ParsedQuery): Promise<SearchResult<Artist>[]> {
    if (parsed.deezer?.kind === 'artist') {
      const artist = await this.get<DeezerArtist>(`/artist/${parsed.deezer.id}`);
      return [{ item: this.toArtist(artist), source: DEEZER_SOURCE, sourceId: artist.id, position: 0 }];
    }
    const hits = await this.searchBoth<DeezerArtist>('artist', parsed);
    return hits.map(({ hit, position }) => ({
      item: this.toArtist(hit),
      source: DEEZER_SOURCE,
      sourceId: hit.id,
      position,
      popularity: hit.nb_fan ?? 0,
    }));
  }

  async albumDetails(id: number | string, base: Album): Promise<Album> {
    const album = await this.get<DeezerAlbum>(`/album/${id}`);
    return { ...base, ...this.toAlbum(album) };
  }

  async trackDetails(id: number | string, base: Track): Promise<Track> {
    const track = await this.get<DeezerTrack>(`/track/${id}`);
    const item = { ...base, ...this.toTrack(track) };
    // genres only live on the album
    if (track.album?.id) {
      try {
        const album = await this.get<DeezerAlbum>(`/album/${track.album.id}`);
        const genres = (album.genres?.data ?? []).map(g => g.name);
        item.genres = genres;
        item.genre = genres.join(', ');
        item.releaseDate = item.releaseDate || album.release_date || '';
        item.year = item.releaseDate.slice(0, 4);
      } catch (error) {
        console.warn('[Media Search] Deezer album lookup failed', error);
      }
    }
    return item;
  }

  async artistDetails(id: number | string, base: Artist): Promise<Artist> {
    const artist = await this.get<DeezerArtist>(`/artist/${id}`);
    return { ...base, ...this.toArtist(artist) };
  }

  private toAlbum(a: DeezerAlbum): Album {
    const artists = unique([a.artist?.name, ...(a.contributors ?? []).map(c => c.name)]);
    const genres = (a.genres?.data ?? []).map(g => g.name);
    const tracks = (a.tracks?.data ?? []).map(t => t.title);
    const item: Album = {
      title: a.title,
      artist: a.artist?.name ?? '',
      artists,
      year: a.release_date?.slice(0, 4) ?? '',
      releaseDate: a.release_date ?? '',
      albumType: a.record_type ?? '',
      trackCount: a.nb_tracks ?? '',
      explicit: a.explicit_lyrics ?? false,
      coverUrl: a.cover_big ?? a.cover_medium ?? '',
      coverSmallUrl: a.cover_small ?? '',
      coverMediumUrl: a.cover_medium ?? '',
      coverLargeUrl: a.cover_xl ?? a.cover_big ?? '',
      link: a.link ?? `https://www.deezer.com/album/${a.id}`,
      deezerId: a.id,
    };
    if (a.genres) {
      item.genres = genres;
      item.genre = genres.join(', ');
    }
    if (a.label !== undefined) item.label = a.label;
    if (a.upc !== undefined) item.upc = a.upc;
    if (a.duration) {
      item.durationSeconds = a.duration;
      item.duration = formatDuration(a.duration);
    }
    if (a.tracks) {
      item.tracks = tracks;
      item.tracklist = (a.tracks.data ?? [])
        .map((t, i) => `${i + 1}. ${t.title}${t.duration ? ` (${formatDuration(t.duration)})` : ''}`)
        .join('\n');
    }
    return item;
  }

  private toTrack(t: DeezerTrack): Track {
    const artists = unique([t.artist?.name, ...(t.contributors ?? []).map(c => c.name)]);
    const releaseDate = t.release_date ?? t.album?.release_date ?? '';
    const item: Track = {
      title: t.title,
      artist: t.artist?.name ?? '',
      artists,
      album: t.album?.title ?? '',
      year: releaseDate.slice(0, 4),
      releaseDate,
      duration: formatDuration(t.duration),
      durationSeconds: t.duration,
      explicit: t.explicit_lyrics ?? false,
      previewUrl: t.preview ?? '',
      coverUrl: t.album?.cover_big ?? t.album?.cover_medium ?? '',
      coverSmallUrl: t.album?.cover_small ?? '',
      coverMediumUrl: t.album?.cover_medium ?? '',
      coverLargeUrl: t.album?.cover_xl ?? t.album?.cover_big ?? '',
      link: t.link ?? `https://www.deezer.com/track/${t.id}`,
      deezerId: t.id,
    };
    if (t.isrc) item.isrc = t.isrc;
    if (t.track_position) item.trackNumber = t.track_position;
    if (t.disk_number) item.discNumber = t.disk_number;
    if (t.bpm) item.bpm = t.bpm;
    return item;
  }

  private toArtist(a: DeezerArtist): Artist {
    return {
      title: a.name,
      name: a.name,
      albumCount: a.nb_album ?? '',
      fans: a.nb_fan ?? '',
      coverUrl: a.picture_big ?? a.picture_medium ?? '',
      coverSmallUrl: a.picture_small ?? '',
      coverMediumUrl: a.picture_medium ?? '',
      coverLargeUrl: a.picture_xl ?? a.picture_big ?? '',
      link: a.link ?? `https://www.deezer.com/artist/${a.id}`,
      deezerId: a.id,
    };
  }
}
