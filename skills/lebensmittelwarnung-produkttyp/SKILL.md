---
name: lebensmittelwarnung-produkttyp
description: >
  Filter current German product recalls by product type or recall reason using the
  lebensmittel CLI. Trigger when the user asks "Kosmetik-Rückrufe?", "Rückrufe wegen
  Salmonellen / Listerien / Fremdkörper?", "Warnungen für Baby- und Kinderprodukte?",
  "recalls for cosmetics / tattoo inks / consumer goods?", "welche Lebensmittel wurden
  wegen eines Allergens zurückgerufen?", or wants recalls grouped or filtered by
  category (Produkttyp) or by the reason of the warning (Grund der Meldung). Handles
  the type slugs and the reason field the bare CLI leaves to you.
version: 1.0.0
userInvocable: true
---

# Lebensmittelwarnung — by product type & reason

Answer "which recalls are there **for this category** / **for this reason**?" — using
the feed's server-side `--type` filter for the product category, and client-side
filtering on the `reason` field for the *why*.

## Tooling

This skill drives the `lebensmittel` command. **Before anything else, validate it is available** — run `command -v lebensmittel` (or `lebensmittel --version`). If it is not on your PATH, STOP and inform the user that the `lebensmittel` CLI (`@maschinenlesbar.org/lebensmittelwarnung-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

**No API key is required** — the feeds are public. The data comes from the RSS feeds; the legacy JSON API is defunct. The warnings are **copyright-protected**: when you quote one, cite it in the prescribed form — `Portal www.lebensmittelwarnung.de, [Jahr]: [Produkttitel], [URL], Stand: [Datum]` — reproduce it unaltered, and never present it mixed with other sources. See DATA_LICENSE.md. Use `--compact` when piping to `jq`.

## Step 1 — product type → `--type` slug

`--type` narrows the feed server-side to one product category. The five slugs (run
`lebensmittel types` for the list):

| Slug | German | Covers |
|---|---|---|
| `lebensmittel` | Lebensmittel | Food and drink |
| `kosmetischemittel` | Kosmetische Mittel | Cosmetics |
| `bedarfsgegenstaende` | Bedarfsgegenstände | Food-contact / everyday consumer goods (packaging, kitchenware, textiles) |
| `mittelzumtaetowieren` | Mittel zum Tätowieren | Tattoo inks / agents |
| `babyundkinderprodukte` | Baby- und Kinderprodukte | Baby & children's products |

An unknown slug is a **usage error (exit 2)** — the CLI never silently returns the
full unfiltered feed.

```bash
lebensmittel warnings --type kosmetischemittel --compact \
  | jq -r '.[] | "\(.title) — \(.reason // "?")"'
```

## Step 2 — filter by reason (Grund der Meldung), client-side

The recall **reason** lives in the `reason` field; there is no server-side reason
filter, so match it with `jq`. Reasons are free German text — use a case-insensitive
substring and be generous with synonyms:

```bash
# Recalls due to pathogens (Salmonella/Listeria/E. coli/Noro…)
lebensmittel warnings --compact \
  | jq -r '.[] | select((.reason // "") | ascii_downcase | test("salmonell|listeri|coli|noro|krankheitserreger")) | "\(.title) — \(.reason)"'

# Foreign bodies
lebensmittel warnings --compact \
  | jq -r '.[] | select((.reason // "") | test("Fremdkörper|Metall|Glas|Kunststoff")) | .title'

# Undeclared allergen
lebensmittel warnings --compact \
  | jq -r '.[] | select((.reason // "") | ascii_downcase | test("allergen|milch|gluten|nuss|soja|senf|sulfit")) | "\(.title) — \(.reason)"'
```

Combine type + reason + date:

```bash
lebensmittel warnings --type lebensmittel --since 2026-07-01 --compact \
  | jq -r '.[] | select((.reason // "") | test("Listeri")) | "\(.published[:10])  \(.title)"'
```

## Step 3 — group / count when they ask "what's most common?"

```bash
# All current recalls grouped by reason
lebensmittel warnings --compact \
  | jq -r 'group_by(.reason)[] | "\(.[0].reason // "?"): \(length)"' | sort -t: -k2 -rn

# How many per product type (loop the slugs)
for t in lebensmittel kosmetischemittel bedarfsgegenstaende mittelzumtaetowieren babyundkinderprodukte; do
  printf '%s\t%s\n' "$t" "$(lebensmittel warnings --type "$t" --compact | jq length)"
done
```

## Traps

- **Type is server-side (`--type`), reason is client-side (`jq` on `.reason`).**
  There is no `--reason` flag; don't invent one — filter the JSON.
- **Reasons are free text, in German.** Match loosely (`ascii_downcase | test(...)`)
  and include synonyms, or you'll miss items (e.g. "Salmonellen" vs "Salmonella" vs
  "Krankheitserreger"). Show the actual `.reason` string in your answer.
- **`mittelzumtaetowieren` is often empty** — an empty `[]` for that type is a normal,
  valid result, not a failure.
- **`--search` is title-only** — it will not find recalls "because of X"; use the
  `.reason` filter above for that.
- **Batch-specific & copyright-protected.** Report `lotNumbers`/`bestBefore`, cite the
  source unaltered, and link `.link` to the official, current notice.
