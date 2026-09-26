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
compatibility: >
  Requires the `lebensmittel` CLI (npm package
  @maschinenlesbar.org/lebensmittelwarnung-cli) on PATH, installed by the user;
  the skill never installs it. Uses jq for JSON filtering. Network access to
  www.lebensmittelwarnung.de.
---

# Lebensmittelwarnung — current recalls

Answer "is there a recall right now, and does it affect this product?" from the
official portal (BVL + the sixteen Länder). The tool returns every warning the portal
still lists, newest first, as JSON — this skill turns them into a clear, cited answer.

## Tooling

This skill drives the `lebensmittel` command. **Before anything else, validate it is available** — run `command -v lebensmittel` (or `lebensmittel --version`). If it is not on your PATH, STOP and inform the user that the `lebensmittel` CLI (`@maschinenlesbar.org/lebensmittelwarnung-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

**No API key is required** — the feeds are public. The data comes from the RSS feeds; the legacy JSON API is defunct. The warnings are **copyright-protected**: when you quote one, cite it in the prescribed form — `Portal www.lebensmittelwarnung.de, [Jahr]: [Produkttitel], [URL], Stand: [Datum]` — reproduce it unaltered, and never present it mixed with other sources. See DATA_LICENSE.md. Use `--compact` when piping to `jq`.

## Commands

```bash
lebensmittel warnings --compact                 # every listed warning (goes back years)
lebensmittel warnings --search "<term>"         # product-name substring (title or product; case-insensitive)
lebensmittel warnings --since 2026-07-01         # only on/after a date (YYYY-MM-DD)
lebensmittel warnings --limit 10                 # first N (feed order = most recent first)
```

## How to answer

1. **Product / keyword lookup** — start with `--search`, which matches the product
   **name** (`title` and `product`):

   ```bash
   lebensmittel warnings --search "beeren" --compact \
     | jq -r '.[] | "\(.title)\n  Grund: \(.reason // "?")\n  Hersteller: \(.manufacturer // "?")\n  Charge: \(.lotNumbers // "—")\n  MHD: \(.bestBefore // "—")\n  \(.link)"'
   ```

   If `--search` returns `[]`, the term isn't in any product **name** — widen: pull
   all warnings and grep the reason/manufacturer/`fields` too before concluding
   "no recall".

2. **"Anything current?" / "diese Woche?"** — use a date window, and name it in the
   answer:

   ```bash
   # published or updated in the last 14 days (BSD date, then GNU date)
   lebensmittel warnings --since "$(date -v-14d +%F 2>/dev/null || date -d '14 days ago' +%F)" --compact
   ```

   Or `--limit 10` for "the latest ten" (the feed is newest-first). Summarise each as
   *product — reason — affected states*.

3. **Always report the batch (`lotNumbers`), best-before (`bestBefore`) and
   packaging (`packaging`)** when telling someone whether *their* item is affected —
   a recall is batch-specific. Link to `.link` for the official notice.

## Field reference

| Field | Meaning |
|---|---|
| `title` | Product name — the `[Produkttitel]` of the citation. The feed's own `<title>` has been an unrendered template (`$esc.escapeXml(…)`) since Sep 2026; the CLI then fills `title` from `product` |
| `product` | *Produktbezeichnung / -beschreibung* — the product name from the notice body |
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

- **The feed is not just current recalls.** On 2026-09-15 it listed 269 warnings going
  back to 2018-06-21 (162 of them from 2026), including products whose best-before date
  had already passed. Don't call the unfiltered feed "all current recalls"; for
  „aktuell" use `--since` or `--limit`, and check `bestBefore` before telling someone
  a product is still a risk.
- **A recall is batch-specific.** "Product X is recalled" is not enough — match the
  user's `lotNumbers` / `bestBefore`. Say so explicitly when you can't confirm the
  batch.
- **`--search` matches the product name only** (`title` and `product`), not the reason
  or manufacturer. For "recalls because of Salmonella" or "cosmetics recalls" use the
  **lebensmittelwarnung-produkttyp** skill (filters by reason/type), not `--search`.
- **`--state` follows `affectedStates`, not the issuer.** `--state` returns the
  warnings distributed in that Land (its name is in `affectedStates`), whoever issued
  them. For a Bundesland question use **lebensmittelwarnung-regional**.
- **`pubDate` moves when a notice is updated.** It is often the last-update time, not
  the first publication (on 2026-09-26, 45 of 265 were days to years after the notice
  date), so `--since` returns "new **or updated**" warnings. Before calling one new,
  compare the `YYMMDD_` date in the `.link` folder name (e.g. `…/260616_11_BE_Austern…` =
  16 Jun 2026) and say "updated on …" when they differ.
- **Don't take the date from `published[:10]`.** `published` is UTC, so a notice
  stamped `Fri, 4 Sep 2026 00:00:00 +0200` shows as 2026-09-03. Take the German date
  from `pubDate` instead: `.pubDate | split(" ")[1:4] | join(" ")` gives `4 Sep 2026`.
- **Empty `[]` is a valid answer** ("nothing matches right now"), not an error. A
  non-RSS/empty body exits 1 with a message — surface it, don't retry blindly.
- **Cite and don't alter.** These are copyright-protected safety notices; quote them
  whole with the prescribed citation, and point the user to the live portal for the
  authoritative, current status (warnings get withdrawn).
