import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { ExerciseForm } from "@/components/ExerciseForm"
import { amountLabel } from "@/utils/exerciseUnit"
import { Ionicons } from "@expo/vector-icons"
import {
  deleteExercise,
  ExerciseRow,
  listExercises,
} from "@/services/BoulderGraphService"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import React, { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Types ────────────────────────────────────────────────────────────────────

type ExerciseType = "reps" | "both_sides" | "7/3s"

const TYPE_LABELS: Record<ExerciseType, string> = {
  reps: "Reps",
  both_sides: "Both sides",
  "7/3s": "7/3s",
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExercisesScreen() {
  const router = useRouter()
  const { role } = ConsumeAuth()
  const isCoach = role === "coach"

  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingExercise, setEditingExercise] = useState<ExerciseRow | null>(null)
  const [search, setSearch] = useState("")

  useFocusEffect(
    useCallback(() => {
      loadExercises()
    }, [])
  )

  async function loadExercises() {
    setLoading(true)
    try {
      setExercises(await listExercises())
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not load exercises.")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(ex: ExerciseRow) {
    Alert.alert("Delete exercise", `Remove "${ex.name}" from the library?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteExercise(ex.$id)
            setExercises((prev) => prev.filter((e) => e.$id !== ex.$id))
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Could not delete exercise.")
          }
        },
      },
    ])
  }

  // Filter by search, then group by type. `exercises` is already kept sorted
  // alphabetically (server query on load, re-sorted after create/edit), so
  // each group comes out alphabetical for free.
  const query = search.trim().toLowerCase()
  const filtered = query ? exercises.filter((ex) => ex.name.toLowerCase().includes(query)) : exercises
  const grouped: Record<ExerciseType, ExerciseRow[]> = { reps: [], both_sides: [], "7/3s": [] }
  for (const ex of filtered) {
    if (grouped[ex.type]) grouped[ex.type].push(ex)
  }
  const hasResults = filtered.length > 0

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.navigate("/(tabs)/(buttonTabs)/design" as any)} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.title}>Exercise Library</Text>
        {isCoach ? (
          <Pressable style={styles.newBtn} onPress={() => setShowCreate(true)}>
            <Text style={styles.newBtnText}>+ New</Text>
          </Pressable>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : exercises.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🏋️</Text>
          <Text style={styles.emptyTitle}>No exercises yet</Text>
          {isCoach && (
            <Text style={styles.emptyText}>Tap "+ New" to add exercises to the library.</Text>
          )}
        </View>
      ) : (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search exercises"
              placeholderTextColor={C.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
            />
            {!!search && (
              <Pressable onPress={() => setSearch("")} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {!hasResults ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>
                No exercises match “{search.trim()}”.
                {isCoach ? " Try a different search, or tap “+ New” above." : " Try a different search."}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              {(["reps", "both_sides", "7/3s"] as ExerciseType[]).map((type) => {
                const list = grouped[type]
                if (!list.length) return null
                return (
                  <View key={type} style={styles.section}>
                    <Text style={styles.sectionHeader}>{TYPE_LABELS[type]}</Text>
                    {list.map((ex) => (
                      <Pressable
                        key={ex.$id}
                        style={({ pressed }) => [styles.row, isCoach && pressed && styles.rowPressed]}
                        onPress={isCoach ? () => setEditingExercise(ex) : undefined}
                      >
                        {ex.photoUri ? (
                          <Image source={{ uri: ex.photoUri }} style={styles.rowThumb} />
                        ) : null}
                        <View style={styles.rowInfo}>
                          <View style={styles.rowNameLine}>
                            <Text style={styles.rowName} numberOfLines={1}>{ex.name}</Text>
                            {ex.notes ? (
                              <Ionicons name="document-text-outline" size={13} color={C.textMuted} style={styles.rowNotesIcon} />
                            ) : null}
                          </View>
                          <Text style={styles.rowMeta}>
                            {ex.defaultReps ? amountLabel(ex.defaultReps, ex.unit) : ""}
                            {ex.defaultEdge ? `${ex.defaultEdge} edge` : ""}
                            {ex.defaultSeries ? ` · ${ex.defaultSeries} series` : ""}
                          </Text>
                        </View>
                        {isCoach && (
                          <>
                            <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={styles.rowChevron} />
                            <Pressable onPress={() => handleDelete(ex)} style={styles.deleteBtn} hitSlop={8}>
                              <Text style={styles.deleteBtnText}>✕</Text>
                            </Pressable>
                          </>
                        )}
                      </Pressable>
                    ))}
                  </View>
                )
              })}
            </ScrollView>
          )}
        </>
      )}

      <Modal
        visible={showCreate}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCreate(false)}
      >
        <ExerciseForm
          onCancel={() => setShowCreate(false)}
          onCreated={(ex) => {
            setExercises((prev) =>
              [...prev, ex].sort((a, b) => a.name.localeCompare(b.name))
            )
            setShowCreate(false)
          }}
        />
      </Modal>

      <Modal
        visible={!!editingExercise}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditingExercise(null)}
      >
        {editingExercise && (
          <ExerciseForm
            exercise={editingExercise}
            title="Edit exercise"
            onCancel={() => setEditingExercise(null)}
            onCreated={(ex) => {
              setExercises((prev) =>
                prev.map((e) => (e.$id === ex.$id ? ex : e)).sort((a, b) => a.name.localeCompare(b.name))
              )
              setEditingExercise(null)
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  )
}


// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { width: 40 },
  backArrow: { fontSize: 22, color: C.textSecondary },
  title: { fontSize: 18, fontWeight: "700", color: C.textPrimary },
  newBtn: {
    backgroundColor: C.green,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  newBtnText: { color: C.bg, fontWeight: "600", fontSize: 13 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surface, borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.border,
    marginHorizontal: 16, marginTop: 14,
  },
  searchInput: {
    flex: 1, color: C.textPrimary, fontSize: 14,
    paddingVertical: 10, padding: 0,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyIcon: { fontSize: 40, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22 },
  scroll: { padding: 16, gap: 20, paddingBottom: 40 },
  section: { gap: 8 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    color: C.textMuted,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowPressed: { backgroundColor: C.surfaceHigh },
  rowThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.surfaceHigh, marginRight: 12 },
  rowInfo: { flex: 1 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName: { fontSize: 15, fontWeight: "600", color: C.textPrimary, flexShrink: 1 },
  rowNotesIcon: { flexShrink: 0 },
  rowMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  rowChevron: { marginRight: 4 },
  deleteBtn: { padding: 6 },
  deleteBtnText: { fontSize: 15, color: C.textMuted },
  // Modal
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: { fontSize: 17, fontWeight: "600", color: C.textPrimary },
  cancelText: { fontSize: 15, color: C.textSecondary },
  saveText: { fontSize: 15, fontWeight: "600", color: C.green },
  form: { padding: 20, gap: 6, paddingBottom: 40 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: C.textSecondary,
    marginTop: 14,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: C.textPrimary,
    backgroundColor: C.surfaceHigh,
    marginTop: 4,
  },
  typeRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: C.surfaceHigh,
  },
  typeChipActive: { backgroundColor: C.green },
  typeChipText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  typeChipTextActive: { color: C.bg },
})
