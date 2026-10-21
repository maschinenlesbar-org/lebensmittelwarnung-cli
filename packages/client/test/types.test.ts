// Compile-time checks of the exported library types: a consumer under the strictest compiler
// settings, and the runtime rule they rely on (undefined means omitted).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LebensmittelwarnungClient, filterWarnings, type Warning } from "../src/index.js";
import { feedXml } from "./fixtures.js";
import { makeMockTransport, rssResponse } from "./helpers.js";

// Runs the TypeScript compiler over a consumer file.
const STARTS_A_PROCESS = { timeout: 30_000 };
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.js", import.meta.url));

test("a consumer with the strictest compiler settings can pass undefined for any option", STARTS_A_PROCESS, async () => {
  // Under exactOptionalPropertyTypes, `{ baseUrl: process.env.X }` fails to compile against an
  // option declared `?: string`, although the runtime treats undefined as omitted.
  const dir = mkdtempSync(join(tmpdir(), "lebensmittelwarnung-types-"));
  try {
    writeFileSync(
      join(dir, "use.ts"),
      [
        `import { LebensmittelwarnungClient, filterWarnings, type EngineOptions, type WarningsQuery, type WarningsFilter } from ${JSON.stringify(INDEX)};`,
        "declare function allUndefined<T>(): { [K in keyof T]-?: undefined };",
        "export const options: EngineOptions = allUndefined<EngineOptions>();",
        "export const query: WarningsQuery = allUndefined<WarningsQuery>();",
        "export const filter: WarningsFilter = allUndefined<WarningsFilter>();",
        "export const client = new LebensmittelwarnungClient({ baseUrl: process.env.LEBENSMITTEL_BASE_URL, timeoutMs: 15_000 });",
        "export const titles = async (): Promise<(string | undefined)[]> =>",
        "  filterWarnings(await client.warnings({ state: undefined, search: process.env.SEARCH }), { limit: undefined }).map((w) => w.title);",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          noEmit: true,
          skipLibCheck: false,
          types: ["node"],
          typeRoots: [join(ROOT, "node_modules/@types")],
        },
        files: ["use.ts"],
      }),
    );
    const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout + stderr }),
      );
    });
    assert.equal(result.code, 0, result.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an option given as undefined means its default, as an omitted one does", async () => {
  const mt = makeMockTransport(() => rssResponse(feedXml));
  const client = new LebensmittelwarnungClient({
    baseUrl: undefined,
    userAgent: undefined,
    defaultHeaders: undefined,
    timeoutMs: undefined,
    maxRetries: undefined,
    retryDelayMs: undefined,
    maxResponseBytes: undefined,
    sleep: undefined,
    onRetry: undefined,
    transport: mt.transport,
  });
  const all = await client.warnings({ state: undefined, type: undefined, since: undefined, search: undefined, limit: undefined });
  assert.equal(mt.last().url, "https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/rssnewsfeed_Alle_DE.xml");
  assert.equal(mt.last().headers?.["User-Agent"], "lebensmittelwarnung-cli");
  assert.ok(all.length > 0);
  const same: Warning[] = filterWarnings(all, { since: undefined, search: undefined, limit: undefined });
  assert.deepEqual(same, all);
});
