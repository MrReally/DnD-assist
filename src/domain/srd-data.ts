// Mechanical game facts derived from the SRD 5.1 data file (see srd.ts) plus a few curated, SRD-verified tables.
// Nothing numeric about items or creatures is typed in here: it comes from data/srd51/srd51.json, which is
// generated from the official PDF and cross-checked by tests/unit/srd-reference.test.ts.
import type { Abilities, ItemType, StatBlock } from './cockpit';
import { getSrd, monsterById, onSrd, type SrdData, type SrdMonster } from './srd';
import type { AbilityId } from './types';

/** Old (v1.1.0) item type ids → SRD ids, so saved items keep resolving. */
export const ITEM_ID_ALIASES: Readonly<Record<string, string>> = {
	'light-crossbow': 'crossbow-light', 'hand-crossbow': 'crossbow-hand', 'heavy-crossbow': 'crossbow-heavy',
	rope: 'rope-hempen-50-feet', arrows: 'arrows-20', bolts: 'crossbow-bolts-20', lantern: 'lantern-bullseye',
	rations: 'rations-1-day', 'healing-potion': 'potion-of-healing', 'thieves-tools': 'thieves-tools',
};

/** Community terminology for display only. NOT from the SRD and NOT verified: the English SRD name is always kept. */
export const RU_NAMES: Readonly<Record<string, string>> = {
	club: 'Дубинка', dagger: 'Кинжал', greatclub: 'Палица', handaxe: 'Ручной топор', javelin: 'Метательное копьё', 'light-hammer': 'Лёгкий молот', mace: 'Булава', quarterstaff: 'Боевой посох', sickle: 'Серп', spear: 'Копьё',
	'crossbow-light': 'Лёгкий арбалет', dart: 'Дротик', shortbow: 'Короткий лук', sling: 'Праща', battleaxe: 'Боевой топор', flail: 'Цеп', glaive: 'Глефа', greataxe: 'Секира', greatsword: 'Двуручный меч', halberd: 'Алебарда', lance: 'Копьё всадника',
	longsword: 'Длинный меч', maul: 'Молот', morningstar: 'Моргенштерн', pike: 'Пика', rapier: 'Рапира', scimitar: 'Скимитар', shortsword: 'Короткий меч', trident: 'Трезубец', 'war-pick': 'Боевая кирка', warhammer: 'Боевой молот', whip: 'Кнут',
	blowgun: 'Духовая трубка', 'crossbow-hand': 'Ручной арбалет', 'crossbow-heavy': 'Тяжёлый арбалет', longbow: 'Длинный лук', net: 'Сеть',
	padded: 'Стёганый доспех', leather: 'Кожаный доспех', 'studded-leather': 'Проклёпанный кожаный доспех', hide: 'Шкурный доспех', 'chain-shirt': 'Кольчужная рубаха', 'scale-mail': 'Чешуйчатый доспех', breastplate: 'Кираса', 'half-plate': 'Полулаты', 'ring-mail': 'Колечный доспех', 'chain-mail': 'Кольчуга', splint: 'Пластинчатый доспех', plate: 'Латы', shield: 'Щит',
	backpack: 'Рюкзак', sack: 'Мешок', pouch: 'Поясной кошель', chest: 'Сундук', torch: 'Факел', bedroll: 'Спальник', tinderbox: 'Трутница', waterskin: 'Бурдюк', 'potion-of-healing': 'Зелье лечения', 'rope-hempen-50-feet': 'Верёвка пеньковая (50 фт)', 'rations-1-day': 'Рацион (1 день)', 'thieves-tools': 'Воровские инструменты',
};

/** Property terms: English SRD term → common Russian term (display aid, unverified translation). */
export const PROPERTY_RU: Readonly<Record<string, string>> = {
	ammunition: 'боеприпас', finesse: 'фехтовальное', heavy: 'тяжёлое', light: 'лёгкое', loading: 'перезарядка', reach: 'досягаемость', special: 'особое', thrown: 'метательное', 'two-handed': 'двуручное', versatile: 'универсальное',
};

export function propertyLabel(p: string): string {
	const key = /^[a-z-]+/i.exec(p)?.[0]?.toLowerCase() ?? '';
	const ru = PROPERTY_RU[key];
	return ru ? `${p} (${ru})` : p;
}

const CONTAINERS = new Set(['backpack', 'sack', 'pouch', 'chest', 'barrel', 'basket', 'bag-of-holding']);

/** Filled when the SRD file is loaded. Keys are SRD ids. */
export const ITEM_TYPES: Record<string, ItemType> = {};

onSrd((d: SrdData) => {
	for (const k of Object.keys(ITEM_TYPES)) delete ITEM_TYPES[k];
	for (const w of d.weapons) {
		const props = w.properties.map((p) => p.charAt(0).toLowerCase() + p.slice(1));
		ITEM_TYPES[w.id] = { id: w.id, name: w.name, ...(RU_NAMES[w.id] ? { ru: RU_NAMES[w.id] } : {}), kind: 'weapon', category: w.category, reach: w.reach, ...(w.damage ? { damage: w.damage } : {}), ...(w.damageType ? { damageType: w.damageType } : {}), costCp: w.costCp, weight: w.weight ?? 0, properties: props, range: w.range ?? (w.reach === 'melee' ? '5 ft.' : '') , verification: w.verification };
	}
	for (const a of d.armor) {
		ITEM_TYPES[a.id] = { id: a.id, name: a.name, ...(RU_NAMES[a.id] ? { ru: RU_NAMES[a.id] } : {}), kind: a.type === 'shield' ? 'shield' : 'armor', costCp: a.costCp, weight: a.weight ?? 0, properties: [], ac: { base: a.acBonus ?? a.baseAc, dex: a.dex, ...(a.minStr ? { minStr: a.minStr } : {}), ...(a.stealthDisadvantage ? { stealthDis: true } : {}), ...(a.type === 'shield' ? { bonus: true } : {}) }, verification: a.verification };
	}
	for (const g of d.gear) {
		if (ITEM_TYPES[g.id]) continue;
		ITEM_TYPES[g.id] = { id: g.id, name: g.name, ...(RU_NAMES[g.id] ? { ru: RU_NAMES[g.id] } : {}), kind: CONTAINERS.has(g.id) ? 'container' : /potion/.test(g.id) ? 'magic' : 'gear', costCp: g.costCp, weight: g.weight ?? 0, properties: [], verification: g.verification };
	}
});

export function armorClassLabel(t: ItemType): string {
	if (!t.ac) return '';
	const a = t.ac;
	if (a.bonus) return `+${a.base}`;
	return a.dex === 'full' ? `${a.base} + Dex` : a.dex === 'max2' ? `${a.base} + Dex (max 2)` : `${a.base}`;
}

// ---- creatures from SRD stat blocks -------------------------------------------------------------

const profFromCr = (cr: string): number => {
	const n = cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr);
	return n < 5 ? 2 : n < 9 ? 3 : n < 13 ? 4 : n < 17 ? 5 : n < 21 ? 6 : n < 25 ? 7 : n < 29 ? 8 : 9;
};

/** Statblock for an SRD monster, as printed (attack bonuses, damage and everything else are the book's). */
export function statBlockFromMonster(m: SrdMonster): Omit<StatBlock, 'creatureId'> {
	const features = (t: string): Array<{ name: string; text: string }> => (t ? [{ name: 'SRD', text: t }] : []);
	return {
		kind: 'monster', type: m.typeLine, role: '', cr: m.cr, profBonus: profFromCr(m.cr), abilities: { ...m.abilities },
		saves: m.saves ?? '', skills: m.skills ?? '', resist: m.resistances ?? '', immune: m.immunities ?? '', vuln: m.vulnerabilities ?? '', conditionImmune: m.conditionImmunities ?? '',
		senses: m.senses ?? '', languages: m.languages ?? '', speed: m.speed ?? '', traits: features(m.traitsText), actions: features(m.actionsText),
		attacks: m.attacks.map((a) => ({ id: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: a.name, bonus: a.bonus, damage: a.damage, damageType: a.damageType, range: a.range ?? a.reach ?? '', notes: a.kind })),
		origin: 'official', sourceNote: `D&D 5e SRD 5.1 (CC-BY-4.0) — ${m.name}`,
	};
}

export interface CreatureTemplate {
	id: string;
	monsterId: string;
	/** Search keywords (lower-case, ё→е); Russian words are search aids only. */
	keys: string[];
	name: string;
	goldMax: number;
}

/** Keyword → SRD monster. Which monsters carry coins is a GM-facing convenience, not SRD data. */
export const CREATURE_TEMPLATES: readonly CreatureTemplate[] = [
	{ id: 'goblin', monsterId: 'goblin', keys: ['гоблин', 'goblin'], name: 'Goblin', goldMax: 3 },
	{ id: 'bandit', monsterId: 'bandit', keys: ['бандит', 'разбойник', 'bandit'], name: 'Bandit', goldMax: 8 },
	{ id: 'guard', monsterId: 'guard', keys: ['стражник', 'страж', 'охранник', 'guard'], name: 'Guard', goldMax: 5 },
	{ id: 'commoner', monsterId: 'commoner', keys: ['простолюдин', 'посетитель', 'крестьянин', 'commoner', 'горожанин', 'трактирщик'], name: 'Commoner', goldMax: 2 },
	{ id: 'thug', monsterId: 'thug', keys: ['головорез', 'бугай', 'громила', 'thug'], name: 'Thug', goldMax: 10 },
	{ id: 'cultist', monsterId: 'cultist', keys: ['культист', 'cultist', 'фанатик'], name: 'Cultist', goldMax: 4 },
	{ id: 'noble', monsterId: 'noble', keys: ['дворянин', 'аристократ', 'noble', 'барон'], name: 'Noble', goldMax: 40 },
];

export function monsterOf(t: CreatureTemplate): SrdMonster | undefined {
	return monsterById(t.monsterId);
}

// ---- classes, races, slots --------------------------------------------------------------------

export interface ClassDef {
	id: string;
	ru: string;
	hitDie: number;
	saves: AbilityId[];
	skillChoices: number;
	skillList: string[] | 'any';
	weaponProf: string[];
	armorProf: string[];
	caster: 'full' | 'half' | 'none';
	castAbility: AbilityId | null;
	/** Subclass chosen at this level. */
	subclassLevel: number;
}

export const CLASSES: readonly ClassDef[] = [
	{ id: 'barbarian', ru: 'Варвар', hitDie: 12, saves: ['str', 'con'], skillChoices: 2, skillList: ['animal', 'athletics', 'intimidation', 'nature', 'perception', 'survival'], weaponProf: ['simple', 'martial'], armorProf: ['light', 'medium', 'shield'], caster: 'none', castAbility: null, subclassLevel: 3 },
	{ id: 'bard', ru: 'Бард', hitDie: 8, saves: ['dex', 'cha'], skillChoices: 3, skillList: 'any', weaponProf: ['simple', 'crossbow-hand', 'longsword', 'rapier', 'shortsword'], armorProf: ['light'], caster: 'full', castAbility: 'cha', subclassLevel: 3 },
	{ id: 'cleric', ru: 'Жрец', hitDie: 8, saves: ['wis', 'cha'], skillChoices: 2, skillList: ['history', 'insight', 'medicine', 'persuasion', 'religion'], weaponProf: ['simple'], armorProf: ['light', 'medium', 'shield'], caster: 'full', castAbility: 'wis', subclassLevel: 1 },
	{ id: 'druid', ru: 'Друид', hitDie: 8, saves: ['int', 'wis'], skillChoices: 2, skillList: ['arcana', 'animal', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'], weaponProf: ['club', 'dagger', 'dart', 'javelin', 'mace', 'quarterstaff', 'scimitar', 'sickle', 'sling', 'spear'], armorProf: ['light', 'medium', 'shield'], caster: 'full', castAbility: 'wis', subclassLevel: 2 },
	{ id: 'fighter', ru: 'Воин', hitDie: 10, saves: ['str', 'con'], skillChoices: 2, skillList: ['acrobatics', 'animal', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'], weaponProf: ['simple', 'martial'], armorProf: ['light', 'medium', 'heavy', 'shield'], caster: 'none', castAbility: null, subclassLevel: 3 },
	{ id: 'monk', ru: 'Монах', hitDie: 8, saves: ['str', 'dex'], skillChoices: 2, skillList: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'], weaponProf: ['simple', 'shortsword'], armorProf: [], caster: 'none', castAbility: null, subclassLevel: 3 },
	{ id: 'paladin', ru: 'Паладин', hitDie: 10, saves: ['wis', 'cha'], skillChoices: 2, skillList: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'], weaponProf: ['simple', 'martial'], armorProf: ['light', 'medium', 'heavy', 'shield'], caster: 'half', castAbility: 'cha', subclassLevel: 3 },
	{ id: 'ranger', ru: 'Следопыт', hitDie: 10, saves: ['str', 'dex'], skillChoices: 3, skillList: ['animal', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'], weaponProf: ['simple', 'martial'], armorProf: ['light', 'medium', 'shield'], caster: 'half', castAbility: 'wis', subclassLevel: 3 },
	{ id: 'rogue', ru: 'Плут', hitDie: 8, saves: ['dex', 'int'], skillChoices: 4, skillList: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight', 'stealth'], weaponProf: ['simple', 'crossbow-hand', 'longsword', 'rapier', 'shortsword'], armorProf: ['light'], caster: 'none', castAbility: null, subclassLevel: 3 },
	{ id: 'sorcerer', ru: 'Чародей', hitDie: 6, saves: ['con', 'cha'], skillChoices: 2, skillList: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'], weaponProf: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'], armorProf: [], caster: 'full', castAbility: 'cha', subclassLevel: 1 },
	{ id: 'warlock', ru: 'Колдун', hitDie: 8, saves: ['wis', 'cha'], skillChoices: 2, skillList: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'], weaponProf: ['simple'], armorProf: ['light'], caster: 'none', castAbility: 'cha', subclassLevel: 1 },
	{ id: 'wizard', ru: 'Волшебник', hitDie: 6, saves: ['int', 'wis'], skillChoices: 2, skillList: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'], weaponProf: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light'], armorProf: [], caster: 'full', castAbility: 'int', subclassLevel: 2 },
];

export interface RaceDef {
	id: string;
	/** Parent race id for SRD subraces. */
	parent?: string;
	ru: string;
	bonus: Partial<Record<AbilityId, number>>;
	/** Free +1 choices (Half-Elf gets +1 to two others). */
	freeBonus?: { count: number; amount: number; exclude: AbilityId[] };
	speed: number;
}

/** SRD 5.1 races (PHB 2014 values). Races not listed here are not offered: enter them via quick fill. */
export const RACES: readonly RaceDef[] = [
	{ id: 'dwarf', ru: 'Дварф', bonus: { con: 2 }, speed: 25 },
	{ id: 'hill-dwarf', parent: 'dwarf', ru: 'Холмовой дварф', bonus: { wis: 1 }, speed: 25 },
	{ id: 'elf', ru: 'Эльф', bonus: { dex: 2 }, speed: 30 },
	{ id: 'high-elf', parent: 'elf', ru: 'Высший эльф', bonus: { int: 1 }, speed: 30 },
	{ id: 'halfling', ru: 'Полурослик', bonus: { dex: 2 }, speed: 25 },
	{ id: 'lightfoot', parent: 'halfling', ru: 'Легконогий полурослик', bonus: { cha: 1 }, speed: 25 },
	{ id: 'human', ru: 'Человек', bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30 },
	{ id: 'dragonborn', ru: 'Драконорождённый', bonus: { str: 2, cha: 1 }, speed: 30 },
	{ id: 'gnome', ru: 'Гном', bonus: { int: 2 }, speed: 25 },
	{ id: 'rock-gnome', parent: 'gnome', ru: 'Скальный гном', bonus: { con: 1 }, speed: 25 },
	{ id: 'half-elf', ru: 'Полуэльф', bonus: { cha: 2 }, freeBonus: { count: 2, amount: 1, exclude: ['cha'] }, speed: 30 },
	{ id: 'half-orc', ru: 'Полуорк', bonus: { str: 2, con: 1 }, speed: 30 },
	{ id: 'tiefling', ru: 'Тифлинг', bonus: { int: 1, cha: 2 }, speed: 30 },
];

/** Spell slots by caster level, full casters (PHB table), levels 1–20: rows of slots for spell levels 1..9. */
const FULL: number[][] = [
	[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
	[4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Slots {"1": 4, ...}. Half casters (paladin, ranger) start at level 2 and use ceil(level/2). Warlock pact magic is not modelled. */
export function spellSlotsFor(caster: ClassDef['caster'], level: number): Record<string, number> {
	const lv = Math.max(1, Math.min(20, level));
	const casterLevel = caster === 'full' ? lv : caster === 'half' ? (lv < 2 ? 0 : Math.ceil(lv / 2)) : 0;
	const row = casterLevel > 0 ? FULL[casterLevel - 1] : undefined;
	const out: Record<string, number> = {};
	row?.forEach((n, i) => (out[String(i + 1)] = n));
	return out;
}

/**
 * Racial traits that change mechanics. Each entry is backed by a regex over the SRD race text in
 * tests/unit/srd-reference.test.ts, so none of it rests on memory. Anything else about a race stays free text.
 */
export interface RaceTraits {
	/** Skill proficiencies granted outright. */
	skills?: string[];
	/** Weapon proficiencies granted (SRD weapon ids). */
	weaponProf?: string[];
	/** Extra hit points per level (Dwarven Toughness). */
	hpPerLevel?: number;
	/** Number of skills the player chooses (Skill Versatility). */
	freeSkills?: number;
	/** Wizard cantrips the player chooses (High Elf). */
	wizardCantrips?: number;
	/** Extra languages the player chooses. */
	languages?: number;
}

export const RACE_TRAITS: Readonly<Record<string, RaceTraits>> = {
	dwarf: { weaponProf: ['battleaxe', 'handaxe', 'light-hammer', 'warhammer'] },
	'hill-dwarf': { hpPerLevel: 1 },
	elf: { skills: ['perception'] },
	'high-elf': { weaponProf: ['longsword', 'shortsword', 'shortbow', 'longbow'], wizardCantrips: 1, languages: 1 },
	'half-elf': { freeSkills: 2, languages: 1 },
	'half-orc': { skills: ['intimidation'] },
};

/** Racial traits of a race plus its subrace. */
export function raceTraits(raceId: string, subraceId?: string): RaceTraits {
	const a = RACE_TRAITS[raceId] ?? {};
	const b = (subraceId && RACE_TRAITS[subraceId]) || {};
	return { skills: [...(a.skills ?? []), ...(b.skills ?? [])], weaponProf: [...(a.weaponProf ?? []), ...(b.weaponProf ?? [])], hpPerLevel: (a.hpPerLevel ?? 0) + (b.hpPerLevel ?? 0), freeSkills: (a.freeSkills ?? 0) + (b.freeSkills ?? 0), wizardCantrips: (a.wizardCantrips ?? 0) + (b.wizardCantrips ?? 0), languages: (a.languages ?? 0) + (b.languages ?? 0) };
}

export interface SubclassDef {
	id: string;
	name: string;
	classId: string;
}

/** SRD subclasses (one per class); names come from the SRD data file. */
export function srdSubclasses(classId: string): SubclassDef[] {
	return (getSrd()?.subclasses ?? []).filter((x) => x.classId === classId).map((x) => ({ id: x.id, name: x.name, classId }));
}
