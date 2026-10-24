// The editing UI: forms bound to the document model, live drawing preview, file I/O.
(function (C) {
  "use strict";

  const STORE = "caliper-to-diagram.doc";
  const $ = (s) => document.querySelector(s);
  let doc = load();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (d && d.version === 1 && Array.isArray(d.panels)) return d;
    } catch (e) { /* fall through to a new document */ }
    return C.newDoc();
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid);
    return el;
  }

  // ---- Bound inputs -------------------------------------------------------------------------

  function lenInput(obj, key, path, help) {
    const el = h("input", { type: "text", inputmode: "decimal", class: "len", "data-path": path, "data-help": help });
    const show = () => {
      el.value = C.fmtInput(obj[key], doc.units);
      el.classList.toggle("empty", obj[key] == null);
    };
    show();
    el.addEventListener("input", () => {
      const v = C.parseLength(el.value, doc.units);
      el.classList.toggle("bad", Number.isNaN(v));
      if (Number.isNaN(v)) return;
      obj[key] = v;
      el.classList.toggle("empty", v == null);
      changed();
    });
    el.addEventListener("change", () => { if (!el.classList.contains("bad")) show(); });
    return el;
  }

  function numInput(obj, key, path, help) {
    const el = h("input", { type: "text", inputmode: "decimal", class: "num", "data-path": path, "data-help": help, value: obj[key] ?? "" });
    el.addEventListener("input", () => {
      const v = el.value.trim() === "" ? 0 : Number(el.value);
      el.classList.toggle("bad", !isFinite(v));
      if (isFinite(v)) { obj[key] = v; changed(); }
    });
    return el;
  }

  function textInput(obj, key, attrs) {
    const el = h("input", { type: "text", ...attrs });
    el.value = obj[key] || "";
    el.addEventListener("input", () => { obj[key] = el.value; changed(); });
    return el;
  }

  function sel(obj, key, options, help, after) {
    const el = h("select", { "data-help": help }, options.map(([v, l]) => h("option", { value: v, selected: obj[key] === v }, l)));
    el.addEventListener("change", () => { obj[key] = el.value; (after || changed)(); });
    return el;
  }

  function boolSel(obj, key, [offLabel, onLabel], help, after) {
    const el = h("select", { "data-help": help },
      h("option", { value: "false", selected: !obj[key] }, offLabel),
      h("option", { value: "true", selected: !!obj[key] }, onLabel));
    el.addEventListener("change", () => { obj[key] = el.value === "true"; (after || changed)(); });
    return el;
  }

  // ---- Panels -------------------------------------------------------------------------------

  function panelCard(p, i) {
    return h("section", { class: "panel" },
      h("header", {},
        h("h2", {}, `Panel ${p.id}`),
        textInput(p, "name", { placeholder: "name, e.g. top tab", "data-help": "default", "data-tag": `p${i}.name` }),
        p.attach ? h("button", { class: "danger", onclick: () => removePanel(p) }, "Remove") : null),
      h("div", { class: "dims" },
        h("label", { "data-tag": `p${i}.width` }, "Width (left ↔ right)", lenInput(p, "width", `p${i}.width`, "width")),
        h("label", { "data-tag": `p${i}.height` }, "Height (bottom ↕ top)", lenInput(p, "height", `p${i}.height`, "height")),
        h("label", { "data-tag": `p${i}.thickness` }, "Thickness", lenInput(p, "thickness", `p${i}.thickness`, "thickness"))),
      p.attach ? attachRow(p, i)
        : h("p", { class: "hint" }, "Reference face. Datum edges: LEFT and BOTTOM. Measure positions from these unless a feature is much closer to the opposite edge."),
      featureTable(p, i),
      h("div", { class: "actions" },
        h("button", { onclick: () => addFeature(p, i, C.newHole(), "diameter") }, "+ Hole"),
        h("button", { onclick: () => addFeature(p, i, C.newSlot(), "width") }, "+ Slot"),
        h("button", { onclick: () => addFeature(p, i, C.newCutout(), "width") }, "+ Rectangular cutout / notch"),
        h("button", { onclick: () => addFeature(p, i, C.newAngle(), "p1.x.value") }, "+ Angled edge")));
  }

  function attachRow(p, i) {
    const a = p.attach;
    const parents = doc.panels.filter((q) => !C.isDescendant(doc, q, p));
    return h("div", { class: "attach", "data-tag": `p${i}.attach` },
      "Joined to panel ",
      sel(a, "parent", parents.map((q) => [q.id, q.id + (q.name ? ` (${q.name})` : "")]), "attachParent", renderAll),
      " along its ",
      sel(a, "edge", [["top", "top"], ["bottom", "bottom"], ["left", "left"], ["right", "right"]], "attachEdge", renderAll),
      " edge, starting ",
      lenInput(a, "offset", `p${i}.attach.offset`, "attachOffset"),
      ` from that edge's ${C.edgeStartName(a.edge)} end. Bent `,
      numInput(a, "angle", `p${i}.attach.angle`, "attachAngle"),
      "° toward the ",
      sel(a, "toward", [["back", "back"], ["front", "front"]], "attachToward"),
      ` of panel ${a.parent}.`);
  }

  function featureTable(p, i) {
    if (!p.features.length) return h("p", { class: "hint" }, "No holes or cutouts yet.");
    return h("table", { class: "features" },
      h("thead", {}, h("tr", {},
        h("th", {}, "#"), h("th", {}, "Size"), h("th", {}, "Horizontal position"), h("th", {}, "Vertical position"))),
      h("tbody", {}, p.features.map((f, j) => featureRow(p, i, f, j))));
  }

  const REFS = { x: [["left", "left"], ["right", "right"]], y: [["bottom", "bottom"], ["top", "top"]] };

  function featureRow(p, i, f, j) {
    const base = `p${i}.f${j}`;
    const len = (obj, key, path, help) => lenInput(obj, key, `${base}.${path}`, help);
    const fromEdge = (a, ax, path, help) => ["from ", sel(a, "ref", REFS[ax], help), " ", len(a, "value", path, help)];
    const toSel = (a, help, nearLabel) => ["to ", sel(a, "to", [["near", nearLabel], ["center", "center"]], help)];
    let size, cell;
    if (f.type === "hole") {
      size = ["hole Ø ", len(f, "diameter", "diameter", "holeDia")];
      cell = (ax) => [fromEdge(f[ax], ax, `${ax}.value`, "holePos"), h("br"), toSel(f[ax], "holeTo", "near side")];
    } else if (f.type === "cutout") {
      size = ["cutout ", len(f, "width", "width", "cutSize"), " × ", len(f, "height", "height", "cutSize")];
      cell = (ax) => [fromEdge(f[ax], ax, `${ax}.value`, "cutPos"), h("br"), "to near edge"];
    } else if (f.type === "slot") {
      const along = f.orient === "h" ? "x" : "y";
      size = [
        "slot ", len(f, "width", "width", "slotSize"), " wide", h("br"),
        len(f, "length", "length", "slotSize"), f.open ? " deep" : " long", h("br"),
        sel(f, "orient", [["h", "horizontal"], ["v", "vertical"]], "slotShape", renderAll), " ",
        boolSel(f, "open", ["closed", "open to edge"], "slotShape", renderAll),
      ];
      cell = (ax) => ax === along && f.open
        ? ["opens to the ", sel(f[ax], "ref", REFS[ax], "slotOpen"), " edge"]
        : [fromEdge(f[ax], ax, `${ax}.value`, "slotPos"), h("br"), toSel(f[ax], "slotPos", ax === along ? "near end" : "near side")];
    } else {
      size = ["angled edge", h("br"), "cut off toward the ", h("br"),
        sel(f, "toward", Object.keys(C.TOWARD).map((k) => [k, k.replace("-", " ")]), "angleToward")];
      cell = (ax) => ["p1", "p2"].map((k, n) => [n ? h("br") : null, `end ${n + 1} `, fromEdge(f[k][ax], ax, `${k}.${ax}.value`, "anglePoint")]);
    }
    return h("tr", { "data-tag": base },
      h("td", { class: "num" }, j + 1, h("br"),
        h("button", { class: "icon", title: "Duplicate (handy for hole patterns)", onclick: () => duplicateFeature(p, i, j) }, "⧉"), h("br"),
        h("button", { class: "icon danger", title: "Delete", onclick: () => { p.features.splice(j, 1); renderAll(); } }, "✕")),
      h("td", { class: "size" }, size),
      h("td", { class: "pos" }, cell("x")),
      h("td", { class: "pos" }, cell("y")));
  }

  function addFeature(p, i, f, firstField) {
    p.features.push(f);
    renderAll();
    focusPath(`p${i}.f${p.features.length - 1}.${firstField}`);
  }

  function duplicateFeature(p, i, j) {
    p.features.splice(j + 1, 0, JSON.parse(JSON.stringify(p.features[j])));
    renderAll();
    const first = document.querySelector(`[data-path^="p${i}.f${j + 1}."]`);
    if (first) focusPath(first.dataset.path);
  }

  function removePanel(p) {
    const doomed = doc.panels.filter((q) => C.isDescendant(doc, q, p));
    const msg = doomed.length > 1
      ? `Remove panel ${p.id} and the faces joined to it (${doomed.filter((q) => q !== p).map((q) => q.id).join(", ")})?`
      : `Remove panel ${p.id}?`;
    if (!confirm(msg)) return;
    doc.panels = doc.panels.filter((q) => !doomed.includes(q));
    renderAll();
  }

  function focusPath(path) {
    const el = document.querySelector(`[data-path="${path}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
    if (el.select) el.select();
  }

  // ---- Rendering ----------------------------------------------------------------------------

  function renderAll() {
    $("#part-name").value = doc.name;
    $("#units").value = doc.units;
    $("#decimals").value = doc.decimals;
    $("#notes").value = doc.notes;
    $("#view").value = doc.view;
    $("#panels").replaceChildren(...doc.panels.map(panelCard));
    const section = activeTag && document.querySelector(`[data-tag="${activeTag}"]`);
    if (section) section.classList.add("editing");
    refresh();
  }

  function changed() { refresh(); }

  function refresh() {
    localStorage.setItem(STORE, JSON.stringify(doc));
    drawPreview();
    $("#warnings").replaceChildren(...C.validate(doc).map((w) => h("li", {}, w)));
    const step = C.nextStep(doc);
    $("#next").replaceChildren(step.path
      ? h("button", { class: "link", onclick: () => focusPath(step.path) }, "Next: " + step.text)
      : h("span", {}, "Done: " + step.text));
  }

  // The form section being edited ("p0.f3", "p1.attach", ...): its dimensions are colored in the preview.
  let activeTag = null;
  function drawPreview() { $("#drawing").innerHTML = C.toSVG(C.buildSheet(doc), { highlight: activeTag }); }

  function showHelp(key) { $("#help").innerHTML = C.HELP[key] || C.HELP.default; }

  // ---- Files --------------------------------------------------------------------------------

  const baseName = () => (doc.name || "part").trim().replace(/[^\w.-]+/g, "_");

  function download(text, ext, type) {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: `${baseName()}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- Wiring -------------------------------------------------------------------------------

  $("#part-name").addEventListener("input", (e) => { doc.name = e.target.value; changed(); });
  $("#notes").addEventListener("input", (e) => { doc.notes = e.target.value; changed(); });
  $("#view").addEventListener("change", (e) => { doc.view = e.target.value; changed(); });
  $("#units").addEventListener("change", (e) => {
    doc.units = e.target.value;
    doc.decimals = C.UNITS[doc.units].decimals;
    renderAll();
  });
  $("#decimals").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (v >= 0 && v <= 4) { doc.decimals = v; changed(); }
  });

  $("#btn-add-panel").addEventListener("click", () => {
    const p = C.newPanel(C.nextPanelId(doc), C.newAttach(doc.panels[0].id));
    doc.panels.push(p);
    renderAll();
    focusPath(`p${doc.panels.length - 1}.width`);
  });

  $("#btn-new").addEventListener("click", () => {
    if (confirm("Start a new part? Unsaved measurements will be lost (use Save first to keep them).")) {
      doc = C.newDoc();
      renderAll();
    }
  });
  $("#btn-save").addEventListener("click", () => download(JSON.stringify(doc, null, 2), "json", "application/json"));
  $("#btn-open").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d || d.version !== 1 || !Array.isArray(d.panels)) throw new Error("not a caliper-to-diagram file");
      doc = d;
      renderAll();
    } catch (err) {
      alert(`Could not open ${file.name}: ${err.message}`);
    }
  });
  $("#btn-svg").addEventListener("click", () => download(C.toSVG(C.buildSheet(doc), { physical: true }), "svg", "image/svg+xml"));
  $("#btn-dxf").addEventListener("click", () => download(C.toDXF(C.buildSheet(doc), doc.units), "dxf", "application/dxf"));
  $("#btn-scad").addEventListener("click", () => download(C.toOpenSCAD(doc), "scad", "text/plain"));
  $("#btn-print").addEventListener("click", () => window.print());
  window.addEventListener("beforeprint", () => { $("#drawing").innerHTML = C.toSVG(C.buildSheet(doc), { physical: true }); });
  window.addEventListener("afterprint", refresh);

  document.addEventListener("focusin", (e) => {
    if (e.target.dataset && e.target.dataset.help) showHelp(e.target.dataset.help);
    const section = e.target.closest && e.target.closest("[data-tag]");
    const tag = section ? section.dataset.tag : null;
    if (tag !== activeTag) {
      document.querySelectorAll(".editing").forEach((el) => el.classList.remove("editing"));
      if (section) section.classList.add("editing");
      activeTag = tag;
      drawPreview();
    }
  });

  showHelp("default");
  renderAll();
})((globalThis.C2D = globalThis.C2D || {}));
