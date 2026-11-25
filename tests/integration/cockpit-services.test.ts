import { describe, expect, it } from 'vitest';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from '../../src/services/checkpoints';
import { creatureForNote, resolveCard } from '../../src/domain/card';
import { cockpitOf } from '../../src/domain/cockpit';
import { isRoomNote, parseRoom } from '../../src/domain/room';
import { createAdventureState, emptyCharacter } from '../../src/domain/state';
import { migrateState } from '../../src/domain/migrations';
import { run } from '../helpers';
import { MemoryVaultPort } from './memory-vault';

const nodesOf = (v: MemoryVaultPort, path: string): unknown[] => (JSON.parse(v.files.get(path) as string) as { nodes: unknown[] }).nodes;
const canvas = (n: number): string => JSON.stringify({ nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: 'text', text: 'x', x: i, y: 0, width: 10, height: 10 })), edges: [] });

describe('checkpoints', () => {
	it('create → modify → restore with a protective copy; the state sidecar is never touched', async () => {
		const v = new MemoryVaultPort();
		v.files.set('Root/Холсты/01.canvas', canvas(3));
		v.files.set('Root/.canvas-assist-state.json', '{"keep":"me"}');
		const cp = await createCheckpoint(v, 'Root', 'Root/Холсты/01.canvas', 'Холсты/01.canvas', 'Перед сессией', 'manual', new Date('2026-11-01T10:00:00Z'));
		expect(cp.nodes).toBe(3);
		v.files.set('Root/Холсты/01.canvas', canvas(1));
		const before = v.writes.length;
		const prot = await restoreCheckpoint(v, 'Root', 'Root/Холсты/01.canvas', 'Холсты/01.canvas', cp);
		expect(nodesOf(v, 'Root/Холсты/01.canvas')).toHaveLength(3);
		expect(prot.nodes).toBe(1);
		expect(v.files.get('Root/.canvas-assist-state.json')).toBe('{"keep":"me"}');
		expect(v.writes.slice(before).every((p) => p.endsWith('.canvas'))).toBe(true);
		const list = await listCheckpoints(v, 'Root', 'Холсты/01.canvas');
		expect(list.map((c) => c.kind).sort()).toEqual(['manual', 'protective']);
		expect(list.find((c) => c.kind === 'manual')?.name).toBe('Перед сессией');
	});
	it('refuses to snapshot or restore corrupt JSON and leaves the canvas unchanged', async () => {
		const v = new MemoryVaultPort();
		v.files.set('Root/a.canvas', '{broken');
		await expect(createCheckpoint(v, 'Root', 'Root/a.canvas', 'a.canvas', 'x')).rejects.toThrow();
		v.files.set('Root/a.canvas', canvas(2));
		const cp = await createCheckpoint(v, 'Root', 'Root/a.canvas', 'a.canvas', 'ok');
		v.files.set(cp.path, '{broken');
		v.files.set('Root/a.canvas', canvas(5));
		await expect(restoreCheckpoint(v, 'Root', 'Root/a.canvas', 'a.canvas', cp)).rejects.toThrow();
		expect(nodesOf(v, 'Root/a.canvas')).toHaveLength(5);
	});
	it('a failing protective copy aborts the restore', async () => {
		const v = new MemoryVaultPort();
		v.files.set('Root/a.canvas', canvas(2));
		const cp = await createCheckpoint(v, 'Root', 'Root/a.canvas', 'a.canvas', 'ok');
		v.files.set('Root/a.canvas', canvas(4));
		v.failWrites = true;
		await expect(restoreCheckpoint(v, 'Root', 'Root/a.canvas', 'a.canvas', cp)).rejects.toThrow();
		expect(nodesOf(v, 'Root/a.canvas')).toHaveLength(4);
	});
	it('ignores foreign files in the checkpoint folder', async () => {
		const v = new MemoryVaultPort();
		v.files.set('Root/.canvas-assist-checkpoints/a/notes.txt', 'x');
		expect(await listCheckpoints(v, 'Root', 'a.canvas')).toEqual([]);
	});
});

describe('room cards', () => {
	const md = '---\ntags: [x]\n---\n# Таверна\nЗал.\n\n## Объекты\n- Стойка\n\n## Скрытые находки\nЯщик (СЛ 14)\n\n```\n## not a heading\n```\n';
	it('parses sections, marks hidden ones, ignores fences and frontmatter', () => {
		const r = parseRoom(md, 'fallback');
		expect(r.title).toBe('Таверна');
		expect(r.intro).toBe('Зал.');
		expect(r.sections.map((s) => [s.heading, s.hidden])).toEqual([['Объекты', false], ['Скрытые находки', true]]);
		expect(r.sections[1]?.body).toContain('not a heading');
	});
	it('has no progress fields and recognises room notes', () => {
		expect(Object.keys(parseRoom(md, 'x').sections[0] ?? {}).sort()).toEqual(['body', 'heading', 'hidden', 'level']);
		expect(isRoomNote('Elements/Локации/Таверна.md')).toBe(true);
		expect(isRoomNote('Elements/NPC/Гоблин.md')).toBe(false);
	});
});

describe('state compatibility', () => {
	it('a v1.0.0 state without cockpit data yields empty cockpit structures and a usable card', () => {
		let s = createAdventureState('adv', 'st', 'Root', 'Root');
		s = run(s, { type: 'character/upsert', character: { ...emptyCharacter('pc', 'Алекс', 'Elements/Персонажи/Алекс.md'), hp: { current: 5, max: 9, temporary: 0 } } });
		expect(s.extensions.cockpit).toBeUndefined();
		expect(cockpitOf(s).items).toEqual({});
		const card = resolveCard(s, { kind: 'character', id: 'pc' });
		expect(card).toMatchObject({ kind: 'pc', name: 'Алекс', hp: { current: 5, max: 9 }, attacks: [] });
		const m = migrateState(JSON.parse(JSON.stringify(s)), () => 'st-new');
		expect(m.ok).toBe(true);
	});
	it('NPC note mapping only within the same adventure root', () => {
		const s = createAdventureState('adv', 'st', 'Root', 'Root');
		s.creatures.c1 = { id: 'c1', name: 'Бандит', aliases: [], ac: 12, hpMax: 11, initiativeModifier: 1, speed: '30', notes: '', source: { provider: 'note', ref: 'Elements/NPC/Бандит.md' } };
		expect(creatureForNote(s, 'Root/Elements/NPC/Бандит.md')).toBe('c1');
		expect(creatureForNote(s, 'Other/Elements/NPC/Бандит.md')).toBeNull();
	});
});
