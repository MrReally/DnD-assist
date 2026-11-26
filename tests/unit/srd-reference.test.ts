// Independent verification of the imported SRD 5.1 data and of the curated rule tables.
// Reference values below were read from the official SRD 5.1 PDF text (sha256 in data meta) and typed here by hand —
// they are deliberately NOT produced by the importer, so a parser error cannot hide itself.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSrd, type SrdData } from '../../src/domain/srd';
import { CLASSES, RACES, RACE_TRAITS, spellSlotsFor, ITEM_TYPES, RU_NAMES, CREATURE_TEMPLATES } from '../../src/domain/srd-data';

const srd = JSON.parse(readFileSync('data/srd51/srd51.json', 'utf8')) as SrdData;
const by = <T extends { id: string }>(list: T[], id: string): T => {
	const r = list.find((x) => x.id === id);
	if (!r) throw new Error(`missing ${id}`);
	return r;
};

describe('SRD data: provenance and completeness', () => {
	it('is the pinned official SRD 5.1 under CC-BY-4.0, 2014 edition only', () => {
		expect(srd.meta.pdfSha256).toBe('2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0');
		expect(srd.meta.license).toBe('CC-BY-4.0');
		expect(srd.meta.edition).toBe('2014');
		expect(srd.meta.attribution).toContain('System Reference Document 5.1');
		expect(srd.meta.attribution).toContain('Wizards of the Coast LLC');
		expect(srd.meta.attribution).toContain('creativecommons.org/licenses/by/4.0');
		expect(srd.meta.sourceUrl).toContain('SRD_CC_v5.1.pdf');
	});
	it('every record has id, name, type, edition, source, version and verification', () => {
		const all = [...srd.spells, ...srd.monsters, ...srd.weapons, ...srd.armor, ...srd.gear, ...srd.classes, ...srd.races, ...srd.backgrounds, ...srd.feats];
		for (const r of all) {
			expect(r.id, r.name).toMatch(/^[a-z0-9-]+$/);
			expect(r.name.length).toBeGreaterThan(0);
			expect(r.type).toBeTruthy();
			expect(r.edition).toBe('2014');
			expect(r.source).toBe('SRD 5.1');
			expect(r.dataVersion).toMatch(/^\d+\.\d+\.\d+$/);
			expect(['srd-verified', 'partial']).toContain(r.verification);
		}
	});
	it('ids are unique within each collection', () => {
		for (const list of [srd.spells, srd.monsters, srd.weapons, srd.armor, srd.gear, srd.classes, srd.races]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
	});
	it('SRD 5.1 scale: ~319 spells, 300+ monsters, 37 weapons, 12 classes', () => {
		expect(srd.spells.length).toBeGreaterThanOrEqual(318);
		expect(srd.monsters.length).toBeGreaterThanOrEqual(300);
		expect(srd.weapons.length).toBe(37);
		expect(srd.armor.length).toBe(13);
		expect(srd.classes.length).toBe(12);
		expect(srd.gear.length).toBeGreaterThan(100);
	});
	it('extraction warnings are the known, documented ones only', () => {
		const known = srd.meta.warnings.filter((w) => !/Giant Fly|Ranger/.test(w));
		expect(known).toEqual([]);
	});
});

describe('weapons vs the SRD weapons table (typed from the PDF)', () => {
	// name: [cost cp, damage, type, weight lb, properties]
	const ref: Record<string, [number, string, string, number, string[]]> = {
		club: [10, '1d4', 'bludgeoning', 2, ['Light']],
		dagger: [200, '1d4', 'piercing', 1, ['Finesse', 'light', 'thrown (range 20/60)']],
		greatclub: [20, '1d8', 'bludgeoning', 10, ['Two-handed']],
		handaxe: [500, '1d6', 'slashing', 2, ['Light', 'thrown (range 20/60)']],
		javelin: [50, '1d6', 'piercing', 2, ['Thrown (range 30/120)']],
		mace: [500, '1d6', 'bludgeoning', 4, []],
		quarterstaff: [20, '1d6', 'bludgeoning', 4, ['Versatile (1d8)']],
		spear: [100, '1d6', 'piercing', 3, ['Thrown (range 20/60)', 'versatile (1d8)']],
		'crossbow-light': [2500, '1d8', 'piercing', 5, ['Ammunition (range 80/320)', 'loading', 'two-handed']],
		dart: [5, '1d4', 'piercing', 0.25, ['Finesse', 'thrown (range 20/60)']],
		shortbow: [2500, '1d6', 'piercing', 2, ['Ammunition (range 80/320)', 'two-handed']],
		battleaxe: [1000, '1d8', 'slashing', 4, ['Versatile (1d10)']],
		greatsword: [5000, '2d6', 'slashing', 6, ['Heavy', 'two-handed']],
		lance: [1000, '1d12', 'piercing', 6, ['Reach', 'special']],
		longsword: [1500, '1d8', 'slashing', 3, ['Versatile (1d10)']],
		rapier: [2500, '1d8', 'piercing', 2, ['Finesse']],
		scimitar: [2500, '1d6', 'slashing', 3, ['Finesse', 'light']],
		shortsword: [1000, '1d6', 'piercing', 2, ['Finesse', 'light']],
		whip: [200, '1d4', 'slashing', 3, ['Finesse', 'reach']],
		'crossbow-hand': [7500, '1d6', 'piercing', 3, ['Ammunition (range 30/120)', 'light', 'loading']],
		'crossbow-heavy': [5000, '1d10', 'piercing', 18, ['Ammunition (range 100/400)', 'heavy', 'loading', 'two-handed']],
		longbow: [5000, '1d8', 'piercing', 2, ['Ammunition (range 150/600)', 'heavy', 'two-handed']],
	};
	it.each(Object.entries(ref))('%s', (id, [cost, dmg, type, weight, props]) => {
		const w = by(srd.weapons, id);
		expect([w.costCp, w.damage, w.damageType, w.weight]).toEqual([cost, dmg, type, weight]);
		expect(w.properties.map((p) => p.toLowerCase())).toEqual(props.map((p) => p.toLowerCase()));
	});
	it('categories and counts: 10 simple melee, 4 simple ranged, 18 martial melee, 5 martial ranged', () => {
		const n = (c: string, r: string) => srd.weapons.filter((w) => w.category === c && w.reach === r).length;
		expect([n('simple', 'melee'), n('simple', 'ranged'), n('martial', 'melee'), n('martial', 'ranged')]).toEqual([10, 4, 18, 5]);
	});
	it('net has no damage, sling has no listed weight, blowgun deals 1', () => {
		expect(by(srd.weapons, 'net').damage).toBeNull();
		expect(by(srd.weapons, 'sling').weight).toBeNull();
		expect(by(srd.weapons, 'blowgun').damage).toBe('1');
	});
});

describe('armor vs the SRD armor table (typed from the PDF)', () => {
	// [cost cp, AC, dex rule, min STR, stealth disadvantage, weight]
	const ref: Record<string, [number, number, string, number | null, boolean, number]> = {
		padded: [500, 11, 'full', null, true, 8],
		leather: [1000, 11, 'full', null, false, 10],
		'studded-leather': [4500, 12, 'full', null, false, 13],
		hide: [1000, 12, 'max2', null, false, 12],
		'chain-shirt': [5000, 13, 'max2', null, false, 20],
		'scale-mail': [5000, 14, 'max2', null, true, 45],
		breastplate: [40000, 14, 'max2', null, false, 20],
		'half-plate': [75000, 15, 'max2', null, true, 40],
		'ring-mail': [3000, 14, 'none', null, true, 40],
		'chain-mail': [7500, 16, 'none', 13, true, 55],
		splint: [20000, 17, 'none', 15, true, 60],
		plate: [150000, 18, 'none', 15, true, 65],
	};
	it.each(Object.entries(ref))('%s', (id, [cost, ac, dex, str, stealth, weight]) => {
		const a = by(srd.armor, id);
		expect([a.costCp, a.baseAc, a.dex, a.minStr, a.stealthDisadvantage, a.weight]).toEqual([cost, ac, dex, str, stealth, weight]);
	});
	it('shield: 10 gp, +2 AC', () => {
		const s = by(srd.armor, 'shield');
		expect([s.costCp, s.acBonus]).toEqual([1000, 2]);
	});
});

describe('monsters vs printed stat blocks (typed from the PDF)', () => {
	// [AC value, HP avg, HP dice, speed, CR, abilities, [attack name, bonus, damage, type][]]
	const ref: Record<string, [number, number, string, string, string, number[], Array<[string, number, string, string]>]> = {
		goblin: [15, 7, '2d6', '30 ft.', '1/4', [8, 14, 10, 10, 8, 8], [['Scimitar', 4, '1d6+2', 'slashing'], ['Shortbow', 4, '1d6+2', 'piercing']]],
		guard: [16, 11, '2d8+2', '30 ft.', '1/8', [13, 12, 12, 10, 11, 10], [['Spear', 3, '1d6+1', 'piercing']]],
		thug: [11, 32, '5d8+10', '30 ft.', '1/2', [15, 11, 14, 10, 10, 11], [['Mace', 4, '1d6+2', 'bludgeoning'], ['Heavy Crossbow', 2, '1d10', 'piercing']]],
		cultist: [12, 9, '2d8', '30 ft.', '1/8', [11, 12, 10, 10, 11, 10], [['Scimitar', 3, '1d6+1', 'slashing']]],
		noble: [15, 9, '2d8', '30 ft.', '1/8', [11, 12, 11, 12, 14, 16], [['Rapier', 3, '1d8+1', 'piercing']]],
		commoner: [10, 4, '1d8', '30 ft.', '0', [10, 10, 10, 10, 10, 10], [['Club', 2, '1d4', 'bludgeoning']]],
		bandit: [12, 11, '2d8+2', '30 ft.', '1/8', [11, 12, 12, 10, 10, 10], [['Scimitar', 3, '1d6+1', 'slashing'], ['Light Crossbow', 3, '1d8+1', 'piercing']]],
		wolf: [13, 11, '2d8+2', '40 ft.', '1/4', [12, 15, 12, 3, 12, 6], []],
	};
	it.each(Object.entries(ref))('%s', (id, [ac, hp, dice, speed, cr, ab, atk]) => {
		const m = by(srd.monsters, id);
		expect([m.acValue, m.hpAvg, m.hpDice, m.speed, m.cr]).toEqual([ac, hp, dice, speed, cr]);
		expect(Object.values(m.abilities)).toEqual(ab);
		if (atk.length) expect(m.attacks.map((a) => [a.name, a.bonus, a.damage, a.damageType])).toEqual(atk);
	});
	it('Adult Blue Dragon: AC 19, 225 HP (18d12 + 108), CR 16, Bite +12 2d10+7', () => {
		const m = by(srd.monsters, 'adult-blue-dragon');
		expect([m.acValue, m.hpAvg, m.hpDice, m.cr, m.xp]).toEqual([19, 225, '18d12+108', '16', 15000]);
		expect(m.attacks.find((a) => a.name === 'Bite')).toMatchObject({ bonus: 12, damage: '2d10+7', damageType: 'piercing' });
		expect(m.immunities).toBe('lightning');
	});
});

describe('spells vs printed headers (typed from the PDF)', () => {
	// [level, school, casting time, range, components, material, duration, concentration]
	const ref: Record<string, [number, string, string, string, string, string | null, string, boolean]> = {
		'magic-missile': [1, 'evocation', '1 action', '120 feet', 'V, S', null, 'Instantaneous', false],
		fireball: [3, 'evocation', '1 action', '150 feet', 'V, S, M', 'a tiny ball of bat guano and sulfur', 'Instantaneous', false],
		'mage-armor': [1, 'abjuration', '1 action', 'Touch', 'V, S, M', 'a piece of cured leather', '8 hours', false],
		'cure-wounds': [1, 'evocation', '1 action', 'Touch', 'V, S', null, 'Instantaneous', false],
		shield: [1, 'abjuration', '1 reaction, which you take when you are hit by an attack or targeted by the magic missile spell', 'Self', 'V, S', null, '1 round', false],
	};
	it.each(Object.entries(ref))('%s', (id, [lv, school, ct, range, comp, mat, dur, conc]) => {
		const s = by(srd.spells, id);
		expect([s.level, s.school, s.castingTime, s.range, s.components, s.material, s.duration, s.concentration]).toEqual([lv, school, ct, range, comp, mat, dur, conc]);
		expect(s.text.length).toBeGreaterThan(30);
	});
	it('Magic Missile and Fireball class lists (Fireball: sorcerer, wizard)', () => {
		expect(by(srd.spells, 'magic-missile').classes.sort()).toEqual(['sorcerer', 'wizard']);
		expect(by(srd.spells, 'fireball').classes.sort()).toEqual(['sorcerer', 'wizard']);
	});
	it('Magic Missile "At Higher Levels" is split from the effect text', () => {
		const s = by(srd.spells, 'magic-missile');
		expect(s.higherLevels).toMatch(/one more dart for each slot level above 1st/);
		expect(s.text).not.toMatch(/At Higher Levels/);
	});
	it('every spell has the mandatory fields and concentration spells say so in the duration', () => {
		for (const s of srd.spells) {
			expect(s.level).toBeGreaterThanOrEqual(0);
			expect(s.level).toBeLessThanOrEqual(9);
			expect(s.castingTime, s.name).toBeTruthy();
			expect(s.duration, s.name).toBeTruthy();
			expect(s.concentration, s.name).toBe(/^Concentration/i.test(s.duration));
		}
		expect(srd.spells.filter((s) => s.level === 0).length).toBeGreaterThan(15);
	});
});

describe('curated rule tables vs the SRD', () => {
	const cls = (id: string) => by(srd.classes, id);
	it('class hit dice and saving throws', () => {
		const ref: Record<string, [number, string]> = { barbarian: [12, 'Strength, Constitution'], bard: [8, 'Dexterity, Charisma'], cleric: [8, 'Wisdom, Charisma'], druid: [8, 'Intelligence, Wisdom'], fighter: [10, 'Strength, Constitution'], monk: [8, 'Strength, Dexterity'], paladin: [10, 'Wisdom, Charisma'], ranger: [10, 'Strength, Dexterity'], rogue: [8, 'Dexterity, Intelligence'], sorcerer: [6, 'Constitution, Charisma'], warlock: [8, 'Wisdom, Charisma'], wizard: [6, 'Intelligence, Wisdom'] };
		for (const [id, [die, saves]] of Object.entries(ref)) {
			expect([cls(id).hitDie, cls(id).savingThrows], id).toEqual([die, saves]);
			const mine = CLASSES.find((c) => c.id === id);
			expect(mine?.hitDie, id).toBe(die);
			const names: Record<string, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
			expect(mine?.saves.map((s) => names[s]).join(', '), id).toBe(saves);
		}
	});
	it('class skill choices: number and list', () => {
		const SK: Record<string, string> = { acrobatics: 'Acrobatics', animal: 'Animal Handling', arcana: 'Arcana', athletics: 'Athletics', deception: 'Deception', history: 'History', insight: 'Insight', intimidation: 'Intimidation', investigation: 'Investigation', medicine: 'Medicine', nature: 'Nature', perception: 'Perception', performance: 'Performance', persuasion: 'Persuasion', religion: 'Religion', sleight: 'Sleight of Hand', stealth: 'Stealth', survival: 'Survival' };
		for (const c of CLASSES) {
			const txt = cls(c.id).skills ?? '';
			const m = /Choose (two|three|four|any three)/.exec(txt);
			const n = { two: 2, three: 3, four: 4, 'any three': 3 }[m?.[1] ?? ''] ?? -1;
			expect(c.skillChoices, c.id).toBe(n);
			if (c.skillList !== 'any') for (const sk of c.skillList) expect(txt, `${c.id}:${sk}`).toContain(SK[sk]);
		}
	});
	it('proficiency bonus by level matches every parsed class table', () => {
		for (const c of srd.classes.filter((x) => x.levels.length === 20)) for (const r of c.levels) expect(r.profBonus, `${c.id}${r.level}`).toBe(2 + Math.floor((r.level - 1) / 4));
	});
	it('spell slots (full casters) equal the Wizard, Cleric and Druid tables for all 20 levels', () => {
		for (const id of ['wizard', 'cleric', 'druid']) {
			for (const r of cls(id).levels) {
				const nums = r.cols.filter((x) => x !== '—').map(Number);
				const slots = nums.slice(1); // first column = cantrips known
				const expected = Object.values(spellSlotsFor('full', r.level));
				expect(slots, `${id} L${r.level}`).toEqual(expected);
			}
		}
	});
	it('spell slots (half casters) equal the Paladin table', () => {
		for (const r of cls('paladin').levels) {
			const slots = r.cols.filter((x) => x !== '—').map(Number);
			expect(slots, `paladin L${r.level}`).toEqual(Object.values(spellSlotsFor('half', r.level)));
		}
	});
	it('wizard cantrips known: 3 at 1, 4 at 4, 5 at 10', () => {
		const w = cls('wizard').levels;
		expect([w[0]?.cols[0], w[3]?.cols[0], w[9]?.cols[0]]).toEqual(['3', '4', '5']);
	});
	it('racial ability increases and speed match the SRD race sections', () => {
		const n = (s: string): number[] => [...s.matchAll(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score increases by (\d)/g)].map((m) => Number(m[2]));
		const ref: Record<string, { text: RegExp; speed: number | null }> = {
			dwarf: { text: /Constitution score increases by 2/, speed: 25 }, 'hill-dwarf': { text: /Wisdom score increases by 1/, speed: null },
			elf: { text: /Dexterity score increases by 2/, speed: 30 }, 'high-elf': { text: /Intelligence score increases by 1/, speed: null },
			halfling: { text: /Dexterity score increases by 2/, speed: 25 }, lightfoot: { text: /Charisma score increases by 1/, speed: null },
			human: { text: /ability scores each increase by 1/, speed: 30 }, dragonborn: { text: /Strength score increases by 2, and your Charisma score increases by 1/, speed: 30 },
			gnome: { text: /Intelligence score increases by 2/, speed: 25 }, 'rock-gnome': { text: /Constitution score increases by 1/, speed: null },
			'half-elf': { text: /Charisma score increases by 2, and two other ability scores of your choice increase by 1/, speed: 30 }, 'half-orc': { text: /Strength score increases by 2, and your Constitution score increases by 1/, speed: 30 },
			tiefling: { text: /Intelligence score increases by 1, and your Charisma score increases by 2/, speed: 30 },
		};
		for (const [id, r] of Object.entries(ref)) {
			const race = by(srd.races, id);
			expect(race.abilityText, id).toMatch(r.text);
			expect(race.speed, id).toBe(r.speed);
		}
		for (const mine of RACES.filter((x) => !x.parent)) {
			const text = by(srd.races, mine.id).abilityText ?? '';
			const bonus = Object.values(mine.bonus).sort();
			if (/each increase by 1/.test(text)) expect(bonus).toEqual([1, 1, 1, 1, 1, 1]);
			else expect(bonus, mine.id).toEqual([...n(text)].sort());
		}
		for (const mine of RACES.filter((x) => x.parent)) expect(Object.values(mine.bonus).sort(), mine.id).toEqual(n(by(srd.races, mine.id).abilityText ?? '').sort());
	});
	it('the only SRD background is Acolyte (Insight, Religion); the only feat is Grappler', () => {
		expect(srd.backgrounds.map((b) => b.id)).toEqual(['acolyte']);
		expect(srd.backgrounds[0]?.skills).toBe('Insight, Religion');
		expect(srd.feats.map((f) => f.id)).toEqual(['grappler']);
	});
});

describe('derived item tables', () => {
	it('every SRD weapon, armor and gear item is available to the app with its SRD id', () => {
		expect(getSrd()).not.toBeNull();
		for (const w of srd.weapons) expect(ITEM_TYPES[w.id]?.costCp, w.id).toBe(w.costCp);
		for (const a of srd.armor) expect(ITEM_TYPES[a.id]?.kind, a.id).toMatch(/armor|shield/);
		expect(ITEM_TYPES['potion-of-healing']?.costCp).toBe(5000);
	});
	it('Russian names are display-only, attached by id, and never replace the English SRD name', () => {
		expect(ITEM_TYPES.dagger).toMatchObject({ name: 'Dagger', ru: 'Кинжал' });
		for (const id of Object.keys(RU_NAMES)) expect(ITEM_TYPES[id], id).toBeDefined();
	});
	it('creature templates point at real SRD monsters', () => {
		for (const t of CREATURE_TEMPLATES) expect(srd.monsters.some((m) => m.id === t.monsterId), t.id).toBe(true);
	});
});

describe('class proficiencies and racial traits vs the SRD text', () => {
	const cls = (id: string) => by(srd.classes, id);
	const termOf = (id: string): string => {
		const n = ITEM_TYPES[id]?.name.toLowerCase() ?? id;
		return n.replace(/^crossbow, (\w+)$/, '$1 crossbow');
	};
	const stem = (w: string): string => w.replace(/s$/, '');
	it('weapon proficiencies equal the SRD "Weapons:" line of every class', () => {
		for (const c of CLASSES) {
			const srdLine = (cls(c.id).weapons ?? '').toLowerCase();
			const expectSimple = /simple weapons/.test(srdLine);
			const expectMartial = /martial weapons/.test(srdLine);
			expect(c.weaponProf.includes('simple'), `${c.id} simple`).toBe(expectSimple);
			expect(c.weaponProf.includes('martial'), `${c.id} martial`).toBe(expectMartial);
			const named = c.weaponProf.filter((x) => x !== 'simple' && x !== 'martial').map((x) => stem(termOf(x)));
			const srdNamed = srdLine.replace(/simple weapons,?|martial weapons,?/g, '').split(',').map((x) => stem(x.trim().replace(/^and /, ''))).filter(Boolean);
			expect(named.sort(), c.id).toEqual(srdNamed.sort());
		}
	});
	it('armor proficiencies equal the SRD "Armor:" line', () => {
		for (const c of CLASSES) {
			const t = (cls(c.id).armor ?? '').toLowerCase();
			expect(c.armorProf.includes('light'), `${c.id} light`).toBe(/light armor|all armor/.test(t));
			expect(c.armorProf.includes('medium'), `${c.id} medium`).toBe(/medium armor|all armor/.test(t));
			expect(c.armorProf.includes('heavy'), `${c.id} heavy`).toBe(/heavy armor|all armor/.test(t));
			expect(c.armorProf.includes('shield'), `${c.id} shield`).toBe(/shield/.test(t));
		}
	});
	it('casting class types: full (bard, cleric, druid, sorcerer, wizard), half (paladin, ranger), pact (warlock)', () => {
		const m = (id: string) => CLASSES.find((c) => c.id === id)?.caster;
		expect(['bard', 'cleric', 'druid', 'sorcerer', 'wizard'].map(m)).toEqual(Array(5).fill('full'));
		expect(['paladin', 'ranger'].map(m)).toEqual(['half', 'half']);
		expect(['barbarian', 'fighter', 'monk', 'rogue', 'warlock'].map(m)).toEqual(Array(5).fill('none'));
		expect(cls('wizard').text).toMatch(/Intelligence is your spellcasting ability/);
		expect(cls('paladin').text).toMatch(/Charisma is your spellcasting ability/);
		expect(cls('ranger').text).toMatch(/Wisdom is your spellcasting ability/);
		expect(cls('warlock').text).toMatch(/Charisma is your spellcasting ability/);
	});
	it('subclass levels: sorcerer/cleric/warlock 1, druid/wizard 2, others 3', () => {
		const lvl = (id: string) => CLASSES.find((c) => c.id === id)?.subclassLevel;
		expect(['cleric', 'sorcerer', 'warlock'].map(lvl)).toEqual([1, 1, 1]);
		expect(['druid', 'wizard'].map(lvl)).toEqual([2, 2]);
		expect(['barbarian', 'bard', 'fighter', 'monk', 'paladin', 'ranger', 'rogue'].map(lvl)).toEqual(Array(7).fill(3));
		const first: Record<string, [number, string]> = { cleric: [1, 'Divine Domain'], warlock: [1, 'Otherworldly Patron'], druid: [2, 'Druid Circle'], wizard: [2, 'Arcane Tradition'], barbarian: [3, 'Primal Path'], bard: [3, 'Bard College'], fighter: [3, 'Martial Archetype'], monk: [3, 'Monastic Tradition'], paladin: [3, 'Sacred Oath'], rogue: [3, 'Roguish Archetype'] };
		expect(cls('sorcerer').text).toMatch(/Sorcerous Origin Choose a sorcerous origin[\s\S]{0,160}when you choose it at 1st level/); // table row wraps in the PDF
		for (const [id, [l, name]] of Object.entries(first)) {
			const row = cls(id).levels[l - 1];
			const cells = (r?: { features: string[]; cols: string[] }): string => [...(r?.features ?? []), ...(r?.cols ?? [])].join(' ');
			expect(cells(row), `${id} L${l} ${name}`).toContain(name);
			expect(CLASSES.find((c) => c.id === id)?.subclassLevel, id).toBe(l);
			if (l > 1) expect(cells(cls(id).levels[l - 2]), `${id} before L${l}`).not.toContain(name);
		}
	});
	it('SRD subclasses: exactly one per class, found as headings in the PDF', () => {
		expect(srd.subclasses.map((s) => s.name).sort()).toEqual(['Champion', 'Circle of the Land', 'College of Lore', 'Draconic Bloodline', 'Hunter', 'Life Domain', 'Oath of Devotion', 'Path of the Berserker', 'School of Evocation', 'The Fiend', 'Thief', 'Way of the Open Hand']);
	});
	it('racial traits backed by SRD text', () => {
		const race = (id: string) => by(srd.races, id).text ?? '';
		expect(race('elf')).toMatch(/proficiency in the Perception skill/);
		expect(race('high-elf')).toMatch(/longsword, shortsword, shortbow, and longbow/);
		expect(race('high-elf')).toMatch(/one cantrip of your choice from the wizard spell list/);
		expect(race('hill-dwarf')).toMatch(/hit point maximum increases by 1, and it increases by 1 every time you gain a level/);
		expect(race('dwarf')).toMatch(/battleaxe, handaxe, light hammer, and warhammer/);
		expect(race('half-orc')).toMatch(/proficiency in the Intimidation skill/);
		expect(race('half-elf')).toMatch(/proficiency in two skills of your choice/);
	});
});
void RACE_TRAITS;
