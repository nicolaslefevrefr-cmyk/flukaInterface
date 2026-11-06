/* ui/compare.js — CAD <-> CG comparison window
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- CAD <-> CG comparison window ---------- */
const DEV = { last: null };
function devRegionCheck(preId) {
  const cad = +$('#devCad').value, box = $('#devRegs');
  const regs = S.model.regions.filter(r => r.expr && r.expr.trim());
  box.innerHTML = regs.length ? regs.map(r => `<label><input type="checkbox" data-r="${r.id}" ${(preId ? r.id === preId : !r.noExport) ? 'checked' : ''}> ${esc(r.name)}${r.noExport ? ' <small class="muted">(not exported)</small>' : ''}</label>`).join('') : '<span class="muted">No region</span>';
}
function openDevDlg(pre) {
  pre = pre || {};
  if (!S.stls.length) { toast('Import a CAD mesh first'); return; }
  const reg = pre.region ? S.model.regions.find(r => r.id === pre.region) : null;
  const cadId = pre.cad || (reg ? APP.cadId(reg, 'region') : 0) || (S.sel && S.sel.t === 'stl' ? S.sel.id : S.stls[0].id);
  $('#devCad').innerHTML = S.stls.map(m => `<option value="${m.id}" ${m.id === cadId ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  devRegionCheck(reg ? reg.id : 0);
  $('#devRes').innerHTML = ''; $('#devLeg').style.display = 'none';
  const d = $('#dlgDev'); if (!d.open) d.show();
  if (typeof d._x === 'number') { d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; } else { d.style.left = 'auto'; d.style.right = '12px'; d.style.top = '64px'; }
}
function devRun() {
  const cad = APP.getStl(+$('#devCad').value);
  const ids = Array.from($('#devRegs').querySelectorAll('input:checked')).map(x => +x.dataset.r);
  if (!cad || !cad.positions) { toast('Choose a CAD mesh'); return null; }
  if (!ids.length) { toast('Tick at least one region'); return null; }
  const regs = ids.map(id => S.model.regions.find(r => r.id === id)).filter(Boolean);
  let expr = regs[0].expr;
  try { for (let i = 1; i < regs.length; i++) expr = FK.combineExpr(expr, regs[i].expr, 'union', 'compact'); } catch (e) { toast(e.message); return null; }
  const ev = APP.evalRegionNow({ expr });
  if (ev.error || !ev.polys || !ev.polys.length) { toast('Region has no surface: ' + (ev.error || 'empty')); return null; }
  const rpos = FK.polysToPositions(ev.polys);
  const res = FK.compareSurfaces(rpos, cad.positions, { target: 60000 });
  const on = $('#devOn').value, signed = $('#devSigned').checked, side = on === 'cad' && res.cad ? res.cad : res.region;
  const userMax = parseFloat($('#devMax').value), auto = Math.max(res.stats.toCad.p95, res.stats.toRegion.p95, 1e-6);
  const max = userMax > 0 ? userMax / 10 : auto;
  const col = new Float32Array(side.d.length * 3);
  for (let i = 0; i < side.d.length; i++) { const c = FK.devColor(signed ? side.s[i] * side.d[i] : side.d[i], max, signed); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  APP.setDeviationOverlay({ points: side.points, tri: side.tri, colors: col });
  const vc = Math.abs(cad.stats.volume), vr = ev.vol, mm = v => (v * 10).toFixed(3);
  const row = (n, s) => `<tr><td>${n}</td><td>${mm(s.mean)}</td><td>${mm(s.rms)}</td><td>${mm(s.p95)}</td><td>${mm(s.max)}</td><td>${(s.bias >= 0 ? '+' : '') + mm(s.bias)}</td></tr>`;
  $('#devRes').innerHTML = `<table><tr><th>mm</th><th>mean</th><th>rms</th><th>p95</th><th>max</th><th>bias</th></tr>${row('CG → CAD', res.stats.toCad)}${row('CAD → CG', res.stats.toRegion)}</table>
    <div>Hausdorff: <b>${mm(res.stats.hausdorff)} mm</b></div>
    <div>Volume CAD: <b>${vc.toFixed(3)} cm³</b> · CG: <b>${vr.toFixed(3)} cm³</b> · Δ = ${(vr - vc >= 0 ? '+' : '') + (vr - vc).toFixed(3)} cm³ (${vc ? ((vr - vc) / vc * 100).toFixed(2) : '–'} %)</div>
    <div class="muted">Bias &gt; 0: CG has more material than the CAD. Planes cutting through the CAD (boolean cuts not in the mesh) appear as deviations.</div>`;
  const lg = $('#devLeg'); lg.style.display = 'block';
  lg.style.background = signed ? 'linear-gradient(90deg,#1a4de6,#dbe0e6,#dc1f1a)' : 'linear-gradient(90deg,#1aa64d,#fad91a,#dc1a1a)';
  lg.title = (signed ? '−' : '0') + ' … ' + mm(max) + ' mm';
  $('#devRes').insertAdjacentHTML('beforeend', `<div class="muted">Scale: ${signed ? '±' : '0 … '}${mm(max)} mm</div>`);
  DEV.last = { res, vc, vr, max, ids };
  return DEV.last;
}
(function () {
  const d = $('#dlgDev'); if (!d) return;
  $('#devRun').onclick = () => { try { devRun(); } catch (e) { console.error(e); toast('Comparison failed: ' + e.message); } };
  $('#devClear').onclick = () => { APP.setDeviationOverlay(null); $('#devRes').innerHTML = ''; $('#devLeg').style.display = 'none'; };
  $('#devCad').onchange = () => devRegionCheck(0);
  d.addEventListener('close', () => APP.setDeviationOverlay(null));
  d.querySelector('[value=close]').onclick = () => d.close();
  let drag = null; const h = d.querySelector('.fw-h');
  h.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = d.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { h.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  h.addEventListener('pointermove', e => { if (!drag) return; d._x = Math.max(0, e.clientX - drag.dx); d._y = Math.max(0, e.clientY - drag.dy); d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; });
  h.addEventListener('pointerup', () => { drag = null; });
})();
/* Floating / docked placement of the feature window. Position is kept in S.opt.featWin = {x, y, docked}. */
function featPlace() {
  const d = $('#dlgFeat'); if (!d) return;
  const w = S.opt.featWin || (S.opt.featWin = { docked: false });
  $('#featDock').classList.toggle('on', !!w.docked);
  d.classList.toggle('docked', !!w.docked);
  const vw = window.innerWidth || 1000, vh = window.innerHeight || 800;
  if (w.docked) {
    const dl = $('#drawerLeft'), r = dl.getBoundingClientRect(), main = $('#viewport').getBoundingClientRect();
    const x = (r.width > 20 ? r.right : (main.left || 0)) + 8;
    d.style.left = Math.max(0, Math.round(x)) + 'px'; d.style.top = Math.round((main.top || 56) + 50) + 'px';
  } else if (typeof w.x === 'number') {
    d.style.left = Math.min(Math.max(0, w.x), Math.max(0, vw - 80)) + 'px'; d.style.top = Math.min(Math.max(0, w.y), Math.max(0, vh - 40)) + 'px';
  } else { d.style.left = ''; d.style.top = ''; }
}
(function () {
  const d = $('#dlgFeat'); if (!d) return;
  $('#featDock').onclick = () => { const w = S.opt.featWin || (S.opt.featWin = {}); w.docked = !w.docked; featPlace(); APP.save(); };
  window.addEventListener('resize', () => { if (d.open) featPlace(); });
  if (window.ResizeObserver) new ResizeObserver(() => { if (d.open && (S.opt.featWin || {}).docked) featPlace(); }).observe($('#drawerLeft'));
  { // drag the window by its header (undocks it)
    let drag = null;
    d.querySelector('.fw-h').addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = d.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    d.querySelector('.fw-h').addEventListener('pointermove', e => {
      if (!drag) return;
      const w = S.opt.featWin || (S.opt.featWin = {}); w.docked = false;
      w.x = Math.round(Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - 80)); w.y = Math.round(Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 40));
      featPlace();
    });
    const end = () => { if (drag) { drag = null; APP.save(); } };
    d.querySelector('.fw-h').addEventListener('pointerup', end); d.querySelector('.fw-h').addEventListener('pointercancel', end);
  }
  d.addEventListener('close', () => { FEAT.armed = false; FEAT.seeds = []; FEAT.g = null; document.body.classList.remove('featpick'); APP.setFeaturePreview(null); });
  $('#gPick').onclick = () => guidedArm(!FEAT.armed);
  $('#gClear').onclick = () => { FEAT.seeds = []; guidedRefit(); };
  $('#gKind').onchange = () => guidedRefit();
  $('#gResult').addEventListener('click', e => {
    if (!e.target.closest('#gAdd') || !FEAT.g) return;
    const b = APP.addFeature(FEAT.g.feature, FEAT.stl.id); toast(`${b.name} (${b.type}) added to the model`);
    FEAT.seeds = []; FEAT.g = null; $('#gResult').innerHTML = ''; $('#gInfo').textContent = 'Added. Pick the next surface.'; APP.setFeaturePreview(null);
  });
  d.addEventListener('change', e => { const k = e.target.dataset.fp; if (!k) return; FEAT.params[k] = e.target.type === 'checkbox' ? e.target.checked : (+e.target.value); });
  $('#featReset').onclick = () => { FEAT.params = FK.detectDefaults(FEAT.stl.positions); $('#featParams').innerHTML = featParamsHTML(); };
  $('#featRun').onclick = () => {
    if (!FEAT.stl) return;
    $('#featMsg').textContent = 'Analysing…'; $('#featList').innerHTML = ''; APP.setFeaturePreview(null);
    setTimeout(() => {
      const t0 = Date.now();
      try {
        FEAT.res = FK.detectFeatures(FEAT.stl.positions, FEAT.params); FEAT.done = new Set(); FEAT.sel = null;
        for (const f of FEAT.res.features) f.box = FEAT.stl.stats.bbox;
        const c = FEAT.res.stats.counts;
        $('#featMsg').textContent = `${FEAT.res.features.length} found (${c.box} box, ${c.cylinder} cyl., ${c.sphere} sph., ${c.plane} planes) in ${Date.now() - t0} ms`;
      } catch (e) { console.error(e); $('#featMsg').textContent = 'Detection failed: ' + e.message; }
      $('#featList').innerHTML = featListHTML();
    }, 30);
  };
  $('#featList').addEventListener('click', e => {
    const add = e.target.closest('[data-fadd]');
    if (add) { const f = FEAT.res.features.find(x => x.id === +add.dataset.fadd); if (f && !FEAT.done.has(f.id)) { const b = APP.addFeature(f, FEAT.stl.id); FEAT.done.add(f.id); toast(`${b.name} (${b.type}) added to the model`); $('#featList').innerHTML = featListHTML(); } return; }
    const row = e.target.closest('.fr'); if (row) featSelect(+row.dataset.fid);
  });
  $('#featAddAll').onclick = () => {
    if (!FEAT.res) return; let k = 0;
    for (const f of FEAT.res.features) if (!FEAT.done.has(f.id)) { APP.addFeature(f, FEAT.stl.id); FEAT.done.add(f.id); k++; }
    toast(k + ' object(s) added'); $('#featList').innerHTML = featListHTML();
  };
})();
