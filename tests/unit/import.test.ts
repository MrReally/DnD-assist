import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImportText, planImport } from '../../src/domain/character';
import { BLOCK_BEGIN, BLOCK_END, findManagedBlock, mergeManagedBlock, newCharacterNote, renderSheetBlock } from '../../src/domain/character-markdown';

const fx = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'import', name), 'utf8');

describe('импорт JSON: валидация', () => {
	it('корректный полный лист проходит', () => {
		const r = parseImportText(fx('valid-full.json'));
		expect(r.fatal).toBeNull();
		expect(r.records[0]!.errors).toEqual([]);
		expect(r.records[0]!.value?.name).toBe('Мира');
	});

	it('минимальный лист из development kit проходит', () => {
		const r = parseImportText(fx('valid-minimal.json'));
		expect(r.records[0]!.errors).toEqual([]);
	});

	it('AC-11 ошибочные значения: сообщения с путём поля', () => {
		const r = parseImportText(fx('invalid-values.json'));
		const paths = r.records[0]!.errors.map((e) => e.path);
		expect(paths).toContain('$.name');
		expect(paths).toContain('$.hitPoints.max');
		expect(paths).toContain('$.hitPoints.current');
		expect(r.records[0]!.value).toBeNull();
	});

	it('неизвестная версия схемы', () => {
		const r = parseImportText(fx('unknown-version.json'));
		expect(r.records[0]!.errors[0]!.message).toMatch(/неизвестная версия схемы/);
	});

	it('синтаксическая ошибка', () => {
		const r = parseImportText(fx('invalid-syntax.json'));
		expect(r.fatal).toMatch(/Синтаксическая ошибка JSON/);
	});

	it('числовое переполнение', () => {
		expect(parseImportText(fx('overflow.json')).fatal).toMatch(/переполнение/);
	});

	it('отрицательные ресурсы', () => {
		const errs = parseImportText(fx('negative.json')).records[0]!.errors.map((e) => e.path);
		expect(errs).toEqual(expect.arrayContaining(['$.hitPoints.current', '$.spellSlots.1.max', '$.customResources[0].current']));
	});

	it('текущее больше максимума', () => {
		const errs = parseImportText(fx('over-max.json')).records[0]!.errors.map((e) => e.path);
		expect(errs).toEqual(expect.arrayContaining(['$.hitPoints.current', '$.spellSlots.1.current']));
	});

	it('HTML/скрипты: предупреждение и экранирование', () => {
		const r = parseImportText(fx('html-injection.json'));
		const rec = r.records[0]!;
		expect(rec.errors).toEqual([]);
		expect(rec.warnings.length).toBeGreaterThanOrEqual(3);
		const md = renderSheetBlock(rec.value!, 'pc-x');
		expect(md).not.toMatch(/<script/i);
		expect(md).not.toMatch(/<img/i);
		expect(md).not.toMatch(/<b>/);
		expect(md).not.toContain('[[Секрет]]');
		expect(md).not.toContain('![[embed.png]]');
		expect(md).toContain('&lt;script&gt;');
	});

	it('массовый импорт: отчёт по каждой записи', () => {
		const r = parseImportText(fx('multiclass.json'));
		expect(r.records).toHaveLength(2);
		expect(r.records.every((x) => x.errors.length === 0)).toBe(true);
	});

	it('неизвестные поля отклоняются (строгая схема)', () => {
		const r = parseImportText('{"schemaVersion":1,"kind":"player-character","name":"X","hp":5}');
		expect(r.records[0]!.errors[0]!.path).toBe('$.hp');
	});

	it('некорректный characterId (путь/спецсимволы) отклоняется', () => {
		const r = parseImportText('{"schemaVersion":1,"kind":"player-character","name":"X","characterId":"../../etc"}');
		expect(r.records[0]!.errors[0]!.path).toBe('$.characterId');
	});
});

describe('импорт JSON: план', () => {
	it('AC-08 создание: стабильный ID, значения листа', () => {
		const v = parseImportText(fx('valid-full.json')).records[0]!.value!;
		const plan = planImport(v, null, 'pc-mira-import', 'Elements/Персонажи/Мира.md', false);
		expect(plan.character.id).toBe('pc-mira-import');
		expect(plan.character.hp).toEqual({ current: 9, max: 20, temporary: 0 });
		expect(plan.character.spellSlots['2']).toEqual({ current: 2, max: 2 });
		expect(plan.character.counters['arcane-recovery']).toMatchObject({ recovery: 'long', current: 1, max: 1 });
	});

	it('AC-09 частичный лист: неизвестное остаётся пустым', () => {
		const v = parseImportText(fx('partial.json')).records[0]!.value!;
		const ch = planImport(v, null, 'pc-bor', 'Elements/Персонажи/Бор Неполный.md', false).character;
		expect(ch.hp.max).toBeNull();
		expect(ch.initiativeModifier).toBeNull();
		expect(ch.speedFeet).toBeNull();
		expect(ch.spellSlots).toEqual({});
		expect(ch.ac).toBe(14);
		const md = renderSheetBlock(v, 'pc-bor');
		expect(md).toContain('**Инициатива:** —');
		expect(md).toContain('**Максимум хитов:** —');
		expect(md).not.toMatch(/Инициатива:\*\* \+0/);
	});

	it('AC-10 повторный импорт: максимум и уровень меняются, текущие значения сохраняются', () => {
		const v1 = parseImportText(fx('valid-full.json')).records[0]!.value!;
		const first = planImport(v1, null, 'pc-mira-import', 'Elements/Персонажи/Мира.md', false).character;
		first.hp.current = 6;
		first.spellSlots['1']!.current = 1;
		const v2 = parseImportText(fx('levelup.json')).records[0]!.value!;
		const plan = planImport(v2, first, 'pc-mira-import', 'x', false);
		expect(plan.character.classes).toEqual([{ name: 'Волшебник', level: 4 }]);
		expect(plan.character.hp).toEqual({ current: 6, max: 26, temporary: 0 });
		expect(plan.character.spellSlots['1']).toEqual({ current: 1, max: 4 });
		expect(plan.character.spellSlots['2']).toEqual({ current: 2, max: 3 });
		expect(plan.character.notePath).toBe('Elements/Персонажи/Мира.md');
		expect(plan.permanent.map((l) => l.field)).toEqual(expect.arrayContaining(['Класс', 'Максимум хитов']));
		expect(plan.runtimeKept.map((l) => l.field)).toContain('Текущие хиты');
		const overwrite = planImport(v2, first, 'pc-mira-import', 'x', true);
		expect(overwrite.character.hp.current).toBe(26);
	});

	it('понижение максимума ограничивает текущие хиты', () => {
		const v1 = parseImportText(fx('valid-full.json')).records[0]!.value!;
		const first = planImport(v1, null, 'id', 'p', false).character;
		first.hp.current = 20;
		const lower = { ...v1, hitPoints: { max: 15, current: 15 } };
		expect(planImport(lower, first, 'id', 'p', false).character.hp.current).toBe(15);
	});
});

describe('Markdown: управляемый блок', () => {
	const v = parseImportText(fx('valid-full.json')).records[0]!.value!;
	const block = renderSheetBlock(v, 'pc-mira-import');

	it('новая заметка: frontmatter с ID и блок', () => {
		const note = newCharacterNote('Мира', 'pc-mira-import', block);
		expect(note.startsWith('---\ncanvasAssistId: pc-mira-import\n---\n# Мира')).toBe(true);
		expect(findManagedBlock(note)).not.toBeNull();
		expect(block).toContain('Магия, История');
		expect(block).toContain('| 8 (−1) | 14 (+2) | 12 (+1) | 16 (+3) | 10 (+0) | 13 (+1) |');
	});

	it('пользовательские секции не меняются при повторном импорте', () => {
		const user = `---\ncanvasAssistId: pc-mira-import\ntags: [pc]\n---\n# Мира\n\nМоя заметка до.\n\n${block}\n\n## Мои секреты\nНе трогать!\n`;
		const updated = mergeManagedBlock(user, renderSheetBlock({ ...v, armorClass: 15 }, 'pc-mira-import'));
		const loc = findManagedBlock(updated)!;
		expect(updated.slice(0, loc.start)).toBe(user.slice(0, user.indexOf(BLOCK_BEGIN)));
		expect(updated.slice(loc.end)).toBe(user.slice(user.indexOf(BLOCK_END) + BLOCK_END.length));
		expect(loc.content).toContain('**КД:** 15');
	});

	it('блока нет — добавляется в конец, остальное байт-в-байт', () => {
		const user = '---\ncanvasAssistId: adv-A-pc-alex\n---\n# Алекс\nТекст.';
		const merged = mergeManagedBlock(user, block);
		expect(merged.startsWith(user)).toBe(true);
	});

	it('повреждённые маркеры — ошибка, а не перезапись', () => {
		expect(() => mergeManagedBlock(`${BLOCK_BEGIN}\nбез конца`, block)).toThrow(/повреждён/);
		expect(() => mergeManagedBlock(`${block}\n${block}`, block)).toThrow(/повреждён/);
	});
});
