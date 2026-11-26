#!/usr/bin/env node
// Scenario J: upgrade from the released v1.0.0 (dist/canvas-assist-1.0.0.zip) to the current build.
// Data, settings, history and registered adventures must survive; the new panel must work on old state.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, installPlugin, launchTrusted, ObsidianApp, OUT, PLUGIN_ID, REPO, sleep } from './lib.mjs';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.CA_E2E_CHILD) {
	const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, CA_E2E_CHILD: '1' } });
	process.exit(r.status ?? 1);
}
mkdirSync(OUT, { recursive: true });
const A = 'Приключение А';
const zip = join(REPO, 'dist', 'canvas-assist-1.0.0.zip');
const v1dir = join(OUT, 'v1-release');
rmSync(v1dir, { recursive: true, force: true });
mkdirSync(v1dir, { recursive: true });
const un = spawnSync('unzip', ['-o', '-q', zip, '-d', v1dir]);
if (un.status !== 0) throw new Error('cannot unzip v1 release');
const v1plugin = join(v1dir, 'canvas-assist');
const results = [];
const assert = (c, m) => { if (!c) throw new Error(`ASSERT: ${m}`); };
async function step(id, title, fn) {
	try { results.push({ id, title, status: 'PASS', evidence: (await fn()) ?? null }); console.log(`PASS ${id} ${title}`); } catch (e) { results.push({ id, title, status: 'FAIL', error: String(e?.message ?? e) }); console.log(`FAIL ${id} ${title}\n  ${e?.message}`); }
}

const sb = createSandbox('upgrade', [], { width: 1280, height: 800 });
const pdir = join(sb.vault, '.obsidian', 'plugins', PLUGIN_ID);
for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(join(v1plugin, f), join(pdir, f));
const v1manifest = JSON.parse(readFileSync(join(pdir, 'manifest.json'), 'utf8'));

let app = await launchTrusted(sb, { width: 1280, height: 800 });
let hpBefore;
await step('J1', `Установлена v${v1manifest.version}: приключение, урон, настройки`, async () => {
	assert((await app.eval((id) => window.app.plugins.manifests[id].version, PLUGIN_ID)) === v1manifest.version, 'v1 running');
	assert(!(await app.eval(() => !!window.app.workspace.getLeavesOfType('gm-cockpit-panel').length || !!window.app.commands.commands['canvas-assist:cockpit-open'])), 'v1 has no cockpit');
	await app.eval(async (a) => { await window.canvasAssist.ctl.registerAdventure(a, a); }, A);
	await app.openFile(`${A}/Холсты/02.canvas`);
	await sleep(1200);
	const id = await app.eval(() => Object.keys(window.canvasAssist.ctl.state.characters)[0]);
	await app.eval(async (id) => { const o = await window.canvasAssist.ctl.act({ type: 'hp/damage', target: { kind: 'character', id }, amount: 4, useTemporary: false }); if (!o.ok) throw new Error(o.error); window.canvasAssist.ctl.settings.skipDefeated = false; window.canvasAssist.ctl.settings.hotkeys.damage = 'Shift+Q'; await window.app.plugins.plugins['canvas-assist'].saveSettings(); }, id);
	hpBefore = await app.eval((id) => window.canvasAssist.ctl.state.characters[id].hp, id);
	await sleep(800);
	return { hp: hpBefore };
});
await app.close();
installPlugin(sb.vault);
app = new ObsidianApp(sb, { width: 1280, height: 800 });
await app.launch();
await app.enablePlugin();
const newManifest = JSON.parse(readFileSync(join(REPO, 'manifest.json'), 'utf8'));
await step('J2', 'После обновления: версия, данные, настройки, реестр, история сохранены', async () => {
	assert((await app.eval((id) => window.app.plugins.manifests[id].version, PLUGIN_ID)) === newManifest.version, 'new version running');
	await app.openFile(`${A}/Холсты/02.canvas`);
	await sleep(1500);
	const r = await app.eval(() => { const c = window.canvasAssist.ctl; const id = Object.keys(c.state.characters)[0]; return { hp: c.state.characters[id].hp, skip: c.settings.skipDefeated, key: c.settings.hotkeys.damage, adventures: c.settings.adventures.length, undo: c.state.history.undo.length, schema: c.state.schemaVersion, dblclick: c.settings.cockpitDoubleClick, lk: c.settings.lightkey.port }; });
	assert(JSON.stringify(r.hp) === JSON.stringify(hpBefore), 'hp preserved');
	assert(r.skip === false && r.key === 'Shift+Q' && r.adventures === 1 && r.undo >= 1 && r.schema === 2, JSON.stringify(r));
	assert(r.dblclick === true && r.lk === 21600, 'new settings get defaults');
	return r;
});
await step('J3', 'Новая панель работает на старом состоянии; Undo действия из v1 работает', async () => {
	await app.command('canvas-assist:cockpit-open');
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), await app.eval(() => Object.keys(window.canvasAssist.ctl.state.characters)[0]));
	await app.page.waitForSelector('[data-testid=gmc-card]', { timeout: 6000 });
	assert((await app.page.locator('[data-testid=gmc-hp-text]').innerText()).startsWith(`${hpBefore.current} / ${hpBefore.max}`), 'card shows v1 hp');
	await app.page.locator('[data-testid=gmc-undo]').click();
	await app.page.waitForFunction((n) => document.querySelector('[data-testid=gmc-hp-text]')?.textContent?.startsWith(String(n)), hpBefore.current + 4, { timeout: 5000 });
	const st = JSON.parse(readFileSync(join(sb.vault, A, '.canvas-assist-state.json'), 'utf8'));
	assert(st.schemaVersion === 2 && !!st.extensions, 'sidecar schema unchanged (v2)');
	assert(app.pluginErrors().length === 0, `plugin errors ${app.pluginErrors()}`);
});

// ---- second path: 1.1.0 -> current (cockpit data written by 1.1.0 must survive and keep resolving) -------------------
const zip11 = join(REPO, 'dist', 'canvas-assist-1.1.0.zip');
const v11dir = join(OUT, 'v110-release');
rmSync(v11dir, { recursive: true, force: true });
mkdirSync(v11dir, { recursive: true });
if (spawnSync('unzip', ['-o', '-q', zip11, '-d', v11dir]).status !== 0) throw new Error('cannot unzip 1.1.0');
await app.close();
const sb2 = createSandbox('upgrade110', [], { width: 1280, height: 800 });
const pdir2 = join(sb2.vault, '.obsidian', 'plugins', PLUGIN_ID);
for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(join(v11dir, 'canvas-assist', f), join(pdir2, f));
rmSync(join(pdir2, 'srd51.json'), { force: true });
let app2 = await launchTrusted(sb2, { width: 1280, height: 800 });
let alex;
await step('K1', 'Установлена 1.1.0: оружие со старым id, NPC со статблоком, заклинание в библиотеке, настройки света, точка обзора', async () => {
	assert((await app2.eval((id) => window.app.plugins.manifests[id].version, PLUGIN_ID)) === '1.1.0', 'v1.1.0 running');
	await app2.eval(async (a) => { await window.canvasAssist.ctl.registerAdventure(a, a); }, A);
	await app2.openFile(`${A}/Холсты/02.canvas`);
	await sleep(1200);
	alex = await app2.eval(() => Object.keys(window.canvasAssist.ctl.state.characters)[0]);
	await app2.eval(async (alex) => {
		const ctl = window.canvasAssist.ctl;
		const ok = async (p) => { const o = await ctl.act(p); if (!o.ok) throw new Error(o.error); };
		await ok({ type: 'cockpit/item-upsert', item: { id: 'old-xbow', typeId: 'light-crossbow', name: 'Лёгкий арбалет', ownerKind: 'character', ownerId: alex, containerId: null, qty: 1, equipped: true, magicBonus: 0, note: '' } });
		await ok({ type: 'cockpit/item-upsert', item: { id: 'old-rope', typeId: 'rope', name: 'Верёвка', ownerKind: 'character', ownerId: alex, containerId: null, qty: 1, equipped: false, magicBonus: 0, note: '' } });
		const ab = { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 };
		await ok({ type: 'cockpit/npc-create', creature: { id: 'crt-old', name: 'Гоблин', aliases: [], ac: 15, hpMax: 7, initiativeModifier: 2, speed: '30 фт', notes: '', source: null }, statblock: { creatureId: 'crt-old', kind: 'monster', type: 'x', role: '', cr: '1/4', profBonus: 2, abilities: ab, saves: '', skills: '', resist: '', immune: '', vuln: '', conditionImmune: '', senses: '', languages: '', speed: '30 фт', traits: [], actions: [], attacks: [{ id: 'scimitar', name: 'Скимитар', bonus: 4, damage: '1d6+2', damageType: 'рубящий', range: '5 фт', notes: '' }], origin: 'official', sourceNote: 'v1.1.0' }, items: [], purse: { pp: 0, gp: 3, ep: 0, sp: 0, cp: 0 } });
		ctl.settings.spells = [{ id: 'my-spell', name: 'Моё заклинание', level: 1, school: 'Вызов', castingTime: '1 действие', range: '30 фт', components: 'В', duration: 'Мгновенная', concentration: false, text: 'Текст GM', source: 'GM', origin: 'manual' }];
		ctl.settings.cues = [{ id: 'c1', cardId: 'my-spell', address: '/live/P/cue/C/activate', command: 'activate', args: [], autoStart: false }];
		ctl.settings.lightkey.port = 12345;
		await window.app.plugins.plugins['canvas-assist'].saveSettings();
	}, alex);
	await sleep(800);
});
await app2.close();
installPlugin(sb2.vault);
app2 = new ObsidianApp(sb2, { width: 1280, height: 800 });
await app2.launch();
await app2.enablePlugin();
await step('K2', 'После обновления 1.1.0 → текущая: старые id предметов находят SRD-тип, данные, библиотека и настройки целы', async () => {
	assert((await app2.eval((id) => window.app.plugins.manifests[id].version, PLUGIN_ID)) === newManifest.version, 'new version');
	await app2.openFile(`${A}/Холсты/02.canvas`);
	await sleep(1500);
	const r = await app2.eval(() => { const c = window.canvasAssist.ctl; const st = c.state; return { srd: !!window.app.plugins.plugins['canvas-assist'], items: Object.keys(st.extensions.cockpit.items), spells: c.settings.spells.map((s) => s.id), cues: c.settings.cues.length, port: c.settings.lightkey.port, creature: st.creatures['crt-old']?.name, sb: st.extensions.cockpit.statblocks['crt-old']?.attacks?.[0]?.name, purse: st.extensions.cockpit.purses['crt-old']?.gp }; });
	assert(r.items.includes('old-xbow') && r.items.includes('old-rope'), JSON.stringify(r));
	assert(r.spells[0] === 'my-spell' && r.cues === 1 && r.port === 12345, 'settings and library kept');
	assert(r.creature === 'Гоблин' && r.sb === 'Скимитар' && r.purse === 3, 'creature, statblock and purse kept as typed by the GM');
	await app2.command('canvas-assist:cockpit-open');
	await app2.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), alex);
	await app2.page.waitForSelector('[data-testid=gmc-card]', { timeout: 6000 });
	await app2.page.locator('[data-testid=gmc-inv]').click();
	const txt = await app2.page.locator('[data-testid=gmc-inventory]').innerText();
	assert(txt.includes('25 зм') && txt.includes('1d8'), `old light-crossbow id resolves to the SRD "Crossbow, light": ${txt}`);
	assert(txt.includes('10 фнт') || txt.includes('1 зм'), 'rope (old id) resolves too');
	assert(app2.pluginErrors().length === 0, `plugin errors ${app2.pluginErrors()}`);
});
await app2.close();
writeFileSync(join(OUT, 'upgrade.json'), JSON.stringify({ from: v1manifest.version, to: newManifest.version, results }, null, 2));
process.exit(results.some((r) => r.status !== 'PASS') ? 1 : 0);
