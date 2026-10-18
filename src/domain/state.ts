import type { AdventureState, CharacterState } from './types';

export function createAdventureState(adventureId: string, stateId: string, rootPath: string, name: string): AdventureState {
	return {
		schemaVersion: 2,
		stateId,
		adventureId,
		rootPath,
		name,
		revision: 0,
		activePartyId: null,
		parties: [],
		characters: {},
		creatures: {},
		encounterTemplates: [],
		activeEncounter: null,
		effects: {},
		eventSeq: 0,
		gameClock: { minutes: 0 },
		nodeOverrides: {},
		history: { undo: [], redo: [] },
		appliedActionIds: [],
		extensions: {},
	};
}

export function emptyCharacter(id: string, name: string, notePath: string): CharacterState {
	return {
		id,
		name,
		notePath,
		classes: [],
		hp: { current: 0, max: null, temporary: 0 },
		ac: null,
		initiativeModifier: null,
		speedFeet: null,
		spellSlots: {},
		hitDice: [],
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		exhaustion: 0,
		counters: {},
	};
}

/** Compact JSON (the sidecar is machine data; Markdown notes stay the human-readable part). */
export function serializeState(state: AdventureState): string {
	return `${JSON.stringify(state)}\n`;
}
