/* ui/legend.js — "Colour regions by material": toggle and legend over the 3D view
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
function toggleColorBy() {
  S.opt.colorBy = S.opt.colorBy === 'material' ? '' : 'material';
  APP.applyStyles(); updateLegend(); APP.save();
  toast(S.opt.colorBy === 'material' ? 'Regions coloured by material' : 'Own colours');
}
/** Legend: the materials used by the regions (with the count), plus "no material" when some regions have none. */
function updateLegend() {
  let el = document.getElementById('matLegend');
  if (!el) { el = document.createElement('div'); el.id = 'matLegend'; document.getElementById('viewport').appendChild(el); }
  if (S.opt.colorBy !== 'material') { el.hidden = true; return; }
  const cnt = new Map(); let none = 0;
  for (const r of S.model.regions) { if (r.noExport) continue; if (APP.getMaterial(r.mat)) cnt.set(r.mat, (cnt.get(r.mat) || 0) + 1); else none++; }
  const rows = (S.model.materials || []).filter(m => cnt.has(m.id)).map(m => `<div><i style="background:${APP.materialColor(m.id)}"></i>${esc(m.name)} <span>${cnt.get(m.id)}</span></div>`);
  if (none) rows.push(`<div><i style="background:${APP.materialColor(0)}"></i>no material <span>${none}</span></div>`);
  el.innerHTML = '<b>Material</b>' + (rows.join('') || '<div>—</div>');
  el.hidden = false;
}
