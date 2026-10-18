// Runtime validation of the persisted adventure state (schema v2).
// The machine-readable JSON Schema lives in schemas/adventure-state.schema.json and is
// cross-checked against this validator in tests.

export interface ValidationIssue {
	path: string;
	message: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

class Checker {
	issues: ValidationIssue[] = [];
	fail(path: string, message: string): void {
		if (this.issues.length < 200) this.issues.push({ path, message });
	}
	obj(v: unknown, path: string): v is Obj {
		if (!isObj(v)) {
			this.fail(path, 'ожидается объект');
			return false;
		}
		return true;
	}
	str(v: unknown, path: string, minLength = 0): void {
		if (!isStr(v) || v.length < minLength) this.fail(path, minLength ? 'ожидается непустая строка' : 'ожидается строка');
	}
	int(v: unknown, path: string, min?: number, max?: number): void {
		if (!isInt(v)) return this.fail(path, 'ожидается целое число');
		if (min !== undefined && v < min) this.fail(path, `не меньше ${min}`);
		if (max !== undefined && v > max) this.fail(path, `не больше ${max}`);
	}
	intOrNull(v: unknown, path: string, min?: number, max?: number): void {
		if (v !== null) this.int(v, path, min, max);
	}
	bool(v: unknown, path: string): void {
		if (typeof v !== 'boolean') this.fail(path, 'ожидается логическое значение');
	}
	arr(v: unknown, path: string): v is unknown[] {
		if (!Array.isArray(v)) {
			this.fail(path, 'ожидается массив');
			return false;
		}
		return true;
	}
	oneOf(v: unknown, path: string, values: readonly unknown[]): void {
		if (!values.includes(v)) this.fail(path, `допустимо: ${values.join(', ')}`);
	}
}

function checkHp(c: Checker, v: unknown, path: string): void {
	if (!c.obj(v, path)) return;
	c.int(v.current, `${path}.current`, 0);
	c.intOrNull(v.max, `${path}.max`, 0);
	c.int(v.temporary, `${path}.temporary`, 0);
}

function checkCharacter(c: Checker, v: unknown, path: string, key: string): void {
	if (!c.obj(v, path)) return;
	if (v.id !== key) c.fail(`${path}.id`, 'id не совпадает с ключом');
	c.str(v.name, `${path}.name`);
	c.str(v.notePath, `${path}.notePath`);
	if (isStr(v.notePath) && (v.notePath.startsWith('/') || v.notePath.split('/').includes('..'))) {
		c.fail(`${path}.notePath`, 'путь должен быть относительным внутри приключения');
	}
	c.arr(v.classes, `${path}.classes`);
	checkHp(c, v.hp, `${path}.hp`);
	c.intOrNull(v.ac, `${path}.ac`, 0, 100);
	c.intOrNull(v.initiativeModifier, `${path}.initiativeModifier`, -30, 30);
	c.intOrNull(v.speedFeet, `${path}.speedFeet`, 0, 1000);
	if (c.obj(v.spellSlots, `${path}.spellSlots`)) {
		for (const [lvl, slot] of Object.entries(v.spellSlots)) {
			if (!/^[1-9]$/.test(lvl)) c.fail(`${path}.spellSlots.${lvl}`, 'уровень 1–9');
			if (c.obj(slot, `${path}.spellSlots.${lvl}`)) {
				c.int(slot.max, `${path}.spellSlots.${lvl}.max`, 0, 99);
				c.int(slot.current, `${path}.spellSlots.${lvl}.current`, 0, isInt(slot.max) ? slot.max : 99);
			}
		}
	}
	c.arr(v.hitDice, `${path}.hitDice`);
	if (c.obj(v.deathSaves, `${path}.deathSaves`)) {
		c.int(v.deathSaves.successes, `${path}.deathSaves.successes`, 0, 3);
		c.int(v.deathSaves.failures, `${path}.deathSaves.failures`, 0, 3);
	}
	c.bool(v.inspiration, `${path}.inspiration`);
	c.int(v.exhaustion, `${path}.exhaustion`, 0, 6);
	if (c.obj(v.counters, `${path}.counters`)) {
		for (const [id, ctr] of Object.entries(v.counters)) {
			const p = `${path}.counters.${id}`;
			if (!c.obj(ctr, p)) continue;
			c.str(ctr.name, `${p}.name`);
			c.int(ctr.current, `${p}.current`, 0);
			c.intOrNull(ctr.max, `${p}.max`, 0);
			c.oneOf(ctr.recovery, `${p}.recovery`, ['manual', 'short', 'long']);
		}
	}
}

function checkEffect(c: Checker, v: unknown, path: string): void {
	if (!c.obj(v, path)) return;
	c.str(v.id, `${path}.id`, 1);
	c.str(v.label, `${path}.label`);
	if (c.obj(v.target, `${path}.target`)) {
		c.oneOf(v.target.kind, `${path}.target.kind`, ['character', 'combatant']);
		c.str(v.target.id, `${path}.target.id`, 1);
	}
	c.int(v.createdAtEventSeq, `${path}.createdAtEventSeq`, 0);
	c.bool(v.isConcentration, `${path}.isConcentration`);
	c.bool(v.needsDecision, `${path}.needsDecision`);
	if (c.obj(v.duration, `${path}.duration`)) {
		const d = v.duration;
		c.oneOf(d.kind, `${path}.duration.kind`, ['manual', 'turns', 'rounds', 'game-time']);
		if (d.kind === 'turns' || d.kind === 'rounds') {
			c.int(d.remaining, `${path}.duration.remaining`, 0);
			c.oneOf(d.phase, `${path}.duration.phase`, ['start', 'end']);
		}
		if (d.kind === 'turns') c.str(d.ownerCombatantId, `${path}.duration.ownerCombatantId`, 1);
		if (d.kind === 'game-time') c.int(d.expiresAtMinute, `${path}.duration.expiresAtMinute`, 0);
	}
}

function checkEncounter(c: Checker, v: unknown, path: string): void {
	if (!c.obj(v, path)) return;
	c.str(v.id, `${path}.id`, 1);
	c.int(v.round, `${path}.round`, 0);
	c.bool(v.paused, `${path}.paused`);
	c.arr(v.actedThisRound, `${path}.actedThisRound`);
	c.obj(v.groups, `${path}.groups`);
	c.obj(v.turnLog, `${path}.turnLog`);
	c.int(v.turnLogSeq, `${path}.turnLogSeq`, 0);
	if (c.arr(v.insertion, `${path}.insertion`) && isObj(v.combatants)) {
		for (const id of v.insertion) if (!isStr(id) || !(id in v.combatants)) c.fail(`${path}.insertion`, `неизвестный участник ${String(id)}`);
	}
	if (c.obj(v.combatants, `${path}.combatants`)) {
		for (const [id, cmb] of Object.entries(v.combatants)) {
			const p = `${path}.combatants.${id}`;
			if (!c.obj(cmb, p)) continue;
			if (cmb.id !== id) c.fail(`${p}.id`, 'id не совпадает с ключом');
			c.oneOf(cmb.kind, `${p}.kind`, ['pc', 'monster', 'npc', 'other']);
			c.str(cmb.displayName, `${p}.displayName`);
			c.intOrNull(cmb.initiative, `${p}.initiative`, -50, 100);
			c.int(cmb.tieOrder, `${p}.tieOrder`);
			c.bool(cmb.defeated, `${p}.defeated`);
			if (cmb.hp !== null) checkHp(c, cmb.hp, `${p}.hp`);
			if (cmb.kind === 'pc' && !isStr(cmb.characterId)) c.fail(`${p}.characterId`, 'для PC обязателен characterId');
		}
	}
}

export function validateAdventureState(v: unknown): ValidationIssue[] {
	const c = new Checker();
	if (!c.obj(v, '$')) return c.issues;
	if (v.schemaVersion !== 2) c.fail('$.schemaVersion', 'ожидается 2');
	c.str(v.stateId, '$.stateId', 1);
	c.str(v.adventureId, '$.adventureId', 1);
	c.str(v.rootPath, '$.rootPath');
	c.str(v.name, '$.name');
	c.int(v.revision, '$.revision', 0);
	if (v.activePartyId !== null) c.str(v.activePartyId, '$.activePartyId', 1);
	if (c.arr(v.parties, '$.parties')) {
		v.parties.forEach((p, i) => {
			if (!c.obj(p, `$.parties[${i}]`)) return;
			c.str(p.id, `$.parties[${i}].id`, 1);
			c.str(p.name, `$.parties[${i}].name`);
			if (c.arr(p.characterIds, `$.parties[${i}].characterIds`)) {
				if (new Set(p.characterIds).size !== p.characterIds.length) c.fail(`$.parties[${i}].characterIds`, 'повторы');
			}
		});
	}
	if (c.obj(v.characters, '$.characters')) {
		for (const [k, ch] of Object.entries(v.characters)) checkCharacter(c, ch, `$.characters.${k}`, k);
	}
	c.obj(v.creatures, '$.creatures');
	c.arr(v.encounterTemplates, '$.encounterTemplates');
	if (v.activeEncounter !== null) checkEncounter(c, v.activeEncounter, '$.activeEncounter');
	if (c.obj(v.effects, '$.effects')) {
		for (const [k, e] of Object.entries(v.effects)) checkEffect(c, e, `$.effects.${k}`);
	}
	c.int(v.eventSeq, '$.eventSeq', 0);
	if (c.obj(v.gameClock, '$.gameClock')) c.int(v.gameClock.minutes, '$.gameClock.minutes', 0);
	c.obj(v.nodeOverrides, '$.nodeOverrides');
	if (c.obj(v.history, '$.history')) {
		c.arr(v.history.undo, '$.history.undo');
		c.arr(v.history.redo, '$.history.redo');
	}
	c.arr(v.appliedActionIds, '$.appliedActionIds');
	c.obj(v.extensions, '$.extensions');
	return c.issues;
}
