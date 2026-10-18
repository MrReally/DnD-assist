// One sidecar JSON per adventure. All writes for one adventure go through a serial queue;
// a write succeeds only if the file still holds the revision we last saw (no silent last-write-wins).
import type { ActionPayload, Action } from '../domain/actions';
import { newActionId, newId } from '../domain/ids';
import { migrateState } from '../domain/migrations';
import { joinPath } from '../domain/normalize';
import { dispatch, type ReducerOptions } from '../domain/reducer';
import { createAdventureState, serializeState } from '../domain/state';
import type { AdventureState } from '../domain/types';
import { FileConflictError, type VaultPort } from '../adapters/vault-port';

export const STATE_FILE = '.canvas-assist-state.json';

export type StoreMode = 'ok' | 'recovery' | 'conflict';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface DispatchOutcome {
	ok: boolean;
	changed: boolean;
	duplicate: boolean;
	label: string;
	error?: string;
}

export interface StoreInfo {
	mode: StoreMode;
	status: SaveStatus;
	message: string | null;
	backupPath: string | null;
}

type Listener = (state: AdventureState) => void;

export interface StoreOptions {
	reducer: () => ReducerOptions;
	backupLimit: () => number;
	now?: () => Date;
}

function stamp(d: Date): string {
	return d.toISOString().replace(/[:.]/g, '-');
}

export class AdventureStore {
	state: AdventureState | null = null;
	info: StoreInfo = { mode: 'ok', status: 'idle', message: null, backupPath: null };
	private lastSavedRevision = -1;
	private queue: Promise<unknown> = Promise.resolve();
	private listeners = new Set<Listener>();
	private infoListeners = new Set<(info: StoreInfo) => void>();
	private conflictCandidate: AdventureState | null = null;

	constructor(
		private readonly port: VaultPort,
		public rootPath: string,
		private readonly opts: StoreOptions,
	) {}

	get statePath(): string {
		return joinPath(this.rootPath, STATE_FILE);
	}

	private now(): Date {
		return this.opts.now ? this.opts.now() : new Date();
	}

	subscribe(fn: Listener): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	onInfo(fn: (info: StoreInfo) => void): () => void {
		this.infoListeners.add(fn);
		return () => this.infoListeners.delete(fn);
	}

	private emit(): void {
		if (this.state) for (const l of this.listeners) l(this.state);
	}

	private setInfo(patch: Partial<StoreInfo>): void {
		this.info = { ...this.info, ...patch };
		for (const l of this.infoListeners) l(this.info);
	}

	get writable(): boolean {
		return this.info.mode === 'ok' && this.state !== null;
	}

	/** Creates a fresh state file. Refuses to overwrite an existing one. */
	async initialize(adventureId: string, name: string): Promise<void> {
		if (await this.port.exists(this.statePath)) throw new Error('Файл состояния уже существует');
		const state = createAdventureState(adventureId, newId('state'), this.rootPath, name);
		await this.port.write(this.statePath, serializeState(state));
		this.state = state;
		this.lastSavedRevision = state.revision;
		this.setInfo({ mode: 'ok', status: 'saved', message: null });
		this.emit();
	}

	/**
	 * Loads, validates and (with a backup first) migrates the state file.
	 * Corrupted or unknown-version files put the store into read-only recovery; the original stays untouched.
	 */
	async load(): Promise<void> {
		let text: string;
		try {
			text = await this.port.read(this.statePath);
		} catch (err) {
			this.state = null;
			this.setInfo({ mode: 'recovery', status: 'error', message: `Не удалось прочитать файл состояния: ${errText(err)}` });
			return;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (err) {
			const backup = await this.safeCopy('corrupt');
			this.state = null;
			this.setInfo({
				mode: 'recovery',
				status: 'error',
				backupPath: backup,
				message: `Файл состояния повреждён (некорректный JSON: ${errText(err)}). Работа в режиме только чтения. Оригинал не изменён${backup ? `, копия: ${backup}` : ''}.`,
			});
			return;
		}
		const result = migrateState(raw, () => newId('state'));
		if (!result.ok || !result.state) {
			const backup = await this.safeCopy('invalid');
			this.state = null;
			const details = result.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ');
			this.setInfo({
				mode: 'recovery',
				status: 'error',
				backupPath: backup,
				message: `${result.error ?? 'Ошибка состояния'}${details ? ` (${details})` : ''}. Режим только чтения, оригинал не изменён.`,
			});
			return;
		}
		const state = result.state;
		if (state.rootPath !== this.rootPath) state.rootPath = this.rootPath;
		if (result.migrated) {
			const backup = await this.safeCopy(`backup-v${result.fromVersion ?? 'x'}`);
			if (!backup) {
				this.state = null;
				this.setInfo({ mode: 'recovery', status: 'error', message: 'Не удалось создать резервную копию перед миграцией — миграция отменена.' });
				return;
			}
			try {
				await this.port.write(this.statePath, serializeState(state));
			} catch (err) {
				this.state = null;
				this.setInfo({ mode: 'recovery', status: 'error', backupPath: backup, message: `Миграция не записана: ${errText(err)}. Оригинал сохранён в ${backup}.` });
				return;
			}
			this.setInfo({ backupPath: backup, message: `Состояние обновлено до схемы v2. Резервная копия: ${backup}${result.warnings.length ? `. ${result.warnings.join(' ')}` : ''}` });
			await this.rotateBackups('backup-v');
		}
		this.state = state;
		this.lastSavedRevision = state.revision;
		this.setInfo({ mode: 'ok', status: 'saved' });
		this.emit();
	}

	/** Copies the current state file next to it with a labelled name. Returns the copy path or null. */
	private async safeCopy(label: string): Promise<string | null> {
		const target = joinPath(this.rootPath, `.canvas-assist-state.${label}-${stamp(this.now())}.json`);
		try {
			await this.port.copy(this.statePath, target);
			return target;
		} catch {
			return null;
		}
	}

	private async rotateBackups(prefix: string): Promise<void> {
		try {
			const { files } = await this.port.list(this.rootPath);
			const mine = files.filter((f) => (f.split('/').pop() ?? '').startsWith(`.canvas-assist-state.${prefix}`)).sort();
			const excess = mine.length - this.opts.backupLimit();
			for (let i = 0; i < excess; i++) await this.port.removeServiceFile(mine[i] as string);
		} catch {
			// Rotation is best effort; never blocks work.
		}
	}

	private buildAction(payload: ActionPayload, actionId?: string): Action {
		if (!this.state) throw new Error('Состояние не загружено');
		return { ...payload, actionId: actionId ?? newActionId(), adventureId: this.state.adventureId, at: this.now().toISOString() };
	}

	/** Applies an action and persists it. Resolves only after the write finished (or failed). */
	dispatch(payload: ActionPayload, actionId?: string): Promise<DispatchOutcome> {
		const run = async (): Promise<DispatchOutcome> => {
			if (!this.state) return { ok: false, changed: false, duplicate: false, label: payload.type, error: 'Состояние не загружено' };
			if (this.info.mode !== 'ok') {
				return { ok: false, changed: false, duplicate: false, label: payload.type, error: 'Запись остановлена: режим восстановления или конфликт версий' };
			}
			const action = this.buildAction(payload, actionId);
			const result = dispatch(this.state, action, this.opts.reducer());
			if (result.error) return { ok: false, changed: false, duplicate: false, label: result.label, error: result.error };
			if (result.duplicate) return { ok: true, changed: false, duplicate: true, label: result.label };
			const next = result.state;
			this.setInfo({ status: 'saving' });
			try {
				await this.persist(next);
			} catch (err) {
				if (err instanceof FileConflictError) {
					await this.enterConflict(next, err.message);
					return { ok: false, changed: false, duplicate: false, label: result.label, error: err.message };
				}
				// In-memory state is NOT advanced: the UI must never show an unsaved action as done.
				this.setInfo({ status: 'error', message: `Не сохранено: ${errText(err)}` });
				return { ok: false, changed: false, duplicate: false, label: result.label, error: `Не сохранено: ${errText(err)}` };
			}
			this.state = next;
			this.lastSavedRevision = next.revision;
			this.setInfo({ status: 'saved', message: null });
			this.emit();
			return { ok: true, changed: result.changed, duplicate: false, label: result.label };
		};
		const p = this.queue.then(run, run);
		this.queue = p.catch(() => undefined);
		return p;
	}

	private async persist(next: AdventureState): Promise<void> {
		const expectedRevision = this.lastSavedRevision;
		const expectedStateId = next.stateId;
		const exists = await this.port.exists(this.statePath);
		if (!exists) throw new FileConflictError('Файл состояния удалён или перемещён извне');
		await this.port.process(this.statePath, (current) => {
			let parsed: { stateId?: unknown; revision?: unknown };
			try {
				parsed = JSON.parse(current) as typeof parsed;
			} catch {
				throw new FileConflictError('Файл состояния изменён извне и не читается');
			}
			if (parsed.stateId !== expectedStateId || parsed.revision !== expectedRevision) {
				throw new FileConflictError(
					`Конфликт версий: файл изменён извне (ревизия ${String(parsed.revision)}, ожидалась ${expectedRevision})`,
				);
			}
			return serializeState(next);
		});
	}

	private async enterConflict(local: AdventureState, message: string): Promise<void> {
		this.conflictCandidate = local;
		const localPath = joinPath(this.rootPath, `.canvas-assist-state.conflict-local-${stamp(this.now())}.json`);
		let saved: string | null = null;
		try {
			await this.port.write(localPath, serializeState(local));
			saved = localPath;
		} catch {
			saved = null;
		}
		this.setInfo({
			mode: 'conflict',
			status: 'error',
			backupPath: saved,
			message: `${message}. Запись остановлена. Локальная версия сохранена${saved ? ` в ${saved}` : ' только в памяти'}. Выберите версию.`,
		});
	}

	/** Conflict resolution: adopt the external file (local copy stays on disk). */
	async resolveUseExternal(): Promise<void> {
		this.conflictCandidate = null;
		this.setInfo({ mode: 'ok', message: null });
		await this.load();
	}

	/** Conflict resolution: keep local; external file is backed up first. */
	async resolveUseLocal(): Promise<void> {
		const local = this.conflictCandidate ?? this.state;
		if (!local) return;
		if (await this.port.exists(this.statePath)) await this.safeCopy('conflict-external');
		const next = { ...local, revision: local.revision + 1 };
		await this.port.write(this.statePath, serializeState(next));
		this.conflictCandidate = null;
		this.state = next;
		this.lastSavedRevision = next.revision;
		this.setInfo({ mode: 'ok', status: 'saved', message: null });
		this.emit();
	}

	/** Recovery: start a fresh state; the broken original is kept as a labelled copy. */
	async resetFromRecovery(adventureId: string, name: string): Promise<string | null> {
		const copy = (await this.port.exists(this.statePath)) ? await this.safeCopy('replaced') : null;
		const state = createAdventureState(adventureId, newId('state'), this.rootPath, name);
		await this.port.write(this.statePath, serializeState(state));
		this.state = state;
		this.lastSavedRevision = state.revision;
		this.setInfo({ mode: 'ok', status: 'saved', message: null, backupPath: copy });
		this.emit();
		return copy;
	}

	/** Re-reads the file when it may have been changed externally (sync, other device). */
	async refreshFromDisk(): Promise<'unchanged' | 'reloaded' | 'conflict'> {
		if (this.info.mode !== 'ok' || !this.state) return 'unchanged';
		await this.queue;
		let text: string;
		try {
			text = await this.port.read(this.statePath);
		} catch {
			await this.enterConflict(this.state, 'Файл состояния недоступен');
			return 'conflict';
		}
		let parsed: { stateId?: unknown; revision?: unknown };
		try {
			parsed = JSON.parse(text) as typeof parsed;
		} catch {
			await this.load();
			return 'reloaded';
		}
		if (parsed.stateId === this.state.stateId && parsed.revision === this.lastSavedRevision) return 'unchanged';
		await this.load();
		return 'reloaded';
	}

	/** Waits until queued writes are done (used before switching adventures). */
	async flush(): Promise<void> {
		await this.queue;
	}
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
