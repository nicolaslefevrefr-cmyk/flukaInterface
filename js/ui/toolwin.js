/* ui/toolwin.js — Floating tool window (options + results of Info / Distance / creation tools) and option changes
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
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
  if (m === 'vertex') return sel + `<label><input type="checkbox" data-opt="snap" ${o.snap ? 'checked' : ''}>Snap to vertices</label>` + (o.snap ? `<label title="Snap only to corners and ends of sharp edges (the edge angle below decides), not to every mesh vertex"><input type="checkbox" data-opt="snapFeat" ${o.snapFeat !== false ? 'checked' : ''}>Corner points only</label>` + (o.snapFeat !== false ? `<label>Edge angle ≥ <input type="number" step="any" data-opt="sharp" value="${o.sharp}">°</label>` : '') : '');
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
  el.innerHTML = `<div class="tw-h" data-act="winToggle" title="Show / hide the options and results of this tool"><span>${winTitle()}</span><span style="flex:none;font-weight:400">${open ? '−' : '+'}</span></div>` + (open ? `<div class="tw-b">${b}</div>` : '');
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
  if (k === 'numStep' && !(v > 0)) return;
  S.opt[k] = v;
  if (k === 'numStep') renderRight();
  if (['coplanar', 'coTol', 'sharp', 'edgeSharpOnly', 'edgeSoft'].includes(k)) { clearPick(); APP.clearHover(); }
  if (k === 'theme') applyTheme();
  if (k === 'snapFeat') renderToolOpts();
  if (k === 'ptMode') { S.ptPlanes = []; ptRefreshPending(); renderToolOpts(); updateStatus(); }
  if (k === 'margin' || k === 'axes') APP.changed({});
  if (k === 'showInpName') APP.changed({ tree: true });
  if (k === 'invX' || k === 'invY') syncToolbar();
  if (k === 'pieceHl') updatePieces(true);
  if (k === 'inpComment' || k === 'inpTransform') { if ($('#inpTransform')) $('#inpTransform').checked = !!S.opt.inpTransform; updateInp(); }
  if (k === 'style') { S.opt.style = +v; $('#inpStyle').value = String(S.opt.style); updateInp(); }
  APP.save();
}
$('#toolwin').addEventListener('change', onOptChange);
$('#toolwin').addEventListener('input', e => { if (e.target.type === 'number') onOptChange(e); });
