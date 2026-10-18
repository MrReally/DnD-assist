import { nextTieOrder } from './combat';
import type {
	AdventureState,
	Combatant,
	CombatantKind,
	CreatureCard,
	Encounter,
	EncounterTemplate,
	EncounterTemplateEntry,
	InitiativeGroup,
	SourceRef,
} from './types';

export type IdFactory = (prefix: string) => string;

export function emptyEncounter(id: string, name: string, at: string, partyId: string | null, templateId: string | null): Encounter {
	return {
		id,
		name,
		templateId,
		partyId,
		startedAt: at,
		round: 0,
		activeSlotId: null,
		turnInstanceId: null,
		turnEnded: false,
		actedThisRound: [],
		paused: false,
		combatants: {},
		groups: {},
		insertion: [],
		turnLog: {},
		turnLogSeq: 0,
	};
}

export function pcCombatant(state: AdventureState, characterId: string, id: string, tieOrder: number): Combatant {
	const ch = state.characters[characterId];
	return {
		id,
		kind: 'pc',
		characterId,
		creatureId: null,
		source: ch ? { provider: 'note', ref: ch.notePath } : null,
		displayName: ch?.name ?? 'Персонаж',
		initiative: null,
		initiativeModifier: ch?.initiativeModifier ?? null,
		tieOrder,
		initiativeGroupId: null,
		hp: null,
		ac: null,
		acOverride: null,
		defeated: false,
	};
}

function entrySource(entry: EncounterTemplateEntry, creature: CreatureCard | undefined): SourceRef | null {
	if (creature?.source) return creature.source;
	if (entry.sourceUrl) return { provider: 'ttg2014', ref: entry.sourceUrl, url: entry.sourceUrl };
	if (entry.notePath) return { provider: 'note', ref: entry.notePath };
	return null;
}

export interface MonsterSpec {
	name: string;
	count: number;
	kind: CombatantKind;
	creatureId: string | null;
	source: SourceRef | null;
	hpMax: number | null;
	ac: number | null;
	initiativeModifier: number | null;
	sharedInitiative: boolean;
}

export function specFromEntry(state: AdventureState, entry: EncounterTemplateEntry): MonsterSpec {
	const creature = entry.creatureId ? state.creatures[entry.creatureId] : undefined;
	return {
		name: entry.name || creature?.name || 'Существо',
		count: Math.max(1, Math.min(100, Math.floor(entry.count) || 1)),
		kind: entry.notePath ? 'npc' : 'monster',
		creatureId: entry.creatureId,
		source: entrySource(entry, creature),
		hpMax: entry.hpMax ?? creature?.hpMax ?? null,
		ac: entry.ac ?? creature?.ac ?? null,
		initiativeModifier: entry.initiativeModifier ?? creature?.initiativeModifier ?? null,
		sharedInitiative: entry.sharedInitiative,
	};
}

/** Builds unique combatants (and an optional explicit initiative group) for N copies of a creature. */
export function buildMonsters(
	enc: Encounter,
	spec: MonsterSpec,
	newId: IdFactory,
): { combatants: Combatant[]; group: InitiativeGroup | null } {
	const existingSame = Object.values(enc.combatants).filter((c) => baseName(c.displayName) === spec.name).length;
	let tie = nextTieOrder(enc);
	const group: InitiativeGroup | null =
		spec.sharedInitiative && spec.count > 1
			? { id: newId('grp'), name: `${spec.name} ×${spec.count}`, initiative: null, tieOrder: tie }
			: null;
	const combatants: Combatant[] = [];
	for (let i = 0; i < spec.count; i++) {
		const n = existingSame + i + 1;
		const numbered = spec.count > 1 || existingSame > 0;
		combatants.push({
			id: newId('cmb'),
			kind: spec.kind,
			characterId: null,
			creatureId: spec.creatureId,
			source: spec.source,
			displayName: numbered ? `${spec.name} ${n}` : spec.name,
			initiative: null,
			initiativeModifier: spec.initiativeModifier,
			tieOrder: tie,
			initiativeGroupId: group?.id ?? null,
			hp: spec.hpMax !== null ? { current: spec.hpMax, max: spec.hpMax, temporary: 0 } : { current: 0, max: null, temporary: 0 },
			ac: spec.ac,
			acOverride: null,
			defeated: false,
		});
		tie += 10;
	}
	return { combatants, group };
}

function baseName(displayName: string): string {
	return displayName.replace(/\s+\d+$/, '');
}

/** Launches a template: new encounterId and combatantIds every time; the template is not modified. */
export function encounterFromTemplate(
	state: AdventureState,
	template: EncounterTemplate,
	newId: IdFactory,
	at: string,
	partyIdOverride?: string | null,
): Encounter {
	const partyId = partyIdOverride !== undefined ? partyIdOverride : template.partyId ?? state.activePartyId;
	const enc = emptyEncounter(newId('enc'), template.name, at, partyId, template.id);
	if (template.includeParty && partyId) {
		const party = state.parties.find((p) => p.id === partyId);
		for (const cid of party?.characterIds ?? []) {
			if (!state.characters[cid]) continue;
			addCombatant(enc, pcCombatant(state, cid, newId('cmb'), nextTieOrder(enc)));
		}
	}
	for (const entry of template.entries) {
		const { combatants, group } = buildMonsters(enc, specFromEntry(state, entry), newId);
		if (group) enc.groups[group.id] = group;
		for (const c of combatants) addCombatant(enc, c);
	}
	return enc;
}

export function addCombatant(enc: Encounter, c: Combatant): void {
	enc.combatants[c.id] = c;
	enc.insertion.push(c.id);
}
