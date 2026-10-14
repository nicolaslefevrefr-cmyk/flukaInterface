/* scene.js — three.js scene, camera, body/region synchronisation, picking */
(function () {
  'use strict';
  const APP = window.APP, S = APP.S, V = FK.V, fmt = FK.fmt;
  const canvas = document.getElementById('gl');
  const labelsEl = document.getElementById('labels');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const FOV = 35;
  const pcam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000), ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  pcam.up.set(0, 0, 1); ocam.up.set(0, 0, 1);
  let camera = pcam, aspect = 1;
  scene.add(pcam, ocam);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaab4c2, 0.85));
  const headLight = new THREE.DirectionalLight(0xffffff, 0.55);
  headLight.position.set(0.4, 0.6, 1);
  camera.add(headLight);

  const gStl = new THREE.Group(), gBody = new THREE.Group(), gRegion = new THREE.Group(),
    gMeasure = new THREE.Group(), gCsys = new THREE.Group(), gSel = new THREE.Group(), gHover = new THREE.Group(), gPend = new THREE.Group(), gCut = new THREE.Group();
  scene.add(gStl, gBody, gRegion, gMeasure, gCsys, gPend, gSel, gHover, gCut);
  let axes = null;

  let needRender = true;
  APP.requestRender = () => { needRender = true; };

  /* ---------- Orbit camera (Z up) ---------- */
  /* Orientation stored as a quaternion: no elevation clamp, so the view can be rotated indefinitely in any direction. */
  const Zaxis = new THREE.Vector3(0, 0, 1), Xaxis = new THREE.Vector3(1, 0, 0);
  const qAzEl = (az, el) => {
    const ce = Math.cos(el), eye = new THREE.Vector3(ce * Math.cos(az), ce * Math.sin(az), Math.sin(el));
    const m = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(), Zaxis);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  };
  const cam = { target: new THREE.Vector3(0, 0, 0), q: qAzEl(-0.9, 0.5), dist: 300 };
  APP.cam = cam;
  let sceneR = 100;
  function applyCam() {
    cam.q.normalize();
    camera.quaternion.copy(cam.q);
    camera.position.copy(cam.target).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(cam.q), cam.dist);
    camera.updateMatrixWorld(true);
    if (camera.isOrthographicCamera) {
      // same apparent size as the perspective view at the pivot; objects behind the camera plane stay visible
      const hh = cam.dist * Math.tan(FOV * Math.PI / 360);
      camera.left = -hh * aspect; camera.right = hh * aspect; camera.top = hh; camera.bottom = -hh;
      camera.near = -(sceneR * 4 + 10);
    } else camera.near = Math.max(0.001, cam.dist * 0.01);
    camera.far = cam.dist + sceneR * 4 + 10;
    camera.updateProjectionMatrix();
    needRender = true;
  }
  /** 'persp' | 'ortho' */
  APP.setProjection = function (mode) {
    const next = mode === 'ortho' ? ocam : pcam;
    S.opt.proj = mode === 'ortho' ? 'ortho' : 'persp';
    if (next !== camera) { camera.remove(headLight); camera = next; camera.add(headLight); }
    applyCam();
  };
  Object.defineProperty(APP, 'camera', { get: () => camera });
  /** Bounding box of what is currently displayed (visible meshes, bodies, regions); falls back to the render zone. */
  APP.visibleBox = function () {
    const sb = [], bodies = [];
    for (const m of S.stls) if (m.visible && m.stats && m.stats.bbox) sb.push(m.stats.bbox);
    for (const b of S.model.bodies) if (b.visible && b.type !== 'RAW' && !FK.isPlaneType(b.type) && !FK.isInfiniteType(b.type)) bodies.push(APP.wbody(b));
    for (const r of S.model.regions) { const c = regC.get(r.id); if (r.visible && c && c.bbox) sb.push(c.bbox); }
    if (!sb.length && !bodies.length) return S.W;
    return FK.computeWorldBox(sb, bodies, 0);
  };
  APP.fit = function () {
    const W = APP.visibleBox(); if (!W) return;
    const c = FK.boxCenter(W), r = Math.max(FK.boxDiag(W) / 2, 1);
    sceneR = r;
    cam.target.set(c[0], c[1], c[2]);
    cam.dist = r / Math.sin(FOV * Math.PI / 360) * 1.05;
    applyCam();
  };
  /** Look along a world direction (camera placed on the +dir side, looking at the pivot). Looking again along the same direction flips to the opposite side. */
  APP.viewAlong = function (dir, flipIfSame) {
    let d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const cur = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.q);
    if (flipIfSame && cur.dot(d) > 0.9995) d.negate();
    const up = Math.abs(d.z) > 0.99 ? new THREE.Vector3(0, 1, 0) : Zaxis;
    cam.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(d, new THREE.Vector3(), up));
    applyCam();
  };
  APP.viewDir = () => { const v = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.q); return [v.x, v.y, v.z]; };
  APP.setView = function (v) {
    if (v === 'fit') return APP.fit();
    if (v === 'flip') { const d = APP.viewDir(); return APP.viewAlong([-d[0], -d[1], -d[2]]); }
    if (v === 'iso') cam.q = qAzEl(-0.785, 0.6);
    else if (v === 'top') return APP.viewAlong([0, 0, 1]);
    else if (v === 'front') return APP.viewAlong([0, -1, 0]);
    else if (v === 'side') return APP.viewAlong([1, 0, 0]);
    applyCam();
  };

  function resize() {
    const vp = canvas.parentElement;
    const w = Math.max(vp.clientWidth, 1), h = Math.max(vp.clientHeight, 1);
    renderer.setSize(w, h, false);
    aspect = w / h; pcam.aspect = aspect; applyCam();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);

  /* ---------- Pointers ---------- */
  const ptrs = new Map();
  let gesture = null, pinch = null;
  function panBy(dx, dy) {
    const h = canvas.clientHeight || 1;
    const k = 2 * cam.dist * Math.tan(FOV * Math.PI / 360) / h;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.q);
    cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  }
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      gesture = { mode: (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'rotate', moved: 0, btn: e.button, t: performance.now(), sx: e.clientX, sy: e.clientY };
    } else if (ptrs.size === 2) {
      const [a, b] = Array.from(ptrs.values());
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      gesture = { mode: 'pinch', moved: 99, btn: 0, t: 0 };
    }
    if (APP.hooks.leave) APP.hooks.leave();
  });
  canvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse' && APP.hooks.hover) APP.hooks.hover(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!gesture) return;
    if (gesture.mode === 'pinch' && ptrs.size >= 2) {
      const [a, b] = Array.from(ptrs.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (pinch && pinch.d > 0 && d > 0) cam.dist = Math.max(0.01, cam.dist * pinch.d / d);
      if (pinch) panBy(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy }; applyCam(); return;
    }
    gesture.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.moved < 6 && gesture.mode !== 'pinch') return;
    if (gesture.mode === 'rotate') {
      // yaw about the world Z axis, pitch about the camera's right axis; no limit on either
      const qy = new THREE.Quaternion().setFromAxisAngle(Zaxis, dx * 0.008);
      const qp = new THREE.Quaternion().setFromAxisAngle(Xaxis, -dy * 0.008);
      cam.q = qy.multiply(cam.q).multiply(qp); applyCam();
    }
    else if (gesture.mode === 'pan') { panBy(dx, dy); applyCam(); }
  });
  function endPtr(e) {
    const had = ptrs.delete(e.pointerId);
    if (!had || !gesture) return;
    if (ptrs.size === 0) {
      const g = gesture; gesture = null; pinch = null;
      if (e.type === 'pointerup' && g.mode !== 'pinch' && g.moved < 6 && g.btn === 0 && performance.now() - g.t < 700) {
        if (APP.hooks.click) APP.hooks.click(e.clientX, e.clientY);
      }
    } else if (ptrs.size === 1) { pinch = null; gesture = { mode: 'pinch', moved: 99, btn: 0, t: 0 }; }
  }
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('pointerleave', () => { if (APP.hooks.leave) APP.hooks.leave(); });
  // double-click: the clicked point becomes the new centre of rotation
  canvas.addEventListener('dblclick', e => {
    const hit = APP.raycast(e.clientX, e.clientY);
    if (!hit) return;
    cam.target.set(hit.point.x, hit.point.y, hit.point.z);
    applyCam();
    if (APP.toast) APP.toast('Rotation centre: ' + [hit.point.x, hit.point.y, hit.point.z].map(v => fmt(v, 4)).join(', ') + ' cm');
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist = Math.max(0.01, cam.dist * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    applyCam();
  }, { passive: false });

  /* ---------- Material / geometry helpers ---------- */
  function disposeObj(o) {
    if (!o) return;
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    });
    if (o.parent) o.parent.remove(o);
  }
  function darker(hex, k) { return new THREE.Color(hex).multiplyScalar(k); }
  function makeSolidGroup(positions, colorHex, opacity, kind, id) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshPhongMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, shininess: 25 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData = { kind, id };
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({ color: darker(colorHex, 0.55) }));
    lines.raycast = () => {};
    const grp = new THREE.Group(); grp.add(mesh, lines);
    return { group: grp, mesh, lines };
  }

  /* ---------- STL ---------- */
  const UNIT = { mm: 0.1, cm: 1, m: 100, in: 2.54 };
  APP.UNIT = UNIT;
  APP.buildStl = function (stl) {
    if (stl.group) { disposeObj(stl.group); stl.group = null; stl.mesh = null; }
    const f = UNIT[stl.unit] || 0.1, raw = stl.raw, n = raw.length;
    const pos = new Float32Array(n);
    for (let i = 0; i < n; i += 3) { pos[i] = raw[i] * f + stl.offset[0]; pos[i + 1] = raw[i + 1] * f + stl.offset[1]; pos[i + 2] = raw[i + 2] * f + stl.offset[2]; }
    stl.positions = pos;
    stl.stats = FK.meshStats(pos);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    const mat = new THREE.MeshPhongMaterial({ color: stl.color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, shininess: 30 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData = { kind: 'stl', id: stl.id };
    const grp = new THREE.Group(); grp.add(mesh);
    if (stl.edges && stl.stats.count <= 120000) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0x39434f }));
      lines.raycast = () => {}; grp.add(lines);
    }
    stl.group = grp; stl.mesh = mesh;
    gStl.add(grp);
  };
  APP.hooks.disposeStl = function (stl) { if (stl.group) disposeObj(stl.group); stl.group = null; stl.mesh = null; needRender = true; };

  /* ---------- Body / region synchronisation ---------- */
  const bodyC = new Map(), regC = new Map();
  APP.bodyCache = bodyC; APP.regionCache = regC;
  let lastWsig = '';

  function planeVisual(b, W, wb) {
    const pp = FK.planePolygon(wb, W);
    if (!pp) return null;
    const v = pp.verts, pos = [];
    for (let i = 1; i < v.length - 1; i++) pos.push(v[0][0], v[0][1], v[0][2], v[i][0], v[i][1], v[i][2], v[i + 1][0], v[i + 1][1], v[i + 1][2]);
    const grp = new THREE.Group();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: b.color, side: THREE.DoubleSide, transparent: true, opacity: b.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(g, mat); mesh.userData = { kind: 'body', id: b.id };
    const lg = new THREE.BufferGeometry().setFromPoints(v.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const lines = new THREE.LineLoop(lg, new THREE.LineBasicMaterial({ color: darker(b.color, 0.55) }));
    lines.raycast = () => {};
    const len = Math.max(FK.boxDiag(W) * 0.06, 1);
        const origin = V.add(pp.center, V.mul(pp.normal, 0));
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(pp.normal[0], pp.normal[1], pp.normal[2]), new THREE.Vector3(origin[0], origin[1], origin[2]), len, darker(b.color, 0.55).getHex(), len * 0.3, len * 0.15);
    arrow.traverse(o => { o.raycast = () => {}; });
    // arrow at the plane point V if inside the zone, otherwise at the projected centre
    grp.add(mesh, lines, arrow);
    return { group: grp, mesh, lines, arrow };
  }

  APP.sync = function () {
    const stlBoxes = S.stls.filter(s => s.stats && s.stats.bbox).map(s => s.stats.bbox);
    const wbodies = new Map(S.model.bodies.map(b => [b.id, APP.wbody(b)]));
    const W = S.W = FK.computeWorldBox(stlBoxes, Array.from(wbodies.values()), S.opt.margin);
    const wsig = W.min.concat(W.max).map(x => x.toFixed(3)).join(',');
    const byName = new Map();
    for (const b of S.model.bodies) if (!byName.has(b.name)) byName.set(b.name, b);
    if (wsig !== lastWsig) {
      lastWsig = wsig;
      sceneR = Math.max(FK.boxDiag(W) / 2, 1);
      if (axes) disposeObj(axes);
      axes = new THREE.AxesHelper(Math.max(FK.boxDiag(W) * 0.06, 1));
      axes.material.depthTest = false; axes.renderOrder = 5;
      scene.add(axes);
    }
    if (axes) axes.visible = !!S.opt.axes;

    // corps
    const seenB = new Set();
    for (const b of S.model.bodies) {
      seenB.add(b.id);
      const wb = wbodies.get(b.id);
      const sig = wsig + '|' + wb.type + '|' + wb.p.join(',') + (FK.isPlaneType(wb.type) ? '|' + b.color : '');
      let c = bodyC.get(b.id);
      if (c && c.sig === sig && c.colorKey === b.color) continue;
      if (c && c.group) disposeObj(c.group);
      c = { sig, colorKey: b.color, polys: undefined, group: null, mesh: null, lines: null };
      bodyC.set(b.id, c);
      try {
        if (b.type === 'RAW') { /* not displayed */ }
        else if (FK.isPlaneType(wb.type)) {
          const pv = planeVisual(b, W, wb);
          if (pv) { c.group = pv.group; c.mesh = pv.mesh; c.lines = pv.lines; }
        } else {
          c.polys = FK.bodyPolys(wb, W);
          if (c.polys && c.polys.length) {
            const o = makeSolidGroup(FK.polysToPositions(c.polys), b.color, b.opacity, 'body', b.id);
            c.group = o.group; c.mesh = o.mesh; c.lines = o.lines;
          }
        }
      } catch (e) { c.err = e.message; }
      if (c.group) gBody.add(c.group);
    }
    for (const [id, c] of bodyC) if (!seenB.has(id)) { if (c.group) disposeObj(c.group); bodyC.delete(id); }

    // regions
    const polysOf = (b) => {
      const c = bodyC.get(b.id); if (!c) return null;
      if (c.polys === undefined) { try { c.polys = FK.bodyPolys(wbodies.get(b.id), W); } catch (e) { c.polys = null; } }
      return c.polys;
    };
    const ctx = { body: (n) => { const b = byName.get(n); return b ? polysOf(b) : null; }, world: () => FK.boxPolys(W) };
    const seenR = new Set();
    for (const r of S.model.regions) {
      seenR.add(r.id);
      const needed = r.visible || (S.sel && S.sel.t === 'region' && S.sel.id === r.id);
      let c = regC.get(r.id);
      if (!c) { c = { sig: null, group: null, err: null }; regC.set(r.id, c); }
      if (!needed) continue;
      let ast = null, names = [];
      try { ast = FK.parseExpr(r.expr); names = Array.from(FK.exprNames(ast)); } catch (e) { c.err = e.message; if (c.group) { disposeObj(c.group); c.group = null; } c.sig = 'err:' + r.expr; continue; }
      const sig = wsig + '|' + r.expr + '|' + r.color + '|' + names.map(n => { const b = byName.get(n); if (!b) return '?'; const w = wbodies.get(b.id); return w.type + w.p.join(','); }).join(';');
      if (c.sig === sig) continue;
      if (c.group) { disposeObj(c.group); c.group = null; }
      c.sig = sig; c.err = null; c.vol = null; c.area = null; c.bbox = null; c.polys = null;
      try {
        const polys = FK.evalExpr(ast, ctx);
        c.polys = polys;
        c.vol = FK.polysVolume(polys); c.area = FK.polysArea(polys); c.bbox = FK.polysBBox(polys);
        if (polys.length) {
          const o = makeSolidGroup(FK.polysToPositions(polys), r.color, r.opacity, 'region', r.id);
          c.group = o.group; c.mesh = o.mesh; c.lines = o.lines; gRegion.add(c.group);
        }
      } catch (e) { c.err = e.message; }
    }
    for (const [id, c] of regC) if (!seenR.has(id)) { if (c.group) disposeObj(c.group); regC.delete(id); }
    APP.applyStyles();
  };

  APP.applyStyles = function () {
    const sel = S.sel;
    for (const b of S.model.bodies) {
      const c = bodyC.get(b.id); if (!c || !c.group) continue;
      const isSel = sel && sel.t === 'body' && sel.id === b.id;
      c.group.visible = !!b.visible;
      c.mesh.visible = b.opacity > 0.004;
      c.mesh.material.color.set(b.color);
      c.mesh.material.opacity = Math.min(1, b.opacity + (isSel ? 0.15 : 0));
      c.lines.material.color.set(isSel ? 0xff6a00 : darker(b.color, 0.55).getHex());
    }
    for (const r of S.model.regions) {
      const c = regC.get(r.id); if (!c || !c.group) continue;
      const isSel = sel && sel.t === 'region' && sel.id === r.id;
      c.group.visible = !!r.visible;
      c.mesh.visible = r.opacity > 0.004;
      c.mesh.material.color.set(r.color);
      c.mesh.material.opacity = Math.min(1, r.opacity + (isSel ? 0.15 : 0));
      c.lines.material.color.set(isSel ? 0xff6a00 : darker(r.color, 0.55).getHex());
    }
    for (const s of S.stls) {
      if (!s.group) continue;
      const isSel = sel && sel.t === 'stl' && sel.id === s.id;
      s.group.visible = !!s.visible;
      const m = s.mesh.material, tr = s.opacity < 0.995;
      m.color.set(s.color); m.opacity = s.opacity; m.transparent = tr; m.depthWrite = !tr;
      m.emissive.setHex(isSel ? 0x1c3566 : 0x000000); m.needsUpdate = true;
      s.mesh.visible = s.opacity > 0.004;
    }
    if (axes) axes.visible = !!S.opt.axes;
    needRender = true;
  };

  /* ---------- Measures ---------- */
  function circleTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
    x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke();
    return new THREE.CanvasTexture(c);
  }
  const dotTex = circleTexture();
  function markers(pts, colorHex, size) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ color: colorHex, size: size || 11, sizeAttenuation: false, map: dotTex, alphaTest: 0.3, transparent: true, depthTest: false }));
    m.renderOrder = 10; m.raycast = () => {};
    return m;
  }
  function polyline(pts, colorHex) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: colorHex, depthTest: false, transparent: true }));
    l.renderOrder = 9; l.raycast = () => {};
    return l;
  }
  function clearGroup(g) { while (g.children.length) disposeObj(g.children[0]); }
  APP.fmtLen = (d) => fmt(d, 4) + ' cm';
  APP.rebuildMeasures = function () {
    clearGroup(gMeasure); labelsEl.innerHTML = '';
    for (const m of S.measures) {
      m.labelEl = null;
      if (!m.visible) continue;
      gMeasure.add(polyline([m.a, m.b], 0xf97316), markers([m.a, m.b], 0xf97316, 9));
      const d = V.dist(m.a, m.b);
      const lab = document.createElement('div'); lab.className = 'lab';
      lab.textContent = fmt(d, 3) + ' cm';
      labelsEl.appendChild(lab); m.labelEl = lab;
    }
    needRender = true;
  };
  APP.setPending = function (pt) {
    clearGroup(gPend);
    if (pt) gPend.add(markers(Array.isArray(pt[0]) ? pt : [pt], 0x16a34a, 12));
    needRender = true;
  };

  /* ---------- Coordinate systems (csys) ---------- */
  const clabels = document.createElement('div');
  clabels.id = 'clabels'; labelsEl.parentElement.appendChild(clabels);
  const csysLab = [];
  APP.rebuildCsys = function () {
    clearGroup(gCsys); clabels.innerHTML = ''; csysLab.length = 0;
    const L = Math.max((S.W ? FK.boxDiag(S.W) : 100) * 0.07, 1);
    const list = [{ id: 0, name: 'Global', m: FK.M.id(), visible: false, color: '#64748b' }].concat(S.model.csys.map(c => ({ id: c.id, name: c.name, m: APP.csysWorld(c.id), visible: c.visible, color: c.color })));
    for (const c of list) {
      const isAct = (S.model.active || 0) === c.id;
      if (!c.visible && !(isAct && c.id)) continue;
      const o = [c.m[3], c.m[7], c.m[11]];
      const mk = (ax, hex) => polyline([o, FK.M.apply(c.m, ax.map(x => x * L))], hex);
      gCsys.add(mk([1, 0, 0], 0xdc2626), mk([0, 1, 0], 0x16a34a), mk([0, 0, 1], 0x2563eb));
      gCsys.add(markers([o], new THREE.Color(c.color).getHex(), isAct ? 9 : 6));
      const lab = document.createElement('div'); lab.className = 'lab clab' + (isAct ? ' act' : ''); lab.textContent = c.name;
      lab.style.color = c.color;
      clabels.appendChild(lab); csysLab.push({ el: lab, p: o });
    }
    needRender = true;
  };

  /* ---------- Orientation triad (top-right) ---------- */
  const triadEl = document.getElementById('triad');
  const AXES = [{ n: 'X', v: [1, 0, 0], c: '#dc2626' }, { n: 'Y', v: [0, 1, 0], c: '#16a34a' }, { n: 'Z', v: [0, 0, 1], c: '#2563eb' }];
  function updateTriad() {
    if (!triadEl) return;
    const inv = cam.q.clone().invert(), C = 46, L = 30, ends = [];
    for (const a of AXES) for (const sg of [1, -1]) {
      const v = new THREE.Vector3(a.v[0] * sg, a.v[1] * sg, a.v[2] * sg).applyQuaternion(inv);
      ends.push({ a, sg, x: C + v.x * L, y: C - v.y * L, z: v.z });
    }
    ends.sort((p, q) => p.z - q.z);
    let h = `<svg viewBox="0 0 ${2 * C} ${2 * C}"><circle cx="${C}" cy="${C}" r="${C - 2}" fill="rgba(255,255,255,.55)" stroke="rgba(0,0,0,.08)"/>`;
    for (const e of ends) {
      const d = `data-dir="${e.a.v.map(x => x * e.sg).join(',')}"`;
      h += `<g class="ax" ${d}>` + (e.sg > 0
        ? `<line x1="${C}" y1="${C}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="${e.a.c}" stroke-width="2.5" opacity="${(0.55 + 0.45 * (e.z + 1) / 2).toFixed(2)}"/><circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="9" fill="${e.a.c}"/><text x="${e.x.toFixed(1)}" y="${(e.y + 3.6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${e.a.n}</text>`
        : `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="5.5" fill="#fff" stroke="${e.a.c}" stroke-width="1.5" opacity="${(0.45 + 0.4 * (e.z + 1) / 2).toFixed(2)}"/>`) + '</g>';
    }
    triadEl.innerHTML = h + '</svg>';
  }
  if (triadEl) triadEl.addEventListener('click', e => {
    const g = e.target.closest('.ax'); if (!g) return;
    APP.viewAlong(g.dataset.dir.split(',').map(Number), true);
  });

  function updateLabels() {
    updateTriad();
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    for (const l of csysLab) {
      const v = new THREE.Vector3(l.p[0], l.p[1], l.p[2]).project(camera);
      if (v.z > 1 || v.z < -1) { l.el.style.display = 'none'; continue; }
      l.el.style.display = ''; l.el.style.left = ((v.x + 1) / 2 * cw) + 'px'; l.el.style.top = ((1 - v.y) / 2 * ch) + 'px';
    }
    if (!S.measures.length) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const m of S.measures) {
      if (!m.labelEl) continue;
      const mid = new THREE.Vector3((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2).project(camera);
      if (mid.z > 1 || mid.z < -1) { m.labelEl.style.display = 'none'; continue; }
      m.labelEl.style.display = '';
      m.labelEl.style.left = ((mid.x + 1) / 2 * w) + 'px';
      m.labelEl.style.top = ((1 - mid.y) / 2 * h) + 'px';
    }
  }

  /* ---------- Rays and picking ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickMeshes() {
    const out = [];
    for (const s of S.stls) if (s.mesh && s.visible && s.opacity > 0.004) out.push(s.mesh);
    for (const b of S.model.bodies) { const c = bodyC.get(b.id); if (c && c.mesh && b.visible && b.opacity > 0.004) out.push(c.mesh); }
    for (const r of S.model.regions) { const c = regC.get(r.id); if (c && c.mesh && r.visible && r.opacity > 0.004) out.push(c.mesh); }
    return out;
  }
  APP.totalTris = () => pickMeshes().reduce((a, m) => a + m.geometry.attributes.position.count / 3, 0);
  APP.raycast = function (cx, cy) {
    const r = canvas.getBoundingClientRect();
    camera.updateMatrixWorld(true);
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickMeshes(), false);
    return hits.length ? hits[0] : null;
  };
  function toScreen(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
    const r = canvas.getBoundingClientRect();
    return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top];
  }
  function topoOf(mesh) {
    if (!mesh.userData.topo) mesh.userData.topo = FK.buildTopology(mesh.geometry.attributes.position.array);
    return mesh.userData.topo;
  }
  function ownerOf(mesh) {
    const u = mesh.userData;
    if (u.kind === 'stl') { const s = APP.getStl(u.id); return { kind: 'stl', id: u.id, name: s ? s.name : '?', flip: s && s.flip ? -1 : 1 }; }
    if (u.kind === 'body') { const b = APP.getBody(u.id); return { kind: 'body', id: u.id, name: b ? b.name : '?', flip: 1 }; }
    const r = APP.getRegion(u.id); return { kind: 'region', id: u.id, name: r ? r.name : '?', flip: 1 };
  }

  /** Point (snapped vertex or free point) from a hit. */
  APP.pointFromHit = function (hit, cx, cy, forceSnap) {
    const mesh = hit.object, topo = topoOf(mesh), tv = FK.triVerts(topo, hit.faceIndex);
    const hp = [hit.point.x, hit.point.y, hit.point.z];
    const owner = ownerOf(mesh);
    if (S.opt.snap || forceSnap) {
      let best = null, bd = 1e9;
      for (const v of tv) { const s = toScreen(v); const d = Math.hypot(s[0] - cx, s[1] - cy); if (d < bd) { bd = d; best = v; } }
      if (best && bd <= 30) return { kind: 'point', p: best, snapped: true, ownerKind: owner.kind, ownerId: owner.id, ownerName: owner.name };
    }
    return { kind: 'point', p: hp, snapped: false, ownerKind: owner.kind, ownerId: owner.id, ownerName: owner.name };
  };

  function segDist(p, a, b) {
    const ab = V.sub(b, a), t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), ab) / (V.dot(ab, ab) || 1)));
    return V.dist(p, V.add(a, V.mul(ab, t)));
  }

  APP.makePick = function (hit, filter, cx, cy) {
    const mesh = hit.object, topo = topoOf(mesh), tri = hit.faceIndex, tv = FK.triVerts(topo, tri), owner = ownerOf(mesh);
    const base = { ownerKind: owner.kind, ownerId: owner.id, ownerName: owner.name, mesh, tri };
    const hp = [hit.point.x, hit.point.y, hit.point.z];
    if (filter === 'point') return APP.pointFromHit(hit, cx, cy);
    if (filter === 'edge') {
      const cosA = Math.cos(S.opt.sharp * Math.PI / 180);
      let best = -1, bd = 1e18;
      for (let k = 0; k < 3; k++) {
        if (S.opt.edgeSharpOnly && !FK.isSharpEdge(topo, tri, k, cosA)) continue;
        const d = segDist(hp, tv[k], tv[(k + 1) % 3]);
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0) return Object.assign({ kind: 'edge', none: true }, base);
      const a = tv[best], b = tv[(best + 1) % 3];
      let chain = null;
      if (S.opt.edgeSharpOnly) {
        const va = topo.vid[tri * 3 + best], vb = topo.vid[tri * 3 + (best + 1) % 3];
        const ch = FK.edgeChain(topo, va, vb, S.opt.sharp);
        if (ch.segments > 1) chain = ch;
      }
      return Object.assign({ kind: 'edge', a, b, length: V.dist(a, b), chain }, base);
    }
    if (filter === 'face') {
      const tris = S.opt.coplanar ? FK.coplanarPatch(topo, tri, S.opt.coTol) : [tri];
      const info = FK.patchInfo(topo, tris);
      let n = FK.triNormal(topo, tri); n = V.mul(n, owner.flip);
      return Object.assign({ kind: 'face', tris, area: info.area, centroid: info.centroid, bbox: info.bbox, count: info.count, normal: n, seedVerts: tv, seed: tri }, base);
    }
    // objet
    return Object.assign({ kind: 'object', hitPoint: hp }, base);
  };

  /* ---------- Highlight (selection / hover) ---------- */
  APP.drawHighlight = function (grp, pk, hover) {
    clearGroup(grp);
    if (pk) {
      const col = hover ? 0x7aa7ff : 0xe11d48;
      if (pk.kind === 'point') grp.add(markers([pk.p], col, hover ? 10 : 13));
      else if (pk.kind === 'edge' && !pk.none) {
        const a = pk.chain ? pk.chain.a : pk.a, b = pk.chain ? pk.chain.b : pk.b;
        grp.add(polyline([a, b], col), markers([a, b], col, 9));
      } else if (pk.kind === 'face') {
        const topo = topoOf(pk.mesh), pos = topo.pos, tris = pk.tris.length > 100000 ? pk.tris.slice(0, 100000) : pk.tris;
        const arr = new Float32Array(tris.length * 9);
        tris.forEach((t, i) => { for (let j = 0; j < 9; j++) arr[i * 9 + j] = pos[t * 9 + j]; });
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: hover ? 0.3 : 0.5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        m.raycast = () => {}; m.renderOrder = 8; grp.add(m);
      } else if (pk.kind === 'object') {
        const bb = APP.objectStats(pk).bbox;
        if (bb) {
          const h = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...bb.min), new THREE.Vector3(...bb.max)), col);
          h.raycast = () => {}; grp.add(h);
        }
      }
    }
    needRender = true;
  };
  APP.gSel = gSel; APP.gHover = gHover;
  APP.clearHover = () => { clearGroup(gHover); needRender = true; };

  /** Statistics of an object (mesh, body or region). */
  APP.objectStats = function (pk) {
    if (pk.ownerKind === 'stl') { const s = APP.getStl(pk.ownerId); return s && s.stats ? s.stats : {}; }
    if (pk.ownerKind === 'body') {
      const b = APP.getBody(pk.ownerId); if (!b) return {};
      const c = bodyC.get(b.id);
      const polys = c && c.polys;
      const wbd = APP.wbody(b);
      const bb = FK.bodyBBox(wbd) || (polys && FK.polysBBox(polys)) || null;
      const vol = FK.bodyVolume(wbd);
      return { volume: vol, area: polys ? FK.polysArea(polys) : null, bbox: bb, centroid: bb ? FK.boxCenter(bb) : null, count: null, infinite: FK.isInfiniteType(wbd.type) };
    }
    const c = regC.get(pk.ownerId);
    return c ? { volume: c.vol, area: c.area, bbox: c.bbox, centroid: c.bbox ? FK.boxCenter(c.bbox) : null } : {};
  };

  /* ---------- Render loop ---------- */
  function loop() {
    if (needRender) { needRender = false; renderer.render(scene, camera); updateLabels(); }
    requestAnimationFrame(loop);
  }
  APP.startLoop = function () { resize(); APP.setProjection(S.opt.proj); loop(); };
  APP.applyCam = applyCam;

  /* ---------- Section plane visual (see cut.js) ---------- */
  APP.setCutPlane = function (f, half) {
    clearGroup(gCut);
    if (f && half > 0) {
      const c = (a, b) => new THREE.Vector3(f.o[0] + f.u[0] * a + f.v[0] * b, f.o[1] + f.u[1] * a + f.v[1] * b, f.o[2] + f.u[2] * a + f.v[2] * b);
      const q = [c(-half, -half), c(half, -half), c(half, half), c(-half, half)];
      const g = new THREE.BufferGeometry().setFromPoints([q[0], q[1], q[2], q[0], q[2], q[3]]);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd9480f, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
      m.raycast = () => {};
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(q), new THREE.LineBasicMaterial({ color: 0xd9480f }));
      l.raycast = () => {};
      gCut.add(m, l);
    }
    needRender = true;
  };
})();
