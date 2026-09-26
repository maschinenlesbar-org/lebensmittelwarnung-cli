import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { LebensmittelwarnungClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { makeMockTransport, rssResponse, rawResponse, queryOf } from "./helpers.js";
import * as fx from "./fixtures.js";

function makeCli(responder: (req: HttpRequest) => HttpResponse) {
  const out: string[] = [];
  const err: string[] = [];
  const files: Record<string, Buffer> = {};
  const mt = makeMockTransport(responder);
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      writeFile: (p, d) => {
        files[p] = d;
      },
    },
    createClient: (opts) => new LebensmittelwarnungClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt, files };
}

test("warnings renders JSON and hits the RSS feed", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  const code = await run(["warnings"], cli.deps);
  assert.equal(code, 0);
  assert.match(cli.mt.last().url, /rssnewsfeed_Alle_DE\.xml/);
  const rows = JSON.parse(cli.out.join("\n")) as unknown[];
  assert.equal(rows.length, 3);
});

test("warnings --state passes the server-side filter and validates the slug", async () => {
  const cli = makeCli(() => rssResponse(fx.bayernFeedXml));
  const code = await run(["warnings", "--state", "bayern"], cli.deps);
  assert.equal(code, 0);
  assert.equal(queryOf(cli.mt.last()).get("state"), "bayern");
});

test("warnings --type passes the server-side filter", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["warnings", "--type", "lebensmittel"], cli.deps);
  assert.equal(queryOf(cli.mt.last()).get("type"), "lebensmittel");
});

test("warnings --state with an unknown slug is rejected (exit 2), no request", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  const code = await run(["warnings", "--state", "bavaria"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
});

test("warnings --type with an unknown slug is rejected (exit 2), no request", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  const code = await run(["warnings", "--type", "food"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
});

test("warnings --limit truncates the result set", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["warnings", "--limit", "2"], cli.deps);
  assert.equal((JSON.parse(cli.out.join("\n")) as unknown[]).length, 2);
});

test("warnings --limit rejects a non-integer (exit 2)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["warnings", "--limit", "abc"], cli.deps), 2);
});

test("warnings --limit rejects zero (exit 2)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["warnings", "--limit", "0"], cli.deps), 2);
});

test("warnings --since filters by publication date (client-side)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["warnings", "--since", "2026-07-01"], cli.deps);
  const rows = JSON.parse(cli.out.join("\n")) as Array<{ title: string }>;
  // The 30 Jun 2026 cream item drops out; the 8 & 10 Jul ones stay.
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !/Gesichtscreme/.test(r.title)));
});

test("warnings --since compares German calendar days, not UTC days", async () => {
  const cli = makeCli(() => rssResponse(fx.midnightFeedXml));
  assert.equal(await run(["warnings", "--since", "2026-09-04"], cli.deps), 0);
  const rows = JSON.parse(cli.out.join("\n")) as Array<{ title: string; published: string }>;
  // Midnight +0200 is 22:00 UTC the day before, but it is still 4 Sep in Germany.
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Knackwürste im Ring", "UTC-stamped item"],
  );
  assert.equal(rows[0]!.published, "2026-09-03T22:00:00.000Z");
});

test("warnings --since in winter time (+0100) keeps a notice from German midnight", async () => {
  const feed = fx.midnightFeedXml.replace("Fri, 4 Sep 2026 00:00:00 +0200", "Mon, 5 Jan 2026 00:00:00 +0100");
  const cli = makeCli(() => rssResponse(feed));
  assert.equal(await run(["warnings", "--since", "2026-01-05"], cli.deps), 0);
  const rows = JSON.parse(cli.out.join("\n")) as Array<{ title: string }>;
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Knackwürste im Ring", "Late evening item", "UTC-stamped item"],
  );
});

test("warnings --since rejects a malformed date (exit 2)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["warnings", "--since", "2026-13-40"], cli.deps), 2);
  assert.equal(await run(["warnings", "--since", "10.07.2026"], cli.deps), 2);
});

test("warnings --search filters by product title, case-insensitively", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["warnings", "--search", "beeren"], cli.deps);
  const rows = JSON.parse(cli.out.join("\n")) as Array<{ title: string }>;
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.title, /Beerenmischung/);
});

test("warnings --search with no match returns [] (not the full feed)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["warnings", "--search", "zzz-nichts"], cli.deps);
  assert.deepEqual(JSON.parse(cli.out.join("\n")), []);
});

test("states prints the sixteen Land slugs offline (no request)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  const code = await run(["states"], cli.deps);
  assert.equal(code, 0);
  assert.equal(cli.mt.calls.length, 0);
  const rows = JSON.parse(cli.out.join("\n")) as Array<{ slug: string; name: string }>;
  assert.equal(rows.length, 16);
  assert.ok(rows.some((r) => r.slug === "bayern" && r.name === "Bayern"));
});

test("types prints the five product-type slugs offline (no request)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["types"], cli.deps);
  assert.equal(cli.mt.calls.length, 0);
  const rows = JSON.parse(cli.out.join("\n")) as unknown[];
  assert.equal(rows.length, 5);
});

test("the HTML shell (wrong feed) exits 1 with a helpful message", async () => {
  const cli = makeCli(() => rawResponse(fx.htmlShell, "text/html"));
  const code = await run(["warnings"], cli.deps);
  assert.equal(code, 1);
  assert.match(cli.err.join("\n"), /HTML page/);
});

test("an empty body exits 1 and names the defunct legacy JSON API", async () => {
  const cli = makeCli(() => rawResponse("", "text/xml"));
  const code = await run(["warnings"], cli.deps);
  assert.equal(code, 1);
  assert.match(cli.err.join("\n"), /legacy JSON API/);
});

test("a 404 exits 4", async () => {
  const cli = makeCli(() => rawResponse("<!doctype html>nope", "text/html", 404));
  assert.equal(await run(["warnings"], cli.deps), 4);
});

test("a server 3xx exits 1 (runtime) with a base-url hint, not usage (2)", async () => {
  const cli = makeCli(() => rawResponse("", "text/html", 302));
  const code = await run(["warnings"], cli.deps);
  assert.equal(code, 1);
  assert.match(cli.err.join("\n"), /redirected \(3xx\)|--base-url/);
});

test("--compact prints single-line JSON", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["warnings", "--compact"], cli.deps);
  assert.equal(cli.out.length, 1);
});

test("DEL and C1 control characters in server data are escaped in the JSON output", async () => {
  const controls = String.fromCharCode(0x7f, 0x85, 0x9b) + "2J";
  const title = `Käse${controls}`;
  const reason = String.fromCharCode(0x1b) + "[31m";
  const xml =
    `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item>` +
    `<title>${title}</title>` +
    `<description><![CDATA[<b>Grund der Meldung:</b> ${reason}<br/>]]></description>` +
    `</item></channel></rss>`;
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => rssResponse(xml));
    assert.equal(await run(["warnings", ...format], cli.deps), 0);
    const text = cli.out.join("\n");
    const raw = [...text].filter((c) => c.charCodeAt(0) < 0x20 ? c !== "\n" : c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f);
    assert.deepEqual(raw, [], format.join(" "));
    assert.match(text, /Käse\\u007f\\u0085\\u009b2J/);
    const rows = JSON.parse(text) as Array<{ title?: string; reason?: string }>;
    assert.equal(rows[0]?.title, title);
    assert.equal(rows[0]?.reason, reason);
  }
});

test("--output writes to a file and keeps stdout clean", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  await run(["--output", "/tmp/lmw.json", "warnings"], cli.deps);
  assert.equal(cli.out.length, 0);
  assert.ok(cli.files["/tmp/lmw.json"]);
  assert.match(cli.err.join("\n"), /Wrote \d+ bytes/);
});

test("a control character in --user-agent is rejected (exit 2), no request", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  const code = await run(["warnings", "--user-agent", "bad\r\nX-Injected: 1"], cli.deps);
  assert.equal(code, 2);
  assert.equal(cli.mt.calls.length, 0);
});

test("a non-http --base-url is rejected (exit 2)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["--base-url", "ftp://x/y", "warnings"], cli.deps), 2);
});

test("--max-retries above the sane maximum is rejected (exit 2)", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["--max-retries", "1000", "warnings"], cli.deps), 2);
});

test("--timeout accepts up to the largest timer Node supports", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["--timeout", "2147483647", "warnings"], cli.deps), 0);
  assert.equal(cli.mt.last().timeoutMs, 2_147_483_647);

  const over = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["--timeout", "2147483648", "warnings"], over.deps), 2);
  assert.equal(over.mt.calls.length, 0);
  assert.match(over.err.join("\n"), /Must be <= 2147483647/);
});

test("a bare invocation prints help and exits 0", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  const code = await run([], cli.deps);
  assert.equal(code, 0);
  assert.match(cli.out.join("\n"), /Usage: lebensmittel/);
});

test("an unknown command exits 2", async () => {
  const cli = makeCli(() => rssResponse(fx.feedXml));
  assert.equal(await run(["boguscmd"], cli.deps), 2);
});

test("warnings --search matches the product name when the feed title is an unrendered template", async () => {
  for (const [term, expected] of [
    ["kimchi", ["KIMCHI 300 Gramm"]],
    ["schokolade", ["Deluxe Erdbeeren in weißer Schokolade, 120 Gramm"]],
  ] as const) {
    const cli = makeCli(() => rssResponse(fx.templateTitleFeedXml));
    assert.equal(await run(["warnings", "--search", term], cli.deps), 0);
    const rows = JSON.parse(cli.out.join("\n")) as Array<{ title: string }>;
    assert.deepEqual(rows.map((r) => r.title), expected);
  }
});

test("warnings --search also matches the Produktbezeichnung when the title words it differently", async () => {
  const feed = fx.feedXml.replace(
    "<b>Grund der Meldung:</b> Norovirus",
    "<b>Produktbezeichnung/ -beschreibung:</b> Himbeeren und Brombeeren<br/><b>Grund der Meldung:</b> Norovirus",
  );
  const cli = makeCli(() => rssResponse(feed));
  assert.equal(await run(["warnings", "--search", "brombeer"], cli.deps), 0);
  const rows = JSON.parse(cli.out.join("\n")) as Array<{ title: string }>;
  assert.deepEqual(rows.map((r) => r.title), ["ja! Beerenmischung, tiefgefroren, 750 Gramm Beutel"]);
});
