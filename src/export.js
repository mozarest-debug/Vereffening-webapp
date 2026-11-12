// ===================================================================== export.js
// Coördinatenlijst (CSV/XLSX), rapport (tekst) en netwerkkaart (DXF R12).
(function (V) {
  "use strict";
  const M = V.M;
  const nl = (v, d) => (M.isNum(v) ? v.toFixed(d).replace(".", ",") : "");
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);

  // ------------------------------------------------------------- rijen voor export
  // results: lijst stapresultaten (de laatste wint per punt); opts: filters
  function exportRows(results, opts) {
    const o = Object.assign({ includeCodes: null, excludeGnssOnly: true, excludeKnown: false, excludePrefixes: [], excludeCodes: [], markUncontrolled: true }, opts || {});
    const pts = {};
    for (const R of results) {
      if (!R || R.error) continue;
      const unc = new Set(R.checks.uncontrolled || []);
      for (const [n, c] of Object.entries(R.coords)) {
        const src = R.net.pointSources(n);
        const d = (pts[n] = pts[n] || { punt: n, code: "", sources: new Set(), controle: "ja", status_xy: "vrij", status_h: "vrij" });
        for (const k of ["x", "y", "sx", "sy", "H", "sH"]) if (M.isNum(c[k])) d[k] = c[k];
        if (c.code) d.code = c.code;
        src.forEach((s) => d.sources.add(s));
        if ("x" in c) { d.status_xy = c.status_xy; d.controle = unc.has(n) ? "nee" : "ja"; }
        if ("H" in c) d.status_h = c.status_h;
      }
    }
    const inc = o.includeCodes ? new Set(o.includeCodes.map(String)) : null;
    const exc = new Set((o.excludeCodes || []).map(String));
    return Object.values(pts).filter((d) => {
      if (d.punt.includes("#")) return false;
      if (inc && !inc.has(String(d.code))) return false;
      if (exc.has(String(d.code))) return false;
      if (o.excludeGnssOnly && d.sources.size === 1 && d.sources.has("GNSS")) return false;
      if (o.excludeKnown && (d.status_xy !== "vrij" || d.status_h !== "vrij")) return false;
      if ((o.excludePrefixes || []).some((p) => p && d.punt.toUpperCase().startsWith(p.toUpperCase()))) return false;
      return true;
    }).map((d) => ({ ...d, controle: o.markUncontrolled ? d.controle : "" }))
      .sort((a, b) => a.punt.localeCompare(b.punt, "nl", { numeric: true }));
  }
  const COLS = ["punt", "code", "x", "y", "H", "sx_mm", "sy_mm", "sH_mm", "controle", "status_xy", "status_h"];
  function rowValues(r, withSd) {
    const v = { punt: r.punt, code: r.code, x: r.x, y: r.y, H: r.H, sx_mm: r.sx * 1000, sy_mm: r.sy * 1000, sH_mm: r.sH * 1000, controle: r.controle, status_xy: r.status_xy, status_h: r.status_h };
    return COLS.filter((c) => withSd || !c.endsWith("_mm")).map((c) => [c, v[c]]);
  }
  function toCSV(rows, withSd = true, sep = ";", dec = ",") {
    const cols = COLS.filter((c) => withSd || !c.endsWith("_mm"));
    const fmt = { x: 4, y: 4, H: 4, sx_mm: 1, sy_mm: 1, sH_mm: 1 };
    const lines = [cols.join(sep)];
    for (const r of rows) lines.push(rowValues(r, withSd).map(([c, v]) => (typeof v === "number" ? (M.isNum(v) ? v.toFixed(fmt[c] ?? 4).replace(".", dec) : "") : v ?? "")).join(sep));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // ------------------------------------------------------------- tekstrapport
  function adjReport(res) {
    if (!res) return "";
    const L = [], mm = 1000;
    L.push(`=== Vereffening ${res.dim} ${res.free ? "(VRIJ)" : "(aansluitend)"} ===`);
    L.push(`Iteraties: ${res.iterations}   Overtalligheid r = ${res.redundancy}`);
    if (res.redundancy > 0) L.push(`F-toets: ${nl(res.F, 3)}  kritiek ${nl(res.F_crit, 3)}  -> ${res.F_ok ? "AANVAARD" : "VERWORPEN"}`);
    if (res.extra && res.extra.scale) L.push(`Schaalfactor afstanden: ${res.extra.scale[0].toFixed(7)} ± ${res.extra.scale[1].toFixed(7)}`);
    L.push("", "Coördinaten:");
    for (const p of Object.keys(res.coords).sort((a, b) => a.localeCompare(b, "nl", { numeric: true }))) {
      const c = res.coords[p];
      if (res.dim === "2D") {
        const [sx, sy] = res.sd[p], e = res.ellipse[p];
        L.push(`  ${pad(p, 18)} x=${lpad(c[0].toFixed(4), 12)} y=${lpad(c[1].toFixed(4), 12)}  sx=${lpad((sx * mm).toFixed(1), 5)} sy=${lpad((sy * mm).toFixed(1), 5)} mm` + (e ? `  ellips a=${(e[0] * mm).toFixed(1)} b=${(e[1] * mm).toFixed(1)} mm richting ${e[2].toFixed(1)} gon` : "  (vast)"));
      } else L.push(`  ${pad(p, 18)} H=${lpad(c.toFixed(4), 10)}  sH=${lpad((res.sd[p] * mm).toFixed(1), 5)} mm${res.sd[p] ? "" : "  (vast)"}`);
    }
    L.push("", "Waarnemingen (verbetering mm/mgon; toets; kritiek; red.getal; MDB; ext.betr. mm):");
    for (const r of res.obs_results) L.push("  " + obsLine(r));
    return L.join("\n");
  }
  function obsLabel(o) { return o.to ? `${o.kind} ${o.frm} → ${o.to}` : `${o.kind} ${o.frm}`; }
  function residText(r) {
    const o = r.obs;
    if (o.kind === "R") return `${nl(-r.resid[0] * 1000, 2)} mgon`;
    if (r.resid.length === 2) return `${nl(-r.resid[0] * 1000, 1)} / ${nl(-r.resid[1] * 1000, 1)} mm`;
    return `${nl(-r.resid[0] * 1000, 2)} mm`;
  }
  function mdbText(r) {
    const u = r.obs.kind === "R" ? " mgon" : " mm";
    if (Array.isArray(r.mdb)) return r.mdb.map((v) => (M.isNum(v) && isFinite(v) ? nl(v * 1000, 1) : "–")).join(" / ") + u;
    return isFinite(r.mdb) ? nl(r.mdb * 1000, 1) + u : "–";
  }
  function obsLine(r) {
    return `${pad(obsLabel(r.obs), 34)} ${pad(r.obs.ref || "", 26)} v=${pad(residText(r), 18)} ${r.resid.length === 2 ? "T/b" : "w"}=${lpad(nl(r.w, 2), 6)} (k=${nl(r.w_crit, 2)}) r=${nl(r.redundancy, 2)} MDB=${pad(mdbText(r), 16)} ext=${isFinite(r.ext_rel) ? nl(r.ext_rel * 1000, 1) : "–"}${r.rejected ? "  <-- VERWORPEN" : ""}`;
  }
  function fullReport(project, results, meta) {
    const L = [];
    L.push(`VEREFFENINGSRAPPORT – ${meta.name || "project"}`, `Datum: ${new Date().toLocaleString("nl-NL")}`, `Programma: Vereffening webapp ${meta.version || ""} (kleinste kwadraten, Delftse toetsing, transformatie ETRS89 ↔ RD/NAP)`);
    const S = project.settings;
    L.push(`Toetsing: α0 = ${S.alpha0}, β0 = ${S.beta0}  (B-methode)`, "");
    results.forEach((R) => {
      L.push("#".repeat(78));
      L.push(...R.log, "");
      if (R.r2_test) L.push("--- Toetsing met bekende punten gewogen (2D) ---", adjReport(R.r2_test), "");
      if (R.r2) L.push(adjReport(R.r2), "");
      if (R.r1_test) L.push("--- Toetsing met bekende punten gewogen (1D) ---", adjReport(R.r1_test), "");
      if (R.r1) L.push(adjReport(R.r1), "");
    });
    return L.join("\n");
  }

  // ------------------------------------------------------------- DXF
  const LAYERS = { VER_PUNT_VAST: 1, VER_PUNT_VRIJ: 7, VER_TEKST: 7, VER_WAARNEMING: 8, VER_GNSS: 3, VER_VERWORPEN: 30, VER_ELLIPS: 5 };
  function toDXF(R, o) {
    o = Object.assign({ ellipseScale: 5000, textHeight: 0.5, marker: 0.4, useHeights: true, layers: null }, o || {});
    const want = new Set(o.layers || Object.keys(LAYERS));
    const ent = [];
    const g = (...pairs) => { for (const [c, v] of pairs) ent.push(`${c}\n${typeof v === "number" ? v.toFixed(4) : v}`); };
    const C = R.r2.coords, Hc = R.r1 && o.useHeights ? R.r1.coords : {};
    const z = (p) => (M.isNum(Hc[p]) ? Hc[p] : 0);
    const line = (lay, x1, y1, x2, y2, z1 = 0, z2 = 0) => g([0, "LINE"], [8, lay], [10, x1], [20, y1], [30, z1], [11, x2], [21, y2], [31, z2]);
    const poly = (lay, pts, zz) => { g([0, "POLYLINE"], [8, lay], [66, 1], [10, 0], [20, 0], [30, zz], [70, 1]); for (const [x, y] of pts) g([0, "VERTEX"], [8, lay], [10, x], [20, y], [30, zz]); g([0, "SEQEND"], [8, lay]); };
    const pairs = new Map();
    for (const r of R.r2.obs_results) {
      const ob = r.obs;
      if ((ob.kind === "R" || ob.kind === "S") && C[ob.frm] && C[ob.to]) {
        const k = [ob.frm, ob.to].sort().join("\u0000");
        pairs.set(k, (pairs.get(k) || false) || r.rejected);
      }
    }
    for (const [k, bad] of pairs) {
      const [a, b] = k.split("\u0000"), lay = bad ? "VER_VERWORPEN" : "VER_WAARNEMING";
      if (want.has(lay)) line(lay, C[a][0], C[a][1], C[b][0], C[b][1], z(a), z(b));
    }
    const gnss = new Set(R.r2.obs_results.filter((r) => r.obs.kind === "GNSS").map((r) => r.obs.frm));
    const m = o.marker;
    for (const [p, [x, y]] of Object.entries(C)) {
      const pt = R.net.points[p] || {};
      const known = pt.status_xy && pt.status_xy !== "vrij";
      const lay = known ? "VER_PUNT_VAST" : "VER_PUNT_VRIJ";
      if (want.has(lay)) {
        g([0, "POINT"], [8, lay], [10, x], [20, y], [30, z(p)]);
        if (known) { const k = m * 1.5; poly(lay, [[x, y + k], [x + 0.866 * k, y - 0.5 * k], [x - 0.866 * k, y - 0.5 * k]], z(p)); }
        else poly(lay, Array.from({ length: 12 }, (_, i) => [x + m * Math.cos(i * Math.PI / 6), y + m * Math.sin(i * Math.PI / 6)]), z(p));
      }
      if (want.has("VER_TEKST")) g([0, "TEXT"], [8, "VER_TEKST"], [10, x + m * 1.5], [20, y + m * 1.5], [30, z(p)], [40, o.textHeight], [1, p]);
      if (gnss.has(p) && want.has("VER_GNSS")) { const k = m * 1.2; line("VER_GNSS", x - k, y - k, x + k, y + k, z(p), z(p)); line("VER_GNSS", x - k, y + k, x + k, y - k, z(p), z(p)); }
      const e = R.r2.ellipse[p];
      if (e && want.has("VER_ELLIPS")) {
        const a = e[0] * o.ellipseScale, b = e[1] * o.ellipseScale, phi = e[2] * Math.PI / 200;
        const u = [Math.sin(phi), Math.cos(phi)], v = [Math.cos(phi), -Math.sin(phi)];
        poly("VER_ELLIPS", Array.from({ length: 72 }, (_, i) => { const s = i * Math.PI / 36; return [x + a * Math.cos(s) * u[0] + b * Math.sin(s) * v[0], y + a * Math.cos(s) * u[1] + b * Math.sin(s) * v[1]]; }), z(p));
      }
    }
    const head = ["0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n6\n0\nENDSEC", `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${Object.keys(LAYERS).length}`];
    for (const [n, c] of Object.entries(LAYERS)) head.push(`0\nLAYER\n2\n${n}\n70\n0\n62\n${c}\n6\nCONTINUOUS`);
    head.push("0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES");
    return [...head, ...ent, "0\nENDSEC\n0\nEOF\n"].join("\n").replace(/[^\x00-\x7F]/g, "?");
  }

  // ------------------------------------------------------------- XLSX (minimaal, zonder bibliotheek)
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) { // [{name, data: string}] -> Uint8Array (opgeslagen, niet gecomprimeerd)
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((s, a) => s + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  const xesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  function colName(i) { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(rows, widths) {
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof v === "number" && M.isNum(v)) return `<c r="${ref}"${ri === 0 ? ' s="1"' : ""}><v>${v}</v></c>`;
      if (v === null || v === undefined || (typeof v === "number" && !M.isNum(v)) || v === "") return "";
      return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    }).join("") + "</row>").join("");
    const cols = widths ? "<cols>" + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>" : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  }
  function toXLSX(sheets) { // [{name, rows: [[...]], widths}]
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>` },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) })),
    ];
    return zip(files);
  }
  function obsSheetRows(results) {
    const rows = [["stap", "dim", "soort", "van", "naar", "bron/meting", "verbetering", "eenheid", "toets", "kritiek", "verworpen", "redundantie", "MDB", "ext. betr. (mm)"]];
    for (const R of results) for (const res of [R.r2, R.r1]) if (res) for (const r of res.obs_results) {
      const u = r.obs.kind === "R" ? "mgon" : "mm";
      rows.push([R.name, res.dim, r.obs.kind, r.obs.frm, r.obs.to || "", r.obs.ref || "", r.resid.length === 1 ? -r.resid[0] * 1000 : Math.hypot(r.resid[0], r.resid[1]) * 1000, u, M.isNum(r.w) ? r.w : null, r.w_crit, r.rejected ? "ja" : "", r.redundancy, Array.isArray(r.mdb) ? Math.max(...r.mdb) * 1000 : isFinite(r.mdb) ? r.mdb * 1000 : null, isFinite(r.ext_rel) ? r.ext_rel * 1000 : null]);
    }
    return rows;
  }

  Object.assign(V, { exportRows, toCSV, rowValues, COLS, adjReport, fullReport, obsLabel, residText, mdbText, toDXF, toXLSX, obsSheetRows, DXF_LAYERS: LAYERS });
})(globalThis.V = globalThis.V || {});
