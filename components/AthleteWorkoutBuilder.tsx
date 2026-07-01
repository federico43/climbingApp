import { C } from "@/utils/theme"
import { AppUser, ExerciseRow, MAX_ATHLETE_TEMPLATES, ProtocolRow, createProtocol, listAthleteTemplates, updateProtocol } from "@/services/BoulderGraphService"
import {
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
  ActivityIndicator,
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

// Per-athlete workout builder (big screen). Two card panes: the workout (left)
// and the available blocks (right). Saving creates a protocol and assigns it to
// the athlete. The left pane's ⋮ menu copies the workout to other athletes.
// Built additively — reuses the existing block editor/picker without changing
// the protocol-designer screen.
export function AthleteWorkoutBuilder({
  athlete,
  roster,
  protocol,
  onClose,
  onSaved,
}: {
  athlete: AppUser
  roster: AppUser[]
  protocol?: ProtocolRow | null  // when set, edit this template instead of creating a new one
  onClose: () => void
  onSaved?: () => void
}) {
  const editing = !!protocol
  const [name, setName] = useState(protocol?.name ?? "")
  const [blocks, setBlocks] = useState<Block[]>(() => {
    try { return protocol ? injectLocalIds(JSON.parse(protocol.blocks ?? "[]")) : [] }
    catch { return [] }
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)
  // The S&C block whose exercise library is open as an overlay over this pane.
  const [libraryBlockId, setLibraryBlockId] = useState<string | null>(null)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const wide = width >= 900  // narrow → single pane + block picker as a sheet
  const [pickerOpen, setPickerOpen] = useState(false)

  function addBlock(b: Block) { setBlocks((p) => [...p, b]); setExpandedId(b.id) }
  function updateBlock(b: Block) { setBlocks((p) => p.map((x) => (x.id === b.id ? b : x))) }
  function deleteBlock(id: string) { setBlocks((p) => p.filter((x) => x.id !== id)) }

  // Drag-to-reorder via the ☰ handle (long-press starts the drag).
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

  // Hosts the exercise library for S&C blocks (signalled via context).
  const libraryController = useMemo(() => ({ open: setLibraryBlockId }), [])
  function addExerciseToBlock(blockId: string, ex: ExerciseRow) {
    setBlocks((p) => p.map((b) =>
      b.id === blockId && b.type === "strength_conditioning"
        ? { ...b, exercises: [...b.exercises, exerciseFromLibrary(ex)] }
        : b))
  }

  function validate(): boolean {
    if (!name.trim()) { Alert.alert("Name required", "Give this workout a name."); return false }
    if (blocks.length === 0) { Alert.alert("No blocks", "Add at least one block from the right."); return false }
    return true
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      if (editing) {
        await updateProtocol(protocol!.$id, { name: name.trim(), blocks: stripLocalIds(blocks) })
      } else {
        await createProtocol({ name: name.trim(), blocks: stripLocalIds(blocks), athleteId: athlete.$id })
      }
      onSaved?.()
      onClose()
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save the workout.")
      setSaving(false)
    }
  }

  async function copyToAthletes() {
    if (!validate()) return
    const ids = [...copyTargets]
    if (ids.length === 0) { setCopyOpen(false); return }
    setCopying(true)
    try {
      // Each target gets its own copy (a new template) so they can diverge later.
      // Respect the per-athlete cap; skip anyone already full.
      const skipped: string[] = []
      let copied = 0
      for (const id of ids) {
        const count = (await listAthleteTemplates(id)).length
        if (count >= MAX_ATHLETE_TEMPLATES) {
          skipped.push(roster.find((r) => r.$id === id)?.username ?? id)
          continue
        }
        await createProtocol({ name: name.trim(), blocks: stripLocalIds(blocks), athleteId: id })
        copied++
      }
      setCopyOpen(false)
      setCopyTargets(new Set())
      onSaved?.()
      Alert.alert(
        "Copy complete",
        `Copied to ${copied} athlete${copied !== 1 ? "s" : ""}.` +
          (skipped.length ? `\nSkipped (already at ${MAX_ATHLETE_TEMPLATES}): ${skipped.join(", ")}.` : ""),
      )
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not copy the workout.")
    } finally {
      setCopying(false)
    }
  }

  const otherAthletes = roster.filter((a) => a.$id !== athlete.$id)
  const athleteName = athlete.username ?? athlete.$id

  return (
   <SCLibraryContext.Provider value={libraryController}>
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={onClose} hitSlop={8}><Text style={s.cancel}>Cancel</Text></Pressable>
        <Text style={s.title} numberOfLines={1}>{editing ? "Edit workout" : "New workout"} · {athleteName}</Text>
        <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
          <Text style={[s.save, saving && { opacity: 0.4 }]}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <View style={[s.panes, { paddingBottom: insets.bottom + 24 }]}>
        {/* Left: the workout */}
        <View style={s.card}>
          <View style={s.leftHeader}>
            <TextInput
              style={s.nameInput}
              placeholder="Workout name"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#888"
            />
            <Pressable style={s.dotsBtn} onPress={() => setMenuOpen((o) => !o)} hitSlop={8}>
              <Text style={s.dots}>⋮</Text>
            </Pressable>
          </View>

          {/* GestureHandlerRootView wraps ONLY the draggable list. Wrapping the
              whole builder broke taps on the library overlay on macOS (RNGH
              nested in a Modal swallows pressable touches there). */}
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

          {/* Narrow screens: the block picker opens as a sheet instead of a side pane */}
          {!wide && (
            <Pressable style={s.addBlockBtn} onPress={() => setPickerOpen(true)}>
              <Text style={s.addBlockBtnText}>+ Add block</Text>
            </Pressable>
          )}

          {/* ⋮ menu */}
          {menuOpen && (
            <>
              <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)} />
              <View style={s.menu}>
                <Pressable
                  style={s.menuItem}
                  onPress={() => { setMenuOpen(false); setCopyOpen(true) }}
                >
                  <Text style={s.menuItemText}>Copy to another athlete</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Exercise library — a pane on top of the protocol detail */}
          {libraryBlockId && (
            <View style={s.libOverlay}>
              <ExerciseLibraryPane
                variant="overlay"
                onClose={() => setLibraryBlockId(null)}
                onAdd={(ex) => addExerciseToBlock(libraryBlockId, ex)}
              />
            </View>
          )}
        </View>

        {/* Right: available blocks (wide screens only). Disable the S&C library
            overlay context here — a block being *created* isn't in `blocks` yet,
            so its exercises must be edited inline, not via the host overlay. */}
        {wide && (
          <View style={s.card}>
            <SCLibraryContext.Provider value={null}>
              <BlockPickerModal onAdd={addBlock} onClose={() => {}} embedded />
            </SCLibraryContext.Provider>
          </View>
        )}
      </View>

      {/* Narrow: block picker as a full-screen sheet */}
      {!wide && (
        <Modal visible={pickerOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setPickerOpen(false)}>
          <SCLibraryContext.Provider value={null}>
            <BlockPickerModal onAdd={(b) => { addBlock(b); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} />
          </SCLibraryContext.Provider>
        </Modal>
      )}

      {/* Copy-to-athlete picker */}
      <Modal visible={copyOpen} transparent animationType="fade" onRequestClose={() => setCopyOpen(false)}>
        <Pressable style={s.copyBackdrop} onPress={() => setCopyOpen(false)}>
          <Pressable style={s.copyCard} onPress={() => {}}>
            <Text style={s.copyTitle}>Copy workout to</Text>
            <Text style={s.copySub}>Each athlete gets their own copy.</Text>
            <View style={s.copyPills}>
              {otherAthletes.length === 0 ? (
                <Text style={s.empty}>No other athletes.</Text>
              ) : otherAthletes.map((a) => {
                const sel = copyTargets.has(a.$id)
                return (
                  <Pressable
                    key={a.$id}
                    style={[s.copyPill, sel && s.copyPillSel]}
                    onPress={() => setCopyTargets((prev) => {
                      const n = new Set(prev); n.has(a.$id) ? n.delete(a.$id) : n.add(a.$id); return n
                    })}
                  >
                    <Text style={[s.copyPillText, sel && s.copyPillTextSel]}>{a.username ?? a.$id}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable
              style={[s.copyConfirm, (copyTargets.size === 0 || copying) && { opacity: 0.5 }]}
              onPress={copyToAthletes}
              disabled={copyTargets.size === 0 || copying}
            >
              {copying ? <ActivityIndicator color={C.bg} /> : (
                <Text style={s.copyConfirmText}>
                  Copy to {copyTargets.size || ""} athlete{copyTargets.size !== 1 ? "s" : ""}
                </Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
   </SCLibraryContext.Provider>
  )
}

const s = StyleSheet.create({
  // Translucent scrim — the Design screen shows through behind the floating cards.
  root: { flex: 1, backgroundColor: "rgba(8,10,9,0.8)" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 28, paddingTop: 20, paddingBottom: 4,
  },
  cancel: { fontSize: 16, color: "rgba(255,255,255,0.85)", fontWeight: "600" },
  title: { fontSize: 16, fontWeight: "700", color: "#fff", flex: 1, textAlign: "center", marginHorizontal: 12 },
  save: { fontSize: 16, color: C.green, fontWeight: "800" },

  panes: { flex: 1, flexDirection: "row", gap: 20, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 28 },
  card: {
    flex: 1, backgroundColor: C.surface, borderRadius: 24,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },

  // Library overlay fills the left card (clipped to its rounded corners).
  libOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.surface, zIndex: 30 },

  leftHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8,
  },
  nameInput: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.textPrimary,
  },
  dotsBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  dots: { fontSize: 20, color: C.textSecondary, fontWeight: "800" },

  blockList: { padding: 14, gap: 10, paddingBottom: 40 },
  empty: { fontSize: 14, color: C.textMuted, textAlign: "center", marginTop: 24 },
  addBlockBtn: {
    margin: 12, borderRadius: 12, paddingVertical: 13, alignItems: "center",
    borderWidth: 1, borderColor: C.green, borderStyle: "dashed",
  },
  addBlockBtnText: { fontSize: 15, fontWeight: "800", color: C.green },

  menuBackdrop: { ...StyleSheet.absoluteFillObject },
  menu: {
    position: "absolute", top: 56, right: 14,
    backgroundColor: C.surfaceHigh, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingVertical: 4, minWidth: 220,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 10, elevation: 8,
  },
  menuItem: { paddingHorizontal: 14, paddingVertical: 12 },
  menuItemText: { fontSize: 14, color: C.textPrimary, fontWeight: "600" },

  copyBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  copyCard: { width: "100%", maxWidth: 420, backgroundColor: C.surface, borderRadius: 18, padding: 20, gap: 8 },
  copyTitle: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  copySub: { fontSize: 13, color: C.textSecondary, marginBottom: 8 },
  copyPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  copyPill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border },
  copyPillSel: { backgroundColor: C.green, borderColor: C.green },
  copyPillText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  copyPillTextSel: { color: C.bg },
  copyConfirm: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  copyConfirmText: { fontSize: 15, fontWeight: "800", color: C.bg },
})
