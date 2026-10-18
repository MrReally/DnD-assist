// Optional Fantasy Statblocks bridge (feature flag, off by default). No import of its code:
// it is resolved at runtime and every call is guarded, so a missing plugin or changed API
// only disables the feature.
import type { App } from 'obsidian';
import type { CreatureSummary } from './reference-types';

interface StatblocksApi {
	hasCreature?: (name: string) => boolean;
	getCreatureFromBestiary?: (name: string) => Record<string, unknown> | null | undefined;
}

function apiOf(app: App): StatblocksApi | null {
	const w = window as unknown as { FantasyStatblocks?: StatblocksApi };
	if (w.FantasyStatblocks && typeof w.FantasyStatblocks === 'object') return w.FantasyStatblocks;
	const plugins = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
	const p = plugins?.getPlugin?.('obsidian-5e-statblocks') as { api?: StatblocksApi } | undefined;
	return p?.api ?? null;
}

export function statblocksStatus(app: App, enabled: boolean): string {
	if (!enabled) return 'выключено в настройках';
	const api = apiOf(app);
	if (!api) return 'плагин Fantasy Statblocks не установлен или не включён';
	return typeof api.getCreatureFromBestiary === 'function' ? 'доступно' : 'API изменился — интеграция отключена';
}

const firstInt = (v: unknown): number | null => {
	if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
	if (typeof v === 'string') {
		const m = /-?\d+/.exec(v);
		return m ? Number(m[0]) : null;
	}
	return null;
};

export function statblockSummary(app: App, enabled: boolean, name: string): CreatureSummary | null {
	if (!enabled) return null;
	try {
		const api = apiOf(app);
		if (!api || typeof api.getCreatureFromBestiary !== 'function') return null;
		const c = api.getCreatureFromBestiary(name);
		if (!c || typeof c !== 'object') return null;
		const stats = Array.isArray(c.stats) ? (c.stats as unknown[]) : [];
		const dex = firstInt(stats[1]);
		return {
			name: typeof c.name === 'string' ? c.name : name,
			ac: firstInt(c.ac),
			hpMax: firstInt(c.hp),
			initiativeModifier: dex === null ? null : Math.floor((dex - 10) / 2),
			speed: typeof c.speed === 'string' ? c.speed : '',
			notes: '',
			sourceUrl: null,
		};
	} catch {
		return null;
	}
}
