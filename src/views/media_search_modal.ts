import { MediaType } from '@models/media.model';
import { DEFAULT_SETTINGS } from '@settings/settings';
import { ServiceProvider } from '@src/constants';
import type MediaSearchPlugin from '@src/main';
import { MEDIA_TYPE_INFO } from '@src/media/type_info';
import { searchMedia, SearchOutcome } from '@src/media/registry';
import languages from '@utils/languages';
import { ButtonComponent, Modal, Notice, Setting, TextComponent } from 'obsidian';

/** Step 1: type a query. Resolves with ranked results. */
export class MediaSearchModal extends Modal {
  private readonly SEARCH_BUTTON_TEXT = 'Search';
  private readonly REQUESTING_BUTTON_TEXT = 'Searching…';
  private isBusy = false;
  private settled = false;
  private okBtnRef?: ButtonComponent;
  private options: { locale: string };

  constructor(
    private plugin: MediaSearchPlugin,
    private type: MediaType,
    private query: string,
    private callback: (error: Error | null, result?: SearchOutcome) => void,
  ) {
    super(plugin.app);
    this.options = { locale: plugin.settings.localePreference };
  }

  setBusy(busy: boolean): void {
    this.isBusy = busy;
    this.okBtnRef?.setDisabled(busy).setButtonText(busy ? this.REQUESTING_BUTTON_TEXT : this.SEARCH_BUTTON_TEXT);
  }

  async search(): Promise<void> {
    if (!this.query?.trim()) return void new Notice('Type something to search for.');
    if (this.isBusy) return;

    this.setBusy(true);
    try {
      const outcome = await searchMedia(this.plugin.settings, this.type, this.query, this.options);
      if (!outcome.results.length) {
        new Notice(`No ${MEDIA_TYPE_INFO[this.type].plural.toLowerCase()} found for "${this.query}"`);
        return; // keep the modal open so the query can be tweaked
      }
      this.settled = true;
      this.callback(null, outcome);
      this.close();
    } catch (err) {
      this.settled = true;
      this.callback(err as Error);
      this.close();
    } finally {
      this.setBusy(false);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    const info = MEDIA_TYPE_INFO[this.type];
    contentEl.createEl('h2', { text: `Search ${info.label.toLowerCase()}` });

    const { settings } = this.plugin;
    if (this.type === 'book' && settings.serviceProvider === ServiceProvider.google && settings.askForLocale) {
      this.renderSelectLocale();
    }

    contentEl.createDiv({ cls: 'book-search-plugin__search-modal--input' }, el => {
      const input = new TextComponent(el)
        .setValue(this.query)
        .setPlaceholder(info.placeholder)
        .onChange(value => (this.query = value));
      input.inputEl.addEventListener('keydown', event => event.key === 'Enter' && !event.isComposing && this.search());
      window.setTimeout(() => input.inputEl.focus(), 0);
    });

    new Setting(contentEl).addButton(btn => {
      this.okBtnRef = btn
        .setButtonText(this.SEARCH_BUTTON_TEXT)
        .setCta()
        .onClick(() => this.search());
    });
  }

  renderSelectLocale() {
    const defaultLocale = window.moment.locale();
    new Setting(this.contentEl).setName('Locale').addDropdown(dropdown => {
      dropdown.addOption(defaultLocale, `${languages[defaultLocale] || defaultLocale}`);
      window.moment.locales().forEach(locale => {
        const localeName = languages[locale];
        if (localeName && locale !== defaultLocale) dropdown.addOption(locale, localeName);
      });
      dropdown
        .setValue(this.options.locale === DEFAULT_SETTINGS.localePreference ? defaultLocale : this.options.locale)
        .onChange(locale => (this.options.locale = locale));
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.callback(new CancelledError());
  }
}

/** Raised when the user closes a modal without choosing. Not shown as an error. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}
