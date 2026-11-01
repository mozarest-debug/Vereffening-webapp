// ===================================================================== app.js
// Interface van de webapp. Alles draait lokaal in de browser; er gaat niets over internet.
(function (V) {
  "use strict";
  const M = V.M;
  const VERSION = "1.0";
  const LS_KEY = "vereffening.project.v1";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const nl = (v, d = 1) => (M.isNum(v) ? v.toFixed(d).replace(".", ",").replace(/^-/, "−") : "–");
  const sg = (v, d = 1) => (M.isNum(v) ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d).replace(".", ",") : "–");
  const mm = (v, d = 1) => (M.isNum(v) ? nl(v * 1000, d) : "–");
  const natural = (a, b) => String(a).localeCompare(String(b), "nl", { numeric: true });
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ------------------------------------------------------------- toestand
  let S = null;          // projecttoestand (wordt opgeslagen)
  let RES = [];          // rekenresultaten per stap
  let PROJ = null;
  let TRANS = null;
  const UI = { view: "stappen", stage: 0, tab: "bestanden", dim: "2D", phase: "aansluitend", pfilter: "alle", psearch: "", showAllObs: false, settingsTarget: "project", mapLayers: { punten: true, nummers: true, waarnemingen: true, gnss: true, verworpen: true, ellipsen: true, raster: false }, ellScale: "auto", dxfVisible: true, dxf3d: true, exp: null };

  function defaultProject() {
    return { version: VERSION, name: "Nieuw project", settings: V.defaultSettings(), stages: [], codes: V.CODELIST || { name: "", codes: {} }, exportOpts: null };
  }
  const codeDesc = (c) => (c && S.codes && S.codes.codes[c]) || "";
  const ROLE = { 900: "nap", 515: "nap", 906: "opstelplaats", 907: "grondslag", 909: "grondslag", 910: "grondslag", 911: "hoogte" };

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); UI.saveErr = false; }
    catch (e) { UI.saveErr = true; }
  }
  function load() {
    try { const t = localStorage.getItem(LS_KEY); if (t) { const p = JSON.parse(t); return migrate(p); } } catch (e) { /* leeg of geblokkeerd */ }
    return defaultProject();
  }
  function migrate(p) {
    p.settings = Object.assign(V.defaultSettings(), p.settings || {});
    p.codes = p.codes && p.codes.codes ? p.codes : V.CODELIST || { name: "", codes: {} };
    p.stages = (p.stages || []).map((s) => Object.assign(V.newStage(s.name), s));
    return p;
  }

  // ------------------------------------------------------------- rekenen
  function getTrans() {
    if (!TRANS) {
      const G = V.GRIDDATA;
      TRANS = new V.RDNAPTRANS(V.Grid.fromPacked(G.rdcorr.meta, G.rdcorr.b64), V.Grid.fromPacked(G.nlgeo.meta, G.nlgeo.b64));
    }
    return TRANS;
  }
  function compute() {
    PROJ = new V.Project(getTrans(), S.settings);
    PROJ.stages = S.stages;
    const t0 = performance.now();
    try { RES = PROJ.run(); } catch (e) { RES = []; toast("Fout bij rekenen: " + e.message); console.error(e); }
    UI.lastMs = performance.now() - t0;
  }
  let pending = null;
  function changed(opts = {}) {
    save();
    if (opts.norecalc) { render(); return; }
    const b = document.getElementById("busy");
    if (b) b.hidden = false;
    clearTimeout(pending);
    pending = setTimeout(() => { compute(); render(); const bb = document.getElementById("busy"); if (bb) bb.hidden = true; }, 30);
  }
  function toast(t, ms = 3500) {
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = t; document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  const curStage = () => S.stages[UI.stage];
  const curRes = () => RES[UI.stage];

  // ------------------------------------------------------------- bestanden
  function decode(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { return new TextDecoder("windows-1252").decode(u8); }
  }
  function detect(name, text) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "tco") return "move3-tco";
    if (ext === "obs") return "move3";
    if (ext === "prj") return "skip";
    if (ext === "xml" || /^\s*<\?xml|<LandXML/i.test(text.slice(0, 2000))) return /LandXML/i.test(text.slice(0, 5000)) ? "hexml" : "codelist";
    const first = text.split(/\r?\n/).find((l) => l.trim()) || "";
    if (ext === "gsi" || /^\*?(11|41)[0-9.]{4}[+-]/.test(first.trim())) return "gsi";
    return "coords";
  }
  function makeTag(st, kind, text, name) {
    let base = "LIJST";
    if (kind === "hexml") base = /ObservationGroup/.test(text) ? "TPS" : "GNSS";
    else if (kind === "gsi") base = V.detectKind(V.readGsi(text.slice(0, 20000))) === "waterpassing" ? "WP" : "TS";
    else if (kind === "move3") base = "M3";
    else if (kind === "coords") base = /nap/i.test(name) ? "NAP" : "LIJST";
    const used = new Set(st.sources.map((s) => s.tag));
    let tag = base, k = 2;
    while (used.has(tag)) tag = base + k++;
    return tag;
  }
  async function addFiles(fileList, stageIdx) {
    const files = await Promise.all([...fileList].map(async (f) => ({ name: f.name, text: decode(await f.arrayBuffer()) })));
    if (stageIdx === undefined) {
      if (!S.stages.length) S.stages.push(V.newStage((files[0] ? files[0].name.replace(/\.[^.]+$/, "") : "Meting").slice(0, 40)));
      stageIdx = UI.stage < S.stages.length ? UI.stage : 0;
    }
    const st = S.stages[stageIdx];
    const tcos = {};
    let n = 0;
    for (const f of files) if (detect(f.name, f.text) === "move3-tco") tcos[f.name.replace(/\.[^.]+$/, "").toLowerCase()] = f.text;
    for (const f of files) {
      const kind = detect(f.name, f.text);
      if (kind === "skip" || kind === "move3-tco") continue;
      if (kind === "codelist") { loadCodelist(f.text, f.name); continue; }
      const src = { id: uid(), name: f.name, kind, text: f.text, options: {}, disabled: false };
      if (kind === "move3") {
        src.tco = tcos[f.name.replace(/\.[^.]+$/, "").toLowerCase()];
        if (!src.tco) { toast(`${f.name}: kies het .tco-bestand samen met het .obs-bestand`); continue; }
        src.options.phase = "gewogen";
      }
      src.tag = makeTag(st, kind, f.text, f.name);
      st.sources.push(src);
      n++;
    }
    UI.view = "stap"; UI.stage = stageIdx; UI.tab = "bestanden";
    if (n) toast(`${n} bestand${n > 1 ? "en" : ""} toegevoegd aan ${st.name}`);
    changed();
  }
  function loadCodelist(text, name) {
    try {
      const doc = V.parseXML(text), codes = {};
      for (const g of doc.getElementsByTagName("*")) {
        if (g.localName !== "Code") continue;
        const c = g.getAttribute("codeName");
        if (c) codes[c] = g.getAttribute("codeDesc") || "";
      }
      if (!Object.keys(codes).length) throw new Error("geen codes gevonden");
      S.codes = { name: name.replace(/\.xml$/i, ""), codes };
      toast(`Codelijst ${S.codes.name} geladen (${Object.keys(codes).length} codes)`);
      changed({ norecalc: true });
    } catch (e) { toast("Codelijst niet gelezen: " + e.message); }
  }
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const safeName = (s) => String(s).replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "project";
  function pickFiles(accept, multiple, cb) {
    const i = document.createElement("input");
    i.type = "file"; i.multiple = multiple; if (accept) i.accept = accept;
    i.onchange = () => cb(i.files);
    i.click();
  }

  // ------------------------------------------------------------- afgeleide info
  function stageStatus(R) {
    if (!R) return { cls: "", text: "nog niet berekend" };
    if (R.error) return { cls: "bad", text: R.error };
    const parts = [];
    let bad = false;
    for (const [lab, r, t] of [["2D", R.r2, R.r2_test], ["1D", R.r1, R.r1_test]]) {
      const x = t || r;
      if (!x) continue;
      if (x.redundancy === 0) { parts.push(`${lab} niet toetsbaar (r = 0)`); continue; }
      const nrej = x.obs_results.filter((o) => o.rejected).length;
      if (!x.F_ok || nrej) bad = true;
      parts.push(`${lab} ${x.F_ok ? "aanvaard" : "verworpen"} · F ${nl(x.F, 2)}` + (nrej ? ` · ${nrej} verworpen` : ""));
    }
    return { cls: bad ? "bad" : "ok", text: parts.join(" · ") || "geen waarnemingen" };
  }
  function stageWarnings(R) {
    const W = [];
    if (!R || R.error) return W;
    const c = R.checks;
    for (const l of c.leveling) for (const d of l.diagnoses) W.push(d.tekst);
    for (const g of c.gnssOcc) if (!g.ok) W.push(`${g.punt}: GNSS-bezettingen ${nl(g.dxy_mm, 0)} mm ligging / ${nl(g.dh_mm, 0)} mm hoogte uit elkaar`);
    for (const p of c.precheck) W.push(`Voorcontrole: ${p.station} → ${p.doel} ${p.kept ? "wijkt af (teruggezet)" : "uitgeschakeld"}` + (p.past_op ? ` · past op ${p.past_op}` : ""));
    if (c.snooping.length) W.push(`Data snooping: ${c.snooping.length} waarneming(en) verwijderd`);
    if (c.uncontrolled.length) W.push(`${c.uncontrolled.length} ongecontroleerd punt(en): ${c.uncontrolled.slice(0, 6).join(", ")}${c.uncontrolled.length > 6 ? " …" : ""}`);
    for (const w of c.warnings) W.push(w);
    if (c.gnssHctrl) for (const x of c.gnssHctrl.items) if (Math.abs(x.mm - c.gnssHctrl.median_mm) > c.gnssHctrl.tol_mm) W.push(`${x.punt}: GNSS-hoogte wijkt ${sg(x.mm - c.gnssHctrl.median_mm, 0)} mm af van de mediaan`);
    return W;
  }
  function delivers(R) {
    if (!R || R.error) return "";
    const pts = Object.entries(R.coords).filter(([n, c]) => c.code !== "906" && !n.includes("#") && (c.status_xy === "vrij" || c.status_h === "vrij"));
    const byCode = {};
    for (const [, c] of pts) { const k = c.code || "–"; byCode[k] = (byCode[k] || 0) + 1; }
    const sxy = pts.map(([, c]) => Math.max(c.sx || 0, c.sy || 0)).filter((v) => v > 0);
    const sh = pts.map(([, c]) => c.sH || 0).filter((v) => v > 0);
    const what = Object.entries(byCode).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n}× ${k === "–" ? "zonder code" : k + (codeDesc(k) ? " " + codeDesc(k) : "")}`).join(" · ");
    return `${what}` + (sxy.length ? ` · σ ligging ${mm(Math.min(...sxy), 0)}–${mm(Math.max(...sxy), 0)} mm` : "") + (sh.length ? ` · σH ${mm(Math.min(...sh))}–${mm(Math.max(...sh))} mm` : "");
  }
  function pointInfo(R) {
    // per punt: code, bronnen, status, opmerkingen
    const out = {};
    if (!R || !R.net) return out;
    const net = R.net, c = R.checks;
    for (const [n, p] of Object.entries(net.points)) {
      if (p.code === "HI") continue;
      out[n] = { name: n, code: p.code || "", gnss: new Set(), tps: new Set(), wp: false, status_xy: p.status_xy, status_h: p.status_h, notes: [], res: R.coords[n] };
    }
    for (const o of net.obs) {
      const a = out[o.frm], b = out[o.to];
      if (o.kind === "GNSS") a && a.gnss.add(o.ref);
      if (o.kind === "R" && b) b.tps.add(o.set_id);
      if (o.kind === "DH" && o.label === "waterpassing") { if (a) a.wp = true; if (b) b.wp = true; }
    }
    for (const n of c.uncontrolled) if (out[n]) out[n].notes.push({ cls: "warn", t: "Ongecontroleerd: maar één opstelling" });
    for (const g of c.gnssOcc) if (!g.ok && out[g.punt]) out[g.punt].notes.push({ cls: "warn", t: `GNSS-bezettingen ${nl(g.dxy_mm, 0)}/${nl(g.dh_mm, 0)} mm uit elkaar` });
    for (const g of c.precheck) { if (out[g.doel]) out[g.doel].notes.push({ cls: "warn", t: `Meting vanaf ${g.station} ${g.kept ? "wijkt af" : "uitgeschakeld"} (voorcontrole)` }); if (g.past_op && out[g.past_op]) out[g.past_op].notes.push({ cls: "warn", t: `Meting ${g.station} → ${g.doel} past op dit punt` }); }
    for (const s of c.snooping) { const p = out[s.to] || out[s.frm]; if (p) p.notes.push({ cls: "warn", t: `Data snooping: ${s.kind} verwijderd` }); }
    const ov = (curStageOf(R) || {}).overrides || {};
    for (const n of Object.keys(ov)) if (out[n]) out[n].notes.push({ cls: "info", t: "Status handmatig aangepast" });
    for (const p of Object.values(out)) if (p.code === "906") p.notes.push({ cls: "", t: "Opstelpunt · standaard niet in export" });
    return out;
  }
  const curStageOf = (R) => S.stages.find((s) => s.name === R.name);
  const allResults = () => RES.filter((r) => r && !r.error);

  // ------------------------------------------------------------- render
  const ICON = {
    logo: '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#7FB8E8" stroke-width="2" aria-hidden="true"><path d="M4 22 L14 5 L24 22 Z"/><circle cx="14" cy="5" r="2.5" fill="#7FB8E8"/><circle cx="4" cy="22" r="2.5" fill="#7FB8E8"/><circle cx="24" cy="22" r="2.5" fill="#7FB8E8"/></svg>',
    expand: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15202B" stroke-width="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    ext: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15202B" stroke-width="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };
  function header() {
    const inStage = UI.view === "stap" && curStage();
    let nav;
    if (inStage) {
      nav = `<nav class="crumb" aria-label="Waar ben ik"><button class="nav-link" data-act="view" data-v="stappen" style="background:none;border:0;color:#C9D3DC;padding:10px 4px;min-height:44px">Stappen</button><span class="sep">›</span>
        <label><span class="sr" style="position:absolute;width:1px;height:1px;overflow:hidden">Stap kiezen</span><select data-act="pickstage">${S.stages.map((s, i) => `<option value="${i}" ${i === UI.stage ? "selected" : ""}>Stap ${i + 1} · ${esc(s.name)}</option>`).join("")}</select></label></nav>
        <nav class="nav" aria-label="Schermen van deze stap">${[["bestanden", "Bestanden"], ["punten", "Punten"], ["vereffening", "Vereffening"], ["export", "Export"]].map(([k, l]) => `<button class="${UI.tab === k ? "on" : ""}" data-act="tab" data-v="${k}">${l}</button>`).join("")}</nav>`;
    } else {
      nav = `<nav class="nav">${[["stappen", "Stappen"], ["controles", "Controles"], ["instellingen", "Instellingen"]].map(([k, l]) => `<button class="${UI.view === k ? "on" : ""}" data-act="view" data-v="${k}">${l}</button>`).join("")}</nav>`;
    }
    return `<header class="top noprint"><button class="logo" data-act="view" data-v="stappen">${ICON.logo} Vereffening</button>${nav}
      <div class="projbox">Project: <button class="pname" data-act="rename-project" title="Naam wijzigen">${esc(S.name)}</button> · offline
        <button data-act="save-file" title="Project als bestand opslaan">Opslaan</button><button data-act="open-file" title="Projectbestand openen">Openen</button><button data-act="new-project">Nieuw</button></div></header>`;
  }
  function render() {
    const app = document.getElementById("app");
    let body = "";
    try {
      if (UI.view === "stap" && !curStage()) UI.view = "stappen";
      if (UI.view === "stappen") body = viewStappen();
      else if (UI.view === "stap") body = { bestanden: viewBestanden, punten: viewPunten, vereffening: viewVereffening, export: viewExport }[UI.tab]();
      else if (UI.view === "kaart") body = viewKaart();
      else if (UI.view === "controles") body = viewControles();
      else if (UI.view === "instellingen") body = viewInstellingen();
    } catch (e) { console.error(e); body = `<div class="msg bad">Interne fout bij tonen: ${esc(e.message)}</div>`; }
    const saveWarn = UI.saveErr ? `<div class="msg warn small">Dit project is te groot om automatisch in de browser te bewaren. Gebruik <b>Opslaan</b> om het als bestand te bewaren.</div>` : "";
    app.innerHTML = header() + `<main>${saveWarn}${body}</main><div id="busy" class="busy" hidden>Rekenen…</div>`;
    afterRender();
  }

  // ------------------------------------------------------------- Stappen
  function viewStappen() {
    if (!S.stages.length) {
      return `<div class="row"><h1 class="grow">Project en stappen</h1></div>
      <div class="drop" data-drop="new"><h2>Sleep één of meer meetbestanden hierheen om te beginnen</h2>
        <div class="muted">HeXML (Captivate) · GSI8/GSI16 (total station of waterpassing) · MOVE3 (.tco + .obs) · coördinatenlijst (CSV/TXT)</div>
        <div class="row" style="justify-content:center"><button class="btn pri" data-act="pick-files">Bestanden kiezen</button><button class="btn" data-act="add-stage">Lege stap toevoegen</button><button class="btn" data-act="demo">Voorbeeldproject dijkweg laden</button></div>
        <div class="small muted">Alles blijft op dit apparaat. Er wordt niets verstuurd.</div></div>`;
    }
    const cards = S.stages.map((st, i) => {
      const R = RES[i], s = stageStatus(R), W = stageWarnings(R);
      const nrules = st.known.filter((r) => !r.disabled).length;
      return `<article class="stage ${i === UI.stage ? "sel" : ""}" data-act="selstage" data-i="${i}">
        <div class="row"><span class="num">${i + 1}</span><h2 class="grow">${esc(st.name)}</h2></div>
        <div class="st ${s.cls === "ok" ? "" : ""}" style="color:${s.cls === "ok" ? "var(--ok)" : s.cls === "bad" ? "var(--bad)" : "var(--mut)"}">${esc(s.text)}</div>
        <div>${st.sources.map((x) => `<div class="src"><span class="badge ${x.disabled ? "" : "blue"}">${esc(x.tag || x.kind)}</span><span class="n ${x.disabled ? "muted" : ""}">${esc(x.name)}${x.disabled ? " (uit)" : ""}</span></div>`).join("") || '<span class="muted small">Nog geen bestanden</span>'}</div>
        <div class="small muted">${nrules ? `${nrules} regel${nrules > 1 ? "s" : ""} voor bekende punten` : "Geen regels voor bekende punten"}${st.snooping ? ` · data snooping max ${st.snooping}` : ""}${st.gnss_heights === "controle" ? " · GNSS-hoogte alleen controle" : ""}</div>
        ${W.slice(0, 5).map((w) => `<div class="warnline">⚠ ${esc(w)}</div>`).join("")}${W.length > 5 ? `<div class="small muted">… en ${W.length - 5} meer (zie Controles)</div>` : ""}
        ${R && !R.error ? `<div class="levert"><b>Levert</b> · ${esc(delivers(R))}</div>` : ""}
        <div class="row" style="margin-top:auto"><button class="btn sm pri" data-act="openstage" data-i="${i}">Openen</button><button class="btn sm" data-act="rename-stage" data-i="${i}">Naam</button>
          <button class="btn sm" data-act="move-stage" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Naar voren">←</button><button class="btn sm" data-act="move-stage" data-i="${i}" data-d="1" ${i === S.stages.length - 1 ? "disabled" : ""} aria-label="Naar achteren">→</button>
          <button class="btn sm danger" data-act="del-stage" data-i="${i}">Verwijderen</button></div></article>`;
    }).join("");
    return `<div class="row"><div class="grow"><h1>Stappen</h1><div class="muted">Elke stap wordt apart vereffend en kan bekende punten leveren aan de volgende stap.</div></div>
      <button class="btn" data-act="add-stage">+ Stap toevoegen</button><button class="btn pri" data-act="recalc">Alles opnieuw rekenen</button></div>
      <div class="stages">${cards}</div>${rulesEditor()}`;
  }
  function rulesEditor() {
    const st = curStage();
    if (!st) return "";
    const R = RES[UI.stage];
    const prevNames = S.stages.slice(0, UI.stage).map((s) => s.name);
    const codes = [...new Set(Object.values((R && R.net && R.net.points) || {}).map((p) => p.code).filter((c) => c && c !== "HI"))].sort(natural);
    const found = (i) => { const x = R && R.checks && R.checks.rules.find((q) => q.rule === st.known[i]); return x ? x.names.length : null; };
    const rows = st.known.map((r, i) => {
      const f = found(i);
      return `<tr class="${r.disabled ? "off" : ""}">
        <td><input class="inl" style="width:150px" data-rule="${i}" data-k="points" value="${esc(Array.isArray(r.points) ? r.points.join(", ") : r.points)}" placeholder="* of 80* of 9697, 9699"></td>
        <td><select class="inl" data-rule="${i}" data-k="code"><option value="">alle codes</option>${codes.map((c) => `<option value="${esc(c)}" ${r.codes && r.codes[0] === c ? "selected" : ""}>${esc(c)} ${esc(codeDesc(c))}</option>`).join("")}</select></td>
        <td><select class="inl" data-rule="${i}" data-k="origin"><option value="lijst" ${r.origin === "lijst" ? "selected" : ""}>Coördinatenlijst / job</option><option value="vorige" ${r.origin === "vorige" ? "selected" : ""} ${UI.stage === 0 ? "disabled" : ""}>Alle vorige stappen</option>${prevNames.map((n) => `<option value="${esc(n)}" ${r.origin === n ? "selected" : ""}>Stap: ${esc(n)}</option>`).join("")}</select></td>
        <td><div class="seg sm">${["1D", "2D", "3D"].map((d) => `<button class="${r.dim === d ? "on" : ""}" data-act="rule-set" data-i="${i}" data-k="dim" data-v="${d}">${d}</button>`).join("")}</div></td>
        <td><select class="inl" data-rule="${i}" data-k="mode"><option value="vast" ${r.mode === "vast" ? "selected" : ""}>vast</option><option value="gewogen" ${r.mode === "gewogen" ? "selected" : ""}>gewogen</option><option value="vast_getoetst" ${r.mode === "vast_getoetst" ? "selected" : ""}>vast, wel toetsen</option></select></td>
        <td>${r.dim !== "1D" ? `<input class="inl mono" style="width:64px" data-rule="${i}" data-k="sxy_mm" value="${r.sxy_mm ?? ""}" placeholder="auto" title="σ ligging in mm (leeg = uit vorige stap)">` : ""} ${r.dim !== "2D" ? `<input class="inl mono" style="width:64px" data-rule="${i}" data-k="sh_mm" value="${r.sh_mm ?? ""}" placeholder="auto" title="σ hoogte in mm (leeg = uit vorige stap)">` : ""}</td>
        <td class="num">${f === null ? "–" : `${f} punt${f === 1 ? "" : "en"}`}</td>
        <td class="act"><button class="btn sm" data-act="rule-toggle" data-i="${i}">${r.disabled ? "Aan" : "Uit"}</button> <button class="btn sm danger" data-act="rule-del" data-i="${i}" aria-label="Regel verwijderen">✕</button></td></tr>`;
    }).join("");
    return `<section class="card"><div class="row"><h2 class="grow">Bekende punten · stap ${UI.stage + 1} ${esc(st.name)}</h2><button class="btn" data-act="rule-add">+ Regel</button></div>
      ${st.known.length ? `<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Punten</th><th>Code</th><th>Uit</th><th>Dim.</th><th>Status</th><th>σ xy / H (mm)</th><th class="num">Gevonden</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Nog geen regels: de stap rekent dan alleen op de metingen zelf (bij GNSS + total station ligt het netwerk vast via de GNSS-punten).</p>`}
      <p class="help">Punten: <span class="mono">*</span> = alle, <span class="mono">80*</span> = patroon, of een lijst met komma's. <b>Vast</b> doet niet mee, <b>gewogen</b> wordt meevereffend en getoetst (σ leeg = de σ uit de vorige stap). <b>Vast, wel toetsen</b> werkt zoals MOVE3 fase 2: de aansluiting wordt eerst gewogen getoetst, de eindcoördinaten zijn met de punten vast.</p></section>`;
  }

  // ------------------------------------------------------------- Bestanden
  function viewBestanden() {
    const st = curStage(), R = curRes();
    const srcInfo = (s) => (R && R.checks ? R.checks.sources.find((x) => x.tag === s.tag) : null);
    const list = st.sources.map((s, i) => {
      const inf = srcInfo(s);
      let opts = "";
      if (s.kind === "gsi") {
        const kind = s.options.soort || "";
        opts = `<label class="field">Soort<select data-src="${i}" data-k="soort"><option value="" ${!kind ? "selected" : ""}>automatisch</option><option value="tps" ${kind === "tps" ? "selected" : ""}>total station</option><option value="waterpassing" ${kind === "waterpassing" ? "selected" : ""}>waterpassing</option></select></label>`;
        if (inf && inf.kind === "gsi-tps") opts += `<label class="field">Doel<select data-src="${i}" data-k="prism"><option value="1" ${s.options.prism !== false ? "selected" : ""}>prisma</option><option value="0" ${s.options.prism === false ? "selected" : ""}>reflectorloos</option></select></label>`;
        if (inf && inf.kind === "gsi-wp") opts += `<label class="check" style="align-self:end"><input type="checkbox" data-src="${i}" data-k="start_known" ${s.options.start_known ? "checked" : ""}> Starthoogte uit het bestand vastzetten</label>`;
      }
      if (s.kind === "move3") opts = `<label class="field">Bekende punten<select data-src="${i}" data-k="phase"><option value="gewogen" ${s.options.phase !== "vast" ? "selected" : ""}>gewogen (fase 1)</option><option value="vast" ${s.options.phase === "vast" ? "selected" : ""}>vast</option></select></label>`;
      const kindName = { hexml: "HeXML", gsi: "GSI", coords: "LIJST", move3: "MOVE3" }[s.kind];
      return `<div class="srccard"><span class="badge blue">${kindName}</span><div class="grow" style="min-width:220px"><div class="mono" style="font-weight:600">${esc(s.name)}</div><div class="small muted">${esc(inf ? inf.summary : s.disabled ? "uitgeschakeld" : "")}${inf && inf.reflectors && inf.reflectors.length ? " · reflector: " + esc(inf.reflectors.join(", ")) : ""}</div></div>
        <label class="field">Label<input class="mono" style="width:90px" data-src="${i}" data-k="tag" value="${esc(s.tag)}"></label>${opts}
        <button class="btn sm" data-act="src-toggle" data-i="${i}">${s.disabled ? "Aanzetten" : "Uitzetten"}</button><button class="btn sm danger" data-act="src-del" data-i="${i}">Verwijderen</button></div>`;
    }).join("");
    const net = R && R.net;
    const cnt = (f) => (net ? net.obs.filter(f).length : 0);
    const stats = net ? [
      ["Richtingen", cnt((o) => o.kind === "R"), `${cnt((o) => o.kind === "R" && o.meta.faces === 2)} in 2 kijkerstanden`],
      ["Afstanden", cnt((o) => o.kind === "S"), S.settings.reduce_to_rd ? `gereduceerd naar RD (${nl(M.median(net.obs.filter((o) => o.kind === "S" && M.isNum(o.meta.scale_ppm)).map((o) => o.meta.scale_ppm)), 0)} ppm)` : "niet naar RD gereduceerd"],
      ["Hoogteverschillen", cnt((o) => o.kind === "DH"), `${cnt((o) => o.kind === "DH" && o.label === "trig")} trigonometrisch · ${cnt((o) => o.kind === "DH" && o.label !== "trig")} waterpassing`],
      ["GNSS", cnt((o) => o.kind === "GNSS"), `${new Set(net.obs.filter((o) => o.kind === "GNSS").map((o) => o.frm)).size} punten`],
      ["Punten", Object.values(net.points).filter((p) => p.code !== "HI").length, `${Object.values(net.points).filter((p) => p.code === "906").length} opstelpunten`],
    ] : [];
    const rules = st.known.filter((r) => !r.disabled);
    const pre = R && R.checks ? R.checks.precheck : [];
    return `<div class="row"><h1 class="grow">Bestanden van deze stap</h1></div>
      <div class="drop" data-drop="stage"><h2>Sleep één of meer meetbestanden hierheen</h2><div class="muted">HeXML (Captivate) · GSI8/GSI16 (total station of waterpassing) · MOVE3 (.tco + .obs) · coördinatenlijst</div><button class="btn pri" data-act="pick-files">Bestanden kiezen</button></div>
      ${st.sources.length ? `<section class="card">${list}</section>` : ""}
      ${R && R.error ? `<div class="msg bad"><b>Deze stap kan niet worden berekend:</b> ${esc(R.error)}</div>` : ""}
      <section class="card"><div class="row"><span class="badge">${rules.length ? (UI.stage ? "UIT EERDERE STAPPEN / LIJST" : "BEKENDE PUNTEN") : "GEEN BEKENDE PUNTEN"}</span><div class="grow">${rules.map((r) => `${esc(Array.isArray(r.points) ? r.points.join(", ") : r.points)}${r.codes && r.codes.length ? " (code " + esc(r.codes.join(",")) + ")" : ""}: ${r.dim} ${r.mode === "vast_getoetst" ? "vast, wel toetsen" : r.mode} uit ${r.origin === "lijst" ? "lijst/job" : esc(r.origin)}`).join(" · ") || '<span class="muted">Er zijn geen regels; het netwerk ligt vast via GNSS of wordt vrij vereffend.</span>'}</div><button class="btn sm" data-act="view" data-v="stappen">Regels wijzigen</button></div></section>
      ${stats.length ? `<section class="card"><h2>Wat er is ingelezen</h2><div class="grid2" style="margin-top:10px">${stats.map(([l, n, s]) => `<div><div class="small muted">${l}</div><div class="mono" style="font-size:22px">${n}</div><div class="small muted">${esc(s)}</div></div>`).join("")}</div></section>` : ""}
      ${pre.length ? `<section class="msg warn"><b>Voorcontrole</b>${pre.map((g) => `<div class="row" style="margin-top:6px"><span class="grow">${esc(g.station)} → ${esc(g.doel)} wijkt ${nl(g.afwijking_m, 2)} m af ${g.kept ? "(toch gebruikt)" : "en is uitgeschakeld"}.${g.past_op ? ` Past op <b>${esc(g.past_op)}</b> (${nl(g.past_afstand_m * 1000, 0)} mm): verkeerd puntnummer?` : ""}</span>${g.past_op && !g.kept ? `<button class="btn sm" data-act="rename" data-ref="${esc(g.ref)}" data-from="${esc(g.doel)}" data-to="${esc(g.past_op)}">Hernoemen naar ${esc(g.past_op)}</button>` : ""}<button class="btn sm" data-act="precheck-keep" data-ref="${esc(g.ref)}">${g.kept ? "Weer uitschakelen" : "Toch gebruiken"}</button></div>`).join("")}</section>` : ""}
      ${stageOptions(st)}
      <div class="foot"><button class="btn" data-act="view" data-v="stappen">← Stappen</button><button class="btn pri" data-act="tab" data-v="punten">Verder naar punten →</button></div>`;
  }
  function stageOptions(st) {
    const ov = st.settings ? Object.keys(st.settings).length : 0;
    return `<section class="card"><div class="row"><h2 class="grow">Instellingen voor deze stap</h2><button class="btn sm" data-act="stage-settings">${ov ? `${ov} afwijkende instelling${ov > 1 ? "en" : ""} · wijzigen` : "Precisies aanpassen voor deze stap"}</button></div>
      <div class="grid2" style="margin-top:10px">
        <label class="field">Vereffenen<select data-stage-k="dims"><option value="auto" ${st.dims === "auto" ? "selected" : ""}>2D en 1D (automatisch)</option><option value="2D" ${st.dims === "2D" ? "selected" : ""}>alleen 2D (ligging)</option><option value="1D" ${st.dims === "1D" ? "selected" : ""}>alleen 1D (hoogte)</option></select></label>
        <label class="field">Data snooping (max. te verwijderen)<input type="number" min="0" max="50" step="1" data-stage-k="snooping" value="${st.snooping || 0}"></label>
        <label class="field">GNSS-hoogtes<select data-stage-k="gnss_heights"><option value="gebruiken" ${st.gnss_heights !== "controle" ? "selected" : ""}>meenemen in 1D</option><option value="controle" ${st.gnss_heights === "controle" ? "selected" : ""}>alleen ter controle</option></select></label>
      </div>
      <div class="row" style="margin-top:8px;gap:18px">
        <label class="check"><input type="checkbox" data-stage-k="precheck" ${st.precheck ? "checked" : ""}> Voorcontrole op grove fouten</label>
        <label class="check"><input type="checkbox" data-stage-k="estimate_scale" ${st.estimate_scale ? "checked" : ""}> Schaalfactor afstanden meeschatten</label>
        <label class="check"><input type="checkbox" data-stage-k="follow_captivate" ${st.follow_captivate ? "checked" : ""}> Captivate ja/nee-keuze volgen</label>
      </div></section>`;
  }

  // ------------------------------------------------------------- Punten
  function viewPunten() {
    const st = curStage(), R = curRes();
    if (!R || R.error || !R.net) return `<h1>Punten en status</h1><div class="msg warn">Nog geen berekening voor deze stap. Voeg eerst bestanden toe.</div>`;
    const info = pointInfo(R);
    let pts = Object.values(info).sort((a, b) => natural(a.name, b.name));
    const codes = [...new Set(pts.map((p) => p.code).filter(Boolean))].sort(natural);
    const total = pts.length;
    if (UI.pfilter === "meldingen") pts = pts.filter((p) => p.notes.some((n) => n.cls === "warn") || p.status_xy !== "vrij" || p.status_h !== "vrij");
    else if (UI.pfilter.startsWith("code:")) pts = pts.filter((p) => p.code === UI.pfilter.slice(5));
    if (UI.psearch) pts = pts.filter((p) => p.name.toLowerCase().includes(UI.psearch.toLowerCase()));
    const ruleTxt = st.known.filter((r) => !r.disabled).map((r) => { const x = R.checks.rules.find((q) => q.rule === r); return `${x ? x.names.length : 0} punt(en) ${esc(Array.isArray(r.points) ? r.points.join(", ") : r.points)}: ${r.dim} ${r.mode === "vast_getoetst" ? "vast, wel toetsen" : r.mode} uit ${r.origin === "lijst" ? "lijst/job" : esc(r.origin)}`; }).join(" · ");
    const nap = Object.values(info).filter((p) => ROLE[p.code] === "nap" && p.status_h === "vrij");
    const segBtn = (n, key, cur) => `<div class="seg sm">${["vrij", "vast", "gewogen"].map((m) => `<button class="${cur === m ? "on " + m : ""}" data-act="ovr" data-n="${esc(n)}" data-k="${key}" data-v="${m}">${m}</button>`).join("")}</div>`;
    const ovs = st.overrides || {};
    const rows = pts.slice(0, 400).map((p) => {
      const src = [];
      if (p.gnss.size) src.push(`<span class="badge blue">GNSS ×${p.gnss.size}</span>`);
      if (p.wp) src.push('<span class="badge">WP</span>');
      if (p.tps.size) src.push(`<span class="badge">TPS ×${p.tps.size}</span>`);
      const c = p.res || {};
      const sd = c.sx !== undefined ? (Math.max(c.sx, c.sy) > 0 ? `σ ${mm(Math.max(c.sx, c.sy))} mm` : "vast") : "";
      return `<tr><td class="mono" style="font-weight:600">${esc(p.name)}</td><td>${esc(p.code)} <span class="small muted">${esc(codeDesc(p.code))}</span></td><td>${src.join(" ")}</td>
        <td>${segBtn(p.name, "xy", p.status_xy)}<div class="small muted">${sd}${c.x === undefined ? " geen ligging" : ""}</div></td>
        <td>${segBtn(p.name, "h", p.status_h)}<div class="small muted">${c.sH !== undefined ? (c.sH > 0 ? `σH ${mm(c.sH)} mm` : "vast") : "geen hoogte"}</div></td>
        <td class="small">${p.notes.map((n) => `<div style="color:${n.cls === "warn" ? "var(--warn)" : "var(--mut)"}">${esc(n.t)}</div>`).join("")}${ovs[p.name] ? `<button class="btn sm" data-act="ovr-reset" data-n="${esc(p.name)}">Terug naar regels</button>` : ""}</td></tr>`;
    }).join("");
    return `<div class="row"><div class="grow"><h1>Punten en status</h1><div class="muted">Status volgt uit de regels van deze stap; per punt kun je afwijken. Vast doet niet mee, gewogen wordt meegetoetst.</div></div></div>
      <div class="row"><div class="seg">${[["alle", `Alle ${total} punten`], ["meldingen", "Alleen meldingen en bekende"]].map(([k, l]) => `<button class="${UI.pfilter === k ? "on" : ""}" data-act="pfilter" data-v="${k}">${l}</button>`).join("")}</div>
        <select class="inl" data-act="pfilter-code" style="min-height:40px"><option value="">Code…</option>${codes.map((c) => `<option value="${esc(c)}" ${UI.pfilter === "code:" + c ? "selected" : ""}>${esc(c)} ${esc(codeDesc(c))}</option>`).join("")}</select>
        <input class="inl" style="min-height:40px" placeholder="Zoek punt" data-act="psearch" value="${esc(UI.psearch)}"></div>
      <div class="msg info small"><b>Regels toegepast:</b> ${ruleTxt || "geen"} <button class="btn sm" data-act="view" data-v="stappen">Regels</button></div>
      ${nap.length ? `<div class="msg warn small">Er ${nap.length === 1 ? "is" : "zijn"} ${nap.length} punt(en) met een NAP-code (${nap.map((p) => esc(p.name)).join(", ")}) die nog niet vast staan. <button class="btn sm" data-act="nap-rule">Regel toevoegen: NAP-punten 1D vast</button></div>` : ""}
      <section class="card tight"><div class="tablewrap"><table><thead><tr><th>Punt</th><th>Code</th><th>Bepaald met</th><th>Ligging (x, y)</th><th>Hoogte (H)</th><th>Opmerking</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="small muted" style="padding:8px 12px">${Math.min(pts.length, 400)} van ${total} punten getoond · GNSS ×2 = twee bezettingen · TPS ×n = aantal opstellingen · WP = waterpassing. Handmatig gewogen gebruikt σ ${nl(S.settings.default_sxy_mm || 10, 0)} mm (ligging) / ${nl(S.settings.default_sh_mm || 2, 0)} mm (hoogte) en de huidige coördinaten van het punt.</div></section>
      <div class="foot"><button class="btn" data-act="tab" data-v="bestanden">← Bestanden</button><button class="btn pri" data-act="tab" data-v="vereffening">Vereffenen →</button></div>`;
  }

  // ------------------------------------------------------------- Vereffening
  function freeAdjust(R, dim) {
    const net = R.net.clone();
    net.removeObs((o) => o.kind === "XY" || o.kind === "HH" || o.kind === "GNSS" || o.kind === "GNSSH");
    for (const p of Object.values(net.points)) { p.fix_xy = false; p.fix_h = false; p.status_xy = "vrij"; p.status_h = "vrij"; }
    const st = curStage();
    const adj = new V.Adjustment(net, { testing: new V.Testing(S.settings.alpha0, S.settings.beta0), estimateScale: st.estimate_scale });
    if (dim === "2D") return net.obs.some((o) => o.kind === "R" || o.kind === "S") ? adj.adjust2d(20) : null;
    return net.obs.some((o) => o.kind === "DH") ? adj.adjust1d() : null;
  }
  function viewVereffening() {
    const st = curStage(), R = curRes();
    if (!R || R.error || !R.net) return `<h1>Vereffening en toetsing</h1><div class="msg ${R && R.error ? "bad" : "warn"}">${R && R.error ? esc(R.error) : "Nog geen berekening voor deze stap."}</div>`;
    if (UI.dim === "2D" && !R.r2 && R.r1) UI.dim = "1D";
    if (UI.dim === "1D" && !R.r1 && R.r2) UI.dim = "2D";
    let res = UI.dim === "2D" ? R.r2 : R.r1;
    const test = UI.dim === "2D" ? R.r2_test : R.r1_test;
    let freeNote = "";
    if (UI.phase === "vrij") {
      try { res = freeAdjust(R, UI.dim); } catch (e) { res = null; }
      freeNote = res ? `<div class="msg info small">Vrije vereffening: alleen de terrestrische metingen (total station / waterpassing), zonder bekende punten en GNSS. Zo zie je de interne kwaliteit los van de aansluiting. De eindcoördinaten komen uit <b>Aansluitend</b>.</div>` : `<div class="msg warn">Geen terrestrische metingen in ${UI.dim} om vrij te vereffenen.</div>`;
    }
    const toggles = `<div class="row"><h1 class="grow">Vereffening en toetsing</h1>
      <div class="seg">${["2D", "1D"].map((d) => `<button class="${UI.dim === d ? "on" : ""}" data-act="dim" data-v="${d}" ${(d === "2D" ? R.r2 : R.r1) ? "" : "disabled"}>${d === "2D" ? "2D ligging" : "1D hoogte"}</button>`).join("")}</div>
      <div class="seg">${[["vrij", "Vrij"], ["aansluitend", "Aansluitend"]].map(([k, l]) => `<button class="${UI.phase === k ? "on" : ""}" data-act="phase" data-v="${k}">${l}</button>`).join("")}</div></div>`;
    if (!res) return toggles + (freeNote || `<div class="msg warn">Geen ${UI.dim}-waarnemingen in deze stap.</div>`);
    const T = UI.phase === "aansluitend" && test ? test : res;
    const nrej = T.obs_results.filter((o) => o.rejected).length;
    const maxEll = Object.entries(res.ellipse || {}).reduce((a, [n, e]) => (e[0] > a[1] ? [n, e[0]] : a), ["", 0]);
    const maxSH = UI.dim === "1D" ? Object.entries(res.sd).reduce((a, [n, s]) => (s > a[1] && R.net.points[n].code !== "HI" ? [n, s] : a), ["", 0]) : null;
    const blockCrit = T.obs_results.find((o) => o.resid.length === 2);
    const kpi = `<div class="kpis">
      <div class="kpi ${T.redundancy === 0 ? "" : T.F_ok ? "ok" : "bad"}"><div class="l">F-toets${test && UI.phase === "aansluitend" ? " (bekende punten gewogen)" : ""}</div><div class="v">${T.redundancy ? nl(T.F, 2) : "–"}</div><div class="s">${T.redundancy ? `${T.F_ok ? "Aanvaard" : "Verworpen"} · kritiek ${nl(T.F_crit, 2)}` : "niet toetsbaar (r = 0)"}</div></div>
      <div class="kpi"><div class="l">Overtalligheid</div><div class="v">${T.redundancy}</div><div class="s">${res.iterations} iteratie${res.iterations > 1 ? "s" : ""}${res.free ? " · vrij netwerk" : ""}</div></div>
      <div class="kpi ${nrej ? "bad" : ""}"><div class="l">Verworpen toetsen</div><div class="v">${nrej}</div><div class="s">kritiek w ${nl(T.obs_results[0] ? new V.Testing(S.settings.alpha0, S.settings.beta0).k_w : NaN, 2)}${blockCrit ? ` · GNSS/bekend T/b ${nl(blockCrit.w_crit, 2)}` : ""}</div></div>
      ${UI.dim === "2D" ? `<div class="kpi"><div class="l">Grootste ellips (1σ)</div><div class="v">${mm(maxEll[1])} mm</div><div class="s">${esc(maxEll[0])}</div></div>` : `<div class="kpi"><div class="l">Grootste σH</div><div class="v">${mm(maxSH[1], 2)} mm</div><div class="s">${esc(maxSH[0])}</div></div>`}</div>`;
    let msg;
    const rejSorted = T.obs_results.filter((o) => o.rejected).sort((a, b) => Math.abs(b.w) / b.w_crit - Math.abs(a.w) / a.w_crit);
    if (T.redundancy === 0) msg = `<div class="msg warn"><b>Geen overtalligheid.</b> Er is niets te toetsen: de coördinaten volgen direct uit de metingen. Meet extra verbindingen of een tweede bezetting.</div>`;
    else if (!nrej && T.F_ok) msg = `<div class="msg ok"><b>Geen verworpen waarnemingen.</b> ${(() => { const kp = T.obs_results.filter((o) => o.obs.kind === "XY" || o.obs.kind === "HH"); return kp.length ? `Alle ${kp.length} bekende punten passen als gewogen aansluitpunt (grootste toets ${nl(Math.max(...kp.map((o) => Math.abs(o.w)).filter(M.isNum), 0), 2)}).` : ""; })()}</div>`;
    else {
      const w = rejSorted[0];
      msg = `<div class="msg bad"><b>${nrej ? `${nrej} verworpen waarneming${nrej > 1 ? "en" : ""}.` : "F-toets verworpen."}</b> ${w ? `Grootste toets: ${esc(V.obsLabel(w.obs))} (${esc(w.obs.ref || "aansluiting")}), ${nl(w.w, 2)}. Controleer deze eerst; schakel hem uit in de tabel of zet data snooping aan.` : "De metingen passen samen minder goed dan de a-priori precisies zeggen. Controleer de precisies in Instellingen."} ${UI.phase === "aansluitend" ? `<button class="btn sm" data-act="snoop-on">${st.snooping ? `Data snooping staat op max. ${st.snooping}` : "Data snooping aanzetten (max. 5)"}</button>` : ""}</div>`;
    }
    // uitgeschakeld
    const off = [];
    for (const g of R.checks.precheck) off.push(`<div class="row small" style="border-top:1px solid var(--line);padding-top:8px"><span class="badge">VOORCONTROLE</span><span class="grow">${esc(g.station)} → ${esc(g.doel)} · ${nl(g.afwijking_m, 2)} m afwijking${g.past_op ? " · past op " + esc(g.past_op) : ""}${g.kept ? " · toch gebruikt" : ""}</span><button class="btn sm" data-act="precheck-keep" data-ref="${esc(g.ref)}">${g.kept ? "Weer uitschakelen" : "Terugzetten"}</button></div>`);
    for (const s of R.checks.snooping) off.push(`<div class="row small" style="border-top:1px solid var(--line);padding-top:8px"><span class="badge">DATA SNOOPING</span><span class="grow">${esc(s.tekst)}</span><button class="btn sm" data-act="snoop-keep" data-ref="${esc(s.ref)}">Terugzetten</button></div>`);
    for (const r of st.exclude_refs) off.push(`<div class="row small" style="border-top:1px solid var(--line);padding-top:8px"><span class="badge">HANDMATIG</span><span class="grow mono">${esc(r)}</span><button class="btn sm" data-act="excl" data-ref="${esc(r)}">Terugzetten</button></div>`);
    (st.renames || []).forEach((rn, k) => off.push(`<div class="row small" style="border-top:1px solid var(--line);padding-top:8px"><span class="badge">HERNOEMD</span><span class="grow">${esc(rn.ref)}: ${esc(rn.from)} → ${esc(rn.to)}</span><button class="btn sm" data-act="unrename" data-k="${k}">Ongedaan maken</button></div>`));
    for (const r of st.snoop_keep || []) off.push(`<div class="row small" style="border-top:1px solid var(--line);padding-top:8px"><span class="badge">BEHOUDEN</span><span class="grow mono">${esc(r)} wordt niet door data snooping verwijderd</span><button class="btn sm" data-act="snoop-keep" data-ref="${esc(r)}">Opheffen</button></div>`);
    if (st.follow_captivate && R.checks.captivateNo.length) off.push(`<div class="row small" style="border-top:1px solid var(--line);padding-top:8px"><span class="badge">CAPTIVATE NEE</span><span class="grow">${R.checks.captivateNo.length} metingen volgens Captivate-keuze uitgeschakeld</span></div>`);
    const offBox = off.length ? `<section class="card"><div class="row"><h2 class="grow">Uitgeschakeld in deze stap</h2><span class="small muted">elke regel is terug te zetten</span></div>${off.join("")}</section>` : "";
    // waarnemingen
    const capNo = new Set(R.checks.captivateNo);
    const excl = new Set(st.exclude_refs);
    let obs = [...T.obs_results].sort((a, b) => (M.isNum(b.w) ? Math.abs(b.w) / b.w_crit : -1) - (M.isNum(a.w) ? Math.abs(a.w) / a.w_crit : -1));
    const nObs = obs.length;
    if (!UI.showAllObs) obs = obs.slice(0, 25);
    const orow = (r) => {
      const o = r.obs, known = o.kind === "XY" || o.kind === "HH";
      const ref = o.ref || "";
      return `<tr class="${r.rejected ? "rej" : ""}"><td class="mono" style="font-size:13px">${esc(V.obsLabel(o))}${o.meta && o.meta.hernoemd ? ` <span class="badge warn">was ${esc(o.meta.hernoemd)}</span>` : ""}<div class="small muted">${esc(known ? "bekend punt (gewogen)" : ref)}${capNo.has(ref) ? ' · <span style="color:var(--warn)">Captivate: nee</span>' : ""}${o.meta && o.meta.faces === 1 ? " · 1 kijkerstand" : ""}</div></td>
        <td class="num">${known ? "–" : esc(V.residText(r))}</td><td class="num" style="${r.rejected ? "color:var(--bad);font-weight:600" : ""}">${nl(r.w, 2)}${r.resid.length === 2 ? " <span class='small muted'>T/b</span>" : ""}</td><td class="num">${nl(r.redundancy, 2)}</td><td class="num">${esc(V.mdbText(r))}</td><td class="num">${isFinite(r.ext_rel) ? mm(r.ext_rel) : "–"}</td>
        <td class="act">${known ? `<button class="btn sm" data-act="ovr" data-n="${esc(o.frm)}" data-k="${o.kind === "XY" ? "xy" : "h"}" data-v="vrij">Vrijlaten</button>` : ref ? `<button class="btn sm" data-act="excl" data-ref="${esc(ref)}" title="Schakelt richting, afstand en hoogteverschil van deze meting uit">Uit</button>` : ""}</td></tr>`;
    };
    const table = `<div class="card tight" style="flex:999 1 560px;min-width:0"><div class="row" style="padding:12px 16px"><h2 class="grow">Waarnemingen, gesorteerd op toetsgrootheid</h2><span class="small muted">${nObs} totaal</span></div>
      <div class="tablewrap"><table><thead><tr><th>Waarneming</th><th class="num">Verbetering</th><th class="num">Toets</th><th class="num">red.</th><th class="num">MDB</th><th class="num">ext. (mm)</th><th></th></tr></thead><tbody>${obs.map(orow).join("")}</tbody></table></div>
      ${nObs > 25 ? `<div style="padding:10px 16px"><button class="btn sm" data-act="allobs">${UI.showAllObs ? "Alleen de eerste 25 tonen" : `Alle ${nObs} waarnemingen tonen`}</button></div>` : ""}</div>`;
    const mapFig = UI.dim === "2D" ? `<figure class="card" style="flex:1 1 420px;min-width:0;margin:0;padding:12px;align-self:flex-start;position:sticky;top:76px"><div class="row" style="padding-bottom:8px"><h2 class="grow">Netwerkkaart</h2>
        <button class="iconbtn" data-act="view" data-v="kaart" aria-label="Kaart vergroten">${ICON.expand}</button><button class="iconbtn" data-act="map-window" aria-label="Kaart openen in nieuw venster">${ICON.ext}</button><button class="btn out" data-act="dxf">DXF</button></div>
        <div class="mapbox" id="map" style="height:440px"></div>${legend()}</figure>` : levelTable(res);
    const extra = res.extra && res.extra.scale ? `<div class="msg info small">Schaalfactor afstanden: <span class="mono">${res.extra.scale[0].toFixed(7)} ± ${res.extra.scale[1].toFixed(7)}</span> (${sg((res.extra.scale[0] - 1) * 1e6, 1)} ppm)</div>` : "";
    const ghc = UI.dim === "1D" && R.checks.gnssHctrl ? `<div class="msg info small">GNSS-hoogte min vereffende hoogte (alleen controle, ${R.checks.gnssHctrl.n} metingen): mediaan <b>${sg(R.checks.gnssHctrl.median_mm)} mm</b>, spreiding ${nl(R.checks.gnssHctrl.spread_mm)} mm.</div>` : "";
    return toggles + freeNote + kpi + msg + extra + ghc + offBox + `<div class="row" style="align-items:stretch;gap:16px">${mapFig}${table}</div>
      <div class="foot"><button class="btn" data-act="tab" data-v="punten">← Punten</button><button class="btn pri" data-act="tab" data-v="export">Naar export →</button></div>`;
  }
  function levelTable(res) {
    const rows = Object.keys(res.coords).filter((n) => curRes().net.points[n].code !== "HI").sort(natural).map((n) => `<tr><td class="mono">${esc(n)}</td><td class="num">${res.coords[n].toFixed(4).replace(".", ",")}</td><td class="num">${res.sd[n] ? mm(res.sd[n], 2) : "vast"}</td></tr>`).join("");
    return `<div class="card tight" style="flex:1 1 320px;min-width:0"><div style="padding:12px 16px"><h2>Hoogtes</h2></div><div class="tablewrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>Punt</th><th class="num">H (m)</th><th class="num">σH (mm)</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  function legend() {
    return `<div class="legend" style="padding-top:6px"><span><svg width="12" height="12"><polygon points="6,1 11,11 1,11" fill="#B42318"/></svg> bekend / aansluiting</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#0B5FA5"/></svg> nieuw punt</span><span><svg width="12" height="12"><path d="M2 2L10 10M2 10L10 2" stroke="#15202B" stroke-width="2"/></svg> opstelling</span><span><svg width="14" height="12"><path d="M1 6H13" stroke="#1F7A3A" stroke-width="2" stroke-dasharray="3 2"/></svg> GNSS</span><span><svg width="14" height="12"><path d="M1 6H13" stroke="#E07B00" stroke-width="2.5"/></svg> verworpen</span><span><svg width="14" height="12"><ellipse cx="7" cy="6" rx="6" ry="3" fill="none" stroke="#5B3FB0"/></svg> ellips</span></div>`;
  }

  // ------------------------------------------------------------- kaart (SVG, eigen pan/zoom)
  function mapModel(R) {
    const res = R.r2;
    if (!res) return null;
    const C = res.coords, net = R.net;
    const pts = Object.keys(C).map((n) => ({ n, x: C[n][0], y: C[n][1], p: net.points[n] || {}, e: res.ellipse[n], c: R.coords[n] }));
    const lines = new Map();
    for (const r of res.obs_results) {
      const o = r.obs;
      if ((o.kind === "R" || o.kind === "S") && C[o.frm] && C[o.to]) {
        const k = [o.frm, o.to].sort().join("\u0000");
        const L = lines.get(k) || { a: o.frm, b: o.to, rej: false, n: 0, maxw: 0 };
        L.rej = L.rej || r.rejected; L.n++; L.maxw = Math.max(L.maxw, Math.abs(r.w) || 0);
        lines.set(k, L);
      }
    }
    const gnss = new Set(res.obs_results.filter((r) => r.obs.kind === "GNSS").map((r) => r.obs.frm));
    const gnssRej = new Set(res.obs_results.filter((r) => r.obs.kind === "GNSS" && r.rejected).map((r) => r.obs.frm));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { pts, lines: [...lines.values()], gnss, gnssRej, C, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  }
  function autoEll(model) {
    const ext = Math.max(model.bbox[2] - model.bbox[0], model.bbox[3] - model.bbox[1], 1);
    const emax = Math.max(...model.pts.map((p) => (p.e ? p.e[0] : 0)), 1e-6);
    const target = ext * 0.012 / emax;
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    return steps.reduce((a, b) => (Math.abs(Math.log(b / target)) < Math.abs(Math.log(a / target)) ? b : a));
  }
  function mapSVG(model, view, W, H, layers, ellScale, sel) {
    const s = view.s, X = (x) => W / 2 + (x - view.cx) * s, Y = (y) => H / 2 - (y - view.cy) * s;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,Segoe UI,Roboto,Arial,sans-serif">`, `<rect width="${W}" height="${H}" fill="#FBFCFD"/>`];
    // schaalstok
    const target = 120 / s, pow = Math.pow(10, Math.floor(Math.log10(target)));
    const bar = [1, 2, 5, 10].map((k) => k * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    if (layers.raster) {
      const step = bar;
      const x0 = Math.floor((view.cx - W / 2 / s) / step) * step, y0 = Math.floor((view.cy - H / 2 / s) / step) * step;
      for (let x = x0; x <= view.cx + W / 2 / s; x += step) out.push(`<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${H}" stroke="#E8ECF0"/>`);
      for (let y = y0; y <= view.cy + H / 2 / s; y += step) out.push(`<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="#E8ECF0"/>`);
    }
    if (layers.waarnemingen || layers.verworpen) for (const L of model.lines) {
      if (L.rej ? !layers.verworpen : !layers.waarnemingen) continue;
      const a = model.C[L.a], b = model.C[L.b];
      out.push(`<line x1="${X(a[0]).toFixed(1)}" y1="${Y(a[1]).toFixed(1)}" x2="${X(b[0]).toFixed(1)}" y2="${Y(b[1]).toFixed(1)}" stroke="${L.rej ? "#E07B00" : "#9AA5B1"}" stroke-width="${L.rej ? 2.5 : 1}"/>`);
    }
    if (layers.ellipsen) for (const p of model.pts) if (p.e) {
      const a = p.e[0] * ellScale * s, b = p.e[1] * ellScale * s, rot = p.e[2] * 0.9 - 90;
      out.push(`<ellipse cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" rx="${Math.max(a, 0.5).toFixed(1)}" ry="${Math.max(b, 0.5).toFixed(1)}" transform="rotate(${rot.toFixed(2)} ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)})" fill="none" stroke="#5B3FB0" stroke-width="1.2"/>`);
    }
    for (const p of model.pts) {
      const x = X(p.x), y = Y(p.y);
      if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
      const known = p.p.status_xy && p.p.status_xy !== "vrij";
      if (layers.gnss && model.gnss.has(p.n)) out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke="${model.gnssRej.has(p.n) ? "#E07B00" : "#1F7A3A"}" stroke-width="1.6" stroke-dasharray="3 2"/>`);
      if (layers.punten) {
        if (known) out.push(`<polygon points="${x},${y - 7} ${x + 6},${y + 4.5} ${x - 6},${y + 4.5}" fill="#B42318"/>`);
        else if (p.p.code === "906") out.push(`<path d="M${x - 4.5} ${y - 4.5}L${x + 4.5} ${y + 4.5}M${x - 4.5} ${y + 4.5}L${x + 4.5} ${y - 4.5}" stroke="#15202B" stroke-width="2"/>`);
        else if (p.p.code === "909") out.push(`<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="${/[13579]$/.test(p.n) ? "#8A3A00" : "#6B21A8"}"/>`);
        else out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#0B5FA5"/>`);
        if (sel === p.n) out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="none" stroke="#0B5FA5" stroke-width="2.5"/>`);
      }
      if (layers.nummers) out.push(`<text x="${(x + 7).toFixed(1)}" y="${(y - 7).toFixed(1)}" font-size="11" fill="#3E4A56">${esc(p.n)}</text>`);
    }
    out.push(`<g transform="translate(14 ${H - 16})"><rect x="-6" y="-20" width="${bar * s + 50}" height="30" fill="rgba(255,255,255,.85)"/><line x1="0" y1="0" x2="${bar * s}" y2="0" stroke="#15202B" stroke-width="3"/><text x="${bar * s + 6}" y="4" font-size="12" fill="#15202B">${bar >= 1 ? bar : bar.toFixed(2)} m</text>${layers.ellipsen ? `<text x="0" y="-8" font-size="11" fill="#5B3FB0">ellipsen ×${ellScale}</text>` : ""}</g>`);
    out.push(`<text x="${W - 10}" y="${H - 10}" text-anchor="end" font-size="11" fill="#8A949E">RD x/y · noord boven</text></svg>`);
    return out.join("");
  }
  function attachMap(el, R, opts = {}) {
    const model = mapModel(R);
    if (!model) { el.innerHTML = '<div class="empty muted">Geen ligging in deze stap.</div>'; return; }
    const ell = UI.ellScale === "auto" ? autoEll(model) : +UI.ellScale;
    const W0 = () => el.clientWidth || 600, H0 = () => el.clientHeight || 380;
    const fit = () => {
      const [x0, y0, x1, y1] = model.bbox;
      const s = Math.min((W0() - 110) / Math.max(x1 - x0, 1), (H0() - 110) / Math.max(y1 - y0, 1));
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s };
    };
    let view = el._view || fit(), sel = el._sel || null;
    const draw = () => {
      el._view = view;
      el.innerHTML = mapSVG(model, view, W0(), H0(), UI.mapLayers, ell, sel) +
        `<div class="maptools"><button data-z="1.5" aria-label="Inzoomen">+</button><button data-z="0.667" aria-label="Uitzoomen">−</button><button data-z="fit" aria-label="Passend maken" style="font-size:13px">▢</button></div>` +
        (sel ? infoBox(R, sel) : `<div class="small muted" style="position:absolute;left:8px;top:6px;background:rgba(255,255,255,.85);padding:2px 6px;border-radius:4px">Tik op een punt voor details · slepen = verschuiven</div>`);
    };
    draw();
    el.onclick = (ev) => {
      const z = ev.target.closest("[data-z]");
      if (z) { const v = z.dataset.z; view = v === "fit" ? fit() : { ...view, s: view.s * +v }; draw(); return; }
      if (ev.target.closest(".mapinfo")) { if (ev.target.closest("[data-close]")) { sel = el._sel = null; draw(); } return; }
      if (el._dragged) return;
      const r = el.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let best = null, bd = 18;
      for (const p of model.pts) { const d = Math.hypot(W0() / 2 + (p.x - view.cx) * view.s - mx, H0() / 2 - (p.y - view.cy) * view.s - my); if (d < bd) { bd = d; best = p.n; } }
      sel = el._sel = best; draw();
    };
    el.onwheel = (ev) => { ev.preventDefault(); const k = ev.deltaY < 0 ? 1.25 : 0.8; const r = el.getBoundingClientRect(); const mx = ev.clientX - r.left - W0() / 2, my = ev.clientY - r.top - H0() / 2; const wx = view.cx + mx / view.s, wy = view.cy - my / view.s; const s = view.s * k; view = { s, cx: wx - mx / s, cy: wy + my / s }; draw(); };
    let drag = null;
    el.onpointerdown = (ev) => { if (ev.target.closest("button,.mapinfo")) return; drag = { x: ev.clientX, y: ev.clientY, v: { ...view } }; el._dragged = false; };
    el.onpointermove = (ev) => { if (!drag) return; const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) el._dragged = true; if (el._dragged) { view = { ...drag.v, cx: drag.v.cx - dx / view.s, cy: drag.v.cy + dy / view.s }; draw(); } };
    el.onpointerup = el.onpointerleave = () => { drag = null; setTimeout(() => (el._dragged = false), 0); };
  }
  function infoBox(R, n) {
    const c = R.coords[n] || {}, p = R.net.points[n] || {}, e = R.r2 && R.r2.ellipse[n];
    return `<div class="mapinfo"><div class="row"><b class="mono grow">${esc(n)}</b><button class="btn sm" data-close="1" aria-label="Sluiten">✕</button></div>
      <div>${esc(p.code)} ${esc(codeDesc(p.code))} · ligging ${esc(p.status_xy)} · hoogte ${esc(p.status_h)}</div>
      <div class="mono">x ${nl(c.x, 4)} · y ${nl(c.y, 4)}${M.isNum(c.H) ? ` · H ${nl(c.H, 4)}` : ""}</div>
      <div class="mono">σx ${mm(c.sx)} · σy ${mm(c.sy)}${M.isNum(c.sH) ? ` · σH ${mm(c.sH)}` : ""} mm</div>${e ? `<div class="mono">ellips ${mm(e[0])} × ${mm(e[1])} mm, ${nl(e[2], 0)} gon</div>` : ""}</div>`;
  }
  function viewKaart() {
    const R = curRes();
    const L = UI.mapLayers;
    const lay = [["punten", "Punten (vast / vrij)"], ["nummers", "Puntnummers"], ["waarnemingen", "Richtingen en afstanden"], ["gnss", "GNSS-metingen"], ["verworpen", "Verworpen waarnemingen"], ["ellipsen", "Standaardellipsen"], ["raster", "RD-raster"]];
    return `<div class="row"><button class="btn" data-act="back-from-map">← Terug naar resultaat</button><h1 class="grow">${esc(curStage() ? `Stap ${UI.stage + 1} · ${curStage().name}` : "")} · netwerkkaart</h1></div>
      <div class="row" style="align-items:stretch;gap:16px"><div class="mapbox" id="map" style="flex:1 1 600px;height:calc(100vh - 190px);min-height:420px"></div>
      <aside class="card" style="flex:0 1 300px;display:flex;flex-direction:column;gap:10px"><h2>Lagen</h2>${lay.map(([k, l]) => `<label class="check"><input type="checkbox" data-layer="${k}" ${L[k] ? "checked" : ""}> ${l}</label>`).join("")}
        <label class="field">Ellipsvergroting<select data-act="ellscale">${["auto", "1000", "2000", "5000", "10000", "20000"].map((v) => `<option value="${v}" ${UI.ellScale === v ? "selected" : ""}>${v === "auto" ? "automatisch" : "× " + v}</option>`).join("")}</select></label>
        ${legend()}
        <h2 style="margin-top:8px">Opslaan als DXF</h2><div class="help">In echte RD-coördinaten, één laag per onderdeel, zodat het netjes over je tekening valt.</div>
        <label class="check"><input type="checkbox" data-act="dxfvis" ${UI.dxfVisible ? "checked" : ""}> Alleen zichtbare lagen</label>
        <label class="check"><input type="checkbox" data-act="dxf3d" ${UI.dxf3d ? "checked" : ""}> Punten op NAP-hoogte (3D)</label>
        <button class="btn pri" data-act="dxf">DXF downloaden</button><button class="btn" data-act="map-window">Openen in nieuw venster</button></aside></div>`;
  }
  function mapWindow() {
    const R = curRes(), model = R && mapModel(R);
    if (!model) return;
    const ell = UI.ellScale === "auto" ? autoEll(model) : +UI.ellScale;
    const W = 1600, H = 1000;
    const [x0, y0, x1, y1] = model.bbox;
    const s = Math.min((W - 80) / Math.max(x1 - x0, 1), (H - 80) / Math.max(y1 - y0, 1));
    const svg = mapSVG(model, { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s }, W, H, UI.mapLayers, ell, null);
    const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Netwerkkaart · ${esc(curStage().name)}</title><style>html,body{margin:0;height:100%;background:#fff;font-family:system-ui,sans-serif}svg{width:100%;height:calc(100% - 36px);display:block}div{padding:8px 12px;font-size:14px;color:#3E4A56}</style></head><body><div>${esc(S.name)} · stap ${UI.stage + 1} ${esc(curStage().name)} · scroll om te zoomen, slepen om te verschuiven</div>${svg.replace("<svg ", '<svg id="m" preserveAspectRatio="xMidYMid meet" ')}<script>const s=document.getElementById("m");let vb=[0,0,${W},${H}],d=null;const set=()=>s.setAttribute("viewBox",vb.join(" "));s.addEventListener("wheel",e=>{e.preventDefault();const k=e.deltaY<0?0.8:1.25,r=s.getBoundingClientRect(),px=vb[0]+(e.clientX-r.left)/r.width*vb[2],py=vb[1]+(e.clientY-r.top)/r.height*vb[3];vb=[px-(px-vb[0])*k,py-(py-vb[1])*k,vb[2]*k,vb[3]*k];set()},{passive:false});s.addEventListener("pointerdown",e=>d={x:e.clientX,y:e.clientY,v:[...vb]});addEventListener("pointerup",()=>d=null);s.addEventListener("pointermove",e=>{if(!d)return;const r=s.getBoundingClientRect();vb=[d.v[0]-(e.clientX-d.x)/r.width*vb[2],d.v[1]-(e.clientY-d.y)/r.height*vb[3],vb[2],vb[3]];set()});<\/script></body></html>`;
    const w = window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
    if (!w) download(`netwerkkaart_${safeName(curStage().name)}.html`, html, "text/html");
  }
  function doDXF() {
    const R = curRes();
    if (!R || !R.r2) { toast("Deze stap heeft geen ligging (2D) om te tekenen"); return; }
    const model = mapModel(R), L = UI.mapLayers;
    const map = { punten: ["VER_PUNT_VAST", "VER_PUNT_VRIJ"], nummers: ["VER_TEKST"], waarnemingen: ["VER_WAARNEMING"], gnss: ["VER_GNSS"], verworpen: ["VER_VERWORPEN"], ellipsen: ["VER_ELLIPS"] };
    const layers = UI.dxfVisible ? Object.entries(map).filter(([k]) => L[k]).flatMap(([, v]) => v) : null;
    const ext = Math.max(model.bbox[2] - model.bbox[0], model.bbox[3] - model.bbox[1], 10);
    const txt = V.toDXF(R, { ellipseScale: UI.ellScale === "auto" ? autoEll(model) : +UI.ellScale, textHeight: Math.max(0.2, Math.min(2, ext / 400)), marker: Math.max(0.15, Math.min(1.5, ext / 600)), useHeights: UI.dxf3d, layers });
    download(`netwerk_${safeName(S.name)}_${safeName(curStage().name)}.dxf`, txt, "application/dxf");
  }

  // ------------------------------------------------------------- Export
  function expOpts() {
    if (!S.exportOpts) S.exportOpts = { codes: null, excludeGnssOnly: true, excludeKnown: false, markUncontrolled: true, withSd: true, scope: "stap", excludeOps: true };
    return S.exportOpts;
  }
  function exportData() {
    const o = expOpts();
    const results = o.scope === "alle" ? allResults() : [curRes()].filter((r) => r && !r.error);
    const all = V.exportRows(results, { excludeGnssOnly: false, markUncontrolled: o.markUncontrolled });
    const present = {};
    for (const r of all) present[r.code || ""] = (present[r.code || ""] || 0) + 1;
    let inc = o.codes;
    if (!inc) inc = Object.keys(present).filter((c) => ROLE[c] === "grondslag" || ROLE[c] === "hoogte" || (!ROLE[c] && c !== "906" && c !== ""));
    if (!inc.length) inc = Object.keys(present).filter((c) => c !== "906");
    const rows = V.exportRows(results, { includeCodes: inc, excludeGnssOnly: o.excludeGnssOnly, excludeKnown: o.excludeKnown, markUncontrolled: o.markUncontrolled });
    return { rows, present, inc, results };
  }
  function viewExport() {
    const R = curRes();
    if (!R || R.error) return `<h1>Export</h1><div class="msg warn">Nog geen resultaat om te exporteren.</div>`;
    const o = expOpts();
    const { rows, present, inc, results } = exportData();
    const chips = Object.entries(present).sort((a, b) => natural(a[0], b[0])).map(([c, n]) => `<label class="${inc.includes(c) ? "on" : ""}"><input type="checkbox" data-expcode="${esc(c)}" ${inc.includes(c) ? "checked" : ""}> ${c ? esc(c) + " " + esc(codeDesc(c)) : "zonder code"} (${n})</label>`).join("");
    const status = results.map((r) => `${esc(r.name)}: ${esc(stageStatus(r).text)}`).join(" · ");
    const nexcl = results.reduce((s, r) => s + r.checks.precheck.filter((g) => !g.kept).length + r.checks.snooping.length, 0) + (o.scope === "alle" ? S.stages.reduce((s, st) => s + st.exclude_refs.length, 0) : curStage().exclude_refs.length);
    const unc = rows.filter((r) => r.controle === "nee").map((r) => r.punt);
    return `<div class="row"><h1 class="grow">Export</h1></div>
      <section class="card"><h2>Puntcodes</h2><div class="codechips" style="margin-top:8px">${chips}</div></section>
      <section class="card"><h2>Verder filteren</h2><div class="row" style="gap:18px;margin-top:6px">
        <label class="check"><input type="checkbox" data-exp="excludeGnssOnly" ${o.excludeGnssOnly ? "checked" : ""}> Alleen-GNSS-punten weglaten</label>
        <label class="check"><input type="checkbox" data-exp="excludeKnown" ${o.excludeKnown ? "checked" : ""}> Aansluitpunten (vast/gewogen) weglaten</label>
        <label class="check"><input type="checkbox" data-exp="markUncontrolled" ${o.markUncontrolled ? "checked" : ""}> Ongecontroleerde punten markeren</label>
        <label class="check"><input type="checkbox" data-exp="withSd" ${o.withSd ? "checked" : ""}> Standaardafwijkingen meenemen</label></div>
        <div class="row" style="margin-top:8px"><span>Resultaat van</span><div class="seg"><button class="${o.scope !== "alle" ? "on" : ""}" data-act="expscope" data-v="stap">Stap ${UI.stage + 1} · ${esc(curStage().name)}</button><button class="${o.scope === "alle" ? "on" : ""}" data-act="expscope" data-v="alle">Alle stappen samen</button></div></div>
        <p class="help">Bij “alle stappen samen” krijgt elk punt de laatst berekende waarde: bijvoorbeeld x, y uit de GNSS-stap en H uit de waterpassing.</p></section>
      <section class="card tight"><div class="row" style="padding:12px 16px"><h2 class="grow">Voorbeeld</h2><span class="small muted">${rows.length} punten · RD / NAP · ; en decimale komma</span></div>
        <div class="tablewrap" style="max-height:420px;overflow:auto"><table><thead><tr><th>Punt</th><th>Code</th><th class="num">x</th><th class="num">y</th><th class="num">H</th>${o.withSd ? '<th class="num">σx / σy / σH (mm)</th>' : ""}<th>Controle</th></tr></thead><tbody>
        ${rows.slice(0, 300).map((r) => `<tr><td class="mono">${esc(r.punt)}</td><td>${esc(r.code)}</td><td class="num">${nl(r.x, 4)}</td><td class="num">${nl(r.y, 4)}</td><td class="num">${nl(r.H, 4)}</td>${o.withSd ? `<td class="num">${mm(r.sx)} / ${mm(r.sy)} / ${mm(r.sH)}</td>` : ""}<td style="${r.controle === "nee" ? "color:var(--warn);font-weight:600" : ""}">${esc(r.controle)}</td></tr>`).join("")}</tbody></table></div></section>
      <div class="msg info small">${status}.${nexcl ? ` Uitgeschakeld: ${nexcl} meting(en).` : ""}${unc.length ? ` ${unc.join(", ")} ${unc.length > 1 ? "staan" : "staat"} in de lijst met controle = nee.` : ""} Alles staat in het rapport.</div>
      <div class="row"><button class="btn pri" data-act="exp-csv">Coördinaten (.csv)</button><button class="btn" data-act="exp-xlsx">Excel met rapport (.xlsx)</button><button class="btn" data-act="exp-report">Rapport (afdrukken / PDF)</button><button class="btn" data-act="exp-txt">Rapport (.txt)</button><button class="btn" data-act="dxf">Netwerk (.dxf)</button></div>`;
  }
  function doExport(kind) {
    const o = expOpts();
    const { rows, results } = exportData();
    const base = `${safeName(S.name)}_${o.scope === "alle" ? "alle_stappen" : safeName(curStage().name)}`;
    if (kind === "csv") return download(`${base}.csv`, V.toCSV(rows, o.withSd), "text/csv;charset=utf-8");
    const rep = V.fullReport(PROJ, o.scope === "alle" ? allResults() : results, { name: S.name, version: VERSION });
    if (kind === "txt") return download(`${base}_rapport.txt`, rep);
    if (kind === "xlsx") {
      const cols = V.COLS.filter((c) => o.withSd || !c.endsWith("_mm"));
      const coordRows = [cols, ...rows.map((r) => V.rowValues(r, o.withSd).map(([, v]) => v))];
      const z = V.toXLSX([{ name: "Coördinaten", rows: coordRows, widths: cols.map((c) => (c === "x" || c === "y" ? 14 : 10)) }, { name: "Waarnemingen", rows: V.obsSheetRows(o.scope === "alle" ? allResults() : results) }, { name: "Rapport", rows: rep.split("\n").map((l) => [l]), widths: [160] }]);
      return download(`${base}.xlsx`, new Blob([z], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    }
    if (kind === "report") {
      const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Vereffeningsrapport ${esc(S.name)}</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#15202B}pre{font-family:Consolas,monospace;font-size:10.5px;white-space:pre-wrap}table{border-collapse:collapse;font-size:11px}td,th{border:1px solid #ccc;padding:3px 6px;text-align:right}td:first-child,th:first-child{text-align:left}@media print{button{display:none}}</style></head><body><button onclick="print()" style="padding:10px 16px;font-size:15px">Afdrukken / opslaan als PDF</button><h1>Vereffeningsrapport · ${esc(S.name)}</h1><h2>Coördinaten</h2><table><tr>${V.COLS.map((c) => `<th>${c}</th>`).join("")}</tr>${rows.map((r) => `<tr>${V.rowValues(r, true).map(([c, v]) => `<td>${typeof v === "number" ? nl(v, c.endsWith("_mm") ? 1 : 4) : esc(v)}</td>`).join("")}</tr>`).join("")}</table><h2>Berekening</h2><pre>${esc(rep)}</pre></body></html>`;
      const w = window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
      if (!w) download(`${base}_rapport.html`, html, "text/html");
    }
  }

  // ------------------------------------------------------------- Controles
  function viewControles() {
    if (!S.stages.length) return `<h1>Controles bij het inlezen</h1><div class="msg info">Nog geen stappen.</div>`;
    const secs = S.stages.map((st, i) => {
      const R = RES[i];
      if (!R) return "";
      if (R.error) return `<section class="card"><span class="badge">STAP ${i + 1}</span> <h2 style="display:inline">${esc(st.name)}</h2><div class="msg bad" style="margin-top:8px">${esc(R.error)}</div></section>`;
      const c = R.checks, parts = [];
      for (const L of c.leveling) {
        const bad = L.sections.filter((s) => !s.ok);
        parts.push(`<h3>Waterpassing ${esc(L.tag)} · heen en terug per sectie</h3>
          <div class="small muted">${L.lines.length} traject(en) · ${nl(L.length_m / 1000, 2)} km${M.isNum(L.misclosure_mm) ? ` · sluitfout ${sg(L.misclosure_mm, 2)} mm (tolerantie ${nl(L.tol_mm, 1)} mm)` : ""}${L.repeat_n ? ` · dubbele aflezingen (BFFB): max. verschil ${nl(L.repeat_max_mm, 2)} mm over ${L.repeat_n} paren` : ""}</div>
          ${L.diagnoses.map((d) => `<div class="msg warn small" style="margin-top:6px"><b>Diagnose</b> ${esc(d.tekst)}</div>`).join("")}
          ${L.sections.length ? `<div class="tablewrap"><table style="margin-top:8px"><thead><tr><th>Sectie</th><th class="num">Lengte</th><th class="num">Heen + terug</th><th class="num">Tolerantie</th><th>Oordeel</th></tr></thead><tbody>${L.sections.map((s) => `<tr><td class="mono">${esc(s.van)} – ${esc(s.naar)}</td><td class="num">${nl(s.lengte_m, 0)} m</td><td class="num">${sg(s.verschil_mm, 2)} mm</td><td class="num">${nl(s.tol_mm, 2)}</td><td style="color:${s.ok ? "var(--ok)" : "var(--bad)"};font-weight:600">${s.ok ? "ok" : "te groot"}</td></tr>`).join("")}</tbody></table></div><div class="small muted">${bad.length} van ${L.sections.length} secties buiten tolerantie.</div>` : '<div class="small muted">Geen heen- en terugmeting gevonden om per sectie te vergelijken.</div>'}`);
      }
      if (c.gnssOcc.length) {
        parts.push(`<h3>GNSS · bezettingen vergelijken</h3><div class="small muted">Tolerantie ${nl(S.settings.gnss_tol_xy_mm, 0)} mm ligging / ${nl(S.settings.gnss_tol_h_mm, 0)} mm hoogte. Zet een bezetting uit als hij duidelijk afwijkt.</div>
          <div class="tablewrap"><table style="margin-top:8px"><thead><tr><th>Punt</th><th>Bezettingen</th><th class="num">Δ ligging</th><th class="num">Δ hoogte</th><th>Oordeel</th></tr></thead><tbody>${c.gnssOcc.map((g) => `<tr><td class="mono">${esc(g.punt)}</td><td>${g.bezettingen.map((b, k) => `<div class="row small" style="gap:6px">bez. ${k + 1}${b.epochs ? ` · ${b.epochs} ep.` : ""}${b.dH_ref_mm !== null ? ` · H − vorige stap ${sg(b.dH_ref_mm, 0)} mm` : ""} <button class="btn sm" data-act="excl-st" data-i="${i}" data-ref="${esc(b.ref)}">${st.exclude_refs.includes(b.ref) ? "Aanzetten" : "Uitzetten"}</button></div>`).join("")}</td><td class="num">${nl(g.dxy_mm, 0)} mm</td><td class="num">${nl(g.dh_mm, 0)} mm</td><td style="color:${g.ok ? "var(--ok)" : "var(--bad)"};font-weight:600">${g.ok ? "ok" : "buiten tolerantie"}</td></tr>`).join("")}</tbody></table></div>
          <p class="help">Met één bezetting per punt is een GNSS-fout pas vanaf ca. 5 cm aantoonbaar. Twee bezettingen op een ander tijdstip worden aangeraden.</p>`);
      }
      if (c.gnssHctrl) parts.push(`<h3>GNSS-hoogte ter controle</h3><div class="small">Mediaan GNSS min vereffend: <b>${sg(c.gnssHctrl.median_mm)} mm</b>, spreiding ${nl(c.gnssHctrl.spread_mm)} mm over ${c.gnssHctrl.n} metingen.</div>${c.gnssHctrl.items.filter((x) => Math.abs(x.mm - c.gnssHctrl.median_mm) > c.gnssHctrl.tol_mm).map((x) => `<div class="warnline">⚠ ${esc(x.punt)}: ${sg(x.mm, 0)} mm</div>`).join("")}`);
      const tps = [];
      if (c.precheck.length) tps.push(...c.precheck.map((g) => `<div class="msg warn small row"><span class="grow"><b>${esc(g.station)} → ${esc(g.doel)}</b> wijkt ${nl(g.afwijking_m, 2)} m af van de benadering${g.kept ? " (toch gebruikt)" : " en is uitgeschakeld"}.${g.past_op ? ` De meting past op <b>${esc(g.past_op)}</b> (${nl(g.past_afstand_m * 1000, 0)} mm): verkeerd puntnummer?` : ""}</span>${g.past_op && !g.kept ? `<button class="btn sm" data-act="rename" data-i="${i}" data-ref="${esc(g.ref)}" data-from="${esc(g.doel)}" data-to="${esc(g.past_op)}">Hernoemen naar ${esc(g.past_op)}</button>` : ""}<button class="btn sm" data-act="precheck-keep" data-i="${i}" data-ref="${esc(g.ref)}">${g.kept ? "Uit laten" : "Toch gebruiken"}</button></div>`));
      if (c.faceChecks.length) { const fc = c.faceChecks; tps.push(`<div class="small">Kijkerstanden: ${fc.length} doelen in 2 standen · max. collimatie c ${nl(Math.max(...fc.map((f) => Math.abs(f.c_mgon))))} mgon · index i ${nl(Math.max(...fc.map((f) => Math.abs(f.i_mgon))))} mgon · afstandsverschil ${nl(Math.max(...fc.map((f) => f.dS_mm)))} mm</div>`); }
      if (R.repeat.length) tps.push(`<div class="small"><b>Herhaalde metingen binnen een opstelling</b> (verloop wijst op een verdraaiend statief):</div><div class="tablewrap"><table><thead><tr><th>Opstelling</th><th>Doel</th><th class="num">Tijd</th><th class="num">ΔHz</th><th class="num">ΔS</th><th class="num">ΔH</th></tr></thead><tbody>${R.repeat.map((r) => `<tr><td class="mono small">${esc(r.setup)}</td><td class="mono">${esc(r.target)}</td><td class="num">${nl(r.minutes, 1)} min</td><td class="num" style="${Math.abs(r.d_hz_mgon) > 2 ? "color:var(--bad)" : ""}">${sg(r.d_hz_mgon)} mgon</td><td class="num">${sg(r.d_s_mm)} mm</td><td class="num">${sg(r.d_h_mm)} mm</td></tr>`).join("")}</tbody></table></div>`);
      const nR = R.net ? R.net.obs.filter((o) => o.kind === "R").length : 0;
      if (nR) {
        const refl = c.sources.flatMap((s) => s.reflectors || []);
        const prismWarn = c.warnings.filter((w) => w.startsWith("Prismaconstante"));
        tps.push(`<div class="grid2"><div><div class="small muted">Metingen</div><div class="mono" style="font-size:20px">${nR}${st.exclude_refs.length ? ` · ${st.exclude_refs.length} uit` : ""}</div></div>
          <div><div class="small muted">Ongecontroleerd</div><div class="mono" style="font-size:20px">${c.uncontrolled.length} punt${c.uncontrolled.length === 1 ? "" : "en"}</div><div class="small muted">${esc(c.uncontrolled.join(", "))}</div></div>
          <div><div class="small muted">Prismaconstantes</div><div class="mono" style="font-size:20px;color:${prismWarn.length ? "var(--bad)" : "var(--ok)"}">${prismWarn.length ? prismWarn.length + " afwijkend" : "ok"}</div><div class="small muted">${esc([...new Set(refl)].join(", "))}</div></div>
          <div><div class="small muted">Captivate “nee”</div><div class="mono" style="font-size:20px">${c.captivateNo.length}</div><div class="small muted">${st.follow_captivate ? "gevolgd (uitgeschakeld)" : "niet gevolgd: ruwe metingen worden gebruikt"}</div></div></div>`);
        for (const w of prismWarn) tps.push(`<div class="warnline">⚠ ${esc(w)}</div>`);
      }
      if (tps.length) parts.push(`<h3>Total station · voorcontrole en kijkerstanden</h3><div class="small muted">Drempel grove fout ${nl(S.settings.precheck_tol_m, 2)} m + ${nl(S.settings.precheck_tol_mm_per_m, 0)} mm/m</div>${tps.join("")}`);
      if (c.snooping.length) parts.push(`<h3>Data snooping</h3>${c.snooping.map((s) => `<div class="small">• ${esc(s.tekst)}</div>`).join("")}`);
      const other = c.warnings.filter((w) => !w.startsWith("Prismaconstante"));
      if (other.length) parts.push(`<h3>Overige meldingen</h3>${other.map((w) => `<div class="warnline">⚠ ${esc(w)}</div>`).join("")}`);
      parts.push(`<details><summary class="small">Rekenlog van deze stap</summary><pre class="log">${esc(R.log.join("\n"))}</pre></details>`);
      return `<section class="card" style="display:flex;flex-direction:column;gap:10px"><div class="row"><span class="badge">STAP ${i + 1}</span><h2 class="grow">${esc(st.name)}</h2><button class="btn sm" data-act="openstage" data-i="${i}">Openen</button></div>${parts.join("")}</section>`;
    }).join("");
    return `<div><h1>Controles bij het inlezen</h1><div class="muted">Wat de app vóór en tijdens de vereffening opmerkt. Elke melding kun je accepteren, aanpassen of terugdraaien.</div></div>${secs}`;
  }

  // ------------------------------------------------------------- Instellingen
  const SET_GROUPS = [
    ["Total station · a-priori precisie", [
      ["Richting (mgon)", "dir_2face_mgon", "dir_1face_mgon", "2 kijkerst.", "1 kijkerst."],
      ["Zenithoek (mgon)", "zen_2face_mgon", "zen_1face_mgon", "2 kijkerst.", "1 kijkerst."],
      ["Afstand prisma: a (mm) / b (ppm)", "dist_prism_mm", "dist_prism_ppm"],
      ["Afstand reflectorloos: a (mm) / b (ppm)", "dist_rl_mm", "dist_rl_ppm"],
      ["Centrering doel (mm): stok / sticker", "centr_pole_mm", "centr_rl_mm"],
      ["Doelhoogte (mm): stok / sticker", "th_pole_mm", "th_rl_mm"],
      ["Centrering instrument / instrumenthoogte (mm)", "centr_station_mm", "ih_mm"],
      ["Refractiecoëfficiënt k / onzekerheid", "refraction_k", "refraction_sk"]]],
    ["Waterpassing", [
      ["σ per aflezing: A (mm) / B (mm/√km)", "lev_a_mm", "lev_b_mm_sqrtkm"],
      ["C (mm/km) / wisselpunten: automatische nummers t/m (tekens)", "lev_c_mm_km", "lev_tp_maxlen"],
      ["Tolerantie heen/terug (mm·√km) / minimaal (mm)", "lev_tol_mm_sqrtkm", "lev_tol_min_mm"]]],
    ["GNSS", [
      ["Ondergrens σ ligging / σ hoogte (mm)", "gnss_min_xy_mm", "gnss_min_h_mm"],
      ["Centrering stok (mm) / controle GNSS-hoogte t.o.v. mediaan (mm)", "gnss_centr_mm", "gnss_h_ctrl_tol_mm"],
      ["Tolerantie bezettingen ligging / hoogte (mm)", "gnss_tol_xy_mm", "gnss_tol_h_mm"]]],
    ["Toetsing en voorcontrole", [
      ["α₀ / β₀ (B-methode)", "alpha0", "beta0"],
      ["Voorcontrole drempel: m + mm/m", "precheck_tol_m", "precheck_tol_mm_per_m"],
      ["Handmatig gewogen punt: σ ligging / σ hoogte (mm)", "default_sxy_mm", "default_sh_mm"]]],
  ];
  function viewInstellingen() {
    const t = UI.settingsTarget;
    const stIdx = t === "project" ? -1 : +t;
    const base = S.settings, ov = stIdx >= 0 && S.stages[stIdx] ? S.stages[stIdx].settings || {} : {};
    const val = (k) => (k in ov ? ov[k] : base[k] ?? (k === "default_sxy_mm" ? 10 : k === "default_sh_mm" ? 2 : ""));
    const inp = (k, lab) => `<input class="${k in ov ? "changed" : ""}" inputmode="decimal" aria-label="${esc(lab)}" data-set="${k}" value="${esc(String(val(k)).replace(".", ","))}">`;
    const groups = SET_GROUPS.map(([title, rows]) => `<section class="card"><h2>${title}</h2><div class="setgrid" style="margin-top:10px">${rows.map(([l, a, b, ha, hb]) => `${ha ? `<div></div><div class="hd">${ha}</div><div class="hd">${hb}</div>` : ""}<div>${l}</div><div>${inp(a, l)}</div><div>${b ? inp(b, l) : ""}</div>`).join("")}</div></section>`).join("");
    return `<div class="row"><div class="grow"><h1>Instellingen</h1><div class="muted">Standaard voor het hele project. Per stap kun je afwijken; dat staat dan in het rapport.</div></div>
      <label class="field">Toepassen op<select data-act="settarget"><option value="project" ${t === "project" ? "selected" : ""}>Heel project</option>${S.stages.map((s, i) => `<option value="${i}" ${t === String(i) ? "selected" : ""}>Stap ${i + 1} · ${esc(s.name)}</option>`).join("")}</select></label>
      ${stIdx >= 0 && Object.keys(ov).length ? `<button class="btn" data-act="set-reset-stage">Afwijkingen van deze stap wissen</button>` : ""}<button class="btn" data-act="set-defaults">Standaardwaarden herstellen</button></div>
      ${stIdx >= 0 ? `<div class="msg info small">Je past nu de instellingen van <b>stap ${stIdx + 1} ${esc(S.stages[stIdx].name)}</b> aan. Blauw gemarkeerde velden wijken af van het project.</div>` : ""}
      ${groups}
      <section class="card"><h2>Reducties en transformatie</h2><div style="margin-top:8px">
        <label class="check"><input type="checkbox" data-setb="reduce_to_rd" ${val("reduce_to_rd") ? "checked" : ""}> Afstanden reduceren naar RD (puntschaal + hoogtereductie, in Nederland ca. −80 tot −100 ppm)</label>
        <div class="small muted">Transformatie GNSS: RDNAPTRANS™2018 variant 1 met de NSGI-grids (ingebouwd, gevalideerd met de NSGI-testset). Correctiegrid en quasi-geoïde (rdcorr2018, nlgeo2018): © NSGI, licentie CC BY 4.0.</div></div></section>
      <section class="card"><h2>Codelijst</h2><div class="row" style="margin-top:8px"><span class="grow">${S.codes && S.codes.name ? `${esc(S.codes.name)} · ${Object.keys(S.codes.codes).length} codes` : "Geen codelijst"} · rollen: 900/515 NAP → voorstel 1D vast · 906 opstelplaats → niet exporteren · 907/909/910/911 → exporteren</span><button class="btn" data-act="load-codelist">Andere codelijst laden (.xml)</button></div></section>
      <section class="card small muted">Versie ${VERSION} · laatste berekening ${nl(UI.lastMs || 0, 0)} ms · alle berekeningen gebeuren in deze browser, zonder internet.</section>`;
  }

  // ------------------------------------------------------------- voorbeeldproject
  function demo() {
    const D = V.DEMO;
    if (!D) { toast("Geen voorbeeldbestanden in deze versie"); return; }
    S = defaultProject();
    S.name = "Dijkweg (simulatie)";
    const st1 = V.newStage("Waterpassing"), st2 = V.newStage("GNSS spijkers"), st3 = V.newStage("Total station");
    st1.sources = [{ id: uid(), name: "NAP_peilmerken.csv", kind: "coords", tag: "NAP", text: D.nap, options: {} }, { id: uid(), name: "waterpassing_DNA.GSI", kind: "gsi", tag: "WP", text: D.wp, options: {} }];
    st1.known = [{ points: "NAPSIM1, NAPSIM2", dim: "1D", mode: "vast_getoetst", origin: "lijst", sh_mm: 1 }];
    st1.snooping = 5;
    st2.sources = [{ id: uid(), name: "gnss_statisch.xml", kind: "hexml", tag: "GNSS", text: D.gnss, options: {} }];
    st2.dims = "2D"; st2.snooping = 3;
    st3.sources = [{ id: uid(), name: "total_station.xml", kind: "hexml", tag: "TPS", text: D.tps, options: {} }];
    st3.known = [{ points: "80*", dim: "2D", mode: "gewogen", origin: "GNSS spijkers" }, { points: "80*", dim: "1D", mode: "vast", origin: "Waterpassing" }];
    st3.snooping = 5;
    S.stages = [st1, st2, st3];
    UI.view = "stappen"; UI.stage = 0;
    changed();
    toast("Voorbeeldproject geladen: gesimuleerde metingen met expres geplante fouten");
  }

  // ------------------------------------------------------------- events
  function afterRender() {
    const m = document.getElementById("map");
    if (m && curRes()) attachMap(m, curRes());
    document.querySelectorAll("[data-drop]").forEach((el) => {
      el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
      el.ondragleave = () => el.classList.remove("over");
      el.ondrop = (e) => { e.preventDefault(); el.classList.remove("over"); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, el.dataset.drop === "stage" ? UI.stage : undefined); };
    });
  }
  const num = (v) => { const x = Number(String(v).replace(",", ".").trim()); return Number.isFinite(x) ? x : null; };
  function onClick(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    const a = b.dataset.act, d = b.dataset;
    const st = curStage();
    switch (a) {
      case "view": UI.view = d.v; if (d.v === "stappen" && UI.stage >= S.stages.length) UI.stage = 0; render(); window.scrollTo(0, 0); break;
      case "tab": UI.view = "stap"; UI.tab = d.v; render(); window.scrollTo(0, 0); break;
      case "selstage": if (ev.target.closest("button")) return; UI.stage = +d.i; render(); break;
      case "openstage": UI.stage = +d.i; UI.view = "stap"; UI.tab = RES[+d.i] && !RES[+d.i].error ? "vereffening" : "bestanden"; render(); window.scrollTo(0, 0); break;
      case "add-stage": { const nm = prompt("Naam van de nieuwe stap", `Stap ${S.stages.length + 1}`); if (nm === null) return; S.stages.push(V.newStage(nm || `Stap ${S.stages.length + 1}`)); UI.stage = S.stages.length - 1; UI.view = "stap"; UI.tab = "bestanden"; changed(); break; }
      case "rename-stage": { const s = S.stages[+d.i], old = s.name, nm = prompt("Nieuwe naam", old); if (!nm || nm === old) return; for (const t of S.stages) for (const r of t.known) if (r.origin === old) r.origin = nm; s.name = nm; changed(); break; }
      case "move-stage": { const i = +d.i, j = i + +d.d; [S.stages[i], S.stages[j]] = [S.stages[j], S.stages[i]]; UI.stage = j; changed(); break; }
      case "del-stage": if (confirm(`Stap "${S.stages[+d.i].name}" verwijderen met alle bestanden en regels?`)) { S.stages.splice(+d.i, 1); UI.stage = Math.max(0, Math.min(UI.stage, S.stages.length - 1)); changed(); } break;
      case "recalc": changed(); toast("Opnieuw gerekend"); break;
      case "pick-files": pickFiles(".xml,.gsi,.GSI,.csv,.txt,.tco,.obs,.prj", true, (f) => addFiles(f, UI.view === "stap" ? UI.stage : undefined)); break;
      case "demo": demo(); break;
      case "src-toggle": st.sources[+d.i].disabled = !st.sources[+d.i].disabled; changed(); break;
      case "src-del": if (confirm(`${st.sources[+d.i].name} uit deze stap verwijderen?`)) { st.sources.splice(+d.i, 1); changed(); } break;
      case "rule-add": st.known.push({ points: "*", dim: "3D", mode: UI.stage ? "gewogen" : "vast", origin: UI.stage ? "vorige" : "lijst", sxy_mm: null, sh_mm: null }); changed(); break;
      case "rule-del": st.known.splice(+d.i, 1); changed(); break;
      case "rule-toggle": st.known[+d.i].disabled = !st.known[+d.i].disabled; changed(); break;
      case "rule-set": st.known[+d.i][d.k] = d.v; changed(); break;
      case "nap-rule": { const R = curRes(), info = pointInfo(R); const names = Object.values(info).filter((p) => ROLE[p.code] === "nap").map((p) => p.name); st.known.push({ points: names.join(", "), dim: "1D", mode: "vast_getoetst", origin: "lijst", sh_mm: 1 }); changed(); toast("Regel toegevoegd: NAP-punten 1D vast, wel getoetst"); break; }
      case "ovr": { st.overrides = st.overrides || {}; const o = (st.overrides[d.n] = st.overrides[d.n] || {}); o[d.k] = d.v; changed(); break; }
      case "ovr-reset": delete st.overrides[d.n]; changed(); break;
      case "pfilter": UI.pfilter = d.v; render(); break;
      case "dim": UI.dim = d.v; render(); break;
      case "phase": UI.phase = d.v; render(); break;
      case "allobs": UI.showAllObs = !UI.showAllObs; render(); break;
      case "excl": { const i = st.exclude_refs.indexOf(d.ref); if (i >= 0) st.exclude_refs.splice(i, 1); else st.exclude_refs.push(d.ref); changed(); toast(i >= 0 ? `${d.ref} weer aan` : `${d.ref} uitgeschakeld`); break; }
      case "excl-st": { const s = S.stages[+d.i], i = s.exclude_refs.indexOf(d.ref); if (i >= 0) s.exclude_refs.splice(i, 1); else s.exclude_refs.push(d.ref); changed(); break; }
      case "precheck-keep": { const s = d.i !== undefined ? S.stages[+d.i] : st; s.precheck_keep = s.precheck_keep || []; const i = s.precheck_keep.indexOf(d.ref); if (i >= 0) s.precheck_keep.splice(i, 1); else s.precheck_keep.push(d.ref); changed(); break; }
      case "rename": { const s = d.i !== undefined ? S.stages[+d.i] : st; s.renames = s.renames || []; s.renames.push({ ref: d.ref, from: d.from, to: d.to }); changed(); toast(`${d.ref}: ${d.from} → ${d.to}`); break; }
      case "unrename": st.renames.splice(+d.k, 1); changed(); break;
      case "snoop-keep": { st.snoop_keep = st.snoop_keep || []; const i = st.snoop_keep.indexOf(d.ref); if (i >= 0) st.snoop_keep.splice(i, 1); else st.snoop_keep.push(d.ref); changed(); break; }
      case "snoop-on": if (!st.snooping) { st.snooping = 5; changed(); } break;
      case "back-from-map": UI.view = "stap"; UI.tab = "vereffening"; render(); break;
      case "map-window": mapWindow(); break;
      case "dxf": doDXF(); break;
      case "expscope": expOpts().scope = d.v; changed({ norecalc: true }); break;
      case "exp-csv": doExport("csv"); break;
      case "exp-xlsx": doExport("xlsx"); break;
      case "exp-report": doExport("report"); break;
      case "exp-txt": doExport("txt"); break;
      case "stage-settings": UI.view = "instellingen"; UI.settingsTarget = String(UI.stage); render(); break;
      case "set-defaults": if (confirm("Alle projectinstellingen terugzetten naar de standaardwaarden?")) { S.settings = V.defaultSettings(); changed(); } break;
      case "set-reset-stage": S.stages[+UI.settingsTarget].settings = null; changed(); break;
      case "load-codelist": pickFiles(".xml", false, async (f) => { if (f[0]) loadCodelist(decode(await f[0].arrayBuffer()), f[0].name); }); break;
      case "rename-project": { const nm = prompt("Projectnaam", S.name); if (nm) { S.name = nm; changed({ norecalc: true }); } break; }
      case "save-file": download(`${safeName(S.name)}.vereffening.json`, JSON.stringify(S), "application/json"); break;
      case "open-file": pickFiles(".json", false, async (f) => { try { S = migrate(JSON.parse(decode(await f[0].arrayBuffer()))); UI.stage = 0; UI.view = "stappen"; changed(); toast("Project geopend"); } catch (e) { toast("Dit is geen geldig projectbestand"); } }); break;
      case "new-project": if (confirm("Nieuw project beginnen? Het huidige project wordt uit de browser verwijderd (sla het eerst op als je het wilt bewaren).")) { S = defaultProject(); UI.stage = 0; UI.view = "stappen"; changed(); } break;
    }
  }
  function onChange(ev) {
    const t = ev.target, d = t.dataset, st = curStage();
    if (d.act === "pickstage") { UI.stage = +t.value; render(); return; }
    if (d.act === "pfilter-code") { UI.pfilter = t.value ? "code:" + t.value : "alle"; render(); return; }
    if (d.act === "settarget") { UI.settingsTarget = t.value; render(); return; }
    if (d.act === "ellscale") { UI.ellScale = t.value; render(); return; }
    if (d.act === "dxfvis") { UI.dxfVisible = t.checked; return; }
    if (d.act === "dxf3d") { UI.dxf3d = t.checked; return; }
    if (d.layer) { UI.mapLayers[d.layer] = t.checked; render(); return; }
    if (d.rule !== undefined) {
      const r = st.known[+d.rule];
      if (d.k === "points") { const v = t.value.trim(); r.points = v.includes(",") && !/[*?]/.test(v) ? v.split(",").map((x) => x.trim()).filter(Boolean) : v || "*"; }
      else if (d.k === "code") r.codes = t.value ? [t.value] : null;
      else if (d.k === "sxy_mm" || d.k === "sh_mm") r[d.k] = t.value.trim() === "" ? null : num(t.value);
      else r[d.k] = t.value;
      changed(); return;
    }
    if (d.src !== undefined) {
      const s = st.sources[+d.src];
      if (d.k === "tag") { const v = t.value.trim().replace(/[:\s]/g, "") || s.tag; s.tag = v; }
      else if (d.k === "prism") s.options.prism = t.value === "1";
      else if (d.k === "start_known") s.options.start_known = t.checked;
      else if (d.k === "soort") s.options.soort = t.value || undefined;
      else if (d.k === "phase") s.options.phase = t.value;
      changed(); return;
    }
    if (d.stageK) {
      const k = d.stageK;
      st[k] = t.type === "checkbox" ? t.checked : k === "snooping" ? Math.max(0, Math.round(num(t.value) || 0)) : t.value;
      changed(); return;
    }
    if (d.set) {
      const v = num(t.value);
      if (v === null) { toast("Ongeldig getal"); render(); return; }
      if (UI.settingsTarget === "project") S.settings[d.set] = v;
      else { const s = S.stages[+UI.settingsTarget]; s.settings = s.settings || {}; if (v === S.settings[d.set]) delete s.settings[d.set]; else s.settings[d.set] = v; if (!Object.keys(s.settings).length) s.settings = null; }
      changed(); return;
    }
    if (d.setb) {
      if (UI.settingsTarget === "project") S.settings[d.setb] = t.checked;
      else { const s = S.stages[+UI.settingsTarget]; s.settings = s.settings || {}; s.settings[d.setb] = t.checked; }
      changed(); return;
    }
    if (d.exp) { expOpts()[d.exp] = t.checked; changed({ norecalc: true }); return; }
    if (d.expcode !== undefined) {
      const o = expOpts(), { inc } = exportData();
      const set = new Set(inc);
      if (t.checked) set.add(d.expcode); else set.delete(d.expcode);
      o.codes = [...set];
      changed({ norecalc: true }); return;
    }
  }
  function onInput(ev) {
    const t = ev.target;
    if (t.dataset.act === "psearch") {
      UI.psearch = t.value;
      clearTimeout(onInput.tm);
      onInput.tm = setTimeout(() => { render(); const i = document.querySelector('[data-act="psearch"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
    }
  }

  V.startApp = function () {
    S = load();
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
    window.addEventListener("resize", () => { const m = document.getElementById("map"); if (m && curRes()) { m._view = null; attachMap(m, curRes()); } });
    document.body.addEventListener("dragover", (e) => e.preventDefault());
    document.body.addEventListener("drop", (e) => { if (!e.target.closest("[data-drop]")) { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, UI.view === "stap" ? UI.stage : undefined); } });
    render();
    setTimeout(() => { compute(); render(); }, 10);
  };
  V.APP = { get state() { return S; }, get results() { return RES; }, UI, render, compute };
})(globalThis.V = globalThis.V || {});
