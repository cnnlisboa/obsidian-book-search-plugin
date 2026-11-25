import { parseQuery } from './query_parser';
import { isConfident, matchScore, rankResults, titleSimilarity } from './ranking';
import { BOOK_JUNK } from '@src/media/book_search';

jest.mock('@apis/base_api', () => ({}));
jest.mock('@apis/google_books_api', () => ({}));
jest.mock('@apis/hardcover_books_api', () => ({}));
jest.mock('@apis/open_library_api', () => ({ OPEN_LIBRARY_SOURCE: 'Open Library' }));

describe('titleSimilarity', () => {
  it('ignores case, accents, punctuation and leading articles', () => {
    expect(titleSimilarity('the hobbit', 'Hobbit')).toBe(1);
    expect(titleSimilarity('Cien años de soledad', 'Cien anos de soledad')).toBe(1);
    expect(titleSimilarity("Ender's Game", 'Enders Game')).toBe(1);
  });

  it('tolerates typos', () => {
    expect(titleSimilarity('Neuromacer', 'Neuromancer')).toBeGreaterThan(0.75);
  });
});

describe('matchScore', () => {
  it('matches either order for "A - B"', () => {
    const parsed = parseQuery('Radiohead - OK Computer');
    expect(matchScore(parsed, { title: 'OK Computer', creators: ['Radiohead'] })).toBeGreaterThan(0.9);
  });

  it('accepts a surname for the author', () => {
    const parsed = parseQuery('Dune by Herbert');
    expect(matchScore(parsed, { title: 'Dune', creators: ['Frank Herbert'] })).toBeGreaterThan(0.9);
  });

  it('falls back to free text when "by" is part of the title', () => {
    const parsed = parseQuery('Stand by Me');
    expect(matchScore(parsed, { title: 'Stand by Me', creators: ['Ben E. King'] })).toBeGreaterThan(0.85);
  });
});

describe('rankResults', () => {
  const fields = (r: { title: string; author: string; year?: number }) => ({
    title: r.title,
    creators: [r.author],
    year: r.year,
    junkText: `${r.title} ${r.author}`,
  });

  it('puts the real book above summaries and the wrong author', () => {
    const results = [
      { title: 'Summary of Dune', author: 'QuickRead', popularity: 50 },
      { title: 'Dune Messiah', author: 'Frank Herbert', popularity: 5000 },
      { title: 'Dune', author: 'Frank Herbert', popularity: 9000 },
      { title: 'Dune', author: 'Someone Else', popularity: 2 },
    ];
    const ranked = rankResults(parseQuery('dune herbert'), results, fields, { junkPattern: BOOK_JUNK });
    expect(ranked[0]).toMatchObject({ title: 'Dune', author: 'Frank Herbert' });
    expect(ranked[ranked.length - 1].title).toBe('Summary of Dune');
    expect(isConfident(ranked)).toBe(true);
    expect(isConfident([{ score: 0.92 }, { score: 0.9 }], () => true)).toBe(true);
  });

  it('uses the year to pick between remakes', () => {
    const results = [
      { title: 'Dune', author: '', year: 2021, popularity: 12000 },
      { title: 'Dune', author: '', year: 1984, popularity: 3000 },
    ];
    const ranked = rankResults(parseQuery('Dune (1984)'), results, r => ({ title: r.title, year: r.year }), {
      yearWeight: 0.1,
    });
    expect(ranked[0].year).toBe(1984);
  });

  it('is not confident when two different results tie', () => {
    const results = [
      { title: 'Solaris', author: '', year: 1972, popularity: 100 },
      { title: 'Solaris', author: '', year: 2002, popularity: 110 },
    ];
    const ranked = rankResults(parseQuery('Solaris'), results, r => ({ title: r.title, year: r.year }));
    expect(isConfident(ranked)).toBe(false);
  });

  it('does not penalise junk words the user asked for', () => {
    const results: { title: string; author: string; score?: number }[] = [{ title: 'Dune Study Guide', author: 'X' }];
    const ranked = rankResults(parseQuery('dune study guide'), results, fields, { junkPattern: BOOK_JUNK });
    expect(ranked[0].score).toBeGreaterThan(0.7);
  });
});
