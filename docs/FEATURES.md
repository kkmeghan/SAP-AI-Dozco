# Safety Stock Studio: feature guide

This guide covers what the AI safety-stock demo does that standard SAP MRP does not. It is written for the DOZCO pilot team: business owners, planners, the SAP team and finance.

The demo runs outside SAP on read-only extracts of standard tables. SAP stays the system of record. Recommendations go back as a reviewed change file for mass maintenance (MM17); there is no automatic write-back.

"Standard MRP" below means SAP S/4HANA MRP as usually configured for trading parts: reorder-point planning (MRP types VB / VM) or consumption-based forecast planning, with safety stock held in `MARC-EISBE` or set through a range of coverage. Advanced planning add-ons (such as IBP) are out of scope for this comparison.

All figures in the demo come from generated sample data in SAP table layouts, not DOZCO records.

---

## At a glance

| # | Capability in the demo | What standard MRP does instead | Where to see it |
|---|---|---|---|
| 1 | Forecasts from **true demand**, including orders that could not be supplied | Learns from goods issues and consumption totals, so a lost sale never enters the history | Service & stockouts · Part explorer |
| 2 | Plans with **measured supplier lead times and their spread** | One planned delivery time per material or info record, with no variability | Supplier lead times · Part explorer |
| 3 | Sizes safety stock to a **fill-rate target** from forecast error *and* lead-time variability | Fixed quantity, range of coverage, or a formula on forecast error with a fixed lead time | Part explorer |
| 4 | Detects the **demand pattern** per part and runs a **model competition**, including Croston-SBA for intermittent spare-parts demand | Constant / trend / seasonal models; no intermittent-demand models | Overview · Part explorer |
| 5 | Builds a **digital twin** of each part: 10 years of simulated scenarios under ~18 reorder points | No simulation; the effect of a setting is seen only after it happens | Part explorer |
| 6 | Spends **one stock budget across all parts** where it prevents the most lost sales | Each material is planned on its own; no portfolio view of service vs total investment | Overview (operating-point curve, policy presets) |
| 7 | Sets **monsoon-aware reorder points month by month**, with the seasonal profile learned per material group | A manual reorder point is fixed; automatic reorder points rely on each part's own thin history | Working capital · Part explorer |
| 8 | Applies **service targets by sales channel** (dealership, OEM, third-party) | Safety stock has no notion of the channel behind the demand | Service & stockouts |
| 9 | **Validates the policy on history** before go-live: a day-by-day replay of 52 weeks of actual orders | No replay of past demand against proposed settings | Overview · Part explorer |
| 10 | Gives **a written reason for every number** | Parameters carry no explanation | Part explorer |
| 11 | Suggests **transfer before you buy** between plants | Plants are planned separately unless special procurement between them is configured | Action center |
| 12 | Builds a **working-capital release plan** from today's stock to the target level | Stock and aging lists exist, but none is tied to a target level per part | Working capital |
| 13 | Answers **what-if questions in seconds**: lean / balanced / high service, a budget slider, channel targets | A policy change means editing master data and waiting for the next MRP run | Top bar · Service & stockouts |
| 14 | Runs **outside SAP, read-only**, with no ABAP and no transports | Not applicable | SAP data & method |

---

## The capabilities in detail

### 1. True demand, including lost sales
**What it does.** Sales order lines (`VBAP-KWMENG`) are matched to deliveries (`LIPS-LFIMG`). Quantity that was ordered but not delivered is still counted as demand in the forecast and the safety stock.
**Why standard MRP cannot.** Consumption-based planning learns from goods issues (`MATDOC` 601/261/201) and consumption totals (`MVER`). When a part is out of stock, the lost order never becomes consumption, so the history understates demand. Low stock then produces a low forecast, which keeps stock low.
**Why it matters.** Parts that stock out most are exactly the parts whose demand MRP underestimates most.
**Data:** VBAK, VBAP, LIPS.

### 2. Measured lead times and their spread
**What it does.** Actual lead time = goods-receipt posting date (`EKBE-BUDAT`, VGABE 1) − PO date (`EKKO-BEDAT`), per supplier and part, with mean and variability. A part with few orders borrows from its supplier's pooled history. On-time delivery is measured against `EKET-EINDT`.
**Why standard MRP cannot.** MRP uses the planned delivery time (`MARC-PLIFZ` or info record `EINE-APLFZ`) as one fixed number, typed in by hand and rarely updated. Lead-time variability is not an input to safety stock.
**Why it matters.** Import suppliers with long, variable lead times need more cover than their average suggests. A planned time that is too short makes MRP reorder too late.
**Data:** EKKO, EKPO, EKET, EKBE, LFA1.

### 3. Safety stock sized to a fill-rate target
**What it does.** For each part, safety stock is the smallest amount that meets a fill-rate target: the share of ordered quantity supplied from stock. It accounts for forecast error and lead-time variability together, and for the order quantity.
**Why standard MRP cannot.** Safety stock is a fixed quantity (`EISBE`), a range of coverage (days of demand), or, in forecast-based planning, a normal-distribution formula on forecast error (MAD) with the service level and a fixed lead time. None of these adds lead-time variability or handles lumpy demand properly.
**Data:** VBAP, EKBE, MARC lot-size fields, MBEW.

### 4. Demand-pattern detection and model competition
**What it does.** Each part is classified as smooth, erratic, intermittent or lumpy (Syntetos-Boylan), plus ABC by value and XYZ by the variation of monthly demand. Five forecasting models then compete on the part's own last 26 weeks, and the most accurate wins: moving averages, exponential smoothing, damped trend, monsoon-seasonal and Croston-SBA for intermittent demand. One-off bulk orders are capped so a single project order does not inflate stock for years.
**Why standard MRP cannot.** Standard forecasting offers constant, trend and seasonal models. There is no intermittent-demand model, yet most trading spare parts sell in a few weeks a year.
**Data:** VBAP.

### 5. Digital twin per part
**What it does.** Ten years of weekly scenarios are simulated per part: demand is resampled from its own history, and lead times are drawn from its real POs. The part runs under ~18 candidate reorder points, which gives its own curve of service against stock.
**Why standard MRP cannot.** MRP has no simulation. The effect of a setting is known only after months of operation.
**Data:** VBAP, EKBE, MARC (`BSTMI`, `BSTRF`).

### 6. One stock budget, spent where it earns most
**What it does.** Using every part's curve, the optimiser allocates a working-capital budget across the whole range. Each extra rupee goes to the part where it prevents the most lost sales. The **Lean stock / Balanced / High service** presets pick points on the resulting company-wide curve.
**Why standard MRP cannot.** Each material is planned in isolation. There is no view of total service against total inventory investment, and no mechanism to move stock budget from over-covered to under-covered parts.
**Data:** all of the above, MBEW prices.

### 7. Monsoon-aware reorder points
**What it does.** The seasonal profile is learned per material group, using the monsoon dip in Jul–Sep and the post-monsoon surge. Each part gets a reorder point for each of the next 12 months, and slow movers inherit the profile of their group. The change file carries one reorder point per month.
**Why standard MRP cannot.** A manual reorder point (MRP type VB) is one value all year. Automatic reorder-point planning (VM) recalculates from the part's own forecast, but slow parts have too little history to show a season.
**Data:** VBAP / MATDOC by posting month.

### 8. Service targets by sales channel
**What it does.** Fill rate is tracked per distribution channel (`VBAK-VTWEG`). Targets agreed per channel raise a part's target according to the channel mix it serves.
**Why standard MRP cannot.** Safety stock is set per material and plant, with no link to who buys the part.
**Data:** VBAK, VBAP, LIPS.

### 9. Validated on history before go-live
**What it does.** The whole policy is replayed day by day against the last 52 weeks of actual sales orders, with lead times drawn from real POs. It re-calibrates every 8 weeks using only the data available at the time. The demo reports the resulting fill rate, average stock, shortage days and lost sales, overall and per part.
**Why standard MRP cannot.** There is no replay of past demand against proposed settings.
**In the pilot:** the same replay is the acceptance test on DOZCO's data.

### 10. A written reason for every number
**What it does.** Every recommendation carries a plain-language explanation covering:
- the part's class and demand pattern
- the winning forecast model
- the supplier's real lead time
- the seasonal range
- any one-off orders removed
- the demand lost last year
- the fill-rate target

**Why standard MRP cannot.** A planner sees a value in `EISBE` but not why it has that value.

### 11. Transfer before you buy
**What it does.** When one plant is at its reorder point and another plant holds surplus of the same material above its own maximum, the Action center proposes a stock transport order with quantity and value.
**Why standard MRP cannot.** Plants are planned separately unless special procurement keys between them are configured. Surplus elsewhere is not offered as a source.
**Data:** MARD, MARC for both plants.

### 12. Working-capital release plan
**What it does.** It walks from today's stock value through several steps to the average stock the AI policy holds:
- dead stock
- superseded parts (`MARA-MSTAE`)
- slow-moving stock
- excess above the AI maximum
- rebalancing

It also shows aging by days since the last sale, the holding-cost saving, inventory turns, and a ranked release list for Finance.
**Why standard MRP cannot.** Stock value and aging reports exist (MB52, MC.9), but none is tied to a target stock level per part, so the releasable amount is not known.
**Data:** MARD, MBEW, MATDOC, MARA.

### 13. What-if in seconds
**What it does.** Switching the policy preset, dragging the budget or changing channel targets recomputes every recommendation, chart and action in the browser.
**Why standard MRP cannot.** A policy change means editing master data, often by mass maintenance, and waiting for the next MRP run.

### 14. Outside SAP, read-only
**What it does.** Runs on CSV extracts from the partner's on-premise extractor, with a field list per table, WHERE conditions and full or incremental background jobs. There is no ABAP and there are no transports. Output is an MM17 change file for `MARC-EISBE / MINBE / MABST / PLIFZ`, plus monthly reorder points, applied after review.

---

## How to use the demo

1. **Overview:** pick a stocking policy in the top bar and read the validated fill rate and stock. The data findings sit underneath.
2. **Working capital:** see what can be released and where stock should end up.
3. **Service & stockouts:** see fill rate by channel; set channel targets and press *Apply channel targets*.
4. **Recommendations:** filter, sort, and download the change file.
5. **Part explorer:** open any part to see the full reasoning, charts and validation.
6. **Action center:** this week's list (order now, transfers, reorders, excess, dead stock, master-data fixes), exportable as CSV.
7. **SAP data & method:** tables and fields to extract, and loading your own CSV extract.
8. **Feature guide:** this list, inside the app.
