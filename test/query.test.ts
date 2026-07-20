import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueryString } from "../src/client/query.js";

test("omits undefined and null values", () => {
  assert.equal(buildQueryString({ a: undefined, b: null, c: "x" }), "c=x");
});

test("serialises a single state filter", () => {
  assert.equal(buildQueryString({ state: "bayern" }), "state=bayern");
});

test("serialises combined state + type filters", () => {
  assert.equal(
    buildQueryString({ state: "bayern", type: "lebensmittel" }),
    "state=bayern&type=lebensmittel",
  );
});

test("serialises arrays as repeated keys", () => {
  assert.equal(buildQueryString({ id: ["a", "b"] }), "id=a&id=b");
});

test("encodes spaces as %20 not +", () => {
  assert.equal(buildQueryString({ q: "a b" }), "q=a%20b");
});

test("returns an empty string when nothing survives", () => {
  assert.equal(buildQueryString({ a: undefined }), "");
});
