// Minimal OSC 1.0 message encoder (pure). Types: i (int32), f (float32), s (string), T/F (booleans).
export type OscArg = { t: 'i'; v: number } | { t: 'f'; v: number } | { t: 's'; v: string } | { t: 'b'; v: boolean };

export interface OscMessage {
	address: string;
	args: OscArg[];
}

const enc = new TextEncoder();

function pad4(n: number): number {
	return (n + 4) & ~3; // string + NUL, rounded up to 4
}

function writeString(s: string): Uint8Array {
	const b = enc.encode(s);
	if (b.includes(0)) throw new RangeError('OSC-строка содержит NUL');
	const out = new Uint8Array(pad4(b.length));
	out.set(b);
	return out;
}

export function encodeOsc(msg: OscMessage): Uint8Array {
	if (!msg.address.startsWith('/')) throw new RangeError('OSC-адрес должен начинаться с «/»');
	const tags = `,${msg.args.map((a) => (a.t === 'b' ? (a.v ? 'T' : 'F') : a.t)).join('')}`;
	const parts: Uint8Array[] = [writeString(msg.address), writeString(tags)];
	for (const a of msg.args) {
		if (a.t === 'i') {
			if (!Number.isInteger(a.v) || a.v < -2147483648 || a.v > 2147483647) throw new RangeError('OSC int32 вне диапазона');
			const b = new Uint8Array(4);
			new DataView(b.buffer).setInt32(0, a.v, false);
			parts.push(b);
		} else if (a.t === 'f') {
			if (!Number.isFinite(a.v)) throw new RangeError('OSC float не конечен');
			const b = new Uint8Array(4);
			new DataView(b.buffer).setFloat32(0, a.v, false);
			parts.push(b);
		} else if (a.t === 's') parts.push(writeString(a.v));
	}
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
