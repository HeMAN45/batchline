const DAY = 86_400_000;
const toDay = iso => Date.parse(iso + 'T00:00:00Z') / DAY;
const toDate = day => new Date(day * DAY).toISOString().slice(0, 10);
const sevenDays = start => Array.from({ length: 7 }, (_, offset) => toDate(start + offset));

export const FESTIVALS = {
  diwali: { name: 'Diwali', dates: ['2024-10-31', '2025-10-20', '2026-11-08', '2027-10-29'] },
  holi: { name: 'Holi', dates: ['2024-03-25', '2025-03-14', '2026-03-04', '2027-03-23'] },
  christmas: { name: 'Christmas', dates: ['2024-12-25', '2025-12-25', '2026-12-25', '2027-12-25'] }
};

function firstMonday(year) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  return januaryFourth.getTime() / DAY - (januaryFourth.getUTCDay() + 6) % 7;
}

export function weekOf(iso) {
  const date = toDay(iso);
  const year = Number(iso.slice(0, 4));
  const weekYear = date >= firstMonday(year + 1) ? year + 1 : date < firstMonday(year) ? year - 1 : year;
  return { year: weekYear, week: Math.floor((date - firstMonday(weekYear)) / 7) + 1 };
}

export function periodWindow({ mode, festival, year, week }) {
  if (!Number.isInteger(year) || year < 1901 || year > 2099) return null;
  if (mode === 'festival' && Object.hasOwn(FESTIVALS, festival)) {
    const season = FESTIVALS[festival];
    const event = season.dates.find(date => date.startsWith(year + '-'));
    if (!event) return null;
    return { label: season.name + ' ' + year, year, dates: sevenDays(toDay(event) - 6) };
  }
  if (mode !== 'week' || !Number.isInteger(week) || week < 1 || week > 53) return null;
  const monday = firstMonday(year) + (week - 1) * 7;
  if (monday >= firstMonday(year + 1)) return null;
  return { label: 'Week ' + week + ', ' + year, year, dates: sevenDays(monday) };
}

export function buildDemandHistory(sources) {
  const days = new Map();
  const seen = new Set();
  let rowCount = 0;
  let firstDate = null;
  let lastDate = null;
  for (const { batch, result } of sources) {
    for (const { record } of result.accepted) {
      const read = field => record[batch.columns[field]]?.trim() ?? '';
      const date = read('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const quantity = Number(read('quantity'));
      if (!Number.isSafeInteger(quantity)) continue;
      const sku = read('sku').toUpperCase();
      const category = read('category');
      const key = sku ? 'sku:' + sku : 'category:' + category.toLocaleLowerCase();
      const label = sku ? read('product') || sku : category;
      const identity = JSON.stringify([read('order_id'), date, read('region'), key, quantity, Number(read('unit_price'))]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      rowCount++;
      if (!firstDate || date < firstDate) firstDate = date;
      if (!lastDate || date > lastDate) lastDate = date;
      if (!days.has(date)) days.set(date, new Map());
      if (quantity <= 0 || /^C\d+$/i.test(read('order_id'))) continue;
      const sales = days.get(date);
      sales.set(key, { sku, label, category, count: (sales.get(key)?.count ?? 0) + quantity });
    }
  }
  return { days, rowCount, firstDate, lastDate };
}

function observe(history, period) {
  const units = new Map();
  const products = new Map();
  let reportingDays = 0;
  for (const date of period.dates) {
    const sales = history.days.get(date);
    if (!sales) continue;
    reportingDays++;
    for (const [key, { sku, label, category, count }] of sales) {
      units.set(key, (units.get(key) ?? 0) + count);
      products.set(key, { sku, label, category });
    }
  }
  return { ...period, units, products, reportingDays };
}

function estimate(observations, key) {
  let total = 0;
  let weights = 0;
  observations.forEach(({ units }, index) => {
    const weight = observations.length - index;
    total += (units.get(key) ?? 0) * weight;
    weights += weight;
  });
  return total / weights;
}

function scoreHistory([holdout, ...training]) {
  if (training.length < 2) return null;
  const keys = new Set([...holdout.units.keys(), ...training.flatMap(period => [...period.units.keys()])]);
  let modelError = 0;
  let previousError = 0;
  let actualTotal = 0;
  for (const key of keys) {
    const actual = holdout.units.get(key) ?? 0;
    actualTotal += actual;
    modelError += Math.abs(actual - Math.round(estimate(training, key)));
    previousError += Math.abs(actual - (training[0].units.get(key) ?? 0));
  }
  return actualTotal ? {
    label: holdout.label, modelError: modelError / actualTotal, previousError: previousError / actualTotal
  } : null;
}

export function forecastDemand(history, options) {
  const target = periodWindow(options);
  if (!target || !history.firstDate) return { target, periods: [], ranking: [], backtest: null };
  const periods = [];
  for (let year = options.year - 1; year >= Number(history.firstDate.slice(0, 4)) - 1 && periods.length < 3; year--) {
    const window = periodWindow({ ...options, year });
    if (!window || window.dates.at(-1) >= target.dates[0]) continue;
    const observed = observe(history, window);
    if (observed.reportingDays >= 5) periods.push(observed);
  }
  const keys = new Set(periods.flatMap(period => [...period.units.keys()]));
  const backtest = scoreHistory(periods);
  const method = periods.length === 1 || (backtest && backtest.previousError < backtest.modelError)
    ? 'latest' : 'weighted';
  const ranking = Array.from(keys, key => {
    const comparable = periods.map(period => period.units.get(key) ?? 0);
    const product = periods.find(period => period.products.has(key)).products.get(key);
    return {
      key, ...product, comparable, estimate: method === 'latest' ? comparable[0] : Math.round(estimate(periods, key)),
      low: Math.min(...comparable), high: Math.max(...comparable)
    };
  }).filter(item => item.estimate > 0)
    .sort((left, right) => right.estimate - left.estimate || left.label.localeCompare(right.label));
  return { target, periods, ranking, backtest, method };
}
