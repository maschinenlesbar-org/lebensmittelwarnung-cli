// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome (see
// .reviews/2026-10-03-cli-library-parity/lebensmittelwarnung-cli.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { LebensmittelwarnungClient } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/client";
import { LebensmittelwarnungValidationError } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/errors";
import type { WarningsQuery } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/types";
import { parity, rssResponse } from "./helpers.js";

// ---- Finding 1: warnings --since / --search / --limit ----

const item = (title: string, pubDate: string | undefined, product?: string) =>
  `<item><title>${title}</title><link>https://www.lebensmittelwarnung.de/${encodeURIComponent(title)}.html</link>` +
  (pubDate === undefined ? "" : `<pubDate>${pubDate}</pubDate>`) +
  `<description><![CDATA[${product === undefined ? "" : `<b>Produktbezeichnung/ -beschreibung:</b> ${product}<br/>`}` +
  `<b>Grund der Meldung:</b> Test<br/>]]></description></item>`;

/** The report's feed: German midnight, late evening, an old item and one without a date. */
const narrowFeedXml =
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title>` +
  item("Erdbeeren Bio", "Fri, 4 Sep 2026 00:00:00 +0200") +
  item("Spätes Teil", "Thu, 3 Sep 2026 23:59:00 +0200", "Himbeeren") +
  item("Alt", "Tue, 30 Jun 2026 09:30:00 +0200", "BIO Honig") +
  item("OhneDatum", undefined) +
  `</channel></rss>`;

const titles = (value: unknown) => (value as Array<{ title?: string }>).map((w) => w.title);

test("warnings narrowing: since/search/limit give the CLI's result through the library too", async () => {
  for (const [argv, query, expected] of [
    [["--since", "2026-09-04"], { since: "2026-09-04" }, ["Erdbeeren Bio"]],
    [["--since", "2026-09-03"], { since: "2026-09-03" }, ["Erdbeeren Bio", "Spätes Teil"]],
    [["--since", " 2026-09-03 "], { since: " 2026-09-03 " }, ["Erdbeeren Bio", "Spätes Teil"]],
    [["--search", " bio "], { search: " bio " }, ["Erdbeeren Bio", "Alt"]],
    [["--search", "beeren"], { search: "beeren" }, ["Erdbeeren Bio", "Spätes Teil"]],
    [["--limit", "1"], { limit: 1 }, ["Erdbeeren Bio"]],
    [
      ["--since", "2026-06-01", "--search", "bio", "--limit", "1"],
      { since: "2026-06-01", search: "bio", limit: 1 },
      ["Erdbeeren Bio"],
    ],
  ] as const) {
    const label = JSON.stringify(argv);
    const { cli, lib } = await parity(
      ["--compact", "warnings", ...argv],
      (transport) => new LebensmittelwarnungClient({ transport }).warnings(query as WarningsQuery),
      () => rssResponse(narrowFeedXml),
    );
    assert.equal(cli.code, 0, label);
    assert.deepEqual(titles(JSON.parse(cli.out)), expected, label);
    assert.ok(lib.ok, label);
    assert.deepEqual(titles(lib.value), expected, label);
    assert.deepEqual(cli.requests, lib.requests, label);
  }
});

test("warnings narrowing: a value the CLI rejects is rejected by the library too, with no request", async () => {
  for (const [argv, query, reason] of [
    [["--since", "2026-02-30"], { since: "2026-02-30" }, "Not a valid calendar date."],
    [["--since", "10.07.2026"], { since: "10.07.2026" }, "Expected a date in YYYY-MM-DD format."],
    [["--search", "  "], { search: "  " }, "Expected a non-empty value."],
    [["--search", ""], { search: "" }, "Expected a non-empty value."],
    [["--limit", "0"], { limit: 0 }, "Must be >= 1."],
    [["--limit", "100001"], { limit: 100001 }, "Must be <= 100000."],
  ] as const) {
    const label = JSON.stringify(argv);
    const { cli, lib } = await parity(
      ["--compact", "warnings", ...argv],
      (transport) => new LebensmittelwarnungClient({ transport }).warnings(query as WarningsQuery),
      () => rssResponse(narrowFeedXml),
    );
    assert.equal(cli.code, 2, label);
    assert.ok(cli.err.includes(reason), label);
    assert.equal(cli.requests.length, 0, label);
    assert.ok(!lib.ok && lib.error instanceof LebensmittelwarnungValidationError, label);
    const name = Object.keys(query)[0]!;
    assert.equal((lib as { error: Error }).error.message, `Invalid ${name}: ${reason}`, label);
    assert.equal(lib.requests.length, 0, label);
  }
});

// ---- Finding 2: --user-agent / userAgent ----

test("user agent: a value the CLI rejects is rejected by the library too, with no request", async () => {
  for (const [ua, reason] of [
    ["", "Expected a non-empty value."],
    ["   ", "Expected a non-empty value."],
    ["a\r\nX-Inj: 1", "Value contains control characters."],
    ["a\u007f", "Value contains control characters."],
    ["a\u0000b", "Value contains control characters."],
    ["€", "Value contains characters outside Latin-1 (above U+00FF)."],
  ] as const) {
    const label = JSON.stringify(ua);
    const { cli, lib } = await parity(
      ["--compact", "--user-agent", ua, "warnings"],
      (transport) => new LebensmittelwarnungClient({ transport, userAgent: ua }).warnings(),
      () => rssResponse(narrowFeedXml),
    );
    assert.equal(cli.code, 2, label);
    assert.ok(cli.err.includes(reason), label);
    assert.equal(cli.requests.length, 0, label);
    assert.ok(!lib.ok && lib.error instanceof LebensmittelwarnungValidationError, label);
    assert.equal((lib as { error: Error }).error.message, `Invalid userAgent: ${reason}`, label);
    assert.equal(lib.requests.length, 0, label);
  }
});

test("user agent: tab, Latin-1 and padded values are sent identically by both", async () => {
  for (const ua of ["a\tb", "agent-ä", " x "]) {
    const { cli, lib } = await parity(
      ["--compact", "--user-agent", ua, "warnings"],
      (transport) => new LebensmittelwarnungClient({ transport, userAgent: ua }).warnings(),
      () => rssResponse(narrowFeedXml),
    );
    assert.equal(cli.code, 0, ua);
    assert.ok(lib.ok, ua);
    assert.equal(cli.requests[0]!.headers?.["User-Agent"], ua);
    assert.deepEqual(cli.requests, lib.requests);
  }
});

// ---- Finding 3: --base-url / baseUrl ----

test("base URL: a value the CLI rejects is a LebensmittelwarnungValidationError in the library, no request", async () => {
  for (const [url, reason] of [
    ["https://h.example#f", "A base URL cannot have a query (?) or fragment (#)."],
    ["https://h.example/p?x=1", "A base URL cannot have a query (?) or fragment (#)."],
    ["", "Expected a non-empty URL."],
    ["  ", "Expected a non-empty URL."],
    ["/", "Expected a valid URL."],
    ["not a url", "Expected a valid URL."],
    ["ftp://h.example", "Only http: and https: base URLs are supported."],
  ] as const) {
    const label = JSON.stringify(url);
    const { cli, lib } = await parity(
      ["--base-url", url, "--compact", "warnings"],
      (transport) => new LebensmittelwarnungClient({ transport, baseUrl: url }).warnings(),
      () => rssResponse(narrowFeedXml),
    );
    assert.equal(cli.code, 2, label);
    assert.ok(cli.err.includes(reason), label);
    assert.equal(cli.requests.length, 0, label);
    assert.ok(!lib.ok && lib.error instanceof LebensmittelwarnungValidationError, label);
    assert.equal((lib as { error: Error }).error.message, `Invalid baseUrl: ${reason}`, label);
    assert.equal(lib.requests.length, 0, label);
  }
});

test("base URL: an accepted value gives the same request on both sides", async () => {
  for (const url of ["https://h.example/", "http://h.example/sub//"]) {
    const { cli, lib } = await parity(
      ["--base-url", url, "--compact", "warnings"],
      (transport) => new LebensmittelwarnungClient({ transport, baseUrl: url }).warnings(),
      () => rssResponse(narrowFeedXml),
    );
    assert.equal(cli.code, 0, url);
    assert.ok(lib.ok, url);
    assert.deepEqual(cli.requests, lib.requests, url);
  }
});

// ---- D10: a refusal quotes the value visibly ----

test("a refused --state/--type shows an invisible or control character escaped on both sides, never raw (D10)", async () => {
  for (const [option, key, value] of [
    ["--state", "state", "bay\u200bern"],
    ["--type", "type", "lebens\u00admittel"],
    ["--state", "state", "\u202ebayern"],
    ["--state", "state", "bay\u2066ern"],
  ] as const) {
    const o = await parity(["warnings", option, value], (t) =>
      new LebensmittelwarnungClient({ transport: t }).warnings({ [key]: value } as WarningsQuery));
    const ch = [...value].find((c) => /\p{Cf}/u.test(c)) ?? "";
    const escape = `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    assert.equal(o.cli.code, 2, `${option} ${JSON.stringify(value)}`);
    assert.deepEqual(o.cli.requests, []);
    assert.ok(o.cli.err.includes(escape), `${JSON.stringify(value)}: the CLI's refusal doesn't show ${escape}: ${o.cli.err}`);
    assert.ok(!o.cli.err.includes(ch), `${JSON.stringify(value)}: the CLI's refusal shows the character raw`);
    assert.equal(o.lib.ok, false);
    const message = o.lib.ok ? "" : (o.lib.error as Error).message;
    assert.ok(message.includes(escape), `${JSON.stringify(value)}: the library's refusal doesn't show ${escape}: ${message}`);
    assert.ok(!message.includes(ch), `${JSON.stringify(value)}: the library's refusal shows the character raw`);
  }
});

// ---- D8: every value is canonicalised or refused (the REFUSED corpus of conformance P24) ----

/** P24's REFUSED corpus: blank, only invisible characters or combining marks, a lone surrogate, a control or format character. */
const REFUSED = [
  "", " ", "\u00a0", "\n\t", "\u3000", "\u200b", "\u00ad", "\u200d", "\ufeff", "\u0301\u0308", " \u200b ",
  "a\u200bb", "M\u00fcl\u00adler", "\u202eabc", "a\u0000b", "a\u001bb", "a\u0085b", "\ud800", "a\udc00b", "x\ud83d",
];
/** A control, format or lone-surrogate character in `value`, or undefined. */
const INVISIBLE = /[\p{Cc}\p{Cf}]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;

test("--search, --state and --type refuse a blank, invisible, control or half character before any request, showing it escaped (D8, bug 1)", async () => {
  // P24's lists are empty in this repo (--search is matched client-side, the slugs are not free
  // text), so its REFUSED corpus runs here, through the CLI and the library alike.
  for (const [option, key] of [["--search", "search"], ["--state", "state"], ["--type", "type"]] as const) {
    for (const value of REFUSED) {
      const label = `${option} ${JSON.stringify(value)}`;
      const o = await parity(["warnings", option, value], (t) =>
        new LebensmittelwarnungClient({ transport: t }).warnings({ [key]: value } as WarningsQuery));
      assert.equal(o.cli.code, 2, `${label}: CLI exit ${o.cli.code}`);
      assert.deepEqual(o.cli.requests, [], label);
      assert.equal(o.lib.ok, false, `${label}: the library resolved`);
      assert.ok(!o.lib.ok && o.lib.error instanceof LebensmittelwarnungValidationError, label);
      assert.deepEqual(o.lib.requests, [], label);
      const blank = value.replace(/[\s\p{Cc}\p{Cf}\p{M}]/gu, "") === "";
      const ch = INVISIBLE.exec(value.trim())?.[0];
      if (ch === undefined || blank) continue;
      const escape = `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      const message = o.lib.ok ? "" : (o.lib.error as Error).message;
      assert.ok(o.cli.err.toLowerCase().includes(escape), `${label}: the CLI's refusal doesn't show ${escape}: ${o.cli.err}`);
      assert.ok(!o.cli.err.includes(ch), `${label}: the CLI's refusal shows the character raw`);
      assert.ok(message.toLowerCase().includes(escape), `${label}: the library's refusal doesn't show ${escape}: ${message}`);
    }
  }
});

test("a --search of combining marks only is refused as blank, not a match for every warning (bug 1)", async () => {
  for (const value of ["\u0308", "\u0301\u0308", " \u0308 ", "\u20dd"]) {
    const o = await parity(["warnings", "--search", value], (t) =>
      new LebensmittelwarnungClient({ transport: t }).warnings({ search: value }), () => rssResponse(narrowFeedXml));
    assert.equal(o.cli.code, 2, JSON.stringify(value));
    assert.match(o.cli.err, /Expected a non-empty value\./, JSON.stringify(value));
    assert.ok(!o.lib.ok && /^Invalid search: Expected a non-empty value\.$/.test((o.lib.error as Error).message), JSON.stringify(value));
  }
  // A needle with a mark on a letter, and one with ZWJ (an emoji sequence), still search.
  const kaese = await parity(["warnings", "--search", "Ka\u0308se"], (t) =>
    new LebensmittelwarnungClient({ transport: t }).warnings({ search: "Ka\u0308se" }), () => rssResponse(narrowFeedXml));
  assert.equal(kaese.cli.code, 0, kaese.cli.err);
});

test("a padded --state/--type slug is sent trimmed on both sides; case and display names are refused (D8)", async () => {
  const o = await parity(["warnings", "--state", " bayern ", "--type", "lebensmittel\n"], (t) =>
    new LebensmittelwarnungClient({ transport: t }).warnings({ state: " bayern " as never, type: "lebensmittel\n" as never }),
    () => rssResponse(narrowFeedXml));
  assert.equal(o.cli.code, 0, o.cli.err);
  assert.equal(o.lib.ok, true);
  assert.deepEqual([...o.cli.requests, ...o.lib.requests].map((r) => new URL(r.url).search), ["?state=bayern&type=lebensmittel", "?state=bayern&type=lebensmittel"]);
  for (const value of ["BAYERN", "Bayern"]) {
    const refused = await parity(["warnings", "--state", value], (t) =>
      new LebensmittelwarnungClient({ transport: t }).warnings({ state: value as never }));
    assert.equal(refused.cli.code, 2, value);
    assert.equal(refused.lib.ok, false, value);
  }
});
