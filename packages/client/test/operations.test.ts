// The use cases of the skills against a mock of the portal's feed (live-shaped notices), with the
// skills' traps as cases: a state is the distribution list, not the issuer; the reason is a
// category that never names the pathogen; types and reasons overlap, so counts don't add up; a
// product search widens before it says "no recall" and names its terms; a date is the last update;
// every recall carries the prescribed citation.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countRecalls,
  getRecall,
  latestBestBefore,
  LebensmittelwarnungClient,
  LebensmittelwarnungValidationError,
  listRecalls,
  noticeInfo,
  resolveIssuer,
  resolveReason,
  resolveState,
  resolveType,
  searchRecalls,
  searchTerms,
} from "../src/index.js";
import { LIVE_NOTICES, portal, type MockNotice } from "./fixtures.js";

const NOW = { now: () => new Date("2026-11-19T10:00:00Z") };
const setup = (notices?: readonly MockNotice[]) => {
  const mock = portal(notices);
  return { mock, client: new LebensmittelwarnungClient({ transport: mock.transport }) };
};
const titles = (list: { title?: string }[]) => list.map((r) => r.title);

test("resolveState reads a Land's name, code, English name or slug; anything else names the Länder", () => {
  assert.equal(resolveState("Thüringen"), "thueringen");
  assert.equal(resolveState("thueringen"), "thueringen");
  assert.equal(resolveState("NRW"), "nordrheinwestfalen");
  assert.equal(resolveState("Bavaria"), "bayern");
  assert.equal(resolveState("baden-wurttemberg"), "badenwuerttemberg");
  assert.throws(() => resolveState("Bavarai"), (err: Error) => err instanceof LebensmittelwarnungValidationError && /not a Land.*Baden-Württemberg/.test(err.message));
});

test("resolveType reads a slug, a German name or a word for it", () => {
  assert.equal(resolveType("Kosmetik"), "kosmetischemittel");
  assert.equal(resolveType("cosmetics"), "kosmetischemittel");
  assert.equal(resolveType("Tattoo-Farben"), "mittelzumtaetowieren");
  assert.equal(resolveType("Baby- und Kinderprodukte"), "babyundkinderprodukte");
  assert.equal(resolveType("Bedarfsgegenstände"), "bedarfsgegenstaende");
  assert.throws(() => resolveType("Autos"), /not a product type/);
});

test("resolveReason: the feed never names the pathogen or allergen, so the word is mapped to its category", () => {
  assert.deepEqual(resolveReason("Salmonellen"), { category: "Krankheitserreger", mappedFrom: "Salmonellen", by: "salmonell" });
  assert.deepEqual(resolveReason("Listeria"), { category: "Krankheitserreger", mappedFrom: "Listeria", by: "listeri" });
  assert.deepEqual(resolveReason("Erdnuss"), { category: "Allergene", mappedFrom: "Erdnuss", by: "erdnuss" });
  assert.deepEqual(resolveReason("Glassplitter"), { category: "Fremdkörper", mappedFrom: "Glassplitter", by: "splitter" });
  assert.deepEqual(resolveReason("fremdkoerper"), { category: "Fremdkörper" });
  assert.throws(() => resolveReason("Wetter"), /no reason category.*Krankheitserreger/);
});

test("resolveReason takes the most specific word, not the first category with a part of it; a tie names both", () => {
  assert.deepEqual(resolveReason("Schwermetalle"), { category: "Rückstände und Kontaminanten", mappedFrom: "Schwermetalle", by: "schwermetall" });
  assert.equal(resolveReason("Kunststoffweichmacher").category, "Gesundheitsschädliche Substanz");
  assert.equal(resolveReason("Glassplitter").category, "Fremdkörper");
  assert.throws(
    () => resolveReason("Bleihaltige Glasur"),
    (err: Error) => err instanceof LebensmittelwarnungValidationError && /more than one category: Fremdkörper \(by "glas"\), Rückstände und Kontaminanten \(by "blei"\)/.test(err.message),
  );
});

test("resolveType takes the most specific word: food-contact material is a consumer good; a mapped word is said", async () => {
  assert.equal(resolveType("Lebensmittelkontaktmaterial"), "bedarfsgegenstaende");
  assert.equal(resolveType("Lebensmittel"), "lebensmittel");
  for (const word of ["Textilien", "Schuhe", "Spielzeug", "Bekleidung", "Verpackung", "Geschirr"]) assert.equal(resolveType(word), "bedarfsgegenstaende", word);
  const { client } = setup();
  const answer = await listRecalls(client, { type: "Kinderschokolade" }, NOW);
  assert.equal(answer.searched.type, "Baby- und Kinderprodukte");
  assert.match(answer.notes.join(" "), /"Kinderschokolade" is read as the product type Baby- und Kinderprodukte \(by its part "kinder"\)/);
  assert.doesNotMatch((await listRecalls(client, { type: "Kosmetische Mittel" }, NOW)).notes.join(" "), /is read as the product type/);
});

test("listRecalls: the note on a mapped reason names the part it was read by", async () => {
  const { client } = setup();
  const answer = await listRecalls(client, { reason: "Schwermetalle" }, NOW);
  assert.deepEqual(answer.searched, { reason: "Rückstände und Kontaminanten" });
  assert.match(answer.notes.join(" "), /"Schwermetalle" is filed under Rückstände und Kontaminanten \(by its part "schwermetall"\)/);
});

test("resolveIssuer: a code, a Land or the BVL", () => {
  assert.equal(resolveIssuer("TH"), "TH");
  assert.equal(resolveIssuer("Nordrhein-Westfalen"), "NW");
  assert.equal(resolveIssuer("Bund"), "BVL");
});

test("resolveIssuer: a word that starts with Bund is no BVL, a Land after Bundesland or Freistaat is that Land, anything else names the issuers", () => {
  assert.equal(resolveIssuer("Bundesland Bayern"), "BY");
  assert.equal(resolveIssuer("Freistaat Sachsen"), "SN");
  assert.equal(resolveIssuer("bvl"), "BVL");
  assert.equal(resolveIssuer("Bundesamt für Verbraucherschutz und Lebensmittelsicherheit"), "BVL");
  for (const word of ["Bundesländer", "Deutschland", "Bremerhaven"]) {
    assert.throws(
      () => resolveIssuer(word),
      (err: Error) => err instanceof LebensmittelwarnungValidationError && /^Invalid issuer: .* is not a Land or the BVL\..*Thüringen.*BVL/.test(err.message) && !/state/.test(err.message),
      word,
    );
  }
});

test("noticeInfo reads the id, the day issued and the issuer from the URL; the code may be only in the file name", () => {
  assert.deepEqual(noticeInfo("https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/11_November/261113_16_NI_Leberwurst_fein,_100_Gramm/261113_16_NI_Leberwurst_fein,_100_Gramm.html"), {
    id: "261113_16_NI_Leberwurst_fein,_100_Gramm",
    noticeDate: "2026-11-13",
    issuer: "NI",
  });
  assert.equal(noticeInfo("https://x/Meldungen/2026/03_Maerz/260302_01_Sildenafil_in_NEM/260302_01_BW_Sildenafil_in_NEM_Meldung.html").issuer, "BW");
  assert.deepEqual(noticeInfo("https://x/Meldungen/2026/07/20260701_01_ST_Brot/20260701_01_ST_Brot.html"), { id: "20260701_01_ST_Brot", noticeDate: "2026-07-01", issuer: "ST" });
  assert.deepEqual(noticeInfo("https://x/Meldungen/2018/180621_BY_aerobic/a.html"), { id: "180621_BY_aerobic", noticeDate: "2018-06-21", issuer: "BY" });
});

test("latestBestBefore reads days, day-first slashes and months (their last day); none when the text names no date", () => {
  assert.equal(latestBestBefore("Mindesthaltbarkeitsdaten:\n04.12.2026, Charge: 3825082\n08.12.2026, Charge: 3825083"), "2026-12-08");
  assert.equal(latestBestBefore("Mindesthaltbarkeitsdatum: EXP 10-2027"), "2027-10-31");
  assert.equal(latestBestBefore("Mindesthaltbarkeitsdatum:\n07/2030"), "2030-07-31");
  assert.equal(latestBestBefore("04/05/2027"), "2027-05-04");
  assert.equal(latestBestBefore("Es werden alle noch gültigen Mindesthaltbarkeitsdaten zurückgerufen."), undefined);
});

test("latestBestBefore reads the live feed's other forms: day-month-year with hyphens, year first, month/two-digit year, a month's name", () => {
  assert.equal(latestBestBefore("mindestens haltbar bis: 04-06-2027"), "2027-06-04");
  assert.equal(latestBestBefore("E2028/1/1"), "2028-01-01");
  assert.equal(latestBestBefore("2027-06-04"), "2027-06-04");
  assert.equal(latestBestBefore("Holzhauser Bier: Mindesthaltbarkeitsdatum bis 7/26; Helles: bis 11/26"), "2026-11-30");
  assert.equal(latestBestBefore("Mindesthaltbarkeitsdatum E: 05/28"), "2028-05-31");
  assert.equal(latestBestBefore("März/2028"), "2028-03-31");
  assert.equal(latestBestBefore("Ende Dezember 2026"), "2026-12-31");
  assert.equal(latestBestBefore("12/11"), undefined, "day and month, or month and year: not guessed");
  assert.equal(latestBestBefore("31-02-2027"), undefined, "no such day");
});

test("listRecalls by state: the feed's state is where it was sold, so recalls issued elsewhere come too; issuer narrows to who issued it", async () => {
  const { mock, client } = setup();
  const sold = await listRecalls(client, { state: "Thüringen" }, NOW);
  assert.equal(new URL(mock.last().url).searchParams.get("state"), "thueringen");
  assert.ok(sold.recalls.some((r) => r.issuer === "SN"), "a Saxon notice sold in Thuringia");
  assert.match(sold.notes.join(" "), /where a product was sold.*use issuer/);
  const issued = await listRecalls(client, { issuer: "TH" }, NOW);
  assert.deepEqual(titles(issued.recalls), ["frischer Käse, 800 Gramm"]);
  assert.match(issued.notes.join(" "), /Land code in the notice's URL/);
});

test("listRecalls by reason: a pathogen word finds its category, joined reasons count, and the answer says it is only the category", async () => {
  const { client } = setup();
  const answer = await listRecalls(client, { reason: "Salmonellen" }, NOW);
  assert.deepEqual(answer.searched, { reason: "Krankheitserreger" });
  assert.deepEqual(titles(answer.recalls), ["Knackwurst „Kümmel” und Knackwurst „Knoblauch”", "Sesampaste (Tahina), 12x800 Gramm", "frischer Käse, 800 Gramm"]);
  assert.match(answer.notes.join(" "), /"Salmonellen" is filed under Krankheitserreger \(by its part "salmonell"\)/);
  const joined = await listRecalls(client, { reason: "Sonstige Gründe" }, NOW);
  assert.deepEqual(titles(joined.recalls), ["Waermesensorloeffel", "Lotus Mixed Herbal Paste with Honey"]);
});

test("listRecalls by type sends the slug; an empty type feed is a valid answer, not an error", async () => {
  const { mock, client } = setup();
  const empty = await listRecalls(client, { type: "Tattoo" }, NOW);
  assert.equal(new URL(mock.last().url).searchParams.get("type"), "mittelzumtaetowieren");
  assert.equal(empty.status, "empty");
  assert.match(empty.reason ?? "", /valid answer.*not an error.*often empty/);
});

test("listRecalls: without a date the list goes back years (said); days counts German days back from today", async () => {
  const { client } = setup();
  const all = await listRecalls(client, {}, NOW);
  assert.equal(all.total, LIVE_NOTICES.length);
  assert.match(all.notes.join(" "), /back to 2018-06-21: these are not all current/);
  const week = await listRecalls(client, { days: 7 }, NOW);
  assert.equal(week.searched.since, "2026-11-13");
  assert.deepEqual(titles(week.recalls), ["Leberwurst fein 100 Gramm", "rieker Antistress Damensandale rot/braun", "Knackwurst „Kümmel” und Knackwurst „Knoblauch”"]);
  await assert.rejects(listRecalls(client, { days: 7, since: "2026-11-01" }, NOW), /since or days, not both/);
});

test("a date is the last update: an old notice updated since is marked, the German day is kept (not the UTC one)", async () => {
  const midnight: MockNotice = { title: "Mitternacht", folder: "260904_01_BY_Mitternacht", pubDate: "Fri, 4 Sep 2026 00:00:00 +0200", reason: "Allergene" };
  const { client } = setup([...LIVE_NOTICES, midnight]);
  const recalls = (await listRecalls(client, { limit: 100 }, NOW)).recalls;
  const sesam = recalls.find((r) => r.title?.startsWith("Sesampaste"));
  assert.deepEqual([sesam?.noticeDate, sesam?.date, sesam?.updated], ["2026-10-02", "2026-10-27", true]);
  const knack = recalls.find((r) => r.title?.startsWith("Knackwurst"));
  assert.equal(knack?.updated, false);
  assert.equal(recalls.find((r) => r.title === "Mitternacht")?.date, "2026-09-04");
});

test("every recall carries the prescribed citation; nationwide ones leave the 16 Länder out; best-before is read", async () => {
  const { client } = setup();
  const answer = await listRecalls(client, { limit: 100 }, { now: () => new Date("2026-12-05T10:00:00Z") });
  const first = answer.recalls[0];
  assert.equal(first?.citation, `Portal www.lebensmittelwarnung.de, 2026: Leberwurst fein 100 Gramm, ${first?.link}, Stand: 18.11.2026.`);
  assert.match(answer.citationNote, /kostenfrei abrufbar/);
  assert.equal(first?.nationwide, true);
  assert.equal(first?.affectedStates, undefined);
  assert.equal(first?.bestBeforeUntil, "2026-12-08");
  assert.equal(first?.bestBeforePassed, false);
  const kaese = answer.recalls.find((r) => r.title === "frischer Käse, 800 Gramm");
  assert.deepEqual([kaese?.nationwide, kaese?.affectedStates, kaese?.bestBeforePassed], [false, ["Thüringen", "Sachsen"], true]);
});

test("listRecalls pages: limit and nextOffset over the total", async () => {
  const { client } = setup();
  const page = await listRecalls(client, { limit: 2 }, NOW);
  assert.deepEqual([page.total, page.recalls.length, page.nextOffset], [LIVE_NOTICES.length, 2, 2]);
  const last = await listRecalls(client, { offset: 8, limit: 2 }, NOW);
  assert.deepEqual([last.recalls.length, last.nextOffset], [1, undefined]);
});

test("listRecalls: a page at or past the end says so, with where the last page starts", async () => {
  const { client } = setup();
  for (const offset of [LIVE_NOTICES.length, 10_000]) {
    const past = await listRecalls(client, { offset, limit: 4 }, NOW);
    assert.deepEqual([past.status, past.total, past.recalls.length, past.nextOffset], ["ok", LIVE_NOTICES.length, 0, undefined]);
    assert.match(past.reason ?? "", new RegExp(`offset ${offset} is past the end: ${LIVE_NOTICES.length} recalls match.*offset 5 for the last 4`));
  }
  assert.equal((await listRecalls(client, { offset: 8, limit: 4 }, NOW)).reason, undefined);
});

test("a bad filter is refused before any request", async () => {
  const { mock, client } = setup();
  await assert.rejects(listRecalls(client, { state: "Atlantis" }), LebensmittelwarnungValidationError);
  await assert.rejects(listRecalls(client, { reason: "" }), LebensmittelwarnungValidationError);
  await assert.rejects(listRecalls(client, { since: "2026-02-30" }), LebensmittelwarnungValidationError);
  await assert.rejects(searchRecalls(client, { product: " " }), LebensmittelwarnungValidationError);
  assert.equal(mock.calls.length, 0);
});

test("searchTerms adds a single word's stem: Erdnüsse -> Erdnüss, Tahini -> Tahin, Würstchen -> Würst", () => {
  assert.deepEqual(searchTerms("Erdnüsse"), ["Erdnüsse", "Erdnüss"]);
  assert.deepEqual(searchTerms("Tahini"), ["Tahini", "Tahin"]);
  assert.deepEqual(searchTerms("Würstchen", ["Wurst"]), ["Würstchen", "Würst", "Wurst"]);
  assert.deepEqual(searchTerms("Leberwurst fein"), ["Leberwurst fein"]);
});

test("searchRecalls finds a name by its stem and any umlaut spelling: Tahini finds Tahina, kaese finds Käse, Erdnüsse finds Erdnüsse", async () => {
  const { client } = setup();
  const tahini = await searchRecalls(client, { product: "Tahini" }, NOW);
  assert.deepEqual([tahini.status, tahini.matchedIn, titles(tahini.recalls)], ["ok", "name", ["Sesampaste (Tahina), 12x800 Gramm"]]);
  assert.deepEqual(tahini.searched.terms, ["Tahini", "Tahin"]);
  assert.equal((await searchRecalls(client, { product: "kaese" }, NOW)).recalls[0]?.title, "frischer Käse, 800 Gramm");
  assert.equal((await searchRecalls(client, { product: "Peanut", alsoSearch: ["Erdnüsse"] }, NOW)).total, 1);
});

test("searchRecalls widens to every field and the URL before saying no: a manufacturer or a URL word matches, marked as text", async () => {
  const { client } = setup();
  const piasten = await searchRecalls(client, { product: "Piasten" }, NOW);
  assert.deepEqual([piasten.matchedIn, piasten.total], ["text", 1]);
  assert.match(piasten.notes[0] ?? "", /No product name contains the terms/);
  const chrom = await searchRecalls(client, { product: "ChromVI" }, NOW);
  assert.equal(chrom.recalls[0]?.title, "rieker Antistress Damensandale rot/braun");
});

test("searchRecalls: nothing found says which terms were searched where, and how to widen", async () => {
  const { client } = setup();
  const none = await searchRecalls(client, { product: "Gummibärchen" }, NOW);
  assert.equal(none.status, "empty");
  assert.deepEqual(none.searched.terms, ["Gummibärchen", "Gummibär"]);
  assert.match(none.reason ?? "", /No listed recall matched "Gummibärchen", "Gummibär" in the product names or any other field.*stem.*synonym.*brand/);
});

test("countRecalls by reason: joined reasons count under each, so the groups add up to more than the total", async () => {
  const { client } = setup();
  const counts = await countRecalls(client, { groupBy: "reason" }, NOW);
  const sum = counts.groups.reduce((n, g) => n + g.count, 0);
  assert.equal(counts.total, LIVE_NOTICES.length);
  assert.ok(sum > counts.total);
  assert.deepEqual(counts.groups[0], { key: "Gesundheitsschädliche Substanz", count: 4 });
  assert.match(counts.notes.join(" "), /more than total/);
});

test("countRecalls by type asks each type's feed and lists every type, 0 too; a baby spoon is also a consumer good, so the types overlap", async () => {
  const { mock, client } = setup();
  const counts = await countRecalls(client, { groupBy: "type" }, NOW);
  assert.equal(mock.calls.length, 6, "the total, then one request per type");
  assert.deepEqual(counts.groups, [
    { key: "Lebensmittel", count: 7 },
    { key: "Bedarfsgegenstände", count: 2 },
    { key: "Baby- und Kinderprodukte", count: 1 },
    { key: "Kosmetische Mittel", count: 0 },
    { key: "Mittel zum Tätowieren", count: 0 },
  ]);
  assert.match(counts.notes.join(" "), /Types overlap/);
  await assert.rejects(countRecalls(client, { groupBy: "type", type: "Kosmetik" }), /takes no type filter/);
});

test("countRecalls by issuer and by state: the URL's code, and every Land a notice was sold in", async () => {
  const { client } = setup();
  const issuers = await countRecalls(client, { groupBy: "issuer" }, NOW);
  assert.deepEqual(issuers.groups.slice(0, 3), [
    { key: "BY Bayern", count: 3 },
    { key: "BW Baden-Württemberg", count: 2 },
    { key: "NI Niedersachsen", count: 2 },
  ]);
  const states = await countRecalls(client, { groupBy: "state" }, NOW);
  assert.deepEqual(states.groups.find((g) => g.key === "Sachsen"), { key: "Sachsen", count: 9 });
});

test("getRecall finds an id in another spelling: percent-encoded, other case, with slashes or spaces around; an unknown id isn't called withdrawn", async () => {
  const { client } = setup();
  for (const id of ["261113_16_NI_Leberwurst_fein%2C_100_Gramm", "261113_16_ni_leberwurst_fein,_100_gramm", "/261113_16_NI_Leberwurst_fein,_100_Gramm/", " 261113_16_NI_Leberwurst_fein,_100_Gramm "]) {
    const found = await getRecall(client, { id }, NOW);
    assert.equal(found.status, "ok", id);
    assert.equal(found.searched.id, "261113_16_NI_Leberwurst_fein,_100_Gramm", id);
  }
  const unknown = await getRecall(client, { id: "Leberwurst fein 100 Gramm" }, NOW);
  assert.equal(unknown.status, "empty");
  const reason = unknown.status === "empty" ? unknown.reason : "";
  assert.match(reason, /No notice in the feed has this id.*check it/i);
  assert.doesNotMatch(reason, /^[^.]*withdrawn/, "the first sentence doesn't call the id withdrawn");
  assert.match(reason, /Only a notice .* before/);
  assert.equal((await getRecall(client, { id: "%E0%A4%A" }, NOW)).status, "empty", "a malformed escape is just an unknown id");
});

test("getRecall by id or URL: every field and the images with their credits; a notice gone from the feed was withdrawn", async () => {
  const { client } = setup();
  const byId = await getRecall(client, { id: "261113_16_NI_Leberwurst_fein,_100_Gramm" }, NOW);
  assert.equal(byId.status, "ok");
  if (byId.status !== "ok") return;
  assert.equal(byId.recall.fields["Verpackungseinheit"], "100 Gramm in einem Schlauchbeutel");
  assert.equal(byId.recall.images?.[0]?.credit, "© Oekoland GmbH Nord");
  const byUrl = await getRecall(client, { id: byId.recall.link ?? "" }, NOW);
  assert.equal(byUrl.status, "ok");
  const gone = await getRecall(client, { id: "250101_01_BY_Zurueckgezogen" }, NOW);
  assert.equal(gone.status, "empty");
  assert.match(gone.status === "empty" ? gone.reason : "", /withdrawn.*must delete it/);
});
