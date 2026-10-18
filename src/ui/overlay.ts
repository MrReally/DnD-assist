// Compact overlay inside a Canvas view: top bar, initiative ribbon, target bar and a collapsible
// navigator. The Canvas surface stays Obsidian's; collapsed parts do not cover content.
import { Menu, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import { CATEGORY_LABELS, CATEGORY_ORDER, groupByCategory, searchItems, type CanvasItem } from '../domain/canvas-model';
import { computeSlots, effectiveAc, hasPreviousTurn, hpOf, type Slot } from '../domain/combat';
import { formatClock, shortDuration } from '../domain/effect-clock';
import { encounterFromTemplate } from '../domain/encounter';
import { newId } from '../domain/ids';
import type { AdventureState, Combatant, Effect, NodeCategory } from '../domain/types';
import { focusNode, probeCanvas } from '../adapters/canvas-adapter';
import type { ChangeReason, Controller } from '../controller';
import { button, hpText, NumberModal } from './common';
import { endEncounter, jumpToSlot, nextTurn, openDamage, openEffect, openHeal, openTempHp, previousTurn, removeCombatant } from './actions';
import { CardModal } from './card-modal';
import { AddCombatantModal } from './encounter-modals';
import { EffectModal } from './effect-modal';
import { RecoveryModal, RegisterAdventureModal } from './misc-modals';

export interface OverlayHost {
	openPanel(): void;
	saveSettings(): Promise<void>;
}

export function effectsFor(state: AdventureState, c: Combatant): Effect[] {
	return Object.values(state.effects).filter(
		(e) => (e.target.kind === 'combatant' && e.target.id === c.id) || (e.target.kind === 'character' && c.characterId !== null && e.target.id === c.characterId),
	);
}

/** Same-label effects are summarised in one pill; details list every source separately. */
export function renderEffectPills(parent: HTMLElement, state: AdventureState, effects: Effect[], onClick?: (e: Effect) => void): void {
	const groups = new Map<string, Effect[]>();
	for (const e of effects) groups.set(e.label, [...(groups.get(e.label) ?? []), e]);
	for (const [label, list] of groups) {
		const warn = list.some((e) => e.needsDecision);
		const pill = parent.createSpan({ cls: `ca-pill${warn ? ' ca-pill-warn' : ''}${list.some((e) => e.isConcentration) ? ' ca-pill-conc' : ''}` });
		const left = list.map((e) => shortDuration(e, state.gameClock.minutes)).join(', ');
		pill.setText(`${label}${list.length > 1 ? ` ×${list.length}` : ''} · ${left}`);
		pill.title = list
			.map((e) => `${e.label}: ${e.sourceLabel || (e.sourceCombatantId ? state.activeEncounter?.combatants[e.sourceCombatantId]?.displayName : '') || 'без источника'} (${shortDuration(e, state.gameClock.minutes)})`)
			.join('\n');
		if (onClick) {
			pill.addClass('ca-clickable');
			pill.setAttr('role', 'button');
			pill.tabIndex = 0;
			const first = list[0];
			const open = (ev: Event): void => {
				ev.stopPropagation();
				if (first) onClick(first);
			};
			pill.addEventListener('click', open);
			pill.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') open(ev);
			});
		}
	}
}

function hostElement(leaf: WorkspaceLeaf): HTMLElement {
	return (leaf.view as unknown as { contentEl?: HTMLElement }).contentEl ?? leaf.view.containerEl;
}

export class CanvasOverlay {
	readonly root: HTMLElement;
	private bar: HTMLElement;
	private ribbon: HTMLElement;
	private targetBar: HTMLElement;
	private nav: HTMLElement;
	private navResults: HTMLElement | null = null;
	private query = '';
	private categoryFilter = new Set<NodeCategory>();
	private collapsedGroups = new Set<NodeCategory>();
	private highlightNode: string | null = null;
	private unsub: () => void;
	private destroyed = false;
	private renderQueued = false;

	constructor(
		private readonly ctl: Controller,
		readonly leaf: WorkspaceLeaf,
		private readonly host: OverlayHost,
	) {
		const container = hostElement(leaf);
		container.addClass('ca-host');
		this.root = container.createDiv({ cls: 'ca-overlay', attr: { 'data-testid': 'ca-overlay' } });
		this.bar = this.root.createDiv({ cls: 'ca-bar', attr: { role: 'toolbar', 'aria-label': 'Canvas Assist' } });
		this.ribbon = this.root.createDiv({ cls: 'ca-ribbon', attr: { role: 'list', 'aria-label': 'Порядок инициативы' } });
		this.nav = this.root.createDiv({ cls: 'ca-nav' });
		this.targetBar = this.root.createDiv({ cls: 'ca-targetbar' });
		this.unsub = ctl.onChange((r) => this.schedule(r));
		this.renderAll();
	}

	private isActive(): boolean {
		return this.ctl.activeCanvasLeaf === this.leaf;
	}

	private schedule(reason: ChangeReason): void {
		if (this.destroyed) return;
		if (reason === 'context' || reason === 'canvas') this.navDirty = true;
		if (this.renderQueued) return;
		this.renderQueued = true;
		window.requestAnimationFrame(() => {
			this.renderQueued = false;
			if (!this.destroyed) this.renderAll();
		});
	}

	private navDirty = true;

	renderAll(): void {
		const active = this.isActive();
		this.root.toggleClass('ca-inactive', !active);
		this.root.toggleClass('ca-collapsed', this.ctl.settings.barCollapsed);
		this.renderBar();
		this.renderRibbon();
		this.renderTargetBar();
		if (this.navDirty) {
			this.navDirty = false;
			void this.renderNav();
		}
	}

	private renderBar(): void {
		const el = this.bar;
		el.empty();
		const ctl = this.ctl;
		const s = ctl.state;
		const store = ctl.store;
		button(el, '', () => {
			ctl.settings.barCollapsed = !ctl.settings.barCollapsed;
			void this.host.saveSettings();
			this.renderAll();
		}, { icon: ctl.settings.barCollapsed ? 'chevron-right' : 'swords', cls: 'ca-brand', title: ctl.settings.barCollapsed ? 'Развернуть Canvas Assist' : 'Свернуть Canvas Assist', testId: 'bar-toggle' });
		if (ctl.settings.barCollapsed) {
			const enc = s?.activeEncounter;
			if (enc && enc.round > 0) el.createSpan({ cls: 'ca-chip', text: `Р${enc.round}` });
			return;
		}
		if (!this.isActive()) {
			el.createSpan({ cls: 'ca-muted', text: 'Canvas Assist: неактивная вкладка' });
			return;
		}
		if (!s || !store) {
			el.createSpan({ cls: 'ca-muted', text: ctl.unregisteredHint ? `Не подключено: «${ctl.unregisteredHint}»` : 'Canvas вне приключения' });
			button(el, 'Подключить приключение', () => void this.openRegister(), { cls: 'mod-cta', testId: 'bar-register' });
			if (store && store.info.mode !== 'ok') this.renderRecoveryChip(el);
			return;
		}
		el.createSpan({ cls: 'ca-adv', text: s.name, attr: { title: `Корень: ${s.rootPath}`, 'data-testid': 'bar-adventure' } });
		const party = el.createEl('select', { cls: 'dropdown ca-select', attr: { 'aria-label': 'Партия', 'data-testid': 'bar-party' } });
		party.createEl('option', { value: '', text: 'Без партии' });
		for (const p of s.parties) party.createEl('option', { value: p.id, text: p.name });
		party.value = s.activePartyId ?? '';
		party.addEventListener('change', () => void this.switchParty(party.value || null));

		const enc = s.activeEncounter;
		if (!enc) {
			button(el, 'Бой', (ev) => this.encounterMenu(ev), { icon: 'swords', testId: 'bar-encounter-menu' });
		} else {
			const slots = computeSlots(enc);
			const active = slots.find((x) => x.id === enc.activeSlotId);
			el.createSpan({ cls: 'ca-chip ca-round', text: enc.round === 0 ? 'Подготовка' : `Раунд ${enc.round}`, attr: { 'data-testid': 'bar-round' } });
			if (active) el.createSpan({ cls: 'ca-chip ca-active-name', text: `${active.name} (${active.initiative ?? '?'})`, attr: { 'data-testid': 'bar-active' } });
			button(el, '', () => void previousTurn(ctl), { icon: 'skip-back', title: 'Предыдущий ход', disabled: enc.round === 0 || !hasPreviousTurn(enc) || enc.paused, testId: 'bar-prev' });
			button(el, enc.round === 0 ? 'Начать' : '', () => void nextTurn(ctl), { icon: enc.round === 0 ? 'play' : 'skip-forward', title: enc.round === 0 ? 'Начать бой (раунд 1)' : 'Следующий ход', disabled: enc.paused, cls: enc.round === 0 ? 'mod-cta' : '', testId: 'bar-next' });
			button(el, '', () => void ctl.act({ type: 'encounter/pause', paused: !enc.paused }), { icon: enc.paused ? 'play-circle' : 'pause', title: enc.paused ? 'Возобновить' : 'Пауза' });
			button(el, '', () => new AddCombatantModal(ctl).open(), { icon: 'user-plus', title: 'Добавить участников', testId: 'bar-add' });
			button(el, '', () => void endEncounter(ctl), { icon: 'square', title: 'Завершить бой', testId: 'bar-end' });
		}
		el.createSpan({ cls: 'ca-chip ca-clock', text: formatClock(s.gameClock.minutes), attr: { title: 'Внутриигровое время' } });
		const spacer = el.createDiv({ cls: 'ca-spacer' });
		void spacer;
		button(el, '', () => void ctl.undo(), { icon: 'undo-2', title: `Отменить${s.history.undo.length ? `: ${s.history.undo.at(-1)?.label}` : ''}`, disabled: !s.history.undo.length, testId: 'bar-undo' });
		button(el, '', () => void ctl.redo(), { icon: 'redo-2', title: `Повторить${s.history.redo.length ? `: ${s.history.redo.at(-1)?.label}` : ''}`, disabled: !s.history.redo.length, testId: 'bar-redo' });
		const status = store.info.status;
		const statusText = status === 'saving' ? 'сохранение…' : status === 'error' ? 'НЕ сохранено' : 'сохранено';
		el.createSpan({ cls: `ca-save ca-save-${status}`, text: statusText, attr: { 'data-testid': 'bar-save', title: store.info.message ?? statusText, 'aria-live': 'polite' } });
		if (store.info.mode !== 'ok') this.renderRecoveryChip(el);
		button(el, '', () => {
			ctl.settings.navigatorCollapsed = !ctl.settings.navigatorCollapsed;
			void this.host.saveSettings();
			this.navDirty = true;
			this.renderAll();
		}, { icon: 'search', title: 'Навигатор', cls: ctl.settings.navigatorCollapsed ? '' : 'is-on', testId: 'bar-nav' });
		button(el, '', () => this.host.openPanel(), { icon: 'panel-right', title: 'Панель Canvas Assist', testId: 'bar-panel' });
	}

	private renderRecoveryChip(el: HTMLElement): void {
		const store = this.ctl.store;
		if (!store) return;
		const b = button(el, store.info.mode === 'conflict' ? 'Конфликт версий' : 'Только чтение', () => new RecoveryModal(this.ctl).open(), { icon: 'alert-triangle', cls: 'mod-warning', testId: 'bar-recovery' });
		b.title = store.info.message ?? '';
	}

	private async openRegister(): Promise<void> {
		const file = this.ctl.activeCanvas;
		if (!file) return;
		const cands = await this.ctl.registry.candidatesFor(file.path);
		new RegisterAdventureModal(this.ctl, cands).open();
	}

	private async switchParty(partyId: string | null): Promise<void> {
		const s = this.ctl.state;
		if (!s) return;
		if (s.activeEncounter && partyId !== s.activePartyId) {
			new Notice('Текущий бой не меняется: смена партии влияет только на новые бои и отдых.', 5000);
		}
		await this.ctl.act({ type: 'party/set-active', partyId });
	}

	private encounterMenu(ev: MouseEvent): void {
		const s = this.ctl.state;
		if (!s) return;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Спонтанный бой…').setIcon('plus').onClick(() => new AddCombatantModal(this.ctl).open()));
		if (s.encounterTemplates.length) menu.addSeparator();
		for (const t of s.encounterTemplates) {
			menu.addItem((i) =>
				i.setTitle(`Запустить: ${t.name}`).setIcon('play').onClick(() => {
					const cur = this.ctl.state;
					if (!cur) return;
					void this.ctl.act({ type: 'encounter/create', encounter: encounterFromTemplate(cur, t, newId, new Date().toISOString()) });
				}),
			);
		}
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Шаблоны в панели…').setIcon('panel-right').onClick(() => this.host.openPanel()));
		menu.showAtMouseEvent(ev);
	}

	private renderRibbon(): void {
		const el = this.ribbon;
		el.empty();
		const s = this.ctl.state;
		const enc = s?.activeEncounter;
		el.toggleClass('ca-hidden', !s || !enc || !this.isActive() || this.ctl.settings.barCollapsed);
		if (!s || !enc || !this.isActive() || this.ctl.settings.barCollapsed) return;
		const slots = computeSlots(enc);
		if (!slots.length) {
			el.createSpan({ cls: 'ca-muted', text: 'В бою нет участников — добавьте их кнопкой «+».' });
			return;
		}
		const target = this.ctl.target;
		for (const slot of slots) {
			const isActive = slot.id === enc.activeSlotId;
			const acted = enc.actedThisRound.includes(slot.id);
			const group = slot.kind === 'group' ? el.createDiv({ cls: `ca-group${isActive ? ' is-active' : ''}`, attr: { title: `Общая инициатива: ${slot.name}` } }) : el;
			if (slot.kind === 'group') group.createDiv({ cls: 'ca-group-label', text: `${slot.name} · ${slot.initiative ?? '?'}` });
			for (const id of slot.memberIds) {
				const c = enc.combatants[id];
				if (c) this.renderChip(group, s, c, slot, isActive, acted, target?.kind === 'combatant' && target.id === c.id);
			}
		}
	}

	private renderChip(parent: HTMLElement, s: AdventureState, c: Combatant, slot: Slot, isActive: boolean, acted: boolean, selected: boolean): void {
		const chip = parent.createDiv({
			cls: ['ca-chip-card', isActive ? 'is-active' : '', selected ? 'is-selected' : '', c.defeated ? 'is-defeated' : '', acted && !isActive ? 'is-acted' : ''].filter(Boolean),
			attr: { role: 'listitem', tabindex: '0', 'data-testid': 'combatant-chip', 'data-name': c.displayName, 'aria-label': `${c.displayName}${isActive ? ', ходит' : ''}${selected ? ', выбрана цель' : ''}` },
		});
		const head = chip.createDiv({ cls: 'ca-chip-head' });
		if (isActive) head.createSpan({ cls: 'ca-turn-mark', text: '▶', attr: { 'aria-hidden': 'true' } });
		head.createSpan({ cls: 'ca-chip-name', text: c.displayName });
		const init = head.createSpan({ cls: 'ca-chip-init', text: slot.kind === 'group' ? '' : String(c.initiative ?? '?'), attr: { title: 'Инициатива (клик — изменить)' } });
		if (slot.kind === 'single') {
			init.addEventListener('click', (ev) => {
				ev.stopPropagation();
				this.editInitiative(c);
			});
		}
		const hp = hpOf(s, c);
		const line = chip.createDiv({ cls: 'ca-chip-line' });
		const hpEl = line.createSpan({ cls: 'ca-chip-hp', text: `♥ ${hpText(hp)}` });
		if (hp && hp.current === 0) hpEl.addClass('ca-zero');
		const ac = effectiveAc(s, c);
		line.createSpan({ cls: `ca-chip-ac${c.acOverride !== null ? ' is-override' : ''}`, text: `КД ${ac ?? '—'}${c.acOverride !== null ? '*' : ''}`, attr: { title: c.acOverride !== null ? 'Временный КД в бою' : 'КД' } });
		if (c.defeated) line.createSpan({ cls: 'ca-pill ca-pill-muted', text: 'выбыл' });
		const effs = effectsFor(s, c);
		if (effs.length) {
			const pills = chip.createDiv({ cls: 'ca-chip-effects' });
			renderEffectPills(pills, s, effs, (e) => new EffectModal(this.ctl, null, e).open());
		}
		const more = button(chip, '', (ev) => this.chipMenu(ev, c, slot), { icon: 'more-horizontal', cls: 'ca-chip-more', title: `Действия: ${c.displayName}` });
		void more;
		chip.addEventListener('click', () => this.ctl.setTarget({ kind: 'combatant', id: c.id }));
		chip.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault();
				this.ctl.setTarget({ kind: 'combatant', id: c.id });
			}
		});
		chip.addEventListener('contextmenu', (ev) => {
			ev.preventDefault();
			this.chipMenu(ev, c, slot);
		});
	}

	private editInitiative(c: Combatant): void {
		new NumberModal(
			this.ctl.app,
			`Инициатива: ${c.displayName}`,
			`Результат физического броска (с модификатором${c.initiativeModifier !== null ? ` ${c.initiativeModifier >= 0 ? '+' : ''}${c.initiativeModifier}` : ''}).`,
			(n) => `${c.initiative ?? '?'} → ${n}`,
			async (n) => (await this.ctl.act({ type: 'encounter/update-combatant', combatantId: c.id, patch: { initiative: n } })).ok,
			{ min: -50, initial: c.initiative === null ? '' : String(c.initiative) },
		).open();
	}

	private chipMenu(ev: MouseEvent, c: Combatant, slot: Slot): void {
		const ctl = this.ctl;
		const t = { kind: 'combatant' as const, id: c.id };
		const enc = ctl.state?.activeEncounter;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Выбрать целью').setIcon('crosshair').onClick(() => ctl.setTarget(t)));
		if (enc && enc.round > 0 && slot.id !== enc.activeSlotId) menu.addItem((i) => i.setTitle('Передать ход этому участнику…').setIcon('corner-down-right').onClick(() => void jumpToSlot(ctl, slot.id)));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Урон…').setIcon('sword').onClick(() => openDamage(ctl, t)));
		menu.addItem((i) => i.setTitle('Лечение…').setIcon('heart').onClick(() => openHeal(ctl, t)));
		menu.addItem((i) => i.setTitle('Временные хиты…').setIcon('shield').onClick(() => openTempHp(ctl, t)));
		menu.addItem((i) => i.setTitle('Эффект…').setIcon('sparkles').onClick(() => openEffect(ctl, t)));
		menu.addItem((i) => i.setTitle('Карточка').setIcon('id-card').onClick(() => new CardModal(ctl, t).open()));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Инициатива…').setIcon('hash').onClick(() => (slot.kind === 'single' ? this.editInitiative(c) : this.host.openPanel())));
		menu.addItem((i) => i.setTitle('Раньше при равенстве').setIcon('arrow-left').onClick(() => void ctl.act({ type: 'encounter/move-in-ties', slotId: slot.id, direction: -1 })));
		menu.addItem((i) => i.setTitle('Позже при равенстве').setIcon('arrow-right').onClick(() => void ctl.act({ type: 'encounter/move-in-ties', slotId: slot.id, direction: 1 })));
		menu.addItem((i) => i.setTitle(c.defeated ? 'Вернуть в бой' : 'Отметить «выбыл»').setIcon('flag').onClick(() => void ctl.act({ type: 'encounter/update-combatant', combatantId: c.id, patch: { defeated: !c.defeated } })));
		menu.addItem((i) => i.setTitle('Удалить из боя…').setIcon('trash').onClick(() => void removeCombatant(ctl, c.id)));
		menu.showAtMouseEvent(ev);
	}

	private renderTargetBar(): void {
		const el = this.targetBar;
		el.empty();
		const t = this.ctl.target;
		const show = !!t && !!this.ctl.state && this.isActive() && !this.ctl.settings.barCollapsed;
		el.toggleClass('ca-hidden', !show);
		if (!show || !t) return;
		el.createSpan({ cls: 'ca-target-label', text: `Цель: ${this.ctl.targetName(t)}`, attr: { 'data-testid': 'target-name' } });
		button(el, 'Урон', () => openDamage(this.ctl, t), { icon: 'sword', testId: 'target-damage' });
		button(el, 'Лечение', () => openHeal(this.ctl, t), { icon: 'heart', testId: 'target-heal' });
		button(el, 'Врем.', () => openTempHp(this.ctl, t), { icon: 'shield', title: 'Временные хиты' });
		button(el, 'Эффект', () => openEffect(this.ctl, t), { icon: 'sparkles', testId: 'target-effect' });
		button(el, 'Карточка', () => new CardModal(this.ctl, t).open(), { icon: 'id-card', testId: 'target-card' });
		button(el, '', () => this.ctl.setTarget(null), { icon: 'x', title: 'Снять выбор цели' });
	}

	// ---------- Navigator ----------

	private async renderNav(): Promise<void> {
		const el = this.nav;
		const hidden = this.ctl.settings.navigatorCollapsed || !this.isActive() || this.ctl.settings.barCollapsed || !this.ctl.activeCanvas;
		el.toggleClass('ca-hidden', hidden);
		if (hidden) {
			el.empty();
			this.navResults = null;
			return;
		}
		await this.ctl.refreshIndex();
		if (this.destroyed) return;
		el.empty();
		const head = el.createDiv({ cls: 'ca-nav-head' });
		const input = head.createEl('input', { type: 'search', cls: 'ca-nav-search', attr: { placeholder: 'Поиск в холсте', 'aria-label': 'Поиск в текущем Canvas', 'data-testid': 'nav-search' } });
		input.value = this.query;
		input.addEventListener('input', () => {
			this.query = input.value;
			this.renderNavResults();
		});
		input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Escape') {
				input.blur();
			} else if (ev.key === 'Enter') {
				const first = this.navResults?.querySelector<HTMLElement>('.ca-nav-item');
				first?.click();
			}
		});
		button(head, '', () => this.goHistory(-1), { icon: 'arrow-left', title: 'Назад', disabled: !this.ctl.nav.canBack() });
		button(head, '', () => this.goHistory(1), { icon: 'arrow-right', title: 'Вперёд', disabled: !this.ctl.nav.canForward() });
		const filters = el.createDiv({ cls: 'ca-nav-filters' });
		for (const cat of CATEGORY_ORDER) {
			const on = this.categoryFilter.has(cat);
			const b = button(filters, CATEGORY_LABELS[cat], () => {
				if (on) this.categoryFilter.delete(cat);
				else this.categoryFilter.add(cat);
				this.navDirty = true;
				void this.renderNav();
			}, { cls: `ca-filter${on ? ' is-on' : ''}`, testId: `nav-filter-${cat}` });
			b.setAttr('aria-pressed', on ? 'true' : 'false');
		}
		const cap = probeCanvas(this.ctl.activeCanvasView());
		if (!cap.canFocusNode) el.createDiv({ cls: 'ca-muted ca-small', text: 'Фокус на узле недоступен — переход откроет заметку/подсветит результат.' });
		for (const w of this.ctl.lastIndex?.warnings ?? []) el.createDiv({ cls: 'ca-warn ca-small', text: w });
		this.navResults = el.createDiv({ cls: 'ca-nav-results', attr: { 'data-testid': 'nav-results' } });
		this.renderNavResults();
	}

	private renderNavResults(): void {
		const el = this.navResults;
		const idx = this.ctl.lastIndex;
		if (!el || !idx) return;
		el.empty();
		const includeIgnored = this.categoryFilter.has('ignore');
		const hits = searchItems(idx.items, this.query, {
			foldYo: this.ctl.settings.foldYo,
			includeIgnored,
			categories: this.categoryFilter.size ? this.categoryFilter : undefined,
			limit: this.query ? 60 : 500,
		});
		const recent = this.ctl.activeCanvas ? this.ctl.nav.forCanvas(this.ctl.activeCanvas.path) : [];
		if (!this.query && recent.length) {
			const r = el.createDiv({ cls: 'ca-nav-group' });
			r.createDiv({ cls: 'ca-nav-group-title', text: 'Недавние' });
			for (const n of recent) {
				const item = idx.items.find((i) => i.nodeId === n.nodeId);
				if (item) this.renderNavItem(r, item);
			}
		}
		if (this.query) {
			if (!hits.length) el.createDiv({ cls: 'ca-muted', text: 'Ничего не найдено' });
			for (const h of hits) this.renderNavItem(el, h.item);
			return;
		}
		const grouped = groupByCategory(hits.map((h) => h.item));
		for (const cat of CATEGORY_ORDER) {
			const list = grouped.get(cat) ?? [];
			if (!list.length) continue;
			const g = el.createDiv({ cls: 'ca-nav-group' });
			const collapsed = this.collapsedGroups.has(cat);
			const title = g.createDiv({ cls: 'ca-nav-group-title ca-clickable', text: `${collapsed ? '▸' : '▾'} ${CATEGORY_LABELS[cat]} (${list.length})`, attr: { role: 'button', tabindex: '0' } });
			const toggle = (): void => {
				if (collapsed) this.collapsedGroups.delete(cat);
				else this.collapsedGroups.add(cat);
				this.renderNavResults();
			};
			title.addEventListener('click', toggle);
			title.addEventListener('keydown', (ev) => ev.key === 'Enter' && toggle());
			if (!collapsed) for (const it of list) this.renderNavItem(g, it);
		}
	}

	private renderNavItem(parent: HTMLElement, it: CanvasItem): void {
		const missing = this.ctl.lastIndex?.missingFiles.has(it.nodeId) ?? false;
		const row = parent.createDiv({
			cls: ['ca-nav-item', this.highlightNode === it.nodeId ? 'is-highlight' : '', missing ? 'is-missing' : ''].filter(Boolean),
			attr: { role: 'button', tabindex: '0', 'data-node': it.nodeId, 'data-testid': 'nav-item' },
		});
		row.createDiv({ cls: 'ca-nav-title', text: `${it.title}${it.overridden ? ' •' : ''}` });
		const sub = [it.type === 'file' ? 'файл' : it.type === 'text' ? 'текст' : it.type === 'link' ? 'ссылка' : it.type === 'group' ? 'группа' : it.type, it.subtitle].filter(Boolean).join(' · ');
		row.createDiv({ cls: 'ca-nav-sub', text: missing ? `источник недоступен · ${sub}` : sub });
		row.addEventListener('click', () => void this.navigate(it));
		row.addEventListener('keydown', (ev) => ev.key === 'Enter' && void this.navigate(it));
		row.addEventListener('contextmenu', (ev) => {
			ev.preventDefault();
			this.itemMenu(ev, it);
		});
	}

	private itemMenu(ev: MouseEvent, it: CanvasItem): void {
		const rel = this.ctl.canvasRelPath();
		if (!rel) return;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(`Авто (${CATEGORY_LABELS[it.autoCategory]})`).setChecked(!it.overridden).onClick(() => void this.setOverride(rel, it.nodeId, null)));
		for (const cat of CATEGORY_ORDER) {
			menu.addItem((i) => i.setTitle(CATEGORY_LABELS[cat]).setChecked(it.overridden && it.category === cat).onClick(() => void this.setOverride(rel, it.nodeId, cat)));
		}
		menu.showAtMouseEvent(ev);
	}

	private async setOverride(rel: string, nodeId: string, category: NodeCategory | null): Promise<void> {
		await this.ctl.act({ type: 'node/override', canvasPath: rel, nodeId, category });
		this.navDirty = true;
		void this.renderNav();
	}

	async navigate(it: CanvasItem): Promise<void> {
		const file = this.ctl.activeCanvas;
		if (!file) return;
		this.ctl.nav.push({ canvasPath: file.path, nodeId: it.nodeId, title: it.title });
		this.focusItem(it);
	}

	private focusItem(it: CanvasItem): void {
		const ok = focusNode(this.leaf.view, it.nodeId);
		this.highlightNode = it.nodeId;
		if (!ok) {
			if (it.filePath) {
				const f = this.ctl.app.vault.getAbstractFileByPath(it.filePath);
				if (f instanceof TFile) void this.ctl.app.workspace.getLeaf('tab').openFile(f);
				else new Notice(`Источник недоступен: ${it.filePath}`);
			} else new Notice('Фокус на узле Canvas недоступен — результат подсвечен в навигаторе.');
		}
		this.renderNavResults();
	}

	private goHistory(dir: -1 | 1): void {
		const e = dir < 0 ? this.ctl.nav.back() : this.ctl.nav.forward();
		if (!e || !this.ctl.lastIndex || e.canvasPath !== this.ctl.activeCanvas?.path) {
			if (e) new Notice(`Запись истории относится к другому Canvas: ${e.canvasPath}`);
			return;
		}
		const it = this.ctl.lastIndex.items.find((i) => i.nodeId === e.nodeId);
		if (it) this.focusItem(it);
		this.navDirty = true;
		this.renderAll();
	}

	focusSearch(): void {
		if (this.ctl.settings.navigatorCollapsed) {
			this.ctl.settings.navigatorCollapsed = false;
			void this.host.saveSettings();
		}
		this.navDirty = true;
		this.renderAll();
		window.setTimeout(() => this.nav.querySelector<HTMLInputElement>('.ca-nav-search')?.focus(), 50);
	}

	destroy(): void {
		this.destroyed = true;
		this.unsub();
		this.root.remove();
		hostElement(this.leaf).removeClass('ca-host');
	}
}
