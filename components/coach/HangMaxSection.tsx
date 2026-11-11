import { C } from "@/utils/theme"
import { card } from "@/components/coach/styles"
import { AppUser, createProtocol, getUsers, setHangMax } from "@/services/BoulderGraphService"
import { notifyHomeworkAssigned } from "@/services/homework"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { DEFAULT_HANG_EDGE, HANG_EDGES, hangLoadLabel, hangMaxes, hangMaxFor, isMaxHang, MAX_HANGS, MAX_HANGS_NAME, parseHangLog, type HangMaxEntry } from "@/utils/maxHangs"
import { defaultDueBy, shortDay } from "@/utils/homework"
import { localDateStr } from "@/utils/planRotation"
import { exerciseDraftFromLibrary } from "@/utils/scPlanBuilder"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native"

export const HANG_TEST_NAME = "Max hangs test"

// Coach: the athlete's Max Hangs maxes, one per grip (edge size,
// utils/maxHangs.ts) — pick an edge, then type its max or send its test as
// homework. Mirrors EdgeLiftMaxSection.
export function HangMaxSection({ athlete, onHomeworkChanged }: {
  athlete: AppUser
  onHomeworkChanged?: () => void
}) {
  const [log, setLog] = useState<HangMaxEntry[]>(parseHangLog(athlete.hangMaxLog))
  const [edge, setEdge] = useState<string>(DEFAULT_HANG_EDGE)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState<"save" | "test" | null>(null)

  useEffect(() => {
    let cancelled = false
    setLog(parseHangLog(athlete.hangMaxLog))
    setDraft("")
    getUsers(athlete.$id).then((row: any) => {
      if (!cancelled && row) setLog(parseHangLog(row.hangMaxLog))
    })
    return () => { cancelled = true }
  }, [athlete])

  const max = hangMaxFor(log, edge)
  const maxes = hangMaxes(log)

  async function save() {
    const kg = parseFloat(draft.replace(",", "."))
    if (!(kg >= 0)) return
    setBusy("save")
    try {
      const row: any = await setHangMax(athlete.$id, edge, kg, "coach")
      setLog(parseHangLog(row.hangMaxLog))
      setDraft("")
    } catch (e) {
      console.log(e)
      Alert.alert("Couldn't save the max", "Does the `users` table have the `hangMaxLog` (string) column in Appwrite yet? See scripts/max-hangs/setup.mjs.")
    } finally {
      setBusy(null)
    }
  }

  async function sendTest() {
    setBusy("test")
    try {
      const library = await getExerciseLibrary()
      const row = library.find((e) => isMaxHang(e))
      if (!row) {
        Alert.alert("Max Hangs not found", `There's no "${MAX_HANGS_NAME}" exercise in the library.`)
        return
      }
      const dueBy = defaultDueBy(localDateStr(new Date()))
      const name = `${HANG_TEST_NAME} · ${edge}`
      const test = {
        type: "strength_conditioning", blockName: name,
        description: `On the ${edge} edge: warm up by feel, then ${MAX_HANGS.holdSecs} s hangs, shoulder blades retracted. The app picks each next load from how the last one went.`,
        rounds: 1, restBetweenRounds: 0,
        exercises: [{ ...exerciseDraftFromLibrary(row), edge, maxTest: true }],
      }
      const hw = await createProtocol({ name, blocks: [test], athleteId: athlete.$id, planPart: "homework", dueBy })
      notifyHomeworkAssigned(hw.$id, shortDay(dueBy))
      onHomeworkChanged?.()
      Alert.alert("Test sent", `${athlete.username ?? "The athlete"} has the ${edge} max hangs test as homework, due ${shortDay(dueBy)}.`)
    } catch (e: any) {
      Alert.alert("Couldn't send the test", e?.message ?? "Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.headRow}>
        <Text style={styles.label}>Max hangs</Text>
        {maxes.length === 0 && <Text style={styles.needsTest}>Needs a test</Text>}
      </View>
      <Text style={card.sub}>
        Heaviest weight added to bodyweight held {MAX_HANGS.holdSecs} s, one max per edge. The warm-up and main hangs come from it.
      </Text>
      {maxes.length > 0 && (
        <View style={{ gap: 4 }}>
          {maxes.map((m) => (
            <View key={m.edge} style={styles.logRow}>
              <Text style={styles.logWhen}>{m.edge}</Text>
              <Text style={styles.logKg}>{hangLoadLabel(m.kg, "kg")}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.chipWrap}>
        {HANG_EDGES.map((e) => {
          const sel = e === edge
          const has = hangMaxFor(log, e) != null
          return (
            <Pressable key={e} onPress={() => setEdge(e)} style={[styles.chip, sel && styles.chipSel]}>
              <Text style={[styles.chipText, sel && styles.chipTextSel]}>{has ? `${e} ✓` : e}</Text>
            </Pressable>
          )
        })}
      </View>
      <Text style={card.sub}>{edge}: {max != null ? hangLoadLabel(max, "kg") : "no max yet."}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={`kg added on ${edge} (0 = bodyweight)`}
          placeholderTextColor={C.textMuted}
          keyboardType="decimal-pad"
        />
        <Pressable style={[card.outlineBtn, !draft && { opacity: 0.4 }]} onPress={save} disabled={!draft || !!busy}>
          {busy === "save" ? <ActivityIndicator size="small" color={C.green} /> : <Text style={card.outlineBtnText}>Save</Text>}
        </Pressable>
      </View>
      <Pressable style={card.primaryBtn} onPress={sendTest} disabled={!!busy}>
        {busy === "test" ? <ActivityIndicator size="small" color={C.bg} /> : <Text style={card.primaryBtnText}>Send {edge} test as homework</Text>}
      </Pressable>
      {log.length > 0 && (
        <View style={{ gap: 4, marginTop: 4 }}>
          {log.slice(0, 5).map((e, i) => (
            <View key={i} style={styles.logRow}>
              <Text style={styles.logWhen}>{shortDay(e.date)} · {e.edge} · {e.source === "test" ? "Test" : "Coach"}</Text>
              <Text style={styles.logKg}>{hangLoadLabel(e.kg, "kg")}</Text>
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
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: C.surfaceHigh },
  chipSel: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 12.5, color: C.textSecondary },
  chipTextSel: { color: C.bg, fontWeight: "700" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1, height: 38, borderRadius: 10, backgroundColor: C.surfaceHigh, paddingHorizontal: 12,
    fontSize: 15, color: C.textPrimary,
  },
  logRow: { flexDirection: "row", justifyContent: "space-between" },
  logWhen: { fontSize: 13, color: C.textSecondary },
  logKg: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
})
