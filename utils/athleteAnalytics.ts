import type { SessionRow } from "@/services/BoulderGraphService"
import { ADAPTATION_COLOR, ADAPTATIONS, Adaptation, resolveAdaptation } from "@/utils/adaptations"

// Analytics derived from an athlete's session history. Pure functions over
// SessionRow[] so they're easy to test and reuse.

// When a block has no recorded duration, estimate it so older sessions (saved
// before blockDurations existed) still contribute to volume.
const FALLBACK_BLOCK_SECS = 600 // 10 min

function sessionDate(s: SessionRow): Date {
  try {
    const attempts = JSON.parse(s.attempts)
    if (attempts.length > 0 && attempts[0]?.timestamp) return new Date(attempts[0].timestamp)
  } catch { /* fall through */ }
  return new Date(s.$createdAt)
}

function mondayOf(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay()
  const diff = day === 0 ? 6 : day - 1
  x.setDate(x.getDate() - diff)
  x.setHours(0, 0, 0, 0)
  return x
}

function weekLabel(monday: Date): string {
  return monday.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// Continuous list of week-start Mondays from the earliest session to this week,
// capped to the most recent `maxWeeks`.
function weekSpine(sessions: SessionRow[], maxWeeks: number): Date[] {
  if (sessions.length === 0) return []
  const dates = sessions.map(sessionDate)
  const firstMonday = mondayOf(new Date(Math.min(...dates.map((d) => d.getTime()))))
  const thisMonday = mondayOf(new Date())
  const weeks: Date[] = []
  for (let m = new Date(firstMonday); m <= thisMonday; m.setDate(m.getDate() + 7)) {
    weeks.push(new Date(m))
  }
  return weeks.slice(-maxWeeks)
}

// ── Frequency: sessions per week ──────────────────────────────────────────────

export interface FreqBar { value: number; label: string }

export function weeklyFrequency(sessions: SessionRow[], maxWeeks = 12): FreqBar[] {
  const weeks = weekSpine(sessions, maxWeeks)
  return weeks.map((monday) => {
    const wkEnd = new Date(monday); wkEnd.setDate(wkEnd.getDate() + 7)
    const count = sessions.filter((s) => {
      const d = sessionDate(s)
      return d >= monday && d < wkEnd
    }).length
    return { value: count, label: weekLabel(monday) }
  })
}

// ── Adaptation volume per week (the periodization eyeball view) ───────────────

export interface AdaptationVolume {
  // gifted-charts stackData shape, one entry per week.
  weeks: { label: string; stacks: { value: number; color: string }[] }[]
  // Adaptations that actually appear, for a legend (in fixed order).
  present: Adaptation[]
}

export function weeklyAdaptationVolume(sessions: SessionRow[], maxWeeks = 10): AdaptationVolume {
  const weeks = weekSpine(sessions, maxWeeks)
  const present = new Set<Adaptation>()

  const perWeek = weeks.map((monday) => {
    const wkEnd = new Date(monday); wkEnd.setDate(wkEnd.getDate() + 7)
    const mins: Record<string, number> = {}

    for (const s of sessions) {
      const d = sessionDate(s)
      if (d < monday || d >= wkEnd) continue
      let blocks: any[] = []
      let durations: Record<string, number> = {}
      try { blocks = JSON.parse(s.protocol) } catch { /* skip */ }
      try { durations = s.blockDurations ? JSON.parse(s.blockDurations) : {} } catch { /* none */ }
      blocks.forEach((block, i) => {
        const adapt = resolveAdaptation(block)
        const secs = Number(durations[String(i)]) || FALLBACK_BLOCK_SECS
        mins[adapt] = (mins[adapt] ?? 0) + secs / 60
        present.add(adapt)
      })
    }
    return { monday, mins }
  })

  // Fixed adaptation order so stacks line up across weeks. Keep the full set on
  // every week (zeros included) — gifted-charts crashes on an empty stacks
  // array (a week with no sessions), and consistent stacks render correctly.
  const order = ADAPTATIONS.filter((a) => present.has(a))
  const weeksOut = perWeek.map(({ monday, mins }) => ({
    label: weekLabel(monday),
    stacks: order.map((a) => ({ value: Math.round(mins[a] ?? 0), color: ADAPTATION_COLOR[a] })),
  }))

  return { weeks: weeksOut, present: order }
}

// ── Per-session bars (one vertical bar per session, split by adaptation) ──────

export interface SessionBar {
  sessionId: string
  date: Date
  dateStr: string                              // YYYY-MM-DD (for the detail modal)
  label: string                                // short "M/D" label
  totalMin: number
  segments: { color: string; min: number }[]   // top→bottom, fixed adaptation order
}

export function sessionBars(sessions: SessionRow[]): { bars: SessionBar[]; present: Adaptation[] } {
  const present = new Set<Adaptation>()
  const sorted = [...sessions].sort((a, b) => sessionDate(a).getTime() - sessionDate(b).getTime())

  const bars: SessionBar[] = sorted.map((s) => {
    let blocks: any[] = []
    let durations: Record<string, number> = {}
    try { blocks = JSON.parse(s.protocol) } catch { /* skip */ }
    try { durations = s.blockDurations ? JSON.parse(s.blockDurations) : {} } catch { /* none */ }

    const mins: Record<string, number> = {}
    blocks.forEach((block, i) => {
      const adapt = resolveAdaptation(block)
      const secs = Number(durations[String(i)]) || FALLBACK_BLOCK_SECS
      mins[adapt] = (mins[adapt] ?? 0) + secs / 60
      present.add(adapt)
    })

    const segments = ADAPTATIONS
      .filter((a) => (mins[a] ?? 0) > 0)
      .map((a) => ({ color: ADAPTATION_COLOR[a], min: Math.round(mins[a]) }))
    const totalMin = segments.reduce((sum, seg) => sum + seg.min, 0)
    const d = sessionDate(s)

    return {
      sessionId: s.$id,
      date: d,
      dateStr: d.toISOString().slice(0, 10),
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      totalMin,
      segments,
    }
  })

  return { bars, present: ADAPTATIONS.filter((a) => present.has(a)) }
}

// ── Headline stats ────────────────────────────────────────────────────────────

export interface TrainingStats {
  total: number
  avgPerWeek: number
  weeksTracked: number
}

export function trainingStats(sessions: SessionRow[]): TrainingStats {
  if (sessions.length === 0) return { total: 0, avgPerWeek: 0, weeksTracked: 0 }
  const dates = sessions.map(sessionDate)
  const span = mondayOf(new Date()).getTime() - mondayOf(new Date(Math.min(...dates.map((d) => d.getTime())))).getTime()
  const weeksTracked = Math.max(1, Math.round(span / (7 * 86400000)) + 1)
  return {
    total: sessions.length,
    avgPerWeek: Math.round((sessions.length / weeksTracked) * 10) / 10,
    weeksTracked,
  }
}
