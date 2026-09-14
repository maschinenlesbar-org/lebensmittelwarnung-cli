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
  maxRetries: 3,
  maxResponseBytes: 100 << 20, // the default (100 MiB); set to 0 for no limit
  userAgent: "my-app/1.0",
  transport: customTransport,
});
```

### The `Warning` shape

`warnings()` returns one `Warning` per RSS `<item>`:

| Field | Source | Notes |
|---|---|---|
| `title` | `<title>` | Product name (entity-decoded) |
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
| `fields` | all `<b>Label:</b> value` pairs | The complete label→value map (superset) |
| `rawDescription` | `<description>` | The original HTML, verbatim |

> **Maintenance:** the typed accessors map fixed German labels (in `client.ts`'s
> `LABEL` table). If the portal renames a label, the typed field goes empty but the
> value still appears in `fields` under the new label — revisit `LABEL` when the feed
> changes. Non-food product types were checked (2026-07-13) and use the same labels.

## The RSS parser

[`parseRss`](src/client/rss.ts) turns a feed document into `{ channel, items }`:

- channel metadata (`title`/`link`/`description`/`language`/`ttl`) is read from the
  channel scope **with its `<item>` blocks removed**, so an item's own `<title>` can
  never be mistaken for the channel's;
- each `<item>`'s leaves (`title`/`link`/`pubDate`/`guid`/`description`) are
  extracted; a **CDATA** description body is kept verbatim, plain text is
  entity-decoded and trimmed.

[`parseDescription`](src/client/rss.ts) then turns one item's HTML `<description>`
into `{ fields, imageUrls }`: it collects every `<img src>` and splits the markup on
`<b>…</b>` boundaries so each bold label owns the text up to the next label, stripping
residual tags and collapsing whitespace. [`decodeEntities`](src/client/rss.ts) handles
the five predefined XML entities, `&nbsp;`, and numeric (`&#228;` / `&#xE4;`) refs,
rejecting surrogate-range code points.

It is deliberately **not** a general-purpose parser (no namespaces, DTDs, or full
mixed-content reconstruction) — just enough for these shallow feeds, and exercised
hard in [`test/rss.test.ts`](test/rss.test.ts).

## Architecture

```
src/
  client/
    rss.ts       # dependency-free RSS parser + description/field extractor + entity decoder
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
`LebensmittelwarnungValidationError` (a client-side usage error), all extending
`LebensmittelwarnungError`.

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
- **docs.yml** — build TypeDoc API docs and deploy to GitHub Pages on each `v*` tag.
  TypeDoc runs from the isolated, lockfile-pinned `tools/docs/` toolchain because it
  needs the TypeScript 6 compiler API, which TypeScript 7 no longer ships; locally,
  run `npm ci --prefix tools/docs` once before `npm run docs`.

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license —
see **[LICENSING.md](LICENSING.md)**. This project does **not** accept external
code contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
