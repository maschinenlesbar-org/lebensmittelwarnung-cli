# Glossary

Domain and technical terms you meet when using `lebensmittel`. For the option
reference see the **[README](README.md)** and the full cookbook in
**[Usage.md](Usage.md)**.

## The portal

**lebensmittelwarnung.de.** Germany's official portal for public product warnings,
run by the **Bundesamt für Verbraucherschutz und Lebensmittelsicherheit (BVL)**
together with the sixteen **Länder**. Each Land's competent authority publishes its
own warnings; the BVL operates the portal and app. It is the single national place
where food and consumer-product recalls are announced to the public.

**BVL — Bundesamt für Verbraucherschutz und Lebensmittelsicherheit.** The federal
agency that operates the portal and is the responsible publisher for warnings marked
as covering "Deutschland" (nationwide).

## Warnings

**Warnung / Rückruf (`warnings`).** A public product warning — usually a **recall**:
a notice that a specific product (by name, batch and best-before) may pose a risk and
should not be consumed/used. In this CLI each warning is one item of the RSS feed.

**Produktbezeichnung / -beschreibung (`product`, `title`).** The product name as the
notice body gives it, e.g. "KIMCHI 300 Gramm". `title` is normally the feed item's own
`<title>`; since September 2026 the portal serves every `<title>` as the unrendered
template `$esc.escapeXml($cms.oneLineText($m.title))`, so the CLI then takes `title`
from this field. `--search` matches both.

**Grund der Meldung (`reason`).** The reason the warning was issued, as a category
label. On 2026-09-15 the live feed used seven: *Allergene* (allergens), *Fremdkörper*
(foreign body), *Gesundheitsschädliche Substanz* (harmful substance), *Irreführung und
Täuschung* (misleading labelling), *Krankheitserreger* (pathogens such as Listeria or
Salmonella, which the feed doesn't name), *Rückstände und Kontaminanten* (residues and
contaminants) and *Sonstige Gründe* (other). A warning can carry several, joined with
`, `. The single most useful field for triage.

**Hersteller / Inverkehrbringer (`manufacturer`).** The manufacturer or the party
that placed the product on the market. The feed embeds the full postal address; this
CLI collapses it to one line.

**Betroffene Bundesländer nach derzeitigem Stand (`affectedStates`).** The list of
Länder where the product was distributed **as currently known** — it is updated over
time, and a Land can add or remove itself after publication. Surfaced as a
`string[]`. The `--state` feed filter selects by this list: a state feed holds the
warnings whose `affectedStates` name that Land, whoever issued them.

**Chargennummer / Los-Kennzeichnung (`lotNumbers`).** The batch / lot identifiers of
the affected units — the codes on the packaging that tell you whether *your* item is
in scope.

**Haltbarkeit (`bestBefore`).** Durability information — a best-before
(*Mindesthaltbarkeitsdatum*, MHD) or use-by date, again for matching your unit.

**Verpackungseinheit (`packaging`).** The packaging unit / size, e.g.
"175 Gramm-Packung".

**Bildquelle.** The image credit for a product photo (© the manufacturer or an
agency). The notice gives one per photo, and they can differ (on 2026-09-26, 6 of 265
warnings had photos from different sources). `images` pairs each photo URL with its own
credit; the generic `fields` map holds only the last one. The **images themselves**
(`imageUrls`, `images`) are copyright-protected — see [DATA_LICENSE.md](DATA_LICENSE.md).

## Product types (`--type` / `types`)

The `type=` feed filter accepts five product-category slugs:

| Slug | German | What it covers |
|---|---|---|
| `lebensmittel` | Lebensmittel | Food and drink (the bulk of warnings) |
| `kosmetischemittel` | Kosmetische Mittel | Cosmetics |
| `bedarfsgegenstaende` | Bedarfsgegenstände | Consumer goods in food contact / everyday use (packaging, kitchenware, textiles, …) |
| `mittelzumtaetowieren` | Mittel zum Tätowieren | Tattoo inks / agents |
| `babyundkinderprodukte` | Baby- und Kinderprodukte | Baby and children's products |

## Federal states (`--state` / `states`)

The `state=` feed filter accepts sixteen Bundesland slugs (lowercase, no spaces or
umlauts). Run `lebensmittel states` for the authoritative list; the mapping is:

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

> **`--state` filters by the `affectedStates` distribution list**, not by the Land
> that issued the warning. On 2026-09-15 `--state thueringen` returned exactly the
> warnings listing „Thüringen" in `affectedStates`, and only 4 of those 179 were
> issued by Thüringen. The feed has no issuer field; the notice URL carries the
> issuing Land as a code in its folder name (see [Usage.md](Usage.md)).

## Technical terms

**RSS 2.0.** The XML feed format the portal publishes. Each warning is an `<item>`
with `<title>`, `<link>`, `<pubDate>` and an HTML `<description>` (in a CDATA
section). This CLI parses it with a hand-rolled, dependency-free parser.

**pubDate / published.** `pubDate` is the RFC-822 timestamp as served, in German
time ("Wed, 8 Jul 2026 16:00:00 +0200"); `published` is that value normalised to an
ISO-8601 UTC string. `--since` filters on it but compares calendar days in German
time (Europe/Berlin): a notice stamped `00:00:00 +0200` counts for its own day,
although the date part of `published` is the day before. `pubDate` is often the time
of the **last update** rather than of first publication (on 2026-09-26, 45 of 265 were
more than three days after the notice date in the URL's `YYMMDD_` folder name), so
`--since` means "published or updated since".

**fields (label→value map).** The complete set of `<b>Label:</b> value` pairs parsed
from the description, keyed by the German label (trailing colon stripped). A superset
of the typed accessors — anything the CLI doesn't model first-class is still here.

**Legacy JSON API (defunct).** The old `megov.bayern.de` JSON API (documented in the
bundesAPI / bund.dev project) that used to serve this data. It has returned an empty
body since the portal relaunch and is **not** used — this CLI wraps the RSS feeds.
See [DEVELOPING.md](DEVELOPING.md).
