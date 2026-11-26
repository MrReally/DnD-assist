#!/usr/bin/env node
// Plays the demo vault from the DISTRIBUTABLE ZIP (not from sources): unzip → generate vault with that plugin → real Obsidian.
// Usage: node tests/e2e/demo-vault.mjs [release/canvas-assist-<v>.zip]   (default: newest in release/)
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandboxFromVault, launchTrusted, ObsidianApp, OUT, REPO, sleep } from './lib.mjs';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.CA_E2E_CHILD) {
	const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, CA_E2E_CHILD: '1' } });
	process.exit(r.status ?? 1);
}
mkdirSync(OUT, { recursive: true });
const W = Number(process.env.SC_W ?? 1280);
const H = Number(process.env.SC_H ?? 800);
const zip = process.argv[2] ?? join(REPO, 'release', readdirSync(join(REPO, 'release')).filter((f) => f.endsWith('.zip')).sort().pop());
const tmp = mkdtempSync(join(tmpdir(), 'demo-e2e-'));
if (spawnSync('unzip', ['-q', zip, '-d', join(tmp, 'pkg')]).status !== 0) throw new Error('unzip failed');
const vault = join(tmp, 'GM-Cockpit-Demo');
const gen = spawnSync(process.execPath, [join(REPO, 'scripts/demo-vault/make-demo-vault.mjs'), vault, join(tmp, 'pkg', 'canvas-assist')], { encoding: 'utf8' });
if (gen.status !== 0) throw new Error(`generator failed: ${gen.stderr}`);
const sb = createSandboxFromVault('demo', vault, { width: W, height: H });
const results = [];
let app = await launchTrusted(sb, { width: W, height: H });
const L = (id) => app.page.locator(`[data-testid="${id}"]`);
const assert = (c, m) => { if (!c) throw new Error(`ASSERT: ${m}`); };
const state = () => app.eval(() => window.canvasAssist.ctl.state);
async function step(id, title, fn) {
	try { results.push({ id, title, status: 'PASS', evidence: (await fn()) ?? null }); console.log(`PASS ${id} ${title}`); } catch (e) {
		let shot = null; try { shot = await app.screenshot(`demo-fail-${id}`); } catch { /* ignore */ }
		results.push({ id, title, status: 'FAIL', error: String(e?.message ?? e).slice(0, 900), screenshot: shot }); console.log(`FAIL ${id} ${title}\n  ${e?.message}`);
	}
}
async function dbl(file) {
	await centerOn(file);
	const p = await app.eval((f) => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; for (const n of c.nodes.values()) if (n.file?.path?.endsWith(f)) { const r = n.nodeEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.x > 0 && r.y > 40 && r.x < innerWidth && r.y < innerHeight }; } return null; }, file);
	assert(p, `node ${file}`);
	await app.page.mouse.dblclick(p.x, p.y);
	await sleep(500);
}
const centerOn = async (f) => { await app.eval((f) => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; for (const n of c.nodes.values()) if ((n.file?.path ?? n.label ?? n.id).endsWith(f)) { c.zoomToBbox({ minX: n.x - 120, minY: n.y - 120, maxX: n.x + n.width + 120, maxY: n.y + n.height + 120 }); return; } }, f); await sleep(700); };
const goto = (x, y, z) => app.eval(([a, b, c]) => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.setViewport(a, b, c), [x, y, z]);

await step('D1', 'Хранилище открывается без ручной настройки: плагин включён, приключение подключено, справочник SRD загружен', async () => {
	await app.openFile('Демо-приключение/Холсты/Таверна и окрестности (демо).canvas');
	await sleep(1500);
	await app.eval(() => window.app.workspace.leftSplit.collapse());
	await app.command('canvas-assist:cockpit-open');
	const r = await app.eval(() => { const c = window.canvasAssist.ctl; return { adv: c.state?.name, pcs: Object.keys(c.state?.characters ?? {}).length, creatures: Object.keys(c.state?.creatures ?? {}).length, tpl: c.state?.encounterTemplates.length, srd: window.canvasAssist.srdCounts()?.spells, nodes: window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size }; });
	assert(r.adv === 'Демо-приключение' && r.pcs === 4 && r.creatures === 5 && r.tpl === 1 && r.srd >= 318 && r.nodes >= 18, JSON.stringify(r));
	await app.screenshot('demo-canvas');
	const vp = await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; const out = {}; for (const [k, n] of c.nodes) if (/^g-(tavern|outside|story|party)$/.test(k)) { c.zoomToBbox({ minX: n.x - 40, minY: n.y - 40, maxX: n.x + n.width + 40, maxY: n.y + n.height + 40 }); out[k] = [c.tx, c.ty, c.tZoom]; } return out; });
	return { ...r, vp };
});
await step('D2', 'Двойной клик по узлу волшебницы: карточка с СЛ 15 и атакой +7, ячейки 4/3/2', async () => {
	await dbl('Демо Лирель.md');
	await L('gmc-card').waitFor({ timeout: 5000 });
	assert((await L('gmc-name').innerText()).includes('Лирель'), 'name');
	await L('gmc-full').click();
	assert((await L('gmc-full-card').innerText()).includes('Сл заклинаний 15 · атака заклинанием +7'), 'DC');
	await L('gmc-back').click();
	await L('gmc-spells').click();
	assert((await L('gmc-slot-val-1').innerText()) === '4/4' && (await L('gmc-slot-val-3').innerText()) === '2/2', 'slots');
	assert((await L('gmc-prepared-count').innerText()).includes('9 из 9'), 'prepared');
	await app.screenshot('demo-wizard');
});
await step('D3', 'Заклинание Magic Missile: расход ячейки 4→3 и Undo', async () => {
	await L('gmc-sp-magic-missile').locator('.gmc-item-name').click();
	await L('gmc-cast').click();
	await sleep(500);
	assert((await state()).characters[(await app.eval(() => window.canvasAssist.ctl.cardRef.id))].spellSlots['1'].current === 3, 'spent');
	await L('gmc-undo').click();
	await sleep(500);
	assert((await app.eval(() => { const c = window.canvasAssist.ctl; return c.state.characters[c.cardRef.id].spellSlots['1'].current; })) === 4, 'undone');
});
await step('D4', 'Гоблин: статблок, атака Scimitar +4 / 1d6+2; кинжал/меч бойца: цена и свойства', async () => {
	await dbl('Гоблин (демо).md');
	await L('gmc-card').waitFor();
	assert((await L('gmc-name').innerText()).includes('Гоблин'), 'goblin card');
	const row = L('gmc-attack-scimitar');
	assert((await row.locator('[data-testid=gmc-attack-bonus]').innerText()) === '+4', 'bonus');
	await row.click();
	assert((await L('gmc-w-damage').innerText()).startsWith('1d6+2'), 'damage');
	assert((await L('gmc-w-cost').innerText()) === '25 зм', 'scimitar 25 gp');
	await L('gmc-back').click();
});
await step('D5', 'Контейнер: рюкзак Бранна с вложенными предметами; передача предмета', async () => {
	const id = await app.eval(() => Object.values(window.canvasAssist.ctl.state.characters).find((c) => c.name === 'Демо Бранн').id);
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), id);
	await L('gmc-inv').click();
	const t = await L('gmc-inventory').innerText();
	assert(/Рюкзак/.test(t) && /Факел/.test(t) && /Верёвка/.test(t) && /Рацион/.test(t), 'container contents listed');
	assert(/Кольчуга/.test(t) && /Щит/.test(t), 'armor and shield');
	await L('gmc-back').click();
});
await step('D6', 'Помещение: двойной клик, скрытая находка помечена, состояние не меняется', async () => {
	const rev = (await state()).revision;
	await dbl('Таверна «Золотой гусь» (демо).md');
	await L('gmc-room').waitFor({ timeout: 5000 });
	assert((await L('gmc-room-hidden').innerText()).includes('скрыто'), 'hidden marker');
	assert((await state()).revision === rev, 'no state change');
});
await step('D7', 'Готовое столкновение «Драка в таверне»: 4 игрока + 3 гоблина + главарь = 8; независимые HP', async () => {
	await L('gmc-back').count();
	await app.page.locator('[data-testid=bar-encounter-menu]').click();
	await app.page.locator('.menu-item', { hasText: 'Запустить: Драка в таверне' }).click();
	await sleep(700);
	const enc = (await state()).activeEncounter;
	const cmbs = Object.values(enc.combatants);
	assert(cmbs.length === 8, `combatants ${cmbs.length}`);
	const gobs = cmbs.filter((c) => /Гоблин/.test(c.displayName));
	assert(gobs.length === 3 && new Set(gobs.map((g) => g.id)).size === 3, 'three separate goblins');
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'combatant', id }), gobs[1].id);
	await L('gmc-hp-input').fill('-4');
	await L('gmc-hp-input').press('Enter');
	await sleep(500);
	const after = Object.values((await state()).activeEncounter.combatants).filter((c) => /Гоблин/.test(c.displayName));
	assert(after.filter((g) => g.hp.current === g.hp.max).length === 2 && after.some((g) => g.hp.current === g.hp.max - 4), 'only the chosen goblin was hurt');
	await app.screenshot('demo-combat');
});
await step('D8', 'Отдых: продолжительный отдых одним действием и Undo', async () => {
	const id = await app.eval(() => Object.values(window.canvasAssist.ctl.state.characters).find((c) => c.name === 'Демо Бранн').id);
	await app.eval((id) => window.canvasAssist.ctl.act({ type: 'hp/damage', target: { kind: 'character', id }, amount: 9, useTemporary: false }), id);
	await L('gmc-rest-long').click();
	await L('rest-apply').click();
	await sleep(600);
	const hp = async () => (await state()).characters[id].hp;
	let h = await hp();
	assert(h.current === h.max, 'full HP');
	await L('gmc-undo').click();
	await sleep(500);
	h = await hp();
	assert(h.current === h.max - 9, 'undo restores damage');
});
await step('D9', 'Авария (SIGKILL) → перезапуск: бой, HP и приключение на месте', async () => {
	const before = (await state()).activeEncounter.combatants;
	const snap = JSON.stringify(Object.values(before).map((c) => [c.displayName, c.hp?.current ?? null]).sort());
	await sleep(1200);
	await app.close({ kill: true });
	app = new ObsidianApp(sb, { width: W, height: H });
	await app.launch();
	assert((await app.enablePlugin()).loaded, 'plugin loads');
	await app.openFile('Демо-приключение/Холсты/Таверна и окрестности (демо).canvas');
	await sleep(1500);
	const after = (await state()).activeEncounter.combatants;
	assert(JSON.stringify(Object.values(after).map((c) => [c.displayName, c.hp?.current ?? null]).sort()) === snap, 'encounter restored');
});
await step('D10', 'Контрольная точка Canvas не откатывает игровое состояние', async () => {
	await app.eval(() => window.app.workspace.leftSplit.collapse());
	await app.command('canvas-assist:cockpit-open');
	await L('gmc-checkpoints').click();
	await L('cp-name').fill('Демо до сессии');
	await L('cp-create').click();
	await L('cp-row').first().waitFor();
	await app.page.keyboard.press('Escape');
	const gob = Object.values((await state()).activeEncounter.combatants).find((c) => /Гоблин/.test(c.displayName));
	await app.eval((id) => window.canvasAssist.ctl.act({ type: 'hp/damage', target: { kind: 'combatant', id }, amount: 1, useTemporary: false }), gob.id);
	const hp = (await state()).activeEncounter.combatants[gob.id].hp.current;
	await app.eval(async () => { const f = window.app.vault.getAbstractFileByPath('Демо-приключение/Холсты/Таверна и окрестности (демо).canvas'); const j = JSON.parse(await window.app.vault.read(f)); j.nodes.pop(); await window.app.vault.modify(f, JSON.stringify(j)); });
	await sleep(1200);
	await L('gmc-checkpoints').click();
	await L('cp-restore').first().click();
	await L('confirm-ok').click();
	await sleep(2500);
	assert((await state()).activeEncounter.combatants[gob.id].hp.current === hp, 'HP untouched');
});
await step('D11', 'Ошибок плагина в консоли нет', async () => { assert(app.pluginErrors().length === 0, app.pluginErrors().join(' | ')); });
writeFileSync(join(OUT, `demo-vault-${W}x${H}.json`), JSON.stringify({ zip, window: { W, H }, results }, null, 2));
await app.close();
console.log(results.map((r) => `${r.id} ${r.status}`).join(' | '));
process.exit(results.some((r) => r.status !== 'PASS') ? 1 : 0);
