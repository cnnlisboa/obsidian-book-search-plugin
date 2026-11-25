/**
 * Turns whatever the user typed or pasted into a structured query.
 *
 * Understands:
 *  - ISBNs (with or without hyphens)
 *  - IMDb ids / URLs, TMDB URLs, Deezer URLs, MusicBrainz URLs
 *  - "Title by Author"            → title + creator (fixed order)
 *  - "Title (Author)"             → title + creator (fixed order, matches the default note name format)
 *  - "A - B" / "A – B" / "A — B"  → two parts, order unknown (ranker tries both)
 *  - a year: "Heat (1995)", "Heat 1995", "Better Call Saul (2015–2022)"
 */

export interface ParsedQuery {
  raw: string;
  /** Cleaned free text, year removed. Safe to send to any provider. */
  text: string;
  /** Title and creator joined without connectors like "by" or "-". */
  terms: string;
  /** Free text including the year, used as a last resort. */
  textWithYear: string;
  title?: string;
  creator?: string;
  /** True when the split came from " - " so title/creator may be swapped. */
  ambiguousOrder?: boolean;
  year?: number;
  isbn?: string;
  imdbId?: string;
  tmdb?: { kind: 'movie' | 'tv'; id: string };
  deezer?: { kind: 'album' | 'track' | 'artist'; id: string };
  musicbrainz?: { kind: 'artist' | 'release-group' | 'release' | 'recording'; id: string };
}

const MIN_YEAR = 1800;

function maxYear() {
  return new Date().getFullYear() + 3;
}

function isPlausibleYear(value: number) {
  return value >= MIN_YEAR && value <= maxYear();
}

export function normalizeIsbn(value: string): string | undefined {
  const compact = value.replace(/^isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '');
  return /^(97[89])?\d{9}[\dXx]$/.test(compact) ? compact.toUpperCase() : undefined;
}

export function isbn10To13(isbn10: string): string | undefined {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return undefined;
  const core = `978${isbn10.slice(0, 9)}`;
  const sum = core.split('').reduce((acc, digit, i) => acc + Number(digit) * (i % 2 === 0 ? 1 : 3), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

/**
 * Strips list syntax and markdown so a line from a note becomes a plain query.
 */
export function cleanListLine(line: string): string {
  let text = line.trim();

  // block quotes, list bullets, numbering, task checkboxes
  text = text.replace(/^>+\s*/, '');
  text = text.replace(/^(?:[-*+•▪◦]\s+|\d{1,4}[.)]\s+|#\d+\s+)/, '');
  text = text.replace(/^\[[ xX/-]\]\s*/, '');
  text = text.replace(/^(?:[-*+•]\s+)/, '');

  // markdown links: keep URLs we can use, otherwise the label
  text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label: string, url: string) =>
    /imdb\.com|themoviedb\.org|deezer\.com|musicbrainz\.org|isbn/i.test(url) ? url : label,
  );
  // wikilinks: [[target|alias]] → target
  text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, '$1');

  // emphasis, inline code, surrounding quotes
  text = text.replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2');
  text = text.replace(/^[*_](.+)[*_]$/, '$1');
  text = text.replace(/^["“”'‘’«»]+|["“”'‘’«»]+$/g, '');

  // trailing ratings / annotations: "⭐⭐⭐", "★★★★☆", "- 4/5", "(8/10)", "✅", "#tag"
  text = text.replace(/\s*[⭐★☆✅✔❌]+.*$/u, '');
  text = text.replace(/\s*[-–—|:]?\s*\(?\d+(?:\.\d+)?\s*\/\s*(?:5|10|100)\)?\s*$/, '');
  text = text.replace(/(?:\s+#[\w/-]+)+\s*$/, '');

  return text.replace(/\s+/g, ' ').trim();
}

function extractIds(text: string, parsed: ParsedQuery): string {
  let rest = text;

  const imdb = rest.match(/\b(tt\d{6,10})\b/i);
  if (imdb) {
    parsed.imdbId = imdb[1].toLowerCase();
    rest = rest.replace(/\S*tt\d{6,10}\S*/i, ' ');
  }

  const tmdb = rest.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
  if (tmdb) {
    parsed.tmdb = { kind: tmdb[1].toLowerCase() as 'movie' | 'tv', id: tmdb[2] };
    rest = rest.replace(/\S*themoviedb\.org\S*/i, ' ');
  }

  const deezer = rest.match(/deezer\.com\/(?:[a-z]{2}\/)?(album|track|artist)\/(\d+)/i);
  if (deezer) {
    parsed.deezer = { kind: deezer[1].toLowerCase() as 'album' | 'track' | 'artist', id: deezer[2] };
    rest = rest.replace(/\S*deezer\.com\S*/i, ' ');
  }

  const mb = rest.match(/musicbrainz\.org\/(artist|release-group|release|recording)\/([0-9a-f-]{36})/i);
  if (mb) {
    parsed.musicbrainz = {
      kind: mb[1].toLowerCase() as 'artist' | 'release-group' | 'release' | 'recording',
      id: mb[2].toLowerCase(),
    };
    rest = rest.replace(/\S*musicbrainz\.org\S*/i, ' ');
  }

  // ISBN anywhere ("isbn:978-0-441-01359-3", a bare ISBN, or an ISBN inside a URL)
  const isbnCandidate = rest.match(/(?:isbn(?:-1[03])?:?\s*)?((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dXx])\b/i);
  if (isbnCandidate) {
    const isbn = normalizeIsbn(isbnCandidate[1]);
    // a bare 10-13 digit number that is also the whole query is almost certainly an ISBN
    if (isbn) {
      parsed.isbn = isbn;
      rest = rest.replace(isbnCandidate[0], ' ');
    }
  }

  // drop any other URL; we can't use it
  rest = rest.replace(/https?:\/\/\S+/gi, ' ');
  return rest.replace(/\s+/g, ' ').trim();
}

function extractYear(text: string, parsed: ParsedQuery): string {
  // "(1995)", "(2015–2022)", "(2024–)", "[1995]"
  const bracketed = text.match(/[([]\s*(\d{4})\s*(?:[–—-]\s*(?:\d{4})?\s*)?[)\]]/);
  if (bracketed && isPlausibleYear(Number(bracketed[1]))) {
    const rest = text.replace(bracketed[0], ' ').replace(/\s+/g, ' ').trim();
    if (rest) {
      parsed.year = Number(bracketed[1]);
      return rest;
    }
  }

  // trailing bare year: "Heat 1995", "Heat, 1995", "Heat - 1995"
  const trailing = text.match(/^(.*\S)[\s,–—-]+(\d{4})$/);
  if (trailing && isPlausibleYear(Number(trailing[2]))) {
    parsed.year = Number(trailing[2]);
    return trailing[1].replace(/[\s,–—-]+$/, '').trim();
  }

  return text;
}

function splitTitleCreator(text: string, parsed: ParsedQuery) {
  // "Title by Author" (use the last " by " so "Stand by Me by Ben E. King" works)
  const byMatch = text.match(/^(.+)\s+by\s+(.+)$/i);
  if (byMatch && !/\bby$/i.test(byMatch[1])) {
    const idx = text.toLowerCase().lastIndexOf(' by ');
    parsed.title = text.slice(0, idx).trim();
    parsed.creator = text.slice(idx + 4).trim();
    parsed.ambiguousOrder = false;
    return;
  }

  // "Title (Author)" — the default note name format, so "insert metadata" works off file names
  const paren = text.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (paren && !/^\d/.test(paren[2])) {
    parsed.title = paren[1].trim();
    parsed.creator = paren[2].trim();
    parsed.ambiguousOrder = false;
    return;
  }

  // "A - B", "A – B", "A — B", "A | B"
  const dash = text.split(/\s+[-–—|]\s+/);
  if (dash.length === 2 && dash[0] && dash[1]) {
    parsed.title = dash[0].trim();
    parsed.creator = dash[1].trim();
    parsed.ambiguousOrder = true;
  }
}

export function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { raw, text: '', terms: '', textWithYear: '' };
  let text = cleanListLine(raw);
  text = extractIds(text, parsed);
  parsed.textWithYear = text;
  text = extractYear(text, parsed);
  splitTitleCreator(text, parsed);
  parsed.text = text.trim();
  parsed.terms = (parsed.title && parsed.creator ? `${parsed.title} ${parsed.creator}` : text).trim();
  return parsed;
}

/**
 * Splits pasted text into individual queries. Ignores blank lines, headings,
 * rules and table separators. Table rows become "cell1 - cell2".
 */
export function parseList(input: string): string[] {
  const lines = input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^#{1,6}\s/.test(line))
    .filter(line => !/^([-*_=]\s*){3,}$/.test(line))
    .filter(line => !/^\|?\s*:?-{2,}/.test(line));

  // A single line separated by semicolons: "Dune; Neuromancer; Foundation"
  if (lines.length === 1 && lines[0].includes(';')) {
    return lines[0]
      .split(';')
      .map(part => part.trim())
      .filter(Boolean);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    let value = line;
    if (/^\|.*\|$/.test(line)) {
      value = line
        .slice(1, -1)
        .split('|')
        .map(cell => cell.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(' - ');
    }
    const key = cleanListLine(value).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
