import { C } from "@/utils/theme"
import { ExerciseRow, updateExercise } from "@/services/BoulderGraphService"
import React, { useEffect, useRef, useState } from "react"
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native"

const TYPE_LABELS: Record<ExerciseRow["type"], string> = {
  reps: "Reps", both_sides: "Both sides", "7/3s": "7/3s",
}

// The description saves this long after the last keystroke (and on blur).
const NOTES_SAVE_DELAY_MS = 700

// A library exercise as a card, dressed like the workout builder's block
// cards: full-width photo, name and the coach's description. Coaches edit the
// description right on the card (autosaved); tapping the photo/name opens the
// full form for everything else.
export function ExerciseLibraryCard({ exercise, onPress, onDelete, onEditingChange, onSaved }: {
  exercise: ExerciseRow
  // Omitted for athletes — the card is read-only.
  onPress?: () => void
  onDelete?: () => void
  // The screen freezes the card layout while a description is being typed —
  // re-sorting/re-flowing under the cursor would drop focus.
  onEditingChange?: (editing: boolean) => void
  // Reported on blur (not per keystroke) for the same reason.
  onSaved?: (ex: ExerciseRow) => void
}) {
  const editable = !!onPress
  const [notes, setNotes] = useState(exercise.notes ?? "")
  const [inputHeight, setInputHeight] = useState(0)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes
  const savedNotesRef = useRef(exercise.notes ?? "")
  const lastSavedRef = useRef<ExerciseRow | null>(null)

  // Re-seed when the row changes from outside (e.g. the full form saved).
  useEffect(() => {
    setNotes(exercise.notes ?? "")
    savedNotesRef.current = exercise.notes ?? ""
  }, [exercise.notes])

  // Don't lose a pending edit if the card unmounts (search, navigation).
  useEffect(() => () => { save() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(): Promise<ExerciseRow | null> {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const next = notesRef.current.trim()
    const prev = savedNotesRef.current
    if (next === prev.trim()) return lastSavedRef.current
    savedNotesRef.current = next
    setStatus("saving")
    try {
      // An empty string clears the column, same as the full form.
      const saved = await updateExercise(exercise.$id, { name: exercise.name, type: exercise.type, notes: next })
      lastSavedRef.current = saved
      setStatus("saved")
      return saved
    } catch {
      savedNotesRef.current = prev // so the next save retries
      setStatus("error")
      return null
    }
  }

  function handleChange(v: string) {
    setNotes(v)
    setStatus("saving")
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(save, NOTES_SAVE_DELAY_MS)
  }

  async function handleBlur() {
    const saved = await save()
    onEditingChange?.(false)
    if (saved) onSaved?.(saved)
  }

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [editable && pressed && styles.headPressed]}
        onPress={onPress}
        disabled={!editable}
      >
        {exercise.photoUri ? <Image source={{ uri: exercise.photoUri }} style={styles.banner} /> : null}
        <View style={[styles.head, onDelete && styles.headClearDelete]}>
          <Text style={styles.typeLabel}>{TYPE_LABELS[exercise.type]}</Text>
          <Text style={styles.name} numberOfLines={2}>{exercise.name}</Text>
        </View>
      </Pressable>

      {editable ? (
        <View style={styles.notesWrap}>
          <TextInput
            value={notes}
            onChangeText={handleChange}
            onFocus={() => onEditingChange?.(true)}
            onBlur={handleBlur}
            placeholder="Add a description…"
            placeholderTextColor={C.textMuted}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)}
            style={[styles.notes, styles.notesInput, inputHeight > 0 && { height: inputHeight }]}
          />
          {status !== "idle" && (
            <Text style={[styles.status, status === "error" && { color: C.red }]}>
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Not saved"}
            </Text>
          )}
        </View>
      ) : (
        !!exercise.notes && <Text style={[styles.notes, styles.notesWrap]}>{exercise.notes}</Text>
      )}

      {onDelete && (
        <Pressable onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surfaceHigh, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, overflow: "hidden",
  },
  headPressed: { opacity: 0.8 },
  banner: { width: "100%", aspectRatio: 16 / 9, backgroundColor: C.surface },
  head: { paddingHorizontal: 14, paddingTop: 12, gap: 2 },
  headClearDelete: { paddingRight: 40 }, // the ✕ sits on this corner when there's no photo
  typeLabel: { fontSize: 11, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  name: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  notesWrap: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  notes: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  notesInput: { padding: 0, minHeight: 19 },
  status: { fontSize: 11, color: C.textMuted, marginTop: 4, alignSelf: "flex-end" },
  deleteBtn: {
    position: "absolute", top: 8, right: 8, padding: 6,
    borderRadius: 14, backgroundColor: C.surfaceHigh,
  },
  deleteBtnText: { fontSize: 15, color: C.textMuted },
})
