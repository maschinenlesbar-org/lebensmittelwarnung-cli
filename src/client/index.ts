// Public entry point for the API client library.

export { LebensmittelwarnungClient, FEED_PATH, isUnrenderedTitle } from "./client.js";
export type { LebensmittelwarnungClientOptions } from "./client.js";
export { RequestEngine, DEFAULT_BASE_URL } from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export { parseRss, parseDescription, decodeEntities } from "./rss.js";
export type { RssFeed, RssChannel, RawRssItem, ParsedDescription } from "./rss.js";
export {
  STATE_SLUGS,
  STATE_NAMES,
  TYPE_SLUGS,
  TYPE_NAMES,
  isStateSlug,
  isTypeSlug,
} from "./enums.js";
export type { StateSlug, TypeSlug } from "./enums.js";
export {
  LebensmittelwarnungError,
  LebensmittelwarnungApiError,
  LebensmittelwarnungNetworkError,
  LebensmittelwarnungValidationError,
  LebensmittelwarnungParseError,
} from "./errors.js";

export * from "./types.js";
