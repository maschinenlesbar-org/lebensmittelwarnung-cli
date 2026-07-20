# Data license

> **This tool does not include, host, or redistribute any data.**
> `lebensmittelwarnung-cli` is a *client*. It only accesses data served live by the
> **lebensmittelwarnung.de** portal (the Bundesamt für Verbraucherschutz und
> Lebensmittelsicherheit and the sixteen Länder) via their public RSS feeds. That
> data is theirs and is governed by **their** terms, summarized below. The license of
> this CLI's own source code is a separate matter — see [LICENSING.md](LICENSING.md).

| | |
|---|---|
| **Data provider** | Bundesamt für Verbraucherschutz und Lebensmittelsicherheit (BVL) + the sixteen Länder |
| **API / source** | RSS 2.0 feeds at `https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/…` |
| **Data license** | **Proprietary / restricted — no open licence.** All content (texts, images) is copyright-protected (Urheberrecht). |
| **Attribution** | **Required**, in a prescribed form (see below). |
| **Personal use** | Permitted. |
| **Commercial use & redistribution** | **Only under the portal's Weiterverwendung terms** — unaltered, complete, attributed; any use beyond that needs the BVL's prior **written** permission. |

## What the Impressum actually says (verbatim points)

Fetched from the portal's Impressum / *Urheberrecht* / *Hinweise zur
Weiterverwendung* on **2026-07-13**:

- **Urheberrecht.** "Alle auf dem Internetangebot lebensmittelwarnung.de … veröffentlichten
  Inhalte (Texte, Grafiken, Bilder, Tondokumente und Videosequenzen) unterliegen dem
  Urheberrecht." Any use **not** permitted by the Urheberrechtsgesetz needs the BVL's
  **prior written consent** (`poststelle@bvl.bund.de`); for third-party content, the
  rights-holder's consent.

- **Hinweise zum Zitieren.** "Alle Inhalte dieses Internetauftritts dürfen nur unter
  Angabe der Quelle … veröffentlicht oder an Dritte weitergegeben werden." The
  **prescribed citation** is:

  > Portal www.lebensmittelwarnung.de, (Jahr): (Dokumententitel), (URL), Stand: (Datum).
  > Diese Informationen sind über das Portal „lebensmittelwarnung.de" der Länder und des
  > Bundesamtes für Verbraucherschutz und Lebensmittelsicherheit kostenfrei abrufbar.

- **Hinweise zur Weiterverwendung.** If whole pages/contents are republished or
  embedded, it must be **complete and unaltered** — changes to content, wording or
  images are **not** permitted, and neither are partial/excerpted presentations nor
  presenting the data **together with information from other sources**. Reproducing the
  federal/Länder coats of arms or the authorities' logos is expressly forbidden. Any
  reuse must **conspicuously** state that the data was taken from this portal.

- **Withdrawal / deletion duty.** Once individual content is removed from the portal
  and no longer retrievable there, the re-user must **promptly, permanently and
  irretrievably delete** it from their own offerings. (This is a real constraint for
  anyone caching the feed.)

- **Bildnachweis / images.** "Das Urheberrecht für Texte und Bilder liegt, soweit
  nicht anders vermerkt, beim [BVL]. Einzelne Bilder stammen von Adobe Stock." Further
  use/publication of the images by third parties is **only** possible under the
  rights-holder's licence terms. The product images this CLI exposes as `imageUrls`
  are therefore **not** freely reusable — treat them as all-rights-reserved.

- **Marken.** Product names, trademarks and logos in the warnings belong to their
  respective owners and appear only for the purpose of the reporting.

## Liability (whose data it is)

The Impressum is explicit that the **Land named as the reporting authority
("Meldungsersteller") — or the BVL where "Deutschland" is the affected area — bears
sole legal responsibility** for the completeness, correctness and lawfulness of each
warning. The BVL does not content-review the Länder's entries and assumes no liability
for them. There is **no warranty** for accuracy, completeness or availability, and the
"Betroffene Bundesländer" list is continuously updated.

## What the feeds actually return

- **Factual recall data** — product name, reason (*Grund der Meldung*), manufacturer,
  affected Länder, lot numbers, best-before dates. These are the public-safety facts
  you can act on, but the portal's terms treat the published *content* as
  copyright-protected: for any republication, use the prescribed citation and follow
  the unaltered/complete rule.
- **Images** (`imageUrls`) — copyright-protected (BVL / manufacturers / Adobe Stock);
  personal use only, no republication without the rights-holder's permission.

## Notes & caveats

- When in doubt about anything beyond personal use, ask the BVL first
  (`lebensmittelwarnung@bvl.bund.de`) — the default here is "permission required",
  not "open".
- **This is a safety data source.** Do not rely on a cached or filtered view for a
  real purchase decision — always confirm against the live portal, and heed the
  deletion duty for withdrawn warnings.

## Sources

- https://www.lebensmittelwarnung.de/DE/Service/Impressum/impressum_node.html — Impressum: Herausgeber, Haftungshinweise, Bildnachweis, Urheberrecht, Hinweise zum Zitieren, Hinweise zur Weiterverwendung
- https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/rssnewsfeed_node.html — the official RSS-feed catalogue (states × product types)

---

*Good-faith summary compiled 2026-07-13 from the portal's own Impressum; not legal
advice. The provider's terms are authoritative and can change — verify at the source
before relying on the data, especially for any commercial or redistribution use.*
