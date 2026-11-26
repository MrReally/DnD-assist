// Short/long rest for selected PCs of a party: checkboxes, options, preview «до → после», one undoable action.
import { Modal, Setting } from 'obsidian';
import { arcaneRecoveryBudget } from '../domain/class-rules';
import { defaultRestOptions, planRest, type RestKind, type RestOptions } from '../domain/rest';
import type { Controller } from '../controller';
import { button } from './common';

export class RestModal extends Modal {
	private opts!: RestOptions;
	private partyId: string | null;

	constructor(
		private readonly ctl: Controller,
		private readonly kind: RestKind,
	) {
		super(ctl.app);
		this.partyId = ctl.state?.activePartyId ?? null;
	}

	private memberIds(): string[] {
		const s = this.ctl.state;
		if (!s) return [];
		const p = s.parties.find((x) => x.id === this.partyId);
		return (p ? p.characterIds : Object.keys(s.characters)).filter((id) => !!s.characters[id]);
	}

	override onOpen(): void {
		const s = this.ctl.state;
		if (!s) return this.close();
		this.modalEl.addClass('ca-rest-modal');
		this.opts = defaultRestOptions(s, this.kind, this.ctl.settings.restProfile, this.memberIds());
		this.render();
	}

	private render(): void {
		const s = this.ctl.state;
		if (!s) return;
		const el = this.contentEl;
		el.empty();
		this.titleEl.setText(this.kind === 'long' ? 'Долгий отдых' : 'Короткий отдых');
		el.createEl('p', {
			cls: 'ca-muted',
			text:
				this.kind === 'long'
					? `Профиль: ${this.opts.profile === '2014' ? 'D&D 2014' : 'вручную'}. Отметьте персонажей и что восстановить. Классовые особенности не рассчитываются.`
					: 'Броски костей хитов не делаются автоматически: укажите потраченные кости и результат физического броска.',
		});
		if (s.activeEncounter) el.createEl('p', { cls: 'ca-warn', text: 'Внимание: идёт бой. Отдых не завершает бой.' });

		new Setting(el).setName('Партия').addDropdown((dd) => {
			dd.addOption('', 'Все персонажи приключения');
			for (const p of s.parties) dd.addOption(p.id, p.name);
			dd.setValue(this.partyId ?? '').onChange((v) => {
				this.partyId = v || null;
				this.opts = defaultRestOptions(s, this.kind, this.opts.profile, this.memberIds());
				this.render();
			});
		});
		new Setting(el).setName('Профиль восстановления').addDropdown((dd) => {
			dd.addOption('2014', 'D&D 2014');
			dd.addOption('manual', 'Вручную (ничего не отмечено)');
			dd.setValue(this.opts.profile).onChange((v) => {
				this.opts = defaultRestOptions(s, this.kind, v === 'manual' ? 'manual' : '2014', this.opts.characterIds);
				this.render();
			});
		});

		const chars = el.createDiv({ cls: 'ca-rest-chars' });
		chars.createEl('h4', { text: 'Персонажи' });
		for (const id of this.memberIds()) {
			const ch = s.characters[id];
			if (!ch) continue;
			new Setting(chars).setName(ch.name).setDesc(`Хиты ${ch.hp.current}/${ch.hp.max ?? '?'}`).addToggle((t) => {
				t.setValue(this.opts.characterIds.includes(id)).onChange((v) => {
					this.opts.characterIds = v ? [...this.opts.characterIds, id] : this.opts.characterIds.filter((x) => x !== id);
					this.render();
				});
				t.toggleEl.dataset.testid = `rest-char-${ch.name}`;
			});
		}

		const o = el.createDiv({ cls: 'ca-rest-options' });
		o.createEl('h4', { text: 'Что восстановить' });
		const toggle = (name: string, key: 'restoreHp' | 'restoreSpellSlots' | 'restoreHitDice' | 'resetDeathSaves' | 'reduceExhaustion'): void => {
			new Setting(o).setName(name).addToggle((t) =>
				t.setValue(this.opts[key]).onChange((v) => {
					this.opts[key] = v;
					this.render();
				}),
			);
		};
		toggle('Хиты до максимума', 'restoreHp');
		toggle('Ячейки заклинаний', 'restoreSpellSlots');
		if (this.kind === 'long') {
			toggle('Кости хитов (половина)', 'restoreHitDice');
			toggle('Сбросить спасброски от смерти', 'resetDeathSaves');
			toggle('Истощение −1 (решение мастера)', 'reduceExhaustion');
		}

		for (const id of this.opts.characterIds) {
			const ch = s.characters[id];
			if (!ch) continue;
			const counters = Object.values(ch.counters);
			const effects = Object.values(s.effects).filter((e) => e.target.kind === 'character' && e.target.id === id);
			if (!counters.length && !effects.length && !(this.kind === 'short' && ch.hitDice.length) && ch.extensions?.pactMagic !== true) continue;
			const box = o.createDiv({ cls: 'ca-rest-char' });
			box.createEl('h5', { text: ch.name });
			for (const c of counters) {
				const rec = c.recovery === 'manual' ? 'ручное' : c.recovery === 'short' ? 'короткий' : 'долгий';
				new Setting(box).setName(`${c.name} ${c.current}/${c.max ?? '?'}`).setDesc(`восстановление: ${rec}`).addToggle((t) =>
					t.setValue((this.opts.counterIds[id] ?? []).includes(c.id)).onChange((v) => {
						const cur = this.opts.counterIds[id] ?? [];
						this.opts.counterIds[id] = v ? [...cur, c.id] : cur.filter((x) => x !== c.id);
						this.render();
					}),
				);
			}
			if (this.kind === 'short') {
				for (const hd of ch.hitDice) {
					const spend = this.opts.hitDiceSpend[id];
					new Setting(box)
						.setName(`Кости хитов ${hd.die}: осталось ${hd.remaining}/${hd.total}`)
						.setDesc('Потрачено костей / вылечено (сумма физического броска)')
						.addText((t) => {
							t.setPlaceholder('кости').setValue(spend?.die === hd.die ? String(spend.count) : '');
							t.inputEl.addEventListener('change', () => {
								const count = Number(t.getValue()) || 0;
								this.opts.hitDiceSpend[id] = { die: hd.die, count, healed: this.opts.hitDiceSpend[id]?.healed ?? 0 };
								this.render();
							});
						})
						.addText((t) => {
							t.setPlaceholder('хиты').setValue(spend?.die === hd.die ? String(spend.healed) : '');
							t.inputEl.addEventListener('change', () => {
								const healed = Number(t.getValue()) || 0;
								this.opts.hitDiceSpend[id] = { die: hd.die, count: this.opts.hitDiceSpend[id]?.count ?? 0, healed };
								this.render();
							});
						});
				}
			}
			const wiz = ch.classes.find((k) => k.name === 'Волшебник');
			const arcane = ch.counters['arcane-recovery'];
			if (this.kind === 'short' && wiz && arcane) {
				const chosen = this.opts.arcaneRecovery?.[id] ?? [];
				const row = box.createDiv({ cls: 'ca-arcane', attr: { 'data-testid': 'rest-arcane' } });
				row.createDiv({ text: `Магическое восстановление (раз в день, ${arcane.current > 0 ? 'доступно' : 'уже использовано'}): ячейки суммарным уровнем не больше ${arcaneRecoveryBudget(wiz.level)}, не выше 5-го. Выбирает игрок.` });
				if (arcane.current > 0) {
					for (const [lvl, slot] of Object.entries(ch.spellSlots)) {
						if (Number(lvl) > 5) continue;
						const missing = slot.max - slot.current;
						for (let n = 1; n <= missing; n++) {
							const key = Number(lvl);
							const count = chosen.filter((x) => x === key).length;
							new Setting(row).setName(`Ячейка ${lvl} ур. (${n}-я из израсходованных)`).addToggle((t) =>
								t.setValue(count >= n).onChange((v) => {
									const rest = chosen.filter((x) => x !== key);
									const target = v ? n : n - 1;
									const next = [...rest, ...Array<number>(target).fill(key)];
									this.opts.arcaneRecovery = { ...(this.opts.arcaneRecovery ?? {}), [id]: next };
									this.render();
								}),
							);
						}
					}
				}
			}
			if (this.kind === 'short' && ch.extensions?.pactMagic === true) {
				new Setting(box).setName('Магия договора: восстановить ячейки').setDesc('Правило колдуна: все ячейки возвращаются после короткого отдыха').addToggle((t) =>
					t.setValue(this.opts.pactMagic !== false).onChange((v) => {
						this.opts.pactMagic = v;
						this.render();
					}),
				);
			}
			for (const e of effects) {
				new Setting(box).setName(`Снять эффект «${e.label}»`).addToggle((t) =>
					t.setValue(this.opts.removeEffectIds.includes(e.id)).onChange((v) => {
						this.opts.removeEffectIds = v ? [...this.opts.removeEffectIds, e.id] : this.opts.removeEffectIds.filter((x) => x !== e.id);
						this.render();
					}),
				);
			}
		}

		const plan = planRest(s, this.opts);
		const prev = el.createDiv({ cls: 'ca-preview', attr: { 'data-testid': 'rest-preview' } });
		prev.createEl('h4', { text: 'Предпросмотр: до → после' });
		let any = false;
		for (const e of plan.entries) {
			if (!e.lines.length) continue;
			any = true;
			prev.createEl('strong', { text: e.name });
			const ul = prev.createEl('ul');
			for (const l of e.lines) ul.createEl('li', { text: l });
		}
		if (plan.removeEffectIds.length) prev.createEl('p', { text: `Снимаемых эффектов: ${plan.removeEffectIds.length}` });
		if (!any && !plan.removeEffectIds.length) prev.createEl('p', { cls: 'ca-muted', text: 'Нет изменений' });

		const blocking = plan.entries.flatMap((e) => e.errors.map((m) => `${e.name}: ${m}`));
		for (const m of blocking) prev.createEl('p', { cls: 'ca-warn', text: m, attr: { 'data-testid': 'rest-error' } });
		const row = el.createDiv({ cls: 'ca-modal-buttons' });
		button(row, 'Отмена', () => this.close());
		button(
			row,
			'Применить отдых',
			() =>
				void (async () => {
					const out = await this.ctl.act({
						type: 'rest/apply',
						kind: this.kind,
						changes: plan.entries.map((e) => ({ characterId: e.characterId, after: e.after })),
						removeEffectIds: plan.removeEffectIds,
					});
					if (out.ok) this.close();
				})(),
			{ cls: 'mod-cta', disabled: plan.entries.length === 0 || blocking.length > 0, testId: 'rest-apply' },
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
