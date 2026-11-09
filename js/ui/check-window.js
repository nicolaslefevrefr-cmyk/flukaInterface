/* ui/check-window.js — Geometry check window
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Geometry check window ---------- */
const FIX_HINT = { merge: 'Merge the identical planes into one (like Check ▸ Compact)', snapAxis: 'Set the axis exactly on the global axis', snapPlane: 'Set the plane exactly perpendicular to the global axis (XYP / XZP / YZP when possible)', align: 'Rotate the second cylinder so that its axis is parallel to the first', concentric: 'Move the second cylinder onto the axis of the first', radius: 'Give the second cylinder the radius of the first', shift: 'Translate the second cylinder along its axis so the ends touch', planeMerge: 'Make the second plane coincide with the first', face: 'Move the face onto the reference face' };
const CHK = { last: null, bodies: [], tol: 0.01 };
/** Alignment findings on what the INP really contains: a rotated RPP counts as its bounding RPP + cutting planes. Also lists the duplicate planes of the INP. */
function chkAlign(bodies, tol) {
  const parts = APP.exportParts(), auto = new Map(), list = [];
  for (const b of bodies) {
    if (b.type === 'RAW') continue;
    const ps = parts.get(b);
    if (ps && ps.length > 1) for (const pt of ps) { if (pt.mergedInto) continue; list.push({ name: pt.role === 'main' ? b.name : pt.name, type: pt.type, p: pt.p, prec: pt.prec }); if (pt.role === 'cut') auto.set(pt.name, b.name); }
    else list.push(Object.assign({ name: b.name }, APP.xbody(b)));
  }
  const out = FK.checkAlignment(list, { tol }), note = (f) => {
    const au = f.names.filter(n => auto.has(n)); if (!au.length) return f;
    let text = f.text; for (const n of au) text = text.split(n).join(`${n} (cut plane of ${auto.get(n)})`);
    return Object.assign({}, f, { text, names: [...new Set(f.names.map(n => auto.get(n) || n))], fix: null });
  };
  const res = out.map(note);
  // duplicate planes written in the INP (user planes and generated cutting planes)
  const opts = { style: S.opt.style, resolve: APP.xbody }, view = FK.inpView(S.model), act = FK.activeMerges(view, opts).act, tolA = Math.min(1e-3, tol / 100);
  const own = (nm) => { const i = view.bodies.findIndex(b => b.name === nm); return i >= 0 ? S.model.bodies[i].name : nm; };
  for (const g of FK.findPlaneMerges(Object.assign({}, view, { merges: [] }), opts, tolA, tol)) {
    const drops = g.drops.filter(x => !act.has(x.name)); if (!drops.length) continue;
    const lab = (pl) => pl.auto ? `${pl.name} (cut plane of ${own(pl.owner)})` : own(pl.name), dd = Math.max(...drops.map(x => x.dd));
    res.push({ level: 'warn', kind: 'dup', text: `Planes ${[g.keep].concat(drops).map(lab).join(' / ')} coincide (≤ ${(dd * 10).toPrecision(2)} mm apart): written ${drops.length + 1} times in the INP — merge them to avoid gaps`, names: [...new Set([g.keep.owner].concat(drops.map(x => x.owner)).map(own))],
      fix: { type: 'merge', keep: g.keep.name, drops: drops.map(x => ({ name: x.name, sign: x.sign, dn: x.dn, dd: x.dd })), tolA, tolD: tol } });
  }
  return res;
}
/** Applies one fix, or all of them in turn (findings are recomputed after each change). */
function chkSolve(i) {
  const R = CHK.last; if (!R) return;
  if (i === 'all') {
    APP.snap(); let n = 0; const tried = new Set(), msgs = [];
    for (let it = 0; it < 80; it++) {
      const al = chkAlign(CHK.bodies, CHK.tol), f = al.find(a => a.fix && !tried.has(JSON.stringify(a.fix)));
      if (!f) break; tried.add(JSON.stringify(f.fix));
      const res = APP.applyFix(f.fix); if (res.ok) { n++; msgs.push(res.msg); }
    }
    APP.changed({ tree: true, right: true }); toast(n ? `${n} fix(es) applied (Ctrl+Z undoes the last one)` : 'Nothing could be fixed automatically');
  } else {
    const a = R.al[+i]; if (!a || !a.fix) return;
    const res = APP.applyFix(a.fix); toast(res.msg); if (res.ok) APP.changed({ tree: true, right: true });
  }
  chkRun();
}
function chkRun() {
  const esc2 = esc, rows = [];
  const regs0 = S.model.regions.filter(r => !r.noExport && r.expr && r.expr.trim()), used = new Set();
  for (const r of regs0) { try { for (const nm of FK.exprNames(FK.parseExpr(r.expr))) used.add(nm); } catch (e) { /* ignored */ } }
  const bodies = S.model.bodies.filter(b => !b.noExport && used.has(b.name)), regs = S.model.regions.filter(r => !r.noExport && r.expr && r.expr.trim());
  const tol = Math.max(0, parseFloat($('#chkTol').value) || 0.1) / 10, n = Math.max(20, Math.min(160, +$('#chkN').value || 72));
  const R = { eq: null, ov: null, al: null };
  // A. INP <-> model
  R.eq = FK.checkEquivalence(S.model, APP.xbody, APP.inpText(), { points: 8000 });
  // B. overlaps / holes (world frame)
  const fns = new Map(); let box = null;
  for (const b of bodies) { const wb = APP.wbody(b), f = FK.insideFn(wb); if (f) fns.set(b.name, f); const bb = b.type === 'RAW' ? null : FK.bodyBBox(wb); if (bb) box = box ? { min: box.min.map((x, i) => Math.min(x, bb.min[i])), max: box.max.map((x, i) => Math.max(x, bb.max[i])) } : bb; }
  if (box) { const pad = 0.05 * (Math.max(...box.max.map((x, i) => x - box.min[i])) || 1); box = { min: box.min.map(x => x - pad), max: box.max.map(x => x + pad) }; }
  const skipped = regs.filter(r => { try { return Array.from(FK.exprNames(FK.parseExpr(r.expr))).some(nm => !fns.has(nm)); } catch (e) { return true; } });
  const okRegs = regs.filter(r => !skipped.includes(r));
  R.ov = box && okRegs.length ? FK.checkOverlaps(okRegs, fns, box, { n }) : null;
  // C. alignment
  R.al = chkAlign(bodies, tol); CHK.last = R; CHK.bodies = bodies; CHK.tol = tol;
  const li = (cls, t) => `<li class="${cls}">${t}</li>`;
  rows.push('<b>1. INP ↔ model</b><ul>');
  if (R.eq.missing.length) R.eq.missing.forEach(m => rows.push(li('bad', linkify(m))));
  rows.push(R.eq.ok && !R.eq.missing.length ? li('good', `✔ The generated INP gives the same region membership as the model (${R.eq.regionsChecked} region(s), ${R.eq.points} tests)`) : R.eq.mismatches.length ? li('bad', `✖ ${R.eq.mismatches.length}${R.eq.mismatches.length >= 50 ? '+' : ''} mismatching points, e.g. region ${esc2(R.eq.mismatches[0].region)} at (${R.eq.mismatches[0].point.map(x => x.toFixed(3)).join(', ')}) — model ${R.eq.mismatches[0].model ? 'inside' : 'outside'}, INP ${R.eq.mismatches[0].inp ? 'inside' : 'outside'}`) : '');
  if (R.eq.unsupported.length) rows.push(li('info', `ⓘ Not checked (ARB / unsupported bodies): ${R.eq.unsupported.map(esc2).join(', ')}`));
  rows.push('</ul><b>2. Overlaps and holes</b><ul>');
  if (!R.ov) rows.push(li('info', 'ⓘ Nothing to scan'));
  else {
    const c = R.ov.cell * 10;
    if (!R.ov.overlaps.length) rows.push(li('good', `✔ No overlap between regions (cell ${c.toFixed(2)} mm)`));
    for (const o of R.ov.overlaps.slice(0, 8)) rows.push(li('bad', `✖ ${linkNames([o.a],'region')} ∩ ${linkNames([o.b],'region')}: ≈ ${o.volume.toPrecision(3)} cm³`));
    if (!R.ov.holes.length) rows.push(li('good', '✔ No enclosed hole (undefined space inside the geometry)'));
    for (const h of R.ov.holes.slice(0, 8)) rows.push(li('bad', `✖ Hole ≈ ${h.volume.toPrecision(3)} cm³ around (${h.center.map(x => x.toFixed(2)).join(', ')}) next to ${linkNames(h.around,'region')}`));
    rows.push(li('info', `ⓘ Grid scan: features thinner than ${c.toFixed(2)} mm can be missed — see section 3`));
  }
  if (skipped.length) rows.push(li('info', `ⓘ Not scanned (unsupported bodies): ${skipped.map(r => esc2(r.name)).join(', ')}`));
  const nfix = R.al.filter(a => a.fix).length;
  rows.push('</ul><b>3. Alignment accidents</b>' + (nfix ? ` <button type="button" class="btn sm" data-fix="all" title="Apply every automatic fix, one after the other">Solve all (${nfix})</button>` : '') + '<ul>');
  if (!R.al.length) rows.push(li('good', '✔ Nothing suspicious (near-parallel axes, almost coincident faces, tiny offsets or gaps)'));
  R.al.slice(0, 40).forEach((a, i) => rows.push(li(a.level === 'info' ? 'info' : 'warn', (a.level === 'info' ? 'ⓘ ' : '⚠ ') + linkify(a.text) + (a.fix ? ` <button type="button" class="btn sm" data-fix="${i}" title="${esc2(FIX_HINT[a.fix.type] || 'Fix')}">Solve</button>` : ''))));
  rows.push('</ul>');
  $('#chkRes').innerHTML = rows.join('');
  APP.setCheckMarks(R.ov ? [{ centers: R.ov.overlapCenters, size: R.ov.cell, color: 0xff3030 }, { centers: R.ov.holeCenters, size: R.ov.cell, color: 0xff9900 }] : null);
  return R;
}
(function () {
  const d = $('#dlgChk'); if (!d) return;
  $('#btnInpCheck').onclick = () => { if (!d.open) d.show(); if (typeof d._x === 'number') { d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; } else { d.style.left = 'auto'; d.style.right = '12px'; d.style.top = '64px'; } };
  $('#chkRun').onclick = () => { try { chkRun(); } catch (e) { console.error(e); toast('Check failed: ' + e.message); } };
  $('#chkRes').addEventListener('click', e => { const b = e.target.closest('[data-fix]'); if (b) chkSolve(b.dataset.fix); });
  $('#chkClear').onclick = () => { APP.setCheckMarks(null); };
  d.addEventListener('close', () => APP.setCheckMarks(null));
  d.querySelector('[value=close]').onclick = () => d.close();
  let drag = null; const h = d.querySelector('.fw-h');
  h.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = d.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { h.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  h.addEventListener('pointermove', e => { if (!drag) return; d._x = Math.max(0, e.clientX - drag.dx); d._y = Math.max(0, e.clientY - drag.dy); d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; });
  h.addEventListener('pointerup', () => { drag = null; });
})();
