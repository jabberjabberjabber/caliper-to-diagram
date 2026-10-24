// Contextual help shown when a field gets focus.
(function (C) {
  "use strict";

  C.HELP = {
    default: `
      <h3>How a part gets measured</h3>
      <p>Each flat face of the part is a <b>panel</b>. Lay the face in front of you the way you want it
      drawn: <b>width</b> runs left↔right, <b>height</b> runs bottom↕top.</p>
      <p><b>Datum edges.</b> On a professional drawing, two straight, square edges of each face are chosen as
      references (datums), and every position is measured from those same two edges. Here they are the
      <b>left</b> and <b>bottom</b> edges. This is called <i>baseline dimensioning</i>. Chaining hole→hole→hole
      adds up each measurement's small error; measuring everything from the same edge doesn't.</p>
      <p><b>Choose good datums.</b> Rotate the part so the left and bottom edges are the straightest and cleanest
      ones, and are the edges that matter for fit (the edge that sits against a case wall, for example).</p>
      <p><b>Holes are located by their centers</b> on the drawing. Calipers can't touch a center, so by default you
      measure to the near side of the hole and the app adds half the diameter.</p>
      <p><b>Measure everything twice.</b> If two readings differ by more than the last digit, measure a third time
      and use the reading that repeats.</p>
      <p>Click any field to see how to measure it.</p>`,

    name: `<h3>Part name</h3><p>Shown in the title block and used for file names.</p>`,

    units: `<h3>Units</h3>
      <p>Pick what your calipers display. Values are stored in millimeters, so switching back and forth loses nothing.</p>
      <p>You can type another unit in any field: <code>12.7mm</code>, <code>1/2in</code>, <code>1 1/4"</code>, <code>3/8</code>.</p>
      <p>Inch drawings omit the leading zero (<code>.250</code>, per ASME Y14.5); millimeter drawings keep it
      (<code>0.50</code>, per ISO).</p>`,

    decimals: `<h3>Decimal places</h3>
      <p>On a drawing, the number of decimals says how precise a value is. Hobby calipers read 0.01 mm / 0.0005 in
      but realistically repeat to about ±0.02–0.05 mm. Use <b>2 decimals for mm</b> or <b>3 for inches</b> unless you
      have a reason to claim more.</p>`,

    width: `<h3>Width (left ↔ right)</h3>
      <p>Use the <b>outside jaws</b> (the large lower ones). Close them squarely on the left and right edges and
      read when both jaws sit flat against the part, not rocking on a corner.</p>
      <p>Measure near both ends. If the readings differ, the part is tapered or out of square: use the larger
      value and mention it in Notes.</p>`,

    height: `<h3>Height (bottom ↕ top)</h3>
      <p>Same method as width, across the bottom and top edges, using the <b>outside jaws</b>.</p>`,

    thickness: `<h3>Thickness</h3>
      <p>Clamp the material between the <b>outside jaws</b> away from bends, burrs and holes.
      It's printed as a note on the view and used for the 3D OpenSCAD export.</p>`,

    holeDia: `<h3>Hole diameter</h3>
      <p>Use the <b>inside jaws</b> (the small upper ones). Put them in the hole and open them until they touch the
      walls, then rock them gently. The <b>largest</b> reading is the diameter.</p>
      <p>For a threaded hole, measure it anyway and write the thread in Notes (e.g. <i>M3</i>, <i>#6-32</i>).
      Typical clearance holes: M3 screw → 3.2–3.4 mm, M4 → 4.3–4.5 mm.</p>
      <p>Holes with the same diameter are labeled together on the drawing, e.g. <code>4X Ø3.20 THRU</code>.</p>`,

    holeRef: `<h3>Measured from which edge?</h3>
      <p>Keep the datum edges (<b>left</b> and <b>bottom</b>) unless the hole is much closer to the opposite edge,
      or the datum edge is damaged. The drawing dimensions the hole from the edge you pick, so it always matches
      what you actually measured.</p>`,

    holePos: `<h3>Distance to the hole</h3>
      <p><b>Near side (recommended):</b> use the tips of the <b>outside jaws</b>. One tip goes against the panel edge,
      the other into the hole against the wall closest to that edge. You are measuring the strip of material
      between them. The app adds half the diameter to find the center.</p>
      <p><b>Center:</b> pick this only if you already know the center position, e.g. from a datasheet or because
      the hole is centered on the part.</p>`,

    holeTo: `<h3>Near side or center</h3>
      <p><b>Near side</b>: what calipers can physically touch, the closest point of the hole wall.
      <b>Center</b>: the hole's center point, if you know it from somewhere else.</p>
      <p>The drawing always shows center positions, which is the standard way to dimension holes.</p>`,

    cutSize: `<h3>Cutout / notch size</h3>
      <p>Width (left↔right) and height (bottom↕top) of a rectangular opening, measured with the <b>inside jaws</b>.</p>
      <p>Need a rounded end? Use a slot. Need a sloped side? Add an angled edge.</p>
      <p><b>Notches and steps:</b> let the cutout touch or run past a panel edge. For example, 0 from the right edge
      and 0 from the top edge cuts a corner notch. That is how to make L-shapes, tabs and tongues
      (like the bottom tongue of a PCIe bracket).</p>`,

    cutPos: `<h3>Distance to the cutout</h3>
      <p>From the chosen panel edge to the <b>nearest edge of the opening</b>. Use the outside jaw tips across the
      strip of material between them, or the depth rod for a notch. Enter 0 if the cutout opens onto that edge.</p>`,

    slotSize: `<h3>Slot width and length</h3>
      <p><b>Width</b>: across the slot, with the <b>inside jaws</b>, the same way as a hole diameter.</p>
      <p><b>Length</b> (closed slot): the overall length, end to end including both rounded ends, with the inside
      jaws along the slot.</p>
      <p><b>Depth</b> (open slot): from the edge the slot opens onto to the far, rounded end. Use the depth rod,
      or the outside jaw tips against the edge and the end of the slot.</p>
      <p>Slots of the same size are labeled together, e.g. <code>2X SLOT 4.20 × 10.00</code>.</p>`,

    slotShape: `<h3>Slot direction and type</h3>
      <p><b>Horizontal</b> slots run left↔right, <b>vertical</b> ones bottom↕top. (Angled slots aren't supported yet.)</p>
      <p><b>Closed</b>: a slot entirely inside the panel. <b>Open to edge</b>: a U-shaped slot that runs out
      through an edge, like the screw slot in a PCIe bracket tab.</p>`,

    slotOpen: `<h3>Which edge the slot opens to</h3>
      <p>The edge the U-slot runs out through. Its depth is measured from that edge.</p>`,

    slotPos: `<h3>Slot position</h3>
      <p><b>Across the slot</b>: from the panel edge to the near side of the slot (outside jaw tips across the strip
      of material, as for holes), or to its centerline if you know it.</p>
      <p><b>Along a closed slot</b>: from the panel edge to the near rounded end of the slot, or to the slot's center.</p>
      <p>The drawing dimensions the slot's centerline and center, the standard way to locate a slot.</p>`,

    angleToward: `<h3>Which side is cut off</h3>
      <p>The direction of the material that is removed, beyond the angled line. For a chamfered bottom-left corner,
      choose <b>bottom left</b>. Check the drawing preview: the removed side disappears.</p>`,

    anglePoint: `<h3>Ends of an angled edge</h3>
      <p>An angled edge is a straight line between two points. Each end is where the angled edge meets a straight
      edge. Locate each end from the panel edges like any other feature.</p>
      <p><b>Corner chamfer</b>: end 1 is on the bottom edge (vertical position <b>0</b> from bottom), so measure only how far
      along it the angle starts. End 2 is on the left edge (horizontal position <b>0</b> from left), so measure how far up it
      ends.</p>
      <p><b>The corner is gone, so how do I measure from it?</b> Measure the straight part that is left and subtract it
      from the overall size. For example, width 21.50 with 18.00 of straight bottom edge remaining means the angle
      starts 3.50 from the left edge.</p>
      <p>The drawing shows the resulting angle in parentheses, e.g. <code>(45.0°)</code>. That is a <i>reference</i>
      dimension: it follows from the two measured ends.</p>`,

    attachParent: `<h3>Joined faces</h3>
      <p>A 3D part is drawn as its flat faces, each joined to another at an edge, like a bent bracket, a box side
      or a table leg. Pick the face this one is joined to. Panel A is the reference that all others hang off.</p>`,

    attachEdge: `<h3>Which edge</h3>
      <p>The edge of the other face (as it is drawn) where this face is joined.
      This face is always drawn with its joined edge at the <b>bottom</b> of its own view.</p>`,

    attachOffset: `<h3>Position along the edge</h3>
      <p>Distance from the <b>left end</b> of the other face's top/bottom edge, or the <b>bottom end</b> of its
      left/right edge, to where this face starts. Enter 0 if it starts at the corner.</p>
      <p>When measuring this face, hold it so its <b>left end</b> is the end nearest that starting point, so the
      left/right directions stay consistent between the views.</p>`,

    attachAngle: `<h3>Bend angle</h3>
      <p>Measured from flat: <b>90</b> for a right-angle bend (bracket tab, box side), <b>0</b> if the face continues flat in
      the same plane, <b>180</b> for a fold flat back onto itself (a hem). Check with a square or protractor.</p>`,

    attachToward: `<h3>Bend direction</h3>
      <p><b>Front</b> is the side of the other face you see in its drawing; <b>back</b> is the hidden side.
      Check the 3D preview to confirm it matches the real part.</p>`,

    notes: `<h3>Notes</h3>
      <p>Printed in the title block. Typical entries: material and thickness (<i>1.0 mm steel</i>), finish, thread
      sizes (<i>2X M3 THREADED</i>) and a general tolerance (<i>UNLESS NOTED ±0.1</i>).</p>`,

    view: `<h3>3D preview direction</h3><p>Only changes the preview. Dimensions are unaffected.</p>`,
  };
})((globalThis.C2D = globalThis.C2D || {}));
