/* check.js — geometry self-checks (pure logic, no DOM)
 *  - FK.insideFn(body)                : point-in-body test for the exported body types (RPP SPH RCC TRC planes XCC/YCC/ZCC, OBOX, ICC, parsed QUA)
 *  - FK.checkEquivalence(model, resolve, inpText, opts) : the generated INP, re-read by FK.parseInp, must give the same region
 *      membership as the model (random + surface-hugging sample points)
 *  - FK.checkOverlaps(bodiesByName, regions, box, opts) : voxel scan → overlapping regions, enclosed holes (not connected to the outside)
 *  - FK.checkAlignment(bodies, opts)  : analytic "almost" checks (near-parallel cylinder axes, near-axis planes, near-coincident faces …)
 * Lengths in cm, angles in degrees. */
(function (root) {
  'use strict';
  const FK = root.FK || (typeof require !== 'undefined' ? require('./core.js') : null);
  const V = FK.V;
  const nums = (b) => { const t = (b.raw || []).join(' ').trim().split(/\s+/).slice(2).map(parseFloat); return t.filter(x => isFinite(x)); };

  /** Returns f(x,y,z) → boolean, or null when the body type is not supported (ARB, RAW …). */
  FK.insideFn = function (b) {
    const p = b.type === 'RAW' ? nums(b) : b.p, type = b.type === 'RAW' ? b.rawType : b.type;
    switch (type) {
      case 'RPP': { const x0 = Math.min(p[0], p[1]), x1 = Math.max(p[0], p[1]), y0 = Math.min(p[2], p[3]), y1 = Math.max(p[2], p[3]), z0 = Math.min(p[4], p[5]), z1 = Math.max(p[4], p[5]); return (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1; }
      case 'SPH': return (x, y, z) => (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2 <= p[3] * p[3];
      case 'RCC': case 'TRC': {
        const H = [p[3], p[4], p[5]], L = V.len(H); if (!L) return null; const d = V.mul(H, 1 / L), r1 = p[6], r2 = type === 'RCC' ? p[6] : p[7];
        return (x, y, z) => { const rx = x - p[0], ry = y - p[1], rz = z - p[2], t = rx * d[0] + ry * d[1] + rz * d[2]; if (t < 0 || t > L) return false; const r = r1 + (r2 - r1) * t / L, q2 = rx * rx + ry * ry + rz * rz - t * t; return q2 <= r * r; };
      }
      case 'PLA': case 'XYP': case 'XZP': case 'YZP': { const pl = FK.planeOf({ type, p }); const h = pl.H, v = pl.V; return (x, y, z) => h[0] * (x - v[0]) + h[1] * (y - v[1]) + h[2] * (z - v[2]) <= 0; }
      case 'XCC': return (x, y, z) => (y - p[0]) ** 2 + (z - p[1]) ** 2 <= p[2] * p[2];
      case 'YCC': return (x, y, z) => (z - p[0]) ** 2 + (x - p[1]) ** 2 <= p[2] * p[2];
      case 'ZCC': return (x, y, z) => (x - p[0]) ** 2 + (y - p[1]) ** 2 <= p[2] * p[2];
      case 'ICC': { const c = [p[0], p[1], p[2]], d = V.norm([p[3], p[4], p[5]]); return (x, y, z) => { const rx = x - c[0], ry = y - c[1], rz = z - c[2], t = rx * d[0] + ry * d[1] + rz * d[2]; return rx * rx + ry * ry + rz * rz - t * t <= p[6] * p[6]; }; }
      case 'OBOX': {
        const c = [p[0], p[1], p[2]], ax = [[p[3], p[4], p[5]], [p[6], p[7], p[8]], [p[9], p[10], p[11]]].map(a => { const l = V.len(a); return { u: l ? V.mul(a, 1 / l) : [1, 0, 0], l }; });
        return (x, y, z) => ax.every(a => Math.abs((x - c[0]) * a.u[0] + (y - c[1]) * a.u[1] + (z - c[2]) * a.u[2]) <= a.l);
      }
      case 'QUA': if (p.length < 10) return null; return (x, y, z) => p[0] * x * x + p[1] * y * y + p[2] * z * z + p[3] * x * y + p[4] * x * z + p[5] * y * z + p[6] * x + p[7] * y + p[8] * z + p[9] <= 0;
    }
    return null;
  };

  /** Region membership of a point from per-body flags: fn(name) → boolean|undefined. */
  function astInside(ast, flag) {
    for (const zone of ast.zones) {
      let ok = true;
      for (const t of zone) {
        const v = t.name ? flag(t.name) : astInside(t.sub, flag);
        if (v === undefined) return undefined;
        if ((t.sign > 0) !== !!v) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }
  FK.astInside = astInside;

  function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function mergeBox(a, b) { return a ? { min: a.min.map((x, i) => Math.min(x, b.min[i])), max: a.max.map((x, i) => Math.max(x, b.max[i])) } : { min: b.min.slice(), max: b.max.slice() }; }

  /** Model (resolved to the export frame) versus the INP text generated from it. */
  FK.checkEquivalence = function (model, resolve, inpText, opts) {
    opts = opts || {};
    const N = opts.points || 30000, out = { points: 0, mismatches: [], unsupported: [], missing: [], regionsChecked: 0, ok: true };
    const parsed = FK.parseInp(inpText).model;
    const mBodies = new Map(), iBodies = new Map();
    for (const b of model.bodies) if (!b.noExport) { const f = b.type === 'RAW' ? FK.insideFn(b) : FK.insideFn(resolve ? resolve(b) : b); mBodies.set(b.name, f); }
    for (const b of parsed.bodies) iBodies.set(b.name, FK.insideFn(b));
    // split bodies (OBOX → RPP + planes) exist in the INP only under generated names; their regions are compared as a whole
    const iRegs = new Map(parsed.regions.map(r => [r.name, r]));
    const inm = FK.inpNames(model);          // names written in the INP file (max 8 characters)
    const pairs = [];
    for (const r of model.regions) {
      if (r.noExport) continue;
      const ir = iRegs.get(inm.regions.get(r) || r.name);
      if (!ir) { out.missing.push(`Region ${r.name} is missing from the INP`); continue; }
      let a1, a2; try { a1 = FK.parseExpr(r.expr); a2 = FK.parseExpr(ir.expr); } catch (e) { out.unsupported.push(r.name); continue; }
      const names = Array.from(FK.exprNames(a1)).filter(n => !mBodies.has(n) || !mBodies.get(n)), inames = Array.from(FK.exprNames(a2)).filter(n => !iBodies.get(n));
      if (names.length || inames.length) { out.unsupported.push(r.name); continue; }
      pairs.push({ r, a1, a2 });
    }
    out.regionsChecked = pairs.length;
    if (!pairs.length) return out;
    // sampling box: union of the finite bodies' boxes, plus margin
    let box = null;
    for (const b of model.bodies) { if (b.noExport || b.type === 'RAW') continue; const wb = resolve ? resolve(b) : b; const bb = FK.bodyBBox(wb); if (bb) box = mergeBox(box, bb); }
    if (!box) return out;
    const diag = Math.hypot(...box.max.map((x, i) => x - box.min[i])) || 1, pad = diag * 0.05;
    box = { min: box.min.map(x => x - pad), max: box.max.map(x => x + pad) };
    const rnd = rng(12345), pts = [];
    for (let i = 0; i < N; i++) pts.push([0, 1, 2].map(k => box.min[k] + rnd() * (box.max[k] - box.min[k])));
    const test = (pt) => {
      const fm = (n) => mBodies.get(n)(pt[0], pt[1], pt[2]), fi = (n) => iBodies.get(n)(pt[0], pt[1], pt[2]);
      for (const q of pairs) {
        const a = astInside(q.a1, fm), b = astInside(q.a2, fi);
        out.points++;
        if (a !== b) { out.ok = false; if (out.mismatches.length < 50) out.mismatches.push({ region: q.r.name, point: pt, model: a, inp: b }); }
      }
    };
    for (const pt of pts) test(pt);
    return out;
  };

  /** Overlaps between regions and enclosed holes on a voxel grid.
   *  regions: [{name, expr}], bodies: Map name → inside fn. box: {min,max} (world), opts.n ≈ cells along the longest side. */
  FK.checkOverlaps = function (regions, bodies, box, opts) {
    opts = opts || {};
    const size = box.max.map((x, i) => x - box.min[i]), nmax = opts.n || 72, h = Math.max(...size) / nmax;
    const dim = size.map(s => Math.max(2, Math.ceil(s / h))), nx = dim[0], ny = dim[1], nz = dim[2], total = nx * ny * nz;
    const asts = regions.map(r => { try { return FK.parseExpr(r.expr); } catch (e) { return null; } });
    const owner = new Int16Array(total).fill(-1), multi = new Uint8Array(total), over = new Map();
    const flags = new Map(); const fns = []; for (const [n, f] of bodies) fns.push([n, f]);
    const cur = {};
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = box.min[0] + (i + 0.5) * h, y = box.min[1] + (j + 0.5) * h, z = box.min[2] + (k + 0.5) * h;
      const c = {}; const flag = (n) => { if (!(n in c)) { const f = bodies.get(n); c[n] = f ? f(x, y, z) : undefined; } return c[n]; };
      const id = i + nx * (j + ny * k); let first = -1;
      for (let r = 0; r < asts.length; r++) {
        if (!asts[r]) continue;
        if (astInside(asts[r], flag) === true) {
          if (first < 0) first = r;
          else { multi[id] = 1; const key = first + '|' + r; over.set(key, (over.get(key) || 0) + 1); }
        }
      }
      owner[id] = first;
    }
    const vol = h * h * h, res = { cell: h, dims: dim, overlaps: [], holes: [], total };
    for (const [key, n] of over) { const [a, b] = key.split('|').map(Number); res.overlaps.push({ a: regions[a].name, b: regions[b].name, volume: n * vol, cells: n }); }
    res.overlaps.sort((p, q) => q.volume - p.volume);
    const ovCenters = [];
    for (let id = 0; id < total && ovCenters.length < 3 * 3000; id++) if (multi[id]) { const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); ovCenters.push(box.min[0] + (i + .5) * h, box.min[1] + (j + .5) * h, box.min[2] + (k + .5) * h); }
    res.overlapCenters = Float32Array.from(ovCenters);
    // empty cells connected to the grid boundary = outside; remaining empty components = holes
    const seen = new Uint8Array(total), stack = [];
    const push = (i, j, k) => { const id = i + nx * (j + ny * k); if (owner[id] < 0 && !seen[id]) { seen[id] = 1; stack.push(id); } };
    for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) { push(a, b, 0); push(a, b, nz - 1); }
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) { push(a, 0, b); push(a, ny - 1, b); }
    for (let a = 0; a < ny; a++) for (let b = 0; b < nz; b++) { push(0, a, b); push(nx - 1, a, b); }
    const flood = (st, mark) => {
      const cells = [];
      while (st.length) {
        const id = st.pop(); cells.push(id);
        const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
        for (const [di, dj, dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
          const n = a + nx * (b + ny * c); if (owner[n] < 0 && !mark[n]) { mark[n] = 1; st.push(n); }
        }
      }
      return cells;
    };
    flood(stack, seen);
    const holeCenters = [];
    for (let id0 = 0; id0 < total; id0++) {
      if (owner[id0] >= 0 || seen[id0]) continue;
      seen[id0] = 1; const cells = flood([id0], seen);
      let sx = 0, sy = 0, sz = 0; const nb = new Set();
      for (const id of cells) {
        const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); sx += i; sy += j; sz += k;
        if (holeCenters.length < 3 * 4000) holeCenters.push(box.min[0] + (i + .5) * h, box.min[1] + (j + .5) * h, box.min[2] + (k + .5) * h);
        for (const [di, dj, dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) { const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const o = owner[a + nx * (b + ny * c)]; if (o >= 0) nb.add(regions[o].name); }
      }
      const n = cells.length;
      res.holes.push({ cells: n, volume: n * vol, center: [box.min[0] + (sx / n + .5) * h, box.min[1] + (sy / n + .5) * h, box.min[2] + (sz / n + .5) * h], around: Array.from(nb).slice(0, 4) });
    }
    res.holes.sort((p, q) => q.volume - p.volume);
    res.holeCenters = Float32Array.from(holeCenters);
    return res;
  };

  /** Analytic "alignment accident" checks on bodies in the export frame.
   *  opts: tol (cm, default 1e-3) for near-coincident faces / offsets; ang (deg, default 2). */
  FK.checkAlignment = function (bodies, opts) {
    opts = opts || {};
    const tol = opts.tol || 1e-3, angMax = opts.ang || 2, EPS = 1e-7, DEG = 180 / Math.PI, out = [];
    const add = (level, kind, text, names, fix) => out.push({ level, kind, text, names, fix: fix || null });
    const f = (x) => (+x.toPrecision(4)).toString();
    const cyl = [], pl = [], faces = [[], [], []];
    for (const b of bodies) {
      const p = b.p, t = b.type;
      if (t === 'RCC' || t === 'TRC') { const H = [p[3], p[4], p[5]], L = V.len(H); if (L > 0) cyl.push({ b, o: [p[0], p[1], p[2]], d: V.mul(H, 1 / L), L, r: t === 'RCC' ? [p[6], p[6]] : [p[6], p[7]], bb: FK.bodyBBox(b) }); }
      else if (t === 'XCC' || t === 'YCC' || t === 'ZCC') cyl.push({ b, o: t === 'XCC' ? [0, p[0], p[1]] : t === 'YCC' ? [p[1], 0, p[0]] : [p[0], p[1], 0], d: t === 'XCC' ? [1, 0, 0] : t === 'YCC' ? [0, 1, 0] : [0, 0, 1], L: Infinity, r: [p[2], p[2]], bb: null, inf: true });
      else if (t === 'PLA') { const l = V.len([p[0], p[1], p[2]]); if (l > 0) pl.push({ b, n: V.mul([p[0], p[1], p[2]], 1 / l), v: [p[3], p[4], p[5]] }); }
      if (t === 'RPP') for (let a = 0; a < 3; a++) { faces[a].push({ name: b.name, v: p[2 * a], idx: 2 * a }); faces[a].push({ name: b.name, v: p[2 * a + 1], idx: 2 * a + 1 }); }
      else if (t === 'XYP') faces[2].push({ name: b.name, v: p[0], idx: 0 }); else if (t === 'XZP') faces[1].push({ name: b.name, v: p[0], idx: 0 }); else if (t === 'YZP') faces[0].push({ name: b.name, v: p[0], idx: 0 });
    }
    // 1. a tilted axis that is almost a global axis; oblique planes almost axis-aligned
    const nearAxis = (d) => { let best = null; for (let a = 0; a < 3; a++) { const c = Math.min(1, Math.abs(d[a])), ang = Math.acos(c) * DEG; if (!best || ang < best.ang) best = { a, ang }; } return best; };
    for (const c of cyl) if (!c.inf) { const na = nearAxis(c.d); if (na.ang > 1e-5 && na.ang <= 0.5) add('warn', 'axis', `Cylinder ${c.b.name}: axis is ${f(na.ang)}° off the ${'XYZ'[na.a]} axis (probably meant to be aligned)`, [c.b.name], { type: 'snapAxis', name: c.b.name, axis: na.a, sign: Math.sign(c.d[na.a]) || 1 }); }
    for (const q of pl) { const na = nearAxis(q.n); if (na.ang > 1e-5 && na.ang <= 0.5) add('warn', 'axis', `Plane ${q.b.name}: normal is ${f(na.ang)}° off the ${'XYZ'[na.a]} axis (use ${['YZP', 'XZP', 'XYP'][na.a]} if it should be aligned)`, [q.b.name], { type: 'snapPlane', name: q.b.name, axis: na.a, sign: Math.sign(q.n[na.a]) || 1 }); }
    // 2. pairs of cylinders that touch / overlap in space
    const near = (A, B) => { if (!A.bb || !B.bb) return true; const pad = tol + 0.01 * Math.min(FK.boxDiag(A.bb), FK.boxDiag(B.bb)); return [0, 1, 2].every(k => A.bb.min[k] - pad <= B.bb.max[k] && B.bb.min[k] - pad <= A.bb.max[k]); };
    for (let i = 0; i < cyl.length; i++) for (let j = i + 1; j < cyl.length; j++) {
      const A = cyl[i], B = cyl[j]; if (!near(A, B)) continue;
      const c = Math.min(1, Math.abs(V.dot(A.d, B.d))), ang = Math.acos(c) * DEG, nm = [A.b.name, B.b.name];
      if (ang > 1e-5 && ang < angMax) {
        const R = Math.max(A.r[0], A.r[1], B.r[0], B.r[1]), w = 2 * R * Math.tan(ang / DEG);
        add('warn', 'tilt', `Cylinders ${nm[0]} / ${nm[1]}: axes differ by ${f(ang)}° (not parallel); the mismatch at the rim reaches ≈ ${f(w * 10)} mm`, nm, (A.inf && B.inf) ? null : { type: 'align', ref: A.inf ? nm[0] : B.inf ? nm[1] : nm[0], name: A.inf ? nm[1] : B.inf ? nm[0] : nm[1], d: (A.inf ? A.d : B.inf ? B.d : A.d) });
      } else if (ang <= 1e-5) {
        const w = V.sub(B.o, A.o), t = V.dot(w, A.d), perp = V.len(V.sub(w, V.mul(A.d, t)));
        if (perp > EPS && perp < tol) add('warn', 'offset', `Cylinders ${nm[0]} / ${nm[1]}: parallel axes offset by only ${f(perp * 10)} mm (coaxial?)`, nm, { type: 'concentric', ref: nm[0], name: nm[1] });
        else if (perp <= EPS) {
          for (const ra of A.r) for (const rb of B.r) { const dr = Math.abs(ra - rb); if (dr > EPS && dr < tol) { add('warn', 'radius', `Cylinders ${nm[0]} / ${nm[1]}: coaxial, radii differ by ${f(dr * 10)} mm (R=${f(ra)} vs ${f(rb)} cm)`, nm, { type: 'radius', ref: nm[0], name: nm[1], tol }); break; } }
          if (!A.inf && !B.inf) {
            const a0 = 0, a1 = A.L, b0 = V.dot(V.sub(B.o, A.o), A.d), b1 = b0 + (V.dot(B.d, A.d) >= 0 ? 1 : -1) * B.L;
            const lo = Math.min(b0, b1), hi = Math.max(b0, b1), gap = lo >= a1 ? lo - a1 : a0 >= hi ? a0 - hi : -1;
            if (gap > EPS && gap < tol) add('warn', 'gap', `Cylinders ${nm[0]} / ${nm[1]}: end to end with a gap of ${f(gap * 10)} mm`, nm, { type: 'shift', name: nm[1], delta: V.mul(A.d, (lo >= a1 ? -gap : gap)) });
            if (!(gap > EPS && gap < tol)) for (const e of [lo - a1, hi - a0, lo - a0, hi - a1]) if (Math.abs(e) > EPS && Math.abs(e) < tol) { add('info', 'face', `Cylinders ${nm[0]} / ${nm[1]}: end faces ${f(Math.abs(e) * 10)} mm apart (almost coincident)`, nm, { type: 'shift', name: nm[1], delta: V.mul(A.d, -e) }); break; }
          }
        }
      }
    }
    // 3. nearly parallel and nearly coincident planes (oblique)
    for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) {
      const A = pl[i], B = pl[j], c = Math.min(1, Math.abs(V.dot(A.n, B.n))), ang = Math.acos(c) * DEG;
      if (ang > 1e-5 && ang < 0.5) { const dist = Math.abs(V.dot(A.n, V.sub(B.v, A.v))); if (dist < 10 * tol) add('warn', 'planes', `Planes ${A.b.name} / ${B.b.name}: ${f(ang)}° apart and almost coincident (${f(dist * 10)} mm): they cut a thin wedge`, [A.b.name, B.b.name], { type: 'planeMerge', ref: A.b.name, name: B.b.name }); }
      else if (ang <= 1e-5) { const dist = Math.abs(V.dot(A.n, V.sub(B.v, A.v))); if (dist > EPS && dist < tol) add('warn', 'planes', `Planes ${A.b.name} / ${B.b.name}: parallel, ${f(dist * 10)} mm apart (sliver)`, [A.b.name, B.b.name], { type: 'planeMerge', ref: A.b.name, name: B.b.name }); }
    }
    // 4. nearly coincident axis-aligned faces of different bodies
    for (let a = 0; a < 3; a++) {
      const L = faces[a].slice().sort((p, q) => p.v - q.v), seen = new Set();
      for (let i = 0; i + 1 < L.length; i++) for (let j = i + 1; j < L.length && L[j].v - L[i].v < tol; j++) {
        const d = L[j].v - L[i].v, key = L[i].name + '|' + L[j].name;
        if (d > EPS && L[i].name !== L[j].name && !seen.has(key)) { seen.add(key); add('warn', 'faces', `${'XYZ'[a]} faces of ${L[i].name} and ${L[j].name} are ${f(d * 10)} mm apart (almost coincident: a sliver can appear)`, [L[i].name, L[j].name], { type: 'face', ref: L[i].name, name: L[j].name, axis: a, value: L[i].v, idx: L[j].idx }); }
      }
    }
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
