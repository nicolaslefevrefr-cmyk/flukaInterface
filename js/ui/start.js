/* ui/start.js — Start-up
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Start-up ---------- */
function init() {
  APP.load();
  $('#inpStyle').value = String(S.opt.style || 2); $('#inpFull').checked = S.opt.inpFull !== false; $('#inpTransform').checked = !!S.opt.inpTransform; $('#inpZones').checked = S.opt.inpZones !== false;
  APP.startLoop();
  APP.sync(); APP.rebuildMeasures(); APP.rebuildCsys();
  renderLeft(); renderToolOpts(); renderRight(); updateInp(); updateStatus(); syncToolbar();
  APP.hooks.undoState(); updateDropHint();
  APP.fit();
  setDrawer();
  APP.restoreMeshes().then(n => { if (n) { renderLeft(); renderRight(); toast(`${n} mesh${n > 1 ? 'es' : ''} restored`); } });
}
init();
window.APP_DEBUG = { setTool, objLabel, openInpRename, refreshView, drawn: () => APP.drawnObjects(), linkify, toggleColorBy,  openCompact: (t) => openCompact(t), CMP, openSettings, openSurf: () => toggleSurf(), saveConfigFile, afterConfig, sfRun, sfGo, grDraw, grSelect, GR, startFill, processHit, newCsysEditable, resolvePoint, ptRefreshPending, suggestSnap, chkSolve, chkRun, openDevDlg, devRun, splitStl, guidedToggle, guidedArm, openFeatDlg, loadStlFiles, setTool, setFilter, setPick, flush, renderRight };
