// The editing UI: forms bound to the document model, live drawing preview, file I/O.
(function (C) {
  "use strict";

  const STORE = "caliper-to-diagram.doc";
  const $ = (s) => document.querySelector(s);
  let doc = load();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (d && d.version === 1 && Array.isArray(d.panels)) return C.upgradeDoc(d);
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

  // A blank field is "not measured", never 0.
  function numInput(obj, key, path, help) {
    const el = h("input", { type: "text", inputmode: "decimal", class: "num", "data-path": path, "data-help": help, value: obj[key] ?? "" });
    el.classList.toggle("empty", obj[key] == null);
    el.addEventListener("input", () => {
      const t = el.value.trim(), v = t === "" ? null : Number(t);
      const bad = v !== null && !isFinite(v);
      el.classList.toggle("bad", bad);
      if (bad) return;
      obj[key] = v;
      el.classList.toggle("empty", v == null);
      changed();
    });
    return el;
  }

  function textInput(obj, key, attrs) {
    const el = h("input", { type: "text", ...attrs });
    el.value = obj[key] || "";
    el.addEventListener("input", () => { obj[key] = el.value; changed(); });
    return el;
  }

  // Selects for values the user hasn't chosen yet show "choose…" instead of guessing an answer.
  // Once something is picked the form is rebuilt, since other fields often depend on the choice.
  function sel(obj, key, options, help, after, path) {
    const unset = obj[key] == null;
    const opts = unset ? [["", "choose…"], ...options] : options;
    const el = h("select", { "data-help": help, "data-path": path, class: unset ? "empty" : null },
      opts.map(([v, l]) => h("option", { value: v, selected: unset ? v === "" : obj[key] === v }, l)));
    el.addEventListener("change", () => {
      if (el.value === "") return;
      obj[key] = el.value;
      (after || (unset ? renderAll : changed))();
    });
    return el;
  }

  function boolSel(obj, key, [offLabel, onLabel], help, after, path) {
    const unset = obj[key] == null;
    const el = h("select", { "data-help": help, "data-path": path, class: unset ? "empty" : null },
      unset ? h("option", { value: "", selected: true }, "choose…") : null,
      h("option", { value: "false", selected: obj[key] === false }, offLabel),
      h("option", { value: "true", selected: obj[key] === true }, onLabel));
    el.addEventListener("change", () => {
      if (el.value === "") return;
      obj[key] = el.value === "true";
      (after || renderAll)();
    });
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
        h("button", { onclick: () => addFeature(p, i, C.newSlot(), "orient") }, "+ Slot"),
        h("button", { onclick: () => addFeature(p, i, C.newCutout(), "width") }, "+ Rectangular cutout / notch"),
        h("button", { onclick: () => addFeature(p, i, C.newAngle(), "toward") }, "+ Angled edge")));
  }

  function attachRow(p, i) {
    const a = p.attach, path = (k) => `p${i}.attach.${k}`, other = a.parent || "…";
    const parents = doc.panels.filter((q) => !C.isDescendant(doc, q, p));
    // Changing the side can make the bend line's reference edge meaningless; then it must be re-measured.
    const edgeChanged = () => {
      if (!C.bendRefs(a.edge).includes(a.line.ref)) a.line = { ref: a.edge, value: null };
      renderAll();
    };
    return h("div", { class: "attach", "data-tag": `p${i}.attach` },
      "Joined to panel ",
      sel(a, "parent", parents.map((q) => [q.id, q.id + (q.name ? ` (${q.name})` : "")]), "attachParent", renderAll, path("parent")),
      " along its ",
      sel(a, "edge", [["top", "top"], ["bottom", "bottom"], ["left", "left"], ["right", "right"]], "attachEdge", edgeChanged, path("edge")),
      " side.",
      a.edge ? [
        h("br"), "Bend line: ", lenInput(a.line, "value", path("line.value"), "attachLine"),
        " from the ", sel(a.line, "ref", C.bendRefs(a.edge).map((r) => [r, r]), "attachLine", null, path("line.ref")),
        ` edge of panel ${other}.`,
        h("br"), "This face starts ", lenInput(a, "offset", path("offset"), "attachOffset"),
        ` along that side, from its ${C.edgeStartName(a.edge)} end.`,
      ] : null,
      h("br"), "Bent ", numInput(a, "angle", path("angle"), "attachAngle"), "° toward the ",
      sel(a, "toward", [["back", "back"], ["front", "front"]], "attachToward", null, path("toward")),
      ` of panel ${other}.`);
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
        "slot ", sel(f, "orient", [["h", "horizontal"], ["v", "vertical"]], "slotShape", renderAll, `${base}.orient`), " ",
        boolSel(f, "open", ["closed", "open to edge"], "slotShape", renderAll, `${base}.open`),
      ];
      if (f.orient != null && f.open != null)
        size.push(h("br"), len(f, "width", "width", "slotSize"), " wide", h("br"),
          len(f, "length", "length", "slotSize"), f.open ? " deep" : " long");
      cell = (ax) => f.orient == null || f.open == null
        ? h("span", { class: "hint" }, "choose the slot type first")
        : ax === along && f.open
          ? ["opens to the ", sel(f[ax], "ref", REFS[ax], "slotOpen"), " edge"]
          : [fromEdge(f[ax], ax, `${ax}.value`, "slotPos"), h("br"), toSel(f[ax], "slotPos", ax === along ? "near end" : "near side")];
    } else {
      size = ["angled edge", h("br"), "cut off toward the ", h("br"),
        sel(f, "toward", Object.keys(C.TOWARD).map((k) => [k, k.replace("-", " ")]), "angleToward", null, `${base}.toward`)];
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
    closeEditor();
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

  function selectSection(tag, scroll) {
    document.querySelectorAll(".editing").forEach((el) => el.classList.remove("editing"));
    const section = tag && document.querySelector(`#panels [data-tag="${tag}"]`);
    if (section) {
      section.classList.add("editing");
      if (scroll) section.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (tag !== activeTag) {
      activeTag = tag;
      drawPreview();
    }
  }

  // ---- Drawing pane: zoom, pan, and editing numbers in place --------------------------------

  let view = null; // visible region in SVG units; null fits the whole sheet
  let sheetBox = null; // the whole sheet, in SVG units
  const svgEl = () => $("#drawing svg");

  function drawPreview() {
    $("#drawing").innerHTML = C.toSVG(C.buildSheet(doc), { highlight: activeTag, interactive: true });
    const [x, y, w, h] = svgEl().getAttribute("viewBox").split(" ").map(Number);
    sheetBox = { x, y, w, h };
    applyView();
  }

  function applyView() {
    const b = view || sheetBox;
    svgEl().setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  }

  // What is on screen now, in SVG units. A fitted sheet is centered with margins to fill the pane.
  function visibleBox() {
    if (view) return view;
    const r = $("#drawing").getBoundingClientRect(), b = sheetBox;
    const s = Math.max(b.w / r.width, b.h / r.height), w = r.width * s, h = r.height * s;
    return { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h };
  }

  function zoomAt(factor, clientX, clientY) {
    const b = visibleBox(), p = new DOMPoint(clientX, clientY).matrixTransform(svgEl().getScreenCTM().inverse());
    const w = b.w * factor;
    if (w < sheetBox.w * 0.02 || w > Math.max(sheetBox.w, sheetBox.h) * 4) return;
    view = { x: p.x - (p.x - b.x) * factor, y: p.y - (p.y - b.y) * factor, w, h: b.h * factor };
    applyView();
  }

  function zoomCenter(factor) {
    const r = $("#drawing").getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  // Clicking a number on the drawing opens the measurement(s) behind it. They are edited exactly as
  // in the form (a hole dimensioned to its center but measured to its near side shows the near-side
  // value), and the form fields follow along.
  let editor = null;

  function closeEditor() {
    if (editor) editor.remove();
    editor = null;
  }

  // "p0.f3.x.value" -> the object and key that hold that measurement.
  function resolvePath(path) {
    const parts = path.split(".");
    let obj = doc;
    for (const part of parts.slice(0, -1)) {
      const m = part.match(/^([pf])(\d+)$/);
      obj = m ? (m[1] === "p" ? obj.panels : obj.features)[Number(m[2])] : obj[part];
      if (!obj) return null;
    }
    return { obj, key: parts[parts.length - 1] };
  }

  const sectionOf = (path) => {
    const m = path.match(/^(p\d+)\.(f\d+|attach|width|height|thickness|name)/);
    return m ? `${m[1]}.${m[2]}` : null;
  };

  function editorInput({ obj, key }, ed) {
    const isLen = ed.kind === "len";
    const show = (v) => (isLen ? C.fmtInput(v, doc.units) : v ?? "");
    const el = h("input", { type: "text", inputmode: "decimal", class: isLen ? "len" : "num" });
    el.value = show(obj[key]);
    el.addEventListener("input", () => {
      const t = el.value.trim();
      const v = isLen ? C.parseLength(t, doc.units) : t === "" ? null : Number(t);
      const bad = v !== null && !isFinite(v);
      el.classList.toggle("bad", bad);
      if (bad) return;
      obj[key] = v;
      const field = document.querySelector(`#panels [data-path="${ed.path}"]`);
      if (field) {
        field.value = show(v);
        field.classList.toggle("empty", v == null);
        field.classList.remove("bad");
      }
      changed();
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") closeEditor(); });
    return el;
  }

  function openEditor(edits, clientX, clientY) {
    closeEditor();
    const rows = edits
      .map((ed) => { const r = resolvePath(ed.path); return r && h("label", {}, h("span", {}, ed.label), editorInput(r, ed)); })
      .filter(Boolean);
    if (!rows.length) return;
    editor = h("div", { class: "dim-editor" },
      h("div", { class: "dim-editor-head" },
        h("span", {}, edits.length > 1 ? "Measurements behind this number" : "Measurement behind this number"),
        h("button", { class: "icon", title: "Close (Esc)", onclick: closeEditor }, "✕")),
      rows,
      h("div", { class: "hint" }, "Changes go straight into the form. Enter or Esc closes this."));
    const wrap = $("#drawing-wrap"), r = wrap.getBoundingClientRect();
    wrap.append(editor);
    const x = Math.min(clientX - r.left + 10, r.width - editor.offsetWidth - 4);
    const y = Math.min(clientY - r.top + 10, r.height - editor.offsetHeight - 4);
    editor.style.left = `${Math.max(4, x)}px`;
    editor.style.top = `${Math.max(4, y)}px`;
    selectSection(sectionOf(edits[0].path), true);
    const first = editor.querySelector("input");
    first.focus();
    first.select();
  }

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
    renderAll();
  });
  $("#decimals").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (v >= 0 && v <= 4) { doc.decimals = v; changed(); }
  });

  $("#btn-add-panel").addEventListener("click", () => {
    const p = C.newPanel(C.nextPanelId(doc), C.newAttach());
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
      doc = C.upgradeDoc(d);
      renderAll();
    } catch (err) {
      alert(`Could not open ${file.name}: ${err.message}`);
    }
  });
  $("#btn-svg").addEventListener("click", () => download(C.toSVG(C.buildSheet(doc), { physical: true }), "svg", "image/svg+xml"));
  $("#btn-dxf").addEventListener("click", () => download(C.toDXF(C.buildSheet(doc), doc.units), "dxf", "application/dxf"));
  $("#btn-scad").addEventListener("click", () => {
    let scad;
    try { scad = C.toOpenSCAD(doc); } catch (err) { alert(`Can't export OpenSCAD yet: ${err.message}`); return; }
    download(scad, "scad", "text/plain");
  });
  $("#btn-print").addEventListener("click", () => window.print());
  window.addEventListener("beforeprint", () => { $("#drawing").innerHTML = C.toSVG(C.buildSheet(doc), { physical: true }); });
  window.addEventListener("afterprint", refresh);

  document.addEventListener("focusin", (e) => {
    if (editor && editor.contains(e.target)) return; // editing from the drawing keeps its section
    if (e.target.dataset && e.target.dataset.help) showHelp(e.target.dataset.help);
    const section = e.target.closest && e.target.closest("[data-tag]");
    selectSection(section ? section.dataset.tag : null, false);
  });

  const pane = $("#drawing");
  pane.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  let pan = null;
  pane.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".editable")) return;
    const m = svgEl().getScreenCTM();
    pan = { x: e.clientX, y: e.clientY, box: visibleBox(), sx: m.a, sy: m.d, moved: false };
    pane.setPointerCapture(e.pointerId);
  });
  pane.addEventListener("pointermove", (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    pan.moved = true;
    pane.classList.add("panning");
    view = { ...pan.box, x: pan.box.x - dx / pan.sx, y: pan.box.y - dy / pan.sy };
    applyView();
  });
  const endPan = () => { pan = null; pane.classList.remove("panning"); };
  pane.addEventListener("pointerup", endPan);
  pane.addEventListener("pointercancel", endPan);
  pane.addEventListener("click", (e) => {
    const t = e.target.closest(".editable");
    if (t) openEditor(JSON.parse(t.dataset.edits), e.clientX, e.clientY);
  });
  document.addEventListener("pointerdown", (e) => {
    if (editor && !editor.contains(e.target) && !e.target.closest(".editable")) closeEditor();
  }, true);
  $("#zoom-in").addEventListener("click", () => zoomCenter(1 / 1.3));
  $("#zoom-out").addEventListener("click", () => zoomCenter(1.3));
  $("#zoom-fit").addEventListener("click", () => { view = null; applyView(); });

  showHelp("default");
  renderAll();
})((globalThis.C2D = globalThis.C2D || {}));
