import { describe, expect, it } from 'vitest';
import { describeDuration } from '../../src/domain/effect-clock';
import { activeName, baseState, effect, monster, pcCmb, run, tryRun, withEncounter } from '../helpers';

const three = () => [monster('a', 'Аргус', 20), monster('b', 'Бурка', 15), monster('c', 'Ворон', 10)];

describe('AC-22 «3 конца собственных ходов»', () => {
	it('наложение посреди чужого хода: ровно 3 будущих конца хода цели', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' }); // Аргус acts
		s = run(s, { type: 'effect/add', effect: effect('e1', 'b', { kind: 'turns', ownerCombatantId: 'b', phase: 'end', remaining: 3 }) });
		const rem = () => (s.effects.e1?.duration.kind === 'turns' ? s.effects.e1.duration.remaining : null);
		s = run(s, { type: 'encounter/next' }); // Бурка start
		expect(rem()).toBe(3);
		s = run(s, { type: 'encounter/next' }); // Бурка end #1
		expect(rem()).toBe(2);
		for (let i = 0; i < 3; i++) s = run(s, { type: 'encounter/next' }); // r2: Аргус, Бурка, Бурка end #2 → Ворон
		expect(rem()).toBe(1);
		for (let i = 0; i < 2; i++) s = run(s, { type: 'encounter/next' }); // r3: Аргус, Бурка start
		expect(activeName(s)).toBe('Бурка');
		expect(s.activeEncounter!.round).toBe(3);
		expect(rem()).toBe(1);
		s = run(s, { type: 'encounter/next' }); // Бурка end #3
		expect(s.effects.e1).toBeUndefined();
	});

	it('наложение в собственный ход: прошедший turn-start не считается', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('e1', 'a', { kind: 'turns', ownerCombatantId: 'a', phase: 'start', remaining: 1 }) });
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1).toBeTruthy();
		s = run(s, { type: 'encounter/next' }); // round 2, Аргус turn-start
		expect(s.effects.e1).toBeUndefined();
	});
});

describe('AC-23 «до начала следующего хода источника»', () => {
	it('срабатывает на turn-start источника, а не на начале раунда', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'encounter/next' }); // Бурка (source) acts
		s = run(s, {
			type: 'effect/add',
			effect: effect('e1', 'c', { kind: 'turns', ownerCombatantId: 'b', phase: 'start', remaining: 1 }, { sourceCombatantId: 'b' }),
		});
		s = run(s, { type: 'encounter/next' }); // Ворон
		s = run(s, { type: 'encounter/next' }); // round 2 start, Аргус
		expect(s.activeEncounter!.round).toBe(2);
		expect(s.effects.e1).toBeTruthy();
		s = run(s, { type: 'encounter/next' }); // Бурка turn-start
		expect(activeName(s)).toBe('Бурка');
		expect(s.effects.e1).toBeUndefined();
	});

	it('длительность в раундах — по событию конца раунда', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('e1', 'c', { kind: 'rounds', phase: 'end', remaining: 2 }) });
		for (let i = 0; i < 3; i++) s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1?.duration).toMatchObject({ remaining: 1 });
		for (let i = 0; i < 3; i++) s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1).toBeUndefined();
	});
});

describe('AC-24 два одинаковых состояния от разных источников', () => {
	it('снятие первого не снимает второе', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'effect/add', effect: effect('e1', 'c', { kind: 'manual' }, { sourceCombatantId: 'a', sourceLabel: 'Аргус' }) });
		s = run(s, { type: 'effect/add', effect: effect('e2', 'c', { kind: 'manual' }, { sourceCombatantId: 'b', sourceLabel: 'Бурка' }) });
		s = run(s, { type: 'effect/remove', effectIds: ['e1'] });
		expect(s.effects.e1).toBeUndefined();
		expect(s.effects.e2?.sourceLabel).toBe('Бурка');
	});

	it('независимые таймеры', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('e1', 'c', { kind: 'turns', ownerCombatantId: 'c', phase: 'end', remaining: 1 }) });
		s = run(s, { type: 'effect/add', effect: effect('e2', 'c', { kind: 'turns', ownerCombatantId: 'c', phase: 'end', remaining: 2 }) });
		for (let i = 0; i < 3; i++) s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1).toBeUndefined();
		expect(s.effects.e2).toBeTruthy();
	});
});

describe('AC-25 Undo/Redo истечения эффекта', () => {
	it('Undo возвращает остаток, Redo снова снимает', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('e1', 'a', { kind: 'turns', ownerCombatantId: 'a', phase: 'end', remaining: 1 }) });
		s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1).toBeUndefined();
		s = run(s, { type: 'history/undo' });
		expect(s.effects.e1?.duration).toMatchObject({ remaining: 1 });
		expect(activeName(s)).toBe('Аргус');
		s = run(s, { type: 'history/redo' });
		expect(s.effects.e1).toBeUndefined();
		expect(activeName(s)).toBe('Бурка');
	});

	it('«Предыдущий ход» тоже восстанавливает истёкший эффект', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('e1', 'a', { kind: 'turns', ownerCombatantId: 'a', phase: 'end', remaining: 1 }) });
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/previous' });
		expect(s.effects.e1).toBeTruthy();
		s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1).toBeUndefined();
	});
});

describe('AC-26 ручная правка эффекта', () => {
	it('продление считает только будущие события и не трогает других', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('e1', 'a', { kind: 'turns', ownerCombatantId: 'a', phase: 'end', remaining: 1 }) });
		s = run(s, { type: 'effect/add', effect: effect('e2', 'b', { kind: 'turns', ownerCombatantId: 'b', phase: 'end', remaining: 2 }) });
		const other = JSON.stringify(s.effects.e2);
		s = run(s, { type: 'effect/update', effectId: 'e1', patch: { duration: { kind: 'turns', ownerCombatantId: 'a', phase: 'end', remaining: 3 } } });
		expect(JSON.stringify(s.effects.e2)).toBe(other);
		s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1?.duration).toMatchObject({ remaining: 2 });
		s = run(s, { type: 'effect/update', effectId: 'e1', patch: { duration: { kind: 'manual' } } });
		for (let i = 0; i < 6; i++) s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1).toBeTruthy();
	});
});

describe('AC-27 концентрация', () => {
	it('связь сохраняется; снятие концентрации без проверки правил', () => {
		let s = withEncounter(baseState(), [pcCmb('c-mira', 'pc-mira', 'Мира', 15), monster('g', 'Гоблин', 10)]);
		s = run(s, {
			type: 'effect/add',
			effect: effect('conc', 'pc-mira', { kind: 'manual' }, { conditionId: 'concentration', label: 'Концентрация: Удержание', isConcentration: true, target: { kind: 'character', id: 'pc-mira' }, sourceCombatantId: 'c-mira' }),
		});
		s = run(s, { type: 'effect/add', effect: effect('held', 'g', { kind: 'manual' }, { conditionId: 'paralyzed', label: 'Парализованный', sourceCombatantId: 'c-mira', concentrationEffectId: 'conc' }) });
		s = run(s, { type: 'effect/add', effect: effect('kept', 'g', { kind: 'manual' }, { concentrationEffectId: 'conc' }) });
		expect(s.effects.held?.concentrationEffectId).toBe('conc');
		const hp = s.characters['pc-mira']!.hp.current;
		s = run(s, { type: 'concentration/end', effectId: 'conc', removeLinkedIds: ['held'] });
		expect(s.effects.conc).toBeUndefined();
		expect(s.effects.held).toBeUndefined();
		expect(s.effects.kept?.concentrationEffectId).toBeNull();
		expect(s.characters['pc-mira']!.hp.current).toBe(hp);
	});
});

describe('граничные случаи эффектов', () => {
	it('удаление владельца длительности → «требует решения», не удаление', () => {
		let s = withEncounter(baseState(), [pcCmb('c-alex', 'pc-alex', 'Алекс', 15), monster('g', 'Гоблин', 10)]);
		s = run(s, { type: 'encounter/begin' });
		s = run(s, {
			type: 'effect/add',
			effect: effect('e1', 'pc-alex', { kind: 'turns', ownerCombatantId: 'g', phase: 'start', remaining: 1 }, { target: { kind: 'character', id: 'pc-alex' }, sourceCombatantId: 'g' }),
		});
		s = run(s, { type: 'encounter/remove-combatant', combatantId: 'g' });
		expect(s.effects.e1?.needsDecision).toBe(true);
		expect(describeDuration(s.effects.e1!, () => 'x', 0)).toMatch(/решения/);
	});

	it('эффект без источника и перенос между владельцами', () => {
		let s = withEncounter(baseState(), three());
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('e1', 'c', { kind: 'turns', ownerCombatantId: 'c', phase: 'end', remaining: 1 }) });
		s = run(s, { type: 'effect/update', effectId: 'e1', patch: { target: { kind: 'combatant', id: 'b' }, duration: { kind: 'turns', ownerCombatantId: 'b', phase: 'end', remaining: 1 } } });
		s = run(s, { type: 'encounter/next' });
		s = run(s, { type: 'encounter/next' });
		expect(s.effects.e1).toBeUndefined();
	});

	it('0 оставшихся событий запрещено при создании', () => {
		const s = withEncounter(baseState(), three());
		expect(tryRun(s, { type: 'effect/add', effect: effect('e1', 'a', { kind: 'turns', ownerCombatantId: 'a', phase: 'end', remaining: 0 }) }).error).toBeTruthy();
	});

	it('конец боя: эффекты PC остаются и требуют решения; эффекты монстров уходят', () => {
		let s = withEncounter(baseState(), [pcCmb('c-alex', 'pc-alex', 'Алекс', 15), monster('g', 'Гоблин', 10)]);
		s = run(s, { type: 'encounter/begin' });
		s = run(s, { type: 'effect/add', effect: effect('pcE', 'pc-alex', { kind: 'turns', ownerCombatantId: 'c-alex', phase: 'end', remaining: 3 }, { target: { kind: 'character', id: 'pc-alex' }, sourceCombatantId: 'g' }) });
		s = run(s, { type: 'effect/add', effect: effect('pcM', 'pc-alex', { kind: 'manual' }, { target: { kind: 'character', id: 'pc-alex' } }) });
		s = run(s, { type: 'effect/add', effect: effect('gE', 'g', { kind: 'manual' }) });
		s = run(s, { type: 'encounter/end' });
		expect(s.effects.pcE?.needsDecision).toBe(true);
		expect(s.effects.pcE?.sourceLabel).toBe('Гоблин');
		expect(s.effects.pcM?.needsDecision).toBe(false);
		expect(s.effects.gE).toBeUndefined();
	});

	it('внебоевое время: 24 часа игрового времени', () => {
		let s = baseState();
		s = run(s, { type: 'effect/add', effect: effect('e1', 'pc-bor', { kind: 'game-time', expiresAtMinute: 1440 }, { target: { kind: 'character', id: 'pc-bor' } }) });
		s = run(s, { type: 'clock/advance', minutes: 1439 });
		expect(s.effects.e1).toBeTruthy();
		s = run(s, { type: 'clock/advance', minutes: 1 });
		expect(s.effects.e1).toBeUndefined();
		expect(s.gameClock.minutes).toBe(1440);
		s = run(s, { type: 'history/undo' });
		expect(s.effects.e1).toBeTruthy();
	});

	it('владелец длительности должен быть в бою', () => {
		const s = withEncounter(baseState(), three());
		expect(tryRun(s, { type: 'effect/add', effect: effect('e1', 'a', { kind: 'turns', ownerCombatantId: 'nobody', phase: 'end', remaining: 1 }) }).error).toBeTruthy();
	});
});
