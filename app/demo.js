import { writeCsv } from './csv.js';
import { evaluate, loadBatch } from './engine.js';

export const HEADERS = ['order_id', 'sku', 'date', 'category', 'region', 'quantity', 'unit_price', 'revenue'];
const categories = ['Homeware', 'Stationery', 'Gifts', 'Kitchen', 'Textiles'];
const regions = ['United Kingdom', 'France', 'Germany', 'Netherlands'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

export function demoBatches() {
  return months.map((month, monthIndex) => {
    const count = [144, 177, 165, 208, 194, 248][monthIndex];
    const clean = Array.from({ length: count }, (_, index) => {
      const refund = index % 41 === 0;
      const quantity = (refund ? -1 : 1) * (1 + (index * 7 + monthIndex) % 8);
      const price = (450 + (index * 187 + monthIndex * 13) % 4300) / 100;
      const date = '2025-' + String(monthIndex + 1).padStart(2, '0') + '-' + String((index % 28) + 1).padStart(2, '0');
      return [(refund ? 'C' : '') + String(610000 + monthIndex * 1000 + index), 'SKU-' + (220 + index % 79), date,
        categories[(index * 3 + monthIndex) % categories.length], regions[index % regions.length],
        String(quantity), price.toFixed(2), (quantity * price).toFixed(2)];
    });
    const dirty = clean.map(row => row.slice());
    const injected = {};
    if (monthIndex < 5) return { name: 'retail_2025-0' + (monthIndex + 1) + '.csv', month, clean, dirty, injected };
    const corrupt = (index, field, value, code) => {
      dirty[index][field] = value;
      injected[(index + 2) + ':' + code] = { row: index + 2, field, original: clean[index][field] };
    };
    const changes = [3, 8, 19, 27, 46, 67, 92, 104, 128, 157, 188, 211];
    changes.forEach((index, step) => corrupt(index, 7, step % 3 === 0 ? '' : (Number(clean[index][7]) * 1.7).toFixed(2), 'revenue'));
    [12, 32, 71, 116, 144, 167, 192, 218].forEach(index => {
      const [, mm, dd] = clean[index][2].split('-');
      corrupt(index, 2, dd + '/' + mm + '/2025', 'date');
    });
    corrupt(21, 2, '31/06/2025', 'date');
    corrupt(81, 4, '', 'required');
    corrupt(152, 5, '-12', 'sign');
    for (const index of [30, 111, 183]) {
      dirty.push(dirty[index].slice());
      injected[(dirty.length + 1) + ':duplicate'] = { row: dirty.length + 1, field: null, original: null };
    }
    return { name: 'retail_2025-06.csv', month, clean, dirty, injected };
  });
}

export const demoText = batch => writeCsv([HEADERS, ...batch.dirty]);

export function score(result, truth, cleanRevenue) {
  const found = new Set(result.findings.filter(item => item.code !== 'date' || item.before !== item.after).map(item => item.key));
  const positives = Object.keys(truth);
  const detected = positives.filter(key => found.has(key)).length;
  const published = new Map(result.accepted.map(item => [item.row, item.record]));
  const recovered = positives.filter(key => {
    const item = truth[key];
    const row = published.get(item.row);
    return item.field === null ? !row : Boolean(row) && (
      row[item.field] === item.original ||
      (item.field === 7 && row[item.field] !== '' && row[item.field] !== null && Number(row[item.field]) === Number(item.original))
    );
  }).length;
  const dirtyFields = new Set(Object.values(truth).map(item => item.row + ':' + item.field));
  const fieldIndex = { date: 2, revenue: 7 };
  const falseEdits = result.findings.filter(item => item.status === 'applied' &&
    !dirtyFields.has(item.row + ':' + fieldIndex[item.field])).length;
  return {
    detection: detected / positives.length,
    precision: found.size ? detected / found.size : 0,
    recovery: recovered / positives.length,
    falseEdits,
    held: result.held.length,
    review: result.pending,
    revenueError: Math.round(Math.abs(cleanRevenue - result.publishedRevenue) * 100) / 100
  };
}

export function compare(contract, sample = demoBatches().at(-1)) {
  const batch = loadBatch(demoText(sample));
  const cleanRevenue = sample.clean.reduce((total, row) => total + Number(row[7]), 0);
  const observe = evaluate(batch, contract, {}, 'observe');
  const gate = evaluate(batch, contract);
  const approvals = Object.fromEntries(gate.findings.filter(item => item.reviewable && item.status === 'pending' &&
    Object.hasOwn(sample.injected, item.key)).map(item => [item.key, 'approve']));
  const reviewed = evaluate(batch, contract, approvals);
  return [
    { name: 'Raw import', ...score({ ...observe, findings: [], pending: 0 }, sample.injected, cleanRevenue) },
    { name: 'Contract gate', ...score(gate, sample.injected, cleanRevenue) },
    { name: 'Gate + simulated review', ...score(reviewed, sample.injected, cleanRevenue) }
  ];
}
