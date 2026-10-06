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
//   await c.warnings({ since: "2026-09-01", search: "bio", limit: 5 }); // client-side

import { RequestEngine, type EngineOptions } from "./engine.js";
import { parseDescription } from "./rss.js";
import { isStateSlug, isTypeSlug, STATE_SLUGS, TYPE_SLUGS } from "./enums.js";
import { LebensmittelwarnungValidationError, cutForMessage } from "./errors.js";
import { berlinDay, parsePubDate } from "./dates.js";
import { assertValid, calendarDateProblem, knownKeysProblem, limitProblem, nonBlankProblem } from "./validate.js";
import type { Warning, WarningsFilter, WarningsQuery } from "./types.js";

/** The single feed path (relative to the base URL). GET, optionally `?state=&type=`. */
export const FEED_PATH =
  "/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/rssnewsfeed_Alle_DE.xml";

// The German description labels mapped to first-class typed accessors. The generic
// `fields` map still carries every label (incl. these), so nothing is lost if the
// portal renames one — revisit this table when that happens.
const LABEL = {
  product: "Produktbezeichnung/ -beschreibung",
  reason: "Grund der Meldung",
  manufacturer: "Hersteller / Inverkehrbringer",
  affectedStates: "Betroffene Bundesländer nach derzeitigem Stand",
  lotNumbers: "Chargennummer / Los-Kennzeichnung",
  bestBefore: "Haltbarkeit",
  packaging: "Verpackungseinheit",
} as const;

/**
 * The description labels the typed fields the CLI and the skills filter on depend on:
 * `product` (and with it `--search`), `reason`, `manufacturer` and `affectedStates`. Every
 * item of the live feed carries all four (255 of 255 on 2026-10-06); the other labels
 * (packaging, lot numbers, best-before, contact) are missing from some notices by nature.
 */
export const REQUIRED_LABELS: readonly string[] = [LABEL.product, LABEL.reason, LABEL.manufacturer, LABEL.affectedStates];

/**
 * The labels of {@link REQUIRED_LABELS} that not one of `warnings` carries in its `fields`
 * — the sign of a portal-side rename, which would otherwise leave the typed field (and
 * the filters on it) silently empty while the value sits under its new label in
 * `fields`. In {@link REQUIRED_LABELS} order; empty for an empty list (nothing to judge).
 * A list that is not an array of objects throws a LebensmittelwarnungValidationError.
 */
export function missingLabels(warnings: readonly Warning[]): string[] {
  assertValid("warnings", warnings, warningListProblem);
  if (warnings.length === 0) return [];
  return REQUIRED_LABELS.filter((label) =>
    warnings.every((w) => typeof w.fields !== "object" || w.fields === null || !Object.hasOwn(w.fields, label)),
  );
}

/**
 * Is `title` an unrendered CMS template rather than a product name? In September
 * 2026 the portal served every item's `<title>` as the literal Velocity expression
 * `$esc.escapeXml($cms.oneLineText($m.title))` (real names were back by 2026-10-05). Detected by a Velocity method
 * reference (`$name.method(`) anywhere in the text — a real product name never has
 * one (a price such as `$5.99` has a digit after the `$`).
 */
export function isUnrenderedTitle(title: string): boolean {
  return /\$!?\{?[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\(/.test(title);
}

/**
 * Parse a `pubDate` into an ISO-8601 string, or `undefined` when it is absent or not a
 * form {@link parsePubDate} reads (then the warning has no `published`, and `since`
 * leaves it out).
 */
function toIso(pubDate: string | undefined): string | undefined {
  if (!pubDate) return undefined;
  const ms = parsePubDate(pubDate);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

/** The notice URL (resolved against the feed URL), else the feed URL. */
function resolveBase(link: string | undefined, feedUrl: string): string {
  if (link === undefined || link === "") return feedUrl;
  try {
    return new URL(link, feedUrl).href;
  } catch {
    return feedUrl;
  }
}

function invalid(name: string, expected: string, got: unknown): LebensmittelwarnungValidationError {
  return new LebensmittelwarnungValidationError(
    `Invalid ${name}: expected ${expected}, got ${cutForMessage(String(JSON.stringify(got)))}.`,
  );
}

/** The checked form of a {@link WarningsFilter}: a trimmed day, the folded needles. */
interface CheckedFilter {
  since?: string;
  needles?: SearchForms;
  limit?: number;
}

/** The two folded forms {@link searchForms} gives for one text. */
export interface SearchForms {
  /** Umlauts transliterated: `Käse` → `kaese`, `weiße` → `weisse`. */
  transliterated: string;
  /** Diacritics dropped: `Käse` → `kase`, `Erdnüsse` → `erdnusse`. */
  plain: string;
}

/**
 * The forms `search` compares, for one text: Unicode-normalised (a decomposed `a` +
 * U+0308 from a macOS paste is `ä`), lower-cased, whitespace (a non-breaking space
 * too) collapsed to one space and trimmed, then folded twice — once with the German
 * umlauts transliterated (`ä` → `ae`, `ö` → `oe`, `ü` → `ue`) and once with every
 * diacritic dropped (`ä` → `a`, `é` → `e`); `ß` and `ẞ` become `ss` in both. A needle
 * matches when one of its forms is a substring of the same form of the product name,
 * so `kaese`, `KÄSE` and `käse` all find "Käse", `weisse` finds "weiße", `Erdnuss` finds
 * "Erdnüsse" and `muesli` "Müsli". The portal spells product names as their makers do,
 * and the CLI's own slugs teach the `ae`/`oe`/`ue` spelling (`thueringen`), so a literal
 * match answered "no recall" for five listed Käse recalls.
 */
export function searchForms(text: string): SearchForms {
  const base = text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().replace(/ß/g, "ss");
  const dropMarks = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  return {
    transliterated: dropMarks(base.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")),
    plain: dropMarks(base),
  };
}

/** True when `text` contains the needle in one of its folded forms (see {@link searchForms}). */
function matchesSearch(text: string, needles: SearchForms): boolean {
  const forms = searchForms(text);
  return forms.transliterated.includes(needles.transliterated) || forms.plain.includes(needles.plain);
}

/**
 * A list for {@link filterWarnings} must be an array of objects. A string or `null`
 * items used to come back unchanged or fail as a raw TypeError.
 */
function warningListProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) return "Expected an array of warnings.";
  const bad = value.findIndex((w) => typeof w !== "object" || w === null || Array.isArray(w));
  return bad === -1 ? undefined : `Expected an array of warnings; item ${bad} is not an object.`;
}

/** The keys of a {@link WarningsQuery}; any other key is a validation error. */
const QUERY_KEYS = ["state", "type", "since", "search", "limit"] as const;
/** The keys of a {@link WarningsFilter}. */
const FILTER_KEYS = ["since", "search", "limit"] as const;

/** Validate the client-side narrowing; a bad value throws before any request. */
function checkFilter(filter: WarningsFilter): CheckedFilter {
  const checked: CheckedFilter = {};
  if (filter.since !== undefined) checked.since = assertValid("since", filter.since, calendarDateProblem).trim();
  if (filter.search !== undefined) {
    checked.needles = searchForms(assertValid("search", filter.search, nonBlankProblem));
  }
  if (filter.limit !== undefined) checked.limit = assertValid("limit", filter.limit, limitProblem);
  return checked;
}

function applyFilter(warnings: Warning[], { since, needles, limit }: CheckedFilter): Warning[] {
  let result = warnings;
  // `since` compares calendar days in German time, not UTC: a notice stamped
  // `00:00:00 +0200` belongs to that day, although its UTC instant is the day before.
  // Field types are guarded so a filter never matches by accident.
  if (since !== undefined) {
    result = result.filter((w) => {
      if (typeof w.published !== "string") return false;
      const day = berlinDay(w.published);
      return day !== undefined && day >= since;
    });
  }
  if (needles !== undefined) {
    // Both product-name fields: `title` (the feed's, or the fallback) and `product`
    // (Produktbezeichnung), which can word the same product differently.
    result = result.filter((w) =>
      [w.title, w.product].some((v) => typeof v === "string" && matchesSearch(v, needles)),
    );
  }
  if (limit !== undefined) result = result.slice(0, limit);
  return result;
}

/**
 * Narrow a list of warnings the way {@link LebensmittelwarnungClient.warnings} does:
 * `since` (German calendar day, items without `published` dropped), then `search`
 * (against `title` and `product`; case, umlaut spelling, `ß`/`ss`, accents and Unicode
 * normalisation don't matter, see {@link searchForms}), then `limit`. A bad
 * value throws a LebensmittelwarnungValidationError.
 */
export function filterWarnings(warnings: Warning[], filter: WarningsFilter = {}): Warning[] {
  assertValid("warnings", warnings, warningListProblem);
  assertValid("filter", filter, knownKeysProblem(FILTER_KEYS));
  return applyFilter(warnings, checkFilter(filter));
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
   * (both are applied server-side via the feed's query parameters) and by `since`,
   * `search` and `limit` (applied client-side, in that order; see
   * {@link filterWarnings}). Every option is checked before the request. Each item's
   * HTML description is parsed into typed fields plus the generic `fields` map.
   */
  async warnings(query: WarningsQuery = {}): Promise<Warning[]> {
    // A misspelled key (`States`, `serach`) used to be ignored, returning the whole feed.
    assertValid("query", query, knownKeysProblem(QUERY_KEYS));
    // Checked before any request: the feed answers an unknown slug with HTTP 400,
    // and a value such as "bayern&type=x" would be sent (encoded) as one slug.
    if (query.state !== undefined && !isStateSlug(query.state)) {
      throw invalid("state", `one of ${STATE_SLUGS.join(", ")}`, query.state);
    }
    if (query.type !== undefined && !isTypeSlug(query.type)) {
      throw invalid("type", `one of ${TYPE_SLUGS.join(", ")}`, query.type);
    }
    const filter = checkFilter(query);
    const params: Record<string, string> = {};
    if (query.state !== undefined) params["state"] = query.state;
    if (query.type !== undefined) params["type"] = query.type;

    const feed = await this.engine.getFeed(FEED_PATH, params);
    // Without the base URL's userinfo: relative image URLs are resolved against it.
    const feedUrl = this.engine.publicUrl(FEED_PATH);
    const warnings = feed.items.map((item) => {
      // Relative image URLs resolve against the notice page (or the feed itself).
      const base = resolveBase(item.link, feedUrl);
      const { fields, imageUrls, images } = parseDescription(item.description ?? "", base);
      const warning: Warning = { fields };
      // The product name. The feed's `<title>` is used as served unless it is an
      // unrendered template (see isUnrenderedTitle); then the description's
      // "Produktbezeichnung/ -beschreibung" stands in, and without one `title` is
      // left out rather than carrying template source.
      const product = fields[LABEL.product];
      if (item.title !== undefined && !isUnrenderedTitle(item.title)) warning.title = item.title;
      else if (product) warning.title = product;
      if (product) warning.product = product;
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
        // A comma separates the Länder; a semicolon joins the lists of a repeated label.
        warning.affectedStates = affected
          .split(/[,;]/)
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
      if (images.length > 0) warning.images = images;
      if (item.description !== undefined) warning.rawDescription = item.description;

      return warning;
    });
    return applyFilter(warnings, filter);
  }
}
