// The output sink: everything the CLI writes as data, to stdout or to the `-o` file. One
// place for the rules the maschinenlesbar.org CLIs learned one bug at a time: terminal
// controls escaped, a deep or huge answer printed (or refused) cleanly, `-o` never
// overwriting a file by accident.

import { OutputError, logOf, type CliDeps } from "./io.js";
import { LebensmittelwarnungError } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/errors";

/** The global options that decide where and how a result is written. */
export interface OutputOptions {
  compact?: boolean | undefined;
  output?: string | undefined;
  force?: boolean | undefined;
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

export function refuseOverwrite(path: string): OutputError {
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
function writeOutputFile(deps: CliDeps, global: OutputOptions, path: string, data: Buffer): void {
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
export function renderJson(deps: CliDeps, global: OutputOptions, value: unknown): void {
  const text = escapeControlChars(stringifyJson(value, global.compact === true));
  if (global.output !== undefined && global.output !== "-") {
    const data = Buffer.from(text + "\n", "utf8");
    writeOutputFile(deps, global, global.output, data);
    logOf(deps).info("output", `Wrote ${data.length} bytes to ${global.output}`);
  } else {
    deps.io.out(text);
  }
}

/**
 * JSON.stringify, pretty or compact. An answer nested too deeply (hostile or broken) overflows
 * the stack: an OutputError (exit 1) rather than "Unexpected error: Maximum call stack size
 * exceeded".
 *
 * Compact output takes V8's fast path (no gap) unless the answer holds a huge string: on Node 26
 * the fast path aborts the process ("Zone Allocation failed", exit 134, a native dump on stderr)
 * on a string of some 250 MB that JSON.parse made, while the gap path (an empty gap, the same
 * text) prints it. The fast path stays the default because on Node 26 only it is iterative and
 * prints nesting the gap path refuses (~7,000 levels).
 */
function stringifyJson(value: unknown, compact: boolean): string {
  try {
    if (!compact) return JSON.stringify(value, null, 2);
    return holdsHugeString(value) ? JSON.stringify(value, null, "") : JSON.stringify(value);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    throw new OutputError(
      compact ? "The answer is nested too deeply to print." : "The answer is nested too deeply to pretty-print; try --compact.",
      { cause: err },
    );
  }
}

/** A string or key this long sends --compact through the gap path: a quarter of where Node 26's fast path aborts. */
const HUGE_STRING_LENGTH = 64 * 1024 * 1024;

/** Whether `value` holds a string or key of HUGE_STRING_LENGTH or more. Iterative, so nesting costs no stack. */
function holdsHugeString(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === "string") {
      if (item.length >= HUGE_STRING_LENGTH) return true;
    } else if (typeof item === "object" && item !== null) {
      for (const [key, element] of Object.entries(item)) {
        if (key.length >= HUGE_STRING_LENGTH) return true;
        if (typeof element === "string" || (typeof element === "object" && element !== null)) stack.push(element);
      }
    }
  }
  return false;
}
