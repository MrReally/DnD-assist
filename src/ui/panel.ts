// Side panel (right sidebar): fuller forms for encounter setup, parties/characters, templates,
// creature cards, game time and history. Collapsible native Obsidian sidebar view.
import { ItemView, Notice, Setting, TFile, type WorkspaceLeaf } from 'obsidian';
import { computeSlots, hpOf, nextTieOrder } from '../domain/combat';
import { describeDuration, formatClock } from '../domain/effect-clock';
import { encounterFromTemplate } from '../domain/encounter';
import { newId } from '../domain/ids';
import { relativeTo } from '../domain/normalize';
import { emptyCharacter } from '../domain/state';
import type { AdventureState, CharacterState, Counter, Effect } from '../domain/types';
import type { ChangeReason, Controller } from '../controller';
import { PC_FOLDER } from '../services/import-service';
import { button, confirm, hpText, intOrNull } from './common';
import { endEncounter, nextTurn, openDamage, openEffect, openHeal, openTempHp, previousTurn, removeCombatant } from './actions';
import { CardModal } from './card-modal';
import { AddCombatantModal, CreatureModal, TemplateModal } from './encounter-modals';
import { EffectModal } from './effect-modal';
import { ImportModal } from './import-preview';
import { RecoveryModal } from './misc-modals';
import { effectsFor, renderEffectPills } from './overlay';
import { RestModal } from './rest-modal';

export const PANEL_VIEW = 'canvas-assist-panel';

type Tab = 'combat' | 'party' | 'templates' | 'time' | 'history';
const TABS: Array<[Tab, string]> = [
	['combat', 'Бой'],
	['party', 'Партия'],
	['templates', 'Шаблоны'],
	['time', 'Время'],
	['history', 'История'],
];

export class CanvasAssistPanel extends ItemView {
	private tab: Tab = 'combat';
	private unsub: (() => void) | null = null;
	private queued = false;
	private checked = new Set<string>();
	private openChar: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctl: Controller,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return PANEL_VIEW;
	}

	override getDisplayText(): string {
		return 'Canvas Assist';
	}

	override getIcon(): string {
		return 'swords';
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('ca-panel');
		this.unsub = this.ctl.onChange((r) => this.schedule(r));
		this.render();
	}

	override async onClose(): Promise<void> {
		this.unsub?.();
		this.unsub = null;
		this.contentEl.empty();
	}

	private schedule(_r: ChangeReason): void {
		if (this.queued) return;
		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			this.render();
		});
	}

	setTab(tab: Tab): void {
		this.tab = tab;
		this.render();
	}

	/** Re-render while keeping keyboard focus on the same logical field. */
	render(): void {
		const el = this.contentEl;
		const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
		el.empty();
		const s = this.ctl.state;
		const adv = this.ctl.adventure;
		const head = el.createDiv({ cls: 'ca-panel-head' });
		head.createEl('strong', { text: adv ? adv.name : 'Нет активного приключения' });
		if (adv) head.createDiv({ cls: 'ca-muted ca-small', text: `Корень: ${adv.rootPath}${this.ctl.activeCanvas ? ` · Canvas: ${this.ctl.activeCanvas.basename}` : ''}` });
		const store = this.ctl.store;
		if (store && store.info.mode !== 'ok') {
			const w = head.createDiv({ cls: 'ca-warn' });
			w.setText(store.info.message ?? 'Режим только чтения');
			button(head, 'Подробнее', () => new RecoveryModal(this.ctl).open(), { cls: 'mod-warning' });
		}
		if (!s) {
			el.createEl('p', { cls: 'ca-muted', text: 'Откройте Canvas внутри папки приключения и выполните команду «Использовать текущий Canvas как приключение».' });
			return;
		}
		const tabs = el.createDiv({ cls: 'ca-tabs', attr: { role: 'tablist' } });
		for (const [id, label] of TABS) {
			const b = button(tabs, label, () => this.setTab(id), { cls: `ca-tab${this.tab === id ? ' is-on' : ''}`, testId: `tab-${id}` });
			b.setAttr('role', 'tab');
			b.setAttr('aria-selected', this.tab === id ? 'true' : 'false');
		}
		const body = el.createDiv({ cls: 'ca-panel-body' });
		if (this.tab === 'combat') this.renderCombat(body, s);
		else if (this.tab === 'party') this.renderParty(body, s);
		else if (this.tab === 'templates') this.renderTemplates(body, s);
		else if (this.tab === 'time') this.renderTime(body, s);
		else this.renderHistory(body, s);
		if (focusKey) el.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
	}

	private numInput(parent: HTMLElement, key: string, value: number | null, placeholder: string, onCommit: (v: number | null) => void, label?: string): HTMLInputElement {
		const i = parent.createEl('input', { type: 'text', cls: 'ca-num', attr: { placeholder, 'data-key': key, 'aria-label': label ?? placeholder, 'data-testid': key } });
		i.inputMode = 'numeric';
		i.value = value === null ? '' : String(value);
		i.addEventListener('change', () => {
			const v = intOrNull(i.value);
			if (v === 'invalid') {
				i.addClass('ca-invalid');
				new Notice('Введите целое число');
				return;
			}
			onCommit(v);
		});
		i.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter') i.blur();
		});
		return i;
	}

	// ---------------- Combat ----------------
	private renderCombat(el: HTMLElement, s: AdventureState): void {
		const enc = s.activeEncounter;
		if (!enc) {
			el.createEl('p', { cls: 'ca-muted', text: 'Нет активного боя.' });
			const row = el.createDiv({ cls: 'ca-row' });
			button(row, 'Спонтанный бой', () => new AddCombatantModal(this.ctl).open(), { icon: 'plus', cls: 'mod-cta', testId: 'panel-spontaneous' });
			for (const t of s.encounterTemplates) {
				button(row, `▶ ${t.name}`, () => void this.launch(t.id), { testId: 'panel-launch' });
			}
			return;
		}
		el.createEl('h3', { text: `${enc.name} · ${enc.round === 0 ? 'подготовка' : `раунд ${enc.round}`}${enc.paused ? ' · пауза' : ''}` });
		const controls = el.createDiv({ cls: 'ca-row' });
		button(controls, '', () => void previousTurn(this.ctl), { icon: 'skip-back', title: 'Предыдущий ход', disabled: enc.round === 0 });
		button(controls, enc.round === 0 ? 'Начать бой' : 'Следующий ход', () => void nextTurn(this.ctl), { icon: enc.round === 0 ? 'play' : 'skip-forward', cls: 'mod-cta', testId: 'panel-next' });
		button(controls, '', () => new AddCombatantModal(this.ctl).open(), { icon: 'user-plus', title: 'Добавить участников', testId: 'panel-add' });
		button(controls, 'Завершить', () => void endEncounter(this.ctl), { icon: 'square', testId: 'panel-end' });
		if (enc.round === 0) el.createEl('p', { cls: 'ca-muted', text: 'Введите инициативы по результатам физических бросков и нажмите «Начать бой».' });

		const slots = computeSlots(enc);
		const table = el.createDiv({ cls: 'ca-combat-table', attr: { 'data-testid': 'combat-table' } });
		for (const slot of slots) {
			const isActive = slot.id === enc.activeSlotId;
			if (slot.kind === 'group') {
				const g = enc.groups[slot.id];
				const gr = table.createDiv({ cls: `ca-group-row${isActive ? ' is-active' : ''}` });
				gr.createSpan({ text: `Группа «${slot.name}» (общая инициатива)` });
				this.numInput(gr, `ginit-${slot.id}`, g?.initiative ?? null, 'иниц.', (v) => void this.ctl.act({ type: 'encounter/update-group', groupId: slot.id, patch: { initiative: v } }), 'Инициатива группы');
				button(gr, 'Разгруппировать', () => void this.ctl.act({ type: 'encounter/set-group', combatantIds: slot.memberIds, group: null }), { cls: 'ca-small' });
			}
			for (const id of slot.memberIds) {
				const c = enc.combatants[id];
				if (!c) continue;
				const row = table.createDiv({ cls: ['ca-cmb-row', isActive ? 'is-active' : '', c.defeated ? 'is-defeated' : '', slot.kind === 'group' ? 'is-grouped' : ''].filter(Boolean), attr: { 'data-testid': 'cmb-row', 'data-name': c.displayName } });
				const cb = row.createEl('input', { type: 'checkbox', attr: { 'aria-label': `Отметить ${c.displayName}` } });
				cb.checked = this.checked.has(c.id);
				cb.addEventListener('change', () => (cb.checked ? this.checked.add(c.id) : this.checked.delete(c.id)));
				const name = row.createEl('input', { type: 'text', cls: 'ca-name', attr: { 'data-key': `name-${c.id}`, 'aria-label': 'Имя' } });
				name.value = c.displayName;
				name.addEventListener('change', () => void this.ctl.act({ type: 'encounter/update-combatant', combatantId: c.id, patch: { displayName: name.value } }));
				if (slot.kind === 'single') this.numInput(row, `init-${c.displayName}`, c.initiative, 'иниц.', (v) => void this.ctl.act({ type: 'encounter/update-combatant', combatantId: c.id, patch: { initiative: v } }), `Инициатива ${c.displayName}`);
				else row.createSpan({ cls: 'ca-muted ca-small', text: 'в группе' });
				const hp = hpOf(s, c);
				const hpBox = row.createSpan({ cls: 'ca-hp-cell' });
				hpBox.createSpan({ text: `♥ ${hpText(hp)}` });
				if (!c.characterId) this.numInput(row, `hpmax-${c.id}`, hp?.max ?? null, 'макс.', (v) => void this.ctl.act({ type: 'encounter/update-combatant', combatantId: c.id, patch: { hpMax: v } }), 'Максимум хитов');
				button(row, '', () => openDamage(this.ctl, { kind: 'combatant', id: c.id }), { icon: 'sword', title: 'Урон' });
				button(row, '', () => openHeal(this.ctl, { kind: 'combatant', id: c.id }), { icon: 'heart', title: 'Лечение' });
				button(row, '', () => openEffect(this.ctl, { kind: 'combatant', id: c.id }), { icon: 'sparkles', title: 'Эффект' });
				button(row, '', () => new CardModal(this.ctl, { kind: 'combatant', id: c.id }).open(), { icon: 'id-card', title: 'Карточка' });
				button(row, '', () => void this.ctl.act({ type: 'encounter/update-combatant', combatantId: c.id, patch: { defeated: !c.defeated } }), { icon: 'flag', title: c.defeated ? 'Вернуть в бой' : 'Выбыл' });
				button(row, '', () => void removeCombatant(this.ctl, c.id), { icon: 'trash', title: 'Удалить из боя' });
				const effs = effectsFor(s, c);
				if (effs.length) renderEffectPills(row.createDiv({ cls: 'ca-row-effects' }), s, effs, (e) => new EffectModal(this.ctl, null, e).open());
			}
		}
		const grp = el.createDiv({ cls: 'ca-row' });
		button(grp, 'Общая инициатива для отмеченных', () => void this.groupChecked(), { cls: 'ca-small', testId: 'panel-group' });
		button(grp, 'Индивидуальная для отмеченных', () => void this.ungroupChecked(), { cls: 'ca-small' });
	}

	private async launch(templateId: string): Promise<void> {
		const s = this.ctl.state;
		const t = s?.encounterTemplates.find((x) => x.id === templateId);
		if (!s || !t) return;
		await this.ctl.act({ type: 'encounter/create', encounter: encounterFromTemplate(s, t, newId, new Date().toISOString()) });
		this.setTab('combat');
	}

	private async groupChecked(): Promise<void> {
		const enc = this.ctl.state?.activeEncounter;
		const ids = [...this.checked].filter((id) => enc?.combatants[id]);
		if (!enc || ids.length < 2) return void new Notice('Отметьте минимум двух участников');
		const names = ids.map((id) => enc.combatants[id]?.displayName ?? '').join(', ');
		const first = enc.combatants[ids[0] as string];
		await this.ctl.act({ type: 'encounter/set-group', combatantIds: ids, group: { id: newId('grp'), name: names.length > 40 ? `${first?.displayName ?? 'Группа'} и др.` : names, initiative: first?.initiative ?? null, tieOrder: nextTieOrder(enc) } });
		this.checked.clear();
	}

	private async ungroupChecked(): Promise<void> {
		const ids = [...this.checked];
		if (!ids.length) return;
		await this.ctl.act({ type: 'encounter/set-group', combatantIds: ids, group: null });
		this.checked.clear();
	}

	// ---------------- Party / characters ----------------
	private renderParty(el: HTMLElement, s: AdventureState): void {
		const row = el.createDiv({ cls: 'ca-row' });
		button(row, 'Импорт JSON', () => new ImportModal(this.ctl).open(), { icon: 'file-input', cls: 'mod-cta', testId: 'panel-import' });
		button(row, 'Найти листы в Elements/Персонажи', () => void this.registerNotes(), { icon: 'user-search', testId: 'panel-register-notes' });
		button(row, 'Долгий отдых', () => new RestModal(this.ctl, 'long').open(), { icon: 'moon', testId: 'panel-long-rest' });
		button(row, 'Короткий отдых', () => new RestModal(this.ctl, 'short').open(), { icon: 'coffee', testId: 'panel-short-rest' });

		el.createEl('h3', { text: 'Партии' });
		new Setting(el)
			.setName('Активная партия')
			.addDropdown((dd) => {
				dd.addOption('', '— нет —');
				for (const p of s.parties) dd.addOption(p.id, p.name);
				dd.setValue(s.activePartyId ?? '').onChange((v) => void this.ctl.act({ type: 'party/set-active', partyId: v || null }));
			})
			.addButton((b) =>
				b.setButtonText('Новая').onClick(() => void this.ctl.act({ type: 'party/create', party: { id: newId('party'), name: `Партия ${s.parties.length + 1}`, characterIds: [] } })),
			);
		const party = s.parties.find((p) => p.id === s.activePartyId);
		if (party) {
			new Setting(el)
				.setName('Название партии')
				.addText((t) => {
					t.setValue(party.name);
					t.inputEl.dataset.key = 'party-name';
					t.inputEl.addEventListener('change', () => void this.ctl.act({ type: 'party/rename', partyId: party.id, name: t.getValue() }));
				})
				.addExtraButton((b) =>
					b.setIcon('trash').setTooltip('Удалить партию (персонажи остаются)').onClick(async () => {
						if (await confirm(this.app, 'Удалить партию?', 'Персонажи и их состояние останутся в приключении.', 'Удалить', true)) {
							await this.ctl.act({ type: 'party/delete', partyId: party.id });
						}
					}),
				);
		}
		el.createEl('h3', { text: 'Персонажи' });
		const chars = Object.values(s.characters).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
		if (!chars.length) el.createEl('p', { cls: 'ca-muted', text: 'Нет персонажей. Импортируйте JSON или зарегистрируйте листы из Elements/Персонажи.' });
		for (const ch of chars) this.renderCharacter(el, s, ch, party?.characterIds.includes(ch.id) ?? false, party?.id ?? null);
	}

	private renderCharacter(el: HTMLElement, s: AdventureState, ch: CharacterState, inParty: boolean, partyId: string | null): void {
		const box = el.createDiv({ cls: 'ca-char', attr: { 'data-testid': 'char-card', 'data-name': ch.name } });
		const head = box.createDiv({ cls: 'ca-char-head' });
		const open = this.openChar === ch.id;
		const title = head.createEl('strong', { text: `${open ? '▾' : '▸'} ${ch.name}`, cls: 'ca-clickable', attr: { role: 'button', tabindex: '0' } });
		title.addEventListener('click', () => {
			this.openChar = open ? null : ch.id;
			this.render();
		});
		const file = this.ctl.noteFile(ch.notePath);
		head.createSpan({ cls: 'ca-muted ca-small', text: ` ${ch.classes.map((c) => `${c.name} ${c.level}`).join(' / ')}` });
		if (!file) head.createSpan({ cls: 'ca-pill ca-pill-warn', text: 'лист недоступен' });
		if (partyId) {
			const cb = head.createEl('input', { type: 'checkbox', attr: { 'aria-label': 'В активной партии', title: 'В активной партии' } });
			cb.checked = inParty;
			cb.addEventListener('change', () => {
				const p = s.parties.find((x) => x.id === partyId);
				if (!p) return;
				const ids = cb.checked ? [...p.characterIds, ch.id] : p.characterIds.filter((x) => x !== ch.id);
				void this.ctl.act({ type: 'party/set-members', partyId, characterIds: ids });
			});
		}
		const line = box.createDiv({ cls: 'ca-row' });
		line.createSpan({ text: 'Хиты' });
		this.numInput(line, `hp-${ch.name}`, ch.hp.current, 'тек.', (v) => v !== null && void this.ctl.act({ type: 'character/set-hp', characterId: ch.id, current: v }), `Текущие хиты ${ch.name}`);
		line.createSpan({ text: '/' });
		this.numInput(line, `hpmax-${ch.name}`, ch.hp.max, 'макс.', (v) => void this.ctl.act({ type: 'character/set-hp', characterId: ch.id, max: v }), `Максимум хитов ${ch.name}`);
		line.createSpan({ text: 'врем.' });
		this.numInput(line, `temp-${ch.name}`, ch.hp.temporary, '0', (v) => void this.ctl.act({ type: 'character/set-hp', characterId: ch.id, temporary: v ?? 0 }), `Временные хиты ${ch.name}`);
		button(line, '', () => openDamage(this.ctl, { kind: 'character', id: ch.id }), { icon: 'sword', title: 'Урон' });
		button(line, '', () => openHeal(this.ctl, { kind: 'character', id: ch.id }), { icon: 'heart', title: 'Лечение' });
		button(line, '', () => openTempHp(this.ctl, { kind: 'character', id: ch.id }), { icon: 'shield', title: 'Временные хиты' });
		button(line, '', () => openEffect(this.ctl, { kind: 'character', id: ch.id }), { icon: 'sparkles', title: 'Эффект' });
		button(line, '', () => this.ctl.setTarget({ kind: 'character', id: ch.id }), { icon: 'crosshair', title: 'Выбрать целью' });
		const effs = Object.values(s.effects).filter((e) => e.target.kind === 'character' && e.target.id === ch.id);
		if (effs.length) renderEffectPills(box.createDiv({ cls: 'ca-row-effects' }), s, effs, (e) => new EffectModal(this.ctl, null, e).open());
		if (!open) return;

		const grid = box.createDiv({ cls: 'ca-char-grid' });
		const field = (label: string, key: string, value: number | null, commit: (v: number | null) => void): void => {
			const f = grid.createDiv({ cls: 'ca-field' });
			f.createSpan({ text: label });
			this.numInput(f, key, value, '—', commit, `${label} ${ch.name}`);
		};
		field('КД', `ac-${ch.id}`, ch.ac, (v) => void this.ctl.act({ type: 'character/set-fields', characterId: ch.id, patch: { ac: v } }));
		field('Иниц. мод.', `im-${ch.id}`, ch.initiativeModifier, (v) => void this.ctl.act({ type: 'character/set-fields', characterId: ch.id, patch: { initiativeModifier: v } }));
		field('Скорость', `sp-${ch.id}`, ch.speedFeet, (v) => void this.ctl.act({ type: 'character/set-fields', characterId: ch.id, patch: { speedFeet: v } }));
		field('Истощение', `ex-${ch.id}`, ch.exhaustion, (v) => void this.ctl.act({ type: 'character/set-fields', characterId: ch.id, patch: { exhaustion: v ?? 0 } }));
		field('Спасбр. успехи', `dss-${ch.id}`, ch.deathSaves.successes, (v) => void this.ctl.act({ type: 'character/set-fields', characterId: ch.id, patch: { deathSaves: { ...ch.deathSaves, successes: v ?? 0 } } }));
		field('Спасбр. провалы', `dsf-${ch.id}`, ch.deathSaves.failures, (v) => void this.ctl.act({ type: 'character/set-fields', characterId: ch.id, patch: { deathSaves: { ...ch.deathSaves, failures: v ?? 0 } } }));
		new Setting(box).setName('Вдохновение').addToggle((t) => t.setValue(ch.inspiration).onChange((v) => void this.ctl.act({ type: 'character/set-fields', characterId: ch.id, patch: { inspiration: v } })));

		const slots = box.createDiv({ cls: 'ca-slots' });
		slots.createEl('h5', { text: 'Ячейки заклинаний (тек./макс.)' });
		for (const [lvl, slot] of Object.entries(ch.spellSlots).sort(([a], [b]) => Number(a) - Number(b))) {
			const r = slots.createDiv({ cls: 'ca-row' });
			r.createSpan({ text: `${lvl} ур.` });
			this.numInput(r, `slot-${ch.name}-${lvl}`, slot.current, 'тек.', (v) => void this.ctl.act({ type: 'character/set-slot', characterId: ch.id, level: lvl, slot: { current: v ?? 0, max: slot.max } }), `Ячейки ${lvl} уровня ${ch.name}`);
			this.numInput(r, `slotmax-${ch.id}-${lvl}`, slot.max, 'макс.', (v) => void this.ctl.act({ type: 'character/set-slot', characterId: ch.id, level: lvl, slot: { current: Math.min(slot.current, v ?? 0), max: v ?? 0 } }));
			button(r, '', () => void this.ctl.act({ type: 'character/set-slot', characterId: ch.id, level: lvl, slot: null }), { icon: 'x', title: 'Убрать уровень' });
		}
		const addSlot = slots.createDiv({ cls: 'ca-row' });
		const free = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].find((l) => !ch.spellSlots[l]);
		if (free) button(addSlot, `+ ${free} ур.`, () => void this.ctl.act({ type: 'character/set-slot', characterId: ch.id, level: free, slot: { current: 1, max: 1 } }), { cls: 'ca-small' });

		const hd = box.createDiv({ cls: 'ca-slots' });
		hd.createEl('h5', { text: 'Кости хитов (осталось/всего)' });
		ch.hitDice.forEach((h, i) => {
			const r = hd.createDiv({ cls: 'ca-row' });
			r.createSpan({ text: h.die });
			this.numInput(r, `hd-${ch.id}-${i}`, h.remaining, 'ост.', (v) => {
				const list = structuredClone(ch.hitDice);
				const item = list[i];
				if (item) item.remaining = v ?? 0;
				void this.ctl.act({ type: 'character/set-hit-dice', characterId: ch.id, hitDice: list });
			});
			r.createSpan({ text: `/ ${h.total}` });
		});

		const ctr = box.createDiv({ cls: 'ca-slots' });
		ctr.createEl('h5', { text: 'Счётчики (свободные ресурсы)' });
		for (const c of Object.values(ch.counters)) this.renderCounter(ctr, ch, c);
		button(ctr, '+ счётчик', () => {
			const counter: Counter = { id: newId('ctr'), name: 'Новый счётчик', current: 0, max: null, recovery: 'manual' };
			void this.ctl.act({ type: 'character/set-counter', characterId: ch.id, counter });
		}, { cls: 'ca-small', testId: `add-counter-${ch.name}` });

		const foot = box.createDiv({ cls: 'ca-row' });
		if (file) button(foot, 'Открыть лист', () => void this.app.workspace.getLeaf('tab').openFile(file), { icon: 'file-text', cls: 'ca-small' });
		button(foot, 'Карточка', () => new CardModal(this.ctl, { kind: 'character', id: ch.id }).open(), { icon: 'id-card', cls: 'ca-small' });
		button(foot, 'Убрать из приключения', () => void (async () => {
			if (await confirm(this.app, `Убрать «${ch.name}» из состояния приключения?`, ['Заметка-лист не удаляется. Действие отменяемо.'], 'Убрать', true)) {
				await this.ctl.act({ type: 'character/remove', characterId: ch.id });
			}
		})(), { icon: 'user-minus', cls: 'ca-small' });
	}

	private renderCounter(parent: HTMLElement, ch: CharacterState, c: Counter): void {
		const r = parent.createDiv({ cls: 'ca-row', attr: { 'data-testid': 'counter-row' } });
		const name = r.createEl('input', { type: 'text', cls: 'ca-name', attr: { 'data-key': `ctrname-${c.id}`, 'aria-label': 'Название счётчика', 'data-testid': `counter-name-${ch.name}` } });
		name.value = c.name;
		const commit = (patch: Partial<Counter>): void => void this.ctl.act({ type: 'character/set-counter', characterId: ch.id, counter: { ...c, ...patch } });
		name.addEventListener('change', () => commit({ name: name.value }));
		this.numInput(r, `ctr-${ch.name}-${c.name}`, c.current, 'тек.', (v) => commit({ current: v ?? 0 }), `Значение ${c.name}`);
		this.numInput(r, `ctrmax-${ch.id}-${c.id}`, c.max, 'макс.', (v) => commit({ max: v, current: v === null ? c.current : Math.min(c.current, v) }), `Максимум ${c.name}`);
		const sel = r.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Восстановление' } });
		for (const [v, t] of [['manual', 'вручную'], ['short', 'кор. отдых'], ['long', 'долг. отдых']] as const) sel.createEl('option', { value: v, text: t });
		sel.value = c.recovery;
		sel.addEventListener('change', () => commit({ recovery: sel.value as Counter['recovery'] }));
		button(r, '', () => void this.ctl.act({ type: 'character/remove-counter', characterId: ch.id, counterId: c.id }), { icon: 'x', title: 'Удалить счётчик' });
	}

	/** Lists only Elements/Персонажи of this adventure. IDs are written to notes only after confirmation. */
	private async registerNotes(): Promise<void> {
		const s = this.ctl.state;
		if (!s) return;
		const folder = `${s.rootPath}/${PC_FOLDER}/`;
		const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder));
		const known = new Set(Object.values(s.characters).map((c) => c.notePath));
		const linked: Array<{ file: TFile; id: string }> = [];
		const unlinked: TFile[] = [];
		for (const f of files) {
			const rel = relativeTo(s.rootPath, f.path);
			if (!rel || known.has(rel)) continue;
			const id = this.app.metadataCache.getFileCache(f)?.frontmatter?.canvasAssistId as unknown;
			if (typeof id === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(id)) {
				if (!s.characters[id]) linked.push({ file: f, id });
			} else unlinked.push(f);
		}
		if (!linked.length && !unlinked.length) return void new Notice('Новых листов в Elements/Персонажи не найдено');
		const lines = [
			linked.length ? `С canvasAssistId: ${linked.map((l) => l.file.basename).join(', ')}` : '',
			unlinked.length ? `Без ID (будет добавлен canvasAssistId во frontmatter): ${unlinked.map((f) => f.basename).join(', ')}` : '',
			'Хиты и прочие значения останутся пустыми до ввода/импорта — не угадываются.',
		].filter(Boolean);
		if (!(await confirm(this.app, 'Зарегистрировать персонажей', lines, 'Зарегистрировать'))) return;
		const characters: CharacterState[] = [];
		for (const l of linked) characters.push(emptyCharacter(l.id, l.file.basename, relativeTo(s.rootPath, l.file.path) ?? l.file.path));
		for (const f of unlinked) {
			const id = newId('pc');
			try {
				await this.ctl.port.setFrontmatter(f.path, { canvasAssistId: id });
				characters.push(emptyCharacter(id, f.basename, relativeTo(s.rootPath, f.path) ?? f.path));
			} catch (err) {
				new Notice(`Не удалось записать ID в «${f.basename}»: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		if (characters.length) await this.ctl.act({ type: 'import/apply', characters, addToPartyId: s.activePartyId });
	}

	// ---------------- Templates / creatures ----------------
	private renderTemplates(el: HTMLElement, s: AdventureState): void {
		el.createEl('h3', { text: 'Шаблоны столкновений' });
		button(el, 'Новый шаблон', () => new TemplateModal(this.ctl, null).open(), { icon: 'plus', cls: 'mod-cta', testId: 'panel-new-template' });
		for (const t of s.encounterTemplates) {
			const r = el.createDiv({ cls: 'ca-row ca-template-row', attr: { 'data-testid': 'template-row' } });
			r.createEl('strong', { text: t.name });
			r.createSpan({ cls: 'ca-muted ca-small', text: t.entries.map((e) => `${e.name}×${e.count}${e.sharedInitiative ? ' (группа)' : ''}`).join(', ') || 'пусто' });
			button(r, 'Запустить', () => void this.launch(t.id), { icon: 'play', disabled: !!s.activeEncounter, title: s.activeEncounter ? 'Сначала завершите текущий бой' : 'Запустить', testId: 'template-launch' });
			button(r, '', () => new TemplateModal(this.ctl, t).open(), { icon: 'pencil', title: 'Изменить' });
			button(r, '', () => void this.ctl.act({ type: 'template/upsert', template: { ...structuredClone(t), id: newId('tpl'), name: `${t.name} (копия)`, entries: t.entries.map((e) => ({ ...e, id: newId('ent') })) } }), { icon: 'copy', title: 'Дублировать', testId: 'template-duplicate' });
			button(r, '', () => void (async () => {
				if (await confirm(this.app, `Удалить шаблон «${t.name}»?`, 'Отменяемо через Undo.', 'Удалить', true)) await this.ctl.act({ type: 'template/remove', templateId: t.id });
			})(), { icon: 'trash', title: 'Удалить' });
		}
		el.createEl('h3', { text: 'Карточки существ' });
		button(el, 'Новая карточка', () => new CreatureModal(this.ctl, null).open(), { icon: 'plus', testId: 'panel-new-creature' });
		for (const c of Object.values(s.creatures).sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
			const r = el.createDiv({ cls: 'ca-row' });
			r.createEl('strong', { text: c.name });
			r.createSpan({ cls: 'ca-muted ca-small', text: `КД ${c.ac ?? '—'} · хиты ${c.hpMax ?? '—'} · мод. ${c.initiativeModifier ?? '—'}${c.source?.url ? ' · TTG' : ''}` });
			button(r, '', () => new CreatureModal(this.ctl, c).open(), { icon: 'pencil', title: 'Изменить' });
			button(r, '', () => void this.ctl.act({ type: 'creature/remove', creatureId: c.id }), { icon: 'trash', title: 'Удалить' });
		}
		if (this.ctl.offline.size || this.ctl.offline.error) {
			el.createEl('p', { cls: this.ctl.offline.error ? 'ca-warn' : 'ca-muted', text: this.ctl.offline.error ?? `Локальный справочник: ${this.ctl.offline.size} записей (поиск в окне добавления по названию).` });
		}
		this.renderReferenceSearch(el);
	}

	private renderReferenceSearch(el: HTMLElement): void {
		const box = el.createDiv({ cls: 'ca-ref-search' });
		box.createEl('h4', { text: 'Поиск в справочниках' });
		const input = box.createEl('input', { type: 'search', attr: { placeholder: 'Название существа', 'data-key': 'ref-search' } });
		const results = box.createDiv();
		const online = this.ctl.settings.ttgOnlineSearch;
		box.createDiv({ cls: 'ca-muted ca-small', text: online ? 'Онлайн-поиск TTG включён (экспериментально, только по запросу).' : 'Онлайн-поиск TTG выключен — поиск только в локальном справочнике. Ссылки TTG открываются в браузере.' });
		input.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Enter') return;
			void (async () => {
				results.empty();
				results.createSpan({ cls: 'ca-muted', text: 'Поиск…' });
				const [local, remote] = await Promise.all([this.ctl.offline.search(input.value), online ? this.ctl.ttgOnline.search(input.value) : Promise.resolve([])]);
				results.empty();
				for (const h of [...local, ...remote]) {
					const r = results.createDiv({ cls: 'ca-row' });
					r.createSpan({ text: h.name });
					r.createSpan({ cls: 'ca-muted ca-small', text: h.subtitle });
					button(r, 'В карточку', () => void (async () => {
						const summary = h.ref.provider === 'local' ? await this.ctl.offline.getSummary(h.ref) : null;
						new CreatureModal(this.ctl, {
							id: newId('crt'),
							name: h.name,
							aliases: [],
							ac: summary?.ac ?? null,
							hpMax: summary?.hpMax ?? null,
							initiativeModifier: summary?.initiativeModifier ?? null,
							speed: summary?.speed ?? '',
							notes: summary?.notes ?? '',
							source: h.url ? { provider: 'ttg2014', ref: h.url, url: h.url } : null,
						}).open();
					})(), { cls: 'ca-small' });
				}
				if (!local.length && !remote.length) results.createSpan({ cls: 'ca-muted', text: online ? 'Ничего не найдено или TTG недоступен.' : 'Ничего не найдено.' });
			})();
		});
	}

	// ---------------- Time ----------------
	private renderTime(el: HTMLElement, s: AdventureState): void {
		el.createEl('h3', { text: formatClock(s.gameClock.minutes), attr: { 'data-testid': 'game-clock' } });
		el.createEl('p', { cls: 'ca-muted', text: 'Внутриигровые часы двигаются только вручную. Фонового таймера нет.' });
		const row = el.createDiv({ cls: 'ca-row' });
		for (const [m, label] of [[1, '+1 мин'], [10, '+10 мин'], [60, '+1 ч'], [480, '+8 ч'], [1440, '+1 д']] as const) {
			button(row, label, () => void this.ctl.act({ type: 'clock/advance', minutes: m }), { cls: 'ca-small', testId: `clock-${m}` });
		}
		const custom = el.createDiv({ cls: 'ca-row' });
		custom.createSpan({ text: 'Сдвинуть на минут:' });
		this.numInput(custom, 'clock-custom', null, 'мин', (v) => v && void this.ctl.act({ type: 'clock/advance', minutes: v }), 'Сдвиг времени');
		const needs = Object.values(s.effects).filter((e) => e.needsDecision);
		const timed = Object.values(s.effects).filter((e) => e.duration.kind === 'game-time');
		const list = (title: string, effects: Effect[]): void => {
			if (!effects.length) return;
			el.createEl('h4', { text: title });
			for (const e of effects) {
				const r = el.createDiv({ cls: 'ca-row', attr: { 'data-testid': 'time-effect' } });
				r.createSpan({ text: `${e.label} → ${this.ctl.targetName(e.target)}` });
				r.createSpan({ cls: 'ca-muted ca-small', text: describeDuration(e, (id) => s.activeEncounter?.combatants[id]?.displayName ?? '?', s.gameClock.minutes) });
				button(r, '', () => new EffectModal(this.ctl, null, e).open(), { icon: 'pencil', title: 'Изменить' });
				button(r, '', () => void this.ctl.act({ type: 'effect/remove', effectIds: [e.id] }), { icon: 'x', title: 'Снять' });
			}
		};
		list('Требуют решения мастера', needs);
		list('По игровому времени', timed);
	}

	// ---------------- History ----------------
	private renderHistory(el: HTMLElement, s: AdventureState): void {
		const row = el.createDiv({ cls: 'ca-row' });
		button(row, 'Отменить', () => void this.ctl.undo(), { icon: 'undo-2', disabled: !s.history.undo.length });
		button(row, 'Повторить', () => void this.ctl.redo(), { icon: 'redo-2', disabled: !s.history.redo.length });
		el.createEl('p', { cls: 'ca-muted', text: `Хранится до ${this.ctl.settings.historyMaxEntries} действий / ${this.ctl.settings.historyMaxKiB} КиБ. Ревизия ${s.revision}.` });
		const ul = el.createEl('ol', { cls: 'ca-history', attr: { reversed: 'true' } });
		for (const h of [...s.history.undo].reverse().slice(0, 30)) ul.createEl('li', { text: `${new Date(h.at).toLocaleTimeString('ru-RU')} — ${h.label}` });
		if (s.history.redo.length) {
			el.createEl('h4', { text: 'Можно повторить' });
			const r = el.createEl('ol', { cls: 'ca-history' });
			for (const h of [...s.history.redo].reverse()) r.createEl('li', { text: h.label });
		}
	}
}
