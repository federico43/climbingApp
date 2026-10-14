// What an S&C exercise should start on next session, from the athlete's
// recent sessions on it — the one place the workout's prefill, its "Next
// time" card, the coach's exercise history and the coach's editor flag all
// ask. Pure; rules in docs/sc-progression-plan.md §3.
import type { ResolvedChain } from "@/utils/levelChain"
import { chainIndexOf, usableAt } from "@/utils/levelChain"
import type { ScSetsSummary } from "@/utils/scHistory"
import {
  decideNext, DEFAULT_LOAD_STEP, describeLevel, FOCUS_LABEL, describeWeight, lowerFirst, nextWeight, reasonText, stepLevel, targetFor,
  type Decision, type Focus, type LevelStep, type WeightUnit, type When,
} from "@/utils/scProgression"

export interface NextExercise {
  focus?: Focus
  reps?: string               // prescribed amount ("8-12", "20-30")
  unit?: "reps" | "seconds"
  // Adjustable setting (bench height, lean…): the coach's hints. Present =
  // the setting moves before the level / weight (sc-modifications-plan §2.3).
  setting?: { harder?: string; easier?: string }
}

// Safety rails (§3.5) — for the coach only (coach, 2026-10-06): they're
// shown on the coach's screens and never change what the athlete is told
// or given. `deload`: down two sessions in a row. `stalled`: no step up in
// three sessions.
export interface NextFlags {
  deload?: boolean
  stalled?: boolean
}

export interface NextPlan {
  weight?: number
  level?: LevelStep
  note: string
  decision?: Decision
  flags: NextFlags
  // Exercises with a setting: whether next session starts with the
  // "I'm on the hardest setting" switch on. Off after a new level, a miss,
  // or a "make it harder" note.
  atHardest?: boolean
  // The past session the plan is based on (planNextForFocus) — shown to
  // the athlete under the note (basisLine).
  basis?: FocusEntry
}

const STALL_SESSIONS = 3

function sameLoad(a: ScSetsSummary, b: ScSetsSummary): boolean {
  return a.exerciseId === b.exerciseId && a.weight === b.weight
}

// Cross-focus safety rails, worked out by planNextForFocus. When given,
// they replace planNext's own same-focus ones.
export interface Rails {
  deload: boolean
  stalled: boolean
}

// `history`: the athlete's sessions on this exercise at today's focus,
// newest first (history[0] = last time, or today for the end-of-block card).
export function planNext(
  ex: NextExercise,
  chain: ResolvedChain | undefined,
  loadStep: number | undefined,
  unit: WeightUnit,
  history: ScSetsSummary[],
  when: When,
  rails?: Rails,
): NextPlan {
  const last = history[0]
  if (!last) return { note: "", flags: {} }
  const target = targetFor(ex.focus, ex.reps, ex.unit === "seconds" ? "seconds" : "reps")
  const judge = (h: ScSetsSummary | undefined) => (target && h ? decideNext(target, h.sets, ex.focus, { droppedInSession: h.droppedInSession }) : null)
  const decision = judge(last)
  const judged = decision && decision.reason !== "no_data" ? decision : null

  let deload: boolean
  let stalled: boolean
  if (rails) {
    ;({ deload, stalled } = rails)
  } else {
    const previous = judge(history[1])
    deload = judged?.direction === "decrease" && previous?.direction === "decrease"
    // Explosiveness holds its load on purpose (speed, not reps) — that's
    // not being stuck.
    stalled = ex.focus !== "explosiveness" && history.length >= STALL_SESSIONS
      && history.slice(1, STALL_SESSIONS).every((h) => sameLoad(h, last))
      && judged?.direction !== "increase"
  }
  const flags: NextFlags = { ...(deload ? { deload } : {}), ...(stalled ? { stalled } : {}) }

  // Exercises with a setting move the setting first: ▲ only once the
  // athlete was on the hardest setting, otherwise "make it harder"; a ▼
  // says how to make it easier. Same weight / level either
  // way — the athlete adjusts the setting, the app can't measure it.
  const setting = ex.setting && (ex.setting.harder || ex.setting.easier) ? ex.setting : undefined
  const settingHint = judged && setting
    ? judged.direction === "increase" && !last.atHardest && setting.harder
      ? `Make it harder: ${lowerFirst(setting.harder)} — ${reasonText(judged, when)}`
      : judged.direction === "decrease" && setting.easier
        ? `Make it easier: ${lowerFirst(setting.easier)} — ${reasonText(judged, when)}`
        : null
    : null
  const stayHere = (extra: Partial<NextPlan>): NextPlan => ({ note: settingHint!, decision: judged ?? undefined, flags, atHardest: false, ...extra })

  if (chain) {
    // A log that isn't a chain member (e.g. an old name-only log) counts
    // as the prescribed step.
    const at = chainIndexOf(chain, last.exerciseId)
    const fromIdx = at >= 0 ? at : chain.prescribedIdx
    const from = chain.chain[fromIdx]
    const usable = usableAt(chain, ex.focus)
    if (settingHint) return stayHere({ level: from })
    if (!judged) return { level: from, note: "", flags, ...(setting ? { atHardest: !!last.atHardest } : {}) }
    const move = stepLevel(chain.chain, fromIdx, judged.direction, usable)!
    // A new level starts back on an easier setting.
    const hardest = setting ? { atHardest: move.index === fromIdx && !!last.atHardest } : {}
    return { level: move.step, note: describeLevel(judged, from, move, when), decision: judged, flags, ...hardest }
  }
  const from = last.weight ?? 0
  if (settingHint) return stayHere({ weight: last.weight })
  if (!judged) return { weight: last.weight, note: "", flags, ...(setting ? { atHardest: !!last.atHardest } : {}) }
  const next = nextWeight(from, judged.direction, loadStep, unit)
  return { weight: from > 0 ? next : undefined, note: describeWeight(judged, from, next, unit, when), decision: judged, flags, ...(setting ? { atHardest: !!last.atHardest } : {}) }
}

// ─── Which history to plan from (docs/sc-modifications-plan.md §2.4, §2.4b) ──

// One past session with its focus and date — what findScSessions returns.
// `prescribed` / `unit`: what the coach set that day, to judge it.
export interface FocusEntry {
  focus?: Focus
  date: string   // ISO
  exerciseName?: string   // what was done (a level's name)
  prescribed?: string
  unit?: "reps" | "seconds"
  summary: ScSetsSummary
}

// Explosiveness load relative to max force: what can be moved fast.
const EXPLOSIVE_WEIGHT_PCT = 0.5
// Sessions that show strength — explosiveness sets are deliberately light,
// so they never estimate a weight and never count towards "stuck".
const STRENGTH_FOCUSES: Focus[] = ["max_force", "hypertrophy"]

// The plan for an exercise programmed at `ex.focus`, from the athlete's
// sessions on it at any focus (newest first).
// - Max force / hypertrophy (or no focus): their own focus's history, as
//   planNext. None yet → borrowed from the other strength focus (§2.4b).
// - Explosiveness: starts from the latest max force session — half the
//   weight, or one level easier — whenever that's newer than the last
//   explosiveness session, so it follows max force as it improves.
//   Otherwise its own history (never steps up from reps); none at all →
//   borrowed from hypertrophy.
// - Safety rails count across focuses (§2.4b).
export function planNextForFocus(
  ex: NextExercise,
  chain: ResolvedChain | undefined,
  loadStep: number | undefined,
  unit: WeightUnit,
  entries: FocusEntry[],
  when: When,
): NextPlan {
  const rails = crossFocusRails(entries)
  const flags: NextFlags = { ...(rails.deload ? { deload: true } : {}), ...(rails.stalled ? { stalled: true } : {}) }
  const sameFocus = entries.filter((e) => !ex.focus || e.focus === ex.focus)
  const own = (): NextPlan => ({ ...planNext(ex, chain, loadStep, unit, sameFocus.map((e) => e.summary), when, ex.focus ? rails : undefined), basis: sameFocus[0] })

  if (ex.focus !== "explosiveness") {
    if (sameFocus.length > 0 || !ex.focus) return own()
    const source = entries.find((e) => e.focus && STRENGTH_FOCUSES.includes(e.focus))
    return source ? { ...borrow(ex, chain, loadStep, unit, source), flags, basis: source, ...(ex.setting ? { atHardest: false } : {}) } : { note: "", flags }
  }

  const maxForce = entries.find((e) => e.focus === "max_force")
  const lastExplosive = sameFocus[0]
  if (maxForce && (!lastExplosive || maxForce.date > lastExplosive.date)) {
    return { ...fromMaxForce(chain, loadStep, unit, maxForce.summary, ex.setting?.easier), flags, basis: maxForce, ...(ex.setting ? { atHardest: false } : {}) }
  }
  if (lastExplosive) return own()
  const hyp = entries.find((e) => e.focus === "hypertrophy")
  return hyp ? { ...borrow(ex, chain, loadStep, unit, hyp), flags, basis: hyp, ...(ex.setting ? { atHardest: false } : {}) } : { note: "", flags }
}

// Deload: the last two sessions at any focus both went down. Stuck: no
// step up in the last three max force / hypertrophy sessions. Each session
// is judged at its own focus and target.
function crossFocusRails(entries: FocusEntry[]): Rails {
  const judge = (e: FocusEntry) => {
    const t = targetFor(e.focus, e.prescribed, e.unit === "seconds" ? "seconds" : "reps")
    const d = t ? decideNext(t, e.summary.sets, e.focus, { droppedInSession: e.summary.droppedInSession }) : null
    return d && d.reason !== "no_data" ? d : null
  }
  const lastTwo = entries.slice(0, 2).map(judge)
  const deload = lastTwo.length === 2 && lastTwo.every((d) => d?.direction === "decrease")
  const strength = entries.filter((e) => e.focus && STRENGTH_FOCUSES.includes(e.focus)).slice(0, STALL_SESSIONS).map(judge)
  const stalled = strength.length === STALL_SESSIONS && strength.every((d) => d && d.direction !== "increase")
  return { deload, stalled }
}

// Estimated one-rep max (Epley) from a session's best set at its final load.
function estimatedMax(summary: ScSetsSummary): { e1rm: number; reps: number } | null {
  const w = summary.weight ?? 0
  if (w <= 0 || summary.sets.length === 0) return null
  const reps = Math.max(...summary.sets.map((s) => s.amount))
  return { e1rm: w * (1 + reps / 30), reps }
}

function roundToStep(w: number, loadStep: number | undefined, unit: WeightUnit): number {
  const step = loadStep && loadStep > 0 ? loadStep : DEFAULT_LOAD_STEP[unit]
  return Math.round(Math.max(step, Math.round(w / step) * step) * 100) / 100
}

const FOCUS_NAME: Record<Focus, string> = { max_force: "max force", hypertrophy: "hypertrophy", explosiveness: "explosiveness" }

// First time at a focus: the starting load from the latest session at
// another focus (§2.4b). Weight: the e1RM converted to today's reps (the
// middle of the range); explosiveness: half the max-force-equivalent. Ladder:
// hypertrophy one level easier than max force, max force one harder than
// hypertrophy, explosiveness one easier — skipping levels not tagged for
// today's focus.
function borrow(ex: NextExercise, chain: ResolvedChain | undefined, loadStep: number | undefined, unit: WeightUnit, source: FocusEntry): NextPlan {
  const focus = ex.focus!
  const srcName = FOCUS_NAME[source.focus!]
  if (chain) {
    const at = chainIndexOf(chain, source.summary.exerciseId)
    const fromIdx = at >= 0 ? at : chain.prescribedIdx
    const from = chain.chain[fromIdx]
    const direction = focus === "max_force" ? "increase" : "decrease"
    const move = stepLevel(chain.chain, fromIdx, direction, usableAt(chain, focus))!
    const which = direction === "increase" ? "harder" : "easier"
    const note = move.index !== fromIdx
      ? `From your ${srcName} level (${from.name}): ${move.step.name}, one level ${which}`
      : `From your ${srcName} level: ${from.name}`
    return { level: move.step, note, flags: {} }
  }
  if (ex.unit === "seconds") return { note: "", flags: {} }
  const est = estimatedMax(source.summary)
  if (!est) return { note: "", flags: {} }
  const w0 = source.summary.weight!
  if (focus === "explosiveness") {
    const mfWeight = est.e1rm / (1 + 4.5 / 30)
    const w = roundToStep(mfWeight * EXPLOSIVE_WEIGHT_PCT, loadStep, unit)
    return { weight: w, note: `For speed, from your ${srcName} (${w0} ${unit} × ${est.reps}): ~${w} ${unit}`, flags: {} }
  }
  const target = targetFor(focus, ex.reps, "reps")
  if (!target) return { note: "", flags: {} }
  const r = (target.low + target.high) / 2
  const w = roundToStep(est.e1rm / (1 + r / 30), loadStep, unit)
  return { weight: w, note: `From your ${srcName} (${w0} ${unit} × ${est.reps}): ~${w} ${unit} for ${target.low}–${target.high}`, flags: {} }
}

function fromMaxForce(chain: ResolvedChain | undefined, loadStep: number | undefined, unit: WeightUnit, mf: ScSetsSummary, easier?: string): NextPlan {
  const ease = easier ? `${lowerFirst(easier)} so you can move fast` : "make it easier if you slow down"
  if (chain) {
    const at = chainIndexOf(chain, mf.exerciseId)
    const fromIdx = at >= 0 ? at : chain.prescribedIdx
    const from = chain.chain[fromIdx]
    const usable = usableAt(chain, "explosiveness")
    const move = stepLevel(chain.chain, fromIdx, "decrease", usable)!
    const note = move.index !== fromIdx
      ? move.index === fromIdx - 1
        ? `For speed: ${move.step.name}, one level below your max force (${from.name})`
        : `For speed: ${move.step.name}, the first level below your max force (${from.name}) that can be done fast`
      : usable(from)
        ? `For speed: ${from.name} is the easiest level — ${ease}`
        : `No easier level of ${from.name} can be done fast — check the ladder's "Used for" tags`
    return { level: move.step, note, flags: {} }
  }
  const w = mf.weight ?? 0
  if (w <= 0) return { note: `For speed: easier than your max force sets — ${ease}`, flags: {} }
  const half = roundToStep(w * EXPLOSIVE_WEIGHT_PCT, loadStep, unit)
  return { weight: half, note: `For speed: ${half} ${unit}, about half your max force weight (${w} ${unit})`, flags: {} }
}

// What a suggestion is based on, for the athlete: "Last time · Sep 30 ·
// 10, 9, 8 reps", or "Based on · Sep 28 · Max force · Push-ups · 5, 5, 4
// reps" when it comes from another focus. The focus / exercise / weight are
// only named when they differ or matter. `todayName`: the exercise as
// suggested today (a level's name).
export function basisLine(plan: NextPlan, todayFocus: Focus | undefined, todayName: string, unit: WeightUnit): string | undefined {
  const e = plan.basis
  if (!e || !plan.note) return undefined
  const sameFocus = !todayFocus || e.focus === todayFocus
  const parts = [new Date(e.date).toLocaleDateString([], { month: "short", day: "numeric" })]
  if (!sameFocus && e.focus) parts.push(FOCUS_LABEL[e.focus])
  if (e.exerciseName && e.exerciseName !== todayName) parts.push(e.exerciseName)
  if (e.summary.weight) parts.push(`${e.summary.weight} ${unit}`)
  if (e.summary.atHardest) parts.push("hardest setup")
  const noun = e.unit === "seconds" ? " s" : " reps"
  parts.push(`${e.summary.sets.map((set) => set.amount).join(", ")}${noun}`)
  return `${sameFocus ? "Last time" : "Based on"} · ${parts.join(" · ")}`
}
