// ===================================================================== trimble.js
// Trimble-formaten: DiNi M5 (.DAT, waterpassing), Survey Controller DC (.dc, GNSS)
// en Trimble Access .job (total station, binair; experimenteel – formaat is niet gepubliceerd).
(function (V) {
  "use strict";
  const M = V.M;

  // ------------------------------------------------------------- korte ↔ lange puntnamen
  // DiNi-velden zijn 5 tekens: "414" → "gp-0414", "NAP" → "nap-0001" (als dat uniek is).
  const stripZ = (s) => String(s).toLowerCase().replace(/^0+(?=.)/, "");
  function mapShortNames(names, known) {
    const kn = [...known];
    const set = new Set(kn), map = {}, ambiguous = [], unmatched = [];
    for (const n of names) {
      if (!n || set.has(n)) continue;
      const s = stripZ(n);
      let c = kn.filter((k) => k.includes("-") && stripZ(k.split("-").pop()) === s);
      if (!c.length) c = kn.filter((k) => k.includes("-") && k.split("-")[0].toLowerCase() === n.toLowerCase());
      if (c.length === 1) map[n] = c[0];
      else if (c.length > 1) ambiguous.push(`${n} (${c.slice(0, 3).join(", ")}${c.length > 3 ? ", …" : ""})`);
      else unmatched.push(n);
    }
    return { map, ambiguous, unmatched };
  }

  // ------------------------------------------------------------- DiNi M5
  const isTurning = (p) => !p || p === "0" || /^tp\d*$/i.test(p);
  function readM5(text) {
    const recs = [];
    for (const raw of text.split(/\r?\n/)) {
      if (!/^For M5\|/.test(raw)) continue;
      const f = raw.split("|");
      const info = f[2] || "";
      const r = { info, type: info.slice(0, 3).trim(), vals: {} };
      for (const b of f.slice(3, 6)) {
        const m = /^\s*([A-Za-z]+)\s+(-?[\d.]+)\s*m/.exec(b);
        if (m) r.vals[m[1]] = Number(m[2]);
      }
      if (r.type === "TO") r.text = info.slice(3).trim();
      if (/^KD\d/.test(r.type)) {
        r.nr = info.slice(3, 12).trim();
        r.pt = info.slice(12, 17).trim();
        r.time = info.slice(18, 26).trim();
      }
      recs.push(r);
    }
    return recs;
  }
  // DiNi → dezelfde blokken als een Leica-GSI-waterpassing, zodat parseLeveling alles hergebruikt
  // (dubbele aflezingen, trajecten, wisselpunten, heen/terug-secties).
  function diniToBlocks(recs, nameOf) {
    const w = (wi, v) => ({ wi, text: () => String(v), distance: () => v, number: () => v });
    const blocks = [];
    let side = false, last = null; // last = {kind, key, bs, fs} binnen de opstelling
    for (const r of recs) {
      if (r.type === "TO") {
        if (/doorg\.?\s*begin/i.test(r.text)) { blocks.push([w("41", "begin")]); last = null; }
        else if (/einde\s*zijslag/i.test(r.text)) side = false;
        else if (/zijslag/i.test(r.text)) side = true;
        continue;
      }
      if (r.type !== "KD1") continue; // KD2 = sommen, KD3.. = overig
      const v = r.vals;
      if ("Sh" in v || "dz" in v) continue; // sluitregel
      const p = nameOf(r), key = r.nr + "|" + p;
      const E = v.E || 0;
      if ("Lr" in v) {
        // tweede achterslag (BBFF of BFFB): zelfde punt én zelfde puntnummer als de achterslag van deze opstelling
        const again = last && last.bs === key;
        blocks.push([w("11", p), w("32", E), w(again ? "335" : "331", v.Lr)]);
        last = { kind: "B", bs: key, fs: last && again ? last.fs : null };
      } else if ("Lv" in v) {
        const again = last && last.fs === key;
        blocks.push([w("11", p), w("32", E), w(again ? "336" : "332", v.Lv)]);
        last = { kind: "F", bs: last ? last.bs : null, fs: key };
      } else if ("Lz" in v || side) {
        if ("Lz" in v) blocks.push([w("11", p), w("32", E), w("333", v.Lz)]);
      } else if ("Z" in v) blocks.push([w("11", p), w("83", v.Z)]);
    }
    return blocks;
  }
  function parseDini(text, known, tag = "", opts = {}) {
    const recs = readM5(text);
    const raw = (r) => (isTurning(r.pt) ? "" : r.pt) || (r.vals && "Lz" in r.vals ? r.nr : "");
    const names = [...new Set(recs.filter((r) => r.type === "KD1").map(raw).filter(Boolean))];
    const mp = opts.map === false ? { map: {}, ambiguous: [], unmatched: names.filter((n) => !known.has(n)) } : mapShortNames(names, known);
    Object.assign(mp.map, opts.renames || {});
    // wisselpunten: "TP" + puntnummer van de DiNi (voorslag en volgende achterslag delen dat nummer)
    const nameOf = (r) => { const n = raw(r); return n ? mp.map[n] || n : "TP" + r.nr; };
    const blocks = diniToBlocks(recs, nameOf);
    const real = new Set(names.map((n) => mp.map[n] || n));
    const lev = V.parseLeveling(blocks, real, tag, 99);
    lev.dini = { closing: recs.filter((r) => "Sh" in r.vals).map((r) => ({ punt: nameOf(r), sh_mm: r.vals.Sh * 1000 })), map: mp.map, ambiguous: mp.ambiguous, unmatched: mp.unmatched };
    return lev;
  }

  // ------------------------------------------------------------- Survey Controller DC
  // Vaste breedte, velden van 16 tekens. 66TP = meting per bezetting (WGS84, antennepositie),
  // 66AV = gemiddelde grondpositie, 57KI = antennehoogte, 59NM = covariantie (ECEF, m²).
  function readDc(text) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
    const F = (s, i) => s.slice(4 + 16 * i, 4 + 16 * (i + 1));
    const occ = [], avg = {}, warnings = [];
    let ant = null, cur = null, occN = 0;
    for (const l of lines) {
      const t = l.slice(0, 4);
      if (t === "57KI") ant = { h: Number(l.slice(4, 20)), method: l.slice(20, 21) };
      else if (t === "66TP") {
        const name = F(l, 0).trim();
        const lat = Number(F(l, 1)), lon = Number(F(l, 2)), h = Number(F(l, 3));
        const code = F(l, 4).trim();
        const rest = l.slice(4 + 16 * 5);
        const m = /^:(\d)(.{16})(.{0,16})/.exec(rest);
        cur = { name, lat, lon, h, code, ant: ant ? ant.h : NaN, hprec: m ? Number(m[2]) : NaN, vprec: m ? Number(m[3]) : NaN, cov: null, n: ++occN };
        if (Number.isFinite(lat) && Number.isFinite(lon)) occ.push(cur); else warnings.push(`DC: positie ${name} onleesbaar`);
      } else if (t === "59NM" && cur) {
        const s = l.slice(6);
        const v = [];
        for (let i = 0; i < 7; i++) v.push(Number(s.slice(16 * i, 16 * (i + 1))));
        if (v.slice(1).every(Number.isFinite)) cur.cov = v.slice(1); // xx xy xz yy yz zz (volgorde aangenomen)
        cur.nsat = Number(l.slice(4, 6));
      } else if (t === "66AV") {
        avg[F(l, 0).trim()] = { lat: Number(F(l, 1)), lon: Number(F(l, 2)), h: Number(F(l, 3)) };
      }
    }
    // antenne → grond: per punt uit gemiddelde (TP) − AV, anders mediaan van de andere punten
    const off = {};
    for (const [n, a] of Object.entries(avg)) {
      const t = occ.filter((o) => o.name === n);
      if (t.length) off[n] = M.mean(t.map((o) => o.h)) - a.h;
    }
    const offs = Object.values(off).sort((a, b) => a - b);
    const medOff = offs.length ? offs[Math.floor(offs.length / 2)] : NaN;
    const medAnt = M.mean(occ.map((o) => o.ant).filter(Number.isFinite)) || 0;
    for (const o of occ) {
      if (o.name in off) o.offset = off[o.name];
      else if (Number.isFinite(medOff)) { o.offset = medOff - medAnt + (Number.isFinite(o.ant) ? o.ant : medAnt); warnings.push(`DC: ${o.name} zonder gemiddelde (66AV); antenne-offset ${o.offset.toFixed(3)} m geschat uit de andere punten`); }
      else { o.offset = Number.isFinite(o.ant) ? o.ant : 0; warnings.push(`DC: ${o.name}: alleen antennehoogte ${o.offset.toFixed(3)} m, fasecentrum-offset onbekend`); }
      o.hGround = o.h - o.offset;
    }
    return { occ, avg, offsets: off, warnings };
  }
  function ecefToEnu(C, lat, lon) {
    const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
    const R = [[-Math.sin(l), Math.cos(l), 0], [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]];
    const RC = R.map((r) => [0, 1, 2].map((j) => r[0] * C[0][j] + r[1] * C[1][j] + r[2] * C[2][j]));
    return RC.map((r) => R.map((q) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2]));
  }
  function loadDc(text, trans, S, tag = "") {
    const dc = readDc(text);
    const net = new V.Network();
    const res = { net, gnss: {}, warnings: dc.warnings, offsets: dc.offsets, occ: dc.occ };
    for (const o of dc.occ) {
      const [x, y, Hn] = trans.etrs89ToRdnap(o.lat, o.lon, o.hGround);
      let sE, sN, cEN = 0, sU;
      if (o.cov) {
        const c = o.cov, C = [[c[0], c[1], c[2]], [c[1], c[3], c[4]], [c[2], c[4], c[5]]];
        const E = ecefToEnu(C, o.lat, o.lon);
        sE = Math.sqrt(E[0][0]); sN = Math.sqrt(E[1][1]); cEN = E[0][1]; sU = Math.sqrt(E[2][2]);
      } else { sE = sN = (o.hprec || 0.01) / Math.SQRT2; sU = o.vprec || 0.02; }
      const formal = [sE * 1000, sN * 1000];
      const sc = Math.max(1, S.gnss_min_xy_mm / Math.max(Math.max(...formal), 1e-6));
      const cc = (S.gnss_centr_mm / 1000) ** 2;
      const vx = sE * sE * sc * sc + cc, vy = sN * sN * sc * sc + cc, cxy = cEN * sc * sc;
      const sH = Math.max(sU * 1000, S.gnss_min_h_mm);
      const ref = `${o.name}@${o.n}`;
      const meta = { lat: o.lat, lon: o.lon, h: o.hGround, formal_mm: formal.map((v) => Math.round(v * 10) / 10), bezetting: String(o.n), epochs: null, antenne_m: o.offset, code: o.code };
      net.gnssXY(o.name, x, y, Math.sqrt(vx), Math.sqrt(vy), cxy, ref, meta);
      net.gnssH(o.name, Hn, sH, ref, meta);
      if (!net.points[o.name] || !M.isNum(net.points[o.name].x)) net.point(o.name, { x, y, H: Hn, code: o.code });
      const g = (res.gnss[o.name] = res.gnss[o.name] || { n: 0 });
      g.n++;
    }
    return res;
  }

  // ------------------------------------------------------------- Trimble Access .job (TPS)
  // Trimble-prismaconstanten (absoluut, mm). De .job bewaart de schuine afstand zónder constante.
  const TRIMBLE_CONSTANTS = { GPH1: -34.4, GPR1: -34.4, GPR121: -34.4, GRZ4: -11.3, GRZ122: -11.3, GMP101: -16.9, GMP111: -16.9, "TRIMBLE 360": 2.0, "MULTITRACK": 0.0, VX: 0.0, DR: 0.0 };
  function prismConstant(name) {
    const u = String(name || "").toUpperCase();
    for (const [k, v] of Object.entries(TRIMBLE_CONSTANTS)) if (u.startsWith(k)) return v;
    return null;
  }
  function b64ToBytes(b64) {
    if (typeof atob === "function") { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  function bytesToB64(u8) {
    if (typeof btoa === "function") { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
    return Buffer.from(u8).toString("base64");
  }
  // alle nul-afgesloten ASCII-strings (2..41 tekens)
  function strings(u8, from = 0, to = u8.length) {
    const out = [];
    let s = -1;
    for (let i = from; i < to; i++) {
      const c = u8[i];
      if (c >= 0x20 && c <= 0x7e) { if (s < 0) s = i; }
      else {
        if (c === 0 && s >= 0) {
          while (s < i && u8[s] === 0x20) s++;
          if (i - s > 41) s = i - 41;
          while (s < i && u8[s] === 0x20) s++;
          if (i - s >= 2) out.push([s, String.fromCharCode.apply(null, u8.subarray(s, i)), i + 1]);
        }
        s = -1;
      }
    }
    return out;
  }
  function readJob(u8, known = new Set()) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const dbl = (o) => dv.getFloat64(o, true);
    const res = { stations: [], raw: [], warnings: [], prisms: {} };
    let station = null, th = 0, prism = null;
    const toks = strings(u8);
    for (const [p, name, e] of toks) {
      const f0 = u8[e], f1 = u8[e + 1], f2 = u8[e + 2];
      const tm = /^(.+) \((\d+)\)$/.exec(name);
      if (tm && e + 11 <= u8.length) { th = dbl(e + 3); prism = tm[1]; continue; }
      const fl = String.fromCharCode(f0 || 32, f1 || 32);
      if (fl === "RS") { if (station !== name) res.stations.push([name, 0]); station = name; continue; }
      if (!["F1", "F2", "TP", "MA"].includes(fl) || !(f2 === 0x27 || f2 === 0x36) || e + 66 > u8.length) continue;
      const ha = dbl(e + 42), va = dbl(e + 50), sd = dbl(e + 58);
      if (!(ha >= 0 && ha < 2 * Math.PI + 1e-9 && va > 0 && va < 2 * Math.PI && sd > 0 && sd < 10000)) continue;
      if (fl === "MA") continue; // gemiddelde van Trimble zelf: wij middelen opnieuw
      const r = { station, target: name, kind: fl, hz: ha * 200 / Math.PI, z: va * 200 / Math.PI, sd, th, prism, pos: p };
      if (fl === "TP") {
        // controlemeting naar een bekend punt: naam van dat punt staat verderop in het record
        for (const [, n2] of strings(u8, p + 60, Math.min(u8.length, p + 420))) if (known.has(n2) && n2 !== name) { r.ref_point = n2; break; }
      }
      res.raw.push(r);
    }
    // prisma per doelpunt: de rechtstreekse meting (F1/F2) is leidend; TP-records houden soms
    // het laatst gekozen doel vast terwijl hetzelfde vaste prisma is gemeten.
    for (const r of res.raw) if (r.kind !== "TP" && r.prism) res.prisms[r.target] = res.prisms[r.target] || r.prism;
    for (const r of res.raw) {
      const tgt = r.kind === "TP" && r.ref_point ? r.ref_point : r.target;
      if (r.kind === "TP" && res.prisms[tgt] && res.prisms[tgt] !== r.prism) { r.prism_job = r.prism; r.prism = res.prisms[tgt]; }
      r.point = tgt;
    }
    return res;
  }
  function parseJobTps(u8, known, tag = "", opts = {}) {
    const job = readJob(u8, known);
    const consts = opts.constants || {};
    const res = { records: [], raw: job.raw, face_checks: [], stations: job.stations, warnings: job.warnings, prisms: {} };
    // groepeer per opstelling + doelpunt, opeenvolgend
    const st = new Map();
    let setno = 0, lastSt = null;
    for (const r of job.raw) {
      if (r.station !== lastSt) { setno++; lastSt = r.station; }
      r.set_id = `${tag}${r.station}#${setno}`;
      let c = consts[r.prism];
      if (c === undefined) c = prismConstant(r.prism);
      if (c === null) { res.warnings.push(`Onbekend prisma '${r.prism}' (${r.station}→${r.point}): constante 0 aangenomen`); c = 0; }
      r.const_mm = c;
      r.sd_c = r.sd + c / 1000;
      res.prisms[r.prism] = c;
    }
    const groups = new Map();
    for (const r of job.raw) {
      const k = `${r.set_id}|${r.point}|${r.kind === "TP" ? "TP:" + r.target : "D"}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const grp of groups.values()) {
      const f1 = grp.filter((r) => r.z < 200), f2 = grp.filter((r) => r.z >= 200);
      const hz1 = [...f1.map((r) => r.hz), ...f2.map((r) => V.mod(r.hz - 200, 400))];
      const ref = hz1[0];
      const hz = V.mod(ref + M.mean(hz1.map((h) => V.mod(h - ref + 200, 400) - 200)), 400);
      const z = M.mean([...f1.map((r) => r.z), ...f2.map((r) => 400 - r.z)]);
      const g0 = grp[0];
      res.records.push({ station: g0.station, target: g0.point, hz, z, sd: M.mean(grp.map((r) => r.sd_c)), ih: 0, th: g0.th, set_id: g0.set_id, faces: f1.length && f2.length ? 2 : 1, n: grp.length, prism: g0.prism, const_mm: g0.const_mm, job_name: g0.target, kind: g0.kind });
      if (f1.length && f2.length) {
        const c = (M.mean(f1.map((r) => r.hz)) - M.mean(f2.map((r) => V.mod(r.hz - 200, 400)))) / 2;
        const ix = (M.mean(f1.map((r) => r.z)) + M.mean(f2.map((r) => r.z)) - 400) / 2;
        const sds = grp.map((r) => r.sd);
        res.face_checks.push({ station: g0.station, target: g0.point, c_mgon: V.wrapGon(c) * 1000, i_mgon: ix * 1000, dS_mm: (Math.max(...sds) - Math.min(...sds)) * 1000 });
      }
    }
    const tps = job.raw.filter((r) => r.kind === "TP");
    const noRef = [...new Set(tps.filter((r) => !r.ref_point).map((r) => r.target))];
    if (noRef.length) res.warnings.push(`Controlemetingen zonder herkend bekend punt (blijven onder eigen naam): ${noRef.join(", ")}`);
    const fixed = job.raw.filter((r) => r.prism_job);
    if (fixed.length) res.warnings.push(`${fixed.length} controlemeting(en): prisma gelijkgesteld aan de rechtstreekse meting van hetzelfde punt (job meldde ${[...new Set(fixed.map((r) => r.prism_job))].join("/")})`);
    res.checks = tps.filter((r) => r.ref_point).length;
    return res;
  }

  Object.assign(V, { mapShortNames, readM5, diniToBlocks, parseDini, readDc, loadDc, TRIMBLE_CONSTANTS, prismConstant, readJob, parseJobTps, b64ToBytes, bytesToB64 });
})(globalThis.V = globalThis.V || {});
