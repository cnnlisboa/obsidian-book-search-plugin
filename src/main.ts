import { Editor, MarkdownView, normalizePath, Notice, Plugin, requestUrl, TFile } from 'obsidian';

import { MEDIA_TYPES, MediaItem, MediaType, SearchResult } from '@models/media.model';
import { BookSearchPluginSettings, BookSearchSettingTab, migrateSettings } from '@settings/settings';
import { IDENTIFIER_KEYS, itemIdentifiers, loadDetails, MissingApiKeyError, SearchOutcome } from '@src/media/registry';
import { MEDIA_TYPE_INFO } from '@src/media/type_info';
import { CursorJumper } from '@utils/cursor_jumper';
import {
  applyTemplateTransformations,
  executeInlineScriptsTemplates,
  getTemplateContents,
  useTemplaterPluginInFile,
} from '@utils/template';
import {
  applyDefaultFrontMatter,
  buildTemplateVariables,
  makeFileName,
  replaceVariableSyntax,
  toStringFrontMatter,
} from '@utils/utils';
import { BulkImportModal } from '@views/bulk_import_modal';
import { CancelledError, MediaSearchModal } from '@views/media_search_modal';
import { MediaSuggestModal } from '@views/media_suggest_modal';
import { MediaTypePickerModal } from '@views/media_type_picker_modal';

export interface CreateNoteResult {
  file: TFile;
  created: boolean; // false when the note already existed
}

/** Command ids for books are kept from the original plugin so existing hotkeys keep working. */
const CREATE_COMMAND_IDS: Record<MediaType, string> = {
  book: 'open-book-search-modal',
  movie: 'create-movie-note',
  series: 'create-series-note',
  album: 'create-album-note',
  track: 'create-track-note',
  artist: 'create-artist-note',
};

export default class MediaSearchPlugin extends Plugin {
  settings: BookSearchPluginSettings;

  async onload() {
    await this.loadSettings();

    const ribbonIconEl = this.addRibbonIcon('library', 'Media Search: create note', () => this.pickTypeAndCreate());
    ribbonIconEl.addClass('obsidian-book-search-plugin-ribbon-class');

    for (const type of MEDIA_TYPES) {
      this.addCommand({
        id: CREATE_COMMAND_IDS[type],
        name: `Create ${MEDIA_TYPE_INFO[type].noun} note`,
        icon: MEDIA_TYPE_INFO[type].icon,
        checkCallback: checking => {
          if (!this.settings.mediaTypes[type].enabled) return false;
          if (!checking) this.createNewNote(type);
          return true;
        },
      });
    }

    this.addCommand({
      id: 'create-notes-from-list',
      name: 'Create notes from a list',
      icon: 'list-plus',
      callback: () => this.openBulkImport(),
    });

    this.addCommand({
      id: 'open-book-search-modal-to-insert',
      name: 'Insert metadata into current note',
      icon: 'file-input',
      callback: () => this.insertMetadata(),
    });

    this.addSettingTab(new BookSearchSettingTab(this.app, this));

    console.log(`Media Search: version ${this.manifest.version} (requires obsidian ${this.manifest.minAppVersion})`);
  }

  get enabledTypes(): MediaType[] {
    return MEDIA_TYPES.filter(type => this.settings.mediaTypes[type].enabled);
  }

  showNotice(message: unknown) {
    try {
      new Notice(message instanceof Error ? message.message : String(message));
    } catch {
      // ignore
    }
  }

  private handleError(err: unknown) {
    if (err instanceof CancelledError) return;
    console.warn('[Media Search]', err);
    this.showNotice(
      err instanceof MissingApiKeyError ? err.message : `Media Search: ${(err as Error)?.message ?? err}`,
    );
  }

  // ------------------------------------------------------------------ modals as promises

  pickType(placeholder?: string): Promise<MediaType> {
    const types = this.enabledTypes;
    if (types.length === 1) return Promise.resolve(types[0]);
    return new Promise((resolve, reject) =>
      new MediaTypePickerModal(
        this.app,
        types,
        (err, type) => (err ? reject(err) : resolve(type!)),
        placeholder,
      ).open(),
    );
  }

  openSearchModal(type: MediaType, query = ''): Promise<SearchOutcome> {
    return new Promise((resolve, reject) =>
      new MediaSearchModal(this, type, query, (err, outcome) => (err ? reject(err) : resolve(outcome!))).open(),
    );
  }

  openSuggestModal(type: MediaType, results: SearchResult[]): Promise<SearchResult> {
    return new Promise((resolve, reject) =>
      new MediaSuggestModal(this.app, type, this.settings.showCoverImageInSearch, results, (err, result) =>
        err ? reject(err) : resolve(result!),
      ).open(),
    );
  }

  /** Search → pick → load full details. */
  async searchAndPick(type: MediaType, query?: string): Promise<MediaItem> {
    const { results } = await this.openSearchModal(type, query);
    const chosen = await this.openSuggestModal(type, results);
    return this.loadFullItem(type, chosen);
  }

  async loadFullItem(type: MediaType, result: SearchResult): Promise<MediaItem> {
    const notice = new Notice(`Loading ${result.item.title}…`, 0);
    try {
      return await loadDetails(this.settings, type, result);
    } finally {
      notice.hide();
    }
  }

  // ------------------------------------------------------------------ commands

  async pickTypeAndCreate() {
    try {
      const type = await this.pickType();
      await this.createNewNote(type);
    } catch (err) {
      this.handleError(err);
    }
  }

  async createNewNote(type: MediaType): Promise<void> {
    try {
      const item = await this.searchAndPick(type);
      const { file, created } = await this.createNote(type, item);
      if (!created) this.showNotice(`"${file.basename}" already exists — opened it instead.`);
      await this.openNote(file, created);
    } catch (err) {
      this.handleError(err);
    }
  }

  async insertMetadata(): Promise<void> {
    try {
      const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!markdownView?.file || !markdownView.editor) {
        this.showNotice('Open a note first.');
        return;
      }
      const type = await this.pickType('Insert metadata for…');
      const selection = markdownView.editor.getSelection().trim();
      const item = await this.searchAndPick(type, selection || markdownView.file.basename);
      const renderedContents = await this.getRenderedContents(type, item);
      markdownView.editor.replaceRange(renderedContents, { line: 0, ch: 0 });
    } catch (err) {
      this.handleError(err);
    }
  }

  openBulkImport() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor: Editor | undefined = view?.editor;
    const selection = editor?.getSelection() ?? '';
    const source =
      editor && selection.trim()
        ? {
            editor,
            from: editor.getCursor('from'),
            to: editor.getCursor('to'),
            text: selection,
            file: view?.file ?? null,
          }
        : undefined;
    new BulkImportModal(this, source).open();
  }

  // ------------------------------------------------------------------ notes

  folderFor(type: MediaType) {
    return this.settings.mediaTypes[type].folder.replace(/\/+$/, '');
  }

  notePathFor(type: MediaType, item: MediaItem) {
    const fileName = makeFileName(item, this.settings.mediaTypes[type].fileNameFormat);
    const folder = this.folderFor(type);
    return normalizePath(folder ? `${folder}/${fileName}` : fileName);
  }

  /** Finds a note for this item by path, or by an id (ISBN, TMDB, IMDb, Deezer…) in any note's frontmatter. */
  findExistingNote(type: MediaType, item: MediaItem, index?: Map<string, TFile>): TFile | undefined {
    const byPath = this.app.vault.getAbstractFileByPath(this.notePathFor(type, item));
    if (byPath instanceof TFile) return byPath;
    const ids = itemIdentifiers(item);
    if (!ids.length) return undefined;
    const lookup = index ?? this.buildIdentifierIndex();
    for (const id of ids) {
      const file = lookup.get(id);
      if (file) return file;
    }
    return undefined;
  }

  /** id → note, from the frontmatter of every note in the vault. */
  buildIdentifierIndex(): Map<string, TFile> {
    const index = new Map<string, TFile>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;
      const hasAny = Object.keys(frontmatter).some(key =>
        IDENTIFIER_KEYS.some(id => key.replace(/_/g, '').toLowerCase() === id.toLowerCase()),
      );
      if (!hasAny) continue;
      itemIdentifiers(frontmatter).forEach(id => index.set(id, file));
    }
    return index;
  }

  async ensureFolder(folder: string) {
    if (!folder) return;
    const parts = normalizePath(folder).split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.createFolder(path);
    }
  }

  async createNote(type: MediaType, item: MediaItem, index?: Map<string, TFile>): Promise<CreateNoteResult> {
    const existing = this.findExistingNote(type, item, index);
    if (existing) return { file: existing, created: false };

    const renderedContents = await this.getRenderedContents(type, item);
    await this.ensureFolder(this.folderFor(type));
    const file = await this.app.vault.create(this.notePathFor(type, item), renderedContents);
    await useTemplaterPluginInFile(this.app, file);
    return { file, created: true };
  }

  async openNote(targetFile: TFile, isNew = true) {
    if (!this.settings.openPageOnCompletion && isNew) return;

    const leaf = this.app.workspace.getLeaf();
    if (!leaf) return;
    await leaf.openFile(targetFile, { state: { mode: 'source' } });
    if (!isNew) return;
    leaf.setEphemeralState({ rename: 'all' });
    await new CursorJumper(this.app).jumpToNextCursorLocation();
  }

  async getRenderedContents(type: MediaType, item: MediaItem): Promise<string> {
    const { useDefaultFrontmatter, defaultFrontmatterKeyType, enableCoverImageSave, frontmatter, content } =
      this.settings;
    const typeSettings = this.settings.mediaTypes[type];

    if (enableCoverImageSave) {
      const coverImageUrl = item.coverLargeUrl || item.coverMediumUrl || item.coverUrl || item.coverSmallUrl;
      if (coverImageUrl) {
        const extension = /\.png(\?|$)/i.test(coverImageUrl) ? 'png' : 'jpg';
        const imageName = makeFileName(item, typeSettings.fileNameFormat, extension);
        item.localCoverImage = await this.downloadAndSaveImage(imageName, typeSettings.coverImagePath, coverImageUrl);
      }
    }

    if (typeSettings.templateFile) {
      const templateContents = await getTemplateContents(this.app, typeSettings.templateFile);
      const replaced = replaceVariableSyntax(
        buildTemplateVariables(item),
        applyTemplateTransformations(templateContents),
      );
      return executeInlineScriptsTemplates(item, replaced);
    }

    // no template: dump every field as frontmatter (plus the legacy custom frontmatter/content)
    let renderedFrontmatter = replaceVariableSyntax(item, frontmatter);
    if (useDefaultFrontmatter) {
      renderedFrontmatter = toStringFrontMatter(
        applyDefaultFrontMatter({ ...item }, renderedFrontmatter, defaultFrontmatterKeyType),
      );
    }
    const renderedContent = replaceVariableSyntax(item, content);
    return renderedFrontmatter ? `---\n${renderedFrontmatter}\n---\n${renderedContent}` : renderedContent;
  }

  async downloadAndSaveImage(imageName: string, directory: string, imageUrl: string): Promise<string> {
    try {
      const folder = (directory ?? '').replace(/\/+$/, '');
      const filePath = normalizePath(folder ? `${folder}/${imageName}` : imageName);
      if (await this.app.vault.adapter.exists(filePath)) return filePath;

      const response = await requestUrl({ url: imageUrl, method: 'GET', headers: { Accept: '*/*' } });
      if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${imageUrl}`);

      await this.ensureFolder(folder);
      await this.app.vault.adapter.writeBinary(filePath, response.arrayBuffer);
      return filePath;
    } catch (error) {
      console.error('Error downloading or saving cover image:', error);
      this.showNotice(`Cover image save failed: ${error?.message ?? error}`);
      return '';
    }
  }

  async loadSettings() {
    this.settings = migrateSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
