import { Modal, Notice, Setting, TFile } from 'obsidian';
import { buildMonsters, emptyEncounter, pcCombatant, type MonsterSpec } from '../domain/encounter';
import { nextTieOrder } from '../domain/combat';
import { newId } from '../domain/ids';
import { relativeTo } from '../domain/normalize';
import type { CreatureCard, EncounterTemplate, EncounterTemplateEntry } from '../domain/types';
import { safeTtgUrl } from '../adapters/ttg-adapter';
import { statblockSummary } from '../adapters/statblock-adapter';
import { normalizeText } from '../domain/normalize';
import type { Controller } from '../controller';
import { button, intOrNull } from './common';

function npcNotes(ctl: Controller): TFile[] {
	const s = ctl.state;
	if (!s) return [];
	const folder = `${s.rootPath}/Elements/NPC/`;
	return ctl.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder)).slice(0, 300);
}

function numberField(setting: Setting, value: number | null, placeholder: string, onChange: (v: number | null) => void, testId?: string): void {
	setting.addText((t) => {
		t.setPlaceholder(placeholder).setValue(value === null ? '' : String(value));
		t.inputEl.inputMode = 'numeric';
		t.inputEl.addClass('ca-num');
		if (testId) t.inputEl.dataset.testid = testId;
		t.onChange((v) => {
			const n = intOrNull(v);
			t.inputEl.toggleClass('ca-invalid', n === 'invalid');
			if (n !== 'invalid') onChange(n);
		});
	});
}

/** Template editor: one simple window, not a VTT editor. Templates are never mutated by encounters. */
export class TemplateModal extends Modal {
	private t: EncounterTemplate;
	constructor(
		private readonly ctl: Controller,
		template: EncounterTemplate | null,
	) {
		super(ctl.app);
		this.t = template
			? structuredClone(template)
			: { id: newId('tpl'), name: 'Новое столкновение', partyId: ctl.state?.activePartyId ?? null, includeParty: true, entries: [], notes: '' };
	}

	override onOpen(): void {
		this.modalEl.addClass('ca-template-modal');
		this.render();
	}

	private render(): void {
		const s = this.ctl.state;
		const el = this.contentEl;
		el.empty();
		if (!s) return;
		this.titleEl.setText('Шаблон столкновения');
		new Setting(el).setName('Название').addText((t) => {
			t.setValue(this.t.name).onChange((v) => (this.t.name = v));
			t.inputEl.dataset.testid = 'tpl-name';
		});
		new Setting(el).setName('Включить персонажей партии').addToggle((t) => t.setValue(this.t.includeParty).onChange((v) => (this.t.includeParty = v))).addDropdown((dd) => {
			dd.addOption('', 'активная партия при запуске');
			for (const p of s.parties) dd.addOption(p.id, p.name);
			dd.setValue(this.t.partyId ?? '').onChange((v) => (this.t.partyId = v || null));
		});
		el.createEl('h4', { text: 'Участники' });
		const creatures = Object.values(s.creatures);
		const notes = npcNotes(this.ctl);
		this.t.entries.forEach((e, i) => {
			const box = el.createDiv({ cls: 'ca-entry' });
			const row = new Setting(box).setName(`${i + 1}.`);
			row.addText((t) => {
				t.setPlaceholder('Название').setValue(e.name).onChange((v) => (e.name = v));
				t.inputEl.dataset.testid = `tpl-entry-name-${i}`;
			});
			numberField(row, e.count, 'кол-во', (v) => (e.count = v ?? 1), `tpl-entry-count-${i}`);
			const row2 = new Setting(box).setName('Хиты / КД / мод. иниц.');
			numberField(row2, e.hpMax, 'хиты', (v) => (e.hpMax = v), `tpl-entry-hp-${i}`);
			numberField(row2, e.ac, 'КД', (v) => (e.ac = v));
			numberField(row2, e.initiativeModifier, 'мод.', (v) => (e.initiativeModifier = v));
			new Setting(box)
				.setName('Общая инициатива группы')
				.setDesc('По умолчанию у каждого экземпляра своя инициатива')
				.addToggle((t) => t.setValue(e.sharedInitiative).onChange((v) => (e.sharedInitiative = v)));
			const row3 = new Setting(box).setName('Источник');
			row3.addDropdown((dd) => {
				dd.addOption('', '— карточка —');
				for (const c of creatures) dd.addOption(c.id, c.name);
				dd.setValue(e.creatureId ?? '').onChange((v) => {
					e.creatureId = v || null;
					const c = v ? s.creatures[v] : undefined;
					if (c) {
						e.name = e.name || c.name;
						e.hpMax ??= c.hpMax;
						e.ac ??= c.ac;
						e.initiativeModifier ??= c.initiativeModifier;
					}
					this.render();
				});
			});
			row3.addDropdown((dd) => {
				dd.addOption('', '— заметка NPC —');
				for (const f of notes) dd.addOption(relativeTo(s.rootPath, f.path) ?? f.path, f.basename);
				dd.setValue(e.notePath ?? '').onChange((v) => {
					e.notePath = v || null;
					if (v && !e.name) e.name = v.split('/').pop()?.replace(/\.md$/, '') ?? '';
					this.render();
				});
			});
			row3.addText((t) => {
				t.setPlaceholder('ссылка TTG').setValue(e.sourceUrl ?? '').onChange((v) => (e.sourceUrl = safeTtgUrl(v.trim())));
				t.inputEl.dataset.testid = `tpl-entry-url-${i}`;
			});
			button(box, 'Убрать', () => {
				this.t.entries.splice(i, 1);
				this.render();
			}, { icon: 'trash', cls: 'ca-small' });
		});
		button(el, 'Добавить участника', () => {
			const entry: EncounterTemplateEntry = { id: newId('ent'), kind: 'custom', name: '', count: 1, creatureId: null, notePath: null, sourceUrl: null, hpMax: null, ac: null, initiativeModifier: null, sharedInitiative: false };
			this.t.entries.push(entry);
			this.render();
		}, { icon: 'plus', testId: 'tpl-add-entry' });
		new Setting(el).setName('Заметки').addTextArea((t) => t.setValue(this.t.notes).onChange((v) => (this.t.notes = v)));
		const err = el.createDiv({ cls: 'ca-error' });
		const row = el.createDiv({ cls: 'ca-modal-buttons' });
		button(row, 'Отмена', () => this.close());
		button(row, 'Сохранить шаблон', () => void (async () => {
			if (!this.t.name.trim()) return err.setText('Укажите название');
			const bad = this.t.entries.findIndex((e) => !e.name.trim() || e.count < 1 || e.count > 100);
			if (bad >= 0) return err.setText(`Участник ${bad + 1}: название и количество 1–100 обязательны`);
			for (const e of this.t.entries) e.kind = e.creatureId ? 'creature' : e.notePath ? 'note' : 'custom';
			const out = await this.ctl.act({ type: 'template/upsert', template: this.t });
			if (out.ok) this.close();
		})(), { cls: 'mod-cta', testId: 'tpl-save' });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Adds PCs, creature cards, NPC notes or ad-hoc participants (also creates a spontaneous encounter). */
export class AddCombatantModal extends Modal {
	private spec: MonsterSpec = { name: '', count: 1, kind: 'monster', creatureId: null, source: null, hpMax: null, ac: null, initiativeModifier: null, sharedInitiative: false };
	private selectedPcs = new Set<string>();

	constructor(private readonly ctl: Controller) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.modalEl.addClass('ca-add-modal');
		this.render();
	}

	private render(): void {
		const s = this.ctl.state;
		const el = this.contentEl;
		el.empty();
		if (!s) return;
		this.titleEl.setText(s.activeEncounter ? 'Добавить участников' : 'Спонтанный бой');
		const inFight = new Set(Object.values(s.activeEncounter?.combatants ?? {}).map((c) => c.characterId).filter(Boolean));
		const party = s.parties.find((p) => p.id === s.activePartyId);
		const pcs = Object.values(s.characters).filter((c) => !inFight.has(c.id));
		if (pcs.length) {
			el.createEl('h4', { text: 'Персонажи игроков' });
			for (const ch of pcs) {
				new Setting(el).setName(ch.name).setDesc(party?.characterIds.includes(ch.id) ? `в партии «${party.name}»` : '').addToggle((t) =>
					t.setValue(this.selectedPcs.has(ch.id)).onChange((v) => {
						if (v) this.selectedPcs.add(ch.id);
						else this.selectedPcs.delete(ch.id);
					}),
				);
			}
			if (party) {
				button(el, 'Отметить всю партию', () => {
					for (const id of party.characterIds) if (!inFight.has(id) && s.characters[id]) this.selectedPcs.add(id);
					this.render();
				}, { cls: 'ca-small', testId: 'add-party' });
			}
		}
		el.createEl('h4', { text: 'Существа / NPC' });
		const creatures = Object.values(s.creatures);
		const notes = npcNotes(this.ctl);
		const src = new Setting(el).setName('Из карточки или заметки');
		src.addDropdown((dd) => {
			dd.addOption('', '— карточка —');
			for (const c of creatures) dd.addOption(c.id, c.name);
			dd.setValue(this.spec.creatureId ?? '').onChange((v) => {
				const c: CreatureCard | undefined = v ? s.creatures[v] : undefined;
				this.spec.creatureId = c?.id ?? null;
				if (c) Object.assign(this.spec, { name: c.name, hpMax: c.hpMax, ac: c.ac, initiativeModifier: c.initiativeModifier, source: c.source, kind: 'monster' });
				this.render();
			});
		});
		src.addDropdown((dd) => {
			dd.addOption('', '— заметка NPC —');
			for (const f of notes) dd.addOption(f.path, f.basename);
			dd.onChange((v) => {
				const f = notes.find((x) => x.path === v);
				if (f) Object.assign(this.spec, { name: f.basename, kind: 'npc', source: { provider: 'note', ref: relativeTo(s.rootPath, f.path) ?? f.path } });
				this.render();
			});
		});
		const row = new Setting(el).setName('Название и количество');
		row.addText((t) => {
			t.setPlaceholder('Гоблин').setValue(this.spec.name).onChange((v) => (this.spec.name = v));
			t.inputEl.dataset.testid = 'add-name';
		});
		numberField(row, this.spec.count, 'кол-во', (v) => (this.spec.count = v ?? 1), 'add-count');
		row.addButton((b) => {
			b.setButtonText('Подставить из справочника').setTooltip('Карточки существ → локальный JSON-справочник → Fantasy Statblocks (если включён)').onClick(() => void this.fillFromReferences());
			b.buttonEl.dataset.testid = 'add-lookup';
		});
		const row2 = new Setting(el).setName('Хиты / КД / мод. иниц.');
		numberField(row2, this.spec.hpMax, 'хиты', (v) => (this.spec.hpMax = v), 'add-hp');
		numberField(row2, this.spec.ac, 'КД', (v) => (this.spec.ac = v), 'add-ac');
		numberField(row2, this.spec.initiativeModifier, 'мод.', (v) => (this.spec.initiativeModifier = v));
		new Setting(el).setName('Общая инициатива (группа)').setDesc('Только по явному выбору').addToggle((t) => t.setValue(this.spec.sharedInitiative).onChange((v) => (this.spec.sharedInitiative = v)));
		new Setting(el).setName('Ссылка на TTG').addText((t) =>
			t.setPlaceholder('https://5e14.ttg.club/bestiary/…').setValue(this.spec.source?.url ?? '').onChange((v) => {
				const url = safeTtgUrl(v.trim());
				if (url) this.spec.source = { provider: 'ttg2014', ref: url, url };
			}),
		);
		const err = el.createDiv({ cls: 'ca-error' });
		const buttons = el.createDiv({ cls: 'ca-modal-buttons' });
		button(buttons, 'Отмена', () => this.close());
		button(buttons, 'Добавить', () => void this.submit(err), { cls: 'mod-cta', testId: 'add-submit' });
	}

	/** Fills empty fields only; never overwrites what the GM typed. */
	private async fillFromReferences(): Promise<void> {
		const s = this.ctl.state;
		const name = this.spec.name.trim();
		if (!s || !name) return;
		const q = normalizeText(name, { foldYo: true });
		const card = Object.values(s.creatures).find((c) => [c.name, ...c.aliases].some((n) => normalizeText(n, { foldYo: true }) === q));
		let found: { hpMax: number | null; ac: number | null; initiativeModifier: number | null; url: string | null; from: string } | null = null;
		if (card) {
			found = { hpMax: card.hpMax, ac: card.ac, initiativeModifier: card.initiativeModifier, url: card.source?.url ?? null, from: 'карточка' };
			this.spec.creatureId = card.id;
		} else {
			const hit = (await this.ctl.offline.search(name)).find((h) => normalizeText(h.name, { foldYo: true }) === q);
			const sum = hit ? await this.ctl.offline.getSummary(hit.ref) : null;
			if (sum) found = { hpMax: sum.hpMax, ac: sum.ac, initiativeModifier: sum.initiativeModifier, url: sum.sourceUrl, from: 'локальный справочник' };
			else {
				const sb = statblockSummary(this.app, this.ctl.settings.fantasyStatblocks, name);
				if (sb) found = { hpMax: sb.hpMax, ac: sb.ac, initiativeModifier: sb.initiativeModifier, url: null, from: 'Fantasy Statblocks' };
			}
		}
		if (!found) {
			new Notice(`«${name}» не найдено в карточках и подключённых справочниках`);
			return;
		}
		this.spec.hpMax ??= found.hpMax;
		this.spec.ac ??= found.ac;
		this.spec.initiativeModifier ??= found.initiativeModifier;
		if (found.url && !this.spec.source) this.spec.source = { provider: 'ttg2014', ref: found.url, url: found.url };
		new Notice(`Подставлено: ${found.from}`);
		this.render();
	}

	private async submit(err: HTMLElement): Promise<void> {
		const s = this.ctl.state;
		if (!s) return;
		const hasMonster = this.spec.name.trim().length > 0;
		if (!hasMonster && this.selectedPcs.size === 0) return void err.setText('Выберите персонажей или укажите существо');
		if (hasMonster && (this.spec.count < 1 || this.spec.count > 100)) return void err.setText('Количество 1–100');
		if (!s.activeEncounter) {
			const out = await this.ctl.act({ type: 'encounter/create', encounter: emptyEncounter(newId('enc'), 'Спонтанный бой', new Date().toISOString(), s.activePartyId, null) });
			if (!out.ok) return;
		}
		const enc = this.ctl.state?.activeEncounter;
		if (!enc) return;
		const work = structuredClone(enc);
		const combatants = [];
		let tie = nextTieOrder(work);
		for (const id of this.selectedPcs) {
			const c = pcCombatant(s, id, newId('cmb'), tie);
			tie += 10;
			combatants.push(c);
			work.combatants[c.id] = c;
		}
		const groups = [];
		if (hasMonster) {
			const { combatants: mons, group } = buildMonsters(work, { ...this.spec, name: this.spec.name.trim() }, newId);
			combatants.push(...mons);
			if (group) groups.push(group);
		}
		const out = await this.ctl.act({ type: 'encounter/add-combatants', combatants, groups });
		if (out.ok) this.close();
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

export class CreatureModal extends Modal {
	private c: CreatureCard;
	constructor(
		private readonly ctl: Controller,
		card: CreatureCard | null,
	) {
		super(ctl.app);
		this.c = card ? structuredClone(card) : { id: newId('crt'), name: '', aliases: [], ac: null, hpMax: null, initiativeModifier: null, speed: '', notes: '', source: null };
	}

	override onOpen(): void {
		const el = this.contentEl;
		this.titleEl.setText('Карточка существа (локальная)');
		el.createEl('p', { cls: 'ca-muted', text: 'Краткие тактические параметры для боя. Полный текст — по ссылке на TTG (открывается в браузере).' });
		new Setting(el).setName('Название').addText((t) => {
			t.setValue(this.c.name).onChange((v) => (this.c.name = v));
			t.inputEl.dataset.testid = 'crt-name';
		});
		new Setting(el).setName('Алиасы (через запятую)').addText((t) => t.setValue(this.c.aliases.join(', ')).onChange((v) => (this.c.aliases = v.split(',').map((x) => x.trim()).filter(Boolean))));
		const row = new Setting(el).setName('КД / хиты / мод. иниц.');
		numberField(row, this.c.ac, 'КД', (v) => (this.c.ac = v), 'crt-ac');
		numberField(row, this.c.hpMax, 'хиты', (v) => (this.c.hpMax = v), 'crt-hp');
		numberField(row, this.c.initiativeModifier, 'мод.', (v) => (this.c.initiativeModifier = v));
		new Setting(el).setName('Скорость').addText((t) => t.setValue(this.c.speed).onChange((v) => (this.c.speed = v)));
		new Setting(el).setName('Ссылка на TTG').addText((t) => {
			t.setPlaceholder('https://5e14.ttg.club/bestiary/goblin').setValue(this.c.source?.url ?? '');
			t.inputEl.dataset.testid = 'crt-url';
			t.onChange((v) => {
				const url = safeTtgUrl(v.trim());
				this.c.source = url ? { provider: 'ttg2014', ref: url, url } : null;
			});
		});
		new Setting(el).setName('Заметки').addTextArea((t) => t.setValue(this.c.notes).onChange((v) => (this.c.notes = v)));
		const err = el.createDiv({ cls: 'ca-error' });
		const rowB = el.createDiv({ cls: 'ca-modal-buttons' });
		button(rowB, 'Отмена', () => this.close());
		button(rowB, 'Сохранить', () => void (async () => {
			if (!this.c.name.trim()) return err.setText('Название обязательно');
			this.c.name = this.c.name.trim();
			const out = await this.ctl.act({ type: 'creature/upsert', creature: this.c });
			if (out.ok) this.close();
		})(), { cls: 'mod-cta', testId: 'crt-save' });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
