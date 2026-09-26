// Response interfaces for the lebensmittelwarnung.de RSS feeds. Each feed is an
// RSS 2.0 document (see rss.ts); a `<item>` is one product warning (Warnung /
// Rückruf), with the interesting detail packed into an HTML `<description>` that
// this client parses into typed accessors plus a generic label→value map.

import type { StateSlug, TypeSlug } from "./enums.js";

export type { StateSlug, TypeSlug } from "./enums.js";

/**
 * One product warning (Warnung / Rückruf) from the feed's `<item>` elements,
 * projected to typed factual fields plus the generic `fields` map for anything the
 * feed carries beyond the first-class accessors.
 */
export interface Warning {
  /**
   * The product name, e.g. "ja! Beerenmischung, tiefgefroren, 750 Gramm Beutel" —
   * the feed's `<title>`. When the portal serves an unrendered template there
   * instead (`$esc.escapeXml(…)`, every item since September 2026), this is
   * {@link product}; absent when neither is usable.
   */
  title?: string;
  /**
   * "Produktbezeichnung/ -beschreibung" — the product name/description from the
   * notice body (e.g. "KIMCHI 300 Gramm"). Often the same as `title`.
   */
  product?: string;
  /** URL of the warning's detail page on lebensmittelwarnung.de (a reference). */
  link?: string;
  /** Publication timestamp as served (RFC 822), e.g. "Wed, 8 Jul 2026 16:00:00 +0200". */
  pubDate?: string;
  /** `pubDate` normalised to an ISO-8601 string when parseable, else absent. */
  published?: string;

  /** "Grund der Meldung" — why the warning was issued (e.g. "Fremdkörper"). */
  reason?: string;
  /** "Hersteller / Inverkehrbringer" — manufacturer / distributor. */
  manufacturer?: string;
  /** "Betroffene Bundesländer nach derzeitigem Stand", split into a list. */
  affectedStates?: string[];
  /** "Chargennummer / Los-Kennzeichnung" — batch/lot identifiers. */
  lotNumbers?: string;
  /** "Haltbarkeit" — best-before / durability information. */
  bestBefore?: string;
  /** "Verpackungseinheit" — packaging unit. */
  packaging?: string;
  /** Every `<img src=…>` image URL in the description, in order. */
  imageUrls?: string[];
  /**
   * The same images, each with its own credit ("Bildquelle", e.g. "© Netto Marken
   * Discount") — the credit to show with that image. `fields.Bildquelle` holds only
   * the last one, which is wrong for every other image of a multi-image notice.
   */
  images?: WarningImage[];

  /**
   * The full label→value map parsed from the HTML description — a superset of the
   * typed accessors above, so a label this client does not model first-class (or a
   * product-type-specific one) is still available. Keys are the German labels with
   * the trailing colon stripped, e.g. "Grund der Meldung", "Bildquelle".
   */
  fields: Record<string, string>;

  /** The raw HTML `<description>` body, kept verbatim for callers who need more. */
  rawDescription?: string;
}

/** One product image with its credit, as the notice gives it. */
export interface WarningImage {
  url: string;
  /** The "Bildquelle" caption after the image; absent when the notice has none. */
  credit?: string;
}

/** Options accepted by {@link LebensmittelwarnungClient.warnings}. */
export interface WarningsQuery {
  /** Narrow to one Bundesland (server-side `state=` filter). */
  state?: StateSlug;
  /** Narrow to one product type (server-side `type=` filter). */
  type?: TypeSlug;
}
