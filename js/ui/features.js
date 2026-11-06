/* ui/features.js — Automatic feature detection, separate pieces of a region, impact of "Export to the INP", alignment suggestions
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Automatic feature detection (experimental) ---------- */
const FEAT = { stl: null, params: null, res: null, sel: null, done: new Set(), armed: false, seeds: [], g: null, topo: null };
const FEAT_UI = [
  ['Planes', 'planes', [['minArea', 'Min. patch area (cm²)'], ['angTol', 'Normal tolerance (°)'], ['distTol', 'Distance tolerance (cm)']]],
  ['Cylinders', 'cylinders', [['curvMinArea', 'Min. patch area (cm²)'], ['fitTol', 'Fit tolerance (cm)'], ['minRadius', 'Min. radius (cm)'], ['maxRadius', 'Max. radius (cm, 0 = ∞)'], ['minHeight', 'Min. length (cm)'], ['minArc', 'Min. angular coverage (°)'], ['smoothAngle', 'Smooth-surface angle (°)'], ['minTris', 'Min. triangles']]],
  ['Spheres', 'spheres', [['fitTol', 'Fit tolerance (cm)'], ['minRadius', 'Min. radius (cm)']]],
  ['Boxes', 'boxes', [['boxFill', 'Min. fill ratio (volume / box)'], ['boxAligned', 'Min. aligned surface fraction']]],
  ['General', null, [['snapDeg', 'Snap to global axes (°)'], ['maxPerType', 'Max. features per type']]]
];
function featParamsHTML() {
  const P = FEAT.params, seen = new Set();
  return FEAT_UI.map(([title, flag, rows]) => `<details class="fold" ${flag === 'planes' || flag === 'cylinders' ? 'open' : ''}><summary>${title}${flag ? ` <label class="chk" style="margin:0 0 0 8px;display:inline-flex"><input type="checkbox" data-fp="${flag}" ${P[flag] ? 'checked' : ''}> on</label>` : ''}</summary><div class="fgrid">` +
    rows.map(([k, l]) => `<label>${l}</label><input type="number" step="any" data-fp="${k}" value="${P[k]}">`).join('') + '</div></details>').join('');
}
function featListHTML() {
  const r = FEAT.res; if (!r) return '';
  if (!r.features.length) return '<div class="muted">No feature found with these parameters. Lower the area / fit tolerances or the minimum coverage.</div>';
  const ic = { box: '▣', cylinder: '◍', sphere: '●', plane: '▱' };
  return r.features.map(f => `<div class="fr${FEAT.sel === f.id ? ' sel' : ''}${FEAT.done.has(f.id) ? ' done' : ''}" data-fid="${f.id}"><span>${ic[f.kind]}</span><span class="lb">${esc(f.label)}<small>${f.type} ${esc(f.p.map(x => +(+x).toFixed(4)).join(' '))}${f.cs ? ' (own frame)' : ''}</small></span>${FEAT.done.has(f.id) ? '<span>✓ added</span>' : `<button class="pill" data-fadd="${f.id}">Add</button>`}</div>`).join('');
}
function featSelect(id) {
  FEAT.sel = id; const f = FEAT.res && FEAT.res.features.find(x => x.id === id);
  APP.setFeaturePreview(f || null, FEAT.stl && FEAT.stl.positions);
  $('#featList').innerHTML = featListHTML();
}
/* guided fit: the user clicks triangles, a primitive is fitted to them */
function guidedKind() { return $('#gKind').value; }
function guidedRefit() {
  const box = $('#gResult'), info = $('#gInfo');
  FEAT.g = null;
  if (!FEAT.seeds.length) { box.innerHTML = ''; info.textContent = FEAT.armed ? 'Click triangles on the mesh (click a selected one again to remove it).' : ''; APP.setFeaturePreview(null); return; }
  if (!FEAT.topo) FEAT.topo = FK.buildTopology(FEAT.stl.positions);
  const r = FK.fitFromSeeds(FEAT.stl.positions, FEAT.seeds, guidedKind(), FEAT.params, FEAT.topo);
  info.textContent = FEAT.seeds.length + ' triangle(s) selected';
  if (r.error) { box.innerHTML = `<div class="er">${esc(r.error)}</div>`; APP.setFeaturePreview(null, FEAT.stl.positions, FEAT.seeds); return; }
  r.feature.box = FEAT.stl.stats.bbox; FEAT.g = r;
  const c = r.confidence, rp = r.report;
  box.innerHTML = `<div class="fr"><span class="lb">${esc(r.feature.label)}<small>${r.feature.type} ${esc(r.feature.p.map(x => +(+x).toFixed(4)).join(' '))}</small><small>${rp.seedsFitted}/${rp.seeds} clicked triangles fit · patch ${rp.patchTris} triangles · rms ${(+rp.rms).toPrecision(2)} cm${r.feature.kind === 'cylinder' ? ' · coverage ' + rp.coverage.toFixed(0) + '°' : ''}</small></span><span class="cf ${c >= 75 ? 'hi' : c < 45 ? 'lo' : ''}">${c}%</span><button type="button" class="pill" id="gAdd">Add</button></div>`;
  APP.setFeaturePreview(r.feature, FEAT.stl.positions, FEAT.seeds);
}
function guidedToggle(tri) {
  const i = FEAT.seeds.indexOf(tri);
  if (i >= 0) FEAT.seeds.splice(i, 1); else FEAT.seeds.push(tri);
  guidedRefit();
}
function guidedArm(on) {
  FEAT.armed = on; $('#gPick').classList.toggle('on', on); document.body.classList.toggle('featpick', on);
  $('#gPick').textContent = on ? 'Picking… (click to stop)' : 'Pick triangles';
  if (on) { setTool('select'); S.info = false; syncToolbar(); }
  guidedRefit();
}
function openFeatDlg(stl) {
  if (!stl.positions || !stl.positions.length) { toast('This mesh has no triangles'); return; }
  FEAT.seeds = []; FEAT.g = null; FEAT.topo = null; FEAT.armed = false; $('#gPick').classList.remove('on'); $('#gPick').textContent = 'Pick triangles'; document.body.classList.remove('featpick'); $('#gResult').innerHTML = ''; $('#gInfo').textContent = '';
  FEAT.stl = stl; FEAT.params = FK.detectDefaults(stl.positions); FEAT.res = null; FEAT.sel = null; FEAT.done = new Set();
  $('#featSrc').textContent = `Mesh "${stl.name}" · ${stl.stats.count} triangles · lengths in cm`;
  $('#featParams').innerHTML = featParamsHTML(); $('#featList').innerHTML = ''; $('#featMsg').textContent = '';
  APP.setFeaturePreview(null);
  const d = $('#dlgFeat'); if (!d.open) d.show();
  featPlace();
}
/* ---------- Separate pieces of the selected region: one colour each + red spot at the closest points ---------- */
const PIECE_PAL = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5c8', '#d6208f', '#8aa800'];
let pieceKey = '';
function updatePieces(force) {
  const it = S.sel && S.sel.t === 'region' ? APP.getRegion(S.sel.id) : null;
  const c = it && !it.noExport ? APP.regionCache.get(it.id) : null;
  const q = c && c.quality ? c.quality.find(x => x.kind === 'gap' || x.kind === 'pieces') : null;
  if (!it || !q || !c.polys || !c.polys.length || S.opt.pieceHl === false) { if (pieceKey) { APP.setPieceOverlay(null); pieceKey = ''; } return; }
  const key = it.id + '|' + it.expr + '|' + c.polys.length + '|' + (S.opt.res || 1);
  if (key === pieceKey && !force) return;
  pieceKey = key;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const pl of c.polys) for (const v of pl.v) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
  const pcs = FK.regionPieces(c.polys, FK.boxDiag({ min: mn, max: mx }));
  APP.setPieceOverlay(pcs.map((p, i) => ({ polys: p.polys, color: PIECE_PAL[i % PIECE_PAL.length] })), q.spot || null);
}
/* ---------- Impact of "Export to the INP" being switched off ---------- */
function askImpact(kind, it, imp) {
  const d = $('#dlgImpact');
  $('#impTitle').textContent = `"${it.name}" is used elsewhere`;
  $('#impText').textContent = kind === 'body' ? 'These regions use this body, directly or through a live link; they would reference something that is not in the INP:' : 'These regions follow this region through a live link:';
  $('#impList').innerHTML = imp.map(x => `<li style="margin-left:${(x.depth - 1) * 16}px">${x.depth > 1 ? '↳ ' : ''}<b>${esc(x.item.name)}</b> <span class="muted">(${x.depth === 1 && kind === 'body' ? 'uses ' + esc(x.via) : 'follows ' + esc(x.via)})</span></li>`).join('');
  $('#impAll').textContent = `Exclude all of them (${imp.length + 1})`;
  return new Promise(res => { d.returnValue = ''; d.addEventListener('close', () => res(d.returnValue || 'cancel'), { once: true }); d.showModal(); });
}
/* ---------- Alignment suggestions for a new body ---------- */
const SNAP = { id: 0, orig: null, off: new Set() };
function snapOthers(b) { return S.model.bodies.filter(x => x.id !== b.id && x.type !== 'RAW').map(x => Object.assign({}, APP.wbody(x), { name: x.name })).filter(x => x.p); }
/** noAxisPlane: XYP / XZP / YZP only when the body's frame has the same axes as the frame the INP is written in (otherwise they would not be axis planes in the file). */
function snapOpts(b) { return { tol: (S.opt.snapTol === undefined ? 0.2 : S.opt.snapTol) / 10, ang: S.opt.snapAng === undefined ? 0.5 : S.opt.snapAng, noAxisPlane: !!b && !FK.M.isTranslation(APP.relM(b), 1e-9) }; }
function snapHide() { const c = $('#snapCard'); c.hidden = true; c.innerHTML = ''; SNAP.id = 0; }
function snapRender() {
  const b = APP.getBody(SNAP.id), c = $('#snapCard'); if (!b || !SNAP.orig) { snapHide(); return; }
  const res = FK.snapSuggest(SNAP.orig, snapOthers(b), snapOpts(b), new Set());
  if (!res) { snapHide(); return; }
  const o = snapOpts();
  c.innerHTML = `<div class="sn-h"><b>Alignment check — ${esc(b.name)}</b><button type="button" class="ib" data-sn="close" aria-label="Close">✕</button></div>
    <div class="sn-t muted">Tolerance <input type="number" data-sn="tol" step="0.05" min="0" value="${S.opt.snapTol === undefined ? 0.2 : S.opt.snapTol}"> mm · <input type="number" data-sn="ang" step="0.1" min="0" value="${o.ang}"> °</div>
    <ul>${res.changes.map(ch => `<li><label><input type="checkbox" data-sn-id="${ch.id}" ${SNAP.off.has(ch.id) ? '' : 'checked'}> ${esc(ch.text)}</label></li>`).join('')}</ul>
    <div class="sn-b"><button type="button" class="pill primary" data-sn="apply">Use corrected values</button><button type="button" class="pill" data-sn="close">Keep as is</button></div>`;
  c.hidden = false;
}
/** Proposes corrected values for body b (only when something is within the tolerances). Returns true when a proposal is shown. */
function suggestSnap(b, force) {
  if (!b || b.cs || b.type === 'RAW' || (!force && S.opt.snapOn === false)) return false;
  const res = FK.snapSuggest(b, snapOthers(b), snapOpts(b), new Set());
  if (!res) { if (force) toast('Nothing to align: no other object within the tolerances'); snapHide(); return false; }
  SNAP.id = b.id; SNAP.orig = { type: b.type, p: b.p.slice(), name: b.name }; SNAP.off = new Set();
  snapRender(); return true;
}
APP.hooks.suggestSnap = (b) => setTimeout(() => suggestSnap(b), 0);
(function () {
  const c = $('#snapCard'); if (!c) return;
  c.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.snId) { if (t.checked) SNAP.off.delete(t.dataset.snId); else SNAP.off.add(t.dataset.snId); return; }
    if (t.dataset.sn === 'tol' || t.dataset.sn === 'ang') { const v = parseFloat(t.value); if (!isFinite(v) || v < 0) return; S.opt[t.dataset.sn === 'tol' ? 'snapTol' : 'snapAng'] = v; APP.save(); const off = SNAP.off; snapRender(); SNAP.off = off; }
  });
  c.addEventListener('click', e => {
    const a = e.target.closest('[data-sn]'); if (!a) return;
    if (a.dataset.sn === 'close') snapHide();
    else if (a.dataset.sn === 'apply') {
      const b = APP.getBody(SNAP.id); if (!b) { snapHide(); return; }
      const res = FK.snapSuggest(SNAP.orig, snapOthers(b), snapOpts(b), SNAP.off);
      if (res) { APP.snap(); b.type = res.type; b.p = res.p; APP.changed({ tree: true, right: true }); toast(`${b.name}: corrected values applied (Ctrl+Z restores the previous ones)`); }
      snapHide();
    }
  });
})();
