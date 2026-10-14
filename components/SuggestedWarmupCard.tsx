import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { injectLocalIds, type Block } from "@/components/workoutBlocks"
import { BlockRow, getSessionsByUserId, getUsers, listBlocksByType, SessionRow } from "@/services/BoulderGraphService"
import { resolveAdaptation } from "@/utils/adaptations"
import { constraintWarmupDrafts } from "@/utils/planWorkout"
import { suggestWarmup, WARMUP_PILLAR_LABEL, warmupCandidates, warmupPillarFor, warmupUsage } from "@/utils/progression/constraintWarmup"
import type { WarmupPillar } from "@/utils/progression/profiles"
import { C } from "@/utils/theme"
import React, { useEffect, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

// Coach-side "Suggested warm-up" for the athlete workout builder: the 3
// constraints the rotation (utils/progression/constraintWarmup.ts) picks for
// the day's main pillar, with colours and attempts, and one tap to put them
// in the workout as separate blocks. The training-plan algorithm adds the
// same warm-up to its suggested workouts on its own; here the pillar
// defaults to the workout's most common main pillar and the coach can switch
// it. No flash level → every constraint on orange (coach's rule).

// One chip per warm-up group (strength and power endurance share one).
const PILLARS = Object.keys(WARMUP_PILLAR_LABEL) as WarmupPillar[]

// The most common main pillar (as a rotation group) among the workout's
// other blocks (first block wins a tie); null when there's none.
function workoutPillar(blocks: Block[]): WarmupPillar | null {
  const counts = new Map<WarmupPillar, number>()
  const order: WarmupPillar[] = []
  for (const b of blocks) {
    if (b.type === "constraint_warmup") continue
    const p = warmupPillarFor(resolveAdaptation(b))
    if (!p) continue
    if (!counts.has(p)) order.push(p)
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  let best: WarmupPillar | null = null
  for (const p of order) if (!best || counts.get(p)! > counts.get(best)!) best = p
  return best
}

export function SuggestedWarmupCard({ athleteId, blocks, onApply }: {
  athleteId: string
  blocks: Block[]
  onApply: (next: Block[]) => void
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [library, setLibrary] = useState<BlockRow[]>([])
  const [flash, setFlash] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // Coach's pick; null = follow the workout's blocks.
  const [chosenPillar, setChosenPillar] = useState<WarmupPillar | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSessionsByUserId(athleteId), listBlocksByType("constraint_warmup"), getUsers(athleteId)])
      .then(([s, rows, user]) => {
        if (cancelled) return
        setSessions(s)
        setLibrary(rows)
        setFlash((user as any)?.flashLevel ?? null)
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [athleteId])

  const pillar = chosenPillar ?? workoutPillar(blocks)
  const picks = useMemo(() => {
    if (!pillar) return null
    const candidates = warmupCandidates(library)
    return suggestWarmup(candidates, pillar, warmupUsage(sessions, candidates), flash)
  }, [pillar, library, sessions, flash])

  if (!loaded) return null

  const hasWarmup = blocks.some((b) => b.type === "constraint_warmup")
  function apply() {
    if (!picks) return
    const rest = blocks.filter((b) => b.type !== "constraint_warmup")
    // After the leading S&C block(s), before the rest — same order as plan workouts.
    let at = 0
    while (at < rest.length && rest[at].type === "strength_conditioning") at++
    onApply([...rest.slice(0, at), ...injectLocalIds(constraintWarmupDrafts(picks, library)), ...rest.slice(at)])
  }

  return (
    <View style={s.card}>
      <Text style={s.title}>Suggested warm-up</Text>
      {!flash && <Text style={s.hint}>No flash level set — every constraint on orange.</Text>}
      <View style={s.chipRow}>
        {PILLARS.map((p) => {
          const on = pillar === p
          return (
            <Pressable key={p} onPress={() => setChosenPillar(p)} style={[s.chip, on && s.chipOn]}>
              <Text style={[s.chipText, on && s.chipTextOn]}>{WARMUP_PILLAR_LABEL[p]}</Text>
            </Pressable>
          )
        })}
      </View>
      {!pillar ? (
        <Text style={s.text}>Pick the warm-up focus.</Text>
      ) : !picks ? (
        <Text style={s.text}>No constraints in the rotation for this group.</Text>
      ) : (
        <>
          {picks.map((p, i) => {
            const opt = BoulderLevelOptions.find((o) => o.value === p.colour)
            return (
              <View key={p.id} style={s.pickRow}>
                <Text style={s.pickNum}>{i + 1}</Text>
                <Text style={s.pickName} numberOfLines={1}>{p.name}</Text>
                <View style={[s.dot, { backgroundColor: opt?.color ?? C.border }]} />
                <Text style={s.pickMeta}>{opt?.label ?? p.colour} · {p.attempts} attempt{p.attempts !== 1 ? "s" : ""}</Text>
              </View>
            )
          })}
          <Pressable onPress={apply} hitSlop={6}>
            <Text style={s.action}>{hasWarmup ? "Replace the warm-up with these" : "Add these to the workout"}</Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "rgba(111,207,151,0.12)", borderWidth: 1, borderColor: C.green,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 6, marginHorizontal: 12, marginBottom: 8,
  },
  title: { fontSize: 11, fontWeight: "700", color: C.green, textTransform: "uppercase", letterSpacing: 0.6 },
  text: { fontSize: 12.5, fontWeight: "600", color: C.green, lineHeight: 17 },
  hint: { fontSize: 12, color: C.textMuted, marginHorizontal: 12, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  chipOn: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 12, fontWeight: "600", color: C.textSecondary },
  chipTextOn: { color: C.bg, fontWeight: "700" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pickNum: { width: 14, fontSize: 13, fontWeight: "800", color: C.textMuted, fontVariant: ["tabular-nums"] },
  pickName: { flex: 1, fontSize: 14, fontWeight: "700", color: C.textPrimary },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pickMeta: { fontSize: 12.5, color: C.textSecondary },
  action: { fontSize: 13, fontWeight: "700", color: C.green, textDecorationLine: "underline", marginTop: 2 },
})
