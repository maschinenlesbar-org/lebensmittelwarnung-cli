# Usage

`lebensmittel` — a CLI for the official lebensmittelwarnung.de product-warning RSS
feeds. This is the use-case-driven cookbook; for the option reference see the
**[README](README.md)**, and for domain terms the **[Glossary](GLOSSARY.md)**. No API
key is required.

```bash
lebensmittel [global options] <command>
```

## Global options

| Option | Description |
|---|---|
| `--base-url <url>` | API base URL (only `http:`/`https:` accepted; no query `?` or fragment `#`, no surrounding whitespace; a literal `%` in a password is written `%25`) |
| `--timeout <ms>` | time limit per request in ms, whole response included (0 = no timeout; at most 2147483647); it bounds each attempt, the waits between retries come on top |
| `--user-agent <ua>` | User-Agent header value (non-blank, Latin-1, no control characters; else exit `2`) |
| `--max-retries <n>` | retries for transient 429/503 responses and reset connections (0..10; each waits 200 ms × attempt, or a 429/503's `Retry-After` when that is longer, up to 30 s — a longer one is not retried and the error names the requested wait; refused connections, DNS failures and timeouts are not retried) |
| `--max-response-bytes <n>` | cap the response body size in bytes (0 = unlimited; default 100 MiB) |
| `--compact` | print JSON on a single line (for piping to `jq`) |
| `-o, --output <file>` | write output to a file instead of stdout (`-` = stdout); refuses an existing file (exit `2`, before any request) |
| `--force` | overwrite the `--output` file if it already exists (only with `-o`) |
| `-V, --version` / `-h, --help` | version / help |

## `warnings` — current product recalls

The heart of the tool: the portal's currently active warnings, each with its reason,
manufacturer, affected Länder, lot numbers and best-before dates.

```bash
lebensmittel warnings
```

```json
[
  {
    "title": "ja! Beerenmischung, tiefgefroren, 750 Gramm Beutel",
    "product": "ja! Beerenmischung, tiefgefroren, 750 Gramm Beutel",
    "link": "https://www.lebensmittelwarnung.de/.../Meldung.html",
    "pubDate": "Wed, 8 Jul 2026 16:00:00 +0200",
    "published": "2026-07-08T14:00:00.000Z",
    "reason": "Krankheitserreger",
    "manufacturer": "Eurogroup España Frutas y Verduras S.A.U., …",
    "affectedStates": ["Nordrhein-Westfalen", "Bayern", "…"],
    "lotNumbers": "L-26085",
    "bestBefore": "Mindesthaltbarkeitsdatum: 15.03.2028",
    "packaging": "750 Gramm",
    "imageUrls": ["https://www.lebensmittelwarnung.de/.../Bild.jpg?__blob=normal&v=1"],
    "images": [{ "url": "https://www.lebensmittelwarnung.de/.../Bild.jpg?__blob=normal&v=1", "credit": "© Firma …" }],
    "fields": { "…": "…" },
    "rawDescription": "<img …/><br/><b>Grund der Meldung:</b> …"
  }
]
```

```bash
# One line per recall: date (German time, from pubDate), product, reason
lebensmittel warnings | jq -r '.[] | "\(.pubDate | split(" ")[1:4] | join(" "))\t\(.title)\t\(.reason // "?")"'

# How many warnings does the portal list? (not only recent ones: the feed goes back years)
lebensmittel warnings | jq length

# Every product-photo URL
lebensmittel warnings | jq -r '.[].imageUrls[]?'

# … with the credit of each photo (a notice can have several photos with different credits;
# fields.Bildquelle joins all of them without saying which photo each belongs to)
lebensmittel warnings | jq -r '.[].images[]? | "\(.url)\t\(.credit // "")"'
```

### Narrow by federal state

```bash
lebensmittel warnings --state bayern
lebensmittel warnings --state nordrheinwestfalen | jq length
```

`--state` selects the warnings **distributed** in that Land (server-side): the ones
whose `affectedStates` list names it, whoever issued them. Run
`lebensmittel states` for the sixteen valid slugs; an unknown slug is a usage error
(exit `2`), never a silent full-feed fallback.

> The feed has no field for the **issuing** Land. The notice URL carries it as a Land
> code in the folder name (`…/260904_03_BW_diverse_Kaesesorten/…`, `BVL` for the
> federal office), a naming convention rather than data:
>
> ```bash
> lebensmittel warnings | jq -r '.[] | select(.link | test("/\\d{6,8}(_\\d+)?_BY_")) | .title'
> ```

### Narrow by product type

```bash
lebensmittel warnings --type lebensmittel          # food only
lebensmittel warnings --type kosmetischemittel     # cosmetics
lebensmittel warnings --type babyundkinderprodukte # baby & kids products
```

Run `lebensmittel types` for the five valid slugs. Each takes one value (a repeated
`--state`/`--type` is a usage error; for several states, run once per state and merge).
`--state` and `--type` compose:

```bash
lebensmittel warnings --state bayern --type lebensmittel | jq length
```

`title` is the product name. Since September 2026 the portal serves every item's
`<title>` as an unrendered template (`$esc.escapeXml($cms.oneLineText($m.title))`); the
CLI then takes `title` from the notice's *Produktbezeichnung / -beschreibung*, which is
always in `product` too.

### Narrow by date, product name, and count (client-side)

```bash
# Only recalls published on or after a date
lebensmittel warnings --since 2026-07-01

# Only recalls whose product name (title or product) contains a term
lebensmittel warnings --search schokolade | jq -r '.[].title'

# Spelling doesn't matter: käse, Kaese and KASE find the same Käse recalls
lebensmittel warnings --search kaese | jq -r '.[].title'

# The 5 most recent
lebensmittel warnings --limit 5

# Combine everything
lebensmittel warnings --type lebensmittel --since 2026-07-01 --search bio --limit 10
```

`--search` compares the product name (`title` and `product`) with case, umlaut spelling
(`ä`/`ae`/`a`), `ß`/`ss`, accents, Unicode normalisation (a decomposed `ä` pasted on
macOS) and runs of whitespace folded away, so `kaese`, `weisse` and `Erdnuss` find
"Käse", "weiße" and "Erdnüsse". It is still a substring match: another word form needs
a stem (`Tahin` finds "Tahina" and "Tahin", `Tahini` finds neither), and a term that is
only in the reason, the manufacturer or another field is not searched (filter the JSON
for those, see the recipes below).

`--since` takes a `YYYY-MM-DD` date and keeps warnings whose `pubDate` day, in
German time (Europe/Berlin), is that day or later. A `pubDate` without a time zone is
read as German time, whatever the computer's own zone is; one that isn't a date the CLI
knows (RFC 822 as the feed serves it, ISO 8601, `DD.MM.YYYY HH:MM`) leaves that warning
out of `--since` with a note on stderr (`Note: --since left out 1 warning whose pubDate
could not be read …`), never silently.

> **`pubDate` is not always the first publication.** The portal re-stamps a notice when
> it is updated: on 2026-09-26, 45 of 265 `pubDate`s were more than three days after the
> notice date in the URL's folder name (`…/260616_11_BE_Austern_Meldung.html` = filed
> 16 June 2026, `pubDate` 18 Sep), one of them years later. So `--since` also returns old
> notices that were updated in the window ("new or updated"), and can leave out a notice
> whose `pubDate` is earlier than its folder date. When "first published" matters, take
> the date from the folder name — `YYMMDD_` (`260616_…`) or, for some notices,
> `YYYYMMDD_` (`20260701_01_ST_…`); a naming convention rather than data. Filter the
> whole feed, not a `--since` window, and keep a notice whose folder has no date (shown
> as `????????`) rather than dropping it:
>
> ```bash
> lebensmittel warnings --compact \
>   | jq -r '.[] | ([(.link // "") | capture("/(?<d>\\d{8}|\\d{6})_")][0].d // "") as $d
>       | (if ($d | length) == 6 then "20" + $d else $d end) as $filed
>       | select($filed == "" or $filed >= "20260915")
>       | "\(if $filed == "" then "????????" else $filed end)\t\(.title)"'
> ```

A malformed `--since` date (`2026-13-40`, `10.07.2026`) is a usage error (exit `2`).

`published` is the same instant in UTC, so its first ten characters give the day
before for notices published in the first one or two hours after midnight German
time (many are stamped `00:00:00 +0200`). For a date to show, take it from `pubDate`, which is in
German time: `.pubDate | split(" ")[1:4] | join(" ")` gives `4 Sep 2026`.
`--search`/`--since` that match nothing return `[]` (not the full feed).

## `states` — the valid Bundesland slugs

```bash
lebensmittel states
```

```json
[
  { "slug": "badenwuerttemberg", "name": "Baden-Württemberg" },
  { "slug": "bayern", "name": "Bayern" }
]
```

Offline (no request). Use it to discover the exact `--state` slugs:

```bash
lebensmittel states | jq -r '.[].slug'
```

## `types` — the valid product-type slugs

```bash
lebensmittel types
```

```json
[
  { "slug": "lebensmittel", "name": "Lebensmittel" },
  { "slug": "kosmetischemittel", "name": "Kosmetische Mittel" }
]
```

Offline (no request).

## Recipes

```bash
# Reasons across all listed warnings, counted (a warning can carry several, joined with ", ")
lebensmittel warnings | jq -r '[.[] | (.reason // "?") | split(", ")[]] | group_by(.)[] | "\(.[0]): \(length)"'

# A daily "anything new or updated in Bavaria?" check (exit 0 with rows, or empty;
# pubDate also moves when a notice is updated, see --since above)
lebensmittel warnings --state bayern --since "$(date -v-1d +%F 2>/dev/null || date -d yesterday +%F)" \
  | jq -r '.[] | "\(.title) — \(.reason)"'

# Look up a specific batch across all recalls
lebensmittel warnings | jq -r --arg lot "L-26085" \
  '.[] | select(.lotNumbers // "" | test($lot)) | .title'

# Save today's full snapshot to a file (--force replaces an earlier run's file)
lebensmittel warnings -o warnings-$(date +%F).json --force
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (also `--help` / `--version`) |
| `2` | Bad usage / invalid argument (unknown `--state`/`--type`, bad `--since`/`--limit`, an existing `-o` file without `--force`) |
| `4` | Not found (`404`) |
| `6` | Network / transport failure (DNS, connection, timeout, size cap) |
| `1` | Any other error — non-RSS HTML shell, empty body, or a `3xx` redirect |

## Notes

- **Attribution required.** The warnings are copyright-protected; if you republish
  any of them, do so unaltered, in full, and with the prescribed citation. See
  [DATA_LICENSE.md](DATA_LICENSE.md).
- **Feed freshness.** The channel advertises `ttl 60` (minutes). The data is live and
  changes without notice; a warning can be withdrawn upstream.
