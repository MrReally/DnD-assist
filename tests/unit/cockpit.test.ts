import { describe, expect, it } from 'vitest';
import { armorClassFor, buildCharacter, levelUp, findTemplate, findWeapon, pointBuyCost, quickNpc, resolveItemType } from '../../src/domain/builder';
import { abilityMod, cockpitOf, emptySheet, formatCost, isProficientWith, profByLevel, spellDc, weaponAttack, type ItemInstance } from '../../src/domain/cockpit';
import { ITEM_TYPES, spellSlotsFor } from '../../src/domain/srd-data';
import { createAdventureState, emptyCharacter } from '../../src/domain/state';
import { dispatch } from '../../src/domain/reducer';
import { act, run, tryRun } from '../helpers';

let n = 0;
const nid = (p: string): string => `${p}-${++n}`;
const base = () => {
	let s = createAdventureState('adv', 'st', 'Root', 'Root');
	s = run(s, { type: 'character/upsert', character: { ...emptyCharacter('pc1', 'Алекс', 'a.md'), hp: { current: 10, max: 20, temporary: 0 }, spellSlots: { '1': { current: 2, max: 2 } } } });
	s = run(s, { type: 'character/upsert', character: emptyCharacter('pc2', 'Мира', 'm.md') });
	return s;
};
const item = (over: Partial<ItemInstance> = {}): ItemInstance => ({ id: 'i1', typeId: 'dagger', name: 'Кинжал', ownerKind: 'character', ownerId: 'pc1', containerId: null, qty: 1, equipped: false, magicBonus: 0, note: '', ...over });

describe('rules', () => {
	it('modifiers and proficiency', () => {
		expect([1, 8, 9, 10, 11, 20].map(abilityMod)).toEqual([-5, -1, -1, 0, 0, 5]);
		expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(profByLevel)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
	});
	it('dagger attack: finesse picks the better ability, proficiency and magic add to hit', () => {
		const dagger = ITEM_TYPES.dagger!;
		const a = weaponAttack(dagger, { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }, 2, true, 0);
		expect(a).toMatchObject({ bonus: 5, damage: '1d4 + 3', damageType: 'piercing', ability: 'dex' });
		expect(a.how.at(-1)).toBe('= +5 к атаке');
		expect(weaponAttack(dagger, { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, 2, false, 1)).toMatchObject({ bonus: 4, ability: 'str', damage: '1d4 + 4' });
	});
	it('ranged uses DEX, melee non-finesse uses STR even when DEX is higher', () => {
		const abil = { str: 8, dex: 18, con: 10, int: 10, wis: 10, cha: 10 };
		expect(weaponAttack(ITEM_TYPES.longbow!, abil, 2, true).ability).toBe('dex');
		expect(weaponAttack(ITEM_TYPES.mace!, abil, 2, true)).toMatchObject({ ability: 'str', bonus: 1, damage: '1d6 − 1' });
	});
	it('weapon proficiency by category or by name', () => {
		const sh = { ...emptySheet(), weaponProf: ['simple', 'rapier'] };
		expect(isProficientWith(ITEM_TYPES.dagger!, sh)).toBe(true);
		expect(isProficientWith(ITEM_TYPES.rapier!, sh)).toBe(true);
		expect(isProficientWith(ITEM_TYPES.longsword!, sh)).toBe(false);
	});
	it('spell DC', () => {
		expect(spellDc({ ...emptySheet(), castAbility: 'int', abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 } }, 3)).toBe(14);
		expect(spellDc(emptySheet(), 2)).toBeNull();
	});
	it('prices format in coins; SRD dagger costs 2 gp and weighs 1 lb', () => {
		expect(formatCost(ITEM_TYPES.dagger!.costCp)).toBe('2 зм');
		expect(formatCost(5)).toBe('5 мм');
		expect(formatCost(20)).toBe('2 см');
		expect(ITEM_TYPES.dagger!.weight).toBe(1);
	});
	it('spell slot table (PHB)', () => {
		expect(spellSlotsFor('full', 1)).toEqual({ '1': 2 });
		expect(spellSlotsFor('full', 5)).toEqual({ '1': 4, '2': 3, '3': 2 });
		expect(spellSlotsFor('full', 20)).toEqual({ '1': 4, '2': 3, '3': 3, '4': 3, '5': 3, '6': 2, '7': 2, '8': 1, '9': 1 });
		expect(spellSlotsFor('half', 1)).toEqual({});
		expect(spellSlotsFor('half', 5)).toEqual({ '1': 4, '2': 2 });
		expect(spellSlotsFor('none', 10)).toEqual({});
	});
	it('armor class: leather + dex, chain mail ignores dex, shield +2', () => {
		const a = { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 };
		expect(armorClassFor(a, [])).toBe(13);
		expect(armorClassFor(a, [ITEM_TYPES.leather!])).toBe(14);
		expect(armorClassFor(a, [ITEM_TYPES['chain-mail']!, ITEM_TYPES.shield!])).toBe(18);
		expect(armorClassFor(a, [ITEM_TYPES['half-plate']!])).toBe(17);
	});
	it('point buy', () => {
		expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
		expect(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBeNull();
	});
});

describe('cockpit reducer', () => {
	it('upserts an item and Undo/Redo restore it', () => {
		let s = run(base(), { type: 'cockpit/item-upsert', item: item() });
		expect(cockpitOf(s).items.i1?.name).toBe('Кинжал');
		const u = dispatch(s, act(s, { type: 'history/undo' }));
		expect(cockpitOf(u.state).items.i1).toBeUndefined();
		const r = dispatch(u.state, act(u.state, { type: 'history/redo' }));
		expect(cockpitOf(r.state).items.i1?.qty).toBe(1);
		s = r.state;
	});
	it('rejects items for unknown owners, bad quantities and cross-owner containers', () => {
		const s = base();
		expect(tryRun(s, { type: 'cockpit/item-upsert', item: item({ ownerId: 'nobody' }) }).error).toMatch(/Владелец/);
		expect(tryRun(s, { type: 'cockpit/item-upsert', item: item({ qty: -1 }) }).error).toMatch(/количество/);
		const s2 = run(s, { type: 'cockpit/item-upsert', item: item({ id: 'bag', typeId: 'backpack', name: 'Рюкзак' }) });
		expect(tryRun(s2, { type: 'cockpit/item-upsert', item: item({ id: 'x', ownerId: 'pc2', containerId: 'bag' }) }).error).toMatch(/Контейнер/);
	});
	it('transfers a whole item with its container contents and unequips', () => {
		let s = run(base(), { type: 'cockpit/item-upsert', item: item({ id: 'bag', typeId: 'backpack', name: 'Рюкзак' }) });
		s = run(s, { type: 'cockpit/item-upsert', item: item({ id: 'rope', typeId: 'rope', name: 'Верёвка', containerId: 'bag' }) });
		s = run(s, { type: 'cockpit/item-transfer', itemId: 'bag', ownerKind: 'character', ownerId: 'pc2' });
		const c = cockpitOf(s);
		expect(c.items.bag?.ownerId).toBe('pc2');
		expect(c.items.rope).toMatchObject({ ownerId: 'pc2', containerId: 'bag' });
	});
	it('splits a stack on partial transfer', () => {
		let s = run(base(), { type: 'cockpit/item-upsert', item: item({ id: 'arr', typeId: 'arrows', name: 'Стрелы', qty: 20 }) });
		s = run(s, { type: 'cockpit/item-transfer', itemId: 'arr', ownerKind: 'character', ownerId: 'pc2', qty: 5, newId: 'arr2' });
		const c = cockpitOf(s);
		expect(c.items.arr?.qty).toBe(15);
		expect(c.items.arr2).toMatchObject({ qty: 5, ownerId: 'pc2' });
		expect(tryRun(s, { type: 'cockpit/item-transfer', itemId: 'arr', ownerKind: 'character', ownerId: 'pc2', qty: 5 }).error).toMatch(/идентификатор/);
		expect(tryRun(s, { type: 'cockpit/item-transfer', itemId: 'arr', ownerKind: 'character', ownerId: 'pc2', qty: 99, newId: 'z' }).error).toBeTruthy();
	});
	it('removing a container removes its contents', () => {
		let s = run(base(), { type: 'cockpit/item-upsert', item: item({ id: 'bag', typeId: 'backpack', name: 'Рюкзак' }) });
		s = run(s, { type: 'cockpit/item-upsert', item: item({ id: 'rope', typeId: 'rope', name: 'Верёвка', containerId: 'bag' }) });
		s = run(s, { type: 'cockpit/item-remove', itemId: 'bag' });
		expect(Object.keys(cockpitOf(s).items)).toEqual([]);
	});
	it('cast spends exactly one slot of the chosen level, fails without slots, and is one undo step', () => {
		let s = base();
		const spell = { id: 'bless', name: 'Благословение', level: 1, concentration: true };
		s = run(s, { type: 'cockpit/cast', characterId: 'pc1', spell, slotLevel: 1 });
		expect(s.characters.pc1?.spellSlots['1']?.current).toBe(1);
		s = run(s, { type: 'cockpit/cast', characterId: 'pc1', spell, slotLevel: 1 });
		expect(tryRun(s, { type: 'cockpit/cast', characterId: 'pc1', spell, slotLevel: 1 }).error).toMatch(/Нет свободных ячеек/);
		expect(tryRun(s, { type: 'cockpit/cast', characterId: 'pc1', spell, slotLevel: 2 }).error).toMatch(/Нет свободных/);
		const u = dispatch(s, act(s, { type: 'history/undo' }));
		expect(u.state.characters.pc1?.spellSlots['1']?.current).toBe(1);
		// cantrip uses no slot
		const c0 = run(s, { type: 'cockpit/cast', characterId: 'pc1', spell: { ...spell, level: 0 }, slotLevel: 0 });
		expect(c0.characters.pc1?.spellSlots['1']?.current).toBe(0);
	});
	it('viewpoints store 1–9 and delete cleanly', () => {
		let s = run(base(), { type: 'cockpit/viewpoint-set', canvasRel: 'Холсты/01.canvas', slot: '1', view: { name: 'Таверна', x: 10, y: -5, zoom: 0.5 } });
		expect(cockpitOf(s).viewpoints['Холсты/01.canvas']?.['1']?.name).toBe('Таверна');
		expect(tryRun(s, { type: 'cockpit/viewpoint-set', canvasRel: 'a', slot: '0', view: null }).error).toMatch(/1–9/);
		s = run(s, { type: 'cockpit/viewpoint-set', canvasRel: 'Холсты/01.canvas', slot: '1', view: null });
		expect(cockpitOf(s).viewpoints).toEqual({});
	});
	it('two adventures with the same NPC names do not share cockpit data', () => {
		const A = run(base(), { type: 'cockpit/item-upsert', item: item() });
		const B = createAdventureState('advB', 'stB', 'RootB', 'RootB');
		expect(cockpitOf(B).items).toEqual({});
		expect(dispatch(B, act(A, { type: 'cockpit/item-remove', itemId: 'i1' })).error).toMatch(/другому приключению/);
	});
});

describe('builder', () => {
	const choices = { name: 'Тест', raceId: 'human', classId: 'wizard', level: 3, baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 12 }, background: 'Мудрец', subclass: '', skills: ['arcana', 'history'], gear: ['dagger', 'quarterstaff'], notePath: 'Elements/Персонажи/Тест.md' };
	it('wizard 3: HP, slots, proficiency, saves, spell DC', () => {
		const r = buildCharacter(choices, nid);
		// human +1 all: CON 14 (+2). d6: 6+2 + 2*(4+2) = 20
		expect(r.character.hp).toEqual({ current: 20, max: 20, temporary: 0 });
		expect(r.character.spellSlots).toEqual({ '1': { max: 4, current: 4 }, '2': { max: 2, current: 2 } });
		expect(r.sheet.abilities.int).toBe(16);
		expect(r.sheet.saveProf).toEqual(['int', 'wis']);
		expect(r.sheet.castAbility).toBe('int');
		expect(spellDc(r.sheet, profByLevel(3))).toBe(8 + 2 + 3);
		expect(r.character.hitDice).toEqual([{ die: 'd6', total: 3, remaining: 3 }]);
		expect(r.character.ac).toBe(12);
		expect(r.items.map((i) => i.typeId)).toEqual(['dagger', 'quarterstaff']);
		expect(r.book).toBeDefined();
		expect(r.warnings.some((w) => /бумажному листу/.test(w))).toBe(true);
	});
	it('fighter 1 with chain mail and shield; half-elf free bonuses', () => {
		const r = buildCharacter({ ...choices, classId: 'fighter', raceId: 'half-elf', freeBonusPicks: ['str', 'con'], level: 1, gear: ['chain-mail', 'shield', 'longsword'], skills: ['athletics', 'perception'] }, nid);
		expect(r.sheet.abilities).toMatchObject({ cha: 14, str: 9, con: 14 });
		expect(r.character.hp.max).toBe(12);
		expect(r.character.ac).toBe(18);
		expect(r.book).toBeUndefined();
		expect(r.sheet.weaponProf).toEqual(['simple', 'martial']);
	});
	it('builder output goes through the reducer atomically with one Undo', () => {
		let s = createAdventureState('adv', 'st', 'Root', 'Root');
		const r = buildCharacter(choices, nid);
		s = run(s, { type: 'cockpit/character-build', character: r.character, sheet: r.sheet, items: r.items, ...(r.book ? { book: r.book } : {}) });
		expect(s.characters[r.character.id]?.name).toBe('Тест');
		expect(Object.keys(cockpitOf(s).items)).toHaveLength(2);
		const u = dispatch(s, act(s, { type: 'history/undo' }));
		expect(Object.keys(u.state.characters)).toHaveLength(0);
		expect(Object.keys(cockpitOf(u.state).items)).toHaveLength(0);
	});
	it('warns on missing choices instead of inventing data', () => {
		const r = buildCharacter({ ...choices, skills: ['arcana'], level: 2 }, nid);
		expect(r.warnings.some((w) => /навыков/.test(w))).toBe(true);
		const w = buildCharacter({ ...choices, classId: 'cleric', subclass: '', level: 1 }, nid);
		expect(w.warnings.some((x) => /Подкласс/.test(x))).toBe(true);
	});
});

describe('quick NPC', () => {
	it('recognises template and weapon words', () => {
		expect(findTemplate('Гоблин-посетитель таверны с кинжалом')?.id).toBe('goblin');
		expect(findWeapon('Гоблин-посетитель таверны с кинжалом')).toBe('dagger');
		expect(findTemplate('что-то странное')).toBeNull();
	});
	it('goblin with a dagger: adapted statblock, dagger instance, attack bonus from abilities', () => {
		const r = quickNpc('Гоблин-посетитель таверны с кинжалом', nid, () => 0.5)!;
		expect(r.statblock.origin).toBe('adapted');
		expect(r.statblock.role).toBe('посетитель таверны');
		expect(r.creature.hpMax).toBe(8);
		expect(r.statblock.attacks[0]).toMatchObject({ name: 'Dagger', bonus: 4, damage: '1d4+2', damageType: 'piercing' });
		expect(r.items).toHaveLength(1);
		expect(r.items[0]).toMatchObject({ typeId: 'dagger', equipped: true });
		expect(resolveItemType(createAdventureState('a', 's', 'r', 'r'), r.items[0]!)?.costCp).toBe(200);
	});
	it('unmodified template stays official; creation is one atomic undoable action', () => {
		const r = quickNpc('гоблин', nid, () => 0.1)!;
		expect(r.statblock.origin).toBe('official');
		let s = createAdventureState('adv', 'st', 'Root', 'Root');
		s = run(s, { type: 'cockpit/npc-create', creature: r.creature, statblock: r.statblock, items: r.items, purse: r.purse });
		expect(s.creatures[r.creature.id]).toBeDefined();
		expect(cockpitOf(s).statblocks[r.creature.id]?.attacks.length).toBeGreaterThan(0);
		const u = dispatch(s, act(s, { type: 'history/undo' }));
		expect(Object.keys(u.state.creatures)).toHaveLength(0);
		expect(Object.keys(cockpitOf(u.state).statblocks)).toHaveLength(0);
	});
});

describe('level up', () => {
	const choices = { name: 'Тест', raceId: 'human', classId: 'wizard', level: 4, baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 10, cha: 12 }, background: '', subclass: 'Эвокация', skills: ['arcana', 'history'], gear: [], notePath: 'x.md' };
	it('wizard 4→5: +HP (avg d6 + CON), +1 hit die, slots follow the table, spent slots stay spent', () => {
		const r = buildCharacter(choices, nid);
		r.character.spellSlots['1'] = { max: 4, current: 1 };
		const up = levelUp(r.character, r.sheet);
		expect(up.character.classes[0]?.level).toBe(5);
		expect(up.character.hp.max).toBe((r.character.hp.max ?? 0) + 6); // d6: 4 + CON +2
		expect(up.character.hitDice[0]).toMatchObject({ total: 5, remaining: 5 });
		expect(up.character.spellSlots['3']).toEqual({ max: 2, current: 2 });
		expect(up.character.spellSlots['1']).toEqual({ max: 4, current: 1 });
		expect(up.warnings.some((w) => /Мастерство теперь \+3/.test(w))).toBe(true);
		expect(r.character.classes[0]?.level).toBe(4); // input not mutated
	});
	it('refuses unknown classes and level 20; reminds about subclass', () => {
		const r = buildCharacter({ ...choices, level: 1, subclass: '', classId: 'cleric' }, nid);
		expect(() => levelUp({ ...r.character, classes: [{ name: 'Свой класс', level: 3 }] }, r.sheet)).toThrow(/вручную/);
		expect(() => levelUp({ ...r.character, classes: [{ name: 'Жрец', level: 20 }] }, r.sheet)).toThrow(/20/);
		const w = buildCharacter({ ...choices, level: 1, subclass: '', classId: 'wizard' }, nid);
		expect(levelUp(w.character, w.sheet).warnings).toContain('Выберите подкласс');
	});
});
