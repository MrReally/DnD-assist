import { Modal, setIcon, type App } from 'obsidian';
import { effectiveAc, hpOf } from '../domain/combat';
import type { AdventureState, Combatant, HitPoints } from '../domain/types';

export interface ButtonOpts {
	icon?: string;
	cls?: string;
	title?: string;
	disabled?: boolean;
	testId?: string;
}

export function button(parent: HTMLElement, text: string, onClick: (ev: MouseEvent) => void, opts: ButtonOpts = {}): HTMLButtonElement {
	const b = parent.createEl('button', { cls: ['ca-btn', ...(opts.cls ? opts.cls.split(' ') : [])] });
	b.type = 'button';
	if (opts.icon) {
		const i = b.createSpan({ cls: 'ca-btn-icon' });
		setIcon(i, opts.icon);
	}
	if (text) b.createSpan({ text, cls: 'ca-btn-text' });
	if (opts.title) {
		b.setAttr('aria-label', opts.title);
		b.title = opts.title;
	} else if (!text && opts.icon) b.setAttr('aria-label', opts.icon);
	if (opts.testId) b.dataset.testid = opts.testId;
	b.disabled = !!opts.disabled;
	b.addEventListener('click', (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		if (!b.disabled) onClick(ev);
	});
	return b;
}

export function hpText(hp: HitPoints | null): string {
	if (!hp) return '—';
	const max = hp.max === null ? '?' : String(hp.max);
	return `${hp.current}/${max}${hp.temporary ? ` +${hp.temporary}` : ''}`;
}

export function combatantHp(state: AdventureState, c: Combatant): string {
	return hpText(hpOf(state, c));
}

export function combatantAc(state: AdventureState, c: Combatant): string {
	const ac = effectiveAc(state, c);
	return ac === null ? '—' : `${ac}${c.acOverride !== null ? '*' : ''}`;
}

export function parseIntStrict(text: string): number | null {
	const t = text.trim().replace(/^\+/, '');
	if (!/^-?\d{1,6}$/.test(t)) return null;
	return Number(t);
}

export function intOrNull(text: string): number | null | 'invalid' {
	if (text.trim() === '') return null;
	const n = parseIntStrict(text);
	return n === null ? 'invalid' : n;
}

/** Simple confirm dialog; Enter confirms, Escape cancels, focus returns to the opener. */
export class ConfirmModal extends Modal {
	private resolved = false;
	constructor(
		app: App,
		private readonly title: string,
		private readonly body: string | string[],
		private readonly confirmText: string,
		private readonly onResult: (ok: boolean) => void,
		private readonly danger = false,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.title);
		const lines = Array.isArray(this.body) ? this.body : [this.body];
		for (const l of lines) this.contentEl.createEl('p', { text: l });
		const row = this.contentEl.createDiv({ cls: 'ca-modal-buttons' });
		button(row, 'Отмена', () => this.close());
		const ok = button(row, this.confirmText, () => {
			this.resolved = true;
			this.onResult(true);
			this.close();
		}, { cls: this.danger ? 'mod-warning' : 'mod-cta', testId: 'confirm-ok' });
		window.setTimeout(() => ok.focus(), 0);
	}

	override onClose(): void {
		if (!this.resolved) this.onResult(false);
		this.contentEl.empty();
	}
}

export function confirm(app: App, title: string, body: string | string[], confirmText: string, danger = false): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, title, body, confirmText, resolve, danger).open());
}

/** Numeric entry for physical dice results (damage, healing, temporary HP, AC). */
export class NumberModal extends Modal {
	private input!: HTMLInputElement;
	constructor(
		app: App,
		private readonly title: string,
		private readonly hint: string,
		private readonly preview: (n: number) => string,
		private readonly onSubmit: (n: number) => Promise<boolean> | boolean,
		private readonly opts: { min?: number; initial?: string; allowEmpty?: boolean } = {},
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.title);
		this.modalEl.addClass('ca-number-modal');
		this.contentEl.createEl('p', { text: this.hint, cls: 'ca-muted' });
		this.input = this.contentEl.createEl('input', { type: 'text', cls: 'ca-number-input' });
		this.input.inputMode = 'numeric';
		this.input.dataset.testid = 'number-input';
		this.input.value = this.opts.initial ?? '';
		const prev = this.contentEl.createDiv({ cls: 'ca-preview', attr: { 'aria-live': 'polite' } });
		const err = this.contentEl.createDiv({ cls: 'ca-error' });
		const update = (): void => {
			const n = parseIntStrict(this.input.value);
			err.setText('');
			prev.setText(n === null ? '' : this.preview(n));
		};
		this.input.addEventListener('input', update);
		const submit = async (): Promise<void> => {
			const n = parseIntStrict(this.input.value);
			if (n === null || n < (this.opts.min ?? 0)) {
				err.setText(`Введите целое число${this.opts.min !== undefined ? ` ≥ ${this.opts.min}` : ' ≥ 0'}`);
				return;
			}
			if (await this.onSubmit(n)) this.close();
		};
		this.input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				void submit();
			}
		});
		const row = this.contentEl.createDiv({ cls: 'ca-modal-buttons' });
		button(row, 'Отмена', () => this.close());
		button(row, 'Применить', () => void submit(), { cls: 'mod-cta', testId: 'number-apply' });
		update();
		window.setTimeout(() => this.input.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

export function icon(parent: HTMLElement, name: string, cls = 'ca-icon'): HTMLElement {
	const s = parent.createSpan({ cls });
	setIcon(s, name);
	return s;
}
