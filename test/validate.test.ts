import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WARNINGS_LIMIT,
  assertValid,
  calendarDateProblem,
  limitProblem,
  nonBlankProblem,
  type Problem,
} from "../src/client/validate.js";
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

// ---- Finding 1: the warnings narrowing rules ----

test("nonBlankProblem rejects a blank or non-string value", () => {
  assert.equal(nonBlankProblem("bio"), undefined);
  assert.equal(nonBlankProblem(" bio "), undefined);
  assert.equal(nonBlankProblem(""), "Expected a non-empty value.");
  assert.equal(nonBlankProblem(" \t "), "Expected a non-empty value.");
  assert.equal(nonBlankProblem(1), "Expected a string.");
});

test("calendarDateProblem accepts real YYYY-MM-DD days only", () => {
  for (const ok of ["2026-09-04", " 2026-09-04 ", "0000-01-01", "0099-12-31", "0004-02-29", "2024-02-29"]) {
    assert.equal(calendarDateProblem(ok), undefined, ok);
  }
  for (const bad of ["10.07.2026", "2026-9-4", "", "2026-09-04T00:00", "20260904"]) {
    assert.equal(calendarDateProblem(bad), "Expected a date in YYYY-MM-DD format.", bad);
  }
  for (const bad of ["2026-02-30", "2026-13-40", "0001-02-29", "0050-13-01", "2026-00-10"]) {
    assert.equal(calendarDateProblem(bad), "Not a valid calendar date.", bad);
  }
  assert.equal(calendarDateProblem(20260904), "Expected a string.");
});

test("limitProblem accepts an integer from 1 to MAX_WARNINGS_LIMIT", () => {
  assert.equal(MAX_WARNINGS_LIMIT, 100000);
  assert.equal(limitProblem(1), undefined);
  assert.equal(limitProblem(MAX_WARNINGS_LIMIT), undefined);
  assert.equal(limitProblem(0), "Must be >= 1.");
  assert.equal(limitProblem(-3), "Must be >= 1.");
  assert.equal(limitProblem(MAX_WARNINGS_LIMIT + 1), "Must be <= 100000.");
  for (const bad of [1.5, Number.NaN, Infinity, "5"]) assert.equal(limitProblem(bad), "Expected an integer.", String(bad));
});
