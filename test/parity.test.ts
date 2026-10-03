// CLI <-> library parity: the same input through run() and through the library,
// on one recording mock transport, must give the same outcome (see
// .reviews/2026-10-03-cli-library-parity/lebensmittelwarnung-cli.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { LebensmittelwarnungClient } from "../src/client/client.js";
import { LebensmittelwarnungValidationError } from "../src/client/errors.js";
import type { WarningsQuery } from "../src/client/types.js";
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
