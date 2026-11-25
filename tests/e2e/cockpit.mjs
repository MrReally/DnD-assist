#!/usr/bin/env node
// GM Cockpit vertical slice, real Obsidian desktop at 1280×800 in an isolated temp vault/profile.
// Node → card (double click, command, node menu) → HP edit → persistence after SIGKILL → Undo.
import { spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, launchTrusted, ObsidianApp, OUT, sleep } from './lib.mjs';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.CA_E2E_CHILD) {
	const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, CA_E2E_CHILD: '1' } });
	process.exit(r.status ?? 1);
}
mkdirSync(OUT, { recursive: true });
const A = 'Приключение А';
const W = 1280;
const H = 800;
const results = [];
const sb = createSandbox('cockpit', [], { width: W, height: H });
const stateFile = join(sb.vault, A, '.canvas-assist-state.json');
let app = await launchTrusted(sb, { width: W, height: H });

const assert = (c, m) => {
	if (!c) throw new Error(`ASSERT: ${m}`);
};
async function step(id, title, fn) {
	try {
		const ev = await fn();
		results.push({ id, title, status: 'PASS', evidence: ev ?? null });
		console.log(`PASS ${id} ${title}`);
	} catch (e) {
		let shot = null;
		try { shot = await app.screenshot(`cockpit-fail-${id}`); } catch { /* ignore */ }
		results.push({ id, title, status: 'FAIL', error: String(e?.message ?? e).slice(0, 1200), screenshot: shot });
		console.log(`FAIL ${id} ${title}\n  ${e?.message}`);
	}
}
const diskHp = () => Object.values(JSON.parse(readFileSync(stateFile, 'utf8')).characters)[0].hp;
const hpText = () => app.page.locator('[data-testid=gmc-hp-text]').innerText();
async function nodeCenter(file) {
	return app.eval((f) => {
		const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas;
		for (const n of c.nodes.values()) if (n.file?.path?.endsWith(f)) { const r = n.nodeEl.getBoundingClientRect(); return { id: n.id, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
		return null;
	}, file);
}
async function resetCanvas() {
	await app.eval(() => {
		const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas;
		for (const n of c.nodes.values()) if (n.isEditing) n.setIsEditing?.(false);
		c.deselectAll();
	});
	await sleep(200);
}
async function closeCockpit() {
	await app.eval(() => window.app.workspace.detachLeavesOfType('gm-cockpit-panel'));
	await sleep(300);
}

await app.eval(async (a) => { await window.canvasAssist.ctl.registerAdventure(a, a); }, A);
await app.openFile(`${A}/Холсты/02.canvas`);
await sleep(1200);
// Left sidebar closed: SPEC §1 budget assumes the Canvas gets the width.
await app.eval(() => window.app.workspace.leftSplit.collapse());
await sleep(400);

await step('C1', 'Панель GM Cockpit открывается рядом с Canvas (команда), пустое состояние', async () => {
	assert(await app.command('canvas-assist:cockpit-open'), 'command ran');
	await app.page.waitForSelector('.gmc', { timeout: 5000 });
	assert((await app.page.locator('[data-testid=gmc-empty]').count()) === 1, 'empty state');
	const m = await app.eval(() => {
		const cv = window.app.workspace.getLeavesOfType('canvas')[0].containerEl.getBoundingClientRect();
		const p = window.app.workspace.getLeavesOfType('gm-cockpit-panel')[0].containerEl.getBoundingClientRect();
		return { canvasW: cv.width, canvasH: cv.height, panelW: p.width };
	});
	await app.screenshot('cockpit-empty');
	return m;
});

await step('C2', 'Одинарный клик выделяет узел и НЕ открывает карточку; выбор доступен через canvas.selection', async () => {
	await resetCanvas();
	const p = await nodeCenter('Алекс.md');
	await app.page.mouse.click(p.x, p.y);
	await sleep(400);
	const sel = await app.eval(() => window.canvasAssist.ctl.canvasSelection);
	assert(sel.length === 1 && sel[0].endsWith('Персонажи/Алекс.md'), `selection ${JSON.stringify(sel)}`);
	assert((await app.page.locator('[data-testid=gmc-card]').count()) === 0, 'card must not open on single click');
	return { selection: sel };
});

await step('C3', 'Двойной клик по узлу персонажа открывает карточку, редактирование Canvas подавлено', async () => {
	await resetCanvas();
	const p = await nodeCenter('Алекс.md');
	await app.page.mouse.dblclick(p.x, p.y);
	await app.page.waitForSelector('[data-testid=gmc-card]', { timeout: 5000 });
	assert((await app.page.locator('[data-testid=gmc-name]').innerText()) === 'Алекс', 'name');
	assert((await hpText()).startsWith('17 / 28'), `hp ${await hpText()}`);
	assert((await app.page.locator('[data-testid=gmc-ac]').innerText()) === '17', 'ac');
	const editing = await app.eval(() => [...window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.values()].some((n) => n.isEditing));
	assert(!editing, 'native editing must be suppressed');
	await app.screenshot('cockpit-card-1280x800');
	return { editing };
});

await step('C4', 'Двойной клик по узлу без карточки (NPC-лист, не PC) остаётся штатным', async () => {
	await app.openFile(`${A}/Холсты/01.canvas`);
	await sleep(1000);
	await resetCanvas();
	const p = await nodeCenter('Гоблин.md');
	await app.page.mouse.dblclick(p.x, p.y);
	await sleep(500);
	const editing = await app.eval(() => [...window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.values()].some((n) => n.isEditing));
	assert(editing, 'Canvas must enter its native edit mode for non-card nodes');
	await resetCanvas();
	await app.openFile(`${A}/Холсты/02.canvas`);
	await sleep(1000);
	return { editing };
});

await step('C5', 'Запасной путь: команда «Открыть выбранный объект» и недоступность без выбора', async () => {
	await closeCockpit();
	await app.eval(() => window.canvasAssist.ctl.setTarget(null));
	await resetCanvas();
	await app.eval(() => { window.canvasAssist.ctl.canvasSelection = []; });
	const without = await app.eval(() => { const c = window.app.commands.commands['canvas-assist:cockpit-open-selected']; return c.checkCallback(true); });
	assert(without === false, 'command must be unavailable with no card selected');
	const p = await nodeCenter('Алекс.md');
	await app.page.mouse.click(p.x, p.y);
	await sleep(400);
	assert(await app.command('canvas-assist:cockpit-open-selected'), 'command executed');
	await app.page.waitForSelector('[data-testid=gmc-card]', { timeout: 5000 });
	return { unavailableWithoutSelection: !without };
});

await step('C6', 'Настройка: двойной клик выключен → штатное поведение', async () => {
	await closeCockpit();
	await app.eval(() => { window.canvasAssist.ctl.settings.cockpitDoubleClick = false; });
	await resetCanvas();
	const p = await nodeCenter('Алекс.md');
	await app.page.mouse.dblclick(p.x, p.y);
	await sleep(500);
	const opened = await app.page.locator('[data-testid=gmc-card]').count();
	await resetCanvas();
	await app.eval(() => { window.canvasAssist.ctl.settings.cockpitDoubleClick = true; });
	assert(opened === 0, 'card must not open when disabled');
	await app.command('canvas-assist:cockpit-open-selected');
	return { opened };
});

await step('C7', 'Редактирование HP: урон/лечение/установка, ввод ошибок, запись на диск до отображения', async () => {
	await app.command('canvas-assist:cockpit-open');
	await app.eval(() => window.canvasAssist.ctl.openCardForPath('Приключение А/Elements/Персонажи/Алекс.md'));
	await app.page.waitForSelector('[data-testid=gmc-card]');
	const input = app.page.locator('[data-testid=gmc-hp-input]');
	await input.fill('-7');
	await input.press('Enter');
	await app.page.waitForFunction(() => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith('10 / 28'), null, { timeout: 5000 });
	assert(diskHp().current === 10, `disk after damage ${JSON.stringify(diskHp())}`);
	await app.page.locator('[data-testid=gmc-hp-input]').fill('+5');
	await app.page.locator('[data-testid=gmc-hp-input]').press('Enter');
	await app.page.waitForFunction(() => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith('15 / 28'), null, { timeout: 5000 });
	await app.page.locator('[data-testid=gmc-hp-input]').fill('40');
	await app.page.locator('[data-testid=gmc-heal]').click();
	await app.page.waitForFunction(() => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith('28 / 28'), null, { timeout: 5000 });
	await app.page.locator('[data-testid=gmc-hp-input]').fill('=12');
	await app.page.locator('[data-testid=gmc-hp-input]').press('Enter');
	await app.page.waitForFunction(() => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith('12 / 28'), null, { timeout: 5000 });
	const revBefore = await app.eval(() => window.canvasAssist.ctl.state.revision);
	await app.page.locator('[data-testid=gmc-hp-input]').fill('abc');
	await app.page.locator('[data-testid=gmc-hp-input]').press('Enter');
	await sleep(400);
	const revAfter = await app.eval(() => window.canvasAssist.ctl.state.revision);
	assert(revBefore === revAfter, 'invalid input must not change state');
	assert((await app.page.locator('[data-testid=gmc-hp-input].is-error').count()) === 1, 'error styling');
	assert(diskHp().current === 12, 'disk 12');
	await app.screenshot('cockpit-hp-edited');
	return { disk: diskHp() };
});

await step('C8', 'Undo/Redo из панели возвращают HP (общая история Canvas Assist)', async () => {
	await app.page.locator('[data-testid=gmc-undo]').click();
	await app.page.waitForFunction(() => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith('28 / 28'), null, { timeout: 5000 });
	await app.page.locator('[data-testid=gmc-redo]').click();
	await app.page.waitForFunction(() => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith('12 / 28'), null, { timeout: 5000 });
	assert(diskHp().current === 12, 'disk after redo');
});

await step('C9', 'Сохранение и восстановление: SIGKILL → перезапуск → то же HP, карточка открывается снова', async () => {
	await app.close({ kill: true });
	app = new ObsidianApp(sb, { width: W, height: H });
	await app.launch();
	const r = await app.enablePlugin();
	assert(r.loaded, 'plugin loaded after crash');
	await app.openFile(`${A}/Холсты/02.canvas`);
	await sleep(1500);
	assert(diskHp().current === 12, 'disk hp after kill');
	await app.eval(() => window.app.workspace.leftSplit.collapse());
	const p = await nodeCenter('Алекс.md');
	await app.page.mouse.dblclick(p.x, p.y);
	await app.page.waitForSelector('[data-testid=gmc-card]', { timeout: 5000 });
	assert((await hpText()).startsWith('12 / 28'), `hp after restart ${await hpText()}`);
	return { hp: await hpText() };
});

await step('C10', 'Изоляция: узел одноимённого персонажа другого приключения не открывает чужую карточку', async () => {
	const r = await app.eval(async () => {
		const ctl = window.canvasAssist.ctl;
		return { sameAdventureFile: ctl.openCardForPath('Приключение А/Elements/Персонажи/Алекс.md'), otherAdventureFile: ctl.openCardForPath('Приключение Б/Elements/Персонажи/Алекс.md') };
	});
	assert(r.sameAdventureFile === true && r.otherAdventureFile === false, JSON.stringify(r));
	return r;
});

await step('C12', 'Lightkey: тестовая отправка из Obsidian доходит до локального OSC-приёмника; ошибка не блокирует игру', async () => {
	const server = createSocket('udp4');
	const got = new Promise((res) => server.once('message', (m) => res(m)));
	await new Promise((r) => server.bind(0, '127.0.0.1', r));
	const port = server.address().port;
	await app.eval((p) => { const s = window.canvasAssist.ctl.settings; s.lightkey = { host: '127.0.0.1', port: p, testAddress: '/live/Панель/cue/Огонь/activate', testCommand: 'toggle' }; }, port);
	const res = await app.eval(() => window.canvasAssist.testLightkey());
	const pkt = await Promise.race([got, sleep(3000).then(() => null)]);
	server.close();
	assert(res.status === 'sent', JSON.stringify(res));
	assert(pkt && pkt.toString('utf8', 0, 40).includes('/live/'), 'packet received');
	assert(pkt.toString('utf8').includes('/toggle'), 'verb replaced by toggle');
	// Failure path: invalid port → error result, game state still editable.
	await app.eval(() => { window.canvasAssist.ctl.settings.lightkey.port = 70000; });
	const bad = await app.eval(() => window.canvasAssist.testLightkey());
	assert(bad.status === 'error', 'invalid port reported');
	await app.page.locator('[data-testid=gmc-hp-input]').fill('=11');
	await app.page.locator('[data-testid=gmc-hp-input]').press('Enter');
	await app.page.waitForFunction(() => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith('11 / 28'), null, { timeout: 5000 });
	return { sent: res.status, address: res.address, bytes: pkt.length, errorCase: bad.detail };
});

await step('C11', 'Ошибок плагина в консоли за весь прогон нет', async () => {
	const errs = app.pluginErrors();
	assert(errs.length === 0, `plugin errors: ${errs.join(' | ').slice(0, 500)}`);
	return { pluginErrors: errs.length };
});

writeFileSync(join(OUT, 'cockpit.json'), JSON.stringify({ window: { W, H }, results }, null, 2));
await app.close();
const failed = results.filter((r) => r.status !== 'PASS');
console.log(results.map((r) => `${r.id} ${r.status}`).join(' | '));
process.exit(failed.length ? 1 : 0);
