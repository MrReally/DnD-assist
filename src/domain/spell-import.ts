// Extensible spell importers (pure). No network here: every importer works on data the GM supplies
// or on the local library. TTG Club links are parsed and resolved against the local library only,
// because 5e14.ttg.club disallows /api in robots.txt and its terms forbid automated collection
// (see docs/verified-integrations.md, "TTG Club — 2014").
export interface SpellCard {
	id: string;
	name: string;
	nameEn?: string;
	level: number;
	school: string;
	castingTime: string;
	range: string;
	components: string;
	duration: string;
	concentration: boolean;
	ritual?: boolean;
	text: string;
	higherLevels?: string;
	source: string;
	/** How we got it; the text is kept only if the GM supplied it. */
	origin: 'manual' | 'json' | 'local' | 'srd';
	url?: string;
}

export type SpellInput = { kind: 'link'; url: string } | { kind: 'json'; text: string } | { kind: 'manual'; card: Partial<SpellCard> } | { kind: 'name'; name: string };

export type ImportOutcome =
	| { status: 'ok'; card: SpellCard; via: string }
	| { status: 'needs-data'; slug: string; openUrl: string; reason: string }
	| { status: 'error'; error: string };

export interface SpellImporter {
	id: string;
	label: string;
	handles(input: SpellInput): boolean;
	run(input: SpellInput, library: readonly SpellCard[]): ImportOutcome;
}

const TTG_HOSTS = new Set(['5e14.ttg.club', 'ttg.club', 'new.ttg.club', '5e24.ttg.club']);

export function parseTtgSpellLink(raw: string): { slug: string; url: string } | null {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' || !TTG_HOSTS.has(u.hostname)) return null;
	const m = /^\/spells\/([a-z0-9][a-z0-9-_]{0,100})\/?$/i.exec(u.pathname);
	if (!m || !m[1]) return null;
	return { slug: m[1].toLowerCase(), url: `https://${u.hostname}/spells/${m[1].toLowerCase()}` };
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/ё/g, 'е');

export function findInLibrary(library: readonly SpellCard[], q: { slug?: string; name?: string }): SpellCard | null {
	for (const c of library) {
		if (q.slug && (c.id === q.slug || c.url?.endsWith(`/spells/${q.slug}`))) return c;
		if (q.name && (norm(c.name) === norm(q.name) || (c.nameEn && norm(c.nameEn) === norm(q.name)))) return c;
	}
	return null;
}

function str(o: Record<string, unknown>, k: string, req = true): string | undefined {
	const v = o[k];
	if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 20000);
	if (req) throw new Error(`Поле «${k}» обязательно`);
	return undefined;
}

export function validateCard(raw: unknown, origin: SpellCard['origin']): SpellCard {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Ожидался объект заклинания');
	const o = raw as Record<string, unknown>;
	const level = o.level;
	if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 9) throw new Error('Уровень — целое 0–9');
	const name = str(o, 'name') as string;
	const card: SpellCard = {
		id: str(o, 'id', false) ?? norm(name).replace(/[^a-z0-9а-я]+/g, '-').replace(/^-|-$/g, ''),
		name,
		level,
		school: str(o, 'school') as string,
		castingTime: str(o, 'castingTime') as string,
		range: str(o, 'range') as string,
		components: str(o, 'components') as string,
		duration: str(o, 'duration') as string,
		concentration: o.concentration === true,
		text: str(o, 'text') as string,
		source: str(o, 'source', false) ?? 'GM',
		origin,
	};
	const en = str(o, 'nameEn', false);
	if (en) card.nameEn = en;
	const hl = str(o, 'higherLevels', false);
	if (hl) card.higherLevels = hl;
	if (o.ritual === true) card.ritual = true;
	const url = str(o, 'url', false);
	if (url) {
		if (!/^https:\/\//.test(url)) throw new Error('url должен быть https');
		card.url = url;
	}
	if (!card.id) throw new Error('Не удалось получить id заклинания');
	return card;
}

const linkImporter: SpellImporter = {
	id: 'ttg-link',
	label: 'Ссылка TTG Club (только локальная библиотека)',
	handles: (i) => i.kind === 'link',
	run(input, library) {
		if (input.kind !== 'link') return { status: 'error', error: 'не ссылка' };
		const p = parseTtgSpellLink(input.url);
		if (!p) return { status: 'error', error: 'Ожидалась ссылка вида https://5e14.ttg.club/spells/<название>' };
		const hit = findInLibrary(library, { slug: p.slug });
		if (hit) return { status: 'ok', card: hit, via: 'локальная библиотека' };
		return { status: 'needs-data', slug: p.slug, openUrl: p.url, reason: 'Карточки нет в локальной библиотеке. Автоматическая загрузка с TTG Club не выполняется (robots.txt запрещает /api, условия запрещают автоматический сбор). Откройте страницу, вставьте разрешённые данные как JSON или введите вручную.' };
	},
};

const nameImporter: SpellImporter = {
	id: 'local-name',
	label: 'Локальная библиотека (по названию)',
	handles: (i) => i.kind === 'name',
	run(input, library) {
		if (input.kind !== 'name') return { status: 'error', error: 'не название' };
		const hit = findInLibrary(library, { name: input.name });
		return hit ? { status: 'ok', card: hit, via: 'локальная библиотека' } : { status: 'error', error: `«${input.name}» нет в локальной библиотеке` };
	},
};

const jsonImporter: SpellImporter = {
	id: 'json',
	label: 'JSON',
	handles: (i) => i.kind === 'json',
	run(input) {
		if (input.kind !== 'json') return { status: 'error', error: 'не JSON' };
		try {
			return { status: 'ok', card: validateCard(JSON.parse(input.text), 'json'), via: 'JSON' };
		} catch (e) {
			return { status: 'error', error: e instanceof Error ? e.message : String(e) };
		}
	},
};

const manualImporter: SpellImporter = {
	id: 'manual',
	label: 'Ручной ввод',
	handles: (i) => i.kind === 'manual',
	run(input) {
		if (input.kind !== 'manual') return { status: 'error', error: 'не ручной ввод' };
		try {
			return { status: 'ok', card: validateCard(input.card, 'manual'), via: 'ручной ввод' };
		} catch (e) {
			return { status: 'error', error: e instanceof Error ? e.message : String(e) };
		}
	},
};

export const DEFAULT_IMPORTERS: readonly SpellImporter[] = [nameImporter, linkImporter, jsonImporter, manualImporter];

/** First importer that handles the input. Adding a source = adding an importer; callers do not change. */
export function importSpell(input: SpellInput, library: readonly SpellCard[], importers: readonly SpellImporter[] = DEFAULT_IMPORTERS): ImportOutcome {
	const imp = importers.find((i) => i.handles(input));
	return imp ? imp.run(input, library) : { status: 'error', error: 'Нет подходящего импортёра' };
}

/** Pure upsert by id; returns a new array (library is stored locally and works offline). */
export function upsertSpell(library: readonly SpellCard[], card: SpellCard): SpellCard[] {
	return [...library.filter((c) => c.id !== card.id), card].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

import { getSrd, type SrdSpell } from './srd';

/** SRD spell → card (read-only reference; never copied into the user's library). */
export function spellCardFromSrd(s: SrdSpell): SpellCard {
	return { id: s.id, name: s.name, level: s.level, school: s.school, castingTime: s.castingTime, range: s.range, components: s.material ? `${s.components} (${s.material})` : s.components, duration: s.duration, concentration: s.concentration, ritual: s.ritual, text: s.text, ...(s.higherLevels ? { higherLevels: s.higherLevels } : {}), source: 'SRD 5.1 (CC-BY-4.0)', origin: 'srd' };
}

/** User library first (GM edits win), then the SRD. */
export function lookupSpell(library: readonly SpellCard[], id: string): SpellCard | null {
	const own = library.find((c) => c.id === id);
	if (own) return own;
	const s = getSrd()?.spells.find((x) => x.id === id);
	return s ? spellCardFromSrd(s) : null;
}

export function searchSpells(library: readonly SpellCard[], query: string, limit = 30): SpellCard[] {
	const q = query.trim().toLowerCase().replace(/ё/g, 'е');
	const own = library.filter((c) => !q || c.name.toLowerCase().replace(/ё/g, 'е').includes(q));
	const ids = new Set(own.map((c) => c.id));
	const srd = (getSrd()?.spells ?? []).filter((s) => !ids.has(s.id) && (!q || s.name.toLowerCase().includes(q) || s.id.includes(q))).map(spellCardFromSrd);
	return [...own, ...srd].slice(0, limit);
}
