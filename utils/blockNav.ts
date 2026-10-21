import { createContext, useContext } from "react"

// Tells a block whether it's the workout's last one, so its "advance" button
// can read "Finish workout" instead of suggesting there's another block.
export const LastBlockContext = createContext(false)

export const useNextBlockLabel = (label: string) =>
  useContext(LastBlockContext) ? "Finish workout" : label
