#!/usr/bin/env node
// Short smoke test for any desktop OS (Linux/macOS/Windows): isolated temp vault + profile, real app, no manual steps.
//   macOS:  OBSIDIAN_BIN=/Applications/Obsidian.app/Contents/MacOS/Obsidian node tests/e2e/smoke.mjs
//   release build: CA_E2E_FROM_RELEASE=1 (after `npm run release`)
//   corrupt reference file check: SMOKE_CORRUPT_SRD=1
// Writes tests/e2e/out/smoke-<platform>.json. Never touches a real vault.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, launchTrusted, OUT, sleep } from './lib.mjs';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.CA_E2E_CHILD) {
	const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, CA_E2E_CHILD: '1' } });
	process.exit(r.status ?? 1);
}
mkdirSync(OUT, { recursive: true });
const A = 'Приключение А';
const corrupt = !!process.env.SMOKE_CORRUPT_SRD;
const results = [];
const sb = createSandbox(corrupt ? 'smoke-corrupt' : 'smoke', [], { width: 1280, height: 800 });
if (corrupt) writeFileSync(join(sb.vault, '.obsidian', 'plugins', 'canvas-assist', 'srd51.json'), '{"meta": broken');
const app = await launchTrusted(sb, { width: 1280, height: 800 });
const L = (id) => app.page.locator(`[data-testid="${id}"]`);
async function step(id, title, fn) {
	try { results.push({ id, title, status: 'PASS', evidence: (await fn()) ?? null }); console.log(`PASS ${id} ${title}`); } catch (e) { results.push({ id, title, status: 'FAIL', error: String(e?.message ?? e).slice(0, 600) }); console.log(`FAIL ${id} ${title}\n  ${e?.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(`ASSERT: ${m}`); };
const env = await app.eval(() => ({ ua: navigator.userAgent, v: window.app.plugins.manifests['canvas-assist'].version }));
await step('S1', 'Плагин загружен', async () => { assert(await app.eval(() => !!window.canvasAssist?.ctl), 'plugin object'); return env; });
await step('S2', corrupt ? 'Справочник SRD повреждён: плагин жив, встроенный справочник отключён' : 'Справочник SRD загружен офлайн из папки плагина', async () => {
	const counts = await app.eval(() => window.canvasAssist.srdCounts());
	if (corrupt) assert(counts === null, 'counts must be null for a corrupt file');
	else assert(counts && counts.spells >= 318 && counts.monsters >= 300, JSON.stringify(counts));
	return counts;
});
await app.eval(async (a) => { await window.canvasAssist.ctl.registerAdventure(a, a); }, A);
await app.openFile(`${A}/Холсты/02.canvas`);
await sleep(1500);
await step('S3', 'Двойной клик по узлу персонажа открывает карточку', async () => {
	await app.eval(() => window.app.workspace.leftSplit.collapse());
	await sleep(400);
	await app.command('canvas-assist:cockpit-open');
	const p = await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; for (const n of c.nodes.values()) if (n.file) { const r = n.nodeEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } return null; });
	await app.page.mouse.dblclick(p.x, p.y);
	await L('gmc-card').waitFor({ timeout: 6000 });
});
await step('S4', 'Правка HP сохраняется на диск', async () => {
	await L('gmc-hp-input').fill('-3');
	await L('gmc-hp-input').press('Enter');
	await sleep(700);
	const hp = await app.eval(() => Object.values(window.canvasAssist.ctl.state.characters)[0].hp.current);
	assert(hp === 14, `hp ${hp}`);
});
if (!corrupt) await step('S5', 'Быстрый NPC и оружие из SRD (кинжал: 2 зм)', async () => {
	await L('gmc-new-npc').click();
	await L('qn-query').fill('Гоблин с кинжалом');
	await L('qn-create').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	await L('gmc-attack-dagger').click();
	assert((await L('gmc-w-cost').innerText()) === '2 зм', 'cost');
});
if (corrupt) await step('S5', 'Без справочника работают пользовательские данные: свой предмет и заклинание вручную', async () => {
	await L('gmc-inv').click();
	await L('gmc-add-item').click();
	await L('ai-custom-name').fill('Мой амулет');
	await L('ai-custom-add').click();
	await sleep(500);
	assert((await app.eval(() => Object.values(window.canvasAssist.ctl.state.extensions.cockpit.items).some((i) => i.name === 'Мой амулет'))), 'custom item stored');
});
await step('S6', 'Нет ошибок плагина в консоли', async () => { const e = app.pluginErrors().filter((x) => !(corrupt && /SRD data not loaded/.test(x))); assert(e.length === 0, e.join(' | ')); });
await app.screenshot(corrupt ? 'smoke-corrupt' : 'smoke');
writeFileSync(join(OUT, `smoke-${process.platform}${corrupt ? '-corrupt-srd' : ''}.json`), JSON.stringify({ platform: process.platform, arch: process.arch, obsidian: env, results }, null, 2));
await app.close();
process.exit(results.some((r) => r.status !== 'PASS') ? 1 : 0);
