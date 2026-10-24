// Output formats: SVG (print / view), DXF (CAD, laser and CNC import), OpenSCAD (parametric 3D).
(function (C) {
  "use strict";

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const SVG_STYLE = {
    thick: 'stroke="#000" stroke-width="0.5" fill="none"',
    thin: 'stroke="#000" stroke-width="0.18"',
    dot: 'fill="#000"',
    center: 'stroke="#000" stroke-width="0.18" stroke-dasharray="4 1 1 1"',
    phantom: 'stroke="#000" stroke-width="0.3" stroke-dasharray="5 1 1 1 1 1"',
    part: 'fill="#f2f5fa"',
    iso: 'fill="#d6e0ee" fill-opacity="0.85"',
    isoEdge: 'stroke="#2b3445" stroke-width="0.3" fill="none" stroke-linejoin="round"',
  };

  // Color for the section being edited. On screen only: exports and prints stay black.
  const HL = "#e8590c";
  const HL_STYLE = {
    iso: 'fill="#ffc078" fill-opacity="0.9"',
    hilite: `stroke="${HL}" stroke-width="0.6" fill="${HL}" fill-opacity="0.15" stroke-linejoin="round"`,
    hiliteOpen: `stroke="${HL}" stroke-width="0.9" fill="none"`,
  };
  const recolor = (style) => style.replaceAll("#000", HL).replace('stroke-width="0.18"', 'stroke-width="0.3"');

  // A primitive tagged "p0.f3" is highlighted while "p0.f3" or anything inside it is being edited;
  // one tagged "p0" (a whole panel in the 3D preview) while anything on panel p0 is.
  C.tagMatches = (tags, active) => !!active && !!tags && tags.some((t) => active === t || active.startsWith(t + "."));

  // physical: true sizes the SVG in real millimeters so it prints 1:1.
  // highlight: tag of the form section being edited; its primitives are drawn in color, on top.
  C.toSVG = function (sheet, { physical, highlight } = {}) {
    const { minX, minY, maxX, maxY } = sheet.bbox;
    const W = r3(maxX - minX), H = r3(maxY - minY);
    const X = (x) => r3(x - minX), Y = (y) => r3(maxY - y);
    const uid = Math.random().toString(36).slice(2, 8);
    let masks = 0;
    const pts = (l) => l.map((q) => `${X(q[0])},${Y(q[1])}`);
    const size = physical ? `width="${W}mm" height="${H}mm"` : `width="100%"`;
    const render = (p) => {
      const hl = C.tagMatches(p.tags, highlight);
      const st = (name, fallback) => {
        const base = SVG_STYLE[name] || SVG_STYLE[fallback];
        return hl ? recolor(base) : base;
      };
      if (p.style === "hilite") {
        if (!hl) return "";
        return p.closed
          ? `<polygon points="${pts(p.pts).join(" ")}" ${HL_STYLE.hilite}/>`
          : `<polyline points="${pts(p.pts).join(" ")}" ${HL_STYLE.hiliteOpen}/>`;
      }
      switch (p.t) {
        case "line":
          return `<line x1="${X(p.x1)}" y1="${Y(p.y1)}" x2="${X(p.x2)}" y2="${Y(p.y2)}" ${st(p.style, "thin")}/>`;
        case "circle":
          return `<circle cx="${X(p.cx)}" cy="${Y(p.cy)}" r="${r3(p.r)}" ${st(p.style, "thick")}/>`;
        case "arrow":
          return `<polygon points="${pts(p.pts).join(" ")}" fill="${hl ? HL : "#000"}"/>`;
        case "arc": {
          const P = (a) => `${X(p.cx + p.r * Math.cos(a))},${Y(p.cy + p.r * Math.sin(a))}`;
          // y flips on screen, so counter-clockwise becomes sweep-flag 0.
          const large = p.a1 - p.a0 > Math.PI ? 1 : 0;
          return `<path d="M${P(p.a0)}A${r3(p.r)},${r3(p.r)} 0 ${large} 0 ${P(p.a1)}" ${st(p.style, "thick")}/>`;
        }
        case "poly":
          return `<polyline points="${pts(p.pts).join(" ")}" ${st(p.style, "thin")}/>`;
        case "region": {
          // Filled outer shape with the cutters masked out; the outline itself is drawn separately.
          const id = `m${uid}-${++masks}`, d = "M" + pts(p.outer).join("L") + "Z";
          const cd = p.cutters.map((l) => "M" + pts(l).join("L") + "Z").join("");
          return (
            `<mask id="${id}"><path d="${d}" fill="#fff"/>${cd ? `<path d="${cd}" fill="#000"/>` : ""}</mask>` +
            `<path d="${d}" mask="url(#${id})" ${hl && HL_STYLE[p.style] ? HL_STYLE[p.style] : SVG_STYLE[p.style]}/>`
          );
        }
        case "text": {
          const rot = p.rot ? ` transform="rotate(${-p.rot} ${X(p.x)} ${Y(p.y)})"` : "";
          return `<text x="${X(p.x)}" y="${Y(p.y)}" font-size="${p.h}" text-anchor="${p.anchor}"${rot}${hl ? ` fill="${HL}"` : ""}>${esc(p.s)}</text>`;
        }
      }
      return "";
    };
    // Highlighted primitives go on top so nothing hides them. Fills (regions) keep their place:
    // moving a panel's fill would wrongly bring it in front of nearer panels in the 3D preview.
    const lifted = (p) => p.t !== "region" && C.tagMatches(p.tags, highlight);
    const body = [...sheet.prims.filter((p) => !lifted(p)), ...sheet.prims.filter(lifted)].map(render);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${W} ${H}">` +
      `<rect width="${W}" height="${H}" fill="#fff"/>` +
      `<g font-family="Arial, Helvetica, sans-serif" fill="#000" stroke-linecap="round">${body.join("")}</g></svg>`
    );
  };

  // ---- DXF (R12 ASCII: the most widely readable flavor) -------------------------------------

  const DXF_LAYERS = { OUTLINE: 7, CENTER: 3, DIMS: 4, TEXT: 2, JOINTS: 6, BORDER: 8 };

  const dxfText = (s) => String(s).replace(/Ø/g, "%%c").replace(/°/g, "%%d").replace(/×/g, "x").replace(/—/g, "-").replace(/[^\x20-\x7e]/g, "?");

  C.toDXF = function (sheet, unit) {
    const k = 1 / C.MM_PER[unit];
    const n = (v) => String(Math.round(v * k * 1e6) / 1e6);
    const out = [];
    const g = (...pairs) => { for (let i = 0; i < pairs.length; i += 2) out.push(String(pairs[i]), String(pairs[i + 1])); };

    g(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009");
    g(9, "$INSUNITS", 70, unit === "in" ? 1 : 4, 9, "$MEASUREMENT", 70, unit === "in" ? 0 : 1);
    g(0, "ENDSEC");
    g(0, "SECTION", 2, "TABLES");
    g(0, "TABLE", 2, "LTYPE", 70, 1, 0, "LTYPE", 2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, 0, 0, "ENDTAB");
    g(0, "TABLE", 2, "LAYER", 70, Object.keys(DXF_LAYERS).length);
    for (const [name, color] of Object.entries(DXF_LAYERS)) g(0, "LAYER", 2, name, 70, 0, 62, color, 6, "CONTINUOUS");
    g(0, "ENDTAB", 0, "ENDSEC");

    g(0, "SECTION", 2, "ENTITIES");
    const lineE = (layer, x1, y1, x2, y2) => g(0, "LINE", 8, layer, 10, n(x1), 20, n(y1), 30, 0, 11, n(x2), 21, n(y2), 31, 0);
    for (const p of sheet.prims) {
      // The 3D preview is not to scale and highlight outlines are on-screen only: keep them out of CAD files.
      if (p.layer === "PREVIEW" || p.layer === "HILITE") continue;
      if (p.t === "line") lineE(p.layer, p.x1, p.y1, p.x2, p.y2);
      else if (p.t === "circle") g(0, "CIRCLE", 8, p.layer, 10, n(p.cx), 20, n(p.cy), 30, 0, 40, n(p.r));
      else if (p.t === "arc") {
        const deg = (a) => String(Math.round((((((a * 180) / Math.PI) % 360) + 360) % 360) * 1e6) / 1e6);
        g(0, "ARC", 8, p.layer, 10, n(p.cx), 20, n(p.cy), 30, 0, 40, n(p.r), 50, deg(p.a0), 51, deg(p.a1));
      } else if (p.t === "poly")
        p.pts.slice(1).forEach((q, i) => lineE(p.layer, p.pts[i][0], p.pts[i][1], q[0], q[1]));
      else if (p.t === "arrow") {
        const [a, b, c] = p.pts;
        g(0, "SOLID", 8, p.layer, 10, n(a[0]), 20, n(a[1]), 30, 0, 11, n(b[0]), 21, n(b[1]), 31, 0);
        g(12, n(c[0]), 22, n(c[1]), 32, 0, 13, n(c[0]), 23, n(c[1]), 33, 0);
      } else if (p.t === "text") {
        const just = { start: 0, middle: 1, end: 2 }[p.anchor];
        g(0, "TEXT", 8, p.layer, 10, n(p.x), 20, n(p.y), 30, 0, 40, n(p.h), 1, dxfText(p.s));
        if (p.rot) g(50, p.rot);
        if (just) g(72, just, 11, n(p.x), 21, n(p.y), 31, 0);
      }
    }
    g(0, "ENDSEC", 0, "EOF");
    return out.join("\r\n") + "\r\n";
  };

  // ---- OpenSCAD: parametric 3D model --------------------------------------------------------
  // Measured values become named variables; positions are expressions of them, so editing one
  // measurement moves everything that depends on it, the same way the drawing is dimensioned.
  // All variables come before the first module so OpenSCAD's Customizer lists them, grouped by panel.

  const SCAD_HELPERS = {
    strip: [
      "// Material beyond the line p1-p2, on the side that `toward` points to, as a long strip.",
      "function cut_strip(p1, p2, toward, far) =",
      "  let(d = p2 - p1, n0 = [d[1], -d[0]] / norm(d), n = n0 * toward >= 0 ? n0 : -n0)",
      "  [p1, p2, p2 + far * n, p1 + far * n];",
    ],
  };

  C.toOpenSCAD = function (doc) {
    const v = (x) => String(Math.round(x * 10000) / 10000);
    const frames = C.panelFrames(doc);
    const panels = doc.panels.filter((p) => frames.has(p.id));
    const vars = [], modules = [], helpers = new Set();

    for (const p of panels) {
      const id = p.id, t = p.thickness > 0 ? p.thickness : 1, W = `${id}_width`, H = `${id}_height`, T = `${id}_thick`;
      // from(d, ref, size, low): coordinate of a distance d measured from edge `ref`.
      const from = (d, ref, size, low) => (ref === low ? `${d}` : `${size} - (${d})`);
      vars.push(`/* [Panel ${id}${p.name ? ": " + p.name : ""}] */`);
      vars.push(`${W} = ${v(p.width)};`, `${H} = ${v(p.height)};`);
      vars.push(`${T} = ${v(t)};${p.thickness > 0 ? "" : " // not measured, placeholder"}`);
      if (p.attach) {
        vars.push(`${id}_offset = ${v(p.attach.offset || 0)}; // along ${p.attach.parent}'s ${p.attach.edge} edge from its ${C.edgeStartName(p.attach.edge)} end`);
        vars.push(`${id}_angle = ${v(p.attach.angle || 0)}; // bend from flat, toward the ${p.attach.toward} of ${p.attach.parent}`);
      }
      const cuts = [], count = {};
      const cyl = (x, y, d) => `translate([${x}, ${y}, -1]) cylinder(d = ${d}, h = ${T} + 2);`;
      for (const f of p.features) {
        if (!C.featureComplete(f)) continue;
        const pre = `${id}_${f.type}${(count[f.type] = (count[f.type] || 0) + 1)}`;
        const to = (a, what) => `${a.ref} edge to ${a.to === "near" ? "near side of " + what : what + " center"}`;
        if (f.type === "hole") {
          const ax = (a, axis, size, low) => from(a.to === "near" ? `${pre}_${axis} + ${pre}_d / 2` : `${pre}_${axis}`, a.ref, size, low);
          vars.push(`${pre}_d = ${v(f.diameter)};`);
          vars.push(`${pre}_x = ${v(f.x.value)}; // ${to(f.x, "hole")}`);
          vars.push(`${pre}_y = ${v(f.y.value)}; // ${to(f.y, "hole")}`);
          cuts.push(cyl(ax(f.x, "x", W, "left"), ax(f.y, "y", H, "bottom"), `${pre}_d`));
        } else if (f.type === "cutout") {
          vars.push(`${pre}_w = ${v(f.width)};`, `${pre}_h = ${v(f.height)};`);
          vars.push(`${pre}_x = ${v(f.x.value)}; // ${f.x.ref} edge to cutout`);
          vars.push(`${pre}_y = ${v(f.y.value)}; // ${f.y.ref} edge to cutout`);
          // A cutout flush with an edge is grown 1 mm past it: coincident faces leave slivers and
          // flicker in OpenSCAD.
          const r = C.cutoutRect(p, f), e = 1e-9;
          const gl = r.x0 <= e ? 1 : 0, gr = r.x1 >= p.width - e ? 1 : 0, gb = r.y0 <= e ? 1 : 0, gt = r.y1 >= p.height - e ? 1 : 0;
          const grow = (expr, lo, hi) => `${expr}${lo + hi ? ` + ${lo + hi}` : ""}`;
          const x = (f.x.ref === "left" ? `${pre}_x` : `${W} - ${pre}_x - ${pre}_w`) + (gl ? " - 1" : "");
          const y = (f.y.ref === "bottom" ? `${pre}_y` : `${H} - ${pre}_y - ${pre}_h`) + (gb ? " - 1" : "");
          cuts.push(`translate([${x}, ${y}, -1]) cube([${grow(`${pre}_w`, gl, gr)}, ${grow(`${pre}_h`, gb, gt)}, ${T} + 2]);`);
        } else if (f.type === "slot") {
          const h = f.orient === "h", alongAx = h ? "x" : "y", acrossAx = h ? "y" : "x";
          const along = f[alongAx], across = f[acrossAx];
          const [aSize, aLow] = h ? [W, "left"] : [H, "bottom"];
          const [cSize, cLow] = h ? [H, "bottom"] : [W, "left"];
          vars.push(`${pre}_w = ${v(f.width)};`);
          vars.push(`${pre}_len = ${v(f.length)}; // ${f.open ? `depth from the ${along.ref} edge (open slot)` : "overall length"}`);
          vars.push(`${pre}_${acrossAx} = ${v(across.value)}; // ${to(across, "slot")}`);
          if (!f.open) vars.push(`${pre}_${alongAx} = ${v(along.value)}; // ${to(along, "slot")}`);
          const c = from(across.to === "near" ? `${pre}_${acrossAx} + ${pre}_w / 2` : `${pre}_${acrossAx}`, across.ref, cSize, cLow);
          let d0, d1;
          if (f.open) {
            d0 = `-${pre}_w`;
            d1 = `${pre}_len - ${pre}_w / 2`;
          } else {
            const mid = along.to === "near" ? `${pre}_${alongAx} + ${pre}_len / 2` : `${pre}_${alongAx}`;
            d0 = `${mid} - (${pre}_len - ${pre}_w) / 2`;
            d1 = `${mid} + (${pre}_len - ${pre}_w) / 2`;
          }
          const P = (d) => { const a = from(d, along.ref, aSize, aLow); return h ? [a, c] : [c, a]; };
          cuts.push(`hull() { ${cyl(...P(d0), `${pre}_w`)} ${cyl(...P(d1), `${pre}_w`)} }`);
        } else if (f.type === "angle") {
          helpers.add("strip");
          const pt = (q, k) => {
            vars.push(`${pre}_x${k} = ${v(q.x.value)}; // end ${k}: ${q.x.ref} edge`);
            vars.push(`${pre}_y${k} = ${v(q.y.value)}; // end ${k}: ${q.y.ref} edge`);
            return `[${from(`${pre}_x${k}`, q.x.ref, W, "left")}, ${from(`${pre}_y${k}`, q.y.ref, H, "bottom")}]`;
          };
          const a = pt(f.p1, 1), b = pt(f.p2, 2);
          cuts.push(`translate([0, 0, -1]) linear_extrude(${T} + 2) polygon(cut_strip(${a}, ${b}, [${C.TOWARD[f.toward]}], 10 * (${W} + ${H}))); // angled edge, removes toward ${f.toward}`);
        }
      }
      vars.push("");
      modules.push(`module panel_${id}() {`, "  difference() {", `    cube([${W}, ${H}, ${T}]);`);
      cuts.forEach((c) => modules.push("    " + c));
      modules.push("  }", "}", "");
    }

    const L = [
      `// ${doc.name || "Untitled part"}: generated by caliper-to-diagram`,
      "// All values in millimeters. Edit the measured values (or use the Customizer); positions are derived from them.",
      "// Faces are flat plates joined at their edges (no bend radius or thickness compensation).",
      ...String(doc.notes || "").split(/\r?\n/).filter((l) => l.trim()).map((l) => "// " + l),
      "",
      ...vars,
      "/* [Hidden] */",
      "$fn = 96;",
      "",
      ...[...helpers].flatMap((k) => [...SCAD_HELPERS[k], ""]),
      ...modules,
    ];

    const place = (p, indent) => {
      const pad = "  ".repeat(indent);
      L.push(`${pad}panel_${p.id}();`);
      for (const ch of panels.filter((q) => q.attach && q.attach.parent === p.id)) {
        const a = ch.attach, e = C.edgeBasis(a.edge, 0, 0), off = `${ch.id}_offset`;
        const tr = {
          bottom: `[${off}, 0, 0]`,
          top: `[${off}, ${p.id}_height, 0]`,
          left: `[0, ${off}, 0]`,
          right: `[${p.id}_width, ${off}, 0]`,
        }[a.edge];
        const m = [0, 1, 2].map((i) => `[${e.u[i]}, ${e.n[i]}, ${e.z0[i]}, 0]`).join(", ");
        const sign = (a.toward === "front" ? 1 : -1) * e.z0[2] < 0 ? "-" : "";
        L.push(`${pad}translate(${tr}) multmatrix([${m}, [0, 0, 0, 1]]) rotate([${sign}${ch.id}_angle, 0, 0]) {`);
        place(ch, indent + 1);
        L.push(`${pad}}`);
      }
    };
    if (panels.length) {
      L.push("// ---- Assembly", "module part() {");
      for (const root of panels.filter((p) => !p.attach)) place(root, 1);
      L.push("}", "", "part();");
    }
    return L.join("\n") + "\n";
  };
})((globalThis.C2D = globalThis.C2D || {}));
