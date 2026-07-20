import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine } from "../src/client/engine.js";
import { LebensmittelwarnungApiError, LebensmittelwarnungParseError } from "../src/client/errors.js";
import { makeMockTransport, rssResponse, rawResponse } from "./helpers.js";
import * as fx from "./fixtures.js";

test("buildUrl normalises the path and appends the query", () => {
  const e = new RequestEngine({ baseUrl: "https://www.lebensmittelwarnung.de/" });
  assert.equal(
    e.buildUrl("/feed.xml", { state: "bayern", type: "lebensmittel" }),
    "https://www.lebensmittelwarnung.de/feed.xml?state=bayern&type=lebensmittel",
  );
});

test("getFeed parses an RSS body into channel + items", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  const e = new RequestEngine({ transport: mt.transport });
  const feed = await e.getFeed("/feed.xml");
  assert.equal(feed.items.length, 3);
  assert.match(feed.channel.title!, /Alle Bundesländer/);
});

test("getFeed sends the Accept header and the state/type query", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.bayernFeedXml));
  const e = new RequestEngine({ transport: mt.transport });
  await e.getFeed("/feed.xml", { state: "bayern" });
  assert.match(mt.last().headers?.["Accept"] ?? "", /rss\+xml/);
  assert.match(mt.last().url, /state=bayern/);
});

test("getFeed rejects the HTML shell with a helpful parse error", async () => {
  const mt = makeMockTransport(() => rawResponse(fx.htmlShell, "text/html"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getFeed("/feed.xml"),
    (err) => err instanceof LebensmittelwarnungParseError && /HTML page/.test(err.message),
  );
});

test("getFeed on an empty body names the defunct legacy JSON API in the hint", async () => {
  const mt = makeMockTransport(() => rawResponse("", "text/xml"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getFeed("/feed.xml"),
    (err) =>
      err instanceof LebensmittelwarnungParseError &&
      /Empty response/.test(err.message) &&
      /legacy JSON API/.test(err.message),
  );
});

test("a 503 is retried up to maxRetries then surfaces as an ApiError", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return rawResponse("busy", "text/plain", 503);
  });
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 2, sleep: async () => {} });
  await assert.rejects(
    () => e.getFeed("/feed.xml"),
    (err) => err instanceof LebensmittelwarnungApiError && err.status === 503,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test("a 404 surfaces as an ApiError with status 404", async () => {
  const mt = makeMockTransport(() => rawResponse("<!doctype html>not found", "text/html", 404));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getFeed("/feed.xml"),
    (err) => err instanceof LebensmittelwarnungApiError && err.status === 404 && err.isNotFound,
  );
});

test("a 3xx redirect is treated as an error (redirects are not followed)", async () => {
  const mt = makeMockTransport(() => rawResponse("", "text/html", 302));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(
    () => e.getFeed("/feed.xml"),
    (err) => err instanceof LebensmittelwarnungApiError && err.status === 302,
  );
});

test("error detail is stripped of terminal control characters", async () => {
  // Build the hostile snippet from char codes so no raw control byte appears in
  // this source file. ESC + CSI (a C1 control) + BEL interleaved with printable text.
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const CSI = String.fromCharCode(0x9b);
  const evil = `boom${ESC}[31mred${BEL}${CSI}2J`;
  const mt = makeMockTransport(() => rawResponse(evil, "text/plain", 500));
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 0 });
  await assert.rejects(
    () => e.getFeed("/feed.xml"),
    (err) => {
      assert.ok(err instanceof LebensmittelwarnungApiError);
      const hasControl = (s: string): boolean =>
        [...s].some((c) => {
          const n = c.charCodeAt(0);
          return n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f);
        });
      assert.ok(!hasControl(err.detail ?? ""));
      assert.ok(!hasControl(err.message));
      assert.equal(err.detail, "boom[31mred2J");
      return true;
    },
  );
});
