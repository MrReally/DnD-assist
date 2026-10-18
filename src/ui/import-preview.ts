// JSON import: pick a .json file inside the vault or paste text → preview with validation,
// destination and diff → explicit «Импортировать». Nothing is written before that.
import { Modal, Setting, TFile } from 'obsidian';
import type { Controller } from '../controller';
import { applyImport, prepareImport, previewPlan, type ImportCandidate, type ImportReportLine } from '../services/import-service';
import { button } from './common';

export class ImportModal extends Modal {
	private text = '';
	private candidates: ImportCandidate[] = [];
	private fatal: string | null = null;
	private overwriteRuntime = false;
	private partyId: string | null;
	private report: ImportReportLine[] | null = null;
	private busy = false;

	constructor(
		private readonly ctl: Controller,
		initialText = '',
	) {
		super(ctl.app);
		this.text = initialText;
		this.partyId = ctl.state?.activePartyId ?? null;
	}

	override onOpen(): void {
		this.modalEl.addClass('ca-import-modal');
		this.titleEl.setText('Импорт персонажей из JSON');
		this.render();
	}

	private async analyze(): Promise<void> {
		const s = this.ctl.state;
		if (!s) return;
		const r = await prepareImport(this.ctl.port, s, this.text);
		this.fatal = r.fatal;
		this.candidates = r.candidates;
		this.report = null;
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const s = this.ctl.state;
		if (!s) {
			el.createEl('p', { text: 'Нет активного приключения.' });
			return;
		}
		el.createEl('p', {
			cls: 'ca-muted',
			text: 'Формат: schemas/character-import.schema.json (один объект, массив или {"characters": [...]}). OCR и распознавание фото не выполняются. Неизвестные поля листа оставляйте пустыми — плагин их не угадывает.',
		});
		const jsonFiles = this.app.vault.getFiles().filter((f) => f.extension === 'json').slice(0, 500);
		new Setting(el).setName('JSON-файл в хранилище').addDropdown((dd) => {
			dd.addOption('', '— вставить текст ниже —');
			for (const f of jsonFiles) dd.addOption(f.path, f.path);
			dd.onChange(async (path) => {
				const f = this.app.vault.getAbstractFileByPath(path);
				if (f instanceof TFile) {
					this.text = await this.app.vault.cachedRead(f);
					await this.analyze();
				}
			});
			dd.selectEl.dataset.testid = 'import-file';
		});
		const ta = el.createEl('textarea', { cls: 'ca-import-text', attr: { placeholder: '{ "schemaVersion": 1, "kind": "player-character", "name": "…" }', 'data-testid': 'import-text' } });
		ta.value = this.text;
		ta.addEventListener('input', () => (this.text = ta.value));
		const row0 = el.createDiv({ cls: 'ca-modal-buttons' });
		button(row0, 'Проверить', () => void this.analyze(), { cls: 'mod-cta', testId: 'import-analyze' });

		if (this.fatal) el.createDiv({ cls: 'ca-error', text: this.fatal, attr: { 'data-testid': 'import-fatal' } });

		if (this.candidates.length) {
			const list = el.createDiv({ cls: 'ca-import-list' });
			for (const c of this.candidates) this.renderCandidate(list, c);
			new Setting(el)
				.setName('Перезаписать текущие значения')
				.setDesc('Текущие хиты, ячейки, кости хитов и счётчики из JSON. По умолчанию сохраняются значения из Canvas Assist.')
				.addToggle((t) =>
					t.setValue(this.overwriteRuntime).onChange((v) => {
						this.overwriteRuntime = v;
						this.render();
					}),
				);
			new Setting(el).setName('Добавить в партию').addDropdown((dd) => {
				dd.addOption('', '— не добавлять —');
				for (const p of s.parties) dd.addOption(p.id, p.name);
				dd.setValue(this.partyId ?? '').onChange((v) => (this.partyId = v || null));
			});
			el.createEl('p', {
				cls: 'ca-muted',
				text: 'Undo: состояние откатывается полностью; служебный блок заметки восстанавливается, только если вы не правили его после импорта. Созданные файлы не удаляются автоматически.',
			});
			const n = this.candidates.filter((c) => c.mode !== 'skip' && c.input).length;
			const row = el.createDiv({ cls: 'ca-modal-buttons' });
			button(row, 'Отмена', () => this.close());
			button(row, `Импортировать (${n})`, () => void this.apply(), { cls: 'mod-cta', disabled: n === 0 || this.busy || !this.ctl.store?.writable, testId: 'import-apply' });
		}

		if (this.report) {
			const rep = el.createDiv({ cls: 'ca-import-report', attr: { 'data-testid': 'import-report' } });
			rep.createEl('h4', { text: 'Отчёт' });
			const status = { created: 'создан', updated: 'обновлён', skipped: 'пропущен', error: 'ошибка' } as const;
			for (const r of this.report) rep.createDiv({ cls: `ca-report-${r.status}`, text: `${r.name}: ${status[r.status]} — ${r.message}` });
		}
	}

	private renderCandidate(parent: HTMLElement, c: ImportCandidate): void {
		const s = this.ctl.state;
		if (!s) return;
		const box = parent.createDiv({ cls: 'ca-import-item', attr: { 'data-testid': 'import-item' } });
		box.createEl('strong', { text: c.input?.name ?? `Запись ${c.index + 1}` });
		for (const e of c.errors) box.createDiv({ cls: 'ca-error', text: `${e.path}: ${e.message}` });
		for (const w of c.warnings) box.createDiv({ cls: 'ca-warn', text: `${w.path}: ${w.message}` });
		if (!c.input) return;
		box.createDiv({ cls: 'ca-muted', text: c.reason });
		new Setting(box).setName('Действие').addDropdown((dd) => {
			if (!c.nameClash || c.existingId) dd.addOption('create', `Создать: ${c.targetPath}`);
			else dd.addOption('create', `Создать новую: ${c.targetPath}`);
			if (c.existingId || c.nameClash) dd.addOption('update', `Обновить: ${c.nameClash ?? (c.existingId ? s.characters[c.existingId]?.notePath ?? c.targetPath : c.targetPath)}`);
			dd.addOption('skip', 'Пропустить');
			dd.setValue(c.mode).onChange((v) => {
				c.mode = v as ImportCandidate['mode'];
				this.render();
			});
			dd.selectEl.dataset.testid = 'import-mode';
		});
		const plan = previewPlan(s, c, this.overwriteRuntime);
		if (!plan) return;
		const diff = box.createDiv({ cls: 'ca-diff' });
		if (plan.permanent.length) {
			diff.createEl('em', { text: 'Постоянные значения листа:' });
			const ul = diff.createEl('ul');
			for (const l of plan.permanent) ul.createEl('li', { text: `${l.field}: ${l.before} → ${l.after}` });
		}
		if (plan.runtime.length) {
			diff.createEl('em', { text: 'Текущие ресурсы (будут записаны):' });
			const ul = diff.createEl('ul');
			for (const l of plan.runtime) ul.createEl('li', { text: `${l.field}: ${l.before} → ${l.after}` });
		}
		if (plan.runtimeKept.length) {
			diff.createEl('em', { text: 'Текущие ресурсы (сохраняются без изменений):' });
			const ul = diff.createEl('ul');
			for (const l of plan.runtimeKept) ul.createEl('li', { text: `${l.field}: остаётся ${l.before} (в JSON ${l.after})` });
		}
	}

	private async apply(): Promise<void> {
		const store = this.ctl.store;
		if (!store || this.busy) return;
		this.busy = true;
		try {
			const { report } = await applyImport(this.ctl.port, store, this.candidates, { overwriteRuntime: this.overwriteRuntime, addToPartyId: this.partyId });
			this.report = report;
			this.candidates = [];
		} finally {
			this.busy = false;
			this.render();
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
