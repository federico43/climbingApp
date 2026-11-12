import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font } from "@/theme/paper/tokens"
import React from "react"
import { StyleProp, Text, View, ViewStyle } from "react-native"
import { Mono } from "./Type"

export type DayState = "upcoming" | "trained" | "today" | "homework" | "past" | "paused"

/**
 * 30pt calendar / timeline circle. States differ by fill AND ring weight,
 * not hue alone: trained = filled, today = thick ring, homework = pink ring.
 */
export function DayCircle({ state, label, size = 30 }: { state: DayState; label?: string; size?: number }) {
  const t = usePaper()
  const dark = t.mode === "dark"
  const ring =
    state === "trained" ? { borderWidth: 1.5, borderColor: dark ? t.mint : t.ink, backgroundColor: t.mint }
    : state === "today" ? { borderWidth: 2.5, borderColor: t.mintDeep }
    : state === "homework" ? { borderWidth: 2, borderColor: t.pink }
    : state === "past" ? { backgroundColor: t.hairline }
    : state === "paused" ? { borderWidth: 1, borderStyle: "dashed" as const, borderColor: t.ringIdle }
    : { borderWidth: 1.5, borderColor: t.ringIdle }
  const glow = state === "trained" && t.glow ? { shadowColor: t.glow, shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } } : null
  const a11y = { upcoming: "to come", trained: "trained", today: "today", homework: "homework", past: "not trained", paused: "paused" }[state]
  return (
    <View
      accessible
      accessibilityLabel={label ? `${label}, ${a11y}` : a11y}
      style={[{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }, ring, glow]}
    >
      {label != null && (
        <Text style={{ fontFamily: font.title, fontSize: size * 0.4, color: state === "trained" ? t.onMint : t.ink, includeFontPadding: false }}>
          {label}
        </Text>
      )}
    </View>
  )
}

/** 6pt progress track with mintDeep fill (dark: mint + glow). progress 0–1. */
export function ProgressBar({ progress, style }: { progress: number; style?: StyleProp<ViewStyle> }) {
  const t = usePaper()
  const p = Math.max(0, Math.min(1, progress))
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}
      style={[{ height: 6, borderRadius: 3, backgroundColor: t.hairline, overflow: "visible" }, style]}
    >
      <View
        style={[
          { width: `${p * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.mintDeep },
          t.glow ? { shadowColor: t.glow, shadowOpacity: 0.6, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } } : null,
        ]}
      />
    </View>
  )
}

/** "Week 1 of 6" pill: ink (dark: deep green) with mint mono text. */
export function WeekPill({ children }: { children: string }) {
  const t = usePaper()
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: t.weekPill, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Mono color={t.mint}>{children}</Mono>
    </View>
  )
}

/** Legend for the timeline states (labels make the states readable without colour). */
export function TimelineLegend({ states = ["trained", "today", "homework", "upcoming"] }: { states?: DayState[] }) {
  const names: Record<DayState, string> = { trained: "Trained", today: "Today", homework: "Homework", upcoming: "To come", past: "Missed", paused: "Paused" }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
      {states.map((s) => (
        <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <DayCircle state={s} size={12} />
          <Mono size={9.5}>{names[s]}</Mono>
        </View>
      ))}
    </View>
  )
}
