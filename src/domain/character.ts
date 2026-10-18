// Character import (JSON only, no OCR). Strict validation mirrors schemas/character-import.schema.json.
import { emptyCharacter } from './state';
import type { AbilityId, CharacterState, ClassLevel, Counter, HitDice, RecoveryRule } from './types';
import { ABILITY_IDS } from './types';
import { looksLikeMarkup } from './normalize';

export interface ImportIssue {
	index: number;
	path: string;
	message: string;
}

export interface CharacterImport {
	schemaVersion: 1;
	kind: 'player-character';
	characterId?: string;
	name: string;
	class?: ClassLevel[];
	species?: string | null;
	background?: string | null;
	abilityScores?: Partial<Record<AbilityId, number>>;
	proficiencyBonus?: number;
	armorClass?: number;
	initiativeModifier?: number;
	speedFeet?: number;
	hitPoints?: { max: number; current: number; temporary?: number };
	hitDice?: HitDice[];
	spellSlots?: Record<string, { max: number; current: number }>;
	savingThrowProficiencies?: AbilityId[];
	skillProficiencies?: string[];
	attacks?: Record<string, unknown>[];
	spells?: Record<string, unknown>[];
	features?: Record<string, unknown>[];
	inventory?: Record<string, unknown>[];
	customResources?: Record<string, unknown>[];
	notes?: string;
}

export interface ParsedImport {
	records: Array<{ index: number; value: CharacterImport | null; errors: ImportIssue[]; warnings: ImportIssue[] }>;
	fatal: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const TOP_KEYS = new Set([
	'schemaVersion', 'kind', 'characterId', 'name', 'class', 'species', 'background', 'abilityScores',
	'proficiencyBonus', 'armorClass', 'initiativeModifier', 'speedFeet', 'hitPoints', 'hitDice', 'spellSlots',
	'savingThrowProficiencies', 'skillProficiencies', 'attacks', 'spells', 'features', 'inventory',
	'customResources', 'notes',
]);
const DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

/** Parses text; rejects numbers that overflow to Infinity and non-JSON input. */
export function parseImportText(text: string): ParsedImport {
	if (text.length > 2_000_000) return { records: [], fatal: 'Файл слишком большой (лимит 2 МБ)' };
	let overflow = false;
	let raw: unknown;
	try {
		raw = JSON.parse(text, (_k, v: unknown) => {
			if (typeof v === 'number' && !Number.isFinite(v)) overflow = true;
			return v;
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { records: [], fatal: `Синтаксическая ошибка JSON: ${msg}` };
	}
	if (overflow) return { records: [], fatal: 'Числовое переполнение: значение вне допустимого диапазона (Infinity)' };
	let list: unknown[];
	if (Array.isArray(raw)) list = raw;
	else if (isObj(raw) && Array.isArray(raw.characters)) list = raw.characters;
	else list = [raw];
	if (list.length === 0) return { records: [], fatal: 'В JSON нет записей персонажей' };
	if (list.length > 200) return { records: [], fatal: 'Слишком много записей за один импорт (лимит 200)' };
	return { records: list.map((item, index) => validateCharacterImport(item, index)), fatal: null };
}

export function validateCharacterImport(
	v: unknown,
	index: number,
): { index: number; value: CharacterImport | null; errors: ImportIssue[]; warnings: ImportIssue[] } {
	const errors: ImportIssue[] = [];
	const warnings: ImportIssue[] = [];
	const err = (path: string, message: string): void => void errors.push({ index, path, message });
	const warn = (path: string, message: string): void => void warnings.push({ index, path, message });
	const intIn = (x: unknown, path: string, min: number, max: number): x is number => {
		if (typeof x !== 'number' || !Number.isInteger(x)) {
			err(path, 'ожидается целое число');
			return false;
		}
		if (x < min || x > max) {
			err(path, `значение ${x} вне диапазона ${min}…${max}`);
			return false;
		}
		return true;
	};
	const optStr = (x: unknown, path: string, nullable: boolean): void => {
		if (x === undefined || (nullable && x === null)) return;
		if (typeof x !== 'string') err(path, 'ожидается строка');
	};

	if (!isObj(v)) {
		err('$', 'запись должна быть объектом');
		return { index, value: null, errors, warnings };
	}
	for (const k of Object.keys(v)) if (!TOP_KEYS.has(k)) err(`$.${k}`, 'неизвестное поле');
	if (v.schemaVersion !== 1) err('$.schemaVersion', `неизвестная версия схемы: ${JSON.stringify(v.schemaVersion)} (ожидается 1)`);
	if (v.kind !== 'player-character') err('$.kind', 'ожидается "player-character"');
	if (typeof v.name !== 'string' || v.name.trim().length === 0) err('$.name', 'имя обязательно');
	else if (v.name.length > 160) err('$.name', 'имя длиннее 160 символов');
	if (v.characterId !== undefined && (typeof v.characterId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(v.characterId))) {
		err('$.characterId', 'допустимы латиница, цифры, «.», «_», «-» (до 80 символов)');
	}
	if (v.class !== undefined) {
		if (!Array.isArray(v.class)) err('$.class', 'ожидается массив');
		else
			v.class.forEach((c, i) => {
				if (!isObj(c)) return err(`$.class[${i}]`, 'ожидается объект');
				for (const k of Object.keys(c)) if (k !== 'name' && k !== 'level') err(`$.class[${i}].${k}`, 'неизвестное поле');
				if (typeof c.name !== 'string' || !c.name) err(`$.class[${i}].name`, 'название класса обязательно');
				intIn(c.level, `$.class[${i}].level`, 1, 20);
			});
	}
	optStr(v.species, '$.species', true);
	optStr(v.background, '$.background', true);
	if (v.abilityScores !== undefined) {
		if (!isObj(v.abilityScores)) err('$.abilityScores', 'ожидается объект');
		else
			for (const [k, s] of Object.entries(v.abilityScores)) {
				if (!ABILITY_IDS.includes(k as AbilityId)) err(`$.abilityScores.${k}`, 'неизвестная характеристика');
				else intIn(s, `$.abilityScores.${k}`, 1, 40);
			}
	}
	if (v.proficiencyBonus !== undefined) intIn(v.proficiencyBonus, '$.proficiencyBonus', 0, 12);
	if (v.armorClass !== undefined) intIn(v.armorClass, '$.armorClass', 0, 100);
	if (v.initiativeModifier !== undefined) intIn(v.initiativeModifier, '$.initiativeModifier', -30, 30);
	if (v.speedFeet !== undefined) {
		if (typeof v.speedFeet !== 'number' || v.speedFeet < 0 || v.speedFeet > 1000) err('$.speedFeet', 'скорость 0…1000');
	}
	if (v.hitPoints !== undefined) {
		const hp = v.hitPoints;
		if (!isObj(hp)) err('$.hitPoints', 'ожидается объект');
		else {
			for (const k of Object.keys(hp)) if (!['max', 'current', 'temporary'].includes(k)) err(`$.hitPoints.${k}`, 'неизвестное поле');
			const okMax = intIn(hp.max, '$.hitPoints.max', 1, 10000);
			const okCur = intIn(hp.current, '$.hitPoints.current', 0, 10000);
			if (hp.temporary !== undefined) intIn(hp.temporary, '$.hitPoints.temporary', 0, 10000);
			if (okMax && okCur && (hp.current as number) > (hp.max as number)) {
				err('$.hitPoints.current', `текущие хиты (${String(hp.current)}) больше максимума (${String(hp.max)})`);
			}
		}
	}
	if (v.hitDice !== undefined) {
		if (!Array.isArray(v.hitDice)) err('$.hitDice', 'ожидается массив');
		else
			v.hitDice.forEach((h, i) => {
				if (!isObj(h)) return err(`$.hitDice[${i}]`, 'ожидается объект');
				if (!DICE.includes(h.die as string)) err(`$.hitDice[${i}].die`, `допустимо: ${DICE.join(', ')}`);
				const okT = intIn(h.total, `$.hitDice[${i}].total`, 0, 40);
				const okR = intIn(h.remaining, `$.hitDice[${i}].remaining`, 0, 40);
				if (okT && okR && (h.remaining as number) > (h.total as number)) err(`$.hitDice[${i}].remaining`, 'больше общего числа');
			});
	}
	if (v.spellSlots !== undefined) {
		if (!isObj(v.spellSlots)) err('$.spellSlots', 'ожидается объект');
		else
			for (const [lvl, s] of Object.entries(v.spellSlots)) {
				const p = `$.spellSlots.${lvl}`;
				if (!/^[1-9]$/.test(lvl)) err(p, 'уровень ячейки 1–9');
				if (!isObj(s)) {
					err(p, 'ожидается объект');
					continue;
				}
				const okM = intIn(s.max, `${p}.max`, 0, 99);
				const okC = intIn(s.current, `${p}.current`, 0, 99);
				if (okM && okC && (s.current as number) > (s.max as number)) err(`${p}.current`, 'больше максимума');
			}
	}
	if (v.savingThrowProficiencies !== undefined) {
		if (!Array.isArray(v.savingThrowProficiencies)) err('$.savingThrowProficiencies', 'ожидается массив');
		else
			v.savingThrowProficiencies.forEach((a, i) => {
				if (!ABILITY_IDS.includes(a as AbilityId)) err(`$.savingThrowProficiencies[${i}]`, 'неизвестная характеристика');
			});
	}
	if (v.skillProficiencies !== undefined) {
		if (!Array.isArray(v.skillProficiencies) || v.skillProficiencies.some((x) => typeof x !== 'string' || !x)) {
			err('$.skillProficiencies', 'ожидается массив строк');
		}
	}
	for (const key of ['attacks', 'spells', 'features', 'inventory', 'customResources'] as const) {
		const arr = v[key];
		if (arr === undefined) continue;
		if (!Array.isArray(arr)) err(`$.${key}`, 'ожидается массив');
		else arr.forEach((x, i) => !isObj(x) && err(`$.${key}[${i}]`, 'ожидается объект'));
	}
	if (Array.isArray(v.customResources)) {
		v.customResources.forEach((r, i) => {
			if (!isObj(r)) return;
			if (r.current !== undefined && r.max !== undefined && typeof r.current === 'number' && typeof r.max === 'number' && r.current > r.max) {
				err(`$.customResources[${i}].current`, 'больше максимума');
			}
			if (typeof r.current === 'number' && r.current < 0) err(`$.customResources[${i}].current`, 'отрицательное значение');
			if (typeof r.max === 'number' && r.max < 0) err(`$.customResources[${i}].max`, 'отрицательное значение');
		});
	}
	optStr(v.notes, '$.notes', false);
	// Markup is not executed or rendered as HTML; it is escaped when written to Markdown.
	walkStrings(v, '$', (s, path) => {
		if (looksLikeMarkup(s)) warn(path, 'HTML/скрипт в тексте: будет записан как обычный текст (экранирован)');
	});
	return { index, value: errors.length ? null : (v as unknown as CharacterImport), errors, warnings };
}

function walkStrings(v: unknown, path: string, fn: (s: string, path: string) => void, depth = 0): void {
	if (depth > 8) return;
	if (typeof v === 'string') fn(v, path);
	else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn, depth + 1));
	else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkStrings(x, `${path}.${k}`, fn, depth + 1);
}

export interface DiffLine {
	field: string;
	before: string;
	after: string;
}

export interface ImportPlan {
	character: CharacterState;
	permanent: DiffLine[];
	runtime: DiffLine[];
	/** runtime differences that are NOT applied unless overwriteRuntime is set. */
	runtimeKept: DiffLine[];
}

const fmt = (v: unknown): string => {
	if (v === null || v === undefined) return '—';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return JSON.stringify(v);
};

function counterFromResource(r: Record<string, unknown>, i: number): Counter | null {
	const name = typeof r.name === 'string' ? r.name : null;
	if (!name) return null;
	const id = typeof r.id === 'string' && r.id ? r.id : `res-${i}-${name}`;
	const max = typeof r.max === 'number' && Number.isInteger(r.max) ? r.max : null;
	const current = typeof r.current === 'number' && Number.isInteger(r.current) ? r.current : max ?? 0;
	const rec = r.recovery;
	const recovery: RecoveryRule = rec === 'short' || rec === 'long' ? rec : 'manual';
	return { id, name, current, max, recovery };
}

/**
 * Builds the persistent character from import data.
 * New characters take all values. Re-import updates permanent values only; current HP,
 * slots, hit dice remaining and counters are kept unless overwriteRuntime is true.
 * A raised maximum never touches the current value (clamped only when max decreases).
 */
export function planImport(
	input: CharacterImport,
	existing: CharacterState | null,
	id: string,
	notePath: string,
	overwriteRuntime: boolean,
): ImportPlan {
	const base = existing ? structuredClone(existing) : emptyCharacter(id, input.name.trim(), notePath);
	const ch = base;
	const permanent: DiffLine[] = [];
	const runtime: DiffLine[] = [];
	const runtimeKept: DiffLine[] = [];
	const perm = (field: string, before: unknown, after: unknown): void => {
		if (fmt(before) !== fmt(after)) permanent.push({ field, before: fmt(before), after: fmt(after) });
	};
	const rt = (field: string, before: unknown, after: unknown, applied: boolean): void => {
		if (fmt(before) === fmt(after)) return;
		(applied ? runtime : runtimeKept).push({ field, before: fmt(before), after: fmt(after) });
	};
	const isNew = !existing;
	const applyRuntime = isNew || overwriteRuntime;

	perm('Имя', existing?.name, input.name.trim());
	ch.name = input.name.trim();
	if (input.class !== undefined) {
		perm('Класс', existing ? existing.classes.map((c) => `${c.name} ${c.level}`).join(', ') : null, input.class.map((c) => `${c.name} ${c.level}`).join(', '));
		ch.classes = input.class.map((c) => ({ name: c.name, level: c.level }));
	}
	if (input.armorClass !== undefined) {
		perm('КД', existing?.ac, input.armorClass);
		ch.ac = input.armorClass;
	}
	if (input.initiativeModifier !== undefined) {
		perm('Модификатор инициативы', existing?.initiativeModifier, input.initiativeModifier);
		ch.initiativeModifier = input.initiativeModifier;
	}
	if (input.speedFeet !== undefined) {
		perm('Скорость', existing?.speedFeet, input.speedFeet);
		ch.speedFeet = Math.round(input.speedFeet);
	}
	if (input.hitPoints) {
		const hp = input.hitPoints;
		perm('Максимум хитов', existing?.hp.max, hp.max);
		const nextHp = { ...ch.hp, max: hp.max };
		rt('Текущие хиты', existing?.hp.current, hp.current, applyRuntime);
		rt('Временные хиты', existing?.hp.temporary, hp.temporary ?? 0, applyRuntime);
		if (applyRuntime) {
			nextHp.current = hp.current;
			nextHp.temporary = hp.temporary ?? 0;
		} else if (nextHp.current > hp.max) {
			runtime.push({ field: 'Текущие хиты (ограничено новым максимумом)', before: String(nextHp.current), after: String(hp.max) });
			nextHp.current = hp.max;
		}
		ch.hp = nextHp;
	}
	if (input.spellSlots) {
		const next: CharacterState['spellSlots'] = {};
		for (const [lvl, s] of Object.entries(input.spellSlots)) {
			const prev = existing?.spellSlots[lvl];
			perm(`Ячейки ${lvl} ур. (максимум)`, prev?.max, s.max);
			rt(`Ячейки ${lvl} ур. (текущие)`, prev?.current, s.current, applyRuntime);
			const current = applyRuntime ? s.current : Math.min(prev?.current ?? s.current, s.max);
			next[lvl] = { max: s.max, current };
		}
		if (existing) {
			for (const lvl of Object.keys(existing.spellSlots)) {
				if (!(lvl in input.spellSlots)) perm(`Ячейки ${lvl} ур.`, existing.spellSlots[lvl]?.max, null);
			}
		}
		ch.spellSlots = next;
	}
	if (input.hitDice) {
		const next = input.hitDice.map((h) => {
			const prev = existing?.hitDice.find((x) => x.die === h.die);
			perm(`Кости хитов ${h.die} (всего)`, prev?.total, h.total);
			rt(`Кости хитов ${h.die} (осталось)`, prev?.remaining, h.remaining, applyRuntime);
			const remaining = applyRuntime ? h.remaining : Math.min(prev?.remaining ?? h.remaining, h.total);
			return { die: h.die, total: h.total, remaining };
		});
		ch.hitDice = next;
	}
	if (input.customResources) {
		input.customResources.forEach((r, i) => {
			const c = counterFromResource(r, i);
			if (!c) return;
			const prev = existing?.counters[c.id];
			perm(`${c.name} (максимум)`, prev?.max, c.max);
			rt(`${c.name} (текущее)`, prev?.current, c.current, applyRuntime || !prev);
			const current = applyRuntime || !prev ? c.current : c.max === null ? prev.current : Math.min(prev.current, c.max);
			ch.counters[c.id] = { ...c, current };
		});
	}
	ch.notePath = existing?.notePath ?? notePath;
	return { character: ch, permanent, runtime, runtimeKept };
}
