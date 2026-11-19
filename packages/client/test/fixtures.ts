import { STATE_NAMES, type StateSlug, type TypeSlug } from "../src/enums.js";
import { makeMockTransport, rssResponse, type MockTransport } from "./helpers.js";


// Canned lebensmittelwarnung.de RSS responses, trimmed to what the tests assert
// but structurally faithful to the live feed (verified 2026-07-13): RFC-822
// pubDates, numeric character entities in titles (`&#228;` = ä), and a CDATA
// `<description>` holding `<img src=…>` tags plus `<b>Label:</b> value` pairs
// separated by `<br/>` (with an embedded newline inside the manufacturer address).

/** A well-formed feed with three warnings of two product types + entities/CDATA. */
export const feedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<atom:link href="rssnewsfeed_Alle_DE.xml?nn=310818" rel="self" type="application/rss+xml" />
<title>Lebensmittelwarnung.de - Alle Bundesländer - Alle Produkttypen</title>
<link>https://www.lebensmittelwarnung.de/</link>
<description>Derzeit wird vor folgenden Produkten gewarnt.</description>
<language>de-de</language>
<ttl>60</ttl>
<item>
<title>R&#228;ucherschmelzk&#228;se-Zubereitung, Scheiben 175 Gramm</title>
<link>https://www.lebensmittelwarnung.de/Meldungen/2026/07/raeucher.html</link>
<pubDate>Fri, 10 Jul 2026 14:00:00 +0200</pubDate>
<description><![CDATA[<img src="https://www.lebensmittelwarnung.de/bild.png?__blob=normal&amp;v=1" width="100" /><br/><b>Bildquelle</b> © Firma Sales &amp; Service Aktuell GmbH<br/><b>Verpackungseinheit:</b> 175 Gramm-Packung<br/><b>Chargennummer / Los-Kennzeichnung:</b> 722641, 912641<br/><b>Grund der Meldung:</b>   Fremdk&#246;rper<br/><b>Haltbarkeit:</b> 17.08.2026; 22.08.2026<br/><b>Hersteller / Inverkehrbringer:</b> Sales & Service Aktuell GmbH
Am Wei&#223;bach 5
98646 Straufhain<br/><b>Betroffene Bundesl&#228;nder nach derzeitigem Stand:</b>   Bayern, Th&#252;ringen, Sachsen<br/>]]></description>
<guid>https://www.lebensmittelwarnung.de/Meldungen/2026/07/raeucher.html</guid>
</item>
<item>
<title>ja! Beerenmischung, tiefgefroren, 750 Gramm Beutel</title>
<link>https://www.lebensmittelwarnung.de/Meldungen/2026/07/beeren.html</link>
<pubDate>Wed, 8 Jul 2026 16:00:00 +0200</pubDate>
<description><![CDATA[<img src="https://www.lebensmittelwarnung.de/beeren.jpg" width="100" /><br/><b>Grund der Meldung:</b> Norovirus<br/><b>Hersteller / Inverkehrbringer:</b> Eurogroup Espa&#241;a S.A.U.<br/><b>Betroffene Bundesl&#228;nder nach derzeitigem Stand:</b> Nordrhein-Westfalen<br/>]]></description>
<guid>https://www.lebensmittelwarnung.de/Meldungen/2026/07/beeren.html</guid>
</item>
<item>
<title>Gesichtscreme Naturkosmetik 50 ml</title>
<link>https://www.lebensmittelwarnung.de/Meldungen/2026/06/creme.html</link>
<pubDate>Mon, 30 Jun 2026 09:30:00 +0200</pubDate>
<description><![CDATA[<b>Grund der Meldung:</b> mikrobiologische Verunreinigung<br/><b>Hersteller / Inverkehrbringer:</b> Muster Kosmetik GmbH<br/><b>Betroffene Bundesl&#228;nder nach derzeitigem Stand:</b> Bayern<br/>]]></description>
<guid>https://www.lebensmittelwarnung.de/Meldungen/2026/06/creme.html</guid>
</item>
</channel>
</rss>`;

/** The Bayern-narrowed feed (channel title reflects the server-side filter). */
export const bayernFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Lebensmittelwarnung.de - Bayern - Alle Produkttypen</title>
<link>https://www.lebensmittelwarnung.de/</link>
<ttl>60</ttl>
<item>
<title>Bayern-Produkt</title>
<link>https://www.lebensmittelwarnung.de/x.html</link>
<pubDate>Fri, 10 Jul 2026 14:00:00 +0200</pubDate>
<description><![CDATA[<b>Grund der Meldung:</b> Test<br/>]]></description>
</item>
</channel></rss>`;

/**
 * Notices around German midnight (live: 26 of 269 pubDates are `00:00:00`). By
 * German calendar day: 4 Sep, 3 Sep, and 4 Sep again for the UTC-stamped item
 * (22:30 UTC on 3 Sep is 00:30 on 4 Sep in Berlin).
 */
export const midnightFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Lebensmittelwarnung.de - Thüringen - Alle Produkttypen</title>
<ttl>60</ttl>
<item>
<title>Knackwürste im Ring</title>
<link>https://www.lebensmittelwarnung.de/knack.html</link>
<pubDate>Fri, 4 Sep 2026 00:00:00 +0200</pubDate>
<description><![CDATA[<b>Grund der Meldung:</b> Test<br/>]]></description>
</item>
<item>
<title>Late evening item</title>
<link>https://www.lebensmittelwarnung.de/late.html</link>
<pubDate>Thu, 3 Sep 2026 23:59:00 +0200</pubDate>
<description><![CDATA[<b>Grund der Meldung:</b> Test<br/>]]></description>
</item>
<item>
<title>UTC-stamped item</title>
<link>https://www.lebensmittelwarnung.de/utc.html</link>
<pubDate>Thu, 3 Sep 2026 22:30:00 +0000</pubDate>
<description><![CDATA[<b>Grund der Meldung:</b> Test<br/>]]></description>
</item>
</channel></rss>`;

/**
 * A description carrying the four labels every live item has (REQUIRED_LABELS), as a
 * CDATA section for a hand-built `<item>`: without them the CLI warns that the feed
 * lost a label.
 */
export const labelledDescription =
  "<![CDATA[<b>Produktbezeichnung/ -beschreibung:</b> Produkt<br/><b>Grund der Meldung:</b> Test<br/>" +
  "<b>Hersteller / Inverkehrbringer:</b> Firma<br/><b>Betroffene Bundesländer nach derzeitigem Stand:</b> Bayern<br/>]]>";

/** A single-item feed with an empty <item> and a self-closed pubDate (edge cases). */
export const sparseFeedXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Lebensmittelwarnung.de - Alle Bundesländer - Mittel zum Tätowieren</title>
<ttl>60</ttl>
</channel></rss>`;

/** The website's HTML shell, returned when the feed URL is wrong / moved. */
export const htmlShell = `<!doctype html>
<html lang="de"><head><title>lebensmittelwarnung.de</title></head><body>nope</body></html>`;

/**
 * The live shape since September 2026 (checked 2026-09-26: 265 of 265 items): every
 * item `<title>` is the unrendered CMS template, and the product name is only in the
 * description's "Produktbezeichnung/ -beschreibung" field. Trimmed from the live feed.
 */
export const templateTitleFeedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0"><channel>
<title>Lebensmittelwarnung.de - Alle Bundesländer - Alle Produkttypen</title>
<ttl>60</ttl>
<item>
<title>$esc.escapeXml($cms.oneLineText($m.title))</title>
<link>https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260925_10_NI_Kimchi/260925_10_NI_Kimchi.html</link>
<pubDate>Fri, 25 Sep 2026 19:55:00 +0200</pubDate>
<description><![CDATA[<b>Verpackungseinheit:</b> Glas zu 300 Gramm<br/><b>Grund der Meldung:</b>   Fremdkörper<br/><b>Hersteller / Inverkehrbringer:</b> Hersteller: Fung’s Handels GmbH
Varrelheide 190
30657 Hannover<br/><b>Produktbezeichnung/ -beschreibung:</b> KIMCHI 300 Gramm<br/><b>Betroffene Bundesländer nach derzeitigem Stand:</b>   Hamburg, Schleswig-Holstein<br/>]]></description>
</item>
<item>
<title>$esc.escapeXml($cms.oneLineText($m.title))</title>
<link>https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/09_September/260918_01_BVL_Erdbeeren/260918_01_BVL_Erdbeeren.html</link>
<pubDate>Fri, 18 Sep 2026 10:00:00 +0200</pubDate>
<description><![CDATA[<b>Grund der Meldung:</b> Allergene<br/><b>Produktbezeichnung/ -beschreibung:</b> Deluxe Erdbeeren in weißer Schokolade, 120 Gramm<br/>]]></description>
</item>
<item>
<title>$esc.escapeXml($cms.oneLineText($m.title))</title>
<link>https://www.lebensmittelwarnung.de/x.html</link>
<pubDate>Thu, 17 Sep 2026 10:00:00 +0200</pubDate>
<description><![CDATA[<b>Grund der Meldung:</b> Test<br/>]]></description>
</item>
</channel></rss>`;

// ---- a mock of the portal, for the use cases (operations.ts) and the MCP server's tests ----

/** One notice of the mock portal: what a feed item carries, and the product types it is listed under. */
export interface MockNotice {
  title: string;
  /** The notice's folder name, as the live portal names it ("261113_16_NI_Leberwurst_fein,_100_Gramm"). */
  folder: string;
  /** The file name, when it differs from the folder's (`<folder>.html`). */
  file?: string;
  pubDate: string;
  reason: string;
  product?: string;
  manufacturer?: string;
  /** The Länder it was sold in (default: all 16). */
  states?: string[];
  /** The `type=` feeds that list it (default: lebensmittel). */
  types?: TypeSlug[];
  lot?: string;
  bestBefore?: string;
  packaging?: string;
  image?: { url: string; credit: string };
}

/** Every Land, as the notices list them. */
export const ALL_STATES = Object.values(STATE_NAMES);

/** A notice's link: live-shaped, under its folder. */
export function noticeLink(notice: Pick<MockNotice, "folder" | "file" | "pubDate">): string {
  const year = /\b(20\d\d)\b/.exec(notice.pubDate)?.[1] ?? "2026";
  return `https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/${year}/11_November/${notice.folder}/${notice.file ?? `${notice.folder}.html`}`;
}

const xmlText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One feed item, its description as the portal writes it (labels in bold, `<br/>` between). */
function itemXml(notice: MockNotice): string {
  const fields: [string, string | undefined][] = [
    ["Verpackungseinheit", notice.packaging],
    ["Chargennummer / Los-Kennzeichnung", notice.lot],
    ["Grund der Meldung", notice.reason],
    ["Haltbarkeit", notice.bestBefore],
    ["Hersteller / Inverkehrbringer", notice.manufacturer],
    ["Produktbezeichnung/ -beschreibung", notice.product ?? notice.title],
    ["Betroffene Bundesländer nach derzeitigem Stand", (notice.states ?? ALL_STATES).join(", ")],
  ];
  const image = notice.image === undefined ? "" : `<img src="${notice.image.url}" width="100" /><br/><b>Bildquelle</b> ${notice.image.credit}<br/>`;
  const description = image + fields.filter(([, value]) => value !== undefined).map(([label, value]) => `<b>${label}:</b> ${value}<br/>`).join("");
  return `<item>
<title>${xmlText(notice.title)}</title>
<link>${xmlText(noticeLink(notice))}</link>
<pubDate>${notice.pubDate}</pubDate>
<description><![CDATA[${description}]]></description>
</item>`;
}

/** An RSS feed of `notices`, newest first as given. */
export function feedOf(notices: readonly MockNotice[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0"><channel>
<title>Lebensmittelwarnung.de - Alle Bundesländer - Alle Produkttypen</title>
<link>https://www.lebensmittelwarnung.de/</link>
<ttl>60</ttl>
${notices.map(itemXml).join("\n")}
</channel></rss>`;
}

/**
 * Notices shaped like the live feed of 2026-11-19 (trimmed): nationwide and regional ones, joined
 * reasons, a baby product also listed as a consumer good, a notice updated weeks after it was
 * issued (the folder's date is older than pubDate), a folder without the Land code (only the file
 * name has it), and one from 2018, still listed.
 */
export const LIVE_NOTICES: readonly MockNotice[] = [
  {
    title: "Leberwurst fein 100 Gramm",
    folder: "261113_16_NI_Leberwurst_fein,_100_Gramm",
    pubDate: "Wed, 18 Nov 2026 08:09:00 +0100",
    reason: "Fremdkörper",
    product: "Leberwurst fein, 100 Gramm",
    manufacturer: "Hersteller:\nFranz Ludowig Fleischerei GmbH & Co. KG\nHindenburgstraße 48\n31515 Wunstorf",
    lot: "Chargennummer:\n3825082,\n3825083",
    bestBefore: "Mindesthaltbarkeitsdaten:\n04.12.2026, Charge: 3825082\n08.12.2026, Charge: 3825083",
    packaging: "100 Gramm in einem Schlauchbeutel",
    image: { url: "https://www.lebensmittelwarnung.de/___lebensmittelwarnung.de/Meldungen/2026/11_November/261113_16_NI_Leberwurst_fein,_100_Gramm/Bild_1.jpg?__blob=normal&amp;v=5", credit: "© Oekoland GmbH Nord" },
  },
  {
    title: "rieker Antistress Damensandale rot/braun",
    folder: "261117_19_BW_ChromVI_Schuhe",
    file: "261117_19_BW_ChromVI_Schuhe_Meldung.html",
    pubDate: "Tue, 17 Nov 2026 13:15:00 +0100",
    reason: "Gesundheitsschädliche Substanz",
    manufacturer: "Firma Rieker-Schuh GmbH",
    states: ALL_STATES.filter((s) => s !== "Bremen" && s !== "Saarland"),
    types: ["bedarfsgegenstaende"],
    lot: "Artikelnummer: 61338-35 (Größe 36-43)",
  },
  {
    title: "Knackwurst „Kümmel” und Knackwurst „Knoblauch”",
    folder: "261113_17_SN_Knackwurst_Kuemmel_und_Knackwurst_Knoblauch",
    pubDate: "Fri, 13 Nov 2026 12:30:00 +0100",
    reason: "Krankheitserreger",
    manufacturer: "Fleischerei Lars Methe,\nDorfstraße 2,\n04523 Pegau",
    states: ["Sachsen", "Sachsen-Anhalt", "Thüringen"],
    packaging: "lose Ware",
  },
  {
    title: "Waermesensorloeffel",
    folder: "261112_13_NI_Waermesensorloeffel",
    pubDate: "Thu, 12 Nov 2026 13:15:00 +0100",
    reason: "Gesundheitsschädliche Substanz, Sonstige Gründe",
    product: "Nûby Wärmesensorlöffel",
    manufacturer: "Hersteller: Nuby Asia Pacific Ltd., China",
    types: ["bedarfsgegenstaende", "babyundkinderprodukte"],
    lot: "Chargen: M2C18Z, M2D28Z, M2E26Z und M2F18Z.",
    packaging: "drei Löffel im Kartonblister",
  },
  {
    title: "Sesampaste (Tahina), 12x800 Gramm",
    folder: "261002_03_BY_Sesampaste",
    pubDate: "Tue, 27 Oct 2026 17:35:00 +0100",
    reason: "Krankheitserreger",
    product: "Sesampaste (Tahina), Marke: Chtoura Garden, 12x800 Gramm",
    manufacturer: "Tema Fine Foods",
    states: ["Baden-Württemberg", "Bayern", "Berlin", "Hamburg", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen", "Rheinland-Pfalz", "Sachsen"],
    lot: "L#80 925 TF",
    bestBefore: "Mindesthaltbarkeitsdatum: EXP 10-2027",
    packaging: "12x800 Gramm",
  },
  {
    title: "frischer Käse, 800 Gramm",
    folder: "260619_17_TH_frischer_Kaese",
    pubDate: "Wed, 24 Jun 2026 09:00:00 +0200",
    reason: "Krankheitserreger",
    product: "frischer Käse aus Kuhmilch, 800 Gramm",
    manufacturer: "Käse King\nLessingstraße 16\n99510 Apolda",
    states: ["Thüringen", "Sachsen"],
    lot: "F22042026",
    bestBefore: "30.11.2026",
    packaging: "800 Gramm",
  },
  {
    title: "„Treets Salted Peanuts Vegan 200 Gramm\" und „K-Classic Choc it bunte Erdnüsse 300 Gramm\"",
    folder: "260522_18_BY_Piasten",
    pubDate: "Tue, 26 May 2026 13:12:00 +0200",
    reason: "Fremdkörper",
    manufacturer: "Piasten GmbH,\nPiastenstraße 1,\n91301 Forchheim",
    lot: "Treets Salted Peanuts Vegan 200 Gramm: L6155Z",
    bestBefore: "Treets Salted Peanuts Vegan 200 Gramm: 11.05.2027",
  },
  {
    title: "Lotus Mixed Herbal Paste with Honey",
    folder: "260302_01_Sildenafil_in_NEM",
    file: "260302_01_BW_Sildenafil_in_NEM_Meldung.html",
    pubDate: "Mon, 2 Mar 2026 16:00:00 +0100",
    reason: "Sonstige Gründe, Gesundheitsschädliche Substanz",
    manufacturer: "Hergestellt für: Ersan Cimen,\nSindelfingerstraße 53,\n72070 Tübingen, Germany",
    bestBefore: "Mindesthaltbarkeitsdatum:\n07/2030",
  },
  {
    title: "aerobic stabilized oxygen, 70 Milliliter",
    folder: "180621_BY_aerobic_stabilized",
    pubDate: "Thu, 21 Jun 2018 11:54:00 +0200",
    reason: "Gesundheitsschädliche Substanz, Rückstände und Kontaminanten",
    manufacturer: "GLOBALIS,\nOase der Natur,\nWestheim 42,\n93049 Regensburg",
    bestBefore: "Mindesthaltbarkeitsdatum 31.12.2030",
    packaging: "70 Milliliter",
  },
];

/**
 * A mock of the portal's feed: `state=` keeps the notices sold in that Land (the distribution
 * list, as the live feed does), `type=` those listed under that product type. Any other path is
 * the website's HTML shell.
 */
export function portal(notices: readonly MockNotice[] = LIVE_NOTICES): MockTransport {
  return makeMockTransport((request) => {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("rssnewsfeed_Alle_DE.xml")) return rssResponse(htmlShell, 404);
    const state = url.searchParams.get("state");
    const type = url.searchParams.get("type");
    const listed = notices.filter(
      (n) => (state === null || (n.states ?? ALL_STATES).includes(STATE_NAMES[state as StateSlug])) && (type === null || (n.types ?? ["lebensmittel"]).includes(type as TypeSlug)),
    );
    return rssResponse(feedOf(listed));
  });
}
