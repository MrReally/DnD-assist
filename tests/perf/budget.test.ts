// Performance budgets from spec §12 measured as unit benchmarks (Node, no Obsidian).
// Numbers are written to tests/perf/out/perf.json for docs/test-report.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildItems, searchItems } from '../../src/domain/canvas-model';
import { dispatch } from '../../src/domain/reducer';
import { serializeState } from '../../src/domain/state';
import type { AdventureState, Combatant } from '../../src/domain/types';
import { act, baseState, effect, monster, run, withEncounter } from '../helpers';

const results: Record<string, unknown> = {};

function p(values: number[], q: number): number {
	const s = [...values].sort((a, b) => a - b);
	return Math.round((s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0) * 1000) / 1000;
}

function bigEncounter(n: number, effects: number): AdventureState {
	const many: Combatant[] = Array.from({ length: n }, (_, i) => monster(`m${i}`, `Монстр ${i}`, 100 - (i % 60), 10, i * 10));
	let s = withEncounter(baseState(), many);
	for (let i = 0; i < effects; i++) {
		s = run(s, { type: 'effect/add', effect: effect(`e${i}`, `m${i % n}`, { kind: 'turns', ownerCombatantId: `m${i % n}`, phase: 'end', remaining: 1000 }) });
	}
	return run(s, { type: 'encounter/begin' });
}

describe('бюджеты производительности', () => {
	it('редьюсер «следующий ход», 100 участников / 200 эффектов: p95 ≤ 10 мс', () => {
		let s = bigEncounter(100, 200);
		const times: number[] = [];
		for (let i = 0; i < 200; i++) {
			const a = act(s, { type: 'encounter/next' });
			const t0 = performance.now();
			s = dispatch(s, a).state;
			times.push(performance.now() - t0);
		}
		const serial: number[] = [];
		for (let i = 0; i < 30; i++) {
			const t0 = performance.now();
			serializeState(s);
			serial.push(performance.now() - t0);
		}
		results.nextTurn = { p50: p(times, 0.5), p95: p(times, 0.95), serializeP95: p(serial, 0.95), stateBytes: serializeState(s).length, historyEntries: s.history.undo.length };
		expect(p(times, 0.95)).toBeLessThanOrEqual(10);
	});

	it('поиск по прогретому Canvas: 100/500/2000 узлов, p95 ≤ 80 мс на 500', () => {
		const out: Record<string, unknown> = {};
		for (const n of [100, 500, 2000]) {
			const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: i % 5 === 0 ? 'group' : 'text', label: i % 5 === 0 ? (i % 2 ? 'NPC' : 'Лут') : undefined, text: `Узел ${i}: гоблин ёж таверна «Ёлка» №${i}`, x: (i % 40) * 300, y: Math.floor(i / 40) * 200, width: 250, height: 120 }));
			const t0 = performance.now();
			const items = buildItems({ nodes, edges: [], warnings: [] }, { foldYo: true, overrides: {} });
			const build = performance.now() - t0;
			const times: number[] = [];
			for (let i = 0; i < 50; i++) {
				const t1 = performance.now();
				searchItems(items, ['гоб', 'елка 1', 'таверна', 'zzz', 'узел 4'][i % 5] ?? '', { foldYo: true, includeIgnored: false, limit: 60 });
				times.push(performance.now() - t1);
			}
			out[n] = { buildMs: Math.round(build * 100) / 100, searchP50: p(times, 0.5), searchP95: p(times, 0.95) };
			if (n === 500) expect(p(times, 0.95)).toBeLessThanOrEqual(80);
		}
		results.search = out;
	});

	it('размер состояния при типичном использовании < 1 МиБ, история ограничена', () => {
		let s = bigEncounter(12, 20);
		for (let i = 0; i < 500; i++) {
			s = run(s, i % 3 === 0 ? { type: 'encounter/next' } : { type: 'hp/damage', target: { kind: 'combatant', id: `m${i % 12}` }, amount: 1, useTemporary: true });
			if (i % 50 === 0) s = run(s, { type: 'hp/heal', target: { kind: 'combatant', id: `m${i % 12}` }, amount: 100 });
		}
		const bytes = serializeState(s).length;
		results.typicalState = { bytes, historyEntries: s.history.undo.length, historyBytes: JSON.stringify(s.history).length };
		expect(bytes).toBeLessThan(1024 * 1024);
		expect(s.history.undo.length).toBeLessThanOrEqual(100);
	});

	it('1/10/100 PC: долгий отдых и урон', () => {
		const out: Record<string, unknown> = {};
		for (const n of [1, 10, 100]) {
			let s = baseState();
			for (let i = 0; i < n; i++) s = run(s, { type: 'character/upsert', character: { ...s.characters['pc-bor']!, id: `pc${i}`, name: `PC ${i}` } });
			const t0 = performance.now();
			for (let i = 0; i < n; i++) s = run(s, { type: 'hp/damage', target: { kind: 'character', id: `pc${i}` }, amount: 1, useTemporary: true });
			out[n] = { damageAllMs: Math.round((performance.now() - t0) * 100) / 100 };
		}
		results.characters = out;
		mkdirSync(join(__dirname, 'out'), { recursive: true });
		writeFileSync(join(__dirname, 'out', 'perf.json'), JSON.stringify(results, null, 2));
	});
});
