// Part model: panels (flat faces) with holes, slots, cutouts and angled edges, joined at edges.
// All lengths in mm. Panel coordinates: x = left→right, y = bottom→top, z = toward the viewer (front).
//
// Rule: every value comes from the user. Nothing is guessed or pre-filled; an unmeasured value is
// null and the walkthrough asks for it. Values are only ever derived (hole center = near side +
// radius), and inconsistent input produces a warning rather than a silent correction.
(function (C) {
  "use strict";

  const EPS = 1e-6;

  C.newDoc = function () {
    return {
      version: 1,
      name: "",
      units: "mm",
      decimals: 2,
      notes: "",
      view: "front-right-top",
      panels: [C.newPanel("A", null)],
    };
  };

  C.newPanel = function (id, attach) {
    return { id, name: id === "A" ? "Main face" : "", width: null, height: null, thickness: null, attach, features: [] };
  };

  // How a panel joins another: which panel and side, where the bend line is (measured from an
  // edge of the other panel, because cutouts can move the material edge in from the outline),
  // where along that side this panel starts, and the bend.
  C.newAttach = () => ({ parent: null, edge: null, line: { ref: null, value: null }, offset: null, angle: null, toward: null });

  // Positions are measured from a panel edge. Holes can be measured to their center or to the
  // near side of the hole (what calipers can actually touch); cutouts are measured to their near edge.
  // The ref/to selectors start on the recommended way of measuring; they are shown next to the value.
  C.newHole = () => ({
    type: "hole",
    diameter: null,
    x: { ref: "left", value: null, to: "near" },
    y: { ref: "bottom", value: null, to: "near" },
  });

  C.newCutout = () => ({
    type: "cutout",
    width: null,
    height: null,
    x: { ref: "left", value: null },
    y: { ref: "bottom", value: null },
  });

  // Slots: width and overall length (rounded ends included), horizontal or vertical. An open slot
  // (U-slot) runs out through the edge it is measured from; its length is the depth from that edge.
  C.newSlot = () => ({
    type: "slot",
    width: null,
    length: null,
    orient: null,
    open: null,
    x: { ref: "left", value: null, to: "near" },
    y: { ref: "bottom", value: null, to: "near" },
  });

  // Angled edge: a straight cut between two points, each located from the panel edges. Material
  // beyond the line on the chosen side is removed.
  C.newAngle = () => ({
    type: "angle",
    toward: null,
    p1: { x: { ref: "left", value: null }, y: { ref: "bottom", value: null } },
    p2: { x: { ref: "left", value: null }, y: { ref: "bottom", value: null } },
  });

  // Brings documents saved by older versions up to date. Values that didn't exist then are left
  // unmeasured (the walkthrough asks for them), never filled in with a guess.
  C.upgradeDoc = function (doc) {
    for (const p of doc.panels) if (p.attach && !p.attach.line) p.attach.line = { ref: null, value: null };
    return doc;
  };

  C.TOWARD = { "bottom-left": [-1, -1], "bottom-right": [1, -1], "top-left": [-1, 1], "top-right": [1, 1] };

  C.nextPanelId = function (doc) {
    const used = new Set(doc.panels.map((p) => p.id));
    for (let i = 0; ; i++) {
      const id = i < 26 ? String.fromCharCode(65 + i) : "P" + (i + 1);
      if (!used.has(id)) return id;
    }
  };

  C.findPanel = (doc, id) => doc.panels.find((p) => p.id === id);

  // True if q is p or sits somewhere below p in the attachment tree.
  C.isDescendant = function (doc, q, p) {
    for (let cur = q, guard = 0; cur && guard < 1000; guard++) {
      if (cur === p) return true;
      cur = cur.attach ? C.findPanel(doc, cur.attach.parent) : null;
    }
    return false;
  };

  const num = (v) => typeof v === "number" && isFinite(v);
  const chosen = (v) => v !== null && v !== undefined && v !== "";
  C.panelComplete = (p) => num(p.width) && p.width > 0 && num(p.height) && p.height > 0;

  // kind "size" must be > 0, "pos" may be any number, "choice" must be picked.
  const fieldOk = (r) => (r.kind === "choice" ? chosen(r.v) : num(r.v) && (r.kind === "pos" || r.v > 0));

  // Every value a feature needs, in the order the user should measure them. path is relative to
  // the feature.
  C.requiredFields = function (f, n, P) {
    const size = (path, v, text) => ({ path, v, kind: "size", text });
    const choice = (path, v, text) => ({ path, v, kind: "choice", text });
    const pos = (ax, what) => ({
      path: `${ax}.value`, v: f[ax].value, kind: "pos",
      text: `measure from the ${f[ax].ref} edge of ${P} to the ${what} (${n}).`,
    });
    const near = (ax, nearText, centerText) => (f[ax].to === "near" ? nearText : centerText);
    switch (f.type) {
      case "hole":
        return [
          size("diameter", f.diameter, `measure the diameter of ${n}.`),
          pos("x", near("x", "near side of the hole", "hole center")),
          pos("y", near("y", "near side of the hole", "hole center")),
        ];
      case "cutout":
        return [
          size("width", f.width, `measure the width of ${n}.`),
          size("height", f.height, `measure the height of ${n}.`),
          pos("x", "nearest edge of the cutout"),
          pos("y", "nearest edge of the cutout"),
        ];
      case "slot": {
        const kind = [
          choice("orient", f.orient, `choose whether ${n} runs horizontally or vertically.`),
          choice("open", f.open, `choose whether ${n} is closed or open to an edge (U-slot).`),
        ];
        if (!chosen(f.orient) || !chosen(f.open)) return kind; // positions depend on these
        const along = f.orient === "h" ? "x" : "y", across = f.orient === "h" ? "y" : "x";
        return [
          ...kind,
          size("width", f.width, `measure the width of ${n}.`),
          size("length", f.length, f.open
            ? `measure the depth of ${n}, from the ${f[along].ref} edge to the far end of the slot.`
            : `measure the overall length of ${n}, end to end.`),
          pos(across, near(across, "near side of the slot", "slot centerline")),
          ...(f.open ? [] : [pos(along, near(along, "near end of the slot", "slot center"))]),
        ];
      }
      case "angle":
        return [
          choice("toward", f.toward, `choose which side ${n} cuts off.`),
          ...["p1", "p2"].flatMap((k, i) => ["x", "y"].map((ax) => ({
            path: `${k}.${ax}.value`, v: f[k][ax].value, kind: "pos",
            text: `measure end ${i + 1} of ${n}: distance from the ${f[k][ax].ref} edge of ${P}.`,
          }))),
        ];
    }
    return [];
  };

  C.featureComplete = (f) => C.requiredFields(f, "", "").every(fieldOk);

  // Everything a joint needs, in walkthrough order. path is relative to the panel.
  C.attachFields = function (p, P) {
    const a = p.attach, other = a.parent || "the other panel";
    return [
      { path: "attach.parent", v: a.parent, kind: "choice", text: `choose which panel ${P} is joined to.` },
      { path: "attach.edge", v: a.edge, kind: "choice", text: `choose which side of ${other} ${P} is joined along.` },
      { path: "attach.line.ref", v: a.line.ref, kind: "choice", text: `choose which edge of ${other} the bend line of ${P} is measured from.` },
      {
        path: "attach.line.value", v: a.line.value, kind: "pos",
        text: `measure where the bend line of ${P} is: distance from ${other}'s ${a.line.ref || "chosen"} edge (0 if it bends right at that edge).`,
      },
      {
        path: "attach.offset", v: a.offset, kind: "pos",
        text: `measure where ${P} starts along ${other}'s ${a.edge || "chosen"} side, from its ${a.edge ? C.edgeStartName(a.edge) : "starting"} end.`,
      },
      { path: "attach.angle", v: a.angle, kind: "pos", text: `enter the bend angle of ${P} (90 for a right angle, 0 for flat).` },
      { path: "attach.toward", v: a.toward, kind: "choice", text: `choose whether ${P} bends toward the front or the back of ${other}.` },
    ];
  };

  C.attachComplete = (p) => !!p.attach && C.attachFields(p, "").every(fieldOk);

  const place = (d, a, size, low) => (a.ref === low ? d : size - d);

  C.holeCenter = function (p, f) {
    const r = f.diameter / 2;
    const at = (a, size, low) => place(a.value + (a.to === "near" ? r : 0), a, size, low);
    return { x: at(f.x, p.width, "left"), y: at(f.y, p.height, "bottom") };
  };

  C.cutoutRect = function (p, f) {
    const x0 = f.x.ref === "left" ? f.x.value : p.width - f.x.value - f.width;
    const y0 = f.y.ref === "bottom" ? f.y.value : p.height - f.y.value - f.height;
    return { x0, y0, x1: x0 + f.width, y1: y0 + f.height };
  };

  // Slot as the segment a-b between its two arc centers, radius r. For an open slot, a lies
  // outside the panel so the slot runs out through the edge.
  C.slotGeom = function (p, f) {
    const r = f.width / 2, h = f.orient === "h";
    const along = h ? f.x : f.y, across = h ? f.y : f.x;
    const aSize = h ? p.width : p.height, cSize = h ? p.height : p.width;
    const lowA = h ? "left" : "bottom", lowC = h ? "bottom" : "left";
    const c = place(across.value + (across.to === "near" ? r : 0), across, cSize, lowC);
    let d0, d1, mid;
    if (f.open) {
      d0 = -f.width;
      d1 = f.length - r;
    } else {
      const half = Math.max(0, f.length / 2 - r);
      mid = along.value + (along.to === "near" ? f.length / 2 : 0);
      d0 = mid - half;
      d1 = mid + half;
    }
    const P = (d) => { const v = place(d, along, aSize, lowA); return h ? [v, c] : [c, v]; };
    return {
      a: P(d0), b: P(d1), r, across: c,
      // Coordinate (along the slot) that the drawing dimensions: slot center, or far end if open.
      alongDim: place(f.open ? f.length : mid, along, aSize, lowA),
      edge: place(0, along, aSize, lowA),
    };
  };

  C.anglePoints = (p, f) =>
    [f.p1, f.p2].map((q) => [
      q.x.ref === "left" ? q.x.value : p.width - q.x.value,
      q.y.ref === "bottom" ? q.y.value : p.height - q.y.value,
    ]);

  // Unit normal of an angled cut, pointing toward the side that is removed.
  C.angleNormal = function (p, f) {
    const [p1, p2] = C.anglePoints(p, f), d = [p2[0] - p1[0], p2[1] - p1[1]], L = Math.hypot(...d);
    if (L < 1e-9) return null;
    const n = [d[1] / L, -d[0] / L], t = C.TOWARD[f.toward];
    return n[0] * t[0] + n[1] * t[1] >= 0 ? n : [-n[0], -n[1]];
  };

  // Outer rectangle plus every complete feature as a cutter shape.
  C.panelShapes = function (p) {
    const W = p.width, H = p.height, far = 10 * (W + H);
    const outer = { kind: "poly", pts: [[0, 0], [W, 0], [W, H], [0, H]] };
    const cutters = [];
    for (const f of p.features) {
      if (!C.featureComplete(f)) continue;
      if (f.type === "hole") {
        const c = C.holeCenter(p, f);
        cutters.push({ kind: "circle", c: [c.x, c.y], r: f.diameter / 2 });
      } else if (f.type === "cutout") {
        const r = C.cutoutRect(p, f);
        cutters.push({ kind: "poly", pts: [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]] });
      } else if (f.type === "slot") {
        const s = C.slotGeom(p, f);
        cutters.push({ kind: "stadium", a: s.a, b: s.b, r: s.r });
      } else if (f.type === "angle") {
        const n = C.angleNormal(p, f);
        if (!n) continue;
        const [p1, p2] = C.anglePoints(p, f);
        const out = (q) => [q[0] + n[0] * far, q[1] + n[1] * far];
        cutters.push({ kind: "poly", pts: [p1, p2, out(p2), out(p1)] });
      }
    }
    return { outer, cutters };
  };

  C.panelGeometry = function (p) {
    const { outer, cutters } = C.panelShapes(p);
    return { outer, cutters, pieces: C.boundary(outer, cutters) };
  };

  // ---- 3D placement -------------------------------------------------------------------------

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  C.vec = { cross, add, scale, dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };

  // For each parent side: direction along it (u, the way the offset is measured) and outward
  // in-plane normal (n). A joined panel's own x axis runs along u and its y axis starts out along
  // n, so its joined edge is its bottom edge.
  C.edgeBasis = function (edge, W, H) {
    const b = {
      bottom: { u: [1, 0, 0], n: [0, -1, 0] },
      top: { u: [1, 0, 0], n: [0, 1, 0] },
      left: { u: [0, 1, 0], n: [-1, 0, 0] },
      right: { u: [0, 1, 0], n: [1, 0, 0] },
    }[edge];
    return { ...b, z0: cross(b.u, b.n), length: edge === "top" || edge === "bottom" ? W : H };
  };

  C.edgeStartName = (edge) => (edge === "top" || edge === "bottom" ? "left" : "bottom");
  // Edges a bend line can be measured from: the two parallel to the joined side.
  C.bendRefs = (edge) => (edge === "top" || edge === "bottom" ? ["bottom", "top"] : ["left", "right"]);

  // The bend line, in the parent's coordinates: x for a left/right side, y for a top/bottom side.
  C.bendCoord = function (parent, a) {
    const size = a.edge === "top" || a.edge === "bottom" ? parent.height : parent.width;
    return a.line.ref === "left" || a.line.ref === "bottom" ? a.line.value : size - a.line.value;
  };

  // How much of the joined panel's width actually sits on an edge of the parent's material along
  // the bend line the user gave. A bent face is one piece with its parent, so the bend has to be
  // on a material edge with the material on the inner side; anything less is reported, not fixed.
  C.jointCoverage = function (parent, p) {
    const a = p.attach, e = C.edgeBasis(a.edge, parent.width, parent.height);
    const lo = a.offset, hi = lo + p.width, k = C.bendCoord(parent, a);
    const vertical = a.edge === "left" || a.edge === "right";
    const along = (q) => (vertical ? q[1] : q[0]);
    const across = (q) => (vertical ? q[0] : q[1]);
    const { outer, cutters, pieces } = C.panelGeometry(parent);
    const solid = (q, s) => C.inMaterial(outer, cutters, [q[0] - e.n[0] * s, q[1] - e.n[1] * s]);
    let overlap = 0;
    for (const pc of pieces) {
      if (pc.t !== "line" || Math.abs(across(pc.a) - k) > 1e-6 || Math.abs(across(pc.b) - k) > 1e-6) continue;
      const mid = [(pc.a[0] + pc.b[0]) / 2, (pc.a[1] + pc.b[1]) / 2];
      if (!solid(mid, 1e-3) || solid(mid, -1e-3)) continue; // material inside, air outside
      overlap += Math.max(0, Math.min(hi, Math.max(along(pc.a), along(pc.b))) - Math.max(lo, Math.min(along(pc.a), along(pc.b))));
    }
    return { overlap, covered: overlap >= p.width - 1e-6 };
  };

  // Child frame expressed in the parent's coordinates.
  // Panels are plates with thickness, and every size is an outside dimension, as calipers measure
  // a bent part: the bend line is the outside edge of the parent's material, and a joined face is
  // measured from the outside of the bend. So the joined plate starts at the outside corner (on the
  // parent's face opposite the bend direction) and its thickness lies inside the bend, overlapping
  // the parent there. The two plates then form one solid corner instead of touching along a line.
  //
  // Each frame carries tdir: which way along its z axis the plate's thickness runs from the
  // frame's surface (+1: z in [0, t], -1: z in [-t, 0]). z itself stays x × y, so "front" of a
  // panel always means the side you see in its flat drawing.
  C.tdirOf = (e, a) => e.z0[2] * (a.toward === "front" ? 1 : -1);

  function localFrame(parent, parentTdir, child) {
    const a = child.attach, e = C.edgeBasis(a.edge, parent.width, parent.height);
    const k = C.bendCoord(parent, a), s = a.toward === "front" ? 1 : -1;
    const [lo, hi] = parentTdir > 0 ? [0, parent.thickness] : [-parent.thickness, 0];
    const zOuter = s < 0 ? hi : lo; // the parent's face on the outside of the bend
    const start = a.edge === "left" || a.edge === "right" ? [k, 0, zOuter] : [0, k, zOuter];
    const phi = ((a.angle * Math.PI) / 180) * s * e.z0[2];
    const y = add(scale(e.n, Math.cos(phi)), scale(e.z0, Math.sin(phi)));
    return { o: add(start, scale(e.u, a.offset)), x: e.u, y, z: cross(e.u, y), tdir: parentTdir * C.tdirOf(e, a) };
  }

  const toWorld = (F, v) => add(F.o, add(scale(F.x, v[0]), add(scale(F.y, v[1]), scale(F.z, v[2]))));
  const dirWorld = (F, v) => add(scale(F.x, v[0]), add(scale(F.y, v[1]), scale(F.z, v[2])));

  // World frames (root panel = world) for every panel whose whole chain is measured. Placing a
  // joined face needs its parent's thickness, so nothing is placed until thicknesses are measured.
  const placeable = (p) => C.panelComplete(p) && p.thickness > 0;

  C.panelFrames = function (doc) {
    const frames = new Map();
    const visit = (p, F) => {
      frames.set(p.id, F);
      for (const ch of doc.panels) {
        if (!ch.attach || ch.attach.parent !== p.id || frames.has(ch.id)) continue;
        if (!placeable(ch) || !C.attachComplete(ch)) continue;
        const L = localFrame(p, F.tdir, ch);
        visit(ch, { o: toWorld(F, L.o), x: dirWorld(F, L.x), y: dirWorld(F, L.y), z: dirWorld(F, L.z), tdir: L.tdir });
      }
    };
    for (const p of doc.panels)
      if (!p.attach && placeable(p)) visit(p, { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], tdir: 1 });
    return frames;
  };
  C.toWorld = toWorld;

  // ---- Guidance -----------------------------------------------------------------------------

  C.validate = function (doc) {
    const out = [];
    const F = (v) => `${C.fmtDim(v, doc.units, doc.decimals)} ${doc.units}`;
    for (const p of doc.panels) {
      const tag = `Panel ${p.id}`;
      if (!C.panelComplete(p)) {
        out.push(`${tag}: needs a width and height before it can be drawn.`);
        continue;
      }
      if (!(p.thickness > 0)) out.push(`${tag}: thickness not measured yet.`);
      if (p.attach) {
        const parent = p.attach.parent && C.findPanel(doc, p.attach.parent);
        if (!C.attachComplete(p)) out.push(`${tag}: how it joins the other panel isn't fully entered yet, so it isn't placed in 3D.`);
        else if (!parent) out.push(`${tag}: the panel it is joined to no longer exists.`);
        else if (C.panelComplete(parent)) {
          const a = p.attach;
          const len = C.edgeBasis(a.edge, parent.width, parent.height).length;
          const bendSize = a.edge === "top" || a.edge === "bottom" ? parent.height : parent.width;
          const where = `${F(a.line.value)} from ${parent.id}'s ${a.line.ref} edge`;
          if (a.offset < -EPS || a.offset + p.width > len + EPS)
            out.push(`${tag} is ${F(p.width)} wide starting ${F(a.offset)} along ${parent.id}'s ${a.edge} side, but that side is only ${F(len)} long.`);
          else if (a.line.value < -EPS || a.line.value > bendSize + EPS)
            out.push(`${tag}: its bend line (${where}) is outside ${parent.id}.`);
          else {
            const c = C.jointCoverage(parent, p);
            if (c.overlap < EPS)
              out.push(`${tag}: its bend line (${where}) doesn't run along an edge of ${parent.id}'s material. A bent face has to start at an edge: check the bend line position and the cutouts.`);
            else if (!c.covered)
              out.push(`${tag}: only ${F(c.overlap)} of its ${F(p.width)} width meets ${parent.id}'s material along the bend line (${where}). Check its width, its starting position and the cutouts.`);
          }
        }
      }
      p.features.forEach((f, j) => {
        const tagF = `${tag}, row ${j + 1} (${FEATURE_NAME[f.type]})`;
        if (!C.featureComplete(f)) {
          out.push(`${tagF}: missing measurements, not drawn yet.`);
          return;
        }
        const values = C.requiredFields(f, "", "").filter((r) => r.kind === "pos").map((r) => r.v);
        if (values.some((v) => v < 0)) out.push(`${tagF}: has a negative distance, check the measurement.`);
        const breaks = (pts, r) =>
          pts.some(([x, y]) => x - r < -EPS || y - r < -EPS || x + r > p.width + EPS || y + r > p.height + EPS);
        if (f.type === "hole") {
          const c = C.holeCenter(p, f);
          if (breaks([[c.x, c.y]], f.diameter / 2))
            out.push(`${tagF}: the hole breaks through the panel edge. Check the value and which edge it is measured from.`);
        } else if (f.type === "cutout") {
          const r = C.cutoutRect(p, f);
          if (r.x1 <= EPS || r.y1 <= EPS || r.x0 >= p.width - EPS || r.y0 >= p.height - EPS)
            out.push(`${tagF}: the cutout lies completely outside the panel.`);
        } else if (f.type === "slot") {
          const s = C.slotGeom(p, f);
          if (!f.open && f.length < f.width - EPS)
            out.push(`${tagF}: the length is the overall length including the rounded ends, so it can't be less than the width.`);
          if (!f.open && breaks([s.a, s.b], s.r))
            out.push(`${tagF}: the slot breaks through the panel edge. If it is a U-slot open to the edge, set it to "open".`);
          if (f.open && breaks([s.b], s.r))
            out.push(`${tagF}: the slot runs out through another edge. Check the depth and position.`);
        } else if (f.type === "angle") {
          const [a, b] = C.anglePoints(p, f);
          const n = C.angleNormal(p, f);
          if (!n) out.push(`${tagF}: both ends are at the same point.`);
          else if (Math.abs(n[0] * C.TOWARD[f.toward][0] + n[1] * C.TOWARD[f.toward][1]) < 1e-6)
            out.push(`${tagF}: the cut runs straight toward the ${f.toward} corner, so which side to remove is unclear. Pick a neighboring direction.`);
          if (breaks([a, b], 0)) out.push(`${tagF}: an end lies outside the panel.`);
        }
      });
    }
    return out;
  };

  const FEATURE_NAME = { hole: "hole", cutout: "cutout", slot: "slot", angle: "angled edge" };

  // The first thing still to be measured, with the data-path of its input field.
  C.nextStep = function (doc) {
    if (!doc.name) return { path: "name", text: "give the part a name and pick the units your calipers show." };
    for (const [i, p] of doc.panels.entries()) {
      const P = `panel ${p.id}`;
      if (!(p.width > 0)) return { path: `p${i}.width`, text: `measure the width of ${P} (left edge to right edge).` };
      if (!(p.height > 0)) return { path: `p${i}.height`, text: `measure the height of ${P} (bottom edge to top edge).` };
      if (!(p.thickness > 0)) return { path: `p${i}.thickness`, text: `measure the thickness of ${P}.` };
      if (p.attach) {
        const missing = C.attachFields(p, P).find((r) => !fieldOk(r));
        if (missing) return { path: `p${i}.${missing.path}`, text: missing.text };
      }
      for (const [j, f] of p.features.entries()) {
        const missing = C.requiredFields(f, `${FEATURE_NAME[f.type]} ${j + 1} on ${P}`, P).find((r) => !fieldOk(r));
        if (missing) return { path: `p${i}.f${j}.${missing.path}`, text: missing.text };
      }
    }
    return {
      path: null,
      text: "everything entered is measured. Add more features or joined faces, or export the drawing.",
    };
  };
})((globalThis.C2D = globalThis.C2D || {}));
