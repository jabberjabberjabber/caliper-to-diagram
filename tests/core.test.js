// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const f of ["units.js", "geometry.js", "model.js", "drawing.js", "export.js"]) require(path.join(__dirname, "..", "web", f));
const C = globalThis.C2D;
const example = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "examples", name), "utf8"));
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

test("parseLength reads decimals, fractions and unit suffixes", () => {
  close(C.parseLength("12.5", "mm"), 12.5, "mm");
  close(C.parseLength("1/8", "in"), 3.175, "fraction");
  close(C.parseLength("1 1/4\"", "mm"), 31.75, "mixed + inch mark");
  close(C.parseLength("1-1/4in", "mm"), 31.75, "dash mixed");
  close(C.parseLength(".5", "in"), 12.7, "leading dot");
  close(C.parseLength("2cm", "in"), 20, "cm");
  assert.equal(C.parseLength("  ", "mm"), null);
  assert.ok(Number.isNaN(C.parseLength("abc", "mm")));
  assert.ok(Number.isNaN(C.parseLength("1/0", "mm")));
});

test("inch dimensions drop the leading zero, mm keep it", () => {
  assert.equal(C.fmtDim(6.35, "in", 3), ".250");
  assert.equal(C.fmtDim(0.5, "mm", 2), "0.50");
  assert.equal(C.fmtDim(-0.001, "mm", 2), "0.00");
  assert.equal(C.fmtDim(C.parseLength("3/16", "in"), "in", 3), ".188");
});

test("hole measured to near side gets half the diameter added", () => {
  const p = { width: 100, height: 50, features: [] };
  const f = { type: "hole", diameter: 4, x: { ref: "left", value: 3, to: "near" }, y: { ref: "top", value: 10, to: "center" } };
  assert.deepEqual(C.holeCenter(p, f), { x: 5, y: 40 });
  f.x.ref = "right";
  assert.equal(C.holeCenter(p, f).x, 95);
});

const perimeter = (p) => C.panelGeometry(p).pieces.reduce((sum, pc) => sum + C.pieceLength(pc), 0);
const panel = (width, height, features) => ({ width, height, features });

test("outline: corner notches keep the perimeter, interior cutouts and holes add theirs", () => {
  const p = example("pcie-bracket.json").panels[0];
  p.features = p.features.filter((f) => f.type !== "angle");
  close(perimeter(p), 2 * (18.4 + 112) + 2 * (9 + 20) + 2 * Math.PI * 1.6 * 2, "perimeter");
});

test("outline: pieces join up, so a plain rectangle is 4 lines and a hole is 1 circle", () => {
  const hole = { type: "hole", diameter: 4, x: { ref: "left", value: 5, to: "center" }, y: { ref: "bottom", value: 5, to: "center" } };
  const pieces = C.panelGeometry(panel(20, 10, [hole])).pieces;
  assert.equal(pieces.filter((pc) => pc.t === "line").length, 4);
  assert.equal(pieces.filter((pc) => pc.t === "arc").length, 1);
});

test("angled corner replaces the corner with the hypotenuse", () => {
  const cut = { type: "angle", toward: "bottom-left", p1: { x: { ref: "left", value: 3 }, y: { ref: "bottom", value: 0 } }, p2: { x: { ref: "left", value: 0 }, y: { ref: "bottom", value: 4 } } };
  close(perimeter(panel(10, 10, [cut])), 40 - 7 + 5, "3-4-5 chamfer");
});

test("closed slot: two straight sides plus two half circles", () => {
  const slot = { ...C.newSlot(), orient: "h", open: false, width: 4, length: 12, x: { ref: "left", value: 2, to: "near" }, y: { ref: "bottom", value: 5, to: "center" } };
  const p = panel(30, 10, [slot]);
  const s = C.slotGeom(p, slot);
  assert.deepEqual([s.a, s.b], [[4, 5], [12, 5]]);
  close(perimeter(p), 80 + 2 * 8 + Math.PI * 4, "perimeter");
});

test("open slot runs out through its edge as a U", () => {
  const tab = example("pcie-bracket.json").panels[1]; // 18.4 x 11.4, slot 4.4 wide, 7 deep from top
  const r = 2.2;
  close(perimeter(tab), 2 * (18.4 + 11.4) - 4.4 + 2 * (7 - r) + Math.PI * r, "perimeter");
  assert.equal(C.validate({ ...example("pcie-bracket.json") }).length, 0);
});

test("a hole running off an edge becomes a half-round notch", () => {
  const hole = { type: "hole", diameter: 4, x: { ref: "left", value: 10, to: "center" }, y: { ref: "bottom", value: 0, to: "center" } };
  close(perimeter(panel(20, 10, [hole])), 60 - 4 + 2 * Math.PI, "perimeter");
});

test("joined faces are placed in 3D", () => {
  const doc = example("pcie-bracket.json");
  const F = C.panelFrames(doc).get("B");
  assert.deepEqual(F.o, [0, 112, 0.9]); // starts on A's front face: the outside of a bend toward the back
  // 90 deg toward the back of A: B's y axis points to -z.
  close(F.y[2], -1, "y.z");
  close(F.y[1], 0, "y.y");

  const fan = C.panelFrames(example("fan-stand.json"));
  close(fan.get("B").y[2], -1, "left leg goes back");
  close(fan.get("C").y[2], -1, "right leg goes back");
  assert.deepEqual(fan.get("C").o, [140, 0, 3]);
});

test("examples render and export without warnings", () => {
  for (const name of ["pcie-bracket.json", "fan-stand.json"]) {
    const doc = example(name);
    assert.deepEqual(C.validate(doc), [], name);
    const sheet = C.buildSheet(doc);
    const svg = C.toSVG(sheet, { physical: true });
    assert.match(svg, /^<svg[^>]+width="[\d.]+mm"/);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${name}: bad number in SVG`);
    const dxf = C.toDXF(sheet, "in");
    assert.ok(dxf.endsWith("EOF\r\n"));
    assert.ok(!/NaN|undefined/.test(dxf));
    const scad = C.toOpenSCAD(doc);
    assert.match(scad, /part\(\);/);
    // The Customizer only lists variables declared before the first module.
    assert.ok(scad.indexOf("module ") > Math.max(...[...scad.matchAll(/^\w+ = /gm)].map((m) => m.index)), `${name}: variables before modules`);
    assert.equal((scad.match(/\(/g) || []).length, (scad.match(/\)/g) || []).length, `${name}: balanced parentheses`);
    assert.ok(!/NaN|undefined/.test(scad));
  }
});

test("the bend line is where the user says; the app only checks it against the material", () => {
  // 22 wide plate with a 4 wide strip removed along most of its left side (a trimmed slot cover).
  const strip = { type: "cutout", width: 4, height: 114, x: { ref: "left", value: 0 }, y: { ref: "bottom", value: 0 } };
  const flange = (line, offset, width) => ({
    id: "B", width, height: 10, thickness: 1, features: [],
    attach: { parent: "A", edge: "left", line, offset, angle: 90, toward: "back" },
  });
  const doc = { panels: [{ id: "A", width: 22, height: 121, thickness: 1, attach: null, features: [strip] }], units: "mm", decimals: 2 };
  const A = doc.panels[0];

  // Measured from the left edge, or from the right edge: same bend line, same placement.
  doc.panels[1] = flange({ ref: "left", value: 4 }, 30, 60);
  assert.deepEqual(C.jointCoverage(A, doc.panels[1]), { overlap: 60, covered: true });
  assert.deepEqual(C.panelFrames(doc).get("B").o, [4, 30, 1]);
  assert.deepEqual(C.validate(doc), []);

  // The corner is solid: the flange's outer surface is the bend line (x = 4) and its 1 mm of
  // thickness lies inside the bend (x 4..5), overlapping A, which spans z 0..1. Nothing is missing
  // at the junction.
  const F = C.panelFrames(doc).get("B");
  const inner = C.toWorld(F, [0, 0, F.tdir * 1]), farEnd = C.toWorld(F, [0, 10, 0]);
  [[inner, [5, 30, 1]], [farEnd, [4, 30, -9]]].forEach(([got, want]) => got.forEach((v, i) => close(v, want[i], "corner")));

  doc.panels[1] = flange({ ref: "right", value: 18 }, 30, 60);
  assert.deepEqual(C.panelFrames(doc).get("B").o, [4, 30, 1]);

  // Bend line left at the cut-away outline: placed where the user said, and flagged loudly.
  doc.panels[1] = flange({ ref: "left", value: 0 }, 30, 60);
  assert.deepEqual(C.panelFrames(doc).get("B").o, [0, 30, 1]);
  assert.match(C.validate(doc)[0], /doesn't run along an edge/);

  // Partly over the cutout: reports how much is attached.
  doc.panels[1] = flange({ ref: "left", value: 4 }, 100, 20);
  assert.deepEqual(C.jointCoverage(A, doc.panels[1]), { overlap: 14, covered: false });
  assert.match(C.validate(doc)[0], /only 14\.00 mm of its 20\.00 mm/);
});

test("nothing is guessed: new joints and features start blank and aren't used until entered", () => {
  const doc = C.newDoc();
  Object.assign(doc, { name: "x" });
  Object.assign(doc.panels[0], { width: 50, height: 50, thickness: 1 });
  doc.panels.push(C.newPanel("B", C.newAttach()));
  Object.assign(doc.panels[1], { width: 10, height: 10, thickness: 1 });
  assert.equal(C.nextStep(doc).path, "p1.attach.parent");
  assert.equal(C.panelFrames(doc).has("B"), false);
  assert.ok(C.validate(doc).some((w) => /isn't fully entered/.test(w)));
  Object.assign(doc.panels[1].attach, { parent: "A", edge: "top", line: { ref: "top", value: 0 }, offset: 0, angle: 90 });
  assert.equal(C.nextStep(doc).path, "p1.attach.toward");
  doc.panels[1].attach.toward = "back";
  assert.equal(C.panelFrames(doc).has("B"), true);

  const angle = C.newAngle(), slot = C.newSlot();
  assert.equal(angle.toward, null);
  assert.ok([angle.p1.x, angle.p1.y, angle.p2.x, angle.p2.y].every((a) => a.value === null));
  assert.equal(slot.orient, null);
  assert.equal(slot.open, null);
  doc.panels[0].features.push(slot);
  assert.equal(C.nextStep(doc).path, "p0.f0.orient");
});

test("problems are loud: the drawing is stamped and OpenSCAD refuses to invent a thickness", () => {
  const doc = example("pcie-bracket.json");
  assert.ok(!C.toSVG(C.buildSheet(doc)).includes("NOT VERIFIED"));
  doc.panels[0].features[3].x.value = 17; // hole now breaks the edge
  assert.ok(C.toSVG(C.buildSheet(doc)).includes("NOT VERIFIED: 1 UNRESOLVED ISSUE."));
  doc.panels[1].thickness = null;
  assert.throws(() => C.toOpenSCAD(doc), /thickness of panel B/);
});

test("numbers on the drawing link back to the measurements behind them", () => {
  const sheet = C.buildSheet(example("pcie-bracket.json"));
  const linked = (path) => sheet.prims.filter((p) => p.t === "text" && (p.edits || []).some((e) => e.path === path));
  assert.equal(linked("p0.width")[0].s, "18.40");
  // Hole 4 is measured to its near side (7.6) but dimensioned to its center (9.20): the link
  // edits the measurement, not the derived number.
  assert.equal(linked("p0.f3.x.value")[0].s, "9.20");
  assert.equal(linked("p0.f3.diameter")[0].s, "2X Ø3.20 THRU");
  assert.ok(linked("p0.f4.diameter").length, "the shared callout links both holes");
  assert.ok(linked("p1.attach.angle").length, "the joint note links the bend angle");
  assert.ok(C.toSVG(sheet, { interactive: true }).includes('data-edits="'));
  assert.ok(!C.toSVG(sheet, { physical: true }).includes("data-edits"), "exports carry no links");
});

test("the section being edited is colored on screen only", () => {
  const sheet = C.buildSheet(example("pcie-bracket.json"));
  const colored = (svg) => (svg.match(/#e8590c/g) || []).length;
  assert.equal(colored(C.toSVG(sheet)), 0, "no highlight by default");
  assert.equal(colored(C.toSVG(sheet, { physical: true })), 0, "exports stay black");
  const hole = colored(C.toSVG(sheet, { highlight: "p0.f3" }));
  assert.ok(hole >= 10, `hole 4: outline, center marks, 2 dimensions, callout (${hole})`);
  assert.ok(colored(C.toSVG(sheet, { highlight: "p0.width" })) > 0, "overall width dimension");
  assert.ok(colored(C.toSVG(sheet, { highlight: "p1.attach" })) > 0, "joint marker and notes");
  assert.equal(colored(C.toSVG(sheet, { highlight: "p0.f30" })), 0, "no false prefix matches");
  assert.ok(!C.toDXF(sheet, "mm").includes("HILITE"), "highlight outlines stay out of DXF");
});

test("validation catches holes breaking an edge and faces overrunning their parent", () => {
  const doc = example("pcie-bracket.json");
  doc.panels[0].features[3].x.value = 17;
  doc.panels[1].width = 30;
  const w = C.validate(doc);
  assert.equal(w.length, 2);
});

test("nextStep walks through missing measurements in order", () => {
  const doc = C.newDoc();
  assert.equal(C.nextStep(doc).path, "name");
  doc.name = "x";
  assert.equal(C.nextStep(doc).path, "p0.width");
  Object.assign(doc.panels[0], { width: 10, height: 10, thickness: 1 });
  doc.panels[0].features.push(C.newHole());
  assert.equal(C.nextStep(doc).path, "p0.f0.diameter");
});
