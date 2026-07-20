// A tiny, dependency-free RSS 2.0 parser — just enough for the
// lebensmittelwarnung.de product-warning feeds.
//
// The feeds are shallow `<rss><channel>…<item>…</item></channel></rss>` documents.
// Each `<item>` has plain-text `<title>`/`<link>`/`<pubDate>`/`<guid>` leaves and a
// `<description>` whose body is an HTML fragment wrapped in a CDATA section. The
// HTML holds `<img src=…>` thumbnails and a run of `<b>Label:</b> value` pairs
// separated by `<br/>`.
//
// This module does two things:
//   1. `parseRss` — turn the XML into a `{ channel, items }` structure (the channel
//      metadata plus the raw per-item leaves, description kept verbatim);
//   2. `parseDescription` — turn one item's HTML description into a generic
//      label→value map plus the extracted image URLs.
//
// It is deliberately NOT a general-purpose parser (no namespaces, DTDs, or full
// mixed-content reconstruction) — just enough for these feeds, and exercised hard
// in rss.test.ts against real feed shapes.

/** Maximum number of `<item>` elements accepted from a single feed (DoS guard). */
const MAX_ITEMS = 100_000;

/** Raw, un-projected RSS item: the leaf elements exactly as the feed serves them. */
export interface RawRssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  guid?: string;
  /** The `<description>` body, kept verbatim (HTML inside a CDATA section). */
  description?: string;
}

/** Channel-level metadata from `<channel>`. */
export interface RssChannel {
  title?: string;
  link?: string;
  description?: string;
  language?: string;
  ttl?: string;
}

export interface RssFeed {
  channel: RssChannel;
  items: RawRssItem[];
}

/** Decode the five predefined XML entities plus numeric (`&#NN;` / `&#xNN;`) refs. */
export function decodeEntities(text: string): string {
  // Hex (`#x…`) and decimal (`#…`) forms use separate character classes so a
  // malformed decimal ref that contains hex letters (`&#1F;`) does NOT match the
  // decimal branch and get truncated at the first non-digit by `parseInt(…, 10)`.
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "nbsp":
        return " ";
    }
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Reject out-of-range and UTF-16 surrogate-range (0xD800–0xDFFF) code points:
      // decoding a lone surrogate would yield an ill-formed string. Leave the
      // original reference untouched instead.
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
    }
    // Unknown named entity: leave it untouched rather than dropping information.
    return whole;
  });
}

/**
 * Extract the text content of the first `<tag>…</tag>` child inside `scope`.
 * Handles a CDATA body (kept verbatim) or plain text (entity-decoded + trimmed).
 * Returns `undefined` when the tag is absent, `""` for an empty/self-closed tag.
 */
function extractTag(scope: string, tag: string): string | undefined {
  // Self-closing form (`<pubDate/>`) → empty string.
  const selfClose = new RegExp(`<${tag}\\s*/>`, "i");
  const openIdx = scope.search(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i"));
  if (openIdx === -1) {
    return selfClose.test(scope) ? "" : undefined;
  }
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i").exec(scope);
  if (!open) return selfClose.test(scope) ? "" : undefined;
  const start = open.index + open[0].length;
  const closeRe = new RegExp(`</${tag}\\s*>`, "i");
  const rest = scope.slice(start);
  const closeM = closeRe.exec(rest);
  if (!closeM) return undefined;
  const inner = rest.slice(0, closeM.index);
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(inner);
  if (cdata) return cdata[1] ?? "";
  return decodeEntities(inner).trim();
}

/**
 * Parse an RSS 2.0 document into its channel metadata and raw items. Throws on a
 * document with no `<channel>` (e.g. the portal's HTML shell or an empty body —
 * the engine turns those into a typed LebensmittelwarnungParseError first, but
 * this is a defensive backstop).
 */
export function parseRss(xml: string): RssFeed {
  const channelM = /<channel(?:\s[^>]*)?>([\s\S]*?)<\/channel>/i.exec(xml);
  if (!channelM || channelM[1] === undefined) {
    throw new Error("No <channel> element found in RSS document");
  }
  const channelScope = channelM[1];

  // Channel metadata comes from the channel scope with its <item>…</item> blocks
  // removed, so an item's own <title>/<link> can never be mistaken for the channel's.
  const channelHead = channelScope.replace(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi, "");
  const channel: RssChannel = {};
  for (const key of ["title", "link", "description", "language", "ttl"] as const) {
    const v = extractTag(channelHead, key);
    if (v !== undefined) channel[key] = v;
  }

  const items: RawRssItem[] = [];
  const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(channelScope)) !== null) {
    if (items.length >= MAX_ITEMS) break;
    const scope = m[1] ?? "";
    const item: RawRssItem = {};
    for (const key of ["title", "link", "pubDate", "guid", "description"] as const) {
      const v = extractTag(scope, key);
      if (v !== undefined) item[key] = v;
    }
    items.push(item);
  }

  return { channel, items };
}

/** The structured result of parsing one item's HTML `<description>`. */
export interface ParsedDescription {
  /** Every `<b>Label:</b> value` pair, keyed by the (trailing-colon-stripped) label. */
  fields: Record<string, string>;
  /** Every image URL from an `<img src=…>` in the description, in order. */
  imageUrls: string[];
}

/**
 * Turn one item's HTML description into a `{ fields, imageUrls }` structure.
 *
 * The description is a flat run of `<img …/>` tags and `<b>Label:</b> value`
 * pairs joined by `<br/>`. We:
 *   - collect every `<img src="…">` URL;
 *   - split the remaining markup on `<b>…</b>` boundaries so each bold label owns
 *     the text up to the next bold label, then strip the residual tags from that
 *     value and collapse its whitespace.
 *
 * Labels repeat across item types but not always (a "Bildquelle" caption has no
 * colon and its own following text); we keep the LAST value for a repeated label
 * rather than concatenating, which matches how the portal renders single-valued
 * fields. The raw description stays available on the item for anyone who needs more.
 */
export function parseDescription(html: string): ParsedDescription {
  const imageUrls: string[] = [];
  const imgRe = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(html)) !== null) {
    const src = im[1] ?? im[2];
    if (src) imageUrls.push(decodeEntities(src.trim()));
  }

  const fields: Record<string, string> = {};
  // Match each <b>label</b> and capture everything up to the next <b> (or the end).
  const pairRe = /<b\s*>([\s\S]*?)<\/b>([\s\S]*?)(?=<b\s*>|$)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pairRe.exec(html)) !== null) {
    const rawLabel = stripTags(pm[1] ?? "").trim().replace(/:\s*$/, "");
    if (rawLabel === "") continue;
    const rawValue = stripTags(pm[2] ?? "");
    // Collapse all whitespace (incl. the manufacturer's embedded newlines) to a
    // single space and trim; keep the last non-empty value for a repeated label.
    const value = rawValue.replace(/\s+/g, " ").trim();
    if (value !== "") fields[rawLabel] = value;
    else if (!(rawLabel in fields)) fields[rawLabel] = "";
  }
  return { fields, imageUrls };
}

/** Strip HTML tags from a fragment and decode entities in the remaining text. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "));
}
