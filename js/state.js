/* state.js — application state and model operations (no DOM) */
(function () {
  'use strict';
  const APP = window.APP = { hooks: {} };
  const V = FK.V, fmt = FK.fmt;

  const S = APP.S = {
    model: { title: 'Geometry', bodies: [], regions: [], tail: [], csys: [], active: 0, groups: [] },
    measures: [], stls: [], nextId: 1,
    sel: null, filter: 'face', tool: 'select',
    pick: null, pending: null, W: null,
    opt: { snap: true, coplanar: true, coTol: 1, sharp: 20, edgeSharpOnly: true, circleAll: false,
      margin: 10, style: 1, axes: true, scale: { mode: 'margin', val: 20, unit: 'mm' } }
  };
  APP.nid = () => S.nextId++;
  APP.getBody = (id) => S.model.bodies.find(b => b.id === id);
  APP.getRegion = (id) => S.model.regions.find(r => r.id === id);
  APP.getStl = (id) => S.stls.find(s => s.id === id);
  APP.getMeasure = (id) => S.measures.find(m => m.id === id);
  APP.selItem = function () {
    if (!S.sel) return null;
    const g = { body: APP.getBody, region: APP.getRegion, stl: APP.getStl, measure: APP.getMeasure, csys: (id) => APP.getCsys(id) }[S.sel.t];
    return g ? g(S.sel.id) || null : null;
  };
  APP.changed = (f) => { if (APP.hooks.changed) APP.hooks.changed(f || {}); };
  APP.toast = (m) => { if (APP.hooks.toast) APP.hooks.toast(m); };
  const color = (i) => FK.PALETTE[i % FK.PALETTE.length];

  /* ---------- Undo / redo ---------- */
  const undoStack = [], redoStack = [];
  let lastKey = null, lastT = 0;
  const serialize = () => JSON.stringify({ model: S.model, measures: S.measures });
  APP.snap = function (key) {
    const now = Date.now();
    if (key && key === lastKey && now - lastT < 1200) { lastT = now; return; }
    undoStack.push(serialize()); if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0; lastKey = key || null; lastT = now;
    APP.hooks.undoState && APP.hooks.undoState();
  };
  function restore(str) {
    const o = JSON.parse(str);
    S.model = o.model; S.measures = o.measures;
    S.model.csys = S.model.csys || []; S.model.active = S.model.active || 0; S.model.groups = S.model.groups || [];
    if (S.sel && !APP.selItem() && S.sel.t !== 'stl') S.sel = null;
    APP.changed({ tree: true, right: true, measures: true });
  }
  APP.undo = function () { if (!undoStack.length) return; redoStack.push(serialize()); restore(undoStack.pop()); lastKey = null; APP.hooks.undoState && APP.hooks.undoState(); };
  APP.redo = function () { if (!redoStack.length) return; undoStack.push(serialize()); restore(redoStack.pop()); lastKey = null; APP.hooks.undoState && APP.hooks.undoState(); };
  APP.canUndo = () => undoStack.length > 0; APP.canRedo = () => redoStack.length > 0;

  /* ---------- Local storage ---------- */
  const KEY = 'fluka-geo-tool-v1';
  APP.save = function () {
    try { localStorage.setItem(KEY, JSON.stringify({ model: S.model, measures: S.measures, opt: S.opt, nextId: S.nextId, filter: S.filter })); } catch (e) { /* quota / private mode */ }
  };
  APP.load = function () {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return false;
      const o = JSON.parse(raw);
      if (o.model && Array.isArray(o.model.bodies)) {
        S.model = o.model; S.model.tail = S.model.tail || []; S.model.csys = S.model.csys || []; S.model.active = S.model.active || 0; S.model.groups = S.model.groups || [];
        S.measures = o.measures || []; S.nextId = o.nextId || 1000;
        Object.assign(S.opt, o.opt || {}); S.opt.scale = Object.assign({ mode: 'margin', val: 20, unit: 'mm' }, (o.opt || {}).scale);
        if (o.filter) S.filter = o.filter;
        let mx = S.nextId; for (const a of [S.model.bodies, S.model.regions, S.measures, S.model.csys]) for (const x of a) mx = Math.max(mx, (x.id || 0) + 1);
        S.nextId = mx;
        return true;
      }
    } catch (e) { /* ignorer */ }
    return false;
  };

  /* ---------- Coordinate systems (csys) ----------
   * csys = { id, name, parent (0 = global), frozen, m (3×4 local, relative to the parent), visible, color }
   * body.cs = id of the csys in which the body parameters are expressed (0 = global). */
  const M = FK.M;
  APP.getCsys = (id) => id ? S.model.csys.find(c => c.id === id) : null;
  const csysNames = () => new Set(S.model.csys.map(c => c.name));
  /** world matrix of a csys (0 / unknown → identity); guards against cycles */
  APP.csysWorld = function (id, guard) {
    let m = M.id(), n = 0;
    const chain = [];
    while (id && n++ < 64) { const c = APP.getCsys(id); if (!c) break; chain.push(c); id = c.parent; }
    for (let i = chain.length - 1; i >= 0; i--) m = M.mul(m, chain[i].m);
    return m;
  };
  APP.csysDepth = function (id) { let n = 0; while (id && n < 64) { const c = APP.getCsys(id); if (!c) break; n++; id = c.parent; } return n; };
  APP.isDescendant = function (id, anc) { let n = 0; while (id && n++ < 64) { if (id === anc) return true; const c = APP.getCsys(id); if (!c) return false; id = c.parent; } return false; };
  APP.csysChildren = (id) => S.model.csys.filter(c => (c.parent || 0) === id);
  APP.wbody = (b) => b.cs ? FK.worldBody(b, APP.csysWorld(b.cs)) : b;
  /** Export csys (one only, 0 = global): the INP is written in this frame. */
  APP.exportCs = () => { const id = S.model.exportCs || 0; return id && APP.getCsys(id) ? id : 0; };
  /** Body expressed in the export frame (what is written in the INP). */
  APP.xbody = function (b) {
    const ex = APP.exportCs();
    if (!ex) return APP.wbody(b);
    if (b.type === 'RAW') return b;
    return FK.worldBody(b, M.mul(M.inv(APP.csysWorld(ex)), APP.csysWorld(b.cs || 0)));
  };
  APP.setExportCsys = function (id) {
    id = id || 0; if (id && !APP.getCsys(id)) id = 0;
    if ((S.model.exportCs || 0) === id) return;
    APP.snap(); S.model.exportCs = id;
    APP.changed({ tree: true, right: true });
    APP.toast(id ? 'The INP is now written in coordinate system ' + APP.csysLabel(id) : 'The INP is now written in the global frame');
  };
  APP.toLocal = (p, cs) => { cs = cs === undefined ? S.model.active : cs; return cs ? M.apply(M.inv(APP.csysWorld(cs)), p) : p.slice(); };
  APP.toWorld = (p, cs) => { cs = cs === undefined ? S.model.active : cs; return cs ? M.apply(APP.csysWorld(cs), p) : p.slice(); };
  APP.dirToLocal = (v, cs) => { cs = cs === undefined ? S.model.active : cs; return cs ? M.applyVec(M.inv(APP.csysWorld(cs)), v) : v.slice(); };
  APP.csysLabel = (id) => id ? (APP.getCsys(id) ? APP.getCsys(id).name : '?') : 'Global';

  APP.addCsys = function (m, extra) {
    extra = extra || {};
    const c = {
      id: APP.nid(), name: extra.name || FK.uniqueName('CS1', csysNames()), parent: extra.parent || 0, frozen: !!extra.frozen,
      m: m || M.id(), visible: extra.visible !== undefined ? extra.visible : true, color: extra.color || '#d9480f'
    };
    S.model.csys.push(c);
    return c;
  };
  /** Create from a WORLD matrix; the parent defaults to the active csys. */
  APP.createCsysWorld = function (mw, extra) {
    extra = Object.assign({}, extra);
    if (extra.parent === undefined) extra.parent = S.model.active || 0;
    const cl = M.clean(mw, 1e-6);
    if (!cl.ok) { APP.toast(cl.error); return null; }
    APP.snap();
    const loc = M.mul(M.inv(APP.csysWorld(extra.parent)), cl.m);
    const c = APP.addCsys(loc, extra);
    S.sel = { t: 'csys', id: c.id };
    APP.changed({ tree: true, right: true });
    return c;
  };
  APP.csysFromPoints = (o, px, pxy) => M.fromAxes(o, V.sub(px, o), V.sub(pxy, o));
  APP.csysFromNormal = function (o, n) {
    n = V.norm(n);
    const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const x = V.norm(V.cross(ref, n));
    return M.fromAxes(o, x, V.cross(n, x));
  };
  APP.renameCsys = function (c, nn) {
    nn = (nn || '').trim();
    if (!nn || nn === c.name) return false;
    if (S.model.csys.some(x => x !== c && x.name === nn)) { APP.toast('A coordinate system with this name already exists'); return false; }
    APP.snap(); c.name = nn; APP.changed({ tree: true }); return true;
  };
  /** Set the local matrix of c; non-frozen descendants follow, frozen ones keep their world pose. */
  APP.setCsysLocal = function (c, m, key, soft) {
    const cl = M.clean(m, 1e-4);
    if (!cl.ok) { APP.toast(cl.error); return false; }
    APP.snap(key);
    const old = new Map(S.model.csys.map(x => [x.id, APP.csysWorld(x.id)]));
    c.m = cl.m;
    const order = S.model.csys.filter(x => x !== c && APP.isDescendant(x.id, c.id)).sort((a, b) => APP.csysDepth(a.id) - APP.csysDepth(b.id));
    for (const x of order) {
      if (!x.frozen) continue;
      const loc = M.mul(M.inv(APP.csysWorld(x.parent)), old.get(x.id));
      x.m = (M.clean(loc, 1e-6).m) || loc;
    }
    APP.changed(soft ? { tree: true, csys: true } : { tree: true, right: true });
    return true;
  };
  APP.setCsysWorld = function (c, mw, key, soft) {
    return APP.setCsysLocal(c, M.mul(M.inv(APP.csysWorld(c.parent)), mw), key, soft);
  };
  APP.setCsysFrozen = function (c, v) {
    APP.snap(); c.frozen = !!v; APP.changed({ tree: true, right: true });
  };
  /** Change parent; keep = true keeps the world pose (recomputes the local matrix). */
  APP.setCsysParent = function (c, pid, keep) {
    pid = pid || 0;
    if (pid === c.id || APP.isDescendant(pid, c.id)) { APP.toast('Parent invalide (boucle)'); return false; }
    APP.snap();
    const w = APP.csysWorld(c.id);
    c.parent = pid;
    if (keep !== false) { const loc = M.mul(M.inv(APP.csysWorld(pid)), w); c.m = M.clean(loc, 1e-6).m || loc; }
    APP.changed({ tree: true, right: true });
    return true;
  };
  APP.duplicateCsys = function (c) {
    APP.snap();
    const d = JSON.parse(JSON.stringify(c)); d.id = APP.nid(); d.name = FK.uniqueName(c.name.replace(/\d+$/, '') + '1', csysNames());
    S.model.csys.push(d); S.sel = { t: 'csys', id: d.id };
    APP.changed({ tree: true, right: true }); return d;
  };
  APP.setActiveCsys = function (id) {
    id = id || 0;
    if (id && !APP.getCsys(id)) id = 0;
    S.model.active = id;
    APP.changed({ tree: true, right: true, toolopts: true });
  };
  /** Express body b in csys `id`. keep = true: the geometry stays where it is (exact conversion only). */
  APP.setBodyCsys = function (b, id, keep) {
    id = id || 0;
    if (b.cs === id || (!b.cs && !id)) return true;
    let res = true;
    APP.snap();
    if (keep && b.type !== 'RAW') {
      const rel = M.mul(M.inv(APP.csysWorld(id)), APP.csysWorld(b.cs || 0));
      const nb = FK.worldBody(JSON.parse(JSON.stringify(b)), rel);
      if (nb.type === b.type || (FK.isPlaneType(b.type) && nb.type === 'PLA')) { b.type = nb.type; b.p = nb.p.map(x => +x.toFixed(6)); if (b.meta && b.meta.src) delete b.meta.src; }
      else { res = false; APP.toast('Exact conversion impossible for ' + b.name + ': frame changed, the shape moves'); }
    }
    b.cs = id;
    APP.changed({ tree: true, right: true });
    return res;
  };
  APP.deleteCsys = function (id) {
    const c = APP.getCsys(id); if (!c) return;
    APP.snap();
    const par = c.parent || 0;
    for (const x of S.model.csys) if (x.parent === id) {
      const w = APP.csysWorld(x.id);
      x.parent = par; x.m = M.mul(M.inv(APP.csysWorld(par)), w);
    }
    for (const b of S.model.bodies) if (b.cs === id) {
      b.cs = id; // keep chain valid while converting
      const rel = M.mul(M.inv(APP.csysWorld(par)), APP.csysWorld(id));
      const nb = b.type === 'RAW' ? b : FK.worldBody(JSON.parse(JSON.stringify(b)), rel);
      if (b.type !== 'RAW' && (nb.type === b.type || (FK.isPlaneType(b.type) && nb.type === 'PLA'))) { b.type = nb.type; b.p = nb.p.map(v => +v.toFixed(6)); }
      b.cs = par;
    }
    S.model.csys = S.model.csys.filter(x => x.id !== id);
    if (S.model.active === id) S.model.active = par;
    if (S.model.exportCs === id) S.model.exportCs = par;
    S.sel = null;
    APP.changed({ tree: true, right: true });
  };

  /* ---------- Field pickers: fill body parameters from a point / face picked in the 3D view ----------
   * spec: { kind: 'point'|'vec'|'radius'|'normal', idx:[param indices], comps:[coordinate components], ... } */
  APP.FIELD_GROUPS = {
    RPP: [{ l: 'Min corner (xmin, ymin, zmin)', idx: [0, 2, 4], pick: { kind: 'point', idx: [0, 2, 4], comps: [0, 1, 2], next: 1 } },
      { l: 'Max corner (xmax, ymax, zmax)', idx: [1, 3, 5], pick: { kind: 'point', idx: [1, 3, 5], comps: [0, 1, 2] } }],
    SPH: [{ l: 'Center', idx: [0, 1, 2], pick: { kind: 'point', idx: [0, 1, 2], comps: [0, 1, 2] } },
      { l: 'Radius (pick a point on the surface)', idx: [3], pick: { kind: 'radius', idx: 3, center: [0, 1, 2], comps: [0, 1, 2] } }],
    RCC: [{ l: 'Base center', idx: [0, 1, 2], pick: { kind: 'point', idx: [0, 1, 2], comps: [0, 1, 2], next: 1 } },
      { l: 'Axis vector (base → top)', idx: [3, 4, 5], pick: { kind: 'vec', idx: [3, 4, 5], base: [0, 1, 2] } },
      { l: 'Radius (pick a point on the surface)', idx: [6], pick: { kind: 'radius', idx: 6, center: [0, 1, 2], axis: [3, 4, 5] } }],
    TRC: [{ l: 'Base center', idx: [0, 1, 2], pick: { kind: 'point', idx: [0, 1, 2], comps: [0, 1, 2], next: 1 } },
      { l: 'Axis vector (base → top)', idx: [3, 4, 5], pick: { kind: 'vec', idx: [3, 4, 5], base: [0, 1, 2] } },
      { l: 'Base radius', idx: [6], pick: { kind: 'radius', idx: 6, center: [0, 1, 2], axis: [3, 4, 5] } },
      { l: 'Top radius', idx: [7], pick: { kind: 'radius', idx: 7, center: [0, 1, 2], axis: [3, 4, 5] } }],
    PLA: [{ l: 'Normal H (pick a face)', idx: [0, 1, 2], pick: { kind: 'normal', idx: [0, 1, 2] } },
      { l: 'Point V on the plane', idx: [3, 4, 5], pick: { kind: 'point', idx: [3, 4, 5], comps: [0, 1, 2] } }],
    XYP: [{ l: 'Z position', idx: [0], pick: { kind: 'point', idx: [0], comps: [2] } }],
    XZP: [{ l: 'Y position', idx: [0], pick: { kind: 'point', idx: [0], comps: [1] } }],
    YZP: [{ l: 'X position', idx: [0], pick: { kind: 'point', idx: [0], comps: [0] } }],
    XCC: [{ l: 'Axis position (Y, Z)', idx: [0, 1], pick: { kind: 'point', idx: [0, 1], comps: [1, 2] } }, { l: 'Radius', idx: [2], pick: { kind: 'radius', idx: 2, center: [0, 1], comps: [1, 2] } }],
    YCC: [{ l: 'Axis position (Z, X)', idx: [0, 1], pick: { kind: 'point', idx: [0, 1], comps: [2, 0] } }, { l: 'Radius', idx: [2], pick: { kind: 'radius', idx: 2, center: [0, 1], comps: [2, 0] } }],
    ZCC: [{ l: 'Axis position (X, Y)', idx: [0, 1], pick: { kind: 'point', idx: [0, 1], comps: [0, 1] } }, { l: 'Radius', idx: [2], pick: { kind: 'radius', idx: 2, center: [0, 1], comps: [0, 1] } }]
  };
  /* Alternative pickers shown next to the main ⌖ of a group: circle centre from an edge / from several points, edge direction, radius from an edge. */
  (function () {
    const FG = APP.FIELD_GROUPS;
    const circ = (idx, comps, axisIdx, radIdx) => [
      { id: 'cEdge', icon: '◎', title: 'Centre of a circular edge: click the rim', kind: 'circleEdge', idx, comps, axisIdx, radIdx },
      { id: 'cPts', icon: '∴', title: 'Centre of the circle through several picked points (3 or more)', kind: 'circlePts', idx, comps, axisIdx, radIdx }];
    const dirA = (idx) => [{ id: 'dEdge', icon: '↗', title: 'Direction of a picked edge (normalized, current length kept)', kind: 'dirEdge', idx }];
    const radA = (idx) => [{ id: 'rEdge', icon: '◠', title: 'Radius of a picked arc edge (length of a straight edge)', kind: 'radiusEdge', idx }];
    // axis vector = (centre of the picked circle / rim) − base centre, i.e. the "second point" can use the same techniques as the first
    const top = (radIdx) => circ([3, 4, 5], [0, 1, 2], null, radIdx).map(a => Object.assign(a, { vecBase: [0, 1, 2], title: a.title.replace('Centre of', 'Top centre = centre of') }));
    FG.RCC[0].alts = circ([0, 1, 2], [0, 1, 2], [3, 4, 5], 6); FG.RCC[1].alts = dirA([3, 4, 5]).concat(top(6)); FG.RCC[2].alts = radA(6);
    FG.TRC[0].alts = circ([0, 1, 2], [0, 1, 2], [3, 4, 5], 6); FG.TRC[1].alts = dirA([3, 4, 5]).concat(top(7)); FG.TRC[2].alts = radA(6); FG.TRC[3].alts = radA(7);
    FG.XCC[0].alts = circ([0, 1], [1, 2], null, 2); FG.XCC[1].alts = radA(2);
    FG.YCC[0].alts = circ([0, 1], [2, 0], null, 2); FG.YCC[1].alts = radA(2);
    FG.ZCC[0].alts = circ([0, 1], [0, 1], null, 2); FG.ZCC[1].alts = radA(2);
  })();
  /** Negate a vector group (axis vector H → −H). */
  APP.flipFieldVec = function (b, idx) { APP.snap(); idx.forEach(k => { b.p[k] = +(-b.p[k]).toFixed(6) || 0; }); if (b.meta && b.meta.src) delete b.meta.src; };
  /** Circle centre (and optionally axis / radius) written into a body; `circle` is in world space. Returns a short description. */
  APP.applyCirclePick = function (b, spec, circle, extras, only) {
    const r6 = (x) => +(+x).toFixed(6), cs = b.cs || 0, pl = APP.toLocal(circle.c, cs), notes = [];
    spec.idx.forEach((k, i) => { if (only === undefined || only === i) b.p[k] = r6(spec.vecBase ? pl[spec.comps[i]] - b.p[spec.vecBase[i]] : pl[spec.comps[i]]); });
    if (spec.vecBase) notes.push('axis = centre − base');
    if (extras && only === undefined) {
      if (spec.axisIdx) {
        const n = V.norm(APP.dirToLocal(circle.n, cs)), old = spec.axisIdx.map(k => b.p[k]), L = V.len(old) || 1, sg = V.dot(old, n) < 0 ? -1 : 1;
        spec.axisIdx.forEach((k, i) => { b.p[k] = r6(n[i] * L * sg); }); notes.push('axis along the circle normal');
      }
      if (spec.radIdx !== undefined && spec.radIdx !== null) { b.p[spec.radIdx] = r6(circle.r); notes.push('radius = ' + r6(circle.r) + ' cm'); }
    }
    if (b.meta && b.meta.src) delete b.meta.src;
    return notes;
  };
  /** data: { p: world point } or { normal: world normal } or { dir: world direction } or { v: number }. The value written is expressed in the body's own coordinate system. */
  APP.applyFieldPick = function (b, spec, data, only) {
    const r = (x) => +(+x).toFixed(6), cs = b.cs || 0;
    const each = (fn) => spec.idx.forEach((k, i) => { if (only === undefined || only === i) fn(k, i); }); // `only`: fill a single coordinate
    if (spec.kind === 'dir') {
      // direction of an edge: normalized, then scaled to the current length (1 cm if the vector was null); orientation follows the old vector
      const d = V.norm(APP.dirToLocal(data.dir, cs)), old = spec.idx.map(k => b.p[k]), L = V.len(old) || 1, sg = V.dot(old, d) < 0 ? -1 : 1;
      each((k, i) => { b.p[k] = r(d[i] * L * sg); });
    } else if (spec.kind === 'value') b.p[spec.idx] = r(data.v);
    else if (spec.kind === 'normal') {
      const n = V.norm(APP.dirToLocal(data.normal, cs));
      each((k, i) => { b.p[k] = r(n[i]); });
    } else {
      const pl = APP.toLocal(data.p, cs);
      if (spec.kind === 'point') each((k, i) => { b.p[k] = r(pl[spec.comps[i]]); });
      else if (spec.kind === 'vec') each((k, i) => { b.p[k] = r(pl[i] - b.p[spec.base[i]]); });
      else if (spec.kind === 'radius') {
        let d;
        if (spec.axis) {
          const base = spec.center.map(k => b.p[k]), ax = V.norm(spec.axis.map(k => b.p[k])), q = V.sub(pl, base);
          d = V.len(V.sub(q, V.mul(ax, V.dot(q, ax))));
        } else d = Math.hypot(...spec.center.map((k, i) => pl[spec.comps[i]] - b.p[k]));
        b.p[spec.idx] = r(d);
      } else return false;
    }
    if (b.meta && b.meta.src) delete b.meta.src;
    return true;
  };
  /** Place a coordinate system origin (given in world space) — keeps its orientation. */
  APP.applyCsysPosPick = function (c, pw, only) {
    const pp = M.apply(M.inv(APP.csysWorld(c.parent)), pw), m = c.m.slice();
    [3, 7, 11].forEach((k, i) => { if (only === undefined || only === i) m[k] = pp[i]; });
    return APP.setCsysLocal(c, m);
  };

  /* ---------- Project (JSON): model + csys + settings ---------- */
  /* ---- binary helpers: Float32 mesh data <-> (gzip+)base64 ---- */
  const b64enc = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = (str) => { const s = atob(str), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
  async function packF32(f32) {
    let bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength), enc = 'base64';
    try {
      if (typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined') {
        const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        bytes = new Uint8Array(out); enc = 'gzip+base64';
      }
    } catch (e) { /* uncompressed fallback */ }
    return { enc, n: f32.length, data: b64enc(bytes) };
  }
  async function unpackF32(o) {
    let bytes = b64dec(o.data);
    if (o.enc === 'gzip+base64') {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the project (DecompressionStream missing)');
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Float32Array(buf);
  }
  /** Project = model + coordinate systems + measures + settings + the source meshes (STL / OBJ triangles). */
  APP.exportProject = async function () {
    const stls = [];
    for (const m of S.stls) stls.push({ id: m.id, name: m.name, format: m.format || 'STL', unit: m.unit, offset: m.offset, flip: !!m.flip, visible: m.visible, opacity: m.opacity, color: m.color, edges: m.edges, grp: m.grp || 0, mesh: await packF32(m.raw) });
    return JSON.stringify({ app: 'fluka-geo-tool', version: 3, model: S.model, measures: S.measures, opt: S.opt, nextId: S.nextId, filter: S.filter, stls });
  };
  APP.importProject = async function (text) {
    let o; try { o = JSON.parse(text); } catch (e) { APP.toast('Invalid JSON'); return false; }
    if (!o || !o.model || !Array.isArray(o.model.bodies)) { APP.toast('Not a project file'); return false; }
    const stls = [];
    try {
      for (const m of (o.stls || [])) {
        stls.push({ id: m.id, name: m.name, format: m.format || 'STL', raw: await unpackF32(m.mesh), unit: m.unit || 'mm', offset: m.offset || [0, 0, 0], flip: !!m.flip, visible: m.visible !== false, opacity: m.opacity === undefined ? 0.6 : m.opacity, color: m.color || '#8f9bb0', edges: !!m.edges, grp: m.grp || 0, group: null, mesh: null });
      }
    } catch (e) { APP.toast('Mesh data unreadable: ' + e.message); return false; }
    APP.snap();
    for (const m of S.stls) if (APP.hooks.disposeStl) APP.hooks.disposeStl(m);
    S.stls = stls; for (const m of stls) APP.buildStl(m);
    S.model = o.model; S.model.tail = S.model.tail || []; S.model.regions = S.model.regions || []; S.model.csys = S.model.csys || []; S.model.active = S.model.active || 0; S.model.groups = S.model.groups || [];
    S.measures = o.measures || [];
    if (o.opt) Object.assign(S.opt, o.opt);
    if (o.filter) S.filter = o.filter;
    let mx = o.nextId || 1000; for (const a of [S.model.bodies, S.model.regions, S.model.csys, S.measures, S.stls]) for (const x of a) mx = Math.max(mx, (x.id || 0) + 1);
    S.nextId = Math.max(S.nextId, mx); S.sel = null; S.pick = null; S.fill = null;
    APP.changed({ tree: true, right: true, measures: true, fit: true });
    return true;
  };

  /* ---------- Names ---------- */
  const bodyNames = () => new Set(S.model.bodies.map(b => b.name));
  const regionNames = () => new Set(S.model.regions.map(r => r.name));
  APP.bodyNames = bodyNames;

  /* ---------- Creating bodies / regions ---------- */
  APP.defaultParams = function (type) {
    const W = S.W || { min: [-50, -50, -50], max: [50, 50, 50] };
    const c = APP.toLocal(FK.boxCenter(W)), d = Math.max(FK.boxDiag(W), 10);
    const h = d / 10, r = (x) => +x.toFixed(3);
    switch (type) {
      case 'RPP': return [c[0] - h, c[0] + h, c[1] - h, c[1] + h, c[2] - h, c[2] + h].map(r);
      case 'SPH': return [c[0], c[1], c[2], h].map(r);
      case 'RCC': return [c[0], c[1], c[2] - h, 0, 0, 2 * h, h / 2].map(r);
      case 'TRC': return [c[0], c[1], c[2] - h, 0, 0, 2 * h, h / 2, h / 4].map(r);
      case 'PLA': return [0, 0, 1, c[0], c[1], c[2]].map(r);
      case 'XYP': return [r(c[2])]; case 'XZP': return [r(c[1])]; case 'YZP': return [r(c[0])];
      case 'XCC': return [c[1], c[2], h].map(r);
      case 'YCC': return [c[2], c[0], h].map(r);
      case 'ZCC': return [c[0], c[1], h].map(r);
    }
    return [];
  };

  APP.addBody = function (type, p, extra) {
    extra = extra || {};
    const info = FK.BODY_TYPES[type];
    const name = extra.name || FK.uniqueName(info.prefix + '1', bodyNames());
    const b = {
      id: APP.nid(), type, name, p: p || APP.defaultParams(type), cs: extra.cs !== undefined ? extra.cs : (S.model.active || 0),
      visible: extra.visible !== undefined ? extra.visible : true,
      opacity: extra.opacity !== undefined ? extra.opacity : (FK.isPlaneType(type) ? 0.25 : 0.3),
      color: extra.color || color(S.model.bodies.length), meta: extra.meta || {}
    };
    S.model.bodies.push(b);
    return b;
  };
  APP.addRegion = function (name, expr, extra) {
    extra = extra || {};
    const r = {
      id: APP.nid(), name: name || FK.uniqueName('reg1', regionNames()), nvois: extra.nvois || 5, expr: expr || '',
      visible: extra.visible !== undefined ? extra.visible : false, opacity: extra.opacity !== undefined ? extra.opacity : 0.4,
      color: extra.color || color(S.model.regions.length + 3), meta: {}
    };
    S.model.regions.push(r);
    return r;
  };
  /* ---------- Void region around a region (experimental) ---------- */
  // Plan: bounding box of the evaluated region + margin, names, and the complement expression.
  APP.voidPlan = function (r, margin, mode) {
    const ev = APP.evalRegionNow(r);
    if (ev.error) return { error: 'Cannot evaluate "' + r.name + '": ' + ev.error };
    if (!ev.bbox || ev.vol < 1e-9) return { error: 'Region "' + r.name + '" is empty inside the render zone, so there is nothing to surround.', diag: ev.diag };
    margin = Math.max(0, +margin || 0);
    const r3 = (x) => +x.toFixed(4);
    const mn = ev.bbox.min.map(x => r3(x - margin)), mx = ev.bbox.max.map(x => r3(x + margin));
    const p = [mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]];
    const boxName = FK.uniqueName('vb_' + r.name, bodyNames());
    const regName = FK.uniqueName('v_' + r.name, regionNames());
    let expr;
    try { expr = FK.complementExpr(r.expr, boxName, mode || 'compact'); } catch (e) { return { error: e.message }; }
    return { p, boxName, regName, expr, bbox: ev.bbox, margin, mode: mode || 'compact', vol: ev.vol };
  };
  APP.createVoidRegion = function (r, margin, mode) {
    const pl = APP.voidPlan(r, margin, mode);
    if (pl.error) return pl;
    APP.snap();
    const body = APP.addBody('RPP', pl.p, { name: pl.boxName, cs: 0, visible: false, color: '#9aa0a6', meta: { voidOf: r.name } });
    const reg = APP.addRegion(pl.regName, pl.expr, { visible: false, nvois: r.nvois });
    reg.meta = { voidOf: r.name };
    S.sel = { t: 'region', id: reg.id };
    APP.changed({ tree: true, right: true });
    APP.toast(`Void region ${reg.name} created with RPP ${body.name} (hidden; show it from the tree)`);
    return { body, region: reg, plan: pl };
  };
  /* ---------- Boolean of two regions, written with their bodies only (experimental) ---------- */
  const BOOL_SYM = { sub: 'm', int: 'i', union: 'u' };
  APP.boolPlan = function (a, b, op, mode) {
    if (!a || !b) return { error: 'Choose the second region.' };
    mode = mode || 'compact'; op = op || 'sub';
    let expr;
    try { expr = FK.combineExpr(a.expr, b.expr, op, mode); } catch (e) { return { error: e.message }; }
    const regName = FK.uniqueName(BOOL_SYM[op] + '_' + a.name, regionNames());
    const ev = APP.evalRegionNow({ expr }), ea = APP.evalRegionNow(a), eb = APP.evalRegionNow(b);
    return { expr, regName, op, mode, vol: ev.error ? null : ev.vol, volA: ea.error ? null : ea.vol, volB: eb.error ? null : eb.vol, error2: ev.error || null };
  };
  APP.createBoolRegion = function (a, b, op, mode) {
    const pl = APP.boolPlan(a, b, op, mode);
    if (pl.error) return pl;
    APP.snap();
    const reg = APP.addRegion(pl.regName, pl.expr, { visible: true, nvois: a.nvois });
    reg.meta = { boolOf: [a.name, b.name, op] };
    S.sel = { t: 'region', id: reg.id };
    APP.changed({ tree: true, right: true });
    APP.toast(`Region ${reg.name} created (${a.name} ${op === 'sub' ? '−' : op === 'int' ? '∩' : '∪'} ${b.name}); the originals are unchanged`);
    return { region: reg, plan: pl };
  };
  /* ---------- Detected features (experimental) ---------- */
  /** Add a detected feature to the model as a body (world coordinates; a rotated box also gets its own coordinate system). */
  APP.addFeature = function (f) {
    APP.snap();
    let cs = 0;
    if (f.cs) cs = APP.addCsys(f.cs.slice(), { parent: 0, name: FK.uniqueName('bxcs1', csysNames()) }).id;
    const b = APP.addBody(f.type, f.p.slice(), { cs, meta: { detected: f.kind } });
    S.sel = { t: 'body', id: b.id };
    APP.changed({ tree: true, right: true });
    return b;
  };
  APP.regionNameFor = (bodyName) => FK.uniqueName('r_' + bodyName.slice(0, 6), regionNames());

  APP.createRpp = function (a, b, label) {
    APP.snap();
    a = APP.toLocal(a); b = APP.toLocal(b); // the two points are given in world space, the RPP lives in the active csys
    const p = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[2], b[2])];
    const body = APP.addBody('RPP', p);
    S.sel = { t: 'body', id: body.id };
    APP.changed({ tree: true, right: true });
    return body;
  };
  APP.rppFromBox = function (box) { return APP.createRpp(box.min, box.max); };

  /* ---------- Planes and cuts ---------- */
  APP.planeFromPick = function (pk, cs) {
    const v = pk.seedVerts;
    const inv = FK.M.inv(APP.csysWorld(cs === undefined ? S.model.active : cs));
    const c = FK.M.apply(inv, V.mul(V.add(V.add(v[0], v[1]), v[2]), 1 / 3));
    const n = FK.M.applyVec(inv, pk.normal);
    return { p: [n[0], n[1], n[2], c[0], c[1], c[2]], meta: { src: { kind: pk.ownerKind, id: pk.ownerId, tri: pk.seed, verts: v } } };
  };
  APP.createPlaneFromPick = function (pk) {
    APP.snap();
    const pl = APP.planeFromPick(pk);
    const b = APP.addBody('PLA', pl.p, { meta: pl.meta });
    // the plane is only created: it is never added to a region automatically
    const msg = `PLA ${b.name} created (add +${b.name} or -${b.name} to a region yourself)`;
    S.sel = { t: 'body', id: b.id };
    APP.changed({ tree: true, right: true });
    APP.toast(msg);
    return b;
  };
  APP.reassignPlane = function (bodyId, pk) {
    const b = APP.getBody(bodyId); if (!b || b.type !== 'PLA') return;
    APP.snap();
    const pl = APP.planeFromPick(pk, b.cs || 0);
    b.p = pl.p; b.meta = Object.assign({}, b.meta, pl.meta);
    APP.changed({ tree: true, right: true });
    APP.toast(`Plane ${b.name} recomputed from the new face`);
  };

  /* ---------- Organisation groups (tool only: no effect on the FLUKA output) ---------- */
  const CAT_ITEMS = {
    meshes: () => S.stls, csys: () => S.model.csys, planes: () => S.model.bodies.filter(b => FK.isPlaneType(b.type)),
    bodies: () => S.model.bodies.filter(b => !FK.isPlaneType(b.type)), regions: () => S.model.regions, measures: () => S.measures
  };
  APP.catItems = (k) => CAT_ITEMS[k]();
  APP.catOf = (t, o) => t === 'stl' ? 'meshes' : t === 'csys' ? 'csys' : t === 'region' ? 'regions' : t === 'measure' ? 'measures' : (FK.isPlaneType(o.type) ? 'planes' : 'bodies');
  APP.groups = () => S.model.groups || (S.model.groups = []);
  APP.getGroup = (id) => APP.groups().find(g => g.id === id);
  APP.groupMembers = (g) => CAT_ITEMS[g.k]().filter(o => o.grp === g.id);
  APP.addGroup = function (k, name) {
    APP.snap();
    const n = APP.groups().filter(g => g.k === k).length + 1;
    const g = { id: APP.nid(), k, name: name || 'Group ' + n, open: true };
    APP.groups().push(g); return g;
  };
  /** Move an item into a group (gid 0 / falsy = back to the loose items of its category). */
  APP.setItemGroup = function (t, o, gid) {
    const g = gid ? APP.getGroup(gid) : null;
    if (g && g.k !== APP.catOf(t, o)) return false;
    APP.snap();
    if (g) { o.grp = g.id; g.open = true; } else delete o.grp;
    return true;
  };
  APP.deleteGroup = function (id) {
    const g = APP.getGroup(id); if (!g) return;
    APP.snap();
    APP.groupMembers(g).forEach(o => { delete o.grp; });
    S.model.groups = APP.groups().filter(x => x.id !== id);
  };
  APP.setGroupVisible = function (g, on) { APP.snap(); APP.groupMembers(g).forEach(o => { o.visible = on; }); };

  /* ---------- Duplicate, delete, rename ---------- */
  APP.duplicateBody = function (b) {
    APP.snap();
    const c = JSON.parse(JSON.stringify(b));
    c.id = APP.nid(); c.name = FK.uniqueName(b.name.replace(/\d+$/, '') + '1', bodyNames());
    if (c.name === b.name) c.name = FK.uniqueName(b.name, bodyNames());
    S.model.bodies.push(c);
    return c;
  };
  APP.duplicateRegion = function (r) {
    APP.snap();
    const c = JSON.parse(JSON.stringify(r));
    c.id = APP.nid(); c.name = FK.uniqueName(r.name.replace(/\d+$/, '') + '1', regionNames());
    S.model.regions.push(c);
    return c;
  };
  APP.deleteSel = function () {
    if (!S.sel) return;
    const { t, id } = S.sel;
    if (t === 'csys') { APP.deleteCsys(id); return; }
    APP.snap();
    if (t === 'body') S.model.bodies = S.model.bodies.filter(b => b.id !== id);
    else if (t === 'region') S.model.regions = S.model.regions.filter(r => r.id !== id);
    else if (t === 'measure') S.measures = S.measures.filter(m => m.id !== id);
    else if (t === 'stl') { const s = APP.getStl(id); if (s && APP.hooks.disposeStl) APP.hooks.disposeStl(s); S.stls = S.stls.filter(x => x.id !== id); }
    S.sel = null;
    APP.changed({ tree: true, right: true, measures: true });
  };
  APP.renameBody = function (b, nn) {
    nn = nn.trim();
    if (!nn || nn === b.name) return false;
    if (S.model.bodies.some(x => x !== b && x.name === nn)) { APP.toast('A body with this name already exists'); return false; }
    APP.snap();
    const old = b.name; b.name = nn;
    for (const r of S.model.regions) r.expr = FK.renameInExpr(r.expr, old, nn);
    APP.changed({ tree: true });
    return true;
  };
  APP.renameRegion = function (r, nn) {
    nn = nn.trim();
    if (!nn || nn === r.name) return false;
    if (S.model.regions.some(x => x !== r && x.name === nn)) { APP.toast('A region with this name already exists'); return false; }
    APP.snap(); r.name = nn; APP.changed({ tree: true });
    return true;
  };

  /* ---------- Scale / margin ---------- */
  APP.scaleBody = function (b, mode, val, unit, dup) {
    let target = b;
    const v = mode === 'pct' ? val / 100 : (unit === 'mm' ? val / 10 : val);
    if (mode === 'pct' && !(v > 0)) { APP.toast('Invalid scale'); return null; }
    const test = JSON.parse(JSON.stringify(b));
    if (!FK.scaleBody(test, mode, v)) { APP.toast(mode === 'pct' ? 'Percent scaling is not applicable to this body (use a margin)' : 'Not applicable to this body'); return null; }
    APP.snap();
    if (dup) { target = APP.duplicateBody(b); }
    FK.scaleBody(target, mode, v);
    if (target.meta && target.meta.src) delete target.meta.src; // the plane is no longer tied to the face
    S.sel = { t: 'body', id: target.id };
    APP.changed({ tree: true, right: true });
    return target;
  };

  /* ---------- Void / blackhole envelope ---------- */
  APP.addEnvelope = function () {
    APP.snap();
    const W = S.W || { min: [-50, -50, -50], max: [50, 50, 50] };
    const c = FK.boxCenter(W), R = Math.max(FK.boxDiag(W) * 0.6, 10);
    const used = bodyNames();
    const bh = APP.addBody('SPH', [c[0], c[1], c[2], +(R * 1.2).toFixed(3)], { name: FK.uniqueName('blkbody', used), visible: false });
    used.add(bh.name);
    const vd = APP.addBody('SPH', [c[0], c[1], c[2], +R.toFixed(3)], { name: FK.uniqueName('void', used), visible: false });
    APP.addRegion(FK.uniqueName('BB_void', regionNames()), `+${bh.name} -${vd.name}`, { visible: false });
    const inner = S.model.bodies.filter(b => b !== bh && b !== vd && !FK.isPlaneType(b.type) && !FK.isInfiniteType(b.type) && b.type !== 'RAW');
    APP.addRegion(FK.uniqueName('rOut', regionNames()), `+${vd.name}` + inner.map(b => ' -' + b.name).join(''), { visible: false });
    APP.changed({ tree: true, right: true });
    APP.toast('Envelope added: adjust it (rOut = void minus all finite bodies)');
  };

  /* ---------- Importing an INP block ---------- */
  APP.importInp = function (text, mode) {
    const res = FK.parseInp(text);
    const imp = res.model;
    if (!imp.bodies.length && !imp.regions.length) { APP.toast('No body or region found in this text'); return res; }
    APP.snap();
    if (mode === 'replace') { S.model = { title: imp.title, bodies: [], regions: [], tail: imp.tail || [], csys: S.model.csys || [], active: S.model.active || 0, groups: S.model.groups || [], exportCs: S.model.exportCs || 0 }; S.sel = null; }
    const used = bodyNames(), map = new Map();
    for (const b of imp.bodies) {
      let nm = b.name;
      if (used.has(nm)) nm = FK.uniqueName(nm, used);
      map.set(b.name, nm); used.add(nm);
      b.name = nm; b.id = APP.nid(); b.cs = APP.exportCs(); // INP coordinates are in the export frame
      S.model.bodies.push(b);
    }
    const rused = regionNames();
    for (const r of imp.regions) {
      try {
        const ast = FK.parseExpr(r.expr);
        (function walk(a) { for (const z of a.zones) for (const t of z) { if (t.name && map.has(t.name)) t.name = map.get(t.name); else if (t.sub) walk(t.sub); } })(ast);
        r.expr = FK.formatExpr(ast);
      } catch (e) { /* garder */ }
      if (rused.has(r.name)) r.name = FK.uniqueName(r.name, rused);
      rused.add(r.name); r.id = APP.nid(); S.model.regions.push(r);
    }
    // hide the "envelope" bodies (very large compared to the rest) and the regions that depend on them by default
    const stlBoxes = S.stls.filter(s => s.stats && s.stats.bbox).map(s => s.stats.bbox);
    const W0 = FK.computeWorldBox(stlBoxes, S.model.bodies.map(APP.wbody), 10), d0 = FK.boxDiag(W0);
    const hidden = new Set();
    for (const b of imp.bodies) {
      if (b.type === 'RAW') { b.visible = false; continue; }
      const bb = FK.bodyBBox(APP.wbody(b));
      if (bb && FK.boxDiag(bb) > 2.5 * d0) { b.visible = false; hidden.add(b.name); }
    }
    for (const r of imp.regions) {
      try {
        const ast = FK.parseExpr(r.expr);
        let dep = false;
        for (const z of ast.zones) for (const t of z) if (t.name && t.sign > 0 && hidden.has(t.name)) dep = true;
        r.visible = !dep;
      } catch (e) { r.visible = false; }
    }
    S.opt.style = S.opt.style || 1;
    APP.changed({ tree: true, right: true, fit: true });
    return res;
  };

  APP.newModel = function (all) {
    APP.snap();
    if (all) { for (const m of S.stls) if (APP.hooks.disposeStl) APP.hooks.disposeStl(m); S.stls = []; }
    S.model = { title: 'Geometry', bodies: [], regions: [], tail: [], csys: [], active: 0, groups: [] };
    S.measures = []; S.sel = null; S.pick = null; S.pending = null; S.fill = null;
    APP.changed({ tree: true, right: true, measures: true, fit: !!all });
  };

  /* ---------- INP text ---------- */
  APP.inpText = () => FK.generateInp(S.model, { style: S.opt.style, resolve: APP.xbody });
  APP.warnings = () => {
    const w = FK.validate(S.model, APP.xbody), long = APP.inpText().split('\n').filter(l => l.length > 132).length;
    if (APP.exportCs()) w.unshift(`INP written in coordinate system "${APP.csysLabel(APP.exportCs())}" (export frame)`);
    if (long) w.push(`${long} line(s) longer than 132 columns (FLUKA limit)`);
    for (const r of S.model.regions) { const c = APP.regionCache && APP.regionCache.get(r.id); if (c && c.diag && c.diag.length) w.push(`Region "${r.name}" is empty: ${c.diag[0].text}`); }
    return w;
  };
})();
