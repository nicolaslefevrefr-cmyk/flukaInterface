/* ui/multiselect.js — Multi-selection in the tree and INP renaming
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Multi-selection in the tree (Ctrl / ⌘ + click: toggle · Shift + click: range · same category only) ---------- */
const mkey = (t, id) => t + ':' + id;
const isMulti = (t, id) => { const m = S.multi; return !!(m && m.keys.size > 1 && S.sel && m.keys.has(mkey(S.sel.t, S.sel.id)) && m.keys.has(mkey(t, id))); };
/** The valid multi-selection as [{ t, o }] (2 items or more) or null. */
function multiList() {
  const m = S.multi; if (!m || m.keys.size < 2 || !S.sel || !m.keys.has(mkey(S.sel.t, S.sel.id))) return null;
  const out = []; for (const k of m.keys) { const [t, id] = k.split(':'), o = findItem(t, +id); if (o) out.push({ t, o }); }
  return out.length > 1 ? out : null;
}
function treeMultiClick(item, e) {
  const t = item.dataset.t, id = +item.dataset.id, o = findItem(t, id); if (!o) return;
  const cat = APP.catOf(t, o), cur = S.sel && findItem(S.sel.t, S.sel.id), curCat = cur ? APP.catOf(S.sel.t, cur) : null;
  let keys = S.multi && S.multi.keys.size > 1 && S.sel && S.multi.keys.has(mkey(S.sel.t, S.sel.id)) ? new Set(S.multi.keys) : (cur && curCat === cat ? new Set([mkey(S.sel.t, S.sel.id)]) : new Set());
  if (curCat && curCat !== cat) { toast('Only items of the same category can be selected together'); return; }
  if (e.shiftKey && cur && curCat === cat) {
    const tg = item.closest('.tg'), rows = [...tg.querySelectorAll('.item[data-t]')], a = rows.findIndex(r => r.dataset.t === S.sel.t && +r.dataset.id === S.sel.id), b = rows.indexOf(item);
    if (a >= 0 && b >= 0) { keys = new Set(); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) keys.add(mkey(rows[i].dataset.t, +rows[i].dataset.id)); }
    S.multi = { keys }; if (!keys.has(mkey(S.sel.t, S.sel.id))) S.sel = { t, id };
  } else {
    const k = mkey(t, id);
    if (keys.has(k)) { keys.delete(k); if (S.sel && mkey(S.sel.t, S.sel.id) === k) { const f = [...keys][0]; if (f) { const [ft, fid] = f.split(':'); S.sel = { t: ft, id: +fid }; } } }
    else { keys.add(k); S.sel = { t, id }; }
    S.multi = keys.size > 1 ? { keys } : null;
    if (keys.size === 1) { const [ft, fid] = [...keys][0].split(':'); S.sel = { t: ft, id: +fid }; }
  }
  APP.changed({ tree: true, right: true });
}
function deleteMany(list) {
  APP.deleteItems(list); S.multi = null;
}
/** Export / do not export a list of [{ t, o }] bodies and regions; asks when other regions would lose a body. */
async function setExportMany(list, on) {
  const its = list.filter(x => x.t === 'body' || x.t === 'region'); if (!its.length) return;
  if (on) { APP.snap(); its.forEach(x => { delete x.o.noExport; }); APP.changed({ tree: true, right: true }); return; }
  const inSel = new Set(its.map(x => x.o)), imp = [], seen = new Set();
  for (const x of its) if (x.t === 'body') for (const i of APP.exportImpact('body', x.o)) if (!i.item.noExport && !inSel.has(i.item) && !seen.has(i.item)) { seen.add(i.item); imp.push(i); }
  let all = false;
  if (imp.length) { const res = await askImpact('body', its.length === 1 ? its[0].o : { name: its.length + ' objects' }, imp); if (res === 'cancel') return; all = res === 'all'; }
  APP.snap(); its.forEach(x => { x.o.noExport = true; }); if (all) imp.forEach(i => { i.item.noExport = true; });
  APP.changed({ tree: true, right: true });
}
const catLabel = { meshes: 'meshes', comps: 'components', csys: 'coordinate systems', planes: 'planes', bodies: 'bodies', regions: 'regions', materials: 'materials', measures: 'measures' };
function multiPanel(list) {
  const cat = APP.catOf(list[0].t, list[0].o), exp = cat === 'planes' || cat === 'bodies' || cat === 'regions';
  return `<div class="sec"><h4><span>${list.length} ${catLabel[cat] || 'items'} selected</span></h4>
    <div class="muted" style="font-size:12.5px">Ctrl / ⌘ + click toggles an item, Shift + click selects a range. Drag them onto a group in the tree, or use the actions (also in the right-click menu).</div>
    <div class="btns"><button class="btn" data-act="mShow">Show</button><button class="btn" data-act="mHide">Hide</button>
    ${exp ? `<button class="btn" data-act="mExp">Export to the INP file</button><button class="btn" data-act="mNoExp">Do not export</button><button class="btn" data-act="mRename" title="Prefix + number for the names written in the INP file">Rename INP names…</button>` : ''}</div>
    <div class="muted" style="font-size:12px;margin-top:6px;word-break:break-word">${list.map(x => esc(x.o.name)).join(' · ')}</div>
    <div class="btns opsdel"><button class="btn danger" data-act="mDel">Delete ${list.length} items</button></div></div>`;
}
function multiAct(act) {
  const ml = multiList(); if (!ml) return;
  const vis = (on) => { APP.snap(); ml.forEach(x => { x.o.visible = on; }); APP.changed({ tree: true, right: true, csys: ml[0].t === 'csys', measures: ml[0].t === 'measure' }); };
  if (act === 'mShow') vis(true); else if (act === 'mHide') vis(false);
  else if (act === 'mExp') setExportMany(ml, true); else if (act === 'mNoExp') setExportMany(ml, false);
  else if (act === 'mRename') openInpRename(ml); else if (act === 'mDel') deleteMany(ml);
}
function multiMenu(ml) {
  const cat = APP.catOf(ml[0].t, ml[0].o), exp = cat === 'planes' || cat === 'bodies' || cat === 'regions', n = ml.length;
  const m = [{ label: `Show (${n})`, fn: () => multiAct('mShow') }, { label: `Hide (${n})`, fn: () => multiAct('mHide') }];
  if (exp) m.push({ sep: 1 }, { label: 'Export to the INP file', fn: () => setExportMany(ml, true) }, { label: 'Do not export to the INP file', fn: () => setExportMany(ml, false) }, { label: 'Rename the INP names…', fn: () => openInpRename(ml) });
  m.push({ sep: 1 });
  const gs = APP.groups().filter(x => x.k === cat);
  if (gs.length) m.push({ label: 'Move to group', sub: gs.map(g => ({ label: g.name, fn: () => { ml.forEach(x => APP.setItemGroup(x.t, x.o, g.id)); APP.changed({ tree: true }); } })) });
  m.push({ label: 'New group with these items…', fn: () => { const g = APP.addGroup(cat); ml.forEach(x => APP.setItemGroup(x.t, x.o, g.id)); S.renG = g.id; APP.changed({ tree: true }); } });
  if (ml.some(x => x.o.grp && APP.getGroup(x.o.grp))) m.push({ label: 'Remove from group', fn: () => { ml.forEach(x => APP.setItemGroup(x.t, x.o, 0)); APP.changed({ tree: true }); } });
  m.push({ sep: 1 }, { label: `Delete (${n})`, danger: true, fn: () => deleteMany(ml) });
  return m;
}
const expItems = (items) => items.length ? [{ sep: 1 }, { label: 'Export all to the INP file', fn: () => setExportMany(items, true) }, { label: 'Do not export any to the INP file', fn: () => setExportMany(items, false) }, { label: 'Rename the INP names…', fn: () => openInpRename(items) }] : [];
function catExtra(k) {
  if (k !== 'planes' && k !== 'bodies' && k !== 'regions') return [];
  return expItems(groupItems(k).map(o => ({ t: k === 'regions' ? 'region' : 'body', o })));
}
function grpExtra(g) {
  const mem = APP.groupMembers(g), t = g.k === 'regions' ? 'region' : g.k === 'csys' ? 'csys' : g.k === 'meshes' ? 'stl' : g.k === 'comps' ? 'comp' : g.k === 'materials' ? 'material' : g.k === 'measures' ? 'measure' : 'body';
  const items = mem.map(o => ({ t, o })), out = [];
  if (items.length > 1) out.push({ label: `Select the ${items.length} members`, fn: () => { S.multi = { keys: new Set(items.map(x => mkey(x.t, x.o.id))) }; S.sel = { t, id: items[0].o.id }; APP.changed({ tree: true, right: true }); } });
  if (g.k === 'planes' || g.k === 'bodies' || g.k === 'regions') out.push(...expItems(items));
  return out;
}

/* ---------- Rename the INP names (prefix + number) ---------- */
function openInpRename(scope) {
  const d = $('#dlgInpRename'), o = S.opt.inpRen || {};
  d._scope = scope ? scope.filter(x => x.t === 'body' || x.t === 'region').map(x => x.o) : null;
  if (d._scope && !d._scope.length) d._scope = null;
  $('#irScope').innerHTML = (d._scope ? `<option value="sel">The ${d._scope.length} selected object${d._scope.length > 1 ? 's' : ''}</option>` : '') + '<option value="all">Every exported object</option>';
  $('#irPb').value = o.pb === undefined ? 'B' : o.pb; $('#irPp').value = o.pp === undefined ? 'P' : o.pp; $('#irPr').value = o.pr === undefined ? 'R' : o.pr;
  $('#irType').checked = !!o.withType; $('#irPad').checked = o.pad !== false; $('#irStart').value = o.start === undefined ? 1 : o.start;
  $('#irMode').value = o.mode === 'fill' ? 'fill' : 'kind'; $('#irPre').value = o.prefix || ''; $('#irW').value = o.width || FK.INP_NAME_MAX;
  $('#irLp').value = o.lp === undefined ? 'p' : o.lp; $('#irLb').value = o.lb === undefined ? 'b' : o.lb; $('#irLr').value = o.lr === undefined ? 'r' : o.lr;
  d.returnValue = ''; irRefresh(); if (!d.open) d.showModal();
}
function irSpec() {
  const d = $('#dlgInpRename');
  return { mode: $('#irMode').value, prefix: $('#irPre').value.trim(), width: $('#irW').value, letters: { planes: $('#irLp').value.trim(), bodies: $('#irLb').value.trim(), regions: $('#irLr').value.trim() }, scope: $('#irScope').value === 'sel' ? d._scope : null, pb: $('#irPb').value.trim(), pp: $('#irPp').value.trim(), pr: $('#irPr').value.trim(), withType: $('#irType').checked, pad: $('#irPad').checked, start: $('#irStart').value };
}
function irRefresh() {
  const sp = irSpec(); $('#irFill').hidden = sp.mode !== 'fill'; $('#irKind').hidden = sp.mode === 'fill';
  const pl = FK.planInpRename(S.model, sp), rows = pl.renames.slice(0, 10);
  $('#irPrev').innerHTML = (pl.errors.length ? pl.errors.map(e => `<div class="bad">⚠ ${esc(e)}</div>`).join('') : '') +
    (pl.renames.length ? `<div class="muted" style="margin:4px 0">${pl.renames.length} name${pl.renames.length > 1 ? 's' : ''} will change in the INP file:</div>` + rows.map(r => `<div><span class="muted">${esc(r.item.name)}</span> → <b>${esc(r.name)}</b></div>`).join('') + (pl.renames.length > rows.length ? '<div class="muted">…</div>' : '') : '<div class="muted">No exported object in this scope.</div>');
  $('#irOk').disabled = !!pl.errors.length || !pl.renames.length;
}
(function () {
  const d = $('#dlgInpRename'); if (!d) return;
  d.addEventListener('input', irRefresh); d.addEventListener('change', irRefresh);
  d.addEventListener('close', () => {
    const sp = irSpec();
    if (d.returnValue === 'ok') {
      const pl = FK.planInpRename(S.model, sp); if (pl.errors.length || !pl.renames.length) return;
      S.opt.inpRen = { mode: sp.mode, prefix: sp.prefix, width: sp.width, lp: sp.letters.planes, lb: sp.letters.bodies, lr: sp.letters.regions, pb: sp.pb, pp: sp.pp, pr: sp.pr, withType: sp.withType, pad: sp.pad, start: sp.start };
      APP.snap(); pl.renames.forEach(r => { if (r.name === r.item.name) delete r.item.inpName; else r.item.inpName = r.name; });
      APP.changed({ tree: true, right: true }); APP.save(); toast(`${pl.renames.length} INP name${pl.renames.length > 1 ? 's' : ''} renamed`);
    } else if (d.returnValue === 'reset') {
      const scope = sp.scope ? new Set(sp.scope) : null; let n = 0; APP.snap();
      for (const it of S.model.bodies.concat(S.model.regions)) if ((!scope || scope.has(it)) && it.inpName) { delete it.inpName; n++; }
      APP.changed({ tree: true, right: true }); toast(`${n} INP name${n === 1 ? '' : 's'} back to automatic`);
    }
  });
})();
