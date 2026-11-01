const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const APP = "file://" + path.resolve(__dirname, "..", "dist", "Vereffening.html");
const shots = path.resolve(__dirname, "..", "shots");
fs.mkdirSync(shots, { recursive: true });
// Vereist een build met voorbeeldproject: python3 tools/build.py --demo MAP
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(APP); await p.waitForTimeout(500);
  await p.click('[data-act="demo"]'); await p.waitForTimeout(1500);
  await p.click('[data-act="openstage"][data-i="2"]'); await p.waitForTimeout(600);
  await p.screenshot({ path: shots + "/20_cc_vereffening.png" });
  // hernoemen-knop testen
  await p.click('.nav [data-v="bestanden"]'); await p.waitForTimeout(300);
  await p.click('[data-act="rename"]'); await p.waitForTimeout(800);
  const log = await p.evaluate(() => V.APP.results[2].log.filter((l) => /Hernoemd|Voorcontrole|2D/.test(l)));
  console.log(log, errs);
  await b.close();
})();
