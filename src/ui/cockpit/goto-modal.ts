// "Перейти": one search over Canvas nodes and the reference. Two groups (SPEC §2):
// «На Canvas» (jump) and «В справочнике, не на Canvas» (open in panel / add to Canvas / add to combat / create).
// Nothing is added to the Canvas automatically; the second action is always explicit.
import { Modal, Notice, TFile } from 'obsidian';
import { addFileNode, focusNode } from '../../adapters/canvas-adapter';
import { findTemplate, quickNpc } from '../../domain/builder';
import { cockpitOf, formatCost, type ItemType } from '../../domain/cockpit';
import { creatureForNote } from '../../domain/card';
import { newId } from '../../domain/ids';
import { relativeTo, sanitizeFileName, normalizeText } from '../../domain/normalize';
import { CREATURE_TEMPLATES, ITEM_TYPES } from '../../domain/srd-data';
import type { Controller } from '../../controller';
import { button } from '../common';
import { addCreatureToCombat } from './modals';
import { SpellImportModal } from './modals';

interface Row {
	title: string;
	sub: string;
	actions: Array<{ label: string; testId: string; run: () => Promise<void> | void }>;
}

export class GoToModal extends Modal {
	private q = '';
	constructor(private readonly ctl: Controller) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Перейти');
		const input = this.contentEl.createEl('input', { cls: 'gmc-input', type: 'text', attr: { placeholder: 'Объект Canvas или справочник…', 'aria-label': 'Поиск', 'data-testid': 'goto-input' } });
		this.contentEl.createDiv({ cls: 'gmc-goto', attr: { 'data-testid': 'goto-results' } });
		input.addEventListener('input', () => {
			this.q = input.value;
			void this.render();
		});
		void this.render();
		window.setTimeout(() => input.focus(), 30);
	}

	private async render(): Promise<void> {
		const host = this.contentEl.querySelector<HTMLElement>('.gmc-goto');
		const st = this.ctl.state;
		if (!host || !st) return;
		const norm = (s: string): string => normalizeText(s, { foldYo: this.ctl.settings.foldYo });
		const q = norm(this.q);
		const has = (s: string): boolean => !q || norm(s).includes(q);
		host.empty();

		const onCanvasFiles = new Set<string>();
		const canvasRows: Row[] = [];
		const idx = await this.ctl.refreshIndex();
		for (const it of idx?.items ?? []) {
			if (it.filePath) onCanvasFiles.add(it.filePath);
			if (!q || !it.haystack.includes(q)) continue;
			if (canvasRows.length >= 12) continue;
			const actions: Row['actions'] = [{ label: 'Перейти', testId: 'goto-jump', run: () => this.jump(it.nodeId) }];
			if (it.filePath && this.ctl.openCardForPath(it.filePath)) actions.push({ label: 'В панель', testId: 'goto-panel', run: () => undefined });
			canvasRows.push({ title: it.title, sub: it.subtitle || it.type, actions });
		}
		this.group(host, 'На Canvas', canvasRows, 'goto-group-canvas');

		const ref: Row[] = [];
		const charPath = (rel: string): string => `${st.rootPath}/${rel}`;
		for (const c of Object.values(st.characters)) {
			if (!has(c.name) || onCanvasFiles.has(charPath(c.notePath))) continue;
			ref.push({ title: c.name, sub: 'Персонаж', actions: [{ label: 'В панель', testId: 'goto-panel', run: () => this.ctl.setTarget({ kind: 'character', id: c.id }) }, { label: 'На Canvas', testId: 'goto-add', run: () => this.addToCanvas(charPath(c.notePath)) }] });
		}
		for (const cr of Object.values(st.creatures)) {
			if (!has(cr.name)) continue;
			const notePath = cr.source?.provider === 'note' ? charPath(cr.source.ref) : null;
			if (notePath && onCanvasFiles.has(notePath)) continue;
			ref.push({ title: cr.name, sub: 'Существо', actions: [{ label: 'В панель', testId: 'goto-panel', run: () => this.ctl.setCard({ kind: 'creature', id: cr.id }) }, { label: 'В бой', testId: 'goto-combat', run: () => void addCreatureToCombat(this.ctl, cr.id) }, { label: 'На Canvas', testId: 'goto-add', run: () => this.addCreature(cr.id) }] });
		}
		if (q) {
			for (const t of CREATURE_TEMPLATES) {
				if (!t.keys.some((k) => norm(k).includes(q)) && !has(t.name)) continue;
				ref.push({ title: `${t.name} (SRD)`, sub: `ОП ${t.block.cr} · КД ${t.ac} · HP ${t.hpAvg}`, actions: [{ label: 'Создать NPC', testId: 'goto-create-npc', run: () => this.createNpc(t.name, false) }, { label: 'Создать и в бой', testId: 'goto-create-combat', run: () => this.createNpc(t.name, true) }] });
			}
			for (const sp of this.ctl.settings.spells.filter((s) => has(s.name)).slice(0, 8)) {
				const tid = this.ctl.target?.kind === 'character' ? this.ctl.target.id : null;
				ref.push({ title: sp.name, sub: `Заклинание · ${sp.level === 0 ? 'заговор' : `${sp.level} ур.`}`, actions: [{ label: 'Добавить персонажу', testId: 'goto-spell', run: () => new SpellImportModal(this.ctl, tid, () => undefined).open() }] });
			}
			const owner = this.ownerOfTarget();
			const types: ItemType[] = [...Object.values(cockpitOf(st).itemTypes), ...Object.values(ITEM_TYPES)].filter((t) => has(t.name)).slice(0, 8);
			for (const t of types) {
				ref.push({ title: t.name, sub: `Предмет · ${formatCost(t.costCp)}${t.damage ? ` · ${t.damage}` : ''}`, actions: owner ? [{ label: 'Создать экземпляр', testId: 'goto-item', run: () => void this.createItem(t, owner) }] : [] });
			}
		}
		this.group(host, 'В справочнике, не на Canvas', ref.slice(0, 24), 'goto-group-ref');
	}

	private ownerOfTarget(): { kind: 'character' | 'creature'; id: string } | null {
		const ref = this.ctl.cardRef;
		const st = this.ctl.state;
		if (!ref || !st) return null;
		if (ref.kind === 'character') return { kind: 'character', id: ref.id };
		if (ref.kind === 'creature') return { kind: 'creature', id: ref.id };
		if (ref.kind === 'combatant') {
			const c = st.activeEncounter?.combatants[ref.id];
			if (c?.characterId) return { kind: 'character', id: c.characterId };
			if (c?.creatureId) return { kind: 'creature', id: c.creatureId };
		}
		return null;
	}

	private group(host: HTMLElement, title: string, rows: Row[], tid: string): void {
		const g = host.createDiv({ cls: 'gmc-goto-group', attr: { 'data-testid': tid } });
		g.createDiv({ cls: 'gmc-eyebrow', text: title });
		if (!rows.length) g.createDiv({ cls: 'gmc-dim', text: this.q ? 'Ничего не найдено' : 'Введите запрос' });
		for (const r of rows) {
			const row = g.createDiv({ cls: 'gmc-goto-row', attr: { 'data-testid': 'goto-row' } });
			const t = row.createDiv({ cls: 'gmc-goto-title' });
			t.createSpan({ text: r.title });
			t.createSpan({ cls: 'gmc-dim', text: r.sub });
			const a = row.createDiv({ cls: 'gmc-row gmc-gap' });
			for (const act of r.actions) button(a, act.label, () => void Promise.resolve(act.run()).then(() => this.closeAndOpenPanel(act.label)), { cls: 'gmc-btn gmc-btn-sm', testId: act.testId });
		}
	}

	private closeAndOpenPanel(label: string): void {
		this.close();
		if (label !== 'Перейти') this.ctl.showPanel();
	}

	private jump(nodeId: string): void {
		if (!focusNode(this.ctl.activeCanvasView(), nodeId)) new Notice('Canvas не позволяет перейти к узлу в этой версии Obsidian; найдите его вручную.');
	}

	private async createNpc(query: string, toCombat: boolean): Promise<void> {
		const r = quickNpc(findTemplate(query) ? query : query, newId);
		if (!r) return;
		const out = await this.ctl.act({ type: 'cockpit/npc-create', creature: r.creature, statblock: r.statblock, items: r.items, purse: r.purse });
		if (!out.ok) return;
		if (toCombat) await addCreatureToCombat(this.ctl, r.creature.id);
		this.ctl.setCard({ kind: 'creature', id: r.creature.id });
		this.close();
		this.ctl.showPanel();
	}

	private async createItem(t: ItemType, owner: { kind: 'character' | 'creature'; id: string }): Promise<void> {
		const out = await this.ctl.act({ type: 'cockpit/item-upsert', item: { id: newId('itm'), typeId: t.id, name: t.name, ownerKind: owner.kind, ownerId: owner.id, containerId: null, qty: 1, equipped: false, magicBonus: 0, note: '' } });
		if (out.ok) new Notice(`«${t.name}» добавлен`);
	}

	/** Existing note → node. The note is never created for characters (it already exists). */
	private addToCanvas(vaultPath: string): void {
		const f = this.ctl.app.vault.getAbstractFileByPath(vaultPath);
		if (!(f instanceof TFile)) return void new Notice('Заметка не найдена');
		if (!addFileNode(this.ctl.activeCanvasView(), f)) {
			void this.ctl.app.workspace.getLeaf('tab').openFile(f);
			new Notice('Автоматическое добавление на Canvas недоступно в этой версии Obsidian. Заметка открыта — перетащите её на Canvas.', 9000);
			return;
		}
		this.ctl.canvasIndex.invalidate();
		new Notice('Добавлено на Canvas');
	}

	/** A creature card without a note gets one (new file only, never overwritten), then the node is added. */
	private async addCreature(creatureId: string): Promise<void> {
		const st = this.ctl.state;
		const cr = st?.creatures[creatureId];
		if (!st || !cr) return;
		let rel = cr.source?.provider === 'note' ? cr.source.ref : null;
		if (!rel) {
			rel = `Elements/NPC/${sanitizeFileName(cr.name)}.md`;
			let full = `${st.rootPath}/${rel}`;
			let n = 2;
			while (this.ctl.port.noteExists(full)) {
				rel = `Elements/NPC/${sanitizeFileName(cr.name)} ${n++}.md`;
				full = `${st.rootPath}/${rel}`;
			}
			await this.ctl.port.createNote(full, `---\ncanvasAssistId: ${cr.id}\n---\n# ${cr.name}\n`);
			const out = await this.ctl.act({ type: 'creature/upsert', creature: { ...cr, source: { provider: 'note', ref: rel } } });
			if (!out.ok) return;
		}
		this.addToCanvas(`${st.rootPath}/${rel}`);
		void relativeTo;
		void creatureForNote;
	}
}
