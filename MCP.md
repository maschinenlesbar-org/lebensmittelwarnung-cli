# lebensmittel-mcp

An [MCP](https://modelcontextprotocol.io/) server for [lebensmittelwarnung.de](https://www.lebensmittelwarnung.de),
the official German portal of product warnings and recalls (Rückrufe) of the 16 Länder and the
Bundesamt für Verbraucherschutz und Lebensmittelsicherheit (BVL): food, cosmetics, consumer goods,
tattoo inks and baby products, as tools for AI agents. Read-only, no API key. The notices are
copyright-protected: every recall comes with the citation the portal prescribes (see Licence).

It is the MCP side of [lebensmittelwarnung-cli](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli),
built on the same typed client, and released with it.

## Install

```bash
npm i -g @maschinenlesbar.org/lebensmittelwarnung-mcp
```

This installs the **`lebensmittel-mcp`** command (Node.js 22.12+). Or run the container
image, for linux/amd64 and linux/arm64, which needs no Node.js:

```bash
docker run -i --rm ghcr.io/maschinenlesbar-org/lebensmittelwarnung-mcp:latest
```

## Connect a client

The server speaks MCP on stdio by default.

**Claude Code**

```bash
claude mcp add lebensmittel -- lebensmittel-mcp
# or with the image:
claude mcp add lebensmittel -- docker run -i --rm ghcr.io/maschinenlesbar-org/lebensmittelwarnung-mcp:latest
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{ "mcpServers": { "lebensmittel": { "command": "lebensmittel-mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "lebensmittel": { "type": "stdio", "command": "lebensmittel-mcp" } } }
```

**Over HTTP** (Streamable HTTP, one endpoint `POST /mcp`):

```bash
lebensmittel-mcp --transport http            # http://127.0.0.1:3000/mcp
claude mcp add --transport http lebensmittel http://127.0.0.1:3000/mcp
```

In a container, publish the port on loopback only:
`docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/maschinenlesbar-org/lebensmittelwarnung-mcp:latest --transport http --host 0.0.0.0 --allowed-hosts localhost,127.0.0.1`.

For scripts and shared configs, pin a release and its digest from the
[release notes](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli/releases) instead of
`latest`: `…/lebensmittelwarnung-mcp:<version>@sha256:<digest>`. Check an image's provenance with
`gh attestation verify oci://ghcr.io/maschinenlesbar-org/lebensmittelwarnung-mcp:<version> --repo maschinenlesbar-org/lebensmittelwarnung-cli`.

## Tools

| Tool | What it answers |
|---|---|
| `searchRecalls` | Is there a recall for a product? The product names first, then every other field and the notice's URL; names the terms searched (a single word's stem added) when nothing matches. |
| `listRecalls` | The listed recalls, newest first, by Land (where sold), issuing Land, product type, reason category (a pathogen or allergen word mapped to its category) and date, a page at a time. |
| `countRecalls` | Counts per reason, product type, Land, issuer or year, with why the groups add up to more than the total. |
| `getRecall` | One notice in full by its id (compared without case, percent-encoding and slashes) or its URL: every field and the product images with their credits. An id no notice has is answered as such, not as withdrawn. |

Each recall has its batch (`lotNumbers`), best-before (`bestBefore`, and whether its latest date
has passed), the German day of its last update and the day the notice was issued (`updated`
marks an old notice updated since), the issuing Land, the link to the official notice and its
`citation`.

Every tool only reads. An answer is JSON (`structuredContent` and the same as text), with the
`source` it came from (whole, never cut like the data) and the data licence. A text over 2000
characters is cut and ends in `…[cut, N characters in all]`, and the answer says `truncated`. An
answer over `--max-result-chars` first loses entries from the end of its page (then `nextOffset`
says where to go on), then has its longest texts cut further (each with that mark) or, when that
isn't enough, its other lists shortened (`reason` names them); a list keeps its first entry, `notes`
stay whole, and the answer says `truncated`. One that can't be cut down so far is a tool error that
says to ask for less. A failure is a tool error that says what to change (one over 5000 characters
loses its middle, never its end, where the reason is).

## Options

```
--transport <stdio|http>   stdio (default), or Streamable HTTP on POST /mcp
--host <address>           HTTP: the address to listen on (default 127.0.0.1)
--port <n>                 HTTP: the port (default 3000)
--allowed-hosts <list>     HTTP: Host header names to answer (default localhost,127.0.0.1,[::1])
--allowed-origins <list>   HTTP: browser origins allowed to call, exactly (https://app.example.org); none by default
--auth-token-file <path>   HTTP: a file with the bearer token every request must send (mode 600, 32+ characters)
--base-url <url>           API base URL (default https://www.lebensmittelwarnung.de)
--timeout <ms>             per upstream request (default 30000)
--call-timeout <ms>        per tool call, retries included (default 45000)
--max-result-chars <n>     cap on one tool result's JSON (default 25000)
--max-pages <n>            pages a tool reads per list and call (default 10)
--user-agent <ua>          User-Agent header value (Latin-1, one line)
--log-format <text|jsonl>  the log records on stderr (default text)
```

## What it does and doesn't do

- **Read-only.** No tool changes anything, here or upstream.
- **No authentication** on HTTP unless you give one. It listens on loopback by default; it checks
  the `Host` header and, from a browser, the `Origin` (only the origins given with
  `--allowed-origins`, matched exactly) against DNS rebinding and other web pages; a page on one of
  those origins gets CORS (its preflight answered, the answers readable). With `--auth-token-file
  <path>` every request must send `Authorization: Bearer <token>` (the file holds one token of at
  least 32 characters, mode 600, owned by the user the server runs as, a regular file (a FIFO is
  refused at once, never waited on); read once at start; `(umask 077; openssl rand -hex 32 >
  mcp-token)` makes one); anything else is answered 401. Exposed beyond localhost (it logs a warning
  then), it belongs behind a proxy that authenticates or at least terminates TLS.
- **Gentle with the upstream.** One server process sends at most 2 requests at a time and 120 a
  minute to the API, pauses the requests to a host that answers HTTP 429 (as long as its Retry-After
  asks, at most 30 s; those to another host go on), and stops a tool call after its deadline (a tool
  that has read part of its answer by then may answer with that part, and says so). A request those
  limits would hold longer than it or its call may wait is not sent: the call fails at once, naming
  the limit and when to ask again (and the log says so).
- **Results are data.** Text from the API, keys included, is cleaned (control, bidi, zero-width, tag
  and other invisible characters removed, but an emoji keeps its joiners; a key that cleaning makes
  equal to another stays, as `name~2`), but it is still other people's text: a model can be told
  things in it. The server can't act on that (it has no tool that writes), but other tools in the
  same session could.
- **Stops cleanly.** On `docker stop` (SIGTERM) or Ctrl-C the HTTP server takes no new connection
  and lets calls in flight answer for up to 5 s, then exits 143 (130); a second signal ends it at
  once. On stdio a signal ends it at once; when stdin ends, it first answers the requests it has
  read (each within its call deadline), then exits.
- **In a container** it needs at least 12 processes and threads (`--pids-limit`) and about
  256 MB of memory.
- **Logs** go to stderr, one record per line; stdout carries only the protocol. A call that fails
  upstream or reaches its deadline leaves a WARN record naming the tool.
- **Never installs anything.**

## Licence

Code: AGPL-3.0-or-later or commercial
([LICENSING.md](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli/blob/main/LICENSING.md)).
Data: the content of lebensmittelwarnung.de is copyright-protected, with no open licence. A
notice may be passed on only unaltered and complete, with the prescribed citation ("Portal
www.lebensmittelwarnung.de, Jahr: Titel, URL, Stand: Datum. Diese Informationen sind über das
Portal „lebensmittelwarnung.de“ … kostenfrei abrufbar."), never mixed with other sources; the
product images are not free to reuse; a notice removed from the portal must be deleted wherever
it was reused; anything beyond that needs the BVL's written permission
([terms](https://www.lebensmittelwarnung.de/DE/Service/Impressum/impressum_node.html),
[DATA_LICENSE.md](https://github.com/maschinenlesbar-org/lebensmittelwarnung-cli/blob/main/DATA_LICENSE.md)).
Every result carries this note in its `licence` field, and each recall its `citation`. We
provide the tool, not the data: running the server as a service for others may need the
provider's permission.
