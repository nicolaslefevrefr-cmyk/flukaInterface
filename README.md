# Combinatorial Geometry Tool  (v1.18.0)

CAD (STL / OBJ) → CG / multi-line combinatorial geometry.

Pure web tool (HTML/CSS/JS, installable as a PWA): loads an STL or OBJ mesh exported from CAD, lets you measure, create RPP (2 points) and PLA (from a mesh triangle), cut regions, and writes the CG / multi-line `GEOBEGIN … GEOEND` block live (everything in cm).

**GitHub Pages deployment**: push this folder to the root of a repository, then *Settings → Pages* → branch `main`, folder `/ (root)`. PWA install needs HTTPS (provided by GitHub Pages); locally, just open `index.html`.

## Interface
- **Top bar**: *File* menu (new / open / save project, import STL / OBJ / INP, export .inp), undo / redo, `.inp` sheet, ⚙ settings (display, title, output format), ▤ properties of the selected item.
- **Top band of the view** (v1.3; groups separated by vertical rules): selection filters (point / edge / face / object), Info and Distance tools, view buttons (fit to what is displayed, Iso, Z, Y, X, ⟂ look normal to a face, ⇄ opposite side). Also in the band: render modes, mouse-rotation inversion (⇄ left/right, ⇅ up/down). **Top-right of the view**: axis triad — click an axis to look along it (click again for the opposite side).
- **Tool window** (top-left of the view): options and results of the current tool (snap, whole face, pick card, last distance…).
- **Tree view** (left): Meshes, Coordinate systems, Planes, Bodies, Regions, Measures. Fold/unfold groups; right-click a group header (or use ＋) to create items; right-click an item (or ⋮) to rename, duplicate, delete, show/hide, etc.
- **Pickers**: next to every coordinate group of a body (RPP min/max corner, sphere centre/radius, cylinder base/axis/radius, PLA normal/point, plane position…) the ⌖ button lets you click a point (or a face, for a PLA normal) in the 3D view; the value is written in the body's own coordinate system. Each coordinate field also has its own small ⌖ to fill a single value (e.g. only ymax). Same for a coordinate system origin.
- **View**: drag = rotate (unlimited), double-click = set the rotation centre, right-drag / Shift+drag = pan, wheel = zoom.

## Coordinate systems (csys)
- **Global (0,0,0)** is active by default. Create, activate (●), hide, duplicate, delete coordinate systems; the **Csys** tool builds one from 3 points (origin, X axis, XY plane); "Csys here" / "Csys on face" in the pick card.
- Each system is defined relative to a parent (position + angles, X/Y vectors, or 3×4 matrix). When a parent moves, its children follow, unless **Freeze** is checked (the child keeps its world pose).
- Each body chooses its system ("Defined in coordinate system"); new bodies (2-point RPP, PLA…) are created in the active system. "Keep the position" recomputes the parameters when changing system.
- The .inp block is written in world coordinates: SPH/RCC/TRC/PLA/XYP… are transformed exactly; a rotated RPP is written as a bounding RPP + cutting PLA planes (no ARB, as recommended by CG) and regions are adapted; an oblique infinite cylinder becomes QUA (check in multi-line).
- Coordinate systems are not stored in the .inp: use *File ▸ Save project (.json)*, which also embeds the source meshes (STL / OBJ triangles, gzip + base64).

## INP output formats
Name-based geometry (`GEOBEGIN … COMBNAME`) is free format (blank / `,` `/` `;` `:` separators, names ≤ 8 characters, lines ≤ 132 columns). Three writing styles are offered: multi-line style, compact aligned, and fixed columns (GEOBEGIN as `(A8,2X,6E10.0,A8)`, title `(2I5,10X,A60)`, bodies A3 / A8 / 19-column numbers, regions A8 + I5). The legacy numeric COMBINAT fixed format is not generated.

## Section view, tools and projection

- **Info** and **Distance** (bottom-right icons) are off by default. Clicking the active one switches it off and closes its window; choosing a selection filter (point / edge / face / object) switches Info on.
- **Section view** (bottom-right icon, or right-click a plane / coordinate system in the tree): a floating window shows the intersection of the displayed meshes, bodies and regions with a plane. The plane is the XY / XZ / YZ plane of the global frame or of any coordinate system, or a PLA / XYP / XZP / YZP body, shifted by an offset (number or slider) along its normal; "other side" mirrors the view. The 2D view has its own pan (drag), zoom (wheel / pinch), double-click to fit, a scale bar and a cursor read-out in plane and world coordinates. The plane is also drawn in the 3D view (can be hidden).
- **Perspective / orthographic** switch: two icons above the view buttons.
- Dialog buttons no longer depend on `<form method="dialog">`, so they also work when the page runs inside a sandboxed frame.

## Groups (organisation only)

Each tree category (meshes, coordinate systems, planes, bodies, regions, measures) can hold groups: use the category "＋" menu → *New group*, or an item's ⋮ menu → *New group with this item…*. Drag an item onto a group row to move it; drop it on the category header to take it out. The eye of a group shows / hides all its members, the arrow folds it, right-click (or ⋮) renames or deletes it (members are kept). Groups are saved with the project but have no effect on the CG output.

Creating bodies or planes never creates a region or edits one: a new plane is only created, you add it to a region yourself.

## Cylinder pickers and region diagnostics

- Next to the ⌖ of the cylinder fields (RCC, TRC, XCC, YCC, ZCC): **◎** centre of a circular edge (click the rim: the sharp edges are followed around and a circle is fitted), **∴** centre of the circle through several picked points (3 or more, then *Done* / Enter), **↗** direction of a picked edge (normalized, the current length is kept, orientation follows the previous vector; **⇄** reverses it), **◠** radius from an arc edge (circle fit) or from a straight edge (its length). The tool-window option "Also set the axis and radius" fills the axis (circle normal) and radius from the same circle.
- A region that is empty inside the render zone now explains why, with values: gap between two bodies along an axis, shared contact plane (bodies end to end), bounding boxes, a `-body` that swallows everything, zero-volume bodies. Writing bodies one after another (`+a +b`) is the intersection; for bodies placed end to end use a union (`+a | +b`). A button applies the corrected expression.

## Region expression editor

The buttons under the expression insert **only at the caret** (or replace the selection): `+ add` / `− subtract` insert `+body` / `-body`, `| union` inserts the union symbol, `( )` inserts a pair of parentheses with the caret in the middle (a selection is wrapped instead). The buttons never take the focus from the text, and when you pick a body in the list a blinking caret stays drawn at the insertion point. The opacity / visibility / colour controls of the properties panel follow the tree in real time.

## Void region around a region (experimental)

Region ⋮ menu ▸ *Create void region around this one…*. The region is evaluated (even if hidden), its bounding box is enlarged by a margin (default 10 mm) and a hidden RPP `vb_<name>` is created in the global coordinate system. A new hidden region `v_<name>` (CG names are ≤ 8 characters) is defined as the exact negative of the original inside that box:

- *Compact*: `+vb_reg1 -( +rcc1 | +rcc2 | … )`
- *Expanded* (De Morgan, no leading `-( )`): `+vb_reg1 +(-rcc1) +(-rcc2) +(-a | -b) …`

The bounding box comes from the tessellated geometry (cylinders slightly under-estimated), the margin absorbs this. Empty regions give an explanatory error. The whole creation is one undo step.

## Export coordinate system

Objects can be defined in any coordinate system (*Defined in coordinate system*). The INP is written in **one** export system (csys ⋮ menu ▸ *Use as export coordinate system*, the csys properties button, or Settings ▸ INP block): every body parameter, plane normal/point and cylinder axis is converted from its defining system to the export system (global by default). The body properties show the exact INP line parameters. A rotated RPP that is not aligned with the export frame is still written as bounding RPP + PLA planes. Imported INP text is interpreted in the export system. The 3D view always shows world space.

Changing the *Defined in coordinate system* of an object now keeps its parameters and moves the object with the new frame (a translated frame translates the object). Tick *Keep the position when changing frame* to recompute the parameters instead.

Section view: contour points are welded geometrically, so meshes from boolean operations (regions, void regions) no longer leave open contours at some offsets.

## Render modes and cylinder top centre

Bottom-right toolbar: shaded (per-object opacity), wireframe, all opaque, all transparent, and an edges on/off toggle (picking keeps working in every mode). For RCC / TRC the *Axis vector* field has the same techniques as the base centre: pick the centre of a circular edge or of several points (axis = that centre − base centre; the radius can be set too), plus the edge-direction picker.

## Automatic feature detection (experimental)

Mesh ⋮ menu ▸ *Detect features…* opens a floating window (the 3D view stays usable) with the recognition parameters and a *Detect* button. Every proposal is listed; clicking a row shows it **temporarily** in 3D (orange = the mesh triangles it was recognised on, green = the proposed primitive) and nothing enters the model until you press *Add* (or *Add all remaining*).

| Feature | Method | Result |
|---|---|---|
| Plane | region growing over adjacent triangles (normal angle ≤ tolerance, vertex distance to the seed plane ≤ tolerance), total area ≥ threshold; patches in the same infinite plane are merged; facets of tessellated cylinders / spheres are not reported as planes | PLA (normal outward, point = centroid) |
| Cylinder | smooth clusters of the remaining triangles; axis = direction ⟂ to the normals (least-variance eigenvector), circle fit in the perpendicular plane, inlier triangles within the fit tolerance, angular coverage, radius and length limits; holes are labelled *(hole)* | RCC (axis snapped to the global axes within the snap angle) |
| Sphere | algebraic least squares + radial-normal check | SPH |
| Box | connected component aligned with 3 orthogonal directions that fills its oriented bounding box | RPP (a rotated box also creates its own coordinate system) |

Defaults are derived from the mesh size and can be reset. Adjacency is by shared vertices, so meshes with T-junctions or duplicated vertices are detected in several pieces (planes in the same plane are merged). Not yet detected: cones (TRC), fillets, partial arcs below the coverage limit.

### Guided fit (click triangles)

In the *Detect features* window, *Guided fit* lets you force the recognition on a surface: choose *Auto / Cylinder / Plane / Sphere*, press *Pick triangles*, then click one or several triangles of the mesh (click again to unselect). After every click the primitive is refitted and shown (blue = clicked triangles, orange = the patch it explains, green = the primitive) with a confidence percentage and a report (clicked triangles that fit, patch size, rms deviation, angular coverage). More triangles spread over the surface make the fit more reliable. The cylinder axis is free (any direction, snapped to a global axis only within the snap angle), so tilted cylinders work; one facet is enough because its neighbours are used to find the curvature. Flat selections are refused as cylinders with an explanation. *Add* puts the result in the tree.

## Properties panel (v1.3)
Four tabs: **General** (name, defined-in coordinate system, information), **View** (colour, opacity, graphic options), **Definition** (geometric definition of bodies / planes; expression editor of regions), **Operations** (duplicate, delete, void region, section of a csys, *Detect features* on a mesh, and the *Scale / margin about the centre* tool, collapsed until you tick its checkbox).

## Overlapping entities pop-up (v1.3)
When a click has several meshes / bodies / regions under the cursor, a small pop-up lists them nearest first. Hovering an entry highlights it in the 3D view; click an entry (or ↑ / ↓) to choose it, then **Select** (or Enter / double-click) to really pick it, **Cancel** (or Esc / click elsewhere) to abandon the pick. Can be disabled in Settings ▸ Display.

## Feature window, mouse rotation
The *Detect features* window is a floating window: drag it by its title, or press ⇥ to dock it to the right of the project panel (press again to float). Settings ▸ Display (and the band buttons) invert left/right and up/down mouse rotation.

## Version and updates
The version is `FK.VERSION` in `js/core.js` (shown next to the name; also in `version.json`, `service-worker.js` and the `?v=` of the script links — change them together). Convention: minor (1.x) for new features, major for deep changes; 1.2 was the baseline before this release.
The service worker is *network-first* (cache only as offline fallback, cache name carries the version), registered with `updateViaCache:'none'`, and the page reloads when a new worker takes control. `version.json` is fetched with `no-store` at load and on focus: a newer version shows a *Reload* bar. Settings ▸ About / updates has *Check for update* and *Force refresh* (unregisters the worker, empties the caches, reloads). The single-file standalone has no automatic update.

### Changelog
- **1.18.0** — components: the component toggle drives its regions (bodies stay hidden by default, regions visible on creation), parameters regenerate live while typing, deleting a component also deletes its placement coordinate system when nothing else uses it. Section view and dependency diagram: freely resizable and dockable as a side panel (⇥ button, resizable). Opacity sliders removed from the tree (still in Properties). Region edge lines no longer show the CSG triangulation fan on flat / curved faces. Point snapping: new *Corner points only* option (corners and ends of sharp edges, not every mesh vertex). Mouse wheel now zooms towards the point under the cursor, so a zoomed-in surface stays pickable.
- **1.17.0** — parametric *components* (new "Components" category in the tree): tube, closed vessel, hollow box, block with a cylindrical bore, conical collimator. A component generates ordinary bodies and regions (named prefix_role, placed through its own coordinate system) that are regenerated in place when a parameter changes, so every region stays usable in other regions' booleans, links and INP names. Generated geometry is read-only; *Detach* turns the objects into ordinary editable ones.
- **1.16.0** — experimental *dependency diagram* (toolbar button): bodies / planes → regions → linked regions (live links A / B with the operation, derived-once links, optional CAD meshes) drawn as a layered graph; edge colour = inside (+) / outside (−) / both; unused and not-exported objects are marked; click a node to select it in the project tree and the 3D view, hover to isolate its neighbours, wheel to zoom, drag to pan; scope "selection and what it uses / what uses it".
- **1.15.0** — toolbar toggle "only the objects written in the INP file"; both side panels are resizable by dragging their inner edge (the viewport follows; double-click on the left edge fits the longest name; widths are remembered); INP name: the "Auto" button is always there (own name if it fits, else its trailing number or first letters + 2 digits, kept unique) and the INP check offers "Auto-name the N long names"; project name field in the top bar (title line of the INP, base name of the saved .inp and project files); the CAD ↔ CG comparison pre-selects the regions that are written in the INP.
- **1.14.0** — INP names: every body, plane and region has an "INP name" (properties, General tab) used only in the INP file; left automatic it is the name itself, cut to 8 characters and made unique (a name that already fits keeps priority), and region expressions are rewritten accordingly. The warnings check invalid / too long / duplicated INP names and list the objects that no exported region uses, with a button to stop exporting them. Un-ticking "Export to the INP file" on a region no longer asks about regions linked to it (a link only exists in the tool; an expression is always written with bodies); only the regions that use a body are listed when a body is un-ticked.
- **1.13.0** — coordinate systems have a *Definition* (right panel): typed position + angles, origin + 2 axes (each axis X / Y / Z taken from a typed vector, two points, a face normal, an edge direction or the axis of a circular edge) or origin + point on X + point in XY; every point can be typed, picked, or taken at a circle centre, an edge midpoint or the intersection of 3 faces. A new coordinate system opens its Definition tab straight away. Editing the resulting values switches back to typed.
- **1.12.0** — edge angle (and face tolerance) editable in the pick windows of cylinder / circle / radius / direction picking and of the plane, cut and look-at-face tools; option to disable the "lower angle" retry that follows a rim through a fillet; position-picking tools (coordinate system from 3 points, csys position, distance, RPP) can take the point from a vertex, the centre of a circular edge, the midpoint of an edge or the intersection of 3 faces; coordinate-system 3×4 matrix: paste from the clipboard (3×4, 4×4 or 4 lines of 3) and invert (A→B ↔ B→A).
- **1.11.2** — "Pick in view" now only selects the clicked body / plane in the body list of the region definition (you then choose + / − / union); that list is grouped by type, each group sorted alphabetically (natural order).
- **1.11.1** — visual formula builder removed; object names also drawn on planes; new "🖱 Pick in view…" in the region definition: click bodies / planes in the 3D view to add them (inside or outside, in every zone or one), with the list of overlapping objects when several are under the cursor.
- **1.11.0** — new defaults (opaque, edges shown, mouse rotation not inverted); per-item opaque / transparent override and two presets (CAD opaque + CG ghosted, and the reverse); object names drawn in the 3D view in the object colour; ⚠ warnings shown on the tree row of the region / component concerned; items not exported are greyed, and un-ticking "Export to the INP file" opens a window listing every impacted component (full chain); "not used" warning for any element no exported region uses; separated pieces of a region highlighted in distinct colours with a red spot where they are closest; **visual formula builder** (zones as cards, +/− chips, live volume and preview) and **interactive cut**: pick a face of the mesh to create (or reuse) the plane and add it to the region.
- **1.10.1** — number fields of positions, radii, coordinate-system positions and mesh offsets step by 1 mm (0.1 cm) instead of 1 cm; Euler angles by 1°.
- **1.10** — **alignment check on creation** (`js/snap.js`): after a detected / guided feature, a plane from a face, a bounding RPP or a picker-filled body, a card proposes exact values (axis on X / Y / Z, parallel or coaxial with other cylinders, radii equal to other radii, start / end and faces coincident with other faces or cylinder ends, plane → XYP/XZP/YZP, parallel / coincident planes, sphere / cylinder centres aligned). Each correction can be ticked off; *Use corrected values* / *Keep as is*; tolerances in the card and in Settings; *Operations ▸ Check alignment with other objects…* runs it on any body.
- **1.9.1** — CAD-style trackball (horizontal drag turns about the screen's vertical axis, vertical drag about its horizontal axis); every "Creo" / "FLUKA" mention in the interface replaced by "CAD" / "CG"; rim picking: the circular-rim loop now crosses the branch points of coarse tessellations (it keeps the neighbour edge that continues the path best), retries with a softer sharpness threshold and with the other sharp edges of the clicked facet, so centre / radius are fitted on the whole rim instead of one facet edge.
- **1.9** — Geometry check: a **Solve** button on each automatic-fixable warning (axis a fraction of a degree off X/Y/Z → snapped exactly, oblique plane → XYP/XZP/YZP, nearly parallel cylinders → aligned, nearly coaxial → concentric, radii differing by µm → equal, end gaps / almost coincident ends → touching, almost coincident faces / planes → merged) and **Solve all**; the checks only look at regions exported to the INP and at the bodies they use (non-exported regions no longer produce warnings); **strong links** for *Combine with another region…*: the region keeps pointing at its parents A and B and its formula follows them live (A, B, operation and form editable in its Definition tab; *Unlink* keeps the formula), *soft* keeps the old one-shot behaviour.
- **1.8** — CAD links: bodies / planes made from a mesh (detected features, plane from a face, bounding RPP) carry a *CAD source* (editable in General; automatic by default; a region inherits the CAD of its bodies); a mesh lists its linked objects with *Show / Hide / Isolate*; **CAD ↔ CG comparison** window (3D signed deviation map, mean / rms / p95 / max / bias in both directions, Hausdorff, CAD vs region volumes); one OBJ / multi-solid ASCII STL with several objects now creates several independent meshes, *Operations ▸ Split into solids* splits any mesh; **Geometry check** (`.inp` panel ▸ *Check…*): INP ↔ model equivalence, region overlaps and enclosed holes (3D markers), analytic "alignment accident" checks.
- **1.7** — INP header audited against the CG fixed-card rules: the GEOBEGIN card is now a true `(A8,2X,6E10.0,A8)` card in all three output styles (the multi-line style used to write a free-format `GEOBEGIN COMBNAME` and a tab-separated title), the title line is `(2I5,10X,A60)` (cut to 60 characters, with a warning), `FK.fixedCard` / `FK.fmtWhat` implement the card rules (decimal point, right-aligned `E10.0`, ≤ 80 columns), optional `*` comment header.
- **1.6** — *Export to the INP file* checkbox on bodies / planes / regions (⊘ in the tree when excluded) and a "not used" info sign for bodies no region uses; warnings shortened to ⚠ / ⓘ icons with factual tooltips; Operations buttons stacked, Delete at the bottom; "CAD → CG" label removed.
- **1.5** — region quality check (separate / nearly touching pieces, thin regions, degenerate polygons, nearly coincident faces); resizable `.inp` panel; *Import STL / INP* and *New project* buttons removed from the tree (STL import: Meshes ＋ menu; INP import and New project: File menu).
- **1.4** — resolution slider (top band): global facet count of cylinders / cones / spheres; *Combine with another region…* (A − B, A ∩ B, A ∪ B written with the bodies of both regions only).
- **1.3** — renamed *Combinatorial Geometry Tool*; version display; toolbar moved to a top band; floating / dockable feature window; mouse-rotation inversion; update mechanism; overlapping-entities pop-up; properties tabs and collapsible scale tool.
- **1.2** — automatic and guided feature detection (baseline).

## Resolution of curved surfaces (v1.4)
The ◍ button of the top band opens a slider (×0.25 … ×3) that multiplies the number of facets used to draw (and to evaluate sections / region booleans for) cylinders, cones and spheres: ×1 = 48 facets per cylinder / cone, 64 per infinite cylinder, 32 × 20 per sphere. It is a display setting only: the INP is unchanged. Stored in the project.

## Combine two regions (experimental, v1.4)
CG cannot subtract a region from another one, but the *formulas* can be combined. On region **reg1**, *Operations ▸ Combine with another region…* (or its ⋮ menu) opens a dialog: choose reg2 and **A − B**, **A ∩ B** or **A ∪ B**. A new region is created whose expression uses only the bodies of reg1 and reg2 (which stay untouched), e.g. `+rpp1 -xzp1 -( +rcc1 -xzp1 )` for reg1 − reg2. *Compact* keeps parentheses; *Expanded* applies De Morgan (`-( +a -b )` → `+( -a | +b )`), with no negated parenthesis. The dialog previews the expression and the volumes of A, B and the result (inside the render zone).

## Region quality check (v1.5)
Every non-empty region is checked after evaluation; warnings appear under *Valid expression* in the region's Definition tab, in the INP warnings list (badge on `.inp`), and as a toast when a region is created by *Combine with another region*. Checks: **separate pieces** (info) and pieces whose bounding boxes are almost touching (e.g. two bodies of a union 0.01 mm apart); **tiny fragments** (slivers); **extremely thin** regions (tiny overlap of two bodies); **degenerate polygons**; **nearly coincident faces** between RPP / coordinate-plane bodies of the expression (a few 1e-4 of the model size apart but not equal). The near-tolerance is 1e-4 × the render-zone diagonal (≥ 1e-5 cm).

## `.inp` panel
Drag the grip on the top edge of the panel to resize it (double-click the grip to reset); the height is remembered.

## CG fixed-format cards (v1.7)
A CG card is `(A8, 2X, 6E10.0, A8)`: keyword in columns 1–8 (upper case), two blanks, up to six WHATs of 10 columns each (always written with a decimal point, e.g. `10.0`, exponents as `1.234E+05`, right-aligned), SDUM in columns 71–78; a line with `*` in column 1 is a comment. `FK.fixedCard(keyword, whats, sdum)` writes such a card (throws on a keyword / SDUM longer than 8 characters or more than 6 WHATs); `FK.fmtWhat(v)` formats one WHAT. The geometry block uses it for `GEOBEGIN … COMBNAME` (SDUM in columns 71–78) and `GEOEND`; the line after GEOBEGIN is the title `(2I5,10X,A60)`. Bodies and regions inside a `COMBNAME` (name-based) geometry are free format by CG's design, so the E10.0 rule does not apply to them; the legacy numbered fixed geometry format is not produced. *Settings ▸ INP block ▸ Comment header* adds `* Combinatorial Geometry Tool vX.Y` before GEOBEGIN.

## CAD links and comparison (v1.8)
- *CAD source* (General tab of bodies, planes, regions): *Automatic* (made from a mesh → that mesh; a region → the mesh shared by all its bodies), *None*, or a chosen mesh.
- Mesh ▸ *Linked CG objects*: counts, *Show / Hide / Isolate*. Mesh ▸ Operations ▸ *Compare with CG regions…*, region ▸ Operations ▸ *Compare with CAD…*.
- Comparison window: tick the regions (their union is compared). Deviations are sampled on both surfaces (≈ 60 000 points each): CG → CAD and CAD → CG, colour on either surface. Sign "CG − CAD": red = CG has material where the CAD has none, blue = it lacks some. Scale = p95 unless a maximum (mm) is typed. Planes that cut the CAD (booleans not in the mesh) show up as deviations, and the sign is approximate within a few mm of sharp edges.
- Volumes: CAD |V| (signed mesh volume) versus the region volume (polygon model, itself limited by the facet resolution).

## Geometry check (v1.8)
`.inp` panel ▸ *Check…* runs three independent checks:
1. **INP ↔ model**: the generated INP is parsed back and each region is tested at random points with the model's bodies and with the INP's bodies (rotated boxes are split into RPP + planes, oblique cylinders become QUA…). Any disagreement is a bug of the export (or a number-formatting loss). ARB / unknown bodies are not checked.
2. **Overlaps and holes** on a voxel grid: regions that share volume, and undefined space completely enclosed by regions. Red / orange cubes mark them in 3D. Thin features (< one cell) can be missed.
3. **Alignment accidents** (analytic): cylinders whose axes are a fraction of a degree from parallel (the wedge gap of two end-to-end cylinders, one tilted 1°), axes / planes almost on a global axis, coaxial cylinders offset or with radii differing by a few µm, end-to-end gaps, almost coincident or almost parallel planes and faces. The "almost" tolerance is editable (mm).

CG itself does not validate the design: it reports undefined / multiply-defined points only when particles cross them (or with the geometry debugger, `GEOEND … DEBUG`, not generated by this tool). This check is meant to catch problems before that run.

## Solve buttons and strong region links (v1.9)
- Fixes are applied on the body parameters (undoable with Ctrl+Z); they work through coordinate systems and the export frame. They never touch RAW bodies. Typical tolerance for "almost" is the value in the check window (default 0.1 mm); an axis is snapped when it is within 0.5° of a global axis.
- *Combine with another region…* now asks for **Soft** (formula computed once) or **Strong** (⛓: region.meta.link = A, B, operation, form). A strong region has a read-only expression; changing A or B (or deleting one, which drops the link and keeps the formula) updates it immediately. Chains of strong links are supported; cycles are ignored.

## Alignment check on creation (v1.10)
Only bodies in the global frame are checked (no coordinate system). Corrections are computed in order (axis → parallel → coaxial → radii → start → end for cylinders; each later step starts from the previous result, and unticking a step recomputes the following ones). Defaults: 0.2 mm and 0.5°, editable. *Keep as is* leaves the body exactly as created; applying is undoable (Ctrl+Z).
