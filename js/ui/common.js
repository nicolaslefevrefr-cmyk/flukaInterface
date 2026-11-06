/* ui/common.js — Shared helpers (selectors, formatting, icons), toast, clipboard
 * Part of the user interface: the files of js/ui/ are classic scripts that share one scope (load order: see index.html). */
'use strict';
const APP = window.APP, S = APP.S, V = FK.V, fmt = FK.fmt;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (n, d) => (n === null || n === undefined || !isFinite(n)) ? '—' : fmt(n, d === undefined ? 4 : d);
const xyz = (p, d) => `${f(p[0], d)}, ${f(p[1], d)}, ${f(p[2], d)}`;
const kv = (rows) => '<div class="kv">' + rows.map(r => `<span>${r[0]}</span><span>${r[1]}</span>`).join('') + '</div>';
const cm = (n, d) => `${f(n, d)} cm`;
const cmmm = (n) => `${f(n, 4)} cm <small class="muted">(${f(n * 10, 3)} mm)</small>`;

const ICON = {
  eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A10.4 10.4 0 0 1 12 5c7 0 11 7 11 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/></svg>'
};

/* ---------- Toast ---------- */
const toastEl = $('#toast');
let toastT;
APP.hooks.toast = (m) => { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3600); };
const toast = APP.hooks.toast;

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied to the clipboard'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Copy failed'); }
    ta.remove();
  }
}

/* ---------- Clickable object names in messages ---------- */
/** Finds the object (body / region / mesh / csys) a name refers to — preferring `prefer` ('body' | 'region') on ties. */
function refOf(name, prefer) {
  const kinds = prefer === 'region' ? ['region', 'body', 'stl', 'csys'] : ['body', 'region', 'stl', 'csys'];
  for (const t of kinds) {
    const list = t === 'body' ? S.model.bodies : t === 'region' ? S.model.regions : t === 'stl' ? (S.model.stls || []) : (S.model.csys || []);
    const o = list.find(x => x.name === name);
    if (o) return { t, id: o.id };
  }
  return null;
}
/** Escapes a message and turns each quoted name that matches an object into a link ("name" → select it and flash it). */
function linkify(text, prefer) {
  return esc(String(text)).replace(/&quot;([^&]+?)&quot;|"([^"]+?)"/g, (all, a, b) => {
    const nm = (a || b).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const r = refOf(nm, prefer);
    return r ? `<span class="oref" role="button" tabindex="0" data-t="${r.t}" data-id="${r.id}" title="Select it in the project and in the 3D view">${esc(nm)}</span>` : all;
  });
}
/** Names listed after "Unknown body:" etc. are plain text; this links a comma list of object names. */
function linkNames(names, prefer) {
  return names.map(n => { const r = refOf(n, prefer); return r ? `<span class="oref" role="button" tabindex="0" data-t="${r.t}" data-id="${r.id}" title="Select it in the project and in the 3D view">${esc(n)}</span>` : esc(n); }).join(', ');
}
function goRef(t, id) {
  const o = typeof findItem === 'function' ? findItem(t, id) : null;
  if (!o) { toast('Object not found (renamed or deleted)'); return; }
  selectItem(t, id);
  if (o.visible === false) toast(`${o.name} is hidden (use its eye to show it)`);
  flashId(id);
}
function flashId(id) {
  const prev = S.hlSet, mine = new Set([id]);
  S.hlSet = mine; APP.applyStyles();
  setTimeout(() => { if (S.hlSet === mine) { S.hlSet = prev || null; APP.applyStyles(); } }, 1500);
}
function onOref(e) {
  const el = e.target.closest && e.target.closest('.oref');
  if (!el) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); e.stopPropagation();
  goRef(el.dataset.t, +el.dataset.id);
}
document.addEventListener('click', onOref, true);
document.addEventListener('keydown', onOref, true);
