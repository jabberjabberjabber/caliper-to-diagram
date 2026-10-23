// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const f of ["units.js", "model.js", "drawing.js", "export.js"]) require(path.join(__dirname, "..", "web", f));
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

test("outline: interior cutout is a second loop, corner notches reshape the outer loop", () => {
  const pcie = example("pcie-bracket.json").panels[0];
  const loops = C.panelOutline(pcie);
  assert.equal(loops.length, 2);
  const outer = loops.find((l) => l.length === 8); // two bottom corner notches -> 8 corners
  assert.ok(outer, "outer loop has 8 corners");
  const area = (l) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  const total = loops.reduce((s, l) => s + area(l), 0);
  close(total, 18.4 * 112 - 5.1 * 8 - 3.2 * 8 - 9 * 20, "net area");
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
    assert.ok(!/NaN|undefined/.test(scad));
  }
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
