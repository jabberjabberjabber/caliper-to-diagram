// 2D geometry: the outline of a panel after its cutters (holes, slots, cutouts, angled cuts)
// are removed, as exact line and arc pieces.
//
// Method: every boundary element of every shape is split wherever it meets another shape, and a
// piece is kept when there is material on exactly one side of it. That handles notches, open
// slots and holes that run off an edge without a general polygon-clipping library, and keeps arcs
// as true arcs for DXF.
//
// Shapes:   {kind:"poly", pts:[[x,y],...]}   {kind:"circle", c:[x,y], r}   {kind:"stadium", a, b, r}
// Pieces:   {t:"line", a, b}                 {t:"arc", c, r, a0, a1}  (radians, counter-clockwise, a1 > a0)
(function (C) {
  "use strict";

  const TAU = 2 * Math.PI, EPS = 1e-9, PROBE = 1e-4;
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
  const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const angleOf = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);

  function distToSeg(p, a, b) {
    const d = sub(b, a), L2 = dot(d, d);
    const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)) : 0;
    return dist(p, [a[0] + d[0] * t, a[1] + d[1] * t]);
  }

  function contains(s, p) {
    if (s.kind === "circle") return dist(p, s.c) < s.r;
    if (s.kind === "stadium") return distToSeg(p, s.a, s.b) < s.r;
    let inside = false;
    for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
      const [xi, yi] = s.pts[i], [xj, yj] = s.pts[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function elements(s) {
    if (s.kind === "circle") return [{ t: "arc", c: s.c, r: s.r, a0: 0, a1: TAU }];
    if (s.kind === "stadium") {
      const d = sub(s.b, s.a), L = Math.hypot(...d);
      if (L < 1e-9) return [{ t: "arc", c: s.a, r: s.r, a0: 0, a1: TAU }];
      const n = [(-d[1] / L) * s.r, (d[0] / L) * s.r], ang = Math.atan2(d[1], d[0]);
      return [
        { t: "line", a: sub(s.a, n), b: sub(s.b, n) },
        { t: "arc", c: s.b, r: s.r, a0: ang - Math.PI / 2, a1: ang + Math.PI / 2 },
        { t: "line", a: [s.b[0] + n[0], s.b[1] + n[1]], b: [s.a[0] + n[0], s.a[1] + n[1]] },
        { t: "arc", c: s.a, r: s.r, a0: ang + Math.PI / 2, a1: ang + (3 * Math.PI) / 2 },
      ];
    }
    return s.pts
      .map((p, i) => ({ t: "line", a: p, b: s.pts[(i + 1) % s.pts.length] }))
      .filter((e) => dist(e.a, e.b) > 1e-9);
  }

  const at = (e, u) =>
    e.t === "line"
      ? [e.a[0] + (e.b[0] - e.a[0]) * u, e.a[1] + (e.b[1] - e.a[1]) * u]
      : [e.c[0] + e.r * Math.cos(u), e.c[1] + e.r * Math.sin(u)];

  // Angle th expressed inside the arc's sweep, or null if it isn't on the arc.
  function arcParam(e, th) {
    const u = e.a0 + ((((th - e.a0) % TAU) + TAU) % TAU);
    if (u <= e.a1 + EPS) return u;
    return u - TAU > e.a0 - EPS ? e.a0 : null; // just below a0 through rounding
  }

  const in01 = (t) => t >= -EPS && t <= 1 + EPS;

  // Parameters t along line e where it crosses the circle (c, r).
  function lineCircle(e, c, r) {
    const d = sub(e.b, e.a), f = sub(e.a, c);
    const A = dot(d, d), B = 2 * dot(f, d), K = dot(f, f) - r * r, disc = B * B - 4 * A * K;
    if (disc < -1e-12) return [];
    const s = Math.sqrt(Math.max(0, disc));
    return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
  }

  // Parameters on e where it meets f (crossings, touches, and ends of overlapping runs).
  function cuts(e, f) {
    if (e.t === "line" && f.t === "line") {
      const r = sub(e.b, e.a), s = sub(f.b, f.a), q = sub(f.a, e.a), den = cross(r, s);
      if (Math.abs(den) < 1e-12 * Math.hypot(...r) * Math.hypot(...s)) {
        if (Math.abs(cross(q, r)) / Math.hypot(...r) > 1e-7) return []; // parallel, not collinear
        return [f.a, f.b].map((p) => dot(sub(p, e.a), r) / dot(r, r)).filter(in01);
      }
      const t = cross(q, s) / den, u = cross(q, r) / den;
      return in01(t) && in01(u) ? [t] : [];
    }
    if (e.t === "line")
      return lineCircle(e, f.c, f.r).filter((t) => in01(t) && arcParam(f, angleOf(f.c, at(e, t))) !== null);
    if (f.t === "line")
      return lineCircle(f, e.c, e.r)
        .filter(in01)
        .map((t) => arcParam(e, angleOf(e.c, at(f, t))))
        .filter((u) => u !== null);
    const d = dist(e.c, f.c);
    if (d < 1e-9 && Math.abs(e.r - f.r) < 1e-9)
      return [f.a0, f.a1].map((th) => arcParam(e, th)).filter((u) => u !== null);
    if (d < 1e-12 || d > e.r + f.r + 1e-9 || d < Math.abs(e.r - f.r) - 1e-9) return [];
    const a = (d * d + e.r * e.r - f.r * f.r) / (2 * d), h = Math.sqrt(Math.max(0, e.r * e.r - a * a));
    const ux = (f.c[0] - e.c[0]) / d, uy = (f.c[1] - e.c[1]) / d, mx = e.c[0] + a * ux, my = e.c[1] + a * uy;
    return [[mx - h * uy, my + h * ux], [mx + h * uy, my - h * ux]]
      .filter((p) => arcParam(f, angleOf(f.c, p)) !== null)
      .map((p) => arcParam(e, angleOf(e.c, p)))
      .filter((u) => u !== null);
  }

  C.pieceLength = (pc) => (pc.t === "line" ? dist(pc.a, pc.b) : pc.r * (pc.a1 - pc.a0));
  const pieceEnds = (pc) => (pc.t === "line" ? [pc.a, pc.b] : [at(pc, pc.a0), at(pc, pc.a1)]);

  // Join pieces that continue each other (same line or same circle) at a point no other piece touches.
  function merge(pieces) {
    const key = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
    for (let changed = true; changed; ) {
      changed = false;
      const degree = new Map();
      for (const pc of pieces) for (const q of pieceEnds(pc)) degree.set(key(q), (degree.get(key(q)) || 0) + 1);
      const lonely = (p) => degree.get(key(p)) === 2;
      search: for (let i = 0; i < pieces.length; i++)
        for (let j = i + 1; j < pieces.length; j++) {
          const m = join(pieces[i], pieces[j], key, lonely);
          if (m) {
            pieces[i] = m;
            pieces.splice(j, 1);
            changed = true;
            break search;
          }
        }
    }
    return pieces;
  }

  function join(p, q, key, lonely) {
    if (p.t !== q.t) return null;
    if (p.t === "line") {
      const dp = sub(p.b, p.a), dq = sub(q.b, q.a);
      if (Math.abs(cross(dp, dq)) > 1e-9 * Math.hypot(...dp) * Math.hypot(...dq)) return null;
      for (const [s, ps] of [[p.a, p.b], [p.b, p.a]])
        for (const [t, qs] of [[q.a, q.b], [q.b, q.a]])
          if (key(s) === key(t) && lonely(s) && dot(sub(ps, s), sub(qs, s)) < 0) return { t: "line", a: ps, b: qs };
      return null;
    }
    if (dist(p.c, q.c) > 1e-7 || Math.abs(p.r - q.r) > 1e-7) return null;
    const sweep = p.a1 - p.a0 + (q.a1 - q.a0);
    if (sweep > TAU + 1e-9) return null;
    const close = (x, y) => Math.abs(((((x - y) % TAU) + TAU + Math.PI) % TAU) - Math.PI) < 1e-9;
    if (close(p.a1, q.a0) && lonely(at(p, p.a1))) return { t: "arc", c: p.c, r: p.r, a0: p.a0, a1: p.a0 + sweep };
    if (close(q.a1, p.a0) && lonely(at(q, q.a1))) return { t: "arc", c: p.c, r: p.r, a0: q.a0, a1: q.a0 + sweep };
    return null;
  }

  C.inMaterial = (outer, cutters, p) => contains(outer, p) && !cutters.some((s) => contains(s, p));

  C.boundary = function (outer, cutters) {
    const shapes = [outer, ...cutters];
    const els = shapes.map(elements);
    const material = (p) => C.inMaterial(outer, cutters, p);
    const pieces = [], seen = new Set();
    els.forEach((list, si) =>
      list.forEach((e) => {
        const ps = e.t === "line" ? [0, 1] : [e.a0, e.a1];
        els.forEach((other, sj) => { if (sj !== si) for (const f of other) ps.push(...cuts(e, f)); });
        const lo = ps[0], hi = ps[1];
        const us = ps.map((u) => Math.min(Math.max(u, lo), hi)).sort((x, y) => x - y);
        for (let k = 0; k + 1 < us.length; k++) {
          const u0 = us[k], u1 = us[k + 1];
          const pc = e.t === "line" ? { t: "line", a: at(e, u0), b: at(e, u1) } : { t: "arc", c: e.c, r: e.r, a0: u0, a1: u1 };
          if (C.pieceLength(pc) < 1e-6) continue;
          const um = (u0 + u1) / 2, m = at(e, um);
          let n;
          if (e.t === "line") {
            const d = sub(e.b, e.a), L = Math.hypot(...d);
            n = [-d[1] / L, d[0] / L];
          } else n = [Math.cos(um), Math.sin(um)];
          const plus = material([m[0] + n[0] * PROBE, m[1] + n[1] * PROBE]);
          const minus = material([m[0] - n[0] * PROBE, m[1] - n[1] * PROBE]);
          if (plus === minus) continue;
          // Coincident edges from two shapes would otherwise be drawn (and laser-cut) twice.
          const k2 = [m[0], m[1]].map((v) => Math.round(v * 1e5)).join(",") + "|" + Math.round(C.pieceLength(pc) * 1e5);
          if (seen.has(k2)) continue;
          seen.add(k2);
          pieces.push(pc);
        }
      })
    );
    return merge(pieces);
  };

  // Polygon approximation of a shape (for fills and the 3D preview).
  C.shapePolygon = function (s, n = 48) {
    if (s.kind === "poly") return s.pts;
    const pts = [];
    for (const e of elements(s)) {
      if (e.t === "line") pts.push(e.a);
      else {
        const k = Math.max(2, Math.ceil((n * (e.a1 - e.a0)) / TAU));
        for (let i = 0; i < k; i++) pts.push(at(e, e.a0 + ((e.a1 - e.a0) * i) / k));
      }
    }
    return pts;
  };

  C.samplePiece = function (pc, n = 48) {
    if (pc.t === "line") return [pc.a, pc.b];
    const k = Math.max(2, Math.ceil((n * (pc.a1 - pc.a0)) / TAU));
    return Array.from({ length: k + 1 }, (_, i) => at(pc, pc.a0 + ((pc.a1 - pc.a0) * i) / k));
  };

  C.TAU = TAU;
})((globalThis.C2D = globalThis.C2D || {}));
