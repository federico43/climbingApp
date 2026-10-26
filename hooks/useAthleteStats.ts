import {
  AppUser, listPlanWorkouts, listTrainingPlans, ProtocolRow, SessionRow, TrainingPlanRow,
} from "@/services/BoulderGraphService"
import type { PeriodStats } from "@/utils/athleteStats"
import { buildAllBlocksStats, buildBlockStats, parseSessions, type StatsLibraryExercise } from "@/utils/athleteStatsData"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { localDateStr } from "@/utils/planRotation"
import { useCallback, useEffect, useMemo, useState } from "react"

// The coach Stats card's data (docs/athlete-stats.md). This block comes
// from what the athlete detail already loaded; every plan (for All blocks
// and the reviews) is fetched the first time it's asked for.
export function useAthleteStats({ athlete, plan, sessions, planWorkouts }: {
  athlete: AppUser
  plan: TrainingPlanRow | null
  sessions: SessionRow[]
  planWorkouts: ProtocolRow[]
}) {
  const [library, setLibrary] = useState<StatsLibraryExercise[]>([])
  const [plans, setPlans] = useState<TrainingPlanRow[] | null>(null)
  const [workoutsByPlan, setWorkoutsByPlan] = useState<Record<string, ProtocolRow[]>>({})
  const [loadingPlans, setLoadingPlans] = useState(false)
  const today = localDateStr(new Date())

  useEffect(() => {
    let cancelled = false
    getExerciseLibrary()
      .then((rows) => { if (!cancelled) setLibrary(rows as StatsLibraryExercise[]) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [])

  // A new athlete: forget the last one's plans.
  useEffect(() => {
    setPlans(null)
    setWorkoutsByPlan({})
  }, [athlete.$id])

  const loadPlans = useCallback(async () => {
    if (plans || loadingPlans) return
    setLoadingPlans(true)
    try {
      const rows = await listTrainingPlans(athlete.$id)
      const lists = await Promise.all(rows.map((p) => listPlanWorkouts(p.$id).catch(() => [] as ProtocolRow[])))
      setWorkoutsByPlan(Object.fromEntries(rows.map((p, i) => [p.$id, lists[i]])))
      setPlans(rows)
    } catch (e) {
      console.error(e)
      setPlans([])
    } finally {
      setLoadingPlans(false)
    }
  }, [athlete.$id, plans, loadingPlans])

  const parsed = useMemo(() => parseSessions(sessions), [sessions])

  const blockStats: PeriodStats | null = useMemo(() => {
    if (!plan || plan.windowStart > today) return null
    return buildBlockStats({ athlete, sessions, library, today, plan, planWorkouts }, parsed)
  }, [athlete, plan, sessions, library, today, planWorkouts, parsed])

  const allStats: PeriodStats | null = useMemo(() => {
    if (!plans) return null
    return buildAllBlocksStats({ athlete, sessions, library, today, plans, workoutsByPlan })
  }, [athlete, sessions, library, today, plans, workoutsByPlan])

  // Plans that have started, newest first — the ones a review can show.
  const reviewPlans = useMemo(
    () => (plans ?? []).filter((p) => p.windowStart <= today).sort((a, b) => (a.windowStart < b.windowStart ? 1 : -1)),
    [plans, today],
  )

  const statsForPlan = useCallback((p: TrainingPlanRow): PeriodStats => {
    // The active plan's workouts are the detail's own (kept fresh as the
    // coach builds them).
    const workouts = p.$id === plan?.$id ? planWorkouts : workoutsByPlan[p.$id] ?? []
    return buildBlockStats({ athlete, sessions, library, today, plan: p, planWorkouts: workouts }, parsed)
  }, [athlete, sessions, library, today, plan, planWorkouts, workoutsByPlan, parsed])

  return { blockStats, allStats, reviewPlans, statsForPlan, loadPlans, loadingPlans, plansLoaded: plans != null }
}
