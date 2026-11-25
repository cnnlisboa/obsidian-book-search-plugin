import { replaceDateInString } from '@utils/utils';
import { App, Notice, PluginSettingTab, Setting } from 'obsidian';

import { MEDIA_TYPES, MediaType } from '@models/media.model';
import { MEDIA_TYPE_INFO } from '@src/media/type_info';
import { ServiceProvider } from '@src/constants';
import languages from '@utils/languages';
import { SettingServiceProviderModal } from '@views/setting_service_provider_modal';
import type MediaSearchPlugin from '../main';
import { FileNameFormatSuggest } from './suggesters/FileNameFormatSuggester';
import { FileSuggest } from './suggesters/FileSuggester';
import { FolderSuggest } from './suggesters/FolderSuggester';

const docUrl = 'https://github.com/connradolisboa/obsidian-book-search-plugin';

export enum DefaultFrontmatterKeyType {
  snakeCase = 'Snake Case',
  camelCase = 'Camel Case',
}

export interface MediaTypeSettings {
  enabled: boolean;
  folder: string;
  fileNameFormat: string;
  templateFile: string;
  coverImagePath: string;
}

export interface BookSearchPluginSettings {
  mediaTypes: Record<MediaType, MediaTypeSettings>;

  /** @deprecated moved to mediaTypes.book — kept so older data still loads */
  folder: string;
  /** @deprecated moved to mediaTypes.book */
  fileNameFormat: string;
  /** @deprecated moved to mediaTypes.book */
  templateFile: string;
  /** @deprecated moved to mediaTypes.book */
  coverImagePath: string;

  frontmatter: string; // @deprecated — inserted when no template is set
  content: string; // @deprecated — inserted when no template is set
  useDefaultFrontmatter: boolean;
  defaultFrontmatterKeyType: DefaultFrontmatterKeyType;

  // Books
  serviceProvider: ServiceProvider;
  smartBookSearch: boolean;
  naverClientId: string;
  naverClientSecret: string;
  localePreference: string;
  apiKey: string;
  hardcoverApiKey: string;
  askForLocale: boolean;
  enableCoverImageEdgeCurl: boolean;

  // Movies & TV
  tmdbApiKey: string;
  tmdbLanguage: string;
  omdbApiKey: string;

  // Music
  musicBrainzEnrichment: boolean;

  // General
  openPageOnCompletion: boolean;
  showCoverImageInSearch: boolean;
  enableCoverImageSave: boolean;
}

function typeDefaults(): Record<MediaType, MediaTypeSettings> {
  return MEDIA_TYPES.reduce(
    (acc, type) => {
      acc[type] = {
        enabled: true,
        folder: '',
        fileNameFormat: type === 'book' ? '' : MEDIA_TYPE_INFO[type].defaultFileNameFormat,
        templateFile: '',
        coverImagePath: '',
      };
      return acc;
    },
    {} as Record<MediaType, MediaTypeSettings>,
  );
}

export const DEFAULT_SETTINGS: BookSearchPluginSettings = {
  mediaTypes: typeDefaults(),
  folder: '',
  fileNameFormat: '',
  templateFile: '',
  coverImagePath: '',
  frontmatter: '',
  content: '',
  useDefaultFrontmatter: true,
  defaultFrontmatterKeyType: DefaultFrontmatterKeyType.camelCase,
  serviceProvider: ServiceProvider.google,
  smartBookSearch: true,
  naverClientId: '',
  naverClientSecret: '',
  localePreference: 'default',
  apiKey: '',
  hardcoverApiKey: '',
  askForLocale: true,
  enableCoverImageEdgeCurl: true,
  tmdbApiKey: '',
  tmdbLanguage: 'en-US',
  omdbApiKey: '',
  musicBrainzEnrichment: true,
  openPageOnCompletion: true,
  showCoverImageInSearch: false,
  enableCoverImageSave: false,
};

/**
 * Builds settings from stored data. Older versions kept book settings at the top level;
 * they're carried into mediaTypes.book the first time the new version loads.
 */
export function migrateSettings(data: Partial<BookSearchPluginSettings> | null | undefined): BookSearchPluginSettings {
  const stored = data ?? {};
  const settings: BookSearchPluginSettings = { ...DEFAULT_SETTINGS, ...stored, mediaTypes: typeDefaults() };

  for (const type of MEDIA_TYPES) {
    settings.mediaTypes[type] = { ...settings.mediaTypes[type], ...(stored.mediaTypes?.[type] ?? {}) };
  }

  if (!stored.mediaTypes?.book) {
    settings.mediaTypes.book = {
      ...settings.mediaTypes.book,
      folder: stored.folder ?? '',
      fileNameFormat: stored.fileNameFormat ?? '',
      templateFile: stored.templateFile ?? '',
      coverImagePath: stored.coverImagePath ?? '',
    };
  }
  return settings;
}

type SectionFn = (containerEl: HTMLElement) => void;

export class BookSearchSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MediaSearchPlugin,
  ) {
    super(app, plugin);
  }

  private get settings() {
    return this.plugin.settings;
  }

  private save() {
    return this.plugin.saveSettings();
  }

  private createHeader(title: string, containerEl: HTMLElement, desc?: string) {
    const setting = new Setting(containerEl).setHeading().setName(title);
    if (desc) setting.setDesc(desc);
    return setting;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.classList.add('book-search-plugin__settings');

    this.createGeneralSettings(containerEl);

    this.createTypeSection(containerEl, 'book', el => this.createBookProviderSettings(el));
    this.createTypeSection(containerEl, 'movie', el => this.createMovieProviderSettings(el));
    this.createTypeSection(containerEl, 'series');
    this.createTypeSection(containerEl, 'album', el => this.createMusicProviderSettings(el));
    this.createTypeSection(containerEl, 'track');
    this.createTypeSection(containerEl, 'artist');
  }

  // ---------------------------------------------------------------- general

  private createGeneralSettings(containerEl: HTMLElement) {
    this.createHeader('General', containerEl);

    new Setting(containerEl)
      .setName('Open new note')
      .setDesc('Open the note after creating it.')
      .addToggle(toggle =>
        toggle.setValue(this.settings.openPageOnCompletion).onChange(async value => {
          this.settings.openPageOnCompletion = value;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName('Show cover images in search')
      .setDesc('Show covers and posters next to search results.')
      .addToggle(toggle =>
        toggle.setValue(this.settings.showCoverImageInSearch).onChange(async value => {
          this.settings.showCoverImageInSearch = value;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName('Save cover images')
      .setDesc(
        'Download covers into the vault. Use {{localCoverImage}} in templates. Each type has its own folder below.',
      )
      .addToggle(toggle =>
        toggle.setValue(this.settings.enableCoverImageSave).onChange(async value => {
          this.settings.enableCoverImageSave = value;
          await this.save();
        }),
      );
  }

  // ---------------------------------------------------------------- per type

  private createTypeSection(containerEl: HTMLElement, type: MediaType, providerSettings?: SectionFn) {
    const info = MEDIA_TYPE_INFO[type];
    const typeSettings = this.settings.mediaTypes[type];

    this.createHeader(info.plural, containerEl);

    new Setting(containerEl)
      .setName(`Enable ${info.plural.toLowerCase()}`)
      .setDesc(`Show the "Create ${info.noun} note" command.`)
      .addToggle(toggle =>
        toggle.setValue(typeSettings.enabled).onChange(async value => {
          typeSettings.enabled = value;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName('Folder')
      .setDesc(`New ${info.noun} notes are created here.`)
      .addSearch(cb => {
        try {
          new FolderSuggest(this.app, cb.inputEl);
        } catch (e) {
          console.error(e);
        }
        cb.setPlaceholder('Example: Inventory/' + info.plural)
          .setValue(typeSettings.folder)
          .onChange(async value => {
            typeSettings.folder = value.trim();
            await this.save();
          });
      });

    this.createFileNameFormatSetting(containerEl, type);

    const templateDesc = document.createDocumentFragment();
    templateDesc.createDiv({ text: 'Used as the note template. Leave empty for default frontmatter.' });
    templateDesc.createEl('a', { text: 'Template variables', href: `${docUrl}#template-variables` });
    new Setting(containerEl)
      .setName('Template file')
      .setDesc(templateDesc)
      .addSearch(cb => {
        try {
          new FileSuggest(this.app, cb.inputEl);
        } catch {
          // ignore
        }
        cb.setPlaceholder('Example: Templates/' + info.label)
          .setValue(typeSettings.templateFile)
          .onChange(async value => {
            typeSettings.templateFile = value;
            await this.save();
          });
      });

    new Setting(containerEl)
      .setName('Cover image folder')
      .setDesc('Where downloaded covers go when "Save cover images" is on.')
      .addSearch(cb => {
        try {
          new FolderSuggest(this.app, cb.inputEl);
        } catch {
          // ignore
        }
        cb.setPlaceholder('Example: Assets/' + info.plural)
          .setValue(typeSettings.coverImagePath)
          .onChange(async value => {
            typeSettings.coverImagePath = value.trim();
            await this.save();
          });
      });

    providerSettings?.(containerEl);
  }

  private createFileNameFormatSetting(containerEl: HTMLElement, type: MediaType) {
    const typeSettings = this.settings.mediaTypes[type];
    const fallback = MEDIA_TYPE_INFO[type].defaultFileNameFormat;
    const hint = document.createDocumentFragment().createEl('code', {
      text: replaceDateInString(typeSettings.fileNameFormat) || fallback,
    });
    new Setting(containerEl)
      .setClass('book-search-plugin__settings--new_file_name')
      .setName('File name')
      .setDesc(`Variables: ${MEDIA_TYPE_INFO[type].variables.map(v => `{{${v}}}`).join(', ')}, {{DATE}}`)
      .addSearch(cb => {
        try {
          new FileNameFormatSuggest(this.app, cb.inputEl);
        } catch (e) {
          console.error(e);
        }
        cb.setPlaceholder(fallback)
          .setValue(typeSettings.fileNameFormat)
          .onChange(async value => {
            typeSettings.fileNameFormat = value?.trim();
            hint.textContent = replaceDateInString(value) || fallback;
            await this.save();
          });
      });
    containerEl
      .createEl('div', { cls: ['setting-item-description', 'book-search-plugin__settings--new_file_name_hint'] })
      .append(hint);
  }

  /** Password-style field that never shows the saved value back. */
  private createSecretSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string | DocumentFragment,
    getValue: () => string,
    setValue: (value: string) => void,
  ) {
    let pending = '';
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText(text => {
        text.inputEl.type = 'password';
        text.setPlaceholder(getValue() ? '•••••••• (saved)' : 'Not set').onChange(value => (pending = value));
      })
      .addButton(button =>
        button.setButtonText('Save').onClick(async () => {
          setValue(pending.trim());
          await this.save();
          new Notice(pending.trim() ? `${name} saved` : `${name} cleared`);
          this.display();
        }),
      );
  }

  // ---------------------------------------------------------------- books

  private createBookProviderSettings(containerEl: HTMLElement) {
    let extraButton: HTMLElement;
    // eslint-disable-next-line prefer-const
    let localeSetting: Setting;
    // eslint-disable-next-line prefer-const
    let edgeCurlSetting: Setting;

    const toggleProviderSettings = (provider: ServiceProvider = this.settings.serviceProvider) => {
      const isGoogle = provider === ServiceProvider.google;
      extraButton?.toggleClass('book-search-plugin__hide', provider !== ServiceProvider.naver);
      localeSetting?.settingEl.toggleClass('book-search-plugin__hide', !isGoogle);
      edgeCurlSetting?.settingEl.toggleClass('book-search-plugin__hide', !isGoogle);
    };

    new Setting(containerEl)
      .setName('Main book source')
      .setDesc('Where book results come from first.')
      .setClass('book-search-plugin__settings--service_provider')
      .addDropdown(dropDown => {
        dropDown.addOption(ServiceProvider.google, 'Google Books (global)');
        dropDown.addOption(ServiceProvider.hardcover, 'Hardcover (global)');
        dropDown.addOption(ServiceProvider.naver, 'Naver (Korean)');
        dropDown.setValue(this.settings.serviceProvider ?? ServiceProvider.google);
        dropDown.onChange(async value => {
          this.settings.serviceProvider = value as ServiceProvider;
          toggleProviderSettings(value as ServiceProvider);
          await this.save();
        });
      })
      .addExtraButton(component => {
        extraButton = component.extraSettingsEl;
        component.onClick(() => new SettingServiceProviderModal(this.plugin).open());
      });

    new Setting(containerEl)
      .setName('Smart search')
      .setDesc(
        'Also search Open Library, Google Books and Hardcover (if a token is set), merge duplicate editions and rank by how well each result matches.',
      )
      .addToggle(toggle =>
        toggle.setValue(this.settings.smartBookSearch).onChange(async value => {
          this.settings.smartBookSearch = value;
          await this.save();
        }),
      );

    localeSetting = new Setting(containerEl)
      .setName('Preferred locale')
      .setDesc('Language used for Google Books searches.')
      .addDropdown(dropDown => {
        const defaultLocale = window.moment.locale();
        dropDown.addOption(defaultLocale, `${languages[defaultLocale] || defaultLocale} (Default Locale)`);
        window.moment.locales().forEach(locale => {
          const localeName = languages[locale];
          if (localeName && locale !== defaultLocale) dropDown.addOption(locale, localeName);
        });
        const localeValue = this.settings.localePreference;
        dropDown
          .setValue(localeValue === DEFAULT_SETTINGS.localePreference ? defaultLocale : localeValue)
          .onChange(async value => {
            this.settings.localePreference = value;
            await this.save();
          });
      });

    new Setting(containerEl)
      .setName('Ask for locale')
      .setDesc('Ask for the locale on every Google Books search.')
      .addToggle(toggle =>
        toggle.setValue(this.settings.askForLocale).onChange(async value => {
          this.settings.askForLocale = value;
          await this.save();
        }),
      );

    edgeCurlSetting = new Setting(containerEl)
      .setName('Cover edge curl effect')
      .setDesc('Show the page curl effect on Google Books covers.')
      .addToggle(toggle =>
        toggle.setValue(this.settings.enableCoverImageEdgeCurl).onChange(async value => {
          this.settings.enableCoverImageEdgeCurl = value;
          await this.save();
        }),
      );

    toggleProviderSettings();

    this.createSecretSetting(
      containerEl,
      'Google Books API key',
      'Optional. Raises the Google Books quota. Make sure you understand Google Cloud API key security.',
      () => this.settings.apiKey,
      value => (this.settings.apiKey = value),
    );

    this.createSecretSetting(
      containerEl,
      'Hardcover API token',
      'From hardcover.app/account/api (free account).',
      () => this.settings.hardcoverApiKey,
      value => (this.settings.hardcoverApiKey = value.replace(/^Bearer\s+/i, '')),
    );
  }

  // ---------------------------------------------------------------- movies & tv

  private createMovieProviderSettings(containerEl: HTMLElement) {
    const tmdbDesc = document.createDocumentFragment();
    tmdbDesc.appendText('Used for movies and TV shows. Get a free key at ');
    tmdbDesc.createEl('a', { text: 'themoviedb.org/settings/api', href: 'https://www.themoviedb.org/settings/api' });
    tmdbDesc.appendText('. Either the API key or the read access token works.');
    this.createSecretSetting(
      containerEl,
      'TMDB API key',
      tmdbDesc,
      () => this.settings.tmdbApiKey,
      value => (this.settings.tmdbApiKey = value.replace(/^Bearer\s+/i, '')),
    );

    const omdbDesc = document.createDocumentFragment();
    omdbDesc.appendText(
      'Optional. Adds IMDb rating, Rotten Tomatoes, Metascore and awards. Used on its own if there is no TMDB key. ',
    );
    omdbDesc.createEl('a', { text: 'omdbapi.com/apikey.aspx', href: 'https://www.omdbapi.com/apikey.aspx' });
    this.createSecretSetting(
      containerEl,
      'OMDb API key',
      omdbDesc,
      () => this.settings.omdbApiKey,
      value => (this.settings.omdbApiKey = value),
    );

    new Setting(containerEl)
      .setName('TMDB language')
      .setDesc('Language for titles and descriptions, e.g. en-US, pt-BR, de-DE.')
      .addText(text =>
        text
          .setPlaceholder('en-US')
          .setValue(this.settings.tmdbLanguage)
          .onChange(async value => {
            this.settings.tmdbLanguage = value.trim() || 'en-US';
            await this.save();
          }),
      );
  }

  // ---------------------------------------------------------------- music

  private createMusicProviderSettings(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName('Music sources')
      .setDesc('Albums, songs and artists come from Deezer. No key needed.');

    new Setting(containerEl)
      .setName('Add details from MusicBrainz')
      .setDesc(
        'Adds detailed genres and the original release year to albums, and country, years active and members to artists. Adds about 2 seconds per note.',
      )
      .addToggle(toggle =>
        toggle.setValue(this.settings.musicBrainzEnrichment).onChange(async value => {
          this.settings.musicBrainzEnrichment = value;
          await this.save();
        }),
      );
  }
}
