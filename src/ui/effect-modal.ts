import { Modal, Setting } from 'obsidian';
import { computeSlots } from '../domain/combat';
import { CONDITIONS, getCondition } from '../domain/conditions';
import { describeDuration } from '../domain/effect-clock';
import { newId } from '../domain/ids';
import type { Effect, EffectDuration, EffectTarget } from '../domain/types';
import type { Controller } from '../controller';
import { button, confirm } from './common';

type DurKind = 'manual' | 'turns' | 'until-turn' | 'rounds' | 'game-time';

/** Normalizes a combatant target of a PC to the persistent character (effects outlive the encounter). */
export function persistentTarget(ctl: Controller, t: EffectTarget): EffectTarget {
	if (t.kind === 'combatant') {
		const c = ctl.state?.activeEncounter?.combatants[t.id];
		if (c?.characterId) return { kind: 'character', id: c.characterId };
	}
	return t;
}

export function combatantIdForTarget(ctl: Controller, t: EffectTarget): string | null {
	const enc = ctl.state?.activeEncounter;
	if (!enc) return null;
	if (t.kind === 'combatant') return enc.combatants[t.id] ? t.id : null;
	return Object.values(enc.combatants).find((c) => c.characterId === t.id)?.id ?? null;
}

export class EffectModal extends Modal {
	constructor(
		private readonly ctl: Controller,
		private readonly initialTarget: EffectTarget | null,
		private readonly existing: Effect | null = null,
	) {
		super(ctl.app);
	}

	override onOpen(): void {
		const state = this.ctl.state;
		if (!state) {
			this.close();
			return;
		}
		const enc = state.activeEncounter;
		const ex = this.existing;
		this.titleEl.setText(ex ? `Эффект: ${ex.label}` : 'Новый эффект');
		this.modalEl.addClass('ca-effect-modal');
		const el = this.contentEl;

		const targets: Array<{ key: string; label: string; target: EffectTarget }> = [];
		const seenChars = new Set<string>();
		if (enc) {
			for (const s of computeSlots(enc)) {
				for (const id of s.memberIds) {
					const c = enc.combatants[id];
					if (!c) continue;
					if (c.characterId) {
						seenChars.add(c.characterId);
						targets.push({ key: `character:${c.characterId}`, label: c.displayName, target: { kind: 'character', id: c.characterId } });
					} else targets.push({ key: `combatant:${c.id}`, label: c.displayName, target: { kind: 'combatant', id: c.id } });
				}
			}
		}
		for (const ch of Object.values(state.characters)) {
			if (!seenChars.has(ch.id)) targets.push({ key: `character:${ch.id}`, label: `${ch.name} (вне боя)`, target: { kind: 'character', id: ch.id } });
		}
		const init = ex?.target ?? (this.initialTarget ? persistentTarget(this.ctl, this.initialTarget) : targets[0]?.target ?? null);
		let targetKey = init ? `${init.kind}:${init.id}` : '';
		let conditionId: string = ex ? ex.conditionId ?? 'custom' : 'frightened';
		let label = ex?.label ?? getCondition('frightened')?.name ?? '';
		let sourceId: string = ex?.sourceCombatantId ?? '';
		let sourceLabel = ex?.sourceLabel ?? '';
		let notes = ex?.notes ?? '';
		let isConcentration = ex?.isConcentration ?? false;
		let concentrationEffectId = ex?.concentrationEffectId ?? '';
		const d = ex?.duration;
		let kind: DurKind = d ? (d.kind === 'turns' && d.remaining === 1 && d.ownerCombatantId === ex?.sourceCombatantId ? 'until-turn' : d.kind) : enc ? 'turns' : 'manual';
		let owner = d?.kind === 'turns' ? d.ownerCombatantId : '';
		let phase: 'start' | 'end' = d?.kind === 'turns' || d?.kind === 'rounds' ? d.phase : 'end';
		let count = d?.kind === 'turns' || d?.kind === 'rounds' ? d.remaining : 1;
		let minutes = d?.kind === 'game-time' ? Math.max(1, d.expiresAtMinute - state.gameClock.minutes) : 10;

		const combatantOptions = (): Record<string, string> => {
			const o: Record<string, string> = {};
			if (enc) for (const s of computeSlots(enc)) for (const id of s.memberIds) o[id] = enc.combatants[id]?.displayName ?? id;
			return o;
		};

		new Setting(el).setName('Цель').addDropdown((dd) => {
			for (const t of targets) dd.addOption(t.key, t.label);
			dd.setValue(targetKey).onChange((v) => {
				targetKey = v;
				renderDuration();
			});
			dd.selectEl.dataset.testid = 'effect-target';
		});
		new Setting(el)
			.setName('Состояние')
			.setDesc('Названия — как на TTG Club (5e 2014). Своё — пункт «Другое».')
			.addDropdown((dd) => {
				for (const c of CONDITIONS) dd.addOption(c.id, c.name);
				dd.addOption('custom', 'Другое (свой эффект)');
				dd.setValue(conditionId).onChange((v) => {
					conditionId = v;
					const c = getCondition(v);
					if (c) {
						label = c.name;
						labelInput?.setValue(c.name);
					}
					if (v === 'concentration') {
						isConcentration = true;
						concToggle?.setValue(true);
					}
				});
				dd.selectEl.dataset.testid = 'effect-condition';
			});
		let labelInput: { setValue: (v: string) => unknown } | null = null;
		new Setting(el).setName('Подпись').addText((t) => {
			labelInput = t;
			t.setValue(label).onChange((v) => (label = v));
			t.inputEl.dataset.testid = 'effect-label';
		});
		new Setting(el).setName('Источник').setDesc('Кто наложил (не обязательно)').addDropdown((dd) => {
			dd.addOption('', '— нет —');
			for (const [id, name] of Object.entries(combatantOptions())) dd.addOption(id, name);
			dd.setValue(sourceId).onChange((v) => {
				sourceId = v;
				renderDuration();
			});
			dd.selectEl.dataset.testid = 'effect-source';
		}).addText((t) => t.setPlaceholder('или подпись источника').setValue(sourceLabel).onChange((v) => (sourceLabel = v)));

		const durBox = el.createDiv({ cls: 'ca-duration' });
		const renderDuration = (): void => {
			durBox.empty();
			new Setting(durBox).setName('Длительность').addDropdown((dd) => {
				dd.addOption('manual', 'Без срока / вручную');
				if (enc) {
					dd.addOption('turns', 'N ходов участника');
					dd.addOption('until-turn', 'До следующего хода источника/участника');
					dd.addOption('rounds', 'N раундов');
				}
				dd.addOption('game-time', 'Игровое время (минуты)');
				dd.setValue(kind).onChange((v) => {
					kind = v as DurKind;
					renderDuration();
				});
				dd.selectEl.dataset.testid = 'effect-duration-kind';
			});
			if (kind === 'turns' || kind === 'until-turn') {
				const opts = combatantOptions();
				if (!owner || !opts[owner]) {
					const t = targets.find((x) => x.key === targetKey)?.target;
					owner = kind === 'until-turn' && sourceId ? sourceId : (t && combatantIdForTarget(this.ctl, t)) ?? Object.keys(opts)[0] ?? '';
				}
				new Setting(durBox).setName(kind === 'until-turn' ? 'Чей ход' : 'Чьи ходы считать').addDropdown((dd) => {
					for (const [id, name] of Object.entries(opts)) dd.addOption(id, name);
					dd.setValue(owner).onChange((v) => (owner = v));
					dd.selectEl.dataset.testid = 'effect-owner';
				});
				new Setting(durBox).setName('Событие').addDropdown((dd) => {
					dd.addOption('start', 'начало хода');
					dd.addOption('end', 'конец хода');
					dd.setValue(kind === 'until-turn' && !ex ? 'start' : phase).onChange((v) => (phase = v as 'start' | 'end'));
					if (kind === 'until-turn' && !ex) phase = 'start';
					dd.selectEl.dataset.testid = 'effect-phase';
				});
			}
			if (kind === 'rounds') {
				new Setting(durBox).setName('Событие раунда').addDropdown((dd) => {
					dd.addOption('start', 'начало раунда');
					dd.addOption('end', 'конец раунда');
					dd.setValue(phase).onChange((v) => (phase = v as 'start' | 'end'));
				});
			}
			if (kind === 'turns' || kind === 'rounds') {
				new Setting(durBox)
					.setName('Количество')
					.setDesc('Считаются только будущие события после наложения')
					.addText((t) => {
						t.inputEl.inputMode = 'numeric';
						t.inputEl.dataset.testid = 'effect-count';
						t.setValue(String(count)).onChange((v) => (count = Number(v)));
					});
			}
			if (kind === 'game-time') {
				new Setting(durBox).setName('Минут игрового времени').addText((t) => {
					t.inputEl.inputMode = 'numeric';
					t.setValue(String(minutes)).onChange((v) => (minutes = Number(v)));
				});
			}
		};
		renderDuration();

		let concToggle: { setValue: (v: boolean) => unknown } | null = null;
		new Setting(el).setName('Это концентрация цели').addToggle((t) => {
			concToggle = t;
			t.setValue(isConcentration).onChange((v) => (isConcentration = v));
		});
		const concentrations = Object.values(state.effects).filter((e) => e.isConcentration && e.id !== ex?.id);
		if (concentrations.length) {
			new Setting(el).setName('Зависит от концентрации').addDropdown((dd) => {
				dd.addOption('', '— нет —');
				for (const c of concentrations) dd.addOption(c.id, `${c.label} (${this.ctl.targetName(c.target)})`);
				dd.setValue(concentrationEffectId).onChange((v) => (concentrationEffectId = v));
			});
		}
		new Setting(el).setName('Заметка').addTextArea((t) => t.setValue(notes).onChange((v) => (notes = v)));
		if (ex) el.createEl('p', { cls: 'ca-muted', text: `Сейчас: ${describeDuration(ex, (id) => enc?.combatants[id]?.displayName ?? '?', state.gameClock.minutes)}` });

		const err = el.createDiv({ cls: 'ca-error' });
		const row = el.createDiv({ cls: 'ca-modal-buttons' });
		if (ex) {
			button(row, 'Снять эффект', () => void (async () => {
				if (ex.isConcentration) {
					const linked = Object.values(state.effects).filter((e) => e.concentrationEffectId === ex.id);
					const removeLinked = linked.length
						? await confirm(this.app, 'Конец концентрации', [`Снять и связанные эффекты (${linked.map((l) => l.label).join(', ')})?`, 'Правила концентрации не проверяются — решает мастер.'], 'Снять связанные')
						: false;
					const out = await this.ctl.act({ type: 'concentration/end', effectId: ex.id, removeLinkedIds: removeLinked ? linked.map((l) => l.id) : [] });
					if (out.ok) this.close();
					return;
				}
				const out = await this.ctl.act({ type: 'effect/remove', effectIds: [ex.id] });
				if (out.ok) this.close();
			})(), { cls: 'mod-warning', testId: 'effect-remove' });
		}
		button(row, 'Отмена', () => this.close());
		button(row, ex ? 'Сохранить' : 'Наложить', () => void (async () => {
			const t = targets.find((x) => x.key === targetKey)?.target;
			if (!t) return err.setText('Выберите цель');
			let duration: EffectDuration;
			if (kind === 'manual') duration = { kind: 'manual' };
			else if (kind === 'game-time') {
				if (!Number.isInteger(minutes) || minutes < 1) return err.setText('Минуты: целое число ≥ 1');
				duration = { kind: 'game-time', expiresAtMinute: state.gameClock.minutes + minutes };
			} else if (kind === 'rounds') {
				if (!Number.isInteger(count) || count < 1) return err.setText('Количество: целое число ≥ 1');
				duration = { kind: 'rounds', phase, remaining: count };
			} else {
				if (!owner) return err.setText('Выберите участника');
				const n = kind === 'until-turn' ? 1 : count;
				if (!Number.isInteger(n) || n < 1) return err.setText('Количество: целое число ≥ 1');
				duration = { kind: 'turns', ownerCombatantId: owner, phase, remaining: n };
			}
			const cond = conditionId === 'custom' ? null : conditionId;
			const srcName = sourceId ? enc?.combatants[sourceId]?.displayName ?? '' : '';
			if (ex) {
				const durationChanged = JSON.stringify(duration) !== JSON.stringify(ex.duration);
				const out = await this.ctl.act({
					type: 'effect/update',
					effectId: ex.id,
					patch: {
						label: label.trim() || ex.label,
						notes,
						target: t,
						sourceCombatantId: sourceId || null,
						sourceLabel: sourceLabel || srcName,
						concentrationEffectId: concentrationEffectId || null,
						...(durationChanged ? { duration } : {}),
					},
				});
				if (out.ok) this.close();
				return;
			}
			const effect: Effect = {
				id: newId('eff'),
				conditionId: cond,
				label: label.trim() || getCondition(cond)?.name || 'Эффект',
				target: t,
				sourceCombatantId: sourceId || null,
				sourceLabel: sourceLabel || srcName,
				duration,
				createdAtEventSeq: 0,
				isConcentration,
				concentrationEffectId: concentrationEffectId || null,
				needsDecision: false,
				notes,
			};
			const out = await this.ctl.act({ type: 'effect/add', effect });
			if (out.ok) this.close();
			else err.setText(out.error ?? 'Ошибка');
		})(), { cls: 'mod-cta', testId: 'effect-submit' });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
