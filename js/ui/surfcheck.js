/* ui/surfcheck.js — Surface consistency check window
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Surface consistency check (gaps / overlaps from sampled surfaces) ---------- */
const SF = { res: null, cur: -1 };
function sfInput() {
  const regs = S.model.regions.filter(r => !r.noExport && r.expr && r.expr.trim()), used = new Set();
  for (const r of regs) { try { for (const nm of FK.exprNames(FK.parseExpr(r.expr))) used.add(nm); } catch (e) { /* skipped later */ } }
  const bodies = S.model.bodies.filter(b => !b.noExport && used.has(b.name)).map(b => ({ name: b.name, wb: APP.wbody(b) }));
  let box = null;
  for (const b of bodies) { if (b.wb.type === 'RAW') continue; const bb = FK.bodyBBox(b.wb); if (bb) box = box ? { min: box.min.map((x, i) => Math.min(x, bb.min[i])), max: box.max.map((x, i) => Math.max(x, bb.max[i])) } : bb; }
  if (!box) return null;
  const pad = 0.05 * (Math.max(...box.max.map((x, i) => x - box.min[i])) || 1);
  box = { min: box.min.map(x => x - pad), max: box.max.map(x => x + pad) };
  return { bodies, box, regions: regs.map(r => ({ name: r.name, expr: r.expr, black: FK.materialName(S.model, r) === 'BLCKHOLE' })) };
}
const sfNum = (id, k) => Math.max(0, parseFloat($(id).value) || 0) * k;
function sfRun() {
  const inp = sfInput(), sum = $('#sfSum'); SF.cur = -1;
  if (!inp || !inp.regions.length) { sum.innerHTML = '<span class="muted">Nothing to check: no exported region with a finite body.</span>'; $('#sfList').innerHTML = ''; SF.res = null; return null; }
  const R = SF.res = FK.surfaceCheck(inp, { perBody: Math.max(50, +$('#sfPer').value || 2500), maxTotal: Math.max(1000, +$('#sfMax').value || 150000), spacing: sfNum('#sfSpacing', 0.1), eps: sfNum('#sfEps', 0.1), group: sfNum('#sfGroup', 0.1), blackOutside: $('#sfBlack').checked, reportUndef: $('#sfUndef').checked, only: $('#sfOnly').value || undefined });
  const f = (x) => (x * 10).toPrecision(3), li = [];
  li.push(R.nIssues ? `<span class="bad">✖ ${R.nIssues} error${R.nIssues > 1 ? 's' : ''}: ${R.gaps} gap${R.gaps > 1 ? 's' : ''}, ${R.overlaps} overlap${R.overlaps > 1 ? 's' : ''}</span>` : '<span class="good">✔ No gap and no overlap found</span>');
  li.push(`<div class="muted">${R.points} surface points on ${R.bodies} bodies (mean spacing ≈ ${f(R.spacing)} mm, ε ${R.eps ? f(R.eps) + ' mm' : 'automatic ≈ ' + (R.epsUsed * 1e4).toPrecision(2) + ' µm'}, grouping ${R.group ? f(R.group) + ' mm' : 'automatic'}) · ${R.ms} ms${R.blackSkipped ? ` · ${R.blackSkipped} points facing a black hole ignored` : ''}</div>`);
  if (R.undefSkipped) li.push(`<div class="muted">ⓘ ${R.undefSkipped} point${R.undefSkipped > 1 ? 's' : ''} on ${R.undefBodies.map(esc).join(', ')} lie outside the defined space (no region on either side, e.g. beyond the black-hole boundary): ignored.</div>`);
  if (R.skippedBodies.length) li.push(`<div class="muted">ⓘ Surface not sampled (unsupported type): ${R.skippedBodies.map(esc).join(', ')}</div>`);
  if (R.skippedRegions.length) li.push(`<div class="muted">ⓘ Regions not evaluated (unsupported body or syntax): ${R.skippedRegions.map(esc).join(', ')} — the result may be incomplete</div>`);
  li.push('<div class="muted">A thin gap or overlap can still fall between two sample points: raise the number of points to be more thorough.</div>');
  sum.innerHTML = li.join('');
  const regList = (l) => l.length ? l.map(esc).join(', ') : '<i>none</i>';
  $('#sfList').innerHTML = R.issues.map((x, i) => `<button type="button" class="sfi ${x.kind}" data-i="${i}" title="Zoom to this point and show the objects concerned"><span class="n">${x.count} point${x.count > 1 ? 's' : ''}</span><span class="k">${x.kind === 'gap' ? '⚠ Gap — undefined space' : '✖ Overlap — several regions'}</span><br>Body <code>${esc(x.body)}</code> · Reg− ${regList(x.regMinus)} · Reg+ ${regList(x.regPlus)}<br><span class="xyz">(${x.p.map(v => v.toFixed(4)).join(', ')}) cm</span></button>`).join('');
  sfMarks(-1);
  return R;
}
function sfMarks(sel) {
  const R = SF.res; if (!R || !R.issues.length) { APP.setCheckMarks(null); return; }
  const szOf = (x) => Math.max(x.h * 0.6, x.eps * 30), sz = R.issues.length ? Math.min(...R.issues.map(szOf)) : 1, cen = (k) => Float32Array.from([].concat(...R.issues.filter(x => x.kind === k).map(x => x.p)));
  const L = [{ centers: cen('overlap'), size: sz, color: 0xff3030 }, { centers: cen('gap'), size: sz, color: 0xff9900 }];
  if (sel >= 0) L.push({ centers: Float32Array.from(R.issues[sel].p), size: szOf(R.issues[sel]) * 1.8, color: 0xfff200 });
  APP.setCheckMarks(L);
}
/** Zoom to an error and, if asked, show only the body and the regions concerned. */
function sfGo(i) {
  const R = SF.res, x = R && R.issues[i]; if (!x) return;
  SF.cur = i; $$('#sfList .sfi').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
  if ($('#sfIso').checked) APP.isolate({ bodies: [x.body], regions: x.regMinus.concat(x.regPlus) });
  const ext = Math.max(x.size, x.h * 3, x.eps * 40), cam = APP.cam;
  cam.target.set(x.p[0], x.p[1], x.p[2]); cam.dist = Math.max(0.02, ext * 3.2); APP.applyCam();
  sfMarks(i);
  const b = S.model.bodies.find(q => q.name === x.body); if (b) { S.sel = { t: 'body', id: b.id }; APP.changed({ tree: true, right: true }); }
}
let toggleSurf = () => {};
(function () {
  const d = $('#dlgSurf'); if (!d) return;
  const place = () => { if (d.classList.contains('docked')) return; if (typeof d._x === 'number') { d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; } else { d.style.left = 'auto'; d.style.right = '12px'; d.style.top = '64px'; } };
  toggleSurf = () => { if (d.open) { d.close(); return; } d.show(); place(); syncToolbar(); };
  d.querySelector('[value=close]').onclick = () => d.close();
  d.addEventListener('close', () => { APP.setCheckMarks(null); APP.restoreIsolation(); syncToolbar(); });
  $('[data-dock=surf]').addEventListener('click', () => APP.dockToggle('surf'));
  let drag = null; const hh = d.querySelector('.fw-h');
  hh.addEventListener('pointerdown', e => { if (e.target.closest('button') || d.classList.contains('docked')) return; const r = d.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { hh.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  hh.addEventListener('pointermove', e => { if (!drag) return; d._x = Math.max(0, e.clientX - drag.dx); d._y = Math.max(0, e.clientY - drag.dy); d.style.left = d._x + 'px'; d.style.top = d._y + 'px'; d.style.right = 'auto'; });
  hh.addEventListener('pointerup', () => { drag = null; });
  const rs = d.querySelector('.fw-rs'); let rz = null;
  rs.addEventListener('pointerdown', e => { const r = d.getBoundingClientRect(); rz = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }; try { rs.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  rs.addEventListener('pointermove', e => { if (!rz) return; d.style.width = Math.round(Math.min(window.innerWidth - 20, Math.max(340, rz.w + e.clientX - rz.x))) + 'px'; d.style.height = Math.round(Math.min(window.innerHeight - 70, Math.max(300, rz.h + e.clientY - rz.y))) + 'px'; });
  rs.addEventListener('pointerup', () => { rz = null; }); rs.addEventListener('pointercancel', () => { rz = null; });
  $('#sfRun').onclick = () => { $('#sfSum').innerHTML = '<span class="muted">Running…</span>'; setTimeout(() => { try { sfRun(); } catch (e) { console.error(e); $('#sfSum').textContent = 'Check failed: ' + e.message; } }, 30); };
  $('#sfClear').onclick = () => { APP.setCheckMarks(null); };
  $('#sfRestore').onclick = () => { if (APP.restoreIsolation()) toast('Display restored'); };
  $('#sfList').addEventListener('click', e => { const b = e.target.closest('.sfi'); if (b) sfGo(+b.dataset.i); });
})();
