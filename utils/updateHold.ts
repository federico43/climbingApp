import { useEffect, useSyncExternalStore } from "react"

// App-wide "don't restart right now" signal for UpdateBanner, which applies
// downloaded OTA updates while the app is open. Anything a reload would
// wreck — a running workout, a recording, an unsaved editor — holds updates
// while it's active; the update is applied as soon as the last hold lifts.

let holds = 0
const listeners = new Set<() => void>()

function emit() { listeners.forEach((l) => l()) }

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function isUpdateHeld(): boolean {
  return holds > 0
}

export function useUpdateHeld(): boolean {
  return useSyncExternalStore(subscribe, isUpdateHeld, isUpdateHeld)
}

// Holds updates while `active` is true (defaults to: while mounted).
export function useHoldUpdates(active: boolean = true) {
  useEffect(() => {
    if (!active) return
    holds++
    emit()
    return () => { holds--; emit() }
  }, [active])
}
