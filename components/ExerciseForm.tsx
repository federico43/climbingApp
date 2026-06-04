import { C } from "@/utils/theme"
import { createExercise, ExerciseRow } from "@/services/BoulderGraphService"
import { ExerciseUnit } from "@/utils/exerciseUnit"
import { useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

export type ExerciseType = "reps" | "both_sides" | "7/3s"

const TYPE_LABELS: Record<ExerciseType, string> = {
  reps: "Reps", both_sides: "Both sides", "7/3s": "7/3s",
}

// Single source of truth for the "create exercise" UI, shared by the Exercises
// library screen and the inline picker in the protocol designer. Pass a
// `fixedType` to lock the type (and hide the type picker) when the caller
// already knows it — otherwise the user picks the type here.
export function ExerciseForm({
  fixedType,
  title = "New exercise",
  saveLabel = "Save",
  onCancel,
  onCreated,
}: {
  fixedType?: ExerciseType
  title?: string
  saveLabel?: string
  onCancel: () => void
  onCreated: (ex: ExerciseRow) => void
}) {
  const [name, setName] = useState("")
  const [type, setType] = useState<ExerciseType>(fixedType ?? "reps")
  const [unit, setUnit] = useState<ExerciseUnit>("reps")
  const [defaultReps, setDefaultReps] = useState("")
  const [defaultEdge, setDefaultEdge] = useState("")
  const [defaultSeries, setDefaultSeries] = useState("6")
  const [saving, setSaving] = useState(false)
  const measurable = type === "reps" || type === "both_sides"

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter an exercise name.")
      return
    }
    setSaving(true)
    try {
      const payload: Parameters<typeof createExercise>[0] = { name: name.trim(), type }
      if (measurable) {
        payload.unit = unit
        if (defaultReps.trim()) payload.defaultReps = defaultReps.trim()
      } else {
        if (defaultEdge.trim()) payload.defaultEdge = defaultEdge.trim()
        const s = parseInt(defaultSeries)
        if (!isNaN(s) && s > 0) payload.defaultSeries = s
      }
      const created = await createExercise(payload)
      onCreated(created)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not create exercise.")
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Pressable onPress={handleSave} disabled={saving} hitSlop={10}>
          <Text style={[styles.save, saving && { opacity: 0.4 }]}>{saving ? "Saving…" : saveLabel}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Pull-ups"
          placeholderTextColor="#aaa"
          value={name}
          onChangeText={setName}
          autoFocus
        />

        {!fixedType && (
          <>
            <Text style={styles.label}>Type</Text>
            <View style={styles.chipRow}>
              {(["reps", "both_sides", "7/3s"] as ExerciseType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.chip, type === t && styles.chipActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                    {TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {measurable && (
          <>
            <Text style={styles.label}>Measure</Text>
            <View style={styles.chipRow}>
              {(["reps", "seconds"] as ExerciseUnit[]).map((u) => (
                <Pressable
                  key={u}
                  style={[styles.chip, unit === u && styles.chipActive]}
                  onPress={() => setUnit(u)}
                >
                  <Text style={[styles.chipText, unit === u && styles.chipTextActive]}>
                    {u === "reps" ? "Reps" : "Seconds"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>{unit === "seconds" ? "Default seconds (optional)" : "Default reps (optional)"}</Text>
            <TextInput
              style={styles.input}
              placeholder={unit === "seconds" ? "e.g. 20-30" : "e.g. 4-6"}
              placeholderTextColor="#aaa"
              value={defaultReps}
              onChangeText={setDefaultReps}
            />
          </>
        )}

        {type === "7/3s" && (
          <>
            <Text style={styles.label}>Default edge size (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 20mm"
              placeholderTextColor="#aaa"
              value={defaultEdge}
              onChangeText={setDefaultEdge}
            />
            <Text style={styles.label}>Default series</Text>
            <TextInput
              style={styles.input}
              placeholder="6"
              placeholderTextColor="#aaa"
              value={defaultSeries}
              onChangeText={setDefaultSeries}
              keyboardType="numeric"
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  cancel: { fontSize: 16, color: C.textSecondary },
  title: { fontSize: 17, fontWeight: "700", color: C.textPrimary, flex: 1, textAlign: "center", marginHorizontal: 12 },
  save: { fontSize: 16, color: C.green, fontWeight: "700" },
  form: { padding: 20 },
  label: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: C.textPrimary, borderWidth: 1, borderColor: C.border,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  chipTextActive: { color: C.bg },
})
