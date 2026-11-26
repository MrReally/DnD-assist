// GM Cockpit game data kept in state.extensions.cockpit (undoable via the generic diff, no schema bump)
// and the pure D&D 5e (2014) calculations used by the cards. Nothing here touches Obsidian or the DOM.
import type { AbilityId, AdventureState } from './types';

export const ABILITIES: readonly AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_RU: Record<AbilityId, string> = { str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' };

export type Abilities = Record<AbilityId, number>;

export const SKILLS: ReadonlyArray<{ id: string; ru: string; ability: AbilityId }> = [
	{ id: 'acrobatics', ru: 'Акробатика', ability: 'dex' },
	{ id: 'animal', ru: 'Уход за животными', ability: 'wis' },
	{ id: 'arcana', ru: 'Магия', ability: 'int' },
	{ id: 'athletics', ru: 'Атлетика', ability: 'str' },
	{ id: 'deception', ru: 'Обман', ability: 'cha' },
	{ id: 'history', ru: 'История', ability: 'int' },
	{ id: 'insight', ru: 'Проницательность', ability: 'wis' },
	{ id: 'intimidation', ru: 'Запугивание', ability: 'cha' },
	{ id: 'investigation', ru: 'Анализ', ability: 'int' },
	{ id: 'medicine', ru: 'Медицина', ability: 'wis' },
	{ id: 'nature', ru: 'Природа', ability: 'int' },
	{ id: 'perception', ru: 'Восприятие', ability: 'wis' },
	{ id: 'performance', ru: 'Выступление', ability: 'cha' },
	{ id: 'persuasion', ru: 'Убеждение', ability: 'cha' },
	{ id: 'religion', ru: 'Религия', ability: 'int' },
	{ id: 'sleight', ru: 'Ловкость рук', ability: 'dex' },
	{ id: 'stealth', ru: 'Скрытность', ability: 'dex' },
	{ id: 'survival', ru: 'Выживание', ability: 'wis' },
];

export const DEFAULT_ABILITIES: Abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

export interface Feature {
	name: string;
	text: string;
}

/** Hand-editable character sheet data the base CharacterState does not carry. Paper sheet is the source of truth. */
export interface Sheet {
	/** SRD ids (optional: hand-entered sheets have none). */
	raceId?: string;
	subraceId?: string;
	classId?: string;
	/** 'srd' = SRD background, 'custom' = entered by the GM (not in the SRD, nothing is pre-filled). */
	backgroundKind?: 'srd' | 'custom';
	race: string;
	background: string;
	subclass: string;
	abilities: Abilities;
	/** null = derived from total level. */
	profBonus: number | null;
	saveProf: AbilityId[];
	/** skill id → 1 proficient, 2 expertise. */
	skills: Record<string, 1 | 2>;
	/** 'simple' | 'martial' | item type id. */
	weaponProf: string[];
	armorProf: string[];
	castAbility: AbilityId | null;
	languages: string;
	features: Feature[];
	notes: string;
}

export interface StatAttack {
	id: string;
	name: string;
	/** null → computed from abilities/proficiency when possible. */
	bonus: number | null;
	damage: string;
	damageType: string;
	range: string;
	notes: string;
}

export type StatOrigin = 'official' | 'adapted' | 'generated' | 'custom';

export interface StatBlock {
	creatureId: string;
	kind: 'npc' | 'monster';
	type: string;
	role: string;
	cr: string;
	profBonus: number;
	abilities: Abilities;
	saves: string;
	skills: string;
	resist: string;
	immune: string;
	vuln: string;
	conditionImmune: string;
	senses: string;
	languages: string;
	speed: string;
	traits: Feature[];
	actions: Feature[];
	attacks: StatAttack[];
	origin: StatOrigin;
	sourceNote: string;
}

export type ItemKind = 'weapon' | 'armor' | 'shield' | 'gear' | 'container' | 'treasure' | 'magic';

export interface ItemType {
	id: string;
	name: string;
	/** Display-only community translation (not from the SRD, unverified). */
	ru?: string;
	/** SRD-verified, user-entered, homebrew … (see srd.ts). */
	verification?: string;
	kind: ItemKind;
	/** Price in copper pieces (integers only). */
	costCp: number;
	weight: number;
	damage?: string;
	damageType?: string;
	/** 'melee' | 'ranged' */
	reach?: 'melee' | 'ranged';
	category?: 'simple' | 'martial';
	range?: string;
	properties: string[];
	ac?: { base: number; dex: 'full' | 'max2' | 'none'; minStr?: number; stealthDis?: boolean; bonus?: boolean };
	text?: string;
}

export type OwnerKind = 'character' | 'creature';

export interface ItemInstance {
	id: string;
	/** Library type id; null → a fully custom item described by `custom`. */
	typeId: string | null;
	custom?: ItemType;
	name: string;
	ownerKind: OwnerKind;
	ownerId: string;
	containerId: string | null;
	qty: number;
	equipped: boolean;
	magicBonus: number;
	note: string;
}

export interface Purse {
	pp: number;
	gp: number;
	ep: number;
	sp: number;
	cp: number;
}

export interface SpellRef {
	id: string;
	name: string;
	level: number;
	concentration: boolean;
}

export interface Spellbook {
	known: SpellRef[];
	prepared: string[];
}

export interface ViewPoint {
	name: string;
	x: number;
	y: number;
	zoom: number;
}

export interface CockpitData {
	sheets: Record<string, Sheet>;
	statblocks: Record<string, StatBlock>;
	items: Record<string, ItemInstance>;
	itemTypes: Record<string, ItemType>;
	purses: Record<string, Purse>;
	spellbooks: Record<string, Spellbook>;
	/** canvas path relative to the adventure root → slot "1".."9" → view point. */
	viewpoints: Record<string, Record<string, ViewPoint>>;
}

export function emptyCockpit(): CockpitData {
	return { sheets: {}, statblocks: {}, items: {}, itemTypes: {}, purses: {}, spellbooks: {}, viewpoints: {} };
}

export function emptySheet(): Sheet {
	return { race: '', background: '', subclass: '', abilities: { ...DEFAULT_ABILITIES }, profBonus: null, saveProf: [], skills: {}, weaponProf: [], armorProf: [], castAbility: null, languages: '', features: [], notes: '' };
}

/** Read-only accessor; always returns a complete structure (missing parts are empty). */
export function cockpitOf(state: AdventureState): CockpitData {
	const raw = state.extensions.cockpit;
	const base = emptyCockpit();
	return raw && typeof raw === 'object' ? { ...base, ...(raw as Partial<CockpitData>) } : base;
}

/** Mutable accessor for reducers (creates the container on first use). */
export function cockpitMut(state: AdventureState): CockpitData {
	const cur = cockpitOf(state);
	state.extensions.cockpit = cur;
	return cur;
}

// ---- rules (D&D 5e 2014) --------------------------------------------------------------------

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
export const profByLevel = (level: number): number => 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);

export function totalLevel(classes: ReadonlyArray<{ level: number }>): number {
	return classes.reduce((n, c) => n + c.level, 0);
}

export function profBonusOf(sheet: Sheet | undefined, level: number): number {
	return sheet?.profBonus ?? profByLevel(level || 1);
}

export function saveBonus(sheet: Sheet, ability: AbilityId, prof: number): number {
	return abilityMod(sheet.abilities[ability]) + (sheet.saveProf.includes(ability) ? prof : 0);
}

export function skillBonus(sheet: Sheet, skillId: string, prof: number): number {
	const s = SKILLS.find((x) => x.id === skillId);
	if (!s) return 0;
	return abilityMod(sheet.abilities[s.ability]) + (sheet.skills[skillId] ?? 0) * prof;
}

export interface AttackCalc {
	bonus: number;
	damage: string;
	damageType: string;
	range: string;
	/** Human-readable breakdown ("Как считается"). */
	how: string[];
	ability: AbilityId;
	proficient: boolean;
}

export function isFinesse(t: ItemType): boolean {
	return t.properties.some((p) => /^finesse\b/i.test(p));
}

/**
 * Attack of a weapon for an owner with the given abilities. Finesse picks the better of STR/DEX,
 * ranged uses DEX, otherwise STR. The GM still decides whether it hits; this is reference only.
 */
export function weaponAttack(t: ItemType, abilities: Abilities, prof: number, proficient: boolean, magic = 0): AttackCalc {
	const sMod = abilityMod(abilities.str);
	const dMod = abilityMod(abilities.dex);
	let ability: AbilityId = 'str';
	if (t.reach === 'ranged') ability = 'dex';
	else if (isFinesse(t)) ability = dMod > sMod ? 'dex' : 'str';
	const mod = abilityMod(abilities[ability]);
	const bonus = mod + (proficient ? prof : 0) + magic;
	const dmgMod = mod + magic;
	const base = t.damage ?? '—';
	const damage = t.damage ? (dmgMod === 0 ? base : `${base} ${dmgMod > 0 ? '+' : '−'} ${Math.abs(dmgMod)}`) : '—';
	const how = [`${ABILITY_RU[ability]} ${signed(mod)}`];
	how.push(proficient ? `мастерство ${signed(prof)}` : 'без мастерства');
	if (magic) how.push(`магический бонус ${signed(magic)}`);
	return { bonus, damage, damageType: t.damageType ?? '', range: t.range ?? (t.reach === 'melee' ? '5 ft.' : ''), how: [...how, `= ${signed(bonus)} к атаке`], ability, proficient };
}

export function isProficientWith(t: ItemType, sheet: Sheet | undefined): boolean {
	if (!sheet) return false;
	return sheet.weaponProf.includes(t.id) || (!!t.category && sheet.weaponProf.includes(t.category));
}

export function spellDc(sheet: Sheet, prof: number): number | null {
	return sheet.castAbility ? 8 + prof + abilityMod(sheet.abilities[sheet.castAbility]) : null;
}

export function spellAttackBonus(sheet: Sheet, prof: number): number | null {
	return sheet.castAbility ? prof + abilityMod(sheet.abilities[sheet.castAbility]) : null;
}

export function formatCost(cp: number): string {
	if (cp <= 0) return '—';
	if (cp % 100 === 0) return `${cp / 100} зм`;
	if (cp % 10 === 0) return `${cp / 10} см`;
	return `${cp} мм`;
}

export function formatWeight(w: number): string {
	return w <= 0 ? '—' : `${Number.isInteger(w) ? w : w.toFixed(2).replace(/0+$/, '')} фнт`;
}

export function purseOf(c: CockpitData, ownerId: string): Purse {
	return c.purses[ownerId] ?? { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
}

export function itemsOf(c: CockpitData, ownerId: string): ItemInstance[] {
	return Object.values(c.items).filter((i) => i.ownerId === ownerId);
}

/** Total carried weight (containers' own weight included, contents counted through ownership). */
export function carriedWeight(c: CockpitData, ownerId: string, types: (i: ItemInstance) => ItemType | null): number {
	let w = 0;
	for (const i of itemsOf(c, ownerId)) w += (types(i)?.weight ?? 0) * i.qty;
	const p = purseOf(c, ownerId);
	w += (p.pp + p.gp + p.ep + p.sp + p.cp) / 50;
	return Math.round(w * 100) / 100;
}
