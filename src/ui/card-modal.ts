// Quick statblock / combat card (Shift+K). Local parameters are always shown immediately;
// the TTG page is only opened in the browser on explicit click (no hidden requests).
import { Modal, Setting, TFile } from 'obsidian';
import { effectiveAc, hpOf } from '../domain/combat';
import { describeDuration } from '../domain/effect-clock';
import type { EffectTarget, SourceRef } from '../domain/types';
import { safeTtgUrl } from '../adapters/ttg-adapter';
import { statblockSummary } from '../adapters/statblock-adapter';
import type { Controller } from '../controller';
import { button, hpText } from './common';
import { openDamage, openEffect, openHeal, openTempHp } from './actions';
import { EffectModal } from './effect-modal';

export function openExternal(url: string): void {
	window.open(url, '_blank', 'noopener');
}

export function sourceUrlOf(src: SourceRef | null): string | null {
	if (!src) return null;
	return safeTtgUrl(src.url ?? (src.provider === 'ttg2014' ? src.ref : null));
}

export class CardModal extends Modal {
	private unsub: (() => void) | null = null;
	constructor(
		private readonly ctl: Controller,
		private readonly target: EffectTarget,
	) {
		super(ctl.app);
	}

	override onOpen(): void {
		this.modalEl.addClass('ca-card-modal');
		this.render();
		this.unsub = this.ctl.onChange((r) => {
			if (r === 'state') this.render();
		});
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const s = this.ctl.state;
		if (!s) return;
		const t = this.target;
		const enc = s.activeEncounter;
		const cmb = t.kind === 'combatant' ? enc?.combatants[t.id] : undefined;
		const ch = t.kind === 'character' ? s.characters[t.id] : cmb?.characterId ? s.characters[cmb.characterId] : undefined;
		const creature = cmb?.creatureId ? s.creatures[cmb.creatureId] : undefined;
		const name = cmb?.displayName ?? ch?.name ?? '—';
		this.titleEl.setText(name);

		const stats = el.createDiv({ cls: 'ca-card-stats' });
		const stat = (label: string, value: string): void => {
			const b = stats.createDiv({ cls: 'ca-stat' });
			b.createDiv({ cls: 'ca-stat-label', text: label });
			b.createDiv({ cls: 'ca-stat-value', text: value });
		};
		const hp = cmb ? hpOf(s, cmb) : ch?.hp ?? null;
		stat('Хиты', hpText(hp));
		const ac = cmb ? effectiveAc(s, cmb) : ch?.ac ?? null;
		stat('КД', ac === null ? '—' : `${ac}${cmb?.acOverride !== null && cmb?.acOverride !== undefined ? ' (временно)' : ''}`);
		const initMod = cmb?.initiativeModifier ?? ch?.initiativeModifier ?? creature?.initiativeModifier ?? null;
		stat('Иниц.', cmb?.initiative !== null && cmb?.initiative !== undefined ? String(cmb.initiative) : initMod === null ? '—' : `мод ${initMod >= 0 ? '+' : ''}${initMod}`);
		if (ch?.speedFeet !== null && ch?.speedFeet !== undefined) stat('Скорость', `${ch.speedFeet} фт.`);
		else if (creature?.speed) stat('Скорость', creature.speed);

		if (ch) {
			const slots = Object.entries(ch.spellSlots).sort(([a], [b]) => Number(a) - Number(b));
			if (slots.length) el.createEl('p', { text: `Ячейки: ${slots.map(([l, x]) => `${l}: ${x.current}/${x.max}`).join(' · ')}` });
			const counters = Object.values(ch.counters);
			if (counters.length) el.createEl('p', { text: `Ресурсы: ${counters.map((c) => `${c.name} ${c.current}/${c.max ?? '?'}`).join(' · ')}` });
			if (ch.exhaustion) el.createEl('p', { text: `Истощение: ${ch.exhaustion}` });
		}
		if (creature?.notes) el.createEl('p', { cls: 'ca-card-notes', text: creature.notes });

		// Effects (each source listed separately).
		const effects = Object.values(s.effects).filter(
			(e) => (e.target.kind === 'combatant' && cmb && e.target.id === cmb.id) || (e.target.kind === 'character' && ch && e.target.id === ch.id),
		);
		const effBox = el.createDiv({ cls: 'ca-card-effects' });
		effBox.createEl('h4', { text: 'Эффекты' });
		if (!effects.length) effBox.createEl('p', { cls: 'ca-muted', text: 'нет' });
		for (const e of effects) {
			const row = effBox.createDiv({ cls: 'ca-effect-row' });
			row.createSpan({ cls: `ca-pill${e.needsDecision ? ' ca-pill-warn' : ''}`, text: e.label });
			const srcName = e.sourceLabel || (e.sourceCombatantId ? enc?.combatants[e.sourceCombatantId]?.displayName ?? '' : '');
			const when = describeDuration(e, (id) => enc?.combatants[id]?.displayName ?? '?', s.gameClock.minutes);
			row.createSpan({ cls: 'ca-muted', text: `${srcName ? `от ${srcName}` : 'без источника'} · ${when}` });
			button(row, '', () => new EffectModal(this.ctl, null, e).open(), { icon: 'pencil', title: 'Изменить/снять' });
		}

		// Sources: note, TTG link, local reference.
		const src = el.createDiv({ cls: 'ca-card-sources' });
		const notePath = ch?.notePath ?? (cmb?.source?.provider === 'note' ? cmb.source.ref : null);
		const noteFile = this.ctl.noteFile(notePath);
		if (notePath) {
			if (noteFile) {
				button(src, 'Открыть заметку', () => void this.app.workspace.getLeaf('tab').openFile(noteFile), { icon: 'file-text' });
				this.renderRelations(el, noteFile);
			} else src.createSpan({ cls: 'ca-pill ca-pill-warn', text: `источник недоступен: ${notePath}` });
		}
		const url = sourceUrlOf(cmb?.source ?? creature?.source ?? null);
		if (url) button(src, 'Открыть на TTG', () => openExternal(url), { icon: 'external-link', title: url, testId: 'card-ttg' });
		const sb = statblockSummary(this.app, this.ctl.settings.fantasyStatblocks, creature?.name ?? name.replace(/\s+\d+$/, ''));
		if (sb) el.createEl('p', { cls: 'ca-muted', text: `Fantasy Statblocks: КД ${sb.ac ?? '—'}, хиты ${sb.hpMax ?? '—'}, скорость ${sb.speed || '—'}` });

		const actions = el.createDiv({ cls: 'ca-modal-buttons' });
		button(actions, 'Урон', () => openDamage(this.ctl, this.target), { icon: 'sword' });
		button(actions, 'Лечение', () => openHeal(this.ctl, this.target), { icon: 'heart' });
		button(actions, 'Врем. хиты', () => openTempHp(this.ctl, this.target), { icon: 'shield' });
		button(actions, 'Эффект', () => openEffect(this.ctl, this.target), { icon: 'sparkles' });
		if (cmb) {
			new Setting(el).setName('Временный КД в бою').setDesc('Пусто — КД листа/карточки').addText((tx) => {
				tx.setValue(cmb.acOverride === null ? '' : String(cmb.acOverride));
				tx.inputEl.addEventListener('change', () => {
					const v = tx.getValue().trim();
					void this.ctl.act({ type: 'encounter/update-combatant', combatantId: cmb.id, patch: { acOverride: v === '' ? null : Number(v) } });
				});
			});
		}
	}

	/** Outgoing links + frontmatter link properties of the note (no vault scan). */
	private renderRelations(el: HTMLElement, file: TFile): void {
		const cache = this.app.metadataCache.getFileCache(file);
		const links = [...(cache?.links ?? []), ...(cache?.frontmatterLinks ?? [])];
		if (!links.length) return;
		const box = el.createDiv({ cls: 'ca-relations' });
		box.createEl('h4', { text: 'Связи' });
		const seen = new Set<string>();
		for (const l of links.slice(0, 20)) {
			if (seen.has(l.link)) continue;
			seen.add(l.link);
			const dest = this.app.metadataCache.getFirstLinkpathDest(l.link.split('#')[0] ?? l.link, file.path);
			const row = box.createDiv({ cls: 'ca-relation' });
			if (dest) {
				const a = row.createEl('a', { text: l.displayText || l.link, href: '#' });
				a.addEventListener('click', (ev) => {
					ev.preventDefault();
					void this.app.workspace.getLeaf('tab').openFile(dest);
				});
			} else row.createSpan({ cls: 'ca-muted', text: `${l.displayText || l.link} (нет заметки)` });
		}
	}

	override onClose(): void {
		this.unsub?.();
		this.contentEl.empty();
	}
}
