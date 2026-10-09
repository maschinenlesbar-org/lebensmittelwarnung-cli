// I/O seam for the CLI. Everything the CLI writes goes through a CliIO object so
// tests can capture output instead of hitting the real stdout/stderr/filesystem.

import { lstatSync, statSync, writeFileSync } from "node:fs";
import type { LebensmittelwarnungClient, LebensmittelwarnungClientOptions } from "../client/client.js";
import { LebensmittelwarnungError } from "../client/errors.js";
import { createLogger, type Logger } from "./log.js";

/**
 * Writing the output to the `-o` file failed or was refused: an existing file without
 * `--force` (`usage`: the usage exit code, 2, as before), a directory, a missing
 * directory, EACCES, … (exit 1). Logged as an ERROR of `lebensmittel.output`.
 */
export class OutputError extends LebensmittelwarnungError {
  /** True for a refusal the user fixes with `--force` or another path (exit 2). */
  readonly usage: boolean;
  constructor(message: string, options?: { cause?: unknown; usage?: boolean }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.usage = options?.usage === true;
  }
}

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  /**
   * Persist bytes to a file (for --output). Without `overwrite` the file must not
   * exist yet (exclusive create): anything at `path` — a file, or a symlink, even a
   * dangling one — makes it throw an `EEXIST` error instead of writing through it.
   */
  writeFile(path: string, data: Buffer, overwrite: boolean): void;
  /**
   * True if a filesystem entry that --force would overwrite already exists at `path`
   * (the --force guard); a dangling symlink counts. A directory does not: --force
   * cannot help there, so the write reports it as a directory instead.
   */
  fileExists(path: string): boolean;
}

export interface CliDeps {
  io: CliIO;
  /** Build a client from the resolved global options (injectable for tests). */
  createClient(options: LebensmittelwarnungClientOptions): LebensmittelwarnungClient;
  /**
   * Where diagnostics go: one record per line on stderr, in the `--log-format`
   * (`log.ts`). `run()` sets it from argv; deps without it log text through `io.err`.
   */
  log?: Logger;
  /** The clock the log's timestamps come from. Unset, the real one. */
  now?: () => Date;
}

/** The deps' logger, or one that writes text records through `io.err`. */
export function logOf(deps: CliDeps): Logger {
  return deps.log ?? createLogger({ format: "text", write: (line) => deps.io.err(line), ...(deps.now === undefined ? {} : { now: deps.now }) });
}

/** The two process streams, as far as `handleOutputErrors` needs them. */
export interface OutputStreams {
  stdout: Pick<NodeJS.WriteStream, "on">;
  stderr: Pick<NodeJS.WriteStream, "on" | "write">;
}

/**
 * Handle write errors on stdout/stderr, which Node otherwise reports as an
 * unhandled 'error' event: a raw stack trace and exit 1.
 *
 * A reader that stops early — `| head`, `| jq` exiting on the first match, a closed
 * pager — closes the pipe while the CLI is still writing, and the next write fails
 * with EPIPE (ENOTCONN when stdout is a socket whose peer has gone, as when a Node
 * parent spawns the CLI with piped stdio on macOS). That is ordinary use, so the
 * process exits 0 at once, quietly. Any other stdout error is an ERROR record of
 * `lebensmittel.output` (`Could not write to stdout: <message>`, through `log`, in the
 * run's format) and exits 1. On stderr an EPIPE is ignored, so a failed run keeps its
 * exit code; any other stderr error exits 1 silently (there is nowhere left to report
 * it). The bin shim installs this once, before `run()`, with a logger for the format
 * argv asks for (`processLogger`); without one, records are text on `streams.stderr`.
 */
export function handleOutputErrors(
  streams: OutputStreams = process,
  exit: (code: number) => void = (code) => process.exit(code),
  log: Pick<Logger, "error"> = createLogger({ format: "text", write: (line) => streams.stderr.write(line + "\n") }),
): void {
  streams.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (readerGone(err)) return exit(0);
    log.error("output", `Could not write to stdout: ${err.message}`);
    exit(1);
  });
  // stderr's reader going away doesn't make a failed run a success: ignore EPIPE there and
  // let the run's own exit code stand (`2>&1 | true` used to turn a usage error into 0).
  streams.stderr.on("error", (err: NodeJS.ErrnoException) => {
    if (!readerGone(err)) exit(1);
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True for the write errors that mean the reader has gone: EPIPE, or ENOTCONN on a socket. */
function readerGone(err: NodeJS.ErrnoException): boolean {
  return err.code === "EPIPE" || err.code === "ENOTCONN";
}

/** What `stderrAfterStdout` needs of stdout: its backlog, and the events that end one. */
export interface StdoutBacklog {
  readonly writableLength: number;
  on(event: "drain" | "close" | "error", listener: () => void): unknown;
}

/** How often a held record checks whether stdout's backlog is gone (ms). */
const BACKLOG_POLL_MS = 10;

/**
 * A stderr writer that waits for stdout. With both streams on one pipe (`2>&1 |`) and a
 * slow reader, stdout's data is still queued in the process while a record is written
 * to stderr at once, so the record landed inside the JSON (at 64 KiB). Here a text is
 * held while `stdout.writableLength > 0` and written, in order, once the backlog is
 * gone: on stdout's `drain`, `close` or `error`, or at the latest when a short poll sees
 * it empty (`drain` only follows a write that returned false). The poll keeps the
 * process alive until then, so a held record is never lost at exit.
 */
export function stderrAfterStdout(stdout: StdoutBacklog, write: (text: string) => void): (text: string) => void {
  const held: string[] = [];
  let poll: ReturnType<typeof setInterval> | undefined;
  const flush = (): void => {
    if (poll !== undefined) clearInterval(poll);
    poll = undefined;
    for (const text of held.splice(0)) write(text);
  };
  let listening = false;
  return (text) => {
    if (held.length === 0 && stdout.writableLength === 0) return write(text);
    held.push(text);
    if (!listening) {
      listening = true;
      for (const event of ["drain", "close", "error"] as const) stdout.on(event, flush);
    }
    poll ??= setInterval(() => {
      if (stdout.writableLength === 0) flush();
    }, BACKLOG_POLL_MS);
  };
}

const stderrLine = stderrAfterStdout(process.stdout, (text) => process.stderr.write(text + "\n"));

export const defaultIO: CliIO = {
  out: (text) => process.stdout.write(text + "\n"),
  // A record never lands inside the data when both streams share a pipe.
  err: stderrLine,
  // "wx" = O_CREAT|O_EXCL: never follows a symlink planted at `path` and closes the
  // gap between the fileExists check and the write.
  writeFile: (path, data, overwrite) => {
    try {
      writeFileSync(path, data, { flag: overwrite ? "w" : "wx" });
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException | undefined)?.code;
      // `wx` answers EEXIST and `w` EISDIR for a directory; --force cannot help there.
      if ((code === "EEXIST" || code === "EISDIR") && isDirectory(path)) {
        throw new LebensmittelwarnungError(`"${path}" is a directory; give a file path to --output.`, { cause });
      }
      throw cause;
    }
  },
  // lstat, not existsSync: existsSync follows a symlink and reports a dangling one
  // as absent, so -o would create a file wherever the link points.
  fileExists: (path) => {
    try {
      return !lstatSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};
