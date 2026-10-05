// Public entry point for the API client library.

export { LebensmittelwarnungClient, FEED_PATH, filterWarnings, isUnrenderedTitle, searchForms } from "./client.js";
export type { SearchForms } from "./client.js";
export { berlinDay } from "./dates.js";
export type { LebensmittelwarnungClientOptions } from "./client.js";
export {
  RequestEngine,
  DEFAULT_BASE_URL,
  ENGINE_OPTION_KEYS,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  assertHeaderValue,
  parseRetryAfter,
  validateBaseUrl,
} from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  MAX_WARNINGS_LIMIT,
  assertValid,
  baseUrlProblem,
  calendarDateProblem,
  headerNameProblem,
  headerValueProblem,
  knownKeysProblem,
  limitProblem,
  nonBlankProblem,
} from "./validate.js";
export type { Problem } from "./validate.js";
export { parseRss, parseDescription, decodeEntities } from "./rss.js";
export type { RssFeed, RssChannel, RawRssItem, ParsedDescription, DescriptionImage } from "./rss.js";
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
  redactUrl,
  cutForMessage,
  MAX_MESSAGE_VALUE_LENGTH,
  credentialsIn,
  redactCredentials,
} from "./errors.js";

export * from "./types.js";
