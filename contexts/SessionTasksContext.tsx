import { useAuth } from "@/components/auth-context"
import { loadLocalSessionTasks, loadSessionTasks, saveSessionTasks } from "@/services/sessionTasks"
import { EMPTY_TASKS, newerList, type SessionTaskList } from "@/utils/sessionTasks"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

// The athlete's next-session tasks (docs/session-tasks.md), shared by the
// workout (adds their blocks, drops closed ones once saved), the summary's
// "Next session" card and the card on Plan / Home. Loaded once per sign-in:
// the phone copy first, then the server's if it's newer.

interface SessionTasksValue {
  list: SessionTaskList
  // The list right now, for callbacks that can't wait for a render.
  current: () => SessionTaskList
  update: (fn: (l: SessionTaskList) => SessionTaskList) => void
}

const SessionTasksContext = createContext<SessionTasksValue | null>(null)

export function SessionTasksProvider({ children }: { children: React.ReactNode }) {
  const userId = useAuth().User?.$id ?? null
  const [list, setList] = useState<SessionTaskList>(EMPTY_TASKS)
  const ref = useRef(list)

  const take = useCallback((loaded: SessionTaskList) => {
    const best = newerList(ref.current, loaded)
    if (best === ref.current) return
    ref.current = best
    setList(best)
  }, [])

  useEffect(() => {
    ref.current = EMPTY_TASKS
    setList(EMPTY_TASKS)
    if (!userId) return
    let alive = true
    loadLocalSessionTasks(userId).then((l) => { if (alive) take(l) })
    loadSessionTasks(userId).then((l) => { if (alive) take(l) })
    return () => { alive = false }
  }, [userId, take])

  const update = useCallback((fn: (l: SessionTaskList) => SessionTaskList) => {
    const next = fn(ref.current)
    if (next === ref.current) return
    ref.current = next
    setList(next)
    if (userId) saveSessionTasks(userId, next)
  }, [userId])

  const current = useCallback(() => ref.current, [])
  const value = useMemo(() => ({ list, current, update }), [list, current, update])
  return <SessionTasksContext.Provider value={value}>{children}</SessionTasksContext.Provider>
}

// Outside the provider (e.g. a coach screen rendered elsewhere): an empty,
// read-only list.
const NONE: SessionTasksValue = { list: EMPTY_TASKS, current: () => EMPTY_TASKS, update: () => {} }

export function useSessionTasks(): SessionTasksValue {
  return useContext(SessionTasksContext) ?? NONE
}
