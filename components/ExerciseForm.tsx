import { C } from "@/utils/theme"
import { createExercise, ExerciseRow, updateExercise, uploadPhoto } from "@/services/BoulderGraphService"
import { ExerciseUnit } from "@/utils/exerciseUnit"
import { useState } from "react"
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as ImagePicker from "expo-image-picker"

export type ExerciseType = "reps" | "both_sides" | "7/3s"

const TYPE_LABELS: Record<ExerciseType, string> = {
  reps: "Reps", both_sides: "Both sides", "7/3s": "7/3s",
}

// Single source of truth for the "create/edit exercise" UI, shared by the
// Exercises library screen and the inline picker in the protocol designer.
// Pass a `fixedType` to lock the type (and hide the type picker) when the
// caller already knows it — otherwise the user picks the type here. Pass
// `exercise` to edit an existing library row instead of creating a new one.
export function ExerciseForm({
  fixedType,
  exercise,
  title = "New exercise",
  saveLabel = "Save",
  onCancel,
  onCreated,
}: {
  fixedType?: ExerciseType
  exercise?: ExerciseRow
  title?: string
  saveLabel?: string
  onCancel: () => void
  onCreated: (ex: ExerciseRow) => void
}) {
  const [name, setName] = useState(exercise?.name ?? "")
  const [type, setType] = useState<ExerciseType>(exercise?.type ?? fixedType ?? "reps")
  const [unit, setUnit] = useState<ExerciseUnit>(exercise?.unit ?? "reps")
  const [defaultReps, setDefaultReps] = useState(exercise?.defaultReps ?? "")
  const [defaultEdge, setDefaultEdge] = useState(exercise?.defaultEdge ?? "")
  const [defaultSeries, setDefaultSeries] = useState(String(exercise?.defaultSeries ?? 6))
  // Photo: either the existing remote URL, a freshly picked local uri (not yet
  // uploaded), or undefined once removed.
  const [photoUri, setPhotoUri] = useState<string | undefined>(exercise?.photoUri)
  const [notes, setNotes] = useState(exercise?.notes ?? "")
  const [saving, setSaving] = useState(false)
  const measurable = type === "reps" || type === "both_sides"

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to add an exercise photo.")
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    })
    if (result.canceled || !result.assets[0]) return
    setPhotoUri(result.assets[0].uri)
  }

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
      if (photoUri) {
        // Only upload if it's a freshly picked local file — an existing
        // photoUri is already a remote URL.
        payload.photoUri = photoUri.startsWith("http") ? photoUri : await uploadPhoto(photoUri)
      } else if (exercise?.photoUri) {
        // The photo was removed — clear it explicitly so the update persists that.
        payload.photoUri = ""
      }
      if (notes.trim()) {
        payload.notes = notes.trim()
      } else if (exercise?.notes) {
        payload.notes = ""
      }
      const saved = exercise
        ? await updateExercise(exercise.$id, payload)
        : await createExercise(payload)
      onCreated(saved)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save exercise.")
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

        <Text style={styles.label}>Photo (optional)</Text>
        {photoUri ? (
          <View style={styles.photoPreviewWrap}>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <View style={styles.photoActions}>
              <Pressable onPress={handlePickPhoto} hitSlop={8}>
                <Text style={styles.photoActionText}>Change</Text>
              </Pressable>
              <Pressable onPress={() => setPhotoUri(undefined)} hitSlop={8}>
                <Text style={styles.photoActionTextRemove}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.photoAddBtn} onPress={handlePickPhoto}>
            <Text style={styles.photoAddBtnText}>+ Add photo</Text>
          </Pressable>
        )}

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="Cues for correct form, e.g. keep elbows tucked, full range of motion…"
          placeholderTextColor="#aaa"
          value={notes}
          onChangeText={setNotes}
          multiline
          textAlignVertical="top"
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
  photoAddBtn: {
    borderWidth: 1, borderColor: C.border, borderStyle: "dashed", borderRadius: 10,
    paddingVertical: 16, alignItems: "center", backgroundColor: C.surface,
  },
  photoAddBtnText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  photoPreviewWrap: { flexDirection: "row", alignItems: "center", gap: 14 },
  photoPreview: { width: 84, height: 84, borderRadius: 10, backgroundColor: C.surface },
  photoActions: { gap: 10 },
  photoActionText: { fontSize: 14, fontWeight: "600", color: C.green },
  photoActionTextRemove: { fontSize: 14, fontWeight: "600", color: C.red },
  notesInput: { minHeight: 90 },
})
