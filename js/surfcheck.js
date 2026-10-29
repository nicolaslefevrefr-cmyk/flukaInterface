/* surfcheck.js — geometry consistency check by sampling the surfaces of the bodies (pure logic, no DOM)
 *  For every body: points spread over its surface with the outward normal n. At P − εn and P + εn the boolean expression of every
 *  region is evaluated:  0 region = undefined space (gap) · 1 = normal · ≥ 2 = overlap.
 *  Neighbouring failures of the same kind (same body, same regions on each side) are grouped, like the Flair geometry debugger.
 *  FK.surfaceSamples(wbody, box, n, h)  → { pts, nrm, area } | null (unsupported type)
 *  FK.surfaceCheck({ bodies:[{name, wb}], regions:[{name, expr, black}], box }, opts) → { issues, ... }
 *  Lengths in cm. */
(function (root) {
  'use strict';
  const FK = root.FK || (typeof require !== 'undefined' ? require('./core.js') : null);
  if (typeof require !== 'undefined' && !FK.insideFn) require('./check.js');
  const V = FK.V, TAU = Math.PI * 2;

  function basis(d) {                                   // two unit vectors orthogonal to the unit vector d
    const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = V.norm(V.cross(d, a)), e2 = V.cross(d, e1);
    return [e1, e2];
  }
  /** Sampler output builder. */
  function Out() { return { p: [], n: [], push(px, py, pz, nx, ny, nz) { this.p.push(px, py, pz); this.n.push(nx, ny, nz); } }; }
  function grid(out, o, U, W, nu, nw, nrm) {            // o + s·U + t·W over a nu × nw grid of cell centres
    for (let i = 0; i < nu; i++) for (let j = 0; j < nw; j++) {
      const s = (i + 0.5) / nu, t = (j + 0.5) / nw;
      out.push(o[0] + U[0] * s + W[0] * t, o[1] + U[1] * s + W[1] * t, o[2] + U[2] * s + W[2] * t, nrm[0], nrm[1], nrm[2]);
    }
  }
  function disc(out, c, d, r, h, nrm) {                 // flat disc of radius r (rings)
    if (!(r > 0)) return;
    const [e1, e2] = basis(d), nr = Math.max(1, Math.ceil(r / h));
    out.push(c[0], c[1], c[2], nrm[0], nrm[1], nrm[2]);
    for (let k = 1; k <= nr; k++) {
      const rho = r * (k - 0.5) / nr, m = Math.max(6, Math.ceil(TAU * rho / h));
      for (let a = 0; a < m; a++) { const th = TAU * (a + 0.5) / m, cx = Math.cos(th) * rho, cy = Math.sin(th) * rho; out.push(c[0] + e1[0] * cx + e2[0] * cy, c[1] + e1[1] * cx + e2[1] * cy, c[2] + e1[2] * cx + e2[2] * cy, nrm[0], nrm[1], nrm[2]); }
    }
  }
  function boxArea(sz) { return 2 * (sz[0] * sz[1] + sz[1] * sz[2] + sz[0] * sz[2]); }

  /** Surface points of a body (world frame). n = target number of points (sets the spacing), h = fixed spacing (> 0 overrides n). */
  FK.surfaceSamples = function (b, box, n, h) {
    const type = b.type, p = b.p, out = Out(), sp = (area) => (h > 0 ? h : Math.sqrt(Math.max(area, 1e-12) / Math.max(n, 6)));
    const diag = FK.boxDiag(box);
    switch (type) {
      case 'RPP': {
        const x0 = Math.min(p[0], p[1]), x1 = Math.max(p[0], p[1]), y0 = Math.min(p[2], p[3]), y1 = Math.max(p[2], p[3]), z0 = Math.min(p[4], p[5]), z1 = Math.max(p[4], p[5]);
        const S = [x1 - x0, y1 - y0, z1 - z0], hh = sp(boxArea(S)), nn = (L) => Math.max(1, Math.ceil(L / hh));
        const f = (o, U, W, nrm, a, c) => grid(out, o, U, W, nn(a), nn(c), nrm);
        f([x0, y0, z0], [0, S[1], 0], [0, 0, S[2]], [-1, 0, 0], S[1], S[2]); f([x1, y0, z0], [0, S[1], 0], [0, 0, S[2]], [1, 0, 0], S[1], S[2]);
        f([x0, y0, z0], [S[0], 0, 0], [0, 0, S[2]], [0, -1, 0], S[0], S[2]); f([x0, y1, z0], [S[0], 0, 0], [0, 0, S[2]], [0, 1, 0], S[0], S[2]);
        f([x0, y0, z0], [S[0], 0, 0], [0, S[1], 0], [0, 0, -1], S[0], S[1]); f([x0, y0, z1], [S[0], 0, 0], [0, S[1], 0], [0, 0, 1], S[0], S[1]);
        return { pts: Float32Array.from(out.p), nrm: Float32Array.from(out.n), area: boxArea(S) };
      }
      case 'OBOX': {
        const c = [p[0], p[1], p[2]], A = [[p[3], p[4], p[5]], [p[6], p[7], p[8]], [p[9], p[10], p[11]]], L = A.map(V.len); if (L.some(x => !(x > 0))) return null;
        const hh = sp(boxArea(L.map(x => 2 * x))), nn = (x) => Math.max(1, Math.ceil(2 * x / hh));
        for (let k = 0; k < 3; k++) {
          const i = (k + 1) % 3, j = (k + 2) % 3, u = V.norm(A[k]);
          for (const sg of [-1, 1]) {
            const o = V.sub(V.add(c, V.mul(A[k], sg)), V.add(A[i], A[j]));
            grid(out, o, V.mul(A[i], 2), V.mul(A[j], 2), nn(L[i]), nn(L[j]), V.mul(u, sg));
          }
        }
        return { pts: Float32Array.from(out.p), nrm: Float32Array.from(out.n), area: boxArea(L.map(x => 2 * x)) };
      }
      case 'SPH': {
        const R = p[3], area = 4 * Math.PI * R * R, hh = sp(area), m = Math.max(12, Math.ceil(area / (hh * hh))), ga = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < m; i++) { const z = 1 - 2 * (i + 0.5) / m, r = Math.sqrt(1 - z * z), th = ga * i, nx = r * Math.cos(th), ny = r * Math.sin(th); out.push(p[0] + R * nx, p[1] + R * ny, p[2] + R * z, nx, ny, z); }
        return { pts: Float32Array.from(out.p), nrm: Float32Array.from(out.n), area };
      }
      case 'RCC': case 'TRC': {
        const H = [p[3], p[4], p[5]], L = V.len(H); if (!(L > 0)) return null;
        const d = V.mul(H, 1 / L), r1 = p[6], r2 = type === 'RCC' ? p[6] : p[7], [e1, e2] = basis(d), s = Math.hypot(L, r2 - r1);
        const area = Math.PI * (r1 + r2) * s + Math.PI * (r1 * r1 + r2 * r2), hh = sp(area), nt = Math.max(1, Math.ceil(s / hh));
        const k = (r2 - r1) / L;
        for (let a = 0; a < nt; a++) {
          const t = L * (a + 0.5) / nt, r = r1 + (r2 - r1) * (a + 0.5) / nt, m = Math.max(8, Math.ceil(TAU * Math.max(r, 1e-9) / hh));
          for (let q = 0; q < m; q++) {
            const th = TAU * (q + 0.5) / m, c = Math.cos(th), sn = Math.sin(th), rx = e1[0] * c + e2[0] * sn, ry = e1[1] * c + e2[1] * sn, rz = e1[2] * c + e2[2] * sn;
            const nv = V.norm([rx - k * d[0], ry - k * d[1], rz - k * d[2]]);
            out.push(p[0] + d[0] * t + rx * r, p[1] + d[1] * t + ry * r, p[2] + d[2] * t + rz * r, nv[0], nv[1], nv[2]);
          }
        }
        disc(out, [p[0], p[1], p[2]], d, r1, hh, [-d[0], -d[1], -d[2]]);
        disc(out, [p[0] + H[0], p[1] + H[1], p[2] + H[2]], d, r2, hh, d);
        return { pts: Float32Array.from(out.p), nrm: Float32Array.from(out.n), area };
      }
      case 'XCC': case 'YCC': case 'ZCC': {
        const ax = { XCC: 0, YCC: 1, ZCC: 2 }[type], i = (ax + 1) % 3, j = (ax + 2) % 3;
        const R = p[2], ci = p[0], cj = p[1];   // centre on the axes (i, j) that follow the cylinder axis cyclically (XCC: y,z · YCC: z,x · ZCC: x,y)
        const lo = box.min[ax], len = box.max[ax] - lo, area = TAU * R * len, hh = sp(area), nt = Math.max(1, Math.ceil(len / hh)), m = Math.max(8, Math.ceil(TAU * R / hh));
        for (let a = 0; a < nt; a++) for (let q = 0; q < m; q++) {
          const th = TAU * (q + 0.5) / m, u = Math.cos(th), v = Math.sin(th), P = [0, 0, 0], N = [0, 0, 0];
          P[ax] = lo + len * (a + 0.5) / nt; P[i] = ci + R * u; P[j] = cj + R * v; N[i] = u; N[j] = v;
          out.push(P[0], P[1], P[2], N[0], N[1], N[2]);
        }
        return { pts: Float32Array.from(out.p), nrm: Float32Array.from(out.n), area };
      }
      case 'PLA': case 'XYP': case 'XZP': case 'YZP': {
        const pl = FK.planeOf({ type, p }), nrm = V.norm(pl.H), o = pl.V, [e1, e2] = basis(nrm);
        // extent of the box seen from the plane
        let u0 = 1e30, u1 = -1e30, v0 = 1e30, v1 = -1e30;
        for (let k = 0; k < 8; k++) { const q = [k & 1 ? box.max[0] : box.min[0], k & 2 ? box.max[1] : box.min[1], k & 4 ? box.max[2] : box.min[2]], r = V.sub(q, o), a = V.dot(r, e1), c = V.dot(r, e2); u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, c); v1 = Math.max(v1, c); }
        const area = (u1 - u0) * (v1 - v0), hh = sp(area), nu = Math.max(1, Math.ceil((u1 - u0) / hh)), nv = Math.max(1, Math.ceil((v1 - v0) / hh)), pad = diag * 1e-6;
        for (let a = 0; a < nu; a++) for (let c = 0; c < nv; c++) {
          const s = u0 + (u1 - u0) * (a + 0.5) / nu, t = v0 + (v1 - v0) * (c + 0.5) / nv, x = o[0] + e1[0] * s + e2[0] * t, y = o[1] + e1[1] * s + e2[1] * t, z = o[2] + e1[2] * s + e2[2] * t;
          if (x < box.min[0] - pad || x > box.max[0] + pad || y < box.min[1] - pad || y > box.max[1] + pad || z < box.min[2] - pad || z > box.max[2] + pad) continue;
          out.push(x, y, z, nrm[0], nrm[1], nrm[2]);
        }
        return { pts: Float32Array.from(out.p), nrm: Float32Array.from(out.n), area };
      }
    }
    return null;
  };

  /** Groups the failing samples: same kind / body / regions on both sides, closer than `dist` (single linkage on a hash grid). */
  function cluster(bad, userDist) {
    const groups = new Map();
    for (const s of bad) { const k = s.kind + '|' + s.body + '|' + s.mk + '|' + s.pk; let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(s); }
    const out = [];
    for (const list of groups.values()) {
      const dist = userDist > 0 ? userDist : 3 * list[0].h, cell = dist, hash = new Map(), key = (i, j, k) => i + ',' + j + ',' + k, seen = new Uint8Array(list.length);
      list.forEach((s, idx) => { const k = key(Math.floor(s.p[0] / cell), Math.floor(s.p[1] / cell), Math.floor(s.p[2] / cell)); let a = hash.get(k); if (!a) hash.set(k, a = []); a.push(idx); });
      for (let st = 0; st < list.length; st++) {
        if (seen[st]) continue; seen[st] = 1;
        const comp = [st], stack = [st];
        while (stack.length) {
          const a = list[stack.pop()], ci = Math.floor(a.p[0] / cell), cj = Math.floor(a.p[1] / cell), ck = Math.floor(a.p[2] / cell);
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
            const nb = hash.get(key(ci + di, cj + dj, ck + dk)); if (!nb) continue;
            for (const idx of nb) if (!seen[idx]) { const b = list[idx]; if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) <= dist) { seen[idx] = 1; comp.push(idx); stack.push(idx); } }
          }
        }
        const pts = comp.map(i => list[i]), c = [0, 0, 0], mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
        for (const s of pts) for (let k = 0; k < 3; k++) { c[k] += s.p[k] / pts.length; mn[k] = Math.min(mn[k], s.p[k]); mx[k] = Math.max(mx[k], s.p[k]); }
        let rep = pts[0], bd = 1e30; for (const s of pts) { const d = Math.hypot(s.p[0] - c[0], s.p[1] - c[1], s.p[2] - c[2]); if (d < bd) { bd = d; rep = s; } }
        out.push({ kind: rep.kind, body: rep.body, regMinus: rep.m, regPlus: rep.pl, p: rep.p.slice(), n: rep.n.slice(), center: c, count: pts.length, h: rep.h, eps: rep.eps, size: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]), box: { min: mn, max: mx } });
      }
    }
    return out;
  }

  /** input: { bodies: [{name, wb}], regions: [{name, expr, black}], box }.  opts: perBody (points), maxTotal, spacing (cm, 0 = auto), eps (cm, 0 = auto),
   *  group (cm, 0 = auto), blackOutside (bool), only ('gap' | 'overlap' | undefined), maxIssues. */
  FK.surfaceCheck = function (input, opts) {
    opts = Object.assign({ perBody: 2500, maxTotal: 150000, spacing: 0, eps: 0, group: 0, blackOutside: true, maxIssues: 400 }, opts || {});
    const t0 = Date.now(), box = input.box, diag = FK.boxDiag(box);
    const epsFloor = Math.max(diag * 1e-9, 1e-9);   // ε is automatic per body: 1/1000 of its sample spacing
    const fns = new Map(), skippedBodies = [];
    for (const b of input.bodies) { const f = FK.insideFn(b.wb); if (f) fns.set(b.name, f); else skippedBodies.push(b.name); }
    const regs = [], skippedRegions = [];
    for (const r of input.regions) {
      let ast; try { ast = FK.parseExpr(r.expr); } catch (e) { skippedRegions.push(r.name); continue; }
      if (Array.from(FK.exprNames(ast)).some(n => !fns.has(n))) { skippedRegions.push(r.name); continue; }
      regs.push({ name: r.name, ast, black: !!r.black });
    }
    // sampling (the per-body budget shrinks when the total would exceed the cap)
    const todo = input.bodies.filter(b => fns.has(b.name));
    let per = opts.perBody; if (!(opts.spacing > 0) && per * todo.length > opts.maxTotal) per = Math.max(50, Math.floor(opts.maxTotal / Math.max(1, todo.length)));
    const samples = [];
    for (const b of todo) {
      const s = FK.surfaceSamples(b.wb, box, per, opts.spacing > 0 ? opts.spacing : 0);
      if (!s) { skippedBodies.push(b.name); continue; }
      samples.push({ name: b.name, s, h: Math.sqrt(s.area / Math.max(1, s.pts.length / 3)) });
    }
    const meanH = samples.length ? samples.reduce((a, x) => a + x.h, 0) / samples.length : 1;
    // evaluation
    const regsAt = (x, y, z) => {
      const c = {}, flag = (n) => { if (!(n in c)) c[n] = fns.get(n)(x, y, z); return c[n]; }, res = [];
      for (let i = 0; i < regs.length; i++) if (FK.astInside(regs[i].ast, flag) === true) res.push(i);
      return res;
    };
    const bad = []; let npts = 0, nOk = 0, nBlackSkip = 0;
    const names = (l) => l.map(i => regs[i].name);
    for (const sm of samples) {
      const P = sm.s.pts, N = sm.s.nrm, n = P.length / 3, eps = opts.eps > 0 ? opts.eps : Math.max(sm.h * 1e-3, epsFloor);
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        if (x < box.min[0] || x > box.max[0] || y < box.min[1] || y > box.max[1] || z < box.min[2] || z > box.max[2]) continue;
        npts++;
        const m = regsAt(x - eps * nx, y - eps * ny, z - eps * nz), pl = regsAt(x + eps * nx, y + eps * ny, z + eps * nz);
        let kind = '';
        if (m.length > 1 || pl.length > 1) kind = 'overlap';
        else if (m.length === 0 || pl.length === 0) {
          const other = m.length ? m : pl;
          if (opts.blackOutside && other.length && other.every(r => regs[r].black)) { nBlackSkip++; continue; }
          kind = 'gap';
        }
        if (!kind) { nOk++; continue; }
        if (opts.only && opts.only !== kind) continue;
        const mm = names(m), pp = names(pl);
        bad.push({ kind, body: sm.name, p: [x, y, z], n: [nx, ny, nz], m: mm, pl: pp, mk: mm.join(','), pk: pp.join(','), h: sm.h, eps });
      }
    }
    const issues = cluster(bad, opts.group).sort((a, b) => b.count - a.count).slice(0, opts.maxIssues);
    return { issues, nIssues: issues.length, nBad: bad.length, points: npts, ok: nOk, blackSkipped: nBlackSkip, bodies: samples.length, skippedBodies, skippedRegions,
      eps: opts.eps > 0 ? opts.eps : 0, group: opts.group > 0 ? opts.group : 0, spacing: meanH, perBody: per, ms: Date.now() - t0, gaps: issues.filter(x => x.kind === 'gap').length, overlaps: issues.filter(x => x.kind === 'overlap').length };
  };
})(typeof window !== 'undefined' ? window : globalThis);
