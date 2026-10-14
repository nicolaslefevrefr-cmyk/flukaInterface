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
  $('#btnInp').onclick = () => { sheet.classList.toggle('open'); updateInp(); };
  $('#btnInpClose').onclick = () => sheet.classList.remove('open');

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
      if (fl.tree) { renderLeft(); renderToolOpts(); }
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
    if (S.fill) h += chk('snap', 'Snap to vertices');
    else if (S.tool === 'select') {
      if (S.filter === 'point') h += chk('snap', 'Snap to vertices');
      else if (S.filter === 'edge') h += chk('edgeSharpOnly', 'Sharp edges only') + num('sharp', 'angle ≥', '°');
      else if (S.filter === 'face') h += chk('coplanar', 'Whole face (coplanar triangles)') + num('coTol', 'tolerance', '°');
      else h += '<label class="muted">Click an object (mesh, body or region)</label>';
    } else if (S.tool === 'measure') h += chk('snap', 'Snap to vertices');
    else if (S.tool === 'rpp') h += chk('snap', 'Snap to vertices');
    else if (S.tool === 'csys3') h += chk('snap', 'Snap to vertices') + '<label class="muted">Created as a child of the active system</label>';
    else if (S.tool === 'plane' || S.tool === 'replane') {
      const regs = S.model.regions.map(r => `<option value="${r.id}" ${String(o.cutTarget) === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
      h += chk('coplanar', 'Highlight the whole face') +
        `<label>Target <select data-opt="cutTarget"><option value="auto" ${o.cutTarget === 'auto' ? 'selected' : ''}>Auto (selection)</option><option value="none" ${o.cutTarget === 'none' ? 'selected' : ''}>None</option>${regs}</select></label>` +
        `<label>Keep <select data-opt="planeSide"><option value="+" ${o.planeSide === '+' ? 'selected' : ''}>material side (+PLA)</option><option value="-" ${o.planeSide === '-' ? 'selected' : ''}>opposite side (−PLA)</option></select></label>`;
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
      case 'edge': return pk.none ? 'No sharp edge here (see the "sharp edges" option)' : `Edge: ${f(pk.chain ? pk.chain.length : pk.length, 4)} cm${pk.chain ? ' (' + pk.chain.segments + ' segments)' : ''}`;
      case 'face': return `Face: ${f(pk.area, 4)} cm² · ${pk.count} triangle${pk.count > 1 ? 's' : ''} · n = (${xyz(pk.normal, 3)})`;
      case 'object': { const st = APP.objectStats(pk); return `Object ${esc(pk.ownerName)}${st.volume !== undefined && st.volume !== null ? ' · V = ' + f(st.volume, 3) + ' cm³' : ''}`; }
    }
    return '';
  }
  function updateStatus() {
    let t = '';
    if (S.fill) {
      const sp = fillSpec(), one = S.fill.only !== undefined ? ' (single coordinate)' : '';
      t = sp && sp.kind === 'normal' ? 'Pick: click a face to take its outward normal · <a href="#" data-act="cancelFill">Cancel (Esc)</a>'
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
  $('#btnSettings').onclick = () => {
    const o = S.opt;
    $('#settingsBody').innerHTML = `<details class="fold" open><summary>Display</summary><div>
        <label class="chk"><input type="checkbox" data-opt="axes" ${o.axes ? 'checked' : ''}>Axes at the origin (X red, Y green, Z blue)</label>
        <div class="row2"><span class="muted" style="flex:1">Render zone margin (%)</span><input type="number" step="1" min="0" style="width:80px" data-opt="margin" value="${o.margin}"></div></div></details>
      <details class="fold" open><summary>INP block</summary><div>
        <div class="fld"><label>Title (line after GEOBEGIN)</label><input type="text" data-k="title" value="${esc(S.model.title)}"></div>
        <div class="fld" style="margin-top:6px"><label>Output format</label><select data-opt="style">
          <option value="1" ${o.style == 1 ? 'selected' : ''}>Flair style (REGION + line)</option>
          <option value="2" ${o.style == 2 ? 'selected' : ''}>Compact aligned style</option>
          <option value="3" ${o.style == 3 ? 'selected' : ''}>Fixed columns (Fortran-like, ≤132 col)</option></select></div>
        <div class="muted" style="font-size:12px;margin-top:6px">Name-based geometry (COMBNAME) is free format: separators are blanks, names ≤ 8 characters, lines ≤ 132 columns. The fixed-column style aligns GEOBEGIN as (A8,2X,6E10.0,A8) and the title as (2I5,10X,A60).</div></div></details>`;
    if (!dlgSet.open) dlgSet.showModal();
  };
  $('#settingsBody').addEventListener('input', e => { const t = e.target; if (t.dataset.k === 'title') { APP.snap('title'); S.model.title = t.value; APP.changed({}); } else if (t.type === 'number') onOptChange(e); });
  $('#settingsBody').addEventListener('change', e => { if (e.target.dataset.opt) onOptChange(e); });

  /* ---------- Left panel: project tree ---------- */
  function itemHTML(t, o) {
    const sel = S.sel && S.sel.t === t && S.sel.id === o.id;
    return `<div class="item${sel ? ' sel' : ''}" data-t="${t}" data-id="${o.id}" draggable="true">
      <div class="top"><button class="vis${o.visible ? '' : ' off'}" data-act="vis" title="Show / hide">${o.visible ? ICON.eye : ICON.eyeOff}</button>
      ${o.color ? `<span class="sw" style="background:${o.color}"></span>` : ''}<span class="nm">${esc(o.name)}</span><span class="ty">${esc(o.type)}</span><button class="mn" data-act="imenu" title="Actions">⋮</button></div>
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
        <span class="sw" style="background:${c.color}"></span><span class="nm">${esc(c.name)}</span><span class="ty">${c.frozen ? '🔒 ' : ''}${c.parent ? '↳ ' + esc(APP.csysLabel(c.parent)) : ''}</span><button class="mn" data-act="imenu" title="Actions">⋮</button></div></div>` +
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
    let h = `<div class="sec"><div class="btns"><button class="btn primary" data-act="addStl">Import STL / OBJ…</button><button class="btn" data-act="importInp">Import INP…</button><button class="btn danger" data-act="newModel">New project…</button></div></div><div class="tree">`;
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
      case 'region': return [rename, toggle, { label: 'Duplicate', fn: () => { const c = APP.duplicateRegion(o); S.sel = { t: 'region', id: c.id }; APP.changed({ tree: true, right: true }); } }, { sep: 1 }, del];
      case 'csys': return [rename, toggle, { label: 'Set as active', fn: () => APP.setActiveCsys(o.id) },
        { label: 'New child coordinate system', fn: () => { const c = APP.createCsysWorld(APP.csysWorld(o.id), { parent: o.id }); if (c) selectItem('csys', c.id); } },
        { label: o.frozen ? 'Unfreeze (follow parent)' : 'Freeze (keep world pose)', fn: () => APP.setCsysFrozen(o, !o.frozen) },
        { label: 'Section view (XY plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':xy') },
        { label: 'Section view (XZ plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':xz') },
        { label: 'Section view (YZ plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':yz') },
        { label: 'Duplicate', fn: () => APP.duplicateCsys(o) }, { sep: 1 }, del];
      case 'stl': return [rename, toggle, { label: 'Bounding RPP', fn: () => { if (o.stats && o.stats.bbox) APP.rppFromBox(o.stats.bbox); } }, { sep: 1 }, del];
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
        '<div class="muted" style="font-size:11.5px;margin-top:4px">Volume computed inside the render zone; spheres / cylinders are faceted (approximate display).</div>';
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
  function regionMsg(r) {
    try {
      const ast = FK.parseExpr(r.expr || '+x');
      if (!r.expr.trim()) return '<div class="msg bad">Empty expression</div>';
      const missing = Array.from(FK.exprNames(ast)).filter(n => !S.model.bodies.some(b => b.name === n));
      if (missing.length) return `<div class="msg bad">Unknown body: ${esc(missing.join(', '))}</div>`;
      const c = APP.regionCache.get(r.id);
      if (c && c.err) return `<div class="msg bad">${esc(c.err)}</div>`;
      if (c && c.polys && !c.polys.length) return '<div class="msg bad">Region is empty inside the render zone</div>';
      return '<div class="msg ok">Valid expression</div>';
    } catch (e) { return `<div class="msg bad">${esc(e.message)}</div>`; }
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
    const sc = S.opt.scale;
    return `<details class="fold" open><summary>Scale / margin (about the centre)</summary><div>
      <div class="row2"><select data-sc="mode"><option value="margin" ${sc.mode === 'margin' ? 'selected' : ''}>Margin all around (+ grows, − shrinks)</option><option value="pct" ${sc.mode === 'pct' ? 'selected' : ''}>Scale in %</option></select></div>
      <div class="row2"><input type="number" step="any" value="${sc.val}" data-sc="val"><select data-sc="unit" style="max-width:80px" ${sc.mode === 'pct' ? 'disabled' : ''}><option value="mm" ${sc.unit === 'mm' ? 'selected' : ''}>mm</option><option value="cm" ${sc.unit === 'cm' ? 'selected' : ''}>cm</option></select></div>
      <div class="btns"><button class="btn" data-act="scale">Apply</button><button class="btn" data-act="scaleDup">Duplicate + apply</button></div>
      <div class="muted" style="font-size:11.5px">Planes: the margin shifts the plane outward (along H). 120 % = grow by 20 %.</div></div></details>`;
  }

  function bodyProps(b) {
    const info = FK.BODY_TYPES[b.type];
    let h = `<div class="sec"><h4><span>Body · ${esc(b.type === 'RAW' ? b.rawType : b.type)}</span></h4><div class="fields">
      <div class="fld full"><label>Name (max 8 characters for FLUKA)</label><input type="text" data-k="name" value="${esc(b.name)}"></div>`;
    if (b.type === 'RAW') h += `<div class="fld full"><label>Card kept as-is</label><textarea class="expr" readonly>${esc((b.raw || []).join('\n'))}</textarea></div>`;
    else if (APP.FIELD_GROUPS[b.type]) {
      APP.FIELD_GROUPS[b.type].forEach((g, gi) => {
        const on = S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.only === undefined;
        h += `<div class="fld full grp"><div class="gh"><label>${g.l}</label>${g.pick ? `<button class="pk${on ? ' on' : ''}" data-act="pickField" data-g="${gi}" title="Pick the whole group in the 3D view" aria-label="Pick in the 3D view">⌖</button>` : ''}</div>
          <div class="gN" style="grid-template-columns:repeat(${Math.min(g.idx.length, 3)},1fr)">${g.idx.map((i, ii) => {
            const canOne = g.pick && g.pick.kind !== 'radius' && g.idx.length > 1;
            const onOne = S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.only === ii;
            return `<div class="fld"><div class="fl"><label>${info.fields[i]}</label>${canOne ? `<button class="pk sm${onOne ? ' on' : ''}" data-act="pickField" data-g="${gi}" data-i="${ii}" title="Pick this coordinate only" aria-label="Pick ${info.fields[i]} only">⌖</button>` : ''}</div><input type="number" step="any" value="${esc(fmt(b.p[i], 6))}" data-bf="${i}"></div>`;
          }).join('')}</div></div>`;
      });
    } else info.fields.forEach((fl, i) => { h += numField(fl, `data-bf="${i}"`, b.p[i]); });
    if (b.type !== 'RAW' || S.model.csys.length) {
      h += `<div class="fld full"><label>Defined in coordinate system</label><select data-k="bcs"><option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${b.cs === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-opt="keepPos" ${S.opt.keepPos !== false ? 'checked' : ''}>Keep the position when changing frame (recomputes the parameters)</label></div>`;
    }
    h += '</div>';
    if (b.type === 'PLA') {
      const src = b.meta && b.meta.src;
      h += `<div class="btns"><button class="btn sm" data-act="flipPlane">Flip direction (H → −H)</button><button class="btn sm" data-act="replane">Recompute from a face…</button></div>`;
      if (src) { const o = src.kind === 'stl' ? APP.getStl(src.id) : null; h += `<div class="muted" style="font-size:12px">Source: triangle #${src.tri}${o ? ' of ' + esc(o.name) : ''}</div>`; }
    }
    if (b.type !== 'RAW') h += commonStyle(b);
    h += '</div>';
    if (b.type !== 'RAW') h += scaleSection();
    h += `<div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>
      <div class="btns"><button class="btn" data-act="dup">Duplicate</button><button class="btn danger" data-act="del">Delete</button></div>`;
    return h;
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
    let h = `<div class="sec"><h4><span>Coordinate system</span></h4><div class="fields">
      <div class="fld full"><label>Name</label><input type="text" data-k="name" value="${esc(c.name)}"></div>
      <div class="fld full"><label>Defined relative to</label><select data-k="cparent">${parents}</select></div>
      <div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-k="cfrozen" ${c.frozen ? 'checked' : ''}>Freeze: does not follow its parent (keeps its world pose)</label></div>
      </div>
      <div class="muted" style="font-size:12px;margin:2px 0 6px">Unless frozen, this system moves with its parent. ${kids.length ? kids.length + ' child system(s) (' + kids.filter(k => k.frozen).length + ' frozen). ' : ''}${nb ? nb + ' body(ies) defined in this system.' : ''}</div>
      <details class="fold" open><summary>Position and orientation (relative to the parent)</summary><div>
        <div class="fld full grp"><div class="gh"><label>Position X, Y, Z (cm)</label><button class="pk${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === undefined ? ' on' : ''}" data-act="pickCsysPos" title="Pick the whole origin in the 3D view" aria-label="Pick the origin">⌖</button></div><div class="g3">${[0, 1, 2].map(i => `<div class="fld"><div class="fl"><label>${'XYZ'[i]}</label><button class="pk sm${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === i ? ' on' : ''}" data-act="pickCsysPos" data-i="${i}" title="Pick this coordinate only">⌖</button></div>${cf('pos', i, [m[3], m[7], m[11]][i])}</div>`).join('')}</div></div>
        ${grid3('Angles α, β, γ (°) — R = Rz(γ)·Ry(β)·Rx(α)', 'eul', e)}
        ${grid3('X axis vector', 'xa', [m[0], m[4], m[8]])}
        ${grid3('Approx. Y axis vector (Z = X × Y)', 'ya', [m[1], m[5], m[9]])}
      </div></details>
      <details class="fold"><summary>3×4 matrix (rotation | translation)</summary><div>
        <div class="g4">${[0, 1, 2].map(r => [0, 1, 2, 3].map(q => cf('cm', r * 4 + q, m[r * 4 + q])).join('')).join('')}</div>
        <div class="muted" style="font-size:12px">p_parent = R·p + t. Must be a proper rotation (orthonormal, determinant +1).</div></div></details>
      <details class="fold"><summary>World values</summary><div id="csysWorld">${csysWorldHTML(c)}</div></details>
      <div class="row2"><span class="muted">Color</span><input type="color" data-k="color" value="${esc(c.color)}"><label class="chk" style="margin:0 0 0 auto"><input type="checkbox" data-k="visible" ${c.visible ? 'checked' : ''}>Visible</label></div></div>
      <div class="btns"><button class="btn primary" data-act="csysActivate">${S.model.active === c.id ? '● Active system' : 'Set as active'}</button><button class="btn" data-act="dup">Duplicate</button><button class="btn danger" data-act="del">Delete</button></div>
      <div class="muted" style="font-size:12px;margin-top:6px">Deleting re-attaches the children to the parent and keeps the bodies where they are.</div>`;
    return h;
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
    return `<div class="sec"><h4><span>Region</span></h4><div class="fields">
      <div class="fld"><label>Name</label><input type="text" data-k="name" value="${esc(r.name)}"></div>
      <div class="fld"><label>Neighbour regions (2nd field)</label><input type="number" step="1" min="0" value="${r.nvois}" data-k="nvois"></div>
      <div class="fld full"><label>Expression  (+ inside · − outside · | union · parentheses)</label><textarea class="expr" id="exprArea" data-k="expr" spellcheck="false">${esc(r.expr)}</textarea></div></div>
      <div id="exprMsg">${regionMsg(r)}</div>
      <div class="row2"><select id="termBody"><option value="">— body —</option>${opts}</select></div>
      <div class="btns"><button class="btn sm" data-act="termAdd">+ add</button><button class="btn sm" data-act="termSub">− subtract</button><button class="btn sm" data-act="termDel">remove</button></div>
      ${commonStyle(r)}</div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>
      <div class="btns"><button class="btn" data-act="dup">Duplicate</button><button class="btn danger" data-act="del">Delete</button></div>`;
  }
  function stlProps(s) {
    const unitOpts = ['mm', 'cm', 'm', 'in'].map(u => `<option ${s.unit === u ? 'selected' : ''}>${u}</option>`).join('');
    return `<div class="sec"><h4><span>Mesh file</span></h4><div class="fields">
      <div class="fld full"><label>Name</label><input type="text" data-k="name" value="${esc(s.name)}"></div>
      <div class="fld"><label>File unit</label><select data-k="unit">${unitOpts}</select></div>
      <div class="fld"><label>&nbsp;</label><label class="chk" style="margin:0"><input type="checkbox" data-k="flip" ${s.flip ? 'checked' : ''}>Flip normals</label></div>
      ${numField('Offset X (cm)', 'data-off="0"', s.offset[0])}${numField('Offset Y (cm)', 'data-off="1"', s.offset[1])}${numField('Offset Z (cm)', 'data-off="2"', s.offset[2])}
      <div class="fld"><label>&nbsp;</label><label class="chk" style="margin:0"><input type="checkbox" data-k="edges" ${s.edges ? 'checked' : ''}>Sharp edges</label></div></div>
      ${commonStyle(s)}</div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Everything is converted to cm (FLUKA unit) on import. Mesh normals point out of the material.</div>
      <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>
      <div class="btns"><button class="btn" data-act="rppStl">Bounding RPP</button><button class="btn danger" data-act="del">Remove</button></div>`;
  }
  function measureProps(m) {
    return `<div class="sec"><h4><span>Measure</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>
      <div class="btns"><button class="btn" data-act="rppMeasure">RPP from these 2 points</button><button class="btn danger" data-act="del">Delete</button></div>`;
  }
  function renderRight() {
    let h = '';
    const it = APP.selItem();
    if (it && S.sel) {
      h += ({ body: bodyProps, region: regionProps, stl: stlProps, measure: measureProps, csys: csysProps })[S.sel.t](it);
    } else h += '<div class="empty" style="padding:6px 2px 14px">Select an item in the tree or click in the 3D view to show its properties.</div>';
    $('#rightBody').innerHTML = h;
    updateLive();
    renderToolWin();
  }

  /* ---------- Property editing ---------- */
  function onField(e) {
    const t = e.target;
    const it = APP.selItem();
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
      case 'bcs': if (e.type === 'change' && type === 'body') APP.setBodyCsys(it, +t.value, S.opt.keepPos !== false); break;
      case 'cparent': if (e.type === 'change' && type === 'csys') { if (!APP.setCsysParent(it, +t.value, true)) renderRight(); } break;
      case 'cfrozen': if (e.type === 'change' && type === 'csys') APP.setCsysFrozen(it, t.checked); break;
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
      case 'pickField': if (it && S.sel.t === 'body') startFill({ kind: 'body', id: it.id, g: +a.dataset.g, only: a.dataset.i === undefined ? undefined : +a.dataset.i }); break;
      case 'pickCsysPos': if (it && S.sel.t === 'csys') startFill({ kind: 'csys', id: it.id, only: a.dataset.i === undefined ? undefined : +a.dataset.i }); break;
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
      case 'flipPlane': if (it && FK.flipPlane(it)) { APP.snap(); if (it.meta) delete it.meta.src; APP.changed({ right: true }); } break;
      case 'replane': if (it) { S.reassign = it.id; setTool('replane'); if (narrow()) setDrawer('right', false); } break;
      case 'termAdd': case 'termSub': case 'termDel': {
        const n = $('#termBody').value; if (!n || !it) break;
        try {
          APP.snap();
          if (act === 'termDel') it.expr = FK.removeTermFromExpr(it.expr, n);
          else it.expr = FK.addTermToExpr(it.expr, (act === 'termAdd' ? '+' : '-') + n);
          $('#exprArea').value = it.expr; APP.changed({});
        } catch (err) { toast(err.message); }
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
    return g ? g.pick : null;
  }
  function startFill(fl) {
    S.fill = fl; S.winOpen = true; S.pending = null; S.cs3 = []; APP.setPending(null);
    if (S.tool !== 'select') { S.tool = 'select'; syncToolbar(); }
    clearPick(); APP.clearHover(); hoverText = '';
    renderToolOpts(); renderRight(); updateStatus();
    if (narrow()) setDrawer('right', false);
  }
  function cancelFill() {
    if (!S.fill) return;
    S.fill = null; renderToolOpts(); renderRight(); updateStatus();
  }
  function fillFromHit(hit, x, y) {
    const sp = fillSpec(); if (!sp) { cancelFill(); return; }
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
    if (S.fill) { const sp = fillSpec(); return sp && sp.kind === 'normal' ? APP.makePick(hit, 'face', x, y) : APP.pointFromHit(hit, x, y); }
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
    if (S.tool === 'select' && !S.info && !S.fill) return;
    const hit = APP.raycast(x, y);
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
  };

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
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && S.sel && !dlg.open) { e.preventDefault(); APP.deleteSel(); }
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
  window.APP_DEBUG = { loadStlFiles, setTool, setFilter, setPick, flush, renderRight };
})();
