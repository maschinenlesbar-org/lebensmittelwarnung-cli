// Conformance test P8 + P9 + P13 (fix plan 2026-10-06): a body is decoded by its declared
// charset (P8); a 2xx body without the documented shape is a parse error, never data or
// "nothing found" (P9); every rejected input is the library's validation error, never a raw
// TypeError or RangeError (P13). Shared across the *-cli repos; only the adapter differs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HttpResponse } from "../src/client/http.js";

// ---- adapter (per repo) -------------------------------------------------------------
import { LebensmittelwarnungClient as Client, filterWarnings } from "../src/client/client.js";
import {
  LebensmittelwarnungError as BaseError,
  LebensmittelwarnungParseError as ParseError,
  LebensmittelwarnungValidationError as ValidationError,
} from "../src/client/errors.js";
import type { Warning } from "../src/client/types.js";
/** A call whose answer contains a text field, and how to read that field from the result. */
const textCall = (client: Client): Promise<unknown> => client.warnings();
const textBody = (text: string): unknown =>
  `<rss version="2.0"><channel><title>t</title><item><title>${text}</title></item></channel></rss>`;
const readText = (result: unknown): string => (result as Warning[])[0]!.title!;
/** How a body goes on the wire: the feed is RSS, so the document as it is. */
const serialize = (body: unknown): string => String(body);
/** 2xx bodies the call must reject (error envelopes, empty or wrong shapes). */
const malformedBodies: unknown[] = [
  "null",
  "{}",
  "[]",
  "text",
  "42",
  '<rss version="2.0"/>',
  '<rss version="2.0"><item><title>x</title></item></rss>',
  "<error>boom</error>",
  "<feed><channel><item><title>x</title></item></channel></feed>",
  '<rss version="2.0"><channel><item><title>x</title>',
];
/** Library calls with wrong-typed or out-of-range input. */
const badCalls: Array<[string, () => unknown]> = [
  ["warnings(5)", () => new Client().warnings(5 as never)],
  ["warnings(null)", () => new Client().warnings(null as never)],
  ["warnings('bayern')", () => new Client().warnings("bayern" as never)],
  ["warnings([])", () => new Client().warnings([] as never)],
  ["warnings({ state: 5 })", () => new Client().warnings({ state: 5 as never })],
  ["warnings({ limit: '5' })", () => new Client().warnings({ limit: "5" as never })],
  ["warnings({ since: 20261001 })", () => new Client().warnings({ since: 20261001 as never })],
  ["filterWarnings('x')", () => filterWarnings("x" as never)],
  ["filterWarnings([null])", () => filterWarnings([null] as never, { search: "a" })],
  ["filterWarnings([], 5)", () => filterWarnings([], 5 as never)],
  ["new Client(null)", () => new Client(null as never)],
  ["timeoutMs: 'x'", () => new Client({ timeoutMs: "x" as unknown as number })],
  ["timeoutMs: -1", () => new Client({ timeoutMs: -1 })],
  ["maxRetries: 1.5", () => new Client({ maxRetries: 1.5 })],
  ["baseUrl: 5", () => new Client({ baseUrl: 5 as unknown as string })],
  ["userAgent: {}", () => new Client({ userAgent: {} as unknown as string })],
  ["transport: 'x'", () => new Client({ transport: "x" as never })],
  ["sleep: 5", () => new Client({ sleep: 5 as never })],
  ["defaultHeaders: 'x'", () => new Client({ defaultHeaders: "x" as never })],
  ["defaultHeaders: { a: 5 }", () => new Client({ defaultHeaders: { a: 5 } as never })],
];
// --------------------------------------------------------------------------------------

const respond = (body: Buffer, contentType: string) => async (): Promise<HttpResponse> => ({
  status: 200,
  headers: { "content-type": contentType },
  body,
});

test("P8: a body is decoded by its declared charset", async () => {
  const text = "Müller µg/l";
  for (const [charset, encoding] of [["iso-8859-1", "latin1"], ["utf-8", "utf8"]] as const) {
    const body = Buffer.from(serialize(textBody(text)), encoding);
    const client = new Client({ transport: respond(body, `application/json; charset=${charset}`) });
    assert.equal(readText(await textCall(client)), text, charset);
  }
});

test("P9: a 2xx body without the documented shape is a parse error", async () => {
  for (const body of malformedBodies) {
    const client = new Client({ transport: respond(Buffer.from(serialize(body)), "application/json"), maxRetries: 0 });
    await assert.rejects(textCall(client), ParseError, `body ${JSON.stringify(body)}`);
  }
  for (const raw of ["", "<html>maintenance</html>"]) {
    const client = new Client({ transport: respond(Buffer.from(raw), "text/html"), maxRetries: 0 });
    await assert.rejects(textCall(client), BaseError, `raw ${JSON.stringify(raw)}`);
  }
});

test("P13: every rejected input is the validation error, never a raw TypeError", async () => {
  for (const [label, fn] of badCalls) {
    await assert.rejects(async () => fn(), (e: unknown) => e instanceof ValidationError, label);
  }
});
