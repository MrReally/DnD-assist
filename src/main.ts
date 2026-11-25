import { Notice, Plugin, requestUrl, type EventRef, type Menu, type WorkspaceLeaf } from 'obsidian';
import { cardTargetForNote, creatureForNote } from './domain/card';
import { relativeTo } from './domain/normalize';
import { isRoomNote } from './domain/room';
import { CheckpointModal, goBackToPreviousArea, goToViewPoint, ViewPointsModal } from './ui/cockpit/canvas-modals';
import { GoToModal } from './ui/cockpit/goto-modal';
import { BuilderModal, QuickNpcModal, SpellImportModal } from './ui/cockpit/modals';
import { watchCanvas } from './adapters/canvas-adapter';
import { DgramTransport, sendCue } from './adapters/osc-transport';
import { Controller } from './controller';
import type { SendResult } from './domain/lightkey';
import { isTypingTarget, matchesHotkey, parseHotkey } from './services/hotkeys';
import { mergeSettings, type CanvasAssistSettings, type HotkeyAction } from './settings';
import { nextTurn, openDamage, openEffect, openHeal, openTempHp, previousTurn, endEncounter } from './ui/actions';
import { CardModal } from './ui/card-modal';
import { ImportModal } from './ui/import-preview';
import { RecoveryModal, RegisterAdventureModal } from './ui/misc-modals';
import { CanvasOverlay } from './ui/overlay';
import { COCKPIT_VIEW, GmCockpitPanel } from './ui/gm-panel';
import { CanvasAssistPanel, PANEL_VIEW } from './ui/panel';
import { RestModal } from './ui/rest-modal';
import { CanvasAssistSettingTab } from './ui/settings-tab';

export default class CanvasAssistPlugin extends Plugin {
	cfg!: CanvasAssistSettings;
	ctl!: Controller;
	private overlays = new Map<WorkspaceLeaf, CanvasOverlay>();
	private canvasWatch = new Map<WorkspaceLeaf, { view: unknown; stop: () => void }>();

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
		this.ctl.showPanel = () => void this.openCockpit();
		this.registerView(COCKPIT_VIEW, (leaf) => new GmCockpitPanel(leaf, this.ctl));
		this.addSettingTab(new CanvasAssistSettingTab(this.app, this, this.ctl, () => this.saveSettings(), () => this.testLightkey()));
		this.registerCommands();
		this.addRibbonIcon('swords', 'Canvas Assist', () => void this.openPanel());
		this.addRibbonIcon('scroll-text', 'GM Cockpit', () => void this.openCockpit());
		this.registerEvent(
			// Canvas node context menu: not in the public typings, so the event name is cast. Absent event → no menu item.
			(this.app.workspace as unknown as { on: (n: string, cb: (menu: Menu, node: { file?: { path?: string } }) => void) => EventRef }).on('canvas:node-menu', (menu, node) => {
				const path = node?.file?.path;
				if (!path || !this.ctl.state || !this.hasCard(path)) return;
				menu.addItem((i) => i.setTitle('Открыть в GM Cockpit').setIcon('scroll-text').onClick(() => void this.openCockpitFor(path)));
			}),
		);

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
		(window as unknown as { canvasAssist?: unknown }).canvasAssist = { ctl: this.ctl, version: this.manifest.version, testLightkey: () => this.testLightkey() };
	}

	override onunload(): void {
		for (const o of this.overlays.values()) o.destroy();
		this.overlays.clear();
		for (const w of this.canvasWatch.values()) w.stop();
		this.canvasWatch.clear();
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
		for (const [leaf, w] of this.canvasWatch) {
			if (!leaves.has(leaf) || leaf.view !== w.view) {
				w.stop();
				this.canvasWatch.delete(leaf);
			}
		}
		for (const leaf of leaves) {
			if (!this.canvasWatch.has(leaf)) {
				const view = leaf.view;
				const stop = watchCanvas(view, {
					onSelection: (paths) => {
						this.ctl.canvasSelection = paths;
					},
					onDoubleClick: (path) => {
						if (!this.cfg.cockpitDoubleClick || !this.ctl.state || !this.hasCard(path)) return false;
						void this.openCockpitFor(path);
						return true;
					},
				});
				this.canvasWatch.set(leaf, { view, stop });
			}
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

	/** True when a Canvas file node maps to a card (character, creature, room note). */
	private hasCard(path: string): boolean {
		const st = this.ctl.state;
		if (!st) return false;
		if (cardTargetForNote(st, path) || creatureForNote(st, path)) return true;
		const rel = relativeTo(st.rootPath, path);
		return !!rel && isRoomNote(rel);
	}

	/** Opens (or reveals) the GM Cockpit panel in the right sidebar. */
	async openCockpit(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(COCKPIT_VIEW)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: COCKPIT_VIEW, active: true });
		await this.app.workspace.revealLeaf(leaf);
		// SPEC §1: the GM Panel is 340/380/420 px by screen size. Obsidian's default sidebar is 300 px; the user may resize it afterwards.
		window.setTimeout(() => {
			const split = this.app.workspace.rightSplit as unknown as { setSize?: (n: number) => void; size?: number; containerEl?: HTMLElement };
			const w = split.containerEl?.getBoundingClientRect().width ?? 0;
			const target = window.innerWidth >= 1800 ? 420 : window.innerWidth >= 1400 ? 380 : 340;
			if (w < target) {
				if (typeof split.setSize === 'function') split.setSize(target);
				else split.size = target;
			}
		}, 150);
	}

	/** Test send of the configured cue. Reports the outcome; never claims the light changed. */
	async testLightkey(): Promise<SendResult> {
		const lk = this.cfg.lightkey;
		const res = await sendCue(new DgramTransport(), { host: lk.host, port: lk.port }, { id: 'test', cardId: 'test', address: lk.testAddress, command: lk.testCommand, args: [], autoStart: false });
		new Notice(res.status === 'sent' ? `Lightkey: отправлено на ${res.target} (${res.address}). Выполнение не подтверждается.` : `Lightkey: ошибка — ${res.detail}`, 8000);
		return res;
	}

	async openCockpitFor(vaultPath: string): Promise<boolean> {
		if (!this.ctl.openCardForPath(vaultPath)) return false;
		await this.openCockpit();
		return true;
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
		this.addCommand({ id: 'cockpit-open', name: 'GM Cockpit: открыть панель', callback: () => void this.openCockpit() });
		this.addCommand({
			id: 'cockpit-open-selected',
			name: 'Открыть выбранный объект в GM Cockpit',
			checkCallback: (checking) => {
				if (!this.ctl.state || !this.inAdventureCanvas()) return false;
				const path = this.ctl.canvasSelection.find((p) => this.hasCard(p));
				if (!path) return false;
				if (!checking) void this.openCockpitFor(path);
				return true;
			},
		});
		this.addCommand({ id: 'lightkey-test', name: 'Lightkey: тестовая отправка', callback: () => void this.testLightkey() });
		const needCockpit = (fn: () => void) => (checking: boolean): boolean => {
			if (!this.ctl.state) return false;
			if (!checking) fn();
			return true;
		};
		this.addCommand({ id: 'cockpit-quick-npc', name: 'Быстрый NPC', checkCallback: needCockpit(() => new QuickNpcModal(this.ctl, (id) => { this.ctl.setCard({ kind: 'creature', id }); void this.openCockpit(); }).open()) });
		this.addCommand({ id: 'cockpit-new-character', name: 'Новый персонаж (конструктор)', checkCallback: needCockpit(() => new BuilderModal(this.ctl, (id) => { this.ctl.setTarget({ kind: 'character', id }); void this.openCockpit(); }).open()) });
		this.addCommand({ id: 'cockpit-spell-import', name: 'Заклинание: библиотека и импорт', checkCallback: needCockpit(() => new SpellImportModal(this.ctl, this.ctl.target?.kind === 'character' ? this.ctl.target.id : null, () => undefined).open()) });
		this.addCommand({ id: 'cockpit-goto', name: 'Перейти (Canvas и справочник)', checkCallback: needCockpit(() => new GoToModal(this.ctl).open()) });
		this.addCommand({ id: 'cockpit-checkpoints', name: 'Контрольные точки Canvas', checkCallback: needCockpit(() => new CheckpointModal(this.ctl).open()) });
		this.addCommand({ id: 'cockpit-viewpoints', name: 'Точки обзора Canvas', checkCallback: needCockpit(() => new ViewPointsModal(this.ctl).open()) });
		this.addCommand({ id: 'cockpit-viewpoint-back', name: 'Вернуться в предыдущую область Canvas', checkCallback: needCockpit(() => void goBackToPreviousArea(this.ctl)) });
		for (let i = 1; i <= 9; i++) this.addCommand({ id: `cockpit-viewpoint-${i}`, name: `Точка обзора ${i}: перейти`, checkCallback: needCockpit(() => void goToViewPoint(this.ctl, String(i))) });
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
