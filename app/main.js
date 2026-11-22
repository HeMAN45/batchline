import { CONTRACT, FIELDS, REQUIRED, detectDrift, evaluate, loadBatch, monthlyRevenue, profile, segmentRevenue, sha256, validateContract } from './engine.js';
import { compare, demoBatches, demoText, HEADERS } from './demo.js';
import { writeCsv } from './csv.js';
import { publicBenchmark } from './benchmark-data.js';
import { loadWorkspace, saveWorkspace } from './store.js';

const root = document.querySelector('#root');
const announcer = document.querySelector('#announcer');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));
const integer = new Intl.NumberFormat('en-GB');
const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const format = value => integer.format(value);
const percent = value => (value * 100).toFixed(0) + '%';
const money = value => currency.format(value);
const dateLabel = iso => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
const MAX_SIZE = 45 * 1024 * 1024;
const PAGE_SIZE = 12;
const paths = {
  logo: '<path d="M3 18 9 12l4 4 8-10M15 6h6v6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  stack: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  review: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1m-6 8 2 2 4-4"/>',
  contract: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  chart: '<path d="M4 4v16h16M8 15l4-4 3 2 5-6"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5M4 17v3h16v-3"/>',
  alert: '<path d="M10.3 4.5 3 18a1 1 0 0 0 1 1.5h16a1 1 0 0 0 1-1.5L13.7 4.5a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3h.01"/>',
  rows: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18m-11 5V10"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  offline: '<path d="M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0m-8 4a3 3 0 0 1 4 0m-2 4h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  box: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 6V4h8v2m-7 7h6"/>',
  play: '<path d="m8 5 12 7-12 7V5Z"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h10a5 5 0 1 1 0 10h-3"/>'
};
const icon = (name, size = 18) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';

let state;
let view = location.hash.slice(1) || 'home';
let filter = 'all';
let page = 0;
let dimension = 'category';
let busy = false;
let storageReady = true;
let offlineReady = false;
let installPrompt;
let model;
let demoPreview;

const pages = [
  ['overview', 'grid', 'Overview'], ['analytics', 'chart', 'Analytics'], ['batches', 'stack', 'Batch history'],
  ['review', 'review', 'Review queue'], ['contract', 'contract', 'Data contract'],
  ['benchmark', 'chart', 'Benchmark']
];
const titles = Object.fromEntries(pages.map(([id, , label]) => [id, label]));

function notice(message) {
  announcer.textContent = message;
  announcer.classList.add('visible');
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => announcer.classList.remove('visible'), 4200);
}

async function persist() {
  try {
    await saveWorkspace(state);
  } catch {
    storageReady = false;
    notice('Browser storage is unavailable. Export a replay bundle to keep this run.');
  }
}

async function artifact(entry, result) {
  return sha256(JSON.stringify({
    input: entry.hash,
    contract: entry.contract,
    baselineHash: entry.baselineHash ?? null,
    baseline: entry.baseline ?? null,
    decisions: Object.entries(entry.decisions).sort(([first], [second]) => first.localeCompare(second)),
    accepted: result.accepted,
    held: result.held
  }));
}

async function seed() {
  const entries = [];
  for (const [index, sample] of demoBatches().entries()) {
    const text = demoText(sample);
    const parsed = loadBatch(text);
    const last = entries.at(-1);
    const entry = {
      id: 'demo-' + (index + 1), name: sample.name, text, hash: await sha256(text), contract: { ...CONTRACT },
      createdAt: '2025-0' + (index + 1) + '-28T10:00:00.000Z', decisions: {}, demo: true,
      baseline: last ? profile(loadBatch(last.text)) : null, baselineHash: last?.hash ?? null
    };
    if (index < 5) {
      const result = evaluate(parsed, entry.contract);
      entry.publication = { at: entry.createdAt, fingerprint: await artifact(entry, result),
        rows: result.accepted.length, revenue: result.publishedRevenue };
    }
    entries.push(entry);
  }
  return { schema: 1, entries, selected: entries.at(-1).id, contract: { ...CONTRACT } };
}

function current() {
  return state.entries.find(entry => entry.id === state.selected);
}

function refresh() {
  const entry = current();
  const batch = loadBatch(entry.text);
  model = { entry, batch, result: evaluate(batch, entry.contract, entry.decisions),
    flags: batch.errors.length ? [] : detectDrift(batch, entry.baseline, entry.contract) };
  render();
}

function badge(label, tone = '') {
  return '<span class="badge ' + tone + '"><i></i>' + esc(label) + '</span>';
}

function status(entry, result) {
  if (entry.publication) return badge('Published', 'positive');
  if (result?.held.length > 0 && !result.pending) return badge('Ready with holds', 'warning');
  if (result && !result.pending) return badge('Ready to publish', 'positive');
  return result ? badge('In review', 'warning') : badge('Draft', 'neutral');
}

function button(label, action, symbol, kind = 'secondary', extra = '') {
  return '<button type="button" class="button ' + kind + '" data-action="' + action + '" ' + extra + '>' +
    (symbol ? icon(symbol, 16) : '') + esc(label) + '</button>';
}

function layout(body) {
  const { result } = model;
  return '<aside class="rail"><a class="brand" href="#home" aria-label="Batchline home"><span class="brand-mark">' + icon('logo', 24) +
    '</span><span>Batchline<small>DATA QUALITY STUDIO</small></span></a>' +
    '<div class="navigation"><p class="nav-label">WORKSPACE</p><nav aria-label="Workspace">' +
    pages.map(([id, symbol, label]) => '<a href="#' + id + '" ' + (view === id ? 'aria-current="page"' : '') + '>' +
      icon(symbol) + '<span>' + label + '</span>' + (id === 'review' && result.pending ? '<b>' + result.pending + '</b>' : '') + '</a>').join('') +
    '</nav></div><div class="rail-footer"><div class="local-icon">' + icon('offline', 17) + '</div><div><strong>' +
    (storageReady ? 'Local workspace' : 'Session workspace') + '</strong><small>' + (offlineReady ? 'Offline available' : storageReady ? 'Data stored on this device' : 'Temporary browser session') + '</small></div></div></aside>' +
    '<div class="workspace"><header class="topbar"><div class="breadcrumb"><span>Workspace</span>' + icon('chevron', 13) +
    '<strong>' + titles[view] + '</strong></div><div class="top-actions">' +
    (installPrompt ? button('Install app', 'install', 'download') : '') +
    button('Import batch', 'import', 'upload', 'primary') + '</div></header><main id="content" tabindex="-1">' + body + '</main></div>';
}

function heading(title, subtitle, actions = '') {
  return '<div class="heading"><div><h1>' + title + '</h1><p>' + subtitle + '</p></div>' +
    (actions ? '<div class="heading-actions">' + actions + '</div>' : '') + '</div>';
}

function metric(label, value, detail, symbol, tone = '') {
  return '<article class="metric"><div class="metric-caption"><span>' + label + '</span><span class="metric-icon ' + tone + '">' + icon(symbol, 17) +
    '</span></div><strong>' + value + '</strong><p>' + detail + '</p></article>';
}

function card(title, subtitle, body, extra = '') {
  return '<section class="card"><header class="card-heading"><div><h2>' + title + '</h2><p>' + subtitle +
    '</p></div>' + extra + '</header>' + body + '</section>';
}

function landing() {
  if (!demoPreview) {
    const entry = state.entries.find(item => item.id === 'demo-6');
    const batch = loadBatch(entry.text);
    demoPreview = { entry, batch, result: evaluate(batch, entry.contract) };
  }
  const { batch, result } = demoPreview;
  return '<div class="landing"><header class="landing-header"><div class="landing-wrap">' +
    '<a class="brand" href="#home"><span class="brand-mark">' + icon('logo', 24) + '</span><span>Batchline</span></a>' +
    '<nav aria-label="Product"><a href="#benchmark">Benchmark</a>' +
    '<a class="button secondary" href="#overview">Open workspace</a></nav></div></header>' +
    '<main id="content" class="landing-wrap" tabindex="-1"><section class="landing-hero" aria-labelledby="landing-title">' +
    '<div class="landing-copy"><h1 id="landing-title">Clean retail data.<br><em>Trust the totals.</em></h1>' +
    '<p>Catch duplicates, inconsistent dates, and revenue errors before they reach your reports. Review each proposed fix and see what changes in your analytics.</p>' +
    '<div class="actions">' + button('Try the retail demo', 'demo', 'play', 'primary') +
    button('Upload your CSV', 'import', 'upload') + '</div>' +
    '<p class="landing-hint">Includes six monthly batches. <button class="link-button" type="button" data-action="demo-csv">Download June sample CSV</button></p></div>' +
    '<div class="landing-preview"><div class="preview-top"><span class="preview-icon">' + icon('chart', 19) +
    '</span><div><strong>Net revenue</strong><small>Retail demo · Jan–Jun 2025</small></div>' +
    '<span class="preview-total">' + money(result.publishedRevenue) + '<small>June accepted</small></span></div>' +
    revenueChart(demoPreview) + '<div class="preview-footer"><span><strong>' + format(batch.records.length) +
    '</strong> June source rows</span><span><strong>' + format(result.pending) + '</strong> repairs to review</span></div></div></section>' +
    '<div class="landing-features"><article>' + icon('contract', 22) + '<h2>Validate each batch</h2>' +
    '<p>Use a versioned contract to flag invalid records and spot changes from the previous batch.</p></article><article>' +
    icon('review', 22) + '<h2>Review with evidence</h2><p>Compare source values with proposed repairs before exporting accepted rows.</p></article><article>' +
    icon('chart', 22) + '<h2>Explore the impact</h2><p>Track net revenue, data quality, and quarantined rows together.</p></article></div></main>' +
    '<footer class="landing-wrap landing-footer"><span>' + icon('offline', 17) + 'Works offline after the first load</span>' +
    (installPrompt ? button('Install app', 'install', 'download') : '<span>Files stay on your device</span>') + '</footer></div>';
}

function revenueChart({ entry, batch, result } = model) {
  const prior = state.entries.filter(item => item.demo && item.publication && item.id !== entry.id);
  const series = prior.map(item => ({ id: item.id, month: item.createdAt.slice(0, 7), revenue: item.publication.revenue }));
  if (entry.demo) {
    const active = monthlyRevenue(batch, result).at(-1);
    if (active) series.push({ ...active, id: entry.id });
    series.sort((left, right) => left.month.localeCompare(right.month));
  } else {
    series.splice(0, series.length, ...monthlyRevenue(batch, result).slice(-6));
  }
  if (!series.length) return '<p class="empty">No accepted rows with valid dates are available for this batch.</p>';
  const maximum = Math.max(1, ...series.map(item => item.revenue));
  const minimum = Math.min(0, ...series.map(item => item.revenue));
  const bounds = maximum - minimum;
  const axisValue = value => '£' + (Math.abs(value) >= 1000 ? (value / 1000).toFixed(value % 1000 ? 1 : 0) + 'k' : Math.round(value));
  const lines = [maximum, minimum + bounds * 0.75, minimum + bounds * 0.5, minimum + bounds * 0.25, minimum];
  const multiYear = new Set(series.map(item => item.month.slice(0, 4))).size > 1;
  const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', year: multiYear ? '2-digit' : undefined, timeZone: 'UTC' });
  const label = month => monthFormat.format(new Date(month + '-01T00:00:00Z'));
  return '<div class="chart" role="img" aria-label="' + esc(series.map(item => label(item.month) + ' ' + money(item.revenue)).join(', ')) +
    '"><div class="axis">' + lines.map(value => '<span>' + esc(axisValue(value)) + '</span>').join('') +
    '</div><div class="plot"><div class="gridlines"><i></i><i></i><i></i><i></i><i></i></div><div class="bars">' +
    series.map(item => {
      const bottom = (Math.min(item.revenue, 0) - minimum) / bounds * 100;
      const height = Math.abs(item.revenue) / bounds * 100;
      return '<div class="bar-cell"><div class="bar-track"><div class="bar ' + (item.id === entry.id || !entry.demo ? 'active' : '') +
        '" style="--height:' + height + '%;--bottom:' + bottom + '%" title="' + esc(money(item.revenue)) +
        '"></div></div><span>' + label(item.month) + '</span></div>';
    }).join('') + '</div></div></div>';
}

function breakdown() {
  const { result } = model;
  const labels = { date: 'Date format', revenue: 'Revenue mismatch', duplicate: 'Duplicate transaction',
    required: 'Missing values', sign: 'Unverified negatives', shape: 'Uneven rows', measure: 'Invalid measures' };
  const entries = Object.entries(labels).filter(([key]) => result.checks[key] > 0).sort(([first], [second]) => result.checks[second] - result.checks[first]);
  if (!entries.length) return '<p class="empty">No row-level findings.</p>';
  const max = Math.max(...entries.map(([key]) => result.checks[key]));
  return '<div class="breakdown">' + entries.map(([key, label]) =>
    '<div><div><span>' + label + '</span><strong>' + result.checks[key] + '</strong></div><div class="track"><i style="width:' +
    result.checks[key] / max * 100 + '%"></i></div></div>').join('') + '</div>';
}

function rowDisposition() {
  const { batch, result } = model;
  const pending = new Set(result.findings.filter(item => item.status === 'pending').map(item => item.row));
  const groups = [
    ['Accepted', result.accepted.length, 'accepted'],
    ['Awaiting review', pending.size, 'awaiting'],
    ['Other quarantine', result.held.length - pending.size, 'quarantined']
  ];
  return '<div class="disposition"><div class="disposition-bar" aria-hidden="true">' +
    groups.map(([, count, tone]) => '<span class="' + tone + '" style="flex:' + count + ' 0 0"></span>').join('') +
    '</div><dl>' + groups.map(([label, count, tone]) => '<div><dt><i class="' + tone + '"></i>' + label +
    '</dt><dd>' + format(count) + ' <small>' + percent(count / batch.records.length) + '</small></dd></div>').join('') + '</dl></div>';
}

function revenueSegments() {
  const segments = segmentRevenue(model.batch, model.result, dimension);
  if (!segments.length) return '<p class="empty">No accepted rows to break down.</p>';
  const visible = segments.slice(0, 6);
  const maximum = Math.max(1, ...visible.map(segment => Math.abs(segment.revenue)));
  return '<div class="breakdown segment-chart">' + visible.map(({ name, revenue }) => '<div><div><span title="' +
    esc(name) + '">' + esc(name) + '</span><strong>' + money(revenue) + '</strong></div>' +
    '<div class="track" aria-hidden="true"><i class="' + (revenue < 0 ? 'negative' : '') +
    '" style="width:' + Math.abs(revenue) / maximum * 100 + '%"></i></div></div>').join('') + '</div>';
}

function missingComparison() {
  const { batch, result } = model;
  if (!result.accepted.length) return '<p class="empty">Accept at least one row to compare completeness.</p>';
  const before = profile(batch);
  const after = profile({ ...batch, records: result.accepted.map(item => item.record) });
  const rows = REQUIRED.map(key => ({
    label: key === 'order_id' ? 'Order ID' : key[0].toUpperCase() + key.slice(1).replaceAll('_', ' '),
    before: Math.round(before.missing[key] * before.size),
    after: Math.round(after.missing[key] * after.size)
  }));
  const max = Math.max(1, ...rows.flatMap(row => [row.before, row.after]));
  return '<div class="missing-chart"><div class="missing-legend"><span><i></i>Source</span><span><i></i>Accepted</span></div>' +
    rows.map(row => '<div class="missing-row"><strong>' + row.label + '</strong><span class="missing-pair" aria-hidden="true">' +
      '<i style="width:' + row.before / max * 100 + '%"></i><i style="width:' + row.after / max * 100 +
      '%"></i></span><span aria-label="' + row.before + ' source, ' + row.after + ' accepted">' +
      format(row.before) + ' / ' + format(row.after) + '</span></div>').join('') + '</div>';
}

function analytics() {
  const { entry, batch, result } = model;
  const selector = '<label class="segment-select"><span>Group by</span><select id="revenue-dimension">' +
    '<option value="category"' + (dimension === 'category' ? ' selected' : '') + '>Category</option>' +
    '<option value="region"' + (dimension === 'region' ? ' selected' : '') + '>Region</option></select></label>';
  return heading('Batch analytics', esc(entry.name) + ' · ' + format(batch.records.length) + ' source rows',
    '<a class="button secondary" href="#review">' + icon('review', 16) + 'Review findings</a>') +
    '<div class="overview-grid">' +
    card('Net revenue over time', entry.demo ? 'Monthly net revenue · retail demo' : 'Monthly net revenue · accepted rows', revenueChart()) +
    card('Row disposition', 'Where source records stand in this run', rowDisposition()) + '</div>' +
    '<div class="analytics-grid">' +
    card('Revenue breakdown', 'Top six groups by absolute net revenue', revenueSegments(), selector) +
    card('Missing required values', 'Counts in the source and accepted rows', missingComparison()) +
    '</div>' + card('Quality findings by rule', 'Checks triggered in the active batch', breakdown(),
      badge(format(result.findings.length) + ' findings', 'neutral'));
}

function historyTable(limit) {
  const entries = state.entries.slice().reverse();
  const rows = (limit ? entries.slice(0, limit) : entries).map(item => '<tr><td><button class="file-link" type="button" data-action="select" data-id="' +
    esc(item.id) + '">' + icon('contract', 17) + esc(item.name) + '</button></td><td>' + dateLabel(item.createdAt) +
    '</td><td>v' + item.contract.version + '</td><td>' + status(item, item.id === model.entry.id ? model.result : null) +
    '</td><td>' + (item.publication ? format(item.publication.rows) : '—') + '</td></tr>').join('');
  return '<div class="table-scroll"><table><thead><tr><th>Batch file</th><th>Imported</th><th>Contract</th><th>Status</th><th>Published rows</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>';
}

function overview() {
  const { entry, batch, result, flags } = model;
  return heading('Batch overview', 'Validate incoming retail files and track what reaches your reports.',
    '<a class="button secondary" href="#analytics">' + icon('chart', 16) + 'Open analytics</a>' +
    button('Open review queue', 'review', 'review')) +
    '<section class="batch-banner"><div class="batch-symbol">' + icon('stack', 27) + '</div><div><p>' +
    (entry.demo ? 'RETAIL DEMO BATCH' : 'ACTIVE BATCH') + '</p><h2>' + esc(entry.name) + '</h2><div class="batch-meta">Retail orders <span>·</span> Contract v' +
    entry.contract.version + ' <span>·</span> ' + format(batch.records.length) + ' source rows</div></div><div class="banner-state">' +
    status(entry, result) + '</div></section>' +
    (batch.errors.length ? '<div class="callout error">' + icon('alert') + '<div><strong>Schema check failed</strong><p>' + batch.errors.map(esc).join(' ') + '</p></div></div>' : '') +
    '<div class="metrics">' + metric('Source rows', format(batch.records.length), 'Records in the input file', 'rows') +
    metric('Accepted rows', format(result.accepted.length), percent(result.accepted.length / batch.records.length) + ' of source rows', 'check', 'mint') +
    metric('Pending review', format(result.pending), result.pending ? 'Decisions awaiting review' : 'No outstanding decisions', 'review', 'amber') +
    metric('Net revenue', esc(money(result.publishedRevenue)), 'Accepted rows, including cancellations', 'chart', 'mint') + '</div>' +
    '<div class="overview-grid">' + card('Net revenue', entry.demo ? 'Monthly totals · demo batches' : 'Monthly totals · active batch', revenueChart(),
      '<span class="chart-legend"><i></i>' + (entry.demo ? 'Active batch' : 'Accepted rows') + '</span>') +
    card('Quality findings', 'Checks triggered in the active batch', breakdown()) + '</div>' +
    '<div class="callout ' + (flags.length ? 'warning' : '') + '">' + icon(flags.length ? 'alert' : 'check') +
    '<div><strong>' + (flags.length ? 'Batch drift detected' : entry.baseline ? 'Batch drift within thresholds' : 'Baseline unavailable') + '</strong><p>' +
    (flags.length ? flags.map(flag => esc(flag.name) + ' +' + (flag.kind === 'pp' ? (flag.value * 100).toFixed(1) + ' pp' : percent(flag.value))).join(' · ') :
      entry.baseline ? 'Compared with the previous published batch in this series.' : 'Publish a verified batch to establish a baseline for the next import.') +
    '</p></div></div>' + card('Recent batches', 'Open a batch to inspect its results.', historyTable(4), '<a class="text-link" href="#batches">View all batches</a>');
}

function batches() {
  return heading('Batch history', 'Inspect previous runs, import a new file, or replay a saved bundle.',
    button('Try retail demo', 'demo', 'play') + button('Replay bundle', 'replay', 'undo')) + card('Workspace batches', format(state.entries.length) + ' batches on this device', historyTable()) +
    card('Import format', 'CSV and TSV with the retail order schema.', '<div class="card-body"><p>Required columns are order ID, date, category, region, quantity, and unit price. SKU and revenue are optional. Standard UCI Online Retail column names are also accepted.</p>' +
      button('Download CSV template', 'template', 'download') + '</div>');
}
function findingRows(findings) {
  return findings.map(item => {
    const reviewButtons = item.reviewable && !model.entry.publication ?
      (item.status === 'pending' ? button('Approve', 'approve', null, 'primary small', 'data-key="' + esc(item.key) + '"') +
        button('Hold', 'hold', null, 'secondary small', 'data-key="' + esc(item.key) + '"') :
        button('Undo', 'undo', 'undo', 'secondary small', 'data-key="' + esc(item.key) + '"')) : '';
    return '<tr><td><strong>' + esc(item.label) + '</strong><small>Row ' + format(item.row) + ' · ' + esc(item.order || 'No order ID') + '</small></td>' +
      '<td>' + esc(item.before === '' || item.before === null ? '—' : item.before) + '</td><td>' +
      esc(item.after ?? '—') + '<small>' + esc(item.reason) + '</small></td><td>' +
      badge({ applied: 'Applied', held: 'Held', pending: 'Pending' }[item.status],
        { applied: 'positive', held: 'neutral', pending: 'warning' }[item.status]) +
      '</td><td><div class="row-actions">' + reviewButtons + '</div></td></tr>';
  }).join('');
}

function review() {
  const { entry, batch, result } = model;
  const counts = Object.fromEntries(['all', 'pending', 'applied', 'held'].map(statusName => [
    statusName, statusName === 'all' ? result.findings.length : result.findings.filter(item => item.status === statusName).length
  ]));
  const sorted = result.findings.filter(item => filter === 'all' || item.status === filter).sort(
    (first, second) => Number(second.status === 'pending') - Number(first.status === 'pending') || first.row - second.row
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  page = Math.min(page, totalPages - 1);
  const actions = entry.publication ? button('Download accepted CSV', 'export', 'download', 'primary') :
    button('Publish batch', 'confirm-publish', 'check', 'primary', result.pending || !result.accepted.length || batch.errors.length ? 'disabled' : '');
  const description = entry.publication ? 'Published ' + dateLabel(entry.publication.at) + ' · ' + format(entry.publication.rows) + ' accepted rows.' :
    result.pending ? 'Resolve pending repairs to enable publishing.' : 'Publishing saves a reproducible snapshot of this run.';
  const controls = '<div class="tabs" aria-label="Filter findings">' + Object.entries(counts).map(([key, count]) =>
    '<button type="button" data-action="filter" data-filter="' + key + '" aria-pressed="' + (filter === key) + '">' + key[0].toUpperCase() + key.slice(1) +
    ' <span>' + format(count) + '</span></button>').join('') + '</div>';
  const table = sorted.length ? '<div class="table-scroll"><table class="review-table"><thead><tr><th>Finding</th><th>Original</th><th>Proposed / evidence</th><th>Status</th><th>Decision</th></tr></thead><tbody>' +
    findingRows(sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) + '</tbody></table></div>' : '<p class="empty">No findings in this view.</p>';
  const pagination = totalPages > 1 ? '<div class="pagination"><span>Page ' + (page + 1) + ' of ' + totalPages + '</span><div>' +
    button('Previous', 'prev', null, 'secondary small', page ? '' : 'disabled') +
    button('Next', 'next', null, 'secondary small', page + 1 === totalPages ? 'disabled' : '') + '</div></div>' : '';
  return heading('Review queue', esc(entry.name) + ' · ' + description, actions) +
    (batch.errors.length ? '<div class="callout error">' + icon('alert') + '<div><strong>Schema check failed</strong><p>' + batch.errors.map(esc).join(' ') + '</p></div></div>' : '') +
    card('Row findings', 'Row numbers count CSV records, including the header.', controls + table + pagination, status(entry, result)) +
    card('Run artifacts', 'Replay bundles include original data and review decisions. Share them only with intended recipients.',
      '<div class="card-body actions">' + button('Export replay bundle', 'bundle', 'download') +
      button('Download quarantine', 'quarantine', 'download', 'secondary', result.held.length ? '' : 'disabled') + '</div>' +
      (entry.publication ? '<div class="audit-fingerprint"><strong>Publication fingerprint</strong><code>' +
      esc(entry.publication.fingerprint) + '</code></div>' : ''));
}

function contract() {
  const config = state.contract;
  const fields = Object.entries(FIELDS).map(([field, aliases]) => '<tr><td><code>' + field + '</code></td><td>' +
    (REQUIRED.includes(field) ? 'Required' : 'Optional') + '</td><td>' + esc(aliases.filter(alias => alias !== field).join(', ') || '—') + '</td></tr>').join('');
  return heading('Data contract', 'Define the checks and drift thresholds for incoming retail batches.') +
    card('Retail orders', 'Changes create a new version for future imports. Existing batches keep their original contract.',
      '<form id="contract-form" class="contract-form"><label>Ambiguous dates<select name="dateOrder">' +
      [['day', 'Day first'], ['month', 'Month first'], ['strict', 'Hold ambiguous dates']].map(([value, label]) =>
        '<option value="' + value + '" ' + (value === config.dateOrder ? 'selected' : '') + '>' + label + '</option>').join('') +
      '</select></label><label>Missingness increase (percentage points)<input required name="missing" type="number" min="0" max="100" step="any" value="' +
      config.missingRateDelta * 100 + '"></label><label>Category drift threshold (%)<input required name="drift" type="number" min="0" max="100" step="any" value="' +
      config.categoryDrift * 100 + '"></label><button class="button primary" type="submit">' + icon('check', 16) + 'Save new version</button></form>',
      badge('Version ' + config.version, 'neutral')) +
    card('Schema mapping', 'Incoming headers are matched to these retail fields.', '<div class="table-scroll"><table><thead><tr><th>Field</th><th>Presence</th><th>Accepted aliases</th></tr></thead><tbody>' + fields + '</tbody></table></div>') +
    card('Validation policy', 'Applied to every imported batch.', '<dl class="policies"><div><dt>Returns and cancellations</dt><dd>Retain negative quantities when the invoice ID starts with C followed by digits.</dd></div><div><dt>Reconciliation</dt><dd>Flag totals more than £0.01 away from quantity × unit price. A reviewer must approve the proposed total.</dd></div><div><dt>Duplicates and invalid records</dt><dd>Quarantine duplicate rows, missing required fields, unsupported dates, and invalid measures.</dd></div></dl>');
}

function heldOutBenchmark() {
  const months = publicBenchmark.heldOut;
  if (!months.length) return '';
  const inputs = months.reduce((total, month) => total + month.rows, 0);
  const corruptions = months.reduce((total, month) => total + month.corruptions, 0);
  const dataset = '<a class="text-link" href="https://archive.ics.uci.edu/dataset/352/online-retail">UCI Online Retail</a>';
  const rows = months[0].policies.map(({ name }, index) => {
    const total = months.reduce((sum, month) => {
      const policy = month.policies[index];
      return {
        detected: sum.detected + policy.detection * month.corruptions,
        recovered: sum.recovered + policy.recovery * month.corruptions,
        falseEdits: sum.falseEdits + policy.falseEdits,
        held: sum.held + policy.held,
        pending: sum.pending + policy.review,
        revenueError: sum.revenueError + policy.revenueError
      };
    }, { detected: 0, recovered: 0, falseEdits: 0, held: 0, pending: 0, revenueError: 0 });
    return '<tr><td><strong>' + esc(name) + '</strong></td><td>' + percent(total.detected / corruptions) +
      '</td><td>' + percent(total.recovered / corruptions) + '</td><td>' + format(total.falseEdits) + '</td><td>' +
      format(total.held) + '</td><td>' + format(total.pending) + '</td><td>' + money(total.revenueError) + '</td></tr>';
  }).join('');
  return card('Held-out retail evaluation', format(inputs) + ' reference rows · ' + format(corruptions) +
    ' injected errors · ' + esc(months[0].month + ' to ' + months.at(-1).month) + ' · ' + dataset,
    '<div class="table-scroll"><table><thead><tr><th>Policy</th><th>Recall</th><th>Recovery</th><th>Non-injected edits</th>' +
    '<th>Quarantined</th><th>Pending</th><th>Total monthly error</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="benchmark-note">Total monthly error sums absolute revenue differences across the three months. The original studio uses its defaults before manual review.</div>',
    button('Download study data', 'study-export', 'download', 'secondary small'));
}

function benchmark() {
  const rows = compare(CONTRACT).map(item => '<tr><td><strong>' + esc(item.name) + '</strong></td><td>' + percent(item.detection) +
    '</td><td>' + (item.detection ? percent(item.precision) : '—') + '</td><td>' + percent(item.recovery) + '</td><td>' + item.falseEdits +
    '</td><td>' + item.held + '</td><td>' + item.review + '</td><td>' + esc(money(item.revenueError)) + '</td></tr>').join('');
  return heading('Benchmark', 'Compare the effect of three release policies on an identical retail batch.',
    button('Download demo results', 'benchmark-export', 'download')) + heldOutBenchmark() +
    card('Controlled corruption experiment', 'Seeded June demo · default contract v1 · labeled synthetic errors',
      '<div class="table-scroll"><table><thead><tr><th>Policy</th><th>Recall</th><th>Precision</th><th>Recovery</th><th>False edits</th><th>Quarantined</th><th>Pending</th><th>Net revenue error</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>') +
    card('Evaluation method', 'Each policy sees identical input and is scored against the same pre-corruption records.',
      '<dl class="policies"><div><dt>Raw import</dt><dd>Publishes all source rows without repair or quarantine. Missing revenue values are derived from quantity and unit price for the revenue calculation.</dd></div>' +
      '<div><dt>Contract gate</dt><dd>Applies deterministic normalization and quarantines uncertain or invalid rows.</dd></div>' +
      '<div><dt>Simulated review</dt><dd>Approves proposed repairs at known corrupted positions. This is an oracle comparison, and real reviewers can make mistakes.</dd></div>' +
      '<div><dt>Metrics</dt><dd>Recovery counts restored values and removed injected duplicate rows. Net revenue error is the absolute difference from the pre-corruption total.</dd></div></dl>');
}

function render() {
  if (!Object.hasOwn(titles, view)) view = 'home';
  root.innerHTML = view === 'home' ? landing() : layout({ overview, analytics, batches, review, contract, benchmark }[view]());
}

function navigate(destination) {
  if (location.hash === '#' + destination) {
    view = destination;
    render();
  } else location.hash = destination;
}

function download(name, contents, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showPublishDialog() {
  const { result, batch } = model;
  if (result.pending || !result.accepted.length || batch.errors.length) return;
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<form method="dialog"><h2>Publish this batch?</h2><p>' + format(result.accepted.length) +
    ' accepted rows will be included. ' + format(result.held.length) + ' rows will stay in quarantine.</p><div class="actions">' +
    '<button class="button secondary" value="cancel" autofocus>Cancel</button><button class="button primary" value="publish">Publish batch</button></div></form>';
  dialog.addEventListener('close', async () => {
    dialog.remove();
    if (dialog.returnValue !== 'publish') return;
    await runTask(async () => {
      const { entry, result: latest } = model;
      if (latest.pending || !latest.accepted.length || entry.publication) return;
      entry.publication = { at: new Date().toISOString(), fingerprint: await artifact(entry, latest),
        rows: latest.accepted.length, revenue: latest.publishedRevenue };
      await persist();
      refresh();
      notice('Publication saved on this device.');
    });
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function runTask(task) {
  if (busy) {
    notice('Wait for the current operation to finish.');
    return;
  }
  busy = true;
  try {
    await task();
  } catch (error) {
    notice(error.message || 'The operation failed.');
  } finally {
    busy = false;
  }
}

async function ingest(file) {
  if (file.size > MAX_SIZE) throw new Error('Files must be 45 MB or smaller.');
  const text = await file.text();
  const hash = await sha256(text);
  const existing = state.entries.find(entry => !entry.demo && entry.hash === hash);
  if (existing) {
    state.selected = existing.id;
    await persist();
    refresh();
    navigate('overview');
    notice('This file was already imported. Opened its existing run.');
    return;
  }
  loadBatch(text);
  const earlier = state.entries.findLast(entry => entry.publication && !entry.demo);
  const entry = {
    id: crypto.randomUUID(), name: file.name, text, hash, contract: { ...state.contract },
    createdAt: new Date().toISOString(), decisions: {},
    baseline: earlier ? profile(loadBatch(earlier.text)) : null, baselineHash: earlier?.hash ?? null
  };
  state.entries.push(entry);
  state.selected = entry.id;
  await persist();
  refresh();
  navigate('overview');
  notice('Imported ' + entry.name + '.');
}

async function replay(file) {
  if (file.size > 2 * MAX_SIZE) throw new Error('Replay bundles must be 90 MB or smaller.');
  const imported = JSON.parse(await file.text());
  if (imported.schema !== 1 || typeof imported.name !== 'string' || typeof imported.text !== 'string' ||
      !imported.decisions || typeof imported.decisions !== 'object' || Array.isArray(imported.decisions)) {
    throw new Error('This file is not a Batchline replay bundle.');
  }
  const hash = await sha256(imported.text);
  if (hash !== imported.hash) throw new Error('Replay bundle source content does not match its checksum.');
  const decisions = imported.decisions;
  if (Object.entries(decisions).some(([key, value]) => !/^\d+:revenue$/.test(key) || !['approve', 'hold'].includes(value))) {
    throw new Error('Replay bundle contains invalid review decisions.');
  }
  const baseline = imported.baseline;
  const validRate = value => Number.isFinite(value) && value >= 0 && value <= 1;
  if (baseline && (!baseline.categories || !REQUIRED.every(key => validRate(baseline.missing?.[key])) ||
    !Object.values(baseline.categories).every(validRate))) throw new Error('Replay bundle contains an invalid baseline.');
  const entry = { id: crypto.randomUUID(), name: imported.name, text: imported.text, hash, decisions,
    contract: validateContract(imported.contract), createdAt: new Date().toISOString(), baseline: baseline ?? null,
    baselineHash: typeof imported.baselineHash === 'string' ? imported.baselineHash : null };
  const result = evaluate(loadBatch(entry.text), entry.contract, decisions);
  if (imported.publication) {
    const fingerprint = await artifact(entry, result);
    if (!result.accepted.length || result.pending || fingerprint !== imported.publication.fingerprint ||
        !Number.isFinite(Date.parse(imported.publication.at))) throw new Error('Published output could not be reproduced.');
    entry.publication = { at: new Date(imported.publication.at).toISOString(), fingerprint,
      rows: result.accepted.length, revenue: result.publishedRevenue };
  }
  state.entries.push(entry);
  state.selected = entry.id;
  await persist();
  refresh();
  navigate('review');
  notice(entry.publication ? 'Published output reproduced and verified.' : 'Draft replayed from the original input and decisions.');
}

root.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]');
  if (!control || !state) return;
  const { action, id, key } = control.dataset;
  const { entry, result, batch } = model;
  const base = entry.name.replace(/\.[^.]*$/, '');
  if (action === 'import' || action === 'replay') document.querySelector(action === 'import' ? '#batch-file' : '#replay-file').click();
  if ((action === 'select' || action === 'demo') && !busy) {
    state.selected = action === 'demo' ? 'demo-6' : id;
    filter = 'all';
    page = 0;
    await persist();
    refresh();
    navigate('overview');
    if (action === 'demo') notice('Retail demo opened.');
  }
  if (action === 'review') navigate('review');
  if (action === 'confirm-publish') showPublishDialog();
  if (action === 'filter') {
    filter = control.dataset.filter;
    page = 0;
    render();
    root.querySelector('[data-filter="' + filter + '"]')?.focus();
  }
  if (action === 'prev' || action === 'next') {
    page += action === 'next' ? 1 : -1;
    render();
    root.querySelector('[data-action="' + action + '"]:not(:disabled), .tabs button[aria-pressed="true"]')?.focus();
  }
  if (['approve', 'hold', 'undo'].includes(action) && !entry.publication && !busy) {
    if (action === 'undo') delete entry.decisions[key];
    else entry.decisions[key] = action;
    await persist();
    refresh();
    const next = [...root.querySelectorAll('[data-key]')].find(button => button.dataset.key === key);
    (next ?? root.querySelector('.tabs button[aria-pressed="true"]'))?.focus();
    notice(action === 'undo' ? 'Decision reverted.' : action === 'approve' ? 'Revenue correction approved.' : 'Row kept in quarantine.');
  }
  if (action === 'export' && entry.publication) download(base + '_accepted.csv', writeCsv([batch.headers, ...result.accepted.map(item => item.record)], { spreadsheetSafe: true }));
  if (action === 'demo-csv') download(demoPreview.entry.name, demoPreview.entry.text);
  if (action === 'quarantine') download(base + '_quarantine.csv', writeCsv([
    ['source_record', 'reason', 'values_json'], ...result.held.map(item => [item.row, item.reason, JSON.stringify(item.record)])
  ], { spreadsheetSafe: true }));
  if (action === 'bundle') {
    const { name, text, hash, contract: contractSnapshot, decisions, baseline, baselineHash, publication } = entry;
    download(base + '_replay.json', JSON.stringify({ schema: 1, name, text, hash, contract: contractSnapshot, decisions, baseline, baselineHash, publication }, null, 2), 'application/json');
  }
  if (action === 'template') download('retail_orders_template.csv', writeCsv([
    HEADERS, ['610001', 'SKU-101', '2025-06-01', 'Homeware', 'United Kingdom', 2, 12.50, 25]
  ]));
  if (action === 'benchmark-export') {
    const results = compare(CONTRACT);
    download('batchline_demo_benchmark.csv', writeCsv([Object.keys(results[0]), ...results.map(Object.values)]));
  }
  if (action === 'study-export') {
    download('batchline_uci_benchmark.json', JSON.stringify(publicBenchmark, null, 2), 'application/json');
  }
  if (action === 'install' && installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    render();
  }
});

root.addEventListener('submit', async event => {
  if (event.target.id !== 'contract-form') return;
  event.preventDefault();
  const form = new FormData(event.target);
  await runTask(async () => {
    state.contract = validateContract({ ...state.contract, version: state.contract.version + 1,
      dateOrder: form.get('dateOrder'), missingRateDelta: Number(form.get('missing')) / 100, categoryDrift: Number(form.get('drift')) / 100 });
    await persist();
    render();
    notice('Contract v' + state.contract.version + ' saved for future imports.');
  });
});

root.addEventListener('change', event => {
  if (event.target.id !== 'revenue-dimension') return;
  dimension = event.target.value;
  render();
  document.querySelector('#revenue-dimension').focus();
});

document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#content')?.focus();
});

for (const [selector, operation] of [['#batch-file', ingest], ['#replay-file', replay]]) {
  document.querySelector(selector).addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) void runTask(() => operation(file));
  });
}

window.addEventListener('hashchange', () => {
  if (!model) return;
  view = location.hash.slice(1) || 'home';
  filter = 'all';
  page = 0;
  render();
  document.querySelector('#content').focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  if (model) render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  if (model) render();
  notice('Batchline installed.');
});

async function start() {
  try {
    state = await loadWorkspace();
  } catch {
    storageReady = false;
  }
  if (!state?.entries?.length) {
    state = await seed();
    await persist();
  }
  refresh();
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      offlineReady = true;
      render();
    } catch {
      // The workspace remains usable in a browser with service workers disabled.
    }
  }
}

start().catch(() => {
  root.textContent = 'Batchline could not open its workspace. Reload to try again.';
});
