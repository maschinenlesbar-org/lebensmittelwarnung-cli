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
import { logOf, type CliDeps } from "../io.js";
import type { StateSlug, TypeSlug, Warning, WarningsFilter, WarningsQuery } from "../../client/types.js";
import { filterWarnings, missingLabels } from "../../client/client.js";
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
      "only warnings whose product name (title or Produktbezeichnung) contains this text; case, umlaut spelling (Käse/Kaese), ß/ss and accents don't matter",
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

        // The feed as served (server-side --state/--type only), then the library's own
        // client-side narrowing (filterWarnings: since, search, limit — the order
        // client.warnings() applies), so the CLI can judge the whole feed: a label
        // missing from every item, and the warnings --since can't date.
        const all = await client.warnings(query);
        const missing = missingLabels(all);
        if (missing.length > 0) {
          logOf(deps).warn(
            "api",
            `none of the ${all.length} warning${all.length === 1 ? "" : "s"} in the feed has the ` +
              `description label${missing.length === 1 ? "" : "s"} ${missing.map((l) => `"${l}"`).join(", ")}; ` +
              "a portal-side rename leaves the typed fields empty (the value may sit under another " +
              "label in `fields`), so filters on them may miss recalls.",
          );
        }
        const filter: WarningsFilter = {};
        if (since !== undefined) filter.since = since;
        if (search !== undefined) filter.search = search;
        if (limit !== undefined) filter.limit = limit;
        const warnings: Warning[] = filterWarnings(all, filter);
        if (since !== undefined) {
          const unreadable = all.filter((w) => w.published === undefined).length;
          if (unreadable > 0) {
            logOf(deps).info(
              "api",
              `--since left out ${unreadable} warning${unreadable === 1 ? "" : "s"} whose pubDate ` +
                "could not be read as a date (run without --since to see them).",
            );
          }
        }
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
