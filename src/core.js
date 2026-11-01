// ===================================================================== core.js
// Netwerk, kleinste-kwadratenvereffening (2D en 1D) met Delftse toetsing, voorcontrole.
(function (V) {
  "use strict";
  const M = V.M;
  const RHO = 200 / Math.PI;
  const wrapGon = (v) => ((((v + 200) % 400) + 400) % 400) - 200;
  const mod = (v, m) => ((v % m) + m) % m;

  // ------------------------------------------------------------- toetsing
  class Testing {
    constructor(alpha0 = 0.001, beta0 = 0.80) {
      this.alpha0 = alpha0; this.beta0 = beta0;
      this.k_w = M.normPpf(1 - alpha0 / 2);
      this.lambda0 = (this.k_w + M.normPpf(beta0)) ** 2;
      this._cache = {};
    }
    critF(r) {
      if (r <= 0) return NaN;
      if (!(r in this._cache)) this._cache[r] = M.ncx2Isf(this.beta0, r, this.lambda0) / r;
      return this._cache[r];
    }
    critBlock(b) { return this.critF(b); }
  }

  // ------------------------------------------------------------- netwerk
  function newPoint(name) {
    return { name, x: NaN, y: NaN, H: NaN, fix_xy: false, fix_h: false, code: "", status_xy: "vrij", status_h: "vrij" };
  }
  class Network {
    constructor() { this.points = {}; this.obs = []; }
    clone() {
      const n = new Network();
      for (const [k, p] of Object.entries(this.points)) n.points[k] = { ...p };
      n.obs = this.obs.map((o) => ({ ...o, meta: { ...o.meta } }));
      return n;
    }
    point(name, kw) {
      const p = this.points[name] || newPoint(name);
      if (kw) Object.assign(p, kw);
      this.points[name] = p;
      return p;
    }
    setKnown(name, dim, mode, o = {}) {
      dim = dim.toUpperCase();
      const p = this.point(name);
      const kinds = new Set();
      if (dim !== "1D") kinds.add("XY");
      if (dim !== "2D") kinds.add("HH");
      this.obs = this.obs.filter((q) => !(kinds.has(q.kind) && q.frm === name));
      if (dim !== "1D") {
        if (o.x != null) p.x = +o.x;
        if (o.y != null) p.y = +o.y;
        p.status_xy = mode; p.fix_xy = mode === "vast";
        if (mode === "gewogen") this.knownXY(name, p.x, p.y, o.sxy_mm / 1000);
      }
      if (dim !== "2D") {
        if (o.H != null) p.H = +o.H;
        p.status_h = mode; p.fix_h = mode === "vast";
        if (mode === "gewogen") this.knownH(name, p.H, o.sh_mm);
      }
      return p;
    }
    pointSources(name) {
      const s = new Set();
      for (const o of this.obs) {
        if (o.frm !== name && o.to !== name) continue;
        if (o.kind === "GNSS" || o.kind === "GNSSH") s.add("GNSS");
        else if (o.kind === "R" || o.kind === "S" || (o.kind === "DH" && o.label === "trig")) s.add("TPS");
        else if (o.kind === "DH") s.add("WP");
      }
      return s;
    }
    add(o) { o.meta = o.meta || {}; o.to = o.to || ""; o.set_id = o.set_id || ""; o.label = o.label || ""; o.ref = o.ref || ""; this.obs.push(o); return o; }
    direction(st, tg, gon, sigma_mgon, set_id, ref, meta) { return this.add({ kind: "R", frm: st, to: tg, value: +gon, sigma: sigma_mgon / 1000, set_id: set_id || st, ref, meta }); }
    distance(a, b, m, a_mm = 1, b_ppm = 1.5, ref, meta) { return this.add({ kind: "S", frm: a, to: b, value: +m, sigma: Math.hypot(a_mm / 1000, b_ppm * 1e-6 * m), ref, meta }); }
    gnssXY(p, x, y, sx, sy, sxy = 0, ref, meta) {
      sy = sy == null ? sx : sy;
      return this.add({ kind: "GNSS", frm: p, value: [+x, +y], sigma: [[sx * sx, sxy], [sxy, sy * sy]], ref, meta });
    }
    knownXY(p, x, y, sx, sy) { sy = sy == null ? sx : sy; return this.add({ kind: "XY", frm: p, value: [+x, +y], sigma: [[sx * sx, 0], [0, sy * sy]] }); }
    heightDiff(a, b, dh, sigma_mm, label = "waterpassing", ref, meta) { return this.add({ kind: "DH", frm: a, to: b, value: +dh, sigma: sigma_mm / 1000, label, ref, meta }); }
    gnssH(p, H, sigma_mm, ref, meta) { return this.add({ kind: "GNSSH", frm: p, value: +H, sigma: sigma_mm / 1000, ref, meta }); }
    knownH(p, H, sigma_mm) { return this.add({ kind: "HH", frm: p, value: +H, sigma: sigma_mm / 1000 }); }
    removeObs(pred) { const n = this.obs.length; this.obs = this.obs.filter((o) => !pred(o)); return n - this.obs.length; }
  }

  const is2D = (k) => k === "R" || k === "S" || k === "GNSS" || k === "XY";
  const is1D = (k) => k === "DH" || k === "GNSSH" || k === "HH";
  const isBlock = (k) => k === "GNSS" || k === "XY";

  // inverse 2x2
  const inv2 = (S) => { const d = S[0][0] * S[1][1] - S[0][1] * S[1][0]; return [[S[1][1] / d, -S[0][1] / d], [-S[1][0] / d, S[0][0] / d]]; };

  // ------------------------------------------------------------- vereffening
  class Adjustment {
    constructor(net, opts = {}) {
      this.net = net;
      this.t = opts.testing || new Testing();
      this.estimateScale = !!opts.estimateScale;
    }

    adjust2d(maxIter = 20, tol = 1e-5) {
      const net = this.net;
      const obs = net.obs.filter((o) => is2D(o.kind));
      const used = new Set();
      for (const o of obs) { used.add(o.frm); if (o.to) used.add(o.to); }
      const pts = [...used].sort();
      const C = {};
      for (const p of pts) {
        const q = net.points[p];
        if (!q || !(M.isNum(q.x) && M.isNum(q.y))) throw new Error(`Punt ${p} heeft geen benaderde x,y`);
        C[p] = [q.x, q.y];
      }
      const idx = {}, unk = [];
      for (const p of pts) if (!net.points[p].fix_xy) { idx[p + "\u0000x"] = unk.length; unk.push([p, "x"]); idx[p + "\u0000y"] = unk.length; unk.push([p, "y"]); }
      const sets = [...new Set(obs.filter((o) => o.kind === "R").map((o) => o.set_id))].sort();
      for (const s of sets) { idx["\u0001o" + s] = unk.length; unk.push(["o", s]); }
      const kIdx = this.estimateScale && obs.some((o) => o.kind === "S") ? unk.length : -1;
      if (kIdx >= 0) unk.push(["K", "k"]);
      const n = unk.length;
      const ix = (p) => idx[p + "\u0000x"], iy = (p) => idx[p + "\u0000y"];
      // beginwaarden oriëntaties
      const orient = {};
      for (const s of sets) {
        const v = [];
        for (const o of obs) if (o.kind === "R" && o.set_id === s) {
          const a = C[o.frm], b = C[o.to];
          v.push(wrapGon(Math.atan2(b[0] - a[0], b[1] - a[1]) * RHO - o.value));
        }
        const ref = v[0];
        orient[s] = mod(ref + M.mean(v.map((x) => wrapGon(x - ref))), 400);
      }
      let kScale = 0;
      // gewichten per blok
      const W = obs.map((o) => (isBlock(o.kind) ? inv2(o.sigma) : 1 / (o.sigma * o.sigma)));
      const coordMask = unk.map((u) => u[0] !== "o" && u[0] !== "K");

      // A als lijst van rijen [[kolom, waarde], ...], l
      const build = () => {
        const rows = [], l = [];
        for (const o of obs) {
          if (o.kind === "R" || o.kind === "S") {
            const a = C[o.frm], b = C[o.to];
            const dx = b[0] - a[0], dy = b[1] - a[1], s2 = dx * dx + dy * dy, s = Math.sqrt(s2);
            const row = [];
            let gx, gy;
            if (o.kind === "R") {
              const az = Math.atan2(dx, dy) * RHO;
              l.push(wrapGon(o.value - mod(az - orient[o.set_id], 400)));
              gx = dy / s2 * RHO; gy = -dx / s2 * RHO;
              row.push([idx["\u0001o" + o.set_id], -1]);
            } else {
              l.push(o.value - s * (1 + kScale));
              gx = dx / s * (1 + kScale); gy = dy / s * (1 + kScale);
              if (kIdx >= 0) row.push([kIdx, s]);
            }
            if (ix(o.to) !== undefined) { row.push([ix(o.to), gx]); row.push([iy(o.to), gy]); }
            if (ix(o.frm) !== undefined) { row.push([ix(o.frm), -gx]); row.push([iy(o.frm), -gy]); }
            rows.push(row);
          } else {
            const c = C[o.frm];
            l.push(o.value[0] - c[0]); l.push(o.value[1] - c[1]);
            if (ix(o.frm) !== undefined) { rows.push([[ix(o.frm), 1]]); rows.push([[iy(o.frm), 1]]); }
            else { rows.push([]); rows.push([]); }
          }
        }
        return { rows, l };
      };
      const normal = (rows, l) => {
        const N = new Float64Array(n * n), b = new Float64Array(n);
        let i = 0;
        obs.forEach((o, k) => {
          if (isBlock(o.kind)) {
            const P = W[k], r0 = rows[i], r1 = rows[i + 1];
            const R = [r0, r1];
            for (let u = 0; u < 2; u++) for (let v = 0; v < 2; v++) {
              const p = P[u][v];
              if (p === 0) continue;
              for (const [cu, au] of R[u]) { b[cu] += au * p * l[i + v]; for (const [cv, av] of R[v]) N[cu * n + cv] += au * p * av; }
            }
            i += 2;
          } else {
            const w = W[k];
            for (const [cu, au] of rows[i]) { b[cu] += au * w * l[i]; for (const [cv, av] of rows[i]) N[cu * n + cv] += au * w * av; }
            i += 1;
          }
        });
        return { N, b };
      };
      const solve = (Q, b) => { const x = new Float64Array(n); for (let r = 0; r < n; r++) { let s = 0; for (let c = 0; c < n; c++) s += Q[r * n + c] * b[c]; x[r] = s; } return x; };

      let it = 0, inv;
      for (it = 1; it <= maxIter; it++) {
        const { rows, l } = build();
        const { N, b } = normal(rows, l);
        inv = M.invNormal(N, n, coordMask);
        const dx = solve(inv.Q, b);
        let mx = 0;
        unk.forEach((u, j) => {
          if (u[0] === "o") orient[u[1]] = mod(orient[u[1]] + dx[j], 400);
          else if (u[0] === "K") kScale += dx[j];
          else { C[u[0]][u[1] === "x" ? 0 : 1] += dx[j]; mx = Math.max(mx, Math.abs(dx[j])); }
        });
        if (mx < tol) break;
      }
      if (it > maxIter) it = maxIter;
      const { rows, l } = build();
      const { N, b } = normal(rows, l);
      inv = M.invNormal(N, n, coordMask);
      const Qx = inv.Q;
      const dxs = solve(Qx, b);
      const e = l.map((v, i) => v - rows[i].reduce((s, [c, a]) => s + a * dxs[c], 0));
      const stats = this._statistics(obs, rows, e, W, Qx, n, unk, idx, inv, true);
      const sd = {}, ell = {};
      for (const p of pts) {
        if (ix(p) !== undefined) {
          const a = Qx[ix(p) * n + ix(p)], c = Qx[iy(p) * n + iy(p)], bq = Qx[ix(p) * n + iy(p)];
          sd[p] = [Math.sqrt(Math.max(a, 0)), Math.sqrt(Math.max(c, 0))];
          const h = Math.sqrt(((a - c) / 2) ** 2 + bq * bq);
          const l1 = (a + c) / 2 + h, l2 = (a + c) / 2 - h;
          let vx, vy;
          if (Math.abs(bq) > 1e-30) { vx = bq; vy = l1 - a; } else if (a >= c) { vx = 1; vy = 0; } else { vx = 0; vy = 1; }
          ell[p] = [Math.sqrt(Math.max(l1, 0)), Math.sqrt(Math.max(l2, 0)), mod(Math.atan2(vx, vy) * RHO, 200)];
        } else sd[p] = [0, 0];
      }
      const coords = {};
      for (const p of pts) coords[p] = [C[p][0], C[p][1]];
      return {
        dim: "2D", coords, sd, ellipse: ell, ...stats, unknowns: unk, free: inv.free, iterations: it,
        extra: { orientations: orient, scale: kIdx >= 0 ? [1 / (1 + kScale), Math.sqrt(Qx[kIdx * n + kIdx])] : null },
      };
    }

    adjust1d() {
      const net = this.net;
      const obs = net.obs.filter((o) => is1D(o.kind));
      const set = new Set();
      for (const o of obs) { set.add(o.frm); if (o.to) set.add(o.to); }
      const pts = [...set].sort();
      const idx = {}, unk = [];
      for (const p of pts) if (!net.points[p].fix_h) { idx[p] = unk.length; unk.push([p, "H"]); }
      const n = unk.length;
      const H0 = {};
      for (const p of pts) { const h = net.points[p].H; H0[p] = M.isNum(h) ? h : 0; }
      const W = obs.map((o) => 1 / (o.sigma * o.sigma));
      const rows = [], l = [];
      for (const o of obs) {
        const row = [];
        if (o.kind === "DH") {
          l.push(o.value - (H0[o.to] - H0[o.frm]));
          if (idx[o.to] !== undefined) row.push([idx[o.to], 1]);
          if (idx[o.frm] !== undefined) row.push([idx[o.frm], -1]);
        } else {
          l.push(o.value - H0[o.frm]);
          if (idx[o.frm] !== undefined) row.push([idx[o.frm], 1]);
        }
        rows.push(row);
      }
      const N = new Float64Array(n * n), b = new Float64Array(n);
      rows.forEach((row, i) => { for (const [cu, au] of row) { b[cu] += au * W[i] * l[i]; for (const [cv, av] of row) N[cu * n + cv] += au * W[i] * av; } });
      const inv = M.invNormal(N, n, null);
      const Qx = inv.Q;
      const dx = new Float64Array(n);
      for (let r = 0; r < n; r++) { let s = 0; for (let c = 0; c < n; c++) s += Qx[r * n + c] * b[c]; dx[r] = s; }
      const Hs = { ...H0 };
      for (const p in idx) Hs[p] += dx[idx[p]];
      const e = l.map((v, i) => v - rows[i].reduce((s, [c, a]) => s + a * dx[c], 0));
      const stats = this._statistics(obs, rows, e, W, Qx, n, unk, idx, inv, false);
      const sd = {};
      for (const p of pts) sd[p] = idx[p] !== undefined ? Math.sqrt(Math.max(Qx[idx[p] * n + idx[p]], 0)) : 0;
      return { dim: "1D", coords: Hs, sd, ellipse: {}, ...stats, unknowns: unk, free: inv.free, iterations: 1, extra: {} };
    }

    _statistics(obs, rows, e, W, Qx, n, unk, idx, inv, dim2) {
      const m = rows.length;
      const r = m - (n - inv.nullity);
      let ePe = 0, i = 0;
      obs.forEach((o, k) => {
        if (isBlock(o.kind)) { const P = W[k]; ePe += e[i] * (P[0][0] * e[i] + P[0][1] * e[i + 1]) + e[i + 1] * (P[1][0] * e[i] + P[1][1] * e[i + 1]); i += 2; }
        else { ePe += e[i] * e[i] * W[k]; i += 1; }
      });
      const s02 = r > 0 ? ePe / r : NaN;
      const Fcrit = this.t.critF(r);
      // Qx * a (a = rij van A)
      const Qa = (row) => { const v = new Float64Array(n); for (const [c, a] of row) for (let j = 0; j < n; j++) v[j] += Qx[j * n + c] * a; return v; };
      const aQa = (r1, v) => r1.reduce((s, [c, a]) => s + a * v[c], 0);
      const coordPts = unk.filter((u) => u[0] !== "o" && u[0] !== "K").map((u) => u[0]);
      const ptsU = [...new Set(coordPts)];
      const maxShift = (dx) => {
        let best = 0;
        if (dim2) for (const p of ptsU) best = Math.max(best, Math.hypot(dx[idx[p + "\u0000x"]], dx[idx[p + "\u0000y"]]));
        else for (let j = 0; j < n; j++) best = Math.max(best, Math.abs(dx[j]));
        return best;
      };
      const out = [];
      i = 0;
      obs.forEach((o, k) => {
        if (!isBlock(o.kind)) {
          const w = W[k], v = Qa(rows[i]);
          const qe = o.sigma * o.sigma - aQa(rows[i], v);
          const q = w * w * qe;
          let wt, mdb, ext;
          if (q < 1e-14) { wt = NaN; mdb = Infinity; ext = Infinity; }
          else {
            wt = (w * e[i]) / Math.sqrt(q);
            mdb = Math.sqrt(this.t.lambda0 / q);
            ext = maxShift(v.map((x) => x * w * mdb));
          }
          const crit = this.t.k_w;
          out.push({ obs: o, resid: [e[i]], w: wt, w_crit: crit, redundancy: qe * w, mdb, ext_rel: ext, rejected: M.isNum(wt) && Math.abs(wt) > crit });
          i += 1;
        } else {
          const P = W[k], r0 = rows[i], r1 = rows[i + 1];
          const v0 = Qa(r0), v1 = Qa(r1);
          const S = o.sigma;
          const Qe = [[S[0][0] - aQa(r0, v0), S[0][1] - aQa(r0, v1)], [S[1][0] - aQa(r1, v0), S[1][1] - aQa(r1, v1)]];
          const mul = (A, B) => [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
          const Qb = mul(mul(P, Qe), P);
          const Pe = [P[0][0] * e[i] + P[0][1] * e[i + 1], P[1][0] * e[i] + P[1][1] * e[i + 1]];
          let T, mdb, ext;
          const det = Qb[0][0] * Qb[1][1] - Qb[0][1] * Qb[1][0];
          if (Math.abs(det) < 1e-30 || !(Qb[0][0] > 0) || !(Qb[1][1] > 0)) { T = NaN; mdb = [Infinity, Infinity]; ext = Infinity; }
          else {
            const Qi = inv2(Qb);
            T = (Pe[0] * (Qi[0][0] * Pe[0] + Qi[0][1] * Pe[1]) + Pe[1] * (Qi[1][0] * Pe[0] + Qi[1][1] * Pe[1])) / 2;
            mdb = [Math.sqrt(this.t.lambda0 / Qb[0][0]), Math.sqrt(this.t.lambda0 / Qb[1][1])];
            ext = 0;
            for (let c = 0; c < 2; c++) {
              const dx = new Float64Array(n);
              for (let j = 0; j < n; j++) dx[j] = (v0[j] * P[0][c] + v1[j] * P[1][c]) * mdb[c];
              ext = Math.max(ext, maxShift(dx));
            }
          }
          const R = mul(Qe, P);
          const crit = this.t.critBlock(2);
          out.push({ obs: o, resid: [e[i], e[i + 1]], w: T, w_crit: crit, redundancy: (R[0][0] + R[1][1]) / 2, mdb, ext_rel: ext, rejected: M.isNum(T) && T > crit });
          i += 2;
        }
      });
      return { sigma0_hat2: s02, redundancy: r, F: s02, F_crit: Fcrit, F_ok: s02 <= Fcrit, obs_results: out };
    }
  }

  // ------------------------------------------------------------- voorcontrole
  function precheck(net, tol_m = 0.30, tol_rel = 0.002, suggest_tol_m = 0.15) {
    const pts = net.points;
    const ok = (p) => pts[p] && M.isNum(pts[p].x) && M.isNum(pts[p].y);
    const dist = new Map();
    for (const o of net.obs) if (o.kind === "S") dist.set(o.ref + "\u0000" + o.frm + "\u0000" + o.to, o.value);
    const sets = new Map();
    for (const o of net.obs) {
      if (o.kind === "R" && ok(o.to)) {
        const D = dist.get(o.ref + "\u0000" + o.frm + "\u0000" + o.to);
        if (D) {
          const a = o.value / RHO;
          if (!sets.has(o.set_id)) sets.set(o.set_id, []);
          sets.get(o.set_id).push([o, [D * Math.sin(a), D * Math.cos(a)], D]);
        }
      }
    }
    const out = [];
    for (const lst of sets.values()) {
      if (lst.length < 3) continue;
      const L = lst.map((x) => x[1]), G = lst.map(([o]) => [pts[o.to].x, pts[o.to].y]), Dd = lst.map((x) => x[2]);
      let use = lst.map(() => true), dev = [], P = [];
      for (let it = 0; it < 5; it++) {
        const sel = (A) => A.filter((_, k) => use[k]);
        const Lu = sel(L), Gu = sel(G);
        const mL = [M.mean(Lu.map((v) => v[0])), M.mean(Lu.map((v) => v[1]))];
        const mG = [M.mean(Gu.map((v) => v[0])), M.mean(Gu.map((v) => v[1]))];
        let num = 0, den = 0;
        Lu.forEach((lv, k) => {
          const lx = lv[0] - mL[0], ly = lv[1] - mL[1], gx = Gu[k][0] - mG[0], gy = Gu[k][1] - mG[1];
          num += lx * gy - ly * gx; den += lx * gx + ly * gy;
        });
        const rot = Math.atan2(num, den), c = Math.cos(rot), s = Math.sin(rot);
        const t0 = [mG[0] - (c * mL[0] - s * mL[1]), mG[1] - (s * mL[0] + c * mL[1])];
        P = L.map((lv) => [c * lv[0] - s * lv[1] + t0[0], s * lv[0] + c * lv[1] + t0[1]]);
        dev = P.map((pv, k) => Math.hypot(pv[0] - G[k][0], pv[1] - G[k][1]));
        const med = M.median(dev.filter((_, k) => use[k]));
        const nw = dev.map((d, k) => d <= Math.max(tol_m + tol_rel * Dd[k], 3 * med));
        const cnt = nw.filter(Boolean).length;
        if (cnt < 3 || nw.every((v, k) => v === use[k])) break;
        use = nw;
      }
      lst.forEach(([o, , D], k) => {
        if (dev[k] > tol_m + tol_rel * D) {
          let best = null, bd = 1e9;
          for (const [nm, q] of Object.entries(pts)) {
            if (nm === o.frm || !M.isNum(q.x)) continue;
            const d = Math.hypot(P[k][0] - q.x, P[k][1] - q.y);
            if (d < bd) { best = nm; bd = d; }
          }
          out.push({ ref: o.ref, station: o.frm, doel: o.to, afwijking_m: dev[k], past_op: bd < suggest_tol_m + tol_rel * D && best !== o.to ? best : null, past_afstand_m: bd, set_id: o.set_id });
        }
      });
    }
    return out;
  }

  V.RHO = RHO; V.wrapGon = wrapGon; V.mod = mod;
  V.Testing = Testing; V.Network = Network; V.Adjustment = Adjustment; V.precheck = precheck;
  V.is2D = is2D; V.is1D = is1D;
})(globalThis.V = globalThis.V || {});
