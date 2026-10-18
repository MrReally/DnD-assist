// TTG Club 5e (2014). Default: links only, no network. The online search is an OPT-IN experiment
// over an endpoint observed in the public site frontend (undocumented; see docs/verified-integrations.md).
// It is called only on an explicit user search, returns names + links, and never caches/copies texts.
import { TTG_BASE, TTG_BESTIARY_URL } from '../domain/conditions';
import type { CreatureSummary, ReferenceHit, ReferenceProvider, ReferenceRef } from './reference-types';

export type HttpPost = (url: string, body: string, timeoutMs: number) => Promise<{ status: number; json: unknown }>;

export function isTtgUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && (u.hostname === '5e14.ttg.club' || u.hostname.endsWith('.ttg.club') || u.hostname === 'ttg.club');
	} catch {
		return false;
	}
}

/** Only https TTG links are opened; anything else is rejected (no javascript:, file:, etc.). */
export function safeTtgUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	const abs = url.startsWith('/') ? `${TTG_BASE}${url}` : url;
	return isTtgUrl(abs) ? abs : null;
}

export class TtgLinkProvider implements ReferenceProvider {
	readonly id = 'ttg2014';
	async search(): Promise<ReferenceHit[]> {
		return [];
	}
	async getSummary(): Promise<CreatureSummary | null> {
		return null;
	}
	getSourceUrl(ref: ReferenceRef): string {
		return safeTtgUrl(ref.ref) ?? TTG_BESTIARY_URL;
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

interface TtgListItem {
	name?: { rus?: unknown; eng?: unknown };
	url?: unknown;
	challengeRating?: unknown;
	type?: unknown;
	source?: { shortName?: unknown };
}

export class TtgOnlineSearch implements ReferenceProvider {
	readonly id = 'ttg2014-online';
	private failedAt = 0;

	constructor(
		private readonly post: HttpPost,
		private readonly enabled: () => boolean,
	) {}

	async isAvailable(): Promise<boolean> {
		return this.enabled() && Date.now() - this.failedAt > 60_000;
	}

	async search(query: string): Promise<ReferenceHit[]> {
		const q = query.trim();
		if (!q || !(await this.isAvailable())) return [];
		try {
			const body = JSON.stringify({ page: 0, size: 10, search: { value: q, exact: false } });
			const res = await this.post(`${TTG_BASE}/api/v1/bestiary`, body, 4000);
			if (res.status !== 200 || !Array.isArray(res.json)) throw new Error(`HTTP ${res.status}`);
			return (res.json as TtgListItem[]).slice(0, 10).flatMap((it) => {
				const name = typeof it.name?.rus === 'string' ? it.name.rus : null;
				const url = typeof it.url === 'string' ? safeTtgUrl(it.url) : null;
				if (!name || !url) return [];
				const eng = typeof it.name?.eng === 'string' ? it.name.eng : '';
				const cr = typeof it.challengeRating === 'string' ? `ПО ${it.challengeRating}` : '';
				const src = typeof it.source?.shortName === 'string' ? it.source.shortName : '';
				return [{ ref: { provider: 'ttg2014', ref: url }, name, subtitle: [eng, cr, src].filter(Boolean).join(' · '), url }];
			});
		} catch {
			this.failedAt = Date.now();
			return [];
		}
	}

	async getSummary(): Promise<CreatureSummary | null> {
		// Statblock texts are not fetched/parsed: rights and a documented format are unconfirmed.
		return null;
	}

	getSourceUrl(ref: ReferenceRef): string {
		return safeTtgUrl(ref.ref) ?? TTG_BESTIARY_URL;
	}
}
