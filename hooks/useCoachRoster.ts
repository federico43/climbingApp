import {
  AppUser,
  getAthletes,
  listActivePlans,
  listAllHomework,
  listRecentSessions,
  ProtocolRow,
  SessionRow,
  TrainingPlanRow,
} from "@/services/BoulderGraphService"
import { ROSTER_WINDOW_DAYS, summarizeRoster, type AthleteSummary } from "@/utils/coachRoster"
import { addDays, localDateStr } from "@/utils/planRotation"
import { useCallback, useMemo, useRef, useState } from "react"

// The coach dashboard's roster-wide data (docs/coach-dashboard.md §4.1):
// every athlete, all homework, all active plans and the last 60 days of
// sessions — four queries, not four per athlete. A failed side query
// (e.g. a missing index) leaves its part empty rather than the whole roster.
export function useCoachRoster() {
  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [homework, setHomework] = useState<ProtocolRow[]>([])
  const [plans, setPlans] = useState<TrainingPlanRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const run = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++run.current
    const today = localDateStr(new Date())
    const since = new Date(addDays(today, -ROSTER_WINDOW_DAYS) + "T00:00:00").toISOString()
    const soft = <T,>(p: Promise<T[]>, what: string) => p.catch((e) => { console.error(what, e); return [] as T[] })
    try {
      const [a, h, p, s] = await Promise.all([
        getAthletes(),
        soft(listAllHomework(), "homework"),
        soft(listActivePlans(), "plans"),
        soft(listRecentSessions(since), "sessions"),
      ])
      if (id !== run.current) return
      setAthletes(a)
      setHomework(h)
      setPlans(p)
      setSessions(s)
      setError(false)
    } catch (e) {
      console.error(e)
      if (id === run.current) setError(true)
    } finally {
      if (id === run.current) setLoading(false)
    }
  }, [])

  const summaries: AthleteSummary[] = useMemo(
    () => summarizeRoster(athletes, homework, plans, sessions, localDateStr(new Date())),
    [athletes, homework, plans, sessions],
  )

  return { athletes, summaries, sessions, loading, error, refresh }
}
