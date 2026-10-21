// The output sink (src/cli/output.ts, the file seam in io.ts): rendering, `-o` and `--force`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli/run.js";
import { renderJson } from "../src/cli/output.js";
import { OutputError, defaultIO, type CliDeps } from "../src/cli/io.js";
import { LebensmittelwarnungClient } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/client";
import type { HttpRequest, HttpResponse } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/http";
import * as fx from "@maschinenlesbar.org/lebensmittelwarnung-client/test/fixtures";
import { makeMockTransport, rssResponse, untimed } from "./helpers.js";

function makeDeps(): { deps: CliDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(untimed(s)),
    },
    files: {
      state: () => "absent",
      write: () => {
        throw new Error("output.test: no file expected");
      },
    },
    createClient: (opts) => new LebensmittelwarnungClient(opts),
  };
  return { deps, out, err };
}

test("pretty-printing an answer nested too deeply is a clean error that suggests --compact", () => {
  // The feed's warnings are flat, but renderJson takes any value: a nesting the pretty
  // printer's recursion can't take is an OutputError (exit 1), not "Unexpected error:
  // Maximum call stack size exceeded".
  let deep: unknown = "Käse";
  for (let i = 0; i < 200_000; i++) deep = [deep];
  const { deps, out } = makeDeps();
  assert.throws(
    () => renderJson(deps, {}, { fields: deep }),
    (e: unknown) =>
      e instanceof OutputError && !e.usage && e.message === "The answer is nested too deeply to pretty-print; try --compact.",
  );
  assert.deepEqual(out, []);
});

test("--compact takes the gap path only for an answer holding a huge string, the fast path otherwise", (t) => {
  // On Node 26 V8's fast stringifier (no gap) aborts the process on a ~250 MB string that
  // JSON.parse made ("Zone Allocation failed", exit 134); the gap path prints it. Only the fast
  // path is iterative there, though, and prints nesting the gap path refuses at ~7,000 levels.
  // So the path is chosen per answer. Too big a body for this suite: this pins the calls.
  const { deps, out } = makeDeps();
  const stringify = t.mock.method(JSON, "stringify", () => '"stub"');
  const huge = "x".repeat(64 * 1024 * 1024);
  renderJson(deps, { compact: true }, [{ title: "Käse", rawDescription: huge }]);
  renderJson(deps, { compact: true }, [{ title: "Käse", fields: { a: "b" }, rawDescription: huge.slice(1) }]);
  renderJson(deps, { compact: true }, { [huge]: 1 });
  renderJson(deps, { compact: true }, [[huge]]);
  renderJson(deps, {}, [{ title: "Käse" }]);
  const calls = stringify.mock.calls.map((call) => call.arguments);
  stringify.mock.restore();
  assert.deepEqual(calls.map((args) => (args.length >= 3 ? args[2] : "none")), ["", "none", "", "", 2]);
  assert.deepEqual(out, ['"stub"', '"stub"', '"stub"', '"stub"', '"stub"']);
});

test("printed JSON escapes DEL, C1 and the bidi controls, pretty and compact (K10)", () => {
  // JSON.stringify leaves them raw, and a terminal acts on them: U+202E reverses the text
  // after it, U+009B is the 8-bit CSI. Server data, so they are escaped; the JSON is the same.
  const value = [{ title: "Käse \u202eevil\u202c \u2066x\u2069 \u200f\u061c \u007f\u009b end" }];
  for (const compact of [false, true]) {
    const { deps, out } = makeDeps();
    renderJson(deps, { compact }, value);
    const text = out.join("\n");
    assert.match(text, /\\u202e/);
    for (const raw of ["\u202e", "\u202c", "\u2066", "\u2069", "\u200f", "\u061c", "\u007f", "\u009b"]) {
      assert.ok(!text.includes(raw), `U+${raw.charCodeAt(0).toString(16)} printed raw`);
    }
    assert.deepEqual(JSON.parse(text), value);
  }
});

// ---- -o through run(), against real files in a temp dir (K7) ----------------------------
// A write cut short (a full disk) is conformance test P26's.

function makeCli(responder: (req: HttpRequest) => HttpResponse | Promise<HttpResponse> = () => rssResponse(fx.feedXml)) {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(responder);
  const deps: CliDeps = {
    // The fixture feed lacks a required label; that WARN of the api area is not this file's.
    io: { ...defaultIO, out: (s) => out.push(s), err: (s) => void (/\[lebensmittel\.api\]/.test(s) || err.push(untimed(s))) },
    createClient: (opts) => new LebensmittelwarnungClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

/** Run `body` with a fresh temp directory that is always removed. */
async function inTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "lebensmittelwarnung-output-"));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("-o writes what stdout would show, plus a newline, and says so in an INFO record", async () => {
  await inTempDir(async (dir) => {
    const shown = makeCli();
    assert.equal(await run(["warnings"], shown.deps), 0);
    const path = join(dir, "warnings.json");
    const cli = makeCli();
    assert.equal(await run(["-o", path, "warnings"], cli.deps), 0);
    const written = readFileSync(path, "utf8");
    assert.equal(written, `${shown.out.join("\n")}\n`);
    assert.deepEqual(cli.out, []);
    assert.deepEqual(cli.err, [`INFO  [lebensmittel.output] Wrote ${Buffer.byteLength(written)} bytes to ${path}`]);
    assert.deepEqual(readdirSync(dir), ["warnings.json"], "no temporary file is left");
  });
});

test("-o - prints to stdout and creates no file", async () => {
  await inTempDir(async (dir) => {
    const cli = makeCli();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      assert.equal(await run(["--compact", "-o", "-", "warnings"], cli.deps), 0);
      assert.equal(await run(["--compact", "-o", "-", "--force", "states"], cli.deps), 0);
    } finally {
      process.chdir(cwd);
    }
    assert.equal(cli.out.length, 2);
    assert.deepEqual(cli.err, []);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test("a refused -o target is a usage error before any request", async () => {
  await inTempDir(async (dir) => {
    const existing = join(dir, "existing.json");
    writeFileSync(existing, "keep");
    const dangling = join(dir, "dangling.json");
    symlinkSync(join(dir, "nowhere"), dangling);
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const refused = (path: string): string =>
      `ERROR [lebensmittel.output] Refusing to overwrite existing file "${path}". Pass --force to overwrite, or choose a different --output path.`;
    const directory = (path: string): string => `ERROR [lebensmittel.output] "${path}" is a directory; give a file path to --output.`;
    const cases: Array<[string[], string]> = [
      [["-o", "", "warnings"], "Expected a non-empty value."],
      [["-o", "  ", "warnings"], "Expected a non-empty value."],
      [["--force", "warnings"], "ERROR [lebensmittel.cli] --force needs --output (it only allows overwriting the -o file)."],
      [["-o", existing, "warnings"], refused(existing)],
      [["-o", dangling, "warnings"], refused(dangling)],
      [["-o", sub, "warnings"], directory(sub)],
      [["-o", sub, "--force", "warnings"], directory(sub)],
    ];
    for (const [argv, message] of cases) {
      const cli = makeCli();
      assert.equal(await run(argv, cli.deps), 2, argv.join(" "));
      assert.equal(cli.mt.calls.length, 0, `${argv.join(" ")} sent a request`);
      assert.ok(cli.err.some((line) => line.includes(message)), `${argv.join(" ")}: ${cli.err.join(" | ")}`);
    }
    assert.equal(readFileSync(existing, "utf8"), "keep");
    assert.deepEqual(readdirSync(dir).sort(), ["dangling.json", "existing.json", "sub"]);
  });
});

test("--force replaces an existing file, keeps its mode, and writes through a symlink", async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, "out.json");
    writeFileSync(path, "old");
    chmodSync(path, 0o600);
    assert.equal(await run(["--compact", "-o", path, "--force", "warnings"], makeCli().deps), 0);
    assert.equal((JSON.parse(readFileSync(path, "utf8")) as unknown[]).length, 3);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const link = join(dir, "latest.json");
    symlinkSync(path, link);
    assert.equal(await run(["--compact", "-o", link, "--force", "types"], makeCli().deps), 0);
    assert.match(readFileSync(path, "utf8"), /"slug":"lebensmittel"/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir).sort(), ["latest.json", "out.json"]);
  });
});

test("--force to a new path creates the file; over a dangling link it replaces the link with the file", async () => {
  await inTempDir(async (dir) => {
    const fresh = join(dir, "fresh.json");
    assert.equal(await run(["--compact", "-o", fresh, "--force", "warnings"], makeCli().deps), 0);
    assert.equal((JSON.parse(readFileSync(fresh, "utf8")) as unknown[]).length, 3);
    const dangling = join(dir, "dangling.json");
    symlinkSync(join(dir, "nowhere"), dangling);
    assert.equal(await run(["--compact", "-o", dangling, "--force", "warnings"], makeCli().deps), 0);
    assert.equal((JSON.parse(readFileSync(dangling, "utf8")) as unknown[]).length, 3);
    assert.deepEqual(readdirSync(dir).sort(), ["dangling.json", "fresh.json"]);
  });
});

test("a file that appears during the request is not overwritten: exit 1, an ERROR of the output area", async () => {
  await inTempDir(async (dir) => {
    const path = join(dir, "race.json");
    const cli = makeCli(() => {
      writeFileSync(path, "theirs");
      return rssResponse(fx.feedXml);
    });
    assert.equal(await run(["-o", path, "warnings"], cli.deps), 1);
    assert.equal(readFileSync(path, "utf8"), "theirs");
    assert.deepEqual(cli.err, [
      `ERROR [lebensmittel.output] Refusing to overwrite existing file "${path}". Pass --force to overwrite, or choose a different --output path.`,
    ]);
    assert.deepEqual(readdirSync(dir), ["race.json"]);
  });
});

test("a directory that appears during the request is a write failure too: exit 1, an ERROR of the output area", async () => {
  await inTempDir(async (dir) => {
    for (const force of [false, true]) {
      const path = join(dir, `race-dir-${force}`);
      const cli = makeCli(() => {
        mkdirSync(path);
        return rssResponse(fx.feedXml);
      });
      assert.equal(await run(["-o", path, ...(force ? ["--force"] : []), "warnings"], cli.deps), 1, `force ${force}`);
      assert.deepEqual(cli.err, [`ERROR [lebensmittel.output] "${path}" is a directory; give a file path to --output.`]);
      assert.deepEqual(readdirSync(path), []);
    }
  });
});

test("a write the file system refuses is an ERROR of the output area naming the file, exit 1, nothing left", async () => {
  await inTempDir(async (dir) => {
    for (const force of [false, true]) {
      const path = join(dir, "missing-dir", "out.json");
      const cli = makeCli();
      assert.equal(await run(["-o", path, ...(force ? ["--force"] : []), "warnings"], cli.deps), 1);
      assert.equal(cli.err.length, 1);
      assert.equal(cli.err[0], `ERROR [lebensmittel.output] Could not write to "${path}": ENOENT: no such file or directory`);
    }
    assert.deepEqual(readdirSync(dir), []);
  });
});
