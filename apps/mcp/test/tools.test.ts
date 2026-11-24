// This server's tools against a mock of the portal's feed (the client's live-shaped notices), with
// the skills' traps as cases: each tool answers through the protocol (its structuredContent checked
// by the SDK against its output schema), a product search names its terms and widens, a Land is the
// distribution list and is sent as the feed's slug, a pathogen is filed under its category, counts
// say why they overlap, a page says where the next one starts, and every result carries the
// source, the licence and each recall's citation.
// The rules every server follows are the conformance tests (M1–M10).

import { test } from "node:test";
import assert from "node:assert/strict";
import { listTools } from "../src/mcp/server.js";
import { connect } from "./harness.js";
import { portal } from "./helpers.js";

const FEED = "https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/rssnewsfeed_Alle_DE.xml";

test("four tools: the product search, the list, the counts and one notice", () => {
  assert.deepEqual(listTools().map((t) => t.name), ["searchRecalls", "listRecalls", "countRecalls", "getRecall"]);
});

test("searchRecalls: Tahini finds Tahina by its stem; the result names the terms, the citation and the licence", async () => {
  const connection = await connect({ transport: portal() });
  const result = await connection.call("searchRecalls", { product: "Tahini" });
  const content = result.structuredContent ?? {};
  assert.equal(content["status"], "ok", result.content[0]?.text);
  assert.equal(content["matchedIn"], "name");
  assert.deepEqual((content["searched"] as { terms: string[] }).terms, ["Tahini", "Tahin"]);
  const recall = (content["recalls"] as { title: string; citation: string; lotNumbers: string; updated: boolean }[])[0];
  assert.equal(recall?.title, "Sesampaste (Tahina), 12x800 Gramm");
  assert.equal(recall?.lotNumbers, "L#80 925 TF");
  assert.equal(recall?.updated, true, "issued 2 Oct, updated 27 Oct");
  assert.match(recall?.citation ?? "", /^Portal www\.lebensmittelwarnung\.de, 2026: Sesampaste \(Tahina\), 12x800 Gramm, https:\/\/.*, Stand: 27\.10\.2026\.$/);
  assert.match(String(content["citationNote"]), /kostenfrei abrufbar/);
  assert.equal(content["source"], FEED);
  assert.match(String(content["licence"]), /copyright-protected.*Impressum/);
  await connection.close();
});

test("searchRecalls: nothing found is empty with every term searched and how to widen; a Land is sent as its slug", async () => {
  const transport = portal();
  const connection = await connect({ transport });
  const result = (await connection.call("searchRecalls", { product: "Gummibärchen", state: "NRW" })).structuredContent ?? {};
  assert.equal(result["status"], "empty");
  assert.match(String(result["reason"]), /"Gummibärchen", "Gummibär".*stem.*brand/);
  assert.equal(new URL(transport.last().url).searchParams.get("state"), "nordrheinwestfalen");
  assert.equal(result["source"], `${FEED}?state=nordrheinwestfalen`);
  await connection.close();
});

test("searchRecalls pages: offset takes the next page from nextOffset; after the size cap nextOffset is the first recall not shown", async () => {
  const connection = await connect({ transport: portal() });
  const first = (await connection.call("searchRecalls", { product: "Gramm", limit: 2 })).structuredContent ?? {};
  assert.deepEqual([first["total"], (first["recalls"] as unknown[]).length, first["nextOffset"]], [4, 2, 2]);
  const next = (await connection.call("searchRecalls", { product: "Gramm", limit: 2, offset: 2 })).structuredContent ?? {};
  assert.deepEqual([(next["recalls"] as unknown[]).length, next["nextOffset"]], [2, undefined]);
  assert.notDeepEqual(next["recalls"], first["recalls"]);
  await connection.close();
  const small = await connect({ transport: portal(), config: { maxResultChars: 4500 } });
  const cut = (await small.call("searchRecalls", { product: "Gramm", limit: 4 })).structuredContent ?? {};
  const shown = (cut["recalls"] as unknown[]).length;
  assert.equal(cut["truncated"], true);
  assert.ok(shown >= 1 && shown < 4, String(shown));
  assert.equal(cut["nextOffset"], shown);
  await small.close();
});

test("listRecalls: Salmonellen is filed under Krankheitserreger (said); a state is the distribution list; an unknown Land is a tool error", async () => {
  const connection = await connect({ transport: portal() });
  const content = (await connection.call("listRecalls", { reason: "Salmonellen", state: "Sachsen" })).structuredContent ?? {};
  assert.deepEqual(content["searched"], { state: "Sachsen", reason: "Krankheitserreger" });
  assert.deepEqual((content["recalls"] as { issuer: string }[]).map((r) => r.issuer), ["SN", "BY", "TH"]);
  assert.match((content["notes"] as string[]).join(" "), /where a product was sold.*filed under Krankheitserreger/);
  const wrong = await connection.call("listRecalls", { state: "Atlantis" });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0]?.text ?? "", /not a Land/);
  await connection.close();
});

test("listRecalls pages with nextOffset; an empty type feed is a valid answer", async () => {
  const connection = await connect({ transport: portal() });
  const first = (await connection.call("listRecalls", { limit: 2 })).structuredContent ?? {};
  assert.deepEqual([first["total"], (first["recalls"] as unknown[]).length, first["nextOffset"]], [9, 2, 2]);
  const tattoo = (await connection.call("listRecalls", { type: "Tattoo" })).structuredContent ?? {};
  assert.equal(tattoo["status"], "empty");
  assert.match(String(tattoo["reason"]), /valid answer/);
  assert.equal(tattoo["source"], `${FEED}?type=mittelzumtaetowieren`);
  await connection.close();
});

test("countRecalls by type: one request per type, the overlap said; the source is the feed without a type", async () => {
  const transport = portal();
  const connection = await connect({ transport });
  const content = (await connection.call("countRecalls", { groupBy: "type" })).structuredContent ?? {};
  assert.equal(content["total"], 9);
  assert.deepEqual((content["groups"] as { key: string; count: number }[]).map((g) => g.key), ["Lebensmittel", "Bedarfsgegenstände", "Baby- und Kinderprodukte", "Kosmetische Mittel", "Mittel zum Tätowieren"]);
  assert.match((content["notes"] as string[]).join(" "), /Types overlap/);
  assert.equal(content["source"], FEED);
  assert.equal(transport.calls.length, 6);
  await connection.close();
});

test("getRecall: the notice in full with the image credits; one gone from the feed is empty with why", async () => {
  const connection = await connect({ transport: portal() });
  const found = (await connection.call("getRecall", { id: "261113_16_NI_Leberwurst_fein,_100_Gramm" })).structuredContent ?? {};
  const recall = found["recall"] as { fields: Record<string, string>; images: { credit: string }[]; issuerName: string };
  assert.equal(recall.fields["Verpackungseinheit"], "100 Gramm in einem Schlauchbeutel");
  assert.equal(recall.images[0]?.credit, "© Oekoland GmbH Nord");
  assert.equal(recall.issuerName, "Niedersachsen");
  const gone = (await connection.call("getRecall", { id: "250101_01_BY_Weg" })).structuredContent ?? {};
  assert.equal(gone["status"], "empty");
  assert.match(String(gone["reason"]), /withdrawn/);
  await connection.close();
});
