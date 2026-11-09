/* ui/layout.js — Layout: drawers and INP sheet, project name, deferred updates, theme, toolbar, resizable panels, docked section / diagram panels
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Drawers and INP sheet ---------- */
const dL = $('#drawerLeft'), dR = $('#drawerRight'), sheet = $('#sheet');
const narrow = () => window.matchMedia('(max-width: 899px)').matches;
// the view toolbar wraps onto several rows when the viewport gets narrow: floating items (triad, tool window) sit below it
if (window.ResizeObserver) { const vt = document.getElementById('vtools'), vp = document.getElementById('viewport'); if (vt && vp) new ResizeObserver(() => vp.style.setProperty('--vth', Math.ceil(vt.getBoundingClientRect().height) + 'px')).observe(vt); }
// the project tree and the properties panel are always visible
function setDrawer() { dL.classList.add('open'); dR.classList.add('open'); }
$('#btnInp').onclick = () => { if (S.opt.sheetH) sheet.style.height = S.opt.sheetH + 'px'; sheet.classList.toggle('open'); updateInp(); };
$('#btnInpClose').onclick = () => sheet.classList.remove('open');
{ // resizable .inp panel: drag the grip on its top edge (height kept in the settings)
  const grip = $('#sheetGrip'); let drag = null;
  const maxH = () => Math.max(190, (sheet.parentElement.getBoundingClientRect().height || window.innerHeight) - 120);
  const setH = (h) => { h = Math.round(Math.min(Math.max(190, h), maxH())); sheet.style.height = h + 'px'; S.opt.sheetH = h; };
  if (S.opt.sheetH) sheet.style.height = S.opt.sheetH + 'px';
  grip.addEventListener('pointerdown', e => { drag = { y: e.clientY, h: sheet.getBoundingClientRect().height }; sheet.classList.add('resizing'); try { grip.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  grip.addEventListener('pointermove', e => { if (drag) setH(drag.h + drag.y - e.clientY); });
  const end = () => { if (drag) { drag = null; sheet.classList.remove('resizing'); APP.save(); } };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { delete S.opt.sheetH; sheet.style.height = ''; APP.save(); });
}

/* ---------- Project name (= title line of the INP file, base name of the saved files) ---------- */
function syncProjName() { const i = $('#projName'); if (i && document.activeElement !== i && i.value !== (S.model.title || '')) i.value = S.model.title || ''; document.title = (S.model.title ? S.model.title + ' — ' : '') + 'Combinatorial Geometry Tool'; }
$('#projName').addEventListener('input', e => { APP.snap('title'); S.model.title = e.target.value; document.title = (e.target.value ? e.target.value + ' — ' : '') + 'Combinatorial Geometry Tool'; APP.changed({}); });
/* ---------- Deferred updates ---------- */
let flags = {}, scheduled = false, saveT = 0;
APP.hooks.changed = (fl) => { Object.assign(flags, fl); if (!scheduled) { scheduled = true; setTimeout(flush, 30); } };
function flush() {
  scheduled = false;
  const fl = flags; flags = {};
  try {
    if (S.pick && S.pick.ownerKind !== 'stl' && !fl.keepPick) { S.pick = null; APP.drawHighlight(APP.gSel, null); }
    APP.sync(); syncProjName(); if (fl.tree || fl.right) grSchedule();
    if (fl.tree || fl.right || fl.csys) { APP.rebuildCsys(); if (S.opt.showParts || APP._partsOn) { APP.rebuildParts(); APP._partsOn = !!S.opt.showParts; } }
    if (fl.measures) APP.rebuildMeasures();
    if (fl.tree) { renderLeft(); renderToolOpts(); if (!fl.right) syncRightStyle(); }
    if (fl.right) renderRight(); else { updateLive(); if (fl.csys) updateCsysFields(); }
    updateInp(); updateLegend(); updateStatus(); updateDropHint(); updatePieces();
    if (APP.cutUpdate) APP.cutUpdate();
    if (fl.fit) APP.fit();
    clearTimeout(saveT); saveT = setTimeout(APP.save, 400);
  } catch (e) { console.error(e); toast('Error: ' + e.message); }
}
/** The "drop a file" hint disappears as soon as anything at all is in the project. */
function updateDropHint() {
  const any = S.stls.length || S.model.bodies.length || S.model.regions.length || S.model.csys.length || S.measures.length;
  const h = $('#dropHint'); h.hidden = !!any; h.style.display = any ? 'none' : '';
}
APP.hooks.undoState = () => { $('#btnUndo').disabled = !APP.canUndo(); $('#btnRedo').disabled = !APP.canRedo(); };
$('#btnUndo').onclick = () => APP.undo();
$('#btnRedo').onclick = () => APP.redo();

/* ---------- Colour theme (light by default) ---------- */
function applyTheme() {
  const dark = S.opt.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#151a22' : '#ffffff';
  const b = document.getElementById('btnTheme'); if (b) { b.textContent = dark ? '☀' : '☾'; b.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme'; }
  if (APP.cutRefresh) APP.cutRefresh();
}
{ const b = document.getElementById('btnTheme'); if (b) b.onclick = () => { S.opt.theme = S.opt.theme === 'dark' ? 'light' : 'dark'; applyTheme(); APP.save(); }; applyTheme(); }
/* ---------- Toolbar ---------- */
/* ---------- Resizable side panels (the viewport follows) ---------- */
const PW = { min: 220, left: 310, right: 340, dock: 440 };
const maxPW = () => Math.max(PW.min, Math.round(window.innerWidth * 0.6));
function applyPanelW() {
  const r = document.documentElement.style;
  r.setProperty('--lw', Math.min(maxPW(), Math.max(PW.min, +S.opt.lw || PW.left)) + 'px'); r.setProperty('--rw', Math.min(maxPW(), Math.max(PW.min, +S.opt.rw || PW.right)) + 'px'); r.setProperty('--dw', Math.min(maxPW(), Math.max(PW.min, +S.opt.dw || PW.dock)) + 'px');
}
(function () {
  $$('.rsz').forEach(h => {
    const side = h.dataset.rsz, drawer = side === 'left' ? dL : side === 'dock' ? $('#drawerDock') : dR, optK = { left: 'lw', right: 'rw', dock: 'dw' }[side];
    h.addEventListener('pointerdown', e => {
      if (narrow()) return; e.preventDefault(); h.setPointerCapture(e.pointerId); document.body.classList.add('rszing'); h.classList.add('on');
      const x0 = e.clientX, w0 = drawer.getBoundingClientRect().width;
      const mv = ev => { const dx = ev.clientX - x0, w = Math.round(Math.min(maxPW(), Math.max(PW.min, w0 + (side === 'left' ? dx : -dx)))); S.opt[optK] = w; applyPanelW(); };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); document.body.classList.remove('rszing'); h.classList.remove('on'); APP.save(); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('dblclick', () => {
      if (side === 'left') {                       // fit the longest name of the tree
        let extra = 0; $$('#leftBody .item .nm').forEach(n => { extra = Math.max(extra, n.scrollWidth - n.clientWidth); });
        if (extra > 0) S.opt.lw = Math.min(maxPW(), Math.round(drawer.getBoundingClientRect().width + extra + 14)); else S.opt.lw = PW.left;
      } else S.opt[optK] = PW[side];
      applyPanelW(); APP.save();
    });
  });
  window.addEventListener('resize', applyPanelW);
})();

/* ---------- Docking of the section view and of the dependency diagram as a side panel ---------- */
const DOCKS = { cut: { el: () => document.getElementById('cutwin'), home: () => $('#viewport') }, graph: { el: () => $('#dlgGraph'), home: () => document.body }, surf: { el: () => $('#dlgSurf'), home: () => document.body } };
function dockApply(key) {
  const d = DOCKS[key], el = d.el(); if (!el) return;
  const want = !!(S.opt.docked || {})[key] && !narrow();
  el.classList.toggle('docked', want);
  if (want && el.parentNode !== $('#dockBody')) $('#dockBody').appendChild(el);
  else if (!want && el.parentNode === $('#dockBody')) d.home().appendChild(el);
  const b = key === 'cut' ? el.querySelector('[data-cw=dock]') : el.querySelector('[data-dock]'); if (b) b.classList.toggle('on', want);
  dockSync();
}
function dockSync() {
  const box = $('#dockBody'), any = Array.from(box.children).some(c => c.hidden === false && !(c.tagName === 'DIALOG' && !c.open));
  $('#drawerDock').classList.toggle('open', any);
  applyPanelW();
}
APP.dockToggle = function (key) {
  if (narrow()) { toast('Docking needs a wider window'); return; }
  S.opt.docked = S.opt.docked || {}; S.opt.docked[key] = !S.opt.docked[key]; dockApply(key); APP.save();
};
(function () {
  new MutationObserver(dockSync).observe($('#dockBody'), { childList: true, attributes: true, subtree: true, attributeFilter: ['hidden', 'open'] });
  $('[data-dock=graph]').addEventListener('click', () => { APP.dockToggle('graph'); setTimeout(() => { grDraw(true); grFit(); }, 80); });
  window.addEventListener('resize', () => { for (const k of Object.keys(DOCKS)) dockApply(k); });
  for (const k of Object.keys(DOCKS)) dockApply(k);
  // free resizing of the floating diagram window (bottom-right corner)
  const d = $('#dlgGraph'), h = d.querySelector('.fw-rs'); let rz = null;
  h.addEventListener('pointerdown', e => { const r = d.getBoundingClientRect(); rz = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }; try { h.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  h.addEventListener('pointermove', e => { if (!rz) return; d.style.width = Math.round(Math.min(window.innerWidth - 20, Math.max(360, rz.w + e.clientX - rz.x))) + 'px'; d.style.height = Math.round(Math.min(window.innerHeight - 70, Math.max(260, rz.h + e.clientY - rz.y))) + 'px'; });
  const end = () => { rz = null; }; h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
})();
function syncToolbar() {
  applyPanelW();
  $$('#grpFilter button').forEach(b => b.classList.toggle('on', S.tool === 'select' && !!S.info && b.dataset.filter === S.filter));
  $$('#grpProj button[data-proj]').forEach(b => b.classList.toggle('on', b.dataset.proj === (S.opt.proj || 'persp')));
  $$('#grpRender button[data-render]').forEach(b => b.classList.toggle('on', b.dataset.render === (S.opt.render || 'shaded')));
  $('#btnEdges').classList.toggle('on', S.opt.edges !== false); $('#btnOnlyExp').classList.toggle('on', !!S.opt.onlyExp); { const gd = $('#dlgGraph'); $('#btnGraph').classList.toggle('on', !!(gd && gd.open)); }
  { const nm = S.opt.names || 'off', b = $('#btnNames'); b.classList.toggle('on', nm !== 'off'); b.title = 'Object names in the viewport: ' + nm + ' (click: off → regions → bodies → all)'; }
  $('#btnInvX').classList.toggle('on', !!S.opt.invX); $('#btnInvY').classList.toggle('on', !!S.opt.invY);
  $$('#grpTool button').forEach(b => b.classList.toggle('on', b.dataset.tool === 'select' ? (S.tool === 'select' && !!S.info) : b.dataset.tool === S.tool));
}
function clearPick() { S.pick = null; APP.drawHighlight(APP.gSel, null); }
/** Cut / pick tools: the region being defined turns transparent and falls behind every other clickable object; everything is restored at the end. */
function cutBegin() {
  const r = APP.getRegion(S.cutRid); if (!r || S.cutSnap) return;
  S.cutSnap = { id: r.id, visible: r.visible, look: r.look, opacity: r.opacity };
  r.visible = true; r.look = 'transparent'; r.opacity = Math.min(r.opacity, 0.18); S.pickBackRid = r.id;
  APP.applyStyles(); APP.changed({ tree: true });
}
function cutEnd() {
  const sn = S.cutSnap; S.cutSnap = null; S.pickBackRid = 0; if (!sn) return;
  const r = APP.getRegion(sn.id); if (!r) return;
  r.visible = sn.visible; r.opacity = sn.opacity; if (sn.look) r.look = sn.look; else delete r.look;
  APP.applyStyles(); APP.changed({ tree: true, right: true });
}
function setTool(t) {
  if (S.reg6 && t !== 'reg6') APP.reg6Cancel(true);
  if (S.cutSnap && t !== 'regcut' && t !== 'regpick') cutEnd();
  S.fill = null; S.tool = t; S.info = false; if (t !== 'select') S.winOpen = true; S.pending = null; S.cs3 = []; S.ptPlanes = []; if (t !== 'replane') S.reassign = null;
  APP.setPending(null); APP.clearHover(); hoverText = '';
  if ((t === 'regcut' || t === 'regpick') && S.cutRid) cutBegin();
  syncToolbar(); renderToolOpts(); updateStatus();
}
function setFilter(fl) {
  if (S.cutSnap) cutEnd();
  S.fill = null; S.filter = fl; S.tool = 'select'; S.info = true; S.winOpen = true; S.pending = null; S.cs3 = []; S.reassign = null; APP.setPending(null);
  clearPick(); APP.clearHover(); hoverText = '';
  syncToolbar(); renderToolOpts(); renderRight(); updateStatus();
}
$$('#grpFilter button').forEach(b => b.onclick = () => setFilter(b.dataset.filter));
// Info / Distance are off by default; clicking the active one switches it off (and closes its window).
$$('#grpTool button').forEach(b => b.onclick = () => {
  const t = b.dataset.tool;
  if (t === 'select') { if (S.tool === 'select' && S.info) { setTool('select'); clearPick(); renderRight(); updateStatus(); } else { setFilter(S.filter); } }
  else if (S.tool === t) setTool('select');
  else setTool(t);
});
$$('#grpProj button[data-proj]').forEach(b => b.onclick = () => { APP.setProjection(b.dataset.proj); syncToolbar(); APP.save(); });
$$('#grpRender button[data-render]').forEach(b => b.onclick = () => { S.opt.render = b.dataset.render; APP.applyStyles(); syncToolbar(); APP.save(); });
$('#btnOnlyExp').onclick = () => { APP.setOnlyExported(!S.opt.onlyExp); APP.applyStyles(); APP.refreshNames(); syncToolbar(); APP.save(); toast(S.opt.onlyExp ? 'Showing only the objects written in the INP file' : 'Showing all visible objects'); };
$('#btnNames').onclick = () => { const order = ['off', 'regions', 'bodies', 'all']; S.opt.names = order[(order.indexOf(S.opt.names || 'off') + 1) % order.length]; APP.refreshNames(); APP.changed({}); syncToolbar(); APP.save(); toast('Names: ' + S.opt.names); };
$('#btnEdges').onclick = () => { S.opt.edges = S.opt.edges === false; APP.applyStyles(); syncToolbar(); APP.save(); };
{ // global tessellation resolution (display + section + region booleans use the same facets)
  const pop = $('#resPop'), sl = $('#resSlider'); let tm = null;
  const label = () => { const r = S.opt.res || 1; $('#resVal').textContent = '×' + r.toFixed(2); sl.value = r; $('#resInfo').textContent = `Cylinder / cone: ${FK.seg(48)} facets · infinite cylinder: ${FK.seg(64)} · sphere: ${FK.seg(32)} × ${FK.seg(20)}`; };
  const apply = (v) => { S.opt.res = v; FK.resolution = v; label(); clearTimeout(tm); tm = setTimeout(() => { APP.changed({}); APP.save(); }, 120); };
  $('#btnRes').onclick = () => { pop.hidden = !pop.hidden; $('#btnRes').classList.toggle('on', !pop.hidden); if (!pop.hidden) { FK.resolution = S.opt.res || 1; label(); const vr = $('#viewport').getBoundingClientRect(), br = $('#btnRes').getBoundingClientRect(); pop.style.left = Math.max(4, Math.min(br.left - vr.left - 20, vr.width - 260)) + 'px'; } };
  sl.addEventListener('input', () => apply(+sl.value));
  $('#resReset').onclick = () => apply(1);
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#btnRes')) { pop.hidden = true; $('#btnRes').classList.remove('on'); } }, true);
}
$('#btnInvX').onclick = () => { S.opt.invX = !S.opt.invX; syncToolbar(); APP.save(); };
$('#btnInvY').onclick = () => { S.opt.invY = !S.opt.invY; syncToolbar(); APP.save(); };
$('#btnCut').onclick = () => APP.cutSetOpen(!APP.cut.open);
APP.hooks.cutToggled = (on) => $('#btnCut').classList.toggle('on', on);
function lookAtFace(pk) { APP.cam.target.set(pk.centroid[0], pk.centroid[1], pk.centroid[2]); APP.viewAlong(pk.normal); }
$$('#viewBtns button').forEach(b => b.onclick = () => {
  const v = b.dataset.view;
  if (v !== 'normal') return APP.setView(v);
  if (S.pick && S.pick.kind === 'face') lookAtFace(S.pick);
  else { setTool('viewface'); S.winOpen = true; renderToolWin(); }
});

/* ---------- Redraw the view ---------- */
function refreshView() {
  const n = APP.refreshView();
  APP.applyStyles(); if (typeof updateLegend === 'function') updateLegend();
  const d = APP.drawnObjects().filter(o => o.layer !== 'other'), by = {}; d.forEach(o => by[o.layer] = (by[o.layer] || 0) + 1);
  const det = d.length ? Object.keys(by).map(k => `${by[k]} ${k}`).join(', ') : 'nothing';
  toast(`View redrawn${n ? ` (${n} leftover removed)` : ''} — drawn: ${det}`);
  console.info('Drawn objects:', d);
}
$('#btnRefresh').onclick = refreshView;
