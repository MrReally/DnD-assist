#!/usr/bin/env node
// GM Cockpit SPEC §8 technical spikes. Real Obsidian desktop, isolated temp vault/profile (fixtures copy).
// Output: tests/e2e/out/spikes.json (+ docs/gm-cockpit-matrix.md is written from it by hand/script).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, launchTrusted, OUT, sleep } from './lib.mjs';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.CA_E2E_CHILD) {
	const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, CA_E2E_CHILD: '1' } });
	process.exit(r.status ?? 1);
}

mkdirSync(OUT, { recursive: true });
const A = 'Приключение А';
const W = Number(process.env.SPIKE_W ?? 1280);
const H = Number(process.env.SPIKE_H ?? 800);
const results = [];
const sb = createSandbox('spikes', [], { width: W, height: H });
const app = await launchTrusted(sb, { width: W, height: H });
const page = app.page;

async function spike(id, title, fn) {
	const t0 = Date.now();
	try {
		const r = await fn();
		results.push({ id, title, ms: Date.now() - t0, ...r });
		console.log(`${r.status} ${id} ${title}`);
	} catch (e) {
		results.push({ id, title, status: 'FAIL', error: String(e?.stack ?? e).slice(0, 1500) });
		console.log(`FAIL ${id} ${title}: ${e?.message}`);
	}
}

async function openCanvas(rel) {
	await app.openFile(`${A}/Холсты/${rel}`);
	await sleep(1200);
}
async function nodeRect(id) {
	return app.eval((nid) => {
		const v = window.app.workspace.getMostRecentLeaf().view;
		const n = v.canvas.nodes.get(nid);
		const r = n.nodeEl.getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	}, id);
}

await app.eval(async (a) => {
	await window.canvasAssist.ctl.registerAdventure(a, a);
}, A);
await openCanvas('02.canvas');
const win = await app.eval(() => ({ w: window.innerWidth, h: window.innerHeight }));
console.log('window', win);
const canvasNodes = await app.eval(() => [...window.app.workspace.getMostRecentLeaf().view.canvas.nodes.keys()]);
console.log('nodes', canvasNodes);
const fileNodeId = await app.eval(() => {
	const c = window.app.workspace.getMostRecentLeaf().view.canvas;
	for (const [id, n] of c.nodes) if (n.file) return id;
	return null;
});

// ---- S1: double click on a node --------------------------------------------------------------
await spike('S1', 'Перехват двойного клика по узлу Canvas', async () => {
	await app.eval(() => {
		window.__dbl = [];
		const h = (ev) => {
			const el = ev.target instanceof Element ? ev.target.closest('.canvas-node') : null;
			window.__dbl.push({ phase: ev.eventPhase, nodeEl: !!el, cls: el?.className ?? null, tag: ev.target?.tagName });
		};
		document.addEventListener('dblclick', h, true);
		window.__dblRemove = () => document.removeEventListener('dblclick', h, true);
	});
	const r = await nodeRect(fileNodeId);
	// Click the node header area (top strip), not the embedded content.
	const px = r.x + r.w / 2;
	const py = r.y + 12;
	await page.mouse.dblclick(px, py);
	await sleep(500);
	const events = await app.eval(() => window.__dbl);
	const editing = await app.eval((id) => {
		const n = window.app.workspace.getMostRecentLeaf().view.canvas.nodes.get(id);
		return { isEditing: !!n.isEditing, contentFocused: document.activeElement?.className ?? null };
	}, fileNodeId);
	// Capture-phase listener that swallows the event: does Canvas still react (enter edit mode)?
	await app.eval(() => {
		window.__dblRemove();
		window.__dbl2 = 0;
		const h = (ev) => {
			if (ev.target instanceof Element && ev.target.closest('.canvas-node')) {
				window.__dbl2++;
				ev.stopPropagation();
			}
		};
		document.addEventListener('dblclick', h, true);
		window.__dblRemove = () => document.removeEventListener('dblclick', h, true);
	});
	await page.keyboard.press('Escape');
	await page.mouse.click(r.x + r.w + 200 > W ? 20 : r.x + r.w + 200, py + 300);
	await page.mouse.dblclick(px, py);
	await sleep(500);
	const swallowed = await app.eval((id) => ({ count: window.__dbl2, isEditing: !!window.app.workspace.getMostRecentLeaf().view.canvas.nodes.get(id).isEditing }), fileNodeId);
	await app.eval(() => window.__dblRemove());
	const got = events.some((e) => e.nodeEl);
	return {
		status: got ? 'PASS' : 'FAIL',
		did: 'Реальный двойной клик мышью (CDP Input) по заголовку файлового узла; capture-слушатель dblclick на document; затем слушатель, гасящий событие (stopPropagation).',
		result: { events, editingAfterNativeDblclick: editing, afterSwallow: swallowed },
		limits: 'Событие приходит в capture-фазе, но Canvas может начать редактирование раньше/параллельно (см. afterSwallow). Перехват привязан к DOM-классам Canvas (.canvas-node) — не публичный API.',
		fallback: 'Команда «Открыть в GM Cockpit» для выбранного узла + контекстное меню узла + горячая клавиша.',
	};
});

async function resetSelection() {
	await app.eval(() => { const c = window.app.workspace.getMostRecentLeaf().view.canvas; for (const n of c.nodes.values()) if (n.isEditing) n.setIsEditing?.(false); c.deselectAll(); });
	await page.keyboard.press('Escape');
	await sleep(200);
}
// ---- S2: node styling -------------------------------------------------------------------------
await spike('S2', 'Стилизация узлов Canvas (рамка выбора, метка типа)', async () => {
	await app.eval(() => {
		const st = document.createElement('style');
		st.id = '__spike_css';
		st.textContent = '.canvas-node.is-focused .canvas-node-container{outline:2px solid #c9a45c !important}.canvas-node-container{border-radius:8px}';
		document.head.append(st);
	});
	await resetSelection();
	const r = await nodeRect(fileNodeId);
	await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
	await sleep(300);
	const info = await app.eval((id) => {
		const n = window.app.workspace.getMostRecentLeaf().view.canvas.nodes.get(id);
		const cont = n.nodeEl.querySelector('.canvas-node-container');
		const cs = getComputedStyle(cont);
		return { selectedClass: n.nodeEl.classList.contains('is-focused'), outline: cs.outlineColor + ' ' + cs.outlineWidth, radius: cs.borderRadius, classes: n.nodeEl.className };
	}, fileNodeId);
	await app.eval(() => document.getElementById('__spike_css')?.remove());
	const ok = info.selectedClass && /201, 164, 92/.test(info.outline);
	return { status: ok ? 'PASS' : 'FAIL', did: 'Инъекция CSS по .canvas-node.is-focused .canvas-node-container (в 1.14.4 класс выделения — is-focused); реальный клик; чтение computed style.', result: info, limits: 'Селекторы Canvas недокументированы; без JS-записи в DOM узлов. Иконки типа через ::before — не проверялись.', fallback: 'Оставить штатный вид узлов.' };
});

// ---- S3: overlays ----------------------------------------------------------------------------
await spike('S3', 'Оверлеи (NavChip / PartyDock / лента) поверх области Canvas', async () => {
	const info = await app.eval(() => {
		const leaf = window.app.workspace.getMostRecentLeaf();
		const host = leaf.view.containerEl;
		const dock = document.createElement('div');
		dock.id = '__spike_dock';
		dock.style.cssText = 'position:absolute;left:50%;bottom:8px;width:200px;height:36px;background:#1a1612;z-index:50;pointer-events:auto';
		dock.dataset.clicked = '0';
		dock.addEventListener('click', () => (dock.dataset.clicked = '1'));
		const viewContent = host.querySelector('.view-content') ?? host;
		viewContent.append(dock);
		const r = dock.getBoundingClientRect();
		const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
		const leafR = host.getBoundingClientRect();
		const existingOverlay = !!host.querySelector('[class*="ca-"]');
		return { dockRect: { x: r.x, y: r.y, w: r.width, h: r.height }, topIsDock: top === dock, leafRect: { x: leafR.x, y: leafR.y, w: leafR.width, h: leafR.height }, existingPluginOverlay: existingOverlay };
	});
	const cx = info.dockRect.x + info.dockRect.w / 2;
	const cy = info.dockRect.y + info.dockRect.h / 2;
	await page.mouse.click(cx, cy);
	const clicked = await app.eval(() => document.getElementById('__spike_dock').dataset.clicked);
	// Canvas still pans/zooms under the dock?
	const before = await app.eval(() => { const c = window.app.workspace.getMostRecentLeaf().view.canvas; return { x: c.tx, y: c.ty, z: c.tZoom }; });
	await page.mouse.move(300, 300);
	await page.mouse.wheel(0, -200);
	await sleep(300);
	const after = await app.eval(() => { const c = window.app.workspace.getMostRecentLeaf().view.canvas; return { x: c.tx, y: c.ty, z: c.tZoom }; });
	await app.eval(() => document.getElementById('__spike_dock')?.remove());
	const ok = info.topIsDock && clicked === '1';
	return { status: ok ? 'PASS' : 'FAIL', did: 'Элемент position:absolute в .view-content Canvas-листа; elementFromPoint; реальный клик; колесо мыши по Canvas после.', result: { ...info, clicked, viewportBeforeWheel: before, afterWheel: after }, limits: 'Оверлей — сосед содержимого Canvas (ADR-2 v1): внутрь .canvas-wrapper клики теряются.', fallback: 'Боковая/нижняя панель Obsidian.' };
});

// ---- S4: viewport set/get ---------------------------------------------------------------------
await spike('S4', 'Программное задание положения и масштаба (точки обзора)', async () => {
	const probe = await app.eval(() => {
		const c = window.app.workspace.getMostRecentLeaf().view.canvas;
		const proto = Object.getPrototypeOf(c);
		return { methods: Object.getOwnPropertyNames(proto).filter((k) => typeof c[k] === 'function' && /zoom|pan|viewport|setView|tx|ty|bbox|center|request/i.test(k)), props: { tx: c.tx, ty: c.ty, tZoom: c.tZoom, zoom: c.zoom } };
	});
	const target = { x: 150, y: -80, zoom: 0.5 };
	const res = await app.eval(async (t) => {
		const c = window.app.workspace.getMostRecentLeaf().view.canvas;
		const log = {};
		if (typeof c.setViewport === 'function') {
			c.setViewport(t.x, t.y, t.zoom);
			log.used = 'setViewport';
		} else {
			c.tx = t.x; c.ty = t.y; c.tZoom = t.zoom; c.markViewportChanged?.(); c.requestFrame?.();
			log.used = 'tx/ty/tZoom + markViewportChanged';
		}
		await new Promise((r) => setTimeout(r, 400));
		log.after = { tx: c.tx, ty: c.ty, tZoom: c.tZoom };
		return log;
	}, target);
	const ok = Math.abs(res.after.tx - target.x) < 1 && Math.abs(res.after.ty - target.y) < 1 && Math.abs(res.after.tZoom - target.zoom) < 0.01;
	// Visual confirmation: node screen position after change.
	const nr = await nodeRect(fileNodeId);
	await app.screenshot('spike-s4-viewport');
	return { status: ok ? 'PASS' : 'FAIL', did: 'Зонд методов Canvas; setViewport(x,y,zoom) либо запись tx/ty/tZoom; чтение через 400 мс; координаты узла в DOM.', result: { probe, setTo: target, ...res, nodeScreenRect: nr }, limits: 'Внутренний API (tx/ty/tZoom) недокументирован; изменения Canvas между версиями возможны.', fallback: 'Узлы-метки + focusNode (v1, подтверждено AC-06).' };
});

// ---- S5: checkpoint save / restore ------------------------------------------------------------
await spike('S5', 'Контрольные точки: сохранение/восстановление раскладки без игровых данных', async () => {
	const canvasPath = `${A}/Холсты/02.canvas`;
	const info = await app.eval(async (cp) => {
		const ctl = window.canvasAssist.ctl;
		const adapter = window.app.vault.adapter;
		const ckpt = `${ctl.state.rootPath}/.canvas-assist-checkpoints`;
		if (!(await adapter.exists(ckpt))) await adapter.mkdir(ckpt);
		const original = await adapter.read(cp);
		await adapter.write(`${ckpt}/cp1.canvas`, original);
		const hpBefore = JSON.stringify(Object.values(ctl.state.characters).map((c) => c.hp));
		// Modify the live canvas: remove a node via file edit (user did something), keep Obsidian open on it.
		const j = JSON.parse(original);
		const removed = j.nodes.pop();
		await window.app.vault.modify(window.app.vault.getAbstractFileByPath(cp), JSON.stringify(j, null, 2));
		await new Promise((r) => setTimeout(r, 1500));
		const view = window.app.workspace.getMostRecentLeaf().view;
		const nodesAfterModify = view.canvas.nodes.size;
		// Restore: protective copy first, then write checkpoint over the canvas.
		await adapter.write(`${ckpt}/before-restore.canvas`, await adapter.read(cp));
		await window.app.vault.modify(window.app.vault.getAbstractFileByPath(cp), await adapter.read(`${ckpt}/cp1.canvas`));
		await new Promise((r) => setTimeout(r, 2500));
		const nodesAfterRestore = window.app.workspace.getMostRecentLeaf().view.canvas.nodes.size;
		const onDisk = JSON.parse(await adapter.read(cp));
		const hpAfter = JSON.stringify(Object.values(ctl.state.characters).map((c) => c.hp));
		return { originalNodes: JSON.parse(original).nodes.length, removedNodeId: removed?.id, nodesAfterModify, nodesAfterRestore, nodesOnDiskAfter: onDisk.nodes.length, hpBefore, hpAfter };
	}, canvasPath);
	const ok = info.nodesAfterRestore === info.originalNodes && info.nodesOnDiskAfter === info.originalNodes && info.hpBefore === info.hpAfter;
	return { status: ok ? 'PASS' : 'FAIL', did: 'Копия .canvas в .canvas-assist-checkpoints; правка холста через Vault.modify при открытом Canvas; восстановление с защитной копией; сравнение числа узлов в живом view и на диске, сравнение HP в состоянии.', result: info, limits: 'Восстановление — единственная запись плагина в .canvas (только по явной команде, с защитной копией). AC-38 («плагин не пишет в .canvas») надо уточнить: «не пишет, кроме явного восстановления».', fallback: 'Хранить игровые данные отдельно (уже так: sidecar).' };
});

// ---- S6: selected node & note link ------------------------------------------------------------
await spike('S6', 'Определение выбранного узла и связь узел↔заметка', async () => {
	await resetSelection();
	await app.eval(() => window.app.workspace.getMostRecentLeaf().view.canvas.setViewport(390, 145, 0));
	await sleep(400);
	const r = await nodeRect(fileNodeId);
	await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
	await sleep(300);
	const info = await app.eval(() => {
		const c = window.app.workspace.getMostRecentLeaf().view.canvas;
		const sel = [...c.selection];
		return { selectionSize: sel.length, ids: sel.map((n) => n.id), filePaths: sel.map((n) => n.file?.path ?? null), types: sel.map((n) => n.constructor?.name) };
	});
	// Event path: can a click-based listener see the selection without polling?
	const viaEvent = await app.eval(async () => {
		const c = window.app.workspace.getMostRecentLeaf().view.canvas;
		c.deselectAll();
		window.__selSeen = [];
		const h = () => requestAnimationFrame(() => requestAnimationFrame(() => window.__selSeen.push([...c.selection].map((n) => n.id))));
		c.wrapperEl.addEventListener('pointerup', h, true);
		window.__selRemove = () => c.wrapperEl.removeEventListener('pointerup', h, true);
		return true;
	});
	await page.mouse.click(10, r.y + r.h + 60);
	await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
	await sleep(300);
	const seen = await app.eval(() => { window.__selRemove(); return window.__selSeen; });
	const ok = info.selectionSize === 1 && /Алекс\.md$/.test(info.filePaths[0] ?? '') && seen.some((a) => a.length === 1);
	return { status: ok ? 'PASS' : 'FAIL', did: 'Реальный клик по узлу; чтение canvas.selection, node.file.path; слушатель pointerup (capture) на wrapperEl + двойной requestAnimationFrame для чтения выбора (microtask читает выбор слишком рано — Canvas обновляет selection после pointerup).', result: { ...info, viaEvent, seen }, limits: 'canvas.selection и node.file — внутренний API; отслеживание выбора через pointerup/keyup (без polling); выбор рамкой и Ctrl+A ловится keyup/pointerup.', fallback: 'Команда «Открыть в GM Cockpit» берёт файл активной заметки/узла; frontmatter canvasAssistId.' };
});

// ---- S7: GM panel width ----------------------------------------------------------------------
await spike('S7', 'Изменение ширины боковой панели и сворачивание в рельс', async () => {
	await app.eval(async () => {
		const leaf = window.app.workspace.getRightLeaf(false);
		await leaf.setViewState({ type: 'canvas-assist-panel', active: true });
		await window.app.workspace.revealLeaf(leaf);
	});
	await sleep(800);
	const w0 = await app.eval(() => window.app.workspace.rightSplit.containerEl.getBoundingClientRect().width);
	const handle = await app.eval(() => {
		const el = window.app.workspace.rightSplit.containerEl.parentElement.querySelector('.workspace-leaf-resize-handle');
		const hs = [...document.querySelectorAll('.workspace-split.mod-right-split, .mod-right-split')];
		const r = window.app.workspace.rightSplit.containerEl.getBoundingClientRect();
		return { found: !!el, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, splits: hs.length };
	});
	// Drag the left edge of the right sidebar.
	const edgeX = handle.rect.x;
	await page.mouse.move(edgeX + 1, 300);
	await page.mouse.down();
	await page.mouse.move(edgeX - 80, 300, { steps: 8 });
	await page.mouse.up();
	await sleep(500);
	const w1 = await app.eval(() => window.app.workspace.rightSplit.containerEl.getBoundingClientRect().width);
	// Programmatic widths.
	const prog = await app.eval(async () => {
		const s = window.app.workspace.rightSplit;
		const out = {};
		for (const w of [340, 380, 420]) {
			s.setSize ? s.setSize(w) : (s.size = w);
			await new Promise((r) => setTimeout(r, 200));
			out[w] = s.containerEl.getBoundingClientRect().width;
		}
		s.collapse();
		await new Promise((r) => setTimeout(r, 400));
		out.collapsedWidth = s.containerEl.getBoundingClientRect().width;
		s.expand();
		return out;
	});
	await app.screenshot('spike-s7-panel');
	const dragOk = Math.abs(w1 - w0 - 80) < 25;
	const progOk = [340, 380, 420].every((w) => Math.abs(prog[w] - w) < 4);
	return { status: dragOk && progOk ? 'PASS' : progOk || dragOk ? 'PARTIAL' : 'FAIL', did: 'Открыта панель Canvas Assist в правой боковой панели; перетаскивание левого края мышью; setSize(340/380/420); collapse/expand.', result: { initialWidth: w0, afterDrag: w1, handle, programmatic: prog }, limits: 'Рельс 40 px: у штатного сворачивания ширина 0 — рельс потребует собственной узкой панели.', fallback: 'Фиксированные ширины 340/380/420 в настройках.' };
});

writeFileSync(join(OUT, 'spikes.json'), JSON.stringify({ obsidian: await app.eval(() => navigator.userAgent), window: win, boundsError: app.boundsError ?? null, results, pluginErrors: app.pluginErrors() }, null, 2));
await app.close();
console.log(results.map((r) => `${r.id} ${r.status}`).join(' | '));
