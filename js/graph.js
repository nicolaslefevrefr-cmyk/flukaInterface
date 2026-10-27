/* graph.js — dependency graph of the model (pure logic, no DOM)
 *  FK.depGraph(model, opts) → { nodes, edges }
 *    model : { bodies, regions }  (items with id, name, type, color, noExport, expr, meta)
 *    opts  : { planes: true, bodies: true, cad: [{ id, name, color }] | null, cadOf: (item, kind) → mesh id }
 *    node  : { id: 'b12' | 'r7' | 'm3', kind: 'body' | 'plane' | 'region' | 'cad', ref: { t, id }, name, type, color, noExport, unused }
 *    edge  : { from, to, kind: 'use' | 'link' | 'derived' | 'cad', sign: +1 | -1 | 0 (both), role: 'A' | 'B' | '', op }
 *  FK.layoutDepGraph(graph) → { pos: Map(id → { x, y, layer }), layers, w, h }   layered drawing, edges always go to the right
 *  FK.depScope(graph, ids, mode) → Set of node ids: 'up' (what they depend on), 'down' (what depends on them), 'both'. */
(function (root) {
  'use strict';
  const FK = root.FK || (typeof require !== 'undefined' ? require('./core.js') : null);

  /** Effective signs of every body name of an expression (nested parentheses multiply the signs). */
  function signsOf(ast, sg, out) {
    for (const z of ast.zones) for (const t of z) {
      const s = sg * (t.sign < 0 ? -1 : 1);
      if (t.name) { if (!out.has(t.name)) out.set(t.name, new Set()); out.get(t.name).add(s); } else signsOf(t.sub, s, out);
    }
    return out;
  }

  FK.depGraph = function (model, opts) {
    opts = opts || {};
    const nodes = [], edges = [], byId = new Map();
    const add = (n) => { nodes.push(n); byId.set(n.id, n); return n; };
    const regs = model.regions, bodies = model.bodies;
    const usedBy = new Map();          // body name → exported regions using it
    const regSigns = new Map();
    for (const r of regs) {
      let m = new Map(); try { m = signsOf(FK.parseExpr(r.expr || ''), 1, new Map()); } catch (e) { /* invalid expression: no dependency */ }
      regSigns.set(r.id, m);
      if (!r.noExport) for (const n of m.keys()) usedBy.set(n, (usedBy.get(n) || 0) + 1);
    }
    for (const b of bodies) {
      const plane = FK.isPlaneType(b.type);
      if (plane ? opts.planes === false : opts.bodies === false) continue;
      add({ id: 'b' + b.id, kind: plane ? 'plane' : 'body', ref: { t: 'body', id: b.id }, name: b.name, type: b.type === 'RAW' ? (b.rawType || 'RAW') : b.type, color: b.color, noExport: !!b.noExport, unused: !b.noExport && !usedBy.get(b.name) });
    }
    for (const r of regs) add({ id: 'r' + r.id, kind: 'region', ref: { t: 'region', id: r.id }, name: r.name, type: 'REGION', color: r.color, noExport: !!r.noExport, unused: false, expr: r.expr || '' });
    const bodyByName = new Map(bodies.map(b => [b.name, b]));
    for (const r of regs) {
      for (const [n, set] of regSigns.get(r.id)) {
        const b = bodyByName.get(n); if (!b || !byId.has('b' + b.id)) continue;
        edges.push({ from: 'b' + b.id, to: 'r' + r.id, kind: 'use', sign: set.size > 1 ? 0 : Array.from(set)[0], role: '' });
      }
      const L = r.meta && r.meta.link;
      if (L) {
        for (const [k, role] of [['a', 'A'], ['b', 'B']]) if (byId.has('r' + L[k])) edges.push({ from: 'r' + L[k], to: 'r' + r.id, kind: 'link', sign: 0, role, op: L.op, strong: true });
      } else if (r.meta && r.meta.boolOf) {
        const [na, nb, op] = r.meta.boolOf;
        [[na, 'A'], [nb, 'B']].forEach(([n, role]) => { const q = regs.find(x => x.name === n && x !== r); if (q) edges.push({ from: 'r' + q.id, to: 'r' + r.id, kind: 'derived', sign: 0, role, op, strong: false }); });
      }
    }
    if (opts.cad && opts.cad.length && opts.cadOf) {
      const have = new Set();
      const ln = (it, kind, id) => { const c = opts.cadOf(it, kind); if (c && byId.has(id)) { have.add(c); edges.push({ from: 'm' + c, to: id, kind: 'cad', sign: 0, role: '' }); } };
      for (const b of bodies) ln(b, 'body', 'b' + b.id);
      for (const r of regs) ln(r, 'region', 'r' + r.id);
      for (const m of opts.cad) if (have.has(m.id)) add({ id: 'm' + m.id, kind: 'cad', ref: { t: 'stl', id: m.id }, name: m.name, type: 'CAD', color: m.color || '#64748b', noExport: false, unused: false });
    }
    return { nodes, edges };
  };

  FK.depScope = function (g, ids, mode) {
    const out = new Set(ids), fwd = new Map(), back = new Map();
    for (const e of g.edges) { (fwd.get(e.from) || fwd.set(e.from, []).get(e.from)).push(e.to); (back.get(e.to) || back.set(e.to, []).get(e.to)).push(e.from); }
    const walk = (map) => { const st = Array.from(ids); while (st.length) { const n = st.pop(); for (const m of map.get(n) || []) if (!out.has(m)) { out.add(m); st.push(m); } } };
    if (mode === 'up' || mode === 'both') walk(back);
    if (mode === 'down' || mode === 'both') walk(fwd);
    return out;
  };

  FK.layoutDepGraph = function (g, o) {
    o = o || {}; const colW = o.colW || 210, rowH = o.rowH || 46;
    const ids = g.nodes.map(n => n.id), layer = new Map(ids.map(i => [i, 0]));
    for (let it = 0; it < ids.length + 1; it++) { let ch = false; for (const e of g.edges) { if (layer.has(e.from) && layer.has(e.to) && layer.get(e.to) < layer.get(e.from) + 1) { layer.set(e.to, layer.get(e.from) + 1); ch = true; } } if (!ch) break; }
    // sinks that only depend on bodies stay close to their inputs, bodies sit just before their first user
    const first = new Map(); for (const e of g.edges) if (e.kind === 'use') first.set(e.from, Math.min(first.has(e.from) ? first.get(e.from) : 1e9, layer.get(e.to)));
    for (const n of g.nodes) if ((n.kind === 'body' || n.kind === 'plane') && first.has(n.id) && !g.edges.some(e => e.to === n.id)) layer.set(n.id, Math.max(0, first.get(n.id) - 1));
    const nl = Math.max(0, ...layer.values()) + 1, cols = Array.from({ length: nl }, () => []);
    const rank = { cad: 0, plane: 1, body: 2, region: 3 };
    g.nodes.slice().sort((a, b) => (rank[a.kind] - rank[b.kind]) || a.name.localeCompare(b.name, 'en', { numeric: true })).forEach(n => cols[layer.get(n.id)].push(n.id));
    const idx = new Map(); const reindex = () => cols.forEach(c => c.forEach((id, i) => idx.set(id, i)));
    reindex();
    const nb = (id, dir) => g.edges.filter(e => dir < 0 ? e.to === id : e.from === id).map(e => dir < 0 ? e.from : e.to);
    for (let sweep = 0; sweep < 6; sweep++) {
      const order = sweep % 2 ? Array.from({ length: nl }, (_, i) => nl - 1 - i) : Array.from({ length: nl }, (_, i) => i), dir = sweep % 2 ? 1 : -1;
      for (const c of order) {
        const bc = new Map(cols[c].map(id => { const ns = nb(id, dir).filter(x => layer.get(x) !== c); return [id, ns.length ? ns.reduce((s, x) => s + idx.get(x), 0) / ns.length : idx.get(id)]; }));
        cols[c].sort((a, b) => bc.get(a) - bc.get(b) || idx.get(a) - idx.get(b)); reindex();
      }
    }
    const pos = new Map(), tall = Math.max(1, ...cols.map(c => c.length));
    cols.forEach((c, ci) => { const off = (tall - c.length) * rowH / 2; c.forEach((id, i) => pos.set(id, { x: ci * colW, y: off + i * rowH, layer: ci })); });
    return { pos, layers: nl, w: (nl - 1) * colW, h: (tall - 1) * rowH };
  };
})(typeof window !== 'undefined' ? window : globalThis);
