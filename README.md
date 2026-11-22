# Batchline

[Live app on Vercel](https://batchline-ten.vercel.app/) · [Analytics](https://batchline-ten.vercel.app/#analytics) · [Benchmark results](https://batchline-ten.vercel.app/#benchmark)

Batchline is a browser-local data quality gate for recurring retail files. It validates incoming batches against a versioned contract, routes uncertain revenue corrections to review, and publishes auditable accepted and quarantined outputs. It includes an installable PWA and works offline after the first online load.

## Try the retail demo

1. Open the [landing page](https://batchline-ten.vercel.app/) and select **Try the retail demo**. The June sample has 251 rows and five prior months for comparison. Select **Download June sample CSV** to get the input file, or **Upload your CSV** to use your own data.
2. Open **Analytics** in the workspace sidebar. View monthly net revenue, accepted and quarantined rows, missing values, and findings by rule. Switch the revenue breakdown between **Category** and **Region**.
3. Open **Review queue** to inspect proposed fixes. Approve a repair or hold the row, then return to **Analytics** to see the updated results.

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

CSV and TSV imports accept the names in the application’s template and aliases listed in **Data contract**. An initial imported batch can establish a baseline after publication. Later imports compare required-field missingness and category distributions with the most recent published imported batch. Drift flags inform review without modifying rows.

## Design

- `app/csv.js` parses quoted fields, validates column names, and writes spreadsheet-safe exports.
- `app/engine.js` maps schemas, validates records, emits review findings, and computes accepted and quarantined outputs deterministically.
- `app/store.js` keeps raw text, contract snapshots, decisions, and publications in IndexedDB.
- `app/main.js` handles import, review, publishing, and replay. Replay checks the input checksum and the resulting publication fingerprint. The fingerprints verify reproducibility and are not digital signatures.
- `sw.js` precaches the application shell. Each production build derives its cache revision from the shell contents.
- `Data_Cleaning_Studio.html` contains the original standalone prototype for reference.

Workspace data stays on the current browser and origin. Clearing site data removes it. Replay bundles include original records and should be treated as sensitive if the source data is sensitive. Publication creates an immutable snapshot in the workspace and makes the output CSV downloadable. It does not send records to an external warehouse.

## Capstone evaluation

The built-in synthetic benchmark compares raw import, a contract gate, and a gate with simulated approval on identical input. The oracle approves proposals at known corrupted positions. Treat it as a controlled research comparison, not a measurement of human reviewer accuracy.

A second experiment uses the [UCI Online Retail dataset](https://archive.ics.uci.edu/dataset/352/online-retail). It projects records to the retail contract, excludes rows with missing fields or invalid measures, and removes exact duplicates in the projected representation before corruption. The benchmark treats the resulting rows as the reference for injected changes. It holds out the last three months, introduces reproducible corruptions, and evaluates restoration and net revenue error against the projected original. The CLI also runs the original studio engine with its default rules. Non-injected edits in that comparison include transformations such as categorical casing changes at positions without labeled corruption. UCI product descriptions serve as category values. Dates are evaluated at calendar-day granularity.

```sh
python -m pip install openpyxl
python scripts/prepare_uci.py <uci-zip-or-xlsx> <monthly-csv-folder>
node scripts/benchmark-uci.mjs <monthly-csv-folder>
```

## Vercel and installation

The [production deployment](https://batchline-ten.vercel.app/) runs `npm run build` and serves `dist`, with the manifest and service worker at the site root. After the first online load, install Batchline from the browser’s app menu or the in-app **Install app** button when available. In Safari on iOS, use **Share → Add to Home Screen**.
