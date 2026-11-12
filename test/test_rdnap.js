const fs = require("fs");
require("../src/math.js"); require("../src/rdnap.js"); require("../dist/grids.js");
const G = V.GRIDDATA;
const t = new V.TransformatieRdNap(V.Grid.fromPacked(G.rdcorr.meta, G.rdcorr.b64), V.Grid.fromPacked(G.nlgeo.meta, G.nlgeo.b64));
// Gebruik: node test/test_rdnap.js pad/naar/Z001_ETRS89andRDNAP.txt (openbare testset van NSGI)
const file = process.argv[2];
if (!file) { console.error("Gebruik: node test/test_rdnap.js Z001_ETRS89andRDNAP.txt"); process.exit(1); }
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
let mx = 0, my = 0, mH = 0, mlat = 0, mh = 0, nH = 0, nbad = 0;
for (const l of lines) {
  const p = l.trim().split(/\s+/).map(Number);
  const [lat, lon, h, x, y, H] = p.slice(1);
  const [xr, yr, Hr] = t.etrs89ToRdnap(lat, lon, h);
  if (x > -9000) { mx = Math.max(mx, Math.abs(xr - x)); my = Math.max(my, Math.abs(yr - y)); }
  if (H > -9000 && Hr === Hr) { mH = Math.max(mH, Math.abs(Hr - H)); nH++; }
  if (x > -9000 && H > -9000) {
    const [la, lo, hh] = t.rdnapToEtrs89(x, y, H);
    if (lat < 56 && lat > 50 && lon > 2 && lon < 8) { mlat = Math.max(mlat, Math.abs(la - lat), Math.abs(lo - lon)); if (hh === hh) mh = Math.max(mh, Math.abs(hh - h)); }
  }
}
console.log(`ETRS->RD max dx ${(mx*1000).toFixed(2)} mm dy ${(my*1000).toFixed(2)} mm, NAP ${(mH*1000).toFixed(3)} mm (${nH} pt); RD->ETRS max ${mlat.toExponential(2)} deg, h ${(mh*1000).toFixed(3)} mm`);
