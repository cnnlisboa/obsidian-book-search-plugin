import { cleanListLine, isbn10To13, parseList, parseQuery } from './query_parser';

describe('cleanListLine', () => {
  it.each([
    ['- Dune', 'Dune'],
    ['1. Dune', 'Dune'],
    ['12) Dune', 'Dune'],
    ['- [ ] Dune', 'Dune'],
    ['- [x] Dune', 'Dune'],
    ['* [[Dune]]', 'Dune'],
    ['[[Dune (Frank Herbert)|Dune]]', 'Dune (Frank Herbert)'],
    ['**Dune**', 'Dune'],
    ['"Dune"', 'Dune'],
    ['Dune ⭐⭐⭐⭐', 'Dune'],
    ['Dune - 4/5', 'Dune'],
    ['Dune #scifi #toread', 'Dune'],
    ['[Fight Club](https://www.imdb.com/title/tt0137523/)', 'https://www.imdb.com/title/tt0137523/'],
    ['[Fight Club](https://example.com)', 'Fight Club'],
  ])('%s → %s', (input, expected) => {
    expect(cleanListLine(input)).toBe(expected);
  });
});

describe('parseQuery', () => {
  it('splits "Title by Author"', () => {
    const q = parseQuery('Dune by Frank Herbert');
    expect(q).toMatchObject({ title: 'Dune', creator: 'Frank Herbert', ambiguousOrder: false });
    expect(q.terms).toBe('Dune Frank Herbert');
  });

  it('uses the last " by " so titles containing "by" survive', () => {
    expect(parseQuery('Stand by Me by Ben E. King')).toMatchObject({ title: 'Stand by Me', creator: 'Ben E. King' });
  });

  it('reads the default note name "Title (Author)"', () => {
    expect(parseQuery('A Clockwork Orange (Anthony Burgess)')).toMatchObject({
      title: 'A Clockwork Orange',
      creator: 'Anthony Burgess',
    });
  });

  it('treats "A - B" as an ambiguous pair', () => {
    expect(parseQuery('Radiohead - OK Computer')).toMatchObject({
      title: 'Radiohead',
      creator: 'OK Computer',
      ambiguousOrder: true,
    });
  });

  it('extracts years in brackets and at the end', () => {
    expect(parseQuery('Fight Club (1999)')).toMatchObject({ text: 'Fight Club', year: 1999 });
    expect(parseQuery('Heat 1995')).toMatchObject({ text: 'Heat', year: 1995 });
    expect(parseQuery('Better Call Saul (2015–2022)')).toMatchObject({ text: 'Better Call Saul', year: 2015 });
    expect(parseQuery('Fallout (2024–)')).toMatchObject({ text: 'Fallout', year: 2024 });
  });

  it('keeps numbers that are part of the title', () => {
    expect(parseQuery('1984')).toMatchObject({ text: '1984' });
    expect(parseQuery('1984').year).toBeUndefined();
    expect(parseQuery('Blade Runner 2049').year).toBeUndefined();
    expect(parseQuery('Fahrenheit 451').year).toBeUndefined();
  });

  it('detects ISBNs', () => {
    expect(parseQuery('978-0-441-01359-3').isbn).toBe('9780441013593');
    expect(parseQuery('ISBN: 0441013597').isbn).toBe('0441013597');
  });

  it('detects IMDb, TMDB and Deezer links', () => {
    expect(parseQuery('https://www.imdb.com/title/tt0137523/').imdbId).toBe('tt0137523');
    expect(parseQuery('https://www.themoviedb.org/tv/1396-breaking-bad').tmdb).toEqual({ kind: 'tv', id: '1396' });
    expect(parseQuery('https://www.deezer.com/en/album/14879699').deezer).toEqual({ kind: 'album', id: '14879699' });
  });
});

describe('isbn10To13', () => {
  it('converts with the right check digit', () => {
    expect(isbn10To13('0441013597')).toBe('9780441013593');
  });
});

describe('parseList', () => {
  it('skips headings, blanks and duplicates', () => {
    expect(parseList('# Books\n\n- Dune\n- Dune\n- Neuromancer\n---\n')).toEqual(['- Dune', '- Neuromancer']);
  });

  it('turns table rows into "a - b"', () => {
    expect(parseList('| Title | Author |\n|---|---|\n| Dune | Frank Herbert |')).toEqual([
      'Title - Author',
      'Dune - Frank Herbert',
    ]);
  });

  it('splits a single line on semicolons', () => {
    expect(parseList('Dune; Neuromancer; Foundation')).toEqual(['Dune', 'Neuromancer', 'Foundation']);
  });
});
