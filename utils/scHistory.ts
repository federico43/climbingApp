import type { SessionRow } from "@/services/BoulderGraphService"
import { convertWeight, type Focus, type WeightUnit, type WorkingSet } from "@/utils/scProgression"

// "easier": the app offered it after the athlete missed the minimum with
// nothing left to lower (RoundDrop.pickEasier) — the coach is told to add
// an easier version to the ladder. "choice": the athlete replaced it
// themselves (machine taken, injury, preference…). Logs written before the
// reason existed are easier swaps (it was the only kind).
export type SwapReason = "easier" | "choice"

export function swapReasonOf(scData: { swappedFrom?: unknown; swapReason?: string } | null | undefined): SwapReason | null {
  if (!scData?.swappedFrom) return null
  return scData.swapReason === "choice" ? "choice" : "easier"
}

// Reads S&C progression state out of an athlete's own session history.
// Shared by StrengthConditioningBlock.tsx (prefilling the athlete's next
// round) and the coach's block editor (flagging when an athlete has already
// progressed past what's being authored) — both need the same answer to
// "what did this athlete last do on this exercise family."

// The most recent logged round for a given exercise, read out of session
// history (newest session first). For a level-mode exercise, "the exercise"
// is really a family — the container plus every exercise in its level
// chain — since a round gets logged under whichever family member was
// actually performed, not the container. Scans sessions newest-first and
// stops at the first one containing any family member; within that session
// picks the highest round number (how they finished, not how they started).
export interface LastScLog {
  exerciseId?: string  // which family member this was actually logged as
  weight?: number
  rpe?: number
  repsCompleted?: number
}

// Prefer matching by exerciseId (rename-safe, same reasoning as level
// matching in scProgression.ts) and only fall back to name when either side
// lacks an id — a log written before this field existed, most likely.
function scLogMatches(scData: any, candidateIds: string[], exerciseName: string): boolean {
  if (candidateIds.length && scData?.exerciseId) return candidateIds.includes(scData.exerciseId)
  return scData?.exerciseName === exerciseName
}

// The S&C focus a round was done at: logged on the round itself since
// 2026-10-04, else read off the exercise as it was programmed in that
// session's protocol (the attempt's block, matched by id or name).
export function loggedFocus(attempt: any, protocol: any[]): Focus | undefined {
  if (attempt?.scData?.focus) return attempt.scData.focus
  const block = protocol[attempt?.blockIndex]
  if (block?.type !== "strength_conditioning" || !Array.isArray(block.exercises)) return undefined
  const id = attempt?.scData?.exerciseId
  const ex = block.exercises.find((e: any) =>
    (id && (e?.exerciseId === id || (e?.levels ?? []).some((l: any) => l?.exerciseId === id)))
    || e?.name === attempt?.scData?.exerciseName)
  return ex?.focus
}

// Every logged round for this family in the athlete's most recent session
// that touched it, newest round first. Shared scan behind both findLastScLog
// (just the final round) and findLastScSession (the whole session's story).
// With `focus`, only rounds done at that focus count: a training plan rotates
// an exercise through max force / hypertrophy / explosiveness, and last
// time's hypertrophy set says nothing about today's max-force weight.
// Each session (newest first) that logged this family, with its matching
// rounds newest round first and the session's parsed protocol.
function* sessionsWithMatches(sessions: SessionRow[], candidateIds: string[], exerciseName: string, focus?: Focus) {
  for (const s of sessions) {
    let attempts: any[] = []
    let protocol: any[] = []
    try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    try { protocol = JSON.parse(s.protocol || "[]") } catch { protocol = [] }
    if (!Array.isArray(protocol)) protocol = []
    const matches = attempts.filter(
      (a) => a?.type === "strength_conditioning" && scLogMatches(a?.scData, candidateIds, exerciseName)
        && (!focus || loggedFocus(a, protocol) === focus)
    )
    if (matches.length === 0) continue
    matches.sort((a, b) => (b.scData?.round ?? 0) - (a.scData?.round ?? 0))
    yield { session: s, matches, protocol }
  }
}

function matchesInMostRecentSession(sessions: SessionRow[], candidateIds: string[], exerciseName: string, focus?: Focus): any[] | null {
  for (const { matches } of sessionsWithMatches(sessions, candidateIds, exerciseName, focus)) return matches
  return null
}

// The exercise as the coach programmed it in that session (the attempt's
// block in the session's own protocol) — for its prescribed reps / unit.
function programmedExercise(attempt: any, protocol: any[]): any | undefined {
  const block = protocol[attempt?.blockIndex]
  if (block?.type !== "strength_conditioning" || !Array.isArray(block.exercises)) return undefined
  const id = attempt?.scData?.exerciseId
  return block.exercises.find((e: any) =>
    (id && (e?.exerciseId === id || (e?.levels ?? []).some((l: any) => l?.exerciseId === id)))
    || e?.name === attempt?.scData?.exerciseName)
}

// One past session on this family, judged at the load it ended on — what
// the coach's history and the deload / stall rules read.
export interface ScSessionEntry {
  sessionId: string
  date: string               // ISO, from the session
  focus?: Focus
  prescribed?: string        // the reps / seconds the coach set ("8-12")
  unit?: "reps" | "seconds"
  exerciseName?: string      // what was actually done (a level's name)
  effort?: string            // the last round's Easy / Solid / Max, if logged
  summary: ScSetsSummary
}

export function findScSessions(
  sessions: SessionRow[], candidateIds: string[], exerciseName: string,
  opts: { focus?: Focus; unit?: WeightUnit; limit?: number } = {},
): ScSessionEntry[] {
  const out: ScSessionEntry[] = []
  for (const { session, matches, protocol } of sessionsWithMatches(sessions, candidateIds, exerciseName, opts.focus)) {
    const summary = setsAtFinalLoad(matches.map((m) => readRound(m.scData, opts.unit)).reverse())
    if (!summary) continue
    const final = matches[0]
    const programmed = programmedExercise(final, protocol)
    out.push({
      sessionId: session.$id,
      date: session.$createdAt,
      focus: loggedFocus(final, protocol),
      prescribed: programmed?.reps,
      unit: programmed?.unit === "seconds" ? "seconds" : "reps",
      exerciseName: final.scData?.exerciseName,
      effort: final.scData?.effort,
      summary,
    })
    if (opts.limit && out.length >= opts.limit) break
  }
  return out
}

// Rounds where the athlete swapped this exercise for another one — newest
// first, one per session. `reason` (utils/scSwap): "easier" = the app's
// "Pick an easier exercise" (RoundDrop.pickEasier; every swap logged before
// the reason existed), "choice" = the athlete's own "Change exercise".
// `forPlan`: a choice swap the athlete also made for the rest of the plan.
export interface ScSwap { date: string; to: string; reason: SwapReason; forPlan?: boolean }

export function findScSwaps(sessions: SessionRow[], candidateIds: string[], exerciseName: string): ScSwap[] {
  const out: ScSwap[] = []
  for (const s of sessions) {
    let attempts: any[] = []
    try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    const swap = attempts.find((a) => a?.type === "strength_conditioning" && a?.scData?.swappedFrom
      && scLogMatches(a.scData.swappedFrom, candidateIds, exerciseName))
    if (swap) out.push({ date: s.$createdAt, to: swap.scData.exerciseName, reason: swapReasonOf(swap.scData) ?? "easier", ...(swap.scData.swapScope === "plan" ? { forPlan: true } : {}) })
  }
  return out
}

export function findLastScLog(sessions: SessionRow[], candidateIds: string[], exerciseName: string, focus?: Focus): LastScLog | null {
  const matches = matchesInMostRecentSession(sessions, candidateIds, exerciseName, focus)
  if (!matches) return null
  const r = readRound(matches[0].scData)
  return { exerciseId: r.exerciseId, weight: r.weight, rpe: r.rpe, repsCompleted: r.amount }
}

// One logged round, read the same way everywhere. Both sides: the weaker
// side's amount and the harder side's RPE drive the call — the side that's
// struggling is the one that decides whether to load up.
export interface ScRound {
  exerciseId?: string
  weight?: number
  amount?: number   // reps or seconds
  rpe?: number
  adjusted?: boolean  // done at an automatic easier load (planRoundDrop)
  hardest?: boolean   // the athlete was on the exercise's hardest setting
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined
  const n = parseFloat(String(v))
  return Number.isNaN(n) ? undefined : n
}

function pick(values: (number | undefined)[], by: (...n: number[]) => number): number | undefined {
  const defined = values.filter((v): v is number => v != null)
  return defined.length ? by(...defined) : undefined
}

// `unit`: the athlete's current unit — a weight logged in the other one is
// converted, so switching kg → lb doesn't mislabel last time's numbers.
export function readRound(d: any, unit?: WeightUnit): ScRound {
  const raw = num(d?.weight) ?? pick([num(d?.weightLeft), num(d?.weightRight)], Math.min)
  const loggedUnit: WeightUnit = d?.weightUnit === "lb" ? "lb" : "kg"
  return {
    exerciseId: d?.exerciseId,
    weight: raw != null && unit ? convertWeight(raw, loggedUnit, unit) : raw,
    amount: num(d?.repsCompleted) ?? pick([num(d?.repsLeft), num(d?.repsRight)], Math.min),
    rpe: num(d?.rpe) ?? pick([num(d?.rpeLeft), num(d?.rpeRight)], Math.max),
    ...(d?.adjustedFrom ? { adjusted: true } : {}),
    ...(d?.atHardestSetting ? { hardest: true } : {}),
  }
}

// The working sets that count for "what next": only the rounds done at the
// load the session ended on (same level, same weight). Round 1 at 20 kg
// says nothing about 22.5 kg, and a level the athlete stepped off isn't
// where they are. `rounds` oldest → newest; sets come back in that order.
export interface ScSetsSummary {
  exerciseId?: string
  weight?: number
  sets: WorkingSet[]
  droppedInSession?: boolean  // any round was an automatic easier one
  atHardest?: boolean         // ended on the hardest setting
}

export function setsAtFinalLoad(rounds: ScRound[]): ScSetsSummary | null {
  if (rounds.length === 0) return null
  const final = rounds[rounds.length - 1]
  const sets = rounds
    // The setting is part of the load: rounds before the athlete reached the
    // hardest setting don't judge rounds on it.
    .filter((r) => r.exerciseId === final.exerciseId && r.weight === final.weight && !!r.hardest === !!final.hardest && r.amount != null)
    .map((r) => ({ amount: r.amount!, ...(r.rpe != null ? { rpe: r.rpe } : {}) }))
  return {
    exerciseId: final.exerciseId, weight: final.weight, sets,
    ...(rounds.some((r) => r.adjusted) ? { droppedInSession: true } : {}),
    ...(final.hardest ? { atHardest: true } : {}),
  }
}

// Every working set of the athlete's most recent session on this family (at
// today's focus), not just its last round — the last round alone is the
// most fatigued set and over-reports misses.
export function findLastScSets(sessions: SessionRow[], candidateIds: string[], exerciseName: string, focus?: Focus, unit?: WeightUnit): ScSetsSummary | null {
  const matches = matchesInMostRecentSession(sessions, candidateIds, exerciseName, focus)
  if (!matches) return null
  return setsAtFinalLoad(matches.map((m) => readRound(m.scData, unit)).reverse())
}

// The whole story of the athlete's most recent session touching this family,
// not just how it ended — lets a caller tell "reached a level and stayed"
// apart from "reached a level, then stepped back down before the session
// ended," which findLastScLog alone can't distinguish (it only sees the
// highest round number, i.e. the final state).
export interface ScSessionSummary {
  finalExerciseId?: string      // highest-round entry — how the session ended
  loggedExerciseIds: string[]   // every distinct family member logged, any round
}

export function findLastScSession(sessions: SessionRow[], candidateIds: string[], exerciseName: string): ScSessionSummary | null {
  const matches = matchesInMostRecentSession(sessions, candidateIds, exerciseName)
  if (!matches) return null
  return {
    finalExerciseId: matches[0].scData?.exerciseId,
    loggedExerciseIds: [...new Set(matches.map((m) => m.scData?.exerciseId).filter((id): id is string => !!id))],
  }
}
