import { MediaType } from '@models/media.model';
import { MEDIA_TYPE_INFO } from '@src/media/type_info';
import { App, FuzzySuggestModal, setIcon } from 'obsidian';
import { CancelledError } from './media_search_modal';

/** Asks which kind of media to search for. */
export class MediaTypePickerModal extends FuzzySuggestModal<MediaType> {
  private chosen = false;

  constructor(
    app: App,
    private readonly types: MediaType[],
    private readonly onChoose: (error: Error | null, type?: MediaType) => void,
    placeholder = 'What do you want to add?',
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): MediaType[] {
    return this.types;
  }

  getItemText(type: MediaType): string {
    return MEDIA_TYPE_INFO[type].label;
  }

  renderSuggestion(match: { item: MediaType }, el: HTMLElement) {
    el.addClass('media-search__type-option');
    setIcon(el.createSpan({ cls: 'media-search__type-icon' }), MEDIA_TYPE_INFO[match.item].icon);
    el.createSpan({ text: MEDIA_TYPE_INFO[match.item].label });
  }

  onChooseItem(type: MediaType) {
    this.chosen = true;
    this.onChoose(null, type);
  }

  onClose() {
    super.onClose();
    window.setTimeout(() => {
      if (!this.chosen) this.onChoose(new CancelledError());
    }, 50);
  }
}
