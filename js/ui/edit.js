/* ui/edit.js — Property editing
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Property editing ---------- */
function onField(e) {
  const t = e.target;
  const it = APP.selItem();
  if (t.dataset.opt === 'scaleOpen') { S.opt.scaleOpen = t.checked; const bx = $('#rightBody .scalebox'); if (bx) bx.hidden = !t.checked; APP.save(); return; }
  if (t.dataset.opt) return onOptChange(e);
  if (t.dataset.sc) {
    const sc = S.opt.scale, k = t.dataset.sc;
    if (k === 'val') { const v = parseFloat(t.value); if (isFinite(v)) sc.val = v; } else sc[k] = t.value;
    if (k === 'mode') { const u = $('[data-sc=unit]'); if (u) u.disabled = t.value === 'pct'; if (t.value === 'pct' && sc.val === 20) { sc.val = 120; $('[data-sc=val]').value = 120; } if (t.value === 'margin' && sc.val === 120) { sc.val = 20; $('[data-sc=val]').value = 20; } }
    APP.save(); return;
  }
  if (t.dataset.cp !== undefined || t.dataset.cpPrefix !== undefined) {
    if (!it || S.sel.t !== 'comp') return;
    if (t.dataset.cpPrefix !== undefined) { if (e.type !== 'change') return; if (!APP.compSetPrefix(it, t.value)) t.value = it.prefix; return; }
    const q = (FK.TEMPLATES[it.tpl].params.find(x => x.k === t.dataset.cp)) || {};
    const v = q.bool ? (t.checked ? 1 : 0) : parseFloat(t.value);
    if (!isFinite(v)) return;
    APP.snap('comp' + it.id + t.dataset.cp);
    if (e.type === 'input') { APP.compSetParam(it, t.dataset.cp, v, true); const m = $('#compMsg'); if (m) m.innerHTML = compMsgHTML(it); }   // live: no re-render, the field keeps the focus
    else APP.compSetParam(it, t.dataset.cp, v);
    return;
  }
  const k = t.dataset.k;
  if (k === 'title') { if (e.type === 'input') { APP.snap('title'); S.model.title = t.value; APP.changed({}); } return; }
  if (!it || !S.sel) return;
  const type = S.sel.t, key = type + it.id;
  if (t.dataset.cd !== undefined) { if (S.sel.t === 'csys') onCsDefField(e, t, it); return; }
  if (t.dataset.cf !== undefined) { if (S.sel.t === 'csys') { if (it.def && (e.type === 'input' || e.type === 'change')) { it.def = null; } onCsysField(e, t, it); } return; }
  if (t.dataset.bf !== undefined) {
    if (e.type !== 'input') return;
    const v = parseFloat(t.value); if (!isFinite(v)) return;
    APP.snap(key + 'bf' + t.dataset.bf);
    it.p[+t.dataset.bf] = v;
    if (it.meta && it.meta.src) delete it.meta.src;
    APP.changed({}); return;
  }
  if (t.dataset.tf !== undefined) {
    if (e.type !== 'input' && e.type !== 'change') return;
    const q = t.dataset.tf;
    if (q[0] === 'd' && q.length === 2) { const v = parseFloat(t.value); if (isFinite(v)) XF.d[+q[1]] = v; }
    else if (q === 'ang') { const v = parseFloat(t.value); if (isFinite(v)) XF.ang = v; }
    else if (q === 'axis') XF.axis = t.value;
    else XF[q] = +t.value;
    if (q === 'cs' || q === 'axis' || q[0] === 'd' || q === 'ang') xfPreview();
    return;
  }
  if (t.dataset.off !== undefined) {
    if (e.type !== 'input') return;
    const v = parseFloat(t.value); if (!isFinite(v)) return;
    it.offset[+t.dataset.off] = v; APP.buildStl(it); APP.changed({ keepPick: false }); return;
  }
  switch (k) {
    case 'name':
      if (e.type === 'input' && (type === 'body' || type === 'region')) { const c = t.selectionStart, v = t.value.replace(/[^A-Za-z0-9_]/g, '_'); if (v !== t.value) { t.value = v; try { t.setSelectionRange(c, c); } catch (err) { /* ignore */ } } return; }
      if (e.type !== 'change') return;
      if (type === 'body') { if (!APP.renameBody(it, t.value)) t.value = it.name; else t.value = it.name; }
      else if (type === 'region') { if (!APP.renameRegion(it, t.value)) t.value = it.name; else t.value = it.name; }
      else if (type === 'stl') { it.name = t.value.trim() || it.name; APP.changed({ tree: true }); }
      else if (type === 'csys') { if (!APP.renameCsys(it, t.value)) t.value = it.name; }
      else if (type === 'material') { if (!APP.renameMaterial(it, t.value)) t.value = it.name; else t.value = it.name; }
      else if (type === 'comp') { it.name = t.value.trim() || it.name; APP.changed({ tree: true }); }
      break;
    case 'mat': if (e.type === 'change' && type === 'region') APP.setRegionMaterial(it, +t.value); break;
    case 'bcs': if (e.type === 'change' && type === 'body') APP.setBodyCsys(it, +t.value, S.opt.keepPos === true); break;
    case 'cparent': if (e.type === 'change' && type === 'csys') { if (!APP.setCsysParent(it, +t.value, true)) renderRight(); } break;
    case 'cfrozen': if (e.type === 'change' && type === 'csys') APP.setCsysFrozen(it, t.checked); break;
    case 'cad': if (e.type === 'change') { APP.snap(); it.meta = it.meta || {}; if (t.value === '') delete it.meta.cad; else it.meta.cad = t.value === 'none' ? 0 : +t.value; APP.changed({ tree: true, right: true }); } break;
    case 'exportInp': if (e.type === 'change') {
      if (t.checked) { APP.snap(); delete it.noExport; APP.changed({ tree: true, right: true }); break; }
      const imp = APP.exportImpact(type, it).filter(x => !x.item.noExport);
      if (!imp.length) { APP.snap(); it.noExport = true; APP.changed({ tree: true, right: true }); break; }
      t.checked = true;                                   // stays checked until the user decides
      askImpact(type, it, imp).then(res => { if (res === 'cancel') return; APP.snap(); it.noExport = true; if (res === 'all') imp.forEach(x => { x.item.noExport = true; }); APP.changed({ tree: true, right: true }); });
    } break;
    case 'inpName': {
      if (e.type !== 'input' && e.type !== 'change') break;
      APP.snap(key + 'inpn'); const v = t.value.trim();
      if (v) it.inpName = v; else delete it.inpName;
      if (e.type === 'change') { APP.changed({ right: true }); break; }
      APP.changed({}); const h = $('#rightBody [data-inpnhint]'); if (h) h.innerHTML = inpNameHint(it, type, v || APP.inpNameOf(type, it));
      break;
    }
    case 'nvois': { const v = parseInt(t.value, 10); if (isFinite(v) && v >= 0) { APP.snap(key + 'nv'); it.nvois = v; APP.changed({}); } break; }
    case 'lnkA': case 'lnkOp': case 'lnkReg': case 'lnkMode': if (e.type === 'change' && it.meta && it.meta.link) {
      APP.snap(); const l = it.meta.link, i = +t.dataset.i;
      if (k === 'lnkA') l.a = +t.value; else if (k === 'lnkMode') l.mode = t.value;
      else if (k === 'lnkOp') { if (i === 0) l.op = t.value; else l.more[i - 1].op = t.value; }
      else { if (i === 0) l.b = +t.value; else l.more[i - 1].id = +t.value; }
      APP.changed({ tree: true, right: true });
    } break;
    case 'expr': if (it.meta && it.meta.link) break; APP.snap(key + 'expr'); it.expr = t.value; APP.changed({}); break;
    case 'color': if (e.type === 'input') { APP.snap(key + 'col'); it.color = t.value; APP.changed({ tree: true, csys: type === 'csys' }); } break;
    case 'look': if (e.type === 'change') { APP.snap(); if (t.value) it.look = t.value; else delete it.look; APP.applyStyles(); APP.changed({ tree: true }); } break;
    case 'opacity': if (e.type === 'input') { it.opacity = (+t.value) / 100; APP.applyStyles(); APP.changed({ tree: true }); } break;
    case 'visible': if (e.type === 'change') { APP.snap(); it.visible = t.checked; APP.changed({ tree: true, csys: type === 'csys' }); } break;
    case 'unit': if (e.type === 'change') { it.unit = t.value; APP.buildStl(it); APP.changed({ right: true, fit: true }); } break;
    case 'flip': if (e.type === 'change') { it.flip = t.checked; APP.changed({}); toast('Normals ' + (it.flip ? 'flipped' : 'normal') + ' (used for planes)'); } break;
    case 'edges': if (e.type === 'change') { it.edges = t.checked; APP.buildStl(it); APP.changed({}); } break;
  }
}
$('#rightBody').addEventListener('input', onField);
$('#rightBody').addEventListener('change', onField);

function selectedBodyRppFromBox(box) { APP.rppFromBox(box); }
function onActClick(e) {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const it = APP.selItem(), act = a.dataset.act, pk = S.pick;
  if (/^m[A-Z]/.test(act)) { multiAct(act); return; }
  switch (act) {
    case 'openRight': break;
    case 'winToggle': S.winOpen = !S.winOpen; renderToolWin(); break;
    case 'clearMeasures': APP.snap(); S.measures = []; APP.changed({ tree: true, measures: true, right: true }); break;
    case 'rppLastMeasure': { const m = S.measures[S.measures.length - 1]; if (m) APP.createRpp(m.a, m.b); break; }
    case 'clearPick': clearPick(); renderRight(); updateStatus(); break;
    case 'activeCs': break;
    case 'copyPick': if (pk) copyText(pkText(pk)); break;
    case 'pickPlane': if (pk && pk.kind === 'face') { APP.createPlaneFromPick(pk); } break;
    case 'pickField': if (it && S.sel.t === 'body') startFill({ kind: 'body', id: it.id, g: +a.dataset.g, only: a.dataset.i === undefined ? undefined : +a.dataset.i, alt: a.dataset.alt === undefined ? undefined : +a.dataset.alt }); break;
    case 'flipVec': if (it && S.sel.t === 'body') { const g = APP.FIELD_GROUPS[it.type][+a.dataset.g]; APP.flipFieldVec(it, g.idx); APP.changed({ tree: true, right: true }); } break;
    case 'fillDone': finishCirclePts(); break;
    case 'fillUndo': if (S.fillPts && S.fillPts.length) { S.fillPts.pop(); APP.setPending(S.fillPts.slice()); renderToolOpts(); updateStatus(); } break;
    case 'pickCsysPos': if (it && S.sel.t === 'csys') startFill({ kind: 'csys', id: it.id, only: a.dataset.i === undefined ? undefined : +a.dataset.i }); break;
    case 'rtab': S.rtab = a.dataset.tab; $$('#rightBody .rtab').forEach(x => x.classList.toggle('on', x.dataset.tab === S.rtab)); $$('#rightBody .rpane').forEach(x => { x.hidden = x.dataset.pane !== S.rtab; }); break;
    case 'look': break;
    case 'cadShow': case 'cadHide': case 'cadIsolate': if (it && S.sel.t === 'stl') { const k = APP.cadVisibility(it.id, act === 'cadShow' ? 'show' : act === 'cadHide' ? 'hide' : 'isolate'); toast(k + ' linked object(s) ' + (act === 'cadHide' ? 'hidden' : act === 'cadShow' ? 'shown' : 'isolated')); } break;
    case 'cadCompare': if (it && S.sel.t === 'stl') openDevDlg({ cad: it.id }); break;
    case 'lnkAdd': if (it && it.meta && it.meta.link) {
      const l = it.meta.link, dep = APP.linkDependents(it.id), used = new Set(APP.linkIds(l)), cand = S.model.regions.filter(x => x.id !== it.id && !dep.has(x.id));
      const nx = cand.find(x => !used.has(x.id)) || cand[0]; if (!nx) { toast('No other region'); break; }
      APP.snap(); (l.more || (l.more = [])).push({ op: 'union', id: nx.id }); APP.changed({ tree: true, right: true });
    } break;
    case 'lnkDel': if (it && it.meta && it.meta.link) {
      const l = it.meta.link, i = +a.dataset.i; if (APP.linkOps(l).length < 2) break;
      APP.snap(); if (i === 0) { const f = l.more.shift(); l.op = f.op; l.b = f.id; } else l.more.splice(i - 1, 1);
      APP.changed({ tree: true, right: true });
    } break;
    case 'unlinkRegion': if (it && it.meta && it.meta.link) { APP.snap(); delete it.meta.link; APP.changed({ tree: true, right: true }); toast('Link removed; the formula is kept'); } break;
    case 'snapCheck': if (it && S.sel.t === 'body') suggestSnap(it, true); break;
    case 'pickRegion': if (it && S.sel.t === 'region') { if (it.meta && it.meta.link) { toast('This region follows a live link: its formula is read-only'); break; } S.cutRid = it.id; setTool('regpick'); if (narrow()) setDrawer('right', false); } break;
    case 'cmPaste': if (it && S.sel.t === 'csys') {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Clipboard not accessible here: click a matrix cell and press Ctrl+V'); break; }
      navigator.clipboard.readText().then(tx => applyMatrixText(it, tx)).catch(() => toast('Clipboard access refused: click a matrix cell and press Ctrl+V'));
    } break;
    case 'cmInvert': if (it && S.sel.t === 'csys') {
      const inv = FK.M.inv(it.m); if (!inv || !inv.every(Number.isFinite)) { toast('This matrix cannot be inverted'); break; }
      if (APP.setCsysLocal(it, inv, null, false)) toast(`${it.name}: matrix inverted (it now maps the other way)`);
    } break;
    case 'csdPick': if (it && S.sel.t === 'csys' && it.def) { const path = a.dataset.path, sl = APP.csSlot(it.def, path); startFill({ kind: 'csdef', id: it.id, slot: path, mode: SLOT_MODE[sl.src] || 'vertex' }); } break;
    case 'csdPickAxis': if (it && S.sel.t === 'csys' && it.def) { const ax = a.dataset.ax, src = it.def[ax].src; startFill({ kind: 'csdef', id: it.id, ax, mode: src === 'face' ? 'face' : src === 'edge' ? 'edge' : 'circ' }); } break;
    case 'csdFlip': if (it && S.sel.t === 'csys' && it.def) { APP.snap('csdef' + it.id); const ax = it.def[a.dataset.ax]; ax.flip = !ax.flip; APP.applyCsysDef(it, 'csdef' + it.id); APP.changed({ tree: true, right: true }); } break;
    case 'inpNameAuto': if (it && (S.sel.t === 'body' || S.sel.t === 'region')) { APP.snap(); const n = APP.setSmartInpName(S.sel.t, it); APP.changed({ right: true }); toast(`INP name: ${n}`); } break;
    case 'ptUndo': S.ptPlanes = (S.ptPlanes || []).slice(0, -1); ptRefreshPending(); renderToolOpts(); updateStatus(); break;
    case 'cutRegion': if (it && S.sel.t === 'region') { S.cutRid = it.id; setTool('regcut'); if (narrow()) setDrawer('right', false); } break;
    case 'regFromBodyCut': if (it && S.sel.t === 'body') { APP.snap(); const r = APP.addRegion(APP.regionNameFor(it.name), '+' + it.name, { visible: true }); S.sel = { t: 'region', id: r.id }; S.cutRid = r.id; APP.changed({ tree: true, right: true }); S.opt.cutStay = true; setTool('regcut'); if (narrow()) setDrawer('right', false); } break;
    case 'regionCompare': if (it && S.sel.t === 'region') openDevDlg({ region: it.id }); break;
    case 'splitStl': if (it && S.sel.t === 'stl') splitStl(it); break;
    case 'boolRegion': if (it && S.sel.t === 'region') openBoolDlg(it); break;
    case 'voidRegion': if (it && S.sel.t === 'region') openVoidDlg(it); break;
    case 'detectFeat': if (it && S.sel.t === 'stl') openFeatDlg(it); break;
    case 'csysCut': if (it && S.sel.t === 'csys') APP.cutUseSrc('cs:' + it.id + ':' + a.dataset.pl); break;
    case 'csysExport': if (it && S.sel.t === 'csys') { APP.setExportCsys(APP.exportCs() === it.id ? 0 : it.id); renderRight(); } break;
    case 'compRegen': if (it && S.sel.t === 'comp') { APP.snap(); APP.compRegen(it); APP.changed({ tree: true, right: true }); } break;
    case 'compDetach': if (it && S.sel.t === 'comp') APP.compDetach(it); break;
    case 'compDel': if (it && S.sel.t === 'comp') APP.deleteComp(it.id, false); break;
    case 'compSel': selectItem(a.dataset.t, +a.dataset.id); break;
    case 'compOwner': { const c = APP.compOf(it); if (c) selectItem('comp', c.id); break; }
    case 'csysActivate': if (it && S.sel.t === 'csys') { APP.setActiveCsys(it.id); renderRight(); } break;
    case 'pickCsysPoint': if (pk) { const c = APP.createCsysWorld(FK.M.fromPosEuler(pk.p, [0, 0, 0])); if (c) toast('Coordinate system ' + c.name + ' created (axes parallel to world)'); } break;
    case 'pickCsysFace': if (pk && pk.kind === 'face') { const c = APP.createCsysWorld(APP.csysFromNormal(pk.centroid, pk.normal)); if (c) toast('Coordinate system ' + c.name + ' created: Z = face normal'); } break;
    case 'pickRppFace': if (pk && pk.bbox) selectedBodyRppFromBox(pk.bbox); break;
    case 'pickRppObj': if (pk) { const bb = APP.objectStats(pk).bbox; if (bb) selectedBodyRppFromBox(bb); } break;
    case 'tfApply': case 'tfAlign': {
      const list = xfTargets(); if (!list.length) break;
      let mw;
      if (act === 'tfApply') mw = xfMatrix();
      else { if ((XF.from | 0) === (XF.to | 0)) { toast('Choose two different coordinate systems'); break; } mw = FK.M.mul(APP.csysWorld(XF.to | 0), FK.M.inv(APP.csysWorld(XF.from | 0))); }
      if (!mw || FK.M.isIdentity(mw, 1e-12)) { toast('Nothing to apply'); break; }
      const lab = act === 'tfApply' ? [XF.ang ? `Rotate ${XF.axis} ${fmt(XF.ang, 6)}°` : '', XF.d.some(v => v) ? `Translate (${XF.d.map(v => fmt(v, 6)).join(', ')}) cm` : ''].filter(Boolean).join(' + ') + ' in ' + APP.csysLabel(XF.cs | 0) : `Align ${APP.csysLabel(XF.from | 0)} → ${APP.csysLabel(XF.to | 0)}`;
      xfReset();
      for (const m of list) APP.transformStl(m, mw, lab);
      APP.changed({ tree: true, right: true, keepPick: false }); toast(`${list.length} mesh${list.length > 1 ? 'es' : ''} transformed`); break;
    }
    case 'tfReset': xfReset(); renderRight(); break;
    case 'tfDel': if (it && S.sel.t === 'stl') { xfReset(); APP.removeStlStep(it, +a.dataset.i); APP.changed({ tree: true, right: true, keepPick: false }); } break;
    case 'tfClear': if (it && S.sel.t === 'stl' && it.steps && it.steps.length) { xfReset(); it.steps = []; APP.buildStl(it); APP.changed({ tree: true, right: true, keepPick: false }); } break;
    case 'rppStl': if (it && it.stats && it.stats.bbox) { const nb = APP.rppFromBox(it.stats.bbox); nb.meta = nb.meta || {}; nb.meta.cad = it.id; APP.changed({ tree: true, right: true }); } break;
    case 'rppMeasure': if (it) APP.createRpp(it.a, it.b); break;
    case 'del': APP.deleteSel(); break;
    case 'dup':
      if (S.sel.t === 'body') { const c = APP.duplicateBody(it); S.sel = { t: 'body', id: c.id }; }
      else if (S.sel.t === 'region') { const c = APP.duplicateRegion(it); S.sel = { t: 'region', id: c.id }; }
      else if (S.sel.t === 'csys') { APP.duplicateCsys(it); break; }
      APP.changed({ tree: true, right: true }); break;
    case 'scale': case 'scaleDup': {
      const sc = S.opt.scale;
      if (it && S.sel.t === 'body') APP.scaleBody(it, sc.mode, sc.val, sc.unit, act === 'scaleDup');
      break;
    }
    case 'exprSimplify': case 'exprFlatten': {
      const r = APP.getRegion(+a.dataset.rid); if (!r) break;
      const res = act === 'exprSimplify' ? APP.simplifyRegion(r) : APP.flattenRegion(r);
      if (res.error) { toast(res.error); break; }
      toast(res.same ? 'Nothing to change' : (act === 'exprSimplify' ? 'Formula simplified' : 'Formula flattened' + (res.zones ? ` (${res.zones} zone${res.zones > 1 ? 's' : ''})` : '')));
      APP.changed({ tree: true, right: true }); break;
    }
    case 'exprSplit': {
      const r = APP.getRegion(+a.dataset.rid); if (!r) break;
      const pl = APP.splitPlan(r); if (pl.error) { toast(pl.error); break; }
      askConfirm(`Split "${r.name}" into ${pl.list.length} region${pl.list.length > 1 ? 's' : ''} without overlap, same material and group?\n\n` + pl.list.map((e, i) => `${pl.names[i]}:  ${e}`).join('\n'), 'Split').then(ok => {
        if (!ok) return;
        const res = APP.splitRegion(r); if (res.error) { toast(res.error); return; }
        toast(`${r.name} split into ${res.regions.length} regions`); APP.changed({ tree: true, right: true });
      }); break;
    }
    case 'applyFix': { const r = APP.getRegion(+a.dataset.rid); if (r) { APP.snap(); r.expr = a.dataset.expr; APP.changed({ tree: true, right: true }); } break; }
    case 'flipPlane': if (it && FK.flipPlane(it)) { APP.snap(); if (it.meta) delete it.meta.src; APP.changed({ right: true }); } break;
    case 'replane': if (it) { S.reassign = it.id; setTool('replane'); if (narrow()) setDrawer('right', false); } break;
    case 'termAdd': case 'termSub': case 'termUnion': case 'termParen': {
      if (!it || S.sel.t !== 'region') break;
      const n = $('#termBody').value;
      if ((act === 'termAdd' || act === 'termSub') && !n) { toast('Choose a body in the list first'); break; }
      insertInExpr(act === 'termAdd' ? 'term' : act === 'termSub' ? 'term' : act === 'termUnion' ? 'union' : 'paren', (act === 'termSub' ? '-' : '+') + n);
      break;
    }
    case 'termDel': {
      const n = $('#termBody').value; if (!n || !it) break;
      try { APP.snap(); it.expr = FK.removeTermFromExpr(it.expr, n); $('#exprArea').value = it.expr; APP.changed({}); updateExprMirror(); } catch (err) { toast(err.message); }
      break;
    }
  }
}
$('#rightBody').addEventListener('click', onActClick);
$('#toolwin').addEventListener('click', onActClick);
