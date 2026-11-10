import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { TextDecoder } from "node:util";
import assert from "node:assert/strict";
import {
  RequestEngine,
  assertHeaderValue,
  cleartextProblem,
  parseRetryAfter,
  sanitizeServerText,
  validateBaseUrl,
  type EngineOptions,
} from "../src/engine.js";
import { baseUrlProblem, headerValueProblem } from "../src/validate.js";
import {
  LebensmittelwarnungApiError,
  LebensmittelwarnungParseError,
  LebensmittelwarnungValidationError,
  credentialsIn,
  cutText,
  echoedCredentialForms,
  redactUrl,
  redactUrlUserinfo,
  TextBuilder,
  toWellFormed,
  typedUrlCredentials,
} from "../src/errors.js";
import { LebensmittelwarnungClient } from "../src/client.js";
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
      /empty response/.test(err.message) &&
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
      // Control bytes are gone from both the structured detail and the message; whole escape
      // sequences go, so none of their printable rest is left behind.
      assert.ok(!hasControl(err.detail ?? ""));
      assert.ok(!hasControl(err.message));
      assert.equal(err.detail, "boomred");
      return true;
    },
  );
});

test("the engine rejects a non-http(s) base URL before any request, even with a custom transport", () => {
  for (const baseUrl of ["file:///etc/passwd", "ftp://example.org"]) {
    const mt = makeMockTransport(() => rssResponse(fx.feedXml));
    assert.throws(
      () => new RequestEngine({ baseUrl, transport: mt.transport }),
      (err) =>
        err instanceof LebensmittelwarnungValidationError &&
        err.message === "Invalid baseUrl: Only http: and https: base URLs are supported.",
    );
    assert.equal(mt.calls.length, 0);
  }
});

test("the engine rejects an unparsable base URL", () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  assert.throws(
    () => new RequestEngine({ baseUrl: "not a url", transport: mt.transport }),
    (err) => err instanceof LebensmittelwarnungValidationError && err.message === "Invalid baseUrl: Expected a valid URL.",
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
      (err) =>
        err instanceof LebensmittelwarnungValidationError &&
        err.message === "Invalid baseUrl: A base URL cannot have a query (?) or fragment (#).",
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
    // The base-URL reasons never echo the URL, so the credential cannot leak.
    (err) => err instanceof LebensmittelwarnungValidationError && !/u:p|x\.test/.test(err.message),
  );
});

test("the engine rejects out-of-range or non-integer numeric options", () => {
  const bad: Array<[string, number]> = [
    ["timeoutMs", Number.NaN],
    ["timeoutMs", -5],
    ["timeoutMs", 2_147_483_648],
    ["maxRetries", Number.POSITIVE_INFINITY],
    ["maxRetries", 11],
    ["maxRetries", 1.5],
    ["retryDelayMs", -1],
    ["retryDelayMs", 30_001],
    ["maxResponseBytes", -1],
  ];
  for (const [name, value] of bad) {
    assert.throws(
      () => new RequestEngine({ [name]: value }),
      (err) =>
        err instanceof LebensmittelwarnungValidationError &&
        err.message.startsWith(`Invalid option ${name}: expected an integer from 0 to `),
      `${name}=${value}`,
    );
  }
  // The documented edges stay valid.
  new RequestEngine({ timeoutMs: 0, maxRetries: 10, retryDelayMs: 0, maxResponseBytes: 0 });
});

test("getFeed decodes the body by the XML declaration's encoding (Latin-1)", async () => {
  const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>K\u00e4se</title></item></channel></rss>';
  const mt = makeMockTransport(() => rawResponse(Buffer.from(xml, "latin1"), "text/xml"));
  const feed = await new RequestEngine({ transport: mt.transport }).getFeed("/feed.xml");
  assert.equal(feed.items[0]!.title, "Käse");
});

test("getFeed defaults to UTF-8 and drops a byte-order mark", async () => {
  const xml = "\ufeff<?xml version=\"1.0\"?><rss><channel><item><title>K\u00e4se</title></item></channel></rss>";
  const mt = makeMockTransport(() => rawResponse(Buffer.from(xml, "utf8"), "text/xml"));
  const feed = await new RequestEngine({ transport: mt.transport }).getFeed("/feed.xml");
  assert.equal(feed.items[0]!.title, "Käse");
});

test("getFeed decodes by the Content-Type charset when the XML declaration names none", async () => {
  // Finding 02#4: a Latin-1 body declared only in the header was read as UTF-8 (U+FFFD),
  // and the label "Betroffene Bundesländer …" no longer matched, so affectedStates vanished.
  const xml = '<?xml version="1.0"?><rss><channel><item><title>K\u00e4se</title></item></channel></rss>';
  const mt = makeMockTransport(() => rawResponse(Buffer.from(xml, "latin1"), "text/xml; charset=ISO-8859-1"));
  const feed = await new RequestEngine({ transport: mt.transport }).getFeed("/feed.xml");
  assert.equal(feed.items[0]!.title, "Käse");
});

test("the Content-Type charset outranks the XML declaration, a byte-order mark outranks both", async () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><rss><channel><item><title>K\u00e4se</title></item></channel></rss>';
  let mt = makeMockTransport(() => rawResponse(Buffer.from(xml, "latin1"), 'text/xml; charset="iso-8859-1"'));
  assert.equal((await new RequestEngine({ transport: mt.transport }).getFeed("/f")).items[0]!.title, "Käse");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
  mt = makeMockTransport(() => rawResponse(utf16, "text/xml; charset=iso-8859-1"));
  assert.equal((await new RequestEngine({ transport: mt.transport }).getFeed("/f")).items[0]!.title, "Käse");
});

test("an unknown Content-Type charset is a parse error", async () => {
  const mt = makeMockTransport(() => rawResponse("<rss><channel></channel></rss>", "text/xml; charset=x-bogus"));
  await assert.rejects(
    () => new RequestEngine({ transport: mt.transport }).getFeed("/feed.xml"),
    (err) => err instanceof LebensmittelwarnungParseError && /unsupported response charset "x-bogus"/.test(err.message),
  );
});

test("an unknown declared encoding is a parse error, not mojibake", async () => {
  const xml = '<?xml version="1.0" encoding="x-bogus"?><rss><channel></channel></rss>';
  const mt = makeMockTransport(() => rawResponse(xml, "text/xml"));
  await assert.rejects(
    () => new RequestEngine({ transport: mt.transport }).getFeed("/feed.xml"),
    (err) => err instanceof LebensmittelwarnungParseError && err.message === 'GET https://www.lebensmittelwarnung.de/feed.xml: unsupported response charset "x-bogus".',
  );
});

// ---- Header values (CLI <-> library parity, finding 2) ----

test("assertHeaderValue returns a valid value and throws LebensmittelwarnungValidationError otherwise", () => {
  assert.equal(assertHeaderValue("userAgent", "my-app/1.0 (müller)\tx"), "my-app/1.0 (müller)\tx");
  for (const bad of ["", "  ", "a\nb", "a\u007fb", "€"]) {
    assert.throws(
      () => assertHeaderValue("userAgent", bad),
      (err: unknown) => err instanceof LebensmittelwarnungValidationError && /^Invalid userAgent: /.test(err.message),
      JSON.stringify(bad),
    );
  }
});

test("headerValueProblem names the reason", () => {
  assert.equal(headerValueProblem("ok"), undefined);
  assert.equal(headerValueProblem(" "), "Expected a non-empty value.");
  assert.equal(headerValueProblem("a\rb"), "Value contains control characters.");
  assert.equal(headerValueProblem("Ā"), "Value contains characters outside Latin-1 (above U+00FF).");
  assert.equal(headerValueProblem(1), "Expected a string.");
});

test("the engine checks userAgent and defaultHeaders at construction, before any request", () => {
  const cases: EngineOptions[] = [
    { userAgent: "" },
    { userAgent: "a\r\nX-Inj: 1" },
    { defaultHeaders: { "X-A": "a\r\nX-Inj: 1" } },
    { defaultHeaders: { "Bad Name": "v" } },
    { defaultHeaders: { "": "v" } },
  ];
  for (const options of cases) {
    const mt = makeMockTransport(() => rssResponse(fx.feedXml));
    assert.throws(
      () => new RequestEngine({ ...options, transport: mt.transport }),
      LebensmittelwarnungValidationError,
      JSON.stringify(options),
    );
    assert.equal(mt.calls.length, 0);
  }
  // An omitted userAgent still means the default.
  assert.doesNotThrow(() => new RequestEngine({ defaultHeaders: { "X-Note": "ok" } }));
});

// ---- Base URL (CLI <-> library parity, finding 3) ----

test("validateBaseUrl strips trailing slashes and throws a ValidationError, never a NetworkError", () => {
  assert.equal(validateBaseUrl("https://h.example/sub//"), "https://h.example/sub");
  for (const bad of ["", " ", "/", "ftp://h.example", "https://h.example/?x=1", "https://h.example#f"]) {
    assert.throws(
      () => validateBaseUrl(bad),
      (err: unknown) => err instanceof LebensmittelwarnungValidationError && /^Invalid baseUrl: /.test(err.message),
      JSON.stringify(bad),
    );
  }
});

test("baseUrlProblem names the reason without echoing the URL", () => {
  assert.equal(baseUrlProblem("https://www.lebensmittelwarnung.de"), undefined);
  assert.equal(baseUrlProblem(""), "Expected a non-empty URL.");
  assert.equal(baseUrlProblem("nope"), "Expected a valid URL.");
  assert.equal(baseUrlProblem("ftp://u:secret@h"), "Only http: and https: base URLs are supported.");
  assert.equal(baseUrlProblem("https://u:secret@h/?q"), "A base URL cannot have a query (?) or fragment (#).");
  assert.equal(baseUrlProblem(1), "Expected a string.");
  // new URL() trims these silently; a trailing space used to land in the request path.
  assert.equal(baseUrlProblem("https://u:secret@h/ "), "A base URL cannot have surrounding whitespace.");
  assert.equal(baseUrlProblem(" https://h"), "A base URL cannot have surrounding whitespace.");
  assert.equal(baseUrlProblem("https://h/a\tb"), "A base URL cannot contain control characters.");
});

test("cleartextProblem: exact wording, host with port, loopback range, never the secret", () => {
  assert.equal(cleartextProblem("http://mirror.example:8080/api"), "requests to mirror.example:8080 are sent unencrypted (http:, not https:)");
  assert.equal(
    cleartextProblem("http://alice:pw@mirror.example"),
    "the base URL's credentials are sent unencrypted to mirror.example (http:, not https:)",
  );
  assert.equal(
    cleartextProblem("http://alice:pw@mirror.example", ["the API key"]),
    "the API key and the base URL's credentials are sent unencrypted to mirror.example (http:, not https:)",
  );
  assert.equal(cleartextProblem("http://mirror.example", ["the login"]), "the login is sent unencrypted to mirror.example (http:, not https:)");
  for (const url of ["https://alice:pw@mirror.example", "http://127.8.9.10", "http://localhost:1", "http://[::1]/", "not a url"]) {
    assert.equal(cleartextProblem(url), undefined, url);
  }
  assert.notEqual(cleartextProblem("http://128.0.0.1"), undefined);
});

test("defaultHeaders cannot override Accept/User-Agent in any case: the engine's keys come last (finding 04 Q2, documented)", async () => {
  let seen: Record<string, string> | undefined;
  const engine = new RequestEngine({
    defaultHeaders: { "user-agent": "mine/1", accept: "text/plain", "X-Trace": "t1" },
    transport: async (req) => {
      seen = req.headers;
      return { status: 200, headers: { "content-type": "text/xml" }, body: Buffer.from("<rss><channel></channel></rss>") };
    },
  });
  await engine.getFeed("/feed.xml");
  assert.deepEqual(Object.entries(seen ?? {}), [
    ["user-agent", "mine/1"],
    ["accept", "text/plain"],
    ["X-Trace", "t1"],
    ["Accept", "application/rss+xml, application/xml"],
    ["User-Agent", "lebensmittelwarnung-cli"],
  ]);
});

test("cutText never cuts inside a surrogate pair; toWellFormed replaces half a character", () => {
  assert.equal(cutText("ab\u{1f600}cd", 3), "ab");
  assert.equal(cutText("ab\u{1f600}cd", 4), "ab\u{1f600}");
  assert.equal(cutText("short", 10), "short");
  assert.equal(toWellFormed("a\ud83d b\ude00 \u{1f600}"), "a\ufffd b\ufffd \u{1f600}");
});

test("server text cut at 200 characters (a plain error body) keeps the message well-formed", async () => {
  // 199 x "x" + an emoji: the old 200-unit slice kept only its high surrogate.
  for (const body of ["x".repeat(199) + "\u{1f600}tail", "a" + "\u{1f600}".repeat(400)]) {
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body, "text/plain", 500)).transport, maxRetries: 0 });
    const err = await e.getFeed("/feed.xml").catch((x: unknown) => x);
    assert.ok(err instanceof LebensmittelwarnungApiError);
    assert.equal(toWellFormed(err.message), err.message);
    assert.match(err.message, /…$/);
  }
});

test("credentials a server echoes are scrubbed from the error: Basic, user:password, password (L13)", async () => {
  // Node sends the pair UTF-8 encoded (the Authorization header it builds from the URL), so that is the form a server echoes.
  const basic = Buffer.from("alice:pa ss-pw", "utf8").toString("base64");
  const echo = `no: Basic ${basic} / alice:pa ss-pw / pa ss-pw`;
  const e = new RequestEngine({
    baseUrl: "https://alice:pa%20ss-pw@mirror.example",
    maxRetries: 0,
    transport: makeMockTransport(() => rawResponse(echo, "text/plain", 401)).transport,
  });
  const err = await e.getFeed("/feed.xml").catch((x: unknown) => x);
  assert.ok(err instanceof LebensmittelwarnungApiError);
  for (const form of [basic, "alice:pa ss-pw", "pa ss-pw"]) {
    assert.ok(!err.message.includes(form), err.message);
    assert.ok(!err.body.includes(form), err.body);
  }
  assert.match(err.message, /no: Basic \*\*\* \/ \*\*\* \/ \*\*\*/);
});

const jsonResponse = (body: unknown, status = 200) => rawResponse(JSON.stringify(body), "application/json", status);

test("onRetry is called once per retry, with the event fields, right before the sleep", async () => {
  const log: string[] = [];
  const events: unknown[] = [];
  let n = 0;
  const mt = makeMockTransport(() =>
    n++ < 2
      ? { status: 503, headers: n === 1 ? { "retry-after": "2" } : {}, body: Buffer.from("{}") }
      : jsonResponse({ ok: 1 }),
  );
  const e = new RequestEngine({
    transport: mt.transport,
    baseUrl: "https://user:pw@example.test",
    maxRetries: 3,
    sleep: async (ms) => void log.push(`sleep ${ms}`),
    onRetry: (ev) => {
      events.push(ev);
      log.push("retry");
    },
  });
  await e.request("/x");
  assert.deepEqual(log, ["retry", "sleep 2000", "retry", "sleep 400"]);
  assert.deepEqual(events, [
    { retry: 1, maxRetries: 3, delayMs: 2000, status: 503, url: "https://***@example.test/x" },
    { retry: 2, maxRetries: 3, delayMs: 400, status: 503, url: "https://***@example.test/x" },
  ]);
});

test("onRetry reports a reset connection without a status", async () => {
  let n = 0;
  const events: unknown[] = [];
  const mt = makeMockTransport(() => {
    if (n++ === 0) throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    return jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({ transport: mt.transport, sleep: async () => {}, onRetry: (ev) => void events.push(ev) });
  await e.request("/x");
  assert.equal(events.length, 1);
  assert.equal((events[0] as { status?: number }).status, undefined);
  assert.equal((events[0] as { retry: number }).retry, 1);
});

test("a throw in onRetry is swallowed", async () => {
  let n = 0;
  const mt = makeMockTransport(() => (n++ === 0 ? { status: 503, headers: {}, body: Buffer.from("{}") } : jsonResponse({ ok: 1 })));
  const e = new RequestEngine({
    transport: mt.transport,
    sleep: async () => {},
    onRetry: () => {
      throw new Error("boom");
    },
  });
  await e.request("/x");
  assert.equal(mt.calls.length, 2);
});

test("onRetry is never called without a retry", async () => {
  const events: unknown[] = [];
  const onRetry = (ev: unknown) => void events.push(ev);
  const ok = new RequestEngine({ transport: makeMockTransport(() => jsonResponse({})).transport, sleep: async () => {}, onRetry });
  await ok.request("/x");
  const notFound = new RequestEngine({
    transport: makeMockTransport(() => jsonResponse({ detail: "no" }, 404)).transport,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(notFound.request("/x"), LebensmittelwarnungApiError);
  // retries exhausted: the last 503 is an error, not a retry
  const down = new RequestEngine({
    transport: makeMockTransport(() => ({ status: 503, headers: {}, body: Buffer.from("{}") })).transport,
    maxRetries: 1,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(down.request("/x"), LebensmittelwarnungApiError);
  assert.equal(events.length, 1);
  // a Retry-After over the cap is not retried
  const long = new RequestEngine({
    transport: makeMockTransport(() => ({ status: 503, headers: { "retry-after": "999999" }, body: Buffer.from("{}") })).transport,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(long.request("/x"), LebensmittelwarnungApiError);
  assert.equal(events.length, 1);
});

test("onRetry must be a function", () => {
  assert.throws(() => new RequestEngine({ onRetry: 5 as never }), LebensmittelwarnungValidationError);
});

test("a network failure names the request: timeout, size cap, refused, DNS, reset (K3)", async () => {
  const { LebensmittelwarnungNetworkError } = await import("../src/errors.js");
  const shown = "GET https://***@feeds.example/feed.xml?state=bayern failed: ";
  const coded = (message: string, code: string): Error => Object.assign(new Error(message), { code });
  const cases: Array<[string, EngineOptions, RegExp]> = [
    ["refused", { transport: async () => { throw coded("connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"); } }, /connect ECONNREFUSED/],
    ["DNS", { transport: async () => { throw coded("getaddrinfo ENOTFOUND feeds.example", "ENOTFOUND"); } }, /getaddrinfo ENOTFOUND feeds\.example$/],
    ["reset", { maxRetries: 0, transport: async () => { throw coded("socket hang up", "ECONNRESET"); } }, /socket hang up$/],
    ["timeout", { timeoutMs: 5, transport: () => new Promise(() => {}) }, /exceeded the 5ms deadline$/],
    ["size cap", { maxResponseBytes: 3, transport: async () => rssResponse("<rss/>") }, /size limit of 3 bytes/],
  ];
  for (const [name, options, reason] of cases) {
    const engine = new RequestEngine({ baseUrl: "https://u:secret@feeds.example", ...options });
    const err = await engine.getFeed("/feed.xml", { state: "bayern" }).then(
      () => assert.fail(`${name}: no error`),
      (e: unknown) => e,
    );
    assert.ok(err instanceof LebensmittelwarnungNetworkError, name);
    assert.ok(err.message.startsWith(shown), `${name}: ${err.message}`);
    assert.match(err.message.slice(shown.length), reason, name);
    assert.ok(!err.message.includes("secret"), name);
    if (name !== "size cap") assert.ok(err.cause !== undefined, `${name}: the original is the cause`);
  }
});

test("a reset retried to the end says how often it was retried (K3)", async () => {
  const engine = new RequestEngine({
    maxRetries: 2,
    sleep: async () => {},
    transport: async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    },
  });
  await assert.rejects(engine.getFeed("/feed.xml"), {
    message: "GET https://www.lebensmittelwarnung.de/feed.xml failed: socket hang up (after 2 retries)",
  });
});

test("a header named __proto__ is an ordinary header, never the prototype of the headers read (T12)", async () => {
  // A JavaScript transport's headers from JSON.parse carry `__proto__` as an own key. Copied into
  // a plain object, it became the record's prototype, and its `content-type` decided the charset.
  const headers = JSON.parse('{"__proto__": {"content-type": "text/xml; charset=iso-8859-1"}}') as Record<string, string>;
  const body = Buffer.from('<?xml version="1.0"?><rss><channel><item><title>Käse</title></item></channel></rss>', "utf8");
  const e = new RequestEngine({ transport: async () => ({ status: 200, headers, body }) });
  const feed = await e.getFeed("/feed.xml");
  assert.equal(feed.items[0]?.title, "Käse");
  const map = new Map([["__proto__", "x"]]);
  const viaMap = new RequestEngine({ transport: async () => ({ status: 200, headers: map as unknown as Record<string, string>, body }) });
  assert.equal((await viaMap.getFeed("/feed.xml")).items[0]?.title, "Käse");
});

test("text that is not valid is replaced with U+FFFD and reported through onWarning, never silently (D2)", async () => {
  const feed = (title: string): string => `<rss><channel><item><title>${title}</title></item></channel></rss>`;
  const cases: Array<[string, Buffer, string, string, string]> = [
    ["invalid UTF-8", Buffer.concat([Buffer.from(feed("a\u0000b").split("\u0000")[0]!), Buffer.from([0xff, 0xfe]), Buffer.from(feed("a\u0000b").split("\u0000")[1]!)]),
      "text/xml; charset=utf-8", "a\ufffd\ufffdb", "2 characters of the answer were"],
    ["U+FFFD the server sent is not counted", Buffer.concat([Buffer.from(feed("\ufffd\u0000").split("\u0000")[0]!), Buffer.from([0xc3]), Buffer.from(feed("\ufffd\u0000").split("\u0000")[1]!)]),
      "text/xml; charset=utf-8", "\ufffd\ufffd", "1 character of the answer was"],
    ["a lone surrogate reference", Buffer.from(feed("K&#xD800;se")), "text/xml; charset=utf-8", "K\ufffdse", "1 character of the answer was"],
    ["an unpaired UTF-16 surrogate", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(feed("a\ud800b"), "utf16le")]), "text/xml", "a\ufffdb", "1 character of the answer was"],
  ];
  for (const [label, body, contentType, title, count] of cases) {
    const warnings: string[] = [];
    const e = new RequestEngine({
      baseUrl: "https://u:secret@feed.test",
      transport: async () => ({ status: 200, headers: { "content-type": contentType }, body }),
      onWarning: (message) => warnings.push(message),
    });
    const got = await e.getFeed("/feed.xml", { state: "bayern" });
    assert.equal(got.items[0]?.title, title, label);
    assert.deepEqual(warnings, [
      `GET https://***@feed.test/feed.xml?state=bayern: ${count} not valid text (invalid bytes or a lone surrogate) and replaced with U+FFFD.`,
    ], label);
  }
  // Valid text: no warning. A throwing onWarning never fails the request; it must be a function.
  const quiet: string[] = [];
  await new RequestEngine({ transport: async () => rssResponse(feed("Käse")), onWarning: (m) => quiet.push(m) }).getFeed("/f.xml");
  assert.deepEqual(quiet, []);
  const throwing = new RequestEngine({ transport: async () => rssResponse(feed("K&#xD800;se")), onWarning: () => { throw new Error("x"); } });
  assert.equal((await throwing.getFeed("/f.xml")).items[0]?.title, "K\ufffdse");
  assert.throws(() => new RequestEngine({ onWarning: "x" as never }), LebensmittelwarnungValidationError);
});

test("an answer error names the request: method and URL, userinfo redacted (D9)", async () => {
  const cases: Array<[Buffer | string, string, string]> = [
    [fx.htmlShell, "text/html", "expected an RSS feed but received an HTML page — the feed may have moved."],
    ["", "text/xml", "empty response — the feed returned no content. (The legacy JSON API at megov.bayern.de is defunct and returns an empty body; this client uses the RSS feeds.)"],
    ["<rss><channel>", "text/xml", "the answer is not valid RSS: Unterminated element <channel>"],
    ["{}", "application/json", "the answer is not valid RSS: No document element found"],
    ["<rss/>", "text/xml; charset=x-bogus", 'unsupported response charset "x-bogus".'],
  ];
  for (const [body, type, reason] of cases) {
    const e = new RequestEngine({ baseUrl: "https://user:secret@mirror.test/base", transport: async () => rawResponse(body, type) });
    await assert.rejects(
      () => e.getFeed("/feed.xml", { state: "bayern" }),
      (err) => err instanceof LebensmittelwarnungParseError && err.message === `GET https://***@mirror.test/base/feed.xml?state=bayern: ${reason}`,
      reason,
    );
  }
});

test("an answer longer than V8's longest string is a LebensmittelwarnungParseError naming the request, not a plain Error (T14)", async (t) => {
  // A real one needs a body of 512 MB and more (possible with maxResponseBytes 0): V8's own
  // error is stood in for, for the body marked by its length.
  const huge = Buffer.from("<rss><channel><item/></channel></rss>   ");
  const tooLong = Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" });
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, input?: Uint8Array, options?: { stream?: boolean }) {
    if (input !== undefined && input.byteLength === huge.length) throw tooLong;
    return decode.call(this, input, options);
  });
  const toString = Buffer.prototype.toString;
  t.mock.method(Buffer.prototype, "toString", function (this: Buffer, ...args: Parameters<Buffer["toString"]>) {
    if (this.length === huge.length && args[0] === "utf8") throw tooLong;
    return toString.apply(this, args);
  });
  const e = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => rawResponse(huge, "text/xml")).transport });
  await assert.rejects(e.getFeed("/feed.xml", { state: "bayern" }), (err: unknown) => {
    assert.ok(err instanceof LebensmittelwarnungParseError, String(err));
    assert.equal(
      err.message,
      `GET https://www.lebensmittelwarnung.de/feed.xml?state=bayern: the answer is too large to read as text (${huge.length} bytes; the longest string is 536870888 characters).`,
    );
    return true;
  });
  // An error status with such a body is still the API error, without the unreadable body.
  const failing = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => rawResponse(huge, "text/plain", 500)).transport });
  await assert.rejects(failing.getFeed("/feed.xml"), (err: unknown) => err instanceof LebensmittelwarnungApiError && err.status === 500 && err.body === "");
});

/** Milliseconds `work` takes. */
function elapsed(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

test("redactUrlUserinfo hides every URL's userinfo in one linear pass, however many URLs (B)", () => {
  // The URL regex this replaces (a scheme tried at every word start) takes about 3 s on this.
  assert.ok(elapsed(() => redactUrlUserinfo("a.".repeat(30_000))) < 1000);
  assert.equal(redactUrlUserinfo("a -https://u:p@h/x and x-ftp://v@w?q, mail@example.org"), "a -https://***@h/x and x-ftp://***@w?q, mail@example.org");
  assert.equal(redactUrlUserinfo("1://u:p@h ://u:p@h"), "1://u:p@h ://u:p@h");
  assert.equal(redactUrlUserinfo("https://h/p?u=a@b"), "https://h/p?u=a@b");
  for (const text of ["a".repeat(1_000_000), "a.".repeat(500_000), "://".repeat(100_000), `https://${"u".repeat(1_000_000)}`]) {
    assert.equal(redactUrlUserinfo(text), text);
  }
  const many = redactUrlUserinfo("https://u:p@h ".repeat(100_000));
  assert.equal(many, "https://***@h ".repeat(100_000));
});

test("redactUrlUserinfo hides the userinfo of a URL glued onto the one before it, still linear (B2)", () => {
  // The authority read for the first `://` ends at the `/` of the second; the second URL starts
  // inside it (its scheme is the first one's host, or follows a redacted `@`), so the search goes
  // on after each `://`, not after the authority. The regex this replaces redacted both; the
  // first linear pass missed them.
  assert.equal(redactUrlUserinfo("https://host://u:p@h"), "https://host://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@x://v:q@w"), "https://***@x://***@w");
  assert.equal(redactUrlUserinfo("see https://h.example:/x://u:p@h"), "see https://h.example:/x://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@1://v:q@w"), "https://***@1://v:q@w");
  // Many glued URLs, unredacted and redacted, and long scheme-character runs: one pass each.
  const n = 100_000;
  for (const [text, want] of [
    [`${"a://".repeat(n)}u:p@h`, `${"a://".repeat(n)}***@h`],
    ["x://u:p@".repeat(n), "x://***@".repeat(n)],
    [`${"a.".repeat(500_000)}://u:p@h`, `${"a.".repeat(500_000)}://***@h`],
    [`https://${"a.".repeat(500_000)}://u:p@h`, `https://${"a.".repeat(500_000)}://***@h`],
    ["a:".repeat(500_000), "a:".repeat(500_000)],
  ] as const) {
    let got = "";
    const ms = elapsed(() => (got = redactUrlUserinfo(text)));
    assert.ok(got === want, `${text.slice(0, 40)}…`);
    assert.ok(ms < 1000, `${Math.round(ms)} ms on ${text.slice(0, 40)}…`);
  }
});

test("a TextBuilder joins its pieces in order across batches", () => {
  const b = new TextBuilder();
  const expected: string[] = [];
  for (let i = 0; i < 40_000; i++) {
    b.push(String(i), ",");
    expected.push(String(i), ",");
  }
  assert.equal(b.toString(), expected.join(""));
  assert.equal(new TextBuilder().toString(), "");
});

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

test("sanitizeServerText drops whole escape sequences, not just their control bytes (C)", () => {
  const CSI8 = String.fromCharCode(0x9b);
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  for (const [input, expected] of [
    [`line1 ${ESC}]0;title${BEL}rest`, "line1 rest"],
    [`${ESC}]8;;https://evil.example${ESC}\\click${ESC}]8;;${ESC}\\`, "click"],
    [`${ESC}[31mred${ESC}[0m plain`, "red plain"],
    [`${ESC}[1;31;4mbold`, "bold"],
    [`${CSI8}2Jcleared`, "cleared"],
    [`${OSC8}0;t${ST8}ok`, "ok"],
    [`a${ESC}7b${ESC}(Bc`, "abc"],
    // Unterminated: only ESC and its introducer go, the text stays.
    [`keep ${ESC}]0;no terminator here`, "keep 0;no terminator here"],
  ] as const) {
    assert.equal(sanitizeServerText(input), expected, JSON.stringify(input));
  }
});

test("sanitizeServerText drops invisible format characters (zero-width, soft hyphen, BOM) (C)", () => {
  const text = "real​ error Error: forged⁦x⁩ ﻿end­‍⁠!";
  assert.equal(sanitizeServerText(text), "real error Error: forgedx end!");
  assert.equal(sanitizeServerText("  Cannot GET  /feed/  Größe  "), "Cannot GET /feed/ Größe");
});

test("sanitizeServerText reads a bounded prefix and drops what the per-character filter dropped (C)", () => {
  // The filter it replaces, one character at a time: C0 but TAB to CR, DEL, C1 and Cf go.
  const perCharacter = (text: string): string =>
    [...text]
      .filter((ch) => {
        const n = ch.codePointAt(0) ?? 0;
        return (n >= 0x09 && n <= 0x0d) || !(n <= 0x1f || (n >= 0x7f && n <= 0x9f) || /\p{Cf}/u.test(ch));
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const every = Array.from({ length: 0x3000 }, (_, i) => String.fromCharCode(i)).join("") + "\u{1f600}\u{e0001}\ud800x";
  for (let at = 0; at < every.length; at += 512) {
    const piece = every.slice(at, at + 512).replace(/[\u001b\u0090\u0098\u009b-\u009f]/g, "");
    assert.equal(sanitizeServerText(piece), perCharacter(piece), `from U+${at.toString(16)}`);
  }
  // At most 16 384 units of the text are read, never half a surrogate pair.
  assert.equal(sanitizeServerText("x".repeat(100_000)).length, 16_384);
  assert.equal(sanitizeServerText(`${"x".repeat(16_383)}\u{1f600}`), "x".repeat(16_383));
  // A control string ends at another introducer: the first is dropped by the filter, the second
  // string as a whole. An unterminated run of introducers is linear (100 000 × U+009D took 16 s
  // with the introducers allowed inside a control string).
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  assert.equal(sanitizeServerText(`a${OSC8}0;x${OSC8}0;t${ST8}b`), "a0;xb");
  assert.equal(sanitizeServerText(`a${ESC}]0;x${ESC}]0;t${BEL}b`), "a0;xb");
});

// These tests start a process with a small heap: 30 s instead of the suite's 5 s.
const STARTS_A_PROCESS = { timeout: 30_000 };

test("a malformed answer with a 16 MB tag name ends in a parse error within a small heap (C)", STARTS_A_PROCESS, () => {
  // The parser names the tag in its reason, and the engine cleaned all of it before the cut, one
  // `+=` per character: a 16 MB name aborted the process under a 128 MB heap.
  const engine = new URL("../src/engine.js", import.meta.url).href;
  const script =
    `const { RequestEngine } = await import(${JSON.stringify(engine)});` +
    `const body = Buffer.from("<" + "a".repeat(16 * 1024 * 1024));` +
    `const e = new RequestEngine({ transport: async () => ({ status: 200, headers: { "content-type": "application/xml" }, body }) });` +
    `try { await e.getFeed("/feed.xml"); } catch (err) { process.stdout.write(err.name + " " + err.message.length); }`;
  const out = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script], { encoding: "utf8" });
  const [name, length] = out.split(" ");
  assert.equal(name, "LebensmittelwarnungParseError", out);
  assert.ok(Number(length) < 1000, out);
});

test("a 16 MB plain-text error body ends in an API error within a small heap (C)", STARTS_A_PROCESS, () => {
  // The snippet's whitespace was folded over the whole body before the cut: one replacement per
  // space of a 16 MB body exhausted a 128 MB heap.
  const engine = new URL("../src/engine.js", import.meta.url).href;
  const script =
    `const { RequestEngine } = await import(${JSON.stringify(engine)});` +
    `const body = Buffer.from("x ".repeat(8_000_000));` +
    `const e = new RequestEngine({ maxRetries: 0, transport: async () => ({ status: 500, headers: { "content-type": "text/plain" }, body }) });` +
    `try { await e.getFeed("/feed.xml"); } catch (err) { process.stdout.write(err.name + " " + err.message.length + " " + err.detail.length); }`;
  const out = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script], { encoding: "utf8" });
  const [name, length, detail] = out.split(" ");
  assert.equal(name, "LebensmittelwarnungApiError", out);
  assert.ok(Number(length) < 1000, out);
  assert.equal(Number(detail), 201, out); // 200 characters and the "…"
});

// Class D of .reviews/2026-10-27-security-audit (portfolio round): the base URL's credentials
// are scrubbed from decoded server text too, and from every value the client quotes from an
// answer, before it is cut.
test("an error body keeps its spelling unless a credential hides behind an escape (D)", async () => {
  const base = "https://alice:s3cret-pw@mirror.example";
  const failed = async (body: string): Promise<LebensmittelwarnungApiError> => {
    const e = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(body, "application/json", 500) });
    const err = await e.getFeed("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof LebensmittelwarnungApiError, String(err));
    return err;
  };
  // No credential, or one spelled as sent: the body as sent (scrubbed), escapes kept.
  assert.equal((await failed('{"m":"caf\\u00e9 \\"x\\""}')).body, '{"m":"caf\\u00e9 \\"x\\""}');
  assert.equal((await failed('{"m":"pw s3cret-pw \\u00e9"}')).body, '{"m":"pw *** \\u00e9"}');
  // Escaped: written again decoded, scrubbed in that spelling; the message's snippet with it.
  const escaped = await failed('{"m":"pw s3cret\\u002dpw \\u00e9"}');
  assert.equal(escaped.body, '{"m":"pw *** é"}');
  assert.equal(escaped.detail, '{"m":"pw *** é"}');
  assert.ok(!escaped.message.includes("s3cret"), escaped.message);
  // Not JSON: nobody decodes it, it stays as sent.
  assert.equal((await failed("pw s3cret\\u002dpw")).body, "pw s3cret\\u002dpw");
});

test("a password with an inner space is scrubbed whole, never word by word (D)", async () => {
  // The URL carries it percent-encoded (`pa%20ss-word`); the server echoes it decoded.
  const base = "https://alice:pa ss-word@mirror.example";
  for (const body of ["bad password pa ss-word here", "bad login alice:pa ss-word here", '{"m":"bad pa\\u0020ss-word"}']) {
    const e = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(body, "text/plain", 401) });
    const err = await e.getFeed("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof LebensmittelwarnungApiError, String(err));
    for (const text of [err.message, err.detail ?? "", err.body]) {
      assert.ok(!text.includes("ss-word") && !text.includes("pa ss"), `${body}: ${text}`);
    }
  }
});

test("an echo of the request URL as sent is scrubbed, a short password too (D)", async () => {
  // WHATWG percent-encodes `"` and `ä` in the userinfo it sends; a server that echoes the
  // request URL echoes that spelling, which the userinfo as typed doesn't match.
  const e = new RequestEngine({
    baseUrl: 'https://alice:p"ä@mirror.example',
    maxRetries: 0,
    transport: async (req) => rawResponse(`no route for ${req.url}`, "text/plain", 404),
  });
  const err = await e.getFeed("/x").catch((caught: unknown) => caught);
  assert.ok(err instanceof LebensmittelwarnungApiError, String(err));
  for (const text of [err.message, err.detail ?? "", err.body]) {
    assert.ok(!text.includes("p%22%C3%A4") && !text.includes("alice:p"), text);
  }
});

test("a token the answer names as its root element, a tag, a parent or its charset is scrubbed from the library's error, as spelled (D)", async () => {
  // Every value of an answer the client quotes into its own errors: the root element's name and
  // the other names in the parser's reason, and the declared charset. The CLI redacted them on
  // stderr; a library caller logging err.message saw the token, and the parser named elements in
  // lower case, a spelling the exact scrub doesn't match.
  const token = "DummyToken0123456789";
  for (const xml of [
    `<${token}><channel/></${token}>`,
    `<rss><channel><${token} a="1"`,
    `<rss><channel><${token}>`,
    `<rss><channel><${token}><item/></${token}></channel></rss>`,
    `<?xml version="1.0" encoding="${token}"?><rss/>`,
  ]) {
    const e = new RequestEngine({ baseUrl: `https://alice:${token}@mirror.example`, transport: async () => rssResponse(xml) });
    const err = await e.getFeed("/feed.xml").catch((caught: unknown) => caught);
    assert.ok(err instanceof LebensmittelwarnungParseError, String(err));
    assert.ok(!err.message.toLowerCase().includes(token.toLowerCase()), err.message);
    assert.ok(err.message.includes("***"), err.message);
  }
});

test("a long name in the parser's reason is scrubbed before it is cut, so no part of a credential stays (D)", async () => {
  const pw = "s3cret-Pw-long";
  for (const at of [0, 30, 35, 39, 470, 495]) {
    const name = `x${"x".repeat(at)}${pw.replace("-", "_")}${"y".repeat(600)}`;
    const e = new RequestEngine({ baseUrl: `https://alice:${pw.replace("-", "_")}@mirror.example`, transport: async () => rssResponse(`<${name}/>`) });
    const err = await e.getFeed("/feed.xml").catch((caught: unknown) => caught);
    assert.ok(err instanceof LebensmittelwarnungParseError, String(err));
    assert.ok(!err.message.includes("s3cr"), `${at}: ${err.message}`);
  }
});

test("echoedCredentialForms treats a userinfo without a password as a token (Basic `TOKEN:`) (E)", () => {
  const basic = (pair: string): string => Buffer.from(pair, "utf8").toString("base64");
  assert.deepEqual(echoedCredentialForms("alice:s3cret"), [basic("alice:s3cret"), "alice:s3cret", "s3cret"]);
  assert.deepEqual(echoedCredentialForms("T0ken"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T0ken:"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T%C3%B6k"), [basic("Tök:"), "Tök:"]); // short: not alone
  assert.deepEqual(echoedCredentialForms(":pw12"), [basic(":pw12"), ":pw12", "pw12"]);
  assert.deepEqual(echoedCredentialForms(""), []);
  assert.deepEqual(echoedCredentialForms(":"), []);
});

test("a token userinfo (no password) a server echoes is scrubbed from the error in every form (E)", async () => {
  const token = "T0kenS3cret";
  const basic = Buffer.from(`${token}:`, "utf8").toString("base64");
  for (const baseUrl of [`https://${token}@mirror.example`, `https://${token}:@mirror.example`]) {
    for (const echo of [`bad token ${token}`, `Authorization: Basic ${basic}`, `user ${token}: unknown`]) {
      const engine = new RequestEngine({ baseUrl, maxRetries: 0, transport: makeMockTransport(() => rawResponse(echo, "text/plain", 401)).transport });
      const err = await engine.getFeed("/x").catch((caught: unknown) => caught);
      assert.ok(err instanceof LebensmittelwarnungApiError, String(err));
      assert.match(err.message, /^HTTP 401 /);
      for (const text of [err.message, err.body, String(err.detail)]) {
        assert.ok(!text.includes(token) && !text.includes(basic), `${baseUrl} ${echo}: ${text}`);
      }
    }
    // And the document element an answer names after it.
    const named = new RequestEngine({ baseUrl, transport: async () => rssResponse(`<${token}><channel/></${token}>`) });
    const err = await named.getFeed("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof LebensmittelwarnungParseError && !err.message.includes(token), String(err));
  }
});

// Classes F, F3, F4 and F5 of .reviews/2026-10-27-security-audit (portfolio round): the base URL
// is read as WHATWG reads it, by every check and for the request.
test("a base URL with a backslash, or whose scheme is not followed by // and the host, is rejected at construction, never echoing the password (F, F4)", () => {
  // WHATWG ends an http(s) authority at "\\", and repairs `http:host`, `http:/host` and
  // `http:///host` silently into `http://host`: the host requested would not be the one typed.
  const absolute = 'Expected an absolute http(s) URL ("https://" and the host).';
  const backslash = 'A base URL cannot contain a backslash (\\); write "/" instead.';
  for (const [baseUrl, reason] of [
    ["https://alice:s3cret@api.example\\@evil.example", backslash],
    ["https://api.example\\evil", backslash],
    ["https:\\\\alice:s3cret@h.example", backslash],
    ["http:alice:s3cret@h.example", absolute],
    ["https:/alice:s3cret@h.example", absolute],
    ["http:///alice:s3cret@h.example", absolute],
    ["HTTPS:h.example/v1", absolute],
  ] as const) {
    const mt = makeMockTransport(() => rssResponse(fx.feedXml));
    assert.throws(
      () => new RequestEngine({ transport: mt.transport, baseUrl }),
      (err: unknown) => err instanceof LebensmittelwarnungValidationError && err.message === `Invalid baseUrl: ${reason}` && !err.message.includes("s3cret"),
      baseUrl,
    );
    assert.equal(mt.calls.length, 0, baseUrl);
  }
  // A spelling the parser keeps as typed stays accepted: an upper-case scheme, an explicit port.
  for (const baseUrl of ["HTTPS://h.example/v1", "http://alice:pw@h.example:8080"]) {
    assert.doesNotThrow(() => new RequestEngine({ baseUrl }), baseUrl);
  }
});

test("a base URL typed without its scheme never names its user name or password (F5)", () => {
  // This repo's reasons quote nothing of the value (`Only http: and https: base URLs are
  // supported.`, `Expected a valid URL.`); the kit's `Unsupported scheme "<user>:"` echoed it.
  for (const baseUrl of ["T0kenS3cret:@h.example", "alice:s3cretPw@h.example", "T0kenS3cret@h.example", "my_user:s3cretPw@h", "T0k:@h"]) {
    assert.throws(
      () => new RequestEngine({ baseUrl }),
      (err: unknown) => err instanceof LebensmittelwarnungValidationError && !/t0kens3cret|s3cretpw|my_user|t0k:/i.test(err.message),
      baseUrl,
    );
  }
});

test("requests go to the base URL as it parses: host lower-cased, default port dropped (F)", async () => {
  const mt = makeMockTransport(() => rssResponse(fx.feedXml));
  await new LebensmittelwarnungClient({ baseUrl: "https://API.Example:443/v1/", transport: mt.transport }).warnings();
  assert.ok(mt.last().url.startsWith("https://api.example/v1/"), mt.last().url);
});

test("credentialsIn ends the authority of a special scheme at a backslash, as WHATWG does (F)", () => {
  for (const scheme of ["http", "https", "HTTPS", "ws", "wss", "ftp"]) {
    assert.deepEqual(credentialsIn(`${scheme}://u:p@a.example\\@b.example/x`), ["u:p"], scheme);
    assert.equal(new URL(`${scheme}://u:p@a.example\\@b.example/x`).password, "p", scheme);
  }
  // Another scheme's authority runs on to "/", "?" or "#".
  assert.deepEqual(credentialsIn("foo://u:p@a.example\\@b.example/x"), ["u:p@a.example\\"]);
  assert.deepEqual(credentialsIn("https://u:p@a.example/x\\@y"), ["u:p"]);
});

test("credentialsIn skips the slashes and backslashes WHATWG skips after a special scheme (F3)", () => {
  // `http:///u:pw@h`, `https:\\u:pw@h` and `http:u:pw@h` all carry `u:pw` for WHATWG; read
  // after "://", the userinfo was missed, so a refused --base-url echoed the password in clear.
  for (const value of [
    "http:alice:pw@h.example",
    "http:/alice:pw@h.example",
    "http:///alice:pw@h.example/x",
    "https:////alice:pw@h.example",
    "HTTPS:\\\\alice:pw@h.example",
    "wss:\\/alice:pw@h.example",
    "ftp:alice:pw@h.example",
  ]) {
    assert.deepEqual(credentialsIn(value), ["alice:pw"], value);
    assert.equal(new URL(value).password, "pw", value);
  }
  // Another scheme needs "//" before an authority: `foo:u:p@h` and `foo:///u:p@h` carry none.
  assert.deepEqual(credentialsIn("foo:u:p@h.example"), []);
  assert.deepEqual(credentialsIn("foo:///u:p@h.example"), []);
  assert.equal(new URL("foo:///u:p@h.example").password, "");
});

test("typedUrlCredentials reads a value meant as a URL whatever its scheme: missing, special without //, mistyped (F7)", () => {
  for (const [value, userinfo] of [
    ["https://alice:pw@h.example/x", "alice:pw"],
    ["http:///alice:pw@h.example", "alice:pw"],
    ["alice:pw@h.example/x", "alice:pw"],
    ["my_user:pw@h.example", "my_user:pw"],
    ["T0ken:@h.example", "T0ken:"],
    ["http//alice:pw@h.example", "alice:pw"],
    ["https//alice:pw@h.example/v1", "alice:pw"],
    ["http/alice:pw@h.example", "alice:pw"],
    ["htp:/alice:pw@h.example", "alice:pw"],
    ["http\\\\alice:pw@h.example", "alice:pw"],
    ["http//alice:p/w@h.example", "alice:p/w"],
  ] as const) {
    assert.deepEqual(typedUrlCredentials(value), [userinfo], value);
  }
  // No "@" after the slashes, or a scheme spelled with "//" and no userinfo: none.
  for (const value of ["", "h.example/x", "http//h.example/x", "@h.example/x", "http//@h.example", "https://h.example/a@b"]) {
    assert.deepEqual(typedUrlCredentials(value), [], value);
  }
});
