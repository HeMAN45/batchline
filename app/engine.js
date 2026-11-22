import { parseDelimited } from './csv.js';

export const CONTRACT = Object.freeze({
  schema: 1,
  id: 'retail-orders',
  version: 1,
  dateOrder: 'day',
  missingRateDelta: 0.05,
  categoryDrift: 0.2
});
export const INR_CONTRACT = Object.freeze({ ...CONTRACT, schema: 2 });

export const FIELDS = {
  order_id: ['order_id', 'orderid', 'invoice', 'invoiceno'],
  sku: ['sku', 'stockcode', 'product_code'],
  product: ['product_name', 'item_name'],
  date: ['date', 'invoicedate', 'order_date'],
  category: ['category', 'description'],
  region: ['region', 'country'],
  quantity: ['quantity', 'units_sold', 'unitssold'],
  unit_price: ['unit_price', 'unitprice'],
  revenue: ['revenue', 'line_total']
};

export const REQUIRED = ['order_id', 'date', 'category', 'region', 'quantity', 'unit_price'];
const numberPattern = /^-?\d+(?:\.\d+)?$/;
const money = number => Math.round((number + Math.sign(number) * Number.EPSILON) * 100) / 100;
const numeric = value => numberPattern.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const groupedRupees = /^-?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/;
function rupees(value) {
  const text = value.replace(/^(-?)₹\s*/, '$1');
  if (groupedRupees.test(text)) return numeric(text.replaceAll(',', ''));
  return numeric(text);
}
const canonical = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const isCancellation = value => /^C\d+$/i.test(value);
export const decisionKey = (row, code) => row + ':' + code;

export function validateContract(contract) {
  const threshold = value => Number.isFinite(value) && value >= 0 && value <= 1;
  if (![1, 2].includes(contract?.schema) || contract.id !== CONTRACT.id ||
      !Number.isSafeInteger(contract.version) || contract.version < 1 ||
      !['day', 'month', 'strict'].includes(contract.dateOrder) ||
      !threshold(contract.missingRateDelta) || !threshold(contract.categoryDrift)) {
    throw new Error('Invalid retail contract.');
  }
  const { schema, id, version, dateOrder, missingRateDelta, categoryDrift } = contract;
  return { schema, id, version, dateOrder, missingRateDelta, categoryDrift };
}

function dateValue(value, order) {
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/.exec(value);
  let year, month, day;
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?: (?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/.exec(value);
    if (!match) return null;
    const [, first, second, suffix] = match;
    year = suffix;
    if (Number(first) > 12) [day, month] = [first, second];
    else if (Number(second) > 12) [month, day] = [first, second];
    else if (order === 'day' || Number(first) === Number(second)) [day, month] = [first, second];
    else if (order === 'month') [month, day] = [first, second];
    else return null;
  }
  const iso = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
  const date = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function profile(batch) {
  const categoryIndex = batch.columns.category;
  const categoryCounts = Object.create(null);
  const missing = Object.fromEntries(REQUIRED.map(name => [name, 0]));
  for (const record of batch.records) {
    const category = record[categoryIndex]?.trim().toLowerCase();
    if (category) categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    for (const name of REQUIRED) {
      if (!record[batch.columns[name]]?.trim()) missing[name]++;
    }
  }
  const size = batch.records.length;
  const classified = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0);
  return {
    size,
    missing: Object.fromEntries(Object.entries(missing).map(([name, count]) => [name, count / size])),
    categories: Object.fromEntries(Object.entries(categoryCounts).map(([name, count]) => [name, count / classified]))
  };
}

export function detectDrift(batch, baseline, contract) {
  if (!baseline) return [];
  const current = profile(batch);
  const flags = [];
  for (const name of REQUIRED) {
    const change = current.missing[name] - baseline.missing[name];
    if (change > contract.missingRateDelta) flags.push({ name: 'Missing ' + name, value: change, kind: 'pp' });
  }
  const categories = new Set([...Object.keys(current.categories), ...Object.keys(baseline.categories)]);
  const distance = [...categories].reduce((sum, name) => sum +
    Math.abs((Object.hasOwn(current.categories, name) ? current.categories[name] : 0) -
      (Object.hasOwn(baseline.categories, name) ? baseline.categories[name] : 0)), 0) / 2;
  if (distance > contract.categoryDrift) flags.push({ name: 'Category mix shifted', value: distance, kind: 'index' });
  return flags;
}

export function loadBatch(text) {
  const { headers, records, delimiter } = parseDelimited(text);
  const normalized = headers.map(canonical);
  const columns = {};
  const errors = [];
  for (const [name, aliases] of Object.entries(FIELDS)) {
    const matches = normalized.flatMap((header, index) => aliases.some(alias => canonical(alias) === header) ? [index] : []);
    if (matches.length > 1 && name !== 'product') errors.push('Multiple columns map to ' + name + '.');
    if (!matches.length && REQUIRED.includes(name)) errors.push('Missing required column ' + name + '.');
    columns[name] = matches[0] ?? -1;
  }
  return { headers, records, delimiter, columns, errors };
}

export function evaluate(batch, contract, decisions = {}, mode = 'review') {
  const findings = [];
  const accepted = [];
  const held = [];
  const exactRows = new Set();
  const resultingRows = new Set();
  const changed = new Set();
  const flagged = new Set();
  let repaired = 0, cancellations = 0, inputRevenue = 0, publishedRevenue = 0;
  const checks = { shape: 0, required: 0, date: 0, measure: 0, sign: 0, duplicate: 0, revenue: 0, currency: 0 };
  const { records, columns, headers, errors } = batch;
  const amount = contract.schema === 2 ? rupees : numeric;

  for (const [index, record] of records.entries()) {
    const row = index + 2;
    const read = name => String(record[columns[name]] ?? '').trim();
    const rawRevenue = amount(read('revenue'));
    const quantity = numeric(read('quantity'));
    const price = amount(read('unit_price'));
    const expected = quantity === null || price === null ? null : money(quantity * price);
    inputRevenue += rawRevenue ?? (Number.isFinite(expected) ? expected : 0);
    const output = record.slice();
    let blocked = errors.length > 0;
    let resultRevenue = rawRevenue;
    const add = (code, label, before, after, reason, action, field) => {
      const key = decisionKey(row, code);
      const decision = Object.hasOwn(decisions, key) ? decisions[key] : undefined;
      const approved = action === 'auto' || (action === 'review' && (mode === 'auto' || decision === 'approve'));
      const status = approved ? 'applied' : action === 'review' && decision !== 'hold' ? 'pending' : 'held';
      const item = { key, row, order: read('order_id'), code, label, before, after, reason, field, status, action };
      if (action === 'review' && field && mode === 'review') item.reviewable = true;
      if (mode !== 'observe') {
        if (approved && field) {
          output[columns[field]] = String(after);
          changed.add(row + ':' + field);
          repaired++;
        } else if (!approved && action !== 'auto') blocked = true;
      }
      findings.push(item);
      flagged.add(row);
      checks[code]++;
      return approved && mode !== 'observe';
    };

    if (errors.length) {
      held.push({ row, record: record.slice(), reason: 'Contract schema failed' });
      continue;
    }
    if (record.length !== headers.length) {
      add('shape', 'Uneven row', record.length, headers.length, 'The number of fields differs from the header.', 'block');
    } else {
      const missing = REQUIRED.filter(field => !read(field));
      if (missing.length) add('required', 'Required value missing', missing.join(', '), null, 'The contract requires these fields.', 'block');

      const date = dateValue(read('date'), contract.dateOrder);
      if (read('date') && !date) add('date', 'Invalid or ambiguous date', read('date'), null, 'The date cannot be resolved under this contract.', 'block', 'date');
      else if (date && date !== record[columns.date]) {
        add('date', 'Normalize date', record[columns.date], date, 'The contract defines the date order. The output uses ISO calendar dates.', 'auto', 'date');
      }
      if (quantity === null || !Number.isSafeInteger(quantity) || price === null || price < 0 || !Number.isFinite(expected)) {
        if (read('quantity') && read('unit_price')) add('measure', 'Invalid quantity or price', read('quantity') + ' × ' + read('unit_price'), null, 'Use a whole quantity and a nonnegative unit price with a finite total.', 'block');
      } else if (quantity < 0 && !isCancellation(read('order_id'))) {
        add('sign', 'Unverified negative quantity', quantity, null, 'Negative quantities require a cancellation invoice ID beginning with C.', 'block');
      }

      const fingerprint = JSON.stringify(record.map(value => value.trim()));
      if (exactRows.has(fingerprint)) add('duplicate', 'Duplicate transaction', read('order_id'), null, 'An identical record is already in this batch.', 'block');
      else exactRows.add(fingerprint);

      if (!blocked && Number.isFinite(expected)) {
        if (contract.schema === 2 && numeric(read('unit_price')) === null) {
          add('currency', 'Normalize unit price', read('unit_price'), price, 'Remove the rupee symbol and grouping separators for numeric CSV output.', 'auto', 'unit_price');
        }
        if (columns.revenue < 0) resultRevenue = expected;
        else if (rawRevenue === null || Math.abs(expected - rawRevenue) > 0.01) {
          const applied = add('revenue', 'Revenue mismatch', read('revenue'), expected,
            'Quantity ' + quantity + ' × unit price ' + price.toFixed(2) + ' = ' + expected.toFixed(2) + '.', 'review', 'revenue');
          if (applied) resultRevenue = expected;
        } else if (contract.schema === 2 && numeric(read('revenue')) === null) {
          add('currency', 'Normalize revenue', read('revenue'), rawRevenue, 'Remove the rupee symbol and grouping separators for numeric CSV output.', 'auto', 'revenue');
        }
      }
      if (!blocked && mode !== 'observe') {
        const outputFingerprint = JSON.stringify(output.map(value => value.trim()));
        if (resultingRows.has(outputFingerprint)) add('duplicate', 'Duplicate after normalization', read('order_id'), null, 'After repairs this row matches an earlier published row.', 'block');
        else resultingRows.add(outputFingerprint);
      }
    }

    if (blocked) held.push({ row, record: record.slice(), reason: findings.at(-1)?.label ?? 'Contract failed' });
    else {
      accepted.push({ row, record: output });
      publishedRevenue += resultRevenue ?? 0;
      if (quantity < 0 && isCancellation(read('order_id'))) cancellations++;
    }
  }

  return { findings, accepted, held, changed, flagged, repaired, cancellations, checks,
    pending: findings.filter(item => item.status === 'pending').length,
    inputRevenue: money(inputRevenue), publishedRevenue: money(publishedRevenue) };
}

function revenueBy(batch, result, group) {
  const totals = new Map();
  for (const { record } of result.accepted) {
    const label = group(record);
    if (!label) continue;
    totals.set(label, (totals.get(label) ?? 0) + rowRevenue(batch, record));
  }
  return Array.from(totals, ([name, revenue]) => ({ name, revenue: money(revenue) }));
}

export function rowRevenue({ columns }, record) {
  if (columns.revenue >= 0) return numeric(record[columns.revenue]?.trim()) ?? 0;
  return money(numeric(record[columns.quantity]?.trim()) * numeric(record[columns.unit_price]?.trim()));
}

export function monthlyRevenue(batch, result) {
  return revenueBy(batch, result, record => {
    const month = record[batch.columns.date]?.slice(0, 7);
    return /^\d{4}-\d{2}$/.test(month) ? month : null;
  }).sort((left, right) => left.name.localeCompare(right.name)).map(({ name, revenue }) => ({ month: name, revenue }));
}

export function segmentRevenue(batch, result, field) {
  return revenueBy(batch, result, record => record[batch.columns[field]]?.trim())
    .sort((left, right) => Math.abs(right.revenue) - Math.abs(left.revenue) || left.name.localeCompare(right.name));
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
