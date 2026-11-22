import { writeCsv } from './csv.js';
import { FESTIVALS, periodWindow } from './forecast.js';

export const DEMO_ID = 'india-demo-2026';
export const RETAIL_HEADERS = ['order_id', 'sku', 'date', 'category', 'region', 'quantity', 'unit_price', 'revenue', 'product_name'];

const catalog = [
  ['GFT-101', 'Assorted mithai box', 'Festive gifting', 469, 8, 48, 10, 8],
  ['GFT-102', 'Clay diya set', 'Festive gifting', 119, 2, 39, 0, 1],
  ['GFT-103', 'Dry fruit gift pack', 'Festive gifting', 699, 5, 34, 4, 7],
  ['FOO-101', 'Basmati rice 1 kg', 'Staples', 139, 23, 7, 2, 2],
  ['FOO-102', 'Ghee 500 ml', 'Staples', 379, 13, 15, 3, 4],
  ['FOO-103', 'Chakli snack pack', 'Snacks', 109, 14, 24, 5, 3],
  ['HOL-101', 'Herbal gulal set', 'Festive supplies', 149, 2, 0, 44, 0],
  ['HOL-102', 'Thandai concentrate', 'Beverages', 209, 4, 0, 29, 1],
  ['BAK-101', 'Plum cake 400 g', 'Bakery', 259, 4, 2, 0, 42],
  ['HOM-101', 'Laundry detergent 1 kg', 'Home care', 179, 17, 1, 1, 2]
];
const regions = ['Mumbai', 'Pune', 'Ahmedabad', 'Bengaluru'];

export function indianDemo() {
  return [2024, 2025, 2026].map(year => {
    const end = year === 2026 ? '2026-11-15' : year + '-12-31';
    const festivalDays = Object.keys(FESTIVALS).map(festival =>
      new Set(periodWindow({ mode: 'festival', festival, year }).dates));
    const rows = [];
    const lastDay = Date.parse(end + 'T00:00:00Z');
    for (let time = Date.UTC(year, 0, 1), day = 0; time <= lastDay; time += 86_400_000, day++) {
      const date = new Date(time).toISOString().slice(0, 10);
      for (const [index, [sku, name, category, basePrice, base, ...lift]] of catalog.entries()) {
        const order = String(year * 100_000 + day * 10 + index);
        const promo = festivalDays.reduce((sum, dates, offset) => sum + (dates.has(date) ? lift[offset] : 0), 0);
        const variation = (day * 11 + index * 7 + year) % 9 - 4;
        const units = Math.max(1, Math.round((base + promo) * (1 + (year - 2024) * 0.09) + variation));
        const price = basePrice + (year - 2024) * 5;
        rows.push([order, sku, date, category, regions[(day + index) % regions.length], units, price, units * price, name]);
        if ((day * 7 + index * 11) % 137 === 0) {
          rows.push(['C' + order, sku, date, category, regions[(day + index) % regions.length], -1, price, -price, name]);
        }
      }
    }
    if (year === 2026) {
      rows[6][6] = '₹' + rows[6][6];
      rows[12][7] *= 3;
      rows[21][2] = '03/01/2026';
      rows[80][4] = '';
      rows[140][7] = '';
      rows[220][2] = '2026-02-30';
      rows.push(rows[70].slice());
    }
    return { id: 'india-demo-' + year, name: 'india_retail_' + year + '.csv', date: end, text: writeCsv([RETAIL_HEADERS, ...rows]) };
  });
}
