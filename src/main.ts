import { Notice, Plugin, requestUrl, type WorkspaceLeaf } from 'obsidian';
import { Controller } from './controller';
import { isTypingTarget, matchesHotkey, parseHotkey } from './services/hotkeys';
import { mergeSettings, type CanvasAssistSettings, type HotkeyAction } from './settings';
import { nextTurn, openDamage, openEffect, openHeal, openTempHp, previousTurn, endEncounter } from './ui/actions';
import { CardModal } from './ui/card-modal';
import { ImportModal } from './ui/import-preview';
import { RecoveryModal, RegisterAdventureModal } from './ui/misc-modals';
import { CanvasOverlay } from './ui/overlay';
import { CanvasAssistPanel, PANEL_VIEW } from './ui/panel';
import { RestModal } from './ui/rest-modal';
import { CanvasAssistSettingTab } from './ui/settings-tab';

export default class CanvasAssistPlugin extends Plugin {
	cfg!: CanvasAssistSettings;
	ctl!: Controller;
	private overlays = new Map<WorkspaceLeaf, CanvasOverlay>();

	override async onload(): Promise<void> {
		this.cfg = mergeSettings(await this.loadData());
		this.ctl = new Controller({
			app: this.app,
			settings: this.cfg,
			saveSettings: () => this.saveSettings(),
			httpPost: async (url, body, timeoutMs) => {
				const req = requestUrl({ url, method: 'POST', body, contentType: 'application/json', throw: false });
				let timer = 0;
				const timeout = new Promise<never>((_, reject) => {
					timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
				});
				const res = await Promise.race([req, timeout]).finally(() => window.clearTimeout(timer));
				let json: unknown = null;
				try {
					json = res.json as unknown;
				} catch {
					json = null;
				}
				return { status: res.status, json };
			},
		});
		this.registerView(PANEL_VIEW, (leaf) => new CanvasAssistPanel(leaf, this.ctl));
		this.addSettingTab(new CanvasAssistSettingTab(this.app, this, this.ctl, () => this.saveSettings()));
		this.registerCommands();
		this.addRibbonIcon('swords', 'Canvas Assist', () => void this.openPanel());

		this.app.workspace.onLayoutReady(() => {
			this.syncOverlays();
			void this.ctl.handleActiveLeaf(this.app.workspace.getMostRecentLeaf());
			void this.ctl.loadOfflineReference();
			// Vault events are registered after layout-ready so initial indexing does not trigger them.
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.ctl.handleRename(file, oldPath)));
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (file.path === this.ctl.activeCanvas?.path) {
						this.ctl.canvasIndex.invalidate();
						this.ctl.emit('canvas');
					}
				}),
			);
			this.registerEvent(
				this.app.vault.on('delete', (file) => {
					if (file.path === this.ctl.activeCanvas?.path) this.ctl.activeCanvas = null;
					this.ctl.canvasIndex.invalidate();
					this.ctl.emit('canvas');
				}),
			);
		});
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				this.syncOverlays();
				void this.ctl.handleActiveLeaf(leaf);
			}),
		);
		this.registerEvent(this.app.workspace.on('layout-change', () => this.syncOverlays()));
		this.registerDomEvent(document, 'keydown', (ev) => this.onKeydown(ev), { capture: true });
		// Exposed for the automated E2E harness and power users (read-only helpers).
		(window as unknown as { canvasAssist?: unknown }).canvasAssist = { ctl: this.ctl, version: this.manifest.version };
	}

	override onunload(): void {
		for (const o of this.overlays.values()) o.destroy();
		this.overlays.clear();
		void this.ctl.shutdown();
		delete (window as unknown as { canvasAssist?: unknown }).canvasAssist;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.cfg);
	}

	/** One overlay per open Canvas leaf; removed when the leaf goes away. */
	private syncOverlays(): void {
		const leaves = new Set(this.app.workspace.getLeavesOfType('canvas'));
		for (const [leaf, o] of this.overlays) {
			if (!leaves.has(leaf) || !o.root.isConnected) {
				o.destroy();
				this.overlays.delete(leaf);
			}
		}
		for (const leaf of leaves) {
			if (!this.overlays.has(leaf)) this.overlays.set(leaf, new CanvasOverlay(this.ctl, leaf, { openPanel: () => void this.openPanel(), saveSettings: () => this.saveSettings() }));
		}
	}

	get overlayCount(): number {
		return this.overlays.size;
	}

	async openPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(PANEL_VIEW)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: PANEL_VIEW, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private activeOverlay(): CanvasOverlay | null {
		const leaf = this.ctl.activeCanvasLeaf;
		return leaf ? this.overlays.get(leaf) ?? null : null;
	}

	private inAdventureCanvas(): boolean {
		const leaf = this.app.workspace.getMostRecentLeaf();
		return !!leaf && leaf.view.getViewType() === 'canvas' && leaf === this.ctl.activeCanvasLeaf && !!this.ctl.state;
	}

	private runAction(action: HotkeyAction): boolean {
		const ctl = this.ctl;
		switch (action) {
			case 'search': {
				const o = this.activeOverlay();
				if (!o) return false;
				o.focusSearch();
				return true;
			}
			case 'damage':
				openDamage(ctl);
				return true;
			case 'heal':
				openHeal(ctl);
				return true;
			case 'effect':
				openEffect(ctl);
				return true;
			case 'card': {
				const t = ctl.target;
				if (!t) {
					new Notice('Canvas Assist: выберите цель');
					return true;
				}
				new CardModal(ctl, t).open();
				return true;
			}
			case 'next':
				if (!ctl.state?.activeEncounter) return false;
				void nextTurn(ctl);
				return true;
			case 'previous':
				if (!ctl.state?.activeEncounter) return false;
				void previousTurn(ctl);
				return true;
		}
	}

	/** Contextual hotkeys: only inside an adventure Canvas, never while typing; safe no-op otherwise. */
	private onKeydown(ev: KeyboardEvent): void {
		if (!this.cfg.contextualHotkeys || ev.repeat) return;
		if (isTypingTarget(ev.target, document.activeElement) || document.querySelector('.modal-container')) return;
		if (!this.inAdventureCanvas()) return;
		for (const [action, text] of Object.entries(this.cfg.hotkeys) as Array<[HotkeyAction, string]>) {
			const hk = text ? parseHotkey(text) : null;
			if (!hk || !matchesHotkey(ev, hk)) continue;
			if (this.runAction(action)) {
				ev.preventDefault();
				ev.stopPropagation();
			}
			return;
		}
	}

	private registerCommands(): void {
		const needState = (fn: () => void) => (checking: boolean): boolean => {
			if (!this.ctl.state) return false;
			if (!checking) fn();
			return true;
		};
		this.addCommand({
			id: 'use-canvas-as-adventure',
			name: 'Использовать текущий Canvas как приключение',
			checkCallback: (checking) => {
				const file = this.ctl.activeCanvas;
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!file || leaf?.view.getViewType() !== 'canvas') return false;
				if (!checking) void this.ctl.registry.candidatesFor(file.path).then((c) => new RegisterAdventureModal(this.ctl, c).open());
				return true;
			},
		});
		this.addCommand({ id: 'open-panel', name: 'Открыть панель', callback: () => void this.openPanel() });
		this.addCommand({ id: 'search-canvas', name: 'Поиск по текущему Canvas', checkCallback: (c) => {
			const o = this.activeOverlay();
			if (!o) return false;
			if (!c) o.focusSearch();
			return true;
		} });
		this.addCommand({ id: 'damage-target', name: 'Урон выбранной цели', checkCallback: needState(() => openDamage(this.ctl)) });
		this.addCommand({ id: 'heal-target', name: 'Лечение выбранной цели', checkCallback: needState(() => openHeal(this.ctl)) });
		this.addCommand({ id: 'temp-hp-target', name: 'Временные хиты выбранной цели', checkCallback: needState(() => openTempHp(this.ctl)) });
		this.addCommand({ id: 'effect-target', name: 'Эффект на выбранную цель', checkCallback: needState(() => openEffect(this.ctl)) });
		this.addCommand({ id: 'card-target', name: 'Карточка выбранной цели', checkCallback: needState(() => this.runAction('card')) });
		this.addCommand({ id: 'next-turn', name: 'Следующий ход', checkCallback: (c) => {
			if (!this.ctl.state?.activeEncounter) return false;
			if (!c) void nextTurn(this.ctl);
			return true;
		} });
		this.addCommand({ id: 'previous-turn', name: 'Предыдущий ход', checkCallback: (c) => {
			if (!this.ctl.state?.activeEncounter) return false;
			if (!c) void previousTurn(this.ctl);
			return true;
		} });
		this.addCommand({ id: 'end-encounter', name: 'Завершить бой', checkCallback: (c) => {
			if (!this.ctl.state?.activeEncounter) return false;
			if (!c) void endEncounter(this.ctl);
			return true;
		} });
		this.addCommand({ id: 'undo', name: 'Отменить игровое действие', checkCallback: needState(() => void this.ctl.undo()) });
		this.addCommand({ id: 'redo', name: 'Повторить игровое действие', checkCallback: needState(() => void this.ctl.redo()) });
		this.addCommand({ id: 'import-json', name: 'Импорт персонажей из JSON', checkCallback: needState(() => new ImportModal(this.ctl).open()) });
		this.addCommand({ id: 'long-rest', name: 'Долгий отдых', checkCallback: needState(() => new RestModal(this.ctl, 'long').open()) });
		this.addCommand({ id: 'short-rest', name: 'Короткий отдых', checkCallback: needState(() => new RestModal(this.ctl, 'short').open()) });
		this.addCommand({ id: 'recovery', name: 'Состояние хранения / восстановление', checkCallback: (c) => {
			if (!this.ctl.store) return false;
			if (!c) new RecoveryModal(this.ctl).open();
			return true;
		} });
	}
}
