// Which column an Appwrite write error names as unknown, e.g.
// `Invalid document structure: Unknown attribute: "athleteId"` → "athleteId".
// Pure (tested in scripts/progression-tests/sprayRouteSave.test.ts).
export function unknownColumn(message: unknown): string | null {
  if (typeof message !== "string") return null
  const m = /unknown (?:attribute|column)[^"'\w]*["']?([A-Za-z0-9_]+)/i.exec(message)
  return m ? m[1] : null
}
