/* ui/pick.js — Selection in the 3D view, field pickers, overlapping-entities pop-up
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
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
        setTermSel(b.name);
        toast(`${b.name} selected: use + add, − subtract or | union`);
        if (narrow()) setDrawer('right', true);
        break;
      }
      case 'regcut': {
        const r = APP.getRegion(S.cutRid); if (!r) { setTool('select'); break; }
        const pk = APP.makePick(hit, 'face', x, y);
        APP.snap();
        const pl = APP.planeForCut(pk), zone = S.opt.cutZone === undefined ? 'all' : S.opt.cutZone;
        const res = APP.addRegionTerm(r, zone === 'all' ? 'all' : +zone, (S.opt.cutKeep === '-' ? -1 : 1) * (pl.flip ? -1 : 1), pl.body.name);
        if (res.error) { toast(res.error); break; }
        if (pl.created) pl.body.visible = false;                 // the cutting plane only serves the formula: hidden from now on
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
