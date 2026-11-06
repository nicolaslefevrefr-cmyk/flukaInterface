/* ui/props.js — Right panel: properties of the selected object
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
/* ---------- Right panel ---------- */
const loc = (p) => APP.toLocal(p);
const locRows = (rows) => S.model.active ? rows.map(r => [r[0] + ' <small class="muted">(' + esc(APP.csysLabel(S.model.active)) + ')</small>', xyz(loc(r[1]), 4)]) : [];
function pkText(pk) {
  switch (pk.kind) {
    case 'point': { const p = loc(pk.p); return `${fmt(p[0], 6)} ${fmt(p[1], 6)} ${fmt(p[2], 6)}`; }
    case 'edge': { const a = loc(pk.a), b = loc(pk.b); return `${fmt(a[0], 6)} ${fmt(a[1], 6)} ${fmt(a[2], 6)} ${fmt(b[0], 6)} ${fmt(b[1], 6)} ${fmt(b[2], 6)}`; }
    case 'face': { const p = APP.planeFromPick(pk).p; return 'PLA ' + p.map(x => fmt(x, 6)).join(' '); }
  }
  return '';
}
function pickCardHTML(pk) {
  if (!pk) return '';
  let h = '<div class="card">', acts = '';
  switch (pk.kind) {
    case 'point':
      h += `<h5>${pk.snapped ? 'Sommet' : 'Point on surface'} · ${esc(pk.ownerName)}</h5>` + kv([['X', cmmm(pk.p[0])], ['Y', cmmm(pk.p[1])], ['Z', cmmm(pk.p[2])]].concat(locRows([['Local', pk.p]])));
      acts = '<button class="btn sm" data-act="copyPick">Copy X Y Z</button><button class="btn sm" data-act="pickCsysPoint">Csys here</button>'; break;
    case 'edge':
      if (pk.none) { h += '<h5>Edge</h5><div class="muted">No sharp edge nearby: click closer to an edge or disable "sharp edges only".</div>'; break; }
      h += `<h5>Edge · ${esc(pk.ownerName)}</h5>` + kv([
        [pk.chain ? 'Length (straight)' : 'Length', cmmm(pk.chain ? pk.chain.length : pk.length)],
        ...(pk.chain ? [['Segments', String(pk.chain.segments)], ['Clicked segment', cm(pk.length)]] : []),
        ['Start', xyz(pk.chain ? pk.chain.a : pk.a, 3)], ['End', xyz(pk.chain ? pk.chain.b : pk.b, 3)],
        ['Δ', xyz(V.sub(pk.chain ? pk.chain.b : pk.b, pk.chain ? pk.chain.a : pk.a), 3)]].concat(locRows([['Start', pk.chain ? pk.chain.a : pk.a], ['End', pk.chain ? pk.chain.b : pk.b]])));
      acts = '<button class="btn sm" data-act="copyPick">Copy A B</button>'; break;
    case 'face': {
      const n = pk.normal, d = V.dot(n, pk.centroid), bb = pk.bbox;
      h += `<h5>Face · ${esc(pk.ownerName)}</h5>` + kv([
        ['Area', `${f(pk.area, 5)} cm²`], ['Triangles', String(pk.count)],
        ['Normal (outward)', xyz(n, 5)], ['Center', xyz(pk.centroid, 4)],
        ['Plane', `n·x = ${f(d, 5)}`], ['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)]].concat(locRows([['Center', pk.centroid]])));
      acts = '<button class="btn sm primary" data-act="pickPlane">Create PLA</button><button class="btn sm" data-act="pickCsysFace">Csys on face</button><button class="btn sm" data-act="pickRppFace">RPP around face</button><button class="btn sm" data-act="copyPick">Copy PLA card</button>'; break;
    }
    case 'object': {
      const st = APP.objectStats(pk), bb = st.bbox;
      h += `<h5>Object · ${esc(pk.ownerName)} <small class="muted">${esc(pk.ownerKind)}</small></h5>` + kv([
        ['Volume', st.volume !== undefined && st.volume !== null ? `${f(st.volume, 4)} cm³` : '—'], ['Area', st.area ? `${f(st.area, 4)} cm²` : '—'],
        ...(st.count ? [['Triangles', String(st.count)]] : []),
        ...(bb ? [['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)]] : []),
        ...(st.centroid ? [['Center', xyz(st.centroid, 3)]] : [])]);
      acts = bb ? '<button class="btn sm primary" data-act="pickRppObj">Bounding RPP</button>' : ''; break;
    }
  }
  return h + `<div class="btns">${acts}<button class="btn sm" data-act="clearPick">Close</button></div></div>`;
}

function numField(label, attr, val) { return `<div class="fld"><label>${label}</label><input type="number" step="0.1" value="${esc(fmt(val, 6))}" ${attr}></div>`; }
function commonStyle(o, withEdge) {
  return `<div class="fields"><div class="fld"><label>Color</label><input type="color" data-k="color" value="${esc(o.color)}"></div>
    <div class="fld"><label>Visible</label><input type="checkbox" class="pchk" data-k="visible" ${o.visible ? 'checked' : ''}></div>
    <div class="fld"><label>Opacity</label><input type="range" min="0" max="100" value="${Math.round(o.opacity * 100)}" data-k="opacity"></div>
    <div class="fld"><label title="Overrides the global render mode for this object">Appearance ⓘ</label><select data-k="look"><option value="" ${!o.look ? 'selected' : ''}>Follow the global mode</option><option value="opaque" ${o.look === 'opaque' ? 'selected' : ''}>Always opaque</option><option value="transparent" ${o.look === 'transparent' ? 'selected' : ''}>Always transparent</option></select></div></div>`;
}

function liveInfoHTML() {
  const it = APP.selItem(); if (!it || !S.sel) return '';
  const t = S.sel.t;
  if (t === 'body') {
    if (it.type === 'RAW') return '<div class="muted">Card not interpreted (kept as-is in the .inp file).</div>';
    const wb = APP.wbody(it), bb = FK.bodyBBox(wb), vol = FK.bodyVolume(wb), rows = [];
    if (it.cs) rows.push(['Frame', esc(APP.csysLabel(it.cs)) + ' <small class="muted">(values below: world)</small>']);
    if (bb) { rows.push(['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)], ['Center', xyz(FK.boxCenter(bb), 3)]); }
    if (vol !== null) rows.push(['Volume', `${f(vol, 4)} cm³`]);
    if (FK.isPlaneType(it.type)) {
      const pl = FK.planeOf(wb), n = V.norm(pl.H);
      rows.push(['Unit normal (H)', xyz(n, 5)], ['Equation', `n·x = ${f(V.dot(n, pl.V), 5)}`], ['Inside', 'side opposite to H']);
    }
    const c = APP.bodyCache.get(it.id); if (c && c.err) rows.push(['Error', esc(c.err)]);
    return kv(rows);
  }
  if (t === 'region') {
    const c = APP.regionCache.get(it.id); if (!c || !c.polys) return c && c.err ? `<div class="msg bad">${esc(c.err)}</div>` : '<div class="muted">Computing…</div>';
    const bb = c.bbox;
    return kv([['Volume', `${f(c.vol, 4)} cm³`], ['Surface area', `${f(c.area, 4)} cm²`],
      ...(bb ? [['Box min', xyz(bb.min, 3)], ['Box max', xyz(bb.max, 3)], ['Dimensions', xyz(V.sub(bb.max, bb.min), 3)]] : [])]) +
      '<div class="muted" style="font-size:11.5px;margin-top:4px" title="Volume computed inside the render zone; spheres / cylinders are faceted (approximate display).">ⓘ approximate volume</div>';
  }
  if (t === 'stl') {
    const st = it.stats; if (!st || !st.bbox) return '';
    return kv([['Triangles', String(st.count)], ['Volume', `${f(st.volume, 4)} cm³`], ['Area', `${f(st.area, 4)} cm²`],
      ['Box min', xyz(st.bbox.min, 3)], ['Box max', xyz(st.bbox.max, 3)], ['Dimensions', xyz(V.sub(st.bbox.max, st.bbox.min), 3)], ['Centre of mass', xyz(st.centroid, 3)]]);
  }
  if (t === 'measure') {
    const d = V.sub(it.b, it.a);
    return kv([['Distance', cmmm(V.len(d))], ['ΔX', cm(d[0])], ['ΔY', cm(d[1])], ['ΔZ', cm(d[2])], ['Point A', xyz(it.a, 4)], ['Point B', xyz(it.b, 4)]]);
  }
  return '';
}
/** First sentence of a diagnostic (the advice that follows goes in a tooltip). */
const brief = (t) => String(t).split(/\.\s+(?=[A-Z+\-(])/)[0].replace(/\.$/, '');
/** Size of the formula (depth of parentheses, zones, terms) with the tools to reduce it. */
function cplxHTML(r) {
  const st = APP.regionStats(r), lim = APP.maxParen(), zl = APP.maxZones(), lk = r.meta && r.meta.link, over = st.depth > lim, overZ = zl && st.zones > zl, lines = /\n/.test(r.expr || '');
  let simp = false;
  if (!lk && st.terms > 1) { try { simp = FK.simplifyExpr(r.expr) !== FK.formatExpr(FK.parseExpr(r.expr)); } catch (e) { simp = false; } }
  const btn = (act, label, tip) => `<button type="button" class="btn sm" data-act="${act}" data-rid="${r.id}" title="${esc(tip)}">${label}</button>`;
  const tools = (simp ? btn('exprSimplify', 'Simplify', 'Removes redundant terms and zones, opens useless parentheses. Same region, shorter formula.') : '') +
    (!lk && st.zones > 1 && !lines ? btn('exprLines', 'One zone per line', 'Writes each zone (part between |) on its own line. Same formula; easier to read.') : '') +
    (st.parens ? btn('exprFlatten', 'Into zones (no parenthesis)', 'Rewrites the formula as zones separated by |, one per line, without any parenthesis. Same region; the formula can get longer.') +
      (lk ? '' : btn('exprSplit', 'Split into regions…', 'Cuts the region into several regions with disjoint, parenthesis-free formulas (same material). Same volume, more regions.')) : '');
  return `<div class="msg cplx${over || overZ ? ' warn' : ''}"><span title="Depth of nested parentheses · zones (separated by |) · bodies written">${over || overZ ? '⚠ ' : ''}Parentheses ${st.depth} deep${over ? ` (limit ${lim})` : ''} · ${st.zones} zone${st.zones > 1 ? 's' : ''}${overZ ? ` (recommended ≤ ${zl})` : ''} · ${st.terms} term${st.terms > 1 ? 's' : ''}</span>${tools ? `<div class="btns">${tools}</div>` : ''}</div>`;
}
function regionMsg(r) {
  try {
    const ast = FK.parseExpr(r.expr || '+x');
    if (!r.expr.trim()) return '<div class="msg bad">Empty expression</div>';
    const missing = Array.from(FK.exprNames(ast)).filter(n => !S.model.bodies.some(b => b.name === n));
    if (missing.length) return `<div class="msg bad">Unknown body: ${esc(missing.join(', '))}</div>`;
    const c = APP.regionCache.get(r.id);
    if (c && c.err) return `<div class="msg bad">${esc(c.err)}</div>`;
    if (c && c.polys && (!c.polys.length || (c.vol !== null && c.vol !== undefined && c.vol < 1e-9))) {
      const dg = c.diag || [];
      if (!dg.length) return '<div class="msg bad">Empty region (no single cause found).</div>';
      return '<div class="msg bad"><b>Empty region.</b>' + dg.map(d => `<div class="dg">${linkify(brief(d.text))}${d.text !== brief(d.text) ? ` <span class="wicon info" tabindex="0" title="${esc(d.text)}">ⓘ</span>` : ''}` +
        (d.fix ? `<div><button class="btn sm" data-act="applyFix" data-rid="${r.id}" data-expr="${esc(d.fix.expr)}" title="${esc(d.fix.expr)}">${esc(d.fix.label)}: ${esc(d.fix.expr)}</button></div>` : '') + '</div>').join('') + '</div>';
    }
    const q = (c && c.quality) || [];
    const pq = q.find(x => x.kind === 'gap' || x.kind === 'pieces');
    const pcs = pq ? `<div class="msg"><label class="chk" style="margin:0" title="Each separate piece gets its own colour in the 3D view; the red spot marks where two pieces are closest"><input type="checkbox" data-opt="pieceHl" ${S.opt.pieceHl === false ? '' : 'checked'}>Highlight the ${pq.pieces} pieces${pq.spot ? ` · red spot: closest points, ${FK.fmt(pq.spot.d * 10, 4)} mm apart` : ''}</label> <span class="pieceleg">${PIECE_PAL.slice(0, Math.min(pq.pieces, 8)).map(c => `<i style="background:${c}"></i>`).join('')}</span></div>` : '';
    return pcs + '<div class="msg ok">Valid expression' + (q.length ? ` <span class="wicon" tabindex="0" title="${esc(q.map(x => x.text).join('\n'))}">⚠${q.length > 1 ? q.length : ''}</span>` : '') + '</div>' + cplxHTML(r);
  } catch (e) { return `<div class="msg bad">${esc(e.message)}</div>`; }
}
/** Keeps the style controls of the properties panel in step with changes made elsewhere (tree slider, eye…), without re-rendering it. */
function syncRightStyle() {
  const it = APP.selItem(); if (!it || !S.sel) return;
  const set = (k, fn) => { const el = $('#rightBody [data-k="' + k + '"]'); if (el && document.activeElement !== el) fn(el); };
  if (it.opacity !== undefined) set('opacity', el => { el.value = Math.round(it.opacity * 100); });
  set('visible', el => { el.checked = !!it.visible; });
  if (it.color) set('color', el => { el.value = it.color; });
}
function updateLive() {
  const li = $('#liveInfo'); if (li) li.innerHTML = liveInfoHTML();
  const em = $('#exprMsg'); const it = APP.selItem();
  if (em && S.sel && S.sel.t === 'region' && it) {
    em.innerHTML = regionMsg(it);
    const ta = $('#exprArea'); if (ta) ta.classList.toggle('bad', !!em.querySelector('.bad'));
  }
}

function scaleSection() {
  const sc = S.opt.scale, open = !!S.opt.scaleOpen;
  return `<label class="chk"><input type="checkbox" data-opt="scaleOpen" ${open ? 'checked' : ''}>Scale / margin about the centre</label>
    <div class="scalebox" ${open ? '' : 'hidden'}>
    <div class="row2"><select data-sc="mode"><option value="margin" ${sc.mode === 'margin' ? 'selected' : ''}>Margin all around (+ grows, − shrinks)</option><option value="pct" ${sc.mode === 'pct' ? 'selected' : ''}>Scale in %</option></select></div>
    <div class="row2"><input type="number" step="any" value="${sc.val}" data-sc="val"><select data-sc="unit" style="max-width:80px" ${sc.mode === 'pct' ? 'disabled' : ''}><option value="mm" ${sc.unit === 'mm' ? 'selected' : ''}>mm</option><option value="cm" ${sc.unit === 'cm' ? 'selected' : ''}>cm</option></select></div>
    <div class="btns"><button class="btn" data-act="scale">Apply</button><button class="btn" data-act="scaleDup">Duplicate + apply</button></div>
    <div class="muted" style="font-size:11.5px">Planes: the margin shifts the plane outward (along H). 120 % = grow by 20 %.</div></div>`;
}
/** Tabs of the properties panel: all panes stay in the DOM (hidden), so live updates keep working. */
function tabbed(p) {
  const names = { general: 'General', view: 'View', definition: 'Definition', operations: 'Operations' };
  const avail = Object.keys(names).filter(k => p[k]);
  const cur = avail.includes(S.rtab) ? S.rtab : avail[0];
  return `<div class="rtabs" role="tablist">${avail.map(k => `<button class="rtab${k === cur ? ' on' : ''}" role="tab" data-act="rtab" data-tab="${k}">${names[k]}</button>`).join('')}</div>` +
    avail.map(k => `<div class="rpane" data-pane="${k}" ${k === cur ? '' : 'hidden'}>${p[k]}</div>`).join('');
}

/** "Export to the INP" checkbox (+ an info sign when nothing uses the body). */
function inpNameHint(it, kind, eff) {
  const list = kind === 'region' ? S.model.regions : S.model.bodies, nm = FK.inpNames(S.model), map = kind === 'region' ? nm.regions : nm.bodies;
  if (it.noExport) return '';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(eff)) return '<span class="bad">⚠ letters, digits and _ only; must start with a letter</span>';
  if (eff.length > 8) return '<span class="bad">⚠ more than 8 characters</span>';
  const dup = list.find(x => x !== it && !x.noExport && map.get(x) === eff); if (dup) return `<span class="bad">⚠ same INP name as "${esc(dup.name)}"</span>`;
  return eff !== it.name ? `<span class="muted">Written as <b>${esc(eff)}</b> in the INP file</span>` : '';
}
function exportRow(it, kind) {
  const unused = kind === 'body' && !APP.bodyUsed(it);
  const eff = APP.inpNameOf(kind, it), explicit = !!(it.inpName && it.inpName.trim());
  return `<div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-k="exportInp" ${it.noExport ? '' : 'checked'}>Export to the INP file</label>${unused ? ` <span class="wicon info" tabindex="0" title="Not used by any region">ⓘ not used</span>` : ''}</div>
    <div class="fld full"><label title="Name written in the INP file (max 8 characters). Left automatic, it is the name itself, cut to 8 characters and made unique.">INP name ${explicit ? '' : '<small class="muted">(automatic)</small>'}</label><div class="row2"><input type="text" data-k="inpName" maxlength="16" spellcheck="false" value="${esc(eff)}" ${it.noExport ? 'disabled' : ''}><button class="btn sm" data-act="inpNameAuto" title="Best short name for this object: its own name if it fits, else its first letters followed by 2 digits (kept unique)">Auto</button></div><div class="inpnhint" data-inpnhint>${inpNameHint(it, kind, eff)}</div></div>`;
}
/** "CAD source" select: automatic / none / one of the meshes. */
function cadRow(it, kind) {
  const cur = it.meta && it.meta.cad !== undefined ? String(it.meta.cad === 0 ? 'none' : it.meta.cad) : '';
  const auto = APP.cadId(it, kind), an = auto ? APP.getStl(auto) : null;
  if (!S.stls.length) return '';
  return `<div class="fld full"><label title="Mesh this ${kind} was made from / is compared with (used to show / hide linked objects and for the CAD ↔ CG comparison)">CAD source ⓘ</label><select data-k="cad"><option value="" ${cur === '' ? 'selected' : ''}>Automatic${an && cur === '' ? ' → ' + esc(an.name) : ''}</option><option value="none" ${cur === 'none' ? 'selected' : ''}>None</option>${S.stls.map(m => `<option value="${m.id}" ${cur === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>`;
}
function bodyProps(b) {
  const info = FK.BODY_TYPES[b.type];
  let h = '';
  if (b.type === 'RAW') h += `<div class="fld full"><label>Card kept as-is</label><textarea class="expr" readonly>${esc((b.raw || []).join('\n'))}</textarea></div>`;
  else if (APP.FIELD_GROUPS[b.type]) {
    APP.FIELD_GROUPS[b.type].forEach((g, gi) => {
      const on = S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.only === undefined;
      h += `<div class="fld full grp"><div class="gh"><label>${g.l}</label><span class="pks">${g.pick ? `<button class="pk${on && S.fill.alt === undefined ? ' on' : ''}" data-act="pickField" data-g="${gi}" title="Pick the whole group in the 3D view" aria-label="Pick in the 3D view">⌖</button>` : ''}${(g.alts || []).map((al, ai) => `<button class="pk${S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.alt === ai ? ' on' : ''}" data-act="pickField" data-g="${gi}" data-alt="${ai}" title="${esc(al.title)}" aria-label="${esc(al.title)}">${al.icon}</button>`).join('')}${g.pick && g.pick.kind === 'vec' ? `<button class="pk" data-act="flipVec" data-g="${gi}" title="Reverse the vector (H → −H)" aria-label="Reverse the vector">⇄</button>` : ''}</span></div>
        <div class="gN" style="grid-template-columns:repeat(${Math.min(g.idx.length, 3)},1fr)">${g.idx.map((i, ii) => {
          const canOne = g.pick && g.pick.kind !== 'radius' && g.idx.length > 1;
          const onOne = S.fill && S.fill.kind === 'body' && S.fill.id === b.id && S.fill.g === gi && S.fill.only === ii;
          return `<div class="fld"><div class="fl"><label>${info.fields[i]}</label>${canOne ? `<button class="pk sm${onOne ? ' on' : ''}" data-act="pickField" data-g="${gi}" data-i="${ii}" title="Pick this coordinate only" aria-label="Pick ${info.fields[i]} only">⌖</button>` : ''}</div><input type="number" step="0.1" value="${esc(fmt(b.p[i], 6))}" data-bf="${i}"></div>`;
        }).join('')}</div></div>`;
    });
  } else info.fields.forEach((fl, i) => { h += numField(fl, `data-bf="${i}"`, b.p[i]); });
  const defFields = h; h = '';
  if (b.type !== 'RAW' || S.model.csys.length) {
    h += `<div class="fld full"><label>Defined in coordinate system</label><select data-k="bcs"><option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${b.cs === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" title="Recomputes the parameters so that the body stays where it is" data-opt="keepPos" ${S.opt.keepPos === true ? 'checked' : ''}>Keep position on frame change</label></div>`;
  }
  const csHTML = h; h = '';
  let inpLine = '';
  if (b.type !== 'RAW') {
    const xb = APP.xbody(b), ex = APP.exportCs();
    inpLine = `<div class="fld full"><div class="muted" style="font-size:12px">In the INP (frame: ${esc(APP.csysLabel(ex))}): <code>${esc(xb.type)} ${esc(xb.p.map(x => +(+x).toFixed(5)).join(' '))}</code></div></div>`;
  }
  let planeBtns = '';
  if (b.type === 'PLA') {
    const src = b.meta && b.meta.src;
    planeBtns = `<div class="btns"><button class="btn sm" data-act="flipPlane">Flip direction (H → −H)</button><button class="btn sm" data-act="replane">Recompute from a face…</button></div>`;
    if (src) { const o = src.kind === 'stl' ? APP.getStl(src.id) : null; planeBtns += `<div class="muted" style="font-size:12px">Source: triangle #${src.tri}${o ? ' of ' + esc(o.name) : ''}</div>`; }
  }
  const general = `<div class="sec"><h4><span>Body · ${esc(b.type === 'RAW' ? b.rawType : b.type)}</span></h4><div class="fields">
    <div class="fld full"><label title="Maximum 8 characters in the INP file">Name</label><input type="text" data-k="name" value="${esc(b.name)}"></div>${exportRow(b, 'body')}${cadRow(b, 'body')}${csHTML}</div></div>
    <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
  const definition = `<div class="sec"><h4><span>Geometric definition</span></h4><div class="fields">${defFields}${inpLine}</div>${planeBtns}</div>`;
  const view = b.type !== 'RAW' ? `<div class="sec"><h4><span>View</span></h4>${commonStyle(b)}</div>` : null;
  const operations = `<div class="sec"><h4><span>Operations</span></h4>${b.type !== 'RAW' ? scaleSection() : ''}
    <div class="btns">${b.type !== 'RAW' ? '<button class="btn" data-act="regFromBodyCut" title="Creates a region made of this body, then lets you click faces to cut it with planes">New region from this body + cut by faces…</button><button class="btn" data-act="snapCheck" title="Propose exact values: axis on X / Y / Z, coaxial / parallel with other cylinders, equal radii, faces and ends coincident with other objects">Check alignment with other objects…</button>' : ''}<button class="btn" data-act="dup">Duplicate</button></div>
    <div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
  return tabbed({ general, view, definition, operations });
}
function csysWorldHTML(c) {
  const w = APP.csysWorld(c.id), e = FK.M.toEuler(w);
  return kv([['Position (world)', xyz([w[3], w[7], w[11]], 5)], ['Angles (world)', xyz(e, 4) + '°'], ['Axe X', xyz([w[0], w[4], w[8]], 5)], ['Axe Y', xyz([w[1], w[5], w[9]], 5)], ['Axe Z', xyz([w[2], w[6], w[10]], 5)]]);
}
function cf(kind, i, val) { return `<input type="number" step="${kind === 'eul' ? 1 : 0.1}" data-cf="${kind}:${i}" value="${esc(fmt(val, 6))}">`; }
function csysProps(c) {
  const m = c.m, e = FK.M.toEuler(m);
  const parents = [`<option value="0">Global (0,0,0)</option>`].concat(S.model.csys.filter(x => x.id !== c.id && !APP.isDescendant(x.id, c.id)).map(x => `<option value="${x.id}" ${c.parent === x.id ? 'selected' : ''}>${esc(x.name)}</option>`)).join('');
  const kids = APP.csysChildren(c.id), nb = S.model.bodies.filter(b => b.cs === c.id).length;
  const grid3 = (label, kind, v) => `<div class="fld full"><label>${label}</label><div class="g3">${[0, 1, 2].map(i => cf(kind, i, v[i])).join('')}</div></div>`;
  const general = `<div class="sec"><h4><span>Coordinate system</span></h4><div class="fields">
    <div class="fld full"><label>Name</label><input type="text" data-k="name" value="${esc(c.name)}"></div>
    <div class="fld full"><label>Defined relative to</label><select data-k="cparent">${parents}</select></div>
    <div class="fld full"><label class="chk" style="margin:0"><input type="checkbox" data-k="cfrozen" ${c.frozen ? 'checked' : ''}>Freeze: does not follow its parent (keeps its world pose)</label></div>
    </div>
    <div class="muted" style="font-size:12px;margin:2px 0 6px">Unless frozen, this system moves with its parent. ${kids.length ? kids.length + ' child system(s) (' + kids.filter(k => k.frozen).length + ' frozen). ' : ''}${nb ? nb + ' body(ies) defined in this system.' : ''}</div></div>`;
  const meth = c.def ? c.def.method : 'manual';
  const definition = `<div class="sec"><h4><span>Definition</span></h4><div class="fields"><div class="fld full"><label>Defined by</label><select data-cd="method">${[['manual', 'Position + angles (typed)'], ['axes', 'Origin + 2 axes (X, Y or Z)'], ['pts3', 'Origin + point on X + point in XY plane']].map(([k, l]) => `<option value="${k}" ${meth === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>${c.def ? csDefHTML(c) : ''}</div>
    <div class="sec"><h4><span>${c.def ? 'Resulting position and orientation' : 'Position and orientation'}</span></h4>
    <div class="muted" style="font-size:12px">Relative to the parent system.${c.def ? ' Editing these values switches the definition back to typed.' : ''}</div><div>
      <div class="fld full grp"><div class="gh"><label>Position X, Y, Z (cm)</label><button class="pk${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === undefined ? ' on' : ''}" data-act="pickCsysPos" title="Pick the whole origin in the 3D view" aria-label="Pick the origin">⌖</button></div><div class="g3">${[0, 1, 2].map(i => `<div class="fld"><div class="fl"><label>${'XYZ'[i]}</label><button class="pk sm${S.fill && S.fill.kind === 'csys' && S.fill.id === c.id && S.fill.only === i ? ' on' : ''}" data-act="pickCsysPos" data-i="${i}" title="Pick this coordinate only">⌖</button></div>${cf('pos', i, [m[3], m[7], m[11]][i])}</div>`).join('')}</div></div>
      ${grid3('Angles α, β, γ (°) — R = Rz(γ)·Ry(β)·Rx(α)', 'eul', e)}
      ${grid3('X axis vector', 'xa', [m[0], m[4], m[8]])}
      ${grid3('Approx. Y axis vector (Z = X × Y)', 'ya', [m[1], m[5], m[9]])}
    </div>
    <details class="fold"><summary>3×4 matrix (rotation | translation)</summary><div>
      <div class="btns"><button class="btn sm" data-act="cmPaste" title="Read 12 numbers (3 rows × 4 columns) from the clipboard">📋 Paste 3×4 matrix</button><button class="btn sm" data-act="cmInvert" title="Replace the matrix by its inverse: use it when you entered CSYS0→CSYS1 and wanted CSYS1→CSYS0 (or the reverse)">⇄ Invert (A→B ↔ B→A)</button></div>
      <div class="g4">${[0, 1, 2].map(r => [0, 1, 2, 3].map(q => cf('cm', r * 4 + q, m[r * 4 + q])).join('')).join('')}</div>
      <div class="muted" style="font-size:12px">p_parent = R·p + t. Must be a proper rotation (orthonormal, determinant +1).</div></div></details>
    <details class="fold"><summary>World values</summary><div id="csysWorld">${csysWorldHTML(c)}</div></details>
</div>`;
  const view = `<div class="sec"><h4><span>View</span></h4><div class="fields"><div class="fld"><label>Color</label><input type="color" data-k="color" value="${esc(c.color)}"></div><div class="fld"><label>Visible</label><input type="checkbox" class="pchk" data-k="visible" ${c.visible ? 'checked' : ''}></div></div></div>`;
  const operations = `<div class="sec"><h4><span>Operations</span></h4>
    <div class="btns"><button class="btn primary" data-act="csysActivate">${S.model.active === c.id ? '● Active system' : 'Set as active'}</button>
    <button class="btn${APP.exportCs() === c.id ? ' primary' : ''}" data-act="csysExport" title="The INP file is written in this frame (only one)">${APP.exportCs() === c.id ? '⇥ Export system (click to unset)' : 'Use as export system'}</button>
    <button class="btn" data-act="csysCut" data-pl="xy">Section XY</button><button class="btn" data-act="csysCut" data-pl="xz">Section XZ</button><button class="btn" data-act="csysCut" data-pl="yz">Section YZ</button>
    <button class="btn" data-act="dup">Duplicate</button></div>
    <div class="btns opsdel"><button class="btn danger" data-act="del" title="The children are re-attached to the parent; the bodies keep their place">Delete</button></div></div>`;
  return tabbed({ general, view, definition, operations });
}
const SLOT_SRC = [['xyz', 'Coordinates'], ['cs', 'Origin of a coordinate system'], ['pick', 'Point / vertex in the view'], ['arc', 'Centre of a circular edge'], ['mid', 'Midpoint of an edge'], ['planes3', 'Intersection of 3 faces']];
const AX_SRC = [['vec', 'Vector (typed)'], ['csax', 'Axis of a coordinate system'], ['pts', 'Two points'], ['face', 'Normal of a face'], ['edge', 'Direction of an edge'], ['circ', 'Axis of a circular edge']];
const SLOT_MODE = { pick: 'vertex', arc: 'arc', mid: 'mid', planes3: 'planes3' };
/** Options of the coordinate systems a definition may refer to (not itself, nor the systems that depend on it). */
function csOpts(c, sel) {
  return `<option value="0" ${sel === 0 ? 'selected' : ''}>Global (0,0,0)</option>` + S.model.csys.filter(x => x.id !== c.id && !APP.isDescendant(x.id, c.id)).map(x => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}
function slotHTML(c, label, path) {
  const sl = APP.csSlot(c.def, path), on = S.fill && S.fill.kind === 'csdef' && S.fill.slot === path;
  return `<div class="fld full grp csd"><div class="gh"><label>${label}</label><select class="mini" data-cd="${path}|src">${SLOT_SRC.map(([k, l]) => `<option value="${k}" ${sl.src === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${sl.src !== 'xyz' && sl.src !== 'cs' ? `<button class="pk${on ? ' on' : ''}" data-act="csdPick" data-path="${path}" title="Pick in the 3D view" aria-label="Pick">⌖</button>` : ''}</div>
    ${sl.src === 'cs' ? `<div class="fld"><label>Coordinate system</label><select data-cd="${path}|cs">${csOpts(c, sl.cs | 0)}</select></div>` : ''}
    <div class="g3">${[0, 1, 2].map(i => `<input type="number" step="any" data-cd="${path}|p${i}" value="${fmt(sl.p[i], 6)}" ${sl.src === 'cs' ? 'readonly' : ''}>`).join('')}</div></div>`;
}
function axisHTML(c, which, title) {
  const a = c.def[which], v = APP.csAxisVec(a), pk = ['face', 'edge', 'circ'].includes(a.src), on = S.fill && S.fill.kind === 'csdef' && S.fill.ax === which;
  return `<div class="csdax"><h5>${title}</h5><div class="fld full"><div class="row2"><label style="margin:0">This axis is</label><select class="mini" data-cd="${which}|axis">${['X', 'Y', 'Z'].map(L => `<option ${a.axis === L ? 'selected' : ''}>${L}</option>`).join('')}</select>
<button class="btn sm" data-act="csdFlip" data-ax="${which}" title="Reverse the direction">⇄ Reverse</button></div>
    <div class="row2" style="margin-top:4px"><select data-cd="${which}|src" style="flex:1;min-width:0">${AX_SRC.map(([k, l]) => `<option value="${k}" ${a.src === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${pk ? `<button class="pk${on ? ' on' : ''}" data-act="csdPickAxis" data-ax="${which}" title="Pick in the 3D view" aria-label="Pick">⌖</button>` : ''}</div>
    ${a.src === 'csax' ? `<div class="row2" style="margin-top:4px"><select data-cd="${which}|cs" style="flex:1;min-width:0" title="Coordinate system">${csOpts(c, a.cs | 0)}</select><select data-cd="${which}|cax" class="mini" title="Which axis of that system">${['X', 'Y', 'Z'].map(L => `<option ${(a.cax || 'X') === L ? 'selected' : ''}>${L}</option>`).join('')}</select></div>` : ''}</div>
    <div class="g3">${[0, 1, 2].map(i => `<input type="number" step="any" data-cd="${which}|v${i}" value="${fmt(v[i], 6)}" ${a.src === 'pts' || a.src === 'csax' ? 'readonly' : ''}>`).join('')}</div>
    ${a.src === 'pts' ? slotHTML(c, 'From point', which + '.p1') + slotHTML(c, 'To point', which + '.p2') : ''}</div>`;
}
function csDefHTML(c) {
  const d = c.def;
  let h = `<div class="muted" style="font-size:12px">Values below are in world coordinates. Each point can be typed, picked on a vertex, taken at the centre of a circular edge, the midpoint of an edge, or the intersection of 3 faces.</div>` + slotHTML(c, 'Origin', 'o');
  if (d.method === 'pts3') h += slotHTML(c, 'Point on the X axis', 'px') + slotHTML(c, 'Point in the XY plane (+Y side)', 'pxy');
  else h += axisHTML(c, 'a', 'Axis 1 (kept exactly)') + axisHTML(c, 'b', 'Axis 2 (made perpendicular to axis 1)') + `<div class="muted" style="font-size:12px">The third axis is deduced (right-handed system).</div>`;
  if (d.error) h += `<div class="msg bad">⚠ ${esc(d.error)}</div>`; else if (d.note) h += `<div class="msg">ⓘ ${esc(d.note)}</div>`;
  return h;
}
function onCsDefField(e, t, c) {
  if (e.type !== 'change') return;
  const [path, field] = t.dataset.cd.split('|'), d = c.def, key = 'csdef' + c.id;
  if (path !== 'method' && !d) return;
  if (path === 'method') {
    APP.snap(); if (t.value === 'manual') { c.def = null; APP.changed({ tree: true, right: true }); return; }
    c.def = APP.csDefNew(c); c.def.method = t.value; APP.applyCsysDef(c, key); APP.changed({ tree: true, right: true }); return;
  }
  APP.snap(key);
  if (path === 'a' || path === 'b') {
    const a = d[path], o = d[path === 'a' ? 'b' : 'a'];
    if (field === 'axis') { if (o.axis === t.value) o.axis = a.axis; a.axis = t.value; }
    else if (field === 'cs') a.cs = +t.value;
    else if (field === 'cax') a.cax = t.value;
    else if (field === 'src') { if (t.value === 'pts' && a.src !== 'pts') { const v = APP.csAxisVec(a); a.p2.p = V.add(a.p1.p, v); } else if (a.src === 'pts' || a.src === 'csax') { a.v = APP.csAxisVec(a); a.flip = false; } a.src = t.value; if (t.value === 'csax') { a.cs = a.cs | 0; a.cax = a.cax || a.axis; a.flip = false; } }
    else { const i = +field[1], v = parseFloat(t.value); if (!isFinite(v)) return; a.v = APP.csAxisVec(a); a.flip = false; a.v[i] = v; a.src = 'vec'; }
  } else {
    const sl = APP.csSlot(d, path);
    if (field === 'cs') { sl.cs = +t.value; sl.src = 'cs'; }
    else if (field === 'src') { sl.src = t.value; if (t.value === 'cs') sl.cs = sl.cs | 0; } else { const i = +field[1], v = parseFloat(t.value); if (!isFinite(v)) return; sl.p[i] = v; sl.src = 'xyz'; }
  }
  APP.applyCsysDef(c, key); APP.changed({ tree: true, right: true });
}
let csysSrc = null;
function applyMatrixText(c, text) {
  const r = FK.parseMatrix34(text); if (r.error) { toast(r.error); return; }
  if (APP.setCsysLocal(c, r.m, null, false)) toast(`${c.name}: 3×4 matrix pasted${r.note ? ' (' + r.note + ')' : ''}`);
}
document.addEventListener('paste', e => {          // Ctrl+V in a matrix cell with a whole matrix in the clipboard
  const t = e.target; if (!t || !t.dataset || !t.dataset.cf || !t.dataset.cf.startsWith('cm:')) return;
  const tx = (e.clipboardData || window.clipboardData).getData('text'); const r = FK.parseMatrix34(tx);
  if (r.error) { if (/(\d[\s,;]+){3}/.test(tx)) toast(r.error); return; }
  e.preventDefault(); const c = APP.selItem(); if (c && S.sel.t === 'csys') applyMatrixText(c, tx);
});
function updateCsysFields(force) {
  const c = APP.selItem(); if (!c || !S.sel || S.sel.t !== 'csys') return;
  const m = c.m, vals = { pos: [m[3], m[7], m[11]], eul: FK.M.toEuler(m), xa: [m[0], m[4], m[8]], ya: [m[1], m[5], m[9]], cm: m };
  $$('#rightBody [data-cf]').forEach(inp => {
    const [k, i] = inp.dataset.cf.split(':');
    if (csysSrc === 'pe' && (k === 'pos' || k === 'eul')) return;
    if (!force && inp === document.activeElement) return;
    inp.value = fmt(vals[k][+i], 6);
  });
  const w = $('#csysWorld'); if (w) w.innerHTML = csysWorldHTML(c);
  csysSrc = null;
}
function onCsysField(e, t, it) {
  const [kind] = t.dataset.cf.split(':');
  const read = (k) => $$(`#rightBody [data-cf^="${k}:"]`).map(x => parseFloat(x.value));
  const ok = (a) => a.every(isFinite);
  const M = FK.M;
  if (kind === 'pos' || kind === 'eul') {
    if (e.type !== 'input') return;
    const pos = read('pos'), eul = read('eul'); if (!ok(pos) || !ok(eul)) return;
    csysSrc = 'pe';
    APP.setCsysLocal(it, M.fromPosEuler(pos, eul), 'cs' + it.id + 'pe', true);
  } else if (kind === 'xa' || kind === 'ya') {
    if (e.type !== 'change') return;
    const xa = read('xa'), ya = read('ya'); if (!ok(xa) || !ok(ya)) { updateCsysFields(true); return; }
    const m = M.fromAxes([it.m[3], it.m[7], it.m[11]], xa, ya);
    if (!m) { toast('X and Y vectors are zero or collinear'); updateCsysFields(true); return; }
    APP.setCsysLocal(it, m, null, true);
  } else if (kind === 'cm') {
    if (e.type !== 'change') return;
    const m = read('cm');
    if (!ok(m) || !APP.setCsysLocal(it, m, null, true)) updateCsysFields(true);
  }
}
function regionProps(r) {
  const bodyTypeOf = (b) => b.type === 'RAW' ? (b.rawType || 'RAW') : b.type;
  const byType = new Map(); for (const b of S.model.bodies) { const t = bodyTypeOf(b); if (!byType.has(t)) byType.set(t, []); byType.get(t).push(b); }
  const collate = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const opts = termPickerHTML();
  const general = `<div class="sec"><h4><span>Region</span></h4><div class="fields">
    <div class="fld"><label>Name</label><input type="text" data-k="name" value="${esc(r.name)}"></div>
    <div class="fld"><label>Neighbour regions (2nd field)</label><input type="number" step="1" min="0" value="${r.nvois}" data-k="nvois"></div>
    <div class="fld"><label title="Material assigned to this region (ASSIGNMA card)">Material</label><select data-k="mat"><option value="0">— none —</option>${(S.model.materials || []).map(m => `<option value="${m.id}" ${r.mat === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>${exportRow(r, 'region')}${cadRow(r, 'region')}</div></div>
    <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
  const lk = r.meta && r.meta.link, dep = APP.linkDependents(r.id), others = S.model.regions.filter(x => x.id !== r.id && !dep.has(x.id));
  const regOpts = (sel) => (others.some(x => x.id === sel) ? '' : `<option value="${sel}" selected>${esc((APP.getRegion(sel) || { name: '?' }).name)}</option>`) + others.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const OPS = [['union', '∪ union'], ['int', '∩ intersect'], ['sub', '− subtract']];
  const linkBlock = lk ? `<div class="sec"><h4><span>⛓ Combination <small class="muted">(live formula)</small></span></h4>
    <div class="muted" style="font-size:12px">Operations are applied in order, from the first region: ((A op B) op C) …  The formula below follows these regions and cannot be edited.</div>
    <div class="fields"><div class="fld"><label>Start from</label><select data-k="lnkA">${regOpts(lk.a)}</select></div>
    ${APP.linkOps(lk).map((o, i) => `<div class="fld lop"><div class="lopsel"><select data-k="lnkOp" data-i="${i}" title="Operation">${OPS.map(([v, l]) => `<option value="${v}" ${o.op === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="lopreg"><select data-k="lnkReg" data-i="${i}" title="Region">${regOpts(o.id)}</select><button class="mn" data-act="lnkDel" data-i="${i}" title="Remove this operation" ${APP.linkOps(lk).length < 2 ? 'disabled' : ''}>✕</button></div></div>`).join('')}
    <div class="fld"><label>Form</label><select data-k="lnkMode"><option value="compact" ${!lk.mode || lk.mode === 'compact' ? 'selected' : ''}>Compact</option><option value="expanded" ${lk.mode === 'expanded' ? 'selected' : ''}>Expanded (De Morgan)</option><option value="flat" ${lk.mode === 'flat' ? 'selected' : ''}>Flat (no parentheses)</option></select></div></div>
    <div class="usedrow"><label class="chk" title="Removes redundant terms and zones from the result (same region, shorter formula)"><input type="checkbox" data-k="lnkSimp" ${lk.simp ? 'checked' : ''}>Simplify the formula</label><label class="chk" title="Writes each zone on its own line, each starting with | (also in the INP file)"><input type="checkbox" data-k="lnkLines" ${lk.lines ? 'checked' : ''}>One zone per line</label></div>
    ${lk.error ? `<div class="msg bad">${esc(lk.error)}</div>` : ''}
    <div class="btns"><button class="btn sm primary" data-act="lnkAdd" title="Add another region to the combination">＋ Add an operation</button><button class="btn sm" data-act="unlinkRegion" title="Keep the current formula and make it editable">Unlink (keep formula)</button></div></div>` : '';
  const definition = `${linkBlock}<div class="sec"><h4><span>Definition</span></h4><div class="fields">
    <div class="fld full"><label>Expression  (+ inside · − outside · | union · parentheses)${lk ? ' — read-only while linked' : ''}</label><div class="exprwrap${exprRich(lk) ? ' rich' : ''}" id="exprWrap"><div class="exprchips" id="exprChips" tabindex="0" title="Click a chip to open the object · right-click for more · click an operator or the empty area (or use ← → Home End) to move the insertion point · Backspace / Delete remove the term before / after it"></div><textarea class="expr" id="exprArea" data-k="expr" spellcheck="false" ${lk ? 'readonly' : ''}>${esc(r.expr)}</textarea><div class="exprmirror" id="exprMirror" aria-hidden="true"></div></div></div></div>
    <div class="usedrow"><label class="chk" title="Edit the definition as plain text instead of clickable chips (the text uses the object names; chips and the object list show the names written in the INP file)"><input type="checkbox" id="chkText" ${S.opt.exprText === true ? 'checked' : ''}>${lk ? 'Show the definition as plain text (read-only)' : 'Edit the definition as plain text'}</label><label class="chk usedchk" title="Show only the objects used in this definition in the 3D view; un-check to get the previous view back"><input type="checkbox" id="chkUsed" ${S.usedView && S.isoSnap ? 'checked' : ''}>Show the components used in this definition</label></div>
    <div id="exprMsg">${regionMsg(r)}</div>
    ${lk ? '<div class="muted" style="font-size:12px">ⓘ Managed by the combination above.</div><!--' : ''}<div class="row2">${opts}</div>
    <div class="btns exprbtns"><button class="btn sm" data-act="cutRegion" title="Click a face of a mesh or object: its plane is created (or reused) and added to this formula">✂ Cut by a face…</button><button class="btn sm" data-act="pickRegion" title="Click a body or plane in the 3D view: it gets selected in the list below (overlapping objects are listed so you can choose)">🖱 Pick in view…</button><button class="btn sm" data-act="termAdd" title="Insert +body at the cursor">+ add</button><button class="btn sm" data-act="termSub" title="Insert -body at the cursor">− subtract</button><button class="btn sm" data-act="termUnion" title="Insert the union symbol | at the cursor">| union</button><button class="btn sm" data-act="termParen" title="Insert a pair of parentheses at the cursor (wraps the selection)">( )</button><button class="btn sm" data-act="termDel" title="Remove every occurrence of the chosen body">remove</button></div>${lk ? '-->' : ''}</div>`;
  const view = `<div class="sec"><h4><span>View</span></h4>${commonStyle(r)}</div>`;
  const operations = `<div class="sec"><h4><span>Operations</span></h4>
    <div class="btns"><button class="btn" data-act="boolRegion" title="New region = this one minus / ∩ / ∪ another region, written with their bodies">Combine with another region… <small>(experimental)</small></button>
    <button class="btn" data-act="voidRegion" title="RPP around this region + region = RPP minus this one">Create void region… <small>(experimental)</small></button>
    <button class="btn" data-act="regionCompare" title="Colour this region by its distance to its CAD mesh; volumes and metrics">Compare with CAD…</button>
    <button class="btn" data-act="dup">Duplicate</button></div>
    <div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
  return tabbed({ general, view, definition, operations });
}
/** One mesh per connected solid of a mesh. */
function splitStl(s) {
  const comps = FK.meshComponents(s.raw).filter(c => c.count >= 4);
  if (comps.length < 2) { toast('Only one solid in this mesh'); return; }
  const L = APP.cadLinked(s.id), nLinked = L.bodies.length + L.planes.length + L.regions.length;
  const names = new Set(S.stls.map(m => m.name));
  comps.forEach((c, k) => {
    let nm = s.name + '_' + (k + 1); for (let q = 2; names.has(nm); q++) nm = s.name + '_' + (k + 1) + ' (' + q + ')'; names.add(nm);
    const m = { id: APP.nid(), name: nm, file: s.file || s.name, format: s.format, raw: c.positions, unit: s.unit, offset: s.offset.slice(), flip: s.flip, steps: (s.steps || []).map(x => ({ label: x.label, m: x.m.slice(), d: x.d })), visible: true, opacity: s.opacity, color: FK.PALETTE[(S.stls.length + k) % FK.PALETTE.length], edges: c.count <= 80000, group: null, mesh: null };
    APP.buildStl(m); S.stls.push(m);
  });
  if (nLinked) { s.visible = false; toast(`${comps.length} meshes created; the original is kept (hidden) because CG objects are linked to it`); }
  else { if (APP.hooks.disposeStl) APP.hooks.disposeStl(s); S.stls = S.stls.filter(x => x.id !== s.id); S.sel = null; toast(`${comps.length} meshes created`); }
  APP.changed({ tree: true, right: true });
}
/** What is linked to a mesh + quick show / hide. */
function linkedHTML(s) {
  const L = APP.cadLinked(s.id), n = L.bodies.length + L.planes.length + L.regions.length;
  return `<div class="sec"><h4><span>Linked CG objects</span></h4>
    <div class="muted" style="font-size:12.5px">${n ? `${L.bodies.length} bod${L.bodies.length === 1 ? 'y' : 'ies'} · ${L.planes.length} plane${L.planes.length === 1 ? '' : 's'} · ${L.regions.length} region${L.regions.length === 1 ? '' : 's'}` : 'None yet (planes picked on a face, detected features and regions made of them are linked automatically).'}</div>
    ${n ? `<div class="btns"><button class="btn sm" data-act="cadShow">Show</button><button class="btn sm" data-act="cadHide">Hide</button><button class="btn sm" data-act="cadIsolate" title="Show only this mesh and what is linked to it">Isolate</button></div>` : ''}</div>`;
}
const XF = { id: 0, cs: 0, d: [0, 0, 0], axis: 'Z', ang: 0, from: 0, to: 0 };
const xfTargets = () => { const nm = multiList(); return nm ? nm.filter(x => x.t === 'stl').map(x => x.o) : (S.sel && S.sel.t === 'stl' && APP.selItem() ? [APP.selItem()] : []); };
/** translation (in the csys axes) after a rotation about the csys axis; null when there is nothing to do */
function xfMatrix() {
  const w = APP.csysWorld(XF.cs | 0);
  const R = XF.ang ? FK.M.axisAngle(APP.csAxisOf(XF.cs, XF.axis), XF.ang, [w[3], w[7], w[11]]) : FK.M.id();
  const mw = FK.M.mul(FK.M.translation(FK.M.applyVec(w, XF.d)), R);
  return FK.M.isIdentity(mw, 1e-12) ? null : mw;
}
/** live preview: the mesh is moved on screen only (triangles untouched) until Apply */
function xfPreview() {
  const mw = xfMatrix(), tg = new Set(xfTargets());
  for (const m of S.stls) {
    if (!m.group) continue;
    if (tg.has(m) && mw) { m.group.matrixAutoUpdate = false; m.group.matrix.set(mw[0], mw[1], mw[2], mw[3], mw[4], mw[5], mw[6], mw[7], mw[8], mw[9], mw[10], mw[11], 0, 0, 0, 1); m.group.matrixWorldNeedsUpdate = true; m.xfPrev = true; }
    else if (m.xfPrev) { m.group.matrix.identity(); m.group.matrixAutoUpdate = true; m.xfPrev = false; }
  }
  APP.requestRender();
}
function xfReset() { XF.d = [0, 0, 0]; XF.ang = 0; xfPreview(); }
function stlProps(s) {
  if (XF.id !== s.id) { XF.id = s.id; XF.d = [0, 0, 0]; XF.ang = 0; }
  const unitOpts = ['mm', 'cm', 'm', 'in'].map(u => `<option ${s.unit === u ? 'selected' : ''}>${u}</option>`).join('');
  const general = `<div class="sec"><h4><span>Mesh file</span></h4><div class="fields">
    <div class="fld full"><label>Name</label><input type="text" data-k="name" value="${esc(s.name)}"></div>${s.file ? `<div class="fld full"><div class="muted" style="font-size:12px">File: ${esc(s.file)}</div></div>` : ''}</div></div>
    <div class="sec"><h4><span>Information</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>${linkedHTML(s)}`;
  const definition = `<div class="sec"><h4><span>Placement</span></h4><div class="fields">
    <div class="fld"><label>File unit</label><select data-k="unit">${unitOpts}</select></div>
    <div class="fld"><label>&nbsp;</label><label class="chk" style="margin:0"><input type="checkbox" data-k="flip" ${s.flip ? 'checked' : ''}>Flip normals</label></div>
    ${numField('Offset X (cm)', 'data-off="0"', s.offset[0])}${numField('Offset Y (cm)', 'data-off="1"', s.offset[1])}${numField('Offset Z (cm)', 'data-off="2"', s.offset[2])}</div>
    <div class="muted" style="font-size:12px;margin-top:6px">Everything is converted to cm (CG unit) on import. Mesh normals point out of the material.</div></div>`;
  const view = `<div class="sec"><h4><span>View</span></h4>${commonStyle(s)}
    <div class="row2"><label class="chk" style="margin:0"><input type="checkbox" data-k="edges" ${s.edges ? 'checked' : ''}>Sharp edges</label></div></div>`;
  const csO = (v) => `<option value="0">Global (0,0,0)</option>${S.model.csys.map(c => `<option value="${c.id}" ${+v === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  const nm = multiList(), nSel = nm ? nm.filter(x => x.t === 'stl').length : 1;
  const transform = `<div class="sec"><h4><span>Transform${nSel > 1 ? ` (${nSel} selected meshes)` : ''}</span></h4>
    <div class="fld full"><label title="Axes and origin used by the translation and the rotation">Coordinate system</label><select data-tf="cs">${csO(XF.cs)}</select></div>
    <div class="fields">${['x', 'y', 'z'].map((L, i) => `<div class="fld"><label>Δ${L.toUpperCase()} (cm)</label><input type="number" step="0.1" data-tf="d${i}" value="${esc(fmt(XF.d[i], 6))}"></div>`).join('')}</div>
    <div class="fields" style="margin-top:6px"><div class="fld"><label>Rotation axis</label><select data-tf="axis">${['X', 'Y', 'Z'].map(L => `<option ${XF.axis === L ? 'selected' : ''}>${L}</option>`).join('')}</select></div>
      <div class="fld"><label>Angle (°)</label><input type="number" step="1" data-tf="ang" value="${esc(fmt(XF.ang, 6))}"></div></div>
    <div class="muted" style="font-size:12px;margin-top:4px">The rotation axis passes through the origin of the coordinate system; the rotation is done first, then the translation. The mesh is previewed in the 3D view until you click Apply.</div>
    <div class="btns"><button class="btn primary" data-act="tfApply">Apply</button><button class="btn" data-act="tfReset">Reset</button>
</div>
    <div class="fields" style="margin-top:10px"><div class="fld"><label>Align: from</label><select data-tf="from">${csO(XF.from)}</select></div><div class="fld"><label>to</label><select data-tf="to">${csO(XF.to)}</select></div></div>
    <div class="btns"><button class="btn" data-act="tfAlign" title="Moves the mesh so that the 'from' system lands on the 'to' system (applied immediately)">Align from → to</button></div>
    <h4 style="margin-top:12px"><span>Applied transformations (${(s.steps || []).length})</span></h4>
    ${(s.steps || []).length ? `<div class="stepl">${s.steps.map((x, i) => `<div class="steprow"><span><b>${i + 1}.</b> ${esc(x.label)}</span><button class="btn sm" data-act="tfDel" data-i="${i}" title="Remove this step (the following ones are kept)">×</button></div>`).join('')}</div>
    <div class="btns"><button class="btn" data-act="tfClear">Back to the imported position</button></div>` : '<div class="muted" style="font-size:12px">None: the mesh is at its imported position.</div>'}
    <div class="muted" style="font-size:12px;margin-top:4px">Steps are kept with the project (the imported triangles are never altered) and are applied in order. Each one is stored as a fixed move, so later changes to a coordinate system do not move the mesh. Linked CG objects are not moved.</div></div>`;
  const operations = `${transform}<div class="sec"><h4><span>Operations</span></h4>
    <div class="btns"><button class="btn" data-act="rppStl">Bounding RPP</button><button class="btn" data-act="detectFeat">Detect features… <small>(experimental)</small></button>
    <button class="btn" data-act="cadCompare" title="Colour the CG regions linked to this mesh by their distance to it, volumes and metrics">Compare with CG regions…</button>
    <button class="btn" data-act="splitStl" title="One mesh per connected solid">Split into solids</button></div>
    <div class="btns opsdel"><button class="btn danger" data-act="del">Remove</button></div></div>`;
  return tabbed({ general, view, definition, operations });
}
function measureProps(m) {
  const general = `<div class="sec"><h4><span>Measure</span></h4><div id="liveInfo">${liveInfoHTML()}</div></div>`;
  const operations = `<div class="sec"><h4><span>Operations</span></h4><div class="btns"><button class="btn" data-act="rppMeasure">RPP from these 2 points</button></div><div class="btns opsdel"><button class="btn danger" data-act="del">Delete</button></div></div>`;
  return tabbed({ general, operations });
}
