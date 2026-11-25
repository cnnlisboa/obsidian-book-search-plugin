import { Book } from '@models/book.model';
import * as utils from './utils';

jest.mock('@settings/settings', () => jest.fn());

describe('util.js', () => {
  const book: Book = {
    title: '코스모스',
    author: '칼 세이건',
    authors: ['칼 세이건'],
  };

  it('replaceIllegalFileNameCharactersInString 1', () => {
    expect(utils.replaceIllegalFileNameCharactersInString('재레드 다이아몬드의 <대변동 : 위기, 선택, 변화>')).toBe(
      '재레드 다이아몬드의 대변동 위기 선택 변화',
    );
  });

  it('replaceIllegalFileNameCharactersInString 2', () => {
    expect(utils.replaceIllegalFileNameCharactersInString('2022 고시넷 초록이 NCS 모듈형 1 | 통합기본서(2판)')).toBe(
      '2022 고시넷 초록이 NCS 모듈형 1 통합기본서(2판)',
    );
  });

  it('makeFileName 1', () => {
    expect(utils.makeFileName(book)).toBe('코스모스 - 칼 세이건.md');
  });

  it('makeFileName 2', () => {
    const newBook = {
      ...book,
      author: '',
    };
    expect(utils.makeFileName(newBook)).toBe('코스모스.md');
  });

  it('makeFileName 3', () => {
    expect(utils.makeFileName(book, '{{author}}-{{title}}')).toBe('칼 세이건-코스모스.md');
  });

  it('makeFileName 4', () => {
    expect(utils.makeFileName(book, '{{author}}-{{title}}')).toBe('칼 세이건-코스모스.md');
  });

  it('makeFileName 5', () => {
    const newBook = {
      ...book,
      title: '코스모스 : 창백한 푸른점',
    };
    expect(utils.makeFileName(newBook, '{{title}} - {{author}}')).toBe('코스모스 창백한 푸른점 - 칼 세이건.md');
  });
});

describe('template variables', () => {
  it('adds Links / List variables for every list and a url alias', () => {
    const vars = utils.buildTemplateVariables({
      title: 'Fight Club',
      cast: ['Brad Pitt', 'Edward Norton'],
      link: 'https://example.com',
    });
    expect(vars.castLinks).toBe('["[[Brad Pitt]]", "[[Edward Norton]]"]');
    expect(vars.castList).toBe('["Brad Pitt", "Edward Norton"]');
    expect(vars.url).toBe('https://example.com');
    expect(utils.replaceVariableSyntax(vars, 'cast: {{castLinks}}\nnames: {{cast}}')).toBe(
      'cast: ["[[Brad Pitt]]", "[[Edward Norton]]"]\nnames: Brad Pitt, Edward Norton',
    );
  });

  it('drops empty brackets when a value is missing from the file name', () => {
    expect(utils.makeFileName({ title: 'Fight Club', year: '' }, '{{title}} ({{year}})')).toBe('Fight Club.md');
  });

  it('strips characters that break wikilinks', () => {
    expect(utils.toWikiLink('AC/DC [Live] | #1')).toBe('[[AC/DC Live 1]]');
  });
});
