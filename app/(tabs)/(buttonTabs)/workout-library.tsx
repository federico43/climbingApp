import { C } from "@/utils/theme"
import { BLOCK_ICONS, BLOCK_LABELS, BlockType, blockFromLibraryRow } from "@/components/workoutBlocks"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { BlockRow, listBlocks } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useState } from "react"
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Athlete-facing browse screen for the coach-published block library.
// Distinct from the video "Library" tab — this one lists every block the
// coach has saved, runnable individually as a one-block workout.
export default function WorkoutLibraryScreen() {
  const router = useRouter()
  const workoutCtx = useWorkoutContext()
  const [blocks, setBlocks] = useState<BlockRow[]>([])
  const [loadingBlocks, setLoadingBlocks] = useState(true)
  const [blockSearch, setBlockSearch] = useState("")

  const loadBlocks = useCallback(() => {
    setLoadingBlocks(true)
    listBlocks()
      .then(setBlocks)
      .catch((e) => { console.error(e); setBlocks([]) })
      .finally(() => setLoadingBlocks(false))
  }, [])

  useFocusEffect(useCallback(() => { loadBlocks() }, [loadBlocks]))

  function startBlock(row: BlockRow) {
    try {
      const block = blockFromLibraryRow(row)
      workoutCtx.openWorkout([block], row.name)
      router.back()
    } catch {
      Alert.alert("Couldn't start", "This block couldn't be loaded.")
    }
  }

  const filteredBlocks = (() => {
    const q = blockSearch.trim().toLowerCase()
    if (!q) return blocks
    return blocks.filter((b) =>
      b.name.toLowerCase().includes(q) ||
      (BLOCK_LABELS[b.type as BlockType] ?? "").toLowerCase().includes(q)
    )
  })()

  const groupedBlocks = (Object.keys(BLOCK_LABELS) as BlockType[])
    .map((type) => ({ type, rows: filteredBlocks.filter((b) => b.type === type) }))
    .filter((g) => g.rows.length > 0)

  return (
    <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={{ flex: 1 }}>
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
          </Pressable>
          <Text style={s.title}>Workout Library</Text>
          <View style={s.backBtn} />
        </View>

        {loadingBlocks ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
        ) : (
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {blocks.length > 0 && (
              <View style={s.searchWrap}>
                <Ionicons name="search" size={16} color={C.textMuted} />
                <TextInput
                  value={blockSearch}
                  onChangeText={setBlockSearch}
                  placeholder="Search blocks"
                  placeholderTextColor={C.textMuted}
                  style={s.searchInput}
                />
                {!!blockSearch && (
                  <Pressable onPress={() => setBlockSearch("")} hitSlop={10}>
                    <Ionicons name="close-circle" size={18} color={C.textMuted} />
                  </Pressable>
                )}
              </View>
            )}
            {groupedBlocks.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="cube-outline" size={36} color={C.textMuted} />
                <Text style={s.emptyText}>
                  {blocks.length === 0 ? "No blocks yet — check back soon." : "No blocks match your search."}
                </Text>
              </View>
            ) : (
              groupedBlocks.map((g) => (
                <View key={g.type} style={{ gap: 8 }}>
                  <Text style={s.groupHeader}>{BLOCK_LABELS[g.type]}</Text>
                  {g.rows.map((row) => (
                    <Pressable key={row.$id} style={s.blockRow} onPress={() => startBlock(row)}>
                      <View style={s.blockIconWrap}>
                        <Ionicons name={BLOCK_ICONS[g.type]} size={18} color={C.green} />
                      </View>
                      <Text style={s.blockRowName} numberOfLines={1}>{row.name}</Text>
                      <View style={s.actionBtn}>
                        <Ionicons name="play" size={13} color={C.bg} />
                        <Text style={s.actionBtnText}>Start</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ))
            )}
            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </LinearGradient>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: C.textPrimary, textAlign: "center" },

  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surface, borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: {
    flex: 1, color: C.textPrimary, fontSize: 14,
    paddingVertical: 10, padding: 0,
  },

  empty: {
    alignItems: "center", gap: 10, paddingVertical: 60, paddingHorizontal: 24,
  },
  emptyText: { fontSize: 14, color: C.textMuted, textAlign: "center" },

  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  actionBtnText: { fontSize: 13, fontWeight: "800", color: C.bg },

  groupHeader: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4,
  },
  blockRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  blockIconWrap: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  blockRowName: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
})
