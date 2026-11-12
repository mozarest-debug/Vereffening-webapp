# Vereffening webapp

Offline webapp voor de vereffening van grondslagnetwerken. De app is één HTML-bestand dat zonder internet in de browser draait, ook op een veldcomputer.

- **Vereffening:** kleinste kwadraten, 2D in RD en 1D in NAP, vrij of aansluitend, met vaste, gewogen of getoetste aansluitpunten. Werkt in stappen (bijvoorbeeld waterpassing → GNSS → total station).
- **Toetsing (Delftse methode):** F-toets, w-toets (GNSS als 2D-bloktoets), MDB, redundantiegetallen, externe betrouwbaarheid, standaardellipsen, data snooping en een voorcontrole op grove fouten met een suggestie voor het juiste puntnummer.
- **Transformatie:** eigen implementatie van de transformatie tussen ETRS89 en RD/NAP, met de correctiegrids van NSGI. Zelf gecontroleerd met de openbare testpunten, maar niet officieel gevalideerd.
- **Import:**
  - Leica Captivate HeXML/LandXML (total station en GNSS) en Leica GSI8/16 (total station en digitale waterpassing);
  - Trimble DiNi M5 (`.dat`, digitale waterpassing), Trimble Survey Controller DC (`.dc`, GNSS) en Trimble Access `.job` (total station, **experimenteel**);
  - MOVE3-projecten (`.tco` + `.obs`) en coördinatenlijsten (`.csv`, `.txt`).
- **Export:** CSV, XLSX, DXF R12 (netwerkkaart met lagen en ellipsen) en een tekstrapport.

Alle berekeningen gebeuren lokaal in de browser. Er worden geen gegevens verstuurd.

> **Geen garantie.** Controleer de uitkomsten zelf voordat je ze gebruikt voor uitzetwerk of voor officiële of contractuele doeleinden. Gebruik bij twijfel gecertificeerde software ter controle.

## Downloaden

De kant-en-klare app staat bij [Releases](../../releases): download `Vereffening.html` en open het in Chrome of Edge. Bouwen is alleen nodig als je de broncode wilt aanpassen.

## Mappen

```
src/            broncode van de app
  math.js         lineaire algebra en statistiek
  rdnap.js        transformatie ETRS89 ↔ RD/NAP, grid-interpolatie
  core.js         netwerk, 2D/1D-vereffening, toetsing, MDB, ellipsen, voorcontrole
  obs.js          instellingen, reducties, waarnemingen, benaderingen
  hexml.js        import Leica HeXML/LandXML
  gsi.js          import Leica GSI8/16 en coördinatenlijsten
  trimble.js      import Trimble DiNi M5, DC en .job (experimenteel)
  project.js      stappen, bekende punten, data snooping, MOVE3-import
  export.js       CSV, XLSX, DXF, rapport
  app.js          gebruikersinterface
  style.css       opmaak
dist/           gebouwde bestanden
  codes.js        algemene codelijst (vervang door je eigen lijst)
tools/          bouwscripts
  build.py        bundelt alles tot dist/Vereffening.html
  pack_grids.js   zet de correctiegrids om naar dist/grids.js
  make_codes.py   zet een eigen Captivate-codelijst om naar dist/codes.js
  make_trimble_tests.js   maakt de fictieve Trimble-testbestanden
test/           tests
  fixtures/trimble/   fictieve Trimble-testbestanden (.dat, .dc, .csv)
  test_trimble.js     test van de Trimble-imports
  test_rdnap.js       test van de transformatie met de openbare testset
  ui.js, ui3.js       interfacetests (Playwright)
```

## Bouwen

Je hebt Python 3 en Node.js nodig. De app gebruikt geen externe bibliotheken.

1. Download de correctiegrids `rdcorr2018.txt` en `nlgeo2018.txt` bij [NSGI](https://www.nsgi.nl/). Ze zitten niet in de repository.
2. Zet de grids om (de waarden blijven ongewijzigd; alleen het formaat verandert):
   ```
   node tools/pack_grids.js pad/naar/rdcorr2018.txt pad/naar/nlgeo2018.txt
   ```
3. Optioneel: gebruik je eigen Captivate-codelijst in plaats van de algemene lijst:
   ```
   python3 tools/make_codes.py pad/naar/codelijst.xml
   ```
   Je kunt een codelijst ook later in de app laden (Instellingen → Codelijst).
4. Bouw de app:
   ```
   python3 tools/build.py                # zonder voorbeeldproject
   python3 tools/build.py --demo MAP     # met voorbeeldproject
   ```
   Het resultaat is `dist/Vereffening.html`.

## Testen

```
node tools/make_trimble_tests.js && node test/test_trimble.js   # Trimble-imports
node test/test_rdnap.js pad/naar/Z001_ETRS89andRDNAP.txt         # transformatie (openbare testset van NSGI)
npm install && npm run test:ui                                    # interface; vereist een build met --demo
```

De vereffening is daarnaast vergeleken met een Python-referentie-implementatie en met commerciële vereffeningssoftware. Die vergelijkingen gebruiken echte projectgegevens; die zijn niet openbaar en zitten daarom niet in deze repository. Alle testbestanden in deze repository zijn verzonnen.

## Licentie en vermeldingen

De broncode valt onder de [GNU General Public License v3.0 of later](LICENSE). Je mag de software gebruiken, aanpassen en verspreiden. Verspreid je een aangepaste versie, dan moet je de broncode daarvan ook onder de GPL beschikbaar stellen. De software wordt geleverd zonder enige garantie.

Onderdelen van derden en merken staan in [NOTICE.md](NOTICE.md).
