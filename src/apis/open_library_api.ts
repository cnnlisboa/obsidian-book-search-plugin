import { apiGet } from '@apis/base_api';
import { Book } from '@models/book.model';
import { SearchResult } from '@models/media.model';
import { ParsedQuery } from '@src/search/query_parser';

interface OpenLibraryDoc {
  key: string; // "/works/OL893415W"
  title: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  subject?: string[];
  ratings_count?: number;
  edition_count?: number;
  want_to_read_count?: number;
  already_read_count?: number;
}

interface OpenLibrarySearchResponse {
  numFound: number;
  docs: OpenLibraryDoc[];
}

interface OpenLibraryWork {
  description?: string | { value: string };
  subjects?: string[];
}

const SEARCH_URL = 'https://openlibrary.org/search.json';
const FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  'first_publish_year',
  'isbn',
  'publisher',
  'number_of_pages_median',
  'cover_i',
  'subject',
  'ratings_count',
  'edition_count',
  'want_to_read_count',
  'already_read_count',
].join(',');

export const OPEN_LIBRARY_SOURCE = 'Open Library';

const GENRE_WORDS =
  /^(fiction|nonfiction|non-fiction|science fiction|fantasy|horror|mystery|thriller|romance|biography|autobiography|memoir|history|philosophy|psychology|poetry|drama|classics?|dystopian?|satire|humor|self-help|business|economics|politics|religion|spirituality|science|essays?|adventure|crime|historical fiction|literary fiction|young adult|children'?s|graphic novels?|comics|short stories)(\b.*)?$/i;

/** Open Library: free, no key, good coverage of older and non-English books. */
export class OpenLibraryApi {
  async search(parsed: ParsedQuery, limit = 20): Promise<SearchResult<Book>[]> {
    const params: Record<string, string | number> = { fields: FIELDS, limit };
    if (parsed.isbn) {
      params.isbn = parsed.isbn;
    } else if (parsed.title && parsed.creator && !parsed.ambiguousOrder) {
      params.title = parsed.title;
      params.author = parsed.creator;
    } else {
      params.q = parsed.terms || parsed.text;
    }

    let response = await apiGet<OpenLibrarySearchResponse>(SEARCH_URL, params);
    // structured search too strict? fall back to free text
    if (!response?.docs?.length && (params.title || params.isbn) && parsed.text) {
      response = await apiGet<OpenLibrarySearchResponse>(SEARCH_URL, { fields: FIELDS, limit, q: parsed.text });
    }

    return (response?.docs ?? []).map((doc, position) => ({
      item: this.toBook(doc, parsed.isbn),
      source: OPEN_LIBRARY_SOURCE,
      sourceId: doc.key,
      position,
      popularity:
        (doc.ratings_count ?? 0) * 5 +
        (doc.want_to_read_count ?? 0) +
        (doc.already_read_count ?? 0) +
        (doc.edition_count ?? 0) * 3,
      details: { workKey: doc.key },
    }));
  }

  /** Search results don't include the description; fetch it from the work. */
  async loadDescription(workKey: string): Promise<string> {
    try {
      const work = await apiGet<OpenLibraryWork>(`https://openlibrary.org${workKey}.json`);
      const description = typeof work?.description === 'string' ? work.description : work?.description?.value;
      return (description ?? '').replace(/\r?\n+/g, ' ').trim();
    } catch (error) {
      console.warn('[Media Search] Open Library work lookup failed', error);
      return '';
    }
  }

  private toBook(doc: OpenLibraryDoc, wantedIsbn?: string): Book {
    const authors = doc.author_name ?? [];
    // a work lists every edition's ISBN; only keep one if it's the one that was searched for
    const isbns = wantedIsbn ? (doc.isbn ?? []).filter(i => i === wantedIsbn) : [];
    const isbn13 = isbns.find(i => i.length === 13) ?? '';
    const isbn10 = isbns.find(i => i.length === 10) ?? '';
    const cover = (size: 'S' | 'M' | 'L') =>
      doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-${size}.jpg` : '';
    // subjects are mostly tags ("aversion therapy"); keep only genre-like ones
    const categories = Array.from(
      new Set(
        (doc.subject ?? [])
          .filter(subject => GENRE_WORDS.test(subject) && subject.length <= 30 && !/[,:(]/.test(subject))
          .map(subject => subject.replace(/\b\w/g, c => c.toUpperCase())),
      ),
    ).slice(0, 4);

    return {
      title: doc.title ?? '',
      subtitle: doc.subtitle ?? '',
      author: authors.join(', '),
      authors,
      category: categories.join(', '),
      categories,
      publisher: doc.publisher?.[0] ?? '',
      publishDate: doc.first_publish_year ? String(doc.first_publish_year) : '',
      totalPage: doc.number_of_pages_median ?? '',
      coverUrl: cover('M'),
      coverSmallUrl: cover('S'),
      coverMediumUrl: cover('M'),
      coverLargeUrl: cover('L'),
      description: '',
      link: `https://openlibrary.org${doc.key}`,
      isbn10,
      isbn13,
    };
  }
}
