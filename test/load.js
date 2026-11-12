const fs = require("fs");
for (const f of ["math", "rdnap", "core", "obs", "hexml", "gsi", "trimble", "project"]) require(`../src/${f}.js`);
require("../dist/grids.js");
const G = V.GRIDDATA;
V.TRANS = new V.TransformatieRdNap(V.Grid.fromPacked(G.rdcorr.meta, G.rdcorr.b64), V.Grid.fromPacked(G.nlgeo.meta, G.nlgeo.b64));
V.src = (path, kind, tag, options) => ({ name: path.split("/").pop(), text: fs.readFileSync(path, "latin1"), kind, tag, options: options || {} });
module.exports = V;
