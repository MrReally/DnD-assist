import type { AdventureState, Effect, EffectChange, TurnEventType } from './types';

export interface TurnEvent {
	type: TurnEventType;
	/** Combatants whose turn starts/ends (empty for round events). */
	combatantIds: string[];
	seq: number;
}

function matches(effect: Effect, ev: TurnEvent): boolean {
	if (effect.needsDecision) return false;
	if (effect.createdAtEventSeq >= ev.seq) return false;
	const d = effect.duration;
	if (d.kind === 'turns') {
		const want: TurnEventType = d.phase === 'start' ? 'turn-start' : 'turn-end';
		return ev.type === want && ev.combatantIds.includes(d.ownerCombatantId);
	}
	if (d.kind === 'rounds') {
		const want: TurnEventType = d.phase === 'start' ? 'round-start' : 'round-end';
		return ev.type === want;
	}
	return false;
}

/**
 * Emits one event: assigns the next eventSeq and ticks matching effect durations.
 * Mutates `state` (callers pass a fresh clone). Returns the effect changes for the turn log.
 */
export function emitEvent(
	state: AdventureState,
	type: TurnEventType,
	combatantIds: string[],
	changes: EffectChange[],
): TurnEvent {
	state.eventSeq += 1;
	const ev: TurnEvent = { type, combatantIds, seq: state.eventSeq };
	for (const id of Object.keys(state.effects)) {
		const effect = state.effects[id] as Effect;
		if (!matches(effect, ev)) continue;
		const d = effect.duration;
		if (d.kind !== 'turns' && d.kind !== 'rounds') continue;
		const before = structuredClone(effect);
		const remaining = d.remaining - 1;
		if (remaining <= 0) {
			delete state.effects[id];
			changes.push({ effectId: id, before, after: null });
		} else {
			const after: Effect = { ...effect, duration: { ...d, remaining } };
			state.effects[id] = after;
			changes.push({ effectId: id, before, after: structuredClone(after) });
		}
	}
	return ev;
}

/** Reverts effect changes recorded for a turn advance, newest first. */
export function revertEffectChanges(state: AdventureState, changes: EffectChange[]): void {
	for (let i = changes.length - 1; i >= 0; i--) {
		const ch = changes[i] as EffectChange;
		const current = state.effects[ch.effectId];
		if (ch.after === null) {
			if (!current) state.effects[ch.effectId] = structuredClone(ch.before);
		} else if (current && JSON.stringify(current) === JSON.stringify(ch.after)) {
			state.effects[ch.effectId] = structuredClone(ch.before);
		}
	}
}

/** Human readable remaining time for UI. */
export function describeDuration(effect: Effect, nameOf: (combatantId: string) => string, clockMinutes: number): string {
	const d = effect.duration;
	if (effect.needsDecision) return 'требует решения мастера';
	switch (d.kind) {
		case 'manual':
			return 'без срока';
		case 'turns': {
			const phase = d.phase === 'start' ? 'начало' : 'конец';
			return `осталось ${d.remaining} · истекает: ${phase} хода «${nameOf(d.ownerCombatantId)}» (${d.remaining}-й)`;
		}
		case 'rounds': {
			const phase = d.phase === 'start' ? 'начало' : 'конец';
			return `осталось ${d.remaining} р. · истекает: ${phase} раунда (${d.remaining}-й)`;
		}
		case 'game-time': {
			const left = d.expiresAtMinute - clockMinutes;
			return left > 0 ? `осталось ${formatMinutes(left)} игрового времени` : 'время истекло';
		}
	}
}

export function shortDuration(effect: Effect, clockMinutes: number): string {
	const d = effect.duration;
	if (effect.needsDecision) return '?';
	switch (d.kind) {
		case 'manual':
			return '∞';
		case 'turns':
			return `${d.remaining} х.`;
		case 'rounds':
			return `${d.remaining} р.`;
		case 'game-time':
			return formatMinutes(Math.max(0, d.expiresAtMinute - clockMinutes));
	}
}

export function formatMinutes(total: number): string {
	const m = Math.max(0, Math.round(total));
	const days = Math.floor(m / 1440);
	const hours = Math.floor((m % 1440) / 60);
	const mins = m % 60;
	const parts: string[] = [];
	if (days) parts.push(`${days} д.`);
	if (hours) parts.push(`${hours} ч.`);
	if (mins || parts.length === 0) parts.push(`${mins} мин.`);
	return parts.join(' ');
}

export function formatClock(total: number): string {
	const m = Math.max(0, Math.round(total));
	const day = Math.floor(m / 1440) + 1;
	const hh = String(Math.floor((m % 1440) / 60)).padStart(2, '0');
	const mm = String(m % 60).padStart(2, '0');
	return `День ${day}, ${hh}:${mm}`;
}
