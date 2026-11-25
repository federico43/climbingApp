// Block intro screen (mock-ups 2026-11-25): the mono meta line above the
// Start bar ("4 MIN · 6 ROUNDS · NOSE IN · MOUTH OUT"). Pure.

// A coach note short enough to ride on the meta line instead of a notes
// card: one line, at most SHORT_NOTE_MAX characters. Split at commas,
// semicolons and full stops into the line's parts. null = too long (it goes
// in the notes card).
export const SHORT_NOTE_MAX = 48

export function shortNoteParts(text: string | null | undefined): string[] | null {
  const t = (text ?? "").trim()
  if (!t || t.length > SHORT_NOTE_MAX || /\n/.test(t)) return null
  const parts = t.split(/[,;.]\s*|\s+·\s+/).map((p) => p.trim()).filter(Boolean)
  return parts.length ? parts : null
}

// "4 min", "1h 30 min"; 0 / unset → null.
export function minutesLabel(min: number | null | undefined): string | null {
  const m = Math.round(min ?? 0)
  if (m <= 0) return null
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60} min` : `${h}h`
}

// The meta line: the facts first, then the short note (if any), "·"-joined.
export function introMeta(facts: (string | null | undefined | false)[], note?: string | null): string {
  const parts = facts.filter((f): f is string => !!f)
  const short = shortNoteParts(note)
  return [...parts, ...(short ?? [])].join(" · ")
}
