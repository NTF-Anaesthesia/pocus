// Bedside calculator: builds each value's box and slider, keeps them in step, and redraws the results.
// The arithmetic is in formulas.js (window.POCUS_CALC). Values are remembered on this device only.
(() => {
  const C = window.POCUS_CALC, $ = s => document.querySelector(s), STORE = 'pocus-calc-v1';
  // key: [label, hint, unit, slider min, slider max, slider step, default]
  const FIELDS = {
    lvidd: ['LVIDd', 'end-diastole', 'cm', 2, 8, .05, 4.8],
    lvids: ['LVIDs', 'end-systole', 'cm', 1, 7, .05, 3.2],
    eda: ['EDA', 'end-diastolic area', 'cm²', 4, 50, .5, 20],
    esa: ['ESA', 'end-systolic area', 'cm²', 2, 45, .5, 11],
    edv: ['EDV', 'end-diastole', 'mL', 20, 400, 1, 120],
    esv: ['ESV', 'end-systole', 'mL', 5, 350, 1, 50],
    lvot: ['LVOT diameter', 'PLAX, mid-systole', 'cm', 1.4, 3, .05, 2],
    vti: ['LVOT VTI', 'A5C, PW Doppler', 'cm', 4, 40, .5, 20],
    hr: ['Heart rate', '', '/min', 30, 180, 1, 80],
    height: ['Height', '', 'cm', 120, 210, 1, 170],
    weight: ['Weight', '', 'kg', 30, 200, 1, 70],
    vti2: ['VTI after', 'same site, after the leg raise or fluid', 'cm', 4, 40, .5, 23],
    ivcmax: ['IVC maximum', '', 'cm', .3, 3.5, .05, 2],
    ivcmin: ['IVC minimum', '', 'cm', 0, 3.5, .05, 1.2],
  };
  const dp = step => step < .1 ? 2 : step < 1 ? 1 : 0;
  const fmt = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '—';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { saved = {}; }
  const values = {}, inputs = {};

  // One value: label, typed box with unit, slider underneath.
  document.querySelectorAll('.calc-fields').forEach(box => box.dataset.fields.split(' ').forEach(key => {
    const [label, hint, unit, min, max, step, def] = FIELDS[key];
    const v = Number.isFinite(saved.values?.[key]) ? saved.values[key] : def;
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<div class="field-row"><label for="f-${key}"><span class="field-label">${label}</span> <span class="field-hint" id="h-${key}">${hint}</span></label>`
      + `<span class="field-entry"><input id="f-${key}" type="number" inputmode="decimal" step="any" min="0" autocomplete="off"><span class="field-unit">${unit}</span></span></div>`
      + `<input class="field-range" type="range" min="${min}" max="${max}" step="${step}" aria-label="${label} slider" aria-describedby="h-${key}">`;
    box.append(field);
    const [num, range] = field.querySelectorAll('input');
    inputs[key] = { num, range, step, field };
    const set = (x, from) => {
      values[key] = x;
      if (from !== num) num.value = Number.isFinite(x) ? fmt(x, dp(step)) : '';
      if (from !== range && Number.isFinite(x)) range.value = Math.min(max, Math.max(min, x));
      field.classList.toggle('field-off-scale', Number.isFinite(x) && (x < min || x > max));
      update();
    };
    inputs[key].set = set;
    num.addEventListener('input', () => set(num.value.trim() === '' ? NaN : Number(num.value.replace(',', '.')), num));
    num.addEventListener('change', () => { if (Number.isFinite(values[key])) num.value = fmt(values[key], dp(step)); });
    range.addEventListener('input', () => set(Number(range.value), range));
    values[key] = v;
    num.value = fmt(v, dp(step));
    range.value = Math.min(max, Math.max(min, v));
  }));

  // Segmented choices (method, sex, breathing) and the apex select.
  const choice = name => document.querySelector(`input[name="${name}"]:checked`)?.value;
  for (const [name, val] of Object.entries(saved.choices || {})) {
    const r = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (r) r.checked = true;
  }
  if (saved.apex && C.APEX[saved.apex] != null) $('#apex').value = saved.apex;
  document.querySelectorAll('.seg input, #apex').forEach(el => el.addEventListener('change', update));
  document.querySelectorAll('details.calc-extra').forEach(d => {
    if (saved.open?.includes(d.id)) d.open = true;
    d.addEventListener('toggle', update);
  });

  // Tabs, with #lv, #flow, #ivc in the address.
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const show = (id, focus) => {
    tabs.forEach(t => {
      const on = t.getAttribute('aria-controls') === id;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    history.replaceState(null, '', '#' + id);
    save();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t.getAttribute('aria-controls')));
    t.addEventListener('keydown', e => {
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      show(tabs[(j + tabs.length) % tabs.length].getAttribute('aria-controls'), true);
    });
  });
  const ids = tabs.map(t => t.getAttribute('aria-controls'));
  const fromHash = () => { const h = location.hash.slice(1); if (ids.includes(h)) show(h); };
  window.addEventListener('hashchange', fromHash);

  $('#reset').addEventListener('click', () => {
    try { localStorage.removeItem(STORE); } catch {}
    for (const [key, f] of Object.entries(inputs)) f.set(FIELDS[key][6]);
    document.querySelectorAll('.seg').forEach(s => { s.querySelector('input').checked = true; });
    $('#apex').value = 'normal';
    document.querySelectorAll('details.calc-extra').forEach(d => { d.open = false; });
    update();
  });

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        values,
        choices: Object.fromEntries([...document.querySelectorAll('.seg')].map(s => [s.dataset.name, choice(s.dataset.name)])),
        apex: $('#apex').value,
        open: [...document.querySelectorAll('details.calc-extra[open]')].map(d => d.id),
      }));
    } catch {}
  }

  // tiles: [label, value, unit, note, highlight]
  const tiles = (el, list, error) => {
    el.innerHTML = error ? `<p class="calc-error">${error}</p>` : list.map(([label, value, unit, note, hi]) =>
      `<div class="tile${hi ? ' tile-hi' : ''}"><span class="tile-label">${label}</span><span class="tile-value">${value}<span class="tile-unit">${unit}</span></span>${note ? `<span class="tile-note">${note}</span>` : ''}</div>`).join('');
  };
  const notes = (el, list) => { el.innerHTML = list.filter(Boolean).map(n => `<p>${n}</p>`).join(''); };
  const bad = (...keys) => keys.find(k => !(values[k] > 0) && !(k === 'ivcmin' && values[k] === 0));

  function update() {
    if (!C) return;
    save();
    lv(); flow(); ivc();
  }

  function lv() {
    const method = choice('lvMethod'), sex = choice('sex'), apex = $('#apex').value, sexWord = sex === 'f' ? 'female' : 'male';
    document.querySelectorAll('#lv [data-method]').forEach(el => { el.hidden = !el.dataset.method.split(' ').includes(method); });
    const out = $('#lvOut'), n = $('#lvNotes'), cat = ef => C.efCategory(ef, sex);
    if (method === 'fs') {
      const miss = bad('lvidd', 'lvids');
      if (miss) return tiles(out, [], `Enter ${FIELDS[miss][0]}.`), notes(n, []);
      const d = values.lvidd, s = values.lvids, fs = C.fs(d, s);
      if (fs == null) return tiles(out, [], 'LVIDs must be smaller than LVIDd.'), notes(n, []);
      const t = C.teichEF(d, s), q = C.quinones(C.diameterSquaredChange(d, s), apex), [lo, hi] = C.lvidRange(sex);
      tiles(out, [
        ['FS', fmt(fs, 0), '%', fs >= 30 ? 'Normal (≥30%)' : fs < 20 ? 'Severely impaired (<20%)' : 'Reduced (20–29%)', true],
        ['EF, Teichholz', fmt(t.ef, 0), '%', cat(t.ef)],
        ['EF, Quinones', fmt(q, 0), '%', cat(q)],
      ]);
      notes(n, [
        d > hi ? `LVIDd ${fmt(d, 1)} cm is above the ${sexWord} normal range (${lo}–${hi} cm): dilated LV.`
          : d < lo ? `LVIDd ${fmt(d, 1)} cm is below the ${sexWord} normal range (${lo}–${hi} cm).`
          : `LVIDd is within the ${sexWord} normal range (${lo}–${hi} cm).`,
        `Teichholz volumes: EDV ${fmt(t.edv)} mL, ESV ${fmt(t.esv)} mL. Both EFs assume one basal line speaks for the whole LV; a regional abnormality makes them wrong. Treat as rough numbers.`,
      ]);
    } else if (method === 'fac') {
      const miss = bad('eda', 'esa');
      if (miss) return tiles(out, [], `Enter ${FIELDS[miss][0]}.`), notes(n, []);
      const fac = C.fac(values.eda, values.esa);
      if (fac == null) return tiles(out, [], 'ESA must be smaller than EDA.'), notes(n, []);
      const q = C.quinones(fac, apex);
      tiles(out, [
        ['FAC', fmt(fac, 0), '%', 'No verified LV cut-off', true],
        ['EF estimate', fmt(q, 0), '%', cat(q)],
      ]);
      notes(n, ['EF estimate = FAC + (100 − FAC) × apical term (Quinones). A single short-axis slice misses apical disease: set the apex from the apical views.']);
    } else {
      const miss = bad('edv', 'esv');
      if (miss) return tiles(out, [], `Enter ${FIELDS[miss][0]}.`), notes(n, []);
      const bi = choice('planes') !== 'a4c';
      $('#h-edv').textContent = bi ? 'end-diastole, biplane (A4C + A2C)' : 'end-diastole, A4C only';
      $('#h-esv').textContent = bi ? 'end-systole, biplane (A4C + A2C)' : 'end-systole, A4C only';
      const r = C.volumes(values.edv, values.esv);
      if (!r) return tiles(out, [], 'ESV must be smaller than EDV.'), notes(n, []);
      tiles(out, [
        [bi ? 'EF, biplane' : 'EF, A4C only', fmt(r.ef, 0), '%', cat(r.ef), true],
        ['Stroke volume', fmt(r.sv), 'mL', 'EDV − ESV'],
      ]);
      notes(n, [`Lang 2015, ${sexWord}: normal ${sex === 'f' ? '54–74' : '52–72'}%, mildly abnormal 41–${sex === 'f' ? 53 : 51}%, moderately abnormal 30–40%, severely abnormal <30%.`]);
      if (!bi) n.insertAdjacentHTML('afterbegin', '<p>Single-plane EF: anterior and inferior walls are not measured. Add A2C for a biplane EF if you can.</p>');
    }
  }

  function flow() {
    const out = $('#flowOut'), n = $('#flowNotes'), miss = bad('lvot', 'vti', 'hr');
    if (miss) return tiles(out, [], `Enter ${FIELDS[miss][0]}.`), notes(n, []);
    const r = C.flow(values.lvot, values.vti, values.hr), list = [
      ['LVOT area', fmt(r.area, 2), 'cm²'],
      ['Stroke volume', fmt(r.sv), 'mL', r.sv < 60 ? 'Below 60 mL' : r.sv > 100 ? 'Above 100 mL' : 'Typical 60–100 mL'],
      ['Cardiac output', fmt(r.co, 1), 'L/min', '', true],
    ];
    const bsa = $('#bsaBox').open ? C.bsa(values.height, values.weight) : null;
    if (bsa) list.push(['SV index', fmt(r.sv / bsa), 'mL/m²', `BSA ${fmt(bsa, 2)} m²`], ['Cardiac index', fmt(r.co / bsa, 1), 'L/min/m²', r.co / bsa < 2.5 ? 'Below 2.5' : r.co / bsa > 4 ? 'Above 4.0' : 'Typical 2.5–4.0']);
    const ch = $('#plrBox').open ? C.change(values.vti, values.vti2) : null;
    if (ch != null) list.push(['VTI change', (ch > 0 ? '+' : '') + fmt(ch, 0), '%', ch >= 12 ? 'Suggests fluid-responsive (≥12%)' : ch >= 10 ? 'Borderline (10–12%)' : 'Below 10%: unlikely responsive', true]);
    tiles(out, list);
    notes(n, [
      values.vti < 16 ? `VTI ${fmt(values.vti, 1)} cm is low (below 16 cm; commonly quoted normal 18–22 cm).` : values.vti > 22 ? `VTI ${fmt(values.vti, 1)} cm is above the commonly quoted 18–22 cm.` : `VTI ${fmt(values.vti, 1)} cm: within the commonly quoted 18–22 cm.`,
      `The diameter is squared: ±1 mm on ${fmt(values.lvot * 10)} mm changes SV by about ±${fmt(100 * (((values.lvot + .1) / values.lvot) ** 2 - 1))}%. For trends, follow VTI alone.`,
    ]);
  }

  function ivc() {
    const vent = choice('breathing') === 'vent', out = $('#ivcOut'), n = $('#ivcNotes');
    $('#h-ivcmax').textContent = vent ? 'inspiration (ventilator breath)' : 'expiration';
    $('#h-ivcmin').textContent = vent ? 'expiration' : 'inspiration or sniff';
    const miss = bad('ivcmax', 'ivcmin');
    if (miss) return tiles(out, [], `Enter ${FIELDS[miss][0]}.`), notes(n, []);
    const r = C.ivc(values.ivcmax, values.ivcmin);
    if (!r) return tiles(out, [], 'The minimum must not be larger than the maximum.'), notes(n, []);
    if (!vent) {
      const rap = C.rap(values.ivcmax, r.collapse);
      tiles(out, [
        ['Collapsibility', fmt(r.collapse, 0), '%', r.collapse >= 40 ? 'About 40% or more: probably responsive' : 'Below 40%', true],
        ['Estimated RAP', rap.value, 'mmHg', `Range ${rap.range} mmHg (ASE)`],
      ]);
      notes(n, [
        `IVC ${values.ivcmax <= 2.1 ? '≤' : '>'}2.1 cm, collapse ${r.collapse > 50 ? '>' : '≤'}50%. ASE uses the collapse with a sniff; quiet breathing collapses less.`,
        'In spontaneous breathing the IVC predicts fluid responsiveness only weakly: effort size varies breath to breath.',
      ]);
    } else {
      tiles(out, [
        ['Distensibility', r.distend == null ? '—' : fmt(r.distend, 0), '%', r.distend == null ? 'Minimum is 0' : r.distend > 18 ? 'Above 18% (Barbier)' : 'At or below 18% (Barbier)', r.distend > 18],
        ['Variability', fmt(r.variability, 0), '%', r.variability > 12 ? 'Above 12% (Feissel)' : 'At or below 12% (Feissel)', r.variability > 12],
      ]);
      notes(n, [
        'Valid only if: intubated, no respiratory effort, tidal volume >8 mL/kg predicted body weight, no raised abdominal pressure, no RV failure.',
        `Collapsibility (÷ max) here would be ${fmt(r.collapse, 0)}%: the same diameters with a different denominator, so do not mix thresholds.`,
      ]);
    }
  }

  // Keep the tabs just under the sticky site header.
  const head = document.querySelector('.ntf-header');
  const measure = () => document.documentElement.style.setProperty('--calc-head', (head ? head.getBoundingClientRect().height : 0) + 'px');
  measure();
  window.addEventListener('resize', measure);
  fromHash();
  update();
})();
