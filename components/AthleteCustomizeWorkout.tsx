import { useHoldUpdates } from "@/utils/updateHold"
import { C } from "@/utils/theme"
import { ExerciseRow, ProtocolRow, createProtocol, updateProtocol } from "@/services/BoulderGraphService"
import {
  AuthoringAthleteContext,
  Block,
  BlockEditorRow,
  BlockPickerModal,
  ExerciseLibraryPane,
  SCLibraryContext,
  exerciseFromLibrary,
  injectLocalIds,
  stripLocalIds,
} from "@/components/workoutBlocks"
import { useCallback, useMemo, useState } from "react"
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { useSafeAreaInsets } from "react-native-safe-area-context"

// Lets an athlete fork a library workout (or edit a copy they already saved)
// into their own "From the Library" list. A trimmed-down sibling of
// AthleteWorkoutBuilder — same block editor/picker, no coach-only cross-athlete
// copy chrome. Saves always tag the row with source: "library" so it's kept
// separate from the coach's assigned workouts on Home.
export function AthleteCustomizeWorkout({
  athleteId,
  seedName,
  seedBlocks,
  protocol,
  onClose,
  onSaved,
}: {
  athleteId: string
  seedName?: string
  seedBlocks?: any[]        // raw (no local ids) blocks from a library template
  protocol?: ProtocolRow | null  // when set, edit this saved copy instead of creating a new one
  onClose: () => void
  onSaved?: () => void
}) {
  // A reload here would lose unsaved work — see utils/updateHold.ts.
  useHoldUpdates()
  const editing = !!protocol
  const [name, setName] = useState(protocol?.name ?? seedName ?? "")
  const [blocks, setBlocks] = useState<Block[]>(() => {
    try {
      if (protocol) return injectLocalIds(JSON.parse(protocol.blocks ?? "[]"))
      if (seedBlocks) return injectLocalIds(seedBlocks)
      return []
    } catch { return [] }
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [libraryBlockId, setLibraryBlockId] = useState<string | null>(null)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const wide = width >= 900
  const [pickerOpen, setPickerOpen] = useState(false)

  function addBlock(b: Block) { setBlocks((p) => [...p, b]); setExpandedId(b.id) }
  function updateBlock(b: Block) { setBlocks((p) => p.map((x) => (x.id === b.id ? b : x))) }
  function deleteBlock(id: string) { setBlocks((p) => p.filter((x) => x.id !== id)) }

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

  const libraryController = useMemo(() => ({ open: setLibraryBlockId }), [])
  function addExerciseToBlock(blockId: string, ex: ExerciseRow) {
    setBlocks((p) => p.map((b) =>
      b.id === blockId && b.type === "strength_conditioning"
        ? { ...b, exercises: [...b.exercises, exerciseFromLibrary(ex)] }
        : b))
  }

  function validate(): boolean {
    if (!name.trim()) { Alert.alert("Name required", "Give this workout a name."); return false }
    if (blocks.length === 0) { Alert.alert("No blocks", "Add at least one block."); return false }
    return true
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      if (editing) {
        await updateProtocol(protocol!.$id, { name: name.trim(), blocks: stripLocalIds(blocks) })
      } else {
        await createProtocol({ name: name.trim(), blocks: stripLocalIds(blocks), athleteId, source: "library" })
      }
      onSaved?.()
      onClose()
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save the workout.")
      setSaving(false)
    }
  }

  return (
   <AuthoringAthleteContext.Provider value={athleteId}>
   <SCLibraryContext.Provider value={libraryController}>
    <View style={s.root}>
      <View style={[s.shell, {
        marginTop: insets.top + (wide ? 14 : 0),
        marginBottom: insets.bottom + (wide ? 24 : 0),
        marginHorizontal: wide ? 24 : 0,
        borderRadius: wide ? 24 : 0,
        borderWidth: wide ? 1 : 0,
        shadowOpacity: wide ? 0.45 : 0,
        elevation: wide ? 12 : 0,
      }]}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={8}><Text style={s.cancel}>Cancel</Text></Pressable>
          <View style={s.titleWrap}>
            <Text style={s.title} numberOfLines={1}>{editing ? "Edit my workout" : "Customize workout"}</Text>
            <Text style={s.titleStatus}>{editing ? "Editing" : "Creating"} · unsaved changes</Text>
          </View>
          <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
            <Text style={[s.save, saving && { opacity: 0.4 }]}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>

        <View style={s.panes}>
        <View style={s.leftPane}>
          <View style={s.leftHeader}>
            <TextInput
              style={s.nameInput}
              placeholder="Workout name"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#888"
            />
          </View>

          <GestureHandlerRootView style={{ flex: 1 }}>
            {blocks.length === 0 ? (
              <View style={s.blockList}><Text style={s.empty}>{wide ? "Add blocks from the right →" : "Tap “Add block” below"}</Text></View>
            ) : (
              <DraggableFlatList
                data={blocks}
                containerStyle={{ flex: 1 }}
                keyExtractor={(item) => item.id}
                onDragEnd={({ data }) => setBlocks(data)}
                renderItem={renderBlock}
                contentContainerStyle={s.blockList}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              />
            )}
          </GestureHandlerRootView>

          {!wide && (
            <Pressable style={s.addBlockBtn} onPress={() => setPickerOpen(true)}>
              <Text style={s.addBlockBtnText}>+ Add block</Text>
            </Pressable>
          )}

          {/* On wide screens the library takes over the right pane instead
              (below), since that space is already dedicated to picking things. */}
          {!wide && libraryBlockId && (
            <View style={s.libOverlay}>
              <ExerciseLibraryPane
                variant="overlay"
                onClose={() => setLibraryBlockId(null)}
                onAdd={(ex) => addExerciseToBlock(libraryBlockId, ex)}
              />
            </View>
          )}
        </View>

        {wide && (
          <View style={s.rightPane}>
            {libraryBlockId ? (
              <ExerciseLibraryPane
                variant="overlay"
                onClose={() => setLibraryBlockId(null)}
                onAdd={(ex) => addExerciseToBlock(libraryBlockId, ex)}
              />
            ) : (
              <SCLibraryContext.Provider value={null}>
                <BlockPickerModal onAdd={addBlock} onClose={() => {}} embedded />
              </SCLibraryContext.Provider>
            )}
          </View>
        )}
        </View>
      </View>

      {!wide && (
        <Modal visible={pickerOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setPickerOpen(false)}>
          <SCLibraryContext.Provider value={null}>
            <BlockPickerModal onAdd={(b) => { addBlock(b); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} />
          </SCLibraryContext.Provider>
        </Modal>
      )}
    </View>
   </SCLibraryContext.Provider>
   </AuthoringAthleteContext.Provider>
  )
}

const s = StyleSheet.create({
  // Solid dark gray — same tone as the library pane, so the whole screen
  // reads as one dedicated surface instead of a scrim over Design.
  root: { flex: 1, backgroundColor: C.surface },
  shell: {
    flex: 1, marginHorizontal: 24,
    backgroundColor: C.surface, borderRadius: 24,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  cancel: { fontSize: 16, color: "rgba(255,255,255,0.85)", fontWeight: "600" },
  titleWrap: { flex: 1, marginHorizontal: 12 },
  title: { fontSize: 16, fontWeight: "700", color: "#fff", textAlign: "center" },
  titleStatus: { fontSize: 11, fontWeight: "600", color: C.green, textAlign: "center", marginTop: 2 },
  save: { fontSize: 16, color: C.green, fontWeight: "800" },

  panes: { flex: 1, flexDirection: "row" },
  leftPane: { flex: 1 },
  rightPane: { width: 420, borderLeftWidth: 1, borderLeftColor: C.border },

  libOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.surface, zIndex: 30 },

  leftHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8,
  },
  nameInput: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.textPrimary,
  },

  blockList: { padding: 14, gap: 10, paddingBottom: 40 },
  empty: { fontSize: 14, color: C.textMuted, textAlign: "center", marginTop: 24 },
  addBlockBtn: {
    margin: 12, borderRadius: 12, paddingVertical: 13, alignItems: "center",
    borderWidth: 1, borderColor: C.green, borderStyle: "dashed",
  },
  addBlockBtnText: { fontSize: 15, fontWeight: "800", color: C.green },
})
