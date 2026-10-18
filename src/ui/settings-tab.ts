import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { statblocksStatus } from '../adapters/statblock-adapter';
import type { Controller } from '../controller';
import { findConflicts } from '../services/hotkeys';
import { HOTKEY_LABELS, type HotkeyAction } from '../settings';

export class CanvasAssistSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly ctl: Controller,
		private readonly save: () => Promise<void>,
	) {
		super(app, plugin);
	}

	override display(): void {
		const el = this.containerEl;
		el.empty();
		const st = this.ctl.settings;

		new Setting(el).setName('Приключения').setHeading();
		if (!st.adventures.length) el.createEl('p', { cls: 'ca-muted', text: 'Нет подключённых приключений. Откройте Canvas и выполните «Canvas Assist: использовать текущий Canvas как приключение».' });
		for (const a of st.adventures) {
			new Setting(el).setName(a.name).setDesc(`${a.rootPath} · ${a.adventureId}`).addExtraButton((b) =>
				b.setIcon('unlink').setTooltip('Отключить (файлы не удаляются)').onClick(async () => {
					await this.ctl.registry.unregister(a.adventureId);
					this.display();
				}),
			);
		}

		new Setting(el).setName('Поиск').setHeading();
		new Setting(el).setName('Не различать «ё» и «е»').addToggle((t) =>
			t.setValue(st.foldYo).onChange(async (v) => {
				st.foldYo = v;
				this.ctl.canvasIndex.invalidate();
				await this.save();
				this.ctl.emit('canvas');
			}),
		);

		new Setting(el).setName('Бой').setHeading();
		new Setting(el).setName('Временные хиты поглощают урон первыми').addToggle((t) => t.setValue(st.temporaryHpAbsorbs).onChange(async (v) => {
			st.temporaryHpAbsorbs = v;
			await this.save();
		}));
		new Setting(el).setName('Пропускать выбывших при смене хода').addToggle((t) => t.setValue(st.skipDefeated).onChange(async (v) => {
			st.skipDefeated = v;
			await this.save();
		}));
		new Setting(el).setName('Профиль отдыха по умолчанию').addDropdown((d) => d.addOption('2014', 'D&D 2014').addOption('manual', 'Вручную').setValue(st.restProfile).onChange(async (v) => {
			st.restProfile = v === 'manual' ? 'manual' : '2014';
			await this.save();
		}));

		new Setting(el).setName('Горячие клавиши в Canvas').setHeading();
		el.createEl('p', {
			cls: 'ca-muted',
			text: 'Работают только в Canvas подключённого приключения и не срабатывают при вводе текста. Пробел не используется (панорамирование Canvas). Формат: Shift+F, Shift+Alt+Space, Ctrl+K. Пусто — отключить. Команды также доступны в «Горячих клавишах» Obsidian.',
		});
		new Setting(el).setName('Контекстные горячие клавиши').addToggle((t) => t.setValue(st.contextualHotkeys).onChange(async (v) => {
			st.contextualHotkeys = v;
			await this.save();
		}));
		const conflictsEl = el.createDiv({ cls: 'ca-warn' });
		const showConflicts = (): void => {
			const c = findConflicts(st.hotkeys);
			conflictsEl.setText(c.length ? `Конфликты: ${c.join('; ')}` : '');
		};
		for (const [action, label] of Object.entries(HOTKEY_LABELS) as Array<[HotkeyAction, string]>) {
			new Setting(el).setName(label).addText((t) => t.setValue(st.hotkeys[action]).onChange(async (v) => {
				st.hotkeys[action] = v.trim();
				showConflicts();
				await this.save();
			}));
		}
		showConflicts();

		new Setting(el).setName('Справочники').setHeading();
		new Setting(el)
			.setName('Онлайн-поиск TTG (экспериментально)')
			.setDesc('Выключено по умолчанию. Запрос к 5e14.ttg.club только при явном поиске в панели; используется недокументированный endpoint сайта, возвращаются лишь названия и ссылки. Без сети всё остальное работает.')
			.addToggle((t) => t.setValue(st.ttgOnlineSearch).onChange(async (v) => {
				st.ttgOnlineSearch = v;
				await this.save();
			}));
		new Setting(el)
			.setName('Локальный JSON-справочник')
			.setDesc('Путь к вашему JSON внутри хранилища: { "creatures": [ { "name", "ac", "hpMax", "initiativeModifier", "speed", "notes", "sourceUrl" } ] }')
			.addText((t) => t.setPlaceholder('Справочник/существа.json').setValue(st.offlineReferencePath).onChange(async (v) => {
				st.offlineReferencePath = v.trim();
				await this.save();
				await this.ctl.loadOfflineReference();
			}));
		new Setting(el)
			.setName('Fantasy Statblocks (необязательно)')
			.setDesc(`Состояние: ${statblocksStatus(this.app, st.fantasyStatblocks)}`)
			.addToggle((t) => t.setValue(st.fantasyStatblocks).onChange(async (v) => {
				st.fantasyStatblocks = v;
				await this.save();
				this.display();
			}));

		new Setting(el).setName('Хранение').setHeading();
		new Setting(el).setName('История: максимум действий').addText((t) => t.setValue(String(st.historyMaxEntries)).onChange(async (v) => {
			const n = Number(v);
			if (Number.isInteger(n) && n >= 10 && n <= 1000) {
				st.historyMaxEntries = n;
				await this.save();
			}
		}));
		new Setting(el).setName('История: максимум КиБ').addText((t) => t.setValue(String(st.historyMaxKiB)).onChange(async (v) => {
			const n = Number(v);
			if (Number.isInteger(n) && n >= 32 && n <= 4096) {
				st.historyMaxKiB = n;
				await this.save();
			}
		}));
		new Setting(el).setName('Резервных копий миграции хранить').addText((t) => t.setValue(String(st.backupLimit)).onChange(async (v) => {
			const n = Number(v);
			if (Number.isInteger(n) && n >= 1 && n <= 20) {
				st.backupLimit = n;
				await this.save();
			}
		}));
	}
}
