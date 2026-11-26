// SRD 5.1 (CC-BY-4.0) reference data registry. The data file `srd51.json` is produced by
// scripts/srd/import-srd.mjs from the official PDF and shipped next to main.js (loaded lazily, works offline).
// Every record carries id / name / type / edition / source / dataVersion / verification.
export type Verification = 'srd-verified' | 'partial' | 'user' | 'homebrew' | 'incomplete' | 'unverified';

export interface SrdBase {
	id: string;
	name: string;
	type: string;
	edition: '2014';
	source: string;
	dataVersion: string;
	verification: Verification;
}

export interface SrdSpell extends SrdBase {
	level: number;
	school: string;
	ritual: boolean;
	castingTime: string;
	range: string;
	components: string;
	material: string | null;
	duration: string;
	concentration: boolean;
	text: string;
	higherLevels: string | null;
	classes: string[];
}

export interface SrdAttack {
	name: string;
	kind: string;
	bonus: number;
	reach: string | null;
	range: string | null;
	avg: number;
	damage: string;
	damageType: string;
}

export interface SrdMonster extends SrdBase {
	size: string;
	typeLine: string;
	ac: string;
	acValue: number;
	hp: string;
	hpAvg: number;
	hpDice: string | null;
	speed: string | null;
	abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
	saves: string | null;
	skills: string | null;
	vulnerabilities: string | null;
	resistances: string | null;
	immunities: string | null;
	conditionImmunities: string | null;
	senses: string | null;
	languages: string | null;
	cr: string;
	xp: number;
	traitsText: string;
	actionsText: string;
	attacks: SrdAttack[];
}

export interface SrdWeapon extends SrdBase {
	category: 'simple' | 'martial';
	reach: 'melee' | 'ranged';
	damage: string | null;
	damageType: string | null;
	costCp: number;
	weight: number | null;
	properties: string[];
	range: string | null;
}

export interface SrdArmor extends SrdBase {
	costCp: number;
	baseAc: number;
	acBonus?: number;
	dex: 'full' | 'max2' | 'none';
	minStr: number | null;
	stealthDisadvantage: boolean;
	weight: number | null;
}

export interface SrdGear extends SrdBase {
	costCp: number;
	weight: number | null;
}

export interface SrdClassLevel {
	level: number;
	profBonus: number;
	features: string[];
	cols: string[];
}

export interface SrdClass extends SrdBase {
	hitDie: number;
	savingThrows: string | null;
	armor: string | null;
	weapons: string | null;
	tools: string | null;
	skills: string | null;
	levels: SrdClassLevel[];
	/** Raw class section text (used to verify rule formulas and as reference). */
	text?: string;
}

export interface SrdRace extends SrdBase {
	abilityText: string | null;
	speed: number | null;
	text?: string;
}

export interface SrdData {
	meta: { title: string; edition: '2014'; source: string; sourceUrl: string; pdfSha256: string; license: string; attribution: string; dataVersion: string; counts: Record<string, number>; warnings: string[] };
	spells: SrdSpell[];
	monsters: SrdMonster[];
	weapons: SrdWeapon[];
	armor: SrdArmor[];
	gear: SrdGear[];
	classes: SrdClass[];
	races: SrdRace[];
	subclasses: Array<SrdBase & { classId: string }>;
	backgrounds: Array<SrdBase & { skills: string | null; languages: string | null }>;
	feats: Array<SrdBase & { prerequisite: string; text: string }>;
}

export const SRD_FILE = 'srd51.json';

let current: SrdData | null = null;
const listeners: Array<(d: SrdData) => void> = [];

export function isSrdData(v: unknown): v is SrdData {
	const d = v as Partial<SrdData> | null;
	return !!d && typeof d === 'object' && !!d.meta && d.meta.license === 'CC-BY-4.0' && d.meta.edition === '2014' && Array.isArray(d.spells) && Array.isArray(d.monsters) && Array.isArray(d.weapons) && Array.isArray(d.armor) && Array.isArray(d.gear);
}

export function setSrd(data: SrdData): void {
	current = data;
	for (const l of listeners) l(data);
}

export function getSrd(): SrdData | null {
	return current;
}

/** Called once data is available (immediately if it already is). Used to derive the item and creature tables. */
export function onSrd(fn: (d: SrdData) => void): void {
	listeners.push(fn);
	if (current) fn(current);
}

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

export function findSpells(query: string, limit = 30): SrdSpell[] {
	const q = norm(query.trim());
	if (!current) return [];
	return current.spells.filter((s) => !q || norm(s.name).includes(q) || s.id.includes(q)).slice(0, limit);
}

export function findMonsters(query: string, limit = 30): SrdMonster[] {
	const q = norm(query.trim());
	if (!current || !q) return [];
	return current.monsters.filter((m) => norm(m.name).includes(q) || m.id.includes(q)).slice(0, limit);
}

export function monsterById(id: string): SrdMonster | undefined {
	return current?.monsters.find((m) => m.id === id);
}

export function spellById(id: string): SrdSpell | undefined {
	return current?.spells.find((s) => s.id === id);
}
