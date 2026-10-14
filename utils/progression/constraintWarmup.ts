import type { BlockRow, SessionRow } from "@/services/BoulderGraphService"
import { BoulderLevelOptions, colourIndex, shiftColour } from "@/utils/boulderColours"
import {
  CONSTRAINT_WARMUP_RULES,
  DEFAULT_CONSTRAINT_ROTATION,
  type ColourRange,
  type ConstraintRotation,
  type WarmupPillar,
} from "@/utils/progression/profiles"

// Pure rotation engine for constraint warmups — spec §3.5 in
// docs/progression-spec.md and docs/training-plan.md §9.4. Never harder
// across sessions; each warm-up gets 3 constraints (separate blocks):
//   - candidates = constraints tagged with the warm-up's focus group (the
//     training plan's focus, or the coach in the builder; strength and power
//     endurance are one group), minus those used in the last warm-up; least
//     recently used first;
//   - colours ramp [flash − 2, flash − 1, flash], each clamped to that
//     constraint's own range; lower-ceiling constraints take earlier slots;
//   - attempts 3 → 2 → 1.
// No flash level → every constraint on orange (coach 2026-10-03).
// No fetching or UI here — the builder card and the training-plan draft
// share it.

export const WARMUP_PILLAR_LABEL: Record<WarmupPillar, string> = {
  strength_power_endurance: "Strength & power endurance",
  power: "Power",
  technique: "Technique",
  fear_management: "Fear management",
}

// The rotation group for a plan focus / adaptation (strength and power
// endurance share one). Null for anything without warm-up constraints.
export function warmupPillarFor(focus: string | undefined): WarmupPillar | null {
  if (focus === "strength" || focus === "power_endurance" || focus === "strength_power_endurance") return "strength_power_endurance"
  if (focus === "power" || focus === "technique" || focus === "fear_management") return focus
  return null
}

// Stored settings may predate the current groups: "strength" /
// "power_endurance" saved separately read as the merged group, and the
// retired "general" group as technique.
function normalizePillars(pillars: string[]): WarmupPillar[] {
  const out: WarmupPillar[] = []
  for (const p of pillars) {
    const g = p === "general" ? "technique" : warmupPillarFor(p)
    if (g && !out.includes(g)) out.push(g)
  }
  return out
}

export const COLOUR_RANGE_LABEL: Record<ColourRange, string> = {
  two_below_flash: "Two below flash",
  below_flash: "Below flash",
  up_to_flash: "Up to flash",
  any: "Any colour",
}

// "Silent Feet & No Re-Adjustment" → "silentfeetnoreadjustment".
export function constraintKey(name: string | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

// A constraint's rotation settings: its own (edited by the coach), else the
// default table by name. Null = not part of the warm-up rotation — including
// own settings with no pillars (the coach took it out).
export function rotationFor(block: { blockName?: string; rotation?: ConstraintRotation }): ConstraintRotation | null {
  const own = block.rotation
  if (own && Array.isArray(own.pillars) && own.colours) {
    const pillars = normalizePillars(own.pillars)
    return pillars.length > 0 ? { pillars, colours: own.colours } : null
  }
  return defaultRotation(block.blockName)
}

export function defaultRotation(name: string | undefined): ConstraintRotation | null {
  return DEFAULT_CONSTRAINT_ROTATION[constraintKey(name)] ?? null
}

// The colours a range allows for this flash level, easiest first.
export function allowedColours(range: ColourRange, flash: string): string[] {
  const f = colourIndex(flash)
  if (f < 0) return []
  const all = BoulderLevelOptions.map((o) => o.value)
  switch (range) {
    case "any": return all
    case "up_to_flash": return all.slice(0, f + 1)
    case "below_flash": return all.slice(0, f)
    case "two_below_flash": return [shiftColour(flash, -2)]
  }
}

// ─── Candidates ──────────────────────────────────────────────────────────────

export interface WarmupCandidate {
  id: string               // library block id
  name: string
  rotation: ConstraintRotation
}

// The coach's constraint_warmup library blocks that are in the rotation
// (their own settings, or a default by name).
export function warmupCandidates(rows: BlockRow[]): WarmupCandidate[] {
  const out: WarmupCandidate[] = []
  for (const r of rows) {
    if (r.type !== "constraint_warmup") continue
    let data: any = {}
    try { data = JSON.parse(r.data || "{}") } catch { /* name default only */ }
    const rotation = rotationFor({ blockName: r.name, rotation: data?.rotation })
    if (rotation) out.push({ id: r.$id, name: r.name, rotation })
  }
  return out
}

// ─── History ─────────────────────────────────────────────────────────────────

export interface WarmupUsage {
  last: Set<string>             // candidate ids used in the most recent warm-up
  recency: Map<string, number>  // candidate id → sessions ago it was last used (0 = newest)
}

// Which candidates the athlete's past sessions used (newest first, as
// getSessions returns them). A constraint counts as used when its block was
// run (has attempts); matched by library id, else by name.
export function warmupUsage(sessions: SessionRow[], candidates: WarmupCandidate[]): WarmupUsage {
  const byKey = new Map(candidates.map((c) => [constraintKey(c.name), c.id]))
  const ids = new Set(candidates.map((c) => c.id))
  const recency = new Map<string, number>()
  let last: Set<string> | null = null
  let n = 0
  for (const s of sessions) {
    let protocol: any[] = []
    let attempts: any[] = []
    try { protocol = JSON.parse(s.protocol || "[]"); attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    if (!Array.isArray(protocol) || !Array.isArray(attempts)) continue
    const used = new Set<string>()
    protocol.forEach((b, i) => {
      // A coached warm-up (the coach ran it on the fly) didn't do these constraints.
      if (b?.type !== "constraint_warmup" || b.coached || !attempts.some((a) => a?.blockIndex === i)) return
      const id = b.libraryBlockId && ids.has(b.libraryBlockId) ? b.libraryBlockId : byKey.get(constraintKey(b.blockName))
      if (id) used.add(id)
    })
    if (used.size === 0) continue
    if (!last) last = used
    for (const id of used) if (!recency.has(id)) recency.set(id, n)
    n++
  }
  return { last: last ?? new Set(), recency }
}

// Usage as it will be once a planned warm-up has been done — so a series of
// suggested workouts chains: workout 2's warm-up avoids workout 1's, etc.
export function afterWarmup(usage: WarmupUsage, picks: WarmupPick[] | null): WarmupUsage {
  if (!picks || picks.length === 0) return usage
  const recency = new Map<string, number>()
  for (const [id, n] of usage.recency) recency.set(id, n + 1)
  for (const p of picks) recency.set(p.id, 0)
  return { last: new Set(picks.map((p) => p.id)), recency }
}

// ─── Suggestion ──────────────────────────────────────────────────────────────

export interface WarmupPick {
  id: string
  name: string
  colour: string
  attempts: number
}

// The colour every constraint is done on when the athlete has no flash level.
export const NO_FLASH_COLOUR = "orange"

// Null when nothing can be suggested (no candidates for this group).
export function suggestWarmup(
  candidates: WarmupCandidate[],
  pillar: WarmupPillar,
  usage: WarmupUsage,
  flash: string | null | undefined,
): WarmupPick[] | null {
  const { count, attempts, rampBelowFlash } = CONSTRAINT_WARMUP_RULES
  const hasFlash = colourIndex(flash) >= 0

  const pool = candidates.filter((c) =>
    c.rotation.pillars.includes(pillar)
    && (!hasFlash || allowedColours(c.rotation.colours, flash!).length > 0)
  )
  // Least recently used first (never used = oldest), then name.
  const age = (c: WarmupCandidate) => usage.recency.get(c.id) ?? Number.POSITIVE_INFINITY
  const byAge = (a: WarmupCandidate, b: WarmupCandidate) => age(b) - age(a) || a.name.localeCompare(b.name)
  const fresh = pool.filter((c) => !usage.last.has(c.id)).sort(byAge)
  // Not enough fresh ones → reuse last time's, least recent first.
  const reused = pool.filter((c) => usage.last.has(c.id)).sort(byAge)
  const chosen = [...fresh, ...reused].slice(0, count)
  if (chosen.length === 0) return null

  if (!hasFlash) {
    return chosen.map((c, slot) => ({ id: c.id, name: c.name, colour: NO_FLASH_COLOUR, attempts: attempts[slot] ?? 1 }))
  }
  const f = flash!

  // Lower-ceiling constraints take the easier slots (stable on ties).
  const ceiling = (c: WarmupCandidate) => {
    const allowed = allowedColours(c.rotation.colours, f)
    return colourIndex(allowed[allowed.length - 1])
  }
  const ordered = chosen.map((c, i) => ({ c, i })).sort((a, b) => ceiling(a.c) - ceiling(b.c) || a.i - b.i).map((x) => x.c)

  return ordered.map((c, slot) => {
    // Slot targets climb to flash: [flash − 2, flash − 1, flash] (floor orange).
    const target = colourIndex(shiftColour(f, -Math.max(0, rampBelowFlash - slot)))
    const allowed = allowedColours(c.rotation.colours, f)
    const fit = [...allowed].reverse().find((col) => colourIndex(col) <= target) ?? allowed[0]
    return { id: c.id, name: c.name, colour: fit, attempts: attempts[slot] ?? 1 }
  })
}
