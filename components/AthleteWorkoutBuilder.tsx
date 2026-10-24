import { useHoldUpdates } from "@/utils/updateHold"
import { C } from "@/utils/theme"
import { AppUser, ExerciseRow, ProtocolRow, createProtocol, deleteProtocol, updateProtocol } from "@/services/BoulderGraphService"
import { AthleteRecentSessionsSummary } from "@/components/AthleteRecentSessionsSummary"
import { SuggestedWarmupCard } from "@/components/SuggestedWarmupCard"
import { defaultDueBy, homeworkName, shortDay } from "@/utils/homework"
import { notifyHomeworkAssigned } from "@/services/homework"
import { addDays, localDateStr } from "@/utils/planRotation"
import {
  AuthoringAthleteContext,
  Block,
  BlockEditorRow,
  BlockPickerModal,
  CARD_GRID_FULL_COLUMNS_WIDTH,
  ExerciseLibraryPane,
  ReorderableCardGrid,
  SCLibraryContext,
  exerciseFromLibrary,
  injectLocalIds,
  stripLocalIds,
} from "@/components/workoutBlocks"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"

// Narrow screens: share of the window the S&C exercise library takes as a
// bottom sheet, leaving the workout visible above it.
const LIB_SHEET_FRACTION = 0.5

// Per-athlete workout builder (big screen). Two card panes: the workout (left)
// and the available blocks (right). Saving creates a protocol and assigns it to
// the athlete. The left pane's ⋮ menu copies the workout to other athletes.
// Built additively — reuses the existing block editor/picker without changing
// the protocol-designer screen.
//
// When `athlete` is omitted, the builder is in library mode: it saves an
// untagged (global) protocol instead of one owned by a specific athlete.
//
// `plan` = a new workout built from the athlete's training plan: it's saved
// with the plan's id and its place in the rotation. (Splitting its S&C off
// into a workout of its own was removed 2026-10-14; S&C parts saved before
// that, planPart "sc", are still read everywhere.)
//
// With an athlete, any block can be made homework: on save it moves into a
// workout of its own (planPart "homework", with a deadline) that the athlete
// schedules themselves (docs/training-plan-implementation.md §8).
// `initialHomeworkIds` pre-marks blocks (Build's Density test).
export function AthleteWorkoutBuilder({
  athlete,
  roster,
  protocol,
  initialBlocks,
  initialName,
  initialHomeworkIds,
  plan,
  onClose,
  onSaved,
}: {
  athlete?: AppUser | null
  roster: AppUser[]
  protocol?: ProtocolRow | null  // when set, edit this template instead of creating a new one
  // Pre-fill a new (unsaved) workout — e.g. from the suggested-workout
  // algorithm. Ignored when `protocol` is set (editing an existing one wins).
  initialBlocks?: Block[]
  initialName?: string
  initialHomeworkIds?: string[]
  plan?: { planId: string; planIndex: number }
  onClose: () => void
  onSaved?: () => void
}) {
  // A reload here would lose unsaved work — see utils/updateHold.ts.
  useHoldUpdates()
  const editing = !!protocol
  const [name, setName] = useState(protocol?.name ?? initialName ?? "")
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (protocol) {
      try { return injectLocalIds(JSON.parse(protocol.blocks ?? "[]")) }
      catch { return [] }
    }
    return initialBlocks ?? []
  })
  // Narrow list: the one expanded row. Wide grid: any number of open cards.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [openCards, setOpenCards] = useState<Set<string>>(new Set())
  // Wide grid: per-card widths set by dragging a card's right edge (layout
  // only — not saved with the workout).
  const [cardWidths, setCardWidths] = useState<Record<string, number>>({})
  function resizeCard(id: string, w: number | null) {
    setCardWidths((prev) => {
      const n = { ...prev }
      if (w == null) delete n[id]; else n[id] = w
      return n
    })
  }
  function toggleCard(id: string) {
    setOpenCards((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const [saving, setSaving] = useState(false)
  // Blocks (local ids) marked as homework, and its deadline.
  const today = localDateStr(new Date())
  const [homeworkIds, setHomeworkIds] = useState<Set<string>>(() => new Set(initialHomeworkIds ?? []))
  const [dueBy, setDueBy] = useState(() => defaultDueBy(today))
  const [homeworkOpen, setHomeworkOpen] = useState(false)
  // Blocks the coach will run in person (§12a) — the flag lives on the block.
  const [coachedOpen, setCoachedOpen] = useState(false)
  const coachedBlocks = blocks.filter((b) => b.coached)
  function toggleCoached(id: string) {
    setBlocks((p) => p.map((b) => (b.id === id ? { ...b, coached: b.coached ? undefined : true } : b)))
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)
  // The S&C block whose exercise library is open (right pane on wide, an
  // overlay on the list on narrow).
  const [libraryBlockId, setLibraryBlockId] = useState<string | null>(null)
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const wide = width >= 900  // narrow → single pane + block picker as a sheet
  // Narrow: keep the S&C block being filled in view above the library
  // sheet — its newest exercise and Add button at the bottom of the list.
  const listRef = useRef<any>(null)  // the list's FlatList (typed as RNGH's)
  useEffect(() => {
    if (wide || !libraryBlockId) return
    const index = blocks.findIndex((b) => b.id === libraryBlockId)
    if (index < 0) return
    const t = setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 1, animated: true }), 120)
    return () => clearTimeout(t)
  }, [wide, libraryBlockId, blocks])
  const [pickerOpen, setPickerOpen] = useState(false)

  // Right pane (block picker/library) width — user-resizable by dragging the
  // divider. Kept in a ref too so the pan handlers (created once) always read
  // the latest value instead of the one captured at mount.
  const [rightPaneWidth, setRightPaneWidth] = useState(420)
  const rightPaneWidthRef = useRef(rightPaneWidth)
  useEffect(() => { rightPaneWidthRef.current = rightPaneWidth }, [rightPaneWidth])
  // The card grid hugs its widest row (see ReorderableCardGrid's fitWithin);
  // whatever it leaves over goes to the right pane. Paused while the divider
  // is dragged so the divider tracks the pointer.
  const [panesWidth, setPanesWidth] = useState(0)
  const [gridFitWidth, setGridFitWidth] = useState(0)
  const [draggingDivider, setDraggingDivider] = useState(false)
  // The right pane gives up width (down to its minimum, whatever the divider
  // says) so the grid gets three columns wide enough for its longest S&C name.
  const [gridNeed, setGridNeed] = useState(CARD_GRID_FULL_COLUMNS_WIDTH)
  const paneChrome = PANE_DIVIDER_W + BLOCK_GRID_PAD * 2
  const rightPaneBase = panesWidth === 0
    ? rightPaneWidth
    : Math.max(RIGHT_PANE_MIN, Math.min(rightPaneWidth, panesWidth - paneChrome - gridNeed))
  const gridAvailable = Math.max(0, panesWidth - rightPaneBase - paneChrome)
  const gridLeftover = wide && !draggingDivider && blocks.length > 0 && gridFitWidth > 0
    ? Math.max(0, gridAvailable - gridFitWidth)
    : 0
  const rightPaneVisibleRef = useRef(0)
  rightPaneVisibleRef.current = rightPaneBase + gridLeftover
  const fitWithin = useMemo(() => ({ available: gridAvailable, onWidth: setGridFitWidth, onNeed: setGridNeed }), [gridAvailable])
  const dragStartWidthRef = useRef(rightPaneWidth)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2,
      onPanResponderGrant: () => {
        // Start from the pane's on-screen width.
        dragStartWidthRef.current = rightPaneVisibleRef.current
        setDraggingDivider(true)
      },
      onPanResponderMove: (_, g) => {
        const min = RIGHT_PANE_MIN
        const max = Math.max(min, width * 0.6)
        setRightPaneWidth(Math.min(max, Math.max(min, dragStartWidthRef.current - g.dx)))
      },
      onPanResponderRelease: () => setDraggingDivider(false),
      onPanResponderTerminate: () => setDraggingDivider(false),
    })
  ).current

  function addBlock(b: Block) {
    setBlocks((p) => [...p, b])
    setExpandedId(b.id)
    setOpenCards((prev) => new Set(prev).add(b.id))
    // A fresh S&C block is useless until it has exercises — open the library
    // for it straight away instead of making the coach hit "Add exercise".
    // (Blocks picked from the library already come with theirs.)
    if (b.type === "strength_conditioning" && b.exercises.length === 0) setLibraryBlockId(b.id)
  }
  function updateBlock(b: Block) { setBlocks((p) => p.map((x) => (x.id === b.id ? b : x))) }
  const deleteBlock = useCallback((id: string) => {
    const b = blocks.find((x) => x.id === id)
    Alert.alert("Delete block", `Remove "${b?.blockName || "this block"}" from the workout?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        setLibraryBlockId((cur) => (cur === id ? null : cur))
        setBlocks((p) => p.filter((x) => x.id !== id))
        setHomeworkIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      } },
    ])
  }, [blocks])

  // Narrow: drag-to-reorder list via the grip (long-press starts the drag).
  const renderBlock = useCallback(({ item, drag, isActive }: RenderItemParams<Block>) => (
    <BlockEditorRow
      card
      block={item}
      isExpanded={expandedId === item.id}
      isActive={isActive}
      onToggleExpand={() => setExpandedId((p) => (p === item.id ? null : item.id))}
      onDrag={drag}
      onUpdate={updateBlock}
      onDelete={() => deleteBlock(item.id)}
    />
  ), [expandedId, deleteBlock])

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

  // Homework only for an athlete's workout — and only for a workout that's
  // itself a plain one (not an S&C part or homework being edited).
  const canHomework = !!athlete && !protocol?.planPart
  const homework = canHomework ? blocks.filter((b) => homeworkIds.has(b.id)) : []
  const kept = homework.length ? blocks.filter((b) => !homeworkIds.has(b.id)) : blocks

  // Every block of an existing workout marked homework: the workout itself
  // becomes the homework — saved as a homework row, then the original is
  // deleted (an empty workout can't stay). Confirmed first, since it leaves
  // the athlete's workout list.
  const wholeToHomework = editing && homework.length > 0 && kept.length === 0

  function handleSave() {
    if (!validate()) return
    if (wholeToHomework) {
      Alert.alert(
        "Move the whole workout to homework?",
        `"${name.trim()}" becomes homework due ${shortDay(dueBy)} and leaves the athlete's workouts.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Move", onPress: () => { void save() } },
        ],
      )
      return
    }
    void save()
  }

  async function save() {
    setSaving(true)
    // No athlete selected → this is a global library workout.
    const source = athlete ? undefined : "library"
    // The plan slot the homework belongs to (a new plan workout, or the one being edited).
    const slot = plan ?? (protocol?.planId && protocol.planIndex ? { planId: protocol.planId, planIndex: protocol.planIndex } : undefined)

    // Homework first: if it can't be saved, nothing is — the builder stays
    // open with the blocks still marked, instead of a workout saved without
    // them (or with them) and no homework.
    let homeworkRow: ProtocolRow | null = null
    if (homework.length > 0) {
      try {
        homeworkRow = await createProtocol({
          // Homework is done alone — never coached.
          name: homeworkName(name, homework), blocks: stripLocalIds(homework.map((b) => ({ ...b, coached: undefined }))), athleteId: athlete!.$id,
          ...slot, planPart: "homework", dueBy,
        })
      } catch (e: any) {
        Alert.alert(
          "Homework not saved",
          `Nothing was saved: ${e?.message ?? "unknown error"}\n\n` +
            "Check that the protocol table has the dueBy column, then save again.",
        )
        setSaving(false)
        return
      }
    }

    try {
      if (wholeToHomework) {
        await deleteProtocol(protocol!.$id)
      } else if (editing) {
        await updateProtocol(protocol!.$id, { name: name.trim(), blocks: stripLocalIds(kept), source })
      } else if (kept.length === 0) {
        // The whole workout is homework.
      } else {
        await createProtocol({ name: name.trim(), blocks: stripLocalIds(kept), athleteId: athlete?.$id, source, ...plan })
      }
    } catch (e: any) {
      // Undo the homework so a retry doesn't make it twice.
      if (homeworkRow) await deleteProtocol(homeworkRow.$id).catch(() => {})
      Alert.alert("Error", e?.message ?? "Could not save the workout.")
      setSaving(false)
      return
    }

    // Only now that both are saved does the athlete hear about it.
    if (homeworkRow) notifyHomeworkAssigned(homeworkRow.$id, shortDay(dueBy))
    onSaved?.()
    onClose()
  }

  async function copyToAthletes() {
    if (!validate()) return
    const ids = [...copyTargets]
    if (ids.length === 0) { setCopyOpen(false); return }
    setCopying(true)
    try {
      // Each target gets its own copy (a new template) so they can diverge later.
      for (const id of ids) {
        await createProtocol({ name: name.trim(), blocks: stripLocalIds(blocks), athleteId: id })
      }
      setCopyOpen(false)
      setCopyTargets(new Set())
      onSaved?.()
      Alert.alert("Copy complete", `Copied to ${ids.length} athlete${ids.length !== 1 ? "s" : ""}.`)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not copy the workout.")
    } finally {
      setCopying(false)
    }
  }

  const otherAthletes = roster.filter((a) => a.$id !== athlete?.$id)
  const athleteName = athlete?.username ?? athlete?.$id ?? null

  return (
   <AuthoringAthleteContext.Provider value={athlete?.$id ?? null}>
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
            <Text style={s.title} numberOfLines={1}>
              {editing ? "Edit workout" : "New workout"}{athleteName ? ` · ${athleteName}` : " · Library"}
            </Text>
            <Text style={s.titleStatus}>{editing ? "Editing" : "Creating"} · unsaved changes</Text>
          </View>
          <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
            <Text style={[s.save, saving && { opacity: 0.4 }]}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>

        <View style={s.panes} onLayout={(e) => setPanesWidth(e.nativeEvent.layout.width)}>
        {/* Left: the workout */}
        <View style={s.leftPane}>
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

          {/* What the athlete did last time — collapsed by default so it
              doesn't eat into the block list on narrow screens. */}
          {athlete && <AthleteRecentSessionsSummary athleteId={athlete.$id} wide={wide} />}

          {/* Homework: blocks moved into a workout of their own on save. */}
          {canHomework && blocks.length > 0 && (
            <Pressable style={s.splitRow} onPress={() => setHomeworkOpen(true)}>
              <View style={{ flex: 1 }}>
                <Text style={s.splitLabel}>Homework</Text>
                <Text style={s.homeworkSub} numberOfLines={2}>
                  {homework.length === 0
                    ? "None — tap to make a block homework"
                    : `${homework.map(blockLabel).join(", ")} · due ${shortDay(dueBy)}`}
                </Text>
              </View>
              <Text style={s.homeworkEdit}>{homework.length ? "Edit" : "Add"}</Text>
            </Pressable>
          )}

          {/* Coached: blocks the coach runs in person — the athlete just sees the title + Done. */}
          {!!athlete && blocks.length > 0 && (
            <Pressable style={s.splitRow} onPress={() => setCoachedOpen(true)}>
              <View style={{ flex: 1 }}>
                <Text style={s.splitLabel}>Coached</Text>
                <Text style={s.homeworkSub} numberOfLines={2}>
                  {coachedBlocks.length === 0
                    ? "None — tap if you'll run blocks in person"
                    : coachedBlocks.map(blockLabel).join(", ")}
                </Text>
              </View>
              <Text style={s.homeworkEdit}>{coachedBlocks.length ? "Edit" : "Add"}</Text>
            </Pressable>
          )}

          {/* The constraint warm-up rotation for this athlete (3 blocks). */}
          {athlete && !plan && <SuggestedWarmupCard athleteId={athlete.$id} blocks={blocks} onApply={setBlocks} />}

          {/* GestureHandlerRootView wraps ONLY the card grid. Wrapping the
              whole builder broke taps on overlays on macOS (RNGH nested in a
              Modal swallows pressable touches there). */}
          <GestureHandlerRootView style={{ flex: 1 }}>
            {blocks.length === 0 ? (
              <View style={s.blockList}><Text style={s.empty}>{wide ? "Add blocks from the right →" : "Tap “Add block” below"}</Text></View>
            ) : wide ? (
              // Big screens: numbered, reorderable cards (long-press the grip
              // to drag) — same grid as S&C exercises — each one the full
              // "Edit block" editor, sized like exercise cards. Tap a card's
              // header to expand/collapse it.
              <ScrollView contentContainerStyle={s.blockGrid} keyboardShouldPersistTaps="handled">
                <ReorderableCardGrid
                  items={blocks}
                  onReorder={setBlocks}
                  widths={cardWidths}
                  onResize={resizeCard}
                  fitWithin={fitWithin}
                  renderCard={(b) => (
                    <BlockEditorRow
                      card
                      standalone
                      block={b}
                      isExpanded={openCards.has(b.id)}
                      isActive={false}
                      onToggleExpand={() => toggleCard(b.id)}
                      onDrag={() => {}}
                      onUpdate={updateBlock}
                      onDelete={() => deleteBlock(b.id)}
                    />
                  )}
                />
              </ScrollView>
            ) : (
              <DraggableFlatList
                ref={listRef}
                onScrollToIndexFailed={() => {}}
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
          {!wide && !libraryBlockId && (
            <Pressable style={s.addBlockBtn} onPress={() => setPickerOpen(true)}>
              <Text style={s.addBlockBtnText}>+ Add block</Text>
            </Pressable>
          )}

          {/* Narrow: the S&C exercise library opens as a bottom sheet; the
              list shrinks above it so each added exercise shows up there. */}
          {!wide && libraryBlockId && (
            <View style={[s.libSheet, { height: Math.round(height * LIB_SHEET_FRACTION) }]}>
              <ExerciseLibraryPane
                variant="overlay"
                onClose={() => setLibraryBlockId(null)}
                onAdd={(ex) => addExerciseToBlock(libraryBlockId, ex)}
              />
            </View>
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
        </View>

        {/* Drag to resize the pane split */}
        {wide && (
          <View
            style={[s.paneDivider, Platform.OS === "web" && ({ cursor: "col-resize" } as any)]}
            {...panResponder.panHandlers}
          >
            <View style={s.paneDividerGrip} />
          </View>
        )}

        {/* Right: available blocks, or — while picking exercises for an S&C
            block card — the exercise library (wide screens only). Blocks
            being *created* in the picker aren't in `blocks` yet, so they edit
            their exercises inline instead of via this host. */}
        {wide && (
          <View style={[s.rightPane, { width: rightPaneBase + gridLeftover }]}>
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

      {/* Narrow: block picker as a full-screen sheet. The <Modal> is its own
          native window, so it needs its own SafeAreaProvider — otherwise the
          picker's SafeAreaView gets 0 insets and its header (incl. the back
          button) sits under the status bar, untappable. */}
      {!wide && (
        <Modal visible={pickerOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setPickerOpen(false)}>
          <SafeAreaProvider>
            <SCLibraryContext.Provider value={null}>
              <BlockPickerModal onAdd={(b) => { addBlock(b); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} />
            </SCLibraryContext.Provider>
          </SafeAreaProvider>
        </Modal>
      )}

      {/* Homework picker: which blocks, and the deadline. */}
      <Modal visible={homeworkOpen} transparent animationType="fade" onRequestClose={() => setHomeworkOpen(false)}>
        <Pressable style={s.copyBackdrop} onPress={() => setHomeworkOpen(false)}>
          <Pressable style={s.copyCard} onPress={() => {}}>
            <Text style={s.copyTitle}>Homework</Text>
            <Text style={s.copySub}>
              These blocks become a workout of their own. {athleteName ?? "The athlete"} picks the day to do it, before the deadline.
            </Text>
            <View style={s.copyPills}>
              {/* One tap to send the whole workout. */}
              <Pressable
                style={[s.copyPill, kept.length === 0 && s.copyPillSel]}
                onPress={() => setHomeworkIds(kept.length === 0 ? new Set() : new Set(blocks.map((b) => b.id)))}
              >
                <Text style={[s.copyPillText, kept.length === 0 && s.copyPillTextSel]}>Whole workout</Text>
              </Pressable>
              {blocks.map((b) => {
                const sel = homeworkIds.has(b.id)
                return (
                  <Pressable
                    key={b.id}
                    style={[s.copyPill, sel && s.copyPillSel]}
                    onPress={() => setHomeworkIds((prev) => {
                      const n = new Set(prev); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n
                    })}
                  >
                    <Text style={[s.copyPillText, sel && s.copyPillTextSel]}>{blockLabel(b)}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={s.splitLabel}>Deadline</Text>
            <View style={s.dueRow}>
              <Pressable
                style={[s.dueStep, dueBy <= today && { opacity: 0.3 }]}
                disabled={dueBy <= today}
                onPress={() => setDueBy((d) => addDays(d, -1))}
                hitSlop={6}
              >
                <Text style={s.dueStepText}>−</Text>
              </Pressable>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={s.dueDate}>{shortDay(dueBy)}</Text>
                <Text style={s.homeworkSub}>{dueDaysLabel(today, dueBy)}</Text>
              </View>
              <Pressable style={s.dueStep} onPress={() => setDueBy((d) => addDays(d, 1))} hitSlop={6}>
                <Text style={s.dueStepText}>+</Text>
              </Pressable>
            </View>
            <Pressable style={s.copyConfirm} onPress={() => setHomeworkOpen(false)}>
              <Text style={s.copyConfirmText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Coached picker: blocks the coach runs in person. */}
      <Modal visible={coachedOpen} transparent animationType="fade" onRequestClose={() => setCoachedOpen(false)}>
        <Pressable style={s.copyBackdrop} onPress={() => setCoachedOpen(false)}>
          <Pressable style={s.copyCard} onPress={() => {}}>
            <Text style={s.copyTitle}>Coached blocks</Text>
            <Text style={s.copySub}>
              {"Blocks you'll run in person. "}{athleteName ?? "The athlete"}{" just sees the title and Done — on sequence blocks they save the sequences you set, with their sends. They can also switch a block during the workout."}
            </Text>
            <View style={s.copyPills}>
              {blocks.filter((b) => !homeworkIds.has(b.id)).map((b) => {
                const sel = !!b.coached
                return (
                  <Pressable key={b.id} style={[s.copyPill, sel && s.copyPillSel]} onPress={() => toggleCoached(b.id)}>
                    <Text style={[s.copyPillText, sel && s.copyPillTextSel]}>{blockLabel(b)}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable style={s.copyConfirm} onPress={() => setCoachedOpen(false)}>
              <Text style={s.copyConfirmText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
                      const n = new Set(prev); if (n.has(a.$id)) n.delete(a.$id); else n.add(a.$id); return n
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
   </AuthoringAthleteContext.Provider>
  )
}

function blockLabel(b: Block): string {
  return b.blockName?.trim() || b.type.replace(/_/g, " ")
}

// "5 days from today" (counting today as day 0).
function dueDaysLabel(today: string, dueBy: string): string {
  let n = 0
  for (let d = today; d < dueBy && n < 400; d = addDays(d, 1)) n++
  return n === 0 ? "today" : n === 1 ? "tomorrow" : `${n} days from today`
}

const PANE_DIVIDER_W = 14
const RIGHT_PANE_MIN = 280
const BLOCK_GRID_PAD = 18

const s = StyleSheet.create({
  // Solid dark gray — same tone as the library pane, so the whole screen
  // reads as one dedicated surface instead of a scrim over Design.
  root: { flex: 1, backgroundColor: C.surface },
  // One continuous sheet — header included — instead of a header floating on
  // the scrim above two separate cards.
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
  // A persistent reminder that this whole screen is a draft — nothing here
  // is saved until "Save" is tapped, unlike the tabs it floats over.
  titleStatus: { fontSize: 11, fontWeight: "600", color: C.green, textAlign: "center", marginTop: 2 },
  save: { fontSize: 16, color: C.green, fontWeight: "800" },

  panes: { flex: 1, flexDirection: "row" },
  leftPane: { flex: 1, minWidth: 280 },

  // Narrow: the library is a bottom sheet under the (shrunk) block list.
  libSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderTopWidth: 1, borderColor: C.border, overflow: "hidden",
  },
  // Width is user-controlled via the drag divider (default set in state).
  rightPane: { minWidth: RIGHT_PANE_MIN },
  paneDivider: { width: PANE_DIVIDER_W, alignItems: "center", justifyContent: "center" },
  paneDividerGrip: { width: 3, height: 44, borderRadius: 2, backgroundColor: C.border },

  leftHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8,
  },
  nameInput: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.textPrimary,
  },
  splitRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 14, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: C.surfaceHigh, borderRadius: 10,
  },
  splitLabel: { fontSize: 14, color: C.textPrimary, fontWeight: "600" },
  homeworkSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  homeworkEdit: { fontSize: 14, color: C.green, fontWeight: "700", marginLeft: 10 },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4, marginBottom: 8 },
  dueStep: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  dueStepText: { fontSize: 22, color: C.textPrimary, fontWeight: "700" },
  dueDate: { fontSize: 16, color: C.textPrimary, fontWeight: "800" },
  dotsBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  dots: { fontSize: 20, color: C.textSecondary, fontWeight: "800" },

  blockList: { padding: 14, paddingBottom: 40 },
  // Extra room for the grid cards' number badge / grip, which sit half
  // outside each card.
  blockGrid: { paddingHorizontal: BLOCK_GRID_PAD, paddingTop: 18, paddingBottom: 40 },
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
