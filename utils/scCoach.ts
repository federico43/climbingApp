// The coach's view of one S&C exercise for one athlete: each recent session
// as "suggested → did → result", plus the safety-rail flags (deload, stalled)
// and any swaps to an easier exercise. Read by the exercise-progress screen
// and the athlete's S&C list. Pure: sessions + library in, rows out.
import type { SessionRow } from "@/services/BoulderGraphService"
import { chainIds, findLibraryRow, resolveExerciseChain, type ChainMember, type ResolvedChain } from "@/utils/levelChain"
import { EFFORT_LABEL, FOCUS_LABEL, type Effort, type Focus, type WeightUnit } from "@/utils/scProgression"
import { findScSessions, findScSwaps, type ScSessionEntry, type ScSwap } from "@/utils/scHistory"
import { planNextForFocus, type NextFlags } from "@/utils/scNext"

export interface CoachSessionRow {
  date: string
  focusLabel?: string
  exerciseName?: string
  suggested?: string   // what the app proposed going into this session
  did: string          // "21 kg · 10, 9 reps · Solid"
  result: string       // what the rule made of it
}

export interface CoachExerciseView {
  rows: CoachSessionRow[]   // newest first
  flags: NextFlags          // for the next session
  swaps: ScSwap[]
}

type LibraryRow = ChainMember & { loadStep?: number | null; type?: string; settingHarder?: string; settingEasier?: string }

const HISTORY_LIMIT = 5
// Enough older sessions behind the shown ones to judge them: deload / stall
// look two back at the same focus, and the plan rotates three focuses.
const LOOKBACK = HISTORY_LIMIT + 7

function did(e: ScSessionEntry, unit: WeightUnit): string {
  const noun = e.unit === "seconds" ? "s" : " reps"
  const load = e.summary.weight ? `${e.summary.weight} ${unit}` : "Bodyweight"
  const amounts = e.summary.sets.map((s) => s.amount).join(", ")
  const effort = e.effort && e.effort in EFFORT_LABEL ? ` · ${EFFORT_LABEL[e.effort as Effort]}` : ""
  const hardest = e.summary.atHardest ? " · hardest setup" : ""
  return `${load}${hardest} · ${amounts}${noun}${effort}`
}

function loadText(weight: number | undefined, levelName: string | undefined, unit: WeightUnit): string | undefined {
  if (levelName) return levelName
  return weight ? `${weight} ${unit}` : undefined
}

export function coachExerciseView(
  sessions: SessionRow[],
  exerciseName: string,
  library: LibraryRow[] | null,
  unit: WeightUnit = "kg",
): CoachExerciseView {
  const row = library ? findLibraryRow({ name: exerciseName }, library) : undefined
  const chain: ResolvedChain | undefined = row && library ? resolveExerciseChain({ exerciseId: row.$id, name: row.name }, library) ?? undefined : undefined
  const ids = chain ? chainIds(chain, row?.$id) : [row?.$id].filter((id): id is string => !!id)
  const loadStep = row?.loadStep ?? undefined
  const setting = row?.settingHarder || row?.settingEasier
    ? { harder: row.settingHarder || undefined, easier: row.settingEasier || undefined }
    : undefined

  const entries = findScSessions(sessions, ids, exerciseName, { unit, limit: LOOKBACK })
  // Session i judged on the sessions up to it — the history the athlete's
  // own prefill would have seen (planNextForFocus picks the focus).
  const planAt = (i: number, when: "last time" | "that day", ex = entries[i]) =>
    planNextForFocus({ focus: ex.focus, reps: ex.prescribed, unit: ex.unit, setting }, chain, loadStep, unit, entries.slice(i), when)

  const rows: CoachSessionRow[] = entries.slice(0, HISTORY_LIMIT).map((e, i) => {
    const result = planAt(i, "that day")
    // The suggestion going into session i = the plan for its focus made
    // from everything before it (explosiveness can come from max force).
    const before = i + 1 < entries.length ? planAt(i + 1, "last time", e) : undefined
    return {
      date: e.date,
      focusLabel: e.focus ? FOCUS_LABEL[e.focus as Focus] : undefined,
      exerciseName: e.exerciseName,
      suggested: before ? loadText(before.weight, before.level?.name, unit) : undefined,
      did: did(e, unit),
      result: result.note || "Not enough logged to judge",
    }
  })

  return {
    rows,
    flags: entries.length ? planAt(0, "last time").flags : {},
    swaps: findScSwaps(sessions, ids, exerciseName),
  }
}
