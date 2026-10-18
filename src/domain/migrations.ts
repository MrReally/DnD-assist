import { validateAdventureState, type ValidationIssue } from './schema';
import { createAdventureState, emptyCharacter } from './state';
import type { AdventureState, CharacterState, Counter, Effect } from './types';
import { CURRENT_SCHEMA_VERSION } from './types';
import { basename } from './normalize';

export interface MigrationResult {
	ok: boolean;
	state?: AdventureState;
	fromVersion: number | null;
	migrated: boolean;
	warnings: string[];
	issues: ValidationIssue[];
	error?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const toInt = (v: unknown, d: number): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : d);

/** v1 = minimal interoperable schema from the development kit (schemas/adventure-state.v1.schema.json). */
function migrateV1(raw: Obj, stateId: string, warnings: string[]): AdventureState {
	const adventureId = typeof raw.adventureId === 'string' && raw.adventureId ? raw.adventureId : stateId;
	const rootPath = typeof raw.rootPath === 'string' ? raw.rootPath : '';
	const s = createAdventureState(adventureId, stateId, rootPath, rootPath.split('/').pop() || rootPath);
	s.revision = toInt(raw.revision, 0);
	s.activePartyId = typeof raw.activePartyId === 'string' ? raw.activePartyId : null;
	if (Array.isArray(raw.parties)) {
		for (const p of raw.parties) {
			if (!isObj(p) || typeof p.id !== 'string') continue;
			const ids = Array.isArray(p.characterIds) ? p.characterIds.filter((x): x is string => typeof x === 'string') : [];
			s.parties.push({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id, characterIds: [...new Set(ids)] });
		}
	}
	if (isObj(raw.characters)) {
		for (const [id, v] of Object.entries(raw.characters)) {
			if (!isObj(v)) continue;
			const notePath = typeof v.notePath === 'string' ? v.notePath : '';
			const ch: CharacterState = emptyCharacter(id, basename(notePath) || id, notePath);
			if (isObj(v.hp)) {
				ch.hp = {
					current: Math.max(0, toInt(v.hp.current, 0)),
					max: typeof v.hp.max === 'number' ? toInt(v.hp.max, 0) : null,
					temporary: Math.max(0, toInt(v.hp.temporary, 0)),
				};
			}
			ch.ac = typeof v.ac === 'number' ? toInt(v.ac, 0) : null;
			if (isObj(v.spellSlots)) {
				for (const [lvl, slot] of Object.entries(v.spellSlots)) {
					if (/^[1-9]$/.test(lvl) && isObj(slot)) {
						const max = Math.max(0, toInt(slot.max, 0));
						ch.spellSlots[lvl] = { max, current: Math.min(max, Math.max(0, toInt(slot.current, 0))) };
					}
				}
			}
			if (isObj(v.resources)) {
				for (const [rid, r] of Object.entries(v.resources)) {
					if (!isObj(r)) continue;
					if (rid === 'inspiration' && r.type === 'boolean') {
						ch.inspiration = r.value === true;
						continue;
					}
					if (typeof r.value === 'number') {
						const counter: Counter = {
							id: rid,
							name: typeof r.name === 'string' ? r.name : rid,
							current: Math.max(0, toInt(r.value, 0)),
							max: typeof r.max === 'number' ? Math.max(0, toInt(r.max, 0)) : null,
							recovery: 'manual',
						};
						ch.counters[rid] = counter;
					} else {
						warnings.push(`Ресурс «${rid}» персонажа ${id} сохранён в extensions (неизвестный формат).`);
						ch.extensions = { ...(ch.extensions ?? {}), [`resource:${rid}`]: r };
					}
				}
			}
			if (Array.isArray(v.conditions)) {
				v.conditions.forEach((cond, i) => {
					const label = typeof cond === 'string' ? cond : isObj(cond) && typeof cond.label === 'string' ? cond.label : null;
					if (!label) return;
					const e: Effect = {
						id: `eff-migrated-${id}-${i}`,
						conditionId: isObj(cond) && typeof cond.conditionId === 'string' ? cond.conditionId : null,
						label,
						target: { kind: 'character', id },
						sourceCombatantId: null,
						sourceLabel: '',
						duration: { kind: 'manual' },
						createdAtEventSeq: 0,
						isConcentration: false,
						concentrationEffectId: null,
						needsDecision: false,
						notes: 'Перенесено из схемы v1',
					};
					s.effects[e.id] = e;
				});
			}
			s.characters[id] = ch;
		}
	}
	for (const p of s.parties) p.characterIds = p.characterIds.filter((id) => !!s.characters[id]);
	if (Array.isArray(raw.encounterTemplates) && raw.encounterTemplates.length) {
		s.extensions.legacyEncounterTemplates = raw.encounterTemplates;
		warnings.push('Шаблоны v1 сохранены в extensions.legacyEncounterTemplates (формат не стандартизирован).');
	}
	if (raw.activeEncounter !== null && raw.activeEncounter !== undefined) {
		s.extensions.legacyActiveEncounter = raw.activeEncounter;
		warnings.push('Активный бой v1 сохранён в extensions.legacyActiveEncounter; создайте бой заново.');
	}
	if (isObj(raw.history) && Array.isArray(raw.history.undo) && raw.history.undo.length) {
		warnings.push('История v1 не переносится (остаётся в резервной копии).');
	}
	return s;
}

/**
 * Validates and migrates raw JSON to the current schema. Never mutates the input.
 * Unknown future versions are rejected (read-only recovery), not guessed.
 */
export function migrateState(raw: unknown, newStateId: () => string): MigrationResult {
	const warnings: string[] = [];
	if (!isObj(raw)) return { ok: false, fromVersion: null, migrated: false, warnings, issues: [], error: 'Файл состояния не является объектом JSON' };
	const version = raw.schemaVersion;
	if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
		return { ok: false, fromVersion: null, migrated: false, warnings, issues: [], error: 'Нет корректного schemaVersion' };
	}
	if (version > CURRENT_SCHEMA_VERSION) {
		return {
			ok: false,
			fromVersion: version,
			migrated: false,
			warnings,
			issues: [],
			error: `Неизвестная версия схемы ${version} (поддерживается до ${CURRENT_SCHEMA_VERSION}). Обновите плагин.`,
		};
	}
	let state: AdventureState;
	let migrated = false;
	if (version === 1) {
		state = migrateV1(structuredClone(raw), newStateId(), warnings);
		migrated = true;
	} else if (version === 2) {
		state = structuredClone(raw) as unknown as AdventureState;
	} else {
		return { ok: false, fromVersion: version, migrated: false, warnings, issues: [], error: `Версия схемы ${version} не поддерживается` };
	}
	const issues = validateAdventureState(state);
	if (issues.length) {
		return { ok: false, fromVersion: version, migrated, warnings, issues, error: 'Состояние не прошло проверку схемы' };
	}
	return { ok: true, state, fromVersion: version, migrated, warnings, issues };
}
