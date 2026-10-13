import type { Block } from "@/components/workoutBlocks"
import type { BlockRow, ExerciseRow, SessionRow } from "@/services/BoulderGraphService"
import { suggestWarmup, warmupCandidates, warmupPillarFor, warmupUsage, type WarmupPick } from "@/utils/progression/constraintWarmup"
import { INTERVALS_RULES } from "@/utils/progression/profiles"
import { MAIN_BLOCK_COPIES, TEST_BLOCK, WARMUP_INTERVALS_BLOCK, type LibraryBlockRef, type PlanShape, type WorkoutSpec } from "@/utils/planRotation"
import { buildScBlocks, type ScBlockDraft } from "@/utils/scPlanBuilder"

// A training-plan workout as blocks (docs/training-plan.md §5):
//   S&C → warm-up → main block × 2 (the same library block twice)
// On a test day (first workout, and the first one of the last week) the
// Density test comes back separately in `homework` — the athlete does it on
// a day of their own (coach 2026-10-07).
// Blocks come back without local ids — the caller adds them
// (injectLocalIds) before opening the workout builder. Anything that can't
// be built (a library block or exercise missing) is left out and reported
// in `warnings` so the coach can fix the library or add it by hand.

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never
export type PlanBlockDraft = DistributiveOmit<Block, "id"> | ScBlockDraft

export interface PlanWorkout {
  blocks: PlanBlockDraft[]
  homework: PlanBlockDraft[]
  warnings: string[]
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function findLibraryBlock(ref: LibraryBlockRef, library: BlockRow[]): BlockRow | undefined {
  return library.find((r) => r.type === ref.type && sameName(r.name, ref.name))
}

// A library block as it goes into a workout, still pointing at its library
// row so progression history can find it (see BaseBlock.libraryBlockId).
export function cloneLibraryBlock(row: BlockRow): DistributiveOmit<Block, "id"> {
  return { ...JSON.parse(row.data), blockName: row.name, libraryBlockId: row.$id }
}

// The 3 constraint picks as constraint_warmup blocks, with the suggested
// colour and attempts.
export function constraintWarmupDrafts(picks: WarmupPick[], library: BlockRow[]): PlanBlockDraft[] {
  const out: PlanBlockDraft[] = []
  for (const p of picks) {
    const row = library.find((r) => r.$id === p.id)
    if (!row || row.type !== "constraint_warmup") continue
    out.push({ ...cloneLibraryBlock(row), level: p.colour, targetAttempts: p.attempts } as PlanBlockDraft)
  }
  return out
}

function warmupDrafts(plan: PlanShape, spec: WorkoutSpec, library: BlockRow[], sessions: SessionRow[], flash: string | null | undefined, warnings: string[]): PlanBlockDraft[] {
  if (spec.warmup === "one_on_one_off") {
    const row = findLibraryBlock(WARMUP_INTERVALS_BLOCK, library)
    if (!row) {
      warnings.push(`No "${WARMUP_INTERVALS_BLOCK.name}" intervals block in the library — warm-up left out.`)
      return []
    }
    // Run as a warm-up, not a power endurance set: warm-up kind and rounds,
    // and no adaptation tag of its own (the library block is tagged PE).
    const { adaptation: _adaptation, ...base } = cloneLibraryBlock(row) as any
    return [{ ...base, kind: "warmup", series: INTERVALS_RULES.warmupSeries }]
  }
  const pillar = warmupPillarFor(plan.focus)
  const candidates = warmupCandidates(library)
  const picks = pillar ? suggestWarmup(candidates, pillar, warmupUsage(sessions, candidates), flash) : null
  if (!picks) {
    warnings.push("No constraint warm-ups in the rotation for this plan's focus — warm-up left out.")
    return []
  }
  if (picks.length < 3) warnings.push(`Only ${picks.length} constraint warm-up(s) for this plan's focus.`)
  return constraintWarmupDrafts(picks, library)
}

// Plan workouts the coach has built that the athlete hasn't done yet — built
// after their latest session — as if they'd been done, newest first. Put in
// front of the real sessions so the warm-up and mobility rotations treat
// them as "last time" and the next workout doesn't repeat them. (Sessions
// don't record which workout they came from, so "done" is judged by date.)
export function withUpcomingWorkouts(
  sessions: SessionRow[],
  planWorkouts: { $id: string; $createdAt: string; blocks: string }[],
): SessionRow[] {
  const latest = sessions.reduce((max, s) => (s.$createdAt > max ? s.$createdAt : max), "")
  const upcoming = planWorkouts
    .filter((w) => w.$createdAt > latest)
    .sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))
    .map((w): SessionRow => {
      let blocks: any[] = []
      try { blocks = JSON.parse(w.blocks || "[]") } catch { /* no blocks */ }
      return {
        $id: `upcoming-${w.$id}`, $createdAt: w.$createdAt, userId: "",
        protocol: JSON.stringify(blocks),
        attempts: JSON.stringify(blocks.map((_, blockIndex) => ({ blockIndex }))),
      }
    })
  return [...upcoming, ...sessions]
}

export function buildPlanWorkout(
  plan: PlanShape,
  spec: WorkoutSpec,
  library: BlockRow[],
  exercises: ExerciseRow[],
  sessions: SessionRow[],
  flash: string | null | undefined,
): PlanWorkout {
  const warnings: string[] = []
  const blocks: PlanBlockDraft[] = []

  const sc = buildScBlocks(plan, spec, exercises, sessions)
  blocks.push(...sc.blocks)
  warnings.push(...sc.warnings)

  const libraryBlock = (ref: LibraryBlockRef, copies = 1, into = blocks) => {
    const row = findLibraryBlock(ref, library)
    if (!row) {
      warnings.push(`No "${ref.name}" (${ref.type}) block in the library — left out.`)
      return
    }
    for (let i = 0; i < copies; i++) into.push(cloneLibraryBlock(row))
  }

  const homework: PlanBlockDraft[] = []
  if (spec.withTest) libraryBlock(TEST_BLOCK, 1, homework)
  blocks.push(...warmupDrafts(plan, spec, library, sessions, flash, warnings))
  libraryBlock(spec.mainBlock, MAIN_BLOCK_COPIES)

  return { blocks, homework, warnings }
}
