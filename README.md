# lebensmittelwarnung-cli

[![CI](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli/actions/workflows/ci.yml)
[![Release](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli/actions/workflows/release.yml/badge.svg)](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@maschinenlesbar.org/lebensmittelwarnung-cli)](https://www.npmjs.com/package/@maschinenlesbar.org/lebensmittelwarnung-cli)

**Website:** [English](https://maschinenlesbar-org.github.io/lebensmittelwarnung-cli/) · [Deutsch](https://maschinenlesbar-org.github.io/lebensmittelwarnung-cli/de/) — command reference, guides and API docs

Check Germany's official **product-warning portal**
([lebensmittelwarnung.de](https://www.lebensmittelwarnung.de)) from your terminal.
`lebensmittel` is a command-line tool over the portal's official **RSS feeds** — the
current recalls (*Rückrufe*) for food, cosmetics, and consumer products, narrowable
by federal state and product type, as clean JSON you can pipe straight into
[`jq`](https://jqlang.github.io/jq/).

- **Current recalls** — every active warning with its reason (*Grund der Meldung*),
  manufacturer, affected Bundesländer, batch/lot numbers and best-before dates.
- **Filter by state and type** — `--state bayern`, `--type lebensmittel`, combined
  or alone; both are applied server-side by the feed.
- **Client-side narrowing** — `--since <date>`, `--search <term>`, `--limit <n>`.
- **No API key** — the feeds are public.
- **Clean JSON output** — pretty by default, `--compact` for scripting, `-o <file>`
  to write to disk.

> Want to use this as a TypeScript library, or curious how it parses the RSS feeds
> with zero dependencies? See **[DEVELOPING.md](DEVELOPING.md)**.

## Install

```bash
npm i -g @maschinenlesbar.org/lebensmittelwarnung-cli
```

This installs the **`lebensmittel`** command. Requires **Node.js 20+**. No API key.

Check it works:

```bash
lebensmittel warnings --limit 1 | jq '.[0].title'
```

## Quickstart

```bash
# The 5 most recent recalls, product name + reason
lebensmittel warnings --limit 5 | jq -r '.[] | "\(.title) — \(.reason // "?")"'

# Only recalls affecting Bavaria
lebensmittel warnings --state bayern | jq length

# Only food recalls since the start of the month
lebensmittel warnings --type lebensmittel --since 2026-07-01 \
  | jq -r '.[] | "\(.pubDate | split(" ")[1:4] | join(" "))\t\(.title)"'

# Search current recalls by product name
lebensmittel warnings --search schokolade | jq -r '.[].title'
```

## Commands

| Command | What it shows |
| --- | --- |
| `warnings` | Current product warnings (recalls), filterable by `--state` / `--type` / `--since` / `--search` / `--limit` |
| `states` | The valid `--state` Bundesland slugs (offline) |
| `types` | The valid `--type` product-type slugs (offline) |

New to terms like *Rückruf*, *Grund der Meldung* or the Bundesland slugs? The
**[Glossary](GLOSSARY.md)** decodes every one.

### `warnings` options

| Option | Meaning |
| --- | --- |
| `--state <slug>` | Only warnings for one Bundesland — server-side filter. One of the 16 slugs from `lebensmittel states` (e.g. `bayern`, `nordrheinwestfalen`). An unknown slug is a usage error. |
| `--type <slug>` | Only warnings for one product type — server-side filter. One of `lebensmittel`, `kosmetischemittel`, `bedarfsgegenstaende`, `mittelzumtaetowieren`, `babyundkinderprodukte`. |
| `--since <YYYY-MM-DD>` | Only warnings published on or after this date, counted in German time (Europe/Berlin), client-side. |
| `--search <term>` | Only warnings whose **product name** (`title` or `product`) contains this text, case-insensitive (client-side). |
| `--limit <n>` | Return at most `n` warnings, in feed order (most recent first). |

`--state` and `--type` are validated against the fixed slug lists, so a typo fails
at parse time (exit `2`) rather than silently returning the full, unfiltered feed.

## What a warning looks like

Each item carries typed accessors plus a generic `fields` map and the raw HTML:

```jsonc
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
  "fields": { "Bildquelle": "© Firma …", "Grund der Meldung": "Krankheitserreger", "…": "…" },
  "rawDescription": "<img …/><br/><b>Grund der Meldung:</b> …"
}
```

`title` is the product name. The portal currently serves every item's `<title>` as an
unrendered template (`$esc.escapeXml(…)`, since September 2026); the CLI then fills
`title` from the notice's *Produktbezeichnung / -beschreibung*, which is also `product`.

The typed fields are extracted from the feed's HTML `<description>`; `fields` is the
complete label→value map (a superset, so a label this CLI does not model first-class
is still there), and `rawDescription` keeps the original markup.

## Output & scripting

Every command prints **JSON to stdout**; diagnostics go to stderr, so piping into
`jq` stays clean.

```bash
# Reasons, grouped and counted (a warning can carry several, joined with ", ")
lebensmittel warnings | jq -r '[.[] | (.reason // "?") | split(", ")[]] | group_by(.)[] | "\(.[0]): \(length)"'

# Recalls affecting a given Land (the same set --state hamburg returns)
lebensmittel warnings | jq -r '.[] | select(.affectedStates | index("Hamburg")) | .title'

# All image URLs in the current recalls, each with its own credit (Bildquelle)
lebensmittel warnings | jq -r '.[].images[]? | "\(.url)\t\(.credit // "")"'
```

Use `--compact` for single-line JSON and `-o <file>` to write to a file — both are
**global options** that work before or after the command.

**Exit codes** make the CLI easy to use in scripts:

| Code | Meaning |
| --- | --- |
| `0` | Success (also `--help` / `--version`) |
| `2` | Bad usage / invalid argument (nothing was sent) |
| `4` | Not found (`404` from the server) |
| `6` | Network / transport failure (DNS, connection, timeout, size cap) |
| `1` | Any other error — including a non-RSS response (HTML shell) or an empty body |

## Troubleshooting

- **`command not found: lebensmittel`** — the global npm bin directory isn't on your
  `PATH`. Run `npm bin -g` to find it and add it.
- **Exit `1` / "received an HTML page"** — the feed URL returned the website's HTML
  shell instead of RSS (it may have moved). Check `--base-url`.
- **Exit `1` / "Empty response … legacy JSON API"** — the old
  `megov.bayern.de` JSON API (bundesAPI spec) is **defunct** and returns an empty
  body; this CLI uses the RSS feeds instead and does not touch it. If you see this,
  a proxy or a wrong `--base-url` returned an empty body.
- **A filter returned everything** — it didn't: `--state`/`--type` are validated, so
  an unknown value exits `2`. `--search`/`--since` that match nothing return `[]`.

## Global options

Given **before or after** the command, e.g. `lebensmittel --compact warnings`:

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version number |
| `-h, --help` | Show help for the program or a command |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `-o, --output <file>` | Write output to this file instead of stdout |
| `--base-url <url>` | API base URL (default `https://www.lebensmittelwarnung.de`) |
| `--timeout <ms>` | Time limit per request, reading the whole response included (default `30000`; `0` = none; at most `2147483647`) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (0..10, default `2`). Each waits the server's `Retry-After` (seconds or HTTP-date), else 200 ms × attempt; a `Retry-After` above 30 s is not retried, the error is reported at once |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |

## Learn more

- **[SKILLS.md](SKILLS.md)** — Claude Code Agent Skills that drive this CLI.
- **[Usage.md](Usage.md)** — full use-case-driven cookbook.
- **[GLOSSARY.md](GLOSSARY.md)** — every domain term explained.
- **[DEVELOPING.md](DEVELOPING.md)** — TypeScript library usage, the RSS parser, architecture, testing, CI.

## Data license

This CLI is a **client** — it accesses data it does not own or redistribute. The
warnings are © the publishing Länder / the BVL and licensed **separately from this
tool's code**. See **[DATA_LICENSE.md](DATA_LICENSE.md)**.

> **lebensmittelwarnung.de** — the portal's content is **copyright-protected**.
> Reuse is allowed **only unaltered, in full, and with the prescribed source
> citation** (`Portal www.lebensmittelwarnung.de, [Jahr]: [Titel], [URL], Stand:
> [Datum]`); partial/excerpted use and mixing with other sources are **not**
> permitted, and once a warning is withdrawn upstream you must delete your copy.
> This tool provides access; it does not grant you those rights — read
> [DATA_LICENSE.md](DATA_LICENSE.md).

## License

**Dual-licensed** — use it under **either**:

- **[AGPL-3.0-or-later](LICENSE)** (default, free). Note the AGPL's §13 network
  clause: if you run a modified version as a network service, you must offer that
  modified source to the service's users.
- **Commercial license** (paid), for closed-source / proprietary or SaaS use
  without the AGPL's obligations.

See **[LICENSING.md](LICENSING.md)** for details, and **[CONTRIBUTING.md](CONTRIBUTING.md)**
for the contribution policy (this project does not accept external code
contributions). Commercial enquiries: **sebs@2xs.org**.
