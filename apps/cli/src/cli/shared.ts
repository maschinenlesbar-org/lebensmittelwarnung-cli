// Shared helpers used across CLI command groups: option parsers, the global
// option resolver, and JSON rendering.

import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import { logOf, type CliDeps } from "./io.js";
import { checkOutputTarget } from "./output.js";
import type { LebensmittelwarnungClientOptions } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/client";
import {
  baseUrlProblem,
  calendarDateProblem,
  headerValueProblem,
  limitProblem,
  nonBlankProblem,
} from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/validate";
import { DEFAULT_BASE_URL, cleartextProblem, type RetryEvent } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/engine";

/**
 * commander value-parser: a plain base-10 non-negative integer.
 *
 * Uses a strict regex rather than `Number()` coercion, which would otherwise
 * accept empty/whitespace strings (`Number("") === 0`), hex/binary/scientific
 * literals, signs, padding and decimals.
 */
export function parseIntArg(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return n;
}

/** Build a commander value-parser for an integer constrained to [min, max]. */
export function parseBoundedInt(min: number, max: number): (value: string) => number {
  return (value: string) => {
    const n = parseIntArg(value);
    if (n < min) throw new InvalidArgumentError(`Must be >= ${min}.`);
    if (n > max) throw new InvalidArgumentError(`Must be <= ${max}.`);
    return n;
  };
}

/** commander value-parser: a non-empty (after trimming) string (the library's {@link nonBlankProblem}). */
export function parseNonEmpty(value: string): string {
  const problem = nonBlankProblem(value);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return value;
}

/**
 * Wrap a commander value-parser for a single-valued option so that a second
 * occurrence is a usage error. commander otherwise keeps only the last value, so
 * `--state bayern --state hessen` silently dropped Bayern, and `--base-url A
 * --base-url B` requested B. The wrapper counts the occurrences itself (a default
 * value is not one), so build it once per program — `buildProgram` does, per run.
 */
export function once<T>(parse: (value: string) => T): (value: string, previous: T | undefined) => T {
  let given = false;
  return (value) => {
    if (given) throw new InvalidArgumentError("Given more than once; this option takes a single value.");
    given = true;
    return parse(value);
  };
}

/** An Option constrained to a fixed set of choices, given at most once. */
export function choiceOption(flags: string, description: string, choices: readonly string[]): Option {
  const option = new Option(flags, description).choices([...choices]);
  // Keep commander's choice check (and the choices in --help), and reject a repeat.
  const check = option.parseArg as (value: string, previous: unknown) => string;
  return option.argParser(once((value: string) => check(value, undefined)));
}

/**
 * commander value-parser for `-o, --output <file>`. A blank or whitespace-only path
 * is a usage error: `-o ""` used to print to stdout silently and `-o " "` created a
 * file named " ". `-` is kept as is and means stdout (see {@link action}), the
 * usual convention, rather than a file named "-".
 */
export function parseOutputPath(value: string): string {
  return parseNonEmpty(value);
}

/**
 * commander value-parser for --base-url. The base URL is trusted input, but it must
 * pass the library's {@link baseUrlProblem} (non-blank, `http:`/`https:` only, no
 * query or fragment), so a bad value fails at parse time (exit 2) with a clear
 * message rather than deep in the transport. The CLI keeps no rules of its own.
 */
export function parseBaseUrl(value: string): string {
  const problem = baseUrlProblem(value);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return value;
}

/**
 * commander value-parser for a value that ends up in an HTTP header (`--user-agent`).
 * The rule is the library's {@link headerValueProblem} — blank, control characters
 * other than tab, DEL and characters above U+00FF are rejected — so a bad value is a
 * usage error (exit 2) here instead of an opaque failure at request time.
 */
export function parseHeaderValue(value: string): string {
  const problem = headerValueProblem(value);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return value;
}

/**
 * commander value-parser for a `--since <YYYY-MM-DD>` calendar date. The rule is the
 * library's {@link calendarDateProblem}: a malformed or impossible date (e.g.
 * `2026-13-40`) is a usage error at parse time (exit 2). Returns the trimmed date,
 * which the action passes to `client.warnings({ since })`.
 */
export function parseDate(value: string): string {
  const problem = calendarDateProblem(value);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return value.trim();
}

/**
 * commander value-parser for `--limit <n>`: a plain base-10 integer (see
 * {@link parseIntArg}) that passes the library's {@link limitProblem}
 * (1..MAX_WARNINGS_LIMIT).
 */
export function parseLimit(value: string): number {
  const n = parseIntArg(value);
  const problem = limitProblem(n);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return n;
}

export interface GlobalOptions {
  baseUrl?: string;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  maxResponseBytes?: number;
  compact?: boolean;
  output?: string;
  force?: boolean;
}

/** Translate resolved global CLI options into client options. */
export function toEngineOptions(global: GlobalOptions): LebensmittelwarnungClientOptions {
  const options: LebensmittelwarnungClientOptions = {};
  if (global.baseUrl !== undefined) options.baseUrl = global.baseUrl;
  if (global.timeout !== undefined) options.timeoutMs = global.timeout;
  if (global.userAgent !== undefined) options.userAgent = global.userAgent;
  if (global.maxRetries !== undefined) options.maxRetries = global.maxRetries;
  if (global.maxResponseBytes !== undefined) options.maxResponseBytes = global.maxResponseBytes;
  return options;
}

export interface ActionContext {
  client: ReturnType<CliDeps["createClient"]>;
  global: GlobalOptions;
  /** This command's own parsed options. */
  opts: Record<string, unknown>;
}

/** `HTTP 503 from host: retry 1 of 3 in 2 s` (host only; whole seconds, ms under 1 s). */
export function retryMessage(event: RetryEvent): string {
  let host: string;
  try {
    host = new URL(event.url).host;
  } catch {
    host = "the server";
  }
  const why = event.status === undefined ? "connection reset" : `HTTP ${event.status}`;
  const wait = event.delayMs < 1000 ? `${event.delayMs} ms` : `${Math.round(event.delayMs / 1000)} s`;
  return `${why} from ${host}: retry ${event.retry} of ${event.maxRetries} in ${wait}`;
}

/**
 * Wrap an async command action with consistent global-option resolution and
 * client construction. The callback receives a context (client + resolved global
 * options + this command's options) and the command's positional arguments.
 *
 * Right before the client is built (so after the option checks and before the first
 * request) it logs one warning (`lebensmittel.http`) when the base URL is plain
 * `http:` to a host other than loopback (cleartextProblem). Help, version and usage
 * errors never reach that point, so they never warn.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    // -o is checked before any request, so nothing is fetched (or waited for) in vain:
    // --force without -o, a directory, an existing file without --force.
    checkOutputTarget(deps, global);
    // `-o -` means stdout: from here on it is the same as no -o.
    if (global.output === "-") delete global.output;
    const cleartext = cleartextProblem(global.baseUrl ?? DEFAULT_BASE_URL);
    if (cleartext !== undefined) logOf(deps).warn("http", cleartext);
    const options = toEngineOptions(global);
    options.onRetry = (event) => logOf(deps).warn("http", retryMessage(event));
    const client = deps.createClient(options);
    await fn({ client, global, opts: command.opts() }, positionals);
  };
}
