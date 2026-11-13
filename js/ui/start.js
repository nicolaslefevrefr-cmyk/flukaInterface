/* ui/start.js — Start-up
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Start-up ---------- */
function init() {
  const prev = APP.peekSession();
  APP.load(!!prev);                       // preferences only: the previous model comes back only if the user agrees
  if (prev) APP.holdSave = true;
  $('#inpStyle').value = String(S.opt.style || 2); $('#inpFull').checked = S.opt.inpFull !== false; $('#inpTransform').checked = !!S.opt.inpTransform; $('#inpZones').checked = S.opt.inpZones !== false; $('#inpComments').value = String(+S.opt.inpComments || 0);
  APP.startLoop();
  APP.sync(); APP.rebuildMeasures(); APP.rebuildCsys();
  renderLeft(); renderToolOpts(); renderRight(); updateInp(); updateStatus(); syncToolbar();
  APP.hooks.undoState(); updateDropHint();
  APP.fit();
  setDrawer();
  if (prev) askRestore(prev);
  else APP.restoreMeshes().then(n => { if (n) { renderLeft(); renderRight(); toast(`${n} mesh${n > 1 ? 'es' : ''} restored`); } });
}
/** Start-up with a previous session in the storage: nothing is loaded before the user chooses (a model that made the page crash would loop). */
async function askRestore(prev) {
  const when = prev.saved ? new Date(prev.saved).toLocaleString() : 'an earlier visit', pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const ok = await askConfirm(`A previous session was found (${when}): ${pl(prev.bodies, 'body').replace('bodys', 'bodies')}, ${pl(prev.regions, 'region')}, ${pl(prev.meshes, 'mesh').replace('meshs', 'meshes')}.\n\nRestore it? If the last file made the page crash, choose "Start empty".`, 'Restore it', 'Start empty');
  if (!ok) { APP.discardSession(); toast('Started empty'); return; }
  APP.holdSave = false;
  await withProgress('Restoring the previous session', 5, async (step) => {
    await step('Loading the model…'); APP.load(false);
    if (prev.bodies + prev.regions > 500) S.checksOff = true;
    await flushWithProgress(step, { tree: true, right: true, fit: true, measures: true, csys: true });
  });
  APP.restoreMeshes().then(n => { if (n) { renderLeft(); renderRight(); toast(`${n} mesh${n > 1 ? 'es' : ''} restored`); } });
}
init();
window.APP_DEBUG = { setTool, objLabel, openInpRename, refreshView, drawn: () => APP.drawnObjects(), linkify, toggleColorBy, toggleParts, openCompact: (t) => openCompact(t), CMP, openSettings, openSurf: () => toggleSurf(), saveConfigFile, afterConfig, sfRun, sfGo, grDraw, grSelect, GR, startFill, processHit, newCsysEditable, resolvePoint, ptRefreshPending, suggestSnap, chkSolve, chkRun, CHK, openDevDlg, devRun, splitStl, guidedToggle, guidedArm, openFeatDlg, loadStlFiles, setTool, setFilter, setPick, flush, renderRight };
