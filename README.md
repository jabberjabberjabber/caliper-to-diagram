# caliper-to-diagram

Turn digital caliper measurements of a real object into a clean, dimensioned 2D technical drawing,
the kind you'd sketch on graph paper or find in a datasheet. Use it when modifying, recreating or
mounting something.

You never place anything freely. Every feature is positioned by a measured distance from an edge of
the face that contains it, which is how calipers measure and how professional drawings are dimensioned.

![The app with a NIC end bracket: measurements on the left, the dimensioned drawing and 3D preview on the right](docs/app-nic-bracket.png)

*Measuring a NIC end bracket. The cutout being edited (row 5) and its dimensions on the drawing are
highlighted in orange; the 3D preview shows how the mounting tab folds.*

## Running

```
uv run main.py            # serves the app on http://127.0.0.1:8765 and opens a browser
uv run main.py --port 0   # pick any free port
```

The app is plain HTML/JavaScript in `web/` with no dependencies. You can also open `web/index.html`
directly from disk. Your work autosaves in the browser; use **Save** to keep a `.json` file.

While you edit a section of the form (a hole, a panel width, a joint), its dimensions and outline
are drawn in orange in the preview, and the form row is marked in the same color. That makes it
easy to see which numbers on the drawing came from which measurement. Exports and prints stay black.

Two worked examples are in `examples/` (open them with **Open…**). Their numbers are illustrative,
not measured from real parts.

## How a part is described

- **Panels.** Each flat face is a panel with a width (left↔right), height (bottom↕top) and thickness.
- **Holes.** A diameter, plus a position measured from the left or right edge and from the bottom or
  top edge. Calipers can't touch a hole's center, so you can enter the distance to the **near side** of
  the hole and the app adds half the diameter. The drawing always shows center positions.
- **Rectangular cutouts.** A size, plus the distance from the panel edges to the cutout's near edges.
  A cutout that touches or overruns an edge becomes a **notch**, which is how you make L-shapes,
  tabs and tongues.
- **Slots.** Width and overall length, horizontal or vertical, located like holes. An **open** slot
  (U-slot, like the screw slot on a PCIe bracket tab) runs out through an edge; you give its depth
  from that edge.
- **Angled edges.** A straight cut between two points, each located from the panel edges, plus which
  side is cut off. A corner chamfer has one end on each of the two edges. Because the ends are
  positioned independently, an angled edge can also sit on a notch, such as the tapered sides of a
  bracket tongue. The drawing shows the resulting angle as a reference dimension, e.g. `(45.0°)`.

Features can overlap and combine: the outline is computed exactly, with real arcs, so a hole that
runs off an edge becomes a half-round notch and an angled edge can trim a notch.
- **Joined faces (3D).** Any panel except A is joined to an edge of another panel: which edge, how far
  along it, the bend angle (90 = right angle, 0 = flat) and whether it bends toward the front or back.
  This places every face in 3D. The drawing notes each joint, marks it on the parent view, and shows a
  3D preview so you can check that the bends go the right way.

## Drawing conventions used

- **Datums and baseline dimensioning.** Left and bottom edges are the default datums. Every position is
  dimensioned from a panel edge, never chained hole-to-hole, so measurement errors don't add up. A
  feature can be measured from the opposite edge instead; the drawing then shows that edge.
- Hole callouts like `4X Ø4.30 THRU` group holes that share a diameter, with center marks on each hole.
- Inch values drop the leading zero (`.250`, ASME Y14.5). Millimeter values keep it (`0.50`, ISO).
  Decimal places reflect the claimed precision (default 2 for mm, 3 for inches).
- Every drawing has a title block with the units, a 1:1 scale note and a scale-check bar. Measure the
  bar on a printout to confirm it printed at actual size.
- You can type values in any unit in any field: `12.7mm`, `1/2in`, `1 1/4"`, `3/8`.

## Output formats

| Format | Use it for |
|---|---|
| **.json** (Save) | The editable source. Reopen it to change measurements; everything re-derives. |
| **SVG** / **Print 1:1** | The drawing at actual size. Print at 100% / "actual size", or "Save as PDF" from the print dialog. |
| **DXF** (R12) | 2D CAD exchange: FreeCAD, Fusion 360, LibreCAD, Inkscape, laser cutters and CNC. Geometry is on the `OUTLINE` layer; dimensions, center lines and text are on their own layers so you can hide them. |
| **OpenSCAD** (.scad) | A parametric 3D model. Each measurement is a named variable and positions are expressions of them, so editing one value moves everything that depends on it. OpenSCAD can export STL for 3D printing, and FreeCAD can import .scad files. |

![A NIC end bracket exported to OpenSCAD, with its measurements listed in the Customizer](docs/openscad-nic-bracket.png)

*A NIC end bracket measured with this tool and opened in OpenSCAD. Each measurement shows up as a
named, editable parameter in the Customizer on the right.*

Professional parametric work happens in CAD (FreeCAD, Fusion 360, Onshape, SolidWorks). The usual
interchange formats are DXF for 2D, STEP for 3D, and PDF for drawings. This tool covers DXF and PDF
(through print); STEP is on the TODO list.

## Tests

```
node --test tests/core.test.js
```

## Done since the first version

- Slots, closed and open (U-slots)
- Angled edges
- OpenSCAD export lists every measurement in the Customizer, grouped by panel

## TODO

Not built yet, roughly in order of usefulness:

- [ ] Threaded hole callouts (M3, #6-32) and countersink / counterbore holes
- [ ] Hole patterns: linear arrays and bolt circles, with center-to-center spacing input
- [ ] Rounded corners (fillets) and chamfers on the outline
- [ ] Angled (diagonal) slots
- [ ] Dimensions placed on the nearest side (right/top) instead of always below/left
- [ ] Parts attached to a face instead of an edge (standoffs, legs, PEM nuts)
- [ ] Sheet-metal bends: bend radius, thickness compensation and a true flat pattern
- [ ] Tolerances on individual dimensions
- [ ] Standard 3-view orthographic drawing (front/top/side) of the assembled part
- [ ] STEP export; direct PDF export with standard paper sizes and multiple sheets
- [ ] Undo / redo
