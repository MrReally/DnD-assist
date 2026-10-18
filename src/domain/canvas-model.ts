// Read-only model of a .canvas JSON file (JSON Canvas format) for navigation and search.
// The file itself is never rewritten by the plugin.
import { normalizeText, type NormalizeOptions } from './normalize';
import type { NodeCategory } from './types';

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
	plot: 'Сюжет',
	npc: 'NPC',
	loot: 'Лут',
	homebrew: 'Homebrew',
	notes: 'Заметки',
	ignore: 'Игнорировать',
};

export const CATEGORY_ORDER: NodeCategory[] = ['plot', 'npc', 'loot', 'homebrew', 'notes', 'ignore'];

export interface CanvasNodeLike {
	id: string;
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	text?: string;
	file?: string;
	subpath?: string;
	url?: string;
	label?: string;
	[key: string]: unknown;
}

export interface CanvasItem {
	nodeId: string;
	type: string;
	title: string;
	subtitle: string;
	text: string;
	filePath: string | null;
	url: string | null;
	groupLabels: string[];
	autoCategory: NodeCategory;
	category: NodeCategory;
	overridden: boolean;
	aliases: string[];
	haystackTitle: string;
	haystack: string;
}

export interface ParsedCanvas {
	nodes: CanvasNodeLike[];
	edges: Array<{ id: string; fromNode: string; toNode: string; label?: string }>;
	warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function parseCanvas(text: string): ParsedCanvas {
	const warnings: string[] = [];
	if (text.trim() === '') return { nodes: [], edges: [], warnings: ['Пустой Canvas'] };
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { nodes: [], edges: [], warnings: ['Canvas содержит некорректный JSON — навигация недоступна, файл не изменяется'] };
	}
	if (!isObj(raw)) return { nodes: [], edges: [], warnings: ['Canvas не является объектом JSON'] };
	const nodes: CanvasNodeLike[] = [];
	if (Array.isArray(raw.nodes)) {
		for (const n of raw.nodes) {
			if (!isObj(n) || typeof n.id !== 'string') {
				warnings.push('Пропущен узел без id');
				continue;
			}
			nodes.push({
				...n,
				id: n.id,
				type: typeof n.type === 'string' ? n.type : 'unknown',
				x: num(n.x),
				y: num(n.y),
				width: num(n.width),
				height: num(n.height),
			});
		}
	}
	const edges: ParsedCanvas['edges'] = [];
	if (Array.isArray(raw.edges)) {
		for (const ed of raw.edges) {
			if (isObj(ed) && typeof ed.id === 'string' && typeof ed.fromNode === 'string' && typeof ed.toNode === 'string') {
				edges.push({ id: ed.id, fromNode: ed.fromNode, toNode: ed.toNode, label: typeof ed.label === 'string' ? ed.label : undefined });
			}
		}
	}
	return { nodes, edges, warnings };
}

const CATEGORY_WORDS: Array<[NodeCategory, RegExp]> = [
	// JS \b is ASCII-only, so a Unicode-aware lookahead is used for Cyrillic words.
	['npc', /^(npc|нпс|нпц|персонажи мастера)(?![\p{L}\p{N}])/iu],
	['loot', /^(лут|loot|добыча|сокровища)(?![\p{L}\p{N}])/iu],
	['plot', /^(сюжет|plot|story|квест)(?![\p{L}\p{N}])/iu],
	['homebrew', /^(homebrew|хоумбрю|хомбрю)(?![\p{L}\p{N}])/iu],
	['ignore', /^(игнор|ignore)/iu],
	['notes', /^(заметки|notes)(?![\p{L}\p{N}])/iu],
];

export function categoryFromLabel(label: string | undefined): NodeCategory | null {
	if (!label) return null;
	const l = label.trim();
	for (const [cat, re] of CATEGORY_WORDS) if (re.test(l)) return cat;
	return null;
}

function categoryFromPath(path: string): NodeCategory | null {
	const p = `/${path}`;
	if (/\/Elements\/NPC\//i.test(p)) return 'npc';
	if (/\/Сюжет\//i.test(p)) return 'plot';
	if (/\/(trash)\//i.test(p)) return 'ignore';
	return null;
}

function contains(g: CanvasNodeLike, n: CanvasNodeLike): boolean {
	const cx = n.x + n.width / 2;
	const cy = n.y + n.height / 2;
	return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height;
}

function titleOf(n: CanvasNodeLike): string {
	if (n.type === 'text' && typeof n.text === 'string') {
		const line = n.text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
		return line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().slice(0, 140) || '(пустой текст)';
	}
	if (n.type === 'file' && typeof n.file === 'string') {
		const base = (n.file.split('/').pop() ?? n.file).replace(/\.md$/i, '');
		return n.subpath ? `${base}${n.subpath}` : base;
	}
	if (n.type === 'link' && typeof n.url === 'string') {
		try {
			const u = new URL(n.url);
			return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
		} catch {
			return n.url;
		}
	}
	if (n.type === 'group') return typeof n.label === 'string' && n.label ? n.label : '(группа)';
	return `(${n.type})`;
}

export interface BuildItemsOptions extends NormalizeOptions {
	overrides: Record<string, NodeCategory>;
	aliasesFor?: (filePath: string) => string[];
}

export function buildItems(canvas: ParsedCanvas, opts: BuildItemsOptions): CanvasItem[] {
	const groups = canvas.nodes.filter((n) => n.type === 'group');
	// Smaller groups first so the innermost group wins.
	const bySize = [...groups].sort((a, b) => a.width * a.height - b.width * b.height);
	const items: CanvasItem[] = [];
	for (const n of canvas.nodes) {
		const containing = bySize.filter((g) => g.id !== n.id && contains(g, n));
		const groupLabels = containing.map((g) => (typeof g.label === 'string' ? g.label : '')).filter(Boolean);
		const title = titleOf(n);
		let auto: NodeCategory | null = null;
		if (n.type === 'group') auto = categoryFromLabel(n.label);
		for (const g of containing) {
			if (auto) break;
			auto = categoryFromLabel(g.label);
		}
		if (!auto && typeof n.file === 'string') auto = categoryFromPath(n.file);
		if (!auto && n.type === 'text') auto = categoryFromLabel(title);
		const autoCategory = auto ?? 'notes';
		const override = opts.overrides[n.id];
		const aliases = typeof n.file === 'string' && opts.aliasesFor ? opts.aliasesFor(n.file) : [];
		const text = typeof n.text === 'string' ? n.text : '';
		const filePath = typeof n.file === 'string' ? n.file : null;
		const url = typeof n.url === 'string' ? n.url : null;
		const category = override ?? autoCategory;
		const subtitleParts: string[] = [];
		if (filePath) subtitleParts.push(filePath);
		else if (url) subtitleParts.push(url);
		if (groupLabels[0]) subtitleParts.push(`группа «${groupLabels[0]}»`);
		const haystack = normalizeText(
			[title, text, filePath ?? '', url ?? '', ...aliases, ...groupLabels, CATEGORY_LABELS[category]].join(' \n '),
			opts,
		);
		items.push({
			nodeId: n.id,
			type: n.type,
			title,
			subtitle: subtitleParts.join(' · '),
			text,
			filePath,
			url,
			groupLabels,
			autoCategory,
			category,
			overridden: override !== undefined,
			aliases,
			haystackTitle: normalizeText([title, ...aliases].join(' '), opts),
			haystack,
		});
	}
	markDuplicates(items);
	return items;
}

/** Equal titles get a disambiguating subtitle (node id) so results are never confused. */
function markDuplicates(items: CanvasItem[]): void {
	const counts = new Map<string, number>();
	for (const i of items) counts.set(i.title, (counts.get(i.title) ?? 0) + 1);
	for (const i of items) {
		if ((counts.get(i.title) ?? 0) > 1) i.subtitle = [i.subtitle, `узел ${i.nodeId}`].filter(Boolean).join(' · ');
	}
}

export interface SearchOptions extends NormalizeOptions {
	categories?: Set<NodeCategory>;
	includeIgnored: boolean;
	limit: number;
}

export interface SearchHit {
	item: CanvasItem;
	score: number;
}

export function searchItems(items: CanvasItem[], query: string, opts: SearchOptions): SearchHit[] {
	const q = normalizeText(query, opts);
	const tokens = q.split(' ').filter(Boolean);
	const hits: SearchHit[] = [];
	for (const item of items) {
		if (!opts.includeIgnored && item.category === 'ignore') continue;
		if (opts.categories && !opts.categories.has(item.category)) continue;
		if (tokens.length === 0) {
			hits.push({ item, score: 0 });
			continue;
		}
		let score = 0;
		let ok = true;
		for (const t of tokens) {
			if (item.haystackTitle.startsWith(t)) score += 100;
			else if (item.haystackTitle.includes(` ${t}`)) score += 60;
			else if (item.haystackTitle.includes(t)) score += 40;
			else if (item.haystack.includes(t)) score += 10;
			else {
				ok = false;
				break;
			}
		}
		if (ok) hits.push({ item, score });
	}
	hits.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'ru') || a.item.nodeId.localeCompare(b.item.nodeId));
	return hits.slice(0, opts.limit);
}

export function groupByCategory(items: CanvasItem[]): Map<NodeCategory, CanvasItem[]> {
	const map = new Map<NodeCategory, CanvasItem[]>();
	for (const c of CATEGORY_ORDER) map.set(c, []);
	for (const i of items) map.get(i.category)?.push(i);
	return map;
}
