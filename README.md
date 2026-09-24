# Safety Stock Studio

AI safety-stock optimisation on SAP S/4HANA data. It is a demo for the DOZCO trading inventory pilot by MeghaAI × Quadric IT.

The app reads standard SAP tables (MARA, MARC, MARD, MBEW, MATDOC, EKKO/EKPO/EKET/EKBE, VBAK/VBAP/LIPS, LFA1, T001W). For every material × plant it recommends safety stock, reorder point and maximum stock, explains why, and validates the policy by replaying the last 52 weeks of actual orders.

It is a static web app with no server, no build step and no external services. Everything runs in the browser. It ships with generated sample data in SAP layouts, and users can upload their own SAP extract as CSV files.

## What it shows

| View | Content |
|---|---|
| Overview | Validated fill rate and stock for the selected policy, what the AI found in the data, the operating-point curve, service by class, segmentation |
| Working capital | Release waterfall (dead, superseded, slow, excess, rebalance), holding cost, turns, aging, seasonal reorder levels |
| Service & stockouts | Fill rate by sales channel with editable targets, trend, lost sales by group and part |
| Recommendations | Per material × plant: `EISBE`, `MINBE`, `MABST`, `PLIFZ` today → recommended; filters; SAP change file (CSV for MM17) |
| Part explorer | Plain-language explanation, demand with stockouts, actual lead times vs plan, lead-time demand simulation, seasonal reorder calendar, per-part validation, forecast model competition |
| Action center | Order now, transfers between plants, reorders, excess, dead stock, master-data fixes, all exportable |
| Lead times | Supplier scorecard: planned vs actual lead time, variability, on-time rate |
| SAP data & method | Tables and fields to extract, method, sample CSV download, upload of your own data |
| Feature guide | The 14 capabilities, where to see each one, and what each adds beyond standard MRP |

Policy presets: **Lean stock** · **Balanced** · **High service** (points on the validated service-vs-stock curve) · **Service targets** by ABC/XYZ class and sales channel · **Custom budget**.

See [`docs/SAP_Data_Requirements.md`](docs/SAP_Data_Requirements.md) for the client-facing data specification and method.

## What it does that standard SAP MRP cannot

The app shows the AI's own results only. How each capability goes beyond standard MRP is explained in the help document **[`docs/FEATURES.md`](docs/FEATURES.md)** and in the in-app **Feature guide**.

1. **True demand**: forecasts from sales orders, so lost sales count; MRP learns from goods issues only.
2. **Measured lead times with their spread**, from PO date to goods receipt; MRP uses one planned delivery time.
3. **Safety stock sized to a fill-rate target** from forecast error *and* lead-time variability.
4. **Demand-pattern detection and model competition**, including Croston-SBA for intermittent spare-parts demand.
5. **Digital twin per part**: simulated service-vs-stock curve under ~18 reorder points.
6. **One stock budget optimised across all parts**; MRP plans each part in isolation.
7. **Monsoon-aware reorder points by month**, with the season learned per material group.
8. **Service targets by sales channel** (dealership, OEM, third-party).
9. **Validation on history** before go-live: day-by-day replay of 52 weeks of orders.
10. **A written reason for every recommendation.**
11. **Transfer before you buy** between plants.
12. **Working-capital release plan** from today's stock to the target level.
13. **What-if in seconds**: presets, budget slider, channel targets.
14. **Outside SAP, read-only**: no ABAP, no transports, MM17 change file back.

## Run locally

```bash
cd app
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000
```

## Deploy for free

The deployable site is the `app/` folder: plain HTML, CSS and JS with Chart.js vendored, so it needs no CDN.

**Live demo (GitHub Pages):** <https://kkmeghan.github.io/SAP-AI-Dozco/>. It opens the app at `/app/`.

GitHub Pages is set to **Settings → Pages → Deploy from a branch**, with the working branch and the `/ (root)` folder. Every push to that branch republishes the site within a minute or two. The root `index.html` forwards to `app/`, and `.nojekyll` makes GitHub serve the files as they are. `.github/workflows/test.yml` only runs the engine smoke test.

**Netlify / Cloudflare Pages / Vercel (free tiers):** connect the repository, leave the build command empty, and set the publish directory to `app`. For a one-off link without an account connection, drag the `app` folder onto <https://app.netlify.com/drop>.

## Use your own SAP data

On **SAP data & method**, choose one CSV per table, named after the table (`MARA.csv`, `MARC.csv`, …). Separators can be `,` `;` tab or `|`. Required tables: MARA, MARC, MARD, MBEW, MATDOC (or MSEG), EKKO, EKPO, EKBE, VBAK, VBAP, LIPS. Files are processed in the browser only.

To see the exact format, download the sample tables from the app, or write them locally:

```bash
node tools/export-sample-data.js sample-data --materials 50
```

## Project layout

```
app/
  index.html            page shell
  css/app.css           styles (light and dark)
  js/sapdata.js         sample SAP extract generator (SAP table and field names)
  js/engine.js          analytics engine: demand, segmentation, forecasting, lead time,
                        digital-twin simulation, budget optimiser, backtest, actions
  js/app.js             UI
  vendor/chart.umd.min.js   Chart.js 4.4.1 (MIT)
docs/SAP_Data_Requirements.md
tools/export-sample-data.js   write the sample extract as CSV
tools/smoke-test.js           engine end-to-end check (used by CI)
index.html                    forwards the GitHub Pages root to app/
```

## Method in brief

1. True demand from sales orders (VBAP vs LIPS), not only goods issues.
2. One-off bulk orders capped (Q3 + 3×IQR).
3. ABC (value) × XYZ (variability) plus demand pattern (smooth / erratic / intermittent / lumpy).
4. Forecast model competition per part, scored on the last 26 weeks.
5. Actual lead time = `EKBE-BUDAT − EKKO-BEDAT`, blended with supplier history.
6. Digital twin per part: simulated demand × lead-time scenarios under candidate reorder points.
7. Budget optimiser: marginal allocation of stock across all parts by value of demand served.
8. Validation on the last 52 weeks of actual orders (after a 52-week warm-up), re-calibrating every 8 weeks with only past data.

*The demo figures come from generated sample data, not DOZCO records.*
