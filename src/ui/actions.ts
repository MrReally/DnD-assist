// UI-level commands shared by the bar, the side panel, hotkeys and the command palette.
import { Notice } from 'obsidian';
import { hpOf, skippedByJump } from '../domain/combat';
import { applyDamage, applyHealing } from '../domain/hp';
import type { EffectTarget, HitPoints } from '../domain/types';
import type { Controller } from '../controller';
import { NumberModal, confirm, hpText } from './common';
import { EffectModal } from './effect-modal';

function targetHp(ctl: Controller, t: EffectTarget): HitPoints | null {
	const s = ctl.state;
	if (!s) return null;
	if (t.kind === 'character') return s.characters[t.id]?.hp ?? null;
	const c = s.activeEncounter?.combatants[t.id];
	return c ? hpOf(s, c) : null;
}

function requireTarget(ctl: Controller): EffectTarget | null {
	const t = ctl.target;
	if (!t) new Notice('Canvas Assist: сначала выберите цель (клик по участнику)');
	return t;
}

export function openDamage(ctl: Controller, t: EffectTarget | null = ctl.target): void {
	const target = t ?? requireTarget(ctl);
	if (!target) return;
	const useTemp = ctl.settings.temporaryHpAbsorbs;
	new NumberModal(
		ctl.app,
		`Урон: ${ctl.targetName(target)}`,
		`Введите урон по результату физических кубиков.${useTemp ? ' Временные хиты поглощают урон первыми.' : ''}`,
		(n) => {
			const hp = targetHp(ctl, target);
			if (!hp) return '';
			const r = applyDamage(hp, n, useTemp);
			return `${hpText(hp)} → ${hpText(r.hp)}${r.absorbedByTemporary ? ` (временные поглотили ${r.absorbedByTemporary})` : ''}`;
		},
		async (n) => (await ctl.act({ type: 'hp/damage', target, amount: n, useTemporary: useTemp })).ok,
	).open();
}

export function openHeal(ctl: Controller, t: EffectTarget | null = ctl.target): void {
	const target = t ?? requireTarget(ctl);
	if (!target) return;
	new NumberModal(
		ctl.app,
		`Лечение: ${ctl.targetName(target)}`,
		'Введите количество восстановленных хитов (не выше максимума).',
		(n) => {
			const hp = targetHp(ctl, target);
			return hp ? `${hpText(hp)} → ${hpText(applyHealing(hp, n))}` : '';
		},
		async (n) => (await ctl.act({ type: 'hp/heal', target, amount: n })).ok,
	).open();
}

export function openTempHp(ctl: Controller, t: EffectTarget | null = ctl.target): void {
	const target = t ?? requireTarget(ctl);
	if (!target) return;
	const cur = targetHp(ctl, target)?.temporary ?? 0;
	new NumberModal(
		ctl.app,
		`Временные хиты: ${ctl.targetName(target)}`,
		'Новое значение временных хитов (не складываются — мастер выбирает итог).',
		(n) => `${cur} → ${n}`,
		async (n) => (await ctl.act({ type: 'hp/set-temporary', target, value: n })).ok,
		{ initial: String(cur) },
	).open();
}

export function openEffect(ctl: Controller, t: EffectTarget | null = ctl.target): void {
	if (!ctl.state) return void new Notice('Canvas Assist: нет активного приключения');
	new EffectModal(ctl, t).open();
}

export async function nextTurn(ctl: Controller): Promise<void> {
	if (!ctl.state?.activeEncounter) return;
	const enc = ctl.state.activeEncounter;
	await ctl.act({ type: enc.round === 0 ? 'encounter/begin' : 'encounter/next' });
}

export async function previousTurn(ctl: Controller): Promise<void> {
	if (!ctl.state?.activeEncounter) return;
	await ctl.act({ type: 'encounter/previous' });
}

export async function jumpToSlot(ctl: Controller, slotId: string): Promise<void> {
	const enc = ctl.state?.activeEncounter;
	if (!enc) return;
	if (enc.round === 0) return void new Notice('Сначала начните бой');
	const skipped = skippedByJump(enc, slotId);
	const lines = [
		'Ход текущего участника будет завершён (событие «конец хода»).',
		skipped.length
			? `Пропущенные без событий начала/конца хода: ${skipped.map((s) => s.name).join(', ')}. Их эффекты не тикают.`
			: 'Промежуточных участников нет.',
	];
	if (!(await confirm(ctl.app, 'Перейти к участнику', lines, 'Перейти'))) return;
	await ctl.act({ type: 'encounter/jump', slotId, endCurrent: true });
}

export async function endEncounter(ctl: Controller): Promise<void> {
	const s = ctl.state;
	const enc = s?.activeEncounter;
	if (!s || !enc) return;
	const pending = Object.values(s.effects).filter((e) => e.target.kind === 'character' && (e.duration.kind === 'turns' || e.duration.kind === 'rounds'));
	const lines = [
		'Хиты, ячейки и ресурсы персонажей сохраняются (это не отдых).',
		'Эффекты на противниках этого боя удаляются вместе с боем.',
		pending.length ? `Эффекты PC с боевой длительностью (${pending.length}) останутся со статусом «требует решения мастера».` : '',
		'Действие можно отменить (Undo).',
	].filter(Boolean);
	if (!(await confirm(ctl.app, `Завершить бой «${enc.name}»?`, lines, 'Завершить бой', true))) return;
	await ctl.act({ type: 'encounter/end' });
}

export async function removeCombatant(ctl: Controller, combatantId: string): Promise<void> {
	const c = ctl.state?.activeEncounter?.combatants[combatantId];
	if (!c) return;
	if (!(await confirm(ctl.app, `Удалить «${c.displayName}» из боя?`, ['Эффекты на этом участнике будут удалены; эффекты, отсчитываемые по его ходам, получат статус «требует решения». Можно отменить.'], 'Удалить', true))) return;
	await ctl.act({ type: 'encounter/remove-combatant', combatantId });
}
