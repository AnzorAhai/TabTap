/**
 * One CSV line. Some cells hold text guests typed (bank references, names), so anything a
 * spreadsheet would run as a formula is neutralized with a leading apostrophe.
 */
export function csvLine(cells: readonly (string | number | null)[], separator = ","): string {
  return cells.map((cell) => csvCell(cell, separator)).join(separator);
}

function csvCell(cell: string | number | null, separator: string): string {
  if (cell === null) return "";
  if (typeof cell === "number") return String(cell);
  const safe = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
