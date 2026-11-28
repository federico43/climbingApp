import { useAuth } from "@/components/auth-context"
import { loadLocalTechniqueProgress, loadTechniqueProgress, saveTechniqueProgress } from "@/services/techniqueProgress"
import type { TechniqueModuleId } from "@/utils/techniqueModules"
import {
  EMPTY_PROGRESS, getModuleProgress, newerProgress, withModuleProgress,
  type ModuleProgress, type TechniqueProgress,
} from "@/utils/techniqueProgress"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

// The athlete's technique module progress (docs/technique-modules.md), shared
// by the module block (reads the level, logs the session) and the Plan page.
// Loaded once per sign-in: the phone copy first, then the server's if newer.
// No reads per screen.

interface TechniqueProgressValue {
  progress: TechniqueProgress
  // The progress right now, for callbacks that can't wait for a render.
  current: () => TechniqueProgress
  // One module's progress (a fresh Level 1 when there's none yet).
  moduleProgress: (id: TechniqueModuleId) => ModuleProgress
  // Changes one module's progress; saved on the phone, then the server.
  updateModule: (id: TechniqueModuleId, fn: (p: ModuleProgress) => ModuleProgress) => void
}

const TechniqueProgressContext = createContext<TechniqueProgressValue | null>(null)

export function TechniqueProgressProvider({ children }: { children: React.ReactNode }) {
  const userId = useAuth().User?.$id ?? null
  const [progress, setProgress] = useState<TechniqueProgress>(EMPTY_PROGRESS)
  const ref = useRef(progress)

  const take = useCallback((loaded: TechniqueProgress) => {
    const best = newerProgress(ref.current, loaded)
    if (best === ref.current) return
    ref.current = best
    setProgress(best)
  }, [])

  useEffect(() => {
    ref.current = EMPTY_PROGRESS
    setProgress(EMPTY_PROGRESS)
    if (!userId) return
    let alive = true
    loadLocalTechniqueProgress(userId).then((p) => { if (alive) take(p) })
    loadTechniqueProgress(userId).then((p) => { if (alive) take(p) })
    return () => { alive = false }
  }, [userId, take])

  const current = useCallback(() => ref.current, [])
  const moduleProgress = useCallback((id: TechniqueModuleId) => getModuleProgress(ref.current, id), [])

  const updateModule = useCallback((id: TechniqueModuleId, fn: (p: ModuleProgress) => ModuleProgress) => {
    const before = getModuleProgress(ref.current, id)
    const after = fn(before)
    if (after === before) return
    // Strictly newer than any copy loaded so far, even with a skewed clock.
    const next = withModuleProgress(ref.current, id, after, Math.max(Date.now(), ref.current.updatedAt + 1))
    ref.current = next
    setProgress(next)
    if (userId) saveTechniqueProgress(userId, next)
  }, [userId])

  const value = useMemo(
    () => ({ progress, current, moduleProgress, updateModule }),
    [progress, current, moduleProgress, updateModule],
  )
  return <TechniqueProgressContext.Provider value={value}>{children}</TechniqueProgressContext.Provider>
}

// Outside the provider (e.g. a coach screen rendered elsewhere): empty, read-only.
const NONE: TechniqueProgressValue = {
  progress: EMPTY_PROGRESS,
  current: () => EMPTY_PROGRESS,
  moduleProgress: (id) => getModuleProgress(EMPTY_PROGRESS, id),
  updateModule: () => {},
}

export function useTechniqueProgress(): TechniqueProgressValue {
  return useContext(TechniqueProgressContext) ?? NONE
}
