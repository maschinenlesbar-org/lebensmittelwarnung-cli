# Glossar

Fach- und technische Begriffe, denen Sie bei der Arbeit mit `lebensmittel` begegnen. Die
Optionsreferenz finden Sie in der **[README](README.md)**, das vollständige Kochbuch in
**[Usage.md](Usage.md)**.

## Das Portal

**lebensmittelwarnung.de.** Das amtliche Portal Deutschlands für öffentliche Produktwarnungen,
betrieben vom **Bundesamt für Verbraucherschutz und Lebensmittelsicherheit (BVL)** gemeinsam mit
den sechzehn **Ländern**. Die zuständige Behörde jedes Landes veröffentlicht ihre eigenen
Warnungen; das BVL betreibt Portal und App. Es ist die zentrale bundesweite Stelle, an der Rückrufe
von Lebensmitteln und Verbraucherprodukten öffentlich bekannt gemacht werden.

**BVL – Bundesamt für Verbraucherschutz und Lebensmittelsicherheit.** Die Bundesbehörde, die das
Portal betreibt und als Herausgeber für Warnungen mit dem Geltungsbereich „Deutschland“
(bundesweit) verantwortlich ist.

## Warnungen

**Warnung / Rückruf (`warnings`).** Eine öffentliche Produktwarnung – meist ein **Rückruf**: der
Hinweis, dass ein bestimmtes Produkt (nach Name, Charge und Mindesthaltbarkeit) ein Risiko
darstellen kann und nicht verzehrt bzw. verwendet werden sollte. In dieser CLI ist jede Warnung
ein Eintrag des RSS-Feeds.

**Produktbezeichnung / -beschreibung (`product`, `title`).** Der Produktname, wie ihn die
Meldung selbst angibt, z. B. „KIMCHI 300 Gramm“. `title` ist normalerweise der `<title>` des
Feed-Eintrags; im September 2026 lieferte das Portal jeden `<title>` als nicht ausgewertete
Vorlage `$esc.escapeXml($cms.oneLineText($m.title))` (am 05.10.2026 waren die echten Namen
zurück), und wenn es eine liefert, übernimmt die CLI `title` aus diesem Feld. `--search` (in der Bibliothek die Option `search`) durchsucht beide und
ignoriert dabei Groß-/Kleinschreibung, die Schreibung der Umlaute (`Käse`/`Kaese`/`Kase`),
`ß`/`ss` und Akzente; es sucht eine Zeichenfolge, also nach dem Wortstamm suchen (`Tahin`
für *Tahini*/*Tahina*).

**Grund der Meldung (`reason`).** Der Grund, aus dem die Warnung herausgegeben wurde, als
Kategorie. Am 15.09.2026 verwendete der Live-Feed sieben: *Allergene*, *Fremdkörper*,
*Gesundheitsschädliche Substanz*, *Irreführung und Täuschung*, *Krankheitserreger* (etwa
Listerien oder Salmonellen, die der Feed nicht nennt), *Rückstände und Kontaminanten* und
*Sonstige Gründe*. Eine Warnung kann mehrere tragen, verbunden mit `, `. Das nützlichste Feld
für eine erste Einordnung.

**Hersteller / Inverkehrbringer (`manufacturer`).** Der Hersteller oder derjenige, der das Produkt
in Verkehr gebracht hat. Der Feed enthält die vollständige Postanschrift über mehrere Zeilen;
diese CLI behält die Zeilenumbrüche (`\n`).

**Betroffene Bundesländer nach derzeitigem Stand (`affectedStates`).** Die Liste der Länder, in
denen das Produkt **nach derzeitigem Kenntnisstand** vertrieben wurde – sie wird im Lauf der Zeit
aktualisiert, und ein Land kann sich nach der Veröffentlichung selbst hinzufügen oder austragen.
Bereitgestellt als `string[]`. Der Feed-Filter `--state` wählt nach dieser Liste aus: Der Feed
eines Landes enthält die Warnungen, deren `affectedStates` dieses Land nennen – gleich, wer sie
herausgegeben hat.

**Chargennummer / Los-Kennzeichnung (`lotNumbers`).** Die Chargen- bzw. Loskennungen der
betroffenen Einheiten – die Codes auf der Verpackung, an denen Sie erkennen, ob *Ihr* Exemplar
betroffen ist. Eine Meldung zu mehreren Produkten oder Chargen nennt oft eine pro Zeile; die
Zeilenumbrüche bleiben erhalten (`\n`).

**Haltbarkeit (`bestBefore`).** Angaben zur Haltbarkeit – ein *Mindesthaltbarkeitsdatum* (MHD)
oder ein Verbrauchsdatum, ebenfalls zum Abgleich mit Ihrem Exemplar.

**Verpackungseinheit (`packaging`).** Die Verpackungseinheit bzw. -größe, z. B.
„175 Gramm-Packung“.

**Bildquelle.** Der Bildnachweis für ein Produktfoto (© beim Hersteller oder einer Agentur). Die
Meldung nennt ihn je Foto, und die Nachweise können sich unterscheiden (am 26.09.2026 hatten 6 von
265 Warnungen Fotos aus verschiedenen Quellen). `images` ordnet jeder Foto-URL ihren eigenen
Nachweis zu; die allgemeine Map `fields` verbindet die verschiedenen Nachweise mit `; `, ohne zu
sagen, zu welchem Foto welcher gehört. Die **Bilder selbst**
(`imageUrls`, `images`) sind urheberrechtlich geschützt – siehe [DATA_LICENSE.md](DATA_LICENSE.md).

## Produkttypen (`--type` / `types`)

Der Feed-Filter `type=` akzeptiert fünf Slugs für Produktkategorien:

| Slug | Bezeichnung | Umfang |
|---|---|---|
| `lebensmittel` | Lebensmittel | Lebensmittel und Getränke (der Großteil der Warnungen) |
| `kosmetischemittel` | Kosmetische Mittel | Kosmetik |
| `bedarfsgegenstaende` | Bedarfsgegenstände | Gegenstände mit Lebensmittelkontakt oder für den täglichen Gebrauch (Verpackungen, Küchenutensilien, Textilien, …) |
| `mittelzumtaetowieren` | Mittel zum Tätowieren | Tätowierfarben / -mittel |
| `babyundkinderprodukte` | Baby- und Kinderprodukte | Produkte für Babys und Kinder |

## Bundesländer (`--state` / `states`)

Der Feed-Filter `state=` akzeptiert sechzehn Slugs für die Bundesländer (kleingeschrieben, ohne
Leerzeichen und Umlaute). Die maßgebliche Liste liefert `lebensmittel states`; die Zuordnung
lautet:

| Slug | Bundesland |
|---|---|
| `badenwuerttemberg` | Baden-Württemberg |
| `bayern` | Bayern |
| `berlin` | Berlin |
| `brandenburg` | Brandenburg |
| `bremen` | Bremen |
| `hamburg` | Hamburg |
| `hessen` | Hessen |
| `mecklenburgvorpommern` | Mecklenburg-Vorpommern |
| `niedersachsen` | Niedersachsen |
| `nordrheinwestfalen` | Nordrhein-Westfalen |
| `rheinlandpfalz` | Rheinland-Pfalz |
| `saarland` | Saarland |
| `sachsen` | Sachsen |
| `sachsenanhalt` | Sachsen-Anhalt |
| `schleswigholstein` | Schleswig-Holstein |
| `thueringen` | Thüringen |

> **`--state` filtert nach der Vertriebsliste `affectedStates`**, nicht nach dem Land, das die
> Warnung herausgegeben hat. Am 15.09.2026 lieferte `--state thueringen` genau die Warnungen, die
> „Thüringen“ in `affectedStates` nennen, und nur 4 dieser 179 stammten aus Thüringen. Ein Feld für
> die herausgebende Stelle hat der Feed nicht; die URL der Meldung enthält das herausgebende Land als
> Kürzel im Ordnernamen (siehe [Usage.md](Usage.md)).

## Technische Begriffe

**RSS 2.0.** Das XML-Feedformat, das das Portal veröffentlicht. Jede Warnung ist ein `<item>`
mit `<title>`, `<link>`, `<pubDate>` und einer HTML-`<description>` (in einem
CDATA-Abschnitt). Diese CLI liest es mit einem selbst geschriebenen Parser ohne Abhängigkeiten.

**pubDate / published.** `pubDate` ist der RFC-822-Zeitstempel, wie er geliefert wird, in
deutscher Zeit („Wed, 8 Jul 2026 16:00:00 +0200“); `published` ist derselbe Wert, normalisiert
zu einem ISO-8601-String in UTC. `--since` (in der Bibliothek die Option `since`) filtert
darauf, vergleicht aber Kalendertage in deutscher Zeit (Europe/Berlin): Eine Meldung mit dem
Zeitstempel `00:00:00 +0200` zählt für ihren eigenen Tag, obwohl der Datumsteil von `published` der Vortag ist. `pubDate` ist oft der
Zeitpunkt der **letzten Aktualisierung** und nicht der Erstveröffentlichung (am 26.09.2026 lagen
45 von 265 mehr als drei Tage nach dem Meldungsdatum im Ordnernamen der URL, `JJMMTT_` oder bei
einigen Meldungen `JJJJMMTT_`), daher
bedeutet `--since` „veröffentlicht oder aktualisiert seit“.

**fields (Map Bezeichnung→Wert).** Die vollständige Menge der Paare `<b>Label:</b> value`, die
aus der Beschreibung gelesen werden, mit der deutschen Bezeichnung als Schlüssel (abschließender
Doppelpunkt entfernt). Eine Obermenge der typisierten Accessoren – alles, was die CLI nicht eigens
modelliert, steht trotzdem hier.

**Log-Eintrag (log record).** Jede Diagnosezeile, die die CLI nach stderr schreibt: ein
Zeitstempel, eine Stufe (`ERROR`, `WARN`, `INFO`) und ein Thema `lebensmittel.<Bereich>`, als
Text (im Stil von log4j) oder mit `--log-format jsonl` als ein JSON-Objekt pro Zeile. Die
Bereiche: `cli` (Bedienfehler, Meldungen von commander, unerwartete Fehler, Nodes eigene Prozesswarnungen), `api` (die
Antworten des Feeds und die Hinweise dazu: ein Fehlerstatus, der Hinweis bei einer
Weiterleitung (3xx), eine fehlerhafte Antwort – die HTML-Seite des Portals, ein leerer Body,
kein RSS –, die Warnung zu fehlenden Bezeichnungen, der Hinweis zu `--since`), `http` (die
Verbindung, der Hinweis zur Größengrenze, die Klartext-Warnung, je Wiederholung eine WARN-Zeile vor dem Warten) und `output` (die `-o`-Datei
und ein Schreibfehler auf stdout). Ein Eintrag ist immer eine Zeile; Steuerzeichen darin
werden maskiert.

**Alte JSON-API (außer Betrieb).** Die frühere JSON-API unter `megov.bayern.de` (dokumentiert im
Projekt bundesAPI / bund.dev), die diese Daten früher lieferte. Seit dem Relaunch des Portals
liefert sie einen leeren Body und wird **nicht** verwendet – diese CLI bindet die RSS-Feeds ein.
Siehe [DEVELOPING.md](DEVELOPING.md).
