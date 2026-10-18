import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildItems, groupByCategory, parseCanvas, searchItems } from '../../src/domain/canvas-model';
import { safeRelativePath, relativeTo, sanitizeFileName } from '../../src/domain/normalize';

const vault = join(__dirname, '..', 'fixtures', 'test-vault');
const canvas = (rel: string) => parseCanvas(readFileSync(join(vault, rel), 'utf8'));
const items = (rel: string, overrides = {}, foldYo = true) => buildItems(canvas(rel), { foldYo, overrides });
const search = (list: ReturnType<typeof items>, q: string, foldYo = true, includeIgnored = false) =>
	searchItems(list, q, { foldYo, includeIgnored, limit: 50 }).map((h) => h.item.nodeId);

describe('AC-04 русский поиск', () => {
	const list = items('Приключение А/Холсты/01.canvas');
	it('гоб / ГоБ находят гоблина', () => {
		expect(search(list, 'гоб')[0]).toBe('node-01');
		expect(search(list, 'ГоБ')[0]).toBe('node-01');
	});
	it('ё/е по настройке', () => {
		expect(search(list, 'елка')).toContain('node-02');
		expect(search(items('Приключение А/Холсты/01.canvas', {}, false), 'елка', false)).not.toContain('node-02');
		expect(search(items('Приключение А/Холсты/01.canvas', {}, false), 'ёлка', false)).toContain('node-02');
	});
	it('частичные совпадения и символы', () => {
		expect(search(list, 'встреч')).toContain('node-02');
		expect(search(list, 'ttg.club')).toContain('node-03');
		expect(search(list, 'Elements/NPC')).toContain('node-01');
	});
	it('500 узлов без зависания', () => {
		const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, type: 'text', text: `Гоблин номер ${i} ёж`, x: i * 10, y: 0, width: 100, height: 50 }));
		const big = buildItems({ nodes, edges: [], warnings: [] }, { foldYo: true, overrides: {} });
		const t0 = performance.now();
		for (let i = 0; i < 20; i++) searchItems(big, 'гоб 49', { foldYo: true, includeIgnored: false, limit: 50 });
		expect((performance.now() - t0) / 20).toBeLessThan(80);
	});
});

describe('AC-05 типизация', () => {
	it('группа NPC даёт тип NPC; Лут — пустая группа; текст Сюжет', () => {
		const list = items('Приключение А/Холсты/01.canvas');
		const by = Object.fromEntries(list.map((i) => [i.nodeId, i.category]));
		expect(by['node-01']).toBe('npc');
		expect(by['group-loot']).toBe('loot');
		expect(by['node-02']).toBe('plot');
		expect(by['node-03']).toBe('notes');
		const homebrew = items('Приключение А/Холсты/02.canvas');
		expect(homebrew.find((i) => i.nodeId === 'node-04')!.category).toBe('homebrew');
	});
	it('ручной override побеждает; Ignore исключается фильтром', () => {
		const list = items('Приключение А/Холсты/01.canvas', { 'node-01': 'ignore' });
		expect(list.find((i) => i.nodeId === 'node-01')!.category).toBe('ignore');
		expect(search(list, 'гоб')).not.toContain('node-01');
		expect(search(list, 'гоб', true, true)).toContain('node-01');
		expect(groupByCategory(list).get('ignore')!.map((i) => i.nodeId)).toEqual(['node-01']);
	});
});

describe('сложный Canvas', () => {
	it('дубликаты заголовков получают различимую подпись; неизвестные узлы переживают разбор', () => {
		const c = parseCanvas(
			JSON.stringify({
				nodes: [
					{ id: 'a', type: 'text', text: '# Таверна', x: 0, y: 0, width: 10, height: 10 },
					{ id: 'b', type: 'text', text: 'Таверна', x: 50, y: 0, width: 10, height: 10 },
					{ id: 'c', type: 'future-widget', x: 0, y: 0, width: 1, height: 1, payload: { a: 1 } },
				],
				edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
				extra: true,
			}),
		);
		const list = buildItems(c, { foldYo: true, overrides: {} });
		expect(list.filter((i) => i.title === 'Таверна').map((i) => i.subtitle)).toEqual(['узел a', 'узел b']);
		expect(list.find((i) => i.nodeId === 'c')!.title).toBe('(future-widget)');
	});
	it('битый JSON — предупреждение, не исключение', () => {
		expect(parseCanvas('{oops').warnings[0]).toMatch(/некорректный JSON/);
		expect(parseCanvas('').nodes).toEqual([]);
	});
});

describe('пути', () => {
	it('попытки выхода за корень отклоняются (AC-44)', () => {
		expect(safeRelativePath('../x.md')).toBeNull();
		expect(safeRelativePath('/etc/passwd')).toBeNull();
		expect(safeRelativePath('C:/x')).toBeNull();
		expect(safeRelativePath('a//b')).toBeNull();
		expect(safeRelativePath('Elements/Персонажи/Мира.md')).toBe('Elements/Персонажи/Мира.md');
		expect(relativeTo('Приключение А', 'Приключение Б/x.md')).toBeNull();
		expect(relativeTo('Приключение А', 'Приключение А2/x.md')).toBeNull();
		expect(sanitizeFileName('../Мира: <b>"?')).toBe('Мира b');
	});
});
