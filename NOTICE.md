# Vermeldingen

## Correctiegrids

De gebouwde app (`dist/Vereffening.html`) bevat het correctiegrid `rdcorr2018` en de quasi-geoïde `nlgeo2018`, afkomstig van de Nederlandse Samenwerking Geodetische Infrastructuur (NSGI), https://www.nsgi.nl/.

- Licentie: Creative Commons, zoals vermeld bij de download van NSGI ([CC BY-ND 4.0](https://creativecommons.org/licenses/by-nd/4.0/deed.nl); de specificatie noemt voor deze bestanden [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.nl)). De app voldoet aan beide.
- Wijzigingen: geen aan de waarden. Het bestandsformaat is omgezet naar een compacte vorm met gehele getallen (verliesvrij); zie `tools/pack_grids.js`. Een omzetting van formaat is onder beide licenties toegestaan (artikel 2(a)(4)).
- De gridbestanden zelf zitten niet in deze repository. NSGI is niet verantwoordelijk voor deze app.

## Transformatie

De transformatie tussen ETRS89 en RD/NAP is een eigen implementatie op basis van de openbare procedure van NSGI. Ze is niet officieel gevalideerd en draagt daarom niet de officiële naam van die procedure.

## Merken

Leica, Captivate, HeXML en GSI zijn merken van Leica Geosystems. Trimble, DiNi en Trimble Access zijn merken van Trimble Inc. MOVE3 is een product van Sweco. Deze namen worden alleen gebruikt om aan te geven welke bestanden de app kan lezen. Dit project is niet verbonden aan of goedgekeurd door deze partijen.

## Trimble .job

Het `.job`-formaat van Trimble Access is niet gepubliceerd. De lezer in `src/trimble.js` is afgeleid uit de opbouw van voorbeeldbestanden, voor uitwisseling van meetgegevens. Er is geen software van Trimble gedecompileerd. De lezer is experimenteel; gebruik bij voorkeur een officiële export (JobXML).
