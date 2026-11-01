// Zet de NSGI-ASCII-grids van RDNAPTRANS2018 om naar compacte Int32 (base64) -> dist/grids.js
// Gebruik: node tools/pack_grids.js pad/naar/rdcorr2018.txt pad/naar/nlgeo2018.txt
const fs = require("fs");
const path = require("path");
require("../src/rdnap.js");
const [rdPath, geoPath] = process.argv.slice(2);
if (!rdPath || !geoPath) {
  console.error("Gebruik: node tools/pack_grids.js rdcorr2018.txt nlgeo2018.txt");
  process.exit(1);
}
function pack(file, ncols, scale) {
  const g = V.Grid.fromText(fs.readFileSync(file, "utf8"), ncols);
  const b64 = g.vals.map((v) => {
    const i32 = new Int32Array(v.length);
    for (let i = 0; i < v.length; i++) i32[i] = Math.round(v[i] / scale);
    return Buffer.from(i32.buffer).toString("base64");
  });
  return { meta: { latmin: g.latmin, lonmin: g.lonmin, dlat: g.dlat, dlon: g.dlon, nlat: g.nlat, nlon: g.nlon, scale }, b64 };
}
const rd = pack(rdPath, 2, 1e-9);
const geo = pack(geoPath, 1, 1e-4);
const out = path.join(__dirname, "..", "dist", "grids.js");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, "globalThis.V=globalThis.V||{};V.GRIDDATA=" + JSON.stringify({ rdcorr: rd, nlgeo: geo }) + ";\n");
console.log(out, fs.statSync(out).size, "bytes");
