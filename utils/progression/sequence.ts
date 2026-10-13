import type { Attempt } from "@/hooks/WorkoutHook"
import type { SprayRouteRow } from "@/services/BoulderGraphService"
import type { BlockRun } from "@/utils/blockHistory"
import { SEQUENCE_RULES } from "@/utils/progression/profiles"
import type { Direction } from "@/utils/scProgression"
import { availableVariations, parseVariations, VARIATION_LABEL, type VariationKey } from "@/utils/sequenceVariations"

// Pure decision engine for sequence (spray-wall route) progression — spec
// §3.2 in docs/progression-spec.md. Two parts:
//   - between sessions (suggestNextSequence): reads the last run of this
//     block and suggests which route + starting variation comes next;
//   - in session (isEarlyFall / pickRoute): the live "fell on the first
//     moves" step-down SequenceBlock.tsx applies after the first attempts.
// No fetching or UI here — callers pass in history and the routes the
// athlete can see, so the athlete runtime and the coach editor share it.

// The parts of a route row the rules read.
export interface RouteInfo {
  id: string
  name: string
  level?: number
  type?: string
  wallId?: string
  hasEasy: boolean
}

export function routeInfo(row: SprayRouteRow): RouteInfo {
  return {
    id: row.$id,
    name: row.name,
    level: row.level ?? undefined,
    type: row.type ?? undefined,
    wallId: row.wallId ?? undefined,
    hasEasy: availableVariations(parseVariations(row)).includes("easy"),
  }
}

// Shared/coach routes (no owner) plus the athlete's own self-built ones —
// the same set the athlete could pick from themselves.
export function routesVisibleTo(rows: SprayRouteRow[], athleteId: string | undefined): Map<string, RouteInfo> {
  const map = new Map<string, RouteInfo>()
  for (const r of rows) {
    if (r.athleteId && r.athleteId !== athleteId) continue
    map.set(r.$id, routeInfo(r))
  }
  return map
}

// ─── Reading one run ─────────────────────────────────────────────────────────

export interface SequenceRunSummary {
  routeId: string
  attempts: number
  sends: number
  sendRate: number          // rounded to the nearest 10 %, e.g. 0.8
  startVariation: VariationKey
  finalVariation: VariationKey
}

// Rounded to the nearest 10 % (76 % → 80 %, 74 % → 70 %, 75 % → 80 %), as
// whole tenths so the ≥ comparison can't trip on float error.
function sendRateTenths(sends: number, attempts: number): number {
  return attempts > 0 ? Math.round((sends / attempts) * 10) : 0
}

function asVariation(v: unknown): VariationKey {
  return v === "easy" || v === "hard" ? v : "original"
}

// Judged on the route the athlete *ended* on: if they stepped down to an
// easier route mid-session, only the attempts on that last route count.
export function summarizeSequenceRun(attempts: Attempt[]): SequenceRunSummary | null {
  if (attempts.length === 0) return null
  const routeId = attempts[attempts.length - 1].routeId ?? ""
  let start = attempts.length - 1
  while (start > 0 && (attempts[start - 1].routeId ?? "") === routeId) start--
  const onRoute = attempts.slice(start)
  const sends = onRoute.filter((a) => a.success).length
  return {
    routeId,
    attempts: onRoute.length,
    sends,
    sendRate: sendRateTenths(sends, onRoute.length) / 10,
    startVariation: asVariation(onRoute[0].variation),
    finalVariation: asVariation(onRoute[onRoute.length - 1].variation),
  }
}

export function isPassed(s: SequenceRunSummary): boolean {
  return sendRateTenths(s.sends, s.attempts) >= Math.round(SEQUENCE_RULES.passSendRate * 10)
    && (s.finalVariation === "original" || s.finalVariation === "hard")
}

// ─── Route choice ────────────────────────────────────────────────────────────

// Same type, the target level, same wall as the route being replaced (a
// sequence is set on one physical wall). Ranked: routes this athlete has
// never passed first, then least recently climbed (never-climbed first),
// then by name so the pick is stable.
export function pickRoute(
  routes: Map<string, RouteInfo>,
  from: RouteInfo,
  level: number,
  runs: BlockRun[],
  exclude: string[] = [],
): RouteInfo | null {
  const candidates = [...routes.values()].filter((r) =>
    r.type === from.type
    && r.level === level
    && (!from.wallId || r.wallId === from.wallId)
    && r.id !== from.id
    && !exclude.includes(r.id)
  )
  if (candidates.length === 0) return null

  const lastUsed = new Map<string, number>()   // routeId → run index (0 = newest)
  const passedEver = new Set<string>()
  runs.forEach((run, i) => {
    for (const a of run.attempts) if (a.routeId && !lastUsed.has(a.routeId)) lastUsed.set(a.routeId, i)
    const s = summarizeSequenceRun(run.attempts)
    if (s && isPassed(s)) passedEver.add(s.routeId)
  })
  const recency = (id: string) => (lastUsed.has(id) ? lastUsed.get(id)! : Number.POSITIVE_INFINITY)

  candidates.sort((a, b) =>
    Number(passedEver.has(a.id)) - Number(passedEver.has(b.id))
    || recency(b.id) - recency(a.id)
    || a.name.localeCompare(b.name)
  )
  return candidates[0]
}

// Distinct routes of this type passed at this level since the athlete last
// arrived at it — walking back through runs (newest first) and stopping at
// the first one that ended on a different level of the same type.
export function passesAtLevel(runs: BlockRun[], routes: Map<string, RouteInfo>, type: string, level: number): number {
  const passed = new Set<string>()
  for (const run of runs) {
    const s = summarizeSequenceRun(run.attempts)
    const r = s ? routes.get(s.routeId) : undefined
    if (!s || !r || r.type !== type || r.level == null) continue
    if (r.level !== level) break
    if (isPassed(s)) passed.add(s.routeId)
  }
  return passed.size
}

// ─── Between sessions ────────────────────────────────────────────────────────

export interface SequenceSuggestion {
  direction: Direction
  // What to run next. Null when the rule wants a route at a level/type with
  // nothing saved — the note then says so, so the coach can set one.
  route: RouteInfo | null
  startVariation: VariationKey
  // Plain-language reason, shown on two lines: what happened last time on
  // this block, then what the rule suggests next.
  lastTime: string
  note: string
}

function lastTimeText(s: SequenceRunSummary): string {
  const pct = Math.round(s.sendRate * 100)
  const on = s.finalVariation === "original" ? "" : ` on ${VARIATION_LABEL[s.finalVariation]}`
  if (s.sends === 0) return `Last time: no sends in ${s.attempts} attempt${s.attempts !== 1 ? "s" : ""}${on}.`
  const passed = isPassed(s)
    ? " — passed"
    : s.finalVariation === "easy" ? "" : ` — needs ${Math.round(SEQUENCE_RULES.passSendRate * 100)} % to pass`
  return `Last time: sent ${s.sends} of ${s.attempts} attempts (${pct} %)${on}${passed}.`
}

// Null = no suggestion (no usable history yet, or the last route is gone) —
// the block then runs exactly as the coach authored it.
export function suggestNextSequence(runs: BlockRun[], routes: Map<string, RouteInfo>): SequenceSuggestion | null {
  const last = runs[0] ? summarizeSequenceRun(runs[0].attempts) : null
  if (!last || !last.routeId) return null
  const current = routes.get(last.routeId)
  if (!current) return null
  const { level, type } = current
  const hasLevel = level != null && !!type
  const { passesToLevelUp, maxLevel, minLevel } = SEQUENCE_RULES
  const lastTime = lastTimeText(last)

  // ≥ 80 % sends on Original/Harder.
  if (isPassed(last)) {
    if (!hasLevel) {
      return { direction: "hold", route: current, startVariation: "original", lastTime,
        note: "This sequence has no level set, so there's no next one to suggest." }
    }
    const passes = passesAtLevel(runs, routes, type!, level!)
    if (passes >= passesToLevelUp && level! < maxLevel) {
      const next = pickRoute(routes, current, level! + 1, runs)
      return { direction: "increase", route: next, startVariation: "original", lastTime,
        note: next
          ? `${passes} level ${level} sequences passed — next: move up to a level ${level! + 1} sequence.`
          : `${passes} level ${level} sequences passed — ready for level ${level! + 1}, but no level ${level! + 1} sequence is saved on this wall.` }
    }
    const next = pickRoute(routes, current, level!, runs)
    const progress = level! >= maxLevel
      ? "Level 8 is the top level."
      : `Complete ${passesToLevelUp} level ${level} sequences to move up to level ${level! + 1} (${passes} of ${passesToLevelUp} done).`
    return { direction: "hold", route: next, startVariation: "original", lastTime,
      note: next
        ? `Next: a different level ${level} sequence. ${progress}`
        : `No other level ${level} sequence is saved on this wall. ${progress}` }
  }

  // Some sends, under the bar (or only on Easier) — same route again.
  if (last.sends > 0) {
    const start = last.finalVariation
    return { direction: "hold", route: current, startVariation: start, lastTime,
      note: `Next: the same sequence again, starting on ${VARIATION_LABEL[start]}.` }
  }

  // No sends: first back off to Easier on the same route, then a level down.
  if (last.startVariation !== "easy" && current.hasEasy) {
    return { direction: "decrease", route: current, startVariation: "easy", lastTime,
      note: "Next: the same sequence, starting on Easier." }
  }
  if (!hasLevel || level! <= minLevel) {
    return { direction: "hold", route: current, startVariation: current.hasEasy ? "easy" : "original", lastTime,
      note: hasLevel
        ? "Already at the lowest level — next: the same sequence again."
        : "This sequence has no level set — next: the same sequence again." }
  }
  const lower = pickRoute(routes, current, level! - 1, runs)
  return { direction: "decrease", route: lower, startVariation: "original", lastTime,
    note: lower
      ? `Next: drop to a level ${level! - 1} sequence.`
      : `Next: drop to level ${level! - 1}, but no level ${level! - 1} sequence is saved on this wall.` }
}

// ─── In session ──────────────────────────────────────────────────────────────

// "Fell on the first moves": a fall within the first third of the sequence.
export function isEarlyFall(highPoint: number | undefined, totalMoves: number): boolean {
  if (highPoint == null) return false
  return highPoint <= Math.max(1, Math.floor(totalMoves * SEQUENCE_RULES.earlyFallFraction))
}
