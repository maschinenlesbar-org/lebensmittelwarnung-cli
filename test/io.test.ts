import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultIO } from "../src/cli/io.js";
import { LebensmittelwarnungError } from "../src/client/errors.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "lmw-io-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("fileExists counts a dangling symlink, and an exclusive write never follows it", () => {
  withTempDir((dir) => {
    const target = join(dir, "target.json");
    const link = join(dir, "link.json");
    symlinkSync(target, link);
    assert.equal(defaultIO.fileExists(link), true);
    assert.throws(() => defaultIO.writeFile(link, Buffer.from("x"), false), { code: "EEXIST" });
    assert.equal(existsSync(target), false);
  });
});

test("writeFile without overwrite refuses an existing file; with overwrite replaces it", () => {
  withTempDir((dir) => {
    const path = join(dir, "out.json");
    writeFileSync(path, "old");
    assert.throws(() => defaultIO.writeFile(path, Buffer.from("new"), false), { code: "EEXIST" });
    defaultIO.writeFile(path, Buffer.from("new"), true);
    assert.equal(readFileSync(path, "utf8"), "new");
  });
});

test("a directory as --output names the problem, with and without --force", () => {
  withTempDir((dir) => {
    assert.equal(defaultIO.fileExists(dir), false); // not "refusing to overwrite": --force would not help
    for (const overwrite of [false, true]) {
      assert.throws(
        () => defaultIO.writeFile(dir, Buffer.from("x"), overwrite),
        (err) => err instanceof LebensmittelwarnungError && /is a directory; give a file path to --output\./.test(err.message),
      );
    }
  });
});
