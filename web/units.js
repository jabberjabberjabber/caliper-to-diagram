// Length parsing and formatting. Everything is stored in millimeters internally.
(function (C) {
  "use strict";

  const MM_PER = { mm: 1, cm: 10, in: 25.4 };
  C.MM_PER = MM_PER;
  C.UNITS = {
    mm: { name: "MILLIMETERS", decimals: 2 },
    in: { name: "INCHES", decimals: 3 },
  };

  function parseNumber(s) {
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
    // "3/8", "1 1/4", "1-1/4"
    const m = s.match(/^([-+]?)(?:(\d+)[\s-]+)?(\d+)\/(\d+)$/);
    if (m) {
      const den = parseInt(m[4], 10);
      if (den === 0) return null;
      const v = (m[2] ? parseInt(m[2], 10) : 0) + parseInt(m[3], 10) / den;
      return m[1] === "-" ? -v : v;
    }
    return null;
  }

  // Returns mm, null for an empty field, or NaN if the text can't be read.
  // Accepts an optional unit suffix that overrides the document unit: 12.7mm, 1/2in, 1/2"
  C.parseLength = function (text, unit) {
    let s = String(text).trim().toLowerCase();
    if (s === "") return null;
    let u = unit;
    const m = s.match(/(mm|cm|inches|inch|in|")$/);
    if (m) {
      u = m[1] === "mm" || m[1] === "cm" ? m[1] : "in";
      s = s.slice(0, -m[1].length).trim();
    }
    const v = parseNumber(s);
    return v === null ? NaN : v * MM_PER[u];
  };

  C.fmt = function (mm, unit, decimals) {
    if (mm == null || !isFinite(mm)) return "";
    // Nudge before rounding so conversion noise (3/16" -> 0.18749999...) still rounds half up.
    const v = mm / MM_PER[unit], p = 10 ** decimals;
    const s = (Math.round((v + Math.sign(v) * 1e-9) * p) / p).toFixed(decimals);
    return Number(s) === 0 ? (0).toFixed(decimals) : s;
  };

  // Drawing style: ASME Y14.5 drops the leading zero for inch values (.250), ISO keeps it for mm (0.50).
  C.fmtDim = function (mm, unit, decimals) {
    const s = C.fmt(mm, unit, decimals);
    return unit === "in" ? s.replace(/^(-?)0\./, "$1.") : s;
  };

  // Input fields show the stored value at full useful precision, without trailing zeros.
  C.fmtInput = function (mm, unit) {
    if (mm == null || !isFinite(mm)) return "";
    return String(Number((mm / MM_PER[unit]).toFixed(unit === "in" ? 5 : 4)));
  };
})((globalThis.C2D = globalThis.C2D || {}));
