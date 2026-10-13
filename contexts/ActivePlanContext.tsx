import { ConsumeAuth } from "@/components/auth-context"
import { getActiveTrainingPlan, TrainingPlanRow } from "@/services/BoulderGraphService"
import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { AppState } from "react-native"

// The signed-in athlete's active training plan. With one, the Plan tab is
// the app's home: the Home tab and (for athletes) the tab bar go away
// (docs/redesign.md §9). Unreadable (no permission) counts as no plan.

interface ActivePlanValue {
  plan: TrainingPlanRow | null
  loading: boolean
  refresh: () => Promise<TrainingPlanRow | null>
}

const ActivePlanContext = createContext<ActivePlanValue | undefined>(undefined)

export function ActivePlanProvider({ children }: { children: React.ReactNode }) {
  const { User } = ConsumeAuth()
  const [plan, setPlan] = useState<TrainingPlanRow | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!User) {
      setPlan(null)
      setLoading(false)
      return null
    }
    try {
      const active = await getActiveTrainingPlan(User.$id)
      setPlan(active)
      return active
    } catch {
      setPlan(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [User])

  // On sign-in, and whenever the app comes back to the front (the coach may
  // have started or ended a plan meanwhile).
  useEffect(() => {
    refresh()
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh() })
    return () => sub.remove()
  }, [refresh])

  return <ActivePlanContext.Provider value={{ plan, loading, refresh }}>{children}</ActivePlanContext.Provider>
}

export function useActivePlan(): ActivePlanValue {
  const ctx = useContext(ActivePlanContext)
  if (!ctx) throw new Error("useActivePlan must be used inside <ActivePlanProvider>")
  return ctx
}
