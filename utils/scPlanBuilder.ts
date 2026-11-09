import type { Exercise, StrengthConditioningBlock } from "@/components/workoutBlocks"
import type { ExerciseRow, SessionRow } from "@/services/BoulderGraphService"
import { MOVEMENT_TYPE_LABEL, skipsExplosiveness, type MovementType } from "@/utils/movementTypes"
import { noPowerFocusFor, type PlanShape, type ScPattern, type WorkoutSpec } from "@/utils/planRotation"
import { needsWarmup } from "@/utils/edgeWarmup"
import { FOCUS_LABEL, FOCUS_REP_RANGE, type Focus } from "@/utils/scProgression"
import { startingLevelRow } from "@/utils/scPrefill"

// The S&C part of a training-plan workout (docs/training-plan.md §9.5). Not
// a library template: generated from the plan's 1–4 movement patterns plus
// mobility (the coach's chosen exercises, or app-picked), with every exercise programmed for the day's S&C focus
// (core and joints: their own max force ↔ hypertrophy cycle).
//   · 2–4 patterns: one of each pattern's two exercises per workout, done as
//     circuits of two (patterns 1+2, 3+4; a 3rd pattern alone).
//   · 1 pattern: both its exercises every workout, done by sets — all
//     rounds of one, then all rounds of the other (coach 2026-11-04).
//   · 0 patterns (mobility only): just the mobility. A ladder exercise is prescribed at the step the
// athlete's history puts them on — the same rule as the workout's prefill
// (utils/scPrefill.ts), so both name the same exercise. Load and reps then
// progress from the athlete's history as for any S&C block
// (utils/scHistory.ts, utils/scProgression.ts). Pure — no fetching or UI.

export type ExerciseDraft = Omit<Exercise, "id">
export type ScBlockDraft = Omit<StrengthConditioningBlock, "id" | "exercises"> & { exercises: ExerciseDraft[] }

export const SC_PLAN_RULES = {
  rounds: 3,
  restWithMobility: 60,      // blocks 1–2: the mobility exercise is the rest
  restMobilityBlock: 30,     // block 3, mobility only
  restHypertrophy: 120,      // no mobility
  restOther: 180,            // no mobility, max force / power
} as const

// Exercises that replace the plan's pick for a pattern on a given focus,
// found by exact library name (coach 2026-10-03). Fingers (carry_grip) has
// no picks of its own — it's always one of these.
export const SPECIAL_CASE_EXERCISES: Partial<Record<MovementType, Partial<Record<Focus, string>>>> = {
  carry_grip: { max_force: "Edge Lifts", hypertrophy: "repeaters", explosiveness: "Jumps to Catch" },
  squat: { explosiveness: "Jumps into box" },
}

// A library exercise as it goes into a block (no local id) — shared with the
// builder's exerciseFromLibrary in components/workoutBlocks.tsx.
export function exerciseDraftFromLibrary(ex: ExerciseRow): ExerciseDraft {
  const base = {
    type: ex.type, name: ex.name, exerciseId: ex.$id, unit: ex.unit ?? "reps",
    photoUri: ex.photoUri, notes: ex.notes,
    movementType: ex.movementType, loadMode: ex.loadMode ?? "weight", levels: ex.levels, loadStep: ex.loadStep ?? undefined,
    settingHarder: ex.settingHarder || undefined, settingEasier: ex.settingEasier || undefined,
  }
  // A rep-counted target comes from focus (set in the block editor, not
  // here) — left blank until then. A timed target has no focus-driven
  // range to fall back on, so it still uses the library's own default.
  // Mobility has no focus, so its target is always the library default.
  if (ex.type === "7/3s") return { ...base, edge: ex.defaultEdge ?? "20mm", series: ex.defaultSeries ?? 6 }
  if (ex.unit === "seconds") return { ...base, reps: ex.defaultReps ?? "20-30" }
  return { ...base, reps: ex.movementType === "mobility" ? (ex.defaultReps ?? "") : "" }
}

// Whether an exercise can be programmed for a focus — exercises with no
// `focuses` set work for all three.
export function fitsFocus(ex: ExerciseRow, focus: Focus): boolean {
  return !ex.focuses || ex.focuses.length === 0 || ex.focuses.includes(focus)
}

// The exercise programmed for a focus: rep-counted targets follow the
// focus's rep range, as the block editor does when a focus is picked.
function withFocus(ex: ExerciseDraft, focus: Focus): ExerciseDraft {
  const isRepCounted = (ex.type === "reps" || ex.type === "both_sides") && ex.unit !== "seconds"
  const range = FOCUS_REP_RANGE[focus]
  return { ...ex, focus, ...(isRepCounted ? { reps: `${range.low}-${range.high}` } : {}) }
}

// Squat and hinge can't share a block: blocks take patterns in pairs
// (1+2, 3+4), so if both land in one pair, swap one with the other pair.
// With only 2 patterns there's no other pair — patternGroups splits them.
export function orderPatterns(patterns: ScPattern[]): ScPattern[] {
  const out = [...patterns]
  const pairOf = (i: number) => (i < 2 ? 0 : 1)
  const squat = out.findIndex((p) => p.movementType === "squat")
  const hinge = out.findIndex((p) => p.movementType === "hinge")
  if (squat < 0 || hinge < 0 || pairOf(squat) !== pairOf(hinge)) return out
  const target = pairOf(hinge) === 0 ? 2 : 0
  if (target >= out.length) return out
  ;[out[hinge], out[target]] = [out[target], out[hinge]]
  return out
}

// The plan's patterns (2+) as blocks: pairs in order, a 3rd pattern alone,
// and a squat + hinge pair split into two blocks.
export function patternGroups(patterns: ScPattern[]): ScPattern[][] {
  const ordered = orderPatterns(patterns)
  const groups: ScPattern[][] = []
  for (let i = 0; i < ordered.length; i += 2) {
    const pair = ordered.slice(i, i + 2)
    const types = pair.map((p) => p.movementType)
    if (types.includes("squat") && types.includes("hinge")) groups.push([pair[0]], [pair[1]])
    else groups.push(pair)
  }
  return groups
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// The exercise for one pattern on this workout, or null (with a warning).
function exerciseForPattern(
  pattern: ScPattern,
  spec: WorkoutSpec,
  focus: Focus,
  byId: Map<string, ExerciseRow>,
  exercises: ExerciseRow[],
  warnings: string[],
): ExerciseRow | null {
  const special = SPECIAL_CASE_EXERCISES[pattern.movementType]?.[focus]
  if (special) {
    const found = exercises.find((e) => sameName(e.name, special))
    if (found) return found
    warnings.push(`"${special}" isn't in the exercise library — using the plan's pick for ${pattern.movementType}.`)
  }
  // This workout's pick first, then the pattern's other pick — the first one
  // that can be programmed for today's focus.
  const ids = pattern.exerciseIds
  const ordered = [ids[spec.exerciseSlot], ...ids.filter((_, i) => i !== spec.exerciseSlot)]
  const picks = ordered.map((id) => (id ? byId.get(id) : undefined)).filter((e): e is ExerciseRow => !!e)
  const fitting = picks.find((e) => fitsFocus(e, focus))
  if (fitting) return fitting
  if (picks.length === 0 && special) return null // fingers: no picks of its own; already warned above
  // Neither pick fits: any library exercise of this pattern that does.
  const fallback = exercises
    .filter((e) => e.movementType === pattern.movementType && fitsFocus(e, focus))
    .sort((a, b) => a.name.localeCompare(b.name))[0]
  if (fallback) {
    warnings.push(`The plan's ${MOVEMENT_TYPE_LABEL[pattern.movementType]} exercises aren't used for ${FOCUS_LABEL[focus]} — using "${fallback.name}" instead.`)
    return fallback
  }
  warnings.push(`No ${MOVEMENT_TYPE_LABEL[pattern.movementType]} exercise for ${FOCUS_LABEL[focus]} — left out.`)
  return null
}

// Mobility can be held (passive: timed, or reps with a default hold too) and/or
// done by reps (active).
export function canHold(ex: ExerciseRow): boolean {
  return ex.unit === "seconds" || !!ex.defaultHold
}
export function canDoReps(ex: ExerciseRow): boolean {
  return ex.unit !== "seconds"
}

// A mobility exercise as it goes into a workout, done the given way.
function mobilityDraft(ex: ExerciseRow, way: "hold" | "reps"): ExerciseDraft {
  const base = exerciseDraftFromLibrary(ex)
  if (way === "reps" || ex.unit === "seconds") return base
  return { ...base, unit: "seconds", reps: ex.defaultHold ?? "20-30" }
}

// Mobility exercises, least recently used first (never used first, then by
// name), from the athlete's sessions (newest first, as getSessions returns).
export function mobilityByRecency(exercises: ExerciseRow[], sessions: SessionRow[]): ExerciseRow[] {
  const mobility = exercises.filter((e) => e.movementType === "mobility")
  const recency = new Map<string, number>()
  sessions.forEach((s, n) => {
    let protocol: any[] = []
    try { protocol = JSON.parse(s.protocol || "[]") } catch { return }
    if (!Array.isArray(protocol)) return
    for (const b of protocol) {
      if (b?.type !== "strength_conditioning") continue
      for (const ex of b.exercises ?? []) {
        if (ex?.exerciseId && !recency.has(ex.exerciseId)) recency.set(ex.exerciseId, n)
      }
    }
  })
  const age = (e: ExerciseRow) => recency.get(e.$id) ?? Number.POSITIVE_INFINITY
  return [...mobility].sort((a, b) => age(b) - age(a) || a.name.localeCompare(b.name))
}

// A one-pattern plan's second exercise: the pattern's other pick, if it can
// be programmed for the focus and isn't the first one. No library fallback —
// with a single pick, the workout has a single exercise.
function secondExercise(
  pattern: ScPattern,
  spec: WorkoutSpec,
  focus: Focus,
  byId: Map<string, ExerciseRow>,
  first: ExerciseRow | null,
): ExerciseRow | null {
  const ids = pattern.exerciseIds
  const ordered = [ids[spec.exerciseSlot], ...ids.filter((_, i) => i !== spec.exerciseSlot)]
  return ordered
    .map((id) => (id ? byId.get(id) : undefined))
    .find((e): e is ExerciseRow => !!e && e.$id !== first?.$id && fitsFocus(e, focus)) ?? null
}

export function buildScBlocks(
  plan: PlanShape,
  spec: WorkoutSpec,
  exercises: ExerciseRow[],
  sessions: SessionRow[],
): { blocks: ScBlockDraft[]; warnings: string[] } {
  const warnings: string[] = []
  const focus = spec.scFocus
  if (!plan.hasSc || !focus) return { blocks: [], warnings }

  const byId = new Map(exercises.map((e) => [e.$id, e]))
  // Core and joints follow their own max force ↔ hypertrophy cycle.
  const focusOf = (p: ScPattern) => (skipsExplosiveness(p.movementType) ? noPowerFocusFor(spec.index) : focus)
  const draftFor = (row: ExerciseRow, f: Focus): ExerciseDraft => {
    const draftOf = (r: ExerciseRow) => withFocus(exerciseDraftFromLibrary(r), f)
    return draftOf(startingLevelRow(row, draftOf, sessions, exercises))
  }
  // Edge Lifts (max force) go first in their block: their warm-up runs
  // before the block's first round (utils/edgeWarmup.ts).
  const warmupFirst = (exs: ExerciseDraft[]) => [...exs].sort((a, b) => Number(needsWarmup(b)) - Number(needsWarmup(a)))

  // The main S&C blocks' exercises, block by block.
  let mainGroups: ExerciseDraft[][]
  if (plan.scPatterns.length === 1) {
    // One pattern: both its exercises, each in its own block (by sets).
    const p = plan.scPatterns[0]
    const f = focusOf(p)
    const first = exerciseForPattern(p, spec, f, byId, exercises, warnings)
    const second = secondExercise(p, spec, f, byId, first)
    mainGroups = [first, second].filter((r): r is ExerciseRow => !!r).map((r) => [draftFor(r, f)])
  } else {
    mainGroups = patternGroups(plan.scPatterns).map((group) => warmupFirst(group.flatMap((p) => {
      const f = focusOf(p)
      const row = exerciseForPattern(p, spec, f, byId, exercises, warnings)
      return row ? [draftFor(row, f)] : []
    })))
  }
  mainGroups = mainGroups.filter((g) => g.length > 0)

  const block = (name: string, exs: ExerciseDraft[], rest: number): ScBlockDraft => ({
    type: "strength_conditioning",
    blockName: name,
    description: "",
    rounds: SC_PLAN_RULES.rounds,
    restBetweenRounds: rest,
    exercises: exs,
  })
  // Rest without mobility follows the day's focus — or the block's own, when
  // all its exercises share another one (a core / joint block on its own
  // cycle).
  const restFor = (exs: ExerciseDraft[]) => {
    const own = new Set(exs.map((e) => e.focus))
    const f = own.size === 1 ? [...own][0] ?? focus : focus
    return f === "hypertrophy" ? SC_PLAN_RULES.restHypertrophy : SC_PLAN_RULES.restOther
  }

  if (!plan.hasMobility) {
    return { blocks: mainGroups.map((g, i) => block(`S&C ${i + 1}`, g, restFor(g))), warnings }
  }

  // 4 mobility slots: two held (passive), two by reps (active). The held ones
  // are the rest of the first two S&C blocks; the rest go in a Mobility block
  // at the end. Least recently used first, no repeats within the workout.
  // Short of a kind → any other mobility exercise, in its own way. When the
  // coach chose the athlete's mobility exercises, only those are used — fewer
  // than 4 means fewer mobility slots, never one the coach didn't pick (if
  // none of them is in the library any more, the app picks again).
  const chosen = new Set(plan.mobilityIds ?? [])
  const chosenRows = exercises.filter((e) => chosen.has(e.$id))
  const coachPicked = chosenRows.length > 0
  const pool = mobilityByRecency(coachPicked ? chosenRows : exercises, sessions)
  const used = new Set<string>()
  const take = (way: "hold" | "reps"): ExerciseDraft | null => {
    const fits = way === "hold" ? canHold : canDoReps
    const row = pool.find((e) => !used.has(e.$id) && fits(e)) ?? pool.find((e) => !used.has(e.$id))
    if (!row) return null
    used.add(row.$id)
    return fits(row) ? mobilityDraft(row, way) : exerciseDraftFromLibrary(row)
  }
  const holds = [take("hold"), take("hold")]
  const reps = [take("reps"), take("reps")]
  const found = [...holds, ...reps].filter(Boolean).length
  if (found < 4 && !coachPicked) warnings.push(`Only ${found} mobility exercise(s) in the library — the workout needs 4.`)
  const some = (xs: (ExerciseDraft | null)[]) => xs.filter((x): x is ExerciseDraft => !!x)

  const blocks = mainGroups.map((g, i) => {
    const hold = i < holds.length ? some([holds[i]]) : []
    return hold.length > 0
      ? block(`S&C ${i + 1}`, [...g, ...hold], SC_PLAN_RULES.restWithMobility)
      : block(`S&C ${i + 1}`, g, restFor(g))
  })
  const leftover = some(holds.slice(mainGroups.length))
  blocks.push(block("Mobility", [...leftover, ...some(reps)], SC_PLAN_RULES.restMobilityBlock))
  return { blocks: blocks.filter((b) => b.exercises.length > 0), warnings }
}
