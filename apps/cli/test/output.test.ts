// The output sink (src/cli/output.ts): rendering JSON to stdout or the `-o` file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderJson } from "../src/cli/output.js";
import { OutputError, type CliDeps } from "../src/cli/io.js";
import { LebensmittelwarnungClient } from "@maschinenlesbar.org/lebensmittelwarnung-client/internal/client";
import { untimed } from "./helpers.js";

function makeDeps(): { deps: CliDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(untimed(s)),
      writeFile: () => {
        throw new Error("output.test: no file expected");
      },
      fileExists: () => false,
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
