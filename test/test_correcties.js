// Correcties (puntnummer / code, hele project) en cache van ingelezen bestanden.
const V = require("./load.js");
const D = process.env.DIJK || process.argv[2] || "demo";
let fail = 0;
const ok = (c, t) => { console.log((c ? "OK  " : "FOUT") + " " + t); if (!c) fail++; };
function proj(corr) {
  const p = new V.Project(V.TRANS);
  p.corrections = corr || [];
  const st = [
    { name: "Waterpassing", sources: [Object.assign(V.src(`${D}/NAP_peilmerken.csv`, "coords", "NAP"), { id: "a" }), Object.assign(V.src(`${D}/waterpassing_DNA.GSI`, "gsi", "WP"), { id: "b" })], known: [{ points: ["NAPSIM1", "NAPSIM2"], dim: "1D", mode: "vast_getoetst", origin: "lijst", sh_mm: 1.0 }] },
    { name: "GNSS spijkers", sources: [Object.assign(V.src(`${D}/gnss_statisch.xml`, "hexml", "GNSS"), { id: "c" })], dims: "2D" },
    { name: "Total station", sources: [Object.assign(V.src(`${D}/total_station.xml`, "hexml", "TPS"), { id: "d" })], known: [{ points: "80*", dim: "2D", mode: "gewogen", origin: "GNSS spijkers" }, { points: "80*", dim: "1D", mode: "vast", origin: "Waterpassing" }] },
  ];
  for (const s of st) p.stages.push(Object.assign(V.newStage(s.name), s));
  return p;
}
const t0 = performance.now();
const base = proj().run();
const t1 = performance.now();
const again = proj().run();
const t2 = performance.now();
ok(base.every((r) => !r.error), "basis rekent zonder fouten");
ok(JSON.stringify(base[2].coords) === JSON.stringify(again[2].coords), "tweede keer (uit cache) identiek");
console.log(`     eerste keer ${(t1 - t0).toFixed(0)} ms, tweede keer ${(t2 - t1).toFixed(0)} ms`);

// kies een nieuw punt uit de total-station-stap
const tps = base[2];
const nieuw = Object.keys(tps.coords).filter((n) => !/^80/.test(n) && tps.coords[n].code !== "906").sort()[0];
const code0 = tps.coords[nieuw].code;
console.log(`     testpunt ${nieuw} (code ${code0})`);

// 1. puntnummer wijzigen
const r1 = proj([{ type: "naam", from: nieuw, to: "X-" + nieuw }]).run();
ok(!(nieuw in r1[2].coords) && ("X-" + nieuw) in r1[2].coords, "hernoemd punt heet overal anders");
const a = base[2].coords[nieuw], b = r1[2].coords["X-" + nieuw];
ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.H - b.H) < 1e-9, "coördinaten gelijk na hernoemen");
ok(r1[2].log.some((l) => l.startsWith("Correctie puntnummers")), "hernoemen staat in de rekenlog");
ok(r1[2].net.obs.some((o) => o.meta && o.meta.was === nieuw), "waarnemingen onthouden de oude naam");

// 2. ketting: A → B → C
const r2 = proj([{ type: "naam", from: nieuw, to: "B" }, { type: "naam", from: "B", to: "C" }]).run();
ok("C" in r2[2].coords && !("B" in r2[2].coords), "ketting van hernoemingen werkt");

// 3. code wijzigen
const r3 = proj([{ type: "code", punt: nieuw, from: code0, to: "999" }]).run();
ok(r3[2].coords[nieuw].code === "999", "code gewijzigd in resultaat");
ok(Math.abs(r3[2].coords[nieuw].x - a.x) < 1e-12, "code-wijziging verandert de rekenuitkomst niet");
const r3b = proj([{ type: "naam", from: nieuw, to: "Q" }, { type: "code", punt: "Q", to: "998" }]).run();
ok(r3b[2].coords.Q && r3b[2].coords.Q.code === "998", "code op hernoemd punt");

// 4. samenvoegen: een GNSS-punt hernoemen naar een bestaande naam uit de waterpassing
const gn = Object.keys(base[1].coords).sort()[0];
const r4 = proj([{ type: "naam", from: gn, to: gn + "_samen" }]).run();
ok((gn + "_samen") in r4[1].coords, "hernoemen in GNSS-stap");
ok(!r4[2].error, "volgende stap rekent nog (regels 80* passen zich aan)");

// 5. ongedaan maken = terug naar basis
const r5 = proj([]).run();
ok(JSON.stringify(r5[2].coords) === JSON.stringify(base[2].coords), "zonder correcties weer gelijk aan basis");
console.log(fail ? `${fail} FOUT(EN)` : "alles goed");
process.exit(fail ? 1 : 0);
