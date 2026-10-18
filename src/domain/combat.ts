import { emitEvent, revertEffectChanges } from './effect-clock';
import type { AdventureState, Combatant, EffectChange, Encounter, HitPoints, TurnLogEntry } from './types';

export class DomainError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DomainError';
	}
}

export interface Slot {
	id: string;
	kind: 'single' | 'group';
	name: string;
	memberIds: string[];
	initiative: number | null;
	tieOrder: number;
	insertionIndex: number;
}

/** Initiative order. Individual initiative by default; groups only when explicitly created. */
export function computeSlots(enc: Encounter): Slot[] {
	const slots: Slot[] = [];
	const groupSlots = new Map<string, Slot>();
	enc.insertion.forEach((cid, index) => {
		const c = enc.combatants[cid];
		if (!c) return;
		if (c.initiativeGroupId && enc.groups[c.initiativeGroupId]) {
			const g = enc.groups[c.initiativeGroupId];
			if (!g) return;
			let slot = groupSlots.get(g.id);
			if (!slot) {
				slot = {
					id: g.id,
					kind: 'group',
					name: g.name,
					memberIds: [],
					initiative: g.initiative,
					tieOrder: g.tieOrder,
					insertionIndex: index,
				};
				groupSlots.set(g.id, slot);
				slots.push(slot);
			}
			slot.memberIds.push(cid);
		} else {
			slots.push({
				id: cid,
				kind: 'single',
				name: c.displayName,
				memberIds: [cid],
				initiative: c.initiative,
				tieOrder: c.tieOrder,
				insertionIndex: index,
			});
		}
	});
	slots.sort((a, b) => {
		const ai = a.initiative ?? Number.NEGATIVE_INFINITY;
		const bi = b.initiative ?? Number.NEGATIVE_INFINITY;
		if (ai !== bi) return bi - ai;
		if (a.tieOrder !== b.tieOrder) return a.tieOrder - b.tieOrder;
		return a.insertionIndex - b.insertionIndex;
	});
	return slots;
}

export function slotOf(enc: Encounter, combatantId: string): string | null {
	const c = enc.combatants[combatantId];
	if (!c) return null;
	if (c.initiativeGroupId && enc.groups[c.initiativeGroupId]) return c.initiativeGroupId;
	return c.id;
}

function isSkippable(enc: Encounter, slot: Slot, skipDefeated: boolean): boolean {
	if (slot.memberIds.length === 0) return true;
	if (!skipDefeated) return false;
	return slot.memberIds.every((id) => enc.combatants[id]?.defeated === true);
}

function requireEncounter(state: AdventureState): Encounter {
	if (!state.activeEncounter) throw new DomainError('Нет активного боя');
	return state.activeEncounter;
}

/** «Previous turn» reaches back this many turns (Undo history covers longer spans). */
const TURN_LOG_KEEP = 20;
/** Pruned in batches so most undo patches only contain the newly added entry. */
const TURN_LOG_PRUNE_BATCH = 10;

function pushTurnLog(enc: Encounter, entry: TurnLogEntry): void {
	enc.turnLogSeq += 1;
	enc.turnLog[String(enc.turnLogSeq)] = entry;
	const keys = Object.keys(enc.turnLog);
	if (keys.length > TURN_LOG_KEEP + TURN_LOG_PRUNE_BATCH) {
		const sorted = keys.map(Number).sort((a, b) => a - b);
		for (const k of sorted.slice(0, sorted.length - TURN_LOG_KEEP)) delete enc.turnLog[String(k)];
	}
}

function popTurnLog(enc: Encounter): TurnLogEntry | undefined {
	const keys = Object.keys(enc.turnLog).map(Number).filter(Number.isFinite);
	if (keys.length === 0) return undefined;
	const last = String(Math.max(...keys));
	const entry = enc.turnLog[last];
	delete enc.turnLog[last];
	return entry;
}

export function hasPreviousTurn(enc: Encounter): boolean {
	return Object.keys(enc.turnLog).length > 0;
}

function snapshotTurn(enc: Encounter, changes: EffectChange[]): TurnLogEntry {
	return {
		fromSlotId: enc.activeSlotId,
		fromRound: enc.round,
		fromTurnInstanceId: enc.turnInstanceId,
		fromActed: [...enc.actedThisRound],
		fromTurnEnded: enc.turnEnded,
		changes,
	};
}

function startTurn(state: AdventureState, enc: Encounter, slot: Slot, changes: EffectChange[]): void {
	const ev = emitEvent(state, 'turn-start', slot.memberIds, changes);
	enc.activeSlotId = slot.id;
	enc.turnInstanceId = `ti-${ev.seq}`;
	enc.turnEnded = false;
}

function endCurrentTurn(state: AdventureState, enc: Encounter, slots: Slot[], changes: EffectChange[]): void {
	if (!enc.activeSlotId || enc.turnEnded) return;
	const slot = slots.find((s) => s.id === enc.activeSlotId);
	emitEvent(state, 'turn-end', slot ? slot.memberIds : [], changes);
	enc.turnEnded = true;
	if (!enc.actedThisRound.includes(enc.activeSlotId)) enc.actedThisRound.push(enc.activeSlotId);
}

/** Starts round 1 (initiatives are entered manually beforehand). */
export function beginEncounter(state: AdventureState, skipDefeated: boolean): void {
	const enc = requireEncounter(state);
	if (enc.round > 0) throw new DomainError('Бой уже начат');
	const slots = computeSlots(enc).filter((s) => !isSkippable(enc, s, skipDefeated));
	const first = slots[0];
	if (!first) throw new DomainError('В бою нет участников');
	const changes: EffectChange[] = [];
	const log = snapshotTurn(enc, changes);
	enc.round = 1;
	enc.actedThisRound = [];
	emitEvent(state, 'round-start', [], changes);
	startTurn(state, enc, first, changes);
	pushTurnLog(enc, log);
}

export function nextTurn(state: AdventureState, skipDefeated: boolean): void {
	const enc = requireEncounter(state);
	if (enc.paused) throw new DomainError('Бой на паузе');
	if (enc.round === 0) {
		beginEncounter(state, skipDefeated);
		return;
	}
	const slots = computeSlots(enc);
	const changes: EffectChange[] = [];
	const log = snapshotTurn(enc, changes);
	endCurrentTurn(state, enc, slots, changes);
	const idx = slots.findIndex((s) => s.id === enc.activeSlotId);
	const candidate = slots.find(
		(s, i) => i > idx && !enc.actedThisRound.includes(s.id) && !isSkippable(enc, s, skipDefeated),
	);
	if (candidate) {
		startTurn(state, enc, candidate, changes);
	} else {
		const first = slots.find((s) => !isSkippable(enc, s, skipDefeated));
		if (!first) throw new DomainError('Нет участников, способных ходить');
		emitEvent(state, 'round-end', [], changes);
		enc.round += 1;
		enc.actedThisRound = [];
		emitEvent(state, 'round-start', [], changes);
		startTurn(state, enc, first, changes);
	}
	pushTurnLog(enc, log);
}

export function previousTurn(state: AdventureState): void {
	const enc = requireEncounter(state);
	if (enc.paused) throw new DomainError('Бой на паузе');
	const entry = popTurnLog(enc);
	if (!entry) throw new DomainError('Нет предыдущего хода в журнале боя');
	revertEffectChanges(state, entry.changes);
	enc.activeSlotId = entry.fromSlotId;
	enc.round = entry.fromRound;
	enc.turnInstanceId = entry.fromTurnInstanceId;
	enc.actedThisRound = [...entry.fromActed];
	enc.turnEnded = entry.fromTurnEnded;
}

/** Slots that would be skipped (no events) when jumping from the active slot to `slotId`. */
export function skippedByJump(enc: Encounter, slotId: string): Slot[] {
	const slots = computeSlots(enc);
	const from = slots.findIndex((s) => s.id === enc.activeSlotId);
	const to = slots.findIndex((s) => s.id === slotId);
	if (from < 0 || to < 0 || to <= from) return [];
	return slots.slice(from + 1, to).filter((s) => !enc.actedThisRound.includes(s.id));
}

export function jumpTo(state: AdventureState, slotId: string, endCurrent: boolean): void {
	const enc = requireEncounter(state);
	if (enc.paused) throw new DomainError('Бой на паузе');
	if (enc.round === 0) throw new DomainError('Бой ещё не начат');
	const slots = computeSlots(enc);
	const target = slots.find((s) => s.id === slotId);
	if (!target) throw new DomainError('Участник не найден в порядке инициативы');
	if (target.id === enc.activeSlotId) return;
	const changes: EffectChange[] = [];
	const log = snapshotTurn(enc, changes);
	if (endCurrent) endCurrentTurn(state, enc, slots, changes);
	enc.actedThisRound = enc.actedThisRound.filter((id) => id !== target.id);
	startTurn(state, enc, target, changes);
	pushTurnLog(enc, log);
}

/** Effects whose end event became unreachable are flagged instead of being deleted silently. */
export function flagUnreachable(state: AdventureState, removedCombatantIds: Set<string>): void {
	for (const e of Object.values(state.effects)) {
		if (e.duration.kind === 'turns' && removedCombatantIds.has(e.duration.ownerCombatantId)) e.needsDecision = true;
	}
}

export function removeCombatant(state: AdventureState, combatantId: string, skipDefeated: boolean): void {
	const enc = requireEncounter(state);
	const c = enc.combatants[combatantId];
	if (!c) throw new DomainError('Участник не найден');
	const slotsBefore = computeSlots(enc);
	const slotId = slotOf(enc, combatantId);
	const wasActive = slotId !== null && slotId === enc.activeSlotId;
	const activeSlot = slotsBefore.find((s) => s.id === slotId);
	const slotEmptiesOut = !!activeSlot && activeSlot.memberIds.length === 1;
	const idx = slotsBefore.findIndex((s) => s.id === enc.activeSlotId);

	delete enc.combatants[combatantId];
	enc.insertion = enc.insertion.filter((id) => id !== combatantId);
	if (c.initiativeGroupId && !Object.values(enc.combatants).some((x) => x.initiativeGroupId === c.initiativeGroupId)) {
		delete enc.groups[c.initiativeGroupId];
	}
	// Effects on a removed monster belong to the encounter; PC effects live on the character.
	for (const [id, e] of Object.entries(state.effects)) {
		if (e.target.kind === 'combatant' && e.target.id === combatantId) delete state.effects[id];
	}
	flagUnreachable(state, new Set([combatantId]));

	if (wasActive && slotEmptiesOut && enc.round > 0) {
		// The active participant left: the turn passes to the next eligible slot.
		enc.turnLog = {};
		const slots = computeSlots(enc);
		const after = slotsBefore
			.slice(idx + 1)
			.map((s) => slots.find((x) => x.id === s.id))
			.find((s): s is Slot => !!s && !enc.actedThisRound.includes(s.id) && !isSkippable(enc, s, skipDefeated));
		const changes: EffectChange[] = [];
		enc.activeSlotId = null;
		if (after) {
			startTurn(state, enc, after, changes);
		} else {
			const first = slots.find((s) => !isSkippable(enc, s, skipDefeated));
			if (first) {
				emitEvent(state, 'round-end', [], changes);
				enc.round += 1;
				enc.actedThisRound = [];
				emitEvent(state, 'round-start', [], changes);
				startTurn(state, enc, first, changes);
			} else {
				enc.turnInstanceId = null;
			}
		}
	}
	enc.actedThisRound = enc.actedThisRound.filter((id) => id !== combatantId);
}

/** Swap tie order with the neighbour of equal initiative. */
export function moveInTies(enc: Encounter, slotId: string, direction: -1 | 1): void {
	const slots = computeSlots(enc);
	const i = slots.findIndex((s) => s.id === slotId);
	const me = slots[i];
	const other = slots[i + direction];
	if (!me || !other) throw new DomainError('Некуда переместить');
	if ((me.initiative ?? null) !== (other.initiative ?? null)) {
		throw new DomainError('Переставлять можно только участников с равной инициативой');
	}
	// Normalise tie orders of the equal-initiative block, then swap.
	const block = slots.filter((s) => (s.initiative ?? null) === (me.initiative ?? null));
	block.forEach((s, k) => setTieOrder(enc, s, k * 10));
	const myTie = block.findIndex((s) => s.id === me.id) * 10;
	const otherTie = block.findIndex((s) => s.id === other.id) * 10;
	setTieOrder(enc, me, otherTie);
	setTieOrder(enc, other, myTie);
}

function setTieOrder(enc: Encounter, slot: Slot, value: number): void {
	if (slot.kind === 'group') {
		const g = enc.groups[slot.id];
		if (g) g.tieOrder = value;
	} else {
		const c = enc.combatants[slot.id];
		if (c) c.tieOrder = value;
	}
}

export function nextTieOrder(enc: Encounter): number {
	let max = 0;
	for (const c of Object.values(enc.combatants)) max = Math.max(max, c.tieOrder);
	for (const g of Object.values(enc.groups)) max = Math.max(max, g.tieOrder);
	return max + 10;
}

/** HP holder for a combatant: PCs share the persistent character HP. */
export function hpOf(state: AdventureState, c: Combatant): HitPoints | null {
	if (c.characterId) return state.characters[c.characterId]?.hp ?? null;
	return c.hp;
}

export function effectiveAc(state: AdventureState, c: Combatant): number | null {
	if (c.acOverride !== null) return c.acOverride;
	if (c.characterId) return state.characters[c.characterId]?.ac ?? null;
	return c.ac;
}
