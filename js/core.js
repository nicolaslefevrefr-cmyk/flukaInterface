/* core.js — pure logic (no DOM, no three.js)
 * Mesh parsing, topology, CSG, FLUKA bodies/regions, generation and parsing of the GEOBEGIN/GEOEND block.
 * All lengths are in cm (FLUKA unit). */
(function (root) {
  'use strict';
  const FK = {};
  FK.VERSION = '1.4';
  FK.APP_NAME = 'Combinatorial Geometry Tool';
  FK.resolution = 1;   // global tessellation factor of the displayed curved bodies (cylinders, cones, spheres)
  FK.seg = (n) => Math.max(8, Math.round(n * FK.resolution));

  /* ---------------- Vecteurs ---------------- */
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    neg: (a) => [-a[0], -a[1], -a[2]]
  };
  FK.V = V;

  FK.fmt = function (n, d) {
    if (d === undefined) d = 6;
    if (!isFinite(n)) return '0';
    if (Math.abs(n) < 1e-12) n = 0;
    let s = n.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  };
  const fmt = FK.fmt;

  /* ---------------- Bounding boxes ---------------- */
  function boxUnion(a, b) {
    if (!a) return b; if (!b) return a;
    return { min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
             max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])] };
  }
  function boxDiag(b) { return V.len(V.sub(b.max, b.min)); }
  function boxCenter(b) { return V.mul(V.add(b.min, b.max), 0.5); }
  function boxInside(inner, outer, tol) {
    tol = tol || 0;
    for (let i = 0; i < 3; i++) if (inner.min[i] < outer.min[i] - tol || inner.max[i] > outer.max[i] + tol) return false;
    return true;
  }
  function boxOverlap(a, b) {
    for (let i = 0; i < 3; i++) if (a.max[i] < b.min[i] || b.max[i] < a.min[i]) return false;
    return true;
  }
  FK.boxUnion = boxUnion; FK.boxDiag = boxDiag; FK.boxCenter = boxCenter;

  /* ---------------- STL reader ---------------- */
  FK.parseSTL = function (buf) {
    const bytes = new Uint8Array(buf);
    let binary = false;
    if (bytes.length >= 84) {
      const dv = new DataView(buf);
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === bytes.length) binary = true;
    }
    if (!binary) {
      let head = '';
      const m = Math.min(bytes.length, 1024);
      for (let i = 0; i < m; i++) head += String.fromCharCode(bytes[i]);
      if (!/^\s*solid/i.test(head) || !/facet/i.test(head)) binary = bytes.length >= 84;
    }
    if (binary) {
      const dv = new DataView(buf);
      let n = dv.getUint32(80, true);
      n = Math.min(n, Math.floor((bytes.length - 84) / 50));
      const pos = new Float32Array(n * 9);
      const nor = new Float32Array(n * 3);
      let off = 84;
      let k = 0;
      for (let i = 0; i < n; i++, off += 50) {
        const p = [dv.getFloat32(off + 12, true), dv.getFloat32(off + 16, true), dv.getFloat32(off + 20, true),
          dv.getFloat32(off + 24, true), dv.getFloat32(off + 28, true), dv.getFloat32(off + 32, true),
          dv.getFloat32(off + 36, true), dv.getFloat32(off + 40, true), dv.getFloat32(off + 44, true)];
        let ok = true;
        for (let j = 0; j < 9; j++) if (!isFinite(p[j])) { ok = false; break; }
        if (!ok) continue;
        for (let j = 0; j < 9; j++) pos[k * 9 + j] = p[j];
        nor[k * 3] = dv.getFloat32(off, true); nor[k * 3 + 1] = dv.getFloat32(off + 4, true); nor[k * 3 + 2] = dv.getFloat32(off + 8, true);
        k++;
      }
      return { positions: pos.slice(0, k * 9), normals: nor.slice(0, k * 3), count: k, binary: true };
    }
    // ASCII
    let text = '';
    if (typeof TextDecoder !== 'undefined') text = new TextDecoder('utf-8').decode(bytes);
    else for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    const re = /(facet\s+normal|vertex)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/gi;
    const pos = [], nor = [];
    let m, vc = 0, curN = [0, 0, 0], tri = [];
    while ((m = re.exec(text))) {
      const a = +m[2], b = +m[3], c = +m[4];
      if (/^facet/i.test(m[1])) { curN = [a, b, c]; vc = 0; tri = []; }
      else {
        tri.push(a, b, c); vc++;
        if (vc === 3) {
          if (tri.every(isFinite)) { for (let j = 0; j < 9; j++) pos.push(tri[j]); nor.push(curN[0], curN[1], curN[2]); }
          vc = 0; tri = [];
        }
      }
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nor), count: pos.length / 9, binary: false };
  };

  /* ---------------- OBJ reader (Wavefront) ----------------
   * Vertices "v", faces "f" (polygons fan-triangulated, negative relative indices allowed),
   * line continuation "\". All objects/groups are merged into a single mesh. */
  FK.parseOBJ = function (buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let text = '';
    if (typeof TextDecoder !== 'undefined') text = new TextDecoder('utf-8').decode(bytes);
    else for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    text = text.replace(/\\\r?\n/g, ' ');
    const vx = [], pos = [];
    let groups = 0, skipped = 0;
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim();
      if (!l || l[0] === '#') continue;
      const t = l.split(/\s+/);
      if (t[0] === 'v') { const a = +t[1], b = +t[2], c = +t[3]; vx.push(isFinite(a) && isFinite(b) && isFinite(c) ? [a, b, c] : [0, 0, 0]); }
      else if (t[0] === 'o' || t[0] === 'g') groups++;
      else if (t[0] === 'f') {
        const idx = [];
        for (let i = 1; i < t.length; i++) {
          let k = parseInt(t[i].split('/')[0], 10);
          if (!isFinite(k)) continue;
          k = k < 0 ? vx.length + k : k - 1;
          if (k >= 0 && k < vx.length) idx.push(k);
        }
        if (idx.length < 3) { skipped++; continue; }
        for (let i = 1; i < idx.length - 1; i++) for (const k of [idx[0], idx[i], idx[i + 1]]) pos.push(vx[k][0], vx[k][1], vx[k][2]);
      }
    }
    const positions = new Float32Array(pos);
    return { positions, normals: new Float32Array(positions.length / 3), count: positions.length / 9, binary: false, format: 'OBJ', groups, skipped };
  };
  /** Picks STL or OBJ from the file name. */
  FK.parseMesh = function (buf, name) {
    if (/\.obj$/i.test(name || '')) return FK.parseOBJ(buf);
    const r = FK.parseSTL(buf); r.format = 'STL'; return r;
  };

  /* ---------------- Statistiques de maillage ---------------- */
  FK.meshStats = function (pos) {
    const n = pos.length / 9;
    let vol = 0, area = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const a = [pos[o], pos[o + 1], pos[o + 2]], b = [pos[o + 3], pos[o + 4], pos[o + 5]], c = [pos[o + 6], pos[o + 7], pos[o + 8]];
      for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
      const cr = V.cross(V.sub(b, a), V.sub(c, a));
      area += 0.5 * V.len(cr);
      const v6 = V.dot(a, V.cross(b, c));
      vol += v6 / 6;
      cx += v6 / 6 * (a[0] + b[0] + c[0]) / 4; cy += v6 / 6 * (a[1] + b[1] + c[1]) / 4; cz += v6 / 6 * (a[2] + b[2] + c[2]) / 4;
    }
    const centroid = Math.abs(vol) > 1e-12 ? [cx / vol, cy / vol, cz / vol] : (n ? V.mul(V.add(mn, mx), 0.5) : [0, 0, 0]);
    return { count: n, volume: vol, area, bbox: n ? { min: mn, max: mx } : null, centroid };
  };

  /* ---------------- Topology (adjacency, coplanar faces, sharp edges) ---------------- */
  FK.buildTopology = function (pos) {
    const nTri = pos.length / 9;
    const st = FK.meshStats(pos);
    const diag = st.bbox ? boxDiag(st.bbox) : 1;
    const eps = Math.max(diag * 1e-7, 1e-9);
    const map = new Map();
    const vid = new Int32Array(nTri * 3);
    const vpos = [];
    for (let i = 0; i < nTri * 3; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const key = Math.round(x / eps) + ',' + Math.round(y / eps) + ',' + Math.round(z / eps);
      let id = map.get(key);
      if (id === undefined) { id = vpos.length / 3; map.set(key, id); vpos.push(x, y, z); }
      vid[i] = id;
    }
    const nV = vpos.length / 3;
    const nbr = new Int32Array(nTri * 3).fill(-1);
    const emap = new Map();
    for (let t = 0; t < nTri; t++) {
      for (let k = 0; k < 3; k++) {
        const a = vid[t * 3 + k], b = vid[t * 3 + (k + 1) % 3];
        if (a === b) continue;
        const key = (a < b ? a * nV + b : b * nV + a);
        const prev = emap.get(key);
        if (prev === undefined) emap.set(key, t * 3 + k);
        else if (nbr[prev] === -1 && Math.floor(prev / 3) !== t) { nbr[prev] = t; nbr[t * 3 + k] = Math.floor(prev / 3); }
      }
    }
    const nrm = new Float32Array(nTri * 3), areas = new Float32Array(nTri);
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      const a = [pos[o], pos[o + 1], pos[o + 2]], b = [pos[o + 3], pos[o + 4], pos[o + 5]], c = [pos[o + 6], pos[o + 7], pos[o + 8]];
      const cr = V.cross(V.sub(b, a), V.sub(c, a));
      const l = V.len(cr);
      areas[t] = l / 2;
      if (l > 0) { nrm[t * 3] = cr[0] / l; nrm[t * 3 + 1] = cr[1] / l; nrm[t * 3 + 2] = cr[2] / l; }
    }
    return { nTri, nV, vid, vpos: Float32Array.from(vpos), nbr, nrm, areas, pos, vStart: null, vTris: null };
  };

  function triNormal(topo, t) { return [topo.nrm[t * 3], topo.nrm[t * 3 + 1], topo.nrm[t * 3 + 2]]; }
  FK.triNormal = triNormal;
  FK.triVerts = function (topo, t) {
    const p = topo.pos, o = t * 9;
    return [[p[o], p[o + 1], p[o + 2]], [p[o + 3], p[o + 4], p[o + 5]], [p[o + 6], p[o + 7], p[o + 8]]];
  };

  /** Triangles coplanar with and connected to triangle t0 (angular tolerance in degrees). */
  FK.coplanarPatch = function (topo, t0, tolDeg) {
    const cosT = Math.cos((tolDeg === undefined ? 1 : tolDeg) * Math.PI / 180);
    const n0 = triNormal(topo, t0);
    const seen = new Uint8Array(topo.nTri);
    const out = [t0]; seen[t0] = 1;
    for (let i = 0; i < out.length; i++) {
      const t = out[i];
      for (let k = 0; k < 3; k++) {
        const nb = topo.nbr[t * 3 + k];
        if (nb < 0 || seen[nb]) continue;
        if (V.dot(n0, triNormal(topo, nb)) >= cosT) { seen[nb] = 1; out.push(nb); }
      }
      if (out.length > 400000) break;
    }
    return out;
  };

  FK.patchInfo = function (topo, tris) {
    let area = 0, cx = 0, cy = 0, cz = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const pos = topo.pos;
    for (const t of tris) {
      const a = topo.areas[t];
      area += a;
      const o = t * 9;
      cx += a * (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
      cy += a * (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
      cz += a * (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
      for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
        const val = pos[o + v * 3 + k];
        if (val < mn[k]) mn[k] = val; if (val > mx[k]) mx[k] = val;
      }
    }
    return { area, centroid: area > 0 ? [cx / area, cy / area, cz / area] : [0, 0, 0], bbox: { min: mn, max: mx }, count: tris.length };
  };

  function ensureVertTris(topo) {
    if (topo.vStart) return;
    const cnt = new Int32Array(topo.nV + 1);
    for (let i = 0; i < topo.nTri * 3; i++) cnt[topo.vid[i] + 1]++;
    for (let i = 0; i < topo.nV; i++) cnt[i + 1] += cnt[i];
    const fill = cnt.slice(0, topo.nV);
    const list = new Int32Array(topo.nTri * 3);
    for (let t = 0; t < topo.nTri; t++) for (let k = 0; k < 3; k++) { const v = topo.vid[t * 3 + k]; list[fill[v]++] = t; }
    topo.vStart = cnt; topo.vTris = list;
  }

  function isSharpEdge(topo, t, k, cosA) {
    const nb = topo.nbr[t * 3 + k];
    if (nb < 0) return true;
    return V.dot(triNormal(topo, t), triNormal(topo, nb)) < cosA;
  }
  FK.isSharpEdge = isSharpEdge;

  function vpt(topo, v) { return [topo.vpos[v * 3], topo.vpos[v * 3 + 1], topo.vpos[v * 3 + 2]]; }

  /** Sharp edges incident to vertex v: returns the list of the other end points. */
  function sharpNeighbors(topo, v, cosA) {
    ensureVertTris(topo);
    const set = new Set();
    for (let i = topo.vStart[v]; i < topo.vStart[v + 1]; i++) {
      const t = topo.vTris[i];
      for (let k = 0; k < 3; k++) {
        const a = topo.vid[t * 3 + k], b = topo.vid[t * 3 + (k + 1) % 3];
        if (a !== v && b !== v) continue;
        if (!isSharpEdge(topo, t, k, cosA)) continue;
        set.add(a === v ? b : a);
      }
    }
    return Array.from(set);
  }

  /** Extends a sharp edge (a,b) as long as it stays straight. */
  FK.edgeChain = function (topo, va, vb, sharpDeg) {
    const cosA = Math.cos((sharpDeg === undefined ? 20 : sharpDeg) * Math.PI / 180);
    const dirTol = Math.cos(2 * Math.PI / 180);
    const path = [va, vb];
    const d0 = V.norm(V.sub(vpt(topo, vb), vpt(topo, va)));
    const visited = new Set([va, vb]);
    function extend(end, dir, push) {
      for (let guard = 0; guard < 20000; guard++) {
        const nb = sharpNeighbors(topo, end, cosA).filter(x => !visited.has(x));
        if (nb.length !== 1) return;
        const c = nb[0];
        const d = V.norm(V.sub(vpt(topo, c), vpt(topo, end)));
        if (V.dot(d, dir) < dirTol) return;
        visited.add(c);
        push(c); end = c;
      }
    }
    extend(vb, d0, c => path.push(c));
    extend(va, V.neg(d0), c => path.unshift(c));
    const a = vpt(topo, path[0]), b = vpt(topo, path[path.length - 1]);
    return { a, b, segments: path.length - 1, length: V.dist(a, b) };
  };

  /**
   * Follows the sharp edges through (a, b) as long as the path stays unambiguous (one continuation) and turns by at most
   * maxTurnDeg per step: a circular rim of a tessellated cylinder comes back as a closed loop of points.
   * Returns { pts: [[x,y,z]…], closed, segments }.
   */
  FK.edgeLoop = function (topo, va, vb, sharpDeg, maxTurnDeg) {
    const cosA = Math.cos((sharpDeg === undefined ? 20 : sharpDeg) * Math.PI / 180), cosT = Math.cos((maxTurnDeg || 50) * Math.PI / 180);
    const path = [va, vb], seen = new Set(path);
    let closed = false;
    const ext = (push, first) => {
      let prev = first[0], end = first[1];
      for (let guard = 0; guard < 200000; guard++) {
        const nb = sharpNeighbors(topo, end, cosA).filter(x => x !== prev);
        if (nb.length !== 1) return;
        const c = nb[0];
        if (seen.has(c)) { if (c === path[0] && path.length > 2 && !closed) closed = true; return; }
        const d1 = V.norm(V.sub(vpt(topo, end), vpt(topo, prev))), d2 = V.norm(V.sub(vpt(topo, c), vpt(topo, end)));
        if (V.dot(d1, d2) < cosT) return;
        seen.add(c); push(c); prev = end; end = c;
      }
    };
    ext(c => path.push(c), [va, vb]);
    if (!closed) ext(c => path.unshift(c), [vb, va]);
    const pts = path.map(v => vpt(topo, v));
    if (closed) pts.push(pts[0].slice());
    return { pts, closed, segments: pts.length - 1 };
  };

  /** Eigen-decomposition of a symmetric 3×3 matrix (Jacobi). Returns { vals, vecs } (vecs[i] = unit eigenvector of vals[i]). */
  function jacobi3(A) {
    const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 60; sweep++) {
      const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
      if (off < 1e-30) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), sn = t * c;
        for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - sn * akq; a[k][q] = sn * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - sn * aqk; a[q][k] = sn * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - sn * vkq; v[k][q] = sn * vkp + c * vkq; }
      }
    }
    return { vals: [a[0][0], a[1][1], a[2][2]], vecs: [0, 1, 2].map(j => [v[0][j], v[1][j], v[2][j]]) };
  }
  /**
   * Least-squares circle through ≥ 3 points in 3D: plane fit (smallest principal axis) then algebraic circle fit in the plane.
   * Returns { c, n, r, rms, maxDev, planeDev, count } or null when the points are (nearly) collinear.
   */
  FK.fitCircle3D = function (pts) {
    let P = pts.slice();
    if (P.length > 1 && V.dist(P[0], P[P.length - 1]) < 1e-12) P.pop();       // closed loop: drop the duplicated end point
    const n = P.length; if (n < 3) return null;
    const cen = V.mul(P.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / n);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of P) { const d = V.sub(p, cen); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
    const { vals, vecs } = jacobi3(C), idx = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
    if (vals[idx[1]] < 1e-18 * Math.max(1, vals[idx[2]]) || vals[idx[1]] < 1e-12 * vals[idx[2]]) return null;      // collinear
    const nrm = vecs[idx[0]], u = vecs[idx[2]], w = V.cross(nrm, u);
    const xy = P.map(p => { const d = V.sub(p, cen); return [V.dot(d, u), V.dot(d, w)]; });
    // Kåsa fit: x² + y² + D x + E y + F = 0
    let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sz = 0, sxz = 0, syz = 0;
    for (const [x, y] of xy) { const z = x * x + y * y; sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sz += z; sxz += x * z; syz += y * z; }
    const m = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]];
    for (let i = 0; i < 3; i++) {                                                // Gauss elimination with pivoting
      let piv = i; for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[piv][i])) piv = k;
      if (Math.abs(m[piv][i]) < 1e-300) return null;
      [m[i], m[piv]] = [m[piv], m[i]];
      for (let k = i + 1; k < 3; k++) { const f = m[k][i] / m[i][i]; for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j]; }
    }
    const sol = [0, 0, 0];
    for (let i = 2; i >= 0; i--) { let t = m[i][3]; for (let j = i + 1; j < 3; j++) t -= m[i][j] * sol[j]; sol[i] = t / m[i][i]; }
    const a = -sol[0] / 2, b = -sol[1] / 2, r2 = a * a + b * b - sol[2];
    if (!(r2 > 0) || !isFinite(r2)) return null;
    const r = Math.sqrt(r2), c = V.add(cen, V.add(V.mul(u, a), V.mul(w, b)));
    let ss = 0, maxDev = 0, planeDev = 0;
    P.forEach((p, i) => { const dv = Math.hypot(xy[i][0] - a, xy[i][1] - b) - r; ss += dv * dv; maxDev = Math.max(maxDev, Math.abs(dv)); planeDev = Math.max(planeDev, Math.abs(V.dot(V.sub(p, cen), nrm))); });
    return { c, n: nrm, r, rms: Math.sqrt(ss / n), maxDev, planeDev, count: n };
  };

  /* ---------------- CSG (BSP) ---------------- */
  const EPS = 1e-6;
  class Plane {
    constructor(n, w) { this.n = n; this.w = w; }
    clone() { return new Plane(this.n.slice(), this.w); }
    flip() { this.n = V.neg(this.n); this.w = -this.w; }
  }
  class Polygon {
    constructor(verts, plane) {
      this.v = verts;
      this.plane = plane || Polygon.newell(verts);
    }
    static newell(vs) {
      let nx = 0, ny = 0, nz = 0;
      const n = vs.length;
      for (let i = 0; i < n; i++) {
        const a = vs[i], b = vs[(i + 1) % n];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      const nn = [nx / l, ny / l, nz / l];
      let c = [0, 0, 0];
      for (const p of vs) c = V.add(c, p);
      c = V.mul(c, 1 / n);
      return new Plane(nn, V.dot(nn, c));
    }
    clone() { return new Polygon(this.v.map(p => p.slice()), this.plane.clone()); }
    flip() { this.v.reverse(); this.plane.flip(); }
  }

  function splitPolygon(pl, poly, cf, cb, front, back) {
    let type = 0;
    const types = [];
    for (const p of poly.v) {
      const t = V.dot(pl.n, p) - pl.w;
      const ty = t < -EPS ? 2 : t > EPS ? 1 : 0;
      type |= ty; types.push(ty);
    }
    if (type === 0) { (V.dot(pl.n, poly.plane.n) > 0 ? cf : cb).push(poly); }
    else if (type === 1) front.push(poly);
    else if (type === 2) back.push(poly);
    else {
      const f = [], b = [];
      const n = poly.v.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ti = types[i], tj = types[j];
        const vi = poly.v[i], vj = poly.v[j];
        if (ti !== 2) f.push(vi);
        if (ti !== 1) b.push(ti !== 2 ? vi.slice() : vi);
        if ((ti | tj) === 3) {
          const t = (pl.w - V.dot(pl.n, vi)) / V.dot(pl.n, V.sub(vj, vi));
          const nv = V.lerp(vi, vj, t);
          f.push(nv); b.push(nv.slice());
        }
      }
      if (f.length >= 3) front.push(new Polygon(f, poly.plane.clone()));
      if (b.length >= 3) back.push(new Polygon(b, poly.plane.clone()));
    }
  }

  class BNode {
    constructor(polys) {
      this.plane = null; this.front = null; this.back = null; this.polygons = [];
      if (polys) this.build(polys);
    }
    invert() {
      for (const p of this.polygons) p.flip();
      if (this.plane) this.plane.flip();
      if (this.front) this.front.invert();
      if (this.back) this.back.invert();
      const t = this.front; this.front = this.back; this.back = t;
    }
    clipPolygons(polys) {
      if (!this.plane) return polys.slice();
      let front = [], back = [];
      for (const p of polys) splitPolygon(this.plane, p, front, back, front, back);
      if (this.front) front = this.front.clipPolygons(front);
      if (this.back) back = this.back.clipPolygons(back); else back = [];
      return front.concat(back);
    }
    clipTo(bsp) {
      this.polygons = bsp.clipPolygons(this.polygons);
      if (this.front) this.front.clipTo(bsp);
      if (this.back) this.back.clipTo(bsp);
    }
    allPolygons() {
      let p = this.polygons.slice();
      if (this.front) p = p.concat(this.front.allPolygons());
      if (this.back) p = p.concat(this.back.allPolygons());
      return p;
    }
    build(polys) {
      if (!polys.length) return;
      if (!this.plane) this.plane = polys[0].plane.clone();
      const front = [], back = [];
      for (const p of polys) splitPolygon(this.plane, p, this.polygons, this.polygons, front, back);
      if (front.length) { if (!this.front) this.front = new BNode(); this.front.build(front); }
      if (back.length) { if (!this.back) this.back = new BNode(); this.back.build(back); }
    }
  }

  function bboxOfPolys(polys) {
    if (!polys.length) return null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of polys) for (const v of p.v) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
    return { min: mn, max: mx };
  }
  function nodeOf(polys) { return new BNode(polys.map(p => p.clone())); }

  const CSG = {
    union(a, b) {
      if (!a.length) return b.map(p => p.clone());
      if (!b.length) return a.map(p => p.clone());
      const A = nodeOf(a), B = nodeOf(b);
      A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
      A.build(B.allPolygons());
      return A.allPolygons();
    },
    subtract(a, b) {
      if (!a.length) return [];
      if (!b.length) return a.map(p => p.clone());
      const ba = bboxOfPolys(a), bb = bboxOfPolys(b);
      if (!boxOverlap(ba, bb)) return a.map(p => p.clone());
      const A = nodeOf(a), B = nodeOf(b);
      A.invert(); A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
      A.build(B.allPolygons()); A.invert();
      return A.allPolygons();
    },
    intersect(a, b) {
      if (!a.length || !b.length) return [];
      if (!boxOverlap(bboxOfPolys(a), bboxOfPolys(b))) return [];
      const A = nodeOf(a), B = nodeOf(b);
      A.invert(); B.clipTo(A); B.invert(); A.clipTo(B); B.clipTo(A);
      A.build(B.allPolygons()); A.invert();
      return A.allPolygons();
    }
  };
  FK.CSG = CSG;

  /* ---------------- Primitives (polygones, normales sortantes) ---------------- */
  function dedupe(pts) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || V.dist(p, q) > 1e-9) out.push(p);
    }
    if (out.length > 1 && V.dist(out[0], out[out.length - 1]) <= 1e-9) out.pop();
    return out;
  }
  function mkPoly(pts) { const d = dedupe(pts); return d.length >= 3 ? new Polygon(d) : null; }

  /** Oriented box: centre + 3 half-axis vectors. */
  function orientedBox(c, au, av, aw) {
    if (V.dot(V.cross(au, av), aw) < 0) aw = V.neg(aw);
    const faces = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
    const polys = [];
    for (const f of faces) {
      const pts = f.map(i => {
        const sx = (i & 1) ? 1 : -1, sy = (i & 2) ? 1 : -1, sz = (i & 4) ? 1 : -1;
        return [c[0] + sx * au[0] + sy * av[0] + sz * aw[0], c[1] + sx * au[1] + sy * av[1] + sz * aw[1], c[2] + sx * au[2] + sy * av[2] + sz * aw[2]];
      });
      const p = mkPoly(pts); if (p) polys.push(p);
    }
    return polys;
  }
  function boxPolys(box) {
    const c = boxCenter(box);
    const h = V.mul(V.sub(box.max, box.min), 0.5);
    return orientedBox(c, [h[0], 0, 0], [0, h[1], 0], [0, 0, h[2]]);
  }
  FK.boxPolys = boxPolys;

  function perpBasis(d) {
    const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = V.norm(V.cross(a, d));
    const v = V.cross(d, u);
    return [u, v];
  }
  function cylinderPolys(base, H, r1, r2, seg) {
    const hl = V.len(H);
    if (hl < 1e-12 || (r1 <= 0 && r2 <= 0)) return [];
    const d = V.mul(H, 1 / hl);
    // u x v = d
    let [u, v] = perpBasis(d);
    if (V.dot(V.cross(u, v), d) < 0) v = V.neg(v);
    const bs = [], ts = [];
    const top = V.add(base, H);
    for (let i = 0; i < seg; i++) {
      const th = 2 * Math.PI * i / seg;
      const c = Math.cos(th), s = Math.sin(th);
      const dir = [c * u[0] + s * v[0], c * u[1] + s * v[1], c * u[2] + s * v[2]];
      bs.push(V.add(base, V.mul(dir, r1)));
      ts.push(V.add(top, V.mul(dir, r2)));
    }
    const polys = [];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const p = mkPoly([bs[i], bs[j], ts[j], ts[i]]); if (p) polys.push(p);
    }
    if (r1 > 0) { const p = mkPoly(bs.slice().reverse()); if (p) polys.push(p); }
    if (r2 > 0) { const p = mkPoly(ts.slice()); if (p) polys.push(p); }
    return polys;
  }
  function spherePolys(c, R, nLon, nLat) {
    if (R <= 0) return [];
    const P = (i, j) => {
      const th = Math.PI * i / nLat, ph = 2 * Math.PI * j / nLon;
      return [c[0] + R * Math.sin(th) * Math.cos(ph), c[1] + R * Math.sin(th) * Math.sin(ph), c[2] + R * Math.cos(th)];
    };
    const polys = [];
    for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
      const p = mkPoly([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
      if (p) polys.push(p);
    }
    return polys;
  }
  FK.primitives = { orientedBox, boxPolys, cylinderPolys, spherePolys };

  /* ---------------- Corps FLUKA ---------------- */
  const BODY_TYPES = {
    RPP: { label: 'RPP — rectangular box', fields: ['Xmin', 'Xmax', 'Ymin', 'Ymax', 'Zmin', 'Zmax'], prefix: 'rpp' },
    SPH: { label: 'SPH — sphere', fields: ['Xc', 'Yc', 'Zc', 'R'], prefix: 'sph' },
    RCC: { label: 'RCC — right circular cylinder', fields: ['Vx', 'Vy', 'Vz', 'Hx', 'Hy', 'Hz', 'R'], prefix: 'rcc' },
    TRC: { label: 'TRC — truncated cone', fields: ['Vx', 'Vy', 'Vz', 'Hx', 'Hy', 'Hz', 'R1', 'R2'], prefix: 'trc' },
    PLA: { label: 'PLA — arbitrary plane', fields: ['Hx', 'Hy', 'Hz', 'Vx', 'Vy', 'Vz'], prefix: 'pla' },
    XYP: { label: 'XYP — plane ⟂ Z', fields: ['Z'], prefix: 'xyp' },
    XZP: { label: 'XZP — plane ⟂ Y', fields: ['Y'], prefix: 'xzp' },
    YZP: { label: 'YZP — plane ⟂ X', fields: ['X'], prefix: 'yzp' },
    XCC: { label: 'XCC — infinite cylinder ∥ X', fields: ['Yc', 'Zc', 'R'], prefix: 'xcc' },
    YCC: { label: 'YCC — infinite cylinder ∥ Y', fields: ['Zc', 'Xc', 'R'], prefix: 'ycc' },
    ZCC: { label: 'ZCC — infinite cylinder ∥ Z', fields: ['Xc', 'Yc', 'R'], prefix: 'zcc' }
  };
  FK.BODY_TYPES = BODY_TYPES;
  FK.PALETTE = ['#2f80ed', '#eb5757', '#27ae60', '#f2994a', '#9b51e0', '#00a6a6', '#c2185b', '#7f8c3a', '#6d4c41', '#3949ab'];

  FK.isPlaneType = (t) => t === 'PLA' || t === 'XYP' || t === 'XZP' || t === 'YZP';
  FK.isInfiniteType = (t) => FK.isPlaneType(t) || t === 'XCC' || t === 'YCC' || t === 'ZCC' || t === 'ICC';

  /** Equivalent plane {V (point), H (outward vector)} for plane types. */
  FK.planeOf = function (b) {
    const p = b.p;
    switch (b.type) {
      case 'PLA': return { V: [p[3], p[4], p[5]], H: [p[0], p[1], p[2]] };
      case 'XYP': return { V: [0, 0, p[0]], H: [0, 0, 1] };
      case 'XZP': return { V: [0, p[0], 0], H: [0, 1, 0] };
      case 'YZP': return { V: [p[0], 0, 0], H: [1, 0, 0] };
    }
    return null;
  };

  FK.bodyBBox = function (b) {
    const p = b.p;
    switch (b.type) {
      case 'RPP': return { min: [Math.min(p[0], p[1]), Math.min(p[2], p[3]), Math.min(p[4], p[5])], max: [Math.max(p[0], p[1]), Math.max(p[2], p[3]), Math.max(p[4], p[5])] };
      case 'SPH': return { min: [p[0] - p[3], p[1] - p[3], p[2] - p[3]], max: [p[0] + p[3], p[1] + p[3], p[2] + p[3]] };
      case 'RCC': case 'TRC': {
        const r = b.type === 'RCC' ? p[6] : Math.max(p[6], p[7]);
        const H = [p[3], p[4], p[5]], hl = V.len(H) || 1;
        const d = V.mul(H, 1 / hl);
        const A = [p[0], p[1], p[2]], B = V.add(A, H);
        const e = d.map(x => r * Math.sqrt(Math.max(0, 1 - x * x)));
        return { min: [Math.min(A[0], B[0]) - e[0], Math.min(A[1], B[1]) - e[1], Math.min(A[2], B[2]) - e[2]], max: [Math.max(A[0], B[0]) + e[0], Math.max(A[1], B[1]) + e[1], Math.max(A[2], B[2]) + e[2]] };
      }
      case 'OBOX': {
        const e = [0, 1, 2].map(i => Math.abs(p[3 + i]) + Math.abs(p[6 + i]) + Math.abs(p[9 + i]));
        return { min: [p[0] - e[0], p[1] - e[1], p[2] - e[2]], max: [p[0] + e[0], p[1] + e[1], p[2] + e[2]] };
      }
    }
    return null;
  };

  FK.bodyVolume = function (b) {
    const p = b.p;
    switch (b.type) {
      case 'RPP': return Math.abs((p[1] - p[0]) * (p[3] - p[2]) * (p[5] - p[4]));
      case 'SPH': return 4 / 3 * Math.PI * p[3] ** 3;
      case 'RCC': return Math.PI * p[6] ** 2 * V.len([p[3], p[4], p[5]]);
      case 'TRC': return Math.PI / 3 * V.len([p[3], p[4], p[5]]) * (p[6] ** 2 + p[6] * p[7] + p[7] ** 2);
      case 'OBOX': return 8 * Math.abs(V.dot([p[3], p[4], p[5]], V.cross([p[6], p[7], p[8]], [p[9], p[10], p[11]])));
    }
    return null;
  };


  /* ---------------- 3×4 matrices (rotation + translation) ----------------
   * m = [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz] ; p_parent = R·p + t */
  const M = {
    id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    apply: (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]],
    applyVec: (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]],
    /** a∘b : applique b puis a */
    mul: (a, b) => {
      const o = new Array(12);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) o[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
        o[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
      }
      return o;
    },
    /** inverse (transformation rigide) */
    inv: (m) => [m[0], m[4], m[8], -(m[0] * m[3] + m[4] * m[7] + m[8] * m[11]),
      m[1], m[5], m[9], -(m[1] * m[3] + m[5] * m[7] + m[9] * m[11]),
      m[2], m[6], m[10], -(m[2] * m[3] + m[6] * m[7] + m[10] * m[11])],
    isTranslation: (m, eps) => { eps = eps || 1e-12; return Math.abs(m[0] - 1) < eps && Math.abs(m[5] - 1) < eps && Math.abs(m[10] - 1) < eps && [1, 2, 4, 6, 8, 9].every(i => Math.abs(m[i]) < eps); },
    isIdentity: (m, eps) => { eps = eps || 1e-12; return M.isTranslation(m, eps) && Math.abs(m[3]) < eps && Math.abs(m[7]) < eps && Math.abs(m[11]) < eps; },
    /** R = Rz(γ)·Ry(β)·Rx(α), angles in degrees [α, β, γ] */
    fromPosEuler: (pos, ang) => {
      const d = Math.PI / 180, sa = Math.sin(ang[0] * d), ca = Math.cos(ang[0] * d), sb = Math.sin(ang[1] * d), cb = Math.cos(ang[1] * d), sg = Math.sin(ang[2] * d), cg = Math.cos(ang[2] * d);
      return [cg * cb, cg * sb * sa - sg * ca, cg * sb * ca + sg * sa, pos[0],
        sg * cb, sg * sb * sa + cg * ca, sg * sb * ca - cg * sa, pos[1],
        -sb, cb * sa, cb * ca, pos[2]];
    },
    toEuler: (m) => {
      const r = 180 / Math.PI, sb = Math.max(-1, Math.min(1, -m[8])), cb = Math.sqrt(Math.max(0, 1 - sb * sb));
      let a, g;
      if (cb > 1e-8) { a = Math.atan2(m[9], m[10]); g = Math.atan2(m[4], m[0]); }
      else { g = 0; a = sb > 0 ? Math.atan2(m[1], m[5]) : Math.atan2(-m[1], m[5]); }
      return [a * r, Math.asin(sb) * r, g * r];
    },
    /** origin + X direction + (approximate) Y direction → right-handed orthonormal frame, or null if degenerate */
    fromAxes: (o, xd, yd) => {
      const x = V.norm(xd), zr = V.cross(x, yd), zl = V.len(zr);
      if (V.len(x) < 1e-12 || zl < 1e-12) return null;
      const z = V.mul(zr, 1 / zl), y = V.cross(z, x);
      return [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2]];
    },
    /** checks for a proper rotation (+ translation) within tol; returns the re-orthonormalised matrix */
    clean: (m, tol) => {
      tol = tol || 1e-4;
      if (m.length !== 12 || m.some(x => !isFinite(x))) return { ok: false, error: 'Non-numeric values' };
      const c = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(V.len(c[i]) - 1) > tol) return { ok: false, error: 'Matrix is not orthonormal (column ' + (i + 1) + ' has norm ' + FK.fmt(V.len(c[i]), 5) + '): only rotation + translation are allowed' };
        for (let j = i + 1; j < 3; j++) if (Math.abs(V.dot(c[i], c[j])) > tol) return { ok: false, error: 'Matrix is not orthonormal (columns are not perpendicular)' };
      }
      if (V.dot(V.cross(c[0], c[1]), c[2]) < 0) return { ok: false, error: 'Improper matrix (mirror): not allowed' };
      const x = V.norm(c[0]), z = V.norm(V.cross(x, c[1])), y = V.cross(z, x);
      return { ok: true, m: [x[0], y[0], z[0], m[3], x[1], y[1], z[1], m[7], x[2], y[2], z[2], m[11]] };
    },
    /** signed axis permutation? returns null otherwise */
    signedPerm: (m, eps) => {
      eps = eps || 1e-9;
      const rows = [];
      for (let i = 0; i < 3; i++) {
        let j = -1, s = 0;
        for (let k = 0; k < 3; k++) { const v = m[i * 4 + k]; if (Math.abs(Math.abs(v) - 1) < eps) { if (j >= 0) return null; j = k; s = Math.sign(v); } else if (Math.abs(v) > eps) return null; }
        if (j < 0) return null;
        rows.push({ j, s });
      }
      return new Set(rows.map(r => r.j)).size === 3 ? rows : null;
    }
  };
  FK.M = M;

  /** Equivalent body expressed in the world frame (m = world matrix of the body's csys).
   * Returned types: usual FLUKA types, plus 'OBOX' (rotated RPP → bounding RPP + planes) and 'ICC' (oblique infinite cylinder → QUA). */
  FK.worldBody = function (b, m) {
    if (b.type === 'RAW' || !m || M.isIdentity(m)) return b;
    const p = b.p, tr = M.isTranslation(m, 1e-9), perm = M.signedPerm(m);
    switch (b.type) {
      case 'SPH': return { type: 'SPH', p: M.apply(m, [p[0], p[1], p[2]]).concat([p[3]]) };
      case 'RCC': return { type: 'RCC', p: M.apply(m, [p[0], p[1], p[2]]).concat(M.applyVec(m, [p[3], p[4], p[5]]), [p[6]]) };
      case 'TRC': return { type: 'TRC', p: M.apply(m, [p[0], p[1], p[2]]).concat(M.applyVec(m, [p[3], p[4], p[5]]), [p[6], p[7]]) };
      case 'PLA': return { type: 'PLA', p: M.applyVec(m, [p[0], p[1], p[2]]).concat(M.apply(m, [p[3], p[4], p[5]])) };
      case 'XYP': case 'XZP': case 'YZP': {
        if (tr) { const k = b.type === 'XYP' ? 11 : b.type === 'XZP' ? 7 : 3; return { type: b.type, p: [p[0] + m[k]] }; }
        const pl = FK.planeOf(b);
        return { type: 'PLA', p: M.applyVec(m, pl.H).concat(M.apply(m, pl.V)) };
      }
      case 'RPP': {
        const x0 = Math.min(p[0], p[1]), x1 = Math.max(p[0], p[1]), y0 = Math.min(p[2], p[3]), y1 = Math.max(p[2], p[3]), z0 = Math.min(p[4], p[5]), z1 = Math.max(p[4], p[5]);
        if (tr || perm) {
          let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) { const q = M.apply(m, [x, y, z]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); } }
          return { type: 'RPP', p: [mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]] };
        }
        const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
        const c = M.apply(m, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
        return { type: 'OBOX', p: c.concat(M.applyVec(m, [hx, 0, 0]), M.applyVec(m, [0, hy, 0]), M.applyVec(m, [0, 0, hz])) };
      }
      case 'XCC': case 'YCC': case 'ZCC': {
        const ax = { XCC: [1, 0, 0], YCC: [0, 1, 0], ZCC: [0, 0, 1] }[b.type];
        const c0 = b.type === 'XCC' ? [0, p[0], p[1]] : b.type === 'YCC' ? [p[1], 0, p[0]] : [p[0], p[1], 0];
        const c = M.apply(m, c0), d = M.applyVec(m, ax), R = p[2];
        for (let k = 0; k < 3; k++) if (Math.abs(Math.abs(d[k]) - 1) < 1e-9) {
          if (k === 0) return { type: 'XCC', p: [c[1], c[2], R] };
          if (k === 1) return { type: 'YCC', p: [c[2], c[0], R] };
          return { type: 'ZCC', p: [c[0], c[1], R] };
        }
        return { type: 'ICC', p: c.concat(d, [R]) };
      }
    }
    return b;
  };

  /** Texte de la (des) ligne(s) de carte d'un corps (monde). opts.arbInward inverse l'ordre des sommets des faces ARB. */
  FK.exportBodyText = function (wb, name, style, opts) {
    opts = opts || {};
    // style 3: fixed columns — type (A3), name (A8), numbers right-aligned in 19-column fields, 6 per line (max 12 + 114 = 126 columns)
    const head = (t) => style === 3 ? `${t.padEnd(3)} ${name.padEnd(8)}` : style === 2 ? `${t} ${name.padEnd(10)}` : `${t} ${name} `;
    const cont = style === 3 ? ' '.repeat(12) : style === 2 ? ' '.repeat(15) : '    ';
    const lines = (t, nums) => {
      const out = [];
      for (let i = 0; i < nums.length; i += 6) out.push((i ? cont : head(t)) + (style === 3 ? nums.slice(i, i + 6).map(n => String(n).padStart(19)).join('') : nums.slice(i, i + 6).join(' ')));
      return out.join('\n');
    };
    if (wb.type === 'OBOX') {
      const c = [wb.p[0], wb.p[1], wb.p[2]], u = [wb.p[3], wb.p[4], wb.p[5]], v = [wb.p[6], wb.p[7], wb.p[8]];
      let w = [wb.p[9], wb.p[10], wb.p[11]];
      const sg = V.dot(V.cross(u, v), w) < 0 ? -1 : 1;
      const sw = V.mul(w, sg);
      const S3 = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
      const verts = [];
      for (const s of S3) { const q = V.add(c, V.add(V.mul(u, s[0]), V.add(V.mul(v, s[1]), V.mul(sw, s[2])))); verts.push(fmt(q[0]), fmt(q[1]), fmt(q[2])); }
      let faces = [1584, 2376, 1265, 4873, 1432, 5678];
      if (opts.arbInward) faces = faces.map(f => +String(f).split('').reverse().join(''));
      return lines('ARB', verts.concat(faces.map(String)));
    }
    if (wb.type === 'ICC') {
      const c = [wb.p[0], wb.p[1], wb.p[2]], d = V.norm([wb.p[3], wb.p[4], wb.p[5]]), R = wb.p[6];
      const P = [[1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2]], [-d[1] * d[0], 1 - d[1] * d[1], -d[1] * d[2]], [-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]]];
      const Pc = [0, 1, 2].map(i => P[i][0] * c[0] + P[i][1] * c[1] + P[i][2] * c[2]);
      const co = [P[0][0], P[1][1], P[2][2], 2 * P[0][1], 2 * P[0][2], 2 * P[1][2], -2 * Pc[0], -2 * Pc[1], -2 * Pc[2], V.dot(c, Pc) - R * R];
      return lines('QUA', co.map(x => fmt(x)));
    }
    if (style === 3) return lines(wb.type, wb.p.map(x => fmt(x)));
    return head(wb.type) + wb.p.map(x => fmt(x)).join(' ');
  };

  /** Render zone: encloses the mesh and the "reasonable" finite bodies. */
  FK.computeWorldBox = function (stlBoxes, bodies, marginPct) {
    let base = null;
    for (const b of stlBoxes) base = boxUnion(base, b);
    const cands = [];
    for (const b of bodies) if (b.type === 'RPP' || b.type === 'RCC' || b.type === 'TRC' || b.type === 'OBOX') { const bb = FK.bodyBBox(b); if (bb) cands.push(bb); }
    // "envelope" bodies (very large compared to the others) are ignored when sizing the zone
    const diags = cands.map(boxDiag).concat(stlBoxes.map(boxDiag)).sort((x, y) => x - y);
    const med = diags.length ? diags[Math.floor(diags.length / 2)] : 0;
    for (const bb of cands) if (diags.length < 3 || boxDiag(bb) <= 10 * med) base = boxUnion(base, bb);
    if (!base) for (const b of bodies) if (b.type === 'SPH') { const bb = FK.bodyBBox(b); if (!base || boxDiag(bb) < boxDiag(base)) base = bb; }
    if (base) {
      const d0 = boxDiag(base) || 1;
      for (const b of bodies) if (b.type === 'SPH') { const bb = FK.bodyBBox(b); if (boxDiag(bb) <= 3 * d0) base = boxUnion(base, bb); }
    }
    if (!base) base = { min: [-100, -100, -100], max: [100, 100, 100] };
    const m = (marginPct === undefined ? 10 : marginPct) / 100;
    const pad = V.mul(V.sub(base.max, base.min), m);
    let box = { min: V.sub(base.min, pad), max: V.add(base.max, pad) };
    for (let i = 0; i < 3; i++) if (box.max[i] - box.min[i] < 1) { box.min[i] -= 0.5; box.max[i] += 0.5; }
    return box;
  };

  /** Body polygons, clipped to the zone W. Returns null for unsupported types. */
  FK.bodyPolys = function (b, W) {
    const p = b.p;
    let raw = null;
    const diag = boxDiag(W), C = boxCenter(W);
    switch (b.type) {
      case 'RPP': raw = boxPolys(FK.bodyBBox(b)); break;
      case 'SPH': raw = spherePolys([p[0], p[1], p[2]], p[3], FK.seg(32), FK.seg(20)); break;
      case 'RCC': raw = cylinderPolys([p[0], p[1], p[2]], [p[3], p[4], p[5]], p[6], p[6], FK.seg(48)); break;
      case 'TRC': raw = cylinderPolys([p[0], p[1], p[2]], [p[3], p[4], p[5]], p[6], p[7], FK.seg(48)); break;
      case 'PLA': case 'XYP': case 'XZP': case 'YZP': {
        const pl = FK.planeOf(b);
        const n = V.norm(pl.H);
        if (V.len(n) === 0) return [];
        const off = V.dot(V.sub(C, pl.V), n);
        const Pc = V.sub(C, V.mul(n, off));
        const L = 2 * (diag + Math.abs(off)) + 1;
        const [t1, t2] = perpBasis(n);
        raw = orientedBox(V.sub(Pc, V.mul(n, L / 2)), V.mul(t1, L), V.mul(t2, L), V.mul(n, L / 2));
        break;
      }
      case 'OBOX': raw = orientedBox([p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], p[8]], [p[9], p[10], p[11]]); break;
      case 'ICC': {
        const c = [p[0], p[1], p[2]], d = V.norm([p[3], p[4], p[5]]);
        if (p[6] <= 0 || V.len(d) === 0) return [];
        const L = diag * 2 + 1, sC = V.dot(V.sub(C, c), d);
        const base = V.sub(V.add(c, V.mul(d, sC)), V.mul(d, L));
        raw = cylinderPolys(base, V.mul(d, 2 * L), p[6], p[6], FK.seg(64));
        break;
      }
      case 'XCC': case 'YCC': case 'ZCC': {
        const L = diag * 2 + 1;
        if (p[2] <= 0) return [];
        if (b.type === 'ZCC') raw = cylinderPolys([p[0], p[1], C[2] - L], [0, 0, 2 * L], p[2], p[2], FK.seg(64));
        else if (b.type === 'XCC') raw = cylinderPolys([C[0] - L, p[0], p[1]], [2 * L, 0, 0], p[2], p[2], FK.seg(64));
        else raw = cylinderPolys([p[1], C[1] - L, p[0]], [0, 2 * L, 0], p[2], p[2], FK.seg(64));
        break;
      }
      default: return null;
    }
    if (!raw.length) return [];
    if (!FK.isInfiniteType(b.type)) {
      const bb = FK.bodyBBox(b);
      if (bb && boxInside(bb, W, 1e-9)) return raw;
    }
    return CSG.intersect(raw, boxPolys(W));
  };

  /** Plane polygon (for display) clipped to the zone W: vertex list or null. */
  FK.planePolygon = function (b, W) {
    const pl = FK.planeOf(b);
    if (!pl) return null;
    const n = V.norm(pl.H);
    if (V.len(n) === 0) return null;
    const C = boxCenter(W), diag = boxDiag(W);
    const off = V.dot(V.sub(C, pl.V), n);
    const Pc = V.sub(C, V.mul(n, off));
    const [t1, t2] = perpBasis(n);
    const L = diag;
    let poly = new Polygon([V.add(Pc, V.add(V.mul(t1, L), V.mul(t2, L))), V.add(Pc, V.add(V.mul(t1, -L), V.mul(t2, L))),
      V.add(Pc, V.add(V.mul(t1, -L), V.mul(t2, -L))), V.add(Pc, V.add(V.mul(t1, L), V.mul(t2, -L)))], null);
    const planes = [];
    for (let i = 0; i < 3; i++) {
      const e = [0, 0, 0]; e[i] = 1;
      planes.push(new Plane(e, W.max[i]));          // keep the front side (< w)
      planes.push(new Plane(V.neg(e), -W.min[i]));
    }
    let cur = poly.v;
    for (const pl2 of planes) {
      // garder les points avec dot(n,p) <= w
      const out = [];
      for (let i = 0; i < cur.length; i++) {
        const a = cur[i], c = cur[(i + 1) % cur.length];
        const da = V.dot(pl2.n, a) - pl2.w, dc = V.dot(pl2.n, c) - pl2.w;
        if (da <= 0) out.push(a);
        if ((da < 0 && dc > 0) || (da > 0 && dc < 0)) out.push(V.lerp(a, c, da / (da - dc)));
      }
      cur = out;
      if (cur.length < 3) return null;
    }
    return { verts: cur, normal: n, center: Pc };
  };

  FK.polysToPositions = function (polys) {
    const out = [];
    for (const p of polys) {
      const v = p.v;
      for (let i = 1; i < v.length - 1; i++) {
        const a = v[0], b = v[i], c = v[i + 1];
        const cr = V.cross(V.sub(b, a), V.sub(c, a));
        if (V.len(cr) < 1e-12) continue;
        out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
    }
    return new Float32Array(out);
  };
  FK.polysVolume = function (polys) {
    let vol = 0;
    for (const p of polys) for (let i = 1; i < p.v.length - 1; i++) vol += V.dot(p.v[0], V.cross(p.v[i], p.v[i + 1])) / 6;
    return vol;
  };
  FK.polysArea = function (polys) {
    let a = 0;
    for (const p of polys) for (let i = 1; i < p.v.length - 1; i++) a += 0.5 * V.len(V.cross(V.sub(p.v[i], p.v[0]), V.sub(p.v[i + 1], p.v[0])));
    return a;
  };
  FK.polysBBox = bboxOfPolys;

  /* ---------------- Region expressions ---------------- */
  FK.tokenizeExpr = function (s) {
    const toks = [];
    const re = /\s*([+\-|()]|[A-Za-z_][A-Za-z0-9_]*|\S)/g;
    let m;
    while ((m = re.exec(s)) && m[0].length) toks.push(m[1]);
    return toks;
  };

  /** AST: {zones:[[{sign, name|sub}]]}; throws an Error on invalid syntax. */
  FK.parseExpr = function (s) {
    const toks = FK.tokenizeExpr(s);
    let i = 0;
    const isName = (t) => t && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t);
    function union() {
      const zones = [zone()];
      while (toks[i] === '|') { i++; zones.push(zone()); }
      return { zones };
    }
    function zone() {
      const terms = [];
      for (;;) {
        let sign = 1, signed = false;
        if (toks[i] === '+' || toks[i] === '-') { sign = toks[i] === '-' ? -1 : 1; i++; signed = true; }
        if (toks[i] === '(') {
          i++;
          const sub = union();
          if (toks[i] !== ')') throw new Error('Missing closing parenthesis');
          i++;
          terms.push({ sign, sub });
        } else if (isName(toks[i])) {
          terms.push({ sign, name: toks[i] }); i++;
        } else {
          if (signed) throw new Error('Missing operand after ' + (sign < 0 ? '−' : '+'));
          break;
        }
      }
      return terms;
    }
    const ast = union();
    if (i < toks.length) throw new Error('Jeton inattendu : ' + toks[i]);
    for (const z of ast.zones) if (!z.length) throw new Error('Zone vide dans l\'expression');
    return ast;
  };

  FK.exprNames = function (ast, set) {
    set = set || new Set();
    for (const z of ast.zones) for (const t of z) { if (t.name) set.add(t.name); else FK.exprNames(t.sub, set); }
    return set;
  };

  FK.formatExpr = function (ast, nested) {
    return ast.zones.map(z => z.map(t => (t.sign < 0 ? '-' : '+') + (t.name ? t.name : '(' + FK.formatExpr(t.sub, true) + ')')).join(' ')).join(' | ');
  };

  /** Adds a signed term (e.g. "+pla1") to every zone of the expression. */
  FK.addTermToExpr = function (expr, signedName) {
    const ast = FK.parseExpr(expr.trim() ? expr : '+x');
    const nm = signedName.replace(/^[+-]/, ''), sg = signedName[0] === '-' ? -1 : 1;
    if (!expr.trim()) return (sg < 0 ? '-' : '+') + nm;
    for (const z of ast.zones) {
      const k = z.findIndex(t => t.name === nm);
      if (k >= 0) z[k].sign = sg; else z.push({ sign: sg, name: nm });
    }
    return FK.formatExpr(ast);
  };
  FK.removeTermFromExpr = function (expr, name) {
    const ast = FK.parseExpr(expr);
    for (const z of ast.zones) for (let k = z.length - 1; k >= 0; k--) if (z[k].name === name) z.splice(k, 1);
    ast.zones = ast.zones.filter(z => z.length);
    return ast.zones.length ? FK.formatExpr(ast) : '';
  };
  FK.renameInExpr = function (expr, oldN, newN) {
    try {
      const ast = FK.parseExpr(expr);
      (function walk(a) { for (const z of a.zones) for (const t of z) { if (t.name === oldN) t.name = newN; else if (t.sub) walk(t.sub); } })(ast);
      return FK.formatExpr(ast);
    } catch (e) { return expr; }
  };

  /** Evaluates the expression with the context {body(name)->polys|null, world()->polys}. */
  FK.evalExpr = function (ast, ctx) {
    let result = null;
    for (const zone of ast.zones) {
      let z = null; const negs = [];
      for (const t of zone) {
        let s;
        if (t.name) { s = ctx.body(t.name); if (s === null || s === undefined) throw new Error('Corps inconnu ou non calculable : ' + t.name); }
        else s = FK.evalExpr(t.sub, ctx);
        if (t.sign > 0) z = (z === null) ? s : CSG.intersect(z, s);
        else negs.push(s);
        if (z !== null && !z.length) break;
      }
      if (z === null) z = ctx.world();
      for (const n of negs) { if (!z.length) break; z = CSG.subtract(z, n); }
      result = (result === null) ? z : CSG.union(result, z);
    }
    return result || [];
  };

  /**
   * Boolean combination of two region expressions, written ONLY with the bodies they already use
   * (FLUKA cannot reference a region inside another region, so the formulas themselves are combined).
   *   op 'sub'   : A − B   =  A ∩ not B
   *   op 'int'   : A ∩ B
   *   op 'union' : A ∪ B
   * mode 'compact'  : negated / grouped parentheses   +A -( B )
   * mode 'expanded' : De Morgan, no negated parenthesis for the subtraction (one factor per zone of B:  not(t1 t2) = (not t1 | not t2)),
   *                   and intersections of unions are distributed into a union of zones.
   * Returns the expression string. Throws on an empty operand or if the expansion becomes too large.
   */
  FK.combineExpr = function (a, b, op, mode) {
    const pa = typeof a === 'string' ? FK.parseExpr(a) : a, pb = typeof b === 'string' ? FK.parseExpr(b) : b;
    if (!pa.zones.length || !pa.zones[0].length) throw new Error('The first expression is empty');
    if (!pb.zones.length || !pb.zones[0].length) throw new Error('The second expression is empty');
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const flip = (t) => { const c = clone(t); c.sign = -c.sign; return c; };
    const termsOf = (ast) => ast.zones.length === 1 ? clone(ast.zones[0]) : [{ sign: 1, sub: clone(ast) }];
    const expanded = mode === 'expanded';
    if (op === 'union') return FK.formatExpr({ zones: clone(pa.zones).concat(clone(pb.zones)) });
    if (op === 'int') {
      if (expanded && (pa.zones.length > 1 || pb.zones.length > 1)) {
        if (pa.zones.length * pb.zones.length > 200) throw new Error('Too many zones after distribution (' + pa.zones.length * pb.zones.length + '): use the compact form');
        const zones = [];
        for (const za of pa.zones) for (const zb of pb.zones) zones.push(clone(za).concat(clone(zb)));
        return FK.formatExpr({ zones });
      }
      return FK.formatExpr({ zones: [termsOf(pa).concat(termsOf(pb))] });
    }
    // subtraction
    const terms = termsOf(pa);
    if (expanded) {
      for (const zone of pb.zones) {
        if (zone.length === 1) terms.push(flip(zone[0]));
        else terms.push({ sign: 1, sub: { zones: zone.map(t => [flip(t)]) } });
      }
    } else if (pb.zones.length === 1 && pb.zones[0].length === 1) terms.push(flip(pb.zones[0][0]));
    else terms.push({ sign: -1, sub: clone(pb) });
    return FK.formatExpr({ zones: [terms] });
  };
  /** Exact complement of a region inside a bounding body: "void = box − region". */
  FK.complementExpr = function (expr, boxName, mode) {
    return FK.combineExpr('+' + boxName, expr, 'sub', mode);
  };

  /* ---------------- Automatic feature detection on a triangle mesh (experimental) ----------------
   * FK.detectFeatures(pos, opts) → { features:[{id, kind, type, p, cs, label, info, tris}], stats }
   *   plane    : region growing over adjacent triangles (normal angle + distance to the seed plane) → PLA
   *   cylinder : smooth clusters of the remaining triangles; axis = least-variance direction of the normals, circle fit in the
   *              perpendicular plane, inlier triangles within tolerance, angular coverage and height checks → RCC
   *   sphere   : algebraic least squares on the same clusters, radial-normal check → SPH
   *   box      : connected component whose triangles are aligned with 3 orthogonal directions and fill their oriented bounding box → RPP
   * Lengths are in the mesh units (cm in the app). */
  FK.DETECT_DEFAULTS = {
    planes: true, cylinders: true, spheres: true, boxes: true,
    minArea: 1,          // minimum area of a plane patch (cm²)
    angTol: 2,           // max angle between a triangle normal and the seed plane normal (°)
    distTol: 0.02,       // max distance of a vertex to the seed plane (cm)
    smoothAngle: 25,     // curved surfaces: max angle between neighbouring triangle normals (°)
    fitTol: 0.04,        // max radial deviation of a vertex from the fitted cylinder / sphere (cm)
    curvMinArea: 1,      // minimum area of a cylinder / sphere patch (cm²)
    minTris: 8,          // minimum number of triangles of a curved patch
    minRadius: 0.05, maxRadius: 0, // cm (0 = no upper limit)
    minHeight: 0.1,      // cylinder minimum length (cm)
    minArc: 150,         // cylinder minimum angular coverage (°)
    boxFill: 0.9,        // box: mesh volume / oriented box volume
    boxAligned: 0.85,    // box: fraction of the surface aligned with the 3 box axes
    snapDeg: 1,          // snap axes / normals to the global axes when closer than this (°)
    maxPerType: 60
  };
  FK.detectDefaults = function (pos) {
    const st = FK.meshStats(pos), diag = st.bbox ? boxDiag(st.bbox) : 10, d = Object.assign({}, FK.DETECT_DEFAULTS);
    const r = (x) => +x.toPrecision(2);
    d.minArea = r(Math.max(st.area * 0.005, 1e-4)); d.curvMinArea = d.minArea;
    d.distTol = r(Math.max(diag * 0.001, 1e-5)); d.fitTol = r(Math.max(diag * 0.002, 1e-5));
    d.minRadius = r(diag * 0.002); d.minHeight = r(diag * 0.005);
    return d;
  };
  FK.detectFeatures = function (pos, opts) {
    const o = Object.assign({}, FK.DETECT_DEFAULTS, opts || {});
    const topo = FK.buildTopology(pos), n = topo.nTri, nrm = topo.nrm, areas = topo.areas, vid = topo.vid, vp = topo.vpos, nbr = topo.nbr;
    const N = (t) => [nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]];
    const P = (v) => [vp[v * 3], vp[v * 3 + 1], vp[v * 3 + 2]];
    const cosA = Math.cos(o.angTol * Math.PI / 180), cosS = Math.cos(o.smoothAngle * Math.PI / 180);
    const feats = [], counts = { plane: 0, cylinder: 0, sphere: 0, box: 0 }, patches = [];
    const owner = new Int32Array(n).fill(-1);     // index of the plane / cylinder / sphere feature that took the triangle
    const add = (f) => { f.id = feats.length + 1; feats.push(f); return f; };
    const roundv = (a) => a.map(x => +(+x).toFixed(6) || 0);
    const axisSnap = (d) => {
      const c = Math.cos(o.snapDeg * Math.PI / 180);
      for (let k = 0; k < 3; k++) if (Math.abs(d[k]) >= c) { const s = d[k] < 0 ? -1 : 1, r = [0, 0, 0]; r[k] = s; return r; }
      return d;
    };
    // neighbours of a triangle
    const nb = (t) => { const r = []; for (let k = 0; k < 3; k++) { const u = nbr[t * 3 + k]; if (u >= 0) r.push(u); } return r; };
    // connected components
    const comp = new Int32Array(n).fill(-1); let nComp = 0;
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const st = [s]; comp[s] = nComp;
      while (st.length) { const t = st.pop(); for (const u of nb(t)) if (comp[u] < 0) { comp[u] = nComp; st.push(u); } }
      nComp++;
    }
    const triVerts = (t) => [P(vid[t * 3]), P(vid[t * 3 + 1]), P(vid[t * 3 + 2])];
    const triCenter = (t) => { const v = triVerts(t); return V.mul(V.add(V.add(v[0], v[1]), v[2]), 1 / 3); };

    /* ---- planes ---- */
    const order = Array.from({ length: n }, (_, i) => i).filter(t => areas[t] > 0).sort((a, b) => areas[b] - areas[a]);
    if (o.planes) {
      const stamp = new Int32Array(n).fill(-1), seeded = new Uint8Array(n);
      let sid = 0;
      for (const seed of order) {
        if (owner[seed] !== -1 || seeded[seed]) continue;
        const n0 = N(seed), sv = triVerts(seed), d0 = V.dot(n0, sv[0]);
        const patch = [seed]; stamp[seed] = sid; const st = [seed]; let area = areas[seed];
        while (st.length) {
          const t = st.pop();
          for (const u of nb(t)) {
            if (stamp[u] === sid || owner[u] !== -1 || areas[u] <= 0) continue;
            if (V.dot(N(u), n0) < cosA) continue;
            const uv = triVerts(u);
            if (Math.abs(V.dot(n0, uv[0]) - d0) > o.distTol || Math.abs(V.dot(n0, uv[1]) - d0) > o.distTol || Math.abs(V.dot(n0, uv[2]) - d0) > o.distTol) continue;
            stamp[u] = sid; patch.push(u); st.push(u); area += areas[u];
          }
        }
        sid++;
        if (area < o.minArea) { for (const t of patch) seeded[t] = 1; continue; }
        for (const t of patch) { owner[t] = -2; seeded[t] = 1; }          // provisional: the patch is decided below
        patches.push({ tris: patch, area });
      }
    }
    // A planar patch that is smoothly connected to other patches (facets of a tessellated cylinder / sphere) is NOT a real plane:
    // its triangles go back to the curved-surface pool. Real planes are bounded by sharper edges.
    const smoothId = new Int32Array(n).fill(-1); let nSm = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (smoothId[s0] >= 0 || areas[s0] <= 0) continue;
      const st = [s0]; smoothId[s0] = nSm;
      while (st.length) { const t = st.pop(); for (const u of nb(t)) if (smoothId[u] < 0 && areas[u] > 0 && V.dot(N(t), N(u)) >= cosS) { smoothId[u] = nSm; st.push(u); } }
      nSm++;
    }
    const smArea = new Float64Array(nSm); for (let t = 0; t < n; t++) if (smoothId[t] >= 0) smArea[smoothId[t]] += areas[t];
    const pending = [];
    const makePlane = (patch, area) => {
      {
        // refine: area weighted normal and centroid
        let nn = [0, 0, 0], c = [0, 0, 0];
        for (const t of patch) { nn = V.add(nn, V.mul(N(t), areas[t])); c = V.add(c, V.mul(triCenter(t), areas[t])); }
        nn = axisSnap(V.norm(nn)); c = V.mul(c, 1 / area);
        // in-plane rectangle (oriented bounding rectangle along the principal in-plane directions, from the vertices)
        const ref = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = V.norm(V.cross(nn, ref)), w = V.cross(nn, u);
        let mnU = Infinity, mxU = -Infinity, mnW = Infinity, mxW = -Infinity;
        for (const t of patch) for (const q of triVerts(t)) { const a = V.dot(V.sub(q, c), u), b = V.dot(V.sub(q, c), w); if (a < mnU) mnU = a; if (a > mxU) mxU = a; if (b < mnW) mnW = b; if (b > mxW) mxW = b; }
        const rect = [[mnU, mnW], [mxU, mnW], [mxU, mxW], [mnU, mxW]].map(q => V.add(c, V.add(V.mul(u, q[0]), V.mul(w, q[1]))));
        const fi = feats.length;
        for (const t of patch) owner[t] = fi;
        counts.plane++;
        add({ kind: 'plane', type: 'PLA', p: roundv(nn.concat(c)), cs: null, tris: patch, rect, info: { area, tris: patch.length, normal: nn, point: c },
          label: `plane · ${area.toFixed(2)} cm²` });
      }
    };
    const accepted = [];
    for (const pt of patches) {
      const sm = smoothId[pt.tris[0]];
      if (pt.area >= 0.9 * smArea[sm]) { accepted.push(pt); for (const t of pt.tris) owner[t] = -3; }
      else { pending.push(pt); for (const t of pt.tris) owner[t] = -1; }
    }

    /* ---- curved patches: clusters of smoothly connected triangles that are not in a plane ---- */
    const curved = (o.cylinders || o.spheres);
    const eig = (M) => { const r = jacobi3(M); const idx = [0, 1, 2].sort((i, j) => r.vals[i] - r.vals[j]); return { vals: idx.map(i => r.vals[i]), vecs: idx.map(i => r.vecs[i]) }; };
    const uniqVerts = (tris) => { const s = new Set(); for (const t of tris) { s.add(vid[t * 3]); s.add(vid[t * 3 + 1]); s.add(vid[t * 3 + 2]); } return Array.from(s); };
    const clusters = (cand) => {
      const inC = new Set(cand), seen = new Set(), res = [];
      for (const s of cand) {
        if (seen.has(s)) continue;
        const cl = [s]; seen.add(s); const st = [s];
        while (st.length) { const t = st.pop(); for (const u of nb(t)) if (inC.has(u) && !seen.has(u) && V.dot(N(t), N(u)) >= cosS) { seen.add(u); cl.push(u); st.push(u); } }
        res.push(cl);
      }
      return res;
    };
    const kasa2 = (pts) => { // x²+y² = 2Ax + 2By + C
      let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n2 = pts.length, bx = 0, by = 0, b1 = 0;
      for (const [x, y] of pts) { const z = x * x + y * y; sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; bx += x * z; by += y * z; b1 += z; }
      const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n2]], b = [bx / 2, by / 2, b1];
      // unknowns (A, B, C') with the first two rows halved: solve [sxx sxy sx; sxy syy sy; sx sy n]·[2A 2B C]ᵀ = [bx by b1]ᵀ
      const M3 = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n2]], r3 = [bx, by, b1];
      const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(M3); if (Math.abs(D) < 1e-18) return null;
      const col = (k) => M3.map((row, i) => row.map((v, j) => j === k ? r3[i] : v));
      const sol = [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
      const cx = sol[0] / 2, cy = sol[1] / 2, r2 = sol[2] + cx * cx + cy * cy;
      return r2 > 0 ? { c: [cx, cy], r: Math.sqrt(r2) } : null;
    };
    const fitCylinder = (tris) => {
      let M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], tot = 0;
      for (const t of tris) { const a = N(t), w = areas[t]; tot += w; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += w * a[i] * a[j]; }
      const e = eig(M), tr = e.vals[0] + e.vals[1] + e.vals[2];
      if (!(tr > 0) || e.vals[0] / tr > 0.02 || e.vals[1] / tr < 0.08) return null;     // normals must be ⟂ to one axis and spread around it
      const ax = e.vecs[0]; const e1 = V.norm(V.cross(ax, Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), e2 = V.cross(ax, e1);
      let inl = tris, fit = null;
      for (let pass = 0; pass < 3; pass++) {
        const pts = uniqVerts(inl).map(v => { const p = P(v); return [V.dot(p, e1), V.dot(p, e2)]; });
        fit = kasa2(pts); if (!fit) return null;
        const ok = (t) => triVerts(t).every(q => Math.abs(Math.hypot(V.dot(q, e1) - fit.c[0], V.dot(q, e2) - fit.c[1]) - fit.r) <= o.fitTol);
        const next = tris.filter(ok);
        if (next.length < o.minTris) return null;
        if (next.length === inl.length && pass > 0) break;
        inl = next;
      }
      const area = inl.reduce((s, t) => s + areas[t], 0);
      if (area < o.curvMinArea || area < 0.5 * tot) return null;
      if (fit.r < o.minRadius || (o.maxRadius > 0 && fit.r > o.maxRadius)) return null;
      // coverage: 360° minus the largest angular gap between triangle centres
      const ang = inl.map(t => { const c = triCenter(t); return Math.atan2(V.dot(c, e2) - fit.c[1], V.dot(c, e1) - fit.c[0]); }).sort((a, b) => a - b);
      let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1]; for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
      const cover = 360 - gap * 180 / Math.PI;
      if (cover < o.minArc) return null;
      let inner = 0;
      const cen = V.add(V.mul(e1, fit.c[0]), V.mul(e2, fit.c[1]));      // a point of the axis (perpendicular foot from the origin)
      for (const t of inl) {
        const c = triCenter(t), rad = V.norm(V.sub(V.sub(c, V.mul(ax, V.dot(c, ax))), cen));
        inner += V.dot(N(t), rad) * areas[t];
      }
      let dir = ax; const big = [0, 1, 2].sort((i, j) => Math.abs(dir[j]) - Math.abs(dir[i]))[0]; if (dir[big] < 0) dir = V.mul(dir, -1);
      dir = axisSnap(dir);
      let t0 = Infinity, t1 = -Infinity;
      for (const t of inl) for (const q of triVerts(t)) { const h0 = V.dot(q, dir); if (h0 < t0) t0 = h0; if (h0 > t1) t1 = h0; }
      const h = t1 - t0; if (h < o.minHeight) return null;
      const baseFix = V.add(V.sub(cen, V.mul(dir, V.dot(cen, dir))), V.mul(dir, t0));
      return { tris: inl, r: fit.r, h, base: baseFix, dir, cover, inner: inner < 0, area };
    };
    const fitSphere = (tris) => {
      const vs = uniqVerts(tris).map(P); if (vs.length < 6) return null;
      // x²+y²+z² = 2c·p + k  → linear LS in (cx, cy, cz, k)
      const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
      for (const p of vs) { const row = [p[0], p[1], p[2], 1], z = V.dot(p, p) ; for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; b[i] += row[i] * z; } }
      const m = A.map((r, i) => r.concat([b[i]]));
      for (let i = 0; i < 4; i++) {
        let piv = i; for (let r = i + 1; r < 4; r++) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
        if (Math.abs(m[piv][i]) < 1e-12) return null; [m[i], m[piv]] = [m[piv], m[i]];
        for (let r = 0; r < 4; r++) if (r !== i) { const f = m[r][i] / m[i][i]; for (let c = i; c < 5; c++) m[r][c] -= f * m[i][c]; }
      }
      const s = [0, 1, 2, 3].map(i => m[i][4] / m[i][i]), c = [s[0] / 2, s[1] / 2, s[2] / 2], r2 = s[3] + V.dot(c, c);
      if (!(r2 > 0)) return null; const r = Math.sqrt(r2);
      if (r < o.minRadius || (o.maxRadius > 0 && r > o.maxRadius)) return null;
      const inl = tris.filter(t => triVerts(t).every(q => Math.abs(V.len(V.sub(q, c)) - r) <= o.fitTol));
      if (inl.length < o.minTris) return null;
      const area = inl.reduce((s2, t) => s2 + areas[t], 0), tot = tris.reduce((s2, t) => s2 + areas[t], 0);
      if (area < o.curvMinArea || area < 0.6 * tot) return null;
      let rad = 0; for (const t of inl) rad += Math.abs(V.dot(N(t), V.norm(V.sub(triCenter(t), c)))) * areas[t];
      if (rad / area < 0.95) return null;
      let outward = 0; for (const t of inl) outward += V.dot(N(t), V.norm(V.sub(triCenter(t), c))) * areas[t];
      return { tris: inl, c, r, area, inner: outward < 0 };
    };
    if (curved) {
      const cand = []; for (let t = 0; t < n; t++) if (owner[t] === -1 && areas[t] > 0) cand.push(t);
      const queue = clusters(cand).filter(c => c.length >= o.minTris);
      let guard = 0;
      while (queue.length && guard++ < 400) {
        const cl = queue.shift();
        let res = null, kind = '';
        if (o.cylinders && counts.cylinder < o.maxPerType && (res = fitCylinder(cl))) kind = 'cylinder';
        else if (o.spheres && counts.sphere < o.maxPerType && (res = fitSphere(cl))) kind = 'sphere';
        if (!res) continue;
        const fi = feats.length; for (const t of res.tris) owner[t] = fi;
        counts[kind]++;
        if (kind === 'cylinder') {
          const len = res.h;
          add({ kind, type: 'RCC', p: roundv(res.base.concat(V.mul(res.dir, len), [res.r])), cs: null, tris: res.tris,
            info: { radius: res.r, height: len, coverage: res.cover, inner: res.inner, area: res.area, tris: res.tris.length, base: res.base, axis: res.dir },
            label: `cylinder ${res.inner ? '(hole) ' : ''}R ${res.r.toFixed(3)} × ${len.toFixed(3)} cm · ${res.cover.toFixed(0)}°` });
        } else {
          add({ kind, type: 'SPH', p: roundv(res.c.concat([res.r])), cs: null, tris: res.tris,
            info: { radius: res.r, inner: res.inner, area: res.area, tris: res.tris.length, centre: res.c },
            label: `sphere ${res.inner ? '(cavity) ' : ''}R ${res.r.toFixed(3)} cm` });
        }
        const left = cl.filter(t => owner[t] === -1);
        if (left.length >= o.minTris) for (const c2 of clusters(left)) if (c2.length >= o.minTris && c2.length < cl.length) queue.push(c2);
      }
    }

    // planar patches that were only provisional facets but were not taken by a cylinder / sphere become planes again
    for (const pt of pending) {
      const free = pt.tris.filter(t => owner[t] === -1);
      if (free.length >= 0.95 * pt.tris.length) { accepted.push(pt); for (const t of pt.tris) owner[t] = -3; }
    }
    // Patches lying in the same infinite plane (same normal, same offset) are one PLA: merge them (also repairs meshes cut by T-junctions)
    {
      const groups = [];
      for (const pt of accepted.sort((a, b) => b.area - a.area)) {
        let nn = [0, 0, 0], c = [0, 0, 0];
        for (const t of pt.tris) { nn = V.add(nn, V.mul(N(t), areas[t])); c = V.add(c, V.mul(triCenter(t), areas[t])); }
        nn = V.norm(nn); c = V.mul(c, 1 / pt.area); const d = V.dot(nn, c);
        const g = groups.find(g2 => V.dot(g2.n, nn) >= cosA && Math.abs(V.dot(g2.n, c) - g2.d) <= o.distTol);
        if (g) { g.tris = g.tris.concat(pt.tris); g.area += pt.area; } else groups.push({ n: nn, d, tris: pt.tris.slice(), area: pt.area });
      }
      for (const g of groups) { if (counts.plane >= o.maxPerType) break; makePlane(g.tris, g.area); }
    }

    /* ---- boxes: one per connected component ---- */
    if (o.boxes) {
      const byComp = new Map();
      for (let t = 0; t < n; t++) { if (areas[t] <= 0) continue; let l = byComp.get(comp[t]); if (!l) byComp.set(comp[t], l = []); l.push(t); }
      for (const [, tris] of byComp) {
        if (counts.box >= o.maxPerType || tris.length < 12) continue;
        // dominant directions: area-weighted histogram over planes already found, else over triangle normals
        const dirs = []; for (const t of tris) { const a = N(t); let f = dirs.find(d => Math.abs(V.dot(d.n, a)) >= cosA); if (f) f.a += areas[t]; else dirs.push({ n: a, a: areas[t] }); }
        dirs.sort((x, y) => y.a - x.a);
        const n1 = dirs[0].n, d2 = dirs.find(d => Math.abs(V.dot(d.n, n1)) < Math.sin(o.angTol * 2 * Math.PI / 180) + 1e-9);
        if (!d2) continue;
        const u1 = n1, u3 = V.norm(V.cross(n1, d2.n)), u2 = V.cross(u3, u1);
        const sub = tris, tot = sub.reduce((s, t) => s + areas[t], 0), cs2 = Math.cos(o.angTol * Math.PI / 180);
        let al = 0; for (const t of sub) { const a = N(t); if ([u1, u2, u3].some(u => Math.abs(V.dot(a, u)) >= cs2)) al += areas[t]; }
        if (al / tot < o.boxAligned) continue;
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (const v of uniqVerts(sub)) { const p = P(v); [u1, u2, u3].forEach((u, k) => { const d = V.dot(p, u); if (d < mn[k]) mn[k] = d; if (d > mx[k]) mx[k] = d; }); }
        const ext = [0, 1, 2].map(k => mx[k] - mn[k]); if (ext.some(x => x < 1e-6)) continue;
        let vol = 0; for (const t of sub) { const v = triVerts(t); vol += V.dot(v[0], V.cross(v[1], v[2])) / 6; }
        vol = Math.abs(vol); const bv = ext[0] * ext[1] * ext[2];
        if (vol / bv < o.boxFill || vol / bv > 1.02) continue;
        // aligned with the global axes?  (then a plain RPP in the world frame, otherwise an RPP in a new coordinate system)
        const cg = Math.cos(o.snapDeg * Math.PI / 180);
        const aligned = [u1, u2, u3].every(u => u.some(x => Math.abs(x) >= cg));
        const fi = feats.length;
        if (aligned) {
          const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
          for (const v of uniqVerts(sub)) { const p = P(v); for (let k = 0; k < 3; k++) { if (p[k] < bb.min[k]) bb.min[k] = p[k]; if (p[k] > bb.max[k]) bb.max[k] = p[k]; } }
          counts.box++;
          add({ kind: 'box', type: 'RPP', p: roundv([bb.min[0], bb.max[0], bb.min[1], bb.max[1], bb.min[2], bb.max[2]]), cs: null, tris: sub,
            info: { size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]], fill: vol / bv, aligned: al / tot, tris: sub.length },
            label: `box ${(bb.max[0] - bb.min[0]).toFixed(2)} × ${(bb.max[1] - bb.min[1]).toFixed(2)} × ${(bb.max[2] - bb.min[2]).toFixed(2)} cm` });
        } else {
          // frame with columns u1 u2 u3 (right-handed), origin at 0: local = Rᵀ·p
          const R = [u1[0], u2[0], u3[0], 0, u1[1], u2[1], u3[1], 0, u1[2], u2[2], u3[2], 0];
          counts.box++;
          add({ kind: 'box', type: 'RPP', p: roundv([mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]]), cs: R, tris: sub,
            info: { size: ext, fill: vol / bv, aligned: al / tot, tris: sub.length, rotated: true },
            label: `box (rotated) ${ext[0].toFixed(2)} × ${ext[1].toFixed(2)} × ${ext[2].toFixed(2)} cm` });
        }
      }
    }
    // order: boxes, cylinders, spheres, planes; bigger first
    const rank = { box: 0, cylinder: 1, sphere: 2, plane: 3 };
    feats.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.info.area || 0) - (a.info.area || 0));
    feats.forEach((f, i) => { f.id = i + 1; });
    return { features: feats, stats: { triangles: n, components: nComp, counts } };
  };

  /* ---------------- Guided detection: fit a primitive to triangles clicked by the user ----------------
   * FK.fitFromSeeds(pos, seeds, kind, opts, topo?) → { feature, confidence, report } | { error }
   * kind: 'auto' | 'plane' | 'cylinder' | 'sphere'. The seeds are expanded into the smoothly connected surface around them; the
   * primitive is fitted robustly (inlier triangles within the tolerance) and the confidence grows with the number of seeds that agree,
   * the size of the patch, the angular coverage and the quality of the fit. Axes are free (not restricted to the global axes). */
  FK.fitFromSeeds = function (pos, seeds, kind, opts, topo) {
    const o = Object.assign({}, FK.DETECT_DEFAULTS, opts || {});
    topo = topo || FK.buildTopology(pos);
    const n = topo.nTri, nrm = topo.nrm, areas = topo.areas, vid = topo.vid, vp = topo.vpos, nbr = topo.nbr;
    const N = (t) => [nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]];
    const P = (v) => [vp[v * 3], vp[v * 3 + 1], vp[v * 3 + 2]];
    const triVerts = (t) => [P(vid[t * 3]), P(vid[t * 3 + 1]), P(vid[t * 3 + 2])];
    const triCenter = (t) => { const v = triVerts(t); return V.mul(V.add(V.add(v[0], v[1]), v[2]), 1 / 3); };
    const nb = (t) => { const r = []; for (let k = 0; k < 3; k++) { const u = nbr[t * 3 + k]; if (u >= 0) r.push(u); } return r; };
    const roundv = (a) => a.map(x => +(+x).toFixed(6) || 0);
    const uniq = (tris) => { const s = new Set(); for (const t of tris) { s.add(vid[t * 3]); s.add(vid[t * 3 + 1]); s.add(vid[t * 3 + 2]); } return Array.from(s); };
    seeds = Array.from(new Set(seeds)).filter(t => t >= 0 && t < n && areas[t] > 0);
    if (!seeds.length) return { error: 'Click at least one triangle of the surface.' };
    const cosS = Math.cos(o.smoothAngle * Math.PI / 180), cosA = Math.cos(o.angTol * Math.PI / 180);
    const axisSnap = (d) => { const c = Math.cos(o.snapDeg * Math.PI / 180); for (let k = 0; k < 3; k++) if (Math.abs(d[k]) >= c) { const r = [0, 0, 0]; r[k] = d[k] < 0 ? -1 : 1; return r; } return d; };
    const eigSym = (M) => { const r = jacobi3(M); const idx = [0, 1, 2].sort((i, j) => r.vals[i] - r.vals[j]); return { vals: idx.map(i => r.vals[i]), vecs: idx.map(i => r.vecs[i]) }; };
    const normalCov = (tris) => { const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const t of tris) { const a = N(t), w = areas[t]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += w * a[i] * a[j]; } return M; };
    // smooth region around the seeds (bounded) and the 2-ring neighbourhood used as the initial sample
    const R = new Set(seeds), q = seeds.slice();
    while (q.length && R.size < 60000) { const t = q.pop(); for (const u of nb(t)) if (!R.has(u) && areas[u] > 0 && V.dot(N(t), N(u)) >= cosS) { R.add(u); q.push(u); } }
    const init = new Set(seeds); let front = seeds.slice();
    for (let ring = 0; ring < 2; ring++) { const nx = []; for (const t of front) for (const u of nb(t)) if (R.has(u) && !init.has(u)) { init.add(u); nx.push(u); } front = nx; }
    const Rarr = Array.from(R), I0 = Array.from(init);
    const conf = (inl, seedsIn, rms, cover, tol) => {
      const c1 = seedsIn / seeds.length, c2 = Math.min(1, inl.length / 40), c3 = 1 - Math.min(1, rms / tol), c4 = Math.min(1, cover / 180);
      return Math.round(100 * c1 * (0.35 + 0.25 * c2 + 0.2 * c3 + 0.2 * c4));
    };
    const finish = (feature, inl, rms, cover, tol, extra) => {
      const inSet = new Set(inl), seedsIn = seeds.filter(t => inSet.has(t)).length;
      feature.confidence = conf(inl, seedsIn, rms, cover, tol);
      feature.report = Object.assign({ seeds: seeds.length, seedsFitted: seedsIn, patchTris: inl.length, rms, coverage: cover, tol }, extra || {});
      feature.guided = true;
      return { feature, confidence: feature.confidence, report: feature.report };
    };

    const doPlane = () => {
      let nn = [0, 0, 0], c = [0, 0, 0], a = 0;
      for (const t of seeds) { nn = V.add(nn, V.mul(N(t), areas[t])); c = V.add(c, V.mul(triCenter(t), areas[t])); a += areas[t]; }
      nn = V.norm(nn); c = V.mul(c, 1 / a); const d0 = V.dot(nn, c);
      const patch = new Set(seeds), st = seeds.slice();
      while (st.length) {
        const t = st.pop();
        for (const u of nb(t)) {
          if (patch.has(u) || areas[u] <= 0 || V.dot(N(u), nn) < cosA) continue;
          if (triVerts(u).every(p => Math.abs(V.dot(nn, p) - d0) <= o.distTol)) { patch.add(u); st.push(u); }
        }
      }
      const tris = Array.from(patch); let area = 0, cc = [0, 0, 0], nw = [0, 0, 0];
      for (const t of tris) { area += areas[t]; cc = V.add(cc, V.mul(triCenter(t), areas[t])); nw = V.add(nw, V.mul(N(t), areas[t])); }
      nw = axisSnap(V.norm(nw)); cc = V.mul(cc, 1 / area);
      let rmsD = 0; for (const t of tris) for (const p of triVerts(t)) rmsD += Math.pow(V.dot(nw, V.sub(p, cc)), 2); rmsD = Math.sqrt(rmsD / (tris.length * 3));
      const ref = Math.abs(nw[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = V.norm(V.cross(nw, ref)), w = V.cross(nw, u);
      let mnU = Infinity, mxU = -Infinity, mnW = Infinity, mxW = -Infinity;
      for (const t of tris) for (const p of triVerts(t)) { const x = V.dot(V.sub(p, cc), u), y = V.dot(V.sub(p, cc), w); mnU = Math.min(mnU, x); mxU = Math.max(mxU, x); mnW = Math.min(mnW, y); mxW = Math.max(mxW, y); }
      const rect = [[mnU, mnW], [mxU, mnW], [mxU, mxW], [mnU, mxW]].map(p => V.add(cc, V.add(V.mul(u, p[0]), V.mul(w, p[1]))));
      // seeds must be flat together: otherwise the plane hypothesis is poor
      const flat = seeds.filter(t => V.dot(N(t), nw) >= cosA).length;
      const f = { kind: 'plane', type: 'PLA', p: roundv(nw.concat(cc)), cs: null, tris, rect, info: { area, tris: tris.length, normal: nw, point: cc }, label: `plane · ${area.toFixed(2)} cm²` };
      const res = finish(f, tris, rmsD, 180, o.distTol);
      res.confidence = f.confidence = Math.round(res.confidence * flat / seeds.length);
      return res;
    };

    const doCylinder = () => {
      let inl = I0, ax = null, e1, e2, fit = null;
      for (let pass = 0; pass < 8; pass++) {
        const e = eigSym(normalCov(inl)), tr = e.vals[0] + e.vals[1] + e.vals[2];
        if (!(tr > 0)) return { error: 'degenerate triangles' };
        if (e.vals[1] / tr < 0.002) return { error: 'The selected surface is flat (no curvature): click facets that span the curved surface, or use "Plane".' };
        if (e.vals[0] / tr > 0.06) return { error: 'The selected facets do not curve around a single axis (not a cylinder).' };
        ax = e.vecs[0]; e1 = V.norm(V.cross(ax, Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])); e2 = V.cross(ax, e1);
        fit = FK._kasa2(uniq(inl).map(v => { const p = P(v); return [V.dot(p, e1), V.dot(p, e2)]; }));
        if (!fit) return { error: 'circle fit failed' };
        const tol = o.fitTol * (pass < 2 ? 3 : 1);
        const next = Rarr.filter(t => triVerts(t).every(p => Math.abs(Math.hypot(V.dot(p, e1) - fit.c[0], V.dot(p, e2) - fit.c[1]) - fit.r) <= tol));
        if (next.length < 3) return { error: 'no triangle agrees with the fitted cylinder (try a larger fit tolerance)' };
        if (pass >= 2 && next.length === inl.length && next.every((t, i) => t === inl[i])) { inl = next; break; }
        inl = next;
      }
      // rms radial deviation of the inlier vertices
      let ss = 0, cnt = 0; for (const v of uniq(inl)) { const p = P(v); ss += Math.pow(Math.hypot(V.dot(p, e1) - fit.c[0], V.dot(p, e2) - fit.c[1]) - fit.r, 2); cnt++; }
      const rms = Math.sqrt(ss / cnt);
      const ang = inl.map(t => { const c = triCenter(t); return Math.atan2(V.dot(c, e2) - fit.c[1], V.dot(c, e1) - fit.c[0]); }).sort((a, b) => a - b);
      let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1]; for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
      const cover = ang.length > 1 ? 360 - gap * 180 / Math.PI : 0;
      const cen = V.add(V.mul(e1, fit.c[0]), V.mul(e2, fit.c[1])); let inner = 0, area = 0;
      for (const t of inl) { const c = triCenter(t), rad = V.norm(V.sub(V.sub(c, V.mul(ax, V.dot(c, ax))), cen)); inner += V.dot(N(t), rad) * areas[t]; area += areas[t]; }
      let dir = ax; const big = [0, 1, 2].sort((i, j) => Math.abs(dir[j]) - Math.abs(dir[i]))[0]; if (dir[big] < 0) dir = V.mul(dir, -1);
      dir = axisSnap(dir);
      let t0 = Infinity, t1 = -Infinity; for (const t of inl) for (const p of triVerts(t)) { const h = V.dot(p, dir); if (h < t0) t0 = h; if (h > t1) t1 = h; }
      const h = t1 - t0, base = V.add(V.sub(cen, V.mul(dir, V.dot(cen, dir))), V.mul(dir, t0));
      const f = { kind: 'cylinder', type: 'RCC', p: roundv(base.concat(V.mul(dir, h), [fit.r])), cs: null, tris: inl,
        info: { radius: fit.r, height: h, coverage: cover, inner: inner < 0, area, tris: inl.length, base, axis: dir },
        label: `cylinder ${inner < 0 ? '(hole) ' : ''}R ${fit.r.toFixed(3)} × ${h.toFixed(3)} cm · ${cover.toFixed(0)}°` };
      return finish(f, inl, rms, cover, o.fitTol, { axis: dir });
    };

    const doSphere = () => {
      let inl = I0, sph = null;
      for (let pass = 0; pass < 8; pass++) {
        sph = FK._sphereLS(uniq(inl).map(P)); if (!sph) return { error: 'sphere fit failed (the surface looks flat or degenerate)' };
        const tol = o.fitTol * (pass < 2 ? 3 : 1);
        const next = Rarr.filter(t => triVerts(t).every(p => Math.abs(V.len(V.sub(p, sph.c)) - sph.r) <= tol));
        if (next.length < 3) return { error: 'no triangle agrees with the fitted sphere' };
        if (pass >= 2 && next.length === inl.length) { inl = next; break; }
        inl = next;
      }
      let ss = 0, cnt = 0, area = 0, outward = 0;
      for (const v of uniq(inl)) { ss += Math.pow(V.len(V.sub(P(v), sph.c)) - sph.r, 2); cnt++; }
      for (const t of inl) { area += areas[t]; outward += V.dot(N(t), V.norm(V.sub(triCenter(t), sph.c))) * areas[t]; }
      if (Math.abs(outward) / area < 0.9) return { error: 'the facet normals are not radial: not a sphere' };
      const f = { kind: 'sphere', type: 'SPH', p: roundv(sph.c.concat([sph.r])), cs: null, tris: inl, info: { radius: sph.r, inner: outward < 0, area, tris: inl.length, centre: sph.c },
        label: `sphere ${outward < 0 ? '(cavity) ' : ''}R ${sph.r.toFixed(3)} cm` };
      return finish(f, inl, Math.sqrt(ss / cnt), 180, o.fitTol);
    };

    let res;
    if (kind === 'plane') res = doPlane();
    else if (kind === 'cylinder') res = doCylinder();
    else if (kind === 'sphere') res = doSphere();
    else {   // auto: flat selection → plane; otherwise the best of cylinder / sphere
      const e = eigSym(normalCov(I0)), tr = e.vals[0] + e.vals[1] + e.vals[2];
      if (e.vals[1] / tr < 0.002) res = doPlane();
      else { const c = doCylinder(), s = doSphere(); res = c.error ? s : s.error ? c : (c.confidence >= s.confidence ? c : s); if (res.error && c.error) res = { error: c.error }; }
    }
    return res;
  };
  FK._kasa2 = function (pts) {
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, bx = 0, by = 0, b1 = 0; const n2 = pts.length;
    for (const [x, y] of pts) { const z = x * x + y * y; sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; bx += x * z; by += y * z; b1 += z; }
    const M3 = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n2]], r3 = [bx, by, b1];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M3); if (Math.abs(D) < 1e-18) return null;
    const col = (k) => M3.map((row, i) => row.map((v, j) => j === k ? r3[i] : v));
    const sol = [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
    const cx = sol[0] / 2, cy = sol[1] / 2, r2 = sol[2] + cx * cx + cy * cy;
    return r2 > 0 ? { c: [cx, cy], r: Math.sqrt(r2) } : null;
  };
  FK._sphereLS = function (vs) {
    if (vs.length < 5) return null;
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (const p of vs) { const row = [p[0], p[1], p[2], 1], z = V.dot(p, p); for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; b[i] += row[i] * z; } }
    const m = A.map((r, i) => r.concat([b[i]]));
    for (let i = 0; i < 4; i++) {
      let piv = i; for (let r = i + 1; r < 4; r++) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
      if (Math.abs(m[piv][i]) < 1e-12) return null; [m[i], m[piv]] = [m[piv], m[i]];
      for (let r = 0; r < 4; r++) if (r !== i) { const f = m[r][i] / m[i][i]; for (let c = i; c < 5; c++) m[r][c] -= f * m[i][c]; }
    }
    const s = [0, 1, 2, 3].map(i => m[i][4] / m[i][i]), c = [s[0] / 2, s[1] / 2, s[2] / 2], r2 = s[3] + V.dot(c, c);
    return r2 > 0 ? { c, r: Math.sqrt(r2) } : null;
  };

  /* ---------------- Region diagnostics ---------------- */
  /** Zero-volume / degenerate parameters of a (world) body, as a sentence with the values, or null. */
  FK.bodyDegeneracy = function (b) {
    const p = b.p, f = (x) => FK.fmt(x, 6), t = b.type;
    if (t === 'RPP') {
      const A = [['X', p[0], p[1]], ['Y', p[2], p[3]], ['Z', p[4], p[5]]].filter(a => Math.abs(a[2] - a[1]) < 1e-12);
      if (A.length) return `zero thickness along ${A.map(a => a[0]).join(', ')}: ${A.map(a => a[0].toLowerCase() + 'min = ' + a[0].toLowerCase() + 'max = ' + f(a[1])).join(', ')}`;
    } else if (t === 'SPH') { if (!(p[3] > 0)) return `radius = ${f(p[3])} (must be > 0)`; }
    else if (t === 'RCC' || t === 'TRC') {
      const H = Math.hypot(p[3], p[4], p[5]);
      if (H < 1e-12) return `axis vector H = (${f(p[3])}, ${f(p[4])}, ${f(p[5])}) has zero length`;
      if (t === 'RCC' && !(p[6] > 0)) return `radius = ${f(p[6])} (must be > 0)`;
      if (t === 'TRC' && !(p[6] > 0) && !(p[7] > 0)) return `both radii are ${f(p[6])} and ${f(p[7])} (one must be > 0)`;
    } else if (t === 'PLA') { if (Math.hypot(p[0], p[1], p[2]) < 1e-12) return 'normal vector H has zero length'; }
    return null;
  };
  /**
   * Explains, with numbers, why a region is empty. ctx: { body(name)->polys|null, wbody(name)->world body|null, W: render zone,
   * world() }. Returns [{ level, zone, text, fix?: { label, expr } }] ; empty list when nothing is wrong.
   */
  FK.diagnoseRegion = function (ast, ctx) {
    const out = [], f = (x) => FK.fmt(x, 5), AX = ['x', 'y', 'z'];
    const tol = Math.max(boxDiag(ctx.W) * 1e-7, 1e-9);
    const rng = (bb) => AX.map((a, i) => `${a} ∈ [${f(bb.min[i])}, ${f(bb.max[i])}]`).join(', ');
    const multi = ast.zones.length > 1;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const operand = (t) => {
      if (t.name) { const polys = ctx.body(t.name); return polys == null ? null : { label: t.name, term: t, polys, wb: ctx.wbody ? ctx.wbody(t.name) : null }; }
      return { label: '(' + FK.formatExpr(t.sub) + ')', term: t, polys: FK.evalExpr(t.sub, ctx), wb: null };
    };
    ast.zones.forEach((zone, zi) => {
      const pre = multi ? `Zone ${zi + 1}: ` : '';
      const push = (level, text, fix) => out.push({ level, zone: zi, text: pre + text, fix });
      const pos = [], neg = [];
      for (const t of zone) { const o = operand(t); if (!o) return; (t.sign > 0 ? pos : neg).push(o); }
      let acc = null, accOps = [];
      const bbOf = (op) => (op.wb && !FK.isInfiniteType(op.wb.type) && FK.bodyBBox(op.wb)) || bboxOfPolys(op.polys);
      for (const op of pos.concat(neg)) {
        const dg = op.wb && FK.bodyDegeneracy(op.wb);
        if (dg) { push('error', `${op.term.sign > 0 ? '+' : '-'}${op.label} has no volume: ${dg}.`); return; }
      }
      for (const op of pos) {
        if (!op.polys.length) {
          const dg = op.wb && FK.bodyDegeneracy(op.wb);
          const bb = op.wb && FK.bodyBBox(op.wb);
          if (dg) push('error', `+${op.label} has no volume: ${dg}.`);
          else if (bb) push('error', `+${op.label} lies outside the render zone: body ${rng(bb)}, render zone ${rng(ctx.W)}.`);
          else push('error', `+${op.label} is empty inside the render zone.`);
          return;
        }
        if (acc === null) { acc = op.polys; accOps = [op]; continue; }
        const r = CSG.intersect(acc, op.polys);
        if (!r.length) {
          const A = accOps.length === 1 ? '+' + accOps[0].label : '(' + accOps.map(o => '+' + o.label).join(' ') + ')', B = '+' + op.label;
          const bbA = accOps.length === 1 ? bbOf(accOps[0]) : bboxOfPolys(acc), bbB = bbOf(op);
          const ov = [0, 1, 2].map(i => Math.min(bbA.max[i], bbB.max[i]) - Math.max(bbA.min[i], bbB.min[i]));
          const gaps = [0, 1, 2].filter(i => ov[i] < -tol).sort((a, b) => ov[a] - ov[b]);
          const touch = [0, 1, 2].filter(i => Math.abs(ov[i]) <= tol);
          let fix = null;
          if (accOps.length === 1 && op.term.name && accOps[0].term.name) {
            const ast2 = clone(ast);
            const keep = (t) => zone.filter(x => x === t || (x !== op.term && x !== accOps[0].term));
            ast2.zones.splice(zi, 1, keep(accOps[0].term).map(clone), keep(op.term).map(clone));
            fix = { label: 'If you meant both bodies together (union)', expr: FK.formatExpr(ast2) };
          }
          if (gaps.length) {
            push('error', `${A} and ${B} do not intersect: they are separated by a gap of ${f(-ov[gaps[0]])} cm along ${AX[gaps[0]].toUpperCase()} (${A}: ${AX[gaps[0]]} ∈ [${f(bbA.min[gaps[0]])}, ${f(bbA.max[gaps[0]])}], ${B}: ${AX[gaps[0]]} ∈ [${f(bbB.min[gaps[0]])}, ${f(bbB.max[gaps[0]])}]).` +
              (gaps.length > 1 ? ' Other gaps: ' + gaps.slice(1).map(i => `${f(-ov[i])} cm along ${AX[i].toUpperCase()}`).join(', ') + '.' : '') +
              ` Writing bodies one after another ("+a +b") means their INTERSECTION, which needs a common volume. Move one body by at least ${f(-ov[gaps[0]])} cm, or use a union.`, fix);
          } else if (touch.length) {
            const i = touch[0], v = Math.max(bbA.min[i], bbB.min[i]);
            push('error', `${A} and ${B} only touch: they share the plane ${AX[i].toUpperCase()} = ${f(v)} (overlap along ${AX[i].toUpperCase()} = ${f(ov[i])} cm, ${A}: ${AX[i]} ∈ [${f(bbA.min[i])}, ${f(bbA.max[i])}], ${B}: ${AX[i]} ∈ [${f(bbB.min[i])}, ${f(bbB.max[i])}]), so their intersection has zero thickness and no volume. ` +
              `For bodies placed end to end, write the region as a union ("+a | +b"), no overlap is needed.`, fix);
          } else {
            push('error', `${A} and ${B} have overlapping bounding boxes (overlap ${AX.map((a, i) => a.toUpperCase() + ' ' + f(ov[i])).join(', ')} cm) but the solids themselves do not intersect (curved or rotated shapes). ${A}: ${rng(bbA)}; ${B}: ${rng(bbB)}. Check the radii, axes and positions.`, fix);
          }
          return;
        }
        acc = r; accOps.push(op);
      }
      if (acc === null) acc = ctx.world();
      for (const op of neg) {
        const r = CSG.subtract(acc, op.polys);
        if (!r.length) {
          const bbA = accOps.length === 1 ? bbOf(accOps[0]) : bboxOfPolys(acc), bbN = bbOf(op);
          const A = accOps.length ? (accOps.length === 1 ? '+' + accOps[0].label : '(' + accOps.map(o => '+' + o.label).join(' ') + ')') : 'the render zone';
          const mg = [0, 1, 2].map(i => Math.min(bbA.min[i] - bbN.min[i], bbN.max[i] - bbA.max[i]));
          const ast2 = clone(ast); ast2.zones[zi] = zone.filter(t => t !== op.term).map(clone);
          const fix = ast2.zones[zi].length ? { label: `Without -${op.label}`, expr: FK.formatExpr(ast2) } : null;
          push('error', `-${op.label} removes everything that is left of ${A}: ${A} ${rng(bbA)} is inside -${op.label} ${rng(bbN)} (margins ${AX.map((a, i) => a.toUpperCase() + ' ' + f(mg[i])).join(', ')} cm). Shrink -${op.label} or drop it.`, fix);
          return;
        }
        acc = r;
      }
    });
    return out;
  };

  /* ---------------- Transformations de corps ---------------- */
  /** mode 'pct' (value = facteur, ex. 1.2) ou 'margin' (value en cm). Renvoie false si non applicable. */
  FK.scaleBody = function (b, mode, value) {
    const p = b.p;
    const pct = mode === 'pct';
    switch (b.type) {
      case 'RPP': {
        const mn = [Math.min(p[0], p[1]), Math.min(p[2], p[3]), Math.min(p[4], p[5])], mx = [Math.max(p[0], p[1]), Math.max(p[2], p[3]), Math.max(p[4], p[5])];
        for (let i = 0; i < 3; i++) {
          const c = (mn[i] + mx[i]) / 2; let h = (mx[i] - mn[i]) / 2;
          h = pct ? h * value : h + value; if (h < 0) h = 0;
          p[2 * i] = c - h; p[2 * i + 1] = c + h;
        }
        return true;
      }
      case 'SPH': p[3] = Math.max(0, pct ? p[3] * value : p[3] + value); return true;
      case 'RCC': case 'TRC': {
        const H = [p[3], p[4], p[5]], L = V.len(H); if (!L) return false;
        const d = V.mul(H, 1 / L);
        const c = V.add([p[0], p[1], p[2]], V.mul(H, 0.5));
        let nl = pct ? L * value : L + 2 * value; if (nl < 0) nl = 0;
        const nb = V.sub(c, V.mul(d, nl / 2)), nH = V.mul(d, nl);
        p[0] = nb[0]; p[1] = nb[1]; p[2] = nb[2]; p[3] = nH[0]; p[4] = nH[1]; p[5] = nH[2];
        p[6] = Math.max(0, pct ? p[6] * value : p[6] + value);
        if (b.type === 'TRC') p[7] = Math.max(0, pct ? p[7] * value : p[7] + value);
        return true;
      }
      case 'XCC': case 'YCC': case 'ZCC': p[2] = Math.max(0, pct ? p[2] * value : p[2] + value); return true;
      case 'PLA': {
        if (pct) return false;
        const n = V.norm([p[0], p[1], p[2]]);
        p[3] += n[0] * value; p[4] += n[1] * value; p[5] += n[2] * value; return true;
      }
      case 'XYP': case 'XZP': case 'YZP': if (pct) return false; p[0] += value; return true;
    }
    return false;
  };

  FK.flipPlane = function (b) {
    if (b.type === 'PLA') { b.p[0] = -b.p[0]; b.p[1] = -b.p[1]; b.p[2] = -b.p[2]; return true; }
    return false;
  };

  FK.uniqueName = function (base, used, maxLen) {
    maxLen = maxLen || 8;
    base = base.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(base)) base = 'a' + base;
    if (!used.has(base) && base.length <= maxLen) return base;
    const stem = base.replace(/\d+$/, '') || 'a';
    for (let n = 1; n < 100000; n++) {
      const s = String(n);
      const cand = stem.slice(0, Math.max(1, maxLen - s.length)) + s;
      if (!used.has(cand)) return cand;
    }
    return base;
  };

  /* ---------------- INP block generation ---------------- */
  FK.validate = function (model, resolve) {
    const w = [];
    const bn = new Set(), rn = new Set();
    const check = (name, kind) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) w.push(`${kind} "${name}": invalid name (letters, digits, _ ; must start with a letter)`);
      else if (name.length > 8) w.push(`${kind} "${name}": more than 8 characters`);
    };
    for (const b of model.bodies) {
      check(b.name, 'Body');
      if (bn.has(b.name)) w.push(`Body "${b.name}": duplicate name`);
      bn.add(b.name);
      if (b.type === 'RAW') w.push(`Body "${b.name}" (${b.rawType}): type not displayed, kept as-is`);
      else if (b.p.some(x => !isFinite(x))) w.push(`Body "${b.name}": non-numeric parameter`);
      else if (resolve) {
        const wb = resolve(b);
        if (wb.type === 'OBOX') w.push(`Body "${b.name}": RPP defined in a rotated frame → exported as a bounding RPP + cutting planes (PLA), regions adapted`);
        else if (wb.type === 'ICC') w.push(`Body "${b.name}": oblique infinite cylinder → exported as QUA`);
        else if (wb.type === 'PLA' && b.type !== 'PLA') w.push(`Body "${b.name}" (${b.type}): oblique plane exported as PLA`);
      }
    }
    for (const r of model.regions) {
      check(r.name, 'Region');
      if (rn.has(r.name)) w.push(`Region "${r.name}": duplicate name`);
      rn.add(r.name);
      if (!r.expr.trim()) { w.push(`Region "${r.name}": empty expression`); continue; }
      try {
        const names = FK.exprNames(FK.parseExpr(r.expr));
        for (const n of names) if (!bn.has(n)) w.push(`Region "${r.name}": unknown body "${n}"`);
      } catch (e) { w.push(`Region "${r.name}": ${e.message}`); }
    }
    return w;
  };

  /** FLUKA advises against ARB: a rotated RPP (world OBOX) is written as a bounding RPP
   * + cutting PLA planes (faces not aligned with the axes). Returns Map(body name → {rpp, planes:[{name, body}]}).
   * opts.arb = true: legacy behaviour (ARB card). */
  FK.splitObox = function (model, opts) {
    const res = new Map();
    if (!opts || !opts.resolve || opts.arb) return res;
    const used = new Set(model.bodies.map(b => b.name));
    for (const b of model.bodies) {
      if (b.type === 'RAW') continue;
      const wb = opts.resolve(b);
      if (wb.type !== 'OBOX') continue;
      const bb = FK.bodyBBox(wb), c = [wb.p[0], wb.p[1], wb.p[2]];
      const planes = [];
      let k = 0;
      for (const hv of [[3, 4, 5], [6, 7, 8], [9, 10, 11]]) {
        const h = [wb.p[hv[0]], wb.p[hv[1]], wb.p[hv[2]]], L = V.len(h);
        if (L < 1e-12) continue;
        const n = V.mul(h, 1 / L);
        if (n.filter(x => Math.abs(x) < 1e-9).length === 2) continue; // face aligned with an axis: already provided by the RPP
        for (const sg of [1, -1]) {
          const nn = V.mul(n, sg), pt = V.add(c, V.mul(h, sg));
          let nm;
          do { k++; nm = b.name.slice(0, 8 - String(k).length - 1) + 'p' + k; } while (used.has(nm));
          used.add(nm);
          planes.push({ name: nm, body: { type: 'PLA', p: [nn[0], nn[1], nn[2], pt[0], pt[1], pt[2]] } });
        }
      }
      res.set(b.name, { rpp: { type: 'RPP', p: [bb.min[0], bb.max[0], bb.min[1], bb.max[1], bb.min[2], bb.max[2]] }, planes });
    }
    return res;
  };
  /** Replaces, in an expression, each split body by RPP ∩ planes : +A → +A +A p1 …, −A → −(+A +A p1 …). */
  FK.expandSplitTerms = function (ast, split) {
    for (const z of ast.zones) {
      for (let i = 0; i < z.length; i++) {
        const t = z[i];
        if (t.sub) { FK.expandSplitTerms(t.sub, split); continue; }
        const sp = split.get(t.name);
        if (!sp || !sp.planes.length) continue;
        const group = [{ sign: 1, name: t.name }].concat(sp.planes.map(p => ({ sign: 1, name: p.name })));
        if (t.sign >= 0) { z.splice(i, 1, ...group); i += group.length - 1; }
        else z[i] = { sign: -1, sub: { zones: [group] } };
      }
    }
  };

  function bodyLine(b, style, opts) {
    if (b.type === 'RAW') return (b.raw || []).join('\n');
    return FK.exportBodyText(opts.resolve ? opts.resolve(b) : b, b.name, style, opts);
  }
  function wrapTerms(text, width, indent) {
    const parts = text.split(' ');
    const lines = []; let cur = '';
    for (const p of parts) {
      if (cur && (cur + ' ' + p).length > width) { lines.push(cur); cur = p; }
      else cur = cur ? cur + ' ' + p : p;
    }
    if (cur) lines.push(cur);
    return lines.map((l, i) => (i ? indent : '') + l);
  }

  /** style 1: "REGION name n" + expression line (Flair type); style 2: compact aligned;
   * style 3: fixed Fortran-like columns (GEOBEGIN card (A8,2X,6E10.0,A8), title (2I5,10X,A60), bodies A3/A8/19-col numbers,
   * regions A8 + I5 + expression), every line <= 132 columns. */
  FK.generateInp = function (model, opts) {
    opts = opts || {};
    const style = opts.style === 3 ? 3 : opts.style === 2 ? 2 : 1;
    const out = [];
    const title = (model.title || 'Geometry').replace(/\s+$/, '');
    if (style === 1) { out.push('GEOBEGIN COMBNAME'); out.push('\t' + title); }
    else { out.push('GEOBEGIN'.padEnd(70) + 'COMBNAME'); out.push('    0    0          ' + title.slice(0, 60)); }
    const split = FK.splitObox(model, opts);
    for (const b of model.bodies) {
      const sp = split.get(b.name);
      if (sp) { out.push(FK.exportBodyText(sp.rpp, b.name, style, opts)); sp.planes.forEach(pl => out.push(FK.exportBodyText(pl.body, pl.name, style, opts))); }
      else out.push(bodyLine(b, style, opts));
    }
    out.push('END');
    for (const r of model.regions) {
      let expr = r.expr || '';
      try {
        const ast = FK.parseExpr(expr);
        if (split.size) FK.expandSplitTerms(ast, split);
        expr = FK.formatExpr(ast);
      } catch (e) { /* garder tel quel */ }
      const nv = (r.nvois === undefined || r.nvois === '' ? 5 : r.nvois);
      if (style === 1) {
        out.push(`REGION ${r.name} ${nv}`);
        for (const l of wrapTerms(expr, 100, '\t')) out.push(l[0] === '\t' ? l : '\t' + l);
      } else if (style === 3) {
        const head = r.name.padEnd(8) + ' ' + String(nv).padStart(5) + ' ';
        const ls = wrapTerms(expr, 130 - head.length, '');
        ls.forEach((l, i) => out.push(i === 0 ? head + l : ' '.repeat(head.length) + l));
      } else {
        const head = r.name.padEnd(13) + nv + ' ';
        const ls = wrapTerms(expr, 100, '');
        ls.forEach((l, i) => out.push(i === 0 ? head + l : ' '.repeat(head.length) + l));
      }
    }
    out.push('END');
    for (const t of (model.tail || [])) out.push(t);
    out.push('GEOEND');
    return out.join('\n') + '\n';
  };

  /* ---------------- Lecture d'un bloc INP ---------------- */
  FK.parseInp = function (text) {
    const lines = text.split(/\r?\n/);
    const warnings = [];
    const model = { title: 'Geometry', bodies: [], regions: [], tail: [] };
    let i = 0;
    let foundBegin = false;
    for (; i < lines.length; i++) {
      if (/^\s*GEOBEGIN\b/i.test(lines[i])) { foundBegin = true; if (!/COMBNAME/i.test(lines[i])) warnings.push('GEOBEGIN without COMBNAME: only the name-based format is supported.'); i++; break; }
    }
    if (!foundBegin) { i = 0; warnings.push('GEOBEGIN not found: reading from the start of the text.'); }
    else {
      while (i < lines.length && /^\s*\*/.test(lines[i])) i++;
      if (i < lines.length) {
        const l = lines[i++];
        const m = l.match(/^\s*\d+\s+\d+\s+(.*)$/);
        model.title = (m ? m[1] : l).trim() || 'Geometry';
      }
    }
    const used = new Set();
    let colorIdx = 0;
    // --- corps ---
    let last = null;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line || line[0] === '*') continue;
      const toks = line.split(/\s+/);
      if (toks[0].toUpperCase() === 'END') { i++; break; }
      const kw = toks[0].toUpperCase();
      if (/^[A-Z]{3}$/.test(kw) && isNaN(parseFloat(toks[0]))) {
        const name = toks[1] || ('b' + (model.bodies.length + 1));
        const nums = toks.slice(2).map(parseFloat);
        if (BODY_TYPES[kw]) {
          last = { id: 0, type: kw, name, p: nums, visible: true, opacity: 0.3, color: FK.PALETTE[colorIdx++ % FK.PALETTE.length], meta: {} };
        } else {
          last = { id: 0, type: 'RAW', rawType: kw, name, p: [], raw: [raw.replace(/\s+$/, '')], visible: false, opacity: 0.3, color: '#888888', meta: {} };
        }
        model.bodies.push(last); used.add(name);
      } else if (last) {
        if (last.type === 'RAW') last.raw.push(raw.replace(/\s+$/, ''));
        else for (const t of toks) last.p.push(parseFloat(t));
      }
    }
    for (const b of model.bodies) {
      if (b.type === 'RAW') continue;
      const need = BODY_TYPES[b.type].fields.length;
      if (b.p.length < need) { warnings.push(`Body ${b.name}: ${b.p.length} parameters instead of ${need}.`); while (b.p.length < need) b.p.push(0); }
      if (b.p.length > need) b.p.length = need;
      for (let k = 0; k < b.p.length; k++) if (!isFinite(b.p[k])) { b.p[k] = 0; warnings.push(`Body ${b.name}: parameter ${k + 1} unreadable (set to 0).`); }
    }
    // --- regions ---
    let cur = null;
    const regionStart = (name, nv, rest) => {
      cur = { id: 0, name, nvois: isNaN(parseInt(nv, 10)) ? 5 : parseInt(nv, 10), expr: rest || '', visible: true, opacity: 0.4, color: FK.PALETTE[(colorIdx++) % FK.PALETTE.length], meta: {} };
      model.regions.push(cur);
    };
    let warnedAt = false;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line || line[0] === '*') continue;
      if (/^END\b/i.test(line)) { i++; break; }
      if (line[0] === '@') { if (!warnedAt) { warnings.push('Flair @… directives ignored in regions.'); warnedAt = true; } continue; }
      const toks = line.split(/\s+/);
      if (toks[0].toUpperCase() === 'REGION') { regionStart(toks[1], toks[2], toks.slice(3).join(' ')); continue; }
      if (!/^[+\-|(]/.test(line) && toks.length >= 2 && /^\d+$/.test(toks[1])) { regionStart(toks[0], toks[1], toks.slice(2).join(' ')); continue; }
      if (cur) cur.expr += (cur.expr ? ' ' : '') + line;
    }
    // --- remainder (LATTICE, volumes…) ---
    for (; i < lines.length; i++) {
      if (/^\s*GEOEND\b/i.test(lines[i])) break;
      if (lines[i].trim()) model.tail.push(lines[i].replace(/\s+$/, ''));
    }
    if (model.tail.length) warnings.push('Lines after the regions block (LATTICE / volumes…) kept without processing.');
    for (const r of model.regions) {
      try { r.expr = FK.formatExpr(FK.parseExpr(r.expr)); } catch (e) { warnings.push(`Region ${r.name}: ${e.message}`); }
    }
    return { model, warnings };
  };

  root.FK = FK;
  if (typeof module !== 'undefined' && module.exports) module.exports = FK;
})(typeof window !== 'undefined' ? window : globalThis);
