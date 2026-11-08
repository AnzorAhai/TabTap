import { BadRequestException } from "@nestjs/common";

/** "2026-11" → [2026-11-01T00:00Z, 2026-12-01T00:00Z). Fees are reported per UTC calendar month. */
export function monthRange(month: string): { from: Date; to: Date } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new BadRequestException("month must look like 2026-11");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { from: new Date(Date.UTC(year, index, 1)), to: new Date(Date.UTC(year, index + 1, 1)) };
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
