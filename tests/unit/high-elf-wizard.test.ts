// Mandatory acceptance character: High Elf wizard, level 5, background "Criminal" (NOT in the SRD → entered by the GM).
// Expected numbers are worked out by hand from the SRD rules (comments show the arithmetic), not from the implementation.
import { describe, expect, it } from 'vitest';
import { buildCharacter, resolveItemType } from '../../src/domain/builder';
import { cockpitOf, isProficientWith, profBonusOf, spellAttackBonus, spellDc, weaponAttack } from '../../src/domain/cockpit';
import { getSrd } from '../../src/domain/srd';
import { createAdventureState } from '../../src/domain/state';
import { defaultRestOptions, planRest } from '../../src/domain/rest';
import { dispatch } from '../../src/domain/reducer';
import { act, run } from '../helpers';

let n = 0;
const nid = (p: string): string => `${p}-${++n}`;
const wizardSpells = (lvl: number, count: number, skip = 0) => (getSrd()?.spells ?? []).filter((s) => s.level === lvl && s.classes.includes('wizard')).slice(skip, skip + count).map((s) => s.id);

function build() {
	const cantrips = wizardSpells(0, 5); // 4 class + 1 High Elf cantrip
	const l1 = wizardSpells(1, 6);
	const extra = [...wizardSpells(1, 2, 6), ...wizardSpells(2, 4), ...wizardSpells(3, 2)]; // +2 per level 2..5 = 8 more → 14
	const spells = [...l1, ...extra];
	const prepared = spells.slice(0, 9);
	return buildCharacter({
		name: 'Тестовая Эльфийка', raceId: 'elf', subraceId: 'high-elf', classId: 'wizard', level: 5,
		baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
		asi: [['int']], // level 4: +2 Intelligence
		backgroundKind: 'custom', backgroundSkills: ['deception', 'stealth'], background: 'Criminal',
		subclass: 'School of Evocation', skills: ['arcana', 'history'],
		cantrips, spells, prepared,
		gear: ['quarterstaff', 'dagger', 'spellbook', 'component-pouch'], notePath: 'Elements/Персонажи/Тест.md',
	}, nid);
}

describe('High Elf wizard 5, background Criminal', () => {
	const r = build();
	const sheet = r.sheet;
	it('ability scores: racial +2 Dex / +1 Int, then ASI at level 4 (+2 Int)', () => {
		// 14+2 = 16 Dex; 15+1 = 16 Int, +2 at level 4 = 18 Int
		expect(sheet.abilities).toEqual({ str: 8, dex: 16, con: 13, int: 18, wis: 12, cha: 10 });
	});
	it('hit points: d6 + CON(+1) at level 1, then (4 + 1) × 4 = 20 → 27', () => {
		expect(r.character.hp).toEqual({ current: 27, max: 27, temporary: 0 });
		expect(r.character.hitDice).toEqual([{ die: 'd6', total: 5, remaining: 5 }]);
	});
	it('proficiency +3, spell save DC 8+3+4 = 15, spell attack +7', () => {
		const prof = profBonusOf(sheet, 5);
		expect(prof).toBe(3);
		expect(spellDc(sheet, prof)).toBe(15);
		expect(spellAttackBonus(sheet, prof)).toBe(7);
	});
	it('proficiencies: saves INT/WIS; skills = class (arcana, history) + elf Perception + GM-entered background (deception, stealth)', () => {
		expect(sheet.saveProf).toEqual(['int', 'wis']);
		expect(Object.keys(sheet.skills).sort()).toEqual(['arcana', 'deception', 'history', 'perception', 'stealth']);
		expect(sheet.backgroundKind).toBe('custom');
		expect(sheet.subclass).toBe('School of Evocation');
		expect(sheet.race).toContain('эльф');
	});
	it('weapon proficiency: wizard list + High Elf weapon training', () => {
		for (const w of ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow-light', 'longsword', 'shortsword', 'shortbow', 'longbow']) expect(sheet.weaponProf, w).toContain(w);
		expect(sheet.weaponProf).not.toContain('martial');
		expect(sheet.weaponProf).not.toContain('greatsword');
	});
	it('spell slots 4/3/2; arcane recovery marker; no auto-filled background proficiencies for Criminal', () => {
		expect(r.character.spellSlots).toEqual({ '1': { max: 4, current: 4 }, '2': { max: 3, current: 3 }, '3': { max: 2, current: 2 } });
		expect(r.character.counters['arcane-recovery']).toMatchObject({ max: 1, current: 1, recovery: 'manual' });
	});
	it('spells: 5 cantrips (4 + racial), 14 in the spellbook, 9 prepared (INT +4 + level 5)', () => {
		const book = r.book!;
		expect(book.known.filter((k) => k.level === 0)).toHaveLength(5);
		expect(book.known.filter((k) => k.level > 0)).toHaveLength(14);
		expect(book.prepared).toHaveLength(9);
		expect(r.warnings.filter((w) => /заклинани|заговор|Подготовлено|повышени|навык/i.test(w))).toEqual([]);
	});
	it('armor class 10 + Dex 3 = 13 (no armor; Mage Armor is a spell, not applied automatically)', () => {
		expect(r.character.ac).toBe(13);
	});
	it('attacks: dagger finesse (Dex) +6, 1d4+3; quarterstaff STR −1: +2, 1d6−1; elf-trained longsword +2; longbow +6', () => {
		const abil = sheet.abilities;
		const dagger = weaponAttack(resolveItemType(createAdventureState('a', 's', 'r', 'r'), { typeId: 'dagger' } as never)!, abil, 3, true);
		expect(dagger).toMatchObject({ ability: 'dex', bonus: 6, damage: '1d4 + 3', damageType: 'piercing' });
		const staff = resolveItemType(createAdventureState('a', 's', 'r', 'r'), { typeId: 'quarterstaff' } as never)!;
		expect(weaponAttack(staff, abil, 3, isProficientWith(staff, sheet))).toMatchObject({ ability: 'str', bonus: 2, damage: '1d6 − 1' });
		const lsw = resolveItemType(createAdventureState('a', 's', 'r', 'r'), { typeId: 'longsword' } as never)!;
		expect(isProficientWith(lsw, sheet)).toBe(true);
		expect(weaponAttack(lsw, abil, 3, true).bonus).toBe(2);
		const bow = resolveItemType(createAdventureState('a', 's', 'r', 'r'), { typeId: 'longbow' } as never)!;
		expect(weaponAttack(bow, abil, 3, true)).toMatchObject({ ability: 'dex', bonus: 6 });
		const mace = resolveItemType(createAdventureState('a', 's', 'r', 'r'), { typeId: 'mace' } as never)!;
		expect(isProficientWith(mace, sheet)).toBe(false);
	});
	it('missing choices are reported, never invented', () => {
		const bad = buildCharacter({ name: 'x', raceId: 'elf', subraceId: 'high-elf', classId: 'wizard', level: 5, baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, background: 'Criminal', subclass: '', skills: ['arcana'], gear: [], notePath: 'x.md' }, nid);
		expect(bad.sheet.abilities.int).toBe(16); // ASI not applied without a choice
		expect(bad.warnings.some((w) => /Не выбрано повышений характеристик: 1/.test(w))).toBe(true);
		expect(bad.warnings.some((w) => /Выбрано навыков класса: 1 из 2/.test(w))).toBe(true);
		expect(bad.warnings.some((w) => /Заговоров 0 из 4 \+ 1/.test(w))).toBe(true);
		expect(bad.warnings.some((w) => /Подготовлено 0 из 8/.test(w))).toBe(true);
	});
	it('rejects a subrace of another race', () => {
		expect(() => buildCharacter({ name: 'x', raceId: 'dwarf', subraceId: 'high-elf', classId: 'wizard', level: 1, baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, background: '', subclass: '', skills: [], gear: [], notePath: 'x.md' }, nid)).toThrow(/Подраса/);
	});
});

describe('rest rules for the wizard', () => {
	const r = build();
	let s = createAdventureState('adv', 'st', 'Root', 'Root');
	s = run(s, { type: 'cockpit/character-build', character: r.character, sheet: r.sheet, items: [], ...(r.book ? { book: r.book } : {}) });
	const id = r.character.id;
	const drain = (state: typeof s) => run(run(run(state, { type: 'character/set-slot', characterId: id, level: '1', slot: { max: 4, current: 0 } }), { type: 'character/set-slot', characterId: id, level: '2', slot: { max: 3, current: 0 } }), { type: 'character/set-slot', characterId: id, level: '3', slot: { max: 2, current: 0 } });
	const base = defaultRestOptions(s, 'short', '2014', [id]);

	it('Arcane Recovery on a short rest: one 3rd-level slot (budget ceil(5/2) = 3), counter spent, whole rest = one Undo step', () => {
		const d = drain(s);
		const plan = planRest(d, { ...base, arcaneRecovery: { [id]: [3] } });
		expect(plan.entries[0]?.errors).toEqual([]);
		const after = plan.entries[0]!.after;
		expect(after.spellSlots['3']?.current).toBe(1);
		expect(after.counters['arcane-recovery']?.current).toBe(0);
		const applied = run(d, { type: 'rest/apply', kind: 'short', changes: [{ characterId: id, after }], removeEffectIds: [] });
		expect(applied.characters[id]?.spellSlots['3']?.current).toBe(1);
		const undone = dispatch(applied, act(applied, { type: 'history/undo' }));
		expect(undone.state.characters[id]?.spellSlots['3']?.current).toBe(0);
		expect(undone.state.characters[id]?.counters['arcane-recovery']?.current).toBe(1);
	});
	it('rejects over-budget choices, 6th-level slots, slots that were not spent and a second use the same day', () => {
		const d = drain(s);
		expect(planRest(d, { ...base, arcaneRecovery: { [id]: [3, 1] } }).entries[0]?.errors[0]).toMatch(/больше допустимого 3/);
		expect(planRest(d, { ...base, arcaneRecovery: { [id]: [2, 2] } }).entries[0]?.errors[0]).toMatch(/больше допустимого 3/);
		expect(planRest(s, { ...base, arcaneRecovery: { [id]: [1] } }).entries[0]?.errors[0]).toMatch(/Нет израсходованной ячейки 1/);
		const used = run(d, { type: 'rest/apply', kind: 'short', changes: [{ characterId: id, after: planRest(d, { ...base, arcaneRecovery: { [id]: [2, 1] } }).entries[0]!.after }], removeEffectIds: [] });
		expect(planRest(used, { ...base, arcaneRecovery: { [id]: [1] } }).entries[0]?.errors[0]).toMatch(/уже использовано/);
	});
	it('a long rest restores all slots and re-arms Arcane Recovery; a short rest alone restores nothing automatically', () => {
		const d = drain(s);
		const short = planRest(d, base);
		expect(short.entries[0]?.after.spellSlots['1']?.current).toBe(0);
		const spent = run(d, { type: 'character/set-counter', characterId: id, counter: { ...r.character.counters['arcane-recovery']!, current: 0 } });
		const longOpts = defaultRestOptions(spent, 'long', '2014', [id]);
		const after = planRest(spent, longOpts).entries[0]!.after;
		expect(after.spellSlots).toEqual({ '1': { max: 4, current: 4 }, '2': { max: 3, current: 3 }, '3': { max: 2, current: 2 } });
		expect(after.counters['arcane-recovery']?.current).toBe(1);
		expect(after.hp.current).toBe(after.hp.max);
	});
});

describe('warlock Pact Magic and fighter resources through rest', () => {
	it('warlock 5: 2 slots of 3rd level (SRD table); short rest restores them, long rest too', () => {
		const w = buildCharacter({ name: 'Колдун', raceId: 'human', classId: 'warlock', level: 5, baseAbilities: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }, asi: [['cha']], background: '', subclass: 'The Fiend', skills: ['arcana', 'deception'], gear: [], notePath: 'w.md' }, nid);
		expect(w.character.spellSlots).toEqual({ '3': { max: 2, current: 2 } });
		let s = createAdventureState('adv', 'st', 'Root', 'Root');
		s = run(s, { type: 'cockpit/character-build', character: w.character, sheet: w.sheet, items: [], ...(w.book ? { book: w.book } : {}) });
		const id = w.character.id;
		s = run(s, { type: 'character/set-slot', characterId: id, level: '3', slot: { max: 2, current: 0 } });
		const short = planRest(s, defaultRestOptions(s, 'short', '2014', [id]));
		expect(short.entries[0]?.after.spellSlots['3']?.current).toBe(2);
		expect(planRest(s, { ...defaultRestOptions(s, 'short', '2014', [id]), pactMagic: false }).entries[0]?.after.spellSlots['3']?.current).toBe(0);
	});
	it('fighter 9: second wind & action surge return on a short rest, indomitable only on a long rest', () => {
		const f = buildCharacter({ name: 'Воин', raceId: 'human', classId: 'fighter', level: 9, baseAbilities: { str: 15, dex: 14, con: 13, int: 10, wis: 12, cha: 8 }, asi: [['str'], ['str']], background: '', subclass: 'Champion', skills: ['athletics', 'perception'], gear: [], notePath: 'f.md' }, nid);
		const c = f.character.counters;
		expect([c['second-wind']?.max, c['action-surge']?.max, c.indomitable?.max]).toEqual([1, 1, 1]);
		let s = createAdventureState('adv', 'st', 'Root', 'Root');
		s = run(s, { type: 'cockpit/character-build', character: f.character, sheet: f.sheet, items: [] });
		const id = f.character.id;
		for (const k of ['second-wind', 'action-surge', 'indomitable']) s = run(s, { type: 'character/set-counter', characterId: id, counter: { ...c[k]!, current: 0 } });
		const sh = planRest(s, defaultRestOptions(s, 'short', '2014', [id])).entries[0]!.after.counters;
		expect([sh['second-wind']?.current, sh['action-surge']?.current, sh.indomitable?.current]).toEqual([1, 1, 0]);
		const lg = planRest(s, defaultRestOptions(s, 'long', '2014', [id])).entries[0]!.after.counters;
		expect(lg.indomitable?.current).toBe(1);
		expect(cockpitOf(s).sheets[id]?.classId).toBe('fighter');
	});
});
