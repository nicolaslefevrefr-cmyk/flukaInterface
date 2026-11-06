/* ui/status.js — Status bar, confirmation dialogs, project files
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Status ---------- */
let hoverText = '';
function pkSummary(pk) {
  if (!pk) return '';
  switch (pk.kind) {
    case 'point': return `${pk.snapped ? 'Vertex' : 'Point'} (${xyz(pk.p, 3)}) cm`;
    case 'edge': return pk.none ? 'No sharp edge here (see the "sharp edges" option)' : pk.circle ? `Circular rim: R = ${f(pk.circle.r, 4)} cm, centre (${xyz(pk.circle.c, 3)}), ${pk.loop.segments} segments` : `Edge: ${f(pk.chain ? pk.chain.length : pk.length, 4)} cm${pk.chain ? ' (' + pk.chain.segments + ' segments)' : ''}`;
    case 'face': return `Face: ${f(pk.area, 4)} cm² · ${pk.count} triangle${pk.count > 1 ? 's' : ''} · n = (${xyz(pk.normal, 3)})`;
    case 'object': { const st = APP.objectStats(pk); return `Object ${esc(pk.ownerName)}${st.volume !== undefined && st.volume !== null ? ' · V = ' + f(st.volume, 3) + ' cm³' : ''}`; }
  }
  return '';
}
function updateStatus() {
  let t = '';
  if (S.fill) {
    const sp = fillSpec(), one = S.fill.only !== undefined ? ' (single coordinate)' : '';
    if (S.fill.kind === 'csdef') t = 'Define the coordinate system' + modeHint() + ' · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
    else if (sp && sp.kind === 'circlePts') t = `Click points on the circle (${(S.fillPts || []).length} picked, at least 3) · <a href="#" data-act="fillDone">Done (Enter)</a> · <a href="#" data-act="fillUndo">Undo last</a> · <a href="#" data-act="cancelFill">Cancel (Esc)</a>`;
    else if (sp && sp.kind === 'circleEdge') t = 'Click a circular edge (rim): its circle gives the centre · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
    else if (sp && sp.kind === 'dirEdge') t = 'Click an edge: its normalized direction gives the vector · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
    else if (sp && sp.kind === 'radiusEdge') t = 'Click an arc edge (radius of its circle) or a straight edge (its length) · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
    else t = sp && sp.kind === 'normal' ? 'Pick: click a face to take its outward normal · <a href="#" data-act="cancelFill">Cancel (Esc)</a>'
      : 'Pick: click a point in the view' + (sp && sp.kind === 'radius' ? ' on the surface' : '') + (S.fill.kind === 'csys' ? modeHint() : '') + one + ' · <a href="#" data-act="cancelFill">Cancel (Esc)</a>';
  } else if (S.tool === 'select') {
    t = !S.info ? '' : S.pick ? esc(pkSummary(S.pick)) + ' <a href="#" data-act="openRight">Details ▸</a>'
      : { point: 'Click a vertex of the model', edge: 'Click an edge', face: 'Click a face (triangle or planar face)', object: 'Click an object' }[S.filter];
  } else if (S.tool === 'measure') t = (S.pending ? 'Distance: click point B' : 'Distance: click point A') + modeHint() + ' · <a href="#" data-act="cancelTool">Cancel (Esc)</a>';
  else if (S.tool === 'csys3') t = 'Coordinate system: click ' + ['the origin', 'a point on the X axis', 'a point in the XY plane (+Y side)'][(S.cs3 || []).length] + modeHint();
  else if (S.tool === 'rpp') t = (S.pending ? 'RPP: click the opposite corner (point 2)' : 'RPP: click the first corner (point 1)') + modeHint();
  else if (S.tool === 'regpick') { const r = APP.getRegion(S.cutRid); t = `Pick a body or plane for ${r ? esc(r.name) : 'the region'}: click it in the view · <a href="#" data-act="cancelTool">Cancel (Esc)</a>`; }
  else if (S.tool === 'regcut') { const r = APP.getRegion(S.cutRid); t = `Cut ${r ? esc(r.name) : 'the region'}: click a face of a mesh or object · <a href="#" data-act="cancelTool">Done (Esc)</a>`; }
  else if (S.tool === 'plane') t = 'Plane: click a triangle / face — its normal gives the PLA vector H';
  else if (S.tool === 'viewface') t = 'Click a face to look at it · <a href="#" data-act="cancelTool">Cancel (Esc)</a>';
  else if (S.tool === 'replane') { const b = APP.getBody(S.reassign); t = `Click the new face for ${b ? esc(b.name) : 'the plane'}`; }
  if (hoverText && !(S.tool === 'select' && S.pick)) t += (t ? ' · ' : '') + '<span class="muted">' + esc(hoverText) + '</span>';
  $('#status').innerHTML = t ? `<span>${t}</span>` : '';
}
document.addEventListener('change', e => { if (e.target && e.target.id === 'termBody') S.termSel = e.target.value; });
$('#status').addEventListener('click', e => { if (e.target.closest('[data-act=cancelTool]')) { e.preventDefault(); setTool('select'); } });
$('#status').addEventListener('click', e => { const a = e.target.closest('[data-act=fillDone],[data-act=fillUndo]'); if (!a) return; e.preventDefault(); if (a.dataset.act === 'fillDone') finishCirclePts(); else if (S.fillPts && S.fillPts.length) { S.fillPts.pop(); APP.setPending(S.fillPts.slice()); renderToolOpts(); updateStatus(); } });
$('#status').addEventListener('click', e => { if (e.target.closest('[data-act=cancelFill]')) { e.preventDefault(); cancelFill(); } });
$('#status').addEventListener('click', e => { if (e.target.closest('[data-act=openRight]')) { e.preventDefault(); setDrawer('right', true); } });

/* ---------- Dialogs: confirm, File menu, settings, project files ---------- */
// Close dialogs explicitly: <form method="dialog"> submission is blocked in sandboxed iframes.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('dialog button[value]');
  if (!b) return;
  const d = b.closest('dialog'); e.preventDefault();
  if (d.open) d.close(b.value);
});
function askConfirm(msg, okLabel) {
  return new Promise(res => {
    const d = $('#dlgConfirm'); $('#confirmMsg').textContent = msg; $('#confirmOk').textContent = okLabel || 'OK'; d.returnValue = '';
    const h = () => { d.removeEventListener('close', h); res(d.returnValue === 'ok'); };
    d.addEventListener('close', h); d.showModal();
  });
}
