# Safety Stock Studio

AI safety-stock optimisation on SAP S/4HANA data. It is a demo for the DOZCO trading inventory pilot by MeghaAI × Quadric IT.

The app reads standard SAP tables (MARA, MARC, MARD, MBEW, MATDOC, EKKO/EKPO/EKET/EKBE, VBAK/VBAP/LIPS, LFA1, T001W). For every material × plant it recommends safety stock, reorder point and maximum stock, explains why, and proves the result with a backtest against the current SAP MRP settings.

It is a static web app with no server, no build step and no external services. Everything runs in the browser. It ships with generated sample data in SAP layouts, and users can upload their own SAP extract as CSV files.

## What it shows

| View | Content |
|---|---|
| Overview | Backtest of SAP MRP vs AI, the service-vs-working-capital curve, where SAP MRP falls short, class comparison, segmentation |
| Working capital | Release waterfall (dead, superseded, slow, excess, rebalance), holding cost, turns, aging, seasonal reorder levels |
| Service & stockouts | Fill rate by sales channel with editable targets, trend, lost sales by group and part |
| Recommendations | Per material × plant: `EISBE`, `MINBE`, `MABST`, `PLIFZ` today → recommended; filters; SAP change file (CSV for MM17) |
| Part explorer | Plain-language explanation, demand with stockouts, actual lead times vs plan, lead-time demand simulation, per-part backtest, forecast model competition |
| Action center | Order now, transfers between plants, reorders, excess, dead stock, master-data fixes, all exportable |
| Lead times | Supplier scorecard: planned vs actual lead time, variability, on-time rate |
| SAP data & method | Tables and fields to extract, method, sample CSV download, upload of your own data |

Policy presets: **same service, less capital** · **same capital, more service** · **service targets by ABC/XYZ class and sales channel** · **custom budget**.

See [`docs/SAP_Data_Requirements.md`](docs/SAP_Data_Requirements.md) for the client-facing data specification and method.

## Run locally

```bash
cd app
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000
```

## Deploy for free

The deployable site is the `app/` folder: plain HTML, CSS and JS with Chart.js vendored, so it needs no CDN.

**GitHub Pages (automatic):** `.github/workflows/pages.yml` runs the smoke test and publishes `app/` on every push to `main`, `master` or `claude/**`.
1. In the repository, open **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push, or run the workflow manually from the Actions tab. The URL is `https://<owner>.github.io/<repo>/`.
   GitHub Pages for a *private* repository needs a paid GitHub plan. Otherwise make the repository public or use one of the options below.

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
```

## Method in brief

1. True demand from sales orders (VBAP vs LIPS), not only goods issues.
2. One-off bulk orders capped (Q3 + 3×IQR).
3. ABC (value) × XYZ (variability) plus demand pattern (smooth / erratic / intermittent / lumpy).
4. Forecast model competition per part, scored on the last 26 weeks.
5. Actual lead time = `EKBE-BUDAT − EKKO-BEDAT`, blended with supplier history.
6. Digital twin per part: simulated demand × lead-time scenarios under candidate reorder points and under today's SAP settings.
7. Budget optimiser: marginal allocation of stock across all parts by value of demand served.
8. Backtest on the last 52 weeks of actual orders (after a 52-week warm-up), re-calibrating every 8 weeks with only past data.

*The demo figures come from generated sample data, not DOZCO records.*
