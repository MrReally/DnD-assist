import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/domain/reducer';
import { defaultRestOptions, planRest } from '../../src/domain/rest';
import { applyPatch, diff } from '../../src/domain/undo';
import { act, baseState, run } from '../helpers';

function wounded() {
	let s = baseState();
	s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-alex' }, amount: 10, useTemporary: true });
	s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-mira' }, amount: 5, useTemporary: true });
	s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 20, useTemporary: true });
	s = run(s, { type: 'character/set-slot', characterId: 'pc-mira', level: '1', slot: { current: 0, max: 4 } });
	s = run(s, { type: 'character/set-hit-dice', characterId: 'pc-alex', hitDice: [{ die: 'd10', total: 3, remaining: 0 }] });
	s = run(s, { type: 'character/set-counter', characterId: 'pc-alex', counter: { id: 'surge', name: 'Всплеск действий', current: 0, max: 1, recovery: 'short' } });
	s = run(s, { type: 'character/set-counter', characterId: 'pc-alex', counter: { id: 'luck', name: 'Удача мастера', current: 0, max: 3, recovery: 'manual' } });
	return s;
}

describe('AC-28 выборочный долгий отдых', () => {
	it('восстанавливает только отмеченных, предпросмотр верен, отменяемо', () => {
		const s = wounded();
		const opts = defaultRestOptions(s, 'long', '2014', ['pc-alex', 'pc-mira']);
		const plan = planRest(s, opts);
		expect(plan.entries).toHaveLength(2);
		const alex = plan.entries.find((e) => e.characterId === 'pc-alex')!;
		expect(alex.lines).toContain('Хиты: 7 → 28');
		expect(alex.lines).toContain('Кости хитов d10: 0 → 1');
		const mira = plan.entries.find((e) => e.characterId === 'pc-mira')!;
		expect(mira.lines).toContain('Ячейки 1 ур.: 0 → 4');
		const r = dispatch(s, act(s, { type: 'rest/apply', kind: 'long', changes: plan.entries.map((e) => ({ characterId: e.characterId, after: e.after })), removeEffectIds: [] }));
		const after = r.state;
		expect(after.characters['pc-alex']!.hp.current).toBe(28);
		expect(after.characters['pc-mira']!.hp.current).toBe(20);
		expect(after.characters['pc-bor']!.hp.current).toBe(10);
		expect(after.history.undo.at(-1)!.label).toMatch(/Долгий отдых/);
		const undone = run(after, { type: 'history/undo' });
		expect(undone.characters['pc-alex']!.hp.current).toBe(7);
		expect(undone.characters['pc-mira']!.spellSlots['1']!.current).toBe(0);
	});

	it('AC-29 счётчик с ручным восстановлением не восстанавливается без согласия', () => {
		const s = wounded();
		const opts = defaultRestOptions(s, 'long', '2014', ['pc-alex']);
		expect(opts.counterIds['pc-alex']).toEqual(['surge']);
		const plan = planRest(s, opts);
		const alex = plan.entries[0]!.after;
		expect(alex.counters.surge!.current).toBe(1);
		expect(alex.counters.luck!.current).toBe(0);
		const explicit = planRest(s, { ...opts, counterIds: { 'pc-alex': ['surge', 'luck'] } });
		expect(explicit.entries[0]!.after.counters.luck!.current).toBe(3);
	});

	it('короткий отдых: без автоматических бросков, ручная трата костей хитов', () => {
		const s = run(wounded(), { type: 'character/set-hit-dice', characterId: 'pc-bor', hitDice: [{ die: 'd8', total: 4, remaining: 4 }] });
		const opts = defaultRestOptions(s, 'short', '2014', ['pc-bor']);
		expect(opts.restoreHp).toBe(false);
		const plain = planRest(s, opts);
		expect(plain.entries[0]!.after.hp.current).toBe(10);
		const spent = planRest(s, { ...opts, hitDiceSpend: { 'pc-bor': { die: 'd8', count: 2, healed: 11 } } });
		expect(spent.entries[0]!.after.hp.current).toBe(21);
		expect(spent.entries[0]!.after.hitDice[0]!.remaining).toBe(2);
	});

	it('режим manual ничего не отмечает автоматически; истощение только по выбору', () => {
		let s = wounded();
		s = run(s, { type: 'character/set-fields', characterId: 'pc-alex', patch: { exhaustion: 2 } });
		const opts = defaultRestOptions(s, 'long', 'manual', ['pc-alex']);
		expect(opts.restoreHp || opts.restoreSpellSlots || opts.restoreHitDice || opts.reduceExhaustion).toBe(false);
		expect(planRest(s, opts).entries[0]!.lines).toEqual([]);
		const withEx = planRest(s, { ...defaultRestOptions(s, 'long', '2014', ['pc-alex']), reduceExhaustion: true });
		expect(withEx.entries[0]!.after.exhaustion).toBe(1);
	});

	it('пустая партия — пустой план', () => {
		const s = wounded();
		expect(planRest(s, defaultRestOptions(s, 'long', '2014', [])).entries).toEqual([]);
	});
});

describe('AC-30 партии', () => {
	it('один PC в двух партиях — одно состояние; смена партии не трогает бой', () => {
		let s = baseState();
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-alex' }, amount: 2, useTemporary: true });
		expect(s.parties.filter((p) => p.characterIds.includes('pc-alex'))).toHaveLength(2);
		expect(Object.keys(s.characters).filter((k) => k === 'pc-alex')).toHaveLength(1);
		s = run(s, { type: 'encounter/create', encounter: { ...structuredClone(s.activeEncounter ?? null), ...{ id: 'enc', name: 'Бой', templateId: null, partyId: 'party-main', startedAt: 'x', round: 0, activeSlotId: null, turnInstanceId: null, turnEnded: false, actedThisRound: [], paused: false, combatants: {}, groups: {}, insertion: [], turnLog: {}, turnLogSeq: 0 } } });
		const encBefore = JSON.stringify(s.activeEncounter);
		s = run(s, { type: 'party/set-active', partyId: 'party-b' });
		expect(s.activePartyId).toBe('party-b');
		expect(JSON.stringify(s.activeEncounter)).toBe(encBefore);
	});
});

describe('история', () => {
	it('лимит 100 действий', () => {
		let s = baseState();
		for (let i = 0; i < 130; i++) s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 0 === i % 2 ? 1 : 0, useTemporary: true });
		expect(s.history.undo.length).toBeLessThanOrEqual(100);
	});

	it('лимит 256 KiB', () => {
		let s = baseState();
		const big = 'x'.repeat(20000);
		for (let i = 0; i < 30; i++) s = run(s, { type: 'adventure/rename', name: `${big}${i}` });
		expect(JSON.stringify(s.history.undo).length).toBeLessThanOrEqual(256 * 1024);
		expect(s.history.undo.length).toBeGreaterThan(0);
	});

	it('новое действие очищает redo; undo/redo последовательность', () => {
		let s = baseState();
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 5, useTemporary: true });
		s = run(s, { type: 'hp/damage', target: { kind: 'character', id: 'pc-bor' }, amount: 5, useTemporary: true });
		s = run(s, { type: 'history/undo' });
		s = run(s, { type: 'history/undo' });
		expect(s.characters['pc-bor']!.hp.current).toBe(30);
		s = run(s, { type: 'history/redo' });
		expect(s.characters['pc-bor']!.hp.current).toBe(25);
		s = run(s, { type: 'hp/heal', target: { kind: 'character', id: 'pc-bor' }, amount: 1 });
		expect(s.history.redo).toHaveLength(0);
	});

	it('патч не зависит от объектов истории (нет общих ссылок)', () => {
		let s = baseState();
		s = run(s, { type: 'character/set-counter', characterId: 'pc-bor', counter: { id: 'c', name: 'C', current: 1, max: 3, recovery: 'manual' } });
		s = run(s, { type: 'history/undo' });
		s = run(s, { type: 'history/redo' });
		s = run(s, { type: 'character/set-counter', characterId: 'pc-bor', counter: { id: 'c', name: 'C', current: 2, max: 3, recovery: 'manual' } });
		s = run(s, { type: 'history/undo' });
		expect(s.characters['pc-bor']!.counters.c!.current).toBe(1);
	});

	it('diff/applyPatch: обратимо', () => {
		const a = baseState();
		const b = run(a, { type: 'party/rename', partyId: 'party-main', name: 'Новое имя' });
		const p = diff(a, b);
		expect(applyPatch(b, p, 'before').parties).toEqual(a.parties);
	});

	it('нечего отменять — понятная ошибка, не исключение', () => {
		const r = dispatch(baseState(), act(baseState(), { type: 'history/redo' }));
		expect(r.error).toMatch(/Нечего/);
	});
});
