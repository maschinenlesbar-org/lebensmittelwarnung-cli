// I/O seam for the CLI. Everything the CLI writes goes through a CliIO object so
// tests can capture output instead of hitting the real stdout/stderr/filesystem.

import { lstatSync, statSync, writeFileSync } from "node:fs";
import type { LebensmittelwarnungClient, LebensmittelwarnungClientOptions } from "../client/client.js";
import { LebensmittelwarnungError } from "../client/errors.js";

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
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export const defaultIO: CliIO = {
  out: (text) => process.stdout.write(text + "\n"),
  err: (text) => process.stderr.write(text + "\n"),
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
