// Part model: panels (flat faces) with holes and rectangular cutouts, joined at edges.
// All lengths in mm. Panel coordinates: x = left→right, y = bottom→top, z = toward the viewer (front).
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

  C.newAttach = (parent) => ({ parent, edge: "top", offset: 0, angle: 90, toward: "back" });

  // Positions are measured from a panel edge. Holes can be measured to their center or to the
  // near side of the hole (what calipers can actually touch); cutouts are measured to their near edge.
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
  C.panelComplete = (p) => num(p.width) && p.width > 0 && num(p.height) && p.height > 0;
  C.featureComplete = function (f) {
    const pos = num(f.x.value) && num(f.y.value);
    return f.type === "hole"
      ? pos && num(f.diameter) && f.diameter > 0
      : pos && num(f.width) && f.width > 0 && num(f.height) && f.height > 0;
  };

  C.holeCenter = function (p, f) {
    const r = f.diameter / 2;
    const along = (a, size, lowRef) => {
      const d = a.value + (a.to === "near" ? r : 0);
      return a.ref === lowRef ? d : size - d;
    };
    return { x: along(f.x, p.width, "left"), y: along(f.y, p.height, "bottom") };
  };

  C.cutoutRect = function (p, f) {
    const x0 = f.x.ref === "left" ? f.x.value : p.width - f.x.value - f.width;
    const y0 = f.y.ref === "bottom" ? f.y.value : p.height - f.y.value - f.height;
    return { x0, y0, x1: x0 + f.width, y1: y0 + f.height };
  };

  // Outline of a panel after rectangular cutouts are removed, as closed loops of [x, y] points
  // (outer boundary counter-clockwise, interior openings clockwise). Cutouts that overrun an edge
  // become notches. Works on the grid formed by all rectangle edges, so it is exact for rectangles.
  C.panelOutline = function (p) {
    const W = p.width, H = p.height;
    const clamp = (v, hi) => Math.min(Math.max(v, 0), hi);
    const rects = p.features
      .filter((f) => f.type === "cutout" && C.featureComplete(f))
      .map((f) => C.cutoutRect(p, f))
      .map((r) => ({ x0: clamp(r.x0, W), x1: clamp(r.x1, W), y0: clamp(r.y0, H), y1: clamp(r.y1, H) }))
      .filter((r) => r.x1 - r.x0 > EPS && r.y1 - r.y0 > EPS);
    const uniq = (vals) =>
      vals.sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > EPS);
    const xs = uniq([0, W, ...rects.flatMap((r) => [r.x0, r.x1])]);
    const ys = uniq([0, H, ...rects.flatMap((r) => [r.y0, r.y1])]);

    const nx = xs.length - 1, ny = ys.length - 1;
    const inside = (i, j) => {
      if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
      const mx = (xs[i] + xs[i + 1]) / 2, my = (ys[j] + ys[j + 1]) / 2;
      return !rects.some((r) => mx > r.x0 && mx < r.x1 && my > r.y0 && my < r.y1);
    };

    // Boundary edges between inside and outside cells, oriented with the material on the left.
    const segs = new Map(); // "i,j" start vertex -> list of end vertices
    const addSeg = (a, b) => {
      const k = a.join(",");
      if (!segs.has(k)) segs.set(k, []);
      segs.get(k).push(b);
    };
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        if (!inside(i, j)) continue;
        if (!inside(i, j - 1)) addSeg([i, j], [i + 1, j]);
        if (!inside(i + 1, j)) addSeg([i + 1, j], [i + 1, j + 1]);
        if (!inside(i, j + 1)) addSeg([i + 1, j + 1], [i, j + 1]);
        if (!inside(i - 1, j)) addSeg([i, j + 1], [i, j]);
      }

    const loops = [];
    for (const [startKey, ends] of segs) {
      while (ends.length) {
        const loop = [startKey.split(",").map(Number)];
        let next = ends.pop();
        while (next.join(",") !== startKey) {
          loop.push(next);
          const out = segs.get(next.join(","));
          if (!out || !out.length) break;
          next = out.pop();
        }
        loops.push(simplify(loop.map(([i, j]) => [xs[i], ys[j]])));
      }
    }
    return loops;
  };

  // Drop points that sit in the middle of a straight run.
  function simplify(loop) {
    return loop.filter((p, k) => {
      const a = loop[(k + loop.length - 1) % loop.length], b = loop[(k + 1) % loop.length];
      return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
    });
  }

  // ---- 3D placement -------------------------------------------------------------------------

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  C.vec = { cross, add, scale, dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };

  // For each parent edge: start point (where the offset is measured from), direction along the
  // edge (u), and outward in-plane normal (n). A joined panel's own x axis runs along u and its
  // y axis starts out along n, so its joined edge is its bottom edge.
  C.edgeBasis = function (edge, W, H) {
    const b = {
      bottom: { start: [0, 0, 0], u: [1, 0, 0], n: [0, -1, 0] },
      top: { start: [0, H, 0], u: [1, 0, 0], n: [0, 1, 0] },
      left: { start: [0, 0, 0], u: [0, 1, 0], n: [-1, 0, 0] },
      right: { start: [W, 0, 0], u: [0, 1, 0], n: [1, 0, 0] },
    }[edge];
    return { ...b, z0: cross(b.u, b.n), length: edge === "top" || edge === "bottom" ? W : H };
  };

  C.edgeStartName = (edge) => (edge === "top" || edge === "bottom" ? "left" : "bottom");

  // Child frame expressed in the parent's coordinates.
  function localFrame(parent, a) {
    const e = C.edgeBasis(a.edge, parent.width, parent.height);
    const phi = (((a.angle || 0) * Math.PI) / 180) * (a.toward === "front" ? 1 : -1) * e.z0[2];
    const y = add(scale(e.n, Math.cos(phi)), scale(e.z0, Math.sin(phi)));
    return { o: add(e.start, scale(e.u, a.offset || 0)), x: e.u, y, z: cross(e.u, y) };
  }

  const toWorld = (F, v) => add(F.o, add(scale(F.x, v[0]), add(scale(F.y, v[1]), scale(F.z, v[2]))));
  const dirWorld = (F, v) => add(scale(F.x, v[0]), add(scale(F.y, v[1]), scale(F.z, v[2])));

  // World frames (root panel = world) for every panel whose whole chain is measured.
  C.panelFrames = function (doc) {
    const frames = new Map();
    const visit = (p, F) => {
      frames.set(p.id, F);
      for (const ch of doc.panels) {
        if (!ch.attach || ch.attach.parent !== p.id || !C.panelComplete(ch) || frames.has(ch.id)) continue;
        const L = localFrame(p, ch.attach);
        visit(ch, { o: toWorld(F, L.o), x: dirWorld(F, L.x), y: dirWorld(F, L.y), z: dirWorld(F, L.z) });
      }
    };
    for (const p of doc.panels)
      if (!p.attach && C.panelComplete(p)) visit(p, { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
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
      if (p.attach) {
        const parent = C.findPanel(doc, p.attach.parent);
        if (!parent) out.push(`${tag}: the panel it is joined to no longer exists.`);
        else if (C.panelComplete(parent)) {
          const len = C.edgeBasis(p.attach.edge, parent.width, parent.height).length;
          const off = p.attach.offset || 0;
          if (off < -EPS || off + p.width > len + EPS)
            out.push(
              `${tag} is ${F(p.width)} wide starting ${F(off)} along ${parent.id}'s ${p.attach.edge} edge, ` +
                `but that edge is only ${F(len)} long.`
            );
        }
      }
      p.features.forEach((f, j) => {
        const tagF = `${tag}, row ${j + 1} (${f.type})`;
        if (!C.featureComplete(f)) {
          out.push(`${tagF}: missing measurements, not drawn yet.`);
          return;
        }
        if (f.x.value < 0 || f.y.value < 0) out.push(`${tagF}: has a negative distance, check the measurement.`);
        if (f.type === "hole") {
          const c = C.holeCenter(p, f), r = f.diameter / 2;
          if (c.x - r < -EPS || c.y - r < -EPS || c.x + r > p.width + EPS || c.y + r > p.height + EPS)
            out.push(`${tagF}: the hole breaks through the panel edge. Check the value and which edge it is measured from.`);
        } else {
          const r = C.cutoutRect(p, f);
          if (r.x1 <= EPS || r.y1 <= EPS || r.x0 >= p.width - EPS || r.y0 >= p.height - EPS)
            out.push(`${tagF}: the cutout lies completely outside the panel.`);
        }
      });
    }
    return out;
  };

  // The first thing still to be measured, with the data-path of its input field.
  C.nextStep = function (doc) {
    if (!doc.name) return { path: "name", text: "give the part a name and pick the units your calipers show." };
    for (const [i, p] of doc.panels.entries()) {
      const P = `panel ${p.id}`;
      if (!(p.width > 0)) return { path: `p${i}.width`, text: `measure the width of ${P} (left edge to right edge).` };
      if (!(p.height > 0)) return { path: `p${i}.height`, text: `measure the height of ${P} (bottom edge to top edge).` };
      if (!(p.thickness > 0)) return { path: `p${i}.thickness`, text: `measure the thickness of ${P}.` };
      for (const [j, f] of p.features.entries()) {
        const base = `p${i}.f${j}`, n = `${f.type} ${j + 1} on ${P}`;
        if (f.type === "hole") {
          if (!(f.diameter > 0)) return { path: `${base}.diameter`, text: `measure the diameter of ${n}.` };
        } else {
          if (!(f.width > 0)) return { path: `${base}.width`, text: `measure the width of ${n}.` };
          if (!(f.height > 0)) return { path: `${base}.height`, text: `measure the height of ${n}.` };
        }
        for (const ax of ["x", "y"]) {
          const a = f[ax];
          if (a.value == null) {
            const to = f.type === "cutout" ? "nearest edge of the cutout" : a.to === "near" ? "near side of the hole" : "hole center";
            return { path: `${base}.${ax}.value`, text: `measure from the ${a.ref} edge of ${P} to the ${to} (${n}).` };
          }
        }
      }
    }
    return {
      path: null,
      text: "everything entered is measured. Add more holes, cutouts or joined faces, or export the drawing.",
    };
  };
})((globalThis.C2D = globalThis.C2D || {}));
