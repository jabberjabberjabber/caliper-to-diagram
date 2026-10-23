// Output formats: SVG (print / view), DXF (CAD, laser and CNC import), OpenSCAD (parametric 3D).
(function (C) {
  "use strict";

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const SVG_STYLE = {
    thick: 'stroke="#000" stroke-width="0.5" fill="#fff"',
    thin: 'stroke="#000" stroke-width="0.18"',
    dot: 'fill="#000"',
    center: 'stroke="#000" stroke-width="0.18" stroke-dasharray="4 1 1 1"',
    phantom: 'stroke="#000" stroke-width="0.3" stroke-dasharray="5 1 1 1 1 1"',
    part: 'stroke="#000" stroke-width="0.5" fill="#f2f5fa" fill-rule="evenodd" stroke-linejoin="round"',
    iso: 'stroke="#2b3445" stroke-width="0.3" fill="#d6e0ee" fill-opacity="0.85" fill-rule="evenodd" stroke-linejoin="round"',
  };

  // physical: true sizes the SVG in real millimeters so it prints 1:1.
  C.toSVG = function (sheet, { physical } = {}) {
    const { minX, minY, maxX, maxY } = sheet.bbox;
    const W = r3(maxX - minX), H = r3(maxY - minY);
    const X = (x) => r3(x - minX), Y = (y) => r3(maxY - y);
    const size = physical ? `width="${W}mm" height="${H}mm"` : `width="100%"`;
    const body = sheet.prims.map((p) => {
      switch (p.t) {
        case "line":
          return `<line x1="${X(p.x1)}" y1="${Y(p.y1)}" x2="${X(p.x2)}" y2="${Y(p.y2)}" ${SVG_STYLE[p.style] || SVG_STYLE.thin}/>`;
        case "circle":
          return `<circle cx="${X(p.cx)}" cy="${Y(p.cy)}" r="${r3(p.r)}" ${SVG_STYLE[p.style] || SVG_STYLE.thick}/>`;
        case "arrow":
          return `<polygon points="${p.pts.map((q) => `${X(q[0])},${Y(q[1])}`).join(" ")}" fill="#000"/>`;
        case "path": {
          const d = p.loops.map((l) => "M" + l.map((q) => `${X(q[0])},${Y(q[1])}`).join("L") + "Z").join("");
          return `<path d="${d}" ${SVG_STYLE[p.style]}/>`;
        }
        case "text": {
          const rot = p.rot ? ` transform="rotate(${-p.rot} ${X(p.x)} ${Y(p.y)})"` : "";
          return `<text x="${X(p.x)}" y="${Y(p.y)}" font-size="${p.h}" text-anchor="${p.anchor}"${rot}>${esc(p.s)}</text>`;
        }
      }
      return "";
    });
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
      if (p.layer === "PREVIEW") continue; // the 3D preview is not to scale; keep it out of CAD files
      if (p.t === "line") lineE(p.layer, p.x1, p.y1, p.x2, p.y2);
      else if (p.t === "circle") g(0, "CIRCLE", 8, p.layer, 10, n(p.cx), 20, n(p.cy), 30, 0, 40, n(p.r));
      else if (p.t === "path")
        for (const l of p.loops) l.forEach((q, i) => { const r = l[(i + 1) % l.length]; lineE(p.layer, q[0], q[1], r[0], r[1]); });
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

  C.toOpenSCAD = function (doc) {
    const v = (x) => String(Math.round(x * 10000) / 10000);
    const frames = C.panelFrames(doc);
    const panels = doc.panels.filter((p) => frames.has(p.id));
    const L = [
      `// ${doc.name || "Untitled part"}: generated by caliper-to-diagram`,
      "// All values in millimeters. Edit the measured values; positions are derived from them.",
      "// Faces are flat plates joined at their edges (no bend radius or thickness compensation).",
      ...String(doc.notes || "").split(/\r?\n/).filter((l) => l.trim()).map((l) => "// " + l),
      "",
      "$fn = 96;",
      "",
    ];

    for (const p of panels) {
      const id = p.id, t = p.thickness > 0 ? p.thickness : 1;
      L.push(`// ---- Panel ${id}${p.name ? ": " + p.name : ""}`);
      L.push(`${id}_width = ${v(p.width)};`, `${id}_height = ${v(p.height)};`);
      L.push(`${id}_thick = ${v(t)};${p.thickness > 0 ? "" : " // not measured, placeholder"}`);
      if (p.attach) {
        L.push(`${id}_offset = ${v(p.attach.offset || 0)}; // along ${p.attach.parent}'s ${p.attach.edge} edge from its ${C.edgeStartName(p.attach.edge)} end`);
        L.push(`${id}_angle = ${v(p.attach.angle || 0)}; // bend from flat, toward the ${p.attach.toward} of ${p.attach.parent}`);
      }
      const cuts = [];
      let nh = 0, nc = 0;
      for (const f of p.features) {
        if (!C.featureComplete(f)) continue;
        if (f.type === "hole") {
          const pre = `${id}_hole${++nh}`, r = `${pre}_d / 2`;
          const ax = (a, axis, size, low) => {
            const base = a.to === "near" ? `${pre}_${axis} + ${r}` : `${pre}_${axis}`;
            return a.ref === low ? base : `${size} - (${base})`;
          };
          L.push(`${pre}_d = ${v(f.diameter)};`);
          L.push(`${pre}_x = ${v(f.x.value)}; // ${f.x.ref} edge to ${f.x.to === "near" ? "near side of hole" : "hole center"}`);
          L.push(`${pre}_y = ${v(f.y.value)}; // ${f.y.ref} edge to ${f.y.to === "near" ? "near side of hole" : "hole center"}`);
          cuts.push(`translate([${ax(f.x, "x", `${id}_width`, "left")}, ${ax(f.y, "y", `${id}_height`, "bottom")}, -1]) cylinder(d = ${pre}_d, h = ${id}_thick + 2);`);
        } else {
          const pre = `${id}_cut${++nc}`;
          L.push(`${pre}_w = ${v(f.width)};`, `${pre}_h = ${v(f.height)};`);
          L.push(`${pre}_x = ${v(f.x.value)}; // ${f.x.ref} edge to cutout`);
          L.push(`${pre}_y = ${v(f.y.value)}; // ${f.y.ref} edge to cutout`);
          const x = f.x.ref === "left" ? `${pre}_x` : `${id}_width - ${pre}_x - ${pre}_w`;
          const y = f.y.ref === "bottom" ? `${pre}_y` : `${id}_height - ${pre}_y - ${pre}_h`;
          cuts.push(`translate([${x}, ${y}, -1]) cube([${pre}_w, ${pre}_h, ${id}_thick + 2]);`);
        }
      }
      L.push(`module panel_${id}() {`, "  difference() {", `    cube([${id}_width, ${id}_height, ${id}_thick]);`);
      cuts.forEach((c) => L.push("    " + c));
      L.push("  }", "}", "");
    }

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
