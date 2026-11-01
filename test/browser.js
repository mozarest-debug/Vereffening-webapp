// Draait de engine in Chromium (echte DOMParser) en geeft resultaten terug aan node.
const fs = require("fs");
const { chromium } = require("playwright");
module.exports = async function withEngine(fn, arg) {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on("console", (m) => { if (m.type() === "error") console.log("[browser]", m.text()); });
  await p.setContent("<html><body></body></html>");
  for (const f of ["math", "rdnap", "core", "obs", "hexml", "gsi", "project"]) await p.addScriptTag({ path: `${__dirname}/../src/${f}.js` });
  await p.addScriptTag({ path: `${__dirname}/../dist/grids.js` });
  await p.evaluate(() => { const G = V.GRIDDATA; V.TRANS = new V.RDNAPTRANS(V.Grid.fromPacked(G.rdcorr.meta, G.rdcorr.b64), V.Grid.fromPacked(G.nlgeo.meta, G.nlgeo.b64)); });
  const out = await p.evaluate(fn, arg);
  await b.close();
  return out;
};
