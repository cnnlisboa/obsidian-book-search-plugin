import { MediaType, SearchResult } from '@models/media.model';
import { describeItem, isConfidentMatch } from '@src/media/registry';
import { normalize } from '@src/search/ranking';
import { App, SuggestModal } from 'obsidian';
import { CancelledError } from './media_search_modal';

export function renderResult(
  el: HTMLElement,
  type: MediaType,
  result: SearchResult,
  options: { showCover: boolean; badge?: string },
) {
  el.addClass('book-suggestion-item');
  const { item } = result;
  const cover = item.coverSmallUrl || item.coverMediumUrl || item.coverUrl || item.coverLargeUrl;

  if (options.showCover && cover) {
    el.createEl('img', {
      cls: ['book-cover-image', type === 'artist' ? 'media-search__cover--round' : ''].filter(Boolean),
      attr: { src: cover, alt: `Cover for ${item.title}`, loading: 'lazy' },
    });
  }

  const text = el.createDiv({ cls: 'book-text-info' });
  const titleRow = text.createDiv({ cls: 'media-search__title-row' });
  titleRow.createSpan({ text: item.title, cls: 'media-search__title' });
  if (options.badge) titleRow.createSpan({ text: options.badge, cls: 'media-search__badge' });

  const description = describeItem(type, item);
  if (description) text.createEl('small', { text: description });

  const sources = result.sources?.length ? result.sources : [result.source];
  text.createDiv({ cls: 'media-search__source', text: sources.join(' + ') });
}

/** Step 2: pick one of the ranked results. */
export class MediaSuggestModal extends SuggestModal<SearchResult> {
  private chosen = false;
  private readonly confident: boolean;

  constructor(
    app: App,
    private readonly type: MediaType,
    private readonly showCover: boolean,
    private readonly results: SearchResult[],
    private onChoose: (error: Error | null, result?: SearchResult) => void,
  ) {
    super(app);
    this.confident = isConfidentMatch(results);
    this.setPlaceholder('Filter results…');
    this.limit = 50;
  }

  getSuggestions(query: string): SearchResult[] {
    const q = normalize(query);
    if (!q) return this.results;
    return this.results.filter(({ item }) => normalize(`${item.title} ${describeItem(this.type, item)}`).includes(q));
  }

  renderSuggestion(result: SearchResult, el: HTMLElement) {
    const badge = this.confident && result === this.results[0] ? 'Best match' : undefined;
    renderResult(el, this.type, result, { showCover: this.showCover, badge });
  }

  onChooseSuggestion(result: SearchResult) {
    this.chosen = true;
    this.onChoose(null, result);
  }

  onClose() {
    super.onClose();
    // onChooseSuggestion fires after onClose, so wait a tick before treating this as a cancel
    window.setTimeout(() => {
      if (!this.chosen) this.onChoose(new CancelledError());
    }, 50);
  }
}
