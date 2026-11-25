// Pure card resolution for GM Cockpit: maps a vault path (e.g. a Canvas file node) to a game card.
// No Obsidian/DOM access. Only the adventure's own state is consulted (adventure isolation).
import { relativeTo } from './normalize';
import type { AdventureState, CharacterState, EffectTarget } from './types';

/** What the GM Panel shows: a character, a combatant, or a bare creature card (not in combat). */
export type CardRef = EffectTarget | { kind: 'creature'; id: string } | { kind: 'room'; id: string };

/** Character whose sheet note is `vaultPath`, or null (outside the adventure root, unknown note). */
export function characterForNote(state: AdventureState, vaultPath: string): CharacterState | null {
	const rel = relativeTo(state.rootPath, vaultPath);
	if (rel === null) return null;
	return Object.values(state.characters).find((c) => c.notePath === rel) ?? null;
}

export function cardTargetForNote(state: AdventureState, vaultPath: string): EffectTarget | null {
	const ch = characterForNote(state, vaultPath);
	return ch ? { kind: 'character', id: ch.id } : null;
}

export interface HpEdit {
	kind: 'damage' | 'heal' | 'set' | 'invalid';
	amount: number;
}

/**
 * Interprets the ± field of the card: "-7" damage, "+5"/"5" healing, "=12" sets current HP.
 * The GM states the final number; nothing is computed from attacks or resistances.
 */
export function parseHpInput(text: string): HpEdit {
	const t = text.trim();
	const m = /^([+\-=]?)\s*(\d{1,6})$/.exec(t);
	if (!m) return { kind: 'invalid', amount: 0 };
	const n = Number(m[2]);
	if (m[1] === '-') return { kind: 'damage', amount: n };
	if (m[1] === '=') return { kind: 'set', amount: n };
	return { kind: 'heal', amount: n };
}

/** Width of the HP bar in percent (0–100). Unknown max → empty bar. */
export function hpPercent(current: number, max: number | null): number {
	if (max === null || max <= 0) return 0;
	return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

// ---- card model (read side of GM Cockpit) ---------------------------------------------------------
import { resolveItemType } from './builder';
import { cockpitOf, isProficientWith, profBonusOf, totalLevel, weaponAttack, signed, type Abilities, type ItemInstance, type ItemType, type Sheet, type StatBlock } from './cockpit';
import { hpOf } from './combat';
import type { HitPoints } from './types';

export type CardKind = 'pc' | 'npc' | 'monster';

export interface AttackRow {
	/** Item instance id when the attack comes from an item, else the statblock attack id. */
	key: string;
	itemId: string | null;
	name: string;
	bonus: number;
	damage: string;
	damageType: string;
	range: string;
	notes: string;
}

export interface Owner {
	kind: 'character' | 'creature';
	id: string;
}

export interface CardModel {
	kind: CardKind;
	name: string;
	sub: string;
	ac: number | null;
	acOverridden: boolean;
	hp: HitPoints | null;
	/** Where hp/damage|heal actions go. */
	hpTarget: EffectTarget | null;
	owner: Owner | null;
	abilities: Abilities | null;
	prof: number;
	attacks: AttackRow[];
	sheet: Sheet | null;
	statblock: StatBlock | null;
	characterId: string | null;
	combatantId: string | null;
	level: number;
}

export function weaponItemsOf(state: AdventureState, owner: Owner): Array<{ item: ItemInstance; type: ItemType }> {
	const out: Array<{ item: ItemInstance; type: ItemType }> = [];
	for (const item of Object.values(cockpitOf(state).items)) {
		if (item.ownerId !== owner.id || item.ownerKind !== owner.kind) continue;
		const type = resolveItemType(state, item);
		if (type?.kind === 'weapon') out.push({ item, type });
	}
	return out;
}

/** Everything a compact card needs, derived from state only (pure, unit-tested). */
export function resolveCard(state: AdventureState, target: CardRef): CardModel | null {
	const c = cockpitOf(state);
	if (target.kind === 'room') return null;
	if (target.kind === 'creature') return resolveCreature(state, target.id);
	const cmb = target.kind === 'combatant' ? state.activeEncounter?.combatants[target.id] : undefined;
	if (target.kind === 'combatant' && !cmb) return null;
	const chId = target.kind === 'character' ? target.id : cmb?.characterId ?? null;
	const ch = chId ? state.characters[chId] : undefined;
	if (chId && !ch) return null;
	if (ch) {
		const sheet = c.sheets[ch.id] ?? null;
		const level = totalLevel(ch.classes);
		const prof = profBonusOf(sheet ?? undefined, level);
		const owner: Owner = { kind: 'character', id: ch.id };
		const abil = sheet?.abilities ?? null;
		const attacks: AttackRow[] = abil
			? weaponItemsOf(state, owner)
					.filter((w) => w.item.equipped)
					.map(({ item, type }) => {
						const a = weaponAttack(type, abil, prof, isProficientWith(type, sheet ?? undefined), item.magicBonus);
						return { key: item.id, itemId: item.id, name: item.name, bonus: a.bonus, damage: a.damage, damageType: a.damageType, range: a.range, notes: '' };
					})
			: [];
		return {
			kind: 'pc', name: cmb?.displayName ?? ch.name,
			sub: [sheet?.race, ch.classes.map((k) => `${k.name} ${k.level}`).join(' / '), sheet?.subclass].filter(Boolean).join(' · ') || 'Игровой персонаж',
			ac: cmb?.acOverride ?? ch.ac, acOverridden: cmb?.acOverride != null, hp: ch.hp, hpTarget: { kind: 'character', id: ch.id }, owner,
			abilities: abil, prof, attacks, sheet, statblock: null, characterId: ch.id, combatantId: cmb?.id ?? null, level,
		};
	}
	// creature (NPC / monster): a combatant instance and/or a creature card
	const creatureId = cmb?.creatureId ?? null;
	const sb = creatureId ? c.statblocks[creatureId] ?? null : null;
	if (!cmb) return null;
	const owner: Owner | null = creatureId ? { kind: 'creature', id: creatureId } : null;
	const attacks: AttackRow[] = sb
		? sb.attacks.map((at) => {
				const item = owner ? Object.values(c.items).find((i) => i.ownerId === owner.id && i.typeId === at.id) : undefined;
				const type = item ? resolveItemType(state, item) : null;
				const calc = type ? weaponAttack(type, sb.abilities, sb.profBonus, true, item?.magicBonus ?? 0) : null;
				return { key: at.id, itemId: item?.id ?? null, name: at.name, bonus: at.bonus ?? calc?.bonus ?? 0, damage: at.damage, damageType: at.damageType, range: at.range, notes: at.notes };
			})
		: [];
	return {
		kind: sb?.kind ?? (cmb.kind === 'npc' ? 'npc' : 'monster'), name: cmb.displayName,
		sub: sb ? [sb.role, sb.type].filter(Boolean).join(' · ') || sb.type : state.creatures[creatureId ?? '']?.notes ?? '',
		ac: cmb.acOverride ?? cmb.ac, acOverridden: cmb.acOverride !== null, hp: hpOf(state, cmb), hpTarget: { kind: 'combatant', id: cmb.id }, owner,
		abilities: sb?.abilities ?? null, prof: sb?.profBonus ?? 2, attacks, sheet: null, statblock: sb, characterId: null, combatantId: cmb.id, level: 0,
	};
}

export function modText(score: number): string {
	return signed(Math.floor((score - 10) / 2));
}

function resolveCreature(state: AdventureState, creatureId: string): CardModel | null {
	const cr = state.creatures[creatureId];
	if (!cr) return null;
	const c = cockpitOf(state);
	const sb = c.statblocks[creatureId] ?? null;
	const owner: Owner = { kind: 'creature', id: creatureId };
	const attacks: AttackRow[] = sb
		? sb.attacks.map((at) => {
				const item = Object.values(c.items).find((i) => i.ownerId === creatureId && i.typeId === at.id);
				const type = item ? resolveItemType(state, item) : null;
				const calc = type ? weaponAttack(type, sb.abilities, sb.profBonus, true, item?.magicBonus ?? 0) : null;
				return { key: at.id, itemId: item?.id ?? null, name: at.name, bonus: at.bonus ?? calc?.bonus ?? 0, damage: at.damage, damageType: at.damageType, range: at.range, notes: at.notes };
			})
		: [];
	return {
		kind: sb?.kind ?? 'npc', name: cr.name, sub: sb ? [sb.role, sb.type].filter(Boolean).join(' · ') : cr.notes,
		ac: cr.ac, acOverridden: false, hp: cr.hpMax === null ? null : { current: cr.hpMax, max: cr.hpMax, temporary: 0 }, hpTarget: null, owner,
		abilities: sb?.abilities ?? null, prof: sb?.profBonus ?? 2, attacks, sheet: null, statblock: sb, characterId: null, combatantId: null, level: 0,
	};
}

/** Creature card whose source note is `vaultPath` (an NPC note on the Canvas), or null. */
export function creatureForNote(state: AdventureState, vaultPath: string): string | null {
	const rel = relativeTo(state.rootPath, vaultPath);
	if (rel === null) return null;
	return Object.values(state.creatures).find((cr) => cr.source?.provider === 'note' && cr.source.ref === rel)?.id ?? null;
}
