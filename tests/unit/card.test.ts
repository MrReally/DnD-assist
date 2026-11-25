import { describe, expect, it } from 'vitest';
import { cardTargetForNote, characterForNote, hpPercent, parseHpInput } from '../../src/domain/card';
import { createAdventureState, emptyCharacter } from '../../src/domain/state';
import { run } from '../helpers';

function adventure(root: string, name: string, note: string) {
	let s = createAdventureState(`adv-${root}`, `st-${root}`, root, root);
	const ch = { ...emptyCharacter(`pc-${root}`, name, note), hp: { current: 17, max: 28, temporary: 0 } };
	s = run(s, { type: 'character/upsert', character: ch });
	return s;
}

describe('card resolution (adventure isolation)', () => {
	const A = adventure('Приключение А', 'Алекс', 'Elements/Персонажи/Алекс.md');
	const B = adventure('Приключение Б', 'Алекс', 'Elements/Персонажи/Алекс.md');

	it('resolves a character by its note inside the root', () => {
		expect(characterForNote(A, 'Приключение А/Elements/Персонажи/Алекс.md')?.id).toBe('pc-Приключение А');
		expect(cardTargetForNote(A, 'Приключение А/Elements/Персонажи/Алекс.md')).toEqual({ kind: 'character', id: 'pc-Приключение А' });
	});

	it('does not resolve a same-named note of another adventure', () => {
		expect(characterForNote(A, 'Приключение Б/Elements/Персонажи/Алекс.md')).toBeNull();
		expect(characterForNote(B, 'Приключение А/Elements/Персонажи/Алекс.md')).toBeNull();
	});

	it('returns null for unknown notes and prefix look-alikes', () => {
		expect(characterForNote(A, 'Приключение А/Сюжет/Главное.md')).toBeNull();
		expect(characterForNote(A, 'Приключение А2/Elements/Персонажи/Алекс.md')).toBeNull();
	});
});

describe('HP input', () => {
	it.each([
		['-7', 'damage', 7],
		['−7', 'invalid', 0],
		['+5', 'heal', 5],
		['5', 'heal', 5],
		['=12', 'set', 12],
		[' = 12 ', 'set', 12],
		['', 'invalid', 0],
		['abc', 'invalid', 0],
		['1.5', 'invalid', 0],
		['-', 'invalid', 0],
		['1234567', 'invalid', 0],
	])('%s → %s', (text, kind, amount) => {
		expect(parseHpInput(text)).toEqual({ kind, amount });
	});

	it('hpPercent clamps and handles unknown max', () => {
		expect(hpPercent(17, 28)).toBe(61);
		expect(hpPercent(40, 28)).toBe(100);
		expect(hpPercent(0, 28)).toBe(0);
		expect(hpPercent(5, null)).toBe(0);
		expect(hpPercent(5, 0)).toBe(0);
	});
});
