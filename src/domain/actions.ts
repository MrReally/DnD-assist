import type { ItemInstance, ItemType, Purse, Sheet, SpellRef, Spellbook, StatBlock, ViewPoint } from './cockpit';
import type {
	CharacterState,
	Combatant,
	Counter,
	CreatureCard,
	Effect,
	EffectTarget,
	Encounter,
	EncounterTemplate,
	FileSnapshot,
	HitDice,
	InitiativeGroup,
	NodeCategory,
	Party,
	SpellSlot,
} from './types';

export type CharacterFieldsPatch = Partial<
	Pick<CharacterState, 'ac' | 'initiativeModifier' | 'speedFeet' | 'inspiration' | 'exhaustion' | 'deathSaves' | 'name'>
>;

export type CombatantPatch = Partial<
	Pick<Combatant, 'displayName' | 'initiative' | 'initiativeModifier' | 'ac' | 'acOverride' | 'defeated' | 'tieOrder'>
> & { hpMax?: number | null };

export type EffectPatch = Partial<
	Pick<Effect, 'label' | 'duration' | 'notes' | 'needsDecision' | 'sourceCombatantId' | 'sourceLabel' | 'target' | 'concentrationEffectId'>
>;

export interface RestCharacterChange {
	characterId: string;
	after: CharacterState;
}

export type ActionPayload =
	| { type: 'adventure/rename'; name: string }
	| { type: 'party/create'; party: Party }
	| { type: 'party/rename'; partyId: string; name: string }
	| { type: 'party/delete'; partyId: string }
	| { type: 'party/set-members'; partyId: string; characterIds: string[] }
	| { type: 'party/set-active'; partyId: string | null }
	| { type: 'character/upsert'; character: CharacterState }
	| { type: 'character/remove'; characterId: string }
	| { type: 'character/set-fields'; characterId: string; patch: CharacterFieldsPatch }
	| { type: 'character/set-hp'; characterId: string; current?: number; max?: number | null; temporary?: number }
	| { type: 'character/set-slot'; characterId: string; level: string; slot: SpellSlot | null }
	| { type: 'character/set-counter'; characterId: string; counter: Counter }
	| { type: 'character/remove-counter'; characterId: string; counterId: string }
	| { type: 'character/set-hit-dice'; characterId: string; hitDice: HitDice[] }
	| { type: 'hp/damage'; target: EffectTarget; amount: number; useTemporary: boolean }
	| { type: 'hp/heal'; target: EffectTarget; amount: number }
	| { type: 'hp/set-temporary'; target: EffectTarget; value: number }
	| { type: 'creature/upsert'; creature: CreatureCard }
	| { type: 'creature/remove'; creatureId: string }
	| { type: 'template/upsert'; template: EncounterTemplate }
	| { type: 'template/remove'; templateId: string }
	| { type: 'encounter/create'; encounter: Encounter }
	| { type: 'encounter/begin' }
	| { type: 'encounter/end' }
	| { type: 'encounter/add-combatants'; combatants: Combatant[]; groups?: InitiativeGroup[] }
	| { type: 'encounter/remove-combatant'; combatantId: string }
	| { type: 'encounter/update-combatant'; combatantId: string; patch: CombatantPatch }
	| { type: 'encounter/set-group'; combatantIds: string[]; group: InitiativeGroup | null }
	| { type: 'encounter/update-group'; groupId: string; patch: Partial<Pick<InitiativeGroup, 'name' | 'initiative'>> }
	| { type: 'encounter/move-in-ties'; slotId: string; direction: -1 | 1 }
	| { type: 'encounter/next' }
	| { type: 'encounter/previous' }
	| { type: 'encounter/jump'; slotId: string; endCurrent: boolean }
	| { type: 'encounter/pause'; paused: boolean }
	| { type: 'effect/add'; effect: Effect }
	| { type: 'effect/update'; effectId: string; patch: EffectPatch }
	| { type: 'effect/remove'; effectIds: string[] }
	| { type: 'concentration/end'; effectId: string; removeLinkedIds: string[] }
	| { type: 'rest/apply'; kind: 'short' | 'long'; changes: RestCharacterChange[]; removeEffectIds: string[] }
	| { type: 'clock/advance'; minutes: number }
	| { type: 'node/override'; canvasPath: string; nodeId: string; category: NodeCategory | null }
	| { type: 'import/apply'; characters: CharacterState[]; addToPartyId: string | null; files?: FileSnapshot[] }
	| { type: 'cockpit/sheet-set'; characterId: string; patch: Partial<Sheet> }
	| { type: 'cockpit/statblock-set'; statblock: StatBlock }
	| { type: 'cockpit/npc-create'; creature: CreatureCard; statblock: StatBlock; items: ItemInstance[]; purse?: Purse }
	| { type: 'cockpit/character-build'; character: CharacterState; sheet: Sheet; items: ItemInstance[]; purse?: Purse; book?: Spellbook; partyId?: string | null }
	| { type: 'cockpit/level-up'; character: CharacterState; sheet: Sheet }
	| { type: 'cockpit/item-upsert'; item: ItemInstance }
	| { type: 'cockpit/item-remove'; itemId: string }
	| { type: 'cockpit/item-transfer'; itemId: string; ownerKind: 'character' | 'creature'; ownerId: string; qty?: number; newId?: string }
	| { type: 'cockpit/purse-set'; ownerId: string; purse: Purse }
	| { type: 'cockpit/itemtype-upsert'; itemType: ItemType }
	| { type: 'cockpit/spellbook-set'; characterId: string; book: Spellbook }
	| { type: 'cockpit/cast'; characterId: string; spell: SpellRef; slotLevel: number; effect?: Effect }
	| { type: 'cockpit/viewpoint-set'; canvasRel: string; slot: string; view: ViewPoint | null }
	| { type: 'history/undo' }
	| { type: 'history/redo' };

export type Action = ActionPayload & {
	actionId: string;
	adventureId: string;
	at: string;
};

export type ActionType = ActionPayload['type'];

export const ACTION_LABELS: Record<ActionType, string> = {
	'adventure/rename': 'Переименование приключения',
	'party/create': 'Новая партия',
	'party/rename': 'Переименование партии',
	'party/delete': 'Удаление партии',
	'party/set-members': 'Состав партии',
	'party/set-active': 'Выбор партии',
	'character/upsert': 'Персонаж',
	'character/remove': 'Удаление персонажа',
	'character/set-fields': 'Поля персонажа',
	'character/set-hp': 'Хиты',
	'character/set-slot': 'Ячейки заклинаний',
	'character/set-counter': 'Счётчик',
	'character/remove-counter': 'Удаление счётчика',
	'character/set-hit-dice': 'Кости хитов',
	'hp/damage': 'Урон',
	'hp/heal': 'Лечение',
	'hp/set-temporary': 'Временные хиты',
	'creature/upsert': 'Карточка существа',
	'creature/remove': 'Удаление карточки',
	'template/upsert': 'Шаблон столкновения',
	'template/remove': 'Удаление шаблона',
	'encounter/create': 'Новый бой',
	'encounter/begin': 'Начало боя',
	'encounter/end': 'Завершение боя',
	'encounter/add-combatants': 'Добавление участников',
	'encounter/remove-combatant': 'Удаление участника',
	'encounter/update-combatant': 'Изменение участника',
	'encounter/set-group': 'Общая инициатива',
	'encounter/update-group': 'Изменение группы',
	'encounter/move-in-ties': 'Порядок при равенстве',
	'encounter/next': 'Следующий ход',
	'encounter/previous': 'Предыдущий ход',
	'encounter/jump': 'Переход к участнику',
	'encounter/pause': 'Пауза боя',
	'effect/add': 'Эффект',
	'effect/update': 'Изменение эффекта',
	'effect/remove': 'Снятие эффекта',
	'concentration/end': 'Конец концентрации',
	'rest/apply': 'Отдых',
	'clock/advance': 'Игровое время',
	'node/override': 'Тип узла',
	'import/apply': 'Импорт персонажей',
	'cockpit/sheet-set': 'Лист персонажа',
	'cockpit/statblock-set': 'Статблок',
	'cockpit/npc-create': 'Быстрый NPC',
	'cockpit/character-build': 'Новый персонаж',
	'cockpit/level-up': 'Повышение уровня',
	'cockpit/item-upsert': 'Предмет',
	'cockpit/item-remove': 'Удаление предмета',
	'cockpit/item-transfer': 'Передача предмета',
	'cockpit/purse-set': 'Монеты',
	'cockpit/itemtype-upsert': 'Тип предмета',
	'cockpit/spellbook-set': 'Книга заклинаний',
	'cockpit/cast': 'Заклинание',
	'cockpit/viewpoint-set': 'Точка обзора',
	'history/undo': 'Отмена',
	'history/redo': 'Повтор',
};
