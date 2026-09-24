/*
 * Safety-stock intelligence engine.
 *
 * Input: SAP tables (MARA, MAKT, MARC, MARD, MBEW, MATDOC, EKKO, EKPO, EKET,
 * EKBE, VBAK, VBAP, LIPS, LFA1, T001W). Output: per material x plant
 * recommendations, explanations, actions and a backtest against the current
 * SAP MRP settings.
 *
 * Steps per material x plant
 *   1. True demand from sales orders (VBAP), not only consumption (MATDOC),
 *      so demand lost to stockouts is not forgotten.
 *   2. Outlier cleansing (one-off bulk / project orders).
 *   3. Segmentation: ABC (value), XYZ (variability), demand pattern
 *      (smooth / erratic / intermittent / lumpy, Syntetos-Boylan).
 *   4. Forecast model competition (moving average, exponential smoothing,
 *      damped trend, Croston-SBA, seasonal) scored on a rolling holdout.
 *   5. Actual supplier lead time from PO date to goods receipt (EKKO/EKBE),
 *      blended with the supplier's pooled history when a part has few POs.
 *   6. Safety stock sized for a service-level target per ABC/XYZ class:
 *      closed form for regular demand, Monte Carlo lead-time demand
 *      simulation for intermittent and lumpy demand.
 *   7. Reorder point, economic order quantity, max stock; actions.
 */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const WEEKS = 104;
  const PERIOD = 28; // 4-week "month" buckets for trends and XYZ
  // cross-plant material status values treated as superseded / blocked for procurement
  const OBSOLETE_STATUS = new Set(['Z1', 'Z2', 'OB', '99']);
  const CHANNEL_NAMES = { '10': 'Third-party distribution', '20': 'OEM', '30': 'Dealership & spare-parts trading' };

  // SAP DATS (YYYYMMDD); also accepts YYYY-MM-DD and DD.MM.YYYY
  function parseDats(s) {
    s = String(s);
    if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) return Date.UTC(+s.slice(6, 10), +s.slice(3, 5) - 1, +s.slice(0, 2));
    s = s.replace(/[^0-9]/g, '');
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // Acklam's inverse normal CDF
  function zOf(p) {
    if (p <= 0) return -8; if (p >= 1) return 8;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // standard normal loss function G(k) = phi(k) - k (1 - Phi(k)); solve G(k) = g
  const phi = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const y = 1 - phi(x) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? y : 1 - y; };
  const G = (k) => phi(k) - k * (1 - Phi(k));
  function solveLoss(g) { if (g >= G(0)) return 0; let lo = 0, hi = 6; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (G(m) > g) lo = m; else hi = m; } return hi; }

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
  const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const quantile = (sorted, p) => { if (!sorted.length) return 0; const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1)); return sorted[i]; };
  const roundTo = (q, r) => (r > 1 ? Math.ceil(q / r - 1e-9) * r : Math.ceil(q - 1e-9));

  // fill-rate targets (share of ordered quantity supplied from stock)
  const DEFAULT_SERVICE = {
    AX: 0.99, AY: 0.98, AZ: 0.97,
    BX: 0.98, BY: 0.97, BZ: 0.95,
    CX: 0.96, CY: 0.95, CZ: 0.92,
  };
  // fill-rate targets agreed per sales channel (VBAK-VTWEG)
  const DEFAULT_CHANNEL = { '10': 0.92, '20': 0.97, '30': 0.95 };
  // class target, raised to the part's channel-weighted target when that is higher
  function classChannelTarget(s, c, cfg) {
    if (c.dead) return 0;
    const t = cfg.service[c.abc + c.xyz] || 0.95;
    const ct = cfg.channelTargets; if (!ct) return t;
    let w = 0, acc = 0; for (const k in s.channel) { const v = s.channel[k]; if (v > 0 && ct[k] != null) { w += v; acc += v * ct[k]; } }
    return w > 0 ? Math.max(t, acc / w) : t;
  }
  const DEFAULTS = { holdingRate: 0.22, orderCostDomestic: 1500, orderCostImport: 6000, sims: 520, recalSims: 260, recalEvery: 8, mode: 'budget', service: DEFAULT_SERVICE };

  // ------------------------------------------------------------------
  // 1. Index the SAP tables
  // ------------------------------------------------------------------
  function prepare(T) {
    const num = (v) => (v === '' || v == null ? 0 : +v);
    // history window: last complete 104 weeks ending at the last sales/material-document date
    let maxDay = 0;
    for (const r of T.VBAK) { const t = parseDats(r.ERDAT); if (t > maxDay) maxDay = t; }
    for (const r of T.MATDOC) { const t = parseDats(r.BUDAT); if (t > maxDay) maxDay = t; }
    const end = maxDay + DAY_MS; // exclusive
    const start = end - WEEKS * 7 * DAY_MS;
    const days = WEEKS * 7;
    const dayIdx = (s) => Math.floor((parseDats(s) - start) / DAY_MS);

    const plants = {}; for (const p of T.T001W) plants[p.WERKS] = p.NAME1;
    const suppliers = {}; for (const s of T.LFA1) suppliers[s.LIFNR] = { LIFNR: s.LIFNR, NAME1: s.NAME1, LAND1: s.LAND1, ORT01: s.ORT01, import: s.LAND1 !== 'IN' };
    const mats = {};
    for (const m of T.MARA) mats[m.MATNR] = { MATNR: m.MATNR, MATKL: m.MATKL, MEINS: m.MEINS, MFRPN: m.MFRPN || '', MAKTX: m.MATNR, MSTAE: m.MSTAE || '', obsolete: OBSOLETE_STATUS.has(String(m.MSTAE || '').toUpperCase()) };
    for (const m of T.MAKT) if (mats[m.MATNR] && (!m.SPRAS || m.SPRAS === 'E' || m.SPRAS === 'EN')) mats[m.MATNR].MAKTX = m.MAKTX;

    const skus = {}; const list = [];
    for (const c of T.MARC) {
      const key = c.MATNR + '|' + c.WERKS;
      const s = {
        key, MATNR: c.MATNR, WERKS: c.WERKS, mat: mats[c.MATNR] || { MATNR: c.MATNR, MAKTX: c.MATNR, MATKL: '', MEINS: 'EA' },
        marc: { DISMM: c.DISMM, PLIFZ: num(c.PLIFZ), WEBAZ: num(c.WEBAZ), EISBE: num(c.EISBE), MINBE: num(c.MINBE), MABST: num(c.MABST), BSTMI: num(c.BSTMI), BSTRF: num(c.BSTRF), DISLS: c.DISLS, DISPO: c.DISPO },
        stock: 0, price: 0,
        demandDay: new Float64Array(days), deliveredDay: new Float64Array(days), consDay: new Float64Array(days), rcptDay: new Float64Array(days),
        orderLines: 0, lostLines: 0, channel: { '10': 0, '20': 0, '30': 0 }, chReq: {}, chDel: {},
        pos: [], lastIssue: -1, lastReceipt: -1,
      };
      skus[key] = s; list.push(s);
    }
    for (const r of T.MARD) { const s = skus[r.MATNR + '|' + r.WERKS]; if (s) s.stock += num(r.LABST); }
    for (const r of T.MBEW) { const s = skus[r.MATNR + '|' + r.BWKEY]; if (s) s.price = r.VPRSV === 'S' ? num(r.STPRS) / (num(r.PEINH) || 1) : num(r.VERPR) / (num(r.PEINH) || 1); }

    // sales demand (VBAP) with order date & channel from VBAK
    const vbak = new Map(); for (const h of T.VBAK) vbak.set(h.VBELN, h);
    const vbapByKey = new Map();
    for (const p of T.VBAP) {
      const s = skus[p.MATNR + '|' + p.WERKS]; if (!s) continue;
      const h = vbak.get(p.VBELN); if (!h) continue;
      const d = dayIdx(h.ERDAT); if (d < 0 || d >= days) continue;
      const q = num(p.KWMENG);
      s.demandDay[d] += q; s.orderLines++;
      s.channel[h.VTWEG] = (s.channel[h.VTWEG] || 0) + q;
      vbapByKey.set(p.VBELN + '|' + (+p.POSNR), { s, q, d, ch: String(h.VTWEG || '') });
    }
    const delivered = new Map();
    for (const l of T.LIPS) { const k = l.VGBEL + '|' + (+l.VGPOS); delivered.set(k, (delivered.get(k) || 0) + num(l.LGMNG != null && l.LGMNG !== '' ? l.LGMNG : l.LFIMG)); }
    const nPer = Math.ceil(days / PERIOD);
    for (const [k, v] of vbapByKey) {
      const got = Math.min(delivered.get(k) || 0, v.q);
      v.s.deliveredDay[v.d] += got; if (got < v.q) v.s.lostLines++;
      const R = v.s.chReq[v.ch] || (v.s.chReq[v.ch] = new Float64Array(nPer)), Dl = v.s.chDel[v.ch] || (v.s.chDel[v.ch] = new Float64Array(nPer));
      const per = Math.floor(v.d / PERIOD); R[per] += v.q; Dl[per] += got;
    }

    // material documents: consumption, receipts, last movements
    const CONS = { '601': 1, '261': 1, '201': 1, '602': -1, '262': -1, '202': -1 };
    const RCPT = { '101': 1, '102': -1 };
    for (const r of T.MATDOC) {
      const s = skus[r.MATNR + '|' + r.WERKS]; if (!s) continue;
      const d = dayIdx(r.BUDAT); if (d < 0 || d >= days) continue;
      const q = num(r.MENGE);
      if (CONS[r.BWART]) { s.consDay[d] += CONS[r.BWART] * q; if (CONS[r.BWART] > 0 && d > s.lastIssue) s.lastIssue = d; }
      else if (RCPT[r.BWART]) { s.rcptDay[d] += RCPT[r.BWART] * q; if (RCPT[r.BWART] > 0 && d > s.lastReceipt) s.lastReceipt = d; }
    }

    // purchasing: lead times, open POs, supplier per sku
    const ekko = new Map(); for (const h of T.EKKO) ekko.set(h.EBELN, h);
    const eket = new Map(); for (const e of T.EKET) { const k = e.EBELN + '|' + (+e.EBELP); if (!eket.has(k)) eket.set(k, e); }
    const gr = new Map();
    for (const b of T.EKBE) {
      if (String(b.VGABE) !== '1' || b.BWART !== '101') continue;
      const k = b.EBELN + '|' + (+b.EBELP);
      const g = gr.get(k) || { first: null, qty: 0 };
      const d = parseDats(b.BUDAT); if (g.first === null || d < g.first) g.first = d; g.qty += num(b.MENGE);
      gr.set(k, g);
    }
    const supPool = {};
    for (const p of T.EKPO) {
      const s = skus[p.MATNR + '|' + p.WERKS]; if (!s) continue;
      const h = ekko.get(p.EBELN); if (!h) continue;
      const k = p.EBELN + '|' + (+p.EBELP);
      const g = gr.get(k); const e = eket.get(k);
      const po = { EBELN: p.EBELN, LIFNR: h.LIFNR, bedat: parseDats(h.BEDAT), eindt: e ? parseDats(e.EINDT) : null, qty: num(p.MENGE), gr: g ? g.first : null, grQty: g ? g.qty : 0, closed: p.ELIKZ === 'X' };
      po.bedIdx = Math.floor((po.bedat - start) / DAY_MS);
      po.grIdx = po.gr != null ? Math.floor((po.gr - start) / DAY_MS) : null;
      po.lt = po.gr != null ? Math.round((po.gr - po.bedat) / DAY_MS) : null;
      po.late = po.gr != null && po.eindt != null ? Math.round((po.gr - po.eindt) / DAY_MS) : null;
      po.open = !po.closed && po.grQty < po.qty;
      s.pos.push(po);
      if (po.lt != null) { (supPool[h.LIFNR] = supPool[h.LIFNR] || []).push(po.lt); }
    }
    for (const s of list) {
      s.pos.sort((a, b) => a.bedat - b.bedat);
      const last = s.pos[s.pos.length - 1];
      s.LIFNR = last ? last.LIFNR : '';
      s.supplier = suppliers[s.LIFNR] || { NAME1: 'Unknown supplier', LAND1: '', import: false, LIFNR: '' };
      s.openQty = s.pos.filter(p => p.open).reduce((a, p) => a + p.qty - p.grQty, 0);
      s.nextArrival = s.pos.filter(p => p.open).reduce((m, p) => Math.min(m, p.eindt || Infinity), Infinity);
    }
    return { skus: list, byKey: skus, mats, plants, suppliers, supPool, start, end, days, weeks: WEEKS };
  }

  const weekly = (daily, fromDay, toDay) => {
    const out = [];
    for (let d = fromDay; d + 7 <= toDay; d += 7) { let s = 0; for (let i = 0; i < 7; i++) s += daily[d + i]; out.push(s); }
    return out;
  };

  // ------------------------------------------------------------------
  // 2-4. Demand cleansing, classification, forecasting
  // ------------------------------------------------------------------
  function cleanse(w) {
    const nz = w.filter(x => x > 0);
    const out = w.slice(); const flags = [];
    if (nz.length < 6) return { series: out, flags };
    const s = nz.slice().sort((a, b) => a - b);
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), med = median(nz);
    const cap = Math.max(q3 + 3 * (q3 - q1), med * 4, 2);
    for (let i = 0; i < w.length; i++) if (w[i] > cap && w[i] > 3 * mean(w)) { flags.push({ week: i, value: w[i], cap: Math.round(cap) }); out[i] = cap; }
    return { series: out, flags };
  }

  function classifyPattern(w) {
    const nz = w.filter(x => x > 0);
    if (nz.length === 0) return { pattern: 'none', adi: Infinity, cv2: 0 };
    const adi = w.length / nz.length;
    const m = mean(nz); const cv2 = nz.length > 1 ? Math.pow(sd(nz) / m, 2) : 0;
    const pattern = adi < 1.32 ? (cv2 < 0.49 ? 'smooth' : 'erratic') : (cv2 < 0.49 ? 'intermittent' : 'lumpy');
    return { pattern, adi, cv2 };
  }

  // one-step-ahead forecasters; each returns the forecast array f[t] made at t-1
  const METHODS = {
    'Moving average (13 wk)': (w) => movingAvg(w, 13),
    'Moving average (52 wk)': (w) => movingAvg(w, 52),
    'Exponential smoothing': (w) => { const a = 0.15; let l = mean(w.slice(0, 8)); return w.map((x) => { const f = l; l = a * x + (1 - a) * l; return f; }); },
    'Damped trend (Holt)': (w) => { const a = 0.2, b = 0.08, phi = 0.9; let l = mean(w.slice(0, 8)), tr = 0; return w.map((x) => { const f = Math.max(0, l + phi * tr); const pl = l; l = a * x + (1 - a) * (l + phi * tr); tr = b * (l - pl) + (1 - b) * phi * tr; return f; }); },
    'Croston-SBA (intermittent)': (w) => { const a = 0.1; const nz = w.filter(x => x > 0); let z = nz.length ? nz[0] : 0, p = nz.length ? w.length / nz.length : 1, q = 1; return w.map((x) => { const f = (1 - a / 2) * z / p; if (x > 0) { z = a * x + (1 - a) * z; p = a * q + (1 - a) * p; q = 1; } else q++; return f; }); },
  };

  function movingAvg(w, n) {
    const f = new Array(w.length); let sum = 0;
    for (let t = 0; t < w.length; t++) {
      f[t] = t === 0 ? w[0] : sum / Math.min(t, n);
      sum += w[t]; if (t >= n) sum -= w[t - n];
    }
    return f;
  }

  const REGULAR = ['Moving average (13 wk)', 'Moving average (52 wk)', 'Exponential smoothing', 'Damped trend (Holt)'];
  const SPARSE = ['Moving average (52 wk)', 'Croston-SBA (intermittent)'];

  function forecast(w, seasonIdx, pattern) {
    // seasonIdx: array aligned with w (multiplier per week) or null
    const H = Math.min(26, Math.floor(w.length / 3));
    let best = null;
    const tried = [];
    const evalMethod = (name, fn, deseason) => {
      const base = deseason ? w.map((x, i) => x / seasonIdx[i]) : w;
      let f = fn(base);
      if (deseason) f = f.map((x, i) => x * seasonIdx[i]);
      let ae = 0, se = 0, bias = 0;
      for (let t = w.length - H; t < w.length; t++) { const e = w[t] - f[t]; ae += Math.abs(e); se += e * e; bias += e; }
      // next-period level
      const next = deseason ? fn(base.concat([0])).pop() : fn(w.concat([0])).pop();
      const r = { name: deseason ? name + ' + seasonality' : name, mae: ae / H, rmse: Math.sqrt(se / H), bias: bias / H, level: Math.max(0, next), fitted: f, deseason };
      tried.push(r);
      if (!best || r.rmse < best.rmse - 1e-9) best = r;
    };
    const sparse = pattern === 'intermittent' || pattern === 'lumpy';
    for (const k of sparse ? SPARSE : REGULAR) evalMethod(k, METHODS[k], false);
    if (seasonIdx && !sparse) { evalMethod('Exponential smoothing', METHODS['Exponential smoothing'], true); }
    tried.sort((a, b) => a.rmse - b.rmse);
    return { best, tried };
  }

  function seasonalIndices(prep) {
    // pooled by material group: monthly index from aggregated demand, shrunk 50% towards 1
    const byCat = {};
    const monthOfWeek = [];
    for (let i = 0; i < prep.weeks; i++) monthOfWeek.push(new Date(prep.start + (i * 7 + 3) * DAY_MS).getUTCMonth());
    for (const s of prep.skus) {
      const k = s.mat.MATKL; const w = weekly(s.demandDay, 0, prep.days);
      const agg = byCat[k] || (byCat[k] = { tot: new Float64Array(12), n: new Float64Array(12), val: 0 });
      const m = mean(w) || 1;
      w.forEach((x, i) => { agg.tot[monthOfWeek[i]] += x / m; agg.n[monthOfWeek[i]]++; });
    }
    const out = {};
    for (const k in byCat) {
      const a = byCat[k]; const raw = []; for (let m = 0; m < 12; m++) raw.push(a.n[m] ? a.tot[m] / a.n[m] : 1);
      const avg = mean(raw) || 1;
      const idx = raw.map(x => 1 + 0.5 * (x / avg - 1));
      const amp = Math.max(...idx) - Math.min(...idx);
      out[k] = { idx, amp };
    }
    return { byCat: out, monthOfWeek };
  }

  // ------------------------------------------------------------------
  // 5. Lead time
  // ------------------------------------------------------------------
  function leadTime(s, prep, uptoDay) {
    const obs = s.pos.filter(p => p.lt != null && (uptoDay == null || p.grIdx < uptoDay)).map(p => p.lt);
    const late = s.pos.filter(p => p.late != null && (uptoDay == null || p.grIdx < uptoDay)).map(p => p.late);
    const pool = (prep.supPool[s.LIFNR] || []);
    const pm = mean(pool) || s.marc.PLIFZ || 14, psd = sd(pool) || pm * 0.25;
    const n = obs.length, k = 3;
    const m = n ? (n * mean(obs) + k * pm) / (n + k) : pm;
    const sdv = n > 1 ? Math.sqrt((n * Math.pow(sd(obs), 2) + k * psd * psd) / (n + k)) : psd;
    const onTime = late.length ? late.filter(x => x <= 2).length / late.length : null;
    return { mean: m, sd: sdv, n, obs: obs.length ? obs : pool.slice(-30), onTime, planned: s.marc.PLIFZ, avgLate: late.length ? mean(late) : null };
  }

  // ------------------------------------------------------------------
  // 6-7. Policy for one sku given its history window.
  // Returns the forecast, lead time, order quantity and a service curve:
  // simulated fill rate and average stock for each candidate reorder point.
  // ------------------------------------------------------------------

  function policy(s, ctx, cfg, uptoWeek, sims, cls) {
    const wAll = weekly(s.demandDay, 0, uptoWeek * 7);
    const recent = wAll.slice(-52);
    const clean = cleanse(wAll);
    const recentClean = clean.series.slice(-52);
    const pat = classifyPattern(recentClean);
    const lt = leadTime(s, ctx.prep, uptoWeek * 7);
    const L = (lt.mean + s.marc.WEBAZ) / 7, sL = lt.sd / 7;
    const S = s.supplier.import ? cfg.orderCostImport : cfg.orderCostDomestic;
    const price = s.price || 1;
    const empty = { pattern: pat, lt, L, fc: null, d: 0, sigma: 0, q: 0, clean, ltd: null, recent, curve: [{ R: 0, rop: 0, ss: 0, fill: 1, onHand: 0, inv: 0 }], sapTwin: { fill: 1, inv: 0 }, stop: true };
    if (pat.pattern === 'none' || cls.dead) return Object.assign(empty, { method: 'No demand in the last 52 weeks: do not replenish' });
    if (cls.obsolete) return Object.assign(empty, { method: 'Superseded / blocked in SAP (MARA-MSTAE): do not replenish' });
    if (cls.slow) return Object.assign(empty, { method: 'No demand in the last 26 weeks: order only against a customer order' });

    const cat = ctx.season.byCat[s.mat.MATKL];
    const useSeason = cat && cat.amp > 0.15;
    const sIdx = useSeason ? ctx.season.monthOfWeek.slice(0, clean.series.length).map(m => cat.idx[m]) : null;
    const fc = forecast(clean.series, sIdx, pat.pattern);
    let d = fc.best.level;
    // seasonal factor averaged over a lead-time window starting in calendar month m
    const nowM = ctx.season.monthOfWeek[(uptoWeek - 1) % ctx.season.monthOfWeek.length];
    const nL = Math.max(1, Math.ceil(L));
    const windowF = (m) => { let acc = 0; for (let i = 1; i <= nL; i++) acc += cat.idx[(m + Math.floor((i * 7) / 30)) % 12]; return acc / nL; };
    let season = null;
    if (useSeason) {
      const fNow = windowF(nowM);
      let dBase;
      if (fc.best.deseason) { dBase = d; d = dBase * fNow; }
      else { let fr = 0; for (let i = 1; i <= 13; i++) fr += cat.idx[ctx.season.monthOfWeek[Math.max(0, uptoWeek - i)]]; dBase = d / (fr / 13); }
      season = { dBase, fNow, nowM, factors: Array.from({ length: 12 }, (_, m) => windowF(m)), idx: cat.idx };
    }
    const sigma = Math.max(fc.best.rmse, 0.25 * sd(recentClean));
    // order quantity first: a fill-rate target is met per replenishment cycle of Q units
    const D = d * 52;
    const h = cfg.holdingRate * price;
    let q = D > 0 ? Math.sqrt((2 * D * S) / h) : 0;
    q = Math.min(Math.max(q, d * 1), Math.max(d * 26, 1));
    q = Math.max(s.marc.BSTMI || 1, roundTo(q, s.marc.BSTRF || 1));

    const sLTD = Math.sqrt(L * sigma * sigma + d * d * sL * sL);

    // ---- digital twin: simulate this part under candidate reorder points ----
    // Weekly demand is bootstrapped from the last 52 cleansed weeks (rescaled to
    // the forecast level); lead times are drawn from the part's actual PO history.
    // Every candidate sees the same scenario (common random numbers).
    const rnd = mulberry32(hash(s.key));
    const hist = recentClean; const hm = mean(hist) || 1; const scale = d / hm;
    const ltObs = lt.obs.length >= 4 ? lt.obs : null;
    const drawLt = () => (ltObs ? ltObs[Math.floor(rnd() * ltObs.length)] + (rnd() - 0.5) * 2 : Math.max(1, lt.mean + lt.sd * (Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())))) + s.marc.WEBAZ;
    const W = sims;
    const dem = new Float64Array(W), ltw = new Int32Array(W);
    for (let i = 0; i < W; i++) { dem[i] = hist[Math.floor(rnd() * hist.length)] * scale; ltw[i] = Math.max(1, Math.round(drawLt() / 7)); }
    // lead-time demand distribution (for the explanation chart and the candidate range)
    const ltdDraws = new Float64Array(400);
    for (let i = 0; i < ltdDraws.length; i++) { const wk = drawLt() / 7, full = Math.floor(wk); let x = 0; for (let j = 0; j < full; j++) x += hist[Math.floor(rnd() * hist.length)]; x += (wk - full) * hist[Math.floor(rnd() * hist.length)]; ltdDraws[i] = x * scale; }
    const sorted = Array.from(ltdDraws).sort((a, b) => a - b);
    const ltd = { sorted, mean: mean(sorted) };
    const dL = d * L;
    const lo = Math.max(0, Math.floor(dL * 0.6)), hi = Math.max(lo + 2, Math.ceil(Math.max(quantile(sorted, 0.998), dL + 4 * sLTD)));
    const n = Math.min(18, hi - lo + 1);
    const grid = []; for (let i = 0; i < n; i++) { const R = Math.round(lo + (hi - lo) * i / (n - 1)); if (!grid.length || grid[grid.length - 1] !== R) grid.push(R); }
    const minLot = s.marc.BSTMI || 1, rnd2 = s.marc.BSTRF || 1;
    const twin = (R, Smax) => runTwin(dem, ltw, R, Smax, minLot, rnd2);
    let best = 0;
    const curve = grid.map(R => { const o = twin(R, R + q); best = Math.max(best, o.fill); return { R, rop: R, ss: Math.max(0, Math.ceil(R - dL - 1e-9)), fill: best, onHand: o.onHand, inv: o.onHand * price }; });
    // keep inventory monotone too
    for (let i = 1; i < curve.length; i++) if (curve[i].inv < curve[i - 1].inv) curve[i].inv = curve[i - 1].inv;
    const sapTwin = twin(s.marc.MINBE, Math.max(s.marc.MABST, s.marc.MINBE + minLot));
    const method = pat.pattern === 'smooth' || pat.pattern === 'erratic' ? 'Digital-twin simulation (regular demand)' : 'Digital-twin simulation (intermittent demand)';
    return { pattern: pat, lt, L, sL, fc, d, sigma, sLTD, q, clean, method, ltd, recent, curve, season, sapTwin: { fill: sapTwin.fill, inv: sapTwin.onHand * price }, stop: false };
  }

  function runTwin(dem, ltw, R, Smax, minLot, round) {
    const W = dem.length, warm = Math.min(26, W >> 3);
    const arr = new Float64Array(W + 60);
    let stock = Smax, pipe = 0, req = 0, del = 0, oh = 0;
    for (let w = 0; w < W; w++) {
      if (arr[w]) { stock += arr[w]; pipe -= arr[w]; }
      const x = dem[w]; const got = Math.min(stock, x);
      stock -= got;
      if (w >= warm) { req += x; del += got; oh += stock + got / 2; }
      const ip = stock + pipe;
      if (ip <= R && Smax > 0) {
        const qty = Math.max(minLot, roundTo(Smax - ip, round));
        const at = w + ltw[w]; if (at < arr.length) arr[at] += qty; pipe += qty;
      }
    }
    const n = W - warm;
    return { fill: req > 0 ? del / req : 1, onHand: oh / n };
  }

  // smallest reorder point on the curve whose simulated fill rate meets target t
  function atTarget(p, t) {
    for (const c of p.curve) if (c.fill >= t - 1e-9) return c;
    return p.curve[p.curve.length - 1];
  }

  // ------------------------------------------------------------------
  // Budget optimiser: spread an inventory budget (Rs, average stock on hand)
  // over all parts to maximise the value of demand served. Marginal analysis
  // on each part's simulated (inventory, fill) curve - upper convex hull,
  // greedy by served sales value per rupee of stock.
  // ------------------------------------------------------------------
  function optimise(items, budget) {
    // items: [{ key, p (policy), price, D (units/yr) }]
    const choice = new Map(); const steps = [];
    let cost = 0;
    for (const it of items) {
      const c = it.p.curve; choice.set(it.key, 0);
      if (it.p.stop || it.D <= 0 || c.length < 2) { cost += c[0].inv; continue; }
      const hull = [0];
      for (let i = 1; i < c.length; i++) {
        if (c[i].fill <= c[hull[hull.length - 1]].fill) continue;
        if (c[i].inv <= c[hull[hull.length - 1]].inv) { hull[hull.length - 1] = i; continue; }
        hull.push(i);
        while (hull.length >= 3) {
          const [x, y, z] = hull.slice(-3).map(j => c[j]);
          const r1 = (y.fill - x.fill) / (y.inv - x.inv), r2 = (z.fill - y.fill) / (z.inv - y.inv);
          if (r2 >= r1) hull.splice(hull.length - 2, 1); else break;
        }
      }
      choice.set(it.key, hull[0]); cost += c[hull[0]].inv;
      for (let i = 1; i < hull.length; i++) {
        const x = c[hull[i - 1]], y = c[hull[i]];
        const dc = y.inv - x.inv, db = (y.fill - x.fill) * it.D * it.price;
        steps.push({ key: it.key, from: hull[i - 1], to: hull[i], dc, db, r: dc > 0 ? db / dc : Infinity });
      }
    }
    steps.sort((a, b) => b.r - a.r);
    for (const st of steps) {
      if (choice.get(st.key) !== st.from) continue;
      if (cost + st.dc > budget) continue;
      cost += st.dc; choice.set(st.key, st.to);
    }
    return { choice, cost };
  }

  // ------------------------------------------------------------------
  // Classification across the portfolio
  // ------------------------------------------------------------------
  function classify(prep, uptoWeek) {
    const rows = prep.skus.map(s => {
      const w = weekly(s.demandDay, Math.max(0, uptoWeek - 52) * 7, uptoWeek * 7);
      const tot = w.reduce((a, x) => a + x, 0);
      const mo = []; for (let i = 0; i + 4 <= w.length; i += 4) mo.push(w[i] + w[i + 1] + w[i + 2] + w[i + 3]);
      const m = mean(mo); const cv = m > 0 ? sd(mo) / m : Infinity;
      const w26 = w.slice(-26).reduce((a, x) => a + x, 0);
      return { s, value: tot * s.price, cv, tot, w26 };
    });
    const sorted = rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value);
    const total = sorted.reduce((a, r) => a + r.value, 0) || 1;
    let cum = 0; const out = new Map();
    for (const r of sorted) { cum += r.value; const share = cum / total; out.set(r.s.key, { abc: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C', xyz: r.cv < 0.2 ? 'X' : r.cv <= 0.5 ? 'Y' : 'Z', cv: r.cv, annualValue: r.value, dead: false, slow: r.w26 === 0 || r.s.mat.obsolete, obsolete: r.s.mat.obsolete }); }
    for (const r of rows) if (!out.has(r.s.key)) out.set(r.s.key, { abc: 'C', xyz: 'Z', cv: Infinity, annualValue: 0, dead: true, slow: true, obsolete: r.s.mat.obsolete });
    return out;
  }

  // ------------------------------------------------------------------
  // Backtest: replay the last 52 weeks of real demand under both policies
  // ------------------------------------------------------------------
  // Replay actual daily demand (VBAP) with lead times drawn from the part's
  // actual PO history. The policy runs from day 0 starting at its own max stock;
  // the first `fromDay` days are warm-up, results are measured after that.
  function simulate(s, prep, fromDay, policyAt, seed) {
    const ltObs = s.pos.filter(p => p.lt != null).map(p => p.lt);
    const rnd = mulberry32(seed);
    const p0 = policyAt(0);
    let stock = Math.max(0, p0.max), pipeQty = 0;
    const arr = new Float64Array(prep.days + 400);
    let req = 0, del = 0, invVal = 0, soDays = 0, orders = 0;
    for (let d = 0; d < prep.days; d++) {
      if (arr[d]) { stock += arr[d]; pipeQty -= arr[d]; }
      const dem = s.demandDay[d];
      const got = Math.min(stock, dem);
      stock -= got;
      const pol = policyAt(d);
      const ip = stock + pipeQty;
      const lt = ltObs.length ? ltObs[Math.floor(rnd() * ltObs.length)] : Math.max(1, s.marc.PLIFZ);
      if (pol.max > 0 && pol.rop >= 0 && ip <= pol.rop) {
        const qty = Math.max(pol.minLot || 1, roundTo(pol.max - ip, pol.round || 1));
        arr[d + Math.max(1, lt + (s.marc.WEBAZ || 0))] += qty; pipeQty += qty;
        if (d >= fromDay) orders++;
      }
      if (d >= fromDay) { req += dem; del += got; if (got < dem) soDays++; invVal += (stock + got / 2) * s.price; }
    }
    const n = prep.days - fromDay;
    return { req, del, fill: req > 0 ? del / req : 1, avgInv: invVal / n, soDays, orders, lostValue: (req - del) * s.price };
  }

  // ------------------------------------------------------------------
  // Main
  //   build(T)             heavy: index tables, policies & service curves
  //   recommend(model,cfg) light: pick targets (class matrix or budget), actions
  //   backtest(model,cfg)  replay last 52 weeks: SAP vs AI, frontier
  // ------------------------------------------------------------------
  function mergeCfg(userCfg) {
    const u = userCfg || {};
    return Object.assign({}, DEFAULTS, u, { service: Object.assign({}, DEFAULT_SERVICE, u.service || {}), channelTargets: Object.assign({}, DEFAULT_CHANNEL, u.channelTargets || {}) });
  }

  // async so a browser can repaint a progress bar between chunks
  async function build(T, userCfg, onProgress) {
    const cfg = mergeCfg(userCfg);
    const say = onProgress || (() => {});
    const tick = () => new Promise(r => setTimeout(r, 0));
    say('Indexing SAP tables', 0.02); await tick();
    const prep = prepare(T);
    const season = seasonalIndices(prep);
    const ctx = { prep, season };
    const cls = classify(prep, prep.weeks);
    const fromWeek = prep.weeks - 52;
    const recalWeeks = []; const step = cfg.recalEvery || 4; for (let w = fromWeek; w < prep.weeks; w += step) recalWeeks.push(w);
    const total = prep.skus.length * (1 + recalWeeks.length * 0.5);
    let done = 0;
    const pols = [];
    for (let i = 0; i < prep.skus.length; i++) {
      pols.push(policy(prep.skus[i], ctx, cfg, prep.weeks, cfg.sims, cls.get(prep.skus[i].key)));
      if (++done % 60 === 0) { say('Forecasting demand & simulating each part', 0.05 + 0.9 * done / total); await tick(); }
    }
    let sapTwinInv = 0, sapTwinReq = 0, sapTwinDel = 0;
    prep.skus.forEach((s, i) => { const p = pols[i]; sapTwinInv += p.sapTwin.inv; const v = p.d * 52 * s.price; sapTwinReq += v; sapTwinDel += v * p.sapTwin.fill; });
    const recal = [];
    for (const w of recalWeeks) {
      const c = classify(prep, w);
      const rp = [];
      for (let i = 0; i < prep.skus.length; i++) {
        rp.push(policy(prep.skus[i], ctx, cfg, w, cfg.recalSims || 260, c.get(prep.skus[i].key)));
        done += 0.5; if (i % 120 === 0) { say('Re-running history for the 52-week backtest', 0.05 + 0.9 * done / total); await tick(); }
      }
      recal.push({ week: w, cls: c, pols: rp });
    }
    let sapSS = 0; for (const s of prep.skus) sapSS += s.marc.EISBE * s.price;
    say('Backtesting', 0.97); await tick();
    return { prep, season, ctx, cls, pols, recal, fromWeek, sapSS, sapTwin: { inv: sapTwinInv, fill: sapTwinReq ? sapTwinDel / sapTwinReq : 1 }, buildCfg: cfg };
  }

  function chooseTargets(skus, pols, cls, cfg) {
    if (cfg.mode === 'budget') {
      const items = skus.map((s, i) => ({ key: s.key, p: pols[i], price: s.price, D: pols[i].d * 52 }));
      const ch = optimise(items, cfg.budget).choice;
      const m = new Map(); skus.forEach((s, i) => m.set(s.key, pols[i].curve[ch.get(s.key)].fill)); return m;
    }
    const m = new Map();
    skus.forEach((s) => m.set(s.key, classChannelTarget(s, cls.get(s.key), cfg)));
    return m;
  }

  function recommend(model, userCfg) {
    const cfg = mergeCfg(userCfg);
    if (cfg.mode === 'budget' && !(cfg.budget >= 0)) cfg.budget = model.sapTwin.inv;
    const { prep, cls, pols } = model;
    const targets = chooseTargets(prep.skus, pols, cls, cfg);
    const results = prep.skus.map((s, i) => buildResult(s, cls.get(s.key), pols[i], targets.get(s.key), prep));
    linkPlants(results);
    for (const r of results) r.actions = actionsFor(r);
    return { cfg, results, totals: totals(results, prep, model) };
  }

  // Backtest: both policies replay the actual daily demand of the last two
  // years (year 1 warms up the stock, year 2 is measured). The AI is
  // re-calibrated every 8 weeks using only data available at that time and
  // re-optimised within the same budget; a 15% deadband stops reorder points
  // from flip-flopping (change control).
  function backtest(model, userCfg, opts) {
    const cfg = mergeCfg(userCfg);
    opts = opts || {};
    const { prep, recal, fromWeek } = model;
    const fromDay = fromWeek * 7;
    const skus = prep.skus;
    const seeds = skus.map(s => hash(s.key) ^ 0x9e3779b9);
    const period = (d) => Math.max(0, Math.min(recal.length - 1, Math.floor((Math.floor(d / 7) - fromWeek) / (model.buildCfg.recalEvery || 4))));
    const run = (pointFor) => {
      // pointFor(skuIndex, recalIndex) -> curve point
      const agg = { req: 0, del: 0, inv: 0, so: 0, orders: 0, byCls: {} }; const per = [];
      skus.forEach((s, i) => {
        let prev = null;
        const pol = recal.map((rc, k) => {
          const p = rc.pols[i]; const c = pointFor(i, k);
          let R = p.stop ? -1 : c.rop;
          if (prev && R >= 0 && prev.rop >= 0 && Math.abs(R - prev.rop) <= Math.max(1, 0.15 * prev.rop)) R = prev.rop;
          prev = { rop: R, max: R < 0 ? 0 : R + p.q, minLot: s.marc.BSTMI, round: s.marc.BSTRF };
          return prev;
        });
        const r = simulate(s, prep, fromDay, (d) => pol[period(d)], seeds[i]);
        per.push(r); addAgg(agg, r, s.price, model.cls.get(s.key).abc);
      });
      return finishAgg(agg, per);
    };
    const sap = model.sapBacktest || (model.sapBacktest = (() => {
      const agg = { req: 0, del: 0, inv: 0, so: 0, orders: 0, byCls: {} }; const per = [];
      skus.forEach((s, i) => { const pol = { rop: s.marc.MINBE, max: Math.max(s.marc.MABST, s.marc.MINBE + (s.marc.BSTMI || 1)), minLot: s.marc.BSTMI, round: s.marc.BSTRF }; const r = simulate(s, prep, fromDay, () => pol, seeds[i]); per.push(r); addAgg(agg, r, s.price, model.cls.get(s.key).abc); });
      return finishAgg(agg, per);
    })());
    const byBudget = (budget) => {
      const chs = recal.map(rc => optimise(skus.map((s, i) => ({ key: s.key, p: rc.pols[i], price: s.price, D: rc.pols[i].d * 52 })), budget).choice);
      return run((i, k) => recal[k].pols[i].curve[chs[k].get(skus[i].key)]);
    };
    const byMatrix = () => run((i, k) => atTarget(recal[k].pols[i], classChannelTarget(skus[i], recal[k].cls.get(skus[i].key), cfg)));
    const out = { sap, fromDay, days: prep.days - fromDay };
    if (opts.frontier) {
      const base = model.sapTwin.inv;
      out.frontier = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5].map(m => { const r = byBudget(base * m); return { mult: m, budget: base * m, fill: r.fill, inv: r.inv, run: r }; });
      const f = out.frontier;
      const interp = (xs, ys, x) => { for (let i = 1; i < xs.length; i++) if ((xs[i - 1] - x) * (xs[i] - x) <= 0) { const w = (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1); return ys[i - 1] + w * (ys[i] - ys[i - 1]); } return x < xs[0] ? ys[0] : ys[ys.length - 1]; };
      out.sameService = { mult: interp(f.map(p => p.fill), f.map(p => p.mult), sap.fill), inv: interp(f.map(p => p.fill), f.map(p => p.inv), sap.fill), fill: sap.fill };
      out.sameInventory = { mult: interp(f.map(p => p.inv), f.map(p => p.mult), sap.inv), fill: interp(f.map(p => p.inv), f.map(p => p.fill), sap.inv), inv: sap.inv };
      out.matrix = summary(byMatrix());
    }
    if (cfg.mode === 'matrix') out.ai = byMatrix();
    else out.ai = byBudget(cfg.budget >= 0 ? cfg.budget : model.sapTwin.inv);
    return out;
  }
  const summary = (r) => ({ fill: r.fill, inv: r.inv, so: r.so, orders: r.orders });
  function addAgg(agg, r, price, abc) {
    agg.req += r.req * price; agg.del += r.del * price; agg.inv += r.avgInv; agg.so += r.soDays; agg.orders += r.orders;
    const g = agg.byCls[abc] || (agg.byCls[abc] = { req: 0, del: 0, inv: 0 });
    g.req += r.req * price; g.del += r.del * price; g.inv += r.avgInv;
  }
  function finishAgg(agg, per) {
    agg.fill = agg.req ? agg.del / agg.req : 1;
    for (const k in agg.byCls) agg.byCls[k].fill = agg.byCls[k].req ? agg.byCls[k].del / agg.byCls[k].req : 1;
    agg.per = per; return agg;
  }

  async function analyze(T, userCfg) {
    const model = await build(T, userCfg);
    const rec = recommend(model, userCfg);
    const bt = backtest(model, userCfg, { frontier: true });
    return { model, rec, bt };
  }

  function buildResult(s, c, p, target, prep) {
    const d = p.d; const price = s.price;
    const at = atTarget(p, target);
    const last52 = weekly(s.demandDay, prep.days - 364, prep.days);
    const cons52 = weekly(s.consDay, prep.days - 364, prep.days);
    const req52 = last52.reduce((a, x) => a + x, 0);
    let del52 = 0; for (let i = prep.days - 364; i < prep.days; i++) del52 += s.deliveredDay[i];
    const lastMove = Math.max(s.lastIssue, s.lastReceipt);
    const r = {
      key: s.key, MATNR: s.MATNR, WERKS: s.WERKS, MAKTX: s.mat.MAKTX, MATKL: s.mat.MATKL, MEINS: s.mat.MEINS, plant: prep.plants[s.WERKS] || s.WERKS,
      price, stock: s.stock, openQty: s.openQty, supplier: s.supplier, LIFNR: s.LIFNR,
      abc: c.abc, xyz: c.xyz, cls: c.dead ? 'Dead' : c.abc + c.xyz, dead: c.dead, slow: c.slow, cv: c.cv, annualValue: c.annualValue,
      pattern: p.pattern.pattern, adi: p.pattern.adi, cv2: p.pattern.cv2,
      method: p.method, fcMethod: p.fc ? p.fc.best.name : '-', fcTried: p.fc ? p.fc.tried.map(t => ({ name: t.name, mae: t.mae, rmse: t.rmse })) : [],
      weeklyFc: d, sigma: p.sigma, svc: p.stop ? 0 : at.fill, target, stop: p.stop, curve: p.curve, sapTwin: p.sapTwin,
      lt: p.lt, ltWeeks: p.L,
      sap: { ss: s.marc.EISBE, rop: s.marc.MINBE, max: s.marc.MABST, plifz: s.marc.PLIFZ },
      ai: { ss: p.stop ? 0 : at.ss, rop: p.stop ? 0 : at.rop, q: p.q, max: p.stop ? 0 : at.rop + p.q },
      outliers: p.clean.flags,
      req52, del52, cons52: cons52.reduce((a, x) => a + x, 0), fill52: req52 > 0 ? del52 / req52 : 1, lost52Value: (req52 - del52) * price,
      daysSinceMove: lastMove >= 0 ? prep.days - lastMove : 999,
      coverWeeks: d > 0 ? s.stock / d : Infinity,
      channel: s.channel, orderLines: s.orderLines, lostLines: s.lostLines,
      ltd: p.ltd, sku: s,
    };
    r.ssDelta = r.ai.ss - r.sap.ss; r.ssDeltaValue = r.ssDelta * price;
    r.stockValue = s.stock * price;
    r.ip = s.stock + s.openQty;
    r.targetAvgInv = p.stop ? 0 : at.inv;
    r.excessQty = Math.max(0, s.stock - Math.max(r.ai.max, 0));
    if (p.stop) r.excessQty = s.stock;
    r.excessValue = r.excessQty * price;
    r.obsolete = !!s.mat.obsolete; r.MSTAE = s.mat.MSTAE;
    r.daysSinceIssue = s.lastIssue >= 0 ? prep.days - s.lastIssue : 999;
    // seasonal reorder-point calendar for the next 12 months (SAP holds one static value)
    const m0 = new Date(prep.end).getUTCMonth();
    r.calendar = Array.from({ length: 12 }, (_, k) => {
      const m = (m0 + k) % 12;
      if (p.stop || !p.season) return { m, f: 1, rop: r.ai.rop };
      // anchored on today's recommendation: shift by the seasonal change in lead-time demand
      const rel = p.season.factors[m] / p.season.factors[m0];
      return { m, f: rel, rop: Math.max(0, Math.round(r.ai.rop + p.d * p.L * (rel - 1) + r.ai.ss * (Math.sqrt(rel) - 1))) };
    });
    r.seasonal = !!p.season && !p.stop;
    r.explain = explain(r);
    return r;
  }

  function linkPlants(results) {
    const byMat = {};
    for (const r of results) (byMat[r.MATNR] = byMat[r.MATNR] || []).push(r);
    for (const r of results) r.siblings = byMat[r.MATNR].filter(x => x !== r);
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtN = (x) => (Number.isInteger(x) ? x.toLocaleString('en-IN') : x >= 100 ? Math.round(x).toLocaleString('en-IN') : x >= 10 ? x.toFixed(0) : x.toFixed(1));
  const PAT_TEXT = {
    smooth: 'steady, frequent demand',
    erratic: 'frequent demand with big swings in order size',
    intermittent: 'occasional demand (many weeks with no sales)',
    lumpy: 'occasional and highly variable demand',
    none: 'no demand in the last 52 weeks',
  };

  function explain(r) {
    const u = r.MEINS === 'L' ? 'L' : 'units';
    const parts = [];
    if (r.dead) {
      parts.push(`No customer demand in the last 52 weeks; ${fmtN(r.stock)} ${u} on hand worth ₹${fmtN(r.stockValue)}.`);
      parts.push(`Hold no safety stock and stop automatic replenishment (current setting: safety stock ${r.sap.ss}, reorder point ${r.sap.rop}). Redeploy or liquidate the stock.`);
      return parts;
    }
    if (r.obsolete) {
      parts.push(`Material status ${r.MSTAE} (MARA-MSTAE) marks this part as superseded or blocked for procurement. ${fmtN(r.stock)} ${u} on hand worth ₹${fmtN(r.stockValue)}.`);
      parts.push(`Hold no safety stock (current setting: ${r.sap.ss}, reorder point ${r.sap.rop}). Sell down, return to the supplier or redeploy the stock.`);
      return parts;
    }
    if (r.stop) {
      parts.push(`No customer demand in the last 26 weeks (last sale ${r.sku.lastIssue >= 0 ? Math.round((r.sku.demandDay.length - r.sku.lastIssue) / 7) + ' weeks ago' : 'over a year ago'}). ${fmtN(r.stock)} ${u} on hand worth ₹${fmtN(r.stockValue)}.`);
      parts.push(`Hold no safety stock (current setting: ${r.sap.ss}, reorder point ${r.sap.rop}) and buy only against a firm customer order until demand returns.`);
      return parts;
    }
    parts.push(`Class ${r.cls} (${r.abc === 'A' ? 'top 80% of sales value' : r.abc === 'B' ? 'next 15% of sales value' : 'tail 5% of sales value'}), ${PAT_TEXT[r.pattern]}. Fill-rate target ${(r.svc * 100).toFixed(0)}%.`);
    parts.push(`Forecast ${fmtN(r.weeklyFc)} ${u}/week using ${r.fcMethod}, the most accurate of ${r.fcTried.length} models on the last 26 weeks.`);
    const plan = r.sap.plifz, act = r.lt.mean;
    if (act > plan * 1.2 && act - plan >= 3) parts.push(`${r.supplier.NAME1} actually delivers in ${fmtN(act)} days on average (±${fmtN(r.lt.sd)}), measured over ${r.lt.n} purchase orders. The planned delivery time in the material master is ${plan} days, so the AI plans with the real figure and its spread.`);
    else if (act < plan * 0.8 && plan - act >= 3) parts.push(`${r.supplier.NAME1} delivers faster than planned: ${fmtN(act)} days actual vs ${plan} days in MARC-PLIFZ.`);
    else parts.push(`Lead time from ${r.supplier.NAME1}: ${fmtN(act)} days average (±${fmtN(r.lt.sd)}), in line with the ${plan} days in the material master. The spread still needs cover.`);
    if (r.seasonal) {
      const lo = r.calendar.reduce((a, c) => (c.rop < a.rop ? c : a)), hi = r.calendar.reduce((a, c) => (c.rop > a.rop ? c : a));
      if (hi.rop > lo.rop) parts.push(`Demand for this material group dips in the monsoon and recovers after it. The reorder point moves with the season, from ${lo.rop} in ${MONTHS[lo.m]} to ${hi.rop} in ${MONTHS[hi.m]}.`);
    }
    if (r.outliers.length) parts.push(`${r.outliers.length} one-off bulk order${r.outliers.length > 1 ? 's were' : ' was'} excluded from the variability calculation so it does not inflate safety stock.`);
    if (r.lostLines > 0 && r.req52 > r.del52) parts.push(`Last 12 months: ${fmtN(r.req52 - r.del52)} ${u} of customer orders could not be supplied (fill rate ${(r.fill52 * 100).toFixed(1)}%). This lost demand is counted in the forecast, because the AI reads sales orders, not only goods issues.`);
    const wk = r.weeklyFc > 0 ? r.sap.ss / r.weeklyFc : 0;
    if (r.ssDelta > 0) parts.push(`Recommended safety stock ${r.ai.ss} (current setting ${r.sap.ss}, ${fmtN(wk)} weeks of demand), sized to the fill-rate target for this variability (+₹${fmtN(r.ssDeltaValue)}).`);
    else if (r.ssDelta < 0) parts.push(`Recommended safety stock ${r.ai.ss} (current setting ${r.sap.ss}, ${fmtN(wk)} weeks of demand) meets the fill-rate target and frees ₹${fmtN(-r.ssDeltaValue)}.`);
    else parts.push(`The current safety stock of ${r.sap.ss} already matches the recommendation.`);
    return parts;
  }

  function actionsFor(r) {
    const A = [];
    const u = r.MEINS;
    if (r.stop) {
      if (r.stock > 0 && r.stockValue > 1000) A.push({ type: 'dead', sev: r.dead || r.obsolete ? 'critical' : 'serious', title: r.obsolete ? 'Superseded part: return, redeploy or liquidate' : r.dead ? 'Dead stock: redeploy, liquidate or scrap' : 'Slow-moving: stop buying, sell down', qty: r.stock, value: r.stockValue, detail: r.obsolete ? `Material status ${r.MSTAE} (superseded). Last sale ${r.daysSinceIssue} days ago.` : `No demand for ${r.dead ? 52 : 26} weeks; last sale ${r.daysSinceIssue >= 999 ? 'over 2 years' : r.daysSinceIssue + ' days'} ago.` });
      if (r.sap.ss > 0 || r.sap.rop > 0) A.push({ type: 'master', sev: 'serious', title: 'Stop automatic replenishment', value: r.sap.ss * r.price, detail: `MARC-EISBE ${r.sap.ss} → 0, MARC-MINBE ${r.sap.rop} → 0` });
      return A;
    }
    const need = r.ai.max - r.ip;
    if (r.weeklyFc > 0 && r.ip <= r.ai.rop) {
      const donor = r.siblings.find(x => x.excessQty > 0 && !x.dead);
      const days = r.weeklyFc > 0 ? (r.stock / r.weeklyFc) * 7 : Infinity;
      const risk = days < r.lt.mean;
      if (donor) {
        const qty = Math.min(donor.excessQty, Math.max(1, Math.ceil(need)));
        A.push({ type: 'transfer', sev: risk ? 'critical' : 'warning', title: `Transfer ${fmtN(qty)} ${u} from plant ${donor.WERKS}`, qty, value: qty * r.price, detail: `Plant ${donor.WERKS} holds ${fmtN(donor.excessQty)} ${u} above its need. A stock transfer avoids a ${fmtN(r.lt.mean)}-day purchase lead time.` });
      }
      const q = roundTo(Math.max(r.ai.q, need), r.sku.marc.BSTRF || 1);
      A.push({ type: 'reorder', sev: risk ? 'critical' : 'warning', title: `${risk ? 'Order now, stockout risk' : 'Reorder'}: ${fmtN(q)} ${u}`, qty: q, value: q * r.price, detail: `Stock ${fmtN(r.stock)} + open POs ${fmtN(r.openQty)} is at or below the reorder point ${r.ai.rop}. ${risk ? `Stock lasts about ${fmtN(days)} days, less than the ${fmtN(r.lt.mean)}-day lead time.` : ''}`.trim() });
    }
    if (r.excessValue > 5000 && r.excessQty > 0) {
      A.push({ type: 'excess', sev: r.slow ? 'serious' : 'warning', title: `${r.slow ? 'Slow-moving' : 'Excess'} stock: ${fmtN(r.excessQty)} ${u} above target`, qty: r.excessQty, value: r.excessValue, detail: `${fmtN(r.coverWeeks)} weeks of cover vs target max of ${r.ai.max}. Pause purchasing${r.siblings.length ? ' or transfer to the other plant' : ''}.` });
    }
    const ssChange = Math.abs(r.ssDelta) >= Math.max(1, 0.2 * Math.max(r.sap.ss, r.ai.ss));
    if (ssChange) A.push({ type: 'master', sev: r.ssDelta > 0 ? 'warning' : 'good', title: r.ssDelta > 0 ? 'Raise safety stock' : 'Lower safety stock', value: Math.abs(r.ssDeltaValue), detail: `MARC-EISBE ${r.sap.ss} → ${r.ai.ss}, MARC-MINBE ${r.sap.rop} → ${r.ai.rop}, MARC-MABST ${r.sap.max} → ${r.ai.max}` });
    const plan = r.sap.plifz, act = Math.round(r.lt.mean);
    if (r.lt.n >= 3 && Math.abs(act - plan) >= Math.max(3, 0.2 * plan)) A.push({ type: 'leadtime', sev: act > plan ? 'serious' : 'good', title: 'Correct planned delivery time', value: 0, detail: `MARC-PLIFZ ${plan} → ${act} days (actual average over ${r.lt.n} POs from ${r.supplier.NAME1})` });
    return A;
  }

  function totals(results, prep, model) {
    const t = { skus: results.length, materials: new Set(results.map(r => r.MATNR)).size, stockValue: 0, sapSS: 0, aiSS: 0, excess: 0, dead: 0, deadCount: 0, lost52: 0, req52v: 0, raise: 0, lower: 0, reorderNow: 0, risk: 0, plifzWrong: 0, targetInv: 0 };
    for (const r of results) {
      t.stockValue += r.stockValue; t.sapSS += r.sap.ss * r.price; t.aiSS += r.ai.ss * r.price;
      if (r.dead) { if (r.stock > 0) { t.dead += r.stockValue; t.deadCount++; } } else t.excess += r.excessValue;
      t.lost52 += r.lost52Value; t.req52v += r.req52 * r.price;
      if (r.ssDelta > 0) t.raise++; else if (r.ssDelta < 0) t.lower++;
      t.targetInv += r.targetAvgInv;
      for (const a of r.actions) { if (a.type === 'reorder') { t.reorderNow++; if (a.sev === 'critical') t.risk++; } if (a.type === 'leadtime' && a.sev === 'serious') t.plifzWrong++; }
    }
    t.fill52 = t.req52v > 0 ? 1 - t.lost52 / t.req52v : 1;
    return t;
  }

  const api = { CHANNEL_NAMES, DEFAULT_CHANNEL, PERIOD, MONTHS, simulate, build, recommend, backtest, analyze, optimise, atTarget, policy, classify, prepare, seasonalIndices, weekly, zOf, DEFAULT_SERVICE, DEFAULTS, PAT_TEXT, parseDats };
  root.DZ = root.DZ || {};
  root.DZ.engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
