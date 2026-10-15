# Creo → FLUKA Geometry

Pure web tool (HTML/CSS/JS, installable as a PWA): loads an STL or OBJ mesh exported from Creo Parametric, lets you measure, create RPP (2 points) and PLA (from a mesh triangle), cut regions, and writes the FLUKA / Flair `GEOBEGIN … GEOEND` block live (everything in cm).

**GitHub Pages deployment**: push this folder to the root of a repository, then *Settings → Pages* → branch `main`, folder `/ (root)`. PWA install needs HTTPS (provided by GitHub Pages); locally, just open `index.html`.

## Interface
- **Top bar**: *File* menu (new / open / save project, import STL / OBJ / INP, export .inp), undo / redo, `.inp` sheet, ⚙ settings (display, title, output format), ▤ properties of the selected item.
- **Bottom-right of the view**: selection filters (point / edge / face / object), Info and Distance tools, view buttons (fit to what is displayed, Iso, Z, Y, X, ⟂ look normal to a face, ⇄ opposite side). **Top-right**: axis triad — click an axis to look along it (click again for the opposite side).
- **Tool window** (top-left of the view): options and results of the current tool (snap, whole face, pick card, last distance…).
- **Tree view** (left): Meshes, Coordinate systems, Planes, Bodies, Regions, Measures. Fold/unfold groups; right-click a group header (or use ＋) to create items; right-click an item (or ⋮) to rename, duplicate, delete, show/hide, etc.
- **Pickers**: next to every coordinate group of a body (RPP min/max corner, sphere centre/radius, cylinder base/axis/radius, PLA normal/point, plane position…) the ⌖ button lets you click a point (or a face, for a PLA normal) in the 3D view; the value is written in the body's own coordinate system. Each coordinate field also has its own small ⌖ to fill a single value (e.g. only ymax). Same for a coordinate system origin.
- **View**: drag = rotate (unlimited), double-click = set the rotation centre, right-drag / Shift+drag = pan, wheel = zoom.

## Coordinate systems (csys)
- **Global (0,0,0)** is active by default. Create, activate (●), hide, duplicate, delete coordinate systems; the **Csys** tool builds one from 3 points (origin, X axis, XY plane); "Csys here" / "Csys on face" in the pick card.
- Each system is defined relative to a parent (position + angles, X/Y vectors, or 3×4 matrix). When a parent moves, its children follow, unless **Freeze** is checked (the child keeps its world pose).
- Each body chooses its system ("Defined in coordinate system"); new bodies (2-point RPP, PLA…) are created in the active system. "Keep the position" recomputes the parameters when changing system.
- The .inp block is written in world coordinates: SPH/RCC/TRC/PLA/XYP… are transformed exactly; a rotated RPP is written as a bounding RPP + cutting PLA planes (no ARB, as recommended by FLUKA) and regions are adapted; an oblique infinite cylinder becomes QUA (check in Flair).
- Coordinate systems are not stored in the .inp: use *File ▸ Save project (.json)*, which also embeds the source meshes (STL / OBJ triangles, gzip + base64).

## INP output formats
Name-based geometry (`GEOBEGIN … COMBNAME`) is free format (blank / `,` `/` `;` `:` separators, names ≤ 8 characters, lines ≤ 132 columns). Three writing styles are offered: Flair style, compact aligned, and fixed columns (GEOBEGIN as `(A8,2X,6E10.0,A8)`, title `(2I5,10X,A60)`, bodies A3 / A8 / 19-column numbers, regions A8 + I5). The legacy numeric COMBINAT fixed format is not generated.

## Section view, tools and projection

- **Info** and **Distance** (bottom-right icons) are off by default. Clicking the active one switches it off and closes its window; choosing a selection filter (point / edge / face / object) switches Info on.
- **Section view** (bottom-right icon, or right-click a plane / coordinate system in the tree): a floating window shows the intersection of the displayed meshes, bodies and regions with a plane. The plane is the XY / XZ / YZ plane of the global frame or of any coordinate system, or a PLA / XYP / XZP / YZP body, shifted by an offset (number or slider) along its normal; "other side" mirrors the view. The 2D view has its own pan (drag), zoom (wheel / pinch), double-click to fit, a scale bar and a cursor read-out in plane and world coordinates. The plane is also drawn in the 3D view (can be hidden).
- **Perspective / orthographic** switch: two icons above the view buttons.
- Dialog buttons no longer depend on `<form method="dialog">`, so they also work when the page runs inside a sandboxed frame.

## Groups (organisation only)

Each tree category (meshes, coordinate systems, planes, bodies, regions, measures) can hold groups: use the category "＋" menu → *New group*, or an item's ⋮ menu → *New group with this item…*. Drag an item onto a group row to move it; drop it on the category header to take it out. The eye of a group shows / hides all its members, the arrow folds it, right-click (or ⋮) renames or deletes it (members are kept). Groups are saved with the project but have no effect on the FLUKA output.

Creating bodies or planes never creates a region or edits one: a new plane is only created, you add it to a region yourself.

## Cylinder pickers and region diagnostics

- Next to the ⌖ of the cylinder fields (RCC, TRC, XCC, YCC, ZCC): **◎** centre of a circular edge (click the rim: the sharp edges are followed around and a circle is fitted), **∴** centre of the circle through several picked points (3 or more, then *Done* / Enter), **↗** direction of a picked edge (normalized, the current length is kept, orientation follows the previous vector; **⇄** reverses it), **◠** radius from an arc edge (circle fit) or from a straight edge (its length). The tool-window option "Also set the axis and radius" fills the axis (circle normal) and radius from the same circle.
- A region that is empty inside the render zone now explains why, with values: gap between two bodies along an axis, shared contact plane (bodies end to end), bounding boxes, a `-body` that swallows everything, zero-volume bodies. Writing bodies one after another (`+a +b`) is the intersection; for bodies placed end to end use a union (`+a | +b`). A button applies the corrected expression.

## Region expression editor

The buttons under the expression insert **only at the caret** (or replace the selection): `+ add` / `− subtract` insert `+body` / `-body`, `| union` inserts the union symbol, `( )` inserts a pair of parentheses with the caret in the middle (a selection is wrapped instead). The buttons never take the focus from the text, and when you pick a body in the list a blinking caret stays drawn at the insertion point. The opacity / visibility / colour controls of the properties panel follow the tree in real time.

## Void region around a region (experimental)

Region ⋮ menu ▸ *Create void region around this one…*. The region is evaluated (even if hidden), its bounding box is enlarged by a margin (default 10 mm) and a hidden RPP `vb_<name>` is created in the global coordinate system. A new hidden region `v_<name>` (FLUKA names are ≤ 8 characters) is defined as the exact negative of the original inside that box:

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
