import { migrateSettings } from './settings';

jest.mock('obsidian', () => ({ PluginSettingTab: class {}, Setting: class {}, Notice: class {} }));
jest.mock('@views/setting_service_provider_modal', () => ({}));
jest.mock('./suggesters/FileNameFormatSuggester', () => ({}));
jest.mock('./suggesters/FileSuggester', () => ({}));
jest.mock('./suggesters/FolderSuggester', () => ({}));

describe('migrateSettings', () => {
  it('moves old top-level book settings into mediaTypes.book', () => {
    const settings = migrateSettings({
      folder: 'Inventory/Books',
      fileNameFormat: '{{title}} ({{author}})',
      templateFile: 'Templates/Book.md',
      coverImagePath: 'Assets/Books',
    });
    expect(settings.mediaTypes.book).toMatchObject({
      enabled: true,
      folder: 'Inventory/Books',
      fileNameFormat: '{{title}} ({{author}})',
      templateFile: 'Templates/Book.md',
      coverImagePath: 'Assets/Books',
    });
    expect(settings.mediaTypes.movie).toMatchObject({ folder: '', fileNameFormat: '{{title}} ({{year}})' });
  });

  it('keeps saved per-type settings', () => {
    const settings = migrateSettings({
      folder: 'Old',
      mediaTypes: { book: { folder: 'New' } },
    } as never);
    expect(settings.mediaTypes.book.folder).toBe('New');
    expect(settings.mediaTypes.album.enabled).toBe(true);
  });
});
