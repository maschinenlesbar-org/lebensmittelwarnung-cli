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

/** A single-item feed with an empty <item> and a self-closed pubDate (edge cases). */
export const sparseFeedXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Lebensmittelwarnung.de - Alle Bundesländer - Mittel zum Tätowieren</title>
<ttl>60</ttl>
</channel></rss>`;

/** The website's HTML shell, returned when the feed URL is wrong / moved. */
export const htmlShell = `<!doctype html>
<html lang="de"><head><title>lebensmittelwarnung.de</title></head><body>nope</body></html>`;
