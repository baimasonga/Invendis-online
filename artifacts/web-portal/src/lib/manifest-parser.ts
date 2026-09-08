const COMMUNITY_HEADER_ALIASES = new Set([
  "community",
  "community name",
  "location community",
  "community location",
  "beneficiary community",
]);

const NON_ITEM_HEADER_ALIASES = new Set([
  "section",
  "total area",
  "name of association",
  "association name",
  "names of power tiller trainees",
  "power tiller trainees",
]);

export function normalizeManifestHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\/|_-]+/g, " ")
    .replace(/[^a-zA-Z0-9#]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isCommunityManifestHeader(value: unknown): boolean {
  return COMMUNITY_HEADER_ALIASES.has(normalizeManifestHeader(value));
}

export function isNonItemManifestHeader(value: unknown): boolean {
  return NON_ITEM_HEADER_ALIASES.has(normalizeManifestHeader(value));
}

export function inferManifestSingleItem(
  title: string,
  headerRow: unknown[],
): string | null {
  const normalizedTitle = normalizeManifestHeader(title);
  const hasPowerTillerTrainees = headerRow.some((header) => {
    const value = normalizeManifestHeader(header);
    return (
      value === "names of power tiller trainees" ||
      value === "power tiller trainees"
    );
  });

  return normalizedTitle.includes("power tiller distribution plan") ||
    hasPowerTillerTrainees
    ? "Power Tiller"
    : null;
}

export function findManifestHeaderRow(
  rows: unknown[][],
  maximumRowsToScan = 30,
): number {
  const scanLimit = Math.min(rows.length, maximumRowsToScan);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
    if (rows[rowIndex]?.some(isCommunityManifestHeader)) return rowIndex;
  }
  return -1;
}
