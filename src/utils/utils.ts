import { Book, FrontMatter } from '@models/book.model';
import { MediaItem } from '@models/media.model';
import { DefaultFrontmatterKeyType } from '@settings/settings';

// Anything with string keys can be rendered into a template / file name.
type Renderable = Book | MediaItem | Record<string, unknown>;

// == Format Syntax == //
export const NUMBER_REGEX = /^-?[0-9]*$/;
export const DATE_REGEX = /{{DATE(\+-?[0-9]+)?}}/;
export const DATE_REGEX_FORMATTED = /{{DATE:([^}\n\r+]*)(\+-?[0-9]+)?}}/;

export function replaceIllegalFileNameCharactersInString(text: string) {
  return text.replace(/[\\,#%&{}/*<>$":@.?|]/g, '').replace(/\s+/g, ' ');
}

export function isISBN(str: string) {
  return /^(97(8|9))?\d{9}(\d|X)$/.test(str);
}

export function makeFileName(book: Renderable, fileNameFormat?: string, extension = 'md') {
  const item = book as Record<string, unknown>;
  let result: string;
  if (fileNameFormat) {
    result = replaceVariableSyntax(item, replaceDateInString(fileNameFormat));
    // "Fight Club ()" when the year is missing
    result = result
      .replace(/\s*\(\s*\)|\s*\[\s*\]/g, '')
      .replace(/\s+-\s*$/, '')
      .trim();
  } else {
    result = !item.author ? String(item.title ?? '') : `${item.title} - ${item.author}`;
  }
  return replaceIllegalFileNameCharactersInString(result || String(item.title ?? 'Untitled')) + `.${extension}`;
}

/** Turns a name into a safe wikilink target. */
export function toWikiLink(name: string): string {
  const target = String(name)
    .replace(/[[\]|#^]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return target ? `[[${target}]]` : '';
}

/** YAML flow list, e.g. ["[[Brad Pitt]]", "[[Edward Norton]]"]. Valid in frontmatter and readable by Obsidian. */
export function toYamlList(values: string[]): string {
  return `[${values
    .filter(Boolean)
    .map(v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(', ')}]`;
}

/**
 * Variables available in templates on top of the item's own fields:
 *  - {{<list>Links}}  YAML list of wikilinks for every list field (castLinks, genresLinks, authorsLinks…)
 *  - {{<list>List}}   YAML list of plain strings
 *  - {{url}}          alias of {{link}}
 */
export function buildTemplateVariables(item: Renderable): Record<string, unknown> {
  const vars: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const [key, value] of Object.entries(item)) {
    if (Array.isArray(value)) {
      const strings = value.map(v => String(v ?? '').trim()).filter(Boolean);
      vars[`${key}Links`] = toYamlList(strings.map(toWikiLink));
      vars[`${key}List`] = toYamlList(strings);
    }
  }
  if (vars.url === undefined) vars.url = vars.link ?? '';
  return vars;
}

export function changeSnakeCase(book: Renderable) {
  return Object.entries(book).reduce((acc, [key, value]) => {
    acc[camelToSnakeCase(key)] = value;
    return acc;
  }, {});
}

export function applyDefaultFrontMatter(
  book: Renderable,
  frontmatter: FrontMatter | string,
  keyType: DefaultFrontmatterKeyType = DefaultFrontmatterKeyType.snakeCase,
) {
  const frontMater = keyType === DefaultFrontmatterKeyType.camelCase ? book : changeSnakeCase(book);

  const extraFrontMatter = typeof frontmatter === 'string' ? parseFrontMatter(frontmatter) : frontmatter;
  for (const key in extraFrontMatter) {
    const value = extraFrontMatter[key]?.toString().trim() ?? '';
    if (frontMater[key] && frontMater[key] !== value) {
      frontMater[key] = `${frontMater[key]}, ${value}`;
    } else {
      frontMater[key] = value;
    }
  }

  return frontMater as object;
}

function stringifyValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

export function replaceVariableSyntax(book: Renderable, text: string): string {
  if (!text?.trim()) {
    return '';
  }

  // longest keys first so {{castLinks}} isn't eaten by {{cast}}
  const entries = Object.entries(book).sort(([a], [b]) => b.length - a.length);

  return entries
    .reduce((result, [key, val]) => {
      const replacement = stringifyValue(val);
      return result.replace(new RegExp(`{{${key}}}`, 'ig'), () => replacement);
    }, text)
    .replace(/{{\w+}}/gi, '')
    .trim();
}

export function camelToSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter?.toLowerCase()}`);
}

export function parseFrontMatter(frontMatterString: string) {
  if (!frontMatterString) return {};
  return frontMatterString
    .split('\n')
    .map(item => {
      const index = item.indexOf(':');
      if (index === -1) return [item.trim(), ''];

      const key = item.slice(0, index)?.trim();
      const value = item.slice(index + 1)?.trim();
      return [key, value];
    })
    .reduce((acc, [key, value]) => {
      if (key) {
        acc[key] = value?.trim() ?? '';
      }
      return acc;
    }, {});
}

export function toStringFrontMatter(frontMatter: object): string {
  return Object.entries(frontMatter)
    .map(([key, value]) => {
      const newValue = value?.toString().trim() ?? '';
      if (/\r|\n/.test(newValue)) {
        return '';
      }
      if (/:\s/.test(newValue)) {
        return `${key}: "${newValue.replace(/"/g, '&quot;')}"\n`;
      }
      return `${key}: ${newValue}\n`;
    })
    .join('')
    .trim();
}

export function getDate(input?: { format?: string; offset?: number }) {
  let duration;

  if (input?.offset !== null && input?.offset !== undefined && typeof input.offset === 'number') {
    duration = window.moment.duration(input.offset, 'days');
  }

  return input?.format
    ? window.moment().add(duration).format(input?.format)
    : window.moment().add(duration).format('YYYY-MM-DD');
}

export function replaceDateInString(input: string) {
  let output: string = input;

  while (DATE_REGEX.test(output)) {
    const dateMatch = DATE_REGEX.exec(output);
    let offset = 0;

    if (dateMatch?.[1]) {
      const offsetString = dateMatch[1].replace('+', '').trim();
      const offsetIsInt = NUMBER_REGEX.test(offsetString);
      if (offsetIsInt) offset = parseInt(offsetString);
    }
    output = replacer(output, DATE_REGEX, getDate({ offset }));
  }

  while (DATE_REGEX_FORMATTED.test(output)) {
    const dateMatch = DATE_REGEX_FORMATTED.exec(output);
    const format = dateMatch?.[1];
    let offset = 0;

    if (dateMatch?.[2]) {
      const offsetString = dateMatch[2].replace('+', '').trim();
      const offsetIsInt = NUMBER_REGEX.test(offsetString);
      if (offsetIsInt) offset = parseInt(offsetString);
    }

    output = replacer(output, DATE_REGEX_FORMATTED, getDate({ format, offset }));
  }

  return output;
}

function replacer(str: string, reg: RegExp, replaceValue) {
  return str.replace(reg, function () {
    return replaceValue;
  });
}
