// The request engine: turns logical (path, query) calls into HTTP GET requests via
// a Transport, applies retry/backoff for transient statuses (429, 503), and decodes
// RSS responses. The lebensmittelwarnung.de "API" is the portal's official RSS 2.0
// product-warning feed: unauthenticated GETs against www.lebensmittelwarnung.de,
// optionally narrowed with `state=` / `type=` query parameters.
//
// NOTE: the legacy JSON API (megov.bayern.de / the bundesAPI spec) is DEFUNCT — it
// has returned HTTP 200 with an empty body since the portal relaunch. This engine
// wraps the RSS feeds instead. No API key exists or is needed.

import { MAX_TIMEOUT_MS, nodeHttpTransport, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import { parseRss, type RssFeed } from "./rss.js";
import {
  LebensmittelwarnungApiError,
  LebensmittelwarnungNetworkError,
  LebensmittelwarnungParseError,
  LebensmittelwarnungValidationError,
  redactUrl,
} from "./errors.js";

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
  /** Base URL of the API. Defaults to https://www.lebensmittelwarnung.de */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /** Value of the User-Agent header. */
  userAgent?: string;
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * Time limit per request in milliseconds, covering the whole response body, not
   * only idle gaps (0 disables; at most MAX_TIMEOUT_MS, 2^31 - 1 ms).
   */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses, 0..`MAX_RETRIES`
   * (10). Each waits the
   * response's `Retry-After` (up to `MAX_RETRY_AFTER_MS`; a longer one is not
   * retried), or else `retryDelayMs * attempt`.
   */
  maxRetries?: number;
  /**
   * Base backoff between retries in milliseconds (grows linearly); used without a
   * Retry-After. At most `MAX_RETRY_AFTER_MS`.
   */
  retryDelayMs?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit;
   * at most `Number.MAX_SAFE_INTEGER`.
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
      `Invalid option ${name}: expected an integer from 0 to ${max}, got ${String(value)}.`,
    );
  }
  return value;
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

/**
 * Reject a base URL whose scheme is not http(s), or that has a query or fragment.
 * The default transport already gates the scheme per hop, but the engine is
 * exported as a library and may be handed a custom transport that does no such
 * check, so gate the configured base URL here too (a `file:`/`ftp:` base URL fails
 * fast with a typed error). Request paths are appended to the base URL as a string,
 * so a `?` or `#` in it would swallow every path: `http://h/?x=1` requests
 * `/?x=1/___LMW-Redaktion/...` and `http://h/#f` requests `/`.
 */
function assertHttpScheme(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LebensmittelwarnungNetworkError(`Invalid base URL: ${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LebensmittelwarnungNetworkError(
      `Unsupported protocol "${url.protocol}" in base URL: ${redactUrl(baseUrl)}`,
    );
  }
  if (/[?#]/.test(baseUrl)) {
    throw new LebensmittelwarnungNetworkError(`Base URL must not contain a query or fragment: ${redactUrl(baseUrl)}`);
  }
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RequestEngine {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    assertHttpScheme(this.baseUrl);
    this.transport = options.transport ?? nodeHttpTransport;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = intOption("timeoutMs", options.timeoutMs, 30_000, MAX_TIMEOUT_MS);
    this.maxRetries = intOption("maxRetries", options.maxRetries, 2, MAX_RETRIES);
    this.retryDelayMs = intOption("retryDelayMs", options.retryDelayMs, 200, MAX_RETRY_AFTER_MS);
    this.maxResponseBytes = intOption(
      "maxResponseBytes",
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      Number.MAX_SAFE_INTEGER,
    );
    this.sleep = options.sleep ?? realSleep;
  }

  /** Build a fully-qualified URL from a path and optional query parameters. */
  buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : "";
    return `${this.baseUrl}${normalizedPath}${qs ? `?${qs}` : ""}`;
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
      const response = await this.transport({
        method: "GET",
        url,
        headers,
        timeoutMs: this.timeoutMs,
        ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
      });

      const status = response.status;
      const retryable = status === 429 || status === 503;
      if (retryable && attempt < this.maxRetries) {
        // Honour Retry-After; without a usable one, back off linearly. A Retry-After
        // beyond MAX_RETRY_AFTER_MS is not retried: the error below surfaces at once.
        const retryAfter = parseRetryAfter(response.headers["retry-after"]);
        if (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_MS) {
          attempt += 1;
          await this.sleep(retryAfter ?? this.retryDelayMs * attempt);
          continue;
        }
      }

      const contentType = String(response.headers["content-type"] ?? "");
      if (status < 200 || status >= 300) {
        throw this.toApiError(url, status, response.body);
      }

      return { data: response.body, contentType, status };
    }
  }

  /**
   * GET a feed path and parse the RSS reply.
   *
   * The response Content-Type is intentionally *ignored* (the portal serves the
   * feed as `text/xml`, but we sniff the body rather than trust the header). Two
   * failure modes are surfaced as a typed LebensmittelwarnungParseError with a
   * plain-language message rather than a cryptic parse failure:
   *   - an HTML shell (the feed moved, or a proxy returned the website); and
   *   - an EMPTY body — which is exactly what the DEFUNCT legacy JSON API returns
   *     (HTTP 200 + Content-Length: 0 since the portal relaunch), so the hint
   *     names it explicitly.
   */
  async getFeed(path: string, query?: QueryParams): Promise<RssFeed> {
    const res = await this.request(path, query);
    const text = res.data.toString("utf8");
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
      const reason = cause instanceof Error ? `: ${sanitizeServerText(cause.message)}` : "";
      throw new LebensmittelwarnungParseError(`Failed to parse RSS response from ${path}${reason}`, { cause });
    }
  }

  private toApiError(url: string, status: number, body: Buffer): LebensmittelwarnungApiError {
    const text = body.toString("utf8");
    // The portal serves HTML error pages, not a structured envelope; surface a
    // short, whitespace-collapsed snippet only when it is plain (non-HTML) text.
    const snippet = text.trim().replace(/\s+/g, " ");
    let detail =
      snippet.length > 0 && !snippet.startsWith("<")
        ? snippet.length > 200
          ? `${snippet.slice(0, 200)}…`
          : snippet
        : undefined;
    // `detail` came from the response body and lands in an Error.message printed
    // raw to stderr; strip control chars so a hostile endpoint cannot inject
    // terminal escape sequences. (`\s+` collapse above already drops tab/newline.)
    if (detail !== undefined) detail = sanitizeServerText(detail);
    return new LebensmittelwarnungApiError({ status, url, method: "GET", body: text, detail });
  }
}
