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

import { LebensmittelwarnungValidationError, quoteValue } from "./errors.js";

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
 * An options object must be a plain object (or `undefined`, for "none") whose own keys
 * are all in `known`. A misspelled or unknown key (`States`, `timeout`), or a
 * `__proto__` key from `JSON.parse`, used to be ignored without a word, so
 * `warnings({ States: "bayern" })` returned the whole unfiltered feed. Returns a
 * `Problem` naming the first unknown key (cut, JSON-quoted) and the known ones.
 */
export function knownKeysProblem(known: readonly string[]): Problem<unknown> {
  return (value) => {
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "Expected an object.";
    for (const key of Object.keys(value)) {
      if (!known.includes(key)) {
        return `Unknown key ${JSON.stringify(key.slice(0, 60))}; expected one of ${known.join(", ")}.`;
      }
    }
    return undefined;
  };
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

/** Characters that never make a value non-blank: whitespace, controls, format characters, combining marks. */
const INVISIBLE = /[\s\p{Cc}\p{Cf}\p{M}]/gu;

/** A lone surrogate: half of a character. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * True when nothing in `value` would match anything: it holds only whitespace, control and
 * format characters (a zero-width space, a soft hyphen) and combining marks. The search folds
 * marks away (`searchForms`), so `--search` U+0308 became `""` and matched every warning; such a
 * value is refused as blank.
 */
function isBlank(value: string): boolean {
  return value.replace(INVISIBLE, "") === "";
}

/** `U+200B` for the first character of `text` that `pattern` matches. */
function codePointOf(text: string, pattern: RegExp): string {
  const ch = pattern.exec(text)?.[0] ?? "";
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** A control character inside a text: C0 and C1, but not TAB, LF or CR (whitespace in a pasted phrase). */
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** A format character inside a text, but not ZWNJ/ZWJ (U+200C/U+200D), which some scripts and emoji need. */
const TEXT_FORMAT = /(?![\u200c\u200d])\p{Cf}/u;

/**
 * Why `value` cannot be used as a text filter (the `search` needle), or undefined when it can.
 * Refused, before any request, as the search would match nothing or everything:
 * - a value that is blank once trimmed (Unicode whitespace, U+00A0 included), or that holds only
 *   invisible characters and combining marks (`isBlank`): folded, it is `""`, which every
 *   warning contains;
 * - a lone surrogate (half of a character);
 * - a control character (but TAB, LF and CR) or a format character (a zero-width space, a soft
 *   hyphen, a bidi control; ZWNJ and ZWJ are allowed): pasted along, it makes the search find
 *   nothing.
 * The reason quotes the value with every invisible character escaped (`quoteValue`).
 */
export function textProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return "Expected a string.";
  if (isBlank(value)) return "Expected a non-empty value.";
  if (LONE_SURROGATE.test(value)) return `${quoteValue(value)} contains half of a character (a lone surrogate).`;
  if (TEXT_CONTROL.test(value)) return `${quoteValue(value)} contains a control character (${codePointOf(value, TEXT_CONTROL)}).`;
  if (TEXT_FORMAT.test(value)) return `${quoteValue(value)} contains an invisible character (${codePointOf(value, TEXT_FORMAT)}).`;
  return undefined;
}

/**
 * A text as it is matched: without surrounding whitespace and in composed Unicode, NFC. Inner
 * whitespace is kept. (`searchForms` folds further, on both sides of the comparison.)
 */
export function normalizeText(value: string): string {
  return value.trim().normalize("NFC");
}

/** A control or format character in a token (after trimming): every Cc and every Cf. */
const TOKEN_INVISIBLE = /[\p{Cc}\p{Cf}]/u;

/**
 * Why `value` cannot be sent as a token, or undefined when it can. A token is a value compared
 * exactly: here the `state` and `type` slugs. The rules apply to the value with surrounding
 * whitespace trimmed, as it is sent ({@link normalizeToken}): not blank (and not only invisible
 * characters or combining marks), no lone surrogate, and no control or format character at all
 * (a zero-width space, ZWJ, a soft hyphen, a bidi control), since an invisible character in a slug
 * only ever makes it unknown. The reason quotes the value visibly. A slug is then checked against
 * the known list (`isStateSlug`, `isTypeSlug`).
 */
export function tokenProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return "Expected a string.";
  if (isBlank(value)) return "Expected a non-empty value.";
  const token = value.trim();
  if (LONE_SURROGATE.test(token)) return `${quoteValue(value)} contains half of a character (a lone surrogate).`;
  if (TOKEN_INVISIBLE.test(token)) {
    return `${quoteValue(value)} contains an invisible or control character (${codePointOf(token, TOKEN_INVISIBLE)}).`;
  }
  return undefined;
}

/** A token as it is sent: trimmed and in composed Unicode (NFC). Check it with {@link tokenProblem} first. */
export function normalizeToken(value: string): string {
  return value.trim().normalize("NFC");
}

/**
 * The items of a comma-separated list value, as typed: each item is checked (`listProblem`) and
 * canonicalised (`normalizeToken`) on its own, so `"a1,,a2"`, `"a1,"` and `","` are refused rather
 * than sent with an empty item. (No option of this CLI takes a list; the kit's rule, for a library
 * caller.)
 */
export function splitList(value: string): string[] {
  return value.split(",");
}

/**
 * Why `items` cannot be used as a list, or undefined when it can: not an array of strings, no item
 * at all, or an item that `itemProblem` refuses (by default {@link tokenProblem}: a blank item is
 * refused, never dropped). The reason names the item.
 */
export function listProblem(items: readonly string[], itemProblem: Problem<unknown> = tokenProblem): string | undefined {
  if (!Array.isArray(items)) return "Expected a list of strings.";
  if (items.length === 0) return "Expected at least one value.";
  for (let i = 0; i < items.length; i++) {
    const problem = itemProblem(items[i]);
    if (problem !== undefined) return items.length === 1 ? problem : `item ${i + 1} of ${items.length}: ${problem}`;
  }
  return undefined;
}

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

/**
 * A value that ends up in an HTTP header (the User-Agent, a default header) must
 * be a non-blank string of Latin-1 characters without control characters (tab is
 * allowed, as in HTTP). Node's HTTP layer would otherwise throw an opaque "Invalid
 * character in header content" at request time, and a custom transport would get
 * a CR/LF through (header injection). Checked by char code so the source stays
 * free of control bytes.
 */
export const headerValueProblem: Problem<unknown> = (value) => {
  const blank = nonBlankProblem(value);
  if (blank !== undefined) return blank;
  const text = value as string;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09) || c === 0x7f) return "Value contains control characters.";
    if (c > 0xff) return "Value contains characters outside Latin-1 (above U+00FF).";
  }
  return undefined;
};

/** An HTTP header name must be a non-empty RFC 9110 token. */
export const headerNameProblem: Problem<unknown> = (value) =>
  typeof value === "string" && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
    ? undefined
    : "Expected an HTTP header name (a token such as X-Request-Id).";

/**
 * Every rule for a base URL, in order: a non-blank string without surrounding
 * whitespace or control characters, a parseable URL, the `http:` or `https:` scheme,
 * no query or fragment, and userinfo that decodes. Request paths are appended to the
 * base URL as a string, so a `?` or `#` would swallow every path (`http://h/?x=1`
 * requests `/?x=1/___LMW-Redaktion/...`, `http://h/#f` requests `/`), and a trailing
 * space would land in the path (`/ok%20/___LMW…`): `new URL()` trims surrounding
 * whitespace and drops tab/CR/LF silently, so the raw string is checked. Node decodes
 * a `user:password@` into the Authorization header and fails at request time on a `%`
 * that isn't an escape, so that is rejected here too (write a literal `%` as `%25`).
 * The reasons never echo the URL, so a credential in it cannot leak.
 */
export const baseUrlProblem: Problem<unknown> = (value) => {
  if (typeof value !== "string") return "Expected a string.";
  if (value.trim() === "") return "Expected a non-empty URL.";
  if (value !== value.trim()) return "A base URL cannot have surrounding whitespace.";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return "A base URL cannot contain control characters.";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Expected a valid URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http: and https: base URLs are supported.";
  if (/[?#]/.test(value)) return "A base URL cannot have a query (?) or fragment (#).";
  for (const part of [url.username, url.password]) {
    try {
      decodeURIComponent(part);
    } catch {
      return 'The user name or password has a "%" that is not followed by two hex digits; write a literal "%" as %25.';
    }
  }
  return undefined;
};
