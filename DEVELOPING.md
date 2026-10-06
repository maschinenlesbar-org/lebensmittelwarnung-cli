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

try {
  const all = await client.warnings();                     // Warning[]
  console.log(all.length, all[0]?.title, all[0]?.reason);

  const bavarianFood = await client.warnings({
    state: "bayern",
    type: "lebensmittel",
  });
  const w = bavarianFood[0];
  console.log(w?.affectedStates, w?.manufacturer);

  // Client-side narrowing, the same as the CLI's --since / --search / --limit.
  const recent = await client.warnings({ since: "2026-09-01", search: "bio", limit: 5 });
} catch (err) {
  // warnings() rejects: the feed returned the HTML shell or an empty body.
  if (err instanceof LebensmittelwarnungParseError) console.error(err.message);
  else throw err;
}
```

### Narrowing: `state`, `type`, `since`, `search`, `limit`

`warnings(query)` takes the server-side filters `state` and `type` (one slug each, see
`STATE_SLUGS` / `TYPE_SLUGS`) and three client-side ones, applied after the fetch in
this order — the CLI's `--since`, `--search` and `--limit` call exactly this:

- `since` (`YYYY-MM-DD`) keeps warnings whose `published` day **in German time**
  (Europe/Berlin, `berlinDay`) is that day or later, and drops a warning without a
  readable `pubDate` (the CLI says on stderr how many it left out). `parsePubDate` reads
  `pubDate` strictly: RFC 822 as the feed serves it (English or German month and zone
  names, `CEST`/`MESZ`, a numeric zone), ISO 8601 and `DD.MM.YYYY HH:MM`, a stamp without
  a zone as German time; anything else is not guessed (`Date.parse` read
  `02.10.2026` as 10 February and a zone-less stamp in the host's time zone). A notice stamped `00:00:00 +0200` counts for its own day, although
  the UTC date part of `published` is the day before — comparing UTC days would miss it;
- `search` keeps warnings whose `title` or `product` contains the needle, compared in
  two folded forms (`searchForms`): lower-cased, NFC, whitespace collapsed, `ß` → `ss`,
  and then umlauts transliterated (`ä` → `ae`) or all diacritics dropped (`ä` → `a`). So
  `kaese`, `KÄSE`, a decomposed `käse` and `Kase` find "Käse", `Erdnuss` finds
  "Erdnüsse". It stays a substring match (`Tahini` doesn't find "Tahina");
- `limit` keeps the first `n` (1..`MAX_WARNINGS_LIMIT`, 100 000), in feed order.

Every option is checked before the request: an unknown slug, an impossible date
(`calendarDateProblem`: `2026-02-30`), a blank `search` (`nonBlankProblem`) or a
`limit` outside its range (`limitProblem`) rejects with a
`LebensmittelwarnungValidationError` (`Invalid since: Not a valid calendar date.`).
`filterWarnings(list, { since, search, limit })` applies the same narrowing to a list
you already have. A key these objects don't have (`States`, `serach`, a `__proto__` key
from `JSON.parse`) is a `LebensmittelwarnungValidationError` too (`Invalid query: Unknown
key "States"; expected one of state, type, since, search, limit.`) — it used to be
ignored, and the whole unfiltered feed came back; so is an unknown client option
(`timeout` for `timeoutMs`; the known ones are `ENGINE_OPTION_KEYS`).
`test/conformance-p10-strict-filters.test.ts` checks unknown keys, unknown slugs, arrays
and NaN, and repeated `--state`/`--limit` flags.

### Client options

```ts
new LebensmittelwarnungClient({
  baseUrl: "https://www.lebensmittelwarnung.de",
  timeoutMs: 15_000,
  maxRetries: 3, // 429/503 and resets; linear backoff, or a longer Retry-After (<= 30 s; longer: no retry)
  maxResponseBytes: 100 << 20, // the default (100 MiB); set to 0 for no limit
  userAgent: "my-app/1.0",
  transport: customTransport,
});
```

**Custom transports.** `timeoutMs` and `maxResponseBytes` hold for every transport, not
only the built-in one: the engine races the call against its own deadline and passes an
`AbortSignal` in `HttpRequest.signal` (hand it to `fetch(url, { signal })`), and it checks
the size of the body it gets back. A transport may return its headers as a fetch `Headers`
object, a `Map` or a record with names in any case (`Retry-After` is read from all of
them), and its body as a `Buffer`, any ArrayBuffer view (fetch's `Uint8Array`) or an
`ArrayBuffer`, from any realm. A reset connection (`ECONNRESET`, `EPIPE`, `ECONNABORTED`,
undici's `UND_ERR_SOCKET`, anywhere in the `cause` chain) is retried like a 503; whatever a
transport throws or returns that isn't a response becomes a
`LebensmittelwarnungNetworkError`. `test/conformance-p5-transport-contract.test.ts` checks
this with a never-answering transport, `fetch` against a silent server, a 2 MiB body and
every body and header shape.

**Retries never burst.** The linear backoff (`retryDelayMs * attempt`, 200 ms by default)
is the floor: a `Retry-After` can make a wait longer, never shorter, so `Retry-After: 0`
or a date in the past no longer sends the retries back to back. A `Retry-After` above
`MAX_RETRY_AFTER_MS` (30 s) is not retried; the `LebensmittelwarnungApiError` says so,
names the requested wait and carries it as `retryAfterMs`.
`test/conformance-p6-retry-policy.test.ts` checks both.

`userAgent` and every `defaultHeaders` value are checked in the constructor with the
same rule as the CLI's `--user-agent` (`headerValueProblem`, also exported as
`assertHeaderValue(name, value)`): a blank value, a control character other than tab
(CR/LF would inject a header), DEL or a character above U+00FF throws a
`LebensmittelwarnungValidationError` before any request. Only an omitted `userAgent`
selects the default `lebensmittelwarnung-cli`. `defaultHeaders` names must be HTTP
tokens.

### The `Warning` shape

`warnings()` returns one `Warning` per RSS `<item>`:

| Field | Source | Notes |
|---|---|---|
| `title` | `<title>` | Product name (entity-decoded). If the feed serves an unrendered template there (`$esc.escapeXml(…)`, every item in September 2026; `isUnrenderedTitle`), `product` instead, absent without one |
| `product` | "Produktbezeichnung/ -beschreibung" | Product name/description from the notice body |
| `link` | `<link>` | Detail-page URL (a reference, not scraped) |
| `pubDate` | `<pubDate>` | RFC-822 string, as served |
| `published` | derived | `pubDate` as ISO-8601 in UTC, read strictly by `parsePubDate` (absent if it isn't a known form) |
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
> `REQUIRED_LABELS` (product, reason, manufacturer, affected states — on every live item,
> 255 of 255 on 2026-10-06) and `missingLabels(warnings)` detect such a rename: the
> `warnings` command fetches the feed with only the server-side filters, checks it, prints
> one `warning:` line on stderr when a required label is missing from every
> item, and then narrows with `filterWarnings` (the same order `client.warnings()` uses).

## The RSS parser

[`parseRss`](src/client/rss.ts) turns a feed document into `{ channel, items }`:

- it is a single forward scan that finds every terminator with `indexOf`, so parsing
  time is **linear** in the body size whatever it contains (the earlier lazy-regex
  parser was quadratic on unclosed tags: 742 KiB took 14 s, and `--timeout` covers
  only the transport, not the parse);
- the document must have the documented RSS 2.0 shape: its document element is
  `<rss>` and the `<channel>` a direct child of it. Anything else — an XML error
  envelope, an Atom feed, a JSON body, a channel wrapped in another element — is a parse
  error (exit 1), never an empty list of warnings;
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
dropping residual tags and HTML comments and collapsing whitespace. A bold run is a
label only at the start of a line (the start, or after a `<br>`, a block tag or an
image — where every label of the live feed sits); bold text inside a value
(`L-1111 <b>sowie</b> L-2222`) is emphasis and stays in the value. A label the notice
repeats (a notice for two products gives a name and a lot number per product) keeps
every distinct value, joined with `"; "` (`REPEATED_LABEL_SEPARATOR`), in `fields` and
in the typed field; `affectedStates` is split on `,` and `;`.
[`decodeEntities`](src/client/rss.ts) handles the five predefined XML entities, the HTML 4 named references (`&auml;`, `&ndash;`,
`&euro;`, … in [`entities.ts`](src/client/entities.ts); `&nbsp;` gives U+00A0), and
numeric (`&#228;` / `&#xE4;`) refs, rejecting surrogate-range code points; an unknown
name is left as written. The engine decodes the body by the encoding it is declared
in, in RFC 7303's order: a byte-order mark (UTF-8, UTF-16), then the Content-Type's
`charset`, then the XML declaration's `encoding`, else UTF-8. An encoding Node's
`TextDecoder` doesn't know is a `LebensmittelwarnungParseError`; bytes invalid in the
declared encoding become U+FFFD.

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
    dates.ts     # berlinDay: the calendar day of a timestamp in German time
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, RSS decode + HTML-shell/empty guard, errors
    errors.ts    # LebensmittelwarnungError / …ApiError / …NetworkError / …ValidationError / …ParseError
    validate.ts  # the Problem type + assertValid: input rules shared by library and CLI
    client.ts    # LebensmittelwarnungClient — warnings() + field projection
  cli/
    io.ts        # injectable I/O seam (stdout/stderr/file)
    shared.ts    # option parsers (thin wrappers over the library's rules), global-option resolver, JSON renderer
    commands/    # warnings.ts — warnings / states / types
    program.ts   # assembles the commander program from injectable deps
    run.ts       # parses argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
```

**Closed pipes.** The bin shim installs `handleOutputErrors()` (`io.ts`) before `run()`:
an EPIPE on stdout (`| head`, a `jq` that exits early) exits 0 quietly; an EPIPE on
stderr is ignored, so a failed run keeps its own exit code (`2>&1 | true` used to turn a
usage error into 0); any other output error exits 1.
`test/conformance-p7-pipes-exit-codes.test.ts` runs the built bin for both.

**Two seams make the whole thing testable in-process (no subprocesses):**
`Transport` (the single HTTP function; tests inject a mock returning canned RSS)
and `CliDeps` (a client factory + I/O object; `run.ts` returns an exit code
instead of calling `process.exit`).

### Redirects & base URL

`--base-url` is trusted input, but only `http:`/`https:` are accepted (a stray
`file:`/`ftp:` fails at parse time, exit `2`). The rule is the library's: the
`RequestEngine` constructor checks the raw `baseUrl` with the exported
`validateBaseUrl` (rule: `baseUrlProblem`, which the CLI's `--base-url` parser calls
too). A blank value, surrounding whitespace or a control character (`new URL()` would
drop them silently, and a trailing space ended up in the request path), an unparseable
URL, a scheme other than `http:`/`https:`, a query or fragment (request paths are
appended to the base URL as a string), and a `%` in the userinfo that isn't an escape
(Node would fail to decode it for the Authorization header; write `%25`) each throw a
`LebensmittelwarnungValidationError` (`Invalid baseUrl: <reason>`) before any request —
a configuration error, not a `LebensmittelwarnungNetworkError`. Only an omitted
`baseUrl` selects the default. **Redirects are not followed** — a
`3xx` surfaces as an error (the canonical host serves the feed directly), with a
pointed hint to check `--base-url`. Credential headers are never sent cross-host
(there are none here — the feed needs no auth).

A `user:password@` in the base URL (a mirror behind a login) never reaches the CLI's
output. `credentialsIn(value)` finds the exact userinfo of a URL-like value, parseable
or not, with a prefix (`--base-url=…`) or without a scheme (`user:pw@host`), and
`redactCredentials(text, list)` replaces each `secret@` with `***@`; `redactUrl` falls
back to them for a value that doesn't parse. `run()` starts with
`withRedactedOutput(deps, argv)`, which collects the credentials of every argument (and
of the value part of `--opt=value`) and redacts every line printed on stdout and stderr
— commander's usage errors echo rejected values (`argument '…' is invalid`, `unknown
command '…'`, `too many arguments … got 1: …`). `test/conformance-p1-cli-redaction.test.ts`
checks ten passwords in seven URL shapes at nine argv positions.

The library keeps them out of what a caller logs, too. The engine holds the base URL in
a real `#private` field (so `console.log(client)`, `util.inspect` and `JSON.stringify`
never show it) next to its userinfo, raw and percent-decoded, and scrubs that from
error bodies (`LebensmittelwarnungApiError.body`/`detail`), transport error text and the
`cause` chain. `LebensmittelwarnungApiError.url` is the request URL with its userinfo
redacted. Whatever a custom transport throws (a string, fetch's `TypeError` naming the
URL) reaches the caller as a `LebensmittelwarnungNetworkError` with the original,
scrubbed, as its `cause`. Relative image URLs of an item without a `<link>` are resolved
against the feed URL without its userinfo. `test/conformance-p2-library-redaction.test.ts`
checks the client, nine failing transports and five rejected base URLs.

### Error types

[`errors.ts`](src/client/errors.ts): `LebensmittelwarnungApiError` (non-2xx, carries
`status`/`detail`, with `isRetryable`/`isNotFound`), `LebensmittelwarnungNetworkError`
(transport failure/timeout, and the default transport's per-hop scheme check; a bad
configured `baseUrl` is a `LebensmittelwarnungValidationError` instead), `LebensmittelwarnungParseError` (the body was not RSS —
usually the HTML shell or the empty-body legacy-API failure), and
`LebensmittelwarnungValidationError` (a rejected input, thrown before any request:
an unknown `state`/`type` slug in `warnings()`, `Invalid state: expected one of …,
got "bogus".`, a bad `since`/`search`/`limit`, `Invalid limit: Must be >= 1.`, a bad
`baseUrl`, `userAgent` or `defaultHeaders` value, or an engine option outside its range, `Invalid option timeoutMs:
expected an integer from 0 to 2147483647, got NaN.` — `maxRetries` 0..`MAX_RETRIES`
(10), `retryDelayMs` 0..`MAX_RETRY_AFTER_MS`, `maxResponseBytes` 0..2^53−1), all
extending `LebensmittelwarnungError`. A wrong-typed input is that validation error too,
never a raw `TypeError`: a non-object query (`warnings("bayern")`, `warnings(null)`), a
non-array list for `filterWarnings`, a `transport` or `sleep` that isn't a function.
Echoed values and server text are cut at 500 characters in messages
(`cutForMessage`); the error's properties keep the full value.
`test/conformance-p8-p9-p13-responses-and-errors.test.ts` checks the declared charset
(P8), the RSS shape (P9) and twenty wrong-typed calls (P13).

### Input validation

The library owns every rule about what a request may contain; the CLI calls the same
functions instead of keeping its own copy. A rule is a pure, exported `Problem`
([`validate.ts`](src/client/validate.ts)): it returns the reason a value is invalid, or
`undefined`. The library enforces it with `assertValid(name, value, problem)`, which
throws `LebensmittelwarnungValidationError` with the message `Invalid <name>: <reason>`
before any request (a constructor throws; a method returning a promise rejects). The
CLI's commander parsers turn the same reason into a usage error (exit 2), and `run.ts`
maps a `LebensmittelwarnungValidationError` raised during an action to exit 2 too,
printed as `Error: <message>`.

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
  derivation, the `state`/`type` query parameters, and the `since`/`search`/`limit`
  narrowing (`filterWarnings`, `berlinDay`) — mocked transport.
- **`cli.test.ts`** — command parsing, the `--state`/`--type` choice validation, the
  `--limit`/`--since`/`--search` options, `--output`, and exit codes — mocked client.
- **`parity.test.ts`** — the same input through `run()` and through the library (via
  `parity()`) gives the same outcome.
- **`validate.test.ts`** — `assertValid`, the `run.ts` mapping of
  `LebensmittelwarnungValidationError`, and the `parity()` helper (`test/helpers.ts`),
  which sends one input through `run()` and through the library on one recording mock
  transport so a test can assert both give the same outcome.
- **`conformance-*.test.ts`** — the checks shared by every maschinenlesbar.org CLI (fix
  plan of 2026-10-06), each copied from the reference with only its adapter block
  changed: `p1` no base-URL password in any output line; `p2` none in a logged client or
  error; `p4-p19` base-URL rules (P19 skipped: no environment variable); `p5` the
  transport contract (deadline, size cap, header and body shapes, resets); `p6` the retry
  floor and the above-cap message; `p7` closed pipes and exit codes (runs the built bin);
  `p8-p9-p13` charset, RSS shape and wrong-typed input; `p10` unknown keys, slugs, value
  types and repeated flags. The follow-up round of 2026-10-06 added `p20`: a remote plain
  `http:` base URL gets one `warning:` line on stderr from the library's
  `cleartextProblem`, printed by `action()` in `shared.ts` right before the client is built
  (no base-URL variable and no secret here, so those two cases are skipped), and `p21`:
  every relative link in `README.md` points to a file `package.json` `files` ships, since
  npmjs.com shows the README; other documents are linked by their GitHub URL.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 22/24 for every push and PR.
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
