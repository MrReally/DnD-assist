// Glue between Obsidian events, adventure stores and UI. Holds no game rules.
import { FileView, Notice, TFile, TFolder, type App, type TAbstractFile, type View, type WorkspaceLeaf } from 'obsidian';
import { ObsidianVaultPort } from './adapters/obsidian-vault';
import { OfflineReference } from './adapters/offline-reference';
import { TtgLinkProvider, TtgOnlineSearch } from './adapters/ttg-adapter';
import type { ActionPayload } from './domain/actions';
import { cardTargetForNote, creatureForNote, type CardRef } from './domain/card';
import { isRoomNote } from './domain/room';
import { newId } from './domain/ids';
import { relativeTo } from './domain/normalize';
import type { ReducerOptions } from './domain/reducer';
import type { AdventureState, EffectTarget } from './domain/types';
import { AdventureRegistry } from './services/adventure-registry';
import { CanvasIndexService, type CanvasIndex } from './services/canvas-index';
import { PC_FOLDER, revertImportFiles } from './services/import-service';
import { NavigationHistory } from './services/navigation';
import { AdventureStore, STATE_FILE, type DispatchOutcome } from './services/persistence';
import type { CanvasAssistSettings, RegisteredAdventure } from './settings';

export interface PluginHost {
	app: App;
	settings: CanvasAssistSettings;
	saveSettings(): Promise<void>;
	httpPost(url: string, body: string, timeoutMs: number): Promise<{ status: number; json: unknown }>;
}

export type ChangeReason = 'state' | 'context' | 'selection' | 'info' | 'canvas';

export class Controller {
	readonly port: ObsidianVaultPort;
	readonly registry: AdventureRegistry;
	readonly canvasIndex: CanvasIndexService;
	readonly nav = new NavigationHistory(8);
	readonly ttgLinks = new TtgLinkProvider();
	readonly ttgOnline: TtgOnlineSearch;
	readonly offline = new OfflineReference();
	private stores = new Map<string, AdventureStore>();
	private unsub = new Map<string, Array<() => void>>();
	private listeners = new Set<(reason: ChangeReason) => void>();
	activeAdventureId: string | null = null;
	activeCanvas: TFile | null = null;
	activeCanvasLeaf: WorkspaceLeaf | null = null;
	/** Detected but unregistered adventure root for the current Canvas (hint for the bar). */
	unregisteredHint: string | null = null;
	/** Index of the active Canvas (rebuilt lazily, only for the active Canvas). */
	lastIndex: CanvasIndex | null = null;
	/** Selected target is UI state and deliberately separate from the active turn. */
	private selection = new Map<string, EffectTarget | null>();
	private switching: Promise<void> = Promise.resolve();

	constructor(private readonly host: PluginHost) {
		this.port = new ObsidianVaultPort(host.app);
		this.registry = new AdventureRegistry(
			this.port,
			() => host.settings.adventures,
			async (list) => {
				host.settings.adventures = list;
				await host.saveSettings();
			},
		);
		this.canvasIndex = new CanvasIndexService(host.app);
		this.ttgOnline = new TtgOnlineSearch(host.httpPost.bind(host), () => host.settings.ttgOnlineSearch);
	}

	get app(): App {
		return this.host.app;
	}

	get settings(): CanvasAssistSettings {
		return this.host.settings;
	}

	onChange(fn: (reason: ChangeReason) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	emit(reason: ChangeReason): void {
		for (const l of [...this.listeners]) {
			try {
				l(reason);
			} catch (err) {
				console.error('[Canvas Assist] UI listener failed', err);
			}
		}
	}

	reducerOptions(): ReducerOptions {
		return {
			skipDefeated: this.settings.skipDefeated,
			history: { maxEntries: this.settings.historyMaxEntries, maxBytes: this.settings.historyMaxKiB * 1024 },
		};
	}

	get store(): AdventureStore | null {
		return this.activeAdventureId ? this.stores.get(this.activeAdventureId) ?? null : null;
	}

	get state(): AdventureState | null {
		return this.store?.state ?? null;
	}

	get adventure(): RegisteredAdventure | null {
		return this.activeAdventureId ? this.registry.byId(this.activeAdventureId) : null;
	}

	get target(): EffectTarget | null {
		const id = this.activeAdventureId;
		if (!id) return null;
		const t = this.selection.get(id) ?? null;
		if (!t || !this.state) return null;
		if (t.kind === 'character' && !this.state.characters[t.id]) return null;
		if (t.kind === 'combatant' && !this.state.activeEncounter?.combatants[t.id]) return null;
		return t;
	}

	setTarget(t: EffectTarget | null): void {
		if (!this.activeAdventureId) return;
		this.cardOverride.delete(this.activeAdventureId);
		this.selection.set(this.activeAdventureId, t);
		this.emit('selection');
	}

	/** Set by the plugin: reveals the GM Cockpit panel. */
	showPanel: () => void = () => undefined;

	/** Canvas selection mirrored by the Canvas binding (UI state only; never persisted). */
	canvasSelection: string[] = [];

	/** Opens the game card behind a vault path (a Canvas file node). Returns false if there is none. */
	openCardForPath(vaultPath: string): boolean {
		const st = this.state;
		if (!st) return false;
		const t = cardTargetForNote(st, vaultPath);
		if (t) {
			this.setTarget(t);
			return true;
		}
		const cr = creatureForNote(st, vaultPath);
		if (cr) {
			this.setCard({ kind: 'creature', id: cr });
			return true;
		}
		const rel = relativeTo(st.rootPath, vaultPath);
		if (rel && isRoomNote(rel)) {
			this.setCard({ kind: 'room', id: vaultPath });
			return true;
		}
		return false;
	}

	/** Card shown in the GM Panel (UI state). Follows the target unless a bare creature card is opened. */
	private cardOverride = new Map<string, CardRef | null>();

	get cardRef(): CardRef | null {
		const id = this.activeAdventureId;
		if (!id || !this.state) return null;
		const o = this.cardOverride.get(id);
		if (o?.kind === 'creature') return this.state.creatures[o.id] ? o : this.target;
		if (o?.kind === 'room') return o;
		return this.target;
	}

	setCard(r: CardRef | null): void {
		if (!this.activeAdventureId) return;
		if (r && r.kind !== 'creature' && r.kind !== 'room') {
			this.cardOverride.delete(this.activeAdventureId);
			this.setTarget(r);
			return;
		}
		this.cardOverride.set(this.activeAdventureId, r);
		this.emit('selection');
	}

	async saveSettings(): Promise<void> {
		await this.host.saveSettings();
	}

	targetName(t: EffectTarget | null = this.target): string {
		const s = this.state;
		if (!t || !s) return '—';
		if (t.kind === 'character') return s.characters[t.id]?.name ?? '—';
		return s.activeEncounter?.combatants[t.id]?.displayName ?? '—';
	}

	private async getStore(entry: RegisteredAdventure): Promise<AdventureStore> {
		let store = this.stores.get(entry.adventureId);
		if (store) {
			store.rootPath = entry.rootPath;
			await store.refreshFromDisk();
			return store;
		}
		store = new AdventureStore(this.port, entry.rootPath, {
			reducer: () => this.reducerOptions(),
			backupLimit: () => this.settings.backupLimit,
		});
		this.stores.set(entry.adventureId, store);
		this.unsub.set(entry.adventureId, [store.subscribe(() => this.emit('state')), store.onInfo(() => this.emit('info'))]);
		await store.load();
		if (store.info.message && store.info.mode === 'ok') new Notice(`Canvas Assist: ${store.info.message}`, 10000);
		if (store.state && store.state.adventureId !== entry.adventureId) {
			store.info = { ...store.info, mode: 'recovery', message: `ID в файле (${store.state.adventureId}) не совпадает с зарегистрированным (${entry.adventureId}). Запись остановлена.` };
		}
		return store;
	}

	/** Context switch on every active-leaf change. Pending writes are flushed first. */
	handleActiveLeaf(leaf: WorkspaceLeaf | null): Promise<void> {
		this.switching = this.switching.then(() => this.doHandleActiveLeaf(leaf)).catch((err) => console.error('[Canvas Assist]', err));
		return this.switching;
	}

	private async doHandleActiveLeaf(leaf: WorkspaceLeaf | null): Promise<void> {
		const view = leaf?.view;
		if (!view || view.getViewType() !== 'canvas' || !(view instanceof FileView) || !view.file) {
			// Non-canvas views keep the last adventure context (explicitly shown in the panel).
			return;
		}
		const file = view.file;
		this.activeCanvasLeaf = leaf;
		const canvasChanged = this.activeCanvas?.path !== file.path;
		this.activeCanvas = file;
		let entry = this.registry.findForPath(file.path);
		this.unregisteredHint = null;
		if (!entry) entry = await this.tryRelink(file.path);
		if (!entry) {
			if (this.store) await this.store.flush();
			this.activeAdventureId = null;
			const cands = await this.registry.candidatesFor(file.path);
			this.unregisteredHint = cands[0] && cands[0].score >= 10 ? cands[0].path : null;
			this.emit('context');
			return;
		}
		if (this.activeAdventureId !== entry.adventureId) {
			if (this.store) await this.store.flush();
			this.activeAdventureId = entry.adventureId;
			await this.getStore(entry);
		} else {
			await this.store?.refreshFromDisk();
		}
		if (canvasChanged) this.canvasIndex.invalidate();
		this.emit('context');
	}

	/** Root renamed while Obsidian was closed: an ancestor holds a state file with a registered ID. */
	private async tryRelink(canvasPath: string): Promise<RegisteredAdventure | null> {
		const parts = canvasPath.split('/');
		for (let i = parts.length - 1; i >= 1; i--) {
			const root = parts.slice(0, i).join('/');
			const statePath = `${root}/${STATE_FILE}`;
			if (!(await this.port.exists(statePath))) continue;
			try {
				const raw = JSON.parse(await this.port.read(statePath)) as { adventureId?: unknown };
				const id = typeof raw.adventureId === 'string' ? raw.adventureId : null;
				const known = id ? this.registry.byId(id) : null;
				if (known && known.rootPath !== root && !(await this.port.exists(`${known.rootPath}/${STATE_FILE}`))) {
					await this.registry.relink(known.adventureId, root);
					new Notice(`Canvas Assist: приключение «${known.name}» найдено в новой папке «${root}» и переподключено.`);
					return this.registry.byId(known.adventureId);
				}
			} catch {
				// unreadable state files are reported when the adventure is opened
			}
			return null;
		}
		return null;
	}

	/** Registers a root (explicit command) and creates its sidecar only if absent. */
	async registerAdventure(rootPath: string, name: string, opts: { fork?: boolean } = {}): Promise<void> {
		const statePath = `${rootPath}/${STATE_FILE}`;
		let adventureId: string;
		if (await this.port.exists(statePath)) {
			let parsed: Record<string, unknown> = {};
			try {
				parsed = JSON.parse(await this.port.read(statePath)) as Record<string, unknown>;
			} catch {
				parsed = {};
			}
			adventureId = typeof parsed.adventureId === 'string' && parsed.adventureId ? parsed.adventureId : newId('adv');
			if (opts.fork) {
				// Copied folder: keep its data, give it its own identity. The file is backed up first.
				const stamp = new Date().toISOString().replace(/[:.]/g, '-');
				await this.port.copy(statePath, `${rootPath}/.canvas-assist-state.before-fork-${stamp}.json`);
				adventureId = newId('adv');
				const forked = { ...parsed, adventureId, rootPath, name, ...(typeof parsed.stateId === 'string' ? { stateId: newId('state') } : {}) };
				await this.port.write(statePath, `${JSON.stringify(forked)}\n`);
			}
			await this.registry.register({ adventureId, rootPath, name });
		} else {
			adventureId = newId('adv');
			await this.registry.register({ adventureId, rootPath, name });
			const store = new AdventureStore(this.port, rootPath, { reducer: () => this.reducerOptions(), backupLimit: () => this.settings.backupLimit });
			await store.initialize(adventureId, name);
		}
		this.stores.delete(adventureId);
		await this.handleActiveLeaf(this.activeCanvasLeaf);
	}

	async unregisterActive(): Promise<void> {
		const id = this.activeAdventureId;
		if (!id) return;
		await this.store?.flush();
		this.dropStore(id);
		await this.registry.unregister(id);
		this.activeAdventureId = null;
		this.emit('context');
	}

	private dropStore(id: string): void {
		for (const u of this.unsub.get(id) ?? []) u();
		this.unsub.delete(id);
		this.stores.delete(id);
	}

	/** Every UI mutation goes through here. Errors are surfaced; success only after the write. */
	async act(payload: ActionPayload, opts: { quiet?: boolean } = {}): Promise<DispatchOutcome> {
		const store = this.store;
		if (!store) {
			const out = { ok: false, changed: false, duplicate: false, label: payload.type, error: 'Нет активного приключения' };
			if (!opts.quiet) new Notice('Canvas Assist: откройте Canvas зарегистрированного приключения');
			return out;
		}
		const out = await store.dispatch(payload);
		if (!out.ok && out.error && !opts.quiet) new Notice(`Canvas Assist: ${out.error}`, 6000);
		return out;
	}

	async undo(): Promise<void> {
		const entry = this.state?.history.undo.at(-1);
		const out = await this.act({ type: 'history/undo' });
		if (out.ok) {
			new Notice(out.label, 2500);
			if (entry?.files?.length && this.state) {
				// Defence in depth: history comes from a file on disk; only touch this adventure's PC folder.
				const prefix = `${this.state.rootPath}/${PC_FOLDER}/`;
				const files = entry.files.filter((f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).split('/').includes('..'));
				const notes = await revertImportFiles(this.port, files);
				if (notes.length) new Notice(`Canvas Assist: ${notes.join('\n')}`, 10000);
			}
		}
	}

	async redo(): Promise<void> {
		const entry = this.state?.history.redo.at(-1);
		if (entry?.files?.length) {
			new Notice('Повтор импорта меняет только состояние; заметки не перезаписываются. Повторите импорт JSON при необходимости.', 8000);
		}
		const out = await this.act({ type: 'history/redo' });
		if (out.ok) new Notice(out.label, 2500);
	}

	activeCanvasView(): View | null {
		const v = this.activeCanvasLeaf?.view;
		return v && v.getViewType() === 'canvas' ? v : null;
	}

	canvasRelPath(): string | null {
		if (!this.activeCanvas || !this.state) return null;
		return relativeTo(this.state.rootPath, this.activeCanvas.path);
	}

	/** Vault rename: registered roots, character note paths, navigation history. */
	async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (file instanceof TFolder) {
			const changed = await this.registry.handleRename(oldPath, file.path);
			for (const a of changed) {
				const store = this.stores.get(a.adventureId);
				if (store) {
					store.rootPath = a.rootPath;
					if (store.state) store.state.rootPath = a.rootPath;
				}
			}
			if (changed.length) this.emit('context');
			return;
		}
		this.nav.renamePath(oldPath, file.path);
		if (this.activeCanvas && file.path === this.activeCanvas.path) this.canvasIndex.invalidate();
		const state = this.state;
		if (!state || !(file instanceof TFile)) return;
		const oldRel = relativeTo(state.rootPath, oldPath);
		if (!oldRel) return;
		const ch = Object.values(state.characters).find((c) => c.notePath === oldRel);
		if (!ch) return;
		const newRel = relativeTo(state.rootPath, file.path);
		if (newRel) {
			await this.act({ type: 'character/upsert', character: { ...ch, notePath: newRel } }, { quiet: true });
		} else {
			new Notice(`Canvas Assist: лист «${ch.name}» перемещён за пределы приключения — источник помечен как недоступный.`);
		}
	}

	noteFile(relPath: string | null | undefined): TFile | null {
		if (!relPath || !this.state) return null;
		const f = this.app.vault.getAbstractFileByPath(`${this.state.rootPath}/${relPath}`);
		return f instanceof TFile ? f : null;
	}

	async refreshIndex(): Promise<CanvasIndex | null> {
		const file = this.activeCanvas;
		if (!file) {
			this.lastIndex = null;
			return null;
		}
		const rel = this.canvasRelPath();
		const overrides = (rel && this.state?.nodeOverrides[rel]) || {};
		try {
			this.lastIndex = await this.canvasIndex.build(file, overrides, this.settings.foldYo);
		} catch (err) {
			console.error('[Canvas Assist] canvas index failed', err);
			this.lastIndex = { path: file.path, items: [], missingFiles: new Set(), warnings: ['Не удалось прочитать Canvas'] };
		}
		return this.lastIndex;
	}

	async loadOfflineReference(): Promise<void> {
		const p = this.settings.offlineReferencePath.trim();
		if (!p) {
			this.offline.load(null);
			return;
		}
		const f = this.app.vault.getAbstractFileByPath(p);
		if (!(f instanceof TFile)) {
			this.offline.load(null);
			this.offline.error = `Файл справочника не найден: ${p}`;
			return;
		}
		this.offline.load(await this.app.vault.cachedRead(f));
	}

	async shutdown(): Promise<void> {
		for (const s of this.stores.values()) await s.flush();
		for (const id of [...this.stores.keys()]) this.dropStore(id);
		this.listeners.clear();
	}
}
