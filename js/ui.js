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
      updateInp(); updateStatus(); updateDropHint(); updatePieces();
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
    { const nm = S.opt.names || 'off', b = $('#btnNames'); b.classList.toggle('on', nm !== 'off'); b.title = 'Object names in the viewport: ' + nm + ' (click: off → regions → bodies → all)'; }
    $('#btnInvX').classList.toggle('on', !!S.opt.invX); $('#btnInvY').classList.toggle('on', !!S.opt.invY);
    $$('#grpTool button').forEach(b => b.classList.toggle('on', b.dataset.tool === 'select' ? (S.tool === 'select' && !!S.info) : b.dataset.tool === S.tool));
  }
  function clearPick() { S.pick = null; APP.drawHighlight(APP.gSel, null); }
  function setTool(t) {
    S.fill = null; S.tool = t; S.info = false; if (t !== 'select') S.winOpen = true; S.pending = null; S.cs3 = []; S.ptPlanes = []; if (t !== 'replane') S.reassign = null;
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

  /* ---------- Floating tool window (options + results of Info / Distance / creation tools) ---------- */
  function winTitle() {
    if (S.fill) return 'Pick a value';
    return { select: 'Selection · ' + ({ point: 'points', edge: 'edges', face: 'faces', object: 'objects' }[S.filter]), measure: 'Distance', rpp: 'RPP from 2 points',
      regcut: 'Cut a region with a face', regpick: 'Pick objects for a region', plane: 'PLA from a face', replane: 'Re-pick a plane', csys3: 'Coordinate system from 3 points', viewface: 'Look at a face' }[S.tool] || 'Tool';
  }
  /* Point source for the tools that pick a position (csys from 3 points, csys position, distance, RPP) */
  const PT_MODES = [['vertex', 'Vertex / point on a surface'], ['arc', 'Centre of a circular edge (arc / rim)'], ['mid', 'Midpoint of an edge'], ['planes3', 'Intersection of 3 faces']];
  const csd = () => S.fill && S.fill.kind === 'csdef' ? S.fill : null;
  const ptTool = () => S.tool === 'csys3' || S.tool === 'measure' || S.tool === 'rpp' || (S.fill && (S.fill.kind === 'csys' || S.fill.kind === 'csdef'));
  const ptMode = () => csd() ? csd().mode : ptTool() ? (S.opt.ptMode || 'vertex') : 'vertex';
  function ptModeHTML() {
    const o = S.opt, m = ptMode(), sel = csd() ? '' : `<label>Point from <select data-opt="ptMode">${PT_MODES.map(([k, l]) => `<option value="${k}" ${m === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    const ang = `<label>Edge angle ≥ <input type="number" step="any" data-opt="sharp" value="${o.sharp}">°</label>`, soft = `<label><input type="checkbox" data-opt="edgeSoft" ${o.edgeSoft !== false ? 'checked' : ''}>Retry with a lower angle if the rim is open</label>`;
    if (m === 'vertex') return sel + `<label><input type="checkbox" data-opt="snap" ${o.snap ? 'checked' : ''}>Snap to vertices</label>`;
    if (m === 'planes3') return sel + `<label class="muted">Click 3 faces (meshes or plane bodies): the point is where their planes meet${(S.ptPlanes || []).length ? ' — ' + S.ptPlanes.length + '/3 picked' : ''}</label><span class="btns"><button class="btn sm" data-act="ptUndo">Undo last face</button></span>`;
    if (m === 'face') return sel + `<label><input type="checkbox" data-opt="coplanar" ${o.coplanar ? 'checked' : ''}>Whole face (coplanar triangles)</label><label>Face tolerance <input type="number" step="any" data-opt="coTol" value="${o.coTol}">°</label>`;
    if (m === 'edge') return sel + ang;
    return sel + ang + soft;
  }
  const modeHint = () => { const m = ptMode(); return m === 'face' ? ' (click a face: its normal)' : m === 'edge' ? ' (click an edge: its direction)' : m === 'circ' ? ' (click a circular edge: the axis of its circle)' : m === 'arc' ? ' (click a circular edge: its centre)' : m === 'mid' ? ' (click an edge: its midpoint)' : m === 'planes3' ? ` (click 3 faces: ${(S.ptPlanes || []).length}/3 picked)` : ''; };
  function ptRefreshPending() {
    const base = S.tool === 'csys3' ? (S.cs3 || []).slice() : S.pending ? [S.pending] : [];
    const pts = base.concat((S.ptPlanes || []).map(q => q.c)); APP.setPending(pts.length ? pts : null);
  }
  /** Point under the cursor for the hover preview, according to the point source. */
  function hoverPoint(hit, x, y) {
    const m = ptMode();
    if (m === 'arc' || m === 'mid' || m === 'edge' || m === 'circ') return edgePickForFill(hit, x, y);
    if (m === 'planes3' || m === 'face') return APP.makePick(hit, 'face', x, y);
    return APP.pointFromHit(hit, x, y);
  }
  /** Resolve a click to a point: { p } | { wait: true } (more clicks needed) | null (message shown). */
  function resolvePoint(hit, x, y) {
    const m = ptMode();
    if (m === 'vertex') return { p: APP.pointFromHit(hit, x, y).p };
    if (m === 'arc' || m === 'mid') {
      const e = edgePickForFill(hit, x, y);
      if (e.none) { toast('No sharp edge here: click closer to an edge (or lower the edge angle)'); return null; }
      if (m === 'arc') { if (!e.circle) { toast('This edge is not part of a circular rim (' + (e.loop ? e.loop.segments : 1) + ' segment(s) followed): click an arc / circle edge, or adjust the edge angle'); return null; } return { p: e.circle.c }; }
      const a = e.chain ? e.chain.a : e.a, b = e.chain ? e.chain.b : e.b; return { p: V.mul(V.add(a, b), 0.5) };
    }
    const pk = APP.makePick(hit, 'face', x, y), n = V.norm(pk.normal);
    S.ptPlanes = (S.ptPlanes || []).concat([{ n, d: V.dot(n, pk.seedVerts[0]), c: pk.centroid || pk.seedVerts[0] }]);
    if (S.ptPlanes.length < 3) { ptRefreshPending(); renderToolOpts(); updateStatus(); return { wait: true }; }
    const [a, b, c] = S.ptPlanes; S.ptPlanes = [];
    const bc = V.cross(b.n, c.n), ca = V.cross(c.n, a.n), ab = V.cross(a.n, b.n), det = V.dot(a.n, bc);
    ptRefreshPending(); renderToolOpts();
    if (Math.abs(det) < 1e-3) { toast('These 3 faces do not meet in one point (two are parallel, or all 3 share a line): pick 3 other faces'); return null; }
    return { p: V.mul(V.add(V.add(V.mul(bc, a.d), V.mul(ca, b.d)), V.mul(ab, c.d)), 1 / det) };
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
      else if (sp && EDGE_KINDS.includes(sp.kind)) h += '<label class="muted">Sharp edges only (rims are followed automatically)</label>' + num('sharp', 'Edge angle ≥', '°') + (sp.kind === 'dirEdge' ? '' : chk('edgeSoft', 'Retry with a lower angle if the rim is open')) + '<label class="muted">Lower the angle to follow more of the continuity; raise it to stop at a fillet</label>';
      else if (S.fill.kind === 'csys' || S.fill.kind === 'csdef') h += ptModeHTML();
      else if (sp && sp.kind === 'normal') h += chk('coplanar', 'Whole face (coplanar triangles)') + num('coTol', 'face tolerance', '°');
      else h += chk('snap', 'Snap to vertices');
      if (sp && (sp.kind === 'circleEdge' || sp.kind === 'circlePts') && (sp.axisIdx || (sp.radIdx !== undefined && sp.radIdx !== null))) h += chk('circleAll', 'Also set ' + (sp.axisIdx ? 'the axis (circle normal) and ' : '') + 'the radius');
    }
    else if (S.tool === 'select') {
      if (S.filter === 'point') h += chk('snap', 'Snap to vertices');
      else if (S.filter === 'edge') h += chk('edgeSharpOnly', 'Sharp edges only') + num('sharp', 'angle ≥', '°');
      else if (S.filter === 'face') h += chk('coplanar', 'Whole face (coplanar triangles)') + num('coTol', 'tolerance', '°');
      else h += '<label class="muted">Click an object (mesh, body or region)</label>';
    } else if (S.tool === 'measure' || S.tool === 'rpp') h += ptModeHTML();
    else if (S.tool === 'csys3') h += ptModeHTML() + '<label class="muted">Created as a child of the active system</label>';
    else if (S.tool === 'regpick') {
      const r = APP.getRegion(S.cutRid);
      h += `<label class="muted">Region <b>${r ? esc(r.name) : '?'}</b>: click a body or plane in the view; if several overlap, a list lets you choose. It is then selected in the body list, ready for + / − / union.</label>`;
    } else if (S.tool === 'regcut') {
      const r = APP.getRegion(S.cutRid); let nz = 1; try { nz = Math.max(1, FK.parseExpr(r ? r.expr : '').zones.length); } catch (e) { /* ignored */ }
      h += `<label class="muted">Region <b>${r ? esc(r.name) : '?'}</b>: click a face; its plane is created (or reused) and added to the formula</label>
        <label>Keep <select data-opt="cutKeep"><option value="+" ${o.cutKeep !== '-' ? 'selected' : ''}>the material side (behind the face): +plane</option><option value="-" ${o.cutKeep === '-' ? 'selected' : ''}>the other side: −plane</option></select></label>
        ${nz > 1 ? `<label>In <select data-opt="cutZone"><option value="all" ${o.cutZone === 'all' ? 'selected' : ''}>every zone</option>${Array.from({ length: nz }, (_, i) => `<option value="${i}" ${String(o.cutZone) === String(i) ? 'selected' : ''}>zone ${i + 1} only</option>`).join('')}</select></label>` : ''}
        ${chk('coplanar', 'Whole face (coplanar triangles)') + num('coTol', 'face tolerance', '°')}
        ${chk('cutStay', 'Keep cutting (several faces)')}`;
    } else if (S.tool === 'plane' || S.tool === 'replane') {
      h += chk('coplanar', 'Highlight the whole face') + num('coTol', 'face tolerance', '°') + '<label class="muted">The plane is only created; add it to a region yourself</label>';
    } else if (S.tool === 'viewface') h += chk('coplanar', 'Highlight the whole face') + num('coTol', 'face tolerance', '°');
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
    if (['coplanar', 'coTol', 'sharp', 'edgeSharpOnly', 'edgeSoft'].includes(k)) { clearPick(); APP.clearHover(); }
    if (k === 'ptMode') { S.ptPlanes = []; ptRefreshPending(); renderToolOpts(); updateStatus(); }
    if (k === 'margin' || k === 'axes') APP.changed({});
    if (k === 'invX' || k === 'invY') syncToolbar();
    if (k === 'pieceHl') updatePieces(true);
    if (k === 'inpComment') updateInp();
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
      if (S.fill.kind === 'csdef') t = 'Define the coordinate system' + modeHint() + ' · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
      else if (sp && sp.kind === 'circlePts') t = `Click points on the circle (${(S.fillPts || []).length} picked, at least 3) · <a href="#" data-act="fillDone">Done (Enter)</a> · <a href="#" data-act="fillUndo">Undo last</a> · <a href="#" data-act="cancelFill">Cancel (Esc)</a>`;
      else if (sp && sp.kind === 'circleEdge') t = 'Click a circular edge (rim): its circle gives the centre · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
      else if (sp && sp.kind === 'dirEdge') t = 'Click an edge: its normalized direction gives the vector · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
      else if (sp && sp.kind === 'radiusEdge') t = 'Click an arc edge (radius of its circle) or a straight edge (its length) · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
      else t = sp && sp.kind === 'normal' ? 'Pick: click a face to take its outward normal · <a href="#" data-act="cancelFill">Cancel (Esc)</a>'
        : 'Pick: click a point in the view' + (sp && sp.kind === 'radius' ? ' on the surface' : '') + (S.fill.kind === 'csys' ? modeHint() : '') + one + ' · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
    } else if (S.tool === 'select') {
      t = !S.info ? '' : S.pick ? esc(pkSummary(S.pick)) + ' <a href="#" data-act="openRight">Details ▸</a>'
        : { point: 'Click a vertex of the model', edge: 'Click an edge', face: 'Click a face (triangle or planar face)', object: 'Click an object' }[S.filter];
    } else if (S.tool === 'measure') t = (S.pending ? 'Distance: click point B' : 'Distance: click point A') + modeHint() + ' · <a href="#" data-act="cancelTool">Cancel (Esc)</a>';
    else if (S.tool === 'csys3') t = 'Coordinate system: click ' + ['the origin', 'a point on the X axis', 'a point in the XY plane (+Y side)'][(S.cs3 || []).length] + modeHint();
    else if (S.tool === 'rpp') t = (S.pending ? 'RPP: click the opposite corner (point 2)' : 'RPP: click the first corner (point 1)') + modeHint();
    else if (S.tool === 'regpick') { const r = APP.getRegion(S.cutRid); t = `Pick a body or plane for ${r ? esc(r.name) : 'the region'}: click it in the view · <a href="#" data-act="cancelTool">Cancel (Esc)</a>`; }
    else if (S.tool === 'regcut') { const r = APP.getRegion(S.cutRid); t = `Cut ${r ? esc(r.name) : 'the region'}: click a face of a mesh or object · <a href="#" data-act="cancelTool">Done (Esc)</a>`; }
    else if (S.tool === 'plane') t = 'Plane: click a triangle / face — its normal gives the PLA vector H';
    else if (S.tool === 'viewface') t = 'Click a face to look at it · <a href="#" data-act="cancelTool">Cancel (Esc)</a>';
    else if (S.tool === 'replane') { const b = APP.getBody(S.reassign); t = `Click the new face for ${b ? esc(b.name) : 'the plane'}`; }
    if (hoverText && !(S.tool === 'select' && S.pick)) t += (t ? ' · ' : '') + '<span class="muted">' + esc(hoverText) + '</span>';
    $('#status').innerHTML = t ? `<span>${t}</span>` : '';
  }
  document.addEventListener('change', e => { if (e.target && e.target.id === 'termBody') S.termSel = e.target.value; });
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
  function snapOpts() { return { tol: (S.opt.snapTol === undefined ? 0.2 : S.opt.snapTol) / 10, ang: S.opt.snapAng === undefined ? 0.5 : S.opt.snapAng }; }
  function snapHide() { const c = $('#snapCard'); c.hidden = true; c.innerHTML = ''; SNAP.id = 0; }
  function snapRender() {
    const b = APP.getBody(SNAP.id), c = $('#snapCard'); if (!b || !SNAP.orig) { snapHide(); return; }
    const res = FK.snapSuggest(SNAP.orig, snapOthers(b), snapOpts(), new Set());
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
    const res = FK.snapSuggest(b, snapOthers(b), snapOpts(), new Set());
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
        const res = FK.snapSuggest(SNAP.orig, snapOthers(b), snapOpts(), SNAP.off);
        if (res) { APP.snap(); b.type = res.type; b.p = res.p; APP.changed({ tree: true, right: true }); toast(`${b.name}: corrected values applied (Ctrl+Z restores the previous ones)`); }
        snapHide();
      }
    });
  })();
  /* ---------- Geometry check window ---------- */
  const FIX_HINT = { snapAxis: 'Set the axis exactly on the global axis', snapPlane: 'Set the plane exactly perpendicular to the global axis (XYP / XZP / YZP when possible)', align: 'Rotate the second cylinder so that its axis is parallel to the first', concentric: 'Move the second cylinder onto the axis of the first', radius: 'Give the second cylinder the radius of the first', shift: 'Translate the second cylinder along its axis so the ends touch', planeMerge: 'Make the second plane coincide with the first', face: 'Move the face onto the reference face' };
  const CHK = { last: null, bodies: [], tol: 0.01 };
  function chkAlign(bodies, tol) { return FK.checkAlignment(bodies.filter(b => b.type !== 'RAW').map(b => Object.assign({ name: b.name }, APP.xbody(b))), { tol }); }
  /** Applies one fix, or all of them in turn (findings are recomputed after each change). */
  function chkSolve(i) {
    const R = CHK.last; if (!R) return;
    if (i === 'all') {
      APP.snap(); let n = 0; const tried = new Set(), msgs = [];
      for (let it = 0; it < 80; it++) {
        const al = chkAlign(CHK.bodies, CHK.tol), f = al.find(a => a.fix && !tried.has(JSON.stringify(a.fix)));
        if (!f) break; tried.add(JSON.stringify(f.fix));
        const res = APP.applyFix(f.fix); if (res.ok) { n++; msgs.push(res.msg); }
      }
      APP.changed({ tree: true, right: true }); toast(n ? `${n} fix(es) applied (Ctrl+Z undoes the last one)` : 'Nothing could be fixed automatically');
    } else {
      const a = R.al[+i]; if (!a || !a.fix) return;
      const res = APP.applyFix(a.fix); toast(res.msg); if (res.ok) APP.changed({ tree: true, right: true });
    }
    chkRun();
  }
  function chkRun() {
    const esc2 = esc, rows = [];
    const regs0 = S.model.regions.filter(r => !r.noExport && r.expr && r.expr.trim()), used = new Set();
    for (const r of regs0) { try { for (const nm of FK.exprNames(FK.parseExpr(r.expr))) used.add(nm); } catch (e) { /* ignored */ } }
    const bodies = S.model.bodies.filter(b => !b.noExport && used.has(b.name)), regs = S.model.regions.filter(r => !r.noExport && r.expr && r.expr.trim());
    const tol = Math.max(0, parseFloat($('#chkTol').value) || 0.1) / 10, n = Math.max(20, Math.min(160, +$('#chkN').value || 72));
    const R = { eq: null, ov: null, al: null };
    // A. INP <-> model
    R.eq = FK.checkEquivalence(S.model, APP.xbody, APP.inpText(), { points: 8000 });
    // B. overlaps / holes (world frame)
    const fns = new Map(); let box = null;
    for (const b of bodies) { const wb = APP.wbody(b), f = FK.insideFn(wb); if (f) fns.set(b.name, f); const bb = b.type === 'RAW' ? null : FK.bodyBBox(wb); if (bb) box = box ? { min: box.min.map((x, i) => Math.min(x, bb.min[i])), max: box.max.map((x, i) => Math.max(x, bb.max[i])) } : bb; }
    if (box) { const pad = 0.05 * (Math.max(...box.max.map((x, i) => x - box.min[i])) || 1); box = { min: box.min.map(x => x - pad), max: box.max.map(x => x + pad) }; }
    const skipped = regs.filter(r => { try { return Array.from(FK.exprNames(FK.parseExpr(r.expr))).some(nm => !fns.has(nm)); } catch (e) { return true; } });
    const okRegs = regs.filter(r => !skipped.includes(r));
    R.ov = box && okRegs.length ? FK.checkOverlaps(okRegs, fns, box, { n }) : null;
    // C. alignment
    R.al = chkAlign(bodies, tol); CHK.last = R; CHK.bodies = bodies; CHK.tol = tol;
    const li = (cls, t) => `<li class="${cls}">${t}</li>`;
    rows.push('<b>1. INP ↔ model</b><ul>');
    if (R.eq.missing.length) R.eq.missing.forEach(m => rows.push(li('bad', esc2(m))));
    rows.push(R.eq.ok && !R.eq.missing.length ? li('good', `✔ The generated INP gives the same region membership as the model (${R.eq.regionsChecked} region(s), ${R.eq.points} tests)`) : R.eq.mismatches.length ? li('bad', `✖ ${R.eq.mismatches.length}${R.eq.mismatches.length >= 50 ? '+' : ''} mismatching points, e.g. region ${esc2(R.eq.mismatches[0].region)} at (${R.eq.mismatches[0].point.map(x => x.toFixed(3)).join(', ')}) — model ${R.eq.mismatches[0].model ? 'inside' : 'outside'}, INP ${R.eq.mismatches[0].inp ? 'inside' : 'outside'}`) : '');
    if (R.eq.unsupported.length) rows.push(li('info', `ⓘ Not checked (ARB / unsupported bodies): ${R.eq.unsupported.map(esc2).join(', ')}`));
    rows.push('</ul><b>2. Overlaps and holes</b><ul>');
    if (!R.ov) rows.push(li('info', 'ⓘ Nothing to scan'));
    else {
      const c = R.ov.cell * 10;
      if (!R.ov.overlaps.length) rows.push(li('good', `✔ No overlap between regions (cell ${c.toFixed(2)} mm)`));
      for (const o of R.ov.overlaps.slice(0, 8)) rows.push(li('bad', `✖ ${esc2(o.a)} ∩ ${esc2(o.b)}: ≈ ${o.volume.toPrecision(3)} cm³`));
      if (!R.ov.holes.length) rows.push(li('good', '✔ No enclosed hole (undefined space inside the geometry)'));
      for (const h of R.ov.holes.slice(0, 8)) rows.push(li('bad', `✖ Hole ≈ ${h.volume.toPrecision(3)} cm³ around (${h.center.map(x => x.toFixed(2)).join(', ')}) next to ${h.around.map(esc2).join(', ')}`));
      rows.push(li('info', `ⓘ Grid scan: features thinner than ${c.toFixed(2)} mm can be missed — see section 3`));
    }
    if (skipped.length) rows.push(li('info', `ⓘ Not scanned (unsupported bodies): ${skipped.map(r => esc2(r.name)).join(', ')}`));
    const nfix = R.al.filter(a => a.fix).length;
    rows.push('</ul><b>3. Alignment accidents</b>' + (nfix ? ` <button type="button" class="btn sm" data-fix="all" title="Apply every automatic fix, one after the other">Solve all (${nfix})</button>` : '') + '<ul>');
    if (!R.al.length) rows.push(li('good', '✔ Nothing suspicious (near-parallel axes, almost coincident faces, tiny offsets or gaps)'));
    R.al.slice(0, 40).forEach((a, i) => rows.push(li(a.level === 'info' ? 'info' : 'warn', (a.level === 'info' ? 'ⓘ ' : '⚠ ') + esc2(a.text) + (a.fix ? ` <button type="button" class="btn sm" data-fix="${i}" title="${esc2(FIX_HINT[a.fix.type] || 'Fix')}">Solve</button>` : ''))));
    rows.push('</ul>');
    $('#chkRes').innerHTML = rows.join('');
    APP.setCheckMarks(R.ov ? [{ centers: R.ov.overlapCenters, size: R.ov.cell, color: 0xff3030 }, { centers: R.ov.holeCenters, size: R.ov.cell, color: 0xff9900 }] : null);
    return R;
  }
  (function () {
    const d = $('#dlgChk'); if (!d) return;
    $('#btnInpCheck').onclick = () => { if (!d.open) d.show(); if (typeof d._x === 'number') { d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; } else { d.style.left = 'auto'; d.style.right = '12px'; d.style.top = '64px'; } };
    $('#chkRun').onclick = () => { try { chkRun(); } catch (e) { console.error(e); toast('Check failed: ' + e.message); } };
    $('#chkRes').addEventListener('click', e => { const b = e.target.closest('[data-fix]'); if (b) chkSolve(b.dataset.fix); });
    $('#chkClear').onclick = () => { APP.setCheckMarks(null); };
    d.addEventListener('close', () => APP.setCheckMarks(null));
    d.querySelector('[value=close]').onclick = () => d.close();
    let drag = null; const h = d.querySelector('.fw-h');
    h.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = d.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { h.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
    h.addEventListener('pointermove', e => { if (!drag) return; d._x = Math.max(0, e.clientX - drag.dx); d._y = Math.max(0, e.clientY - drag.dy); d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; });
    h.addEventListener('pointerup', () => { drag = null; });
  })();
  /* ---------- CAD <-> CG comparison window ---------- */
  const DEV = { last: null };
  function devRegionCheck(preId) {
    const cad = +$('#devCad').value, box = $('#devRegs');
    const regs = S.model.regions.filter(r => r.expr && r.expr.trim());
    box.innerHTML = regs.length ? regs.map(r => `<label><input type="checkbox" data-r="${r.id}" ${(preId ? r.id === preId : APP.cadId(r, 'region') === cad) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('') : '<span class="muted">No region</span>';
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
      const res = APP.createBoolRegion(a, ...boolArgs(), ((document.querySelector('input[name=boolLink]:checked') || {}).value) === 'strong');
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
      <details class="fold" open><summary>Alignment check on creation</summary><div>
        <label class="chk" title="After a detected feature, a plane from a face or a picked cylinder / box is created, propose exact values: axis on X / Y / Z, parallel / coaxial with other cylinders, equal radii, faces and ends coincident with other objects"><input type="checkbox" data-opt="snapOn" ${o.snapOn !== false ? 'checked' : ''}>Propose corrected values for new objects</label>
        <div class="row2"><span class="muted" style="flex:1">Length tolerance (mm)</span><input type="number" step="0.05" min="0" style="width:80px" data-opt="snapTol" value="${o.snapTol === undefined ? 0.2 : o.snapTol}"></div>
        <div class="row2"><span class="muted" style="flex:1">Angle tolerance (°)</span><input type="number" step="0.1" min="0" style="width:80px" data-opt="snapAng" value="${o.snapAng === undefined ? 0.5 : o.snapAng}"></div></div></details>
      <details class="fold" open><summary>INP block</summary><div>
        <div class="fld"><label>Title (line after GEOBEGIN)</label><input type="text" data-k="title" value="${esc(S.model.title)}"></div>
        <div class="fld" style="margin-top:6px"><label title="All INP coordinates and directions are written in this frame">Export coordinate system ⓘ</label><select data-k="exportCs"><option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${APP.exportCs() === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="fld" style="margin-top:6px"><label title="Name-based geometry (COMBNAME): free format, names ≤ 8 characters, lines ≤ 132 columns. Fixed columns: GEOBEGIN (A8,2X,6E10.0,A8), title (2I5,10X,A60).">Output format ⓘ</label><select data-opt="style">
          <option value="1" ${o.style == 1 ? 'selected' : ''}>Multi-line style (REGION + line)</option>
          <option value="2" ${o.style == 2 ? 'selected' : ''}>Compact aligned style</option>
          <option value="3" ${o.style == 3 ? 'selected' : ''}>Fixed columns (Fortran-like, ≤132 col)</option></select></div>
        <label class="chk" title="Adds a comment line (* in column 1) before GEOBEGIN"><input type="checkbox" data-opt="inpComment" ${o.inpComment ? 'checked' : ''}>Comment header in the INP</label></div></details>
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
  function itemHTML(t, o, ex) {
    ex = ex || {};
    const sel = S.sel && S.sel.t === t && S.sel.id === o.id;
    const warn = ex.warn && ex.warn.length ? `<span class="wicon" tabindex="0" title="${esc(ex.warn.join('\n'))}">⚠${ex.warn.length > 1 ? ex.warn.length : ''}</span>` : '';
    const info = ex.info ? `<span class="wicon info" tabindex="0" title="${esc(ex.info)}">ⓘ</span>` : '';
    const look = ex.look !== undefined ? `<button class="lk${ex.look ? ' on' : ''}" data-act="look" title="${ex.look === 'opaque' ? 'Always opaque (click: always transparent)' : ex.look === 'transparent' ? 'Always transparent (click: follow the global mode)' : 'Follows the global mode (click: always opaque)'}">${ex.look === 'opaque' ? '●' : ex.look === 'transparent' ? '○' : '◐'}</button>` : '';
    return `<div class="item${sel ? ' sel' : ''}${ex.ne ? ' ne' : ''}" data-t="${t}" data-id="${o.id}" draggable="true">
      <div class="top"><button class="vis${o.visible ? '' : ' off'}" data-act="vis" title="Show / hide">${o.visible ? ICON.eye : ICON.eyeOff}</button>
      ${o.color ? `<span class="sw" style="background:${o.color}"></span>` : ''}<span class="nm">${esc(o.name)}</span>${warn}${info}<span class="ty">${ex.ne ? '<span title="Not exported to the INP">⊘ </span>' : ''}${esc(o.type)}</span>${look}<button class="mn" data-act="imenu" title="Actions">⋮</button></div>
      ${o.opacity !== undefined ? `<div class="op"><input type="range" min="0" max="100" value="${Math.round(o.opacity * 100)}" data-act="op" aria-label="Opacity"><small>${Math.round(o.opacity * 100)}%</small></div>` : ''}</div>`;
  }
  /** Warnings shown next to a region in the tree (empty, quality check). */
  function regionWarns(r) {
    const c = APP.regionCache && APP.regionCache.get(r.id), w = [];
    if (c && c.diag && c.diag.length) w.push('Empty: ' + brief(String(c.diag[0].text)));
    if (c && c.quality) for (const q of c.quality) w.push(q.text);
    if (c && c.err) w.push(c.err);
    return w;
  }
  let UNUSED = new Set();
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
      case 'meshes': return itemHTML('stl', { id: o.id, name: o.name, type: o.format || 'STL', color: o.color, visible: o.visible, opacity: o.opacity }, { look: o.look || '' });
      case 'planes': case 'bodies': return itemHTML('body', { id: o.id, name: o.name, type: o.type === 'RAW' ? o.rawType : o.type, color: o.color, visible: o.visible, opacity: o.type === 'RAW' ? undefined : o.opacity },
        { ne: !!o.noExport, look: o.type === 'RAW' ? undefined : (o.look || ''), info: !o.noExport && UNUSED.has(o.id) ? 'Not used by any exported region' : '' });
      case 'regions': return itemHTML('region', { id: o.id, name: o.name, type: 'REGION', color: o.color, visible: o.visible, opacity: o.opacity }, { ne: !!o.noExport, look: o.look || '', warn: o.noExport ? [] : regionWarns(o), info: o.meta && o.meta.link ? 'Strong link (formula follows its parent regions)' : '' });
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
    UNUSED = new Set(APP.unusedBodies().map(b => b.id));
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
  /** New coordinate system: created with an editable definition and its Definition tab opened. */
  function newCsysEditable(parentWorldOf, parent) {
    const c = APP.createCsysWorld(APP.csysWorld(parentWorldOf), parent !== undefined ? { parent } : undefined); if (!c) return;
    c.def = APP.csDefNew(c); S.rtab = 'definition'; selectItem('csys', c.id);
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
        { label: 'New coordinate system (child of active)', fn: () => newCsysEditable(S.model.active || 0, undefined) },
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
        { label: 'New child coordinate system', fn: () => newCsysEditable(o.id, o.id) },
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
    if (a === 'look' && item) { const o = findItem(item.dataset.t, +item.dataset.id); if (o) { APP.snap(); const nx = { '': 'opaque', opaque: 'transparent', transparent: '' }[o.look || '']; if (nx) o.look = nx; else delete o.look; APP.applyStyles(); APP.changed({ tree: true, right: true }); } return; }
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

  function numField(label, attr, val) { return `<div class="fld"><label>${label}</label><input type="number" step="0.1" value="${esc(fmt(val, 6))}" ${attr}></div>`; }
  function commonStyle(o, withEdge) {
    return `<div class="row2"><span class="muted">Color</span><input type="color" data-k="color" value="${esc(o.color)}">
      <label class="chk" style="margin:0 0 0 auto"><input type="checkbox" data-k="visible" ${o.visible ? 'checked' : ''}>Visible</label></div>
      <div class="row2"><span class="muted">Opacity</span><input type="range" min="0" max="100" value="${Math.round(o.opacity * 100)}" data-k="opacity"></div>
      <div class="row2"><span class="muted" title="Overrides the global render mode for this object">Appearance ⓘ</span><select data-k="look"><option value="" ${!o.look ? 'selected' : ''}>Follow the global mode</option><option value="opaque" ${o.look === 'opaque' ? 'selected' : ''}>Always opaque</option><option value="transparent" ${o.look === 'transparent' ? 'selected' : ''}>Always transparent</option></select></div>`;
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
      const pq = q.find(x => x.kind === 'gap' || x.kind === 'pieces');
      const pcs = pq ? `<div class="msg"><label class="chk" style="margin:0" title="Each separate piece gets its own colour in the 3D view; the red spot marks where two pieces are closest"><input type="checkbox" data-opt="pieceHl" ${S.opt.pieceHl === false ? '' : 'checked'}>Highlight the ${pq.pieces} pieces${pq.spot ? ` · red spot: closest points, ${FK.fmt(pq.spot.d * 10, 4)} mm apart` : ''}</label> <span class="pieceleg">${PIECE_PAL.slice(0, Math.min(pq.pieces, 8)).map(c => `<i style="background:${c}"></i>`).join('')}</span></div>` : '';
      return pcs + '<div class="msg ok">Valid expression' + (q.length ? ` <span class="wicon" tabindex="0" title="${esc(q.map(x => x.text).join('\n'))}">⚠${q.length > 1 ? q.length : ''}</span>` : '') + '</div>';
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
  function inpNameHint(it, kind, eff) {
    const list = kind === 'region' ? S.model.regions : S.model.bodies, nm = FK.inpNames(S.model), map = kind === 'region' ? nm.regions : nm.bodies;
    if (it.noExport) return '';
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(eff)) return '<span class="bad">⚠ letters, digits and _ only; must start with a letter</span>';
    if (eff.length > 8) return '<span class="bad">⚠ more than 8 characters</span>';
    const dup = list.find(x => x !== it && !x.noExport && map.get(x) === eff); if (dup) return `<span class="bad">⚠ same INP name as "${esc(dup.name)}"</span>`;
    return eff !== it.name ? `<span class="muted">Written as <b>${esc(eff)}</b> in the INP file</span>` : '';
  }
  function exportRow(it, kind) {
    const unused = kind === 'body' && !APP.bodyUsed(it);
    const eff = APP.inpNameOf(kind, it), explicit = !!(it.inpName && it.inpName.trim());
    return `<div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-k="exportInp" ${it.noExport ? '' : 'checked'}>Export to the INP file</label>${unused ? ` <span class="wicon info" tabindex="0" title="Not used by any region">ⓘ not used</span>` : ''}</div>
      <div class="fld full"><label title="Name written in the INP file (max 8 characters). Left automatic, it is the name itself, cut to 8 characters and made unique.">INP name ${explicit ? '' : '<small class="muted">(automatic)</small>'}</label><div class="row2"><input type="text" data-k="inpName" maxlength="16" spellcheck="false" value="${esc(eff)}" ${it.noExport ? 'disabled' : ''}>${explicit ? '<button class="btn sm" data-act="inpNameReset" title="Back to the automatic name">↺ auto</button>' : ''}</div><div class="inpnhint" data-inpnhint>${inpNameHint(it, kind, eff)}</div></div>`;
  }
  /** "CAD source" select: automatic / none / one of the meshes. */
  function cadRow(it, kind) {
    const cur = it.meta && it.meta.cad !== undefined ? String(it.meta.cad === 0 ? 'none' : it.meta.cad) : '';
    const auto = APP.cadId(it, kind), an = auto ? APP.getStl(auto) : null;
    if (!S.stls.length) return '';
    return `<div class="fld full"><label title="Mesh this ${kind} was made from / is compared with (used to show / hide linked objects and for the CAD ↔ CG comparison)">CAD source ⓘ</label><select data-k="cad"><option value="" ${cur === '' ? 'selected' : ''}>Automatic${an && cur === '' ? ' → ' + esc(an.name) : ''}</option><option value="none" ${cur === 'none' ? 'selected' : ''}>None</option>${S.stls.map(m => `<option value="${m.id}" ${cur === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>`;
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
            return `<div class="fld"><div class="fl"><label>${info.fields[i]}</label>${canOne ? `<button class="pk sm${onOne ? ' on' : ''}" data-act="pickField" data-g="${gi}" data-i="${ii}" title="Pick this coordinate only" aria-label="Pick ${info.fields[i]} only">⌖</button>` : ''}</div><input type="number" step="0.1" value="${esc(fmt(b.p[i], 6))}" data-bf="${i}"></div>`;
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
      <div class="fld full"><label>Name (max 8 characters for CG)</label><input type="text" data-k="name" value="${esc(b.name)}"></div>${exportRow(b, 'body')}${cadRow(b, 'body')}${csHTML}</div></div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
    const definition = `<div class="sec"><h4><span>Geometric definition</span></h4><div class="fields">${defFields}${inpLine}</div>${planeBtns}</div>`;
    const view = b.type !== 'RAW' ? `<div class="sec"><h4><span>View</span></h4>${commonStyle(b)}</div>` : null;
    const operations = `<div class="sec"><h4><span>Operations</span></h4>${b.type !== 'RAW' ? scaleSection() : ''}
      <div class="btns">${b.type !== 'RAW' ? '<button class="btn" data-act="regFromBodyCut" title="Creates a region made of this body, then lets you click faces to cut it with planes">New region from this body + cut by faces…</button><button class="btn" data-act="snapCheck" title="Propose exact values: axis on X / Y / Z, coaxial / parallel with other cylinders, equal radii, faces and ends coincident with other objects">Check alignment with other objects…</button>' : ''}<button class="btn" data-act="dup">Duplicate</button></div>
      <div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
    return tabbed({ general, view, definition, operations });
  }
  function csysWorldHTML(c) {
    const w = APP.csysWorld(c.id), e = FK.M.toEuler(w);
    return kv([['Position (world)', xyz([w[3], w[7], w[11]], 5)], ['Angles (world)', xyz(e, 4) + '°'], ['Axe X', xyz([w[0], w[4], w[8]], 5)], ['Axe Y', xyz([w[1], w[5], w[9]], 5)], ['Axe Z', xyz([w[2], w[6], w[10]], 5)]]);
  }
  function cf(kind, i, val) { return `<input type="number" step="${kind === 'eul' ? 1 : 0.1}" data-cf="${kind}:${i}" value="${esc(fmt(val, 6))}">`; }
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
    const meth = c.def ? c.def.method : 'manual';
    const definition = `<div class="sec"><h4><span>Definition</span></h4><div class="fields"><div class="fld full"><label>Defined by</label><select data-cd="method">${[['manual', 'Position + angles (typed)'], ['axes', 'Origin + 2 axes (X, Y or Z)'], ['pts3', 'Origin + point on X + point in XY plane']].map(([k, l]) => `<option value="${k}" ${meth === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>${c.def ? csDefHTML(c) : ''}</div>
      <div class="sec"><h4><span>${c.def ? 'Resulting position and orientation' : 'Position and orientation'}</span></h4>
      <div class="muted" style="font-size:12px">Relative to the parent system.${c.def ? ' Editing these values switches the definition back to typed.' : ''}</div><div>
        <div class="fld full grp"><div class="gh"><label>Position X, Y, Z (cm)</label><button class="pk${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === undefined ? ' on' : ''}" data-act="pickCsysPos" title="Pick the whole origin in the 3D view" aria-label="Pick the origin">⌖</button></div><div class="g3">${[0, 1, 2].map(i => `<div class="fld"><div class="fl"><label>${'XYZ'[i]}</label><button class="pk sm${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === i ? ' on' : ''}" data-act="pickCsysPos" data-i="${i}" title="Pick this coordinate only">⌖</button></div>${cf('pos', i, [m[3], m[7], m[11]][i])}</div>`).join('')}</div></div>
        ${grid3('Angles α, β, γ (°) — R = Rz(γ)·Ry(β)·Rx(α)', 'eul', e)}
        ${grid3('X axis vector', 'xa', [m[0], m[4], m[8]])}
        ${grid3('Approx. Y axis vector (Z = X × Y)', 'ya', [m[1], m[5], m[9]])}
      </div>
      <details class="fold"><summary>3×4 matrix (rotation | translation)</summary><div>
        <div class="btns"><button class="btn sm" data-act="cmPaste" title="Read 12 numbers (3 rows × 4 columns) from the clipboard">📋 Paste 3×4 matrix</button><button class="btn sm" data-act="cmInvert" title="Replace the matrix by its inverse: use it when you entered CSYS0→CSYS1 and wanted CSYS1→CSYS0 (or the reverse)">⇄ Invert (A→B ↔ B→A)</button></div>
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
  const SLOT_SRC = [['xyz', 'Coordinates'], ['pick', 'Point / vertex in the view'], ['arc', 'Centre of a circular edge'], ['mid', 'Midpoint of an edge'], ['planes3', 'Intersection of 3 faces']];
  const AX_SRC = [['vec', 'Vector (typed)'], ['pts', 'Two points'], ['face', 'Normal of a face'], ['edge', 'Direction of an edge'], ['circ', 'Axis of a circular edge']];
  const SLOT_MODE = { pick: 'vertex', arc: 'arc', mid: 'mid', planes3: 'planes3' };
  function slotHTML(c, label, path) {
    const sl = APP.csSlot(c.def, path), on = S.fill && S.fill.kind === 'csdef' && S.fill.slot === path;
    return `<div class="fld full grp csd"><div class="gh"><label>${label}</label><select class="mini" data-cd="${path}|src">${SLOT_SRC.map(([k, l]) => `<option value="${k}" ${sl.src === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${sl.src !== 'xyz' ? `<button class="pk${on ? ' on' : ''}" data-act="csdPick" data-path="${path}" title="Pick in the 3D view" aria-label="Pick">⌖</button>` : ''}</div>
      <div class="g3">${[0, 1, 2].map(i => `<input type="number" step="any" data-cd="${path}|p${i}" value="${fmt(sl.p[i], 6)}">`).join('')}</div></div>`;
  }
  function axisHTML(c, which, title) {
    const a = c.def[which], v = APP.csAxisVec(a), pk = ['face', 'edge', 'circ'].includes(a.src), on = S.fill && S.fill.kind === 'csdef' && S.fill.ax === which;
    return `<div class="csdax"><h5>${title}</h5><div class="fld full"><div class="row2"><label style="margin:0">This axis is</label><select class="mini" data-cd="${which}|axis">${['X', 'Y', 'Z'].map(L => `<option ${a.axis === L ? 'selected' : ''}>${L}</option>`).join('')}</select>
<button class="btn sm" data-act="csdFlip" data-ax="${which}" title="Reverse the direction">⇄ Reverse</button></div>
      <div class="row2" style="margin-top:4px"><select data-cd="${which}|src" style="flex:1;min-width:0">${AX_SRC.map(([k, l]) => `<option value="${k}" ${a.src === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${pk ? `<button class="pk${on ? ' on' : ''}" data-act="csdPickAxis" data-ax="${which}" title="Pick in the 3D view" aria-label="Pick">⌖</button>` : ''}</div></div>
      <div class="g3">${[0, 1, 2].map(i => `<input type="number" step="any" data-cd="${which}|v${i}" value="${fmt(v[i], 6)}" ${a.src === 'pts' ? 'readonly' : ''}>`).join('')}</div>
      ${a.src === 'pts' ? slotHTML(c, 'From point', which + '.p1') + slotHTML(c, 'To point', which + '.p2') : ''}</div>`;
  }
  function csDefHTML(c) {
    const d = c.def;
    let h = `<div class="muted" style="font-size:12px">Values below are in world coordinates. Each point can be typed, picked on a vertex, taken at the centre of a circular edge, the midpoint of an edge, or the intersection of 3 faces.</div>` + slotHTML(c, 'Origin', 'o');
    if (d.method === 'pts3') h += slotHTML(c, 'Point on the X axis', 'px') + slotHTML(c, 'Point in the XY plane (+Y side)', 'pxy');
    else h += axisHTML(c, 'a', 'Axis 1 (kept exactly)') + axisHTML(c, 'b', 'Axis 2 (made perpendicular to axis 1)') + `<div class="muted" style="font-size:12px">The third axis is deduced (right-handed system).</div>`;
    if (d.error) h += `<div class="msg bad">⚠ ${esc(d.error)}</div>`; else if (d.note) h += `<div class="msg">ⓘ ${esc(d.note)}</div>`;
    return h;
  }
  function onCsDefField(e, t, c) {
    if (e.type !== 'change') return;
    const [path, field] = t.dataset.cd.split('|'), d = c.def, key = 'csdef' + c.id;
    if (path !== 'method' && !d) return;
    if (path === 'method') {
      APP.snap(); if (t.value === 'manual') { c.def = null; APP.changed({ tree: true, right: true }); return; }
      c.def = APP.csDefNew(c); c.def.method = t.value; APP.applyCsysDef(c, key); APP.changed({ tree: true, right: true }); return;
    }
    APP.snap(key);
    if (path === 'a' || path === 'b') {
      const a = d[path], o = d[path === 'a' ? 'b' : 'a'];
      if (field === 'axis') { if (o.axis === t.value) o.axis = a.axis; a.axis = t.value; }
      else if (field === 'src') { if (t.value === 'pts' && a.src !== 'pts') { const v = APP.csAxisVec(a); a.p2.p = V.add(a.p1.p, v); } else if (a.src === 'pts') { a.v = APP.csAxisVec(a); a.flip = false; } a.src = t.value; }
      else { const i = +field[1], v = parseFloat(t.value); if (!isFinite(v)) return; a.v = APP.csAxisVec(a); a.flip = false; a.v[i] = v; a.src = 'vec'; }
    } else {
      const sl = APP.csSlot(d, path);
      if (field === 'src') sl.src = t.value; else { const i = +field[1], v = parseFloat(t.value); if (!isFinite(v)) return; sl.p[i] = v; sl.src = 'xyz'; }
    }
    APP.applyCsysDef(c, key); APP.changed({ tree: true, right: true });
  }
  let csysSrc = null;
  function applyMatrixText(c, text) {
    const r = FK.parseMatrix34(text); if (r.error) { toast(r.error); return; }
    if (APP.setCsysLocal(c, r.m, null, false)) toast(`${c.name}: 3×4 matrix pasted${r.note ? ' (' + r.note + ')' : ''}`);
  }
  document.addEventListener('paste', e => {          // Ctrl+V in a matrix cell with a whole matrix in the clipboard
    const t = e.target; if (!t || !t.dataset || !t.dataset.cf || !t.dataset.cf.startsWith('cm:')) return;
    const tx = (e.clipboardData || window.clipboardData).getData('text'); const r = FK.parseMatrix34(tx);
    if (r.error) { if (/(\d[\s,;]+){3}/.test(tx)) toast(r.error); return; }
    e.preventDefault(); const c = APP.selItem(); if (c && S.sel.t === 'csys') applyMatrixText(c, tx);
  });
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
    const bodyTypeOf = (b) => b.type === 'RAW' ? (b.rawType || 'RAW') : b.type;
    const byType = new Map(); for (const b of S.model.bodies) { const t = bodyTypeOf(b); if (!byType.has(t)) byType.set(t, []); byType.get(t).push(b); }
    const collate = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const opts = [...byType.keys()].sort(collate.compare).map(t => `<optgroup label="${esc(t)}">${byType.get(t).sort((x, y) => collate.compare(x.name, y.name)).map(b => `<option value="${esc(b.name)}"${S.termSel === b.name ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</optgroup>`).join('');
    const general = `<div class="sec"><h4><span>Region</span></h4><div class="fields">
      <div class="fld"><label>Name</label><input type="text" data-k="name" value="${esc(r.name)}"></div>
      <div class="fld"><label>Neighbour regions (2nd field)</label><input type="number" step="1" min="0" value="${r.nvois}" data-k="nvois"></div>${exportRow(r, 'region')}${cadRow(r, 'region')}</div></div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
    const lk = r.meta && r.meta.link, others = S.model.regions.filter(x => x.id !== r.id);
    const regOpts = (sel) => others.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const linkBlock = lk ? `<div class="sec"><h4><span>⛓ Strong link <small class="muted">(live formula)</small></span></h4><div class="fields">
      <div class="fld"><label>Region A</label><select data-k="lnkA">${regOpts(lk.a)}</select></div>
      <div class="fld"><label>Region B</label><select data-k="lnkB">${regOpts(lk.b)}</select></div>
      <div class="fld"><label>Operation</label><select data-k="lnkOp"><option value="sub" ${lk.op === 'sub' ? 'selected' : ''}>A − B</option><option value="int" ${lk.op === 'int' ? 'selected' : ''}>A ∩ B</option><option value="union" ${lk.op === 'union' ? 'selected' : ''}>A ∪ B</option></select></div>
      <div class="fld"><label>Form</label><select data-k="lnkMode"><option value="compact" ${lk.mode !== 'expanded' ? 'selected' : ''}>Compact</option><option value="expanded" ${lk.mode === 'expanded' ? 'selected' : ''}>Expanded (De Morgan)</option></select></div></div>
      ${lk.error ? `<div class="msg bad">${esc(lk.error)}</div>` : ''}
      <div class="btns"><button class="btn sm" data-act="unlinkRegion" title="Keep the current formula and make it editable">Unlink (keep formula)</button></div></div>` : '';
    const definition = `${linkBlock}<div class="sec"><h4><span>Definition</span></h4><div class="fields">
      <div class="fld full"><label>Expression  (+ inside · − outside · | union · parentheses)${lk ? ' — read-only while linked' : ''}</label><div class="exprwrap"><textarea class="expr" id="exprArea" data-k="expr" spellcheck="false" ${lk ? 'readonly' : ''}>${esc(r.expr)}</textarea><div class="exprmirror" id="exprMirror" aria-hidden="true"></div></div></div></div>
      <div id="exprMsg">${regionMsg(r)}</div>
      <div class="row2"><select id="termBody"><option value="">— body —</option>${opts}</select></div>
      <div class="btns exprbtns"><button class="btn sm" data-act="cutRegion" title="Click a face of a mesh or object: its plane is created (or reused) and added to this formula">✂ Cut by a face…</button><button class="btn sm" data-act="pickRegion" title="Click a body or plane in the 3D view: it gets selected in the list below (overlapping objects are listed so you can choose)">🖱 Pick in view…</button><button class="btn sm" data-act="termAdd" title="Insert +body at the cursor">+ add</button><button class="btn sm" data-act="termSub" title="Insert -body at the cursor">− subtract</button><button class="btn sm" data-act="termUnion" title="Insert the union symbol | at the cursor">| union</button><button class="btn sm" data-act="termParen" title="Insert a pair of parentheses at the cursor (wraps the selection)">( )</button><button class="btn sm" data-act="termDel" title="Remove every occurrence of the chosen body">remove</button></div></div>`;
    const view = `<div class="sec"><h4><span>View</span></h4>${commonStyle(r)}</div>`;
    const operations = `<div class="sec"><h4><span>Operations</span></h4>
      <div class="btns"><button class="btn" data-act="boolRegion" title="New region = this one minus / ∩ / ∪ another region, written with their bodies">Combine with another region… <small>(experimental)</small></button>
      <button class="btn" data-act="voidRegion" title="RPP around this region + region = RPP minus this one">Create void region… <small>(experimental)</small></button>
      <button class="btn" data-act="regionCompare" title="Colour this region by its distance to its CAD mesh; volumes and metrics">Compare with CAD…</button>
      <button class="btn" data-act="dup">Duplicate</button></div>
      <div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
    return tabbed({ general, view, definition, operations });
  }
  /** One mesh per connected solid of a mesh. */
  function splitStl(s) {
    const comps = FK.meshComponents(s.raw).filter(c => c.count >= 4);
    if (comps.length < 2) { toast('Only one solid in this mesh'); return; }
    const L = APP.cadLinked(s.id), nLinked = L.bodies.length + L.planes.length + L.regions.length;
    const names = new Set(S.stls.map(m => m.name));
    comps.forEach((c, k) => {
      let nm = s.name + '_' + (k + 1); for (let q = 2; names.has(nm); q++) nm = s.name + '_' + (k + 1) + ' (' + q + ')'; names.add(nm);
      const m = { id: APP.nid(), name: nm, file: s.file || s.name, format: s.format, raw: c.positions, unit: s.unit, offset: s.offset.slice(), flip: s.flip, visible: true, opacity: s.opacity, color: FK.PALETTE[(S.stls.length + k) % FK.PALETTE.length], edges: c.count <= 80000, group: null, mesh: null };
      APP.buildStl(m); S.stls.push(m);
    });
    if (nLinked) { s.visible = false; toast(`${comps.length} meshes created; the original is kept (hidden) because CG objects are linked to it`); }
    else { if (APP.hooks.disposeStl) APP.hooks.disposeStl(s); S.stls = S.stls.filter(x => x.id !== s.id); S.sel = null; toast(`${comps.length} meshes created`); }
    APP.changed({ tree: true, right: true });
  }
  /** What is linked to a mesh + quick show / hide. */
  function linkedHTML(s) {
    const L = APP.cadLinked(s.id), n = L.bodies.length + L.planes.length + L.regions.length;
    return `<div class="sec"><h4><span>Linked CG objects</span></h4>
      <div class="muted" style="font-size:12.5px">${n ? `${L.bodies.length} bod${L.bodies.length === 1 ? 'y' : 'ies'} · ${L.planes.length} plane${L.planes.length === 1 ? '' : 's'} · ${L.regions.length} region${L.regions.length === 1 ? '' : 's'}` : 'None yet (planes picked on a face, detected features and regions made of them are linked automatically).'}</div>
      ${n ? `<div class="btns"><button class="btn sm" data-act="cadShow">Show</button><button class="btn sm" data-act="cadHide">Hide</button><button class="btn sm" data-act="cadIsolate" title="Show only this mesh and what is linked to it">Isolate</button></div>` : ''}</div>`;
  }
  function stlProps(s) {
    const unitOpts = ['mm', 'cm', 'm', 'in'].map(u => `<option ${s.unit === u ? 'selected' : ''}>${u}</option>`).join('');
    const general = `<div class="sec"><h4><span>Mesh file</span></h4><div class="fields">
      <div class="fld full"><label>Name</label><input type="text" data-k="name" value="${esc(s.name)}"></div>${s.file ? `<div class="fld full"><div class="muted" style="font-size:12px">File: ${esc(s.file)}</div></div>` : ''}</div></div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>${linkedHTML(s)}`;
    const definition = `<div class="sec"><h4><span>Placement</span></h4><div class="fields">
      <div class="fld"><label>File unit</label><select data-k="unit">${unitOpts}</select></div>
      <div class="fld"><label>&nbsp;</label><label class="chk" style="margin:0"><input type="checkbox" data-k="flip" ${s.flip ? 'checked' : ''}>Flip normals</label></div>
      ${numField('Offset X (cm)', 'data-off="0"', s.offset[0])}${numField('Offset Y (cm)', 'data-off="1"', s.offset[1])}${numField('Offset Z (cm)', 'data-off="2"', s.offset[2])}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">Everything is converted to cm (CG unit) on import. Mesh normals point out of the material.</div></div>`;
    const view = `<div class="sec"><h4><span>View</span></h4>${commonStyle(s)}
      <div class="row2"><label class="chk" style="margin:0"><input type="checkbox" data-k="edges" ${s.edges ? 'checked' : ''}>Sharp edges</label></div></div>`;
    const operations = `<div class="sec"><h4><span>Operations</span></h4>
      <div class="btns"><button class="btn" data-act="rppStl">Bounding RPP</button><button class="btn" data-act="detectFeat">Detect features… <small>(experimental)</small></button>
      <button class="btn" data-act="cadCompare" title="Colour the CG regions linked to this mesh by their distance to it, volumes and metrics">Compare with CG regions…</button>
      <button class="btn" data-act="splitStl" title="One mesh per connected solid">Split into solids</button></div>
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
    if (t.dataset.cd !== undefined) { if (S.sel.t === 'csys') onCsDefField(e, t, it); return; }
    if (t.dataset.cf !== undefined) { if (S.sel.t === 'csys') { if (it.def && (e.type === 'input' || e.type === 'change')) { it.def = null; } onCsysField(e, t, it); } return; }
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
      case 'cad': if (e.type === 'change') { APP.snap(); it.meta = it.meta || {}; if (t.value === '') delete it.meta.cad; else it.meta.cad = t.value === 'none' ? 0 : +t.value; APP.changed({ tree: true, right: true }); } break;
      case 'exportInp': if (e.type === 'change') {
        if (t.checked) { APP.snap(); delete it.noExport; APP.changed({ tree: true, right: true }); break; }
        const imp = APP.exportImpact(type, it).filter(x => !x.item.noExport);
        if (!imp.length) { APP.snap(); it.noExport = true; APP.changed({ tree: true, right: true }); break; }
        t.checked = true;                                   // stays checked until the user decides
        askImpact(type, it, imp).then(res => { if (res === 'cancel') return; APP.snap(); it.noExport = true; if (res === 'all') imp.forEach(x => { x.item.noExport = true; }); APP.changed({ tree: true, right: true }); });
      } break;
      case 'inpName': {
        if (e.type !== 'input' && e.type !== 'change') break;
        APP.snap(key + 'inpn'); const v = t.value.trim();
        if (v) it.inpName = v; else delete it.inpName;
        if (e.type === 'change') { APP.changed({ right: true }); break; }
        APP.changed({}); const h = $('#rightBody [data-inpnhint]'); if (h) h.innerHTML = inpNameHint(it, type, v || APP.inpNameOf(type, it));
        break;
      }
      case 'nvois': { const v = parseInt(t.value, 10); if (isFinite(v) && v >= 0) { APP.snap(key + 'nv'); it.nvois = v; APP.changed({}); } break; }
      case 'lnkA': case 'lnkB': case 'lnkOp': case 'lnkMode': if (e.type === 'change' && it.meta && it.meta.link) { APP.snap(); const l = it.meta.link; if (k === 'lnkA') l.a = +t.value; else if (k === 'lnkB') l.b = +t.value; else if (k === 'lnkOp') l.op = t.value; else l.mode = t.value; APP.changed({ tree: true, right: true }); } break;
      case 'expr': if (it.meta && it.meta.link) break; APP.snap(key + 'expr'); it.expr = t.value; APP.changed({}); break;
      case 'color': if (e.type === 'input') { APP.snap(key + 'col'); it.color = t.value; APP.changed({ tree: true, csys: type === 'csys' }); } break;
      case 'look': if (e.type === 'change') { APP.snap(); if (t.value) it.look = t.value; else delete it.look; APP.applyStyles(); APP.changed({ tree: true }); } break;
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
      case 'look': break;
      case 'cadShow': case 'cadHide': case 'cadIsolate': if (it && S.sel.t === 'stl') { const k = APP.cadVisibility(it.id, act === 'cadShow' ? 'show' : act === 'cadHide' ? 'hide' : 'isolate'); toast(k + ' linked object(s) ' + (act === 'cadHide' ? 'hidden' : act === 'cadShow' ? 'shown' : 'isolated')); } break;
      case 'cadCompare': if (it && S.sel.t === 'stl') openDevDlg({ cad: it.id }); break;
      case 'unlinkRegion': if (it && it.meta && it.meta.link) { APP.snap(); delete it.meta.link; APP.changed({ tree: true, right: true }); toast('Link removed; the formula is kept'); } break;
      case 'snapCheck': if (it && S.sel.t === 'body') suggestSnap(it, true); break;
      case 'pickRegion': if (it && S.sel.t === 'region') { if (it.meta && it.meta.link) { toast('This region follows a live link: its formula is read-only'); break; } S.cutRid = it.id; setTool('regpick'); if (narrow()) setDrawer('right', false); } break;
      case 'cmPaste': if (it && S.sel.t === 'csys') {
        if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Clipboard not accessible here: click a matrix cell and press Ctrl+V'); break; }
        navigator.clipboard.readText().then(tx => applyMatrixText(it, tx)).catch(() => toast('Clipboard access refused: click a matrix cell and press Ctrl+V'));
      } break;
      case 'cmInvert': if (it && S.sel.t === 'csys') {
        const inv = FK.M.inv(it.m); if (!inv || !inv.every(Number.isFinite)) { toast('This matrix cannot be inverted'); break; }
        if (APP.setCsysLocal(it, inv, null, false)) toast(`${it.name}: matrix inverted (it now maps the other way)`);
      } break;
      case 'csdPick': if (it && S.sel.t === 'csys' && it.def) { const path = a.dataset.path, sl = APP.csSlot(it.def, path); startFill({ kind: 'csdef', id: it.id, slot: path, mode: SLOT_MODE[sl.src] || 'vertex' }); } break;
      case 'csdPickAxis': if (it && S.sel.t === 'csys' && it.def) { const ax = a.dataset.ax, src = it.def[ax].src; startFill({ kind: 'csdef', id: it.id, ax, mode: src === 'face' ? 'face' : src === 'edge' ? 'edge' : 'circ' }); } break;
      case 'csdFlip': if (it && S.sel.t === 'csys' && it.def) { APP.snap('csdef' + it.id); const ax = it.def[a.dataset.ax]; ax.flip = !ax.flip; APP.applyCsysDef(it, 'csdef' + it.id); APP.changed({ tree: true, right: true }); } break;
      case 'inpNameReset': if (it) { APP.snap(); delete it.inpName; APP.changed({ right: true }); } break;
      case 'ptUndo': S.ptPlanes = (S.ptPlanes || []).slice(0, -1); ptRefreshPending(); renderToolOpts(); updateStatus(); break;
      case 'cutRegion': if (it && S.sel.t === 'region') { S.cutRid = it.id; setTool('regcut'); if (narrow()) setDrawer('right', false); } break;
      case 'regFromBodyCut': if (it && S.sel.t === 'body') { APP.snap(); const r = APP.addRegion(APP.regionNameFor(it.name), '+' + it.name, { visible: true }); S.sel = { t: 'region', id: r.id }; S.cutRid = r.id; APP.changed({ tree: true, right: true }); S.opt.cutStay = true; setTool('regcut'); if (narrow()) setDrawer('right', false); } break;
      case 'regionCompare': if (it && S.sel.t === 'region') openDevDlg({ region: it.id }); break;
      case 'splitStl': if (it && S.sel.t === 'stl') splitStl(it); break;
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
      case 'rppStl': if (it && it.stats && it.stats.bbox) { const nb = APP.rppFromBox(it.stats.bbox); nb.meta = nb.meta || {}; nb.meta.cad = it.id; APP.changed({ tree: true, right: true }); } break;
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
    if (S.fill.kind === 'csys' || S.fill.kind === 'csdef') return { kind: 'point' };
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
    { const fb = S.fill && S.fill.id ? APP.getBody(S.fill.id) : null; S.fill = null; APP.changed({ tree: true, right: true }); renderToolOpts(); updateStatus(); if (fb) suggestSnap(fb); }
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
    S.fill = fl; S.winOpen = true; S.pending = null; S.cs3 = []; S.ptPlanes = []; APP.setPending(null);
    if (S.tool !== 'select') { S.tool = 'select'; syncToolbar(); }
    clearPick(); APP.clearHover(); hoverText = '';
    renderToolOpts(); renderRight(); updateStatus();
    if (narrow()) setDrawer('right', false);
  }
  function cancelFill() {
    if (!S.fill) return;
    S.fill = null; S.fillPts = []; S.ptPlanes = []; APP.setPending(null); renderToolOpts(); renderRight(); updateStatus();
  }
  function csdefPick(hit, x, y) {
    const d = S.fill, c = APP.getCsys(d.id); if (!c || !c.def) { cancelFill(); return; }
    APP.snap('csdef' + c.id);
    if (d.slot) {
      const rp = resolvePoint(hit, x, y); if (!rp || rp.wait) return;
      const sl = APP.csSlot(c.def, d.slot); sl.p = rp.p.slice();
    } else {
      const a = c.def[d.ax];
      if (d.mode === 'face') { a.v = APP.makePick(hit, 'face', x, y).normal.slice(); }
      else {
        const e = edgePickForFill(hit, x, y); if (e.none) { toast('No sharp edge here: click closer to an edge (or lower the edge angle)'); return; }
        if (d.mode === 'edge') { const p = e.chain ? e.chain.a : e.a, q = e.chain ? e.chain.b : e.b; a.v = V.sub(q, p); }
        else { if (!e.circle) { toast('This edge is not part of a circular rim: click an arc / circle edge, or adjust the edge angle'); return; } a.v = e.circle.n.slice(); }
      }
      a.flip = false;
    }
    S.fill = null; S.ptPlanes = []; APP.setPending(null);
    APP.applyCsysDef(c, 'csdef' + c.id); renderToolOpts(); updateStatus();
    if (narrow()) setDrawer('right', true);
  }
  function fillFromHit(hit, x, y) {
    if (S.fill && S.fill.kind === 'csdef') return csdefPick(hit, x, y);
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
      { const fb = S.fill && S.fill.id ? APP.getBody(S.fill.id) : null; S.fill = null; APP.changed({ tree: true, right: true }); renderToolOpts(); updateStatus(); if (fb) suggestSnap(fb); }
      if (narrow()) setDrawer('right', true);
      return;
    }
    let pk;
    if (sp.kind === 'normal') pk = APP.makePick(hit, 'face', x, y);
    else if (S.fill.kind === 'csys') { const rp = resolvePoint(hit, x, y); if (!rp || rp.wait) return; pk = { p: rp.p }; }
    else pk = APP.pointFromHit(hit, x, y);
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
    if (S.fill && (S.fill.kind === 'csys' || S.fill.kind === 'csdef')) return hoverPoint(hit, x, y);
    if (S.fill) { const sp = fillSpec(); return sp && sp.kind === 'normal' ? APP.makePick(hit, 'face', x, y) : sp && EDGE_KINDS.includes(sp.kind) ? edgePickForFill(hit, x, y) : APP.pointFromHit(hit, x, y); }
    if (S.tool === 'select') return S.info ? APP.makePick(hit, S.filter, x, y) : null;
    if (S.tool === 'measure' || S.tool === 'rpp' || S.tool === 'csys3') return hoverPoint(hit, x, y);
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
          const pk = resolvePoint(hit, x, y); if (!pk || pk.wait) break;
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
          const pk = resolvePoint(hit, x, y); if (!pk || pk.wait) break;
          if (!S.pending) { S.pending = pk.p; APP.setPending(pk.p); updateStatus(); }
          else {
            const a = S.pending; APP.setPending(null); S.pending = null;
            const b = APP.createRpp(a, pk.p);
            toast('RPP ' + b.name + ' created'); setTool('select');
          }
          break;
        }
        case 'csys3': {
          const pk = resolvePoint(hit, x, y); if (!pk || pk.wait) break;
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
        case 'regpick': {
          const o = APP.ownerOf(hit);
          if (o.kind !== 'body') { toast('Only bodies and planes can be picked: click one of them'); break; }
          const b = APP.getBody(o.id); if (!b) break;
          S.termSel = b.name; setTool('select');
          const rr = APP.getRegion(S.cutRid); if (rr) S.sel = { t: 'region', id: rr.id };
          APP.changed({ tree: true, right: true });
          const sel = $('#termBody'); if (sel) { sel.value = b.name; sel.classList.add('flash'); setTimeout(() => sel.classList.remove('flash'), 1200); }
          toast(`${b.name} selected: use + add, − subtract or | union`);
          if (narrow()) setDrawer('right', true);
          break;
        }
        case 'regcut': {
          const r = APP.getRegion(S.cutRid); if (!r) { setTool('select'); break; }
          const pk = APP.makePick(hit, 'face', x, y);
          APP.snap();
          const pl = APP.planeForCut(pk), zone = S.opt.cutZone === undefined ? 'all' : S.opt.cutZone;
          const res = APP.addRegionTerm(r, zone === 'all' ? 'all' : +zone, S.opt.cutKeep === '-' ? -1 : 1, pl.body.name);
          if (res.error) { toast(res.error); break; }
          S.sel = { t: 'region', id: r.id }; APP.changed({ tree: true, right: true });
          toast(`${S.opt.cutKeep === '-' ? '−' : '+'}${pl.body.name} ${pl.created ? 'created and ' : '(existing plane) '}added to ${r.name}`);
          if (!S.opt.cutStay) setTool('select');
          break;
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
    const nun = APP.unusedBodies().length;
    $('#inpWarn').innerHTML = w.map(esc).join('<br>') + (nun ? `${w.length ? '<br>' : ''}<button class="pill" data-skipunused title="Stops exporting the bodies and planes that no exported region uses">Do not export the ${nun} unused object${nun > 1 ? 's' : ''}</button>` : '');
    const badge = $('#warnBadge'); badge.hidden = !w.length; badge.textContent = w.length;
  }
  $('#inpWarn').addEventListener('click', e => { if (e.target.closest('[data-skipunused]')) { const n = APP.skipUnusedBodies(); toast(`${n} unused object${n > 1 ? 's' : ''} no longer exported`); } });
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
        const base = file.name.replace(/\.(stl|obj)$/i, ''), kind = res.format === 'OBJ' ? 'OBJ' : res.binary ? 'binary STL' : 'ASCII STL';
        if (res.parts && res.parts.length > 1) {      // several objects in one file → independent CAD objects
          const names = new Set(S.stls.map(m => m.name));
          res.parts.forEach((pt, k) => {
            let nm = pt.name && pt.name !== 'default' ? pt.name : base + '_' + (k + 1); for (let q = 2; names.has(nm); q++) nm = (pt.name || base) + ' (' + q + ')'; names.add(nm);
            const stl = { id: APP.nid(), name: nm, file: file.name, format: res.format || 'STL', raw: pt.positions, unit: 'mm', offset: [0, 0, 0], flip: false, visible: true, opacity: 0.6, color: FK.PALETTE[(S.stls.length + k) % FK.PALETTE.length], edges: pt.count <= 80000, group: null, mesh: null };
            APP.buildStl(stl); S.stls.push(stl); S.sel = { t: 'stl', id: stl.id };
          });
          ok++;
          toast(`${file.name}: ${res.parts.length} objects → ${res.parts.length} independent meshes (${res.count} triangles, ${kind}) — assumed unit: mm`);
          continue;
        }
        const stl = { id: APP.nid(), name: base, file: file.name, format: res.format || 'STL', raw: res.positions, unit: 'mm', offset: [0, 0, 0], flip: false, visible: true, opacity: 0.6, color: '#8f9bb0', edges: res.count <= 80000, group: null, mesh: null };
        APP.buildStl(stl); S.stls.push(stl); S.sel = { t: 'stl', id: stl.id }; ok++;
        let extra = '';
        if (res.count <= 300000) { const nc = FK.meshComponents(res.positions).filter(c => c.count >= 4).length; if (nc > 1) extra = ` — ${nc} disjoint solids: use Operations ▸ Split into solids`; }
        toast(`${file.name}: ${res.count} triangles (${kind}) — assumed unit: mm${extra}`);
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
  window.APP_DEBUG = { startFill, processHit, newCsysEditable, resolvePoint, ptRefreshPending, suggestSnap, chkSolve, chkRun, openDevDlg, devRun, splitStl, guidedToggle, guidedArm, openFeatDlg, loadStlFiles, setTool, setFilter, setPick, flush, renderRight };
})();
