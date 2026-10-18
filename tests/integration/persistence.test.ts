import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REDUCER_OPTIONS } from '../../src/domain/reducer';
import { AdventureRegistry } from '../../src/services/adventure-registry';
import { AdventureStore, STATE_FILE } from '../../src/services/persistence';
import type { RegisteredAdventure } from '../../src/settings';
import type { AdventureState } from '../../src/domain/types';
import { MemoryVaultPort } from './memory-vault';

const VAULT = join(__dirname, '..', 'fixtures', 'test-vault');
const A = 'Приключение А';
const B = 'Приключение Б';
const opts = { reducer: () => DEFAULT_REDUCER_OPTIONS, backupLimit: () => 3, now: () => new Date('2026-10-18T10:00:00Z') };

let vault: MemoryVaultPort;
beforeEach(() => {
	vault = MemoryVaultPort.fromDir(VAULT);
});

async function open(root: string): Promise<AdventureStore> {
	const s = new AdventureStore(vault, root, opts);
	await s.load();
	return s;
}

describe('AC-43 миграция v1 → v2', () => {
	it('создаёт резервную копию и переносит данные', async () => {
		const original = vault.files.get(`${A}/${STATE_FILE}`)!;
		const store = await open(A);
		expect(store.info.mode).toBe('ok');
		expect(store.state!.schemaVersion).toBe(2);
		expect(store.state!.characters['adv-A-pc-alex']!.hp).toEqual({ current: 17, max: 28, temporary: 0 });
		expect(store.state!.characters['adv-A-pc-alex']!.name).toBe('Алекс');
		const backups = [...vault.files.keys()].filter((k) => k.includes('.canvas-assist-state.backup-v1-'));
		expect(backups).toHaveLength(1);
		expect(vault.files.get(backups[0]!)).toBe(original);
	});

	it('если резервную копию создать нельзя — миграция не выполняется, оригинал цел', async () => {
		const original = vault.files.get(`${A}/${STATE_FILE}`)!;
		vault.failCopies = true;
		const store = await open(A);
		expect(store.info.mode).toBe('recovery');
		expect(vault.files.get(`${A}/${STATE_FILE}`)).toBe(original);
	});

	it('неизвестная будущая версия — только чтение, без изменений', async () => {
		vault.files.set(`${A}/${STATE_FILE}`, JSON.stringify({ schemaVersion: 99, adventureId: 'x' }));
		const store = await open(A);
		expect(store.info.mode).toBe('recovery');
		expect(store.info.message).toMatch(/Неизвестная версия схемы 99/);
		expect((JSON.parse(vault.files.get(`${A}/${STATE_FILE}`)!) as { schemaVersion: number }).schemaVersion).toBe(99);
	});

	it('ротация резервных копий ограничена', async () => {
		for (let i = 0; i < 5; i++) {
			vault.files.set(`${A}/.canvas-assist-state.backup-v1-old${i}.json`, '{}');
		}
		await open(A);
		const backups = [...vault.files.keys()].filter((k) => k.includes('.canvas-assist-state.backup-v1-'));
		expect(backups.length).toBe(3);
	});
});

describe('AC-01 изоляция A/B', () => {
	it('изменение HP в A не меняет ни байта в B', async () => {
		const a = await open(A);
		const b = await open(B);
		const before = vault.snapshot(B);
		const r = await a.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-A-pc-alex' }, amount: 5, useTemporary: true });
		expect(r.ok).toBe(true);
		expect(vault.snapshot(B)).toBe(before);
		expect(b.state!.characters['adv-B-pc-alex']!.hp.current).toBe(7);
		const wrongId = await a.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-B-pc-alex' }, amount: 5, useTemporary: true });
		expect(wrongId.ok).toBe(false);
		expect(vault.snapshot(B)).toBe(before);
	});

	it('автовыбор приключения по пути Canvas', () => {
		const list: RegisteredAdventure[] = [
			{ adventureId: 'adv-A', rootPath: A, name: A },
			{ adventureId: 'adv-B', rootPath: B, name: B },
		];
		const reg = new AdventureRegistry(vault, () => list, async () => undefined);
		expect(reg.findForPath(`${A}/Холсты/01.canvas`)!.adventureId).toBe('adv-A');
		expect(reg.findForPath(`${B}/Холсты/01.canvas`)!.adventureId).toBe('adv-B');
		expect(reg.findForPath('Другое/x.canvas')).toBeNull();
		expect(reg.validateNewRoot(`${A}/Холсты`)).toMatch(/Вложенные/);
	});

	it('кандидаты корня по родителям и известным подпапкам', async () => {
		const reg = new AdventureRegistry(vault, () => [], async () => undefined);
		const c = await reg.candidatesFor(`${A}/Холсты/01.canvas`);
		expect(c[0]!.path).toBe(A);
		expect(c[0]!.hasState).toBe(true);
	});
});

describe('AC-31 перезапуск', () => {
	it('после подтверждённых действий всё восстанавливается из файла', async () => {
		const a = await open(A);
		await a.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-A-pc-alex' }, amount: 3, useTemporary: true });
		await a.dispatch({ type: 'template/upsert', template: { id: 't1', name: 'Т', partyId: null, includeParty: false, entries: [], notes: '' } });
		const restarted = await open(A);
		expect(restarted.state!.characters['adv-A-pc-alex']!.hp.current).toBe(14);
		expect(restarted.state!.encounterTemplates).toHaveLength(1);
		expect(restarted.state!.history.undo).toHaveLength(2);
		const u = await restarted.dispatch({ type: 'history/undo' });
		expect(u.ok).toBe(true);
		expect(restarted.state!.encounterTemplates).toHaveLength(0);
	});
});

describe('AC-33 сбой записи', () => {
	it('ошибка диска: нет ложного «сохранено», состояние не продвигается', async () => {
		const a = await open(A);
		vault.failWrites = true;
		const r = await a.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-A-pc-alex' }, amount: 3, useTemporary: true });
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/Не сохранено/);
		expect(a.info.status).toBe('error');
		expect(a.state!.characters['adv-A-pc-alex']!.hp.current).toBe(17);
		vault.failWrites = false;
		const ok = await a.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-A-pc-alex' }, amount: 3, useTemporary: true });
		expect(ok.ok).toBe(true);
		expect(a.info.status).toBe('saved');
		expect(a.state!.characters['adv-A-pc-alex']!.hp.current).toBe(14);
	});
});

describe('AC-34 повреждённый JSON', () => {
	it('режим только чтения, оригинал сохранён, понятное сообщение', async () => {
		const broken = '{"schemaVersion": 2, "adventureId": ';
		vault.files.set(`${A}/${STATE_FILE}`, broken);
		const a = await open(A);
		expect(a.info.mode).toBe('recovery');
		expect(a.info.message).toMatch(/повреждён/);
		expect(vault.files.get(`${A}/${STATE_FILE}`)).toBe(broken);
		expect(vault.files.get(a.info.backupPath!)).toBe(broken);
		const r = await a.dispatch({ type: 'clock/advance', minutes: 1 });
		expect(r.ok).toBe(false);
		const copy = await a.resetFromRecovery('adv-A', A);
		expect(vault.files.get(copy!)).toBe(broken);
		expect(a.info.mode).toBe('ok');
	});

	it('структурно неверный state (v2) — тоже recovery', async () => {
		vault.files.set(`${A}/${STATE_FILE}`, JSON.stringify({ schemaVersion: 2, adventureId: 'adv-A' }));
		const a = await open(A);
		expect(a.info.mode).toBe('recovery');
		expect(a.info.message).toMatch(/\$\./);
	});
});

describe('AC-35 конкурентная запись', () => {
	it('два редактора не перетирают друг друга молча', async () => {
		const first = await open(A);
		const second = await open(A);
		expect((await first.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-A-pc-alex' }, amount: 1, useTemporary: true })).ok).toBe(true);
		const onDisk = vault.files.get(`${A}/${STATE_FILE}`)!;
		const r = await second.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-A-pc-alex' }, amount: 10, useTemporary: true });
		expect(r.ok).toBe(false);
		expect(second.info.mode).toBe('conflict');
		expect(vault.files.get(`${A}/${STATE_FILE}`)).toBe(onDisk);
		const localCopy = second.info.backupPath!;
		expect((JSON.parse(vault.files.get(localCopy)!) as AdventureState).characters['adv-A-pc-alex']!.hp.current).toBe(7);
		await second.resolveUseExternal();
		expect(second.state!.characters['adv-A-pc-alex']!.hp.current).toBe(16);
		expect(second.info.mode).toBe('ok');
	});

	it('выбор локальной версии сохраняет внешнюю копию', async () => {
		const first = await open(A);
		const second = await open(A);
		await first.dispatch({ type: 'clock/advance', minutes: 10 });
		await second.dispatch({ type: 'clock/advance', minutes: 99 });
		const external = vault.files.get(`${A}/${STATE_FILE}`)!;
		await second.resolveUseLocal();
		const ext = [...vault.files.keys()].find((k) => k.includes('conflict-external'))!;
		expect(vault.files.get(ext)).toBe(external);
		expect(second.state!.gameClock.minutes).toBe(99);
	});

	it('внешнее изменение без локальных правок принимается при обновлении', async () => {
		const first = await open(A);
		const second = await open(A);
		await first.dispatch({ type: 'clock/advance', minutes: 10 });
		expect(await second.refreshFromDisk()).toBe('reloaded');
		expect(second.state!.gameClock.minutes).toBe(10);
		expect(await second.refreshFromDisk()).toBe('unchanged');
	});

	it('удалённый извне файл состояния — конфликт, а не тихое пересоздание', async () => {
		const a = await open(A);
		vault.files.delete(`${A}/${STATE_FILE}`);
		const r = await a.dispatch({ type: 'clock/advance', minutes: 1 });
		expect(r.ok).toBe(false);
		expect(a.info.mode).toBe('conflict');
	});

	it('очередь сериализует быстрые последовательные действия', async () => {
		const a = await open(A);
		const results = await Promise.all(
			Array.from({ length: 20 }, () => a.dispatch({ type: 'hp/damage', target: { kind: 'character', id: 'adv-A-pc-alex' }, amount: 1, useTemporary: true })),
		);
		expect(results.every((r) => r.ok)).toBe(true);
		const fresh = await open(A);
		expect(fresh.state!.characters['adv-A-pc-alex']!.hp.current).toBe(0);
		expect(fresh.state!.revision).toBe(a.state!.revision);
	});
});

describe('AC-36 переименование', () => {
	it('переименование корня обновляет реестр; пути заметок относительные', async () => {
		let list: RegisteredAdventure[] = [{ adventureId: 'adv-A', rootPath: A, name: A }];
		const reg = new AdventureRegistry(vault, () => list, async (l) => void (list = l));
		const changed = await reg.handleRename(A, 'Кампании/Приключение А (новое)');
		expect(changed[0]!.rootPath).toBe('Кампании/Приключение А (новое)');
		expect(reg.findForPath('Кампании/Приключение А (новое)/Холсты/01.canvas')!.adventureId).toBe('adv-A');
		await reg.handleRename('Кампании', 'Архив');
		expect(list[0]!.rootPath).toBe('Архив/Приключение А (новое)');
	});

	it('копия папки с тем же ID не регистрируется молча', async () => {
		let list: RegisteredAdventure[] = [{ adventureId: 'adv-A', rootPath: A, name: A }];
		const reg = new AdventureRegistry(vault, () => list, async (l) => void (list = l));
		vault.files.set(`Копия/${STATE_FILE}`, vault.files.get(`${A}/${STATE_FILE}`)!);
		await expect(reg.register({ adventureId: "adv-A", rootPath: "Копия", name: "Копия" })).rejects.toThrow(/тем же ID/);
	});
});

describe('AC-03 папки', () => {
	it('работа со state не создаёт новых папок', async () => {
		const before = [...vault.folders].sort();
		const a = await open(A);
		await a.dispatch({ type: 'party/create', party: { id: 'p2', name: 'Вторая', characterIds: [] } });
		expect([...vault.folders].sort()).toEqual(before);
	});
});
