const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const APP = "file://" + path.resolve(__dirname, "..", "dist", "Vereffening.html");
const shots = path.resolve(__dirname, "..", "shots");
fs.mkdirSync(shots, { recursive: true });
// Vereist een build met voorbeeldproject: python3 tools/build.py --demo MAP
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await p.goto(APP);
  await p.waitForTimeout(800);
  await p.screenshot({ path: shots + "/00_leeg.png", fullPage: true });
  await p.click('[data-act="demo"]');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: shots + "/01_stappen.png", fullPage: true });
  await p.click('[data-act="openstage"][data-i="2"]');
  await p.waitForTimeout(500);
  await p.screenshot({ path: shots + "/02_vereffening.png", fullPage: true });
  for (const t of ["bestanden", "punten", "export"]) { await p.click(`.nav [data-v="${t}"]`); await p.waitForTimeout(400); await p.screenshot({ path: `${shots}/03_${t}.png`, fullPage: true }); }
  await p.click('.nav [data-v="vereffening"]'); await p.waitForTimeout(300);
  await p.click('[data-act="view"][data-v="kaart"]'); await p.waitForTimeout(500);
  await p.screenshot({ path: shots + "/04_kaart.png", fullPage: true });
  await p.click('[data-act="back-from-map"]');
  await p.click('.logo'); await p.waitForTimeout(300);
  await p.click('.nav [data-v="controles"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: shots + "/05_controles.png", fullPage: true });
  await p.click('.nav [data-v="instellingen"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: shots + "/06_instellingen.png", fullPage: true });
  console.log("errors:", errs);
  await b.close();
})();
