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
