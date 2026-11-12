// Bouwt fictieve Trimble-testbestanden: DiNi M5-waterpassing (heen/terug, met een verzakt wisselpunt)
// en een Survey Controller DC-bestand (GNSS, 2 bezettingen, één slechte bezetting).
// Alle punten en coördinaten zijn verzonnen. Vereist dist/grids.js (zie README, Bouwen).
// Gebruik: node tools/make_trimble_tests.js   -> test/fixtures/trimble/
const V = require("../test/load.js");
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "test", "fixtures", "trimble") + path.sep;
fs.mkdirSync(OUT, { recursive: true });
// fictieve grondslag: een NAP-peilmerk en een rij grondslagpunten om de ~100 m
const L = { "nap-0001": [150000, 440000, 1.250] };
for (let k = 0; k <= 7; k++) {
  const n = k === 0 ? "gp-9000" : "gp-040" + k;
  L[n] = [150050 + 95 * k, 440120 + 12 * k, 0.400 + 0.15 * Math.sin(k * 1.3) - 0.04 * k];
}
fs.writeFileSync(OUT + "grondslag_fictief.csv", Object.entries(L).map(([n, [x, y, h]]) => `${n},${x.toFixed(3)},${y.toFixed(3)},${h.toFixed(3)}`).join("\r\n") + "\r\n");
let seed = 20260324;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const truth = {};

// ================================================================= DiNi M5
(function dini() {
  const route = ["nap-0001", "gp-9000", "gp-0401", "gp-0402", "gp-0403", "gp-0404"];
  const short = { "nap-0001": "NAP", "gp-9000": "9000", "gp-0401": "401", "gp-0402": "402", "gp-0403": "403", "gp-0404": "404", "gp-0405": "405" };
  const H = {}; for (const p of [...route, "gp-0405"]) H[p] = L[p][2] + (p.startsWith("nap") ? 0 : gauss() * 0.0005); // 'ware' hoogte
  truth.dini = H;
  let adr = 0, t = 9 * 3600 + 58 * 60, nr = 0;
  const out = [];
  const tm = () => { t += 70 + Math.round(rnd() * 60); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":"); };
  const val = (k, v, dec) => (k + v.toFixed(dec).padStart(17 - k.length) + " m   ").padEnd(22);
  const empty = " ".repeat(22);
  const rec = (info, b1 = empty, b2 = empty, b3 = empty) => out.push(`For M5|Adr${String(++adr).padStart(6)}|${info.padEnd(31).slice(0, 31)}|${b1}|${b2}|${b3}| `);
  const kd = (n, pt, time, flag) => `KD1${String(n).padStart(9)}${pt.padStart(5)} ${(time || "").padEnd(8)}${flag}   4`;
  rec("TO  test-heen-terug.dat");
  const rd = (v) => Math.round(v * 1e5) / 1e5;
  const noise = () => gauss() * 0.00012;
  function line(pts, method, startZ, err) {
    rec(`TO  Doorg.begin        ${method === "BFFB" ? "AV" : "BF"}     4`);
    nr++;
    const p0 = pts[0];
    let Z = startZ, Sr = 0, Sv = 0;
    rec(kd(nr, short[p0], "", " "), empty, empty, val("Z", Z, 5));
    let bsName = short[p0], bsH = H[p0], bsNr = nr;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const dist = Math.hypot(L[b][0] - L[a][0], L[b][1] - L[a][1]);
      const n = Math.max(1, Math.round(dist / 70));
      for (let s = 0; s < n; s++) {
        const last = s === n - 1;
        const hNext = last ? H[b] : bsH + (H[b] - bsH) / (n - s) + (rnd() - 0.5) * 0.3;
        const HI = Math.max(bsH, hNext) + 1.0 + rnd() * 0.6;
        const d1 = dist / n / 2 + (rnd() - 0.5) * 4, d2 = dist / n / 2 + (rnd() - 0.5) * 4;
        let Lr = HI - bsH + noise(); const Lv = HI - hNext + noise();
        if (err && err.at === k && err.setup === s) Lr += err.mm / 1000; // wisselpunt verzakt vóór de achterslag
        const fsName = last ? short[b] : "TP", fsNr = ++nr;
        const t1 = tm();
        rec(kd(bsNr, bsName, t1, "3"), val("Lr", rd(Lr), 5), val("E", d1, 3));
        const t2 = tm();
        rec(kd(fsNr, fsName, t2, "3"), val("Lv", rd(Lv), 5), val("E", d2, 3));
        if (method === "BFFB") {
          rec(kd(fsNr, fsName, tm(), "3"), val("Lv", rd(Lv + noise()), 5), val("E", d2 + 0.01, 3));
          rec(kd(bsNr, bsName, tm(), "3"), val("Lr", rd(Lr + noise()), 5), val("E", d1 - 0.01, 3));
        }
        Z = Z + Lr - Lv; Sr += d1; Sv += d2;
        rec(kd(fsNr, fsName, t2, " "), empty, empty, val("Z", Z, 5));
        if (err && err.side && err.side.at === k && last) { // zijslag vanaf deze opstelling
          rec("TO  Zijslag                   4");
          const p = err.side.p, Lz = HI - H[p] + noise();
          rec(kd(++nr, short[p], tm(), "3"), val("Lz", rd(Lz), 5), val("E", 18.2, 3), val("Z", Z + Lv - Lz, 5));
          rec("TO  Einde zijslag             4");
        }
        bsName = fsName; bsH = hNext; bsNr = fsNr;
      }
    }
    return { Z, Sr, Sv };
  }
  const H0 = L[route[0]][2]; // starthoogte = bekende hoogte NAP-peilmerk
  const heen = line(route, "BFFB", H0, { side: { at: 5, p: "gp-0405" } });
  rec("TO  Doorg.einde               4");
  // terug: verzakt wisselpunt (+1,3 mm) in de sectie 403 → 402
  const back = [...route].reverse();
  const terug = line(back, "BF", heen.Z, { at: 2, setup: 0, mm: 1.3 });
  rec(kd(++nr, "NAP", "", " "), val("Sh", terug.Z - H0, 5), val("dz", H0 - terug.Z, 5), val("Z", H0, 5));
  rec(`KD2${String(nr).padStart(9)}  NAP${String(nr - 1).padStart(4)}         4`, val("Sr", terug.Sr, 2), val("Sv", terug.Sv, 2), val("Z", terug.Z, 5));
  rec("TO  Doorg.einde               4");
  fs.writeFileSync(OUT + "waterpassing_heen_terug.dat", out.join("\r\n") + "\r\n", "latin1");
  console.log("DiNi: heen eindigt op", heen.Z.toFixed(5), "terug op", terug.Z.toFixed(5), "| verwacht: sectie 402–403 ≈ +1,3 mm buiten tolerantie");
})();

// ================================================================= DC (GNSS)
(function dc() {
  const head = ["00NMSC V10-70       000901-Apr-26 08:00 213121", "10NMGNSS-TEST    121221", "13TSTime Date 04/01/2026 Time 08:12:30                          ", "13NMFictief testbestand, gegenereerd door tools/make_trimble_tests.js"];
  const f16 = (v) => { let d = 15, r = v.toFixed(d); while (r.length > 16 && d > 0) r = v.toFixed(--d); return r.padEnd(16, "0"); };
  const pts = ["gp-0401", "gp-0402", "gp-0403", "gp-0404", "gp-0405", "gp-0406", "gp-0407"];
  const off = 2.065, out = [...head];
  const tr = [];
  const R = (lat, lon) => { const p = lat * Math.PI / 180, l = lon * Math.PI / 180; return [[-Math.sin(l), Math.cos(l), 0], [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]]; };
  const ecef = (Cenu, lat, lon) => { const r = R(lat, lon); const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[i][j] += r[a][i] * Cenu[a][b] * r[b][j]; return C; };
  const mPerDeg = (lat) => [111320 * Math.cos(lat * Math.PI / 180), 111250];
  for (const n of pts) {
    const [x, y, Hn] = L[n];
    const [lat, lon, h] = V.TRANS.rdnapToEtrs89(x, y, Hn);
    const tps = [];
    for (let k = 0; k < 2; k++) {
      let dE = gauss() * 0.005, dN = gauss() * 0.005, dU = gauss() * 0.010;
      if (n === "gp-0404" && k === 1) { dE += 0.028; dN -= 0.012; dU += 0.045; } // slechte bezetting (multipath)
      const [mx, my] = mPerDeg(lat);
      const la = lat + dN / my, lo = lon + dE / mx, hh = h + dU + off;
      const sE = 0.008 + rnd() * 0.004, sN = sE * (0.9 + rnd() * 0.2), sU = 0.016 + rnd() * 0.008;
      const C = ecef([[sE * sE, 0, 0], [0, sN * sN, 0], [0, 0, sU * sU]], la, lo);
      out.push("57KI" + f16(2.0) + "2");
      out.push("66TP" + n.padStart(16) + f16(la) + f16(lo) + f16(hh) + "13-2".padEnd(16) + ":1" + f16(Math.hypot(sE, sN)) + f16(sU));
      out.push("C6NM1811.195968985557560.730629742145540.9468591213226361.86631426476600006                                2184463321.0000000002184463326.0000000001");
      out.push("59NM18" + [0.02, C[0][0], C[0][1], C[0][2], C[1][1], C[1][2], C[2][2]].map(f16).join(""));
      tps.push(hh);
      tr.push({ n, k, dE, dN, dU });
    }
    out.push("57KI" + f16(0) + "1");
    out.push("66AV" + n.padStart(16) + f16(lat) + f16(lon) + f16(tps.reduce((a, b) => a + b) / 2 - off) + "13-2".padEnd(16) + "1=" + " ".repeat(32));
  }
  fs.writeFileSync(OUT + "gnss_2x_bezetting.dc", out.join("\r\n") + "\r\n", "latin1");
  truth.dc = tr;
  console.log("DC:", pts.length, "punten × 2 bezettingen; slechte bezetting gp-0404 #2 (+28/−12/+45 mm)");
})();

fs.writeFileSync(OUT + "waarheid.json", JSON.stringify(truth, null, 1));
