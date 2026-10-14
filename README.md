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

Creating bodies or planes never creates a region any more, and applying a PLA cut to a hidden region leaves it hidden.
