/* ui/region-editor.js — Region definition editor (chips, object picker, expression caret)
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Region definition: chips, object picker, "show used components" ---------- */
const bodyByName = (n) => S.model.bodies.find(b => b.name === n);
/** Name written in the INP file for a body (its own name when it is not exported): what chips and the object list show in a region definition. */
/** Real name of an object, with the name written in the INP file between parentheses when it differs. */
const objLabel = (b, map, always) => { if (!b) return ''; const i = inpLabel(b, map); return i && (always ? !b.noExport : i !== b.name) ? `${b.name} (${i})` : b.name; };
const inpLabel = (b, map) => (b && !b.noExport && (map || FK.inpNames(S.model).bodies).get(b)) || (b ? b.name : '');
/** Tokens of an expression with their position: [{ t, s, e }]. */
function exprTokens(v) {
  const re = /\s*([+\-|()]|[A-Za-z_][A-Za-z0-9_]*|\S)/g, out = []; let m;
  while ((m = re.exec(v)) && m[0].length) out.push({ t: m[1], s: m.index + m[0].length - m[1].length, e: m.index + m[0].length });
  return out;
}
/** Body terms of an expression: [{ s, e, name, sign }] (positions cover the sign and the name). */
function exprTerms(v) {
  const tk = exprTokens(v), out = [], isName = (t) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t);
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i];
    if ((t.t === '+' || t.t === '-') && tk[i + 1] && isName(tk[i + 1].t)) { out.push({ s: t.s, e: tk[i + 1].e, name: tk[i + 1].t, sign: t.t === '-' ? -1 : 1, ns: tk[i + 1].s }); i++; }
    else if (isName(t.t)) out.push({ s: t.s, e: t.e, name: t.t, sign: 1, ns: t.s, implicit: true });
  }
  return out;
}
/** Chips view (default, always for a linked region) or plain text editing. */
const exprRich = (lk) => S.opt.exprText !== true;   // a combination can be shown as text too (read-only)
function renderExprChips() {
  const box = $('#exprChips'), { ta } = exprEls(); if (!box || !ta) return;
  const v = ta.value, tk = exprTokens(v), terms = new Map(exprTerms(v).map(x => [x.s, x])), inm = FK.inpNames(S.model).bodies;
  let h = '';
  const st = S.exprSel && S.sel && S.exprSel.id === S.sel.id ? S.exprSel : { s: v.length }, caret = '<span class="ccaret"></span>';
  let placed = false; const at = Math.min(st.s, v.length);
  for (let i = 0; i < tk.length; i++) {
    if (!placed && tk[i].s >= at && at < v.length) { h += caret; placed = true; }
    const t = tk[i], term = terms.get(t.s);
    if (term) {
      const b = bodyByName(term.name);
      h += `<span class="chip ${term.sign < 0 ? 'neg' : 'pos'}${b ? '' : ' bad'}" data-s="${term.s}" data-e="${term.e}" data-n="${esc(term.name)}" title="${b ? esc(term.name + ' · ' + (b.type === 'RAW' ? b.rawType : b.type) + (inpLabel(b, inm) !== term.name ? ' · written ' + inpLabel(b, inm) + ' in the INP file' : '')) : 'Unknown object'}"><i class="cdot" style="background:${b ? b.color : '#bbb'}"></i><b>${term.sign < 0 ? '−' : '+'}</b>${esc(b ? objLabel(b, inm) : term.name)}</span>`;
      if (!term.implicit) i++;
    } else if (t.t === '|') h += `<span class="cop" data-e="${t.e}">∪</span>`;
    else if (t.t === '+' || t.t === '-') h += `<span class="cop" data-e="${t.e}">${t.t === '-' ? '−' : '+'}</span>`;
    else h += `<span class="cop" data-e="${t.e}">${esc(t.t)}</span>`;
  }
  if (!placed) h += caret;
  box.innerHTML = h;
}
/** Removes / inverts one term of the textarea expression (by position); keeps the rest of the text. */
function editTerm(s0, e0, mode) {
  const it = APP.selItem(), { ta } = exprEls(); if (!it || !ta || S.sel.t !== 'region' || (it.meta && it.meta.link)) return;
  let v = ta.value;
  const term = exprTerms(v).find(x => x.s === s0 && x.e === e0); if (!term) return;
  if (mode === 'invert') v = v.slice(0, term.s) + (term.sign < 0 ? '+' : '-') + v.slice(term.ns, term.e) + v.slice(term.e);
  else {
    v = v.slice(0, term.s) + v.slice(term.e);
    for (let k = 0; k < 6; k++) v = v.replace(/\(\s*\)/g, '').replace(/\|\s*(?=\||\)|$)/g, '').replace(/(^|\()\s*\|/g, '$1').replace(/[+-]\s*(?=\||\)|$)/g, '');
    v = v.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  }
  APP.snap(); it.expr = v; ta.value = v; S.exprSel = { id: it.id, s: v.length, e: v.length };
  APP.changed({}); updateExprMirror();
}
function goToBody(name) { const b = bodyByName(name); if (!b) { toast('No object named ' + name); return; } selectItem('body', b.id); }
/** Short blink of an object in the 3D view (even when hidden), without changing the selection. */
function flashBody(name) {
  const b = bodyByName(name); if (!b) return;
  let n = 0; clearInterval(S._hlT);
  const tick = () => { S.hlId = n % 2 === 0 ? b.id : 0; APP.applyStyles(); if (++n > 7) { clearInterval(S._hlT); S.hlId = 0; APP.applyStyles(); } };
  S._hlT = setInterval(tick, 260); tick();
}
function usedNames(v) { try { return [...FK.exprNames(FK.parseExpr(v))]; } catch (e) { return exprTerms(v).map(x => x.name); } }
/** "Components used" view: while the box is checked it follows the region being edited (and its expression). */
function refreshUsedView() {
  const it = APP.selItem(), { ta } = exprEls();
  if (!S.usedView || !S.isoSnap || !it || !ta || !S.sel || S.sel.t !== 'region') return;
  const names = usedNames(ta.value), key = it.id + ':' + names.slice().sort().join(',');
  S.usedView = it.id; if (S.usedKey === key) return;
  S.usedKey = key; APP.isolate({ bodies: names });
}
function setUsedView(on) {
  const it = APP.selItem(); if (!it || S.sel.t !== 'region') return;
  if (on) { S.usedView = it.id; S.usedKey = null; const { ta } = exprEls(); const names = usedNames(ta ? ta.value : it.expr); S.usedKey = it.id + ':' + names.slice().sort().join(','); APP.isolate({ bodies: names }); }
  else { S.usedView = 0; S.usedKey = null; APP.restoreIsolation(); }
}
/** Object list (custom, with colour bullets) grouped as in the tree: Planes / Bodies, then user groups. */
function termPickerHTML() {
  const cur = bodyByName(S.termSel) ? S.termSel : '', inm = FK.inpNames(S.model).bodies;
  const opt = (b) => `<button type="button" class="tpopt${b.name === cur ? ' on' : ''}" data-act="tpPick" data-n="${esc(b.name)}" title="${esc(b.name)}"><i class="cdot" style="background:${b.color}"></i><span class="nm">${esc(objLabel(b, inm, true))}</span><small>${esc(b.type === 'RAW' ? b.rawType || 'RAW' : b.type)}${b.noExport ? ' · ⊘' : ''}</small></button>`;
  let list = '';
  for (const c of [{ k: 'planes', t: 'Planes', f: (b) => FK.isPlaneType(b.type) }, { k: 'bodies', t: 'Bodies', f: (b) => !FK.isPlaneType(b.type) }]) {
    const all = S.model.bodies.filter(c.f); if (!all.length) continue;
    list += `<div class="tph">${c.t}</div>`;
    for (const g of APP.groups().filter(x => x.k === c.k)) { const m = all.filter(b => b.grp === g.id); if (m.length) list += `<div class="tpg">▸ ${esc(g.name)}</div>` + m.map(opt).join(''); }
    list += all.filter(b => !APP.groups().some(g => g.k === c.k && g.id === b.grp)).map(opt).join('');
  }
  const cb = bodyByName(cur);
  return `<div class="tpick" id="termPick"><input type="hidden" id="termBody" value="${esc(cur)}"><button type="button" class="tpbtn" data-act="tpToggle" title="Object to insert with + add / − subtract">${tpLabel(cb)}</button><div class="tplist" hidden>${list || '<div class="empty">No object</div>'}</div></div>`;
}
const tpLabel = (b) => b ? `<i class="cdot" style="background:${b.color}"></i><span class="nm">${esc(objLabel(b, null, true))}</span><small>${esc(b.type === 'RAW' ? b.rawType || 'RAW' : b.type)}</small><span class="car">▾</span>` : '<span class="nm muted">— choose an object —</span><span class="car">▾</span>';
function setTermSel(name) {
  S.termSel = name || ''; const h = $('#termBody'); if (h) h.value = S.termSel;
  const btn = $('#termPick .tpbtn'); if (btn) { btn.innerHTML = tpLabel(bodyByName(S.termSel)); btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 1200); }
  $$('#termPick .tpopt').forEach(o => o.classList.toggle('on', o.dataset.n === S.termSel));
}
document.addEventListener('pointerdown', e => { const l = $('#termPick .tplist'); if (l && !l.hidden && !e.target.closest('#termPick')) l.hidden = true; }, true);
$('#rightBody').addEventListener('click', e => {
  const tg = e.target.closest('[data-act=tpToggle]'); if (tg) { const l = $('#termPick .tplist'); l.hidden = !l.hidden; const on = l.querySelector('.tpopt.on'); if (!l.hidden && on) on.scrollIntoView({ block: 'nearest' }); return; }
  const pk = e.target.closest('[data-act=tpPick]'); if (pk) { setTermSel(pk.dataset.n); $('#termPick .tplist').hidden = true; return; }
  const ch = e.target.closest('#exprChips .chip'); if (ch) { goToBody(ch.dataset.n); return; }
  const box = e.target.closest('#exprChips'); if (box) { const { ta } = exprEls(), op = e.target.closest('.cop'); const oe = op ? +op.dataset.e : ta.value.length; setCaretAt(op && ta.value[oe - 1] === ')' ? oe - 1 : oe); box.focus(); return; }
});
function setTextMode(on) {
  S.opt.exprText = !!on; const w = $('#exprWrap'); if (w) w.classList.toggle('rich', exprRich(false)); APP.save();
  const { ta } = exprEls(); if (on && ta) ta.focus(); updateExprMirror();
}
/** Caret positions of the chips view = boundaries between tokens. */
function caretStops(v) { const st = new Set([0]); for (const t of exprTokens(v)) { st.add(t.s); st.add(t.e); } return [...st].sort((a, b) => a - b); }
function deleteRange(s0, e0) {
  const it = APP.selItem(), { ta } = exprEls(); if (!it || !ta || (it.meta && it.meta.link)) return;
  const v = ta.value.slice(0, s0) + ta.value.slice(e0); APP.snap(); it.expr = v; ta.value = v; setCaretAt(s0); APP.changed({});
}
$('#rightBody').addEventListener('keydown', e => {
  const box = e.target.closest && e.target.closest('#exprChips'); if (!box) return;
  const { ta } = exprEls(), v = ta.value, st = S.exprSel && S.sel && S.exprSel.id === S.sel.id ? S.exprSel.s : v.length, stops = caretStops(v), k = e.key;
  const tk = exprTokens(v), terms = exprTerms(v);
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
    e.preventDefault(); e.stopPropagation();
    const p = k === 'Home' ? 0 : k === 'End' ? v.length : k === 'ArrowLeft' ? ([...stops].reverse().find(x => x < st) ?? 0) : (stops.find(x => x > st) ?? v.length);
    setCaretAt(p);
  } else if (k === 'Backspace' || k === 'Delete') {
    e.preventDefault(); e.stopPropagation();
    if (k === 'Backspace') { const t = [...tk].reverse().find(x => x.e <= st); if (!t) return; const tm = terms.find(x => x.e === t.e); deleteRange(tm ? tm.s : t.s, t.e); }
    else { const t = tk.find(x => x.s >= st); if (!t) return; const tm = terms.find(x => x.s === t.s); deleteRange(t.s, tm ? tm.e : t.e); }
  }
});
$('#rightBody').addEventListener('change', e => { if (e.target.id === 'chkText') setTextMode(e.target.checked); });
function setCaretAt(p) { const it = APP.selItem(), { ta } = exprEls(); if (!ta || !it) return; S.exprSel = { id: it.id, s: p, e: p }; try { ta.setSelectionRange(p, p); } catch (e) { /* ignore */ } updateExprMirror(); }
$('#rightBody').addEventListener('change', e => { if (e.target.id === 'chkUsed') setUsedView(e.target.checked); });
$('#rightBody').addEventListener('contextmenu', e => {
  const ch = e.target.closest('#exprChips .chip'); if (!ch) return; e.preventDefault();
  const it = APP.selItem(), ro = !it || (it.meta && it.meta.link), s0 = +ch.dataset.s, e0 = +ch.dataset.e, n = ch.dataset.n, b = bodyByName(n), neg = ch.classList.contains('neg');
  const m = [{ label: 'Go to the definition of ' + n, fn: () => goToBody(n) }, { label: 'Highlight in the 3D view', fn: () => flashBody(n) }];
  m.push({ label: 'Insert the next term after this one', fn: () => setCaretAt(e0) });
  if (b) m.push({ label: b.visible ? 'Hide in the 3D view' : 'Show in the 3D view', fn: () => { APP.snap(); b.visible = !b.visible; APP.changed({ tree: true }); } });
  if (!ro) m.push({ sep: 1 }, { label: neg ? 'Invert: − becomes +' : 'Invert: + becomes −', fn: () => editTerm(s0, e0, 'invert') }, { label: 'Remove from the definition', danger: true, fn: () => editTerm(s0, e0, 'remove') });
  showMenu(e.clientX, e.clientY, m);
});

/* ---------- Region expression editor: insertion at the caret, always-visible caret ---------- */
function exprEls() { return { ta: $('#exprArea'), mir: $('#exprMirror') }; }
/** Mirror of the textarea showing a blinking caret while the textarea is not focused (e.g. when a body is being chosen in the list). */
function updateExprMirror() {
  const { ta, mir } = exprEls(); if (!ta || !mir) return;
  const focused = document.activeElement === ta, st = S.exprSel || { s: ta.value.length, e: ta.value.length };
  const s0 = Math.min(st.s, ta.value.length), e0 = Math.min(st.e, ta.value.length);
  const sel = e0 > s0 ? `<span class="fs">${esc(ta.value.slice(s0, e0))}</span>` : '<span class="fc"></span>';
  mir.innerHTML = focused ? '' : esc(ta.value.slice(0, s0)) + sel + esc(ta.value.slice(e0)) + '\u200b';
  mir.scrollTop = ta.scrollTop; renderExprChips(); refreshUsedView();
}
function initExprEditor() {
  const { ta } = exprEls(); if (!ta) return;
  const keep = () => { S.exprSel = { s: ta.selectionStart, e: ta.selectionEnd }; };
  const st = S.exprSel && S.exprSel.id === S.sel.id ? S.exprSel : { id: S.sel.id, s: ta.value.length, e: ta.value.length };
  S.exprSel = st; try { ta.setSelectionRange(st.s, st.e); } catch (e) { /* ignore */ }
  for (const ev of ['select', 'keyup', 'click', 'input', 'mouseup']) ta.addEventListener(ev, () => { keep(); S.exprSel.id = S.sel && S.sel.id; updateExprMirror(); });
  ta.addEventListener('focus', updateExprMirror); ta.addEventListener('blur', () => { keep(); S.exprSel.id = S.sel && S.sel.id; updateExprMirror(); });
  ta.addEventListener('scroll', updateExprMirror);
  // the insertion buttons must not take the focus away from the expression (keeps the real caret visible)
  const bar = $('#rightBody .exprbtns'); if (bar) bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  updateExprMirror();
}
/** kind: 'term' (text = "+name" / "-name"), 'union', 'paren'. Inserted only at the caret (or replacing the selection). */
function insertInExpr(kind, text) {
  const { ta } = exprEls(); const it = APP.selItem(); if (!ta || !it) return;
  const v = ta.value, st = S.exprSel || { s: v.length, e: v.length };
  const s0 = Math.min(st.s, v.length), e0 = Math.min(Math.max(st.e, st.s), v.length), before = v.slice(0, s0), mid = v.slice(s0, e0), after = v.slice(e0);
  const pre = before && !/[\s(]$/.test(before) ? ' ' : '', needPost = after ? !/^[\s)]/.test(after) : false;
  let ins, caret;
  if (kind === 'term') { ins = pre + text + (needPost ? ' ' : ''); caret = s0 + ins.length; }
  else if (kind === 'union') { ins = pre + '|' + (text ? ' ' + text + (needPost ? ' ' : '') : (after && /^\s/.test(after) ? '' : ' ')); caret = s0 + ins.length; }      // "| +name" when an object is chosen in the list
  else if (mid) { ins = pre + '(' + mid + ')' + (needPost ? ' ' : ''); caret = s0 + pre.length + 1 + mid.length; }       // wrap the selection, caret before ')'
  else { ins = pre + '()' + (needPost ? ' ' : ''); caret = s0 + pre.length + 1; }                                      // caret between the parentheses
  APP.snap('expr' + it.id);
  ta.value = before + ins + after; it.expr = ta.value;
  S.exprSel = { id: it.id, s: caret, e: caret };
  ta.focus(); ta.setSelectionRange(caret, caret);
  APP.changed({}); updateExprMirror();
}
