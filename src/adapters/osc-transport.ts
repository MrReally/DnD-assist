// UDP transport for OSC. Desktop (Electron) only: Node's dgram is resolved at call time so the bundle
// loads on mobile, where sending simply reports an error. Never throws; never blocks the game.
import { buildCueMessage, validateConfig, type CueBinding, type LightkeyConfig, type SendResult } from '../domain/lightkey';
import { encodeOsc } from '../domain/osc';

export interface OscTransport {
	send(host: string, port: number, data: Uint8Array): Promise<void>;
}

interface DgramSocket {
	send(msg: Uint8Array, port: number, host: string, cb: (err: Error | null) => void): void;
	close(): void;
	on(ev: 'error', cb: (e: Error) => void): void;
}
interface DgramModule {
	createSocket(type: 'udp4'): DgramSocket;
}

export class DgramTransport implements OscTransport {
	send(host: string, port: number, data: Uint8Array): Promise<void> {
		const req = (window as unknown as { require?: (m: string) => unknown }).require;
		const dgram = typeof req === 'function' ? (req('dgram') as DgramModule | undefined) : undefined;
		if (!dgram) return Promise.reject(new Error('UDP недоступен на этом устройстве (только Obsidian для компьютера)'));
		return new Promise((resolve, reject) => {
			const sock = dgram.createSocket('udp4');
			let done = false;
			const finish = (err: Error | null): void => {
				if (done) return;
				done = true;
				try {
					sock.close();
				} catch {
					// already closed
				}
				if (err) reject(err);
				else resolve();
			};
			sock.on('error', (e) => finish(e));
			sock.send(data, port, host, (e) => finish(e));
		});
	}
}

export async function sendCue(transport: OscTransport, cfg: LightkeyConfig, binding: CueBinding): Promise<SendResult> {
	const at = new Date().toISOString();
	const target = `${cfg.host}:${cfg.port}`;
	const bad = validateConfig(cfg);
	if (bad) return { status: 'error', address: binding.address, target, at, detail: bad };
	try {
		const msg = buildCueMessage(binding);
		await transport.send(cfg.host.trim(), cfg.port, encodeOsc(msg));
		return { status: 'sent', address: msg.address, target, at, detail: 'Пакет отправлен. Выполнение эффекта Lightkey не подтверждается.' };
	} catch (e) {
		return { status: 'error', address: binding.address, target, at, detail: e instanceof Error ? e.message : String(e) };
	}
}
