// Compact registry: stable machine id, short Russian name as used on TTG Club (5e 2014),
// and a link to the TTG section. Full rules texts are intentionally NOT included
// (see docs/verified-integrations.md, TTG terms).

export const TTG_BASE = 'https://5e14.ttg.club';
export const TTG_CONDITIONS_URL = `${TTG_BASE}/screens/conditions_and_disease`;
export const TTG_BESTIARY_URL = `${TTG_BASE}/bestiary/`;

export interface ConditionInfo {
	id: string;
	name: string;
	en: string;
	url: string;
}

const RAW: Array<[string, string, string, string]> = [
	['blinded', 'Ослеплённый', 'Blinded', 'blinded'],
	['charmed', 'Очарованный', 'Charmed', 'charmed'],
	['deafened', 'Оглохший', 'Deafened', 'deafened'],
	['exhaustion', 'Истощённый', 'Exhaustion', 'exhaustion'],
	['frightened', 'Испуганный', 'Frightened', 'frightened'],
	['grappled', 'Схваченный', 'Grappled', 'grappled'],
	['incapacitated', 'Недееспособный', 'Incapacitated', 'incapacitated'],
	['invisible', 'Невидимый', 'Invisible', 'invisible'],
	['paralyzed', 'Парализованный', 'Paralyzed', 'paralyzed'],
	['petrified', 'Окаменевший', 'Petrified', 'petrified'],
	['poisoned', 'Отравленный', 'Poisoned', 'poisoned'],
	['prone', 'Сбитый с ног', 'Prone', 'condition_prone'],
	['restrained', 'Опутанный', 'Restrained', 'restrained'],
	['stunned', 'Ошеломлённый', 'Stunned', 'stunned'],
	['unconscious', 'Бессознательный', 'Unconscious', 'unconscious'],
	['concentration', 'Концентрация', 'Concentration', 'concentrated'],
	['dodging', 'Уклоняющийся', 'Dodging', 'dodging'],
	['surprised', 'Захваченный врасплох', 'Surprise', 'surprise'],
	['stabilized', 'Стабилизированный', 'Stabilized', 'stabilized'],
];

export const CONDITIONS: readonly ConditionInfo[] = RAW.map(([id, name, en, slug]) => ({
	id,
	name,
	en,
	url: `${TTG_BASE}/screens/${slug}`,
}));

export function getCondition(id: string | null | undefined): ConditionInfo | undefined {
	if (!id) return undefined;
	return CONDITIONS.find((c) => c.id === id);
}
