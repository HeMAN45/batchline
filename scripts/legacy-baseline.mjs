import { readFile } from 'node:fs/promises';
import { createContext, Script } from 'node:vm';
import { HEADERS, score } from '../app/demo.js';

const prototype = await readFile(new URL('../Data_Cleaning_Studio.html', import.meta.url), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(prototype)[1].replace(/\bwire\(\);\s*$/, '');
const context = createContext({});
new Script(source + '\n' + [
  'globalThis.runPrototype = (header, rows) => {',
  '  const raw = rows.map(row => row.map(value => isNil(value) ? null : value));',
  '  const types = profile(header, raw).map(column => column.type);',
  '  const rules = Object.fromEntries(RULES.map(rule => [rule.id, rule.def]));',
  '  return clean(header, raw, types, rules, {decisions:new Map(), categoryMappings:new Map(), dateOrder:"auto"});',
  '};'
].join('\n')).runInContext(context);

const fieldNames = { 2: 'date', 7: 'revenue' };

function semanticCode(rule, column) {
  if (rule === 'badDates' || rule === 'dates') return 'date';
  if (rule === 'dedupe') return 'duplicate';
  if (rule === 'imputeCat' && column === 4) return 'required';
  return rule;
}

function equivalent(original, updated, column) {
  if (original === '' || original === null || updated === '' || updated === null) return original === updated;
  if (column >= 5) return Number(original) === Number(updated);
  return String(original) === String(updated);
}

export function comparePrototype(sample) {
  const output = context.runPrototype(HEADERS, sample.dirty);
  const accepted = Array.from(output.keptRows, index => ({ row: index + 2, record: Array.from(output.cur[index]) }));
  const findings = new Map();
  const put = (item, status) => {
    const row = item.row + 2;
    const code = item.rule === 'xfield' && item.col === 7 ? 'revenue' : semanticCode(item.rule, item.col);
    const key = row + ':' + code;
    findings.set(key, { key, row, code, status, field: fieldNames[item.col] });
  };
  for (const item of output.changeLog) {
    if (!equivalent(item.before, item.after, item.col)) put(item, 'applied');
  }
  for (const item of output.suggestions) {
    if (item.col === null || !equivalent(item.before, item.after, item.col)) put(item, 'pending');
  }

  const total = record => Number(record[7] ?? Number(record[5]) * Number(record[6]));
  const baseRevenue = sample.clean.reduce((sum, record) => sum + total(record), 0);
  const publishedRevenue = accepted.reduce((sum, { record }) => sum + total(record), 0);
  const metrics = score({ accepted, findings: [...findings.values()], held: output.drops,
    pending: output.suggestions.length, publishedRevenue }, sample.injected, baseRevenue);
  return { name: 'Original studio defaults', ...metrics };
}
