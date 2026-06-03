// Sequence (spray-wall route) difficulty model.
//
// A route has an absolute LEVEL (1–8) and a TYPE (base / max bouldering / …),
// plus up to three VARIATIONS of the same climb at relative difficulty:
// easy → original → hard. "original" is the default; easy/hard are optional.
//
// Stored on the route row as a `variations` JSON blob; the legacy `holds` field
// is kept = the original variation's holds for backward compatibility.

import type { PlacedHold } from "@/components/SprayWallBuilder"

// ─── Variations ─────────────────────────────────────────────────────────────────

export type VariationKey = "easy" | "original" | "hard"

// Ordered easiest → hardest.
export const VARIATION_KEYS: VariationKey[] = ["easy", "original", "hard"]

export const VARIATION_LABEL: Record<VariationKey, string> = {
  easy: "Easier",
  original: "Original",
  hard: "Harder",
}

export interface RouteVariations {
  easy?: PlacedHold[]
  original: PlacedHold[]
  hard?: PlacedHold[]
}

// Parse a route row's variations, falling back to the legacy single `holds`
// field as the original when no `variations` blob is present.
export function parseVariations(row: { holds?: string; variations?: string }): RouteVariations {
  if (row.variations) {
    try {
      const v = JSON.parse(row.variations)
      if (v && Array.isArray(v.original)) {
        return {
          easy: Array.isArray(v.easy) && v.easy.length ? v.easy : undefined,
          original: v.original,
          hard: Array.isArray(v.hard) && v.hard.length ? v.hard : undefined,
        }
      }
    } catch {}
  }
  let original: PlacedHold[] = []
  try { original = JSON.parse(row.holds ?? "[]") } catch {}
  return { original }
}

// The variation keys that actually have holds, easiest → hardest. "original" is
// always included (it's the canonical climb).
export function availableVariations(v: RouteVariations): VariationKey[] {
  return VARIATION_KEYS.filter((k) => k === "original" || (v[k]?.length ?? 0) > 0)
}

// Holds for a given variation, falling back to the original.
export function variationHolds(v: RouteVariations, key: VariationKey): PlacedHold[] {
  return (v[key]?.length ? v[key] : v.original) ?? []
}

// Step to the neighboring variation (dir -1 = easier, +1 = harder) among the
// ones that exist. Clamps at the ends.
export function stepVariation(v: RouteVariations, from: VariationKey, dir: -1 | 1): VariationKey {
  const avail = availableVariations(v)
  const i = avail.indexOf(from)
  if (i === -1) return "original"
  const next = i + dir
  if (next < 0 || next >= avail.length) return from
  return avail[next]
}

// ─── Route type & level ─────────────────────────────────────────────────────────

export const ROUTE_TYPES = ["base", "max_bouldering"] as const
export type RouteType = (typeof ROUTE_TYPES)[number]

export const ROUTE_TYPE_LABEL: Record<string, string> = {
  base: "Base",
  max_bouldering: "Max bouldering",
}

export const MIN_LEVEL = 1
export const MAX_LEVEL = 8

export function clampLevel(n: any): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return MIN_LEVEL
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, v))
}
