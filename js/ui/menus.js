/* ui/menus.js — Top-bar menus: Geometry, Tools, View
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---- Geometry menu: the creation commands, by kind of object ---- */
const geomClean = (items) => items.filter(i => !i.sep && !/^(New group|Show all|Hide all|Delete all)/.test(i.label));
$('#btnGeom').onclick = (e) => menuAt(e.currentTarget, [['Components', 'comps'], ['Planes', 'planes'], ['Bodies', 'bodies'], ['Regions', 'regions'], ['Coordinate systems', 'csys'], ['Meshes (STL / OBJ)', 'meshes'], ['Materials', 'materials'], ['Measures', 'measures']]
  .map(([label, k]) => ({ label, sub: geomClean(groupMenu0(k)) })).filter(x => x.sub.length));
/* ---- Check menu ---- */
$('#btnTools').onclick = (e) => { const sd = $('#dlgSurf'); menuAt(e.currentTarget, [
    { label: 'Check', icon: '✔', sub: [
      { label: 'Surface check…', checked: !!(sd && sd.open), icon: '▦', fn: () => toggleSurf() },
      { label: 'INP check…', icon: '✔', fn: () => { if (!sheet.classList.contains('open')) $('#btnInp').click(); $('#btnInpCheck').click(); } },
      { label: 'Show the INP block and its warnings', icon: '≡', checked: sheet.classList.contains('open'), fn: () => $('#btnInp').click() },
      { label: 'Compact — merge duplicates…', icon: '⛓', fn: () => openCompact() }] },
    { sep: 1 },
    { label: 'Settings…', icon: '⚙', fn: () => openSettings() }]); };
/* ---- View menu: the toolbar commands as text (+ icon), in step with the toolbar buttons ---- */
function viewMenu() {
  const svgOf = (sel) => { const e = document.querySelector(sel + ' svg'); return e ? e.outerHTML : ''; };
  const isOn = (sel) => { const e = document.querySelector(sel); return !!(e && e.classList.contains('on')); };
  const b = (sel, label, icon) => ({ label, icon: icon === undefined ? svgOf(sel) : esc(icon), checked: isOn(sel), fn: () => document.querySelector(sel).click() });
  const nm = S.opt.names || 'off';
  return [
    { head: 'Select' }, b('[data-filter=point]', 'Points'), b('[data-filter=edge]', 'Edges'), b('[data-filter=face]', 'Faces'), b('[data-filter=object]', 'Objects'),
    { head: 'Tools' }, b('[data-tool=select]', 'Information on the selection'), b('[data-tool=measure]', 'Measure a distance'),
    { head: 'Projection' }, b('[data-proj=persp]', 'Perspective'), b('[data-proj=ortho]', 'Orthographic'), b('#btnCut', 'Section view…'),
    { head: 'Render mode' }, b('[data-render=shaded]', 'Shaded (own opacities)'), b('[data-render=wire]', 'Wireframe'), b('[data-render=opaque]', 'All opaque'), b('[data-render=ghost]', 'All transparent'),
    b('[data-render=meshop]', 'Meshes opaque, CG objects transparent'), b('[data-render=cgop]', 'CG objects opaque, meshes transparent'),
    { head: 'Display' }, { label: 'Object names in the view: ' + nm + ' (next: off → regions → bodies → all)', icon: svgOf('#btnNames'), checked: nm !== 'off', fn: () => $('#btnNames').click() },
    b('#btnOnlyExp', 'Only the objects written in the INP file'), b('#btnGraph', 'Dependency diagram'), b('#btnEdges', 'Edge lines'), { label: 'Colour regions by material', icon: '▦', checked: S.opt.colorBy === 'material', fn: toggleColorBy }, b('#btnRes', 'Resolution of curved surfaces…'), b('#btnRefresh', 'Redraw the view (remove leftovers)'),
    b('#btnInvX', 'Invert left / right rotation'), b('#btnInvY', 'Invert up / down rotation'),
    { head: 'Camera' }, b('[data-view=fit]', 'Fit to what is displayed', '⤢'), b('[data-view=iso]', 'Isometric', 'Iso'), b('[data-view=top]', 'Top (Z)', 'Z'), b('[data-view=front]', 'Front (Y)', 'Y'), b('[data-view=side]', 'Side (X)', 'X'),
    b('[data-view=normal]', 'Normal to a face', '⟂'), b('[data-view=flip]', 'From the opposite side', '⇄')];
}
$('#btnViewM').onclick = (e) => menuAt(e.currentTarget, viewMenu());
const dlgSet = $('#dlgSettings');
{ const vt = document.getElementById('verTag'); if (vt) vt.textContent = 'v' + FK.VERSION; document.title = FK.APP_NAME; }
function openSettings(tab) {
  const o = S.opt; if (tab) S.stab = tab;
  const cur = S.stab || 'general', TABS = [['general', 'General'], ['alignment', 'Alignment'], ['inp', 'INP file'], ['materials', 'Materials'], ['config', 'Configuration'], ['about', 'About']];
  $('#settingsBody').innerHTML = `<div class="stabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-stab="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`
    + `<div class="spane" data-pane="general" ${cur === 'general' ? '' : 'hidden'}><h4>Display</h4><div>
      <label class="chk"><input type="checkbox" data-opt="axes" ${o.axes ? 'checked' : ''}>Axes at the origin (X red, Y green, Z blue)</label>
      <label class="chk"><input type="checkbox" data-opt="showInpName" ${o.showInpName !== false ? 'checked' : ''}>Show the INP name in brackets after each name in the tree</label>
      <label class="chk"><input type="checkbox" data-opt="multiPick" ${o.multiPick !== false ? 'checked' : ''}>Pop-up to choose among overlapping entities under a click</label>
      <label class="chk"><input type="checkbox" data-opt="invX" ${o.invX ? 'checked' : ''}>Invert left / right mouse rotation</label>
      <label class="chk"><input type="checkbox" data-opt="invY" ${o.invY ? 'checked' : ''}>Invert up / down mouse rotation</label>
      <div class="row2"><span class="muted" style="flex:1" title="Increment of the numeric fields of the properties panel (arrows, mouse wheel, ↑ / ↓)">Step of numeric fields</span><input type="number" step="0.01" min="0.0001" style="width:80px" data-opt="numStep" value="${o.numStep > 0 ? o.numStep : 0.1}"></div>
      <div class="row2"><span class="muted" style="flex:1">Render zone margin (%)</span><input type="number" step="1" min="0" style="width:80px" data-opt="margin" value="${o.margin}"></div></div>
    <h4>Theme</h4><div>
      <div class="row2"><span class="muted" style="flex:1">Colour theme</span><select data-opt="theme"><option value="light" ${o.theme !== 'dark' ? 'selected' : ''}>Light</option><option value="dark" ${o.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div></div></div>
    <div class="spane" data-pane="alignment" ${cur === 'alignment' ? '' : 'hidden'}><div class="muted" style="font-size:12.5px;margin-bottom:6px">Alignment check on creation</div><div>
      <label class="chk" title="After a detected feature, a plane from a face or a picked cylinder / box is created, propose exact values: axis on X / Y / Z, parallel / coaxial with other cylinders, equal radii, faces and ends coincident with other objects"><input type="checkbox" data-opt="snapOn" ${o.snapOn !== false ? 'checked' : ''}>Propose corrected values for new objects</label>
      <div class="row2"><span class="muted" style="flex:1">Length tolerance (mm)</span><input type="number" step="0.05" min="0" style="width:80px" data-opt="snapTol" value="${o.snapTol === undefined ? 0.2 : o.snapTol}"></div>
      <div class="row2"><span class="muted" style="flex:1">Angle tolerance (°)</span><input type="number" step="0.1" min="0" style="width:80px" data-opt="snapAng" value="${o.snapAng === undefined ? 0.5 : o.snapAng}"></div></div></div>
    <div class="spane" data-pane="inp" ${cur === 'inp' ? '' : 'hidden'}><h4>INP block</h4><div>
      <div class="fld"><label>Project name (title line of the INP, name of the saved files)</label><input type="text" data-k="title" value="${esc(S.model.title)}"></div>
      <div class="fld" style="margin-top:6px"><label title="All INP coordinates and directions are written in this frame">Export coordinate system ⓘ</label><select data-k="exportCs"><option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${APP.exportCs() === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="fld" style="margin-top:6px"><label title="Name-based geometry (COMBNAME): free format, names ≤ 8 characters, lines ≤ 132 columns. Fixed columns: GEOBEGIN (A8,2X,6E10.0,A8), title (2I5,10X,A60).">Output format ⓘ</label><select data-opt="style">
        <option value="1" ${o.style == 1 ? 'selected' : ''}>Multi-line style (REGION + line)</option>
        <option value="2" ${o.style == 2 ? 'selected' : ''}>Compact aligned style</option>
        <option value="3" ${o.style == 3 ? 'selected' : ''}>Fixed columns (Fortran-like, ≤132 col)</option></select></div>
      <label class="chk" title="A region with several zones is written one zone per line, each starting with |; the zones of a parenthesised group (e.g. the void around many objects) go one per line too"><input type="checkbox" data-opt="inpZones" ${S.opt.inpZones ? 'checked' : ''}> One zone per line (each starting with |, also inside parentheses)</label>
      <div class="fld"><label title="Zones written on the same line">Zones per line</label><select data-opt="zonesPerLine">${[1, 2, 3].map(n => `<option value="${n}" ${(S.opt.zonesPerLine || 1) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="fld" style="margin-top:6px"><label title="A region with more zones (parts separated by |) than this gets a warning; 0 = no limit">Most zones per region ⓘ</label><input type="number" data-opt="maxZones" min="0" step="1" value="${APP.maxZones()}" style="width:80px"></div>
      <div class="fld" style="margin-top:6px"><label title="A region whose formula nests parentheses deeper than this gets a warning (FLUKA copes badly with many nested parentheses). Flatten, Simplify and Split are in the region definition.">Deepest parentheses accepted ⓘ</label><select data-opt="maxParen">${[[99, 'No limit'], [0, '0 (no parenthesis)'], [1, '1 (default)'], [2, '2'], [3, '3']].map(([v, l]) => `<option value="${v}" ${APP.maxParen() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="chk" title="Each coordinate system becomes a $Start_transform … $End_transform block with ROT-DEFI cards after GEOEND; its bodies keep their own coordinates. Off: all bodies are written in the export frame (rotated boxes are cut by planes)."><input type="checkbox" data-opt="inpTransform" ${o.inpTransform ? 'checked' : ''}>Write the bodies of each coordinate system with $Start_transform</label>
      <label class="chk" title="Adds a comment line (* in column 1) before GEOBEGIN"><input type="checkbox" data-opt="inpComment" ${o.inpComment ? 'checked' : ''}>Comment header in the INP</label></div></div>
    <div class="spane" data-pane="about" ${cur === 'about' ? '' : 'hidden'}><div>
      <div><b>${FK.APP_NAME}</b> v${FK.VERSION}</div>
      ${window.CGT_check ? `<div class="update-row"><button type="button" class="btn sm" data-act="chkUpd">Check for update</button><button type="button" class="btn sm" data-act="forceUpd">Force refresh (clear cache)</button><span class="muted" id="updMsg"></span></div>
      <div class="muted" style="font-size:12px">The app always loads the newest files when online (network-first) and checks <code>version.json</code> on load and on focus.</div>` : `<div class="muted" style="font-size:12px">Single-file version: there is no automatic update. Re-download the file to get a newer version.</div>`}</div></div>
    <div class="spane" data-pane="materials" ${cur === 'materials' ? '' : 'hidden'}>${materialsPane()}</div>
    <div class="spane" data-pane="config" ${cur === 'config' ? '' : 'hidden'}>
      <div class="muted" style="font-size:12.5px">The configuration holds the settings of the tool (tolerances, mouse rotation, display, INP output style, list of materials…). The project file (File ▸ Save project) holds the geometry only, so the two can be shared and reloaded separately.</div>
      <div class="btns" style="margin-top:8px"><button type="button" class="btn" data-act="cfgSave">Save configuration (.json)</button><button type="button" class="btn" data-act="cfgLoad">Load configuration (.json)…</button><button type="button" class="btn danger" data-act="cfgReset">Reset to default settings</button></div>
      <div class="muted" id="cfgMsg" style="font-size:12.5px;margin-top:6px"></div>
    </div>`;
  if (!dlgSet.open) dlgSet.showModal();
}
$('#settingsBody').addEventListener('input', e => { const t = e.target; if (t.dataset.k === 'title') { APP.snap('title'); S.model.title = t.value; APP.changed({}); } else if (t.type === 'number') onOptChange(e); });
const MAT_STD = ['BLCKHOLE', 'VACUUM', 'AIR', 'WATER', 'HYDROGEN', 'HELIUM', 'BERYLLIU', 'CARBON', 'NITROGEN', 'OXYGEN', 'ALUMINUM', 'SILICON', 'IRON', 'NICKEL', 'CHROMIUM', 'COPPER', 'SILVER', 'TUNGSTEN', 'GOLD', 'LEAD', 'TITANIUM', 'POLYETHY'];
function materialsPane() {
  const list = S.model.materials || (S.model.materials = FK.defaultMaterials());
  return `<div class="muted" style="font-size:12.5px;margin-bottom:6px">Materials of the project (names: capitals, ≤ 8 characters). A region takes one in its <b>Material</b> field.</div>
    <div id="matRows">${list.map(m => `<div class="matrow" data-mid="${m.id}"><input type="text" maxlength="8" value="${esc(m.name)}" data-mat="name" spellcheck="false"><small>${APP.regionsOfMaterial(m.id).length} region${APP.regionsOfMaterial(m.id).length === 1 ? '' : 's'}</small><button type="button" class="btn sm danger" data-act="matDel" title="Delete this material (regions using it lose it)">✕</button></div>`).join('') || '<div class="muted">No material yet.</div>'}</div>
    <div class="matrow" style="margin-top:8px"><input type="text" id="matNew" maxlength="8" placeholder="New material name" spellcheck="false"><button type="button" class="btn sm primary" data-act="matAdd">＋ Add</button></div>
    <div class="matrow"><select id="matStd"><option value="">Add a standard material…</option>${MAT_STD.filter(n => !list.some(m => m.name === n)).map(n => `<option>${n}</option>`).join('')}</select></div>`;
}
const keepSel = (fn) => { const p = S.sel; fn(); S.sel = p; };
function refreshMaterials() { const p = $('#settingsBody [data-pane=materials]'); if (p) p.innerHTML = materialsPane(); }
$('#settingsBody').addEventListener('click', async e => {
  const tb = e.target.closest('[data-stab]');
  if (tb) { e.preventDefault(); S.stab = tb.dataset.stab; $$('#settingsBody [data-stab]').forEach(x => x.classList.toggle('on', x === tb)); $$('#settingsBody .spane').forEach(p => { p.hidden = p.dataset.pane !== S.stab; }); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'matAdd') { const v = $('#matNew').value; if (v.trim()) { keepSel(() => APP.addMaterial(v)); refreshMaterials(); } return; }
  if (a.dataset.act === 'matDel') { const id = +a.closest('.matrow').dataset.mid; keepSel(() => APP.deleteMaterial(id)); refreshMaterials(); return; }
  if (a.dataset.act === 'cfgSave') { saveConfigFile(); return; }
  if (a.dataset.act === 'cfgLoad') { $('#fileCfg').click(); return; }
  if (a.dataset.act === 'cfgReset') { if (await askConfirm('Reset every setting to its default value? The geometry is not touched.', 'Reset')) { APP.resetConfig(); afterConfig(); openSettings(); toast('Default settings restored'); } return; }
  if (a.dataset.act === 'forceUpd') window.CGT_forceRefresh();
  else if (a.dataset.act === 'chkUpd') { const m = $('#updMsg'); m.textContent = '…'; const r = await window.CGT_check(true); m.textContent = r === 'new' ? 'A newer version is available.' : r === 'same' ? 'Up to date.' : 'Offline.'; }
});
$('#settingsBody').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'matStd' && t.value) { keepSel(() => APP.addMaterial(t.value)); refreshMaterials(); return; }
  if (t.dataset.mat === 'name') { const m = APP.getMaterial(+t.closest('.matrow').dataset.mid); if (m && !APP.renameMaterial(m, t.value)) { t.value = m.name; } else if (m) t.value = m.name; return; }
  if (e.target.dataset.opt) onOptChange(e); else if (e.target.dataset.k === 'exportCs') APP.setExportCsys(+e.target.value); });
