/* ui/files.js — INP block, mesh loading, keyboard
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- INP block: display, copy, import ---------- */
const inpText = $('#inpText');
let curGo = '';
function updateInp() {
  const t = APP.inpText();
  if (inpText.value !== t) inpText.value = t;
  const w = APP.warnings();
  const nun = APP.unusedBodies().length, nsh = FK.inpNames(S.model).shortened.filter(x => !x.noExport).length;
  const cp = APP.complexPlan(), ncx = cp.flat.length + cp.split.length + cp.fail.length;
  const iss = APP.issues(), n = { e: 0, w: 0, i: 0 }; iss.forEach(x => n[x.sev]++);
  const IC = { e: '✖', w: '⚠', i: 'ⓘ' };
  $('#isCount').innerHTML = iss.length ? [n.e ? `<span class="e">✖ ${n.e}</span>` : '', n.w ? `<span class="w">⚠ ${n.w}</span>` : '', n.i ? `<span class="i">ⓘ ${n.i}</span>` : ''].join('') : '<span class="ok">✔ no problem</span>';
  $('#inpWarn').innerHTML = (iss.length ? '' : '<div class="isok">Nothing to report.</div>') + iss.sort((a, b) => 'ewi'.indexOf(a.sev) - 'ewi'.indexOf(b.sev)).map(x => x.t
    ? `<button type="button" class="is ${x.sev}${curGo === x.t + ':' + x.id ? ' cur' : ''}" data-go="${x.t}:${x.id}" title="Select it in the project and in the 3D view"><i>${IC[x.sev]}</i><span>${linkify(x.text, x.t)}</span></button>`
    : `<div class="is ${x.sev}"><i>${IC[x.sev]}</i><span>${linkify(x.text, x.t)}</span></div>`).join('') + (ncx ? `<button type="button" class="pill" data-flatall title="Rewrites the too complex formulas as zones without parentheses; when a region would keep more zones than the limit, cuts it into several regions (same material, no overlap)">Simplify the ${ncx} complex region${ncx > 1 ? 's' : ''}</button> ` : '') + (nsh ? `${w.length ? '<br>' : ''}<button type="button" class="pill" data-autoall title="Gives each of them a short name: its first letters followed by 2 digits (kept unique)">Auto-name the ${nsh} long name${nsh > 1 ? 's' : ''}</button> ` : '') + `<br><button type="button" class="pill" data-renameall title="Prefix + number for the names written in the INP file">Rename the INP names…</button> ` + (nun ?  `${w.length ? '<br>' : ''}<button type="button" class="pill" data-skipunused title="Stops exporting the bodies and planes that no exported region uses">Do not export the ${nun} unused object${nun > 1 ? 's' : ''}</button>` : '');
  const badge = $('#warnBadge'); badge.hidden = !w.length; badge.textContent = w.length;
}
$('#inpWarn').addEventListener('click', e => {
  if (e.target.closest('[data-renameall]')) { openInpRename(null); return; }
  if (e.target.closest('.oref')) return;
  const go = e.target.closest('[data-go]');
  if (go) { const [t, id] = go.dataset.go.split(':'); if (findItem(t, +id)) { curGo = go.dataset.go; selectItem(t, +id); const o = findItem(t, +id); if (o && !o.visible) toast(`${o.name} is hidden (use its eye to show it)`); } }
});
$('#inpWarn').addEventListener('click', e => { if (e.target.closest('[data-flatall]')) {
    const pl = APP.complexPlan(), lines = [];
    if (pl.flat.length) lines.push(`• ${pl.flat.length} region${pl.flat.length > 1 ? 's' : ''} rewritten as zones without parentheses: ${pl.flat.map(r => r.name).join(', ')}`);
    for (const x of pl.split) lines.push(`• ${x.r.name}: cut into ${x.n} regions of at most ${APP.maxZones()} zones (same material, no overlap)`);
    if (pl.fail.length) lines.push(`• too large to expand, unchanged: ${pl.fail.map(r => r.name).join(', ')}`);
    if (!pl.flat.length && !pl.split.length) { toast(pl.fail.length ? 'Too large to expand: ' + pl.fail.map(r => r.name).join(', ') : 'Nothing to simplify'); return; }
    askConfirm('Bring the formulas within the limits?\n\n' + lines.join('\n'), 'Simplify').then(ok => { if (!ok) return; const r = APP.fixComplex(); toast(`${r.flat} region${r.flat > 1 ? 's' : ''} rewritten` + (r.split ? `, ${r.split} cut into ${r.split + r.added} regions` : '') + (r.failed.length ? `; too large to expand: ${r.failed.join(', ')}` : '')); APP.changed({ tree: true, right: true }); });
    return; } if (e.target.closest('[data-autoall]')) { const n = APP.autoInpAll(); toast(`${n} object${n > 1 ? 's' : ''} renamed for the INP file`); } if (e.target.closest('[data-skipunused]')) { const n = APP.skipUnusedBodies(); toast(`${n} unused object${n > 1 ? 's' : ''} no longer exported`); } });
function applyChecksFold() { const f = !!S.opt.checksFold, a = $('#inpIssues'); if (!a) return; a.classList.toggle('fold', f); $('#isFold').setAttribute('aria-expanded', String(!f)); }
$('#isFold').onclick = () => { S.opt.checksFold = !S.opt.checksFold; applyChecksFold(); APP.save(); };
applyChecksFold();
$('#inpFull').onchange = (e) => { S.opt.inpFull = e.target.checked; updateInp(); APP.save(); };
$('#inpComments').onchange = (e) => { S.opt.inpComments = +e.target.value; updateInp(); APP.save(); if (dlgSet.open) openSettings(); };
$('#inpZones').onchange = (e) => { S.opt.inpZones = e.target.checked; updateInp(); APP.save(); if (dlgSet.open) openSettings(); };
$('#inpTransform').onchange = (e) => { S.opt.inpTransform = e.target.checked; updateInp(); APP.save(); if (dlgSet.open) openSettings(); };
$('#inpStyle').onchange = (e) => { S.opt.style = +e.target.value; updateInp(); APP.save(); };
$('#btnInpCopy').onclick = () => copyText(APP.inpText());
$('#btnInpSave').onclick = () => {
  const blob = new Blob([APP.inpText()], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = APP.fileBase() + '.inp';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const dlg = $('#dlgImport');
function openImport() { if (!dlg.open) dlg.showModal(); }
$('#btnInpImport').onclick = openImport;
$('#btnPickInp').onclick = () => $('#fileInp').click();
$('#fileInp').onchange = async (e) => { const fl = e.target.files[0]; if (fl) $('#importText').value = await fl.text(); e.target.value = ''; };
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok') return;
  const mode = (document.querySelector('input[name=impMode]:checked') || {}).value || 'replace';
  const res = APP.importInp($('#importText').value, mode);
  const xi = res && res.xfInfo && res.xfInfo.total ? ` — ${res.xfInfo.created} coordinate system${res.xfInfo.created > 1 ? 's' : ''} from the ROT-DEFI cards (${res.xfInfo.bodies} bod${res.xfInfo.bodies > 1 ? 'ies' : 'y'} attached${res.xfInfo.unused.length ? `, unused: ${res.xfInfo.unused.join(', ')}` : ''})` : '';
  if (res && res.warnings && res.warnings.length) toast('Import' + xi + ' : ' + res.warnings[0]);
  else if (res) toast('Import finished' + xi);
  dlg.returnValue = '';
});

/* ---------- Loading meshes ---------- */
async function loadStlFiles(files) {
  let ok = 0;
  for (const file of files) {
    if (!/\.(stl|obj)$/i.test(file.name)) { toast('Ignored (neither .stl nor .obj): ' + file.name); continue; }
    try {
      toast('Reading ' + file.name + '…');
      const buf = await file.arrayBuffer();
      const res = FK.parseMesh(buf, file.name);
      if (!res.count) { toast('Empty or unreadable mesh: ' + file.name); continue; }
      const base = file.name.replace(/\.(stl|obj)$/i, ''), kind = res.format === 'OBJ' ? 'OBJ' : res.binary ? 'binary STL' : 'ASCII STL';
      if (res.parts && res.parts.length > 1) {      // several objects in one file → independent CAD objects
        const names = new Set(S.stls.map(m => m.name));
        res.parts.forEach((pt, k) => {
          let nm = pt.name && pt.name !== 'default' ? pt.name : base + '_' + (k + 1); for (let q = 2; names.has(nm); q++) nm = (pt.name || base) + ' (' + q + ')'; names.add(nm);
          const stl = { id: APP.nid(), name: nm, file: file.name, format: res.format || 'STL', raw: pt.positions, unit: 'mm', offset: [0, 0, 0], flip: false, visible: true, opacity: 0.6, color: FK.PALETTE[(S.stls.length + k) % FK.PALETTE.length], edges: pt.count <= 80000, group: null, mesh: null };
          APP.buildStl(stl); S.stls.push(stl); S.sel = { t: 'stl', id: stl.id };
        });
        ok++;
        toast(`${file.name}: ${res.parts.length} objects → ${res.parts.length} independent meshes (${res.count} triangles, ${kind}) — assumed unit: mm`);
        continue;
      }
      const stl = { id: APP.nid(), name: base, file: file.name, format: res.format || 'STL', raw: res.positions, unit: 'mm', offset: [0, 0, 0], flip: false, visible: true, opacity: 0.6, color: '#8f9bb0', edges: res.count <= 80000, group: null, mesh: null };
      APP.buildStl(stl); S.stls.push(stl); S.sel = { t: 'stl', id: stl.id }; ok++;
      let extra = '';
      if (res.count <= 300000) { const nc = FK.meshComponents(res.positions).filter(c => c.count >= 4).length; if (nc > 1) extra = ` — ${nc} disjoint solids: use Operations ▸ Split into solids`; }
      toast(`${file.name}: ${res.count} triangles (${kind}) — assumed unit: mm${extra}`);
    } catch (e) { console.error(e); toast('Read error: ' + e.message); }
  }
  if (ok) APP.changed({ tree: true, right: true, fit: true });
}
$('#fileStl').onchange = (e) => { loadStlFiles(Array.from(e.target.files)); e.target.value = ''; };
const vp = $('#viewport');
const updateDrop = updateDropHint;
vp.addEventListener('dragover', e => { e.preventDefault(); $('#dropHint').hidden = false; $('#dropHint').style.display = ''; });
vp.addEventListener('dragleave', () => { updateDrop(); });
vp.addEventListener('drop', e => { e.preventDefault(); updateDrop(); if (e.dataTransfer && e.dataTransfer.files.length) loadStlFiles(Array.from(e.dataTransfer.files)); });

/* ---------- Keyboard ---------- */
window.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if ((e.ctrlKey || e.metaKey) && !typing) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? APP.redo() : APP.undo(); }
    else if (k === 'y') { e.preventDefault(); APP.redo(); }
  }
  if (e.key === 'Escape') { if (!ctxEl.hidden) { hideMenu(); return; } if (dlg.open) return; if (S.fill) { cancelFill(); return; } if (S.tool !== 'select') setTool('select'); else if (S.pick) { clearPick(); renderRight(); updateStatus(); } else if (S.info) { setTool('select'); } }
  if (e.key === 'Enter' && !typing && S.fill) { e.preventDefault(); finishCirclePts(); }
  if (e.key === 'Delete' && !typing && S.sel && !dlg.open && !S.fill) { e.preventDefault(); const ml = multiList(); if (ml) deleteMany(ml); else APP.deleteSel(); }
});
