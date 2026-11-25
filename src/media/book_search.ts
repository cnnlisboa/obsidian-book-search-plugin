import { BaseBooksApiImpl, factoryServiceProvider } from '@apis/base_api';
import { GoogleBooksApi } from '@apis/google_books_api';
import { HardcoverBooksApi } from '@apis/hardcover_books_api';
import { OPEN_LIBRARY_SOURCE, OpenLibraryApi } from '@apis/open_library_api';
import { Book } from '@models/book.model';
import { SearchResult } from '@models/media.model';
import { BookSearchPluginSettings } from '@settings/settings';
import { ServiceProvider } from '@src/constants';
import { isbn10To13, ParsedQuery } from '@src/search/query_parser';
import { rankResults, tokens } from '@src/search/ranking';

/** Knock-offs that crowd out the real book. Not penalised if the user asked for them. */
export const BOOK_JUNK =
  /\b(summary|summaries|study guide|sparknotes|cliffs ?notes|workbook|analysis of|unofficial|trivia|quiz(zes)?|colou?ring book|conversation starters|teacher'?s guide|reading guide|lit ?charts|book companion|instaread|supersummary|bookrags|quickread|readtrepreneur)\b/i;

const PRIMARY_BONUS = 0.03;

function bookYear(book: Book) {
  const year = parseInt(String(book.publishDate ?? '').slice(0, 4), 10);
  return Number.isNaN(year) ? undefined : year;
}

function bookIsbns(book: Book): string[] {
  const isbns = [book.isbn13, book.isbn10, book.isbn].filter(Boolean) as string[];
  return isbns.map(isbn => (isbn.length === 10 ? isbn10To13(isbn) ?? isbn : isbn));
}

/** Same work if same ISBN, or same main title and same author surname. */
function workKey(book: Book) {
  const mainTitle = tokens(String(book.title ?? '').replace(/\s*[:([].*$/, '')).join(' ');
  const firstAuthor = book.authors?.[0] ?? book.author?.split(',')[0] ?? '';
  const surname = tokens(firstAuthor).pop() ?? '';
  return `${mainTitle}|${surname}`;
}

const FILLABLE: (keyof Book)[] = [
  'subtitle',
  'description',
  'publisher',
  'publishDate',
  'totalPage',
  'isbn10',
  'isbn13',
  'category',
  'categories',
  'coverUrl',
  'coverSmallUrl',
  'coverMediumUrl',
  'coverLargeUrl',
  'previewLink',
];

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Keeps the best-ranked edition of each work and fills its gaps from the others. */
export function mergeDuplicateBooks(results: SearchResult<Book>[]): SearchResult<Book>[] {
  const merged: SearchResult<Book>[] = [];
  const byKey = new Map<string, SearchResult<Book>>();
  const byIsbn = new Map<string, SearchResult<Book>>();

  for (const result of results) {
    const key = workKey(result.item);
    const isbns = bookIsbns(result.item);
    const existing = isbns.map(i => byIsbn.get(i)).find(Boolean) ?? (key !== '|' ? byKey.get(key) : undefined);

    if (!existing) {
      const copy = { ...result, item: { ...result.item }, sources: [result.source] };
      merged.push(copy);
      if (key !== '|') byKey.set(key, copy);
      isbns.forEach(i => byIsbn.set(i, copy));
      continue;
    }

    for (const field of FILLABLE) {
      if (isEmpty(existing.item[field]) && !isEmpty(result.item[field])) {
        (existing.item as unknown as Record<string, unknown>)[field] = result.item[field];
      }
    }
    // more popular across all editions
    existing.popularity = Math.max(existing.popularity ?? 0, result.popularity ?? 0);
    if (!existing.sources?.includes(result.source)) existing.sources?.push(result.source);
    if (result.source === OPEN_LIBRARY_SOURCE && result.details?.workKey && !existing.details?.workKey) {
      existing.details = { ...existing.details, workKey: result.details.workKey };
    }
    isbns.forEach(i => byIsbn.set(i, existing));
  }
  return merged;
}

interface BookSource {
  name: string;
  primary: boolean;
  run: (parsed: ParsedQuery) => Promise<SearchResult<Book>[]>;
}

function providerSource(api: BaseBooksApiImpl, primary: boolean, options?: Record<string, string>): BookSource {
  return {
    name: api.sourceName,
    primary,
    run: async parsed => {
      const queries = new Set<string>();
      if (parsed.isbn) {
        queries.add(api.buildQuery ? api.buildQuery('', undefined, parsed.isbn) : parsed.isbn);
      } else {
        // structured first (Google understands intitle:/inauthor:), then plain words as a safety net
        if (api.buildQuery && parsed.title && parsed.creator && !parsed.ambiguousOrder) {
          queries.add(api.buildQuery(parsed.title, parsed.creator));
        }
        queries.add(parsed.terms || parsed.text);
      }
      const all: SearchResult<Book>[] = [];
      for (const query of queries) {
        if (!query) continue;
        all.push(...(await api.getResults(query, options)));
      }
      return all;
    },
  };
}

function buildSources(settings: BookSearchPluginSettings, locale?: string): BookSource[] {
  const options = locale ? { locale } : undefined;
  const primary = providerSource(factoryServiceProvider(settings), true, options);
  if (!settings.smartBookSearch) return [primary];

  const sources = [primary];
  const provider = settings.serviceProvider;
  const openLibrary = new OpenLibraryApi();
  sources.push({ name: OPEN_LIBRARY_SOURCE, primary: false, run: parsed => openLibrary.search(parsed) });
  if (provider !== ServiceProvider.google) {
    sources.push(
      providerSource(
        new GoogleBooksApi(settings.localePreference, settings.enableCoverImageEdgeCurl, settings.apiKey),
        false,
        options,
      ),
    );
  }
  if (provider !== ServiceProvider.hardcover && settings.hardcoverApiKey) {
    sources.push(providerSource(new HardcoverBooksApi(settings.hardcoverApiKey), false));
  }
  return sources;
}

export async function searchBooks(
  settings: BookSearchPluginSettings,
  parsed: ParsedQuery,
  locale?: string,
): Promise<SearchResult<Book>[]> {
  const sources = buildSources(settings, locale);
  const outcomes = await Promise.allSettled(sources.map(source => source.run(parsed)));

  const results: SearchResult<Book>[] = [];
  const errors: unknown[] = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      outcome.value.forEach(r => (r.details = { ...r.details, primary: sources[i].primary }));
      results.push(...outcome.value);
    } else {
      console.warn(`[Media Search] ${sources[i].name} failed`, outcome.reason);
      errors.push(outcome.reason);
    }
  });
  // every source failed (offline, bad key…): tell the user instead of saying "no results"
  if (!results.length && errors.length === sources.length) throw errors[0];

  const ranked = rankResults(
    parsed,
    results,
    ({ item, details }) => ({
      title: item.title,
      altTitles: item.subtitle ? [`${item.title} ${item.subtitle}`] : [],
      creators: item.authors?.length ? item.authors : item.author ? [item.author] : [],
      year: bookYear(item),
      hasCover: Boolean(item.coverUrl || item.coverLargeUrl),
      hasDescription: Boolean(item.description),
      junkText: `${item.title} ${item.subtitle ?? ''} ${item.author ?? ''}`,
      bonus: details?.primary ? PRIMARY_BONUS : 0,
    }),
    { yearWeight: 0.03, junkPattern: BOOK_JUNK },
  );

  // exact ISBN hit always wins, and is a sure match
  if (parsed.isbn) {
    const wanted = parsed.isbn.length === 10 ? isbn10To13(parsed.isbn) : parsed.isbn;
    ranked.forEach(r => {
      if (bookIsbns(r.item).includes(wanted ?? '')) r.score = Math.max(r.score ?? 0, 0.97);
    });
    ranked.sort(
      (a, b) => Number(bookIsbns(b.item).includes(wanted ?? '')) - Number(bookIsbns(a.item).includes(wanted ?? '')),
    );
  }
  return mergeDuplicateBooks(ranked);
}

/** Fills the description from Open Library when the chosen result came without one. */
export async function enrichBook(result: SearchResult<Book>): Promise<Book> {
  const book = { ...result.item };
  if (!book.description && typeof result.details?.workKey === 'string') {
    book.description = await new OpenLibraryApi().loadDescription(result.details.workKey);
  }
  if (book.description) {
    // keep it safe inside a quoted frontmatter value: no HTML, no line breaks, no double quotes
    book.description = book.description
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/"/g, "'")
      .trim();
  }
  return book;
}
