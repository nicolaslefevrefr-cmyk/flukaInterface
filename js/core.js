/* core.js — pure logic (no DOM, no three.js)
 * Mesh parsing, topology, CSG, FLUKA bodies/regions, generation and parsing of the GEOBEGIN/GEOEND block.
 * All lengths are in cm (FLUKA unit). */
(function (root) {
  'use strict';
  const FK = {};

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
      case 'SPH': raw = spherePolys([p[0], p[1], p[2]], p[3], 32, 20); break;
      case 'RCC': raw = cylinderPolys([p[0], p[1], p[2]], [p[3], p[4], p[5]], p[6], p[6], 48); break;
      case 'TRC': raw = cylinderPolys([p[0], p[1], p[2]], [p[3], p[4], p[5]], p[6], p[7], 48); break;
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
        raw = cylinderPolys(base, V.mul(d, 2 * L), p[6], p[6], 64);
        break;
      }
      case 'XCC': case 'YCC': case 'ZCC': {
        const L = diag * 2 + 1;
        if (p[2] <= 0) return [];
        if (b.type === 'ZCC') raw = cylinderPolys([p[0], p[1], C[2] - L], [0, 0, 2 * L], p[2], p[2], 64);
        else if (b.type === 'XCC') raw = cylinderPolys([C[0] - L, p[0], p[1]], [2 * L, 0, 0], p[2], p[2], 64);
        else raw = cylinderPolys([p[1], C[1] - L, p[0]], [0, 2 * L, 0], p[2], p[2], 64);
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
