// Calendar days in German time. The feed stamps notices in local time
// (`Fri, 4 Sep 2026 00:00:00 +0200`), so a date filter compares the day in
// Europe/Berlin, not the UTC day of `published`.

const BERLIN_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day (`YYYY-MM-DD`) of a timestamp in German time (Europe/Berlin), or
 * `undefined` when it doesn't parse. A notice published between midnight and 02:00
 * German time has a UTC instant on the day before; this returns its own day.
 */
export function berlinDay(timestamp: string): string | undefined {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return undefined;
  const parts = BERLIN_DAY.formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (year === undefined || month === undefined || day === undefined) return undefined;
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

const BERLIN_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Berlin's offset from UTC in milliseconds at the instant `ms` (+1 h or +2 h). */
function berlinOffsetMs(ms: number): number {
  const parts = BERLIN_TIME.formatToParts(ms);
  const n = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const local = new Date(0);
  local.setUTCFullYear(n("year"), n("month") - 1, n("day"));
  local.setUTCHours(n("hour"), n("minute"), n("second"), 0);
  return local.getTime() - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant of a wall-clock time, given its offset in minutes, or in German time. */
function instant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  offsetMinutes: number | "berlin",
): number | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  const wall = new Date(0);
  wall.setUTCFullYear(y, mo - 1, d);
  // An impossible day (31 Feb) rolls over: reject it instead.
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d) return undefined;
  wall.setUTCHours(h, mi, s, 0);
  const asUtc = wall.getTime();
  if (offsetMinutes !== "berlin") return asUtc - offsetMinutes * 60_000;
  // German wall-clock time: subtract Berlin's offset at that moment (twice, so a time
  // next to a daylight-saving change takes the offset that applies on its side).
  const first = asUtc - berlinOffsetMs(asUtc);
  return asUtc - berlinOffsetMs(first);
}

/** Month names and abbreviations, English and German, by their first three letters. */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, "mär": 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12,
};

/** Zone names of RFC 822 / RFC 5322 and the German ones, in minutes east of UTC. */
const ZONES: Record<string, number> = {
  z: 0, ut: 0, utc: 0, gmt: 0,
  cet: 60, mez: 60, cest: 120, mesz: 120,
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
};

/** A numeric zone (`+0200`, `-05:00`) or a known zone name in minutes, else undefined. */
function zoneMinutes(zone: string): number | undefined {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (m) {
    const minutes = Number(m[2]) * 60 + Number(m[3]);
    if (Number(m[3]) > 59 || minutes > 14 * 60) return undefined;
    return m[1] === "-" ? -minutes : minutes;
  }
  return Object.hasOwn(ZONES, zone.toLowerCase()) ? ZONES[zone.toLowerCase()] : undefined;
}

const RFC822 =
  /^(?:\p{L}{2,10}\.?,\s*)?(\d{1,2})\.?\s+(\p{L}{3,9})\.?\s+(\d{4}|\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([+-]\d{2}:?\d{2}|\p{L}{1,5}))?$/u;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const GERMAN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*Uhr)?)?$/i;

/**
 * Read a feed `pubDate` into epoch milliseconds, or `undefined` when it isn't one of the
 * forms below. Strict on purpose: `Date.parse` read `02.10.2026 16:52` as 10 February,
 * a zone-less stamp in the host's time zone (so `--since` gave different answers on a
 * Tokyo host), and `CEST`, `MESZ` or German month names not at all.
 *
 * - RFC 822 / RFC 5322, the feed's form: `Fri, 2 Oct 2026 16:52:00 +0200`. The weekday
 *   is optional and not checked; month names may be English or German (`Okt`, `Mär`,
 *   `Dezember`); a two-digit year is 1950–2049; the zone may be numeric, `GMT`/`UT`/
 *   `UTC`/`Z`, `CET`/`MEZ`, `CEST`/`MESZ` or a US zone of RFC 822.
 * - ISO 8601: `2026-10-02T16:52:00+02:00`, `2026-10-02`.
 * - German numeric: `02.10.2026 16:52`, `02.10.2026`.
 *
 * A stamp without a zone is German time (Europe/Berlin), as the portal publishes in.
 */
export function parsePubDate(text: string): number | undefined {
  if (typeof text !== "string") return undefined;
  const value = text.trim().replace(/\s+/g, " ");
  let m = RFC822.exec(value);
  if (m) {
    const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (month === undefined) return undefined;
    let year = Number(m[3]);
    if (m[3]!.length === 2) year += year < 50 ? 2000 : 1900;
    const zone = m[7] === undefined ? "berlin" : zoneMinutes(m[7]);
    if (zone === undefined) return undefined;
    return instant(year, month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), zone);
  }
  m = ISO.exec(value);
  if (m) {
    const zone = m[7] === undefined ? "berlin" : zoneMinutes(m[7]);
    if (zone === undefined) return undefined;
    return instant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), zone);
  }
  m = GERMAN.exec(value);
  if (m) {
    return instant(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), "berlin");
  }
  return undefined;
}
