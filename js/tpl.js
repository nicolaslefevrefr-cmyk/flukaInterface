/* tpl.js — parametric component templates (pure logic, no DOM)
 *  FK.TEMPLATES : { id: { name, desc, prefix, params: [{ k, l, v, min?, bool? }], build(P) } }
 *  FK.tplDefaults(id) → { k: v }
 *  FK.tplBuild(id, params) → { bodies: [{ role, type, p }], regions: [{ role, expr, label }], info: [string], error?: string }
 *  The bodies are expressed in the frame of the component (Z = axis, base on the XY plane; lengths in cm); expressions use {role} placeholders for body names.
 *  Every generated region is an ordinary region: it can be used in boolean operations with other regions like any other. */
(function (root) {
  'use strict';
  const FK = root.FK || (typeof require !== 'undefined' ? require('./core.js') : null);
  const P = (k, l, v, o) => Object.assign({ k, l, v }, o || {});
  const BORE = P('bore', 'Also create the inner (bore) region', 1, { bool: true });
  const num = (x) => +(+x).toFixed(9);
  const pos = (E, ...ks) => { for (const [k, l] of ks) if (!(E[k] > 0)) return `${l} must be positive`; return ''; };
  const T = {
    tube: {
      name: 'Tube (hollow cylinder)', prefix: 'tube', desc: 'Cylindrical wall with an inner radius and a thickness; the bore can be created as a region too.',
      params: [P('rin', 'Inner radius (cm)', 5), P('t', 'Wall thickness (cm)', 1), P('len', 'Length (cm)', 20), P('bore', 'Also create the inner (bore) region', 1, { bool: true })],
      build(E) {
        const e = pos(E, ['rin', 'Inner radius'], ['t', 'Wall thickness'], ['len', 'Length']); if (e) return { error: e };
        const out = {
          bodies: [{ role: 'out', type: 'RCC', p: [0, 0, 0, 0, 0, E.len, num(E.rin + E.t)] }, { role: 'in', type: 'RCC', p: [0, 0, 0, 0, 0, E.len, E.rin] }],
          regions: [{ role: 'wall', expr: '+{out} -{in}', label: 'wall' }], info: [`Outer radius ${num(E.rin + E.t)} cm`]
        };
        if (E.bore) out.regions.push({ role: 'bore', expr: '+{in}', label: 'bore' });
        return out;
      }
    },
    vessel: {
      name: 'Closed vessel (tube with end caps)', prefix: 'vessel', desc: 'Cylindrical shell closed by two end caps; the inside can be created as a region too.',
      params: [P('rin', 'Inner radius (cm)', 5), P('t', 'Side wall thickness (cm)', 1), P('capT', 'End cap thickness (cm)', 1), P('len', 'Outer length (cm)', 20), P('bore', 'Also create the inside region', 1, { bool: true })],
      build(E) {
        const e = pos(E, ['rin', 'Inner radius'], ['t', 'Side wall thickness'], ['capT', 'End cap thickness'], ['len', 'Outer length']) || (E.len <= 2 * E.capT ? 'The length must exceed twice the end cap thickness' : '');
        if (e) return { error: e };
        const out = {
          bodies: [{ role: 'out', type: 'RCC', p: [0, 0, 0, 0, 0, E.len, num(E.rin + E.t)] }, { role: 'in', type: 'RCC', p: [0, 0, E.capT, 0, 0, num(E.len - 2 * E.capT), E.rin] }],
          regions: [{ role: 'wall', expr: '+{out} -{in}', label: 'wall' }], info: [`Outer radius ${num(E.rin + E.t)} cm`, `Inner length ${num(E.len - 2 * E.capT)} cm`]
        };
        if (E.bore) out.regions.push({ role: 'bore', expr: '+{in}', label: 'inside' });
        return out;
      }
    },
    box: {
      name: 'Hollow box (enclosure)', prefix: 'box', desc: 'Box with walls of uniform thickness, centred on the Z axis with its base on the XY plane.',
      params: [P('lx', 'Outer X (cm)', 20), P('ly', 'Outer Y (cm)', 20), P('lz', 'Outer Z (cm)', 20), P('t', 'Wall thickness (cm)', 2), P('bore', 'Also create the cavity region', 1, { bool: true })],
      build(E) {
        const e = pos(E, ['lx', 'Outer X'], ['ly', 'Outer Y'], ['lz', 'Outer Z'], ['t', 'Wall thickness']) || (2 * E.t >= Math.min(E.lx, E.ly, E.lz) ? 'The walls leave no cavity: reduce the thickness' : ''); if (e) return { error: e };
        const h = [E.lx / 2, E.ly / 2], inn = [num(h[0] - E.t), num(h[1] - E.t)];
        const out = {
          bodies: [{ role: 'out', type: 'RPP', p: [-h[0], h[0], -h[1], h[1], 0, E.lz] }, { role: 'in', type: 'RPP', p: [-inn[0], inn[0], -inn[1], inn[1], E.t, num(E.lz - E.t)] }],
          regions: [{ role: 'wall', expr: '+{out} -{in}', label: 'wall' }], info: [`Cavity ${num(E.lx - 2 * E.t)} × ${num(E.ly - 2 * E.t)} × ${num(E.lz - 2 * E.t)} cm`]
        };
        if (E.bore) out.regions.push({ role: 'bore', expr: '+{in}', label: 'cavity' });
        return out;
      }
    },
    blockbore: {
      name: 'Block with a cylindrical bore', prefix: 'block', desc: 'Box crossed by a cylindrical hole along Z (the hole can be off-centre).',
      params: [P('lx', 'Block X (cm)', 20), P('ly', 'Block Y (cm)', 20), P('lz', 'Block Z (cm)', 20), P('r', 'Bore radius (cm)', 3), P('cx', 'Bore centre X (cm)', 0), P('cy', 'Bore centre Y (cm)', 0), P('bore', 'Also create the bore region', 1, { bool: true })],
      build(E) {
        const e = pos(E, ['lx', 'Block X'], ['ly', 'Block Y'], ['lz', 'Block Z'], ['r', 'Bore radius']) || (Math.abs(E.cx) + E.r >= E.lx / 2 || Math.abs(E.cy) + E.r >= E.ly / 2 ? 'The bore goes through the side of the block' : ''); if (e) return { error: e };
        const out = {
          bodies: [{ role: 'block', type: 'RPP', p: [-E.lx / 2, E.lx / 2, -E.ly / 2, E.ly / 2, 0, E.lz] }, { role: 'bore', type: 'RCC', p: [E.cx, E.cy, 0, 0, 0, E.lz, E.r] }],
          regions: [{ role: 'body', expr: '+{block} -{bore}', label: 'block' }], info: []
        };
        if (E.bore) out.regions.push({ role: 'hole', expr: '+{bore}', label: 'bore' });
        return out;
      }
    },
    collimator: {
      name: 'Collimator (block with a conical bore)', prefix: 'coll', desc: 'Box crossed by a conical channel along Z: entrance radius at the base, exit radius at the top.',
      params: [P('lx', 'Block X (cm)', 20), P('ly', 'Block Y (cm)', 20), P('lz', 'Block Z (cm)', 30), P('r1', 'Entrance radius (cm)', 1), P('r2', 'Exit radius (cm)', 3), P('bore', 'Also create the channel region', 1, { bool: true })],
      build(E) {
        const e = pos(E, ['lx', 'Block X'], ['ly', 'Block Y'], ['lz', 'Block Z'], ['r1', 'Entrance radius'], ['r2', 'Exit radius']) || (Math.max(E.r1, E.r2) * 2 >= Math.min(E.lx, E.ly) ? 'The channel is wider than the block' : ''); if (e) return { error: e };
        const out = {
          bodies: [{ role: 'block', type: 'RPP', p: [-E.lx / 2, E.lx / 2, -E.ly / 2, E.ly / 2, 0, E.lz] }, { role: 'chan', type: 'TRC', p: [0, 0, 0, 0, 0, E.lz, E.r1, E.r2] }],
          regions: [{ role: 'body', expr: '+{block} -{chan}', label: 'block' }], info: [`Half-angle ${num(Math.atan(Math.abs(E.r2 - E.r1) / E.lz) * 180 / Math.PI)}°`]
        };
        if (E.bore) out.regions.push({ role: 'channel', expr: '+{chan}', label: 'channel' });
        return out;
      }
    }
  };
  FK.TEMPLATES = T;
  FK.tplDefaults = (id) => { const o = {}; for (const q of T[id].params) o[q.k] = q.v; return o; };
  FK.tplBuild = function (id, params) {
    const t = T[id]; if (!t) return { error: 'Unknown template ' + id };
    const E = Object.assign(FK.tplDefaults(id), params || {});
    for (const q of t.params) if (!isFinite(+E[q.k])) return { error: `${q.l}: not a number` }; else E[q.k] = q.bool ? (+E[q.k] ? 1 : 0) : +E[q.k];
    const r = t.build(E); if (r.error) return r;
    return Object.assign({ info: [] }, r);
  };
})(typeof window !== 'undefined' ? window : globalThis);
