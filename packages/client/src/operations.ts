// The use cases of the skills as library functions, built on the client: each carries the traps
// the skills document, so no caller (the CLI, the MCP server's tools, a library user) has to know
// them.
// - searchRecalls: is there a recall for this product? Searches the product names, then widens to
//   every text field before it answers "no listed recall matched", naming the terms it searched
//   (lebensmittelwarnung-recalls);
// - listRecalls: the listed recalls by Land (the distribution list) or by issuing Land, product
//   type, reason category and date, newest first (lebensmittelwarnung-regional,
//   lebensmittelwarnung-produkttyp, and the recalls skill's "anything current?");
// - countRecalls: counts per reason, product type, Land, issuer or year, each count on its own
//   (lebensmittelwarnung-produkttyp);
// - getRecall: one notice in full, by its id.
// Every recall carries the citation the portal prescribes, the German date of its last update,
// the date the notice was issued and the issuing Land (both from the notice's URL).

import { searchForms, type LebensmittelwarnungClient } from "./client.js";
import { berlinDay } from "./dates.js";
import { STATE_NAMES, STATE_SLUGS, TYPE_NAMES, TYPE_SLUGS, type StateSlug, type TypeSlug } from "./enums.js";
import { LebensmittelwarnungValidationError, quoteValue } from "./errors.js";
import type { Warning, WarningImage } from "./types.js";
import { assertValid, calendarDateProblem, normalizeText, textProblem } from "./validate.js";

/** The categories the feed's "Grund der Meldung" uses (all of them on 2026-11-19); a notice can join several with ", ". */
export const REASON_CATEGORIES = [
  "Allergene",
  "Fremdkörper",
  "Gesundheitsschädliche Substanz",
  "Irreführung und Täuschung",
  "Krankheitserreger",
  "Rückstände und Kontaminanten",
  "Sonstige Gründe",
] as const;

export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

/** The issuers a notice's URL names: the Länder by their usual code, and the BVL. */
export const ISSUERS = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
  BVL: "Bundesamt für Verbraucherschutz und Lebensmittelsicherheit",
} as const;

export type IssuerCode = keyof typeof ISSUERS;

/** The second sentence of the citation the portal prescribes; once per answer. */
export const CITATION_NOTE =
  "Diese Informationen sind über das Portal „lebensmittelwarnung.de“ der Länder und des Bundesamtes für Verbraucherschutz und Lebensmittelsicherheit kostenfrei abrufbar.";

/** The options of every use case: the clock "today" and "the last N days" are read from. */
export interface OperationOptions {
  now?: (() => Date) | undefined;
}

// ---- names to slugs and codes -------------------------------------------------------------

/** A name as it is compared: folded twice (searchForms), without spaces, hyphens and dots. */
function keysOf(text: string): string[] {
  const forms = searchForms(text);
  return [...new Set([forms.transliterated, forms.plain].map((form) => form.replace(/[\s.\-_/]+/g, "")))];
}

/** Other names people use for a Land (codes, English), folded as {@link keysOf} does. */
const STATE_ALIASES: Record<string, StateSlug> = {
  bw: "badenwuerttemberg",
  by: "bayern",
  bavaria: "bayern",
  be: "berlin",
  bb: "brandenburg",
  hb: "bremen",
  hh: "hamburg",
  he: "hessen",
  hesse: "hessen",
  mv: "mecklenburgvorpommern",
  meckpomm: "mecklenburgvorpommern",
  mecklenburgwesternpomerania: "mecklenburgvorpommern",
  ni: "niedersachsen",
  lowersaxony: "niedersachsen",
  nw: "nordrheinwestfalen",
  nrw: "nordrheinwestfalen",
  northrhinewestphalia: "nordrheinwestfalen",
  rp: "rheinlandpfalz",
  rlp: "rheinlandpfalz",
  rhinelandpalatinate: "rheinlandpfalz",
  sl: "saarland",
  sn: "sachsen",
  saxony: "sachsen",
  st: "sachsenanhalt",
  saxonyanhalt: "sachsenanhalt",
  sh: "schleswigholstein",
  th: "thueringen",
  thuringia: "thueringen",
};

/**
 * The feed's slug for a Land given as its slug, its name (any case, with or without umlauts or
 * hyphens), its code (BY, NRW) or its English name (Bavaria). Anything else is a validation error
 * that lists the Länder: the feed answers an unknown slug with an error, never with all warnings.
 */
export function resolveState(text: string): StateSlug {
  const value = normalizeText(assertValid("state", text, textProblem));
  for (const key of keysOf(value)) {
    const slug = STATE_SLUGS.find((s) => s === key || keysOf(STATE_NAMES[s]).includes(key)) ?? STATE_ALIASES[key];
    if (slug !== undefined) return slug;
  }
  throw new LebensmittelwarnungValidationError(`Invalid state: ${quoteValue(value)} is not a Land. Give one of ${STATE_SLUGS.map((s) => STATE_NAMES[s]).join(", ")} (a name, a code such as BY or NRW, or the slug).`);
}

/** Words for each product type, folded: a type is matched when its slug or one of these is part of what was given. */
const TYPE_WORDS: [TypeSlug, string[]][] = [
  ["mittelzumtaetowieren", ["taetowier", "tatowier", "tattoo"]],
  ["babyundkinderprodukte", ["baby", "kinder", "kind", "child", "infant"]],
  ["kosmetischemittel", ["kosmet", "cosmetic"]],
  ["bedarfsgegenstaende", ["bedarf", "consumergood", "foodcontact", "kitchen", "kueche"]],
  ["lebensmittel", ["lebensmittel", "food", "nahrung", "getraenk", "drink"]],
];

/**
 * The feed's slug for a product type given as its slug, its German name or a word for it
 * ("Kosmetik", "cosmetics", "Tattoo", "Babyprodukte", "food"). Anything else is a validation
 * error that lists the five types.
 */
export function resolveType(text: string): TypeSlug {
  const value = normalizeText(assertValid("type", text, textProblem));
  for (const key of keysOf(value)) {
    const exact = TYPE_SLUGS.find((s) => s === key || keysOf(TYPE_NAMES[s]).includes(key));
    if (exact !== undefined) return exact;
    const found = TYPE_WORDS.find(([, words]) => words.some((word) => key.includes(word)));
    if (found !== undefined) return found[0];
  }
  throw new LebensmittelwarnungValidationError(`Invalid type: ${quoteValue(value)} is not a product type. Give one of ${TYPE_SLUGS.map((s) => `${TYPE_NAMES[s]} (${s})`).join(", ")}.`);
}

/** Words the feed never uses, for the category it files them under (folded, as parts of a word). */
const REASON_WORDS: [ReasonCategory, string[]][] = [
  ["Krankheitserreger", ["salmonell", "listeri", "ecoli", "ehec", "stec", "norovir", "hepatitis", "bakteri", "bacteri", "keim", "pathogen", "virus", "viren", "erreger", "bacillus", "clostridi"]],
  ["Allergene", ["allergen", "allergie", "allergy", "gluten", "milch", "milk", "laktose", "lactose", "nuss", "nuts", "erdnuss", "peanut", "soja", "soy", "sesam", "senf", "mustard", "sellerie", "celery", "lupine", "krebstier", "crustacean", "sulfit", "sulphite", "weizen", "wheat", "undeclared", "undeklariert"]],
  ["Fremdkörper", ["fremdkoerper", "fremdkorper", "foreignbod", "glas", "glass", "metall", "metal", "kunststoff", "plastik", "plastic", "splitter", "stein", "stone", "holz", "wood"]],
  ["Rückstände und Kontaminanten", ["rueckstand", "ruckstand", "rueckstaende", "kontamin", "contamin", "residue", "pestizid", "pesticide", "ethylenoxid", "ethyleneoxide", "aflatoxin", "mykotoxin", "mycotoxin", "ochratoxin", "schwermetall", "heavymetal", "blei", "cadmium", "quecksilber", "mercury", "arsen", "dioxin", "pyrrolizidin", "tropanalkaloid"]],
  ["Gesundheitsschädliche Substanz", ["gesundheitsschaedlich", "gesundheitsschadlich", "harmful", "chrom", "nickel", "formaldehyd", "weichmacher", "phthalat", "sildenafil", "arznei", "drug", "toxic", "giftig"]],
  ["Irreführung und Täuschung", ["irrefuehr", "irrefuhr", "taeusch", "tauschung", "mislead", "deceptive", "falschdeklar"]],
  ["Sonstige Gründe", ["sonstig"]],
];

/** What {@link resolveReason} gives: the category, and how the word given maps to it. */
export interface ReasonMatch {
  category: ReasonCategory;
  /** Set when the word given is not the category itself ("Salmonellen" -> Krankheitserreger). */
  mappedFrom?: string;
}

/**
 * The reason category ("Grund der Meldung") a word belongs to. The feed files every notice under
 * one of seven categories (several joined with ", ") and never names the pathogen or allergen:
 * "Salmonellen" appears nowhere, so it is mapped to Krankheitserreger, "Erdnuss" to Allergene,
 * "Glas" to Fremdkörper. A word of no category is a validation error that lists the seven.
 */
export function resolveReason(text: string): ReasonMatch {
  const value = normalizeText(assertValid("reason", text, textProblem));
  for (const key of keysOf(value)) {
    const exact = REASON_CATEGORIES.find((c) => keysOf(c).includes(key));
    if (exact !== undefined) return { category: exact };
  }
  for (const key of keysOf(value)) {
    const found = REASON_WORDS.find(([, words]) => words.some((word) => key.includes(word)));
    if (found !== undefined) return { category: found[0], mappedFrom: value };
  }
  throw new LebensmittelwarnungValidationError(`Invalid reason: ${quoteValue(value)} is no reason category. The feed files every notice under one of: ${REASON_CATEGORIES.join(", ")} (a pathogen such as Salmonellen is a Krankheitserreger, an undeclared allergen Allergene).`);
}

/** The issuer's code for a Land (as {@link resolveState} reads it), its code, or the BVL ("BVL", "Bund"). */
export function resolveIssuer(text: string): IssuerCode {
  const value = normalizeText(assertValid("issuer", text, textProblem));
  const upper = value.toUpperCase();
  if (upper in ISSUERS) return upper as IssuerCode;
  if (keysOf(value).some((key) => ["bvl", "bund", "deutschland", "germany", "bundesamt"].some((word) => key.startsWith(word)))) return "BVL";
  const name = STATE_NAMES[resolveState(value)];
  return (Object.keys(ISSUERS) as IssuerCode[]).find((code) => ISSUERS[code] === name) ?? "BVL";
}

// ---- one recall ---------------------------------------------------------------------------

/** What a notice's URL tells: its id (the folder), the day it was issued and the issuing Land. */
export interface NoticeInfo {
  /** The notice's folder name, unique in the feed ("261113_16_NI_Leberwurst_fein,_100_Gramm"). */
  id?: string;
  /** The day the notice was issued (YYYY-MM-DD), from the folder name's YYMMDD or YYYYMMDD. */
  noticeDate?: string;
  /** The issuing Land's code (BY, NW …) or BVL, from the folder or file name. */
  issuer?: IssuerCode;
}

const ISSUER_IN_NAME = /^(?:\d{6}|\d{8})(?:_\d+)?_([A-Z]{2,3})_/;

/** The id, the issuing day and the issuer of a notice, read from its URL (a naming convention, not data). */
export function noticeInfo(link: string | undefined): NoticeInfo {
  if (link === undefined) return {};
  let path: string;
  try {
    path = decodeURIComponent(new URL(link).pathname);
  } catch {
    return {};
  }
  const [folder, file] = path.split("/").slice(-2);
  if (folder === undefined || folder === "") return {};
  const info: NoticeInfo = { id: folder };
  const day = /^(\d{6}|\d{8})_/.exec(folder)?.[1];
  if (day !== undefined) {
    const iso = day.length === 6 ? `20${day.slice(0, 2)}-${day.slice(2, 4)}-${day.slice(4, 6)}` : `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    if (calendarDateProblem(iso) === undefined) info.noticeDate = iso;
  }
  for (const name of [folder, file ?? ""]) {
    const code = ISSUER_IN_NAME.exec(name)?.[1];
    if (code !== undefined && code in ISSUERS) {
      info.issuer = code as IssuerCode;
      break;
    }
  }
  return info;
}

/** The last day of a month, as YYYY-MM-DD. */
function monthEnd(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** German month names and their usual short forms, folded to lower case, by month number. */
const MONTH_NAMES: [RegExp, number][] = [
  [/^jan(uar)?$/, 1],
  [/^feb(ruar)?$/, 2],
  [/^(märz|maerz|mär|mrz)$/, 3],
  [/^apr(il)?$/, 4],
  [/^mai$/, 5],
  [/^jun[i]?$/, 6],
  [/^jul[i]?$/, 7],
  [/^aug(ust)?$/, 8],
  [/^sep(t|tember)?$/, 9],
  [/^okt(ober)?$/, 10],
  [/^nov(ember)?$/, 11],
  [/^dez(ember)?$/, 12],
];

/**
 * The latest date a best-before text names (YYYY-MM-DD): "04.12.2026", "04/05/2027" and
 * "04-06-2027" (day first), "2028/1/1" (year first), "07.2028", "EXP 10-2027", "07/2030",
 * "bis 7/26" (month and a two-digit year after 2012) and "März/2028" (a month: its last day).
 * Undefined when the text names none ("alle noch gültigen Mindesthaltbarkeitsdaten") or only
 * a form that could be either ("12/11": a day and month, or a month and year).
 */
export function latestBestBefore(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const dates: string[] = [];
  const day = (y: string, m: string, d: string): void => {
    const iso = `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (calendarDateProblem(iso) === undefined) dates.push(iso);
  };
  const month = (y: number, m: number): void => {
    if (m >= 1 && m <= 12) dates.push(monthEnd(y, m));
  };
  // Each form is taken out of the text once read, so a later, shorter form doesn't read its parts again.
  let rest = text.replace(/(?<!\d)(\d{4})([./-])(\d{1,2})\2(\d{1,2})(?!\d)/g, (_, y: string, _sep: string, m: string, d: string) => {
    day(y, m, d);
    return " ";
  });
  rest = rest.replace(/(?<!\d)(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/g, (_, d: string, _sep: string, m: string, y: string) => {
    day(y, m, d);
    return " ";
  });
  rest = rest.replace(/(?<![\d.])(\d{1,2})[./-](\d{4})(?!\d)/g, (_, m: string, y: string) => {
    month(Number(y), Number(m));
    return " ";
  });
  rest = rest.replace(/(?<![\d./-])(\d{1,2})\/(\d{2})(?![\d./-])/g, (all: string, m: string, y: string) => {
    if (Number(y) <= 12) return all; // "12/11": a day and month as well; not guessed
    month(2000 + Number(y), Number(m));
    return " ";
  });
  for (const match of rest.matchAll(/(?<!\p{L})(\p{L}{3,9})\.?[\s./-]*(\d{4})(?!\d)/gu)) {
    const name = (match[1] ?? "").toLowerCase();
    const found = MONTH_NAMES.find(([pattern]) => pattern.test(name));
    if (found !== undefined) month(Number(match[2]), found[1]);
  }
  return dates.sort().at(-1);
}

/** One recall as the use cases answer it. */
export interface Recall {
  /** The notice's id (its folder name): getRecall takes it. */
  id?: string;
  /** The product name: the citation's Produkttitel. */
  title?: string;
  /** Produktbezeichnung, when it says more than the title. */
  product?: string;
  /** Grund der Meldung: one or more categories, as served. */
  reason?: string;
  manufacturer?: string;
  /** True when the notice lists all 16 Länder (then affectedStates is left out). */
  nationwide: boolean;
  /** Where it was sold (Betroffene Bundesländer), unless nationwide. */
  affectedStates?: string[];
  /** The codes to match on the pack: a recall is batch-specific. */
  lotNumbers?: string;
  bestBefore?: string;
  /** The latest date bestBefore names, read from its text. */
  bestBeforeUntil?: string;
  /** True when that date is before today: the product is likely gone from the shelves. */
  bestBeforePassed?: boolean;
  packaging?: string;
  /** The German day of pubDate: when the notice was published or last updated (YYYY-MM-DD). */
  date?: string;
  /** The day the notice was issued, from its URL (YYYY-MM-DD). */
  noticeDate?: string;
  /**
   * True when date is more than 3 days after noticeDate: the notice was updated, it is not a new
   * recall (most are published within 3 days of the day they were issued).
   */
  updated?: boolean;
  /** The issuing Land's code, or BVL, from the notice's URL. */
  issuer?: IssuerCode;
  issuerName?: string;
  /** The official notice. */
  link?: string;
  /** The citation the portal prescribes: "Portal www.lebensmittelwarnung.de, Jahr: Titel, URL, Stand: Datum." */
  citation: string;
}

/** A recall with everything the notice has: every field, the images with their credits. */
export interface RecallDetail extends Recall {
  /** Every label of the notice with its value (a superset of the fields above, e.g. Kontakt). */
  fields: Record<string, string>;
  /** The product images, each with its credit; copyright-protected, not free to reuse. */
  images?: WarningImage[];
  pubDate?: string;
}

/** Today in German time (YYYY-MM-DD). */
function today(options: OperationOptions | undefined): string {
  const now = options?.now?.() ?? new Date();
  return berlinDay(now.toISOString()) ?? now.toISOString().slice(0, 10);
}

/** DD.MM.YYYY of a YYYY-MM-DD day. */
const german = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

/** Days after the day a notice was issued within which its date counts as its publication, not an update. */
const UPDATE_AFTER_DAYS = 3;

/** Whole days from one YYYY-MM-DD day to another. */
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A warning as the use cases answer it, with its citation; `day` is today (German time). */
export function recallOf(warning: Warning, day: string): Recall {
  const info = noticeInfo(warning.link);
  const date = warning.published === undefined ? undefined : berlinDay(warning.published);
  const states = warning.affectedStates ?? [];
  const nationwide = STATE_SLUGS.every((slug) => states.includes(STATE_NAMES[slug]));
  const until = latestBestBefore(warning.bestBefore);
  const title = warning.title ?? warning.product;
  const year = (info.noticeDate ?? date ?? day).slice(0, 4);
  return {
    ...(info.id === undefined ? {} : { id: info.id }),
    ...(title === undefined ? {} : { title }),
    ...(warning.product !== undefined && warning.product !== title ? { product: warning.product } : {}),
    ...(warning.reason === undefined ? {} : { reason: warning.reason }),
    ...(warning.manufacturer === undefined ? {} : { manufacturer: warning.manufacturer }),
    nationwide,
    ...(nationwide || states.length === 0 ? {} : { affectedStates: states }),
    ...(warning.lotNumbers === undefined ? {} : { lotNumbers: warning.lotNumbers }),
    ...(warning.bestBefore === undefined ? {} : { bestBefore: warning.bestBefore }),
    ...(until === undefined ? {} : { bestBeforeUntil: until, bestBeforePassed: until < day }),
    ...(warning.packaging === undefined ? {} : { packaging: warning.packaging }),
    ...(date === undefined ? {} : { date }),
    ...(info.noticeDate === undefined ? {} : { noticeDate: info.noticeDate }),
    ...(date !== undefined && info.noticeDate !== undefined ? { updated: daysBetween(info.noticeDate, date) > UPDATE_AFTER_DAYS } : {}),
    ...(info.issuer === undefined ? {} : { issuer: info.issuer, issuerName: ISSUERS[info.issuer] }),
    ...(warning.link === undefined ? {} : { link: warning.link }),
    citation: `Portal www.lebensmittelwarnung.de, ${year}: ${title ?? "(ohne Titel)"}, ${warning.link ?? "https://www.lebensmittelwarnung.de"}, Stand: ${german(date ?? day)}.`,
  };
}

// ---- the filters every list shares ---------------------------------------------------------

/** The filters of {@link listRecalls}, {@link searchRecalls} and {@link countRecalls}, ANDed. */
export interface RecallFilter {
  /** Sold in this Land (its name is in affectedStates), whoever issued it: a name, code or slug. */
  state?: string | undefined;
  /** Product type: a slug, name or word (Kosmetik, Tattoo, Baby). */
  type?: string | undefined;
  /** Reason category, or a word filed under one (Salmonellen -> Krankheitserreger). */
  reason?: string | undefined;
  /** Issued by this Land (or BVL), judged by the code in the notice's URL. */
  issuer?: string | undefined;
  /** Published or updated on this day (YYYY-MM-DD, German time) or later. */
  since?: string | undefined;
  /** Published or updated in the last N days (1-3650), today included. */
  days?: number | undefined;
}

/** The filters as they were applied, by their names. */
export interface Searched {
  state?: string;
  type?: string;
  reason?: string;
  issuer?: string;
  since?: string;
  terms?: string[];
}

interface Resolved {
  state?: StateSlug;
  type?: TypeSlug;
  reason?: ReasonMatch;
  issuer?: IssuerCode;
  since?: string;
  searched: Searched;
  notes: string[];
}

/** Every filter checked and resolved before any request. */
function resolveFilter(filter: RecallFilter, options: OperationOptions | undefined): Resolved {
  const resolved: Resolved = { searched: {}, notes: [] };
  if (filter.state !== undefined) {
    resolved.state = resolveState(filter.state);
    resolved.searched.state = STATE_NAMES[resolved.state];
    resolved.notes.push(`state is where a product was sold (Betroffene Bundesländer), whoever issued the notice: most recalls list all 16 Länder. For what ${STATE_NAMES[resolved.state]} itself issued, use issuer.`);
  }
  if (filter.type !== undefined) {
    resolved.type = resolveType(filter.type);
    resolved.searched.type = TYPE_NAMES[resolved.type];
  }
  if (filter.reason !== undefined) {
    resolved.reason = resolveReason(filter.reason);
    resolved.searched.reason = resolved.reason.category;
    if (resolved.reason.mappedFrom !== undefined) {
      resolved.notes.push(`The feed gives only the reason category: ${quoteValue(resolved.reason.mappedFrom)} is filed under ${resolved.reason.category}, which covers more than that. The notice (link) names the detail.`);
    }
  }
  if (filter.issuer !== undefined) {
    resolved.issuer = resolveIssuer(filter.issuer);
    resolved.searched.issuer = ISSUERS[resolved.issuer];
    resolved.notes.push("The issuer is read from the Land code in the notice's URL (a naming convention, not a field of the feed).");
  }
  if (filter.since !== undefined && filter.days !== undefined) throw new LebensmittelwarnungValidationError("Invalid date: give since or days, not both.");
  if (filter.since !== undefined) resolved.since = assertValid("since", filter.since, calendarDateProblem).trim();
  if (filter.days !== undefined) {
    assertValid("days", filter.days, (n) => (Number.isSafeInteger(n) && n >= 1 && n <= 3650 ? undefined : "Expected a whole number from 1 to 3650."));
    const now = options?.now?.() ?? new Date();
    resolved.since = berlinDay(new Date(now.getTime() - (filter.days - 1) * 86_400_000).toISOString());
  }
  if (resolved.since !== undefined) {
    resolved.searched.since = resolved.since;
    resolved.notes.push("A date is when the notice was published or last updated: updated marks an old notice updated since (noticeDate is when it was issued); call it new only when updated is false.");
  }
  return resolved;
}

/** The warnings of the feed narrowed by `resolved` (state and type on the server, the rest here). */
async function fetchRecalls(client: LebensmittelwarnungClient, resolved: Resolved, day: string, type = resolved.type): Promise<Recall[]> {
  const warnings = await client.warnings({
    ...(resolved.state === undefined ? {} : { state: resolved.state }),
    ...(type === undefined ? {} : { type }),
    ...(resolved.since === undefined ? {} : { since: resolved.since }),
  });
  return warnings
    .filter((w) => resolved.reason === undefined || (w.reason ?? "").split(",").map((r) => r.trim()).includes(resolved.reason.category))
    .map((w) => recallOf(w, day))
    .filter((r) => resolved.issuer === undefined || r.issuer === resolved.issuer);
}

/** A page of a list: `offset` 0-10000, `limit` 1-100. */
function pageOf<T>(items: readonly T[], offset: number | undefined, limit: number | undefined, defaultLimit: number): { page: T[]; nextOffset?: number } {
  const start = assertValid("offset", offset ?? 0, (n) => (Number.isSafeInteger(n) && n >= 0 && n <= 10_000 ? undefined : "Expected a whole number from 0 to 10000."));
  const size = assertValid("limit", limit ?? defaultLimit, (n) => (Number.isSafeInteger(n) && n >= 1 && n <= 100 ? undefined : "Expected a whole number from 1 to 100."));
  const page = items.slice(start, start + size);
  return { page, ...(start + page.length < items.length ? { nextOffset: start + page.length } : {}) };
}

/** What an empty list says about itself: valid, not an error, and what to change. */
function emptyReason(resolved: Resolved): string {
  const hints = [
    resolved.type === "mittelzumtaetowieren" ? "The tattoo-ink feed is often empty." : undefined,
    resolved.since !== undefined ? "Widen the date (since, days)." : undefined,
    resolved.issuer !== undefined && resolved.state === undefined ? "issuer is who issued the notice; state is where it was sold." : undefined,
  ].filter((hint) => hint !== undefined);
  return ["No listed recall matches these filters. That is a valid answer (nothing matches right now), not an error.", ...hints].join(" ");
}

// ---- the use cases ----------------------------------------------------------------------

/** The input of {@link listRecalls}. */
export interface ListRecallsInput extends RecallFilter {
  offset?: number | undefined;
  /** 1-100, default 20. */
  limit?: number | undefined;
}

/** The answer of {@link listRecalls}, {@link searchRecalls}: a page of recalls, newest first. */
export interface RecallList {
  status: "ok" | "empty";
  searched: Searched;
  /** How many match in all. */
  total: number;
  recalls: Recall[];
  nextOffset?: number;
  reason?: string;
  notes: string[];
  /** The citation's second sentence, to add once below the recalls quoted. */
  citationNote: string;
}

/**
 * The recalls the portal lists, newest first (by the date they were published or last updated),
 * narrowed by Land (where the product was sold), issuing Land, product type, reason category and
 * date. Without a date the list goes back years (to 2018): it is not "the current recalls".
 */
export async function listRecalls(client: LebensmittelwarnungClient, input: ListRecallsInput = {}, options?: OperationOptions): Promise<RecallList> {
  const resolved = resolveFilter(input, options);
  const day = today(options);
  const recalls = await fetchRecalls(client, resolved, day);
  const { page, nextOffset } = pageOf(recalls, input.offset, input.limit, 20);
  const notes = [...resolved.notes];
  if (resolved.since === undefined && recalls.length > 0) {
    notes.push(`The portal still lists recalls back to ${recalls.at(-1)?.date ?? "years ago"}: these are not all current. For "aktuell" use days or since; bestBeforePassed marks products past their best-before.`);
  }
  if (recalls.length === 0) return { status: "empty", searched: resolved.searched, total: 0, recalls: [], reason: emptyReason(resolved), notes, citationNote: CITATION_NOTE };
  const reason = page.length === 0 ? pastEndReason(input.offset ?? 0, recalls.length, input.limit ?? 20) : undefined;
  return { status: "ok", searched: resolved.searched, total: recalls.length, recalls: page, ...(nextOffset === undefined ? {} : { nextOffset }), ...(reason === undefined ? {} : { reason }), notes, citationNote: CITATION_NOTE };
}

/** What a page at or past the end of a list of `total` says: there is nothing more, and where the last page starts. */
function pastEndReason(offset: number, total: number, limit: number): string {
  return `offset ${offset} is past the end: ${total} recalls match (offsets 0 to ${total - 1}). This page is empty because nothing comes after them, not because nothing matched; ask for offset ${Math.max(0, total - limit)} for the last ${Math.min(limit, total)}.`;
}

/** The input of {@link searchRecalls}. */
export interface SearchRecallsInput extends RecallFilter {
  /** The product, or a word of its name: best its German stem ("Erdnuss", "Käse"). */
  product: string;
  /** More words to search at once: a synonym in German and English, the brand (at most 8). */
  alsoSearch?: string[] | undefined;
  /** 1-100, default 10. */
  limit?: number | undefined;
}

/** The answer of {@link searchRecalls}: a list, and where the terms were found. */
export interface RecallSearch extends RecallList {
  /** name: in a product name (title or Produktbezeichnung); text: only in another field, the search was widened. */
  matchedIn?: "name" | "text";
}

/** Endings dropped once to get a word's stem ("Erdnüsse" -> "Erdnüss", "Tahini" -> "Tahin", "Würstchen" -> "Würst"). */
const ENDINGS = ["chen", "innen", "ern", "en", "er", "es", "e", "n", "s", "i"];

/** The terms searched: each given, and for a single word its stem too. */
export function searchTerms(product: string, alsoSearch: readonly string[] = []): string[] {
  const terms: string[] = [];
  for (const text of [product, ...alsoSearch]) {
    const term = normalizeText(text);
    terms.push(term);
    if (/^\p{L}+$/u.test(term)) {
      const ending = ENDINGS.find((e) => term.toLowerCase().endsWith(e) && term.length - e.length >= 4);
      if (ending !== undefined) terms.push(term.slice(0, term.length - ending.length));
    }
  }
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = searchForms(term).transliterated;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The words of a notice's URL: its folder and file name, "_" as spaces ("…_Butter_Erdnuss_Taler…"). */
function urlWords(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  try {
    return decodeURIComponent(new URL(link).pathname).split("/").slice(-2).join(" ").replace(/_/g, " ");
  } catch {
    return undefined;
  }
}

/** True when one of `texts` contains one of the terms, folded (case, umlaut spelling, ß, accents don't matter). */
function containsAny(texts: readonly (string | undefined)[], terms: readonly ReturnType<typeof searchForms>[]): boolean {
  return texts.some((text) => {
    if (text === undefined) return false;
    const forms = searchForms(text);
    return terms.some((t) => forms.transliterated.includes(t.transliterated) || forms.plain.includes(t.plain));
  });
}

/**
 * Is there a recall for this product? The terms (the product, its stem, alsoSearch) are searched
 * in the product names first; when none matches, in every text field (reason, manufacturer, every
 * field of the notice, and the notice's URL, whose folder often carries the product words). A
 * search is a substring match of one word form: the answer names the terms searched, so an empty
 * one ("no listed recall matched") can be judged and widened.
 */
export async function searchRecalls(client: LebensmittelwarnungClient, input: SearchRecallsInput, options?: OperationOptions): Promise<RecallSearch> {
  assertValid("product", input.product, textProblem);
  const also = input.alsoSearch ?? [];
  assertValid("alsoSearch", also, (list) => (Array.isArray(list) && list.length <= 8 ? undefined : "Expected at most 8 words."));
  also.forEach((word, i) => assertValid(`alsoSearch[${i}]`, word, textProblem));
  const terms = searchTerms(input.product, also);
  const forms = terms.map((term) => searchForms(term));
  const resolved = resolveFilter(input, options);
  const day = today(options);
  const warnings = await client.warnings({
    ...(resolved.state === undefined ? {} : { state: resolved.state }),
    ...(resolved.type === undefined ? {} : { type: resolved.type }),
    ...(resolved.since === undefined ? {} : { since: resolved.since }),
  });
  const narrowed = warnings.filter(
    (w) =>
      (resolved.reason === undefined || (w.reason ?? "").split(",").map((r) => r.trim()).includes(resolved.reason.category)) &&
      (resolved.issuer === undefined || noticeInfo(w.link).issuer === resolved.issuer),
  );
  const searched = { ...resolved.searched, terms };
  const byName = narrowed.filter((w) => containsAny([w.title, w.product], forms));
  const matches = byName.length > 0 ? byName : narrowed.filter((w) => containsAny([w.reason, w.manufacturer, ...Object.values(w.fields), urlWords(w.link)], forms));
  const notes = [...resolved.notes, "A recall is batch-specific: match lotNumbers and bestBefore with the pack before saying an item is affected."];
  if (matches.length === 0) {
    const reason = `No listed recall matched ${terms.map((t) => quoteValue(t)).join(", ")} in the product names or any other field (reason, manufacturer, every field of the notice, the notice's URL). Before answering "no recall", search the German stem, singular and plural, a synonym in German and English, and the brand (alsoSearch); the portal is authoritative.`;
    return { status: "empty", searched, total: 0, recalls: [], reason, notes, citationNote: CITATION_NOTE };
  }
  const recalls = matches.map((w) => recallOf(w, day));
  const { page, nextOffset } = pageOf(recalls, undefined, input.limit, 10);
  if (byName.length === 0) notes.unshift("No product name contains the terms: these matched another field (manufacturer, the notice's text or URL); check each before calling it a recall of the product.");
  return { status: "ok", searched, matchedIn: byName.length > 0 ? "name" : "text", total: recalls.length, recalls: page, ...(nextOffset === undefined ? {} : { nextOffset }), notes, citationNote: CITATION_NOTE };
}

/** What {@link countRecalls} groups by. */
export const GROUP_BY = ["reason", "type", "state", "issuer", "year"] as const;
export type RecallGroupBy = (typeof GROUP_BY)[number];

/** The input of {@link countRecalls}. */
export interface CountRecallsInput extends RecallFilter {
  groupBy: RecallGroupBy;
}

/** The answer of {@link countRecalls}. */
export interface RecallCounts {
  status: "ok" | "empty";
  searched: Searched;
  groupBy: RecallGroupBy;
  /** How many recalls match in all: take the total from here, never from the sum of the groups. */
  total: number;
  /** Largest first. */
  groups: { key: string; count: number }[];
  reason?: string;
  notes: string[];
}

const count = (keys: readonly string[]): Map<string, number> => keys.reduce((acc, key) => acc.set(key, (acc.get(key) ?? 0) + 1), new Map<string, number>());

/**
 * How many recalls per reason category, product type, Land (where sold), issuing Land or year
 * the notice was issued. The groups don't add up to the total: a notice with two reasons counts
 * under both, a product can be listed under two types (a baby spoon is also a consumer good), a
 * notice lists every Land it was sold in. The total is counted once, from the same feed.
 * By type it asks the feed once per type (five requests) besides the total, and lists every type,
 * one with no recall as 0.
 */
export async function countRecalls(client: LebensmittelwarnungClient, input: CountRecallsInput, options?: OperationOptions): Promise<RecallCounts> {
  const groupBy = assertValid("groupBy", input.groupBy, (g) => ((GROUP_BY as readonly unknown[]).includes(g) ? undefined : `Expected one of ${GROUP_BY.join(", ")}.`));
  if (groupBy === "type" && input.type !== undefined) throw new LebensmittelwarnungValidationError("Invalid type: counting by type takes no type filter.");
  const resolved = resolveFilter(input, options);
  const day = today(options);
  const all = await fetchRecalls(client, resolved, day);
  const notes = [...resolved.notes];
  let groups: Map<string, number>;
  if (groupBy === "type") {
    groups = new Map();
    for (const slug of TYPE_SLUGS) groups.set(TYPE_NAMES[slug], (await fetchRecalls(client, resolved, day, slug)).length);
    notes.push("Types overlap (a baby product is often also listed as Lebensmittel or Bedarfsgegenstand): the counts add up to more than total. Report each on its own; every type is listed, a 0 too (tattoo inks are often 0).");
  } else if (groupBy === "reason") {
    groups = count(all.flatMap((r) => (r.reason ?? "(none)").split(",").map((part) => part.trim())));
    notes.push("A notice with several reasons counts under each: the counts add up to more than total.");
  } else if (groupBy === "state") {
    groups = count(all.flatMap((r) => (r.nationwide ? Object.values(STATE_NAMES) : (r.affectedStates ?? []))));
    notes.push("A notice counts in every Land it was sold in (most list all 16): this is distribution, not who issued it (groupBy issuer).");
  } else if (groupBy === "issuer") {
    groups = count(all.map((r) => (r.issuer === undefined ? "(unknown)" : `${r.issuer} ${ISSUERS[r.issuer]}`)));
    notes.push("The issuer is read from the Land code in the notice's URL (a naming convention, not a field of the feed).");
  } else {
    groups = count(all.map((r) => (r.noticeDate ?? r.date ?? "(unknown)").slice(0, 4)));
    notes.push("By the year the notice was issued (its URL), else of its date.");
  }
  const sorted = [...groups].map(([key, n]) => ({ key, count: n })).filter((g) => g.count > 0 || groupBy === "type").sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "de"));
  if (all.length === 0) return { status: "empty", searched: resolved.searched, groupBy, total: 0, groups: sorted, reason: emptyReason(resolved), notes };
  return { status: "ok", searched: resolved.searched, groupBy, total: all.length, groups: sorted, notes };
}

/** The answer of {@link getRecall}. */
export type RecallLookup =
  | { status: "ok"; searched: { id: string }; recall: RecallDetail; citationNote: string }
  | { status: "empty"; searched: { id: string }; reason: string };

/** An id as it is compared: percent-escapes decoded, slashes and spaces around dropped, folded to lower case. */
function idKey(id: string): string {
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // a malformed escape: compared as given
  }
  return decoded.replace(/^[\s/]+|[\s/]+$/g, "").normalize("NFC").toLowerCase();
}

/**
 * One notice in full, by its id (from the other answers) or its URL: every field (Kontakt …), the
 * images with their credits. The id is compared without case, percent-encoding and slashes around
 * it. An id no notice in the feed has is answered as such: only a notice that was in the feed
 * before and is gone was withdrawn, and whoever reused it must delete it too (the portal's terms).
 */
export async function getRecall(client: LebensmittelwarnungClient, input: { id: string }, options?: OperationOptions): Promise<RecallLookup> {
  const given = normalizeText(assertValid("id", input.id, textProblem));
  const asked = /^https?:\/\//i.test(given) ? (noticeInfo(given).id ?? given) : given;
  const key = idKey(asked);
  const day = today(options);
  const warning = (await client.warnings()).find((w) => {
    const id = noticeInfo(w.link).id;
    return id !== undefined && idKey(id) === key;
  });
  if (warning === undefined) {
    return {
      status: "empty",
      searched: { id: asked },
      reason: "No notice in the feed has this id: check it against an id from searchRecalls or listRecalls (compared without case, percent-encoding and slashes). Only a notice that was in the feed before and is gone now was withdrawn by the portal; whoever reused that one must delete it too.",
    };
  }
  const id = noticeInfo(warning.link).id ?? asked;
  const recall: RecallDetail = {
    ...recallOf(warning, day),
    fields: warning.fields,
    ...(warning.images === undefined ? {} : { images: warning.images }),
    ...(warning.pubDate === undefined ? {} : { pubDate: warning.pubDate }),
  };
  return { status: "ok", searched: { id }, recall, citationNote: CITATION_NOTE };
}
