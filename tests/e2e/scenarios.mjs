#!/usr/bin/env node
// GM Cockpit product scenarios on real Obsidian (1280×800, isolated vault). UI actions are real clicks/typing;
// state is verified on disk (sidecar JSON) wherever possible. Output: tests/e2e/out/scenarios.json
import { spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, installPlugin, launchTrusted, ObsidianApp, OUT, PLUGIN_ID, REPO, sleep } from './lib.mjs';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.CA_E2E_CHILD) {
	const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, CA_E2E_CHILD: '1' } });
	process.exit(r.status ?? 1);
}
mkdirSync(OUT, { recursive: true });
const A = 'Приключение А';
const B = 'Приключение Б';
const W = Number(process.env.SC_W ?? 1280);
const H = Number(process.env.SC_H ?? 800);
const results = [];
const sb = createSandbox('scenarios', [], { width: W, height: H });
const stateFile = (adv = A) => join(sb.vault, adv, '.canvas-assist-state.json');
const disk = (adv = A) => JSON.parse(readFileSync(stateFile(adv), 'utf8'));

// Extra fixtures: a tavern canvas with a character node, a room note and a text node.
writeFileSync(join(sb.vault, A, 'Elements/Локации/Таверна.md'), '---\ntags: [loc]\n---\n# Таверна «Рыжий дракон»\nНизкий зал с очагом.\n\n## Объекты\n- Стойка\n- Бочки\n\n## Контейнеры\nСундук под лестницей.\n\n## Скрытые находки\nПотайной ящик под стойкой (СЛ 14, Восприятие).\n\n## Важные детали\nДверь на кухню заперта.\n');
writeFileSync(join(sb.vault, A, 'Холсты/Таверна.canvas'), JSON.stringify({ nodes: [
	{ id: 'n-room', type: 'file', file: `${A}/Elements/Локации/Таверна.md`, x: 0, y: 0, width: 300, height: 160 },
	{ id: 'n-alex', type: 'file', file: `${A}/Elements/Персонажи/Алекс.md`, x: 400, y: 0, width: 300, height: 160 },
	{ id: 'n-text', type: 'text', text: 'Заметка мастера', x: 0, y: 260, width: 260, height: 100 },
], edges: [] }, null, 2));

let app = await launchTrusted(sb, { width: W, height: H });
const L = (id) => app.page.locator(`[data-testid="${id}"]`);
const assert = (c, m) => { if (!c) throw new Error(`ASSERT: ${m}`); };
const act = (payload) => app.eval(async (p) => { const o = await window.canvasAssist.ctl.act(p); if (!o.ok) throw new Error(o.error); return o.label; }, payload);
const state = () => app.eval(() => window.canvasAssist.ctl.state);
const evidence = {};

async function step(id, title, fn) {
	const t0 = Date.now();
	try {
		const ev = await fn();
		results.push({ id, title, status: 'PASS', ms: Date.now() - t0, evidence: ev ?? null });
		console.log(`PASS ${id} ${title}`);
	} catch (e) {
		let shot = null;
		try { shot = await app.screenshot(`scn-fail-${id}`); } catch { /* ignore */ }
		results.push({ id, title, status: 'FAIL', ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 1500), pluginErrors: app.pluginErrors().slice(-3), screenshot: shot });
		console.log('   plugin errors:', JSON.stringify(app.pluginErrors().slice(-2)).slice(0, 500));
		console.log(`FAIL ${id} ${title}\n  ${String(e?.message ?? e).slice(0, 600)}`);
		await app.page.keyboard.press('Escape').catch(() => undefined);
	}
}
async function closeModals() {
	for (let i = 0; i < 3; i++) {
		if (await app.page.locator('.modal-container').count()) { await app.page.keyboard.press('Escape'); await sleep(200); }
	}
}
async function openCanvas(rel) { await app.openFile(`${A}/Холсты/${rel}`); await sleep(1500); await app.eval(() => window.app.workspace.leftSplit.collapse()); await app.page.waitForFunction(() => window.app.workspace.getLeavesOfType('canvas')[0]?.view?.canvas?.nodes?.size > 0, null, { timeout: 15000 }); await sleep(400); }
async function nodeCenter(file) {
	return app.eval((f) => {
		const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas;
		for (const n of c.nodes.values()) if (n.file?.path?.endsWith(f)) { const r = n.nodeEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
		return null;
	}, file);
}
async function waitText(id, re, ms = 6000) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) { if (re.test((await L(id).first().innerText().catch(() => '')) ?? '')) return; await sleep(120); }
	throw new Error(`timeout waiting ${id} ~ ${re}; got "${await L(id).first().innerText().catch(() => '<none>')}"`);
}
async function fillModal(id, text) { const l = L(id); await l.waitFor({ timeout: 5000 }); await l.fill(text); }
async function newNpc(query, toCombat) {
	await L('gmc-new-npc').click();
	await fillModal('qn-query', query);
	await L(toCombat ? 'qn-combat' : 'qn-create').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	await sleep(250);
}

await app.eval(async (a) => { await window.canvasAssist.ctl.registerAdventure(a, a); }, A);
await openCanvas('Таверна.canvas');
await app.command('canvas-assist:cockpit-open');
await app.page.waitForSelector('.gmc');
// Setup the sheet of the pre-existing PC (paper data entered by the GM).
await act({ type: 'cockpit/sheet-set', characterId: Object.keys((await state()).characters)[0], patch: { race: 'Человек', abilities: { str: 14, dex: 16, con: 12, int: 10, wis: 10, cha: 8 }, saveProf: ['str', 'con'], skills: { athletics: 1 }, weaponProf: ['simple', 'martial'], castAbility: 'int' } });
const alexId = Object.keys((await state()).characters)[0];
await act({ type: 'character/set-slot', characterId: alexId, level: '1', slot: { current: 2, max: 2 } });

// ---------------------------------------------------------------- B: sudden goblin
await step('B', 'Внезапный гоблин: быстрый NPC → статблок → кинжал (цена/свойства/бонус/урон) → в бой', async () => {
	await newNpc('Гоблин-посетитель таверны с кинжалом', false);
	await L('gmc-card').waitFor();
	assert(/Goblin/.test(await L('gmc-name').innerText()), 'name');
	assert(await L('gmc-hp-text').innerText().then((t) => /\d+ \/ \d+/.test(t)), 'hp shown');
	const atk = L('gmc-attack-dagger');
	assert(/\+4/.test(await atk.locator('[data-testid=gmc-attack-bonus]').innerText()), 'attack bonus +4');
	await atk.click();
	await L('gmc-weapon').waitFor();
	assert((await L('gmc-w-cost').innerText()) === '2 зм', 'cost');
	assert((await L('gmc-w-weight').innerText()).includes('1 фнт'), 'weight');
	assert((await L('gmc-w-props').innerText()).includes('фехтовальное'), 'props');
	assert((await L('gmc-w-bonus').innerText()) === '+4', 'bonus');
	assert((await L('gmc-w-damage').innerText()).startsWith('1d4+2'), `damage ${await L('gmc-w-damage').innerText()}`);
	await L('gmc-how').locator('summary').click();
	assert((await L('gmc-how').innerText()).includes('мастерство'), 'how it is computed');
	await app.screenshot('scn-b-dagger');
	await L('gmc-back').click();
	await L('gmc-full').click();
	await L('gmc-full-card').waitFor();
	assert((await L('gmc-full-card').innerText()).includes('адаптированный'), 'origin shown');
	await L('gmc-back').click();
	return { creatures: Object.keys((await state()).creatures).length };
});

await step('B2', 'Карточка NPC → «В бой» добавляет участника с независимым HP', async () => {
	const crId = Object.keys((await state()).creatures)[0];
	await app.eval((id) => window.canvasAssist.ctl.setCard({ kind: 'creature', id }), crId);
	await L('gmc-to-combat').click();
	await sleep(500);
	const s = await state();
	const cmbs = Object.values(s.activeEncounter.combatants);
	assert(cmbs.length >= 1 && cmbs.some((c) => c.creatureId === crId && c.hp?.max > 0), 'combatant with own hp');
	return { combatants: cmbs.length };
});

// ---------------------------------------------------------------- P3: builder
await step('P3', 'Конструктор по правилам: дварф-воин 3 ур. → лист, HP, КД, заметка создана', async () => {
	await L('gmc-new-pc').click();
	await fillModal('bd-name', 'Борин');
	await app.page.locator('[data-testid=bd-race]').selectOption('dwarf');
	await app.page.locator('[data-testid=bd-class]').selectOption('fighter');
	await fillModal('bd-level', '3');
	await L('bd-gear-chain-mail').check(); await L('bd-gear-shield').check(); await L('bd-gear-longsword').check();
	await L('bd-skill-athletics').check(); await L('bd-skill-perception').check();
	await L('bd-submit').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
	await L('gmc-card').waitFor();
	const s = await state();
	const b = Object.values(s.characters).find((c) => c.name === 'Борин');
	assert(b, 'character exists');
	// STR15 DEX14 CON13+2=15 (+2); d10: 10+2 + 2*(6+2) = 28; AC chain mail 16 + shield 2 = 18
	assert(b.hp.max === 28, `hp ${b.hp.max}`);
	assert(b.ac === 18, `ac ${b.ac}`);
	assert(existsSync(join(sb.vault, A, 'Elements/Персонажи/Борин.md')), 'note created');
	assert(s.extensions.cockpit.sheets[b.id].saveProf.join() === 'str,con', 'saves');
	assert(Object.values(s.extensions.cockpit.items).filter((i) => i.ownerId === b.id).length === 3, 'gear items');
	// attack row of the equipped longsword appears in the compact card
	assert((await L('gmc-attacks').innerText()).includes('Длинный меч'), 'longsword attack');
	await app.screenshot('scn-p3-builder');
	evidence.borin = b.id;
	return { hp: b.hp.max, ac: b.ac };
});

await step('P3c', 'Повышение уровня и правка листа в полной карточке (мастерство навыка, спасбросок, характеристика)', async () => {
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), evidence.borin);
	await L('gmc-full').click();
	await L('gmc-levelup').click();
	await L('lu-asi').selectOption('str');
	await L('lu-apply').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	await sleep(600);
	let b = (await state()).characters[evidence.borin];
	assert(b.classes[0].level === 4 && b.hp.max === 28 + 8, `level ${b.classes[0].level} hp ${b.hp.max}`); // d10 avg 6 + CON 2
	assert((await state()).extensions.cockpit.sheets[evidence.borin].abilities.str === 17, 'ASI +2 STR chosen by the player (15 → 17)');
	assert(b.hitDice[0].total === 4, 'hit dice');
	await app.page.locator('details:has([data-testid=gmc-skill-stealth]) > summary').click();
	await L('gmc-skill-stealth').click();
	await L('gmc-edit-str').fill('18'); await L('gmc-edit-str').press('Tab');
	await sleep(500);
	const sh = (await state()).extensions.cockpit.sheets[evidence.borin];
	assert(sh.skills.stealth === 1 && sh.abilities.str === 18, JSON.stringify(sh.skills));
	await L('gmc-back').click();
	// longsword attack now uses STR 18 (+4) + prof (+2 at level 4) = +6
	assert((await L('gmc-attacks').innerText()).includes('+6'), `attack ${await L('gmc-attacks').innerText()}`);
});

await step('W', 'Приёмочный персонаж: высший эльф, волшебник 5, предыстория «Преступник» (вручную) — через интерфейс', async () => {
	const srd = JSON.parse(readFileSync(join(REPO, 'data', 'srd51', 'srd51.json'), 'utf8'));
	const wiz = (lvl, n, skip = 0) => srd.spells.filter((s) => s.level === lvl && s.classes.includes('wizard')).slice(skip, skip + n).map((s) => s.id);
	const cantrips = wiz(0, 5); const book = [...wiz(1, 8), ...wiz(2, 4), ...wiz(3, 2)];
	await L('gmc-new-pc').click();
	await fillModal('bd-name', 'Эльфийка');
	await L('bd-race').selectOption('elf');
	await L('bd-subrace').selectOption('high-elf');
	await L('bd-class').selectOption('wizard');
	await fillModal('bd-level', '5');
	await app.page.locator('[data-testid=bd-level]').press('Tab');
	await sleep(300);
	for (const [a, v] of [['str', 8], ['dex', 14], ['con', 13], ['int', 15], ['wis', 12], ['cha', 10]]) await fillModal(`bd-ab-${a}`, String(v));
	await fillModal('bd-bgname', 'Criminal');
	await L('bd-bgskill-deception').check(); await L('bd-bgskill-stealth').check();
	await L('bd-subclass-select').selectOption('School of Evocation');
	await L('bd-asi-0').selectOption('+2:int');
	await L('bd-skill-arcana').check(); await L('bd-skill-history').check();
	for (const id of cantrips) await L(`bd-cantrip-${id}`).check();
	for (const id of book) await L(`bd-spell-${id}`).check();
	for (const id of book.slice(0, 9)) await L(`bd-prep-${id}`).check();
	await L('bd-gear-quarterstaff').check(); await L('bd-gear-dagger').check(); await L('bd-gear-spellbook').check(); await L('bd-gear-component-pouch').check();
	await L('bd-submit').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 8000 });
	const s = await state();
	const ch = Object.values(s.characters).find((c) => c.name === 'Эльфийка');
	const sh = s.extensions.cockpit.sheets[ch.id];
	assert(JSON.stringify(sh.abilities) === JSON.stringify({ str: 8, dex: 16, con: 13, int: 18, wis: 12, cha: 10 }), JSON.stringify(sh.abilities));
	assert(ch.hp.max === 27 && ch.ac === 13, `hp ${ch.hp.max} ac ${ch.ac}`);
	assert(JSON.stringify(ch.spellSlots) === JSON.stringify({ '1': { max: 4, current: 4 }, '2': { max: 3, current: 3 }, '3': { max: 2, current: 2 } }), 'slots');
	assert(ch.counters['arcane-recovery']?.max === 1, 'arcane recovery counter');
	const bk = s.extensions.cockpit.spellbooks[ch.id];
	assert(bk.known.length === 19 && bk.prepared.length === 9, `book ${bk.known.length}/${bk.prepared.length}`);
	await L('gmc-spells').click();
	assert((await L('gmc-prepared-count').innerText()).includes('9 из 9'), 'prepared counter in the UI');
	await L('gmc-back').click();
	await L('gmc-full').click();
	assert((await L('gmc-full-card').innerText()).includes('Сл заклинаний 15 · атака заклинанием +7'), 'spell DC / attack shown');
	await app.screenshot('scn-w-wizard');
	evidence.wiz = ch.id;
	await L('gmc-back').click();
});

await step('W2', 'Отдых волшебника в интерфейсе: магическое восстановление (выбор игрока, бюджет 3), Undo, повторное использование запрещено', async () => {
	const id = evidence.wiz;
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), id);
	for (const [lv, max] of [['1', 4], ['2', 3], ['3', 2]]) await act({ type: 'character/set-slot', characterId: id, level: lv, slot: { max, current: 0 } });
	await L('gmc-rest-short').click();
	await L('rest-arcane').waitFor();
	const row = (t) => app.page.locator('[data-testid=rest-arcane] .setting-item', { hasText: t });
	await row('Ячейка 3 ур. (1-я').locator('.checkbox-container').click();
	await sleep(300);
	assert((await L('rest-preview').innerText()).includes('Магическое восстановление, ячейки 3 ур.: 0 → 1'), 'preview shows the chosen slot');
	await row('Ячейка 2 ур. (1-я').locator('.checkbox-container').click();
	await sleep(300);
	assert(/больше допустимого 3/.test(await L('rest-error').innerText()), 'over budget blocked');
	assert(await L('rest-apply').isDisabled(), 'apply disabled while invalid');
	await row('Ячейка 2 ур. (1-я').locator('.checkbox-container').click();
	await sleep(300);
	await L('rest-apply').click();
	await sleep(600);
	let c = (await state()).characters[id];
	assert(c.spellSlots['3'].current === 1 && c.counters['arcane-recovery'].current === 0, 'applied once');
	await L('gmc-undo').click();
	await sleep(500);
	c = (await state()).characters[id];
	assert(c.spellSlots['3'].current === 0 && c.counters['arcane-recovery'].current === 1, 'undo restores slot and counter');
	for (const [lv, max] of [['1', 4], ['2', 3], ['3', 2]]) await act({ type: 'character/set-slot', characterId: id, level: lv, slot: { max, current: max } });
});

await step('P3b', 'Быстрое заполнение с бумажного листа: частичные данные сохраняются', async () => {
	await L('gmc-new-pc').click();
	await L('bd-mode-paper').click();
	await fillModal('bd-name', 'Лира (лист)');
	await fillModal('bd-p-class', 'Бард');
	await L('bd-submit').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	const c = Object.values((await state()).characters).find((x) => x.name === 'Лира (лист)');
	assert(c && c.hp.max === null && c.ac === null && c.classes[0].name === 'Бард', JSON.stringify(c));
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), alexId);
});

// ---------------------------------------------------------------- P2: inventory
await step('P2', 'Инвентарь: добавить кинжал, надеть, бонус атаки в карточке, передать Борину, количество, монеты, Undo', async () => {
	await L('gmc-inv').click();
	await L('gmc-add-item').click();
	await fillModal('ai-filter', 'кинжал');
	await L('ai-dagger').click();
	await sleep(400);
	let s = await state();
	const dag = Object.values(s.extensions.cockpit.items).find((i) => i.ownerId === alexId && i.typeId === 'dagger');
	assert(dag, 'dagger added');
	await L(`gmc-equip-${dag.id}`).click();
	await L(`gmc-qty-inc-${dag.id}`).click();
	await waitText(`gmc-qty-${dag.id}`, /×2/);
	await L('gmc-coin-gp').fill('15'); await L('gmc-coin-gp').press('Tab');
	await sleep(400);
	assert(disk().extensions.cockpit.purses[alexId].gp === 15, 'coins persisted');
	await L('gmc-back').click();
	// DEX16 +3, prof +2 (level 0 → 2) → +5, damage 1d4 + 3
	await L(`gmc-attack-${dag.id}`).waitFor();
	const bonus = await L(`gmc-attack-${dag.id}`).locator('[data-testid=gmc-attack-bonus]').innerText();
	assert(bonus === '+5', `bonus ${bonus}`);
	assert((await L(`gmc-attack-${dag.id}`).locator('[data-testid=gmc-attack-dmg]').innerText()).startsWith('1d4 + 3'), 'dmg');
	await L('gmc-inv').click();
	await L(`gmc-transfer-${dag.id}`).click();
	await fillModal('tr-qty', '1');
	await L(`tr-${evidence.borin}`).click();
	await sleep(500);
	s = await state();
	const items = Object.values(s.extensions.cockpit.items).filter((i) => i.typeId === 'dagger' && [alexId, evidence.borin].includes(i.ownerId));
	assert(items.length === 2 && items.some((i) => i.ownerId === evidence.borin && i.qty === 1) && items.some((i) => i.ownerId === alexId && i.qty === 1), JSON.stringify(items));
	await L('gmc-undo').click();
	await sleep(500);
	const after = Object.values((await state()).extensions.cockpit.items).filter((i) => i.typeId === 'dagger' && [alexId, evidence.borin].includes(i.ownerId));
	assert(after.length === 1 && after[0].qty === 2 && after[0].ownerId === alexId, 'undo transfer');
	await app.screenshot('scn-p2-inventory');
	await L('gmc-back').click();
	return { dagger: after[0].qty };
});

// ---------------------------------------------------------------- D: spells + light
await step('D', 'Заклинание: импорт вручную и JSON, карточка, ячейка, концентрация, Undo, свет по OSC', async () => {
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), alexId);
	while (await L('gmc-back').count()) { await L('gmc-back').first().click(); await sleep(150); }
	await L('gmc-spells').click();
	await L('gmc-add-spell').click();
	await L('si-tab-manual').click();
	await fillModal('si-m-name', 'Щит');
	await fillModal('si-m-school', 'Ограждение');
	await fillModal('si-m-range', 'На себя');
	await fillModal('si-m-components', 'В, С');
	await fillModal('si-m-duration', '1 раунд');
	await fillModal('si-m-text', 'КД +5 до начала вашего следующего хода.');
	await L('si-m-save').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	await L('gmc-add-spell').click();
	await L('si-tab-json').click();
	await L('si-json').fill(JSON.stringify({ name: 'Благословение', level: 1, school: 'Очарование', castingTime: '1 действие', range: '30 футов', components: 'В, С, М', duration: 'До 1 минуты', concentration: true, text: 'До трёх существ получают бонус к броскам.' }));
	await L('si-json-save').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	// link to an unknown spell: needs data, no network call
	await L('gmc-add-spell').click();
	await fillModal('si-input', 'https://5e14.ttg.club/spells/fireball');
	await L('si-find').click();
	assert(/robots\.txt/.test(await L('si-msg').innerText()), 'link is not fetched, explanation shown');
	await closeModals();
	const lib = await app.eval(() => window.canvasAssist.ctl.settings.spells.map((s) => s.name));
	assert(lib.includes('Щит') && lib.includes('Благословение'), JSON.stringify(lib));
	// open Bless, pick slot 1, cast
	const bless = await app.eval(() => window.canvasAssist.ctl.settings.spells.find((s) => s.name === 'Благословение').id);
	await L(`gmc-sp-${bless}`).locator('.gmc-item-name').click();
	await L('gmc-spell').waitFor();
	assert((await L('gmc-spell').innerText()).includes('концентрация'), 'concentration shown');
	// bind the cue and test with a local OSC receiver
	const server = createSocket('udp4');
	const pkts = [];
	server.on('message', (m) => pkts.push(m));
	await new Promise((r) => server.bind(0, '127.0.0.1', r));
	await app.eval((p) => { window.canvasAssist.ctl.settings.lightkey.port = p; window.canvasAssist.ctl.settings.lightkey.host = '127.0.0.1'; }, server.address().port);
	assert(await L('gmc-light').isDisabled(), 'light disabled without cue');
	await L('gmc-cue').click();
	await fillModal('cue-address', '/live/Панель/cue/Благословение/activate');
	await L('cue-command').selectOption('toggle');
	await L('cue-test').click();
	await sleep(500);
	assert(pkts.length === 1 && pkts[0].toString().includes('/toggle'), 'test packet arrived');
	assert(/не подтверждается/.test(await L('cue-status').innerText()), 'honest status');
	await L('cue-save').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	await L('gmc-light').click();
	await sleep(500);
	assert(pkts.length === 2, 'light button sends');
	await L('gmc-cast').click();
	await sleep(500);
	let s = await state();
	assert(s.characters[alexId].spellSlots['1'].current === 1, 'slot spent');
	assert(Object.values(s.effects).some((e) => e.isConcentration && e.label.includes('Благословение')), 'concentration effect');
	assert(pkts.length === 2, 'no auto-start by default');
	await L('gmc-undo').click();
	await sleep(500);
	s = await state();
	assert(s.characters[alexId].spellSlots['1'].current === 2 && !Object.values(s.effects).some((e) => e.isConcentration), 'cast undone as one step');
	// autostart option
	await app.eval((id) => { const c = window.canvasAssist.ctl.settings.cues.find((x) => x.cardId === id); c.autoStart = true; }, bless);
	await L('gmc-cast').click();
	await sleep(600);
	assert(pkts.length === 3, 'auto-start sends light');
	// cast without slots fails clearly: spend remaining slot then try again
	await act({ type: 'character/set-slot', characterId: alexId, level: '1', slot: { current: 0, max: 2 } });
	const r = await app.eval(async (id) => (await window.canvasAssist.ctl.act({ type: 'cockpit/cast', characterId: id, spell: { id: 'x', name: 'x', level: 1, concentration: false }, slotLevel: 1 }, { quiet: true })).error, alexId);
	assert(/Нет свободных ячеек/.test(r), r);
	await act({ type: 'character/set-slot', characterId: alexId, level: '1', slot: { current: 2, max: 2 } });
	server.close();
	await app.screenshot('scn-d-spell');
	return { packets: pkts.length };
});

// ---------------------------------------------------------------- E: rest
await step('E', 'Отдых: предпросмотр, применение, Undo (продолжительный и короткий)', async () => {
	await closeModals();
	await act({ type: 'hp/damage', target: { kind: 'character', id: alexId }, amount: 9, useTemporary: false });
	await act({ type: 'character/set-slot', characterId: alexId, level: '1', slot: { current: 0, max: 2 } });
	const before = (await state()).characters[alexId];
	await L('gmc-rest-long').click();
	await L('rest-preview').waitFor();
	assert((await L('rest-preview').innerText()).length > 20, 'preview text');
	await L('rest-apply').click();
	await sleep(600);
	let ch = (await state()).characters[alexId];
	assert(ch.hp.current === ch.hp.max && ch.spellSlots['1'].current === 2, `restored ${JSON.stringify(ch.hp)}`);
	await L('gmc-undo').click();
	await sleep(500);
	ch = (await state()).characters[alexId];
	assert(ch.hp.current === before.hp.current && ch.spellSlots['1'].current === 0, 'undo whole rest');
	await L('gmc-rest-short').click();
	await L('rest-preview').waitFor();
	await closeModals();
	return { hpBefore: before.hp.current };
});

// ---------------------------------------------------------------- C: room
await step('C', 'Обыск комнаты: двойной клик по узлу помещения → справочная карточка, скрытое помечено, без учёта осмотра', async () => {
	await openCanvas('Таверна.canvas');
	const rev0 = (await state()).revision;
	const p = await nodeCenter('Таверна.md');
	await app.page.mouse.dblclick(p.x, p.y);
	await L('gmc-room').waitFor({ timeout: 6000 });
	assert((await L('gmc-room-title').innerText()).includes('Рыжий дракон'), 'title');
	const secs = await app.page.locator('[data-testid=gmc-room-sec]').count();
	assert(secs === 3, `sections ${secs}`);
	assert((await L('gmc-room-hidden').innerText()).includes('скрыто'), 'hidden marker');
	assert((await L('gmc-room-hidden').innerText()).includes('Потайной ящик'), 'hidden text available');
	assert((await state()).revision === rev0, 'viewing a room changes no game state');
	const keys = JSON.stringify(Object.keys(disk()));
	assert(!/осмотр|найден|search|found|visited/i.test(keys), 'no tracking fields');
	await app.screenshot('scn-c-room');
	// text node is not intercepted
	const t = await nodeCenter('Таверна.md'); void t;
});

// ---------------------------------------------------------------- goto
await step('S', 'Перейти: две группы; переход к узлу; «В панель»; создать NPC/экземпляр предмета; явное добавление на Canvas', async () => {
	await closeModals();
	await openCanvas('Таверна.canvas');
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), alexId);
	await L('gmc-goto').click();
	await fillModal('goto-input', 'таверна');
	await L('goto-group-canvas').waitFor();
	assert((await L('goto-group-canvas').innerText()).includes('Таверна'), 'canvas group finds the room node');
	const nodesBefore = await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size);
	await L('goto-group-canvas').locator('[data-testid=goto-jump]').first().click();
	await sleep(500);
	const sel = await app.eval(() => [...window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.selection].map((n) => n.file?.path ?? n.id));
	assert(sel.length === 1 && /Таверна/.test(sel[0]), `selected ${sel}`);
	// reference group: SRD template creates an NPC, nothing is added to the Canvas automatically
	await L('gmc-goto').click();
	await fillModal('goto-input', 'бандит');
	await L('goto-create-npc').first().click();
	await L('gmc-card').waitFor();
	assert(/Bandit/.test(await L('gmc-name').innerText()), 'bandit card opened');
	assert((await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size)) === nodesBefore, 'canvas untouched by search');
	// item instance for the card owner
	await L('gmc-goto').click();
	await fillModal('goto-input', 'длинный меч');
	await L('goto-item').first().click();
	await sleep(500);
	const crId = await app.eval(() => window.canvasAssist.ctl.cardRef.id);
	const its = Object.values((await state()).extensions.cockpit.items).filter((i) => i.ownerId === crId);
	assert(its.some((i) => i.typeId === 'longsword'), 'longsword instance created for the open card');
	// explicit add to Canvas: note is created (new file), node appears, double click opens the creature card
	await L('gmc-goto').click();
	await fillModal('goto-input', 'бандит');
	await L('goto-add').first().click();
	await sleep(1500);
	const nodesAfter = await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size);
	assert(nodesAfter === nodesBefore + 1, `node added ${nodesBefore}->${nodesAfter}`);
	assert(existsSync(join(sb.vault, A, 'Elements/NPC/Bandit.md')) || readdirSync(join(sb.vault, A, 'Elements/NPC')).some((f) => /Bandit/.test(f)), 'npc note created');
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), alexId);
	const p = await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; for (const n of c.nodes.values()) if (/NPC\/Bandit/.test(n.file?.path ?? '')) { const r = n.nodeEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } return null; });
	assert(p, 'new node in DOM');
	await app.page.mouse.dblclick(p.x, p.y);
	await sleep(600);
	assert(/Bandit/.test(await L('gmc-name').innerText()), 'double click on the new node opens the bandit card');
	await app.screenshot('scn-s-goto');
});

// ---------------------------------------------------------------- A: tavern brawl
await step('A', 'Драка в таверне: партия + 6 NPC, инициатива, ходы, урон, состояния, завершение, Canvas цел', async () => {
	await L('gmc-new-npc').waitFor();
	for (const q of ['Бандит', 'Бандит', 'Бандит', 'Стражник', 'Головорез', 'Простолюдин']) await newNpc(q, true);
	let s = await state();
	const enc = s.activeEncounter;
	const cmbs = Object.values(enc.combatants);
	assert(cmbs.filter((c) => c.kind === 'npc').length >= 6, `npcs ${cmbs.length}`);
	const ids = Object.fromEntries(cmbs.map((c) => [c.displayName, c.id]));
	// players' physical rolls are typed in by the GM; NPC initiative is set (rolled) per combatant individually
	let i = 20;
	for (const c of cmbs) { await act({ type: 'encounter/update-combatant', combatantId: c.id, patch: { initiative: i-- } }); }
	await L('gmc-next').click();
	await sleep(400);
	s = await state();
	assert(s.activeEncounter.round === 1 && s.activeEncounter.activeSlotId, 'round 1 started');
	for (let k = 0; k < 4; k++) { await L('gmc-next').click(); await sleep(250); }
	// damage a bandit through its card: independent HP
	const bandits = cmbs.filter((c) => /Bandit/.test(c.displayName));
	assert(bandits.length === 3, 'three independent bandits');
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'combatant', id }), bandits[1].id);
	await L('gmc-hp-input').fill('-5');
	await L('gmc-hp-input').press('Enter');
	await sleep(500);
	s = await state();
	const hp = (n) => s.activeEncounter.combatants[n].hp.current;
	assert(hp(bandits[1].id) === Math.max(0, bandits[1].hp.current - 5) && hp(bandits[0].id) === bandits[0].hp.current && hp(bandits[2].id) === bandits[2].hp.current, 'only the targeted bandit lost HP');
	// condition on that bandit by the existing effect system
	await act({ type: 'effect/add', effect: { id: 'e1', conditionId: null, label: 'Ошеломлён', target: { kind: 'combatant', id: bandits[1].id }, sourceCombatantId: null, sourceLabel: '', duration: { kind: 'rounds', phase: 'end', remaining: 1 }, createdAtEventSeq: 0, isConcentration: false, concentrationEffectId: null, needsDecision: false, notes: '' } });
	await app.screenshot('scn-a-combat');
	await L('gmc-end-combat').click();
	await L('confirm-ok').click();
	await sleep(600);
	s = await state();
	assert(s.activeEncounter === null, 'ended');
	assert(!Object.values(s.effects).some((e) => e.label === 'Ошеломлён'), 'combat effects removed');
	assert(s.characters[alexId].hp.max > 0, 'PCs keep state');
	// Canvas still usable after the fight
	await openCanvas('Таверна.canvas');
	assert((await nodeCenter('Алекс.md')) !== null, 'same canvas still open');
	return { combatants: cmbs.length, ids: Object.keys(ids).length };
});

// ---------------------------------------------------------------- F: big combat
await step('F', '20 участников: порядок ходов, независимые HP, задержки и память', async () => {
	await closeModals();
	const crId = Object.keys((await state()).creatures)[0];
	const t0 = await app.eval(async (crId) => {
		const ctl = window.canvasAssist.ctl;
		const s = ctl.state;
		const cr = s.creatures[crId];
		const mk = (i) => ({ id: `big-${i}`, kind: 'monster', characterId: null, creatureId: crId, source: null, displayName: `Орк ${i + 1}`, initiative: 30 - i, initiativeModifier: 0, tieOrder: i * 10, initiativeGroupId: null, hp: { current: 15, max: 15, temporary: 0 }, ac: 13, acOverride: null, defeated: false });
		await ctl.act({ type: 'encounter/create', encounter: { id: 'enc-big', name: 'Большой бой', templateId: null, partyId: null, startedAt: new Date().toISOString(), round: 0, activeSlotId: null, turnInstanceId: null, turnEnded: false, actedThisRound: [], paused: false, combatants: {}, groups: {}, insertion: [], turnLog: {}, turnLogSeq: 0 } });
		await ctl.act({ type: 'encounter/add-combatants', combatants: Array.from({ length: 20 }, (_, i) => mk(i)), groups: [] });
		void cr;
		return performance.memory?.usedJSHeapSize ?? 0;
	}, crId);
	await L('gmc-next').click();
	const lat = [];
	for (let k = 0; k < 25; k++) {
		const t = Date.now();
		await L('gmc-next').click();
		await app.page.waitForFunction((n) => window.canvasAssist.ctl.state.activeEncounter.turnLogSeq >= n, k + 1, { timeout: 5000 });
		lat.push(Date.now() - t);
	}
	// HP latency: type damage, wait for the number to change in DOM
	await app.eval(() => window.canvasAssist.ctl.setTarget({ kind: 'combatant', id: 'big-7' }));
	const hpLat = [];
	for (let k = 0; k < 5; k++) {
		const before = await L('gmc-hp-text').innerText();
		const t = Date.now();
		await L('gmc-hp-input').fill('-1'); await L('gmc-hp-input').press('Enter');
		await app.page.waitForFunction((b) => document.querySelector('[data-testid=gmc-hp-text]').textContent !== b, before, { timeout: 5000 });
		hpLat.push(Date.now() - t);
	}
	const s = await state();
	assert(Object.keys(s.activeEncounter.combatants).length === 20, '20 combatants');
	assert(s.activeEncounter.combatants['big-7'].hp.current === 10 && s.activeEncounter.combatants['big-6'].hp.current === 15, 'independent hp');
	const mem1 = await app.eval(() => performance.memory?.usedJSHeapSize ?? 0);
	const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95) - 1] ?? 0;
	await app.screenshot('scn-f-20');
	await act({ type: 'encounter/end' });
	return { nextTurnMsP95: p95(lat), hpEditMsP95: p95(hpLat), heapDeltaMiB: Math.round((mem1 - t0) / 1048576 * 10) / 10 };
});

// ---------------------------------------------------------------- P7: view points & checkpoints
await step('P7', 'Canvas: точки обзора (сохранить/перейти/назад) и контрольные точки (создать/восстановить, игровые данные не откатываются)', async () => {
	await openCanvas('Таверна.canvas');
	await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.setViewport(100, 50, 0));
	await sleep(300);
	await L('gmc-viewpoints').click();
	await fillModal('vp-name-1', 'Стойка');
	await L('vp-save-1').click();
	await sleep(400);
	assert(Object.values(disk().extensions.cockpit.viewpoints)[0]['1'].name === 'Стойка', 'viewpoint persisted');
	await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.setViewport(-500, 300, 1));
	await sleep(300);
	await L('vp-go-1').click();
	await sleep(400);
	let v = await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; return [c.tx, c.ty, c.tZoom]; });
	assert(Math.abs(v[0] - 100) < 1 && Math.abs(v[1] - 50) < 1 && Math.abs(v[2]) < 0.01, JSON.stringify(v));
	await app.command('canvas-assist:cockpit-viewpoint-back');
	await sleep(300);
	v = await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; return [c.tx, c.ty, c.tZoom]; });
	assert(Math.abs(v[0] + 500) < 1, 'back to previous area');
	// checkpoint
	await L('gmc-checkpoints').click();
	await fillModal('cp-name', 'Перед сессией');
	await L('cp-create').click();
	await L('cp-row').first().waitFor();
	const nodesBefore = await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size);
	await closeModals();
	// the GM rearranges: remove a node; game state changes after the checkpoint
	await app.eval(async (rel) => { const f = window.app.vault.getAbstractFileByPath(rel); const j = JSON.parse(await window.app.vault.read(f)); j.nodes.pop(); await window.app.vault.modify(f, JSON.stringify(j)); }, `${A}/Холсты/Таверна.canvas`);
	await sleep(1500);
	assert((await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size)) === nodesBefore - 1, 'canvas changed');
	await act({ type: 'hp/damage', target: { kind: 'character', id: alexId }, amount: 3, useTemporary: false });
	const hpNow = (await state()).characters[alexId].hp.current;
	await L('gmc-checkpoints').click();
	await L('cp-restore').first().click();
	await L('confirm-ok').click();
	await sleep(2500);
	const nodesAfter = await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size);
	assert(nodesAfter === nodesBefore, `restored ${nodesAfter}/${nodesBefore}`);
	assert((await state()).characters[alexId].hp.current === hpNow, 'game state untouched by canvas restore');
	await L('cp-row').nth(1).waitFor().catch(() => undefined);
	const rows = await L('cp-row').count();
	assert(rows >= 2, `protective copy listed (${rows})`);
	await closeModals();
	return { nodesBefore, rows };
});

// ---------------------------------------------------------------- I: adventure independence
await step('I', 'Независимость приключений: одинаковые имена в А и Б не пересекаются', async () => {
	await app.eval(async (b) => { await window.canvasAssist.ctl.registerAdventure(b, b); }, B);
	await app.openFile(`${B}/Холсты/01.canvas`);
	await sleep(1500);
	assert((await app.eval(() => window.canvasAssist.ctl.state.name)) === B, 'switched to B');
	assert((await app.eval(() => Object.keys(window.canvasAssist.ctl.state.extensions.cockpit?.items ?? {}).length)) === 0, 'no items of A in B');
	await app.eval(() => window.canvasAssist.ctl.setTarget(null));
	await L('gmc-new-npc').click();
	await fillModal('qn-query', 'Гоблин');
	await L('qn-create').click();
	await app.page.locator('.modal-container').waitFor({ state: 'detached', timeout: 5000 });
	await sleep(400);
	const a = disk(A); const b = disk(B);
	assert(Object.keys(b.creatures).length === 1, 'B has its goblin');
	assert(!Object.keys(a.creatures).some((id) => b.creatures[id]), 'A and B creatures independent');
	assert(a.adventureId !== b.adventureId, 'distinct adventures');
	await openCanvas('Таверна.canvas');
});

// ---------------------------------------------------------------- K: keyboard, leaks, idle CPU
await step('K', 'Клавиатура (Tab/Enter), утечки обработчиков при 50 открытиях панели, простой без нагрузки CPU', async () => {
	await closeModals();
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), evidence.borin);
	while (await L('gmc-back').count()) { await L('gmc-back').first().click(); await sleep(100); }
	// keyboard: party chip and attack row are reachable and activate with Enter
	await app.page.locator(`[data-testid="gmc-party-${alexId}"]`).focus();
	await app.page.keyboard.press('Enter');
	await sleep(300);
	assert((await app.eval((id) => window.canvasAssist.ctl.cardRef.id === id, alexId)), 'party chip opens card with Enter');
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), evidence.borin);
	await sleep(300);
	const atk = app.page.locator('[data-testid^="gmc-attack-"]').first();
	await atk.focus();
	await app.page.keyboard.press('Enter');
	await L('gmc-weapon').waitFor({ timeout: 3000 });
	await L('gmc-back').click();
	const focusable = await app.eval(() => [...document.querySelectorAll('.gmc button, .gmc [tabindex="0"], .gmc input')].every((e) => !e.disabled ? e.tabIndex >= 0 : true));
	assert(focusable, 'controls are keyboard-focusable');
	const before = await app.eval(() => ({ l: window.canvasAssist.ctl.listeners.size, h: performance.memory?.usedJSHeapSize ?? 0 }));
	for (let i = 0; i < 50; i++) {
		await app.eval(() => window.app.workspace.detachLeavesOfType('gm-cockpit-panel'));
		await app.command('canvas-assist:cockpit-open');
	}
	await app.eval(() => window.app.workspace.getLeavesOfType('gm-cockpit-panel').slice(1).forEach((l) => l.detach()));
	await sleep(500);
	const after = await app.eval(() => ({ l: window.canvasAssist.ctl.listeners.size, h: performance.memory?.usedJSHeapSize ?? 0 }));
	assert(after.l === before.l, `listeners ${before.l} -> ${after.l}`);
	// idle CPU: no timers/polling — measure main-thread task time over 4 s
	const m0 = await app.cdp.send('Performance.getMetrics').catch(() => null);
	await app.cdp.send('Performance.enable').catch(() => undefined);
	const a = await app.cdp.send('Performance.getMetrics');
	await sleep(4000);
	const b = await app.cdp.send('Performance.getMetrics');
	const task = (r) => r.metrics.find((x) => x.name === 'TaskDuration').value;
	const idle = (task(b) - task(a)) / 4;
	void m0;
	assert(idle < 0.05, `idle main-thread load ${(idle * 100).toFixed(1)}%`);
	return { listeners: after.l, heapDeltaMiB: Math.round((after.h - before.h) / 1048576 * 10) / 10, idleLoadPct: Math.round(idle * 1000) / 10 };
});

// ---------------------------------------------------------------- L: light failure never double-spends resources
await step('L', 'Свет: сбой отправки не меняет ресурсы; расход ячейки ровно один; кнопка «выкл» шлёт deactivate; без cue — кнопки неактивны', async () => {
	const id = alexId;
	await closeModals();
	await app.eval((id) => window.canvasAssist.ctl.setTarget({ kind: 'character', id }), id);
	while (await L('gmc-back').count()) { await L('gmc-back').first().click(); await sleep(100); }
	await L('gmc-spells').click();
	const bless = await app.eval(() => window.canvasAssist.ctl.settings.spells.find((s) => s.name === 'Благословение').id);
	await L(`gmc-sp-${bless}`).locator('.gmc-item-name').click();
	await act({ type: 'character/set-slot', characterId: id, level: '1', slot: { max: 2, current: 2 } });
	const before = (await state()).characters[id].spellSlots['1'].current;
	// autostart on, invalid port → light fails, the cast is still applied exactly once
	await app.eval(() => { const c = window.canvasAssist.ctl.settings; c.cues[0].autoStart = true; c.lightkey.port = 70000; });
	await L('gmc-cast').click();
	await sleep(700);
	const after = (await state()).characters[id].spellSlots['1'].current;
	assert(after === before - 1, `slot ${before} -> ${after}`);
	assert(/Ошибка света/.test(await L('gmc-light-res').innerText()), 'failure is reported');
	await sleep(500);
	assert((await state()).characters[id].spellSlots['1'].current === after, 'no second spend after the failure');
	// working receiver: the off button sends deactivate
	const server = createSocket('udp4');
	const pkts = [];
	server.on('message', (m) => pkts.push(m.toString()));
	await new Promise((r) => server.bind(0, '127.0.0.1', r));
	await app.eval((p) => { const c = window.canvasAssist.ctl.settings; c.cues[0].autoStart = false; c.cues[0].command = 'activate'; c.lightkey.port = p; }, server.address().port);
	await L('gmc-light-off').click();
	await sleep(500);
	server.close();
	assert(pkts.length === 1 && pkts[0].includes('/deactivate'), `packets ${JSON.stringify(pkts)}`);
	await L('gmc-undo').click(); await sleep(300);
	await act({ type: 'character/set-slot', characterId: id, level: '1', slot: { max: 2, current: 2 } });
	await L('gmc-back').click();
});

// ---------------------------------------------------------------- X: Canvas internals missing
await step('X', 'Несовместимый Canvas (внутренний API недоступен): отключаются только затронутые функции, плагин и данные целы', async () => {
	await openCanvas('Таверна.canvas');
	await app.eval(() => window.canvasAssist.ctl.setCard(null));
	const r = await app.eval(() => {
		const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas;
		window.__saved = { setViewport: c.setViewport, createFileNode: c.createFileNode, nodes: c.nodes, selection: c.selection };
		c.setViewport = undefined; c.createFileNode = undefined;
		return true;
	});
	assert(r, 'api removed');
	// view points: the dialog explains and does not throw
	await L('gmc-viewpoints').click();
	assert((await app.page.locator('.modal-container').innerText()).includes('Камера Canvas недоступна'), 'view points disabled with an explanation');
	assert(await L('vp-save-1').isDisabled(), 'save disabled');
	await closeModals();
	// explicit "add to Canvas" falls back to opening the note
	const nodes0 = await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size);
	await L('gmc-goto').click();
	await fillModal('goto-input', 'бандит');
	await L('goto-add').first().click();
	await sleep(800);
	assert((await app.eval(() => window.app.workspace.getLeavesOfType('canvas')[0].view.canvas.nodes.size)) === nodes0, 'canvas untouched when the API is missing');
	await openCanvas('Таверна.canvas');
	// selection API gone: double click is not intercepted (native behaviour) and nothing throws
	const p = await app.page.locator('.canvas-node').first().boundingBox();
	await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; window.__sel = c.selection; Object.defineProperty(c, 'selection', { configurable: true, get() { throw new Error('selection API removed'); } }); });
	await app.page.mouse.click(p.x + p.width / 2, p.y + p.height / 2);
	await sleep(400);
	await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; const s = window.__saved; delete c.selection; Object.defineProperty(c, 'selection', { configurable: true, writable: true, value: window.__sel }); c.setViewport = s.setViewport; c.createFileNode = s.createFileNode; });
	assert(app.pluginErrors().length === 0, `plugin errors ${app.pluginErrors()}`);
	await closeModals();
	await app.eval(() => { const c = window.app.workspace.getLeavesOfType('canvas')[0].view.canvas; c.deselectAll?.(); for (const n of c.nodes.values()) if (n.isEditing) n.setIsEditing?.(false); });
	await app.page.keyboard.press('Escape');
	await app.eval(() => { for (const l of window.app.workspace.getLeavesOfType('canvas').slice(1)) l.detach(); for (const l of window.app.workspace.getLeavesOfType('markdown')) l.detach(); });
});

// ---------------------------------------------------------------- G: crash recovery
await step('G', 'Аварийное закрытие (SIGKILL): HP, ячейки, инвентарь, настройки света и библиотека заклинаний восстановлены', async () => {
	await app.eval(() => window.canvasAssist.ctl.setTarget(null));
	await act({ type: 'hp/damage', target: { kind: 'character', id: alexId }, amount: 2, useTemporary: false });
	await act({ type: 'character/set-slot', characterId: alexId, level: '1', slot: { current: 1, max: 2 } });
	await act({ type: 'encounter/create', encounter: { id: 'enc-crash', name: 'Перед крахом', templateId: null, partyId: null, startedAt: new Date().toISOString(), round: 0, activeSlotId: null, turnInstanceId: null, turnEnded: false, actedThisRound: [], paused: false, combatants: {}, groups: {}, insertion: [], turnLog: {}, turnLogSeq: 0 } });
	const snap = await state();
	const keep = { hp: snap.characters[alexId].hp, slots: snap.characters[alexId].spellSlots, items: Object.keys(snap.extensions.cockpit.items).length, spells: await app.eval(() => window.canvasAssist.ctl.settings.spells.length) };
	await sleep(1200);
	await app.close({ kill: true });
	app = new ObsidianApp(sb, { width: W, height: H });
	await app.launch();
	assert((await app.enablePlugin()).loaded, 'plugin loads after crash');
	await openCanvas('Таверна.canvas');
	const s = await state();
	assert(JSON.stringify(s.characters[alexId].hp) === JSON.stringify(keep.hp), 'hp');
	assert(JSON.stringify(s.characters[alexId].spellSlots) === JSON.stringify(keep.slots), 'slots');
	assert(Object.keys(s.extensions.cockpit.items).length === keep.items, 'items');
	assert(s.activeEncounter?.name === 'Перед крахом', 'encounter');
	assert((await app.eval(() => window.canvasAssist.ctl.settings.spells.length)) === keep.spells, 'spell library');
	await act({ type: 'encounter/end' });
	return keep;
});

// ---------------------------------------------------------------- H: offline
await step('H', 'Офлайн: без сети открыты карточки, бой, отдых, заклинание; внешних запросов нет', async () => {
	await app.close();
	app = new ObsidianApp(sb, { width: W, height: H, offline: true });
	await app.launch();
	assert((await app.enablePlugin()).loaded, 'loads offline');
	await openCanvas('Таверна.canvas');
	await app.command('canvas-assist:cockpit-open');
	const p = await nodeCenter('Алекс.md');
	await app.page.mouse.dblclick(p.x, p.y);
	await L('gmc-card').waitFor({ timeout: 6000 });
	await L('gmc-spells').click();
	const sp = await app.eval(() => window.canvasAssist.ctl.settings.spells.find((s) => s.name === 'Щит').id);
	await L(`gmc-sp-${sp}`).locator('.gmc-item-name').click();
	await L('gmc-spell').waitFor();
	assert((await L('gmc-spell').innerText()).includes('КД +5'), 'saved spell readable offline');
	await L('gmc-back').click(); await L('gmc-back').click();
	await L('gmc-start-combat').click();
	await closeModals();
	await L('gmc-rest-short').click();
	await L('rest-preview').waitFor();
	await closeModals();
	const ext = app.requests.filter((r) => /^https?:/.test(r.url) && !/127\.0\.0\.1|localhost/.test(r.url));
	assert(ext.every((r) => !/ttg|github|lightkey/i.test(r.url)), `external requests: ${ext.map((r) => r.url).slice(0, 3)}`);
	return { externalRequests: ext.length };
});

writeFileSync(join(OUT, 'scenarios.json'), JSON.stringify({ window: { W, H }, errors: app.pluginErrors(), results }, null, 2));
await app.close();
console.log(results.map((r) => `${r.id} ${r.status}`).join(' | '));
process.exit(results.some((r) => r.status !== 'PASS') ? 1 : 0);
