// Character builder (by rules, 2014 SRD data) and quick NPC creation. Pure; ids and randomness are injected.
import { ABILITIES, abilityMod, cockpitOf, emptySheet, isFinesse, profByLevel, type Abilities, type ItemInstance, type Purse, type Sheet, type Spellbook, type StatBlock } from './cockpit';
import { CLASSES, CREATURE_TEMPLATES, ITEM_ID_ALIASES, ITEM_TYPES, monsterOf, RACES, spellSlotsFor, statBlockFromMonster, type ClassDef, type CreatureTemplate } from './srd-data';
import type { SrdMonster } from './srd';
import { emptyCharacter } from './state';
import type { AbilityId, AdventureState, CharacterState, CreatureCard } from './types';
import type { ItemType } from './cockpit';

export type IdFactory = (prefix: string) => string;

export interface BuildChoices {
	name: string;
	raceId: string;
	/** SRD subrace id (hill-dwarf, high-elf, lightfoot, rock-gnome); adds its own bonus on top of the parent race. */
	subraceId?: string;
	/** Picks for races with free bonuses (e.g. half-elf). */
	freeBonusPicks?: AbilityId[];
	classId: string;
	level: number;
	/** Scores BEFORE racial bonuses (standard array / point buy / rolled — the GM decides). */
	baseAbilities: Abilities;
	background: string;
	subclass: string;
	skills: string[];
	/** Item type ids to equip/carry. */
	gear: string[];
	notePath: string;
	hpOverride?: number | null;
}

export interface BuildResult {
	character: CharacterState;
	sheet: Sheet;
	items: ItemInstance[];
	book?: Spellbook;
	warnings: string[];
}

export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Point buy: 27 points, scores 8–15. Returns the cost or null if illegal. */
export function pointBuyCost(a: Abilities): number | null {
	const costs: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
	let total = 0;
	for (const k of ABILITIES) {
		const c = costs[a[k]];
		if (c === undefined) return null;
		total += c;
	}
	return total;
}

export function classById(id: string): ClassDef | undefined {
	return CLASSES.find((c) => c.id === id);
}

export function armorClassFor(abilities: Abilities, equipped: ItemType[]): number {
	const dex = abilityMod(abilities.dex);
	const armor = equipped.find((t) => t.kind === 'armor' && t.ac);
	let ac = 10 + dex;
	if (armor?.ac) {
		const d = armor.ac.dex === 'full' ? dex : armor.ac.dex === 'max2' ? Math.min(2, dex) : 0;
		ac = armor.ac.base + d;
	}
	if (equipped.some((t) => t.kind === 'shield')) ac += 2;
	return ac;
}

export function buildCharacter(ch: BuildChoices, newId: IdFactory, types: Readonly<Record<string, ItemType>> = ITEM_TYPES): BuildResult {
	const warnings: string[] = [];
	const cls = classById(ch.classId);
	const race = RACES.find((r) => r.id === ch.raceId && !r.parent);
	const sub = ch.subraceId ? RACES.find((r) => r.id === ch.subraceId && r.parent === ch.raceId) : undefined;
	if (ch.subraceId && !sub) throw new Error('Подраса не соответствует расе');
	if (!cls) throw new Error('Неизвестный класс');
	if (!race) throw new Error('Неизвестная раса');
	const level = Math.max(1, Math.min(20, Math.floor(ch.level)));
	const abilities: Abilities = { ...ch.baseAbilities };
	for (const [k, v] of Object.entries(race.bonus)) abilities[k as AbilityId] += v ?? 0;
	for (const [k, v] of Object.entries(sub?.bonus ?? {})) abilities[k as AbilityId] += v ?? 0;
	if (race.freeBonus) {
		const picks = [...new Set(ch.freeBonusPicks ?? [])].filter((p) => !race.freeBonus?.exclude.includes(p)).slice(0, race.freeBonus.count);
		if (picks.length < race.freeBonus.count) warnings.push(`Не выбрано дополнительных бонусов характеристик: ${race.freeBonus.count - picks.length}`);
		for (const p of picks) abilities[p] += race.freeBonus.amount;
	}
	for (const k of ABILITIES) if (abilities[k] > 20) abilities[k] = 20;
	const conMod = abilityMod(abilities.con);
	const avg = Math.floor(cls.hitDie / 2) + 1;
	const hp = ch.hpOverride ?? Math.max(1, cls.hitDie + conMod + (level - 1) * Math.max(1, avg + conMod));

	const character = emptyCharacter(newId('pc'), ch.name.trim() || 'Новый персонаж', ch.notePath);
	character.classes = [{ name: cls.ru, level }];
	character.hp = { current: hp, max: hp, temporary: 0 };
	character.speedFeet = (sub ?? race).speed;
	character.initiativeModifier = abilityMod(abilities.dex);
	character.hitDice = [{ die: `d${cls.hitDie}` as 'd6', total: level, remaining: level }];
	const slots = spellSlotsFor(cls.caster, level);
	for (const [lv, n] of Object.entries(slots)) character.spellSlots[lv] = { max: n, current: n };

	const skills: Record<string, 1 | 2> = {};
	const allowed = cls.skillList === 'any' ? null : new Set(cls.skillList);
	for (const s of ch.skills.slice(0, cls.skillChoices)) {
		if (allowed && !allowed.has(s)) {
			warnings.push(`Навык «${s}» не входит в список класса — отмечен вручную`);
		}
		skills[s] = 1;
	}
	if (ch.skills.length < cls.skillChoices) warnings.push(`Выбрано навыков: ${ch.skills.length} из ${cls.skillChoices}`);

	const sheet: Sheet = {
		...emptySheet(),
		race: sub ? sub.ru : race.ru,
		background: ch.background,
		subclass: ch.subclass,
		abilities,
		saveProf: [...cls.saves],
		skills,
		weaponProf: [...cls.weaponProf],
		armorProf: [...cls.armorProf],
		castAbility: cls.castAbility,
	};
	if (level >= cls.subclassLevel && !ch.subclass.trim()) warnings.push(`Подкласс выбирается на ${cls.subclassLevel} уровне — укажите вручную`);

	const items: ItemInstance[] = [];
	for (const id of ch.gear) {
		const t = types[id];
		if (!t) continue;
		const equipped = t.kind === 'weapon' || t.kind === 'armor' || t.kind === 'shield';
		items.push({ id: newId('itm'), typeId: id, name: t.name, ownerKind: 'character', ownerId: character.id, containerId: null, qty: 1, equipped, magicBonus: 0, note: '' });
	}
	character.ac = armorClassFor(abilities, items.filter((i) => i.equipped).map((i) => types[i.typeId ?? '']).filter((t): t is ItemType => !!t));
	warnings.push('Проверьте результат по бумажному листу: он остаётся источником истины.');
	return { character, sheet, items, ...(cls.caster !== 'none' ? { book: { known: [], prepared: [] } } : {}), warnings };
}

// ---- quick NPC ----------------------------------------------------------------------------------

export interface QuickNpcResult {
	creature: CreatureCard;
	statblock: StatBlock;
	items: ItemInstance[];
	purse: Purse;
	note: string;
}

const normQ = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/** Words → weapon type id (SRD ids). First stem match wins; only weapons that exist in the SRD data. */
const WEAPON_WORDS: Array<[string, string]> = [
	['кинжал', 'dagger'], ['нож', 'dagger'], ['скимитар', 'scimitar'], ['сабл', 'scimitar'], ['рапир', 'rapier'], ['длинн', 'longsword'], ['меч', 'shortsword'],
	['дубин', 'club'], ['булав', 'mace'], ['топор', 'handaxe'], ['копь', 'spear'], ['посох', 'quarterstaff'], ['лук', 'shortbow'], ['арбалет', 'crossbow-light'], ['молот', 'warhammer'],
];

export function findTemplate(query: string): CreatureTemplate | null {
	const q = normQ(query);
	return CREATURE_TEMPLATES.find((t) => t.keys.some((k) => q.includes(normQ(k)))) ?? null;
}

export function findWeapon(query: string): string | null {
	const q = normQ(query);
	return WEAPON_WORDS.find(([w]) => q.includes(w))?.[1] ?? null;
}

function rollDice(expr: string, rng: () => number): number {
	const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(expr);
	if (!m) return 1;
	let t = Number(m[3] ?? 0);
	for (let i = 0; i < Number(m[1]); i++) t += 1 + Math.floor(rng() * Number(m[2]));
	return Math.max(1, t);
}

/**
 * Any SRD monster → creature card + stat block exactly as printed (origin 'official'), HP rolled from its dice.
 * Nothing is scaled to party level. `weaponId` swaps the main melee attack for an SRD weapon (origin 'adapted'),
 * the only place where bonus/damage are computed (ability mod + the creature's proficiency) instead of copied.
 */
export function creatureFromMonster(m: SrdMonster, newId: IdFactory, rng: () => number = Math.random, opts: { role?: string; weaponId?: string | null; goldMax?: number } = {}, types: Readonly<Record<string, ItemType>> = ITEM_TYPES): QuickNpcResult {
	const creatureId = newId('crt');
	const hp = m.hpDice ? rollDice(m.hpDice, rng) : m.hpAvg;
	const block: StatBlock = { ...structuredClone(statBlockFromMonster(m)), creatureId, role: opts.role ?? '', kind: m.xp <= 1100 && /humanoid/i.test(m.typeLine) ? 'npc' : 'monster' };
	const items: ItemInstance[] = [];
	const wt = opts.weaponId ? types[opts.weaponId] : undefined;
	if (wt && opts.weaponId) {
		const a = weaponAttackFor(wt, block);
		block.attacks = [{ id: opts.weaponId, name: wt.name, bonus: a.bonus, damage: a.damage, damageType: wt.damageType ?? '', range: a.range, notes: 'адаптировано под запрос (расчёт по характеристикам)' }, ...block.attacks.filter((x) => x.id !== opts.weaponId).slice(0, 1)];
		block.origin = 'adapted';
		block.sourceNote = `SRD 5.1 «${m.name}», оружие заменено по запросу`;
		items.push({ id: newId('itm'), typeId: opts.weaponId, name: wt.name, ownerKind: 'creature', ownerId: creatureId, containerId: null, qty: 1, equipped: true, magicBonus: 0, note: '' });
	} else {
		// carry the weapons named in the printed attacks when the SRD has them (reference only)
		for (const at of m.attacks.slice(0, 2)) {
			const w = Object.values(types).find((t) => t.kind === 'weapon' && t.name.toLowerCase().replace(/,/g, '') === at.name.toLowerCase().replace(/,/g, ''));
			if (w) items.push({ id: newId('itm'), typeId: w.id, name: w.name, ownerKind: 'creature', ownerId: creatureId, containerId: null, qty: 1, equipped: true, magicBonus: 0, note: '' });
		}
	}
	if (opts.role) block.origin = block.origin === 'official' ? 'adapted' : block.origin;
	const gold = Math.floor(rng() * ((opts.goldMax ?? 0) + 1));
	const creature: CreatureCard = { id: creatureId, name: opts.role ? `${m.name} (${opts.role})` : m.name, aliases: [m.name], ac: m.acValue, hpMax: hp, initiativeModifier: abilityMod(block.abilities.dex), speed: block.speed, notes: block.sourceNote, source: { provider: 'local', ref: m.id } };
	return { creature, statblock: block, items, purse: { pp: 0, gp: gold, ep: 0, sp: gold ? Math.floor(rng() * 10) : 0, cp: 0 }, note: `HP ${hp} (${m.hpDice ?? m.hpAvg}), КД ${m.ac}` };
}

/** "Гоблин-посетитель таверны с кинжалом" → SRD template + role text + requested weapon. null if no template matches. */
export function quickNpc(query: string, newId: IdFactory, rng: () => number = Math.random, types: Readonly<Record<string, ItemType>> = ITEM_TYPES): QuickNpcResult | null {
	const tpl = findTemplate(query);
	const m = tpl ? monsterOf(tpl) : undefined;
	if (!tpl || !m) return null;
	return creatureFromMonster(m, newId, rng, { role: extractRole(query, tpl), weaponId: findWeapon(query), goldMax: tpl.goldMax }, types);
}

function extractRole(query: string, tpl: CreatureTemplate): string {
	let q = query.trim();
	for (const k of tpl.keys) q = q.replace(new RegExp(k, 'i'), '');
	q = q.replace(/\s+с\s+[^,]*$/i, '').replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, '');
	return q.length > 60 ? q.slice(0, 60) : q;
}

function weaponAttackFor(t: ItemType, b: StatBlock): { bonus: number; damage: string; range: string } {
	const sMod = abilityMod(b.abilities.str);
	const dMod = abilityMod(b.abilities.dex);
	const mod = t.reach === 'ranged' ? dMod : isFinesse(t) ? Math.max(sMod, dMod) : sMod;
	return { bonus: mod + b.profBonus, damage: `${t.damage ?? '1'}${mod === 0 ? '' : mod > 0 ? `+${mod}` : `${mod}`}`, range: t.range ?? '5 ft.' };
}

/** Item type lookup: adventure-local custom types first, then the built-in SRD table. */
export function resolveItemType(state: AdventureState, item: ItemInstance): ItemType | null {
	if (item.custom) return item.custom;
	if (!item.typeId) return null;
	const c = cockpitOf(state).itemTypes;
	return c[item.typeId] ?? ITEM_TYPES[item.typeId] ?? ITEM_TYPES[ITEM_ID_ALIASES[item.typeId] ?? ''] ?? null;
}

// ---- level up -----------------------------------------------------------------------------------

export interface LevelUpResult {
	character: CharacterState;
	warnings: string[];
}

/**
 * +1 level in the character's main class (first class entry that matches a known class, by Russian name).
 * HP: average of the hit die (die/2+1) + CON modifier, never less than 1. Slots follow the PHB table;
 * current slots keep their spent amount. Subclass is only a reminder. Anything else stays as the GM entered it.
 */
export function levelUp(ch: CharacterState, sheet: Sheet): LevelUpResult {
	const warnings: string[] = [];
	const idx = ch.classes.findIndex((k) => CLASSES.some((c) => c.ru === k.name));
	const entry = ch.classes[idx];
	const def = entry ? CLASSES.find((c) => c.ru === entry.name) : undefined;
	if (!entry || !def) throw new Error('Класс персонажа не из списка SRD — повысьте уровень вручную по бумажному листу');
	if (entry.level >= 20) throw new Error('Максимальный уровень (20)');
	const next = structuredClone(ch);
	const lv = entry.level + 1;
	(next.classes[idx] as { level: number }).level = lv;
	const gain = Math.max(1, Math.floor(def.hitDie / 2) + 1 + abilityMod(sheet.abilities.con));
	if (next.hp.max !== null) {
		next.hp = { ...next.hp, max: next.hp.max + gain, current: next.hp.current + gain };
	} else warnings.push('Максимум HP не задан — не изменён');
	const die = `d${def.hitDie}` as 'd6';
	const hd = next.hitDice.find((h) => h.die === die);
	if (hd) {
		hd.total += 1;
		hd.remaining += 1;
	} else next.hitDice.push({ die, total: 1, remaining: 1 });
	const slots = spellSlotsFor(def.caster, lv);
	for (const [k, n] of Object.entries(slots)) {
		const cur = next.spellSlots[k];
		const spent = cur ? cur.max - cur.current : 0;
		next.spellSlots[k] = { max: n, current: Math.max(0, n - spent) };
	}
	if (lv === def.subclassLevel && !sheet.subclass.trim()) warnings.push('Выберите подкласс');
	if ([4, 8, 12, 16, 19].includes(lv)) warnings.push('Повышение характеристик или черта — внесите вручную');
	warnings.push(`Мастерство теперь +${profByLevel(totalLevelOf(next))}. Сверьте с бумажным листом.`);
	return { character: next, warnings };
}

function totalLevelOf(ch: CharacterState): number {
	return ch.classes.reduce((n, c) => n + c.level, 0);
}
