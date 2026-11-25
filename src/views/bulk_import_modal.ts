import { MediaType, SearchResult } from '@models/media.model';
import type MediaSearchPlugin from '@src/main';
import { isConfidentMatch, loadDetails, searchMedia } from '@src/media/registry';
import { MEDIA_TYPE_INFO } from '@src/media/type_info';
import { cleanListLine, parseList } from '@src/search/query_parser';
import { ButtonComponent, Editor, EditorPosition, Modal, Notice, Setting, TextAreaComponent, TFile } from 'obsidian';
import { CancelledError, MediaSearchModal } from './media_search_modal';
import { MediaSuggestModal, renderResult } from './media_suggest_modal';

export interface BulkSource {
  editor: Editor;
  from: EditorPosition;
  to: EditorPosition;
  text: string;
  file: TFile | null;
}

type RowStatus = 'pending' | 'searching' | 'match' | 'check' | 'notfound' | 'exists' | 'error' | 'created' | 'failed';

interface Row {
  query: string;
  lineIndexes: number[];
  status: RowStatus;
  results: SearchResult[];
  chosen?: SearchResult;
  existing?: TFile;
  file?: TFile;
  include: boolean;
  message?: string;
  el?: HTMLElement;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  pending: 'Waiting',
  searching: 'Searching…',
  match: 'Match',
  check: 'Check',
  notfound: 'Not found',
  exists: 'Already in vault',
  error: 'Error',
  created: 'Created',
  failed: 'Failed',
};

const CONCURRENCY = 2;
const LIST_PREFIX = /^(\s*(?:>+\s*)?(?:[-*+•]\s+|\d{1,4}[.)]\s+)?(?:\[[ xX/-]\]\s*)?)/;

export class BulkImportModal extends Modal {
  private type: MediaType;
  private text: string;
  private rows: Row[] = [];
  private replaceWithLinks = true;
  private busy = false;
  private cancelled = false;
  private listEl?: HTMLElement;
  private summaryEl?: HTMLElement;
  private createButton?: ButtonComponent;
  private identifierIndex?: Map<string, TFile>;

  constructor(
    private plugin: MediaSearchPlugin,
    private source?: BulkSource,
  ) {
    super(plugin.app);
    this.type = plugin.enabledTypes[0] ?? 'book';
    this.text = source?.text ?? '';
    this.modalEl.addClass('media-search__bulk-modal');
  }

  onOpen() {
    this.renderInput();
  }

  onClose() {
    this.cancelled = true;
    this.contentEl.empty();
  }

  // ------------------------------------------------------------------ step 1: paste

  private renderInput() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Create notes from a list' });

    new Setting(contentEl).setName('Type').addDropdown(dropdown => {
      this.plugin.enabledTypes.forEach(type => dropdown.addOption(type, MEDIA_TYPE_INFO[type].plural));
      dropdown.setValue(this.type).onChange(value => (this.type = value as MediaType));
    });

    const hint = contentEl.createDiv({ cls: 'setting-item-description media-search__bulk-hint' });
    hint.setText(
      'One per line. Bullets, numbering, checkboxes, [[links]], ISBNs, IMDb links, "Title by Author", "Artist - Album" and years like "Heat (1995)" all work.',
    );

    const textArea = new TextAreaComponent(contentEl)
      .setPlaceholder('Dune by Frank Herbert\nThe Left Hand of Darkness\n9780441013593')
      .setValue(this.text)
      .onChange(value => (this.text = value));
    textArea.inputEl.addClass('media-search__bulk-textarea');
    textArea.inputEl.rows = 12;
    window.setTimeout(() => textArea.inputEl.focus(), 0);

    new Setting(contentEl).addButton(button =>
      button
        .setButtonText('Find matches')
        .setCta()
        .onClick(() => this.startSearch()),
    );
  }

  /** Builds rows and remembers which selected line(s) each came from. */
  private buildRows(): Row[] {
    const rows: Row[] = [];
    const byKey = new Map<string, Row>();
    this.text.split(/\r?\n/).forEach((line, lineIndex) => {
      for (const query of parseList(line)) {
        const key = cleanListLine(query).toLowerCase();
        const existing = byKey.get(key);
        if (existing) {
          existing.lineIndexes.push(lineIndex);
          continue;
        }
        const row: Row = { query, lineIndexes: [lineIndex], status: 'pending', results: [], include: false };
        byKey.set(key, row);
        rows.push(row);
      }
    });
    return rows;
  }

  private async startSearch() {
    this.rows = this.buildRows();
    if (!this.rows.length) return void new Notice('Nothing to search for.');
    if (this.rows.length > 200) return void new Notice('That is a lot! Please import at most 200 at a time.');

    this.identifierIndex = this.plugin.buildIdentifierIndex();
    this.renderReview();

    let next = 0;
    let missingKeyError: Error | undefined;
    const worker = async () => {
      while (next < this.rows.length && !this.cancelled && !missingKeyError) {
        const row = this.rows[next++];
        try {
          await this.searchRow(row);
        } catch (err) {
          if ((err as Error).name === 'MissingApiKeyError') missingKeyError = err as Error;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (missingKeyError) {
      new Notice((missingKeyError as Error).message);
      this.rows
        .filter(r => r.status === 'pending')
        .forEach(r => this.setRow(r, { status: 'error', message: 'No API key' }));
    }
    this.updateSummary();
  }

  private async searchRow(row: Row) {
    this.setRow(row, { status: 'searching' });
    try {
      const { results } = await searchMedia(this.plugin.settings, this.type, row.query);
      row.results = results.slice(0, 20);
      if (!results.length) {
        this.setRow(row, { status: 'notfound', include: false });
        return;
      }
      this.choose(row, results[0], isConfidentMatch(results) ? 'match' : 'check');
    } catch (err) {
      this.setRow(row, { status: 'error', message: (err as Error).message, include: false });
      throw err;
    }
  }

  private choose(row: Row, result: SearchResult, status: 'match' | 'check') {
    row.chosen = result;
    const existing = this.plugin.findExistingNote(this.type, result.item, this.identifierIndex);
    if (existing) {
      this.setRow(row, { status: 'exists', existing, include: false });
    } else {
      // uncertain matches are included too, but highlighted so they get a look
      this.setRow(row, { status, existing: undefined, include: true });
    }
  }

  // ------------------------------------------------------------------ step 2: review

  private renderReview() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: `Create ${MEDIA_TYPE_INFO[this.type].plural.toLowerCase()} from a list` });
    this.summaryEl = contentEl.createDiv({ cls: 'media-search__bulk-summary' });
    this.listEl = contentEl.createDiv({ cls: 'media-search__bulk-list' });
    this.rows.forEach(row => this.renderRow(row));

    const footer = new Setting(contentEl);
    if (this.source) {
      footer
        .setName('Replace selected lines with links')
        .addToggle(toggle => toggle.setValue(this.replaceWithLinks).onChange(value => (this.replaceWithLinks = value)));
    }
    footer
      .addButton(button =>
        button.setButtonText('Back').onClick(() => {
          if (this.busy) return;
          this.renderInput();
        }),
      )
      .addButton(button => {
        this.createButton = button.setCta().onClick(() => this.createNotes());
      });
    this.updateSummary();
  }

  private setRow(row: Row, patch: Partial<Row>) {
    Object.assign(row, patch);
    this.renderRow(row);
    this.updateSummary();
  }

  private renderRow(row: Row) {
    if (!this.listEl) return;
    const el = row.el ?? this.listEl.createDiv();
    row.el = el;
    el.empty();
    el.className = `media-search__bulk-row is-${row.status}`;

    const checkbox = el.createEl('input', { type: 'checkbox', cls: 'media-search__bulk-check' });
    checkbox.checked = row.include;
    checkbox.disabled = !row.chosen || this.busy || row.status === 'created';
    checkbox.addEventListener('change', () => {
      row.include = checkbox.checked;
      this.updateSummary();
    });

    const body = el.createDiv({ cls: 'media-search__bulk-body' });
    if (row.chosen) {
      renderResult(body.createDiv({ cls: 'media-search__bulk-result' }), this.type, row.chosen, {
        showCover: this.plugin.settings.showCoverImageInSearch,
      });
    } else {
      body.createDiv({ cls: 'media-search__bulk-empty', text: row.status === 'searching' ? 'Searching…' : '—' });
    }
    const queryEl = body.createDiv({ cls: 'media-search__bulk-query' });
    queryEl.setText(`“${row.query}”${row.message ? ` — ${row.message}` : ''}`);

    const side = el.createDiv({ cls: 'media-search__bulk-side' });
    side.createSpan({ cls: `media-search__pill is-${row.status}`, text: STATUS_LABEL[row.status] });

    const actions = side.createDiv({ cls: 'media-search__bulk-actions' });
    const file = row.file ?? row.existing;
    if (file) {
      actions.createEl('a', { text: 'Open', href: '#' }).addEventListener('click', event => {
        event.preventDefault();
        this.plugin.app.workspace.getLeaf('tab').openFile(file);
      });
    }
    if (!this.busy && row.status !== 'created' && row.status !== 'searching' && row.status !== 'pending') {
      if (row.results.length > 1) {
        actions.createEl('a', { text: 'Change', href: '#' }).addEventListener('click', event => {
          event.preventDefault();
          this.pickFromResults(row);
        });
      }
      actions.createEl('a', { text: 'Search', href: '#' }).addEventListener('click', event => {
        event.preventDefault();
        this.searchManually(row);
      });
    }
  }

  private pickFromResults(row: Row) {
    new MediaSuggestModal(
      this.app,
      this.type,
      this.plugin.settings.showCoverImageInSearch,
      row.results,
      (err, result) => {
        if (!err && result) this.choose(row, result, 'match');
      },
    ).open();
  }

  private searchManually(row: Row) {
    new MediaSearchModal(this.plugin, this.type, cleanListLine(row.query), (err, outcome) => {
      if (err || !outcome) {
        if (!(err instanceof CancelledError) && err) new Notice(err.message);
        return;
      }
      row.results = outcome.results.slice(0, 20);
      new MediaSuggestModal(
        this.app,
        this.type,
        this.plugin.settings.showCoverImageInSearch,
        row.results,
        (e, result) => {
          if (!e && result) this.choose(row, result, 'match');
        },
      ).open();
    }).open();
  }

  private updateSummary() {
    if (!this.summaryEl) return;
    const count = (status: RowStatus) => this.rows.filter(r => r.status === status).length;
    const parts = [
      `${count('match')} matched`,
      `${count('check')} to check`,
      `${count('notfound')} not found`,
      `${count('exists')} already in vault`,
    ];
    const searching = count('searching') + count('pending');
    if (searching) parts.unshift(`searching ${this.rows.length - searching}/${this.rows.length}`);
    if (count('created')) parts.push(`${count('created')} created`);
    if (count('error') + count('failed')) parts.push(`${count('error') + count('failed')} errors`);
    this.summaryEl.setText(parts.join(' · '));

    const selected = this.rows.filter(r => r.include && r.chosen && r.status !== 'created').length;
    this.createButton
      ?.setButtonText(this.busy ? 'Creating…' : `Create ${selected} note${selected === 1 ? '' : 's'}`)
      .setDisabled(this.busy || !selected || searching > 0);
  }

  // ------------------------------------------------------------------ step 3: create

  private async createNotes() {
    const selected = this.rows.filter(r => r.include && r.chosen && r.status !== 'created');
    if (!selected.length || this.busy) return;
    this.busy = true;
    this.rows.forEach(r => this.renderRow(r));
    this.updateSummary();

    let created = 0;
    for (const row of selected) {
      if (this.cancelled) break;
      this.setRow(row, { message: 'loading details…' });
      try {
        const item = await loadDetails(this.plugin.settings, this.type, row.chosen!);
        const result = await this.plugin.createNote(this.type, item, this.identifierIndex);
        if (result.created) created++;
        this.setRow(row, {
          status: result.created ? 'created' : 'exists',
          file: result.file,
          include: false,
          message: undefined,
        });
      } catch (err) {
        console.warn('[Media Search] bulk create failed', err);
        this.setRow(row, { status: 'failed', message: (err as Error).message });
      }
    }

    this.busy = false;
    if (this.source && this.replaceWithLinks) this.replaceSelection();
    this.rows.forEach(r => this.renderRow(r));
    this.updateSummary();
    new Notice(`Media Search: created ${created} note${created === 1 ? '' : 's'}.`);
  }

  /** Swaps each selected line for a link to its note, keeping bullets/numbering/checkboxes. */
  private replaceSelection() {
    const source = this.source;
    if (!source) return;
    if (source.editor.getRange(source.from, source.to) !== source.text) {
      new Notice('The selection changed, so the list was not replaced with links.');
      return;
    }

    const sourcePath = source.file?.path ?? '';
    const linksByLine = new Map<number, string[]>();
    for (const row of this.rows) {
      const file = row.file ?? row.existing;
      if (!file) continue;
      const link = this.app.fileManager.generateMarkdownLink(file, sourcePath);
      row.lineIndexes.forEach(i => linksByLine.set(i, [...(linksByLine.get(i) ?? []), link]));
    }
    if (!linksByLine.size) return;

    const lines = source.text.split(/\r?\n/);
    const replaced = lines.map((line, i) => {
      const links = linksByLine.get(i);
      if (!links) return line;
      const prefix = line.match(LIST_PREFIX)?.[1] ?? '';
      return `${prefix}${links.join(', ')}`;
    });
    source.editor.replaceRange(replaced.join('\n'), source.from, source.to);
    // the selection is gone now; don't replace twice
    this.source = {
      ...source,
      text: replaced.join('\n'),
      to: source.editor.offsetToPos(source.editor.posToOffset(source.from) + replaced.join('\n').length),
    };
  }
}
