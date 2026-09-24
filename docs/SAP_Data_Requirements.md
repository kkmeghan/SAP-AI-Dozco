# AI safety stock for DOZCO: data requirements and outputs

**Use case:** set safety stock, reorder point and maximum stock for each trading material at each location from true demand, measured lead times and the season, and give buyers, planners and finance a weekly action list.

**Pilot scope:** the 500 pilot SKUs at the main branch and one warehouse, with up to 5 years of history, on the on-premise DOZCO platform. Read-only from SAP; outputs go back as a change file for mass maintenance (MM17). There is no automatic write-back.

---

## 1. What the AI adds beyond standard SAP MRP

The full explanation of each capability is in [`FEATURES.md`](FEATURES.md).

| Topic | Standard SAP MRP (reorder point planning, MRP type VB) | AI safety stock |
|---|---|---|
| Demand signal | Consumption history (goods issues). Demand lost to stockouts is invisible. | Sales order lines (VBAP) against deliveries (LIPS), so the AI sees true demand, including unfilled orders. |
| Safety stock | `MARC-EISBE`, a fixed number, usually set once as "N weeks of cover" | Recalculated every refresh from demand variability, lead-time variability and a service target per part |
| Lead time | `MARC-PLIFZ`, typed in by hand and rarely updated | Actual PO-to-goods-receipt time per supplier and part (EKKO/EKBE), including its variability |
| Seasonality | One static EISBE / MINBE all year | Monsoon dip (Jul–Sep) and post-monsoon surge learned per material group; reorder point set month by month |
| Service by channel | Not modelled | Fill rate by distribution channel (VBAK-VTWEG); agreed channel targets raise part targets |
| Irregular demand | Treated like regular demand | Demand pattern detected (smooth / erratic / intermittent / lumpy). Croston-type models and Monte Carlo simulation handle lumpy spare-parts demand |
| One-off project orders | Inflate the consumption average | Detected and capped |
| Allocation of stock | Each part is set in isolation | One inventory budget spread across all parts so that each rupee of stock goes where it prevents the most lost sales |
| Proof | None | Validation: the policy replayed on the last 52 weeks of actual orders |

## 2. Tables and fields to extract

All tables are extracted as CSV with SAP technical field names (the partner's on-premise extractor supports field lists, WHERE conditions and full or incremental background jobs, with no ABAP or transports). Dates can be `YYYYMMDD`, `YYYY-MM-DD` or `DD.MM.YYYY`.

### Master data (current snapshot, pilot materials and plants)

| Table | Fields | Why |
|---|---|---|
| **MARA** | MATNR, MTART, MATKL, MEINS, ERSDA, MFRPN, MSTAE, MSTDE | Material, material group, unit, OEM part number; cross-plant status flags superseded / obsolete parts |
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
| **MATDOC** (or MSEG + MKPF) | MBLNR, MJAHR, ZEILE, BWART, MATNR, WERKS, LGORT, MENGE, SHKZG, BUDAT, LIFNR, EBELN, KUNNR, VBELN, DMBTR | BWART 101/102, 201/202, 261/262, 601/602 (demand, receipts); 301/311, 641/642 (transfers) | Consumption, receipts, reversals, aging. Transfers are kept apart from true consumption |
| **VBAK** | VBELN, AUART, VKORG, VTWEG, KUNNR, ERDAT | Parts-sales order types | Order date and channel (3P / OEM / dealership) |
| **VBAP** | VBELN, POSNR, MATNR, WERKS, KWMENG, VRKME, NETWR, ABGRU | Pilot materials | **True customer demand**, including rejected or unfilled lines |
| **LIPS** | VBELN, POSNR, VGBEL, VGPOS, MATNR, WERKS, LFIMG, WADAT_IST | Pilot materials | Delivered quantity, which gives fill rate and stockout incidents |
| **EKKO** | EBELN, BSART, LIFNR, BEDAT, EKORG, EKGRP | BEDAT in history window | PO date and supplier |
| **EKPO** | EBELN, EBELP, MATNR, WERKS, LGORT, MENGE, MEINS, NETPR, PEINH, ELIKZ | Pilot materials | Ordered quantity and open POs |
| EKET | EBELN, EBELP, ETENR, EINDT, MENGE, WEMNG | | Promised date, used for supplier on-time rate |
| VBEP | VBELN, POSNR, ETENR, EDATU, WMENG, BMENG | Pilot materials | Requested vs confirmed quantity and date (service against what the customer asked for) |
| EINE / EINA | INFNR, MATNR, LIFNR, EKORG, WERKS, APLFZ, NETPR | | Vendor-specific planned delivery time, a second baseline besides PLIFZ |
| **EKBE** | EBELN, EBELP, VGABE, BWART, BUDAT, MENGE, BELNR | VGABE = 1 | Goods-receipt date. **Actual lead time = EKBE-BUDAT − EKKO-BEDAT** |

Tables in **bold** are required to run the model. The rest improve explanations and reporting.

Optional later: `MCHB`/`MCH1` (batch aging), `T001L` (storage locations), `EORD` (source list), `RESB`/`AUFK` (workshop reservations as demand), `MVER` (SAP period consumption, for reconciliation).

**Non-SAP branch records that improve the result:** counter lost-sales logs (demand never keyed into SAP), supersession cross-reference lists, branch Excel reorder sheets, stock-take sheets.

**Refresh:** daily incremental by BUDAT / ERDAT / AEDAT, as a background job after office hours.

## 3. What the AI calculates per material and plant

1. **True demand**: weekly demand from sales orders; delivered and not-supplied quantities kept separately.
2. **Cleansing**: one-off bulk orders beyond Q3 + 3×IQR are capped.
3. **Segmentation**: ABC by sales value; XYZ by coefficient of variation of monthly demand (X < 0.2, Y 0.2–0.5, Z > 0.5); demand pattern (Syntetos-Boylan). Superseded parts (MARA-MSTAE) hold no safety stock.
4. **Forecast**: model competition per part (13- and 52-week moving average, exponential smoothing, damped trend, monsoon-seasonal, Croston-SBA), scored on the last 26 weeks. Reorder points are set month by month from the seasonal profile.
5. **Lead time**: actual mean and variability per part, blended with the supplier's pooled history when a part has few POs. Compared with `PLIFZ`.
6. **Digital twin**: 10 years of simulated weekly demand and lead-time scenarios per part, run under about 18 candidate reorder points.
7. **Optimisation**: an inventory budget is allocated across all parts by marginal value of served demand. Alternatively, service targets are set per ABC/XYZ class and raised to the part's channel-weighted target (third-party / OEM / dealership).
8. **Order quantity**: economic order quantity respecting `BSTMI` / `BSTRF`.
9. **Validation**: the AI policy is replayed on the last 52 weeks of actual orders, re-calibrated every 8 weeks using only data available at that time.

## 4. Results shown to users

| Output | For | Content |
|---|---|---|
| Overview | Management | Validated fill rate and stock, data findings (lost demand, lead-time gaps, monsoon, where lost sales concentrate), operating-point curve |
| Working capital | Finance | Stock today → release (dead, superseded, slow, excess) → AI steady state; holding-cost saving; turns; aging; seasonal reorder levels |
| Service & stockouts | Sales, MM/SCM head | Fill rate by channel and trend, lost sales by group and part, channel service targets |
| Recommendations | MM / SCM head, planners | Per material × plant: EISBE, MINBE, MABST, PLIFZ today → recommended, with value impact and fill target |
| Part detail | Planners, purchase | Plain-language explanation, demand history with stockouts, actual lead times vs plan, lead-time demand distribution, seasonal reorder calendar, per-part validation |
| Action center | Purchase, branch managers, warehouse | Order now (stockout risk), stock transfers between plants, reorders, excess to pause, dead and slow-moving stock, master-data corrections |
| Lead times | Purchase | Supplier scorecard: planned vs actual lead time, variability, on-time rate |
| SAP change file | SAP team | CSV for MM17 mass change of `MARC-EISBE / MINBE / MABST / PLIFZ`, plus a reorder point per month |

## 5. Expert review: what was adopted

The business-side SAP table mapping (18 Sep 2026) was reviewed for this use case.

**Adopted:** monsoon seasonality from posting months; service levels per sales channel (VBAK-VTWEG); XYZ on monthly CV with the 0.2 / 0.5 thresholds; actual lead time = GR posting date − PO date against PLIFZ, with EKET-EINDT for on-time delivery; stock transfers (301/311) excluded from consumption; superseded parts via MARA-MSTAE; a working-capital release view (ΔSS × price, holding cost, aging by days since last issue).

**Optional inputs in the pilot:** VBEP-BMENG, EINE-APLFZ, MVER, T001L, MCHB, and the non-SAP branch records listed above.

**Not needed for safety stock:** pricing conditions (A017/A018/KONP, PRCD_ELEMENTS), vendor company-code and contact data (LFB1/LFM1), SOP transactions (MC84/MC87).

## 6. Results on the sample data (demo)

The demo runs on generated data in SAP layouts (500 materials, 2 plants, 2 years, with a monsoon dip), not on DOZCO records. At the **Balanced** setting, validated on the last 52 weeks of orders:

- **90% fill rate** (share of ordered value supplied from stock) with about **₹19 Cr of average stock**, about 5 turns a year.
- About **₹5.7 Cr** of today's stock is dead, superseded, slow-moving or above the AI maximum.
- About 350 part-plants have a planned delivery time (`PLIFZ`) that suppliers do not meet; about 160 parts cause 80% of lost sales.

Real results depend on DOZCO's data. The pilot will validate them the same way.
