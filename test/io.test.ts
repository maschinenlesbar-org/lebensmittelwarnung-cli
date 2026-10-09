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

import { EventEmitter } from "node:events";
import { handleOutputErrors, stderrAfterStdout, type OutputStreams } from "../src/cli/io.js";
import { createLogger } from "../src/cli/log.js";

function fakeStreams() {
  const stdout = new EventEmitter();
  const stderr = Object.assign(new EventEmitter(), { write: () => true });
  const exits: number[] = [];
  handleOutputErrors({ stdout, stderr } as unknown as OutputStreams, (code) => void exits.push(code));
  return { stdout, stderr, exits };
}

test("EPIPE on stdout (reader closed early, e.g. | head) exits 0 quietly", () => {
  const s = fakeStreams();
  s.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
  assert.deepEqual(s.exits, [0]);
});

test("another stdout error exits 1; stderr EPIPE is ignored (the run keeps its code), other stderr errors 1", () => {
  const s = fakeStreams();
  s.stdout.emit("error", Object.assign(new Error("write ENOSPC"), { code: "ENOSPC" }));
  s.stderr.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
  s.stderr.emit("error", Object.assign(new Error("write EIO"), { code: "EIO" }));
  assert.deepEqual(s.exits, [1, 1]);
});

test("another stdout write error (a closed descriptor, a full disk) is an ERROR record of lebensmittel.output, in the run's format, and exits 1", () => {
  // Only a reader that has gone is a success; EBADF, ENOSPC or EIO means the output is incomplete.
  const stdout = new EventEmitter();
  const written: string[] = [];
  const stderr = Object.assign(new EventEmitter(), { write: (text: string) => written.push(text) > 0 });
  const exits: number[] = [];
  const records: string[] = [];
  const log = createLogger({ format: "jsonl", write: (line) => records.push(line), now: () => new Date("2026-01-02T03:04:05.678Z") });
  handleOutputErrors({ stdout, stderr } as unknown as OutputStreams, (code) => void exits.push(code), log);
  stdout.emit("error", Object.assign(new Error("write EBADF"), { code: "EBADF" }));
  assert.deepEqual(exits, [1]);
  assert.deepEqual(records.map((line) => JSON.parse(line)), [
    { ts: "2026-01-02T03:04:05.678Z", level: "ERROR", topic: "lebensmittel.output", msg: "Could not write to stdout: write EBADF" },
  ]);
  assert.deepEqual(written, []);
});

test("without a logger, a stdout write error is a text ERROR record on the streams' stderr", () => {
  const stdout = new EventEmitter();
  const written: string[] = [];
  const stderr = Object.assign(new EventEmitter(), { write: (text: string) => written.push(text) > 0 });
  const exits: number[] = [];
  handleOutputErrors({ stdout, stderr } as unknown as OutputStreams, (code) => void exits.push(code));
  stdout.emit("error", Object.assign(new Error("write EBADF"), { code: "EBADF" }));
  assert.deepEqual(exits, [1]);
  assert.equal(written.length, 1);
  assert.match(written[0] ?? "", /^\S+Z ERROR \[lebensmittel\.output\] Could not write to stdout: write EBADF\n$/);
});

test("ENOTCONN (a socket whose reader has gone) is treated like EPIPE: stdout exits 0, stderr is ignored", () => {
  const s = fakeStreams();
  s.stdout.emit("error", Object.assign(new Error("write ENOTCONN"), { code: "ENOTCONN" }));
  s.stderr.emit("error", Object.assign(new Error("write ENOTCONN"), { code: "ENOTCONN" }));
  assert.deepEqual(s.exits, [0]);
});

/** A stdout as far as the hold needs one: a backlog, and the events that end it. */
class FakeStdout extends EventEmitter {
  writableLength = 0;
}

test("stderr waits for stdout: a record is held while stdout has a backlog, and flushed in order (L11)", () => {
  const stdout = new FakeStdout();
  const written: string[] = [];
  const err = stderrAfterStdout(stdout, (text: string) => written.push(text));
  err("first");
  assert.deepEqual(written, ["first"], "no backlog: written at once");
  stdout.writableLength = 65536;
  err("second");
  err("third");
  assert.deepEqual(written, ["first"], "held while stdout has a backlog");
  stdout.writableLength = 0;
  stdout.emit("drain");
  assert.deepEqual(written, ["first", "second", "third"]);
  // Flushed on close and on error too, never lost.
  stdout.writableLength = 10;
  err("fourth");
  stdout.emit("close");
  stdout.writableLength = 10;
  err("fifth");
  stdout.emit("error", new Error("EPIPE"));
  assert.deepEqual(written, ["first", "second", "third", "fourth", "fifth"]);
});
