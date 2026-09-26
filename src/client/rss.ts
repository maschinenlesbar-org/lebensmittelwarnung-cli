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

import { HTML_ENTITIES } from "./entities.js";

/**
 * Maximum number of `<item>` elements accepted from a single feed (DoS guard). A
 * feed with more is an error, not silently cut (the live feed has a few hundred).
 */
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

/**
 * Decode the five predefined XML entities, numeric (`&#NN;` / `&#xNN;`) refs and the
 * HTML 4 named references (`&auml;`, `&ndash;`, `&euro;`, … — the description is
 * HTML).
 */
export function decodeEntities(text: string): string {
  // Hex (`#x…`) and decimal (`#…`) forms use separate character classes so a
  // malformed decimal ref that contains hex letters (`&#1F;`) does NOT match the
  // decimal branch and get truncated at the first non-digit by `parseInt(…, 10)`.
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
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
    const named = HTML_ENTITIES.get(body);
    if (named !== undefined) return String.fromCodePoint(named);
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

/** An XML/HTML name at a given offset (sticky, so it never scans ahead). */
const NAME = /[A-Za-z_:][\w.:-]*/y;

/**
 * Find `needle` from `from` on, or throw: a construct that is opened but never
 * closed is malformed XML. Throwing (instead of skipping the opener and scanning on,
 * as a lazy `[\s\S]*?` regex does at every candidate) keeps the scan linear.
 */
function endOf(xml: string, needle: string, from: number, what: string): number {
  const end = xml.indexOf(needle, from);
  if (end === -1) throw new Error(`Unterminated ${what} at offset ${from}`);
  return end;
}

/** The item leaves this parser reads, keyed by lower-cased element name. */
const ITEM_LEAVES: Record<string, keyof RawRssItem> = {
  title: "title",
  link: "link",
  pubdate: "pubDate",
  guid: "guid",
  description: "description",
};

/** The channel leaves this parser reads, keyed by lower-cased element name. */
const CHANNEL_LEAVES: Record<string, keyof RssChannel> = {
  title: "title",
  link: "link",
  description: "description",
  language: "language",
  ttl: "ttl",
};

/** A leaf element being read: its text content is collected until its close tag. */
interface Leaf {
  name: string;
  target: Record<string, string | undefined>;
  key: string;
  /** Nesting of same-named elements inside the leaf (1 = the leaf itself). */
  depth: number;
  parts: string[];
}

/**
 * Parse an RSS 2.0 document into its channel metadata and raw items. Throws on a
 * document with no `<channel>` (e.g. the portal's HTML shell or an empty body —
 * the engine turns those into a typed LebensmittelwarnungParseError first, but
 * this is a defensive backstop), and on an unterminated element, comment, CDATA
 * section, processing instruction, declaration or tag (a truncated or hostile body).
 *
 * A single forward scan (`indexOf` for every terminator), so parsing time is linear
 * in the size of the body, whatever it contains. Only the direct children of the
 * first `<channel>` and of its `<item>`s are read; a leaf's text is its decoded text
 * plus its CDATA sections verbatim, and markup inside a leaf is kept as written.
 * Element names match case-insensitively. The first occurrence of a leaf wins.
 */
export function parseRss(xml: string): RssFeed {
  const stack: string[] = [];
  const items: RawRssItem[] = [];
  let channel: RssChannel | undefined;
  let channelAt = -1; // stack index of the channel element while it is open
  let item: RawRssItem | undefined;
  let itemAt = -1;
  let leaf: Leaf | undefined;

  const finishLeaf = (l: Leaf): void => {
    if (l.target[l.key] === undefined) l.target[l.key] = l.parts.join("").trim();
  };
  const closeTo = (index: number): void => {
    // Pop the element at `index` and everything opened inside it.
    while (stack.length > index) {
      stack.pop();
      if (stack.length === itemAt && item !== undefined) {
        items.push(item);
        item = undefined;
        itemAt = -1;
      }
      if (stack.length === channelAt) channelAt = -1;
    }
  };

  let i = 0;
  const n = xml.length;
  while (i < n) {
    if (xml[i] !== "<") {
      const next = xml.indexOf("<", i);
      const end = next === -1 ? n : next;
      if (leaf) leaf.parts.push(decodeEntities(xml.slice(i, end)));
      i = end;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const end = endOf(xml, "]]>", i + 9, "CDATA section");
      if (leaf) leaf.parts.push(xml.slice(i + 9, end));
      i = end + 3;
    } else if (xml.startsWith("<!--", i)) {
      i = endOf(xml, "-->", i + 4, "comment") + 3;
    } else if (xml.startsWith("<?", i)) {
      i = endOf(xml, "?>", i + 2, "processing instruction") + 2;
    } else if (xml.startsWith("<!", i)) {
      // A declaration such as <!DOCTYPE …>, skipped. An internal subset
      // (`<!DOCTYPE x [ … ]>`) may itself contain `>`, so skip past its `]` first.
      // Entities declared there are never expanded.
      const close = endOf(xml, ">", i + 2, "declaration");
      const open = xml.slice(i + 2, close).indexOf("[");
      const from = open === -1 ? close : endOf(xml, "]", i + 2 + open + 1, "declaration");
      i = endOf(xml, ">", from, "declaration") + 1;
    } else if (xml[i + 1] === "/") {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(xml);
      let j = NAME.lastIndex;
      while (m !== null && j < n && /\s/.test(xml[j]!)) j += 1;
      if (m === null || xml[j] !== ">") {
        // Not a close tag: keep the "<" as text and read on.
        if (leaf) leaf.parts.push("<");
        i += 1;
        continue;
      }
      const name = m[0].toLowerCase();
      if (leaf) {
        if (name === leaf.name && --leaf.depth === 0) {
          finishLeaf(leaf);
          leaf = undefined;
        } else {
          leaf.parts.push(xml.slice(i, j + 1));
        }
      } else {
        const at = stack.lastIndexOf(name);
        if (at !== -1) closeTo(at); // else: a stray close tag, ignored
      }
      i = j + 1;
    } else {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(xml);
      if (m === null) {
        // A lone "<" that starts nothing: keep it as text and read on.
        if (leaf) leaf.parts.push("<");
        i += 1;
        continue;
      }
      // Open (or self-closing) tag: find its ">" outside quoted attribute values.
      let j = NAME.lastIndex;
      while (j < n && xml[j] !== ">") {
        const c = xml[j];
        if (c === '"' || c === "'") j = endOf(xml, c, j + 1, "attribute value");
        j += 1;
      }
      if (j >= n) throw new Error(`Unterminated tag <${m[0]}> at offset ${i}`);
      const name = m[0].toLowerCase();
      const selfClosing = xml[j - 1] === "/";
      if (leaf) {
        if (name === leaf.name && !selfClosing) leaf.depth += 1;
        leaf.parts.push(xml.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      const depth = stack.length;
      let key: string | undefined;
      let target: Record<string, string | undefined> | undefined;
      if (channel === undefined && name === "channel") {
        channel = {};
        channelAt = depth;
      } else if (channelAt !== -1 && depth === channelAt + 1 && channel !== undefined) {
        if (name === "item") {
          if (items.length >= MAX_ITEMS) {
            throw new Error(`The feed has more than ${MAX_ITEMS} items, the most this parser accepts`);
          }
          item = {};
          itemAt = depth;
          if (selfClosing) {
            items.push(item);
            item = undefined;
            itemAt = -1;
          }
        } else if (Object.hasOwn(CHANNEL_LEAVES, name)) {
          key = CHANNEL_LEAVES[name];
          target = channel as Record<string, string | undefined>;
        }
      } else if (item !== undefined && depth === itemAt + 1 && Object.hasOwn(ITEM_LEAVES, name)) {
        key = ITEM_LEAVES[name];
        target = item as Record<string, string | undefined>;
      }
      if (key !== undefined && target !== undefined) {
        const l: Leaf = { name, target, key, depth: 1, parts: [] };
        if (selfClosing) finishLeaf(l);
        else leaf = l;
      } else if (!selfClosing) {
        stack.push(name);
      }
      i = j + 1;
    }
  }

  if (leaf) throw new Error(`Unterminated element <${leaf.name}>`);
  const open = stack[stack.length - 1];
  if (open !== undefined) throw new Error(`Unterminated element <${open}>`);
  if (channel === undefined) {
    throw new Error("No <channel> element found in RSS document");
  }
  return { channel, items };
}

/** The structured result of parsing one item's HTML `<description>`. */
export interface ParsedDescription {
  /** Every `<b>Label:</b> value` pair, keyed by the (trailing-colon-stripped) label. */
  fields: Record<string, string>;
  /** Every image URL from an `<img src=…>` in the description, in order. */
  imageUrls: string[];
  /**
   * The same images, each with its own credit: the "Bildquelle" caption that follows
   * it (before the next image). `credit` is absent for an image without one.
   */
  images: DescriptionImage[];
}

/** One image of a description with its credit ("Bildquelle"), as served. */
export interface DescriptionImage {
  url: string;
  credit?: string;
}

/** The caption label that credits the image before it. */
const IMAGE_CREDIT_LABEL = "Bildquelle";

/** `url` resolved against `base`, or `url` unchanged without a base or when it fails. */
function resolveUrl(url: string, base: string | undefined): string {
  if (base === undefined) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** One token of an HTML fragment: a run of text or a tag. */
type HtmlToken =
  | { kind: "text"; text: string }
  | { kind: "tag"; name: string; close: boolean; attrs: string };

/**
 * Split an HTML fragment into text runs and tags in one forward scan (linear time).
 * Comments are dropped; a "<" that starts no tag is text. An unterminated comment,
 * tag or quoted attribute value ends the fragment there — this is lenient on
 * purpose, as the description is HTML, not XML.
 */
function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const n = html.length;
  let i = 0;
  let textFrom = 0;
  const flush = (to: number): void => {
    if (to > textFrom) tokens.push({ kind: "text", text: html.slice(textFrom, to) });
  };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      flush(lt);
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) return tokens;
      i = textFrom = end + 3;
      continue;
    }
    const close = html[lt + 1] === "/";
    NAME.lastIndex = lt + (close ? 2 : 1);
    const m = NAME.exec(html);
    if (m === null) {
      i = lt + 1; // a lone "<": part of the text
      continue;
    }
    let j = NAME.lastIndex;
    while (j < n && html[j] !== ">") {
      const c = html[j];
      if (c === '"' || c === "'") {
        const q = html.indexOf(c, j + 1);
        if (q === -1) {
          flush(lt);
          return tokens;
        }
        j = q;
      }
      j += 1;
    }
    flush(lt);
    if (j >= n) return tokens;
    let attrs = html.slice(NAME.lastIndex, j);
    if (attrs.endsWith("/")) attrs = attrs.slice(0, -1);
    tokens.push({ kind: "tag", name: m[0].toLowerCase(), close, attrs });
    i = textFrom = j + 1;
  }
  flush(n);
  return tokens;
}

/** Read one attribute's value from a tag's raw attribute text (linear scan). */
function attribute(raw: string, wanted: string): string | undefined {
  let i = 0;
  while (i < raw.length) {
    NAME.lastIndex = i;
    const m = NAME.exec(raw);
    if (m === null) {
      i += 1;
      continue;
    }
    i = NAME.lastIndex;
    while (i < raw.length && /\s/.test(raw[i]!)) i += 1;
    if (raw[i] !== "=") continue;
    i += 1;
    while (i < raw.length && /\s/.test(raw[i]!)) i += 1;
    let value: string;
    const quote = raw[i];
    if (quote === '"' || quote === "'") {
      const end = raw.indexOf(quote, i + 1);
      if (end === -1) return undefined;
      value = raw.slice(i + 1, end);
      i = end + 1;
    } else {
      const from = i;
      while (i < raw.length && !/\s/.test(raw[i]!)) i += 1;
      value = raw.slice(from, i);
    }
    if (m[0].toLowerCase() === wanted) return decodeEntities(value.trim());
  }
  return undefined;
}

/**
 * Turn one item's HTML description into a `{ fields, imageUrls }` structure.
 *
 * The description is a flat run of `<img …/>` tags and `<b>Label:</b> value`
 * pairs joined by `<br/>`. We:
 *   - collect every `<img src="…">` URL, resolved against `baseUrl` when given (a
 *     relative `src` is otherwise useless outside the portal's page);
 *   - let each bold label (`<b>` or `<strong>`, with or without attributes) own the
 *     text up to the next bold label, dropping the residual tags from that value
 *     and collapsing its whitespace.
 *
 * Labels repeat across item types but not always (a "Bildquelle" caption has no
 * colon and its own following text); we keep the LAST value for a repeated label
 * rather than concatenating, which matches how the portal renders single-valued
 * fields. The one label that does repeat with different values is the image credit
 * ("Bildquelle", one per image), so `images` pairs each image with the credit that
 * follows it. The raw description stays available on the item for anyone who needs more.
 *
 * One forward scan over the fragment, so the cost is linear in its length.
 */
export function parseDescription(html: string, baseUrl?: string): ParsedDescription {
  const imageUrls: string[] = [];
  const images: DescriptionImage[] = [];
  const fields: Record<string, string> = {};
  let label: string[] | undefined; // collecting a label's text (inside <b>/<strong>)
  let labelTag = ""; // the tag that opened the label, whose close tag ends it
  // `image`: for a credit caption, the index of the image it follows (the value is
  // only complete at the next label, after the next <img> may have been seen).
  let value: { label: string; parts: string[]; image: number } | undefined;

  const finishValue = (): void => {
    if (value === undefined) return;
    // Collapse all whitespace (incl. the manufacturer's embedded newlines) to a
    // single space and trim; keep the last non-empty value for a repeated label.
    const text = value.parts.join("").replace(/\s+/g, " ").trim();
    if (value.label === IMAGE_CREDIT_LABEL) {
      const image = images[value.image];
      if (image !== undefined && image.credit === undefined && text !== "") image.credit = text;
    }
    if (text !== "") fields[value.label] = text;
    else if (!Object.hasOwn(fields, value.label)) fields[value.label] = "";
    value = undefined;
  };

  for (const token of tokenizeHtml(html)) {
    if (token.kind === "text") {
      const text = decodeEntities(token.text);
      if (label) label.push(text);
      else if (value) value.parts.push(text);
      continue;
    }
    if (token.name === "img" && !token.close) {
      const raw = attribute(token.attrs, "src");
      const src = raw ? resolveUrl(raw, baseUrl) : raw;
      if (src) {
        imageUrls.push(src);
        images.push({ url: src });
      }
    }
    if (token.name === "b" || token.name === "strong") {
      if (!token.close && label === undefined) {
        finishValue();
        label = [];
        labelTag = token.name;
        continue;
      }
      if (token.close && label && token.name === labelTag) {
        const name = label.join("").trim().replace(/:\s*$/, "");
        label = undefined;
        if (name !== "") value = { label: name, parts: [], image: images.length - 1 };
        continue;
      }
    }
    // Any other tag separates words, like the whitespace it usually stands for.
    if (label) label.push(" ");
    else if (value) value.parts.push(" ");
  }
  finishValue();
  return { fields, imageUrls, images };
}
