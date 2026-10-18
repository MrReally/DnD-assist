import type { AdventureState, CharacterState } from './types';

export type RestKind = 'short' | 'long';
export type RestProfile = '2014' | 'manual';

export interface RestOptions {
	kind: RestKind;
	profile: RestProfile;
	characterIds: string[];
	restoreHp: boolean;
	restoreSpellSlots: boolean;
	restoreHitDice: boolean;
	resetDeathSaves: boolean;
	reduceExhaustion: boolean;
	/** characterId -> counter ids to restore to max. */
	counterIds: Record<string, string[]>;
	/** characterId -> manual hit dice spending on short rest (physical rolls). */
	hitDiceSpend: Record<string, { die: string; count: number; healed: number }>;
	removeEffectIds: string[];
}

export interface RestPlanEntry {
	characterId: string;
	name: string;
	before: CharacterState;
	after: CharacterState;
	lines: string[];
}

export interface RestPlan {
	kind: RestKind;
	entries: RestPlanEntry[];
	removeEffectIds: string[];
}

/** Default options for the form. Unknown/custom counters with manual recovery are never pre-selected. */
export function defaultRestOptions(
	state: AdventureState,
	kind: RestKind,
	profile: RestProfile,
	characterIds: string[],
): RestOptions {
	const auto = profile === '2014';
	const counterIds: Record<string, string[]> = {};
	for (const id of characterIds) {
		const ch = state.characters[id];
		if (!ch) continue;
		counterIds[id] = auto
			? Object.values(ch.counters)
					.filter((c) => c.recovery === 'short' || (kind === 'long' && c.recovery === 'long'))
					.map((c) => c.id)
			: [];
	}
	return {
		kind,
		profile,
		characterIds,
		restoreHp: auto && kind === 'long',
		restoreSpellSlots: auto && kind === 'long',
		restoreHitDice: auto && kind === 'long',
		resetDeathSaves: auto && kind === 'long',
		reduceExhaustion: false,
		counterIds,
		hitDiceSpend: {},
		removeEffectIds: [],
	};
}

export function planRest(state: AdventureState, opts: RestOptions): RestPlan {
	const entries: RestPlanEntry[] = [];
	for (const id of opts.characterIds) {
		const before = state.characters[id];
		if (!before) continue;
		const after = structuredClone(before);
		const lines: string[] = [];

		const spend = opts.hitDiceSpend[id];
		if (opts.kind === 'short' && spend && spend.count > 0) {
			const hd = after.hitDice.find((h) => h.die === spend.die);
			if (hd) {
				const used = Math.min(hd.remaining, spend.count);
				hd.remaining -= used;
				lines.push(`Кости хитов ${spend.die}: ${hd.remaining + used} → ${hd.remaining}`);
			}
			if (spend.healed > 0) {
				const cur = after.hp.current;
				const raw = cur + spend.healed;
				after.hp.current = after.hp.max === null ? raw : Math.min(after.hp.max, raw);
				lines.push(`Хиты: ${cur} → ${after.hp.current}`);
			}
		}
		if (opts.restoreHp && after.hp.max !== null && after.hp.current !== after.hp.max) {
			lines.push(`Хиты: ${after.hp.current} → ${after.hp.max}`);
			after.hp.current = after.hp.max;
		}
		if (opts.restoreSpellSlots) {
			for (const [lvl, slot] of Object.entries(after.spellSlots)) {
				if (slot.current !== slot.max) {
					lines.push(`Ячейки ${lvl} ур.: ${slot.current} → ${slot.max}`);
					slot.current = slot.max;
				}
			}
		}
		if (opts.restoreHitDice && opts.kind === 'long') {
			for (const hd of after.hitDice) {
				const regain = Math.max(1, Math.floor(hd.total / 2));
				const next = Math.min(hd.total, hd.remaining + regain);
				if (next !== hd.remaining) {
					lines.push(`Кости хитов ${hd.die}: ${hd.remaining} → ${next}`);
					hd.remaining = next;
				}
			}
		}
		if (opts.resetDeathSaves && (after.deathSaves.successes || after.deathSaves.failures)) {
			lines.push('Спасброски от смерти сброшены');
			after.deathSaves = { successes: 0, failures: 0 };
		}
		if (opts.reduceExhaustion && after.exhaustion > 0) {
			lines.push(`Истощение: ${after.exhaustion} → ${after.exhaustion - 1}`);
			after.exhaustion -= 1;
		}
		for (const cid of opts.counterIds[id] ?? []) {
			const c = after.counters[cid];
			if (c && c.max !== null && c.current !== c.max) {
				lines.push(`${c.name}: ${c.current} → ${c.max}`);
				c.current = c.max;
			}
		}
		entries.push({ characterId: id, name: before.name, before, after, lines });
	}
	const removeEffectIds = opts.removeEffectIds.filter((eid) => {
		const e = state.effects[eid];
		return !!e && e.target.kind === 'character' && opts.characterIds.includes(e.target.id);
	});
	return { kind: opts.kind, entries, removeEffectIds };
}
