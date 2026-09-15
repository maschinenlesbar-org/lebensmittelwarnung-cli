---
name: lebensmittelwarnung-recalls
description: >
  Look up current German product recalls (Rückrufe) from the official
  lebensmittelwarnung.de feeds using the lebensmittel CLI. Trigger when the user
  asks "gibt es einen Rückruf für [Produkt]?", "aktuelle Lebensmittelwarnungen?",
  "is there a recall for [product]?", "wird gerade vor etwas gewarnt?", "was wurde
  diese Woche zurückgerufen?", or wants the current warnings with their reason,
  manufacturer, batch numbers and affected states. Use for a product- or
  keyword-centred lookup; for a specific Bundesland use lebensmittelwarnung-regional
  and for a product type or recall reason use lebensmittelwarnung-produkttyp.
version: 1.0.0
userInvocable: true
---

# Lebensmittelwarnung — current recalls

Answer "is there a recall right now, and does it affect this product?" from the
official portal (BVL + the sixteen Länder). The tool returns the current warnings as
JSON — this skill turns them into a clear, cited answer.

## Tooling

This skill drives the `lebensmittel` command. **Before anything else, validate it is available** — run `command -v lebensmittel` (or `lebensmittel --version`). If it is not on your PATH, STOP and inform the user that the `lebensmittel` CLI (`@maschinenlesbar.org/lebensmittelwarnung-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

**No API key is required** — the feeds are public. The data comes from the RSS feeds; the legacy JSON API is defunct. The warnings are **copyright-protected**: when you quote one, cite it in the prescribed form — `Portal www.lebensmittelwarnung.de, [Jahr]: [Produkttitel], [URL], Stand: [Datum]` — reproduce it unaltered, and never present it mixed with other sources. See DATA_LICENSE.md. Use `--compact` when piping to `jq`.

## Commands

```bash
lebensmittel warnings --compact                 # all current recalls
lebensmittel warnings --search "<term>"         # product-title substring (case-insensitive)
lebensmittel warnings --since 2026-07-01         # only on/after a date (YYYY-MM-DD)
lebensmittel warnings --limit 10                 # first N (feed order = most recent first)
```

## How to answer

1. **Product / keyword lookup** — start with `--search`, which matches the product
   **title**:

   ```bash
   lebensmittel warnings --search "beeren" --compact \
     | jq -r '.[] | "\(.title)\n  Grund: \(.reason // "?")\n  Hersteller: \(.manufacturer // "?")\n  Charge: \(.lotNumbers // "—")\n  MHD: \(.bestBefore // "—")\n  \(.link)"'
   ```

   If `--search` returns `[]`, the term isn't in any product **name** — widen: pull
   all warnings and grep the reason/manufacturer/`fields` too before concluding
   "no recall".

2. **"Anything current?"** — `lebensmittel warnings --limit 10` and summarise the
   most recent, each as *product — reason — affected states*.

3. **Always report the batch (`lotNumbers`), best-before (`bestBefore`) and
   packaging (`packaging`)** when telling someone whether *their* item is affected —
   a recall is batch-specific. Link to `.link` for the official notice.

## Field reference

| Field | Meaning |
|---|---|
| `title` | Product name |
| `reason` | *Grund der Meldung* — why (Fremdkörper, Krankheitserreger, Allergen, …) |
| `manufacturer` | *Hersteller / Inverkehrbringer* |
| `affectedStates` | *Betroffene Bundesländer* — distribution list (a `string[]`) |
| `lotNumbers` | *Chargennummer / Los-Kennzeichnung* — the codes to match on the pack |
| `bestBefore` | *Haltbarkeit* — best-before / use-by |
| `packaging` | *Verpackungseinheit* |
| `pubDate` | Publication time as served, in German time (`Fri, 4 Sep 2026 00:00:00 +0200`) — show dates from this (see Traps) |
| `published` | The same instant as an ISO timestamp in **UTC**. `--since` compares German calendar days |
| `link` | Official detail page |
| `fields` | Full label→value map (superset of the above) |

## Traps

- **A recall is batch-specific.** "Product X is recalled" is not enough — match the
  user's `lotNumbers` / `bestBefore`. Say so explicitly when you can't confirm the
  batch.
- **`--search` matches the title only**, not the reason or manufacturer. For "recalls
  because of Salmonella" or "cosmetics recalls" use the **lebensmittelwarnung-produkttyp**
  skill (filters by reason/type), not `--search`.
- **`--state` follows `affectedStates`, not the issuer.** `--state` returns the
  warnings distributed in that Land (its name is in `affectedStates`), whoever issued
  them. For a Bundesland question use **lebensmittelwarnung-regional**.
- **Don't take the date from `published[:10]`.** `published` is UTC, so a notice
  stamped `Fri, 4 Sep 2026 00:00:00 +0200` shows as 2026-09-03. Take the German date
  from `pubDate` instead: `.pubDate | split(" ")[1:4] | join(" ")` gives `4 Sep 2026`.
- **Empty `[]` is a valid answer** ("nothing matches right now"), not an error. A
  non-RSS/empty body exits 1 with a message — surface it, don't retry blindly.
- **Cite and don't alter.** These are copyright-protected safety notices; quote them
  whole with the prescribed citation, and point the user to the live portal for the
  authoritative, current status (warnings get withdrawn).
