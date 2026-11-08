import { BadRequestException } from "@nestjs/common";

/** "2026-11" → [2026-11-01T00:00Z, 2026-12-01T00:00Z). Fees are reported per UTC calendar month. */
export function monthRange(month: string): { from: Date; to: Date } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new BadRequestException("month must look like 2026-11");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { from: new Date(Date.UTC(year, index, 1)), to: new Date(Date.UTC(year, index + 1, 1)) };
}

/** Rejects anything that isn't a real calendar day like 2026-11-08. */
export function assertDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new BadRequestException("dates must look like 2026-11-08");
  }
  return day;
}

/** Today's date (YYYY-MM-DD) in an IANA time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
