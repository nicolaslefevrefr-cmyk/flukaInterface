/* ui/groups.js — Organisation groups: rename, drag & drop
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---- organisation groups ---- */
function newGrp(k, item) {
  return { label: item ? 'New group with this item…' : 'New group', fn: () => {
    const g = APP.addGroup(k); if (item) APP.setItemGroup(item.t, item.o, g.id);
    S.renG = g.id; APP.changed({ tree: true });
  } };
}
function moveItems(t, o) {
  const k = APP.catOf(t, o), m = [{ sep: 1 }];
  const gs = APP.groups().filter(x => x.k === k && x.id !== o.grp);
  if (gs.length) m.push({ label: 'Move to group', sub: gs.map(g => ({ label: g.name, fn: () => { APP.setItemGroup(t, o, g.id); APP.changed({ tree: true }); } })) });
  m.push(newGrp(k, { t, o }));
  if (o.grp && APP.getGroup(o.grp)) m.push({ label: 'Remove from group', fn: () => { APP.setItemGroup(t, o, 0); APP.changed({ tree: true }); } });
  return m;
}
const grpMenu = (id) => { const g = APP.getGroup(id); if (!g) return []; const a = grpMenu0(id), ex = grpExtra(g), i = a.findIndex(x => x.sep); return i < 0 ? a.concat(ex) : a.slice(0, i).concat(ex, a.slice(i)); };
function grpMenu0(id) {
  const g = APP.getGroup(id); if (!g) return [];
  return [{ label: 'Rename…', fn: () => { S.renG = id; renderLeft(); } },
    { label: 'Show all', fn: () => { APP.setGroupVisible(g, true); APP.changed({ tree: true, csys: g.k === 'csys', measures: g.k === 'measures' }); } },
    { label: 'Hide all', fn: () => { APP.setGroupVisible(g, false); APP.changed({ tree: true, csys: g.k === 'csys', measures: g.k === 'measures' }); } },
    { sep: 1 }, { label: 'Delete group (items are kept)', danger: true, fn: () => { APP.deleteGroup(id); APP.changed({ tree: true }); } }];
}
const groupMenu = (k) => groupMenu0(k).concat(catExtra(k));
function groupMenu0(k) {
  switch (k) {
    case 'meshes': return [{ label: 'Import STL / OBJ…', fn: () => $('#fileStl').click() }, newGrp(k)].concat(visItems(k));
    case 'materials': return FK.DEFAULT_MATERIALS.filter(n => !APP.materialByName(n)).map(n => ({ label: 'Add ' + n, fn: () => APP.addMaterial(n) })).concat([{ label: 'New material…', fn: () => { const m = APP.addMaterial('MAT1'); S.rtab = 'general'; APP.changed({ tree: true, right: true }); setTimeout(() => { const i = $('#rightBody [data-k=name]'); if (i) { i.focus(); i.select(); } }, 60); } }]);
    case 'comps': return Object.keys(FK.TEMPLATES).map(id => ({ label: 'New ' + FK.TEMPLATES[id].name.toLowerCase(), fn: () => { const c = APP.compCreate(id); if (c) { S.rtab = 'definition'; APP.changed({ tree: true, right: true }); } } }));
    case 'csys': return [
      { label: 'New coordinate system (child of active)', fn: () => newCsysEditable(S.model.active || 0, undefined) },
      { label: 'New from 3 points in the view…', fn: () => setTool('csys3') },
      { label: 'Make Global the active system', fn: () => APP.setActiveCsys(0) }, newGrp(k)].concat(visItems(k));
    case 'planes': return [
      { label: 'New PLA (point + normal)', fn: () => newBody('PLA') }, { label: 'New XYP (Z = const)', fn: () => newBody('XYP') },
      { label: 'New XZP (Y = const)', fn: () => newBody('XZP') }, { label: 'New YZP (X = const)', fn: () => newBody('YZP') },
      { label: 'PLA from a mesh face…', fn: () => setTool('plane') }, newGrp(k)].concat(visItems(k));
    case 'bodies': return ['RPP', 'SPH', 'RCC', 'TRC', 'XCC', 'YCC', 'ZCC'].map(t => ({ label: 'New ' + FK.BODY_TYPES[t].label, fn: () => newBody(t) }))
      .concat([{ label: 'RPP from 2 points in the view…', fn: () => setTool('rpp') }, { label: 'Add void / blackhole envelope', fn: () => APP.addEnvelope() }, newGrp(k)]).concat(visItems(k));
    case 'regions': return [{ label: 'New region', fn: () => { APP.snap(); const r = APP.addRegion(null, '', { visible: true }); S.sel = { t: 'region', id: r.id }; APP.changed({ tree: true, right: true }); } }, newGrp(k)].concat(visItems(k));
    case 'measures': return [{ label: 'Measure a distance…', fn: () => setTool('measure') }, newGrp(k), { label: 'Delete all measures', danger: true, fn: () => { APP.snap(); S.measures = []; APP.changed({ tree: true, measures: true, right: true }); } }].concat(visItems(k));
  }
  return [];
}
function itemMenu(t, id) {
  const o = findItem(t, id), m = itemMenuBase(t, id); if (!o) return m;
  let i = m.length - 1; while (i > 0 && !m[i].sep) i--;       // insert before the last separator (Delete)
  const ex = t === 'body' || t === 'region' ? [{ sep: 1 }, { label: o.noExport ? 'Export to the INP file' : 'Do not export to the INP file', fn: () => setExportMany([{ t, o }], !!o.noExport) },
    { label: 'Rename the INP names…', fn: () => openInpRename([{ t, o }]) }] : [];
  return m.slice(0, i).concat(ex, moveItems(t, o), m.slice(i));
}
function itemMenuBase(t, id) {
  const o = findItem(t, id); if (!o) return [];
  const sel = () => { S.sel = { t, id }; };
  const toggle = { label: o.visible ? 'Hide' : 'Show', fn: () => { APP.snap(); o.visible = !o.visible; APP.changed({ tree: true, csys: t === 'csys', measures: t === 'measure' }); } };
  const rename = { label: 'Rename…', fn: () => { selectItem(t, id); setDrawer('right', true); setTimeout(() => { const i = $('#rightBody [data-k=name]'); if (i) { i.focus(); i.select(); } }, 60); } };
  const del = { label: t === 'stl' ? 'Remove' : 'Delete', danger: true, fn: () => { sel(); APP.deleteSel(); } };
  switch (t) {
    case 'body': {
      const m = [rename, toggle, { label: 'Duplicate', fn: () => { const c = APP.duplicateBody(o); S.sel = { t: 'body', id: c.id }; APP.changed({ tree: true, right: true }); } },
        { label: 'New region from this body', fn: () => { APP.snap(); const r = APP.addRegion(APP.regionNameFor(o.name), '+' + o.name, { visible: true }); S.sel = { t: 'region', id: r.id }; APP.changed({ tree: true, right: true }); } }];
      if (FK.isPlaneType(o.type)) m.push({ label: 'Section view at this plane', fn: () => APP.cutUsePlane(o.id) });
      if (o.type === 'PLA') m.push({ label: 'Re-pick from a mesh face…', fn: () => { S.reassign = o.id; setTool('replane'); } });
      return m.concat([{ sep: 1 }, del]);
    }
    case 'region': return [rename, toggle, { label: 'Duplicate', fn: () => { const c = APP.duplicateRegion(o); S.sel = { t: 'region', id: c.id }; APP.changed({ tree: true, right: true }); } },
      { label: 'Combine with another region… (A − B, A ∩ B, A ∪ B) (experimental)', fn: () => openBoolDlg(o) },
      { label: 'Create void region around this one… (experimental)', fn: () => openVoidDlg(o) }, { sep: 1 }, del];
    case 'csys': return [rename, toggle, { label: 'Set as active', fn: () => APP.setActiveCsys(o.id) },
      { label: APP.exportCs() === o.id ? 'Stop using as export coordinate system' : 'Use as export coordinate system (INP)', fn: () => APP.setExportCsys(APP.exportCs() === o.id ? 0 : o.id) },
      { label: 'New child coordinate system', fn: () => newCsysEditable(o.id, o.id) },
      { label: o.frozen ? 'Unfreeze (follow parent)' : 'Freeze (keep world pose)', fn: () => APP.setCsysFrozen(o, !o.frozen) },
      { label: 'Section view (XY plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':xy') },
      { label: 'Section view (XZ plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':xz') },
      { label: 'Section view (YZ plane)', fn: () => APP.cutUseSrc('cs:' + o.id + ':yz') },
      { label: 'Duplicate', fn: () => APP.duplicateCsys(o) }, { sep: 1 }, del];
    case 'stl': return [rename, toggle, { label: 'Detect features… (experimental)', fn: () => openFeatDlg(o) }, { label: 'Bounding RPP', fn: () => { if (o.stats && o.stats.bbox) APP.rppFromBox(o.stats.bbox); } }, { sep: 1 }, del];
    case 'material': return [rename, { sep: 1 }, del];
    case 'comp': return [rename, toggle, { label: 'Regenerate', fn: () => { APP.snap(); APP.compRegen(o); APP.changed({ tree: true, right: true }); } },
      { label: 'Select its placement coordinate system', fn: () => selectItem('csys', o.cs) },
      { label: 'Detach (keep objects as ordinary bodies / regions)', fn: () => APP.compDetach(o) }, { sep: 1 },
      { label: 'Delete component and its objects', danger: true, fn: () => APP.deleteComp(o.id, false) }];
    case 'measure': return [toggle, { label: 'RPP from these 2 points', fn: () => APP.createRpp(o.a, o.b) }, { sep: 1 }, del];
  }
  return [];
}
$('#treeFilter').addEventListener('input', e => { TF = e.target.value.trim().toLowerCase(); renderLeft(); });
$('#treeFilter').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; TF = ''; renderLeft(); } });
$('#treeExpand').addEventListener('click', () => {
  const st = treeState(); GROUPS_DEF.forEach(g => { st[g.k] = true; }); S.model.csys.forEach(c => { st['cs' + c.id] = true; });
  APP.groups().forEach(g => { g.open = true; }); APP.save(); renderLeft();
});
$('#treeCollapse').addEventListener('click', () => {
  const st = treeState(); GROUPS_DEF.forEach(g => { st[g.k] = false; }); S.model.csys.forEach(c => { st['cs' + c.id] = false; });
  APP.groups().forEach(g => { g.open = false; }); APP.save(); renderLeft();
});
$('#leftBody').addEventListener('contextmenu', e => {
  const item = e.target.closest('.item[data-t]'), th = e.target.closest('.th'), gr = e.target.closest('.grow');
  if (gr) { e.preventDefault(); showMenu(e.clientX, e.clientY, grpMenu(+gr.dataset.gid)); }
  else if (item) { e.preventDefault(); const ml = isMulti(item.dataset.t, +item.dataset.id) ? multiList() : null; showMenu(e.clientX, e.clientY, ml ? multiMenu(ml) : itemMenu(item.dataset.t, +item.dataset.id)); }
  else if (th) { e.preventDefault(); showMenu(e.clientX, e.clientY, groupMenu(th.dataset.g)); }
});

$('#leftBody').addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  const item = e.target.closest('.item');
  const a = act && act.dataset.act;
  if (a === 'fold') { const k = act.dataset.k; treeState()[k] = !isOpen(k); if (/^cs\d+$/.test(k)) treeState()[k] = treeState()[k]; APP.save(); renderLeft(); return; }
  if (a === 'gfold') { const g = APP.getGroup(+act.dataset.gid); if (g) { g.open = g.open === false; APP.save(); renderLeft(); } return; }
  if (a === 'grpvis') { const g = APP.getGroup(+act.dataset.gid); if (g) { APP.setGroupVisible(g, !APP.groupMembers(g).some(o => o.visible)); APP.changed({ tree: true, csys: g.k === 'csys', measures: g.k === 'measures' }); } return; }
  if (a === 'grpmenu') { const r = act.getBoundingClientRect(); showMenu(r.left - 140, r.bottom + 2, grpMenu(+act.dataset.gid)); return; }
  if (!act && e.target.closest('.grow') && !e.target.closest('input')) { const g = APP.getGroup(+e.target.closest('.grow').dataset.gid); if (g) { g.open = g.open === false; APP.save(); renderLeft(); } return; }
  if (!act && !TF && e.target.closest('.th') && !e.target.closest('input')) { const k = e.target.closest('.th').dataset.g; treeState()[k] = !isOpen(k); APP.save(); renderLeft(); return; }
  if (a === 'gvis') { const k = act.dataset.g; setGroupVis(k, !groupItems(k).some(o => o.visible)); return; }
  if (a === 'gmenu') { const r = act.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, groupMenu(act.dataset.g)); return; }
  if (a === 'imenu' && item) { const r = act.getBoundingClientRect(); showMenu(r.left - 140, r.bottom + 2, itemMenu(item.dataset.t, +item.dataset.id)); return; }
  if (a === 'vis' && item) {
    const o = findItem(item.dataset.t, +item.dataset.id);
    if (o) { APP.snap(); o.visible = !o.visible; APP.changed({ tree: true, csys: item.dataset.t === 'csys', measures: item.dataset.t === 'measure' }); }
    return;
  }
  if (a === 'look' && item) { const o = findItem(item.dataset.t, +item.dataset.id); if (o) { APP.snap(); const nx = { '': 'opaque', opaque: 'transparent', transparent: '' }[o.look || '']; if (nx) o.look = nx; else delete o.look; APP.applyStyles(); APP.changed({ tree: true, right: true }); } return; }
  if (a === 'activate') { APP.setActiveCsys(+act.dataset.cid); return; }
  if (a === 'op') return;
  if (item && item.dataset.t && !e.target.closest('input')) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) { treeMultiClick(item, e); return; }
    S.multi = null; selectItem(item.dataset.t, +item.dataset.id); return;
  }
  if (!act) return;
  switch (a) {
    case 'addStl': $('#fileStl').click(); break;
    case 'importInp': openImport(); break;
    case 'newModel': newProject(); break;
  }
});
$('#leftBody').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act !== 'op') return;
  const item = t.closest('.item'); const o = findItem(item.dataset.t, +item.dataset.id); if (!o) return;
  o.opacity = (+t.value) / 100;
  item.querySelector('small').textContent = t.value + '%';
  if (S.sel && S.sel.t === item.dataset.t && S.sel.id === +item.dataset.id) syncRightStyle();
  APP.applyStyles(); clearTimeout(saveT); saveT = setTimeout(APP.save, 400);
});
/* ---- group rename ---- */
function commitGroupName(inp, cancel) {
  const g = APP.getGroup(+inp.dataset.gid); S.renG = 0;
  if (g && !cancel && inp.value.trim() && inp.value.trim() !== g.name) { APP.snap(); g.name = inp.value.trim().slice(0, 40); }
  APP.changed({ tree: true });
}
$('#leftBody').addEventListener('keydown', e => { if (!e.target.classList.contains('gname')) return; if (e.key === 'Enter') { e.preventDefault(); commitGroupName(e.target); } else if (e.key === 'Escape') { e.stopPropagation(); commitGroupName(e.target, true); } });
$('#leftBody').addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('gname') && S.renG) commitGroupName(e.target); });

/* ---- drag & drop of items between groups (same category only) ---- */
let dragItem = null;
const clearDrop = () => $$('#leftBody .dropt').forEach(n => n.classList.remove('dropt'));
/** drop target under the pointer: {el, gid, k} or null */
function dropTarget(e) {
  if (!dragItem) return null;
  const gEl = e.target.closest('.grow, .gb'), tg = e.target.closest('.tg');
  if (gEl) return { el: gEl, gid: +gEl.dataset.gid, k: gEl.dataset.k };
  if (tg) return { el: tg.querySelector('.tb') || tg, gid: 0, k: tg.dataset.k };
  return null;
}
$('#leftBody').addEventListener('dragstart', e => {
  const it = e.target.closest && e.target.closest('.item[data-t]'); if (!it || !it.dataset.id) return;
  const o = findItem(it.dataset.t, +it.dataset.id); if (!o) return;
  dragItem = { t: it.dataset.t, o, k: APP.catOf(it.dataset.t, o), list: isMulti(it.dataset.t, +it.dataset.id) ? multiList() : null };
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', o.name); } catch (err) { /* ignore */ } }
  it.classList.add('dragging');
});
$('#leftBody').addEventListener('dragover', e => {
  const d = dropTarget(e); if (!d || d.k !== dragItem.k) return;
  e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  clearDrop(); d.el.classList.add('dropt');
});
$('#leftBody').addEventListener('dragleave', e => { if (!e.relatedTarget || !$('#leftBody').contains(e.relatedTarget)) clearDrop(); });
$('#leftBody').addEventListener('drop', e => {
  const d = dropTarget(e); clearDrop();
  if (!d || d.k !== dragItem.k) { dragItem = null; return; }
  e.preventDefault();
  const { t, o, list } = dragItem; dragItem = null;
  if (list) { let n = 0; for (const x of list) if ((x.o.grp || 0) !== d.gid && APP.setItemGroup(x.t, x.o, d.gid)) n++; if (n) APP.changed({ tree: true }); return; }
  if ((o.grp || 0) !== d.gid && APP.setItemGroup(t, o, d.gid)) APP.changed({ tree: true });
});
$('#leftBody').addEventListener('dragend', () => { dragItem = null; clearDrop(); $$('#leftBody .dragging').forEach(n => n.classList.remove('dragging')); });

function findItem(t, id) { return { body: APP.getBody, region: APP.getRegion, stl: APP.getStl, measure: APP.getMeasure, csys: APP.getCsys, comp: APP.getComp, material: APP.getMaterial }[t](id); }
