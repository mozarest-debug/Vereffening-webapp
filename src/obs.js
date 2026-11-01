// ===================================================================== obs.js
// Instellingen, reducties en verwerking van ruwe waarnemingen (los van het formaat).
(function (V) {
  "use strict";
  const M = V.M, RHO = V.RHO;
  const R_EARTH = 6378000.0, GEOID_APPROX = 43.2;

  // Leica-prismaconstanten (Leica-conventie, mm). Absoluut = Leica - 34,4 mm.
  const LEICA_CONSTANTS = {
    GPR1: 0.0, GPH1: 0.0, GPR121: 0.0, GPR111: 0.0,
    GMP101: 17.5, GMP111: 17.5, "GMP111-0": 17.5, GMP104: 17.5,
    GRZ4: 23.1, GRZ122: 23.1, GRZ101: 30.0, GRZ121: 23.1,
    MPR122: 28.1, TAPE: 34.4, RL: 34.4,
  };

  function defaultSettings() {
    return {
      dir_2face_mgon: 0.3, dir_1face_mgon: 0.5, zen_2face_mgon: 0.3, zen_1face_mgon: 0.5,
      dist_rl_mm: 2.0, dist_rl_ppm: 2.0, dist_prism_mm: 1.0, dist_prism_ppm: 1.5,
      centr_rl_mm: 1.0, centr_pole_mm: 5.0, centr_station_mm: 0.0,
      th_rl_mm: 1.0, th_pole_mm: 3.0, ih_mm: 0.0,
      refraction_k: 0.13, refraction_sk: 0.05, reduce_to_rd: true,
      gnss_min_xy_mm: 10.0, gnss_min_h_mm: 20.0, gnss_centr_mm: 5.0,
      gnss_tol_xy_mm: 20.0, gnss_tol_h_mm: 40.0,
      lev_a_mm: 0.10, lev_b_mm_sqrtkm: 1.41, lev_c_mm_km: 0.0,
      lev_tol_mm_sqrtkm: 2.0, lev_tol_min_mm: 0.5, lev_tp_maxlen: 3,
      alpha0: 0.001, beta0: 0.80,
      precheck_tol_m: 0.30, precheck_tol_mm_per_m: 2.0,
      gnss_h_ctrl_tol_mm: 45,
    };
  }

  function rdReductionFactor(net, a, b) {
    const pa = net.points[a], pb = net.points[b];
    if (!pa || !pb) return 1.0;
    const xs = [pa.x, pb.x].filter(M.isNum), ys = [pa.y, pb.y].filter(M.isNum);
    if (!xs.length || !ys.length) return 1.0;
    const hs = [pa.H, pb.H].filter(M.isNum);
    const hm = (hs.length ? M.mean(hs) : 0) + GEOID_APPROX;
    const k = V.RDNAPTRANS.rdScaleFactor(M.mean(xs), M.mean(ys));
    return k * R_EARTH / (R_EARTH + hm);
  }

  function addTpsObservation(net, st, tg, hz, z, sd, ih, th, S, o) {
    const faces = o.faces || 2, prism = o.prism !== false;
    const meta = { ...(o.meta || {}) };
    const zr = z / RHO, Dh = sd * Math.sin(zr);
    const f = S.reduce_to_rd ? rdReductionFactor(net, st, tg) : 1.0;
    const D = Dh * f;
    Object.assign(meta, { D_hor: Dh, scale_ppm: (f - 1) * 1e6, faces, edm: meta.edm || (prism ? "prisma" : "reflectorloos") });
    const two = faces >= 2;
    const centrT = prism ? S.centr_pole_mm : S.centr_rl_mm;
    const centr = Math.hypot(centrT, S.centr_station_mm);
    const sDir = two ? S.dir_2face_mgon : S.dir_1face_mgon;
    const sDirTot = Math.hypot(sDir, centr / 1000 / Math.max(Dh, 0.5) * RHO * 1000);
    net.direction(st, tg, hz, sDirTot, o.set_id, o.ref, meta);
    if (o.use_dist !== false && sd > 0) {
      const a = Math.hypot(prism ? S.dist_prism_mm : S.dist_rl_mm, centr);
      const b = prism ? S.dist_prism_ppm : S.dist_rl_ppm;
      net.distance(st, tg, D, a, b, o.ref, meta);
    }
    if (o.use_height !== false && sd > 0) {
      const dH = sd * Math.cos(zr) + (1 - S.refraction_k) * Dh * Dh / (2 * R_EARTH) + ih - th;
      const sZ = (two ? S.zen_2face_mgon : S.zen_1face_mgon) / 1000 / RHO;
      const sTh = prism ? S.th_pole_mm : S.th_rl_mm;
      const sDH = Math.sqrt((Dh * sZ) ** 2 + (sTh / 1000) ** 2 + (S.ih_mm / 1000) ** 2 + (Dh * Dh / (2 * R_EARTH) * S.refraction_sk) ** 2) * 1000;
      net.heightDiff(st, tg, dH, sDH, "trig", o.ref, meta);
    }
  }

  // Benaderde coördinaten uit polaire metingen (polair, vrije opstelling, hoogtes).
  function approximate(records, known) {
    const C = {};
    for (const [k, v] of Object.entries(known)) C[k] = [...v];
    const sets = new Map();
    for (const r of records) { if (!sets.has(r.set_id)) sets.set(r.set_id, []); sets.get(r.set_id).push(r); }
    const hasXY = (p) => C[p] && M.isNum(C[p][0]) && M.isNum(C[p][1]);
    const hasH = (p) => C[p] && M.isNum(C[p][2]);
    const ensure = (p) => (C[p] = C[p] || [NaN, NaN, NaN]);
    for (let it = 0; it < 20; it++) {
      let progress = false;
      for (const lst of sets.values()) {
        const st = lst[0].station;
        const acc = new Map();
        for (const r of lst) {
          const D = r.sd * Math.sin(r.z / RHO), a = r.hz / RHO;
          if (!acc.has(r.target)) acc.set(r.target, []);
          acc.get(r.target).push([D * Math.sin(a), D * Math.cos(a)]);
        }
        const loc = new Map();
        for (const [k, v] of acc) loc.set(k, [M.mean(v.map((q) => q[0])), M.mean(v.map((q) => q[1]))]);
        const kn = [...loc.keys()].filter((t) => hasXY(t) && t !== st);
        if (hasXY(st) && kn.length) {
          let re = 0, im = 0;
          for (const t of kn) {
            const azg = Math.atan2(C[t][0] - C[st][0], C[t][1] - C[st][1]);
            const azl = Math.atan2(loc.get(t)[0], loc.get(t)[1]);
            re += Math.cos(azg - azl); im += Math.sin(azg - azl);
          }
          const rot = Math.atan2(im, re), ca = Math.cos(rot), sa = Math.sin(rot);
          for (const [t, [lx, ly]] of loc) {
            if (!hasXY(t)) {
              ensure(t);
              C[t][0] = C[st][0] + ca * lx + sa * ly;
              C[t][1] = C[st][1] - sa * lx + ca * ly;
              progress = true;
            }
          }
        } else if (!hasXY(st) && kn.length >= 2) {
          const L = kn.map((t) => loc.get(t)), G = kn.map((t) => [C[t][0], C[t][1]]);
          const mL = [M.mean(L.map((v) => v[0])), M.mean(L.map((v) => v[1]))];
          const mG = [M.mean(G.map((v) => v[0])), M.mean(G.map((v) => v[1]))];
          let num = 0, den = 0;
          L.forEach((lv, k) => {
            const lx = lv[0] - mL[0], ly = lv[1] - mL[1], gx = G[k][0] - mG[0], gy = G[k][1] - mG[1];
            num += lx * gy - ly * gx; den += lx * gx + ly * gy;
          });
          const rot = Math.atan2(num, den), c = Math.cos(rot), s = Math.sin(rot);
          const t0 = [mG[0] - (c * mL[0] - s * mL[1]), mG[1] - (s * mL[0] + c * mL[1])];
          ensure(st); C[st][0] = t0[0]; C[st][1] = t0[1];
          for (const [t, lv] of loc) {
            if (!hasXY(t)) { ensure(t); C[t][0] = c * lv[0] - s * lv[1] + t0[0]; C[t][1] = s * lv[0] + c * lv[1] + t0[1]; }
          }
          progress = true;
        }
      }
      if (!progress) break;
    }
    for (let it = 0; it < 20; it++) {
      let progress = false;
      for (const lst of sets.values()) {
        const st = lst[0].station;
        const acc = new Map();
        for (const r of lst) if (r.sd > 0) {
          if (!acc.has(r.target)) acc.set(r.target, []);
          acc.get(r.target).push(r.sd * Math.cos(r.z / RHO) + (r.ih || 0) - (r.th || 0));
        }
        const dh = new Map([...acc].map(([k, v]) => [k, M.mean(v)]));
        if (!hasH(st)) {
          const kn = [...dh.keys()].filter(hasH);
          if (kn.length) { ensure(st); C[st][2] = M.mean(kn.map((t) => C[t][2] - dh.get(t))); progress = true; }
        }
        if (hasH(st)) for (const [t, v] of dh) if (!hasH(t)) { ensure(t); C[t][2] = C[st][2] + v; progress = true; }
      }
      if (!progress) break;
    }
    return C;
  }

  function levSigmaMm(dist_m, S) {
    const d = dist_m / 1000;
    return Math.sqrt(S.lev_a_mm ** 2 + S.lev_b_mm_sqrtkm ** 2 * d + (S.lev_c_mm_km * d) ** 2);
  }
  function addLevelingSetup(net, hi, bs, reads, S, ref, meta, nBs = 1) {
    const [p, r, d] = bs;
    net.heightDiff(p, hi, r, levSigmaMm(d, S) / Math.sqrt(nBs), "waterpassing", ref, { ...meta, soort: "achterslag", afstand: d, n: nBs });
    for (const rd of reads) {
      const [q, rq, dq, kind] = rd, n = rd[4] || 1;
      net.heightDiff(hi, q, -rq, levSigmaMm(dq, S) / Math.sqrt(n), "waterpassing", ref, { ...meta, soort: kind, afstand: dq, n });
    }
  }

  Object.assign(V, { R_EARTH, GEOID_APPROX, LEICA_CONSTANTS, defaultSettings, rdReductionFactor, addTpsObservation, approximate, levSigmaMm, addLevelingSetup });
})(globalThis.V = globalThis.V || {});
