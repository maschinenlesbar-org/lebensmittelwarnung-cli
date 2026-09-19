import { test } from "node:test";
import assert from "node:assert/strict";
import { LebensmittelwarnungClient, FEED_PATH } from "../src/client/client.js";
import { LebensmittelwarnungNetworkError } from "../src/client/errors.js";
import { makeMockTransport, rssResponse, queryOf } from "./helpers.js";
import * as fx from "./fixtures.js";

test("warnings() hits the RSS feed path and returns one Warning per item", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  const warnings = await client.warnings();
  assert.match(mt.last().url, new RegExp(FEED_PATH.replace(/[/.]/g, "\\$&")));
  assert.equal(warnings.length, 3);
});

test("warnings() projects the typed fields from the HTML description", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  const [first] = await client.warnings();
  assert.equal(first!.title, "Räucherschmelzkäse-Zubereitung, Scheiben 175 Gramm");
  assert.equal(first!.reason, "Fremdkörper");
  assert.equal(first!.manufacturer, "Sales & Service Aktuell GmbH Am Weißbach 5 98646 Straufhain");
  assert.equal(first!.packaging, "175 Gramm-Packung");
  assert.equal(first!.lotNumbers, "722641, 912641");
  assert.equal(first!.bestBefore, "17.08.2026; 22.08.2026");
});

test("warnings() splits affectedStates into a trimmed list", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  const [first] = await client.warnings();
  assert.deepEqual(first!.affectedStates, ["Bayern", "Thüringen", "Sachsen"]);
});

test("warnings() collects imageUrls and keeps the raw description", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  const [first] = await client.warnings();
  assert.deepEqual(first!.imageUrls, [
    "https://www.lebensmittelwarnung.de/bild.png?__blob=normal&v=1",
  ]);
  assert.match(first!.rawDescription!, /<b>Grund der Meldung:<\/b>/);
});

test("warnings() also exposes the generic fields map (Bildquelle etc.)", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  const [first] = await client.warnings();
  assert.equal(first!.fields["Bildquelle"], "© Firma Sales & Service Aktuell GmbH");
  assert.equal(first!.fields["Grund der Meldung"], "Fremdkörper");
});

test("warnings() normalises the RFC-822 pubDate to an ISO string", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  const [first] = await client.warnings();
  assert.equal(first!.pubDate, "Fri, 10 Jul 2026 14:00:00 +0200");
  assert.equal(first!.published, "2026-07-10T12:00:00.000Z"); // +0200 -> UTC
});

test("warnings({ state, type }) sends both as server-side query parameters", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.bayernFeedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  await client.warnings({ state: "bayern", type: "lebensmittel" });
  const q = queryOf(mt.last());
  assert.equal(q.get("state"), "bayern");
  assert.equal(q.get("type"), "lebensmittel");
});

test("warnings() with no filter sends no state/type params", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  await client.warnings();
  const q = queryOf(mt.last());
  assert.equal(q.get("state"), null);
  assert.equal(q.get("type"), null);
});

test("warnings() tolerates an item that carries only a reason (non-food shape)", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const client = new LebensmittelwarnungClient({ transport: mt.transport });
  const warnings = await client.warnings();
  const cream = warnings[2]!;
  assert.equal(cream.reason, "mikrobiologische Verunreinigung");
  assert.equal(cream.imageUrls, undefined); // no image in that item
  assert.equal(cream.packaging, undefined); // no packaging label
});

test("the client rejects a non-http(s) base URL before any request, even with a custom transport", () => {
  for (const baseUrl of ["file:///etc/passwd", "ftp://example.org"]) {
    const mt = makeMockTransport(() => rssResponse(fx.feedXml));
    assert.throws(
      () => new LebensmittelwarnungClient({ baseUrl, transport: mt.transport }),
      (err) => err instanceof LebensmittelwarnungNetworkError && /Unsupported protocol/.test(err.message),
    );
    assert.equal(mt.calls.length, 0);
  }
});
