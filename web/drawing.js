// Builds the drawing sheet as a list of primitives (mm, y up). SVG and DXF are rendered from it.
//   line   {x1,y1,x2,y2, style, layer}       style: thick | thin | center | phantom
//   circle {cx,cy,r, style, layer}
//   arc    {cx,cy,r, a0,a1, style, layer}    radians, counter-clockwise from a0 to a1
//   poly   {pts:[[x,y],...], style, layer}    open polyline
//   region {outer:[[x,y],...], cutters:[[[x,y],...]], style, layer}
//          fill only (style part | iso): the outer polygon minus the cutter polygons
//   arrow  {pts:[[x,y]x3], layer}             filled arrowhead
//   text   {x,y, s, h, rot, anchor, layer}    y is the baseline, rot is 0 or 90 (CCW)
(function (C) {
  "use strict";

  const TXT = 3; // dimension and label text height
  const ROW0 = 8; // distance from the part to the first dimension row
  const ROW = 7; // spacing between stacked dimension rows
  const ARROW = 2.5, ARROW_W = 0.7, EXT_GAP = 1, EXT_OVER = 1.5;
  const VIEW_GAP = 18, MARGIN = 10;

  C.textWidth = (s, h) => s.length * h * 0.6;

  // Tags tie primitives to the form section they come from ("p0.width", "p0.f3", "p1.attach"), so
  // the preview can color whatever is being edited. Set around each section while drawing it.
  // Text can also carry edits: the measurements behind it, so clicking a number on the preview
  // edits the value that produced it.
  let curTags = null, curEdits = null;
  const tagged = (o) => {
    if (curTags) o = { ...o, tags: curTags };
    if (curEdits && o.t === "text") o = { ...o, edits: curEdits };
    return o;
  };
  function withTags(tags, fn, edits) {
    const prev = [curTags, curEdits];
    curTags = tags;
    curEdits = edits || null;
    try { fn(); } finally { [curTags, curEdits] = prev; }
  }

  const line = (out, x1, y1, x2, y2, style, layer) => out.push(tagged({ t: "line", x1, y1, x2, y2, style, layer }));
  const text = (out, x, y, s, h, o = {}) =>
    out.push(tagged({ t: "text", x, y, s, h, rot: o.rot || 0, anchor: o.anchor || "start", layer: o.layer || "TEXT" }));

  function arrow(out, tx, ty, dx, dy) {
    const bx = tx - dx * ARROW, by = ty - dy * ARROW, px = -dy * ARROW_W, py = dx * ARROW_W;
    out.push(tagged({ t: "arrow", pts: [[tx, ty], [bx + px, by + py], [bx - px, by - py]], layer: "DIMS" }));
  }

  C.bbox = function (prims) {
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const add = (x, y) => {
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
    };
    for (const p of prims) {
      if (p.t === "line") { add(p.x1, p.y1); add(p.x2, p.y2); }
      else if (p.t === "circle") { add(p.cx - p.r, p.cy - p.r); add(p.cx + p.r, p.cy + p.r); }
      else if (p.t === "arrow") p.pts.forEach((q) => add(q[0], q[1]));
      else if (p.t === "poly") p.pts.forEach((q) => add(q[0], q[1]));
      else if (p.t === "region") p.outer.forEach((q) => add(q[0], q[1])); // cutters may reach far outside
      else if (p.t === "arc")
        for (let i = 0; i <= 16; i++) {
          const a = p.a0 + ((p.a1 - p.a0) * i) / 16;
          add(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a));
        }
      else if (p.t === "text") {
        const w = C.textWidth(p.s, p.h);
        const s = p.anchor === "middle" ? -w / 2 : p.anchor === "end" ? -w : 0;
        if (p.rot === 90) { add(p.x - p.h, p.y + s); add(p.x + p.h * 0.25, p.y + s + w); }
        else { add(p.x + s, p.y - p.h * 0.25); add(p.x + s + w, p.y + p.h); }
      }
    }
    return b;
  };

  function shift(prims, dx, dy) {
    const m = ([x, y]) => [x + dx, y + dy];
    return prims.map((p) => {
      if (p.t === "line") return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
      if (p.t === "circle" || p.t === "arc") return { ...p, cx: p.cx + dx, cy: p.cy + dy };
      if (p.t === "poly") return { ...p, pts: p.pts.map(m) };
      if (p.t === "region") return { ...p, outer: p.outer.map(m), cutters: p.cutters.map((l) => l.map(m)) };
      if (p.t === "arrow") return { ...p, pts: p.pts.map(m) };
      return { ...p, x: p.x + dx, y: p.y + dy };
    });
  }

  // One linear dimension. axis "x": measured along x, dimension line at y = pos (below the part).
  // axis "y": measured along y, dimension line at x = pos (left of the part).
  // sa/sb: where the extension lines start on the feature side.
  function dim(out, axis, a, b, sa, sb, pos, label) {
    const P = (along, across) => (axis === "x" ? [along, across] : [across, along]);
    const dir = axis === "x" ? [1, 0] : [0, 1];
    const lo = Math.min(a, b), hi = Math.max(a, b), span = hi - lo;
    for (const [v, s] of [[a, sa], [b, sb]]) line(out, ...P(v, s - EXT_GAP), ...P(v, pos - EXT_OVER), "thin", "DIMS");
    if (span >= 2 * ARROW + 1) {
      line(out, ...P(lo, pos), ...P(hi, pos), "thin", "DIMS");
      arrow(out, ...P(lo, pos), -dir[0], -dir[1]);
      arrow(out, ...P(hi, pos), dir[0], dir[1]);
    } else {
      // Too tight for arrows inside: put them outside, pointing in.
      line(out, ...P(lo - ARROW - 2, pos), ...P(hi + ARROW + 2, pos), "thin", "DIMS");
      arrow(out, ...P(lo, pos), dir[0], dir[1]);
      arrow(out, ...P(hi, pos), -dir[0], -dir[1]);
    }
    const fits = span >= C.textWidth(label, TXT) + 2 * ARROW + 1;
    const along = fits ? (lo + hi) / 2 : hi + ARROW + 3;
    const anchor = fits ? "middle" : "start";
    if (axis === "x") text(out, along, pos + 0.8, label, TXT, { anchor, layer: "DIMS" });
    else text(out, pos - 0.8, along, label, TXT, { anchor, rot: 90, layer: "DIMS" });
  }

  // Baseline dimensioning: every dimension starts at a panel edge; shortest closest to the part.
  function stack(out, axis, dims, F) {
    const seen = new Map();
    for (const d of dims) {
      if (Math.abs(d.b - d.a) < 1e-6) continue;
      const k = `${d.a.toFixed(4)}|${d.b.toFixed(4)}`;
      const prev = seen.get(k);
      if (prev) {
        prev.sb = Math.min(prev.sb, d.sb);
        prev.tags = [...prev.tags, ...d.tags]; // one dimension can serve several features
        prev.edits = [...prev.edits, ...d.edits];
      } else seen.set(k, { ...d });
    }
    [...seen.values()]
      .sort((p, q) => Math.abs(p.b - p.a) - Math.abs(q.b - q.a))
      .forEach((d, i) =>
        withTags(d.tags, () => dim(out, axis, d.a, d.b, d.sa, d.sb, -(ROW0 + i * ROW), F(Math.abs(d.b - d.a))), d.edits)
      );
  }

  // Callout with a leader: arrow at s on the feature, leader along unit direction v, then a short
  // horizontal shoulder and the text.
  function callout(out, s, v, label) {
    const e = [s[0] + v[0] * 4, s[1] + v[1] * 4], dir = v[0] >= 0 ? 1 : -1;
    arrow(out, s[0], s[1], -v[0], -v[1]);
    line(out, s[0], s[1], e[0], e[1], "thin", "DIMS");
    line(out, e[0], e[1], e[0] + 2 * dir, e[1], "thin", "DIMS");
    text(out, e[0] + 2.5 * dir, e[1] - TXT * 0.35, label, TXT, { anchor: dir > 0 ? "start" : "end", layer: "DIMS" });
  }

  function outlinePrims(out, pieces, layer) {
    for (const pc of pieces) {
      if (pc.t === "line") line(out, pc.a[0], pc.a[1], pc.b[0], pc.b[1], "thick", layer);
      else if (pc.a1 - pc.a0 >= C.TAU - 1e-9) out.push({ t: "circle", cx: pc.c[0], cy: pc.c[1], r: pc.r, style: "thick", layer });
      else out.push({ t: "arc", cx: pc.c[0], cy: pc.c[1], r: pc.r, a0: pc.a0, a1: pc.a1, style: "thick", layer });
    }
  }

  function panelView(doc, p, children) {
    const out = [];
    const F = (v) => C.fmtDim(v, doc.units, doc.decimals);
    const W = p.width, H = p.height, K = Math.SQRT1_2;
    const P = `p${doc.panels.indexOf(p)}`;
    const g = C.panelGeometry(p);
    out.push({ t: "region", outer: g.outer.pts, cutters: g.cutters.map((s) => C.shapePolygon(s)), style: "part", layer: "OUTLINE" });
    outlinePrims(out, g.pieces, "OUTLINE");

    // Edit links: the measured value behind a number on the drawing, so clicking the number edits
    // the measurement itself. kind "len" is a length, "num" a plain number (angles).
    const E = (path, label, kind = "len") => ({ path, label, kind });
    const pathOf = (j, rest) => `${P}.f${j}.${rest}`;

    // Dimensions are collected per axis and laid out by stack(): from ref edge (a) to feature (b);
    // sa/sb are where the extension lines start; tags say which form section each belongs to.
    const xd = [{ a: 0, b: W, sa: 0, sb: 0, tags: [`${P}.width`], edits: [E(`${P}.width`, `${p.id} · width`)] }];
    const yd = [{ a: 0, b: H, sa: 0, sb: 0, tags: [`${P}.height`], edits: [E(`${P}.height`, `${p.id} · height`)] }];
    const xFrom = (ref) => (ref === "left" ? 0 : W), yFrom = (ref) => (ref === "bottom" ? 0 : H);
    const groups = new Map(); // identical holes / slots share one callout: "4X Ø3.20 THRU"
    const sideLabels = []; // labels that don't fit next to their feature

    p.features.forEach((f, j) => {
      if (!C.featureComplete(f)) return;
      const tags = [`${P}.f${j}`];
      const name = `${p.id} · ${{ hole: "hole", cutout: "cutout", slot: "slot", angle: "angled edge" }[f.type]} ${j + 1}`;
      const toWhat = (a, what) => (a.to === "near" ? `near side of ${what}` : `${what} center`);
      const posEdit = (ax, what) => E(pathOf(j, `${ax}.value`), `${name} · from ${f[ax].ref} edge to ${what}`);
      const xdim = (d, edit) => xd.push({ ...d, sa: 0, tags, edits: [edit] });
      const ydim = (d, edit) => yd.push({ ...d, sa: 0, tags, edits: [edit] });
      const group = (key, s, v, edits) => {
        if (!groups.has(key)) groups.set(key, { s, v, n: 0, tags: [], edits: [] });
        const gr = groups.get(key);
        gr.n++;
        gr.tags.push(...tags);
        gr.edits.push(...edits);
      };
      // Outline of just this feature, shown only while it is being edited.
      const hilite = (pts, closed = true) => out.push({ t: "poly", pts, closed, style: "hilite", layer: "HILITE", tags });

      withTags(tags, () => {
        if (f.type === "hole") {
          const c = C.holeCenter(p, f), r = f.diameter / 2, e = r + 1.5;
          hilite(C.shapePolygon({ kind: "circle", c: [c.x, c.y], r }));
          line(out, c.x - e, c.y, c.x + e, c.y, "center", "CENTER");
          line(out, c.x, c.y - e, c.x, c.y + e, "center", "CENTER");
          xdim({ a: xFrom(f.x.ref), b: c.x, sb: c.y - e }, posEdit("x", toWhat(f.x, "hole")));
          ydim({ a: yFrom(f.y.ref), b: c.y, sb: c.x - e }, posEdit("y", toWhat(f.y, "hole")));
          group(`Ø${F(f.diameter)} THRU`, [c.x + r * K, c.y + r * K], [K, K], [E(pathOf(j, "diameter"), `${name} · diameter`)]);
        } else if (f.type === "cutout") {
          const r = C.cutoutRect(p, f);
          hilite([[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]);
          xdim({ a: xFrom(f.x.ref), b: f.x.ref === "left" ? r.x0 : r.x1, sb: Math.max(r.y0, 0) }, posEdit("x", "near edge of cutout"));
          ydim({ a: yFrom(f.y.ref), b: f.y.ref === "bottom" ? r.y0 : r.y1, sb: Math.max(r.x0, 0) }, posEdit("y", "near edge of cutout"));
          const s = `${F(f.width)} × ${F(f.height)}`, my = (r.y0 + r.y1) / 2;
          const edits = [E(pathOf(j, "width"), `${name} · width`), E(pathOf(j, "height"), `${name} · height`)];
          if (C.textWidth(s, TXT) + 2 < f.width && TXT + 2 < f.height)
            withTags(tags, () => text(out, (r.x0 + r.x1) / 2, my - TXT * 0.35, s, TXT, { anchor: "middle", layer: "DIMS" }), edits);
          else sideLabels.push({ s, px: (Math.max(r.x0, 0) + Math.min(r.x1, W)) / 2, py: my, tags, edits });
        } else if (f.type === "slot") {
          const s = C.slotGeom(p, f), h = f.orient === "h", r = s.r, e = r + 1.5;
          hilite(C.shapePolygon({ kind: "stadium", a: s.a, b: s.b, r }));
          const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
          const u = L > 1e-9 ? [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L] : h ? [1, 0] : [0, 1];
          const start = f.open ? (h ? [s.edge, s.across] : [s.across, s.edge]) : [s.a[0] - u[0] * e, s.a[1] - u[1] * e];
          line(out, start[0], start[1], s.b[0] + u[0] * e, s.b[1] + u[1] * e, "center", "CENTER");
          for (const c of f.open ? [s.b] : [s.a, s.b])
            line(out, c[0] - u[1] * e, c[1] + u[0] * e, c[0] + u[1] * e, c[1] - u[0] * e, "center", "CENTER");
          const low = (k) => Math.max(Math.min(s.a[k], s.b[k]) - r, 0);
          const along = h ? "x" : "y", across = h ? "y" : "x";
          const alongEdit = f.open
            ? E(pathOf(j, "length"), `${name} · depth from ${f[along].ref} edge`)
            : posEdit(along, f[along].to === "near" ? "near end of slot" : "slot center");
          const acrossEdit = posEdit(across, toWhat(f[across], "slot"));
          if (h) {
            xdim({ a: xFrom(f.x.ref), b: s.alongDim, sb: low(1) }, alongEdit);
            ydim({ a: yFrom(f.y.ref), b: s.across, sb: low(0) }, acrossEdit);
          } else {
            xdim({ a: xFrom(f.x.ref), b: s.across, sb: low(1) }, acrossEdit);
            ydim({ a: yFrom(f.y.ref), b: s.alongDim, sb: low(0) }, alongEdit);
          }
          const sizeEdits = [E(pathOf(j, "width"), `${name} · width`)];
          if (f.open) {
            // Label right of the panel, with a leader to the far, rounded end of the U.
            let v = [u[0] * K + u[1] * K, -u[0] * K + u[1] * K];
            if (v[0] < 0) v = [u[0] * K - u[1] * K, u[0] * K + u[1] * K];
            sideLabels.push({ s: `OPEN SLOT ${F(f.width)} WIDE`, px: s.b[0] + v[0] * r, py: s.b[1] + v[1] * r, tags, edits: sizeEdits });
          } else {
            const end = s.b[0] + s.b[1] >= s.a[0] + s.a[1] ? s.b : s.a;
            sizeEdits.push(E(pathOf(j, "length"), `${name} · overall length`));
            group(`SLOT ${F(f.width)} × ${F(f.length)}`, [end[0] + r * K, end[1] + r * K], [K, K], sizeEdits);
          }
        } else if (f.type === "angle") {
          const [p1, p2] = C.anglePoints(p, f), n = C.angleNormal(p, f);
          hilite([p1, p2], false);
          const ends = [["p1", f.p1, p1], ["p2", f.p2, p2]];
          const endEdit = (k, q, ax, i) => E(pathOf(j, `${k}.${ax}.value`), `${name} · end ${i + 1} from ${q[ax].ref} edge`);
          ends.forEach(([k, q, pt], i) => {
            xdim({ a: xFrom(q.x.ref), b: pt[0], sb: pt[1] }, endEdit(k, q, "x", i));
            ydim({ a: yFrom(q.y.ref), b: pt[1], sb: pt[0] }, endEdit(k, q, "y", i));
          });
          if (n) {
            // The angle follows from the two measured ends, so it is a reference dimension (in
            // parentheses). Clicking it edits those ends.
            const deg = (Math.atan2(Math.abs(p2[1] - p1[1]), Math.abs(p2[0] - p1[0])) * 180) / Math.PI;
            const m = [(p1[0] + p2[0]) / 2 + n[0] * 3, (p1[1] + p2[1]) / 2 + n[1] * 3];
            const anchor = n[0] < -0.3 ? "end" : n[0] > 0.3 ? "start" : "middle";
            const edits = ends.flatMap(([k, q], i) => ["x", "y"].map((ax) => endEdit(k, q, ax, i)));
            withTags(tags, () => text(out, m[0], m[1] - TXT * 0.35, `(${deg.toFixed(1)}°)`, TXT, { anchor, layer: "DIMS" }), edits);
          }
        }
      });
    });
    // Labels that don't fit go right of the panel with a leader, spread apart so they never overlap.
    let lastY = -Infinity;
    for (const l of sideLabels.sort((a, b) => a.py - b.py)) {
      const y = Math.max(l.py, lastY + TXT + 2);
      lastY = y;
      withTags(l.tags, () => {
        out.push(tagged({ t: "circle", cx: l.px, cy: l.py, r: 0.4, style: "dot", layer: "DIMS" }));
        line(out, l.px, l.py, W + 4, y, "thin", "DIMS");
        line(out, W + 4, y, W + 6, y, "thin", "DIMS");
        text(out, W + 6.5, y - TXT * 0.35, l.s, TXT, { layer: "DIMS" });
      }, l.edits);
    }

    // Bend lines of joined faces, dimensioned from the edge the user measured them from.
    for (const ch of children) {
      const a = ch.attach, k = C.bendCoord(p, a), CP = `p${doc.panels.indexOf(ch)}`;
      const d = { b: k, sa: 0, sb: a.offset, tags: [`${CP}.attach`], edits: [E(`${CP}.attach.line.value`, `${ch.id} · bend line from ${p.id}'s ${a.line.ref} edge`)] };
      if (a.edge === "left" || a.edge === "right") xd.push({ ...d, a: a.line.ref === "left" ? 0 : W });
      else yd.push({ ...d, a: a.line.ref === "bottom" ? 0 : H });
    }

    stack(out, "x", xd, F);
    stack(out, "y", yd, F);

    for (const [label, g] of groups)
      withTags(g.tags, () => callout(out, g.s, g.v, `${g.n > 1 ? g.n + "X " : ""}${label}`), g.edits);

    // Where other faces join this one.
    for (const ch of children) {
      const a = ch.attach, o = a.offset, w = ch.width, h = 2.5, k = C.bendCoord(p, a), CP = `p${doc.panels.indexOf(ch)}`;
      const inset = { left: k, right: W - k, bottom: k, top: H - k }[a.edge];
      const m = 2 - inset; // just outside the bend line
      const seg = {
        top: [o, H + m, o + w, H + m, o + w + 1, H + m - h * 0.35],
        bottom: [o, -m, o + w, -m, o + w + 1, -m - h * 0.35],
        left: [-m, o, -m, o + w, -m - h * 0.3, o + w + 1],
        right: [W + m, o, W + m, o + w, W + m - h * 0.3, o + w + 1],
      }[a.edge];
      withTags([`${CP}.attach`], () => {
        line(out, seg[0], seg[1], seg[2], seg[3], "phantom", "JOINTS");
        text(out, seg[4], seg[5], ch.id, h, { layer: "JOINTS" });
      }, [E(`${CP}.attach.offset`, `${ch.id} · starts along ${p.id}'s ${a.edge} side`), E(`${CP}.attach.line.value`, `${ch.id} · bend line from ${p.id}'s ${a.line.ref} edge`)]);
    }

    // Title lines above the view, top line first: [text, size, tag, edits].
    const lines = [[`${p.id}${p.name ? " — " + p.name.toUpperCase() : ""}`, 4, `${P}.name`, null]];
    if (p.thickness > 0) lines.push([`THICKNESS ${F(p.thickness)}`, 2.5, `${P}.thickness`, [E(`${P}.thickness`, `${p.id} · thickness`)]]);
    if (p.attach && C.attachComplete(p)) {
      const a = p.attach, T = `${P}.attach`, bend = a.angle ? `BENT ${a.angle}° TOWARD ${a.toward.toUpperCase()} OF ${a.parent}` : "FLAT (NO BEND)";
      lines.push([`JOINS ${a.parent} ALONG ITS ${a.edge.toUpperCase()} SIDE, ${bend}`, 2.5, T, [E(`${T}.angle`, `${p.id} · bend angle (degrees)`, "num")]]);
      lines.push([`BEND LINE ${F(a.line.value)} FROM ${a.parent}'S ${a.line.ref.toUpperCase()} EDGE`, 2.5, T, [E(`${T}.line.value`, `${p.id} · bend line from ${a.parent}'s ${a.line.ref} edge`)]]);
      lines.push([`JOINED EDGE DRAWN AT BOTTOM; LEFT END ${F(a.offset)} FROM ${a.parent}'S ${C.edgeStartName(a.edge).toUpperCase()} END`, 2.5, T, [E(`${T}.offset`, `${p.id} · starts along ${a.parent}'s ${a.edge} side`)]]);
    } else if (p.attach) lines.push(["JOINT NOT FULLY ENTERED: NOT PLACED IN 3D", 2.5, `${P}.attach`, null]);
    const bb = C.bbox(out);
    let y = bb.maxY + 4;
    for (let i = lines.length - 1; i >= 0; i--) {
      const [s, size, tag, edits] = lines[i];
      withTags([tag], () => text(out, bb.minX, y, s, size), edits);
      y += size + 1.8;
    }
    return out;
  }

  C.VIEWS = {
    "front-right-top": [1, 1, 1],
    "front-left-top": [-1, 1, 1],
    "back-right-top": [1, 1, -1],
    "back-left-top": [-1, 1, -1],
    "front-right-bottom": [1, -1, 1],
    "front-left-bottom": [-1, -1, 1],
  };

  // Small shaded 3D preview so the joined faces can be checked. Not to scale.
  function isoView(doc, panels, frames, size) {
    const V = C.vec;
    const v = C.VIEWS[doc.view] || C.VIEWS["front-right-top"];
    const len = Math.hypot(...v), d = v.map((c) => c / len);
    const rv = V.cross([0, 1, 0], d), rl = Math.hypot(...rv), right = rv.map((c) => c / rl);
    const up = V.cross(d, right);
    const proj = (q) => [V.dot(q, right), V.dot(q, up)];

    const items = [];
    for (const p of panels) {
      const F = frames.get(p.id);
      if (!F) continue;
      const w = ([x, y]) => proj(C.toWorld(F, [x, y, 0]));
      const g = C.panelGeometry(p);
      const center = C.toWorld(F, [p.width / 2, p.height / 2, 0]);
      items.push({
        id: p.id,
        tag: `p${doc.panels.indexOf(p)}`, // any section of this panel highlights it
        outer: g.outer.pts.map(w),
        cutters: g.cutters.map((s) => C.shapePolygon(s, 32).map(w)),
        edges: g.pieces.map((pc) => C.samplePiece(pc, 32).map(w)),
        depth: V.dot(center, d),
        label: proj(center),
      });
    }
    items.sort((a, b) => a.depth - b.depth);

    const all = items.flatMap((it) => [...it.outer, ...it.edges.flat()]);
    const minX = Math.min(...all.map((q) => q[0])), maxX = Math.max(...all.map((q) => q[0]));
    const minY = Math.min(...all.map((q) => q[1])), maxY = Math.max(...all.map((q) => q[1]));
    const s = size / Math.max(maxX - minX, maxY - minY, 1e-6);
    const m = ([x, y]) => [(x - minX) * s, (y - minY) * s];

    const out = [];
    for (const it of items) {
      out.push({ t: "region", outer: it.outer.map(m), cutters: it.cutters.map((c) => c.map(m)), style: "iso", layer: "PREVIEW", tags: [it.tag] });
      for (const e of it.edges) out.push({ t: "poly", pts: e.map(m), style: "isoEdge", layer: "PREVIEW" });
      const [lx, ly] = m(it.label);
      text(out, lx, ly - 1.2, it.id, 3.5, { anchor: "middle", layer: "PREVIEW" });
    }
    text(out, 0, -6, "3D PREVIEW — NOT TO SCALE", 2.5, { layer: "PREVIEW" });
    return out;
  }

  function titleBlock(doc, minWidth) {
    const out = [];
    const u = C.UNITS[doc.units];
    // Loud failure: a drawing made from incomplete or inconsistent measurements says so on its face.
    const issues = C.validate(doc).length;
    const rows = [
      [doc.name ? doc.name.toUpperCase() : "UNTITLED PART", 5],
      ...(issues
        ? [[`NOT VERIFIED: ${issues} UNRESOLVED ISSUE${issues > 1 ? "S" : ""}. SEE THE WARNINGS IN CALIPER-TO-DIAGRAM.`, 4]]
        : []),
      [`DIMENSIONS IN ${u.name}. SCALE 1:1 WHEN PRINTED AT 100% (ACTUAL SIZE).`, 2.5],
      ["HOLE AND CUTOUT POSITIONS ARE DIMENSIONED FROM THE PANEL EDGE SHOWN.", 2.5],
      ...(doc.panels.some((p) => p.attach)
        ? [["BENT FACES: ALL SIZES ARE OUTSIDE DIMENSIONS, TO THE OUTSIDE OF EACH BEND (SHARP BENDS).", 2.5]]
        : []),
      [`DRAWN ${new Date().toISOString().slice(0, 10)} WITH CALIPER-TO-DIAGRAM`, 2.5],
      ...String(doc.notes || "")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => [l.toUpperCase(), 2.5]),
    ];
    // Scale check bar: measure it on the printout to confirm 1:1.
    const barLen = doc.units === "in" ? 50.8 : 50, tick = doc.units === "in" ? 12.7 : 10;
    const textW = Math.max(...rows.map(([s, h]) => C.textWidth(s, h)));
    const width = Math.max(minWidth, textW + barLen + 20);

    let y = 0;
    for (const [s, h] of rows) {
      y -= h + 2.5;
      text(out, 4, y, s, h);
    }
    const bottom = y - 4;
    const bx = width - barLen - 6, by = -10;
    line(out, bx, by, bx + barLen, by, "thick", "BORDER");
    for (let t = 0; t <= barLen + 1e-9; t += tick) line(out, bx + t, by, bx + t, by + 2, "thin", "BORDER");
    text(out, bx, by - 4.5, doc.units === "in" ? "SCALE CHECK: 2 IN" : "SCALE CHECK: 50 MM", 2.5, { layer: "BORDER" });

    for (const [x1, y1, x2, y2] of [[0, 0, width, 0], [width, 0, width, bottom], [width, bottom, 0, bottom], [0, bottom, 0, 0]])
      line(out, x1, y1, x2, y2, "thin", "BORDER");
    line(out, bx - 4, 0, bx - 4, bottom, "thin", "BORDER");
    return out;
  }

  C.buildSheet = function (doc) {
    const out = [];
    const drawable = doc.panels.filter(C.panelComplete);
    const frames = C.panelFrames(doc);
    let x = 0, tallest = 0;
    for (const p of drawable) {
      const kids = doc.panels.filter((k) => k.attach && k.attach.parent === p.id && C.panelComplete(k) && C.attachComplete(k));
      const v = panelView(doc, p, kids), bb = C.bbox(v);
      out.push(...shift(v, x - bb.minX, -bb.minY));
      x += bb.maxX - bb.minX + VIEW_GAP;
      tallest = Math.max(tallest, bb.maxY - bb.minY);
    }
    if (!drawable.length) text(out, 0, 0, "ENTER A WIDTH AND HEIGHT FOR PANEL A TO START THE DRAWING.", 4);
    else if (frames.size) {
      const iso = isoView(doc, drawable, frames, Math.min(Math.max(tallest * 0.7, 45), 110));
      const bb = C.bbox(iso);
      out.push(...shift(iso, x - bb.minX, tallest - bb.maxY));
    }

    const content = C.bbox(out);
    const tb = titleBlock(doc, content.maxX - content.minX);
    const tbb = C.bbox(tb);
    out.push(...shift(tb, content.minX - tbb.minX, content.minY - 12 - tbb.maxY));

    const all = C.bbox(out);
    const b = { minX: all.minX - MARGIN, minY: all.minY - MARGIN, maxX: all.maxX + MARGIN, maxY: all.maxY + MARGIN };
    const i = MARGIN / 2;
    const [x0, y0, x1, y1] = [b.minX + i, b.minY + i, b.maxX - i, b.maxY - i];
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]])
      line(out, ax, ay, bx, by, "thick", "BORDER");
    return { prims: out, bbox: b };
  };
})((globalThis.C2D = globalThis.C2D || {}));
