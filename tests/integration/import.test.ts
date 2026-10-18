import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { findManagedBlock } from '../../src/domain/character-markdown';
import { DEFAULT_REDUCER_OPTIONS } from '../../src/domain/reducer';
import { applyImport, prepareImport, revertImportFiles } from '../../src/services/import-service';
import { AdventureStore } from '../../src/services/persistence';
import { MemoryVaultPort } from './memory-vault';

const VAULT = join(__dirname, '..', 'fixtures', 'test-vault');
const fx = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'import', name), 'utf8');
const A = 'Приключение А';
const opts = { reducer: () => DEFAULT_REDUCER_OPTIONS, backupLimit: () => 3 };

let vault: MemoryVaultPort;
let store: AdventureStore;
beforeEach(async () => {
	vault = MemoryVaultPort.fromDir(VAULT);
	store = new AdventureStore(vault, A, opts);
	await store.load();
});

async function importText(text: string, overwriteRuntime = false) {
	const prep = await prepareImport(vault, store.state!, text);
	return { prep, ...(await applyImport(vault, store, prep.candidates, { overwriteRuntime, addToPartyId: 'main' })) };
}

describe('AC-08 импорт создаёт Markdown и ID', () => {
	it('создание новой заметки в Elements/Персонажи', async () => {
		const { report } = await importText(fx('multiclass.json'));
		expect(report.map((r) => r.status)).toEqual(['created', 'created']);
		const path = `${A}/Elements/Персонажи/Кайра.md`;
		const note = vault.files.get(path)!;
		const id = /canvasAssistId: (\S+)/.exec(note)![1]!;
		expect(store.state!.characters[id]!.notePath).toBe('Elements/Персонажи/Кайра.md');
		expect(store.state!.characters[id]!.classes).toHaveLength(2);
		expect(store.state!.parties[0]!.characterIds).toContain(id);
		expect(findManagedBlock(note)).not.toBeNull();
	});

	it('имя совпадает с существующей заметкой без связи — по умолчанию пропуск, выбор явный', async () => {
		const prep = await prepareImport(vault, store.state!, fx('valid-full.json').replace('"characterId": "pc-mira-import",', ''));
		const c = prep.candidates[0]!;
		expect(c.mode).toBe('skip');
		expect(c.nameClash).toBe('Elements/Персонажи/Мира.md');
		const before = vault.files.get(`${A}/Elements/Персонажи/Мира.md`)!;
		await applyImport(vault, store, prep.candidates, { overwriteRuntime: false, addToPartyId: null });
		expect(vault.files.get(`${A}/Elements/Персонажи/Мира.md`)).toBe(before);
		// Explicit choice: update that file -> uses its existing canvasAssistId.
		c.mode = 'update';
		const { report } = await applyImport(vault, store, prep.candidates, { overwriteRuntime: false, addToPartyId: null });
		expect(report[0]!.status).toBe('updated');
		const after = vault.files.get(`${A}/Elements/Персонажи/Мира.md`)!;
		expect(after.startsWith(before)).toBe(true);
		expect(after).toContain('canvasAssistId: adv-A-pc-mira');
		expect(after).toContain('# Мира');
		expect(store.state!.characters['adv-A-pc-mira']!.hp.max).toBe(20);
	});

	it('AC-10 повторный импорт: обновляет блок, текущие ресурсы сохраняются', async () => {
		const first = await prepareImport(vault, store.state!, fx('valid-full.json'));
		expect(first.candidates[0]!.mode).toBe('skip');
		first.candidates[0]!.mode = 'create';
		await applyImport(vault, store, first.candidates, { overwriteRuntime: false, addToPartyId: 'main' });
		const id = 'pc-mira-import';
		const path = `${A}/Elements/Персонажи/Мира 2.md`;
		expect(vault.files.has(path)).toBe(true);
		// User adds own notes outside the block
		vault.files.set(path, `${vault.files.get(path)!}\nМоя заметка: не трогать.\n`);
		await store.dispatch({ type: 'hp/damage', target: { kind: 'character', id }, amount: 4, useTemporary: true });
		const { report, prep } = await importText(fx('levelup.json'));
		expect(prep.candidates[0]!.mode).toBe('update');
		expect(report[0]!.status).toBe('updated');
		expect(store.state!.characters[id]!.hp).toEqual({ current: 5, max: 26, temporary: 0 });
		expect(vault.files.get(path)).toContain('Моя заметка: не трогать.');
		expect(vault.files.get(path)).toContain('Волшебник 4');
	});

	it('AC-11 ошибочный JSON: ничего в хранилище не изменилось', async () => {
		const before = vault.snapshot('');
		for (const f of ['invalid-syntax.json', 'invalid-values.json', 'unknown-version.json', 'overflow.json', 'negative.json']) {
			const { report, outcome } = await importText(fx(f));
			expect(outcome).toBeNull();
			expect(report.every((r) => r.status !== 'created' && r.status !== 'updated')).toBe(true);
		}
		expect(vault.snapshot('')).toBe(before);
	});

	it('Undo импорта восстанавливает блок, если заметку не меняли; созданный файл не удаляется', async () => {
		const alex = `${A}/Elements/Персонажи/Алекс.md`;
		const original = vault.files.get(alex)!;
		const text = JSON.stringify({ schemaVersion: 1, kind: 'player-character', characterId: 'adv-A-pc-alex', name: 'Алекс', armorClass: 18 });
		const { report } = await importText(text);
		expect(report[0]!.status).toBe('updated');
		expect(vault.files.get(alex)).toContain('**КД:** 18');
		const entry = store.state!.history.undo.at(-1)!;
		expect(entry.files).toHaveLength(1);
		await store.dispatch({ type: 'history/undo' });
		const notes = await revertImportFiles(vault, entry.files!);
		expect(notes).toEqual([]);
		expect(vault.files.get(alex)).toBe(original);
		expect(store.state!.characters['adv-A-pc-alex']!.ac).toBe(17);
	});

	it('история при удалении созданного после импорта файла', async () => {
		await importText(fx('partial.json'));
		const entry = store.state!.history.undo.at(-1)!;
		vault.files.delete(`${A}/Elements/Персонажи/Бор Неполный.md`);
		await store.dispatch({ type: 'history/undo' });
		const notes = await revertImportFiles(vault, entry.files!);
		expect(notes[0]).toMatch(/создан импортом/);
	});

	it('HTML из JSON не попадает в заметку как разметка', async () => {
		await importText(fx('html-injection.json'));
		const file = [...vault.files.keys()].find((k) => k.includes('Хакер'))!;
		const note = vault.files.get(file)!;
		expect(note).not.toMatch(/<script|<img|<b>/i);
		expect(file).not.toMatch(/[<>]/);
	});
});
