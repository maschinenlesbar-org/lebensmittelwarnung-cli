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
lebensmittel warnings --search "<stem>"         # product-name substring (title or product; case/umlaut/ß-insensitive)
lebensmittel warnings --since 2026-07-01         # only on/after a date (YYYY-MM-DD)
lebensmittel warnings --limit 10                 # first N (feed order = most recent first)
```

## How to answer

1. **Product / keyword lookup** — start with `--search`, which matches the product
   **name** (`title` and `product`). Search the **German word stem**, not the word as
   the user wrote it: drop plural and inflection endings (*Erdnüsse* → `Erdnuss`,
   *Würstchen* → `Wurst`, *Tahini* → `Tahin`), and use the German word for an English one
   (*cheese* → `Käse`, *peanut* → `Erdnuss`). Case and umlaut spelling don't matter
   (`kaese` finds "Käse"), but it is a substring match: `Tahini` finds neither "Tahina"
   nor "Tahin" — `Tahin` finds both.

   ```bash
   lebensmittel warnings --search "beeren" --compact \
     | jq -r '.[] | "\(.title)\n  Grund: \(.reason // "?")\n  Hersteller: \(.manufacturer // "?")\n  Charge: \(.lotNumbers // "—")\n  MHD: \(.bestBefore // "—")\n  \(.link)"'
   ```

   If `--search` returns `[]`, **widen before concluding "no recall"**: search every
   text field — reason, manufacturer, all `fields`, and the notice URL (its folder name
   often carries the product words, e.g. `…_Butter_Erdnuss_Taler…`) — with a regex
   built from the stem that allows each umlaut three ways (`ü` → `(u|ü|ue)`) and lists
   the synonyms you thought of:

   ```bash
   lebensmittel warnings --compact | jq -r --arg re 'erdn(u|ü|ue)ss|peanut' \
     '.[] | select([.title, .product, .reason, .manufacturer, .link, (.fields | tostring)]
       | map(. // "") | join(" ") | test($re; "i")) | "\(.title) — \(.reason // "?") — \(.link)"'
   ```

   Only when the stem, the singular and plural, the umlaut spellings, a synonym (German
   and English) and the brand all find nothing, answer "no listed recall matched" — and
   name the terms you searched, so the user can judge the search.

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
| `title` | Product name — the `[Produkttitel]` of the citation. When the feed serves an unrendered template as `<title>` (`$esc.escapeXml(…)`, every item in Sep 2026), the CLI fills `title` from `product` |
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
- **`--search` is a substring match of one word form.** It ignores case, umlaut
  spelling (`ä`/`ae`/`a`), `ß`/`ss` and accents, but not word forms: on 2026-10-05
  `Tahini` found none of the four listed *Tahina*/*Tahin* recalls (among them the
  newest recall in the feed), and the widen step with the same literal term found none
  either. Always search the stem and the variants in step 1 before saying "no recall".
- **`--state` follows `affectedStates`, not the issuer.** `--state` returns the
  warnings distributed in that Land (its name is in `affectedStates`), whoever issued
  them. For a Bundesland question use **lebensmittelwarnung-regional**.
- **`pubDate` moves when a notice is updated.** It is often the last-update time, not
  the first publication (on 2026-09-26, 45 of 265 were days to years after the notice
  date), so `--since` returns "new **or updated**" warnings. Before calling one new,
  compare the date in the `.link` folder name — `YYMMDD_` (e.g. `…/260616_11_BE_Austern…`
  = 16 Jun 2026) or, for some notices, `YYYYMMDD_` (`…/20260701_01_ST_…`) — and say
  "updated on …" when they differ.
- **Don't take the date from `published[:10]`.** `published` is UTC, so a notice
  stamped `Fri, 4 Sep 2026 00:00:00 +0200` shows as 2026-09-03. Take the German date
  from `pubDate` instead: `.pubDate | split(" ")[1:4] | join(" ")` gives `4 Sep 2026`.
- **Empty `[]` is a valid answer** ("nothing matches right now"), not an error. A
  non-RSS/empty body, or an unfiltered feed with no items, exits 1 with a message —
  surface it, don't retry blindly.
- **Cite and don't alter.** These are copyright-protected safety notices; quote them
  whole with the prescribed citation, and point the user to the live portal for the
  authoritative, current status (warnings get withdrawn).
