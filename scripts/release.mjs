#!/usr/bin/env node
// Builds the release ZIP: release/canvas-assist-<version>.zip with canvas-assist/{manifest.json,main.js,styles.css}
// plus SHA-256 checksums. Pure Node (zlib), no external zip tool required.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== pkg.version) {
	console.error(`manifest.json (${manifest.version}) and package.json (${pkg.version}) versions differ`);
	process.exit(1);
}
execFileSync(process.execPath, ['esbuild.config.mjs', 'production'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/check-bundle.mjs'], { stdio: 'inherit' });

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP (deflate) writer with a fixed timestamp for reproducible archives. */
function zip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	const dosTime = 0; // 00:00:00
	const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 18; // 2026-10-18
	for (const { name, data } of entries) {
		const nameBuf = Buffer.from(name, 'utf8');
		const comp = deflateRawSync(data, { level: 9 });
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(dosTime, 10);
		local.writeUInt16LE(dosDate, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(comp.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, nameBuf, comp);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(dosTime, 12);
		central.writeUInt16LE(dosDate, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(comp.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);
		offset += local.length + nameBuf.length + comp.length;
	}
	const centralBuf = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralBuf, end]);
}

const files = ['manifest.json', 'main.js', 'styles.css'];
const out = join('release');
mkdirSync(out, { recursive: true });
const sums = [];
for (const f of files) {
	const data = readFileSync(f);
	writeFileSync(join(out, f), data);
	sums.push(`${createHash('sha256').update(data).digest('hex')}  ${f}`);
}
const archive = zip(files.map((f) => ({ name: `${manifest.id}/${f}`, data: readFileSync(f) })));
const zipName = `${manifest.id}-${manifest.version}.zip`;
writeFileSync(join(out, zipName), archive);
sums.push(`${createHash('sha256').update(archive).digest('hex')}  ${zipName}`);
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(`release/${zipName} (${archive.length} B)\n${sums.join('\n')}`);
