#!/usr/bin/env node
/*
 * End-to-end check of the engine on the generated sample data:
 * generate -> build -> backtest -> recommend. Fails if the AI policy does not
 * beat SAP MRP on the backtest, or if outputs are malformed.
 */
const sap = require('../app/js/sapdata.js');
const engine = require('../app/js/engine.js');

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

(async () => {
  const t0 = Date.now();
  const T = sap.generate();
  const model = await engine.build(T);
  const bt = engine.backtest(model, {}, { frontier: true });
  const rec = engine.recommend(model, { mode: 'budget', budget: model.sapTwin.inv * bt.sameService.mult });
  const cr = (x) => (x / 1e7).toFixed(2) + ' Cr';

  console.log(`parts ${rec.results.length}, build+backtest ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`SAP MRP backtest   fill ${(bt.sap.fill * 100).toFixed(1)}%  avg stock ₹${cr(bt.sap.inv)}`);
  console.log(`AI, same service   avg stock ₹${cr(bt.sameService.inv)}`);
  console.log(`AI, same stock     fill ${(bt.sameInventory.fill * 100).toFixed(1)}%`);

  if (!(rec.results.length > 100)) fail('too few parts');
  for (const r of rec.results) {
    if (![r.ai.ss, r.ai.rop, r.ai.max, r.ai.q].every(Number.isFinite)) fail('non-finite policy for ' + r.key);
    if (r.ai.ss < 0 || r.ai.max < r.ai.rop) fail('inconsistent policy for ' + r.key);
    if (!r.explain.length) fail('no explanation for ' + r.key);
  }
  if (!(bt.sameService.inv < bt.sap.inv)) fail('AI does not need less stock at the same service');
  if (!(bt.sameInventory.fill > bt.sap.fill)) fail('AI does not raise service at the same stock');
  console.log('OK');
})().catch((e) => fail(e.stack));
