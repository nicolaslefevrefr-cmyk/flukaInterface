/* snap.js — alignment suggestions for a freshly created body (pure logic, no DOM)
 *  FK.snapSuggest(body, others, opts, off) → null | { changes: [{ id, text }], type, p }
 *    body    : { type, p } in the world frame (RPP SPH RCC TRC PLA XYP XZP YZP XCC YCC ZCC)
 *    others  : [{ name, type, p }] world-frame bodies it can be compared with
 *    opts    : { tol (cm), ang (deg) }
 *    off     : Set of change ids the user does not want (the later steps are recomputed without them)
 * Steps, in order: axis on a global axis · axis parallel to another cylinder · coaxial with another cylinder · radius equal to another ·
 * start / end on another face or cylinder end · faces / centres on other faces / centres · plane normal on an axis, parallel to / coincident with another plane.
 * Lengths in cm, angles in degrees. */
(function (root) {
  'use strict';
  const FK = root.FK || (typeof require !== 'undefined' ? require('./core.js') : null);
  const V = FK.V, DEG = 180 / Math.PI, EPS = 1e-9;
  const f3 = (x) => String(+(+x).toPrecision(3)), f5 = (x) => String(+(+x).toPrecision(6));
  const mm = (x) => f3(x * 10);
  const AX = 'XYZ';
  const clean = (n) => n.map(x => Math.abs(x) < 1e-12 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-12 ? Math.sign(x) : x);
  const globalAxis = (d, tolDeg) => { let best = null; for (let a = 0; a < 3; a++) { const ang = Math.acos(Math.min(1, Math.abs(d[a]))) * DEG; if (!best || ang < best.ang) best = { a, ang, sign: Math.sign(d[a]) || 1 }; } return best; };
  const isAxis = (d) => d.some(x => Math.abs(Math.abs(x) - 1) < 1e-9);

  function cylOf(b) {
    const p = b.p;
    if (b.type === 'RCC' || b.type === 'TRC') { const H = [p[3], p[4], p[5]], L = V.len(H); if (!L) return null; return { name: b.name, o: [p[0], p[1], p[2]], d: V.mul(H, 1 / L), L, r: b.type === 'RCC' ? [p[6]] : [p[6], p[7]] }; }
    if (b.type === 'XCC') return { name: b.name, o: [0, p[0], p[1]], d: [1, 0, 0], L: Infinity, r: [p[2]], inf: true };
    if (b.type === 'YCC') return { name: b.name, o: [p[1], 0, p[0]], d: [0, 1, 0], L: Infinity, r: [p[2]], inf: true };
    if (b.type === 'ZCC') return { name: b.name, o: [p[0], p[1], 0], d: [0, 0, 1], L: Infinity, r: [p[2]], inf: true };
    return null;
  }

  FK.snapSuggest = function (body, others, opts, off) {
    opts = opts || {}; off = off || new Set();
    const tol = opts.tol === undefined ? 0.02 : opts.tol, angTol = opts.ang === undefined ? 0.5 : opts.ang;
    const w = { type: body.type, p: body.p.slice() }, changes = [];
    const on = (id) => !off.has(id);
    const step = (id, text, apply) => { changes.push({ id, text }); if (on(id)) apply(); };

    // ---- reference data from the other bodies ----
    const cyls = [], radii = [], faces = [[], [], []], centers = [[], [], []], planes = [];
    for (const o of others) {
      const c = cylOf(o);
      if (c) {
        cyls.push(c); c.r.forEach(r => radii.push({ v: r, name: o.name }));
        if (!c.inf && isAxis(c.d)) {
          const a = c.d.findIndex(x => Math.abs(x) > 0.5), e = c.o[a] + c.d[a] * c.L;
          faces[a].push({ v: c.o[a], name: o.name }, { v: e, name: o.name });
          for (let i = 0; i < 3; i++) if (i !== a) { const R = Math.max(...c.r); faces[i].push({ v: c.o[i] - R, name: o.name }, { v: c.o[i] + R, name: o.name }); }
        }
        for (let i = 0; i < 3; i++) if (Math.abs(c.d[i]) < 1e-9) centers[i].push({ v: c.o[i], name: o.name });
      } else if (o.type === 'RPP') for (let a = 0; a < 3; a++) faces[a].push({ v: o.p[2 * a], name: o.name }, { v: o.p[2 * a + 1], name: o.name });
      else if (o.type === 'XYP') faces[2].push({ v: o.p[0], name: o.name }); else if (o.type === 'XZP') faces[1].push({ v: o.p[0], name: o.name }); else if (o.type === 'YZP') faces[0].push({ v: o.p[0], name: o.name });
      else if (o.type === 'SPH') { radii.push({ v: o.p[3], name: o.name }); for (let i = 0; i < 3; i++) centers[i].push({ v: o.p[i], name: o.name }); }
      if (FK.isPlaneType(o.type)) { const pl = FK.planeOf(o), l = V.len(pl.H); if (l) planes.push({ name: o.name, n: V.mul(pl.H, 1 / l), v: pl.V }); }
    }
    const nearest = (list, x, skipSelf) => { let best = null; for (const c of list) { const d = Math.abs(c.v - x); if (d > EPS && d <= tol && (!best || d < best.d)) best = { d, v: c.v, name: c.name }; } return best; };

    const T = w.type;
    // ================= cylinders / cones =================
    if (T === 'RCC' || T === 'TRC') {
      const cur = () => { const H = [w.p[3], w.p[4], w.p[5]], L = V.len(H); return { o: [w.p[0], w.p[1], w.p[2]], L, d: L ? V.mul(H, 1 / L) : [0, 0, 1] }; };
      const setDir = (d, L) => { const n = clean(V.norm(d)); w.p[3] = n[0] * L; w.p[4] = n[1] * L; w.p[5] = n[2] * L; };
      let c0 = cur(); const g = globalAxis(c0.d);
      let axisDone = false;
      if (g.ang > 1e-7 && g.ang <= angTol) step('axis', `axis ${f3(g.ang)}° off ${AX[g.a]} → exactly along ${AX[g.a]}`, () => { const d = [0, 0, 0]; d[g.a] = g.sign; setDir(d, +c0.L.toPrecision(12)); axisDone = true; });
      else if (g.ang <= 1e-7) axisDone = true;
      if (!axisDone || !on('axis')) {
        let best = null; for (const c of cyls) { const ang = Math.acos(Math.min(1, Math.abs(V.dot(c0.d, c.d)))) * DEG; if (ang > 1e-7 && ang <= angTol && (!best || ang < best.ang)) best = { ang, c }; }
        if (best) step('parallel', `axis ${f3(best.ang)}° off the axis of ${best.c.name} → parallel`, () => { const sg = V.dot(c0.d, best.c.d) >= 0 ? 1 : -1; setDir(V.mul(best.c.d, sg), +c0.L.toPrecision(12)); });
      }
      c0 = cur();
      // coaxial with another cylinder (parallel axes, small transverse distance)
      { let best = null; for (const c of cyls) { if (Math.acos(Math.min(1, Math.abs(V.dot(c0.d, c.d)))) * DEG > 1e-6) continue; const wv = V.sub(c0.o, c.o), perp = V.sub(wv, V.mul(c.d, V.dot(wv, c.d))), dist = V.len(perp); if (dist > EPS && dist <= tol && (!best || dist < best.dist)) best = { dist, perp, c }; }
        if (best) step('coax', `axis ${mm(best.dist)} mm off the axis of ${best.c.name} → coaxial`, () => { w.p[0] -= best.perp[0]; w.p[1] -= best.perp[1]; w.p[2] -= best.perp[2]; }); }
      // radii
      const ri = T === 'RCC' ? [6] : [6, 7];
      { const items = []; for (const i of ri) { const n = nearest(radii, w.p[i]); if (n) items.push({ i, n }); }
        if (items.length) step('radius', items.map(x => `R${ri.length > 1 ? x.i - 5 : ''} ${f5(w.p[x.i])} → ${f5(x.n.v)} cm (= ${x.n.name}, Δ ${mm(x.n.d)} mm)`).join(' · '), () => { for (const x of items) w.p[x.i] = x.n.v; }); }
      // start / end along the axis
      const alongCands = () => {
        const c = cur(), out = [];
        for (const k of cyls) { if (k.inf) continue; if (Math.acos(Math.min(1, Math.abs(V.dot(c.d, k.d)))) * DEG > 1e-6) continue; const wv = V.sub(k.o, c.o), perp = V.len(V.sub(wv, V.mul(c.d, V.dot(wv, c.d)))); if (perp > tol) continue; const t0 = V.dot(wv, c.d), t1 = t0 + (V.dot(c.d, k.d) >= 0 ? 1 : -1) * k.L; out.push({ v: t0, name: k.name }, { v: t1, name: k.name }); }
        for (let a = 0; a < 3; a++) if (Math.abs(Math.abs(c.d[a]) - 1) < 1e-9) for (const fc of faces[a]) out.push({ v: (fc.v - c.o[a]) / c.d[a], name: fc.name });
        return out;
      };
      { const c = cur(), n = nearest(alongCands(), 0); if (n) step('start', `start ${mm(n.d)} mm from a face / end of ${n.name} → coincident`, () => { const cc = cur(), t = n.v; for (let i = 0; i < 3; i++) w.p[i] += cc.d[i] * t; setDir(cc.d, cc.L - t); }); }
      { const c = cur(), n = nearest(alongCands(), c.L); if (n) step('end', `end ${mm(n.d)} mm from a face / end of ${n.name} → coincident`, () => { const cc = cur(); setDir(cc.d, n.v); }); }
    }
    // ================= box =================
    else if (T === 'RPP') {
      for (let i = 0; i < 6; i++) { const a = i >> 1, n = nearest(faces[a], w.p[i]); if (n) step('face' + i, `${AX[a]}${i % 2 ? 'max' : 'min'} ${mm(n.d)} mm from a face of ${n.name} → coincident`, () => { w.p[i] = n.v; }); }
    }
    // ================= planes =================
    else if (FK.isPlaneType(T)) {
      if (T === 'PLA') {
        const l = V.len([w.p[0], w.p[1], w.p[2]]); let n0 = l ? V.mul([w.p[0], w.p[1], w.p[2]], 1 / l) : [0, 0, 1];
        const g = globalAxis(n0); let converted = false;
        if (g.ang > 1e-7 && g.ang <= angTol) step('axis', `normal ${f3(g.ang)}° off ${AX[g.a]} → exactly along ${AX[g.a]}${g.sign > 0 ? ' (XYP / XZP / YZP)' : ''}`, () => {
          if (g.sign > 0) { const c = w.p[3 + g.a]; w.type = ['YZP', 'XZP', 'XYP'][g.a]; w.p = [c]; converted = true; }
          else { const d = [0, 0, 0]; d[g.a] = -1; w.p[0] = d[0] * l; w.p[1] = d[1] * l; w.p[2] = d[2] * l; n0 = d; }
        });
        if (!converted && w.type === 'PLA') {
          let best = null; for (const q of planes) { const ang = Math.acos(Math.min(1, Math.abs(V.dot(n0, q.n)))) * DEG; if (ang > 1e-7 && ang <= angTol && (!best || ang < best.ang)) best = { ang, q }; }
          if (best) step('parallel', `normal ${f3(best.ang)}° off the normal of ${best.q.name} → parallel`, () => { const sg = V.dot(n0, best.q.n) >= 0 ? 1 : -1, n = V.mul(best.q.n, sg); w.p[0] = n[0] * l; w.p[1] = n[1] * l; w.p[2] = n[2] * l; n0 = n; });
          let bp = null; for (const q of planes) { if (Math.acos(Math.min(1, Math.abs(V.dot(n0, q.n)))) * DEG > 1e-6) continue; const dist = Math.abs(V.dot(q.n, V.sub([w.p[3], w.p[4], w.p[5]], q.v))); if (dist > EPS && dist <= tol && (!bp || dist < bp.dist)) bp = { dist, q }; }
          if (bp) step('coplanar', `plane ${mm(bp.dist)} mm from ${bp.q.name} → coincident`, () => { const dd = V.dot(bp.q.n, V.sub([w.p[3], w.p[4], w.p[5]], bp.q.v)), v = V.sub([w.p[3], w.p[4], w.p[5]], V.mul(bp.q.n, dd)); w.p[3] = v[0]; w.p[4] = v[1]; w.p[5] = v[2]; });
        }
      }
      if (w.type !== 'PLA') { const a = w.type === 'YZP' ? 0 : w.type === 'XZP' ? 1 : 2, n = nearest(faces[a], w.p[0]); if (n) step('face', `${AX[a]} = ${f5(w.p[0])} is ${mm(n.d)} mm from a face of ${n.name} → coincident`, () => { w.p[0] = n.v; }); }
    }
    // ================= sphere / infinite cylinders =================
    else if (T === 'SPH' || T === 'XCC' || T === 'YCC' || T === 'ZCC') {
      const idx = T === 'SPH' ? [0, 1, 2] : T === 'XCC' ? [1, 2] : T === 'YCC' ? [2, 0] : [0, 1], pos = T === 'SPH' ? [0, 1, 2] : [0, 1], ri = T === 'SPH' ? 3 : 2;
      const items = []; pos.forEach((pi, k) => { const n = nearest(centers[idx[k]], w.p[pi]); if (n) items.push({ pi, a: idx[k], n }); });
      if (items.length) step('center', items.map(x => `${AX[x.a]}c ${mm(x.n.d)} mm from ${x.n.name} → aligned`).join(' · '), () => { for (const x of items) w.p[x.pi] = x.n.v; });
      const n = nearest(radii, w.p[ri]); if (n) step('radius', `R ${f5(w.p[ri])} → ${f5(n.v)} cm (= ${n.name}, Δ ${mm(n.d)} mm)`, () => { w.p[ri] = n.v; });
    }
    return changes.length ? { changes, type: w.type, p: w.p } : null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
