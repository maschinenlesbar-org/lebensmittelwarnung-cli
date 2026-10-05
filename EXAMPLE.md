# Examples

Real examples for the Claude Code skills of the `lebensmittelwarnung` plugin, one per skill: a request,
the `lebensmittel` commands the skill ran, and the answer Claude gave.

Every example ran against the live API on 6 October 2026 with `lebensmittel` 0.3.0.
The data changes, so your results will differ; the ids and keys shown work for trying the
requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [lebensmittelwarnung-produkttyp](#lebensmittelwarnung-produkttyp) · [lebensmittelwarnung-recalls](#lebensmittelwarnung-recalls) · [lebensmittelwarnung-regional](#lebensmittelwarnung-regional)

## lebensmittelwarnung-produkttyp

> Which baby and children's products are recalled at the moment, and why? How does that compare with other categories?

```bash
for t in lebensmittel kosmetischemittel bedarfsgegenstaende mittelzumtaetowieren babyundkinderprodukte; do
  printf '%s\t%s\n' "$t" "$(lebensmittel warnings --type "$t" --compact | jq length)"
done
lebensmittel warnings --compact | jq length                                   # the total: 255
lebensmittel warnings --type babyundkinderprodukte --compact \
  | jq -r '[.[] | (.reason // "?") | split(", ")[]] | group_by(.) | map({reason: .[0], n: length}) | sort_by(-.n)[] | "\(.reason): \(.n)"'
lebensmittel warnings --type babyundkinderprodukte --since 2026-06-01 --compact   # 2
```

The per-type counts add up to 275 against 255 warnings in the feed: of the 21 baby and
children's products, 5 are also listed under Lebensmittel and 15 under Bedarfsgegenstände, so
the skill gives each count on its own and the total from the unfiltered feed.
`mittelzumtaetowieren` came back empty, which the skill treats as a normal result. One baby
item has two reasons („Gesundheitsschädliche Substanz, Sonstige Gründe"), so the reasons add up
to 22. The older of the two recent notices has a folder date two days before its `pubDate`, so
it is reported as updated.

```
Current warnings by product type (lebensmittelwarnung.de, 06.10.2026)
  Lebensmittel 220 · Bedarfsgegenstände 29 · Baby- und Kinderprodukte 21 ·
  Kosmetische Mittel 5 · Mittel zum Tätowieren 0
  (255 warnings in all; a warning can be listed under two types)

Baby- und Kinderprodukte — 21 warnings by Grund der Meldung
  Gesundheitsschädliche Substanz    18
  Krankheitserreger                  2
  Rückstände und Kontaminanten       1
  Sonstige Gründe                    1   (together with Gesundheitsschädliche Substanz: Hamol Baby Powder)

Since 01.06.2026 (2)
  • 02.10.  Cokoc Fruchtgummis Spiegeleier, 80 Gramm — Krankheitserreger
            Herman Kuijper BV, Amstelveen · no Charge given · MHD 24.10.2027 · 16 Länder
  • 06.08.  Stretchy Sand, Stretchmaus, Stretch Soldat — Gesundheitsschädliche Substanz
            Woolworth GmbH · „Es wird chargenunabhängig zurückgerufen." · 16 Länder
            (notice of 04.08.2026, updated 06.08.2026)
Earlier: mostly stretch and sand toys from February to April 2026 (Stretcherz, Stretch Squad,
PUFFERZ, PhänoMINT Magischer Sand, Jungle Expedition), plus Aptamil/Milumil and BEBA/ALFAMINO
infant products (February 2026) and enerBiO Dinkel Waffeln (May 2026, Rückstände und Kontaminanten).

Portal www.lebensmittelwarnung.de, 2026: Cokoc Fruchtgummis Spiegeleier, 80 Gramm,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/10_Oktober/261002_02_NW_Fruchtgummi/261002_02_NW_Fruchtgummi_Meldung.html, Stand: 06.10.2026
Portal www.lebensmittelwarnung.de, 2026: Stretchy Sand, Stretchmaus, Stretch Soldat,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/08_August/260804_03_NW_Maus_Soldat_StretchySand/260804_03_NW_Maus_Soldat_StretchySand_Meldung.html, Stand: 06.10.2026
```

## lebensmittelwarnung-recalls

> Is there a recall for tahini? I have a jar of sesame paste at home.

```bash
lebensmittel warnings --search "Tahini" --compact    # [] — the word as asked
lebensmittel warnings --search "Tahin" --compact     # 4 — the stem finds "Tahina" and "Tahin"
lebensmittel warnings --compact | jq -r --arg re 'tahin|sesampaste|sesammus|sesame paste' \
  '.[] | select([.title, .product, .reason, .manufacturer, .link, (.fields | tostring)]
    | map(. // "") | join(" ") | test($re; "i")) | "\(.title) — \(.reason // "?") — \(.link)"'   # the same 4
```

`--search Tahini` returns nothing because no notice spells it that way: the products are
called *Tahina* or *Tahin*. The skill searches the stem, `Tahin`, which finds all four, and
then scans every field and the notice URLs for the stem and the German and English words for
sesame paste; that found no further notice. All four are pathogen recalls; the newest is the
latest notice in the whole feed. Each is still within its best-before date, so the answer
lists all four with the codes to compare.

```
Yes — four tahini / sesame-paste recalls are listed, all for pathogens (Krankheitserreger).
Compare the brand, the batch and the best-before date with your jar:

  • 02.10.2026  Sesampaste (Tahina), Marke: Chtoura Garden, 12x800 Gramm
                Tema Fine Foods · Charge L#80 925 TF · MHD EXP 10-2027
                Baden-Württemberg, Bayern, Berlin, Hamburg, Niedersachsen, Nordrhein-Westfalen, Rheinland-Pfalz
  • 11.11.2025  Durra Tahina Sesame, 400 Gramm
                El Khawas Trading GmbH, Wuppertal · LOT NO. 98 · MHD 04/05/2027 · 3 Länder
  • 26.02.2025  EDEKA Bio Tahin Sesammus 260 Gramm
                HMF Food Production GmbH & Co. KG, Dortmund · no Charge given · MHD 10.12.2026 · all 16 Länder
  • 08.03.2024  DiLEK Tahin Sesampaste, 300 Gramm
                ANATOL GmbH & Co. Großhandels KG · Charge EH23.101623 · MHD 16.10.2026 · all 16 Länder

If your jar is one of these with the same batch or best-before date, don't eat it; the notice
says how to return it. Searched: Tahini, Tahin (stem), Tahina, Sesampaste, Sesammus, sesame paste.

Portal www.lebensmittelwarnung.de, 2026: Sesampaste (Tahina), 12x800 Gramm,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/10_Oktober/261002_03_BY_Sesampaste/261002_03_BY_Sesampaste.html, Stand: 06.10.2026
```

## lebensmittelwarnung-regional

> Which recalls affect Thüringen right now? And did Thüringen issue any itself?

```bash
lebensmittel warnings --state thueringen --compact                      # 169 warnings
lebensmittel warnings --state thueringen --since 2026-09-06 --compact   # 8 published or updated since
lebensmittel warnings --compact \
  | jq -r '.[] | select(.link | test("/\\d{6,8}(_\\d+)?_TH_")) | "\(.title) — \(.reason // "?")"'   # 3
```

`--state thueringen` is the distribution list: the 169 warnings whose `affectedStates` name
Thüringen, whoever issued them. The issuer is not a data field, so the skill took it from the
Land code in each notice URL (`_TH_`), a naming convention, and says so. For the last month it
compared each `pubDate` with the date in the notice's folder name: two of the eight are older
notices that were updated in the window.

```
Recalls affecting Thüringen — 169 in the feed, 8 published or updated since 06.09.2026

Since 06.09.2026
  • 02.10.  Cokoc Fruchtgummis Spiegeleier, 80 Gramm — Krankheitserreger · Herman Kuijper BV · MHD 24.10.2027
  • 01.10.  Timut - Pfeffer, 10 Gramm — Krankheitserreger · Peugeot Saveurs Deutschland · Charge TPSDHY23RNHN · MHD 05/05/2030
  • 18.09.  Frische Puten-Schnitzel „Wiener Art" 800 Gramm — Fremdkörper · Heidemark · Charge 062640 · Verbrauchsdatum 28.09.2026
  • 18.09.  Gefrorene Austern, 226 Gramm — Krankheitserreger · Asia Express Food (notice of 16.06.2026, updated)
  • 11.09.  Metzgerfrisch Frische Grobe Bratwurst — Fremdkörper · Lidl
  • 10.09.  Konserve BAMBOO SHOOT, diverse Sorten, 567 Gramm — Gesundheitsschädliche Substanz · Asia Express Food
  • 10.09.  Diverse Käsesorten — Krankheitserreger · Dorfkäserei Geifertshofen (notice of 04.09.2026, updated)
  • 09.09.  Deluxe Erdbeeren in weißer Schokolade, 120 Gramm — Rückstände und Kontaminanten · Lidl · Chargen 12 L160426-1 und 13 L160426-1

Issued by Thüringen (TH in the notice URL) — 3 of 169
  • 04.09.2026  Knackwürste im Ring (Knoblauch und Kümmel) — Krankheitserreger
               REWE Alexander Mudrack oHG, Jenaer Str. · no Charge or MHD given
  • 24.06.2026  frischer Käse, 800 Gramm — Krankheitserreger · Käse King, Apolda · Charge F22042026
  • 29.05.2026  Butterspritzgebäck 175 Gramm — Allergene · arko I Hussel GmbH · Charge 118

Portal www.lebensmittelwarnung.de, 2026: Knackwürste im Ring (Knoblauch und Kümmel),
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260904_02_TH_Knackwurst/260904_02_TH_Knackwurst_Meldung.html, Stand: 06.10.2026
```
