import { invalidateExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { ExerciseForm } from "@/components/ExerciseForm"
import { ExerciseLibraryCard } from "@/components/ExerciseLibraryCard"
import { Ionicons } from "@expo/vector-icons"
import {
  deleteExercise,
  ExerciseRow,
  listExercises,
} from "@/services/BoulderGraphService"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import React, { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
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

// Cards wrap into a grid like the workout builder's blocks.
const CARD_GAP = 12
// Narrower than the builder's so cards come out roughly square.
const CARD_MIN_WIDTH = 230
const CARD_MAX_COLUMNS = 6

// Before a card has been measured: header + photo (4:3) + wrapped notes.
function estimateHeight(ex: ExerciseRow, width: number): number {
  const photo = ex.photoUri ? (width * 3) / 4 : 0
  const notesLines = ex.notes ? Math.ceil((ex.notes.length * 7) / Math.max(1, width - 28)) : 0
  return 64 + photo + notesLines * 19
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
  const [gridWidth, setGridWidth] = useState(0)
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({})
  const [editingNotes, setEditingNotes] = useState(false)
  const frozenColsRef = useRef<Partial<Record<ExerciseType, string[][]>>>({})

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
            invalidateExerciseLibrary()
            setExercises((prev) => prev.filter((e) => e.$id !== ex.$id))
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Could not delete exercise.")
          }
        },
      },
    ])
  }

  // Filter by search, then group by type, longest description first.
  // `exercises` is already kept sorted alphabetically (server query on load,
  // re-sorted after create/edit) and the sort is stable, so ties — e.g. all
  // the ones without a description — stay alphabetical.
  const query = search.trim().toLowerCase()
  const filtered = query ? exercises.filter((ex) => ex.name.toLowerCase().includes(query)) : exercises
  const grouped: Record<ExerciseType, ExerciseRow[]> = { reps: [], both_sides: [], "7/3s": [] }
  for (const ex of filtered) {
    if (grouped[ex.type]) grouped[ex.type].push(ex)
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) => (b.notes?.trim().length ?? 0) - (a.notes?.trim().length ?? 0))
  }
  const hasResults = filtered.length > 0

  // Same column math as the workout builder's card grid.
  const columns = gridWidth > 0
    ? Math.max(1, Math.min(CARD_MAX_COLUMNS, Math.floor((gridWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP))))
    : 1
  const cardWidth = gridWidth > 0 ? (gridWidth - CARD_GAP * (columns - 1)) / columns : undefined

  // Masonry: each card (in the order above) goes to the currently
  // shortest column, so a long description only makes its own card taller
  // instead of stretching its whole row. Uses each card's measured height,
  // or a rough estimate until it has rendered once.
  // While a description is being typed the layout is frozen (last columns,
  // by id) — re-sorting/re-flowing would move the card and drop focus.
  function masonry(type: ExerciseType, list: ExerciseRow[]): ExerciseRow[][] {
    const frozen = frozenColsRef.current[type]
    if (editingNotes && frozen && frozen.length === columns) {
      const byId = new Map(list.map((ex) => [ex.$id, ex]))
      return frozen.map((ids) => ids.flatMap((id) => byId.get(id) ?? []))
    }
    const cols: ExerciseRow[][] = Array.from({ length: columns }, () => [])
    const heights = new Array(columns).fill(0)
    for (const ex of list) {
      const i = heights.indexOf(Math.min(...heights))
      cols[i].push(ex)
      heights[i] += (cardHeights[ex.$id] ?? estimateHeight(ex, cardWidth ?? CARD_MIN_WIDTH)) + CARD_GAP
    }
    frozenColsRef.current[type] = cols.map((c) => c.map((ex) => ex.$id))
    return cols
  }
  function recordHeight(id: string, h: number) {
    setCardHeights((prev) => (Math.abs((prev[id] ?? 0) - h) < 1 ? prev : { ...prev, [id]: h }))
  }

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
            <Text style={styles.emptyText}>Tap &quot;+ New&quot; to add exercises to the library.</Text>
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
              <View style={styles.sections} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
                {(["reps", "both_sides", "7/3s"] as ExerciseType[]).map((type) => {
                  const list = grouped[type]
                  if (!list.length) return null
                  return (
                    <View key={type} style={styles.section}>
                      <Text style={styles.sectionHeader}>{TYPE_LABELS[type]}</Text>
                      <View style={styles.grid}>
                        {masonry(type, list).map((col, i) => (
                          <View key={i} style={[styles.column, { width: cardWidth }]}>
                            {col.map((ex) => (
                              <View
                                key={ex.$id}
                                onLayout={(e) => recordHeight(ex.$id, e.nativeEvent.layout.height)}
                              >
                                <ExerciseLibraryCard
                                  exercise={ex}
                                  onPress={isCoach ? () => setEditingExercise(ex) : undefined}
                                  onDelete={isCoach ? () => handleDelete(ex) : undefined}
                                  onEditingChange={setEditingNotes}
                                  onSaved={(saved) => setExercises((prev) => prev.map((e) => (e.$id === saved.$id ? saved : e)))}
                                />
                              </View>
                            ))}
                          </View>
                        ))}
                      </View>
                    </View>
                  )
                })}
              </View>
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
  sections: { gap: 20 },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: CARD_GAP },
  column: { gap: CARD_GAP },
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
