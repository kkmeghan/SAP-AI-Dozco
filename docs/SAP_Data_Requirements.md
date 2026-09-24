# AI safety stock for DOZCO: data requirements and outputs

**Use case:** set safety stock, reorder point and maximum stock for each trading material at each location, better than static SAP MRP settings, and give buyers, planners and finance a weekly action list.

**Pilot scope:** the 500 pilot SKUs at the main branch and one warehouse, with up to 5 years of history, on the on-premise DOZCO platform. Read-only from SAP; outputs go back as a change file for mass maintenance (MM17). There is no automatic write-back.

---

## 1. Why this beats standard SAP MRP

| Topic | Standard SAP MRP (reorder point planning, MRP type VB) | AI safety stock |
|---|---|---|
| Demand signal | Consumption history (goods issues). Demand lost to stockouts is invisible. | Sales order lines (VBAP) against deliveries (LIPS), so the AI sees true demand, including unfilled orders. |
| Safety stock | `MARC-EISBE`, a fixed number, usually set once as "N weeks of cover" | Recalculated every refresh from demand variability, lead-time variability and a service target per part |
| Lead time | `MARC-PLIFZ`, typed in by hand and rarely updated | Actual PO-to-goods-receipt time per supplier and part (EKKO/EKBE), including its variability |
| Irregular demand | Treated like regular demand | Demand pattern detected (smooth / erratic / intermittent / lumpy). Croston-type models and Monte Carlo simulation handle lumpy spare-parts demand |
| One-off project orders | Inflate the consumption average | Detected and capped |
| Allocation of stock | Each part is set in isolation | One inventory budget spread across all parts so that each rupee of stock goes where it prevents the most lost sales |
| Proof | None | Backtest: both policies replayed on the last 52 weeks of actual orders |

## 2. Tables and fields to extract

All tables are extracted as CSV with SAP technical field names (the partner's on-premise extractor supports field lists, WHERE conditions and full or incremental background jobs, with no ABAP or transports). Dates can be `YYYYMMDD`, `YYYY-MM-DD` or `DD.MM.YYYY`.

### Master data (current snapshot, pilot materials and plants)

| Table | Fields | Why |
|---|---|---|
| **MARA** | MATNR, MTART, MATKL, MEINS, ERSDA, MFRPN | Material, material group (category), unit, OEM part number |
| MAKT | MATNR, SPRAS, MAKTX | Description |
| **MARC** | MATNR, WERKS, DISMM, DISPO, EKGRP, PLIFZ, WEBAZ, EISBE, MINBE, DISLS, MABST, BSTMI, BSTRF, MAABC | Today's SAP policy, which is the baseline to beat, plus lot-size rules |
| **MARD** | MATNR, WERKS, LGORT, LABST, INSME, SPEME | Stock on hand by storage location |
| **MBEW** | MATNR, BWKEY, VPRSV, VERPR, STPRS, PEINH, LBKUM, SALK3 | Unit cost and stock value (working capital) |
| LFA1 | LIFNR, NAME1, LAND1, ORT01, KTOKK | Supplier name, domestic or import |
| KNA1 | KUNNR, NAME1, ORT01, KTOKD | Customer segmentation (optional) |
| T001W | WERKS, NAME1, ORT01 | Plant names |

### Transactions (history: minimum 2 years, ideally 5)

| Table | Fields | Suggested selection | Why |
|---|---|---|---|
| **MATDOC** (or MSEG + MKPF) | MBLNR, MJAHR, ZEILE, BWART, MATNR, WERKS, LGORT, MENGE, SHKZG, BUDAT, LIFNR, EBELN, KUNNR, VBELN, DMBTR | BWART in 101, 102, 201, 202, 261, 262, 601, 602, 641, 642 | Consumption, receipts, reversals, last movement date (aging) |
| **VBAK** | VBELN, AUART, VKORG, VTWEG, KUNNR, ERDAT | Parts-sales order types | Order date and channel (3P / OEM / dealership) |
| **VBAP** | VBELN, POSNR, MATNR, WERKS, KWMENG, VRKME, NETWR, ABGRU | Pilot materials | **True customer demand**, including rejected or unfilled lines |
| **LIPS** | VBELN, POSNR, VGBEL, VGPOS, MATNR, WERKS, LFIMG, WADAT_IST | Pilot materials | Delivered quantity, which gives fill rate and stockout incidents |
| **EKKO** | EBELN, BSART, LIFNR, BEDAT, EKORG, EKGRP | BEDAT in history window | PO date and supplier |
| **EKPO** | EBELN, EBELP, MATNR, WERKS, LGORT, MENGE, MEINS, NETPR, PEINH, ELIKZ | Pilot materials | Ordered quantity and open POs |
| EKET | EBELN, EBELP, ETENR, EINDT, MENGE, WEMNG | | Promised date, used for supplier on-time rate |
| **EKBE** | EBELN, EBELP, VGABE, BWART, BUDAT, MENGE, BELNR | VGABE = 1 | Goods-receipt date. **Actual lead time = EKBE-BUDAT − EKKO-BEDAT** |

Tables in **bold** are required to run the model. The rest improve explanations and reporting.

Optional later: `MCHB`/`MCH1` (batch aging), `EORD`/`EINA`/`EINE` (source list and info-record lead times), `RESB`/`AUFK` (workshop reservations as demand), `MVER` (SAP consumption totals for reconciliation).

**Refresh:** daily incremental by BUDAT / ERDAT / AEDAT, as a background job after office hours.

## 3. What the AI calculates per material and plant

1. **True demand**: weekly demand from sales orders; delivered and not-supplied quantities kept separately.
2. **Cleansing**: one-off bulk orders beyond Q3 + 3×IQR are capped.
3. **Segmentation**: ABC by sales value, XYZ by weekly variability, demand pattern (Syntetos-Boylan).
4. **Forecast**: model competition per part (13- and 52-week moving average, exponential smoothing, damped trend, seasonal, Croston-SBA), scored on the last 26 weeks.
5. **Lead time**: actual mean and variability per part, blended with the supplier's pooled history when a part has few POs. Compared with `PLIFZ`.
6. **Digital twin**: 10 years of simulated weekly demand and lead-time scenarios per part, run under about 18 candidate reorder points and under today's SAP settings.
7. **Optimisation**: an inventory budget is allocated across all parts by marginal value of served demand. Alternatively, service targets are set per ABC/XYZ class.
8. **Order quantity**: economic order quantity respecting `BSTMI` / `BSTRF`.
9. **Backtest**: SAP settings and the AI policy are replayed on the last 52 weeks of actual orders, with the AI re-calibrated every 8 weeks using only data available at that time.

## 4. Results shown to users

| Output | For | Content |
|---|---|---|
| Overview | Management, finance | Fill rate and average stock, SAP vs AI (backtest); service-vs-capital curve; working capital releasable; sales lost to stockouts |
| Recommendations | MM / SCM head, planners | Per material × plant: EISBE, MINBE, MABST, PLIFZ today → recommended, with value impact and fill target |
| Part detail | Planners, purchase | Plain-language explanation, demand history with stockouts, actual lead times vs plan, lead-time demand distribution, per-part backtest |
| Action center | Purchase, branch managers, warehouse | Order now (stockout risk), stock transfers between plants, reorders, excess to pause, dead and slow-moving stock, master-data corrections |
| Lead times | Purchase | Supplier scorecard: planned vs actual lead time, variability, on-time rate |
| SAP change file | SAP team | CSV for MM17 mass change of `MARC-EISBE / MINBE / MABST / PLIFZ` |

## 5. Results on the sample data (demo)

The demo runs on generated data in SAP layouts (500 materials, 2 plants, 2 years), not on DOZCO records. On that data:

- **Same fill rate as SAP (86.8%)** needs about ₹15.7 Cr of average stock instead of ₹17.1 Cr, roughly 8% less working capital.
- **Same stock as SAP** lifts fill rate to about 88.4%.
- ₹4.9 Cr of stock today sits above the AI maximum or is dead; about 340 part-plants have a `PLIFZ` that suppliers do not meet.

Real results depend on DOZCO's data. The pilot's backtest will measure them the same way.
