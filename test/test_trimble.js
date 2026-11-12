// Test van de Trimble-imports (DiNi M5 en DC) op de fictieve bestanden in test/fixtures/trimble.
// Eerst: node tools/make_trimble_tests.js   Daarna: node test/test_trimble.js
const V = require("./load.js");
const fs = require("fs");
const path = require("path");
const D = path.join(__dirname, "fixtures", "trimble") + path.sep;
const f1 = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");
const truth = JSON.parse(fs.readFileSync(D + "waarheid.json"));
const lst = D + "grondslag_fictief.csv";
function proj(stages) { const p = new V.Project(V.TRANS); for (const s of stages) p.stages.push(Object.assign(V.newStage(s.name), s)); return p; }
let ok = true;
const check = (c, msg) => { console.log((c ? "OK   " : "FOUT ") + msg); ok = ok && c; };

// DiNi heen/terug
let r = proj([{ name: "WP", sources: [V.src(lst, "coords", "LIJST"), V.src(D + "waterpassing_heen_terug.dat", "dini", "WP")], known: [{ points: ["nap-0001"], dim: "1D", mode: "vast", origin: "lijst" }], dims: "1D" }]).run()[0];
const lv = r.checks.leveling[0];
check(!r.error, "waterpassing berekend " + (r.error || ""));
check(lv.repeat_n > 0, `dubbele aflezingen (BFFB) herkend: ${lv.repeat_n} paren`);
check(lv.lines.length === 2, "twee trajecten (heen en terug)");
const bad = lv.sections.filter((s) => !s.ok);
check(bad.length === 1 && [bad[0].van, bad[0].naar].sort().join() === "gp-0402,gp-0403", `sectie buiten tolerantie: ${bad.map((s) => `${s.van}–${s.naar} ${f1(s.verschil_mm, 2)} mm`).join(", ")}`);
check(!!r.coords["gp-0405"], "zijslag 405 gekoppeld aan gp-0405");
const dmax = Math.max(...Object.entries(truth.dini).filter(([n]) => r.coords[n]).map(([n, h]) => Math.abs(r.coords[n].H - h) * 1000));
check(dmax < 1.5, `vereffende hoogtes binnen 1,5 mm van de ware hoogte (max ${f1(dmax, 2)} mm)`);

// DC met twee bezettingen
r = proj([{ name: "GNSS", sources: [V.src(lst, "coords", "LIJST"), V.src(D + "gnss_2x_bezetting.dc", "dc", "GNSS")], dims: "2D" }]).run()[0];
const g = r.checks.gnssOcc;
check(g.length === 7, "7 punten met 2 bezettingen");
check(g.filter((x) => !x.ok).map((x) => x.punt).join() === "gp-0404", `bezettingscontrole keurt af: ${g.filter((x) => !x.ok).map((x) => x.punt).join(", ")}`);
console.log(ok ? "\nALLE CONTROLES OK" : "\nER ZIJN FOUTEN");
process.exit(ok ? 0 : 1);
