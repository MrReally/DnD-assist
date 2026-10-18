import type { AdventureState, HistoryEntry, HistoryLimits, PatchOp } from './types';

/** Keys of AdventureState that are bookkeeping and never part of undoable game state. */
const NON_GAME_KEYS = new Set(['history', 'appliedActionIds', 'revision', 'schemaVersion', 'stateId']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== 'object' || a === null || b === null) return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Structural diff. Plain objects are recursed into, arrays and primitives are leaves.
 * Records keyed by id therefore produce small patches.
 */
export function diff(before: unknown, after: unknown, path: string[] = [], out: PatchOp[] = []): PatchOp[] {
	if (isPlainObject(before) && isPlainObject(after)) {
		const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
		for (const k of keys) {
			if (path.length === 0 && NON_GAME_KEYS.has(k)) continue;
			const hasB = Object.prototype.hasOwnProperty.call(before, k);
			const hasA = Object.prototype.hasOwnProperty.call(after, k);
			const b = before[k];
			const a = after[k];
			if (hasB && hasA) {
				if (b === a) continue;
				diff(b, a, [...path, k], out);
			} else if (hasB) {
				out.push({ path: [...path, k], before: b });
			} else {
				out.push({ path: [...path, k], after: a });
			}
		}
		return out;
	}
	if (!jsonEqual(before, after)) out.push({ path, before, after });
	return out;
}

function setPath(root: Record<string, unknown>, path: string[], value: unknown): void {
	if (path.length === 0) throw new Error('Пустой путь патча');
	let cur: Record<string, unknown> = root;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i] as string;
		let next = cur[key];
		if (!isPlainObject(next)) {
			if (value === undefined) return;
			next = {};
			cur[key] = next;
		}
		cur = next as Record<string, unknown>;
	}
	const last = path[path.length - 1] as string;
	if (value === undefined) delete cur[last];
	else cur[last] = structuredClone(value);
}

/** Applies one side of a patch to a fresh clone of the state. */
export function applyPatch(state: AdventureState, patch: PatchOp[], side: 'before' | 'after'): AdventureState {
	const next = cloneGameState(state);
	const ops = side === 'before' ? [...patch].reverse() : patch;
	for (const op of ops) setPath(next as unknown as Record<string, unknown>, op.path, op[side]);
	return next;
}

/** Deep clone of everything except history/bookkeeping arrays (shared, never mutated). */
export function cloneGameState(state: AdventureState): AdventureState {
	const { history, appliedActionIds, ...rest } = state;
	const copy = structuredClone(rest) as Omit<AdventureState, 'history' | 'appliedActionIds'>;
	return { ...copy, history, appliedActionIds };
}

export function entrySize(entry: HistoryEntry): number {
	return JSON.stringify(entry).length;
}

/** Trims undo history to the configured limits, dropping the oldest entries first. */
export function trimHistory(undo: HistoryEntry[], limits: HistoryLimits): HistoryEntry[] {
	let list = undo.length > limits.maxEntries ? undo.slice(undo.length - limits.maxEntries) : undo;
	let total = 0;
	const sizes = list.map(entrySize);
	for (const s of sizes) total += s;
	let start = 0;
	while (total > limits.maxBytes && start < list.length - 1) {
		total -= sizes[start] as number;
		start++;
	}
	if (start > 0) list = list.slice(start);
	return list;
}
