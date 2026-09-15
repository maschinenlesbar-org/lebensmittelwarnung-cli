---
name: lebensmittelwarnung-regional
description: >
  Check current German product recalls for a specific federal state (Bundesland)
  using the lebensmittel CLI. Trigger when the user asks "aktuelle
  Lebensmittelwarnungen in Bayern?", "Rückrufe in NRW?", "warnings in Hamburg?",
  "gibt es in Sachsen einen Rückruf?", or names any Bundesland. Resolves the state
  name to the feed's slug, queries the state-narrowed feed (every recall
  distributed in that Land, whoever issued it), and shows how to tell which Land
  issued a warning when the user asks for that.
version: 1.0.0
userInvocable: true
---

# Lebensmittelwarnung — regional recalls

Answer "what's being recalled in <Bundesland>?" — mapping the state **name** the user
gave to the feed's `--state` **slug**, fetching that state's feed, and reporting the
recalls clearly.

## Tooling

This skill drives the `lebensmittel` command. **Before anything else, validate it is available** — run `command -v lebensmittel` (or `lebensmittel --version`). If it is not on your PATH, STOP and inform the user that the `lebensmittel` CLI (`@maschinenlesbar.org/lebensmittelwarnung-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

**No API key is required** — the feeds are public. The data comes from the RSS feeds; the legacy JSON API is defunct. The warnings are **copyright-protected**: when you quote one, cite it in the prescribed form — `Portal www.lebensmittelwarnung.de, [Jahr]: [Produkttitel], [URL], Stand: [Datum]` — reproduce it unaltered, and never present it mixed with other sources. See DATA_LICENSE.md. Use `--compact` when piping to `jq`.

## Step 1 — resolve the state name → slug

`--state` takes a lowercase slug (no spaces/umlauts), not a display name. Map the
user's wording using this table (or run `lebensmittel states` for the authoritative
list):

| Slug | Bundesland | also said |
|---|---|---|
| `badenwuerttemberg` | Baden-Württemberg | BW, Ländle |
| `bayern` | Bayern | BY, Bavaria, München |
| `berlin` | Berlin | BE |
| `brandenburg` | Brandenburg | BB |
| `bremen` | Bremen | HB |
| `hamburg` | Hamburg | HH |
| `hessen` | Hessen | HE |
| `mecklenburgvorpommern` | Mecklenburg-Vorpommern | MV, Meck-Pomm |
| `niedersachsen` | Niedersachsen | NI, Lower Saxony |
| `nordrheinwestfalen` | Nordrhein-Westfalen | NRW, NW |
| `rheinlandpfalz` | Rheinland-Pfalz | RLP, RP |
| `saarland` | Saarland | SL |
| `sachsen` | Sachsen | SN, Saxony |
| `sachsenanhalt` | Sachsen-Anhalt | ST |
| `schleswigholstein` | Schleswig-Holstein | SH |
| `thueringen` | Thüringen | TH, Thuringia |

An unknown slug is a **usage error (exit 2)** — the CLI never silently falls back to
the full feed, so a typo is caught, not hidden.

## Step 2 — fetch the state feed

```bash
lebensmittel warnings --state bayern --compact \
  | jq -r '.[] | "\(.published[:10])  \(.title) — \(.reason // "?")"'

# recent only
lebensmittel warnings --state nordrheinwestfalen --since 2026-07-01 --compact
```

Combine with `--type` (food only, cosmetics only, …) or `--limit` as needed.

## The one thing to get right: the state feed is the distribution list

**`--state <slug>`** returns the warnings whose **`affectedStates`** (*Betroffene
Bundesländer nach derzeitigem Stand*, where the product was sold) include that Land —
**whoever issued them**. On 2026-09-15, `--state thueringen` returned exactly the
warnings of the unfiltered feed that list „Thüringen" in `affectedStates` (the same
held for Hamburg and Bremen), and only 4 of those 179 were issued by Thüringen. Many
recalls list all 16 Länder, so a state feed is mostly nationwide recalls.

- **"Rückrufe in Sachsen?" / "betrifft das Hamburg?"** → `--state` answers it
  directly. There's no need to scan `affectedStates` on top.
- **"What did Thüringen itself warn about?"** → no filter or field gives the issuing
  authority. It shows only in the notice URL, as a Land code in the folder name
  (`…/260904_03_BW_diverse_Kaesesorten/…`, `BVL` for the federal office). That's a
  naming convention, not data, so say you derived it from the URL:

```bash
# Warnings issued by Thüringen (TH), judged by the Land code in the notice URL
lebensmittel warnings --compact \
  | jq -r '.[] | select(.link | test("/\\d{6,8}(_\\d+)?_TH_")) | "\(.title) — \(.reason // "?")"'
```

Codes are the usual Land abbreviations (`BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH
TH`) plus `BVL`.

## Traps

- **Slug, not name.** `--state Bayern` or `--state bavaria` fails (exit 2). Use
  `bayern`. Confirm with `lebensmittel states` if unsure.
- **`--state` = distribution, not publisher.** Don't present a state feed as "what
  <Land> warned about". Most items were issued by other Länder; use the URL code
  above for the issuer.
- **Empty `[]` is valid** — "no current recalls for that state feed", not an error.
- **Batch-specific.** Report `lotNumbers` / `bestBefore` so the user can check their
  own item, and link `.link` for the official notice.
- **Cite and don't alter** the copyright-protected warnings; direct the user to the
  live portal for the authoritative status.
