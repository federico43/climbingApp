import {
  AppUser, listPlanWorkouts, listTrainingPlans, ProtocolRow, SessionRow, TrainingPlanRow,
} from "@/services/BoulderGraphService"
import type { PeriodStats } from "@/utils/athleteStats"
import { buildAllBlocksStats, buildBlockStats, parseSessions, type StatsLibraryExercise } from "@/utils/athleteStatsData"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { localDateStr } from "@/utils/planRotation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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

  // A new athlete: forget the last one's plans (and ignore a load still
  // running for them).
  const athleteRef = useRef(athlete.$id)
  useEffect(() => {
    athleteRef.current = athlete.$id
    setPlans(null)
    setWorkoutsByPlan({})
  }, [athlete.$id])

  const loadPlans = useCallback(async () => {
    if (plans || loadingPlans) return
    const id = athlete.$id
    setLoadingPlans(true)
    try {
      const rows = await listTrainingPlans(id)
      const lists = await Promise.all(rows.map((p) => listPlanWorkouts(p.$id).catch(() => [] as ProtocolRow[])))
      if (athleteRef.current !== id) return
      setWorkoutsByPlan(Object.fromEntries(rows.map((p, i) => [p.$id, lists[i]])))
      setPlans(rows)
    } catch (e) {
      console.error(e)
      if (athleteRef.current === id) setPlans([])
    } finally {
      setLoadingPlans(false)
    }
  }, [athlete.$id, plans, loadingPlans])

  const parsed = useMemo(() => parseSessions(sessions), [sessions])

  // The loaded plans with the active one as the detail has it now: a pause
  // or new end date the coach just set, its workouts as they're built, or
  // a plan created after the load.
  const plansNow = useMemo(() => {
    if (!plans) return null
    if (!plan) return plans
    return plans.some((p) => p.$id === plan.$id) ? plans.map((p) => (p.$id === plan.$id ? plan : p)) : [...plans, plan]
  }, [plans, plan])
  const workoutsNow = useMemo(
    () => (plan ? { ...workoutsByPlan, [plan.$id]: planWorkouts } : workoutsByPlan),
    [workoutsByPlan, plan, planWorkouts],
  )

  const blockStats: PeriodStats | null = useMemo(() => {
    if (!plan || plan.windowStart > today) return null
    return buildBlockStats({ athlete, sessions, library, today, plan, planWorkouts }, parsed)
  }, [athlete, plan, sessions, library, today, planWorkouts, parsed])

  const allStats: PeriodStats | null = useMemo(() => {
    if (!plansNow) return null
    return buildAllBlocksStats({ athlete, sessions, library, today, plans: plansNow, workoutsByPlan: workoutsNow })
  }, [athlete, sessions, library, today, plansNow, workoutsNow])

  // Plans that have started, newest first — the ones a review can show.
  const reviewPlans = useMemo(
    () => (plansNow ?? []).filter((p) => p.windowStart <= today).sort((a, b) => (a.windowStart < b.windowStart ? 1 : -1)),
    [plansNow, today],
  )

  const statsForPlan = useCallback((p: TrainingPlanRow): PeriodStats => {
    return buildBlockStats({ athlete, sessions, library, today, plan: p, planWorkouts: workoutsNow[p.$id] ?? [] }, parsed)
  }, [athlete, sessions, library, today, workoutsNow, parsed])

  return { blockStats, allStats, reviewPlans, statsForPlan, loadPlans, loadingPlans, plansLoaded: plans != null }
}
