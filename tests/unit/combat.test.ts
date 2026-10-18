import { describe, expect, it } from 'vitest';
import { computeSlots, skippedByJump } from '../../src/domain/combat';
import { encounterFromTemplate } from '../../src/domain/encounter';
import { dispatch } from '../../src/domain/reducer';
import type { EncounterTemplate } from '../../src/domain/types';
import { act, activeName, baseState, id, monster, pcCmb, run, tryRun, withEncounter } from '../helpers';

const goblins = (n: number, inits: Array<number | null>) =>
	Array.from({ length: n }, (_, i) => monster(`g${i + 1}`, `Гоблин ${i + 1}`, inits[i] ?? null, 7, (i + 1) * 10));

const template: EncounterTemplate = {
	id: 'tpl-1',
	name: 'Засада гоблинов',
	partyId: 'party-main',
	includeParty: true,
	notes: '',
	entries: [
		{ id: 'e1', kind: 'creature', name: 'Гоблин', count: 5, creatureId: null, notePath: null, sourceUrl: 'https://5e14.ttg.club/bestiary/goblin', hpMax: 7, ac: 15, initiativeModifier: 2, sharedInitiative: false },
		{ id: 'e2', kind: 'creature', name: 'Волк', count: 3, creatureId: null, notePath: null, sourceUrl: null, hpMax: 11, ac: 13, initiativeModifier: 2, sharedInitiative: true },
	],
};

describe('AC-13 шаблон боя', () => {
	it('запуск дважды даёт новые ID, шаблон не меняется', () => {
		let s = run(baseState(), { type: 'template/upsert', template });
		const before = JSON.stringify(s.encounterTemplates);
		const e1 = encounterFromTemplate(s, s.encounterTemplates[0]!, id, 'now');
		s = run(s, { type: 'encounter/create', encounter: e1 });
		s = run(s, { type: 'encounter/end' });
		const e2 = encounterFromTemplate(s, s.encounterTemplates[0]!, id, 'now');
		s = run(s, { type: 'encounter/create', encounter: e2 });
		expect(e1.id).not.toBe(e2.id);
		const ids1 = Object.keys(e1.combatants);
		const ids2 = Object.keys(e2.combatants);
		expect(ids1).toHaveLength(3 + 5 + 3);
		expect(ids1.some((x) => ids2.includes(x))).toBe(false);
		expect(JSON.stringify(s.encounterTemplates)).toBe(before);
	});

	it('AC-14 пять гоблинов: независимые HP и понятные номера', () => {
		let s = run(baseState(), { type: 'template/upsert', template });
		const enc = encounterFromTemplate(s, s.encounterTemplates[0]!, id, 'now');
		s = run(s, { type: 'encounter/create', encounter: enc });
		const gobs = Object.values(s.activeEncounter!.combatants).filter((c) => c.displayName.startsWith('Гоблин'));
		expect(gobs.map((g) => g.displayName).sort()).toEqual(['Гоблин 1', 'Гоблин 2', 'Гоблин 3', 'Гоблин 4', 'Гоблин 5']);
		expect(gobs.every((g) => g.initiativeGroupId === null)).toBe(true);
		s = run(s, { type: 'hp/damage', target: { kind: 'combatant', id: gobs[1]!.id }, amount: 4, useTemporary: true });
		const after = s.activeEncounter!.combatants;
		expect(after[gobs[1]!.id]!.hp!.current).toBe(3);
		for (const g of gobs.filter((_, i) => i !== 1)) expect(after[g.id]!.hp!.current).toBe(7);
		// PCs share the persistent character HP.
		const pcs = Object.values(after).filter((c) => c.kind === 'pc');
		expect(pcs.every((c) => c.hp === null && c.characterId)).toBe(true);
	});

	it('волки в явной группе разделяют ход, но не хиты (AC-16)', () => {
		let s = run(baseState(), { type: 'template/upsert', template });
		const enc = encounterFromTemplate(s, s.encounterTemplates[0]!, id, 'now');
		s = run(s, { type: 'encounter/create', encounter: enc });
		const wolves = Object.values(s.activeEncounter!.combatants).filter((c) => c.displayName.startsWith('Волк'));
		const gid = wolves[0]!.initiativeGroupId!;
		expect(gid).toBeTruthy();
		expect(wolves.every((w) => w.initiativeGroupId === gid)).toBe(true);
		s = run(s, { type: 'encounter/update-group', groupId: gid, patch: { initiative: 12 } });
		const slots = computeSlots(s.activeEncounter!);
		const wolfSlot = slots.find((x) => x.id === gid)!;
		expect(wolfSlot.memberIds).toHaveLength(3);
		s = run(s, { type: 'hp/damage', target: { kind: 'combatant', id: wolves[0]!.id }, amount: 5, useTemporary: true });
		const w = s.activeEncounter!.combatants;
		expect(w[wolves[0]!.id]!.hp!.current).toBe(6);
		expect(w[wolves[1]!.id]!.hp!.current).toBe(11);
	});
});

describe('инициатива', () => {
	it('AC-15 пять разных значений, сортировка по убыванию', () => {
		const s = withEncounter(baseState(), goblins(5, [3, 18, 11, 7, 15]));
		const order = computeSlots(s.activeEncounter!).map((x) => x.name);
		expect(order).toEqual(['Гоблин 2', 'Гоблин 5', 'Гоблин 3', 'Гоблин 4', 'Гоблин 1']);
	});

	it('AC-17 равенство стабильно, ручная перестановка сохраняется', () => {
		let s = withEncounter(baseState(), goblins(3, [10, 10, 10]));
		expect(computeSlots(s.activeEncounter!).map((x) => x.id)).toEqual(['g1', 'g2', 'g3']);
		s = run(s, { type: 'encounter/move-in-ties', slotId: 'g3', direction: -1 });
		expect(computeSlots(s.activeEncounter!).map((x) => x.id)).toEqual(['g1', 'g3', 'g2']);
		s = run(s, { type: 'encounter/update-combatant', combatantId: 'g1', patch: { displayName: 'Гоблин-вожак' } });
		expect(computeSlots(s.activeEncounter!).map((x) => x.id)).toEqual(['g1', 'g3', 'g2']);
		expect(tryRun(s, { type: 'encounter/move-in-ties', slotId: 'g1', direction: -1 }).error).toBeTruthy();
	});

	it('AC-18 раунд увеличивается ровно на 1; Previous возвращает', () => {
		let s = withEncounter(baseState(), goblins(3, [15, 10, 5]));
		s = run(s, { type: 'encounter/begin' });
		expect(s.activeEncounter!.round).toBe(1);
		expect(activeName(s)).toBe('Гоблин 1');
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/next' });
		expect(activeName(s)).toBe('Гоблин 3');
		const beforeWrap = structuredClone(s.activeEncounter);
		s = run(s, { type: 'encounter/next' });
		expect(s.activeEncounter!.round).toBe(2);
		expect(activeName(s)).toBe('Гоблин 1');
		s = run(s, { type: 'encounter/previous' });
		expect(s.activeEncounter!.round).toBe(1);
		expect(activeName(s)).toBe('Гоблин 3');
		expect(s.activeEncounter!.actedThisRound).toEqual(beforeWrap!.actedThisRound);
	});

	it('изменение состава боя: добавленный в конце раунда ходит, раунд +1 один раз', () => {
		let s = withEncounter(baseState(), goblins(2, [15, 10]));
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/add-combatants', combatants: [monster('late', 'Опоздавший', 2)] });
		s = run(s, { type: 'encounter/next' });
		expect(activeName(s)).toBe('Опоздавший');
		expect(s.activeEncounter!.round).toBe(1);
		s = run(s, { type: 'encounter/next' });
		expect(s.activeEncounter!.round).toBe(2);
		expect(activeName(s)).toBe('Гоблин 1');
	});

	it('смена инициативы внутри раунда не даёт второй ход тому, кто уже ходил', () => {
		let s = withEncounter(baseState(), goblins(3, [15, 10, 5]));
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/next' }); // g2 active, g1 acted
		s = run(s, { type: 'encounter/update-combatant', combatantId: 'g1', patch: { initiative: 1 } });
		s = run(s, { type: 'encounter/next' });
		expect(activeName(s)).toBe('Гоблин 3');
		s = run(s, { type: 'encounter/next' });
		expect(s.activeEncounter!.round).toBe(2);
		expect(activeName(s)).toBe('Гоблин 2');
	});

	it('100 участников: полный раунд', () => {
		const many = Array.from({ length: 100 }, (_, i) => monster(`m${i}`, `М ${i}`, 100 - i));
		let s = withEncounter(baseState(), many);
		s = run(s, { type: 'encounter/begin' });
		for (let i = 0; i < 100; i++) s = run(s, { type: 'encounter/next' });
		expect(s.activeEncounter!.round).toBe(2);
		expect(activeName(s)).toBe('М 0');
	});

	it('1 участник: каждый Next — новый раунд', () => {
		let s = withEncounter(baseState(), [monster('solo', 'Один', 5)]);
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/next' });
		expect(s.activeEncounter!.round).toBe(3);
	});

	it('пустой бой нельзя начать', () => {
		const s = withEncounter(baseState(), []);
		expect(tryRun(s, { type: 'encounter/begin' }).error).toMatch(/нет участников/i);
	});

	it('пауза блокирует переход хода', () => {
		let s = withEncounter(baseState(), goblins(2, [5, 4]));
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/pause', paused: true });
		expect(tryRun(s, { type: 'encounter/next' }).error).toMatch(/пауз/);
		s = run(s, { type: 'encounter/pause', paused: false });
		s = run(s, { type: 'encounter/next' });
		expect(activeName(s)).toBe('Гоблин 2');
	});

	it('прыжок: пропущенные показаны, невидимые ходы не начисляются', () => {
		let s = withEncounter(baseState(), goblins(4, [20, 15, 10, 5]));
		s = run(s, { type: 'encounter/begin' });
		expect(skippedByJump(s.activeEncounter!, 'g4').map((x) => x.id)).toEqual(['g2', 'g3']);
		const seq = s.eventSeq;
		s = run(s, { type: 'encounter/jump', slotId: 'g4', endCurrent: true });
		expect(activeName(s)).toBe('Гоблин 4');
		expect(s.eventSeq).toBe(seq + 2); // turn-end g1 + turn-start g4 only
	});
});

describe('цель и ход, урон и хиты', () => {
	it('AC-19 урон по выбранной цели не меняет активного участника', () => {
		let s = withEncounter(baseState(), [monster('g1', 'Гоблин 1', 15), pcCmb('c-alex', 'pc-alex', 'Алекс', 10)]);
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'hp/damage', target: { kind: 'combatant', id: 'c-alex' }, amount: 5, useTemporary: true });
		expect(activeName(s)).toBe('Гоблин 1');
		expect(s.characters['pc-alex']!.hp.current).toBe(12);
	});

	it('AC-20 ручной ввод числа урона, без бросков', () => {
		let s = baseState();
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 13, useTemporary: true });
		expect(s.characters['pc-bor']!.hp.current).toBe(17);
		expect(tryRun(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: -3, useTemporary: true }).error).toBeTruthy();
		expect(tryRun(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 2.5, useTemporary: true }).error).toBeTruthy();
	});

	it('AC-21 ноль хитов: участник остаётся, эффект не исчезает', () => {
		let s = withEncounter(baseState(), [monster('g1', 'Гоблин 1', 15)]);
		s = run(s, {
			type: 'effect/add',
			effect: {
				id: 'e1', conditionId: 'poisoned', label: 'Отравленный', target: { kind: 'combatant', id: 'g1' }, sourceCombatantId: null,
				sourceLabel: '', duration: { kind: 'manual' }, createdAtEventSeq: 0, isConcentration: false, concentrationEffectId: null, needsDecision: false, notes: '',
			},
		});
		s = run(s, { type: 'hp/damage', target: { kind: 'combatant', id: 'g1' }, amount: 100, useTemporary: true });
		expect(s.activeEncounter!.combatants.g1!.hp!.current).toBe(0);
		expect(s.activeEncounter!.combatants.g1!.defeated).toBe(false);
		expect(s.effects.e1).toBeTruthy();
	});

	it('временные хиты при серии ударов и границы 0/1/max', () => {
		let s = baseState();
		s = run(s, { type: 'hp/set-temporary', target: { kind: 'character', id: 'pc-bor' }, value: 5 });
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 3, useTemporary: true });
		expect(s.characters['pc-bor']!.hp).toEqual({ current: 30, max: 30, temporary: 2 });
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 4, useTemporary: true });
		expect(s.characters['pc-bor']!.hp).toEqual({ current: 28, max: 30, temporary: 0 });
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 27, useTemporary: true });
		expect(s.characters['pc-bor']!.hp.current).toBe(1);
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 1, useTemporary: true });
		expect(s.characters['pc-bor']!.hp.current).toBe(0);
		s = run(s, { type: 'hp/heal', target: { kind: 'character', id: 'pc-bor' }, amount: 999 });
		expect(s.characters['pc-bor']!.hp.current).toBe(30);
		// Temp HP ignored when the option is off
		s = run(s, { type: 'hp/set-temporary', target: { kind: 'character', id: 'pc-bor' }, value: 5 });
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 3, useTemporary: false });
		expect(s.characters['pc-bor']!.hp).toEqual({ current: 27, max: 30, temporary: 5 });
	});

	it('временный КД в бою не меняет КД листа', () => {
		let s = withEncounter(baseState(), [pcCmb('c-alex', 'pc-alex', 'Алекс', 10)]);
		s = run(s, { type: 'encounter/update-combatant', combatantId: 'c-alex', patch: { acOverride: 19 } });
		expect(s.activeEncounter!.combatants['c-alex']!.acOverride).toBe(19);
		expect(s.characters['pc-alex']!.ac).toBe(17);
	});

	it('конец боя не сбрасывает ресурсы PC', () => {
		let s = withEncounter(baseState(), [pcCmb('c-mira', 'pc-mira', 'Мира', 10)]);
		s = run(s, { type: 'hp/damage', target: { kind: 'combatant', id: 'c-mira' }, amount: 4, useTemporary: true });
		s = run(s, { type: 'character/set-slot', characterId: 'pc-mira', level: '1', slot: { current: 1, max: 4 } });
		s = run(s, { type: 'encounter/end' });
		expect(s.activeEncounter).toBeNull();
		expect(s.characters['pc-mira']!.hp.current).toBe(5);
		expect(s.characters['pc-mira']!.spellSlots['1']).toEqual({ current: 1, max: 4 });
	});

	it('один PC не добавляется в бой дважды', () => {
		const s = withEncounter(baseState(), [pcCmb('c-alex', 'pc-alex', 'Алекс', 10)]);
		expect(tryRun(s, { type: 'encounter/add-combatants', combatants: [pcCmb('c-alex2', 'pc-alex', 'Алекс', 3)] }).error).toBeTruthy();
	});
});

describe('удаление участников', () => {
	it('удаление активного участника передаёт ход следующему', () => {
		let s = withEncounter(baseState(), goblins(3, [15, 10, 5]));
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/remove-combatant', combatantId: 'g2' });
		expect(activeName(s)).toBe('Гоблин 3');
		s = run(s, { type: 'encounter/next' });
		expect(s.activeEncounter!.round).toBe(2);
		expect(activeName(s)).toBe('Гоблин 1');
	});

	it('удаление последнего активного в раунде начинает новый раунд', () => {
		let s = withEncounter(baseState(), goblins(2, [15, 10]));
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/remove-combatant', combatantId: 'g2' });
		expect(s.activeEncounter!.round).toBe(2);
		expect(activeName(s)).toBe('Гоблин 1');
	});

	it('выбывшие пропускаются при переходе, но остаются в данных', () => {
		let s = withEncounter(baseState(), goblins(3, [15, 10, 5]));
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/update-combatant', combatantId: 'g2', patch: { defeated: true } });
		s = run(s, { type: 'encounter/next' });
		expect(activeName(s)).toBe('Гоблин 3');
		expect(s.activeEncounter!.combatants.g2).toBeTruthy();
	});
});

describe('AC-32 идемпотентность', () => {
	it('повтор actionId не удваивает урон и не увеличивает раунд', () => {
		let s = withEncounter(baseState(), goblins(1, [10]));
		s = run(s, { type: 'encounter/begin' });
		const dmg = act(s, { type: 'hp/damage', target: { kind: 'combatant', id: 'g1' }, amount: 3, useTemporary: true }, 'fixed-1');
		s = dispatch(s, dmg).state;
		const again = dispatch(s, dmg);
		expect(again.duplicate).toBe(true);
		expect(again.state.activeEncounter!.combatants.g1!.hp!.current).toBe(4);
		const next = act(s, { type: 'encounter/next' }, 'fixed-2');
		s = dispatch(s, next).state;
		const r = s.activeEncounter!.round;
		s = dispatch(s, next).state;
		expect(s.activeEncounter!.round).toBe(r);
	});

	it('действие другого приключения отклоняется', () => {
		const a = baseState('adv-A');
		const b = baseState('adv-B');
		const r = dispatch(a, act(b, { type: 'hp/damage', target: { kind: 'character', id: 'pc-alex' }, amount: 3, useTemporary: true }));
		expect(r.error).toMatch(/другому приключению/);
		expect(r.state).toBe(a);
	});
});
