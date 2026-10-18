// User-provided local JSON reference inside the vault (own or permitted data).
// Format: { "creatures": [ { "name", "aliases"?, "ac"?, "hpMax"?, "initiativeModifier"?, "speed"?, "notes"?, "sourceUrl"? } ] }
import { normalizeText } from '../domain/normalize';
import type { CreatureSummary, ReferenceHit, ReferenceProvider, ReferenceRef } from './reference-types';
import { safeTtgUrl } from './ttg-adapter';

interface Entry extends CreatureSummary {
	aliases: string[];
	key: string;
}

const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

export function parseOfflineReference(text: string): { entries: Entry[]; error: string | null } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		return { entries: [], error: `Некорректный JSON справочника: ${err instanceof Error ? err.message : String(err)}` };
	}
	const list = Array.isArray(raw) ? raw : typeof raw === 'object' && raw !== null && Array.isArray((raw as { creatures?: unknown }).creatures) ? (raw as { creatures: unknown[] }).creatures : null;
	if (!list) return { entries: [], error: 'Ожидается массив или { "creatures": [...] }' };
	const entries: Entry[] = [];
	for (const item of list.slice(0, 5000)) {
		if (typeof item !== 'object' || item === null) continue;
		const r = item as Record<string, unknown>;
		if (typeof r.name !== 'string' || !r.name.trim()) continue;
		entries.push({
			key: `local:${entries.length}`,
			name: r.name.trim().slice(0, 160),
			aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === 'string').slice(0, 20) : [],
			ac: intOrNull(r.ac),
			hpMax: intOrNull(r.hpMax),
			initiativeModifier: intOrNull(r.initiativeModifier),
			speed: typeof r.speed === 'string' ? r.speed.slice(0, 200) : '',
			notes: typeof r.notes === 'string' ? r.notes.slice(0, 4000) : '',
			sourceUrl: safeTtgUrl(typeof r.sourceUrl === 'string' ? r.sourceUrl : null),
		});
	}
	return { entries, error: null };
}

export class OfflineReference implements ReferenceProvider {
	readonly id = 'local';
	private entries: Entry[] = [];
	error: string | null = null;

	load(text: string | null): void {
		if (text === null) {
			this.entries = [];
			this.error = null;
			return;
		}
		const r = parseOfflineReference(text);
		this.entries = r.entries;
		this.error = r.error;
	}

	get size(): number {
		return this.entries.length;
	}

	async isAvailable(): Promise<boolean> {
		return this.entries.length > 0;
	}

	async search(query: string): Promise<ReferenceHit[]> {
		const q = normalizeText(query, { foldYo: true });
		if (!q) return [];
		return this.entries
			.filter((e) => [e.name, ...e.aliases].some((n) => normalizeText(n, { foldYo: true }).includes(q)))
			.slice(0, 20)
			.map((e) => ({ ref: { provider: 'local', ref: e.key }, name: e.name, subtitle: `локальный справочник${e.ac !== null ? ` · КД ${e.ac}` : ''}`, url: e.sourceUrl }));
	}

	async getSummary(ref: ReferenceRef): Promise<CreatureSummary | null> {
		const e = this.entries.find((x) => x.key === ref.ref);
		if (!e) return null;
		const { aliases: _a, key: _k, ...summary } = e;
		return summary;
	}

	getSourceUrl(ref: ReferenceRef): string {
		return this.entries.find((x) => x.key === ref.ref)?.sourceUrl ?? '';
	}
}
