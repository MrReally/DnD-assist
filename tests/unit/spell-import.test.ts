import { describe, expect, it } from 'vitest';
import { findInLibrary, importSpell, parseTtgSpellLink, upsertSpell, type SpellCard } from '../../src/domain/spell-import';

const card = (over: Partial<SpellCard> = {}): SpellCard => ({ id: 'fireball', name: 'Огненный шар', nameEn: 'Fireball', level: 3, school: 'Воплощение', castingTime: '1 действие', range: '150 футов', components: 'В, С, М', duration: 'Мгновенная', concentration: false, text: 'Текст GM', source: 'GM', origin: 'manual', url: 'https://5e14.ttg.club/spells/fireball', ...over });

describe('TTG link parsing', () => {
	it.each(['https://5e14.ttg.club/spells/fireball', 'https://5e14.ttg.club/spells/fireball/', 'https://ttg.club/spells/Fireball'])('accepts %s', (u) => {
		expect(parseTtgSpellLink(u)?.slug).toBe('fireball');
	});
	it.each(['http://5e14.ttg.club/spells/fireball', 'https://evil.example/spells/fireball', 'https://5e14.ttg.club/api/v1/spells', 'https://5e14.ttg.club/bestiary/goblin', 'javascript:alert(1)', 'not a url'])('rejects %s', (u) => {
		expect(parseTtgSpellLink(u)).toBeNull();
	});
});

describe('importer chain', () => {
	it('link found in local library works offline (no network involved)', () => {
		const r = importSpell({ kind: 'link', url: 'https://5e14.ttg.club/spells/fireball' }, [card()]);
		expect(r).toMatchObject({ status: 'ok', via: 'локальная библиотека' });
	});
	it('link not in library asks for permitted data instead of fetching', () => {
		const r = importSpell({ kind: 'link', url: 'https://5e14.ttg.club/spells/shield' }, []);
		expect(r.status).toBe('needs-data');
		if (r.status === 'needs-data') expect(r.reason).toMatch(/robots\.txt/);
	});
	it('finds by Russian or English name, ё/е folded', () => {
		expect(findInLibrary([card({ name: 'Ёлочка', id: 'x', nameEn: undefined })], { name: 'елочка' })?.id).toBe('x');
		expect(importSpell({ kind: 'name', name: 'fireball' }, [card()]).status).toBe('ok');
		expect(importSpell({ kind: 'name', name: 'nope' }, [card()]).status).toBe('error');
	});
	it('JSON and manual validate fields strictly', () => {
		const j = JSON.stringify({ name: 'Щит', level: 1, school: 'Ограждение', castingTime: 'реакция', range: 'на себя', components: 'В, С', duration: '1 раунд', text: 'КД +5' });
		const r = importSpell({ kind: 'json', text: j }, []);
		expect(r.status === 'ok' && r.card.origin).toBe('json');
		expect(importSpell({ kind: 'json', text: '{bad' }, []).status).toBe('error');
		expect(importSpell({ kind: 'json', text: JSON.stringify({ name: 'x', level: 10 }) }, []).status).toBe('error');
		expect(importSpell({ kind: 'manual', card: { name: 'x', level: 1 } }, []).status).toBe('error');
		expect(importSpell({ kind: 'json', text: JSON.stringify({ ...JSON.parse(j), url: 'http://x' }) }, []).status).toBe('error');
	});
	it('custom importers extend the chain without changing callers', () => {
		const custom = { id: 'c', label: 'c', handles: () => true, run: () => ({ status: 'error' as const, error: 'custom' }) };
		expect(importSpell({ kind: 'name', name: 'a' }, [], [custom])).toEqual({ status: 'error', error: 'custom' });
	});
	it('upsert replaces by id and keeps the library sorted', () => {
		const lib = upsertSpell(upsertSpell([], card()), card({ text: 'new' }));
		expect(lib).toHaveLength(1);
		expect(lib[0]?.text).toBe('new');
	});
});
