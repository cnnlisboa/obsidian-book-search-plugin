import { ParsedQuery } from './query_parser';

/** What the ranker needs to know about a candidate. */
export interface RankingFields {
  title: string;
  altTitles?: string[];
  creators?: string[];
  year?: number;
  hasCover?: boolean;
  hasDescription?: boolean;
  /** Text checked against junk patterns (title, subtitle, creators). */
  junkText?: string;
  /** Small type-specific nudge, e.g. prefer full albums over singles. */
  bonus?: number;
}

export interface RankingOptions {
  /** How much a year match matters. Movies care a lot (remakes), books little (editions). */
  yearWeight?: number;
  /** Pattern for knock-offs: summaries, karaoke versions, etc. */
  junkPattern?: RegExp;
}

export interface Rankable {
  popularity?: number;
  position?: number;
  score?: number;
}

const ARTICLES = new Set([
  'the',
  'a',
  'an',
  'o',
  'os',
  'as',
  'um',
  'uma',
  'el',
  'la',
  'los',
  'las',
  'le',
  'les',
  'der',
  'die',
  'das',
]);

export function normalize(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  const words = normalize(text).split(' ').filter(Boolean);
  // drop a leading article ("The Hobbit" ≈ "Hobbit") but keep it if it's the only word
  if (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words;
}

function bigrams(text: string): Map<string, number> {
  const s = ` ${text} `;
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const gram = s.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

/** Sørensen–Dice coefficient over character bigrams. Tolerates typos. */
export function diceSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  ga.forEach((count, gram) => {
    overlap += Math.min(count, gb.get(gram) ?? 0);
    total += count;
  });
  gb.forEach(count => (total += count));
  return (2 * overlap) / total;
}

function tokenMatches(a: string, b: string) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) return diceSimilarity(a, b) >= 0.75;
  return false;
}

/** Share of `needles` found (fuzzily) among `haystack`. */
export function coverage(needles: string[], haystack: string[]): number {
  if (!needles.length) return 0;
  const found = needles.filter(n => haystack.some(h => tokenMatches(n, h))).length;
  return found / needles.length;
}

/** Similarity of two titles, 0..1. */
export function titleSimilarity(query: string, candidate: string): number {
  const q = tokens(query);
  const c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  if (q.join(' ') === c.join(' ')) return 1;
  const tokenScore = (coverage(q, c) + coverage(c, q)) / 2;
  const charScore = diceSimilarity(q.join(' '), c.join(' '));
  return Math.max(tokenScore, charScore * 0.95);
}

function bestTitleSimilarity(query: string, fields: RankingFields): number {
  const candidates = [fields.title, ...(fields.altTitles ?? [])].filter(Boolean);
  // also compare against the main title without subtitle / parenthetical ("Dune: Deluxe Edition")
  const stripped = fields.title
    ?.replace(/\s*[:([].*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .trim();
  if (stripped && stripped !== fields.title) candidates.push(stripped);
  return Math.max(0, ...candidates.map(c => titleSimilarity(query, c)));
}

function creatorSimilarity(query: string, creators: string[]): number {
  if (!creators.length) return 0;
  const q = tokens(query);
  return Math.max(
    ...creators.map(creator => {
      const c = tokens(creator);
      // "Herbert" should fully match "Frank Herbert"
      return Math.max(coverage(q, c), diceSimilarity(query, creator));
    }),
  );
}

/** How well the candidate matches what the user asked for, ignoring popularity. */
export function matchScore(parsed: ParsedQuery, fields: RankingFields): number {
  const creators = (fields.creators ?? []).filter(Boolean);

  // Free-text match: every query word should appear in title or creator,
  // and the title shouldn't have many words the user didn't ask for.
  const freeText = parsed.text || parsed.terms;
  const queryTokens = tokens(freeText);
  const titleTokens = tokens(fields.title);
  const allTokens = [...titleTokens, ...creators.flatMap(c => tokens(c))];
  const freeScore = Math.max(
    0.6 * coverage(queryTokens, allTokens) + 0.4 * coverage(titleTokens, queryTokens),
    bestTitleSimilarity(freeText, fields) * (creators.length ? 0.9 : 1),
  );

  if (!parsed.title || !parsed.creator) return freeScore;

  const orientations: [string, string][] = [[parsed.title, parsed.creator]];
  if (parsed.ambiguousOrder) orientations.push([parsed.creator, parsed.title]);

  const splitScore = Math.max(
    ...orientations.map(([title, creator]) => {
      const t = bestTitleSimilarity(title, fields);
      // provider didn't give us creators for this hit (e.g. movie search results): judge on title alone
      if (!creators.length) return t * 0.95;
      return 0.65 * t + 0.35 * creatorSimilarity(creator, creators);
    }),
  );

  return Math.max(splitScore, freeScore);
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Scores and sorts results in place, best first.
 * The final score mixes: how well it matches (dominant), popularity,
 * completeness (cover, description), year match and junk penalties.
 */
export function rankResults<T extends Rankable>(
  parsed: ParsedQuery,
  results: T[],
  getFields: (result: T) => RankingFields,
  options: RankingOptions = {},
): T[] {
  const { yearWeight = 0.06, junkPattern } = options;
  const maxPopularity = Math.max(0, ...results.map(r => r.popularity ?? 0));
  const queryText = normalize(parsed.raw);

  for (const result of results) {
    const fields = getFields(result);
    let score = 0.8 * matchScore(parsed, fields);

    // popularity: log-scaled against the most popular hit; fall back to provider order
    if (maxPopularity > 0) {
      score += 0.12 * (Math.log10(1 + (result.popularity ?? 0)) / Math.log10(1 + maxPopularity));
    } else if (result.position !== undefined) {
      score += 0.12 * Math.max(0, 1 - result.position / 20);
    }

    if (fields.hasCover) score += 0.03;
    if (fields.hasDescription) score += 0.02;
    score += fields.bonus ?? 0;

    if (parsed.year && fields.year) {
      const diff = Math.abs(parsed.year - fields.year);
      score += diff === 0 ? yearWeight : diff === 1 ? yearWeight / 3 : -yearWeight;
    }

    if (junkPattern && fields.junkText) {
      const match = fields.junkText.match(junkPattern);
      // only penalise if the user didn't ask for it ("dune study guide")
      if (match && !queryText.includes(normalize(match[0]))) score -= 0.3;
    }

    result.score = clamp(score);
  }

  return results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export const CONFIDENT_SCORE = 0.72;
const CONFIDENT_MARGIN = 0.07;

/**
 * Whether the top result is good enough to pick automatically (bulk import).
 * Close runners-up only count against it when they're a different thing
 * (Solaris 1972 vs 2002), not another edition of the same one.
 */
export function isConfident<T extends Rankable>(results: T[], sameThing?: (a: T, b: T) => boolean): boolean {
  const [first] = results;
  const top = first?.score ?? 0;
  if (!first || top < CONFIDENT_SCORE) return false;
  return results
    .slice(1)
    .filter(other => top - (other.score ?? 0) < CONFIDENT_MARGIN)
    .every(other => sameThing?.(first, other) ?? false);
}
