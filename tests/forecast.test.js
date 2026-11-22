import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCsv } from '../app/csv.js';
import { CONTRACT, INR_CONTRACT, evaluate, loadBatch, rowRevenue, validateContract } from '../app/engine.js';
import { buildDemandHistory, forecastDemand, periodWindow, weekOf } from '../app/forecast.js';
import { indianDemo, RETAIL_HEADERS } from '../app/retail-demo.js';

function validate(text, contract = INR_CONTRACT) {
  const batch = loadBatch(text);
  return { batch, result: evaluate(batch, contract) };
}

test('cleans Indian number formats while preserving legacy GBP replay behavior', () => {
  const text = writeCsv([RETAIL_HEADERS,
    ['123', 'A', '2026-03-02', 'Gifts', 'Mumbai', 2, '₹1,23,450.50', '₹2,46,901.00', 'Gift box'],
    ['124', 'A', '2026-03-02', 'Gifts', 'Mumbai', 2, '₹12,34', '₹2468', 'Gift box']
  ]);
  const { batch, result } = validate(text);
  assert.deepEqual(result.accepted[0].record.slice(6, 8), ['123450.5', '246901']);
  assert.equal(rowRevenue(batch, result.accepted[0].record), 246901);
  assert.equal(result.held.length, 1);
  assert.equal(result.checks.currency, 2);
  assert.equal(validate(text, CONTRACT).result.accepted.length, 0);
  assert.deepEqual(validateContract(INR_CONTRACT), INR_CONTRACT);
});

test('supports moving festivals and ISO week-year boundaries', () => {
  assert.deepEqual(periodWindow({ mode: 'festival', festival: 'diwali', year: 2026 }).dates, [
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'
  ]);
  assert.equal(periodWindow({ mode: 'festival', festival: 'diwali', year: 2027 }).dates.at(-1), '2027-10-29');
  assert.equal(periodWindow({ mode: 'week', year: 2020, week: 53 }).dates[0], '2020-12-28');
  assert.deepEqual(weekOf('2021-01-01'), { year: 2020, week: 53 });
  assert.equal(periodWindow({ mode: 'week', year: 2021, week: 53 }), null);
});

test('selects the lower-error forecast, excludes target sales and cancellations, and deduplicates history', () => {
  const options = { mode: 'festival', festival: 'diwali', year: 2027 };
  const rows = [2024, 2025, 2026, 2027].flatMap(year =>
    periodWindow({ ...options, year }).dates.map((date, index) => {
      const units = year === 2027 ? 900 : 2 + (year - 2024) * 2;
      return [String(year * 100 + index), 'A', date, 'Gifts', 'Pune', units, 10, units * 10, year === 2027 ? 'New name' : 'Mithai'];
    }));
  rows.push(['C950', 'A', '2026-11-08', 'Gifts', 'Pune', -5, 10, -50, 'Mithai']);
  const source = validate(writeCsv([RETAIL_HEADERS, ...rows]));
  const history = buildDemandHistory([source, source]);
  assert.equal(history.rowCount, 29);
  const { periods, ranking, backtest, method } = forecastDemand(history, options);
  assert.deepEqual(periods.map(period => period.year), [2026, 2025, 2024]);
  assert.deepEqual(ranking[0].comparable, [42, 28, 14]);
  assert.equal(method, 'latest');
  assert.equal(ranking[0].estimate, 42);
  assert.equal(ranking[0].label, 'Mithai');
  assert.equal(backtest.label, 'Diwali 2026');
  const earlierForecast = forecastDemand(history, { ...options, year: 2026 });
  assert.equal(earlierForecast.method, 'weighted');
  assert.equal(earlierForecast.ranking[0].estimate, 23);
  assert.equal(forecastDemand(buildDemandHistory([validate(writeCsv([RETAIL_HEADERS, ...rows.slice(0, 4)]))]), options).ranking.length, 0);
});

test('Indian demo ranks festive products for the matching festival and supports ISO weeks', () => {
  const history = buildDemandHistory(indianDemo().map(sample => validate(sample.text)));
  const diwali = forecastDemand(history, { mode: 'festival', festival: 'diwali', year: 2027 });
  const holi = forecastDemand(history, { mode: 'festival', festival: 'holi', year: 2027 });
  const weekly = forecastDemand(history, { mode: 'week', year: 2027, week: 4 });
  assert.equal(diwali.ranking[0].label, 'Assorted mithai box');
  assert.equal(holi.ranking[0].label, 'Herbal gulal set');
  assert.equal(diwali.periods.length, 3);
  assert.equal(weekly.periods.length, 3);
  assert.ok(weekly.ranking.length > 0);
});
