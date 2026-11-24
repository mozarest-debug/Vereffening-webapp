// Browsertest versie 1.2: herberekenen met knop, correcties, opslaan als, exportmenu, stijlen.
const { chromium } = require("playwright");
const URL = "file://" + require("path").resolve(__dirname, "../dist/Vereffening.html");
const SHOTS = process.env.SHOTS || require("path").resolve(__dirname, "../shots");
let fail = 0;
const ok = (c, t) => { console.log((c ? "OK  " : "FOUT") + " " + t); if (!c) fail++; };
(async () => {
  require("fs").mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? (d.message().includes("voorinstelling") ? "Uitzetlijst" : "999") : undefined));
  await p.goto(URL); await p.waitForTimeout(400);
  ok((await p.evaluate(() => document.documentElement.dataset.theme)) === "modern", "standaard stijl is Modern");

  // voorbeeldproject: rekent één keer bij het openen
  await p.click('[data-act="demo"]'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => V.APP.results.length === 3 && V.APP.results.every((r) => !r.error)), "voorbeeldproject berekend bij openen");
  await p.screenshot({ path: `${SHOTS}/v12_01_stappen_modern.png` });

  // wijziging → niet rekenen, wel banner
  await p.click('[data-act="openstage"][data-i="2"]'); await p.waitForTimeout(500);
  const r0 = await p.evaluate(() => { window.__r = V.APP.results[2]; return V.APP.results[2].r2.F; });
  await p.click('.nav [data-v="punten"]'); await p.waitForTimeout(300);
  await p.click('button[data-act="ovr"][data-k="xy"][data-v="gewogen"] >> nth=3'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.__r === V.APP.results[2]), "na wijziging niet opnieuw gerekend");
  ok(await p.isVisible(".stalebar"), "balk 'nog niet doorgerekend' zichtbaar");
  ok((await p.textContent(".projbox .recalc .n")) === "1", "teller op Herberekenen = 1");
  await p.click('.nav [data-v="vereffening"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector("main").classList.contains("stale")), "oude uitkomst wordt grijs getoond");
  await p.screenshot({ path: `${SHOTS}/v12_02_herberekenen_modern.png` });
  await p.click('.stalebar [data-act="recalc"]'); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => window.__r !== V.APP.results[2] && V.APP.UI.pending.length === 0), "Herberekenen rekent en leegt de lijst");
  ok(!(await p.isVisible(".stalebar")), "balk weg na herberekenen");

  // stap verplaatsen zonder rekenen: resultaten blijven bij de juiste stap
  await p.click('.crumb [data-v="stappen"]'); await p.waitForTimeout(300);
  await p.click('[data-act="move-stage"][data-i="2"][data-d="-1"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const S = V.APP.state; return V.APP.results.find((r) => r.stage === S.stages[1]).name === "Total station"; }), "resultaat volgt de verschoven stap");
  await p.click('[data-act="move-stage"][data-i="1"][data-d="1"]'); await p.waitForTimeout(200);
  await p.click('.stalebar [data-act="recalc"]'); await p.waitForTimeout(1200);

  // punten: code geven aan 2 punten (zonder herberekenen) en puntnummer wijzigen
  await p.click('[data-act="openstage"][data-i="2"]'); await p.waitForTimeout(400);
  await p.click('.nav [data-v="punten"]'); await p.waitForTimeout(300);
  const names = await p.evaluate(() => [...document.querySelectorAll("[data-psel]")].map((c) => c.dataset.psel).filter((n) => /^98/.test(n)).slice(0, 2));
  for (const n of names) { await p.check(`[data-psel="${n}"]`); await p.waitForTimeout(150); }
  ok(await p.isVisible(".selbar"), "selectiebalk zichtbaar");
  await p.selectOption('[data-act="selcode"]', { index: 2 });
  const newCode = await p.evaluate(() => V.APP.UI.selCode);
  await p.click('[data-act="code-apply"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(([n, c]) => n.every((x) => V.APP.results[2].coords[x].code === c), [names, newCode]), `code ${newCode} direct zichtbaar zonder rekenen`);
  ok(await p.evaluate(() => V.APP.UI.pending.length === 0), "code-wijziging zet niets in de wachtlijst");
  await p.screenshot({ path: `${SHOTS}/v12_03_punten_code_modern.png` });
  await p.click(`.linkbtn[data-n="${names[0]}"]`); await p.waitForTimeout(250);
  ok(await p.isVisible(".modal"), "dialoog puntnummer wijzigen");
  await p.fill('[data-m="to"]', names[1]); await p.waitForTimeout(100);
  ok(await p.isVisible("#mergewarn"), "waarschuwing samenvoegen bij bestaand nummer");
  await p.fill('[data-m="to"]', "N-" + names[0]); await p.waitForTimeout(100);
  await p.screenshot({ path: `${SHOTS}/v12_04_hernoemen_modern.png` });
  await p.press('[data-m="to"]', "Enter"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => V.APP.UI.pending.some((w) => w.startsWith("puntnummer"))), "hernoemen staat in de wachtlijst");
  await p.click('.projbox [data-act="recalc"]'); await p.waitForTimeout(1300);
  ok(await p.evaluate((n) => ("N-" + n) in V.APP.results[2].coords && !(n in V.APP.results[2].coords), names[0]), "punt heet na herberekenen anders");
  ok(await p.evaluate((c) => V.APP.results[2].coords["N-" + V.APP.state.corrections.find((x) => x.type === "naam").from].code === c, newCode), "code-correctie gaat mee met het hernoemde punt");
  ok(await p.isVisible('text=Correcties in dit project'), "correctielijst getoond");
  await p.screenshot({ path: `${SHOTS}/v12_05_correcties_modern.png`, fullPage: true });

  // export-dialoog
  await p.click('.nav [data-v="export"]'); await p.waitForTimeout(300);
  await p.click('[data-act="exp-csv"]'); await p.waitForTimeout(300);
  ok(await p.isVisible(".modal.wide"), "exportdialoog open");
  await p.click('[data-act="exp-preset"][data-v="captivate"]'); await p.waitForTimeout(200);
  const prev = await p.textContent("pre.preview");
  ok(/^\S+,\d+\.\d{3},\d+\.\d{3},/.test(prev), "Captivate-voorbeeld: komma's en 3 decimalen");
  await p.screenshot({ path: `${SHOTS}/v12_06_export_modern.png` });
  ok(await p.isDisabled('[data-act="exp-set"][data-k="dec"][data-v=","]'), "decimale komma geblokkeerd bij komma als scheidingsteken");
  await p.click('[data-act="exp-set"][data-k="sep"][data-v=";"]'); await p.click('[data-act="exp-set"][data-k="dec"][data-v=","]'); await p.waitForTimeout(150);
  await p.uncheck('[data-expcol="code"]'); await p.click('[data-act="exp-mv"][data-k="y"][data-d="-1"]'); await p.waitForTimeout(150);
  const prev2 = await p.textContent("pre.preview");
  ok(/^\S+;\d+,\d{3};\d+,\d{3};[-−]?\d+,\d{3}\s*$/m.test(prev2.split("\n")[0]), "eigen indeling: ; en komma, zonder code");
  ok(await p.evaluate(() => V.APP.UI.modal.cfg.cols.join() === "punt,y,x,H"), "kolomvolgorde aangepast (y voor x)");
  await p.click('[data-act="exp-preset-save"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("vereffening.exportvoorinstellingen")).Uitzetlijst.cols.length === 4), "voorinstelling bewaard op apparaat");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('[data-act="exp-do"]')]);
  const body = require("fs").readFileSync(await dl.path(), "utf8");
  ok(dl.suggestedFilename().endsWith(".csv") && body.split(/\r\n/)[0].split(";").length === 4, `download ${dl.suggestedFilename()} met 4 kolommen`);

  // opslaan als (zonder bestandskiezer → Downloads)
  await p.evaluate(() => { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; });
  ok(await p.isVisible(".projbox .dot"), "stip voor niet-opgeslagen wijzigingen");
  await p.click('[data-act="save-as"]'); await p.waitForTimeout(250);
  await p.fill('[data-m="name"]', "IB26079 Dijkweg"); await p.fill('[data-m="file"]', "IB26079_dijkweg");
  await p.screenshot({ path: `${SHOTS}/v12_07_opslaanals_modern.png` });
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.click('[data-act="saveas-ok"]')]);
  ok(dl2.suggestedFilename() === "IB26079_dijkweg.vereffening.json", "bestandsnaam uit Opslaan als: " + dl2.suggestedFilename());
  const saved = JSON.parse(require("fs").readFileSync(await dl2.path(), "utf8"));
  ok(saved.name === "IB26079 Dijkweg" && saved.corrections.length === 3, "projectnaam en correcties in het bestand");
  ok(!(await p.isVisible(".projbox .dot")), "stip weg na opslaan");

  // stijlen
  for (const t of ["classic", "veldwerk", "veldwerk-donker", "modern"]) {
    await p.click(".logo"); await p.waitForTimeout(200);
    ok(await p.isVisible("#themepop"), `stijlmenu open (${t})`);
    if (t === "classic") await p.screenshot({ path: `${SHOTS}/v12_08_stijlmenu.png` });
    await p.click(`#themepop [data-v="${t}"]`); await p.waitForTimeout(250);
    ok((await p.evaluate(() => document.documentElement.dataset.theme)) === t, `stijl ${t} actief`);
    await p.click('.nav [data-v="vereffening"]'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/v12_10_vereffening_${t}.png` });
    await p.click('.nav [data-v="punten"]'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${SHOTS}/v12_11_punten_${t}.png` });
  }
  await p.click(".logo"); await p.click(`#themepop [data-v="veldwerk-donker"]`);
  await p.reload(); await p.waitForTimeout(1500);
  ok((await p.evaluate(() => document.documentElement.dataset.theme)) === "veldwerk-donker", "stijl onthouden na herladen");
  ok(await p.evaluate(() => V.APP.state.corrections.length === 3 && V.APP.results.length === 3), "project en correcties terug na herladen (één keer gerekend)");
  await p.click(".logo"); await p.waitForTimeout(150); await p.mouse.click(900, 600); await p.waitForTimeout(150);
  ok(!(await p.isVisible("#themepop")), "stijlmenu sluit bij klikken ernaast");
  await p.click(".logo"); await p.click(`#themepop [data-v="modern"]`);

  // nieuw project → naamvraag; eerste bestand → voorstel uit bestandsnaam
  await p.click('[data-act="new-project"]'); await p.waitForTimeout(300);
  ok(await p.isVisible('.modal >> text=Hoe heet dit project?'), "naamvraag bij Nieuw");
  await p.click('.modal [data-act="modal-close"]'); await p.waitForTimeout(150);
  await p.evaluate(() => { V.APP.state.nameAsked = false; });
  const fc = p.waitForEvent("filechooser");
  await p.click('[data-act="pick-files"]');
  await (await fc).setFiles({ name: "IB26079_dijk_NAP.csv", mimeType: "text/csv", buffer: Buffer.from("punt;x;y;H\nNAP1;140000;463000;1.234\n") });
  await p.waitForTimeout(500);
  ok((await p.inputValue('[data-m="name"]')) === "IB26079", "naamvoorstel uit bestandsnaam: IB26079");
  await p.screenshot({ path: `${SHOTS}/v12_12_projectnaam.png` });
  await p.click('[data-act="name-ok"]'); await p.waitForTimeout(200);
  ok((await p.evaluate(() => V.APP.state.name)) === "IB26079", "projectnaam gezet");
  ok(await p.evaluate(() => V.APP.results.length === 0 && V.APP.UI.pending.length === 1), "bestand toegevoegd, nog niet gerekend");

  ok(!errs.length, "geen fouten in de console" + (errs.length ? ": " + errs.join(" | ") : ""));
  await b.close();
  console.log(fail ? `${fail} FOUT(EN)` : "alles goed");
  process.exit(fail ? 1 : 0);
})();
