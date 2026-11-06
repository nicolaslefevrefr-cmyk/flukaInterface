/* ui/diagram.js — Dependency diagram
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Dependency diagram (experimental) ---------- */
const GR = { x: 20, y: 20, k: 1, tm: 0, fit: true, hover: null };
const grOpt = () => Object.assign({ scope: 'all', planes: true, cad: false, noexp: true }, S.opt.graph || {});
const grSelId = () => !S.sel ? null : S.sel.t === 'body' ? 'b' + S.sel.id : S.sel.t === 'region' ? 'r' + S.sel.id : S.sel.t === 'stl' ? 'm' + S.sel.id : null;
function grData() {
  const o = grOpt();
  let g = FK.depGraph(S.model, { planes: o.planes, cad: o.cad ? S.stls.map(m => ({ id: m.id, name: m.name, color: m.color })) : null, cadOf: (it, k) => APP.cadId(it, k) });
  const keepIf = (keep) => { g = { nodes: g.nodes.filter(n => keep.has(n.id)), edges: g.edges.filter(e => keep.has(e.from) && keep.has(e.to)) }; };
  if (!o.noexp) keepIf(new Set(g.nodes.filter(n => !n.noExport).map(n => n.id)));
  const sel = grSelId();
  if (o.scope !== 'all' && sel && g.nodes.some(n => n.id === sel)) keepIf(FK.depScope(g, [sel], o.scope));
  return g;
}
const EDGE_COL = { 1: '#16a34a', '-1': '#dc2626', 0: '#9333ea' };
const NW = 168, NH = 34;
function grLayout(g) { return FK.layoutDepGraph(g, { colW: 250, rowH: 46 }); }
function grDraw(refit) {
  const d = $('#dlgGraph'); if (!d || !d.open) return;
  const g = grData(), L = grLayout(g), sel = grSelId(), svg = $('#grSvg');
  GR.g = g; GR.L = L;
  let h = '<defs>' + [['u1', '#16a34a'], ['u-1', '#dc2626'], ['u0', '#9333ea'], ['lk', '#1d4ed8'], ['dv', '#6b7280'], ['cd', '#64748b']].map(([id, c]) => `<marker id="ar${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="${c}"/></marker>`).join('') + '</defs><g id="grPan">';
  for (const e of g.edges) {
    const a = L.pos.get(e.from), b = L.pos.get(e.to), x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(30, (x2 - x1) / 2);
    const st = e.kind === 'use' ? { c: EDGE_COL[e.sign], m: 'u' + e.sign, w: 1.6, d: '' } : e.kind === 'link' ? { c: '#1d4ed8', m: 'lk', w: 2.6, d: '' } : e.kind === 'derived' ? { c: '#6b7280', m: 'dv', w: 1.6, d: '6 4' } : { c: '#64748b', m: 'cd', w: 1.4, d: '2 4' };
    h += `<g class="ge" data-f="${e.from}" data-t="${e.to}"><path d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}" fill="none" stroke="${st.c}" stroke-width="${st.w}" ${st.d ? `stroke-dasharray="${st.d}"` : ''} marker-end="url(#ar${st.m})"/>`
      + (e.role ? `<text x="${x2 - 14}" y="${y2 - 5}" class="gel" fill="${st.c}" text-anchor="end">${e.role}${e.op ? ' ' + (e.op === 'sub' ? '−' : e.op === 'int' ? '∩' : '∪') : ''}</text>` : '') + '</g>';
  }
  for (const n of g.nodes) {
    const p = L.pos.get(n.id), cls = ['gn', n.kind, n.id === sel ? 'sel' : '', n.noExport ? 'ne' : '', n.unused ? 'un' : ''].join(' ');
    const r = n.kind === 'region' ? S.model.regions.find(x => x.id === n.ref.id) : null, lk = r && r.meta && r.meta.link;
    const sub = lk ? esc((APP.getRegion(lk.a) || { name: '?' }).name) + APP.linkOps(lk).map(o => ` ${o.op === 'sub' ? '−' : o.op === 'int' ? '∩' : '∪'} ${esc((APP.getRegion(o.id) || { name: '?' }).name)}`).join('') : n.type;
    const tip = n.kind === 'region' ? `${n.name}: ${n.expr}` : `${n.name} (${n.type})`;
    h += `<g class="${cls}" data-id="${n.id}" transform="translate(${p.x} ${p.y})"><title>${esc(tip)}${n.unused ? ' — not used by any exported region' : ''}${n.noExport ? ' — not exported' : ''}</title>
      <rect width="${NW}" height="${NH}" rx="${n.kind === 'region' ? 8 : n.kind === 'cad' ? 3 : 14}" class="gr"/><rect width="6" height="${NH}" rx="3" fill="${esc(n.color || '#888')}"/>
      <text x="14" y="14" class="gt">${esc(n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name)}</text><text x="14" y="27" class="gs">${sub}${n.unused ? ' · unused' : ''}</text></g>`;
  }
  svg.innerHTML = h + '</g>';
  if (refit || GR.fit) { grFit(); GR.fit = false; } else grApplyView();
  $('#grView').dataset.empty = g.nodes.length ? '' : 'Nothing to show';
}
function grApplyView() { const p = $('#grPan'); if (p) p.setAttribute('transform', `translate(${GR.x} ${GR.y}) scale(${GR.k})`); }
function grFit() {
  const L = GR.L, box = $('#grView').getBoundingClientRect(); if (!L || !box.width) return;
  const w = L.w + NW + 40, h = L.h + NH + 40, k = Math.min(1.4, box.width / w, box.height / h);
  GR.k = k; GR.x = (box.width - (L.w + NW) * k) / 2; GR.y = (box.height - (L.h + NH) * k) / 2; grApplyView();
}
function grSchedule() { clearTimeout(GR.tm); GR.tm = setTimeout(() => grDraw(false), 80); }
function grHover(id) {
  const svg = $('#grSvg'); if (!svg) return;
  const near = new Set(id ? [id] : []); if (id) for (const e of GR.g.edges) { if (e.from === id) near.add(e.to); if (e.to === id) near.add(e.from); }
  svg.classList.toggle('hov', !!id);
  svg.querySelectorAll('.gn').forEach(n => n.classList.toggle('near', near.has(n.dataset.id)));
  svg.querySelectorAll('.ge').forEach(e => e.classList.toggle('near', !!id && (e.dataset.f === id || e.dataset.t === id)));
}
function grSelect(id) {
  const n = GR.g.nodes.find(x => x.id === id); if (!n) return;
  S.sel = { t: n.ref.t, id: n.ref.id }; APP.changed({ tree: true, right: true });
  if (!narrow() && !dL.classList.contains('open')) setDrawer('left', true);
  setTimeout(() => { const it = $('#leftBody .item.sel'); if (it && it.scrollIntoView) it.scrollIntoView({ block: 'nearest' }); }, 90);
}
(function () {
  const d = $('#dlgGraph'); if (!d) return;
  d.querySelector('[value=close]').onclick = () => d.close();
  let drag = null; const hh = d.querySelector('.fw-h');
  hh.addEventListener('pointerdown', e => { if (e.target.closest('button') || d.classList.contains('docked')) return; const r = d.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { hh.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  hh.addEventListener('pointermove', e => { if (!drag) return; d._x = Math.max(0, e.clientX - drag.dx); d._y = Math.max(0, e.clientY - drag.dy); d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; });
  hh.addEventListener('pointerup', () => { drag = null; });
  const view = $('#grView');
  let pan = null;
  view.addEventListener('pointerdown', e => { if (e.target.closest('.gn')) return; pan = { x: e.clientX - GR.x, y: e.clientY - GR.y }; try { view.setPointerCapture(e.pointerId); } catch (_) {} });
  view.addEventListener('pointermove', e => { if (pan) { GR.x = e.clientX - pan.x; GR.y = e.clientY - pan.y; grApplyView(); } });
  view.addEventListener('pointerup', () => { pan = null; });
  view.addEventListener('wheel', e => { e.preventDefault(); const r = view.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k2 = Math.min(4, Math.max(0.15, GR.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); GR.x = mx - (mx - GR.x) * k2 / GR.k; GR.y = my - (my - GR.y) * k2 / GR.k; GR.k = k2; grApplyView(); }, { passive: false });
  view.addEventListener('click', e => { const n = e.target.closest('.gn'); if (n) grSelect(n.dataset.id); });
  view.addEventListener('mouseover', e => { const n = e.target.closest('.gn'); grHover(n ? n.dataset.id : null); });
  view.addEventListener('mouseleave', () => grHover(null));
  const o = grOpt(); $('#grScope').value = o.scope; $('#grPlanes').checked = o.planes; $('#grCad').checked = o.cad; $('#grNoExp').checked = o.noexp;
  const upd = () => { S.opt.graph = { scope: $('#grScope').value, planes: $('#grPlanes').checked, cad: $('#grCad').checked, noexp: $('#grNoExp').checked }; APP.save(); grDraw(true); };
  ['grScope', 'grPlanes', 'grCad', 'grNoExp'].forEach(id => $('#' + id).addEventListener('change', upd));
  $('#grFit').onclick = () => grFit();
  d.addEventListener('close', () => { syncToolbar(); });
  if (window.ResizeObserver) { let lw = 0, lh = 0; new ResizeObserver(() => { const r = view.getBoundingClientRect(); if (d.open && r.width && (Math.abs(r.width - lw) > 8 || Math.abs(r.height - lh) > 8)) { lw = r.width; lh = r.height; grFit(); } }).observe(view); }   // keep the diagram in view when its window is resized or docked
  $('#btnGraph').onclick = () => { if (d.open) { d.close(); return; } d.show(); if (typeof d._x === 'number') { d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; } else { d.style.left = 'auto'; d.style.right = '12px'; d.style.top = '64px'; } GR.fit = true; syncToolbar(); requestAnimationFrame(() => grDraw(true)); };
})();
