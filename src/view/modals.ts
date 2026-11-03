import { App, Modal } from 'obsidian';
import type { PaperImage } from '../types';
import { el } from './dom';

export class CoverPickerModal extends Modal {
  constructor(
    app: App,
    private readonly images: PaperImage[],
    private readonly current: string | null,
    private readonly coverUrl: (path: string) => string,
    private readonly onPick: (path: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('选择封面图');
    this.contentEl.addClass('pa-modal');
    // Obsidian 的 modal 宽度会被内容撑开，这里直接锁死，避免图片一多就横向溢出
    this.modalEl.style.width = '720px';
    this.modalEl.style.maxWidth = '92vw';

    const usable = this.images.filter((image) => image.path);

    if (!usable.length) {
      this.contentEl.appendChild(el('p', 'pa-modal-empty', '这篇笔记里没有可用的图片。'));
    } else {
      const grid = el('div', 'pa-cover-grid');
      for (const image of usable) {
        const cell = el('div', 'pa-cover-cell');
        cell.tabIndex = 0;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', image.link);
        cell.classList.toggle('is-current', image.path === this.current);

        const thumb = el('div', 'pa-cover-thumb-wrap');
        const img = el('img', 'pa-cover-thumb');
        img.src = this.coverUrl(image.path);
        img.loading = 'lazy';
        img.alt = image.link;
        img.draggable = false;
        thumb.appendChild(img);
        if (image.path === this.current) thumb.appendChild(el('span', 'pa-cover-current', '当前'));
        cell.appendChild(thumb);

        cell.appendChild(el('span', 'pa-cover-name', image.link.split('/').pop() || image.link));

        const choose = (): void => {
          this.onPick(image.path);
          this.close();
        };
        cell.addEventListener('click', choose);
        cell.addEventListener('keydown', (event) => {
          const evt = event as KeyboardEvent;
          if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            choose();
          }
        });
        grid.appendChild(cell);
      }
      this.contentEl.appendChild(grid);
    }

    const footer = el('div', 'pa-modal-footer');
    const useDefault = el('button', 'pa-btn', '使用笔记第一张');
    useDefault.type = 'button';
    useDefault.addEventListener('click', () => {
      this.onPick(null);
      this.close();
    });
    footer.appendChild(useDefault);
    this.contentEl.appendChild(footer);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TextPromptModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly initial: string,
    private readonly placeholder: string,
    private readonly onSubmit: (value: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.contentEl.addClass('pa-modal');
    const input = el('input', 'pa-input');
    input.type = 'text';
    input.value = this.initial;
    input.placeholder = this.placeholder;
    this.contentEl.appendChild(input);

    const footer = el('div', 'pa-modal-footer');
    const save = el('button', 'pa-btn mod-cta', '确定');
    save.type = 'button';
    const cancel = el('button', 'pa-btn', '取消');
    cancel.type = 'button';
    const submit = (): void => {
      this.onSubmit(input.value.trim());
      this.close();
    };
    save.addEventListener('click', submit);
    cancel.addEventListener('click', () => this.close());
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        submit();
      }
    });
    footer.append(save, cancel);
    this.contentEl.appendChild(footer);
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


export class TextAreaModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly initial: string,
    private readonly placeholder: string,
    private readonly onSave: (value: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.contentEl.addClass('pa-modal');
    this.modalEl.style.width = '640px';
    this.modalEl.style.maxWidth = '92vw';

    const area = el('textarea', 'pa-input pa-textarea');
    area.value = this.initial;
    area.rows = 14;
    area.placeholder = this.placeholder;
    this.contentEl.appendChild(area);
    this.contentEl.appendChild(el('p', 'pa-modal-hint', 'Ctrl/Cmd + Enter 保存，Esc 取消'));

    const footer = el('div', 'pa-modal-footer');
    const save = el('button', 'pa-btn mod-cta', '保存');
    save.type = 'button';
    const cancel = el('button', 'pa-btn', '取消');
    cancel.type = 'button';
    save.addEventListener('click', () => {
      this.onSave(area.value);
      this.close();
    });
    cancel.addEventListener('click', () => this.close());
    area.addEventListener('keydown', (event) => {
      const evt = event as KeyboardEvent;
      if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
        evt.preventDefault();
        this.onSave(area.value);
        this.close();
      }
    });
    footer.append(save, cancel);
    this.contentEl.appendChild(footer);

    window.setTimeout(() => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
