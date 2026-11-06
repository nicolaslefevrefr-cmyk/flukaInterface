/* ui/tree.js — Left panel: project tree and context menus
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Left panel: project tree ---------- */
function itemHTML(t, o, ex) {
  ex = ex || {};
  const sel = (S.sel && S.sel.t === t && S.sel.id === o.id) || isMulti(t, o.id);
  const warn = ex.warn && ex.warn.length ? `<span class="wicon" tabindex="0" title="${esc(ex.warn.join('\n'))}">⚠${ex.warn.length > 1 ? ex.warn.length : ''}</span>` : '';
  const info = ex.info ? `<span class="wicon info" tabindex="0" title="${esc(ex.info)}">ⓘ</span>` : '';
  const look = ex.look !== undefined ? `<button class="lk${ex.look ? ' on' : ''}" data-act="look" title="${ex.look === 'opaque' ? 'Always opaque (click: always transparent)' : ex.look === 'transparent' ? 'Always transparent (click: follow the global mode)' : 'Follows the global mode (click: always opaque)'}">${ex.look === 'opaque' ? '●' : ex.look === 'transparent' ? '○' : '◐'}</button>` : '';
  return `<div class="item${sel ? ' sel' : ''}${ex.ne ? ' ne' : ''}" data-t="${t}" data-id="${o.id}" draggable="true">
    <div class="top">${ex.novis ? '<span class="chev"></span>' : `<button class="vis${o.visible ? '' : ' off'}" data-act="vis" title="Show / hide">${o.visible ? ICON.eye : ICON.eyeOff}</button>`}
    ${o.color ? `<span class="sw" style="background:${o.color}"></span>` : ''}<span class="nm">${esc(o.name)}${ex.inp ? ` <span class="inpn" title="Name written in the INP file">(${esc(ex.inp)})</span>` : ''}</span>${warn}${info}<span class="ty">${ex.ne ? '<span title="Not exported to the INP">⊘ </span>' : ''}${esc(o.type)}</span>${look}<button class="mn" data-act="imenu" title="Actions">⋮</button></div>
    </div>`;
}
/** Warnings shown next to a region in the tree (empty, quality check). */
function regionWarns(r) {
  const c = APP.regionCache && APP.regionCache.get(r.id), w = [];
  if (c && c.diag && c.diag.length) w.push('Empty: ' + brief(String(c.diag[0].text)));
  if (c && c.quality) for (const q of c.quality) w.push(q.text);
  if (c && c.err) w.push(c.err);
  if (S.model.materials && !r.noExport && !APP.getMaterial(r.mat)) w.push('No material assigned');
  return w;
}
let UNUSED = new Set(), INPN = { bodies: new Map(), regions: new Map() };
let TF = '';                                   // tree filter (transient)
const fl = (list) => TF ? list.filter(o => String(o.name || '').toLowerCase().includes(TF)) : list;
const treeState = () => S.opt.tree || (S.opt.tree = {});
const isOpen = (k) => treeState()[k] !== false;
const GROUPS_DEF = [
  { k: 'meshes', title: 'Meshes (STL / OBJ)', items: () => S.stls },
  { k: 'comps', title: 'Components', items: () => S.model.components || [] },
  { k: 'csys', title: 'Coordinate systems', items: () => S.model.csys },
  { k: 'planes', title: 'Planes', items: () => S.model.bodies.filter(b => FK.isPlaneType(b.type)) },
  { k: 'bodies', title: 'Bodies', items: () => S.model.bodies.filter(b => !FK.isPlaneType(b.type)) },
  { k: 'regions', title: 'Regions', items: () => S.model.regions },
  { k: 'materials', title: 'Materials', items: () => S.model.materials || [] },
  { k: 'measures', title: 'Measures', items: () => S.measures }
];
/** Coordinate systems of `list` as a tree; a parent outside the list counts as "root" inside it. */
function csysTree(list, pid, depth) {
  const act = S.model.active || 0, inL = new Set(list.map(c => c.id));
  return list.filter(c => (inL.has(c.parent) ? c.parent : 0) === pid).map(c => {
    const sel = (S.sel && S.sel.t === 'csys' && S.sel.id === c.id) || isMulti('csys', c.id), isA = act === c.id;
    const kids = list.filter(x => x.parent === c.id).length, open = treeState()['cs' + c.id] !== false;
    return `<div class="item cs${sel ? ' sel' : ''}${isA ? ' act' : ''}" data-t="csys" data-id="${c.id}" draggable="true"><div class="top" style="--d:${depth * 14}px">
      ${kids ? `<button class="chev" data-act="fold" data-k="cs${c.id}">${open ? '−' : '+'}</button>` : '<span class="chev"></span>'}
      <button class="vis${c.visible ? '' : ' off'}" data-act="vis" title="Show / hide">${c.visible ? ICON.eye : ICON.eyeOff}</button>
      <button class="rad${isA ? ' on' : ''}" data-act="activate" data-cid="${c.id}" title="Set as active coordinate system" aria-label="Active">${isA ? '●' : '○'}</button>
      <span class="sw" style="background:${c.color}"></span><span class="nm">${esc(c.name)}</span><span class="ty">${APP.exportCs() === c.id ? '⇥ export ' : ''}${c.frozen ? '🔒 ' : ''}${c.parent ? '↳ ' + esc(APP.csysLabel(c.parent)) : ''}</span><button class="mn" data-act="imenu" title="Actions">⋮</button></div></div>` +
      (kids && open ? csysTree(list, c.id, depth + 1) : '');
  }).join('');
}
function rowHTML(k, o) {
  switch (k) {
    case 'meshes': return itemHTML('stl', { id: o.id, name: o.name, type: o.format || 'STL', color: o.color, visible: o.visible, opacity: o.opacity }, { look: o.look || '' });
    case 'planes': case 'bodies': return itemHTML('body', { id: o.id, name: o.name, type: o.type === 'RAW' ? o.rawType : o.type, color: o.color, visible: o.visible, opacity: o.type === 'RAW' ? undefined : o.opacity },
      { ne: !!o.noExport, look: o.type === 'RAW' ? undefined : (o.look || ''), info: !o.noExport && UNUSED.has(o.id) ? 'Not used by any exported region' : '', inp: !o.noExport && S.opt.showInpName !== false ? INPN.bodies.get(o) : '' });
    case 'regions': return itemHTML('region', { id: o.id, name: o.name, type: 'REGION', color: o.color, visible: o.visible, opacity: o.opacity }, { ne: !!o.noExport, inp: !o.noExport && S.opt.showInpName !== false ? INPN.regions.get(o) : '', look: o.look || '', warn: o.noExport ? [] : regionWarns(o), info: o.meta && o.meta.link ? 'Strong link (formula follows its parent regions)' : '' });
    case 'materials': return itemHTML('material', { id: o.id, name: o.name, type: APP.regionsOfMaterial(o.id).length + ' reg.', visible: true }, { novis: true });
    case 'comps': return itemHTML('comp', { id: o.id, name: o.name, type: (FK.TEMPLATES[o.tpl] || {}).prefix || 'comp', color: '#7a5af8', visible: o.visible !== false }, { warn: o.error ? [o.error] : [] });
    case 'measures': return itemHTML('measure', { id: o.id, name: `M${S.measures.indexOf(o) + 1} · ${f(V.dist(o.a, o.b), 3)} cm`, type: 'DIST', visible: o.visible });
  }
  return '';
}
const rowsOf = (k, list) => k === 'csys' ? csysTree(list, 0, 0) : list.map(o => rowHTML(k, o)).join('');
function groupRowHTML(gr, members) {
  const open = gr.open !== false, anyVis = members.some(o => o.visible);
  const name = S.renG === gr.id ? `<input class="gname" data-gid="${gr.id}" value="${esc(gr.name)}" maxlength="40">` : `<span class="nm">${esc(gr.name)}</span>`;
  return `<div class="grow" data-gid="${gr.id}" data-k="${gr.k}"><button class="chev" data-act="gfold" data-gid="${gr.id}" aria-label="Expand / collapse">${open ? '−' : '+'}</button>` +
    `<button class="vis${anyVis ? '' : ' off'}" data-act="grpvis" data-gid="${gr.id}" title="Show / hide the whole group">${anyVis ? ICON.eye : ICON.eyeOff}</button>` +
    `<span class="gi" aria-hidden="true">▣</span>${name}<span class="cnt">${members.length}</span><button class="mn" data-act="grpmenu" data-gid="${gr.id}" title="Group actions">⋮</button></div>`;
}
function catBody(g) {
  const k = g.k, all = fl(g.items()), groups = APP.groups().filter(x => x.k === k);
  let h = '';
  if (k === 'csys' && !TF) {
    const a0 = S.model.active || 0;
    h += `<div class="item cs g${a0 === 0 ? ' act' : ''}"><div class="top"><span class="chev"></span><button class="rad${a0 === 0 ? ' on' : ''}" data-act="activate" data-cid="0" title="Global frame (default)" aria-label="Global">${a0 === 0 ? '●' : '○'}</button><span class="nm">Global (0, 0, 0)</span><span class="ty">default</span></div></div>`;
  }
  for (const gr of groups) {
    const members = all.filter(o => o.grp === gr.id);
    if (TF && !members.length) continue;
    h += groupRowHTML(gr, members);
    if (TF || gr.open !== false) h += `<div class="gb" data-gid="${gr.id}" data-k="${k}">${rowsOf(k, members) || '<div class="empty">Drag items here</div>'}</div>`;
  }
  return h + rowsOf(k, all.filter(o => !groups.some(x => x.id === o.grp)));
}
function renderLeft() {
  UNUSED = new Set(APP.unusedBodies().map(b => b.id)); INPN = FK.inpNames(S.model);
  let h = `<div class="tree">`;
  for (const g of GROUPS_DEF) {
    const list = fl(g.items()), open = TF ? true : isOpen(g.k), anyVis = list.some(o => o.visible);
    if (TF && !list.length) continue;
    h += `<div class="tg" data-k="${g.k}"><div class="th" data-g="${g.k}"><button class="chev" data-act="fold" data-k="${g.k}" aria-label="Expand / collapse">${open ? '−' : '+'}</button><span class="tt">${g.title}</span><span class="cnt">${list.length}</span>` +
      (g.k !== 'materials' && (g.k !== 'csys' && g.k !== 'measures' || list.length) ? `<button class="vis${anyVis ? '' : ' off'}" data-act="gvis" data-g="${g.k}" title="Show / hide all">${anyVis ? ICON.eye : ICON.eyeOff}</button>` : '') +
      `<button class="mn" data-act="gmenu" data-g="${g.k}" title="Create / actions (or right-click)">＋</button></div>`;
    if (open) h += `<div class="tb">${catBody(g) || '<div class="empty">(empty)</div>'}</div>`;
    h += '</div>';
  }
  if (TF && h === '<div class="tree">') h += '<div class="empty">No object matches this filter.</div>';
  h += '</div>';
  $('#leftBody').innerHTML = h;
  const gi = $('#leftBody .gname'); if (gi) { gi.focus(); gi.select(); }
  syncToolbar();
}

function selectItem(t, id) {
  S.sel = { t, id };
  APP.changed({ tree: true, right: true });
  if (narrow()) { setDrawer('left', false); setDrawer('right', true); }
}
/** New coordinate system: created with an editable definition and its Definition tab opened. */
function newCsysEditable(parentWorldOf, parent) {
  const c = APP.createCsysWorld(APP.csysWorld(parentWorldOf), parent !== undefined ? { parent } : undefined); if (!c) return;
  c.def = APP.csDefNew(c); S.rtab = 'definition'; selectItem('csys', c.id);
}
function groupItems(k) { const g = GROUPS_DEF.find(x => x.k === k); return g ? g.items() : []; }
function setGroupVis(k, on) { APP.snap(); groupItems(k).forEach(o => { o.visible = on; }); APP.changed({ tree: true, csys: k === 'csys', measures: k === 'measures' }); }

/* ---- context menus ---- */
const ctxEl = document.createElement('div'); ctxEl.id = 'ctxmenu'; ctxEl.hidden = true; document.body.appendChild(ctxEl);
let ctxItems = [];
const subEl = document.createElement('div'); subEl.id = 'ctxmenu'; subEl.className = 'ctxsub'; subEl.removeAttribute('id'); subEl.hidden = true; document.body.appendChild(subEl);
let subItems = [];
function hideSub() { subEl.hidden = true; }
function hideMenu() { ctxEl.hidden = true; hideSub(); }
/** One menu entry: { label, fn, sub, icon (html), checked, danger } · { sep } · { head }. */
function mItem(it, i) {
  if (it.sep) return '<hr>';
  if (it.head) return `<div class="mh">${esc(it.head)}</div>`;
  const ic = it.icon !== undefined || it.checked !== undefined;
  return `<button data-i="${i}" class="${[it.danger ? 'danger' : '', it.sub ? 'hassub' : '', ic ? 'ic' : '', it.checked ? 'on' : ''].join(' ').trim()}">${it.icon !== undefined ? `<span class="mi">${it.icon}</span>` : ic ? '<span class="mi"></span>' : ''}${esc(it.label)}${it.checked ? '<span class="ck">✓</span>' : ''}${it.sub ? '<span class="sa">▸</span>' : ''}</button>`;
}
function openSub(btn, items) {
  subItems = items;
  subEl.innerHTML = items.map(mItem).join('');
  subEl.hidden = false;
  const r = btn.getBoundingClientRect(), w = subEl.offsetWidth || 200, h = subEl.offsetHeight || 100;
  subEl.style.left = (r.right + w + 8 < window.innerWidth ? r.right - 2 : Math.max(4, r.left - w + 2)) + 'px';
  subEl.style.top = Math.max(4, Math.min(r.top - 4, window.innerHeight - h - 6)) + 'px';
}
subEl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const it = subItems[+b.dataset.i]; hideMenu(); if (it && it.fn) it.fn(); });
function showMenu(x, y, items) {
  ctxItems = items;
  hideSub();
  ctxEl.innerHTML = items.map(mItem).join('');
  ctxEl.hidden = false;
  const w = ctxEl.offsetWidth || 200, h = ctxEl.offsetHeight || 200;
  ctxEl.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 6)) + 'px';
  ctxEl.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 6)) + 'px';
}
ctxEl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const it = ctxItems[+b.dataset.i]; if (it && it.sub) { openSub(b, it.sub); return; } hideMenu(); if (it && it.fn) it.fn(); });
ctxEl.addEventListener('mouseover', e => { const b = e.target.closest('button'); if (!b) return; const it = ctxItems[+b.dataset.i]; if (it && it.sub) openSub(b, it.sub); else hideSub(); });
document.addEventListener('pointerdown', e => { if (!ctxEl.hidden && !ctxEl.contains(e.target) && !subEl.contains(e.target)) hideMenu(); }, true);
const newBody = (type) => { APP.snap(); const b = APP.addBody(type); S.sel = { t: 'body', id: b.id }; APP.changed({ tree: true, right: true }); return b; };
const visItems = (k) => [{ sep: 1 }, { label: 'Show all', fn: () => setGroupVis(k, true) }, { label: 'Hide all', fn: () => setGroupVis(k, false) }];
