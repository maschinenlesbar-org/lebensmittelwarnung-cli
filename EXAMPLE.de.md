# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `lebensmittelwarnung`, eines pro Skill: eine
Anfrage, die `lebensmittel`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 15. September 2026 mit `lebensmittel` 0.0.3 gegen die Live-API.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten IDs und
Schlüsseln können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [lebensmittelwarnung-produkttyp](#lebensmittelwarnung-produkttyp) · [lebensmittelwarnung-recalls](#lebensmittelwarnung-recalls) · [lebensmittelwarnung-regional](#lebensmittelwarnung-regional)

## lebensmittelwarnung-produkttyp

> Welche Baby- und Kinderprodukte werden gerade zurückgerufen, und warum? Wie sieht das im Vergleich zu den anderen Kategorien aus?

```bash
for t in lebensmittel kosmetischemittel bedarfsgegenstaende mittelzumtaetowieren babyundkinderprodukte; do lebensmittel warnings --type "$t" --compact | jq length; done
lebensmittel warnings --type babyundkinderprodukte --compact | jq -r 'group_by(.reason)[] | "\(.[0].reason // "?"): \(length)"'
lebensmittel warnings --type babyundkinderprodukte --since 2026-06-01 --compact
```

Die Zählungen je Typ ergeben zusammen 289, der Feed enthält aber 269 Warnungen. Manche Warnungen
stehen nämlich unter zwei Typen (fünf der Babyartikel zählen auch als Lebensmittel).
`mittelzumtaetowieren` war leer, was der Skill als normales Ergebnis behandelt. Der kombinierte
Grund „Gesundheitsschädliche Substanz, Sonstige Gründe" bildet eine eigene Gruppe.

```
Aktuelle Warnungen nach Produkttyp (lebensmittelwarnung.de, 15.09.2026)
  Lebensmittel 231 · Bedarfsgegenstände 30 · Baby- und Kinderprodukte 21 ·
  Kosmetische Mittel 7 · Mittel zum Tätowieren 0

Baby- und Kinderprodukte – 21 Warnungen nach Grund der Meldung
  Gesundheitsschädliche Substanz                    17
  Krankheitserreger                                  2
  Rückstände und Kontaminanten                       1
  Gesundheitsschädliche Substanz, Sonstige Gründe    1

Seit 01.06.2026 (2)
  • 06.08.  Stretchy Sand, Stretchmaus, Stretch Soldat – Gesundheitsschädliche Substanz
            Woolworth GmbH · Charge: „Es wird chargenunabhängig zurückgerufen." · 16 Länder
  • 30.07.  Genuss Plus Kids Fruchtchips Apfel – Krankheitserreger
            Dirk Rossmann GmbH · Chargennummer: C110862 MA · MHD 24.02.2027 · 16 Länder
Früher in 2026: vor allem Spielzeug, darunter viele Dehn- und Sandfiguren (Stretcherz, Stretch Squad,
PUFFERZ, PhänoMINT Magischer Sand), dazu Säuglingsprodukte von Danone (Aptamil/Milumil) und Nestlé (BEBA/ALFAMINO).

Portal www.lebensmittelwarnung.de, 2026: Stretchy Sand, Stretchmaus, Stretch Soldat,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/08_August/260804_03_NW_Maus_Soldat_StretchySand/260804_03_NW_Maus_Soldat_StretchySand_Meldung.html, Stand: 15.09.2026
Portal www.lebensmittelwarnung.de, 2026: Genuss Plus Kids Fruchtchips Apfel,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/07_Juli/260730_31_NI_Apfelchips/260730_31_NI_Apfelchips_Meldung.html, Stand: 15.09.2026
```

## lebensmittelwarnung-recalls

> Letzte Woche Biokäse an der Käsetheke gekauft – gibt es gerade einen Käse-Rückruf?

```bash
lebensmittel warnings --search "käse" --compact    # 4 Treffer, nur Titel
lebensmittel warnings --compact                    # 269 Warnungen; reason/manufacturer/fields nach käse|cheese durchsucht
```

`--search` durchsucht nur Produkttitel. Der Skill hat deshalb zusätzlich alle Felder durchsucht
und zwei weitere Warnungen gefunden, bei denen Käse nur in der Produktbeschreibung vorkommt. Der
Feed enthält nicht nur frische Meldungen (269 Einträge zurück bis 2018). Die Antwort beginnt
darum mit der aktuellen Meldung und nennt bei den übrigen das Datum.

```
Ja: Ein aktueller Rückruf betrifft Käse von der Theke.

Diverse Käsesorten – Krankheitserreger                              veröffentlicht 10.09.2026
  Hersteller: Dorfkäserei Geifertshofen AG
  Produkte:   15 Bioland-/Demeter-Käse, z. B. Weinbauernkäse, Wengert, St. Barbara,
              Schwäbischer Rahmkäse, Geifertshofener Pfefferkäse, Bio-Reibekäsemischung
  Packung:    verpackte Selbstbedienungs-Stücke in allen Grammaturen und lose an der Käsetheke verkaufte Ware
  Charge:     keine angegeben; der Rückruf gilt nach Mindesthaltbarkeitsdatum
              bis 30.10.2026 (Weinbauernkäse, Wengert, Classico, Trollingerkäse …) und
              bis 12.11.2026 (Bühlertaler Dorfkäse, St. Barbara, Rahmkäse, Pfefferkäse …)
  Länder:     alle 16
  → Käsesorte und MHD mit dem eigenen Einkauf abgleichen. Lose Thekenware hat oft kein
    Etikett – dann im Geschäft nachfragen, welcher Käse es war.

Ältere Warnungen mit Käsebezug
  • 05.08.2026  verschiedene Yopokki Rice-Cake-Becher (u. a. „Käse / Cheese") – Krankheitserreger · TJX Deutschland
  • 24.06.2026  frischer Käse, 800 Gramm – Krankheitserreger · Käse King, Apolda · Charge F22042026 · Thüringen, Sachsen
  • 23.06.2026  Chio „Dip! Hot Cheese“ mit der Etikettierung "Dip! Hot Salsa" – Allergene · Intersnack Deutschland SE
  • 28.05.2026  Pizza Ziegenkäse, 315 Gramm – Fremdkörper · Freiberger Lebensmittel GmbH · Charge L60471F, L60472F
  • 27.03.2026  Schafskäse Mediterran, Ziegenkäse mit Rotwein, je 150 Gramm – Allergene · Alimentias, SL

Portal www.lebensmittelwarnung.de, 2026: Diverse Käsesorten,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260904_03_BW_diverse_Kaesesorten/260904_03_BW_diverse_Kaesesorten.html, Stand: 15.09.2026
```

## lebensmittelwarnung-regional

> Welche Rückrufe betreffen gerade Thüringen? Und hat Thüringen selbst welche herausgegeben?

```bash
lebensmittel warnings --state thueringen --compact                     # 179 Warnungen
lebensmittel warnings --compact                                        # affectedStates-Abgleich für "Thüringen": dieselben 179
lebensmittel warnings --state thueringen --since 2026-08-15 --compact  # 12
```

Laut Skill liefert `--state` die Meldungen, die Thüringen *herausgegeben* hat, und der Abgleich
über `affectedStates` ergänzt Rückrufe anderer Länder. Live lieferten beide genau dieselben 179
Warnungen: Der Landes-Feed ist die Vertriebsliste. Für die zweite Frage nutzte der Skill das
Länderkürzel in der URL jeder Meldung (`_TH_`) – eine Namenskonvention, kein Datenfeld.

```
Rückrufe mit Thüringen im Vertriebsgebiet – 179 im Feed, 12 seit 15.08.2026 veröffentlicht

Seit 15.08.2026
  • 11.09.  Metzgerfrisch Frische Grobe Bratwurst – Fremdkörper · Lidl · MHD 15.09.2026 / 13.09.2026
  • 10.09.  Konserve BAMBOO SHOOT, diverse Sorten, 567 Gramm – Gesundheitsschädliche Substanz
  • 10.09.  Diverse Käsesorten – Krankheitserreger · Dorfkäserei Geifertshofen AG
  • 09.09.  Deluxe Erdbeeren in weißer Schokolade, 120 Gramm – Rückstände und Kontaminanten · Chargen 12 L160426-1 und 13 L160426-1
  • 04.09.  Frosty Pocket 150 Milliliter – Gesundheitsschädliche Substanz · alle Chargen
  • 04.09.  Knackwürste im Ring (Knoblauch und Kümmel) – Krankheitserreger · nur in Thüringen verkauft
  • 31.08.  verschiedene Sorten Schinken Streichmettwurst – Krankheitserreger · Fleischwaren Wulff · Charge 631501
  • 28.08.  EDEKA Bio Wildheidelbeeren tiefgefroren, 300 Gramm – Krankheitserreger · Jütro
  … 4 weitere (Bio-Hühnerknochenbrühe, Chorizo, Caviarcreme, Milbona High Protein Pudding Schoko)

Von Thüringen herausgegeben (TH in der Meldungs-URL) – 4 von 179
  • 04.09.2026  Knackwürste im Ring (Knoblauch und Kümmel) – Krankheitserreger
               REWE Alexander Mudrack oHG, Eisenberg · lose Abgabe als Stück Silberclip Blau/Weiß · keine Charge und kein MHD angegeben
  • 24.06.2026  frischer Käse, 800 Gramm – Krankheitserreger · Käse King, Apolda · Charge F22042026
  • 29.05.2026  Butterspritzgebäck 175 Gramm – Allergene · arko I Hussel GmbH · Charge 118
  • 15.10.2025  Feine Hausmachernudeln, 250 Gramm und 500 Gramm – Krankheitserreger · MHD 29.09.2026

Portal www.lebensmittelwarnung.de, 2026: Knackwürste im Ring (Knoblauch und Kümmel),
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260904_02_TH_Knackwurst/260904_02_TH_Knackwurst_Meldung.html, Stand: 15.09.2026
```
