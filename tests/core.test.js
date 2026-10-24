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
  const slot = { ...C.newSlot(), width: 4, length: 12, x: { ref: "left", value: 2, to: "near" }, y: { ref: "bottom", value: 5, to: "center" } };
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
  assert.deepEqual(F.o, [0, 112, 0]);
  // 90 deg toward the back of A: B's y axis points to -z.
  close(F.y[2], -1, "y.z");
  close(F.y[1], 0, "y.y");

  const fan = C.panelFrames(example("fan-stand.json"));
  close(fan.get("B").y[2], -1, "left leg goes back");
  close(fan.get("C").y[2], -1, "right leg goes back");
  assert.deepEqual(fan.get("C").o, [140, 0, 0]);
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
