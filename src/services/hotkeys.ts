// Contextual hotkeys: matched by physical key (KeyboardEvent.code) so they work on Russian layout,
// active only in a Canvas of a registered adventure and never while the user types.
import type { HotkeyAction } from '../settings';

export interface ParsedHotkey {
	shift: boolean;
	alt: boolean;
	mod: boolean;
	code: string;
}

const KEY_TO_CODE: Record<string, string> = { Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab' };

export function parseHotkey(text: string): ParsedHotkey | null {
	const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
	if (parts.length === 0) return null;
	const key = parts.pop() as string;
	const mods = new Set(parts.map((p) => p.toLowerCase()));
	let code: string | undefined;
	if (/^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`;
	else if (/^[0-9]$/.test(key)) code = `Digit${key}`;
	else if (/^F([1-9]|1[0-2])$/i.test(key)) code = key.toUpperCase();
	else code = KEY_TO_CODE[key];
	if (!code) return null;
	for (const m of mods) if (!['shift', 'alt', 'ctrl', 'mod', 'cmd'].includes(m)) return null;
	return { shift: mods.has('shift'), alt: mods.has('alt'), mod: mods.has('ctrl') || mods.has('mod') || mods.has('cmd'), code };
}

export function matchesHotkey(ev: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>, hk: ParsedHotkey): boolean {
	return ev.code === hk.code && ev.shiftKey === hk.shift && ev.altKey === hk.alt && (ev.ctrlKey || ev.metaKey) === hk.mod;
}

const TYPING_SELECTOR = 'input, textarea, select, iframe, [contenteditable=""], [contenteditable="true"], .cm-editor, .markdown-source-view, .modal-container, .canvas-node.is-editing';

/**
 * True when the event target or the focused element is any kind of text input. Obsidian 1.14
 * edits Canvas text nodes inside an iframe, so a focused iframe also counts as typing.
 */
export function isTypingTarget(target: EventTarget | null, active: Element | null = null): boolean {
	for (const t of [target, active]) {
		if (!t || typeof (t as Element).closest !== 'function') continue;
		const el = t as HTMLElement;
		if (el.isContentEditable) return true;
		if (el.closest(TYPING_SELECTOR)) return true;
	}
	return false;
}

export function findConflicts(map: Record<HotkeyAction, string>): string[] {
	const seen = new Map<string, HotkeyAction>();
	const out: string[] = [];
	for (const [action, text] of Object.entries(map) as Array<[HotkeyAction, string]>) {
		if (!text.trim()) continue;
		const hk = parseHotkey(text);
		if (!hk) {
			out.push(`«${text}» не распознано (${action})`);
			continue;
		}
		const key = JSON.stringify(hk);
		const prev = seen.get(key);
		if (prev) out.push(`«${text}» назначено и на ${prev}, и на ${action}`);
		else seen.set(key, action);
		if (hk.code === 'Space' && !hk.shift && !hk.alt && !hk.mod) out.push('Пробел без модификаторов конфликтует с панорамированием Canvas');
	}
	return out;
}
