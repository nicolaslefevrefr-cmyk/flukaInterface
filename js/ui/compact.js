/* ui/compact.js — Compact: merge near-identical coordinate systems / identical INP planes
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Compact: merge near-identical coordinate systems / identical INP planes, one proposal at a time ---------- */
const CMP = { tab: 'cs', items: [], skip: new Set(), cur: -1 };
let openCompact = () => {};
(function () {
  const d = $('#dlgCompact'); if (!d) return;
  const place = () => { if (typeof d._x === 'number') { d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; } else { d.style.left = 'auto'; d.style.right = '12px'; d.style.top = '64px'; } };
  const clearHl = () => { S.hlSet = null; APP.applyStyles(); };
  const reg = (r) => S.model.regions.filter(r2 => r2 === r);
  const regionsUsing = (bodyNames) => S.model.regions.filter(r => { try { const n = FK.exprNames(FK.parseExpr(r.expr || '+x')); return bodyNames.some(b => n.has(b)); } catch (e) { return false; } });
  const inpOf = () => FK.inpNames(S.model).bodies;
  const bodyByInp = (nm) => { const m = inpOf(); return S.model.bodies.find(b => m.get(b) === nm); };
  function analyze() {
    const tolA = Math.max(0, +$('#cmpAng').value || 0), tolD = Math.max(0, +$('#cmpDist').value || 0);
    CMP.items = []; CMP.cur = -1; clearHl();
    if (CMP.tab === 'cs') {
      for (const p of APP.findCsysMerges(tolA, tolD)) {
        const bs = S.model.bodies.filter(b => p.bodies.includes(b.id));
        CMP.items.push({ key: 'cs:' + p.from + '>' + p.to, p, ids: bs.map(b => b.id).concat(regionsUsing(bs.map(b => b.name)).map(r => r.id)),
          html: `<span class="k">${esc(APP.csysLabel(p.from))} → ${esc(APP.csysLabel(p.to))}</span><div class="sub">orientation differs by ${p.deg.toExponential(2)}° · bodies move by at most ${p.shift.toExponential(2)} cm</div><div>${bs.length ? bs.map(b => `<code>${esc(b.name)}</code>`).join(' ') : '<span class="muted">no body</span>'}${p.children.length ? ` · ${p.children.length} child system${p.children.length > 1 ? 's' : ''} kept in place` : ''}</div>` });
      }
      $('#cmpSum').innerHTML = CMP.items.length ? `${CMP.items.length} merge${CMP.items.length > 1 ? 's' : ''} proposed. Click a line to see the objects concerned, then Accept or Skip it.` : '<span class="good">No coordinate systems to merge with these tolerances.</span>';
    } else {
      const opts = { style: S.opt.style, resolve: APP.xbody }, view = FK.inpView(S.model);
      const done = new Set((S.model.merges || []).map(m => m.drop));
      const act = FK.activeMerges(view, opts).act;
      const groups = FK.findPlaneMerges(Object.assign({}, view, { merges: [] }), opts, tolA, tolD);
      for (const g of groups) {
        const drops = g.drops.filter(x => !act.has(x.name));
        if (!drops.length) continue;
        const owners = [g.keep.owner].concat(drops.map(x => x.owner)), bs = owners.map(bodyByInp).filter(Boolean);
        CMP.items.push({ key: 'pl:' + g.keep.name + ':' + drops.map(x => x.name).join(','), g, drops, tolA, tolD, ids: [...new Set(bs.map(b => b.id))].concat(regionsUsing(bs.map(b => b.name)).map(r => r.id)),
          html: `<span class="k">${drops.length + 1} identical planes → <code>${esc(g.keep.name)}</code></span> <small class="muted">${g.keep.auto ? 'generated' : 'defined by you'}</small><div class="sub">${drops.map(x => `<code>${esc(x.name)}</code>${x.sign < 0 ? ' (opposite side: sign flipped)' : ''} · Δ ${x.dd.toExponential(1)} cm, ${(x.dn * 180 / Math.PI).toExponential(1)}°`).join('<br>')}</div><div class="sub">objects: ${[...new Set(bs.map(b => b.name))].map(n => `<code>${esc(n)}</code>`).join(' ') || '—'}</div>` });
      }
      const nAct = (S.model.merges || []).length;
      $('#cmpSum').innerHTML = (CMP.items.length ? `${CMP.items.length} group${CMP.items.length > 1 ? 's' : ''} of identical planes. Accepting one removes the duplicates from the exported INP and rewrites the regions.` : '<span class="good">No identical planes with these tolerances.</span>') + (nAct ? ` <span class="muted">${nAct} merge${nAct > 1 ? 's' : ''} already accepted (<a href="#" id="cmpShowAcc">list</a>).</span>` : '');
      void done;
    }
    render();
  }
  function render() {
    const list = CMP.items.filter(it => !CMP.skip.has(it.key));
    $('#cmpHelp').textContent = CMP.tab === 'cs' ? 'Coordinate systems with (almost) the same orientation are replaced by one of them; the bodies and the child systems that depend on them are recomputed.' : 'Planes of the generated INP that coincide (also with the opposite orientation) are written once; the regions are adapted. Nothing is changed in your objects.' + (S.opt.inpTransform ? ' Transform mode is on: rotated boxes are not cut by planes any more, only your own planes can be merged.' : '');
    $('#cmpList').innerHTML = (list.length ? `<div class="dlgBtns" style="justify-content:flex-start"><button type="button" class="pill primary" data-ca="all">Accept all (${list.length})</button><button type="button" class="pill" data-ca="unskip" ${CMP.skip.size ? '' : 'disabled'}>Restore skipped (${CMP.skip.size})</button></div>` : '') +
      list.map((it, i) => `<div class="cmpi ${CMP.cur === i ? 'on' : ''}" data-i="${i}">${it.html}<div class="acts"><button type="button" class="pill primary" data-ca="ok" data-i="${i}">Accept</button><button type="button" class="pill" data-ca="skip" data-i="${i}">Skip</button></div></div>`).join('');
  }
  const visible = () => CMP.items.filter(it => !CMP.skip.has(it.key));
  function focusItem(i) {
    CMP.cur = i; const it = visible()[i]; S.hlSet = it ? new Set(it.ids) : null; APP.applyStyles(); render();
  }
  function accept(it) {
    if (CMP.tab === 'cs') return APP.applyCsysMerge(it.p);
    for (const x of it.drops) APP.addPlaneMerge(it.g.keep.name, x.name, x.sign, Math.max(it.tolA, x.dn) * 1.01 + 1e-12, Math.max(it.tolD, x.dd) * 1.01 + 1e-12);
    return true;
  }
  $('#cmpList').addEventListener('click', (e) => {
    if (e.target.id === 'cmpShowAcc') { e.preventDefault(); const m = S.model.merges || []; $('#cmpList').innerHTML = `<div class="sub">Accepted plane merges</div>` + m.map((x, i) => `<div class="cmpi"><code>${esc(x.drop)}</code> → <code>${esc(x.keep)}</code>${x.sign < 0 ? ' (flipped)' : ''}<div class="acts"><button type="button" class="pill" data-ca="rm" data-i="${i}">Cancel this merge</button></div></div>`).join('') + '<div class="dlgBtns" style="justify-content:flex-start"><button type="button" class="pill" data-ca="back">Back</button></div>'; return; }
    const b = e.target.closest('[data-ca]'), card = e.target.closest('.cmpi');
    if (!b) { if (card) focusItem(+card.dataset.i); return; }
    const a = b.dataset.ca, vis = visible();
    if (a === 'ok') { const it = vis[+b.dataset.i]; if (it && accept(it)) { toast('Merged'); clearHl(); analyze(); } }
    else if (a === 'skip') { const it = vis[+b.dataset.i]; if (it) { CMP.skip.add(it.key); clearHl(); CMP.cur = -1; render(); } }
    else if (a === 'unskip') { CMP.skip.clear(); render(); }
    else if (a === 'all') { let n = 0; for (const it of vis) { if (CMP.tab === 'cs' && !APP.getCsys(it.p.from)) continue; if (accept(it)) n++; } toast(`${n} merge${n > 1 ? 's' : ''} accepted`); clearHl(); analyze(); }
    else if (a === 'rm') { APP.removePlaneMerge(+b.dataset.i); analyze(); }
    else if (a === 'back') analyze();
  });
  d.querySelectorAll('[data-cmp]').forEach(btn => btn.onclick = () => { CMP.tab = btn.dataset.cmp; d.querySelectorAll('[data-cmp]').forEach(x => x.classList.toggle('on', x === btn)); CMP.skip.clear(); analyze(); });
  $('#cmpRun').onclick = () => { CMP.skip.clear(); analyze(); };
  d.querySelector('[value=close]').onclick = () => d.close();
  d.addEventListener('close', clearHl);
  openCompact = (tab) => { if (tab) { CMP.tab = tab; d.querySelectorAll('[data-cmp]').forEach(x => x.classList.toggle('on', x.dataset.cmp === tab)); } if (!d.open) d.show(); place(); analyze(); };
  const hh = d.querySelector('.fw-h'); let drag = null;
  hh.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = d.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { hh.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  hh.addEventListener('pointermove', e => { if (!drag) return; d._x = Math.max(0, e.clientX - drag.dx); d._y = Math.max(0, e.clientY - drag.dy); d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; });
  hh.addEventListener('pointerup', () => { drag = null; });
  const rs = d.querySelector('.fw-rs'); let rz = null;
  rs.addEventListener('pointerdown', e => { const r = d.getBoundingClientRect(); rz = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }; try { rs.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  rs.addEventListener('pointermove', e => { if (!rz) return; d.style.width = Math.round(Math.min(window.innerWidth - 20, Math.max(340, rz.w + e.clientX - rz.x))) + 'px'; d.style.height = Math.round(Math.min(window.innerHeight - 70, Math.max(300, rz.h + e.clientY - rz.y))) + 'px'; });
  rs.addEventListener('pointerup', () => { rz = null; });
  void reg;
})();
