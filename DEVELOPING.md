# Developing & integrating

This document covers `lebensmittelwarnung-cli` as a **TypeScript library**, plus its
architecture, testing and release setup. If you just want to use the command-line
tool, start with the **[README](README.md)** and **[Usage.md](Usage.md)** instead.

The package ships both a CLI (`lebensmittel`) and a typed API client
(`LebensmittelwarnungClient`) for Germany's official product-warning portal,
[lebensmittelwarnung.de](https://www.lebensmittelwarnung.de) — the recalls
(*Rückrufe*) published by the sixteen Länder and the Bundesamt für Verbraucherschutz
und Lebensmittelsicherheit (BVL).

**Design goals**

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https`
  (no axios, no fetch polyfill) and a **hand-rolled, dependency-free RSS parser**
  (no `fast-xml-parser`, no `rss-parser`, no `xmldom`).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Strongly typed** — a typed `Warning` shape over each RSS item, with the HTML
  `<description>` parsed into first-class fields (reason, manufacturer, affected
  states, …) plus a generic `fields` label→value map and the raw markup.
- **Well tested** — unit tests on Node's built-in test runner (`node --test`),
  every HTTP response mocked. The RSS parser has its own edge-case suite.

## The one thing to know: the API choice (RSS, not the old JSON API)

There used to be a JSON API for lebensmittelwarnung.de documented under the
[bundesAPI / bund.dev](https://github.com/bundesAPI) project and served via
`megov.bayern.de`. **That API is defunct.** Since the portal relaunch it responds
`HTTP 200` with `Content-Length: 0` — an empty body — and the bundesAPI repo carries
open "API down" issues. The old "public API key" note in the workspace `apis.md` is
**stale**: there is no working keyed JSON endpoint.

This client therefore wraps the portal's **official RSS 2.0 feeds** instead — the
same feeds the site offers on its
[RSS-Feed page](https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/rssnewsfeed_node.html).
**No API key exists or is needed.** The single feed path is:

```
/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/rssnewsfeed_Alle_DE.xml
```

with two optional, combinable query parameters, both applied server-side:

- `state=` — one of sixteen Bundesland slugs (see `enums.ts` / `lebensmittel states`);
- `type=` — one of five product-type slugs (`lebensmittel`, `kosmetischemittel`,
  `bedarfsgegenstaende`, `mittelzumtaetowieren`, `babyundkinderprodukte`).

If a response ever comes back as the website's **HTML shell**, or as an **empty
body** (the legacy-API failure mode), the engine detects it and throws a
`LebensmittelwarnungParseError` with a plain-language message — the empty-body case
names the defunct JSON API explicitly — rather than a cryptic parse failure.
Verified live against the endpoints on 2026-07-13.

## Build from source

```bash
npm install
npm run build        # compiles TypeScript to dist/
```

Run the locally built CLI without a global install:

```bash
node dist/src/cli/index.js --help
# or, after `npm link`:
lebensmittel --help
```

## Library usage

```ts
import {
  LebensmittelwarnungClient,
  LebensmittelwarnungParseError,
} from "@maschinenlesbar.org/lebensmittelwarnung-cli";

const client = new LebensmittelwarnungClient();

const all = await client.warnings();                       // Warning[]
console.log(all.length, all[0]?.title, all[0]?.reason);

const bavarianFood = await client.warnings({
  state: "bayern",
  type: "lebensmittel",
});

try {
  const w = bavarianFood[0];
  console.log(w?.affectedStates, w?.manufacturer);
} catch (err) {
  if (err instanceof LebensmittelwarnungParseError) console.error(err.message);
}
```

### Client options

```ts
new LebensmittelwarnungClient({
  baseUrl: "https://www.lebensmittelwarnung.de",
  timeoutMs: 15_000,
  maxRetries: 3, // 429/503; waits Retry-After (<= MAX_RETRY_AFTER_MS, 30 s; longer: no retry)
  maxResponseBytes: 100 << 20, // the default (100 MiB); set to 0 for no limit
  userAgent: "my-app/1.0",
  transport: customTransport,
});
```

### The `Warning` shape

`warnings()` returns one `Warning` per RSS `<item>`:

| Field | Source | Notes |
|---|---|---|
| `title` | `<title>` | Product name (entity-decoded). If the feed serves an unrendered template there (`$esc.escapeXml(…)`, every item since September 2026; `isUnrenderedTitle`), `product` instead, absent without one |
| `product` | "Produktbezeichnung/ -beschreibung" | Product name/description from the notice body |
| `link` | `<link>` | Detail-page URL (a reference, not scraped) |
| `pubDate` | `<pubDate>` | RFC-822 string, as served |
| `published` | derived | `pubDate` normalised to ISO-8601 (absent if unparseable) |
| `reason` | "Grund der Meldung" | Why the recall was issued |
| `manufacturer` | "Hersteller / Inverkehrbringer" | Whitespace-collapsed to one line |
| `affectedStates` | "Betroffene Bundesländer nach derzeitigem Stand" | Split into a `string[]` |
| `lotNumbers` | "Chargennummer / Los-Kennzeichnung" | |
| `bestBefore` | "Haltbarkeit" | |
| `packaging` | "Verpackungseinheit" | |
| `imageUrls` | `<img src>` | Every image in the description, in order |
| `images` | `<img src>` + "Bildquelle" | The same images as `{ url, credit? }`, each with the credit caption that follows it (`fields.Bildquelle` keeps only the last) |
| `fields` | all `<b>Label:</b> value` pairs | The complete label→value map (superset) |
| `rawDescription` | `<description>` | The original HTML, verbatim |

> **Maintenance:** the typed accessors map fixed German labels (in `client.ts`'s
> `LABEL` table). If the portal renames a label, the typed field goes empty but the
> value still appears in `fields` under the new label — revisit `LABEL` when the feed
> changes. Non-food product types were checked (2026-07-13) and use the same labels.

## The RSS parser

[`parseRss`](src/client/rss.ts) turns a feed document into `{ channel, items }`:

- it is a single forward scan that finds every terminator with `indexOf`, so parsing
  time is **linear** in the body size whatever it contains (the earlier lazy-regex
  parser was quadratic on unclosed tags: 742 KiB took 14 s, and `--timeout` covers
  only the transport, not the parse);
- channel metadata (`title`/`link`/`description`/`language`/`ttl`) is read from the
  **direct children** of the first `<channel>`, so an item's own `<title>` can never
  be mistaken for the channel's;
- each `<item>`'s leaves (`title`/`link`/`pubDate`/`guid`/`description`) are
  extracted: text is entity-decoded, **CDATA** sections are kept verbatim, and the
  result is trimmed. Comments, processing instructions and declarations are skipped;
- an **unterminated** element, comment, CDATA section, tag or attribute value throws
  (the engine reports it as `Failed to parse RSS response from <path>: <reason>`,
  exit 1), so a truncated or hostile body is an error rather than a partial feed;
  so is a feed with more than 100 000 items (a DoS guard; the live feed has a few
  hundred).

[`parseDescription`](src/client/rss.ts) then turns one item's HTML `<description>`
into `{ fields, imageUrls, images }`, again in one linear scan: it collects every `<img src>`
(a relative `src` resolved against the notice's `link`, or the feed URL) and lets each
bold label (`<b>` or `<strong>`, attributes allowed) own the text up to the next label,
dropping residual tags and HTML comments and collapsing whitespace.
[`decodeEntities`](src/client/rss.ts) handles the five predefined XML entities, the HTML 4 named references (`&auml;`, `&ndash;`,
`&euro;`, … in [`entities.ts`](src/client/entities.ts); `&nbsp;` gives U+00A0), and
numeric (`&#228;` / `&#xE4;`) refs, rejecting surrogate-range code points; an unknown
name is left as written. The engine decodes the body by the XML declaration's
`encoding` (UTF-8 without one; the Content-Type is ignored), and an encoding Node's
`TextDecoder` doesn't know is a `LebensmittelwarnungParseError`.

It is deliberately **not** a general-purpose parser (no namespaces, DTDs, or full
mixed-content reconstruction) — just enough for these shallow feeds, and exercised
hard in [`test/rss.test.ts`](test/rss.test.ts).

## Architecture

```
src/
  client/
    rss.ts       # dependency-free RSS parser + description/field extractor + entity decoder
    entities.ts  # the HTML 4 named character references
    enums.ts     # the state/type slug vocabularies + display names + guards
    types.ts     # Warning / WarningsQuery
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, RSS decode + HTML-shell/empty guard, errors
    errors.ts    # LebensmittelwarnungError / …ApiError / …NetworkError / …ValidationError / …ParseError
    client.ts    # LebensmittelwarnungClient — warnings() + field projection
  cli/
    io.ts        # injectable I/O seam (stdout/stderr/file)
    shared.ts    # option parsers (incl. the --since date parser), global-option resolver, JSON renderer
    commands/    # warnings.ts — warnings / states / types
    program.ts   # assembles the commander program from injectable deps
    run.ts       # parses argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
```

**Two seams make the whole thing testable in-process (no subprocesses):**
`Transport` (the single HTTP function; tests inject a mock returning canned RSS)
and `CliDeps` (a client factory + I/O object; `run.ts` returns an exit code
instead of calling `process.exit`).

### Redirects & base URL

`--base-url` is trusted input, but only `http:`/`https:` are accepted (a stray
`file:`/`ftp:` fails at parse time, exit `2`). **Redirects are not followed** — a
`3xx` surfaces as an error (the canonical host serves the feed directly), with a
pointed hint to check `--base-url`. Credential headers are never sent cross-host
(there are none here — the feed needs no auth).

### Error types

[`errors.ts`](src/client/errors.ts): `LebensmittelwarnungApiError` (non-2xx, carries
`status`/`detail`, with `isRetryable`/`isNotFound`), `LebensmittelwarnungNetworkError`
(transport failure/timeout), `LebensmittelwarnungParseError` (the body was not RSS —
usually the HTML shell or the empty-body legacy-API failure), and
`LebensmittelwarnungValidationError` (a client-side usage error, no request made:
an unknown `state`/`type` slug in `warnings()`, `Invalid state: expected one of …,
got "bogus".`, or an engine option outside its range, `Invalid option timeoutMs:
expected an integer from 0 to 2147483647, got NaN.` — `maxRetries` 0..`MAX_RETRIES`
(10), `retryDelayMs` 0..`MAX_RETRY_AFTER_MS`, `maxResponseBytes` 0..2^53−1), all
extending `LebensmittelwarnungError`.

## Testing

```bash
npm test          # builds, then runs `node --test` over dist/test
```

- **`rss.test.ts`** — the RSS parser: channel-vs-item isolation, CDATA verbatim,
  entity decoding, the label→value extraction, image collection, edge cases.
- **`query.test.ts`** — query-string serialisation (state/type).
- **`http.test.ts`** — the default transport against a real loopback server.
- **`engine.test.ts`** — RSS decoding, the HTML-shell + empty-body guards, `429`/`503`
  retry, the 3xx-is-an-error rule, error mapping — mocked transport.
- **`client.test.ts`** — the field projection, `affectedStates` split, ISO date
  derivation, and the `state`/`type` query parameters — mocked transport.
- **`cli.test.ts`** — command parsing, the `--state`/`--type` choice validation, the
  `--limit`/`--since`/`--search` filters, `--output`, and exit codes — mocked client.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test,
  `npm pack`, and create a GitHub Release with the tarball + CycloneDX SBOMs.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted
  Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build the project website (`site/`, English and German) with the TypeDoc API docs
  under `/api/`, and deploy both to GitHub Pages on each `v*` tag.
  TypeDoc runs from the isolated, lockfile-pinned `tools/docs/` toolchain because it
  needs the TypeScript 6 compiler API, which TypeScript 7 no longer ships; locally,
  run `npm ci --prefix tools/docs` once before `npm run docs`.

## Website

The project website — <https://maschinenlesbar-org.github.io/lebensmittelwarnung-cli/> in
English and <https://maschinenlesbar-org.github.io/lebensmittelwarnung-cli/de/> in German — is
built from `site/` with [Jekyll](https://jekyllrb.com/),
[banira](https://sebs.github.io/banira/) web components and [Fylgja](https://fylgja.dev/) CSS,
and deployed by `docs.yml` together with the TypeDoc API reference under `/api/`. Its content
comes from this repository: the README intro and quick start, the command tree of the built CLI
(`site/scripts/cli-reference.mjs`), `Usage.md`, `GLOSSARY.md` and its German version
`GLOSSARY.de.md`, the skills, and the skill examples in `EXAMPLE.md` and `EXAMPLE.de.md`. The
only repo-specific files are `site/_config.yml` and `site/_data/project.yml` (the German intro
and the access requirements); the rest of `site/` is identical in every maschinenlesbar.org
CLI, so change it in all of them together. When the README intro changes, update the German
intro in `site/_data/project.yml`.

```bash
npm run build                        # the CLI, for the command reference
cd site && npm ci && bundle install  # once (Node >= 22.12, Ruby 3.4, Bundler)
npm run serve                        # http://127.0.0.1:4000/lebensmittelwarnung-cli/
```

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license —
see **[LICENSING.md](LICENSING.md)**. This project does **not** accept external
code contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
