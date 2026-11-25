import { createContext, useContext } from "react"

// Lets a block tell the workout host "the athlete has started me" so the host's
// time-constraint countdown begins on the block's Start (not on block entry,
// which would tick during the intro/ready screen). `start()` is idempotent per
// block — the host ignores repeat calls until the next block.
export type BlockTimerApi = { start: () => void }

export const BlockTimerContext = createContext<BlockTimerApi>({ start: () => {} })

export const useBlockTimer = () => useContext(BlockTimerContext)

// The workout's shared rest timer (hooks/WorkoutHook.tsx startRestTimer):
// lets the blocks that show it pause / resume it without threading props.
export type RestPauseApi = { paused: boolean; toggle: () => void }

export const RestPauseContext = createContext<RestPauseApi>({ paused: false, toggle: () => {} })

export const useRestPause = () => useContext(RestPauseContext)
