import { BoulderLevelOptions, colourIndex } from "@/utils/boulderColours"

// The athlete's flash colour from their Density test (coach 2026-11-10).
// The Density test (exploration_session block) logs one attempt per boulder:
// its colour (in `notes`, "<colour label> · <go label>"), the wall and the go
// it went on (`tries`: 1 = flash), or not sent. Tests from before the wall
// and "Not sent" were added only have the notes — and only tops.
// The coach sees the colour it gives and confirms it (never applied alone).
// Pure: no React Native imports.

// Flashes at a colour that make it the athlete's flash colour.
export const DENSITY_FLASHES_FOR_COLOUR = 4

export const DENSITY_BLOCK_TYPE = "exploration_session"

export interface DensityClimb {
  colour: string
  wall?: string
  tries: number // the go it went on (3 = "3+"); for a boulder that didn't go, 3
  sent: boolean
}

// The gym colour of a niveles_boulder label ("Blue", "Azul", …), or null.
const SPANISH: Record<string, string> = {
  naranja: "orange", azul: "blue", verde: "green", amarillo: "yellow", amarilla: "yellow", rojo: "red", roja: "red", negro: "black", negra: "black",
}
export function colourFromLabel(label: string | null | undefined): string | null {
  const l = (label ?? "").trim().toLowerCase()
  if (!l) return null
  const hit = BoulderLevelOptions.find((o) => o.value === l || o.label.toLowerCase() === l)
  return hit?.value ?? SPANISH[l] ?? null
}

// The go a notes' second part names: "Flash" 1, "2nd go" 2, "3+" 3.
function triesFromLabel(label: string): number {
  const l = label.trim().toLowerCase()
  if (l.startsWith("flash")) return 1
  if (l.startsWith("2")) return 2
  return 3
}

// The Density test boulders in one session's attempts.
export function densityClimbs(attempts: any[]): DensityClimb[] {
  const out: DensityClimb[] = []
  for (const a of attempts) {
    if (a?.type !== DENSITY_BLOCK_TYPE || typeof a.notes !== "string") continue
    const [colourLabel, goLabel = ""] = a.notes.split(" · ")
    const colour = colourFromLabel(colourLabel)
    if (!colour) continue
    const sent = a.success !== false
    const tries = typeof a.tries === "number" && a.tries > 0 ? Math.min(a.tries, 3) : sent ? triesFromLabel(goLabel) : 3
    out.push({ colour, ...(a.wall ? { wall: a.wall } : {}), tries, sent })
  }
  return out
}

// The newest session with Density test boulders in it: when, and the climbs.
export function latestDensityTest(sessions: { $createdAt: string; attempts: string }[]): { at: string; climbs: DensityClimb[] } | null {
  const sorted = [...sessions].sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))
  for (const s of sorted) {
    let attempts: any[] = []
    try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    if (!Array.isArray(attempts)) continue
    const climbs = densityClimbs(attempts)
    if (climbs.length > 0) return { at: s.$createdAt, climbs }
  }
  return null
}

export interface DensityColourSummary {
  colour: string
  flashes: number
  sent: number
  tried: number
}

// Per colour, easiest first: flashes, tops and boulders tried.
export function densitySummary(climbs: DensityClimb[]): DensityColourSummary[] {
  return BoulderLevelOptions
    .map((o) => {
      const here = climbs.filter((c) => c.colour === o.value)
      return {
        colour: o.value,
        flashes: here.filter((c) => c.sent && c.tries === 1).length,
        sent: here.filter((c) => c.sent).length,
        tried: here.length,
      }
    })
    .filter((s) => s.tried > 0)
}

// The hardest colour with at least `min` flashes; null when none has.
export function densityFlashColour(climbs: DensityClimb[], min = DENSITY_FLASHES_FOR_COLOUR): string | null {
  let best: string | null = null
  for (const s of densitySummary(climbs)) {
    if (s.flashes >= min && colourIndex(s.colour) > colourIndex(best)) best = s.colour
  }
  return best
}
