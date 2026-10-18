// Pure domain types. No Obsidian, DOM or network imports are allowed in src/domain.

export const CURRENT_SCHEMA_VERSION = 2;

export type AbilityId = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITY_IDS: readonly AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export interface HitPoints {
	current: number;
	/** null = unknown (partially filled paper sheet). */
	max: number | null;
	temporary: number;
}

export interface SpellSlot {
	current: number;
	max: number;
}

export interface HitDice {
	die: 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';
	total: number;
	remaining: number;
}

export type RecoveryRule = 'manual' | 'short' | 'long';

export interface Counter {
	id: string;
	name: string;
	current: number;
	max: number | null;
	recovery: RecoveryRule;
}

export interface ClassLevel {
	name: string;
	level: number;
}

/** Runtime + compact definition of a player character inside one adventure. */
export interface CharacterState {
	id: string;
	name: string;
	/** Path of the Markdown sheet relative to the adventure root. */
	notePath: string;
	classes: ClassLevel[];
	hp: HitPoints;
	ac: number | null;
	initiativeModifier: number | null;
	speedFeet: number | null;
	spellSlots: Record<string, SpellSlot>;
	hitDice: HitDice[];
	deathSaves: { successes: number; failures: number };
	inspiration: boolean;
	exhaustion: number;
	counters: Record<string, Counter>;
	/** Unknown fields carried over from older/other versions. */
	extensions?: Record<string, unknown>;
}

export interface Party {
	id: string;
	name: string;
	characterIds: string[];
}

export interface SourceRef {
	provider: 'ttg2014' | 'note' | 'local' | 'custom' | 'fantasy-statblocks';
	/** URL, note path (relative to the adventure root) or local id. */
	ref: string;
	url?: string;
}

/** Short local combat card for a creature (entered by the GM or imported). */
export interface CreatureCard {
	id: string;
	name: string;
	aliases: string[];
	ac: number | null;
	hpMax: number | null;
	initiativeModifier: number | null;
	speed: string;
	notes: string;
	source: SourceRef | null;
}

export type TemplateEntryKind = 'creature' | 'note' | 'custom';

export interface EncounterTemplateEntry {
	id: string;
	kind: TemplateEntryKind;
	name: string;
	count: number;
	creatureId: string | null;
	notePath: string | null;
	sourceUrl: string | null;
	hpMax: number | null;
	ac: number | null;
	initiativeModifier: number | null;
	/** true = all instances of this entry share one initiative group. */
	sharedInitiative: boolean;
}

export interface EncounterTemplate {
	id: string;
	name: string;
	partyId: string | null;
	includeParty: boolean;
	entries: EncounterTemplateEntry[];
	notes: string;
}

export type CombatantKind = 'pc' | 'monster' | 'npc' | 'other';

export interface Combatant {
	id: string;
	kind: CombatantKind;
	/** For PCs: the persistent character. HP of PCs live in CharacterState. */
	characterId: string | null;
	creatureId: string | null;
	source: SourceRef | null;
	displayName: string;
	initiative: number | null;
	initiativeModifier: number | null;
	/** Stable manual tie-breaker; lower acts first among equal initiative. */
	tieOrder: number;
	initiativeGroupId: string | null;
	/** Only for non-PC combatants. */
	hp: HitPoints | null;
	ac: number | null;
	/** Temporary combat-only AC override (shown with an indicator). */
	acOverride: number | null;
	defeated: boolean;
}

export interface InitiativeGroup {
	id: string;
	name: string;
	initiative: number | null;
	tieOrder: number;
}

export type EffectTarget = { kind: 'character' | 'combatant'; id: string };

export type EffectDuration =
	| { kind: 'manual' }
	| {
			kind: 'turns';
			ownerCombatantId: string;
			phase: 'start' | 'end';
			remaining: number;
	  }
	| { kind: 'rounds'; phase: 'start' | 'end'; remaining: number }
	| { kind: 'game-time'; expiresAtMinute: number };

export interface Effect {
	id: string;
	conditionId: string | null;
	label: string;
	target: EffectTarget;
	sourceCombatantId: string | null;
	sourceLabel: string;
	duration: EffectDuration;
	createdAtEventSeq: number;
	/** This effect is the concentration of its target. */
	isConcentration: boolean;
	/** Effect depends on this concentration effect. */
	concentrationEffectId: string | null;
	/** Set when its end event is no longer reachable; GM must decide. */
	needsDecision: boolean;
	notes: string;
}

export type TurnEventType = 'turn-start' | 'turn-end' | 'round-start' | 'round-end';

export interface EffectChange {
	effectId: string;
	before: Effect;
	/** null = expired (removed). */
	after: Effect | null;
}

/** Record of one turn advance, used by "previous turn" to restore exactly. */
export interface TurnLogEntry {
	fromSlotId: string | null;
	fromRound: number;
	fromTurnInstanceId: string | null;
	fromActed: string[];
	fromTurnEnded: boolean;
	changes: EffectChange[];
}

export interface Encounter {
	id: string;
	name: string;
	templateId: string | null;
	partyId: string | null;
	startedAt: string;
	round: number;
	/** 0 before the first round has started. */
	activeSlotId: string | null;
	turnInstanceId: string | null;
	/** True once the turn-end of the current turn instance was emitted. */
	turnEnded: boolean;
	actedThisRound: string[];
	paused: boolean;
	combatants: Record<string, Combatant>;
	groups: Record<string, InitiativeGroup>;
	/** Combatant ids in insertion order (for numbering / stable ties). */
	insertion: string[];
	/** Keyed by increasing sequence number (records keep undo patches small). */
	turnLog: Record<string, TurnLogEntry>;
	turnLogSeq: number;
}

export interface PatchOp {
	path: string[];
	/** undefined = key absent. */
	before?: unknown;
	after?: unknown;
}

export interface HistoryEntry {
	actionId: string;
	type: string;
	label: string;
	at: string;
	adventureId: string;
	patch: PatchOp[];
	/** Markdown snapshots for import actions (restored only if file unchanged). */
	files?: FileSnapshot[];
}

export interface FileSnapshot {
	path: string;
	/** Managed block before the change; null if the file was created. */
	beforeBlock: string | null;
	afterBlock: string;
	/** Set when the block was appended to a note without one: separator added before it. */
	appendedSeparator?: string;
}

export type NodeCategory = 'plot' | 'npc' | 'loot' | 'homebrew' | 'notes' | 'ignore';

export interface AdventureState {
	schemaVersion: 2;
	stateId: string;
	adventureId: string;
	rootPath: string;
	name: string;
	revision: number;
	activePartyId: string | null;
	parties: Party[];
	characters: Record<string, CharacterState>;
	creatures: Record<string, CreatureCard>;
	encounterTemplates: EncounterTemplate[];
	activeEncounter: Encounter | null;
	effects: Record<string, Effect>;
	eventSeq: number;
	gameClock: { minutes: number };
	/** canvasPath (relative to root) -> nodeId -> manual category override. */
	nodeOverrides: Record<string, Record<string, NodeCategory>>;
	history: { undo: HistoryEntry[]; redo: HistoryEntry[] };
	appliedActionIds: string[];
	extensions: Record<string, unknown>;
}

export interface HistoryLimits {
	maxEntries: number;
	maxBytes: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = { maxEntries: 100, maxBytes: 256 * 1024 };
