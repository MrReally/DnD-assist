#!/usr/bin/env node
// Real Obsidian desktop E2E for Canvas Assist (AC-01…AC-45). No manual clicks: everything is driven
// over CDP inside an isolated temporary vault/profile. Results: tests/e2e/out/results.json + .md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createSandbox, launchTrusted, obsidianBinary, ObsidianApp, OUT, PLUGIN_ID, REPO, sleep } from './lib.mjs';

// Re-exec under Xvfb when no display is available (Linux CI).
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.CA_E2E_CHILD) {
	const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
	if (xvfb) {
		const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, CA_E2E_CHILD: '1' } });
		process.exit(r.status ?? 1);
	}
}

mkdirSync(OUT, { recursive: true });
rmSync(join(OUT, 'screenshots'), { recursive: true, force: true });
const results = [];
const started = Date.now();
const A = 'Приключение А';
const B = 'Приключение Б';
let app;
let sb;

function assert(cond, msg) {
	if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function step(id, title, fn) {
	const t0 = Date.now();
	try {
		const evidence = await fn();
		results.push({ id, title, status: 'PASS', ms: Date.now() - t0, evidence: evidence ?? null });
		console.log(`PASS ${id} ${title}`);
	} catch (e) {
		let shot = null;
		try {
			shot = relative(REPO, await app.screenshot(`fail-${id}`));
		} catch {
			shot = null;
		}
		results.push({ id, title, status: 'FAIL', ms: Date.now() - t0, error: String(e?.stack ?? e).slice(0, 2000), screenshot: shot });
		console.log(`FAIL ${id} ${title}\n  ${String(e?.message ?? e)}`);
		await closeModals();
	}
}

function blocked(id, title, reason) {
	results.push({ id, title, status: 'BLOCKED', reason });
	console.log(`BLOCKED ${id} ${title}: ${reason}`);
}

function notRun(id, title, reason) {
	results.push({ id, title, status: 'NOT_RUN', reason });
	console.log(`NOT_RUN ${id} ${title}: ${reason}`);
}

const page = () => app.page;
const tid = (id) => `[data-testid="${id}"]`;

async function closeModals() {
	for (let i = 0; i < 5; i++) {
		const n = await page().locator('.modal-container').count().catch(() => 0);
		if (!n) return;
		await page().keyboard.press('Escape').catch(() => undefined);
		await sleep(200);
	}
}

async function state() {
	return app.eval(() => {
		const s = window.canvasAssist?.ctl?.state;
		return s ? JSON.parse(JSON.stringify(s)) : null;
	});
}

async function storeInfo() {
	return app.eval(() => window.canvasAssist?.ctl?.store?.info ?? null);
}

async function waitFor(fn, msg, timeout = 8000) {
	const deadline = Date.now() + timeout;
	let last;
	while (Date.now() < deadline) {
		try {
			last = await fn();
			if (last) return last;
		} catch (e) {
			last = e;
		}
		await sleep(150);
	}
	throw new Error(`timeout: ${msg} (${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 300)})`);
}

async function waitSaved() {
	await waitFor(async () => (await storeInfo())?.status === 'saved', 'state saved');
}

function stateFile(adv) {
	return join(sb.vault, adv, '.canvas-assist-state.json');
}

function sha(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listTree(dir, base = dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === '.obsidian') continue;
		const p = join(dir, name);
		const st = statSync(p);
		out.push(`${st.isDirectory() ? 'D' : 'F'} ${relative(base, p)}`);
		if (st.isDirectory()) listTree(p, base, out);
	}
	return out.sort();
}

function folders(dir) {
	return listTree(dir).filter((l) => l.startsWith('D '));
}

function vaultHashes(dir) {
	return listTree(dir)
		.filter((l) => l.startsWith('F '))
		.map((l) => `${l} ${sha(join(dir, l.slice(2)))}`);
}

/** Records every vault write with whether the call stack contains plugin code. */
async function installWriteSpy() {
	await app.eval(() => {
		if (window.__writeSpy) return;
		window.__writeSpy = [];
		const wrap = (obj, name, pathOf) => {
			const orig = obj[name].bind(obj);
			obj[name] = (...args) => {
				const stack = new Error().stack ?? '';
				window.__writeSpy.push({ fn: name, path: pathOf(args), byPlugin: /plugin:canvas-assist/.test(stack) });
				return orig(...args);
			};
		};
		const v = window.app.vault;
		wrap(v, 'modify', (a) => a[0]?.path);
		wrap(v, 'process', (a) => a[0]?.path);
		wrap(v, 'create', (a) => a[0]);
		wrap(v.adapter, 'write', (a) => a[0]);
		wrap(v.adapter, 'process', (a) => a[0]);
	});
}

async function openCanvas(path) {
	await app.openFile(path);
	await waitFor(() => app.eval((p) => window.canvasAssist?.ctl?.activeCanvas?.path === p, path), `active canvas ${path}`);
	await sleep(400);
}

async function click(selector, opts = {}) {
	await page().locator(selector).first().click(opts);
	await sleep(250);
}

async function fill(selector, value, commit = true) {
	const loc = page().locator(selector).first();
	await loc.fill(String(value));
	if (commit) {
		await loc.dispatchEvent('change');
		await sleep(250);
	}
}

/** Puts keyboard focus on the canvas surface (not an input) so contextual hotkeys apply. */
async function focusCanvas() {
	await app.eval(() => {
		const leaf = window.app.workspace.getLeavesOfType('canvas').find((l) => l === window.canvasAssist.ctl.activeCanvasLeaf);
		if (leaf) window.app.workspace.setActiveLeaf(leaf, { focus: true });
		document.activeElement?.blur?.();
		leaf?.view?.containerEl?.querySelector('.canvas-wrapper')?.focus?.();
	});
	await sleep(150);
}

/** Navigator is collapsed by default; open it for navigation tests. */
async function ensureNav() {
	const collapsed = await app.eval(() => window.canvasAssist.ctl.settings.navigatorCollapsed);
	if (collapsed) await click('.ca-overlay:not(.ca-inactive) [data-testid="bar-nav"]');
	await waitFor(() => page().locator('.ca-overlay:not(.ca-inactive) [data-testid="nav-search"]').count(), 'navigator open');
	await sleep(300);
}

async function press(keys) {
	await page().keyboard.press(keys);
	await sleep(300);
}

async function numberModal(value) {
	await waitFor(() => page().locator(tid('number-input')).count(), 'number modal');
	await page().locator(tid('number-input')).fill(String(value));
	await page().keyboard.press('Enter');
	await waitFor(async () => (await page().locator(tid('number-input')).count()) === 0, 'number modal closed');
	await waitSaved();
}

async function openPanelTab(tab) {
	await app.eval(() => window.app.commands.executeCommandById('canvas-assist:open-panel'));
	await waitFor(() => page().locator(tid(`tab-${tab}`)).count(), `panel tab ${tab}`);
	await click(tid(`tab-${tab}`));
}

async function chipOrder() {
	return app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-testid="combatant-chip"]')].map((c) => c.dataset.name));
}

async function menuClick(text) {
	await waitFor(() => page().locator('.menu .menu-item').count(), 'menu');
	await page().locator('.menu .menu-item', { hasText: text }).first().click();
	await sleep(300);
}

async function chip(name) {
	return page().locator(`.ca-overlay:not(.ca-inactive) [data-testid="combatant-chip"][data-name="${name}"]`).first();
}

async function activeName() {
	return app.eval(() => document.querySelector('.ca-overlay:not(.ca-inactive) [data-testid="bar-active"]')?.textContent ?? null);
}

function ch(s, name) {
	return Object.values(s.characters).find((c) => c.name === name);
}

function cmb(s, name) {
	return Object.values(s.activeEncounter?.combatants ?? {}).find((c) => c.displayName === name);
}

async function selectImportFile(path) {
	await page().locator(tid('import-file')).selectOption(path);
	await waitFor(async () => (await page().locator(tid('import-item')).count()) > 0 || (await page().locator(tid('import-fatal')).count()) > 0, 'import analyzed');
}

// ---------------------------------------------------------------------------------------------
async function main() {
	const bin = obsidianBinary();
	if (!bin) {
		blocked('E2E', 'REAL_OBSIDIAN_E2E', 'Obsidian desktop binary not found; set OBSIDIAN_BIN');
		return;
	}
	sb = createSandbox('main');
	const foldersBefore = folders(sb.vault);
	const canvasHashesBefore = listTree(sb.vault).filter((l) => l.endsWith('.canvas')).map((l) => `${l} ${sha(join(sb.vault, l.slice(2)))}`);
	app = await launchTrusted(sb);
	const obsVersion = await app.eval(() => window.electron?.ipcRenderer?.sendSync?.('version') ?? navigator.userAgent);
	results.push({ id: 'ENV', title: 'Окружение', status: 'INFO', evidence: { obsidian: obsVersion, binary: bin, os: `${process.platform} ${process.arch}`, node: process.version, userAgent: await app.eval(() => navigator.userAgent) } });

	await step('BOOT', 'Плагин загружается в реальном Obsidian', async () => {
		const r = await app.enablePlugin();
		assert(r.loaded, 'plugin not loaded');
		await installWriteSpy();
		await sleep(500);
		return r;
	});

	await step('AC-03+AC-43', 'Подключение приключения А: миграция v1→v2 с резервной копией, без новых папок', async () => {
		await openCanvas(`${A}/Холсты/01.canvas`);
		const original = readFileSync(stateFile(A), 'utf8');
		await click(tid('bar-register'));
		await waitFor(() => page().locator(tid('reg-submit')).count(), 'register modal');
		await click(tid('reg-submit'));
		await waitFor(async () => (await state())?.adventureId === 'adv-A', 'adventure A active');
		const migrated = JSON.parse(readFileSync(stateFile(A), 'utf8'));
		assert(migrated.schemaVersion === 2, 'schema v2 on disk');
		const backups = readdirSync(join(sb.vault, A)).filter((f) => f.startsWith('.canvas-assist-state.backup-v1-'));
		assert(backups.length === 1, 'one backup');
		assert(readFileSync(join(sb.vault, A, backups[0]), 'utf8') === original, 'backup is byte-identical to v1 original');
		assert(JSON.stringify(folders(sb.vault)) === JSON.stringify(foldersBefore), 'no new folders');
		return { backup: backups[0], characters: Object.keys(migrated.characters) };
	});

	await step('REG-B', 'Подключение приключения Б (то же имя персонажа, другой ID)', async () => {
		await openCanvas(`${B}/Холсты/01.canvas`);
		await click(tid('bar-register'));
		await click(tid('reg-submit'));
		await waitFor(async () => (await state())?.adventureId === 'adv-B', 'adventure B active');
		const s = await state();
		assert(ch(s, 'Алекс').id === 'adv-B-pc-alex' && ch(s, 'Алекс').hp.current === 7, 'B Алекс');
		return { alex: ch(s, 'Алекс') };
	});

	await step('AC-01', 'Изоляция A/B: урон Алексу в A не меняет ни байта в B; автопереключение', async () => {
		await openCanvas(`${A}/Холсты/01.canvas`);
		assert((await page().locator(tid('bar-adventure')).first().textContent()) === A, 'bar shows A');
		const bBefore = sha(stateFile(B));
		await openPanelTab('party');
		await page().locator('[data-testid="char-card"][data-name="Алекс"] [aria-label="Выбрать целью"]').click();
		await focusCanvas();
		await press('Shift+KeyD');
		await numberModal(5);
		const s = await state();
		assert(ch(s, 'Алекс').hp.current === 12, `A Алекс hp ${ch(s, 'Алекс').hp.current}`);
		assert(sha(stateFile(B)) === bBefore, 'B state bytes unchanged');
		await openCanvas(`${B}/Холсты/02.canvas`);
		const sb2 = await state();
		assert(sb2.adventureId === 'adv-B' && ch(sb2, 'Алекс').hp.current === 7, 'auto-switch to B, hp 7');
		return { aHp: 12, bHp: 7, bSha: bBefore };
	});

	await step('AC-02', 'Несколько Canvas одного приключения: общее состояние, навигатор перестраивается', async () => {
		await openCanvas(`${A}/Холсты/01.canvas`);
		await ensureNav();
		const nodes1 = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"]')].map((n) => n.dataset.node));
		await openCanvas(`${A}/Холсты/02.canvas`);
		await sleep(500);
		const nodes2 = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"]')].map((n) => n.dataset.node));
		const s = await state();
		assert(ch(s, 'Алекс').hp.current === 12, 'hp unchanged across canvases');
		assert(nodes1.includes('node-01') && !nodes2.includes('node-01') && nodes2.includes('node-05'), `navigator rebuilt ${nodes1} / ${nodes2}`);
		return { nodes1, nodes2 };
	});

	const complex = `${A}/Холсты/03 сложный, тест — ё.canvas`;
	await step('AC-04', 'Русский поиск: гоб / ГоБ / ё=е, частичные совпадения', async () => {
		await openCanvas(complex);
		await focusCanvas();
		await press('Shift+KeyF');
		const focused = await app.eval(() => document.activeElement?.dataset?.testid);
		assert(focused === 'nav-search', `Shift+F focuses search (${focused})`);
		const firstFor = async (q) => {
			await page().locator(tid('nav-search')).first().fill(q);
			await sleep(150);
			return app.eval(() => document.querySelector('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"]')?.dataset.node ?? null);
		};
		const r = { 'гоб': await firstFor('гоб'), 'ГоБ': await firstFor('ГоБ'), 'елкин': await firstFor('елкин'), 'шепот': await firstFor('шепот'), 'таверна еж': await firstFor('таверна еж') };
		assert(r['гоб'] === 'n-gob' && r['ГоБ'] === 'n-gob', 'goblin');
		assert(r['елкин'] === 'n-star', 'ё folding (Ёлкин)');
		assert(r['шепот'] === 'n-hb', 'ё folding in text');
		const dupes = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"]')].map((n) => n.dataset.node));
		assert(dupes.includes('n-dup1') && dupes.includes('n-dup2'), 'duplicates both listed');
		return r;
	});

	await step('AC-37', 'Горячие клавиши не срабатывают при вводе текста', async () => {
		// Focus is in the navigator search input: Shift+D must type, not open the damage modal.
		await page().locator(tid('nav-search')).first().focus();
		await press('Shift+KeyD');
		const modal = await page().locator(tid('number-input')).count();
		const value = await page().locator(tid('nav-search')).first().inputValue();
		assert(modal === 0, 'no damage modal while typing');
		assert(value.endsWith('D'), `letter typed (${value})`);
		await page().locator(tid('nav-search')).first().fill('');
		return { typed: value };
	});

	await step('AC-06', 'Навигация: фокус и выделение узла через проверенный Canvas Adapter', async () => {
		await page().locator(tid('nav-search')).first().fill('староста');
		await sleep(150);
		await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"]').first().click();
		await sleep(600);
		const sel = await app.eval(() => {
			const c = window.canvasAssist.ctl.activeCanvasView()?.canvas;
			return c ? [...c.selection].map((n) => n.id) : null;
		});
		assert(sel && sel.length === 1 && sel[0] === 'n-star', `selection ${JSON.stringify(sel)}`);
		const centered = await app.eval(() => {
			const c = window.canvasAssist.ctl.activeCanvasView().canvas;
			const node = c.nodes.get('n-star');
			const bb = node.getBBox();
			const cx = (bb.minX + bb.maxX) / 2;
			const cy = (bb.minY + bb.maxY) / 2;
			return { cx, cy, tx: c.tx ?? c.x, ty: c.ty ?? c.y };
		});
		return { selection: sel, centered };
	});

	await step('AC-06-fallback', 'Навигация при недоступном Canvas API: запасной путь не ломает Canvas', async () => {
		const tabsBefore = await app.eval(() => window.app.workspace.getLeavesOfType('markdown').length);
		await app.eval(() => {
			const c = window.canvasAssist.ctl.activeCanvasView().canvas;
			window.__savedSelectOnly = c.selectOnly;
			c.selectOnly = undefined;
		});
		await page().locator(tid('nav-search')).first().fill('гоблин');
		await sleep(150);
		await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"][data-node="n-gob"]').first().click();
		await sleep(800);
		const tabsAfter = await app.eval(() => window.app.workspace.getLeavesOfType('markdown').length);
		await app.eval(() => {
			const leaf = window.app.workspace.getLeavesOfType('canvas')[0];
			leaf.view.canvas.selectOnly = window.__savedSelectOnly;
			window.app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach());
			window.app.workspace.setActiveLeaf(leaf, { focus: true });
		});
		await sleep(500);
		assert(tabsAfter === tabsBefore + 1, 'note opened via public API as fallback');
		const nodes = await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size);
		assert(nodes > 10, 'canvas still intact');
		return { tabsBefore, tabsAfter, canvasNodes: nodes };
	});

	await step('AC-05', 'Типизация: группа NPC → NPC; ручной override; Ignore исключается', async () => {
		await openCanvas(complex);
		await page().locator(tid('nav-search')).first().fill('');
		await sleep(200);
		const cat = await app.eval(() => {
			const idx = window.canvasAssist.ctl.lastIndex;
			return Object.fromEntries(idx.items.map((i) => [i.nodeId, i.category]));
		});
		assert(cat['n-gob'] === 'npc' && cat['n-star'] === 'npc' && cat['n-loot1'] === 'loot' && cat['n-plot'] === 'plot' && cat['n-hb'] === 'homebrew', JSON.stringify(cat));
		await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"][data-node="n-gob"]').first().click({ button: 'right' });
		await menuClick('Игнорировать');
		await waitSaved();
		await page().locator(tid('nav-search')).first().fill('гоб');
		await sleep(200);
		const visible = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"]')].map((n) => n.dataset.node));
		assert(!visible.includes('n-gob'), 'ignored node hidden from search');
		const s = await state();
		const rel = '03 сложный, тест — ё.canvas';
		const ov = Object.entries(s.nodeOverrides).find(([k]) => k.endsWith(rel));
		assert(ov && ov[1]['n-gob'] === 'ignore', 'override stored in adventure state');
		await page().locator(tid('nav-filter-ignore')).first().click();
		await sleep(200);
		await page().locator(tid('nav-search')).first().fill('гоб');
		await sleep(200);
		const withIgnored = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"]')].map((n) => n.dataset.node));
		assert(withIgnored.includes('n-gob'), 'visible with Ignore filter');
		await page().locator(tid('nav-filter-ignore')).first().click();
		await page().locator(tid('nav-search')).first().fill('');
		return { categories: cat, override: ov[1] };
	});

	await step('AC-45-nav', 'Ссылка на отсутствующую заметку помечена «источник недоступен»', async () => {
		const missing = await app.eval(() => document.querySelector('.ca-overlay:not(.ca-inactive) [data-testid="nav-item"][data-node="n-missing"]')?.className ?? '');
		assert(missing.includes('is-missing'), 'missing marked');
		return { className: missing };
	});

	// ---------------- Import ----------------
	const snapshotBeforeInvalid = () => vaultHashes(sb.vault).filter((l) => !l.includes('.canvas-assist-state'));
	await step('AC-11', 'Ошибочный JSON: сообщение с полем; ничего в хранилище не изменилось', async () => {
		await openCanvas(`${A}/Холсты/01.canvas`);
		const before = snapshotBeforeInvalid();
		const stateBefore = sha(stateFile(A));
		await app.command('canvas-assist:import-json');
		await selectImportFile('Импорт/invalid-syntax.json');
		const fatal = await page().locator(tid('import-fatal')).first().textContent();
		assert(/Синтаксическая ошибка JSON/.test(fatal), fatal);
		await selectImportFile('Импорт/invalid-values.json');
		const errors = await app.eval(() => [...document.querySelectorAll('[data-testid="import-item"] .ca-error')].map((e) => e.textContent));
		assert(errors.some((e) => e.startsWith('$.hitPoints.max')), JSON.stringify(errors));
		const applyDisabled = await page().locator(tid('import-apply')).first().isDisabled();
		assert(applyDisabled, 'import disabled for invalid data');
		await selectImportFile('Импорт/unknown-version.json');
		await closeModals();
		assert(JSON.stringify(snapshotBeforeInvalid()) === JSON.stringify(before), 'vault unchanged');
		assert(sha(stateFile(A)) === stateBefore, 'state unchanged');
		return { fatal, errors };
	});

	await step('AC-08', 'Импорт JSON создаёт Markdown в Elements/Персонажи со стабильным ID', async () => {
		await app.command('canvas-assist:import-json');
		await selectImportFile('Импорт/valid-full.json');
		const reason = await page().locator('[data-testid="import-item"] .ca-muted').first().textContent();
		await page().locator(tid('import-mode')).first().selectOption('create');
		await sleep(200);
		await click(tid('import-apply'));
		await waitFor(() => page().locator(tid('import-report')).count(), 'report');
		const report = await page().locator(tid('import-report')).textContent();
		await closeModals();
		const path = join(sb.vault, A, 'Elements', 'Персонажи', 'Мира 2.md');
		assert(existsSync(path), 'note created');
		const note = readFileSync(path, 'utf8');
		assert(note.startsWith('---\ncanvasAssistId: pc-mira-import\n---'), 'frontmatter id');
		const s = await state();
		const m = s.characters['pc-mira-import'];
		assert(m && m.notePath === 'Elements/Персонажи/Мира 2.md' && m.hp.max === 20 && m.hp.current === 9, JSON.stringify(m));
		assert(s.parties.find((p) => p.id === s.activePartyId).characterIds.includes('pc-mira-import'), 'added to party');
		return { reason, report, notePreview: note.slice(0, 240) };
	});

	await step('AC-09', 'Частичный лист: неизвестное остаётся пустым', async () => {
		await app.command('canvas-assist:import-json');
		await selectImportFile('Импорт/partial.json');
		await click(tid('import-apply'));
		await waitFor(() => page().locator(tid('import-report')).count(), 'report');
		await closeModals();
		const s = await state();
		const b = ch(s, 'Бор Неполный');
		assert(b && b.hp.max === null && b.initiativeModifier === null && b.speedFeet === null && b.ac === 14, JSON.stringify(b));
		const note = readFileSync(join(sb.vault, A, 'Elements', 'Персонажи', 'Бор Неполный.md'), 'utf8');
		assert(note.includes('**Инициатива:** —') && note.includes('**Максимум хитов:** —'), 'empty in markdown');
		return { character: b };
	});

	await step('AC-10', 'Повторный импорт (повышение уровня): максимум меняется, текущие HP и ячейки сохраняются', async () => {
		const path = join(sb.vault, A, 'Elements', 'Персонажи', 'Мира 2.md');
		// User adds own notes outside of the managed block (via Obsidian API).
		await app.eval(async (p) => {
			const f = window.app.vault.getAbstractFileByPath(p);
			await window.app.vault.process(f, (t) => `${t}\nЛичная заметка мастера: не трогать.\n`);
		}, `${A}/Elements/Персонажи/Мира 2.md`);
		await app.command('canvas-assist:import-json');
		await selectImportFile('Импорт/levelup.json');
		const diff = await page().locator('[data-testid="import-item"] .ca-diff').first().textContent();
		await click(tid('import-apply'));
		await waitFor(() => page().locator(tid('import-report')).count(), 'report');
		await closeModals();
		const s = await state();
		const m = s.characters['pc-mira-import'];
		assert(m.hp.max === 26 && m.hp.current === 9, `hp ${JSON.stringify(m.hp)}`);
		assert(m.spellSlots['1'].current === 2 && m.spellSlots['1'].max === 4 && m.spellSlots['2'].max === 3, JSON.stringify(m.spellSlots));
		assert(m.classes[0].level === 4, 'level 4');
		const note = readFileSync(path, 'utf8');
		assert(note.includes('Личная заметка мастера: не трогать.'), 'user text preserved');
		assert(note.includes('Волшебник 4'), 'block updated');
		return { diff, hp: m.hp, slots: m.spellSlots };
	});

	await step('AC-44-import', 'HTML/JS из JSON не исполняется и не рендерится', async () => {
		await app.command('canvas-assist:import-json');
		await selectImportFile('Импорт/html-injection.json');
		const warnings = await app.eval(() => document.querySelectorAll('[data-testid="import-item"] .ca-warn').length);
		await click(tid('import-apply'));
		await waitFor(() => page().locator(tid('import-report')).count(), 'report');
		await closeModals();
		const file = readdirSync(join(sb.vault, A, 'Elements', 'Персонажи')).find((f) => f.startsWith('Хакер'));
		assert(file && !/[<>]/.test(file), `safe filename ${file}`);
		await app.eval(() => { window.__xss = 0; });
		await app.openFile(`${A}/Elements/Персонажи/${file}`);
		await app.eval(async () => {
			const leaf = window.app.workspace.getMostRecentLeaf();
			await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.getViewState().state, mode: 'preview' } });
		});
		await sleep(800);
		const dom = await app.eval(() => {
			const v = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view') ?? document.querySelector('.markdown-preview-view');
			return { scripts: v?.querySelectorAll('script').length ?? -1, imgs: v?.querySelectorAll('img').length ?? -1, bold: v?.querySelectorAll('b').length ?? -1, text: v?.textContent?.slice(0, 300), xss: window.__xss };
		});
		assert(dom.scripts === 0 && dom.imgs === 0 && dom.bold === 0, JSON.stringify(dom));
		await app.eval(() => window.app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach()));
		await openCanvas(`${A}/Холсты/01.canvas`);
		return { warnings, file, dom };
	});

	// ---------------- Resources ----------------
	await step('AC-12a', 'Персональные ресурсы: временные хиты, ячейки, свободный счётчик сохраняются', async () => {
		await openPanelTab('party');
		await page().locator('[data-testid="char-card"][data-name="Мира"] .ca-char-head strong').first().click();
		await sleep(300);
		await fill(tid('temp-Мира'), 3);
		await waitSaved();
		await fill(tid('slot-Мира-1'), 1);
		await waitSaved();
		await click(tid('add-counter-Мира'));
		await waitSaved();
		await page().locator(tid('counter-name-Мира')).last().fill('Ки');
		await page().locator(tid('counter-name-Мира')).last().dispatchEvent('change');
		await sleep(250);
		await waitSaved();
		await fill(tid('ctr-Мира-Ки'), 2);
		await waitSaved();
		const s = await state();
		const m = s.characters['pc-mira-import'];
		const ki = Object.values(m.counters).find((c) => c.name === 'Ки');
		assert(m.hp.temporary === 3 && m.spellSlots['1'].current === 1 && ki && ki.current === 2 && ki.recovery === 'manual', JSON.stringify(m));
		const disk = JSON.parse(readFileSync(stateFile(A), 'utf8')).characters['pc-mira-import'];
		assert(disk.hp.temporary === 3, 'persisted immediately');
		return { hp: m.hp, slot1: m.spellSlots['1'], counter: ki };
	});

	// ---------------- Templates / combat ----------------
	let firstEncounterIds;
	await step('AC-13', 'Шаблон боя запускается дважды: новые ID, шаблон неизменен', async () => {
		await openPanelTab('templates');
		await click(tid('panel-new-template'));
		await fill(tid('tpl-name'), 'Засада гоблинов', false);
		await click(tid('tpl-add-entry'));
		await fill(tid('tpl-entry-name-0'), 'Гоблин', false);
		await fill(tid('tpl-entry-count-0'), 5, false);
		await fill(tid('tpl-entry-hp-0'), 7, false);
		await page().locator(tid('tpl-entry-url-0')).fill('https://5e14.ttg.club/bestiary/goblin');
		await click(tid('tpl-save'));
		await waitSaved();
		let s = await state();
		const tplBefore = JSON.stringify(s.encounterTemplates);
		assert(s.encounterTemplates.length === 1, 'template saved');
		await click(tid('template-launch'));
		await waitSaved();
		s = await state();
		firstEncounterIds = { enc: s.activeEncounter.id, cmb: Object.keys(s.activeEncounter.combatants) };
		await click(tid('bar-end'));
		await click(tid('confirm-ok'));
		await waitSaved();
		await openPanelTab('templates');
		await click(tid('template-launch'));
		await waitSaved();
		s = await state();
		const second = { enc: s.activeEncounter.id, cmb: Object.keys(s.activeEncounter.combatants) };
		assert(firstEncounterIds.enc !== second.enc, 'new encounterId');
		assert(!second.cmb.some((id) => firstEncounterIds.cmb.includes(id)), 'new combatantIds');
		assert(JSON.stringify(s.encounterTemplates) === tplBefore, 'template unchanged');
		return { first: firstEncounterIds, second };
	});

	await step('AC-14', 'Пять одинаковых монстров: номера и независимые HP', async () => {
		const names = await chipOrder();
		for (let i = 1; i <= 5; i++) assert(names.includes(`Гоблин ${i}`), `Гоблин ${i} chip`);
		const s = await state();
		const gobs = Object.values(s.activeEncounter.combatants).filter((c) => c.displayName.startsWith('Гоблин'));
		assert(gobs.length === 5 && new Set(gobs.map((g) => g.id)).size === 5 && gobs.every((g) => g.hp.current === 7 && g.initiativeGroupId === null), 'independent');
		return { names };
	});

	await step('AC-15+AC-17', 'Индивидуальная инициатива и стабильный порядок при равенстве', async () => {
		await openPanelTab('combat');
		const inits = { 'Гоблин 1': 3, 'Гоблин 2': 18, 'Гоблин 3': 11, 'Гоблин 4': 7, 'Гоблин 5': 15, 'Алекс': 12, 'Мира': 12 };
		for (const [n, v] of Object.entries(inits)) {
			if (!(await page().locator(tid(`init-${n}`)).count())) continue;
			await fill(tid(`init-${n}`), v);
			await waitSaved();
		}
		const pcs = (await state()).activeEncounter;
		const extra = Object.values(pcs.combatants).filter((c) => c.initiative === null).map((c) => c.displayName);
		for (const n of extra) {
			await fill(tid(`init-${n}`), 1);
			await waitSaved();
		}
		await sleep(300);
		const order = await chipOrder();
		const expectedPrefix = ['Гоблин 2', 'Гоблин 5', 'Алекс', 'Мира', 'Гоблин 3', 'Гоблин 4', 'Гоблин 1'];
		assert(JSON.stringify(order.filter((n) => expectedPrefix.includes(n))) === JSON.stringify(expectedPrefix), `order ${order}`);
		(await chip('Мира')).click({ button: 'right' });
		await menuClick('Раньше при равенстве');
		await waitSaved();
		await sleep(300);
		const swapped = await chipOrder();
		assert(swapped.indexOf('Мира') < swapped.indexOf('Алекс'), `manual tie order ${swapped}`);
		await openPanelTab('party');
		await openPanelTab('combat');
		const again = await chipOrder();
		assert(again.indexOf('Мира') < again.indexOf('Алекс'), 'tie order persists');
		return { order, swapped };
	});

	await step('AC-16', 'Общая инициатива группы: общий ход, раздельные HP', async () => {
		await page().locator('[data-testid="cmb-row"][data-name="Гоблин 4"] input[type=checkbox]').check();
		await page().locator('[data-testid="cmb-row"][data-name="Гоблин 1"] input[type=checkbox]').check();
		await click(tid('panel-group'));
		await waitSaved();
		const s = await state();
		const g4 = cmb(s, 'Гоблин 4');
		const g1 = cmb(s, 'Гоблин 1');
		assert(g4.initiativeGroupId && g4.initiativeGroupId === g1.initiativeGroupId, 'grouped');
		const groupDom = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) .ca-group [data-testid="combatant-chip"]')].map((c) => c.dataset.name));
		assert(groupDom.length === 2, `group chips ${groupDom}`);
		await (await chip('Гоблин 4')).click();
		await focusCanvas();
		await press('Shift+KeyD');
		await numberModal(2);
		const s2 = await state();
		assert(cmb(s2, 'Гоблин 4').hp.current === 5 && cmb(s2, 'Гоблин 1').hp.current === 7, 'separate HP');
		return { group: groupDom };
	});

	await step('AC-18', 'Раунд: после последнего «Next» +1 ровно один раз; «Previous» возвращает', async () => {
		await click(tid('bar-next')); // begin
		await waitSaved();
		let s = await state();
		assert(s.activeEncounter.round === 1, 'round 1');
		const slots = await app.eval(() => document.querySelectorAll('.ca-overlay:not(.ca-inactive) .ca-ribbon > [data-testid="combatant-chip"], .ca-overlay:not(.ca-inactive) .ca-ribbon > .ca-group').length);
		for (let i = 0; i < slots - 1; i++) {
			await click(tid('bar-next'));
			await waitSaved();
		}
		s = await state();
		assert(s.activeEncounter.round === 1, 'still round 1 at last slot');
		const lastActive = await activeName();
		await click(tid('bar-next'));
		await waitSaved();
		s = await state();
		assert(s.activeEncounter.round === 2, 'round 2');
		assert((await page().locator(tid('bar-round')).first().textContent()) === 'Раунд 2', 'bar shows round 2');
		await click(tid('bar-prev'));
		await waitSaved();
		s = await state();
		assert(s.activeEncounter.round === 1 && (await activeName()) === lastActive, 'previous restored');
		await click(tid('bar-next'));
		await waitSaved();
		return { slots, lastActive };
	});

	await step('AC-19+AC-20', 'Shift+D по выбранной цели не меняет активного; число вводится вручную', async () => {
		const before = await activeName();
		await (await chip('Гоблин 3')).click();
		await waitFor(async () => (await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="target-name"]').first().textContent()) === 'Цель: Гоблин 3', 'target selected');
		await focusCanvas();
		await press('Shift+KeyD');
		await numberModal(4);
		const s = await state();
		assert(cmb(s, 'Гоблин 3').hp.current === 3, 'damage applied');
		assert((await activeName()) === before, 'active unchanged');
		return { active: before };
	});

	await step('AC-21', 'Нулевые HP: участник остаётся, эффект не исчезает', async () => {
		await (await chip('Гоблин 3')).click();
		await focusCanvas();
		await press('Shift+KeyE');
		await waitFor(() => page().locator(tid('effect-submit')).count(), 'effect modal');
		await page().locator(tid('effect-condition')).selectOption('poisoned');
		await page().locator(tid('effect-duration-kind')).selectOption('manual');
		await click(tid('effect-submit'));
		await waitSaved();
		await press('Shift+KeyD');
		await numberModal(50);
		const s = await state();
		const g3 = cmb(s, 'Гоблин 3');
		assert(g3 && g3.hp.current === 0 && !g3.defeated, 'still in combat');
		assert(Object.values(s.effects).some((e) => e.target.id === g3.id && e.conditionId === 'poisoned'), 'effect kept');
		assert((await chipOrder()).includes('Гоблин 3'), 'chip visible');
		return { hp: g3.hp };
	});

	await step('AC-22', '«3 конца собственных ходов» при наложении в чужой ход', async () => {
		let s = await state();
		const enc = s.activeEncounter;
		const activeId = enc.activeSlotId;
		// Pick a target that is not the active participant and not grouped.
		const target = Object.values(enc.combatants).find((c) => c.id !== activeId && !c.initiativeGroupId && c.displayName === 'Гоблин 5');
		await (await chip(target.displayName)).click();
		await focusCanvas();
		await press('Shift+KeyE');
		await waitFor(() => page().locator(tid('effect-submit')).count(), 'effect modal');
		await page().locator(tid('effect-condition')).selectOption('frightened');
		await page().locator(tid('effect-duration-kind')).selectOption('turns');
		await page().locator(tid('effect-owner')).selectOption(target.id);
		await page().locator(tid('effect-phase')).selectOption('end');
		await page().locator(tid('effect-count')).fill('3');
		await click(tid('effect-submit'));
		await waitSaved();
		s = await state();
		const eff = Object.values(s.effects).find((e) => e.target.id === target.id && e.conditionId === 'frightened');
		assert(eff && eff.duration.remaining === 3, 'created');
		const history = [];
		let ends = 0;
		for (let i = 0; i < 40 && ends < 3; i++) {
			const before = await state();
			const wasActive = before.activeEncounter.activeSlotId === target.id;
			await click(tid('bar-next'));
			await waitSaved();
			const after = await state();
			const e = after.effects[eff.id];
			if (wasActive) {
				ends++;
				history.push({ end: ends, remaining: e ? e.duration.remaining : 0 });
			} else {
				assert(!e || e.duration.remaining === 3 - ends, `no tick on foreign events (${JSON.stringify(e?.duration)})`);
			}
		}
		s = await state();
		assert(ends === 3 && !s.effects[eff.id], `expired exactly on 3rd end ${JSON.stringify(history)}`);
		assert(history[0].remaining === 2 && history[1].remaining === 1, JSON.stringify(history));
		return { history, effectId: eff.id };
	});

	await step('AC-25', 'Undo возвращает истёкший эффект, Redo снова снимает', async () => {
		await click(tid('bar-undo'));
		await waitSaved();
		let s = await state();
		const back = Object.values(s.effects).find((e) => e.conditionId === 'frightened');
		assert(back && back.duration.remaining === 1, 'restored with remaining 1');
		await click(tid('bar-redo'));
		await waitSaved();
		s = await state();
		assert(!s.effects[back.id], 'removed again');
		return { restored: back.duration };
	});

	await step('AC-23', '«До начала следующего хода источника» — на turn-start источника', async () => {
		let s = await state();
		for (let i = 0; i < 12 && !s.activeEncounter.combatants[s.activeEncounter.activeSlotId]; i++) {
			await click(tid('bar-next'));
			await waitSaved();
			s = await state();
		}
		const enc = s.activeEncounter;
		const source = enc.combatants[enc.activeSlotId] ?? null;
		assert(source, 'active single combatant as source');
		const target = cmb(s, 'Гоблин 2').id === source.id ? cmb(s, 'Гоблин 5') : cmb(s, 'Гоблин 2');
		await (await chip(target.displayName)).click();
		await focusCanvas();
		await press('Shift+KeyE');
		await waitFor(() => page().locator(tid('effect-submit')).count(), 'effect modal');
		await page().locator(tid('effect-condition')).selectOption('restrained');
		await page().locator(tid('effect-source')).selectOption(source.id);
		await page().locator(tid('effect-duration-kind')).selectOption('until-turn');
		await page().locator(tid('effect-owner')).selectOption(source.id);
		await click(tid('effect-submit'));
		await waitSaved();
		s = await state();
		const eff = Object.values(s.effects).find((e) => e.conditionId === 'restrained');
		assert(eff && eff.duration.phase === 'start' && eff.duration.ownerCombatantId === source.id, JSON.stringify(eff?.duration));
		let roundStartSeen = false;
		for (let i = 0; i < 30; i++) {
			await click(tid('bar-next'));
			await waitSaved();
			s = await state();
			const isSourceTurn = s.activeEncounter.activeSlotId === source.id;
			if (s.activeEncounter.round > enc.round && !isSourceTurn) roundStartSeen = true;
			if (isSourceTurn) break;
			assert(s.effects[eff.id], 'not expired before source turn-start');
		}
		assert(!s.effects[eff.id], 'expired at source turn-start');
		return { source: source.displayName, roundStartPassedBeforeSourceTurn: roundStartSeen };
	});

	await step('AC-24', 'Два одинаковых состояния от разных источников: снятие одного не снимает второе', async () => {
		const s0 = await state();
		const g2 = cmb(s0, 'Гоблин 2');
		const g5 = cmb(s0, 'Гоблин 5');
		for (const src of [g2, g5]) {
			await openPanelTab('party');
			await page().locator('[data-testid="char-card"][data-name="Алекс"] [aria-label="Эффект"]').first().click();
			await waitFor(() => page().locator(tid('effect-submit')).count(), 'effect modal');
			await page().locator(tid('effect-condition')).selectOption('frightened');
			await page().locator(tid('effect-source')).selectOption(src.id);
			await page().locator(tid('effect-duration-kind')).selectOption('manual');
			await click(tid('effect-submit'));
			await waitSaved();
		}
		let s = await state();
		const frs = Object.values(s.effects).filter((e) => e.target.kind === 'character' && e.conditionId === 'frightened');
		assert(frs.length === 2 && new Set(frs.map((e) => e.sourceCombatantId)).size === 2, 'two effects');
		const pill = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-name="Алекс"] .ca-pill')].map((p) => ({ text: p.textContent, title: p.title })));
		assert(pill.some((p) => p.text.includes('×2') && p.title.split('\n').length === 2), `summary pill ${JSON.stringify(pill)}`);
		await page().locator('.ca-overlay:not(.ca-inactive) [data-name="Алекс"] .ca-pill', { hasText: 'Испуганный' }).first().click();
		await waitFor(() => page().locator(tid('effect-remove')).count(), 'edit modal');
		await click(tid('effect-remove'));
		await waitSaved();
		s = await state();
		const left = Object.values(s.effects).filter((e) => e.target.kind === 'character' && e.conditionId === 'frightened');
		assert(left.length === 1, 'one left');
		return { pill, remainingSource: left[0].sourceLabel };
	});

	await step('AC-26', 'Ручная правка эффекта (продление) не меняет историю других', async () => {
		let s = await state();
		const eff = Object.values(s.effects).find((e) => e.target.kind === 'character' && e.conditionId === 'frightened');
		const others = JSON.stringify(Object.values(s.effects).filter((e) => e.id !== eff.id));
		await page().locator('.ca-overlay:not(.ca-inactive) [data-name="Алекс"] .ca-pill', { hasText: 'Испуганный' }).first().click();
		await waitFor(() => page().locator(tid('effect-submit')).count(), 'edit modal');
		const ownerOpts = await app.eval(() => [...document.querySelectorAll('[data-testid="effect-duration-kind"] option')].map((o) => o.value));
		await page().locator(tid('effect-duration-kind')).selectOption('rounds');
		await page().locator(tid('effect-count')).fill('2');
		await click(tid('effect-submit'));
		await waitSaved();
		s = await state();
		const upd = s.effects[eff.id];
		assert(upd.duration.kind === 'rounds' && upd.duration.remaining === 2, JSON.stringify(upd.duration));
		assert(JSON.stringify(Object.values(s.effects).filter((e) => e.id !== eff.id)) === others, 'others untouched');
		return { duration: upd.duration, kinds: ownerOpts };
	});

	await step('AC-27', 'Концентрация: связь эффект↔источник; снятие без проверки правил', async () => {
		await openPanelTab('party');
		await page().locator('[data-testid="char-card"][data-name="Мира"] [aria-label="Эффект"]').first().click();
		await waitFor(() => page().locator(tid('effect-submit')).count(), 'effect modal');
		await page().locator(tid('effect-condition')).selectOption('concentration');
		await page().locator(tid('effect-label')).fill('Концентрация: Удержание личности');
		await page().locator(tid('effect-duration-kind')).selectOption('manual');
		await click(tid('effect-submit'));
		await waitSaved();
		let s = await state();
		const conc = Object.values(s.effects).find((e) => e.isConcentration);
		assert(conc, 'concentration effect');
		await (await chip('Гоблин 2')).click();
		await focusCanvas();
		await press('Shift+KeyE');
		await waitFor(() => page().locator(tid('effect-submit')).count(), 'effect modal');
		await page().locator(tid('effect-condition')).selectOption('paralyzed');
		await page().locator(tid('effect-duration-kind')).selectOption('manual');
		await page().locator('.modal-container select', { has: page().locator(`option[value="${conc.id}"]`) }).selectOption(conc.id);
		await click(tid('effect-submit'));
		await waitSaved();
		s = await state();
		const linked = Object.values(s.effects).find((e) => e.conditionId === 'paralyzed');
		assert(linked.concentrationEffectId === conc.id, 'linked');
		const hpBefore = s.characters['pc-mira-import'].hp.current;
		await page().locator('.ca-overlay:not(.ca-inactive) [data-name="Мира"] .ca-pill', { hasText: 'Концентрация' }).first().click();
		await waitFor(() => page().locator(tid('effect-remove')).count(), 'edit modal');
		await click(tid('effect-remove'));
		await waitFor(() => page().locator(tid('confirm-ok')).count(), 'confirm linked');
		await click(tid('confirm-ok'));
		await waitSaved();
		s = await state();
		assert(!s.effects[conc.id] && !s.effects[linked.id], 'both removed');
		assert(s.characters['pc-mira-import'].hp.current === hpBefore, 'no rule automation');
		return { concentration: conc.label, linked: linked.label };
	});

	await step('AC-07', 'TTG: sourceUrl открывает правильный справочник; локальные параметры без сети', async () => {
		await app.eval(() => {
			window.__opened = [];
			window.__origOpen = window.open;
			window.open = (u) => {
				window.__opened.push(String(u));
				return null;
			};
		});
		await (await chip('Гоблин 1')).click();
		await focusCanvas();
		await press('Shift+KeyK');
		await waitFor(() => page().locator(tid('card-ttg')).count(), 'card modal');
		const stats = await app.eval(() => [...document.querySelectorAll('.ca-card-modal .ca-stat')].map((s) => s.textContent));
		await click(tid('card-ttg'));
		const opened = await app.eval(() => window.__opened);
		await app.eval(() => { window.open = window.__origOpen; });
		await closeModals();
		assert(opened[0] === 'https://5e14.ttg.club/bestiary/goblin', JSON.stringify(opened));
		assert(stats.some((t) => t.includes('7/7')), JSON.stringify(stats));
		return { opened, stats };
	});

	await step('AC-38', 'Сложный Canvas: файлы .canvas не изменены плагином (неизвестные поля целы)', async () => {
		const now = listTree(sb.vault).filter((l) => l.endsWith('.canvas') && !l.includes('perf-500')).map((l) => `${l} ${sha(join(sb.vault, l.slice(2)))}`);
		const spy = await app.eval(() => window.__writeSpy);
		const pluginCanvasWrites = spy.filter((w) => w.byPlugin && /\.canvas$/.test(w.path ?? ''));
		const pluginStateWrites = spy.filter((w) => w.byPlugin && /canvas-assist-state/.test(w.path ?? ''));
		const obsidianCanvasWrites = spy.filter((w) => !w.byPlugin && /\.canvas$/.test(w.path ?? '')).map((w) => w.path);
		assert(pluginStateWrites.length > 0, 'positive control: plugin state writes are detected');
		assert(pluginCanvasWrites.length === 0, `plugin wrote canvas files: ${JSON.stringify(pluginCanvasWrites)}`);
		const changed = now.filter((l) => !canvasHashesBefore.includes(l));
		const original = JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', 'test-vault', complex), 'utf8'));
		const third = JSON.parse(readFileSync(join(sb.vault, complex), 'utf8'));
		assert(third['x-third-party'].opaque === true && JSON.stringify(third.metadata) === JSON.stringify(original.metadata), 'unknown top-level fields preserved');
		const future = third.nodes.find((n) => n.type === 'mindmap-widget');
		assert(future && JSON.stringify(future.pluginData) === JSON.stringify({ keep: [1, 2, 3] }), 'unknown node type + fields preserved');
		assert(JSON.stringify(third.nodes) === JSON.stringify(original.nodes), 'all nodes identical');
		return { pluginCanvasWrites: 0, pluginStateWrites: pluginStateWrites.length, obsidianOwnCanvasRewrites: [...new Set(obsidianCanvasWrites)], filesReformattedByObsidian: changed.length };
	});

	await step('AC-37b', 'Редактирование текстового узла Canvas: Shift+Space и Shift+F не меняют бой', async () => {
		const s0 = await state();
		await openCanvas(`${A}/Холсты/01.canvas`);
		await app.eval(() => window.app.workspace.getLeavesOfType('canvas-assist-panel').forEach((l) => l.detach()));
		await sleep(400);
		const navOpen = await app.eval(() => !window.canvasAssist.ctl.settings.navigatorCollapsed);
		if (navOpen) await click('.ca-overlay:not(.ca-inactive) [data-testid="bar-nav"]');
		const box = await app.eval(() => {
			const c = window.canvasAssist.ctl.activeCanvasView().canvas;
			const node = c.nodes.get('node-02');
			c.selectOnly(node);
			c.zoomToSelection();
			return null;
		});
		void box;
		await sleep(800);
		const rect = await app.eval(() => {
			const r = window.canvasAssist.ctl.activeCanvasView().canvas.nodes.get('node-02').nodeEl.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		});
		const hit = await app.eval(({ x, y }) => document.elementFromPoint(x, y)?.closest('.canvas-node') ? 'node' : document.elementFromPoint(x, y)?.className, rect);
		await page().mouse.dblclick(rect.x, rect.y);
		await sleep(900);
		if (hit !== 'node') throw new Error(`dblclick target is not the node: ${hit}`);
		const editing = await app.eval(() => {
			const n = window.canvasAssist.ctl.activeCanvasView().canvas.nodes.get('node-02');
			const a = document.activeElement;
			return { isEditing: !!n.isEditing, focus: a?.tagName, inNode: !!a?.closest?.('.canvas-node.is-editing') };
		});
		await page().keyboard.press('Shift+Space');
		await page().keyboard.press('Shift+KeyF');
		await sleep(400);
		const s1 = await state();
		await page().keyboard.press('Escape');
		await sleep(300);
		await app.eval(() => window.canvasAssist.ctl.activeCanvasView().canvas.deselectAll?.());
		if (navOpen) await click('.ca-overlay:not(.ca-inactive) [data-testid="bar-nav"]');
		assert(editing.isEditing && editing.inNode, `canvas text editor focused ${JSON.stringify(editing)}`);
		assert(s1.activeEncounter.round === s0.activeEncounter.round && s1.activeEncounter.activeSlotId === s0.activeEncounter.activeSlotId, 'no turn change while typing');
		const searchFocused = await app.eval(() => document.activeElement?.dataset?.testid === 'nav-search');
		assert(!searchFocused, 'search not hijacked');
		// Hotkey without encounter context does nothing harmful: verified in OFFLINE session.
		return { editing };
	});

	await step('AC-30', 'Переключение партии: бой не переписывается молча', async () => {
		await openPanelTab('party');
		const encBefore = JSON.stringify((await state()).activeEncounter);
		await page().locator('.ca-panel button', { hasText: 'Новая' }).first().click();
		await waitSaved();
		const s = await state();
		const newParty = s.parties.at(-1);
		await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="bar-party"]').selectOption(newParty.id);
		await waitSaved();
		const s2 = await state();
		assert(s2.activePartyId === newParty.id, 'party switched');
		assert(JSON.stringify(s2.activeEncounter) === encBefore, 'encounter unchanged');
		const opts = await app.eval(() => [...document.querySelectorAll('.ca-overlay:not(.ca-inactive) [data-testid="bar-party"] option')].map((o) => o.textContent));
		assert(opts.includes(newParty.name), 'new party offered');
		await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="bar-party"]').selectOption(s.parties[0].id);
		await waitSaved();
		return { parties: opts };
	});

	await step('AC-32', 'Повтор actionId не удваивает урон и не увеличивает раунд (реальное хранилище)', async () => {
		const r = await app.eval(async () => {
			const st = window.canvasAssist.ctl.store;
			const g = Object.values(st.state.activeEncounter.combatants).find((c) => c.displayName === 'Гоблин 5');
			const hp0 = g.hp.current;
			const round0 = st.state.activeEncounter.round;
			const a = await st.dispatch({ type: 'hp/damage', target: { kind: 'combatant', id: g.id }, amount: 1, useTemporary: true }, 'e2e-fixed-dmg');
			const b = await st.dispatch({ type: 'hp/damage', target: { kind: 'combatant', id: g.id }, amount: 1, useTemporary: true }, 'e2e-fixed-dmg');
			const n1 = await st.dispatch({ type: 'encounter/next' }, 'e2e-fixed-next');
			const r1 = st.state.activeEncounter.round;
			const slot1 = st.state.activeEncounter.activeSlotId;
			const n2 = await st.dispatch({ type: 'encounter/next' }, 'e2e-fixed-next');
			const gg = st.state.activeEncounter.combatants[g.id];
			return { hp0, hp: gg.hp.current, a: a.ok, bDup: b.duplicate, n1: n1.ok, n2dup: n2.duplicate, sameSlot: slot1 === st.state.activeEncounter.activeSlotId, round0, r1, r2: st.state.activeEncounter.round };
		});
		assert(r.hp === r.hp0 - 1 && r.bDup && r.n2dup && r.sameSlot && r.r2 === r.r1, JSON.stringify(r));
		return r;
	});

	// ---------------- Restart ----------------
	let snapshot;
	await step('AC-31', 'Аварийное завершение после подтверждённого действия → всё восстановлено', async () => {
		await waitSaved();
		snapshot = await state();
		await app.close({ kill: true });
		app = await new ObsidianApp(sb).launch();
		await app.enablePlugin();
		await installWriteSpy();
		await openCanvas(`${A}/Холсты/01.canvas`);
		await waitFor(async () => (await state())?.adventureId === 'adv-A', 'state loaded');
		const s = await state();
		const pick = (x) => ({ round: x.activeEncounter.round, active: x.activeEncounter.activeSlotId, hp: Object.fromEntries(Object.values(x.characters).map((c) => [c.id, c.hp])), mons: Object.fromEntries(Object.values(x.activeEncounter.combatants).map((c) => [c.id, c.hp])), effects: x.effects, templates: x.encounterTemplates, history: x.history.undo.length, revision: x.revision });
		assert(JSON.stringify(pick(s)) === JSON.stringify(pick(snapshot)), 'identical after crash');
		const chips = await chipOrder();
		assert(chips.length > 0, 'ribbon restored');
		return { round: s.activeEncounter.round, history: s.history.undo.length, revision: s.revision };
	});

	await step('AC-12b', 'Ресурсы отображаются после перезапуска', async () => {
		const s = await state();
		const m = s.characters['pc-mira-import'];
		assert(m.hp.temporary === 3 && Object.values(m.counters).some((c) => c.name === 'Ки' && c.current === 2), JSON.stringify(m));
		await openPanelTab('party');
		const shown = await page().locator(tid('temp-Мира')).inputValue();
		assert(shown === '3', `UI shows temp ${shown}`);
		return { temp: shown };
	});

	await step('UNDO-AFTER-RESTART', 'Undo/Redo после перезапуска', async () => {
		const before = await state();
		await click(tid('bar-undo'));
		await waitSaved();
		const mid = await state();
		await click(tid('bar-redo'));
		await waitSaved();
		const after = await state();
		assert(mid.revision === before.revision + 1 && after.history.undo.length === before.history.undo.length, 'undo/redo work');
		return { label: before.history.undo.at(-1).label };
	});

	// ---------------- Failure modes ----------------
	await step('AC-33', 'Сбой записи: нет ложного «сохранено»', async () => {
		const r = await app.eval(async () => {
			const ad = window.app.vault.adapter;
			const orig = ad.process.bind(ad);
			ad.process = async () => {
				throw new Error('EIO: simulated disk failure');
			};
			const st = window.canvasAssist.ctl.store;
			const g = Object.values(st.state.activeEncounter.combatants).find((c) => c.displayName === 'Гоблин 2');
			const hp0 = g.hp.current;
			const out = await window.canvasAssist.ctl.act({ type: 'hp/damage', target: { kind: 'combatant', id: g.id }, amount: 1, useTemporary: true });
			await new Promise((res) => setTimeout(res, 300));
			const label = document.querySelector('.ca-overlay:not(.ca-inactive) [data-testid="bar-save"]')?.textContent;
			const hp1 = st.state.activeEncounter.combatants[g.id].hp.current;
			ad.process = orig;
			return { ok: out.ok, error: out.error, label, hp0, hp1 };
		});
		assert(!r.ok && r.label === 'НЕ сохранено' && r.hp0 === r.hp1, JSON.stringify(r));
		await app.screenshot('ac33-not-saved');
		return r;
	});

	await step('AC-35', 'Конкурентная запись: внешнее изменение → конфликт версий, без тихой перезаписи', async () => {
		const path = stateFile(A);
		const disk = JSON.parse(readFileSync(path, 'utf8'));
		disk.revision += 5;
		disk.gameClock.minutes = 777;
		const external = `${JSON.stringify(disk, null, '\t')}\n`;
		writeFileSync(path, external);
		const r = await app.eval(async () => window.canvasAssist.ctl.act({ type: 'clock/advance', minutes: 1 }));
		await sleep(400);
		assert(!r.ok, 'write refused');
		assert(readFileSync(path, 'utf8') === external, 'external version untouched');
		const info = await storeInfo();
		assert(info.mode === 'conflict' && info.backupPath, JSON.stringify(info));
		await app.screenshot('ac35-conflict');
		await click(tid('bar-recovery'));
		await click(tid('conflict-external'));
		await waitFor(async () => (await storeInfo()).mode === 'ok', 'resolved');
		const s = await state();
		assert(s.gameClock.minutes === 777, 'external adopted');
		assert(existsSync(join(sb.vault, info.backupPath)), 'local copy kept');
		return { localCopy: info.backupPath };
	});

	await step('AC-34', 'Повреждённый JSON: режим только чтения, оригинал сохранён, понятное сообщение', async () => {
		const path = stateFile(B);
		const garbage = '{"schemaVersion": 2, "adventureId": "adv-B", БИТЫЙ';
		writeFileSync(path, garbage);
		await openCanvas(`${B}/Холсты/01.canvas`);
		await waitFor(async () => (await storeInfo())?.mode === 'recovery', 'recovery');
		const info = await storeInfo();
		assert(readFileSync(path, 'utf8') === garbage, 'original untouched');
		assert(info.backupPath && readFileSync(join(sb.vault, info.backupPath), 'utf8') === garbage, 'corrupt copy kept');
		const chipText = await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="bar-recovery"]').first().textContent();
		await app.screenshot('ac34-recovery');
		await click(tid('bar-recovery'));
		await click(tid('recovery-reset'));
		await waitFor(async () => (await storeInfo())?.mode === 'ok', 'reset');
		return { message: info.message, chip: chipText };
	});

	await step('AC-45', 'Удаление оригинала: «источник недоступен», бой восстановим', async () => {
		await openCanvas(`${A}/Холсты/01.canvas`);
		await app.eval(async () => {
			const f = window.app.vault.getAbstractFileByPath('Приключение А/Elements/Персонажи/Бор Неполный.md');
			await window.app.vault.trash(f, false);
		});
		await sleep(500);
		await openPanelTab('party');
		const warn = await app.eval(() => document.querySelector('[data-testid="char-card"][data-name="Бор Неполный"] .ca-pill-warn')?.textContent);
		assert(warn === 'лист недоступен', `warn ${warn}`);
		const s = await state();
		assert(s.activeEncounter && ch(s, 'Бор Неполный'), 'state intact');
		return { warn };
	});

	await step('AC-36', 'Переименование корня приключения и заметки: пути обновлены, новый PC не создан', async () => {
		const before = await state();
		await app.eval(async () => {
			const f = window.app.vault.getAbstractFileByPath('Приключение А/Elements/Персонажи/Мира 2.md');
			await window.app.fileManager.renameFile(f, 'Приключение А/Elements/Персонажи/Мира Светлая.md');
		});
		await waitSaved();
		await app.eval(async () => {
			const f = window.app.vault.getAbstractFileByPath('Приключение А');
			await window.app.fileManager.renameFile(f, 'Приключение А (переим.)');
		});
		await sleep(1200);
		await openCanvas('Приключение А (переим.)/Холсты/01.canvas');
		const s = await state();
		assert(s.adventureId === 'adv-A', 'same adventure');
		assert(Object.keys(s.characters).length === Object.keys(before.characters).length, 'no new PC');
		assert(s.characters['pc-mira-import'].notePath === 'Elements/Персонажи/Мира Светлая.md', s.characters['pc-mira-import'].notePath);
		const reg = JSON.parse(readFileSync(join(sb.vault, '.obsidian', 'plugins', PLUGIN_ID, 'data.json'), 'utf8')).adventures;
		assert(reg.some((a) => a.adventureId === 'adv-A' && a.rootPath === 'Приключение А (переим.)'), JSON.stringify(reg));
		await app.eval(async () => {
			const f = window.app.vault.getAbstractFileByPath('Приключение А (переим.)');
			await window.app.fileManager.renameFile(f, 'Приключение А');
		});
		await sleep(1200);
		await openCanvas(`${A}/Холсты/01.canvas`);
		return { registry: reg };
	});

	await step('AC-28+AC-29', 'Выборочный долгий отдых; ручной счётчик не восстанавливается', async () => {
		await click(tid('bar-end'));
		await click(tid('confirm-ok'));
		await waitSaved();
		const s0 = await state();
		const alex0 = ch(s0, 'Алекс').hp;
		await openPanelTab('party');
		await click(tid('panel-long-rest'));
		await waitFor(() => page().locator(tid('rest-apply')).count(), 'rest modal');
		// Uncheck Алекс: only the others rest.
		await page().locator('[data-testid="rest-char-Алекс"]').first().click();
		await sleep(300);
		const preview = await page().locator(tid('rest-preview')).textContent();
		assert(!preview.includes('Алекс') && preview.includes('Мира'), preview);
		await click(tid('rest-apply'));
		await waitSaved();
		const s = await state();
		const m = s.characters['pc-mira-import'];
		assert(m.hp.current === 26 && m.spellSlots['1'].current === 4, `Мира restored ${JSON.stringify(m.hp)}`);
		assert(JSON.stringify(ch(s, 'Алекс').hp) === JSON.stringify(alex0), 'Алекс untouched');
		assert(Object.values(m.counters).find((c) => c.name === 'Ки').current === 2, 'manual counter not restored');
		await click(tid('bar-undo'));
		await waitSaved();
		const u = await state();
		assert(u.characters['pc-mira-import'].hp.current === s0.characters['pc-mira-import'].hp.current, 'undoable');
		return { preview };
	});

	// ---------------- UI quality ----------------
	await step('AC-41', 'Светлая/тёмная темы, маленькое окно: читаемость и отсутствие обрезания', async () => {
		await openPanelTab('templates');
		await click(tid('template-launch'));
		await waitSaved();
		await openCanvas(`${A}/Холсты/01.canvas`);
		await (await chip('Гоблин 1')).click();
		const measure = () =>
			app.eval(() => {
				const lum = (c) => {
					const m = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
					// rgb(0-255) or color(srgb 0-1 0-1 0-1)
					const scale = c.startsWith('color(') ? 1 : 255;
					const [r, g, b] = m.slice(0, 3).map((v) => {
						const s = v / scale;
						return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
					});
					return 0.2126 * r + 0.7152 * g + 0.0722 * b;
				};
				const bgOf = (el) => {
					let e = el;
					while (e) {
						const bg = getComputedStyle(e).backgroundColor;
						if (bg && !bg.startsWith('rgba(0, 0, 0, 0)') && bg !== 'transparent') return bg;
						e = e.parentElement;
					}
					return 'rgb(255,255,255)';
				};
				const ratio = (el) => {
					const a = lum(getComputedStyle(el).color);
					const b = lum(bgOf(el));
					return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
				};
				const ov = document.querySelector('.ca-overlay:not(.ca-inactive)');
				const vw = ov.getBoundingClientRect();
				const texts = [...ov.querySelectorAll('.ca-adv, .ca-chip-name, .ca-chip-hp, .ca-target-label, .ca-round, .ca-nav-title, .ca-btn-text')].filter((e) => e.offsetParent);
				const scored = texts.map((e) => ({ r: ratio(e), cls: e.className, text: e.textContent?.slice(0, 20), color: getComputedStyle(e).color, bg: bgOf(e) }));
				scored.sort((a, b) => a.r - b.r);
				const min = scored[0]?.r ?? 99;
				const worst = scored.slice(0, 3);
				const parts = ['.ca-bar', '.ca-ribbon', '.ca-targetbar', '.ca-nav'].map((s) => ov.querySelector(s)).filter((e) => e && !e.classList.contains('ca-hidden'));
				const clipped = parts.filter((e) => {
					const r = e.getBoundingClientRect();
					return r.left < vw.left - 1 || r.right > vw.right + 1 || r.top < vw.top - 1 || r.bottom > vw.bottom + 1;
				}).map((e) => e.className);
				const buttons = [...ov.querySelectorAll('.ca-btn')].filter((b) => b.offsetParent);
				const small = buttons.filter((b) => b.getBoundingClientRect().height < 24 || b.getBoundingClientRect().width < 24).length;
				return { minContrast: Math.round(min * 100) / 100, worst, checked: texts.length, clipped, smallButtons: small, buttons: buttons.length, dark: document.body.classList.contains('theme-dark') };
			});
		const out = {};
		for (const theme of ['moonstone', 'obsidian']) {
			await app.eval((t) => window.app.changeTheme?.(t) ?? window.app.setTheme?.(t), theme);
			await sleep(600);
			out[theme] = await measure();
			await app.screenshot(`theme-${theme}-1440`);
			await app.cdp.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 620, deviceScaleFactor: 1, mobile: false });
			await sleep(700);
			out[`${theme}-small`] = await measure();
			await app.screenshot(`theme-${theme}-820`);
			await app.cdp.send('Emulation.clearDeviceMetricsOverride');
			await sleep(400);
		}
		await app.eval(() => window.app.changeTheme?.('moonstone'));
		for (const [k, v] of Object.entries(out)) {
			assert(v.minContrast >= 4.5, `${k}: contrast ${v.minContrast} ${JSON.stringify(v.worst)}`);
			assert(v.clipped.length === 0, `${k}: clipped ${v.clipped}`);
			assert(v.smallButtons === 0, `${k}: small buttons ${v.smallButtons}`);
		}
		return out;
	});

	await step('AC-42', 'Нет утечек: 100 открытий/закрытий панелей', async () => {
		const r = await app.eval(async () => {
			const ctl = window.canvasAssist.ctl;
			const count = () => ({ dom: document.getElementsByTagName('*').length, listeners: ctl.listeners.size });
			const wait = (ms) => new Promise((res) => setTimeout(res, ms));
			for (const l of window.app.workspace.getLeavesOfType('canvas-assist-panel')) l.detach();
			await wait(300);
			const before = count();
			for (let i = 0; i < 100; i++) {
				await window.app.commands.executeCommandById('canvas-assist:open-panel');
				await wait(10);
				for (const l of window.app.workspace.getLeavesOfType('canvas-assist-panel')) l.detach();
				await wait(5);
			}
			const nav = document.querySelector('.ca-overlay:not(.ca-inactive) [data-testid="bar-nav"]');
			for (let i = 0; i < 100; i++) {
				nav?.click();
				await wait(20);
			}
			await wait(500);
			return { before, afterPanelsAndNav: count() };
		});
		for (let i = 0; i < 100; i++) {
			await page().locator('.ca-overlay:not(.ca-inactive) [data-testid="target-card"]').first().click();
			await page().keyboard.press('Escape');
		}
		await sleep(800);
		r.after = await app.eval(() => ({ dom: document.getElementsByTagName('*').length, listeners: window.canvasAssist.ctl.listeners.size, modals: document.querySelectorAll('.modal-container').length }));
		assert(r.after.listeners === r.before.listeners, `listeners ${JSON.stringify(r)}`);
		assert(Math.abs(r.after.dom - r.before.dom) < 150, `dom ${JSON.stringify(r)}`);
		return r;
	});

	await step('PERF', 'Производительность в реальном приложении', async () => {
		const r = await app.eval(async () => {
			const ctl = window.canvasAssist.ctl;
			// Search p95 on a synthetic 500-node canvas (warm, file already read).
			const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, type: 'text', text: `Узел ${i} гоблин ёж таверна`, x: (i % 25) * 300, y: Math.floor(i / 25) * 200, width: 250, height: 120 }));
			const path = 'Приключение А/Холсты/perf-500.canvas';
			const existing = window.app.vault.getAbstractFileByPath(path);
			if (!existing) await window.app.vault.create(path, JSON.stringify({ nodes, edges: [] }));
			const f = window.app.vault.getAbstractFileByPath(path);
			const leaf = window.app.workspace.getLeaf(false);
			await leaf.openFile(f);
			window.app.workspace.setActiveLeaf(leaf, { focus: true });
			await new Promise((res) => setTimeout(res, 1500));
			await ctl.refreshIndex();
			const input = document.querySelector('.ca-overlay:not(.ca-inactive) [data-testid="nav-search"]');
			const times = [];
			for (let i = 0; i < 40; i++) {
				const t0 = performance.now();
				input.value = `гоб ${i}`;
				input.dispatchEvent(new Event('input'));
				times.push(performance.now() - t0);
			}
			times.sort((a, b) => a - b);
			// Next-turn with 100 combatants / 200 effects through the real store (incl. write).
			const st = ctl.store;
			const enc = st.state.activeEncounter;
			const combatants = Array.from({ length: 100 - Object.keys(enc.combatants).length }, (_, i) => ({ id: `perf-c${i}`, kind: 'monster', characterId: null, creatureId: null, source: null, displayName: `Массовка ${i}`, initiative: 100 - (i % 50), initiativeModifier: 0, tieOrder: 0, initiativeGroupId: null, hp: { current: 5, max: 5, temporary: 0 }, ac: 10, acOverride: null, defeated: false }));
			await st.dispatch({ type: 'encounter/add-combatants', combatants });
			for (let i = 0; i < 200; i++) {
				const owner = combatants[i % combatants.length].id;
				await st.dispatch({ type: 'effect/add', effect: { id: `perf-e${i}`, conditionId: null, label: `Эффект ${i % 7}`, target: { kind: 'combatant', id: owner }, sourceCombatantId: null, sourceLabel: '', duration: { kind: 'turns', ownerCombatantId: owner, phase: 'end', remaining: 50 }, createdAtEventSeq: 0, isConcentration: false, concentrationEffectId: null, needsDecision: false, notes: '' } });
			}
			const next = [];
			const writes = [];
			for (let i = 0; i < 30; i++) {
				const t0 = performance.now();
				const out = await st.dispatch({ type: 'encounter/next' });
				writes.push(performance.now() - t0);
				void out;
			}
			// Pure reducer cost (no I/O) measured with the bundled domain via a dry clone.
			const stateSize = JSON.stringify(st.state).length;
			for (let i = 0; i < 30; i++) {
				const t0 = performance.now();
				structuredClone(st.state);
				next.push(performance.now() - t0);
			}
			writes.sort((a, b) => a - b);
			next.sort((a, b) => a - b);
			const p = (arr, q) => Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] * 100) / 100;
			return { searchP50: p(times, 0.5), searchP95: p(times, 0.95), nextTurnWithWriteP50: p(writes, 0.5), nextTurnWithWriteP95: p(writes, 0.95), cloneP95: p(next, 0.95), stateBytes: stateSize, historyBytes: JSON.stringify(st.state.history).length };
		});
		// Idle CPU and network with panels closed.
		await app.eval(() => window.app.workspace.getLeavesOfType('canvas-assist-panel').forEach((l) => l.detach()));
		await sleep(1000);
		const m1 = Object.fromEntries((await app.cdp.send('Performance.enable').then(() => app.cdp.send('Performance.getMetrics'))).metrics.map((m) => [m.name, m.value]));
		const req0 = app.requests.length;
		await sleep(10000);
		const m2 = Object.fromEntries((await app.cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
		const idle = { taskSecondsPer10s: Math.round((m2.TaskDuration - m1.TaskDuration) * 1000) / 1000, scriptSeconds: Math.round((m2.ScriptDuration - m1.ScriptDuration) * 1000) / 1000, cpuPercentOfOneCore: Math.round(((m2.TaskDuration - m1.TaskDuration) / 10) * 10000) / 100, networkRequestsInIdle: app.requests.length - req0, heapMiB: Math.round((m2.JSHeapUsedSize / 1048576) * 10) / 10 };
		const out = { ...r, idle };
		assert(r.searchP95 <= 80, `search p95 ${r.searchP95}`);
		return out;
	});

	await step('MEM', 'Дополнительная память плагина (heap с плагином / без)', async () => {
		const measure = async () => {
			await app.cdp.send('HeapProfiler.collectGarbage');
			await sleep(500);
			const m = Object.fromEntries((await app.cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
			return m.JSHeapUsedSize;
		};
		const withPlugin = await measure();
		await app.eval(() => window.app.plugins.disablePlugin('canvas-assist'));
		await sleep(1500);
		const without = await measure();
		await app.eval(() => window.app.plugins.enablePlugin('canvas-assist'));
		await sleep(1500);
		return { withPluginMiB: Math.round((withPlugin / 1048576) * 10) / 10, withoutMiB: Math.round((without / 1048576) * 10) / 10, deltaMiB: Math.round(((withPlugin - without) / 1048576) * 10) / 10 };
	});

	await step('AC-39', 'Выключение плагина: Canvas и Markdown читаются штатно', async () => {
		await app.eval(() => window.app.plugins.disablePlugin('canvas-assist'));
		await sleep(1000);
		const overlays = await app.eval(() => document.querySelectorAll('.ca-overlay').length);
		await app.openFile(`${A}/Холсты/01.canvas`);
		const nodes = await app.eval(() => window.app.workspace.getMostRecentLeaf().view.canvas?.nodes?.size ?? 0);
		await app.openFile(`${A}/Elements/Персонажи/Мира Светлая.md`);
		const md = await app.eval(() => window.app.workspace.getMostRecentLeaf().view.getViewType());
		await app.screenshot('ac39-disabled');
		assert(overlays === 0 && nodes >= 5 && md === 'markdown', JSON.stringify({ overlays, nodes, md }));
		await app.eval(() => window.app.plugins.enablePlugin('canvas-assist'));
		await sleep(1000);
		return { overlays, nodes, md };
	});

	await step('TWO-TABS', 'Два Canvas одного приключения в разных вкладках: общее состояние без конфликтов', async () => {
		await app.eval(async () => {
			const ws = window.app.workspace;
			ws.getLeavesOfType('canvas').forEach((l, i) => i > 0 && l.detach());
			const f1 = window.app.vault.getAbstractFileByPath('Приключение А/Холсты/01.canvas');
			const f2 = window.app.vault.getAbstractFileByPath('Приключение А/Холсты/02.canvas');
			const l1 = ws.getLeavesOfType('canvas')[0] ?? ws.getLeaf(false);
			await l1.openFile(f1);
			const l2 = ws.getLeaf('split');
			await l2.openFile(f2);
			ws.setActiveLeaf(l2, { focus: true });
		});
		await sleep(1200);
		const r1 = (await state()).activeEncounter.round;
		await click('.ca-overlay:not(.ca-inactive) [data-testid="bar-next"]');
		await waitSaved();
		await app.eval(() => {
			const ws = window.app.workspace;
			const l1 = ws.getLeavesOfType('canvas').find((l) => l.view.file?.path.endsWith('01.canvas'));
			ws.setActiveLeaf(l1, { focus: true });
		});
		await sleep(800);
		const s = await state();
		const overlays = await app.eval(() => ({ total: document.querySelectorAll('.ca-overlay').length, active: document.querySelectorAll('.ca-overlay:not(.ca-inactive)').length }));
		const info = await storeInfo();
		assert(info.mode === 'ok' && overlays.total === 2 && overlays.active === 1, JSON.stringify({ info, overlays }));
		const shown = await app.eval(() => document.querySelector('.ca-overlay:not(.ca-inactive) [data-testid="bar-active"]')?.textContent);
		const enc = s.activeEncounter;
		assert(shown && shown.startsWith(enc.combatants[enc.activeSlotId]?.displayName ?? enc.groups[enc.activeSlotId]?.name), `other tab shows same turn (${shown})`);
		await app.eval(() => window.app.workspace.getLeavesOfType('canvas').forEach((l, i) => i > 0 && l.detach()));
		return { roundBefore: r1, roundAfter: enc.round, shown, overlays };
	});

	await step('CONSOLE', 'Нет ошибок плагина в консоли за всю сессию', async () => {
		const errs = app.pluginErrors();
		assert(errs.length === 0, JSON.stringify(errs).slice(0, 1500));
		return { consoleMessages: app.console.length };
	});
	await app.screenshot('final-main');
	await app.close();

	await step('RENAME-CLOSED', 'Переименование корня при закрытом Obsidian: безопасное переподключение по adventureId', async () => {
		renameSync(join(sb.vault, B), join(sb.vault, 'Приключение Б (диск)'));
		app = await new ObsidianApp(sb).launch();
		await app.enablePlugin();
		await openCanvas('Приключение Б (диск)/Холсты/01.canvas');
		await waitFor(async () => (await state())?.adventureId === 'adv-B', 'relinked adventure B');
		const reg = JSON.parse(readFileSync(join(sb.vault, '.obsidian', 'plugins', PLUGIN_ID, 'data.json'), 'utf8')).adventures;
		assert(reg.filter((a) => a.adventureId === 'adv-B').length === 1 && reg.find((a) => a.adventureId === 'adv-B').rootPath === 'Приключение Б (диск)', JSON.stringify(reg));
		const errs = app.pluginErrors();
		assert(errs.length === 0, JSON.stringify(errs));
		await app.close();
		return { registry: reg };
	});

	// ---------------- Offline session ----------------
	sb = createSandbox('offline');
	app = await launchTrusted(sb, { offline: true });
	await step('AC-40', 'Офлайн: старт и бой без сети/TTG/сторонних плагинов', async () => {
		const r0 = await app.enablePlugin();
		assert(r0.loaded, 'loaded offline');
		const online = await app.eval(() => fetch('https://5e14.ttg.club/', { mode: 'no-cors' }).then(() => true).catch(() => false));
		assert(!online, 'network really unavailable');
		await app.eval(() => {
			const t = window.canvasAssist.ctl.ttgOnline;
			window.__pluginHttp = 0;
			const orig = t.post;
			t.post = (...a) => {
				window.__pluginHttp++;
				return orig(...a);
			};
		});
		await openCanvas(`${A}/Холсты/01.canvas`);
		await click(tid('bar-register'));
		await click(tid('reg-submit'));
		await waitFor(async () => (await state())?.adventureId === 'adv-A', 'registered');
		// No encounter: combat hotkeys are safe no-ops.
		await focusCanvas();
		await press('Shift+Space');
		const noEnc = await state();
		assert(noEnc.activeEncounter === null, 'no-op without encounter');
		await click(tid('bar-encounter-menu'));
		await menuClick('Спонтанный бой');
		await waitFor(() => page().locator(tid('add-submit')).count(), 'add modal');
		await click(tid('add-party'));
		await fill(tid('add-name'), 'Гоблин', false);
		await fill(tid('add-count'), 2, false);
		await fill(tid('add-hp'), 7, false);
		await fill(tid('add-ac'), 15, false);
		await click(tid('add-submit'));
		await waitSaved();
		await click(tid('bar-next'));
		await waitSaved();
		await (await chip('Гоблин 2')).click();
		await focusCanvas();
		await press('Shift+KeyD');
		await numberModal(3);
		await press('Shift+KeyK');
		await waitFor(() => page().locator('.ca-card-modal .ca-stat').count(), 'card');
		const stats = await app.eval(() => [...document.querySelectorAll('.ca-card-modal .ca-stat')].map((s) => s.textContent));
		await closeModals();
		const s = await state();
		assert(cmb(s, 'Гоблин 2').hp.current === 4 && s.activeEncounter.round === 1, 'combat works');
		const pluginHttp = await app.eval(() => window.__pluginHttp);
		assert(pluginHttp === 0, `plugin made ${pluginHttp} HTTP calls`);
		// Canvas link nodes are embedded by Obsidian itself (webview/iframe); they are reported, not attributed to the plugin.
		const ttg = app.requests.filter((q) => /ttg\.club/.test(q.url)).map((q) => ({ url: q.url, initiator: q.initiator }));
		await app.screenshot('ac40-offline');
		const errs = app.pluginErrors();
		assert(errs.length === 0, JSON.stringify(errs));
		const external = app.requests.filter((q) => /^https?:/.test(q.url)).map((q) => q.url);
		return { stats, pluginHttpCalls: pluginHttp, obsidianOwnRequests: [...new Set(external)].slice(0, 10), ttgRequestsByCanvasLinkEmbed: ttg };
	});
	await app.close();

	// ---------------- Compatibility: real Fantasy Statblocks ----------------
	const fsbDir = process.env.FSB_DIR ?? [join(REPO, '.cache', 'fsb'), '/opt/fsb'].find((d) => existsSync(join(d, 'main.js'))) ?? join(REPO, '.cache', 'fsb');
	if (!existsSync(join(fsbDir, 'main.js'))) {
		notRun('COMPAT-FSB', 'Совместимость с Fantasy Statblocks', `Сборка плагина не найдена (${fsbDir}); скачайте release 4.10.3 (scripts/fetch-e2e-deps.sh)`);
	} else {
		sb = createSandbox('compat', [{ id: 'obsidian-5e-statblocks', dir: fsbDir }]);
		app = await launchTrusted(sb);
		await step('COMPAT-FSB', 'Совместимость: реальный Fantasy Statblocks 4.10.3 + адаптер под флагом', async () => {
			const fsb = await app.eval(async () => {
				const p = window.app.plugins;
				if (!p.enabledPlugins.has('obsidian-5e-statblocks')) await p.enablePluginAndSave('obsidian-5e-statblocks');
				const deadline = Date.now() + 30000;
				while (!(window.FantasyStatblocks?.isResolved?.()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
				return { version: p.manifests['obsidian-5e-statblocks']?.version, resolved: !!window.FantasyStatblocks?.isResolved?.(), goblin: !!window.FantasyStatblocks?.hasCreature?.('Goblin') };
			});
			assert(fsb.resolved && fsb.goblin, JSON.stringify(fsb));
			await openCanvas(`${A}/Холсты/01.canvas`);
			await click(tid('bar-register'));
			await click(tid('reg-submit'));
			await waitFor(async () => (await state())?.adventureId === 'adv-A', 'registered');
			await click(tid('bar-encounter-menu'));
			await menuClick('Спонтанный бой');
			await fill(tid('add-name'), 'Goblin', false);
			await click(tid('add-lookup'));
			const notFoundWhenOff = await page().locator(tid('add-hp')).inputValue();
			assert(notFoundWhenOff === '', 'flag off → no Fantasy Statblocks lookup');
			await app.eval(() => {
				window.canvasAssist.ctl.settings.fantasyStatblocks = true;
			});
			await click(tid('add-lookup'));
			const prefilled = { hp: await page().locator(tid('add-hp')).inputValue(), ac: await page().locator(tid('add-ac')).inputValue() };
			assert(prefilled.hp === '7' && prefilled.ac === '15', JSON.stringify(prefilled));
			await app.eval(() => {
				window.canvasAssist.ctl.settings.fantasyStatblocks = false;
			});
			await click(tid('add-submit'));
			await waitSaved();
			await (await chip('Goblin')).click();
			const offText = await (async () => {
				await focusCanvas();
				await press('Shift+KeyK');
				await waitFor(() => page().locator('.ca-card-modal .ca-stat').count(), 'card');
				const t = await page().locator('.ca-card-modal').textContent();
				await closeModals();
				return t;
			})();
			assert(!offText.includes('Fantasy Statblocks:'), 'flag off → adapter not used');
			await app.eval(() => {
				window.canvasAssist.ctl.settings.fantasyStatblocks = true;
			});
			await focusCanvas();
			await press('Shift+KeyK');
			await waitFor(() => page().locator('.ca-card-modal .ca-stat').count(), 'card');
			const onText = await page().locator('.ca-card-modal').textContent();
			await app.screenshot('compat-fsb-card');
			await closeModals();
			assert(/Fantasy Statblocks: КД 15, хиты 7/.test(onText), onText.slice(0, 400));
			const errs = app.pluginErrors();
			assert(errs.length === 0, JSON.stringify(errs));
			const st = await state();
			assert(cmb(st, 'Goblin').hp.max === 7 && cmb(st, 'Goblin').ac === 15, 'combatant prefilled from Fantasy Statblocks');
			return { fsb, prefilled, card: onText.match(/Fantasy Statblocks:[^О]*/)?.[0] };
		});
		await app.close();
	}

	notRun('MOBILE', 'Мобильный E2E (iOS/Android)', 'Нет эмулятора Android/iOS с Obsidian в окружении. Выполнена статическая проверка отсутствия Node/Electron импортов (scripts/check-bundle.mjs).');
}

try {
	await main();
} catch (e) {
	results.push({ id: 'HARNESS', title: 'Сбой тестового раннера', status: 'FAIL', error: String(e?.stack ?? e) });
	console.error(e);
} finally {
	try {
		await app?.close();
	} catch {
		/* ignore */
	}
	const summary = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
	const report = { startedAt: new Date(started).toISOString(), durationSec: Math.round((Date.now() - started) / 1000), summary, results };
	writeFileSync(join(OUT, 'results.json'), JSON.stringify(report, null, 2));
	const md = [
		`# E2E (реальный Obsidian) — ${report.startedAt}`,
		'',
		`Итог: ${Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(', ')} · ${report.durationSec} с`,
		'',
		'| ID | Проверка | Статус | мс |',
		'|---|---|---|---|',
		...results.map((r) => `| ${r.id} | ${r.title} | ${r.status} | ${r.ms ?? ''} |`),
	].join('\n');
	writeFileSync(join(OUT, 'results.md'), md);
	console.log(`\nSUMMARY ${JSON.stringify(summary)}`);
	process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}
