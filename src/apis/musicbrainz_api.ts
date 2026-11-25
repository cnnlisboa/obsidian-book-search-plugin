import { Album, Artist } from '@models/media.model';
import { normalize } from '@src/search/ranking';
import { requestUrl } from 'obsidian';
import { unique } from './tmdb_api';

const BASE_URL = 'https://musicbrainz.org/ws/2';
// MusicBrainz asks every client to identify itself; anonymous agents get throttled.
const USER_AGENT = 'MediaSearchObsidianPlugin/1.0 ( https://github.com/connradolisboa/obsidian-book-search-plugin )';
const MIN_INTERVAL_MS = 1100; // MusicBrainz allows ~1 request per second
const MAX_RETRIES = 3;

let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Serialises requests so bulk imports never exceed the rate limit. */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const delay = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (delay > 0) await wait(delay);
    lastRequest = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function mbGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries({ ...params, fmt: 'json' }).forEach(([k, v]) => url.searchParams.append(k, v));

  for (let attempt = 0; ; attempt++) {
    const response = await schedule(() =>
      requestUrl({
        url: url.href,
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        throw: false,
      }),
    );
    if (response.status === 200) return response.json as T;
    if ((response.status === 503 || response.status === 429) && attempt < MAX_RETRIES) {
      await wait(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`MusicBrainz: HTTP ${response.status}`);
  }
}

interface MbLifeSpan {
  begin?: string | null;
  end?: string | null;
  ended?: boolean | null;
}

interface MbTag {
  name: string;
  count?: number;
}

interface MbArtist {
  id: string;
  name: string;
  type?: string;
  country?: string;
  score?: number;
  area?: { name: string };
  'begin-area'?: { name: string };
  'life-span'?: MbLifeSpan;
  genres?: MbTag[];
  tags?: MbTag[];
  relations?: {
    type: string;
    direction: 'forward' | 'backward';
    ended?: boolean;
    artist?: { name: string };
  }[];
}

interface MbReleaseGroup {
  id: string;
  title: string;
  score?: number;
  'primary-type'?: string;
  'first-release-date'?: string;
  'artist-credit'?: { name: string }[];
  genres?: MbTag[];
  tags?: MbTag[];
}

const escapeLucene = (text: string) => text.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

function topGenres(entity: { genres?: MbTag[]; tags?: MbTag[] }, max = 5): string[] {
  const source = entity.genres?.length ? entity.genres : entity.tags ?? [];
  return [...source]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, max)
    .map(g => g.name.replace(/\b\w/g, c => c.toUpperCase()));
}

/** MusicBrainz: open music encyclopedia. Adds what Deezer lacks: country, years active, members, detailed genres. */
export class MusicBrainzApi {
  async enrichArtist(artist: Artist): Promise<Artist> {
    try {
      const found = await mbGet<{ artists: MbArtist[] }>('/artist', {
        query: `artist:"${escapeLucene(artist.title)}"`,
        limit: '5',
      });
      const wanted = normalize(artist.title);
      const match =
        found.artists?.find(a => normalize(a.name) === wanted && (a.score ?? 0) >= 90) ??
        found.artists?.find(a => (a.score ?? 0) >= 98);
      if (!match) return artist;

      const d = await mbGet<MbArtist>(`/artist/${match.id}`, { inc: 'artist-rels genres tags' });
      const memberRels = (d.relations ?? []).filter(r => r.type === 'member of band' && r.direction === 'backward');
      const members = unique(memberRels.filter(r => !r.ended).map(r => r.artist?.name ?? ''));
      const formerMembers = unique(memberRels.filter(r => r.ended).map(r => r.artist?.name ?? '')).filter(
        name => !members.includes(name),
      );
      const genres = topGenres(d);
      const begin = d['life-span']?.begin ?? '';
      const end = d['life-span']?.end ?? '';
      const ended = d['life-span']?.ended ?? false;
      const beginYear = begin.slice(0, 4);

      return {
        ...artist,
        artistType: d.type ?? '',
        country: d.area?.name ?? d.country ?? '',
        area: d.area?.name ?? '',
        beginArea: d['begin-area']?.name ?? '',
        formed: begin,
        disbanded: end,
        active: beginYear ? `${beginYear}–${ended ? end.slice(0, 4) : 'present'}` : '',
        genres: genres.length ? genres : artist.genres ?? [],
        genre: (genres.length ? genres : artist.genres ?? []).join(', '),
        members,
        formerMembers,
        musicbrainzId: d.id,
      };
    } catch (error) {
      console.warn('[Media Search] MusicBrainz artist lookup failed', error);
      return artist;
    }
  }

  /** Deezer album genres are very broad ("Pop"); MusicBrainz has real ones ("art rock, britpop"). */
  async enrichAlbum(album: Album): Promise<Album> {
    try {
      const artist = album.artist ?? '';
      const found = await mbGet<{ 'release-groups': MbReleaseGroup[] }>('/release-group', {
        query: `releasegroup:"${escapeLucene(album.title)}"${artist ? ` AND artist:"${escapeLucene(artist)}"` : ''}`,
        limit: '5',
      });
      const match = (found['release-groups'] ?? []).find(rg => (rg.score ?? 0) >= 90);
      if (!match) return album;

      const d = await mbGet<MbReleaseGroup>(`/release-group/${match.id}`, { inc: 'genres tags' });
      const genres = topGenres(d);
      const firstRelease = d['first-release-date'] ?? '';
      return {
        ...album,
        genres: genres.length ? genres : album.genres,
        genre: genres.length ? genres.join(', ') : album.genre,
        // Deezer dates are often the remaster; MusicBrainz has the original release
        year: firstRelease.slice(0, 4) || album.year,
        releaseDate: firstRelease || album.releaseDate,
        musicbrainzId: d.id,
      };
    } catch (error) {
      console.warn('[Media Search] MusicBrainz album lookup failed', error);
      return album;
    }
  }
}
