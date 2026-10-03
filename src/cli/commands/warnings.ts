// The command group. `warnings` fetches the RSS feed through the library, which
// narrows it server-side by --state / --type and client-side by --since / --search /
// --limit (see LebensmittelwarnungClient.warnings), and renders JSON. `states` and
// `types` print the valid offline slug vocabularies.
//
// KNOWN BUG CLASS avoided: every value option here is validated. --state / --type
// use commander `.choices()` (an unknown slug fails at parse time, exit 2, rather
// than being silently dropped and returning the full unfiltered feed); --limit,
// --since and --search are parsed with the library's own rules (limitProblem,
// calendarDateProblem, nonBlankProblem), so the CLI and the library agree.

import type { Command } from "commander";
import type { CliDeps } from "../io.js";
import type { StateSlug, TypeSlug, WarningsQuery } from "../../client/types.js";
import {
  STATE_SLUGS,
  STATE_NAMES,
  TYPE_SLUGS,
  TYPE_NAMES,
} from "../../client/enums.js";
import {
  action,
  choiceOption,
  once,
  parseDate,
  parseLimit,
  parseNonEmpty,
  renderJson,
} from "../shared.js";

export function registerCommands(program: Command, deps: CliDeps): void {
  program
    .command("warnings")
    .description(
      "List current product warnings (Rückrufe), optionally narrowed by federal " +
        "state and/or product type",
    )
    // Every option takes one value: a repeat is a usage error rather than "last one
    // wins" (the feed takes one state and one type; there is no union).
    .addOption(choiceOption("--state <state>", "only warnings for this Bundesland", STATE_SLUGS))
    .addOption(choiceOption("--type <type>", "only warnings for this product type", TYPE_SLUGS))
    .option(
      "--limit <n>",
      "return at most this many warnings (in feed order — most recent first)",
      once(parseLimit),
    )
    .option(
      "--since <YYYY-MM-DD>",
      "only warnings whose pubDate (publication or last update) is on or after this date (German time, Europe/Berlin)",
      once(parseDate),
    )
    .option(
      "--search <term>",
      "only warnings whose product name (title or Produktbezeichnung) contains this text (case-insensitive)",
      once(parseNonEmpty),
    )
    .action(
      action(deps, async ({ client, global, opts }) => {
        const query: WarningsQuery = {};
        const state = opts["state"] as StateSlug | undefined;
        const type = opts["type"] as TypeSlug | undefined;
        const since = opts["since"] as string | undefined;
        const search = opts["search"] as string | undefined;
        const limit = opts["limit"] as number | undefined;
        if (state !== undefined) query.state = state;
        if (type !== undefined) query.type = type;
        if (since !== undefined) query.since = since;
        if (search !== undefined) query.search = search;
        if (limit !== undefined) query.limit = limit;

        const warnings = await client.warnings(query);
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
