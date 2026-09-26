import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRss, parseDescription, decodeEntities } from "../src/client/rss.js";
import * as fx from "./fixtures.js";

test("decodeEntities decodes named, decimal and hex refs", () => {
  assert.equal(decodeEntities("R&#228;ucherk&#228;se"), "Räucherkäse");
  assert.equal(decodeEntities("A &amp; B &lt;x&gt;"), "A & B <x>");
  assert.equal(decodeEntities("&#x263A;"), "☺");
});

test("decodeEntities leaves an unknown named entity untouched", () => {
  assert.equal(decodeEntities("100&euro;"), "100&euro;");
});

test("decodeEntities does not decode a surrogate-range code point", () => {
  assert.equal(decodeEntities("&#xD800;"), "&#xD800;");
});

test("parseRss reads channel metadata (not an item's title)", () => {
  const feed = parseRss(fx.feedXml);
  assert.equal(feed.channel.title, "Lebensmittelwarnung.de - Alle Bundesländer - Alle Produkttypen");
  assert.equal(feed.channel.ttl, "60");
  assert.equal(feed.channel.link, "https://www.lebensmittelwarnung.de/");
});

test("parseRss returns every item in feed order", () => {
  const feed = parseRss(fx.feedXml);
  assert.equal(feed.items.length, 3);
  assert.equal(feed.items[0]!.title, "Räucherschmelzkäse-Zubereitung, Scheiben 175 Gramm");
  assert.equal(feed.items[1]!.title, "ja! Beerenmischung, tiefgefroren, 750 Gramm Beutel");
});

test("parseRss decodes entities in the title and keeps the CDATA description verbatim", () => {
  const feed = parseRss(fx.feedXml);
  const item = feed.items[0]!;
  assert.match(item.title!, /Räucherschmelzkäse/);
  // The description keeps its raw HTML/CDATA content (entities inside untouched).
  assert.match(item.description!, /<b>Grund der Meldung:<\/b>/);
  assert.match(item.description!, /&#246;rper/); // Fremdkörper, not yet decoded
});

test("parseRss reads the RFC-822 pubDate", () => {
  const feed = parseRss(fx.feedXml);
  assert.equal(feed.items[0]!.pubDate, "Fri, 10 Jul 2026 14:00:00 +0200");
});

test("parseRss handles a channel with no items", () => {
  const feed = parseRss(fx.sparseFeedXml);
  assert.equal(feed.items.length, 0);
  assert.match(feed.channel.title!, /Mittel zum Tätowieren/);
});

test("parseRss throws on a document with no <channel>", () => {
  assert.throws(() => parseRss("<html><body>nope</body></html>"), /No <channel>/);
});

test("parseDescription extracts the label→value field map", () => {
  const feed = parseRss(fx.feedXml);
  const { fields } = parseDescription(feed.items[0]!.description!);
  assert.equal(fields["Grund der Meldung"], "Fremdkörper");
  assert.equal(fields["Verpackungseinheit"], "175 Gramm-Packung");
  assert.equal(fields["Chargennummer / Los-Kennzeichnung"], "722641, 912641");
  assert.equal(fields["Haltbarkeit"], "17.08.2026; 22.08.2026");
});

test("parseDescription collapses the manufacturer's embedded newlines to one line", () => {
  const feed = parseRss(fx.feedXml);
  const { fields } = parseDescription(feed.items[0]!.description!);
  assert.equal(
    fields["Hersteller / Inverkehrbringer"],
    "Sales & Service Aktuell GmbH Am Weißbach 5 98646 Straufhain",
  );
});

test("parseDescription collects every image URL and decodes entities in the src", () => {
  const feed = parseRss(fx.feedXml);
  const { imageUrls } = parseDescription(feed.items[0]!.description!);
  assert.equal(imageUrls.length, 1);
  assert.equal(imageUrls[0], "https://www.lebensmittelwarnung.de/bild.png?__blob=normal&v=1");
});

test("parseDescription handles an item with no images", () => {
  const feed = parseRss(fx.feedXml);
  const { imageUrls, fields } = parseDescription(feed.items[2]!.description!);
  assert.equal(imageUrls.length, 0);
  assert.equal(fields["Grund der Meldung"], "mikrobiologische Verunreinigung");
});

test("parseRss rejects an unterminated element instead of returning a partial feed", () => {
  assert.throws(() => parseRss("<rss><channel><title>t</title>" + "<item>".repeat(3)), /Unterminated element <item>/);
  assert.throws(
    () => parseRss("<rss><channel><item><description>x</channel></rss>"),
    /Unterminated element <description>/,
  );
  assert.throws(() => parseRss("<rss><channel><item><title>a</title></item>"), /Unterminated element <channel>/);
  assert.throws(() => parseRss("<rss><channel><!-- x"), /Unterminated comment/);
  assert.throws(() => parseRss("<rss><channel><item><description><![CDATA[x"), /Unterminated CDATA/);
  assert.throws(() => parseRss('<rss><channel><item a="x>'), /Unterminated attribute value/);
});

test("parseRss is linear on hostile input (no lazy-regex rescans)", () => {
  // 742 KiB of unclosed <item><description> pairs took 14 s with the old regex parser.
  const hostile = "<rss><channel>" + "<item><description>".repeat(40_000);
  const started = Date.now();
  assert.throws(() => parseRss(hostile), /Unterminated/);
  const many = "<rss><channel>" + "<item><title>a</title></item>".repeat(40_000) + "</channel></rss>";
  assert.equal(parseRss(many).items.length, 40_000);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});

test("parseDescription is linear on hostile input", () => {
  // 292 KiB of unclosed <b> took 6 s with the old pair regex.
  const started = Date.now();
  assert.deepEqual(parseDescription("<b>".repeat(100_000)).fields, {});
  assert.deepEqual(parseDescription('<img src="x'.repeat(100_000)).imageUrls, []);
  assert.deepEqual(parseDescription("<img ".repeat(100_000)).imageUrls, []);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});
