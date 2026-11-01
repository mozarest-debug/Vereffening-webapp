# Vereffening webapp

Offline webapp voor de vereffening van grondslagnetwerken, vergelijkbaar met MOVE3. De app is één HTML-bestand dat zonder internet in de browser draait, ook op een veldcomputer zoals de Leica CC180.

- **Vereffening:** kleinste kwadraten, 2D in RD en 1D in NAP, vrij of aansluitend, met gewogen, vaste of getoetste aansluitpunten. Werkt in stappen (bijvoorbeeld waterpassing → GNSS → total station).
- **Toetsing (Delftse methode):** F-toets, w-toets (GNSS als 2D-bloktoets), MDB, redundantiegetallen, externe betrouwbaarheid, standaardellipsen, data snooping en een voorcontrole op grove fouten met een suggestie voor het juiste puntnummer.
- **Transformatie:** RDNAPTRANS™2018 variant 1 (ETRS89 ↔ RD/NAP) met de NSGI-grids.
- **Import:** Leica Captivate HeXML/LandXML (TPS en GNSS), Leica GSI8/16 (total station en digitale waterpassing), MOVE3-projecten en coördinatenlijsten.
- **Export:** CSV, XLSX, DXF R12 (netwerkkaart met lagen en ellipsen) en een tekstrapport.

Alle berekeningen gebeuren lokaal in de browser. Er worden geen gegevens verstuurd.

## Downloaden

De kant-en-klare app staat bij [Releases](../../releases): download `Vereffening.html` en open het in Chrome of Edge. Bouwen is alleen nodig als je de broncode wilt aanpassen.

## Validatie

- **RDNAPTRANS™2018:** getoetst met de NSGI-validatieset Z001 (10.000 punten). De maximale afwijkingen zijn 0,6 mm in RD en 0,05 mm in NAP. Je kunt dit zelf nagaan met `test/test_rdnap.js`.
- **Vereffening:** de uitkomsten zijn vergeleken met een Python-referentie-implementatie en met MOVE3. Op een schoolproject geven beide dezelfde F-toets (0,589) en dezelfde coördinaten tot op 0,1 mm. De JavaScript-versie en de Python-versie verschillen onderling minder dan 0,001 mm. De meetgegevens van die vergelijkingen zijn niet openbaar en zitten daarom niet in deze repository.

## Mappen

| Map / bestand | Inhoud |
|---|---|
| `src/math.js` | Lineaire algebra (Cholesky, Jacobi, S-basis) en statistiek (normaal, niet-centrale χ²) |
| `src/rdnap.js` | RDNAPTRANS™2018 variant 1, grid-interpolatie |
| `src/core.js` | Netwerk, 2D/1D-vereffening, F-/w-/T-toets, MDB, ellipsen, voorcontrole |
| `src/obs.js` | Instellingen, reducties, TPS-waarnemingen, benaderingen, waterpasopstellingen |
| `src/hexml.js` | Import Leica Captivate HeXML/LandXML |
| `src/gsi.js` | Import Leica GSI8/16 en coördinatenlijsten |
| `src/project.js` | Project met stappen, regels voor bekende punten, data snooping, MOVE3-import |
| `src/export.js` | CSV, XLSX (zonder bibliotheek), DXF R12, rapport |
| `src/app.js`, `src/style.css` | Gebruikersinterface |
| `dist/codes.js` | Standaardcodelijst (NLCS, Captivate) |
| `tools/` | Bouwscripts |
| `test/` | Test van RDNAPTRANS en interfacetests (Playwright) |

## Bouwen

Je hebt Python 3 en Node.js nodig. De app gebruikt geen externe bibliotheken.

1. Download de RDNAPTRANS™2018-grids (`rdcorr2018.txt` en `nlgeo2018.txt`) bij [NSGI](https://www.nsgi.nl/). Deze bestanden zitten niet in de repository.
2. Zet de grids om:
   ```
   node tools/pack_grids.js pad/naar/rdcorr2018.txt pad/naar/nlgeo2018.txt
   ```
3. Optioneel: gebruik een eigen Captivate-codelijst in plaats van de meegeleverde:
   ```
   python3 tools/make_codes.py pad/naar/codelijst.xml
   ```
4. Bouw de app:
   ```
   python3 tools/build.py                # zonder voorbeeldproject
   python3 tools/build.py --demo MAP     # met voorbeeldproject
   ```
   Het resultaat is `dist/Vereffening.html`. Dat bestand open je in een browser of kopieer je naar de veldcomputer.

## Testen

```
node test/test_rdnap.js pad/naar/Z001_ETRS89andRDNAP.txt   # NSGI-validatieset
npm install && npm run test:ui                               # interface; vereist een build met --demo
```

## Licentie

[GNU General Public License v3.0 of later](LICENSE). Je mag de software gebruiken, aanpassen en verspreiden. Verspreid je een aangepaste versie, dan moet je de broncode daarvan ook onder de GPL beschikbaar stellen.

De software wordt geleverd zonder enige garantie. Controleer de uitkomsten zelf voordat je ze gebruikt voor officiële of contractuele doeleinden.

De gebouwde app bevat het correctiegrid `rdcorr2018` en de quasi-geoïde `nlgeo2018` van RDNAPTRANS™2018, © Nederlandse Samenwerking Geodetische Infrastructuur (NSGI), gebruikt onder de licentie [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). De grids zijn omgezet naar een compact formaat; de waarden zijn ongewijzigd.

RDNAPTRANS™ is een merk van NSGI (Nederlandse Samenwerking Geodetische Infrastructuur). MOVE3 is een product van Sweco. Leica, Captivate en GSI zijn merken van Leica Geosystems. Dit project is niet verbonden aan deze partijen.
