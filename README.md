# Batchline

[Live app on Vercel](https://batchline-ten.vercel.app/) · [Clean output](https://batchline-ten.vercel.app/#output) · [Demand forecast](https://batchline-ten.vercel.app/#forecast) · [Analytics](https://batchline-ten.vercel.app/#analytics)

Batchline is an offline-capable retail data cleaner and analyzer. It validates sales files, exports clean data, reports revenue in Indian rupees, and estimates which products may sell during a festival or a specific calendar week using previous sales.

## Try the retail demo

1. Open the [landing page](https://batchline-ten.vercel.app/) and select **Try the retail demo**. The synthetic data covers three years of Indian retail sales. Download a sample file from the landing page or the full history from **Demand forecast**.
2. Open **Review queue** to inspect proposed repairs. Then open **Clean output** to see accepted rows, quarantined row counts, and accepted net revenue. **Download clean CSV** exports accepted records and includes calculated revenue when the input omits that column.
3. Open **Demand forecast** and try **Diwali 2027**, **Holi 2027**, or a chosen **ISO week**. The ranked products, estimated units, and historical ranges are available as a CSV.
4. Open **Analytics** to compare monthly net revenue, row disposition, and findings by rule. Switch the revenue breakdown between **Category** and **Region**.

## Run locally

Requires Node.js 22 or newer. The web app and core tests have no package dependencies.

```sh
npm run build
npm run dev -- dist
```

Open [Batchline locally](http://127.0.0.1:4173/) and choose **Try the retail demo**.

```sh
npm test
npm run benchmark
```

## Walk through a release

1. Open **Review queue** and filter to **Pending**. Each suggested revenue change includes the original value, proposed total, and the quantity × unit price calculation.
2. Approve a correction supported by the evidence or hold the row in quarantine. Undo restores the pending decision.
3. Publish once all pending decisions are resolved. Rows that still fail validation stay in quarantine. The accepted CSV is available after publishing.
4. Export a replay bundle. Use **Batch history → Replay bundle** to verify that the archived decisions and versioned contract reproduce the same published result.
5. In **Data contract**, save a new version to adjust date interpretation and drift thresholds for future imports. Existing batches retain their original contracts.
6. Open **Analytics** to compare monthly net revenue, row disposition, revenue by category or region, missing values, and findings by rule.

CSV and TSV imports accept the names in the application’s template and aliases listed in **Data contract**. New imports use INR, accept INR-formatted amounts such as ₹1,25,000.00, and export numeric values. Include SKU and product name for product-level estimates. Records without a SKU are grouped by category. Earlier GBP batches and the UCI benchmark retain their original currency.

## How demand estimates work

- Festival windows cover the six days before the festival and the festival itself. The ISO-week option uses Monday through Sunday of the same numbered week in prior years.
- The forecast uses up to three earlier matching periods with records on at least five days. It estimates positive sales units using either a weighted average that favours recent periods or the latest comparable period. Verified cancellations and rows in quarantine stay out of the estimate.
- Imported forecasts combine the current batch’s accepted rows with previously published batches in the same currency. Use files for the same retailer with consistent SKUs. Historical ranges report the observed minimum and maximum.
- When three matching periods are available, the app holds out the latest one and compares the weighted forecast with a baseline that repeats the prior matching period. It reports absolute unit error divided by total actual units and uses the method with the lower holdout error for the target forecast.

Festival dates follow the listed central-government calendars. Retailers can use the ISO-week option when their regional promotion dates differ. [2024 calendar](https://www.commerce.gov.in/wp-content/uploads/2024/01/holiday-list.pdf) · [2025 calendar](https://www.igcar.gov.in/holiday_list.html) · [2026–2027 calendars](https://www.iirs.gov.in/holidaycalender/)

## Design

- `app/csv.js` parses quoted fields, validates column names, and writes spreadsheet-safe exports.
- `app/engine.js` maps schemas, validates records, emits review findings, and computes accepted and quarantined outputs deterministically.
- `app/store.js` keeps raw text, contract snapshots, decisions, and publications in IndexedDB.
- `app/main.js` handles import, review, publishing, and replay. Replay checks the input checksum and the resulting publication fingerprint. The fingerprints verify reproducibility and are not digital signatures.
- `app/forecast.js` aligns festival and ISO-week periods, ranks products, and evaluates the seasonal baseline on a historical holdout.
- `sw.js` precaches the application shell. Each production build derives its cache revision from the shell contents.
- `Data_Cleaning_Studio.html` contains the original standalone prototype for reference.

Workspace data stays on the current browser and origin. Clearing site data removes it. Replay bundles include original records and should be treated as sensitive if the source data is sensitive. Publication creates an immutable snapshot in the workspace and makes the output CSV downloadable. It does not send records to an external warehouse.

## Capstone evaluation

The cleaning benchmark uses the original synthetic dataset and compares raw import, a contract gate, and a gate with simulated approval on identical input. Simulated approval uses the known corruption labels. [Benchmark results](https://batchline-ten.vercel.app/#benchmark)

A second experiment uses the [UCI Online Retail dataset](https://archive.ics.uci.edu/dataset/352/online-retail). It projects records to the retail contract, excludes rows with missing fields or invalid measures, and removes exact duplicates in the projected representation before corruption. The benchmark treats the resulting rows as the reference for injected changes. It holds out the last three months, introduces reproducible corruptions, and evaluates restoration and net revenue error against the projected original. The CLI also runs the original studio engine with its default rules. Non-injected edits in that comparison include transformations such as categorical casing changes at positions without labeled corruption. UCI product descriptions serve as category values. Dates are evaluated at calendar-day granularity.

```sh
python -m pip install openpyxl
python scripts/prepare_uci.py <uci-zip-or-xlsx> <monthly-csv-folder>
node scripts/benchmark-uci.mjs <monthly-csv-folder>
```

## Vercel and installation

The [production deployment](https://batchline-ten.vercel.app/) runs `npm run build` and serves `dist`, with the manifest and service worker at the site root. After the first online load, install Batchline from the browser’s app menu or the in-app **Install app** button when available. In Safari on iOS, use **Share → Add to Home Screen**.
