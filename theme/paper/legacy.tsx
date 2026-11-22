import { C as LEGACY } from "@/utils/theme"
import React, { createContext, useContext } from "react"
import { TextStyle, useColorScheme } from "react-native"
import { PaperThemeOverride, usePaper, usePaperPreference } from "./PaperThemeProvider"
import { font, PaperMode, PaperTheme, paperThemes } from "./tokens"

// Paper Mint for screens written against the old dark palette (utils/theme `C`).
//
// Inside <PaperScope> (the athlete workout flow) `useC()` returns the old keys
// mapped to Paper tokens for the current light/dark mode, and sheets made with
// `paperSheet()` are rebuilt from those colours, with Archivo / JetBrains Mono
// instead of the system font. Outside the scope (the same components on coach
// screens, the session history, auth…) they keep the old look exactly.

export type Palette = { -readonly [K in keyof typeof LEGACY]: string } & {
  /** Text/icons on a filled green, red or yellow (old code used C.bg). */
  onAccent: string
  /** Homework / coach-assigned only. */
  homework: string
  /**
   * Fill for an alert state that used to be a red or yellow fill (time's up,
   * fell, stop). Paper Mint has no red or yellow: a light neutral chip with
   * an ink outline, dark text on it (C.onAccent) in both modes.
   */
  alertFill: string
  /** An old hard-coded translucent colour, as it should look here. */
  tint: (rgba: string) => string
}

type Scope = PaperMode | null

// Neutral alert chip (see Palette.alertFill). Declared before the palettes use it.
const ALERT_FILL = "#CFC7DA"

const ScopeContext = createContext<Scope>(null)

/** Turns Paper Mint on for every converted component inside. Follows the Paper theme (phone or stored choice). */
export function PaperScope({ children }: { children: React.ReactNode }) {
  const t = usePaper()
  return <ScopeContext.Provider value={t.mode}>{children}</ScopeContext.Provider>
}

/** Paper theme when inside <PaperScope>, otherwise null. */
export function usePaperScope(): PaperTheme | null {
  const mode = useContext(ScopeContext)
  return mode ? paperThemes[mode] : null
}

const legacyPalette: Palette = { ...LEGACY, onAccent: LEGACY.bg, homework: "#E0568A", alertFill: LEGACY.red, tint: (c) => c }

function paletteFor(t: PaperTheme): Palette {
  const light = t.mode === "light"
  return {
    bg: t.paper,
    // Solid (not frosted): these also back modal sheets over a dim backdrop.
    surface: light ? "#F6F2EB" : "#18151E",
    surfaceHigh: light ? "rgba(18,16,20,0.07)" : "rgba(255,255,255,0.07)",
    border: t.hairline,
    textPrimary: t.ink,
    textSecondary: t.textMuted,
    textMuted: t.label,
    // As text/icons: readable mint. As a fill, sheets swap in t.mint (see fix()).
    green: t.mintText,
    greenDeep: t.mintDeep,
    // No red or yellow in Paper Mint (docs/design-system.md §2, §10). Old
    // "red" (errors, delete, fell, went down) reads as ink and old "yellow"
    // (warnings, same, rest) as the muted label colour. Both are kept as
    // their own values (a hair off ink / label) so fix() can still tell an
    // old red or yellow fill apart and turn it into the alert chip.
    red: light ? "#16131A" : "#EEE9E1",
    yellow: light ? "#4A3F56" : "#C3BACF",
    side: light ? "#6A48D6" : "#A78BFA",
    onAccent: t.onMint,
    homework: t.pink,
    alertFill: ALERT_FILL,
    tint: (c) => tint(c, light),
  }
}

const palettes: Record<"legacy" | PaperMode, Palette> = {
  legacy: legacyPalette,
  light: paletteFor(paperThemes.light),
  dark: paletteFor(paperThemes.dark),
}

/** The old `C` keys for where this component is rendered. */
export function useC(): Palette {
  return palettes[useContext(ScopeContext) ?? "legacy"]
}

export type PaperSheet<T> = { get: (scope: Scope) => T }

/**
 * A StyleSheet that follows the scope: `const sheet = paperSheet((C) => StyleSheet.create({…}))`
 * at module level, `const styles = useSheet(sheet)` in the component. `paper`
 * (null outside the scope) is for Paper-only tweaks: `...(P && { … })`.
 */
export function paperSheet<T>(make: (C: Palette, paper: PaperTheme | null) => T): PaperSheet<T> {
  const cache: Partial<Record<"legacy" | PaperMode, T>> = {}
  return {
    get(scope) {
      const k = scope ?? "legacy"
      if (!cache[k]) {
        const built = make(palettes[k], scope ? paperThemes[scope] : null)
        cache[k] = scope ? toPaper(built, palettes[k], paperThemes[scope]) : built
      }
      return cache[k] as T
    },
  }
}

export function useSheet<T>(sheet: PaperSheet<T>): T {
  return sheet.get(useContext(ScopeContext))
}

// ─── Old style → Paper style ──────────────────────────────────────────────────

function toPaper<T>(sheet: T, p: Palette, t: PaperTheme): T {
  const out: any = {}
  for (const [name, style] of Object.entries(sheet as any)) {
    out[name] = style && typeof style === "object" ? fix({ ...(style as any) }, p, t) : style
  }
  return out
}


function fix(s: any, p: Palette, t: PaperTheme) {
  const light = t.mode === "light"
  for (const k of Object.keys(s)) {
    if (/color$/i.test(k) && typeof s[k] === "string") s[k] = tint(s[k], light)
  }
  // Fills: mint is the action colour; old red/yellow fills become the
  // neutral alert chip (Paper Mint has no red or yellow).
  if (s.backgroundColor === p.green) s.backgroundColor = t.mint
  else if (s.backgroundColor === p.red || s.backgroundColor === p.yellow) {
    // Old red / yellow fill → the neutral alert chip, outlined in ink.
    s.backgroundColor = ALERT_FILL
    s.borderWidth = Math.max(s.borderWidth ?? 0, 1.5)
    s.borderColor = t.ink
    if (s.shadowColor === p.red || s.shadowColor === p.yellow) s.shadowColor = "transparent"
  }
  if (s.borderColor === p.green) s.borderColor = t.mintDeep
  // Old yellow also meant "score / achievement" on big numbers: those read in ink.
  if (s.color === p.yellow && (s.fontSize ?? 0) >= 24) s.color = t.ink
  // Old code wrote text on green buttons in the background colour.
  if (s.color === p.bg) s.color = p.onAccent
  if (s.backgroundColor === t.mint && (s.paddingVertical ?? 0) >= 12 && s.alignItems === "center") {
    // Full-width action buttons → the Paper pill with an outline.
    s.borderRadius = Math.max(s.borderRadius ?? 0, 26)
    s.borderWidth = 1.5
    s.borderColor = light ? t.ink : t.mint
  }
  if (isTextBase(s)) Object.assign(s, typeFor(s))
  return s
}

// A size-only modifier ({ fontSize: 11 } stacked on a base style) keeps the
// base's font; anything that sets a weight, a case or a colour picks its own.
const SIZE_KEYS = new Set(["fontSize", "lineHeight", "letterSpacing"])
function isTextBase(s: any) {
  if ("fontWeight" in s || "textTransform" in s) return true
  if (!("fontSize" in s)) return false
  return Object.keys(s).some((k) => !SIZE_KEYS.has(k))
}

// Translucent tints written for the old dark screens → Paper colours.
const OLD_GREEN = "111,207,151"
const OLD_YELLOW = "254,215,102"
const OLD_RED = "219,80,74"

function tint(c: string, light: boolean): string {
  const m = c.replace(/\s/g, "").match(/^rgba\((\d+,\d+,\d+),([\d.]+)\)$/)
  if (!m) {
    if (c === "#1B2A22") return light ? "rgba(138,214,162,0.22)" : "#14231A"
    return c
  }
  const [, rgb, aStr] = m
  const a = Number(aStr)
  const k = light ? 1.6 : 1
  const out = (v: string, alpha: number) => `rgba(${v},${Math.min(1, Math.round(alpha * 100) / 100)})`
  if (rgb === OLD_GREEN || rgb === "98,201,154") return out("138,214,162", a * k)
  // Old yellow / red tints → a neutral ink (light) or paper (dark) wash.
  if (rgb === OLD_YELLOW || rgb === OLD_RED) return out(light ? "18,16,20" : "241,236,228", a * (light ? 0.6 : 1))
  if (light && rgb === "255,255,255" && a < 0.6) return out("18,16,20", a * 0.6)
  return c
}

const WEIGHT: Record<string, number> = { normal: 400, bold: 700 }

/** System font → Archivo / JetBrains Mono, by role. */
function typeFor(s: TextStyle): TextStyle {
  // Already a Paper font: one weight per file, so drop the system weight.
  if (s.fontFamily) return { fontWeight: undefined }
  const size = s.fontSize ?? 14
  const w = WEIGHT[String(s.fontWeight ?? "normal")] ?? Number(s.fontWeight ?? 400)
  const out: TextStyle = { fontWeight: undefined }
  if (s.textTransform === "uppercase" && size <= 14) {
    // Eyebrows / labels: mono, tracked like poster credits.
    out.fontFamily = font.mono
    out.fontSize = Math.min(size, 12)
    out.letterSpacing = Math.round(Math.min(size, 12) * 0.12 * 10) / 10
  } else if (size >= 26 && w >= 600) {
    // Big numbers and screen titles: condensed black.
    out.fontFamily = font.title
    out.letterSpacing = -0.01 * size
  } else {
    out.fontFamily = w >= 800 ? font.bold : w >= 700 ? font.bodyBold : font.body
  }
  return out
}

/**
 * Dark Paper Mint whatever the theme: for media screens (video player, coach
 * feedback recorder, spray wall photo editor) where photos and video read
 * best on a dark frame.
 */
export function PaperDark({ children }: { children: React.ReactNode }) {
  return (
    <PaperThemeOverride mode="dark">
      <PaperScope>{children}</PaperScope>
    </PaperThemeOverride>
  )
}

/**
 * Back to the app's own theme (the user's light / dark / system choice)
 * inside a forced one — e.g. a sheet opened from the coach's ink plan card,
 * which is dark inside whatever the app's mode.
 */
export function PaperAppTheme({ children }: { children: React.ReactNode }) {
  const { preference } = usePaperPreference()
  const system = useColorScheme()
  const inPaper = usePaperScope() !== null
  const mode: PaperMode = preference === "system" ? (system === "light" ? "light" : "dark") : preference
  if (!inPaper) return <>{children}</>
  return (
    <PaperThemeOverride mode={mode}>
      <PaperScope>{children}</PaperScope>
    </PaperThemeOverride>
  )
}
