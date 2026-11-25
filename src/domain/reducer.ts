import { ACTION_LABELS, type Action } from './actions';
import {
	DomainError,
	beginEncounter,
	jumpTo,
	moveInTies,
	nextTieOrder,
	nextTurn,
	previousTurn,
	removeCombatant,
	computeSlots,
	slotOf,
} from './combat';
import { addCombatant } from './encounter';
import { reduceCockpit } from './cockpit-reducer';
import { applyDamage, applyHealing, setTemporary } from './hp';
import type { AdventureState, CharacterState, Effect, EffectTarget, HistoryEntry, HistoryLimits, HitPoints } from './types';
import { DEFAULT_HISTORY_LIMITS } from './types';
import { applyPatch, cloneGameState, diff, trimHistory } from './undo';

export interface ReducerOptions {
	skipDefeated: boolean;
	history: HistoryLimits;
}

export const DEFAULT_REDUCER_OPTIONS: ReducerOptions = { skipDefeated: true, history: DEFAULT_HISTORY_LIMITS };

export interface DispatchResult {
	state: AdventureState;
	/** false when the action was a duplicate or produced no change. */
	changed: boolean;
	duplicate: boolean;
	label: string;
	error?: string;
}

const APPLIED_IDS_KEEP = 500;

function int(v: unknown, name: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
		throw new DomainError(`Недопустимое значение «${name}»`);
	}
	return v;
}

function nullableInt(v: unknown, name: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number | null {
	return v === null ? null : int(v, name, min, max);
}

function character(state: AdventureState, id: string): CharacterState {
	const ch = state.characters[id];
	if (!ch) throw new DomainError('Персонаж не найден в этом приключении');
	return ch;
}

function hpHolder(state: AdventureState, target: EffectTarget): { get: () => HitPoints; set: (hp: HitPoints) => void } {
	if (target.kind === 'character') {
		const ch = character(state, target.id);
		return { get: () => ch.hp, set: (hp) => (ch.hp = hp) };
	}
	const c = state.activeEncounter?.combatants[target.id];
	if (!c) throw new DomainError('Цель не найдена в текущем бою');
	if (c.characterId) return hpHolder(state, { kind: 'character', id: c.characterId });
	if (!c.hp) c.hp = { current: 0, max: null, temporary: 0 };
	return { get: () => c.hp as HitPoints, set: (hp) => (c.hp = hp) };
}

function validateHp(hp: HitPoints): void {
	int(hp.current, 'текущие хиты', 0, 100000);
	if (hp.max !== null) int(hp.max, 'максимум хитов', 0, 100000);
	int(hp.temporary, 'временные хиты', 0, 100000);
}

function requireEffectTarget(state: AdventureState, e: Effect): void {
	if (e.target.kind === 'character') character(state, e.target.id);
	else if (!state.activeEncounter?.combatants[e.target.id]) throw new DomainError('Цель эффекта не найдена в бою');
}

/** Applies a payload to a fresh clone. Throws DomainError on invalid input. */
function reduce(s: AdventureState, a: Action, opts: ReducerOptions): void {
	switch (a.type) {
		case 'adventure/rename':
			s.name = a.name.trim() || s.name;
			return;
		case 'party/create':
			if (s.parties.some((p) => p.id === a.party.id)) throw new DomainError('Партия уже существует');
			s.parties.push({ ...a.party, characterIds: a.party.characterIds.filter((id) => !!s.characters[id]) });
			if (!s.activePartyId) s.activePartyId = a.party.id;
			return;
		case 'party/rename': {
			const p = s.parties.find((x) => x.id === a.partyId);
			if (!p) throw new DomainError('Партия не найдена');
			p.name = a.name.trim() || p.name;
			return;
		}
		case 'party/delete':
			s.parties = s.parties.filter((p) => p.id !== a.partyId);
			if (s.activePartyId === a.partyId) s.activePartyId = s.parties[0]?.id ?? null;
			return;
		case 'party/set-members': {
			const p = s.parties.find((x) => x.id === a.partyId);
			if (!p) throw new DomainError('Партия не найдена');
			p.characterIds = [...new Set(a.characterIds)].filter((id) => !!s.characters[id]);
			return;
		}
		case 'party/set-active':
			if (a.partyId !== null && !s.parties.some((p) => p.id === a.partyId)) throw new DomainError('Партия не найдена');
			s.activePartyId = a.partyId;
			return;
		case 'character/upsert':
			validateHp(a.character.hp);
			s.characters[a.character.id] = structuredClone(a.character);
			return;
		case 'character/remove':
			delete s.characters[a.characterId];
			for (const p of s.parties) p.characterIds = p.characterIds.filter((id) => id !== a.characterId);
			for (const [id, e] of Object.entries(s.effects)) {
				if (e.target.kind === 'character' && e.target.id === a.characterId) delete s.effects[id];
			}
			return;
		case 'character/set-fields': {
			const ch = character(s, a.characterId);
			const p = a.patch;
			if (p.name !== undefined) ch.name = p.name.trim() || ch.name;
			if (p.ac !== undefined) ch.ac = nullableInt(p.ac, 'КД', 0, 100);
			if (p.initiativeModifier !== undefined) ch.initiativeModifier = nullableInt(p.initiativeModifier, 'инициатива', -30, 30);
			if (p.speedFeet !== undefined) ch.speedFeet = nullableInt(p.speedFeet, 'скорость', 0, 1000);
			if (p.inspiration !== undefined) ch.inspiration = !!p.inspiration;
			if (p.exhaustion !== undefined) ch.exhaustion = int(p.exhaustion, 'истощение', 0, 6);
			if (p.deathSaves !== undefined) {
				ch.deathSaves = {
					successes: int(p.deathSaves.successes, 'успехи', 0, 3),
					failures: int(p.deathSaves.failures, 'провалы', 0, 3),
				};
			}
			return;
		}
		case 'character/set-hp': {
			const ch = character(s, a.characterId);
			const hp: HitPoints = { ...ch.hp };
			if (a.max !== undefined) hp.max = nullableInt(a.max, 'максимум хитов', 0, 100000);
			if (a.current !== undefined) hp.current = int(a.current, 'текущие хиты', 0, 100000);
			if (a.temporary !== undefined) hp.temporary = int(a.temporary, 'временные хиты', 0, 100000);
			if (hp.max !== null && hp.current > hp.max) hp.current = hp.max;
			ch.hp = hp;
			return;
		}
		case 'character/set-slot': {
			const ch = character(s, a.characterId);
			if (!/^[1-9]$/.test(a.level)) throw new DomainError('Уровень ячейки 1–9');
			if (a.slot === null) delete ch.spellSlots[a.level];
			else {
				const max = int(a.slot.max, 'максимум ячеек', 0, 99);
				const current = int(a.slot.current, 'ячейки', 0, max);
				ch.spellSlots[a.level] = { current, max };
			}
			return;
		}
		case 'character/set-counter': {
			const ch = character(s, a.characterId);
			const c = a.counter;
			const max = nullableInt(c.max, 'максимум счётчика', 0, 100000);
			const current = int(c.current, 'значение счётчика', 0, max ?? 100000);
			ch.counters[c.id] = { id: c.id, name: c.name.trim() || 'Счётчик', current, max, recovery: c.recovery };
			return;
		}
		case 'character/remove-counter':
			delete character(s, a.characterId).counters[a.counterId];
			return;
		case 'character/set-hit-dice': {
			const ch = character(s, a.characterId);
			for (const h of a.hitDice) {
				int(h.total, 'кости хитов', 0, 40);
				int(h.remaining, 'оставшиеся кости', 0, h.total);
			}
			ch.hitDice = structuredClone(a.hitDice);
			return;
		}
		case 'hp/damage': {
			const h = hpHolder(s, a.target);
			h.set(applyDamage(h.get(), int(a.amount, 'урон', 0, 100000), a.useTemporary).hp);
			return;
		}
		case 'hp/heal': {
			const h = hpHolder(s, a.target);
			h.set(applyHealing(h.get(), int(a.amount, 'лечение', 0, 100000)));
			return;
		}
		case 'hp/set-temporary': {
			const h = hpHolder(s, a.target);
			h.set(setTemporary(h.get(), int(a.value, 'временные хиты', 0, 100000)));
			return;
		}
		case 'creature/upsert':
			s.creatures[a.creature.id] = structuredClone(a.creature);
			return;
		case 'creature/remove':
			delete s.creatures[a.creatureId];
			return;
		case 'template/upsert': {
			const i = s.encounterTemplates.findIndex((t) => t.id === a.template.id);
			const t = structuredClone(a.template);
			if (i >= 0) s.encounterTemplates[i] = t;
			else s.encounterTemplates.push(t);
			return;
		}
		case 'template/remove':
			s.encounterTemplates = s.encounterTemplates.filter((t) => t.id !== a.templateId);
			return;
		case 'encounter/create':
			if (s.activeEncounter) throw new DomainError('Сначала завершите текущий бой');
			s.activeEncounter = structuredClone(a.encounter);
			return;
		case 'encounter/begin':
			beginEncounter(s, opts.skipDefeated);
			return;
		case 'encounter/end': {
			const enc = s.activeEncounter;
			if (!enc) throw new DomainError('Нет активного боя');
			const ids = new Set(Object.keys(enc.combatants));
			for (const [id, e] of Object.entries(s.effects)) {
				if (e.target.kind === 'combatant' && ids.has(e.target.id)) {
					delete s.effects[id];
				} else if (e.duration.kind === 'turns' || e.duration.kind === 'rounds') {
					// Combat-time durations cannot continue after the encounter: GM decides.
					e.needsDecision = true;
				}
				if (e.sourceCombatantId && ids.has(e.sourceCombatantId)) {
					const src = enc.combatants[e.sourceCombatantId];
					if (src && !e.sourceLabel) e.sourceLabel = src.displayName;
					e.sourceCombatantId = null;
				}
			}
			s.activeEncounter = null;
			return;
		}
		case 'encounter/add-combatants': {
			const enc = s.activeEncounter;
			if (!enc) throw new DomainError('Нет активного боя');
			for (const g of a.groups ?? []) enc.groups[g.id] = structuredClone(g);
			let tie = nextTieOrder(enc);
			for (const c of a.combatants) {
				if (enc.combatants[c.id]) throw new DomainError('Повтор идентификатора участника');
				if (c.characterId) {
					character(s, c.characterId);
					if (Object.values(enc.combatants).some((x) => x.characterId === c.characterId)) {
						throw new DomainError('Этот персонаж уже участвует в бою');
					}
				}
				addCombatant(enc, { ...structuredClone(c), tieOrder: c.tieOrder || tie });
				tie += 10;
			}
			return;
		}
		case 'encounter/remove-combatant':
			removeCombatant(s, a.combatantId, opts.skipDefeated);
			return;
		case 'encounter/update-combatant': {
			const c = s.activeEncounter?.combatants[a.combatantId];
			if (!c) throw new DomainError('Участник не найден');
			const p = a.patch;
			if (p.displayName !== undefined) c.displayName = p.displayName.trim() || c.displayName;
			if (p.initiative !== undefined) c.initiative = nullableInt(p.initiative, 'инициатива', -50, 100);
			if (p.initiativeModifier !== undefined) c.initiativeModifier = nullableInt(p.initiativeModifier, 'модификатор', -30, 30);
			if (p.ac !== undefined) c.ac = nullableInt(p.ac, 'КД', 0, 100);
			if (p.acOverride !== undefined) c.acOverride = nullableInt(p.acOverride, 'КД', 0, 100);
			if (p.defeated !== undefined) c.defeated = !!p.defeated;
			if (p.tieOrder !== undefined) c.tieOrder = int(p.tieOrder, 'порядок', -1e9, 1e9);
			if (p.hpMax !== undefined && !c.characterId) {
				const max = nullableInt(p.hpMax, 'максимум хитов', 0, 100000);
				const hp = c.hp ?? { current: 0, max: null, temporary: 0 };
				const wasUnknown = hp.max === null;
				c.hp = { ...hp, max, current: max === null ? hp.current : wasUnknown ? max : Math.min(hp.current, max) };
			}
			return;
		}
		case 'encounter/set-group': {
			const enc = s.activeEncounter;
			if (!enc) throw new DomainError('Нет активного боя');
			// Remember members of the active and acted slots so turn state survives regrouping.
			const before = computeSlots(enc);
			const activeMembers = before.find((x) => x.id === enc.activeSlotId)?.memberIds ?? [];
			const actedMembers = before.filter((x) => enc.actedThisRound.includes(x.id)).flatMap((x) => x.memberIds);
			if (a.group) enc.groups[a.group.id] = structuredClone(a.group);
			for (const id of a.combatantIds) {
				const c = enc.combatants[id];
				if (!c) throw new DomainError('Участник не найден');
				// Individual HP/effects remain untouched; only turn order membership changes.
				c.initiativeGroupId = a.group?.id ?? null;
			}
			for (const g of Object.keys(enc.groups)) {
				if (!Object.values(enc.combatants).some((c) => c.initiativeGroupId === g)) delete enc.groups[g];
			}
			const after = new Set(computeSlots(enc).map((x) => x.id));
			if (enc.activeSlotId && !after.has(enc.activeSlotId)) {
				const member = activeMembers.find((m) => enc.combatants[m]);
				enc.activeSlotId = member ? slotOf(enc, member) : null;
			}
			enc.actedThisRound = [...new Set(actedMembers.map((m) => slotOf(enc, m)).filter((x): x is string => !!x && after.has(x)))];
			return;
		}
		case 'encounter/update-group': {
			const g = s.activeEncounter?.groups[a.groupId];
			if (!g) throw new DomainError('Группа не найдена');
			if (a.patch.name !== undefined) g.name = a.patch.name.trim() || g.name;
			if (a.patch.initiative !== undefined) g.initiative = nullableInt(a.patch.initiative, 'инициатива', -50, 100);
			return;
		}
		case 'encounter/move-in-ties': {
			const enc = s.activeEncounter;
			if (!enc) throw new DomainError('Нет активного боя');
			moveInTies(enc, a.slotId, a.direction);
			return;
		}
		case 'encounter/next':
			nextTurn(s, opts.skipDefeated);
			return;
		case 'encounter/previous':
			previousTurn(s);
			return;
		case 'encounter/jump':
			jumpTo(s, a.slotId, a.endCurrent);
			return;
		case 'encounter/pause': {
			const enc = s.activeEncounter;
			if (!enc) throw new DomainError('Нет активного боя');
			enc.paused = a.paused;
			return;
		}
		case 'effect/add': {
			if (s.effects[a.effect.id]) throw new DomainError('Повтор идентификатора эффекта');
			const e = structuredClone(a.effect);
			e.createdAtEventSeq = s.eventSeq;
			requireEffectTarget(s, e);
			if (e.duration.kind === 'turns' || e.duration.kind === 'rounds') {
				int(e.duration.remaining, 'длительность', 1, 10000);
				if (e.duration.kind === 'turns' && !s.activeEncounter?.combatants[e.duration.ownerCombatantId]) {
					throw new DomainError('Владелец длительности не найден в бою');
				}
			}
			if (e.duration.kind === 'game-time') int(e.duration.expiresAtMinute, 'время', 0);
			s.effects[e.id] = e;
			return;
		}
		case 'effect/update': {
			const e = s.effects[a.effectId];
			if (!e) throw new DomainError('Эффект не найден');
			const p = a.patch;
			if (p.label !== undefined) e.label = p.label.trim() || e.label;
			if (p.notes !== undefined) e.notes = p.notes;
			if (p.sourceCombatantId !== undefined) e.sourceCombatantId = p.sourceCombatantId;
			if (p.sourceLabel !== undefined) e.sourceLabel = p.sourceLabel;
			if (p.concentrationEffectId !== undefined) e.concentrationEffectId = p.concentrationEffectId;
			if (p.target !== undefined) {
				e.target = p.target;
				requireEffectTarget(s, e);
			}
			if (p.duration !== undefined) {
				e.duration = structuredClone(p.duration);
				// A changed duration counts only future events.
				e.createdAtEventSeq = s.eventSeq;
				e.needsDecision = false;
			}
			if (p.needsDecision !== undefined) e.needsDecision = p.needsDecision;
			return;
		}
		case 'effect/remove':
			for (const id of a.effectIds) delete s.effects[id];
			return;
		case 'concentration/end': {
			const e = s.effects[a.effectId];
			if (!e) throw new DomainError('Эффект концентрации не найден');
			delete s.effects[a.effectId];
			for (const id of a.removeLinkedIds) {
				if (s.effects[id]?.concentrationEffectId === a.effectId) delete s.effects[id];
			}
			for (const other of Object.values(s.effects)) {
				if (other.concentrationEffectId === a.effectId) other.concentrationEffectId = null;
			}
			return;
		}
		case 'rest/apply':
			for (const ch of a.changes) {
				character(s, ch.characterId);
				validateHp(ch.after.hp);
				s.characters[ch.characterId] = structuredClone(ch.after);
			}
			for (const id of a.removeEffectIds) delete s.effects[id];
			return;
		case 'clock/advance': {
			const minutes = int(a.minutes, 'минуты', -100000, 1000000);
			s.gameClock.minutes = Math.max(0, s.gameClock.minutes + minutes);
			for (const [id, e] of Object.entries(s.effects)) {
				if (e.duration.kind === 'game-time' && e.duration.expiresAtMinute <= s.gameClock.minutes) delete s.effects[id];
			}
			return;
		}
		case 'node/override': {
			const map = (s.nodeOverrides[a.canvasPath] ??= {});
			if (a.category === null) delete map[a.nodeId];
			else map[a.nodeId] = a.category;
			if (Object.keys(map).length === 0) delete s.nodeOverrides[a.canvasPath];
			return;
		}
		case 'import/apply':
			for (const ch of a.characters) {
				validateHp(ch.hp);
				s.characters[ch.id] = structuredClone(ch);
			}
			if (a.addToPartyId) {
				const p = s.parties.find((x) => x.id === a.addToPartyId);
				if (!p) throw new DomainError('Партия не найдена');
				for (const ch of a.characters) if (!p.characterIds.includes(ch.id)) p.characterIds.push(ch.id);
			}
			return;
		case 'cockpit/cast': {
			const ch = character(s, a.characterId);
			const lvl = int(a.slotLevel, 'уровень ячейки', 0, 9);
			if (lvl > 0) {
				const slot = ch.spellSlots[String(lvl)];
				if (!slot || slot.current <= 0) throw new DomainError(`Нет свободных ячеек ${lvl} уровня`);
				ch.spellSlots[String(lvl)] = { ...slot, current: slot.current - 1 };
			}
			if (a.effect) reduce(s, { ...a, type: 'effect/add', effect: a.effect }, opts);
			return;
		}
		case 'cockpit/sheet-set':
		case 'cockpit/statblock-set':
		case 'cockpit/npc-create':
		case 'cockpit/character-build':
		case 'cockpit/item-upsert':
		case 'cockpit/item-remove':
		case 'cockpit/item-transfer':
		case 'cockpit/purse-set':
		case 'cockpit/itemtype-upsert':
		case 'cockpit/spellbook-set':
		case 'cockpit/viewpoint-set':
			reduceCockpit(s, a);
			return;
		case 'history/undo':
		case 'history/redo':
			return;
	}
}

function rememberId(state: AdventureState, actionId: string): string[] {
	const ids = [...state.appliedActionIds, actionId];
	return ids.length > APPLIED_IDS_KEEP ? ids.slice(ids.length - APPLIED_IDS_KEEP) : ids;
}

/**
 * Single entry point for every mutation. Pure: returns a new state, never mutates input.
 * Duplicate actionIds are ignored (idempotency across restarts/sync).
 */
export function dispatch(state: AdventureState, action: Action, opts: ReducerOptions = DEFAULT_REDUCER_OPTIONS): DispatchResult {
	const label = ACTION_LABELS[action.type] ?? action.type;
	if (action.adventureId !== state.adventureId) {
		return { state, changed: false, duplicate: false, label, error: 'Действие относится к другому приключению' };
	}
	if (state.appliedActionIds.includes(action.actionId)) {
		return { state, changed: false, duplicate: true, label };
	}
	try {
		if (action.type === 'history/undo' || action.type === 'history/redo') {
			return historyStep(state, action, label);
		}
		const draft = cloneGameState(state);
		reduce(draft, action, opts);
		const patch = diff(state, draft);
		const base = { ...draft, appliedActionIds: rememberId(state, action.actionId), revision: state.revision + 1 };
		if (patch.length === 0) {
			return { state: { ...base, history: state.history }, changed: false, duplicate: false, label };
		}
		const entry: HistoryEntry = {
			actionId: action.actionId,
			type: action.type,
			label: describeAction(state, action, label),
			at: action.at,
			adventureId: state.adventureId,
			patch,
		};
		if (action.type === 'import/apply' && action.files?.length) entry.files = action.files;
		const undo = trimHistory([...state.history.undo, entry], opts.history);
		return { state: { ...base, history: { undo, redo: [] } }, changed: true, duplicate: false, label: entry.label };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { state, changed: false, duplicate: false, label, error: message };
	}
}

function historyStep(state: AdventureState, action: Action, label: string): DispatchResult {
	const undoing = action.type === 'history/undo';
	const from = undoing ? state.history.undo : state.history.redo;
	const entry = from[from.length - 1];
	if (!entry) return { state, changed: false, duplicate: false, label, error: undoing ? 'Нечего отменять' : 'Нечего повторять' };
	const next = applyPatch(state, entry.patch, undoing ? 'before' : 'after');
	const undo = undoing ? state.history.undo.slice(0, -1) : [...state.history.undo, entry];
	const redo = undoing ? [...state.history.redo, entry] : state.history.redo.slice(0, -1);
	return {
		state: {
			...next,
			revision: state.revision + 1,
			appliedActionIds: rememberId(state, action.actionId),
			history: { undo, redo },
		},
		changed: true,
		duplicate: false,
		label: `${undoing ? 'Отменено' : 'Повторено'}: ${entry.label}`,
	};
}

function targetName(state: AdventureState, t: EffectTarget): string {
	if (t.kind === 'character') return state.characters[t.id]?.name ?? '?';
	return state.activeEncounter?.combatants[t.id]?.displayName ?? '?';
}

function describeAction(state: AdventureState, a: Action, label: string): string {
	switch (a.type) {
		case 'hp/damage':
			return `Урон ${a.amount} → ${targetName(state, a.target)}`;
		case 'hp/heal':
			return `Лечение ${a.amount} → ${targetName(state, a.target)}`;
		case 'hp/set-temporary':
			return `Временные хиты ${a.value} → ${targetName(state, a.target)}`;
		case 'effect/add':
			return `Эффект «${a.effect.label}» → ${targetName(state, a.effect.target)}`;
		case 'rest/apply':
			return `${a.kind === 'long' ? 'Долгий' : 'Короткий'} отдых (${a.changes.length})`;
		case 'encounter/create':
			return `Бой «${a.encounter.name}»`;
		default:
			return label;
	}
}
