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
| `--base-url <url>` | API base URL (only `http:`/`https:` accepted) |
| `--timeout <ms>` | time limit per request in ms, whole response included (0 = no timeout; at most 2147483647) |
| `--user-agent <ua>` | User-Agent header value |
| `--max-retries <n>` | retries for transient 429/503 responses (0..10) |
| `--max-response-bytes <n>` | cap the response body size in bytes (0 = unlimited; default 100 MiB) |
| `--compact` | print JSON on a single line (for piping to `jq`) |
| `-o, --output <file>` | write output to a file instead of stdout |
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

Run `lebensmittel types` for the five valid slugs. `--state` and `--type` compose:

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

# Only recalls whose product name (title or product) contains a term (case-insensitive)
lebensmittel warnings --search schokolade | jq -r '.[].title'

# The 5 most recent
lebensmittel warnings --limit 5

# Combine everything
lebensmittel warnings --type lebensmittel --since 2026-07-01 --search bio --limit 10
```

`--since` takes a `YYYY-MM-DD` date and keeps warnings whose publication day, in
German time (Europe/Berlin), is that day or later. A malformed date (`2026-13-40`,
`10.07.2026`) is a usage error (exit `2`).

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

# A daily "anything new in Bavaria?" check (exit 0 with rows, or empty)
lebensmittel warnings --state bayern --since "$(date -v-1d +%F 2>/dev/null || date -d yesterday +%F)" \
  | jq -r '.[] | "\(.title) — \(.reason)"'

# Look up a specific batch across all recalls
lebensmittel warnings | jq -r --arg lot "L-26085" \
  '.[] | select(.lotNumbers // "" | test($lot)) | .title'

# Save today's full snapshot to a file
lebensmittel warnings -o warnings-$(date +%F).json
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (also `--help` / `--version`) |
| `2` | Bad usage / invalid argument (unknown `--state`/`--type`, bad `--since`/`--limit`) |
| `4` | Not found (`404`) |
| `6` | Network / transport failure (DNS, connection, timeout, size cap) |
| `1` | Any other error — non-RSS HTML shell, empty body, or a `3xx` redirect |

## Notes

- **Attribution required.** The warnings are copyright-protected; if you republish
  any of them, do so unaltered, in full, and with the prescribed citation. See
  [DATA_LICENSE.md](DATA_LICENSE.md).
- **Feed freshness.** The channel advertises `ttl 60` (minutes). The data is live and
  changes without notice; a warning can be withdrawn upstream.
