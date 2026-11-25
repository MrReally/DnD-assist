// Pure card resolution for GM Cockpit: maps a vault path (e.g. a Canvas file node) to a game card.
// No Obsidian/DOM access. Only the adventure's own state is consulted (adventure isolation).
import { relativeTo } from './normalize';
import type { AdventureState, CharacterState, EffectTarget } from './types';

/** Character whose sheet note is `vaultPath`, or null (outside the adventure root, unknown note). */
export function characterForNote(state: AdventureState, vaultPath: string): CharacterState | null {
	const rel = relativeTo(state.rootPath, vaultPath);
	if (rel === null) return null;
	return Object.values(state.characters).find((c) => c.notePath === rel) ?? null;
}

export function cardTargetForNote(state: AdventureState, vaultPath: string): EffectTarget | null {
	const ch = characterForNote(state, vaultPath);
	return ch ? { kind: 'character', id: ch.id } : null;
}

export interface HpEdit {
	kind: 'damage' | 'heal' | 'set' | 'invalid';
	amount: number;
}

/**
 * Interprets the ± field of the card: "-7" damage, "+5"/"5" healing, "=12" sets current HP.
 * The GM states the final number; nothing is computed from attacks or resistances.
 */
export function parseHpInput(text: string): HpEdit {
	const t = text.trim();
	const m = /^([+\-=]?)\s*(\d{1,6})$/.exec(t);
	if (!m) return { kind: 'invalid', amount: 0 };
	const n = Number(m[2]);
	if (m[1] === '-') return { kind: 'damage', amount: n };
	if (m[1] === '=') return { kind: 'set', amount: n };
	return { kind: 'heal', amount: n };
}

/** Width of the HP bar in percent (0–100). Unknown max → empty bar. */
export function hpPercent(current: number, max: number | null): number {
	if (max === null || max <= 0) return 0;
	return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}
