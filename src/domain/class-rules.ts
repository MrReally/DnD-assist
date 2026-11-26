// Class resources and spellcasting rules (SRD 5.1 / D&D 2014). Numbers that exist in an SRD class table are read from
// the SRD data; formula-based ones (Ki = level, Lay on Hands = 5 × level …) are verified against the SRD text and tables
// in tests/unit/class-rules.test.ts. Anything that depends on a player's choice is NOT automated (see arcane recovery).
import { abilityMod, type Abilities } from './cockpit';
import { getSrd } from './srd';
import type { Counter, CharacterState, RecoveryRule } from './types';

export interface ResourceDef {
	id: string;
	name: string;
	/** null = unlimited (Rage at level 20). */
	max: number | null;
	recovery: RecoveryRule;
	note: string;
}

const tableCols = (classId: string, level: number): string[] | null => getSrd()?.classes.find((c) => c.id === classId)?.levels[level - 1]?.cols ?? null;
const tableFeatures = (classId: string, level: number): string[] => getSrd()?.classes.find((c) => c.id === classId)?.levels[level - 1]?.features ?? [];
const usesWord = (s: string): number => ({ one: 1, two: 2, three: 3 })[/\((one|two|three) uses?\)/.exec(s)?.[1] as 'one' | 'two' | 'three'] ?? 1;

/** Resources of one class at a level. Empty when the SRD data is not loaded (the GM can add counters by hand). */
export function classResources(classId: string, level: number, abilities: Abilities): ResourceDef[] {
	const out: ResourceDef[] = [];
	const lv = Math.max(1, Math.min(20, Math.floor(level)));
	const feats = tableFeatures(classId, lv);
	switch (classId) {
		case 'barbarian': {
			const rages = tableCols('barbarian', lv)?.[0];
			if (rages) out.push({ id: 'rage', name: 'Ярость (Rage)', max: /^\d+$/.test(rages) ? Number(rages) : null, recovery: 'long', note: 'SRD: число ярости из таблицы класса' });
			break;
		}
		case 'bard':
			out.push({ id: 'bardic-inspiration', name: 'Вдохновение барда (Bardic Inspiration)', max: Math.max(1, abilityMod(abilities.cha)), recovery: lv >= 5 ? 'short' : 'long', note: 'Использований = модификатор Харизмы (мин. 1); с 5 уровня — и после короткого отдыха' });
			break;
		case 'cleric': {
			const cd = feats.find((f) => /^Channel Divinity/.test(f));
			if (lv >= 2) out.push({ id: 'channel-divinity', name: 'Божественный канал (Channel Divinity)', max: Number(/\((\d+)\/rest\)/.exec(cd ?? '')?.[1] ?? 1), recovery: 'short', note: 'SRD: использований за отдых' });
			break;
		}
		case 'druid':
			if (lv >= 2) out.push({ id: 'wild-shape', name: 'Дикий облик (Wild Shape)', max: 2, recovery: 'short', note: 'Две формы, восстанавливаются после короткого или продолжительного отдыха' });
			break;
		case 'fighter': {
			out.push({ id: 'second-wind', name: 'Второе дыхание (Second Wind)', max: 1, recovery: 'short', note: '1d10 + уровень воина' });
			if (lv >= 2) out.push({ id: 'action-surge', name: 'Всплеск действий (Action Surge)', max: usesWord(feats.find((f) => /^Action Surge/.test(f)) ?? tableFeatures('fighter', 2).find((f) => /^Action Surge/.test(f)) ?? ''), recovery: 'short', note: 'Одно дополнительное действие за использование' });
			// the 17th-level table row wraps in the PDF, so its Indomitable entry is confirmed from the class text instead
			let ind = [...Array(lv).keys()].map((i) => tableFeatures('fighter', i + 1).find((f) => /^Indomitable/.test(f))).filter(Boolean).pop();
			if (lv >= 17 && /Indomitable \(three uses\)/.test(getSrd()?.classes.find((c) => c.id === 'fighter')?.text ?? '')) ind = 'Indomitable (three uses)';
			if (ind) out.push({ id: 'indomitable', name: 'Стойкость (Indomitable)', max: usesWord(ind), recovery: 'long', note: 'Перебросить проваленный спасбросок' });
			// Action Surge uses can grow at 17: take the latest Action Surge entry up to the current level
			const as = [...Array(lv).keys()].map((i) => tableFeatures('fighter', i + 1).find((f) => /^Action Surge/.test(f))).filter(Boolean).pop();
			const row = out.find((r) => r.id === 'action-surge');
			if (row && as) row.max = usesWord(as);
			break;
		}
		case 'monk':
			if (lv >= 2) out.push({ id: 'ki', name: 'Очки ци (Ki)', max: lv, recovery: 'short', note: 'Очков = уровень монаха' });
			break;
		case 'paladin':
			out.push({ id: 'lay-on-hands', name: 'Наложение рук (Lay on Hands)', max: 5 * lv, recovery: 'long', note: 'Запас хитов = 5 × уровень паладина' });
			out.push({ id: 'divine-sense', name: 'Божественное чувство (Divine Sense)', max: 1 + Math.max(0, abilityMod(abilities.cha)), recovery: 'long', note: '1 + модификатор Харизмы' });
			break;
		case 'sorcerer':
			if (lv >= 2) out.push({ id: 'sorcery-points', name: 'Очки чародейства (Sorcery Points)', max: lv, recovery: 'long', note: 'Очков = уровень чародея' });
			break;
		case 'wizard':
			out.push({ id: 'arcane-recovery', name: 'Магическое восстановление (Arcane Recovery)', max: 1, recovery: 'manual', note: 'Раз в день после короткого отдыха: ячейки суммарным уровнем ≤ половины уровня (вверх), не выше 5-го. Выбор делает игрок в окне отдыха; сбрасывается после продолжительного отдыха' });
			break;
		default:
			break;
	}
	return out;
}

/** Warlock Pact Magic: slot count and level from the SRD class table. */
export function pactMagic(level: number): { slots: number; slotLevel: number } | null {
	const cols = tableCols('warlock', Math.max(1, Math.min(20, Math.floor(level))));
	if (!cols) return null;
	const slots = Number(cols[2]);
	const lvl = Number(/^(\d)/.exec(cols[3] ?? '')?.[1]);
	return Number.isFinite(slots) && Number.isFinite(lvl) ? { slots, slotLevel: lvl } : null;
}

/** Spells prepared per day for prepared casters (null → the class knows a fixed list instead). */
export function preparedSpellCount(classId: string, level: number, abilities: Abilities): number | null {
	switch (classId) {
		case 'wizard':
			return Math.max(1, abilityMod(abilities.int) + level);
		case 'cleric':
		case 'druid':
			return Math.max(1, abilityMod(abilities.wis) + level);
		case 'paladin':
			return Math.max(1, abilityMod(abilities.cha) + Math.floor(level / 2));
		default:
			return null;
	}
}

/** Wizard spellbook: six 1st-level spells at 1st level, two more with each level (SRD). */
export const wizardSpellbookSize = (level: number): number => 6 + 2 * (Math.max(1, level) - 1);

/** Arcane Recovery budget: combined slot levels ≤ half the wizard level rounded up; no slot of 6th level or higher. */
export const arcaneRecoveryBudget = (wizardLevel: number): number => Math.ceil(wizardLevel / 2);
export const ARCANE_RECOVERY_MAX_SLOT = 5;

export function arcaneRecoveryError(levels: number[], wizardLevel: number): string | null {
	if (levels.some((l) => !Number.isInteger(l) || l < 1)) return 'Некорректный уровень ячейки';
	if (levels.some((l) => l > ARCANE_RECOVERY_MAX_SLOT)) return 'Магическое восстановление не работает для ячеек 6 уровня и выше';
	const sum = levels.reduce((a, b) => a + b, 0);
	if (sum > arcaneRecoveryBudget(wizardLevel)) return `Суммарный уровень ячеек ${sum} больше допустимого ${arcaneRecoveryBudget(wizardLevel)}`;
	return null;
}

/** Counters for a character from its class levels. Existing counters keep their current value (spent uses stay spent). */
export function countersFor(ch: Pick<CharacterState, 'classes' | 'counters'>, classIdOf: (name: string) => string | undefined, abilities: Abilities): Record<string, Counter> {
	const out: Record<string, Counter> = {};
	for (const k of ch.classes) {
		const id = classIdOf(k.name);
		if (!id) continue;
		for (const r of classResources(id, k.level, abilities)) {
			const prev = ch.counters[r.id];
			const spent = prev && prev.max !== null && r.max !== null ? prev.max - prev.current : 0;
			out[r.id] = { id: r.id, name: r.name, max: r.max, current: r.max === null ? 0 : prev ? Math.max(0, r.max - spent) : r.max, recovery: r.recovery };
		}
	}
	return out;
}

/** Cantrips known from the SRD class table (first numeric column of casting classes that have cantrips). */
export function cantripsKnown(classId: string, level: number): number | null {
	if (!['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'].includes(classId)) return null;
	const n = Number(tableCols(classId, Math.max(1, Math.min(20, Math.floor(level))))?.[0]);
	return Number.isFinite(n) ? n : null;
}

/** Levels at which the class gains an Ability Score Improvement (read from the SRD class table; 4/8/12/16/19 by default). */
export function asiLevels(classId: string, level: number): number[] {
	const rows = getSrd()?.classes.find((c) => c.id === classId)?.levels ?? [];
	const fromTable = rows.filter((r) => r.level <= level && r.features.some((f) => /^Ability Score Improvement/.test(f))).map((r) => r.level);
	if (rows.length === 20) return fromTable;
	return [4, 8, 12, 16, 19].filter((l) => l <= level);
}
