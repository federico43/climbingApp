import { useHoldUpdates } from "@/utils/updateHold"
import { C } from "@/utils/theme"
import { Block, BlockEditorRow, BlockPickerModal, stripLocalIds } from "@/components/workoutBlocks"
import { saveSession } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker from "@react-native-community/datetimepicker"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaView } from "react-native-safe-area-context"
import { LinearGradient } from "expo-linear-gradient"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number)
  if (!y || !m || !d) return dateStr
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

// Build a synthetic attempt per block so the session slots into the same
// calendar/stats/S&C pipeline a live workout produces — the athlete just
// didn't log it in real time. S&C blocks get one attempt per exercise
// (keyed via `notes`, same fallback extractSCExercises() already reads)
// so their per-exercise history still picks these up.
function buildRetroactiveAttempts(blocks: any[], dateStr: string): any[] {
  const timestamp = new Date(dateStr + "T12:00:00").getTime()
  const attempts: any[] = []
  blocks.forEach((block, blockIndex) => {
    const exercises: any[] = block?.type === "strength_conditioning" ? block.exercises ?? [] : []
    if (exercises.length > 0) {
      for (const ex of exercises) {
        attempts.push({ blockIndex, type: block.type, success: true, timestamp, notes: ex.name ?? "" })
      }
    } else {
      attempts.push({ blockIndex, type: block?.type ?? "", success: true, timestamp, notes: "" })
    }
  })
  return attempts
}

// Sum each block's own time-limit field (minutes) into per-block durations
// (seconds) — the closest thing to "how long did this take" without a timer.
function buildBlockDurations(blocks: any[]): Record<number, number> {
  const durations: Record<number, number> = {}
  blocks.forEach((block, blockIndex) => {
    if (block?.timeLimit > 0) durations[blockIndex] = Math.round(block.timeLimit * 60)
  })
  return durations
}

function totalMinutes(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + (b.timeLimit ?? 0), 0)
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LogPastSessionScreen() {
  // A reload here would lose unsaved work — see utils/updateHold.ts.
  useHoldUpdates()
  const router = useRouter()
  const { athleteId, athleteName } = useLocalSearchParams<{ athleteId?: string; athleteName?: string }>()
  const [blocks, setBlocks] = useState<Block[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [date, setDate] = useState(yesterdayStr())
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [saving, setSaving] = useState(false)

  function addBlock(b: Block) {
    setBlocks((prev) => [...prev, b])
    setExpandedId(b.id)
    setPickerOpen(false)
  }
  function updateBlock(b: Block) { setBlocks((prev) => prev.map((x) => (x.id === b.id ? b : x))) }
  function deleteBlock(id: string) { setBlocks((prev) => prev.filter((x) => x.id !== id)) }

  const renderBlock = useCallback(({ item, drag, isActive }: RenderItemParams<Block>) => (
    <BlockEditorRow
      block={item}
      isExpanded={expandedId === item.id}
      isActive={isActive}
      onToggleExpand={() => setExpandedId((p) => (p === item.id ? null : item.id))}
      onDrag={drag}
      onUpdate={updateBlock}
      onDelete={() => deleteBlock(item.id)}
    />
  ), [expandedId])

  const isToday = date === todayStr()
  const isYesterday = date === yesterdayStr()
  const isCustomDate = !isToday && !isYesterday
  const canSave = blocks.length > 0 && !saving
  const minutes = totalMinutes(blocks)

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const protocol = stripLocalIds(blocks)
      await saveSession(
        {
          protocol: JSON.stringify(protocol),
          attempts: JSON.stringify(buildRetroactiveAttempts(protocol, date)),
          blockDurations: JSON.stringify(buildBlockDurations(protocol)),
        },
        athleteId
      )
      const who = athleteId ? ` for ${athleteName ?? "the athlete"}` : ""
      Alert.alert("Session logged", `Marked as done${who} on ${formatDateLabel(date)}.`, [
        { text: "OK", onPress: () => router.back() },
      ])
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={{ flex: 1 }}>
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
          </Pressable>
          <Text style={s.title} numberOfLines={1}>
            {athleteId ? `Log a session for ${athleteName ?? "athlete"}` : "Log a past session"}
          </Text>
          <View style={s.backBtn} />
        </View>

        <View style={s.body}>
          {/* ── Date card ────────────────────────────────────────────────────── */}
          <View style={s.card}>
            <Text style={s.sectionTitle}>When?</Text>
            <View style={s.chipRow}>
              <Pressable style={[s.chip, isToday && s.chipActive]} onPress={() => setDate(todayStr())}>
                <Text style={[s.chipText, isToday && s.chipTextActive]}>Today</Text>
              </Pressable>
              <Pressable style={[s.chip, isYesterday && s.chipActive]} onPress={() => setDate(yesterdayStr())}>
                <Text style={[s.chipText, isYesterday && s.chipTextActive]}>Yesterday</Text>
              </Pressable>
              <Pressable
                style={[s.chip, s.chipDate, isCustomDate && s.chipActive]}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar-outline" size={14} color={isCustomDate ? C.bg : C.textSecondary} />
                <Text style={[s.chipText, isCustomDate && s.chipTextActive]}>
                  {isCustomDate ? formatDateLabel(date) : "Other…"}
                </Text>
              </Pressable>
            </View>
            {showDatePicker && (
              <DateTimePicker
                value={new Date(date + "T12:00:00")}
                mode="date"
                display="default"
                maximumDate={new Date()}
                onChange={(_, selected) => {
                  setShowDatePicker(false)
                  if (selected) setDate(selected.toISOString().slice(0, 10))
                }}
              />
            )}
          </View>

          {/* ── Blocks card ──────────────────────────────────────────────────── */}
          <View style={[s.card, s.blocksCard]}>
            <Text style={s.sectionTitle}>What did you do?</Text>
            <GestureHandlerRootView style={{ flex: 1 }}>
              {blocks.length === 0 ? (
                <View style={s.emptyBlocks}>
                  <Ionicons name="barbell-outline" size={36} color={C.textMuted} />
                  <Text style={s.emptyBlocksText}>Add the blocks you did from the library</Text>
                </View>
              ) : (
                <DraggableFlatList
                  data={blocks}
                  containerStyle={{ flex: 1 }}
                  keyExtractor={(item) => item.id}
                  onDragEnd={({ data }) => setBlocks(data)}
                  renderItem={renderBlock}
                  contentContainerStyle={s.blockList}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                />
              )}
            </GestureHandlerRootView>

            <Pressable style={s.addBlockBtn} onPress={() => setPickerOpen(true)}>
              <Ionicons name="add" size={18} color={C.green} />
              <Text style={s.addBlockBtnText}>Add block</Text>
            </Pressable>
          </View>
        </View>

        {blocks.length > 0 && (
          <Text style={s.summary}>
            {blocks.length} block{blocks.length !== 1 ? "s" : ""}
            {minutes > 0 ? `  ·  ${minutes} min total` : ""}
          </Text>
        )}

        <Pressable style={[s.saveBtn, !canSave && { opacity: 0.4 }]} onPress={handleSave} disabled={!canSave}>
          {saving ? <ActivityIndicator color={C.bg} /> : <Text style={s.saveBtnText}>Log session</Text>}
        </Pressable>
      </SafeAreaView>

      <Modal visible={pickerOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setPickerOpen(false)}>
        <BlockPickerModal
          onAdd={addBlock}
          onClose={() => setPickerOpen(false)}
          initialTab="library"
          allowSaveToLibrary={false}
        />
      </Modal>
    </LinearGradient>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: C.textPrimary, textAlign: "center" },

  body: { flex: 1, paddingHorizontal: 16, gap: 16 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  blocksCard: { flex: 1 },

  sectionTitle: { fontSize: 15, fontWeight: "700", color: C.textPrimary },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 20, backgroundColor: C.surfaceHigh,
    borderWidth: 1, borderColor: C.border,
  },
  chipDate: { flexDirection: "row", alignItems: "center", gap: 6 },
  chipActive: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  chipTextActive: { color: C.bg },

  blockList: { gap: 10, paddingBottom: 4 },
  emptyBlocks: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 24, paddingHorizontal: 24,
    borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: "dashed",
  },
  emptyBlocksText: { fontSize: 14, color: C.textMuted, textAlign: "center" },

  addBlockBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: C.green, borderStyle: "dashed",
  },
  addBlockBtnText: { fontSize: 14, fontWeight: "700", color: C.green },

  summary: {
    textAlign: "center", fontSize: 12, color: C.textSecondary,
    marginTop: 12, marginBottom: 4,
  },

  saveBtn: {
    backgroundColor: C.green, borderRadius: 14,
    paddingVertical: 15, alignItems: "center",
    marginHorizontal: 16, marginTop: 12, marginBottom: 16,
  },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: C.bg },
})
