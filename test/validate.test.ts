import { test } from "node:test";
import assert from "node:assert/strict";
import { assertValid, type Problem } from "../src/client/validate.js";
import * as lib from "../src/index.js";
import { LebensmittelwarnungError, LebensmittelwarnungValidationError } from "../src/client/errors.js";
import { LebensmittelwarnungClient } from "../src/client/client.js";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import { parity, rssResponse } from "./helpers.js";
import * as fx from "./fixtures.js";

const nonBlank: Problem<string> = (v) => (v.trim() === "" ? "Expected a non-empty value." : undefined);

test("assertValid returns a valid value unchanged", () => {
  assert.equal(assertValid("search", "Kimchi", nonBlank), "Kimchi");
});

test("assertValid throws LebensmittelwarnungValidationError 'Invalid <name>: <reason>'", () => {
  assert.throws(
    () => assertValid("search", "  ", nonBlank),
    (err: unknown) =>
      err instanceof LebensmittelwarnungValidationError &&
      err instanceof LebensmittelwarnungError &&
      err.message === "Invalid search: Expected a non-empty value.",
  );
});

test("the validation layer is exported from the package root", () => {
  assert.equal(lib.assertValid, assertValid);
  assert.equal(lib.LebensmittelwarnungValidationError, LebensmittelwarnungValidationError);
});

test("run() maps a LebensmittelwarnungValidationError raised in an action to exit 2, 'Error: <message>'", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s), writeFile: () => {}, fileExists: () => false },
    createClient: () => {
      throw new LebensmittelwarnungValidationError("Invalid thing: Expected a non-empty value.");
    },
  };
  assert.equal(await run(["warnings"], deps), 2);
  assert.deepEqual(err, ["Error: Invalid thing: Expected a non-empty value."]);
  assert.deepEqual(out, []);
});

test("parity() runs one input through the CLI and the library on one recording transport", async () => {
  const { cli, lib: l } = await parity(
    ["--compact", "warnings", "--state", "bayern"],
    (transport) => new LebensmittelwarnungClient({ transport }).warnings({ state: "bayern" }),
    () => rssResponse(fx.bayernFeedXml),
  );
  assert.equal(cli.code, 0);
  assert.equal(cli.requests.length, 1);
  assert.equal(l.ok, true);
  assert.equal(l.requests.length, 1);
  assert.deepEqual(cli.requests, l.requests);
  assert.deepEqual(JSON.parse(cli.out), l.ok ? l.value : undefined);
});
