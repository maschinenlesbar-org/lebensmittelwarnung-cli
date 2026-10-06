# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `lebensmittelwarnung`, eines pro Skill: eine
Anfrage, die `lebensmittel`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 6. Oktober 2026 mit `lebensmittel` 0.3.0 gegen die Live-API; das
Rückruf-Beispiel lief am selben Tag noch einmal mit dem Build des nächsten Release, dessen
Werte ihre Zeilenumbrüche behalten.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten IDs und
Schlüsseln können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [lebensmittelwarnung-produkttyp](#lebensmittelwarnung-produkttyp) · [lebensmittelwarnung-recalls](#lebensmittelwarnung-recalls) · [lebensmittelwarnung-regional](#lebensmittelwarnung-regional)

## lebensmittelwarnung-produkttyp

> Welche Baby- und Kinderprodukte werden gerade zurückgerufen, und warum? Wie sieht das im Vergleich zu den anderen Kategorien aus?

```bash
for t in lebensmittel kosmetischemittel bedarfsgegenstaende mittelzumtaetowieren babyundkinderprodukte; do
  printf '%s\t%s\n' "$t" "$(lebensmittel warnings --type "$t" --compact | jq length)"
done
lebensmittel warnings --compact | jq length                                   # die Gesamtzahl: 255
lebensmittel warnings --type babyundkinderprodukte --compact \
  | jq -r '[.[] | (.reason // "?") | split(", ")[]] | group_by(.) | map({reason: .[0], n: length}) | sort_by(-.n)[] | "\(.reason): \(.n)"'
lebensmittel warnings --type babyundkinderprodukte --since 2026-06-01 --compact   # 2
```

Die Zählungen je Typ ergeben zusammen 275, der Feed enthält aber 255 Warnungen: Von den 21 Baby-
und Kinderprodukten stehen 5 auch unter Lebensmittel und 15 unter Bedarfsgegenstände. Der Skill
nennt deshalb jede Zahl für sich und die Gesamtzahl aus dem ungefilterten Feed.
`mittelzumtaetowieren` war leer, was der Skill als normales Ergebnis behandelt. Ein Babyartikel hat
zwei Gründe („Gesundheitsschädliche Substanz, Sonstige Gründe"), daher ergeben die Gründe 22. Die
ältere der beiden neueren Meldungen hat im Ordnernamen ein Datum zwei Tage vor ihrem `pubDate` und
wird deshalb als aktualisiert gemeldet.

```
Aktuelle Warnungen nach Produkttyp (lebensmittelwarnung.de, 06.10.2026)
  Lebensmittel 220 · Bedarfsgegenstände 29 · Baby- und Kinderprodukte 21 ·
  Kosmetische Mittel 5 · Mittel zum Tätowieren 0
  (insgesamt 255 Warnungen; eine Warnung kann unter zwei Typen stehen)

Baby- und Kinderprodukte – 21 Warnungen nach Grund der Meldung
  Gesundheitsschädliche Substanz    18
  Krankheitserreger                  2
  Rückstände und Kontaminanten       1
  Sonstige Gründe                    1   (zusammen mit Gesundheitsschädliche Substanz: Hamol Baby Powder)

Seit 01.06.2026 (2)
  • 02.10.  Cokoc Fruchtgummis Spiegeleier, 80 Gramm – Krankheitserreger
            Herman Kuijper BV, Amstelveen · keine Charge angegeben · MHD 24.10.2027 · 16 Länder
  • 06.08.  Stretchy Sand, Stretchmaus, Stretch Soldat – Gesundheitsschädliche Substanz
            Woolworth GmbH · „Es wird chargenunabhängig zurückgerufen." · 16 Länder
            (Meldung vom 04.08.2026, aktualisiert am 06.08.2026)
Davor: vor allem Stretch- und Sandspielzeug von Februar bis April 2026 (Stretcherz, Stretch Squad,
PUFFERZ, PhänoMINT Magischer Sand, Jungle Expedition), dazu Säuglingsnahrung von Aptamil/Milumil und
BEBA/ALFAMINO (Februar 2026) und enerBiO Dinkel Waffeln (Mai 2026, Rückstände und Kontaminanten).

Portal www.lebensmittelwarnung.de, 2026: Cokoc Fruchtgummis Spiegeleier, 80 Gramm,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/10_Oktober/261002_02_NW_Fruchtgummi/261002_02_NW_Fruchtgummi_Meldung.html, Stand: 06.10.2026
Portal www.lebensmittelwarnung.de, 2026: Stretchy Sand, Stretchmaus, Stretch Soldat,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/08_August/260804_03_NW_Maus_Soldat_StretchySand/260804_03_NW_Maus_Soldat_StretchySand_Meldung.html, Stand: 06.10.2026
```

## lebensmittelwarnung-recalls

> Gibt es einen Rückruf für Tahini? Ich habe ein Glas Sesampaste zu Hause.

```bash
lebensmittel warnings --search "Tahini" --compact    # [] – das Wort wie gefragt
lebensmittel warnings --search "Tahin" --compact \
  | jq -r 'def ind: gsub("\n"; "\n    "); .[] | "\(.title // "?" | ind)\n  Grund: \(.reason // "?" | ind)\n  Hersteller: \(.manufacturer // "?" | ind)\n  Charge: \(.lotNumbers // "—" | ind)\n  MHD: \(.bestBefore // "—" | ind)\n  \(.link)"'
                                                     # 4 – der Wortstamm findet „Tahina" und „Tahin"
lebensmittel warnings --compact | jq -r --arg re 'tahin|sesampaste|sesammus|sesame paste' \
  '.[] | select([.title, .product, .reason, .manufacturer, .link, (.fields | tostring)]
    | map(. // "") | join(" ") | test($re; "i")) | "\(.title) — \(.reason // "?") — \(.link)"'   # dieselben 4
```

`--search Tahini` findet nichts, weil keine Meldung es so schreibt: Die Produkte heißen *Tahina*
oder *Tahin*. Der Skill sucht den Wortstamm `Tahin`, der alle vier findet, und durchsucht danach
alle Felder und die Meldungs-URLs nach dem Stamm und den deutschen und englischen Wörtern für
Sesampaste; weitere Meldungen kamen nicht hinzu. Alle vier sind Rückrufe wegen Krankheitserregern;
der neueste ist die jüngste Meldung im ganzen Feed. Alle sind noch innerhalb ihrer
Mindesthaltbarkeit, daher nennt die Antwort alle vier mit den Angaben zum Vergleichen. Zwei
Herstelleranschriften kommen über drei Zeilen (`El Khawas Trading GmbH,` / `Schwelmer Straße 185,` /
`42389 Wuppertal`), die das Rezept unter `Hersteller:` einrückt.

```
Ja – vier Rückrufe für Tahini bzw. Sesampaste sind gelistet, alle wegen Krankheitserregern.
Vergleichen Sie Marke, Charge und Mindesthaltbarkeitsdatum mit Ihrem Glas:

  • 02.10.2026  Sesampaste (Tahina), Marke: Chtoura Garden, 12x800 Gramm
                Tema Fine Foods · Charge L#80 925 TF · MHD EXP 10-2027
                Baden-Württemberg, Bayern, Berlin, Hamburg, Niedersachsen, Nordrhein-Westfalen, Rheinland-Pfalz
  • 11.11.2025  Durra Tahina Sesame, 400 Gramm
                El Khawas Trading GmbH, Wuppertal · LOT NO. 98 · MHD 04/05/2027 · 3 Länder
  • 26.02.2025  EDEKA Bio Tahin Sesammus 260 Gramm
                HMF Food Production GmbH & Co. KG, Dortmund · keine Charge angegeben · MHD 10.12.2026 · alle 16 Länder
  • 08.03.2024  DiLEK Tahin Sesampaste, 300 Gramm
                ANATOL GmbH & Co. Großhandels KG · Charge EH23.101623 · MHD 16.10.2026 · alle 16 Länder

Ist Ihr Glas eines davon, mit derselben Charge oder demselben MHD, essen Sie es nicht; die Meldung
sagt, wie Sie es zurückgeben. Gesucht: Tahini, Tahin (Wortstamm), Tahina, Sesampaste, Sesammus, sesame paste.

Portal www.lebensmittelwarnung.de, 2026: Sesampaste (Tahina), 12x800 Gramm,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/10_Oktober/261002_03_BY_Sesampaste/261002_03_BY_Sesampaste.html, Stand: 06.10.2026
```

## lebensmittelwarnung-regional

> Welche Rückrufe betreffen gerade Thüringen? Und hat Thüringen selbst welche herausgegeben?

```bash
lebensmittel warnings --state thueringen --compact                      # 169 Warnungen
lebensmittel warnings --state thueringen --since 2026-09-06 --compact   # 8 seitdem veröffentlicht oder aktualisiert
lebensmittel warnings --compact \
  | jq -r '.[] | select(.link | test("/\\d{6,8}(_\\d+)?_TH_")) | "\(.title) — \(.reason // "?")"'   # 3
```

`--state thueringen` ist die Verteilerliste: die 169 Warnungen, deren `affectedStates` Thüringen
nennen, gleich wer sie herausgegeben hat. Die herausgebende Stelle ist kein Datenfeld; der Skill hat
sie aus dem Länderkürzel in der URL jeder Meldung (`_TH_`) abgeleitet, einer Namenskonvention, und
sagt das auch. Für den letzten Monat hat er jedes `pubDate` mit dem Datum im Ordnernamen der Meldung
verglichen: Zwei der acht sind ältere Meldungen, die im Zeitraum aktualisiert wurden.

```
Rückrufe, die Thüringen betreffen – 169 im Feed, 8 seit 06.09.2026 veröffentlicht oder aktualisiert

Seit 06.09.2026
  • 02.10.  Cokoc Fruchtgummis Spiegeleier, 80 Gramm – Krankheitserreger · Herman Kuijper BV · MHD 24.10.2027
  • 01.10.  Timut - Pfeffer, 10 Gramm – Krankheitserreger · Peugeot Saveurs Deutschland · Charge TPSDHY23RNHN · MHD 05/05/2030
  • 18.09.  Frische Puten-Schnitzel „Wiener Art" 800 Gramm – Fremdkörper · Heidemark · Charge 062640 · Verbrauchsdatum 28.09.2026
  • 18.09.  Gefrorene Austern, 226 Gramm – Krankheitserreger · Asia Express Food (Meldung vom 16.06.2026, aktualisiert)
  • 11.09.  Metzgerfrisch Frische Grobe Bratwurst – Fremdkörper · Lidl
  • 10.09.  Konserve BAMBOO SHOOT, diverse Sorten, 567 Gramm – Gesundheitsschädliche Substanz · Asia Express Food
  • 10.09.  Diverse Käsesorten – Krankheitserreger · Dorfkäserei Geifertshofen (Meldung vom 04.09.2026, aktualisiert)
  • 09.09.  Deluxe Erdbeeren in weißer Schokolade, 120 Gramm – Rückstände und Kontaminanten · Lidl · Chargen 12 L160426-1 und 13 L160426-1

Von Thüringen herausgegeben (TH in der Meldungs-URL) – 3 von 169
  • 04.09.2026  Knackwürste im Ring (Knoblauch und Kümmel) – Krankheitserreger
               REWE Alexander Mudrack oHG, Jenaer Str. · keine Charge und kein MHD angegeben
  • 24.06.2026  frischer Käse, 800 Gramm – Krankheitserreger · Käse King, Apolda · Charge F22042026
  • 29.05.2026  Butterspritzgebäck 175 Gramm – Allergene · arko I Hussel GmbH · Charge 118

Portal www.lebensmittelwarnung.de, 2026: Knackwürste im Ring (Knoblauch und Kümmel),
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260904_02_TH_Knackwurst/260904_02_TH_Knackwurst_Meldung.html, Stand: 06.10.2026
```
