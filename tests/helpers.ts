import type { Action, ActionPayload } from '../src/domain/actions';
import { emptyEncounter } from '../src/domain/encounter';
import { dispatch, DEFAULT_REDUCER_OPTIONS, type ReducerOptions } from '../src/domain/reducer';
import { createAdventureState, emptyCharacter } from '../src/domain/state';
import type { AdventureState, CharacterState, Combatant, Effect, EffectDuration } from '../src/domain/types';

let seq = 0;
export function id(prefix: string): string {
	seq += 1;
	return `${prefix}-t${seq}`;
}

export function act(state: AdventureState, payload: ActionPayload, actionId = id('act')): Action {
	return { ...payload, actionId, adventureId: state.adventureId, at: '2026-10-18T00:00:00.000Z' };
}

/** Dispatch helper that fails the test on domain errors. */
export function run(state: AdventureState, payload: ActionPayload, opts: ReducerOptions = DEFAULT_REDUCER_OPTIONS): AdventureState {
	const r = dispatch(state, act(state, payload), opts);
	if (r.error) throw new Error(`${payload.type}: ${r.error}`);
	return r.state;
}

export function tryRun(state: AdventureState, payload: ActionPayload): { state: AdventureState; error?: string } {
	const r = dispatch(state, act(state, payload));
	return { state: r.state, error: r.error };
}

export function pc(idv: string, name: string, hp: number, max: number, extra: Partial<CharacterState> = {}): CharacterState {
	return { ...emptyCharacter(idv, name, `Elements/Персонажи/${name}.md`), hp: { current: hp, max, temporary: 0 }, ...extra };
}

export function baseState(adventureId = 'adv-A'): AdventureState {
	let s = createAdventureState(adventureId, `state-${adventureId}`, 'Приключение А', 'Приключение А');
	s = run(s, { type: 'character/upsert', character: pc('pc-alex', 'Алекс', 17, 28, { ac: 17 }) });
	s = run(s, { type: 'character/upsert', character: pc('pc-mira', 'Мира', 9, 20, { ac: 12, spellSlots: { '1': { current: 2, max: 4 } } }) });
	s = run(s, { type: 'character/upsert', character: pc('pc-bor', 'Бор', 30, 30) });
	s = run(s, { type: 'party/create', party: { id: 'party-main', name: 'Основная', characterIds: ['pc-alex', 'pc-mira', 'pc-bor'] } });
	s = run(s, { type: 'party/create', party: { id: 'party-b', name: 'Вторая', characterIds: ['pc-alex'] } });
	return s;
}

export function monster(cid: string, name: string, init: number | null, hp = 7, tieOrder = 0): Combatant {
	return {
		id: cid,
		kind: 'monster',
		characterId: null,
		creatureId: null,
		source: { provider: 'ttg2014', ref: 'https://5e14.ttg.club/bestiary/goblin', url: 'https://5e14.ttg.club/bestiary/goblin' },
		displayName: name,
		initiative: init,
		initiativeModifier: 2,
		tieOrder,
		initiativeGroupId: null,
		hp: { current: hp, max: hp, temporary: 0 },
		ac: 15,
		acOverride: null,
		defeated: false,
	};
}

export function pcCmb(cid: string, characterId: string, name: string, init: number | null, tieOrder = 0): Combatant {
	return { ...monster(cid, name, init, 0, tieOrder), kind: 'pc', characterId, hp: null, ac: null, source: null };
}

/** State with an active (not yet begun) encounter of the given combatants. */
export function withEncounter(state: AdventureState, combatants: Combatant[]): AdventureState {
	let s = run(state, { type: 'encounter/create', encounter: emptyEncounter('enc-1', 'Тестовый бой', '2026-10-18T00:00:00Z', 'party-main', null) });
	s = run(s, { type: 'encounter/add-combatants', combatants });
	return s;
}

export function effect(eid: string, targetId: string, duration: EffectDuration, extra: Partial<Effect> = {}): Effect {
	return {
		id: eid,
		conditionId: 'frightened',
		label: 'Испуганный',
		target: { kind: 'combatant', id: targetId },
		sourceCombatantId: null,
		sourceLabel: '',
		duration,
		createdAtEventSeq: 0,
		isConcentration: false,
		concentrationEffectId: null,
		needsDecision: false,
		notes: '',
		...extra,
	};
}

export function activeName(s: AdventureState): string | undefined {
	const enc = s.activeEncounter;
	if (!enc?.activeSlotId) return undefined;
	return enc.combatants[enc.activeSlotId]?.displayName ?? enc.groups[enc.activeSlotId]?.name;
}
