// GM Cockpit panel: one primary card at a time (character / NPC / monster), with weapon, inventory,
// spell and full-sheet views behind it. Native DOM only. Every edit goes through Controller.act()
// (same reducer, Undo/Redo and sidecar persistence as the rest of Canvas Assist).
import { ItemView, MarkdownRenderer, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import { parseRoom } from '../domain/room';
import { sendCue, DgramTransport } from '../adapters/osc-transport';
import { hpPercent, modText, parseHpInput, resolveCard, weaponItemsOf, type AttackRow, type CardModel } from '../domain/card';
import { resolveItemType } from '../domain/builder';
import { ABILITIES, ABILITY_RU, SKILLS, carriedWeight, cockpitOf, formatCost, formatWeight, isProficientWith, itemsOf, profBonusOf, purseOf, saveBonus, signed, skillBonus, spellAttackBonus, spellDc, weaponAttack, type ItemInstance, type Purse } from '../domain/cockpit';
import { newId } from '../domain/ids';
import { armorClassLabel } from '../domain/srd-data';
import type { Controller } from '../controller';
import type { Effect } from '../domain/types';
import { button } from './common';
import { endEncounter, nextTurn } from './actions';
import { AddCombatantModal } from './encounter-modals';
import { addCreatureToCombat, AddItemModal, BuilderModal, CueModal, QuickNpcModal, SpellImportModal, TransferModal } from './cockpit/modals';
import { effectsFor, renderEffectPills } from './overlay';
import { RestModal } from './rest-modal';
import { CheckpointModal, ViewPointsModal } from './cockpit/canvas-modals';
import { GoToModal } from './cockpit/goto-modal';

export const COCKPIT_VIEW = 'gm-cockpit-panel';

type View = { k: 'card' } | { k: 'full' } | { k: 'inv' } | { k: 'weapon'; key: string; itemId: string | null } | { k: 'item'; id: string } | { k: 'spells' } | { k: 'spell'; id: string };

export class GmCockpitPanel extends ItemView {
	private unsub: (() => void) | null = null;
	private lastKey = '';
	private stack: View[] = [{ k: 'card' }];
	private stackFor = '';
	private slotChoice = 0;

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

	private get view(): View {
		return this.stack[this.stack.length - 1] ?? { k: 'card' };
	}

	private go(v: View): void {
		this.stack.push(v);
		this.lastKey = '';
		this.render();
	}

	private back(): void {
		if (this.stack.length > 1) this.stack.pop();
		this.lastKey = '';
		this.render();
	}

	private key(): string {
		const c = this.ctl;
		const ref = c.cardRef;
		const enc = c.state?.activeEncounter;
		return [c.activeAdventureId, c.state?.revision, c.store?.info.mode, ref?.kind, ref?.id, JSON.stringify(this.stack), this.slotChoice, enc?.activeSlotId, enc?.round, c.settings.spells.length, c.settings.cues.length].join('|');
	}

	private render(): void {
		const k = this.key();
		if (k === this.lastKey) return;
		this.lastKey = k;
		const root = this.contentEl;
		const keep = root.querySelector<HTMLElement>('.gmc-body')?.scrollTop ?? 0;
		root.empty();
		const state = this.ctl.state;
		const ref = this.ctl.cardRef;
		const refKey = ref ? `${ref.kind}:${ref.id}` : '';
		if (refKey !== this.stackFor) {
			this.stackFor = refKey;
			this.stack = [{ k: 'card' }];
		}
		this.renderHead(root);
		if (!state) {
			root.createDiv({ cls: 'gmc-body' }).createDiv({ cls: 'gmc-empty', text: 'Откройте Canvas подключённого приключения.' });
			return;
		}
		const body = root.createDiv({ cls: 'gmc-body' });
		const model = ref ? resolveCard(state, ref) : null;
		try {
			if (ref?.kind === 'room') void this.renderRoom(body, ref.id);
			else if (!model) {
				const e = body.createDiv({ cls: 'gmc-empty', attr: { 'data-testid': 'gmc-empty' } });
				e.createEl('p', { text: 'Карточка не выбрана.' });
				e.createEl('p', { cls: 'gmc-dim', text: 'Двойной клик по узлу персонажа или NPC на Canvas, команда «Открыть выбранный объект в GM Cockpit» либо кнопки «NPC» и «Персонаж» выше.' });
			} else this.renderView(body, model);
		} catch (err) {
			console.error('[Canvas Assist] cockpit view failed', err);
			body.createDiv({ cls: 'gmc-warn', text: 'Не удалось показать карточку (ошибка записана в консоль). Данные не изменены.' });
		}
		body.scrollTop = keep;
		this.renderFooter(root);
	}

	// ---- header / footer ---------------------------------------------------------------------

	private renderHead(root: HTMLElement): void {
		const state = this.ctl.state;
		const head = root.createDiv({ cls: 'gmc-head' });
		const top = head.createDiv({ cls: 'gmc-row gmc-between' });
		if (this.stack.length > 1) button(top, 'Назад', () => this.back(), { icon: 'arrow-left', cls: 'gmc-btn gmc-btn-g', testId: 'gmc-back' });
		top.createEl('h3', { text: state?.name ?? 'GM Cockpit', cls: 'gmc-serif' });
		if (!state) return;
		const tools = head.createDiv({ cls: 'gmc-row gmc-gap gmc-wrap gmc-tools' });
		button(tools, 'Перейти', () => new GoToModal(this.ctl).open(), { icon: 'search', cls: 'gmc-btn gmc-btn-sm', title: 'Поиск по Canvas и справочнику', testId: 'gmc-goto' });
		button(tools, 'NPC', () => new QuickNpcModal(this.ctl, (id) => this.ctl.setCard({ kind: 'creature', id })).open(), { icon: 'user-plus', cls: 'gmc-btn gmc-btn-sm', title: 'Быстрый NPC', testId: 'gmc-new-npc' });
		button(tools, 'Персонаж', () => new BuilderModal(this.ctl, (id) => this.ctl.setTarget({ kind: 'character', id })).open(), { icon: 'user', cls: 'gmc-btn gmc-btn-sm', title: 'Новый персонаж', testId: 'gmc-new-pc' });
		button(tools, 'Отдых', () => new RestModal(this.ctl, 'short').open(), { icon: 'tent', cls: 'gmc-btn gmc-btn-sm', title: 'Короткий отдых', testId: 'gmc-rest-short' });
		button(tools, 'Ночь', () => new RestModal(this.ctl, 'long').open(), { icon: 'moon', cls: 'gmc-btn gmc-btn-sm', title: 'Продолжительный отдых', testId: 'gmc-rest-long' });
		button(tools, 'Точки', () => new ViewPointsModal(this.ctl).open(), { icon: 'map-pin', cls: 'gmc-btn gmc-btn-sm', title: 'Точки обзора Canvas', testId: 'gmc-viewpoints' });
		button(tools, 'Контр.', () => new CheckpointModal(this.ctl).open(), { icon: 'archive', cls: 'gmc-btn gmc-btn-sm', title: 'Контрольные точки Canvas', testId: 'gmc-checkpoints' });
		this.renderParty(head, state);
	}

	/** PartyDock: compact always-visible party row (HP, AC); click opens the card. */
	private renderParty(head: HTMLElement, state: NonNullable<Controller['state']>): void {
		const party = state.parties.find((p) => p.id === state.activePartyId);
		const ids = party ? party.characterIds : Object.keys(state.characters);
		const chars = ids.map((id) => state.characters[id]).filter((c): c is NonNullable<typeof c> => !!c);
		if (!chars.length) return;
		const dock = head.createDiv({ cls: 'gmc-dock', attr: { 'data-testid': 'gmc-party', role: 'list', 'aria-label': 'Партия' } });
		const cur = this.ctl.cardRef;
		for (const c of chars) {
			const sel = cur?.kind === 'character' && cur.id === c.id;
			const chip = dock.createDiv({ cls: ['gmc-chip', sel ? 'is-sel' : '', c.hp.max !== null && c.hp.current <= c.hp.max / 4 ? 'is-low' : ''].filter(Boolean), attr: { role: 'listitem', tabindex: '0', 'data-testid': `gmc-party-${c.id}`, 'aria-label': `${c.name}, хиты ${c.hp.current} из ${c.hp.max ?? '?'}` } });
			chip.createSpan({ cls: 'gmc-chip-name', text: c.name });
			chip.createSpan({ cls: 'gmc-chip-hp', text: `${c.hp.current}/${c.hp.max ?? '?'}` });
			if (c.ac !== null) chip.createSpan({ cls: 'gmc-dim', text: `КД ${c.ac}` });
			const open = (): void => this.ctl.setTarget({ kind: 'character', id: c.id });
			chip.addEventListener('click', open);
			chip.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					open();
				}
			});
		}
	}

	private renderFooter(root: HTMLElement): void {
		const f = root.createDiv({ cls: 'gmc-foot' });
		const st = this.ctl.state;
		const info = this.ctl.store?.info;
		const left = f.createDiv({ cls: 'gmc-col' });
		const saved = left.createSpan({ cls: ['gmc-save', info && info.mode !== 'ok' ? 'is-bad' : ''].filter(Boolean), attr: { 'data-testid': 'gmc-save' } });
		saved.setText(!info ? '' : info.mode === 'ok' ? `Сохранено · ред. ${st?.revision ?? 0}` : `НЕ сохранено: ${info.message || info.mode}`);
		const g = f.createDiv({ cls: 'gmc-row gmc-gap' });
		const enc = st?.activeEncounter;
		if (st) {
			if (!enc) button(g, 'Начать бой', () => new AddCombatantModal(this.ctl).open(), { cls: 'gmc-btn gmc-btn-p', testId: 'gmc-start-combat' });
			else {
				button(g, enc.round === 0 ? 'Старт' : 'След. ход', () => void nextTurn(this.ctl), { cls: 'gmc-btn gmc-btn-p', testId: 'gmc-next' });
				button(g, 'Закончить', () => void endEncounter(this.ctl), { cls: 'gmc-btn', testId: 'gmc-end-combat' });
			}
		}
		button(g, '', () => void this.ctl.undo(), { icon: 'undo-2', title: 'Отменить', cls: 'gmc-btn gmc-btn-g', disabled: !st?.history.undo.length, testId: 'gmc-undo' });
		button(g, '', () => void this.ctl.redo(), { icon: 'redo-2', title: 'Повторить', cls: 'gmc-btn gmc-btn-g', disabled: !st?.history.redo.length, testId: 'gmc-redo' });
	}

	// ---- views ---------------------------------------------------------------------------------

	private renderView(body: HTMLElement, m: CardModel): void {
		const v = this.view;
		switch (v.k) {
			case 'card':
				return this.renderCompact(body, m);
			case 'full':
				return this.renderFull(body, m);
			case 'inv':
				return this.renderInventory(body, m);
			case 'weapon':
				return this.renderWeapon(body, m, v.key, v.itemId);
			case 'item':
				return this.renderItem(body, m, v.id);
			case 'spells':
				return this.renderSpells(body, m);
			case 'spell':
				return this.renderSpell(body, m, v.id);
		}
	}

	private hpBlock(card: HTMLElement, m: CardModel): void {
		const hp = m.hp;
		if (!hp) return;
		const bar = card.createDiv({ cls: 'gmc-hp' });
		const head = bar.createDiv({ cls: 'gmc-row gmc-between' });
		head.createSpan({ cls: 'gmc-eyebrow', text: m.hpTarget ? 'Хиты' : 'Хиты (справка)' });
		head.createSpan({ cls: 'gmc-num', attr: { 'data-testid': 'gmc-hp-text' }, text: `${hp.current} / ${hp.max === null ? '?' : hp.max}${hp.temporary ? ` (+${hp.temporary} врем.)` : ''}` });
		const track = bar.createDiv({ cls: 'gmc-track', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(hp.max ?? 0), 'aria-valuenow': String(hp.current), 'aria-label': 'Хиты' } });
		const pct = hpPercent(hp.current, hp.max);
		track.createDiv({ cls: ['gmc-fill', pct <= 25 ? 'is-low' : ''].filter(Boolean) }).style.width = `${pct}%`;
		if (hp.current === 0 && m.hpTarget) bar.createDiv({ cls: 'gmc-warn', text: '0 хитов' });
		const target = m.hpTarget;
		if (!target) return;
		const form = card.createEl('form', { cls: 'gmc-hpform' });
		const input = form.createEl('input', { cls: 'gmc-input', type: 'text', attr: { placeholder: '−7 урон · +5 лечение · =12 установить', 'aria-label': 'Изменить хиты', 'data-testid': 'gmc-hp-input' } });
		form.addEventListener('submit', (ev) => {
			ev.preventDefault();
			void this.applyHp(m, input);
		});
		const btns = form.createDiv({ cls: 'gmc-row gmc-gap' });
		button(btns, 'Урон', () => void this.applyHp(m, input, 'damage'), { cls: 'gmc-btn gmc-btn-d', testId: 'gmc-damage' });
		button(btns, 'Лечение', () => void this.applyHp(m, input, 'heal'), { cls: 'gmc-btn gmc-btn-ok', testId: 'gmc-heal' });
		button(btns, 'Установить', () => void this.applyHp(m, input, 'set'), { cls: 'gmc-btn', testId: 'gmc-set' });
	}

	private async applyHp(m: CardModel, input: HTMLInputElement, force?: 'damage' | 'heal' | 'set'): Promise<void> {
		const target = m.hpTarget;
		if (!target) return;
		const parsed = parseHpInput(input.value);
		if (parsed.kind === 'invalid') {
			input.addClass('is-error');
			new Notice('Canvas Assist: введите целое число, например −7, +5 или =12');
			return;
		}
		input.removeClass('is-error');
		const kind = force && /^\s*\d/.test(input.value) ? force : parsed.kind;
		const out =
			kind === 'damage'
				? await this.ctl.act({ type: 'hp/damage', target, amount: parsed.amount, useTemporary: this.ctl.settings.temporaryHpAbsorbs })
				: kind === 'heal'
					? await this.ctl.act({ type: 'hp/heal', target, amount: parsed.amount })
					: m.characterId
						? await this.ctl.act({ type: 'character/set-hp', characterId: m.characterId, current: parsed.amount })
						: await this.ctl.act({ type: 'encounter/update-combatant', combatantId: target.id, patch: {} }).then(async () => {
								// non-PC "set": express as damage/heal relative to the current value (keeps temp HP rules and Undo simple)
								const cur = this.ctl.state?.activeEncounter?.combatants[target.id]?.hp?.current ?? 0;
								return parsed.amount >= cur ? this.ctl.act({ type: 'hp/heal', target, amount: parsed.amount - cur }) : this.ctl.act({ type: 'hp/damage', target, amount: cur - parsed.amount, useTemporary: false });
							});
		if (out.ok) input.value = '';
	}

	private abilityRow(parent: HTMLElement, m: CardModel): void {
		if (!m.abilities) return;
		const row = parent.createDiv({ cls: 'gmc-abil', attr: { 'data-testid': 'gmc-abilities' } });
		for (const a of ABILITIES) {
			const c = row.createDiv({ cls: 'gmc-abil-cell' });
			c.createDiv({ cls: 'gmc-eyebrow', text: ABILITY_RU[a] });
			c.createDiv({ cls: 'gmc-num', text: modText(m.abilities[a]) });
			c.createDiv({ cls: 'gmc-dim', text: String(m.abilities[a]) });
		}
	}

	private renderCompact(body: HTMLElement, m: CardModel): void {
		const card = body.createDiv({ cls: 'gmc-card', attr: { 'data-testid': 'gmc-card', 'data-kind': m.kind, ...(m.characterId ? { 'data-character-id': m.characterId } : {}) } });
		const top = card.createDiv({ cls: 'gmc-row gmc-between' });
		const idc = top.createDiv({ cls: 'gmc-row gmc-gap' });
		idc.createDiv({ cls: `gmc-token gmc-token-${m.kind}`, text: m.name.slice(0, 1).toUpperCase(), attr: { 'aria-hidden': 'true', title: { pc: 'Игрок', npc: 'NPC', monster: 'Монстр' }[m.kind] } });
		const id = idc.createDiv();
		id.createEl('h4', { text: m.name, cls: 'gmc-serif gmc-name', attr: { 'data-testid': 'gmc-name' } });
		id.createDiv({ cls: 'gmc-dim', text: m.sub || { pc: 'Игровой персонаж', npc: 'NPC', monster: 'Монстр' }[m.kind] });
		const ac = top.createDiv({ cls: 'gmc-ac', attr: { 'aria-label': 'Класс доспеха' } });
		ac.createDiv({ cls: 'gmc-eyebrow', text: 'КД' });
		ac.createDiv({ cls: 'gmc-num', text: m.ac === null ? '—' : `${m.ac}${m.acOverridden ? '*' : ''}`, attr: { 'data-testid': 'gmc-ac' } });
		this.hpBlock(card, m);
		this.abilityRow(card, m);
		const st = this.ctl.state;
		if (m.combatantId && st) {
			const cmb = st.activeEncounter?.combatants[m.combatantId];
			if (cmb) {
				const eff = effectsFor(st, cmb);
				if (eff.length) renderEffectPills(card.createDiv({ cls: 'gmc-effects' }), st, eff);
			}
		}
		if (m.attacks.length) {
			const at = card.createDiv({ cls: 'gmc-attacks', attr: { 'data-testid': 'gmc-attacks' } });
			at.createDiv({ cls: 'gmc-eyebrow', text: 'Атаки' });
			for (const a of m.attacks) this.attackRow(at, m, a);
		} else if (m.kind === 'pc') card.createDiv({ cls: 'gmc-dim', text: 'Нет экипированного оружия — откройте «Инвентарь», отметьте оружие «в руке».' });
		const row = card.createDiv({ cls: 'gmc-row gmc-gap gmc-wrap' });
		if (m.owner) button(row, 'Инвентарь', () => this.go({ k: 'inv' }), { icon: 'backpack', cls: 'gmc-btn', testId: 'gmc-inv' });
		if (m.characterId) button(row, 'Заклинания', () => this.go({ k: 'spells' }), { icon: 'sparkles', cls: 'gmc-btn', testId: 'gmc-spells' });
		button(row, 'Полная', () => this.go({ k: 'full' }), { icon: 'maximize-2', cls: 'gmc-btn', testId: 'gmc-full' });
		if (m.hpTarget === null && m.owner?.kind === 'creature') button(row, 'В бой', () => void addCreatureToCombat(this.ctl, (m.owner as { id: string }).id), { icon: 'swords', cls: 'gmc-btn gmc-btn-ok', testId: 'gmc-to-combat' });
		if (m.characterId) {
			const ch = this.ctl.state?.characters[m.characterId];
			const f = ch ? this.ctl.noteFile(ch.notePath) : null;
			button(row, 'Заметка', () => f && void this.app.workspace.getLeaf('tab').openFile(f), { icon: 'file-text', cls: 'gmc-btn gmc-btn-g', disabled: !f, testId: 'gmc-open-note' });
		}
	}

	private attackRow(parent: HTMLElement, m: CardModel, a: AttackRow): void {
		const r = parent.createDiv({ cls: 'gmc-attack', attr: { tabindex: '0', role: 'button', 'aria-label': `Открыть ${a.name}`, 'data-testid': `gmc-attack-${a.key}` } });
		r.createSpan({ cls: 'gmc-attack-name', text: a.name });
		r.createSpan({ cls: 'gmc-num', text: signed(a.bonus), attr: { 'data-testid': 'gmc-attack-bonus' } });
		r.createSpan({ cls: 'gmc-attack-dmg', text: `${a.damage}${a.damageType ? ` ${a.damageType}` : ''}`, attr: { 'data-testid': 'gmc-attack-dmg' } });
		const open = (): void => this.go({ k: 'weapon', key: a.key, itemId: a.itemId });
		r.addEventListener('click', open);
		r.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				open();
			}
		});
		void m;
	}

	private renderWeapon(body: HTMLElement, m: CardModel, key: string, itemId: string | null): void {
		const st = this.ctl.state;
		if (!st) return;
		const item = itemId ? cockpitOf(st).items[itemId] : undefined;
		const type = item ? resolveItemType(st, item) : null;
		const row = m.attacks.find((a) => a.key === key);
		const card = body.createDiv({ cls: 'gmc-card gmc-parch-no', attr: { 'data-testid': 'gmc-weapon' } });
		card.createEl('h4', { text: item?.name ?? row?.name ?? 'Оружие', cls: 'gmc-serif gmc-name', attr: { 'data-testid': 'gmc-weapon-name' } });
		card.createDiv({ cls: 'gmc-dim', text: `Владелец: ${m.name}` });
		const kv = (k: string, v: string, id?: string): void => {
			const r = card.createDiv({ cls: 'gmc-kv' });
			r.createSpan({ cls: 'gmc-dim', text: k });
			r.createSpan({ cls: v.length <= 10 ? 'gmc-num' : 'gmc-val', text: v, ...(id ? { attr: { 'data-testid': id } } : {}) });
		};
		kv('Стоимость', type ? formatCost(type.costCp) : '—', 'gmc-w-cost');
		kv('Вес', type ? formatWeight(type.weight) : '—', 'gmc-w-weight');
		if (row) {
			kv('Бонус атаки', signed(row.bonus), 'gmc-w-bonus');
			kv('Урон', `${row.damage}${row.damageType ? `, ${row.damageType}` : ''}`, 'gmc-w-damage');
			kv('Дистанция', row.range || '—');
		}
		if (type?.properties.length) kv('Свойства', type.properties.join(', '), 'gmc-w-props');
		if (row?.notes) kv('Заметка', row.notes);
		if (item?.magicBonus) kv('Магический бонус', signed(item.magicBonus));
		const det = card.createEl('details', { cls: 'gmc-how', attr: { 'data-testid': 'gmc-how' } });
		det.createEl('summary', { text: 'Как считается' });
		if (type && m.abilities) {
			const calc = weaponAttack(type, m.abilities, m.prof, m.sheet ? isProficientWith(type, m.sheet) : true, item?.magicBonus ?? 0);
			for (const line of calc.how) det.createDiv({ text: line });
			if (row && row.bonus !== calc.bonus) det.createDiv({ cls: 'gmc-warn', text: `В статблоке указано ${signed(row.bonus)} — показано оно; расчёт по характеристикам даёт ${signed(calc.bonus)}.` });
			else if (m.statblock) det.createDiv({ cls: 'gmc-dim', text: `Мастерство ${signed(m.prof)} — из статблока.` });
		} else det.createDiv({ cls: 'gmc-dim', text: 'Бонус задан вручную в статблоке.' });
		card.createDiv({ cls: 'gmc-dim', text: 'Попадание и итоговый урон определяет мастер.' });
	}

	private ownerItems(m: CardModel): ItemInstance[] {
		const st = this.ctl.state;
		return st && m.owner ? itemsOf(cockpitOf(st), m.owner.id).filter((i) => i.ownerKind === m.owner?.kind) : [];
	}

	private renderInventory(body: HTMLElement, m: CardModel): void {
		const st = this.ctl.state;
		if (!st || !m.owner) return;
		const owner = m.owner;
		const c = cockpitOf(st);
		const items = this.ownerItems(m);
		const card = body.createDiv({ cls: 'gmc-card', attr: { 'data-testid': 'gmc-inventory' } });
		card.createEl('h4', { text: `Инвентарь: ${m.name}`, cls: 'gmc-serif gmc-name' });
		const weight = carriedWeight(c, owner.id, (i) => resolveItemType(st, i));
		card.createDiv({ cls: 'gmc-dim', text: `Вес: ${formatWeight(weight)}${m.abilities ? ` · грузоподъёмность ${m.abilities.str * 15} фнт` : ''}` });
		const list = card.createDiv({ cls: 'gmc-items' });
		const draw = (parentId: string | null, depth: number): void => {
			for (const it of items.filter((i) => i.containerId === parentId)) {
				const t = resolveItemType(st, it);
				const r = list.createDiv({ cls: 'gmc-item', attr: { 'data-testid': `gmc-item-${it.id}`, style: `padding-left:${depth * 14}px` } });
				const name = r.createDiv({ cls: 'gmc-item-name', attr: { tabindex: '0', role: 'button' } });
				name.createSpan({ text: it.name });
				if (it.equipped) name.createSpan({ cls: 'gmc-tag', text: t?.kind === 'weapon' ? 'в руке' : 'надето' });
				name.createSpan({ cls: 'gmc-dim', text: `${t ? formatCost(t.costCp) : '—'} · ${t ? formatWeight(t.weight) : '—'}${t?.damage ? ` · ${t.damage}` : ''}` });
				const open = (): void => this.go({ k: 'item', id: it.id });
				name.addEventListener('click', open);
				name.addEventListener('keydown', (e) => e.key === 'Enter' && open());
				const ctrl = r.createDiv({ cls: 'gmc-row gmc-gap' });
				button(ctrl, '−', () => void this.setQty(it, it.qty - 1), { cls: 'gmc-btn gmc-btn-sm gmc-btn-i', title: 'Уменьшить', testId: `gmc-qty-dec-${it.id}` });
				ctrl.createSpan({ cls: 'gmc-num', text: `×${it.qty}`, attr: { 'data-testid': `gmc-qty-${it.id}` } });
				button(ctrl, '+', () => void this.setQty(it, it.qty + 1), { cls: 'gmc-btn gmc-btn-sm gmc-btn-i', title: 'Увеличить', testId: `gmc-qty-inc-${it.id}` });
				if (t && ['weapon', 'armor', 'shield'].includes(t.kind)) button(ctrl, it.equipped ? 'Снять' : 'Надеть', () => void this.ctl.act({ type: 'cockpit/item-upsert', item: { ...it, equipped: !it.equipped } }), { cls: 'gmc-btn gmc-btn-sm', testId: `gmc-equip-${it.id}` });
				button(ctrl, 'Передать…', () => new TransferModal(this.ctl, it).open(), { cls: 'gmc-btn gmc-btn-sm', testId: `gmc-transfer-${it.id}` });
				if (t?.kind === 'container') button(ctrl, '+ внутрь', () => new AddItemModal(this.ctl, owner, it.id).open(), { cls: 'gmc-btn gmc-btn-sm' });
				button(ctrl, '', () => void this.ctl.act({ type: 'cockpit/item-remove', itemId: it.id }), { icon: 'x', title: 'Удалить', cls: 'gmc-btn gmc-btn-sm gmc-btn-g', testId: `gmc-del-${it.id}` });
				draw(it.id, depth + 1);
			}
		};
		draw(null, 0);
		if (!items.length) list.createDiv({ cls: 'gmc-dim', text: 'Пусто.' });
		button(card, 'Добавить предмет', () => new AddItemModal(this.ctl, owner).open(), { icon: 'plus', cls: 'gmc-btn', testId: 'gmc-add-item' });
		this.coins(card, owner.id);
	}

	private async setQty(it: ItemInstance, qty: number): Promise<void> {
		if (qty < 0) return;
		await this.ctl.act({ type: 'cockpit/item-upsert', item: { ...it, qty } });
	}

	private coins(card: HTMLElement, ownerId: string): void {
		const st = this.ctl.state;
		if (!st) return;
		const p = purseOf(cockpitOf(st), ownerId);
		card.createDiv({ cls: 'gmc-eyebrow', text: 'Монеты' });
		const row = card.createDiv({ cls: 'gmc-coins' });
		for (const [k, ru] of [['pp', 'пм'], ['gp', 'зм'], ['ep', 'эм'], ['sp', 'см'], ['cp', 'мм']] as const) {
			const cell = row.createDiv();
			cell.createDiv({ cls: 'gmc-eyebrow', text: ru });
			const inp = cell.createEl('input', { cls: 'gmc-input', type: 'number', value: String(p[k]), attr: { min: '0', 'aria-label': ru, 'data-testid': `gmc-coin-${k}` } });
			inp.addEventListener('change', () => void this.ctl.act({ type: 'cockpit/purse-set', ownerId, purse: { ...p, [k]: Math.max(0, Math.floor(Number(inp.value)) || 0) } }));
		}
	}

	private renderItem(body: HTMLElement, m: CardModel, id: string): void {
		const st = this.ctl.state;
		const it = st ? cockpitOf(st).items[id] : undefined;
		if (!st || !it) return void body.createDiv({ cls: 'gmc-warn', text: 'Предмет не найден.' });
		const t = resolveItemType(st, it);
		if (t?.kind === 'weapon') {
			const calc = m.abilities ? weaponAttack(t, m.abilities, m.prof, m.sheet ? isProficientWith(t, m.sheet) : true, it.magicBonus) : null;
			return this.renderWeapon(body, { ...m, attacks: calc ? [{ key: it.id, itemId: it.id, name: it.name, bonus: calc.bonus, damage: calc.damage, damageType: calc.damageType, range: calc.range, notes: '' }] : [] }, it.id, it.id);
		}
		const card = body.createDiv({ cls: 'gmc-card', attr: { 'data-testid': 'gmc-item-card' } });
		card.createEl('h4', { text: it.name, cls: 'gmc-serif gmc-name' });
		const kv = (k: string, v: string): void => {
			const r = card.createDiv({ cls: 'gmc-kv' });
			r.createSpan({ cls: 'gmc-dim', text: k });
			r.createSpan({ cls: 'gmc-num', text: v });
		};
		kv('Стоимость', t ? formatCost(t.costCp) : '—');
		kv('Вес', t ? formatWeight(t.weight) : '—');
		kv('Количество', String(it.qty));
		if (t?.ac) kv('КД', armorClassLabel(t) + (t.ac.minStr ? ` · СИЛ ${t.ac.minStr}` : '') + (t.ac.stealthDis ? ' · помеха Скрытности' : ''));
		if (t?.text) card.createDiv({ text: t.text });
	}

	private renderFull(body: HTMLElement, m: CardModel): void {
		const st = this.ctl.state;
		if (!st) return;
		const card = body.createDiv({ cls: 'gmc-card', attr: { 'data-testid': 'gmc-full-card' } });
		card.createEl('h4', { text: m.name, cls: 'gmc-serif gmc-name' });
		card.createDiv({ cls: 'gmc-dim', text: m.sub });
		this.hpBlock(card, m);
		this.abilityRow(card, m);
		if (m.sheet && m.characterId) {
			const sh = m.sheet;
			const id = m.characterId;
			const prof = m.prof;
			const sec = (title: string): HTMLElement => {
				const d = card.createEl('details', { cls: 'gmc-sec' });
				d.createEl('summary', { text: title });
				return d;
			};
			const ab = sec('Характеристики (редактирование по бумажному листу)');
			ab.setAttr('open', '');
			const g = ab.createDiv({ cls: 'gmc-abilgrid' });
			for (const a of ABILITIES) {
				const cell = g.createDiv();
				cell.createDiv({ cls: 'gmc-eyebrow', text: ABILITY_RU[a] });
				const inp = cell.createEl('input', { cls: 'gmc-input', type: 'number', value: String(sh.abilities[a]), attr: { 'data-testid': `gmc-edit-${a}`, 'aria-label': ABILITY_RU[a] } });
				inp.addEventListener('change', () => void this.ctl.act({ type: 'cockpit/sheet-set', characterId: id, patch: { abilities: { ...sh.abilities, [a]: Math.max(1, Math.min(40, Math.floor(Number(inp.value)) || 10)) } } }));
			}
			const saves = sec(`Спасброски (мастерство ${signed(prof)})`);
			for (const a of ABILITIES) saves.createDiv({ text: `${sh.saveProf.includes(a) ? '● ' : '○ '}${ABILITY_RU[a]} ${signed(saveBonus(sh, a, prof))}` });
			const sk = sec('Навыки');
			for (const s of SKILLS) sk.createDiv({ text: `${sh.skills[s.id] === 2 ? '◆ ' : sh.skills[s.id] ? '● ' : '○ '}${s.ru} ${signed(skillBonus(sh, s.id, prof))}` });
			const sc = spellDc(sh, prof);
			if (sc !== null) card.createDiv({ cls: 'gmc-kv' }).setText(`Сл заклинаний ${sc} · атака заклинанием ${signed(spellAttackBonus(sh, prof) ?? 0)}`);
			if (sh.features.length) {
				const f = sec('Способности');
				for (const x of sh.features) f.createDiv({ text: `${x.name}: ${x.text}` });
			}
			const ch = st.characters[id];
			if (ch) card.createDiv({ cls: 'gmc-dim', text: `Скорость ${ch.speedFeet ?? '—'} фт · Кости хитов ${ch.hitDice.map((h) => `${h.remaining}/${h.total}${h.die}`).join(', ') || '—'}` });
		}
		if (m.statblock) {
			const sb = m.statblock;
			const kv = (k: string, v: string): void => {
				if (!v) return;
				const r = card.createDiv({ cls: 'gmc-kv' });
				r.createSpan({ cls: 'gmc-dim', text: k });
				r.createSpan({ text: v });
			};
			kv('Мастерство', signed(sb.profBonus));
			kv('ОП', sb.cr);
			kv('Скорость', sb.speed);
			kv('Спасброски', sb.saves);
			kv('Навыки', sb.skills);
			kv('Сопротивления', sb.resist);
			kv('Иммунитеты', sb.immune);
			kv('Уязвимости', sb.vuln);
			kv('Иммунитет к состояниям', sb.conditionImmune);
			kv('Чувства', sb.senses);
			kv('Языки', sb.languages);
			for (const t of sb.traits) card.createDiv({ text: `${t.name}. ${t.text}` });
			for (const t of sb.actions) card.createDiv({ text: `${t.name}. ${t.text}` });
			card.createDiv({ cls: 'gmc-dim', text: `Источник: ${{ official: 'официальный', adapted: 'адаптированный', generated: 'сгенерированный', custom: 'пользовательский' }[sb.origin]} · ${sb.sourceNote}` });
		}
		void profBonusOf;
	}

	private async renderRoom(body: HTMLElement, path: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		const card = body.createDiv({ cls: 'gmc-card', attr: { 'data-testid': 'gmc-room' } });
		if (!(f instanceof TFile)) return void card.createDiv({ cls: 'gmc-warn', text: 'Заметка помещения не найдена (удалена или перемещена).' });
		const md = await this.app.vault.cachedRead(f);
		const room = parseRoom(md, f.basename);
		card.createEl('h4', { text: room.title, cls: 'gmc-serif gmc-name', attr: { 'data-testid': 'gmc-room-title' } });
		card.createDiv({ cls: 'gmc-dim', text: 'Справочная карточка помещения' });
		if (room.intro) await MarkdownRenderer.render(this.app, room.intro, card.createDiv({ cls: 'gmc-md' }), f.path, this);
		for (const s of room.sections) {
			const d = card.createEl('details', { cls: `gmc-sec ${s.hidden ? 'gmc-hidden' : ''}`, attr: { 'data-testid': s.hidden ? 'gmc-room-hidden' : 'gmc-room-sec' } });
			d.setAttr('open', '');
			const sum = d.createEl('summary');
			if (s.hidden) sum.createSpan({ cls: 'gmc-hidden-tag', text: '🔒 скрыто' });
			sum.createSpan({ text: ` ${s.heading}` });
			if (s.body) await MarkdownRenderer.render(this.app, s.body, d.createDiv({ cls: 'gmc-md' }), f.path, this);
		}
		const row = card.createDiv({ cls: 'gmc-row gmc-gap' });
		button(row, 'Открыть заметку', () => void this.app.workspace.getLeaf('tab').openFile(f), { icon: 'file-text', cls: 'gmc-btn gmc-btn-g', testId: 'gmc-room-note' });
	}

	// ---- spells --------------------------------------------------------------------------------

	private renderSpells(body: HTMLElement, m: CardModel): void {
		const st = this.ctl.state;
		if (!st || !m.characterId) return;
		const ch = st.characters[m.characterId];
		if (!ch) return;
		const card = body.createDiv({ cls: 'gmc-card', attr: { 'data-testid': 'gmc-spellbook' } });
		card.createEl('h4', { text: `Заклинания: ${m.name}`, cls: 'gmc-serif gmc-name' });
		const slotsRow = card.createDiv({ cls: 'gmc-slots' });
		const lvls = Object.keys(ch.spellSlots).sort();
		if (!lvls.length) slotsRow.createDiv({ cls: 'gmc-dim', text: 'Ячеек нет. Измените их в «Полная» или импортом.' });
		for (const lv of lvls) {
			const s = ch.spellSlots[lv];
			if (!s) continue;
			const cell = slotsRow.createDiv({ cls: 'gmc-slot', attr: { 'data-testid': `gmc-slot-${lv}` } });
			cell.createDiv({ cls: 'gmc-eyebrow', text: `${lv} ур.` });
			const c = cell.createDiv({ cls: 'gmc-row gmc-gap' });
			button(c, '−', () => void this.ctl.act({ type: 'character/set-slot', characterId: ch.id, level: lv, slot: { ...s, current: Math.max(0, s.current - 1) } }), { cls: 'gmc-btn gmc-btn-sm gmc-btn-i', title: 'Потратить', testId: `gmc-slot-dec-${lv}` });
			c.createSpan({ cls: 'gmc-num', text: `${s.current}/${s.max}`, attr: { 'data-testid': `gmc-slot-val-${lv}` } });
			button(c, '+', () => void this.ctl.act({ type: 'character/set-slot', characterId: ch.id, level: lv, slot: { ...s, current: Math.min(s.max, s.current + 1) } }), { cls: 'gmc-btn gmc-btn-sm gmc-btn-i', title: 'Вернуть', testId: `gmc-slot-inc-${lv}` });
		}
		const book = cockpitOf(st).spellbooks[ch.id] ?? { known: [], prepared: [] };
		const list = card.createDiv({ cls: 'gmc-items' });
		for (const sp of [...book.known].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'))) {
			const r = list.createDiv({ cls: 'gmc-item', attr: { 'data-testid': `gmc-sp-${sp.id}` } });
			const name = r.createDiv({ cls: 'gmc-item-name', attr: { tabindex: '0', role: 'button' } });
			name.createSpan({ text: sp.name });
			name.createSpan({ cls: 'gmc-dim', text: `${sp.level === 0 ? 'заговор' : `${sp.level} ур.`}${sp.concentration ? ' · конц.' : ''}` });
			const open = (): void => {
				this.slotChoice = 0;
				this.go({ k: 'spell', id: sp.id });
			};
			name.addEventListener('click', open);
			name.addEventListener('keydown', (e) => e.key === 'Enter' && open());
			const ctrl = r.createDiv({ cls: 'gmc-row gmc-gap' });
			if (sp.level > 0) {
				const lab = ctrl.createEl('label', { cls: 'gmc-check' });
				const cb = lab.createEl('input', { type: 'checkbox', attr: { 'data-testid': `gmc-prep-${sp.id}` } });
				cb.checked = book.prepared.includes(sp.id);
				cb.addEventListener('change', () => void this.ctl.act({ type: 'cockpit/spellbook-set', characterId: ch.id, book: { known: book.known, prepared: cb.checked ? [...book.prepared, sp.id] : book.prepared.filter((x) => x !== sp.id) } }));
				lab.createSpan({ text: 'подг.' });
			}
			button(ctrl, '', () => void this.ctl.act({ type: 'cockpit/spellbook-set', characterId: ch.id, book: { known: book.known.filter((k) => k.id !== sp.id), prepared: book.prepared.filter((x) => x !== sp.id) } }), { icon: 'x', title: 'Убрать у персонажа', cls: 'gmc-btn gmc-btn-sm gmc-btn-g' });
		}
		if (!book.known.length) list.createDiv({ cls: 'gmc-dim', text: 'Нет заклинаний. Добавьте из библиотеки или импортом.' });
		button(card, 'Добавить заклинание', () => new SpellImportModal(this.ctl, ch.id, () => undefined).open(), { icon: 'plus', cls: 'gmc-btn', testId: 'gmc-add-spell' });
	}

	private renderSpell(body: HTMLElement, m: CardModel, id: string): void {
		const st = this.ctl.state;
		if (!st || !m.characterId) return;
		const ch = st.characters[m.characterId];
		const sp = this.ctl.settings.spells.find((s) => s.id === id);
		const ref = cockpitOf(st).spellbooks[m.characterId]?.known.find((k) => k.id === id);
		if (!ch || (!sp && !ref)) return void body.createDiv({ cls: 'gmc-warn', text: 'Карточка заклинания отсутствует в локальной библиотеке. Откройте «Добавить заклинание» и импортируйте её заново.' });
		const level = sp?.level ?? ref?.level ?? 0;
		const conc = sp?.concentration ?? ref?.concentration ?? false;
		const name = sp?.name ?? ref?.name ?? id;
		const card = body.createDiv({ cls: 'gmc-card gmc-parch', attr: { 'data-testid': 'gmc-spell' } });
		card.createEl('h4', { text: name, cls: 'gmc-serif gmc-name', attr: { 'data-testid': 'gmc-spell-name' } });
		card.createDiv({ cls: 'gmc-dim', text: `${level === 0 ? 'Заговор' : `${level} уровень`}${sp ? `, ${sp.school}` : ''}${conc ? ' · концентрация' : ''}` });
		if (sp) {
			const kv = (k: string, v: string): void => {
				const r = card.createDiv({ cls: 'gmc-kv' });
				r.createSpan({ cls: 'gmc-dim', text: k });
				r.createSpan({ text: v });
			};
			kv('Время', sp.castingTime);
			kv('Дистанция', sp.range);
			kv('Компоненты', sp.components);
			kv('Длительность', sp.duration);
			card.createDiv({ cls: 'gmc-spell-text', text: sp.text });
			if (sp.higherLevels) card.createDiv({ cls: 'gmc-dim', text: `На более высоких уровнях: ${sp.higherLevels}` });
			card.createDiv({ cls: 'gmc-dim', text: `Источник: ${sp.source}${sp.origin === 'manual' ? ' (введено вручную)' : sp.origin === 'json' ? ' (JSON)' : ''}` });
		}
		if (m.sheet) {
			const dc = spellDc(m.sheet, m.prof);
			if (dc !== null) card.createDiv({ cls: 'gmc-dim', text: `Сл ${dc} · атака ${signed(spellAttackBonus(m.sheet, m.prof) ?? 0)}` });
		}
		const levels = Object.entries(ch.spellSlots).filter(([lv, s]) => Number(lv) >= Math.max(1, level) && s.max > 0).sort();
		if (level > 0) {
			const sel = card.createDiv({ cls: 'gmc-row gmc-gap gmc-wrap', attr: { 'data-testid': 'gmc-slot-choice' } });
			sel.createSpan({ cls: 'gmc-dim', text: 'Ячейка:' });
			if (!this.slotChoice && levels.length) this.slotChoice = Number((levels.find(([, s]) => s.current > 0) ?? levels[0])?.[0] ?? 0);
			for (const [lv, s] of levels) button(sel, `${lv} ур. · осталось ${s.current}`, () => ((this.slotChoice = Number(lv)), (this.lastKey = ''), this.render()), { cls: `gmc-btn gmc-btn-sm ${this.slotChoice === Number(lv) ? 'is-on' : ''}`, testId: `gmc-slotpick-${lv}`, disabled: s.current <= 0 });
		}
		const row = card.createDiv({ cls: 'gmc-row gmc-gap gmc-wrap' });
		const cue = this.ctl.settings.cues.find((c) => c.cardId === id);
		button(row, 'Использовать', () => void this.cast(m, { id, name, level, concentration: conc }, level === 0 ? 0 : this.slotChoice), { cls: 'gmc-btn gmc-btn-p', testId: 'gmc-cast' });
		button(row, 'Свет ▶', () => void this.fireCue(id), { cls: 'gmc-btn gmc-btn-a', disabled: !cue, title: cue ? 'Отправить OSC-команду' : 'Cue не привязан', testId: 'gmc-light' });
		button(row, cue ? 'Cue…' : 'Привязать cue', () => new CueModal(this.ctl, { id, name }, () => { this.lastKey = ''; this.render(); }).open(), { cls: 'gmc-btn gmc-btn-g', testId: 'gmc-cue' });
		card.createDiv({ cls: 'gmc-dim gmc-lightres', attr: { 'data-testid': 'gmc-light-res' } });
	}

	private async cast(m: CardModel, spell: { id: string; name: string; level: number; concentration: boolean }, slotLevel: number): Promise<void> {
		if (!m.characterId) return;
		if (spell.level > 0 && !slotLevel) return void new Notice('Выберите ячейку');
		let effect: Effect | undefined;
		if (spell.concentration) {
			effect = { id: newId('eff'), conditionId: null, label: `Концентрация: ${spell.name}`, target: { kind: 'character', id: m.characterId }, sourceCombatantId: null, sourceLabel: m.name, duration: { kind: 'manual' }, createdAtEventSeq: 0, isConcentration: true, concentrationEffectId: null, needsDecision: false, notes: '' };
		}
		const out = await this.ctl.act({ type: 'cockpit/cast', characterId: m.characterId, spell, slotLevel, ...(effect ? { effect } : {}) });
		if (!out.ok) return;
		const cue = this.ctl.settings.cues.find((c) => c.cardId === spell.id);
		if (cue?.autoStart) void this.fireCue(spell.id);
		this.slotChoice = 0;
	}

	private async fireCue(spellId: string): Promise<void> {
		const cue = this.ctl.settings.cues.find((c) => c.cardId === spellId);
		if (!cue) return;
		const lk = this.ctl.settings.lightkey;
		const r = await sendCue(new DgramTransport(), { host: lk.host, port: lk.port }, cue);
		const el = this.contentEl.querySelector('.gmc-lightres');
		if (el) el.setText(r.status === 'sent' ? `Отправлено на ${r.target}. Выполнение не подтверждается.` : `Ошибка света: ${r.detail}`);
		if (r.status === 'error') new Notice(`Lightkey: ${r.detail}`, 6000);
	}
}
void weaponItemsOf;
