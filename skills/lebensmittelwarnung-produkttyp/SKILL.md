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
compatibility: >
  Requires the `lebensmittel` CLI (npm package
  @maschinenlesbar.org/lebensmittelwarnung-cli) on PATH, installed by the user;
  the skill never installs it. Uses jq for JSON filtering. Network access to
  www.lebensmittelwarnung.de.
---

# Lebensmittelwarnung — by product type & reason

Answer "which recalls are there **for this category** / **for this reason**?" — using
the feed's server-side `--type` filter for the product category, and client-side
filtering on the `reason` field for the *why*.

## Tooling

This skill drives the `lebensmittel` command. **Before anything else, validate it is available** — run `command -v lebensmittel` (or `lebensmittel --version`). If it is not on your PATH, STOP and inform the user that the `lebensmittel` CLI (`@maschinenlesbar.org/lebensmittelwarnung-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

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
filter, so match it with `jq`. `reason` is a **category label**, not free text. On
2026-09-15 all 269 warnings used these seven: `Allergene`, `Fremdkörper`,
`Gesundheitsschädliche Substanz`, `Irreführung und Täuschung`, `Krankheitserreger`,
`Rückstände und Kontaminanten`, `Sonstige Gründe` — sometimes several joined with
`, ` (`Allergene, Sonstige Gründe`). The feed never names the pathogen or allergen:
"Salmonellen" or "Listerien" appear nowhere in it. So map the user's word to its
category and match that:

```bash
# Pathogens (Salmonellen, Listerien, E. coli, Noroviren … are all "Krankheitserreger")
lebensmittel warnings --compact \
  | jq -r '.[] | select((.reason // "") | test("Krankheitserreger")) | "\(.title) — \(.reason)"'

# Foreign bodies (metal, glass, plastic …)
lebensmittel warnings --compact \
  | jq -r '.[] | select((.reason // "") | test("Fremdkörper")) | .title'

# Undeclared allergens (milk, gluten, nuts …)
lebensmittel warnings --compact \
  | jq -r '.[] | select((.reason // "") | test("Allergene")) | "\(.title) — \(.reason)"'
```

When the user asks for a specific pathogen or allergen, say the feed only gives the
category and point to the official notice (`.link`) for the detail.

Combine type + reason + date:

```bash
lebensmittel warnings --type lebensmittel --since 2026-07-01 --compact \
  | jq -r '.[] | select((.reason // "") | test("Krankheitserreger")) | "\(.pubDate | split(" ")[1:4] | join(" "))  \(.title)"'
```

## Step 3 — group / count when they ask "what's most common?"

```bash
# Warnings per reason, splitting joined reasons ("Allergene, Sonstige Gründe")
lebensmittel warnings --compact \
  | jq -r '[.[] | (.reason // "?") | split(", ")[]] | group_by(.) | map({reason: .[0], n: length}) | sort_by(-.n)[] | "\(.reason): \(.n)"'

# How many per product type (loop the slugs)
for t in lebensmittel kosmetischemittel bedarfsgegenstaende mittelzumtaetowieren babyundkinderprodukte; do
  printf '%s\t%s\n' "$t" "$(lebensmittel warnings --type "$t" --compact | jq length)"
done

# The total: count the unfiltered feed, don't add up the loop
lebensmittel warnings --compact | jq length
```

**Neither breakdown adds up to the total.** A warning with two reasons counts under
both. Types overlap too: on 2026-09-15 the loop gave 231 + 7 + 30 + 0 + 21 = 289
against 269 warnings, because 20 of the 21 `babyundkinderprodukte` items are also
listed under `lebensmittel` (5) or `bedarfsgegenstaende` (15). Report each count on its
own, and take the total from the unfiltered feed.

## Traps

- **Type is server-side (`--type`), reason is client-side (`jq` on `.reason`).**
  There is no `--reason` flag; don't invent one — filter the JSON.
- **Reasons are categories, not free text.** Match the category (`Krankheitserreger`,
  not "Salmonellen", which never matches), expect comma-joined combinations, and show
  the actual `.reason` string in your answer.
- **`mittelzumtaetowieren` is often empty** — an empty `[]` for that type is a normal,
  valid result, not a failure.
- **`--search` matches the product name only** — it will not find recalls "because of
  X"; use the `.reason` filter above for that.
- **Batch-specific & copyright-protected.** Report `lotNumbers`/`bestBefore`, cite the
  source unaltered, and link `.link` to the official, current notice.
