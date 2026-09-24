/*
 * Sample SAP S/4HANA extract generator.
 *
 * Produces tables with real SAP table and field names (MARA, MARC, MARD, MBEW,
 * MATDOC, EKKO/EKPO/EKET/EKBE, VBAK/VBAP/LIPS, LFA1, KNA1, T001W) for a
 * heavy-equipment spare-parts trading business. The history is simulated
 * day by day under the *current* SAP MRP settings (static MARC-EISBE,
 * MARC-MINBE reorder point, MARC-MABST max stock, MARC-PLIFZ planned delivery
 * time), so stock, purchase orders, goods receipts, stockouts and lost sales
 * are all internally consistent - just like a real extract.
 *
 * The analytics engine only reads these tables; it never sees the hidden
 * generator parameters. Real extracts in the same layout can be loaded instead.
 */
(function (root) {
  'use strict';

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

  const HISTORY_START = Date.UTC(2024, 8, 23); // Monday 23-Sep-2024
  const DAYS = 728; // 104 weeks, ends Sunday 20-Sep-2026
  const DAY_MS = 86400000;

  function dats(dayIndex) {
    const d = new Date(HISTORY_START + dayIndex * DAY_MS);
    return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  }

  const PLANTS = [
    { WERKS: '1100', NAME1: 'Main Branch - Visakhapatnam', ORT01: 'Visakhapatnam', share: 0.62 },
    { WERKS: '1200', NAME1: 'Regional Warehouse - Visakhapatnam', ORT01: 'Visakhapatnam', share: 0.38 },
  ];

  // Category catalogue for an earth-moving / construction equipment parts trader.
  // pat weights: [smooth, erratic, intermittent, lumpy]
  const CATS = [
    { MATKL: 'FILT', name: 'Filters', n: 70, price: [450, 6500], meins: 'EA', rate: [4, 40], pat: [0.6, 0.3, 0.07, 0.03], seas: 0.18,
      parts: ['Engine Oil Filter', 'Fuel Filter Primary', 'Fuel Water Separator', 'Air Filter Outer', 'Air Filter Inner', 'Hydraulic Return Filter', 'Pilot Line Filter', 'Transmission Filter', 'Cabin Air Filter', 'Breather Filter'] },
    { MATKL: 'LUBE', name: 'Lubricants & Fluids', n: 30, price: [240, 950], meins: 'L', rate: [60, 600], pat: [0.7, 0.28, 0.02, 0], seas: 0.25,
      parts: ['Engine Oil 15W-40', 'Hydraulic Oil HV46', 'Hydraulic Oil HV68', 'Transmission Fluid TO-4', 'Gear Oil 80W-90', 'Coolant Concentrate', 'Grease EP2', 'Axle Oil LS'] },
    { MATKL: 'GET', name: 'Ground Engaging Tools', n: 55, price: [1500, 28000], meins: 'EA', rate: [2, 30], pat: [0.2, 0.5, 0.1, 0.2], seas: 0.3,
      parts: ['Bucket Tooth Point', 'Bucket Adapter', 'Side Cutter', 'Cutting Edge', 'End Bit', 'Tooth Pin & Retainer', 'Ripper Tip', 'Wear Plate'] },
    { MATKL: 'UCAR', name: 'Undercarriage', n: 45, price: [12000, 420000], meins: 'EA', rate: [0.3, 4], pat: [0.08, 0.22, 0.25, 0.45], seas: 0.1,
      parts: ['Track Roller Assy', 'Carrier Roller', 'Idler Assy', 'Sprocket', 'Track Chain Assy', 'Track Shoe 600mm', 'Track Adjuster', 'Track Bolt Kit'] },
    { MATKL: 'HYDR', name: 'Hydraulics', n: 75, price: [1800, 180000], meins: 'EA', rate: [0.4, 10], pat: [0.2, 0.25, 0.35, 0.2], seas: 0.08,
      parts: ['Hydraulic Hose Assy', 'Boom Cylinder Seal Kit', 'Arm Cylinder Seal Kit', 'Bucket Cylinder Seal Kit', 'Main Pump', 'Pilot Pump', 'Control Valve', 'Swivel Joint Seal Kit', 'Travel Motor', 'Swing Motor', 'O-Ring Kit'] },
    { MATKL: 'ELEC', name: 'Electricals', n: 55, price: [1200, 85000], meins: 'EA', rate: [0.3, 6], pat: [0.1, 0.2, 0.45, 0.25], seas: 0.05,
      parts: ['Alternator', 'Starter Motor', 'Pressure Sensor', 'Speed Sensor', 'Temperature Sensor', 'Wiring Harness', 'Relay', 'Solenoid Valve', 'Monitor Panel', 'Work Lamp LED', 'Battery 12V 150Ah'] },
    { MATKL: 'ENGN', name: 'Engine Parts', n: 70, price: [900, 240000], meins: 'EA', rate: [0.3, 12], pat: [0.2, 0.25, 0.3, 0.25], seas: 0.05,
      parts: ['Cylinder Head Gasket', 'Fuel Injector', 'Turbocharger', 'Water Pump', 'Fan Belt', 'Thermostat', 'Piston Ring Set', 'Oil Cooler', 'Radiator Core', 'Injection Pump', 'Valve Cover Gasket'] },
    { MATKL: 'TRNS', name: 'Transmission & Drivetrain', n: 35, price: [8000, 520000], meins: 'EA', rate: [0.2, 3], pat: [0.05, 0.15, 0.35, 0.45], seas: 0.05,
      parts: ['Final Drive Assy', 'Swing Gearbox', 'Clutch Plate Set', 'Planetary Gear', 'Drive Shaft', 'Torque Converter', 'Axle Shaft', 'Differential Kit'] },
    { MATKL: 'BRNG', name: 'Bearings & Seals', n: 40, price: [250, 16000], meins: 'EA', rate: [1, 25], pat: [0.45, 0.35, 0.15, 0.05], seas: 0.1,
      parts: ['Taper Roller Bearing', 'Swing Bearing Seal', 'Floating Seal', 'Oil Seal', 'Needle Bearing', 'Bushing', 'Duo-Cone Seal'] },
    { MATKL: 'FAST', name: 'Fasteners & Hardware', n: 25, price: [15, 450], meins: 'EA', rate: [40, 400], pat: [0.7, 0.25, 0.05, 0], seas: 0.1,
      parts: ['Hex Bolt M16', 'Hex Bolt M20', 'Plow Bolt', 'Nut M20', 'Washer Hardened', 'Circlip', 'Grease Nipple'] },
  ];

  const MODELS = ['EX-14', 'EX-21', 'EX-30', 'EX-48', 'WL-90', 'WL-150', 'MG-140', 'SR-12', 'DZ-65', 'BL-7', 'AT-25', 'Universal'];

  const SUPPLIERS = [
    ['DOM', 'Coastal Filtration Pvt Ltd', 'IN', 'Chennai', 9, 0.18],
    ['DOM', 'Deccan Lubricants Ltd', 'IN', 'Hyderabad', 6, 0.12],
    ['DOM', 'Sri Venkateswara Hydraulics', 'IN', 'Visakhapatnam', 8, 0.35],
    ['DOM', 'Pune Earthmover Components', 'IN', 'Pune', 18, 0.28],
    ['DOM', 'Bharat Bearing Distributors', 'IN', 'Kolkata', 12, 0.2],
    ['DOM', 'Andhra Fasteners & Tools', 'IN', 'Vijayawada', 5, 0.15],
    ['DOM', 'Kaveri Electricals', 'IN', 'Bengaluru', 14, 0.4],
    ['DOM', 'Nagpur GET Works', 'IN', 'Nagpur', 16, 0.3],
    ['DOM', 'Western Engine Spares', 'IN', 'Ahmedabad', 20, 0.33],
    ['DOM', 'OEM India Parts Depot', 'IN', 'Bengaluru', 12, 0.22],
    ['IMP', 'Nordic Machinery Parts AB', 'SE', 'Gothenburg', 55, 0.25],
    ['IMP', 'Shandong Track Systems Co', 'CN', 'Jining', 48, 0.38],
    ['IMP', 'Guangzhou Hydraulic Co', 'CN', 'Guangzhou', 42, 0.42],
    ['IMP', 'Rhein Antriebstechnik GmbH', 'DE', 'Cologne', 62, 0.2],
    ['IMP', 'Osaka Precision Components', 'JP', 'Osaka', 50, 0.15],
    ['IMP', 'Great Lakes Powertrain Inc', 'US', 'Peoria', 70, 0.3],
    ['IMP', 'Busan Undercarriage Co', 'KR', 'Busan', 45, 0.27],
    ['IMP', 'Singapore Parts Hub Pte', 'SG', 'Singapore', 28, 0.3],
  ];

  // Which suppliers serve which categories (indexes into SUPPLIERS)
  const CAT_SUPPLIERS = {
    FILT: [0, 9, 17], LUBE: [1], GET: [7, 3, 11], UCAR: [11, 16, 3], HYDR: [2, 12, 13, 9],
    ELEC: [6, 14, 17, 9], ENGN: [8, 15, 10, 9], TRNS: [13, 15, 10], BRNG: [4, 14], FAST: [5],
  };

  const CHANNELS = [
    { VTWEG: '10', name: 'Third-party distribution' },
    { VTWEG: '20', name: 'OEM' },
    { VTWEG: '30', name: 'Dealership & spare-parts trading' },
  ];

  function generate(opts) {
    opts = opts || {};
    const rnd = mulberry32(opts.seed || 20260921);
    const uni = (a, b) => a + (b - a) * rnd();
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const wpick = (w) => { let r = rnd() * w.reduce((s, x) => s + x, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; } return w.length - 1; };
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const logn = (mean, cv) => { const s2 = Math.log(1 + cv * cv); return mean * Math.exp(Math.sqrt(s2) * gauss() - s2 / 2); };
    const poisson = (l) => { if (l <= 0) return 0; if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
    const roundTo = (q, r) => (r > 1 ? Math.ceil(q / r) * r : Math.ceil(q));

    const T = {
      T001W: PLANTS.map(p => ({ WERKS: p.WERKS, NAME1: p.NAME1, ORT01: p.ORT01 })),
      MARA: [], MAKT: [], MARC: [], MARD: [], MBEW: [],
      LFA1: [], KNA1: [],
      EKKO: [], EKPO: [], EKET: [], EKBE: [],
      VBAK: [], VBAP: [], LIPS: [],
      MATDOC: [],
    };

    SUPPLIERS.forEach((s, i) => T.LFA1.push({ LIFNR: String(200001 + i), NAME1: s[1], LAND1: s[2], ORT01: s[3], KTOKK: s[0] === 'IMP' ? 'ZIMP' : 'ZDOM' }));

    const customers = [];
    const custNames = ['Coastal Infra Projects', 'Vizag Port Logistics', 'NMDC Contractor Pool', 'Godavari Constructions', 'Eastern Ghats Mining', 'Simhadri Earthworks', 'Andhra Road Builders', 'Kakinada Quarry Works', 'Rushikonda Developers', 'Araku Aggregates', 'Srikakulam Hire Services', 'Bheemili Contractors', 'Steel Plant Services Co', 'AP State Highways Contractor', 'Vizianagaram Crushers', 'Northern Andhra Dealer Network'];
    custNames.forEach((n, i) => { customers.push(String(100001 + i)); T.KNA1.push({ KUNNR: String(100001 + i), NAME1: n, ORT01: 'Visakhapatnam', KTOKD: 'ZCUS' }); });

    // monthly seasonality for construction activity in coastal AP (monsoon dip Jul-Sep, peak Jan-Mar)
    // monthly profile for coastal AP: monsoon dip Jul-Sep, post-monsoon restocking surge Oct-Mar
    const SEAS = [0.2, 0.22, 0.18, 0.06, -0.02, -0.12, -0.3, -0.32, -0.26, 0.12, 0.16, 0.18];
    // share of the monsoon dip each material group feels (construction & mining wear parts feel it most)
    const SEAS_BY_CAT = { FILT: 0.28, LUBE: 0.32, GET: 0.35, UCAR: 0.3, HYDR: 0.25, ENGN: 0.18, ELEC: 0.12, TRNS: 0.18, BRNG: 0.22, FAST: 0.25 };

    let matSeq = 0, ebeln = 4500000000, vbeln = 10000000, vbelnDel = 80000000, mblnr = 4900000000;
    const docLines = []; // collected MATDOC rows

    CATS.forEach((cat, ci) => {
      for (let k = 0; k < cat.n; k++) {
        matSeq++;
        const MATNR = String(30000000 + ci * 10000 + k + 1);
        const part = pick(cat.parts);
        const model = pick(MODELS);
        const desc = `${part} ${model}`.slice(0, 40);
        const price = Math.round(Math.exp(uni(Math.log(cat.price[0]), Math.log(cat.price[1]))));
        // demand level is inversely related to price inside a category
        const priceRank = (Math.log(price) - Math.log(cat.price[0])) / (Math.log(cat.price[1]) - Math.log(cat.price[0]));
        const baseWeekly = Math.exp(Math.log(cat.rate[1]) - priceRank * (Math.log(cat.rate[1]) - Math.log(cat.rate[0])) + gauss() * 0.35);
        const pat = wpick(cat.pat); // 0 smooth,1 erratic,2 intermittent,3 lumpy
        const lifeR = rnd();
        const life = lifeR < 0.09 ? 'dying' : lifeR < 0.14 ? 'new' : lifeR < 0.22 ? 'growing' : lifeR < 0.3 ? 'declining' : 'stable';
        const dieDay = life === 'dying' ? Math.floor(uni(120, 420)) : 0;
        const bornDay = life === 'new' ? Math.floor(uni(150, 400)) : 0;
        const trendPerYear = life === 'growing' ? uni(0.3, 0.7) : life === 'declining' ? uni(-0.55, -0.3) : uni(-0.1, 0.12);
        const seasAmp = SEAS_BY_CAT[cat.MATKL] * uni(0.75, 1.2);
        const bulkDays = rnd() < 0.06 ? [Math.floor(uni(30, 700))] : [];
        const chW = ci === 1 || ci === 9 ? [0.3, 0.2, 0.5] : ci === 3 || ci === 7 ? [0.15, 0.5, 0.35] : [0.2, 0.35, 0.45];
        const sups = CAT_SUPPLIERS[cat.MATKL];
        const supIdx = pick(sups);
        const sup = SUPPLIERS[supIdx];
        const matLtMean = sup[4] * uni(0.85, 1.25);
        const matLtCv = Math.min(0.6, sup[5] * uni(0.7, 1.4));
        const onlyOne = rnd() < 0.14 ? (rnd() < 0.7 ? 0 : 1) : -1;

        const superseded = life === 'dying' && rnd() < 0.5;
        T.MARA.push({ MATNR, MTART: 'HAWA', MATKL: cat.MATKL, MEINS: cat.meins, MSTAE: superseded ? 'Z1' : '', MSTDE: superseded ? dats(Math.min(DAYS - 1, dieDay + 30)) : '', ERSDA: life === 'new' ? dats(Math.max(0, bornDay - 30)) : '20190401', BRGEW: '', MFRPN: `${part.split(' ')[0].slice(0, 3).toUpperCase()}-${Math.floor(uni(1000, 9999))}` });
        T.MAKT.push({ MATNR, SPRAS: 'E', MAKTX: desc });

        let totalStock = 0, totalValue = 0;

        PLANTS.forEach((pl, pi) => {
          if (onlyOne >= 0 && onlyOne !== pi) return;
          const share = onlyOne >= 0 ? 1 : pl.share * uni(0.8, 1.2);
          const mu = baseWeekly * share; // units / week at history start
          // order frequency & size by pattern
          let freq, sizeCv;
          if (pat === 0) { freq = Math.max(1.5, Math.min(14, mu / uni(0.8, 2.5))); sizeCv = uni(0.25, 0.6); }
          else if (pat === 1) { freq = Math.max(1.2, Math.min(6, mu / uni(2, 6))); sizeCv = uni(0.8, 1.3); }
          else if (pat === 2) { freq = uni(0.15, 0.7); sizeCv = uni(0.2, 0.5); }
          else { freq = uni(0.15, 0.6); sizeCv = uni(0.7, 1.2); }
          freq = Math.min(freq, mu / 1.3); // sizes are whole units
          const meanSize = Math.max(1, mu / freq);

          // ---- current SAP MRP settings (set by planners years ago; rules of thumb) ----
          const quoted = matLtMean * (rnd() < 0.45 ? uni(0.45, 0.75) : uni(0.85, 1.1));
          const PLIFZ = Math.max(2, Math.round(quoted));
          // planners set safety stock as "N weeks of cover" per category, without variability
          const cover = { FILT: 2, LUBE: 2, GET: 3, UCAR: 4, HYDR: 3, ELEC: 3, ENGN: 3, TRNS: 4, BRNG: 2, FAST: 3 }[cat.MATKL];
          const planner = rnd();
          let eisbeWeeks = cover * (planner < 0.3 ? uni(0.3, 0.7) : planner < 0.6 ? uni(0.8, 1.3) : uni(1.5, 3.0));
          if (rnd() < 0.07) eisbeWeeks = 0;
          const oldMu = mu * (life === 'dying' || life === 'declining' ? uni(1.0, 1.4) : life === 'new' ? 0.6 : 1);
          let EISBE = Math.round(oldMu * eisbeWeeks);
          if (EISBE < 1 && eisbeWeeks > 0 && oldMu > 0.1) EISBE = 1;
          const BSTRF = cat.meins === 'L' ? 20 : cat.MATKL === 'FAST' ? 50 : mu > 20 ? 10 : mu > 6 ? 5 : 1;
          const BSTMI = BSTRF > 1 ? BSTRF : 1;
          const MINBE = Math.round(EISBE + (oldMu / 7) * PLIFZ);
          const coverMax = uni(4, 10);
          const MABST = Math.max(MINBE + BSTMI, Math.round(MINBE + oldMu * coverMax));
          const LGORT = pi === 0 ? '1101' : '1201';

          T.MARC.push({ MATNR, WERKS: pl.WERKS, DISMM: 'VB', DISPO: pi === 0 ? 'P01' : 'P02', EKGRP: ci < 5 ? 'G10' : 'G20', PLIFZ, WEBAZ: 1, EISBE, MINBE, DISLS: 'HB', MABST, BSTMI, BSTRF, MAABC: '', LGRAD: '' });

          // ---- day-by-day simulation of history under SAP settings ----
          let stock = life === 'new' ? 0 : Math.round(MINBE + (MABST - MINBE) * uni(0.2, 0.8));
          const openPOs = []; // {due, qty, ebeln, ebelp}
          const lt = () => Math.max(2, Math.round(logn(matLtMean, matLtCv)));
          for (let d = 0; d < DAYS; d++) {
            // goods receipts
            for (let i = openPOs.length - 1; i >= 0; i--) {
              const po = openPOs[i];
              if (po.gr === d) {
                stock += po.qty;
                const m = String(mblnr++);
                T.EKBE.push({ EBELN: po.EBELN, EBELP: po.EBELP, VGABE: '1', BWART: '101', BUDAT: dats(d), MENGE: po.qty, BELNR: m });
                po.eket.WEMNG = po.qty; po.ekpo.ELIKZ = 'X';
                docLines.push({ MBLNR: m, ZEILE: 1, BWART: '101', MATNR, WERKS: pl.WERKS, LGORT, MENGE: po.qty, SHKZG: 'S', BUDAT: dats(d), LIFNR: po.LIFNR, EBELN: po.EBELN, KUNNR: '', VBELN_IM: '', DMBTR: Math.round(po.qty * price) });
                openPOs.splice(i, 1);
              }
            }
            // demand
            const t = d / 364;
            const month = new Date(HISTORY_START + d * DAY_MS).getUTCMonth();
            let level = Math.max(0, 1 + trendPerYear * t) * (1 + seasAmp * SEAS[month] / 0.32);
            if (life === 'dying' && d > dieDay) level *= 0.02;
            if (life === 'new' && d < bornDay) level = 0;
            const n = poisson((freq / 7) * level);
            const lines = [];
            for (let j = 0; j < n; j++) lines.push(Math.max(1, Math.round(logn(meanSize, sizeCv))));
            if (bulkDays.includes(d) && level > 0.1) lines.push(Math.max(2, Math.round(mu * uni(6, 12))));
            for (const q of lines) {
              const ch = CHANNELS[wpick(chW)];
              const kunnr = customers[Math.floor(rnd() * customers.length)];
              const so = String(vbeln++);
              const deliv = Math.min(stock, q);
              T.VBAK.push({ VBELN: so, AUART: 'ZOR', VKORG: '1000', VTWEG: ch.VTWEG, KUNNR: kunnr, ERDAT: dats(d) });
              T.VBAP.push({ VBELN: so, POSNR: 10, MATNR, WERKS: pl.WERKS, KWMENG: q, VRKME: cat.meins, NETWR: Math.round(q * price * 1.18), ABGRU: deliv < q ? (deliv === 0 ? 'Z1' : 'Z2') : '' });
              if (deliv > 0) {
                const dl = String(vbelnDel++);
                const m = String(mblnr++);
                T.LIPS.push({ VBELN: dl, POSNR: 10, VGBEL: so, VGPOS: 10, MATNR, WERKS: pl.WERKS, LGMNG: deliv });
                docLines.push({ MBLNR: m, ZEILE: 1, BWART: '601', MATNR, WERKS: pl.WERKS, LGORT, MENGE: deliv, SHKZG: 'H', BUDAT: dats(d), LIFNR: '', EBELN: '', KUNNR: kunnr, VBELN_IM: dl, DMBTR: Math.round(deliv * price) });
                stock -= deliv;
              }
            }
            // MRP run (reorder point planning, replenish up to max stock)
            if (life === 'new' && d < bornDay - 20) continue;
            const avail = stock + openPOs.reduce((s, p) => s + p.qty, 0);
            const rop = life === 'new' && d < bornDay + 60 ? Math.max(1, MINBE) : MINBE;
            if (avail <= rop && (rop > 0 || avail < 0 || (MABST > 0 && avail <= 0))) {
              const qty = Math.max(BSTMI, roundTo(MABST - avail, BSTRF));
              if (qty > 0) {
                const E = String(ebeln++);
                const L = lt();
                const lifnr = String(200001 + supIdx);
                T.EKKO.push({ EBELN: E, BSART: sup[0] === 'IMP' ? 'ZIMP' : 'NB', LIFNR: lifnr, BEDAT: dats(d), EKORG: '1000', EKGRP: ci < 5 ? 'G10' : 'G20' });
                const ekpo = { EBELN: E, EBELP: 10, MATNR, WERKS: pl.WERKS, LGORT, MENGE: qty, MEINS: cat.meins, NETPR: Math.round(price * uni(0.97, 1.03)), PEINH: 1, ELIKZ: '' };
                const eket = { EBELN: E, EBELP: 10, ETENR: 1, EINDT: dats(d + PLIFZ), MENGE: qty, WEMNG: 0 };
                T.EKPO.push(ekpo); T.EKET.push(eket);
                openPOs.push({ EBELN: E, EBELP: 10, qty, gr: d + L, LIFNR: lifnr, ekpo, eket });
              }
            }
          }

          T.MARD.push({ MATNR, WERKS: pl.WERKS, LGORT, LABST: stock, INSME: 0, SPEME: 0 });
          totalStock += stock; totalValue += stock * price;
          T.MBEW.push({ MATNR, BWKEY: pl.WERKS, BWTAR: '', VPRSV: 'V', VERPR: price, STPRS: 0, PEINH: 1, LBKUM: stock, SALK3: Math.round(stock * price) });
        });
      }
    });

    docLines.sort((a, b) => (a.BUDAT < b.BUDAT ? -1 : a.BUDAT > b.BUDAT ? 1 : 0));
    T.MATDOC = docLines.map(r => Object.assign({ MJAHR: r.BUDAT.slice(0, 4) }, r));
    return T;
  }

  // Table / field dictionary used both by the UI and the data-requirements doc
  const DICTIONARY = [
    { table: 'MARA', desc: 'General material data', fields: 'MATNR, MTART, MATKL, MEINS, ERSDA, MFRPN, MSTAE, MSTDE', use: 'Material master, category, unit, OEM part no.; cross-plant status flags superseded / obsolete parts' },
    { table: 'MAKT', desc: 'Material descriptions', fields: 'MATNR, SPRAS, MAKTX', use: 'Readable descriptions' },
    { table: 'MARM', desc: 'Alternative units of measure', fields: 'MATNR, MEINH, UMREZ, UMREN', use: 'Unit conversion to base unit' },
    { table: 'MARC', desc: 'Plant data for material (MRP views)', fields: 'MATNR, WERKS, DISMM, DISPO, EKGRP, PLIFZ, WEBAZ, EISBE, MINBE, DISLS, MABST, BSTMI, BSTRF, MAABC, LGRAD, SHZET, BSTMA, MMSTA', use: 'Current SAP policy: safety stock, reorder point, lot size, planned delivery time (baseline to beat)' },
    { table: 'MARD', desc: 'Storage-location stock', fields: 'MATNR, WERKS, LGORT, LABST, INSME, SPEME', use: 'Stock on hand by location' },
    { table: 'MBEW', desc: 'Material valuation', fields: 'MATNR, BWKEY, VPRSV, VERPR, STPRS, PEINH, LBKUM, SALK3', use: 'Unit cost and stock value (working capital)' },
    { table: 'MATDOC', desc: 'Material documents (S/4HANA; MSEG/MKPF compatible)', fields: 'MBLNR, MJAHR, ZEILE, BWART, MATNR, WERKS, LGORT, MENGE, SHKZG, BUDAT, LIFNR, EBELN, KUNNR, VBELN_IM, VBELP_IM, KDAUF, KDPOS, DMBTR, SMBLN, SJAHR, SMBLP', use: 'Trading demand = 601 net of 602; customer returns 651/653 treated separately; receipts 101 net of 102; transfers 301/311/641/643 kept apart (demand only at the supplying location); 261/201 excluded (production/internal use, not trading demand)' },
    { table: 'EKKO', desc: 'Purchasing document header', fields: 'EBELN, BSART, LIFNR, BEDAT, EKORG, EKGRP, RESWK', use: 'PO date and supplier; Separate supplier POs from stock-transfer orders (BSART UB / PSTYP 7); exclude deleted lines' },
    { table: 'EKPO', desc: 'Purchasing document item', fields: 'EBELN, EBELP, MATNR, WERKS, LGORT, MENGE, MEINS, NETPR, PEINH, ELIKZ, LOEKZ, PSTYP', use: 'Ordered quantity, open POs, price; Separate supplier POs from stock-transfer orders (BSART UB / PSTYP 7); exclude deleted lines' },
    { table: 'EKET', desc: 'PO schedule lines', fields: 'EBELN, EBELP, ETENR, EINDT, MENGE, WEMNG', use: 'Promised delivery date (supplier reliability)' },
    { table: 'EKBE', desc: 'PO history', fields: 'EBELN, EBELP, VGABE, BWART, BUDAT, MENGE, SHKZG, BELNR', use: 'Actual goods-receipt date: actual lead time = EKBE-BUDAT - EKKO-BEDAT; Filter VGABE = 1; net 102 reversals; lead time = first GR date − EKKO-BEDAT (calendar days)' },
    { table: 'VBAK', desc: 'Sales document header', fields: 'VBELN, AUART, VKORG, VTWEG, KUNNR, ERDAT', use: 'Order date and channel (3P / OEM / dealership)' },
    { table: 'VBAP', desc: 'Sales document item', fields: 'VBELN, POSNR, MATNR, WERKS, PSTYV, KWMENG, VRKME, UMVKZ, UMVKN, MEINS, NETWR, ABGRU', use: 'True customer demand, including what could not be supplied; Exclude third-party items (TAS) and free-of-charge/text items; convert to base unit' },
    { table: 'VBEP', desc: 'Sales schedule lines (optional)', fields: 'VBELN, POSNR, ETENR, EDATU, WMENG, BMENG', use: 'Requested vs confirmed quantity and date: service level against what the customer asked for' },
    { table: 'LIKP', desc: 'Delivery header', fields: 'VBELN, LFART, WADAT_IST', use: 'Actual goods-issue date; demand-fulfilment timing' },
    { table: 'LIPS', desc: 'Delivery item', fields: 'VBELN, POSNR, VGBEL, VGPOS, MATNR, WERKS, LGMNG', use: 'Delivered quantity: fill rate and stockout incidents' },
    { table: 'EINA', desc: 'Purchasing info record – general', fields: 'INFNR, MATNR, LIFNR', use: 'Links info record to material and supplier' },
    { table: 'EINE', desc: 'Purchasing info record (optional)', fields: 'INFNR, EKORG, ESOKZ, WERKS, APLFZ, NETPR, PEINH', use: 'Vendor-specific planned delivery time, a second baseline besides MARC-PLIFZ' },
    { table: 'LFA1', desc: 'Supplier master', fields: 'LIFNR, NAME1, LAND1, ORT01, KTOKK', use: 'Supplier name and origin (domestic / import)' },
    { table: 'KNA1', desc: 'Customer master', fields: 'KUNNR, NAME1, ORT01, KTOKD', use: 'Customer segmentation' },
    { table: 'T001W', desc: 'Plants', fields: 'WERKS, NAME1, ORT01', use: 'Branch / warehouse names' },
  ];

  const api = { generate, DICTIONARY, HISTORY_START, DAYS, dats, CHANNELS };
  root.DZ = root.DZ || {};
  root.DZ.sap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
