# Examples

Real examples for the Claude Code skills of the `lebensmittelwarnung` plugin, one per skill: a request,
the `lebensmittel` commands the skill ran, and the answer Claude gave.

Every example ran against the live API on 15 September 2026 with `lebensmittel` 0.0.3.
The data changes, so your results will differ; the ids and keys shown work for trying the
requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [lebensmittelwarnung-produkttyp](#lebensmittelwarnung-produkttyp) · [lebensmittelwarnung-recalls](#lebensmittelwarnung-recalls) · [lebensmittelwarnung-regional](#lebensmittelwarnung-regional)

## lebensmittelwarnung-produkttyp

> Which baby and children's products are recalled at the moment, and why? How does that compare with other categories?

```bash
for t in lebensmittel kosmetischemittel bedarfsgegenstaende mittelzumtaetowieren babyundkinderprodukte; do lebensmittel warnings --type "$t" --compact | jq length; done
lebensmittel warnings --type babyundkinderprodukte --compact | jq -r 'group_by(.reason)[] | "\(.[0].reason // "?"): \(length)"'
lebensmittel warnings --type babyundkinderprodukte --since 2026-06-01 --compact
```

The per-type counts add up to 289, but the feed holds 269 warnings, because some warnings are
filed under two types (five of the baby items also count as Lebensmittel). `mittelzumtaetowieren`
came back empty, which the skill treats as a normal result. The combined reason
„Gesundheitsschädliche Substanz, Sonstige Gründe" forms its own group.

```
Current warnings by product type (lebensmittelwarnung.de, 15.09.2026)
  Lebensmittel 231 · Bedarfsgegenstände 30 · Baby- und Kinderprodukte 21 ·
  Kosmetische Mittel 7 · Mittel zum Tätowieren 0

Baby- und Kinderprodukte — 21 warnings by Grund der Meldung
  Gesundheitsschädliche Substanz                    17
  Krankheitserreger                                  2
  Rückstände und Kontaminanten                       1
  Gesundheitsschädliche Substanz, Sonstige Gründe    1

Since 01.06.2026 (2)
  • 06.08.  Stretchy Sand, Stretchmaus, Stretch Soldat — Gesundheitsschädliche Substanz
            Woolworth GmbH · Charge: „Es wird chargenunabhängig zurückgerufen." · 16 Länder
  • 30.07.  Genuss Plus Kids Fruchtchips Apfel — Krankheitserreger
            Dirk Rossmann GmbH · Chargennummer: C110862 MA · MHD 24.02.2027 · 16 Länder
Earlier in 2026: mostly toys, many of them stretch or sand toys (Stretcherz, Stretch Squad, PUFFERZ,
PhänoMINT Magischer Sand), plus Danone (Aptamil/Milumil) and Nestlé (BEBA/ALFAMINO) infant products.

Portal www.lebensmittelwarnung.de, 2026: Stretchy Sand, Stretchmaus, Stretch Soldat,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/08_August/260804_03_NW_Maus_Soldat_StretchySand/260804_03_NW_Maus_Soldat_StretchySand_Meldung.html, Stand: 15.09.2026
Portal www.lebensmittelwarnung.de, 2026: Genuss Plus Kids Fruchtchips Apfel,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/07_Juli/260730_31_NI_Apfelchips/260730_31_NI_Apfelchips_Meldung.html, Stand: 15.09.2026
```

## lebensmittelwarnung-recalls

> I bought organic cheese at a cheese counter last week. Is there a cheese recall right now?

```bash
lebensmittel warnings --search "käse" --compact    # 4 hits, title only
lebensmittel warnings --compact                    # 269 warnings; reason/manufacturer/fields scanned for käse|cheese
```

`--search` matches product titles only, so the skill also scanned every field. That found two
more warnings where cheese appears only in the product description. The feed is not limited
to fresh notices (269 entries going back to 2018), so the answer leads with the recent one and
dates the rest.

```
Yes: one recent recall matches cheese bought at a counter.

Diverse Käsesorten — Krankheitserreger                              published 10.09.2026
  Hersteller: Dorfkäserei Geifertshofen AG
  Products:   15 Bioland/Demeter cheeses, e.g. Weinbauernkäse, Wengert, St. Barbara,
              Schwäbischer Rahmkäse, Geifertshofener Pfefferkäse, Bio-Reibekäsemischung
  Packung:    verpackte Selbstbedienungs-Stücke in allen Grammaturen und lose an der Käsetheke verkaufte Ware
  Charge:     none given; the recall covers best-before dates
              up to 30.10.2026 (Weinbauernkäse, Wengert, Classico, Trollingerkäse …) and
              up to 12.11.2026 (Bühlertaler Dorfkäse, St. Barbara, Rahmkäse, Pfefferkäse …)
  Länder:     all 16
  → Compare the cheese name and best-before date with your purchase. Loose cheese from a
    counter often has no label, so ask the shop which cheese it was.

Older cheese-related warnings
  • 05.08.2026  verschiedene Yopokki Rice-Cake-Becher (incl. „Käse / Cheese") — Krankheitserreger · TJX Deutschland
  • 24.06.2026  frischer Käse, 800 Gramm — Krankheitserreger · Käse King, Apolda · Charge F22042026 · Thüringen, Sachsen
  • 23.06.2026  Chio „Dip! Hot Cheese“ mit der Etikettierung "Dip! Hot Salsa" — Allergene · Intersnack Deutschland SE
  • 28.05.2026  Pizza Ziegenkäse, 315 Gramm — Fremdkörper · Freiberger Lebensmittel GmbH · Charge L60471F, L60472F
  • 27.03.2026  Schafskäse Mediterran, Ziegenkäse mit Rotwein, je 150 Gramm — Allergene · Alimentias, SL

Portal www.lebensmittelwarnung.de, 2026: Diverse Käsesorten,
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260904_03_BW_diverse_Kaesesorten/260904_03_BW_diverse_Kaesesorten.html, Stand: 15.09.2026
```

## lebensmittelwarnung-regional

> Which recalls affect Thüringen right now? And did Thüringen issue any itself?

```bash
lebensmittel warnings --state thueringen --compact                     # 179 warnings
lebensmittel warnings --compact                                        # affectedStates scan for "Thüringen": the same 179
lebensmittel warnings --state thueringen --since 2026-08-15 --compact  # 12
```

The skill expected `--state` to return what Thüringen *published*, and the `affectedStates`
scan to add recalls issued elsewhere. Live, both returned exactly the same 179 warnings, so the
state feed is the distribution list. To answer the second question, the skill used the Land code
in each notice URL (`_TH_`), a naming convention rather than a data field.

```
Recalls affecting Thüringen — 179 in the feed, 12 published since 15.08.2026

Since 15.08.2026
  • 11.09.  Metzgerfrisch Frische Grobe Bratwurst — Fremdkörper · Lidl · MHD 15.09.2026 / 13.09.2026
  • 10.09.  Konserve BAMBOO SHOOT, diverse Sorten, 567 Gramm — Gesundheitsschädliche Substanz
  • 10.09.  Diverse Käsesorten — Krankheitserreger · Dorfkäserei Geifertshofen AG
  • 09.09.  Deluxe Erdbeeren in weißer Schokolade, 120 Gramm — Rückstände und Kontaminanten · Chargen 12 L160426-1 und 13 L160426-1
  • 04.09.  Frosty Pocket 150 Milliliter — Gesundheitsschädliche Substanz · alle Chargen
  • 04.09.  Knackwürste im Ring (Knoblauch und Kümmel) — Krankheitserreger · sold only in Thüringen
  • 31.08.  verschiedene Sorten Schinken Streichmettwurst — Krankheitserreger · Fleischwaren Wulff · Charge 631501
  • 28.08.  EDEKA Bio Wildheidelbeeren tiefgefroren, 300 Gramm — Krankheitserreger · Jütro
  … 4 more (Bio-Hühnerknochenbrühe, Chorizo, Caviarcreme, Milbona High Protein Pudding Schoko)

Issued by Thüringen (TH in the notice URL) — 4 of 179
  • 04.09.2026  Knackwürste im Ring (Knoblauch und Kümmel) — Krankheitserreger
               REWE Alexander Mudrack oHG, Eisenberg · lose Abgabe als Stück Silberclip Blau/Weiß · no Charge or MHD given
  • 24.06.2026  frischer Käse, 800 Gramm — Krankheitserreger · Käse King, Apolda · Charge F22042026
  • 29.05.2026  Butterspritzgebäck 175 Gramm — Allergene · arko I Hussel GmbH · Charge 118
  • 15.10.2025  Feine Hausmachernudeln, 250 Gramm und 500 Gramm — Krankheitserreger · MHD 29.09.2026

Portal www.lebensmittelwarnung.de, 2026: Knackwürste im Ring (Knoblauch und Kümmel),
https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260904_02_TH_Knackwurst/260904_02_TH_Knackwurst_Meldung.html, Stand: 15.09.2026
```
