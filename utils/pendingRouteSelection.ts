// Hand-off channel for the "create a new route while picking one" flow.
//
// The sequence route picker lives on the protocol-designer screen, but building
// a new route happens on a separate pushed screen (sprayWallBuilder). Going back
// can't return a value through expo-router, so the builder publishes its result
// here and the picker — which registered a listener before navigating — receives
// the freshly created route (or null if the user backed out without saving).
//
// Only one create-new flow can be in flight at a time, so a single listener slot
// is sufficient. The listener fires once and is cleared, making repeat resolves
// (e.g. an unmount cancel after a successful save) harmless no-ops.

import type { SprayRouteRow } from "@/services/BoulderGraphService"

type Listener = (route: SprayRouteRow | null) => void

let listener: Listener | null = null

/** Register interest in the next route created via the builder. */
export function awaitNewRoute(cb: Listener) {
  listener = cb
}

/** Publish the create-new result: the created route, or null if cancelled. */
export function resolveNewRoute(route: SprayRouteRow | null) {
  const current = listener
  listener = null
  current?.(route)
}

/** Drop any pending listener (e.g. the awaiting screen unmounted). */
export function cancelAwaitNewRoute() {
  listener = null
}
