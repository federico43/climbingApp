import AsyncStorage from "@react-native-async-storage/async-storage"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useColorScheme } from "react-native"
import { PaperMode, PaperTheme, paperThemes } from "./tokens"

// Light/dark for Paper Mint screens. Follows the phone's appearance unless
// the user picks one (stored on the device).
export type PaperPreference = "system" | PaperMode

const KEY = "paper-theme-preference"

type Ctx = {
  theme: PaperTheme
  preference: PaperPreference
  setPreference: (p: PaperPreference) => void
}

const PaperThemeContext = createContext<Ctx | null>(null)

export function PaperThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme()
  const [preference, setPref] = useState<PaperPreference>("system")

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === "light" || v === "dark" || v === "system") setPref(v)
      })
      .catch(() => {})
  }, [])

  const setPreference = useCallback((p: PaperPreference) => {
    setPref(p)
    AsyncStorage.setItem(KEY, p).catch(() => {})
  }, [])

  const mode: PaperMode = preference === "system" ? (system === "light" ? "light" : "dark") : preference
  const value = useMemo(
    () => ({ theme: paperThemes[mode], preference, setPreference }),
    [mode, preference, setPreference]
  )
  return <PaperThemeContext.Provider value={value}>{children}</PaperThemeContext.Provider>
}

/** Current Paper Mint theme. Works outside the provider too (follows the phone). */
export function usePaper(): PaperTheme {
  const ctx = useContext(PaperThemeContext)
  const system = useColorScheme()
  return ctx?.theme ?? paperThemes[system === "light" ? "light" : "dark"]
}

export function usePaperPreference() {
  const ctx = useContext(PaperThemeContext)
  return {
    preference: ctx?.preference ?? "system",
    setPreference: ctx?.setPreference ?? (() => {}),
  }
}
