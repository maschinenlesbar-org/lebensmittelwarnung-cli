// The request engine: turns logical (path, query) calls into HTTP GET requests via
// a Transport, applies retry/backoff for transient statuses (429, 503), and decodes
// RSS responses. The lebensmittelwarnung.de "API" is the portal's official RSS 2.0
// product-warning feed: unauthenticated GETs against www.lebensmittelwarnung.de,
// optionally narrowed with `state=` / `type=` query parameters.
//
// NOTE: the legacy JSON API (megov.bayern.de / the bundesAPI spec) is DEFUNCT — it
// has returned HTTP 200 with an empty body since the portal relaunch. This engine
// wraps the RSS feeds instead. No API key exists or is needed.

import { nodeHttpTransport, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import { parseRss, type RssFeed } from "./rss.js";
import { LebensmittelwarnungApiError, LebensmittelwarnungParseError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://www.lebensmittelwarnung.de";
const DEFAULT_USER_AGENT = "lebensmittelwarnung-cli";

export interface RawResponse {
  data: Buffer;
  contentType: string;
  status: number;
}

export interface EngineOptions {
  /** Base URL of the API. Defaults to https://www.lebensmittelwarnung.de */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /** Value of the User-Agent header. */
  userAgent?: string;
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string>;
  /** Per-request timeout in milliseconds (0 disables). */
  timeoutMs?: number;
  /** Number of automatic retries for transient (429/503) responses. */
  maxRetries?: number;
  /** Base backoff between retries in milliseconds (grows linearly). */
  retryDelayMs?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

/**
 * Strip control characters (all C0/C1 except tab and newline, plus DEL) out of a
 * string that originates in an attacker-controlled response body — the error
 * `detail` snippet that ends up in a LebensmittelwarnungApiError.message printed
 * raw to stderr by run.ts. Without this, a hostile / MITM'd / spoofed-`--base-url`
 * endpoint could drive ANSI/OSC escape sequences (display spoofing, terminal
 * title changes) into the user's terminal via a non-2xx reply. The success path
 * is already safe (JSON.stringify escapes these), so this only covers error text.
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
    this.transport = options.transport ?? nodeHttpTransport;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
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
        attempt += 1;
        await this.sleep(this.retryDelayMs * attempt);
        continue;
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
      throw new LebensmittelwarnungParseError(`Failed to parse RSS response from ${path}`, { cause });
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
