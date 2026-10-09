// Shared helpers used across CLI command groups: option parsers, the global
// option resolver, and JSON rendering.

import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import { OutputError, logOf, type CliDeps } from "./io.js";
import type { LebensmittelwarnungClientOptions } from "../client/client.js";
import { LebensmittelwarnungError, LebensmittelwarnungValidationError } from "../client/errors.js";
import {
  baseUrlProblem,
  calendarDateProblem,
  headerValueProblem,
  limitProblem,
  nonBlankProblem,
} from "../client/validate.js";
import { DEFAULT_BASE_URL, cleartextProblem } from "../client/engine.js";

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

/**
 * Escape the control characters JSON.stringify leaves raw. It escapes C0 (including
 * ESC) but not DEL or the C1 range U+0080–U+009F, and terminals may act on those —
 * U+009B is the 8-bit form of CSI. The output is server data, so escape them; the
 * result is equivalent, valid JSON (these characters only occur inside strings).
 * Checked by char code so the source stays free of control bytes.
 */
export function escapeControlChars(json: string): string {
  let result = "";
  let from = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c >= 0x7f && c <= 0x9f) {
      result += json.slice(from, i) + "\\u" + c.toString(16).padStart(4, "0");
      from = i + 1;
    }
  }
  return from === 0 ? json : result + json.slice(from);
}

function refuseOverwrite(path: string): OutputError {
  return new OutputError(
    `Refusing to overwrite existing file "${path}". Pass --force to overwrite, or choose a different --output path.`,
    { usage: true },
  );
}

/**
 * Write bytes to the --output file, refusing to clobber an existing file — or to
 * write through a symlink, dangling or not — unless --force is set (no silent data
 * loss), and wrapping raw filesystem errors in a typed error instead of an untyped
 * "Unexpected error: ENOENT: …". Every failure is an `OutputError`, logged under
 * `lebensmittel.output`; the overwrite refusal is a usage condition (pass --force or
 * pick another path), so it exits 2, any other failure 1.
 */
function writeOutputFile(deps: CliDeps, global: GlobalOptions, path: string, data: Buffer): void {
  const force = global.force === true;
  if (!force && deps.io.fileExists(path)) throw refuseOverwrite(path);
  try {
    // Without --force the write is an exclusive create, so a symlink (even a
    // dangling one) or a file that appeared since the check is refused too.
    deps.io.writeFile(path, data, force);
  } catch (err) {
    if (err instanceof OutputError) throw err;
    // The CliIO's own message ("… is a directory; give a file path to --output.").
    if (err instanceof LebensmittelwarnungError) throw new OutputError(err.message, { cause: err });
    if (!force && (err as NodeJS.ErrnoException | undefined)?.code === "EEXIST") throw refuseOverwrite(path);
    // A bad --output path (missing directory, no permission) is a user error, not
    // an internal fault — surface it cleanly. Drop the `, open '<path>'` tail since
    // we already name the path ourselves; the `s` flag lets it span a path with a line
    // break in it.
    const reason = err instanceof Error ? err.message.replace(/,\s*open\s+'.*'$/s, "") : String(err);
    throw new OutputError(`Could not write to ${path}: ${reason}`, { cause: err });
  }
}

/**
 * Render a JSON value, pretty by default and compact with --compact. Writes to the
 * file given by --output (with a short stderr confirmation so stdout stays clean
 * for piping), or to stdout otherwise (also for `-o -`).
 */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = escapeControlChars(global.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  if (global.output !== undefined && global.output !== "-") {
    const data = Buffer.from(text + "\n", "utf8");
    writeOutputFile(deps, global, global.output, data);
    logOf(deps).info("output", `Wrote ${data.length} bytes to ${global.output}`);
  } else {
    deps.io.out(text);
  }
}

export interface ActionContext {
  client: ReturnType<CliDeps["createClient"]>;
  global: GlobalOptions;
  /** This command's own parsed options. */
  opts: Record<string, unknown>;
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
    // --force only lets -o overwrite a file; on its own it would be ignored.
    if (global.force === true && global.output === undefined) {
      throw new LebensmittelwarnungValidationError("--force needs --output (it only allows overwriting the -o file).");
    }
    // `-o -` means stdout: from here on it is the same as no -o.
    if (global.output === "-") delete global.output;
    // Refuse an existing --output file before any request, so nothing is fetched (or
    // waited for) in vain. writeOutputFile checks again with an exclusive create.
    if (global.output !== undefined && global.force !== true && deps.io.fileExists(global.output)) {
      throw refuseOverwrite(global.output);
    }
    const cleartext = cleartextProblem(global.baseUrl ?? DEFAULT_BASE_URL);
    if (cleartext !== undefined) logOf(deps).warn("http", cleartext);
    const client = deps.createClient(toEngineOptions(global));
    await fn({ client, global, opts: command.opts() }, positionals);
  };
}
