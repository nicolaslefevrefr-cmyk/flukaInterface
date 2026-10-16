/* compare.js — CAD ↔ CG comparison (pure logic, no DOM, no three.js)
 *  - FK.TriIndex      : uniform-grid nearest-triangle search on a triangle soup
 *  - FK.subdivide     : barycentric subdivision of a triangle soup (sample points + sub-triangles for colouring)
 *  - FK.compareSurfaces(regionPos, cadPos, opts) : two-way surface deviation (region → CAD and CAD → region), signed
 *      sign convention "CG − CAD": > 0 = CG has material where the CAD has none (excess), < 0 = CG lacks material (deficit)
 * Lengths in cm. */
(function (root) {
  'use strict';
  const FK = root.FK || (typeof require !== 'undefined' ? require('./core.js') : null);
  const V = FK.V;

  /** Closest point of the triangle (a,b,c) to p (Ericson, Real-Time Collision Detection). Returns squared distance, writes the point into q. */
  function closestOnTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, q) {
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let x, y, z;
    if (d1 <= 0 && d2 <= 0) { x = ax; y = ay; z = az; }
    else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { x = bx; y = by; z = bz; }
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); x = ax + v * abx; y = ay + v * aby; z = az + v * abz; }
        else {
          const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { x = cx; y = cy; z = cz; }
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); x = ax + w * acx; y = ay + w * acy; z = az + w * acz; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); x = bx + w * (cx - bx); y = by + w * (cy - by); z = bz + w * (cz - bz); }
              else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; x = ax + abx * v + acx * w; y = ay + aby * v + acy * w; z = az + abz * v + acz * w; }
            }
          }
        }
      }
    }
    q[0] = x; q[1] = y; q[2] = z;
    return (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
  }

  /** Uniform grid over a triangle soup (positions: Float32Array, 9 numbers per triangle). */
  class TriIndex {
    constructor(pos) {
      const n = this.n = pos.length / 9; this.pos = pos;
      const st = FK.meshStats(pos), bb = this.bb = st.bbox;
      this.orient = st.volume < 0 ? -1 : 1;                     // +1: winding gives outward normals
      const ext = [0, 1, 2].map(k => Math.max(bb.max[k] - bb.min[k], 1e-9));
      let h = Math.cbrt(ext[0] * ext[1] * ext[2] / Math.max(n / 3, 1));
      h = Math.max(h, Math.max(ext[0], ext[1], ext[2]) / 128, 1e-9);
      this.h = h; this.dim = ext.map(e => Math.max(1, Math.ceil(e / h)));
      const [nx, ny, nz] = this.dim, nc = nx * ny * nz;
      const cell = (v, k) => Math.min(this.dim[k] - 1, Math.max(0, Math.floor((v - bb.min[k]) / h)));
      const rng = (t) => {
        const o = t * 9; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = pos[o + v * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
        return [cell(lo[0], 0), cell(lo[1], 1), cell(lo[2], 2), cell(hi[0], 0), cell(hi[1], 1), cell(hi[2], 2)];
      };
      const cnt = new Int32Array(nc + 1), rs = new Array(n);
      for (let t = 0; t < n; t++) { const r = rs[t] = rng(t); for (let z = r[2]; z <= r[5]; z++) for (let y = r[1]; y <= r[4]; y++) for (let x = r[0]; x <= r[3]; x++) cnt[(z * ny + y) * nx + x + 1]++; }
      for (let i = 0; i < nc; i++) cnt[i + 1] += cnt[i];
      this.start = cnt; this.items = new Int32Array(cnt[nc]);
      const fill = cnt.slice(0, nc);
      for (let t = 0; t < n; t++) { const r = rs[t]; for (let z = r[2]; z <= r[5]; z++) for (let y = r[1]; y <= r[4]; y++) for (let x = r[0]; x <= r[3]; x++) this.items[fill[(z * ny + y) * nx + x]++] = t; }
      this.stamp = new Int32Array(n); this.q = 0;
      this.nrm = new Float32Array(n * 3);
      for (let t = 0; t < n; t++) {
        const o = t * 9, ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
        let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z) || 1;
        this.nrm[t * 3] = this.orient * x / l; this.nrm[t * 3 + 1] = this.orient * y / l; this.nrm[t * 3 + 2] = this.orient * z / l;
      }
      this._q = [0, 0, 0];
    }
    /** Nearest point of the surface to p: { d, s, tri, q } with s = signed distance (> 0 outside the solid, by the triangle's outward normal). */
    nearest(p) {
      const { h, dim, bb, pos, start, items, stamp } = this, [nx, ny, nz] = dim;
      const c0 = [0, 1, 2].map(k => Math.min(dim[k] - 1, Math.max(0, Math.floor((p[k] - bb.min[k]) / h))));
      let best = Infinity, bt = -1; const q = this._q, bq = [0, 0, 0]; const st = ++this.q;
      const maxR = Math.max(nx, ny, nz);
      for (let r = 0; r <= maxR; r++) {
        if (bt >= 0 && Math.sqrt(best) <= (r - 1) * h) break;
        const x0 = c0[0] - r, x1 = c0[0] + r, y0 = c0[1] - r, y1 = c0[1] + r, z0 = c0[2] - r, z1 = c0[2] + r;
        for (let z = Math.max(0, z0); z <= Math.min(nz - 1, z1); z++) for (let y = Math.max(0, y0); y <= Math.min(ny - 1, y1); y++) {
          const edge = (z === z0 || z === z1 || y === y0 || y === y1);
          for (let x = Math.max(0, x0); x <= Math.min(nx - 1, x1); x += (edge || r === 0 ? 1 : Math.max(1, x1 - x0))) {
            if (!edge && r > 0 && x !== x0 && x !== x1) continue;
            const ci = (z * ny + y) * nx + x;
            for (let k = start[ci]; k < start[ci + 1]; k++) {
              const t = items[k]; if (stamp[t] === st) continue; stamp[t] = st;
              const o = t * 9, d2 = closestOnTri(p[0], p[1], p[2], pos[o], pos[o + 1], pos[o + 2], pos[o + 3], pos[o + 4], pos[o + 5], pos[o + 6], pos[o + 7], pos[o + 8], q);
              if (d2 < best) { best = d2; bt = t; bq[0] = q[0]; bq[1] = q[1]; bq[2] = q[2]; }
            }
          }
        }
      }
      const d = Math.sqrt(best);
      const s = bt >= 0 ? ((p[0] - bq[0]) * this.nrm[bt * 3] + (p[1] - bq[1]) * this.nrm[bt * 3 + 1] + (p[2] - bq[2]) * this.nrm[bt * 3 + 2] >= 0 ? d : -d) : 0;
      return { d, s, tri: bt, q: bq };
    }
  }
  FK.TriIndex = TriIndex;
  FK.closestOnTri = closestOnTri;

  /** Barycentric subdivision of every triangle so that no edge exceeds ~h. Returns { points: Float32Array(3m), tri: Uint32Array(3k) }. */
  FK.subdivide = function (pos, h, maxN) {
    maxN = maxN || 32;
    const nT = pos.length / 9, ns = new Int32Array(nT); let m = 0, k = 0;
    for (let t = 0; t < nT; t++) {
      const o = t * 9; let e = 0;
      for (let a = 0; a < 3; a++) { const b = (a + 1) % 3; e = Math.max(e, Math.hypot(pos[o + a * 3] - pos[o + b * 3], pos[o + a * 3 + 1] - pos[o + b * 3 + 1], pos[o + a * 3 + 2] - pos[o + b * 3 + 2])); }
      const n = Math.max(1, Math.min(maxN, Math.ceil(e / h))); ns[t] = n; m += (n + 1) * (n + 2) / 2; k += n * n;
    }
    const points = new Float32Array(m * 3), tri = new Uint32Array(k * 3); let pi = 0, ti = 0;
    for (let t = 0; t < nT; t++) {
      const o = t * 9, n = ns[t], base = pi, id = (i, j) => base + j * (n + 1) - (j * (j - 1)) / 2 + i;   // row j has n+1-j points
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n - j; i++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        for (let c = 0; c < 3; c++) points[(pi) * 3 + c] = w * pos[o + c] + u * pos[o + 3 + c] + v * pos[o + 6 + c];
        pi++;
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n - j; i++) {
        tri[ti++] = id(i, j); tri[ti++] = id(i + 1, j); tri[ti++] = id(i, j + 1);
        if (i + j < n - 1) { tri[ti++] = id(i + 1, j); tri[ti++] = id(i + 1, j + 1); tri[ti++] = id(i, j + 1); }
      }
    }
    return { points, tri: tri.subarray(0, ti) };
  };

  function stats(d, s) {
    const n = d.length; if (!n) return { n: 0, mean: 0, rms: 0, max: 0, p95: 0, bias: 0 };
    let sum = 0, sq = 0, mx = 0, bias = 0;
    for (let i = 0; i < n; i++) { sum += d[i]; sq += d[i] * d[i]; if (d[i] > mx) mx = d[i]; bias += s[i]; }
    const sorted = Float32Array.from(d).sort();
    return { n, mean: sum / n, rms: Math.sqrt(sq / n), max: mx, p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))], bias: bias / n };
  }
  FK.deviationStats = stats;

  /**
   * Two-way deviation between the CG region surface (triangles regionPos) and the CAD mesh (cadPos).
   * opts: { target: number of sample points per side (default 60000) }
   * Returns { region: { points, tri, d, s }, cad: { points, tri, d, s }, stats: { toCad, toRegion, hausdorff } }.
   * Signs: "CG − CAD" (> 0 excess of CG, < 0 deficit).
   */
  FK.compareSurfaces = function (regionPos, cadPos, opts) {
    opts = opts || {};
    const target = opts.target || 60000;
    const idxC = new TriIndex(cadPos), idxR = new TriIndex(regionPos);
    const stR = FK.meshStats(regionPos), diag = FK.boxDiag(stR.bbox);
    // CAD triangles near the region only (a region may describe a part of the mesh)
    const pad = Math.max(diag * 0.02, 1e-6), lo = stR.bbox.min.map(x => x - pad), hi = stR.bbox.max.map(x => x + pad), keep = [];
    for (let t = 0; t < cadPos.length / 9; t++) {
      const o = t * 9; let ok = false;
      for (let v = 0; v < 3 && !ok; v++) if (cadPos[o + v * 3] >= lo[0] && cadPos[o + v * 3] <= hi[0] && cadPos[o + v * 3 + 1] >= lo[1] && cadPos[o + v * 3 + 1] <= hi[1] && cadPos[o + v * 3 + 2] >= lo[2] && cadPos[o + v * 3 + 2] <= hi[2]) ok = true;
      if (ok) keep.push(t);
    }
    const sub = new Float32Array(keep.length * 9); keep.forEach((t, i) => sub.set(cadPos.subarray(t * 9, t * 9 + 9), i * 9));
    const out = { region: null, cad: null, stats: {} };
    const hR = Math.sqrt(2 * Math.max(stR.area, 1e-12) / target);
    const sr = FK.subdivide(regionPos, hR); const dR = new Float32Array(sr.points.length / 3), sR = new Float32Array(dR.length);
    for (let i = 0; i < dR.length; i++) { const r = idxC.nearest([sr.points[i * 3], sr.points[i * 3 + 1], sr.points[i * 3 + 2]]); dR[i] = r.d; sR[i] = r.s; }
    out.region = { points: sr.points, tri: sr.tri, d: dR, s: sR };
    out.stats.toCad = stats(dR, sR);
    if (keep.length) {
      const stC = FK.meshStats(sub), hC = Math.sqrt(2 * Math.max(stC.area, 1e-12) / target);
      const sc = FK.subdivide(sub, hC); const dC = new Float32Array(sc.points.length / 3), sC = new Float32Array(dC.length);
      for (let i = 0; i < dC.length; i++) {
        const r = idxR.nearest([sc.points[i * 3], sc.points[i * 3 + 1], sc.points[i * 3 + 2]]);
        dC[i] = r.d; sC[i] = -r.s;                      // CAD point outside the region (r.s > 0) = CG deficit
      }
      out.cad = { points: sc.points, tri: sc.tri, d: dC, s: sC, triCount: keep.length };
      out.stats.toRegion = stats(dC, sC);
    } else out.stats.toRegion = stats(new Float32Array(0), new Float32Array(0));
    out.stats.hausdorff = Math.max(out.stats.toCad.max, out.stats.toRegion.max);
    return out;
  };

  /** Colour of a deviation value: signed → blue (deficit) · grey (0) · red (excess); unsigned → green · yellow · red. v in [-max, max] (or [0, max]). */
  FK.devColor = function (v, max, signed) {
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    if (signed) {
      const t = Math.max(-1, Math.min(1, v / (max || 1))), mid = [0.86, 0.88, 0.9];
      return t >= 0 ? lerp(mid, [0.86, 0.12, 0.1], t) : lerp(mid, [0.1, 0.3, 0.9], -t);
    }
    const t = Math.max(0, Math.min(1, Math.abs(v) / (max || 1)));
    return t < 0.5 ? lerp([0.1, 0.65, 0.3], [0.98, 0.85, 0.1], t * 2) : lerp([0.98, 0.85, 0.1], [0.86, 0.1, 0.1], (t - 0.5) * 2);
  };
})(typeof window !== 'undefined' ? window : globalThis);
