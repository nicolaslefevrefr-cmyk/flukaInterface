/* cut.js — section ("cut") view: a floating 2D window showing the intersection of the displayed geometry
 * with a plane (a coordinate-system plane or a PLA/XYP/XZP/YZP body) shifted by an offset.
 * The 2D view has its own pan / zoom, independent from the 3D camera. */
(function () {
  'use strict';
  const APP = window.APP, S = APP.S, V = FK.V, M = FK.M, fmt = FK.fmt;
  const C = APP.cut = { open: false, src: 'cs:0:xy', off: 0, flip: false, show3d: true, res: null, view: { cu: 0, cv: 0, s: 1 } };
  const vp = document.getElementById('viewport');
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- DOM ---------- */
  const el = document.createElement('div');
  el.id = 'cutwin'; el.hidden = true;
  el.innerHTML = `
    <div class="cw-h"><span>Section view</span>
      <button class="ib" data-cw="fit" title="Fit the section to the window">⤢</button>
      <button class="ib" data-cw="dock" title="Dock as a side panel / float">⇥</button>
      <button class="ib" data-cw="close" title="Close">✕</button></div>
    <div class="cw-opts">
      <label>Plane <select id="cwSrc"></select></label>
      <label>Offset <input type="number" id="cwOff" step="any" value="0"> cm</label>
      <input type="range" id="cwSlide" min="0" max="1" step="any" value="0" title="Move the section plane along its normal">
      <label><input type="checkbox" id="cwFlip"> other side</label>
      <label><input type="checkbox" id="cwShow" checked> plane in 3D</label>
    </div>
    <div class="cw-cv"><canvas id="cwCanvas"></canvas><div class="cw-rs" title="Resize"></div></div>
    <div class="cw-st" id="cwStatus"></div>`;
  vp.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const cv = $('#cwCanvas'), ctx2 = cv.getContext ? cv.getContext('2d') : null;
  const size = { w: 380, h: 300 };
  el.style.width = size.w + 'px';

  /* ---------- Plane frame ---------- */
  const AX = [[1, 0, 0, 'X'], [0, 1, 0, 'Y'], [0, 0, 1, 'Z']];
  function axisName(d) {
    for (const a of AX) { const k = d[0] * a[0] + d[1] * a[1] + d[2] * a[2]; if (Math.abs(k) > 0.9999) return (k > 0 ? '+' : '−') + a[3]; }
    return '';
  }
  function sources() {
    const out = [];
    const cs = [{ id: 0, name: 'Global' }].concat(S.model.csys.map(c => ({ id: c.id, name: c.name })));
    for (const c of cs) for (const pl of [['xy', 'XY'], ['xz', 'XZ'], ['yz', 'YZ']]) out.push({ key: `cs:${c.id}:${pl[0]}`, label: `${c.name} · ${pl[1]} plane` });
    for (const b of S.model.bodies) if (FK.isPlaneType(b.type)) out.push({ key: `pl:${b.id}`, label: `${b.type} ${b.name}` });
    return out;
  }
  /** Frame {o,u,v,n} (world) of the base plane, before offset / flip. */
  function baseFrame(src) {
    const t = src.split(':');
    if (t[0] === 'cs') {
      const W = APP.csysWorld(+t[1]);
      const x = [W[0], W[4], W[8]], y = [W[1], W[5], W[9]], z = [W[2], W[6], W[10]], o = [W[3], W[7], W[11]];
      if (t[2] === 'xy') return { o, u: x, v: y, n: z };
      if (t[2] === 'xz') return { o, u: x, v: z, n: V.mul(y, -1) };
      return { o, u: y, v: z, n: x };
    }
    const b = APP.getBody(+t[1]); if (!b) return null;
    const pl = FK.planeOf(APP.wbody(b)); if (!pl) return null;
    const n = V.norm(pl.H);
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = V.norm(V.sub(ref, V.mul(n, V.dot(ref, n)))), v = V.cross(n, u);
    return { o: pl.V.slice(), u, v, n };
  }
  function frame() {
    const f = baseFrame(C.src); if (!f) return null;
    let o = V.add(f.o, V.mul(f.n, C.off)), u = f.u, v = f.v, n = f.n;
    if (C.flip) { u = V.mul(u, -1); n = V.mul(n, -1); }
    return { o, u, v, n, base: f };
  }

  /* ---------- Slicing of the displayed meshes ---------- */
  function collect() {
    const L = [];
    const add = (pos, color, name) => { if (pos && pos.length) L.push({ pos, color, name }); };
    for (const m of S.stls) if (m.visible && m.positions && m.opacity > 0.004) add(m.positions, m.color, m.name);
    for (const b of S.model.bodies) { const c = APP.bodyCache.get(b.id); if (b.visible && c && c.mesh && b.opacity > 0.004) add(c.mesh.geometry.attributes.position.array, b.color, b.name); }
    for (const r of S.model.regions) { const c = APP.regionCache.get(r.id); if (r.visible && c && c.mesh && r.opacity > 0.004) add(c.mesh.geometry.attributes.position.array, r.color, r.name); }
    return L;
  }
  function sliceOne(pos, f) {
    const o = f.o, n = f.n, u = f.u, v = f.v;
    const nt = Math.floor(pos.length / 9), d = new Float64Array(3);
    const pts = [], adj = new Map(), segs = [];
    // Crossing points are WELDED geometrically (spatial hash), not through shared mesh edges: meshes produced by
    // boolean operations (regions, voids) contain T-junctions, so neighbouring triangles do not share vertex keys.
    let ext = 0;
    for (let i = 0; i < pos.length; i += 3) { const a = Math.abs(pos[i]), b = Math.abs(pos[i + 1]), c = Math.abs(pos[i + 2]); if (a > ext) ext = a; if (b > ext) ext = b; if (c > ext) ext = c; }
    const eps = Math.max(ext, 1) * 1e-7, cell = eps * 8, grid = new Map();
    const weld = (x, y) => {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = grid.get((cx + i) + ',' + (cy + j)); if (!l) continue;
        for (const id of l) if (Math.abs(pts[id][0] - x) <= eps * 4 && Math.abs(pts[id][1] - y) <= eps * 4) return id;
      }
      const id = pts.length; pts.push([x, y]);
      const k = cx + ',' + cy; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(id);
      return id;
    };
    const crossing = (a, b, xa, xb) => {
      const t = xa / (xa - xb);
      const P = [pos[a] + (pos[b] - pos[a]) * t, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * t, pos[a + 2] + (pos[b + 2] - pos[a + 2]) * t];
      const r = [P[0] - o[0], P[1] - o[1], P[2] - o[2]];
      return weld(r[0] * u[0] + r[1] * u[1] + r[2] * u[2], r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    };
    for (let t = 0; t < nt; t++) {
      const i0 = t * 9;
      d[0] = (pos[i0] - o[0]) * n[0] + (pos[i0 + 1] - o[1]) * n[1] + (pos[i0 + 2] - o[2]) * n[2];
      d[1] = (pos[i0 + 3] - o[0]) * n[0] + (pos[i0 + 4] - o[1]) * n[1] + (pos[i0 + 5] - o[2]) * n[2];
      d[2] = (pos[i0 + 6] - o[0]) * n[0] + (pos[i0 + 7] - o[1]) * n[1] + (pos[i0 + 8] - o[2]) * n[2];
      const s0 = d[0] >= 0, s1 = d[1] >= 0, s2 = d[2] >= 0;
      if (s0 === s1 && s1 === s2) continue;
      const ids = [];
      if (s0 !== s1) ids.push(crossing(i0, i0 + 3, d[0], d[1]));
      if (s1 !== s2) ids.push(crossing(i0 + 3, i0 + 6, d[1], d[2]));
      if (s2 !== s0) ids.push(crossing(i0 + 6, i0, d[2], d[0]));
      if (ids.length !== 2 || ids[0] === ids[1]) continue;
      const si = segs.length; segs.push(ids);
      for (const id of ids) { let a = adj.get(id); if (!a) adj.set(id, a = []); a.push(si); }
    }
    // chain the segments into polylines
    const used = new Uint8Array(segs.length), lines = [];
    const other = (si, id) => segs[si][0] === id ? segs[si][1] : segs[si][0];
    const extend = (arr) => {
      for (;;) {
        const last = arr[arr.length - 1], k = (adj.get(last) || []).find(q => !used[q]);
        if (k === undefined) return;
        used[k] = 1; arr.push(other(k, last));
      }
    };
    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const A = [segs[s][0], segs[s][1]]; extend(A);
      const B = [segs[s][0]]; extend(B);
      const ids = B.slice(1).reverse().concat(A);
      lines.push({ pts: ids.map(i => pts[i]), closed: ids.length > 3 && ids[0] === ids[ids.length - 1] });
    }
    return lines;
  }

  /* ---------- Compute ---------- */
  let dirty = true, tmr = 0;
  function compute() {
    const f = frame();
    C.frame = f;
    if (!f) { C.res = { owners: [], bbox: null }; return; }
    const owners = [];
    let bb = null;
    for (const m of collect()) {
      const lines = sliceOne(m.pos, f);
      if (!lines.length) continue;
      owners.push({ color: m.color, name: m.name, lines });
      for (const l of lines) for (const p of l.pts) {
        if (!bb) bb = [p[0], p[1], p[0], p[1]];
        else { if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; }
      }
    }
    C.res = { owners, bbox: bb };
    dirty = false;
  }
  /** Range of offsets that crosses the displayed geometry (for the slider). */
  function offsetRange() {
    const W = APP.visibleBox(); if (!W) return [-10, 10];
    const f = baseFrame(C.src); if (!f) return [-10, 10];
    let lo = Infinity, hi = -Infinity;
    for (const x of [W.min[0], W.max[0]]) for (const y of [W.min[1], W.max[1]]) for (const z of [W.min[2], W.max[2]]) {
      const d = V.dot(V.sub([x, y, z], f.o), f.n); if (d < lo) lo = d; if (d > hi) hi = d;
    }
    return [lo, hi];
  }

  /* ---------- Drawing ---------- */
  function fitView() {
    const b = C.res && C.res.bbox, w = cv.clientWidth || size.w, h = cv.clientHeight || size.h;
    C.fitted = !!b;
    if (!b) { C.view = { cu: 0, cv: 0, s: Math.min(w, h) / 100 }; return; }
    const du = Math.max(b[2] - b[0], 1e-6), dv = Math.max(b[3] - b[1], 1e-6);
    C.view = { cu: (b[0] + b[2]) / 2, cv: (b[1] + b[3]) / 2, s: Math.min(w / du, h / dv) * 0.88 };
  }
  const toS = (p) => [cv.clientWidth / 2 + (p[0] - C.view.cu) * C.view.s, cv.clientHeight / 2 - (p[1] - C.view.cv) * C.view.s];
  const fromS = (x, y) => [(x - cv.clientWidth / 2) / C.view.s + C.view.cu, -(y - cv.clientHeight / 2) / C.view.s + C.view.cv];
  function niceLen(target) {
    const e = Math.pow(10, Math.floor(Math.log10(target))), m = target / e;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
  }
  function draw() {
    if (!ctx2 || !ctx2.setTransform || !C.open) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);
    const dk = document.documentElement.dataset.theme === 'dark'; ctx2.fillStyle = dk ? '#151a22' : '#fff'; ctx2.fillRect(0, 0, w, h);
    const f = C.frame; if (!f) return;
    // axes through the plane origin
    const o = toS([0, 0]);
    ctx2.lineWidth = 1;
    ctx2.strokeStyle = 'rgba(220,60,60,.55)'; ctx2.beginPath(); ctx2.moveTo(0, o[1]); ctx2.lineTo(w, o[1]); ctx2.stroke();
    ctx2.strokeStyle = 'rgba(40,160,70,.55)'; ctx2.beginPath(); ctx2.moveTo(o[0], 0); ctx2.lineTo(o[0], h); ctx2.stroke();
    ctx2.font = '11px system-ui, sans-serif'; ctx2.textBaseline = 'top';
    ctx2.fillStyle = '#c0392b'; ctx2.fillText('u ' + (axisName(f.u) || ''), w - 34, Math.min(Math.max(o[1] + 3, 2), h - 14));
    ctx2.fillStyle = '#1e8e3e'; ctx2.fillText('v ' + (axisName(f.v) || ''), Math.min(Math.max(o[0] + 4, 2), w - 34), 3);
    for (const ow of C.res.owners) {
      ctx2.beginPath();
      for (const l of ow.lines) {
        if (!l.closed) continue;
        l.pts.forEach((p, i) => { const s = toS(p); i ? ctx2.lineTo(s[0], s[1]) : ctx2.moveTo(s[0], s[1]); });
        ctx2.closePath();
      }
      ctx2.globalAlpha = 0.25; ctx2.fillStyle = ow.color; ctx2.fill('evenodd'); ctx2.globalAlpha = 1;
      ctx2.strokeStyle = ow.color; ctx2.lineWidth = 1.8; ctx2.lineJoin = 'round';
      ctx2.beginPath();
      for (const l of ow.lines) l.pts.forEach((p, i) => { const s = toS(p); i ? ctx2.lineTo(s[0], s[1]) : ctx2.moveTo(s[0], s[1]); });
      ctx2.stroke();
    }
    if (!C.res.owners.length) { ctx2.fillStyle = '#6b7686'; ctx2.textBaseline = 'middle'; ctx2.textAlign = 'center'; ctx2.fillText('The plane does not cut any displayed object', w / 2, h / 2); ctx2.textAlign = 'left'; }
    // scale bar
    const L = niceLen(80 / C.view.s), px = L * C.view.s;
    ctx2.strokeStyle = dk ? '#cfd8e6' : '#26303d'; ctx2.lineWidth = 2; ctx2.beginPath(); ctx2.moveTo(10, h - 14); ctx2.lineTo(10 + px, h - 14); ctx2.moveTo(10, h - 18); ctx2.lineTo(10, h - 10); ctx2.moveTo(10 + px, h - 18); ctx2.lineTo(10 + px, h - 10); ctx2.stroke();
    ctx2.fillStyle = dk ? '#cfd8e6' : '#26303d'; ctx2.textBaseline = 'bottom'; ctx2.fillText(fmt(L, 4) + ' cm', 14 + px, h - 8);
  }

  /* ---------- Refresh ---------- */
  function syncOptions() {
    const list = sources(), sel = $('#cwSrc'), sig = list.map(s => s.key + s.label).join('|');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig; sel.innerHTML = list.map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
    }
    if (!list.some(s => s.key === C.src)) { C.src = list[0].key; C.off = 0; dirty = true; }
    sel.value = C.src;
    $('#cwFlip').checked = C.flip; $('#cwShow').checked = C.show3d;
    if (document.activeElement !== $('#cwOff')) $('#cwOff').value = +(+C.off).toFixed(5);
    const r = offsetRange(), sl = $('#cwSlide');
    sl.min = r[0]; sl.max = r[1]; sl.value = Math.min(Math.max(C.off, r[0]), r[1]);
  }
  function update3d() {
    if (!APP.setCutPlane) return;
    if (C.open && C.show3d && C.frame) {
      const W = APP.visibleBox(), half = W ? FK.boxDiag(W) * 0.35 : 20;
      APP.setCutPlane(C.frame, half);
    } else APP.setCutPlane(null);
  }
  function refresh(refit) {
    if (!C.open) return;
    syncOptions(); compute();
    if (refit || (!C.fitted && C.res.bbox)) fitView();
    update3d(); draw();
  }
  /** Called by the UI whenever the model changes (debounced). */
  APP.cutUpdate = function () { if (!C.open) return; dirty = true; clearTimeout(tmr); tmr = setTimeout(() => refresh(false), 120); };
  APP.cutSetOpen = function (on) {
    C.open = !!on; el.hidden = !C.open;
    if (C.open) { refresh(true); requestAnimationFrame(() => { fitView(); draw(); }); }
    else update3d();
    if (APP.hooks && APP.hooks.cutToggled) APP.hooks.cutToggled(C.open);
  };
  /** Use a given plane body (by id) as the section plane. */
  APP.cutUseSrc = function (key) { C.src = key; C.off = 0; APP.cutSetOpen(true); refresh(true); };
  APP.cutUsePlane = (id) => APP.cutUseSrc('pl:' + id);

  /* ---------- Events ---------- */
  $('#cwSrc').addEventListener('change', e => { C.src = e.target.value; C.off = 0; refresh(true); });
  $('#cwOff').addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { C.off = v; refresh(false); } });
  $('#cwSlide').addEventListener('input', e => { C.off = parseFloat(e.target.value); refresh(false); });
  $('#cwFlip').addEventListener('change', e => { C.flip = e.target.checked; refresh(true); });
  $('#cwShow').addEventListener('change', e => { C.show3d = e.target.checked; update3d(); });
  el.querySelector('.cw-h').addEventListener('click', e => {
    const b = e.target.closest('[data-cw]'); if (!b) return;
    if (b.dataset.cw === 'close') APP.cutSetOpen(false);
    else if (b.dataset.cw === 'fit') { fitView(); draw(); }
    else if (b.dataset.cw === 'dock') { if (APP.dockToggle) APP.dockToggle('cut'); setTimeout(() => { fitView(); draw(); }, 60); }
  });
  new ResizeObserver(() => { if (C.open) draw(); }).observe(cv);

  // pan / wheel zoom / pinch / double-click fit on the 2D canvas
  const ptr = new Map();
  let pinch = null;
  const readout = (x, y) => {
    const r = cv.getBoundingClientRect(), p = fromS(x - r.left, y - r.top), f = C.frame; if (!f) return;
    const P = V.add(f.o, V.add(V.mul(f.u, p[0]), V.mul(f.v, p[1])));
    $('#cwStatus').textContent = `u = ${fmt(p[0], 4)}, v = ${fmt(p[1], 4)} cm · world (${P.map(t => fmt(t, 4)).join(', ')})`;
  };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2) { const [a, b] = Array.from(ptr.values()); pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  cv.addEventListener('pointermove', e => {
    const p = ptr.get(e.pointerId);
    if (!p) { readout(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptr.size === 2) {
      const [a, b] = Array.from(ptr.values()), d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch && d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
      pinch = d;
    } else { C.view.cu -= dx / C.view.s; C.view.cv += dy / C.view.s; }
    draw();
  });
  const endP = (e) => { ptr.delete(e.pointerId); pinch = null; };
  cv.addEventListener('pointerup', endP); cv.addEventListener('pointercancel', endP);
  function zoomAt(cx, cy, k) {
    const r = cv.getBoundingClientRect(), before = fromS(cx - r.left, cy - r.top);
    C.view.s = Math.min(Math.max(C.view.s * k, 1e-4), 1e6);
    const after = fromS(cx - r.left, cy - r.top);
    C.view.cu += before[0] - after[0]; C.view.cv += before[1] - after[1];
  }
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    draw();
  }, { passive: false });
  cv.addEventListener('dblclick', () => { fitView(); draw(); });

  // resize handle (top-right corner, the window is anchored bottom-left)
  const rs = el.querySelector('.cw-rs');
  let rsd = null;
  rs.addEventListener('pointerdown', e => { rs.setPointerCapture(e.pointerId); rsd = { x: e.clientX, y: e.clientY, w: el.offsetWidth, h: cv.clientHeight }; e.preventDefault(); });
  rs.addEventListener('pointermove', e => {
    if (!rsd) return;
    const maxW = vp.clientWidth - 16, maxH = Math.max(vp.clientHeight - 110, 120);
    el.style.width = Math.min(Math.max(rsd.w + (e.clientX - rsd.x), 260), maxW) + 'px';
    cv.parentElement.style.height = Math.min(Math.max(rsd.h - (e.clientY - rsd.y), 120), maxH) + 'px';
  });
  rs.addEventListener('pointerup', () => { rsd = null; });
  rs.addEventListener('pointercancel', () => { rsd = null; });

  APP.cutRefresh = refresh;
})();
