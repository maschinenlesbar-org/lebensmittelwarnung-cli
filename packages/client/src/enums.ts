// The valid `state=` and `type=` query-parameter slugs accepted by the
// lebensmittelwarnung.de RSS feeds, with their German display names.
//
// These are a FIXED, offline vocabulary (confirmed against the portal's RSS-feed
// picker page 2026-07-13). The CLI validates `--state` / `--type` against them so a
// typo fails at parse time (exit 2) rather than silently returning the unfiltered
// feed. Revisit if the portal adds a Land or product type.

/** The sixteen Bundesland slugs the feed's `state=` parameter accepts. */
export const STATE_SLUGS = [
  "badenwuerttemberg",
  "bayern",
  "berlin",
  "brandenburg",
  "bremen",
  "hamburg",
  "hessen",
  "mecklenburgvorpommern",
  "niedersachsen",
  "nordrheinwestfalen",
  "rheinlandpfalz",
  "saarland",
  "sachsen",
  "sachsenanhalt",
  "schleswigholstein",
  "thueringen",
] as const;

export type StateSlug = (typeof STATE_SLUGS)[number];

/** Human-readable Bundesland names, keyed by slug (for help text / display). */
export const STATE_NAMES: Record<StateSlug, string> = {
  badenwuerttemberg: "Baden-Württemberg",
  bayern: "Bayern",
  berlin: "Berlin",
  brandenburg: "Brandenburg",
  bremen: "Bremen",
  hamburg: "Hamburg",
  hessen: "Hessen",
  mecklenburgvorpommern: "Mecklenburg-Vorpommern",
  niedersachsen: "Niedersachsen",
  nordrheinwestfalen: "Nordrhein-Westfalen",
  rheinlandpfalz: "Rheinland-Pfalz",
  saarland: "Saarland",
  sachsen: "Sachsen",
  sachsenanhalt: "Sachsen-Anhalt",
  schleswigholstein: "Schleswig-Holstein",
  thueringen: "Thüringen",
};

/** The product-type slugs the feed's `type=` parameter accepts. */
export const TYPE_SLUGS = [
  "lebensmittel",
  "kosmetischemittel",
  "bedarfsgegenstaende",
  "mittelzumtaetowieren",
  "babyundkinderprodukte",
] as const;

export type TypeSlug = (typeof TYPE_SLUGS)[number];

/** Human-readable product-type names, keyed by slug. */
export const TYPE_NAMES: Record<TypeSlug, string> = {
  lebensmittel: "Lebensmittel",
  kosmetischemittel: "Kosmetische Mittel",
  bedarfsgegenstaende: "Bedarfsgegenstände",
  mittelzumtaetowieren: "Mittel zum Tätowieren",
  babyundkinderprodukte: "Baby- und Kinderprodukte",
};

/** Narrowing guard: is `value` a valid state slug? */
export function isStateSlug(value: string): value is StateSlug {
  return (STATE_SLUGS as readonly string[]).includes(value);
}

/** Narrowing guard: is `value` a valid product-type slug? */
export function isTypeSlug(value: string): value is TypeSlug {
  return (TYPE_SLUGS as readonly string[]).includes(value);
}
