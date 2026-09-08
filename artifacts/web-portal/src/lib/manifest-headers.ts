/**
 * Header matching for the dispatch manifest import.
 *
 * Header cells arrive from spreadsheets people maintain by hand, so they carry
 * trailing spaces, non-breaking spaces, line breaks, trailing colons and
 * asterisks, and inconsistent wording. Matching them with `=== "community"`
 * rejects files that are perfectly readable to a person, so every comparison
 * goes through the same normaliser and an alias list.
 */

export function normaliseHeader(cell: unknown): string {
  return String(cell ?? "")
    .replace(/ /g, " ") // non-breaking space, common in pasted headers
    .replace(/\s+/g, " ")
    .replace(/[:*.]+$/, "")
    .trim()
    .toLowerCase();
}

export const HEADER_ALIASES = {
  district: ["district", "district name"],
  chiefdom: ["chiefdom", "chiefdom name"],
  community: [
    "community",
    "community name",
    "communities",
    "community/village",
    "community / village",
    "village",
    "village name",
    "town",
    "settlement",
    "farmer group",
    "group name",
  ],
  distribution: [
    "distribution",
    "distribution site",
    "delivery site",
    "distribution point",
    "delivery point",
  ],
  contactPhone: [
    "contact #",
    "contact no",
    "contact number",
    "contact phone",
    "phone",
    "phone number",
    "mobile",
    "mobile number",
    "tel",
  ],
  rowNumber: ["no", "s/n", "sn", "#", "serial", "item no"],
} as const;

/** Index of the first cell whose normalised text is one of `aliases`. */
export function headerIndex(row: unknown[] | undefined, aliases: readonly string[]): number {
  if (!row) return -1;
  return row.findIndex((cell) => aliases.includes(normaliseHeader(cell)));
}

/** Index of the first cell whose normalised text contains `needle`. */
export function headerIndexContaining(row: unknown[] | undefined, needle: string): number {
  if (!row) return -1;
  return row.findIndex((cell) => normaliseHeader(cell).includes(needle));
}

/**
 * Locates the header row: the first row carrying a recognisable Community
 * column. Scans well beyond the first few rows because these files often open
 * with a title block, a logo row and several blank lines.
 */
export function findHeaderRow(rows: unknown[][], scanLimit = 50): number {
  const limit = Math.min(rows.length, scanLimit);
  for (let r = 0; r < limit; r++) {
    if (headerIndex(rows[r] as unknown[], HEADER_ALIASES.community) >= 0) return r;
  }
  return -1;
}

/**
 * Every non-empty header-ish cell seen while scanning, so a failure can tell
 * the user what the file actually contains instead of only what is missing.
 */
export function describeScannedHeaders(rows: unknown[][], scanLimit = 50): string {
  const seen: string[] = [];
  const limit = Math.min(rows.length, scanLimit);
  for (let r = 0; r < limit; r++) {
    for (const cell of (rows[r] as unknown[]) ?? []) {
      const text = String(cell ?? "").replace(/\s+/g, " ").trim();
      if (text && text.length <= 40 && !seen.includes(text)) seen.push(text);
    }
  }
  return seen.slice(0, 12).join(", ");
}
