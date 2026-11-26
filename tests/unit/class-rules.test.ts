// Class resource / spellcasting rules verified against the SRD text and tables (independent of the implementation).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { arcaneRecoveryBudget, arcaneRecoveryError, classResources, pactMagic, preparedSpellCount, wizardSpellbookSize } from '../../src/domain/class-rules';
import type { SrdData } from '../../src/domain/srd';

const srd = JSON.parse(readFileSync('data/srd51/srd51.json', 'utf8')) as SrdData;
const text = (id: string): string => srd.classes.find((c) => c.id === id)?.text ?? '';
const A = { str: 10, dex: 10, con: 10, int: 16, wis: 14, cha: 12 };
const res = (cls: string, lv: number, a = A) => Object.fromEntries(classResources(cls, lv, a).map((r) => [r.id, r]));

describe('SRD text backs each formula', () => {
	it('wizard: arcane recovery, prepared spells, spellbook', () => {
		const w = text('wizard');
		expect(w).toMatch(/half your wizard level \(rounded up\)/);
		expect(w).toMatch(/none of the slots can be 6th level or higher/);
		expect(w).toMatch(/Intelligence modifier \+ your wizard level/);
		expect(w).toMatch(/finish a short rest/);
		expect(w).toMatch(/once per day/i);
		expect(w).toMatch(/spellbook containing six 1st- ?level wizard spells/);
		expect(w).toMatch(/add two wizard spells of your choice/);
	});
	it('cleric / druid / paladin prepared counts', () => {
		expect(text('cleric')).toMatch(/Wisdom modifier \+ your cleric level/);
		expect(text('druid')).toMatch(/Wisdom modifier \+ your druid level/);
		expect(text('paladin')).toMatch(/Charisma modifier \+ half your paladin level/);
	});
	it('fighter, monk, paladin, sorcerer, bard, druid formulas', () => {
		expect(text('fighter')).toMatch(/1d10 \+ your fighter level/);
		expect(text('fighter')).toMatch(/short or long rest/);
		expect(text('fighter')).toMatch(/Indomitable \(three uses\)/);
		expect(text('paladin')).toMatch(/paladin level × 5/);
		expect(text('monk')).toMatch(/number of ki points/);
		expect(text('sorcerer')).toMatch(/sorcery points/);
		expect(text('bard')).toMatch(/Charisma modifier \(a minimum of once\)/);
		expect(text('bard')).toMatch(/Font of Inspiration[\s\S]*short or long rest/);
		expect(text('druid')).toMatch(/twice\.[\s\S]*short or long rest/);
	});
});

describe('class resources', () => {
	it('barbarian rages come from the SRD table: 2 at level 1, 3 at 3, 6 at 12, unlimited at 20', () => {
		expect(res('barbarian', 1).rage?.max).toBe(2);
		expect(res('barbarian', 3).rage?.max).toBe(3);
		expect(res('barbarian', 12).rage?.max).toBe(5);
		expect(res('barbarian', 20).rage?.max).toBeNull();
		expect(res('barbarian', 5).rage?.recovery).toBe('long');
	});
	it('fighter: second wind (short), action surge 1→2 at 17, indomitable from 9 (long)', () => {
		expect(res('fighter', 1)['second-wind']).toMatchObject({ max: 1, recovery: 'short' });
		expect(res('fighter', 1)['action-surge']).toBeUndefined();
		expect(res('fighter', 2)['action-surge']?.max).toBe(1);
		expect(res('fighter', 17)['action-surge']?.max).toBe(2);
		expect(res('fighter', 8).indomitable).toBeUndefined();
		expect([res('fighter', 9).indomitable?.max, res('fighter', 13).indomitable?.max, res('fighter', 17).indomitable?.max]).toEqual([1, 2, 3]);
		expect(res('fighter', 9).indomitable?.recovery).toBe('long');
	});
	it('cleric channel divinity 1/2/3 per rest; ki = level from 2; sorcery points = level from 2; lay on hands 5×level', () => {
		expect([res('cleric', 1)['channel-divinity']?.max, res('cleric', 2)['channel-divinity']?.max, res('cleric', 6)['channel-divinity']?.max, res('cleric', 18)['channel-divinity']?.max]).toEqual([undefined, 1, 2, 3]);
		expect([res('monk', 1).ki?.max, res('monk', 5).ki?.max]).toEqual([undefined, 5]);
		expect(res('sorcerer', 7)['sorcery-points']?.max).toBe(7);
		expect(res('paladin', 5)['lay-on-hands']?.max).toBe(25);
		expect(res('paladin', 1)['divine-sense']?.max).toBe(2); // CHA +1 → 1 + 1
	});
	it('monk ki equals the SRD table column at every level ≥ 2', () => {
		const monk = srd.classes.find((c) => c.id === 'monk');
		for (const r of monk?.levels ?? []) if (r.level >= 2) expect(r.cols[1], `L${r.level}`).toBe(String(r.level));
	});
	it('bard inspiration = CHA mod (min 1); short-rest recovery from level 5', () => {
		expect(res('bard', 4, { ...A, cha: 16 })['bardic-inspiration']).toMatchObject({ max: 3, recovery: 'long' });
		expect(res('bard', 5, { ...A, cha: 8 })['bardic-inspiration']).toMatchObject({ max: 1, recovery: 'short' });
	});
	it('wizard has a manual-recovery arcane recovery marker, never auto-restored by rest rules', () => {
		expect(res('wizard', 5)['arcane-recovery']).toMatchObject({ max: 1, recovery: 'manual' });
		expect(res('rogue', 5)).toEqual({});
	});
	it('warlock pact magic from the SRD table: 1 slot of 1st at L1, 2 slots at L2, 2 slots of 5th at L11, 4 slots at L17', () => {
		expect([pactMagic(1), pactMagic(2), pactMagic(5), pactMagic(11), pactMagic(17)]).toEqual([{ slots: 1, slotLevel: 1 }, { slots: 2, slotLevel: 1 }, { slots: 2, slotLevel: 3 }, { slots: 3, slotLevel: 5 }, { slots: 4, slotLevel: 5 }]);
	});
});

describe('spellcasting numbers', () => {
	it('prepared spells: wizard INT+level, cleric/druid WIS+level, paladin CHA+half level; others null', () => {
		expect(preparedSpellCount('wizard', 5, A)).toBe(8);
		expect(preparedSpellCount('cleric', 3, A)).toBe(5);
		expect(preparedSpellCount('paladin', 5, A)).toBe(3);
		expect(preparedSpellCount('paladin', 1, { ...A, cha: 8 })).toBe(1);
		expect(preparedSpellCount('sorcerer', 5, A)).toBeNull();
	});
	it('wizard spellbook: 6 at level 1, 14 at level 5', () => {
		expect([wizardSpellbookSize(1), wizardSpellbookSize(5)]).toEqual([6, 14]);
	});
	it('arcane recovery: budget ceil(level/2), no slot above 5th', () => {
		expect([1, 2, 5, 6, 20].map(arcaneRecoveryBudget)).toEqual([1, 1, 3, 3, 10]);
		expect(arcaneRecoveryError([3], 5)).toBeNull();
		expect(arcaneRecoveryError([2, 1], 5)).toBeNull();
		expect(arcaneRecoveryError([3, 1], 5)).toMatch(/больше допустимого 3/);
		expect(arcaneRecoveryError([6], 20)).toMatch(/6 уровня и выше/);
	});
});

describe('unarmored AC features and draconic resilience (SRD text-backed)', () => {
	it('text', () => {
		expect(text('barbarian')).toMatch(/Unarmored Defense[\s\S]{0,200}10 \+ your Dexterity modifier \+ your Constitution modifier/);
		expect(text('monk')).toMatch(/Unarmored Defense[\s\S]{0,200}10 \+ your Dexterity modifier \+ your Wisdom modifier/);
		const dr = srd.subclasses.find((s) => s.id === 'draconic-bloodline')?.text ?? '';
		expect(dr).toMatch(/When you aren.t wearing armor, your AC equals 13 \+ your Dexterity modifier/);
		expect(dr).toMatch(/hit point maximum increases by 1 and increases by 1 again whenever you gain a level/);
	});
	it('values: barbarian 10+DEX+CON, monk 10+DEX+WIS only without shield, draconic 13+DEX, armor overrides', async () => {
		const { armorClassFor } = await import('../../src/domain/builder');
		const { ITEM_TYPES } = await import('../../src/domain/srd-data');
		const a = { str: 10, dex: 14, con: 16, int: 8, wis: 14, cha: 10 };
		expect(armorClassFor(a, [], { classId: 'barbarian' })).toBe(10 + 2 + 3);
		expect(armorClassFor(a, [ITEM_TYPES.shield!], { classId: 'barbarian' })).toBe(17);
		expect(armorClassFor(a, [], { classId: 'monk' })).toBe(10 + 2 + 2);
		expect(armorClassFor(a, [ITEM_TYPES.shield!], { classId: 'monk' })).toBe(12 + 2);
		expect(armorClassFor(a, [], { classId: 'sorcerer', subclass: 'Draconic Bloodline' })).toBe(15);
		expect(armorClassFor(a, [], { classId: 'sorcerer', subclass: 'Wild' })).toBe(12);
		expect(armorClassFor(a, [ITEM_TYPES['chain-mail']!], { classId: 'barbarian' })).toBe(16);
	});
});
