import { apiGet, BaseBooksApiImpl } from '@apis/base_api';
import { Book } from '@models/book.model';
import { SearchResult } from '@models/media.model';
import { GoogleBooksResponse, VolumeInfo } from './models/google_books_response';

export class GoogleBooksApi implements BaseBooksApiImpl {
  private static readonly MAX_RESULTS = 40;
  private static readonly PRINT_TYPE = 'books';

  readonly sourceName = 'Google Books';

  constructor(
    private readonly localePreference: string,
    private readonly enableCoverImageEdgeCurl: boolean,
    private readonly apiKey?: string,
  ) {}

  private getLanguageRestriction(local: string): string {
    return local === 'default' ? window.moment.locale() : local;
  }

  private buildSearchParams(query: string, options?: Record<string, string>): Record<string, string | number> {
    const params: Record<string, string | number> = {
      q: query,
      maxResults: GoogleBooksApi.MAX_RESULTS,
      printType: GoogleBooksApi.PRINT_TYPE,
      langRestrict: this.getLanguageRestriction(options?.locale || this.localePreference),
    };

    if (this.apiKey) {
      params['key'] = this.apiKey;
    }
    return params;
  }

  async getByQuery(query: string, options?: Record<string, string>): Promise<Book[]> {
    return (await this.getResults(query, options)).map(result => result.item);
  }

  async getResults(query: string, options?: Record<string, string>): Promise<SearchResult<Book>[]> {
    try {
      const params = this.buildSearchParams(query, options);
      const searchResults = await apiGet<GoogleBooksResponse>('https://www.googleapis.com/books/v1/volumes', params);
      if (!searchResults?.totalItems || !searchResults.items) return [];
      return searchResults.items.map(({ id, volumeInfo }, position) => ({
        item: this.createBookItem(volumeInfo),
        source: this.sourceName,
        sourceId: id,
        position,
        popularity: volumeInfo.ratingsCount ?? 0,
      }));
    } catch (error) {
      console.warn(error);
      throw error;
    }
  }

  buildQuery(title: string, creator?: string, isbn?: string): string {
    if (isbn) return `isbn:${isbn}`;
    return creator ? `intitle:${title} inauthor:${creator}` : title;
  }

  private extractISBNs(industryIdentifiers: VolumeInfo['industryIdentifiers']): Record<string, string> {
    return (
      industryIdentifiers?.reduce(
        (result, item) => {
          const isbnType = item.type === 'ISBN_10' ? 'isbn10' : 'isbn13';
          result[isbnType] = item.identifier.trim();
          return result;
        },
        {} as Record<string, string>,
      ) ?? {}
    );
  }

  private extractBasicBookInfo(item: VolumeInfo): Partial<Book> {
    return {
      title: item.title,
      subtitle: item.subtitle,
      author: this.formatList(item.authors),
      authors: item.authors,
      category: this.formatList(item.categories),
      categories: item.categories,
      publisher: item.publisher,
      totalPage: item.pageCount,
      coverUrl: this.setCoverImageEdgeCurl(item.imageLinks?.thumbnail ?? '', this.enableCoverImageEdgeCurl),
      coverSmallUrl: this.setCoverImageEdgeCurl(item.imageLinks?.smallThumbnail ?? '', this.enableCoverImageEdgeCurl),
      publishDate: item.publishedDate || '',
      description: item.description,
      link: item.canonicalVolumeLink || item.infoLink,
      previewLink: item.previewLink,
    };
  }

  public createBookItem(item: VolumeInfo): Book {
    const book: Book = {
      title: '',
      subtitle: '',
      author: '',
      authors: [],
      category: '',
      categories: [],
      publisher: '',
      publishDate: '',
      totalPage: '',
      coverUrl: '',
      coverSmallUrl: '',
      description: '',
      link: '',
      previewLink: '',
      ...this.extractBasicBookInfo(item),
      ...this.extractISBNs(item.industryIdentifiers),
    };
    return book;
  }

  public formatList(list?: string[]): string {
    return list && list.length > 1 ? list.map(item => item.trim()).join(', ') : list?.[0] ?? '';
  }

  private setCoverImageEdgeCurl(url: string, enabled: boolean): string {
    // Edge curl is included in the cover image URL parameters by default,
    // so we need to remove it if it's disabled
    return enabled ? url : url.replace('&edge=curl', '');
  }

  static convertGoogleBookImageURLSize(url: string, zoom: number) {
    return url.replace(/(&zoom)=\d/, `$1=${zoom}`);
  }
}
