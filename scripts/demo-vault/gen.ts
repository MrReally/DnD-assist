// Generates the DEMO adventure (test data only, not a real adventure). Built with esbuild by make-demo-vault.mjs.
// The sidecar state is produced through the real reducer so it is valid by construction; ids are deterministic.
import { mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCharacter, creatureFromMonster } from '../../src/domain/builder';
import type { BuildChoices } from '../../src/domain/builder';
import type { ItemInstance } from '../../src/domain/cockpit';
import type { ActionPayload } from '../../src/domain/actions';
import { dispatch } from '../../src/domain/reducer';
import { validateAdventureState } from '../../src/domain/schema';
import { isSrdData, monsterById, setSrd } from '../../src/domain/srd';
import { createAdventureState, serializeState } from '../../src/domain/state';
import type { AdventureState } from '../../src/domain/types';

export const DEMO_ROOT = 'Демо-приключение';
const ADV_ID = 'adv-demo-gm-cockpit';
let seq = 0;
const id = (p: string): string => `${p}-demo${String(++seq).padStart(3, '0')}`;
const rng = (): number => 0.5; // deterministic: average rolls

export function generate(outDir: string, opts: { srdFile: string; pluginDir?: string }): { files: string[] } {
	const raw: unknown = JSON.parse(readFileSync(opts.srdFile, 'utf8'));
	if (!isSrdData(raw)) throw new Error('bad SRD data');
	setSrd(raw);
	const files: string[] = [];
	const write = (rel: string, data: string): void => {
		const p = join(outDir, rel);
		mkdirSync(p.replace(/\/[^/]*$/, ''), { recursive: true });
		writeFileSync(p, data);
		files.push(rel);
	};
	const note = (rel: string, body: string, fm: Record<string, string> = {}): void => {
		const head = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
		write(`${DEMO_ROOT}/${rel}`, `---\n${head ? `${head}\n` : ''}demo: true\n---\n${body}\n`);
	};

	let s: AdventureState = createAdventureState(ADV_ID, 'state-demo-001', DEMO_ROOT, 'Демо-приключение');
	const run = (p: ActionPayload): void => {
		const r = dispatch(s, { ...p, actionId: id('act'), adventureId: ADV_ID, at: '2026-11-26T00:00:00.000Z' });
		if (r.error) throw new Error(`${p.type}: ${r.error}`);
		s = r.state;
	};
	run({ type: 'party/create', party: { id: 'party-demo', name: 'Партия (демо)', characterIds: [] } });
	run({ type: 'party/set-active', partyId: 'party-demo' });

	// ---- player characters (built by the same rules as the in-app builder; paper sheet stays the source of truth)
	const base: Pick<BuildChoices, 'background' | 'subclass' | 'backgroundKind'> = { background: 'Демо', subclass: '', backgroundKind: 'custom' };
	const pcs: Array<{ file: string; c: BuildChoices }> = [
		{ file: 'Демо Бранн', c: { ...base, name: 'Демо Бранн', raceId: 'dwarf', subraceId: 'hill-dwarf', classId: 'fighter', level: 3, baseAbilities: { str: 15, dex: 12, con: 14, int: 8, wis: 13, cha: 10 }, subclass: 'Champion', skills: ['athletics', 'perception'], gear: ['chain-mail', 'shield', 'longsword', 'javelin', 'backpack'], notePath: '' } },
		{ file: 'Демо Лирель', c: { ...base, name: 'Демо Лирель', raceId: 'elf', subraceId: 'high-elf', classId: 'wizard', level: 5, baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, subclass: 'School of Evocation', asi: [['int']], skills: ['arcana', 'history'], backgroundSkills: ['deception', 'stealth'], gear: ['quarterstaff', 'dagger', 'spellbook', 'component-pouch'], notePath: '' } },
		{ file: 'Демо Тоби', c: { ...base, name: 'Демо Тоби', raceId: 'halfling', subraceId: 'lightfoot', classId: 'rogue', level: 3, baseAbilities: { str: 8, dex: 15, con: 12, int: 13, wis: 10, cha: 14 }, subclass: 'Thief', skills: ['acrobatics', 'stealth', 'sleight', 'perception'], gear: ['leather', 'shortsword', 'dagger', 'shortbow', 'thieves-tools'], notePath: '' } },
		{ file: 'Демо Мара', c: { ...base, name: 'Демо Мара', raceId: 'human', classId: 'cleric', level: 3, baseAbilities: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 }, subclass: 'Life Domain', skills: ['medicine', 'religion'], gear: ['chain-mail', 'shield', 'mace', 'backpack'], notePath: '' } },
	];
	const wizardIds = (lvl: number, n: number, skip = 0): string[] => (raw.spells).filter((x) => x.level === lvl && x.classes.includes('wizard')).slice(skip, skip + n).map((x) => x.id);
	const clericIds = (lvl: number, n: number): string[] => raw.spells.filter((x) => x.level === lvl && x.classes.includes('cleric')).slice(0, n).map((x) => x.id);
	const demoSpellPicks: Record<string, Partial<BuildChoices>> = {
		'Демо Лирель': { cantrips: ['fire-bolt', 'mage-hand', 'light', 'prestidigitation', 'ray-of-frost'], spells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'detect-magic', 'burning-hands', 'misty-step', 'scorching-ray', 'web', 'fireball', 'counterspell', 'fly', 'identify', 'thunderwave'], prepared: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'misty-step', 'scorching-ray', 'fireball', 'counterspell', 'thunderwave'] },
		'Демо Мара': { cantrips: ['guidance', 'sacred-flame', 'spare-the-dying'], prepared: [...clericIds(1, 3)] },
	};
	void wizardIds;
	const known = new Set(raw.spells.map((x) => x.id));
	for (const pc of pcs) {
		const notePath = `Elements/Персонажи/${pc.file}.md`;
		const picks = demoSpellPicks[pc.file] ?? {};
		for (const sp of [...(picks.cantrips ?? []), ...(picks.spells ?? []), ...(picks.prepared ?? [])]) if (!known.has(sp)) throw new Error(`unknown spell id in demo: ${sp}`);
		const r = buildCharacter({ ...pc.c, ...picks, notePath }, id);
		run({ type: 'cockpit/character-build', character: r.character, sheet: r.sheet, items: r.items, ...(r.book ? { book: r.book } : {}), partyId: 'party-demo' });
		note(notePath, `# ${pc.file}\n\n> **ДЕМОНСТРАЦИОННЫЙ ПЕРСОНАЖ.** Тестовые данные, не из настоящей кампании. Лист создан конструктором GM Cockpit; источник истины для реального персонажа — бумажный лист.\n`, { canvasAssistId: r.character.id });
		if (r.warnings.some((w) => /Не выбрано|из \d+|Подготовлено/.test(w)) && pc.file === 'Демо Лирель') console.warn(`demo warnings (${pc.file}): ${r.warnings.join(' | ')}`);
	}
	// extras: coins, a potion, and a backpack with contents for the container example
	const ids = Object.values(s.characters);
	const find = (n: string) => ids.find((c) => c.name === n)!;
	const bag = Object.values(s.extensions.cockpit ? (s.extensions.cockpit as { items: Record<string, ItemInstance> }).items : {}).find((i) => i.ownerId === find('Демо Бранн').id && i.typeId === 'backpack');
	if (!bag) throw new Error('demo backpack missing');
	const put = (typeId: string, name: string, qty: number, owner: string, container: string | null): void => run({ type: 'cockpit/item-upsert', item: { id: id('itm'), typeId, name, ownerKind: 'character', ownerId: owner, containerId: container, qty, equipped: false, magicBonus: 0, note: '' } });
	put('rope-hempen-50-feet', 'Верёвка пеньковая (50 фт)', 1, find('Демо Бранн').id, bag.id);
	put('torch', 'Факел', 5, find('Демо Бранн').id, bag.id);
	put('rations-1-day', 'Рацион (1 день)', 4, find('Демо Бранн').id, bag.id);
	put('potion-of-healing', 'Зелье лечения', 2, find('Демо Мара').id, null);
	put('arrows-20', 'Стрелы (20)', 1, find('Демо Тоби').id, null);
	for (const c of ids) run({ type: 'cockpit/purse-set', ownerId: c.id, purse: { pp: 0, gp: 10 + c.name.length, ep: 0, sp: 5, cp: 12 } });

	// ---- NPCs and goblins (creatures with notes so Canvas nodes open their cards)
	const mk = (monsterId: string, name: string, role: string, file: string, gold: number): string => {
		const m = monsterById(monsterId);
		if (!m) throw new Error(`no SRD monster ${monsterId}`);
		const r = creatureFromMonster(m, id, rng, { role, goldMax: gold, aliases: [m.name] });
		const notePath = `Elements/NPC/${file}.md`;
		const creature = { ...r.creature, name, source: { provider: 'note' as const, ref: notePath } };
		run({ type: 'cockpit/npc-create', creature, statblock: r.statblock, items: r.items, purse: { ...r.purse, gp: gold } });
		note(notePath, `# ${name}\n\n> **ДЕМО-NPC** (статблок из SRD 5.1: ${m.name}). Тестовые данные.\n`, { canvasAssistId: creature.id });
		return creature.id;
	};
	const goblin = mk('goblin', 'Гоблин (демо)', '', 'Гоблин (демо)', 2);
	const boss = mk('bandit-captain', 'Главарь бандитов (демо)', 'главарь', 'Главарь бандитов (демо)', 25);
	mk('commoner', 'Борис, трактирщик (демо)', 'трактирщик', 'Борис, трактирщик (демо)', 12);
	mk('guard', 'Стражник Ганс (демо)', 'стражник', 'Стражник Ганс (демо)', 4);
	mk('noble', 'Староста Эльза (демо)', 'староста', 'Староста Эльза (демо)', 30);
	run({ type: 'template/upsert', template: { id: 'tpl-demo-brawl', name: 'Драка в таверне (демо)', partyId: 'party-demo', includeParty: true, notes: 'Три гоблина и главарь. Демонстрационное столкновение.', entries: [
		{ id: 'te-1', kind: 'creature', name: 'Гоблин (демо)', count: 3, creatureId: goblin, notePath: null, sourceUrl: null, hpMax: null, ac: null, initiativeModifier: null, sharedInitiative: false },
		{ id: 'te-2', kind: 'creature', name: 'Главарь бандитов (демо)', count: 1, creatureId: boss, notePath: null, sourceUrl: null, hpMax: null, ac: null, initiativeModifier: null, sharedInitiative: false },
	] } });

	// ---- rooms, story, canvas
	note('Elements/Локации/Таверна «Золотой гусь» (демо).md', `# Таверна «Золотой гусь» (демо)\nНизкий зал с очагом, запах жареного лука. **Демо-локация.**\n\n## Объекты\n- Стойка с кувшинами\n- Три бочки эля\n- Лестница на второй этаж\n\n## Контейнеры\n- Сундук под лестницей (демо): 15 зм, свёрток с письмом\n\n## Скрытые находки\n- Потайной ящик под стойкой: кошель с 40 зм (СЛ 14, Восприятие)\n\n## Важные детали\n- Дверь на кухню заперта на засов изнутри\n`);
	note('Elements/Локации/Опушка у дороги (демо).md', `# Опушка у дороги (демо)\nКолея, поваленное дерево, следы гоблинов. **Демо-локация.**\n\n## Объекты\n- Поваленная сосна\n- Кострище\n\n## Скрытые находки\n- Тайник в дупле: стрелы (20), зелье лечения (СЛ 13, Анализ)\n`);
	note('Elements/Локации/Старая мельница (демо).md', `# Старая мельница (демо)\nЗаброшенная мельница у реки. **Демо-локация.**\n\n## Объекты\n- Жернова\n- Сломанное колесо\n\n## Скрытые находки\n- Люк под жерновами (СЛ 15, Расследование)\n`);
	note('Сюжет/События (демо).md', `# События (демо)\n\n**Это демонстрационные данные.**\n\n1. В таверне вспыхивает драка: гоблины требуют «налог».\n2. След ведёт к мельнице.\n3. Староста просит разобраться с главарём.\n`);
	write(`${DEMO_ROOT}/README-ДЕМО.md`, `# ДЕМО-приключение GM Cockpit\n\nВсе материалы в этой папке — **тестовые данные**, созданные генератором (\`scripts/demo-vault\`). Это не материалы настоящей кампании.\n\nОткройте Canvas \`Холсты/Таверна и окрестности (демо).canvas\`. Двойной клик по узлу персонажа, NPC или локации открывает карточку в панели GM Cockpit справа. Запуск боя: верхняя строка Canvas → «Бой» → «Запустить: Драка в таверне (демо)».\n\nПервая проверка: см. \`ПЕРВАЯ-ПРОВЕРКА.md\` в корне хранилища.\n`);

	const fileNode = (nid: string, file: string, x: number, y: number, w = 260, h = 120) => ({ id: nid, type: 'file', file: `${DEMO_ROOT}/${file}`, x, y, width: w, height: h });
	const nodes: unknown[] = [
		{ id: 'g-tavern', type: 'group', label: 'Таверна «Золотой гусь» (демо)', x: 0, y: 0, width: 1180, height: 560 },
		{ id: 'g-outside', type: 'group', label: 'Окрестности (демо)', x: 1300, y: 0, width: 900, height: 560 },
		{ id: 'g-story', type: 'group', label: 'Сюжетные события (демо)', x: 0, y: 680, width: 1180, height: 420 },
		{ id: 'g-party', type: 'group', label: 'Партия (демо)', x: 1300, y: 680, width: 900, height: 420 },
		fileNode('n-room', 'Elements/Локации/Таверна «Золотой гусь» (демо).md', 40, 60, 300, 160),
		fileNode('n-innkeeper', 'Elements/NPC/Борис, трактирщик (демо).md', 380, 60),
		fileNode('n-guard', 'Elements/NPC/Стражник Ганс (демо).md', 380, 220),
		fileNode('n-gob', 'Elements/NPC/Гоблин (демо).md', 700, 60),
		fileNode('n-boss', 'Elements/NPC/Главарь бандитов (демо).md', 700, 220),
		{ id: 'n-text-1', type: 'text', text: '**Демо-заметка мастера.** Здесь могла бы быть ваша заметка. Гоблины зашли с чёрного хода.', x: 40, y: 280, width: 300, height: 140 },
		fileNode('n-glade', 'Elements/Локации/Опушка у дороги (демо).md', 1340, 60, 300, 160),
		fileNode('n-mill', 'Elements/Локации/Старая мельница (демо).md', 1680, 60, 300, 160),
		fileNode('n-elder', 'Elements/NPC/Староста Эльза (демо).md', 1340, 280),
		{ id: 'n-link', type: 'link', url: 'https://dnd.wizards.com/resources/systems-reference-document', x: 1680, y: 280, width: 300, height: 120 },
		fileNode('n-story', 'Сюжет/События (демо).md', 40, 730, 360, 160),
		{ id: 'n-text-2', type: 'text', text: 'Идея: если игроки уйдут к мельнице, главарь успеет сбежать.', x: 440, y: 730, width: 300, height: 120 },
		...pcs.map((p, i) => fileNode(`n-pc-${i}`, `Elements/Персонажи/${p.file}.md`, 1340 + (i % 2) * 320, 730 + Math.floor(i / 2) * 150, 280, 120)),
	];
	const edges = [
		{ id: 'e1', fromNode: 'n-room', toNode: 'n-innkeeper', fromSide: 'right', toSide: 'left' },
		{ id: 'e2', fromNode: 'n-gob', toNode: 'n-boss', fromSide: 'bottom', toSide: 'top' },
		{ id: 'e3', fromNode: 'n-story', toNode: 'n-mill', fromSide: 'right', toSide: 'left', label: 'след' },
	];
	write(`${DEMO_ROOT}/Холсты/Таверна и окрестности (демо).canvas`, `${JSON.stringify({ nodes, edges }, null, '\t')}\n`);

	run({ type: 'cockpit/viewpoint-set', canvasRel: 'Холсты/Таверна и окрестности (демо).canvas', slot: '1', view: { name: 'Таверна', x: 590, y: 280, zoom: -0.63 } });
	run({ type: 'cockpit/viewpoint-set', canvasRel: 'Холсты/Таверна и окрестности (демо).canvas', slot: '2', view: { name: 'Окрестности', x: 1750, y: 280, zoom: -0.27 } });
	run({ type: 'cockpit/viewpoint-set', canvasRel: 'Холсты/Таверна и окрестности (демо).canvas', slot: '3', view: { name: 'Сюжет', x: 590, y: 890, zoom: -0.63 } });
	run({ type: 'cockpit/viewpoint-set', canvasRel: 'Холсты/Таверна и окрестности (демо).canvas', slot: '4', view: { name: 'Партия', x: 1750, y: 890, zoom: -0.27 } });

	const out = { ...s, history: { undo: [], redo: [] }, appliedActionIds: [] } as AdventureState;
	const issues = validateAdventureState(out);
	if (issues.length) throw new Error(`demo state invalid: ${JSON.stringify(issues.slice(0, 3))}`);
	write(`${DEMO_ROOT}/.canvas-assist-state.json`, serializeState(out));
	write('ПЕРВАЯ-ПРОВЕРКА.md', readFileSync(join(DEMO_ROOT_DIR, '..', '..', 'release-assets', 'FIRST-CHECK.md'), 'utf8'));

	// plugin settings pre-seeded: the demo adventure is already connected; demo spells and a placeholder cue
	const data = {
		adventures: [{ adventureId: ADV_ID, rootPath: DEMO_ROOT, name: 'Демо-приключение' }],
		spells: [
			{ id: 'demo-moonbeam-lite', name: 'Лунный луч (ДЕМО, пользовательское)', level: 2, school: 'Воплощение', castingTime: '1 действие', range: '60 футов', components: 'В, С', duration: 'Концентрация, до 1 минуты', concentration: true, text: 'ДЕМО-карточка для проверки импорта/редактирования. Не текст из книг.', source: 'ДЕМО', origin: 'manual' },
			{ id: 'demo-spark', name: 'Искра (ДЕМО, пользовательское)', level: 0, school: 'Воплощение', castingTime: '1 действие', range: '30 футов', components: 'В, С', duration: 'Мгновенная', concentration: false, text: 'ДЕМО-заговор для проверки.', source: 'ДЕМО', origin: 'manual' },
		],
		cues: [{ id: 'cue-demo-fireball', cardId: 'fireball', address: '/live/ДЕМО/cue/Fireball/activate', command: 'activate', args: [], autoStart: false }],
	};
	write('.obsidian/community-plugins.json', '["canvas-assist"]\n');
	write('.obsidian/app.json', `${JSON.stringify({ promptDelete: false, alwaysUpdateLinks: true })}\n`);
	if (opts.pluginDir) {
		const dst = join(outDir, '.obsidian', 'plugins', 'canvas-assist');
		mkdirSync(dst, { recursive: true });
		for (const f of ['manifest.json', 'main.js', 'styles.css', 'srd51.json', 'NOTICE-SRD.txt', 'LICENSE']) if (existsSync(join(opts.pluginDir, f))) cpSync(join(opts.pluginDir, f), join(dst, f));
		writeFileSync(join(dst, 'data.json'), `${JSON.stringify(data, null, '\t')}\n`);
		files.push('.obsidian/plugins/canvas-assist/*');
	}
	return { files };
}

const DEMO_ROOT_DIR = process.env.DEMO_SCRIPT_DIR ?? '.';
