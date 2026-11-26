#!/usr/bin/env node
// Deterministic import of the official D&D 5e SRD 5.1 (CC-BY-4.0) PDF into data/srd51/srd51.json.
// Usage: node scripts/srd/import-srd.mjs <SRD_CC_v5.1.pdf>   (needs poppler `pdftotext`)
// The PDF is pinned by SHA-256; the parser is structural (no values are typed in from memory).
// Independent verification against hand-checked reference values: tests/unit/srd-reference.test.ts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PDF = process.argv[2];
const OUT = process.argv[3] ?? 'data/srd51/srd51.json';
const PDF_SHA256 = '2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0';
if (!PDF) throw new Error('usage: import-srd.mjs <pdf> [out.json]');
const sha = createHash('sha256').update(readFileSync(PDF)).digest('hex');
if (sha !== PDF_SHA256) throw new Error(`unexpected SRD PDF: sha256 ${sha}`);

// pdftotext's stdout and file outputs differ in how word separators are emitted; the file form is the verified one.
const tmp = mkdtempSync(join(tmpdir(), 'srd-'));
const ptt = (...args) => {
	const f = join(tmp, 'o.txt');
	execFileSync('pdftotext', ['-layout', ...args, PDF, f], { stdio: 'ignore' });
	return readFileSync(f, 'utf8');
};
const layout = ptt();
const normText = (t) => t.replace(/\t[\r\n]+ \u00a0/g, ' ').replace(/\t[\r\n]+/g, '').replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/\u00ad/g, '').replace(/[\u2010\u2011\u2012]/g, '-').replace(/-{2,}/g, '-');
const pages = layout.split('\f').map(normText);
const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** Full-width lines with cells separated by " | " (tables). */
const tableLines = pages.flatMap((p) => p.split('\n').map((l) => clean(l.replace(/\s{3,}/g, ' | ')).replace(/ \| /g, ' | ')).filter(Boolean));
/** Prose lines: every page cropped into its left and right column (pdftotext -x/-W), left first. */
const proseLines = [];
for (let pg = 1; pg <= pages.length - 1; pg++) {
	proseLines.push(`@@PAGE ${pg}`);
	for (const x of [0, 306]) {
		const t = ptt('-f', String(pg), '-l', String(pg), '-x', String(x), '-y', '0', '-W', '306', '-H', '792');
		for (const l of normText(t).split('\n')) proseLines.push(clean(l));
	}
}
const prose = proseLines.filter((l) => l && !/^System Reference Document 5\.1( \d+)?$/.test(l) && !/^\d{1,3} System Reference Document 5\.1$/.test(l) && !/^@@PAGE/.test(l) && !/^\d{1,3}$/.test(l));

if (process.env.SRD_DUMP) writeFileSync(process.env.SRD_DUMP, prose.join('\n'));
const slug = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SRC = { source: 'SRD 5.1', edition: '2014', dataVersion: '1.0.0', verification: 'srd-verified' };
const warnings = [];

// ---- spells -----------------------------------------------------------------------------------
const SCHOOLS = 'abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation';
const lvlRe = new RegExp(`^(\\d)(?:st|nd|rd|th)-level (${SCHOOLS})(?: \\(ritual\\))?$`);
const canRe = new RegExp(`^(${SCHOOLS[0].toUpperCase()}[a-z]+|[A-Z][a-z]+) cantrip$`);
const spellStarts = [];
prose.forEach((l, i) => {
	let m = lvlRe.exec(l);
	if (m) return void spellStarts.push({ i, level: Number(m[1]), school: m[2], ritual: /\(ritual\)/.test(l) });
	m = /^([A-Z][a-z]+) cantrip$/.exec(l);
	if (m && new RegExp(`^${SCHOOLS}$`, 'i').test(m[1])) spellStarts.push({ i, level: 0, school: m[1].toLowerCase(), ritual: false });
});
const spells = [];
for (const [k, s] of spellStarts.entries()) {
	const name = prose[s.i - 1];
	const end = k + 1 < spellStarts.length ? spellStarts[k + 1].i - 1 : prose.length;
	const body = prose.slice(s.i + 1, end);
	const idx = (p) => body.findIndex((l) => l.startsWith(p));
	const iCast = idx('Casting Time:');
	const iRange = idx('Range:');
	const iComp = Math.max(idx('Components:'), idx('Component:'));
	const iDur = idx('Duration:');
	if ([iCast, iRange, iComp, iDur].some((v) => v < 0)) {
		warnings.push(`spell without header fields: ${name}`);
		continue;
	}
	const castingTime = clean(body.slice(iCast, iRange).join(' ').replace('Casting Time:', ''));
	const range = clean(body.slice(iRange, iComp).join(' ').replace('Range:', ''));
	const comps = clean(body.slice(iComp, iDur).join(' ').replace(/^Components?:/, ''));
	// duration may wrap onto one more line before the description starts (a blank is not preserved: take until a sentence line)
	let dEnd = iDur + 1;
	while (dEnd < body.length && /^(up to|\d+ |hour|minute|round|day|until)/i.test(body[dEnd] ?? '') && body[dEnd].length < 40) dEnd++;
	const duration = clean(body.slice(iDur, dEnd).join(' ').replace('Duration:', ''));
	const text = clean(body.slice(dEnd).join(' '));
	const hl = /At Higher Levels\.\s*(.*)$/.exec(text);
	spells.push({
		id: slug(name),
		name,
		type: 'spell',
		level: s.level,
		school: s.school,
		ritual: s.ritual,
		castingTime,
		range,
		components: comps.replace(/\s*\(.*\)\s*$/, '').trim(),
		material: /\(([^)]*)\)\s*$/.exec(comps)?.[1] ?? null,
		duration,
		concentration: /^Concentration/i.test(duration),
		text: hl ? clean(text.slice(0, hl.index)) : text,
		higherLevels: hl ? clean(hl[1]) : null,
		classes: [],
		...SRC,
	});
}
// class spell lists
const CLASS_NAMES = ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];
const spellByName = new Map(spells.map((s) => [s.name, s]));
for (const cn of CLASS_NAMES) {
	const at = prose.findIndex((l, i) => l === `${cn} Spells` && /^Cantrips|^1st Level|^\w+ Spells/.test(prose[i + 1] ?? '') || (l === `${cn} Spells` && prose[i + 1] === 'Cantrips (0 Level)'));
	if (at < 0) { warnings.push(`no spell list for ${cn}`); continue; }
	for (let j = at + 1; j < prose.length; j++) {
		const l = prose[j];
		if (/^(Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard) Spells$/.test(l) && j > at + 3) break;
		if (/^Spell Descriptions/.test(l)) break;
		const sp = spellByName.get(l.replace(/ \(.*\)$/, ''));
		if (sp && !sp.classes.includes(cn.toLowerCase())) sp.classes.push(cn.toLowerCase());
	}
}

// ---- monsters ---------------------------------------------------------------------------------
const SIZE = 'Tiny|Small|Medium|Large|Huge|Gargantuan';
const monStarts = [];
prose.forEach((l, i) => {
	if (new RegExp(`^(${SIZE}) [a-z]`).test(l) && (/^Armor Class/.test(prose[i + 1] ?? '') || (/^Armor Class/.test(prose[i + 2] ?? '') && !/^(Armor|Hit|Speed)/.test(prose[i + 1] ?? '')))) monStarts.push(i);
});
const monsters = [];
for (const [k, i] of monStarts.entries()) {
	const name = prose[i - 1];
	const end = k + 1 < monStarts.length ? monStarts[k + 1] - 1 : prose.length;
	const body = prose.slice(i, end).map((l) => l.replace(/\b(?:STR|DEX|CON|INT|WIS|CHA)(?: (?:STR|DEX|CON|INT|WIS|CHA))*\b ?/g, '').trim()).filter(Boolean);
	const acAt = body.findIndex((l) => l.startsWith('Armor Class'));
	const typeLine = clean(body.slice(0, acAt).join(' '));
	const field = (label) => {
		const j = body.findIndex((l) => l.startsWith(`${label} `));
		if (j < 0) return null;
		let v = body[j].slice(label.length + 1);
		let n = j + 1;
		while (n < body.length && !/^(Armor Class|Hit Points|Speed|Saving Throws|Skills|Damage (Vulnerabilities|Resistances|Immunities)|Condition Immunities|Senses|Languages|Challenge|Actions|Reactions|Legendary Actions)\b/.test(body[n]) && !/^\d+ \([+−-]\d+\)/.test(body[n]) && n < j + 3 && !/^[A-Z][A-Za-z' -]+(?: \([^)]*\))?\. /.test(body[n])) v += ` ${body[n++]}`;
		return clean(v);
	};
	const abilRow = body.find((l) => /^\d+ \([+−-]\d+\)( \d+ \([+−-]\d+\)){5}$/.test(l));
	const ab = abilRow ? [...abilRow.matchAll(/(\d+) \(/g)].map((m) => Number(m[1])) : null;
	const chalLine = field('Challenge');
	const cm = /^(\S+) \(([\d,]+) XP\)/.exec(chalLine ?? '');
	const hp = field('Hit Points');
	const acv = field('Armor Class');
	if (!ab || !cm || !hp || !acv) { warnings.push(`incomplete monster: ${name} (missing ${[!ab && 'abilities', !cm && 'challenge', !hp && 'hp', !acv && 'ac'].filter(Boolean).join(',')})`); continue; }
	const iAct = body.findIndex((l) => l === 'Actions');
	const traitsStart = body.findIndex((l) => /^Challenge /.test(l)) + 1;
	const trimTail = (t) => (/[.)]$/.test(t) ? t : t.slice(0, t.lastIndexOf('. ') + 1) || t);
	const traitsText = trimTail(clean(body.slice(traitsStart, iAct < 0 ? body.length : iAct).join(' ')));
	const actionsText = iAct < 0 ? '' : trimTail(clean(body.slice(iAct + 1).join(' ')));
	const attacks = [];
	const atkRe = /([A-Z][A-Za-z' -]{1,40}?)(?: \([^)]*\))?\. (Melee|Ranged|Melee or Ranged) (Weapon|Spell) Attack: ([+−-]\d+) to hit, (?:reach (\d+) ft\.(?: or range ([\d/]+) ft\.)?|range ([\d/]+) ft\.)[^]*?Hit: (\d+) \(([^)]+)\) (\w+) damage/g;
	for (const m of actionsText.matchAll(atkRe)) {
		attacks.push({ name: m[1].trim(), kind: `${m[2]} ${m[3]} Attack`, bonus: Number(m[4].replace('−', '-')), reach: m[5] ? `${m[5]} ft.` : null, range: m[6] ?? m[7] ?? null, avg: Number(m[8]), damage: m[9].replace(/\s+/g, ''), damageType: m[10] });
	}
	monsters.push({
		id: slug(name), name, type: 'monster',
		size: typeLine.split(' ')[0], typeLine,
		ac: acv, acValue: Number(/^\d+/.exec(acv)?.[0]), hp: hp, hpAvg: Number(/^\d+/.exec(hp)?.[0]), hpDice: /\(([^)]+)\)/.exec(hp)?.[1]?.replace(/\s+/g, '') ?? null,
		speed: field('Speed'), abilities: { str: ab[0], dex: ab[1], con: ab[2], int: ab[3], wis: ab[4], cha: ab[5] },
		saves: field('Saving Throws'), skills: field('Skills'), vulnerabilities: field('Damage Vulnerabilities'), resistances: field('Damage Resistances'), immunities: field('Damage Immunities'), conditionImmunities: field('Condition Immunities'),
		senses: field('Senses'), languages: field('Languages'), cr: cm[1], xp: Number(cm[2].replace(/,/g, '')),
		traitsText, actionsText, attacks, ...SRC,
	});
}

// ---- equipment --------------------------------------------------------------------------------
const COIN = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
const costCp = (s) => { const m = /^([\d,]+) (cp|sp|ep|gp|pp)$/.exec(s); return m ? Number(m[1].replace(/,/g, '')) * COIN[m[2]] : null; };
const weightOf = (s) => (s === '—' ? null : /^(\d+)\/(\d+) lb\.$/.test(s) ? Number(s.split('/')[0]) / Number(/\/(\d+)/.exec(s)[1]) : /^([\d.]+) lb\.$/.test(s) ? Number(/^([\d.]+)/.exec(s)[1]) : undefined);
const weapons = [];
let wCat = 'Simple Melee Weapons';
for (const l of tableLines) {
	const hm = /(Simple|Martial) (Melee|Ranged) Weapons/.exec(l);
	if (hm && l.split(' | ').length <= 2 && !/\d/.test(l)) { wCat = hm[0]; continue; }
	const c = l.split(' | ');
	if (c.length >= 4 && costCp(c[1]) !== null && (/^\d*d?\d+ (bludgeoning|piercing|slashing)$/.test(c[2]) || c[2] === '—')) {
		const [dmg, dtype] = c[2] === '—' ? [null, null] : c[2].split(' ');
		const props = (c[4] ?? '—') === '—' ? [] : c[4].split(/,\s*(?![^(]*\))/).map((p) => p.trim());
		const rng = /range (\d+\/\d+)/.exec(c[4] ?? '')?.[1] ?? null;
		weapons.push({ id: slug(c[0]), name: c[0], type: 'weapon', category: wCat.startsWith('Simple') ? 'simple' : 'martial', reach: wCat.includes('Ranged') ? 'ranged' : 'melee', damage: dmg, damageType: dtype, costCp: costCp(c[1]), weight: weightOf(c[3]), properties: props, range: rng, ...SRC });
	}
	if (weapons.some((w) => w.name === 'Net')) break;
}
const gear = [];
{
	const seen = new Set();
	for (const l of prose) {
		const m = /^([A-Z][^|]*?) ([\d,]+) (cp|sp|ep|gp|pp) (—|[\d/.]+ lb\.)(?: \(.*\))?$/.exec(l);
		if (!m || seen.has(m[1]) || weapons.some((w) => w.name === m[1])) continue;
		seen.add(m[1]);
		gear.push({ id: slug(m[1]), name: m[1], type: 'gear', costCp: costCp(`${m[2]} ${m[3]}`), weight: weightOf(m[4]), ...SRC });
	}
}
const armor = [];
{
	const start = tableLines.findIndex((l, i) => /^Light Armor$/.test(l) && /Padded/.test(tableLines[i + 1] ?? '') );
	const seg = tableLines.slice(start - 6 > 0 ? start - 6 : 0, start + 40);
	for (const l of seg) {
		const c = l.split(' | ');
		if (c.length >= 4 && costCp(c[1]) !== null && /^(\+?\d+( \+ Dex modifier( \(max 2\))?)?)$/.test(c[2] ?? '')) {
			if (/^\+\d+$/.test(c[2])) { armor.push({ id: slug(c[0]), name: c[0], type: 'shield', costCp: costCp(c[1]), baseAc: 0, acBonus: Number(c[2].slice(1)), dex: 'none', minStr: null, stealthDisadvantage: false, weight: weightOf(c[5] ?? c[4] ?? '—'), ...SRC }); continue; }
			const m = /^(\d+)(?: \+ Dex modifier(?: \((max 2)\))?)?$/.exec(c[2]);
			if (!m) continue;
			armor.push({ id: slug(c[0]), name: c[0], type: 'armor', costCp: costCp(c[1]), baseAc: Number(m[1]), dex: /Dex/.test(c[2]) ? (m[2] ? 'max2' : 'full') : 'none', minStr: /^Str (\d+)$/.exec(c[3])?.[1] ? Number(/(\d+)/.exec(c[3])[1]) : null, stealthDisadvantage: /Disadvantage/.test(c[4] ?? ''), weight: weightOf(c[5] ?? c[4] ?? '—'), ...SRC });
		}
	}
}

// ---- classes (level tables) -------------------------------------------------------------------
const CLASS_LIST = ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];
const classes = [];
for (const cn of CLASS_LIST) {
	const hdAt = prose.findIndex((l, i) => l === `The ${cn}` || (l === cn && prose[i + 1] === 'Class Features'));
	const secStart = prose.findIndex((l, i) => /^Hit Dice: 1d(\d+) per /.test(l) && new RegExp(`per ${cn.toLowerCase()} level`).test(l));
	if (secStart < 0) { warnings.push(`class not found: ${cn}`); continue; }
	const sec = prose.slice(secStart, secStart + 60);
	const take = (label) => { const j = sec.findIndex((l) => l.startsWith(label)); if (j < 0) return null; let v = sec[j].slice(label.length).trim(); let n = j + 1; while (n < sec.length && !/^(Armor|Weapons|Tools|Saving Throws|Skills|Equipment|Hit Points|Proficiencies|•|The )/.test(sec[n]) && n < j + 5) v += ` ${sec[n++]}`; return clean(v); };
	const hitDie = Number(/1d(\d+)/.exec(sec[0])[1]);
	const rows = [];
	const t0 = tableLines.findIndex((l, i) => new RegExp(`^The ${cn}`).test(l) || (l === cn && /^Level/.test(tableLines[i + 1] ?? '')));
	void hdAt; void t0;
	classes.push({ id: slug(cn), name: cn, type: 'class', hitDie, savingThrows: take('Saving Throws:'), armor: take('Armor:'), weapons: take('Weapons:'), tools: take('Tools:'), skills: take('Skills:'), levels: rows, ...SRC });
}
// level tables: rows "1st +2 Feature, Feature 3 2 —" after the "The <Class>" heading. Wide tables are read from the
// full-width page lines, narrow ones from the column-cropped prose. A table is accepted only if it is clean:
// 20 consecutive levels, feature cells short and without sentence text.
function parseRows(lines, name) {
	const at = lines.findIndex((l) => new RegExp(`^The ${name}\\b`).test(l.replace(/ \| /g, ' ')));
	if (at < 0) return [];
	const rows = [];
	for (const raw of lines.slice(at, at + 140)) {
		const l = raw.replace(/ \| /g, ' ');
		const m = /^(\d+)(?:st|nd|rd|th) \+(\d) (.*)$/.exec(l);
		if (!m || Number(m[1]) !== rows.length + 1) continue;
		const toks = m[3].split(' ');
		let k = 0;
		let depth = 0;
		while (k < toks.length && (depth > 0 || !/^(—|\+?\d|\d*d\d+)/.test(toks[k]))) {
			depth += (toks[k].match(/\(/g) ?? []).length - (toks[k].match(/\)/g) ?? []).length;
			k++;
		}
		rows.push({ level: Number(m[1]), profBonus: Number(m[2]), features: toks.slice(0, k).join(' ').split(/,\s*/).filter(Boolean), cols: toks.slice(k) });
		if (rows.length === 20) break;
	}
	return rows;
}
const clean20 = (rows) => rows.length === 20 && rows.every((r) => r.features.every((f) => f.length <= 45 && !/[.]/.test(f)));
for (const c of classes) {
	let rows = parseRows(tableLines, c.name);
	if (!clean20(rows)) rows = parseRows(prose, c.name);
	if (clean20(rows)) c.levels = rows;
	else { c.levels = []; c.verification = 'partial'; warnings.push(`class level table not cleanly extracted: ${c.name}`); }
}

// ---- races, backgrounds, feats ----------------------------------------------------------------
const RACE_HEADS = ['Dwarf', 'Hill Dwarf', 'Elf', 'High Elf', 'Halfling', 'Lightfoot', 'Human', 'Dragonborn', 'Gnome', 'Rock Gnome', 'Half-Elf', 'Half-Orc', 'Tiefling'];
const races = [];
{
	const marker = (h, i) => prose[i] === `${h} Traits` || (prose[i] === h && prose.slice(i + 1, i + 16).some((x) => /^Ability Score Increase\./.test(x)));
	const starts = [];
	for (const h of RACE_HEADS) {
		const at = prose.findIndex((_, i) => marker(h, i));
		if (at < 0) warnings.push(`race not found: ${h}`);
		else starts.push({ h, at });
	}
	const order = [...starts].sort((x, y) => x.at - y.at);
	for (const { h, at } of order.length ? starts : []) {
		const next = order.find((o) => o.at > at)?.at ?? at + 60;
		const txt = clean(prose.slice(at, Math.min(next, at + 70)).join(' '));
		const asiAt = txt.indexOf('Ability Score Increase.');
		const sentences = asiAt < 0 ? [] : txt.slice(asiAt + 'Ability Score Increase.'.length).trim().split(/(?<=\.) (?=[A-Z])/);
		const asi = [];
		for (const x of sentences) { if (/score|increase/i.test(x) && asi.length < 2 && !/^(Age|Speed|Size)/.test(x)) asi.push(x); else break; }
		const speed = /base walking speed is (\d+) feet/.exec(txt)?.[1] ?? null;
		races.push({ id: slug(h), name: h, type: 'race', abilityText: asi.join(' ') || null, speed: speed ? Number(speed) : null, ...SRC });
	}
}
const backgrounds = [];
{
	const at = prose.findIndex((l, i) => l === 'Acolyte' && prose.slice(i, i + 40).some((x) => /^Skill Proficiencies:/.test(x)));
	if (at >= 0) {
		const seg = prose.slice(at, at + 40);
		const j = seg.findIndex((x) => /^Skill Proficiencies:/.test(x));
		const txt = clean(seg.slice(j, j + 8).join(' '));
		backgrounds.push({ id: 'acolyte', name: 'Acolyte', type: 'background', skills: /Skill Proficiencies: (.*?)(?= Languages:)/.exec(txt)?.[1]?.trim() ?? null, languages: /Languages: (.*?)(?= Equipment:)/.exec(txt)?.[1]?.trim() ?? null, ...SRC });
	} else warnings.push('Acolyte background not found');
}
const feats = [];
{
	const at = prose.findIndex((l, i) => l === 'Grappler' && /Prerequisite/.test(prose[i + 1] ?? ''));
	if (at >= 0) feats.push({ id: 'grappler', name: 'Grappler', type: 'feat', prerequisite: clean(prose[at + 1].replace('Prerequisite:', '')), text: clean(prose.slice(at + 2, at + 14).join(' ')).slice(0, 700), ...SRC });
	else warnings.push('Grappler feat not found');
}

const out = {
	meta: {
		title: 'D&D 5e SRD 5.1 — structured import',
		edition: '2014',
		source: 'System Reference Document 5.1, Wizards of the Coast LLC',
		sourceUrl: 'https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf',
		pdfSha256: PDF_SHA256,
		license: 'CC-BY-4.0',
		attribution: 'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.',
		dataVersion: '1.0.0',
		counts: { spells: spells.length, monsters: monsters.length, weapons: weapons.length, armor: armor.length, gear: gear.length, classes: classes.length, races: races.length, backgrounds: backgrounds.length, feats: feats.length },
		warnings,
	},
	spells, monsters, weapons, armor, gear, classes, races, backgrounds, feats,
};
rmSync(tmp, { recursive: true, force: true });
mkdirSync(OUT.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(JSON.stringify(out.meta.counts), warnings.length ? `warnings: ${warnings.length}` : '');
for (const w of warnings.slice(0, 30)) console.log(' !', w);
