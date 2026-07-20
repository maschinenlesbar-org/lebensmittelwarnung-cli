// The command group. `warnings` fetches the RSS feed (optionally narrowed
// server-side by --state / --type) and applies the client-side --limit / --since /
// --search filters before rendering JSON. `states` and `types` print the valid
// offline slug vocabularies.
//
// KNOWN BUG CLASS avoided: every value option here is validated. --state / --type
// use commander `.choices()` (an unknown slug fails at parse time, exit 2, rather
// than being silently dropped and returning the full unfiltered feed); --limit is a
// positive-int parser; --since is a YYYY-MM-DD date parser; --search is non-empty.

import type { Command } from "commander";
import { Option } from "commander";
import type { CliDeps } from "../io.js";
import type { Warning, StateSlug, TypeSlug } from "../../client/types.js";
import {
  STATE_SLUGS,
  STATE_NAMES,
  TYPE_SLUGS,
  TYPE_NAMES,
} from "../../client/enums.js";
import { action, parseBoundedInt, parseDate, parseNonEmpty, renderJson } from "../shared.js";

export function registerCommands(program: Command, deps: CliDeps): void {
  program
    .command("warnings")
    .description(
      "List current product warnings (Rückrufe), optionally narrowed by federal " +
        "state and/or product type",
    )
    .addOption(
      new Option("--state <state>", "only warnings for this Bundesland").choices([...STATE_SLUGS]),
    )
    .addOption(
      new Option("--type <type>", "only warnings for this product type").choices([...TYPE_SLUGS]),
    )
    .option(
      "--limit <n>",
      "return at most this many warnings (in feed order — most recent first)",
      parseBoundedInt(1, 100000),
    )
    .option("--since <YYYY-MM-DD>", "only warnings published on or after this date", parseDate)
    .option("--search <term>", "only warnings whose product title contains this text (case-insensitive)", parseNonEmpty)
    .action(
      action(deps, async ({ client, global, opts }) => {
        const state = opts["state"] as StateSlug | undefined;
        const type = opts["type"] as TypeSlug | undefined;
        const query: { state?: StateSlug; type?: TypeSlug } = {};
        if (state !== undefined) query.state = state;
        if (type !== undefined) query.type = type;

        let warnings = await client.warnings(query);

        // Client-side filters. Guard field types so a filter never silently matches
        // nothing due to an unexpectedly-shaped field.
        const since = opts["since"] as number | undefined;
        if (since !== undefined) {
          warnings = warnings.filter((w: Warning) => {
            if (typeof w.published !== "string") return false;
            const ms = Date.parse(w.published);
            return !Number.isNaN(ms) && ms >= since;
          });
        }

        const search = opts["search"] as string | undefined;
        if (search !== undefined) {
          const needle = search.trim().toLowerCase();
          warnings = warnings.filter(
            (w: Warning) => typeof w.title === "string" && w.title.toLowerCase().includes(needle),
          );
        }

        const limit = opts["limit"] as number | undefined;
        if (limit !== undefined) warnings = warnings.slice(0, limit);

        renderJson(deps, global, warnings);
      }),
    );

  program
    .command("states")
    .description("Print the valid --state slugs (offline)")
    .action(
      action(deps, async ({ global }) => {
        const rows = STATE_SLUGS.map((slug) => ({ slug, name: STATE_NAMES[slug] }));
        renderJson(deps, global, rows);
      }),
    );

  program
    .command("types")
    .description("Print the valid --type product-type slugs (offline)")
    .action(
      action(deps, async ({ global }) => {
        const rows = TYPE_SLUGS.map((slug) => ({ slug, name: TYPE_NAMES[slug] }));
        renderJson(deps, global, rows);
      }),
    );
}
