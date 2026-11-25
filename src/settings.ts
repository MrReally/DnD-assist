import type { CueBinding } from './domain/lightkey';
import type { SpellCard } from './domain/spell-import';
import type { RestProfile } from './domain/rest';

export interface RegisteredAdventure {
	adventureId: string;
	rootPath: string;
	name: string;
}

export type HotkeyAction = 'search' | 'damage' | 'heal' | 'effect' | 'card' | 'next' | 'previous';

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
	search: 'Поиск по Canvas',
	damage: 'Урон выбранной цели',
	heal: 'Лечение выбранной цели',
	effect: 'Эффект на выбранную цель',
	card: 'Карточка выбранной цели',
	next: 'Следующий ход',
	previous: 'Предыдущий ход',
};

export interface CanvasAssistSettings {
	adventures: RegisteredAdventure[];
	foldYo: boolean;
	contextualHotkeys: boolean;
	hotkeys: Record<HotkeyAction, string>;
	temporaryHpAbsorbs: boolean;
	skipDefeated: boolean;
	historyMaxEntries: number;
	historyMaxKiB: number;
	backupLimit: number;
	restProfile: RestProfile;
	ttgOnlineSearch: boolean;
	fantasyStatblocks: boolean;
	offlineReferencePath: string;
	navigatorCollapsed: boolean;
	barCollapsed: boolean;
	/** GM Cockpit: double click on a character file node opens the card (false → native Canvas behaviour). */
	cockpitDoubleClick: boolean;
	/** Lightkey OSC: connection and the cue address used by the test send (copied from Lightkey). */
	/** Local spell library (global, offline). Only data the GM entered or imported with permission. */
	spells: SpellCard[];
	/** Cue bindings: spell id → Lightkey cue. */
	cues: CueBinding[];
	lightkey: { host: string; port: number; testAddress: string; testCommand: 'activate' | 'deactivate' | 'toggle' };
}

/**
 * Space is intentionally NOT bound: Obsidian Canvas uses Space(+drag) for panning.
 * All bindings fire only in an active Canvas of a registered adventure and never while typing.
 */
export const DEFAULT_SETTINGS: CanvasAssistSettings = {
	adventures: [],
	foldYo: true,
	contextualHotkeys: true,
	hotkeys: {
		search: 'Shift+F',
		damage: 'Shift+D',
		heal: 'Shift+H',
		effect: 'Shift+E',
		card: 'Shift+K',
		next: 'Shift+Space',
		previous: 'Shift+Alt+Space',
	},
	temporaryHpAbsorbs: true,
	skipDefeated: true,
	historyMaxEntries: 100,
	historyMaxKiB: 256,
	backupLimit: 3,
	restProfile: '2014',
	ttgOnlineSearch: false,
	fantasyStatblocks: false,
	offlineReferencePath: '',
	navigatorCollapsed: true,
	barCollapsed: false,
	cockpitDoubleClick: true,
	spells: [],
	cues: [],
	lightkey: { host: '127.0.0.1', port: 21600, testAddress: '', testCommand: 'activate' },
};

export function mergeSettings(raw: unknown): CanvasAssistSettings {
	const base: CanvasAssistSettings = structuredClone(DEFAULT_SETTINGS);
	if (typeof raw !== 'object' || raw === null) return base;
	const r = raw as Partial<CanvasAssistSettings>;
	const out: CanvasAssistSettings = { ...base, ...r, hotkeys: { ...base.hotkeys, ...(r.hotkeys ?? {}) }, lightkey: { ...base.lightkey, ...(r.lightkey ?? {}) } };
	out.spells = Array.isArray(r.spells) ? r.spells.filter((x): x is SpellCard => !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.level === 'number') : [];
	out.cues = Array.isArray(r.cues) ? r.cues.filter((x): x is CueBinding => !!x && typeof x.cardId === 'string' && typeof x.address === 'string') : [];
	out.adventures = Array.isArray(r.adventures)
		? r.adventures.filter((a): a is RegisteredAdventure => !!a && typeof a.adventureId === 'string' && typeof a.rootPath === 'string')
		: [];
	out.historyMaxEntries = clamp(out.historyMaxEntries, 10, 1000, 100);
	out.historyMaxKiB = clamp(out.historyMaxKiB, 32, 4096, 256);
	out.backupLimit = clamp(out.backupLimit, 1, 20, 3);
	if (out.restProfile !== '2014' && out.restProfile !== 'manual') out.restProfile = '2014';
	return out;
}

function clamp(v: unknown, min: number, max: number, d: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
}
