// The coach's view of one S&C exercise for one athlete: each recent session
// as "suggested → did → result", plus the safety-rail flags (deload, stalled)
// and any swaps to an easier exercise. Read by the exercise-progress screen
// and the athlete's S&C list. Pure: sessions + library in, rows out.
import type { SessionRow } from "@/services/BoulderGraphService"
import { chainIds, findLibraryRow, resolveExerciseChain, type ChainMember, type ResolvedChain } from "@/utils/levelChain"
import { EFFORT_LABEL, EFFORTS, FOCUS_LABEL, type Effort, type Focus, type WeightUnit } from "@/utils/scProgression"
import { findScSessions, findScSwaps, type LoggedRound, type ScSessionEntry, type ScSwap } from "@/utils/scHistory"
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

// Every round, grouped by load in the order done: "Bodyweight · 8, 7 reps →
// Bodyweight · hardest setup · 6 reps · Max". Only the last group is judged
// (setsAtFinalLoad), so a change of load mid-session shows what was left out.
// Effort: one word when every round had the same, else a count
// ("1 Solid · 2 Max").
function did(e: ScSessionEntry, unit: WeightUnit): string {
  const noun = e.unit === "seconds" ? "s" : " reps"
  const rounds = e.rounds.length ? e.rounds : e.summary.sets.map((s) => ({ amount: s.amount, weight: e.summary.weight, hardest: e.summary.atHardest, exerciseName: e.exerciseName }))
  const loadOf = (r: LoggedRound) => [
    ...(r.exerciseName && r.exerciseName !== e.exerciseName ? [r.exerciseName] : []),
    r.weight ? `${r.weight} ${unit}` : "Bodyweight",
    ...(r.hardest ? ["hardest setup"] : []),
  ].join(" · ")
  const groups: { load: string; amounts: number[] }[] = []
  for (const r of rounds) {
    if (r.amount == null) continue
    const load = loadOf(r)
    const last = groups[groups.length - 1]
    if (last && last.load === load) last.amounts.push(r.amount)
    else groups.push({ load, amounts: [r.amount] })
  }
  const sets = groups.map((g) => `${g.load} · ${g.amounts.join(", ")}${noun}`).join(" → ")
  return [sets, effortText(rounds)].filter(Boolean).join(" · ")
}

function effortText(rounds: LoggedRound[]): string {
  const counts = new Map<Effort, number>()
  for (const r of rounds) if (r.effort && r.effort in EFFORT_LABEL) counts.set(r.effort as Effort, (counts.get(r.effort as Effort) ?? 0) + 1)
  if (counts.size === 0) return ""
  const [only] = [...counts.keys()]
  if (counts.size === 1 && counts.get(only) === rounds.length) return EFFORT_LABEL[only]
  return EFFORTS.filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${EFFORT_LABEL[k]}`).join(" · ")
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
