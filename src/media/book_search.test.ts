import { SearchResult } from '@models/media.model';
import { Book } from '@models/book.model';
import { mergeDuplicateBooks } from './book_search';

jest.mock('@apis/base_api', () => ({}));
jest.mock('@apis/google_books_api', () => ({}));
jest.mock('@apis/hardcover_books_api', () => ({}));
jest.mock('@apis/open_library_api', () => ({ OPEN_LIBRARY_SOURCE: 'Open Library' }));

const result = (source: string, item: Partial<Book>, popularity = 0): SearchResult<Book> => ({
  source,
  popularity,
  item: { title: '', author: '', authors: [], ...item } as Book,
});

describe('mergeDuplicateBooks', () => {
  it('merges editions of the same work and fills gaps from the others', () => {
    const merged = mergeDuplicateBooks([
      result('Hardcover', { title: 'Dune', authors: ['Frank Herbert'], coverLargeUrl: 'hc.jpg' }, 100),
      result(
        'Google Books',
        { title: 'Dune: Deluxe Edition', authors: ['Frank Herbert'], isbn13: '9780593099322', description: 'Desc' },
        900,
      ),
      result('Open Library', { title: 'Dune Messiah', authors: ['Frank Herbert'] }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].item).toMatchObject({
      title: 'Dune',
      coverLargeUrl: 'hc.jpg',
      description: 'Desc',
      isbn13: '9780593099322',
    });
    expect(merged[0].sources).toEqual(['Hardcover', 'Google Books']);
    expect(merged[0].popularity).toBe(900);
  });

  it('merges by ISBN even if titles differ', () => {
    const merged = mergeDuplicateBooks([
      result('Google Books', { title: 'Flow', authors: ['Mihaly Csikszentmihalyi'], isbn10: '0061876720' }),
      result('Open Library', {
        title: 'Flow: The Psychology of Optimal Experience',
        authors: ['M. Csikszentmihalyi'],
        isbn13: '9780061876721',
      }),
    ]);
    expect(merged).toHaveLength(1);
  });
});
