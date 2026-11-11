import type { ExerciseRow, SessionRow } from "@/services/BoulderGraphService"
import { chainIds, findLibraryRow, resolveExerciseChain, type ChainSource, type ResolvedChain } from "@/utils/levelChain"
import { findScSessions } from "@/utils/scHistory"
import { planNextForFocus, type FocusEntry, type NextPlan } from "@/utils/scNext"
import type { Focus, WeightUnit } from "@/utils/scProgression"
import { isPullupLadder, stepForVariation, variationFor, type PullupTestResult } from "@/utils/pullupAssessment"

// What an S&C exercise starts on, from the athlete's history — the one rule
// both the workout's prefill (StrengthConditioningBlock) and the plan's
// workout generator (scPlanBuilder) use, so the level a plan workout
// prescribes is the level the athlete is told to do. Pure.

export interface ExerciseSetting { harder?: string; easier?: string }

export function settingOf(x: { settingHarder?: string | null; settingEasier?: string | null }): ExerciseSetting | undefined {
  const harder = x.settingHarder?.trim() || undefined
  const easier = x.settingEasier?.trim() || undefined
  return harder || easier ? { harder, easier } : undefined
}

// Sessions read per exercise, any focus: enough for three of one focus
// (stall rule) while the plan rotates three focuses.
export const HISTORY_LOOKBACK = 10

export interface PrefillExercise extends ChainSource {
  focus?: Focus
  reps?: string
  unit?: string
  loadStep?: number
  settingHarder?: string
  settingEasier?: string
}

export interface HistoryPlan {
  chain?: ResolvedChain
  loadStep?: number
  setting?: ExerciseSetting
  past?: FocusEntry[]   // recent sessions, any focus, newest first
  next?: NextPlan       // absent with no history
}

export function planFromHistory(ex: PrefillExercise, sessions: SessionRow[] | null, library: ExerciseRow[] | null, unit: WeightUnit): HistoryPlan {
  const out: HistoryPlan = {}
  const chain = resolveExerciseChain(ex, library)
  if (chain) out.chain = chain
  const row = library ? findLibraryRow(ex, library) : undefined
  out.loadStep = row?.loadStep ?? ex.loadStep ?? undefined
  const setting = settingOf(row ?? ex)
  if (setting) out.setting = setting
  if (!sessions) return out
  // Search the whole family — every member of the full chain — since a
  // round could have been logged under any of them.
  const candidateIds = chain ? chainIds(chain, ex.exerciseId) : [ex.exerciseId].filter((id): id is string => !!id)
  // Every focus: planNextForFocus picks today's focus's history, and
  // explosiveness starts from max force (scNext.ts).
  const history = findScSessions(sessions, candidateIds, ex.name, { unit, limit: HISTORY_LOOKBACK })
  if (history.length === 0) return out
  out.past = history
  const timed = ex.unit === "seconds" ? "seconds" : "reps"
  out.next = planNextForFocus({ focus: ex.focus, reps: ex.reps, unit: timed, setting }, chain ?? undefined, out.loadStep, unit, history, "last time")
  return out
}

// The ladder step a plan workout should prescribe instead of `row`: where
// the athlete's history puts them — the step their workout will suggest —
// else `row` itself. `draft`: the exercise as the workout gets it (focus,
// reps). Repeated until it settles, since the prescribed step's own
// setting hints feed the rule.
export function startingLevelRow(
  row: ExerciseRow, draft: (r: ExerciseRow) => PrefillExercise, sessions: SessionRow[], library: ExerciseRow[],
): ExerciseRow {
  // Weight-mode exercises keep the pick — only their load comes from history.
  if (!resolveExerciseChain(draft(row), library)) return row
  let current = row
  for (let i = 0; i < 3; i++) {
    const level = planFromHistory(draft(current), sessions, library, "kg").next?.level
    const next = level && level.exerciseId !== current.$id ? library.find((r) => r.$id === level.exerciseId) : undefined
    if (!next) return current
    current = next
  }
  return current
}

// Pull-up ladders with no history at this focus start where the athlete's
// pull-up test puts them (utils/pullupAssessment.ts); history, when there
// is some, wins (coach 2026-11-11). null = not a pull-up ladder, history
// exists, or the ladder lacks the step.
export function testLevelRow(
  row: ExerciseRow, draft: PrefillExercise, focus: Focus | undefined, sessions: SessionRow[], library: ExerciseRow[], test: PullupTestResult | null | undefined,
): ExerciseRow | null {
  if (!test || !focus) return null
  const chain = resolveExerciseChain(draft, library)
  if (!chain || !isPullupLadder(chain.chain)) return null
  if (findScSessions(sessions, chainIds(chain, row.$id), row.name, { focus, limit: 1 }).length > 0) return null
  const at = stepForVariation(chain.chain, variationFor(focus, test))
  if (at < 0) return null
  return library.find((r) => r.$id === chain.chain[at].exerciseId) ?? null
}
