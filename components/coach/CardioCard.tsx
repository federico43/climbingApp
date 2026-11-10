import { C } from "@/utils/theme"
import type { AppUser } from "@/services/BoulderGraphService"
import { deleteCardioPlan, getCardioUser, listCardioSessions, saveCardioPlan, setCardioEnabled, type CardioSessionRow } from "@/services/cardio"
import {
  coachSetStep, formatTime12, lights, MAX_STEP, protocolFor, protocolLabel, repeatedPainZone, WEEKDAY_SHORT,
  type CardioAnswers, type CardioPlan, type CardioStep, type Light,
} from "@/utils/cardio"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native"
import { card } from "./styles"

// Jump rope cardio on the coach's athlete screen (docs/cardio-rope.md): the
// switch that offers it to the athlete, the starting step (optional — by
// default the app's test picks it), the current step and cycle with − / +
// to correct them, and the last sessions.

const LIGHT_COLOR: Record<Light, string> = { green: C.green, yellow: C.yellow, red: C.red }
const OUTCOME: Record<string, string> = {
  start: "Test", up: "Up", skip: "Skip up", cycleUp: "New cycle", repeat: "Repeat", down: "Down", deloadHold: "Light week next",
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
/** "2026-11-09" → "Nov 9". */
function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number)
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${d}` : ymd
}

function parseAnswers(raw: string | null): CardioAnswers | null {
  try {
    const a = raw ? JSON.parse(raw) : null
    if (a && "capacity" in a) return a.capacity ?? null
    return a
  } catch { return null }
}

export function CardioCard({ athlete }: { athlete: AppUser }) {
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [plan, setPlan] = useState<CardioPlan | null>(null)
  const [sessions, setSessions] = useState<CardioSessionRow[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getCardioUser(athlete.$id), listCardioSessions(athlete.$id).catch(() => [])])
      .then(([u, rows]) => {
        if (cancelled) return
        setEnabled(u.enabled); setPlan(u.plan); setSessions(rows); setMissing(false)
      })
      .catch(() => { if (!cancelled) setMissing(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athlete.$id])

  async function toggle(next: boolean) {
    setEnabled(next)
    try { await setCardioEnabled(athlete.$id, next) } catch (e) {
      setEnabled(!next)
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Run scripts/cardio/create-tables.mjs first.")
    }
  }

  // The athlete's app writes the same JSON after every session: apply the
  // change to a fresh copy, so a card left open doesn't undo their progress.
  async function savePlan(change: (p: CardioPlan | null) => CardioPlan) {
    setSaving(true)
    try {
      const fresh = (await getCardioUser(athlete.$id)).plan
      const next = change(fresh)
      await saveCardioPlan(athlete.$id, next)
      setPlan(next)
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.")
    } finally { setSaving(false) }
  }

  function confirmDelete() {
    const name = athlete.username || "this athlete"
    Alert.alert(
      "Delete cardio plan?",
      `${name}'s jump rope plan and its sessions will be deleted and cardio turned off. Turning it on again starts from the intro and the test.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            setSaving(true)
            try {
              await deleteCardioPlan(athlete.$id)
              setPlan(null); setSessions([]); setEnabled(false)
            } catch (e) {
              Alert.alert("Couldn't delete", e instanceof Error ? e.message : "Try again.")
            } finally { setSaving(false) }
          },
        },
      ],
    )
  }

  const state = plan?.state ?? null
  const answers = sessions.map((r) => parseAnswers(r.answers))
  const painZone = repeatedPainZone(answers)

  return (
    <View style={card.card}>
      <View style={card.headerRow}>
        <Text style={card.title}>Jump rope cardio</Text>
        {!loading && !missing && (
          <Switch value={enabled} onValueChange={toggle} trackColor={{ true: C.green, false: C.surfaceHigh }} />
        )}
      </View>

      {loading ? <ActivityIndicator color={C.green} />
        : missing ? <Text style={card.empty}>Not set up yet: run scripts/cardio/create-tables.mjs.</Text>
        : !enabled && !plan?.committedAt ? <Text style={card.empty}>Off. Turn it on to offer the plan to {athlete.username || "the athlete"}.</Text>
        : (
          <>
            {!plan?.committedAt && <Text style={card.sub}>Waiting for {athlete.username || "the athlete"} to start it.</Text>}
            {plan?.committedAt && (
              <Text style={card.sub}>
                {plan.days.map((d) => WEEKDAY_SHORT[d]).join(", ")} · reminder {formatTime12(plan.reminderTime)}
                {!enabled ? " · switched off" : ""}
              </Text>
            )}

            {!state ? (
              <View style={{ gap: 8 }}>
                <Text style={s.label}>Starting step</Text>
                <View style={s.chips}>
                  <Chip label="App's test" disabled={saving} on={plan?.coachStartStep == null} onPress={() => savePlan((p) => coachSetStep(p, null))} />
                  {Array.from({ length: MAX_STEP + 1 }, (_, n) => (
                    <Chip key={n} label={String(n)} disabled={saving} on={plan?.coachStartStep === n}
                      onPress={() => savePlan((p) => coachSetStep(p, n as CardioStep))} />
                  ))}
                </View>
                <Text style={s.sessionText}>
                  {plan?.coachStartStep == null
                    ? "First session is the app's short test."
                    : `Starts with ${protocolLabel(protocolFor(plan.coachStartStep as CardioStep, 1))}`}
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <View style={s.stepRow}>
                  <Stepper label="Step" value={state.step} min={0} max={MAX_STEP} disabled={saving}
                    onChange={(v) => savePlan((p) => coachSetStep(p, v as CardioStep, p?.state?.cycle ?? state.cycle))} />
                  <Stepper label="Cycle" value={state.cycle} min={1} max={20} disabled={saving}
                    onChange={(v) => savePlan((p) => coachSetStep(p, (p?.state?.step ?? state.step) as CardioStep, v))} />
                </View>
                <Text style={s.protocol}>{protocolLabel(protocolFor(state.step, state.cycle))}</Text>
                {state.painCap && <Text style={s.warn}>Pain cap: at most 2 sessions a week.</Text>}
              </View>
            )}

            {painZone && (
              <View style={s.alert}>
                <Ionicons name="warning" size={14} color={C.red} />
                <Text style={s.alertText}>Pain in the {painZone} two sessions in a row.</Text>
              </View>
            )}

            {sessions.length > 0 && (
              <View style={{ gap: 6 }}>
                <View style={s.row}>
                  <Text style={s.label}>Last sessions</Text>
                  <Text style={s.legend}>Rest · Pain · Rhythm · Effort</Text>
                </View>
                {sessions.slice(0, 5).map((r, i) => {
                  const a = answers[i]
                  const l = a ? lights(a) : null
                  return (
                    <View key={r.$id} style={s.sessionRow}>
                      <Text style={s.date}>{shortDate(r.date)}</Text>
                      <Text style={s.sessionText} numberOfLines={1}>
                        {r.kind === "test" ? "Test" : `Step ${r.step}${r.kind === "deload" ? " · light" : ""}`} → {OUTCOME[r.outcome ?? ""] ?? r.outcome}
                      </Text>
                      <View style={s.lights}>
                        {l && (["rest", "pain", "pace", "effort"] as const).map((k) => (
                          <View key={k} style={[s.light, { backgroundColor: LIGHT_COLOR[l[k]] }]} />
                        ))}
                      </View>
                    </View>
                  )
                })}
              </View>
            )}

            {(plan || sessions.length > 0) && (
              <Pressable onPress={confirmDelete} disabled={saving} hitSlop={6} style={s.delete}>
                <Ionicons name="trash-outline" size={14} color={C.red} />
                <Text style={s.deleteText}>Delete plan</Text>
              </Pressable>
            )}
          </>
        )}
    </View>
  )
}

function Chip({ label, on, disabled, onPress }: { label: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.chip, on && s.chipOn, disabled && { opacity: 0.5 }]}>
      <Text style={[s.chipText, on && { color: C.green }]}>{label}</Text>
    </Pressable>
  )
}

function Stepper({ label, value, min, max, disabled, onChange }: {
  label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void
}) {
  return (
    <View style={s.stepper}>
      <Text style={s.label}>{label}</Text>
      <Pressable disabled={disabled || value <= min} onPress={() => onChange(value - 1)} hitSlop={6} style={s.stepBtn}>
        <Ionicons name="remove" size={16} color={value <= min ? C.textMuted : C.textPrimary} />
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable disabled={disabled || value >= max} onPress={() => onChange(value + 1)} hitSlop={6} style={s.stepBtn}>
        <Ionicons name="add" size={16} color={value >= max ? C.textMuted : C.textPrimary} />
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  delete: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 4 },
  deleteText: { fontSize: 13, fontWeight: "700", color: C.red },
  label: { fontSize: 11, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: C.surfaceHigh, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "transparent" },
  chipOn: { borderColor: C.green },
  chipText: { fontSize: 12.5, fontWeight: "700", color: C.textPrimary },
  stepRow: { flexDirection: "row", gap: 18 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  stepValue: { fontSize: 18, fontWeight: "800", color: C.textPrimary, minWidth: 18, textAlign: "center" },
  protocol: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  warn: { fontSize: 12.5, color: C.yellow },
  alert: { flexDirection: "row", alignItems: "center", gap: 6 },
  alertText: { fontSize: 13, fontWeight: "700", color: C.red },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  date: { fontSize: 12, color: C.textSecondary, width: 46 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  legend: { fontSize: 11, color: C.textSecondary },
  sessionText: { flex: 1, fontSize: 13, color: C.textPrimary },
  lights: { flexDirection: "row", gap: 3 },
  light: { width: 8, height: 8, borderRadius: 4 },
})
