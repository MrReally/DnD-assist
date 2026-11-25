import { createSocket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { sendCue, type OscTransport } from '../../src/adapters/osc-transport';
import { buildCueMessage, validateConfig, type CueBinding } from '../../src/domain/lightkey';
import { encodeOsc } from '../../src/domain/osc';

const bind = (over: Partial<CueBinding> = {}): CueBinding => ({ id: 'b1', cardId: 'fireball', address: '/live/Панель/cue/Огонь/activate', command: 'activate', args: [], autoStart: false, ...over });

describe('OSC encoding', () => {
	it('matches the OSC 1.0 spec example layout', () => {
		const b = encodeOsc({ address: '/a', args: [{ t: 'i', v: 1 }, { t: 'f', v: 1.5 }, { t: 's', v: 'hi' }] });
		// "/a\0\0" ",ifs\0\0\0\0" int32 float32 "hi\0\0"
		expect([...b]).toEqual([0x2f, 0x61, 0, 0, 0x2c, 0x69, 0x66, 0x73, 0, 0, 0, 0, 0, 0, 0, 1, 0x3f, 0xc0, 0, 0, 0x68, 0x69, 0, 0]);
		expect(b.length % 4).toBe(0);
	});
	it('pads strings whose length is a multiple of 4 with a full NUL word', () => {
		expect(encodeOsc({ address: '/abc', args: [] }).length).toBe(8 + 4);
	});
	it('rejects bad input', () => {
		expect(() => encodeOsc({ address: 'x', args: [] })).toThrow();
		expect(() => encodeOsc({ address: '/x', args: [{ t: 'i', v: 1.5 }] })).toThrow();
		expect(() => encodeOsc({ address: '/x', args: [{ t: 'f', v: NaN }] })).toThrow();
	});
	it('encodes booleans with no payload', () => {
		expect(encodeOsc({ address: '/x', args: [{ t: 'b', v: true }, { t: 'b', v: false }] }).length).toBe(4 + 4);
	});
});

describe('cue messages', () => {
	it('swaps the trailing verb', () => {
		expect(buildCueMessage(bind({ command: 'toggle' })).address).toBe('/live/Панель/cue/Огонь/toggle');
		expect(buildCueMessage(bind({ command: 'deactivate' })).address).toBe('/live/Панель/cue/Огонь/deactivate');
	});
	it('appends the verb when the address has none; custom keeps the address', () => {
		expect(buildCueMessage(bind({ address: '/live/P/cue/C', command: 'activate' })).address).toBe('/live/P/cue/C/activate');
		expect(buildCueMessage(bind({ address: '/x/y', command: 'custom', args: [{ t: 'i', v: 3 }] }))).toEqual({ address: '/x/y', args: [{ t: 'i', v: 3 }] });
	});
	it('validates config and bindings', () => {
		expect(validateConfig({ host: '127.0.0.1', port: 21600 })).toBeNull();
		expect(validateConfig({ host: '999.1.1.1', port: 1 })).not.toBeNull();
		expect(validateConfig({ host: 'a b', port: 1 })).not.toBeNull();
		expect(validateConfig({ host: 'localhost', port: 70000 })).not.toBeNull();
		expect(() => buildCueMessage(bind({ address: 'no-slash' }))).toThrow();
		expect(() => buildCueMessage(bind({ address: '/x/' }))).toThrow();
	});
});

describe('sendCue', () => {
	it('reports sent without claiming confirmation, and reports transport errors', async () => {
		const ok: OscTransport = { send: async () => undefined };
		const r = await sendCue(ok, { host: '127.0.0.1', port: 9 }, bind());
		expect(r.status).toBe('sent');
		expect(r.detail).toMatch(/не подтверждается/);
		const bad: OscTransport = { send: async () => { throw new Error('ENETUNREACH'); } };
		const e = await sendCue(bad, { host: '127.0.0.1', port: 9 }, bind());
		expect(e).toMatchObject({ status: 'error', detail: 'ENETUNREACH' });
		expect((await sendCue(ok, { host: '', port: 9 }, bind())).status).toBe('error');
	});

	it('delivers the exact packet to a real local UDP OSC receiver', async () => {
		const server = createSocket('udp4');
		const got = new Promise<Buffer>((res) => server.once('message', (m) => res(m)));
		await new Promise<void>((r) => server.bind(0, '127.0.0.1', r));
		const port = server.address().port;
		const client = createSocket('udp4');
		const udp: OscTransport = { send: (h, p, d) => new Promise((res, rej) => client.send(d, p, h, (e) => (e ? rej(e) : res()))) };
		const r = await sendCue(udp, { host: '127.0.0.1', port }, bind({ command: 'toggle', args: [{ t: 'f', v: 1 }] }));
		const pkt = await got;
		client.close();
		server.close();
		expect(r.status).toBe('sent');
		expect(Buffer.from(encodeOsc({ address: '/live/Панель/cue/Огонь/toggle', args: [{ t: 'f', v: 1 }] })).equals(pkt)).toBe(true);
	});
});
