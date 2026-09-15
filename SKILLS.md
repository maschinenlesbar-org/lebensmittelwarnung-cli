# lebensmittelwarnung-cli — Claude Code Skills

A set of [Claude Code](https://code.claude.com/docs/en/skills) **Agent Skills** for
Germany's official product-warning portal
**[lebensmittelwarnung.de](https://www.lebensmittelwarnung.de)**, all powered by the
**[lebensmittel](README.md)** CLI over the portal's official RSS feeds.

Each skill teaches Claude how to drive the `lebensmittel` CLI to answer a specific,
real-world question — "gibt es einen Rückruf für dieses Produkt?", "aktuelle
Lebensmittelwarnungen in Bayern?", "Rückrufe wegen Salmonellen?" — and to report the
answer with the prescribed source citation rather than guesswork. They encode the
parts that are easy to get wrong (the batch-specific nature of a recall, the
state-slug mapping, the state feed being the distribution list rather than the issuing
Land, and the
type-is-server-side-but-reason-is-client-side split).

The warnings are **copyright-protected safety notices**: the skills always cite the
source in the required form, reproduce content unaltered, and point to the live portal
for the authoritative, current status (warnings get withdrawn). See
[DATA_LICENSE.md](DATA_LICENSE.md).

## Skills

| Skill | What it does | Ask it… |
|---|---|---|
| **lebensmittelwarnung-recalls** | Current recalls by product / keyword, with reason, manufacturer, batch and best-before. | "gibt es einen Rückruf für [Produkt]?", "aktuelle Lebensmittelwarnungen?", "was wurde diese Woche zurückgerufen?" |
| **lebensmittelwarnung-regional** | Recalls distributed in a specific Bundesland (name → slug), and which Land issued them. | "aktuelle Lebensmittelwarnungen in Bayern?", "Rückrufe in NRW?", "betrifft das Hamburg?" |
| **lebensmittelwarnung-produkttyp** | Filter by product type (Kosmetik, Baby-/Kinderprodukte, …) or recall reason (Salmonellen, Fremdkörper, Allergen). | "Kosmetik-Rückrufe?", "Rückrufe wegen Listerien?", "Warnungen für Kinderprodukte?" |

## Requirements

- **[Claude Code](https://code.claude.com/docs/en/overview)** (or any harness that loads
  Agent Skills).
- **The `lebensmittel` CLI** installed globally:
  ```bash
  npm i -g @maschinenlesbar.org/lebensmittelwarnung-cli   # installs the `lebensmittel` bin
  ```
- **No API key** — the feeds are public.

## Installation

### Plugin marketplace (recommended)

The skills are published as the `lebensmittelwarnung` plugin in the
[maschinenlesbar.org plugin marketplace](https://github.com/maschinenlesbar-org/plugins),
which lists the plugins for all maschinenlesbar.org CLIs. Installation is two
commands inside Claude Code:

```
/plugin marketplace add maschinenlesbar-org/plugins
/plugin install lebensmittelwarnung@maschinenlesbar
```

The first command registers the marketplace (once, for all maschinenlesbar.org
plugins); the second installs the `lebensmittelwarnung` plugin, which bundles
all three skills. Update later with
`/plugin marketplace update maschinenlesbar`.
