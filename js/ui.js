/* ui.js — UI: panels, tools, events, import/export */
(function () {
  'use strict';
  const APP = window.APP, S = APP.S, V = FK.V, fmt = FK.fmt;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (n, d) => (n === null || n === undefined || !isFinite(n)) ? '—' : fmt(n, d === undefined ? 4 : d);
  const xyz = (p, d) => `${f(p[0], d)}, ${f(p[1], d)}, ${f(p[2], d)}`;
  const kv = (rows) => '<div class="kv">' + rows.map(r => `<span>${r[0]}</span><span>${r[1]}</span>`).join('') + '</div>';
  const cm = (n, d) => `${f(n, d)} cm`;
  const cmmm = (n) => `${f(n, 4)} cm <small class="muted">(${f(n * 10, 3)} mm)</small>`;

  const ICON = {
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A10.4 10.4 0 0 1 12 5c7 0 11 7 11 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/></svg>'
  };

  /* ---------- Toast ---------- */
  const toastEl = $('#toast');
  let toastT;
  APP.hooks.toast = (m) => { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3600); };
  const toast = APP.hooks.toast;

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copied to the clipboard'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Copy failed'); }
      ta.remove();
    }
  }

  /* ---------- Drawers and INP sheet ---------- */
  const dL = $('#drawerLeft'), dR = $('#drawerRight'), scrim = $('#scrim'), sheet = $('#sheet');
  const narrow = () => window.matchMedia('(max-width: 899px)').matches;
  function setDrawer(side, open) {
    const d = side === 'left' ? dL : dR, o = side === 'left' ? dR : dL;
    d.classList.toggle('open', open);
    if (open && narrow()) o.classList.remove('open');
    scrim.classList.toggle('on', narrow() && (dL.classList.contains('open') || dR.classList.contains('open')));
  }
  $('#btnLeft').onclick = () => setDrawer('left', !dL.classList.contains('open'));
  $('#btnRight').onclick = () => setDrawer('right', !dR.classList.contains('open'));
  $$('.closeD').forEach(b => b.onclick = () => setDrawer(b.dataset.close, false));
  scrim.onclick = () => { setDrawer('left', false); setDrawer('right', false); };
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

  /* ---------- Deferred updates ---------- */
  let flags = {}, scheduled = false, saveT = 0;
  APP.hooks.changed = (fl) => { Object.assign(flags, fl); if (!scheduled) { scheduled = true; setTimeout(flush, 30); } };
  function flush() {
    scheduled = false;
    const fl = flags; flags = {};
    try {
      if (S.pick && S.pick.ownerKind !== 'stl' && !fl.keepPick) { S.pick = null; APP.drawHighlight(APP.gSel, null); }
      APP.sync();
      if (fl.tree || fl.right || fl.csys) APP.rebuildCsys();
      if (fl.measures) APP.rebuildMeasures();
      if (fl.tree) { renderLeft(); renderToolOpts(); if (!fl.right) syncRightStyle(); }
      if (fl.right) renderRight(); else { updateLive(); if (fl.csys) updateCsysFields(); }
      updateInp(); updateStatus(); updateDropHint();
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

  /* ---------- Toolbar ---------- */
  function syncToolbar() {
    $$('#grpFilter button').forEach(b => b.classList.toggle('on', S.tool === 'select' && !!S.info && b.dataset.filter === S.filter));
    $$('#grpProj button[data-proj]').forEach(b => b.classList.toggle('on', b.dataset.proj === (S.opt.proj || 'persp')));
    $$('#grpRender button[data-render]').forEach(b => b.classList.toggle('on', b.dataset.render === (S.opt.render || 'shaded')));
    $('#btnEdges').classList.toggle('on', S.opt.edges !== false);
    $('#btnInvX').classList.toggle('on', !!S.opt.invX); $('#btnInvY').classList.toggle('on', !!S.opt.invY);
    $$('#grpTool button').forEach(b => b.classList.toggle('on', b.dataset.tool === 'select' ? (S.tool === 'select' && !!S.info) : b.dataset.tool === S.tool));
  }
  function clearPick() { S.pick = null; APP.drawHighlight(APP.gSel, null); }
  function setTool(t) {
    S.fill = null; S.tool = t; S.info = false; if (t !== 'select') S.winOpen = true; S.pending = null; S.cs3 = []; if (t !== 'replane') S.reassign = null;
    APP.setPending(null); APP.clearHover(); hoverText = '';
    syncToolbar(); renderToolOpts(); updateStatus();
  }
  function setFilter(fl) {
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

  /* ---------- Floating tool window (options + results of Info / Distance / creation tools) ---------- */
  function winTitle() {
    if (S.fill) return 'Pick a value';
    return { select: 'Selection · ' + ({ point: 'points', edge: 'edges', face: 'faces', object: 'objects' }[S.filter]), measure: 'Distance', rpp: 'RPP from 2 points',
      plane: 'PLA from a face', replane: 'Re-pick a plane', csys3: 'Coordinate system from 3 points', viewface: 'Look at a face' }[S.tool] || 'Tool';
  }
  function toolOptsHTML() {
    const o = S.opt;
    const chk = (k, l) => `<label><input type="checkbox" data-opt="${k}" ${o[k] ? 'checked' : ''}>${l}</label>`;
    const num = (k, l, u) => `<label>${l}<input type="number" step="any" data-opt="${k}" value="${o[k]}">${u}</label>`;
    let h = '';
    if (S.model.csys.length) {
      h += `<label>Active coordinate system <select data-act="activeCs"><option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${S.model.active === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`;
    }
    if (S.fill) {
      const sp = fillSpec();
      if (sp && sp.kind === 'circlePts') h += chk('snap', 'Snap to vertices') + `<label class="muted">${(S.fillPts || []).length} point(s) picked</label><span class="btns"><button class="btn sm primary" data-act="fillDone">Done</button><button class="btn sm" data-act="fillUndo">Undo last</button></span>`;
      else if (sp && EDGE_KINDS.includes(sp.kind)) h += '<label class="muted">Sharp edges only (rims are followed automatically)</label>';
      else h += chk('snap', 'Snap to vertices');
      if (sp && (sp.kind === 'circleEdge' || sp.kind === 'circlePts') && (sp.axisIdx || (sp.radIdx !== undefined && sp.radIdx !== null))) h += chk('circleAll', 'Also set ' + (sp.axisIdx ? 'the axis (circle normal) and ' : '') + 'the radius');
    }
    else if (S.tool === 'select') {
      if (S.filter === 'point') h += chk('snap', 'Snap to vertices');
      else if (S.filter === 'edge') h += chk('edgeSharpOnly', 'Sharp edges only') + num('sharp', 'angle ≥', '°');
      else if (S.filter === 'face') h += chk('coplanar', 'Whole face (coplanar triangles)') + num('coTol', 'tolerance', '°');
      else h += '<label class="muted">Click an object (mesh, body or region)</label>';
    } else if (S.tool === 'measure') h += chk('snap', 'Snap to vertices');
    else if (S.tool === 'rpp') h += chk('snap', 'Snap to vertices');
    else if (S.tool === 'csys3') h += chk('snap', 'Snap to vertices') + '<label class="muted">Created as a child of the active system</label>';
    else if (S.tool === 'plane' || S.tool === 'replane') {
      h += chk('coplanar', 'Highlight the whole face') + '<label class="muted">The plane is only created; add it to a region yourself</label>';
    } else if (S.tool === 'viewface') h += chk('coplanar', 'Highlight the whole face');
    return h;
  }
  function measureResultsHTML() {
    const m = S.measures[S.measures.length - 1];
    if (!m) return '<div class="muted" style="font-size:12.5px">No measure yet — click point A, then point B.</div>';
    const d = V.sub(m.b, m.a);
    return `<div class="card"><h5>Last distance</h5>` + kv([['Distance', cmmm(V.len(d))], ['ΔX', cm(d[0])], ['ΔY', cm(d[1])], ['ΔZ', cm(d[2])], ['Point A', xyz(m.a, 4)], ['Point B', xyz(m.b, 4)]]) +
      `<div class="btns"><button class="btn sm" data-act="rppLastMeasure">RPP from these 2 points</button><button class="btn sm danger" data-act="clearMeasures">Clear all (${S.measures.length})</button></div></div>`;
  }
  function renderToolWin() {
    const el = $('#toolwin'); if (!el) return;
    const active = !!(S.fill || S.tool !== 'select' || S.info || S.cutOpen);
    el.style.display = active ? '' : 'none';
    if (!active) { el.innerHTML = ''; return; }
    const open = !!S.winOpen;
    let b = '';
    if (open) {
      b = `<div class="tw-opts">${toolOptsHTML()}</div>`;
      if (S.tool === 'select' && S.pick) b += pickCardHTML(S.pick);
      if (S.tool === 'measure') b += measureResultsHTML();
    }
    el.innerHTML = `<div class="tw-h" data-act="winToggle" title="Show / hide the options and results of this tool"><span>${winTitle()}</span><span style="flex:none;font-weight:400">${open ? '▾' : '▸'}</span></div>` + (open ? `<div class="tw-b">${b}</div>` : '');
  }
  function renderToolOpts() { renderToolWin(); }

  function onOptChange(e) {
    const t = e.target, k = t.dataset.opt;
    if (t.dataset.act === 'activeCs') { APP.setActiveCsys(+t.value); return; }
    if (!k) return;
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') { v = parseFloat(t.value); if (!isFinite(v)) return; }
    else v = t.value;
    S.opt[k] = v;
    if (['coplanar', 'coTol', 'sharp', 'edgeSharpOnly'].includes(k)) clearPick();
    if (k === 'margin' || k === 'axes') APP.changed({});
    if (k === 'invX' || k === 'invY') syncToolbar();
    if (k === 'style') { S.opt.style = +v; $('#inpStyle').value = String(S.opt.style); updateInp(); }
    APP.save();
  }
  $('#toolwin').addEventListener('change', onOptChange);
  $('#toolwin').addEventListener('input', e => { if (e.target.type === 'number') onOptChange(e); });

  /* ---------- Status ---------- */
  let hoverText = '';
  function pkSummary(pk) {
    if (!pk) return '';
    switch (pk.kind) {
      case 'point': return `${pk.snapped ? 'Vertex' : 'Point'} (${xyz(pk.p, 3)}) cm`;
      case 'edge': return pk.none ? 'No sharp edge here (see the "sharp edges" option)' : pk.circle ? `Circular rim: R = ${f(pk.circle.r, 4)} cm, centre (${xyz(pk.circle.c, 3)}), ${pk.loop.segments} segments` : `Edge: ${f(pk.chain ? pk.chain.length : pk.length, 4)} cm${pk.chain ? ' (' + pk.chain.segments + ' segments)' : ''}`;
      case 'face': return `Face: ${f(pk.area, 4)} cm² · ${pk.count} triangle${pk.count > 1 ? 's' : ''} · n = (${xyz(pk.normal, 3)})`;
      case 'object': { const st = APP.objectStats(pk); return `Object ${esc(pk.ownerName)}${st.volume !== undefined && st.volume !== null ? ' · V = ' + f(st.volume, 3) + ' cm³' : ''}`; }
    }
    return '';
  }
  function updateStatus() {
    let t = '';
    if (S.fill) {
      const sp = fillSpec(), one = S.fill.only !== undefined ? ' (single coordinate)' : '';
      if (sp && sp.kind === 'circlePts') t = `Click points on the circle (${(S.fillPts || []).length} picked, at least 3) · <a href="#" data-act="fillDone">Done (Enter)</a> · <a href="#" data-act="fillUndo">Undo last</a> · <a href="#" data-act="cancelFill">Cancel (Esc)</a>`;
      else if (sp && sp.kind === 'circleEdge') t = 'Click a circular edge (rim): its circle gives the centre · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
      else if (sp && sp.kind === 'dirEdge') t = 'Click an edge: its normalized direction gives the vector · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
      else if (sp && sp.kind === 'radiusEdge') t = 'Click an arc edge (radius of its circle) or a straight edge (its length) · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
      else t = sp && sp.kind === 'normal' ? 'Pick: click a face to take its outward normal · <a href="#" data-act="cancelFill">Cancel (Esc)</a>'
        : 'Pick: click a point in the view' + (sp && sp.kind === 'radius' ? ' on the surface' : '') + one + ' · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
    } else if (S.tool === 'select') {
      t = !S.info ? '' : S.pick ? esc(pkSummary(S.pick)) + ' <a href="#" data-act="openRight">Details ▸</a>'
        : { point: 'Click a vertex of the model', edge: 'Click an edge', face: 'Click a face (triangle or planar face)', object: 'Click an object' }[S.filter];
    } else if (S.tool === 'measure') t = (S.pending ? 'Distance: click point B' : 'Distance: click point A') + ' · <a href="#" data-act="cancelTool">Cancel (Esc)</a>';
    else if (S.tool === 'csys3') t = 'Coordinate system: click ' + ['the origin', 'a point on the X axis', 'a point in the XY plane (+Y side)'][(S.cs3 || []).length];
    else if (S.tool === 'rpp') t = S.pending ? 'RPP: click the opposite corner (point 2)' : 'RPP: click the first corner (point 1)';
    else if (S.tool === 'plane') t = 'Plane: click a triangle / face — its normal gives the PLA vector H';
    else if (S.tool === 'viewface') t = 'Click a face to look at it · <a href="#" data-act="cancelTool">Cancel (Esc)</a>';
    else if (S.tool === 'replane') { const b = APP.getBody(S.reassign); t = `Click the new face for ${b ? esc(b.name) : 'the plane'}`; }
    if (hoverText && !(S.tool === 'select' && S.pick)) t += (t ? ' · ' : '') + '<span class="muted">' + esc(hoverText) + '</span>';
    $('#status').innerHTML = t ? `<span>${t}</span>` : '';
  }
  $('#status').addEventListener('click', e => { if (e.target.closest('[data-act=cancelTool]')) { e.preventDefault(); setTool('select'); } });
  $('#status').addEventListener('click', e => { const a = e.target.closest('[data-act=fillDone],[data-act=fillUndo]'); if (!a) return; e.preventDefault(); if (a.dataset.act === 'fillDone') finishCirclePts(); else if (S.fillPts && S.fillPts.length) { S.fillPts.pop(); APP.setPending(S.fillPts.slice()); renderToolOpts(); updateStatus(); } });
  $('#status').addEventListener('click', e => { if (e.target.closest('[data-act=cancelFill]')) { e.preventDefault(); cancelFill(); } });
  $('#status').addEventListener('click', e => { if (e.target.closest('[data-act=openRight]')) { e.preventDefault(); setDrawer('right', true); } });

  /* ---------- Dialogs: confirm, File menu, settings, project files ---------- */
  // Close dialogs explicitly: <form method="dialog"> submission is blocked in sandboxed iframes.
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('dialog button[value]');
    if (!b) return;
    const d = b.closest('dialog'); e.preventDefault();
    if (d.open) d.close(b.value);
  });
  function askConfirm(msg, okLabel) {
    return new Promise(res => {
      const d = $('#dlgConfirm'); $('#confirmMsg').textContent = msg; $('#confirmOk').textContent = okLabel || 'OK'; d.returnValue = '';
      const h = () => { d.removeEventListener('close', h); res(d.returnValue === 'ok'); };
      d.addEventListener('close', h); d.showModal();
    });
  }
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
      const b = APP.addFeature(FEAT.g.feature); toast(`${b.name} (${b.type}) added to the model`);
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
      if (add) { const f = FEAT.res.features.find(x => x.id === +add.dataset.fadd); if (f && !FEAT.done.has(f.id)) { const b = APP.addFeature(f); FEAT.done.add(f.id); toast(`${b.name} (${b.type}) added to the model`); $('#featList').innerHTML = featListHTML(); } return; }
      const row = e.target.closest('.fr'); if (row) featSelect(+row.dataset.fid);
    });
    $('#featAddAll').onclick = () => {
      if (!FEAT.res) return; let k = 0;
      for (const f of FEAT.res.features) if (!FEAT.done.has(f.id)) { APP.addFeature(f); FEAT.done.add(f.id); k++; }
      toast(k + ' object(s) added'); $('#featList').innerHTML = featListHTML();
    };
  })();

  /* ---------- Void region (experimental) ---------- */
  function voidArgs() { return [+$('#voidMargin').value || 0, (document.querySelector('input[name=voidMode]:checked') || {}).value || 'compact']; }
  function updateVoidPrev(r) {
    const pl = APP.voidPlan(r, ...voidArgs()), box = $('#voidPrev'), ok = $('#voidOk');
    if (pl.error) {
      box.innerHTML = '<div class="msg bad">' + esc(pl.error) + (pl.diag ? '<br>' + pl.diag.map(d => esc(d.text)).join('<br>') : '') + '</div>';
      ok.disabled = true; return;
    }
    ok.disabled = false;
    const f = (a) => a.map(x => +x.toFixed(3)).join(', ');
    box.innerHTML = '<div class="msg"><b>Bounding box</b> (' + f(pl.bbox.min) + ') → (' + f(pl.bbox.max) + ')<br>' +
      '<b>RPP ' + esc(pl.boxName) + '</b> ' + f(pl.p) + '<br><b>Region ' + esc(pl.regName) + '</b><br><code>' + esc(pl.expr) + '</code></div>';
  }
  function openVoidDlg(r) {
    const d = $('#dlgVoid'); d.dataset.rid = r.id; d.returnValue = '';
    updateVoidPrev(r);
    if (!d.open) d.showModal();
  }
  (function () {
    const d = $('#dlgVoid'); if (!d) return;
    const refresh = () => { const r = APP.getRegion(+d.dataset.rid); if (r) updateVoidPrev(r); };
    d.addEventListener('input', refresh); d.addEventListener('change', refresh);
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return;
      const r = APP.getRegion(+d.dataset.rid); if (!r) return;
      const res = APP.createVoidRegion(r, ...voidArgs());
      if (res.error) toast(res.error);
    });
  })();
  /* ---------- Boolean of two regions (experimental) ---------- */
  function boolArgs() { const q = (n) => (document.querySelector('input[name=' + n + ']:checked') || {}).value; return [APP.getRegion(+$('#boolB').value), q('boolOp') || 'sub', q('boolMode') || 'compact']; }
  function updateBoolPrev() {
    const d = $('#dlgBool'), a = APP.getRegion(+d.dataset.rid), box = $('#boolPrev'), ok = $('#boolOk');
    const pl = APP.boolPlan(a, ...boolArgs());
    if (pl.error) { box.innerHTML = '<div class="msg bad">' + esc(pl.error) + '</div>'; ok.disabled = true; return; }
    ok.disabled = false;
    const v = (x) => x === null ? '?' : (+x.toPrecision(5)) + ' cm³';
    box.innerHTML = '<div class="msg"><b>Region ' + esc(pl.regName) + '</b><br><code>' + esc(pl.expr) + '</code><br>' +
      'Volume in the render zone: A ' + v(pl.volA) + ' · B ' + v(pl.volB) + ' → result <b>' + v(pl.vol) + '</b>' + (pl.error2 ? '<br><span class="bad">' + esc(pl.error2) + '</span>' : '') + '</div>';
  }
  function openBoolDlg(a) {
    const d = $('#dlgBool'); d.dataset.rid = a.id; d.returnValue = '';
    const others = S.model.regions.filter(r => r.id !== a.id);
    if (!others.length) { toast('Create a second region first'); return; }
    $('#boolA').innerHTML = '<b>' + esc(a.name) + '</b> <code>' + esc(a.expr) + '</code>';
    $('#boolB').innerHTML = others.map(r => `<option value="${r.id}">${esc(r.name)} — ${esc(r.expr.slice(0, 40))}</option>`).join('');
    updateBoolPrev();
    if (!d.open) d.showModal();
  }
  (function () {
    const d = $('#dlgBool'); if (!d) return;
    d.addEventListener('input', updateBoolPrev); d.addEventListener('change', updateBoolPrev);
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return;
      const a = APP.getRegion(+d.dataset.rid); if (!a) return;
      const res = APP.createBoolRegion(a, ...boolArgs());
      if (res.error) toast(res.error);
    });
  })();
  async function newProject() {
    if (await askConfirm('Start a new project? Meshes, bodies, regions, coordinate systems and measures are removed (the model part can be undone with Ctrl+Z; meshes cannot).', 'Clear everything')) { APP.newModel(true); toast('New project'); }
  }
  async function saveProject() {
    try {
      const txt = await APP.exportProject();
      const blob = new Blob([txt], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (S.model.title || 'geometry').replace(/[^\w\-]+/g, '_') + '.fgt.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Project saved (${S.stls.length} mesh${S.stls.length === 1 ? '' : 'es'} embedded, ${(txt.length / 1048576).toFixed(1)} MB)`);
    } catch (e) { console.error(e); toast('Save failed: ' + e.message); }
  }
  $('#fileProj').onchange = async (e) => { const fl = e.target.files[0]; if (fl && await APP.importProject(await fl.text())) toast('Project loaded'); e.target.value = ''; };
  $('#btnFile').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'New project…', fn: newProject },
      { label: 'Open project (.json)…', fn: () => $('#fileProj').click() },
      { label: 'Save project (.json) — with meshes', fn: saveProject },
      { sep: 1 },
      { label: 'Import STL / OBJ…', fn: () => $('#fileStl').click() },
      { label: 'Import INP block…', fn: openImport },
      { label: 'Export .inp file', fn: () => $('#btnInpSave').click() },
      { label: 'Copy .inp text', fn: () => copyText(APP.inpText()) }]);
  };
  const dlgSet = $('#dlgSettings');
  { const vt = document.getElementById('verTag'); if (vt) vt.textContent = 'v' + FK.VERSION; document.title = FK.APP_NAME; }
  $('#btnSettings').onclick = () => {
    const o = S.opt;
    $('#settingsBody').innerHTML = `<details class="fold" open><summary>Display</summary><div>
        <label class="chk"><input type="checkbox" data-opt="axes" ${o.axes ? 'checked' : ''}>Axes at the origin (X red, Y green, Z blue)</label>
        <label class="chk"><input type="checkbox" data-opt="multiPick" ${o.multiPick !== false ? 'checked' : ''}>Pop-up to choose among overlapping entities under a click</label>
        <label class="chk"><input type="checkbox" data-opt="invX" ${o.invX ? 'checked' : ''}>Invert left / right mouse rotation</label>
        <label class="chk"><input type="checkbox" data-opt="invY" ${o.invY ? 'checked' : ''}>Invert up / down mouse rotation</label>
        <div class="row2"><span class="muted" style="flex:1">Render zone margin (%)</span><input type="number" step="1" min="0" style="width:80px" data-opt="margin" value="${o.margin}"></div></div></details>
      <details class="fold" open><summary>INP block</summary><div>
        <div class="fld"><label>Title (line after GEOBEGIN)</label><input type="text" data-k="title" value="${esc(S.model.title)}"></div>
        <div class="fld" style="margin-top:6px"><label title="All INP coordinates and directions are written in this frame">Export coordinate system ⓘ</label><select data-k="exportCs"><option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${APP.exportCs() === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="fld" style="margin-top:6px"><label title="Name-based geometry (COMBNAME): free format, names ≤ 8 characters, lines ≤ 132 columns. Fixed columns: GEOBEGIN (A8,2X,6E10.0,A8), title (2I5,10X,A60).">Output format ⓘ</label><select data-opt="style">
          <option value="1" ${o.style == 1 ? 'selected' : ''}>Flair style (REGION + line)</option>
          <option value="2" ${o.style == 2 ? 'selected' : ''}>Compact aligned style</option>
          <option value="3" ${o.style == 3 ? 'selected' : ''}>Fixed columns (Fortran-like, ≤132 col)</option></select></div>
        <div class="muted" style="font-size:12px;margin-top:6px">Name-based geometry (COMBNAME) is free format: separators are blanks, names ≤ 8 characters, lines ≤ 132 columns. The fixed-column style aligns GEOBEGIN as (A8,2X,6E10.0,A8) and the title as (2I5,10X,A60).</div></div></details>
      <details class="fold"><summary>About / updates</summary><div>
        <div><b>${FK.APP_NAME}</b> v${FK.VERSION}</div>
        ${window.CGT_check ? `<div class="update-row"><button type="button" class="btn sm" data-act="chkUpd">Check for update</button><button type="button" class="btn sm" data-act="forceUpd">Force refresh (clear cache)</button><span class="muted" id="updMsg"></span></div>
        <div class="muted" style="font-size:12px">The app always loads the newest files when online (network-first) and checks <code>version.json</code> on load and on focus.</div>` : `<div class="muted" style="font-size:12px">Single-file version: there is no automatic update. Re-download the file to get a newer version.</div>`}</div></details>`;
    if (!dlgSet.open) dlgSet.showModal();
  };
  $('#settingsBody').addEventListener('input', e => { const t = e.target; if (t.dataset.k === 'title') { APP.snap('title'); S.model.title = t.value; APP.changed({}); } else if (t.type === 'number') onOptChange(e); });
  $('#settingsBody').addEventListener('click', async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'forceUpd') window.CGT_forceRefresh();
    else if (a.dataset.act === 'chkUpd') { const m = $('#updMsg'); m.textContent = '…'; const r = await window.CGT_check(true); m.textContent = r === 'new' ? 'A newer version is available.' : r === 'same' ? 'Up to date.' : 'Offline.'; }
  });
  $('#settingsBody').addEventListener('change', e => { if (e.target.dataset.opt) onOptChange(e); else if (e.target.dataset.k === 'exportCs') APP.setExportCsys(+e.target.value); });

  /* ---------- Left panel: project tree ---------- */
  function itemHTML(t, o) {
    const sel = S.sel && S.sel.t === t && S.sel.id === o.id;
    return `<div class="item${sel ? ' sel' : ''}" data-t="${t}" data-id="${o.id}" draggable="true">
      <div class="top"><button class="vis${o.visible ? '' : ' off'}" data-act="vis" title="Show / hide">${o.visible ? ICON.eye : ICON.eyeOff}</button>
      ${o.color ? `<span class="sw" style="background:${o.color}"></span>` : ''}<span class="nm">${esc(o.name)}</span><span class="ty">${o.noExport ? '<span title="Not exported to the INP">⊘ </span>' : ''}${esc(o.type)}</span><button class="mn" data-act="imenu" title="Actions">⋮</button></div>
      ${o.opacity !== undefined ? `<div class="op"><input type="range" min="0" max="100" value="${Math.round(o.opacity * 100)}" data-act="op" aria-label="Opacity"><small>${Math.round(o.opacity * 100)}%</small></div>` : ''}</div>`;
  }
  const treeState = () => S.opt.tree || (S.opt.tree = {});
  const isOpen = (k) => treeState()[k] !== false;
  const GROUPS_DEF = [
    { k: 'meshes', title: 'Meshes (STL / OBJ)', items: () => S.stls },
    { k: 'csys', title: 'Coordinate systems', items: () => S.model.csys },
    { k: 'planes', title: 'Planes', items: () => S.model.bodies.filter(b => FK.isPlaneType(b.type)) },
    { k: 'bodies', title: 'Bodies', items: () => S.model.bodies.filter(b => !FK.isPlaneType(b.type)) },
    { k: 'regions', title: 'Regions', items: () => S.model.regions },
    { k: 'measures', title: 'Measures', items: () => S.measures }
  ];
  /** Coordinate systems of `list` as a tree; a parent outside the list counts as "root" inside it. */
  function csysTree(list, pid, depth) {
    const act = S.model.active || 0, inL = new Set(list.map(c => c.id));
    return list.filter(c => (inL.has(c.parent) ? c.parent : 0) === pid).map(c => {
      const sel = S.sel && S.sel.t === 'csys' && S.sel.id === c.id, isA = act === c.id;
      const kids = list.filter(x => x.parent === c.id).length, open = treeState()['cs' + c.id] !== false;
      return `<div class="item cs${sel ? ' sel' : ''}${isA ? ' act' : ''}" data-t="csys" data-id="${c.id}" draggable="true"><div class="top" style="padding-left:${depth * 14}px">
        ${kids ? `<button class="chev" data-act="fold" data-k="cs${c.id}">${open ? '▾' : '▸'}</button>` : '<span class="chev"></span>'}
        <button class="vis${c.visible ? '' : ' off'}" data-act="vis" title="Show / hide">${c.visible ? ICON.eye : ICON.eyeOff}</button>
        <button class="rad${isA ? ' on' : ''}" data-act="activate" data-cid="${c.id}" title="Set as active coordinate system" aria-label="Active">${isA ? '●' : '○'}</button>
        <span class="sw" style="background:${c.color}"></span><span class="nm">${esc(c.name)}</span><span class="ty">${APP.exportCs() === c.id ? '⇥ export ' : ''}${c.frozen ? '🔒 ' : ''}${c.parent ? '↳ ' + esc(APP.csysLabel(c.parent)) : ''}</span><button class="mn" data-act="imenu" title="Actions">⋮</button></div></div>` +
        (kids && open ? csysTree(list, c.id, depth + 1) : '');
    }).join('');
  }
  function rowHTML(k, o) {
    switch (k) {
      case 'meshes': return itemHTML('stl', { id: o.id, name: o.name, type: o.format || 'STL', color: o.color, visible: o.visible, opacity: o.opacity });
      case 'planes': case 'bodies': return itemHTML('body', { id: o.id, name: o.name, type: o.type === 'RAW' ? o.rawType : o.type, color: o.color, visible: o.visible, opacity: o.type === 'RAW' ? undefined : o.opacity });
      case 'regions': return itemHTML('region', { id: o.id, name: o.name, type: 'REGION', color: o.color, visible: o.visible, opacity: o.opacity });
      case 'measures': return itemHTML('measure', { id: o.id, name: `M${S.measures.indexOf(o) + 1} · ${f(V.dist(o.a, o.b), 3)} cm`, type: 'DIST', visible: o.visible });
    }
    return '';
  }
  const rowsOf = (k, list) => k === 'csys' ? csysTree(list, 0, 0) : list.map(o => rowHTML(k, o)).join('');
  function groupRowHTML(gr, members) {
    const open = gr.open !== false, anyVis = members.some(o => o.visible);
    const name = S.renG === gr.id ? `<input class="gname" data-gid="${gr.id}" value="${esc(gr.name)}" maxlength="40">` : `<span class="nm">${esc(gr.name)}</span>`;
    return `<div class="grow" data-gid="${gr.id}" data-k="${gr.k}"><button class="chev" data-act="gfold" data-gid="${gr.id}" aria-label="Expand / collapse">${open ? '▾' : '▸'}</button>` +
      `<button class="vis${anyVis ? '' : ' off'}" data-act="grpvis" data-gid="${gr.id}" title="Show / hide the whole group">${anyVis ? ICON.eye : ICON.eyeOff}</button>` +
      `<span class="gi" aria-hidden="true">▣</span>${name}<span class="cnt">${members.length}</span><button class="mn" data-act="grpmenu" data-gid="${gr.id}" title="Group actions">⋮</button></div>`;
  }
  function catBody(g) {
    const k = g.k, all = g.items(), groups = APP.groups().filter(x => x.k === k);
    let h = '';
    if (k === 'csys') {
      const a0 = S.model.active || 0;
      h += `<div class="item cs g${a0 === 0 ? ' act' : ''}"><div class="top"><span class="chev"></span><button class="rad${a0 === 0 ? ' on' : ''}" data-act="activate" data-cid="0" title="Global frame (default)" aria-label="Global">${a0 === 0 ? '●' : '○'}</button><span class="nm">Global (0, 0, 0)</span><span class="ty">default</span></div></div>`;
    }
    for (const gr of groups) {
      const members = all.filter(o => o.grp === gr.id);
      h += groupRowHTML(gr, members);
      if (gr.open !== false) h += `<div class="gb" data-gid="${gr.id}" data-k="${k}">${rowsOf(k, members) || '<div class="empty">Drag items here</div>'}</div>`;
    }
    return h + rowsOf(k, all.filter(o => !groups.some(x => x.id === o.grp)));
  }
  function renderLeft() {
    let h = `<div class="tree">`;
    for (const g of GROUPS_DEF) {
      const list = g.items(), open = isOpen(g.k), anyVis = list.some(o => o.visible);
      h += `<div class="tg" data-k="${g.k}"><div class="th" data-g="${g.k}"><button class="chev" data-act="fold" data-k="${g.k}" aria-label="Expand / collapse">${open ? '▾' : '▸'}</button><span class="tt">${g.title}</span><span class="cnt">${list.length}</span>` +
        (g.k !== 'csys' && g.k !== 'measures' || list.length ? `<button class="vis${anyVis ? '' : ' off'}" data-act="gvis" data-g="${g.k}" title="Show / hide all">${anyVis ? ICON.eye : ICON.eyeOff}</button>` : '') +
        `<button class="mn" data-act="gmenu" data-g="${g.k}" title="Create / actions (or right-click)">＋</button></div>`;
      if (open) h += `<div class="tb">${catBody(g) || '<div class="empty">Empty — right-click the header to create</div>'}</div>`;
      h += '</div>';
    }
    h += '</div>';
    $('#leftBody').innerHTML = h;
    const gi = $('#leftBody .gname'); if (gi) { gi.focus(); gi.select(); }
    syncToolbar();
  }

  function selectItem(t, id) {
    S.sel = { t, id };
    APP.changed({ tree: true, right: true });
    if (narrow()) { setDrawer('left', false); setDrawer('right', true); }
  }
  function groupItems(k) { const g = GROUPS_DEF.find(x => x.k === k); return g ? g.items() : []; }
  function setGroupVis(k, on) { APP.snap(); groupItems(k).forEach(o => { o.visible = on; }); APP.changed({ tree: true, csys: k === 'csys', measures: k === 'measures' }); }

  /* ---- context menus ---- */
  const ctxEl = document.createElement('div'); ctxEl.id = 'ctxmenu'; ctxEl.hidden = true; document.body.appendChild(ctxEl);
  let ctxItems = [];
  function hideMenu() { ctxEl.hidden = true; }
  function showMenu(x, y, items) {
    ctxItems = items;
    ctxEl.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
    ctxEl.hidden = false;
    const w = ctxEl.offsetWidth || 200, h = ctxEl.offsetHeight || 200;
    ctxEl.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 6)) + 'px';
    ctxEl.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 6)) + 'px';
  }
  ctxEl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const it = ctxItems[+b.dataset.i]; hideMenu(); if (it && it.fn) it.fn(); });
  document.addEventListener('pointerdown', e => { if (!ctxEl.hidden && !ctxEl.contains(e.target)) hideMenu(); }, true);
  const newBody = (type) => { APP.snap(); const b = APP.addBody(type); S.sel = { t: 'body', id: b.id }; APP.changed({ tree: true, right: true }); return b; };
  const visItems = (k) => [{ sep: 1 }, { label: 'Show all', fn: () => setGroupVis(k, true) }, { label: 'Hide all', fn: () => setGroupVis(k, false) }];
  /* ---- organisation groups ---- */
  function newGrp(k, item) {
    return { label: item ? 'New group with this item…' : 'New group', fn: () => {
      const g = APP.addGroup(k); if (item) APP.setItemGroup(item.t, item.o, g.id);
      S.renG = g.id; APP.changed({ tree: true });
    } };
  }
  function moveItems(t, o) {
    const k = APP.catOf(t, o), m = [{ sep: 1 }];
    for (const g of APP.groups().filter(x => x.k === k && x.id !== o.grp)) m.push({ label: 'Move to group: ' + g.name, fn: () => { APP.setItemGroup(t, o, g.id); APP.changed({ tree: true }); } });
    m.push(newGrp(k, { t, o }));
    if (o.grp && APP.getGroup(o.grp)) m.push({ label: 'Remove from group', fn: () => { APP.setItemGroup(t, o, 0); APP.changed({ tree: true }); } });
    return m;
  }
  function grpMenu(id) {
    const g = APP.getGroup(id); if (!g) return [];
    return [{ label: 'Rename…', fn: () => { S.renG = id; renderLeft(); } },
      { label: 'Show all', fn: () => { APP.setGroupVisible(g, true); APP.changed({ tree: true, csys: g.k === 'csys', measures: g.k === 'measures' }); } },
      { label: 'Hide all', fn: () => { APP.setGroupVisible(g, false); APP.changed({ tree: true, csys: g.k === 'csys', measures: g.k === 'measures' }); } },
      { sep: 1 }, { label: 'Delete group (items are kept)', danger: true, fn: () => { APP.deleteGroup(id); APP.changed({ tree: true }); } }];
  }
  function groupMenu(k) {
    switch (k) {
      case 'meshes': return [{ label: 'Import STL / OBJ…', fn: () => $('#fileStl').click() }, newGrp(k)].concat(visItems(k));
      case 'csys': return [
        { label: 'New coordinate system (child of active)', fn: () => { const c = APP.createCsysWorld(APP.csysWorld(S.model.active || 0)); if (c) selectItem('csys', c.id); } },
        { label: 'New from 3 points in the view…', fn: () => setTool('csys3') },
        { label: 'Make Global the active system', fn: () => APP.setActiveCsys(0) }, newGrp(k)].concat(visItems(k));
      case 'planes': return [
        { label: 'New PLA (point + normal)', fn: () => newBody('PLA') }, { label: 'New XYP (Z = const)', fn: () => newBody('XYP') },
        { label: 'New XZP (Y = const)', fn: () => newBody('XZP') }, { label: 'New YZP (X = const)', fn: () => newBody('YZP') },
        { label: 'PLA from a mesh face…', fn: () => setTool('plane') }, newGrp(k)].concat(visItems(k));
      case 'bodies': return ['RPP', 'SPH', 'RCC', 'TRC', 'XCC', 'YCC', 'ZCC'].map(t => ({ label: 'New ' + FK.BODY_TYPES[t].label, fn: () => newBody(t) }))
        .concat([{ label: 'RPP from 2 points in the view…', fn: () => setTool('rpp') }, { label: 'Add void / blackhole envelope', fn: () => APP.addEnvelope() }, newGrp(k)]).concat(visItems(k));
      case 'regions': return [{ label: 'New region', fn: () => { APP.snap(); const r = APP.addRegion(null, '', { visible: true }); S.sel = { t: 'region', id: r.id }; APP.changed({ tree: true, right: true }); } }, newGrp(k)].concat(visItems(k));
      case 'measures': return [{ label: 'Measure a distance…', fn: () => setTool('measure') }, newGrp(k), { label: 'Delete all measures', danger: true, fn: () => { APP.snap(); S.measures = []; APP.changed({ tree: true, measures: true, right: true }); } }].concat(visItems(k));
    }
    return [];
  }
  function itemMenu(t, id) {
    const o = findItem(t, id), m = itemMenuBase(t, id); if (!o) return m;
    let i = m.length - 1; while (i > 0 && !m[i].sep) i--;       // insert before the last separator (Delete)
    return m.slice(0, i).concat(moveItems(t, o), m.slice(i));
  }
  function itemMenuBase(t, id) {
    const o = findItem(t, id); if (!o) return [];
    const sel = () => { S.sel = { t, id }; };
    const toggle = { label: o.visible ? 'Hide' : 'Show', fn: () => { APP.snap(); o.visible = !o.visible; APP.changed({ tree: true, csys: t === 'csys', measures: t === 'measure' }); } };
    const rename = { label: 'Rename…', fn: () => { selectItem(t, id); setDrawer('right', true); setTimeout(() => { const i = $('#rightBody [data-k=name]'); if (i) { i.focus(); i.select(); } }, 60); } };
    const del = { label: t === 'stl' ? 'Remove' : 'Delete', danger: true, fn: () => { sel(); APP.deleteSel(); } };
    switch (t) {
      case 'body': {
        const m = [rename, toggle, { label: 'Duplicate', fn: () => { const c = APP.duplicateBody(o); S.sel = { t: 'body', id: c.id }; APP.changed({ tree: true, right: true }); } },
          { label: 'New region from this body', fn: () => { APP.snap(); const r = APP.addRegion(APP.regionNameFor(o.name), '+' + o.name, { visible: true }); S.sel = { t: 'region', id: r.id }; APP.changed({ tree: true, right: true }); } }];
        if (FK.isPlaneType(o.type)) m.push({ label: 'Section view at this plane', fn: () => APP.cutUsePlane(o.id) });
        if (o.type === 'PLA') m.push({ label: 'Re-pick from a mesh face…', fn: () => { S.reassign = o.id; setTool('replane'); } });
        return m.concat([{ sep: 1 }, del]);
      }
      case 'region': return [rename, toggle, { label: 'Duplicate', fn: () => { const c = APP.duplicateRegion(o); S.sel = { t: 'region', id: c.id }; APP.changed({ tree: true, right: true }); } },
        { label: 'Combine with another region… (A − B, A ∩ B, A ∪ B) (experimental)', fn: () => openBoolDlg(o) },
        { label: 'Create void region around this one… (experimental)', fn: () => openVoidDlg(o) }, { sep: 1 }, del];
      case 'csys': return [rename, toggle, { label: 'Set as active', fn: () => APP.setActiveCsys(o.id) },
        { label: APP.exportCs() === o.id ? 'Stop using as export coordinate system' : 'Use as export coordinate system (INP)', fn: () => APP.setExportCsys(APP.exportCs() === o.id ? 0 : o.id) },
        { label: 'New child coordinate system', fn: () => { const c = APP.createCsysWorld(APP.csysWorld(o.id), { parent: o.id }); if (c) selectItem('csys', c.id); } },
        { label: o.frozen ? 'Unfreeze (follow parent)' : 'Freeze (keep world pose)', fn: () => APP.setCsysFrozen(o, !o.frozen) },
        { label: 'Section view (XY plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':xy') },
        { label: 'Section view (XZ plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':xz') },
        { label: 'Section view (YZ plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':yz') },
        { label: 'Duplicate', fn: () => APP.duplicateCsys(o) }, { sep: 1 }, del];
      case 'stl': return [rename, toggle, { label: 'Detect features… (experimental)', fn: () => openFeatDlg(o) }, { label: 'Bounding RPP', fn: () => { if (o.stats && o.stats.bbox) APP.rppFromBox(o.stats.bbox); } }, { sep: 1 }, del];
      case 'measure': return [toggle, { label: 'RPP from these 2 points', fn: () => APP.createRpp(o.a, o.b) }, { sep: 1 }, del];
    }
    return [];
  }
  $('#leftBody').addEventListener('contextmenu', e => {
    const item = e.target.closest('.item[data-t]'), th = e.target.closest('.th'), gr = e.target.closest('.grow');
    if (gr) { e.preventDefault(); showMenu(e.clientX, e.clientY, grpMenu(+gr.dataset.gid)); }
    else if (item) { e.preventDefault(); showMenu(e.clientX, e.clientY, itemMenu(item.dataset.t, +item.dataset.id)); }
    else if (th) { e.preventDefault(); showMenu(e.clientX, e.clientY, groupMenu(th.dataset.g)); }
  });

  $('#leftBody').addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    const item = e.target.closest('.item');
    const a = act && act.dataset.act;
    if (a === 'fold') { const k = act.dataset.k; treeState()[k] = !isOpen(k); if (/^cs\d+$/.test(k)) treeState()[k] = treeState()[k]; APP.save(); renderLeft(); return; }
    if (a === 'gfold') { const g = APP.getGroup(+act.dataset.gid); if (g) { g.open = g.open === false; APP.save(); renderLeft(); } return; }
    if (a === 'grpvis') { const g = APP.getGroup(+act.dataset.gid); if (g) { APP.setGroupVisible(g, !APP.groupMembers(g).some(o => o.visible)); APP.changed({ tree: true, csys: g.k === 'csys', measures: g.k === 'measures' }); } return; }
    if (a === 'grpmenu') { const r = act.getBoundingClientRect(); showMenu(r.left - 140, r.bottom + 2, grpMenu(+act.dataset.gid)); return; }
    if (!act && e.target.closest('.grow') && !e.target.closest('input')) { const g = APP.getGroup(+e.target.closest('.grow').dataset.gid); if (g) { g.open = g.open === false; APP.save(); renderLeft(); } return; }
    if (a === 'gvis') { const k = act.dataset.g; setGroupVis(k, !groupItems(k).some(o => o.visible)); return; }
    if (a === 'gmenu') { const r = act.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, groupMenu(act.dataset.g)); return; }
    if (a === 'imenu' && item) { const r = act.getBoundingClientRect(); showMenu(r.left - 140, r.bottom + 2, itemMenu(item.dataset.t, +item.dataset.id)); return; }
    if (a === 'vis' && item) {
      const o = findItem(item.dataset.t, +item.dataset.id);
      if (o) { APP.snap(); o.visible = !o.visible; APP.changed({ tree: true, csys: item.dataset.t === 'csys', measures: item.dataset.t === 'measure' }); }
      return;
    }
    if (a === 'activate') { APP.setActiveCsys(+act.dataset.cid); return; }
    if (a === 'op') return;
    if (item && item.dataset.t && !e.target.closest('input')) { selectItem(item.dataset.t, +item.dataset.id); return; }
    if (!act) return;
    switch (a) {
      case 'addStl': $('#fileStl').click(); break;
      case 'importInp': openImport(); break;
      case 'newModel': newProject(); break;
    }
  });
  $('#leftBody').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.act !== 'op') return;
    const item = t.closest('.item'); const o = findItem(item.dataset.t, +item.dataset.id); if (!o) return;
    o.opacity = (+t.value) / 100;
    item.querySelector('small').textContent = t.value + '%';
    if (S.sel && S.sel.t === item.dataset.t && S.sel.id === +item.dataset.id) syncRightStyle();
    APP.applyStyles(); clearTimeout(saveT); saveT = setTimeout(APP.save, 400);
  });
  /* ---- group rename ---- */
  function commitGroupName(inp, cancel) {
    const g = APP.getGroup(+inp.dataset.gid); S.renG = 0;
    if (g && !cancel && inp.value.trim() && inp.value.trim() !== g.name) { APP.snap(); g.name = inp.value.trim().slice(0, 40); }
    APP.changed({ tree: true });
  }
  $('#leftBody').addEventListener('keydown', e => { if (!e.target.classList.contains('gname')) return; if (e.key === 'Enter') { e.preventDefault(); commitGroupName(e.target); } else if (e.key === 'Escape') { e.stopPropagation(); commitGroupName(e.target, true); } });
  $('#leftBody').addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('gname') && S.renG) commitGroupName(e.target); });

  /* ---- drag & drop of items between groups (same category only) ---- */
  let dragItem = null;
  const clearDrop = () => $$('#leftBody .dropt').forEach(n => n.classList.remove('dropt'));
  /** drop target under the pointer: {el, gid, k} or null */
  function dropTarget(e) {
    if (!dragItem) return null;
    const gEl = e.target.closest('.grow, .gb'), tg = e.target.closest('.tg');
    if (gEl) return { el: gEl, gid: +gEl.dataset.gid, k: gEl.dataset.k };
    if (tg) return { el: tg.querySelector('.tb') || tg, gid: 0, k: tg.dataset.k };
    return null;
  }
  $('#leftBody').addEventListener('dragstart', e => {
    const it = e.target.closest && e.target.closest('.item[data-t]'); if (!it || !it.dataset.id) return;
    const o = findItem(it.dataset.t, +it.dataset.id); if (!o) return;
    dragItem = { t: it.dataset.t, o, k: APP.catOf(it.dataset.t, o) };
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', o.name); } catch (err) { /* ignore */ } }
    it.classList.add('dragging');
  });
  $('#leftBody').addEventListener('dragover', e => {
    const d = dropTarget(e); if (!d || d.k !== dragItem.k) return;
    e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearDrop(); d.el.classList.add('dropt');
  });
  $('#leftBody').addEventListener('dragleave', e => { if (!e.relatedTarget || !$('#leftBody').contains(e.relatedTarget)) clearDrop(); });
  $('#leftBody').addEventListener('drop', e => {
    const d = dropTarget(e); clearDrop();
    if (!d || d.k !== dragItem.k) { dragItem = null; return; }
    e.preventDefault();
    const { t, o } = dragItem; dragItem = null;
    if ((o.grp || 0) !== d.gid && APP.setItemGroup(t, o, d.gid)) APP.changed({ tree: true });
  });
  $('#leftBody').addEventListener('dragend', () => { dragItem = null; clearDrop(); $$('#leftBody .dragging').forEach(n => n.classList.remove('dragging')); });

  function findItem(t, id) { return { body: APP.getBody, region: APP.getRegion, stl: APP.getStl, measure: APP.getMeasure, csys: APP.getCsys }[t](id); }

  /* ---------- Right panel ---------- */
  const loc = (p) => APP.toLocal(p);
  const locRows = (rows) => S.model.active ? rows.map(r => [r[0] + ' <small class="muted">(' + esc(APP.csysLabel(S.model.active)) + ')</small>', xyz(loc(r[1]), 4)]) : [];
  function pkText(pk) {
    switch (pk.kind) {
      case 'point': { const p = loc(pk.p); return `${fmt(p[0], 6)} ${fmt(p[1], 6)} ${fmt(p[2], 6)}`; }
      case 'edge': { const a = loc(pk.a), b = loc(pk.b); return `${fmt(a[0], 6)} ${fmt(a[1], 6)} ${fmt(a[2], 6)} ${fmt(b[0], 6)} ${fmt(b[1], 6)} ${fmt(b[2], 6)}`; }
      case 'face': { const p = APP.planeFromPick(pk).p; return 'PLA ' + p.map(x => fmt(x, 6)).join(' '); }
    }
    return '';
  }
  function pickCardHTML(pk) {
    if (!pk) return '';
    let h = '<div class="card">', acts = '';
    switch (pk.kind) {
      case 'point':
        h += `<h5>${pk.snapped ? 'Sommet' : 'Point on surface'} · ${esc(pk.ownerName)}</h5>` + kv([['X', cmmm(pk.p[0])], ['Y', cmmm(pk.p[1])], ['Z', cmmm(pk.p[2])]].concat(locRows([['Local', pk.p]])));
        acts = '<button class="btn sm" data-act="copyPick">Copy X Y Z</button><button class="btn sm" data-act="pickCsysPoint">Csys here</button>'; break;
      case 'edge':
        if (pk.none) { h += '<h5>Edge</h5><div class="muted">No sharp edge nearby: click closer to an edge or disable "sharp edges only".</div>'; break; }
        h += `<h5>Edge · ${esc(pk.ownerName)}</h5>` + kv([
          [pk.chain ? 'Length (straight)' : 'Length', cmmm(pk.chain ? pk.chain.length : pk.length)],
          ...(pk.chain ? [['Segments', String(pk.chain.segments)], ['Clicked segment', cm(pk.length)]] : []),
          ['Start', xyz(pk.chain ? pk.chain.a : pk.a, 3)], ['End', xyz(pk.chain ? pk.chain.b : pk.b, 3)],
          ['Δ', xyz(V.sub(pk.chain ? pk.chain.b : pk.b, pk.chain ? pk.chain.a : pk.a), 3)]].concat(locRows([['Start', pk.chain ? pk.chain.a : pk.a], ['End', pk.chain ? pk.chain.b : pk.b]])));
        acts = '<button class="btn sm" data-act="copyPick">Copy A B</button>'; break;
      case 'face': {
        const n = pk.normal, d = V.dot(n, pk.centroid), bb = pk.bbox;
        h += `<h5>Face · ${esc(pk.ownerName)}</h5>` + kv([
          ['Area', `${f(pk.area, 5)} cm²`], ['Triangles', String(pk.count)],
          ['Normal (outward)', xyz(n, 5)], ['Center', xyz(pk.centroid, 4)],
          ['Plane', `n·x = ${f(d, 5)}`], ['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)]].concat(locRows([['Center', pk.centroid]])));
        acts = '<button class="btn sm primary" data-act="pickPlane">Create PLA</button><button class="btn sm" data-act="pickCsysFace">Csys on face</button><button class="btn sm" data-act="pickRppFace">RPP around face</button><button class="btn sm" data-act="copyPick">Copy PLA card</button>'; break;
      }
      case 'object': {
        const st = APP.objectStats(pk), bb = st.bbox;
        h += `<h5>Object · ${esc(pk.ownerName)} <small class="muted">${esc(pk.ownerKind)}</small></h5>` + kv([
          ['Volume', st.volume !== undefined && st.volume !== null ? `${f(st.volume, 4)} cm³` : '—'], ['Area', st.area ? `${f(st.area, 4)} cm²` : '—'],
          ...(st.count ? [['Triangles', String(st.count)]] : []),
          ...(bb ? [['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)]] : []),
          ...(st.centroid ? [['Center', xyz(st.centroid, 3)]] : [])]);
        acts = bb ? '<button class="btn sm primary" data-act="pickRppObj">Bounding RPP</button>' : ''; break;
      }
    }
    return h + `<div class="btns">${acts}<button class="btn sm" data-act="clearPick">Close</button></div></div>`;
  }

  function numField(label, attr, val) { return `<div class="fld"><label>${label}</label><input type="number" step="any" value="${esc(fmt(val, 6))}" ${attr}></div>`; }
  function commonStyle(o, withEdge) {
    return `<div class="row2"><span class="muted">Color</span><input type="color" data-k="color" value="${esc(o.color)}">
      <label class="chk" style="margin:0 0 0 auto"><input type="checkbox" data-k="visible" ${o.visible ? 'checked' : ''}>Visible</label></div>
      <div class="row2"><span class="muted">Opacity</span><input type="range" min="0" max="100" value="${Math.round(o.opacity * 100)}" data-k="opacity"></div>`;
  }

  function liveInfoHTML() {
    const it = APP.selItem(); if (!it || !S.sel) return '';
    const t = S.sel.t;
    if (t === 'body') {
      if (it.type === 'RAW') return '<div class="muted">Card not interpreted (kept as-is in the .inp file).</div>';
      const wb = APP.wbody(it), bb = FK.bodyBBox(wb), vol = FK.bodyVolume(wb), rows = [];
      if (it.cs) rows.push(['Frame', esc(APP.csysLabel(it.cs)) + ' <small class="muted">(values below: world)</small>']);
      if (bb) { rows.push(['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)], ['Center', xyz(FK.boxCenter(bb), 3)]); }
      if (vol !== null) rows.push(['Volume', `${f(vol, 4)} cm³`]);
      if (FK.isPlaneType(it.type)) {
        const pl = FK.planeOf(wb), n = V.norm(pl.H);
        rows.push(['Unit normal (H)', xyz(n, 5)], ['Equation', `n·x = ${f(V.dot(n, pl.V), 5)}`], ['Inside', 'side opposite to H']);
      }
      const c = APP.bodyCache.get(it.id); if (c && c.err) rows.push(['Error', esc(c.err)]);
      return kv(rows);
    }
    if (t === 'region') {
      const c = APP.regionCache.get(it.id); if (!c || !c.polys) return c && c.err ? `<div class="msg bad">${esc(c.err)}</div>` : '<div class="muted">Computing…</div>';
      const bb = c.bbox;
      return kv([['Volume', `${f(c.vol, 4)} cm³`], ['Surface area', `${f(c.area, 4)} cm²`],
        ...(bb ? [['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)]] : [])]) +
        '<div class="muted" style="font-size:11.5px;margin-top:4px" title="Volume computed inside the render zone; spheres / cylinders are faceted (approximate display).">ⓘ approximate volume</div>';
    }
    if (t === 'stl') {
      const st = it.stats; if (!st || !st.bbox) return '';
      return kv([['Triangles', String(st.count)], ['Volume', `${f(st.volume, 4)} cm³`], ['Area', `${f(st.area, 4)} cm²`],
        ['Box min', xyz(st.bbox.min, 3)], ['Box max', xyz(st.bbox.max, 3)], ['Dimensions', xyz(V.sub(st.bbox.max, st.bbox.min), 3)], ['Centre of mass', xyz(st.centroid, 3)]]);
    }
    if (t === 'measure') {
      const d = V.sub(it.b, it.a);
      return kv([['Distance', cmmm(V.len(d))], ['ΔX', cm(d[0])], ['ΔY', cm(d[1])], ['ΔZ', cm(d[2])], ['Point A', xyz(it.a, 4)], ['Point B', xyz(it.b, 4)]]);
    }
    return '';
  }
  /** First sentence of a diagnostic (the advice that follows goes in a tooltip). */
  const brief = (t) => String(t).split(/\.\s+(?=[A-Z+\-(])/)[0].replace(/\.$/, '');
  function regionMsg(r) {
    try {
      const ast = FK.parseExpr(r.expr || '+x');
      if (!r.expr.trim()) return '<div class="msg bad">Empty expression</div>';
      const missing = Array.from(FK.exprNames(ast)).filter(n => !S.model.bodies.some(b => b.name === n));
      if (missing.length) return `<div class="msg bad">Unknown body: ${esc(missing.join(', '))}</div>`;
      const c = APP.regionCache.get(r.id);
      if (c && c.err) return `<div class="msg bad">${esc(c.err)}</div>`;
      if (c && c.polys && (!c.polys.length || (c.vol !== null && c.vol !== undefined && c.vol < 1e-9))) {
        const dg = c.diag || [];
        if (!dg.length) return '<div class="msg bad">Empty region (no single cause found).</div>';
        return '<div class="msg bad"><b>Empty region.</b>' + dg.map(d => `<div class="dg">${esc(brief(d.text))}${d.text !== brief(d.text) ? ` <span class="wicon info" tabindex="0" title="${esc(d.text)}">ⓘ</span>` : ''}` +
          (d.fix ? `<div><button class="btn sm" data-act="applyFix" data-rid="${r.id}" data-expr="${esc(d.fix.expr)}" title="${esc(d.fix.expr)}">${esc(d.fix.label)}: ${esc(d.fix.expr)}</button></div>` : '') + '</div>').join('') + '</div>';
      }
      const q = (c && c.quality) || [];
      return '<div class="msg ok">Valid expression' + (q.length ? ` <span class="wicon" tabindex="0" title="${esc(q.map(x => x.text).join('\n'))}">⚠${q.length > 1 ? q.length : ''}</span>` : '') + '</div>';
    } catch (e) { return `<div class="msg bad">${esc(e.message)}</div>`; }
  }
  /** Keeps the style controls of the properties panel in step with changes made elsewhere (tree slider, eye…), without re-rendering it. */
  function syncRightStyle() {
    const it = APP.selItem(); if (!it || !S.sel) return;
    const set = (k, fn) => { const el = $('#rightBody [data-k="' + k + '"]'); if (el && document.activeElement !== el) fn(el); };
    if (it.opacity !== undefined) set('opacity', el => { el.value = Math.round(it.opacity * 100); });
    set('visible', el => { el.checked = !!it.visible; });
    if (it.color) set('color', el => { el.value = it.color; });
  }
  function updateLive() {
    const li = $('#liveInfo'); if (li) li.innerHTML = liveInfoHTML();
    const em = $('#exprMsg'); const it = APP.selItem();
    if (em && S.sel && S.sel.t === 'region' && it) {
      em.innerHTML = regionMsg(it);
      const ta = $('#exprArea'); if (ta) ta.classList.toggle('bad', !!em.querySelector('.bad'));
    }
  }

  function scaleSection() {
    const sc = S.opt.scale, open = !!S.opt.scaleOpen;
    return `<label class="chk"><input type="checkbox" data-opt="scaleOpen" ${open ? 'checked' : ''}>Scale / margin about the centre</label>
      <div class="scalebox" ${open ? '' : 'hidden'}>
      <div class="row2"><select data-sc="mode"><option value="margin" ${sc.mode === 'margin' ? 'selected' : ''}>Margin all around (+ grows, − shrinks)</option><option value="pct" ${sc.mode === 'pct' ? 'selected' : ''}>Scale in %</option></select></div>
      <div class="row2"><input type="number" step="any" value="${sc.val}" data-sc="val"><select data-sc="unit" style="max-width:80px" ${sc.mode === 'pct' ? 'disabled' : ''}><option value="mm" ${sc.unit === 'mm' ? 'selected' : ''}>mm</option><option value="cm" ${sc.unit === 'cm' ? 'selected' : ''}>cm</option></select></div>
      <div class="btns"><button class="btn" data-act="scale">Apply</button><button class="btn" data-act="scaleDup">Duplicate + apply</button></div>
      <div class="muted" style="font-size:11.5px">Planes: the margin shifts the plane outward (along H). 120 % = grow by 20 %.</div></div>`;
  }
  /** Tabs of the properties panel: all panes stay in the DOM (hidden), so live updates keep working. */
  function tabbed(p) {
    const names = { general: 'General', view: 'View', definition: 'Definition', operations: 'Operations' };
    const avail = Object.keys(names).filter(k => p[k]);
    const cur = avail.includes(S.rtab) ? S.rtab : avail[0];
    return `<div class="rtabs" role="tablist">${avail.map(k => `<button class="rtab${k === cur ? ' on' : ''}" role="tab" data-act="rtab" data-tab="${k}">${names[k]}</button>`).join('')}</div>` +
      avail.map(k => `<div class="rpane" data-pane="${k}" ${k === cur ? '' : 'hidden'}>${p[k]}</div>`).join('');
  }

  /** "Export to the INP" checkbox (+ an info sign when nothing uses the body). */
  function exportRow(it, kind) {
    const unused = kind === 'body' && !APP.bodyUsed(it);
    return `<div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-k="exportInp" ${it.noExport ? '' : 'checked'}>Export to the INP file</label>${unused ? ` <span class="wicon info" tabindex="0" title="Not used by any region">ⓘ not used</span>` : ''}</div>`;
  }
  function bodyProps(b) {
    const info = FK.BODY_TYPES[b.type];
    let h = '';
    if (b.type === 'RAW') h += `<div class="fld full"><label>Card kept as-is</label><textarea class="expr" readonly>${esc((b.raw || []).join('\n'))}</textarea></div>`;
    else if (APP.FIELD_GROUPS[b.type]) {
      APP.FIELD_GROUPS[b.type].forEach((g, gi) => {
        const on = S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.only === undefined;
        h += `<div class="fld full grp"><div class="gh"><label>${g.l}</label><span class="pks">${g.pick ? `<button class="pk${on && S.fill.alt === undefined ? ' on' : ''}" data-act="pickField" data-g="${gi}" title="Pick the whole group in the 3D view" aria-label="Pick in the 3D view">⌖</button>` : ''}${(g.alts || []).map((al, ai) => `<button class="pk${S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.alt === ai ? ' on' : ''}" data-act="pickField" data-g="${gi}" data-alt="${ai}" title="${esc(al.title)}" aria-label="${esc(al.title)}">${al.icon}</button>`).join('')}${g.pick && g.pick.kind === 'vec' ? `<button class="pk" data-act="flipVec" data-g="${gi}" title="Reverse the vector (H → −H)" aria-label="Reverse the vector">⇄</button>` : ''}</span></div>
          <div class="gN" style="grid-template-columns:repeat(${Math.min(g.idx.length, 3)},1fr)">${g.idx.map((i, ii) => {
            const canOne = g.pick && g.pick.kind !== 'radius' && g.idx.length > 1;
            const onOne = S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.only === ii;
            return `<div class="fld"><div class="fl"><label>${info.fields[i]}</label>${canOne ? `<button class="pk sm${onOne ? ' on' : ''}" data-act="pickField" data-g="${gi}" data-i="${ii}" title="Pick this coordinate only" aria-label="Pick ${info.fields[i]} only">⌖</button>` : ''}</div><input type="number" step="any" value="${esc(fmt(b.p[i], 6))}" data-bf="${i}"></div>`;
          }).join('')}</div></div>`;
      });
    } else info.fields.forEach((fl, i) => { h += numField(fl, `data-bf="${i}"`, b.p[i]); });
    const defFields = h; h = '';
    if (b.type !== 'RAW' || S.model.csys.length) {
      h += `<div class="fld full"><label>Defined in coordinate system</label><select data-k="bcs"><option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${b.cs === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-opt="keepPos" ${S.opt.keepPos === true ? 'checked' : ''}>Keep the position when changing frame (recomputes the parameters)</label></div>`;
    }
    const csHTML = h; h = '';
    let inpLine = '';
    if (b.type !== 'RAW') {
      const xb = APP.xbody(b), ex = APP.exportCs();
      inpLine = `<div class="fld full"><div class="muted" style="font-size:12px">In the INP (frame: ${esc(APP.csysLabel(ex))}): <code>${esc(xb.type)} ${esc(xb.p.map(x => +(+x).toFixed(5)).join(' '))}</code></div></div>`;
    }
    let planeBtns = '';
    if (b.type === 'PLA') {
      const src = b.meta && b.meta.src;
      planeBtns = `<div class="btns"><button class="btn sm" data-act="flipPlane">Flip direction (H → −H)</button><button class="btn sm" data-act="replane">Recompute from a face…</button></div>`;
      if (src) { const o = src.kind === 'stl' ? APP.getStl(src.id) : null; planeBtns += `<div class="muted" style="font-size:12px">Source: triangle #${src.tri}${o ? ' of ' + esc(o.name) : ''}</div>`; }
    }
    const general = `<div class="sec"><h4><span>Body · ${esc(b.type === 'RAW' ? b.rawType : b.type)}</span></h4><div class="fields">
      <div class="fld full"><label>Name (max 8 characters for FLUKA)</label><input type="text" data-k="name" value="${esc(b.name)}"></div>${exportRow(b, 'body')}${csHTML}</div></div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
    const definition = `<div class="sec"><h4><span>Geometric definition</span></h4><div class="fields">${defFields}${inpLine}</div>${planeBtns}</div>`;
    const view = b.type !== 'RAW' ? `<div class="sec"><h4><span>View</span></h4>${commonStyle(b)}</div>` : null;
    const operations = `<div class="sec"><h4><span>Operations</span></h4>${b.type !== 'RAW' ? scaleSection() : ''}
      <div class="btns"><button class="btn" data-act="dup">Duplicate</button></div>
      <div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
    return tabbed({ general, view, definition, operations });
  }
  function csysWorldHTML(c) {
    const w = APP.csysWorld(c.id), e = FK.M.toEuler(w);
    return kv([['Position (world)', xyz([w[3], w[7], w[11]], 5)], ['Angles (world)', xyz(e, 4) + '°'], ['Axe X', xyz([w[0], w[4], w[8]], 5)], ['Axe Y', xyz([w[1], w[5], w[9]], 5)], ['Axe Z', xyz([w[2], w[6], w[10]], 5)]]);
  }
  function cf(kind, i, val) { return `<input type="number" step="any" data-cf="${kind}:${i}" value="${esc(fmt(val, 6))}">`; }
  function csysProps(c) {
    const m = c.m, e = FK.M.toEuler(m);
    const parents = [`<option value="0">Global (0,0,0)</option>`].concat(S.model.csys.filter(x => x.id !== c.id && !APP.isDescendant(x.id, c.id)).map(x => `<option value="${x.id}" ${c.parent === x.id ? 'selected' : ''}>${esc(x.name)}</option>`)).join('');
    const kids = APP.csysChildren(c.id), nb = S.model.bodies.filter(b => b.cs === c.id).length;
    const grid3 = (label, kind, v) => `<div class="fld full"><label>${label}</label><div class="g3">${[0, 1, 2].map(i => cf(kind, i, v[i])).join('')}</div></div>`;
    const general = `<div class="sec"><h4><span>Coordinate system</span></h4><div class="fields">
      <div class="fld full"><label>Name</label><input type="text" data-k="name" value="${esc(c.name)}"></div>
      <div class="fld full"><label>Defined relative to</label><select data-k="cparent">${parents}</select></div>
      <div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-k="cfrozen" ${c.frozen ? 'checked' : ''}>Freeze: does not follow its parent (keeps its world pose)</label></div>
      </div>
      <div class="muted" style="font-size:12px;margin:2px 0 6px">Unless frozen, this system moves with its parent. ${kids.length ? kids.length + ' child system(s) (' + kids.filter(k => k.frozen).length + ' frozen). ' : ''}${nb ? nb + ' body(ies) defined in this system.' : ''}</div></div>`;
    const definition = `<div class="sec"><h4><span>Position and orientation</span></h4>
      <div class="muted" style="font-size:12px">Relative to the parent system.</div><div>
        <div class="fld full grp"><div class="gh"><label>Position X, Y, Z (cm)</label><button class="pk${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === undefined ? ' on' : ''}" data-act="pickCsysPos" title="Pick the whole origin in the 3D view" aria-label="Pick the origin">⌖</button></div><div class="g3">${[0, 1, 2].map(i => `<div class="fld"><div class="fl"><label>${'XYZ'[i]}</label><button class="pk sm${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === i ? ' on' : ''}" data-act="pickCsysPos" data-i="${i}" title="Pick this coordinate only">⌖</button></div>${cf('pos', i, [m[3], m[7], m[11]][i])}</div>`).join('')}</div></div>
        ${grid3('Angles α, β, γ (°) — R = Rz(γ)·Ry(β)·Rx(α)', 'eul', e)}
        ${grid3('X axis vector', 'xa', [m[0], m[4], m[8]])}
        ${grid3('Approx. Y axis vector (Z = X × Y)', 'ya', [m[1], m[5], m[9]])}
      </div>
      <details class="fold"><summary>3×4 matrix (rotation | translation)</summary><div>
        <div class="g4">${[0, 1, 2].map(r => [0, 1, 2, 3].map(q => cf('cm', r * 4 + q, m[r * 4 + q])).join('')).join('')}</div>
        <div class="muted" style="font-size:12px">p_parent = R·p + t. Must be a proper rotation (orthonormal, determinant +1).</div></div></details>
      <details class="fold"><summary>World values</summary><div id="csysWorld">${csysWorldHTML(c)}</div></details>
</div>`;
    const view = `<div class="sec"><h4><span>View</span></h4><div class="row2"><span class="muted">Color</span><input type="color" data-k="color" value="${esc(c.color)}"><label class="chk" style="margin:0 0 0 auto"><input type="checkbox" data-k="visible" ${c.visible ? 'checked' : ''}>Visible</label></div></div>`;
    const operations = `<div class="sec"><h4><span>Operations</span></h4>
      <div class="btns"><button class="btn primary" data-act="csysActivate">${S.model.active === c.id ? '● Active system' : 'Set as active'}</button>
      <button class="btn${APP.exportCs() === c.id ? ' primary' : ''}" data-act="csysExport" title="The INP file is written in this frame (only one)">${APP.exportCs() === c.id ? '⇥ Export system (click to unset)' : 'Use as export system'}</button>
      <button class="btn" data-act="csysCut" data-pl="xy">Section XY</button><button class="btn" data-act="csysCut" data-pl="xz">Section XZ</button><button class="btn" data-act="csysCut" data-pl="yz">Section YZ</button>
      <button class="btn" data-act="dup">Duplicate</button></div>
      <div class="btns opsdel"><button class="btn danger" data-act="del" title="The children are re-attached to the parent; the bodies keep their place">Delete</button></div></div>`;
    return tabbed({ general, view, definition, operations });
  }
  let csysSrc = null;
  function updateCsysFields(force) {
    const c = APP.selItem(); if (!c || !S.sel || S.sel.t !== 'csys') return;
    const m = c.m, vals = { pos: [m[3], m[7], m[11]], eul: FK.M.toEuler(m), xa: [m[0], m[4], m[8]], ya: [m[1], m[5], m[9]], cm: m };
    $$('#rightBody [data-cf]').forEach(inp => {
      const [k, i] = inp.dataset.cf.split(':');
      if (csysSrc === 'pe' && (k === 'pos' || k === 'eul')) return;
      if (!force && inp === document.activeElement) return;
      inp.value = fmt(vals[k][+i], 6);
    });
    const w = $('#csysWorld'); if (w) w.innerHTML = csysWorldHTML(c);
    csysSrc = null;
  }
  function onCsysField(e, t, it) {
    const [kind] = t.dataset.cf.split(':');
    const read = (k) => $$(`#rightBody [data-cf^="${k}:"]`).map(x => parseFloat(x.value));
    const ok = (a) => a.every(isFinite);
    const M = FK.M;
    if (kind === 'pos' || kind === 'eul') {
      if (e.type !== 'input') return;
      const pos = read('pos'), eul = read('eul'); if (!ok(pos) || !ok(eul)) return;
      csysSrc = 'pe';
      APP.setCsysLocal(it, M.fromPosEuler(pos, eul), 'cs' + it.id + 'pe', true);
    } else if (kind === 'xa' || kind === 'ya') {
      if (e.type !== 'change') return;
      const xa = read('xa'), ya = read('ya'); if (!ok(xa) || !ok(ya)) { updateCsysFields(true); return; }
      const m = M.fromAxes([it.m[3], it.m[7], it.m[11]], xa, ya);
      if (!m) { toast('X and Y vectors are zero or collinear'); updateCsysFields(true); return; }
      APP.setCsysLocal(it, m, null, true);
    } else if (kind === 'cm') {
      if (e.type !== 'change') return;
      const m = read('cm');
      if (!ok(m) || !APP.setCsysLocal(it, m, null, true)) updateCsysFields(true);
    }
  }
  function regionProps(r) {
    const opts = S.model.bodies.map(b => `<option value="${esc(b.name)}">${esc(b.name)} (${esc(b.type === 'RAW' ? b.rawType : b.type)})</option>`).join('');
    const general = `<div class="sec"><h4><span>Region</span></h4><div class="fields">
      <div class="fld"><label>Name</label><input type="text" data-k="name" value="${esc(r.name)}"></div>
      <div class="fld"><label>Neighbour regions (2nd field)</label><input type="number" step="1" min="0" value="${r.nvois}" data-k="nvois"></div>${exportRow(r, 'region')}</div></div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
    const definition = `<div class="sec"><h4><span>Definition</span></h4><div class="fields">
      <div class="fld full"><label>Expression  (+ inside · − outside · | union · parentheses)</label><div class="exprwrap"><textarea class="expr" id="exprArea" data-k="expr" spellcheck="false">${esc(r.expr)}</textarea><div class="exprmirror" id="exprMirror" aria-hidden="true"></div></div></div></div>
      <div id="exprMsg">${regionMsg(r)}</div>
      <div class="row2"><select id="termBody"><option value="">— body —</option>${opts}</select></div>
      <div class="btns exprbtns"><button class="btn sm" data-act="termAdd" title="Insert +body at the cursor">+ add</button><button class="btn sm" data-act="termSub" title="Insert -body at the cursor">− subtract</button><button class="btn sm" data-act="termUnion" title="Insert the union symbol | at the cursor">| union</button><button class="btn sm" data-act="termParen" title="Insert a pair of parentheses at the cursor (wraps the selection)">( )</button><button class="btn sm" data-act="termDel" title="Remove every occurrence of the chosen body">remove</button></div></div>`;
    const view = `<div class="sec"><h4><span>View</span></h4>${commonStyle(r)}</div>`;
    const operations = `<div class="sec"><h4><span>Operations</span></h4>
      <div class="btns"><button class="btn" data-act="boolRegion" title="New region = this one minus / ∩ / ∪ another region, written with their bodies">Combine with another region… <small>(experimental)</small></button>
      <button class="btn" data-act="voidRegion" title="RPP around this region + region = RPP minus this one">Create void region… <small>(experimental)</small></button>
      <button class="btn" data-act="dup">Duplicate</button></div>
      <div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
    return tabbed({ general, view, definition, operations });
  }
  function stlProps(s) {
    const unitOpts = ['mm', 'cm', 'm', 'in'].map(u => `<option ${s.unit === u ? 'selected' : ''}>${u}</option>`).join('');
    const general = `<div class="sec"><h4><span>Mesh file</span></h4><div class="fields">
      <div class="fld full"><label>Name</label><input type="text" data-k="name" value="${esc(s.name)}"></div></div></div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
    const definition = `<div class="sec"><h4><span>Placement</span></h4><div class="fields">
      <div class="fld"><label>File unit</label><select data-k="unit">${unitOpts}</select></div>
      <div class="fld"><label>&nbsp;</label><label class="chk" style="margin:0"><input type="checkbox" data-k="flip" ${s.flip ? 'checked' : ''}>Flip normals</label></div>
      ${numField('Offset X (cm)', 'data-off="0"', s.offset[0])}${numField('Offset Y (cm)', 'data-off="1"', s.offset[1])}${numField('Offset Z (cm)', 'data-off="2"', s.offset[2])}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">Everything is converted to cm (FLUKA unit) on import. Mesh normals point out of the material.</div></div>`;
    const view = `<div class="sec"><h4><span>View</span></h4>${commonStyle(s)}
      <div class="row2"><label class="chk" style="margin:0"><input type="checkbox" data-k="edges" ${s.edges ? 'checked' : ''}>Sharp edges</label></div></div>`;
    const operations = `<div class="sec"><h4><span>Operations</span></h4>
      <div class="btns"><button class="btn" data-act="rppStl">Bounding RPP</button><button class="btn" data-act="detectFeat">Detect features… <small>(experimental)</small></button></div>
      <div class="btns opsdel"><button class="btn danger" data-act="del">Remove</button></div></div>`;
    return tabbed({ general, view, definition, operations });
  }
  function measureProps(m) {
    const general = `<div class="sec"><h4><span>Measure</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
    const operations = `<div class="sec"><h4><span>Operations</span></h4><div class="btns"><button class="btn" data-act="rppMeasure">RPP from these 2 points</button></div><div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
    return tabbed({ general, operations });
  }
  function renderRight() {
    let h = '';
    const it = APP.selItem();
    if (it && S.sel) {
      h += ({ body: bodyProps, region: regionProps, stl: stlProps, measure: measureProps, csys: csysProps })[S.sel.t](it);
    } else h += '<div class="empty" style="padding:6px 2px 14px">Select an item in the tree or click in the 3D view to show its properties.</div>';
    $('#rightBody').innerHTML = h;
    updateLive();
    if (it && S.sel && S.sel.t === 'region') initExprEditor();
    renderToolWin();
  }

  /* ---------- Region expression editor: insertion at the caret, always-visible caret ---------- */
  function exprEls() { return { ta: $('#exprArea'), mir: $('#exprMirror') }; }
  /** Mirror of the textarea showing a blinking caret while the textarea is not focused (e.g. when a body is being chosen in the list). */
  function updateExprMirror() {
    const { ta, mir } = exprEls(); if (!ta || !mir) return;
    const focused = document.activeElement === ta, st = S.exprSel || { s: ta.value.length, e: ta.value.length };
    const s0 = Math.min(st.s, ta.value.length), e0 = Math.min(st.e, ta.value.length);
    const sel = e0 > s0 ? `<span class="fs">${esc(ta.value.slice(s0, e0))}</span>` : '<span class="fc"></span>';
    mir.innerHTML = focused ? '' : esc(ta.value.slice(0, s0)) + sel + esc(ta.value.slice(e0)) + '\u200b';
    mir.scrollTop = ta.scrollTop;
  }
  function initExprEditor() {
    const { ta } = exprEls(); if (!ta) return;
    const keep = () => { S.exprSel = { s: ta.selectionStart, e: ta.selectionEnd }; };
    const st = S.exprSel && S.exprSel.id === S.sel.id ? S.exprSel : { id: S.sel.id, s: ta.value.length, e: ta.value.length };
    S.exprSel = st; try { ta.setSelectionRange(st.s, st.e); } catch (e) { /* ignore */ }
    for (const ev of ['select', 'keyup', 'click', 'input', 'mouseup']) ta.addEventListener(ev, () => { keep(); S.exprSel.id = S.sel && S.sel.id; updateExprMirror(); });
    ta.addEventListener('focus', updateExprMirror); ta.addEventListener('blur', () => { keep(); S.exprSel.id = S.sel && S.sel.id; updateExprMirror(); });
    ta.addEventListener('scroll', updateExprMirror);
    // the insertion buttons must not take the focus away from the expression (keeps the real caret visible)
    const bar = $('#rightBody .exprbtns'); if (bar) bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    updateExprMirror();
  }
  /** kind: 'term' (text = "+name" / "-name"), 'union', 'paren'. Inserted only at the caret (or replacing the selection). */
  function insertInExpr(kind, text) {
    const { ta } = exprEls(); const it = APP.selItem(); if (!ta || !it) return;
    const v = ta.value, st = S.exprSel || { s: v.length, e: v.length };
    const s0 = Math.min(st.s, v.length), e0 = Math.min(Math.max(st.e, st.s), v.length), before = v.slice(0, s0), mid = v.slice(s0, e0), after = v.slice(e0);
    const pre = before && !/[\s(]$/.test(before) ? ' ' : '', needPost = after ? !/^[\s)]/.test(after) : false;
    let ins, caret;
    if (kind === 'term') { ins = pre + text + (needPost ? ' ' : ''); caret = s0 + ins.length; }
    else if (kind === 'union') { ins = pre + '|' + (after && /^\s/.test(after) ? '' : ' '); caret = s0 + ins.length; }
    else if (mid) { ins = pre + '(' + mid + ')' + (needPost ? ' ' : ''); caret = s0 + pre.length + 1 + mid.length; }       // wrap the selection, caret before ')'
    else { ins = pre + '()' + (needPost ? ' ' : ''); caret = s0 + pre.length + 1; }                                      // caret between the parentheses
    APP.snap('expr' + it.id);
    ta.value = before + ins + after; it.expr = ta.value;
    S.exprSel = { id: it.id, s: caret, e: caret };
    ta.focus(); ta.setSelectionRange(caret, caret);
    APP.changed({}); updateExprMirror();
  }

  /* ---------- Property editing ---------- */
  function onField(e) {
    const t = e.target;
    const it = APP.selItem();
    if (t.dataset.opt === 'scaleOpen') { S.opt.scaleOpen = t.checked; const bx = $('#rightBody .scalebox'); if (bx) bx.hidden = !t.checked; APP.save(); return; }
    if (t.dataset.opt) return onOptChange(e);
    if (t.dataset.sc) {
      const sc = S.opt.scale, k = t.dataset.sc;
      if (k === 'val') { const v = parseFloat(t.value); if (isFinite(v)) sc.val = v; } else sc[k] = t.value;
      if (k === 'mode') { const u = $('[data-sc=unit]'); if (u) u.disabled = t.value === 'pct'; if (t.value === 'pct' && sc.val === 20) { sc.val = 120; $('[data-sc=val]').value = 120; } if (t.value === 'margin' && sc.val === 120) { sc.val = 20; $('[data-sc=val]').value = 20; } }
      APP.save(); return;
    }
    const k = t.dataset.k;
    if (k === 'title') { if (e.type === 'input') { APP.snap('title'); S.model.title = t.value; APP.changed({}); } return; }
    if (!it || !S.sel) return;
    const type = S.sel.t, key = type + it.id;
    if (t.dataset.cf !== undefined) { if (S.sel.t === 'csys') onCsysField(e, t, it); return; }
    if (t.dataset.bf !== undefined) {
      if (e.type !== 'input') return;
      const v = parseFloat(t.value); if (!isFinite(v)) return;
      APP.snap(key + 'bf' + t.dataset.bf);
      it.p[+t.dataset.bf] = v;
      if (it.meta && it.meta.src) delete it.meta.src;
      APP.changed({}); return;
    }
    if (t.dataset.off !== undefined) {
      if (e.type !== 'input') return;
      const v = parseFloat(t.value); if (!isFinite(v)) return;
      it.offset[+t.dataset.off] = v; APP.buildStl(it); APP.changed({ keepPick: false }); return;
    }
    switch (k) {
      case 'name':
        if (e.type !== 'change') return;
        if (type === 'body') { if (!APP.renameBody(it, t.value)) t.value = it.name; }
        else if (type === 'region') { if (!APP.renameRegion(it, t.value)) t.value = it.name; }
        else if (type === 'stl') { it.name = t.value.trim() || it.name; APP.changed({ tree: true }); }
        else if (type === 'csys') { if (!APP.renameCsys(it, t.value)) t.value = it.name; }
        break;
      case 'bcs': if (e.type === 'change' && type === 'body') APP.setBodyCsys(it, +t.value, S.opt.keepPos === true); break;
      case 'cparent': if (e.type === 'change' && type === 'csys') { if (!APP.setCsysParent(it, +t.value, true)) renderRight(); } break;
      case 'cfrozen': if (e.type === 'change' && type === 'csys') APP.setCsysFrozen(it, t.checked); break;
      case 'exportInp': if (e.type === 'change') { APP.snap(); if (t.checked) delete it.noExport; else it.noExport = true; APP.changed({ tree: true }); } break;
      case 'nvois': { const v = parseInt(t.value, 10); if (isFinite(v) && v >= 0) { APP.snap(key + 'nv'); it.nvois = v; APP.changed({}); } break; }
      case 'expr': APP.snap(key + 'expr'); it.expr = t.value; APP.changed({}); break;
      case 'color': if (e.type === 'input') { APP.snap(key + 'col'); it.color = t.value; APP.changed({ tree: true, csys: type === 'csys' }); } break;
      case 'opacity': if (e.type === 'input') { it.opacity = (+t.value) / 100; APP.applyStyles(); APP.changed({ tree: true }); } break;
      case 'visible': if (e.type === 'change') { APP.snap(); it.visible = t.checked; APP.changed({ tree: true, csys: type === 'csys' }); } break;
      case 'unit': if (e.type === 'change') { it.unit = t.value; APP.buildStl(it); APP.changed({ right: true, fit: true }); } break;
      case 'flip': if (e.type === 'change') { it.flip = t.checked; APP.changed({}); toast('Normals ' + (it.flip ? 'flipped' : 'normal') + ' (used for planes)'); } break;
      case 'edges': if (e.type === 'change') { it.edges = t.checked; APP.buildStl(it); APP.changed({}); } break;
    }
  }
  $('#rightBody').addEventListener('input', onField);
  $('#rightBody').addEventListener('change', onField);

  function selectedBodyRppFromBox(box) { APP.rppFromBox(box); }
  function onActClick(e) {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const it = APP.selItem(), act = a.dataset.act, pk = S.pick;
    switch (act) {
      case 'openRight': break;
      case 'winToggle': S.winOpen = !S.winOpen; renderToolWin(); break;
      case 'clearMeasures': APP.snap(); S.measures = []; APP.changed({ tree: true, measures: true, right: true }); break;
      case 'rppLastMeasure': { const m = S.measures[S.measures.length - 1]; if (m) APP.createRpp(m.a, m.b); break; }
      case 'clearPick': clearPick(); renderRight(); updateStatus(); break;
      case 'activeCs': break;
      case 'copyPick': if (pk) copyText(pkText(pk)); break;
      case 'pickPlane': if (pk && pk.kind === 'face') { APP.createPlaneFromPick(pk); } break;
      case 'pickField': if (it && S.sel.t === 'body') startFill({ kind: 'body', id: it.id, g: +a.dataset.g, only: a.dataset.i === undefined ? undefined : +a.dataset.i, alt: a.dataset.alt === undefined ? undefined : +a.dataset.alt }); break;
      case 'flipVec': if (it && S.sel.t === 'body') { const g = APP.FIELD_GROUPS[it.type][+a.dataset.g]; APP.flipFieldVec(it, g.idx); APP.changed({ tree: true, right: true }); } break;
      case 'fillDone': finishCirclePts(); break;
      case 'fillUndo': if (S.fillPts && S.fillPts.length) { S.fillPts.pop(); APP.setPending(S.fillPts.slice()); renderToolOpts(); updateStatus(); } break;
      case 'pickCsysPos': if (it && S.sel.t === 'csys') startFill({ kind: 'csys', id: it.id, only: a.dataset.i === undefined ? undefined : +a.dataset.i }); break;
      case 'rtab': S.rtab = a.dataset.tab; $$('#rightBody .rtab').forEach(x => x.classList.toggle('on', x.dataset.tab === S.rtab)); $$('#rightBody .rpane').forEach(x => { x.hidden = x.dataset.pane !== S.rtab; }); break;
      case 'boolRegion': if (it && S.sel.t === 'region') openBoolDlg(it); break;
      case 'voidRegion': if (it && S.sel.t === 'region') openVoidDlg(it); break;
      case 'detectFeat': if (it && S.sel.t === 'stl') openFeatDlg(it); break;
      case 'csysCut': if (it && S.sel.t === 'csys') APP.cutUseSrc('cs:' + it.id + ':' + a.dataset.pl); break;
      case 'csysExport': if (it && S.sel.t === 'csys') { APP.setExportCsys(APP.exportCs() === it.id ? 0 : it.id); renderRight(); } break;
      case 'csysActivate': if (it && S.sel.t === 'csys') { APP.setActiveCsys(it.id); renderRight(); } break;
      case 'pickCsysPoint': if (pk) { const c = APP.createCsysWorld(FK.M.fromPosEuler(pk.p, [0, 0, 0])); if (c) toast('Coordinate system ' + c.name + ' created (axes parallel to world)'); } break;
      case 'pickCsysFace': if (pk && pk.kind === 'face') { const c = APP.createCsysWorld(APP.csysFromNormal(pk.centroid, pk.normal)); if (c) toast('Coordinate system ' + c.name + ' created: Z = face normal'); } break;
      case 'pickRppFace': if (pk && pk.bbox) selectedBodyRppFromBox(pk.bbox); break;
      case 'pickRppObj': if (pk) { const bb = APP.objectStats(pk).bbox; if (bb) selectedBodyRppFromBox(bb); } break;
      case 'rppStl': if (it && it.stats && it.stats.bbox) selectedBodyRppFromBox(it.stats.bbox); break;
      case 'rppMeasure': if (it) APP.createRpp(it.a, it.b); break;
      case 'del': APP.deleteSel(); break;
      case 'dup':
        if (S.sel.t === 'body') { const c = APP.duplicateBody(it); S.sel = { t: 'body', id: c.id }; }
        else if (S.sel.t === 'region') { const c = APP.duplicateRegion(it); S.sel = { t: 'region', id: c.id }; }
        else if (S.sel.t === 'csys') { APP.duplicateCsys(it); break; }
        APP.changed({ tree: true, right: true }); break;
      case 'scale': case 'scaleDup': {
        const sc = S.opt.scale;
        if (it && S.sel.t === 'body') APP.scaleBody(it, sc.mode, sc.val, sc.unit, act === 'scaleDup');
        break;
      }
      case 'applyFix': { const r = APP.getRegion(+a.dataset.rid); if (r) { APP.snap(); r.expr = a.dataset.expr; APP.changed({ tree: true, right: true }); } break; }
      case 'flipPlane': if (it && FK.flipPlane(it)) { APP.snap(); if (it.meta) delete it.meta.src; APP.changed({ right: true }); } break;
      case 'replane': if (it) { S.reassign = it.id; setTool('replane'); if (narrow()) setDrawer('right', false); } break;
      case 'termAdd': case 'termSub': case 'termUnion': case 'termParen': {
        if (!it || S.sel.t !== 'region') break;
        const n = $('#termBody').value;
        if ((act === 'termAdd' || act === 'termSub') && !n) { toast('Choose a body in the list first'); break; }
        insertInExpr(act === 'termAdd' ? 'term' : act === 'termSub' ? 'term' : act === 'termUnion' ? 'union' : 'paren', (act === 'termSub' ? '-' : '+') + n);
        break;
      }
      case 'termDel': {
        const n = $('#termBody').value; if (!n || !it) break;
        try { APP.snap(); it.expr = FK.removeTermFromExpr(it.expr, n); $('#exprArea').value = it.expr; APP.changed({}); updateExprMirror(); } catch (err) { toast(err.message); }
        break;
      }
    }
  }
  $('#rightBody').addEventListener('click', onActClick);
  $('#toolwin').addEventListener('click', onActClick);

  /* ---------- Selection in the 3D view ---------- */
  function setPick(pk) {
    S.pick = pk; if (pk) S.winOpen = true; APP.drawHighlight(APP.gSel, pk, false);
    if (pk && pk.kind === 'object') { S.sel = { t: pk.ownerKind, id: pk.ownerId }; renderLeft(); APP.applyStyles(); }
    renderRight(); updateStatus();
  }
  /* ---- field pickers ---- */
  function fillSpec() {
    if (!S.fill) return null;
    if (S.fill.kind === 'csys') return { kind: 'point' };
    const b = APP.getBody(S.fill.id), g = b && APP.FIELD_GROUPS[b.type] && APP.FIELD_GROUPS[b.type][S.fill.g];
    return g ? (g.alts && S.fill.alt !== undefined ? g.alts[S.fill.alt] : g.pick) : null;
  }
  const EDGE_KINDS = ['circleEdge', 'dirEdge', 'radiusEdge'];
  /** Edge pick used by the field pickers: sharp edges only, with the loop / circle fit of the rim. */
  function edgePickForFill(hit, x, y) {
    const sv = S.opt.edgeSharpOnly; S.opt.edgeSharpOnly = true;
    try { return APP.makePick(hit, 'edge', x, y, { loop: true }); } finally { S.opt.edgeSharpOnly = sv; }
  }
  function finishCirclePts() {
    const fl = S.fill, sp = fillSpec(); if (!fl || !sp || sp.kind !== 'circlePts') return;
    const pts = S.fillPts || [];
    if (pts.length < 3) { toast('Pick at least 3 points on the circle (' + pts.length + ' so far)'); return; }
    const c = FK.fitCircle3D(pts);
    if (!c) { toast('The points are collinear: cannot define a circle. Pick points that are not on a line.'); return; }
    applyCircle(fl, sp, c, `${pts.length} points`);
    S.fillPts = []; APP.setPending(null);
    S.fill = null; APP.changed({ tree: true, right: true }); renderToolOpts(); updateStatus();
    if (narrow()) setDrawer('right', true);
  }
  function applyCircle(fl, sp, c, src) {
    const b = APP.getBody(fl.id); if (!b) return;
    APP.snap();
    const notes = APP.applyCirclePick(b, sp, c, !!S.opt.circleAll);
    const dev = c.rms > 1e-3 * c.r ? ` ⚠ the ${src} are not on one circle: rms deviation ${f(c.rms, 4)} cm, max ${f(c.maxDev, 4)} cm` : '';
    toast(`${b.name}: centre (${xyz(c.c, 4)}), R = ${f(c.r, 5)} cm from ${src}${notes.length ? ' · ' + notes.join(', ') : ''}${dev}`);
  }
  function startFill(fl) {
    S.fillPts = []; APP.setPending(null);
    S.fill = fl; S.winOpen = true; S.pending = null; S.cs3 = []; APP.setPending(null);
    if (S.tool !== 'select') { S.tool = 'select'; syncToolbar(); }
    clearPick(); APP.clearHover(); hoverText = '';
    renderToolOpts(); renderRight(); updateStatus();
    if (narrow()) setDrawer('right', false);
  }
  function cancelFill() {
    if (!S.fill) return;
    S.fill = null; S.fillPts = []; APP.setPending(null); renderToolOpts(); renderRight(); updateStatus();
  }
  function fillFromHit(hit, x, y) {
    const sp = fillSpec(); if (!sp) { cancelFill(); return; }
    if (sp.kind === 'circlePts') {
      const q = APP.pointFromHit(hit, x, y); S.fillPts = (S.fillPts || []).concat([q.p]);
      APP.setPending(S.fillPts.slice()); renderToolOpts(); updateStatus(); return;
    }
    if (EDGE_KINDS.includes(sp.kind)) {
      const e = edgePickForFill(hit, x, y), fl = S.fill, b = APP.getBody(fl.id);
      if (e.none || !b) { toast('No sharp edge here: click closer to an edge'); return; }
      if (sp.kind === 'circleEdge') {
        if (!e.circle) { toast('This edge is not part of a circular rim (' + (e.loop ? e.loop.segments : 1) + ' segment(s) followed): click an arc / circle edge, or use the "∴" picker with several points'); return; }
        applyCircle(fl, sp, e.circle, `a rim of ${e.loop.segments} segments`);
      } else if (sp.kind === 'dirEdge') {
        const a = e.chain ? e.chain.a : e.a, c2 = e.chain ? e.chain.b : e.b;
        APP.snap(); APP.applyFieldPick(b, { kind: 'dir', idx: sp.idx }, { dir: V.sub(c2, a) });
        toast(`${b.name}: direction taken from the edge (${xyz(V.norm(V.sub(c2, a)), 4)}), length kept (${f(V.len(sp.idx.map(k => b.p[k])), 4)} cm). Use ⇄ to reverse it.`);
      } else {
        const arc = e.circle && e.loop && e.loop.segments >= 3 && e.circle.rms <= 0.02 * e.circle.r;
        const val = arc ? e.circle.r : (e.chain ? e.chain.length : e.length);
        APP.snap(); APP.applyFieldPick(b, { kind: 'value', idx: sp.idx }, { v: val });
        toast(`${b.name}: radius = ${f(val, 5)} cm (${arc ? 'circle fitted on ' + e.loop.segments + ' segments' : 'length of the straight edge'})`);
      }
      S.fill = null; APP.changed({ tree: true, right: true }); renderToolOpts(); updateStatus();
      if (narrow()) setDrawer('right', true);
      return;
    }
    const pk = sp.kind === 'normal' ? APP.makePick(hit, 'face', x, y) : APP.pointFromHit(hit, x, y);
    const fl = S.fill;
    if (fl.kind === 'csys') {
      const c = APP.getCsys(fl.id); if (c) APP.applyCsysPosPick(c, pk.p, fl.only);
      S.fill = null;
    } else {
      const b = APP.getBody(fl.id);
      if (b) {
        APP.snap();
        APP.applyFieldPick(b, sp, sp.kind === 'normal' ? { normal: pk.normal } : { p: pk.p }, fl.only);
        toast(`${b.name}: value${sp.idx.length > 1 ? 's' : ''} filled from the view`);
      }
      S.fill = sp.next !== undefined && fl.only === undefined ? { kind: 'body', id: fl.id, g: sp.next } : null;
    }
    APP.changed({ tree: true, right: true }); renderToolOpts(); updateStatus();
    if (!S.fill && narrow()) setDrawer('right', true);
  }
  function pickForTool(hit, x, y) {
    if (S.fill) { const sp = fillSpec(); return sp && sp.kind === 'normal' ? APP.makePick(hit, 'face', x, y) : sp && EDGE_KINDS.includes(sp.kind) ? edgePickForFill(hit, x, y) : APP.pointFromHit(hit, x, y); }
    if (S.tool === 'select') return S.info ? APP.makePick(hit, S.filter, x, y) : null;
    if (S.tool === 'measure' || S.tool === 'rpp' || S.tool === 'csys3') return APP.pointFromHit(hit, x, y);
    return APP.makePick(hit, 'face', x, y);
  }
  let hoverT = 0;
  APP.hooks.hover = (x, y) => {
    const now = performance.now(); if (now - hoverT < 70) return; hoverT = now;
    if (APP.totalTris() > 150000) return;
    if (S.tool === 'select' && !S.info && !S.fill) { APP.clearHover(); return; }
    const hit = APP.raycast(x, y);
    if (!hit) { APP.clearHover(); if (hoverText) { hoverText = ''; updateStatus(); } return; }
    try {
      const pk = pickForTool(hit, x, y);
      APP.drawHighlight(APP.gHover, pk, true);
      hoverText = pk.kind === 'point' ? pkSummary(pk) : (pk.kind === 'face' || pk.kind === 'edge' ? pkSummary(pk) : '');
      if (S.tool === 'select' && S.pick) hoverText = '';
      updateStatus();
    } catch (e) { /* ignorer */ }
  };
  APP.hooks.leave = () => { APP.clearHover(); if (hoverText) { hoverText = ''; updateStatus(); } };
  APP.hooks.click = (x, y) => {
    APP.clearHover(); hoverText = '';
    if (FEAT.armed && FEAT.stl) {          // guided feature fit: the click selects a triangle of the mesh
      const h = APP.raycast(x, y);
      if (h && h.object && h.object.userData && h.object.userData.kind === 'stl' && h.object.userData.id === FEAT.stl.id && h.faceIndex != null) guidedToggle(h.faceIndex);
      return;
    }
    closePickPop();
    if (S.tool === 'select' && !S.info && !S.fill) return;
    const all = S.opt.multiPick !== false ? APP.raycastAll(x, y) : null;
    if (all && all.length > 1) { openPickPop(all, x, y, h => processHit(h, x, y)); return; }
    processHit(all ? all[0] : APP.raycast(x, y), x, y);
  };
  function processHit(hit, x, y) {
    if (S.fill) { if (hit) { try { fillFromHit(hit, x, y); } catch (err) { console.error(err); toast('Pick error: ' + err.message); } } return; }
    if (!hit) { if (S.tool === 'select' && S.pick) { clearPick(); renderRight(); updateStatus(); } return; }
    try {
      switch (S.tool) {
        case 'select': setPick(APP.makePick(hit, S.filter, x, y)); break;
        case 'measure': {
          const pk = APP.pointFromHit(hit, x, y);
          if (!S.pending) { S.pending = pk.p; APP.setPending(pk.p); updateStatus(); }
          else {
            APP.snap(); const m = { id: APP.nid(), a: S.pending, b: pk.p, visible: true };
            S.measures.push(m); S.pending = null; APP.setPending(null); S.sel = { t: 'measure', id: m.id };
            APP.changed({ tree: true, right: true, measures: true });
            toast('Distance : ' + f(V.dist(m.a, m.b), 4) + ' cm');
          }
          break;
        }
        case 'rpp': {
          const pk = APP.pointFromHit(hit, x, y);
          if (!S.pending) { S.pending = pk.p; APP.setPending(pk.p); updateStatus(); }
          else {
            const a = S.pending; APP.setPending(null); S.pending = null;
            const b = APP.createRpp(a, pk.p);
            toast('RPP ' + b.name + ' created'); setTool('select');
          }
          break;
        }
        case 'csys3': {
          const pk = APP.pointFromHit(hit, x, y);
          S.cs3 = S.cs3 || []; S.cs3.push(pk.p); APP.setPending(S.cs3);
          if (S.cs3.length < 3) { updateStatus(); break; }
          const [o, px, pxy] = S.cs3; S.cs3 = []; APP.setPending(null);
          const m = APP.csysFromPoints(o, px, pxy);
          if (!m) { toast('Points coincide or are collinear: cannot build a coordinate system'); updateStatus(); break; }
          const c = APP.createCsysWorld(m);
          if (c) { toast('Coordinate system ' + c.name + ' created'); setTool('select'); }
          break;
        }
        case 'viewface': { lookAtFace(APP.makePick(hit, 'face', x, y)); setTool('select'); break; }
        case 'plane': {
          const pk = APP.makePick(hit, 'face', x, y);
          APP.createPlaneFromPick(pk); break;
        }
        case 'replane': {
          const pk = APP.makePick(hit, 'face', x, y);
          APP.reassignPlane(S.reassign, pk); setTool('select'); break;
        }
      }
    } catch (err) { console.error(err); toast('Selection error: ' + err.message); }
  }

  /* ---------- Pop-up listing the overlapping entities under a click (nearest first) ---------- */
  let pickPop = null;
  function closePickPop() {
    if (!pickPop) return;
    pickPop.el.remove(); document.removeEventListener('pointerdown', pickPop.outside, true); document.removeEventListener('keydown', pickPop.key, true);
    pickPop = null; APP.clearHover();
  }
  function hoverHit(h) {
    const pk = APP.makePick(h, S.filter === 'object' || S.tool !== 'select' ? 'object' : 'face', 0, 0);
    APP.drawHighlight(APP.gHover, pk, true);
  }
  function openPickPop(hits, x, y, onSelect) {
    closePickPop();
    const KIND = { stl: 'Mesh', body: 'Body', region: 'Region' };
    const el = document.createElement('div'); el.id = 'pickPop'; el.setAttribute('role', 'dialog');
    el.innerHTML = `<div class="pp-h">${hits.length} overlapping entities <small>nearest first</small></div><div class="pp-l">${hits.map((h, i) => {
      const o = APP.ownerOf(h);
      return `<div class="pp-i" data-i="${i}"><span class="pp-n">${i + 1}</span><span class="pp-t">${esc(o.name)}</span><span class="pp-k">${KIND[o.kind] || o.kind}${o.type ? ' · ' + esc(o.type) : ''}</span></div>`;
    }).join('')}</div><div class="pp-b"><button type="button" class="pill" data-pp="cancel">Cancel</button><button type="button" class="pill primary" data-pp="select">Select</button></div>`;
    document.body.appendChild(el);
    const W = window.innerWidth, H = window.innerHeight, r = el.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(x + 10, W - r.width - 4)) + 'px'; el.style.top = Math.max(4, Math.min(y + 10, H - r.height - 4)) + 'px';
    let cur = 0;
    const mark = () => { $$('#pickPop .pp-i').forEach((n, i) => n.classList.toggle('on', i === cur)); };
    const doSelect = () => { const h = hits[cur]; closePickPop(); onSelect(h); };
    el.addEventListener('pointerover', e => { const n = e.target.closest('.pp-i'); if (n) hoverHit(hits[+n.dataset.i]); });
    el.addEventListener('pointerleave', () => hoverHit(hits[cur]));
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-pp]'), n = e.target.closest('.pp-i');
      if (b) { if (b.dataset.pp === 'select') doSelect(); else closePickPop(); }
      else if (n) { cur = +n.dataset.i; mark(); hoverHit(hits[cur]); }
    });
    el.addEventListener('dblclick', e => { const n = e.target.closest('.pp-i'); if (n) { cur = +n.dataset.i; doSelect(); } });
    pickPop = {
      el,
      outside: e => { if (!el.contains(e.target)) closePickPop(); },
      key: e => { if (e.key === 'Escape') { e.stopPropagation(); closePickPop(); } else if (e.key === 'Enter') { e.preventDefault(); doSelect(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cur = (cur + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; mark(); hoverHit(hits[cur]); } }
    };
    document.addEventListener('pointerdown', pickPop.outside, true); document.addEventListener('keydown', pickPop.key, true);
    mark(); hoverHit(hits[0]);
  }

  /* ---------- INP block: display, copy, import ---------- */
  const inpText = $('#inpText');
  function updateInp() {
    const t = APP.inpText();
    if (inpText.value !== t) inpText.value = t;
    const w = APP.warnings();
    $('#inpWarn').innerHTML = w.map(esc).join('<br>');
    const badge = $('#warnBadge'); badge.hidden = !w.length; badge.textContent = w.length;
  }
  $('#inpStyle').onchange = (e) => { S.opt.style = +e.target.value; updateInp(); APP.save(); };
  $('#btnInpCopy').onclick = () => copyText(APP.inpText());
  $('#btnInpSave').onclick = () => {
    const blob = new Blob([APP.inpText()], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (S.model.title || 'geometrie').replace(/[^\w\-]+/g, '_') + '.inp';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const dlg = $('#dlgImport');
  function openImport() { if (!dlg.open) dlg.showModal(); }
  $('#btnInpImport').onclick = openImport;
  $('#btnPickInp').onclick = () => $('#fileInp').click();
  $('#fileInp').onchange = async (e) => { const fl = e.target.files[0]; if (fl) $('#importText').value = await fl.text(); e.target.value = ''; };
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const mode = (document.querySelector('input[name=impMode]:checked') || {}).value || 'replace';
    const res = APP.importInp($('#importText').value, mode);
    if (res && res.warnings && res.warnings.length) toast('Import : ' + res.warnings[0]);
    else if (res) toast('Import finished');
    dlg.returnValue = '';
  });

  /* ---------- Loading meshes ---------- */
  async function loadStlFiles(files) {
    let ok = 0;
    for (const file of files) {
      if (!/\.(stl|obj)$/i.test(file.name)) { toast('Ignored (neither .stl nor .obj): ' + file.name); continue; }
      try {
        toast('Reading ' + file.name + '…');
        const buf = await file.arrayBuffer();
        const res = FK.parseMesh(buf, file.name);
        if (!res.count) { toast('Empty or unreadable mesh: ' + file.name); continue; }
        const stl = { id: APP.nid(), name: file.name.replace(/\.(stl|obj)$/i, ''), format: res.format || 'STL', raw: res.positions, unit: 'mm', offset: [0, 0, 0], flip: false, visible: true, opacity: 0.6, color: '#8f9bb0', edges: res.count <= 80000, group: null, mesh: null };
        APP.buildStl(stl); S.stls.push(stl); S.sel = { t: 'stl', id: stl.id }; ok++;
        toast(`${file.name}: ${res.count} triangles (${res.format === 'OBJ' ? 'OBJ' : res.binary ? 'binary STL' : 'ASCII STL'}${res.groups > 1 ? ', ' + res.groups + ' objects merged' : ''}) — assumed unit: mm`);
      } catch (e) { console.error(e); toast('Read error: ' + e.message); }
    }
    if (ok) APP.changed({ tree: true, right: true, fit: true });
  }
  $('#fileStl').onchange = (e) => { loadStlFiles(Array.from(e.target.files)); e.target.value = ''; };
  const vp = $('#viewport');
  const updateDrop = updateDropHint;
  vp.addEventListener('dragover', e => { e.preventDefault(); $('#dropHint').hidden = false; $('#dropHint').style.display = ''; });
  vp.addEventListener('dragleave', () => { updateDrop(); });
  vp.addEventListener('drop', e => { e.preventDefault(); updateDrop(); if (e.dataTransfer && e.dataTransfer.files.length) loadStlFiles(Array.from(e.dataTransfer.files)); });

  /* ---------- Keyboard ---------- */
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? APP.redo() : APP.undo(); }
      else if (k === 'y') { e.preventDefault(); APP.redo(); }
    }
    if (e.key === 'Escape') { if (!ctxEl.hidden) { hideMenu(); return; } if (dlg.open) return; if (S.fill) { cancelFill(); return; } if (S.tool !== 'select') setTool('select'); else if (S.pick) { clearPick(); renderRight(); updateStatus(); } else if (S.info) { setTool('select'); } }
    if (e.key === 'Enter' && !typing && S.fill) { e.preventDefault(); finishCirclePts(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && S.sel && !dlg.open && !S.fill) { e.preventDefault(); APP.deleteSel(); }
  });

  /* ---------- PWA install ---------- */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#btnInstall').hidden = false; });
  $('#btnInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch (e) { /* ignorer */ } deferred = null; $('#btnInstall').hidden = true; };
  window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; });

  /* ---------- Start-up ---------- */
  function init() {
    APP.load();
    $('#inpStyle').value = String(S.opt.style || 1);
    APP.startLoop();
    APP.sync(); APP.rebuildMeasures(); APP.rebuildCsys();
    renderLeft(); renderToolOpts(); renderRight(); updateInp(); updateStatus(); syncToolbar();
    APP.hooks.undoState(); updateDropHint();
    APP.fit();
    if (!narrow()) { dL.classList.add('open'); dR.classList.add('open'); }
  }
  init();
  window.APP_DEBUG = { guidedToggle, guidedArm, openFeatDlg, loadStlFiles, setTool, setFilter, setPick, flush, renderRight };
})();
