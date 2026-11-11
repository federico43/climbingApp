import { C } from "@/utils/theme"
import { card } from "@/components/coach/styles"
import { AppUser, createProtocol, getUsers, setEdgeLiftMax } from "@/services/BoulderGraphService"
import { notifyHomeworkAssigned } from "@/services/homework"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { currentMax, EDGE_LIFT_NAME, EDGE_WARMUP, isEdgeLift, parseMaxLog, type MaxEntry } from "@/utils/edgeWarmup"
import { defaultDueBy, shortDay } from "@/utils/homework"
import { localDateStr } from "@/utils/planRotation"
import { exerciseDraftFromLibrary } from "@/utils/scPlanBuilder"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native"

export const MAX_TEST_NAME = "Edge lift max test"

// Coach: the athlete's Edge Lifts max (utils/edgeWarmup.ts) — type it, or
// send the max test as homework (done together; the athlete logs the
// weight and it becomes the max). Re-reads the row like useFlashLevel.
export function EdgeLiftMaxSection({ athlete, onHomeworkChanged }: {
  athlete: AppUser
  onHomeworkChanged?: () => void
}) {
  const [max, setMax] = useState<number | null>(currentMax(athlete))
  const [log, setLog] = useState<MaxEntry[]>(parseMaxLog(athlete.edgeLiftMaxLog))
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState<"save" | "test" | null>(null)

  useEffect(() => {
    let cancelled = false
    setMax(currentMax(athlete))
    setLog(parseMaxLog(athlete.edgeLiftMaxLog))
    setDraft("")
    getUsers(athlete.$id).then((row: any) => {
      if (cancelled || !row) return
      setMax(currentMax(row))
      setLog(parseMaxLog(row.edgeLiftMaxLog))
    })
    return () => { cancelled = true }
  }, [athlete])

  async function save() {
    const kg = parseFloat(draft.replace(",", "."))
    if (!(kg > 0)) return
    setBusy("save")
    try {
      const row: any = await setEdgeLiftMax(athlete.$id, kg, "coach")
      setMax(currentMax(row))
      setLog(parseMaxLog(row.edgeLiftMaxLog))
      setDraft("")
    } catch (e) {
      console.log(e)
      Alert.alert("Couldn't save the max", "Does the `users` table have `edgeLiftMax` (float) and `edgeLiftMaxLog` (string) columns in Appwrite yet?")
    } finally {
      setBusy(null)
    }
  }

  async function sendTest() {
    setBusy("test")
    try {
      const library = await getExerciseLibrary()
      const row = library.find((e) => isEdgeLift(e))
      if (!row) {
        Alert.alert("Edge Lifts not found", `There's no "${EDGE_LIFT_NAME}" exercise in the library.`)
        return
      }
      const dueBy = defaultDueBy(localDateStr(new Date()))
      const test = {
        type: "strength_conditioning", blockName: MAX_TEST_NAME,
        description: `Warm up by feel, then add weight each try (3 min rest) until you can't hold ${EDGE_WARMUP.testHoldSecs} s.`,
        rounds: 1, restBetweenRounds: 0,
        exercises: [{ ...exerciseDraftFromLibrary(row), maxTest: true }],
      }
      const hw = await createProtocol({ name: MAX_TEST_NAME, blocks: [test], athleteId: athlete.$id, planPart: "homework", dueBy })
      notifyHomeworkAssigned(hw.$id, shortDay(dueBy))
      onHomeworkChanged?.()
      Alert.alert("Test sent", `${athlete.username ?? "The athlete"} has the max test as homework, due ${shortDay(dueBy)}.`)
    } catch (e: any) {
      Alert.alert("Couldn't send the test", e?.message ?? "Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.headRow}>
        <Text style={styles.label}>Edge lift max</Text>
        {max == null && <Text style={styles.needsTest}>Needs a test</Text>}
      </View>
      <Text style={card.sub}>
        {max != null ? `${max} kg` : "None yet."} Heaviest weight held {EDGE_WARMUP.testHoldSecs} s — the warm-up and main sets come from it.
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="kg"
          placeholderTextColor={C.textMuted}
          keyboardType="decimal-pad"
        />
        <Pressable style={[card.outlineBtn, !draft && { opacity: 0.4 }]} onPress={save} disabled={!draft || !!busy}>
          {busy === "save" ? <ActivityIndicator size="small" color={C.green} /> : <Text style={card.outlineBtnText}>Save</Text>}
        </Pressable>
      </View>
      <Pressable style={card.primaryBtn} onPress={sendTest} disabled={!!busy}>
        {busy === "test" ? <ActivityIndicator size="small" color={C.bg} /> : <Text style={card.primaryBtnText}>Send max test as homework</Text>}
      </Pressable>
      {log.length > 0 && (
        <View style={{ gap: 4, marginTop: 4 }}>
          {log.slice(0, 5).map((e, i) => (
            <View key={i} style={styles.logRow}>
              <Text style={styles.logWhen}>{shortDay(e.date)} · {e.source === "test" ? "Test" : "Coach"}</Text>
              <Text style={styles.logKg}>{e.kg} kg</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  needsTest: {
    fontSize: 12, fontWeight: "700", color: C.yellow, overflow: "hidden",
    backgroundColor: C.surfaceHigh, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1, height: 38, borderRadius: 10, backgroundColor: C.surfaceHigh, paddingHorizontal: 12,
    fontSize: 15, color: C.textPrimary,
  },
  logRow: { flexDirection: "row", justifyContent: "space-between" },
  logWhen: { fontSize: 13, color: C.textSecondary },
  logKg: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
})
