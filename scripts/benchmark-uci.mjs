import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTRACT, detectDrift, loadBatch, profile } from '../app/engine.js';
import { compare } from '../app/demo.js';
import { comparePrototype } from './legacy-baseline.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/benchmark-uci.mjs <prepared monthly CSV directory>');

const files = (await readdir(directory)).filter(name => /^\d{4}-\d{2}\.csv$/.test(name)).sort();
if (files.length < 4) throw new Error('Provide at least four monthly CSVs, including a baseline month.');
const heldOut = files.slice(-3);
const summaries = [];
let baseline = profile(loadBatch(await readFile(join(directory, files.at(-4)), 'utf8')));

for (const name of heldOut) {
  const cleanBatch = loadBatch(await readFile(join(directory, name), 'utf8'));
  const clean = cleanBatch.records;
  const dirty = clean.map(row => row.slice());
  const injected = {};
  const stride = Math.max(4, Math.floor(clean.length / 200));
  let step = 0;
  for (let index = 0; index < clean.length; index += stride) {
    const corruption = step++ % 5;
    if (corruption === 0) {
      const [year, month, day] = clean[index][2].split('-');
      dirty[index][2] = day + '/' + month + '/' + year;
      injected[(index + 2) + ':date'] = { row: index + 2, field: 2, original: clean[index][2] };
    } else if (corruption === 1) {
      dirty[index][7] = (Number(clean[index][7]) + 25).toFixed(2);
      injected[(index + 2) + ':revenue'] = { row: index + 2, field: 7, original: clean[index][7] };
    } else if (corruption === 2) {
      dirty[index][4] = '';
      injected[(index + 2) + ':required'] = { row: index + 2, field: 4, original: clean[index][4] };
    } else if (corruption === 3) {
      dirty.push(clean[index].slice());
      const row = dirty.length + 1;
      injected[row + ':duplicate'] = { row, field: null, original: null };
    } else {
      dirty[index][2] = '31/02/2025';
      injected[(index + 2) + ':date'] = { row: index + 2, field: 2, original: clean[index][2] };
    }
  }
  const sample = { name, clean, dirty, injected };
  const policies = compare(CONTRACT, sample);
  policies.splice(1, 0, comparePrototype(sample));
  const flags = detectDrift({ ...cleanBatch, records: dirty }, baseline, CONTRACT);
  summaries.push({ month: name.slice(0, -4), rows: clean.length, corruptions: Object.keys(injected).length, driftFlags: flags, policies });
  baseline = profile(cleanBatch);
}

console.log(JSON.stringify({
  dataset: 'UCI Online Retail',
  referenceMonth: files.at(-4).slice(0, -4),
  heldOut: summaries
}, null, 2));
