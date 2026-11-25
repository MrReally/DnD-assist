// Reducer part for GM Cockpit data (state.extensions.cockpit). Mutates the draft; throws DomainError on bad input.
import type { Action } from './actions';
import { ABILITIES, cockpitMut, emptySheet, type ItemInstance, type Purse, type Sheet, type StatBlock } from './cockpit';
import { DomainError } from './combat';
import type { AdventureState } from './types';

const str = (v: unknown, name: string, max = 4000): string => {
	if (typeof v !== 'string' || v.length > max) throw new DomainError(`Недопустимое значение «${name}»`);
	return v;
};
const int = (v: unknown, name: string, min: number, max: number): number => {
	if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new DomainError(`Недопустимое значение «${name}»`);
	return v;
};
const num = (v: unknown, name: string, min: number, max: number): number => {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new DomainError(`Недопустимое значение «${name}»`);
	return v;
};

function checkSheet(sh: Sheet): Sheet {
	for (const a of ABILITIES) int(sh.abilities[a], `характеристика ${a}`, 1, 40);
	if (sh.profBonus !== null) int(sh.profBonus, 'бонус мастерства', 0, 10);
	for (const [k, v] of Object.entries(sh.skills)) if (v !== 1 && v !== 2) throw new DomainError(`Недопустимое владение навыком «${k}»`);
	str(sh.race, 'раса', 200);
	str(sh.background, 'предыстория', 200);
	str(sh.subclass, 'подкласс', 200);
	return sh;
}

function checkPurse(p: Purse): Purse {
	for (const k of ['pp', 'gp', 'ep', 'sp', 'cp'] as const) int(p[k], `монеты ${k}`, 0, 100000000);
	return p;
}

function checkItem(s: AdventureState, it: ItemInstance): ItemInstance {
	str(it.id, 'id предмета', 120);
	str(it.name, 'название предмета', 200);
	int(it.qty, 'количество', 0, 100000);
	int(it.magicBonus, 'магический бонус', -3, 10);
	ownerExists(s, it.ownerKind, it.ownerId);
	const c = cockpitMut(s);
	if (it.containerId) {
		const box = c.items[it.containerId];
		if (!box || box.ownerId !== it.ownerId) throw new DomainError('Контейнер должен принадлежать тому же владельцу');
		if (it.containerId === it.id) throw new DomainError('Предмет не может лежать в самом себе');
	}
	return it;
}

function ownerExists(s: AdventureState, kind: 'character' | 'creature', id: string): void {
	if (kind === 'character' ? !s.characters[id] : !s.creatures[id]) throw new DomainError('Владелец предмета не найден в этом приключении');
}

function checkStat(sb: StatBlock): StatBlock {
	for (const a of ABILITIES) int(sb.abilities[a], `характеристика ${a}`, 1, 40);
	int(sb.profBonus, 'бонус мастерства', 0, 10);
	for (const at of sb.attacks) {
		str(at.name, 'название атаки', 200);
		str(at.damage, 'урон', 100);
		if (at.bonus !== null) int(at.bonus, 'бонус атаки', -10, 30);
	}
	return sb;
}

function moveContents(c: ReturnType<typeof cockpitMut>, boxId: string, kind: 'character' | 'creature', ownerId: string, depth = 0): void {
	if (depth > 8) return;
	for (const it of Object.values(c.items)) {
		if (it.containerId === boxId) {
			it.ownerKind = kind;
			it.ownerId = ownerId;
			moveContents(c, it.id, kind, ownerId, depth + 1);
		}
	}
}

export function reduceCockpit(s: AdventureState, a: Action): void {
	const c = cockpitMut(s);
	switch (a.type) {
		case 'cockpit/sheet-set': {
			if (!s.characters[a.characterId]) throw new DomainError('Персонаж не найден в этом приключении');
			const cur = c.sheets[a.characterId] ?? emptySheet();
			c.sheets[a.characterId] = checkSheet({ ...cur, ...structuredClone(a.patch), abilities: { ...cur.abilities, ...(a.patch.abilities ?? {}) } });
			return;
		}
		case 'cockpit/statblock-set': {
			if (!s.creatures[a.statblock.creatureId]) throw new DomainError('Карточка существа не найдена');
			c.statblocks[a.statblock.creatureId] = checkStat(structuredClone(a.statblock));
			return;
		}
		case 'cockpit/npc-create': {
			if (s.creatures[a.creature.id]) throw new DomainError('Повтор идентификатора существа');
			s.creatures[a.creature.id] = structuredClone(a.creature);
			c.statblocks[a.creature.id] = checkStat({ ...structuredClone(a.statblock), creatureId: a.creature.id });
			for (const it of a.items) c.items[it.id] = checkItem(s, structuredClone({ ...it, ownerKind: 'creature', ownerId: a.creature.id }));
			if (a.purse) c.purses[a.creature.id] = checkPurse({ ...a.purse });
			return;
		}
		case 'cockpit/character-build': {
			const ch = a.character;
			if (s.characters[ch.id]) throw new DomainError('Повтор идентификатора персонажа');
			s.characters[ch.id] = structuredClone(ch);
			c.sheets[ch.id] = checkSheet(structuredClone(a.sheet));
			for (const it of a.items) c.items[it.id] = checkItem(s, structuredClone({ ...it, ownerKind: 'character', ownerId: ch.id }));
			if (a.purse) c.purses[ch.id] = checkPurse({ ...a.purse });
			if (a.book) c.spellbooks[ch.id] = structuredClone(a.book);
			const party = s.parties.find((p) => p.id === (a.partyId ?? s.activePartyId));
			if (party && !party.characterIds.includes(ch.id)) party.characterIds.push(ch.id);
			return;
		}
		case 'cockpit/item-upsert': {
			c.items[a.item.id] = checkItem(s, structuredClone(a.item));
			return;
		}
		case 'cockpit/item-remove': {
			if (!c.items[a.itemId]) throw new DomainError('Предмет не найден');
			const doomed = new Set<string>([a.itemId]);
			let grew = true;
			while (grew) {
				grew = false;
				for (const it of Object.values(c.items)) if (it.containerId && doomed.has(it.containerId) && !doomed.has(it.id)) (doomed.add(it.id), (grew = true));
			}
			for (const id of doomed) delete c.items[id];
			return;
		}
		case 'cockpit/item-transfer': {
			const it = c.items[a.itemId];
			if (!it) throw new DomainError('Предмет не найден');
			ownerExists(s, a.ownerKind, a.ownerId);
			const qty = a.qty ?? it.qty;
			int(qty, 'количество', 1, it.qty);
			if (qty < it.qty) {
				if (!a.newId || c.items[a.newId]) throw new DomainError('Нужен новый идентификатор для части стопки');
				c.items[a.newId] = { ...structuredClone(it), id: a.newId, qty, ownerKind: a.ownerKind, ownerId: a.ownerId, containerId: null, equipped: false };
				it.qty -= qty;
				return;
			}
			it.ownerKind = a.ownerKind;
			it.ownerId = a.ownerId;
			it.containerId = null;
			it.equipped = false;
			moveContents(c, it.id, a.ownerKind, a.ownerId);
			return;
		}
		case 'cockpit/purse-set':
			if (!s.characters[a.ownerId] && !s.creatures[a.ownerId]) throw new DomainError('Владелец не найден');
			c.purses[a.ownerId] = checkPurse({ ...a.purse });
			return;
		case 'cockpit/itemtype-upsert': {
			const t = a.itemType;
			str(t.id, 'id типа', 120);
			str(t.name, 'название', 200);
			int(t.costCp, 'цена', 0, 1e9);
			num(t.weight, 'вес', 0, 100000);
			c.itemTypes[t.id] = structuredClone(t);
			return;
		}
		case 'cockpit/spellbook-set':
			if (!s.characters[a.characterId]) throw new DomainError('Персонаж не найден в этом приключении');
			for (const r of a.book.known) int(r.level, 'уровень заклинания', 0, 9);
			c.spellbooks[a.characterId] = { known: structuredClone(a.book.known), prepared: [...new Set(a.book.prepared)] };
			return;
		case 'cockpit/viewpoint-set': {
			if (!/^[1-9]$/.test(a.slot)) throw new DomainError('Слот точки обзора 1–9');
			str(a.canvasRel, 'путь Canvas', 1024);
			const map = (c.viewpoints[a.canvasRel] ??= {});
			if (a.view === null) delete map[a.slot];
			else map[a.slot] = { name: str(a.view.name, 'название точки', 80), x: num(a.view.x, 'x', -1e7, 1e7), y: num(a.view.y, 'y', -1e7, 1e7), zoom: num(a.view.zoom, 'масштаб', -10, 10) };
			if (!Object.keys(map).length) delete c.viewpoints[a.canvasRel];
			return;
		}
		default:
			return;
	}
}
