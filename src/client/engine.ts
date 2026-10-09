// The request engine: turns logical (path, query) calls into HTTP GET requests via
// a Transport, applies retry/backoff for transient statuses (429, 503), and decodes
// RSS responses. The lebensmittelwarnung.de "API" is the portal's official RSS 2.0
// product-warning feed: unauthenticated GETs against www.lebensmittelwarnung.de,
// optionally narrowed with `state=` / `type=` query parameters.
//
// NOTE: the legacy JSON API (megov.bayern.de / the bundesAPI spec) is DEFUNCT — it
// has returned HTTP 200 with an empty body since the portal relaunch. This engine
// wraps the RSS feeds instead. No API key exists or is needed.

import { TextDecoder } from "node:util";
import {
  MAX_TIMEOUT_MS,
  nodeHttpTransport,
  sizeLimitMessage,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import { parseRss, type RssFeed } from "./rss.js";
import {
  LebensmittelwarnungApiError,
  LebensmittelwarnungError,
  LebensmittelwarnungNetworkError,
  LebensmittelwarnungParseError,
  LebensmittelwarnungValidationError,
  credentialsIn,
  cutForMessage,
  cutText,
  redactCredentials,
} from "./errors.js";
import { assertValid, baseUrlProblem, headerNameProblem, headerValueProblem, knownKeysProblem } from "./validate.js";

/** The keys {@link EngineOptions} has; any other key is a LebensmittelwarnungValidationError. */
export const ENGINE_OPTION_KEYS = [
  "baseUrl",
  "transport",
  "userAgent",
  "defaultHeaders",
  "timeoutMs",
  "maxRetries",
  "retryDelayMs",
  "maxResponseBytes",
  "sleep",
] as const;

export const DEFAULT_BASE_URL = "https://www.lebensmittelwarnung.de";
const DEFAULT_USER_AGENT = "lebensmittelwarnung-cli";

export interface RawResponse {
  data: Buffer;
  contentType: string;
  status: number;
}

/**
 * Options for {@link RequestEngine} and the client. The numeric options must be
 * integers within their documented range; anything else (negative, fractional,
 * NaN, Infinity, too large) makes the constructor throw a
 * LebensmittelwarnungValidationError.
 */
export interface EngineOptions {
  /**
   * Base URL of the API. Defaults to https://www.lebensmittelwarnung.de. A value
   * that breaks a rule of {@link validateBaseUrl} (blank, unparseable, not http(s),
   * a query or fragment) throws a LebensmittelwarnungValidationError.
   */
  baseUrl?: string;
  /**
   * Swappable transport. Defaults to the built-in node http/https transport. The engine
   * enforces `timeoutMs` and `maxResponseBytes` for any transport, reads its headers in any
   * case (a fetch `Headers` or a `Map` too) and its body as any ArrayBuffer view, and turns
   * whatever it throws into a `LebensmittelwarnungNetworkError`.
   */
  transport?: Transport;
  /**
   * Value of the User-Agent header (default `lebensmittelwarnung-cli`). A blank
   * value, a control character other than tab, or a character above U+00FF throws
   * a LebensmittelwarnungValidationError.
   */
  userAgent?: string;
  /**
   * Extra headers sent on every request; names and values are checked like `userAgent`.
   * `Accept` and `User-Agent` are the engine's own in any case: the request headers are
   * `{ ...defaultHeaders, Accept, "User-Agent" }`, so a `user-agent`/`accept` here reaches
   * the transport next to the engine's key, which comes last and is the one the built-in
   * transport sends. Use `userAgent` to set the User-Agent; `Accept` is fixed.
   */
  defaultHeaders?: Record<string, string>;
  /**
   * Time limit per request in milliseconds, covering the whole response body, not
   * only idle gaps (0 disables; at most MAX_TIMEOUT_MS, 2^31 - 1 ms). Enforced by the
   * engine for every transport: the request's `signal` aborts at the deadline and the
   * call rejects with a LebensmittelwarnungNetworkError.
   */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses and reset connections
   * (`ECONNRESET`, `EPIPE`, `ECONNABORTED`, undici's `UND_ERR_SOCKET`), 0..`MAX_RETRIES`
   * (10). A refused connection, a DNS failure and a timeout are not retried. Each retry
   * waits `retryDelayMs * attempt`, or the response's `Retry-After` when that is longer (up
   * to `MAX_RETRY_AFTER_MS`; a longer one is not retried, and the error names the requested
   * wait).
   */
  maxRetries?: number;
  /**
   * Base backoff between retries in milliseconds (grows linearly; default 200). A
   * `Retry-After` can make a wait longer, never shorter. At most `MAX_RETRY_AFTER_MS`.
   */
  retryDelayMs?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit;
   * at most `Number.MAX_SAFE_INTEGER`. The default transport aborts early; for any
   * transport the engine checks the body it gets back.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

/**
 * Longest `Retry-After` the engine waits out before retrying a 429/503. When the
 * server asks for longer, the engine does not retry at all and surfaces the error at
 * once: retrying early would only land inside the window the server asked us to wait
 * out, and a hostile value must not stall the CLI.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

/** Most automatic retries a caller may ask for (the CLI's --max-retries shares it). */
export const MAX_RETRIES = 10;

/**
 * Read a numeric engine option: `undefined` gives the default; anything but an
 * integer in [0, max] throws. Without this a negative or NaN `timeoutMs` silently
 * disabled the timeout, `maxRetries: Infinity` retried forever and
 * `maxResponseBytes: -1` switched the size cap off.
 */
function intOption(name: string, value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new LebensmittelwarnungValidationError(
      // A string is quoted, so `"5000"` doesn't read like the number 5000.
      `Invalid option ${name}: expected an integer from 0 to ${max}, got ` +
        `${cutForMessage(typeof value === "string" ? JSON.stringify(value) : String(value))}.`,
    );
  }
  return value;
}

/**
 * Read a function option: `undefined` gives the default; anything else that is not a
 * function throws a LebensmittelwarnungValidationError. A string `transport` used to fail
 * only at the first request, and a bad `sleep` as a raw TypeError on the first retry.
 */
function functionOption<F extends (...args: never[]) => unknown>(name: string, value: F | undefined, fallback: F): F {
  if (value === undefined) return fallback;
  if (typeof value !== "function") {
    throw new LebensmittelwarnungValidationError(
      `Invalid option ${name}: expected a function, got ${value === null ? "null" : typeof value}.`,
    );
  }
  return value;
}

/**
 * Check a value bound for an HTTP header (see {@link headerValueProblem}) and
 * return it unchanged; anything else throws a LebensmittelwarnungValidationError
 * naming `name` ("Invalid userAgent: Value contains control characters.").
 */
export function assertHeaderValue(name: string, value: string): string {
  return assertValid(name, value, headerValueProblem);
}

/** Check every name and value of `defaultHeaders`, returning a copy. */
function headerOption(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) return {};
  assertValid("defaultHeaders", headers, (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? undefined : "Expected an object of header names to values.",
  );
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    assertValid("defaultHeaders name", name, headerNameProblem);
    out[name] = assertHeaderValue(`defaultHeaders["${name}"]`, value);
  }
  return out;
}

/** An IMF-fixdate (RFC 9110 §5.6.7), the one HTTP-date form senders must generate. */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parse a `Retry-After` header into a delay in milliseconds (RFC 9110 §10.2.3):
 * either delay-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`,
 * turned into the time left from `now`; a date in the past gives 0).
 *
 * Returns `undefined` when the header is absent or malformed — negative (`"-1"`),
 * fractional (`"1.5"`), padded inside, any other date format — so the caller falls
 * back to its own backoff. The strict patterns matter: `Date.parse` alone would
 * read `"1.5"` as a date in 2001 and retry at once.
 */
export function parseRetryAfter(
  header: string | string[] | undefined,
  now: number = Date.now(),
): number | undefined {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (value === undefined || value === "") return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!IMF_FIXDATE.test(value)) return undefined;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - now);
}

/**
 * Strip control characters (all C0/C1 except tab and newline, plus DEL) out of a
 * string that originates in an attacker-controlled response body — the error
 * `detail` snippet that ends up in a LebensmittelwarnungApiError.message printed
 * raw to stderr by run.ts. Without this, a hostile / MITM'd / spoofed-`--base-url`
 * endpoint could drive ANSI/OSC escape sequences (display spoofing, terminal
 * title changes) into the user's terminal via a non-2xx reply. This only covers
 * error text: the CLI's JSON output is escaped separately (escapeControlChars in
 * cli/shared.ts), as JSON.stringify alone leaves DEL and the C1 range raw.
 *
 * Written as a char-code filter so no raw control byte ever appears in this source.
 */
function sanitizeServerText(text: string): string {
  let out = "";
  for (const ch of text) {
    const n = ch.codePointAt(0) ?? 0;
    if (n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

/** Why `value` is not a usable HttpResponse, or undefined when it is. */
function responseProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "not an object";
  const r = value as Partial<Record<"status" | "headers" | "body", unknown>>;
  if (typeof r.status !== "number" || !Number.isInteger(r.status) || r.status < 100 || r.status > 599) {
    return "status is not an HTTP status code";
  }
  if (typeof r.headers !== "object" || r.headers === null || Array.isArray(r.headers)) return "headers is not an object";
  if (bodyBytes(r.body) === undefined) return "body is not a Buffer, Uint8Array, other ArrayBuffer view or ArrayBuffer";
  return undefined;
}

/**
 * The response body as a Buffer (a view, no copy): a Buffer, any ArrayBuffer view (a
 * Uint8Array from fetch, a DataView) or an ArrayBuffer/SharedArrayBuffer — checked by internal
 * slot, not `instanceof`, so a value from another realm (a vm context, a Jest test) counts.
 * Undefined for anything else. (A Uint8Array used to be decoded with
 * `Uint8Array#toString`, which ignores the charset, so a declared latin1 body lost its
 * umlauts.)
 */
function bodyBytes(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") return Buffer.from(value as ArrayBuffer);
  return undefined;
}

/**
 * The response headers as a plain record with lower-case names. A transport built on
 * `fetch` naturally returns its `Headers` object, which has no plain properties, and a
 * custom one may write `Retry-After` in any case: the engine then saw no Retry-After and
 * retried after its own short backoff, inside the server's window. Such an object
 * (anything with `get` and `forEach`, a `Headers` or a `Map`) is copied into a record; a
 * plain record gets its names lower-cased.
 */
function plainHeaders(headers: object): Record<string, string | string[] | undefined> {
  const h = headers as { get?: unknown; forEach?: unknown };
  if (typeof h.get === "function" && typeof h.forEach === "function") {
    const record: Record<string, string> = {};
    (h.forEach as (cb: (value: unknown, name: unknown) => void) => void).call(headers, (value, name) => {
      record[String(name).toLowerCase()] = String(value);
    });
    return record;
  }
  const record: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    record[name.toLowerCase()] = value;
  }
  return record;
}

/**
 * Error codes of a connection that broke off mid-request: Node's (`socket hang up` is
 * ECONNRESET) and undici's (`fetch failed` with cause UND_ERR_SOCKET, "other side closed").
 */
const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET"]);

/** True when `err` or an error in its `cause` chain has a transient connection code. */
function hasTransientCode(err: unknown, depth = 0): boolean {
  if (typeof err !== "object" || err === null || depth > 4) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return true;
  return hasTransientCode((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * Check a base URL against every rule of {@link baseUrlProblem} — blank,
 * unparseable, a scheme other than `http:`/`https:`, a query or fragment — and
 * return it with trailing slashes stripped. A bad value throws a
 * LebensmittelwarnungValidationError ("Invalid baseUrl: <reason>"): it is a
 * configuration error, not a transport failure. The default transport still gates
 * the scheme per hop (as a NetworkError), but the engine may be handed a custom
 * transport that does no such check, so the configured value is checked here.
 */
export function validateBaseUrl(raw: string): string {
  return assertValid("baseUrl", raw, baseUrlProblem).replace(/\/+$/, "");
}

/** True for a loopback host name: `localhost`, `127.0.0.0/8`, `::1` (as `URL.hostname` gives them). */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * What travels unencrypted when requests go to `baseUrl`, as one sentence — or
 * `undefined` when nothing does: an `https:` URL, a URL that does
 * not parse (the base-URL check reports that), or a loopback host (`localhost`,
 * `127.0.0.0/8`, `::1`). The sentence names the host (`url.host`, host and port) and what
 * is sent with each request: the base URL's own credentials (userinfo) and any other
 * secret passed as a noun phrase in `secrets` (e.g. `"the API key"`). It never contains
 * a password or key. The CLI logs it as a `WARN` record of `lebensmittel.http` on stderr
 * (once per run, before the first request).
 */
export function cleartextProblem(baseUrl: string, secrets: readonly string[] = []): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" || isLoopbackHost(url.hostname)) return undefined;
  const sent = [...secrets];
  if (url.username !== "" || url.password !== "") sent.push("the base URL's credentials");
  if (sent.length === 0) return `requests to ${url.host} are sent unencrypted (http:, not https:)`;
  // "the base URL's credentials" and any pair are plural; a single secret phrase is not.
  const verb = sent.length === 1 && secrets.length === 1 ? "is" : "are";
  return `${sent.join(" and ")} ${verb} sent unencrypted to ${url.host} (http:, not https:)`;
}

/**
 * Decode an XML body by the encoding it is declared in, in the order RFC 7303 (§3.2,
 * XML media types) gives:
 *   1. a byte-order mark (UTF-8, UTF-16LE, UTF-16BE), which TextDecoder then drops;
 *   2. the `charset` parameter of the Content-Type (`text/xml; charset=ISO-8859-1`);
 *   3. the XML declaration's `encoding` (`<?xml version="1.0" encoding="ISO-8859-1"?>`);
 *   4. UTF-8, the XML default.
 * The Content-Type used to be ignored, so a Latin-1 body declared only there was read as
 * UTF-8: thousands of U+FFFD, and the label `Betroffene Bundesländer …` no longer matched,
 * so every warning lost `affectedStates`. An encoding TextDecoder doesn't know is a
 * LebensmittelwarnungParseError rather than mojibake. (Bytes that are invalid in the
 * declared encoding become U+FFFD, as everywhere in the WHATWG decoders.)
 */
function decodeXml(body: Buffer, contentType: string, path: string): string {
  let charset: string | undefined;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) charset = "utf-8";
  else if (body[0] === 0xff && body[1] === 0xfe) charset = "utf-16le";
  else if (body[0] === 0xfe && body[1] === 0xff) charset = "utf-16be";
  charset ??= /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1];
  charset ??= /^\s*<\?xml\s[^>]*?\bencoding\s*=\s*["']([^"']*)["']/.exec(body.subarray(0, 256).toString("latin1"))?.[1];
  charset ??= "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    throw new LebensmittelwarnungParseError(
      `Unsupported response charset "${sanitizeServerText(charset).slice(0, 100)}" from ${path}.`,
    );
  }
  return decoder.decode(body);
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RequestEngine {
  // A real private field (not TypeScript's `private`): util.inspect, console.log and
  // JSON.stringify of a client never show it, so a password in the base URL can't be
  // logged by accident.
  readonly #baseUrl: string;
  /** The base URL's userinfo, raw and percent-decoded, for scrubbing server and transport text. */
  readonly #credentials: string[];
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    // A misspelled option (`timeout`, `maxRetry`) was ignored and its default used.
    assertValid("options", options, knownKeysProblem(ENGINE_OPTION_KEYS));
    // The raw value is checked before the trailing-slash strip; only an omitted
    // baseUrl selects the default.
    this.#baseUrl = validateBaseUrl(options.baseUrl === undefined ? DEFAULT_BASE_URL : options.baseUrl);
    this.#credentials = credentialsIn(this.#baseUrl).flatMap((raw) => {
      try {
        return [raw, decodeURIComponent(raw)];
      } catch {
        return [raw];
      }
    });
    this.transport = functionOption("transport", options.transport, nodeHttpTransport);
    // Only an omitted userAgent selects the default: a blank one is an error, not
    // a silent fallback, and a malformed one fails here rather than at request time.
    this.userAgent =
      options.userAgent === undefined ? DEFAULT_USER_AGENT : assertHeaderValue("userAgent", options.userAgent);
    this.defaultHeaders = headerOption(options.defaultHeaders);
    this.timeoutMs = intOption("timeoutMs", options.timeoutMs, 30_000, MAX_TIMEOUT_MS);
    this.maxRetries = intOption("maxRetries", options.maxRetries, 2, MAX_RETRIES);
    this.retryDelayMs = intOption("retryDelayMs", options.retryDelayMs, 200, MAX_RETRY_AFTER_MS);
    this.maxResponseBytes = intOption(
      "maxResponseBytes",
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      Number.MAX_SAFE_INTEGER,
    );
    this.sleep = functionOption("sleep", options.sleep, realSleep);
  }

  /**
   * `text` without the base URL's credentials: server text (an error body that echoes the
   * request URL) and transport text (fetch's "Failed to fetch <url>") can carry them.
   */
  private scrub(text: string): string {
    return this.#credentials.length === 0 ? text : redactCredentials(text, this.#credentials);
  }

  /**
   * A transport failure as the `cause` of the error the engine raises: the original when its
   * text carries no credentials, otherwise a copy with them scrubbed (message, `code` and the
   * cause chain kept), so logging the error with its causes can't reveal the base URL's
   * password.
   */
  private scrubCause(cause: unknown, depth = 0): unknown {
    if (this.#credentials.length === 0 || depth > 5) return cause;
    if (typeof cause === "string") return this.scrub(cause);
    if (!(cause instanceof Error)) return cause;
    const inner = this.scrubCause(cause.cause, depth + 1);
    const message = this.scrub(cause.message);
    if (message === cause.message && inner === cause.cause && !this.scrub(cause.stack ?? "").includes("***@")) return cause;
    const copy = new Error(message, inner === undefined ? undefined : { cause: inner });
    copy.name = cause.name;
    const code = (cause as { code?: unknown }).code;
    if (code !== undefined) Object.assign(copy, { code });
    return copy;
  }

  /**
   * What the transport threw, as the error the engine raises. The default transport
   * rejects with `LebensmittelwarnungNetworkError` only; an injected one may throw anything
   * (a string, a `TypeError` from fetch). Every failure becomes a
   * `LebensmittelwarnungNetworkError` — a `LebensmittelwarnungError` a caller and the CLI can
   * rely on — with the base URL's credentials scrubbed from its message and cause chain; any
   * other `LebensmittelwarnungError` passes through, and a clean network error stays as it is.
   */
  private transportError(cause: unknown): LebensmittelwarnungError {
    if (cause instanceof LebensmittelwarnungError && !(cause instanceof LebensmittelwarnungNetworkError)) return cause;
    const reason = cause instanceof Error ? cause.message : String(cause);
    const message = cutForMessage(sanitizeServerText(this.scrub(reason)));
    const scrubbed = this.scrubCause(cause);
    if (cause instanceof LebensmittelwarnungNetworkError && message === cause.message && scrubbed === cause) return cause;
    return new LebensmittelwarnungNetworkError(message, { cause: scrubbed });
  }

  /**
   * Call the transport under the overall deadline (`timeoutMs`): the request gets an
   * AbortSignal that fires at the deadline, and the call rejects then whether the transport
   * stops or not — a custom transport (fetch, a node:http wrapper) that ignores `timeoutMs`
   * can't hang the caller. A synchronous throw becomes a rejection.
   */
  private async callTransport(request: HttpRequest): Promise<HttpResponse> {
    const call = (signal?: AbortSignal): Promise<HttpResponse> =>
      Promise.resolve().then(() => this.transport(signal === undefined ? request : { ...request, signal }));
    if (this.timeoutMs === 0) return call();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new LebensmittelwarnungNetworkError(`Request exceeded the ${this.timeoutMs}ms deadline`);
        controller.abort(err);
        reject(err);
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([call(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Build a fully-qualified URL from a path and optional query parameters. */
  buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : "";
    return `${this.#baseUrl}${normalizedPath}${qs ? `?${qs}` : ""}`;
  }

  /**
   * {@link buildUrl} without the base URL's userinfo: the base that relative links in the
   * feed (image `src`s of an item without a `<link>`) are resolved against, so a password in
   * the base URL can never end up in a warning's `imageUrls`.
   */
  publicUrl(path: string): string {
    const url = new URL(this.buildUrl(path));
    url.username = "";
    url.password = "";
    return url.href;
  }

  /**
   * Perform a GET with Accept negotiation and transient-error retries. Redirects
   * are NOT followed — a 3xx surfaces as an error (the canonical host answers the
   * feed directly).
   */
  async request(path: string, query?: QueryParams, accept = "application/rss+xml, application/xml"): Promise<RawResponse> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      Accept: accept,
      "User-Agent": this.userAgent,
    };

    let attempt = 0;
    for (;;) {
      let response: HttpResponse;
      try {
        response = await this.callTransport({
          method: "GET",
          url,
          headers,
          timeoutMs: this.timeoutMs,
          ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
        });
      } catch (cause) {
        // A connection the server (or a gateway) reset is retried like a 503, whichever
        // transport reported it (Node's ECONNRESET, fetch's UND_ERR_SOCKET, anywhere in the
        // cause chain). A refused connection, a DNS failure and a timeout are not: a slow
        // or absent upstream should not be asked again at once.
        if (hasTransientCode(cause) && attempt < this.maxRetries) {
          attempt += 1;
          await this.sleep(this.retryDelayMs * attempt);
          continue;
        }
        throw this.transportError(cause);
      }

      // An injected transport may resolve with anything; a malformed HttpResponse would
      // otherwise surface below as a raw TypeError, outside the error contract.
      const invalid = responseProblem(response);
      if (invalid !== undefined) {
        throw new LebensmittelwarnungNetworkError(`The transport returned an invalid response (${invalid}).`);
      }
      const status = response.status;
      const responseHeaders = plainHeaders(response.headers);
      // fetch gives a Uint8Array; view it as a Buffer (no copy), which the decoder expects.
      const body = bodyBytes(response.body) as Buffer;
      // The size cap holds whatever the transport did: the default one aborts early, a custom
      // one may have read everything.
      if (this.maxResponseBytes > 0 && body.byteLength > this.maxResponseBytes) {
        throw new LebensmittelwarnungNetworkError(sizeLimitMessage(this.maxResponseBytes));
      }
      const retryable = status === 429 || status === 503;
      const retryAfter = retryable ? parseRetryAfter(responseHeaders["retry-after"]) : undefined;
      if (retryable && attempt < this.maxRetries) {
        // Back off linearly (retryDelayMs * attempt). A Retry-After can make the wait longer,
        // never shorter: `Retry-After: 0` or a date in the past turned the retries into a
        // zero-delay burst against a server that had just asked for less load. A Retry-After
        // beyond MAX_RETRY_AFTER_MS is not retried: the error below surfaces at once and
        // names the wait the server asked for.
        if (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_MS) {
          attempt += 1;
          const backoff = this.retryDelayMs * attempt;
          await this.sleep(retryAfter === undefined ? backoff : Math.max(retryAfter, backoff));
          continue;
        }
      }

      const contentType = String(responseHeaders["content-type"] ?? "");
      if (status < 200 || status >= 300) {
        const tooLong = retryable && retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_MS;
        throw this.toApiError(url, status, body, tooLong ? retryAfter : undefined);
      }

      return { data: body, contentType, status };
    }
  }

  /**
   * GET a feed path and parse the RSS reply.
   *
   * The response Content-Type does not decide whether the body is a feed (the portal
   * serves it as `text/xml`, but we sniff the body rather than trust the type); only its
   * `charset` is used, to decode the body (see decodeXml). Two
   * failure modes are surfaced as a typed LebensmittelwarnungParseError with a
   * plain-language message rather than a cryptic parse failure:
   *   - an HTML shell (the feed moved, or a proxy returned the website); and
   *   - an EMPTY body — which is exactly what the DEFUNCT legacy JSON API returns
   *     (HTTP 200 + Content-Length: 0 since the portal relaunch), so the hint
   *     names it explicitly.
   */
  async getFeed(path: string, query?: QueryParams): Promise<RssFeed> {
    const res = await this.request(path, query);
    const text = decodeXml(res.data, res.contentType, path);
    const head = text.trimStart().slice(0, 200).toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
      throw new LebensmittelwarnungParseError(
        `Expected an RSS feed from ${path} but received an HTML page — the feed may have moved.`,
      );
    }
    if (text.trim().length === 0) {
      throw new LebensmittelwarnungParseError(
        `Empty response from ${path} — the feed returned no content. (The legacy JSON API at ` +
          "megov.bayern.de is defunct and returns an empty body; this client uses the RSS feeds.)",
      );
    }
    try {
      return parseRss(text);
    } catch (cause) {
      // Name the parser's reason (run.ts prints only the message, never `cause`).
      const reason = cause instanceof Error ? `: ${cutForMessage(sanitizeServerText(cause.message))}` : "";
      throw new LebensmittelwarnungParseError(`Failed to parse RSS response from ${path}${reason}`, {
        cause: this.scrubCause(cause),
      });
    }
  }

  private toApiError(url: string, status: number, body: Buffer, retryAfterMs?: number): LebensmittelwarnungApiError {
    // The body is kept on the error (`body`) and may echo the request URL: scrub it.
    const text = this.scrub(body.toString("utf8"));
    // The portal serves HTML error pages, not a structured envelope; surface a
    // short, whitespace-collapsed snippet only when it is plain (non-HTML) text.
    const snippet = text.trim().replace(/\s+/g, " ");
    let detail =
      snippet.length > 0 && !snippet.startsWith("<")
        ? snippet.length > 200
          ? `${cutText(snippet, 200)}…`
          : snippet
        : undefined;
    // `detail` came from the response body and lands in an Error.message printed
    // raw to stderr; strip control chars so a hostile endpoint cannot inject
    // terminal escape sequences. (`\s+` collapse above already drops tab/newline.)
    if (detail !== undefined) detail = sanitizeServerText(detail);
    return new LebensmittelwarnungApiError({ status, url, method: "GET", body: text, detail, retryAfterMs });
  }
}
