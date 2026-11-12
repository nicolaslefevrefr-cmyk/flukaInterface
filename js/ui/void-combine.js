/* ui/void-combine.js — Void region and combined regions
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Void region (experimental) ---------- */
function voidArgs() { return [+$('#voidMargin').value || 0, (document.querySelector('input[name=voidMode]:checked') || {}).value || 'compact']; }
function updateVoidPrev(r) {
  const pl = APP.voidPlan(r, ...voidArgs()), box = $('#voidPrev'), ok = $('#voidOk');
  if (pl.error) {
    box.innerHTML = '<div class="msg bad">' + esc(pl.error) + (pl.diag ? '<br>' + pl.diag.map(d => esc(d.text)).join('<br>') : '') + '</div>';
    ok.disabled = true; return;
  }
  ok.disabled = false;
  const f = (a) => a.map(x => +x.toFixed(3)).join(', ');
  box.innerHTML = '<div class="msg"><b>Bounding box</b> (' + f(pl.bbox.min) + ') → (' + f(pl.bbox.max) + ')<br>' +
    '<b>RPP ' + esc(pl.boxName) + '</b> ' + f(pl.p) + '<br><b>Region ' + esc(pl.regName) + '</b><br><code>' + esc(pl.expr) + '</code></div>';
}
function openVoidDlg(r) {
  const d = $('#dlgVoid'); d.dataset.rid = r.id; d.returnValue = '';
  updateVoidPrev(r);
  if (!d.open) d.showModal();
}
(function () {
  const d = $('#dlgVoid'); if (!d) return;
  const refresh = () => { const r = APP.getRegion(+d.dataset.rid); if (r) updateVoidPrev(r); };
  d.addEventListener('input', refresh); d.addEventListener('change', refresh);
  d.addEventListener('close', () => {
    if (d.returnValue !== 'ok') return;
    const r = APP.getRegion(+d.dataset.rid); if (!r) return;
    const res = APP.createVoidRegion(r, ...voidArgs());
    if (res.error) toast(res.error);
  });
})();
/* ---------- Combine regions: a live-linked region whose operations are edited in the properties panel ---------- */
function openBoolDlg(a) {
  const res = APP.startCombine(a);
  if (res.error) { toast(res.error); return; }
  S.rtab = 'definition'; APP.changed({ right: true });
}
async function newProject() {
  if (await askConfirm('Start a new project? Meshes, bodies, regions, coordinate systems and measures are removed (the model part can be undone with Ctrl+Z; meshes cannot).', 'Clear everything')) { APP.newModel(true); toast('New project'); }
}
async function saveProject(withMeshes) {
  try {
    const txt = await APP.exportProject(withMeshes !== false);
    const blob = new Blob([txt], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = APP.fileBase() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(withMeshes === false ? `Project saved (geometry only, ${(txt.length / 1048576).toFixed(2)} MB)` : `Project saved (${S.stls.length} mesh${S.stls.length === 1 ? '' : 'es'} embedded, ${(txt.length / 1048576).toFixed(1)} MB)`);
  } catch (e) { console.error(e); toast('Save failed: ' + e.message); }
}
$('#fileProj').onchange = async (e) => {
  const fl = e.target.files[0]; e.target.value = ''; if (!fl) return;
  let ok = false;
  await withProgress('Opening the project', 6, async (step) => {
    await step('Reading the file…'); const txt = await fl.text();
    await step('Loading the model and the meshes…'); ok = await APP.importProject(txt);
    if (ok) await flushWithProgress(step);
  });
  if (ok) toast(`Project loaded (${S.stls.length} mesh${S.stls.length === 1 ? '' : 'es'})`);
};
const menuAt = (btn, items) => { const r = btn.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, items); };
async function saveConfigFile() {
  const blob = new Blob([APP.exportConfig()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cgtool.config.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Configuration saved');
}
/** Re-applies everything that depends on the settings after a configuration was loaded / reset. */
function afterConfig() {
  applyTheme(); applyPanelW(); APP.setProjection(S.opt.proj || 'persp'); APP.applyStyles(); APP.refreshNames();
  $('#inpStyle').value = String(S.opt.style || 2); $('#inpFull').checked = S.opt.inpFull !== false; $('#inpTransform').checked = !!S.opt.inpTransform; $('#inpZones').checked = S.opt.inpZones !== false; $('#inpComments').value = String(+S.opt.inpComments || 0);
  syncToolbar(); renderLeft(); renderRight(); updateInp(); APP.changed({ tree: true, right: true }); APP.save();
}
$('#fileCfg').onchange = async (e) => {
  const fl = e.target.files[0]; e.target.value = ''; if (!fl) return;
  const r = APP.importConfig(await fl.text());
  if (r.error) { toast(r.error); return; }
  afterConfig(); toast(`Configuration loaded (${r.n} setting${r.n === 1 ? '' : 's'}${r.materials ? ', ' + r.materials + ' material' + (r.materials > 1 ? 's' : '') + ' added' : ''})`);
  if (dlgSet.open) openSettings();
};
$('#btnFile').onclick = (e) => menuAt(e.currentTarget, [
    { label: 'New project…', fn: newProject },
    { label: 'Open project (.json)…', fn: () => $('#fileProj').click() },
    { label: 'Save project (.json) — with meshes', fn: () => saveProject(true) },
    { label: 'Save project (.json) — geometry only, no meshes', fn: () => saveProject(false) },
    { sep: 1 },
    { label: 'Load dummy example', fn: () => { if (S.model.bodies.length || S.model.regions.length) { if (!confirm('Replace the current model with the dummy example?')) return; } APP.loadExample(); } },
    { label: 'Import STL / OBJ…', fn: () => $('#fileStl').click() },
    { label: 'Import INP block…', fn: openImport },
    { label: 'Export .inp file', fn: () => $('#btnInpSave').click() },
    { label: 'Copy .inp text', fn: () => copyText(APP.inpText()) },
    { sep: 1 },
    { label: 'Save configuration (.json)', fn: saveConfigFile },
    { label: 'Load configuration (.json)…', fn: () => $('#fileCfg').click() }]);
