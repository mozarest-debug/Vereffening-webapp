"""Bundelt alles tot één offline HTML-bestand: dist/Vereffening.html

Gebruik:
    python3 tools/build.py                 # zonder voorbeeldproject
    python3 tools/build.py --demo MAP      # met voorbeeldproject uit MAP
                                           # (NAP_peilmerken.csv, waterpassing_DNA.GSI,
                                           #  gnss_statisch.xml, total_station.xml)
Vooraf nodig: dist/grids.js (tools/pack_grids.js) en dist/codes.js (tools/make_codes.py).
"""
import argparse, json, pathlib, sys

R = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--demo", type=pathlib.Path, help="map met de bestanden van het voorbeeldproject")
ap.add_argument("--out", type=pathlib.Path, default=R / "dist" / "Vereffening.html")
a = ap.parse_args()

for f in ("grids.js", "codes.js"):
    if not (R / "dist" / f).exists():
        sys.exit(f"dist/{f} ontbreekt; zie README (Bouwen).")

demo_js = ""
if a.demo:
    demo = {k: (a.demo / f).read_text(encoding="latin-1") for k, f in
            [("nap", "NAP_peilmerken.csv"), ("wp", "waterpassing_DNA.GSI"), ("gnss", "gnss_statisch.xml"), ("tps", "total_station.xml")]}
    demo_js = f"V.DEMO={json.dumps(demo)};"

js = "".join((R / "src" / f"{n}.js").read_text(encoding="utf-8") + "\n"
             for n in ["math", "rdnap", "core", "obs", "hexml", "gsi", "project", "export", "app"])
safe = lambda s: s.replace("</script", "<\\/script")
html = f"""<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vereffening</title>
<meta name="description" content="Vereffening grondslagnetwerk – offline webapp (kleinste kwadraten, Delftse toetsing, RDNAPTRANS2018)">
<style>{(R / "src" / "style.css").read_text(encoding="utf-8")}</style>
</head>
<body>
<div id="app"><main><p>Vereffening wordt geladen…</p><noscript>Zet JavaScript aan om de app te gebruiken.</noscript></main></div>
<script>{safe((R / "dist" / "grids.js").read_text(encoding="utf-8"))}</script>
<script>{safe((R / "dist" / "codes.js").read_text(encoding="utf-8"))}</script>
<script>globalThis.V=globalThis.V||{{}};{safe(demo_js)}</script>
<script>{safe(js)}</script>
<script>V.startApp();</script>
</body>
</html>
"""
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(html, encoding="utf-8")
print(a.out, round(a.out.stat().st_size / 1e6, 2), "MB", "(met voorbeeldproject)" if a.demo else "")
