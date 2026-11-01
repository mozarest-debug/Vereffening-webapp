// ===================================================================== hexml.js
// Leica Captivate LandXML/HeXML -> netwerk (TPS ruwe waarnemingen + GNSS + bekende punten).
(function (V) {
  "use strict";
  const M = V.M;
  const NL = "http://www.landxml.org/schema/LandXML-1.2";
  const NH = "http://xml.hexagon.com/schema/HeXML-2.1";

  V.parseXML = function (text) {
    const P = typeof DOMParser !== "undefined" ? DOMParser : require("@xmldom/xmldom").DOMParser;
    const doc = new P().parseFromString(text, "text/xml");
    const err = doc.getElementsByTagName("parsererror");
    if (err && err.length) throw new Error("XML kan niet gelezen worden");
    return doc;
  };
  const all = (el, ns, tag) => Array.from(el.getElementsByTagNameNS(ns, tag));
  const kids = (el, ns, tag) => Array.from(el.childNodes).filter((c) => c.nodeType === 1 && c.namespaceURI === ns && c.localName === tag);
  const kid = (el, ns, tag) => kids(el, ns, tag)[0] || null;
  const attr = (el, a) => (el && el.hasAttribute(a) ? el.getAttribute(a) : null);
  const f = (v, d = NaN) => { if (v === null || v === undefined || v === "") return d; const x = Number(v); return Number.isFinite(x) ? x : d; };
  const base = (n) => n.split("@")[0];

  function rdJacobian(t, lat, lon) {
    const a = 6378137.0, fl = 1 / 298.257222101, e2 = fl * (2 - fl), phi = lat * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), Mm = N * (1 - e2) / (1 - e2 * Math.sin(phi) ** 2);
    const dlat = 180 / Math.PI / Mm, dlon = 180 / Math.PI / (N * Math.cos(phi));
    const [x0, y0] = t.etrs89ToRd(lat, lon), [xe, ye] = t.etrs89ToRd(lat, lon + dlon), [xn, yn] = t.etrs89ToRd(lat + dlat, lon);
    return [[xe - x0, xn - x0], [ye - y0, yn - y0]];
  }
  function ecefToEnuCov(C, lat, lon) {
    const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
    const R = [[-Math.sin(l), Math.cos(l), 0], [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]];
    const RC = R.map((r) => [0, 1, 2].map((j) => r[0] * C[0][j] + r[1] * C[1][j] + r[2] * C[2][j]));
    return RC.map((r) => R.map((q) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2]));
  }

  function loadHexml(text, trans, S) {
    const doc = V.parseXML(text);
    const net = new V.Network();
    const res = { net, setups: {}, control: {}, gnss: {}, triplets: {}, warnings: [], uncontrolled: [], kind: "hexml" };
    // ---- punten
    const approx = {}, codes = {};
    for (const p of all(doc, NH, "Point")) {
      const uid = attr(p, "uniqueID");
      if (!uid) continue;
      const g = all(p, NH, "Grid")[0];
      const ce = kid(p, NH, "PointCode");
      const code = ce ? attr(ce, "code") || "" : "";
      const xyz = g ? [f(attr(g, "e")), f(attr(g, "n")), f(attr(g, "hghthO"))] : [NaN, NaN, NaN];
      const cls = attr(p, "class"), b = base(uid);
      if (uid.includes("@")) res.triplets[uid] = { use: attr(p, "averageUsage") === "true", x: xyz[0], y: xyz[1], H: xyz[2], state: attr(p, "averageState") };
      if (cls === "control") res.control[b] = xyz;
      if (!(b in approx) || !uid.includes("@")) approx[b] = xyz;
      if (code) codes[b] = code;
    }
    for (const [b, xyz] of Object.entries(approx)) net.point(b, { x: xyz[0], y: xyz[1], H: xyz[2], code: codes[b] || "" });
    const lsetups = all(doc, NL, "InstrumentSetup");
    for (const s of lsetups) {
      const ip = kid(s, NL, "InstrumentPoint");
      if (ip && ip.textContent.trim()) {
        const [n, e, h] = ip.textContent.trim().split(/\s+/).map(Number);
        net.point(attr(s, "stationName"), { x: e, y: n, H: h, code: "906" });
      }
    }
    const hraw = {};
    for (const s of all(doc, NH, "InstrumentSetup")) for (const r of kids(s, NH, "RawObservation")) hraw[attr(r, "targetPntRef")] = r;
    // ---- TPS
    const setupStation = {}, ihs = {};
    for (const s of lsetups) { setupStation[attr(s, "id")] = attr(s, "stationName"); ihs[attr(s, "id")] = f(attr(s, "instrumentHeight"), 0); }
    for (const grp of all(doc, NL, "ObservationGroup")) {
      const sid = (attr(grp, "id") || "").slice(1);
      const st = setupStation[sid];
      if (!st) continue;
      const ih = ihs[sid] || 0;
      const info = { station: st, n: 0, date: null };
      for (const o of kids(grp, NL, "RawObservation")) {
        const tp = kid(o, NL, "TargetPoint");
        if (!tp) continue;
        const ref = attr(tp, "pntRef"), tgt = base(ref);
        const hz = f(attr(o, "horizAngle")), z = f(attr(o, "zenithAngle")), sd = f(attr(o, "slopeDistance")), th = f(attr(o, "targetHeight"), 0);
        if (!M.isNum(hz)) continue;
        const hr = hraw[ref];
        const two = !!hr && attr(hr, "meanFace") === "true";
        const prism = !!hr && attr(hr, "edmKind") === "reflector";
        const refl = (hr && attr(hr, "reflectorName")) || (prism ? "?" : "RL");
        const constMm = hr ? f(attr(hr, "reflectorConstant")) * 1000 : NaN;
        const exp = V.LEICA_CONSTANTS[refl.toUpperCase()];
        if (exp !== undefined && Math.abs(constMm - exp) > 0.05)
          res.warnings.push(`Prismaconstante ${ref}: ${refl} staat op ${fmtS(constMm)} mm, Leica-standaard is ${fmtS(exp)} mm.`);
        const tri = res.triplets[ref];
        const meta = { setup: sid, purpose: attr(o, "purpose"), faces: two ? 2 : 1, edm: prism ? "prisma" : "reflectorloos", reflector: refl, const_mm: constMm, captivate_use: tri ? tri.use : null, time: attr(o, "timeStamp") };
        info.date = info.date || (attr(o, "timeStamp") || "").slice(0, 10);
        if (!net.points[tgt]) net.point(tgt);
        V.addTpsObservation(net, st, tgt, hz, M.isNum(z) ? z : 100, M.isNum(sd) ? sd : 0, ih, th, S, { set_id: sid, faces: two ? 2 : 1, prism, ref, meta });
        info.n++;
      }
      res.setups[sid] = info;
    }
    // ---- GNSS
    const gps = [], seen = new Set();
    for (const gs of all(doc, NL, "GPSSetup")) for (const gp of kids(gs, NL, "GPSPosition")) { gps.push([attr(gs, "id"), gp]); seen.add(gp); }
    for (const gp of all(doc, NL, "GPSPosition")) if (!seen.has(gp)) gps.push([null, gp]);
    for (const [setupId, gp] of gps) {
      const name = attr(gp, "pntRef");
      const q = kid(gp, NL, "GPSQCInfoLevel2");
      if (!q || !name) continue;
      const lat = f(attr(gp, "wgsLatitude")), lon = f(attr(gp, "wgsLongitude")), h = f(attr(gp, "wgsHeight"));
      const [x, y, Hn] = trans.etrs89ToRdnap(lat, lon, h);
      const c = (k) => f(attr(q, k), 0);
      const Cx = [[c("covarianceXX"), c("covarianceXY"), c("covarianceXZ")], [c("covarianceXY"), c("covarianceYY"), c("covarianceYZ")], [c("covarianceXZ"), c("covarianceYZ"), c("covarianceZZ")]];
      const Ce = ecefToEnuCov(Cx, lat, lon);
      const J = rdJacobian(trans, lat, lon);
      const C2 = [[Ce[0][0], Ce[0][1]], [Ce[1][0], Ce[1][1]]];
      const JC = J.map((r) => [r[0] * C2[0][0] + r[1] * C2[1][0], r[0] * C2[0][1] + r[1] * C2[1][1]]);
      const Cxy = JC.map((r) => J.map((s) => r[0] * s[0] + r[1] * s[1]));
      const formal = [Math.sqrt(Cxy[0][0]) * 1000, Math.sqrt(Cxy[1][1]) * 1000];
      const sc = Math.max(1, S.gnss_min_xy_mm / Math.max(Math.max(...formal), 1e-6));
      const cc = (S.gnss_centr_mm / 1000) ** 2;
      const Cu = [[Cxy[0][0] * sc * sc + cc, Cxy[0][1] * sc * sc], [Cxy[1][0] * sc * sc, Cxy[1][1] * sc * sc + cc]];
      const sH = Math.max(Math.sqrt(Ce[2][2]) * 1000, S.gnss_min_h_mm);
      const tp = kid(gp, NL, "TargetPoint");
      const cap = tp && tp.textContent.trim() ? tp.textContent.trim().split(/\s+/).map(Number) : null;
      res.gnss[name] = res.gnss[name] || { x, y, H: Hn, formal_mm: [...formal, Math.sqrt(Ce[2][2]) * 1000], captivate: cap ? [cap[1], cap[0], cap[2]] : null, n: 0 };
      res.gnss[name].n++;
      const gref = setupId ? `${name}@${setupId}` : name;
      const meta = { lat, lon, h, formal_mm: formal.map((v) => Math.round(v * 10) / 10), bezetting: setupId, epochs: f(attr(q, "numberOfEpochs") || attr(gp, "numberOfEpochs"), null) };
      net.gnssXY(name, x, y, Math.sqrt(Cu[0][0]), Math.sqrt(Cu[1][1]), Cu[0][1], gref, meta);
      net.gnssH(name, Hn, sH, gref, meta);
      const p = net.points[name] || net.point(name);
      if (!M.isNum(p.x)) net.point(name, { x, y, H: Hn });
    }
    // ---- controle: ongecontroleerde punten
    const seenBy = {};
    for (const o of net.obs) {
      if (o.kind === "R") (seenBy[o.to] = seenBy[o.to] || new Set()).add(o.frm);
      else if (o.kind === "GNSS") (seenBy[o.frm] = seenBy[o.frm] || new Set()).add("GNSS");
    }
    res.uncontrolled = Object.keys(seenBy).filter((p) => seenBy[p].size < 2).sort();
    const used = new Set();
    for (const o of net.obs) { used.add(o.frm); if (o.to) used.add(o.to); }
    for (const k of Object.keys(net.points)) if (!used.has(k)) delete net.points[k];
    return res;
  }
  const fmtS = (v) => (v >= 0 ? "+" : "") + v.toFixed(1).replace(".", ",");

  // Waarnemingen per Captivate-meting uitschakelen (met waarschuwing bij verlies GNSS-verbinding)
  function excludeRefs(net, refs) {
    refs = new Set(refs);
    const gnss = new Set(net.obs.filter((o) => o.kind === "GNSS").map((o) => o.frm));
    const before = new Set(net.obs.filter((o) => o.kind === "R" && gnss.has(o.to)).map((o) => o.to));
    const n = net.removeObs((o) => refs.has(o.ref));
    const after = new Set(net.obs.filter((o) => o.kind === "R" && gnss.has(o.to)).map((o) => o.to));
    const lost = [...before].filter((p) => !after.has(p)).sort();
    let warn = null;
    if (lost.length) {
      warn = `Let op: ${lost.length} van de ${before.size} GNSS-punten zijn niet meer met de total station verbonden (${lost.join(", ")}).`;
      if (!after.size) warn += " Het netwerk heeft dan geen aansluiting op RD meer.";
    }
    return { n, warn };
  }

  // Herhaalde metingen binnen een opstelling (verdraaiend statief)
  function repeatCheck(net) {
    const by = new Map();
    for (const o of net.obs) if (o.kind === "R" && o.meta && o.meta.setup) {
      const k = o.meta.setup + "\u0000" + o.to;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(o);
    }
    const out = [];
    for (const lst of by.values()) {
      if (lst.length < 2) continue;
      lst.sort((a, b) => String(a.meta.time || "").localeCompare(String(b.meta.time || "")));
      const a = lst[0], b = lst[lst.length - 1];
      const find = (kind, ref) => net.obs.find((o) => o.kind === kind && o.ref === ref);
      const sa = find("S", a.ref), sb = find("S", b.ref), ha = find("DH", a.ref), hb = find("DH", b.ref);
      const dt = (Date.parse(b.meta.time) - Date.parse(a.meta.time)) / 60000;
      out.push({ setup: a.meta.setup, target: a.to, refs: [a.ref, b.ref], minutes: dt, d_hz_mgon: V.wrapGon(b.value - a.value) * 1000, d_s_mm: sa && sb ? (sb.value - sa.value) * 1000 : NaN, d_h_mm: ha && hb ? (hb.value - ha.value) * 1000 : NaN });
    }
    return out;
  }

  Object.assign(V, { loadHexml, excludeRefs, repeatCheck });
})(globalThis.V = globalThis.V || {});
