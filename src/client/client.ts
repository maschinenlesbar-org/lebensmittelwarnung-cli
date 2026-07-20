// LebensmittelwarnungClient — a typed client over the official
// lebensmittelwarnung.de product-warning RSS feeds (Bundesamt für Verbraucherschutz
// und Lebensmittelsicherheit / the sixteen Länder). No auth, no API key.
//
// Every warning is one `<item>` of an RSS 2.0 feed; the interesting detail lives in
// an HTML `<description>`, which this client parses into typed accessors (reason,
// manufacturer, affected states, …) plus a generic label→value `fields` map and the
// raw description. The feed can be narrowed server-side by `state=` and `type=`.
//
//   const c = new LebensmittelwarnungClient();
//   await c.warnings();                              // all current warnings
//   await c.warnings({ state: "bayern" });           // one Bundesland
//   await c.warnings({ type: "lebensmittel" });      // one product type

import { RequestEngine, type EngineOptions } from "./engine.js";
import { parseDescription } from "./rss.js";
import type { Warning, WarningsQuery } from "./types.js";

/** The single feed path (relative to the base URL). GET, optionally `?state=&type=`. */
export const FEED_PATH =
  "/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/rssnewsfeed_Alle_DE.xml";

// The German description labels mapped to first-class typed accessors. The generic
// `fields` map still carries every label (incl. these), so nothing is lost if the
// portal renames one — revisit this table when that happens.
const LABEL = {
  reason: "Grund der Meldung",
  manufacturer: "Hersteller / Inverkehrbringer",
  affectedStates: "Betroffene Bundesländer nach derzeitigem Stand",
  lotNumbers: "Chargennummer / Los-Kennzeichnung",
  bestBefore: "Haltbarkeit",
  packaging: "Verpackungseinheit",
} as const;

/**
 * Parse an RFC-822 `pubDate` into an ISO-8601 string, or `undefined` when it is
 * absent/unparseable (Date.parse understands the RFC-822 form the feed serves).
 */
function toIso(pubDate: string | undefined): string | undefined {
  if (!pubDate) return undefined;
  const ms = Date.parse(pubDate);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Options for the client (engine options only — the feed needs no auth). */
export type LebensmittelwarnungClientOptions = EngineOptions;

export class LebensmittelwarnungClient {
  private readonly engine: RequestEngine;

  constructor(options: LebensmittelwarnungClientOptions = {}) {
    this.engine = new RequestEngine(options);
  }

  /**
   * Fetch the current product warnings, optionally narrowed by `state` / `type`
   * (both are applied server-side via the feed's query parameters). Each item's
   * HTML description is parsed into typed fields plus the generic `fields` map.
   */
  async warnings(query: WarningsQuery = {}): Promise<Warning[]> {
    const params: Record<string, string> = {};
    if (query.state !== undefined) params["state"] = query.state;
    if (query.type !== undefined) params["type"] = query.type;

    const feed = await this.engine.getFeed(FEED_PATH, params);
    return feed.items.map((item) => {
      const { fields, imageUrls } = parseDescription(item.description ?? "");
      const warning: Warning = { fields };
      if (item.title !== undefined) warning.title = item.title;
      if (item.link !== undefined) warning.link = item.link;
      if (item.pubDate !== undefined) warning.pubDate = item.pubDate;
      const iso = toIso(item.pubDate);
      if (iso !== undefined) warning.published = iso;

      const reason = fields[LABEL.reason];
      if (reason) warning.reason = reason;
      const manufacturer = fields[LABEL.manufacturer];
      if (manufacturer) warning.manufacturer = manufacturer;
      const affected = fields[LABEL.affectedStates];
      if (affected) {
        warning.affectedStates = affected
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      const lot = fields[LABEL.lotNumbers];
      if (lot) warning.lotNumbers = lot;
      const best = fields[LABEL.bestBefore];
      if (best) warning.bestBefore = best;
      const pack = fields[LABEL.packaging];
      if (pack) warning.packaging = pack;
      if (imageUrls.length > 0) warning.imageUrls = imageUrls;
      if (item.description !== undefined) warning.rawDescription = item.description;

      return warning;
    });
  }
}
