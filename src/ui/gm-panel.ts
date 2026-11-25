// GM Cockpit panel (vertical slice): the game card of the opened Canvas object, in the right sidebar.
// Native DOM only. Reads the existing domain state; every edit goes through Controller.act()
// (same reducer, Undo/Redo and sidecar persistence as the rest of Canvas Assist).
import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type { Controller } from '../controller';
import { hpPercent, parseHpInput } from '../domain/card';
import type { CharacterState } from '../domain/types';
import { button } from './common';

export const COCKPIT_VIEW = 'gm-cockpit-panel';

export class GmCockpitPanel extends ItemView {
	private unsub: (() => void) | null = null;
	private lastKey = '';

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctl: Controller,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return COCKPIT_VIEW;
	}

	override getDisplayText(): string {
		return 'GM Cockpit';
	}

	override getIcon(): string {
		return 'scroll-text';
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('gmc');
		this.unsub = this.ctl.onChange(() => this.render());
		this.render();
	}

	override async onClose(): Promise<void> {
		this.unsub?.();
		this.unsub = null;
		this.contentEl.empty();
	}

	private key(): string {
		const c = this.ctl;
		const t = c.target;
		const ch = t?.kind === 'character' ? c.state?.characters[t.id] : null;
		return [c.activeAdventureId, c.state?.revision, c.store?.info.mode, t?.kind, t?.id, ch ? JSON.stringify([ch.hp, ch.ac, ch.name]) : '', c.state?.history.undo.length, c.state?.history.redo.length].join('|');
	}

	private render(): void {
		const k = this.key();
		if (k === this.lastKey) return;
		this.lastKey = k;
		const root = this.contentEl;
		root.empty();
		const state = this.ctl.state;
		root.createDiv({ cls: 'gmc-head' }).createEl('h3', { text: state?.name ?? 'GM Cockpit', cls: 'gmc-serif' });
		if (!state) {
			root.createDiv({ cls: 'gmc-empty', text: 'Откройте Canvas подключённого приключения.' });
			return;
		}
		const t = this.ctl.target;
		const ch = t?.kind === 'character' ? state.characters[t.id] : undefined;
		const body = root.createDiv({ cls: 'gmc-body' });
		if (!ch) {
			const e = body.createDiv({ cls: 'gmc-empty', attr: { 'data-testid': 'gmc-empty' } });
			e.createEl('p', { text: 'Карточка не выбрана.' });
			e.createEl('p', { cls: 'gmc-dim', text: 'Двойной клик по узлу персонажа на Canvas или команда «Открыть выбранный объект в GM Cockpit».' });
		} else {
			this.renderCharacter(body, ch);
		}
		this.renderFooter(root);
	}

	private renderCharacter(parent: HTMLElement, ch: CharacterState): void {
		const card = parent.createDiv({ cls: 'gmc-card', attr: { 'data-testid': 'gmc-card', 'data-character-id': ch.id } });
		const top = card.createDiv({ cls: 'gmc-row gmc-between' });
		const id = top.createDiv();
		id.createEl('h4', { text: ch.name, cls: 'gmc-serif gmc-name', attr: { 'data-testid': 'gmc-name' } });
		const cls = ch.classes.map((c) => `${c.name} ${c.level}`).join(' / ');
		id.createDiv({ cls: 'gmc-dim', text: cls || 'Игровой персонаж' });
		const ac = top.createDiv({ cls: 'gmc-ac', attr: { 'aria-label': 'Класс доспеха' } });
		ac.createDiv({ cls: 'gmc-eyebrow', text: 'КД' });
		ac.createDiv({ cls: 'gmc-num', text: ch.ac === null ? '—' : String(ch.ac), attr: { 'data-testid': 'gmc-ac' } });

		const hp = ch.hp;
		const bar = card.createDiv({ cls: 'gmc-hp' });
		const head = bar.createDiv({ cls: 'gmc-row gmc-between' });
		head.createSpan({ cls: 'gmc-eyebrow', text: 'Хиты' });
		const num = head.createSpan({ cls: 'gmc-num', attr: { 'data-testid': 'gmc-hp-text' } });
		num.setText(`${hp.current} / ${hp.max === null ? '?' : hp.max}${hp.temporary ? ` (+${hp.temporary} врем.)` : ''}`);
		const track = bar.createDiv({ cls: 'gmc-track', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(hp.max ?? 0), 'aria-valuenow': String(hp.current), 'aria-label': 'Хиты' } });
		const pct = hpPercent(hp.current, hp.max);
		const fill = track.createDiv({ cls: ['gmc-fill', pct <= 25 ? 'is-low' : ''].filter(Boolean) });
		fill.style.width = `${pct}%`;
		if (hp.current === 0) bar.createDiv({ cls: 'gmc-warn', text: '0 хитов' });

		const form = card.createEl('form', { cls: 'gmc-hpform' });
		const input = form.createEl('input', { cls: 'gmc-input', type: 'text', attr: { placeholder: '−7 урон · +5 лечение · =12 установить', 'aria-label': 'Изменить хиты', 'data-testid': 'gmc-hp-input', inputmode: 'text' } });
		const apply = (): void => void this.applyHp(ch, input);
		form.addEventListener('submit', (ev) => {
			ev.preventDefault();
			apply();
		});
		const btns = form.createDiv({ cls: 'gmc-row gmc-gap' });
		button(btns, 'Урон', () => void this.applyHp(ch, input, 'damage'), { cls: 'gmc-btn gmc-btn-d', testId: 'gmc-damage' });
		button(btns, 'Лечение', () => void this.applyHp(ch, input, 'heal'), { cls: 'gmc-btn gmc-btn-ok', testId: 'gmc-heal' });
		button(btns, 'Установить', () => void this.applyHp(ch, input, 'set'), { cls: 'gmc-btn', testId: 'gmc-set' });
		if (ch.notePath) {
			const f = this.ctl.noteFile(ch.notePath);
			const row = card.createDiv({ cls: 'gmc-row gmc-gap gmc-links' });
			button(row, 'Открыть заметку', () => {
				if (f) void this.app.workspace.getLeaf('tab').openFile(f);
				else new Notice('Canvas Assist: файл листа не найден');
			}, { cls: 'gmc-btn gmc-btn-g', disabled: !f, testId: 'gmc-open-note' });
		}
	}

	private async applyHp(ch: CharacterState, input: HTMLInputElement, force?: 'damage' | 'heal' | 'set'): Promise<void> {
		const parsed = parseHpInput(input.value);
		if (parsed.kind === 'invalid') {
			input.addClass('is-error');
			new Notice('Canvas Assist: введите целое число, например −7, +5 или =12');
			return;
		}
		input.removeClass('is-error');
		// Buttons force the action for an unsigned number; a typed sign always wins for the form.
		const kind = force && /^\s*\d/.test(input.value) ? force : parsed.kind;
		const target = { kind: 'character', id: ch.id } as const;
		const out =
			kind === 'damage'
				? await this.ctl.act({ type: 'hp/damage', target, amount: parsed.amount, useTemporary: this.ctl.settings.temporaryHpAbsorbs })
				: kind === 'heal'
					? await this.ctl.act({ type: 'hp/heal', target, amount: parsed.amount })
					: await this.ctl.act({ type: 'character/set-hp', characterId: ch.id, current: parsed.amount });
		if (out.ok) input.value = '';
	}

	private renderFooter(root: HTMLElement): void {
		const f = root.createDiv({ cls: 'gmc-foot' });
		const info = this.ctl.store?.info;
		const saved = f.createSpan({ cls: ['gmc-save', info && info.mode !== 'ok' ? 'is-bad' : ''].filter(Boolean), attr: { 'data-testid': 'gmc-save' } });
		saved.setText(!info ? '' : info.mode === 'ok' ? `Сохранено · ред. ${this.ctl.state?.revision ?? 0}` : `НЕ сохранено: ${info.message || info.mode}`);
		const st = this.ctl.state;
		const g = f.createDiv({ cls: 'gmc-row gmc-gap' });
		button(g, '', () => void this.ctl.undo(), { icon: 'undo-2', title: 'Отменить', cls: 'gmc-btn gmc-btn-g', disabled: !st?.history.undo.length, testId: 'gmc-undo' });
		button(g, '', () => void this.ctl.redo(), { icon: 'redo-2', title: 'Повторить', cls: 'gmc-btn gmc-btn-g', disabled: !st?.history.redo.length, testId: 'gmc-redo' });
	}
}
