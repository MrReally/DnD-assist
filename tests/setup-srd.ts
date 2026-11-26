import { readFileSync } from 'node:fs';
import { isSrdData, setSrd } from '../src/domain/srd';

const data: unknown = JSON.parse(readFileSync('data/srd51/srd51.json', 'utf8'));
if (!isSrdData(data)) throw new Error('data/srd51/srd51.json is not valid SRD data');
setSrd(data);
