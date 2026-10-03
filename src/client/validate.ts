// Input validation shared by the library and the CLI. Every rule about what a
// request may contain lives here (or next to the option it guards) as a pure,
// exported function, so the CLI calls the very same rule instead of keeping a copy.
//
// - A `Problem` returns the reason a value is invalid ("Expected a non-empty
//   value."), or `undefined` when it is valid. The CLI's commander parsers turn
//   that reason into an `InvalidArgumentError` (exit 2).
// - `assertValid` runs a `Problem` in the library and throws a
//   `LebensmittelwarnungValidationError` ("Invalid <name>: <reason>") before any
//   request is made. Methods that return a promise call it inside the async body,
//   so they reject rather than throw synchronously; constructors throw.

import { LebensmittelwarnungValidationError } from "./errors.js";

/** A validation rule: the reason `value` is invalid, or `undefined` when it is valid. */
export type Problem<T = unknown> = (value: T) => string | undefined;

/**
 * Check `value` against `problem` and return it unchanged when it is valid.
 * Otherwise throw a {@link LebensmittelwarnungValidationError} with the message
 * `Invalid <name>: <reason>`.
 */
export function assertValid<T>(name: string, value: T, problem: Problem<T>): T {
  const reason = problem(value);
  if (reason !== undefined) throw new LebensmittelwarnungValidationError(`Invalid ${name}: ${reason}`);
  return value;
}

/**
 * A free-text value (the `search` needle) must be a string with something besides
 * whitespace in it. A blank needle would match every warning, so it is rejected
 * rather than silently returning the whole feed.
 */
export const nonBlankProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string") return "Expected a string.";
  if (value.trim() === "") return "Expected a non-empty value.";
  return undefined;
};

/**
 * A calendar date `YYYY-MM-DD` (surrounding whitespace allowed) that exists: an
 * impossible date such as `2026-02-30` or `2026-13-40` is rejected rather than
 * rolled over or compared as an Invalid Date. Years 0000-9999 are accepted.
 */
export const calendarDateProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string") return "Expected a string.";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return "Expected a date in YYYY-MM-DD format.";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0–99 to 1900–1999, so a
  // valid "0050-01-01" would fail the round trip below as "not a valid date".
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  // Round-trip check: rejects impossible dates that would otherwise roll over
  // (month 13 -> next year, day 40 -> next month).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return "Not a valid calendar date.";
  }
  return undefined;
};

/**
 * The most warnings a `limit` may ask for — the RSS parser's own item cap, so a
 * larger limit could never apply.
 */
export const MAX_WARNINGS_LIMIT = 100_000;

/** A `limit` must be an integer from 1 to {@link MAX_WARNINGS_LIMIT}. */
export const limitProblem: Problem<unknown> = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return "Expected an integer.";
  if (value < 1) return "Must be >= 1.";
  if (value > MAX_WARNINGS_LIMIT) return `Must be <= ${MAX_WARNINGS_LIMIT}.`;
  return undefined;
};
