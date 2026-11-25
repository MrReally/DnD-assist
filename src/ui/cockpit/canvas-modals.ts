// View points (1–9) and Canvas checkpoints.
import { Modal, Notice } from 'obsidian';
import { getViewport, requestCanvasSave, setViewport, type Viewport } from '../../adapters/canvas-adapter';
import { cockpitOf } from '../../domain/cockpit';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from '../../services/checkpoints';
import type { Controller } from '../../controller';
import { button, confirm } from '../common';

/** In-memory "previous area": the camera before the last jump (not persisted, never a story log). */
let previous: Viewport | null = null;

export function goToViewPoint(ctl: Controller, slot: string): boolean {
	const rel = ctl.canvasRelPath();
	const st = ctl.state;
	if (!rel || !st) return false;
	const vp = cockpitOf(st).viewpoints[rel]?.[slot];
	const view = ctl.activeCanvasView();
	if (!vp) {
		new Notice(`Точка обзора ${slot} не задана`);
		return false;
	}
	const cur = getViewport(view);
	if (!setViewport(view, { x: vp.x, y: vp.y, zoom: vp.zoom })) {
		new Notice('Canvas не поддерживает перемещение камеры в этой версии Obsidian. Используйте поиск и переход к узлу.');
		return false;
	}
	previous = cur;
	return true;
}

export function goBackToPreviousArea(ctl: Controller): boolean {
	if (!previous) return false;
	const cur = getViewport(ctl.activeCanvasView());
	const ok = setViewport(ctl.activeCanvasView(), previous);
	if (ok) previous = cur;
	return ok;
}

export class ViewPointsModal extends Modal {
	constructor(private readonly ctl: Controller) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Точки обзора');
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const rel = this.ctl.canvasRelPath();
		const st = this.ctl.state;
		if (!rel || !st) return void el.createDiv({ cls: 'gmc-dim', text: 'Откройте Canvas приключения.' });
		const map = cockpitOf(st).viewpoints[rel] ?? {};
		const here = getViewport(this.ctl.activeCanvasView());
		for (let i = 1; i <= 9; i++) {
			const slot = String(i);
			const vp = map[slot];
			const row = el.createDiv({ cls: 'gmc-vp', attr: { 'data-testid': `vp-row-${slot}` } });
			row.createSpan({ cls: 'gmc-num', text: slot });
			const name = row.createEl('input', { cls: 'gmc-input', type: 'text', value: vp?.name ?? '', attr: { placeholder: 'название', 'aria-label': `Название точки ${slot}`, 'data-testid': `vp-name-${slot}` } });
			button(row, 'Сохранить здесь', () => void this.save(rel, slot, name.value, here), { cls: 'gmc-btn gmc-btn-sm', testId: `vp-save-${slot}`, disabled: !here });
			button(row, 'Перейти', () => (goToViewPoint(this.ctl, slot), this.close()), { cls: 'gmc-btn gmc-btn-sm gmc-btn-p', testId: `vp-go-${slot}`, disabled: !vp });
			button(row, '', () => void this.ctl.act({ type: 'cockpit/viewpoint-set', canvasRel: rel, slot, view: null }).then(() => this.render()), { icon: 'x', title: 'Удалить', cls: 'gmc-btn gmc-btn-sm gmc-btn-g', disabled: !vp });
		}
		button(el, 'Вернуться в предыдущую область', () => (goBackToPreviousArea(this.ctl) ? this.close() : new Notice('Нет предыдущей области')), { cls: 'gmc-btn', testId: 'vp-back' });
		if (!here) el.createDiv({ cls: 'gmc-warn', text: 'Камера Canvas недоступна в этой версии Obsidian: точки обзора отключены, остальное работает.' });
	}

	private async save(rel: string, slot: string, name: string, v: Viewport | null): Promise<void> {
		if (!v) return;
		const out = await this.ctl.act({ type: 'cockpit/viewpoint-set', canvasRel: rel, slot, view: { name: name.trim() || `Точка ${slot}`, x: v.x, y: v.y, zoom: v.zoom } });
		if (out.ok) this.render();
	}
}

export class CheckpointModal extends Modal {
	private name = '';
	constructor(private readonly ctl: Controller) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.titleEl.setText('Контрольные точки Canvas');
		void this.render();
	}

	private async render(): Promise<void> {
		const el = this.contentEl;
		el.empty();
		const st = this.ctl.state;
		const file = this.ctl.activeCanvas;
		const rel = this.ctl.canvasRelPath();
		if (!st || !file || !rel) return void el.createDiv({ cls: 'gmc-dim', text: 'Откройте Canvas приключения.' });
		el.createDiv({ cls: 'gmc-dim', text: 'Восстанавливается только расположение и состав карточек. HP, инвентарь, ресурсы и бой не затрагиваются.' });
		const row = el.createDiv({ cls: 'gmc-row gmc-gap' });
		const input = row.createEl('input', { cls: 'gmc-input', type: 'text', value: this.name, attr: { placeholder: 'Название, например «Перед сессией»', 'data-testid': 'cp-name', 'aria-label': 'Название точки' } });
		input.addEventListener('input', () => (this.name = input.value));
		button(row, 'Создать', () => void this.create(file.path, st.rootPath, rel), { cls: 'gmc-btn gmc-btn-p', testId: 'cp-create' });
		const list = el.createDiv({ cls: 'gmc-items', attr: { 'data-testid': 'cp-list' } });
		const cps = await listCheckpoints(this.ctl.port, st.rootPath, rel);
		if (!cps.length) list.createDiv({ cls: 'gmc-dim', text: 'Контрольных точек пока нет.' });
		for (const cp of cps) {
			const r = list.createDiv({ cls: 'gmc-item', attr: { 'data-testid': 'cp-row' } });
			const d = new Date(cp.at);
			r.createDiv({ cls: 'gmc-item-name' }).setText(`${cp.kind === 'protective' ? '⛨ ' : ''}${cp.name} · ${d.toLocaleString('ru-RU')} · карточек: ${cp.nodes}`);
			button(r, 'Восстановить', () => void this.restore(file.path, st.rootPath, rel, cp), { cls: 'gmc-btn gmc-btn-sm', testId: 'cp-restore' });
		}
	}

	private async create(canvasPath: string, root: string, rel: string): Promise<void> {
		try {
			requestCanvasSave(this.ctl.activeCanvasView());
			await new Promise((r) => window.setTimeout(r, 400));
			const cp = await createCheckpoint(this.ctl.port, root, canvasPath, rel, this.name.trim() || 'Контрольная точка');
			new Notice(`Контрольная точка «${cp.name}» создана (карточек: ${cp.nodes})`);
			this.name = '';
			await this.render();
		} catch (e) {
			new Notice(`Не удалось создать контрольную точку: ${e instanceof Error ? e.message : String(e)}`, 8000);
		}
	}

	private async restore(canvasPath: string, root: string, rel: string, cp: Parameters<typeof restoreCheckpoint>[4]): Promise<void> {
		if (!(await confirm(this.ctl.app, 'Восстановить Canvas?', `Расположение карточек будет заменено версией «${cp.name}». Текущая версия сохранится как защитная копия. Игровое состояние не изменится.`, 'Восстановить'))) return;
		try {
			requestCanvasSave(this.ctl.activeCanvasView());
			await new Promise((r) => window.setTimeout(r, 400));
			await restoreCheckpoint(this.ctl.port, root, canvasPath, rel, cp);
			this.ctl.canvasIndex.invalidate();
			new Notice('Canvas восстановлен. Защитная копия предыдущей версии сохранена.');
			await this.render();
		} catch (e) {
			new Notice(`Восстановление не выполнено, Canvas не изменён: ${e instanceof Error ? e.message : String(e)}`, 9000);
		}
	}
}
