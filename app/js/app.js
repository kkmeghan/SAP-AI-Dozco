/* Safety Stock Studio - UI */
(function () {
  'use strict';
  const E = DZ.engine, SAP = DZ.sap;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    T: null, source: 'sample', model: null, bt: null, rec: null, cfg: null,
    preset: 'sameService', mult: 1, plant: 'all', tab: 'overview', part: null,
    f: { q: '', cls: 'all', pattern: 'all', dir: 'all', action: 'all' },
    sort: { key: 'absDelta', dir: -1 },
    charts: {},
  };

  // ---------------- formatting ----------------
  const inr = (x) => {
    const a = Math.abs(x), sg = x < 0 ? '−' : '';
    if (a >= 1e7) return sg + '₹' + (a / 1e7).toFixed(a >= 1e9 ? 0 : 2) + ' Cr';
    if (a >= 1e5) return sg + '₹' + (a / 1e5).toFixed(1) + ' L';
    return sg + '₹' + Math.round(a).toLocaleString('en-IN');
  };
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
  const nf = (x, d) => {
    if (!isFinite(x)) return '–';
    if (d != null) return x.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
    if (Number.isInteger(x)) return x.toLocaleString('en-IN');
    const a = Math.abs(x);
    return a >= 100 ? Math.round(x).toLocaleString('en-IN') : a >= 10 ? x.toFixed(0) : a >= 1 ? x.toFixed(1) : x.toFixed(2);
  };
  const PATTERN = { smooth: 'Smooth', erratic: 'Erratic', intermittent: 'Intermittent', lumpy: 'Lumpy', none: 'No demand' };
  const SEV_ORDER = { critical: 0, serious: 1, warning: 2, good: 3 };
  const chip = (sev, text) => `<span class="chip chip-${sev}"><span class="dot"></span>${esc(text)}</span>`;

  // ---------------- theme colours for charts ----------------
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { ai: v('--ai'), aiSoft: v('--ai-soft'), sap: v('--sap'), sapSoft: v('--sap-soft'), ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), line: v('--line'), surface: v('--surface'), critical: v('--critical'), warning: v('--warning'), good: v('--good'), orange: '#eb6834', slate: v('--line-strong') };
  }
  function baseOpts(extra) {
    const c = colors();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = c.ink2;
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: false, color: c.ink2 } },
        tooltip: { backgroundColor: c.ink, titleColor: c.surface, bodyColor: c.surface, padding: 9, cornerRadius: 6, displayColors: true, boxPadding: 4 },
      },
    }, extra || {});
  }
  const axis = (title, extra) => { const c = colors(); return Object.assign({ grid: { color: c.line, drawTicks: false }, border: { color: c.slate }, ticks: { color: c.muted, padding: 6 }, title: title ? { display: true, text: title, color: c.muted, font: { size: 11.5 } } : undefined }, extra || {}); };

  // vertical reference lines (for histograms)
  const vlinePlugin = {
    id: 'vlines',
    afterDatasetsDraw(chart, args, opts) {
      const lines = (opts && opts.lines) || []; if (!lines.length) return;
      const { ctx, chartArea: a, scales: { x } } = chart;
      ctx.save();
      lines.forEach((l, i) => {
        const px = x.getPixelForValue(l.x); if (!isFinite(px)) return;
        ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.setLineDash(l.dash || []);
        ctx.beginPath(); ctx.moveTo(px, a.top + 14); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = l.textColor || l.color; ctx.font = '600 11px ' + Chart.defaults.font.family;
        const w = ctx.measureText(l.label).width; let tx = px + 4; if (tx + w > a.right) tx = px - 4 - w;
        ctx.fillText(l.label, tx, a.top + 10 + (i % 2) * 13);
      });
      ctx.restore();
    },
  };
  Chart.register(vlinePlugin);

  function chart(id, config) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    const el = document.getElementById(id); if (!el) return null;
    state.charts[id] = new Chart(el, config);
    return state.charts[id];
  }
  function destroyCharts() { for (const k in state.charts) state.charts[k].destroy(); state.charts = {}; }

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }

  // ---------------- pipeline ----------------
  const REQUIRED = ['MARA', 'MARC', 'MARD', 'MBEW', 'MATDOC', 'EKKO', 'EKPO', 'EKBE', 'VBAK', 'VBAP', 'LIPS'];
  const OPTIONAL = ['MAKT', 'EKET', 'LFA1', 'T001W', 'KNA1'];

  function progress(msg, p) { $('#loading-step').textContent = msg; if (p != null) $('#progress-bar').style.width = Math.round(p * 100) + '%'; }

  async function runPipeline(T, source) {
    for (const k of REQUIRED.concat(OPTIONAL)) T[k] = T[k] || [];
    destroyCharts();
    $('#loading').hidden = false; $('#policybar').hidden = true; $$('.view').forEach(v => (v.hidden = true));
    state.T = T; state.source = source;
    state.model = await E.build(T, {}, progress);
    state.bt = E.backtest(state.model, {}, { frontier: true });
    applyPreset();
    const plants = Object.keys(state.model.prep.plants).length ? state.model.prep.plants : Object.fromEntries([...new Set(state.model.prep.skus.map(s => s.WERKS))].map(w => [w, w]));
    $('#plant').innerHTML = `<option value="all">All plants</option>` + Object.entries(plants).map(([k, v]) => `<option value="${esc(k)}">${esc(k)} · ${esc(v)}</option>`).join('');
    state.plant = 'all';
    const prep = state.model.prep;
    const d0 = new Date(prep.start).toISOString().slice(0, 10), d1 = new Date(prep.end - 86400000).toISOString().slice(0, 10);
    $('#dataset-pill').className = 'pill ' + (source === 'sample' ? 'pill-sample' : 'pill-live');
    $('#dataset-pill').textContent = source === 'sample' ? 'Sample data' : 'Uploaded data';
    $('#dataset-text').innerHTML = `${source === 'sample' ? 'Generated SAP S/4HANA extract for a heavy-equipment parts trader, not DOZCO records.' : 'Your uploaded SAP extract.'} <b>${nf(prep.skus.length)}</b> material × plant combinations · ${Object.keys(plants).length} plants · history ${d0} to ${d1} · ${nf(T.VBAP.length)} sales order lines · ${nf(T.EKPO.length)} PO lines · ${nf(T.MATDOC.length)} material documents`;
    $('#loading').hidden = true;
    if (!state.part) state.part = pickShowcase();
    render();
  }

  function cfgForPreset() {
    const m = state.model, bt = state.bt;
    if (state.preset === 'matrix') return { mode: 'matrix' };
    const mult = state.preset === 'sameService' ? bt.sameService.mult : state.preset === 'sameInventory' ? bt.sameInventory.mult : state.mult;
    return { mode: 'budget', budget: m.sapTwin.inv * mult, mult };
  }

  function applyPreset() {
    const cfg = cfgForPreset();
    state.cfg = cfg;
    if (cfg.mult) state.mult = cfg.mult;
    state.rec = E.recommend(state.model, cfg);
    const b = E.backtest(state.model, cfg);
    state.aiRun = b.ai;
    state.rec.results.forEach((r, i) => { r.bt = { sap: state.bt.sap.per[i], ai: b.ai.per[i] }; });
    $('#budget').value = state.mult.toFixed(2);
    $('#budget-out').textContent = inr(state.model.sapTwin.inv * state.mult);
  }

  function pickShowcase() {
    // a part with a clear story: A class, raised safety stock and a wrong lead time
    const rs = state.rec.results.filter(r => !r.stop && r.abc === 'A' && r.ssDelta > 0 && r.lt.mean > r.sap.plifz * 1.3 && r.lt.n >= 4);
    rs.sort((a, b) => b.lost52Value - a.lost52Value);
    return (rs[0] || state.rec.results[0]).key;
  }

  const visible = () => state.rec.results.filter(r => state.plant === 'all' || r.WERKS === state.plant);

  function btAgg(rows) {
    const a = { sap: { req: 0, del: 0, inv: 0, so: 0 }, ai: { req: 0, del: 0, inv: 0, so: 0 } };
    for (const r of rows) for (const k of ['sap', 'ai']) { const b = r.bt[k]; a[k].req += b.req * r.price; a[k].del += b.del * r.price; a[k].inv += b.avgInv; a[k].so += b.soDays; }
    for (const k of ['sap', 'ai']) a[k].fill = a[k].req ? a[k].del / a[k].req : 1;
    return a;
  }

  // ---------------- routing ----------------
  function setTab(tab) {
    state.tab = tab;
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (!state.rec) return;
    destroyCharts();
    $$('.view').forEach(v => (v.hidden = v.id !== 'view-' + state.tab));
    $('#policybar').hidden = !['overview', 'recs', 'actions'].includes(state.tab);
    $('#budget-wrap').hidden = state.preset !== 'custom';
    $$('.seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.preset === state.preset)));
    ({ overview: renderOverview, recs: renderRecs, part: renderPart, actions: renderActions, suppliers: renderSuppliers, data: renderData })[state.tab]();
  }

  // ---------------- overview ----------------
  function renderOverview() {
    const el = $('#view-overview');
    const rows = visible();
    const bt = state.bt, t = state.rec.totals;
    const agg = btAgg(rows);
    const all = state.plant === 'all';
    const sap = all ? bt.sap : agg.sap, ai = all ? state.aiRun : agg.ai;
    const invDelta = ai.inv / sap.inv - 1, fillDelta = ai.fill - sap.fill;
    let excess = 0, dead = 0, deadN = 0, excessN = 0, lost = 0, risk = 0, reorder = 0, transfer = 0, cons = 0, dem = 0;
    for (const r of rows) {
      if (r.dead) { if (r.stock > 0) { dead += r.stockValue; deadN++; } } else if (r.excessValue > 0) { excess += r.excessValue; excessN++; }
      lost += r.lost52Value; cons += r.cons52 * r.price; dem += r.req52 * r.price;
      for (const a of r.actions) { if (a.type === 'reorder') { reorder++; if (a.sev === 'critical') risk++; } if (a.type === 'transfer') transfer++; }
    }
    const presetLine = {
      sameService: `Holding today's ${pct(sap.fill)} fill rate, AI-set stocking policies need <b>${inr(ai.inv)}</b> of stock instead of ${inr(sap.inv)}.`,
      sameInventory: `With the same ${inr(sap.inv)} of stock, AI-set stocking policies lift the fill rate from ${pct(sap.fill)} to <b>${pct(ai.fill)}</b>.`,
      matrix: `With service targets by ABC/XYZ class, the fill rate rises from ${pct(sap.fill)} to <b>${pct(ai.fill)}</b>, using ${inr(ai.inv)} of stock (SAP today: ${inr(sap.inv)}).`,
      custom: `At a budget of ${inr(state.model.sapTwin.inv * state.mult)}, AI policies reach <b>${pct(ai.fill)}</b> fill rate with ${inr(ai.inv)} average stock. SAP MRP today: ${pct(sap.fill)} with ${inr(sap.inv)}.`,
    }[state.preset];

    el.innerHTML = `
      <div class="headline">
        <div class="eyebrow">Safety stock vs SAP MRP · 52-week backtest${all ? '' : ' · plant ' + esc(state.plant)}</div>
        <h1>${presetLine.replace(/<\/?b>/g, '')}</h1>
        <p>Both policies were replayed day by day against the actual customer orders of the last 52 weeks, with supplier lead times drawn from real purchase orders. SAP uses today's MARC settings (EISBE, MINBE, MABST). The AI re-calibrated every 8 weeks using only data available at that time.</p>
      </div>
      <div class="kpis">
        ${kpi('Fill rate (backtest)', pct(ai.fill), `SAP MRP: ${pct(sap.fill)} · <span class="${Math.abs(fillDelta) <= 0.003 ? 'delta-flat' : fillDelta > 0 ? 'delta-good' : 'delta-bad'}">${fillDelta >= 0 ? '+' : ''}${(fillDelta * 100).toFixed(1)} pts</span>`)}
        ${kpi('Average stock (backtest)', inr(ai.inv), `SAP MRP: ${inr(sap.inv)} · <span class="${invDelta <= 0 ? 'delta-good' : 'delta-bad'}">${invDelta > 0 ? '+' : ''}${(invDelta * 100).toFixed(1)}%</span>`)}
        ${kpi('Excess + dead stock today', inr(excess + dead), `${nf(excessN)} parts above AI max · ${nf(deadN)} dead`)}
        ${kpi('Sales lost to stockouts', inr(lost), `Last 12 months, ${pct(dem ? lost / dem : 0)} of order value`)}
        ${kpi('Order now', nf(risk), `stockout risk · ${nf(reorder - risk)} more reorders · ${nf(transfer)} transfers`)}
      </div>
      <div class="grid-hero">
        <div class="panel">
          <div class="panel-head"><div><h3>Service vs working capital</h3><p>Each blue point is the AI policy at a different inventory budget, replayed on the last 52 weeks. Points above and left of SAP are better on both measures.</p></div></div>
          <div class="chart-box tall"><canvas id="c-frontier" role="img" aria-label="Fill rate versus average inventory for AI budgets and SAP MRP"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>SAP MRP vs AI by class</h3><p>Backtest results for ${all ? 'all plants' : 'plant ' + esc(state.plant)}. A = top 80% of sales value.</p></div><div class="legend"><span><i class="swatch-sap"></i>SAP MRP today</span><span><i class="swatch-ai"></i>AI policy</span></div></div>
          ${classCompare(rows)}
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>What the data shows</h3><p>Findings from the SAP tables, ranked by value.</p></div></div>
          <ul class="findings">${findings(rows).map(f => `<li>${chip(f.sev, '')}<span>${f.html}</span></li>`).join('')}</ul>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Safety stock by material group</h3><p>Value of safety stock in SAP (MARC-EISBE) vs the AI recommendation for the selected policy.</p></div></div>
          <div class="chart-box tall"><canvas id="c-cat" role="img" aria-label="Safety stock value by material group, SAP versus AI"></canvas></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>ABC × XYZ segmentation</h3><p>Count of parts, and safety stock value SAP → AI. X = steady demand, Z = highly variable.</p></div></div>
          ${abcxyz(rows)}
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Demand patterns and winning forecast models</h3><p>Each part gets the forecasting model that was most accurate on its own last 26 weeks.</p></div></div>
          <div class="chart-box"><canvas id="c-models" role="img" aria-label="Number of parts by demand pattern and winning forecast model"></canvas></div>
        </div>
      </div>`;
    drawFrontier(); drawCategory(rows); drawModels(rows);
  }

  const kpi = (label, value, sub) => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-sub">${sub}</div></div>`;

  function classCompare(rows) {
    const g = {};
    for (const r of rows) {
      const k = r.abc; const x = g[k] || (g[k] = { sap: { req: 0, del: 0, inv: 0 }, ai: { req: 0, del: 0, inv: 0 }, n: 0 }); x.n++;
      for (const s of ['sap', 'ai']) { x[s].req += r.bt[s].req * r.price; x[s].del += r.bt[s].del * r.price; x[s].inv += r.bt[s].avgInv; }
    }
    const maxInv = Math.max(...Object.values(g).flatMap(x => [x.sap.inv, x.ai.inv]), 1);
    const block = (k) => {
      const x = g[k]; if (!x) return '';
      const fs = x.sap.req ? x.sap.del / x.sap.req : 1, fa = x.ai.req ? x.ai.del / x.ai.req : 1;
      const lo = 0.6;
      const w = (f) => Math.max(1, (f - lo) / (1 - lo) * 100);
      return `<div class="vs" style="margin-bottom:16px">
        <div class="eyebrow">Class ${k} · ${nf(x.n)} parts</div>
        <div class="vs-row"><span>Fill rate · SAP</span><div class="vs-track"><div class="vs-fill sap" style="width:${w(fs)}%"></div></div><span class="num r">${pct(fs)}</span></div>
        <div class="vs-row"><span>Fill rate · AI</span><div class="vs-track"><div class="vs-fill ai" style="width:${w(fa)}%"></div></div><span class="num r">${pct(fa)}</span></div>
        <div class="vs-row"><span>Avg stock · SAP</span><div class="vs-track"><div class="vs-fill sap" style="width:${x.sap.inv / maxInv * 100}%"></div></div><span class="num r">${inr(x.sap.inv)}</span></div>
        <div class="vs-row"><span>Avg stock · AI</span><div class="vs-track"><div class="vs-fill ai" style="width:${x.ai.inv / maxInv * 100}%"></div></div><span class="num r">${inr(x.ai.inv)}</span></div>
      </div>`;
    };
    return block('A') + block('B') + block('C') + `<p class="note">Fill-rate bars start at 60%.</p>`;
  }

  function findings(rows) {
    const F = [];
    const plif = rows.filter(r => !r.stop && r.lt.n >= 3 && r.lt.mean - r.sap.plifz >= Math.max(3, 0.2 * r.sap.plifz));
    if (plif.length) {
      const gap = plif.reduce((a, r) => a + (r.lt.mean - r.sap.plifz), 0) / plif.length;
      F.push({ sev: 'serious', v: 3e7, html: `<b>SAP plans with lead times that are too short</b> for ${nf(plif.length)} part-plants: suppliers take on average <b>${nf(gap)} days longer</b> than MARC-PLIFZ. MRP then reorders too late, the main cause of stockouts on A-class parts.` });
    }
    const lost = rows.reduce((a, r) => a + r.lost52Value, 0);
    const hidden = rows.reduce((a, r) => a + (r.req52 - r.cons52) * r.price, 0);
    if (lost > 0) F.push({ sev: 'critical', v: lost, html: `<b>${inr(lost)} of customer orders went unfilled</b> in the last 12 months. SAP MRP forecasts from consumption (MATDOC) and never sees this demand. The AI reads sales orders (VBAP) instead, which shows ${inr(Math.max(0, hidden))} more demand.` });
    let sapC = 0, aiC = 0, sapA = 0, aiA = 0;
    for (const r of rows) { if (r.abc === 'C' || r.stop) { sapC += r.sap.ss * r.price; aiC += r.ai.ss * r.price; } if (r.abc === 'A' && !r.stop) { sapA += r.sap.ss * r.price; aiA += r.ai.ss * r.price; } }
    F.push({ sev: 'warning', v: Math.abs(sapC - aiC) + Math.abs(sapA - aiA), html: `<b>Safety stock sits on the wrong parts.</b> SAP holds ${inr(sapC)} of safety stock on C-class and non-moving parts (AI: ${inr(aiC)}) and ${inr(sapA)} on A-class parts (AI: ${inr(aiA)}). SAP sets safety stock as weeks of cover and ignores how volatile each part is.` });
    const ex = rows.filter(r => !r.dead && r.excessValue > 0);
    const exV = ex.reduce((a, r) => a + r.excessValue, 0);
    const dead = rows.filter(r => r.dead && r.stock > 0); const deadV = dead.reduce((a, r) => a + r.stockValue, 0);
    if (exV + deadV > 0) F.push({ sev: 'good', v: exV + deadV, html: `<b>${inr(exV + deadV)} of working capital can be released</b>: ${inr(exV)} of stock on ${nf(ex.length)} parts sits above the AI maximum, and ${nf(dead.length)} parts worth ${inr(deadV)} had no demand for 52 weeks.` });
    const out = rows.reduce((a, r) => a + r.outliers.length, 0);
    if (out) F.push({ sev: 'warning', v: 1e5, html: `<b>${nf(out)} one-off bulk orders</b> were detected and kept out of the variability calculation, so a single project order does not permanently inflate safety stock.` });
    const trans = rows.flatMap(r => r.actions.filter(a => a.type === 'transfer'));
    if (trans.length) F.push({ sev: 'good', v: trans.reduce((a, x) => a + x.value, 0), html: `<b>${nf(trans.length)} replenishment needs can be met by a stock transfer</b> from the other plant (${inr(trans.reduce((a, x) => a + x.value, 0))}) instead of a new purchase order.` });
    return F.sort((a, b) => b.v - a.v);
  }

  function abcxyz(rows) {
    const cell = {};
    for (const r of rows) {
      const k = r.dead ? 'dead' : r.abc + r.xyz; const c = cell[k] || (cell[k] = { n: 0, sap: 0, ai: 0 });
      c.n++; c.sap += r.sap.ss * r.price; c.ai += r.ai.ss * r.price;
    }
    const td = (k) => { const c = cell[k]; if (!c) return '<td class="muted">–</td>'; const d = c.ai - c.sap; return `<td><div class="num"><b>${nf(c.n)}</b> parts</div><div class="num muted" style="font-size:12px">${inr(c.sap)} → ${inr(c.ai)}</div><div class="num ${d > 0 ? 'up' : 'down'}" style="font-size:12px">${d > 0 ? '+' : ''}${inr(d)}</div></td>`; };
    const dc = cell.dead;
    return `<div class="table-wrap"><table><thead><tr><th></th><th>X · steady</th><th>Y · variable</th><th>Z · highly variable</th></tr></thead><tbody>
      ${['A', 'B', 'C'].map(a => `<tr><th style="position:static">${a}</th>${td(a + 'X')}${td(a + 'Y')}${td(a + 'Z')}</tr>`).join('')}
      </tbody></table></div>${dc ? `<p class="note" style="margin-top:8px">Plus ${nf(dc.n)} parts with no demand in 52 weeks: safety stock ${inr(dc.sap)} → ${inr(dc.ai)}.</p>` : ''}`;
  }

  function drawFrontier() {
    const c = colors(), bt = state.bt, cr = (x) => x / 1e7;
    const pts = bt.frontier.map(f => ({ x: cr(f.inv), y: f.fill * 100, mult: f.mult }));
    const sel = { x: cr(state.aiRun.inv), y: state.aiRun.fill * 100 };
    chart('c-frontier', {
      type: 'scatter',
      data: {
        datasets: [
          { label: 'AI policy at different budgets', data: pts, showLine: true, borderColor: c.ai, backgroundColor: c.ai, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.25 },
          { label: 'Selected AI policy', data: [sel], borderColor: c.ai, backgroundColor: c.surface, borderWidth: 3, pointRadius: 8, pointHoverRadius: 9 },
          { label: 'Service targets by class', data: [{ x: cr(bt.matrix.inv), y: bt.matrix.fill * 100 }], backgroundColor: c.orange, borderColor: c.surface, borderWidth: 2, pointStyle: 'triangle', pointRadius: 8 },
          { label: 'SAP MRP today', data: [{ x: cr(bt.sap.inv), y: bt.sap.fill * 100 }], backgroundColor: c.sap, borderColor: c.surface, borderWidth: 2, pointStyle: 'rectRot', pointRadius: 9, pointHoverRadius: 10 },
        ],
      },
      options: baseOpts({
        scales: { x: axis('Average stock value (₹ crore)', { ticks: { color: c.muted, callback: v => '₹' + v + ' Cr' } }), y: axis('Fill rate (% of ordered value)', { ticks: { color: c.muted, callback: v => v + '%' } }) },
        plugins: {
          legend: baseOpts().plugins.legend,
          tooltip: Object.assign({}, baseOpts().plugins.tooltip, { callbacks: { label: (ctx) => `${ctx.dataset.label}: fill ${ctx.parsed.y.toFixed(1)}%, stock ₹${ctx.parsed.x.toFixed(2)} Cr` + (ctx.raw.mult ? ` (budget ${Math.round(ctx.raw.mult * 100)}% of SAP)` : '') } }),
        },
      }),
    });
  }

  function drawCategory(rows) {
    const c = colors(), g = {};
    for (const r of rows) { const x = g[r.MATKL] || (g[r.MATKL] = { sap: 0, ai: 0 }); x.sap += r.sap.ss * r.price; x.ai += r.ai.ss * r.price; }
    const names = { FILT: 'Filters', LUBE: 'Lubricants', GET: 'Ground engaging', UCAR: 'Undercarriage', HYDR: 'Hydraulics', ELEC: 'Electricals', ENGN: 'Engine parts', TRNS: 'Transmission', BRNG: 'Bearings & seals', FAST: 'Fasteners' };
    const keys = Object.keys(g).sort((a, b) => Math.max(g[b].sap, g[b].ai) - Math.max(g[a].sap, g[a].ai));
    chart('c-cat', {
      type: 'bar',
      data: { labels: keys.map(k => names[k] || k), datasets: [
        { label: 'SAP safety stock', data: keys.map(k => g[k].sap / 1e5), backgroundColor: c.sap, borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.7 },
        { label: 'AI safety stock', data: keys.map(k => g[k].ai / 1e5), backgroundColor: c.ai, borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.7 },
      ] },
      options: baseOpts({ indexAxis: 'y', scales: { x: axis('₹ lakh', { ticks: { color: c.muted, callback: v => '₹' + v + ' L' } }), y: axis('', { grid: { display: false } }) },
        plugins: { legend: baseOpts().plugins.legend, tooltip: Object.assign({}, baseOpts().plugins.tooltip, { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${inr(ctx.parsed.x * 1e5)}` } }) } }),
    });
  }

  function drawModels(rows) {
    const c = colors();
    const pats = ['smooth', 'erratic', 'intermittent', 'lumpy', 'none'];
    const models = [...new Set(rows.map(r => r.fcMethod))].filter(m => m !== '-');
    const palette = [c.ai, '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
    chart('c-models', {
      type: 'bar',
      data: { labels: pats.map(p => PATTERN[p]), datasets: models.map((m, i) => ({ label: m, data: pats.map(p => rows.filter(r => r.pattern === p && r.fcMethod === m).length), backgroundColor: palette[i % palette.length], borderColor: c.surface, borderWidth: { top: 0, bottom: 0, left: 0, right: 2 }, borderSkipped: false })).concat([{ label: 'No forecast (no demand)', data: pats.map(p => rows.filter(r => r.pattern === p && r.fcMethod === '-').length), backgroundColor: c.slate, borderColor: c.surface, borderWidth: 0 }]) },
      options: baseOpts({ indexAxis: 'y', scales: { x: axis('Parts', { stacked: true }), y: axis('', { stacked: true, grid: { display: false } }) } }),
    });
  }

  // ---------------- recommendations ----------------
  function actionTypes(r) { return r.actions.map(a => a.type); }
  function shortAction(a) {
    return { reorder: a.sev === 'critical' ? 'Order now' : 'Reorder', transfer: 'Transfer', excess: 'Excess stock', dead: a.sev === 'critical' ? 'Dead stock' : 'Slow-moving', master: a.title.startsWith('Raise') ? 'Raise safety stock' : a.title.startsWith('Lower') ? 'Lower safety stock' : 'Stop replenishing', leadtime: 'Fix PLIFZ' }[a.type] || a.title;
  }
  function topAction(r) { const a = r.actions.slice().sort((x, y) => SEV_ORDER[x.sev] - SEV_ORDER[y.sev])[0]; return a; }

  function filteredRecs() {
    const f = state.f; const q = f.q.trim().toLowerCase();
    let rows = visible().filter(r =>
      (!q || r.MATNR.includes(q) || r.MAKTX.toLowerCase().includes(q) || (r.supplier.NAME1 || '').toLowerCase().includes(q)) &&
      (f.cls === 'all' || (f.cls === 'dead' ? r.stop : (r.abc === f.cls[0] && (f.cls.length === 1 || r.xyz === f.cls[1])))) &&
      (f.pattern === 'all' || r.pattern === f.pattern) &&
      (f.dir === 'all' || (f.dir === 'up' ? r.ssDelta > 0 : f.dir === 'down' ? r.ssDelta < 0 : r.ssDelta === 0)) &&
      (f.action === 'all' || actionTypes(r).includes(f.action)));
    const k = state.sort.key, d = state.sort.dir;
    const val = { absDelta: r => Math.abs(r.ssDeltaValue), delta: r => r.ssDeltaValue, MATNR: r => r.MATNR, MAKTX: r => r.MAKTX, WERKS: r => r.WERKS, cls: r => r.cls, pattern: r => r.pattern, fc: r => r.weeklyFc, lt: r => r.lt.mean - r.sap.plifz, ss: r => r.ai.ss, rop: r => r.ai.rop, stock: r => r.stockValue, fill: r => r.svc, lost: r => r.lost52Value }[k] || (r => 0);
    rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
    return rows;
  }

  function renderRecs() {
    const el = $('#view-recs');
    const f = state.f;
    if (!el.dataset.built) {
      el.innerHTML = `<div class="panel">
        <div class="panel-head"><div><h3>Safety stock recommendations by material and plant</h3><p>Current SAP MRP settings next to the AI recommendation for the selected policy. Click a row for the full explanation.</p></div>
          <button class="btn btn-primary" id="dl-change">Download SAP change file (CSV)</button></div>
        <div class="filters">
          <input type="search" id="f-q" placeholder="Search material, description, supplier" aria-label="Search">
          <select id="f-cls" aria-label="Class"><option value="all">All classes</option>${['A', 'B', 'C'].map(a => `<option value="${a}">${a} (all)</option>` + ['X', 'Y', 'Z'].map(x => `<option value="${a + x}">${a + x}</option>`).join('')).join('')}<option value="dead">No recent demand</option></select>
          <select id="f-pattern" aria-label="Demand pattern"><option value="all">All demand patterns</option>${Object.entries(PATTERN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select id="f-dir" aria-label="Change"><option value="all">Any change</option><option value="up">Safety stock up</option><option value="down">Safety stock down</option><option value="same">Unchanged</option></select>
          <select id="f-action" aria-label="Action"><option value="all">Any action</option><option value="reorder">Reorder / order now</option><option value="transfer">Transfer between plants</option><option value="excess">Excess stock</option><option value="dead">Dead or slow-moving</option><option value="master">Update EISBE / MINBE</option><option value="leadtime">Correct PLIFZ</option></select>
          <span class="count" id="f-count"></span>
        </div>
        <div class="table-wrap scroll" id="rec-table"></div>
      </div>`;
      el.dataset.built = '1';
      $('#f-q').addEventListener('input', e => { state.f.q = e.target.value; drawRecTable(); });
      ['cls', 'pattern', 'dir', 'action'].forEach(k => $('#f-' + k).addEventListener('change', e => { state.f[k] = e.target.value; drawRecTable(); }));
      $('#dl-change').addEventListener('click', downloadChangeFile);
    }
    $('#f-q').value = f.q; $('#f-cls').value = f.cls; $('#f-pattern').value = f.pattern; $('#f-dir').value = f.dir; $('#f-action').value = f.action;
    drawRecTable();
  }

  function drawRecTable() {
    const rows = filteredRecs();
    $('#f-count').textContent = `${nf(rows.length)} of ${nf(visible().length)} parts`;
    const th = (k, label, cls) => `<th class="sortable ${cls || ''}" data-k="${k}">${label}${state.sort.key === k ? ` <span class="arrow">${state.sort.dir < 0 ? '▼' : '▲'}</span>` : ''}</th>`;
    const LIMIT = 400;
    const body = rows.slice(0, LIMIT).map(r => {
      const a = topAction(r);
      const ltCls = r.lt.mean > r.sap.plifz * 1.2 && r.lt.mean - r.sap.plifz >= 3 ? 'up' : '';
      return `<tr class="clickable" data-key="${esc(r.key)}">
        <td class="mono">${esc(r.MATNR)}</td><td class="desc">${esc(r.MAKTX)}</td><td class="mono">${esc(r.WERKS)}</td>
        <td><span class="cls">${esc(r.cls)}</span></td><td>${PATTERN[r.pattern]}</td>
        <td class="r num">${nf(r.weeklyFc)}</td>
        <td class="r num">${r.sap.plifz}<span class="arrow-to">→</span><span class="${ltCls}">${nf(r.lt.mean, 0)}</span></td>
        <td class="r num">${nf(r.sap.ss)}<span class="arrow-to">→</span><b>${nf(r.ai.ss)}</b></td>
        <td class="r num ${r.ssDelta > 0 ? 'up' : r.ssDelta < 0 ? 'down' : ''}">${r.ssDelta ? (r.ssDelta > 0 ? '+' : '') + inr(r.ssDeltaValue) : '–'}</td>
        <td class="r num">${nf(r.sap.rop)}<span class="arrow-to">→</span>${nf(r.ai.rop)}</td>
        <td class="r num">${nf(r.stock)}</td>
        <td class="r num">${r.stop ? '–' : pct(r.svc, 0)}</td>
        <td>${a ? chip(a.sev, shortAction(a)) + (r.actions.length > 1 ? ` <span class="muted">+${r.actions.length - 1}</span>` : '') : '<span class="muted">No change</span>'}</td>
      </tr>`;
    }).join('');
    $('#rec-table').innerHTML = `<table><thead><tr>${th('MATNR', 'Material')}${th('MAKTX', 'Description')}${th('WERKS', 'Plant')}${th('cls', 'Class')}${th('pattern', 'Demand')}${th('fc', 'Fcst / wk', 'r')}${th('lt', 'Lead time d<br>SAP → actual', 'r')}${th('ss', 'Safety stock<br>SAP → AI', 'r')}${th('absDelta', 'Change ₹', 'r')}${th('rop', 'Reorder point<br>SAP → AI', 'r')}${th('stock', 'Stock', 'r')}${th('fill', 'Fill target', 'r')}<th>Top action</th></tr></thead><tbody>${body}</tbody></table>${rows.length > LIMIT ? `<p class="note" style="padding:10px">Showing the first ${LIMIT} rows. Narrow the filters or download the CSV for all ${nf(rows.length)}.</p>` : ''}`;
    $$('#rec-table th.sortable').forEach(h => h.addEventListener('click', () => { const k = h.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 }; drawRecTable(); }));
    $$('#rec-table tr.clickable').forEach(tr => tr.addEventListener('click', () => { state.part = tr.dataset.key; setTab('part'); }));
  }

  // ---------------- part detail ----------------
  function renderPart() {
    const el = $('#view-part');
    const all = state.rec.results;
    const r = all.find(x => x.key === state.part) || all[0];
    state.part = r.key;
    const s = r.sku, prep = state.model.prep;
    const u = r.MEINS === 'L' ? 'L' : 'units';
    const idx = all.indexOf(r);
    const opts = all.slice().sort((a, b) => b.annualValue - a.annualValue).map(x => `<option value="${esc(x.MATNR + ' · ' + x.WERKS + ' · ' + x.MAKTX)}"></option>`).join('');
    const btS = r.bt.sap, btA = r.bt.ai;
    el.innerHTML = `
      <div class="panel">
        <div class="part-head">
          <div class="part-title">
            <div class="eyebrow">Part detail</div>
            <h2>${esc(r.MAKTX)}</h2>
            <div class="part-meta"><span class="mono">${esc(r.MATNR)}</span>·<span>Plant ${esc(r.WERKS)} (${esc(r.plant)})</span>·<span class="cls">${esc(r.cls)}</span><span class="chip chip-plain">${PATTERN[r.pattern]} demand</span>·<span>${esc(r.supplier.NAME1)} (${esc(r.supplier.LAND1 || '')})</span>·<span>${inr(r.price)} / ${esc(r.MEINS)}</span></div>
          </div>
          <div class="filters" style="margin:0">
            <input type="search" id="part-q" list="part-list" placeholder="Find a part: number or name" aria-label="Find a part" style="min-width:280px">
            <datalist id="part-list">${opts}</datalist>
            <button class="btn" id="part-prev" aria-label="Previous part">←</button><button class="btn" id="part-next" aria-label="Next part">→</button>
          </div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Recommendation</h3><p>Change these MRP fields in SAP (transaction MM02 or mass change MM17).</p></div></div>
          <div class="bigdelta"><span class="eyebrow">Safety stock</span><span class="from num">${nf(r.sap.ss)}</span><span class="arrow-to">→</span><span class="to num">${nf(r.ai.ss)}</span><span class="muted">${u}${r.ssDelta ? ` · ${r.ssDelta > 0 ? '+' : ''}${inr(r.ssDeltaValue)}` : ''}</span></div>
          <div class="table-wrap" style="margin-top:12px"><table class="fields"><thead><tr><th>SAP field</th><th>Meaning</th><th class="r">Today</th><th class="r">AI</th></tr></thead><tbody>
            <tr><td>MARC-EISBE</td><td>Safety stock</td><td class="r num">${nf(r.sap.ss)}</td><td class="r num"><b>${nf(r.ai.ss)}</b></td></tr>
            <tr><td>MARC-MINBE</td><td>Reorder point</td><td class="r num">${nf(r.sap.rop)}</td><td class="r num"><b>${nf(r.ai.rop)}</b></td></tr>
            <tr><td>MARC-MABST</td><td>Maximum stock level</td><td class="r num">${nf(r.sap.max)}</td><td class="r num"><b>${nf(r.ai.max)}</b></td></tr>
            <tr><td>MARC-PLIFZ</td><td>Planned delivery time (days)</td><td class="r num">${r.sap.plifz}</td><td class="r num"><b>${nf(r.lt.mean, 0)}</b></td></tr>
          </tbody></table></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${r.actions.length ? r.actions.map(a => chip(a.sev, a.title)).join('') : '<span class="muted">No action needed.</span>'}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Why</h3><p>Generated from this part's SAP history.</p></div></div>
          <ul class="why">${r.explain.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <dl class="kv" style="margin-top:14px">
            <dt>Stock on hand</dt><dd class="num">${nf(r.stock)} ${u} (${inr(r.stockValue)}), ${isFinite(r.coverWeeks) ? nf(r.coverWeeks) + ' weeks of cover' : 'no forecast demand'}</dd>
            <dt>Open purchase orders</dt><dd class="num">${nf(r.openQty)} ${u}</dd>
            <dt>Order quantity (AI)</dt><dd class="num">${nf(r.ai.q)} ${u} (economic order quantity, rounded to MARC-BSTRF ${s.marc.BSTRF || 1})</dd>
            <dt>Sizing method</dt><dd>${esc(r.method)}</dd>
            <dt>Supplier on time</dt><dd>${r.lt.onTime != null ? pct(r.lt.onTime, 0) + ' of POs within 2 days of EKET-EINDT' : 'no history'}</dd>
          </dl>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Weekly customer demand, 104 weeks</h3><p>Sales orders (VBAP) split into what was delivered (LIPS) and what could not be supplied. The line is the winning forecast model, fitted week by week.</p></div></div>
        <div class="chart-box"><canvas id="c-demand" role="img" aria-label="Weekly demand, unfilled demand and forecast"></canvas></div>
      </div>
      <div class="grid-3">
        <div class="panel">
          <div class="panel-head"><div><h3>Actual supplier lead times</h3><p>PO date (EKKO-BEDAT) to goods receipt (EKBE-BUDAT), ${nf(r.lt.n)} POs.</p></div></div>
          <div class="chart-box short"><canvas id="c-lt" role="img" aria-label="Histogram of actual lead times with SAP planned time"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Demand during lead time</h3><p>Simulated scenarios; the reorder point must cover the right-hand tail.</p></div></div>
          <div class="chart-box short"><canvas id="c-ltd" role="img" aria-label="Distribution of demand during lead time"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Service vs stock for this part</h3><p>Digital twin: each point is one reorder point.</p></div></div>
          <div class="chart-box short"><canvas id="c-curve" role="img" aria-label="Fill rate versus average stock for candidate reorder points"></canvas></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Backtest for this part</h3><p>Last 52 weeks of actual orders, after a 52-week warm-up.</p></div></div>
          <div class="table-wrap"><table><thead><tr><th></th><th class="r">SAP MRP today</th><th class="r">AI policy</th></tr></thead><tbody>
            <tr><td>Fill rate</td><td class="r num">${pct(btS.fill)}</td><td class="r num"><b>${pct(btA.fill)}</b></td></tr>
            <tr><td>Average stock value</td><td class="r num">${inr(btS.avgInv)}</td><td class="r num"><b>${inr(btA.avgInv)}</b></td></tr>
            <tr><td>Days with unfilled demand</td><td class="r num">${nf(btS.soDays)}</td><td class="r num"><b>${nf(btA.soDays)}</b></td></tr>
            <tr><td>Purchase orders placed</td><td class="r num">${nf(btS.orders)}</td><td class="r num"><b>${nf(btA.orders)}</b></td></tr>
            <tr><td>Value of lost sales</td><td class="r num">${inr(btS.lostValue)}</td><td class="r num"><b>${inr(btA.lostValue)}</b></td></tr>
          </tbody></table></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Forecast model competition</h3><p>Root-mean-square error of one-week-ahead forecasts on the last 26 weeks. Lowest wins.</p></div></div>
          ${r.fcTried.length ? `<div class="table-wrap"><table><thead><tr><th>Model</th><th class="r">Error (${esc(u)}/wk)</th><th></th></tr></thead><tbody>${r.fcTried.map((m, i) => `<tr><td>${esc(m.name)}</td><td class="r num">${nf(m.rmse, 2)}</td><td>${i === 0 ? chip('good', 'Selected') : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No demand in the last 52 weeks, so no forecast is needed.</p>'}
        </div>
      </div>`;
    const go = (d) => { state.part = all[(idx + d + all.length) % all.length].key; renderPart(); };
    $('#part-prev').addEventListener('click', () => go(-1));
    $('#part-next').addEventListener('click', () => go(1));
    $('#part-q').addEventListener('change', (e) => {
      const v = e.target.value.trim(); const m = v.split(' · ');
      const hit = all.find(x => m.length >= 2 ? x.MATNR === m[0] && x.WERKS === m[1] : x.MATNR === v || x.MAKTX.toLowerCase().includes(v.toLowerCase()));
      if (hit) { state.part = hit.key; renderPart(); } else toast('No part matches “' + v + '”.');
    });
    drawPartCharts(r);
  }

  function drawPartCharts(r) {
    const c = colors(), s = r.sku, prep = state.model.prep;
    const dem = E.weekly(s.demandDay, 0, prep.days), del = E.weekly(s.deliveredDay, 0, prep.days);
    const labels = dem.map((_, i) => new Date(prep.start + i * 7 * 86400000).toISOString().slice(2, 10));
    const pol = state.model.pols[state.rec.results.indexOf(r)];
    const fitted = pol.fc ? pol.fc.best.fitted : null;
    chart('c-demand', {
      type: 'bar',
      data: { labels, datasets: [
        { type: 'line', label: 'Forecast: ' + r.fcMethod, data: fitted ? fitted.map(x => +x.toFixed(2)) : [], borderColor: c.ai, backgroundColor: c.ai, borderWidth: 2, pointRadius: 0, tension: 0.2, order: 0 },
        { label: 'Delivered', data: del, backgroundColor: c.slate, stack: 'd', order: 1, borderRadius: 2 },
        { label: 'Not supplied (stockout)', data: dem.map((x, i) => Math.max(0, x - del[i])), backgroundColor: c.critical, stack: 'd', order: 1, borderRadius: 2 },
      ] },
      options: baseOpts({ scales: { x: axis('', { stacked: true, grid: { display: false }, ticks: { color: c.muted, maxTicksLimit: 12, maxRotation: 0 } }), y: axis(r.MEINS === 'L' ? 'Litres per week' : 'Units per week', { stacked: true, beginAtZero: true }) }, interaction: { mode: 'index', intersect: false } }),
    });
    // lead-time histogram
    const obs = s.pos.filter(p => p.lt != null).map(p => p.lt);
    if (obs.length) {
      const lo = Math.min(...obs, r.sap.plifz), hi = Math.max(...obs, r.sap.plifz);
      const bw = Math.max(1, Math.ceil((hi - lo + 1) / 16));
      const bins = []; for (let x = Math.floor(lo / bw) * bw; x <= hi; x += bw) bins.push(x);
      const counts = bins.map(b => obs.filter(v => v >= b && v < b + bw).length);
      const pos = (v) => (v - bins[0]) / bw - 0.5;
      chart('c-lt', {
        type: 'bar',
        data: { labels: bins.map(b => bw > 1 ? `${b}–${b + bw - 1}` : String(b)), datasets: [{ label: 'Purchase orders', data: counts, backgroundColor: c.ai, borderRadius: 3, barPercentage: 0.9, categoryPercentage: 1 }] },
        options: baseOpts({ plugins: { legend: { display: false }, tooltip: baseOpts().plugins.tooltip, vlines: { lines: [{ x: pos(r.sap.plifz + 0.5), color: c.sap, label: `SAP plan ${r.sap.plifz} d`, dash: [4, 3] }, { x: pos(r.lt.mean + 0.5), color: c.ink, label: `Actual avg ${nf(r.lt.mean, 0)} d` }] } }, scales: { x: axis('Days', { grid: { display: false }, ticks: { color: c.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }), y: axis('POs', { beginAtZero: true, ticks: { precision: 0, color: c.muted } }) } }),
      });
    }
    // lead-time demand distribution
    if (pol.ltd && pol.ltd.sorted.length) {
      const d = pol.ltd.sorted; const hi = Math.max(d[d.length - 1], r.ai.rop, r.sap.rop) || 1;
      const nb = 24, bw = hi / nb; const counts = new Array(nb + 1).fill(0);
      d.forEach(v => counts[Math.min(nb, Math.floor(v / bw))]++);
      const labels2 = counts.map((_, i) => nf(i * bw));
      chart('c-ltd', {
        type: 'bar',
        data: { labels: labels2, datasets: [{ label: 'Share of scenarios', data: counts.map(x => +(x / d.length * 100).toFixed(1)), backgroundColor: c.aiSoft, borderColor: c.ai, borderWidth: 1, barPercentage: 1, categoryPercentage: 1 }] },
        options: baseOpts({ plugins: { legend: { display: false }, tooltip: Object.assign({}, baseOpts().plugins.tooltip, { callbacks: { title: (it) => `Demand ≈ ${it[0].label}`, label: (ctx) => `${ctx.parsed.y}% of scenarios` } }), vlines: { lines: [{ x: r.sap.rop / bw - 0.5, color: c.sap, label: `SAP ROP ${nf(r.sap.rop)}`, dash: [4, 3] }, { x: r.ai.rop / bw - 0.5, color: c.ai, textColor: c.ink, label: `AI ROP ${nf(r.ai.rop)}` }] } }, scales: { x: axis(r.MEINS === 'L' ? 'Litres during lead time' : 'Units during lead time', { grid: { display: false }, ticks: { color: c.muted, maxTicksLimit: 7, maxRotation: 0 } }), y: axis('% of scenarios', { beginAtZero: true }) } }),
      });
    } else $('#c-ltd').closest('.panel').querySelector('.chart-box').innerHTML = '<p class="muted">No demand to simulate.</p>';
    // service curve
    if (!r.stop && r.curve.length > 1) {
      const pts = r.curve.map(p => ({ x: p.inv / 1e5, y: p.fill * 100, R: p.rop }));
      const cur = r.curve.find(p => p.rop === r.ai.rop) || r.curve[0];
      chart('c-curve', {
        type: 'scatter',
        data: { datasets: [
          { label: 'Candidate reorder points', data: pts, showLine: true, borderColor: c.ai, backgroundColor: c.ai, borderWidth: 2, pointRadius: 3 },
          { label: 'AI choice', data: [{ x: cur.inv / 1e5, y: cur.fill * 100, R: cur.rop }], backgroundColor: c.surface, borderColor: c.ai, borderWidth: 3, pointRadius: 7 },
          { label: 'SAP settings', data: [{ x: r.sapTwin.inv / 1e5, y: r.sapTwin.fill * 100, R: r.sap.rop }], backgroundColor: c.sap, borderColor: c.surface, borderWidth: 2, pointStyle: 'rectRot', pointRadius: 8 },
        ] },
        options: baseOpts({ scales: { x: axis('Average stock (₹ lakh)', { ticks: { color: c.muted, callback: v => '₹' + v + ' L' } }), y: axis('Fill rate %', { ticks: { color: c.muted, callback: v => v + '%' } }) }, plugins: { legend: baseOpts().plugins.legend, tooltip: Object.assign({}, baseOpts().plugins.tooltip, { callbacks: { label: (ctx) => `${ctx.dataset.label}: reorder point ${ctx.raw.R}, fill ${ctx.parsed.y.toFixed(1)}%, stock ₹${ctx.parsed.x.toFixed(1)} L` } }) } }),
      });
    } else $('#c-curve').closest('.panel').querySelector('.chart-box').innerHTML = '<p class="muted">Not stocked: no recent demand.</p>';
  }

  // ---------------- action center ----------------
  const ACTION_GROUPS = [
    { id: 'risk', title: 'Order now: stockout risk', test: a => a.type === 'reorder' && a.sev === 'critical', sev: 'critical', note: 'Stock will run out before a new purchase order can arrive.' },
    { id: 'transfer', title: 'Transfer between plants', test: a => a.type === 'transfer', sev: 'warning', note: 'The other plant holds surplus of the same material. Use a stock transport order (UB) instead of buying.' },
    { id: 'reorder', title: 'Reorder', test: a => a.type === 'reorder' && a.sev !== 'critical', sev: 'warning', note: 'Inventory position is at or below the AI reorder point.' },
    { id: 'excess', title: 'Excess stock: pause purchasing', test: a => a.type === 'excess', sev: 'serious', note: 'Stock above the AI maximum. Stop open requisitions and let it sell down, or transfer.' },
    { id: 'dead', title: 'Dead and slow-moving stock', test: a => a.type === 'dead', sev: 'critical', note: 'No demand for 26–52 weeks. Candidates for redeployment, return to supplier, liquidation or scrap.' },
    { id: 'master', title: 'Update safety stock and reorder point in SAP', test: a => a.type === 'master', sev: 'warning', note: 'Mass change with MM17 using the downloadable change file.' },
    { id: 'leadtime', title: 'Correct planned delivery time (MARC-PLIFZ)', test: a => a.type === 'leadtime', sev: 'serious', note: 'SAP plans with a lead time that suppliers do not achieve (or beat).' },
  ];

  function renderActions() {
    const el = $('#view-actions');
    const rows = visible();
    const items = rows.flatMap(r => r.actions.map(a => ({ r, a })));
    el.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Action center</h3><p>Everything the planner, buyer and finance team should do this week, grouped and ranked by value. The same list can feed SAP (MM17 mass change, ME21N purchase orders, UB stock transfers).</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="dl-actions">Download all actions (CSV)</button><button class="btn btn-primary" id="dl-change2">Download SAP change file (CSV)</button></div></div>
      <div class="agroups">${ACTION_GROUPS.map((g, gi) => {
        const list = items.filter(x => g.test(x.a)).sort((x, y) => y.a.value - x.a.value);
        const sum = list.reduce((s, x) => s + (x.a.value || 0), 0);
        return `<details class="agroup panel" ${gi < 2 ? 'open' : ''} style="box-shadow:none">
          <summary><span class="caret">▸</span>${chip(g.sev, nf(list.length))}<h3>${g.title}</h3><span class="sum">${sum ? inr(sum) : ''}</span></summary>
          <p class="note" style="margin-top:6px">${g.note}</p>
          ${list.length ? `<div class="table-wrap scroll" style="max-height:420px"><table><thead><tr><th>Material</th><th>Description</th><th>Plant</th><th>Class</th><th>Action</th><th>Detail</th><th class="r">Value</th></tr></thead><tbody>
            ${list.slice(0, 250).map(({ r, a }) => `<tr class="clickable" data-key="${esc(r.key)}"><td class="mono">${esc(r.MATNR)}</td><td>${esc(r.MAKTX)}</td><td class="mono">${esc(r.WERKS)}</td><td><span class="cls">${esc(r.cls)}</span></td><td>${esc(a.title)}</td><td class="wrap">${esc(a.detail)}</td><td class="r num">${a.value ? inr(a.value) : '–'}</td></tr>`).join('')}
          </tbody></table></div>${list.length > 250 ? `<p class="note">Top 250 of ${nf(list.length)} shown; the CSV has all.</p>` : ''}` : '<p class="muted" style="margin-top:8px">Nothing to do.</p>'}
        </details>`;
      }).join('')}</div></div>`;
    $$('#view-actions tr.clickable').forEach(tr => tr.addEventListener('click', () => { state.part = tr.dataset.key; setTab('part'); }));
    $('#dl-actions').addEventListener('click', () => {
      const out = [['MATNR', 'MAKTX', 'WERKS', 'CLASS', 'ACTION_TYPE', 'SEVERITY', 'ACTION', 'DETAIL', 'QTY', 'VALUE_INR']];
      items.forEach(({ r, a }) => out.push([r.MATNR, r.MAKTX, r.WERKS, r.cls, a.type, a.sev, a.title, a.detail, a.qty || '', Math.round(a.value || 0)]));
      download('safety_stock_actions.csv', toCSV(out));
    });
    $('#dl-change2').addEventListener('click', downloadChangeFile);
  }

  function downloadChangeFile() {
    const out = [['MATNR', 'WERKS', 'EISBE_OLD', 'EISBE_NEW', 'MINBE_OLD', 'MINBE_NEW', 'MABST_OLD', 'MABST_NEW', 'PLIFZ_OLD', 'PLIFZ_NEW', 'FILL_TARGET', 'REASON']];
    visible().forEach(r => {
      const plif = r.lt.n >= 3 ? Math.round(r.lt.mean) : r.sap.plifz;
      if (r.ai.ss !== r.sap.ss || r.ai.rop !== r.sap.rop || r.ai.max !== r.sap.max || plif !== r.sap.plifz)
        out.push([r.MATNR, r.WERKS, r.sap.ss, r.ai.ss, r.sap.rop, r.ai.rop, r.sap.max, r.ai.max, r.sap.plifz, plif, r.stop ? '' : r.svc.toFixed(3), r.explain[r.explain.length - 1]]);
    });
    download('sap_mrp_change_file_MM17.csv', toCSV(out));
  }

  // ---------------- suppliers ----------------
  function renderSuppliers() {
    const el = $('#view-suppliers');
    const g = {};
    for (const r of visible()) {
      for (const p of r.sku.pos) {
        if (p.lt == null) continue;
        const x = g[p.LIFNR] || (g[p.LIFNR] = { lifnr: p.LIFNR, lts: [], plan: [], late: [], parts: new Set(), value: 0 });
        x.lts.push(p.lt); x.plan.push(r.sap.plifz); if (p.late != null) x.late.push(p.late); x.parts.add(r.key); x.value += p.qty * r.price;
      }
    }
    const sup = state.model.prep.suppliers;
    const rows = Object.values(g).map(x => {
      const m = x.lts.reduce((a, b) => a + b, 0) / x.lts.length; const pm = x.plan.reduce((a, b) => a + b, 0) / x.plan.length;
      const sdv = Math.sqrt(x.lts.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, x.lts.length - 1));
      return { lifnr: x.lifnr, name: (sup[x.lifnr] || {}).NAME1 || x.lifnr, land: (sup[x.lifnr] || {}).LAND1 || '', pos: x.lts.length, parts: x.parts.size, mean: m, plan: pm, sd: sdv, cv: sdv / (m || 1), onTime: x.late.length ? x.late.filter(v => v <= 2).length / x.late.length : null, late: x.late.length ? x.late.reduce((a, b) => a + b, 0) / x.late.length : 0, value: x.value };
    }).sort((a, b) => (b.mean - b.plan) - (a.mean - a.plan));
    el.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Planned vs actual supplier lead time</h3><p>SAP plans with MARC-PLIFZ. Actual = goods receipt date (EKBE-BUDAT) minus PO date (EKKO-BEDAT). Wide variation needs more safety stock, even when the average is right.</p></div><div class="legend"><span><i class="swatch-sap"></i>SAP planned (avg PLIFZ)</span><span><i class="swatch-ai"></i>Actual average</span></div></div>
      <div class="chart-box tall" style="height:${Math.max(300, rows.length * 30 + 60)}px"><canvas id="c-sup" role="img" aria-label="Planned versus actual lead time by supplier"></canvas></div></div>
      <div class="panel"><div class="panel-head"><div><h3>Supplier scorecard</h3><p>Last two years of purchase orders for the parts in scope.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Country</th><th class="r">Parts</th><th class="r">POs</th><th class="r">PO value</th><th class="r">Planned d</th><th class="r">Actual d</th><th class="r">Gap d</th><th class="r">Variability (±d)</th><th class="r">On time</th><th class="r">Avg days late</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${esc(x.name)} <span class="muted mono">${esc(x.lifnr)}</span></td><td>${esc(x.land)}</td><td class="r num">${nf(x.parts)}</td><td class="r num">${nf(x.pos)}</td><td class="r num">${inr(x.value)}</td><td class="r num">${nf(x.plan, 0)}</td><td class="r num">${nf(x.mean, 0)}</td><td class="r num ${x.mean - x.plan > 3 ? 'up' : x.mean - x.plan < -3 ? 'down' : ''}">${x.mean - x.plan > 0 ? '+' : ''}${nf(x.mean - x.plan, 0)}</td><td class="r num">${nf(x.sd, 0)}</td><td class="r num">${x.onTime != null ? pct(x.onTime, 0) : '–'}</td><td class="r num">${nf(x.late, 1)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    const c = colors();
    chart('c-sup', {
      type: 'bar',
      data: { labels: rows.map(x => x.name), datasets: [
        { type: 'scatter', label: 'SAP planned', data: rows.map((x, i) => ({ x: x.plan, y: x.name })), backgroundColor: c.sap, borderColor: c.surface, borderWidth: 2, pointRadius: 7, pointStyle: 'rectRot' },
        { type: 'scatter', label: 'Actual average', data: rows.map((x) => ({ x: x.mean, y: x.name })), backgroundColor: c.ai, borderColor: c.surface, borderWidth: 2, pointRadius: 7 },
        { label: 'Gap', data: rows.map(x => [Math.min(x.plan, x.mean), Math.max(x.plan, x.mean)]), backgroundColor: c.line, barPercentage: 0.25, categoryPercentage: 1 },
      ] },
      options: baseOpts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: Object.assign({}, baseOpts().plugins.tooltip, { callbacks: { label: (ctx) => ctx.dataset.label === 'Gap' ? null : `${ctx.dataset.label}: ${nf(ctx.parsed.x, 0)} days` } }) }, scales: { x: axis('Days', { beginAtZero: true }), y: { type: 'category', labels: rows.map(x => x.name), grid: { display: false }, ticks: { color: c.ink2 } } } }),
    });
  }

  // ---------------- data & method ----------------
  function renderData() {
    const el = $('#view-data');
    const T = state.T;
    el.innerHTML = `
      <div class="panel"><div class="panel-head"><div><h3>How the AI sets safety stock</h3><p>What changes compared with standard SAP MRP (static MARC-EISBE and reorder point planning, MRP type VB).</p></div></div>
        <ol class="steps">
          <li><span class="n">01 · Demand</span><b>True demand, not consumption</b><span>Sales order lines (VBAP) include demand that could not be delivered. SAP forecasts from goods issues (MATDOC), which hides stockouts.</span></li>
          <li><span class="n">02 · Cleansing</span><b>Remove one-off bulk orders</b><span>Project orders beyond Q3 + 3×IQR are capped so a single order does not inflate safety stock for years.</span></li>
          <li><span class="n">03 · Segmentation</span><b>ABC × XYZ and demand pattern</b><span>Sales value, variability and Syntetos-Boylan classes (smooth, erratic, intermittent, lumpy) per material and plant.</span></li>
          <li><span class="n">04 · Forecast</span><b>Model competition per part</b><span>Moving averages, exponential smoothing, damped trend, seasonal and Croston-SBA models compete on the last 26 weeks. Lowest error wins.</span></li>
          <li><span class="n">05 · Lead time</span><b>Actual supplier performance</b><span>PO date to goods receipt from EKKO/EKBE, blended with the supplier's history when a part has few POs. Compared with MARC-PLIFZ.</span></li>
          <li><span class="n">06 · Digital twin</span><b>Simulate each part</b><span>10 years of weekly demand and lead-time scenarios are replayed under ~18 candidate reorder points, and under SAP's current settings.</span></li>
          <li><span class="n">07 · Optimise</span><b>Spend the stock budget where it earns most</b><span>Marginal analysis across all parts: each rupee of stock goes to the part where it saves the most lost sales.</span></li>
          <li><span class="n">08 · Prove</span><b>Backtest against SAP</b><span>Both policies are replayed on the actual orders of the last 52 weeks, re-calibrated every 8 weeks using only past data.</span></li>
        </ol>
      </div>
      <div class="panel"><div class="panel-head"><div><h3>SAP tables and fields to extract</h3><p>Up to 5 years of history for movements and documents; master data as current snapshot. Row counts are for the data loaded now.</p></div>
        <button class="btn" id="dl-dict">Download field list (CSV)</button></div>
        <div class="table-wrap"><table><thead><tr><th>Table</th><th>Description</th><th>Fields</th><th>Used for</th><th class="r">Rows loaded</th></tr></thead><tbody>
          ${SAP.DICTIONARY.map(d => `<tr><td class="mono"><b>${d.table}</b>${REQUIRED.includes(d.table) ? '' : ' <span class="muted">(optional)</span>'}</td><td>${esc(d.desc)}</td><td class="wrap mono" style="font-size:12px">${esc(d.fields)}</td><td class="wrap">${esc(d.use)}</td><td class="r num">${nf((T[d.table] || []).length)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="grid-2" style="margin-top:14px">
          <div><h3 style="margin-bottom:6px">Suggested selection</h3>
            <ul class="why">
              <li>MATDOC: BWART in (101, 102, 201, 202, 261, 262, 601, 602, 641, 642), BUDAT ≥ today − 5 years, WERKS in pilot plants.</li>
              <li>VBAK/VBAP: ERDAT ≥ today − 5 years, sales document types for parts sales; keep ABGRU (rejection reason) to see lost demand.</li>
              <li>EKKO/EKPO/EKET/EKBE: BEDAT ≥ today − 5 years; EKBE with VGABE = 1 (goods receipt).</li>
              <li>MARA/MARC/MARD/MBEW: materials in the pilot SKU list, current snapshot.</li>
              <li>Refresh: daily incremental by BUDAT / ERDAT / AEDAT via background job.</li>
            </ul></div>
          <div><h3 style="margin-bottom:6px">Extraction</h3>
            <ul class="why">
              <li>Works with the partner's on-premise extractor: table and field list maintained per table, WHERE conditions, full or incremental background jobs, no ABAP development or transports.</li>
              <li>Files are CSV per table with SAP technical field names, as in the sample download below.</li>
              <li>Output back to SAP is a change file for MM17 (mass maintenance of MARC fields). No automatic write-back in the pilot.</li>
            </ul></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><div><h3>Download the sample extract</h3><p>The generated SAP tables behind this demo, one CSV per table.</p></div></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">${Object.keys(T).filter(k => Array.isArray(T[k]) && T[k].length).map(k => `<button class="btn" data-dl="${k}">${k} <span class="muted num">${nf(T[k].length)}</span></button>`).join('')}</div>
          <p class="note" style="margin-top:10px">Large tables (VBAK, VBAP, LIPS, MATDOC) are several MB each.</p>
        </div>
        <div class="panel"><div class="panel-head"><div><h3>Run on your own SAP extract</h3><p>Select one CSV per table named after the table (MARA.csv, MARC.csv …). Comma, semicolon, tab or pipe separated; dates as YYYYMMDD, YYYY-MM-DD or DD.MM.YYYY.</p></div></div>
          <label class="upload" id="drop"><b>Choose CSV files or drop them here</b><span class="note">Required: ${REQUIRED.join(', ')}. Optional: ${OPTIONAL.join(', ')}. Files are processed in this browser only.</span><input type="file" id="upload" multiple accept=".csv,.txt,text/csv"></label>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${state.source !== 'sample' ? '<button class="btn" id="reset-sample">Back to sample data</button>' : ''}</div>
          <p class="note" id="upload-msg" style="margin-top:8px"></p>
        </div>
      </div>`;
    $$('[data-dl]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.dl; download(k + '.csv', tableCSV(T[k])); }));
    $('#dl-dict').addEventListener('click', () => download('sap_tables_and_fields.csv', toCSV([['TABLE', 'DESCRIPTION', 'FIELDS', 'USED_FOR']].concat(SAP.DICTIONARY.map(d => [d.table, d.desc, d.fields, d.use])))));
    const up = $('#upload'), drop = $('#drop');
    up.addEventListener('change', () => loadFiles(up.files));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', e => loadFiles(e.dataTransfer.files));
    const rs = $('#reset-sample'); if (rs) rs.addEventListener('click', () => { state.part = null; runPipeline(SAP.generate(), 'sample'); });
  }

  // ---------------- CSV ----------------
  function toCSV(rows) { return rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); }
  function tableCSV(rows) { if (!rows.length) return ''; const cols = Object.keys(rows[0]); return toCSV([cols].concat(rows.map(r => cols.map(c => r[c])))); }
  // In the claude.ai viewer, files go through its downloads capability; elsewhere a normal browser download.
  async function download(name, text) {
    const data = '\ufeff' + text;
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (!dl) { toast('Downloads are not available in this view.'); return; }
      try { await dl.save({ filename: name, data }); toast('Saved ' + name); }
      catch (e) { if (e && e.code !== 'declined') toast('Could not save ' + name + (e && e.code ? ' (' + e.code + ')' : '') + '.'); }
      return;
    }
    const blob = new Blob([data], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Downloading ' + name);
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
    const delim = [',', ';', '\t', '|'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(h => h.trim().toUpperCase().replace(/^.*[-~]/, ''));
    return rows.filter(r => r.length > 1 || (r[0] || '').trim()).map(r => { const o = {}; head.forEach((h, i) => (o[h] = (r[i] || '').trim())); return o; });
  }
  async function loadFiles(files) {
    const msg = $('#upload-msg');
    const T = {};
    for (const f of files) {
      const name = f.name.toUpperCase().replace(/\.(CSV|TXT)$/, '');
      const key = REQUIRED.concat(OPTIONAL, ['MSEG']).find(k => name === k || name.startsWith(k + '_') || name.startsWith(k + ' ') || name.startsWith(k + '-'));
      if (!key) continue;
      T[key === 'MSEG' ? 'MATDOC' : key] = parseCSV(await f.text());
    }
    const missing = REQUIRED.filter(k => !T[k] || !T[k].length);
    if (missing.length) { msg.textContent = `Missing or empty: ${missing.join(', ')}. Add these files and select all files again.`; return; }
    // normalise: strip leading zeros on material / document numbers, dates to YYYYMMDD
    const normDate = (v) => { const d = String(v).replace(/[^0-9]/g, ''); if (/^\d{2}\.\d{2}\.\d{4}/.test(v)) return v.slice(6, 10) + v.slice(3, 5) + v.slice(0, 2); return d.slice(0, 8); };
    const DATE = ['ERDAT', 'BUDAT', 'BEDAT', 'EINDT', 'WADAT_IST', 'ERSDA'];
    for (const k in T) for (const r of T[k]) {
      for (const f of DATE) if (r[f] != null) r[f] = normDate(r[f]);
      if (r.MATNR != null) r.MATNR = r.MATNR.replace(/^0+(?=\d)/, '');
      for (const f of ['MENGE', 'KWMENG', 'LFIMG', 'LABST', 'VERPR', 'STPRS', 'NETPR', 'EISBE', 'MINBE', 'MABST', 'BSTMI', 'BSTRF', 'PLIFZ']) if (r[f] != null) r[f] = r[f].replace(/\s/g, '').replace(/,(?=\d{1,3}$)/, '.').replace(/,/g, '');
    }
    msg.textContent = 'Loaded ' + Object.keys(T).map(k => `${k} (${nf(T[k].length)})`).join(', ') + '. Analysing…';
    state.part = null;
    try { await runPipeline(T, 'upload'); toast('Analysis complete on your data.'); }
    catch (e) { console.error(e); $('#loading').hidden = true; state.tab = 'data'; render(); $('#upload-msg').textContent = 'Could not analyse these files: ' + e.message; }
  }

  // ---------------- events ----------------
  $$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('.seg button').forEach(b => b.addEventListener('click', () => { state.preset = b.dataset.preset; applyPreset(); render(); }));
  $('#budget').addEventListener('input', e => { state.mult = +e.target.value; $('#budget-out').textContent = inr(state.model.sapTwin.inv * state.mult); });
  $('#budget').addEventListener('change', () => { applyPreset(); render(); });
  $('#plant').addEventListener('change', e => { state.plant = e.target.value; render(); });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render()); } catch (e) { /* old browsers */ }
  new MutationObserver(() => render()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const hash = (location.hash || '').replace('#', '');
  if (['overview', 'recs', 'part', 'actions', 'suppliers', 'data'].includes(hash)) { state.tab = hash; $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === hash))); }

  (async () => {
    progress('Generating sample SAP extract (2 years, 2 plants)', 0.01);
    await new Promise(r => setTimeout(r, 30));
    const T = SAP.generate();
    await runPipeline(T, 'sample');
  })().catch(e => { console.error(e); progress('Something went wrong: ' + e.message, 0); });
})();
