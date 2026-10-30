// Bedside calculator formulas. Pure functions, no DOM, so pocus/test/calculator.test.cjs can check them in Node.
// Lengths in cm, areas in cm², volumes in mL, velocities' integrals (VTI) in cm, rates in /min. Invalid input -> null.
(function (root) {
  const pos = (...v) => v.every(x => Number.isFinite(x) && x > 0);
  // Quinones 1981: apical contribution to long-axis shortening, by apical wall motion (%).
  const APEX = { normal: 15, hypokinetic: 5, akinetic: 0, dyskinetic: -5, aneurysm: -10 };
  const F = {
    APEX,
    // FS = (LVIDd − LVIDs) / LVIDd
    fs(d, s) { return pos(d, s) && s < d ? 100 * (d - s) / d : null; },
    // Teichholz volume 7d³ / (2.4 + d), d in cm -> mL
    teichVolume(d) { return pos(d) ? 7 * d ** 3 / (2.4 + d) : null; },
    teichEF(d, s) {
      if (!(pos(d, s) && s < d)) return null;
      const edv = F.teichVolume(d), esv = F.teichVolume(s);
      return { edv, esv, ef: 100 * (edv - esv) / edv };
    },
    // FAC = (EDA − ESA) / EDA
    fac(eda, esa) { return pos(eda, esa) && esa < eda ? 100 * (eda - esa) / eda : null; },
    // Quinones: EF = short-axis change + (100 − short-axis change) × apical K. The short-axis change is %ΔD² from
    // diameters; FAC is the same quantity traced as an area, so it is used the same way (an estimate).
    quinones(change, apex) {
      const k = APEX[apex];
      return Number.isFinite(change) && k != null ? change + (100 - change) * k / 100 : null;
    },
    diameterSquaredChange(d, s) { return pos(d, s) && s < d ? 100 * (d * d - s * s) / (d * d) : null; },
    // Simpson's (or any volumes): EF = (EDV − ESV) / EDV
    volumes(edv, esv) { return pos(edv, esv) && esv < edv ? { sv: edv - esv, ef: 100 * (edv - esv) / edv } : null; },
    // LVEF categories, ASE/EACVI 2015 (Lang). sex: 'm' or 'f'
    efCategory(ef, sex) {
      if (!Number.isFinite(ef)) return null;
      const low = sex === 'f' ? 54 : 52, high = sex === 'f' ? 74 : 72;
      if (ef > high) return 'Above the normal range';
      if (ef >= low) return 'Normal';
      if (ef >= 41) return 'Mildly abnormal';
      if (ef >= 30) return 'Moderately abnormal';
      return 'Severely abnormal';
    },
    // LVIDd normal range, ASE 2015 (cm)
    lvidRange(sex) { return sex === 'f' ? [3.8, 5.2] : [4.2, 5.8]; },
    // LVOT: area = π(d/2)², SV = area × VTI, CO = SV × HR
    flow(d, vti, hr) {
      if (!pos(d, vti, hr)) return null;
      const area = Math.PI * (d / 2) ** 2, sv = area * vti;
      return { area, sv, co: sv * hr / 1000 };
    },
    // Mosteller body surface area, height cm, weight kg -> m²
    bsa(h, w) { return pos(h, w) ? Math.sqrt(h * w / 3600) : null; },
    // Percentage change, e.g. VTI before and after a passive leg raise
    change(before, after) { return pos(before, after) ? 100 * (after - before) / before : null; },
    // IVC indices: collapsibility (÷ max), distensibility (÷ min, Barbier), variability (÷ mean, Feissel)
    // (a fully collapsed IVC, min 0, has a collapsibility of 100% and no distensibility)
    ivc(max, min) {
      if (!(pos(max) && Number.isFinite(min) && min >= 0 && min <= max)) return null;
      const delta = max - min;
      return { collapse: 100 * delta / max, distend: min > 0 ? 100 * delta / min : null, variability: 100 * delta / ((max + min) / 2) };
    },
    // Estimated RA pressure, spontaneous breathing (ASE 2010/2015): diameter ≤2.1 cm and collapse >50% -> 3;
    // >2.1 cm and collapse <50% -> 15; otherwise 8 (mmHg)
    rap(max, collapse) {
      if (!pos(max) || !Number.isFinite(collapse)) return null;
      if (max <= 2.1 && collapse > 50) return { value: 3, range: '0–5' };
      if (max > 2.1 && collapse < 50) return { value: 15, range: '10–20' };
      return { value: 8, range: '5–10' };
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = F; else root.POCUS_CALC = F;
})(this);
