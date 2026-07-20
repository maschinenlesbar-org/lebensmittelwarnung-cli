---
name: lebensmittelwarnung-regional
description: >
  Check current German product recalls for a specific federal state (Bundesland)
  using the lebensmittel CLI. Trigger when the user asks "aktuelle
  Lebensmittelwarnungen in Bayern?", "Rückrufe in NRW?", "warnings in Hamburg?",
  "gibt es in Sachsen einen Rückruf?", or names any Bundesland. Resolves the state
  name to the feed's slug, queries the state-narrowed feed, and also explains the
  difference between the publishing-state feed filter and the affected-states
  distribution list so the answer is complete.
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

## The one thing to get right: two different "states"

There are **two** notions of state, and the honest answer usually needs both:

- **`--state <slug>`** filters by the **publishing** Land's feed — the authority that
  *issued* the warning.
- **`affectedStates`** (a field on each warning) is the **distribution** list — where
  the product was actually sold, "nach derzeitigem Stand".

A recall issued by another Land can still affect the user's Land. So for "is my Land
affected?", **also** scan the unfiltered feed's `affectedStates`:

```bash
# Everything currently affecting Hamburg, whoever published it
lebensmittel warnings --compact \
  | jq -r '.[] | select(.affectedStates | index("Hamburg")) | "\(.title) — \(.reason)"'
```

Prefer this `affectedStates` scan when the user asks "does it affect <Land>?"; use
`--state` when they ask "what did <Land> warn about?".

## Traps

- **Slug, not name.** `--state Bayern` or `--state bavaria` fails (exit 2). Use
  `bayern`. Confirm with `lebensmittel states` if unsure.
- **`--state` = publisher, `affectedStates` = distribution.** Don't conflate them;
  when in doubt, run the `affectedStates` scan so you don't miss a cross-Land recall.
- **Empty `[]` is valid** — "no current recalls for that state feed", not an error.
- **Batch-specific.** Report `lotNumbers` / `bestBefore` so the user can check their
  own item, and link `.link` for the official notice.
- **Cite and don't alter** the copyright-protected warnings; direct the user to the
  live portal for the authoritative status.
