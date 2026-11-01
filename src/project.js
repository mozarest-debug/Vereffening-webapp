// ===================================================================== project.js
// Project met meerdere stappen; elke stap = bronnen + regels voor bekende punten.
(function (V) {
  "use strict";
  const M = V.M;
  const f1 = (v, d = 1) => (M.isNum(v) ? v.toFixed(d).replace(".", ",") : "–");
  const sg = (v, d = 1) => (M.isNum(v) ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d).replace(".", ",") : "–");

  function globToRegex(p) {
    let r = "";
    for (const ch of p) r += ch === "*" ? ".*" : ch === "?" ? "." : /[.+^${}()|\\]/.test(ch) ? "\\" + ch : ch;
    return new RegExp("^" + r + "$");
  }
  // Puntenselectie: '*' / patroon (komma's toegestaan: '80*, 9697') / lijst
  function matchPoints(n, points) {
    if (Array.isArray(points)) return points.includes(n);
    const parts = String(points || "*").split(/[,\s]+/).filter(Boolean);
    return parts.some((p) => globToRegex(p).test(n));
  }

  // ------------------------------------------------------------- MOVE3 (TCO + OBS)
  function readTco(text) {
    const pts = {};
    for (const line of text.split(/\r?\n/)) {
      if (/^(MOVE3|\$|PROJECTION)/.test(line) || !line.trim()) continue;
      const t = line.trim().split(/\s+/);
      if (t.length < 4) continue;
      const known = [], vals = [];
      let bad = false;
      for (const s of t.slice(1, 4)) { known.push(s.endsWith("*")); const v = Number(s.replace(/[*^]+$/, "")); if (!Number.isFinite(v)) bad = true; vals.push(v); }
      if (bad) continue;
      const sd = t.length >= 7 ? t.slice(4, 7).map(Number) : [0, 0, 0];
      pts[t[0]] = { x: vals[0], y: vals[1], H: vals[2], known, sd };
    }
    return pts;
  }
  function readObsM3(text) {
    const recs = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (!t[0]) continue;
      if (t[0] === "TS") {
        const r = { kind: "TS", frm: t[1], to: t[2], ih: +t[3], th: +t[4] };
        for (let i = 5; i < t.length;) {
          if (/^[RSZ]\d$/.test(t[i])) { r[t[i][0]] = { val: +t[i + 1], abs: +t[i + 2], rel: +t[i + 3], set: t[i] }; i += 4; } else i++;
        }
        recs.push(r);
      } else if (t[0] === "DH") recs.push({ kind: "DH", frm: t[1], to: t[2], dh: +t[3], L: +t[4], A: +t[5], B: +t[6], C: +t[7] });
    }
    return recs;
  }
  function move3Network(tco, obs, phase, S) {
    const net = new V.Network();
    for (const [n, p] of Object.entries(tco)) net.point(n, { x: p.x, y: p.y, H: p.H });
    for (const [n, p] of Object.entries(tco)) {
      if (p.known[0] && p.known[1]) { if (phase === "vast" || p.sd[0] === 0) net.setKnown(n, "2D", "vast"); else net.setKnown(n, "2D", "gewogen", { sxy_mm: p.sd[0] * 1000 }); }
      if (p.known[2]) { if (phase === "vast" || p.sd[2] === 0) net.setKnown(n, "1D", "vast"); else net.setKnown(n, "1D", "gewogen", { sh_mm: p.sd[2] * 1000 }); }
    }
    obs.forEach((r, k) => {
      if (!net.points[r.frm]) net.point(r.frm);
      if (!net.points[r.to]) net.point(r.to);
      if (r.kind === "TS") {
        const zg = r.Z ? r.Z.val : 100, sd = r.S ? r.S.val : 0, Dh = sd * Math.sin(zg / V.RHO);
        const f = S.reduce_to_rd && r.S ? V.rdReductionFactor(net, r.frm, r.to) : 1;
        const meta = { record: k + 1 }, ref = `${r.frm}->${r.to}`;
        if (r.R) net.direction(r.frm, r.to, r.R.val, r.R.abs * 1000, `${r.frm}:${r.R.set}`, ref, meta);
        if (r.S) net.distance(r.frm, r.to, Dh * f, r.S.abs * 1000, r.S.rel, ref, meta);
        if (r.Z && r.S) {
          const dH = sd * Math.cos(zg / V.RHO) + (1 - 0.13) * Dh * Dh / (2 * V.R_EARTH) + r.ih - r.th;
          const sZ = r.Z.abs / V.RHO;
          net.heightDiff(r.frm, r.to, dH, Math.sqrt((Dh * sZ) ** 2 + (Math.cos(zg / V.RHO) * r.S.abs) ** 2) * 1000, "trig", ref, meta);
        }
      } else {
        const L = r.L / 1000;
        net.heightDiff(r.frm, r.to, r.dh, Math.sqrt(r.A ** 2 + r.B ** 2 * L + (r.C * L) ** 2), "waterpassing", `rec${k + 1}`, { record: k + 1 });
      }
    });
    return net;
  }

  // ------------------------------------------------------------- project
  function newStage(name) {
    return {
      name, sources: [], known: [], dims: "auto", settings: null, estimate_scale: false,
      exclude_refs: [], precheck: true, precheck_keep: [], renames: [], snooping: 0, snoop_keep: [],
      gnss_heights: "gebruiken", follow_captivate: false, overrides: {},
    };
  }

  class Project {
    constructor(trans, settings) {
      this.trans = trans;
      this.settings = settings || V.defaultSettings();
      this.stages = [];
      this.results = [];
    }

    _load(src, S, known, R) {
      const tag = src.tag ? src.tag + ":" : "";
      const log = R.log, ck = R.checks;
      const label = src.tag || src.name;
      if (src.kind === "coords") {
        const c = V.readCoordinates(src.text);
        log.push(`${label}: ${Object.keys(c).length} coördinaten`);
        ck.sources.push({ tag: src.tag, name: src.name, kind: "coords", summary: `${Object.keys(c).length} coördinaten` });
        return { net: null, lists: c };
      }
      if (src.kind === "hexml") {
        if (!this.trans) throw new Error("RDNAPTRANS-grids ontbreken");
        const imp = V.loadHexml(src.text, this.trans, S);
        const nOcc = imp.net.obs.filter((o) => o.kind === "GNSS").length;
        const nG = Object.keys(imp.gnss).length;
        const nR = imp.net.obs.filter((o) => o.kind === "R").length;
        const edm = new Set(imp.net.obs.filter((o) => o.kind === "R").map((o) => o.meta.reflector));
        const sum = `${Object.keys(imp.setups).length} opstellingen · ${nR} metingen · ${nG} GNSS-punten` + (nOcc > nG ? ` (${nOcc} bezettingen)` : "");
        log.push(`${label}: HeXML, ${sum}`);
        ck.sources.push({ tag: src.tag, name: src.name, kind: "hexml", summary: sum, setups: imp.setups, reflectors: [...edm].filter(Boolean), control: Object.keys(imp.control).length });
        // GNSS-bezettingen vergelijken
        const occ = {};
        for (const o of imp.net.obs) if (o.kind === "GNSS" || o.kind === "GNSSH") {
          const d = (occ[o.frm] = occ[o.frm] || []);
          let e = d.find((q) => q.ref === o.ref);
          if (!e) d.push((e = { ref: o.ref, setup: o.meta.bezetting, epochs: o.meta.epochs }));
          if (o.kind === "GNSS") e.xy = o.value; else e.h = o.value;
        }
        for (const [n, d] of Object.entries(occ).sort()) {
          if (d.length < 2) continue;
          let dxy = 0, dh = 0;
          for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) {
            dxy = Math.max(dxy, Math.hypot(d[i].xy[0] - d[j].xy[0], d[i].xy[1] - d[j].xy[1]) * 1000);
            dh = Math.max(dh, Math.abs(d[i].h - d[j].h) * 1000);
          }
          const ok = dxy <= S.gnss_tol_xy_mm && dh <= S.gnss_tol_h_mm;
          const prevH = known[n] && M.isNum(known[n][2]) ? known[n][2] : null;
          ck.gnssOcc.push({ punt: n, bezettingen: d.map((q) => ({ ref: tag + q.ref, setup: q.setup, epochs: q.epochs, dH_ref_mm: prevH !== null ? (q.h - prevH) * 1000 : null })), dxy_mm: dxy, dh_mm: dh, ok });
          if (!ok) log.push(`    GNSS-bezettingen ${n}: verschil ligging ${f1(dxy, 0)} mm, hoogte ${f1(dh, 0)} mm (tolerantie ${f1(S.gnss_tol_xy_mm, 0)}/${f1(S.gnss_tol_h_mm, 0)} mm) → opnieuw meten of één bezetting uitschakelen`);
        }
        for (const w of imp.warnings) { log.push(`  waarschuwing: ${w}`); ck.warnings.push(w); }
        const rej = [...new Set(imp.net.obs.filter((o) => o.meta && o.meta.captivate_use === false).map((o) => tag + o.ref))];
        ck.captivateNo.push(...rej);
        if (Object.keys(imp.control).length) log.push(`    bekende punten in de job (Captivate 'control'): ${Object.keys(imp.control).length}`);
        R.repeat.push(...V.repeatCheck(imp.net).map((r) => ({ ...r, setup: tag + r.setup })));
        return { net: imp.net, lists: imp.control };
      }
      if (src.kind === "gsi") {
        const blocks = V.readGsi(src.text);
        const kind = (src.options && src.options.soort) || V.detectKind(blocks);
        const net = new V.Network();
        if (kind === "waterpassing") {
          const keep = new Set([...((src.options && src.options.keep) || []), ...Object.keys(known)]);
          const lev = V.parseLeveling(blocks, keep, tag, S.lev_tp_maxlen);
          V.addLevelingToNetwork(net, lev, S, tag);
          const sum = `${lev.lines.length} traject(en) · ${lev.setups.length} opstellingen · ${f1(lev.length_m / 1000, 2)} km` + (M.isNum(lev.misclosure_mm) ? ` · sluitfout ${sg(lev.misclosure_mm, 2)} mm` : "") + (lev.turning.length ? ` · ${lev.turning.length} wisselpunten` : "");
          log.push(`${label}: GSI-waterpassing, ${sum}`);
          const rd = lev.repeat_diffs;
          const secs = V.sectionCheck(lev, S.lev_tol_sqrtkm || S.lev_tol_mm_sqrtkm, S.lev_tol_min_mm);
          const diag = V.diagnoseSections(secs);
          ck.leveling.push({ tag: src.tag, name: src.name, lines: lev.lines.map((L) => ({ start: L.start && L.start[0], end: L.end[0], length_m: L.length_m, misclosure_mm: L.misclosure_mm })), length_m: lev.length_m, misclosure_mm: lev.misclosure_mm, tol_mm: Math.max(S.lev_tol_min_mm, S.lev_tol_mm_sqrtkm * Math.sqrt(lev.length_m / 1000)), repeat_max_mm: rd.length ? Math.max(...rd.map((x) => Math.abs(x[3]))) : null, repeat_n: rd.length, sections: secs, diagnoses: diag, setups: lev.setups.length, turning: lev.turning.length });
          ck.sources.push({ tag: src.tag, name: src.name, kind: "gsi-wp", summary: sum });
          if (rd.length) log.push(`    dubbele aflezingen: max verschil ${f1(Math.max(...rd.map((x) => Math.abs(x[3]))), 2)} mm (${rd.length} paren)`);
          if (secs.length) log.push(`    heen/terug: ${secs.length} secties, ${secs.filter((x) => !x.ok).length} buiten tolerantie`);
          for (const d of diag) log.push(`    DIAGNOSE: ${d.tekst}`);
          if (lev.start && src.options && src.options.start_known) net.setKnown(lev.start[0], "1D", "vast", { H: lev.start[1] });
        } else {
          const tps = V.parseTps(blocks, (src.options && src.options.codes) || V.TPS_CODES, tag);
          V.addTpsToNetwork(net, tps, known, S, !(src.options && src.options.prism === false), tag);
          const fc = tps.face_checks;
          const sum = `${tps.stations.length} opstelling(en) · ${tps.records.length} metingen` + (fc.length ? ` · kijkerstandverschil max c ${f1(Math.max(...fc.map((f) => Math.abs(f.c_mgon))))} / i ${f1(Math.max(...fc.map((f) => Math.abs(f.i_mgon))))} mgon` : "");
          log.push(`${label}: GSI-TPS, ${sum}`);
          ck.sources.push({ tag: src.tag, name: src.name, kind: "gsi-tps", summary: sum });
          ck.faceChecks.push(...fc);
          for (const w of tps.warnings) { log.push(`  waarschuwing: ${w}`); ck.warnings.push(w); }
        }
        return { net, lists: {} };
      }
      if (src.kind === "move3") {
        const net = move3Network(readTco(src.tco), readObsM3(src.text), (src.options && src.options.phase) || "gewogen", S);
        log.push(`${label}: MOVE3-project (${net.obs.length} waarnemingen)`);
        ck.sources.push({ tag: src.tag, name: src.name, kind: "move3", summary: `${net.obs.length} waarnemingen` });
        return { net, lists: {} };
      }
      throw new Error(`Onbekende bronsoort ${src.kind}`);
    }

    static merge(target, net, tag) {
      for (const [n, p] of Object.entries(net.points)) {
        const q = target.points[n];
        if (!q) target.points[n] = { ...p };
        else {
          for (const a of ["x", "y", "H"]) if (!M.isNum(q[a]) && M.isNum(p[a])) q[a] = p[a];
          if (!q.code && p.code) q.code = p.code;
          if (p.status_xy !== "vrij" && q.status_xy === "vrij") { q.status_xy = p.status_xy; q.fix_xy = p.fix_xy; }
          if (p.status_h !== "vrij" && q.status_h === "vrij") { q.status_h = p.status_h; q.fix_h = p.fix_h; }
        }
      }
      for (const o0 of net.obs) {
        const o = { ...o0 };
        if (o.kind === "R" && tag && !String(o.set_id).startsWith(tag + ":")) o.set_id = `${tag}:${o.set_id}`;
        if (tag && o.ref && !o.ref.startsWith(tag + ":")) o.ref = `${tag}:${o.ref}`;
        o.meta = { ...o.meta, bron: tag };
        target.obs.push(o);
      }
    }

    previous(origin, upto) {
      const res = upto === undefined ? this.results : this.results.slice(0, upto);
      if (origin === "vorige") {
        const out = {};
        for (const r of res) for (const [n, c] of Object.entries(r.coords)) {
          const d = (out[n] = out[n] || {});
          for (const [k, v] of Object.entries(c)) if (typeof v === "number" && M.isNum(v)) d[k] = v;
        }
        return out;
      }
      const r = res.find((x) => x.name === origin);
      if (!r) throw new Error(`Stap '${origin}' niet gevonden (of nog niet berekend)`);
      return r.coords;
    }

    runStage(st, stageIndex) {
      const S = { ...this.settings, ...(st.settings || {}) };
      const testing = new V.Testing(S.alpha0, S.beta0);
      const R = { name: st.name, log: [`=== Stap: ${st.name} ===`], coords: {}, r2: null, r1: null, r2_test: null, r1_test: null, net: null, error: null, stage: st,
        checks: { sources: [], leveling: [], gnssOcc: [], precheck: [], snooping: [], faceChecks: [], warnings: [], captivateNo: [], excluded: [], gnssHctrl: null, rules: [], uncontrolled: [] }, repeat: [], lists: {} };
      const log = R.log;
      try {
        const net = new V.Network();
        const lists = {};
        const prevAll = this.results.length ? this.previous("vorige") : {};
        const known = {};
        for (const [n, c] of Object.entries(prevAll)) known[n] = [c.x ?? NaN, c.y ?? NaN, c.H ?? NaN];
        const order = { coords: 0, hexml: 1, move3: 1, gsi: 2 };
        const srcs = [...st.sources].filter((s) => !s.disabled).sort((a, b) => order[a.kind] - order[b.kind]);
        if (!srcs.length) throw new Error("Deze stap heeft nog geen bestanden");
        for (const src of srcs) {
          if (src.kind === "coords") {
            const { lists: c } = this._load(src, S, known, R);
            Object.assign(lists, c);
            for (const [n, v] of Object.entries(c)) known[n] = [0, 1, 2].map((i) => (M.isNum(v[i]) ? v[i] : (known[n] || [NaN, NaN, NaN])[i]));
            continue;
          }
          for (const [n, p] of Object.entries(net.points)) {
            const kc = (known[n] = known[n] || [NaN, NaN, NaN]);
            ["x", "y", "H"].forEach((a, i) => { if (!M.isNum(kc[i]) && M.isNum(p[a])) kc[i] = p[a]; });
          }
          const { net: sub, lists: ctl } = this._load(src, S, known, R);
          for (const [n, v] of Object.entries(ctl || {})) if (!(n in lists)) lists[n] = [...v];
          Project.merge(net, sub, src.tag);
        }
        R.lists = lists;
        for (const [n, p] of Object.entries(net.points)) {
          const kc = known[n];
          if (kc) ["x", "y", "H"].forEach((a, i) => { if (!M.isNum(p[a]) && M.isNum(kc[i])) p[a] = kc[i]; });
          if (lists[n] && lists[n].code && !p.code) p.code = lists[n].code;
        }
        // hernoemen (verkeerd puntnummer)
        for (const rn of st.renames || []) {
          let k = 0;
          for (const o of net.obs) if (o.ref === rn.ref && o.to === rn.from) { o.to = rn.to; o.meta = { ...o.meta, hernoemd: rn.from }; k++; }
          if (k) { net.point(rn.to); log.push(`Hernoemd: ${rn.ref} ${rn.from} → ${rn.to} (${k} waarnemingen)`); }
        }
        // uitschakelen
        let excl = [...(st.exclude_refs || [])];
        if (st.follow_captivate) excl.push(...R.checks.captivateNo);
        if (excl.length) {
          const { n, warn } = V.excludeRefs(net, excl);
          R.checks.excluded = [...new Set(excl)];
          log.push(`Handmatig uitgeschakeld: ${n} waarnemingen`);
          if (warn) { log.push("  " + warn); R.checks.warnings.push(warn); }
        }
        // voorcontrole
        if (st.precheck) {
          const keep = new Set(st.precheck_keep || []);
          for (const g of V.precheck(net, S.precheck_tol_m, S.precheck_tol_mm_per_m / 1000)) {
            const kept = keep.has(g.ref);
            if (!kept) net.removeObs((o) => o.ref === g.ref && o.frm === g.station && o.to === g.doel);
            R.checks.precheck.push({ ...g, kept });
            let msg = `Voorcontrole: ${g.station}→${g.doel} (${g.ref}) wijkt ${f1(g.afwijking_m, 2)} m af → ${kept ? "toch gebruikt (teruggezet)" : "uitgeschakeld"}`;
            if (g.past_op) msg += `; past op punt ${g.past_op} (${f1(g.past_afstand_m * 1000, 0)} mm): verkeerd puntnummer?`;
            log.push(msg);
          }
        }
        // bekende punten
        const pseudo = st.known.some((r) => r.mode === "vast_getoetst" && !r.disabled);
        const netTest = pseudo ? net.clone() : null;
        for (const rule of st.known) {
          if (rule.disabled) continue;
          const names = this._applyRule(net, rule, lists, true, stageIndex);
          if (pseudo) this._applyRule(netTest, rule, lists, false, stageIndex);
          R.checks.rules.push({ rule, names });
          log.push(`Bekend (${rule.dim} ${rule.mode}, uit ${rule.origin}): ${names.sort().join(", ") || "–"}`);
        }
        for (const [n, ov] of Object.entries(st.overrides || {})) {
          if (!net.points[n]) continue;
          for (const t of [net, netTest]) if (t) this._applyOverride(t, n, ov, S);
        }
        // GNSS-hoogtes alleen ter controle
        let gnsshCtrl = [];
        if (st.gnss_heights === "controle") {
          gnsshCtrl = net.obs.filter((o) => o.kind === "GNSSH");
          net.removeObs((o) => o.kind === "GNSSH");
          if (netTest) netTest.removeObs((o) => o.kind === "GNSSH");
        }
        R.net = net;
        const adj = (nw) => new V.Adjustment(nw, { testing, estimateScale: st.estimate_scale });
        if (st.snooping) for (const dim of ["2D", "1D"]) this._snoop(pseudo ? netTest : net, dim, st.snooping, R, adj, pseudo ? net : null, new Set(st.snoop_keep || []));
        if (pseudo) {
          if (netTest.obs.some((o) => V.is2D(o.kind))) {
            R.r2_test = adj(netTest).adjust2d(20);
            log.push(`Toetsing bekende punten 2D (gewogen): F = ${f1(R.r2_test.F, 3)} (kritiek ${f1(R.r2_test.F_crit, 3)})`);
          }
          if (netTest.obs.some((o) => V.is1D(o.kind))) {
            R.r1_test = adj(netTest).adjust1d();
            log.push(`Toetsing bekende punten 1D (gewogen): F = ${f1(R.r1_test.F, 3)} (kritiek ${f1(R.r1_test.F_crit, 3)})`);
          }
          for (const r of [R.r2_test, R.r1_test]) if (r) for (const o of r.obs_results) if ((o.obs.kind === "XY" || o.obs.kind === "HH") && o.rejected) log.push(`    bekend punt verworpen: ${o.obs.frm} toets ${f1(o.w, 2)}`);
        }
        const hasH = net.obs.some((o) => V.is1D(o.kind)), hasXY = net.obs.some((o) => V.is2D(o.kind));
        const dims = st.dims || "auto";
        if (hasXY && dims !== "1D") {
          R.r2 = adj(net).adjust2d(20);
          const r = R.r2;
          if (r.redundancy === 0) log.push("2D: geen overtalligheid (r = 0) → niet toetsbaar; coördinaten = metingen");
          else if (pseudo && R.r2_test) log.push(`2D eindcoördinaten met bekende punten vast (F = ${f1(r.F, 3)}, ter informatie; de toetsing hierboven is maatgevend)`);
          else log.push(`2D: F = ${f1(r.F, 3)} (kritiek ${f1(r.F_crit, 3)}) → ${r.F_ok ? "aanvaard" : "VERWORPEN"}, r = ${r.redundancy}${r.free ? " [vrij netwerk]" : ""}`);
          if (r.extra.scale) log.push(`    schaalfactor ${r.extra.scale[0].toFixed(7)} ± ${r.extra.scale[1].toFixed(7)}`);
        }
        if (hasH && dims !== "2D") {
          R.r1 = adj(net).adjust1d();
          const r = R.r1;
          if (r.redundancy === 0) log.push("1D: geen overtalligheid (r = 0) → niet toetsbaar");
          else log.push(`1D: F = ${f1(r.F, 3)} (kritiek ${f1(r.F_crit, 3)}) → ${r.F_ok ? "aanvaard" : "VERWORPEN"}, r = ${r.redundancy}${r.free ? " [vrij netwerk]" : ""}`);
        }
        for (const r of [R.r2_test || R.r2, R.r1_test || R.r1]) {
          if (!r) continue;
          r.obs_results.filter((o) => o.rejected).sort((a, b) => Math.abs(b.w) / b.w_crit - Math.abs(a.w) / a.w_crit).slice(0, 5)
            .forEach((o) => log.push(`    verworpen: ${o.obs.kind} ${o.obs.frm}→${o.obs.to || ""} (${o.obs.ref || "aansluiting"}) toets ${f1(o.w, 2)}`));
        }
        if (gnsshCtrl.length && R.r1) {
          const d = gnsshCtrl.filter((o) => o.frm in R.r1.coords).map((o) => ({ punt: o.frm, ref: o.ref, mm: (o.value - R.r1.coords[o.frm]) * 1000 }));
          if (d.length) {
            const v = d.map((x) => x.mm), med = M.median(v);
            R.checks.gnssHctrl = { n: d.length, median_mm: med, spread_mm: M.std1(v), items: d, tol_mm: S.gnss_h_ctrl_tol_mm };
            log.push(`GNSS-hoogte min vereffende hoogte (alleen controle, ${d.length} metingen): mediaan ${sg(med)} mm, spreiding ${f1(M.std1(v))} mm`);
            for (const x of d) if (Math.abs(x.mm - med) > S.gnss_h_ctrl_tol_mm) log.push(`    ${x.punt}: ${sg(x.mm, 0)} mm (wijkt > ${S.gnss_h_ctrl_tol_mm} mm af van de mediaan)`);
          }
        }
        // ongecontroleerde punten (één opstelling, geen GNSS, niet bekend)
        const seen = {};
        for (const o of net.obs) {
          if (o.kind === "R") (seen[o.to] = seen[o.to] || new Set()).add(o.set_id);
          else if (o.kind === "GNSS" || o.kind === "XY") (seen[o.frm] = seen[o.frm] || new Set()).add(o.kind + o.ref);
        }
        R.checks.uncontrolled = Object.keys(seen).filter((p) => seen[p].size < 2 && net.points[p] && net.points[p].status_xy === "vrij").sort();
        const names = new Set([...Object.keys(R.r2 ? R.r2.coords : {}), ...Object.keys(R.r1 ? R.r1.coords : {})]);
        for (const n of names) {
          const p = net.points[n];
          if (p.code === "HI") continue;
          const c = { code: p.code || "", status_xy: p.status_xy, status_h: p.status_h };
          if (R.r2 && n in R.r2.coords) Object.assign(c, { x: R.r2.coords[n][0], y: R.r2.coords[n][1], sx: R.r2.sd[n][0], sy: R.r2.sd[n][1] });
          if (R.r1 && n in R.r1.coords) Object.assign(c, { H: R.r1.coords[n], sH: R.r1.sd[n] });
          R.coords[n] = c;
        }
      } catch (e) {
        R.error = e.message || String(e);
        log.push("FOUT: " + R.error);
      }
      return R;
    }

    _applyOverride(net, n, ov, S) {
      const p = net.points[n];
      for (const [dim, key] of [["2D", "xy"], ["1D", "h"]]) {
        const m = ov[key];
        if (!m) continue;
        if (m === "vrij") {
          net.obs = net.obs.filter((o) => !(o.frm === n && o.kind === (dim === "2D" ? "XY" : "HH")));
          if (dim === "2D") { p.status_xy = "vrij"; p.fix_xy = false; } else { p.status_h = "vrij"; p.fix_h = false; }
        } else {
          const okc = dim === "2D" ? M.isNum(p.x) && M.isNum(p.y) : M.isNum(p.H);
          if (!okc) continue;
          net.setKnown(n, dim, m, { sxy_mm: ov.sxy_mm || S.default_sxy_mm || 10, sh_mm: ov.sh_mm || S.default_sh_mm || 2 });
        }
      }
    }

    _snoop(net, dim, maxrem, R, adj, mirror, keep) {
      const kinds = dim === "2D" ? V.is2D : V.is1D;
      if (!net.obs.some((o) => kinds(o.kind))) return;
      for (let k = 0; k < maxrem; k++) {
        const r = dim === "2D" ? adj(net).adjust2d(20) : adj(net).adjust1d();
        const rej = r.obs_results.filter((o) => o.rejected && kinds(o.obs.kind) && !keep.has(o.obs.ref || o.obs.kind + ":" + o.obs.frm));
        if (!rej.length) return;
        // grootste genormeerde toetsgrootheid; bij (numeriek) gelijke waarden de eerste waarneming
        const score = (o) => Math.abs(o.w) / o.w_crit;
        const top = Math.max(...rej.map(score));
        const w = rej.find((o) => score(o) >= top * (1 - 1e-9));
        const o = w.obs;
        const v0 = (x) => Math.round((Array.isArray(x.value) ? x.value[0] : x.value) * 1e6);
        const same = (x) => x.kind === o.kind && x.frm === o.frm && x.to === o.to && x.ref === o.ref && v0(x) === v0(o);
        net.obs = net.obs.filter((x) => !same(x));
        if (mirror) mirror.obs = mirror.obs.filter((x) => !same(x));
        const item = { dim, kind: o.kind, frm: o.frm, to: o.to, ref: o.ref || o.kind + ":" + o.frm, w: w.w, w_crit: w.w_crit };
        if (o.kind === "XY" || o.kind === "HH") {
          for (const t of [net, mirror]) if (t && t.points[o.frm]) {
            const p = t.points[o.frm];
            if (o.kind === "XY") { p.status_xy = "vrij"; p.fix_xy = false; } else { p.status_h = "vrij"; p.fix_h = false; }
            t.obs = t.obs.filter((x) => !(x.frm === o.frm && x.kind === o.kind));
          }
          item.tekst = `bekend punt ${o.frm} (${o.kind === "XY" ? "ligging" : "hoogte"}) verworpen, toets ${f1(w.w, 1)} → vrijgelaten`;
        } else {
          const est = w.resid.length === 1 && w.redundancy > 1e-6 ? -w.resid[0] / w.redundancy * 1000 : NaN;
          item.est = est; item.unit = o.kind === "R" ? "mgon" : "mm";
          item.tekst = `${o.kind} ${o.frm}→${o.to || ""} (${o.ref}) verwijderd, w = ${f1(w.w, 2)}, geschatte fout ${sg(est)} ${item.unit}`;
        }
        R.checks.snooping.push(item);
        R.log.push("    data snooping: " + item.tekst);
      }
    }

    _applyRule(net, rule, lists, final, stageIndex) {
      let src;
      if (rule.origin === "lijst") { src = {}; for (const [n, v] of Object.entries(lists)) src[n] = { x: v[0], y: v[1], H: v[2] }; }
      else src = this.previous(rule.origin, stageIndex);
      let mode = rule.mode;
      if (mode === "vast_getoetst") mode = final ? "vast" : "gewogen";
      const names = Object.keys(net.points).filter((n) => n in src && net.points[n].code !== "HI" && (!rule.codes || !rule.codes.length || rule.codes.includes(net.points[n].code)) && matchPoints(n, rule.points));
      const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
      for (const n of names) {
        const c = src[n];
        const wantXY = rule.dim !== "1D" && M.isNum(c.x) && M.isNum(c.y);
        const wantH = rule.dim !== "2D" && M.isNum(c.H);
        if (wantXY) {
          const sxy = num(rule.sxy_mm) !== null ? num(rule.sxy_mm) : Math.max(c.sx || 0, c.sy || 0) * 1000;
          const m = mode === "vast" || sxy > 0 ? mode : "vast";
          net.setKnown(n, "2D", m, { x: c.x, y: c.y, sxy_mm: sxy });
        }
        if (wantH) {
          const sh = num(rule.sh_mm) !== null ? num(rule.sh_mm) : (c.sH || 0) * 1000;
          const m = mode === "vast" || sh > 0 ? mode : "vast";
          net.setKnown(n, "1D", m, { H: c.H, sh_mm: sh });
        }
      }
      return names;
    }

    run(upto) {
      this.results = [];
      const n = upto === undefined ? this.stages.length : upto + 1;
      for (let i = 0; i < n; i++) this.results.push(this.runStage(this.stages[i], i));
      return this.results;
    }
  }

  Object.assign(V, { Project, newStage, matchPoints, readTco, readObsM3, move3Network });
})(globalThis.V = globalThis.V || {});
