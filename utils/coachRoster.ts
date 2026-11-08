import { addDays, PLAN_WEEKS, planWeek } from "@/utils/planRotation"
import type { PlanPause } from "@/utils/planPauses"
import { dueByOf, homeworkStatus, type HomeworkRow } from "@/utils/homework"
import { sessionLocalDate, type ProgressSession } from "@/utils/planProgress"

// Pure derivations for the coach dashboard's roster and KPI row
// (docs/coach-dashboard.md §4.1–4.3): per-athlete summaries from the
// roster-wide queries, the KPIs, search and quick filters.

// Sessions are read this many days back for the whole roster.
export const ROSTER_WINDOW_DAYS = 60
export const INACTIVE_STEPS = [7, 14, 30] as const

export interface RosterAthlete { $id: string; username?: string | null; active?: boolean | null }

// The coach turns an athlete's account off (`users.active` = false) instead
// of deleting the row; unset counts as active, so older rows stay visible.
export const isAccountActive = (u: { active?: boolean | null } | null | undefined) => u?.active !== false
export interface RosterHomework extends HomeworkRow { athleteId?: string | null }
export interface RosterPlan { $id: string; athleteId: string; name: string; windowStart: string; windowEnd: string; pauses?: PlanPause[] }
export interface RosterSession extends ProgressSession { userId: string }

export type PlanStatus = "none" | "upcoming" | "active" | "ended"

export interface AthleteSummary {
  id: string
  name: string
  // false → the coach deactivated the account (only the Deactivated chip lists it)
  active: boolean
  pendingHomework: number
  // Overdue or "can't attend" — the ones that need the coach.
  urgentHomework: number
  plan: RosterPlan | null
  planStatus: PlanStatus
  planWeek: number | null   // 1–6 while active
  lastSessionDay: string | null
  daysSinceLast: number | null   // null = nothing in the window
}

function dayDiff(from: string, to: string): number {
  const n = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000 }
  return Math.round(n(to) - n(from))
}

// Monday of `today`'s week ("YYYY-MM-DD").
export function weekStartOf(today: string): string {
  const [y, m, d] = today.split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(today, -((dow + 6) % 7))
}

export function planStatusOf(plan: RosterPlan | null, today: string): PlanStatus {
  if (!plan) return "none"
  if (today < plan.windowStart) return "upcoming"
  if (today > plan.windowEnd) return "ended"
  return "active"
}

export function summarizeRoster(
  athletes: RosterAthlete[],
  homework: RosterHomework[],
  plans: RosterPlan[],
  sessions: RosterSession[],
  today: string,
): AthleteSummary[] {
  const sessionsBy = new Map<string, RosterSession[]>()
  for (const s of sessions) sessionsBy.set(s.userId, [...(sessionsBy.get(s.userId) ?? []), s])
  // Plans come newest first — keep the first per athlete.
  const planBy = new Map<string, RosterPlan>()
  for (const p of plans) if (!planBy.has(p.athleteId)) planBy.set(p.athleteId, p)
  // Long-past homework is ignored: a session that finished it may be older
  // than the session window, so it'd look pending.
  const cutoff = addDays(today, -ROSTER_WINDOW_DAYS)

  const out = athletes.map((a) => {
    const mine = sessionsBy.get(a.$id) ?? []
    let pending = 0
    let urgent = 0
    for (const hw of homework) {
      if (hw.athleteId !== a.$id || dueByOf(hw) < cutoff) continue
      const { state } = homeworkStatus(hw, mine, today)
      if (state === "done") continue
      pending++
      if (state === "overdue" || state === "cant_attend") urgent++
    }
    let last: string | null = null
    for (const s of mine) {
      const d = sessionLocalDate(s)
      if (!last || d > last) last = d
    }
    const plan = planBy.get(a.$id) ?? null
    const planStatus = planStatusOf(plan, today)
    return {
      id: a.$id,
      name: a.username || a.$id,
      active: isAccountActive(a),
      pendingHomework: pending,
      urgentHomework: urgent,
      plan,
      planStatus,
      planWeek: plan && planStatus === "active" ? Math.min(Math.max(planWeek(plan.windowStart, today, plan.pauses), 1), PLAN_WEEKS) : null,
      lastSessionDay: last,
      daysSinceLast: last ? Math.max(dayDiff(last, today), 0) : null,
    }
  })
  return sortRoster(out)
}

// Pending homework first (urgent ones on top), then by name.
export function sortRoster(list: AthleteSummary[]): AthleteSummary[] {
  return [...list].sort((a, b) =>
    (b.pendingHomework > 0 ? 1 : 0) - (a.pendingHomework > 0 ? 1 : 0)
    || b.urgentHomework - a.urgentHomework
    || a.name.localeCompare(b.name))
}

export const hasNoPlan = (a: AthleteSummary) => a.planStatus === "none" || a.planStatus === "ended"
export const isInactive = (a: AthleteSummary, days: number) => a.daysSinceLast === null || a.daysSinceLast >= days

export interface RosterKpis {
  withHomework: number
  withUrgentHomework: number
  workoutsThisWeek: number
  withoutPlan: number
  inactive: number
}

export function rosterKpis(
  summaries: AthleteSummary[],
  sessions: RosterSession[],
  today: string,
  inactiveDays: number,
): RosterKpis {
  const monday = weekStartOf(today)
  const live = summaries.filter((a) => a.active)
  return {
    withHomework: live.filter((a) => a.pendingHomework > 0).length,
    withUrgentHomework: live.filter((a) => a.urgentHomework > 0).length,
    // Every session counts — homework and split-off S&C are training too.
    workoutsThisWeek: sessions.filter((s) => { const d = sessionLocalDate(s); return d >= monday && d <= today }).length,
    withoutPlan: live.filter(hasNoPlan).length,
    inactive: live.filter((a) => isInactive(a, inactiveDays)).length,
  }
}

// "inactive" = no recent sessions; "deactivated" = the coach turned the account off.
export type RosterFilter = "homework" | "no_plan" | "inactive" | "deactivated"

// Case- and accent-insensitive.
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

export function filterRoster(
  summaries: AthleteSummary[],
  query: string,
  filter: RosterFilter | null,
  inactiveDays: number,
): AthleteSummary[] {
  const q = normalizeName(query)
  return summaries.filter((a) => {
    if (q && !normalizeName(a.name).includes(q)) return false
    // Deactivated accounts only show under their own chip.
    if (filter === "deactivated") return !a.active
    if (!a.active) return false
    if (filter === "homework") return a.pendingHomework > 0
    if (filter === "no_plan") return hasNoPlan(a)
    if (filter === "inactive") return isInactive(a, inactiveDays)
    return true
  })
}

// "today" / "3d" / "60d+" — the roster's last-session label.
export function lastSessionLabel(a: AthleteSummary): string {
  if (a.daysSinceLast === null) return `${ROSTER_WINDOW_DAYS}d+`
  return a.daysSinceLast === 0 ? "today" : `${a.daysSinceLast}d`
}

// "Wk 3/6" / "No plan" / "Plan ended" / "Starts soon".
export function planStatusLabel(a: AthleteSummary): string {
  switch (a.planStatus) {
    case "active": return `Wk ${a.planWeek}/${PLAN_WEEKS}`
    case "ended": return "Plan ended"
    case "upcoming": return "Starts soon"
    default: return "No plan"
  }
}
