import type { HitPoints } from './types';

export interface DamageResult {
	hp: HitPoints;
	absorbedByTemporary: number;
	appliedToCurrent: number;
}

function assertAmount(amount: number): void {
	if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Значение должно быть целым неотрицательным числом');
}

/** Damage: temporary HP absorb first when enabled; current HP never drops below 0. */
export function applyDamage(hp: HitPoints, amount: number, useTemporary: boolean): DamageResult {
	assertAmount(amount);
	let rest = amount;
	let temporary = hp.temporary;
	let absorbed = 0;
	if (useTemporary && temporary > 0) {
		absorbed = Math.min(temporary, rest);
		temporary -= absorbed;
		rest -= absorbed;
	}
	const current = Math.max(0, hp.current - rest);
	return { hp: { ...hp, current, temporary }, absorbedByTemporary: absorbed, appliedToCurrent: hp.current - current };
}

/** Healing never exceeds max (when max is known). */
export function applyHealing(hp: HitPoints, amount: number): HitPoints {
	assertAmount(amount);
	const raw = hp.current + amount;
	return { ...hp, current: hp.max === null ? raw : Math.min(hp.max, raw) };
}

export function setTemporary(hp: HitPoints, value: number): HitPoints {
	assertAmount(value);
	return { ...hp, temporary: value };
}
