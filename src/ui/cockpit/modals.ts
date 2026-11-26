// Cockpit dialogs: quick NPC, character builder / paper quick-fill, add item, transfer, spell import, cue binding.
import { Modal, Notice, Setting } from 'obsidian';
import { abilitiesAfter, buildCharacter, classById, levelUp, pointBuyCost, quickNpc, resolveItemType, STANDARD_ARRAY, type BuildChoices } from '../../domain/builder';
import { ABILITIES, ABILITY_RU, SKILLS, cockpitOf, formatCost, type Abilities, type ItemInstance, type ItemType } from '../../domain/cockpit';
import { buildMonsters, pcCombatant } from '../../domain/encounter';
import { emptyEncounter } from '../../domain/encounter';
import { nextTieOrder } from '../../domain/combat';
import { newId } from '../../domain/ids';
import { sanitizeFileName } from '../../domain/normalize';
import { importSpell, lookupSpell, searchSpells, upsertSpell, validateCard, type SpellCard } from '../../domain/spell-import';
import { buildCueMessage, validateBinding, type CueBinding, type CueCommand } from '../../domain/lightkey';
import { CLASSES, ITEM_TYPES, RACES, raceTraits, spellSlotsFor, srdSubclasses } from '../../domain/srd-data';
import { asiLevels, cantripsKnown, pactMagic, preparedSpellCount, wizardSpellbookSize } from '../../domain/class-rules';
import { getSrd } from '../../domain/srd';
void lookupSpell;
import type { Controller } from '../../controller';
import { DgramTransport, sendCue } from '../../adapters/osc-transport';
import { button } from '../common';
import type { AbilityId } from '../../domain/types';

const tid = (el: HTMLElement, id: string): void => void (el.dataset.testid = id);
const ab = (v: string): AbilityId | undefined => ABILITIES.find((a) => a === v);

function field(parent: HTMLElement, label: string, init: string, onInput: (v: string) => void, testId?: string, type = 'text'): HTMLInputElement {
	let input!: HTMLInputElement;
	new Setting(parent).setName(label).addText((t) => {
		t.setValue(init).onChange(onInput);
		input = t.inputEl;
		input.type = type;
		if (testId) tid(input, testId);
	});
	return input;
}

/** Adds a creature card as an encounter combatant (creating a spontaneous encounter if there is none). */
export async function addCreatureToCombat(ctl: Controller, creatureId: string, count = 1): Promise<boolean> {
	const s = ctl.state;
	const cr = s?.creatures[creatureId];
	if (!s || !cr) return false;
	if (!s.activeEncounter) {
		const out = await ctl.act({ type: 'encounter/create', encounter: emptyEncounter(newId('enc'), 'Спонтанный бой', new Date().toISOString(), s.activePartyId, null) });
		if (!out.ok) return false;
	}
	const enc = ctl.state?.activeEncounter;
	if (!enc) return false;
	const work = structuredClone(enc);
	const cmbs = [];
	let tie = nextTieOrder(work);
	const party = ctl.state?.parties.find((p) => p.id === ctl.state?.activePartyId);
	const inFight = new Set(Object.values(enc.combatants).map((c) => c.characterId).filter(Boolean));
	for (const id of party?.characterIds ?? []) {
		if (inFight.has(id)) continue;
		const c = pcCombatant(ctl.state, id, newId('cmb'), tie);
		tie += 10;
		cmbs.push(c);
		work.combatants[c.id] = c;
	}
	const { combatants: mons } = buildMonsters(work, { name: cr.name, count, kind: 'npc', creatureId, source: cr.source, hpMax: cr.hpMax, ac: cr.ac, initiativeModifier: cr.initiativeModifier, sharedInitiative: false }, newId);
	cmbs.push(...mons);
	return (await ctl.act({ type: 'encounter/add-combatants', combatants: cmbs, groups: [] })).ok;
}

export class QuickNpcModal extends Modal {
	private query = '';
	private count = 1;
	constructor(private readonly ctl: Controller, private readonly onDone: (creatureId: string) => void) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Быстрый NPC');
		const el = this.contentEl;
		el.createEl('p', { cls: 'gmc-dim', text: 'Например: «Гоблин-посетитель таверны с кинжалом». Шаблоны: SRD 5.1. Масштабирования под уровень партии нет.' });
		const input = field(el, 'Описание', '', (v) => (this.query = v), 'qn-query');
		field(el, 'Сколько в бой (у каждого свои HP и состояния)', '1', (v) => (this.count = Math.max(1, Math.min(20, Math.floor(Number(v)) || 1))), 'qn-count', 'number');
		const out = el.createDiv({ cls: 'gmc-qn-out', attr: { 'data-testid': 'qn-out' } });
		const row = el.createDiv({ cls: 'gmc-row gmc-gap' });
		const go = (toCombat: boolean): void => void this.create(out, toCombat);
		button(row, 'Создать', () => go(false), { cls: 'gmc-btn', testId: 'qn-create' });
		button(row, 'Создать и в бой', () => go(true), { cls: 'gmc-btn gmc-btn-ok', testId: 'qn-combat' });
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') go(false);
		});
		window.setTimeout(() => input.focus(), 30);
	}

	private async create(out: HTMLElement, toCombat: boolean): Promise<void> {
		const r = quickNpc(this.query, newId);
		out.empty();
		if (!r) {
			out.createDiv({ cls: 'gmc-warn', text: `Не нашёл шаблон. Доступно: ${['гоблин', 'бандит', 'стражник', 'простолюдин', 'головорез', 'культист', 'дворянин'].join(', ')}.` });
			return;
		}
		const res = await this.ctl.act({ type: 'cockpit/npc-create', creature: r.creature, statblock: r.statblock, items: r.items, purse: r.purse });
		if (!res.ok) return;
		if (toCombat) await addCreatureToCombat(this.ctl, r.creature.id, this.count);
		new Notice(`Создан: ${r.creature.name}. ${r.note}`);
		this.onDone(r.creature.id);
		this.close();
	}
}

export class AddItemModal extends Modal {
	private filter = '';
	private qty = 1;
	constructor(private readonly ctl: Controller, private readonly owner: { kind: 'character' | 'creature'; id: string }, private readonly containerId: string | null = null) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Добавить предмет');
		this.render();
	}

	private types(): ItemType[] {
		const s = this.ctl.state;
		const custom = s ? Object.values(cockpitOf(s).itemTypes) : [];
		const q = this.filter.trim().toLowerCase().replace(/ё/g, 'е');
		return [...custom, ...Object.values(ITEM_TYPES)].filter((t) => !q || `${t.name} ${t.ru ?? ''}`.toLowerCase().replace(/ё/g, 'е').includes(q)).slice(0, 40);
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const f = field(el, 'Поиск', this.filter, (v) => {
			this.filter = v;
			list.empty();
			this.fill(list);
		}, 'ai-filter');
		field(el, 'Количество', String(this.qty), (v) => (this.qty = Math.max(1, Math.min(100000, Math.floor(Number(v)) || 1))), 'ai-qty', 'number');
		const list = el.createDiv({ cls: 'gmc-pick' });
		this.fill(list);
		const custom = el.createDiv({ cls: 'gmc-row gmc-gap' });
		let name = '';
		let cost = 0;
		const n = custom.createEl('input', { cls: 'gmc-input', attr: { placeholder: 'Свой предмет: название', 'data-testid': 'ai-custom-name' } });
		n.addEventListener('input', () => (name = n.value));
		const c = custom.createEl('input', { cls: 'gmc-input', type: 'number', attr: { placeholder: 'цена, зм' } });
		c.addEventListener('input', () => (cost = Math.max(0, Math.round(Number(c.value) * 100) || 0)));
		button(custom, 'Добавить', () => void this.addCustom(name, cost), { cls: 'gmc-btn', testId: 'ai-custom-add' });
		window.setTimeout(() => f.focus(), 30);
	}

	private fill(list: HTMLElement): void {
		for (const t of this.types()) {
			const row = list.createDiv({ cls: 'gmc-pickrow', attr: { tabindex: '0', role: 'button', 'data-testid': `ai-${t.id}` } });
			row.createSpan({ text: t.ru ? `${t.ru} (${t.name})` : t.name });
			row.createSpan({ cls: 'gmc-dim', text: `${formatCost(t.costCp)}${t.damage ? ` · ${t.damage}` : ''}` });
			const pick = (): void => void this.add(t);
			row.addEventListener('click', pick);
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					pick();
				}
			});
		}
	}

	private async add(t: ItemType): Promise<void> {
		const item: ItemInstance = { id: newId('itm'), typeId: t.id, name: t.ru ?? t.name, ownerKind: this.owner.kind, ownerId: this.owner.id, containerId: this.containerId, qty: this.qty, equipped: false, magicBonus: 0, note: '' };
		if ((await this.ctl.act({ type: 'cockpit/item-upsert', item })).ok) this.close();
	}

	private async addCustom(name: string, costCp: number): Promise<void> {
		if (!name.trim()) return void new Notice('Укажите название предмета');
		const type: ItemType = { id: newId('type'), name: name.trim(), kind: 'gear', costCp, weight: 0, properties: [] };
		const item: ItemInstance = { id: newId('itm'), typeId: null, custom: type, name: type.name, ownerKind: this.owner.kind, ownerId: this.owner.id, containerId: this.containerId, qty: this.qty, equipped: false, magicBonus: 0, note: '' };
		if ((await this.ctl.act({ type: 'cockpit/item-upsert', item })).ok) this.close();
	}
}

export class TransferModal extends Modal {
	private qty = 0;
	constructor(private readonly ctl: Controller, private readonly item: ItemInstance) {
		super(ctl.app);
		this.qty = item.qty;
	}

	override onOpen(): void {
		this.titleEl.setText(`Передать: ${this.item.name}`);
		const s = this.ctl.state;
		if (!s) return;
		const el = this.contentEl;
		if (this.item.qty > 1) field(el, `Количество (из ${this.item.qty})`, String(this.qty), (v) => (this.qty = Math.floor(Number(v)) || 1), 'tr-qty', 'number');
		const owners: Array<{ kind: 'character' | 'creature'; id: string; name: string }> = [
			...Object.values(s.characters).map((c) => ({ kind: 'character' as const, id: c.id, name: `${c.name} (игрок)` })),
			...Object.values(s.creatures).map((c) => ({ kind: 'creature' as const, id: c.id, name: c.name })),
		].filter((o) => !(o.kind === this.item.ownerKind && o.id === this.item.ownerId));
		const list = el.createDiv({ cls: 'gmc-pick' });
		if (!owners.length) list.createDiv({ cls: 'gmc-dim', text: 'Больше нет персонажей и существ.' });
		for (const o of owners) {
			const row = list.createDiv({ cls: 'gmc-pickrow', attr: { tabindex: '0', role: 'button', 'data-testid': `tr-${o.id}` } });
			row.createSpan({ text: o.name });
			const go = async (): Promise<void> => {
				const qty = Math.max(1, Math.min(this.item.qty, this.qty));
				const out = await this.ctl.act({ type: 'cockpit/item-transfer', itemId: this.item.id, ownerKind: o.kind, ownerId: o.id, qty, ...(qty < this.item.qty ? { newId: newId('itm') } : {}) });
				if (out.ok) this.close();
			};
			row.addEventListener('click', () => void go());
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') void go();
			});
		}
	}
}

// ---- character builder ------------------------------------------------------------------------

export class BuilderModal extends Modal {
	private mode: 'rules' | 'paper' = 'rules';
	private c: BuildChoices = { name: '', raceId: 'human', classId: 'fighter', level: 1, baseAbilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, background: '', subclass: '', skills: [], gear: [], notePath: '' };
	private free: AbilityId[] = [];
	private paper = { race: '', cls: '', hp: '', ac: '', speed: '30' };

	constructor(private readonly ctl: Controller, private readonly onDone: (characterId: string) => void) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Новый персонаж');
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const tabs = el.createDiv({ cls: 'gmc-row gmc-gap' });
		button(tabs, 'По правилам 2014 (SRD)', () => ((this.mode = 'rules'), this.render()), { cls: `gmc-btn ${this.mode === 'rules' ? 'is-on' : ''}`, testId: 'bd-mode-rules' });
		button(tabs, 'Быстрое заполнение с листа', () => ((this.mode = 'paper'), this.render()), { cls: `gmc-btn ${this.mode === 'paper' ? 'is-on' : ''}`, testId: 'bd-mode-paper' });
		field(el, 'Имя', this.c.name, (v) => (this.c.name = v), 'bd-name');
		if (this.mode === 'rules') this.renderRules(el);
		else this.renderPaper(el);
		const err = el.createDiv({ cls: 'gmc-warn', attr: { 'data-testid': 'bd-err' } });
		button(el, 'Создать персонажа', () => void this.submit(err), { cls: 'gmc-btn gmc-btn-p', testId: 'bd-submit' });
	}

	private abilityInputs(el: HTMLElement, hint: string): void {
		const row = el.createDiv({ cls: 'gmc-abilgrid' });
		for (const a of ABILITIES) {
			const cell = row.createDiv();
			cell.createDiv({ cls: 'gmc-eyebrow', text: ABILITY_RU[a] });
			const inp = cell.createEl('input', { cls: 'gmc-input', type: 'number', value: String(this.c.baseAbilities[a]), attr: { 'data-testid': `bd-ab-${a}`, 'aria-label': ABILITY_RU[a] } });
			inp.addEventListener('input', () => {
				this.c.baseAbilities[a] = Math.max(1, Math.min(30, Math.floor(Number(inp.value)) || 10));
				cost.setText(this.costText());
			});
		}
		const cost = el.createDiv({ cls: 'gmc-dim', text: this.costText() });
		const row2 = el.createDiv({ cls: 'gmc-row gmc-gap' });
		button(row2, 'Стандартный набор 15/14/13/12/10/8', () => {
			ABILITIES.forEach((a, i) => (this.c.baseAbilities[a] = STANDARD_ARRAY[i] ?? 10));
			this.render();
		}, { cls: 'gmc-btn gmc-btn-g' });
		el.createDiv({ cls: 'gmc-dim', text: hint });
	}

	private costText(): string {
		const c = pointBuyCost(this.c.baseAbilities);
		return c === null ? 'Набор вне покупки очков (8–15): допустим, если так решил мастер' : `Покупка очков: ${c} из 27`;
	}

	private pickGroup(el: HTMLElement, title: string, items: Array<{ id: string; label: string }>, selected: string[], max: number, onChange: (v: string[]) => void, tidPrefix: string): void {
		el.createDiv({ cls: 'gmc-eyebrow', text: `${title}: ${selected.length} из ${max}` });
		const row = el.createDiv({ cls: 'gmc-row gmc-gap gmc-wrap gmc-picklist' });
		for (const it of items) {
			const lab = row.createEl('label', { cls: 'gmc-check' });
			const cb = lab.createEl('input', { type: 'checkbox', attr: { 'data-testid': `${tidPrefix}-${it.id}` } });
			cb.checked = selected.includes(it.id);
			cb.disabled = !cb.checked && selected.length >= max;
			cb.addEventListener('change', () => {
				onChange(cb.checked ? [...selected, it.id] : selected.filter((x) => x !== it.id));
				this.render();
			});
			lab.createSpan({ text: it.label });
		}
	}

	private renderRules(el: HTMLElement): void {
		const c = this.c;
		new Setting(el).setName('Раса').addDropdown((d) => {
			for (const r of RACES.filter((x) => !x.parent)) d.addOption(r.id, r.ru);
			d.setValue(c.raceId).onChange((v) => ((c.raceId = v), delete c.subraceId, (this.free = []), (c.raceSkills = []), this.render()));
			tid(d.selectEl, 'bd-race');
		});
		const race = RACES.find((r) => r.id === c.raceId && !r.parent);
		const subs = RACES.filter((r) => r.parent === c.raceId);
		if (subs.length) {
			new Setting(el).setName('Подраса (SRD)').addDropdown((d) => {
				d.addOption('', 'без подрасы');
				for (const r of subs) d.addOption(r.id, r.ru);
				d.setValue(c.subraceId ?? '').onChange((v) => ((v ? (c.subraceId = v) : delete c.subraceId), this.render()));
				tid(d.selectEl, 'bd-subrace');
			});
		}
		if (race?.freeBonus) {
			const fb = race.freeBonus;
			const row = el.createDiv({ cls: 'gmc-row gmc-gap gmc-wrap' });
			row.createSpan({ cls: 'gmc-dim', text: `+${fb.amount} к ${fb.count} характеристикам:` });
			for (const a of ABILITIES.filter((x) => !fb.exclude.includes(x))) {
				const lab = row.createEl('label', { cls: 'gmc-check' });
				const cb = lab.createEl('input', { type: 'checkbox' });
				cb.checked = this.free.includes(a);
				cb.addEventListener('change', () => {
					this.free = cb.checked ? [...this.free, a].slice(-fb.count) : this.free.filter((x) => x !== a);
					this.render();
				});
				lab.createSpan({ text: ABILITY_RU[a] });
			}
		}
		const traits = raceTraits(c.raceId, c.subraceId);
		if ((traits.freeSkills ?? 0) > 0) this.pickGroup(el, 'Навыки расы (по выбору)', SKILLS.map((x) => ({ id: x.id, label: x.ru })), c.raceSkills ?? [], traits.freeSkills ?? 0, (v) => (c.raceSkills = v), 'bd-rskill');
		new Setting(el).setName('Класс').addDropdown((d) => {
			for (const k of CLASSES) d.addOption(k.id, k.ru);
			d.setValue(c.classId).onChange((v) => ((c.classId = v), (c.skills = []), (c.asi = []), (c.cantrips = []), (c.spells = []), (c.prepared = []), (c.subclass = ''), this.render()));
			tid(d.selectEl, 'bd-class');
		});
		field(el, 'Уровень (1–20)', String(c.level), (v) => {
			c.level = Math.max(1, Math.min(20, Math.floor(Number(v)) || 1));
			c.asi = (c.asi ?? []).slice(0, asiLevels(c.classId, c.level).length);
		}, 'bd-level', 'number');
		const lvlInput = el.querySelector<HTMLInputElement>('[data-testid=bd-level]');
		lvlInput?.addEventListener('change', () => this.render());
		new Setting(el).setName('Предыстория').setDesc('В SRD только Acolyte. Остальные (например, Criminal) — вводятся вручную: навыки берутся с бумажного листа, ничего не подставляется.').addDropdown((d) => {
			d.addOption('custom', 'Другая (ввести вручную)');
			d.addOption('srd', 'Acolyte (SRD: Insight, Religion)');
			d.setValue(c.backgroundKind ?? 'custom').onChange((v) => ((c.backgroundKind = v as 'srd' | 'custom'), c.backgroundKind === 'srd' && (c.background = 'Acolyte'), this.render()));
			tid(d.selectEl, 'bd-bgkind');
		});
		if ((c.backgroundKind ?? 'custom') === 'custom') {
			field(el, 'Название предыстории', c.background, (v) => (c.background = v), 'bd-bgname');
			this.pickGroup(el, 'Навыки предыстории (с листа)', SKILLS.map((x) => ({ id: x.id, label: x.ru })), c.backgroundSkills ?? [], 2, (v) => (c.backgroundSkills = v), 'bd-bgskill');
		}
		const cls = classById(c.classId);
		if (cls && c.level >= cls.subclassLevel) {
			const subs = srdSubclasses(cls.id);
			new Setting(el).setName('Подкласс').addDropdown((d) => {
				d.addOption('', '— выберите —');
				for (const x of subs) d.addOption(x.name, `${x.name} (SRD)`);
				d.addOption('__custom', 'Другой (ввести вручную)');
				d.setValue(subs.some((x) => x.name === c.subclass) ? c.subclass : c.subclass ? '__custom' : '').onChange((v) => ((c.subclass = v === '__custom' ? ' ' : v), this.render()));
				tid(d.selectEl, 'bd-subclass-select');
			});
			if (c.subclass && !subs.some((x) => x.name === c.subclass)) field(el, 'Название подкласса', c.subclass.trim(), (v) => (c.subclass = v || ' '), 'bd-subclass');
		}
		this.abilityInputs(el, 'Значения до расовых бонусов; бонусы расы добавляются при создании.');
		const asiAt = asiLevels(c.classId, c.level);
		c.asi = c.asi ?? [];
		asiAt.forEach((lv, i) => {
			const cur = c.asi?.[i];
			new Setting(el).setName(`Уровень ${lv}: повышение характеристик`).addDropdown((d) => {
				d.addOption('', '— выберите —');
				for (const a of ABILITIES) d.addOption(`+2:${a}`, `+2 ${ABILITY_RU[a]}`);
				d.addOption('grappler', 'Черта Grappler (SRD)');
				d.setValue(cur === 'grappler' ? 'grappler' : cur?.length === 1 ? `+2:${cur[0]}` : '').onChange((v) => {
					const arr = [...(c.asi ?? [])];
					if (!v) arr.splice(i, 1);
					else {
						const a = ab(v.slice(3));
						if (v === 'grappler') arr[i] = 'grappler';
						else if (a) arr[i] = [a];
					}
					c.asi = arr;
					this.render();
				});
				tid(d.selectEl, `bd-asi-${i}`);
			}).addDropdown((d) => {
				d.addOption('', '+1 / +1: вторая…');
				for (const a of ABILITIES) d.addOption(a, `+1 ${ABILITY_RU[a]}`);
				d.setValue(Array.isArray(cur) && cur.length === 2 ? (cur[1] as string) : '').onChange((v) => {
					const first = Array.isArray(cur) ? cur[0] : undefined;
					const second = ab(v);
					if (second && first) (c.asi ?? [])[i] = [first, second];
					this.render();
				});
			});
		});
		if (cls) {
			this.pickGroup(el, 'Навыки класса', SKILLS.filter((x) => cls.skillList === 'any' || cls.skillList.includes(x.id)).map((x) => ({ id: x.id, label: x.ru })), c.skills, cls.skillChoices, (v) => (c.skills = v), 'bd-skill');
			this.renderSpellPicks(el, cls);
		}
		el.createDiv({ cls: 'gmc-eyebrow', text: 'Снаряжение' });
		const gear = el.createDiv({ cls: 'gmc-row gmc-gap gmc-wrap' });
		for (const id of ['longsword', 'dagger', 'shortbow', 'quarterstaff', 'leather', 'chain-mail', 'shield', 'backpack', 'rope-hempen-50-feet', 'spellbook', 'component-pouch']) {
			const t = ITEM_TYPES[id];
			if (!t) continue;
			const lab = gear.createEl('label', { cls: 'gmc-check' });
			const cb = lab.createEl('input', { type: 'checkbox', attr: { 'data-testid': `bd-gear-${id}` } });
			cb.checked = c.gear.includes(id);
			cb.addEventListener('change', () => (c.gear = cb.checked ? [...c.gear, id] : c.gear.filter((x) => x !== id)));
			lab.createSpan({ text: t.ru ?? t.name });
		}
	}

	private renderSpellPicks(el: HTMLElement, cls: NonNullable<ReturnType<typeof classById>>): void {
		const c = this.c;
		const srd = getSrd();
		if (!srd || (cls.caster === 'none' && cls.id !== 'warlock')) return;
		const slots = spellSlotsFor(cls.caster, c.level);
		const maxSpellLevel = cls.id === 'warlock' ? (pactMagic(c.level)?.slotLevel ?? 1) : Math.max(0, ...Object.keys(slots).map(Number));
		const list = srd.spells.filter((x) => x.classes.includes(cls.id));
		const traits = raceTraits(c.raceId, c.subraceId);
		const cantripN = (cantripsKnown(cls.id, c.level) ?? 0) + (cls.id === 'wizard' ? (traits.wizardCantrips ?? 0) : 0);
		if (cantripN > 0) this.pickGroup(el, 'Заговоры', list.filter((x) => x.level === 0).map((x) => ({ id: x.id, label: x.name })), c.cantrips ?? [], cantripN, (v) => (c.cantrips = v), 'bd-cantrip');
		if (cls.id === 'wizard') {
			this.pickGroup(el, 'Книга заклинаний', list.filter((x) => x.level >= 1 && x.level <= maxSpellLevel).map((x) => ({ id: x.id, label: `${x.name} (${x.level})` })), c.spells ?? [], wizardSpellbookSize(c.level), (v) => ((c.spells = v), (c.prepared = (c.prepared ?? []).filter((p) => v.includes(p)))), 'bd-spell');
		}
		const prepN = preparedSpellCount(cls.id, c.level, abilitiesAfter({ ...c, freeBonusPicks: this.free }).abilities);
		if (prepN !== null) {
			const pool = cls.id === 'wizard' ? (c.spells ?? []) : list.filter((x) => x.level >= 1 && x.level <= maxSpellLevel).map((x) => x.id);
			this.pickGroup(el, 'Подготовленные (число зависит от итоговых характеристик — сверьте)', pool.map((id) => ({ id, label: srd.spells.find((x) => x.id === id)?.name ?? id })), c.prepared ?? [], prepN, (v) => (c.prepared = v), 'bd-prep');
		}
	}

	private renderPaper(el: HTMLElement): void {
		el.createDiv({ cls: 'gmc-dim', text: 'Вводите только то, что есть на листе. Пустые поля не блокируют сохранение; значения не пересчитываются.' });
		field(el, 'Раса', this.paper.race, (v) => (this.paper.race = v), 'bd-p-race');
		field(el, 'Класс', this.paper.cls, (v) => (this.paper.cls = v), 'bd-p-class');
		field(el, 'Уровень', String(this.c.level), (v) => (this.c.level = Math.max(1, Math.min(20, Math.floor(Number(v)) || 1))), 'bd-level', 'number');
		field(el, 'Макс. HP', this.paper.hp, (v) => (this.paper.hp = v), 'bd-p-hp', 'number');
		field(el, 'КД', this.paper.ac, (v) => (this.paper.ac = v), 'bd-p-ac', 'number');
		field(el, 'Скорость, фт', this.paper.speed, (v) => (this.paper.speed = v), undefined, 'number');
		this.abilityInputs(el, 'Значения с листа как есть (без расовых бонусов).');
	}

	private async submit(err: HTMLElement): Promise<void> {
		const s = this.ctl.state;
		if (!s) return;
		const name = this.c.name.trim();
		if (!name) return void err.setText('Укажите имя');
		const notePath = `Elements/Персонажи/${sanitizeFileName(name)}.md`;
		if (Object.values(s.characters).some((x) => x.notePath === notePath)) return void err.setText('Персонаж с таким именем уже есть в этом приключении');
		let r;
		if (this.mode === 'rules') {
			try {
				r = buildCharacter({ ...this.c, subclass: this.c.subclass.trim(), notePath, freeBonusPicks: this.free }, newId);
			} catch (e) {
				return void err.setText(e instanceof Error ? e.message : String(e));
			}
		} else {
			r = buildCharacter({ ...this.c, raceId: 'human', classId: 'fighter', notePath }, newId);
			r.sheet.abilities = { ...this.c.baseAbilities };
			r.sheet.race = this.paper.race;
			r.sheet.saveProf = [];
			r.sheet.weaponProf = [];
			r.sheet.armorProf = [];
			r.sheet.castAbility = null;
			r.character.classes = this.paper.cls ? [{ name: this.paper.cls, level: this.c.level }] : [];
			const hp = Number(this.paper.hp);
			r.character.hp = Number.isFinite(hp) && this.paper.hp !== '' ? { current: Math.floor(hp), max: Math.floor(hp), temporary: 0 } : { current: 0, max: null, temporary: 0 };
			r.character.ac = this.paper.ac === '' ? null : Math.floor(Number(this.paper.ac)) || null;
			r.character.speedFeet = Math.floor(Number(this.paper.speed)) || null;
			r.character.hitDice = [];
			r.character.spellSlots = {};
			r.items = [];
			delete r.book;
		}
		const root = s.rootPath;
		const full = `${root}/${notePath}`;
		try {
			if (!this.ctl.port.noteExists(full)) await this.ctl.port.createNote(full, `---\ncanvasAssistId: ${r.character.id}\n---\n# ${name}\n`);
		} catch (e) {
			return void err.setText(`Не удалось создать заметку: ${e instanceof Error ? e.message : String(e)}`);
		}
		const out = await this.ctl.act({ type: 'cockpit/character-build', character: r.character, sheet: r.sheet, items: r.items, ...(r.book ? { book: r.book } : {}) });
		if (!out.ok) return;
		if (r.warnings.length) new Notice(r.warnings.join('\n'), 9000);
		this.onDone(r.character.id);
		this.close();
	}
}

// ---- spells: import and cue binding -------------------------------------------------------------

export class SpellImportModal extends Modal {
	private input = '';
	private tab: 'find' | 'json' | 'manual' = 'find';
	private draft: Record<string, string> = { name: '', level: '1', school: '', castingTime: '1 действие', range: '', components: '', duration: 'Мгновенная', text: '', higherLevels: '', source: 'GM' };
	private conc = false;
	private message = '';

	constructor(private readonly ctl: Controller, private readonly characterId: string | null, private readonly onDone: (spellId: string) => void) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Заклинание: библиотека и импорт');
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const tabs = el.createDiv({ cls: 'gmc-row gmc-gap' });
		for (const [id, ru] of [['find', 'Библиотека / ссылка'], ['json', 'JSON'], ['manual', 'Вручную']] as const) {
			button(tabs, ru, () => ((this.tab = id), (this.message = ''), this.render()), { cls: `gmc-btn ${this.tab === id ? 'is-on' : ''}`, testId: `si-tab-${id}` });
		}
		if (this.tab === 'find') this.renderFind(el);
		else if (this.tab === 'json') this.renderJson(el);
		else this.renderManual(el);
		el.createDiv({ cls: 'gmc-warn', text: this.message, attr: { 'data-testid': 'si-msg' } });
	}

	private renderFind(el: HTMLElement): void {
		el.createDiv({ cls: 'gmc-dim', text: 'Название из локальной библиотеки или ссылка https://5e14.ttg.club/spells/…. Текст с TTG автоматически не загружается (условия сайта); сохранённые карточки работают офлайн.' });
		field(el, 'Название или ссылка', this.input, (v) => { this.input = v; this.render(); }, 'si-input');
		const lib = this.ctl.settings.spells;
		const list = el.createDiv({ cls: 'gmc-pick' });
		for (const sp of searchSpells(lib, /^https?:/i.test(this.input) ? '' : this.input, 40)) {
			const row = list.createDiv({ cls: 'gmc-pickrow', attr: { tabindex: '0', role: 'button', 'data-testid': `si-lib-${sp.id}` } });
			row.createSpan({ text: `${sp.name} · ${sp.level === 0 ? 'заговор' : `${sp.level} ур.`}${sp.origin === 'srd' ? ' · SRD' : ''}` });
			row.addEventListener('click', () => void this.finish(sp));
			row.addEventListener('keydown', (e) => e.key === 'Enter' && void this.finish(sp));
		}
		button(el, 'Найти', () => {
			const isLink = /^https?:/i.test(this.input.trim());
			const r = importSpell(isLink ? { kind: 'link', url: this.input } : { kind: 'name', name: this.input }, lib);
			if (r.status === 'ok') void this.finish(r.card);
			else if (r.status === 'needs-data') {
				this.message = r.reason;
				this.render();
			} else {
				this.message = r.error;
				this.render();
			}
		}, { cls: 'gmc-btn', testId: 'si-find' });
	}

	private renderJson(el: HTMLElement): void {
		el.createDiv({ cls: 'gmc-dim', text: 'Вставьте JSON одной карточки: name, level, school, castingTime, range, components, duration, concentration, text, (nameEn, higherLevels, source, url).' });
		const ta = el.createEl('textarea', { cls: 'gmc-input gmc-ta', attr: { rows: '8', 'data-testid': 'si-json' } });
		ta.value = this.input;
		ta.addEventListener('input', () => (this.input = ta.value));
		button(el, 'Проверить и сохранить', () => {
			const r = importSpell({ kind: 'json', text: this.input }, this.ctl.settings.spells);
			if (r.status === 'ok') void this.finish(r.card);
			else {
				this.message = r.status === 'error' ? r.error : 'Нужны данные';
				this.render();
			}
		}, { cls: 'gmc-btn gmc-btn-p', testId: 'si-json-save' });
	}

	private renderManual(el: HTMLElement): void {
		const f = (k: string, label: string, type = 'text'): void => void field(el, label, this.draft[k] ?? '', (v) => (this.draft[k] = v), `si-m-${k}`, type);
		f('name', 'Название');
		f('level', 'Уровень (0 — заговор)', 'number');
		f('school', 'Школа');
		f('castingTime', 'Время накладывания');
		f('range', 'Дистанция');
		f('components', 'Компоненты');
		f('duration', 'Длительность');
		new Setting(el).setName('Концентрация').addToggle((t) => t.setValue(this.conc).onChange((v) => (this.conc = v)));
		f('text', 'Эффект');
		f('higherLevels', 'На более высоких уровнях');
		button(el, 'Сохранить', () => {
			const r = importSpell({ kind: 'manual', card: { ...this.draft, level: Number(this.draft.level), concentration: this.conc } as unknown as Partial<SpellCard> }, this.ctl.settings.spells);
			if (r.status === 'ok') void this.finish(r.card);
			else {
				this.message = r.status === 'error' ? r.error : 'Нужны данные';
				this.render();
			}
		}, { cls: 'gmc-btn gmc-btn-p', testId: 'si-m-save' });
	}

	private async finish(card: SpellCard): Promise<void> {
		if (card.origin !== 'srd') {
			const v = validateCard(card, card.origin);
			this.ctl.settings.spells = upsertSpell(this.ctl.settings.spells, { ...v, id: card.id || v.id });
			await this.ctl.saveSettings();
		}
		if (this.characterId) {
			const book = cockpitOf(this.ctl.state as NonNullable<typeof this.ctl.state>).spellbooks[this.characterId] ?? { known: [], prepared: [] };
			if (!book.known.some((k) => k.id === card.id)) {
				await this.ctl.act({ type: 'cockpit/spellbook-set', characterId: this.characterId, book: { known: [...book.known, { id: card.id, name: card.name, level: card.level, concentration: card.concentration }], prepared: book.prepared } });
			}
		}
		this.onDone(card.id);
		this.close();
	}
}

export class CueModal extends Modal {
	constructor(private readonly ctl: Controller, private readonly spell: { id: string; name: string }, private readonly onDone: () => void) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText(`Свет: ${this.spell.name}`);
		const el = this.contentEl;
		const existing = this.ctl.settings.cues.find((c) => c.cardId === this.spell.id);
		const b: CueBinding = existing ? structuredClone(existing) : { id: newId('cue'), cardId: this.spell.id, address: '', command: 'activate', args: [], autoStart: false };
		el.createDiv({ cls: 'gmc-dim', text: 'Адрес: в Lightkey правый клик по cue → External Control → Copy OSC Address. Успешная отправка не означает, что эффект выполнен.' });
		field(el, 'OSC-адрес cue', b.address, (v) => (b.address = v.trim()), 'cue-address');
		new Setting(el).setName('Команда').addDropdown((d) => {
			d.addOptions({ activate: 'activate', deactivate: 'deactivate', toggle: 'toggle' }).setValue(b.command === 'custom' ? 'activate' : b.command).onChange((v) => (b.command = v as CueCommand));
			tid(d.selectEl, 'cue-command');
		});
		new Setting(el).setName('Автозапуск при использовании заклинания').setDesc('По умолчанию свет запускается кнопкой.').addToggle((t) => t.setValue(b.autoStart).onChange((v) => (b.autoStart = v)));
		const status = el.createDiv({ cls: 'gmc-dim', attr: { 'data-testid': 'cue-status' } });
		const row = el.createDiv({ cls: 'gmc-row gmc-gap' });
		button(row, 'Тест', () => void (async () => {
			const err = validateBinding(b);
			if (err) return void status.setText(err);
			const lk = this.ctl.settings.lightkey;
			const r = await sendCue(new DgramTransport(), { host: lk.host, port: lk.port }, b);
			status.setText(r.status === 'sent' ? `Отправлено на ${r.target}: ${r.address}. Выполнение не подтверждается.` : `Ошибка: ${r.detail}`);
		})(), { cls: 'gmc-btn', testId: 'cue-test' });
		button(row, 'Сохранить', () => void (async () => {
			const err = validateBinding(b);
			if (err) return void status.setText(err);
			this.ctl.settings.cues = [...this.ctl.settings.cues.filter((c) => c.cardId !== b.cardId), b];
			await this.ctl.saveSettings();
			this.onDone();
			this.close();
		})(), { cls: 'gmc-btn gmc-btn-p', testId: 'cue-save' });
		if (existing) {
			button(row, 'Удалить привязку', () => void (async () => {
				this.ctl.settings.cues = this.ctl.settings.cues.filter((c) => c.cardId !== b.cardId);
				await this.ctl.saveSettings();
				this.onDone();
				this.close();
			})(), { cls: 'gmc-btn gmc-btn-d' });
		}
		void buildCueMessage;
		void resolveItemType;
	}
}

export type { Abilities };

/** Level up with the player's decisions: Ability Score Improvement (or the SRD feat) and subclass. One undoable action. */
export class LevelUpModal extends Modal {
	private asi: AbilityId[] | 'grappler' | null = null;
	private second: AbilityId | '' = '';
	private subclass = '';
	constructor(private readonly ctl: Controller, private readonly characterId: string) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Повышение уровня');
		const st = this.ctl.state;
		const ch = st?.characters[this.characterId];
		const sheet = st ? cockpitOf(st).sheets[this.characterId] : undefined;
		const el = this.contentEl;
		if (!ch || !sheet) return void el.createDiv({ cls: 'gmc-warn', text: 'Нет листа персонажа: правьте уровень вручную по бумажному листу.' });
		const idx = ch.classes.findIndex((k) => CLASSES.some((c) => c.ru === k.name));
		const entry = ch.classes[idx];
		const def = entry ? CLASSES.find((c) => c.ru === entry.name) : undefined;
		if (!entry || !def) return void el.createDiv({ cls: 'gmc-warn', text: 'Класс не из SRD — повысьте уровень вручную по бумажному листу.' });
		const next = entry.level + 1;
		el.createDiv({ text: `${entry.name}: ${entry.level} → ${next}` });
		const hasAsi = asiLevels(def.id, next).includes(next);
		if (hasAsi) {
			el.createDiv({ cls: 'gmc-eyebrow', text: 'Повышение характеристик (выбор игрока)' });
			new Setting(el).setName('+2 к одной').addDropdown((d) => {
				d.addOption('', '—');
				for (const a of ABILITIES) d.addOption(a, ABILITY_RU[a]);
				d.onChange((v) => {
					const a = ab(v);
					this.asi = a ? [a] : null;
					this.second = '';
				});
				tid(d.selectEl, 'lu-asi');
			});
			new Setting(el).setName('или +1 ко второй (к выбранной выше)').addDropdown((d) => {
				d.addOption('', '—');
				for (const a of ABILITIES) d.addOption(a, ABILITY_RU[a]);
				d.onChange((v) => (this.second = ab(v) ?? ''));
				tid(d.selectEl, 'lu-asi2');
			});
			new Setting(el).setName('или черта SRD').addToggle((t) => t.onChange((v) => (this.asi = v ? 'grappler' : null)));
		}
		if (next === def.subclassLevel && !sheet.subclass.trim()) {
			new Setting(el).setName('Подкласс').addDropdown((d) => {
				d.addOption('', '— выберите —');
				for (const x of srdSubclasses(def.id)) d.addOption(x.name, `${x.name} (SRD)`);
				d.onChange((v) => (this.subclass = v));
				tid(d.selectEl, 'lu-subclass');
			});
		}
		const err = el.createDiv({ cls: 'gmc-warn' });
		button(el, 'Повысить', () => void (async () => {
			try {
				const first = Array.isArray(this.asi) ? this.asi[0] : undefined;
				const pick: AbilityId[] | 'grappler' | null = this.asi === 'grappler' ? 'grappler' : first && this.second ? [first, this.second] : this.asi;
				const r = levelUp(ch, { ...sheet, ...(this.subclass ? { subclass: this.subclass } : {}) }, hasAsi && pick ? { asi: pick } : {});
				const out = await this.ctl.act({ type: 'cockpit/level-up', character: r.character, sheet: r.sheet });
				if (!out.ok) return;
				new Notice(r.warnings.join('\n'), 9000);
				this.close();
			} catch (e) {
				err.setText(e instanceof Error ? e.message : String(e));
			}
		})(), { cls: 'gmc-btn gmc-btn-p', testId: 'lu-apply' });
	}
}
