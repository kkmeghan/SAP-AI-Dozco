#!/usr/bin/env node
/*
 * Writes the generated sample SAP extract as one CSV per table, in the same
 * layout the app accepts for upload (SAP technical field names, dates YYYYMMDD).
 *
 *   node tools/export-sample-data.js [outDir] [--materials N]
 *
 * --materials limits the extract to the first N materials (smaller files for
 * sharing the format with the SAP team). Default: all 500.
 */
const fs = require('fs');
const path = require('path');
const sap = require('../app/js/sapdata.js');

const args = process.argv.slice(2);
const outDir = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'sample-data');
const mi = args.indexOf('--materials');
const limit = mi >= 0 ? +args[mi + 1] : Infinity;

const T = sap.generate();
let keep = null;
if (isFinite(limit)) {
  keep = new Set(T.MARA.slice(0, limit).map(m => m.MATNR));
  const po = new Set(T.EKPO.filter(p => keep.has(p.MATNR)).map(p => p.EBELN));
  const so = new Set(T.VBAP.filter(p => keep.has(p.MATNR)).map(p => p.VBELN));
  for (const k of Object.keys(T)) {
    const rows = T[k];
    if (!rows.length) continue;
    if ('MATNR' in rows[0]) T[k] = rows.filter(r => keep.has(r.MATNR));
    else if (k === 'EKKO') T[k] = rows.filter(r => po.has(r.EBELN));
    else if (k === 'EKET' || k === 'EKBE') T[k] = rows.filter(r => po.has(r.EBELN));
    else if (k === 'VBAK') T[k] = rows.filter(r => so.has(r.VBELN));
  }
}

const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
fs.mkdirSync(outDir, { recursive: true });
for (const [name, rows] of Object.entries(T)) {
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  const text = [cols.join(',')].concat(rows.map(r => cols.map(c => cell(r[c])).join(','))).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, name + '.csv'), text);
  console.log(name.padEnd(7), String(rows.length).padStart(7), 'rows');
}
