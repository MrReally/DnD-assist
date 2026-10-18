// Readable character sheet written into a clearly delimited plugin-owned block.
// Everything outside the markers belongs to the user and is never rewritten.
import type { CharacterImport } from './character';
import type { AbilityId } from './types';
import { ABILITY_IDS } from './types';
import { escapeMarkdownInline } from './normalize';

export const BLOCK_BEGIN = '<!-- canvas-assist:begin -->';
export const BLOCK_END = '<!-- canvas-assist:end -->';

const ABILITY_RU: Record<AbilityId, string> = { str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' };
const ABILITY_FULL: Record<AbilityId, string> = {
	str: 'Сила',
	dex: 'Ловкость',
	con: 'Телосложение',
	int: 'Интеллект',
	wis: 'Мудрость',
	cha: 'Харизма',
};

/** PHB 2014 skill names as used in Russian translations; machine ids stay unchanged. */
const SKILL_RU: Record<string, string> = {
	acrobatics: 'Акробатика',
	animal_handling: 'Уход за животными',
	animalHandling: 'Уход за животными',
	arcana: 'Магия',
	athletics: 'Атлетика',
	deception: 'Обман',
	history: 'История',
	insight: 'Проницательность',
	intimidation: 'Запугивание',
	investigation: 'Анализ',
	medicine: 'Медицина',
	nature: 'Природа',
	perception: 'Внимательность',
	performance: 'Выступление',
	persuasion: 'Убеждение',
	religion: 'Религия',
	sleight_of_hand: 'Ловкость рук',
	sleightOfHand: 'Ловкость рук',
	stealth: 'Скрытность',
	survival: 'Выживание',
};

const e = escapeMarkdownInline;
const dash = '—';

function signed(n: number): string {
	return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function val(v: string | number | null | undefined, suffix = ''): string {
	return v === undefined || v === null || v === '' ? dash : `${e(String(v))}${suffix}`;
}

function describeItem(item: Record<string, unknown>): string {
	const name = typeof item.name === 'string' ? item.name : null;
	const rest = Object.entries(item)
		.flatMap(([k, v]) => {
			if (k === 'name') return [];
			if (typeof v === 'string') return [`${k}: ${v}`];
			if (typeof v === 'number' || typeof v === 'boolean') return [`${k}: ${v.toString()}`];
			return [];
		})
		.join('; ');
	const head = name ? `**${e(name)}**` : '';
	return [head, rest ? e(rest) : ''].filter(Boolean).join(' — ') || e(JSON.stringify(item));
}

function list(title: string, items: Record<string, unknown>[] | undefined): string[] {
	if (!items || items.length === 0) return [];
	return ['', `### ${title}`, ...items.map((i) => `- ${describeItem(i)}`)];
}

export function renderSheetBlock(input: CharacterImport, characterId: string): string {
	const lines: string[] = [BLOCK_BEGIN];
	lines.push('> [!info] Лист персонажа (Canvas Assist)');
	lines.push('> Блок между служебными комментариями обновляется при повторном импорте JSON. Свои заметки пишите вне блока.');
	lines.push(`> ID: \`${characterId}\`. Текущие хиты, ячейки и состояния ведутся в Canvas Assist.`);
	lines.push('');
	lines.push('## Лист персонажа');
	const classes = input.class?.length ? input.class.map((c) => `${e(c.name)} ${c.level}`).join(' / ') : dash;
	lines.push(`- **Класс:** ${classes}`);
	lines.push(`- **Вид:** ${val(input.species)} · **Предыстория:** ${val(input.background)}`);
	const init = input.initiativeModifier === undefined ? dash : signed(input.initiativeModifier);
	lines.push(`- **КД:** ${val(input.armorClass)} · **Инициатива:** ${init} · **Скорость:** ${val(input.speedFeet, ' фт.')}`);
	const pb = input.proficiencyBonus === undefined ? dash : signed(input.proficiencyBonus);
	lines.push(`- **Максимум хитов:** ${val(input.hitPoints?.max)} · **Бонус мастерства:** ${pb}`);
	if (input.hitDice?.length) {
		lines.push(`- **Кости хитов:** ${input.hitDice.map((h) => `${h.total}${h.die}`).join(', ')}`);
	}
	lines.push('');
	lines.push(`| ${ABILITY_IDS.map((a) => ABILITY_RU[a]).join(' | ')} |`);
	lines.push(`|${ABILITY_IDS.map(() => '---').join('|')}|`);
	const scores = ABILITY_IDS.map((a) => {
		const s = input.abilityScores?.[a];
		return s === undefined ? dash : `${s} (${signed(Math.floor((s - 10) / 2))})`;
	});
	lines.push(`| ${scores.join(' | ')} |`);
	lines.push('');
	const saves = input.savingThrowProficiencies?.length ? input.savingThrowProficiencies.map((a) => ABILITY_FULL[a]).join(', ') : dash;
	lines.push(`**Спасброски:** ${saves}`);
	lines.push('');
	const skills = input.skillProficiencies?.length ? input.skillProficiencies.map((s) => e(SKILL_RU[s] ?? s)).join(', ') : dash;
	lines.push(`**Навыки:** ${skills}`);
	if (input.spellSlots && Object.keys(input.spellSlots).length) {
		lines.push('');
		lines.push(
			`**Ячейки заклинаний (максимум):** ${Object.entries(input.spellSlots)
				.sort(([a], [b]) => Number(a) - Number(b))
				.map(([l, s]) => `${l} ур.: ${s.max}`)
				.join(' · ')}`,
		);
	}
	lines.push(...list('Атаки', input.attacks));
	lines.push(...list('Заклинания', input.spells));
	lines.push(...list('Особенности', input.features));
	lines.push(...list('Снаряжение', input.inventory));
	lines.push(...list('Ресурсы', input.customResources));
	if (input.notes) {
		lines.push('', '### Заметки с листа');
		for (const l of input.notes.split(/\r?\n/)) lines.push(e(l));
	}
	lines.push(BLOCK_END);
	return lines.join('\n');
}

export interface BlockLocation {
	start: number;
	end: number;
	content: string;
}

export function findManagedBlock(text: string): BlockLocation | null {
	const start = text.indexOf(BLOCK_BEGIN);
	if (start < 0) return null;
	const endIdx = text.indexOf(BLOCK_END, start);
	if (endIdx < 0) return null;
	const end = endIdx + BLOCK_END.length;
	return { start, end, content: text.slice(start, end) };
}

/** Replaces only the managed block (or appends it). Throws if markers are corrupted. */
export function mergeManagedBlock(text: string, block: string): string {
	const begins = text.split(BLOCK_BEGIN).length - 1;
	const ends = text.split(BLOCK_END).length - 1;
	if (begins > 1 || ends > 1 || begins !== ends) {
		throw new Error('Служебный блок Canvas Assist повреждён (непарные или повторные маркеры). Исправьте заметку вручную.');
	}
	const loc = findManagedBlock(text);
	if (loc) return text.slice(0, loc.start) + block + text.slice(loc.end);
	return `${text}${appendSeparator(text)}${block}\n`;
}

/** Separator used when a block is appended to a note that had none (kept for exact undo). */
export function appendSeparator(text: string): string {
	return text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
}

/** Removes a block that was appended by mergeManagedBlock, restoring the original text exactly when possible. */
export function removeAppendedBlock(text: string, separator: string): string {
	const loc = findManagedBlock(text);
	if (!loc) return text;
	const tail = text.slice(loc.end);
	const head = text.slice(0, loc.start);
	if (tail === '\n' && head.endsWith(separator)) return head.slice(0, head.length - separator.length);
	return head + tail.replace(/^\n/, '');
}

export function newCharacterNote(name: string, characterId: string, block: string): string {
	return `---\ncanvasAssistId: ${characterId}\n---\n# ${e(name)}\n\n${block}\n\n## Заметки мастера\n\n`;
}
