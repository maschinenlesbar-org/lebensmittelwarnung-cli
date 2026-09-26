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
  assert.equal(decodeEntities("100&bogus; &Euro;"), "100&bogus; &Euro;");
});

test("decodeEntities decodes HTML named references (the description is HTML)", () => {
  assert.equal(decodeEntities("K&auml;se &ndash; 5&euro; &#8211; &shy;x"), "Käse – 5€ – \u00adx");
  assert.equal(decodeEntities("&Auml;&szlig;&bdquo;a&ldquo;&hellip;&copy;"), "Äß„a“…©");
  assert.equal(decodeEntities("&frac12; kg, 20&deg;C, m&sup2;"), "½ kg, 20°C, m²");
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

test("parseDescription pairs each image with the Bildquelle credit that follows it", () => {
  // Live shape of 260725_27_BY_Beeren (2026-09-26): two images, two different credits.
  const html =
    '<img src="https://x/a.jpg?__blob=normal&amp;v=1" width="100" /><br/><b>Bildquelle</b> © Netto Marken Discount<br/>' +
    '<img src="https://x/b.jpg?__blob=normal&amp;v=2" width="100" /><br/><b>Bildquelle</b> © Jütro Tiefkühlkost GmbH &amp; Co. KG<br/>' +
    '<img src="https://x/c.jpg" /><br/><b>Grund der Meldung:</b> Krankheitserreger<br/>';
  const { images, imageUrls, fields } = parseDescription(html);
  assert.deepEqual(images, [
    { url: "https://x/a.jpg?__blob=normal&v=1", credit: "© Netto Marken Discount" },
    { url: "https://x/b.jpg?__blob=normal&v=2", credit: "© Jütro Tiefkühlkost GmbH & Co. KG" },
    { url: "https://x/c.jpg" },
  ]);
  assert.deepEqual(imageUrls, images.map((i) => i.url));
  assert.equal(fields["Bildquelle"], "© Jütro Tiefkühlkost GmbH & Co. KG"); // last one, as before
});

test("parseRss: a </item> inside a CDATA description does not end the item", () => {
  const feed = parseRss(
    "<rss><channel><title>t</title>" +
      "<item><title>A</title><description><![CDATA[<b>Grund der Meldung:</b> x </item> y]]></description></item>" +
      "<item><title>B</title></item></channel></rss>",
  );
  assert.deepEqual(feed.items.map((i) => i.title), ["A", "B"]);
  assert.equal(feed.items[0]!.description, "<b>Grund der Meldung:</b> x </item> y");
});

test("parseRss joins several CDATA sections of one description", () => {
  const feed = parseRss(
    "<rss><channel><item><description><![CDATA[<b>Grund der Meldung:</b> a]]> <![CDATA[<br/><b>Haltbarkeit:</b> b]]></description></item></channel></rss>",
  );
  assert.deepEqual(parseDescription(feed.items[0]!.description!).fields, {
    "Grund der Meldung": "a",
    Haltbarkeit: "b",
  });
});

test("parseRss skips a commented-out item", () => {
  const feed = parseRss(
    "<rss><channel><!-- <item><title>ghost</title></item> --><item><title>real</title></item></channel></rss>",
  );
  assert.deepEqual(feed.items.map((i) => i.title), ["real"]);
});

test("parseDescription reads labels in <b> with attributes and in <strong>", () => {
  const { fields } = parseDescription(
    '<b class="x">Grund der Meldung:</b> Fremdkörper<br/><strong>Haltbarkeit:</strong> 01.01.2027<br/><b>Verpackungseinheit:</b> 1kg',
  );
  assert.deepEqual(fields, {
    "Grund der Meldung": "Fremdkörper",
    Haltbarkeit: "01.01.2027",
    Verpackungseinheit: "1kg",
  });
});

test("parseDescription resolves a relative image URL against the given base", () => {
  const html = '<img src="rel/pic.jpg"/><img src="/abs.jpg"/><img src="https://cdn.test/x.jpg"/>';
  assert.deepEqual(parseDescription(html, "https://www.lebensmittelwarnung.de/Meldungen/2026/a.html").imageUrls, [
    "https://www.lebensmittelwarnung.de/Meldungen/2026/rel/pic.jpg",
    "https://www.lebensmittelwarnung.de/abs.jpg",
    "https://cdn.test/x.jpg",
  ]);
  assert.deepEqual(parseDescription(html).imageUrls, ["rel/pic.jpg", "/abs.jpg", "https://cdn.test/x.jpg"]);
});

test("parseDescription decodes HTML entities in labels and values", () => {
  const { fields } = parseDescription("<b>Grund der Meldung:</b> K&auml;se &ndash; Fremdk&ouml;rper");
  assert.equal(fields["Grund der Meldung"], "Käse – Fremdkörper");
});
