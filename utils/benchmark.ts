// The plan's Benchmark (coach 2026-11-11): a spray-wall sequence the athlete
// picks on the plan's first test day and tries again on its last one, to
// see how the block went. It goes out as homework next to the Density test
// on the plan's test days (workoutSpec.withTest): workout 1 and the first
// workout built in the last week. The retry is pinned to the sequence of
// the first try, so the athlete goes straight to it.
// It runs like the other spray blocks (utils/sprayBlocks.ts, SprayBlock):
// a number of attempts, Top / Fell, rest between.
// Pure — no fetching or UI.
import type { SessionRow } from "@/services/BoulderGraphService"
import { sessionLocalDate } from "@/utils/planProgress"

export const BENCHMARK_NAME = "Benchmark"
export const BENCHMARK_BLOCK_TYPE = "sequence"
export const BENCHMARK_ATTEMPTS = 5
export const BENCHMARK_REST_S = 180

const sameName = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.toLowerCase()

export function isBenchmarkBlock(b: { type?: string; blockName?: string } | null | undefined): boolean {
  return !!b && b.type === BENCHMARK_BLOCK_TYPE && sameName(b.blockName, BENCHMARK_NAME)
}

// The Benchmark block. `routeId` — the sequence of the plan's first try:
// the athlete repeats it (no choosing). None → the athlete picks one.
export function benchmarkBlockDraft(routeId: string | null) {
  return {
    type: BENCHMARK_BLOCK_TYPE,
    blockName: BENCHMARK_NAME,
    description: routeId
      ? "Same sequence as the start of your plan. Give it everything and see how far you've come."
      : "Pick a hard sequence, at your limit. You'll try the same one again at the end of the plan to see how far you've come.",
    targetAttempts: BENCHMARK_ATTEMPTS,
    restTime: BENCHMARK_REST_S,
    routeId: routeId ?? "",
    routeName: "",
    routeHolds: "[]",
    athleteChoosesRoute: !routeId,
    lockRoute: !!routeId,
  }
}

// One Benchmark try: a session's attempts on the Benchmark block.
export interface BenchmarkTry {
  date: string          // YYYY-MM-DD, the session's local day
  routeId: string
  tries: number
  tops: number
  firstTop: number | null // attempt number of the first top (1-based), null = none
}

// Every Benchmark try logged on or after `since` (the plan's start), oldest
// first. A session counts once, by the first sequence logged on the block.
export function benchmarkTries(sessions: Pick<SessionRow, "$createdAt" | "protocol" | "attempts">[], since: string): BenchmarkTry[] {
  const out: BenchmarkTry[] = []
  for (const s of sessions) {
    let blocks: any[] = []
    let attempts: any[] = []
    try {
      blocks = JSON.parse(s.protocol || "[]")
      attempts = JSON.parse(s.attempts || "[]")
    } catch { continue }
    if (!Array.isArray(blocks) || !Array.isArray(attempts)) continue
    const date = sessionLocalDate(s)
    if (date < since) continue
    blocks.forEach((b, i) => {
      if (!isBenchmarkBlock(b)) return
      const mine = attempts.filter((a) => a?.blockIndex === i && typeof a.routeId === "string" && a.routeId)
      if (mine.length === 0) return
      const routeId = mine[0].routeId as string
      const onRoute = mine.filter((a) => a.routeId === routeId)
      const first = onRoute.findIndex((a) => a.success)
      out.push({
        date, routeId, tries: onRoute.length, tops: onRoute.filter((a) => a.success).length,
        firstTop: first >= 0 ? first + 1 : null,
      })
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// The plan's Benchmark: the first try and, if done, the latest try on the
// same sequence. null before the first one.
export function benchmarkComparison(
  sessions: Pick<SessionRow, "$createdAt" | "protocol" | "attempts">[],
  since: string,
): { routeId: string; first: BenchmarkTry; last: BenchmarkTry | null } | null {
  const all = benchmarkTries(sessions, since)
  if (all.length === 0) return null
  const first = all[0]
  const again = all.slice(1).filter((t) => t.routeId === first.routeId)
  return { routeId: first.routeId, first, last: again.length > 0 ? again[again.length - 1] : null }
}

// "2 tops / 5 · first on try 3", "No tops / 5".
export function benchmarkTryLabel(t: BenchmarkTry): string {
  if (t.tops === 0) return `No tops / ${t.tries}`
  return `${t.tops} top${t.tops !== 1 ? "s" : ""} / ${t.tries} · first on try ${t.firstTop}`
}

// Whether a set of homework blocks is the plan's test day (Density test +
// Benchmark). Used for its name.
export function isBenchmark(blocks: { type?: string; blockName?: string }[]): boolean {
  return blocks.some((b) => isBenchmarkBlock(b)) &&
    blocks.every((b) => isBenchmarkBlock(b) || (b.type === "exploration_session" && sameName(b.blockName, "Density test")))
}
