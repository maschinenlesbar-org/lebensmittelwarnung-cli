import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine, parseRetryAfter } from "../src/client/engine.js";
import {
  LebensmittelwarnungApiError,
  LebensmittelwarnungNetworkError,
  LebensmittelwarnungParseError,
  redactUrl,
} from "../src/client/errors.js";
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

test("the engine rejects a non-http(s) base URL before any request, even with a custom transport", () => {
  for (const baseUrl of ["file:///etc/passwd", "ftp://example.org"]) {
    const mt = makeMockTransport(() => rssResponse(fx.feedXml));
    assert.throws(
      () => new RequestEngine({ baseUrl, transport: mt.transport }),
      (err) => err instanceof LebensmittelwarnungNetworkError && /Unsupported protocol/.test(err.message),
    );
    assert.equal(mt.calls.length, 0);
  }
});

test("the engine rejects an unparsable base URL", () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  assert.throws(
    () => new RequestEngine({ baseUrl: "not a url", transport: mt.transport }),
    (err) => err instanceof LebensmittelwarnungNetworkError && /Invalid base URL/.test(err.message),
  );
  assert.equal(mt.calls.length, 0);
});

function retryEngine(retryAfter: string | undefined, statuses = [429, 429, 200]) {
  const delays: number[] = [];
  let i = 0;
  const mt = makeMockTransport(() => {
    const status = statuses[Math.min(i++, statuses.length - 1)]!;
    if (status === 200) return rssResponse(fx.feedXml);
    const res = rawResponse("slow down", "text/plain", status);
    if (retryAfter !== undefined) res.headers["retry-after"] = retryAfter;
    return res;
  });
  const e = new RequestEngine({
    transport: mt.transport,
    maxRetries: 2,
    sleep: async (ms) => void delays.push(ms),
  });
  return { e, mt, delays };
}

test("a 429 with Retry-After (seconds) waits that long before each retry", async () => {
  const { e, delays } = retryEngine("1");
  await e.getFeed("/feed.xml");
  assert.deepEqual(delays, [1000, 1000]);
});

test("a Retry-After HTTP-date is honoured", async () => {
  const when = new Date(Date.now() + 5000).toUTCString();
  const { e, delays } = retryEngine(when, [503, 200]);
  await e.getFeed("/feed.xml");
  assert.equal(delays.length, 1);
  assert.ok(delays[0]! > 3000 && delays[0]! <= 5000, String(delays[0]));
});

test("a malformed Retry-After falls back to the linear backoff", async () => {
  for (const bad of ["-1", "1.5", "+5", "1e3", "soon", "2026-09-26T10:00:00Z"]) {
    const { e, delays } = retryEngine(bad);
    await e.getFeed("/feed.xml");
    assert.deepEqual(delays, [200, 400], bad);
  }
});

test("a Retry-After above the cap is not retried: the error surfaces at once", async () => {
  for (const big of ["31", "99999", new Date(Date.now() + 3_600_000).toUTCString()]) {
    const { e, mt, delays } = retryEngine(big);
    await assert.rejects(
      () => e.getFeed("/feed.xml"),
      (err) => err instanceof LebensmittelwarnungApiError && err.status === 429,
    );
    assert.equal(mt.calls.length, 1, big);
    assert.deepEqual(delays, [], big);
  }
});

test("parseRetryAfter reads delay-seconds and IMF-fixdates only", () => {
  const now = Date.parse("Sat, 26 Sep 2026 10:00:00 GMT");
  assert.equal(parseRetryAfter("120"), 120_000);
  assert.equal(parseRetryAfter([" 3 "]), 3000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 10:00:10 GMT", now), 10_000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 09:00:00 GMT", now), 0);
  assert.equal(parseRetryAfter("Saturday, 26-Sep-26 10:00:10 GMT", now), undefined);
  assert.equal(parseRetryAfter(undefined), undefined);
  assert.equal(parseRetryAfter(""), undefined);
});

test("the engine rejects a base URL with a query or fragment (library users)", () => {
  for (const baseUrl of ["https://x.test/?a=1", "https://x.test/p#f"]) {
    assert.throws(
      () => new RequestEngine({ baseUrl }),
      (err) => err instanceof LebensmittelwarnungNetworkError && /must not contain a query or fragment/.test(err.message),
    );
  }
});

test("redactUrl hides userinfo and leaves other URLs unchanged", () => {
  assert.equal(redactUrl("https://u:p@x.test/a?b=1"), "https://***@x.test/a?b=1");
  assert.equal(redactUrl("https://u@x.test/"), "https://***@x.test/");
  assert.equal(redactUrl("https://x.test/a"), "https://x.test/a");
  assert.equal(redactUrl("not a url"), "not a url");
  assert.throws(
    () => new RequestEngine({ baseUrl: "https://u:p@x.test/#f" }),
    (err) => err instanceof Error && !/u:p/.test(err.message) && /\*\*\*@x\.test/.test(err.message),
  );
});
