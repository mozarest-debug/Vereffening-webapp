"""Zet een Captivate-codelijst (bv. NLCS_2026_V7.xml) om naar dist/codes.js

Gebruik: python3 tools/make_codes.py pad/naar/codelijst.xml
"""
import sys, json, pathlib, xml.etree.ElementTree as ET
src = sys.argv[1]
name = pathlib.Path(src).stem
codes = {}
for el in ET.parse(src).getroot().iter():
    if el.tag.split("}")[-1] == "Code" and el.get("codeName"):
        codes[el.get("codeName")] = el.get("codeDesc", "")
out = pathlib.Path(__file__).resolve().parent.parent / "dist" / "codes.js"
out.write_text("globalThis.V=globalThis.V||{};V.CODELIST=" + json.dumps({"name": name, "codes": codes}, ensure_ascii=False) + ";\n", encoding="utf-8")
print(out, len(codes), "codes")
