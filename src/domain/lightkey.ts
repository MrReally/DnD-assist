// Lightkey cue bindings (pure). Addresses come from Lightkey: cue → External Control → Copy OSC Address,
// e.g. /live/<Panel>/cue/<Cue>/activate. A successful send is NEVER treated as proof the light changed.
import type { OscArg, OscMessage } from './osc';

export type CueCommand = 'activate' | 'deactivate' | 'toggle' | 'custom';

export interface LightkeyConfig {
	host: string;
	port: number;
}

export interface CueBinding {
	id: string;
	/** Spell (or other card) id the cue is attached to. */
	cardId: string;
	/** Address as copied from Lightkey. For activate/deactivate/toggle the last segment is replaced. */
	address: string;
	command: CueCommand;
	args: OscArg[];
	/** Off by default: light starts only from the button unless the GM opts in per spell. */
	autoStart: boolean;
}

export const DEFAULT_LIGHTKEY: LightkeyConfig = { host: '127.0.0.1', port: 21600 };

const VERBS = ['activate', 'deactivate', 'toggle'];

export function validateConfig(c: LightkeyConfig): string | null {
	if (!/^(?:\d{1,3}\.){3}\d{1,3}$|^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(c.host.trim())) return 'Некорректный адрес хоста';
	if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(c.host.trim()) && c.host.split('.').some((p) => Number(p) > 255)) return 'Некорректный IPv4';
	if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) return 'Порт должен быть 1–65535';
	return null;
}

export function validateBinding(b: CueBinding): string | null {
	if (!b.address.startsWith('/')) return 'OSC-адрес должен начинаться с «/»';
	if (b.address.length > 512) return 'OSC-адрес слишком длинный';
	if (/\s$/.test(b.address) || b.address.endsWith('/')) return 'OSC-адрес оканчивается пробелом или «/»';
	return null;
}

/** Message for the binding. activate/deactivate/toggle swap the trailing verb (or append it). */
export function buildCueMessage(b: CueBinding): OscMessage {
	const err = validateBinding(b);
	if (err) throw new RangeError(err);
	if (b.command === 'custom') return { address: b.address, args: b.args };
	const parts = b.address.split('/');
	const last = parts[parts.length - 1] ?? '';
	if (VERBS.includes(last)) parts[parts.length - 1] = b.command;
	else parts.push(b.command);
	return { address: parts.join('/'), args: b.args };
}

export type SendStatus = 'sent' | 'error';

/** Result of a send. Deliberately has no "confirmed" state: UDP/OSC gives no delivery or effect proof. */
export interface SendResult {
	status: SendStatus;
	address: string;
	target: string;
	at: string;
	detail: string;
}
