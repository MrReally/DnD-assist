#!/usr/bin/env node
// Verifies the distributable ZIP itself (not the sources): structure, manifest, checksums, attribution, data integrity.
// Usage: node scripts/verify-package.mjs release/canvas-assist-<v>.zip [SHA256SUMS.txt]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const zip = process.argv[2];
const sums = process.argv[3] ?? join(zip, '..', 'SHA256SUMS.txt');
if (!zip) throw new Error('usage: verify-package.mjs <zip> [SHA256SUMS.txt]');
const checks = [];
const ok = (name, pass, detail = '') => {
	checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const tmp = mkdtempSync(join(tmpdir(), 'pkg-'));
try {
	execFileSync('unzip', ['-q', zip, '-d', tmp]);
	ok('архив читается (unzip)', true);
	const top = readdirSync(tmp);
	ok('в корне ровно одна папка canvas-assist', top.length === 1 && top[0] === 'canvas-assist', top.join(','));
	const dir = join(tmp, 'canvas-assist');
	const files = readdirSync(dir).sort();
	const need = ['INSTALL.txt', 'LICENSE', 'NOTICE-SRD.txt', 'main.js', 'manifest.json', 'srd51.json', 'styles.css'];
	ok('набор файлов точно соответствует ожидаемому', JSON.stringify(files) === JSON.stringify(need), files.join(','));
	ok('все имена файлов ASCII (безопасно для Archive Utility)', files.every((f) => /^[\x20-\x7e]+$/.test(f)));
	const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
	ok('manifest: id, версия, minAppVersion', m.id === 'canvas-assist' && /^\d+\.\d+\.\d+$/.test(m.version) && /^\d+\.\d+\.\d+$/.test(m.minAppVersion), `${m.id} ${m.version} min ${m.minAppVersion}`);
	ok('имя архива совпадает с версией manifest', zip.endsWith(`canvas-assist-${m.version}.zip`));
	const js = readFileSync(join(dir, 'main.js'), 'utf8');
	ok('main.js: нет sourcemap и внешних require кроме obsidian', !/sourceMappingURL/.test(js) && [...js.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].every((x) => x[1] === 'obsidian'));
	const srd = JSON.parse(readFileSync(join(dir, 'srd51.json'), 'utf8'));
	ok('srd51.json: лицензия, редакция, sha256 источника', srd.meta.license === 'CC-BY-4.0' && srd.meta.edition === '2014' && srd.meta.pdfSha256 === '2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0');
	ok('srd51.json: объём данных', srd.spells.length >= 318 && srd.monsters.length >= 300 && srd.weapons.length === 37 && srd.classes.length === 12, JSON.stringify(srd.meta.counts));
	const notice = readFileSync(join(dir, 'NOTICE-SRD.txt'), 'utf8');
	ok('NOTICE-SRD.txt в пакете: атрибуция CC-BY-4.0, правообладатель, ссылка на лицензию', /System Reference Document 5\.1/.test(notice) && /Wizards of the Coast LLC/.test(notice) && /creativecommons\.org\/licenses\/by\/4\.0/.test(notice) && /not affiliated/i.test(notice));
	ok('атрибуция также внутри srd51.json (meta.attribution)', /Wizards of the Coast LLC/.test(srd.meta.attribution) && /creativecommons\.org/.test(srd.meta.attribution));
	ok('LICENSE (MIT) в пакете', /MIT License/.test(readFileSync(join(dir, 'LICENSE'), 'utf8')));
	ok('INSTALL.txt содержит путь установки и шаги', /plugins/.test(readFileSync(join(dir, 'INSTALL.txt'), 'utf8')));
	ok('нет лишних/скрытых файлов, размер архива < 4 МиБ', statSync(zip).size < 4 * 1048576, `${statSync(zip).size} B`);
	const lines = readFileSync(sums, 'utf8').trim().split('\n');
	const zipSum = createHash('sha256').update(readFileSync(zip)).digest('hex');
	ok('SHA256SUMS: сумма ZIP совпадает', lines.some((l) => l.startsWith(zipSum) && l.endsWith(zip.split('/').pop())), zipSum);
	for (const f of ['main.js', 'manifest.json', 'styles.css', 'srd51.json']) {
		const h = createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
		ok(`SHA256SUMS: ${f} внутри ZIP совпадает`, lines.some((l) => l.startsWith(h) && l.endsWith(`  ${f}`)));
	}
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
process.exit(checks.some((c) => c.status === 'FAIL') ? 1 : 0);
