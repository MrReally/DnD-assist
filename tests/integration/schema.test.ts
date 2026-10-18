import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImportText } from '../../src/domain/character';
import { encounterFromTemplate } from '../../src/domain/encounter';
import { migrateState } from '../../src/domain/migrations';
import { validateAdventureState } from '../../src/domain/schema';
import { act, baseState, effect, id, run } from '../helpers';
import { dispatch } from '../../src/domain/reducer';

const root = join(__dirname, '..', '..');
const load = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const stateV2 = ajv.compile(load('schemas/adventure-state.schema.json') as object);
const stateV1 = ajv.compile(load('schemas/adventure-state.v1.schema.json') as object);
const importSchema = ajv.compile(load('schemas/character-import.schema.json') as object);

function richState() {
	let s = baseState();
	s = run(s, { type: 'creature/upsert', creature: { id: 'crt-1', name: 'Гоблин', aliases: ['goblin'], ac: 15, hpMax: 7, initiativeModifier: 2, speed: '30 фт.', notes: '', source: { provider: 'ttg2014', ref: 'https://5e14.ttg.club/bestiary/goblin', url: 'https://5e14.ttg.club/bestiary/goblin' } } });
	s = run(s, {
		type: 'template/upsert',
		template: { id: 'tpl', name: 'Т', partyId: 'party-main', includeParty: true, notes: '', entries: [{ id: 'e', kind: 'creature', name: 'Гоблин', count: 5, creatureId: 'crt-1', notePath: null, sourceUrl: null, hpMax: null, ac: null, initiativeModifier: null, sharedInitiative: true }] },
	});
	s = run(s, { type: 'encounter/create', encounter: encounterFromTemplate(s, s.encounterTemplates[0]!, id, 'now') });
	const cid = Object.keys(s.activeEncounter!.combatants);
	for (const [i, c] of cid.entries()) s = run(s, { type: 'encounter/update-combatant', combatantId: c, patch: { initiative: 10 + i } });
	const g = Object.values(s.activeEncounter!.groups)[0]!;
	s = run(s, { type: 'encounter/update-group', groupId: g.id, patch: { initiative: 12 } });
	s = run(s, { type: 'encounter/begin' });
	s = run(s, { type: 'effect/add', effect: effect('ef1', cid[4]!, { kind: 'turns', ownerCombatantId: cid[4]!, phase: 'end', remaining: 1 }) });
	s = run(s, { type: 'effect/add', effect: effect('ef2', 'pc-alex', { kind: 'game-time', expiresAtMinute: 60 }, { target: { kind: 'character', id: 'pc-alex' } }) });
	for (let i = 0; i < 6; i++) s = run(s, { type: 'encounter/next' });
	s = run(s, { type: 'character/set-counter', characterId: 'pc-alex', counter: { id: 'c', name: 'Ки', current: 1, max: 3, recovery: 'short' } });
	s = run(s, { type: 'node/override', canvasPath: 'Холсты/01.canvas', nodeId: 'n1', category: 'ignore' });
	s = run(s, { type: 'history/undo' });
	return s;
}

describe('JSON Schema ↔ runtime validator', () => {
	it('kit fixtures are valid v1 and migrate to valid v2', () => {
		for (const adv of ['Приключение А', 'Приключение Б']) {
			const raw = load(`tests/fixtures/test-vault/${adv}/.canvas-assist-state.json`);
			expect(stateV1(raw)).toBe(true);
			const m = migrateState(raw, () => 'state-x');
			expect(m.ok).toBe(true);
			expect(stateV2(m.state), JSON.stringify(stateV2.errors)).toBe(true);
		}
	});

	it('rich state after many actions satisfies both validators', () => {
		const s = richState();
		expect(validateAdventureState(s)).toEqual([]);
		expect(stateV2(s), JSON.stringify(stateV2.errors?.slice(0, 3))).toBe(true);
	});

	it('both validators reject the same broken states', () => {
		const s = richState();
		const broken: Array<(x: Record<string, unknown>) => void> = [
			(x) => ((x.characters as Record<string, { hp: { current: number } }>)['pc-alex']!.hp.current = -1),
			(x) => (x.schemaVersion = 3),
			(x) => ((x.characters as Record<string, { notePath: string }>)['pc-alex']!.notePath = '../../etc/x.md'),
			(x) => ((x.gameClock as { minutes: number }).minutes = 1.5),
			(x) => delete x.history,
		];
		for (const b of broken) {
			const copy = structuredClone(s) as unknown as Record<string, unknown>;
			b(copy);
			expect(stateV2(copy)).toBe(false);
			expect(validateAdventureState(copy).length).toBeGreaterThan(0);
		}
	});

	it('import validator agrees with character-import.schema.json on fixtures', () => {
		const dir = join(root, 'tests', 'fixtures', 'import');
		for (const f of ['valid-full.json', 'valid-minimal.json', 'partial.json', 'levelup.json', 'invalid-values.json', 'unknown-version.json', 'negative.json', 'html-injection.json']) {
			const text = readFileSync(join(dir, f), 'utf8');
			const ours = parseImportText(text).records[0]!;
			const schemaOk = importSchema(JSON.parse(text));
			// Our validator is stricter (e.g. current ≤ max), never looser than the schema.
			if (ours.errors.length === 0) expect(schemaOk, f).toBe(true);
			if (!schemaOk) expect(ours.errors.length, f).toBeGreaterThan(0);
		}
	});

	it('AC-32 duplicate dispatch keeps state schema-valid', () => {
		const s = richState();
		const a = act(s, { type: 'clock/advance', minutes: 61 });
		const once = dispatch(s, a).state;
		const twice = dispatch(once, a).state;
		expect(twice).toBe(once);
		expect(stateV2(twice)).toBe(true);
		expect(twice.effects.ef2).toBeUndefined();
	});
});
