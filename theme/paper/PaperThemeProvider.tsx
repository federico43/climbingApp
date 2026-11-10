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

/**
 * Forces a mode for everything inside. Screens not redesigned yet wrap
 * Paper components in mode="dark" so they match the old dark look.
 */
export function PaperThemeOverride({ mode, children }: { mode: PaperMode; children: React.ReactNode }) {
  const parent = useContext(PaperThemeContext)
  const value = useMemo(
    () => ({
      theme: paperThemes[mode],
      preference: parent?.preference ?? ("system" as PaperPreference),
      setPreference: parent?.setPreference ?? (() => {}),
    }),
    [mode, parent]
  )
  return <PaperThemeContext.Provider value={value}>{children}</PaperThemeContext.Provider>
}

/** StyleSheet built from the current theme: `const s = usePaperStyles(makeStyles)`. */
export function usePaperStyles<T>(make: (t: PaperTheme) => T): T {
  const t = usePaper()
  return useMemo(() => make(t), [make, t])
}
