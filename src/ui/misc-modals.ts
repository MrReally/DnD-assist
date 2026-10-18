import { Modal, Setting, SuggestModal, type App } from 'obsidian';
import { CATEGORY_LABELS, searchItems, type SearchHit } from '../domain/canvas-model';
import type { Controller } from '../controller';
import type { RootCandidate } from '../services/adventure-registry';
import { button } from './common';

/** Explicit activation: "use the current Canvas as an adventure". Shows the verifiable root mapping. */
export class RegisterAdventureModal extends Modal {
	constructor(
		private readonly ctl: Controller,
		private readonly candidates: RootCandidate[],
	) {
		super(ctl.app);
	}

	override onOpen(): void {
		const el = this.contentEl;
		this.titleEl.setText('Использовать Canvas как приключение');
		el.createEl('p', {
			text: 'Выберите корневую папку приключения. Папки не создаются и не переименовываются; в корне появится один служебный файл .canvas-assist-state.json.',
		});
		let chosen = this.candidates[0]?.path ?? '';
		let name = chosen.split('/').pop() ?? chosen;
		const nameSetting = new Setting(el).setName('Название').addText((t) => {
			t.setValue(name).onChange((v) => (name = v));
			t.inputEl.dataset.testid = 'reg-name';
		});
		for (const c of this.candidates) {
			const desc = [c.hasState ? 'есть файл состояния' : '', c.markers.length ? `подпапки: ${c.markers.join(', ')}` : 'известных подпапок нет'].filter(Boolean).join(' · ');
			new Setting(el).setName(c.path).setDesc(desc).addButton((b) =>
				b.setButtonText(chosen === c.path ? 'Выбрано' : 'Выбрать').onClick(() => {
					chosen = c.path;
					name = c.path.split('/').pop() ?? c.path;
					this.contentEl.empty();
					this.onOpen();
				}),
			);
		}
		void nameSetting;
		const err = el.createDiv({ cls: 'ca-error' });
		const v = this.ctl.registry.validateNewRoot(chosen);
		if (v) err.setText(v);
		const row = el.createDiv({ cls: 'ca-modal-buttons' });
		button(row, 'Отмена', () => this.close());
		button(row, `Подключить «${chosen}»`, () => void (async () => {
			try {
				await this.ctl.registerAdventure(chosen, name.trim() || chosen);
				this.close();
			} catch (e) {
				err.setText(e instanceof Error ? e.message : String(e));
			}
		})(), { cls: 'mod-cta', disabled: !!v || !chosen, testId: 'reg-submit' });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Read-only recovery / version conflict. Never silently overwrites; both copies are kept. */
export class RecoveryModal extends Modal {
	constructor(private readonly ctl: Controller) {
		super(ctl.app);
	}

	override onOpen(): void {
		const store = this.ctl.store;
		const el = this.contentEl;
		if (!store) return this.close();
		const info = store.info;
		this.titleEl.setText(info.mode === 'conflict' ? 'Конфликт версий' : 'Режим восстановления');
		el.createEl('p', { text: info.message ?? '' });
		if (info.backupPath) el.createEl('p', { cls: 'ca-muted', text: `Копия: ${info.backupPath}` });
		const row = el.createDiv({ cls: 'ca-modal-buttons' });
		if (info.mode === 'conflict') {
			button(row, 'Взять версию с диска', () => void store.resolveUseExternal().then(() => this.close()), { testId: 'conflict-external' });
			button(row, 'Оставить мою версию', () => void store.resolveUseLocal().then(() => this.close()), { cls: 'mod-warning', testId: 'conflict-local' });
		} else {
			button(row, 'Перечитать файл', () => void store.load().then(() => this.close()));
			const adv = this.ctl.adventure;
			if (adv) {
				button(row, 'Начать новое состояние (оригинал сохраняется копией)', () => void store.resetFromRecovery(adv.adventureId, adv.name).then(() => this.close()), { cls: 'mod-warning', testId: 'recovery-reset' });
			}
		}
		button(row, 'Закрыть', () => this.close());
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Shift+F: search inside the active Canvas only. */
export class CanvasSearchModal extends SuggestModal<SearchHit> {
	constructor(
		app: App,
		private readonly ctl: Controller,
		private readonly onPick: (hit: SearchHit) => void,
	) {
		super(app);
		this.setPlaceholder('Поиск по текущему Canvas: заголовок, текст, файл, алиасы, группы…');
		this.limit = 50;
	}

	override getSuggestions(query: string): SearchHit[] {
		const idx = this.ctl.lastIndex;
		if (!idx) return [];
		return searchItems(idx.items, query, { foldYo: this.ctl.settings.foldYo, includeIgnored: false, limit: 50 });
	}

	override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
		el.addClass('ca-suggestion');
		el.createDiv({ text: hit.item.title, cls: 'ca-suggestion-title' });
		el.createDiv({ text: `${CATEGORY_LABELS[hit.item.category]}${hit.item.subtitle ? ` · ${hit.item.subtitle}` : ''}`, cls: 'ca-muted' });
	}

	override onChooseSuggestion(hit: SearchHit): void {
		this.onPick(hit);
	}
}
