import { apiPost, BaseBooksApiImpl } from '@apis/base_api';
import { Book } from '@models/book.model';
import { SearchResult } from '@models/media.model';
import { HardcoverBookDocument, HardcoverSearchResponse } from './models/hardcover_books_response';

const HARDCOVER_GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';
const MAX_RESULTS = 20;

const SEARCH_QUERY = `
  query SearchBooks($query: String!, $perPage: Int!) {
    search(query: $query, query_type: "Book", per_page: $perPage) {
      results
    }
  }
`;

export class HardcoverBooksApi implements BaseBooksApiImpl {
  readonly sourceName = 'Hardcover';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    // Hardcover's account page shows the token pre-fixed with "Bearer ",
    // so strip it (and any stray whitespace) to avoid double-prefixing the header.
    this.apiKey = apiKey.trim().replace(/^Bearer\s+/i, '');
  }

  async getByQuery(query: string): Promise<Book[]> {
    return (await this.getResults(query)).map(result => result.item);
  }

  async getResults(query: string): Promise<SearchResult<Book>[]> {
    try {
      const response = await apiPost<HardcoverSearchResponse>(
        HARDCOVER_GRAPHQL_URL,
        {
          query: SEARCH_QUERY,
          variables: { query, perPage: MAX_RESULTS },
        },
        { Authorization: `Bearer ${this.apiKey}` },
      );

      const hits = response?.data?.search?.results?.hits;
      if (!hits?.length) return [];
      return hits.map((hit, position) => ({
        item: this.createBookItem(hit.document),
        source: this.sourceName,
        sourceId: hit.document.id,
        position,
        popularity: (hit.document.users_count ?? 0) + (hit.document.ratings_count ?? 0) * 2,
      }));
    } catch (error) {
      console.warn(error);
      throw error;
    }
  }

  private extractAuthors(doc: HardcoverBookDocument): string[] {
    const fromContributions = doc.contributions?.map(c => c.author?.name).filter(Boolean) ?? [];
    return fromContributions.length ? fromContributions : doc.author_names ?? [];
  }

  private sanitizeDescription(text: string): string {
    return (text ?? '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/["':;]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private createBookItem(doc: HardcoverBookDocument): Book {
    const authors = this.extractAuthors(doc);
    const coverUrl = doc.image?.url ?? '';
    const isbns = doc.isbns ?? [];

    return {
      title: doc.title ?? '',
      subtitle: doc.subtitle ?? '',
      author: authors.join(', '),
      authors,
      category: doc.genres?.join(', ') ?? '',
      categories: doc.genres ?? [],
      publisher: '',
      publishDate: doc.release_date ?? (doc.release_year ? String(doc.release_year) : ''),
      totalPage: doc.pages ?? '',
      coverUrl,
      coverSmallUrl: '',
      coverMediumUrl: '',
      coverLargeUrl: coverUrl,
      description: this.sanitizeDescription(doc.description ?? ''),
      link: doc.slug ? `https://hardcover.app/books/${doc.slug}` : '',
      previewLink: '',
      isbn13: isbns.find(isbn => isbn.length === 13) ?? '',
      isbn10: isbns.find(isbn => isbn.length === 10) ?? '',
    };
  }
}
