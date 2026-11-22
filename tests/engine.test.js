import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCsv, parseDelimited } from '../app/csv.js';
import { CONTRACT, detectDrift, evaluate, loadBatch, monthlyRevenue, profile, segmentRevenue, sha256, validateContract } from '../app/engine.js';
import { compare, HEADERS } from '../app/demo.js';

function retail(...rows) {
  return loadBatch(writeCsv([HEADERS, ...rows]));
}

const sale = ['610001', 'SKU-1', '2025-06-06', 'Homeware', 'United Kingdom', '2', '10.00', '20.00'];

test('parses quoted newlines and ignores separators inside headers', () => {
  const parsed = parseDelimited('\uFEFF"category, name";description\r\nHome;"one\r\ntwo ""-"""\r\n');
  assert.deepEqual(parsed, { headers: ['category, name', 'description'],
    records: [['Home', 'one\r\ntwo "-"']], delimiter: ';' });
  assert.throws(() => parseDelimited('a,a\n1,2'), /unique/);
  assert.throws(() => parseDelimited('a,b\n1,"x'), /left open/);
});

test('rejects ambiguous schema mapping and quarantines oversized records', () => {
  const invalid = loadBatch('date,InvoiceDate\n2025-01-05,2025-01-05');
  assert.ok(invalid.errors.includes('Multiple columns map to date.'));
  assert.equal(evaluate(invalid, CONTRACT).held.length, 1);
  const shape = evaluate(retail([...sale, 'extra']), CONTRACT);
  assert.equal(shape.held.length, 1);
  assert.equal(shape.checks.shape, 1);
});

test('holds ambiguous dates under strict policy and preserves valid cancellations', () => {
  const batch = retail(
    ['C610001', 'SKU-2', '2025-06-03', 'Gifts', 'United Kingdom', '-2', '10.00', '-20.00'],
    ['610002', 'SKU-2', '03/06/2025', 'Gifts', 'United Kingdom', '-2', '10.00', '-20.00'],
    ['610003', 'SKU-2', '03/06/2025', 'Gifts', 'United Kingdom', '2', '10.00', '20.00']
  );
  const result = evaluate(batch, { ...CONTRACT, dateOrder: 'strict' });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.cancellations, 1);
  assert.equal(result.publishedRevenue, -20);
  assert.deepEqual(monthlyRevenue(batch, result), [{ month: '2025-06', revenue: -20 }]);
  assert.equal(evaluate(batch, CONTRACT).accepted.length, 2);
});

test('review reruns deterministically and keeps duplicates out of accepted output', () => {
  const row = [...sale.slice(0, 7), '400'];
  const batch = retail(row, row);
  const pending = evaluate(batch, CONTRACT);
  assert.equal(pending.held.length, 2);
  assert.equal(pending.pending, 1);
  const reviewed = evaluate(batch, CONTRACT, { '2:revenue': 'approve' });
  assert.equal(reviewed.accepted[0].record[7], '20');
  assert.equal(reviewed.publishedRevenue, 20);
  assert.equal(reviewed.held.length, 1);
  assert.deepEqual(reviewed, evaluate(batch, CONTRACT, { '2:revenue': 'approve' }));
  assert.equal(evaluate(batch, CONTRACT, { '2:revenue': 'hold' }).pending, 0);
  assert.equal(batch.records[0][7], '400');
  assert.equal(evaluate(retail(sale, [...sale.slice(0, 2), '06/06/2025', ...sale.slice(3)]), CONTRACT).held.length, 1);
});

test('detects missingness and category drift against a locked baseline', () => {
  const baseline = profile(retail(sale));
  const changed = retail([...sale.slice(0, 3), '__proto__', '', ...sale.slice(5)]);
  assert.deepEqual(detectDrift(changed, baseline, CONTRACT).map(item => item.name), ['Missing region', 'Category mix shifted']);
  assert.equal(detectDrift(changed, null, CONTRACT).length, 0);
  assert.throws(() => validateContract({ ...CONTRACT, categoryDrift: 2 }), /Invalid/);
});

test('segments accepted revenue, including cancellations, without mixing dimensions', () => {
  const batch = retail(sale,
    ['C610010', 'SKU-1', '2025-06-06', 'Homeware', 'France', '-1', '10.00', '-10.00'],
    ['610011', 'SKU-2', '2025-06-06', '__proto__', 'France', '3', '10.00', '30.00'],
    ['610012', 'SKU-2', '2025-06-06', 'Gifts', 'France', '1', '10.00', '450.00']
  );
  const result = evaluate(batch, CONTRACT);
  assert.deepEqual(segmentRevenue(batch, result, 'category'), [
    { name: '__proto__', revenue: 30 }, { name: 'Homeware', revenue: 10 }
  ]);
  assert.deepEqual(segmentRevenue(batch, result, 'region'), [
    { name: 'France', revenue: 20 }, { name: 'United Kingdom', revenue: 20 }
  ]);
});

test('writes spreadsheet-safe CSV and hashes an independent source snapshot', async () => {
  assert.equal(writeCsv([['=2+3', '-10.25', '+1']], { spreadsheetSafe: true }), "'=2+3,-10.25,'+1");
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('controlled batch detects injected errors and reviewed output improves revenue error', () => {
  const [raw, gate, reviewed] = compare(CONTRACT);
  assert.equal(raw.review, 0);
  assert.equal(gate.detection, 1);
  assert.equal(gate.precision, 1);
  assert.equal(reviewed.falseEdits, 0);
  assert.equal(reviewed.review, 0);
  assert.ok(reviewed.revenueError < raw.revenueError);
  assert.ok(reviewed.recovery > gate.recovery);
});
