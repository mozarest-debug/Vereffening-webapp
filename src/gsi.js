// ===================================================================== gsi.js
// Leica GSI8/GSI16: total station en digitale waterpassing; coördinatenlijsten.
(function (V) {
  "use strict";
  const M = V.M;
  const DIST_UNITS = { 0: 1e-3, 1: 0.3048e-3, 6: 1e-4, 7: 0.3048e-4, 8: 1e-5 };

  function word(wi, info, unit, sign, data) {
    return {
      wi, info, unit, sign, data,
      number() { const d = data.replace(/^0+/, "") || "0"; const v = Number(sign + d); return Number.isFinite(v) ? v : NaN; },
      text() { const t = data.replace(/^\.+|\.+$/g, "").replace(/^0+/, ""); return t || "0"; },
      distance() { return this.number() * (DIST_UNITS[unit] !== undefined ? DIST_UNITS[unit] : 1e-3); },
      angleGon() {
        const v = this.number();
        if (unit === "2") return v * 1e-5;
        if (unit === "3") return v * 1e-5 * 400 / 360;
        if (unit === "4") {
          const s = String(Math.abs(Math.trunc(v))).padStart(9, "0");
          const deg = +s.slice(0, -5) + +s.slice(-5, -3) / 60 + +s.slice(-3) / 36000;
          return Math.sign(v) * deg * 400 / 360;
        }
        return v * 1e-5;
      },
    };
  }

  function parseLine(line) {
    line = line.trim();
    if (!line) return [];
    if (line[0] === "*") line = line.slice(1);
    const words = [];
    for (const tok of line.split(/\s+/)) {
      if (tok.length < 8) continue;
      const m = /[+-]/.exec(tok.slice(6));
      if (!m) continue;
      const sp = 6 + m.index;
      const head = tok.slice(0, sp), sign = tok[sp], data = tok.slice(sp + 1);
      let wi, info;
      if (head.slice(0, 2) === "11" || head.slice(0, 2) === "41") { wi = head.slice(0, 2); info = head.slice(2); }
      else if (/\d/.test(head[2])) { wi = head.slice(0, 3); info = head.slice(3); }
      else { wi = head.slice(0, 2); info = head.slice(2); }
      words.push(word(wi, info, head[head.length - 1], sign, data));
    }
    return words;
  }
  const readGsi = (text) => text.split(/\r?\n/).map(parseLine).filter((w) => w.length);
  function detectKind(blocks) {
    const wis = new Set(blocks.flat().map((w) => w.wi));
    if (wis.has("331") || wis.has("332") || wis.has("333")) return "waterpassing";
    if (wis.has("21") || wis.has("22")) return "tps";
    return "onbekend";
  }
  const dict = (b) => { const d = {}; for (const w of b) d[w.wi] = w; return d; };

  // ------------------------------------------------------------- TPS
  const TPS_CODES = { station_code: "81", target_code: "83", point_word: "42", height_word: "43", height_scale: 1e-3 };
  function parseTps(blocks, codes, tag = "") {
    codes = codes || TPS_CODES;
    const res = { records: [], raw: [], face_checks: [], stations: [], warnings: [] };
    let station = null, ih = 0, th = 0, setno = 0;
    for (const b of blocks) {
      const d = dict(b);
      if (b[0].wi === "41") {
        const code = b[0].text();
        if (code === codes.station_code) {
          if (d[codes.point_word]) station = d[codes.point_word].text();
          if (d[codes.height_word]) ih = d[codes.height_word].number() * codes.height_scale;
          setno++; res.stations.push([station, ih]);
        } else if (code === codes.target_code && d[codes.height_word]) th = d[codes.height_word].number() * codes.height_scale;
        continue;
      }
      if (d["84"] && d["11"] && !d["21"]) {
        station = d["11"].text(); setno++;
        if (d["88"]) ih = d["88"].distance();
        res.stations.push([station, ih]);
        continue;
      }
      if (d["88"]) ih = d["88"].distance();
      if (d["87"]) th = d["87"].distance();
      if (d["21"] && d["11"]) {
        if (station === null) { res.warnings.push("Meting zonder standplaats overgeslagen"); continue; }
        const sd = d["31"] ? d["31"].distance() : (d["32"] && d["22"] ? d["32"].distance() / Math.sin(d["22"].angleGon() * Math.PI / 200) : 0);
        res.raw.push({ station, target: d["11"].text(), hz: d["21"].angleGon(), z: d["22"] ? d["22"].angleGon() : 100, sd, ih, th, set_id: `${tag}${station}#${setno}` });
      }
    }
    const raw = res.raw;
    let i = 0;
    while (i < raw.length) {
      let j = i;
      while (j + 1 < raw.length && raw[j + 1].target === raw[i].target && raw[j + 1].set_id === raw[i].set_id) j++;
      const grp = raw.slice(i, j + 1);
      const f1 = grp.filter((r) => r.z < 200), f2 = grp.filter((r) => r.z >= 200);
      const hz1 = [...f1.map((r) => r.hz), ...f2.map((r) => V.mod(r.hz - 200, 400))];
      const ref = hz1[0];
      const hz = V.mod(ref + M.mean(hz1.map((h) => V.mod(h - ref + 200, 400) - 200)), 400);
      const zs = [...f1.map((r) => r.z), ...f2.map((r) => 400 - r.z)];
      const rec = { ...grp[0], hz, z: M.mean(zs), sd: M.mean(grp.map((r) => r.sd)), faces: f1.length && f2.length ? 2 : 1, n: grp.length };
      if (f1.length && f2.length) {
        const c = (M.mean(f1.map((r) => r.hz)) - M.mean(f2.map((r) => V.mod(r.hz - 200, 400)))) / 2;
        const ix = (M.mean(f1.map((r) => r.z)) + M.mean(f2.map((r) => r.z)) - 400) / 2;
        const sds = grp.map((r) => r.sd);
        res.face_checks.push({ station: rec.station, target: rec.target, c_mgon: V.wrapGon(c) * 1000, i_mgon: ix * 1000, dS_mm: (Math.max(...sds) - Math.min(...sds)) * 1000 });
      }
      res.records.push(rec);
      i = j + 1;
    }
    return res;
  }
  function addTpsToNetwork(net, tps, known, S, prism = true, refPrefix = "") {
    const approx = V.approximate(tps.records, known);
    for (const [name, [x, y, h]] of Object.entries(approx)) {
      const p = net.points[name];
      if (!p || (!M.isNum(p.x) && M.isNum(x))) net.point(name, { x, y, H: h });
      else if (!M.isNum(p.H) && M.isNum(h)) p.H = h;
    }
    for (const r of tps.records) {
      const a = approx[r.target];
      if (!a || !M.isNum(a[0]) || !approx[r.station] || !M.isNum(approx[r.station][0])) { tps.warnings.push(`Geen benadering voor ${r.target} (meting overgeslagen)`); continue; }
      V.addTpsObservation(net, r.station, r.target, r.hz, r.z, r.sd, r.ih, r.th, S, { set_id: r.set_id, faces: r.faces, prism, ref: `${refPrefix}${r.station}->${r.target}`, meta: { setup: r.set_id, bron: refPrefix.replace(/:$/, "") } });
    }
    return approx;
  }

  // ------------------------------------------------------------- waterpassing
  function parseLeveling(blocks, keep = new Set(), tag = "", tpMaxlen = 3) {
    const res = { setups: [], start: null, computed: {}, turning: [], lines: [], repeat_diffs: [], misclosure_mm: NaN, length_m: 0, warnings: [] };
    let cur = null, line = -1, expectStart = true;
    const seq = [];
    for (const b of blocks) {
      const d = dict(b);
      if (b[0].wi === "41") { expectStart = true; continue; }
      if (!d["11"]) continue;
      const p = d["11"].text();
      const dist = d["32"] ? d["32"].distance() : null;
      const reading = ["331", "332", "333", "335", "336"].some((k) => d[k]);
      const ctrl = d["573"] || d["574"];
      if (d["83"] && !reading && !ctrl && expectStart) {
        line++;
        res.lines.push({ start: [p, d["83"].distance()], setups: [] });
        if (!res.start) res.start = [p, d["83"].distance()];
        expectStart = false;
        continue;
      }
      if (d["83"] && !reading) { res.computed[p] = d["83"].distance(); continue; }
      expectStart = false;
      if (line < 0) { line = 0; res.lines.push({ start: null, setups: [] }); }
      if (d["331"]) {
        cur = { bs: [p, d["331"].distance(), dist || 0], reads: [], line, n_bs: 1, diffs: [] };
        res.setups.push(cur);
        res.lines[line].setups.push(res.setups.length - 1);
        seq.push(["BS", p, res.setups.length - 1]);
      } else if (d["335"] && cur && cur.bs[0] === p) {
        const r2 = d["335"].distance(), [p0, r1, d1] = cur.bs;
        cur.diffs.push(["achterslag", p, (r2 - r1) * 1000]);
        cur.bs = [p0, (r1 * cur.n_bs + r2) / (cur.n_bs + 1), !dist ? d1 : (d1 + dist) / 2];
        cur.n_bs++;
      } else if (d["336"] && cur) {
        const r2 = d["336"].distance();
        for (let k = cur.reads.length - 1; k >= 0; k--) {
          const [q, r1, d1, kind, nn0] = cur.reads[k];
          if (q === p && kind === "voorslag") {
            const nn = nn0 || 1;
            cur.diffs.push(["voorslag", p, (r2 - r1) * 1000]);
            cur.reads[k] = [q, (r1 * nn + r2) / (nn + 1), !dist ? d1 : (d1 + dist) / 2, kind, nn + 1];
            break;
          }
        }
      } else if (d["333"] && cur) cur.reads.push([p, d["333"].distance(), dist || 0, "zijslag", 1]);
      else if (d["332"] && cur) { cur.reads.push([p, d["332"].distance(), dist || 0, "voorslag", 1]); seq.push(["FS", p, res.setups.length - 1]); }
    }
    // wisselpunten
    const tpOcc = new Map();
    for (let k = 0; k < seq.length - 1; k++)
      if (seq[k][0] === "FS" && seq[k + 1][0] === "BS" && seq[k][1] === seq[k + 1][1]) {
        if (!tpOcc.has(seq[k][1])) tpOcc.set(seq[k][1], []);
        tpOcc.get(seq[k][1]).push([seq[k][2], seq[k + 1][2]]);
      }
    const usedElsewhere = new Set();
    for (const s of res.setups) for (const r of s.reads) if (r[3] === "zijslag") usedElsewhere.add(r[0]);
    for (const l of res.lines) if (l.start) usedElsewhere.add(l.start[0]);
    for (const [name, occ] of tpOcc) {
      if (keep.has(name) || usedElsewhere.has(name) || name.length > tpMaxlen) continue;
      if (occ.length > 1 || tag) {
        occ.forEach(([a, bi], n) => {
          const nw = `${tag}${name}#${n + 1}`;
          const s = res.setups[a];
          s.reads = s.reads.map((r) => (r[0] === name && r[3] === "voorslag" ? [nw, ...r.slice(1)] : r));
          const s2 = res.setups[bi];
          s2.bs = [nw, ...s2.bs.slice(1)];
          res.turning.push(nw);
        });
      }
    }
    res.setups.forEach((s, i) => (s.hi = `${tag}HI${i + 1}`));
    for (const L of res.lines) {
      let h = L.start ? L.start[1] : 0, last = null;
      L.length_m = 0;
      for (const si of L.setups) {
        const s = res.setups[si], hi = h + s.bs[1];
        const fs = s.reads.filter((r) => r[3] === "voorslag");
        if (fs.length) { h = hi - fs[fs.length - 1][1]; last = fs[fs.length - 1][0]; }
        L.length_m += s.bs[2] + (fs.length ? fs[fs.length - 1][2] : 0);
      }
      L.end = [last, h];
      L.misclosure_mm = NaN;
      const first = res.lines[0];
      if (L.start && last === L.start[0]) L.misclosure_mm = (h - L.start[1]) * 1000;
      else if (first.start && last === first.start[0] && L !== first) L.misclosure_mm = (h - first.start[1]) * 1000;
      res.length_m += L.length_m;
    }
    if (res.lines.length && res.lines[0].start) {
      let h = res.lines[0].start[1];
      for (const L of res.lines) h += L.end[1] - (L.start ? L.start[1] : 0);
      if (res.lines[res.lines.length - 1].end[0] === res.lines[0].start[0]) res.misclosure_mm = (h - res.lines[0].start[1]) * 1000;
    }
    res.repeat_diffs = res.setups.flatMap((s) => s.diffs.map((x) => [s.hi, ...x]));
    return res;
  }

  function sectionCheck(lev, tolSqrtKm = 2.0, tolMin = 0.5) {
    const tp = new Set(lev.turning), secs = [];
    lev.lines.forEach((L, li) => {
      const named = [];
      let h = 0, cum = 0;
      if (L.start) named.push([L.start[0], 0, 0]);
      for (const si of L.setups) {
        const s = lev.setups[si], hi = h + s.bs[1];
        cum += s.bs[2];
        const fs = s.reads.filter((r) => r[3] === "voorslag");
        if (fs.length) {
          const f = fs[fs.length - 1];
          h = hi - f[1]; cum += f[2];
          if (!tp.has(f[0]) && !f[0].includes("#")) named.push([f[0], h, cum]);
        }
      }
      for (let k = 0; k + 1 < named.length; k++) secs.push({ line: li, a: named[k][0], b: named[k + 1][0], dh: named[k + 1][1] - named[k][1], L: named[k + 1][2] - named[k][2] });
    });
    const out = [], used = new Set();
    secs.forEach((s1, i) => secs.forEach((s2, j) => {
      if (j <= i || s1.line === s2.line || used.has(i) || used.has(j)) return;
      if (s1.a === s2.b && s1.b === s2.a) {
        const eps = (s1.dh + s2.dh) * 1000, Lm = (s1.L + s2.L) / 2;
        const tol = Math.max(tolMin, tolSqrtKm * Math.sqrt(Lm / 1000));
        out.push({ van: s1.a, naar: s1.b, dh_heen: s1.dh, dh_terug: s2.dh, verschil_mm: eps, lengte_m: Lm, tol_mm: tol, ok: Math.abs(eps) <= tol });
        used.add(i); used.add(j);
      }
    }));
    return out;
  }
  const n1 = (v, d = 1) => v.toFixed(d).replace(".", ",");
  const sg = (v, d = 2) => (v >= 0 ? "+" : "−") + n1(Math.abs(v), d);
  function diagnoseSections(secs) {
    const out = [];
    let i = 0;
    while (i < secs.length) {
      const s = secs[i];
      if (s.ok) { i++; continue; }
      const t = secs[i + 1];
      if (t && !t.ok && s.naar === t.van) {
        const a = s.verschil_mm, b = t.verschil_mm;
        if (a * b < 0 && Math.abs(a + b) < 0.25 * Math.max(Math.abs(a), Math.abs(b))) {
          const rest = a + b;
          out.push({ punt: s.naar, tekst: `Punt ${s.naar}: hoogte verschilt ${n1(Math.abs(a))} mm tussen heen en terug (baak niet op hetzelfde punt / verkeerd puntnummer). Restverschil over beide secties ${sg(rest)} mm` + (Math.abs(rest) > Math.max(s.tol_mm, t.tol_mm) ? " → daarnaast nog een fout in dit deel!" : ".") });
          i += 2; continue;
        }
      }
      out.push({ punt: null, tekst: `Sectie ${s.van} – ${s.naar}: verschil ${sg(s.verschil_mm)} mm > ${n1(s.tol_mm, 2)} mm (fout binnen deze sectie: wisselpunt verzakt, aflezing of baak).` });
      i++;
    }
    return out;
  }
  function addLevelingToNetwork(net, lev, S, refPrefix = "") {
    for (const s of lev.setups)
      V.addLevelingSetup(net, s.hi, s.bs, s.reads, S, s.hi.startsWith(refPrefix) ? s.hi : refPrefix + s.hi, { bron: refPrefix.replace(/:$/, ""), traject: (s.line || 0) + 1 }, s.n_bs || 1);
    if (lev.start) {
      const H = { [lev.start[0]]: lev.start[1] };
      for (let it = 0; it <= lev.setups.length; it++)
        for (const s of lev.setups) if (s.bs[0] in H) {
          H[s.hi] = H[s.bs[0]] + s.bs[1];
          for (const r of s.reads) if (!(r[0] in H)) H[r[0]] = H[s.hi] - r[1];
        }
      for (const [p, h] of Object.entries(H)) { const q = net.points[p] || net.point(p); if (!M.isNum(q.H)) q.H = h; }
    }
    for (const s of lev.setups) if (net.points[s.hi]) net.points[s.hi].code = "HI";
    return net;
  }

  // ------------------------------------------------------------- coördinatenlijst
  function readCoordinates(text) {
    const out = {};
    let cols = null;
    for (let line of text.replace(/^﻿/, "").split(/\r?\n/)) {
      line = line.trim();
      if (!line || line[0] === "#" || line[0] === "$") continue;
      let parts;
      if (line.includes(";")) parts = line.split(";").map((p) => p.trim().replace(/,/g, "."));
      else if (line.includes("\t")) parts = line.split("\t").map((p) => p.trim());
      else if ((line.match(/,/g) || []).length >= 2) parts = line.split(",").map((p) => p.trim());
      else parts = line.split(/\s+/);
      const low = parts.map((p) => p.toLowerCase());
      if (!cols && low.includes("x") && low.includes("y")) { cols = [low.indexOf("x"), low.indexOf("y"), low.includes("h") ? low.indexOf("h") : null, low.indexOf("code")]; continue; }
      const [ix, iy, ih, ic] = cols || [1, 2, 3, -1];
      const val = (i) => (i === null || i >= parts.length || parts[i] === "" || parts[i] === "*" ? NaN : Number(parts[i]));
      const v = [val(ix), val(iy), val(ih)];
      if ([ix, iy, ih].some((i) => i !== null && i < parts.length && parts[i] !== "" && parts[i] !== "*" && !Number.isFinite(Number(parts[i])))) continue;
      out[parts[0]] = v;
      if (ic >= 0 && parts[ic]) out[parts[0]].code = parts[ic];
    }
    return out;
  }

  Object.assign(V, { parseLine, readGsi, detectKind, TPS_CODES, parseTps, addTpsToNetwork, parseLeveling, sectionCheck, diagnoseSections, addLevelingToNetwork, readCoordinates });
})(globalThis.V = globalThis.V || {});
