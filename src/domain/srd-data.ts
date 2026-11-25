// Mechanical game facts from the D&D 5e SRD 5.1 (CC-BY-4.0, Wizards of the Coast): weapon/armor/gear stats,
// a few basic creature stat blocks, class and race tables. Only numbers and short names — no descriptive text
// from the books and nothing from TTG Club. Russian names follow the common Russian PHB terminology.
import type { Abilities, ItemType, StatBlock } from './cockpit';
import type { AbilityId } from './types';

const gp = (n: number): number => Math.round(n * 100);
const sp = (n: number): number => Math.round(n * 10);

type W = [id: string, ru: string, cat: 'simple' | 'martial', reach: 'melee' | 'ranged', dmg: string, type: string, costCp: number, weight: number, props: string[], range?: string];

const WEAPONS: W[] = [
	['club', 'Дубинка', 'simple', 'melee', '1d4', 'дробящий', sp(1), 2, ['лёгкое']],
	['dagger', 'Кинжал', 'simple', 'melee', '1d4', 'колющий', gp(2), 1, ['фехтовальное', 'лёгкое', 'метательное'], '5 фт / метание 20/60'],
	['greatclub', 'Палица', 'simple', 'melee', '1d8', 'дробящий', sp(2), 10, ['двуручное']],
	['handaxe', 'Ручной топор', 'simple', 'melee', '1d6', 'рубящий', gp(5), 2, ['лёгкое', 'метательное'], '5 фт / метание 20/60'],
	['javelin', 'Метательное копьё', 'simple', 'melee', '1d6', 'колющий', sp(5), 2, ['метательное'], '5 фт / метание 30/120'],
	['light-hammer', 'Лёгкий молот', 'simple', 'melee', '1d4', 'дробящий', gp(2), 2, ['лёгкое', 'метательное'], '5 фт / метание 20/60'],
	['mace', 'Булава', 'simple', 'melee', '1d6', 'дробящий', gp(5), 4, []],
	['quarterstaff', 'Боевой посох', 'simple', 'melee', '1d6', 'дробящий', sp(2), 4, ['универсальное (1d8)']],
	['sickle', 'Серп', 'simple', 'melee', '1d4', 'рубящий', gp(1), 2, ['лёгкое']],
	['spear', 'Копьё', 'simple', 'melee', '1d6', 'колющий', gp(1), 3, ['метательное', 'универсальное (1d8)'], '5 фт / метание 20/60'],
	['light-crossbow', 'Лёгкий арбалет', 'simple', 'ranged', '1d8', 'колющий', gp(25), 5, ['боеприпас', 'перезарядка', 'двуручное'], '80/320'],
	['dart', 'Дротик', 'simple', 'ranged', '1d4', 'колющий', 5, 0.25, ['фехтовальное', 'метательное'], '20/60'],
	['shortbow', 'Короткий лук', 'simple', 'ranged', '1d6', 'колющий', gp(25), 2, ['боеприпас', 'двуручное'], '80/320'],
	['sling', 'Праща', 'simple', 'ranged', '1d4', 'дробящий', sp(1), 0, ['боеприпас'], '30/120'],
	['battleaxe', 'Боевой топор', 'martial', 'melee', '1d8', 'рубящий', gp(10), 4, ['универсальное (1d10)']],
	['flail', 'Цеп', 'martial', 'melee', '1d8', 'дробящий', gp(10), 2, []],
	['glaive', 'Глефа', 'martial', 'melee', '1d10', 'рубящий', gp(20), 6, ['тяжёлое', 'досягаемость', 'двуручное'], '10 фт'],
	['greataxe', 'Секира', 'martial', 'melee', '1d12', 'рубящий', gp(30), 7, ['тяжёлое', 'двуручное']],
	['greatsword', 'Двуручный меч', 'martial', 'melee', '2d6', 'рубящий', gp(50), 6, ['тяжёлое', 'двуручное']],
	['halberd', 'Алебарда', 'martial', 'melee', '1d10', 'рубящий', gp(20), 6, ['тяжёлое', 'досягаемость', 'двуручное'], '10 фт'],
	['lance', 'Копьё всадника', 'martial', 'melee', '1d12', 'колющий', gp(10), 6, ['досягаемость', 'особое'], '10 фт'],
	['longsword', 'Длинный меч', 'martial', 'melee', '1d8', 'рубящий', gp(15), 3, ['универсальное (1d10)']],
	['maul', 'Молот', 'martial', 'melee', '2d6', 'дробящий', gp(10), 10, ['тяжёлое', 'двуручное']],
	['morningstar', 'Моргенштерн', 'martial', 'melee', '1d8', 'колющий', gp(15), 4, []],
	['pike', 'Пика', 'martial', 'melee', '1d10', 'колющий', gp(5), 18, ['тяжёлое', 'досягаемость', 'двуручное'], '10 фт'],
	['rapier', 'Рапира', 'martial', 'melee', '1d8', 'колющий', gp(25), 2, ['фехтовальное']],
	['scimitar', 'Скимитар', 'martial', 'melee', '1d6', 'рубящий', gp(25), 3, ['фехтовальное', 'лёгкое']],
	['shortsword', 'Короткий меч', 'martial', 'melee', '1d6', 'колющий', gp(10), 2, ['фехтовальное', 'лёгкое']],
	['trident', 'Трезубец', 'martial', 'melee', '1d6', 'колющий', gp(5), 4, ['метательное', 'универсальное (1d8)'], '5 фт / метание 20/60'],
	['war-pick', 'Боевая кирка', 'martial', 'melee', '1d8', 'колющий', gp(5), 2, []],
	['warhammer', 'Боевой молот', 'martial', 'melee', '1d8', 'дробящий', gp(15), 2, ['универсальное (1d10)']],
	['whip', 'Кнут', 'martial', 'melee', '1d4', 'рубящий', gp(2), 3, ['фехтовальное', 'досягаемость'], '10 фт'],
	['hand-crossbow', 'Ручной арбалет', 'martial', 'ranged', '1d6', 'колющий', gp(75), 3, ['боеприпас', 'лёгкое', 'перезарядка'], '30/120'],
	['heavy-crossbow', 'Тяжёлый арбалет', 'martial', 'ranged', '1d10', 'колющий', gp(50), 18, ['боеприпас', 'тяжёлое', 'перезарядка', 'двуручное'], '100/400'],
	['longbow', 'Длинный лук', 'martial', 'ranged', '1d8', 'колющий', gp(50), 2, ['боеприпас', 'тяжёлое', 'двуручное'], '150/600'],
];

type A = [id: string, ru: string, base: number, dex: 'full' | 'max2' | 'none', costCp: number, weight: number, minStr?: number, stealth?: boolean];
const ARMOR: A[] = [
	['padded', 'Стёганый доспех', 11, 'full', gp(5), 8, undefined, true],
	['leather', 'Кожаный доспех', 11, 'full', gp(10), 10],
	['studded-leather', 'Проклёпанный кожаный доспех', 12, 'full', gp(45), 13],
	['hide', 'Шкурный доспех', 12, 'max2', gp(10), 12],
	['chain-shirt', 'Кольчужная рубаха', 13, 'max2', gp(50), 20],
	['scale-mail', 'Чешуйчатый доспех', 14, 'max2', gp(50), 45, undefined, true],
	['breastplate', 'Кираса', 14, 'max2', gp(400), 20],
	['half-plate', 'Полулаты', 15, 'max2', gp(750), 40, undefined, true],
	['ring-mail', 'Колечный доспех', 14, 'none', gp(30), 40, undefined, true],
	['chain-mail', 'Кольчуга', 16, 'none', gp(75), 55, 13, true],
	['splint', 'Пластинчатый доспех', 17, 'none', gp(200), 60, 15, true],
	['plate', 'Латы', 18, 'none', gp(1500), 65, 15, true],
];

const GEAR: Array<[id: string, ru: string, kind: ItemType['kind'], cp: number, w: number]> = [
	['backpack', 'Рюкзак', 'container', gp(2), 5],
	['sack', 'Мешок', 'container', 1, 0.5],
	['pouch', 'Поясной кошель', 'container', sp(5), 1],
	['chest', 'Сундук', 'container', gp(5), 25],
	['rope', 'Верёвка пеньковая (50 фт)', 'gear', gp(1), 10],
	['torch', 'Факел', 'gear', 1, 1],
	['rations', 'Рацион (1 день)', 'gear', sp(5), 2],
	['waterskin', 'Бурдюк', 'gear', sp(2), 5],
	['bedroll', 'Спальник', 'gear', gp(1), 7],
	['tinderbox', 'Трутница', 'gear', sp(5), 1],
	['thieves-tools', 'Воровские инструменты', 'gear', gp(25), 1],
	['lantern', 'Фонарь с лучом', 'gear', gp(10), 2],
	['arrows', 'Стрелы (20)', 'gear', gp(1), 1],
	['bolts', 'Арбалетные болты (20)', 'gear', gp(1), 1.5],
	['healing-potion', 'Зелье лечения', 'magic', gp(50), 0.5],
];

function build(): Record<string, ItemType> {
	const out: Record<string, ItemType> = {};
	for (const [id, name, category, reach, damage, damageType, costCp, weight, properties, range] of WEAPONS) {
		out[id] = { id, name, kind: 'weapon', category, reach, damage, damageType, costCp, weight, properties, ...(range ? { range } : reach === 'melee' ? { range: '5 фт' } : {}) };
	}
	for (const [id, name, base, dex, costCp, weight, minStr, stealthDis] of ARMOR) {
		out[id] = { id, name, kind: 'armor', costCp, weight, properties: [], ac: { base, dex, ...(minStr ? { minStr } : {}), ...(stealthDis ? { stealthDis: true } : {}) } };
	}
	out.shield = { id: 'shield', name: 'Щит', kind: 'shield', costCp: gp(10), weight: 6, properties: [], ac: { base: 2, dex: 'none', bonus: true } };
	for (const [id, name, kind, costCp, weight] of GEAR) out[id] = { id, name, kind, costCp, weight, properties: [] };
	return out;
}

export const ITEM_TYPES: Readonly<Record<string, ItemType>> = Object.freeze(build());

export function armorClassLabel(t: ItemType): string {
	if (!t.ac) return '';
	const a = t.ac;
	if (a.bonus) return `+${a.base}`;
	return a.dex === 'full' ? `${a.base} + ЛОВ` : a.dex === 'max2' ? `${a.base} + ЛОВ (макс. 2)` : `${a.base}`;
}

// ---- basic SRD creatures ----------------------------------------------------------------------

const ab = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });

export interface CreatureTemplate {
	id: string;
	/** Search keywords (lower-case, ё→е). */
	keys: string[];
	name: string;
	hpAvg: number;
	hpDice: string;
	ac: number;
	acNote: string;
	block: Omit<StatBlock, 'creatureId'>;
	/** Weapon type ids the creature carries by default (first = main melee). */
	weapons: string[];
	/** Starting purse range in gold. */
	goldMax: number;
}

const base = (kind: StatBlock['kind'], type: string, cr: string, abilities: Abilities, extra: Partial<StatBlock>): Omit<StatBlock, 'creatureId'> => ({
	kind, type, role: '', cr, profBonus: 2, abilities, saves: '', skills: '', resist: '', immune: '', vuln: '', conditionImmune: '', senses: '', languages: '', speed: '30 фт', traits: [], actions: [], attacks: [], origin: 'official', sourceNote: 'D&D 5e SRD 5.1 (CC-BY-4.0)', ...extra,
});

export const CREATURE_TEMPLATES: readonly CreatureTemplate[] = [
	{
		id: 'goblin', keys: ['гоблин', 'goblin'], name: 'Гоблин', hpAvg: 7, hpDice: '2d6', ac: 15, acNote: 'кожаный доспех, щит', weapons: ['scimitar', 'shortbow'], goldMax: 3,
		block: base('monster', 'Небольшой гуманоид (гоблиноид), нейтрально-злой', '1/4', ab(8, 14, 10, 10, 8, 8), {
			skills: 'Скрытность +6', senses: 'тёмное зрение 60 фт., пассивное Восприятие 9', languages: 'Общий, Гоблинский',
			traits: [{ name: 'Проворный побег', text: 'Бонусным действием может совершить Отход или Засаду.' }],
			attacks: [
				{ id: 'scimitar', name: 'Скимитар', bonus: 4, damage: '1d6+2', damageType: 'рубящий', range: '5 фт', notes: 'ближний бой' },
				{ id: 'shortbow', name: 'Короткий лук', bonus: 4, damage: '1d6+2', damageType: 'колющий', range: '80/320', notes: 'дальний бой' },
			],
		}),
	},
	{
		id: 'bandit', keys: ['бандит', 'разбойник', 'bandit'], name: 'Бандит', hpAvg: 11, hpDice: '2d8+2', ac: 12, acNote: 'кожаный доспех', weapons: ['scimitar', 'light-crossbow'], goldMax: 8,
		block: base('npc', 'Средний гуманоид, любое не-законное мировоззрение', '1/8', ab(11, 12, 12, 10, 10, 10), {
			languages: 'Общий, один любой',
			attacks: [
				{ id: 'scimitar', name: 'Скимитар', bonus: 3, damage: '1d6+1', damageType: 'рубящий', range: '5 фт', notes: '' },
				{ id: 'light-crossbow', name: 'Лёгкий арбалет', bonus: 3, damage: '1d8+1', damageType: 'колющий', range: '80/320', notes: '' },
			],
		}),
	},
	{
		id: 'guard', keys: ['стражник', 'страж', 'охранник', 'guard'], name: 'Стражник', hpAvg: 11, hpDice: '2d8+2', ac: 16, acNote: 'кольчужная рубаха, щит', weapons: ['spear'], goldMax: 5,
		block: base('npc', 'Средний гуманоид, любое мировоззрение', '1/8', ab(13, 12, 12, 10, 11, 10), {
			skills: 'Восприятие +2', senses: 'пассивное Восприятие 12', languages: 'Общий, один любой',
			attacks: [{ id: 'spear', name: 'Копьё', bonus: 3, damage: '1d6+1', damageType: 'колющий', range: '5 фт / метание 20/60', notes: '' }],
		}),
	},
	{
		id: 'commoner', keys: ['простолюдин', 'посетитель', 'крестьянин', 'commoner', 'горожанин', 'трактирщик'], name: 'Простолюдин', hpAvg: 4, hpDice: '1d8', ac: 10, acNote: '', weapons: ['club'], goldMax: 2,
		block: base('npc', 'Средний гуманоид, любое мировоззрение', '0', ab(10, 10, 10, 10, 10, 10), {
			languages: 'Общий, один любой', attacks: [{ id: 'club', name: 'Дубинка', bonus: 2, damage: '1d4', damageType: 'дробящий', range: '5 фт', notes: '' }],
		}),
	},
	{
		id: 'thug', keys: ['головорез', 'бугай', 'громила', 'thug'], name: 'Головорез', hpAvg: 32, hpDice: '5d8+10', ac: 11, acNote: 'кожаный доспех', weapons: ['mace', 'heavy-crossbow'], goldMax: 10,
		block: base('npc', 'Средний гуманоид, любое не-доброе мировоззрение', '1/2', ab(15, 11, 14, 10, 10, 11), {
			skills: 'Запугивание +2', languages: 'Общий, один любой',
			traits: [{ name: 'Тактика стаи', text: 'Преимущество на бросок атаки, если союзник стоит в пределах 5 фт от цели и не выведен из строя.' }],
			actions: [{ name: 'Мультиатака', text: 'Две атаки в ближнем бою.' }],
			attacks: [
				{ id: 'mace', name: 'Булава', bonus: 4, damage: '1d6+2', damageType: 'дробящий', range: '5 фт', notes: '' },
				{ id: 'heavy-crossbow', name: 'Тяжёлый арбалет', bonus: 2, damage: '1d10', damageType: 'колющий', range: '100/400', notes: '' },
			],
		}),
	},
	{
		id: 'cultist', keys: ['культист', 'cultist', 'фанатик'], name: 'Культист', hpAvg: 9, hpDice: '2d8', ac: 12, acNote: 'кожаный доспех', weapons: ['scimitar'], goldMax: 4,
		block: base('npc', 'Средний гуманоид, любое не-доброе мировоззрение', '1/8', ab(11, 12, 10, 10, 11, 10), {
			skills: 'Религия +2, Обман +2', languages: 'Общий, один любой',
			traits: [{ name: 'Тёмная преданность', text: 'Преимущество на спасброски от очарования и испуга.' }],
			attacks: [{ id: 'scimitar', name: 'Скимитар', bonus: 3, damage: '1d6+1', damageType: 'рубящий', range: '5 фт', notes: '' }],
		}),
	},
	{
		id: 'noble', keys: ['дворянин', 'аристократ', 'noble', 'барон'], name: 'Дворянин', hpAvg: 9, hpDice: '2d8', ac: 15, acNote: 'кираса', weapons: ['rapier'], goldMax: 40,
		block: base('npc', 'Средний гуманоид, любое мировоззрение', '1/8', ab(11, 12, 11, 12, 14, 16), {
			skills: 'Обман +5, Проницательность +4, Убеждение +5', languages: 'Общий, два любых',
			attacks: [{ id: 'rapier', name: 'Рапира', bonus: 3, damage: '1d8+1', damageType: 'колющий', range: '5 фт', notes: '' }],
		}),
	},
];

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
	{ id: 'bard', ru: 'Бард', hitDie: 8, saves: ['dex', 'cha'], skillChoices: 3, skillList: 'any', weaponProf: ['simple', 'hand-crossbow', 'longsword', 'rapier', 'shortsword'], armorProf: ['light'], caster: 'full', castAbility: 'cha', subclassLevel: 3 },
	{ id: 'cleric', ru: 'Жрец', hitDie: 8, saves: ['wis', 'cha'], skillChoices: 2, skillList: ['history', 'insight', 'medicine', 'persuasion', 'religion'], weaponProf: ['simple'], armorProf: ['light', 'medium', 'shield'], caster: 'full', castAbility: 'wis', subclassLevel: 1 },
	{ id: 'druid', ru: 'Друид', hitDie: 8, saves: ['int', 'wis'], skillChoices: 2, skillList: ['arcana', 'animal', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'], weaponProf: ['club', 'dagger', 'dart', 'javelin', 'mace', 'quarterstaff', 'scimitar', 'sickle', 'sling', 'spear'], armorProf: ['light', 'medium', 'shield'], caster: 'full', castAbility: 'wis', subclassLevel: 2 },
	{ id: 'fighter', ru: 'Воин', hitDie: 10, saves: ['str', 'con'], skillChoices: 2, skillList: ['acrobatics', 'animal', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'], weaponProf: ['simple', 'martial'], armorProf: ['light', 'medium', 'heavy', 'shield'], caster: 'none', castAbility: null, subclassLevel: 3 },
	{ id: 'monk', ru: 'Монах', hitDie: 8, saves: ['str', 'dex'], skillChoices: 2, skillList: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'], weaponProf: ['simple', 'shortsword'], armorProf: [], caster: 'none', castAbility: null, subclassLevel: 3 },
	{ id: 'paladin', ru: 'Паладин', hitDie: 10, saves: ['wis', 'cha'], skillChoices: 2, skillList: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'], weaponProf: ['simple', 'martial'], armorProf: ['light', 'medium', 'heavy', 'shield'], caster: 'half', castAbility: 'cha', subclassLevel: 3 },
	{ id: 'ranger', ru: 'Следопыт', hitDie: 10, saves: ['str', 'dex'], skillChoices: 3, skillList: ['animal', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'], weaponProf: ['simple', 'martial'], armorProf: ['light', 'medium', 'shield'], caster: 'half', castAbility: 'wis', subclassLevel: 3 },
	{ id: 'rogue', ru: 'Плут', hitDie: 8, saves: ['dex', 'int'], skillChoices: 4, skillList: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight', 'stealth'], weaponProf: ['simple', 'hand-crossbow', 'longsword', 'rapier', 'shortsword'], armorProf: ['light'], caster: 'none', castAbility: null, subclassLevel: 3 },
	{ id: 'sorcerer', ru: 'Чародей', hitDie: 6, saves: ['con', 'cha'], skillChoices: 2, skillList: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'], weaponProf: ['dagger', 'dart', 'sling', 'quarterstaff', 'light-crossbow'], armorProf: [], caster: 'full', castAbility: 'cha', subclassLevel: 1 },
	{ id: 'warlock', ru: 'Колдун', hitDie: 8, saves: ['wis', 'cha'], skillChoices: 2, skillList: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'], weaponProf: ['simple'], armorProf: ['light'], caster: 'none', castAbility: 'cha', subclassLevel: 1 },
	{ id: 'wizard', ru: 'Волшебник', hitDie: 6, saves: ['int', 'wis'], skillChoices: 2, skillList: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'], weaponProf: ['dagger', 'dart', 'sling', 'quarterstaff', 'light-crossbow'], armorProf: [], caster: 'full', castAbility: 'int', subclassLevel: 2 },
];

export interface RaceDef {
	id: string;
	ru: string;
	bonus: Partial<Record<AbilityId, number>>;
	/** Free +1 choices (Half-Elf gets +1 to two others). */
	freeBonus?: { count: number; amount: number; exclude: AbilityId[] };
	speed: number;
}

/** SRD 5.1 races (PHB 2014 values). Races not listed here are not offered: enter them via quick fill. */
export const RACES: readonly RaceDef[] = [
	{ id: 'dwarf', ru: 'Дварф', bonus: { con: 2 }, speed: 25 },
	{ id: 'elf', ru: 'Эльф', bonus: { dex: 2 }, speed: 30 },
	{ id: 'halfling', ru: 'Полурослик', bonus: { dex: 2 }, speed: 25 },
	{ id: 'human', ru: 'Человек', bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30 },
	{ id: 'dragonborn', ru: 'Драконорождённый', bonus: { str: 2, cha: 1 }, speed: 30 },
	{ id: 'gnome', ru: 'Гном', bonus: { int: 2 }, speed: 25 },
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
