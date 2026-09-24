/* Safety Stock Studio - UI */
(function () {
  'use strict';
  const E = DZ.engine, SAP = DZ.sap;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    T: null, source: 'sample', model: null, bt: null, rec: null, cfg: null, aiRun: null,
    preset: 'balanced', mult: 1, plant: 'all', tab: 'overview', part: null,
    channelTargets: Object.assign({}, E.DEFAULT_CHANNEL),
    f: { q: '', cls: 'all', pattern: 'all', dir: 'all', action: 'all' },
    sort: { key: 'absDelta', dir: -1 },
    charts: {},
  };

  // ---------------- icons ----------------
  const ICON = {
    overview: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4.5-5"/><circle cx="12" cy="16" r="1.4"/>',
    capital: '<ellipse cx="9" cy="6.5" rx="6" ry="2.5"/><path d="M3 6.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4"/><path d="M3 10.5v4c0 1.4 2.7 2.5 6 2.5"/><ellipse cx="16" cy="14.5" rx="5" ry="2.2"/><path d="M11 14.5v3.5c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2v-3.5"/>',
    service: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    recs: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    part: '<path d="M3 8l8-4 8 4-8 4-8-4z"/><path d="M3 8v8l8 4v-8"/><circle cx="17.5" cy="16.5" r="3"/><path d="M19.8 18.8L22 21"/>',
    actions: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
    suppliers: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.6 9.6 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.8"/><path d="M6.2 6.3C3.9 7.9 2.5 12 2.5 12S6 19 12 19a9 9 0 0 0 4.2-1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    rain: '<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17.5 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
    scale: '<path d="M12 4v16M6 20h12M5 7h14"/><path d="M5 7l-3 6.5a3 3 0 0 0 6 0z"/><path d="M19 7l-3 6.5a3 3 0 0 0 6 0z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 20V9"/><path d="M7 14l5-5 5 5"/><path d="M5 4h14"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  const VIEWS = [
    { group: 'Insight' },
    { id: 'overview', label: 'Overview', crumb: 'AI safety stock · validated on history', controls: true },
    { id: 'capital', label: 'Working capital', crumb: 'Cash locked in stock and how much the AI releases', controls: true },
    { id: 'service', label: 'Service & stockouts', crumb: 'Fill rate by channel, lost sales and targets', controls: false },
    { group: 'Plan' },
    { id: 'recs', label: 'Recommendations', crumb: 'MRP settings per material and plant', controls: true },
    { id: 'part', label: 'Part explorer', crumb: 'One part, fully explained', controls: false },
    { id: 'actions', label: 'Action center', crumb: 'What to do this week', controls: true, badge: true },
    { group: 'Evidence' },
    { id: 'suppliers', label: 'Supplier lead times', crumb: 'Planned vs actual delivery', controls: false },
    { id: 'data', label: 'SAP data & method', crumb: 'Tables, fields, method and your own data', controls: false, noPlant: true },
    { group: 'Help' },
    { id: 'help', label: 'Feature guide', crumb: 'What the AI does and where to see it', controls: false, noPlant: true },
  ];

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
  const GROUPS = { FILT: 'Filters', LUBE: 'Lubricants', GET: 'Ground engaging', UCAR: 'Undercarriage', HYDR: 'Hydraulics', ELEC: 'Electricals', ENGN: 'Engine parts', TRNS: 'Transmission', BRNG: 'Bearings & seals', FAST: 'Fasteners' };
  const MONTHS = E.MONTHS;
  const PRESET_FILL = { lean: 0.86, balanced: 0.9, high: 0.94 };
  const PRESET_LABEL = { lean: 'Lean stock', balanced: 'Balanced', high: 'High service', matrix: 'Service targets', custom: 'Custom budget' };
  const SEV_ORDER = { critical: 0, serious: 1, warning: 2, good: 3 };
  const chip = (sev, text) => `<span class="chip chip-${sev}"><span class="dot"></span>${esc(text)}</span>`;
  const deltaCls = (d, goodIfPositive, flat) => (Math.abs(d) <= (flat || 0) ? 'delta-flat' : (d > 0) === goodIfPositive ? 'delta-good' : 'delta-bad');

  // ---------------- chart theming ----------------
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { ai: v('--ai'), aiSoft: v('--ai-soft'), sap: v('--sap'), ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), line: v('--line'), surface: v('--surface'), critical: v('--critical'), serious: v('--serious'), warning: v('--warning'), good: v('--good'), goodInk: v('--good-ink'), gold: v('--gold'), orange: v('--ch2'), ch1: v('--ch1'), ch2: v('--ch2'), ch3: v('--ch3'), slate: v('--line-strong') };
  }
  function tooltip() { const c = colors(); return { backgroundColor: c.ink, titleColor: c.surface, bodyColor: c.surface, padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4, titleFont: { weight: '600' } }; }
  function legend() { const c = colors(); return { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, color: c.ink2, padding: 14 } }; }
  function baseOpts(extra) {
    const c = colors();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = c.ink2;
    return Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, interaction: { mode: 'nearest', intersect: false }, plugins: { legend: legend(), tooltip: tooltip() } }, extra || {});
  }
  const axis = (title, extra) => { const c = colors(); return Object.assign({ grid: { color: c.line, drawTicks: false }, border: { display: false }, ticks: { color: c.muted, padding: 6 }, title: title ? { display: true, text: title, color: c.muted, font: { size: 11.5 } } : undefined }, extra || {}); };

  // vertical reference lines for histograms / calendars
  Chart.register({
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
  });
  function chart(id, config) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    const el = document.getElementById(id); if (!el) return null;
    state.charts[id] = new Chart(el, config);
    return state.charts[id];
  }
  function destroyCharts() { for (const k in state.charts) state.charts[k].destroy(); state.charts = {}; }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3400); }

  // ---------------- pipeline ----------------
  const REQUIRED = ['MARA', 'MARC', 'MARD', 'MBEW', 'MATDOC', 'EKKO', 'EKPO', 'EKBE', 'VBAK', 'VBAP', 'LIPS'];
  const OPTIONAL = ['MAKT', 'EKET', 'LFA1', 'T001W', 'KNA1', 'VBEP', 'EINE'];

  function progress(msg, p) {
    $('#loading-step').textContent = msg;
    if (p != null) $('#progress-bar').style.width = Math.round(p * 100) + '%';
    const step = p == null ? 0 : p < 0.04 ? 0 : p < 0.06 ? 1 : p < 0.5 ? 2 : 3;
    $$('#loading-steps li').forEach(li => { const s = +li.dataset.step; li.className = s < step ? 'done' : s === step ? 'active' : ''; });
  }

  async function runPipeline(T, source) {
    for (const k of REQUIRED.concat(OPTIONAL)) T[k] = T[k] || [];
    destroyCharts();
    $('#loading').hidden = false; $('#pagehead').hidden = true; $$('.view').forEach(v => (v.hidden = true));
    state.T = T; state.source = source;
    progress('Indexing SAP tables', 0.04);
    state.model = await E.build(T, {}, progress);
    state.bt = E.backtest(state.model, {}, { frontier: true });
    state.seasonIndex = seasonIndex();
    applyPreset();
    const prep = state.model.prep;
    const plants = Object.keys(prep.plants).length ? prep.plants : Object.fromEntries([...new Set(prep.skus.map(s => s.WERKS))].map(w => [w, w]));
    $('#plant').innerHTML = `<option value="all">All plants</option>` + Object.entries(plants).map(([k, v]) => `<option value="${esc(k)}">${esc(k)} · ${esc(v)}</option>`).join('');
    state.plant = 'all';
    const d0 = new Date(prep.start).toISOString().slice(0, 10), d1 = new Date(prep.end - 86400000).toISOString().slice(0, 10);
    $('#side-data').innerHTML = `
      <span class="tag ${source === 'sample' ? '' : 'live'}">${source === 'sample' ? 'Sample data' : 'Your SAP data'}</span>
      <div>${source === 'sample' ? 'Generated SAP S/4HANA extract, not DOZCO records.' : 'Uploaded SAP extract.'}</div>
      <div><b>${nf(prep.skus.length)}</b> material × plant · <b>${Object.keys(plants).length}</b> plants<br><b>${nf(T.VBAP.length)}</b> order lines · <b>${nf(T.EKPO.length)}</b> PO lines<br>${d0} → ${d1}</div>
      <button id="side-upload">${source === 'sample' ? 'Use my SAP extract' : 'Load other files'}</button>`;
    $('#side-upload').addEventListener('click', () => setTab('data'));
    $('#loading').hidden = true;
    if (!state.part || !state.rec.results.find(r => r.key === state.part)) state.part = pickShowcase();
    buildNav();
    render();
  }

  function cfgForPreset() {
    const m = state.model, bt = state.bt;
    if (state.preset === 'matrix') return { mode: 'matrix', channelTargets: state.channelTargets };
    // presets pick a point on the validated service-vs-stock curve by target fill rate
    const f = bt.frontier, want = PRESET_FILL[state.preset];
    let mult = state.mult;
    if (want) { mult = f[f.length - 1].mult; for (let i = 1; i < f.length; i++) if (f[i].fill >= want) { const w = (want - f[i - 1].fill) / ((f[i].fill - f[i - 1].fill) || 1); mult = f[i - 1].mult + Math.max(0, Math.min(1, w)) * (f[i].mult - f[i - 1].mult); break; } if (f[0].fill >= want) mult = f[0].mult; }
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
    const rs = state.rec.results.filter(r => !r.stop && r.seasonal && r.abc === 'A' && r.lt.mean > r.sap.plifz * 1.25 && r.lt.n >= 4 && r.lostLines > 0);
    rs.sort((a, b) => b.lost52Value - a.lost52Value);
    return (rs[0] || state.rec.results.find(r => r.abc === 'A') || state.rec.results[0]).key;
  }

  // demand index by calendar month (value-weighted), for the monsoon story
  function seasonIndex(rows) {
    const prep = state.model.prep; const tot = new Float64Array(12), cnt = new Float64Array(12);
    for (let d = 0; d < prep.days; d++) cnt[new Date(prep.start + d * 86400000).getUTCMonth()]++;
    for (const s of prep.skus) {
      if (rows && !rows.has(s.key)) continue;
      for (let d = 0; d < prep.days; d++) if (s.demandDay[d]) tot[new Date(prep.start + d * 86400000).getUTCMonth()] += s.demandDay[d] * s.price;
    }
    const daily = Array.from(tot, (v, m) => v / (cnt[m] || 1)); const avg = daily.reduce((a, b) => a + b, 0) / 12 || 1;
    return daily.map(v => v / avg);
  }

  const visible = () => state.rec.results.filter(r => state.plant === 'all' || r.WERKS === state.plant);

  function btAgg(rows) {
    const a = { sap: { req: 0, del: 0, inv: 0, so: 0 }, ai: { req: 0, del: 0, inv: 0, so: 0 } };
    for (const r of rows) for (const k of ['sap', 'ai']) { const b = r.bt[k]; a[k].req += b.req * r.price; a[k].del += b.del * r.price; a[k].inv += b.avgInv; a[k].so += b.soDays; }
    for (const k of ['sap', 'ai']) a[k].fill = a[k].req ? a[k].del / a[k].req : 1;
    return a;
  }

  // ---------------- navigation ----------------
  function buildNav() {
    const risk = state.rec.results.reduce((a, r) => a + r.actions.filter(x => x.type === 'reorder' && x.sev === 'critical').length, 0);
    $('#nav').innerHTML = VIEWS.map(v => v.group ? `<div class="nav-group">${v.group}</div>` :
      `<button data-tab="${v.id}" ${state.tab === v.id ? 'aria-current="page"' : ''}>${svg(v.id)}<span>${v.label}</span>${v.badge && risk ? `<span class="badge" title="Parts at stockout risk">${risk}</span>` : ''}</button>`).join('');
    $$('#nav button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  }

  function setTab(tab) {
    state.tab = tab;
    $$('#nav button').forEach(b => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* sandboxed viewer */ }
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (!state.rec) return;
    destroyCharts();
    const v = VIEWS.find(x => x.id === state.tab);
    $('#pagehead').hidden = false;
    $('#page-title').textContent = v.label;
    $('#crumb').textContent = v.crumb;
    $('#seg').hidden = !v.controls;
    $('#budget-wrap').hidden = !v.controls || state.preset !== 'custom';
    $('#plant').hidden = !!v.noPlant;
    $$('.seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.preset === state.preset)));
    $$('.view').forEach(x => (x.hidden = x.id !== 'view-' + state.tab));
    ({ overview: renderOverview, capital: renderCapital, service: renderService, recs: renderRecs, part: renderPart, actions: renderActions, suppliers: renderSuppliers, data: renderData, help: renderHelp })[state.tab]();
  }

  // ---------------- overview ----------------
  function renderOverview() {
    const el = $('#view-overview');
    const rows = visible();
    const all = state.plant === 'all';
    const agg = btAgg(rows);
    const ai = all ? state.aiRun : agg.ai;
    let release = 0, risk = 0, changed = 0, aiSS = 0, reorders = 0;
    for (const r of rows) {
      release += r.stop ? r.stockValue : r.excessValue;
      aiSS += r.ai.ss * r.price;
      if (r.actions.some(a => a.type === 'reorder' && a.sev === 'critical')) risk++;
      if (r.actions.some(a => a.type === 'reorder')) reorders++;
      if (r.ai.ss !== r.sap.ss || r.ai.rop !== r.sap.rop) changed++;
    }
    const label = PRESET_LABEL[state.preset];
    el.innerHTML = `
      <section class="hero">
        <div>
          <div class="hero-eyebrow">${esc(label)} setting · validated on 52 weeks of actual orders · ${all ? 'all plants' : 'plant ' + esc(state.plant)}</div>
          <h2>Serve <em>${pct(ai.fill)}</em> of customer demand with <em>${inr(ai.inv)}</em> of average stock, set part by part.</h2>
          <p>Every material × plant gets its own safety stock, reorder point and order quantity from true demand, measured supplier lead times and the monsoon season. The policy was replayed day by day against the last 52 weeks of sales orders, re-calibrating every 8 weeks with only the data available at the time.</p>
          <div class="hero-actions"><button class="primary" data-go="actions">Open this week's actions</button><button data-go="capital">Working capital release</button><button data-go="help">What the AI can do</button></div>
        </div>
        <div class="hero-stats">
          <div class="hstat"><div class="hstat-top"><span class="hstat-label">Fill rate, validated on history</span><span class="hstat-value">${pct(ai.fill)}</span></div>
            <div class="hbar"><span>Fill</span><div class="t"><div class="f ai" style="width:${Math.max(2, (ai.fill - 0.6) / 0.4 * 100)}%"></div></div><b>${pct(ai.fill)}</b></div></div>
          <div class="hstat"><div class="hstat-top"><span class="hstat-label">Average stock the policy holds</span><span class="hstat-value">${inr(ai.inv)}</span></div>
            <div class="hbar"><span>Turns</span><div class="t"><div class="f ai" style="width:${Math.min(100, (ai.del / ai.inv) / 10 * 100)}%"></div></div><b>${(ai.del / ai.inv).toFixed(1)}× / yr</b></div></div>
          <div class="hstat"><div class="hstat-top"><span class="hstat-label">Releasable now: dead, superseded, slow and excess stock</span><span class="hstat-value">${inr(release)}</span></div></div>
        </div>
      </section>

      <div>
        <div class="panel-head" style="margin-bottom:10px"><div><h3>What the AI found in the data</h3><p>Read from the SAP tables for ${all ? 'all plants' : 'plant ' + esc(state.plant)}, and used in every recommendation.</p></div></div>
        <div class="gaps">${insightCards(rows).join('')}</div>
      </div>

      <div class="kpis">
        ${kpi('Fill rate · validated', pct(ai.fill), `${esc(label)} setting, last 52 weeks`)}
        ${kpi('Average stock · validated', inr(ai.inv), `${(ai.del / ai.inv).toFixed(1)} turns a year at stock value`)}
        ${kpi('Safety stock recommended', inr(aiSS), `across ${nf(rows.filter(r => r.ai.ss > 0).length)} parts`)}
        ${kpi('Parts with new settings', nf(changed), `of ${nf(rows.length)} material × plant`)}
        ${kpi('Order now', nf(risk), `stockout risk · ${nf(reorders - risk)} more reorders`)}
      </div>

      <div class="grid-hero">
        <div class="panel">
          <div class="panel-head"><div><h3>Choose your operating point</h3><p>Each blue point is the AI policy at a different stock budget, replayed on the last 52 weeks of actual orders. Moving right buys service with working capital; the curve shows how much each step costs.</p></div></div>
          <div class="chart-box tall"><canvas id="c-frontier" role="img" aria-label="Fill rate versus average stock for different AI budgets"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Service and stock by class</h3><p>Selected policy, ${all ? 'all plants' : 'plant ' + esc(state.plant)}. A = top 80% of sales value.</p></div></div>
          ${classCompare(rows)}
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>ABC × XYZ segmentation</h3><p>Parts per cell, recommended safety stock and validated fill rate. XYZ from the coefficient of variation of monthly demand: X &lt; 0.2, Y 0.2–0.5, Z &gt; 0.5.</p></div></div>
          ${abcxyz(rows)}
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Demand patterns and winning forecast models</h3><p>Each part gets the model that was most accurate on its own last 26 weeks.</p></div></div>
          <div class="chart-box"><canvas id="c-models" role="img" aria-label="Parts by demand pattern and winning forecast model"></canvas></div>
        </div>
      </div>`;
    $$('[data-go]', el).forEach(b => b.addEventListener('click', () => setTab(b.dataset.go)));
    drawFrontier(); drawModels(rows);
  }

  const kpi = (label, value, sub) => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-sub">${sub}</div></div>`;

  function sparkBars(vals, hi) {
    const w = 132, h = 34, bw = w / vals.length; const max = Math.max(...vals) * 1.05;
    return `<svg viewBox="0 0 ${w} ${h + 12}" width="${w}" height="${h + 12}" aria-hidden="true">${vals.map((v, i) => `<rect x="${i * bw + 1}" y="${h - v / max * h}" width="${bw - 2}" height="${v / max * h}" rx="1.5" fill="${hi.includes(i) ? 'var(--serious)' : 'var(--ai)'}" opacity="${hi.includes(i) ? 1 : 0.55}"/>`).join('')}${['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((m, i) => `<text x="${i * bw + bw / 2}" y="${h + 11}" font-size="8" text-anchor="middle" fill="var(--muted)">${m}</text>`).join('')}</svg>`;
  }

  function insightCards(rows) {
    const lost = rows.reduce((a, r) => a + r.lost52Value, 0);
    const lines = rows.reduce((a, r) => a + r.lostLines, 0);
    const plif = rows.filter(r => !r.stop && r.lt.n >= 3 && r.lt.mean - r.sap.plifz >= Math.max(3, 0.2 * r.sap.plifz));
    const gap = plif.length ? plif.reduce((a, r) => a + (r.lt.mean - r.sap.plifz), 0) / plif.length : 0;
    const si = state.plant === 'all' ? state.seasonIndex : seasonIndex(new Set(rows.map(r => r.key)));
    const monsoon = (si[6] + si[7] + si[8]) / 3 - 1;
    const byLost = rows.filter(r => r.lost52Value > 0).sort((a, b) => b.lost52Value - a.lost52Value);
    let cum = 0, n80 = 0; for (const r of byLost) { if (cum >= 0.8 * lost) break; cum += r.lost52Value; n80++; }
    const card = (sev, icon, big, title, text, src, extra) => `<div class="gap"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="gap-icon ${sev}">${svg(icon)}</div>${extra || ''}</div><div class="gap-big num">${big}</div><h3>${title}</h3><p>${text}</p><div class="src">${src}</div></div>`;
    return [
      card('critical', 'eyeoff', inr(lost), 'Demand that never became a sale', `${nf(lines)} order lines were not supplied in full. The AI counts this lost demand back into the forecast instead of learning from shipments alone.`, 'VBAP ordered − LIPS delivered'),
      card('serious', 'clock', `+${nf(gap, 0)} days`, 'Suppliers slower than planned', `${nf(plif.length)} part-plants arrive later than the planned delivery time in the material master. The AI plans with measured lead times and their spread.`, 'EKBE-BUDAT − EKKO-BEDAT'),
      card('warning', 'rain', `${monsoon < 0 ? '−' : '+'}${Math.abs(monsoon * 100).toFixed(0)}%`, 'Monsoon season', `Demand drops ${Math.abs(monsoon * 100).toFixed(0)}% in Jul–Sep and surges after. The AI learns the profile per material group and moves each reorder point month by month.`, 'Demand value by posting month', sparkBars(si, [6, 7, 8])),
      card('good', 'scale', nf(n80), 'Parts behind 80% of lost sales', `Out of ${nf(rows.length)} material × plant. Stock budget goes first to these parts, where each rupee prevents the most lost sales.`, 'Pareto of unfilled order value'),
    ];
  }

  function classCompare(rows) {
    const g = {};
    for (const r of rows) {
      const x = g[r.abc] || (g[r.abc] = { req: 0, del: 0, inv: 0, lost: 0, n: 0, tgt: 0, tw: 0 }); x.n++;
      x.req += r.bt.ai.req * r.price; x.del += r.bt.ai.del * r.price; x.inv += r.bt.ai.avgInv;
      if (!r.stop) { x.tgt += r.svc * r.annualValue; x.tw += r.annualValue; }
    }
    const maxInv = Math.max(...Object.values(g).map(x => x.inv), 1);
    const maxLost = Math.max(...Object.values(g).map(x => x.req - x.del), 1);
    const w = (f) => Math.max(1, (f - 0.6) / 0.4 * 100);
    const block = (k) => {
      const x = g[k]; if (!x) return '';
      const f = x.req ? x.del / x.req : 1;
      return `<div class="vs cls-block">
        <div class="eyebrow">Class ${k} · ${nf(x.n)} parts</div>
        <div class="vs-row"><span>Fill rate</span><div class="vs-track"><div class="vs-fill ai" style="width:${w(f)}%"></div></div><span class="num r">${pct(f)}</span></div>
        <div class="vs-row"><span>Lost sales</span><div class="vs-track"><div class="vs-fill sap" style="width:${Math.min(100, (x.req - x.del) / (maxLost || 1) * 100)}%;background:var(--critical);opacity:.7"></div></div><span class="num r">${inr(x.req - x.del)}</span></div>
        <div class="vs-row"><span>Average stock</span><div class="vs-track"><div class="vs-fill ai" style="width:${x.inv / maxInv * 100}%;opacity:.55"></div></div><span class="num r">${inr(x.inv)}</span></div>
      </div>`;
    };
    return block('A') + block('B') + block('C') + '<p class="note">Validated on the last 52 weeks of actual orders. Fill-rate bars start at 60%.</p>';
  }

  function abcxyz(rows) {
    const cell = {};
    for (const r of rows) { const k = r.dead ? 'dead' : r.abc + r.xyz; const c = cell[k] || (cell[k] = { n: 0, ai: 0, req: 0, del: 0 }); c.n++; c.ai += r.ai.ss * r.price; c.req += r.bt.ai.req * r.price; c.del += r.bt.ai.del * r.price; }
    const max = Math.max(...Object.entries(cell).filter(([k]) => k !== 'dead').map(([, c]) => c.n), 1);
    const td = (k) => {
      const c = cell[k]; if (!c) return '<td><div class="cell" style="background:var(--surface-2)"><b class="muted">–</b></div></td>';
      return `<td><div class="cell" style="background:rgba(42,120,214,${(0.06 + 0.36 * c.n / max).toFixed(2)})"><b class="num">${nf(c.n)}</b><span class="num">safety stock ${inr(c.ai)}</span><span class="num">fill rate ${c.req ? pct(c.del / c.req, 0) : '–'}</span></div></td>`;
    };
    const dc = cell.dead;
    return `<div class="heat"><table><thead><tr><th></th><th>X · stable</th><th>Y · fluctuating</th><th>Z · erratic</th></tr></thead><tbody>
      ${['A', 'B', 'C'].map(a => `<tr><th style="font-size:14px;color:var(--ink)">${a}</th>${td(a + 'X')}${td(a + 'Y')}${td(a + 'Z')}</tr>`).join('')}
      </tbody></table></div>${dc ? `<p class="note" style="margin-top:8px">Plus ${nf(dc.n)} parts with no demand in 52 weeks: no safety stock, listed for release.</p>` : ''}`;
  }

  function drawFrontier() {
    const c = colors(), bt = state.bt, cr = (x) => x / 1e7;
    const pts = bt.frontier.map(f => ({ x: cr(f.inv), y: f.fill * 100, mult: f.mult }));
    const sel = { x: cr(state.aiRun.inv), y: state.aiRun.fill * 100 };
    chart('c-frontier', {
      type: 'scatter',
      data: { datasets: [
        { label: 'AI at different stock budgets', data: pts, showLine: true, borderColor: c.ai, backgroundColor: c.ai, borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, tension: 0.3 },
        { label: 'Selected: ' + PRESET_LABEL[state.preset], data: [sel], borderColor: c.ai, backgroundColor: c.surface, borderWidth: 3, pointRadius: 9, pointHoverRadius: 10 },
        { label: 'Service targets by class & channel', data: [{ x: cr(bt.matrix.inv), y: bt.matrix.fill * 100 }], backgroundColor: c.orange, borderColor: c.surface, borderWidth: 2, pointStyle: 'triangle', pointRadius: 8 },
      ] },
      options: baseOpts({
        scales: { x: axis('Average stock value', { ticks: { color: c.muted, callback: v => '₹' + v + ' Cr' } }), y: axis('Fill rate (% of ordered value)', { ticks: { color: c.muted, callback: v => v + '%' } }) },
        plugins: { legend: legend(), tooltip: Object.assign(tooltip(), { callbacks: { label: (ctx) => `${ctx.dataset.label}: fill ${ctx.parsed.y.toFixed(1)}%, stock ₹${ctx.parsed.x.toFixed(2)} Cr` } }) },
      }),
    });
  }

  function drawModels(rows) {
    const c = colors();
    const pats = ['smooth', 'erratic', 'intermittent', 'lumpy', 'none'];
    const models = [...new Set(rows.map(r => r.fcMethod))].filter(m => m !== '-');
    const palette = [c.ch1, c.ch2, c.ch3, '#eda100', '#e87ba4', '#4a3aa7'];
    chart('c-models', {
      type: 'bar',
      data: { labels: pats.map(p => PATTERN[p]), datasets: models.map((m, i) => ({ label: m, data: pats.map(p => rows.filter(r => r.pattern === p && r.fcMethod === m).length), backgroundColor: palette[i % palette.length], borderColor: c.surface, borderWidth: { right: 2 }, borderSkipped: false, borderRadius: 3 })).concat([{ label: 'No forecast needed', data: pats.map(p => rows.filter(r => r.pattern === p && r.fcMethod === '-').length), backgroundColor: c.slate, borderRadius: 3 }]) },
      options: baseOpts({ indexAxis: 'y', scales: { x: axis('Parts', { stacked: true }), y: axis('', { stacked: true, grid: { display: false } }) } }),
    });
  }

  // ---------------- working capital ----------------
  function renderCapital() {
    const el = $('#view-capital');
    const rows = visible();
    const agg = btAgg(rows);
    const hold = state.model.buildCfg.holdingRate;
    let current = 0, deadObs = 0, slow = 0, excess = 0, sold = 0;
    for (const r of rows) {
      current += r.stockValue;
      if (r.stop) { if (r.dead || r.obsolete) deadObs += r.stockValue; else slow += r.stockValue; } else excess += r.excessValue;
      sold += r.bt.ai.del * r.price;
    }
    const kept = current - deadObs - slow - excess;
    const rebalance = agg.ai.inv - kept;
    const saving = (current - agg.ai.inv) * hold;
    const turnsA = sold / agg.ai.inv, turnsNow = sold / (current || 1);
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Stock value today', inr(current), `${nf(rows.filter(r => r.stock > 0).length)} parts on hand (MARD × MBEW)`)}
        ${kpi('Releasable now', inr(deadObs + slow + excess), `${inr(deadObs)} dead or superseded · ${inr(slow)} slow · ${inr(excess)} excess`)}
        ${kpi('Average stock · AI policy', inr(agg.ai.inv), `validated on 52 weeks · today ${inr(current)} on hand`)}
        ${kpi('Holding cost saving per year', `<span class="${deltaCls(saving, true)}">${inr(Math.abs(saving))}</span>`, `${saving >= 0 ? 'lower' : 'higher'} than on today's stock, at ${pct(hold, 0)} carrying cost`)}
        ${kpi('Inventory turns', `${turnsA.toFixed(1)}×`, `per year at AI stock level · ${turnsNow.toFixed(1)}× on today's stock`)}
      </div>
      <div class="grid-wide">
        <div class="panel">
          <div class="panel-head"><div><h3>From today's stock to the AI steady state</h3><p>Release the stock the AI would not hold, then rebalance: some parts need more stock and others less. The last bar is the average stock of the selected AI policy, validated on 52 weeks of actual orders.</p></div></div>
          <div class="chart-box tall"><canvas id="c-waterfall" role="img" aria-label="Waterfall from current stock to AI average stock"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Stock by age</h3><p>Stock value today by days since the last sale (MATDOC 601).</p></div></div>
          <div class="chart-box tall"><canvas id="c-aging" role="img" aria-label="Stock value by days since last sale"></canvas></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Stock by material group</h3><p>Stock value today next to the average stock the AI policy holds (validated on 52 weeks).</p></div></div>
          <div class="chart-box tall"><canvas id="c-cat" role="img" aria-label="Stock today and AI average stock by material group"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Seasonal reorder levels</h3><p>Total value of the reorder points, month by month. The AI lowers them into the monsoon (orange) and raises them for the post-monsoon surge.</p></div></div>
          <div class="chart-box tall"><canvas id="c-season" role="img" aria-label="Reorder level value by month"></canvas></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Largest release opportunities</h3><p>Parts with the most stock above what the AI would hold. Click a row for the explanation.</p></div></div>
        <div class="table-wrap scroll" style="max-height:480px"><table><thead><tr><th>Material</th><th>Description</th><th>Plant</th><th>Class</th><th class="r">Stock</th><th class="r">Value</th><th class="r">Releasable</th><th class="r">Days since sale</th><th>Action</th></tr></thead><tbody>
          ${rows.map(r => ({ r, v: r.stop ? r.stockValue : r.excessValue })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 40).map(({ r, v }) => `<tr class="clickable" data-key="${esc(r.key)}"><td class="mono">${esc(r.MATNR)}</td><td class="desc">${esc(r.MAKTX)}</td><td class="mono">${esc(r.WERKS)}</td><td><span class="cls">${esc(r.cls)}</span></td><td class="r num">${nf(r.stock)}</td><td class="r num">${inr(r.stockValue)}</td><td class="r num"><b>${inr(v)}</b></td><td class="r num">${r.daysSinceIssue >= 999 ? '> 2 yrs' : nf(r.daysSinceIssue)}</td><td>${r.actions.length ? chip(topAction(r).sev, shortAction(topAction(r))) : ''}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    bindRows(el);
    const c = colors();
    const steps = [
      { l: 'Stock today', v: current, kind: 'total' },
      { l: 'Dead & superseded', v: -deadObs }, { l: 'Slow-moving', v: -slow }, { l: 'Excess above AI max', v: -excess },
      { l: rebalance >= 0 ? 'Rebalance (+ where short)' : 'Rebalance', v: rebalance },
      { l: 'AI average stock', v: agg.ai.inv, kind: 'total' },
    ];
    let run = 0; const bars = steps.map(s => { if (s.kind) { run = s.v; return [0, s.v]; } const a = run; run += s.v; return [Math.min(a, run), Math.max(a, run)]; });
    chart('c-waterfall', {
      type: 'bar',
      data: { labels: steps.map(s => s.l), datasets: [{ data: bars.map(b => [b[0] / 1e7, b[1] / 1e7]), backgroundColor: steps.map(s => s.kind ? (s.l === 'Stock today' ? c.sap : c.ai) : s.v < 0 ? c.good : c.serious), borderRadius: 5, barPercentage: 0.7 }] },
      options: baseOpts({ plugins: { legend: { display: false }, tooltip: Object.assign(tooltip(), { callbacks: { label: (ctx) => { const s = steps[ctx.dataIndex]; return s.kind ? inr(s.v) : (s.v >= 0 ? '+' : '') + inr(s.v); } } }) }, scales: { x: axis('', { grid: { display: false }, ticks: { color: c.ink2, maxRotation: 0, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 14 ? l.split(' ').reduce((acc, w) => { const last = acc[acc.length - 1]; if ((last + ' ' + w).trim().length > 14) acc.push(w); else acc[acc.length - 1] = (last + ' ' + w).trim(); return acc; }, ['']) : l; } } }), y: axis('₹ crore', { beginAtZero: true, ticks: { color: c.muted, callback: v => '₹' + v + ' Cr' } }) } }),
    });
    const buckets = [['0–90 days', 0, 90, c.slate], ['91–180', 91, 180, c.warning], ['181–365', 181, 365, c.serious], ['> 365 days', 366, 1e9, c.critical]];
    chart('c-aging', {
      type: 'bar',
      data: { labels: buckets.map(b => b[0]), datasets: [{ data: buckets.map(b => rows.filter(r => r.daysSinceIssue >= b[1] && r.daysSinceIssue <= b[2]).reduce((a, r) => a + r.stockValue, 0) / 1e5), backgroundColor: buckets.map(b => b[3]), borderRadius: 5, barPercentage: 0.7 }] },
      options: baseOpts({ plugins: { legend: { display: false }, tooltip: Object.assign(tooltip(), { callbacks: { label: (ctx) => inr(ctx.parsed.y * 1e5) } }) }, scales: { x: axis('Days since last sale', { grid: { display: false } }), y: axis('₹ lakh', { beginAtZero: true, ticks: { color: c.muted, callback: v => '₹' + v + ' L' } }) } }),
    });
    const g = {};
    for (const r of rows) { const x = g[r.MATKL] || (g[r.MATKL] = { sap: 0, ai: 0 }); x.sap += r.stockValue; x.ai += r.bt.ai.avgInv; }
    const keys = Object.keys(g).sort((a, b) => g[b].sap - g[a].sap);
    chart('c-cat', {
      type: 'bar',
      data: { labels: keys.map(k => GROUPS[k] || k), datasets: [
        { label: 'Stock today', data: keys.map(k => g[k].sap / 1e5), backgroundColor: c.sap, borderRadius: 4, barPercentage: 0.85, categoryPercentage: 0.7 },
        { label: 'AI average stock', data: keys.map(k => g[k].ai / 1e5), backgroundColor: c.ai, borderRadius: 4, barPercentage: 0.85, categoryPercentage: 0.7 },
      ] },
      options: baseOpts({ indexAxis: 'y', scales: { x: axis('₹ lakh', { ticks: { color: c.muted, maxRotation: 0, maxTicksLimit: 6, callback: v => '₹' + v + ' L' } }), y: axis('', { grid: { display: false } }) }, plugins: { legend: legend(), tooltip: Object.assign(tooltip(), { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${inr(ctx.parsed.x * 1e5)}` } }) } }),
    });
    const act = rows.filter(r => !r.stop);
    const cal = rows.length ? rows[0].calendar.map(x => x.m) : [];
    chart('c-season', {
      type: 'bar',
      data: { labels: cal.map(m => MONTHS[m]), datasets: [
        { label: 'AI reorder level', data: cal.map((m, k) => act.reduce((a, r) => a + r.calendar[k].rop * r.price, 0) / 1e5), backgroundColor: cal.map(m => (m >= 6 && m <= 8 ? c.serious : c.ai)), borderRadius: 4, barPercentage: 0.75 },
      ] },
      options: baseOpts({ scales: { x: axis('', { grid: { display: false } }), y: axis('₹ lakh', { beginAtZero: false, grace: '8%', ticks: { color: c.muted, callback: v => '₹' + v + ' L' } }) }, plugins: { legend: legend(), tooltip: Object.assign(tooltip(), { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${inr(ctx.parsed.y * 1e5)}` } }) } }),
    });
  }

  // ---------------- service & stockouts ----------------
  function renderService() {
    const el = $('#view-service');
    const rows = visible();
    const prep = state.model.prep, P = E.PERIOD, nPer = Math.ceil(prep.days / P), last = nPer - 13;
    const ch = { '10': {}, '20': {}, '30': {} };
    for (const k in ch) Object.assign(ch[k], { req: new Float64Array(nPer), del: new Float64Array(nPer) });
    for (const r of rows) for (const k in r.sku.chReq) { if (!ch[k]) continue; const R = r.sku.chReq[k], D = r.sku.chDel[k]; for (let i = 0; i < nPer; i++) { ch[k].req[i] += R[i] * r.price; ch[k].del[i] += D[i] * r.price; } }
    const sum = (a, from) => { let s = 0; for (let i = from; i < a.length; i++) s += a[i]; return s; };
    const totReq = Object.values(ch).reduce((a, x) => a + sum(x.req, last), 0) || 1;
    const lostTot = Object.values(ch).reduce((a, x) => a + sum(x.req, last) - sum(x.del, last), 0);
    const agg = btAgg(rows);
    const col = { '10': 'var(--ch1)', '20': 'var(--ch2)', '30': 'var(--ch3)' };
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Fill rate, last 12 months', pct(1 - lostTot / totReq), 'actual: delivered ÷ ordered value (LIPS ÷ VBAP)')}
        ${kpi('Sales lost to stockouts', inr(lostTot), 'last 12 months, at stock value')}
        ${kpi('Order lines short-supplied', nf(rows.reduce((a, r) => a + r.lostLines, 0)), 'two years of sales order lines')}
        ${kpi('Fill rate · AI policy', pct(agg.ai.fill), `validated on 52 weeks · ${esc(PRESET_LABEL[state.preset])} setting`)}
      </div>
      <div class="panel" style="background:var(--surface-2)">
        <div class="panel-head" style="margin-bottom:12px"><div><h3>Service by sales channel</h3><p>Actual fill rate by distribution channel (VBAK-VTWEG) over the last 12 months. Set the fill-rate target agreed for each channel; a part's target becomes the higher of its class target and its channel-weighted target.</p></div><button class="btn btn-primary" id="apply-ch">Apply channel targets</button></div>
        <div class="chcards">${['30', '20', '10'].map(k => {
          const q = sum(ch[k].req, last), d = sum(ch[k].del, last);
          return `<div class="chcard" style="--c:${col[k]}"><div class="eyebrow">${esc(E.CHANNEL_NAMES[k])} · VTWEG ${k}</div>
            <div style="display:flex;align-items:baseline;gap:10px"><span class="fill num">${pct(q ? d / q : 1)}</span><span class="meta">fill rate</span></div>
            <div class="meta">${pct(q / totReq, 0)} of demand · ${inr(q - d)} lost</div>
            <label for="ct-${k}">Target <input type="number" id="ct-${k}" min="50" max="99.9" step="0.5" value="${(state.channelTargets[k] * 100).toFixed(1)}"> %</label></div>`;
        }).join('')}</div>
      </div>
      <div class="grid-wide">
        <div class="panel">
          <div class="panel-head"><div><h3>Fill rate trend by channel</h3><p>4-weekly periods over two years, delivered ÷ ordered value per channel.</p></div></div>
          <div class="chart-box tall"><canvas id="c-trend" role="img" aria-label="Fill rate by channel over time"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Lost sales by material group</h3><p>Last 12 months.</p></div></div>
          <div class="chart-box tall"><canvas id="c-lostcat" role="img" aria-label="Lost sales value by material group"></canvas></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Parts losing the most sales</h3><p>Last 12 months, with what the AI changes. Click for the explanation.</p></div></div>
        <div class="table-wrap scroll" style="max-height:520px"><table><thead><tr><th>Material</th><th>Description</th><th>Plant</th><th>Class</th><th class="r">Lost</th><th class="r">Fill 12m</th><th class="r">Lead time planned → actual</th><th class="r">Safety stock current → AI</th><th class="r">Reorder pt current → AI</th><th class="r">AI fill, validated</th></tr></thead><tbody>
          ${rows.filter(r => r.lost52Value > 0).sort((a, b) => b.lost52Value - a.lost52Value).slice(0, 30).map(r => `<tr class="clickable" data-key="${esc(r.key)}"><td class="mono">${esc(r.MATNR)}</td><td class="desc">${esc(r.MAKTX)}</td><td class="mono">${esc(r.WERKS)}</td><td><span class="cls">${esc(r.cls)}</span></td><td class="r num"><b>${inr(r.lost52Value)}</b></td><td class="r num">${pct(r.fill52)}</td><td class="r num">${r.sap.plifz}<span class="arrow-to">→</span>${nf(r.lt.mean, 0)} d</td><td class="r num">${nf(r.sap.ss)}<span class="arrow-to">→</span><b>${nf(r.ai.ss)}</b></td><td class="r num">${nf(r.sap.rop)}<span class="arrow-to">→</span><b>${nf(r.ai.rop)}</b></td><td class="r num"><b>${pct(r.bt.ai.fill, 0)}</b></td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    bindRows(el);
    $('#apply-ch').addEventListener('click', () => {
      for (const k of ['10', '20', '30']) { const v = +$('#ct-' + k).value; if (v >= 50 && v < 100) state.channelTargets[k] = v / 100; }
      state.preset = 'matrix'; applyPreset();
      toast(`Service targets applied. Validated fill rate ${pct(state.aiRun.fill)} with ${inr(state.aiRun.inv)} average stock.`);
      buildNav(); render();
    });
    const c = colors();
    const labels = Array.from({ length: nPer }, (_, i) => new Date(prep.start + i * P * 86400000).toISOString().slice(2, 7));
    chart('c-trend', {
      type: 'line',
      data: { labels, datasets: ['30', '20', '10'].map(k => ({ label: E.CHANNEL_NAMES[k], data: Array.from(ch[k].req, (q, i) => (q ? +(ch[k].del[i] / q * 100).toFixed(1) : null)), borderColor: c['ch' + ({ '10': 1, '20': 2, '30': 3 })[k]], backgroundColor: c['ch' + ({ '10': 1, '20': 2, '30': 3 })[k]], borderWidth: 2, pointRadius: 0, tension: 0.3 })) },
      options: baseOpts({ interaction: { mode: 'index', intersect: false }, scales: { x: axis('', { grid: { display: false }, ticks: { color: c.muted, maxTicksLimit: 9, maxRotation: 0 } }), y: axis('Fill rate', { ticks: { color: c.muted, callback: v => v + '%' } }) } }),
    });
    const g = {};
    for (const r of rows) g[r.MATKL] = (g[r.MATKL] || 0) + r.lost52Value;
    const keys = Object.keys(g).sort((a, b) => g[b] - g[a]);
    chart('c-lostcat', {
      type: 'bar',
      data: { labels: keys.map(k => GROUPS[k] || k), datasets: [{ data: keys.map(k => g[k] / 1e5), backgroundColor: c.critical, borderRadius: 4, barPercentage: 0.75 }] },
      options: baseOpts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: Object.assign(tooltip(), { callbacks: { label: (ctx) => inr(ctx.parsed.x * 1e5) } }) }, scales: { x: axis('₹ lakh', { ticks: { color: c.muted, callback: v => '₹' + v + ' L' } }), y: axis('', { grid: { display: false } }) } }),
    });
  }

  // ---------------- recommendations ----------------
  function shortAction(a) {
    return { reorder: a.sev === 'critical' ? 'Order now' : 'Reorder', transfer: 'Transfer', excess: 'Excess stock', dead: a.title.startsWith('Superseded') ? 'Superseded' : a.sev === 'critical' ? 'Dead stock' : 'Slow-moving', master: a.title.startsWith('Raise') ? 'Raise safety stock' : a.title.startsWith('Lower') ? 'Lower safety stock' : 'Stop replenishing', leadtime: 'Fix PLIFZ' }[a.type] || a.title;
  }
  function topAction(r) { return r.actions.slice().sort((x, y) => SEV_ORDER[x.sev] - SEV_ORDER[y.sev])[0]; }
  function bindRows(el) { $$('tr.clickable', el).forEach(tr => tr.addEventListener('click', () => { state.part = tr.dataset.key; setTab('part'); })); }

  function filteredRecs() {
    const f = state.f; const q = f.q.trim().toLowerCase();
    const rows = visible().filter(r =>
      (!q || r.MATNR.includes(q) || r.MAKTX.toLowerCase().includes(q) || (r.supplier.NAME1 || '').toLowerCase().includes(q)) &&
      (f.cls === 'all' || (f.cls === 'dead' ? r.stop : (r.abc === f.cls[0] && (f.cls.length === 1 || r.xyz === f.cls[1])))) &&
      (f.pattern === 'all' || r.pattern === f.pattern) &&
      (f.dir === 'all' || (f.dir === 'up' ? r.ssDelta > 0 : f.dir === 'down' ? r.ssDelta < 0 : r.ssDelta === 0)) &&
      (f.action === 'all' || r.actions.some(a => a.type === f.action)));
    const k = state.sort.key, d = state.sort.dir;
    const val = { absDelta: r => Math.abs(r.ssDeltaValue), MATNR: r => r.MATNR, MAKTX: r => r.MAKTX, WERKS: r => r.WERKS, cls: r => r.cls, pattern: r => r.pattern, fc: r => r.weeklyFc, lt: r => r.lt.mean - r.sap.plifz, ss: r => r.ai.ss, rop: r => r.ai.rop, stock: r => r.stockValue, fill: r => r.svc }[k] || (() => 0);
    return rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
  }

  function renderRecs() {
    const el = $('#view-recs');
    if (!el.dataset.built) {
      el.innerHTML = `<div class="panel">
        <div class="panel-head"><div><h3>Safety stock, reorder point and max stock per material and plant</h3><p>AI recommendation for the selected policy, next to the current values in the material master. Click a row for the full explanation.</p></div>
          <button class="btn btn-primary" id="dl-change">${svg('download')}SAP change file for MM17</button></div>
        <div class="filters">
          <input type="search" id="f-q" placeholder="Search material, description, supplier" aria-label="Search">
          <select id="f-cls" aria-label="Class"><option value="all">All classes</option>${['A', 'B', 'C'].map(a => `<option value="${a}">${a} (all)</option>` + ['X', 'Y', 'Z'].map(x => `<option value="${a + x}">${a + x}</option>`).join('')).join('')}<option value="dead">Not replenished</option></select>
          <select id="f-pattern" aria-label="Demand pattern"><option value="all">All demand patterns</option>${Object.entries(PATTERN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select id="f-dir" aria-label="Change"><option value="all">Any change</option><option value="up">Safety stock up</option><option value="down">Safety stock down</option><option value="same">Unchanged</option></select>
          <select id="f-action" aria-label="Action"><option value="all">Any action</option><option value="reorder">Reorder / order now</option><option value="transfer">Transfer between plants</option><option value="excess">Excess stock</option><option value="dead">Dead, slow or superseded</option><option value="master">Update EISBE / MINBE</option><option value="leadtime">Correct PLIFZ</option></select>
          <span class="count" id="f-count"></span>
        </div>
        <div class="table-wrap scroll" id="rec-table"></div>
      </div>`;
      el.dataset.built = '1';
      $('#f-q').addEventListener('input', e => { state.f.q = e.target.value; drawRecTable(); });
      ['cls', 'pattern', 'dir', 'action'].forEach(k => $('#f-' + k).addEventListener('change', e => { state.f[k] = e.target.value; drawRecTable(); }));
      $('#dl-change').addEventListener('click', downloadChangeFile);
    }
    const f = state.f; $('#f-q').value = f.q; $('#f-cls').value = f.cls; $('#f-pattern').value = f.pattern; $('#f-dir').value = f.dir; $('#f-action').value = f.action;
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
        <td><span class="cls">${esc(r.cls)}</span></td><td>${PATTERN[r.pattern]}${r.seasonal ? ' <span title="Seasonal reorder point" class="muted">◐</span>' : ''}</td>
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
    $('#rec-table').innerHTML = `<table><thead><tr>${th('MATNR', 'Material')}${th('MAKTX', 'Description')}${th('WERKS', 'Plant')}${th('cls', 'Class')}${th('pattern', 'Demand')}${th('fc', 'Fcst/wk', 'r')}${th('lt', 'Lead time d', 'r')}${th('ss', 'Safety stock', 'r')}${th('absDelta', 'Change', 'r')}${th('rop', 'Reorder pt', 'r')}${th('stock', 'Stock', 'r')}${th('fill', 'Fill tgt', 'r')}<th>Top action</th></tr></thead><tbody>${body}</tbody></table>${rows.length > LIMIT ? `<p class="note" style="padding:10px">First ${LIMIT} rows shown. Narrow the filters or download the change file for all ${nf(rows.length)}.</p>` : ''}`;
    $$('#rec-table th.sortable').forEach(h => h.addEventListener('click', () => { const k = h.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 }; drawRecTable(); }));
    bindRows($('#rec-table'));
  }

  // ---------------- part explorer ----------------
  function renderPart() {
    const el = $('#view-part');
    const all = state.rec.results;
    const r = all.find(x => x.key === state.part) || all[0];
    state.part = r.key;
    const s = r.sku;
    const u = r.MEINS === 'L' ? 'L' : 'units';
    const idx = all.indexOf(r);
    const opts = all.slice().sort((a, b) => b.annualValue - a.annualValue).map(x => `<option value="${esc(x.MATNR + ' · ' + x.WERKS + ' · ' + x.MAKTX)}"></option>`).join('');
    const btA = r.bt.ai;
    const chTot = Object.values(r.channel).reduce((a, b) => a + b, 0) || 1;
    el.innerHTML = `
      <div class="panel">
        <div class="part-hero">
          <div class="part-title">
            <div class="eyebrow">${esc(GROUPS[r.MATKL] || r.MATKL)} · ${esc(r.plant)}</div>
            <h2>${esc(r.MAKTX)}</h2>
            <div class="part-meta"><span class="mono">${esc(r.MATNR)}</span>·<span>Plant ${esc(r.WERKS)}</span><span class="cls">${esc(r.cls)}</span><span class="chip chip-plain">${PATTERN[r.pattern]} demand</span>${r.seasonal ? '<span class="chip chip-plain">Seasonal</span>' : ''}${r.obsolete ? chip('critical', 'Superseded (MSTAE ' + r.MSTAE + ')') : ''}<span>· ${esc(r.supplier.NAME1)} (${esc(r.supplier.LAND1 || '')})</span><span>· ${inr(r.price)} / ${esc(r.MEINS)}</span></div>
            <div class="part-meta">${['30', '20', '10'].filter(k => r.channel[k]).map(k => `<span class="chip chip-plain">${esc(E.CHANNEL_NAMES[k])} ${pct(r.channel[k] / chTot, 0)}</span>`).join('')}</div>
          </div>
          <div class="part-find">
            <input type="search" id="part-q" list="part-list" placeholder="Find a part: number or name" aria-label="Find a part">
            <datalist id="part-list">${opts}</datalist>
            <button class="btn" id="part-prev" aria-label="Previous part">←</button><button class="btn" id="part-next" aria-label="Next part">→</button>
          </div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Recommendation</h3><p>Change these MRP fields in SAP (MM02, or mass change with MM17).</p></div></div>
          <div class="bigdelta"><span class="eyebrow">Safety stock</span><span class="from num">${nf(r.sap.ss)}</span><span class="arrow-to">→</span><span class="to num">${nf(r.ai.ss)}</span><span class="muted">${u}${r.ssDelta ? ` · ${r.ssDelta > 0 ? '+' : ''}${inr(r.ssDeltaValue)}` : ''}</span></div>
          <div class="table-wrap" style="margin-top:12px"><table class="fields"><thead><tr><th>SAP field</th><th>Meaning</th><th class="r">Current</th><th class="r">AI</th></tr></thead><tbody>
            <tr><td>MARC-EISBE</td><td>Safety stock</td><td class="r num">${nf(r.sap.ss)}</td><td class="r num"><b>${nf(r.ai.ss)}</b></td></tr>
            <tr><td>MARC-MINBE</td><td>Reorder point${r.seasonal ? ' (this month)' : ''}</td><td class="r num">${nf(r.sap.rop)}</td><td class="r num"><b>${nf(r.ai.rop)}</b></td></tr>
            <tr><td>MARC-MABST</td><td>Maximum stock level</td><td class="r num">${nf(r.sap.max)}</td><td class="r num"><b>${nf(r.ai.max)}</b></td></tr>
            <tr><td>MARC-PLIFZ</td><td>Planned delivery time (days)</td><td class="r num">${r.sap.plifz}</td><td class="r num"><b>${nf(r.lt.mean, 0)}</b></td></tr>
          </tbody></table></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${r.actions.length ? r.actions.map(a => chip(a.sev, a.title)).join('') : '<span class="muted">No action needed.</span>'}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Why</h3><p>Written from this part's own history.</p></div></div>
          <ul class="why">${r.explain.map(x => `<li><span>${esc(x)}</span></li>`).join('')}</ul>
          <dl class="kv" style="margin-top:16px">
            <dt>Stock on hand</dt><dd class="num">${nf(r.stock)} ${u} (${inr(r.stockValue)})${isFinite(r.coverWeeks) ? ', ' + nf(r.coverWeeks) + ' weeks of cover' : ''}</dd>
            <dt>Open purchase orders</dt><dd class="num">${nf(r.openQty)} ${u}</dd>
            <dt>Order quantity (AI)</dt><dd class="num">${nf(r.ai.q)} ${u}, economic order quantity rounded to MARC-BSTRF ${s.marc.BSTRF || 1}</dd>
            <dt>Last sale</dt><dd>${r.daysSinceIssue >= 999 ? 'over two years ago' : nf(r.daysSinceIssue) + ' days ago'}</dd>
            <dt>Supplier on time</dt><dd>${r.lt.onTime != null ? pct(r.lt.onTime, 0) + ' of POs within 2 days of EKET-EINDT' : 'no history'}</dd>
            <dt>Sizing method</dt><dd>${esc(r.method)}</dd>
          </dl>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Weekly customer demand, 104 weeks</h3><p>Sales orders (VBAP) split into delivered (LIPS) and not supplied. The line is the winning forecast model, fitted week by week.</p></div></div>
        <div class="chart-box"><canvas id="c-demand" role="img" aria-label="Weekly demand, unfilled demand and forecast"></canvas></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Reorder point, next 12 months</h3><p>${r.seasonal ? 'The AI lowers the reorder point into the monsoon and raises it for the post-monsoon surge.' : 'No seasonal pattern for this part: one reorder point all year.'}</p></div></div>
          <div class="chart-box short"><canvas id="c-cal" role="img" aria-label="Reorder point by month"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Actual supplier lead times</h3><p>PO date (EKKO-BEDAT) to goods receipt (EKBE-BUDAT), ${nf(r.lt.n)} POs.</p></div></div>
          <div class="chart-box short"><canvas id="c-lt" role="img" aria-label="Histogram of actual lead times with planned time"></canvas></div>
        </div>
      </div>
      <div class="grid-3">
        <div class="panel">
          <div class="panel-head"><div><h3>Demand during lead time</h3><p>Simulated scenarios; the reorder point covers the right-hand tail.</p></div></div>
          <div class="chart-box short"><canvas id="c-ltd" role="img" aria-label="Distribution of demand during lead time"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Service vs stock for this part</h3><p>Digital twin: each point is one reorder point.</p></div></div>
          <div class="chart-box short"><canvas id="c-curve" role="img" aria-label="Fill rate versus average stock for candidate reorder points"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Validated on history</h3><p>This part's policy replayed on the last 52 weeks of actual orders.</p></div></div>
          <div class="table-wrap"><table><tbody>
            <tr><td>Fill rate</td><td class="r num"><b>${pct(btA.fill)}</b></td></tr>
            <tr><td>Average stock</td><td class="r num"><b>${inr(btA.avgInv)}</b></td></tr>
            <tr><td>Days with a shortage</td><td class="r num"><b>${nf(btA.soDays)}</b></td></tr>
            <tr><td>Purchase orders placed</td><td class="r num"><b>${nf(btA.orders)}</b></td></tr>
            <tr><td>Sales not supplied</td><td class="r num"><b>${inr(btA.lostValue)}</b></td></tr>
          </tbody></table></div>
          ${r.fcTried.length ? `<div class="eyebrow" style="margin:14px 0 6px">Forecast model competition</div><div class="table-wrap"><table><tbody>${r.fcTried.map((m, i) => `<tr><td>${esc(m.name)}</td><td class="r num">${nf(m.rmse, 2)}</td><td>${i === 0 ? chip('good', 'Selected') : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </div>
      </div>`;
    const go = (d) => { state.part = all[(idx + d + all.length) % all.length].key; renderPart(); };
    $('#part-prev').addEventListener('click', () => go(-1));
    $('#part-next').addEventListener('click', () => go(1));
    $('#part-q').addEventListener('change', (e) => {
      const v = e.target.value.trim(); const m = v.split(' · ');
      const hit = all.find(x => m.length >= 2 ? x.MATNR === m[0] && x.WERKS === m[1] : x.MATNR === v || x.MAKTX.toLowerCase().includes(v.toLowerCase()));
      if (hit) { state.part = hit.key; destroyCharts(); renderPart(); } else toast('No part matches “' + v + '”.');
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
        { type: 'line', label: 'Forecast: ' + r.fcMethod, data: fitted ? fitted.map(x => +x.toFixed(2)) : [], borderColor: c.ai, backgroundColor: c.ai, borderWidth: 2.5, pointRadius: 0, tension: 0.25, order: 0 },
        { label: 'Delivered', data: del, backgroundColor: c.slate, stack: 'd', order: 1, borderRadius: 2 },
        { label: 'Not supplied (stockout)', data: dem.map((x, i) => Math.max(0, x - del[i])), backgroundColor: c.critical, stack: 'd', order: 1, borderRadius: 2 },
      ] },
      options: baseOpts({ interaction: { mode: 'index', intersect: false }, scales: { x: axis('', { stacked: true, grid: { display: false }, ticks: { color: c.muted, maxTicksLimit: 12, maxRotation: 0 } }), y: axis(r.MEINS === 'L' ? 'Litres per week' : 'Units per week', { stacked: true, beginAtZero: true }) } }),
    });
    chart('c-cal', {
      type: 'bar',
      data: { labels: r.calendar.map(x => MONTHS[x.m]), datasets: [
        { label: 'AI reorder point', data: r.calendar.map(x => x.rop), backgroundColor: r.calendar.map(x => (x.m >= 6 && x.m <= 8 ? c.serious : c.ai)), borderRadius: 4, barPercentage: 0.7 },
      ] },
      options: baseOpts({ scales: { x: axis('', { grid: { display: false } }), y: axis(r.MEINS === 'L' ? 'Litres' : 'Units', { beginAtZero: true }) } }),
    });
    const obs = s.pos.filter(p => p.lt != null).map(p => p.lt);
    if (obs.length) {
      const lo = Math.min(...obs, r.sap.plifz), hi = Math.max(...obs, r.sap.plifz);
      const bw = Math.max(1, Math.ceil((hi - lo + 1) / 16));
      const bins = []; for (let x = Math.floor(lo / bw) * bw; x <= hi; x += bw) bins.push(x);
      const counts = bins.map(b => obs.filter(v => v >= b && v < b + bw).length);
      const pos = (v) => (v - bins[0]) / bw - 0.5;
      chart('c-lt', {
        type: 'bar',
        data: { labels: bins.map(b => (bw > 1 ? `${b}–${b + bw - 1}` : String(b))), datasets: [{ label: 'Purchase orders', data: counts, backgroundColor: c.ai, borderRadius: 3, barPercentage: 0.9, categoryPercentage: 1 }] },
        options: baseOpts({ plugins: { legend: { display: false }, tooltip: tooltip(), vlines: { lines: [{ x: pos(r.sap.plifz + 0.5), color: c.sap, label: `Planned ${r.sap.plifz} d`, dash: [4, 3] }, { x: pos(r.lt.mean + 0.5), color: c.ink, label: `Actual avg ${nf(r.lt.mean, 0)} d` }] } }, scales: { x: axis('Days', { grid: { display: false }, ticks: { color: c.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }), y: axis('POs', { beginAtZero: true, ticks: { precision: 0, color: c.muted } }) } }),
      });
    } else $('#c-lt').closest('.chart-box').innerHTML = '<p class="muted">No purchase orders in the history.</p>';
    if (pol.ltd && pol.ltd.sorted.length && !r.stop) {
      const d = pol.ltd.sorted; const hi = Math.max(d[d.length - 1], r.ai.rop) || 1;
      const nb = 24, bw = hi / nb; const counts = new Array(nb + 1).fill(0);
      d.forEach(v => counts[Math.min(nb, Math.floor(v / bw))]++);
      chart('c-ltd', {
        type: 'bar',
        data: { labels: counts.map((_, i) => nf(Math.round(i * bw * 10) / 10)), datasets: [{ label: 'Share of scenarios', data: counts.map(x => +(x / d.length * 100).toFixed(1)), backgroundColor: c.aiSoft, borderColor: c.ai, borderWidth: 1, barPercentage: 1, categoryPercentage: 1 }] },
        options: baseOpts({ plugins: { legend: { display: false }, tooltip: Object.assign(tooltip(), { callbacks: { title: (it) => `Demand ≈ ${it[0].label}`, label: (ctx) => `${ctx.parsed.y}% of scenarios` } }), vlines: { lines: [{ x: pol.ltd.mean / bw - 0.5, color: c.sap, label: `Average ${nf(pol.ltd.mean)}`, dash: [4, 3] }, { x: r.ai.rop / bw - 0.5, color: c.ai, textColor: c.ink, label: `Reorder point ${nf(r.ai.rop)}` }] } }, scales: { x: axis(r.MEINS === 'L' ? 'Litres during lead time' : 'Units during lead time', { grid: { display: false }, ticks: { color: c.muted, maxTicksLimit: 7, maxRotation: 0 } }), y: axis('% of scenarios', { beginAtZero: true }) } }),
      });
    } else $('#c-ltd').closest('.chart-box').innerHTML = '<p class="muted">Not replenished, so there is nothing to simulate.</p>';
    if (!r.stop && r.curve.length > 1) {
      const pts = r.curve.map(p => ({ x: p.inv / 1e5, y: p.fill * 100, R: p.rop }));
      const cur = r.curve.find(p => p.rop === r.ai.rop) || r.curve[0];
      chart('c-curve', {
        type: 'scatter',
        data: { datasets: [
          { label: 'Candidates', data: pts, showLine: true, borderColor: c.ai, backgroundColor: c.ai, borderWidth: 2, pointRadius: 3, tension: 0.2 },
          { label: 'AI choice', data: [{ x: cur.inv / 1e5, y: cur.fill * 100, R: cur.rop }], backgroundColor: c.surface, borderColor: c.ai, borderWidth: 3, pointRadius: 7 },
        ] },
        options: baseOpts({ scales: { x: axis('Average stock (₹ lakh)', { ticks: { color: c.muted, callback: v => '₹' + v + ' L' } }), y: axis('Fill rate %', { ticks: { color: c.muted, callback: v => v + '%' } }) }, plugins: { legend: legend(), tooltip: Object.assign(tooltip(), { callbacks: { label: (ctx) => `${ctx.dataset.label}: reorder point ${ctx.raw.R}, fill ${ctx.parsed.y.toFixed(1)}%, stock ₹${ctx.parsed.x.toFixed(1)} L` } }) } }),
      });
    } else $('#c-curve').closest('.chart-box').innerHTML = '<p class="muted">Not replenished: no recent demand or superseded.</p>';
  }

  // ---------------- action center ----------------
  const ACTION_GROUPS = [
    { id: 'risk', title: 'Order now: stockout risk', test: a => a.type === 'reorder' && a.sev === 'critical', sev: 'critical', c: 'var(--critical)', note: 'Stock runs out before a new purchase order can arrive. Raise the PO today (ME21N) and ask the supplier to expedite.' },
    { id: 'transfer', title: 'Transfer between plants', test: a => a.type === 'transfer', sev: 'warning', c: 'var(--warning)', note: 'The other plant holds surplus of the same material. Use a stock transport order (UB) instead of buying.' },
    { id: 'reorder', title: 'Reorder', test: a => a.type === 'reorder' && a.sev !== 'critical', sev: 'warning', c: 'var(--warning)', note: 'Inventory position is at or below the AI reorder point.' },
    { id: 'excess', title: 'Excess stock: pause purchasing', test: a => a.type === 'excess', sev: 'serious', c: 'var(--serious)', note: 'Stock above the AI maximum. Stop open requisitions and let it sell down, or transfer.' },
    { id: 'dead', title: 'Dead, slow-moving and superseded stock', test: a => a.type === 'dead', sev: 'critical', c: 'var(--critical)', note: 'No demand for 26–52 weeks, or superseded (MARA-MSTAE). Redeploy, return to the supplier, liquidate or scrap, with Finance sign-off.' },
    { id: 'master', title: 'Update safety stock and reorder point in SAP', test: a => a.type === 'master', sev: 'warning', c: 'var(--ai)', note: 'Mass change with MM17 using the downloadable change file.' },
    { id: 'leadtime', title: 'Correct planned delivery time (MARC-PLIFZ)', test: a => a.type === 'leadtime', sev: 'serious', c: 'var(--serious)', note: 'The planned delivery time in the material master differs from what suppliers actually achieve.' },
  ];

  function renderActions() {
    const el = $('#view-actions');
    const rows = visible();
    const items = rows.flatMap(r => r.actions.map(a => ({ r, a })));
    const groups = ACTION_GROUPS.map(g => { const list = items.filter(x => g.test(x.a)).sort((x, y) => y.a.value - x.a.value); return Object.assign({ list, sum: list.reduce((s, x) => s + (x.a.value || 0), 0) }, g); });
    el.innerHTML = `
      <div class="atiles">${groups.map(g => `<button class="atile" style="--c:${g.c}" data-jump="${g.id}"><span>${g.title}</span><b class="num">${nf(g.list.length)}</b><span class="v">${g.sum ? inr(g.sum) : '&nbsp;'}</span></button>`).join('')}</div>
      <div class="panel-head" style="margin:0"><div><h3>This week's list</h3><p>Grouped and ranked by value. The same list can feed SAP: MM17 mass change, ME21N purchase orders, UB stock transfers.</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="dl-actions">${svg('download')}All actions (CSV)</button><button class="btn btn-primary" id="dl-change2">${svg('download')}SAP change file for MM17</button></div></div>
      <div class="agroups">${groups.map((g, gi) => `<details class="agroup" id="grp-${g.id}" ${gi < 2 ? 'open' : ''}>
          <summary><span class="caret">▸</span>${chip(g.sev, nf(g.list.length))}<h3>${g.title}</h3><span class="sum num">${g.sum ? inr(g.sum) : ''}</span></summary>
          <p class="note" style="margin-top:6px">${g.note}</p>
          ${g.list.length ? `<div class="table-wrap scroll" style="max-height:420px"><table><thead><tr><th>Material</th><th>Description</th><th>Plant</th><th>Class</th><th>Action</th><th>Detail</th><th class="r">Value</th></tr></thead><tbody>
            ${g.list.slice(0, 250).map(({ r, a }) => `<tr class="clickable" data-key="${esc(r.key)}"><td class="mono">${esc(r.MATNR)}</td><td class="desc">${esc(r.MAKTX)}</td><td class="mono">${esc(r.WERKS)}</td><td><span class="cls">${esc(r.cls)}</span></td><td>${esc(a.title)}</td><td class="wrap">${esc(a.detail)}</td><td class="r num">${a.value ? inr(a.value) : '–'}</td></tr>`).join('')}
          </tbody></table></div>${g.list.length > 250 ? `<p class="note">Top 250 of ${nf(g.list.length)} shown; the CSV has all.</p>` : ''}` : '<p class="muted" style="margin-top:8px">Nothing to do.</p>'}
        </details>`).join('')}</div>`;
    bindRows(el);
    $$('[data-jump]', el).forEach(b => b.addEventListener('click', () => { const d = $('#grp-' + b.dataset.jump); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    $('#dl-actions').addEventListener('click', () => {
      const out = [['MATNR', 'MAKTX', 'WERKS', 'CLASS', 'ACTION_TYPE', 'SEVERITY', 'ACTION', 'DETAIL', 'QTY', 'VALUE_INR']];
      items.forEach(({ r, a }) => out.push([r.MATNR, r.MAKTX, r.WERKS, r.cls, a.type, a.sev, a.title, a.detail, a.qty || '', Math.round(a.value || 0)]));
      download('safety_stock_actions.csv', toCSV(out));
    });
    $('#dl-change2').addEventListener('click', downloadChangeFile);
  }

  function downloadChangeFile() {
    const out = [['MATNR', 'WERKS', 'EISBE_OLD', 'EISBE_NEW', 'MINBE_OLD', 'MINBE_NEW', 'MABST_OLD', 'MABST_NEW', 'PLIFZ_OLD', 'PLIFZ_NEW', 'FILL_TARGET', ...MONTHS.map(m => 'MINBE_' + m.toUpperCase()), 'REASON']];
    visible().forEach(r => {
      const plif = r.lt.n >= 3 ? Math.round(r.lt.mean) : r.sap.plifz;
      const byMonth = MONTHS.map((_, m) => { const c = r.calendar.find(x => x.m === m); return c ? c.rop : r.ai.rop; });
      if (r.ai.ss !== r.sap.ss || r.ai.rop !== r.sap.rop || r.ai.max !== r.sap.max || plif !== r.sap.plifz)
        out.push([r.MATNR, r.WERKS, r.sap.ss, r.ai.ss, r.sap.rop, r.ai.rop, r.sap.max, r.ai.max, r.sap.plifz, plif, r.stop ? '' : r.svc.toFixed(3), ...byMonth, r.explain[r.explain.length - 1]]);
    });
    download('sap_mrp_change_file_MM17.csv', toCSV(out));
  }

  // ---------------- suppliers ----------------
  function renderSuppliers() {
    const el = $('#view-suppliers');
    const g = {};
    for (const r of visible()) for (const p of r.sku.pos) {
      if (p.lt == null) continue;
      const x = g[p.LIFNR] || (g[p.LIFNR] = { lifnr: p.LIFNR, lts: [], plan: [], late: [], parts: new Set(), value: 0 });
      x.lts.push(p.lt); x.plan.push(r.sap.plifz); if (p.late != null) x.late.push(p.late); x.parts.add(r.key); x.value += p.qty * r.price;
    }
    const sup = state.model.prep.suppliers;
    const rows = Object.values(g).map(x => {
      const m = x.lts.reduce((a, b) => a + b, 0) / x.lts.length, pm = x.plan.reduce((a, b) => a + b, 0) / x.plan.length;
      const sdv = Math.sqrt(x.lts.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, x.lts.length - 1));
      return { lifnr: x.lifnr, name: (sup[x.lifnr] || {}).NAME1 || x.lifnr, land: (sup[x.lifnr] || {}).LAND1 || '', pos: x.lts.length, parts: x.parts.size, mean: m, plan: pm, sd: sdv, onTime: x.late.length ? x.late.filter(v => v <= 2).length / x.late.length : null, late: x.late.length ? x.late.reduce((a, b) => a + b, 0) / x.late.length : 0, value: x.value };
    }).sort((a, b) => (b.mean - b.plan) - (a.mean - a.plan));
    const imp = rows.filter(x => x.land !== 'IN'), dom = rows.filter(x => x.land === 'IN');
    const w = (arr, f) => arr.reduce((a, x) => a + f(x) * x.pos, 0) / (arr.reduce((a, x) => a + x.pos, 0) || 1);
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Import suppliers', `${nf(w(imp, x => x.mean), 0)} d`, `actual average · planned ${nf(w(imp, x => x.plan), 0)} d`)}
        ${kpi('Domestic suppliers', `${nf(w(dom, x => x.mean), 0)} d`, `actual average · planned ${nf(w(dom, x => x.plan), 0)} d`)}
        ${kpi('On time (within 2 days of EKET-EINDT)', pct(w(rows, x => x.onTime || 0), 0), 'share of purchase orders')}
        ${kpi('Suppliers', nf(rows.length), `${nf(rows.reduce((a, x) => a + x.pos, 0))} POs received`)}
      </div>
      <div class="panel"><div class="panel-head"><div><h3>Planned vs actual lead time by supplier</h3><p>Planned = MARC-PLIFZ in the material master. Actual = goods receipt (EKBE-BUDAT) minus PO date (EKKO-BEDAT). Wide variation needs more safety stock even when the average is right.</p></div><div class="legend"><span><i class="swatch-sap"></i>Planned (PLIFZ)</span><span><i class="swatch-ai"></i>Actual average</span></div></div>
        <div class="chart-box" style="height:${Math.max(300, rows.length * 30 + 60)}px"><canvas id="c-sup" role="img" aria-label="Planned versus actual lead time by supplier"></canvas></div></div>
      <div class="panel"><div class="panel-head"><div><h3>Supplier scorecard</h3><p>Two years of purchase orders for the parts in scope.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Country</th><th class="r">Parts</th><th class="r">POs</th><th class="r">PO value</th><th class="r">Planned d</th><th class="r">Actual d</th><th class="r">Gap d</th><th class="r">Variability ±d</th><th class="r">On time</th><th class="r">Avg days late</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td><b>${esc(x.name)}</b> <span class="muted mono">${esc(x.lifnr)}</span></td><td>${esc(x.land)}</td><td class="r num">${nf(x.parts)}</td><td class="r num">${nf(x.pos)}</td><td class="r num">${inr(x.value)}</td><td class="r num">${nf(x.plan, 0)}</td><td class="r num">${nf(x.mean, 0)}</td><td class="r num ${x.mean - x.plan > 3 ? 'up' : x.mean - x.plan < -3 ? 'down' : ''}">${x.mean - x.plan > 0 ? '+' : ''}${nf(x.mean - x.plan, 0)}</td><td class="r num">${nf(x.sd, 0)}</td><td class="r num">${x.onTime != null ? pct(x.onTime, 0) : '–'}</td><td class="r num">${nf(x.late, 1)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    const c = colors();
    chart('c-sup', {
      type: 'bar',
      data: { labels: rows.map(x => x.name), datasets: [
        { type: 'scatter', label: 'Planned (PLIFZ)', data: rows.map(x => ({ x: x.plan, y: x.name })), backgroundColor: c.sap, borderColor: c.surface, borderWidth: 2, pointRadius: 7, pointStyle: 'rectRot' },
        { type: 'scatter', label: 'Actual average', data: rows.map(x => ({ x: x.mean, y: x.name })), backgroundColor: c.ai, borderColor: c.surface, borderWidth: 2, pointRadius: 7 },
        { label: 'Gap', data: rows.map(x => [Math.min(x.plan, x.mean), Math.max(x.plan, x.mean)]), backgroundColor: c.line, barPercentage: 0.28, categoryPercentage: 1, borderRadius: 3 },
      ] },
      options: baseOpts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: Object.assign(tooltip(), { filter: (it) => it.dataset.label !== 'Gap', callbacks: { label: (ctx) => `${ctx.dataset.label}: ${nf(ctx.parsed.x, 0)} days` } }) }, scales: { x: axis('Days', { beginAtZero: true }), y: { type: 'category', labels: rows.map(x => x.name), grid: { display: false }, border: { display: false }, ticks: { color: c.ink2 } } } }),
    });
  }

  // ---------------- data & method ----------------
  function renderData() {
    const el = $('#view-data');
    const T = state.T;
    el.innerHTML = `
      <div class="panel"><div class="panel-head"><div><h3>How the AI sets safety stock</h3><p>Eight steps, run for every material × plant on each refresh. The Feature guide explains each capability.</p></div></div>
        <ol class="steps">
          <li><span class="n">01 · Demand</span><b>True demand, not consumption</b><span>Sales order lines (VBAP) include demand that could not be delivered, which goods issues alone would hide. Stock transfers (301/311/641) are kept apart from real consumption.</span></li>
          <li><span class="n">02 · Cleansing</span><b>Remove one-off bulk orders</b><span>Project orders beyond Q3 + 3×IQR are capped, so a single order does not inflate safety stock for years.</span></li>
          <li><span class="n">03 · Segmentation</span><b>ABC × XYZ and demand pattern</b><span>ABC by sales value. XYZ by monthly coefficient of variation (X &lt; 0.2, Y 0.2–0.5, Z &gt; 0.5). Syntetos-Boylan classes: smooth, erratic, intermittent, lumpy.</span></li>
          <li><span class="n">04 · Forecast</span><b>Model competition per part</b><span>Moving averages, exponential smoothing, damped trend, monsoon-seasonal and Croston-SBA models compete on the last 26 weeks. Lowest error wins.</span></li>
          <li><span class="n">05 · Lead time</span><b>Actual supplier performance</b><span>PO date to goods receipt (EKKO/EKBE), blended with the supplier's history when a part has few POs. On-time rate against EKET-EINDT.</span></li>
          <li><span class="n">06 · Digital twin</span><b>Simulate each part</b><span>10 years of weekly demand and lead-time scenarios are replayed under about 18 candidate reorder points to map service against stock.</span></li>
          <li><span class="n">07 · Optimise</span><b>Spend the stock budget where it earns most</b><span>Marginal analysis across all parts, or service targets by class and sales channel. Reorder points follow the monsoon month by month.</span></li>
          <li><span class="n">08 · Prove</span><b>Validate on history</b><span>The policy is replayed on the actual orders of the last 52 weeks, re-calibrated every 8 weeks using only past data.</span></li>
        </ol>
      </div>
      <div class="panel"><div class="panel-head"><div><h3>Expert review: what this use case adopts</h3><p>From the SAP table mapping prepared on the business side (18 Sep 2026), filtered to what matters for safety stock.</p></div></div>
        <div class="grid-2">
          <ul class="adopt">
            <li><span class="ic y">✓</span><span><b>Monsoon seasonality.</b> Demand by posting month drives a seasonal forecast and month-by-month reorder points.</span></li>
            <li><span class="ic y">✓</span><span><b>Service levels per channel</b> (VBAK-VTWEG: third-party, OEM, dealership). Fill rate by channel, and channel targets feed the service-target policy.</span></li>
            <li><span class="ic y">✓</span><span><b>XYZ on monthly CV</b> with X &lt; 0.2, Y 0.2–0.5, Z &gt; 0.5.</span></li>
            <li><span class="ic y">✓</span><span><b>Actual lead time</b> = goods-receipt posting date − PO date, compared with MARC-PLIFZ, with EKET-EINDT for on-time delivery.</span></li>
            <li><span class="ic y">✓</span><span><b>Transfers (301/311) kept out of consumption</b>, so rebalancing between branches is not mistaken for demand.</span></li>
            <li><span class="ic y">✓</span><span><b>Superseded and obsolete parts</b> via MARA-MSTAE: no safety stock, listed for release.</span></li>
            <li><span class="ic y">✓</span><span><b>Working-capital release view</b>: ΔSS × price, holding-cost rate, aging by days since last issue.</span></li>
          </ul>
          <ul class="adopt">
            <li><span class="ic p">+</span><span><b>Optional SAP extracts in the pilot:</b> VBEP (confirmed quantity BMENG) for service against the requested date; EINE-APLFZ as a second planned lead time; MVER period consumption for reconciliation; T001L storage locations; MCHB batch stock.</span></li>
            <li><span class="ic p">+</span><span><b>Non-SAP branch records:</b> counter lost-sales logs (demand never keyed into SAP), supersession cross-reference lists, branch Excel reorder sheets, stock-take sheets.</span></li>
            <li><span class="ic p">+</span><span><b>History length:</b> the model runs on 24 months or more; 5 years sharpens the seasonal profile.</span></li>
            <li><span class="ic n">–</span><span><b>Not needed for safety stock:</b> pricing conditions (A017/A018/KONP, PRCD_ELEMENTS), vendor company-code and contact data (LFB1/LFM1), SOP transactions (MC84/MC87).</span></li>
          </ul>
        </div>
      </div>
      <div class="panel"><div class="panel-head"><div><h3>SAP tables and fields to extract</h3><p>Master data as a current snapshot; documents and movements with 2–5 years of history. Row counts are for the data loaded now.</p></div>
        <button class="btn" id="dl-dict">${svg('download')}Field list (CSV)</button></div>
        <div class="table-wrap"><table><thead><tr><th>Table</th><th>Description</th><th>Fields</th><th>Used for</th><th class="r">Rows loaded</th></tr></thead><tbody>
          ${SAP.DICTIONARY.map(d => `<tr><td class="mono"><b>${d.table}</b>${REQUIRED.includes(d.table) ? '' : ' <span class="muted">(optional)</span>'}</td><td>${esc(d.desc)}</td><td class="wrap mono" style="font-size:12px">${esc(d.fields)}</td><td class="wrap">${esc(d.use)}</td><td class="r num">${nf((T[d.table] || []).length)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="grid-2" style="margin-top:16px">
          <div><h3 style="margin-bottom:8px">Suggested selection</h3>
            <ul class="why">
              <li><span>MATDOC: BWART 101/102, 201/202, 261/262, 601/602 for demand and receipts; 301/311, 641/642 as transfers. BUDAT ≥ today − 5 years, pilot plants.</span></li>
              <li><span>VBAK/VBAP (+ VBEP): ERDAT ≥ today − 5 years, parts-sales order types; keep ABGRU and VTWEG.</span></li>
              <li><span>EKKO/EKPO/EKET/EKBE: BEDAT ≥ today − 5 years; EKBE with VGABE = 1 (goods receipt).</span></li>
              <li><span>MARA/MARC/MARD/MBEW: pilot SKU list, current snapshot, including MARA-MSTAE.</span></li>
              <li><span>Refresh daily and incrementally by BUDAT / ERDAT / AEDAT, as a background job after office hours.</span></li>
            </ul></div>
          <div><h3 style="margin-bottom:8px">Extraction and write-back</h3>
            <ul class="why">
              <li><span>Uses the partner's on-premise extractor: a field list per table, WHERE conditions, full or incremental background jobs, no ABAP and no transports.</span></li>
              <li><span>One CSV per table with SAP technical field names, as in the sample below.</span></li>
              <li><span>Back to SAP: a change file for MM17 (MARC-EISBE, MINBE, MABST, PLIFZ, plus a reorder point per month). No automatic write-back in the pilot.</span></li>
            </ul></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><div><h3>Download the sample extract</h3><p>The generated SAP tables behind this demo, one CSV per table.</p></div></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">${Object.keys(T).filter(k => Array.isArray(T[k]) && T[k].length).map(k => `<button class="btn" data-dl="${k}">${k} <span class="muted num">${nf(T[k].length)}</span></button>`).join('')}</div>
          <p class="note" style="margin-top:10px">VBAK, VBAP, LIPS and MATDOC are several MB each.</p>
        </div>
        <div class="panel"><div class="panel-head"><div><h3>Run on your own SAP extract</h3><p>One CSV per table, named after the table (MARA.csv, MARC.csv …). Comma, semicolon, tab or pipe separated; dates as YYYYMMDD, YYYY-MM-DD or DD.MM.YYYY.</p></div></div>
          <label class="upload" id="drop">${svg('upload').replace('<svg', '<svg width="22" height="22" style="stroke:var(--accent);fill:none;stroke-width:2"')}<b>Choose CSV files or drop them here</b><span class="note">Required: ${REQUIRED.join(', ')}. Optional: ${OPTIONAL.join(', ')}. Files are processed in this browser only.</span><input type="file" id="upload" multiple accept=".csv,.txt,text/csv" hidden></label>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${state.source !== 'sample' ? '<button class="btn" id="reset-sample">Back to sample data</button>' : ''}</div>
          <p class="note" id="upload-msg" style="margin-top:8px"></p>
        </div>
      </div>`;
    $$('[data-dl]', el).forEach(b => b.addEventListener('click', () => { const k = b.dataset.dl; download(k + '.csv', tableCSV(T[k])); }));
    $('#dl-dict').addEventListener('click', () => download('sap_tables_and_fields.csv', toCSV([['TABLE', 'DESCRIPTION', 'FIELDS', 'USED_FOR']].concat(SAP.DICTIONARY.map(d => [d.table, d.desc, d.fields, d.use])))));
    const up = $('#upload'), drop = $('#drop');
    up.addEventListener('change', () => loadFiles(up.files));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', e => loadFiles(e.dataTransfer.files));
    const rs = $('#reset-sample'); if (rs) rs.addEventListener('click', () => { state.part = null; state.tab = 'overview'; runPipeline(SAP.generate(), 'sample'); });
  }

  // ---------------- feature guide ----------------
  const FEATURES = [
    { t: 'True demand, including lost sales', v: 'service', d: 'Reads sales order lines against deliveries, so demand that could not be supplied still counts in the forecast and the safety stock.', data: 'VBAK, VBAP, LIPS', mrp: 'Consumption-based planning learns from goods issues and consumption totals; an order that was not delivered never enters the history.' },
    { t: 'Measured lead times and their spread', v: 'suppliers', d: 'Learns the real PO-to-receipt time for every supplier and part, with its variability, and blends in the supplier history when a part has few orders.', data: 'EKKO, EKPO, EKET, EKBE', mrp: 'Uses one planned delivery time per material or info record (PLIFZ / APLFZ); lead-time variability is not part of the safety-stock calculation.' },
    { t: 'Safety stock sized to a fill-rate target', v: 'part', d: 'Sizes safety stock so a stated share of ordered quantity is supplied from stock, from forecast error and lead-time variability together.', data: 'VBAP, EKBE, MBEW', mrp: 'Safety stock is a fixed quantity, a range of coverage, or a normal-distribution formula on forecast error with a fixed lead time.' },
    { t: 'Demand-pattern detection and model competition', v: 'overview', d: 'Classifies each part as smooth, erratic, intermittent or lumpy, then lets 5 forecasting models compete on its own recent history; Croston-SBA handles spare-parts demand with many zero weeks.', data: 'VBAP', mrp: 'Forecast models cover constant, trend and seasonal demand; intermittent-demand models such as Croston are not part of standard MRP forecasting.' },
    { t: 'Digital twin per part', v: 'part', d: 'Simulates 10 years of demand and lead-time scenarios under ~18 reorder points to draw each part\'s own service-vs-stock curve.', data: 'VBAP, EKBE, MARC lot sizes', mrp: 'No simulation: parameters are set and the effect is seen only after it happens.' },
    { t: 'One stock budget, spent where it earns most', v: 'overview', d: 'Allocates a working-capital budget across all parts at once, giving each extra rupee of stock to the part where it prevents the most lost sales.', data: 'All of the above, MBEW prices', mrp: 'Each material is planned on its own; there is no portfolio view of service against total inventory investment.' },
    { t: 'Monsoon-aware reorder points', v: 'capital', d: 'Learns the seasonal profile per material group, so even slow parts get it, and sets a reorder point for each month.', data: 'VBAP / MATDOC by posting month', mrp: 'A manual reorder point stays fixed; automatic reorder points use only the part\'s own history, which is too thin for slow movers to show a season.' },
    { t: 'Service targets by sales channel', v: 'service', d: 'Tracks fill rate for dealership, OEM and third-party sales and raises a part\'s target to the channel mix it serves.', data: 'VBAK-VTWEG, VBAP, LIPS', mrp: 'Safety stock has no notion of which channel the demand comes from.' },
    { t: 'Validated on history before go-live', v: 'overview', d: 'Replays the policy day by day on the last 52 weeks of actual orders, re-calibrating every 8 weeks with only past data, and reports fill rate and stock.', data: 'Full history', mrp: 'No replay of past demand against proposed settings.' },
    { t: 'A written reason for every number', v: 'part', d: 'Each recommendation comes with a plain-language explanation: demand pattern, model, lead time, season, one-off orders removed, target.', data: 'All inputs', mrp: 'Parameters carry no explanation of why they have their value.' },
    { t: 'Transfer before you buy', v: 'actions', d: 'When one plant needs stock that another holds in surplus, the AI proposes a stock transfer and its value instead of a purchase order.', data: 'MARD, MARC, both plants', mrp: 'Plants are planned separately unless special procurement between them is configured; surplus elsewhere is not offered as a source.' },
    { t: 'Working-capital release plan', v: 'capital', d: 'Ranks dead, superseded, slow-moving and excess stock by value, shows aging, and walks from today\'s stock to the AI level with the holding-cost saving.', data: 'MARD, MBEW, MATDOC, MARA-MSTAE', mrp: 'Stock lists and aging reports exist, but not tied to a target stock level per part.' },
    { t: 'What-if in seconds', v: 'overview', d: 'Switch between lean, balanced and high-service settings, drag a budget, or change channel targets, and every recommendation and chart updates.', data: '—', mrp: 'Changing a policy means editing master data and waiting for the next MRP run to see the effect.' },
    { t: 'Outside SAP, read-only', v: 'data', d: 'Runs on CSV extracts on DOZCO\'s own platform. No ABAP, no transports; results go back as a change file for mass maintenance (MM17) after review.', data: 'Extractor CSVs', mrp: 'Not applicable: SAP stays the system of record and is not modified.' },
  ];

  function renderHelp() {
    const el = $('#view-help');
    const name = Object.fromEntries(VIEWS.filter(v => v.id).map(v => [v.id, v.label]));
    el.innerHTML = `
      <div class="panel">
        <div class="panel-head"><div><h3>What the AI does for safety stock</h3><p>Fourteen capabilities in this demo. Each card says what it does, which SAP data it uses, where to see it, and what it adds beyond standard MRP. Figures in the demo come from generated sample data in SAP table layouts.</p></div></div>
        <div class="features">${FEATURES.map((f, i) => `
          <article class="feature">
            <div class="feature-n">${String(i + 1).padStart(2, '0')}</div>
            <h3>${esc(f.t)}</h3>
            <p>${esc(f.d)}</p>
            <div class="feature-beyond"><span class="eyebrow">Beyond standard MRP</span><p>${esc(f.mrp)}</p></div>
            <div class="feature-foot"><span class="mono">${esc(f.data)}</span><button class="btn" data-go="${f.v}">See it in ${esc(name[f.v])} →</button></div>
          </article>`).join('')}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>How to read the demo</h3></div></div>
        <ul class="why">
          <li><span><b>Stocking policy</b> (top bar): Lean stock, Balanced and High service pick points on the validated service-vs-stock curve. Service targets uses fill-rate targets by ABC/XYZ class and sales channel. Custom budget lets you set the stock budget yourself.</span></li>
          <li><span><b>Validated</b> means replayed on the last 52 weeks of actual sales orders, with supplier lead times drawn from real purchase orders and re-calibration every 8 weeks using only past data.</span></li>
          <li><span><b>Current</b> values come from the material master (MARC) and are shown only so the change file can be reviewed.</span></li>
          <li><span><b>Your own data:</b> on SAP data &amp; method, load one CSV per table; everything runs in the browser.</span></li>
        </ul>
      </div>`;
    $$('[data-go]', el).forEach(b => b.addEventListener('click', () => setTab(b.dataset.go)));
  }

  // ---------------- CSV ----------------
  function toCSV(rows) { return rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); }
  function tableCSV(rows) { if (!rows.length) return ''; const cols = Object.keys(rows[0]); return toCSV([cols].concat(rows.map(r => cols.map(c => r[c])))); }
  // In the claude.ai viewer, files go through its downloads capability; elsewhere a normal browser download.
  async function download(name, text) {
    const data = '﻿' + text;
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
    const nl = text.indexOf('\n'); const first = nl > 0 ? text.slice(0, nl) : text;
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
    const normDate = (v) => { if (/^\d{2}\.\d{2}\.\d{4}/.test(v)) return v.slice(6, 10) + v.slice(3, 5) + v.slice(0, 2); return String(v).replace(/[^0-9]/g, '').slice(0, 8); };
    const DATE = ['ERDAT', 'BUDAT', 'BEDAT', 'EINDT', 'WADAT_IST', 'ERSDA', 'MSTDE'];
    for (const k in T) for (const r of T[k]) {
      for (const f of DATE) if (r[f] != null) r[f] = normDate(r[f]);
      if (r.MATNR != null) r.MATNR = r.MATNR.replace(/^0+(?=\d)/, '');
      for (const f of ['MENGE', 'KWMENG', 'LFIMG', 'LABST', 'VERPR', 'STPRS', 'NETPR', 'EISBE', 'MINBE', 'MABST', 'BSTMI', 'BSTRF', 'PLIFZ']) if (r[f] != null) r[f] = r[f].replace(/\s/g, '').replace(/,(?=\d{1,3}$)/, '.').replace(/,/g, '');
    }
    msg.textContent = 'Loaded ' + Object.keys(T).map(k => `${k} (${nf(T[k].length)})`).join(', ') + '. Analysing…';
    state.part = null; state.tab = 'overview';
    try { await runPipeline(T, 'upload'); toast('Analysis complete on your data.'); }
    catch (e) { console.error(e); $('#loading').hidden = true; state.tab = 'data'; render(); $('#upload-msg').textContent = 'Could not analyse these files: ' + e.message; }
  }

  // ---------------- events ----------------
  $$('.seg button').forEach(b => b.addEventListener('click', () => { state.preset = b.dataset.preset; applyPreset(); buildNav(); render(); }));
  $('#budget').addEventListener('input', e => { state.mult = +e.target.value; $('#budget-out').textContent = inr(state.model.sapTwin.inv * state.mult); });
  $('#budget').addEventListener('change', () => { applyPreset(); buildNav(); render(); });
  $('#plant').addEventListener('change', e => { state.plant = e.target.value; render(); });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render()); } catch (e) { /* older browsers */ }
  new MutationObserver(() => render()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const hash = (location.hash || '').replace('#', '');
  if (VIEWS.some(v => v.id === hash)) state.tab = hash;

  (async () => {
    progress('Generating sample SAP extract (2 years, 2 plants)', 0.01);
    await new Promise(r => setTimeout(r, 40));
    await runPipeline(SAP.generate(), 'sample');
  })().catch(e => { console.error(e); progress('Something went wrong: ' + e.message, 0); });
})();
